-- =====================================================================
-- আগের তারিখ খোলা ও একসাথে পূরণ / Earlier dates of the attendance book, opened by the zonal manager, filled in one step
--
-- Owner (18 Nov 2026): "Steadfast ওয়েবসাইটে এই এই তারিখে আবেদন করেছে … যেহেতু সাইট রেডি করতে লেট হচ্ছে, সেহেতু এবার আগের সব
-- তারিখে ডাটা ফিলাপ করে দেয়" — and "এটা জোনাল সেটিং এ রাখলে ভালো হয়"; the staff fill everything on one page; attendance only
-- (the four daily numbers keep their own one-day rule).
--
--  * The book stays what it was: days 1–17 (settings) of the current month, open while today is inside them.
--  * NEW: a zonal manager (permission hr.attendance.configure, zone scope) may open earlier dates of the book for their zone:
--    a range inside one month's book days, at most two months back, open for giving until a chosen day (at most 31 days ahead).
--    One live window per zone and month; saving again replaces it (the old one is kept as history). Nothing is ever deleted.
--  * NEW: wf_book_fill — present dates, "applied on the Steadfast website" dates and not-applied absent dates (one application)
--    in ONE call, all or nothing. It calls the existing wf_att_submit / wf_absence_apply, so every old rule still holds.
--  * Every input still waits for the hub manager's approval (wf_marks_decide / wf_absence_decide, unchanged).
--
-- Additive: one table, one permission, five new functions. Six existing functions are replaced with the same signature
-- and the same behaviour, plus "or a window the zonal manager opened": private.wf_check_date, private.wf_grid,
-- public.wf_my_book (+ catch_up, months, days[].can_give), public.wf_hub_book (+ catch_up), public.wf_pending_counts
-- (+ mine.catch_up_until) and private.wf_remind (+ a reminder while a window is open).
-- Their live text was checked equal (md5 of the body) to 20261117010000_workforce_attendance.sql before this file was written.
-- Rollback: see docs/WORKFORCE.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permission: who may open earlier dates of a zone's book
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description) values
  ('hr.attendance.configure', 'hr', 'attendance', 'configure', 'Open earlier dates of the attendance book for a zone (zonal setting)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'hr.attendance.configure'
 where r.code in ('admin', 'zonal_manager', 'hr_manager')
on conflict do nothing;
-- (The Zonal Assistant role keeps its fixed eight permissions; the Super Admin holds everything anyway.)

-- ---------------------------------------------------------------------
-- 2. The windows
-- ---------------------------------------------------------------------
create table if not exists public.wf_book_windows (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid not null references public.zones(id),
  month       date not null check (extract(day from month) = 1),
  date_from   date not null,
  date_to     date not null,
  open_until  date not null,
  note        text check (note is null or length(note) <= 500),
  ended_at    timestamptz,
  ended_by    uuid,
  end_note    text check (end_note is null or length(end_note) <= 500),
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  constraint wf_bw_range check (date_from <= date_to and date_trunc('month', date_from)::date = month and date_trunc('month', date_to)::date = month),
  constraint wf_bw_until check (open_until >= date_to)
);
-- one live window per zone and month (a new one ends the old one first)
create unique index if not exists wf_bw_one_live on public.wf_book_windows (zone_id, month) where ended_at is null;
create index if not exists wf_bw_zone_idx on public.wf_book_windows (zone_id, created_at desc);

create or replace trigger wf_book_windows_stamp before insert or update on public.wf_book_windows
  for each row execute function private.stamp_row();
create or replace trigger wf_book_windows_audit after insert or update or delete on public.wf_book_windows
  for each row execute function private.audit_row('hr');
create or replace trigger wf_book_windows_no_delete before delete on public.wf_book_windows
  for each row execute function private.prevent_delete();

alter table public.wf_book_windows enable row level security;
revoke all on public.wf_book_windows from anon, authenticated;
grant select on public.wf_book_windows to authenticated;
drop policy if exists wf_bw_read on public.wf_book_windows;
create policy wf_bw_read on public.wf_book_windows for select to authenticated
  using (private.has_permission('hr.attendance.configure', zone_id, null) or private.has_permission('hr.attendance.view', zone_id, null));

-- ---------------------------------------------------------------------
-- 3. Helpers (private)
-- ---------------------------------------------------------------------
-- The zone a person belongs to for the book: the hub's zone, else the person's own zone.
create or replace function private.wf_zone_of(p_hub uuid, p_zone uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((select h.zone_id from public.hubs h where h.id = p_hub), p_zone)
$$;

-- THE rule for "may this date be given now" for a person of zone p_zone (joining date aside):
--   the date has come, it is one of the book's days (from_day … to_day), and
--   either it is the current month while today is inside the book's days (the old rule),
--   or the zonal manager opened it for this zone and the window is still open (ended_at null, open_until today or later).
-- private.wf_grid repeats the same condition inline for speed: keep the two the same.
create or replace function private.wf_date_open(p_zone uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
       p_date <= private.wf_today()
   and extract(day from p_date)::integer between private.wf_from_day() and private.wf_to_day()
   and (   (date_trunc('month', p_date) = date_trunc('month', private.wf_today()) and private.wf_open())
        or exists (select 1 from public.wf_book_windows w
                    where w.zone_id = p_zone and w.ended_at is null and w.open_until >= private.wf_today()
                      and p_date between w.date_from and w.date_to)), false)
$$;

-- A window as the screens read it.
create or replace function private.wf_window_json(w public.wf_book_windows) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', w.id, 'zone_id', w.zone_id,
    'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = w.zone_id),
    'month', w.month, 'date_from', w.date_from, 'date_to', w.date_to, 'open_until', w.open_until, 'note', w.note,
    'state', case when w.ended_at is not null then 'ended' when w.open_until < private.wf_today() then 'expired' else 'open' end,
    'by_name', (select pr.full_name from public.profiles pr where pr.id = w.created_by), 'created_at', w.created_at,
    'ended_at', w.ended_at, 'ended_by_name', (select pr.full_name from public.profiles pr where pr.id = w.ended_by), 'end_note', w.end_note)
$$;

-- The live window of a zone for a month (null when none).
create or replace function private.wf_live_window(p_zone uuid, p_month date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.wf_window_json(w) from public.wf_book_windows w
   where p_zone is not null and w.zone_id = p_zone and w.month = date_trunc('month', p_month)::date
     and w.ended_at is null and w.open_until >= private.wf_today()
   order by w.created_at desc limit 1
$$;

-- ---------------------------------------------------------------------
-- 4. The existing rules, now with the windows
-- ---------------------------------------------------------------------
-- May this date be given now?  Raises a readable error when not.  (Same messages as before.)
create or replace function private.wf_check_date(p_date date, p_joining date) returns void
language plpgsql stable set search_path = '' as $$
declare v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day(); v_zone uuid;
begin
  if p_date is null then raise exception 'Choose the date — তারিখ বাছুন' using errcode = '22023'; end if;
  if p_date > v_today then raise exception 'A future date cannot be given yet — আগামী তারিখের হাজিরা এখন দেওয়া যায় না' using errcode = '22023'; end if;
  -- the caller's own zone decides which earlier dates the zonal manager opened for them
  select private.wf_zone_of(e.hub_id, e.zone_id) into v_zone from private.wf_me() e;
  if not private.wf_date_open(v_zone, p_date) then
    raise exception 'The attendance book is closed for % (it is open from day % to day % of the month) — হাজিরা বই বন্ধ', p_date, v_from, v_to using errcode = '22023';
  end if;
  if p_joining is not null and p_date < p_joining then
    raise exception 'This date is before the joining date — যোগদানের আগের তারিখ' using errcode = '22023';
  end if;
end $$;

-- THE one place that works out what a date looks like for a person (unchanged except: "missing" also inside an open window).
--   approved  = on the register (written by anyone) or an approved input
--   waiting   = given, waits for the manager        returned = the manager turned it down
--   future    = the date has not come               missing  = the date can be given now and nothing was given
--   closed    = the date cannot be given now (book closed, or before the joining date) and nothing was given
-- A withdrawn application's inputs count as nothing (the person took them back).
-- Scope is the caller's job: this function does not check permissions (it lives in private and is never granted to the API).
create or replace function private.wf_grid(p_from date, p_to date, p_hub uuid default null, p_employee uuid default null, p_all boolean default false)
returns table (employee_id uuid, work_date date, state text, mark_id uuid, mark_status text, kind text, applied_on_site boolean, note text,
               decided_as text, decide_note text, decided_by_name text, record_status text,
               application_id uuid, application_no text, application_status text)
language sql stable security definer set search_path = '' as $$
  with cfg as (select private.wf_today() as t, private.wf_from_day() as f, private.wf_to_day() as u),
  -- earlier dates a zonal manager opened, still open (same rule as private.wf_date_open)
  ow as (select w.zone_id, w.date_from, w.date_to from public.wf_book_windows w cross join cfg
          where w.ended_at is null and w.open_until >= cfg.t),
  emps as (
    select e.id, e.joining_date, coalesce(hz.zone_id, e.zone_id) as ez from public.employees e
    left join public.hubs hz on hz.id = e.hub_id
    where e.archived_at is null
      and (   (p_employee is not null and e.id = p_employee)
           or (p_employee is null and p_hub is not null and e.hub_id = p_hub
               and (e.status = 'active'
                    or exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date between p_from and p_to)
                    or exists (select 1 from public.attendance_self_marks m where m.employee_id = e.id and m.work_date between p_from and p_to)))
           or (p_employee is null and p_hub is null and p_all and e.status = 'active' and e.profile_id is not null))
  ),
  x as (
    select e.id as eid, e.joining_date as jd, e.ez, (p_from + g.i) as wd, r.status as rs, m.id as mid, m.status as ms, m.kind as mk,
           m.applied_on_site as mas, m.note as mn, m.decided_as as mda, m.decide_note as mdn, pr.full_name as mdb,
           a.id as aid, a.application_no as ano, a.status as ast,
           (m.id is not null and not (m.status = 'rejected' and coalesce(a.status, '') = 'cancelled')) as live
    from emps e
    cross join generate_series(0, greatest(p_to - p_from, -1)) as g(i)
    left join public.attendance_records r on r.employee_id = e.id and r.work_date = p_from + g.i
    left join public.attendance_self_marks m on m.employee_id = e.id and m.work_date = p_from + g.i
    left join public.wf_absence_applications a on a.id = m.application_id
    left join public.profiles pr on pr.id = m.decided_by
  )
  select x.eid, x.wd,
    case when x.rs is not null then 'approved'
         when x.live and x.ms = 'waiting' then 'waiting'
         when x.live and x.ms = 'approved' then 'approved'
         when x.live and x.ms = 'rejected' then 'returned'
         when x.wd > c.t then 'future'
         when (x.jd is null or x.wd >= x.jd)
              and extract(day from x.wd)::integer between c.f and c.u
              and (   (date_trunc('month', x.wd) = date_trunc('month', c.t) and extract(day from c.t)::integer between c.f and c.u)
                   or exists (select 1 from ow where ow.zone_id = x.ez and x.wd between ow.date_from and ow.date_to)) then 'missing'
         else 'closed' end,
    case when x.live then x.mid end, case when x.live then x.ms end, case when x.live then x.mk end,
    case when x.live then x.mas end, case when x.live then x.mn end, case when x.live then x.mda end,
    case when x.live then x.mdn end, case when x.live then x.mdb end,
    x.rs, x.aid, x.ano, x.ast
  from x cross join cfg c
$$;

-- One call loads a staff member's whole book for a month (any month: past months are the archive, unless a window opened them).
create or replace function public.wf_my_book(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day();
  v_month date; v_last integer; v_open boolean; v_d1 date; v_d2 date; v_days jsonb; v_codes text[]; v_apps jsonb; v_months jsonb;
  v_zone uuid; v_win jsonb; v_openm jsonb;
begin
  if auth.uid() is null then return null; end if;
  e := private.wf_me();
  if e.id is null then return null; end if;
  v_zone := private.wf_zone_of(e.hub_id, e.zone_id);
  v_month := date_trunc('month', coalesce(p_month, v_today))::date;
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_win := private.wf_live_window(v_zone, v_month);
  v_open := (v_month = date_trunc('month', v_today)::date and extract(day from v_today)::integer between v_from and v_to) or v_win is not null;
  v_d1 := v_month + (least(v_from, v_last) - 1);
  v_d2 := v_month + (least(v_to, v_last) - 1);
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', g.work_date, 'day', extract(day from g.work_date)::integer, 'dow', extract(dow from g.work_date)::integer, 'state', g.state,
           'kind', g.kind, 'applied_on_site', g.applied_on_site, 'note', g.note, 'mark_id', g.mark_id,
           'decided_as', g.decided_as, 'decide_note', g.decide_note, 'decided_by_name', g.decided_by_name, 'record_status', g.record_status,
           'application_id', g.application_id, 'application_no', g.application_no, 'application_status', g.application_status,
           'can_give', private.wf_date_open(v_zone, g.work_date) and (e.joining_date is null or g.work_date >= e.joining_date)) order by g.work_date), '[]'::jsonb),
         coalesce(array_agg(private.wf_cell(g.state, g.record_status) order by g.work_date), '{}'::text[])
    into v_days, v_codes
    from private.wf_grid(v_d1, v_d2, null, e.id) g;
  select coalesce(jsonb_agg(private.wf_app_json(a) order by a.created_at desc, a.application_no desc), '[]'::jsonb) into v_apps
    from public.wf_absence_applications a where a.employee_id = e.id and a.month = v_month;
  select coalesce(jsonb_agg(m.mm order by m.mm desc), '[]'::jsonb) into v_months from (
    select date_trunc('month', v_today)::date as mm
    union select date_trunc('month', x.work_date)::date from public.attendance_self_marks x where x.employee_id = e.id
    union select date_trunc('month', r.work_date)::date from public.attendance_records r where r.employee_id = e.id
    union select a.month from public.wf_absence_applications a where a.employee_id = e.id
    union select w.month from public.wf_book_windows w where w.zone_id = v_zone and w.ended_at is null and w.open_until >= v_today) m;
  -- the months in which something can be given right now (this month while its book is open, and every open window)
  select coalesce(jsonb_agg(m.mm order by m.mm desc), '[]'::jsonb) into v_openm from (
    select date_trunc('month', v_today)::date as mm where private.wf_open()
    union select w.month from public.wf_book_windows w where w.zone_id = v_zone and w.ended_at is null and w.open_until >= v_today) m;
  return jsonb_build_object(
    'employee', jsonb_build_object('id', e.id, 'code', e.employee_code::text, 'name', e.full_name,
       'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
       'hub_id', e.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = e.hub_id),
       'zone_id', coalesce(e.zone_id, private.hub_zone(e.hub_id)),
       'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = coalesce(e.zone_id, private.hub_zone(e.hub_id)))),
    'month', v_month, 'today', v_today, 'window', jsonb_build_object('from_day', v_from, 'to_day', v_to), 'open', v_open,
    'catch_up', v_win, 'open_months', v_openm,
    'days', v_days, 'summary', private.wf_summary(v_codes), 'applications', v_apps, 'months', v_months);
end $$;

-- Everyone of the hub across the month's window (the month archive is the same call for a past month).
create or replace function public.wf_hub_book(p_hub uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day();
  v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_last integer; v_d1 date; v_d2 date;
  v_open boolean; v_dates jsonb; v_people jsonb; v_all text[]; v_win jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_win := private.wf_live_window(private.wf_zone_of(p_hub, null), v_month);
  v_open := (v_month = date_trunc('month', v_today)::date and extract(day from v_today)::integer between v_from and v_to) or v_win is not null;
  v_d1 := v_month + (least(v_from, v_last) - 1);
  v_d2 := v_month + (least(v_to, v_last) - 1);
  select coalesce(jsonb_agg(v_d1 + i order by i), '[]'::jsonb) into v_dates from generate_series(0, v_d2 - v_d1) i;
  with g as (select * from private.wf_grid(v_d1, v_d2, p_hub)),
  per as (
    select g.employee_id, array_agg(private.wf_cell(g.state, g.record_status) order by g.work_date) as codes,
           jsonb_agg(jsonb_build_object('s', private.wf_cell(g.state, g.record_status), 'k', g.kind, 'a', g.applied_on_site, 'id', g.mark_id) order by g.work_date) as cells
    from g group by g.employee_id)
  select (select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name,
                   'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
                   'cells', per.cells, 'summary', private.wf_summary(per.codes)) order by e.full_name), '[]'::jsonb)
            from per join public.employees e on e.id = per.employee_id),
         (select coalesce(array_agg(c), '{}'::text[]) from per cross join lateral unnest(per.codes) c)
    into v_people, v_all;
  return jsonb_build_object('hub', private.wf_hub_json(p_hub), 'month', v_month, 'today', v_today,
    'window', jsonb_build_object('from_day', v_from, 'to_day', v_to), 'open', v_open, 'catch_up', v_win, 'can', private.wf_can(p_hub),
    'dates', v_dates, 'people', v_people, 'totals', private.wf_summary(v_all));
end $$;

-- The small alert numbers (personal menu, staff panel, dashboard, bell). "open" still means: today's book is open.
-- mine.missing_days / returned_days now also count the dates of an open window; mine.catch_up_until = its last day (or null).
create or replace function public.wf_pending_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_open boolean := private.wf_open(); v_from integer := private.wf_from_day();
  v_month date := date_trunc('month', private.wf_today())::date;
  v_mine jsonb; v_manage jsonb; v_missing integer := 0; v_returned integer := 0; v_waiting integer; v_apps integer; v_exp boolean; v_sub boolean;
  v_hubs uuid[]; v_nohub boolean; v_ophubs uuid[]; v_opnohub boolean; v_mw integer; v_ap integer; v_om integer := 0;
  v_zone uuid; v_wfrom date; v_wuntil date; v_lo date;
begin
  if auth.uid() is null then return jsonb_build_object('today', v_today, 'open', v_open, 'mine', null, 'manage', null); end if;
  e := private.wf_me();
  if e.id is not null then
    v_zone := private.wf_zone_of(e.hub_id, e.zone_id);
    select min(w.date_from), max(w.open_until) into v_wfrom, v_wuntil from public.wf_book_windows w
     where w.zone_id = v_zone and w.ended_at is null and w.open_until >= v_today;
    v_lo := least(case when v_open then v_month + (v_from - 1) end, v_wfrom);   -- least() skips a null
    if v_lo is not null then
      select count(*) filter (where g.state = 'missing'), count(*) filter (where g.state = 'returned') into v_missing, v_returned
        from private.wf_grid(v_lo, v_today, null, e.id) g
       where private.wf_date_open(v_zone, g.work_date);
    end if;
    select count(*) into v_waiting from public.attendance_self_marks m
     where m.employee_id = e.id and m.status = 'waiting'
       and not exists (select 1 from public.attendance_records r where r.employee_id = m.employee_id and r.work_date = m.work_date);
    select count(*) into v_apps from public.wf_absence_applications a where a.employee_id = e.id and a.status = 'pending';
    select exists (select 1 from public.wf_daily_ops o where o.employee_id = e.id and o.work_date between v_today - 14 and v_today),
           exists (select 1 from public.wf_daily_ops o where o.employee_id = e.id and o.work_date = v_today)
      into v_exp, v_sub;
    v_mine := jsonb_build_object('missing_days', v_missing, 'returned_days', v_returned, 'waiting_days', v_waiting, 'applications_pending', v_apps,
                                 'ops_expected', v_exp, 'ops_submitted_today', v_sub, 'catch_up_until', v_wuntil);
  end if;
  v_hubs := array(select w.hub_id from private.wf_hubs('hr.attendance.create') w);
  v_nohub := private.has_permission('hr.attendance.create');
  if cardinality(v_hubs) > 0 or v_nohub then
    select count(*) into v_mw from public.attendance_self_marks m join public.employees x on x.id = m.employee_id
     where m.status = 'waiting' and x.archived_at is null and (x.hub_id = any (v_hubs) or (v_nohub and x.hub_id is null)) and x.profile_id is distinct from auth.uid();
    select count(*) into v_ap from public.wf_absence_applications a join public.employees x on x.id = a.employee_id
     where a.status = 'pending' and x.archived_at is null and (x.hub_id = any (v_hubs) or (v_nohub and x.hub_id is null)) and x.profile_id is distinct from auth.uid();
    v_ophubs := array(select w.hub_id from private.wf_hubs('ops.staff_daily.view') w);
    v_opnohub := private.has_permission('ops.staff_daily.view');
    if cardinality(v_ophubs) > 0 or v_opnohub then
      select count(*) into v_om from private.wf_ops_missing(v_today, v_ophubs, v_opnohub);
    end if;
    v_manage := jsonb_build_object('marks_waiting', v_mw, 'applications_pending', v_ap, 'ops_missing_today', v_om);
  end if;
  return jsonb_build_object('today', v_today, 'open', v_open, 'mine', v_mine, 'manage', v_manage);
end $$;

-- ---------------------------------------------------------------------
-- 5. Staff: many dates in one step
-- ---------------------------------------------------------------------
-- p_present: "উপস্থিত ছিলাম"; p_site: "উপস্থিত ছিলাম না — Steadfast ওয়েবসাইটে আবেদন করেছি"; p_absent: not applied -> one application
-- with p_reason. All or nothing; each date goes through the same function the one-date path uses, and an error names its date
-- ("On 2026-11-05: …"). Returns how many of each were saved and the new application's id.
create or replace function public.wf_book_fill(p_present date[] default null, p_site date[] default null, p_absent date[] default null,
                                               p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_p date[]; v_s date[]; v_a date[]; v_all date[]; d date; v_app uuid; v_older integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then raise exception 'No active staff profile is linked to your login — আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf:' || e.id::text, 0));   -- the same lock as the one-date path (re-entrant here)
  select coalesce(array_agg(distinct x order by x), '{}') into v_p from unnest(coalesce(p_present, '{}'::date[])) x where x is not null;
  select coalesce(array_agg(distinct x order by x), '{}') into v_s from unnest(coalesce(p_site, '{}'::date[])) x where x is not null;
  select coalesce(array_agg(distinct x order by x), '{}') into v_a from unnest(coalesce(p_absent, '{}'::date[])) x where x is not null;
  v_all := v_p || v_s || v_a;
  if cardinality(v_all) = 0 then raise exception 'Choose at least one date — অন্তত একটি তারিখ বাছুন' using errcode = '22023'; end if;
  if cardinality(v_all) > 62 then raise exception 'Too many dates at once (at most 62) — একসাথে সর্বোচ্চ ৬২টি তারিখ' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(v_all) x) <> cardinality(v_all) then
    raise exception 'A date is chosen twice — একই তারিখ দুই জায়গায় বাছা হয়েছে' using errcode = '22023';
  end if;
  if cardinality(v_a) > 0 and private.wf_clean(p_reason) is null then
    raise exception 'Write the reason for the absence (reason is required) — কারণ লিখুন' using errcode = '22023';
  end if;
  begin
    foreach d in array v_p loop perform public.wf_att_submit(d, 'present'); end loop;
    foreach d in array v_s loop perform public.wf_att_submit(d, 'absent', true, p_note); end loop;
    d := null;
    if cardinality(v_a) > 0 then v_app := public.wf_absence_apply(v_a, p_reason); end if;
  exception when others then
    if d is null then raise; end if;
    raise exception 'On %: %', d, sqlerrm using errcode = sqlstate;
  end;
  -- one note to the hub's managers for older dates (today's date already told them, and an application tells them itself)
  v_older := (select count(*) from unnest(v_p || v_s) x where x < private.wf_today());
  if v_older > 0 and e.hub_id is not null then
    perform private.att_notify_hub(e.hub_id, 'আগের তারিখের হাজিরা অনুমোদন বাকি',
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || ' · ' || v_older || ' দিনের হাজিরা একসাথে দিয়েছেন', '/app/workforce/hub');
  end if;
  return jsonb_build_object('present', cardinality(v_p), 'site', cardinality(v_s), 'absent', cardinality(v_a), 'application_id', v_app);
end $$;

-- ---------------------------------------------------------------------
-- 6. Zonal setting: open / close earlier dates for a zone
-- ---------------------------------------------------------------------
create or replace function public.wf_window_save(p_zone uuid, p_from date, p_to date, p_until date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_f integer := private.wf_from_day(); v_t integer := private.wf_to_day();
  v_note text := private.wf_clean(p_note); v_month date; w public.wf_book_windows; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_zone is null then raise exception 'Choose a zone — জোন বাছুন' using errcode = '22023'; end if;
  if not exists (select 1 from public.zones z where z.id = p_zone and z.archived_at is null) then
    raise exception 'Zone not found — জোন পাওয়া যায়নি' using errcode = 'P0002';
  end if;
  if not private.has_permission('hr.attendance.configure', p_zone, null) then
    raise exception 'You may not open the attendance book of this zone — এই জোনের হাজিরা বই খোলার অনুমতি আপনার নেই' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then raise exception 'Choose the first and the last date — প্রথম ও শেষ তারিখ বাছুন' using errcode = '22023'; end if;
  if p_from > p_to then raise exception 'The first date is after the last date — প্রথম তারিখ শেষ তারিখের পরে হয়ে গেছে' using errcode = '22023'; end if;
  if date_trunc('month', p_from) <> date_trunc('month', p_to) then
    raise exception 'Open one month at a time — একবারে এক মাসের তারিখ খুলুন' using errcode = '22023';
  end if;
  if p_to > v_today then raise exception 'Only dates that have come can be opened — আগামী তারিখ খোলা যায় না' using errcode = '22023'; end if;
  if extract(day from p_from)::integer < v_f or extract(day from p_to)::integer > v_t then
    raise exception 'Only the book''s days % to % can be opened — শুধু বইয়ের %–% তারিখ খোলা যায়', v_f, v_t, v_f, v_t using errcode = '22023';
  end if;
  if p_from < (date_trunc('month', v_today) - interval '2 months')::date then
    raise exception 'At most two months back — দুই মাসের বেশি আগের তারিখ খোলা যায় না' using errcode = '22023';
  end if;
  if p_until is null or p_until < v_today then
    raise exception 'The last day to give must be today or later — শেষ দিন আজ বা তার পরের কোনো দিন দিন' using errcode = '22023';
  end if;
  if p_until > v_today + 31 then raise exception 'At most 31 days from today — আজ থেকে সর্বোচ্চ ৩১ দিন খোলা রাখা যায়' using errcode = '22023'; end if;
  v_month := date_trunc('month', p_from)::date;
  perform pg_advisory_xact_lock(hashtextextended('wfw:' || p_zone::text || ':' || v_month::text, 0));
  select * into w from public.wf_book_windows x where x.zone_id = p_zone and x.month = v_month and x.ended_at is null for update;
  if w.id is not null and w.date_from = p_from and w.date_to = p_to and w.open_until = p_until and w.note is not distinct from v_note then
    return w.id;   -- the same setting twice changes nothing
  end if;
  if w.id is not null then
    update public.wf_book_windows set ended_at = now(), ended_by = auth.uid(), end_note = 'নতুন সেটিং দিয়ে বদলানো হয়েছে' where id = w.id;
  end if;
  insert into public.wf_book_windows (zone_id, month, date_from, date_to, open_until, note)
  values (p_zone, v_month, p_from, p_to, p_until, v_note) returning id into v_id;
  -- tell the zone's staff who still have dates to give (they also get the daily reminder until the window ends)
  insert into public.notifications (profile_id, title, body, link, kind)
  select e.profile_id, 'আগের তারিখের হাজিরা দিন',
         x.n || ' দিনের হাজিরা বাকি — ' || to_char(p_until, 'DD/MM/YYYY') || ' পর্যন্ত হাজিরা বইয়ে একসাথে দিয়ে দিন।', '/app/workforce/attendance', 'workforce'
  from (select g.employee_id, count(*) as n from private.wf_grid(p_from, p_to, null, null, true) g
          join public.employees e2 on e2.id = g.employee_id
         where private.wf_zone_of(e2.hub_id, e2.zone_id) = p_zone and g.state in ('missing', 'returned')
         group by g.employee_id) x
  join public.employees e on e.id = x.employee_id
  join public.profiles pr on pr.id = e.profile_id and pr.status = 'active' and pr.archived_at is null;
  return v_id;
end $$;

create or replace function public.wf_window_end(p_window uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.wf_book_windows; v_note text := private.wf_clean(p_note);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into w from public.wf_book_windows x where x.id = p_window for update;
  if w.id is null then raise exception 'Not found — পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', w.zone_id, null) then
    raise exception 'You may not open the attendance book of this zone — এই জোনের হাজিরা বই খোলার অনুমতি আপনার নেই' using errcode = '42501';
  end if;
  if w.ended_at is not null then return; end if;   -- already closed
  update public.wf_book_windows set ended_at = now(), ended_by = auth.uid(), end_note = coalesce(v_note, 'বন্ধ করা হয়েছে') where id = w.id;
end $$;

-- The zonal setting page: the zones the caller may set, the windows (open ones first, then the last 30) and how far each one got.
create or replace function public.wf_windows(p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.wf_today(); v_zones jsonb; v_rows jsonb; v_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select array_agg(z.id) into v_ids from public.zones z
   where z.archived_at is null and (p_zone is null or z.id = p_zone)
     and (private.has_permission('hr.attendance.configure', z.id, null) or private.has_permission('hr.attendance.view', z.id, null));
  if p_zone is not null and v_ids is null then
    raise exception 'You may not see this zone — এই জোনের তথ্য দেখার অনুমতি নেই' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', coalesce(nullif(z.name_bn, ''), z.name),
           'can_configure', private.has_permission('hr.attendance.configure', z.id, null)) order by z.name), '[]'::jsonb)
    into v_zones from public.zones z where z.id = any (coalesce(v_ids, '{}'));
  with w as (
    select x as r, x.id, x.zone_id, x.date_from, x.date_to, x.created_at, (x.ended_at is null and x.open_until >= v_today) as live
      from public.wf_book_windows x where x.zone_id = any (coalesce(v_ids, '{}'))
     order by (x.ended_at is null and x.open_until >= v_today) desc, x.created_at desc limit 30),
  prog as (   -- for an open window: the zone's staff with a login, and how many dates are still to give / wait for the manager
    select w.id, count(distinct g.employee_id) as people,
           count(distinct g.employee_id) filter (where g.state in ('missing', 'returned')) as people_left,
           count(*) filter (where g.state in ('missing', 'returned')) as days_left,
           count(*) filter (where g.state = 'waiting') as days_waiting
    from w cross join lateral private.wf_grid(w.date_from, w.date_to, null, null, true) g
    join public.employees e on e.id = g.employee_id and private.wf_zone_of(e.hub_id, e.zone_id) = w.zone_id
    where w.live group by w.id)
  select coalesce(jsonb_agg(private.wf_window_json(w.r) || jsonb_build_object('people', p.people, 'people_left', p.people_left,
           'days_left', p.days_left, 'days_waiting', p.days_waiting)
           order by w.live desc, w.created_at desc), '[]'::jsonb)
    into v_rows
    from w left join prog p on p.id = w.id;
  return jsonb_build_object('today', v_today,
    'window', jsonb_build_object('from_day', private.wf_from_day(), 'to_day', private.wf_to_day()),
    'earliest', (date_trunc('month', v_today) - interval '2 months')::date, 'latest_until', v_today + 31,
    'zones', v_zones, 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------------
-- 7. Reminders: the old ones, plus one while a window is open (once per person per Dhaka day)
-- ---------------------------------------------------------------------
create or replace function private.wf_remind() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_day0 timestamptz := (private.wf_today()::timestamp at time zone 'Asia/Dhaka');
  v_month date := date_trunc('month', private.wf_today())::date; v_from integer := private.wf_from_day();
  v_n integer := 0; v_c integer; h record; u uuid; v_w integer; v_a integer; v_since date := (date_trunc('month', private.wf_today()) - interval '1 month')::date; v_title text;
  v_wlo date;
begin
  if private.wf_open() then
    -- today's date is still missing
    insert into public.notifications (profile_id, title, body, link, kind)
    select e.profile_id, 'আজকের হাজিরা বাকি', 'আজকের হাজিরা এখনো দেওয়া হয়নি — হাজিরা বইয়ে এক ট্যাপে দিয়ে দিন।', '/app/workforce/attendance', 'workforce'
    from (select distinct g.employee_id from private.wf_grid(v_today, v_today, null, null, true) g where g.state = 'missing') x
    join public.employees e on e.id = x.employee_id
    join public.profiles pr on pr.id = e.profile_id and pr.status = 'active' and pr.archived_at is null
    where not exists (select 1 from public.notifications n where n.profile_id = e.profile_id and n.kind = 'workforce'
                        and n.title = 'আজকের হাজিরা বাকি' and n.created_at >= v_day0);
    get diagnostics v_c = row_count; v_n := v_n + v_c;
    -- dates the manager sent back
    insert into public.notifications (profile_id, title, body, link, kind)
    select e.profile_id, 'ফেরত দেওয়া হাজিরা আবার দিন', x.n || ' দিনের হাজিরা ম্যানেজার ফেরত দিয়েছেন — কারণ দেখে আবার দিন।', '/app/workforce/attendance', 'workforce'
    from (select g.employee_id, count(*) as n from private.wf_grid(v_month + (v_from - 1), v_today, null, null, true) g where g.state = 'returned' group by g.employee_id) x
    join public.employees e on e.id = x.employee_id
    join public.profiles pr on pr.id = e.profile_id and pr.status = 'active' and pr.archived_at is null
    where not exists (select 1 from public.notifications n where n.profile_id = e.profile_id and n.kind = 'workforce'
                        and n.title = 'ফেরত দেওয়া হাজিরা আবার দিন' and n.created_at >= v_day0);
    get diagnostics v_c = row_count; v_n := v_n + v_c;
  end if;
  -- earlier dates a zonal manager opened: who still has some to give (missing or returned) inside an open window of their zone
  select min(w.date_from) into v_wlo from public.wf_book_windows w where w.ended_at is null and w.open_until >= v_today;
  if v_wlo is not null then
    insert into public.notifications (profile_id, title, body, link, kind)
    select e.profile_id, 'আগের তারিখের হাজিরা বাকি',
           x.n || ' দিনের হাজিরা এখনো দেওয়া হয়নি — ' || to_char(x.until, 'DD/MM/YYYY') || ' পর্যন্ত হাজিরা বইয়ে একসাথে দিয়ে দিন।',
           '/app/workforce/attendance', 'workforce'
    from (select g.employee_id, count(*) as n, max(w.open_until) as until
            from private.wf_grid(v_wlo, v_today, null, null, true) g
            join public.employees e2 on e2.id = g.employee_id
            join public.wf_book_windows w on w.zone_id = private.wf_zone_of(e2.hub_id, e2.zone_id) and w.ended_at is null and w.open_until >= v_today
                                         and g.work_date between w.date_from and w.date_to
           where g.state in ('missing', 'returned')
           group by g.employee_id) x
    join public.employees e on e.id = x.employee_id
    join public.profiles pr on pr.id = e.profile_id and pr.status = 'active' and pr.archived_at is null
    where not exists (select 1 from public.notifications n where n.profile_id = e.profile_id and n.kind = 'workforce'
                        and n.title in ('আগের তারিখের হাজিরা বাকি', 'আগের তারিখের হাজিরা দিন') and n.created_at >= v_day0);
    get diagnostics v_c = row_count; v_n := v_n + v_c;
  end if;
  -- the four numbers: people who send them every day but not yet today (the numbers are daily, so this is not tied to the book window)
  insert into public.notifications (profile_id, title, body, link, kind)
  select e.profile_id, 'আজকের সংখ্যা বাকি', 'আজকের পিকআপ, পিকআপ রিটার্ন, ডেলিভারি ও ডেলিভারি রিটার্নের সংখ্যা এখনো দেওয়া হয়নি।', '/app/workforce/attendance', 'workforce'
  from private.wf_ops_missing(v_today, null, false, true) x
  join public.employees e on e.id = x.employee_id
  join public.profiles pr on pr.id = e.profile_id and pr.status = 'active' and pr.archived_at is null
  where not exists (select 1 from public.notifications n where n.profile_id = e.profile_id and n.kind = 'workforce'
                      and n.title = 'আজকের সংখ্যা বাকি' and n.created_at >= v_day0);
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  -- one digest per hub manager while something waits for them
  for h in
    select e.hub_id from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
     where m.status = 'waiting' and m.work_date >= v_since and e.hub_id is not null and e.archived_at is null
    union
    select e.hub_id from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
     where a.status = 'pending' and a.month >= v_since and e.hub_id is not null and e.archived_at is null
  loop
    select 'অনুমোদনের জন্য অপেক্ষায়: ' || coalesce(x.name_bn, x.name) into v_title from public.hubs x where x.id = h.hub_id;
    for u in select * from private.wf_hub_managers(h.hub_id) loop
      select count(*) into v_w from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
       where m.status = 'waiting' and m.work_date >= v_since and e.hub_id = h.hub_id and e.archived_at is null and e.profile_id is distinct from u;
      select count(*) into v_a from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
       where a.status = 'pending' and a.month >= v_since and e.hub_id = h.hub_id and e.archived_at is null and e.profile_id is distinct from u;
      if v_w + v_a > 0 and not exists (select 1 from public.notifications n where n.profile_id = u and n.kind = 'workforce'
                                         and n.title = v_title and n.created_at >= v_day0) then
        insert into public.notifications (profile_id, title, body, link, kind)
        values (u, v_title, v_w || ' টি হাজিরা ও ' || v_a || ' টি অনুপস্থিতির আবেদন আপনার সিদ্ধান্তের অপেক্ষায়।', '/app/workforce/hub', 'workforce');
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 8. Who may call what (same rule as the module): public wf_* for signed-in people only; private helpers for the functions only.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, n.nspname as ns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.proname like 'wf\_%' loop
    if f.ns = 'public' then
      execute format('revoke all on function %s from public, anon', f.sig);
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
