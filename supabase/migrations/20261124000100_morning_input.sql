-- =====================================================================
--  সকালের জনবল ও রুট প্রকাশ (the morning input of a hub, and the published versions of the day's route plan)
--
--  Owner (24 Nov), step 1 of "morning input and route -> daily / monthly register -> staff work profile":
--    * Every morning the hub manager says who came, who did not, and whose attendance is still unchecked, and submits it
--      to the zonal manager. Approved leave sits in by itself. At the cut-off time the server submits what is typed
--      (blank rows stay "unchecked"). One submission per hub, day and revision: a manual submit and the job that meets at
--      the same moment make ONE submission.
--    * After the submit the hub manager sees only a receipt. The lines are for the zonal manager, who may send the form
--      back with a reason; that opens the next revision (the old one is kept).
--    * The route plan reads "who is here" from the latest submitted morning input. At approval the latest input and each
--      rider's availability are checked again; the approved plan is saved as a numbered version together with its
--      recipients and their messages in ONE transaction. Sending it again repeats the same version. Changing a rider
--      publishes a new version and cancels the old rider's assignment. A rider never has to accept or read anything.
--
--  Sits on what is there: employees, hub_routes / rider_routes, route_day_plans / route_day_riders, leave_requests,
--  wf_absence_applications, notifications. New: wf_att_policy, wf_morning_subs, wf_morning_lines, route_plan_versions,
--  route_plan_recipients, route_plan_events. Replaced (same signatures): private.route_presence, public.route_plan_decide,
--  public.route_plan_mine. No new permission: hr.attendance.create fills the form (hub scope), ops.route_plan.approve reads
--  the lines, sends back and resends (zone scope), hr.attendance.configure sets the times.
--
--  Undo: drop function public.wf_morning_*, public.route_plan_resend/published/morning, private.wf_morning_*;
--  drop table route_plan_events, route_plan_recipients, route_plan_versions, wf_morning_lines, wf_morning_subs, wf_att_policy;
--  alter table route_day_plans drop column morning_sub_id, morning_revision, published_version; then run route_presence /
--  route_plan_decide / route_plan_mine again from 20261122000500_route_day_plan.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Times (one row per zone; no row = the company default below)
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('workforce.morning_cutoff',    '"08:00"', 'Morning input: the time (Asia/Dhaka) after which the server submits what is typed'),
  ('workforce.morning_extra_min', '15',      'Morning input: extra minutes after the cut-off'),
  ('workforce.day_close_time',    '"00:00"', 'Daily register: the time of the next day (Asia/Dhaka) at which an open register is submitted'),
  ('workforce.day_close_extra_min', '0',     'Daily register: extra minutes after that time'),
  -- The first work day (Asia/Dhaka) the server may submit for. Days before it are never touched by the two server jobs, so switching this on does not
  -- create registers or morning inputs for the days just before it. Set once, on the day this migration first runs; running it again keeps the date.
  ('workforce.auto_submit_from', to_jsonb(((now() at time zone 'Asia/Dhaka')::date)::text), 'Server auto-submit (morning input and daily register): the first work day it may submit for, YYYY-MM-DD, Asia/Dhaka')
on conflict (key) do nothing;

create table if not exists public.wf_att_policy (
  zone_id        uuid primary key references public.zones(id),
  morning_cutoff time not null default '08:00',
  morning_extra  integer not null default 15 check (morning_extra between 0 and 360),
  day_time       time not null default '00:00',
  day_extra      integer not null default 0 check (day_extra between 0 and 360),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint wf_att_policy_same_day check (morning_cutoff + make_interval(mins => morning_extra) >= morning_cutoff
                                           and morning_cutoff + make_interval(mins => morning_extra) <= time '23:59:59')
);

-- ---------------------------------------------------------------------
-- 2. The morning input: one row per hub, day and revision, and its lines
-- ---------------------------------------------------------------------
create table if not exists public.wf_morning_subs (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  work_date     date not null,
  revision      integer not null default 1 check (revision >= 1),
  status        text not null default 'open' check (status in ('open', 'submitted', 'returned')),
  submit_mode   text check (submit_mode in ('manager', 'auto')),
  submitted_by  uuid, submitted_at timestamptz,
  returned_by   uuid, returned_at timestamptz, return_reason text check (return_reason is null or length(return_reason) <= 500),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (hub_id, work_date, revision),                                                -- the lasting key of a submission
  check ((status = 'submitted') = (submitted_at is not null) or status = 'returned'),
  check ((status = 'returned') = (returned_at is not null))
);
create unique index if not exists wf_morning_subs_one_open on public.wf_morning_subs (hub_id, work_date) where status = 'open';
create unique index if not exists wf_morning_subs_one_submitted on public.wf_morning_subs (hub_id, work_date) where status = 'submitted';
create index if not exists wf_morning_subs_zone_day on public.wf_morning_subs (zone_id, work_date);

create table if not exists public.wf_morning_lines (
  id          uuid primary key default gen_random_uuid(),
  sub_id      uuid not null references public.wf_morning_subs(id),
  employee_id uuid not null references public.employees(id),
  state       text not null default 'unknown' check (state in ('present', 'absent', 'leave', 'unknown')),
  leave_ref   text check (leave_ref is null or length(leave_ref) <= 60),               -- the approved leave that put it there
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (sub_id, employee_id)
);
create index if not exists wf_morning_lines_emp on public.wf_morning_lines (employee_id);

-- An empty or unfinished register / morning input is never submitted by the server: it is held, and the hub's and the zone's managers are told once.
-- One row per kind, hub and day; resolved when the manager submits it.
create table if not exists public.wf_auto_holds (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('morning', 'daily')),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid references public.zones(id),
  work_date   date not null,
  reason      text not null check (reason in ('empty', 'incomplete')),
  gap_count   integer not null check (gap_count >= 0),
  total       integer not null check (total >= 0),
  gaps        jsonb not null default '[]'::jsonb check (jsonb_typeof(gaps) = 'array'),      -- [{name, why}] the first ones, for the message and the page
  held_at     timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (kind, hub_id, work_date)
);
create index if not exists wf_auto_holds_hub on public.wf_auto_holds (hub_id);
create index if not exists wf_auto_holds_zone on public.wf_auto_holds (zone_id);

-- ---------------------------------------------------------------------
-- 3. Published route plan versions
-- ---------------------------------------------------------------------
alter table public.route_day_plans
  add column if not exists morning_sub_id uuid references public.wf_morning_subs(id),
  add column if not exists morning_revision integer,
  add column if not exists published_version integer not null default 0;

create table if not exists public.route_plan_versions (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.route_day_plans(id),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  plan_date       date not null,
  version_no      integer not null check (version_no >= 1),
  morning_sub_id  uuid references public.wf_morning_subs(id),
  morning_revision integer,
  snapshot        jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_by    uuid, published_by_name text, published_at timestamptz not null default now(),
  superseded_at   timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (plan_id, version_no)
);
create index if not exists route_plan_versions_hub_day on public.route_plan_versions (hub_id, plan_date);

create table if not exists public.route_plan_recipients (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.route_plan_versions(id),
  plan_id       uuid not null references public.route_day_plans(id),
  hub_id        uuid not null references public.hubs(id),
  plan_date     date not null,
  role          text not null check (role in ('manager', 'rider', 'helper')),
  profile_id    uuid,
  employee_id   uuid references public.employees(id),
  parcels       integer not null default 0,
  pickups       integer not null default 0,
  detail        jsonb not null default '[]'::jsonb,
  note          text,
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at  timestamptz, cancelled_in_version integer,
  sent_count    integer not null default 0, first_sent_at timestamptz, last_sent_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (profile_id is not null or employee_id is not null)
);
create index if not exists route_plan_recipients_emp_day on public.route_plan_recipients (employee_id, plan_date) where status = 'active';
create index if not exists route_plan_recipients_version on public.route_plan_recipients (version_id);

create table if not exists public.route_plan_events (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.route_day_plans(id),
  hub_id      uuid not null references public.hubs(id),
  plan_date   date not null,
  version_no  integer,
  kind        text not null check (kind in ('published', 'resent', 'cancelled', 'morning_returned', 'morning_changed')),
  note        text,
  actor       uuid, actor_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists route_plan_events_plan on public.route_plan_events (plan_id, created_at);

-- every foreign key has an index (the performance test insists)
create index if not exists route_day_plans_morning_sub on public.route_day_plans (morning_sub_id) where morning_sub_id is not null;
create index if not exists route_plan_versions_zone on public.route_plan_versions (zone_id);
create index if not exists route_plan_versions_morning_sub on public.route_plan_versions (morning_sub_id) where morning_sub_id is not null;
create index if not exists route_plan_recipients_plan on public.route_plan_recipients (plan_id);
create index if not exists route_plan_recipients_hub on public.route_plan_recipients (hub_id);
create index if not exists route_plan_events_hub on public.route_plan_events (hub_id);

-- Row rules: no table is read or written directly. Everything goes through the functions below.
do $$
declare t text;
begin
  foreach t in array array['wf_att_policy', 'wf_morning_subs', 'wf_morning_lines', 'wf_auto_holds', 'route_plan_versions', 'route_plan_recipients', 'route_plan_events'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'hr');
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- The route plan row keeps pointing at the latest submitted morning input while it is not approved.
create or replace function private.route_plan_morning_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'approved' then
    select s.id, s.revision into new.morning_sub_id, new.morning_revision
      from public.wf_morning_subs s where s.hub_id = new.hub_id and s.work_date = new.plan_date and s.status = 'submitted';
  end if;
  return new;
end $$;
drop trigger if exists route_day_plans_morning_link on public.route_day_plans;
create trigger route_day_plans_morning_link before insert or update on public.route_day_plans
  for each row execute function private.route_plan_morning_link();

-- ---------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------
create or replace function private.wf_setting_text(p_key text, p_default text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value #>> '{}' from public.system_settings s where s.key = p_key), p_default)
$$;

-- The moment (timestamptz) after which a hub's morning input of a date is submitted by the server.
create or replace function private.wf_morning_due(p_zone uuid, p_date date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((p_date + coalesce(p.morning_cutoff, nullif(private.wf_setting_text('workforce.morning_cutoff', '08:00'), '')::time, time '08:00')
           + make_interval(mins => coalesce(p.morning_extra, private.wf_int('workforce.morning_extra_min', 15, 0, 360))))::timestamp
          at time zone 'Asia/Dhaka')
  from (select 1) one left join public.wf_att_policy p on p.zone_id = p_zone
$$;

-- The leave an employee has on a date: the approved leave request, else an approved absence application (one reference).
create or replace function private.wf_leave_on(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('ref', 'LR-' || upper(left(l.id::text, 8)), 'source', 'leave_request', 'applied_on', (l.created_at at time zone 'Asia/Dhaka')::date)
       from public.leave_requests l where l.employee_id = p_employee and l.status = 'approved' and p_date between l.from_date and l.to_date
      order by l.created_at limit 1),
    (select jsonb_build_object('ref', w.application_no, 'source', 'absence_application', 'applied_on', (w.created_at at time zone 'Asia/Dhaka')::date)
       from public.wf_absence_applications w where w.employee_id = p_employee and w.status = 'approved' and p_date = any(w.dates)
      order by w.created_at limit 1))
$$;

-- Hold: the server did not submit an empty or unfinished morning input / register. Tells the hub's and the zone's managers ONCE (again only if it is
-- held anew after being submitted and opened again). Returns true when the managers were told now.
create or replace function private.wf_hold_set(p_kind text, p_hub uuid, p_date date, p_reason text, p_total integer, p_gap_count integer, p_gaps jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare h public.wf_auto_holds; v_zone uuid := private.hub_zone(p_hub); v_new boolean; m uuid; v_names text; v_body text; v_link text; v_title text;
begin
  select * into h from public.wf_auto_holds where kind = p_kind and hub_id = p_hub and work_date = p_date for update;
  v_new := h.id is null or h.resolved_at is not null;
  insert into public.wf_auto_holds (kind, hub_id, zone_id, work_date, reason, gap_count, total, gaps)
  values (p_kind, p_hub, v_zone, p_date, p_reason, p_gap_count, p_total, coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(p_gaps) x limit 12) q), '[]'::jsonb))
  on conflict (kind, hub_id, work_date) do update set reason = excluded.reason, gap_count = excluded.gap_count, total = excluded.total, gaps = excluded.gaps,
    held_at = case when public.wf_auto_holds.resolved_at is not null then now() else public.wf_auto_holds.held_at end, resolved_at = null;
  if v_new then
    select string_agg(x ->> 'name', ', ') into v_names from (select x from jsonb_array_elements(p_gaps) x limit 5) q;
    v_title := case p_kind when 'morning' then 'সকালের জনবল জমা আটকে আছে' else 'দৈনিক হাজিরা খাতা জমা আটকে আছে' end;
    v_body := coalesce(private.hub_name(p_hub), '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || ' — '
      || case when p_reason = 'empty' then 'কিছুই লেখা হয়নি' else p_gap_count || ' জনের হাজিরা অসম্পূর্ণ' || coalesce(' (' || v_names || ')', '') end
      || '। অসম্পূর্ণ হাজিরা সার্ভার জমা দেয় না — হাব ম্যানেজার পূরণ করে জমা দিন।';
    v_link := case p_kind when 'morning' then '/app/attendance?view=hub&tab=morning&hub=' || p_hub::text else '/app/attendance?view=hub&tab=final&hub=' || p_hub::text || '&date=' || p_date::text end;
    for m in select * from private.wf_role_hub_managers(p_hub) union select * from private.wf_role_zone_managers(v_zone) loop
      perform private.notify(m, v_title, v_body, v_link, case p_kind when 'morning' then 'wf_morning' else 'attendance_gap' end);
    end loop;
  end if;
  return v_new;
end $$;

create or replace function private.wf_hold_resolve(p_kind text, p_hub uuid, p_date date) returns void
language sql security definer set search_path = '' as $$
  update public.wf_auto_holds set resolved_at = now() where kind = p_kind and hub_id = p_hub and work_date = p_date and resolved_at is null
$$;

-- The first work day the server jobs may submit for (see the setting above). Missing or unreadable: the date is far away, so the jobs do nothing.
create or replace function private.wf_auto_from() returns date
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select s.value #>> '{}' into v from public.system_settings s where s.key = 'workforce.auto_submit_from';
  return v::date;
exception when others then
  return date '9999-12-31';
end $$;

-- The people a hub counts every morning: its active staff.
create or replace function private.wf_morning_people(p_hub uuid) returns table (id uuid, code text, name text, post text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name::text, coalesce(ps.name_bn, ps.name)::text
    from public.employees e left join public.positions ps on ps.id = e.position_id
   where e.hub_id = p_hub and e.status = 'active' and e.archived_at is null
   order by e.full_name
$$;

-- Profiles holding the hub-scope Hub Manager role of a hub, and the zone-scope Zonal Manager role of a zone — active accounts only, nobody is messaged on a closed account.
-- (Named apart from private.wf_hub_managers, which already exists and means "whoever may mark the hub's attendance"; that one is left as it was.)
create or replace function private.wf_role_hub_managers(p_hub uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles pr on pr.id = ur.user_id
   where r.code = 'hub_manager' and ur.scope_type = 'hub' and ur.hub_id = p_hub and ur.revoked_at is null and pr.status = 'active' and pr.archived_at is null
     and ur.valid_from <= private.wf_today() and (ur.valid_to is null or ur.valid_to >= private.wf_today())
$$;
create or replace function private.wf_role_zone_managers(p_zone uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles pr on pr.id = ur.user_id
   where r.code = 'zonal_manager' and ur.scope_type = 'zone' and ur.zone_id = p_zone and ur.revoked_at is null and pr.status = 'active' and pr.archived_at is null
     and ur.valid_from <= private.wf_today() and (ur.valid_to is null or ur.valid_to >= private.wf_today())
$$;

-- A date the morning input may be about: today, or one of the two days before.
create or replace function private.wf_morning_date(p_date date) returns date
language plpgsql stable set search_path = '' as $$
declare v date := coalesce(p_date, private.wf_today());
begin
  if v > private.wf_today() or v < private.wf_today() - 2 then
    raise exception 'The morning input is for today or one of the last two days.' using errcode = '22023';
  end if;
  return v;
end $$;

-- The one place a morning input is closed, by the manager or by the job. The advisory lock makes two callers at the
-- same moment take turns, so a day, hub and revision is closed once. Returns the submission id (null = it was already closed).
create or replace function private.wf_morning_close(p_hub uuid, p_date date, p_lines jsonb, p_mode text, p_by uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_sub public.wf_morning_subs; x jsonb; v_emp uuid; v_state text; v_leave jsonb; p record; v_set jsonb := '{}'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || p_hub::text || p_date::text, 0));
  select zone_id into v_zone from public.hubs where id = p_hub;
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = p_date and status = 'open' for update;
  if v_sub.id is null then
    if exists (select 1 from public.wf_morning_subs where hub_id = p_hub and work_date = p_date) then return null; end if;   -- already closed
    insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status) values (p_hub, v_zone, p_date, 1, 'open') returning * into v_sub;
  end if;
  -- what was typed: lines already saved, then the lines of this call
  select coalesce(jsonb_object_agg(l.employee_id::text, l.state), '{}'::jsonb) into v_set from public.wf_morning_lines l where l.sub_id = v_sub.id;
  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then raise exception 'The lines must be a list.' using errcode = '22023'; end if;
    for x in select e from jsonb_array_elements(p_lines) e loop
      begin v_emp := (x ->> 'employee_id')::uuid; exception when others then raise exception 'A person is written wrongly.' using errcode = '22023'; end;
      v_state := x ->> 'state';
      if v_state is null or v_state not in ('present', 'absent', 'unknown') then raise exception 'A person is present, absent or unchecked.' using errcode = '22023'; end if;
      if not exists (select 1 from private.wf_morning_people(p_hub) q where q.id = v_emp) then
        raise exception 'A person does not work at this hub.' using errcode = '22023';
      end if;
      v_set := v_set || jsonb_build_object(v_emp::text, v_state);
    end loop;
  end if;
  for p in select * from private.wf_morning_people(p_hub) loop
    v_leave := private.wf_leave_on(p.id, p_date);
    insert into public.wf_morning_lines (sub_id, employee_id, state, leave_ref)
    values (v_sub.id, p.id, case when v_leave is not null then 'leave' else coalesce(v_set ->> p.id::text, 'unknown') end, v_leave ->> 'ref')
    on conflict (sub_id, employee_id) do update set state = excluded.state, leave_ref = excluded.leave_ref
      where (wf_morning_lines.state, wf_morning_lines.leave_ref) is distinct from (excluded.state, excluded.leave_ref);
  end loop;
  update public.wf_morning_subs set status = 'submitted', submit_mode = p_mode, submitted_by = p_by, submitted_at = now() where id = v_sub.id;
  perform private.wf_hold_resolve('morning', p_hub, p_date);
  return v_sub.id;
end $$;

-- ---------------------------------------------------------------------
-- 5. The hub manager's form
-- ---------------------------------------------------------------------
-- One call: the form while it is open, the receipt after it is submitted. The lines go only to who may read them (zone).
create or replace function public.wf_morning_get(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_cur public.wf_morning_subs; v_sub public.wf_morning_subs; v_fill boolean; v_review boolean; v_show boolean;
  v_people jsonb := null; v_back public.wf_morning_subs;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  v_fill := private.has_permission('hr.attendance.create', v_zone, p_hub);
  v_review := private.has_permission('ops.route_plan.approve', v_zone, p_hub);
  if not (v_fill or v_review) then raise exception 'Not authorised to open the morning input of this hub.' using errcode = '42501'; end if;
  select * into v_cur from public.wf_morning_subs where hub_id = p_hub and work_date = v_date order by revision desc limit 1;
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'submitted';
  select * into v_back from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'returned' order by revision desc limit 1;
  -- the form: only while open and only to who fills it. The lines of a submission: only to the zone.
  v_show := (v_cur.id is null or v_cur.status = 'open') and v_fill;
  if v_show or (v_review and v_sub.id is not null) then
    v_people := coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'code', q.code, 'name', q.name, 'post', q.post,
        'state', case when lv.j is not null then 'leave' else coalesce(l.state, 'unknown') end,
        'leave', lv.j) order by q.name)
      from private.wf_morning_people(p_hub) q
      left join public.wf_morning_lines l on l.employee_id = q.id and l.sub_id = coalesce(v_sub.id, v_cur.id)
      left join lateral (select private.wf_leave_on(q.id, v_date) as j) lv on true), '[]'::jsonb);
  end if;
  return jsonb_build_object('hub', (select jsonb_build_object('id', h.id, 'name', h.name, 'zone_id', h.zone_id) from public.hubs h where h.id = p_hub),
    'date', v_date, 'today', private.wf_today(), 'now', now(), 'due', private.wf_morning_due(v_zone, v_date),
    'status', case when v_sub.id is not null then 'submitted' else 'open' end,
    'revision', coalesce(v_sub.revision, v_cur.revision, 1),
    'can', jsonb_build_object('fill', v_show, 'review', v_review),
    'receipt', case when v_sub.id is not null then jsonb_build_object('revision', v_sub.revision, 'mode', v_sub.submit_mode, 'submitted_at', v_sub.submitted_at,
        'submitted_by_name', (select coalesce(pr.full_name, 'user') from public.profiles pr where pr.id = v_sub.submitted_by)) end,
    'returned', case when v_back.id is not null and v_sub.id is null then jsonb_build_object('reason', v_back.return_reason, 'at', v_back.returned_at) end,
    'hold', (select jsonb_build_object('held_at', k.held_at, 'reason', k.reason, 'gap_count', k.gap_count, 'total', k.total, 'gaps', k.gaps)
               from public.wf_auto_holds k where k.kind = 'morning' and k.hub_id = p_hub and k.work_date = v_date and k.resolved_at is null),
    'people', v_people);
end $$;

-- Save what is typed so far (the server closes it at the cut-off with whatever is here).
create or replace function public.wf_morning_save(p_hub uuid, p_date date, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_sub public.wf_morning_subs; x jsonb; v_emp uuid; v_state text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null and status = 'active';
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.create', v_zone, p_hub) then raise exception 'Not authorised to fill the morning input of this hub.' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'The lines must be a list.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || p_hub::text || v_date::text, 0));
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'open' for update;
  if v_sub.id is null then
    if exists (select 1 from public.wf_morning_subs where hub_id = p_hub and work_date = v_date) then raise exception 'The morning input is locked.' using errcode = '22023'; end if;
    insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status) values (p_hub, v_zone, v_date, 1, 'open') returning * into v_sub;
  end if;
  for x in select e from jsonb_array_elements(p_lines) e loop
    begin v_emp := (x ->> 'employee_id')::uuid; exception when others then raise exception 'A person is written wrongly.' using errcode = '22023'; end;
    v_state := x ->> 'state';
    if v_state is null or v_state not in ('present', 'absent', 'unknown') then raise exception 'A person is present, absent or unchecked.' using errcode = '22023'; end if;
    if not exists (select 1 from private.wf_morning_people(p_hub) q where q.id = v_emp) then raise exception 'A person does not work at this hub.' using errcode = '22023'; end if;
    insert into public.wf_morning_lines (sub_id, employee_id, state) values (v_sub.id, v_emp, v_state)
    on conflict (sub_id, employee_id) do update set state = excluded.state where wf_morning_lines.state is distinct from excluded.state;
  end loop;
end $$;

-- Submit to the zonal manager. Every line of the hub's people is written; approved leave goes in by itself; blank = unchecked.
create or replace function public.wf_morning_submit(p_hub uuid, p_date date, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_id uuid; v_sub public.wf_morning_subs;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null and status = 'active';
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.create', v_zone, p_hub) then raise exception 'Not authorised to submit the morning input of this hub.' using errcode = '42501'; end if;
  v_id := private.wf_morning_close(p_hub, v_date, p_lines, 'manager', auth.uid());
  if v_id is null then
    select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'submitted';
    if v_sub.id is null then raise exception 'The morning input is locked.' using errcode = '22023'; end if;   -- sent back and not open (cannot happen) / race
    return jsonb_build_object('revision', v_sub.revision, 'mode', v_sub.submit_mode, 'submitted_at', v_sub.submitted_at, 'already', true);
  end if;
  select * into v_sub from public.wf_morning_subs where id = v_id;
  return jsonb_build_object('revision', v_sub.revision, 'mode', v_sub.submit_mode, 'submitted_at', v_sub.submitted_at, 'already', false);
end $$;

-- ---------------------------------------------------------------------
-- 6. The zonal manager's morning
-- ---------------------------------------------------------------------
create or replace function public.wf_morning_zone(p_zone uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  return jsonb_build_object('date', v_date, 'today', private.wf_today(), 'now', now(), 'hubs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id, 'name', h.name, 'zone_id', h.zone_id, 'zone_name', z.name,
      'staff', (select count(*) from private.wf_morning_people(h.id)),
      'due', private.wf_morning_due(h.zone_id, v_date),
      'state', case when s.id is not null then 'submitted' when o.id is not null then 'open' else 'none' end,
      'held', exists (select 1 from public.wf_auto_holds k where k.kind = 'morning' and k.hub_id = h.id and k.work_date = v_date and k.resolved_at is null),
      'hold', (select jsonb_build_object('reason', k.reason, 'gap_count', k.gap_count, 'total', k.total, 'gaps', k.gaps) from public.wf_auto_holds k
                where k.kind = 'morning' and k.hub_id = h.id and k.work_date = v_date and k.resolved_at is null),
      'sub_id', s.id, 'revision', coalesce(s.revision, o.revision), 'mode', s.submit_mode, 'submitted_at', s.submitted_at,
      'returned', (select jsonb_build_object('reason', b.return_reason, 'at', b.returned_at) from public.wf_morning_subs b
                    where b.hub_id = h.id and b.work_date = v_date and b.status = 'returned' and s.id is null order by b.revision desc limit 1),
      'present', (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'present'),
      'absent',  (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'absent'),
      'leave',   (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'leave'),
      'unknown', (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'unknown'),
      'people', case when s.id is not null then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name, 'code', e.employee_code, 'state', l.state, 'leave_ref', l.leave_ref) order by e.full_name)
                          from public.wf_morning_lines l join public.employees e on e.id = l.employee_id where l.sub_id = s.id), '[]'::jsonb) end,
      -- a route is "to cover" when it has no rider who is here (a route nobody rides counts too)
      'cover', case when s.id is not null then coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name,
                    'regular', coalesce((select jsonb_agg(e.full_name order by e.full_name) from public.rider_routes rr join public.employees e on e.id = rr.employee_id
                                          where rr.route_id = r.id and rr.effective_from <= v_date and (rr.effective_to is null or rr.effective_to >= v_date)), '[]'::jsonb)) order by r.code)
                  from public.hub_routes r where r.hub_id = h.id and r.archived_at is null and r.status = 'active'
                   and not exists (select 1 from public.rider_routes rr join public.wf_morning_lines l on l.employee_id = rr.employee_id and l.sub_id = s.id
                                    where rr.route_id = r.id and rr.effective_from <= v_date and (rr.effective_to is null or rr.effective_to >= v_date) and l.state = 'present')), '[]'::jsonb) end,
      'plan', (select jsonb_build_object('id', p.id, 'status', p.status, 'published_version', p.published_version) from public.route_day_plans p
                where p.hub_id = h.id and p.plan_date = v_date and p.archived_at is null)
    ) order by z.name, h.name)
    from public.hubs h join public.zones z on z.id = h.zone_id
    left join public.wf_morning_subs s on s.hub_id = h.id and s.work_date = v_date and s.status = 'submitted'
    left join public.wf_morning_subs o on o.hub_id = h.id and o.work_date = v_date and o.status = 'open'
    where h.archived_at is null and h.status = 'active' and (p_zone is null or h.zone_id = p_zone)
      and private.has_permission('ops.route_plan.approve', h.zone_id, h.id)), '[]'::jsonb));
end $$;

-- Send a submitted morning input back to the hub manager, with the reason. The next revision opens with the same lines.
create or replace function public.wf_morning_return(p_hub uuid, p_date date, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_sub public.wf_morning_subs; v_new uuid; v_reason text := trim(coalesce(p_reason, '')); m uuid; p record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route_plan.approve', v_zone, p_hub) then raise exception 'Not authorised to send the morning input back.' using errcode = '42501'; end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'Write why the morning input goes back.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || p_hub::text || v_date::text, 0));
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'submitted' for update;
  if v_sub.id is null then raise exception 'There is no submitted morning input to send back.' using errcode = '22023'; end if;
  update public.wf_morning_subs set status = 'returned', returned_by = auth.uid(), returned_at = now(), return_reason = v_reason where id = v_sub.id;
  insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status) values (p_hub, v_zone, v_date, v_sub.revision + 1, 'open') returning id into v_new;
  insert into public.wf_morning_lines (sub_id, employee_id, state, leave_ref)
    select v_new, l.employee_id, l.state, l.leave_ref from public.wf_morning_lines l where l.sub_id = v_sub.id;
  -- plans that are not approved yet must be checked again (the approved version stays in force until a new one is published)
  for p in select pl.id from public.route_day_plans pl where pl.hub_id = p_hub and pl.plan_date = v_date and pl.archived_at is null loop
    insert into public.route_plan_events (plan_id, hub_id, plan_date, kind, note, actor, actor_name)
    values (p.id, p_hub, v_date, 'morning_returned', v_reason, auth.uid(), (select coalesce(pr.full_name, 'user') from public.profiles pr where pr.id = auth.uid()));
  end loop;
  for m in select * from private.wf_role_hub_managers(p_hub) loop
    perform private.notify(m, 'সকালের জনবল ফেরত এসেছে', v_reason, '/app/attendance?view=hub&tab=morning&hub=' || p_hub::text, 'wf_morning');
  end loop;
  return v_sub.revision + 1;
end $$;

-- ---------------------------------------------------------------------
-- 7. Times: read and save (zone scope)
-- ---------------------------------------------------------------------
create or replace function public.wf_att_policy_get(p_zone uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not (private.has_permission('hr.attendance.configure', p_zone, null) or private.has_permission('hr.attendance.view', p_zone, null)
          or private.has_permission_within_zone('hr.attendance.view', p_zone)) then
    raise exception 'Not authorised to see the times of this zone.' using errcode = '42501';
  end if;
  return jsonb_build_object('zone_id', p_zone,
    'morning_cutoff', to_char(coalesce(p.morning_cutoff, nullif(private.wf_setting_text('workforce.morning_cutoff', '08:00'), '')::time, time '08:00'), 'HH24:MI'),
    'morning_extra', coalesce(p.morning_extra, private.wf_int('workforce.morning_extra_min', 15, 0, 360)),
    'day_time', to_char(coalesce(p.day_time, nullif(private.wf_setting_text('workforce.day_close_time', '00:00'), '')::time, time '00:00'), 'HH24:MI'),
    'day_extra', coalesce(p.day_extra, private.wf_int('workforce.day_close_extra_min', 0, 0, 360)),
    'own', p.zone_id is not null, 'today_due', private.wf_morning_due(p_zone, private.wf_today()),
    'can_edit', private.has_permission('hr.attendance.configure', p_zone, null))
  from (select 1) one left join public.wf_att_policy p on p.zone_id = p_zone;
end $$;

create or replace function public.wf_att_policy_save(p_zone uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.wf_att_policy; v_cut time; v_extra integer; v_day time; v_dextra integer; k text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.zones where id = p_zone and archived_at is null) then raise exception 'Zone not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', p_zone, null) then raise exception 'Not authorised to set the times of this zone.' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The times must be an object.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('morning_cutoff', 'morning_extra', 'day_time', 'day_extra') then raise exception 'Unknown time setting: %.', k using errcode = '22023'; end if;
  end loop;
  select * into v from public.wf_att_policy where zone_id = p_zone;
  begin
    v_cut := coalesce(nullif(p ->> 'morning_cutoff', '')::time, v.morning_cutoff, time '08:00');
    v_day := coalesce(nullif(p ->> 'day_time', '')::time, v.day_time, time '00:00');
    v_extra := coalesce(nullif(p ->> 'morning_extra', '')::integer, v.morning_extra, 15);
    v_dextra := coalesce(nullif(p ->> 'day_extra', '')::integer, v.day_extra, 0);
  exception when others then raise exception 'A time or a number of minutes is written wrongly.' using errcode = '22023'; end;
  if v_extra not between 0 and 360 or v_dextra not between 0 and 360 then raise exception 'The extra minutes are 0 to 360.' using errcode = '22023'; end if;
  if v_cut + make_interval(mins => v_extra) > time '23:59:59' or v_cut + make_interval(mins => v_extra) < v_cut then
    raise exception 'The morning cut-off and its extra minutes must end on the same day.' using errcode = '22023';
  end if;
  insert into public.wf_att_policy (zone_id, morning_cutoff, morning_extra, day_time, day_extra) values (p_zone, v_cut, v_extra, v_day, v_dextra)
  on conflict (zone_id) do update set morning_cutoff = excluded.morning_cutoff, morning_extra = excluded.morning_extra,
    day_time = excluded.day_time, day_extra = excluded.day_extra;
  return public.wf_att_policy_get(p_zone);
end $$;

-- ---------------------------------------------------------------------
-- 8. The job: every minute, close the morning inputs whose time has passed (only the first revision; a sent-back form is closed by hand)
-- ---------------------------------------------------------------------
create or replace function private.wf_morning_autosubmit() returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; d date; v_id uuid; v_n integer := 0; v_left integer; m uuid; v_need integer; v_done integer; v_names jsonb;
begin
  for h in select hb.id, hb.zone_id from public.hubs hb where hb.archived_at is null and hb.status = 'active'
            and exists (select 1 from private.wf_morning_people(hb.id)) loop
    for d in select g::date from generate_series(private.wf_today() - 2, private.wf_today(), interval '1 day') g loop
      continue when d < private.wf_auto_from();                                  -- before the start date: never
      continue when now() < private.wf_morning_due(h.zone_id, d);
      continue when exists (select 1 from public.wf_morning_subs s where s.hub_id = h.id and s.work_date = d and (s.revision > 1 or s.status <> 'open'));
      -- an empty or unfinished morning input is not submitted: every person who is not on approved leave must be marked came or did not come
      perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || h.id::text || d::text, 0));
      select count(*), count(*) filter (where t.st in ('present', 'absent')),
             coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'why', 'অবস্থা বসানো হয়নি') order by t.name) filter (where t.st not in ('present', 'absent')), '[]'::jsonb)
        into v_need, v_done, v_names
        from (select q.name, coalesce((select l.state from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id
                                         where s.hub_id = h.id and s.work_date = d and s.status = 'open' and l.employee_id = q.id), 'unknown') as st
                from private.wf_morning_people(h.id) q where private.wf_leave_on(q.id, d) is null) t;
      if v_need > v_done then
        perform private.wf_hold_set('morning', h.id, d, case when v_done = 0 then 'empty' else 'incomplete' end, v_need, v_need - v_done, v_names);
        continue;
      end if;
      v_id := private.wf_morning_close(h.id, d, null, 'auto', null);
      if v_id is not null then
        v_n := v_n + 1;
        select count(*) into v_left from public.wf_morning_lines where sub_id = v_id and state = 'unknown';
        for m in select * from private.wf_role_hub_managers(h.id) loop
          perform private.notify(m, 'সকালের জনবল নিজে জমা হয়েছে',
            case when v_left > 0 then v_left || ' জনের হাজিরা যাচাই বাকি আছে' else 'সবার অবস্থা বসানো ছিল' end, '/app/attendance?view=hub&tab=morning&hub=' || h.id::text, 'wf_morning');
        end loop;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin perform cron.unschedule('wf-morning-autosubmit'); exception when others then null; end;
    perform cron.schedule('wf-morning-autosubmit', '* * * * *', $c$select private.wf_morning_autosubmit()$c$);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. Route plan: who is here comes from the latest submitted morning input
-- ---------------------------------------------------------------------
create or replace function private.route_presence(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('state', case when a.status in ('present', 'late', 'half_day') then 'present' when a.status = 'absent' then 'absent' else 'off' end, 'source', 'attendance')
       from public.attendance_records a where a.employee_id = p_employee and a.work_date = p_date),
    (select jsonb_build_object('state', case l.state when 'present' then 'present' when 'absent' then 'absent' else 'off' end, 'source', 'morning', 'revision', s.revision)
       from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id
      where l.employee_id = p_employee and s.work_date = p_date and s.status = 'submitted' and l.state <> 'unknown'),
    (select jsonb_build_object('state', case when coalesce(m.decided_as, m.kind) = 'absent' then 'absent' else 'present' end, 'source', 'self')
       from public.attendance_self_marks m where m.employee_id = p_employee and m.work_date = p_date and m.status <> 'rejected'),
    (select jsonb_build_object('state', case s.attendance when 'present' then 'present' when 'absent' then 'absent' else 'off' end, 'source', 'hub_ops')
       from public.hub_ops_staff s where s.employee_id = p_employee and s.report_date = p_date and s.removed_at is null and s.attendance is not null
      order by s.updated_at desc limit 1),
    (select jsonb_build_object('state', 'off', 'source', 'application')
       from public.wf_absence_applications w where w.employee_id = p_employee and w.status in ('pending', 'approved') and p_date = any(w.dates) limit 1),
    jsonb_build_object('state', null, 'source', null))
$$;

-- The morning input as the plan page needs it: is there one, and is the plan still based on the latest.
create or replace function public.route_plan_morning(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, private.wf_today()); v_zone uuid; v_sub public.wf_morning_subs; v_plan public.route_day_plans; v_ver public.route_plan_versions;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route_plan.view', v_zone, p_hub) then raise exception 'Not authorised to see the parcel plan of this hub.' using errcode = '42501'; end if;
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'submitted';
  select * into v_plan from public.route_day_plans where hub_id = p_hub and plan_date = v_date and archived_at is null;
  select * into v_ver from public.route_plan_versions where plan_id = v_plan.id and superseded_at is null order by version_no desc limit 1;
  return jsonb_build_object('date', v_date, 'required', v_date = private.wf_today(),
    'morning', case when v_sub.id is not null then jsonb_build_object('id', v_sub.id, 'revision', v_sub.revision, 'mode', v_sub.submit_mode, 'submitted_at', v_sub.submitted_at,
        'present', (select count(*) from public.wf_morning_lines l where l.sub_id = v_sub.id and l.state = 'present'),
        'absent', (select count(*) from public.wf_morning_lines l where l.sub_id = v_sub.id and l.state = 'absent'),
        'leave', (select count(*) from public.wf_morning_lines l where l.sub_id = v_sub.id and l.state = 'leave'),
        'unknown', (select count(*) from public.wf_morning_lines l where l.sub_id = v_sub.id and l.state = 'unknown')) end,
    'waiting', v_sub.id is null,
    'returned', v_sub.id is null and exists (select 1 from public.wf_morning_subs b where b.hub_id = p_hub and b.work_date = v_date and b.status = 'returned'),
    -- a plan that is not approved was made on an older input; an approved one stays in force but is marked
    'plan_stale', v_plan.id is not null and v_plan.status <> 'approved' and v_plan.morning_sub_id is distinct from v_sub.id,
    'published_stale', v_ver.id is not null and v_ver.morning_sub_id is distinct from v_sub.id);
end $$;

-- ---------------------------------------------------------------------
-- 10. Approval = publication (one transaction): check again, save the numbered version, recipients and messages
-- ---------------------------------------------------------------------
create or replace function private.route_plan_notify(p_version uuid, p_kind text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v public.route_plan_versions; r record; v_n integer := 0; v_hub text; v_title text; v_body text;
begin
  select * into v from public.route_plan_versions where id = p_version;
  select h.name into v_hub from public.hubs h where h.id = v.hub_id;
  for r in select * from public.route_plan_recipients where version_id = p_version and status = 'active' loop
    v_title := case r.role when 'manager' then 'আজকের রুট প্ল্যান' else 'আপনার আজকের রুট' end;
    v_body := v_hub || ' · ' || to_char(v.plan_date, 'DD Mon') || ' · সংস্করণ ' || v.version_no || case when p_kind = 'resent' then ' (আবার পাঠানো)' else '' end;
    perform private.notify(r.profile_id, v_title, v_body, case r.role when 'manager' then '/app/attendance?view=hub&tab=plan&hub=' || v.hub_id::text else '/app/staff' end, 'route_plan');
    update public.route_plan_recipients set sent_count = sent_count + 1, first_sent_at = coalesce(first_sent_at, now()), last_sent_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.route_plan_decide(p_plan uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans; v_name text; v_sub public.wf_morning_subs; l record; v_state text; v_ver uuid; v_no integer; v_prev public.route_plan_versions;
  m uuid; v_emp public.employees;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.route_day_plans where id = p_plan and archived_at is null for update;
  if v.id is null or not private.has_permission('ops.route_plan.approve', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to decide this plan.' using errcode = '42501';
  end if;
  if v.status = 'approved' then raise exception 'This plan is already approved.' using errcode = '22023'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'The note is too long (500 letters at most).' using errcode = '22023'; end if;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  if p_ok then
    if not exists (select 1 from public.route_day_riders x where x.plan_id = v.id and x.removed_at is null and (x.parcels > 0 or x.pickups > 0)) then
      raise exception 'Nobody has parcels on this plan yet.' using errcode = '22023';
    end if;
    -- today's plan stands on today's latest submitted morning input, and each person on it must still be available
    select * into v_sub from public.wf_morning_subs where hub_id = v.hub_id and work_date = v.plan_date and status = 'submitted';
    if v.plan_date = private.wf_today() then
      if v_sub.id is null then raise exception 'The morning input of this hub is not submitted yet.' using errcode = '22023'; end if;
      for l in select x.employee_id, e.full_name from public.route_day_riders x join public.employees e on e.id = x.employee_id
                where x.plan_id = v.id and x.removed_at is null and (x.parcels > 0 or x.pickups > 0) loop
        v_state := private.route_presence(l.employee_id, v.plan_date) ->> 'state';
        if private.wf_leave_on(l.employee_id, v.plan_date) is not null or v_state is distinct from 'present' then
          raise exception '% is not available today. Change the rider and approve again.', l.full_name using errcode = '22023';
        end if;
      end loop;
    end if;
    update public.route_day_plans set status = 'approved', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = nullif(trim(p_note), ''), morning_sub_id = v_sub.id, morning_revision = v_sub.revision, published_version = published_version + 1
     where id = v.id returning published_version into v_no;
    select * into v_prev from public.route_plan_versions where plan_id = v.id and superseded_at is null order by version_no desc limit 1;
    insert into public.route_plan_versions (plan_id, hub_id, zone_id, plan_date, version_no, morning_sub_id, morning_revision, snapshot, published_by, published_by_name)
      select v.id, v.hub_id, v.zone_id, v.plan_date, v_no, v_sub.id, v_sub.revision, private.route_plan_json(v.id), auth.uid(), v_name returning id into v_ver;
    update public.route_plan_versions set superseded_at = now() where plan_id = v.id and id <> v_ver and superseded_at is null;
    -- recipients: the hub's managers and everybody who has parcels or pickups
    for m in select * from private.wf_role_hub_managers(v.hub_id) loop
      insert into public.route_plan_recipients (version_id, plan_id, hub_id, plan_date, role, profile_id) values (v_ver, v.id, v.hub_id, v.plan_date, 'manager', m);
    end loop;
    for l in select x.* from public.route_day_riders x where x.plan_id = v.id and x.removed_at is null and (x.parcels > 0 or x.pickups > 0) loop
      select * into v_emp from public.employees e where e.id = l.employee_id;
      insert into public.route_plan_recipients (version_id, plan_id, hub_id, plan_date, role, profile_id, employee_id, parcels, pickups, detail, note)
      values (v_ver, v.id, v.hub_id, v.plan_date, case when l.kind = 'helper' then 'helper' else 'rider' end, v_emp.profile_id, l.employee_id, l.parcels, l.pickups, l.detail, l.note);
    end loop;
    -- a person of the old version who has nothing now: the old assignment is cancelled and the person is told
    if v_prev.id is not null then
      for l in select r.id, r.profile_id, r.employee_id from public.route_plan_recipients r
                where r.version_id = v_prev.id and r.role <> 'manager' and r.status = 'active'
                  and not exists (select 1 from public.route_plan_recipients n where n.version_id = v_ver and n.employee_id = r.employee_id) loop
        update public.route_plan_recipients set status = 'cancelled', cancelled_at = now(), cancelled_in_version = v_no where id = l.id;
        perform private.notify(l.profile_id, 'রুট বরাদ্দ বাতিল', 'আজকের রুট প্ল্যান বদলেছে। এই বরাদ্দ আর কার্যকর নয়।', '/app/staff', 'route_plan');
        insert into public.route_plan_events (plan_id, hub_id, plan_date, version_no, kind, note, actor, actor_name)
        values (v.id, v.hub_id, v.plan_date, v_no, 'cancelled', (select e.full_name from public.employees e where e.id = l.employee_id), auth.uid(), v_name);
      end loop;
      update public.route_plan_recipients set status = 'cancelled', cancelled_at = now(), cancelled_in_version = v_no
       where version_id = v_prev.id and role = 'manager' and status = 'active';
    end if;
    insert into public.route_plan_events (plan_id, hub_id, plan_date, version_no, kind, actor, actor_name) values (v.id, v.hub_id, v.plan_date, v_no, 'published', auth.uid(), v_name);
    perform private.route_plan_notify(v_ver, 'published');
  else
    if v.status <> 'sent' then raise exception 'Only a sent plan can be sent back.' using errcode = '22023'; end if;
    if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Write why the plan goes back.' using errcode = '22023'; end if;
    update public.route_day_plans set status = 'draft', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = trim(p_note) where id = v.id;
  end if;
end $$;

-- The same approved version again (nothing new is published).
create or replace function public.route_plan_resend(p_plan uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans; v_ver public.route_plan_versions; v_n integer; v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.route_day_plans where id = p_plan and archived_at is null;
  if v.id is null or not private.has_permission('ops.route_plan.approve', v.zone_id, v.hub_id) then raise exception 'Not authorised to send this plan.' using errcode = '42501'; end if;
  select * into v_ver from public.route_plan_versions where plan_id = v.id and superseded_at is null order by version_no desc limit 1;
  if v_ver.id is null then raise exception 'No approved version of this plan has been published.' using errcode = '22023'; end if;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  v_n := private.route_plan_notify(v_ver.id, 'resent');
  insert into public.route_plan_events (plan_id, hub_id, plan_date, version_no, kind, actor, actor_name) values (v.id, v.hub_id, v.plan_date, v_ver.version_no, 'resent', auth.uid(), v_name);
  return v_n;
end $$;

-- The plan the hub manager and the riders were sent: the latest published version of a day, its recipients and its history.
create or replace function public.route_plan_published(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, private.wf_today()); v_zone uuid; v_plan public.route_day_plans; v_ver public.route_plan_versions;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route_plan.view', v_zone, p_hub) then raise exception 'Not authorised to see the parcel plan of this hub.' using errcode = '42501'; end if;
  select * into v_plan from public.route_day_plans where hub_id = p_hub and plan_date = v_date and archived_at is null;
  select * into v_ver from public.route_plan_versions where plan_id = v_plan.id and superseded_at is null order by version_no desc limit 1;
  if v_ver.id is null then return jsonb_build_object('date', v_date, 'version', null); end if;
  return jsonb_build_object('date', v_date, 'plan_id', v_plan.id,
    'version', jsonb_build_object('no', v_ver.version_no, 'published_at', v_ver.published_at, 'by', v_ver.published_by_name, 'morning_revision', v_ver.morning_revision),
    'reopened', v_plan.status <> 'approved',   -- being changed; this version stays in force
    'lines', coalesce((select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'name', e.full_name, 'role', r.role, 'parcels', r.parcels, 'pickups', r.pickups,
              'routes', coalesce((select jsonb_agg(coalesce(hr.code || ' · ' || hr.name, '—')) from jsonb_array_elements(r.detail) d
                                   left join public.hub_routes hr on hr.id = nullif(d ->> 'route_id', '')::uuid), '[]'::jsonb),
              'sent_count', r.sent_count, 'last_sent_at', r.last_sent_at) order by e.full_name)
            from public.route_plan_recipients r join public.employees e on e.id = r.employee_id
           where r.version_id = v_ver.id and r.role <> 'manager' and r.status = 'active'), '[]'::jsonb),
    'cancelled', coalesce((select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'name', e.full_name, 'cancelled_at', r.cancelled_at, 'in_version', r.cancelled_in_version) order by r.cancelled_at)
            from public.route_plan_recipients r join public.employees e on e.id = r.employee_id
           where r.plan_id = v_plan.id and r.role <> 'manager' and r.status = 'cancelled'
             and not exists (select 1 from public.route_plan_recipients a where a.version_id = v_ver.id and a.employee_id = r.employee_id and a.status = 'active')), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('kind', ev.kind, 'version', ev.version_no, 'note', ev.note, 'by', ev.actor_name, 'at', ev.created_at) order by ev.created_at desc)
            from public.route_plan_events ev where ev.plan_id = v_plan.id), '[]'::jsonb));
end $$;

-- My own parcels of today: from the published version, so a plan that is being changed still shows the version in force.
-- A person whose assignment was cancelled today and who has no other one gets the cancellation (no parcels).
create or replace function public.route_plan_mine() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id(); v_cancel jsonb; v_mine jsonb;
begin
  if v_emp is null then return null; end if;
  v_mine := (select jsonb_build_object('date', r.plan_date, 'hub', h.name, 'parcels', r.parcels, 'pickups', r.pickups, 'kind', r.role, 'note', r.note,
      'version', v.version_no, 'published_at', v.published_at,
      'detail', coalesce((select jsonb_agg(jsonb_build_object('parcels', (d ->> 'parcels')::integer,
                   'route', (select hr.code || ' · ' || hr.name from public.hub_routes hr where hr.id = nullif(d ->> 'route_id', '')::uuid),
                   'for', (select e.full_name from public.employees e where e.id = nullif(d ->> 'for', '')::uuid)))
                 from jsonb_array_elements(r.detail) d), '[]'::jsonb),
      'cancelled', '[]'::jsonb)
    from public.route_plan_recipients r join public.route_plan_versions v on v.id = r.version_id
    join public.route_day_plans p on p.id = r.plan_id join public.hubs h on h.id = r.hub_id
   where r.employee_id = v_emp and r.status = 'active' and r.plan_date = private.wf_today() and p.archived_at is null
     and (r.parcels > 0 or r.pickups > 0)
     and (private.route_plan_rules(p.zone_id) ->> 'show_rider')::boolean
     and private.has_permission('ops.route_plan_own.view', p.zone_id, p.hub_id)
   order by v.version_no desc limit 1);
  if v_mine is not null then return v_mine; end if;
  select jsonb_agg(jsonb_build_object('version', c.cancelled_in_version, 'at', c.cancelled_at, 'hub', h.name) order by c.cancelled_at) into v_cancel
    from public.route_plan_recipients c join public.hubs h on h.id = c.hub_id
   where c.employee_id = v_emp and c.plan_date = private.wf_today() and c.status = 'cancelled' and c.role <> 'manager';
  if v_cancel is null then return null; end if;
  return jsonb_build_object('date', private.wf_today(), 'hub', null, 'parcels', 0, 'pickups', 0, 'kind', 'rider', 'note', null, 'version', null,
    'published_at', null, 'detail', '[]'::jsonb, 'cancelled', v_cancel);
end $$;

-- Plans approved before this migration have no published version yet. Give each of yesterday's, today's and the coming days' ones a
-- silent version one (no messages are sent), so the riders keep seeing their parcels (route_plan_mine reads the recipients).
create or replace function private.route_plan_backfill() returns integer
language plpgsql security definer set search_path = '' as $$
declare p public.route_day_plans; v_ver uuid; l record; v_n integer := 0;
begin
  for p in select * from public.route_day_plans x where x.status = 'approved' and x.archived_at is null and x.published_version = 0 and x.plan_date >= private.wf_today() - 1 loop
    update public.route_day_plans set published_version = 1 where id = p.id;
    insert into public.route_plan_versions (plan_id, hub_id, zone_id, plan_date, version_no, snapshot, published_by, published_by_name, published_at)
      values (p.id, p.hub_id, p.zone_id, p.plan_date, 1, private.route_plan_json(p.id), p.decided_by, p.decided_by_name, coalesce(p.decided_at, now())) returning id into v_ver;
    for l in select x.*, e.profile_id from public.route_day_riders x join public.employees e on e.id = x.employee_id
              where x.plan_id = p.id and x.removed_at is null and (x.parcels > 0 or x.pickups > 0) loop
      insert into public.route_plan_recipients (version_id, plan_id, hub_id, plan_date, role, profile_id, employee_id, parcels, pickups, detail, note)
      values (v_ver, p.id, p.hub_id, p.plan_date, case when l.kind = 'helper' then 'helper' else 'rider' end, l.profile_id, l.employee_id, l.parcels, l.pickups, l.detail, l.note);
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
select private.route_plan_backfill();

-- ---------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------
revoke all on function public.wf_morning_get(uuid, date), public.wf_morning_save(uuid, date, jsonb), public.wf_morning_submit(uuid, date, jsonb),
  public.wf_morning_zone(uuid, date), public.wf_morning_return(uuid, date, text), public.wf_att_policy_get(uuid), public.wf_att_policy_save(uuid, jsonb),
  public.route_plan_morning(uuid, date), public.route_plan_decide(uuid, boolean, text), public.route_plan_resend(uuid),
  public.route_plan_published(uuid, date), public.route_plan_mine() from public, anon;
grant execute on function public.wf_morning_get(uuid, date), public.wf_morning_save(uuid, date, jsonb), public.wf_morning_submit(uuid, date, jsonb),
  public.wf_morning_zone(uuid, date), public.wf_morning_return(uuid, date, text), public.wf_att_policy_get(uuid), public.wf_att_policy_save(uuid, jsonb),
  public.route_plan_morning(uuid, date), public.route_plan_decide(uuid, boolean, text), public.route_plan_resend(uuid),
  public.route_plan_published(uuid, date), public.route_plan_mine() to authenticated;
revoke all on function private.wf_morning_close(uuid, date, jsonb, text, uuid), private.wf_morning_autosubmit(), private.route_plan_notify(uuid, text), private.route_plan_backfill(), private.wf_auto_from(), private.wf_hold_set(text, uuid, date, text, integer, integer, jsonb), private.wf_hold_resolve(text, uuid, date),
  private.wf_leave_on(uuid, date), private.wf_morning_people(uuid), private.wf_role_hub_managers(uuid), private.wf_role_zone_managers(uuid),
  private.wf_morning_due(uuid, date), private.wf_setting_text(text, text), private.wf_morning_date(date) from public, anon, authenticated;
