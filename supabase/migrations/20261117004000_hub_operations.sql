-- =====================================================================
-- XZM-TEAM ERP — হাব অপারেশন ড্যাশবোর্ড (Hub Operations Dashboard), inside the Zonal Manager panel
--
-- Owner (17 Nov): a hub-wise dashboard for the zonal manager's zone. Each hub has its own input panel with the staff
--   grouped by designation (Manager, Hub CC, Entry Man and other configurable groups). The zonal manager enters total
--   parcels, total pickups, remarks and operational reasons for every hub, and a status for every person
--   (Active / New Employee / Resigned and Present / Absent / Leave Applied / Leave Not Applied). Every status change is
--   logged with date, reason, hub and remarks. Hub summaries roll up into one zonal summary, and the zonal manager sends
--   daily, weekly and monthly reports to the boss (Pending → Submitted → Reviewed).
--
-- Rules:
--   * Totals come ONLY from submitted (or reviewed) hub reports. Nothing is generated or assumed: a number nobody entered
--     stays null ("not entered"), a person nobody marked counts as "not marked", a day without a report is "missing".
--   * No new employee or hub records: rows reference public.hubs and public.employees. A person who is not in HR yet can be
--     written into a report by name (employee_id null); a mobile or name that already belongs to an employee is refused so
--     the existing record is picked instead. Employment changes in HR stay in the HR workflow (hr_change_status).
--   * A submitted report can be corrected only with a reason; every change is in audit_logs (old → new) and the version
--     goes up. A corrected report goes back to "submitted" for review. Nothing is deleted.
--   * Scope: every function checks private.has_permission with the hub / zone, so a zonal manager (zone grant) reaches
--     only their own zone. The tables are not readable directly (RLS on, no grants).
--   * The person who submitted cannot review (maker / checker).
--
-- Additive only. Rollback: drop the hub_ops_* functions and tables, delete the zonal.hub_ops.* permissions and the
-- zonal.hub_ops.defaults setting.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description) values
  ('zonal.hub_ops.view',      'zonal', 'hub_ops', 'view',      'See hub operation reports, summaries and boss reports'),
  ('zonal.hub_ops.create',    'zonal', 'hub_ops', 'create',    'Enter and submit hub operation reports and boss reports'),
  ('zonal.hub_ops.edit',      'zonal', 'hub_ops', 'edit',      'Correct submitted hub operation reports (reason required, kept in history)'),
  ('zonal.hub_ops.approve',   'zonal', 'hub_ops', 'approve',   'Review hub operation reports and boss reports'),
  ('zonal.hub_ops.export',    'zonal', 'hub_ops', 'export',    'Download and print hub operation reports'),
  ('zonal.hub_ops.configure', 'zonal', 'hub_ops', 'configure', 'Set designation groups, reasons and report days of a zone')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code like 'zonal.hub\_ops.%'
 where r.code = 'admin'
    or (r.code = 'zonal_manager' and p.action in ('view', 'create', 'edit', 'export', 'configure'))
    or (r.code = 'head_office_manager' and p.action in ('view', 'approve', 'export'))
    or (r.code = 'auditor' and p.action in ('view', 'export'))
on conflict do nothing;
-- (The Zonal Assistant role keeps its fixed set; the Super Admin can add zonal.hub_ops.view from Roles & permissions.)

-- ---------------------------------------------------------------------
-- 2. Defaults (each zone may override them in hub_ops_config)
--    groups: designation groups in display order. A post goes to the first group that lists its id, otherwise to the
--    first group whose pattern matches the post's name / Bangla name / code; anything else is "অন্যান্য" (other).
--    off_days: ISO weekdays (1 = Monday … 7 = Sunday) on which no report is expected. week_start: ISO weekday a week
--    starts on (6 = Saturday, as in Bangladesh).
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('zonal.hub_ops.defaults', $json${
    "groups": [
      {"key": "manager",   "bn": "ম্যানেজার",          "en": "Manager",           "core": true,  "position_ids": [], "pattern": "manager|ম্যানেজার"},
      {"key": "hub_cc",    "bn": "হাব সিসি",           "en": "Hub CC",            "core": true,  "position_ids": [], "pattern": "hub\\s*cc|সিসি"},
      {"key": "entry_man", "bn": "এন্ট্রি ম্যান",        "en": "Entry Man",         "core": true,  "position_ids": [], "pattern": "entry|এন্ট্রি"},
      {"key": "rider",     "bn": "রাইডার",             "en": "Rider",             "core": false, "position_ids": [], "pattern": "rider|রাইডার"},
      {"key": "sorting",   "bn": "সর্টিং ও লোডার",      "en": "Sorting & loader",  "core": false, "position_ids": [], "pattern": "sort|short|load|সর্টিং|লোডার"},
      {"key": "driver",    "bn": "ড্রাইভার",            "en": "Driver",            "core": false, "position_ids": [], "pattern": "driver|ড্রাইভার"},
      {"key": "support",   "bn": "হেল্পার ও সিকিউরিটি",  "en": "Helper & security", "core": false, "position_ids": [], "pattern": "helper|security|guard|হেল্পার|সিকিউরিটি|গার্ড"}
    ],
    "reasons": ["লোক কম ছিল", "পার্সেল কম এসেছে", "গাড়ি দেরিতে এসেছে", "বৃষ্টি / আবহাওয়া", "রাস্তা বন্ধ / হরতাল",
                "সার্ভার / অ্যাপ সমস্যা", "মার্চেন্ট পিকআপ দেয়নি", "বিদ্যুৎ ছিল না"],
    "off_days": [],
    "week_start": 6
  }$json$::jsonb, 'Hub operations: default designation groups, operational reasons, days without a report and week start')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------
create table public.hub_ops_config (
  zone_id      uuid primary key references public.zones(id),
  groups       jsonb check (groups is null or jsonb_typeof(groups) = 'array'),     -- null = default groups
  reasons      jsonb check (reasons is null or jsonb_typeof(reasons) = 'array'),   -- null = default reasons
  skip_hub_ids uuid[] not null default '{}',     -- hubs from which no report is expected (e.g. no staff yet)
  off_days     integer[] not null default '{}' check (off_days <@ array[1, 2, 3, 4, 5, 6, 7]),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

-- One report per hub per day.
create table public.hub_ops_reports (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),          -- the hub's zone when the report was made
  report_date   date not null,
  total_parcels integer check (total_parcels >= 0),                 -- null = not entered (never assumed 0)
  total_pickups integer check (total_pickups >= 0),
  reasons       text[] not null default '{}',                       -- operational reasons (tags)
  remarks       text,
  status        text not null default 'pending' check (status in ('pending', 'submitted', 'reviewed')),
  version       integer not null default 1,
  last_correction text,
  submitted_by  uuid, submitted_by_name text, submitted_at timestamptz,
  reviewed_by   uuid, reviewed_by_name text, reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint hub_ops_reports_one_per_day unique (hub_id, report_date),
  constraint hub_ops_reports_submitted check (status = 'pending' or submitted_at is not null)
);
create index hub_ops_reports_zone_date on public.hub_ops_reports (zone_id, report_date);

-- The people of a report, one row per person.
create table public.hub_ops_staff (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.hub_ops_reports(id),
  hub_id       uuid not null references public.hubs(id),
  report_date  date not null,
  employee_id  uuid references public.employees(id),               -- null = not in HR yet (written by name)
  person_name  text not null check (length(trim(person_name)) > 1),
  mobile       text,
  position_id  uuid references public.positions(id),
  group_key    text not null,
  attendance   text check (attendance in ('present', 'absent', 'leave_applied', 'leave_not_applied')),  -- null = not marked
  employment   text not null default 'active' check (employment in ('active', 'new', 'resigned')),
  reason       text,
  remarks      text,
  removed_at   timestamptz,                                        -- taken off the report (kept for history)
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index hub_ops_staff_one_employee on public.hub_ops_staff (report_id, employee_id)
  where employee_id is not null and removed_at is null;
create index hub_ops_staff_report on public.hub_ops_staff (report_id);
create index hub_ops_staff_employee on public.hub_ops_staff (employee_id, report_date desc);
create index hub_ops_staff_hub_date on public.hub_ops_staff (hub_id, report_date);
create index hub_ops_staff_position on public.hub_ops_staff (position_id);

-- Every status change of a person: date, hub, from → to, reason, remarks, who and when. Append-only.
create table public.hub_ops_status_log (
  id            bigint generated always as identity primary key,
  staff_id      uuid not null references public.hub_ops_staff(id),
  report_id     uuid not null references public.hub_ops_reports(id),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  employee_id   uuid references public.employees(id),
  person_name   text not null,
  status_date   date not null,
  field         text not null check (field in ('attendance', 'employment')),
  from_value    text,
  to_value      text,
  reason        text,
  remarks       text,
  changed_by    uuid default auth.uid(),
  changed_by_name text,
  changed_at    timestamptz not null default now()
);
create index hub_ops_status_log_zone on public.hub_ops_status_log (zone_id, status_date desc);
create index hub_ops_status_log_employee on public.hub_ops_status_log (employee_id, status_date desc);
create index hub_ops_status_log_staff on public.hub_ops_status_log (staff_id);
create index hub_ops_status_log_report on public.hub_ops_status_log (report_id);
create index hub_ops_status_log_hub on public.hub_ops_status_log (hub_id);

-- Reports to the boss: one per zone per period. "Pending" = no row yet (the period has not been sent).
create table public.hub_ops_boss_reports (
  id           uuid primary key default gen_random_uuid(),
  zone_id      uuid not null references public.zones(id),
  period_type  text not null check (period_type in ('daily', 'weekly', 'monthly')),
  period_from  date not null,
  period_to    date not null,
  status       text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  note         text,
  snapshot     jsonb not null,                                     -- the summary exactly as it was sent
  version      integer not null default 1,
  submitted_by uuid, submitted_by_name text, submitted_at timestamptz not null default clock_timestamp(),
  reviewed_by  uuid, reviewed_by_name text, reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint hub_ops_boss_one_per_period unique (zone_id, period_type, period_from),
  constraint hub_ops_boss_dates check (period_to >= period_from)
);

do $$
declare t text;
begin
  foreach t in array array['hub_ops_config', 'hub_ops_reports', 'hub_ops_staff', 'hub_ops_boss_reports'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'zonal');
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
  foreach t in array array['hub_ops_config', 'hub_ops_reports', 'hub_ops_staff', 'hub_ops_status_log', 'hub_ops_boss_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);   -- only through the functions below
  end loop;
end $$;
create trigger hub_ops_status_log_append_only before update or delete on public.hub_ops_status_log
  for each row execute function private.append_only();

-- ---------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------
create or replace function private.hub_ops_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Dhaka')::date $$;

-- The zone's settings with the defaults filled in.
create or replace function private.hub_ops_cfg(p_zone uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with d as (select coalesce((select value from public.system_settings where key = 'zonal.hub_ops.defaults'), '{}'::jsonb) v)
  select jsonb_build_object(
    'groups', coalesce(c.groups, d.v -> 'groups', '[]'::jsonb),
    'reasons', coalesce(c.reasons, d.v -> 'reasons', '[]'::jsonb),
    'skip_hub_ids', to_jsonb(coalesce(c.skip_hub_ids, '{}')),
    'off_days', coalesce(to_jsonb(c.off_days), d.v -> 'off_days', '[]'::jsonb),
    'week_start', coalesce((d.v ->> 'week_start')::int, 6),
    'custom', c.zone_id is not null)
  from d left join public.hub_ops_config c on c.zone_id = p_zone
$$;

-- Which designation group a post belongs to.
create or replace function private.hub_ops_group(p_position uuid, p_groups jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare g jsonb; v_txt text;
begin
  if p_position is null then return 'other'; end if;
  for g in select x from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) x loop
    if coalesce(g -> 'position_ids', '[]'::jsonb) ? p_position::text then return g ->> 'key'; end if;
  end loop;
  select p.name || ' ' || coalesce(p.name_bn, '') || ' ' || p.code into v_txt from public.positions p where p.id = p_position;
  for g in select x from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) x loop
    if coalesce(g ->> 'pattern', '') <> '' and v_txt ~* (g ->> 'pattern') then return g ->> 'key'; end if;
  end loop;
  return 'other';
end $$;

-- The days of a period on which a report is expected (never after today).
create or replace function private.hub_ops_days(p_from date, p_to date, p_off integer[]) returns setof date
language sql stable set search_path = '' as $$
  select d::date from generate_series(p_from, least(p_to, private.hub_ops_today()), interval '1 day') d
   where not (extract(isodow from d)::integer = any(coalesce(p_off, '{}')))
$$;

-- The period a date belongs to.
create or replace function private.hub_ops_period(p_type text, p_date date, p_week_start integer default 6)
returns table (period_from date, period_to date)
language sql immutable set search_path = '' as $$
  select case p_type when 'daily' then p_date
                     when 'weekly' then p_date - ((extract(isodow from p_date)::integer - p_week_start + 7) % 7)
                     else date_trunc('month', p_date)::date end,
         case p_type when 'daily' then p_date
                     when 'weekly' then p_date - ((extract(isodow from p_date)::integer - p_week_start + 7) % 7) + 6
                     else (date_trunc('month', p_date) + interval '1 month - 1 day')::date end
$$;

-- People who may review for a zone (holders of zonal.hub_ops.approve there, and super admins).
create or replace function private.hub_ops_reviewers(p_zone uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.archived_at is null and r.status = 'active'
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
   where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
     and ((r.is_super and ur.scope_type = 'global') or p.code = 'zonal.hub_ops.approve')
     and (ur.scope_type = 'global' or (ur.scope_type = 'zone' and ur.zone_id = p_zone))
$$;

create or replace function private.hub_ops_hub(p_hub uuid) returns public.hubs
language plpgsql stable security definer set search_path = '' as $$
declare h public.hubs;
begin
  select * into h from public.hubs where id = p_hub;
  if h.id is null or h.archived_at is not null then raise exception 'Hub not found' using errcode = 'P0002'; end if;
  return h;
end $$;

-- A person row as the screens need it.
create or replace function private.hub_ops_person(s public.hub_ops_staff) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'employee_id', s.employee_id, 'employee_code', e.employee_code, 'person_name', s.person_name,
    'mobile', s.mobile, 'position_id', s.position_id, 'position', coalesce(p.name_bn, p.name), 'position_en', p.name,
    'group_key', s.group_key, 'attendance', s.attendance, 'employment', s.employment, 'reason', s.reason, 'remarks', s.remarks,
    'hr_status', e.status, 'hr_hub_id', e.hub_id, 'joining_date', e.joining_date, 'in_hr', s.employee_id is not null)
  from (select 1) one
  left join public.employees e on e.id = s.employee_id
  left join public.positions p on p.id = s.position_id
$$;

-- What other records already say about a person on a day: the attendance register, a leave application, the hub's
-- own figures and the last status the zonal manager gave. Shown as hints; never counted unless the manager saves them.
create or replace function private.hub_ops_hints(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'register', (select a.status from public.attendance_records a where a.employee_id = p_employee and a.work_date = p_date),
    'leave', (select jsonb_build_object('status', l.status, 'from', l.from_date, 'to', l.to_date, 'type', coalesce(t.name_bn, t.name))
                from public.leave_requests l join public.leave_types t on t.id = l.leave_type_id
               where l.employee_id = p_employee and l.status in ('pending', 'approved') and p_date between l.from_date and l.to_date
               order by l.created_at desc limit 1),
    'last', (select jsonb_build_object('date', s.report_date, 'employment', s.employment, 'attendance', s.attendance, 'hub_id', s.hub_id)
               from public.hub_ops_staff s join public.hub_ops_reports r on r.id = s.report_id
              where s.employee_id = p_employee and s.report_date < p_date and s.removed_at is null and r.status <> 'pending'
              order by s.report_date desc, s.updated_at desc limit 1))
$$;

revoke all on function private.hub_ops_today(), private.hub_ops_cfg(uuid), private.hub_ops_group(uuid, jsonb),
  private.hub_ops_days(date, date, integer[]), private.hub_ops_period(text, date, integer), private.hub_ops_reviewers(uuid),
  private.hub_ops_hub(uuid), private.hub_ops_person(public.hub_ops_staff), private.hub_ops_hints(uuid, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The hub's input panel
-- ---------------------------------------------------------------------
create or replace function public.hub_ops_panel(p_hub uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  h public.hubs := private.hub_ops_hub(p_hub);
  r public.hub_ops_reports;
  v_cfg jsonb;
  v_rows jsonb; v_roster jsonb; v_left jsonb;
begin
  if not private.has_permission('zonal.hub_ops.view', null, p_hub) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_date is null then raise exception 'Pick a date' using errcode = '22023'; end if;
  v_cfg := private.hub_ops_cfg(h.zone_id);
  select * into r from public.hub_ops_reports where hub_id = p_hub and report_date = p_date;

  select coalesce(jsonb_agg(private.hub_ops_person(s) || jsonb_build_object('hints', private.hub_ops_hints(s.employee_id, p_date))
                            order by s.person_name), '[]'::jsonb)
    into v_rows from public.hub_ops_staff s where s.report_id = r.id and s.removed_at is null;

  -- HR's staff list of the hub (hub-level posts, active, joined by that day) not yet in the report.
  with hr as (
    select e.*, coalesce(p.name_bn, p.name) as pos_name, p.name as pos_en, private.hub_ops_hints(e.id, p_date) as hints
      from public.employees e left join public.positions p on p.id = e.position_id
     where e.hub_id = p_hub and e.archived_at is null and e.status = 'active' and coalesce(p.level, 'hub') = 'hub'
       and (e.joining_date is null or e.joining_date <= p_date)
       and not exists (select 1 from public.hub_ops_staff s where s.report_id = r.id and s.employee_id = e.id and s.removed_at is null))
  select coalesce(jsonb_agg(jsonb_build_object('id', null, 'employee_id', hr.id, 'employee_code', hr.employee_code, 'person_name', hr.full_name,
            'mobile', hr.mobile, 'position_id', hr.position_id, 'position', hr.pos_name, 'position_en', hr.pos_en,
            'group_key', private.hub_ops_group(hr.position_id, v_cfg -> 'groups'), 'attendance', null, 'employment', 'active',
            'reason', null, 'remarks', null, 'hr_status', hr.status, 'hr_hub_id', hr.hub_id, 'joining_date', hr.joining_date, 'in_hr', true,
            'hints', hr.hints) order by hr.full_name) filter (where coalesce(hr.hints #>> '{last,employment}', '') <> 'resigned'), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('employee_id', hr.id, 'employee_code', hr.employee_code, 'person_name', hr.full_name,
            'position', hr.pos_name, 'group_key', private.hub_ops_group(hr.position_id, v_cfg -> 'groups'), 'hints', hr.hints)
            order by hr.full_name) filter (where coalesce(hr.hints #>> '{last,employment}', '') = 'resigned'), '[]'::jsonb)
    into v_roster, v_left from hr;

  return jsonb_build_object(
    'hub', jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name, 'zone_id', h.zone_id,
             'skip', (v_cfg -> 'skip_hub_ids') ? h.id::text),
    'date', p_date, 'today', private.hub_ops_today(),
    'report', case when r.id is null then null else to_jsonb(r) - 'created_by' - 'updated_by' end,
    'rows', v_rows, 'roster', v_roster, 'left_before', v_left,
    'groups', v_cfg -> 'groups', 'reasons', v_cfg -> 'reasons',
    -- the hub's own daily figures (আজকের হাব অপারেশন), for reference only
    'hub_metric', (select jsonb_build_object('pickups', m.pickup_count, 'deliveries', m.delivery_count, 'pending', m.pending_parcels, 'status', m.status)
                     from public.hub_daily_metrics m where m.hub_id = p_hub and m.metric_date = p_date),
    'can', jsonb_build_object('create', private.has_permission('zonal.hub_ops.create', null, p_hub),
                              'edit', private.has_permission('zonal.hub_ops.edit', null, p_hub),
                              'approve', private.has_permission('zonal.hub_ops.approve', null, p_hub),
                              'hr_edit', private.has_permission('hr.employee.edit', null, p_hub)));
end $$;

-- Find a person of the zone to add to a hub's report (someone working there from another hub, a new joiner, …).
create or replace function public.hub_ops_people_search(p_zone uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := trim(coalesce(p_q, ''));
begin
  if p_zone is null or not private.has_permission_within_zone('zonal.hub_ops.create', p_zone) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'person_name') from (
    select jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code, 'person_name', e.full_name, 'mobile', e.mobile,
             'position_id', e.position_id, 'position', coalesce(p.name_bn, p.name), 'hub_id', e.hub_id, 'hub_name', h.name, 'status', e.status) x
      from public.employees e left join public.positions p on p.id = e.position_id left join public.hubs h on h.id = e.hub_id
     where e.zone_id = p_zone and e.archived_at is null and e.status in ('active', 'applicant', 'inactive')
       and (e.full_name ilike '%' || v_q || '%' or e.employee_code::text ilike v_q || '%' or coalesce(e.mobile, '') like '%' || v_q || '%')
     limit 30) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 6. Saving a hub's report
--    p_data: {total_parcels, total_pickups, reasons: [text], remarks,
--             staff: [{id?, employee_id?, person_name?, mobile?, position_id?, attendance, employment, reason, remarks, removed?}]}
--    p_submit: send it (needs both totals). A submitted / reviewed report is corrected only with p_reason.
-- ---------------------------------------------------------------------
create or replace function private.hub_ops_int(p_v jsonb, p_label text) returns integer
language plpgsql immutable set search_path = '' as $$
begin
  if p_v is null or jsonb_typeof(p_v) = 'null' or (jsonb_typeof(p_v) = 'string' and trim(p_v #>> '{}') = '') then return null; end if;
  if (p_v #>> '{}') !~ '^\s*[0-9]{1,9}\s*$' then raise exception '% must be a whole number of 0 or more', p_label using errcode = '22023'; end if;
  return (p_v #>> '{}')::integer;
end $$;
revoke all on function private.hub_ops_int(jsonb, text) from public, anon, authenticated;

create or replace function public.hub_ops_save(p_hub uuid, p_date date, p_data jsonb, p_submit boolean default false, p_reason text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  h public.hubs := private.hub_ops_hub(p_hub);
  r public.hub_ops_reports;
  v_cfg jsonb := private.hub_ops_cfg(h.zone_id);
  v_correction boolean := false;
  v_parcels integer; v_pickups integer;
  v_reasons text[];
  v_remarks text := nullif(trim(coalesce(p_data ->> 'remarks', '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_me text := private.my_display_name();
  it jsonb;
  s public.hub_ops_staff;
  e public.employees;
  v_emp uuid; v_name text; v_mobile text; v_pos uuid; v_att text; v_job text; v_why text; v_note text;
  v_seen uuid[] := '{}';
  v_dup text;
begin
  if p_date is null or p_date > private.hub_ops_today() then raise exception 'A report cannot be made for a future date' using errcode = '22023'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  select * into r from public.hub_ops_reports where hub_id = p_hub and report_date = p_date for update;
  if r.id is not null and r.status <> 'pending' then
    v_correction := true;
    if not private.has_permission('zonal.hub_ops.edit', null, p_hub) then raise exception 'Not authorised to correct a submitted report' using errcode = '42501'; end if;
    if v_reason is null then raise exception 'Write why the submitted report is being corrected' using errcode = '22023'; end if;
  elsif not private.has_permission('zonal.hub_ops.create', null, p_hub) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  v_parcels := private.hub_ops_int(p_data -> 'total_parcels', 'Total parcels');
  v_pickups := private.hub_ops_int(p_data -> 'total_pickups', 'Total pickups');
  if (p_submit or v_correction) and (v_parcels is null or v_pickups is null) then
    raise exception 'Enter total parcels and total pickups before submitting (write 0 if there were none)' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_data -> 'reasons', '[]'::jsonb)) <> 'array' then raise exception 'Reasons must be a list' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct left(trim(x), 120)) filter (where trim(x) <> ''), '{}') into v_reasons
    from jsonb_array_elements_text(coalesce(p_data -> 'reasons', '[]'::jsonb)) x;
  if cardinality(v_reasons) > 20 then raise exception 'Too many reasons' using errcode = '22023'; end if;
  if length(coalesce(v_remarks, '')) > 2000 then raise exception 'Remarks are too long' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_data -> 'staff', '[]'::jsonb)) <> 'array' then raise exception 'Staff must be a list' using errcode = '22023'; end if;

  perform set_config('app.change_reason', coalesce(v_reason, case when p_submit then 'Submitted' else 'Saved as draft' end), true);

  if r.id is null then
    insert into public.hub_ops_reports (hub_id, zone_id, report_date, total_parcels, total_pickups, reasons, remarks, status,
                                        submitted_by, submitted_by_name, submitted_at)
    values (p_hub, h.zone_id, p_date, v_parcels, v_pickups, v_reasons, v_remarks, case when p_submit then 'submitted' else 'pending' end,
            case when p_submit then auth.uid() end, case when p_submit then v_me end, case when p_submit then clock_timestamp() end)
    returning * into r;
  else
    update public.hub_ops_reports set
      total_parcels = v_parcels, total_pickups = v_pickups, reasons = v_reasons, remarks = v_remarks,
      status = case when v_correction or p_submit then 'submitted' else 'pending' end,
      version = version + case when v_correction then 1 else 0 end,
      last_correction = case when v_correction then v_reason else last_correction end,
      submitted_by = case when v_correction or p_submit then auth.uid() else submitted_by end,
      submitted_by_name = case when v_correction or p_submit then v_me else submitted_by_name end,
      submitted_at = case when v_correction or p_submit then clock_timestamp() else submitted_at end,
      reviewed_by = case when v_correction then null else reviewed_by end,
      reviewed_by_name = case when v_correction then null else reviewed_by_name end,
      reviewed_at = case when v_correction then null else reviewed_at end,
      review_note = case when v_correction then null else review_note end
    where id = r.id returning * into r;
  end if;

  for it in select x from jsonb_array_elements(coalesce(p_data -> 'staff', '[]'::jsonb)) x loop
    if jsonb_typeof(it) <> 'object' then raise exception 'Each staff entry must be an object' using errcode = '22023'; end if;
    s := null; e := null;
    v_emp := nullif(it ->> 'employee_id', '')::uuid;
    v_att := nullif(it ->> 'attendance', '');
    v_job := coalesce(nullif(it ->> 'employment', ''), 'active');
    v_why := left(nullif(trim(coalesce(it ->> 'reason', '')), ''), 500);
    v_note := left(nullif(trim(coalesce(it ->> 'remarks', '')), ''), 500);
    if v_att is not null and v_att not in ('present', 'absent', 'leave_applied', 'leave_not_applied') then
      raise exception 'Unknown attendance status %', v_att using errcode = '22023'; end if;
    if v_job not in ('active', 'new', 'resigned') then raise exception 'Unknown employment status %', v_job using errcode = '22023'; end if;

    if nullif(it ->> 'id', '') is not null then
      select * into s from public.hub_ops_staff where id = (it ->> 'id')::uuid and report_id = r.id for update;
      if s.id is null then raise exception 'A staff row does not belong to this report' using errcode = '22023'; end if;
      v_emp := s.employee_id;
    elsif v_emp is not null then
      select * into s from public.hub_ops_staff where report_id = r.id and employee_id = v_emp and removed_at is null for update;
    end if;

    if coalesce((it ->> 'removed')::boolean, false) then
      if s.id is not null and s.removed_at is null then update public.hub_ops_staff set removed_at = now() where id = s.id; end if;
      continue;
    end if;

    if v_emp is not null then
      if v_emp = any(v_seen) then raise exception 'The same person is listed twice' using errcode = '22023'; end if;
      v_seen := v_seen || v_emp;
      select * into e from public.employees where id = v_emp;
      if e.id is null or e.archived_at is not null then raise exception 'Employee not found' using errcode = 'P0002'; end if;
      if e.zone_id is distinct from h.zone_id then raise exception '% is not in this zone', e.full_name using errcode = '22023'; end if;
      v_name := e.full_name; v_mobile := e.mobile;
      v_pos := coalesce(nullif(it ->> 'position_id', '')::uuid, s.position_id, e.position_id);
    else
      -- Not in HR yet: written by name only. Never a second record for someone who is already in HR.
      v_name := trim(coalesce(it ->> 'person_name', s.person_name, ''));
      v_mobile := nullif(regexp_replace(translate(coalesce(it ->> 'mobile', s.mobile, ''), '০১২৩৪৫৬৭৮৯', '0123456789'), '[^0-9]', '', 'g'), '');
      v_pos := coalesce(nullif(it ->> 'position_id', '')::uuid, s.position_id);
      if length(v_name) < 2 then raise exception 'Write the person''s name' using errcode = '22023'; end if;
      if v_mobile is not null and v_mobile !~ '^01[3-9][0-9]{8}$' then raise exception 'Mobile number of % is not valid', v_name using errcode = '22023'; end if;
      select coalesce(x.employee_code::text, x.full_name) into v_dup from public.employees x
       where x.archived_at is null and x.status not in ('rejected', 'resigned', 'terminated')
         and ((v_mobile is not null and x.mobile = v_mobile) or (x.hub_id = p_hub and lower(trim(x.full_name)) = lower(v_name)))
       limit 1;
      if v_dup is not null then
        raise exception '% is already in HR (%): pick the person from the list instead', v_name, v_dup using errcode = '23505';
      end if;
    end if;
    if v_pos is not null and not exists (select 1 from public.positions where id = v_pos) then raise exception 'Unknown post' using errcode = '22023'; end if;

    if s.id is null then
      insert into public.hub_ops_staff (report_id, hub_id, report_date, employee_id, person_name, mobile, position_id, group_key,
                                        attendance, employment, reason, remarks)
      values (r.id, p_hub, p_date, v_emp, v_name, v_mobile, v_pos, private.hub_ops_group(v_pos, v_cfg -> 'groups'),
              v_att, v_job, v_why, v_note)
      returning * into s;
      if v_att is not null then
        insert into public.hub_ops_status_log (staff_id, report_id, hub_id, zone_id, employee_id, person_name, status_date, field, from_value, to_value, reason, remarks, changed_by_name)
        values (s.id, r.id, p_hub, h.zone_id, v_emp, v_name, p_date, 'attendance', null, v_att, coalesce(v_why, v_reason), v_note, v_me);
      end if;
      if v_job <> 'active' then
        insert into public.hub_ops_status_log (staff_id, report_id, hub_id, zone_id, employee_id, person_name, status_date, field, from_value, to_value, reason, remarks, changed_by_name)
        values (s.id, r.id, p_hub, h.zone_id, v_emp, v_name, p_date, 'employment', null, v_job, coalesce(v_why, v_reason), v_note, v_me);
      end if;
    else
      if s.attendance is distinct from v_att then
        insert into public.hub_ops_status_log (staff_id, report_id, hub_id, zone_id, employee_id, person_name, status_date, field, from_value, to_value, reason, remarks, changed_by_name)
        values (s.id, r.id, p_hub, h.zone_id, v_emp, v_name, p_date, 'attendance', s.attendance, v_att, coalesce(v_why, v_reason), v_note, v_me);
      end if;
      if s.employment is distinct from v_job then
        insert into public.hub_ops_status_log (staff_id, report_id, hub_id, zone_id, employee_id, person_name, status_date, field, from_value, to_value, reason, remarks, changed_by_name)
        values (s.id, r.id, p_hub, h.zone_id, v_emp, v_name, p_date, 'employment', s.employment, v_job, coalesce(v_why, v_reason), v_note, v_me);
      end if;
      update public.hub_ops_staff set person_name = v_name, mobile = v_mobile, position_id = v_pos,
        group_key = private.hub_ops_group(v_pos, v_cfg -> 'groups'), attendance = v_att, employment = v_job, reason = v_why, remarks = v_note,
        removed_at = null
      where id = s.id;
    end if;
  end loop;
  return r.id;
end $$;

-- Review hub reports (one or many). The person who submitted a report cannot review it.
create or replace function public.hub_ops_review(p_ids uuid[], p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.hub_ops_reports; v_n integer := 0;
begin
  for r in select * from public.hub_ops_reports where id = any(coalesce(p_ids, '{}')) for update loop
    if not private.has_permission('zonal.hub_ops.approve', null, r.hub_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
    if r.status <> 'submitted' then raise exception 'Only submitted reports can be reviewed' using errcode = '22023'; end if;
    if r.submitted_by = auth.uid() then raise exception 'You cannot review a report you submitted yourself' using errcode = '42501'; end if;
    perform set_config('app.change_reason', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Reviewed'), true);
    update public.hub_ops_reports set status = 'reviewed', reviewed_by = auth.uid(), reviewed_by_name = private.my_display_name(),
      reviewed_at = now(), review_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 7. Summaries: each hub, and the whole zone — from submitted / reviewed reports only
-- ---------------------------------------------------------------------
-- Volatile on purpose: it works through temporary tables (dropped at commit), so callers must not be stable either.
create or replace function private.hub_ops_summary(p_zone uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb := private.hub_ops_cfg(p_zone);
  v_off integer[] := array(select jsonb_array_elements_text(v_cfg -> 'off_days')::integer);
  v_skip uuid[] := array(select jsonb_array_elements_text(v_cfg -> 'skip_hub_ids')::uuid);
  v_hubs jsonb; v_people jsonb; v_zone jsonb;
begin
  create temp table if not exists hub_ops_tmp_days (d date) on commit drop;
  create temp table if not exists hub_ops_tmp_rep (like public.hub_ops_reports) on commit drop;
  create temp table if not exists hub_ops_tmp_staff (like public.hub_ops_staff) on commit drop;
  truncate hub_ops_tmp_days, hub_ops_tmp_rep, hub_ops_tmp_staff;
  insert into hub_ops_tmp_days select private.hub_ops_days(p_from, p_to, v_off);
  insert into hub_ops_tmp_rep select * from public.hub_ops_reports where zone_id = p_zone and report_date between p_from and p_to;
  insert into hub_ops_tmp_staff select s.* from public.hub_ops_staff s join hub_ops_tmp_rep r on r.id = s.report_id
   where r.status in ('submitted', 'reviewed') and s.removed_at is null;

  with hubs as (
    select h.id, h.code, h.name, h.id = any(v_skip) as skip
      from public.hubs h
     where h.zone_id = p_zone and h.archived_at is null
       and (h.status = 'active' or exists (select 1 from hub_ops_tmp_rep r where r.hub_id = h.id))),
  per as (
    select h.*,
      (select max(r.report_date) from hub_ops_tmp_rep r where r.hub_id = h.id and r.status <> 'pending') as latest
    from hubs h)
  select coalesce(jsonb_agg(jsonb_build_object(
      'hub_id', p.id, 'code', p.code, 'name', p.name, 'skip', p.skip,
      'expected', case when p.skip then 0 else (select count(*) from hub_ops_tmp_days) end,
      'submitted', (select count(*) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status = 'submitted'),
      'reviewed', (select count(*) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status = 'reviewed'),
      'pending', (select count(*) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status = 'pending'),
      'missing_dates', case when p.skip then '[]'::jsonb else coalesce((select jsonb_agg(d.d order by d.d) from hub_ops_tmp_days d
          where not exists (select 1 from hub_ops_tmp_rep r where r.hub_id = p.id and r.report_date = d.d and r.status <> 'pending')), '[]'::jsonb) end,
      'pending_dates', coalesce((select jsonb_agg(r.report_date order by r.report_date) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status = 'pending'), '[]'::jsonb),
      'report_id', (select r.id from hub_ops_tmp_rep r where r.hub_id = p.id order by r.report_date desc limit 1),
      'status', case when p_from = p_to then (select r.status from hub_ops_tmp_rep r where r.hub_id = p.id) end,
      'version', case when p_from = p_to then (select r.version from hub_ops_tmp_rep r where r.hub_id = p.id) end,
      'total_parcels', (select sum(r.total_parcels) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status <> 'pending'),
      'total_pickups', (select sum(r.total_pickups) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status <> 'pending'),
      'parcel_days', (select count(r.total_parcels) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status <> 'pending'),
      'pickup_days', (select count(r.total_pickups) from hub_ops_tmp_rep r where r.hub_id = p.id and r.status <> 'pending'),
      'latest_date', p.latest,
      'staff_latest', (select count(*) from hub_ops_tmp_staff s where s.hub_id = p.id and s.report_date = p.latest),
      'staff_active_latest', (select count(*) from hub_ops_tmp_staff s where s.hub_id = p.id and s.report_date = p.latest and s.employment <> 'resigned'),
      'by_group', coalesce((select jsonb_object_agg(g.group_key, g.n) from (select s.group_key, count(*) n from hub_ops_tmp_staff s
          where s.hub_id = p.id and s.report_date = p.latest group by s.group_key) g), '{}'::jsonb),
      'att', jsonb_build_object(
          'present', (select count(*) from hub_ops_tmp_staff s where s.hub_id = p.id and s.attendance = 'present'),
          'absent', (select count(*) from hub_ops_tmp_staff s where s.hub_id = p.id and s.attendance = 'absent'),
          'leave_applied', (select count(*) from hub_ops_tmp_staff s where s.hub_id = p.id and s.attendance = 'leave_applied'),
          'leave_not_applied', (select count(*) from hub_ops_tmp_staff s where s.hub_id = p.id and s.attendance = 'leave_not_applied'),
          'not_marked', (select count(*) from hub_ops_tmp_staff s where s.hub_id = p.id and s.attendance is null and s.employment <> 'resigned')),
      'resigned', (select count(distinct coalesce(s.employee_id::text, lower(s.person_name))) from hub_ops_tmp_staff s where s.hub_id = p.id and s.employment = 'resigned'),
      'new', (select count(distinct coalesce(s.employee_id::text, lower(s.person_name))) from hub_ops_tmp_staff s where s.hub_id = p.id and s.employment = 'new'),
      'not_in_hr', (select count(distinct lower(s.person_name)) from hub_ops_tmp_staff s where s.hub_id = p.id and s.employee_id is null),
      'reasons', coalesce((select jsonb_object_agg(x.reason, x.n) from (select unnest(r.reasons) reason, count(*) n from hub_ops_tmp_rep r
          where r.hub_id = p.id and r.status <> 'pending' group by 1) x), '{}'::jsonb),
      'remarks', coalesce((select jsonb_agg(jsonb_build_object('date', r.report_date, 'text', r.remarks) order by r.report_date) from hub_ops_tmp_rep r
          where r.hub_id = p.id and r.status <> 'pending' and r.remarks is not null), '[]'::jsonb),
      'roster', (select count(*) from public.employees e left join public.positions ps on ps.id = e.position_id
          where e.hub_id = p.id and e.archived_at is null and e.status = 'active' and coalesce(ps.level, 'hub') = 'hub'))
    order by p.skip, p.name), '[]'::jsonb)
  into v_hubs from per p;

  -- Each person: days in each status, with the dates — who applied for leave and who did not.
  select coalesce(jsonb_agg(x order by x ->> 'hub_name', x ->> 'person_name'), '[]'::jsonb) into v_people from (
    select jsonb_build_object('hub_id', s.hub_id, 'hub_name', h.name, 'employee_id', s.employee_id, 'employee_code', max(e.employee_code::text),
      'person_name', max(s.person_name), 'group_key', (array_agg(s.group_key order by s.report_date desc))[1],
      'position', (array_agg(coalesce(ps.name_bn, ps.name) order by s.report_date desc))[1], 'days', count(*),
      'present', count(*) filter (where s.attendance = 'present'),
      'absent', count(*) filter (where s.attendance = 'absent'),
      'leave_applied', count(*) filter (where s.attendance = 'leave_applied'),
      'leave_not_applied', count(*) filter (where s.attendance = 'leave_not_applied'),
      'not_marked', count(*) filter (where s.attendance is null and s.employment <> 'resigned'),
      'absent_dates', coalesce(jsonb_agg(s.report_date order by s.report_date) filter (where s.attendance = 'absent'), '[]'::jsonb),
      'leave_applied_dates', coalesce(jsonb_agg(s.report_date order by s.report_date) filter (where s.attendance = 'leave_applied'), '[]'::jsonb),
      'leave_not_applied_dates', coalesce(jsonb_agg(s.report_date order by s.report_date) filter (where s.attendance = 'leave_not_applied'), '[]'::jsonb),
      'resigned', bool_or(s.employment = 'resigned'), 'resigned_date', min(s.report_date) filter (where s.employment = 'resigned'),
      'new', bool_or(s.employment = 'new'), 'new_date', min(s.report_date) filter (where s.employment = 'new'),
      'hr_status', max(e.status), 'in_hr', s.employee_id is not null,
      'reasons', coalesce(jsonb_agg(jsonb_build_object('date', s.report_date, 'status', coalesce(s.attendance, s.employment), 'reason', s.reason, 'remarks', s.remarks)
                 order by s.report_date) filter (where s.reason is not null or s.remarks is not null), '[]'::jsonb)) x
    from hub_ops_tmp_staff s
    join public.hubs h on h.id = s.hub_id
    left join public.employees e on e.id = s.employee_id
    left join public.positions ps on ps.id = s.position_id
    group by s.hub_id, h.name, s.employee_id, case when s.employee_id is null then lower(s.person_name) end) q;

  select jsonb_build_object(
    'hubs', jsonb_array_length(v_hubs),
    'hubs_expected', (select count(*) from jsonb_array_elements(v_hubs) x where not (x ->> 'skip')::boolean),
    'days', (select count(*) from hub_ops_tmp_days),
    'expected', (select coalesce(sum((x ->> 'expected')::int), 0) from jsonb_array_elements(v_hubs) x),
    'submitted', (select coalesce(sum((x ->> 'submitted')::int), 0) from jsonb_array_elements(v_hubs) x),
    'reviewed', (select coalesce(sum((x ->> 'reviewed')::int), 0) from jsonb_array_elements(v_hubs) x),
    'pending', (select coalesce(sum((x ->> 'pending')::int), 0) from jsonb_array_elements(v_hubs) x),
    'missing', (select coalesce(sum(jsonb_array_length(x -> 'missing_dates')), 0) from jsonb_array_elements(v_hubs) x),
    'hubs_reported', (select count(*) from jsonb_array_elements(v_hubs) x where (x ->> 'submitted')::int + (x ->> 'reviewed')::int > 0),
    'total_parcels', (select sum((x ->> 'total_parcels')::bigint) from jsonb_array_elements(v_hubs) x),
    'total_pickups', (select sum((x ->> 'total_pickups')::bigint) from jsonb_array_elements(v_hubs) x),
    'staff_latest', (select coalesce(sum((x ->> 'staff_latest')::int), 0) from jsonb_array_elements(v_hubs) x),
    'staff_active_latest', (select coalesce(sum((x ->> 'staff_active_latest')::int), 0) from jsonb_array_elements(v_hubs) x),
    'roster', (select coalesce(sum((x ->> 'roster')::int), 0) from jsonb_array_elements(v_hubs) x),
    'by_group', coalesce((select jsonb_object_agg(k, n) from (select g.key k, sum(g.value::int) n from jsonb_array_elements(v_hubs) x,
        jsonb_each_text(x -> 'by_group') g group by g.key) t), '{}'::jsonb),
    'att', jsonb_build_object(
        'present', (select count(*) from hub_ops_tmp_staff where attendance = 'present'),
        'absent', (select count(*) from hub_ops_tmp_staff where attendance = 'absent'),
        'leave_applied', (select count(*) from hub_ops_tmp_staff where attendance = 'leave_applied'),
        'leave_not_applied', (select count(*) from hub_ops_tmp_staff where attendance = 'leave_not_applied'),
        'not_marked', (select count(*) from hub_ops_tmp_staff where attendance is null and employment <> 'resigned')),
    'resigned', (select coalesce(sum((x ->> 'resigned')::int), 0) from jsonb_array_elements(v_hubs) x),
    'new', (select coalesce(sum((x ->> 'new')::int), 0) from jsonb_array_elements(v_hubs) x),
    'not_in_hr', (select coalesce(sum((x ->> 'not_in_hr')::int), 0) from jsonb_array_elements(v_hubs) x),
    'reasons', coalesce((select jsonb_object_agg(k, n) from (select g.key k, sum(g.value::int) n from jsonb_array_elements(v_hubs) x,
        jsonb_each_text(x -> 'reasons') g group by g.key) t), '{}'::jsonb))
  into v_zone;

  return jsonb_build_object('zone_id', p_zone, 'zone_name', (select z.name from public.zones z where z.id = p_zone),
    'from', p_from, 'to', p_to, 'today', private.hub_ops_today(), 'groups', v_cfg -> 'groups',
    'zone', v_zone, 'hubs', v_hubs, 'people', v_people, 'made_at', now());
end $$;
revoke all on function private.hub_ops_summary(uuid, date, date) from public, anon, authenticated;

create or replace function public.hub_ops_summary(p_zone uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_zone is null or not private.has_permission('zonal.hub_ops.view', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a valid period' using errcode = '22023'; end if;
  if p_to - p_from > 186 then raise exception 'Pick a period of at most six months' using errcode = '22023'; end if;
  return private.hub_ops_summary(p_zone, p_from, p_to)
    || jsonb_build_object('can', jsonb_build_object('create', private.has_permission('zonal.hub_ops.create', p_zone, null),
         'edit', private.has_permission('zonal.hub_ops.edit', p_zone, null),
         'approve', private.has_permission('zonal.hub_ops.approve', p_zone, null),
         'configure', private.has_permission('zonal.hub_ops.configure', p_zone, null),
         'export', private.has_permission('zonal.hub_ops.export', p_zone, null)));
end $$;

-- Status changes of people (newest first).
create or replace function public.hub_ops_status_log(p_zone uuid, p_from date, p_to date, p_hub uuid default null, p_employee uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_zone is null or not private.has_permission('zonal.hub_ops.view', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'changed_at') desc) from (
    select jsonb_build_object('id', l.id, 'status_date', l.status_date, 'hub_id', l.hub_id, 'hub_name', h.name, 'employee_id', l.employee_id,
      'employee_code', e.employee_code, 'person_name', l.person_name, 'field', l.field, 'from_value', l.from_value, 'to_value', l.to_value,
      'reason', l.reason, 'remarks', l.remarks, 'changed_by_name', l.changed_by_name, 'changed_at', l.changed_at,
      'report_status', r.status) x
      from public.hub_ops_status_log l
      join public.hubs h on h.id = l.hub_id
      join public.hub_ops_reports r on r.id = l.report_id
      left join public.employees e on e.id = l.employee_id
     where l.zone_id = p_zone and l.status_date between coalesce(p_from, '2000-01-01') and coalesce(p_to, '2999-12-31')
       and (p_hub is null or l.hub_id = p_hub) and (p_employee is null or l.employee_id = p_employee)
     order by l.changed_at desc limit 2000) s), '[]'::jsonb);
end $$;

-- What changed in a hub report or a boss report, old → new, who, when and why (from the audit log).
create or replace function public.hub_ops_history(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid; v_hub uuid;
begin
  if p_kind = 'report' then
    select zone_id, hub_id into v_zone, v_hub from public.hub_ops_reports where id = p_id;
    if v_zone is null then raise exception 'Report not found' using errcode = 'P0002'; end if;
    if not private.has_permission('zonal.hub_ops.view', null, v_hub) then raise exception 'Not authorised' using errcode = '42501'; end if;
  elsif p_kind = 'boss' then
    select zone_id into v_zone from public.hub_ops_boss_reports where id = p_id;
    if v_zone is null then raise exception 'Report not found' using errcode = 'P0002'; end if;
    if not private.has_permission('zonal.hub_ops.view', v_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  else
    raise exception 'Unknown kind' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'at') desc, (x ->> 'id')::bigint desc) from (
    select jsonb_build_object('id', a.id, 'at', a.occurred_at, 'action', a.action, 'table', a.table_name, 'record_id', a.record_id,
      'who', coalesce((select e.full_name from public.employees e where e.profile_id = a.actor_id and e.archived_at is null limit 1),
                      (select p.full_name from public.profiles p where p.id = a.actor_id), 'System'),
      'reason', a.reason, 'fields', to_jsonb(coalesce(a.changed_fields, '{}')),
      'person', coalesce(a.new_data ->> 'person_name', a.old_data ->> 'person_name'),
      'old', case when a.old_data is null then null else (select jsonb_object_agg(k, a.old_data -> k) from unnest(a.changed_fields) k) end,
      'new', case when a.old_data is null then a.new_data - 'snapshot' - 'created_by' - 'updated_by'
                  else (select jsonb_object_agg(k, a.new_data -> k) from unnest(a.changed_fields) k) end - 'snapshot') x
      from public.audit_logs a
     where (p_kind = 'report' and ((a.table_name = 'hub_ops_reports' and a.record_id = p_id::text)
              or (a.table_name = 'hub_ops_staff' and a.record_id in (select s.id::text from public.hub_ops_staff s where s.report_id = p_id))))
        or (p_kind = 'boss' and a.table_name = 'hub_ops_boss_reports' and a.record_id = p_id::text)
     order by a.occurred_at desc limit 1000) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 8. Reports to the boss: daily, weekly, monthly
-- ---------------------------------------------------------------------
create or replace function private.hub_ops_boss_row(b public.hub_ops_boss_reports) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (to_jsonb(b) - 'snapshot' - 'created_by' - 'updated_by') || jsonb_build_object(
    -- a hub report in the period was submitted or corrected after this report went to the boss
    'changed_after', exists (select 1 from public.hub_ops_reports r where r.zone_id = b.zone_id and r.report_date between b.period_from and b.period_to
                              and r.status <> 'pending' and r.submitted_at > b.submitted_at))
$$;
revoke all on function private.hub_ops_boss_row(public.hub_ops_boss_reports) from public, anon, authenticated;

-- The last p_count periods (newest first) with their status: pending (not sent), submitted or reviewed.
create or replace function public.hub_ops_boss_list(p_zone uuid, p_type text, p_count integer default 12) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg jsonb; v_ws integer; v_today date := private.hub_ops_today();
  v_off integer[]; v_skip uuid[];
  v_out jsonb := '[]'::jsonb; v_from date; v_to date; v_d date; i integer;
  b public.hub_ops_boss_reports; v_exp integer; v_got integer;
begin
  if p_zone is null or not private.has_permission('zonal.hub_ops.view', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_type not in ('daily', 'weekly', 'monthly') then raise exception 'Unknown report type' using errcode = '22023'; end if;
  v_cfg := private.hub_ops_cfg(p_zone); v_ws := (v_cfg ->> 'week_start')::int;
  v_off := array(select jsonb_array_elements_text(v_cfg -> 'off_days')::integer);
  v_skip := array(select jsonb_array_elements_text(v_cfg -> 'skip_hub_ids')::uuid);
  v_d := v_today;
  for i in 1 .. least(greatest(coalesce(p_count, 12), 1), 62) loop
    select pp.period_from, pp.period_to into v_from, v_to from private.hub_ops_period(p_type, v_d, v_ws) pp;
    select * into b from public.hub_ops_boss_reports where zone_id = p_zone and period_type = p_type and period_from = v_from;
    select count(*) * (select count(*) from public.hubs h where h.zone_id = p_zone and h.archived_at is null and h.status = 'active' and not (h.id = any(v_skip)))
      into v_exp from private.hub_ops_days(v_from, v_to, v_off);
    select count(*) into v_got from public.hub_ops_reports r join public.hubs h on h.id = r.hub_id
     where r.zone_id = p_zone and r.report_date between v_from and v_to and r.status <> 'pending'
       and h.archived_at is null and h.status = 'active' and not (h.id = any(v_skip))
       and not (extract(isodow from r.report_date)::integer = any(v_off)) and r.report_date <= v_today;
    v_out := v_out || jsonb_build_array(jsonb_build_object('period_type', p_type, 'period_from', v_from, 'period_to', v_to,
      'status', coalesce(b.status, 'pending'), 'report', case when b.id is null then null else private.hub_ops_boss_row(b) end,
      'expected', v_exp, 'received', least(v_got, v_exp), 'missing', greatest(v_exp - v_got, 0),
      'running', v_to >= v_today));
    v_d := v_from - 1;
  end loop;
  return v_out;
end $$;

-- One boss report: what was sent (snapshot) and the summary as it is now.
create or replace function public.hub_ops_boss_get(p_zone uuid, p_type text, p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_from date; v_to date; b public.hub_ops_boss_reports;
begin
  if p_zone is null or not private.has_permission('zonal.hub_ops.view', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_type not in ('daily', 'weekly', 'monthly') then raise exception 'Unknown report type' using errcode = '22023'; end if;
  select pp.period_from, pp.period_to into v_from, v_to from private.hub_ops_period(p_type, p_date, (private.hub_ops_cfg(p_zone) ->> 'week_start')::int) pp;
  select * into b from public.hub_ops_boss_reports where zone_id = p_zone and period_type = p_type and period_from = v_from;
  return jsonb_build_object('period_type', p_type, 'period_from', v_from, 'period_to', v_to, 'status', coalesce(b.status, 'pending'),
    'report', case when b.id is null then null else private.hub_ops_boss_row(b) end,
    'sent', b.snapshot, 'live', private.hub_ops_summary(p_zone, v_from, v_to),
    'can', jsonb_build_object('create', private.has_permission('zonal.hub_ops.create', p_zone, null),
           'edit', private.has_permission('zonal.hub_ops.edit', p_zone, null),
           'approve', private.has_permission('zonal.hub_ops.approve', p_zone, null),
           'export', private.has_permission('zonal.hub_ops.export', p_zone, null)));
end $$;

-- Send (or send again after corrections) a period's report to the boss. The summary is frozen as it is now.
create or replace function public.hub_ops_boss_submit(p_zone uuid, p_type text, p_date date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_from date; v_to date; b public.hub_ops_boss_reports; v_snap jsonb; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_me text := private.my_display_name(); u uuid; v_label text;
begin
  if p_zone is null or not private.has_permission('zonal.hub_ops.create', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_type not in ('daily', 'weekly', 'monthly') then raise exception 'Unknown report type' using errcode = '22023'; end if;
  select pp.period_from, pp.period_to into v_from, v_to from private.hub_ops_period(p_type, p_date, (private.hub_ops_cfg(p_zone) ->> 'week_start')::int) pp;
  if v_from > private.hub_ops_today() then raise exception 'This period has not started yet' using errcode = '22023'; end if;
  v_snap := private.hub_ops_summary(p_zone, v_from, v_to);
  select * into b from public.hub_ops_boss_reports where zone_id = p_zone and period_type = p_type and period_from = v_from for update;
  if b.id is null then
    perform set_config('app.change_reason', 'Sent to the boss', true);
    insert into public.hub_ops_boss_reports (zone_id, period_type, period_from, period_to, note, snapshot, submitted_by, submitted_by_name)
    values (p_zone, p_type, v_from, v_to, v_note, v_snap, auth.uid(), v_me) returning * into b;
  else
    if not private.has_permission('zonal.hub_ops.edit', p_zone, null) then raise exception 'Not authorised to send it again' using errcode = '42501'; end if;
    if v_note is null then raise exception 'Write what changed before sending again' using errcode = '22023'; end if;
    perform set_config('app.change_reason', v_note, true);
    update public.hub_ops_boss_reports set note = v_note, snapshot = v_snap, status = 'submitted', version = version + 1,
      submitted_by = auth.uid(), submitted_by_name = v_me, submitted_at = clock_timestamp(),
      reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_note = null
    where id = b.id returning * into b;
  end if;
  v_label := case p_type when 'daily' then 'দৈনিক' when 'weekly' then 'সাপ্তাহিক' else 'মাসিক' end;
  for u in select x from private.hub_ops_reviewers(p_zone) x loop
    perform private.notify(u, v_label || ' হাব অপারেশন রিপোর্ট এসেছে',
      coalesce((select z.name from public.zones z where z.id = p_zone), '') || ' · ' || to_char(v_from, 'DD/MM/YYYY')
        || case when v_to > v_from then ' – ' || to_char(v_to, 'DD/MM/YYYY') else '' end || ' · ' || v_me,
      '/app/zonal/hub-ops?tab=boss&type=' || p_type || '&date=' || v_from, 'hub_ops');
  end loop;
  return b.id;
end $$;

-- The boss marks a report reviewed. The hub reports it covers that are waiting are marked reviewed with it
-- (not those this reviewer submitted). The person who sent it cannot review it.
create or replace function public.hub_ops_boss_review(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.hub_ops_boss_reports; v_me text := private.my_display_name(); v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into b from public.hub_ops_boss_reports where id = p_id for update;
  if b.id is null then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if not private.has_permission('zonal.hub_ops.approve', b.zone_id, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if b.status <> 'submitted' then raise exception 'This report is already reviewed' using errcode = '22023'; end if;
  if b.submitted_by = auth.uid() then raise exception 'You cannot review a report you sent yourself' using errcode = '42501'; end if;
  perform set_config('app.change_reason', coalesce(v_note, 'Reviewed'), true);
  update public.hub_ops_boss_reports set status = 'reviewed', reviewed_by = auth.uid(), reviewed_by_name = v_me, reviewed_at = now(), review_note = v_note
   where id = p_id;
  update public.hub_ops_reports set status = 'reviewed', reviewed_by = auth.uid(), reviewed_by_name = v_me, reviewed_at = now(),
         review_note = coalesce(v_note, review_note)
   where zone_id = b.zone_id and report_date between b.period_from and b.period_to and status = 'submitted'
     and submitted_by is distinct from auth.uid() and submitted_at <= b.submitted_at;
  perform private.notify(b.submitted_by, 'হাব অপারেশন রিপোর্ট দেখা হয়েছে',
    to_char(b.period_from, 'DD/MM/YYYY') || case when b.period_to > b.period_from then ' – ' || to_char(b.period_to, 'DD/MM/YYYY') else '' end
      || ' · ' || v_me || coalesce(': ' || v_note, ''),
    '/app/zonal/hub-ops?tab=boss&type=' || b.period_type || '&date=' || b.period_from, 'hub_ops');
end $$;

-- ---------------------------------------------------------------------
-- 9. Settings of a zone: designation groups, reasons, hubs without a report, days without a report
-- ---------------------------------------------------------------------
create or replace function public.hub_ops_settings(p_zone uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cfg jsonb;
begin
  if p_zone is null or not private.has_permission('zonal.hub_ops.view', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  v_cfg := private.hub_ops_cfg(p_zone);
  return v_cfg || jsonb_build_object(
    'positions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'name_bn', p.name_bn,
        'group_key', private.hub_ops_group(p.id, v_cfg -> 'groups')) order by p.sort_order, p.name)
      from public.positions p where p.archived_at is null and coalesce(p.level, 'hub') = 'hub'), '[]'::jsonb),
    'hubs', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name) order by h.name)
      from public.hubs h where h.zone_id = p_zone and h.archived_at is null and h.status = 'active'), '[]'::jsonb),
    'can_configure', private.has_permission('zonal.hub_ops.configure', p_zone, null));
end $$;

create or replace function public.hub_ops_configure(p_zone uuid, p_groups jsonb, p_reasons jsonb, p_skip_hubs uuid[], p_off_days integer[])
returns void
language plpgsql security definer set search_path = '' as $$
declare g jsonb; v_keys text[] := '{}'; v_reasons jsonb; v_pos text;
begin
  if p_zone is null or not private.has_permission('zonal.hub_ops.configure', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_groups is not null then
    if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 or jsonb_array_length(p_groups) > 20 then
      raise exception 'Give between 1 and 20 designation groups' using errcode = '22023'; end if;
    for g in select x from jsonb_array_elements(p_groups) x loop
      if coalesce(g ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,30}$' or g ->> 'key' = 'other' then raise exception 'Invalid group key %', g ->> 'key' using errcode = '22023'; end if;
      if g ->> 'key' = any(v_keys) then raise exception 'Group % is given twice', g ->> 'key' using errcode = '22023'; end if;
      v_keys := v_keys || (g ->> 'key');
      if length(trim(coalesce(g ->> 'bn', ''))) = 0 or length(trim(coalesce(g ->> 'en', ''))) = 0 then raise exception 'Every group needs a Bangla and an English name' using errcode = '22023'; end if;
      if jsonb_typeof(coalesce(g -> 'position_ids', '[]'::jsonb)) <> 'array' then raise exception 'position_ids must be a list' using errcode = '22023'; end if;
      for v_pos in select jsonb_array_elements_text(coalesce(g -> 'position_ids', '[]'::jsonb)) loop
        if v_pos !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.positions where id = v_pos::uuid) then raise exception 'Unknown post in group %', g ->> 'key' using errcode = '22023'; end if;
      end loop;
      if coalesce(g ->> 'pattern', '') <> '' then
        begin perform '' ~* (g ->> 'pattern');
        exception when others then raise exception 'The match words of group % are not valid', g ->> 'key' using errcode = '22023'; end;
      end if;
    end loop;
    if not (array['manager', 'hub_cc', 'entry_man'] <@ v_keys) then
      raise exception 'Manager, Hub CC and Entry Man groups must stay' using errcode = '22023'; end if;
  end if;
  if p_reasons is not null then
    if jsonb_typeof(p_reasons) <> 'array' or jsonb_array_length(p_reasons) > 40 then raise exception 'Give at most 40 reasons' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(distinct left(trim(x), 120)) filter (where trim(x) <> ''), '[]'::jsonb) into v_reasons from jsonb_array_elements_text(p_reasons) x;
  end if;
  if exists (select 1 from unnest(coalesce(p_skip_hubs, '{}')) h where not exists (select 1 from public.hubs x where x.id = h and x.zone_id = p_zone)) then
    raise exception 'A hub is not in this zone' using errcode = '22023'; end if;
  if not (coalesce(p_off_days, '{}') <@ array[1, 2, 3, 4, 5, 6, 7]) then raise exception 'Days are 1 (Monday) to 7 (Sunday)' using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'Hub operation settings', true);
  insert into public.hub_ops_config (zone_id, groups, reasons, skip_hub_ids, off_days)
  values (p_zone, p_groups, v_reasons, coalesce(p_skip_hubs, '{}'), coalesce(p_off_days, '{}'))
  on conflict (zone_id) do update set groups = excluded.groups, reasons = excluded.reasons,
    skip_hub_ids = excluded.skip_hub_ids, off_days = excluded.off_days;
end $$;

-- ---------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------
revoke all on function public.hub_ops_panel(uuid, date), public.hub_ops_people_search(uuid, text),
  public.hub_ops_save(uuid, date, jsonb, boolean, text), public.hub_ops_review(uuid[], text),
  public.hub_ops_summary(uuid, date, date), public.hub_ops_status_log(uuid, date, date, uuid, uuid), public.hub_ops_history(text, uuid),
  public.hub_ops_boss_list(uuid, text, integer), public.hub_ops_boss_get(uuid, text, date), public.hub_ops_boss_submit(uuid, text, date, text),
  public.hub_ops_boss_review(uuid, text), public.hub_ops_settings(uuid), public.hub_ops_configure(uuid, jsonb, jsonb, uuid[], integer[])
  from public, anon;
grant execute on function public.hub_ops_panel(uuid, date), public.hub_ops_people_search(uuid, text),
  public.hub_ops_save(uuid, date, jsonb, boolean, text), public.hub_ops_review(uuid[], text),
  public.hub_ops_summary(uuid, date, date), public.hub_ops_status_log(uuid, date, date, uuid, uuid), public.hub_ops_history(text, uuid),
  public.hub_ops_boss_list(uuid, text, integer), public.hub_ops_boss_get(uuid, text, date), public.hub_ops_boss_submit(uuid, text, date, text),
  public.hub_ops_boss_review(uuid, text), public.hub_ops_settings(uuid), public.hub_ops_configure(uuid, jsonb, jsonb, uuid[], integer[])
  to authenticated;
