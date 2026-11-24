-- =====================================================================
--  কর্মীর কাজের প্রোফাইল (the staff work profile, step 3 of 3)
--
--  Owner (24 Nov): the zonal manager opens zone -> hub -> person and sees, on one page: who the person is and what they are
--  assigned to now (with the history), their attendance and leave, their routes, and the work they have submitted in every module.
--    * The key is the permanent employee id. When a person is moved to another hub the new duty counts from its effective date;
--      old work keeps the hub and the work date it was done on.
--    * Every module writes ONE kind of line into staff_work_events: employee, hub, work day, module, source record, activity,
--      status and the server time. The same module, source record and record version is counted once however often it is
--      submitted or a job runs again; a draft and its submitted version are one line that moves from draft to submitted.
--      Drafts and submitted lines are shown apart. A new revision of a record is a new version.
--    * The profile adds no permission: the person is seen by who may see the employee (hr.employee.view), each line only by who
--      may see its hub, and a person may see their own.
--
--  Connected now: morning input, daily attendance register, route plan, daily numbers (pickup / delivery), hub operations,
--  sorting (handovers, driver runs). Problem Center, vehicles / fuel, accounts and other apps join by calling
--  private.staff_work_record from their own submit (module codes issues, fleet, accounts, other are ready).
--
--  Undo: drop function public.staff_profile_people / staff_profile_get, the swe_* triggers and functions,
--  private.staff_work_record / swe_backfill; drop table staff_work_events.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The one line every module writes
-- ---------------------------------------------------------------------
create table if not exists public.staff_work_events (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  hub_id         uuid references public.hubs(id),                 -- the hub the work was done for, whatever the person's hub is now
  zone_id        uuid references public.zones(id),
  work_date      date not null,
  module         text not null check (module in ('morning', 'attendance', 'route', 'daily_ops', 'hub_ops', 'sorting', 'issues', 'fleet', 'accounts', 'other')),
  source_table   text not null check (length(source_table) between 1 and 80),
  source_id      uuid not null,
  source_version integer not null default 1 check (source_version >= 1),
  activity       text not null check (length(activity) between 1 and 120),
  status         text not null check (status in ('draft', 'submitted', 'approved', 'cancelled')),
  status_at      timestamptz not null default now(),
  detail         jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  link           text check (link is null or length(link) <= 300),
  server_time    timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (module, source_id, source_version, employee_id)            -- counted once
);
create index if not exists staff_work_events_emp_day on public.staff_work_events (employee_id, work_date desc);
create index if not exists staff_work_events_hub_day on public.staff_work_events (hub_id, work_date desc);
create index if not exists staff_work_events_zone on public.staff_work_events (zone_id);

drop trigger if exists staff_work_events_stamp on public.staff_work_events;
create trigger staff_work_events_stamp before insert or update on public.staff_work_events for each row execute function private.stamp_row();
drop trigger if exists staff_work_events_no_delete on public.staff_work_events;
create trigger staff_work_events_no_delete before delete on public.staff_work_events for each row execute function private.prevent_delete();
alter table public.staff_work_events enable row level security;
revoke all on public.staff_work_events from anon, authenticated;       -- read through staff_profile_get only

-- ---------------------------------------------------------------------
-- 2. The recorder
-- ---------------------------------------------------------------------
-- Same module + source record + version + person = the same line. A draft becomes submitted; a cancel sticks; nothing else moves.
create or replace function private.staff_work_record(p_employee uuid, p_hub uuid, p_zone uuid, p_date date, p_module text, p_table text, p_source uuid,
  p_version integer, p_activity text, p_status text, p_detail jsonb default '{}'::jsonb, p_link text default null, p_at timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_employee is null or p_source is null or p_date is null then return; end if;
  insert into public.staff_work_events (employee_id, hub_id, zone_id, work_date, module, source_table, source_id, source_version, activity, status, status_at, detail, link, server_time)
  values (p_employee, p_hub, coalesce(p_zone, private.hub_zone(p_hub)), p_date, p_module, p_table, p_source, greatest(coalesce(p_version, 1), 1), left(p_activity, 120), p_status, p_at,
          coalesce(p_detail, '{}'::jsonb), p_link, p_at)
  on conflict (module, source_id, source_version, employee_id) do update
    set activity = excluded.activity, status = excluded.status, status_at = now(), detail = excluded.detail, link = coalesce(excluded.link, staff_work_events.link)
    where (staff_work_events.status = 'draft')                                                              -- a draft may change and may be submitted
       or (excluded.status = 'cancelled' and staff_work_events.status <> 'cancelled');                      -- a cancel is final
end $$;

-- ---------------------------------------------------------------------
-- 3. The connected modules: each writes its line from its own table
-- ---------------------------------------------------------------------
-- morning input: the lines of a submitted revision
create or replace function private.swe_morning() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    perform private.staff_work_record(l.employee_id, new.hub_id, new.zone_id, new.work_date, 'morning', 'wf_morning_subs', new.id, new.revision, 'morning_' || l.state, 'submitted',
      jsonb_build_object('state', l.state, 'mode', new.submit_mode, 'revision', new.revision, 'leave_ref', l.leave_ref), '/app/attendance?view=hub&tab=morning&hub=' || new.hub_id::text)
    from public.wf_morning_lines l where l.sub_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists wf_morning_subs_swe on public.wf_morning_subs;
create trigger wf_morning_subs_swe after update of status on public.wf_morning_subs for each row execute function private.swe_morning();

-- the daily register: a line is a draft until its register is submitted; the version is the register's version
create or replace function private.swe_att_line() returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets;
begin
  select * into s from public.att_day_sheets where id = new.sheet_id;
  if s.status = 'draft' and new.final_status is not null then
    perform private.staff_work_record(new.employee_id, s.hub_id, s.zone_id, s.work_date, 'attendance', 'att_day_sheets', s.id, s.version + 1, new.final_status, 'draft',
      jsonb_build_object('status', new.final_status), '/app/attendance?view=hub&tab=final&hub=' || s.hub_id::text || '&date=' || s.work_date::text);
  end if;
  return null;
end $$;
drop trigger if exists att_day_lines_swe on public.att_day_lines;
create trigger att_day_lines_swe after insert or update on public.att_day_lines for each row execute function private.swe_att_line();

create or replace function private.swe_att_sheet() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    perform private.staff_work_record(l.employee_id, new.hub_id, new.zone_id, new.work_date, 'attendance', 'att_day_sheets', new.id, new.version, coalesce(l.final_status, 'unchecked'), 'submitted',
      jsonb_build_object('status', l.final_status, 'late_time', to_char(l.late_time, 'HH24:MI'), 'leave_ref', l.leave_ref, 'leave_applied_on', l.leave_applied_on, 'mode', new.submit_mode),
      '/app/attendance?view=hub&tab=final&hub=' || new.hub_id::text || '&date=' || new.work_date::text)
    from public.att_day_lines l where l.sheet_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists att_day_sheets_swe on public.att_day_sheets;
create trigger att_day_sheets_swe after update of status on public.att_day_sheets for each row execute function private.swe_att_sheet();

-- the route plan: a published assignment (cancelled when a new version takes it away)
create or replace function private.swe_route() returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.route_plan_versions;
begin
  if new.role = 'manager' or new.employee_id is null then return null; end if;
  select * into v from public.route_plan_versions where id = new.version_id;
  perform private.staff_work_record(new.employee_id, new.hub_id, v.zone_id, new.plan_date, 'route', 'route_plan_versions', new.version_id, v.version_no,
    case when new.status = 'cancelled' then 'route_cancelled' else 'route_assigned' end, case when new.status = 'cancelled' then 'cancelled' else 'submitted' end,
    jsonb_build_object('parcels', new.parcels, 'pickups', new.pickups, 'role', new.role, 'version', v.version_no), '/app/routes/plan?hub=' || new.hub_id::text);
  return null;
end $$;
drop trigger if exists route_plan_recipients_swe on public.route_plan_recipients;
create trigger route_plan_recipients_swe after insert or update of status on public.route_plan_recipients for each row execute function private.swe_route();

-- the person's own daily numbers (pickup, pickup return, delivery, delivery return): each revision is a version
create or replace function private.swe_daily_ops() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.staff_work_record(new.employee_id, new.hub_id, new.zone_id, new.work_date, 'daily_ops', 'wf_daily_ops', new.id, new.revision, 'daily_numbers', 'submitted',
    jsonb_build_object('pickup', new.pickup, 'pickup_return', new.pickup_return, 'delivery', new.delivery, 'delivery_return', new.delivery_return), '/app/attendance?view=hub&tab=ops&hub=' || coalesce(new.hub_id::text, ''));
  return null;
end $$;
drop trigger if exists wf_daily_ops_swe on public.wf_daily_ops;
create trigger wf_daily_ops_swe after insert or update on public.wf_daily_ops for each row execute function private.swe_daily_ops();

-- hub operations: a person's row of the hub's report (draft while the report is pending, submitted after)
create or replace function private.swe_hubops_row(p_row public.hub_ops_staff) returns void language plpgsql security definer set search_path = '' as $$
declare r public.hub_ops_reports;
begin
  if p_row.employee_id is null then return; end if;
  select * into r from public.hub_ops_reports where id = p_row.report_id;
  perform private.staff_work_record(p_row.employee_id, p_row.hub_id, r.zone_id, p_row.report_date, 'hub_ops', 'hub_ops_staff', p_row.id, 1, coalesce('hub_ops_' || p_row.attendance, 'hub_ops_row'),
    case when p_row.removed_at is not null then 'cancelled' when r.status = 'pending' then 'draft' else 'submitted' end,
    jsonb_build_object('attendance', p_row.attendance, 'employment', p_row.employment, 'group', p_row.group_key), '/app/zonal/hub-ops/hub/' || p_row.hub_id::text);
end $$;
create or replace function private.swe_hubops_staff() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.swe_hubops_row(new); return null; end $$;
drop trigger if exists hub_ops_staff_swe on public.hub_ops_staff;
create trigger hub_ops_staff_swe after insert or update on public.hub_ops_staff for each row execute function private.swe_hubops_staff();
create or replace function private.swe_hubops_report() returns trigger language plpgsql security definer set search_path = '' as $$
declare x public.hub_ops_staff;
begin
  if new.status is distinct from old.status then
    for x in select * from public.hub_ops_staff where report_id = new.id loop perform private.swe_hubops_row(x); end loop;
  end if;
  return null;
end $$;
drop trigger if exists hub_ops_reports_swe on public.hub_ops_reports;
create trigger hub_ops_reports_swe after update of status on public.hub_ops_reports for each row execute function private.swe_hubops_report();

-- sorting: a handover (the person who handed over) and a driver's run
create or replace function private.swe_sorting_handover() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.staff_work_record(new.handed_by_id, new.hub_id, new.zone_id, new.work_date, 'sorting', 'sorting_handovers', new.id, 1, 'handover_' || new.direction, 'submitted',
    jsonb_build_object('parcels', new.parcel_count, 'bags', new.bag_count, 'state', new.status), '/app/sorting');
  perform private.staff_work_record(new.driver_id, new.hub_id, new.zone_id, new.work_date, 'sorting', 'sorting_handovers', new.id, 1, 'drive_' || new.direction, 'submitted',
    jsonb_build_object('parcels', new.parcel_count, 'state', new.status), '/app/sorting');
  return null;
end $$;
drop trigger if exists sorting_handovers_swe on public.sorting_handovers;
create trigger sorting_handovers_swe after insert or update on public.sorting_handovers for each row execute function private.swe_sorting_handover();

create or replace function private.swe_sorting_run() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.staff_work_record(new.driver_id, null, new.zone_id, new.work_date, 'sorting', 'sorting_driver_reports', new.id, 1, 'driver_run', 'submitted',
    jsonb_build_object('state', new.status, 'hubs_reached', new.hubs_reached, 'parcels_out', new.parcels_out, 'parcels_in', new.parcels_in), '/app/sorting');
  return null;
end $$;
drop trigger if exists sorting_driver_reports_swe on public.sorting_driver_reports;
create trigger sorting_driver_reports_swe after insert or update on public.sorting_driver_reports for each row execute function private.swe_sorting_run();

-- ---------------------------------------------------------------------
-- 4. What was done before this migration (the last 120 days), through the same recorder
-- ---------------------------------------------------------------------
create or replace function private.swe_backfill(p_days integer default 120) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_from date := current_date - greatest(p_days, 1); v_before integer; x record;
begin
  select count(*) into v_before from public.staff_work_events;
  for x in select s.*, l.employee_id as emp, l.state, l.leave_ref from public.wf_morning_subs s join public.wf_morning_lines l on l.sub_id = s.id where s.status in ('submitted', 'returned') and s.work_date >= v_from loop
    perform private.staff_work_record(x.emp, x.hub_id, x.zone_id, x.work_date, 'morning', 'wf_morning_subs', x.id, x.revision, 'morning_' || x.state, 'submitted',
      jsonb_build_object('state', x.state, 'mode', x.submit_mode, 'revision', x.revision, 'leave_ref', x.leave_ref), '/app/attendance?view=hub&tab=morning&hub=' || x.hub_id::text, coalesce(x.submitted_at, now()));
  end loop;
  for x in select s.*, l.employee_id as emp, l.final_status, l.late_time, l.leave_ref, l.leave_applied_on from public.att_day_sheets s join public.att_day_lines l on l.sheet_id = s.id where s.work_date >= v_from and (s.status = 'submitted' or s.version > 0 or l.final_status is not null) loop
    perform private.staff_work_record(x.emp, x.hub_id, x.zone_id, x.work_date, 'attendance', 'att_day_sheets', x.id, case when x.status = 'submitted' then greatest(x.version, 1) else x.version + 1 end,
      coalesce(x.final_status, 'unchecked'), case when x.status = 'submitted' then 'submitted' else 'draft' end,
      jsonb_build_object('status', x.final_status, 'late_time', to_char(x.late_time, 'HH24:MI'), 'leave_ref', x.leave_ref, 'leave_applied_on', x.leave_applied_on),
      '/app/attendance?view=hub&tab=final&hub=' || x.hub_id::text || '&date=' || x.work_date::text, coalesce(x.submitted_at, x.updated_at));
  end loop;
  for x in select r.*, v.version_no, v.zone_id as vzone from public.route_plan_recipients r join public.route_plan_versions v on v.id = r.version_id where r.plan_date >= v_from and r.role <> 'manager' and r.employee_id is not null loop
    perform private.staff_work_record(x.employee_id, x.hub_id, x.vzone, x.plan_date, 'route', 'route_plan_versions', x.version_id, x.version_no,
      case when x.status = 'cancelled' then 'route_cancelled' else 'route_assigned' end, case when x.status = 'cancelled' then 'cancelled' else 'submitted' end,
      jsonb_build_object('parcels', x.parcels, 'pickups', x.pickups, 'role', x.role, 'version', x.version_no), '/app/routes/plan?hub=' || x.hub_id::text, x.created_at);
  end loop;
  for x in select * from public.wf_daily_ops where work_date >= v_from loop
    perform private.staff_work_record(x.employee_id, x.hub_id, x.zone_id, x.work_date, 'daily_ops', 'wf_daily_ops', x.id, x.revision, 'daily_numbers', 'submitted',
      jsonb_build_object('pickup', x.pickup, 'pickup_return', x.pickup_return, 'delivery', x.delivery, 'delivery_return', x.delivery_return), '/app/attendance?view=hub&tab=ops&hub=' || coalesce(x.hub_id::text, ''), x.updated_at);
  end loop;
  for x in select * from public.hub_ops_staff where report_date >= v_from and employee_id is not null loop perform private.swe_hubops_row(x); end loop;
  for x in select * from public.sorting_handovers where work_date >= v_from loop
    perform private.staff_work_record(x.handed_by_id, x.hub_id, x.zone_id, x.work_date, 'sorting', 'sorting_handovers', x.id, 1, 'handover_' || x.direction, 'submitted',
      jsonb_build_object('parcels', x.parcel_count, 'bags', x.bag_count, 'state', x.status), '/app/sorting', x.created_at);
    perform private.staff_work_record(x.driver_id, x.hub_id, x.zone_id, x.work_date, 'sorting', 'sorting_handovers', x.id, 1, 'drive_' || x.direction, 'submitted',
      jsonb_build_object('parcels', x.parcel_count, 'state', x.status), '/app/sorting', x.created_at);
  end loop;
  for x in select * from public.sorting_driver_reports where work_date >= v_from loop
    perform private.staff_work_record(x.driver_id, null, x.zone_id, x.work_date, 'sorting', 'sorting_driver_reports', x.id, 1, 'driver_run', 'submitted',
      jsonb_build_object('state', x.status, 'hubs_reached', x.hubs_reached, 'parcels_out', x.parcels_out, 'parcels_in', x.parcels_in), '/app/sorting', x.created_at);
  end loop;
  return (select count(*) from public.staff_work_events) - v_before;
end $$;
select private.swe_backfill(120);

-- ---------------------------------------------------------------------
-- 5. Reading: zone -> hub -> person, and one person's profile
-- ---------------------------------------------------------------------
-- The people of a hub (for the picker): the active staff first, then who left.
create or replace function public.staff_profile_people(p_hub uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.employee.view', v_zone, p_hub) then raise exception 'Not authorised to see the staff of this hub.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'post', coalesce(ps.name_bn, ps.name), 'status', e.status)
                     order by (e.status <> 'active'), e.full_name)
                     from public.employees e left join public.positions ps on ps.id = e.position_id where e.hub_id = p_hub and e.archived_at is null), '[]'::jsonb);
end $$;

create or replace function public.staff_profile_get(p_employee uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_to date := coalesce(p_to, private.wf_today()); v_from date; v_self boolean; v_att jsonb; v_events jsonb; v_mods jsonb; v_days jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into e from public.employees where id = p_employee;
  v_self := private.is_self_employee(p_employee);
  if e.id is null or not (v_self or private.employee_has_permission('hr.employee.view', p_employee)) then
    raise exception 'Not authorised to see this person''s profile.' using errcode = '42501'; end if;
  v_from := coalesce(p_from, date_trunc('month', v_to)::date);
  if v_from > v_to or v_to - v_from > 123 then raise exception 'Choose a period of at most four months.' using errcode = '22023'; end if;

  -- attendance: this person's lines of the registers, each only where the viewer may see that hub's attendance; draft and submitted apart
  select coalesce(jsonb_agg(jsonb_build_object('date', s.work_date, 'hub_id', s.hub_id, 'hub', private.hub_name(s.hub_id), 'status', l.final_status, 'sheet_status', s.status, 'version', s.version,
           'late_time', to_char(l.late_time, 'HH24:MI'), 'absence_reason', l.absence_reason, 'unauthorized', l.unauthorized, 'leave_ref', l.leave_ref, 'leave_applied_on', l.leave_applied_on,
           'online_marked', l.online_marked, 'online_at', l.online_at, 'mode', s.submit_mode) order by s.work_date desc), '[]'::jsonb) into v_days
    from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
   where l.employee_id = p_employee and s.work_date between v_from and v_to and (v_self or private.has_permission('hr.attendance.view', s.zone_id, s.hub_id));
  v_att := jsonb_build_object('days', v_days,
    'present', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' in ('present', 'late', 'half_day')),
    'late', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' = 'late'),
    'absent', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' = 'absent'),
    'unauthorized', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and (d ->> 'unauthorized')::boolean),
    'leave', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' = 'leave'),
    'off', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' in ('holiday', 'weekly_off')),
    'unchecked', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' in ('unchecked', 'pending_leave')),
    'drafts', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'draft'));

  -- every module's lines, each only where the viewer may see its hub (a line of a zone-wide record needs the zone)
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'date', w.work_date, 'module', w.module, 'activity', w.activity, 'status', w.status, 'hub_id', w.hub_id, 'hub', private.hub_name(w.hub_id),
           'source_id', w.source_id, 'version', w.source_version, 'detail', w.detail, 'server_time', w.server_time, 'link', w.link) order by w.work_date desc, w.server_time desc), '[]'::jsonb) into v_events
    from (select * from public.staff_work_events x where x.employee_id = p_employee and x.work_date between v_from and v_to
             and (v_self or private.has_permission('hr.employee.view', x.zone_id, x.hub_id)) order by x.work_date desc, x.server_time desc limit 300) w;
  select coalesce(jsonb_agg(jsonb_build_object('module', t.module, 'submitted', t.submitted, 'draft', t.draft, 'cancelled', t.cancelled, 'last_at', t.last_at) order by t.module), '[]'::jsonb) into v_mods
    from (select x.module, count(distinct x.source_id) filter (where x.status in ('submitted', 'approved')) as submitted, count(distinct x.source_id) filter (where x.status = 'draft') as draft,
                 count(distinct x.source_id) filter (where x.status = 'cancelled') as cancelled, max(x.server_time) as last_at
            from public.staff_work_events x where x.employee_id = p_employee and x.work_date between v_from and v_to
             and (v_self or private.has_permission('hr.employee.view', x.zone_id, x.hub_id)) group by x.module) t;

  return jsonb_build_object('from', v_from, 'to', v_to, 'today', private.wf_today(),
    'person', jsonb_build_object('id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'name_bn', e.full_name_bn, 'status', e.status, 'joining_date', e.joining_date,
      'position_id', e.position_id, 'position', (select coalesce(ps.name_bn, ps.name) from public.positions ps where ps.id = e.position_id),
      'department', (select coalesce(d.name_bn, d.name) from public.departments d where d.id = e.department_id),
      'hub_id', e.hub_id, 'hub', private.hub_name(e.hub_id), 'zone_id', e.zone_id, 'zone', (select z.name from public.zones z where z.id = e.zone_id),
      'manager', (select m.full_name from public.employees m where m.id = e.reporting_manager_id),
      'has_login', e.profile_id is not null,
      'focus', (select jsonb_build_object('code', o ->> 'code', 'label', coalesce(o ->> 'label_bn', o ->> 'label'), 'color', o ->> 'color')
                  from public.positions ps, jsonb_array_elements(ps.focus_options) o where ps.id = e.position_id and o ->> 'code' = e.work_focus)),
    -- the assignment now and before: the new hub's duty counts from its effective date, what was done earlier keeps its own hub and day
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('type', a.change_type, 'from', a.effective_from, 'to', a.effective_to,
          'position', (select coalesce(ps.name_bn, ps.name) from public.positions ps where ps.id = a.position_id), 'hub', private.hub_name(a.hub_id),
          'zone', (select z.name from public.zones z where z.id = a.zone_id), 'reason', a.reason) order by a.effective_from desc, a.created_at desc)
        from public.employee_assignments a where a.employee_id = p_employee), '[]'::jsonb),
    -- duties: the person's own and the post's (for the person's focus too)
    'duties', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'details', d.details, 'frequency', d.frequency,
          'source', case when d.employee_id is not null then 'person' else 'post' end) order by d.sort, d.title)
        from public.job_duties d where d.archived_at is null and (d.employee_id = e.id or (d.position_id = e.position_id and (d.focus is null or d.focus = e.work_focus)))), '[]'::jsonb),
    'attendance', v_att,
    'leave', case when v_self or private.employee_has_permission('hr.leave.view', p_employee) then coalesce((select jsonb_agg(jsonb_build_object('ref', 'LR-' || upper(left(l.id::text, 8)), 'from', l.from_date, 'to', l.to_date,
          'days', l.days, 'status', l.status, 'applied_on', (l.created_at at time zone 'Asia/Dhaka')::date) order by l.from_date desc)
        from public.leave_requests l where l.employee_id = p_employee and l.to_date >= v_from and l.from_date <= v_to), '[]'::jsonb) end,
    'routes', coalesce((select jsonb_agg(jsonb_build_object('route_id', r.id, 'code', r.code, 'name', r.name, 'hub', private.hub_name(r.hub_id), 'from', rr.effective_from, 'to', rr.effective_to) order by r.code)
        from public.rider_routes rr join public.hub_routes r on r.id = rr.route_id
       where rr.employee_id = p_employee and (rr.effective_to is null or rr.effective_to >= current_date) and r.archived_at is null
         and (v_self or private.has_permission('hr.employee.view', r.zone_id, r.hub_id))), '[]'::jsonb),
    'backup', coalesce((select sl.helper from public.route_staff_load sl where sl.employee_id = p_employee), false),
    'modules', v_mods, 'events', v_events,
    'connected', jsonb_build_array('morning', 'attendance', 'route', 'daily_ops', 'hub_ops', 'sorting'));
end $$;

revoke all on function private.staff_work_record(uuid, uuid, uuid, date, text, text, uuid, integer, text, text, jsonb, text, timestamptz), private.swe_backfill(integer),
  private.swe_hubops_row(public.hub_ops_staff) from public, anon, authenticated;
revoke all on function public.staff_profile_people(uuid), public.staff_profile_get(uuid, date, date) from public, anon;
grant execute on function public.staff_profile_people(uuid), public.staff_profile_get(uuid, date, date) to authenticated;
