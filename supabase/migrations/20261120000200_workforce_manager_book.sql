-- =====================================================================
-- হাজিরা খাতা (ম্যানেজারের) — the hub manager's monthly attendance book, the zonal manager's correction and
-- weekly / monthly submission, and the paid / unpaid count. 20 Nov 2026.
--
-- Owner (19 Nov 2026): "হাব ওয়েজ জোনাল ম্যানেজার এর মাসিক খাতা তার সেটিং থেকে কত দিন খুলা রাখবে না রাখবে তার সিধান্ত,
-- এই খানে ৪ ইনপুট — ১. হাবে উপস্থিত + অনলাইন হাজিরা ২. হাবে উপস্থিত + অনলাইন হাজিরা হয় নাই — অনুপস্থিত, WEBSITE আবেদন
-- দেওয়া আছে ডেট টু ডেট — অনুপস্থিত, WEBSITE আবেদন দেওয়া নেই, এখুনি আবেদন করেন — লেট হাজিরা টাইম সহ। ম্যানেজার আজকের খাতা
-- ক্লোজ সাবমিট দিলেই আর কারেকশন করতে পারবে না। স্টাফ আজকে এসেছি / আজকে আসি নাই — লিভ অ্যাপ্লিকেশন ডেট সাবমিট সাথে ছবি।
-- জোনাল ম্যানেজার কারেকশন দিয়ে সাবমিট দিবে মাসিক সাপ্তাহিক। পেইড ছুটি কাউন্ট … নন পেইড পেইড এর হিসাব সব প্যানেলে থাকবে,
-- হাজিরা খাতা সেটিং থেকে ঠিক করা হবে … নাম ও ডেট অনুযায়ী ডাটা জোনাল প্যানেলে … কোম্পানির নির্ধারিত ফরম্যাটে।"
--
--  * wf_book_rules       — the book's setting: company default (zone_id null) + one row per zone that overrides it
--                          (book days from…to, open or not, which input is paid / unpaid / paid-leave quota, the monthly
--                          paid-leave quota, every N-th late = one unpaid day, late after, week start, export format).
--  * wf_book_entries     — ONE input per person per date, written by the hub manager (or the zonal manager):
--                          hub_online · hub_no_online · late (+ time) · absent_site (website application from…to, number)
--                          · absent_no_site (the person is told "এখুনি ওয়েবসাইটে আবেদন করুন") · weekly_off · holiday.
--                          Each entry is also written to the existing register attendance_records (source 'book'),
--                          so every older screen, the salary lock and the staff book keep working from one place.
--  * wf_book_days        — "আজকের খাতা ক্লোজ": a hub's date, once closed, can no longer be changed by the hub manager.
--  * wf_book_submissions — the zonal manager's weekly / monthly submission (snapshot); a submitted date is locked for
--                          everybody until a company-wide admin reopens it with a reason.
--  * wf_book_entry_log   — every change, old → new, who, when, why (append-only).
--  * wf_absence_applications.photo_path + bucket wf-leave — the photo of the staff member's leave application.
--
-- Additive: new tables and functions; the register's source list gains 'book'; nothing existing is replaced.
-- Rollback: drop the wf_mb_* functions (public and private) and public.wf_absence_photo, the five tables above,
--   the column wf_absence_applications.photo_path, the bucket wf-leave and its two policies, then put the
--   attendance_records_source_check back to ('manual','kiosk','import','leave','self') once no row uses 'book'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The register accepts rows written from the book
-- ---------------------------------------------------------------------
alter table public.attendance_records drop constraint if exists attendance_records_source_check;
alter table public.attendance_records add constraint attendance_records_source_check
  check (source in ('manual', 'kiosk', 'import', 'leave', 'self', 'book'));

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.wf_book_rules (
  id         uuid primary key default gen_random_uuid(),
  zone_id    uuid references public.zones(id),             -- null = the company default
  rules      jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  format     jsonb not null default '[]'::jsonb check (jsonb_typeof(format) = 'array'),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index if not exists wf_book_rules_one on public.wf_book_rules ((coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid)));
create index if not exists wf_book_rules_zone_idx on public.wf_book_rules (zone_id);

create table if not exists public.wf_book_entries (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  hub_id      uuid references public.hubs(id),
  zone_id     uuid references public.zones(id),
  work_date   date not null,
  code        text not null check (code in ('hub_online', 'hub_no_online', 'late', 'absent_site', 'absent_no_site', 'weekly_off', 'holiday')),
  late_at     time,
  site_from   date,
  site_to     date,
  site_ref    text check (site_ref is null or char_length(site_ref) between 1 and 60),
  note        text check (note is null or length(note) <= 500),
  revision    integer not null default 1,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  unique (employee_id, work_date),
  constraint wf_be_late check ((code = 'late') = (late_at is not null)),
  constraint wf_be_site check (code = 'absent_site' or (site_from is null and site_to is null and site_ref is null)),
  constraint wf_be_site_range check (code <> 'absent_site' or (site_from is not null and site_to is not null and site_from <= site_to
                                                            and work_date between site_from and site_to))
);
create index if not exists wf_be_hub_idx on public.wf_book_entries (hub_id, work_date);
create index if not exists wf_be_zone_idx on public.wf_book_entries (zone_id, work_date);

create table if not exists public.wf_book_days (
  id        uuid primary key default gen_random_uuid(),
  hub_id    uuid not null references public.hubs(id),
  work_date date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid,
  how       text not null default 'manager' check (how in ('manager', 'zonal')),
  note      text check (note is null or length(note) <= 500),
  counts    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (hub_id, work_date)
);

create table if not exists public.wf_book_submissions (
  id           uuid primary key default gen_random_uuid(),
  zone_id      uuid not null references public.zones(id),
  kind         text not null check (kind in ('week', 'month')),
  date_from    date not null,
  date_to      date not null,
  note         text check (note is null or length(note) <= 500),
  totals       jsonb not null default '{}'::jsonb,
  snapshot     jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  submitted_by uuid,
  reopened_at  timestamptz,
  reopened_by  uuid,
  reopen_note  text check (reopen_note is null or length(reopen_note) <= 500),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint wf_bs_range check (date_from <= date_to and date_to - date_from <= 31),
  constraint wf_bs_reopen check ((reopened_at is null) = (reopen_note is null)),
  constraint wf_bs_no_overlap exclude using gist (zone_id with =, kind with =, daterange(date_from, date_to, '[]') with &&) where (reopened_at is null)
);
create index if not exists wf_bs_zone_idx on public.wf_book_submissions (zone_id, date_from desc);

create table if not exists public.wf_book_entry_log (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.wf_book_entries(id),
  employee_id uuid not null references public.employees(id),
  hub_id      uuid references public.hubs(id),
  work_date   date not null,
  revision    integer not null,
  action      text not null check (action in ('created', 'changed', 'corrected')),
  before      jsonb,
  after       jsonb not null,
  reason      text check (reason is null or length(reason) <= 500),
  by_user     uuid,
  at          timestamptz not null default now()
);
create index if not exists wf_bel_entry_idx on public.wf_book_entry_log (entry_id, revision);
create index if not exists wf_bel_hub_idx on public.wf_book_entry_log (hub_id, work_date);
create index if not exists wf_bel_employee_idx on public.wf_book_entry_log (employee_id, work_date);

alter table public.wf_absence_applications add column if not exists photo_path text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wf_app_photo_len') then
    alter table public.wf_absence_applications add constraint wf_app_photo_len check (photo_path is null or char_length(photo_path) between 1 and 300);
  end if;
end $$;
comment on column public.wf_absence_applications.photo_path is 'Photo of the leave application (bucket wf-leave, path <employee_id>/<file>)';

-- stamp / audit / never deleted; the log cannot be changed at all
do $$
declare t text;
begin
  foreach t in array array['wf_book_rules', 'wf_book_entries', 'wf_book_days', 'wf_book_submissions'] loop
    execute format('create or replace trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create or replace trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''hr'')', t || '_audit', t);
    execute format('create or replace trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create or replace function private.wf_mb_log_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'The attendance book history cannot be changed — খাতার ইতিহাস বদলানো যায় না' using errcode = '42501'; end $$;
create or replace trigger wf_book_entry_log_frozen before update or delete on public.wf_book_entry_log
  for each row execute function private.wf_mb_log_frozen();
create or replace trigger wf_book_entry_log_no_truncate before truncate on public.wf_book_entry_log
  for each statement execute function private.wf_mb_log_frozen();

-- Row security: the API may read (by permission), never write — every write goes through the functions below.
alter table public.wf_book_rules enable row level security;
alter table public.wf_book_entries enable row level security;
alter table public.wf_book_days enable row level security;
alter table public.wf_book_submissions enable row level security;
alter table public.wf_book_entry_log enable row level security;
revoke all on public.wf_book_rules, public.wf_book_entries, public.wf_book_days, public.wf_book_submissions, public.wf_book_entry_log from anon, authenticated;
grant select on public.wf_book_rules, public.wf_book_entries, public.wf_book_days, public.wf_book_submissions, public.wf_book_entry_log to authenticated;

drop policy if exists wf_br_read on public.wf_book_rules;
create policy wf_br_read on public.wf_book_rules for select to authenticated using (true);   -- the setting is not secret: every panel shows the paid rules
drop policy if exists wf_be_read on public.wf_book_entries;
create policy wf_be_read on public.wf_book_entries for select to authenticated
  using (private.is_self_employee(employee_id) or private.has_permission('hr.attendance.view', zone_id, hub_id));
drop policy if exists wf_bd_read on public.wf_book_days;
create policy wf_bd_read on public.wf_book_days for select to authenticated
  using (private.has_permission('hr.attendance.view', null, hub_id));
drop policy if exists wf_bs_read on public.wf_book_submissions;
create policy wf_bs_read on public.wf_book_submissions for select to authenticated
  using (private.has_permission('hr.attendance.view', zone_id, null));
drop policy if exists wf_bel_read on public.wf_book_entry_log;
create policy wf_bel_read on public.wf_book_entry_log for select to authenticated
  using (private.is_self_employee(employee_id) or private.has_permission('hr.attendance.view', null, hub_id));

-- The company default setting.
insert into public.wf_book_rules (zone_id, rules, format)
select null,
  jsonb_build_object(
    'from_day', 1, 'to_day', 17, 'open', true,
    'paid', jsonb_build_object('hub_online', 'paid', 'hub_no_online', 'paid', 'late', 'paid', 'absent_site', 'quota',
                               'absent_no_site', 'unpaid', 'weekly_off', 'paid', 'holiday', 'paid'),
    'paid_leave_quota', 2, 'late_per_deduct', 3, 'late_after', '09:30', 'week_start', 6),
  '[{"key":"code","label":"ID"},{"key":"name","label":"Name"},{"key":"position","label":"Designation"},{"key":"hub","label":"Hub"},
    {"key":"days","label":""},{"key":"present","label":"Present"},{"key":"late","label":"Late"},{"key":"absent_site","label":"Leave (website)"},
    {"key":"absent_no_site","label":"Absent (no application)"},{"key":"paid_days","label":"Paid days"},{"key":"unpaid_days","label":"Unpaid days"}]'::jsonb
where not exists (select 1 from public.wf_book_rules where zone_id is null);

-- ---------------------------------------------------------------------
-- 3. Helpers (private — never granted to the API)
-- ---------------------------------------------------------------------
create or replace function private.wf_mb_codes() returns text[]
language sql immutable set search_path = '' as $$
  select array['hub_online', 'hub_no_online', 'late', 'absent_site', 'absent_no_site', 'weekly_off', 'holiday']
$$;

-- The setting that applies to a zone: the company default, with the zone's own values on top ("paid" merged per input).
-- The format is the zone's own when it has one, else the company's.
create or replace function private.wf_mb_rules(p_zone uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select rules, format from public.wf_book_rules where zone_id is null),
       z as (select rules, format from public.wf_book_rules where p_zone is not null and zone_id = p_zone)
  select (coalesce((select rules from c), '{}'::jsonb) || coalesce((select rules from z), '{}'::jsonb))
         || jsonb_build_object('paid', coalesce((select rules -> 'paid' from c), '{}'::jsonb) || coalesce((select rules -> 'paid' from z), '{}'::jsonb),
                               'format', case when jsonb_array_length(coalesce((select format from z), '[]'::jsonb)) > 0 then (select format from z)
                                              else coalesce((select format from c), '[]'::jsonb) end,
                               'own', exists (select 1 from z))
$$;

-- Is this date inside a live (not reopened) zonal submission?  Returns that submission.
create or replace function private.wf_mb_locked(p_zone uuid, p_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.wf_book_submissions s
   where s.zone_id = p_zone and s.reopened_at is null and p_date between s.date_from and s.date_to
   order by s.submitted_at limit 1
$$;

create or replace function private.wf_mb_entry_json(b public.wf_book_entries) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('code', b.code, 'late_at', to_char(b.late_at, 'HH24:MI'), 'site_from', b.site_from, 'site_to', b.site_to,
                            'site_ref', b.site_ref, 'note', b.note)
$$;

-- THE one place that works out the book for people and dates: the entry, whether it is paid, and what the
-- person / the register already says (a suggestion for the manager). Scope is the caller's job.
--   paid: 'paid' inputs are paid, except every N-th late of a month (late_per_deduct, 0 = off);
--         'quota' inputs are paid while the month's paid-leave quota lasts (in date order), then unpaid; 'unpaid' never.
--   missing: no entry, a book day of the person's zone, the date has come, on/after joining, the person is active.
create or replace function private.wf_mb_cells(p_from date, p_to date, p_hubs uuid[], p_employee uuid default null)
returns table (employee_id uuid, work_date date, entry_id uuid, code text, late_at time, site_from date, site_to date, site_ref text,
               note text, revision integer, paid boolean, in_book boolean, missing boolean, suggest text, suggest_ref text, suggest_note text)
language sql stable security definer set search_path = '' as $$
  with emps as materialized (
    select e.id, e.joining_date, e.status, coalesce(h.zone_id, e.zone_id) as ez
    from public.employees e left join public.hubs h on h.id = e.hub_id
    where e.archived_at is null
      and (   (p_employee is not null and e.id = p_employee)
           or (p_employee is null and e.hub_id = any(p_hubs)
               and (e.status = 'active'
                    or exists (select 1 from public.wf_book_entries b where b.employee_id = e.id and b.work_date between p_from and p_to))))
  ),
  rz as materialized (select z.ez, private.wf_mb_rules(z.ez) as r from (select distinct emps.ez from emps) z),
  ent as (
    select b.*, coalesce(rz.r -> 'paid' ->> b.code, 'unpaid') as pv, rz.r
    from public.wf_book_entries b
    join emps e on e.id = b.employee_id
    join rz on rz.ez is not distinct from e.ez
    where b.work_date between date_trunc('month', p_from)::date and p_to
  ),
  ord as (
    select ent.*,
      row_number() over (partition by ent.employee_id, date_trunc('month', ent.work_date), (ent.pv = 'quota') order by ent.work_date) as qn,
      row_number() over (partition by ent.employee_id, date_trunc('month', ent.work_date), (ent.code = 'late') order by ent.work_date) as ln
    from ent
  ),
  pd as (
    select ord.*,
      case ord.pv
        when 'quota' then ord.qn <= coalesce((ord.r ->> 'paid_leave_quota')::numeric, 0)
        when 'paid' then not (ord.code = 'late' and coalesce((ord.r ->> 'late_per_deduct')::integer, 0) > 0
                              and ord.ln % (ord.r ->> 'late_per_deduct')::integer = 0)
        else false end as is_paid
    from ord
  )
  select e.id, d.d::date, pd.id, pd.code, pd.late_at, pd.site_from, pd.site_to, pd.site_ref, pd.note, pd.revision, pd.is_paid,
    ib.v,
    (pd.id is null and ib.v and d.d::date <= private.wf_today() and (e.joining_date is null or d.d::date >= e.joining_date) and e.status = 'active'),
    case when pd.id is null then coalesce(
      case m.kind when 'present' then 'hub_online' when 'absent' then case when m.applied_on_site then 'absent_site' else 'absent_no_site' end end,
      case r.status when 'present' then 'hub_online' when 'half_day' then 'hub_online' when 'late' then 'late' when 'absent' then 'absent_no_site'
                    when 'leave' then 'absent_site' when 'holiday' then 'holiday' when 'weekly_off' then 'weekly_off' end) end,
    case when pd.id is null then m.site_ref end,
    case when pd.id is null then m.note end
  from emps e
  join rz on rz.ez is not distinct from e.ez
  cross join generate_series(p_from, p_to, interval '1 day') d(d)
  cross join lateral (select extract(day from d.d)::integer between coalesce((rz.r ->> 'from_day')::integer, 1) and coalesce((rz.r ->> 'to_day')::integer, 31) as v) ib
  left join pd on pd.employee_id = e.id and pd.work_date = d.d::date
  left join public.attendance_self_marks m on m.employee_id = e.id and m.work_date = d.d::date and m.status in ('waiting', 'approved') and pd.id is null
  left join public.attendance_records r on r.employee_id = e.id and r.work_date = d.d::date and pd.id is null and m.id is null
$$;

-- Counts of a set of cells.
create or replace function private.wf_mb_sum(p_codes text[], p_paid boolean[], p_missing boolean[], p_inbook boolean[]) returns jsonb
language sql immutable set search_path = '' as $$
  with x as (select c, p, m, b from unnest(coalesce(p_codes, '{}'), coalesce(p_paid, '{}'), coalesce(p_missing, '{}'), coalesce(p_inbook, '{}')) as u(c, p, m, b))
  select jsonb_build_object(
    'hub_online', count(*) filter (where c = 'hub_online'), 'hub_no_online', count(*) filter (where c = 'hub_no_online'),
    'late', count(*) filter (where c = 'late'), 'absent_site', count(*) filter (where c = 'absent_site'),
    'absent_no_site', count(*) filter (where c = 'absent_no_site'), 'weekly_off', count(*) filter (where c = 'weekly_off'),
    'holiday', count(*) filter (where c = 'holiday'),
    'present', count(*) filter (where c in ('hub_online', 'hub_no_online', 'late')),
    'absent', count(*) filter (where c in ('absent_site', 'absent_no_site')),
    'entered', count(*) filter (where c is not null),
    'paid_days', count(*) filter (where c is not null and p), 'unpaid_days', count(*) filter (where c is not null and not p),
    'missing', count(*) filter (where m), 'book_days', count(*) filter (where b))
  from x
$$;

-- May the caller write this person's date now?  Raises a readable error when not; returns 'manager' or 'zonal'.
create or replace function private.wf_mb_may_write(p_hub uuid, p_zone uuid, p_date date, p_employee uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.wf_today(); r jsonb := private.wf_mb_rules(p_zone); v_zonal boolean; v_closed boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_date is null then raise exception 'Choose the date — তারিখ বাছুন' using errcode = '22023'; end if;
  if p_date > v_today then raise exception 'A future date cannot be written yet — আগামী তারিখের হাজিরা এখন লেখা যায় না' using errcode = '22023'; end if;
  if extract(day from p_date)::integer not between (r ->> 'from_day')::integer and (r ->> 'to_day')::integer then
    raise exception 'This date is not one of the book''s days (% to %) — এটি খাতার দিন নয়', r ->> 'from_day', r ->> 'to_day' using errcode = '22023';
  end if;
  if private.wf_mb_locked(p_zone, p_date) is not null then
    raise exception 'The zonal manager has already submitted this date — জোনাল ম্যানেজার এই তারিখ সাবমিট করেছেন, আর বদলানো যায় না' using errcode = '22023';
  end if;
  if p_employee is not null and private.is_self_employee(p_employee) and not private.is_super_admin() then
    raise exception 'Your own attendance is written by someone else — নিজের হাজিরা অন্য কেউ লিখবেন' using errcode = '42501';
  end if;
  v_zonal := private.has_permission('hr.attendance.configure', p_zone, p_hub);
  if v_zonal then
    if p_date < (date_trunc('month', v_today) - interval '2 months')::date then
      raise exception 'Only the last two months can be corrected — শুধু আগের দুই মাস সংশোধন করা যায়' using errcode = '22023';
    end if;
    return 'zonal';
  end if;
  if not private.has_permission('hr.attendance.create', p_zone, p_hub) then
    raise exception 'You may not write this hub''s attendance book — এই হাবের হাজিরা খাতা লেখার অনুমতি নেই' using errcode = '42501';
  end if;
  select exists (select 1 from public.wf_book_days d where d.hub_id = p_hub and d.work_date = p_date) into v_closed;
  if v_closed then
    raise exception 'This day is closed — the zonal manager corrects it now — এই দিনের খাতা ক্লোজ হয়েছে, এখন জোনাল ম্যানেজার সংশোধন করবেন' using errcode = '22023';
  end if;
  if not coalesce((r ->> 'open')::boolean, true) then
    raise exception 'The zonal manager has closed the book — জোনাল ম্যানেজার খাতা বন্ধ রেখেছেন' using errcode = '22023';
  end if;
  if date_trunc('month', p_date) <> date_trunc('month', v_today) then
    raise exception 'Only this month''s book can be written — শুধু এই মাসের খাতা লেখা যায়; আগের মাস জোনাল ম্যানেজার সংশোধন করবেন' using errcode = '22023';
  end if;
  return 'manager';
end $$;

-- ---------------------------------------------------------------------
-- 4. Setting
-- ---------------------------------------------------------------------
-- p_zone null = the company default.  Returns the company setting, the zone's own values, the result, and who may change what.
create or replace function public.wf_mb_rules_get(p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return jsonb_build_object(
    'zone', case when p_zone is null then null else (select jsonb_build_object('id', z.id, 'name', coalesce(nullif(z.name_bn, ''), z.name)) from public.zones z where z.id = p_zone) end,
    'company', (select jsonb_build_object('rules', r.rules, 'format', r.format, 'updated_at', r.updated_at) from public.wf_book_rules r where r.zone_id is null),
    'own', (select jsonb_build_object('rules', r.rules, 'format', r.format, 'updated_at', r.updated_at,
                                      'by_name', (select pr.full_name from public.profiles pr where pr.id = r.updated_by))
              from public.wf_book_rules r where p_zone is not null and r.zone_id = p_zone),
    'effective', private.wf_mb_rules(p_zone),
    'can_configure', case when p_zone is null then private.has_permission('hr.attendance.configure') else private.has_permission('hr.attendance.configure', p_zone, null) end,
    'can_company', private.has_permission('hr.attendance.configure'),
    'zones', (select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', coalesce(nullif(z.name_bn, ''), z.name),
                                                           'can_configure', private.has_permission('hr.attendance.configure', z.id, null)) order by z.name), '[]'::jsonb)
                from public.zones z where z.archived_at is null
                  and (private.has_permission_within_zone('hr.attendance.view', z.id) or private.has_permission('hr.attendance.configure', z.id, null))));
end $$;

-- Save the setting of a zone (or, p_zone null, the company default). p_rules may hold any of the keys; p_format null = keep.
-- p_reset true (zone only) = the zone follows the company default again (its own row keeps an empty setting).
create or replace function public.wf_mb_rules_save(p_zone uuid, p_rules jsonb, p_format jsonb default null, p_reset boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb := coalesce(p_rules, '{}'::jsonb); k text; x jsonb; v_from integer; v_to integer; v_eff jsonb; v_clean jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if (p_zone is null and not private.has_permission('hr.attendance.configure'))
     or (p_zone is not null and not private.has_permission('hr.attendance.configure', p_zone, null)) then
    raise exception 'You may not change this attendance book setting — হাজিরা খাতার সেটিং বদলানোর অনুমতি নেই' using errcode = '42501';
  end if;
  if p_zone is not null and not exists (select 1 from public.zones z where z.id = p_zone) then
    raise exception 'Unknown zone — জোন পাওয়া যায়নি' using errcode = '22023';
  end if;
  if jsonb_typeof(v) <> 'object' then raise exception 'The setting must be an object' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(v) loop
    if k not in ('from_day', 'to_day', 'open', 'paid', 'paid_leave_quota', 'late_per_deduct', 'late_after', 'week_start') then
      raise exception 'Unknown setting: % — অজানা সেটিং', k using errcode = '22023';
    end if;
  end loop;
  if v ? 'from_day' then
    if jsonb_typeof(v -> 'from_day') <> 'number' or (v ->> 'from_day')::numeric not between 1 and 28 or (v ->> 'from_day')::numeric % 1 <> 0 then
      raise exception 'The first day of the book must be 1 to 28 — খাতার প্রথম দিন ১ থেকে ২৮' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('from_day', (v ->> 'from_day')::integer);
  end if;
  if v ? 'to_day' then
    if jsonb_typeof(v -> 'to_day') <> 'number' or (v ->> 'to_day')::numeric not between 1 and 31 or (v ->> 'to_day')::numeric % 1 <> 0 then
      raise exception 'The last day of the book must be 1 to 31 — খাতার শেষ দিন ১ থেকে ৩১' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('to_day', (v ->> 'to_day')::integer);
  end if;
  if v ? 'open' then
    if jsonb_typeof(v -> 'open') <> 'boolean' then raise exception 'open must be true or false' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('open', (v ->> 'open')::boolean);
  end if;
  if v ? 'paid_leave_quota' then
    if jsonb_typeof(v -> 'paid_leave_quota') <> 'number' or (v ->> 'paid_leave_quota')::numeric not between 0 and 31 or (v ->> 'paid_leave_quota')::numeric % 1 <> 0 then
      raise exception 'Paid leave per month must be 0 to 31 days — মাসে পেইড ছুটি ০ থেকে ৩১ দিন' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('paid_leave_quota', (v ->> 'paid_leave_quota')::integer);
  end if;
  if v ? 'late_per_deduct' then
    if jsonb_typeof(v -> 'late_per_deduct') <> 'number' or (v ->> 'late_per_deduct')::numeric not between 0 and 31 or (v ->> 'late_per_deduct')::numeric % 1 <> 0 then
      raise exception 'Lates per unpaid day must be 0 (off) to 31 — কয়টি লেটে এক দিন কাটা: ০ (বন্ধ) থেকে ৩১' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('late_per_deduct', (v ->> 'late_per_deduct')::integer);
  end if;
  if v ? 'late_after' then
    if coalesce(v ->> 'late_after', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Late after must be a time like 09:30 — লেট ধরা হবে কখন থেকে, যেমন 09:30' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('late_after', v ->> 'late_after');
  end if;
  if v ? 'week_start' then
    if jsonb_typeof(v -> 'week_start') <> 'number' or (v ->> 'week_start')::numeric not between 0 and 6 or (v ->> 'week_start')::numeric % 1 <> 0 then
      raise exception 'The week starts on day 0 (Sunday) to 6 (Saturday)' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('week_start', (v ->> 'week_start')::integer);
  end if;
  if v ? 'paid' then
    if jsonb_typeof(v -> 'paid') <> 'object' then raise exception 'paid must be an object' using errcode = '22023'; end if;
    for k, x in select * from jsonb_each(v -> 'paid') loop
      if not (k = any(private.wf_mb_codes())) then raise exception 'Unknown input: % — অজানা ইনপুট', k using errcode = '22023'; end if;
      if coalesce(x #>> '{}', '') not in ('paid', 'unpaid', 'quota') then
        raise exception 'Each input is paid, unpaid or paid-leave quota — প্রতিটি ইনপুট পেইড, নন-পেইড বা পেইড ছুটির কোটা' using errcode = '22023'; end if;
    end loop;
    v_clean := v_clean || jsonb_build_object('paid', v -> 'paid');
  end if;
  if p_format is not null then
    if jsonb_typeof(p_format) <> 'array' or jsonb_array_length(p_format) > 60 then raise exception 'The format is a list of at most 60 columns' using errcode = '22023'; end if;
    for x in select * from jsonb_array_elements(p_format) loop
      if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'key', '') !~ '^[a-z_]{1,40}$' or length(coalesce(x ->> 'label', '')) > 80 then
        raise exception 'Each format column needs a key and a label (at most 80 characters) — প্রতিটি কলামের নাম দিন' using errcode = '22023'; end if;
    end loop;
  end if;

  if p_zone is null then
    update public.wf_book_rules set rules = rules || v_clean, format = coalesce(p_format, format) where zone_id is null;
  else
    insert into public.wf_book_rules (zone_id, rules, format) values (p_zone, case when p_reset then '{}'::jsonb else v_clean end, coalesce(p_format, '[]'::jsonb))
    on conflict ((coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    do update set rules = case when p_reset then '{}'::jsonb else public.wf_book_rules.rules || excluded.rules end,
                  format = case when p_reset then '[]'::jsonb when p_format is null then public.wf_book_rules.format else excluded.format end;
  end if;
  v_eff := private.wf_mb_rules(p_zone);
  v_from := (v_eff ->> 'from_day')::integer; v_to := (v_eff ->> 'to_day')::integer;
  if v_to < v_from then
    raise exception 'The last day of the book cannot be before the first — খাতার শেষ দিন প্রথম দিনের আগে হতে পারে না' using errcode = '22023';
  end if;
  return v_eff;
end $$;

-- ---------------------------------------------------------------------
-- 5. The hub manager's book
-- ---------------------------------------------------------------------
-- Everyone of the hub across the month's book days: each cell's input (or the suggestion from the person's own input /
-- the register), paid or not, which dates are closed or submitted, and what the caller may do.
create or replace function public.wf_mb_book(p_hub uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date;
  v_zone uuid; r jsonb; v_last integer; v_d1 date; v_d2 date; v_people jsonb; v_totals jsonb; v_days jsonb; v_me uuid;
  v_write boolean; v_zonal boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  v_zone := private.hub_zone(p_hub);
  r := private.wf_mb_rules(v_zone);
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_d1 := v_month + (least((r ->> 'from_day')::integer, v_last) - 1);
  v_d2 := v_month + (least((r ->> 'to_day')::integer, v_last) - 1);
  v_me := (select e.id from private.wf_me() e);
  v_write := private.has_permission('hr.attendance.create', v_zone, p_hub);
  v_zonal := private.has_permission('hr.attendance.configure', v_zone, p_hub);

  with t as materialized (select * from private.wf_mb_cells(v_d1, v_d2, array[p_hub]))
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.d::date,
        'closed', bd.id is not null, 'closed_at', bd.closed_at, 'closed_how', bd.how,
        'closed_by_name', (select pr.full_name from public.profiles pr where pr.id = bd.closed_by),
        'submitted', private.wf_mb_locked(v_zone, d.d::date) is not null,
        'entered', (select count(*) from t where t.work_date = d.d::date and t.code is not null),
        'missing', (select count(*) from t where t.work_date = d.d::date and t.missing),
        'missing_others', (select count(*) from t where t.work_date = d.d::date and t.missing and t.employee_id is distinct from v_me),
        'future', d.d::date > v_today) order by d.d), '[]'::jsonb)
       from generate_series(v_d1, v_d2, interval '1 day') d(d)
       left join public.wf_book_days bd on bd.hub_id = p_hub and bd.work_date = d.d::date),
    (select coalesce(jsonb_agg(p.j order by p.nm), '[]'::jsonb) from (
       select e.full_name as nm, jsonb_build_object(
         'employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'mobile', e.mobile, 'self', e.id = v_me,
         'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
         'cells', jsonb_agg(jsonb_build_object('c', t.code, 't', to_char(t.late_at, 'HH24:MI'), 'p', t.paid, 'id', t.entry_id, 'v', t.revision,
                                               'm', t.missing, 'b', t.in_book, 'sg', t.suggest, 'sr', t.suggest_ref, 'sn', t.suggest_note,
                                               'sf', t.site_from, 'st', t.site_to, 'ref', t.site_ref, 'n', t.note) order by t.work_date),
         'sum', private.wf_mb_sum(array_agg(t.code order by t.work_date), array_agg(t.paid order by t.work_date),
                                  array_agg(t.missing order by t.work_date), array_agg(t.in_book order by t.work_date))) as j
       from t join public.employees e on e.id = t.employee_id
       group by e.id) p),
    (select private.wf_mb_sum(array_agg(t.code), array_agg(t.paid), array_agg(t.missing), array_agg(t.in_book)) from t)
  into v_days, v_people, v_totals;

  return jsonb_build_object('hub', private.wf_hub_json(p_hub), 'month', v_month, 'today', v_today, 'rules', r,
    'open', coalesce((r ->> 'open')::boolean, true) and v_month = date_trunc('month', v_today)::date,
    'can', jsonb_build_object('view', true, 'write', v_write, 'close', v_write, 'zonal', v_zonal),
    'dates', (select coalesce(jsonb_agg(v_d1 + i order by i), '[]'::jsonb) from generate_series(0, v_d2 - v_d1) i),
    'days', v_days, 'people', v_people, 'totals', v_totals);
end $$;

-- Write one date for many people in one step (all or nothing).
-- p_items: [{employee_id, code, late_at?, site_from?, site_to?, site_ref?, note?}]. A changed entry on a closed day (zonal) needs p_reason.
create or replace function public.wf_mb_set(p_hub uuid, p_date date, p_items jsonb, p_reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid; v_how text; x jsonb; e public.employees; b public.wf_book_entries; v_new jsonb; v_old jsonb;
  v_code text; v_late time; v_sf date; v_st date; v_ref text; v_note text; v_reason text := private.wf_clean(p_reason);
  v_closed boolean; n integer := 0; v_status text; v_check timestamptz; m public.attendance_self_marks; v_ids uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null or not exists (select 1 from public.hubs h where h.id = p_hub) then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nothing to save — কিছু বাছা হয়নি' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'At most 500 people at a time' using errcode = '22023'; end if;
  v_zone := private.hub_zone(p_hub);
  perform pg_advisory_xact_lock(hashtextextended('wf_mb:' || p_hub::text || ':' || coalesce(p_date::text, ''), 0));
  v_how := private.wf_mb_may_write(p_hub, v_zone, p_date, null);
  select exists (select 1 from public.wf_book_days d where d.hub_id = p_hub and d.work_date = p_date) into v_closed;

  for x in select * from jsonb_array_elements(p_items) loop
    select * into e from public.employees where id = nullif(x ->> 'employee_id', '')::uuid and archived_at is null;
    if e.id is null or e.hub_id is distinct from p_hub then
      raise exception 'This person is not in this hub — এই কর্মী এই হাবের নন' using errcode = '22023'; end if;
    if e.id = any(v_ids) then raise exception 'The same person is listed twice — একই কর্মী দুবার' using errcode = '22023'; end if;
    v_ids := v_ids || e.id;
    perform private.wf_mb_may_write(p_hub, v_zone, p_date, e.id);
    if e.status <> 'active' then raise exception '% is not active — % সক্রিয় নন', e.full_name, e.full_name using errcode = '22023'; end if;
    if e.joining_date is not null and p_date < e.joining_date then
      raise exception '% joined later — % এর যোগদানের আগের তারিখ', e.full_name, e.full_name using errcode = '22023'; end if;
    v_code := x ->> 'code';
    if v_code is null or not (v_code = any(private.wf_mb_codes())) then
      raise exception 'Choose one of the inputs — একটি ইনপুট বাছুন' using errcode = '22023'; end if;
    v_late := null; v_sf := null; v_st := null; v_ref := null;
    if v_code = 'late' then
      if coalesce(x ->> 'late_at', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Write the time they came — কখন এসেছেন সেই সময় লিখুন (যেমন 10:15)' using errcode = '22023'; end if;
      v_late := (x ->> 'late_at')::time;
    elsif v_code = 'absent_site' then
      v_sf := nullif(x ->> 'site_from', '')::date; v_st := nullif(x ->> 'site_to', '')::date;
      if v_sf is null or v_st is null then
        raise exception 'Write the website application''s dates (from – to) — ওয়েবসাইটের আবেদনের তারিখ (থেকে – পর্যন্ত) দিন' using errcode = '22023'; end if;
      if v_sf > v_st or p_date not between v_sf and v_st then
        raise exception 'The application''s dates must include this date — আবেদনের তারিখের মধ্যে এই দিনটি থাকতে হবে' using errcode = '22023'; end if;
      if v_st - v_sf > 62 then raise exception 'An application covers at most 62 days' using errcode = '22023'; end if;
      v_ref := private.wf_clean(x ->> 'site_ref', 60);
    end if;
    v_note := private.wf_clean(x ->> 'note');
    v_new := jsonb_build_object('code', v_code, 'late_at', to_char(v_late, 'HH24:MI'), 'site_from', v_sf, 'site_to', v_st, 'site_ref', v_ref, 'note', v_note);

    select * into b from public.wf_book_entries where employee_id = e.id and work_date = p_date for update;
    if b.id is not null then
      v_old := private.wf_mb_entry_json(b);
      continue when v_old = v_new;          -- same input again: nothing changes
      if v_closed and v_reason is null then
        raise exception 'Write why this closed day is corrected — ক্লোজ হওয়া দিনের সংশোধনের কারণ লিখুন' using errcode = '22023'; end if;
      update public.wf_book_entries set code = v_code, late_at = v_late, site_from = v_sf, site_to = v_st, site_ref = v_ref, note = v_note,
             revision = revision + 1, hub_id = p_hub, zone_id = v_zone
       where id = b.id returning * into b;
      insert into public.wf_book_entry_log (entry_id, employee_id, hub_id, work_date, revision, action, before, after, reason, by_user)
      values (b.id, e.id, p_hub, p_date, b.revision, case when v_how = 'zonal' then 'corrected' else 'changed' end, v_old, v_new, v_reason, auth.uid());
    else
      insert into public.wf_book_entries (employee_id, hub_id, zone_id, work_date, code, late_at, site_from, site_to, site_ref, note)
      values (e.id, p_hub, v_zone, p_date, v_code, v_late, v_sf, v_st, v_ref, v_note) returning * into b;
      insert into public.wf_book_entry_log (entry_id, employee_id, hub_id, work_date, revision, action, before, after, reason, by_user)
      values (b.id, e.id, p_hub, p_date, 1, case when v_how = 'zonal' and v_closed then 'corrected' else 'created' end, null, v_new, v_reason, auth.uid());
    end if;

    -- the register (one place every older screen reads)
    v_status := case v_code when 'hub_online' then 'present' when 'hub_no_online' then 'present' when 'late' then 'late'
                            when 'absent_site' then 'leave' when 'absent_no_site' then 'absent' else v_code end;
    v_check := case when v_late is not null then (p_date + v_late) at time zone 'Asia/Dhaka' end;
    insert into public.attendance_records as a (employee_id, work_date, status, check_in, source, note)
    values (e.id, p_date, v_status, v_check, 'book', 'হাজিরা খাতা: ' || v_code || coalesce(' — ' || v_reason, ''))
    on conflict (employee_id, work_date) do update
      set status = excluded.status, source = 'book', note = excluded.note,
          check_in = coalesce(excluded.check_in, case when excluded.status = 'late' then a.check_in end),
          check_out = case when a.check_out < coalesce(excluded.check_in, a.check_in) then null else a.check_out end;
    -- the person's own waiting input for that date is settled by the book
    for m in select * from public.attendance_self_marks s where s.employee_id = e.id and s.work_date = p_date and s.status = 'waiting' loop
      perform private.wf_close_on_register(m, 'হাজিরা খাতায় লেখা হয়েছে');
    end loop;
    -- "এখুনি আবেদন করুন": tell the person
    if v_code = 'absent_no_site' and (v_old is null or v_old ->> 'code' is distinct from 'absent_no_site') then
      perform private.notify(e.profile_id, 'ওয়েবসাইটে এখুনি ছুটির আবেদন করুন',
        format('%s তারিখে আপনি অনুপস্থিত, কিন্তু Steadfast ওয়েবসাইটে আবেদন দেওয়া নেই — এখুনি আবেদন করুন, তারপর আবেদনের নম্বর ও তারিখ হাজিরা বইয়ে দিন।', to_char(p_date, 'DD/MM/YYYY')),
        '/app/workforce/attendance', 'attendance');
    end if;
    v_old := null;
    n := n + 1;
  end loop;
  return n;
end $$;

-- "আজকের খাতা ক্লোজ": after this the hub manager cannot change the date; the zonal manager corrects it.
-- Everyone of the hub must have an input first (the closer's own row is left to the zonal manager).
create or replace function public.wf_mb_close(p_hub uuid, p_date date, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_how text; v_missing integer; v_names text; v_counts jsonb; v_me uuid := (select e.id from private.wf_me() e);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null or not exists (select 1 from public.hubs h where h.id = p_hub) then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  v_zone := private.hub_zone(p_hub);
  perform pg_advisory_xact_lock(hashtextextended('wf_mb:' || p_hub::text || ':' || coalesce(p_date::text, ''), 0));
  if exists (select 1 from public.wf_book_days d where d.hub_id = p_hub and d.work_date = p_date) then
    raise exception 'This day is already closed — এই দিনের খাতা আগেই ক্লোজ হয়েছে' using errcode = '23505'; end if;
  v_how := private.wf_mb_may_write(p_hub, v_zone, p_date, null);
  select count(*), string_agg(e.full_name, ', ' order by e.full_name)
    into v_missing, v_names
    from private.wf_mb_cells(p_date, p_date, array[p_hub]) c join public.employees e on e.id = c.employee_id
   where c.missing and (v_how = 'zonal' or c.employee_id is distinct from v_me);
  if v_missing > 0 then
    raise exception '% people still have no input: % — এখনো % জনের হাজিরা লেখা হয়নি', v_missing, left(v_names, 300), v_missing using errcode = '22023';
  end if;
  select private.wf_mb_sum(array_agg(c.code), array_agg(c.paid), array_agg(c.missing), array_agg(c.in_book)) into v_counts
    from private.wf_mb_cells(p_date, p_date, array[p_hub]) c;
  insert into public.wf_book_days (hub_id, work_date, closed_by, how, note, counts)
  values (p_hub, p_date, auth.uid(), v_how, private.wf_clean(p_note), v_counts);
  return v_counts;
end $$;

-- What changed in a hub's book: old → new, who, when, why.
create or replace function public.wf_mb_history(p_hub uuid, p_employee uuid default null, p_month date default null, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'entry_id', l.entry_id, 'employee_id', l.employee_id, 'employee_name', e.full_name,
            'employee_code', e.employee_code::text, 'work_date', l.work_date, 'revision', l.revision, 'action', l.action, 'before', l.before, 'after', l.after,
            'reason', l.reason, 'by_name', pr.full_name, 'at', l.at) order by l.at desc), '[]'::jsonb)
    from (select * from public.wf_book_entry_log l
           where l.hub_id = p_hub and (p_employee is null or l.employee_id = p_employee)
             and l.work_date >= v_month and l.work_date < (v_month + interval '1 month')::date
           order by l.at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) l
    join public.employees e on e.id = l.employee_id
    left join public.profiles pr on pr.id = l.by_user);
end $$;

-- ---------------------------------------------------------------------
-- 6. The zonal manager: everyone of the zone by name and date, submit weekly / monthly
-- ---------------------------------------------------------------------
create or replace function public.wf_mb_sheet(p_zone uuid default null, p_hub uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_from date := coalesce(p_from, date_trunc('month', private.wf_today())::date);
  v_to date := coalesce(p_to, private.wf_today()); v_hubs uuid[]; v_people jsonb; v_totals jsonb; v_hubrows jsonb; v_subs jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_to < v_from then raise exception 'The last date is before the first — শেষ তারিখ প্রথম তারিখের আগে' using errcode = '22023'; end if;
  if v_to - v_from > 61 then raise exception 'At most 62 days at a time — একবারে সর্বোচ্চ ৬২ দিন' using errcode = '22023'; end if;
  select coalesce(array_agg(h.hub_id), '{}') into v_hubs from private.wf_hubs('hr.attendance.view', p_zone, p_hub) h;

  with t as materialized (select c.*, e.hub_id as hid from private.wf_mb_cells(v_from, v_to, v_hubs) c join public.employees e on e.id = c.employee_id)
  select
    (select coalesce(jsonb_agg(p.j order by p.hn, p.nm), '[]'::jsonb) from (
       select e.full_name as nm, coalesce(nullif(h.name_bn, ''), h.name) as hn, jsonb_build_object(
         'employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'mobile', e.mobile,
         'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
         'hub_id', h.id, 'hub_name', coalesce(nullif(h.name_bn, ''), h.name), 'zone_id', h.zone_id,
         'cells', jsonb_agg(jsonb_build_object('c', t.code, 't', to_char(t.late_at, 'HH24:MI'), 'p', t.paid, 'id', t.entry_id, 'm', t.missing, 'b', t.in_book,
                                               'ref', t.site_ref, 'sf', t.site_from, 'st', t.site_to, 'n', t.note, 'v', t.revision) order by t.work_date),
         'sum', private.wf_mb_sum(array_agg(t.code order by t.work_date), array_agg(t.paid order by t.work_date),
                                  array_agg(t.missing order by t.work_date), array_agg(t.in_book order by t.work_date))) as j
       from t join public.employees e on e.id = t.employee_id left join public.hubs h on h.id = e.hub_id
       group by e.id, h.id) p),
    (select private.wf_mb_sum(array_agg(t.code), array_agg(t.paid), array_agg(t.missing), array_agg(t.in_book)) from t),
    (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', coalesce(nullif(h.name_bn, ''), h.name), 'zone_id', h.zone_id,
              'people', (select count(distinct t.employee_id) from t where t.hid = h.id),
              'missing', (select count(*) from t where t.hid = h.id and t.missing),
              'closed', (select coalesce(jsonb_agg(d.work_date order by d.work_date), '[]'::jsonb) from public.wf_book_days d
                          where d.hub_id = h.id and d.work_date between v_from and v_to)) order by h.name), '[]'::jsonb)
       from public.hubs h where h.id = any(v_hubs))
  into v_people, v_totals, v_hubrows;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'zone_id', s.zone_id, 'kind', s.kind, 'date_from', s.date_from, 'date_to', s.date_to,
           'submitted_at', s.submitted_at, 'by_name', (select pr.full_name from public.profiles pr where pr.id = s.submitted_by),
           'reopened_at', s.reopened_at) order by s.date_from), '[]'::jsonb)
    into v_subs from public.wf_book_submissions s
   where s.zone_id in (select distinct h.zone_id from public.hubs h where h.id = any(v_hubs))
     and s.date_from <= v_to and s.date_to >= v_from and s.reopened_at is null;

  return jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today,
    'zone', case when p_zone is null then null else (select jsonb_build_object('id', z.id, 'name', coalesce(nullif(z.name_bn, ''), z.name)) from public.zones z where z.id = p_zone) end,
    'rules', private.wf_mb_rules(coalesce(p_zone, private.hub_zone(p_hub))),
    'can', jsonb_build_object('submit', p_zone is not null and private.has_permission('hr.attendance.configure', p_zone, null),
                              'correct', coalesce(p_zone is not null and private.has_permission('hr.attendance.configure', p_zone, null), false)),
    'dates', (select coalesce(jsonb_agg(v_from + i order by i), '[]'::jsonb) from generate_series(0, v_to - v_from) i),
    'hubs', v_hubrows, 'people', v_people, 'totals', v_totals, 'submissions', v_subs);
end $$;

-- The zonal manager submits a week (7 days from p_from) or a month (that month's book days) of the zone.
-- Nobody may still be without an input; the hubs' unclosed days are closed by the submission; the result is kept as it was sent.
create or replace function public.wf_mb_submit(p_zone uuid, p_kind text, p_from date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_from date; v_to date; r jsonb; v_last integer; v_sheet jsonb; v_missing integer; v_id uuid; v_today date := private.wf_today();
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_zone is null then raise exception 'Choose a zone — জোন বাছুন' using errcode = '22023'; end if;
  if not private.has_permission('hr.attendance.configure', p_zone, null) then
    raise exception 'Only the zone''s zonal manager submits the book — শুধু জোনাল ম্যানেজার খাতা সাবমিট করেন' using errcode = '42501'; end if;
  if p_from is null then raise exception 'Choose the first date — প্রথম তারিখ বাছুন' using errcode = '22023'; end if;
  r := private.wf_mb_rules(p_zone);
  if p_kind = 'week' then
    v_from := p_from; v_to := p_from + 6;
  elsif p_kind = 'month' then
    v_from := date_trunc('month', p_from)::date;
    v_last := extract(day from (v_from + interval '1 month' - interval '1 day'))::integer;
    v_to := v_from + (least((r ->> 'to_day')::integer, v_last) - 1);
    v_from := v_from + (least((r ->> 'from_day')::integer, v_last) - 1);
  else
    raise exception 'Weekly or monthly — সাপ্তাহিক না মাসিক, বাছুন' using errcode = '22023';
  end if;
  if v_to > v_today then
    raise exception 'The period has not ended yet (last date %) — সময়টি এখনো শেষ হয়নি', v_to using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf_mb_zone:' || p_zone::text, 0));
  if exists (select 1 from public.wf_book_submissions s where s.zone_id = p_zone and s.kind = p_kind and s.reopened_at is null
              and s.date_from <= v_to and s.date_to >= v_from) then
    raise exception 'This period is already submitted — এই সময়ের খাতা আগেই সাবমিট হয়েছে' using errcode = '23505'; end if;
  v_sheet := public.wf_mb_sheet(p_zone, null, v_from, v_to);
  v_missing := (v_sheet #>> '{totals,missing}')::integer;
  if v_missing > 0 then
    raise exception '% inputs are still missing in the zone — জোনে এখনো % টি হাজিরা লেখা বাকি', v_missing, v_missing using errcode = '22023'; end if;
  insert into public.wf_book_days (hub_id, work_date, closed_by, how, note, counts)
  select h.id, d.d::date, auth.uid(), 'zonal', 'জোনাল সাবমিটের সাথে ক্লোজ', '{}'::jsonb
    from public.hubs h cross join generate_series(v_from, v_to, interval '1 day') d(d)
   where h.zone_id = p_zone and h.archived_at is null
     and extract(day from d.d)::integer between (r ->> 'from_day')::integer and (r ->> 'to_day')::integer
  on conflict (hub_id, work_date) do nothing;
  insert into public.wf_book_submissions (zone_id, kind, date_from, date_to, note, totals, snapshot, submitted_by)
  values (p_zone, p_kind, v_from, v_to, private.wf_clean(p_note), v_sheet -> 'totals', v_sheet, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- The zone's submissions (newest first). With p_id: that one, with the snapshot as it was sent.
create or replace function public.wf_mb_submissions(p_zone uuid default null, p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'zone_id', s.zone_id,
            'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = s.zone_id),
            'kind', s.kind, 'date_from', s.date_from, 'date_to', s.date_to, 'note', s.note, 'totals', s.totals,
            'submitted_at', s.submitted_at, 'by_name', (select pr.full_name from public.profiles pr where pr.id = s.submitted_by),
            'reopened_at', s.reopened_at, 'reopen_note', s.reopen_note,
            'reopened_by_name', (select pr.full_name from public.profiles pr where pr.id = s.reopened_by),
            'snapshot', case when p_id is not null then s.snapshot end) order by s.date_from desc, s.submitted_at desc), '[]'::jsonb)
    from (select * from public.wf_book_submissions s
           where (p_id is null or s.id = p_id) and (p_zone is null or s.zone_id = p_zone)
             and private.has_permission('hr.attendance.view', s.zone_id, null)
           order by s.date_from desc limit 100) s);
end $$;

-- A company-wide admin reopens a submission (reason required): its dates can be corrected again and submitted anew.
create or replace function public.wf_mb_reopen(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_note text := private.wf_clean(p_note);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not private.has_permission('hr.attendance.configure') then
    raise exception 'Only a company-wide admin reopens a submitted book — শুধু হেড অফিস খুলে দিতে পারে' using errcode = '42501'; end if;
  if v_note is null then raise exception 'Write why it is reopened — কেন খুলছেন লিখুন' using errcode = '22023'; end if;
  update public.wf_book_submissions set reopened_at = now(), reopened_by = auth.uid(), reopen_note = v_note where id = p_id and reopened_at is null;
  if not found then raise exception 'No such submission, or it is already reopened' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. The staff member: my book entries and my paid / unpaid count; the photo of a leave application
-- ---------------------------------------------------------------------
create or replace function public.wf_mb_mine(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_zone uuid; r jsonb;
  v_last integer; v_d1 date; v_d2 date; v_days jsonb; v_sum jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then return null; end if;
  v_zone := private.wf_zone_of(e.hub_id, e.zone_id);
  r := private.wf_mb_rules(v_zone);
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_d1 := v_month; v_d2 := v_month + (v_last - 1);
  select coalesce(jsonb_agg(jsonb_build_object('date', c.work_date, 'c', c.code, 't', to_char(c.late_at, 'HH24:MI'), 'p', c.paid, 'm', c.missing, 'b', c.in_book,
                                               'ref', c.site_ref, 'sf', c.site_from, 'st', c.site_to, 'n', c.note) order by c.work_date), '[]'::jsonb),
         private.wf_mb_sum(array_agg(c.code), array_agg(c.paid), array_agg(c.missing), array_agg(c.in_book))
    into v_days, v_sum
    from private.wf_mb_cells(v_d1, v_d2, null, e.id) c;
  return jsonb_build_object('month', v_month, 'today', private.wf_today(), 'rules', r - 'format', 'days', v_days, 'sum', v_sum);
end $$;

-- The staff member adds (or replaces) the photo of their own pending leave application.
create or replace function public.wf_absence_photo(p_application uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.wf_absence_applications; v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into a from public.wf_absence_applications where id = p_application for update;
  if a.id is null or not private.is_self_employee(a.employee_id) then
    raise exception 'This is not your application — এটি আপনার আবেদন নয়' using errcode = '42501'; end if;
  if a.status <> 'pending' then raise exception 'Only a pending application takes a photo — শুধু অপেক্ষায় থাকা আবেদনে ছবি দেওয়া যায়' using errcode = '22023'; end if;
  if v_path is null or v_path !~ ('^' || a.employee_id::text || '/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'Upload the photo first — আগে ছবি তুলুন' using errcode = '22023'; end if;
  update public.wf_absence_applications set photo_path = v_path where id = a.id;
end $$;

-- Photos of leave applications: private bucket, path <employee_id>/<file>. The person uploads their own;
-- whoever may see the person's attendance may look at it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wf-leave', 'wf-leave', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create or replace function private.wf_leave_object_emp(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' then split_part(p_name, '/', 1)::uuid end
$$;
revoke all on function private.wf_leave_object_emp(text) from public, anon;
grant execute on function private.wf_leave_object_emp(text) to authenticated;
drop policy if exists wf_leave_read on storage.objects;
create policy wf_leave_read on storage.objects for select to authenticated
  using (bucket_id = 'wf-leave' and (private.is_self_employee(private.wf_leave_object_emp(name))
                                     or private.employee_has_permission('hr.attendance.view', private.wf_leave_object_emp(name))));
drop policy if exists wf_leave_write on storage.objects;
create policy wf_leave_write on storage.objects for insert to authenticated
  with check (bucket_id = 'wf-leave' and private.is_self_employee(private.wf_leave_object_emp(name)));

-- wf_applications / wf_my_book read the application rows through private.wf_app_json; the photo travels in a small extra call
-- (so those tested functions stay exactly as they are).
create or replace function public.wf_absence_photos(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(a.id, a.photo_path), '{}'::jsonb) from public.wf_absence_applications a
   where a.id = any(coalesce(p_ids, '{}')) and a.photo_path is not null and auth.uid() is not null
     and (private.is_self_employee(a.employee_id) or private.employee_has_permission('hr.attendance.view', a.employee_id))
$$;

-- ---------------------------------------------------------------------
-- 8. Live updates and who may call what
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['wf_book_entries', 'wf_book_days', 'wf_book_submissions'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.wf_mb_rules_get(uuid)', 'public.wf_mb_rules_save(uuid, jsonb, jsonb, boolean)', 'public.wf_mb_book(uuid, date)',
    'public.wf_mb_set(uuid, date, jsonb, text)', 'public.wf_mb_close(uuid, date, text)', 'public.wf_mb_history(uuid, uuid, date, integer)',
    'public.wf_mb_sheet(uuid, uuid, date, date)', 'public.wf_mb_submit(uuid, text, date, text)', 'public.wf_mb_submissions(uuid, uuid)',
    'public.wf_mb_reopen(uuid, text)', 'public.wf_mb_mine(date)', 'public.wf_absence_photo(uuid, text)', 'public.wf_absence_photos(uuid[])']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'private.wf_mb_codes()', 'private.wf_mb_rules(uuid)', 'private.wf_mb_locked(uuid, date)', 'private.wf_mb_entry_json(public.wf_book_entries)',
    'private.wf_mb_cells(date, date, uuid[], uuid)', 'private.wf_mb_sum(text[], boolean[], boolean[], boolean[])',
    'private.wf_mb_may_write(uuid, uuid, date, uuid)', 'private.wf_mb_log_frozen()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
