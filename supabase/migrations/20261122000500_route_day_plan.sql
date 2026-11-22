-- =====================================================================
--  রুট: আজকের পার্সেল পরিকল্পনা (the day's parcel plan of a hub: who is here, who takes how many parcels on which route)
--
--  Owner (22 Nov): the hub's numbers of the day (arrived, sent, pickup, cancelled) and what each rider got, typed by
--  hand (a PDF / API may fill them later), a fixed number per rider, one or many routes per rider, and when a rider is
--  absent the neighbouring rider and other hub staff are suggested. The zonal manager sets it up and decides the plan;
--  the Super Admin gives view / add / edit / remove / approve / set-up to any role.
--
--  It sits on what is already there and copies none of it:
--    * routes, stops and a rider's routes  -> hub_routes, hub_route_stops, rider_routes
--    * what one rider delivers a day (hub) -> route_hub_load.rider_parcels, a route's average -> hub_routes.avg_parcels
--    * who is here                         -> attendance_records, attendance_self_marks, hub_ops_staff, wf_absence_applications
--    * what a rider really delivered       -> da_rider_lines (sent / approved sheets) and wf_daily_ops (the rider's own report)
--    * the hub's own daily figures         -> hub_ops_reports, hub_daily_metrics (shown as hints, never written here)
--  New here, because it existed nowhere:
--    * route_day_plans   one plan per hub per date: the morning numbers, parcels per route, draft -> sent -> approved
--    * route_day_riders  one line per person of a plan: here or not, capacity used, parcels and pickups given
--    * route_staff_load  per person: a fixed number of parcels a day, "can help with delivery" (other hub staff), does pickups
--    * route_hub_load    + who does the pickups at this hub, and what one pickup costs in deliveries
--    * route_zone_settings + the plan rules of the zone (days of history, overload limit, how near a neighbour route is …)
--  The suggestion is worked out on the page from these numbers; nothing is changed by itself.
--  Additive only: nothing dropped, no existing function replaced.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description) values
  ('ops.route_plan.view',      'ops', 'route_plan',     'view',      'See the day''s parcel plan of a hub: numbers, who is here, who takes how many'),
  ('ops.route_plan.create',    'ops', 'route_plan',     'create',    'Start the day''s parcel plan of a hub and type its numbers'),
  ('ops.route_plan.edit',      'ops', 'route_plan',     'edit',      'Change a day''s parcel plan that is not approved yet'),
  ('ops.route_plan.archive',   'ops', 'route_plan',     'archive',   'Remove a day''s parcel plan (kept in history, reason needed)'),
  ('ops.route_plan.approve',   'ops', 'route_plan',     'approve',   'Approve, send back or reopen a day''s parcel plan'),
  ('ops.route_plan.configure', 'ops', 'route_plan',     'configure', 'Set up the plan: fixed parcels per rider, helpers, who does pickups, the zone plan rules'),
  ('ops.route_plan_own.view',  'ops', 'route_plan_own', 'view',      'See my own parcels of today''s approved plan (rider / staff)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code like 'ops.route\_plan%'
 where r.code in ('admin', 'zonal_manager')
    or (r.code = 'hub_manager' and p.code in ('ops.route_plan.view', 'ops.route_plan.create', 'ops.route_plan.edit', 'ops.route_plan_own.view'))
    or (r.code = 'rider' and p.code = 'ops.route_plan_own.view')
on conflict do nothing;
-- (Whoever makes a rider's login must hold every permission of the rider role, so the managers get "own parcels" too.)

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
alter table public.route_zone_settings
  add column if not exists plan_avg_days   integer not null default 14 check (plan_avg_days between 3 and 90),
  add column if not exists plan_min_days   integer not null default 3 check (plan_min_days between 1 and 30),
  add column if not exists plan_over_pct   integer not null default 110 check (plan_over_pct between 100 and 200),
  add column if not exists plan_near_km    numeric(5,1) not null default 3 check (plan_near_km between 0.5 and 50),
  add column if not exists plan_helper_max integer not null default 20 check (plan_helper_max between 1 and 500),
  add column if not exists plan_show_rider boolean not null default true;

alter table public.route_hub_load
  add column if not exists pickup_mode   text not null default 'mixed' check (pickup_mode in ('same', 'separate', 'mixed')),
  add column if not exists pickup_weight numeric(4,2) not null default 1 check (pickup_weight between 0 and 5);

create table if not exists public.route_staff_load (
  employee_id uuid primary key references public.employees(id),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  day_parcels integer check (day_parcels is null or day_parcels between 1 and 1000),   -- fixed parcels a day (null = learn from the past)
  helper      boolean not null default false,                                           -- not a rider, but may deliver when riders are short
  helper_max  integer check (helper_max is null or helper_max between 1 and 500),       -- the most a helper takes (null = the zone rule)
  pickup      boolean not null default false,                                           -- does pickups too (used when the hub is "mixed")
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists route_staff_load_hub on public.route_staff_load (hub_id);
create index if not exists route_staff_load_zone on public.route_staff_load (zone_id);

create table if not exists public.route_day_plans (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  plan_date     date not null,
  arrived       integer check (arrived is null or arrived between 0 and 100000),       -- parcels that reached the hub today (null = not typed)
  carried       integer check (carried is null or carried between 0 and 100000),       -- left from earlier days
  sent          integer check (sent is null or sent between 0 and 100000),             -- sent on to another hub / back
  cancelled     integer check (cancelled is null or cancelled between 0 and 100000),
  pickups       integer check (pickups is null or pickups between 0 and 100000),       -- pickups to do today
  source        jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),           -- per number: manual | pdf | api
  route_parcels jsonb not null default '{}'::jsonb check (jsonb_typeof(route_parcels) = 'object'),    -- {route id: parcels today}
  unassigned    integer not null default 0 check (unassigned between 0 and 100000),    -- parcels nobody could take
  note          text check (note is null or length(note) <= 500),
  status        text not null default 'draft' check (status in ('draft', 'sent', 'approved')),
  version       integer not null default 1 check (version >= 1),
  sent_by uuid, sent_by_name text, sent_at timestamptz,
  decided_by uuid, decided_by_name text, decided_at timestamptz, decide_note text check (decide_note is null or length(decide_note) <= 500),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint route_day_plans_approved check (status <> 'approved' or decided_at is not null)
);
create unique index if not exists route_day_plans_one_live on public.route_day_plans (hub_id, plan_date) where archived_at is null;
create index if not exists route_day_plans_zone_day on public.route_day_plans (zone_id, plan_date);

create table if not exists public.route_day_riders (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.route_day_plans(id),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  plan_date   date not null,
  employee_id uuid not null references public.employees(id),
  kind        text not null default 'rider' check (kind in ('rider', 'helper')),
  present     boolean,                                                                 -- typed on the plan (null = as the attendance says)
  capacity    integer check (capacity is null or capacity between 0 and 5000),         -- what the plan counted on for this person
  parcels     integer not null default 0 check (parcels between 0 and 5000),           -- parcels given today
  pickups     integer not null default 0 check (pickups between 0 and 5000),
  detail      jsonb not null default '[]'::jsonb check (jsonb_typeof(detail) = 'array'),   -- [{route_id, parcels, for?: absent rider}]
  note        text check (note is null or length(note) <= 300),
  removed_at  timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (plan_id, employee_id)
);
create index if not exists route_day_riders_emp_day on public.route_day_riders (employee_id, plan_date);
create index if not exists route_day_riders_hub on public.route_day_riders (hub_id);
create index if not exists route_day_riders_zone on public.route_day_riders (zone_id);

do $$
declare t text;
begin
  foreach t in array array['route_staff_load', 'route_day_plans', 'route_day_riders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'ops');
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Reading: the table rules. Writing: only through the functions below.
drop policy if exists rsl_read on public.route_staff_load;
create policy rsl_read on public.route_staff_load for select to authenticated
  using (private.has_permission('ops.route_plan.view', zone_id, hub_id));
drop policy if exists rdp_read on public.route_day_plans;
create policy rdp_read on public.route_day_plans for select to authenticated
  using (private.has_permission('ops.route_plan.view', zone_id, hub_id));
drop policy if exists rdr_read on public.route_day_riders;
create policy rdr_read on public.route_day_riders for select to authenticated
  using (private.has_permission('ops.route_plan.view', zone_id, hub_id));

-- ---------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------
create or replace function private.route_plan_rules(p_zone uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'avg_days', coalesce(s.plan_avg_days, 14), 'min_days', coalesce(s.plan_min_days, 3), 'over_pct', coalesce(s.plan_over_pct, 110),
    'near_km', coalesce(s.plan_near_km, 3), 'helper_max', coalesce(s.plan_helper_max, 20), 'show_rider', coalesce(s.plan_show_rider, true))
  from (select 1) one left join public.route_zone_settings s on s.zone_id = p_zone
$$;

-- Is this person here on that date, and who says so. The strongest record wins:
-- the attendance book, then the person's own mark, then the hub operation report, then an absence application.
create or replace function private.route_presence(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('state', case when a.status in ('present', 'late', 'half_day') then 'present' when a.status = 'absent' then 'absent' else 'off' end, 'source', 'attendance')
       from public.attendance_records a where a.employee_id = p_employee and a.work_date = p_date),
    (select jsonb_build_object('state', case when coalesce(m.decided_as, m.kind) = 'absent' then 'absent' else 'present' end, 'source', 'self')
       from public.attendance_self_marks m where m.employee_id = p_employee and m.work_date = p_date and m.status <> 'rejected'),
    (select jsonb_build_object('state', case s.attendance when 'present' then 'present' when 'absent' then 'absent' else 'off' end, 'source', 'hub_ops')
       from public.hub_ops_staff s where s.employee_id = p_employee and s.report_date = p_date and s.removed_at is null and s.attendance is not null
      order by s.updated_at desc limit 1),
    (select jsonb_build_object('state', 'off', 'source', 'application')
       from public.wf_absence_applications w where w.employee_id = p_employee and w.status in ('pending', 'approved') and p_date = any(w.dates) limit 1),
    jsonb_build_object('state', null, 'source', null))
$$;

-- A whole number between two limits out of a JSON value (null stays null).
create or replace function private.route_plan_int(p jsonb, p_key text, p_max integer, p_label text) returns integer
language plpgsql immutable set search_path = '' as $$
declare v integer;
begin
  if p -> p_key is null or jsonb_typeof(p -> p_key) = 'null' or p ->> p_key = '' then return null; end if;
  begin v := (p ->> p_key)::integer;
  exception when others then raise exception '% must be a whole number.', p_label using errcode = '22023'; end;
  if v < 0 or v > p_max then raise exception '% must be between 0 and %.', p_label, p_max using errcode = '22023'; end if;
  return v;
end $$;

create or replace function private.route_plan_json(p_plan uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'hub_id', p.hub_id, 'plan_date', p.plan_date, 'arrived', p.arrived, 'carried', p.carried, 'sent', p.sent,
    'cancelled', p.cancelled, 'pickups', p.pickups, 'source', p.source, 'route_parcels', p.route_parcels, 'unassigned', p.unassigned, 'note', p.note,
    'status', p.status, 'version', p.version, 'sent_by_name', p.sent_by_name, 'sent_at', p.sent_at,
    'decided_by_name', p.decided_by_name, 'decided_at', p.decided_at, 'decide_note', p.decide_note, 'updated_at', p.updated_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('employee_id', l.employee_id, 'kind', l.kind, 'present', l.present, 'capacity', l.capacity,
                 'parcels', l.parcels, 'pickups', l.pickups, 'detail', l.detail, 'note', l.note))
               from public.route_day_riders l where l.plan_id = p.id and l.removed_at is null), '[]'::jsonb))
  from public.route_day_plans p where p.id = p_plan
$$;

-- ---------------------------------------------------------------------
-- 4. Reading
-- ---------------------------------------------------------------------
-- The hubs I may plan, each with its plan of that date in short.
create or replace function public.route_plan_hubs(p_date date default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name, 'zone_id', h.zone_id, 'zone_name', z.name,
      'plan', (select jsonb_build_object('id', p.id, 'status', p.status, 'arrived', p.arrived, 'carried', p.carried, 'sent', p.sent, 'cancelled', p.cancelled,
                        'pickups', p.pickups, 'unassigned', p.unassigned,
                        'given', (select coalesce(sum(l.parcels), 0) from public.route_day_riders l where l.plan_id = p.id and l.removed_at is null),
                        'people', (select count(*) from public.route_day_riders l where l.plan_id = p.id and l.removed_at is null and l.parcels > 0))
                 from public.route_day_plans p where p.hub_id = h.id and p.plan_date = coalesce(p_date, current_date) and p.archived_at is null)
    ) order by z.name, h.name), '[]'::jsonb)
  from public.hubs h join public.zones z on z.id = h.zone_id
  where auth.uid() is not null and h.archived_at is null and h.status = 'active'
    and private.has_permission('ops.route_plan.view', h.zone_id, h.id)
$$;

-- Everything the plan page of one hub and one date needs.
create or replace function public.route_plan_get(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, current_date); v_zone uuid; v_rules jsonb; v_from date; v_plan uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route_plan.view', v_zone, p_hub) then
    raise exception 'Not authorised to see the parcel plan of this hub.' using errcode = '42501';
  end if;
  v_rules := private.route_plan_rules(v_zone);
  v_from := v_date - (v_rules ->> 'avg_days')::integer;
  select id into v_plan from public.route_day_plans where hub_id = p_hub and plan_date = v_date and archived_at is null;
  return jsonb_build_object('date', v_date, 'today', current_date,
    'hub', (select jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name, 'zone_id', h.zone_id, 'lat', h.latitude, 'lng', h.longitude) from public.hubs h where h.id = p_hub),
    'rules', v_rules,
    'load', coalesce((select jsonb_build_object('rider_parcels', l.rider_parcels, 'pickup_mode', l.pickup_mode, 'pickup_weight', l.pickup_weight)
                        from public.route_hub_load l where l.hub_id = p_hub),
                     jsonb_build_object('rider_parcels', null, 'pickup_mode', 'mixed', 'pickup_weight', 1)),
    'can', jsonb_build_object(
      'create', private.has_permission('ops.route_plan.create', v_zone, p_hub), 'edit', private.has_permission('ops.route_plan.edit', v_zone, p_hub),
      'archive', private.has_permission('ops.route_plan.archive', v_zone, p_hub), 'approve', private.has_permission('ops.route_plan.approve', v_zone, p_hub),
      'configure', private.has_permission('ops.route_plan.configure', v_zone, p_hub), 'rules', private.has_permission('ops.route_plan.configure', v_zone, null)),
    'plan', private.route_plan_json(v_plan),
    'routes', coalesce((select jsonb_agg((private.route_json(r.id) - 'road_path') || jsonb_build_object('avg_parcels', r.avg_parcels) order by r.code)
                          from public.hub_routes r where r.hub_id = p_hub and r.archived_at is null and r.status = 'active'), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'code', e.employee_code, 'name', e.full_name, 'post', (select coalesce(ps.name_bn, ps.name) from public.positions ps where ps.id = e.position_id),
        'active', e.status = 'active' and e.archived_at is null and e.hub_id = p_hub,
        'rider', private.is_rider_post(e.position_id),
        'routes', coalesce((select jsonb_agg(x.route_id) from public.rider_routes x join public.hub_routes hr on hr.id = x.route_id
                             where x.employee_id = e.id and hr.hub_id = p_hub and hr.archived_at is null and hr.status = 'active'
                               and x.effective_from <= greatest(v_date, current_date) and (x.effective_to is null or x.effective_to >= v_date)), '[]'::jsonb),
        'fixed', sl.day_parcels, 'helper', coalesce(sl.helper, false), 'helper_max', sl.helper_max, 'pickup', coalesce(sl.pickup, false),
        'acc', (select jsonb_build_object('days', count(*), 'delivery', coalesce(sum(rl.delivery_qty), 0), 'pickup', coalesce(sum(rl.pickup_qty), 0))
                  from public.da_rider_lines rl join public.da_sessions s on s.id = rl.session_id
                 where rl.employee_id = e.id and rl.removed_at is null and s.status in ('submitted', 'approved') and s.account_date >= v_from and s.account_date < v_date),
        'self', (select jsonb_build_object('days', count(*), 'delivery', coalesce(sum(o.delivery), 0), 'returned', coalesce(sum(o.delivery_return), 0), 'pickup', coalesce(sum(o.pickup), 0))
                   from public.wf_daily_ops o where o.employee_id = e.id and o.work_date >= v_from and o.work_date < v_date),
        'presence', private.route_presence(e.id, v_date),
        'done', jsonb_build_object(
          'self', (select jsonb_build_object('delivery', o.delivery, 'returned', o.delivery_return, 'pickup', o.pickup)
                     from public.wf_daily_ops o where o.employee_id = e.id and o.work_date = v_date),
          'acc', (select jsonb_build_object('delivery', sum(rl.delivery_qty), 'pickup', sum(rl.pickup_qty))
                    from public.da_rider_lines rl join public.da_sessions s on s.id = rl.session_id
                   where rl.employee_id = e.id and rl.removed_at is null and s.account_date = v_date having count(*) > 0))
      ) order by e.full_name)
      from public.employees e left join public.route_staff_load sl on sl.employee_id = e.id
     where (e.hub_id = p_hub and e.status = 'active' and e.archived_at is null)
        or e.id in (select l.employee_id from public.route_day_riders l where l.plan_id = v_plan and l.removed_at is null)), '[]'::jsonb),
    -- what the other pages already hold for this hub and date (hints only, never written here)
    'hints', jsonb_build_object(
      'ops_parcels', (select r.total_parcels from public.hub_ops_reports r where r.hub_id = p_hub and r.report_date = v_date),
      'ops_pickups', (select r.total_pickups from public.hub_ops_reports r where r.hub_id = p_hub and r.report_date = v_date),
      'left_before', (select m.pending_parcels from public.hub_daily_metrics m where m.hub_id = p_hub and m.metric_date < v_date order by m.metric_date desc limit 1),
      'unassigned_before', (select p.unassigned from public.route_day_plans p where p.hub_id = p_hub and p.plan_date < v_date and p.archived_at is null order by p.plan_date desc limit 1),
      'metric_delivery', (select m.delivery_count from public.hub_daily_metrics m where m.hub_id = p_hub and m.metric_date = v_date),
      'metric_pickup', (select m.pickup_count from public.hub_daily_metrics m where m.hub_id = p_hub and m.metric_date = v_date)));
end $$;

-- My own parcels of today's approved plan (rider / helper).
create or replace function public.route_plan_mine() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id();
begin
  if v_emp is null then return null; end if;
  return (select jsonb_build_object('date', p.plan_date, 'hub', h.name, 'parcels', l.parcels, 'pickups', l.pickups, 'kind', l.kind, 'note', l.note,
      'detail', coalesce((select jsonb_agg(jsonb_build_object('parcels', (d ->> 'parcels')::integer,
                   'route', (select r.code || ' · ' || r.name from public.hub_routes r where r.id = nullif(d ->> 'route_id', '')::uuid),
                   'for', (select e.full_name from public.employees e where e.id = nullif(d ->> 'for', '')::uuid)))
                 from jsonb_array_elements(l.detail) d), '[]'::jsonb))
    from public.route_day_riders l join public.route_day_plans p on p.id = l.plan_id join public.hubs h on h.id = p.hub_id
   where l.employee_id = v_emp and l.removed_at is null and p.plan_date = current_date and p.archived_at is null and p.status = 'approved'
     and (l.parcels > 0 or l.pickups > 0)
     and (private.route_plan_rules(p.zone_id) ->> 'show_rider')::boolean
     and private.has_permission('ops.route_plan_own.view', p.zone_id, p.hub_id)
   limit 1);
end $$;

-- ---------------------------------------------------------------------
-- 5. Set-up: the zone's plan rules, and a hub's people (fixed number, helper, pickups)
-- ---------------------------------------------------------------------
create or replace function public.route_plan_rules_save(p_zone uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.zones where id = p_zone) then raise exception 'Unknown zone.' using errcode = '22023'; end if;
  if not private.has_permission('ops.route_plan.configure', p_zone, null) then
    raise exception 'Not authorised to change the plan rules of this zone.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The rules must be an object.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('avg_days', 'min_days', 'over_pct', 'near_km', 'helper_max', 'show_rider') then
      raise exception 'Unknown plan rule: %.', k using errcode = '22023';
    end if;
  end loop;
  begin
    insert into public.route_zone_settings as s (zone_id, plan_avg_days, plan_min_days, plan_over_pct, plan_near_km, plan_helper_max, plan_show_rider)
    values (p_zone, coalesce((p ->> 'avg_days')::integer, 14), coalesce((p ->> 'min_days')::integer, 3), coalesce((p ->> 'over_pct')::integer, 110),
      coalesce((p ->> 'near_km')::numeric, 3), coalesce((p ->> 'helper_max')::integer, 20), coalesce((p ->> 'show_rider')::boolean, true))
    on conflict (zone_id) do update set
      plan_avg_days = coalesce((p ->> 'avg_days')::integer, s.plan_avg_days),
      plan_min_days = coalesce((p ->> 'min_days')::integer, s.plan_min_days),
      plan_over_pct = coalesce((p ->> 'over_pct')::integer, s.plan_over_pct),
      plan_near_km = coalesce((p ->> 'near_km')::numeric, s.plan_near_km),
      plan_helper_max = coalesce((p ->> 'helper_max')::integer, s.plan_helper_max),
      plan_show_rider = coalesce((p ->> 'show_rider')::boolean, s.plan_show_rider);
  exception
    when check_violation or numeric_value_out_of_range then raise exception 'A plan rule is outside its allowed range.' using errcode = '22023';
    when invalid_text_representation or datatype_mismatch then raise exception 'A plan rule has the wrong kind of value.' using errcode = '22023';
  end;
  return private.route_plan_rules(p_zone);
end $$;

-- p: {pickup_mode?, pickup_weight?, staff?: [{employee_id, day_parcels?, helper?, helper_max?, pickup?}]}
create or replace function public.route_plan_setup(p_hub uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; x jsonb; v_emp uuid; v_fixed integer; v_max integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route_plan.configure', v_zone, p_hub) then
    raise exception 'Not authorised to set up the parcel plan of this hub.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The set-up must be an object.' using errcode = '22023'; end if;
  if p ? 'pickup_mode' or p ? 'pickup_weight' then
    if p ? 'pickup_mode' and coalesce(p ->> 'pickup_mode', '') not in ('same', 'separate', 'mixed') then
      raise exception 'Who does the pickups: same, separate or mixed.' using errcode = '22023';
    end if;
    begin
      insert into public.route_hub_load as l (hub_id, zone_id, pickup_mode, pickup_weight)
      values (p_hub, v_zone, coalesce(p ->> 'pickup_mode', 'mixed'), coalesce((p ->> 'pickup_weight')::numeric, 1))
      on conflict (hub_id) do update set pickup_mode = coalesce(p ->> 'pickup_mode', l.pickup_mode),
        pickup_weight = coalesce((p ->> 'pickup_weight')::numeric, l.pickup_weight);
    exception when check_violation or numeric_value_out_of_range or invalid_text_representation then
      raise exception 'One pickup counts as 0 to 5 deliveries.' using errcode = '22023';
    end;
  end if;
  if p ? 'staff' then
    if jsonb_typeof(p -> 'staff') <> 'array' then raise exception 'The staff must be a list.' using errcode = '22023'; end if;
    for x in select e from jsonb_array_elements(p -> 'staff') e loop
      begin v_emp := (x ->> 'employee_id')::uuid;
      exception when others then raise exception 'A person is written wrongly.' using errcode = '22023'; end;
      if not exists (select 1 from public.employees e where e.id = v_emp and e.hub_id = p_hub and e.status = 'active' and e.archived_at is null) then
        raise exception 'A person is not an active staff member of this hub.' using errcode = '22023';
      end if;
      v_fixed := private.route_plan_int(x, 'day_parcels', 1000, 'Parcels a day');
      v_max := private.route_plan_int(x, 'helper_max', 500, 'The most a helper takes');
      if v_fixed = 0 or v_max = 0 then raise exception 'A fixed number cannot be zero: leave it empty instead.' using errcode = '22023'; end if;
      insert into public.route_staff_load as s (employee_id, hub_id, zone_id, day_parcels, helper, helper_max, pickup)
      values (v_emp, p_hub, v_zone, v_fixed, coalesce((x ->> 'helper')::boolean, false), v_max, coalesce((x ->> 'pickup')::boolean, false))
      on conflict (employee_id) do update set hub_id = excluded.hub_id, zone_id = excluded.zone_id, day_parcels = excluded.day_parcels,
        helper = excluded.helper, helper_max = excluded.helper_max, pickup = excluded.pickup
      where (s.hub_id, s.day_parcels, s.helper, s.helper_max, s.pickup) is distinct from
            (excluded.hub_id, excluded.day_parcels, excluded.helper, excluded.helper_max, excluded.pickup);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. The plan: save, send, decide, reopen, remove
--   p: {arrived?, carried?, sent?, cancelled?, pickups?, note?, source?: {..}, route_parcels?: {route id: n}, unassigned?,
--       people: [{employee_id, kind?, present?, capacity?, parcels, pickups?, detail?: [{route_id?, parcels, for?}], note?}]}
-- ---------------------------------------------------------------------
create or replace function public.route_plan_save(p_hub uuid, p_date date, p jsonb, p_send boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_plan public.route_day_plans; v_id uuid; x jsonb; d jsonb; k text; v_emp uuid; v_keep uuid[] := '{}';
  v_parcels integer; v_sum integer; v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null and status = 'active';
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 30 then
    raise exception 'A plan is for a date from 30 days back to tomorrow.' using errcode = '22023';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The plan must be an object.' using errcode = '22023'; end if;
  select * into v_plan from public.route_day_plans where hub_id = p_hub and plan_date = p_date and archived_at is null for update;
  if v_plan.id is null then
    if not private.has_permission('ops.route_plan.create', v_zone, p_hub) then
      raise exception 'Not authorised to start the parcel plan of this hub.' using errcode = '42501';
    end if;
  else
    if not private.has_permission('ops.route_plan.edit', v_zone, p_hub) then
      raise exception 'Not authorised to change the parcel plan of this hub.' using errcode = '42501';
    end if;
    if v_plan.status = 'approved' then raise exception 'This plan is approved. It must be reopened before it can change.' using errcode = '22023'; end if;
  end if;
  if p ? 'route_parcels' then
    if jsonb_typeof(p -> 'route_parcels') <> 'object' then raise exception 'Parcels per route must be an object.' using errcode = '22023'; end if;
    for k in select jsonb_object_keys(p -> 'route_parcels') loop
      if not exists (select 1 from public.hub_routes r where r.id::text = k and r.hub_id = p_hub and r.archived_at is null) then
        raise exception 'A route does not belong to this hub.' using errcode = '22023';
      end if;
      perform private.route_plan_int(p -> 'route_parcels', k, 100000, 'Parcels of a route');
    end loop;
  end if;
  if p ? 'source' and jsonb_typeof(p -> 'source') <> 'object' then raise exception 'The sources must be an object.' using errcode = '22023'; end if;
  if length(coalesce(p ->> 'note', '')) > 500 then raise exception 'The note is too long (500 letters at most).' using errcode = '22023'; end if;
  if p ? 'people' and jsonb_typeof(p -> 'people') <> 'array' then raise exception 'The people must be a list.' using errcode = '22023'; end if;

  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  if v_plan.id is null then
    insert into public.route_day_plans (hub_id, zone_id, plan_date, arrived, carried, sent, cancelled, pickups, source, route_parcels, unassigned, note)
    values (p_hub, v_zone, p_date,
      private.route_plan_int(p, 'arrived', 100000, 'Parcels arrived'), private.route_plan_int(p, 'carried', 100000, 'Parcels left from before'),
      private.route_plan_int(p, 'sent', 100000, 'Parcels sent on'), private.route_plan_int(p, 'cancelled', 100000, 'Cancelled parcels'),
      private.route_plan_int(p, 'pickups', 100000, 'Pickups'), coalesce(p -> 'source', '{}'::jsonb), coalesce(p -> 'route_parcels', '{}'::jsonb),
      coalesce(private.route_plan_int(p, 'unassigned', 100000, 'Parcels nobody took'), 0), nullif(trim(p ->> 'note'), ''))
    returning id into v_id;
  else
    v_id := v_plan.id;
    update public.route_day_plans set
      arrived = case when p ? 'arrived' then private.route_plan_int(p, 'arrived', 100000, 'Parcels arrived') else arrived end,
      carried = case when p ? 'carried' then private.route_plan_int(p, 'carried', 100000, 'Parcels left from before') else carried end,
      sent = case when p ? 'sent' then private.route_plan_int(p, 'sent', 100000, 'Parcels sent on') else sent end,
      cancelled = case when p ? 'cancelled' then private.route_plan_int(p, 'cancelled', 100000, 'Cancelled parcels') else cancelled end,
      pickups = case when p ? 'pickups' then private.route_plan_int(p, 'pickups', 100000, 'Pickups') else pickups end,
      source = case when p ? 'source' then p -> 'source' else source end,
      route_parcels = case when p ? 'route_parcels' then p -> 'route_parcels' else route_parcels end,
      unassigned = case when p ? 'unassigned' then coalesce(private.route_plan_int(p, 'unassigned', 100000, 'Parcels nobody took'), 0) else unassigned end,
      note = case when p ? 'note' then nullif(trim(p ->> 'note'), '') else note end,
      version = version + 1
    where id = v_id;
  end if;

  if p ? 'people' then
    for x in select e from jsonb_array_elements(p -> 'people') e loop
      begin v_emp := (x ->> 'employee_id')::uuid;
      exception when others then raise exception 'A person is written wrongly.' using errcode = '22023'; end;
      if v_emp = any(v_keep) then raise exception 'A person is on the plan twice.' using errcode = '22023'; end if;
      if not exists (select 1 from public.employees e where e.id = v_emp and e.hub_id = p_hub and e.archived_at is null)
         and not exists (select 1 from public.route_day_riders l where l.plan_id = v_id and l.employee_id = v_emp) then
        raise exception 'A person does not work at this hub.' using errcode = '22023';
      end if;
      if coalesce(x ->> 'kind', 'rider') not in ('rider', 'helper') then raise exception 'A person is a rider or a helper.' using errcode = '22023'; end if;
      if length(coalesce(x ->> 'note', '')) > 300 then raise exception 'A note is too long (300 letters at most).' using errcode = '22023'; end if;
      v_parcels := coalesce(private.route_plan_int(x, 'parcels', 5000, 'Parcels of a person'), 0);
      d := coalesce(x -> 'detail', '[]'::jsonb);
      if jsonb_typeof(d) <> 'array' then raise exception 'The parts of a person''s parcels must be a list.' using errcode = '22023'; end if;
      if jsonb_array_length(d) > 0 then
        if exists (select 1 from jsonb_array_elements(d) e
                    where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'parcels', '') !~ '^[0-9]{1,4}$'
                       or (nullif(e ->> 'route_id', '') is not null and not exists (
                             select 1 from public.hub_routes r where r.id::text = e ->> 'route_id' and r.hub_id = p_hub))
                       or (nullif(e ->> 'for', '') is not null and not exists (
                             select 1 from public.employees pe where pe.id::text = e ->> 'for'))) then
          raise exception 'A part of a person''s parcels is written wrongly.' using errcode = '22023';
        end if;
        select sum((e ->> 'parcels')::integer) into v_sum from jsonb_array_elements(d) e;
        if v_sum <> v_parcels then raise exception 'The parts of a person''s parcels do not add up to the total.' using errcode = '22023'; end if;
      end if;
      insert into public.route_day_riders as l (plan_id, hub_id, zone_id, plan_date, employee_id, kind, present, capacity, parcels, pickups, detail, note)
      values (v_id, p_hub, v_zone, p_date, v_emp, coalesce(x ->> 'kind', 'rider'),
        case when jsonb_typeof(x -> 'present') = 'boolean' then (x ->> 'present')::boolean end,
        private.route_plan_int(x, 'capacity', 5000, 'What a person can take'), v_parcels,
        coalesce(private.route_plan_int(x, 'pickups', 5000, 'Pickups of a person'), 0), d, nullif(trim(x ->> 'note'), ''))
      on conflict (plan_id, employee_id) do update set kind = excluded.kind, present = excluded.present, capacity = excluded.capacity,
        parcels = excluded.parcels, pickups = excluded.pickups, detail = excluded.detail, note = excluded.note, removed_at = null
      where (l.kind, l.present, l.capacity, l.parcels, l.pickups, l.detail, l.note, l.removed_at) is distinct from
            (excluded.kind, excluded.present, excluded.capacity, excluded.parcels, excluded.pickups, excluded.detail, excluded.note, null::timestamptz);
      v_keep := v_keep || v_emp;
    end loop;
    update public.route_day_riders set removed_at = now() where plan_id = v_id and removed_at is null and not (employee_id = any(v_keep));
  end if;

  if p_send then
    if not exists (select 1 from public.route_day_riders l where l.plan_id = v_id and l.removed_at is null and (l.parcels > 0 or l.pickups > 0)) then
      raise exception 'Give at least one person parcels before sending the plan.' using errcode = '22023';
    end if;
    update public.route_day_plans set status = 'sent', sent_by = auth.uid(), sent_by_name = v_name, sent_at = now(),
      decided_by = null, decided_by_name = null, decided_at = null, decide_note = null where id = v_id;
  end if;
  return v_id;
end $$;

-- Approve, or send back with a note.
create or replace function public.route_plan_decide(p_plan uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans; v_name text;
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
    if not exists (select 1 from public.route_day_riders l where l.plan_id = v.id and l.removed_at is null and (l.parcels > 0 or l.pickups > 0)) then
      raise exception 'Nobody has parcels on this plan yet.' using errcode = '22023';
    end if;
    update public.route_day_plans set status = 'approved', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = nullif(trim(p_note), '') where id = v.id;
  else
    if v.status <> 'sent' then raise exception 'Only a sent plan can be sent back.' using errcode = '22023'; end if;
    if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Write why the plan goes back.' using errcode = '22023'; end if;
    update public.route_day_plans set status = 'draft', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = trim(p_note) where id = v.id;
  end if;
end $$;

create or replace function public.route_plan_reopen(p_plan uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans; v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.route_day_plans where id = p_plan and archived_at is null for update;
  if v.id is null or not private.has_permission('ops.route_plan.approve', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to reopen this plan.' using errcode = '42501';
  end if;
  if v.status <> 'approved' then raise exception 'Only an approved plan can be reopened.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 500 then raise exception 'Write why the plan is reopened.' using errcode = '22023'; end if;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  update public.route_day_plans set status = 'draft', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
    decide_note = trim(p_reason), version = version + 1 where id = v.id;
end $$;

create or replace function public.route_plan_remove(p_plan uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.route_day_plans where id = p_plan and archived_at is null for update;
  if v.id is null or not private.has_permission('ops.route_plan.archive', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to remove this plan.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 500 then raise exception 'Write why the plan is removed.' using errcode = '22023'; end if;
  update public.route_day_plans set archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason) where id = v.id;
end $$;

-- ---------------------------------------------------------------------
-- 7. Role page lists: a role that may see the plan and has its own page list gets the new page
-- ---------------------------------------------------------------------
update public.role_dashboards d
   set menu = d.menu || '["/app/routes/plan"]'::jsonb
 where d.menu is not null and jsonb_typeof(d.menu) = 'array' and not d.menu ? '/app/routes/plan'
   and exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                where rp.role_id = d.role_id and p.code = 'ops.route_plan.view');

revoke all on function public.route_plan_hubs(date), public.route_plan_get(uuid, date), public.route_plan_mine(),
  public.route_plan_rules_save(uuid, jsonb), public.route_plan_setup(uuid, jsonb), public.route_plan_save(uuid, date, jsonb, boolean),
  public.route_plan_decide(uuid, boolean, text), public.route_plan_reopen(uuid, text), public.route_plan_remove(uuid, text) from public, anon;
grant execute on function public.route_plan_hubs(date), public.route_plan_get(uuid, date), public.route_plan_mine(),
  public.route_plan_rules_save(uuid, jsonb), public.route_plan_setup(uuid, jsonb), public.route_plan_save(uuid, date, jsonb, boolean),
  public.route_plan_decide(uuid, boolean, text), public.route_plan_reopen(uuid, text), public.route_plan_remove(uuid, text) to authenticated;
