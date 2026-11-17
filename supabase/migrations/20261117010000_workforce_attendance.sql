-- =====================================================================
--  My Workforce & Attendance (আমার লোক ও উপস্থিতি)
--
--  The owner's spec in short: a monthly attendance book (open on days 1-17) where every staff member / rider gives each
--  date on their own ("উপস্থিত ছিলাম" / "উপস্থিত ছিলাম না" -> "ওয়েবসাইটে আবেদন করেছেন কি?" -> an application with the dates),
--  four direct daily numbers (Today's Pickup / Pickup Return / Delivery / Delivery Return) stored by date, user, hub and zone,
--  a manager panel (own hub) and a zonal panel (all hubs), with role based access, duplicate prevention, pending alerts,
--  correction history, real time updates, a month archive and manager approval / application tracking.
--
--  Nothing is stored twice:
--    * the staff member's per-date input is a row of the EXISTING attendance_self_marks (4 columns added); the manager approves it
--      with the EXISTING att_self_decide (not touched), which writes the EXISTING attendance_records;
--    * new tables only for what did not exist: wf_absence_applications, wf_daily_ops and the two append-only history tables;
--    * every panel reads the same tables through role-scoped functions (private.wf_hubs decides which hubs a caller may see).
--
--  Additive only. Rollback (in this order):
--    select cron.unschedule('wf-remind');                                   -- only where pg_cron exists
--    alter publication supabase_realtime drop table public.wf_daily_ops, public.wf_absence_applications,
--      public.attendance_self_marks, public.attendance_records;             -- only where it was added
--    drop function public.wf_* and private.wf_*  (select oid::regprocedure from pg_proc where proname like 'wf\_%');
--    drop trigger att_self_wf_before / att_self_wf_after on public.attendance_self_marks;
--    drop table public.wf_ops_history, public.wf_att_history, public.wf_daily_ops;
--    alter table public.attendance_self_marks drop column application_id, drop column applied_on_site, drop column zone_id, drop column via;
--    drop table public.wf_absence_applications; drop sequence public.wf_absence_no_seq;
--    delete from public.role_permissions / public.permissions where code like 'ops.staff_daily.%'; delete from public.system_settings where key like 'workforce.%';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Settings and permissions
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('workforce.book_from_day',     '1',  'Attendance book: first day of the month on which a date can be given'),
  ('workforce.book_to_day',       '17', 'Attendance book: last day of the month on which a date can be given'),
  ('workforce.ops_backdate_days', '1',  'Daily numbers: how many days back a person may still fill or change their own numbers')
on conflict (key) do nothing;

insert into public.permissions (code, module, resource, action, description) values
  ('ops.staff_daily.view', 'ops', 'staff_daily', 'view', 'See the staff''s daily pickup / pickup return / delivery / delivery return numbers'),
  ('ops.staff_daily.edit', 'ops', 'staff_daily', 'edit', 'Correct a staff member''s daily numbers (a note is required)')
on conflict (code) do nothing;

-- (zonal_assistant is left out on purpose: tests/99x_attendance_gaps.sql pins that role at exactly its eight permissions;
--  the Super Admin can add the view right to it in the role builder.)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'ops.staff_daily.view'
where r.code in ('admin', 'head_office_manager', 'operations_manager', 'zonal_manager', 'hub_manager',
                 'pickup_manager', 'delivery_manager', 'auditor', 'hr_manager')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'ops.staff_daily.edit'
where r.code in ('admin', 'hub_manager')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create sequence if not exists public.wf_absence_no_seq;
revoke all on sequence public.wf_absence_no_seq from anon, authenticated;

-- An absence application: the dates a person was / will be absent and the reason. Its dates are rows of attendance_self_marks
-- (application_id), so approval goes through the same att_self_decide the manager already uses.
create table if not exists public.wf_absence_applications (
  id             uuid primary key default gen_random_uuid(),
  application_no text not null unique,
  employee_id    uuid not null references public.employees(id),
  hub_id         uuid references public.hubs(id),
  zone_id        uuid references public.zones(id),
  month          date not null check (extract(day from month) = 1),
  dates          date[] not null check (cardinality(dates) between 1 and 31),
  reason         text not null check (length(trim(reason)) > 0),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(), created_by uuid,
  updated_at     timestamptz not null default now(), updated_by uuid,
  constraint wf_app_reject_note check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) > 0),
  constraint wf_app_cancel_when check ((status = 'cancelled') = (cancelled_at is not null))
);
create index if not exists wf_absence_employee_idx on public.wf_absence_applications (employee_id, month);
create index if not exists wf_absence_hub_idx on public.wf_absence_applications (hub_id, status);
create index if not exists wf_absence_zone_idx on public.wf_absence_applications (zone_id);
create index if not exists wf_absence_pending_idx on public.wf_absence_applications (employee_id) where status = 'pending';

-- The staff member's per-date input gets four columns; nothing else about the table changes.
alter table public.attendance_self_marks
  add column if not exists zone_id uuid references public.zones(id),
  add column if not exists applied_on_site boolean,
  add column if not exists application_id uuid references public.wf_absence_applications(id),
  add column if not exists via text not null default 'today';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'att_self_via_check') then
    alter table public.attendance_self_marks add constraint att_self_via_check check (via in ('today', 'book'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'att_self_site_kind') then
    alter table public.attendance_self_marks add constraint att_self_site_kind check (kind = 'absent' or (applied_on_site is null and application_id is null));
  end if;
end $$;
create index if not exists att_self_zone_idx on public.attendance_self_marks (zone_id);
create index if not exists att_self_application_idx on public.attendance_self_marks (application_id);
-- inputs already given get their zone from the hub (before the new triggers exist, so no history noise)
update public.attendance_self_marks m set zone_id = h.zone_id from public.hubs h where h.id = m.hub_id and m.zone_id is null;

-- The four daily numbers: one row per person per date.
create table if not exists public.wf_daily_ops (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id),
  hub_id           uuid references public.hubs(id),
  zone_id          uuid references public.zones(id),
  work_date        date not null,
  pickup           integer not null default 0 check (pickup between 0 and 100000),
  pickup_return    integer not null default 0 check (pickup_return between 0 and 100000),
  delivery         integer not null default 0 check (delivery between 0 and 100000),
  delivery_return  integer not null default 0 check (delivery_return between 0 and 100000),
  note             text,
  revision         integer not null default 1 check (revision >= 1),
  created_at       timestamptz not null default now(), created_by uuid,
  updated_at       timestamptz not null default now(), updated_by uuid,
  unique (employee_id, work_date)
);
create index if not exists wf_daily_ops_hub_day_idx on public.wf_daily_ops (hub_id, work_date);
create index if not exists wf_daily_ops_zone_day_idx on public.wf_daily_ops (zone_id, work_date);
create index if not exists wf_daily_ops_day_idx on public.wf_daily_ops (work_date);

-- Append-only histories (written by triggers, read through functions).
create table if not exists public.wf_att_history (
  id          uuid primary key default gen_random_uuid(),
  mark_id     uuid references public.attendance_self_marks(id),
  employee_id uuid not null references public.employees(id),
  hub_id      uuid references public.hubs(id),
  work_date   date not null,
  action      text not null check (action in ('submitted', 'edited', 'resubmitted', 'approved', 'returned', 'corrected', 'cancelled')),
  from_kind   text, to_kind text, from_status text, to_status text, from_as text, to_as text,
  note        text,
  by_user     uuid,
  at          timestamptz not null default clock_timestamp()   -- real event order, even for several changes in one transaction
);
create index if not exists wf_att_history_mark_idx on public.wf_att_history (mark_id);
create index if not exists wf_att_history_employee_idx on public.wf_att_history (employee_id, work_date);
create index if not exists wf_att_history_hub_idx on public.wf_att_history (hub_id, at desc);

create table if not exists public.wf_ops_history (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.wf_daily_ops(id),
  revision   integer not null,
  action     text not null check (action in ('submitted', 'edited', 'corrected')),
  from_vals  jsonb,
  to_vals    jsonb not null,
  note       text,
  by_user    uuid,
  at         timestamptz not null default clock_timestamp()
);
create index if not exists wf_ops_history_entry_idx on public.wf_ops_history (entry_id, revision);

-- ---------------------------------------------------------------------
-- 2. Small helpers (private)
-- ---------------------------------------------------------------------
-- The business date is always the Dhaka date, never the server's current_date.
create or replace function private.wf_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Dhaka')::date $$;

create or replace function private.wf_int(p_key text, p_default integer, p_min integer, p_max integer) returns integer
language sql stable security definer set search_path = '' as $$
  select greatest(p_min, least(p_max, coalesce(
    (select case when (s.value #>> '{}') ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::integer end from public.system_settings s where s.key = p_key),
    p_default)))
$$;
create or replace function private.wf_from_day() returns integer language sql stable set search_path = '' as
  $$ select private.wf_int('workforce.book_from_day', 1, 1, 28) $$;
create or replace function private.wf_to_day() returns integer language sql stable set search_path = '' as
  $$ select greatest(private.wf_from_day(), private.wf_int('workforce.book_to_day', 17, 1, 31)) $$;
create or replace function private.wf_backdate() returns integer language sql stable set search_path = '' as
  $$ select private.wf_int('workforce.ops_backdate_days', 1, 0, 30) $$;
-- Is the book of the current month open today?
create or replace function private.wf_open() returns boolean language sql stable set search_path = '' as
  $$ select extract(day from private.wf_today())::integer between private.wf_from_day() and private.wf_to_day() $$;

-- The caller's own active staff profile (null row when there is none).
create or replace function private.wf_me() returns public.employees
language sql stable security definer set search_path = '' as $$
  select e.* from public.employees e where e.profile_id = auth.uid() and auth.uid() is not null and e.archived_at is null and e.status = 'active' limit 1
$$;

-- May this date be given by the person now?  Raises a readable error when not.
create or replace function private.wf_check_date(p_date date, p_joining date) returns void
language plpgsql stable set search_path = '' as $$
declare v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day();
begin
  if p_date is null then raise exception 'Choose the date — তারিখ বাছুন' using errcode = '22023'; end if;
  if p_date > v_today then raise exception 'A future date cannot be given yet — আগামী তারিখের হাজিরা এখন দেওয়া যায় না' using errcode = '22023'; end if;
  if date_trunc('month', p_date) <> date_trunc('month', v_today)
     or extract(day from p_date)::integer not between v_from and v_to
     or extract(day from v_today)::integer not between v_from and v_to then
    raise exception 'The attendance book is closed for % (it is open from day % to day % of the month) — হাজিরা বই বন্ধ', p_date, v_from, v_to using errcode = '22023';
  end if;
  if p_joining is not null and p_date < p_joining then
    raise exception 'This date is before the joining date — যোগদানের আগের তারিখ' using errcode = '22023';
  end if;
end $$;

-- Hubs the caller may see for a permission. p_hub given but not allowed -> 42501. Never returns a hub outside the caller's scope.
create or replace function private.wf_hubs(p_perm text, p_zone uuid default null, p_hub uuid default null)
returns table (hub_id uuid, zone_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is not null then
    if not exists (select 1 from public.hubs x where x.id = p_hub) or not private.has_permission(p_perm, private.hub_zone(p_hub), p_hub) then
      raise exception 'You may not see this hub — এই হাবের তথ্য দেখার অনুমতি নেই' using errcode = '42501';
    end if;
    return query select h.id, h.zone_id from public.hubs h where h.id = p_hub;
    return;
  end if;
  return query select h.id, h.zone_id from public.hubs h
    where h.archived_at is null and (p_zone is null or h.zone_id = p_zone) and private.has_permission(p_perm, h.zone_id, h.id);
end $$;

create or replace function private.wf_can(p_hub uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'attendance', private.has_permission('hr.attendance.view', h.zone_id, h.id),
    'decide',     private.has_permission('hr.attendance.create', h.zone_id, h.id),
    'correct',    private.has_permission('hr.attendance.edit', h.zone_id, h.id),
    'ops',        private.has_permission('ops.staff_daily.view', h.zone_id, h.id),
    'ops_edit',   private.has_permission('ops.staff_daily.edit', h.zone_id, h.id))
  from public.hubs h where h.id = p_hub
$$;

create or replace function private.wf_hub_json(p_hub uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', h.id, 'code', h.code::text, 'name', coalesce(nullif(h.name_bn, ''), h.name), 'zone_id', h.zone_id,
                            'zone_name', coalesce(nullif(z.name_bn, ''), z.name))
  from public.hubs h join public.zones z on z.id = h.zone_id where h.id = p_hub
$$;

-- The managers of a hub: people who may mark attendance for it (same people att_notify_hub tells).
create or replace function private.wf_hub_managers(p_hub uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid;
begin
  select h.zone_id into v_zone from public.hubs h where h.id = p_hub;
  return query
    select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)   -- same rule as has_permission
      and p.code = 'hr.attendance.create'
      and ((ur.scope_type = 'hub' and ur.hub_id = p_hub) or (ur.scope_type = 'zone' and ur.zone_id = v_zone));
end $$;

-- A cell of the month grid: P present, L late, H half day, A absent, V leave, O holiday / weekly off,
-- w waiting, r returned, m missing, f future, c closed with nothing.
create or replace function private.wf_cell(p_state text, p_rec text) returns text
language sql immutable set search_path = '' as $$
  select case p_rec when 'present' then 'P' when 'late' then 'L' when 'half_day' then 'H' when 'absent' then 'A' when 'leave' then 'V'
                    when 'holiday' then 'O' when 'weekly_off' then 'O'
           else case p_state when 'approved' then 'P' when 'waiting' then 'w' when 'returned' then 'r' when 'missing' then 'm' when 'future' then 'f' else 'c' end end
$$;

create or replace function private.wf_summary(p_codes text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'present', count(*) filter (where c = 'P'), 'late', count(*) filter (where c = 'L'), 'half_day', count(*) filter (where c = 'H'),
    'absent', count(*) filter (where c = 'A'), 'leave', count(*) filter (where c = 'V'), 'other', count(*) filter (where c = 'O'),
    'waiting', count(*) filter (where c = 'w'), 'returned', count(*) filter (where c = 'r'), 'missing', count(*) filter (where c = 'm'),
    'total_days', count(*))
  from unnest(coalesce(p_codes, '{}'::text[])) c
$$;

-- THE one place that works out what a date looks like for a person (the book, the manager grid, the counts and the reminders all use it).
--   approved  = on the register (written by anyone) or an approved input
--   waiting   = given, waits for the manager        returned = the manager turned it down
--   future    = the date has not come               missing  = the book is open and nothing was given
--   closed    = the book is closed for this date (or before the joining date) and nothing was given
-- A withdrawn application's inputs count as nothing (the person took them back).
-- Scope is the caller's job: this function does not check permissions (it lives in private and is never granted to the API).
create or replace function private.wf_grid(p_from date, p_to date, p_hub uuid default null, p_employee uuid default null, p_all boolean default false)
returns table (employee_id uuid, work_date date, state text, mark_id uuid, mark_status text, kind text, applied_on_site boolean, note text,
               decided_as text, decide_note text, decided_by_name text, record_status text,
               application_id uuid, application_no text, application_status text)
language sql stable security definer set search_path = '' as $$
  with cfg as (select private.wf_today() as t, private.wf_from_day() as f, private.wf_to_day() as u),
  emps as (
    select e.id, e.joining_date from public.employees e
    where e.archived_at is null
      and (   (p_employee is not null and e.id = p_employee)
           or (p_employee is null and p_hub is not null and e.hub_id = p_hub
               and (e.status = 'active'
                    or exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date between p_from and p_to)
                    or exists (select 1 from public.attendance_self_marks m where m.employee_id = e.id and m.work_date between p_from and p_to)))
           or (p_employee is null and p_hub is null and p_all and e.status = 'active' and e.profile_id is not null))
  ),
  x as (
    select e.id as eid, e.joining_date as jd, (p_from + g.i) as wd, r.status as rs, m.id as mid, m.status as ms, m.kind as mk,
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
              and date_trunc('month', x.wd) = date_trunc('month', c.t)
              and extract(day from x.wd)::integer between c.f and c.u
              and extract(day from c.t)::integer between c.f and c.u then 'missing'
         else 'closed' end,
    case when x.live then x.mid end, case when x.live then x.ms end, case when x.live then x.mk end,
    case when x.live then x.mas end, case when x.live then x.mn end, case when x.live then x.mda end,
    case when x.live then x.mdn end, case when x.live then x.mdb end,
    x.rs, x.aid, x.ano, x.ast
  from x cross join cfg c
$$;

-- People of the given hubs who are expected to send their four numbers (they did within the last 14 days) but have not for p_date.
create or replace function private.wf_ops_missing(p_date date, p_hubs uuid[] default null, p_nohub boolean default false, p_all boolean default false)
returns table (employee_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
  where e.archived_at is null and e.status = 'active' and e.profile_id is not null
    and (p_all or e.hub_id = any (coalesce(p_hubs, '{}'::uuid[])) or (p_nohub and e.hub_id is null))
    and exists (select 1 from public.wf_daily_ops o where o.employee_id = e.id and o.work_date between p_date - 14 and p_date - 1)
    and not exists (select 1 from public.wf_daily_ops o where o.employee_id = e.id and o.work_date = p_date)
    -- not expected on a day the register says the person is away
    and not exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = p_date
                      and r.status in ('absent', 'leave', 'holiday', 'weekly_off'))
$$;

-- JSON builders (same keys as web/src/lib/workforce.ts).
create or replace function private.wf_ops_json(o public.wf_daily_ops) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'employee_id', o.employee_id, 'employee_code', e.employee_code::text, 'employee_name', e.full_name,
    'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
    'hub_id', o.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = o.hub_id),
    'zone_id', o.zone_id, 'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = o.zone_id),
    'work_date', o.work_date, 'pickup', o.pickup, 'pickup_return', o.pickup_return, 'delivery', o.delivery, 'delivery_return', o.delivery_return,
    'note', o.note, 'revision', o.revision, 'submitted_at', o.created_at, 'updated_at', o.updated_at)
  from public.employees e where e.id = o.employee_id
$$;

create or replace function private.wf_app_json(a public.wf_absence_applications) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'application_no', a.application_no, 'employee_id', a.employee_id,
    'employee_code', e.employee_code::text, 'employee_name', e.full_name,
    'hub_id', a.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = a.hub_id),
    'zone_id', a.zone_id, 'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = a.zone_id),
    'month', a.month, 'dates', to_jsonb(a.dates), 'reason', a.reason, 'status', a.status, 'created_at', a.created_at,
    'decided_at', a.decided_at, 'decided_by_name', (select p.full_name from public.profiles p where p.id = a.decided_by),
    'decision_note', a.decision_note, 'cancelled_at', a.cancelled_at)
  from public.employees e where e.id = a.employee_id
$$;

-- ---------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------
-- 3a. attendance_self_marks: zone follows hub; the old one-tap path (att_self_mark) keeps working untouched.
create or replace function private.wf_mark_before() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_book boolean := coalesce(current_setting('app.wf_path', true), '') = 'book';
  v_redo boolean;
begin
  if new.hub_id is not null then new.zone_id := private.hub_zone(new.hub_id); end if;
  if new.kind = 'present' then new.applied_on_site := null; new.application_id := null; end if;
  if tg_op = 'UPDATE' and not v_book then
    -- only att_self_mark puts an input back to "waiting" outside the book functions: it is the old one-tap path
    v_redo := new.status = 'waiting' and (old.status <> 'waiting' or new.marked_at is distinct from old.marked_at
                                          or (new.kind, new.note) is distinct from (old.kind, old.note));
    if v_redo then
      if old.status = 'waiting' and old.application_id is not null then
        raise exception 'This date is already in an application — withdraw the application first (এই তারিখ আবেদনে আছে)' using errcode = '23505';
      end if;
      new.via := 'today'; new.application_id := null; new.applied_on_site := null;
    end if;
  end if;
  return new;
end $$;
create or replace trigger att_self_wf_before before insert or update on public.attendance_self_marks
  for each row execute function private.wf_mark_before();

-- Application status follows its dates: once none waits, it is approved (some date approved) or rejected (all turned down).
create or replace function private.wf_app_sync(p_app uuid, p_by uuid, p_at timestamptz, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.wf_absence_applications; v_w integer; v_ok integer; v_rej integer;
begin
  select * into a from public.wf_absence_applications x where x.id = p_app for update;
  if a.id is null or a.status <> 'pending' then return; end if;
  select count(*) filter (where m.status = 'waiting'), count(*) filter (where m.status = 'approved'), count(*) filter (where m.status = 'rejected')
    into v_w, v_ok, v_rej from public.attendance_self_marks m where m.application_id = p_app;
  if v_w > 0 or v_ok + v_rej = 0 then return; end if;
  update public.wf_absence_applications set status = case when v_ok > 0 then 'approved' else 'rejected' end,
         decided_by = p_by, decided_at = coalesce(p_at, now()),
         decision_note = case when v_ok > 0 then nullif(trim(coalesce(p_note, '')), '')
                              else coalesce(nullif(trim(coalesce(p_note, '')), ''), 'ফেরত দেওয়া হয়েছে') end
   where id = p_app;
end $$;

-- 3b. attendance_self_marks: the correction history, and the application follows its dates.
create or replace function private.wf_mark_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_action text; v_cfg text := nullif(current_setting('app.wf_action', true), ''); v_by uuid := auth.uid(); v_note text;
begin
  if tg_op = 'INSERT' then
    insert into public.wf_att_history (mark_id, employee_id, hub_id, work_date, action, to_kind, to_status, to_as, note, by_user)
    values (new.id, new.employee_id, new.hub_id, new.work_date, 'submitted', new.kind, new.status, new.decided_as, new.note, v_by);
    return null;
  end if;
  if v_cfg is not null then v_action := v_cfg;
  elsif old.status = 'waiting' and new.status = 'approved' then v_action := 'approved';
  elsif old.status = 'waiting' and new.status = 'rejected' then v_action := 'returned';
  elsif old.status = 'rejected' and new.status = 'waiting' then v_action := 'resubmitted';
  elsif old.status = 'waiting' and new.status = 'waiting'
        and (new.kind, new.note, new.applied_on_site, new.application_id) is distinct from (old.kind, old.note, old.applied_on_site, old.application_id) then v_action := 'edited';
  end if;
  if v_action is not null and (v_cfg is not null or (old.status, old.kind, old.decided_as) is distinct from (new.status, new.kind, new.decided_as)
                              or v_action in ('edited', 'resubmitted')) then
    if v_action in ('approved', 'returned') then v_by := coalesce(new.decided_by, v_by); end if;
    v_note := case when v_action in ('approved', 'returned', 'corrected', 'cancelled') then new.decide_note else new.note end;
    insert into public.wf_att_history (mark_id, employee_id, hub_id, work_date, action, from_kind, to_kind, from_status, to_status, from_as, to_as, note, by_user)
    values (new.id, new.employee_id, new.hub_id, new.work_date, v_action, old.kind, new.kind, old.status, new.status, old.decided_as, new.decided_as, v_note, v_by);
  end if;
  if new.application_id is not null and old.status = 'waiting' and new.status in ('approved', 'rejected') then
    perform private.wf_app_sync(new.application_id, new.decided_by, new.decided_at, new.decide_note);
  end if;
  return null;
end $$;
create or replace trigger att_self_wf_after after insert or update on public.attendance_self_marks
  for each row execute function private.wf_mark_after();

-- 3c. wf_daily_ops: zone follows hub, revision counts every real change, history of every change.
create or replace function private.wf_ops_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.hub_id is not null then new.zone_id := private.hub_zone(new.hub_id); end if;
  if tg_op = 'INSERT' then
    new.revision := 1;
  elsif (new.pickup, new.pickup_return, new.delivery, new.delivery_return, new.note)
        is distinct from (old.pickup, old.pickup_return, old.delivery, old.delivery_return, old.note) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end $$;
create or replace trigger wf_daily_ops_before before insert or update on public.wf_daily_ops
  for each row execute function private.wf_ops_before();

create or replace function private.wf_ops_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.wf_ops_history (entry_id, revision, action, from_vals, to_vals, note, by_user)
    values (new.id, new.revision, 'submitted', null,
            jsonb_build_object('pickup', new.pickup, 'pickup_return', new.pickup_return, 'delivery', new.delivery, 'delivery_return', new.delivery_return),
            new.note, auth.uid());
  elsif new.revision <> old.revision then
    v_action := coalesce(nullif(current_setting('app.wf_action', true), ''), 'edited');
    insert into public.wf_ops_history (entry_id, revision, action, from_vals, to_vals, note, by_user)
    values (new.id, new.revision, v_action,
            jsonb_build_object('pickup', old.pickup, 'pickup_return', old.pickup_return, 'delivery', old.delivery, 'delivery_return', old.delivery_return),
            jsonb_build_object('pickup', new.pickup, 'pickup_return', new.pickup_return, 'delivery', new.delivery, 'delivery_return', new.delivery_return),
            coalesce(nullif(current_setting('app.wf_note', true), ''), new.note), auth.uid());
  end if;
  return null;
end $$;
create or replace trigger wf_daily_ops_after after insert or update on public.wf_daily_ops
  for each row execute function private.wf_ops_after();

-- 3d. stamps, audit, no deletes (like the other tables); histories can never change.
create or replace trigger wf_absence_applications_stamp before insert or update on public.wf_absence_applications
  for each row execute function private.stamp_row();
create or replace trigger wf_absence_applications_audit after insert or update or delete on public.wf_absence_applications
  for each row execute function private.audit_row('hr');
create or replace trigger wf_absence_applications_no_delete before delete on public.wf_absence_applications
  for each row execute function private.prevent_delete();
create or replace trigger wf_daily_ops_stamp before insert or update on public.wf_daily_ops
  for each row execute function private.stamp_row();
create or replace trigger wf_daily_ops_audit after insert or update or delete on public.wf_daily_ops
  for each row execute function private.audit_row('hr');
create or replace trigger wf_daily_ops_no_delete before delete on public.wf_daily_ops
  for each row execute function private.prevent_delete();
create or replace trigger wf_att_history_immutable before update or delete on public.wf_att_history
  for each row execute function private.audit_immutable();
create or replace trigger wf_ops_history_immutable before update or delete on public.wf_ops_history
  for each row execute function private.audit_immutable();

-- ---------------------------------------------------------------------
-- 4. Row level security: read only for the API; every write goes through the functions below.
-- ---------------------------------------------------------------------
alter table public.wf_absence_applications enable row level security;
alter table public.wf_daily_ops enable row level security;
alter table public.wf_att_history enable row level security;
alter table public.wf_ops_history enable row level security;
revoke all on public.wf_absence_applications, public.wf_daily_ops, public.wf_att_history, public.wf_ops_history from anon, authenticated;
grant select on public.wf_absence_applications, public.wf_daily_ops, public.wf_att_history, public.wf_ops_history to authenticated;

drop policy if exists wf_app_read on public.wf_absence_applications;
create policy wf_app_read on public.wf_absence_applications for select to authenticated
  using (private.is_self_employee(employee_id) or private.employee_has_permission('hr.attendance.view', employee_id));
drop policy if exists wf_ops_read on public.wf_daily_ops;
create policy wf_ops_read on public.wf_daily_ops for select to authenticated
  using (private.is_self_employee(employee_id) or private.has_permission('ops.staff_daily.view', zone_id, hub_id));
drop policy if exists wf_att_history_read on public.wf_att_history;
create policy wf_att_history_read on public.wf_att_history for select to authenticated
  using (private.is_self_employee(employee_id) or private.employee_has_permission('hr.attendance.view', employee_id));
drop policy if exists wf_ops_history_read on public.wf_ops_history;
create policy wf_ops_history_read on public.wf_ops_history for select to authenticated
  using (exists (select 1 from public.wf_daily_ops o where o.id = entry_id));   -- the entry's own policy decides

-- ---------------------------------------------------------------------
-- 5. Staff: the attendance book
-- ---------------------------------------------------------------------
-- One call loads a staff member's whole book for a month (any month: past months are the archive).
create or replace function public.wf_my_book(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day();
  v_month date; v_last integer; v_open boolean; v_d1 date; v_d2 date; v_days jsonb; v_codes text[]; v_apps jsonb; v_months jsonb;
begin
  if auth.uid() is null then return null; end if;
  e := private.wf_me();
  if e.id is null then return null; end if;
  v_month := date_trunc('month', coalesce(p_month, v_today))::date;
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_open := v_month = date_trunc('month', v_today)::date and extract(day from v_today)::integer between v_from and v_to;
  v_d1 := v_month + (least(v_from, v_last) - 1);
  v_d2 := v_month + (least(v_to, v_last) - 1);
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', g.work_date, 'day', extract(day from g.work_date)::integer, 'dow', extract(dow from g.work_date)::integer, 'state', g.state,
           'kind', g.kind, 'applied_on_site', g.applied_on_site, 'note', g.note, 'mark_id', g.mark_id,
           'decided_as', g.decided_as, 'decide_note', g.decide_note, 'decided_by_name', g.decided_by_name, 'record_status', g.record_status,
           'application_id', g.application_id, 'application_no', g.application_no, 'application_status', g.application_status) order by g.work_date), '[]'::jsonb),
         coalesce(array_agg(private.wf_cell(g.state, g.record_status) order by g.work_date), '{}'::text[])
    into v_days, v_codes
    from private.wf_grid(v_d1, v_d2, null, e.id) g;
  select coalesce(jsonb_agg(private.wf_app_json(a) order by a.created_at desc, a.application_no desc), '[]'::jsonb) into v_apps
    from public.wf_absence_applications a where a.employee_id = e.id and a.month = v_month;
  select coalesce(jsonb_agg(m.mm order by m.mm desc), '[]'::jsonb) into v_months from (
    select date_trunc('month', v_today)::date as mm
    union select date_trunc('month', x.work_date)::date from public.attendance_self_marks x where x.employee_id = e.id
    union select date_trunc('month', r.work_date)::date from public.attendance_records r where r.employee_id = e.id
    union select a.month from public.wf_absence_applications a where a.employee_id = e.id) m;
  return jsonb_build_object(
    'employee', jsonb_build_object('id', e.id, 'code', e.employee_code::text, 'name', e.full_name,
       'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
       'hub_id', e.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = e.hub_id),
       'zone_id', coalesce(e.zone_id, private.hub_zone(e.hub_id)),
       'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = coalesce(e.zone_id, private.hub_zone(e.hub_id)))),
    'month', v_month, 'today', v_today, 'window', jsonb_build_object('from_day', v_from, 'to_day', v_to), 'open', v_open,
    'days', v_days, 'summary', private.wf_summary(v_codes), 'applications', v_apps, 'months', v_months);
end $$;

-- Give one date: present, or absent with "I applied on the website" = yes. (Absent with "no" goes through wf_absence_apply.)
create or replace function public.wf_att_submit(p_date date, p_kind text, p_applied_on_site boolean default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_site boolean; m public.attendance_self_marks; v_id uuid; v_i integer; v_action text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then raise exception 'No active staff profile is linked to your login — আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('present', 'absent') then raise exception 'Unknown attendance kind' using errcode = '22023'; end if;
  perform private.wf_check_date(p_date, e.joining_date);
  if p_kind = 'absent' then
    if p_applied_on_site is null then
      raise exception 'Answer the website question first: did you apply on the website? (ওয়েবসাইটে আবেদন করেছেন কি? হ্যাঁ / না)' using errcode = '22023';
    end if;
    if not p_applied_on_site then
      raise exception 'This absence needs an application: choose the dates and write the reason (use wf_absence_apply) — আবেদন পাঠান' using errcode = '22023';
    end if;
    v_site := true;
    v_note := coalesce(v_note, 'ওয়েবসাইটে আবেদন করা আছে');
  end if;
  for v_i in 1..3 loop
    select * into m from public.attendance_self_marks x where x.employee_id = e.id and x.work_date = p_date for update;
    if m.id is null then
      if exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = p_date) then
        raise exception 'This date is already on the register — এই তারিখের হাজিরা আগেই খাতায় উঠেছে' using errcode = '23505';
      end if;
      perform set_config('app.wf_path', 'book', true);
      insert into public.attendance_self_marks (employee_id, hub_id, work_date, kind, note, applied_on_site, via)
      values (e.id, e.hub_id, p_date, p_kind, v_note, v_site, 'book')
      on conflict (employee_id, work_date) do nothing returning id into v_id;
      perform set_config('app.wf_path', '', true);
      if v_id is not null then v_action := 'new'; exit; end if;
      -- somebody wrote the date between the look and the insert: look again
    else
      if m.status = 'approved' then
        raise exception 'This date is already approved — only the manager can correct it (আগেই অনুমোদিত)' using errcode = '23505';
      end if;
      if exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = p_date) then
        raise exception 'This date is already on the register — এই তারিখের হাজিরা আগেই খাতায় উঠেছে' using errcode = '23505';
      end if;
      if m.status = 'waiting' and m.application_id is not null then
        raise exception 'This date is already in an application — withdraw the application first (এই তারিখ আবেদনে আছে)' using errcode = '23505';
      end if;
      if m.status = 'waiting' and m.kind = p_kind and m.note is not distinct from v_note and m.applied_on_site is not distinct from v_site then
        v_id := m.id; exit;   -- nothing changed: the same answer twice is not a second input
      end if;
      perform set_config('app.wf_path', 'book', true);
      update public.attendance_self_marks set kind = p_kind, note = v_note, applied_on_site = v_site, hub_id = e.hub_id, via = 'book', marked_at = now(),
             status = 'waiting', decided_as = null, decided_by = null, decided_at = null, decide_note = null, application_id = null, attendance_id = null
       where id = m.id;
      perform set_config('app.wf_path', '', true);
      v_id := m.id;
      v_action := case when m.status = 'rejected' then 'resubmitted' else 'edited' end;
      exit;
    end if;
  end loop;
  if v_id is null then raise exception 'Could not save, please try again — আবার চেষ্টা করুন' using errcode = '40001'; end if;
  -- today's date tells the hub's managers (like the one-tap path); older dates wait in the queue and in the daily reminder
  if p_date = v_today and v_action in ('new', 'resubmitted') and e.hub_id is not null then
    perform private.att_notify_hub(e.hub_id,
      case p_kind when 'present' then 'হাজিরা অনুমোদন বাকি' else 'আজ আসেননি — অনুমোদন বাকি' end,
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || case p_kind when 'present' then ' · হাজিরা দিয়েছেন' else ' · ওয়েবসাইটে আবেদন করা আছে' end,
      '/app/workforce/hub');
  end if;
  return v_id;
end $$;

-- Absent and not applied on the website: choose the dates and the reason; one application, one waiting input per date.
create or replace function public.wf_absence_apply(p_dates date[], p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_dates date[]; d date; m public.attendance_self_marks;
  a public.wf_absence_applications;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then raise exception 'No active staff profile is linked to your login — আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'Write the reason for the absence (reason is required) — কারণ লিখুন' using errcode = '22023'; end if;
  select array_agg(distinct x order by x) into v_dates from unnest(coalesce(p_dates, '{}'::date[])) x where x is not null;
  if coalesce(cardinality(v_dates), 0) = 0 then raise exception 'Choose at least one date — অন্তত একটি তারিখ বাছুন' using errcode = '22023'; end if;
  foreach d in array v_dates loop
    perform private.wf_check_date(d, e.joining_date);
    select * into m from public.attendance_self_marks x where x.employee_id = e.id and x.work_date = d for update;
    if m.id is not null and m.status = 'approved' then
      raise exception 'The date % is already approved — only the manager can correct it', d using errcode = '23505';
    end if;
    if exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = d) then
      raise exception 'The date % is already on the register', d using errcode = '23505';
    end if;
    if m.id is not null and m.status = 'waiting' and m.application_id is not null then
      raise exception 'The date % is already in an application — withdraw that application first', d using errcode = '23505';
    end if;
  end loop;
  insert into public.wf_absence_applications (application_no, employee_id, hub_id, zone_id, month, dates, reason)
  values ('AB-' || lpad(nextval('public.wf_absence_no_seq')::text, 5, '0'), e.id, e.hub_id, private.hub_zone(e.hub_id),
          date_trunc('month', v_dates[1])::date, v_dates, v_reason)
  returning * into a;
  perform set_config('app.wf_path', 'book', true);
  foreach d in array v_dates loop
    insert into public.attendance_self_marks (employee_id, hub_id, work_date, kind, note, applied_on_site, application_id, via)
    values (e.id, e.hub_id, d, 'absent', v_reason, false, a.id, 'book')
    on conflict (employee_id, work_date) do update
       set kind = 'absent', note = excluded.note, applied_on_site = false, application_id = excluded.application_id, hub_id = excluded.hub_id, via = 'book',
           marked_at = now(), status = 'waiting', decided_as = null, decided_by = null, decided_at = null, decide_note = null, attendance_id = null
     where public.attendance_self_marks.status <> 'approved';
  end loop;
  perform set_config('app.wf_path', '', true);
  if e.hub_id is not null then
    perform private.att_notify_hub(e.hub_id, 'অনুপস্থিতির আবেদন ' || a.application_no,
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || ' · ' || cardinality(v_dates) || ' দিন · কারণ: ' || left(v_reason, 120),
      '/app/workforce/hub');
  end if;
  return a.id;
end $$;

-- The owner takes a pending application back; its waiting inputs are closed with a note.
create or replace function public.wf_absence_cancel(p_application uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.wf_absence_applications;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into a from public.wf_absence_applications x where x.id = p_application for update;
  if a.id is null then raise exception 'Application not found — আবেদনটি পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.is_self_employee(a.employee_id) then raise exception 'You may not withdraw somebody else''s application' using errcode = '42501'; end if;
  if a.status <> 'pending' then raise exception 'Only a pending application can be withdrawn — শুধু অপেক্ষারত আবেদন তুলে নেওয়া যায়' using errcode = '22023'; end if;
  update public.wf_absence_applications set status = 'cancelled', cancelled_at = now() where id = a.id;
  perform set_config('app.wf_action', 'cancelled', true);
  update public.attendance_self_marks set status = 'rejected', decided_by = null, decided_at = now(), decided_as = null, decide_note = 'আবেদন তুলে নেওয়া হয়েছে'
   where application_id = a.id and status = 'waiting';
  perform set_config('app.wf_action', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 6. Staff: the four daily numbers
-- ---------------------------------------------------------------------
create or replace function public.wf_ops_mine(p_days integer default 14) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_today date := private.wf_today(); v_days integer := greatest(1, least(coalesce(p_days, 14), 60)); v_hint jsonb;
begin
  if auth.uid() is null then return null; end if;
  e := private.wf_me();
  if e.id is null then return null; end if;
  if e.hub_id is not null then
    select jsonb_build_object('pickup', coalesce(sum(l.pickup_qty), 0), 'delivery', coalesce(sum(l.delivery_qty), 0), 'lines', count(*)) into v_hint
      from public.da_rider_lines l join public.da_sessions s on s.id = l.session_id
     where s.hub_id = e.hub_id and s.account_date = v_today and l.employee_id = e.id and l.removed_at is null
    having count(*) > 0;
  end if;
  return jsonb_build_object('today', v_today, 'backdate_days', private.wf_backdate(),
    'entry', (select private.wf_ops_json(o) from public.wf_daily_ops o where o.employee_id = e.id and o.work_date = v_today),
    'recent', coalesce((select jsonb_agg(private.wf_ops_json(o) order by o.work_date desc) from public.wf_daily_ops o
                         where o.employee_id = e.id and o.work_date < v_today and o.work_date >= v_today - v_days), '[]'::jsonb),
    'hint', v_hint);
end $$;

-- Submit or change one's own four numbers for today (or up to ops_backdate_days earlier). Same numbers twice change nothing.
create or replace function public.wf_ops_submit(p_pickup integer, p_pickup_return integer, p_delivery integer, p_delivery_return integer,
  p_note text default null, p_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_today date := private.wf_today(); v_date date := coalesce(p_date, private.wf_today()); v_note text := nullif(trim(coalesce(p_note, '')), ''); v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then raise exception 'No active staff profile is linked to your login — আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  if least(coalesce(p_pickup, 0), coalesce(p_pickup_return, 0), coalesce(p_delivery, 0), coalesce(p_delivery_return, 0)) < 0 then
    raise exception 'The numbers must be non-negative — সংখ্যা ০ বা তার বেশি হতে হবে' using errcode = '22023';
  end if;
  if greatest(coalesce(p_pickup, 0), coalesce(p_pickup_return, 0), coalesce(p_delivery, 0), coalesce(p_delivery_return, 0)) > 100000 then
    raise exception 'The numbers must be at most 100000' using errcode = '22023';
  end if;
  if v_date > v_today then raise exception 'A future date cannot be filled yet — আগামী তারিখ' using errcode = '22023'; end if;
  if v_date < v_today - private.wf_backdate() then
    raise exception 'You may not change an older day — ask your manager to correct it (পুরোনো দিনের সংখ্যা ম্যানেজার সংশোধন করবেন)' using errcode = '42501';
  end if;
  insert into public.wf_daily_ops (employee_id, hub_id, zone_id, work_date, pickup, pickup_return, delivery, delivery_return, note)
  values (e.id, e.hub_id, private.hub_zone(e.hub_id), v_date, coalesce(p_pickup, 0), coalesce(p_pickup_return, 0), coalesce(p_delivery, 0), coalesce(p_delivery_return, 0), v_note)
  on conflict (employee_id, work_date) do update
     set pickup = excluded.pickup, pickup_return = excluded.pickup_return, delivery = excluded.delivery, delivery_return = excluded.delivery_return,
         note = excluded.note, hub_id = excluded.hub_id, zone_id = excluded.zone_id
   where (public.wf_daily_ops.pickup, public.wf_daily_ops.pickup_return, public.wf_daily_ops.delivery, public.wf_daily_ops.delivery_return, public.wf_daily_ops.note)
         is distinct from (excluded.pickup, excluded.pickup_return, excluded.delivery, excluded.delivery_return, excluded.note);
  select o.id into v_id from public.wf_daily_ops o where o.employee_id = e.id and o.work_date = v_date;
  return (select private.wf_ops_json(o) from public.wf_daily_ops o where o.id = v_id);
end $$;

-- The small alert numbers (personal menu, staff panel, dashboard, bell).
create or replace function public.wf_pending_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_open boolean := private.wf_open(); v_from integer := private.wf_from_day();
  v_month date := date_trunc('month', private.wf_today())::date;
  v_mine jsonb; v_manage jsonb; v_missing integer := 0; v_returned integer := 0; v_waiting integer; v_apps integer; v_exp boolean; v_sub boolean;
  v_hubs uuid[]; v_nohub boolean; v_ophubs uuid[]; v_opnohub boolean; v_mw integer; v_ap integer; v_om integer := 0;
begin
  if auth.uid() is null then return jsonb_build_object('today', v_today, 'open', v_open, 'mine', null, 'manage', null); end if;
  e := private.wf_me();
  if e.id is not null then
    if v_open then
      select count(*) filter (where g.state = 'missing'), count(*) filter (where g.state = 'returned') into v_missing, v_returned
        from private.wf_grid(v_month + (v_from - 1), v_today, null, e.id) g;
    end if;
    select count(*) into v_waiting from public.attendance_self_marks m
     where m.employee_id = e.id and m.status = 'waiting'
       and not exists (select 1 from public.attendance_records r where r.employee_id = m.employee_id and r.work_date = m.work_date);
    select count(*) into v_apps from public.wf_absence_applications a where a.employee_id = e.id and a.status = 'pending';
    select exists (select 1 from public.wf_daily_ops o where o.employee_id = e.id and o.work_date between v_today - 14 and v_today),
           exists (select 1 from public.wf_daily_ops o where o.employee_id = e.id and o.work_date = v_today)
      into v_exp, v_sub;
    v_mine := jsonb_build_object('missing_days', v_missing, 'returned_days', v_returned, 'waiting_days', v_waiting, 'applications_pending', v_apps,
                                 'ops_expected', v_exp, 'ops_submitted_today', v_sub);
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
-- 7. Manager and zonal manager (everything limited to the hubs the caller may see)
-- ---------------------------------------------------------------------
create or replace function public.wf_hub_overview(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, private.wf_today()); h public.hubs; v_can jsonb; v_ops boolean;
  v_att jsonb; v_total integer; v_people jsonb; v_pend jsonb; v_opsj jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);   -- raises 42501 when the caller may not see this hub
  select * into h from public.hubs x where x.id = p_hub;
  v_can := private.wf_can(h.id);
  v_ops := (v_can ->> 'ops')::boolean;
  with g as (select * from private.wf_grid(v_date, v_date, p_hub)),
  p as (
    select g.*, e.employee_code::text as code, e.full_name, e.mobile,
           (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id) as pos,
           (private.is_current_rider(e.id, p_hub)
            or exists (select 1 from public.positions po where po.id = e.position_id
                         and (po.code::text ilike '%rider%' or po.name ilike '%rider%' or coalesce(po.name_bn, '') like '%রাইডার%'))) as is_rider
    from g join public.employees e on e.id = g.employee_id)
  select jsonb_build_object('present', count(*) filter (where record_status = 'present'), 'late', count(*) filter (where record_status = 'late'),
           'half_day', count(*) filter (where record_status = 'half_day'), 'absent', count(*) filter (where record_status = 'absent'),
           'leave', count(*) filter (where record_status = 'leave'), 'other', count(*) filter (where record_status in ('holiday', 'weekly_off')),
           'not_given', count(*) filter (where record_status is null and state in ('missing', 'closed')),
           'waiting_marks', count(*) filter (where state = 'waiting'), 'returned_marks', count(*) filter (where state = 'returned')),
         count(*),
         coalesce(jsonb_agg(jsonb_build_object('employee_id', p.employee_id, 'code', p.code, 'name', p.full_name, 'position', p.pos, 'mobile', p.mobile,
           'is_rider', p.is_rider, 'record_status', p.record_status, 'mark_kind', p.kind, 'mark_status', p.mark_status,
           'ops_submitted', case when v_ops then exists (select 1 from public.wf_daily_ops o where o.employee_id = p.employee_id and o.work_date = v_date) end)
           order by p.full_name), '[]'::jsonb)
    into v_att, v_total, v_people from p;
  v_pend := jsonb_build_object(
    'marks', (select count(*) from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
               where m.status = 'waiting' and e.hub_id = p_hub and e.archived_at is null and e.profile_id is distinct from auth.uid()),
    'applications', (select count(*) from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
               where a.status = 'pending' and e.hub_id = p_hub and e.archived_at is null and e.profile_id is distinct from auth.uid()));
  if v_ops then
    select jsonb_build_object('submitted', count(*), 'missing', (select count(*) from private.wf_ops_missing(v_date, array[p_hub])),
             'pickup', coalesce(sum(o.pickup), 0), 'pickup_return', coalesce(sum(o.pickup_return), 0),
             'delivery', coalesce(sum(o.delivery), 0), 'delivery_return', coalesce(sum(o.delivery_return), 0))
      into v_opsj from public.wf_daily_ops o where o.hub_id = p_hub and o.work_date = v_date;
  end if;
  return jsonb_build_object('hub', private.wf_hub_json(h.id), 'date', v_date, 'can', v_can, 'staff_total', v_total,
                            'attendance', v_att, 'pending', v_pend, 'ops', v_opsj, 'people', v_people);
end $$;

-- Everyone of the hub across the month's window (the month archive is the same call for a past month).
create or replace function public.wf_hub_book(p_hub uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day();
  v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_last integer; v_d1 date; v_d2 date;
  v_open boolean; v_dates jsonb; v_people jsonb; v_all text[];
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_open := v_month = date_trunc('month', v_today)::date and extract(day from v_today)::integer between v_from and v_to;
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
    'window', jsonb_build_object('from_day', v_from, 'to_day', v_to), 'open', v_open, 'can', private.wf_can(p_hub),
    'dates', v_dates, 'people', v_people, 'totals', private.wf_summary(v_all));
end $$;

-- The approval queue / list of staff inputs (rows of attendance_self_marks). Decide them with att_self_decide (unchanged).
create or replace function public.wf_marks(p_zone uuid default null, p_hub uuid default null, p_from date default null, p_to date default null,
  p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', private.wf_today())::date); v_to date := coalesce(p_to, private.wf_today());
  v_hubs uuid[]; v_nohub boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('waiting', 'approved', 'rejected') then raise exception 'Unknown status' using errcode = '22023'; end if;
  v_hubs := array(select w.hub_id from private.wf_hubs('hr.attendance.view', p_zone, p_hub) w);
  v_nohub := p_hub is null and p_zone is null and private.has_permission('hr.attendance.view');
  return coalesce((
    select jsonb_agg(q.j order by q.rn) from (
      select jsonb_build_object(
          'id', m.id, 'employee_id', m.employee_id, 'employee_code', e.employee_code::text, 'full_name', e.full_name,
          'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
          'hub_id', m.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = m.hub_id), 'zone_id', m.zone_id,
          'work_date', m.work_date, 'kind', m.kind, 'applied_on_site', m.applied_on_site, 'note', m.note, 'status', m.status, 'via', m.via,
          'marked_at', m.marked_at, 'decided_as', m.decided_as, 'decide_note', m.decide_note, 'decided_at', m.decided_at,
          'decided_by_name', (select p.full_name from public.profiles p where p.id = m.decided_by),
          'application_id', m.application_id, 'application_no', a.application_no,
          'record_status', (select r.status from public.attendance_records r where r.employee_id = m.employee_id and r.work_date = m.work_date)) as j,
        row_number() over (order by (m.status = 'waiting') desc, m.work_date desc, e.full_name) as rn
      from public.attendance_self_marks m
      join public.employees e on e.id = m.employee_id
      left join public.wf_absence_applications a on a.id = m.application_id
      where m.work_date between v_from and v_to and (p_status is null or m.status = p_status)
        and not (m.status = 'rejected' and coalesce(a.status, '') = 'cancelled')          -- a withdrawn application is not the manager's business
        and e.archived_at is null and (e.hub_id = any (v_hubs) or (v_nohub and e.hub_id is null))
      order by (m.status = 'waiting') desc, m.work_date desc, e.full_name
      limit 3000) q), '[]'::jsonb);
end $$;

-- Absence applications with their tracking (status, who decided, when, note).
create or replace function public.wf_applications(p_zone uuid default null, p_hub uuid default null, p_status text default null, p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hubs uuid[]; v_nohub boolean; v_month date := case when p_month is null then null else date_trunc('month', p_month)::date end;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected', 'cancelled') then raise exception 'Unknown status' using errcode = '22023'; end if;
  v_hubs := array(select w.hub_id from private.wf_hubs('hr.attendance.view', p_zone, p_hub) w);
  v_nohub := p_hub is null and p_zone is null and private.has_permission('hr.attendance.view');
  return coalesce((
    select jsonb_agg(q.j order by q.rn) from (
      select private.wf_app_json(a) as j,
             row_number() over (order by (a.status = 'pending') desc, a.created_at desc, a.application_no desc) as rn
      from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
      where (p_status is null or a.status = p_status) and (v_month is null or a.month = v_month)
        and e.archived_at is null and (e.hub_id = any (v_hubs) or (v_nohub and e.hub_id is null))
      order by (a.status = 'pending') desc, a.created_at desc, a.application_no desc
      limit 2000) q), '[]'::jsonb);
end $$;

-- Approve / turn down a whole application: its waiting dates go through att_self_decide (the same path as any input).
create or replace function public.wf_absence_decide(p_application uuid, p_ok boolean, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare a public.wf_absence_applications; v_note text := nullif(trim(coalesce(p_note, '')), ''); v_ids uuid[]; v_n integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into a from public.wf_absence_applications x where x.id = p_application for update;
  if a.id is null then raise exception 'Application not found — আবেদনটি পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.employee_has_permission('hr.attendance.create', a.employee_id) then
    raise exception 'You may not decide this application — এই আবেদন নিষ্পত্তির অনুমতি নেই' using errcode = '42501';
  end if;
  if private.is_self_employee(a.employee_id) then
    raise exception 'Your own attendance is approved by another manager (নিজের আবেদন অন্য ম্যানেজার দেখবেন)' using errcode = '42501';
  end if;
  if a.status <> 'pending' then raise exception 'This application is already settled (%) — আবেদনের সিদ্ধান্ত আগেই হয়ে গেছে', a.status using errcode = 'P0001'; end if;
  if p_ok is null then raise exception 'Choose approve or turn down' using errcode = '22023'; end if;
  if not p_ok and v_note is null then raise exception 'Write why it is turned down — কেন ফেরত দিচ্ছেন লিখুন' using errcode = '22023'; end if;
  select array_agg(m.id) into v_ids from public.attendance_self_marks m where m.application_id = a.id and m.status = 'waiting';
  if v_ids is not null then
    v_n := public.att_self_decide(v_ids, p_ok, case when p_ok then 'absent' end, v_note);   -- its trigger settles the application
  end if;
  update public.wf_absence_applications set status = case when p_ok then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(v_note, 'ফেরত দেওয়া হয়েছে')
   where id = a.id and status = 'pending';   -- only when nothing was waiting (the trigger already settled it otherwise)
  return v_n;
end $$;

-- The manager corrects an APPROVED input and the register with it. A note is required; the change is kept in the history.
create or replace function public.wf_att_correct(p_mark uuid, p_as text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.attendance_self_marks; r public.attendance_records; v_note text := nullif(trim(coalesce(p_note, '')), ''); v_prof uuid; v_word text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into m from public.attendance_self_marks x where x.id = p_mark for update;
  if m.id is null then raise exception 'Input not found — হাজিরাটি পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.employee_has_permission('hr.attendance.edit', m.employee_id) then
    raise exception 'You may not correct attendance for this person — এই ব্যক্তির হাজিরা সংশোধনের অনুমতি নেই' using errcode = '42501';
  end if;
  if private.is_self_employee(m.employee_id) then
    raise exception 'Your own attendance is corrected by another manager (নিজের হাজিরা অন্য ম্যানেজার সংশোধন করবেন)' using errcode = '42501';
  end if;
  if p_as is null or p_as not in ('present', 'late', 'half_day', 'absent') then raise exception 'Unknown attendance status' using errcode = '22023'; end if;
  if v_note is null then raise exception 'A correction note is required — সংশোধনের কারণ লিখুন' using errcode = '22023'; end if;
  if m.status <> 'approved' then
    raise exception 'Only an approved input can be corrected: approve or return the waiting one first (আগে অনুমোদন বা ফেরত দিন)' using errcode = '22023';
  end if;
  select * into r from public.attendance_records x where x.employee_id = m.employee_id and x.work_date = m.work_date for update;
  if r.id is not null and r.status = p_as and m.decided_as = p_as then
    raise exception 'Nothing to correct: it already is that status (একই অবস্থা — অন্য অবস্থা বাছুন)' using errcode = '22023';
  end if;
  if r.id is null then
    insert into public.attendance_records (employee_id, work_date, status, check_in, source, note)
    values (m.employee_id, m.work_date, p_as, case when p_as = 'absent' then null else m.marked_at end, 'self', v_note);
  else
    update public.attendance_records set status = p_as, check_in = case when p_as = 'absent' then null else coalesce(check_in, m.marked_at) end, note = v_note
     where id = r.id;
  end if;
  perform set_config('app.wf_action', 'corrected', true);
  update public.attendance_self_marks set decided_as = p_as, decide_note = v_note, decided_by = auth.uid(), decided_at = now() where id = m.id;
  perform set_config('app.wf_action', '', true);
  v_word := case p_as when 'present' then 'উপস্থিত' when 'late' then 'দেরিতে' when 'half_day' then 'অর্ধদিবস' else 'অনুপস্থিত' end;
  select e.profile_id into v_prof from public.employees e where e.id = m.employee_id;
  perform private.notify(v_prof, 'হাজিরা সংশোধন হয়েছে: ' || v_word, 'তারিখ ' || m.work_date || ' · কারণ: ' || v_note, '/app/workforce/attendance', 'attendance');
end $$;

-- The correction history (append-only). A staff member may read their own; a manager reads the hubs they may see.
create or replace function public.wf_att_history(p_zone uuid default null, p_hub uuid default null, p_employee uuid default null, p_month date default null,
  p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hubs uuid[]; v_nohub boolean; v_m date := case when p_month is null then null else date_trunc('month', p_month)::date end;
        v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_employee is not null then
    if not (private.is_self_employee(p_employee) or private.employee_has_permission('hr.attendance.view', p_employee)) then
      raise exception 'You may not see this person''s history — এই ব্যক্তির ইতিহাস দেখার অনুমতি নেই' using errcode = '42501';
    end if;
  else
    v_hubs := array(select w.hub_id from private.wf_hubs('hr.attendance.view', p_zone, p_hub) w);
    v_nohub := p_hub is null and p_zone is null and private.has_permission('hr.attendance.view');
  end if;
  return coalesce((
    select jsonb_agg(q.j order by q.rn) from (
      select jsonb_build_object('id', x.id, 'mark_id', x.mark_id, 'employee_id', x.employee_id, 'employee_code', e.employee_code::text, 'employee_name', e.full_name,
          'hub_id', x.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = x.hub_id), 'work_date', x.work_date,
          'action', x.action, 'from_kind', x.from_kind, 'to_kind', x.to_kind, 'from_status', x.from_status, 'to_status', x.to_status,
          'from_as', x.from_as, 'to_as', x.to_as, 'note', x.note, 'by_name', (select p.full_name from public.profiles p where p.id = x.by_user), 'at', x.at) as j,
        row_number() over (order by x.at desc, x.id) as rn
      from public.wf_att_history x join public.employees e on e.id = x.employee_id
      where (v_m is null or (x.work_date >= v_m and x.work_date < v_m + interval '1 month'))
        and (case when p_employee is not null then x.employee_id = p_employee
                  else e.archived_at is null and (e.hub_id = any (v_hubs) or (v_nohub and e.hub_id is null)) end)
      order by x.at desc, x.id
      limit v_limit) q), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 8. Manager: the four numbers
-- ---------------------------------------------------------------------
create or replace function public.wf_ops_report(p_zone uuid default null, p_hub uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_from date := coalesce(p_from, date_trunc('month', private.wf_today())::date); v_to date := coalesce(p_to, private.wf_today());
  v_hubs uuid[]; v_nohub boolean; v_edit boolean; v_rows jsonb; v_tot jsonb; v_person jsonb; v_day jsonb; v_miss jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_to < v_from then raise exception 'The end date is before the start date' using errcode = '22023'; end if;
  if v_to - v_from > 92 then raise exception 'The range is too long (at most 93 days)' using errcode = '22023'; end if;
  v_hubs := array(select w.hub_id from private.wf_hubs('ops.staff_daily.view', p_zone, p_hub) w);
  v_nohub := p_hub is null and p_zone is null and private.has_permission('ops.staff_daily.view');
  v_edit := exists (select 1 from public.hubs h where h.id = any (v_hubs) and private.has_permission('ops.staff_daily.edit', h.zone_id, h.id))
            or (v_nohub and private.has_permission('ops.staff_daily.edit'));
  select coalesce(jsonb_agg(private.wf_ops_json(o) order by o.work_date desc, e.full_name), '[]'::jsonb) into v_rows
    from public.wf_daily_ops o join public.employees e on e.id = o.employee_id
   where o.id in (select o2.id from public.wf_daily_ops o2 join public.employees e2 on e2.id = o2.employee_id
                   where o2.work_date between v_from and v_to and (o2.hub_id = any (v_hubs) or (v_nohub and o2.hub_id is null))
                   order by o2.work_date desc, e2.full_name limit 3000);
  with r as (select o.employee_id, o.hub_id, o.work_date, o.pickup, o.pickup_return, o.delivery, o.delivery_return from public.wf_daily_ops o
              where o.work_date between v_from and v_to and (o.hub_id = any (v_hubs) or (v_nohub and o.hub_id is null)))
  select (select jsonb_build_object('pickup', coalesce(sum(pickup), 0), 'pickup_return', coalesce(sum(pickup_return), 0), 'delivery', coalesce(sum(delivery), 0),
                  'delivery_return', coalesce(sum(delivery_return), 0), 'entries', count(*), 'people', count(distinct employee_id)) from r),
         (select coalesce(jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'code', e.employee_code::text, 'name', e.full_name,
                  'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
                  'hub_id', x.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = x.hub_id),
                  'days', x.days, 'pickup', x.pickup, 'pickup_return', x.pickup_return, 'delivery', x.delivery, 'delivery_return', x.delivery_return)
                  order by e.full_name), '[]'::jsonb)
            from (select employee_id, (array_agg(hub_id order by work_date desc))[1] as hub_id, count(*) as days, sum(pickup) as pickup, sum(pickup_return) as pickup_return,
                         sum(delivery) as delivery, sum(delivery_return) as delivery_return from r group by employee_id) x
            join public.employees e on e.id = x.employee_id),
         (select coalesce(jsonb_agg(jsonb_build_object('date', d.work_date, 'people', d.people, 'pickup', d.pickup, 'pickup_return', d.pickup_return,
                  'delivery', d.delivery, 'delivery_return', d.delivery_return) order by d.work_date desc), '[]'::jsonb)
            from (select work_date, count(distinct employee_id) as people, sum(pickup) as pickup, sum(pickup_return) as pickup_return,
                         sum(delivery) as delivery, sum(delivery_return) as delivery_return from r group by work_date) d)
    into v_tot, v_person, v_day;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name,
           'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
           'hub_id', e.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = e.hub_id), 'mobile', e.mobile)
           order by e.full_name), '[]'::jsonb)
    into v_miss from private.wf_ops_missing(v_today, v_hubs, v_nohub) mm join public.employees e on e.id = mm.employee_id;
  -- `rows` carries at most 3000 lines (newest first); the totals, by_person and by_day always cover the whole range
  return jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today, 'can_edit', coalesce(v_edit, false), 'rows', v_rows, 'totals', v_tot,
                            'by_person', v_person, 'by_day', v_day, 'missing_today', v_miss,
                            'rows_total', (v_tot ->> 'entries')::integer, 'truncated', (v_tot ->> 'entries')::integer > 3000);
end $$;

-- A manager corrects somebody's four numbers (any date). A note is required; revision + history record it.
create or replace function public.wf_ops_correct(p_id uuid, p_pickup integer, p_pickup_return integer, p_delivery integer, p_delivery_return integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.wf_daily_ops; v_note text := nullif(trim(coalesce(p_note, '')), ''); v_prof uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into o from public.wf_daily_ops x where x.id = p_id for update;
  if o.id is null then raise exception 'Entry not found — এন্ট্রিটি পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.staff_daily.edit', o.zone_id, o.hub_id) then
    raise exception 'You may not correct these numbers — এই সংখ্যা সংশোধনের অনুমতি নেই' using errcode = '42501';
  end if;
  if private.is_self_employee(o.employee_id) then
    raise exception 'You may not correct your own numbers here — another manager does it (নিজের সংখ্যা অন্য ম্যানেজার সংশোধন করবেন)' using errcode = '42501';
  end if;
  if v_note is null then raise exception 'A correction note is required — সংশোধনের কারণ লিখুন' using errcode = '22023'; end if;
  if least(coalesce(p_pickup, 0), coalesce(p_pickup_return, 0), coalesce(p_delivery, 0), coalesce(p_delivery_return, 0)) < 0 then
    raise exception 'The numbers must be non-negative — সংখ্যা ০ বা তার বেশি হতে হবে' using errcode = '22023';
  end if;
  if greatest(coalesce(p_pickup, 0), coalesce(p_pickup_return, 0), coalesce(p_delivery, 0), coalesce(p_delivery_return, 0)) > 100000 then
    raise exception 'The numbers must be at most 100000' using errcode = '22023';
  end if;
  if (o.pickup, o.pickup_return, o.delivery, o.delivery_return)
       = (coalesce(p_pickup, 0), coalesce(p_pickup_return, 0), coalesce(p_delivery, 0), coalesce(p_delivery_return, 0)) then
    return;   -- nothing to change
  end if;
  perform set_config('app.wf_action', 'corrected', true);
  perform set_config('app.wf_note', v_note, true);
  update public.wf_daily_ops set pickup = coalesce(p_pickup, 0), pickup_return = coalesce(p_pickup_return, 0), delivery = coalesce(p_delivery, 0),
         delivery_return = coalesce(p_delivery_return, 0) where id = o.id;
  perform set_config('app.wf_action', '', true);
  perform set_config('app.wf_note', '', true);
  select e.profile_id into v_prof from public.employees e where e.id = o.employee_id;
  perform private.notify(v_prof, 'আপনার দৈনিক সংখ্যা সংশোধন হয়েছে', 'তারিখ ' || o.work_date || ' · কারণ: ' || v_note, '/app/workforce/attendance', 'attendance');
end $$;

create or replace function public.wf_ops_history(p_entry uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.wf_daily_ops;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into o from public.wf_daily_ops x where x.id = p_entry;
  if o.id is null then return '[]'::jsonb; end if;
  if not (private.is_self_employee(o.employee_id) or private.has_permission('ops.staff_daily.view', o.zone_id, o.hub_id)) then
    raise exception 'You may not see this history — এই ইতিহাস দেখার অনুমতি নেই' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'entry_id', h.entry_id, 'work_date', o.work_date,
            'employee_name', (select e.full_name from public.employees e where e.id = o.employee_id), 'revision', h.revision, 'action', h.action,
            'from', h.from_vals, 'to', h.to_vals, 'note', h.note, 'by_name', (select p.full_name from public.profiles p where p.id = h.by_user), 'at', h.at)
            order by h.revision desc, h.at desc)
          from public.wf_ops_history h where h.entry_id = o.id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 9. Zonal manager: all hubs together (register rows in the range; the rest is what waits now)
-- ---------------------------------------------------------------------
create or replace function public.wf_zone_overview(p_zone uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_from date := coalesce(p_from, date_trunc('month', private.wf_today())::date); v_to date := coalesce(p_to, private.wf_today());
  v_hubs uuid[]; v_nohub boolean; v_zone jsonb; v_rows jsonb; v_tot jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_to < v_from then raise exception 'The end date is before the start date' using errcode = '22023'; end if;
  if v_to - v_from > 400 then raise exception 'The range is too long (at most 400 days)' using errcode = '22023'; end if;
  v_hubs := array(select w.hub_id from private.wf_hubs('hr.attendance.view', p_zone) w);
  v_nohub := p_zone is null and private.has_permission('hr.attendance.view');
  if p_zone is not null and cardinality(v_hubs) = 0 then raise exception 'You may not see this zone — এই জোনের তথ্য দেখার অনুমতি নেই' using errcode = '42501'; end if;
  if p_zone is not null then
    select jsonb_build_object('id', z.id, 'name', coalesce(nullif(z.name_bn, ''), z.name)) into v_zone from public.zones z where z.id = p_zone;
  end if;
  with hx as (
    select h.id as hub_id, h.code::text as code, coalesce(nullif(h.name_bn, ''), h.name) as name, h.zone_id as zone_id,
           coalesce(nullif(z.name_bn, ''), z.name) as zone_name, private.has_permission('ops.staff_daily.view', h.zone_id, h.id) as ops_vis, 0 as ord
      from public.hubs h join public.zones z on z.id = h.zone_id where h.id = any (v_hubs)
    union all
    select null::uuid, null::text, 'হাব ছাড়া', null::uuid, null::text, private.has_permission('ops.staff_daily.view'), 1 where v_nohub),
  m as (
    select hx.*, s.staff_total, s.not_given, a.a_present, a.a_late, a.a_half, a.a_absent, a.a_leave, a.a_other,
           p.pm, p.pa, p.rm, o.o_people, o.o_pickup, o.o_pickup_return, o.o_delivery, o.o_delivery_return,
           (select count(*) from private.wf_ops_missing(v_today, array[hx.hub_id], hx.hub_id is null)) as o_missing
    from hx
    cross join lateral (
      select count(*) as staff_total,
             count(*) filter (where (e.joining_date is null or e.joining_date <= v_today)
               and not exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = v_today)
               and not exists (select 1 from public.attendance_self_marks mk left join public.wf_absence_applications ap on ap.id = mk.application_id
                                where mk.employee_id = e.id and mk.work_date = v_today and not (mk.status = 'rejected' and coalesce(ap.status, '') = 'cancelled'))) as not_given
      from public.employees e where e.hub_id is not distinct from hx.hub_id and e.archived_at is null and e.status = 'active') s
    cross join lateral (
      select count(*) filter (where r.status = 'present') as a_present, count(*) filter (where r.status = 'late') as a_late,
             count(*) filter (where r.status = 'half_day') as a_half, count(*) filter (where r.status = 'absent') as a_absent,
             count(*) filter (where r.status = 'leave') as a_leave, count(*) filter (where r.status in ('holiday', 'weekly_off')) as a_other
      from public.attendance_records r join public.employees e on e.id = r.employee_id
      where e.hub_id is not distinct from hx.hub_id and e.archived_at is null and r.work_date between v_from and v_to) a
    cross join lateral (
      select (select count(*) from public.attendance_self_marks mk join public.employees e on e.id = mk.employee_id
               where mk.status = 'waiting' and e.hub_id is not distinct from hx.hub_id and e.archived_at is null and e.profile_id is distinct from auth.uid()) as pm,
             (select count(*) from public.wf_absence_applications ap join public.employees e on e.id = ap.employee_id
               where ap.status = 'pending' and e.hub_id is not distinct from hx.hub_id and e.archived_at is null and e.profile_id is distinct from auth.uid()) as pa,
             (select count(*) from public.attendance_self_marks mk join public.employees e on e.id = mk.employee_id
               left join public.wf_absence_applications ap on ap.id = mk.application_id
               where mk.status = 'rejected' and coalesce(ap.status, '') <> 'cancelled' and mk.work_date between v_from and v_to
                 and e.hub_id is not distinct from hx.hub_id and e.archived_at is null
                 and not exists (select 1 from public.attendance_records r where r.employee_id = mk.employee_id and r.work_date = mk.work_date)) as rm) p
    cross join lateral (
      select count(distinct d.employee_id) as o_people, coalesce(sum(d.pickup), 0) as o_pickup, coalesce(sum(d.pickup_return), 0) as o_pickup_return,
             coalesce(sum(d.delivery), 0) as o_delivery, coalesce(sum(d.delivery_return), 0) as o_delivery_return
      from public.wf_daily_ops d where d.hub_id is not distinct from hx.hub_id and d.work_date between v_from and v_to) o)
  select (select coalesce(jsonb_agg(jsonb_build_object('hub_id', m.hub_id, 'code', m.code, 'name', m.name, 'zone_id', m.zone_id, 'zone_name', m.zone_name,
            'staff_total', m.staff_total,
            'att', jsonb_build_object('present', m.a_present, 'late', m.a_late, 'half_day', m.a_half, 'absent', m.a_absent, 'leave', m.a_leave, 'other', m.a_other,
                                      'not_given_today', m.not_given),
            'pending_marks', m.pm, 'pending_applications', m.pa, 'returned_marks', m.rm,
            'ops', case when m.ops_vis then jsonb_build_object('submitted_people', m.o_people, 'missing_today', m.o_missing, 'pickup', m.o_pickup,
                                      'pickup_return', m.o_pickup_return, 'delivery', m.o_delivery, 'delivery_return', m.o_delivery_return) end)
            order by m.ord, m.zone_name, m.name), '[]'::jsonb) from m),
         (select jsonb_build_object('staff_total', coalesce(sum(m.staff_total), 0),
            'att', jsonb_build_object('present', coalesce(sum(m.a_present), 0), 'late', coalesce(sum(m.a_late), 0), 'half_day', coalesce(sum(m.a_half), 0),
                                      'absent', coalesce(sum(m.a_absent), 0), 'leave', coalesce(sum(m.a_leave), 0), 'other', coalesce(sum(m.a_other), 0),
                                      'not_given_today', coalesce(sum(m.not_given), 0)),
            'pending_marks', coalesce(sum(m.pm), 0), 'pending_applications', coalesce(sum(m.pa), 0), 'returned_marks', coalesce(sum(m.rm), 0),
            'ops', case when coalesce(bool_or(m.ops_vis), false) then jsonb_build_object(
                      'submitted_people', coalesce(sum(m.o_people) filter (where m.ops_vis), 0), 'missing_today', coalesce(sum(m.o_missing) filter (where m.ops_vis), 0),
                      'pickup', coalesce(sum(m.o_pickup) filter (where m.ops_vis), 0), 'pickup_return', coalesce(sum(m.o_pickup_return) filter (where m.ops_vis), 0),
                      'delivery', coalesce(sum(m.o_delivery) filter (where m.ops_vis), 0), 'delivery_return', coalesce(sum(m.o_delivery_return) filter (where m.ops_vis), 0)) end)
          from m)
    into v_rows, v_tot;
  return jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today, 'zone', v_zone, 'hubs', v_rows, 'totals', v_tot);
end $$;

-- ---------------------------------------------------------------------
-- 10. Reminders (once per person per Dhaka day) — runs from pg_cron at 10:00 UTC = 16:00 Dhaka
-- ---------------------------------------------------------------------
create or replace function private.wf_remind() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_day0 timestamptz := (private.wf_today()::timestamp at time zone 'Asia/Dhaka');
  v_month date := date_trunc('month', private.wf_today())::date; v_from integer := private.wf_from_day();
  v_n integer := 0; v_c integer; h record; u uuid; v_w integer; v_a integer;
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
     where m.status = 'waiting' and e.hub_id is not null and e.archived_at is null
    union
    select e.hub_id from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
     where a.status = 'pending' and e.hub_id is not null and e.archived_at is null
  loop
    for u in select * from private.wf_hub_managers(h.hub_id) loop
      select count(*) into v_w from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
       where m.status = 'waiting' and e.hub_id = h.hub_id and e.archived_at is null and e.profile_id is distinct from u;
      select count(*) into v_a from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
       where a.status = 'pending' and e.hub_id = h.hub_id and e.archived_at is null and e.profile_id is distinct from u;
      if v_w + v_a > 0 and not exists (select 1 from public.notifications n where n.profile_id = u and n.kind = 'workforce'
                                         and n.title = 'অনুমোদনের জন্য অপেক্ষায়' and n.created_at >= v_day0) then
        insert into public.notifications (profile_id, title, body, link, kind)
        values (u, 'অনুমোদনের জন্য অপেক্ষায়', v_w || ' টি হাজিরা ও ' || v_a || ' টি অনুপস্থিতির আবেদন আপনার সিদ্ধান্তের অপেক্ষায়।', '/app/workforce/hub', 'workforce');
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin perform cron.unschedule('wf-remind'); exception when others then null; end;   -- re-running this file replaces the job
    perform cron.schedule('wf-remind', '0 10 * * *', $c$select private.wf_remind()$c$);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. Real time (the publication exists on Supabase only)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['attendance_self_marks', 'attendance_records', 'wf_absence_applications', 'wf_daily_ops'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12. Who may call what: the API gets the public wf_* functions (signed in only); the private helpers are for the functions only.
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
