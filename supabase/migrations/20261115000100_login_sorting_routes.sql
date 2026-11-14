-- =====================================================================
-- XZM-TEAM ERP — Migration 0026: login by ID / phone, zone-level posts,
-- Sorting Center Management, duties and rider routes
--
--  * login_resolve(identifier): employee ID, mobile or e-mail -> the login e-mail.
--    Only the auth-login Edge Function (service role) may call it.
--  * positions.level: 'hub' | 'zone' | 'head_office'. People on a zone-level post
--    (Zonal Manager) are not counted or listed as a hub's fixed staff.
--  * Sorting centers: routes (sorting -> hubs), staff and their duties, fuel slips
--    and expense requests (charged to the center or to a hub's accounts sheet when
--    the route allows it), parcel handovers both ways with wrong / returned /
--    damaged counts, driver trip reports, dashboard and reports.
--  * job_duties: duties by post and by person. hub_routes: rider routes made of
--    area names; a rider can hold one or more routes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Login with employee ID or phone
-- ---------------------------------------------------------------------
create or replace function public.login_resolve(p_identifier text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id text := lower(trim(coalesce(p_identifier, '')));
  v_digits text;
  v_emails text[];
begin
  if v_id = '' then return null; end if;
  if position('@' in v_id) > 0 then return v_id; end if;
  v_digits := regexp_replace(v_id, '\D', '', 'g');
  if v_digits like '880%' and length(v_digits) = 13 then v_digits := substr(v_digits, 3); end if;
  if v_digits like '88%' and length(v_digits) = 13 then v_digits := substr(v_digits, 3); end if;

  select array_agg(distinct lower(p.email::text)) into v_emails
  from public.profiles p
  left join public.employees e on e.profile_id = p.id and e.archived_at is null
  where p.archived_at is null and p.email is not null
    and (
          lower(e.employee_code::text) = v_id
       or lower(e.employee_code::text) = regexp_replace(v_id, '^[a-z]+-', '')
       or (length(v_digits) = 11 and v_digits ~ '^01[3-9]' and (
             regexp_replace(coalesce(e.mobile, ''), '\D', '', 'g') in (v_digits, '88' || v_digits)
          or regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') in (v_digits, '88' || v_digits)))
    );
  -- One match only; two accounts on the same number must use their e-mail.
  if coalesce(array_length(v_emails, 1), 0) = 1 then return v_emails[1]; end if;
  return null;
end $$;
revoke all on function public.login_resolve(text) from public, anon, authenticated;
grant execute on function public.login_resolve(text) to service_role;

-- ---------------------------------------------------------------------
-- 2. Zone-level posts are not a hub's fixed staff
-- ---------------------------------------------------------------------
alter table public.positions add column if not exists level text not null default 'hub'
  check (level in ('hub', 'zone', 'head_office'));
update public.positions set level = 'zone' where name ~* 'zonal' and level = 'hub';
update public.positions set level = 'head_office' where name ~* 'head office' and level = 'hub';

create or replace function private.is_hub_post(p_position uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_position is null or coalesce((select level = 'hub' from public.positions where id = p_position), true)
$$;
grant execute on function private.is_hub_post(uuid) to authenticated;

create or replace function public.hr_hub_staff_summary(p_zone uuid default null)
returns table (hub_id uuid, hub_name text, zone_id uuid, zone_name text, total integer, active integer, inactive integer,
               applicant integer, without_id integer, with_login integer, by_position jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from private.my_grants()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select h.id, h.name, z.id, z.name,
         coalesce(c.total, 0), coalesce(c.active, 0), coalesce(c.inactive, 0), coalesce(c.applicant, 0),
         coalesce(c.without_id, 0), coalesce(c.with_login, 0), coalesce(q.map, '{}'::jsonb)
  from public.hubs h
  join public.zones z on z.id = h.zone_id
  left join lateral (
    select count(*)::int total,
           count(*) filter (where e.status = 'active')::int active,
           count(*) filter (where e.status = 'inactive')::int inactive,
           count(*) filter (where e.status = 'applicant')::int applicant,
           count(*) filter (where e.employee_code is null and e.status <> 'applicant')::int without_id,
           count(*) filter (where e.profile_id is not null)::int with_login
      from public.employees e
     where e.hub_id = h.id and e.archived_at is null and private.is_hub_post(e.position_id)) c on true
  left join lateral (
    select jsonb_object_agg(x.pos, x.c) map from (
      select p.name pos, count(*) c
        from public.employees e2 join public.positions p on p.id = e2.position_id
       where e2.hub_id = h.id and e2.archived_at is null and e2.status = 'active' and p.level = 'hub'
       group by p.name) x) q on true
  where h.archived_at is null
    and (p_zone is null or h.zone_id = p_zone)
    and private.has_permission('hr.employee.view', h.zone_id, h.id)
  order by z.name, h.name;
end $$;

-- ---------------------------------------------------------------------
-- 3. Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description) values
  ('sorting.center.view',      'sorting', 'center',     'view',      'See sorting centers, their dashboard and routes'),
  ('sorting.center.create',    'sorting', 'center',     'create',    'Add sorting centers'),
  ('sorting.center.edit',      'sorting', 'center',     'edit',      'Change sorting centers and their routes'),
  ('sorting.center.archive',   'sorting', 'center',     'archive',   'Remove sorting centers and routes'),
  ('sorting.staff.view',       'sorting', 'staff',      'view',      'See sorting center staff and their duties'),
  ('sorting.staff.edit',       'sorting', 'staff',      'edit',      'Add / change / remove sorting center staff and duties'),
  ('sorting.fuel.view',        'sorting', 'fuel',       'view',      'See fuel slips and expense requests'),
  ('sorting.fuel.create',      'sorting', 'fuel',       'create',    'Write fuel slips and expense requests'),
  ('sorting.fuel.approve',     'sorting', 'fuel',       'approve',   'Approve or reject fuel and expense requests'),
  ('sorting.hub_charge.create','sorting', 'hub_charge', 'create',    'Send an approved sorting vehicle cost to a hub''s accounts sheet'),
  ('sorting.parcel.view',      'sorting', 'parcel',     'view',      'See parcel handovers hub <-> sorting'),
  ('sorting.parcel.create',    'sorting', 'parcel',     'create',    'Write and receive parcel handovers, wrong / returned / damaged'),
  ('sorting.driver.view',      'sorting', 'driver',     'view',      'See driver trip reports'),
  ('sorting.driver.create',    'sorting', 'driver',     'create',    'Write driver trip reports'),
  ('sorting.report.view',      'sorting', 'report',     'view',      'Sorting reports'),
  ('sorting.report.export',    'sorting', 'report',     'export',    'Export sorting reports'),
  ('hr.duty.view',             'hr',      'duty',       'view',      'See duties of posts and people'),
  ('hr.duty.edit',             'hr',      'duty',       'edit',      'Set duties of posts and people'),
  ('ops.route.view',           'ops',     'route',      'view',      'See rider routes'),
  ('ops.route.edit',           'ops',     'route',      'edit',      'Make rider routes and give them to riders')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager') and p.code like 'sorting.%')
  or (r.code in ('admin', 'head_office_manager', 'hr_manager') and p.code in ('hr.duty.view', 'hr.duty.edit'))
  or (r.code in ('admin', 'head_office_manager', 'operations_manager', 'zonal_manager', 'hub_manager') and p.code in ('ops.route.view', 'ops.route.edit'))
  or (r.code in ('zonal_manager', 'operations_manager') and p.code in ('sorting.center.view', 'sorting.center.edit', 'sorting.staff.view', 'sorting.staff.edit',
        'sorting.fuel.view', 'sorting.fuel.create', 'sorting.fuel.approve', 'sorting.hub_charge.create', 'sorting.parcel.view', 'sorting.parcel.create',
        'sorting.driver.view', 'sorting.driver.create', 'sorting.report.view', 'sorting.report.export', 'hr.duty.view', 'hr.duty.edit'))
  or (r.code in ('hub_manager', 'delivery_manager', 'pickup_manager') and p.code in ('sorting.center.view', 'sorting.parcel.view', 'sorting.parcel.create', 'hr.duty.view', 'ops.route.view'))
  or (r.code in ('accounts_manager', 'manager_hisab', 'accountant', 'auditor') and p.code in ('sorting.fuel.view', 'sorting.report.view'))
  or (r.code = 'rider' and p.code = 'ops.route.view')
) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. Sorting centers, routes, staff
-- ---------------------------------------------------------------------
create table public.sorting_centers (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique,
  name text not null check (length(trim(name)) > 1),
  name_bn text,
  zone_id uuid not null references public.zones(id),
  address text, phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table public.sorting_routes (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.sorting_centers(id),
  zone_id uuid not null references public.zones(id),
  code text not null, name text not null check (length(trim(name)) > 1),
  vehicle_id uuid references public.vehicles(id),
  driver_id uuid references public.employees(id),
  depart_time time, note text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (center_id, code)
);

-- Hubs on a route, in order. can_charge: the route's vehicle cost may go to this hub's sheet.
create table public.sorting_route_hubs (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.sorting_routes(id),
  hub_id uuid not null references public.hubs(id),
  zone_id uuid not null references public.zones(id),
  seq integer not null default 1,
  can_charge boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (route_id, hub_id)
);

create table public.sorting_staff (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.sorting_centers(id),
  zone_id uuid not null references public.zones(id),
  employee_id uuid not null references public.employees(id),
  role text not null default 'sorter' check (role in ('supervisor', 'data_entry', 'sorter', 'loader', 'driver', 'helper', 'security', 'other')),
  shift text, duties text,
  effective_from date not null default current_date,
  effective_to date, end_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (effective_to is null or effective_to >= effective_from)
);
create unique index sorting_staff_one_open on public.sorting_staff (center_id, employee_id) where effective_to is null;

-- ---------------------------------------------------------------------
-- 5. Fuel slips and expense requests
-- ---------------------------------------------------------------------
create table public.sorting_fuel_requests (
  id uuid primary key default gen_random_uuid(),
  no bigint generated always as identity,
  center_id uuid not null references public.sorting_centers(id),
  zone_id uuid not null references public.zones(id),
  route_id uuid references public.sorting_routes(id),
  vehicle_id uuid references public.vehicles(id),
  employee_id uuid references public.employees(id),
  kind text not null default 'fuel' check (kind in ('fuel', 'repair', 'toll', 'parking', 'driver_food', 'other')),
  request_date date not null default current_date,
  fuel_date date,
  litres numeric(10,2) check (litres is null or litres > 0),
  rate numeric(10,2) check (rate is null or rate > 0),
  amount numeric(12,2) not null check (amount > 0),
  odometer_km numeric(12,1),
  pump_name text, slip_no text, slip_path text check (slip_path is null or slip_path like 'fuel/%'),
  note text,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'withdrawn')),
  charge_to text not null default 'center' check (charge_to in ('center', 'hub')),
  charge_hub_id uuid references public.hubs(id),
  claim_id uuid references public.da_expense_claims(id),
  reviewed_by uuid, reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (status <> 'rejected' or length(trim(coalesce(review_note, ''))) > 0),
  check (charge_to = 'center' or charge_hub_id is not null)
);

-- ---------------------------------------------------------------------
-- 6. Parcel handovers hub <-> sorting, driver trip reports
-- ---------------------------------------------------------------------
create table public.sorting_handovers (
  id uuid primary key default gen_random_uuid(),
  no bigint generated always as identity,
  center_id uuid not null references public.sorting_centers(id),
  zone_id uuid not null references public.zones(id),
  route_id uuid references public.sorting_routes(id),
  hub_id uuid not null references public.hubs(id),
  direction text not null check (direction in ('hub_to_sorting', 'sorting_to_hub')),
  work_date date not null default current_date,
  vehicle_id uuid references public.vehicles(id),
  driver_id uuid references public.employees(id),
  handed_by_id uuid references public.employees(id),
  handed_by_name text,
  parcel_count integer not null check (parcel_count >= 0),
  bag_count integer check (bag_count is null or bag_count >= 0),
  wrong_count integer not null default 0 check (wrong_count >= 0),
  returned_count integer not null default 0 check (returned_count >= 0),
  damaged_count integer not null default 0 check (damaged_count >= 0),
  note text,
  status text not null default 'sent' check (status in ('sent', 'received', 'disputed')),
  received_count integer check (received_count is null or received_count >= 0),
  received_by uuid, received_by_name text, received_at timestamptz, receive_note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index sorting_handovers_day on public.sorting_handovers (center_id, work_date);
create index sorting_handovers_hub on public.sorting_handovers (hub_id, work_date);

create table public.sorting_driver_reports (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.sorting_centers(id),
  zone_id uuid not null references public.zones(id),
  route_id uuid not null references public.sorting_routes(id),
  work_date date not null default current_date,
  driver_id uuid references public.employees(id),
  vehicle_id uuid references public.vehicles(id),
  depart_at time, return_at time,
  start_km numeric(12,1), end_km numeric(12,1),
  hubs_reached integer, parcels_out integer, parcels_in integer,
  status text not null default 'done' check (status in ('done', 'late', 'missed', 'breakdown')),
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (end_km is null or start_km is null or end_km >= start_km)
);
create index sorting_driver_reports_day on public.sorting_driver_reports (center_id, work_date);

-- ---------------------------------------------------------------------
-- 7. Duties and rider routes
-- ---------------------------------------------------------------------
create table public.job_duties (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references public.positions(id),
  employee_id uuid references public.employees(id),
  zone_id uuid references public.zones(id),
  title text not null check (length(trim(title)) > 1),
  details text,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly', 'monthly', 'as_needed')),
  sort integer not null default 100,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check ((position_id is null) <> (employee_id is null))
);

create table public.hub_routes (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references public.hubs(id),
  zone_id uuid not null references public.zones(id),
  code text not null, name text not null check (length(trim(name)) > 1),
  areas text[] not null default '{}',
  note text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (hub_id, code)
);

create table public.rider_routes (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.hub_routes(id),
  employee_id uuid not null references public.employees(id),
  hub_id uuid not null references public.hubs(id),
  zone_id uuid not null references public.zones(id),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index rider_routes_one_open on public.rider_routes (route_id, employee_id) where effective_to is null;

-- ---------------------------------------------------------------------
-- 8. Stamps, audit, no hard delete (job_duties / route hubs may be deleted)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sorting_centers','sorting_routes','sorting_route_hubs','sorting_staff','sorting_fuel_requests',
                           'sorting_handovers','sorting_driver_reports','job_duties','hub_routes','rider_routes'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t,
                   case when t in ('job_duties') then 'hr' when t in ('hub_routes','rider_routes') then 'ops' else 'sorting' end);
    if t not in ('sorting_route_hubs') then
      execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

grant select, insert, update on public.sorting_centers, public.sorting_routes, public.sorting_staff, public.sorting_handovers,
  public.sorting_driver_reports, public.job_duties, public.hub_routes, public.rider_routes to authenticated;
grant select, insert, update, delete on public.sorting_route_hubs to authenticated;
grant select on public.sorting_fuel_requests to authenticated;

-- Zone of a center (helper for policies)
create or replace function private.center_zone(p_center uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select zone_id from public.sorting_centers where id = p_center $$;

-- A hub that is on any route of the center (hub people see handovers of their own hub).
create policy sc_read on public.sorting_centers for select to authenticated
  using (private.has_permission('sorting.center.view', zone_id, null) or private.has_permission_within_zone('sorting.center.view', zone_id)
      or private.has_permission_within_zone('sorting.parcel.view', zone_id));
create policy sc_insert on public.sorting_centers for insert to authenticated
  with check (private.has_permission('sorting.center.create', zone_id, null));
create policy sc_update on public.sorting_centers for update to authenticated
  using (private.has_permission('sorting.center.edit', zone_id, null) or private.has_permission('sorting.center.archive', zone_id, null))
  with check (private.has_permission('sorting.center.edit', zone_id, null) or private.has_permission('sorting.center.archive', zone_id, null));

create policy sr_read on public.sorting_routes for select to authenticated
  using (private.has_permission_within_zone('sorting.center.view', zone_id) or private.has_permission_within_zone('sorting.parcel.view', zone_id)
      or private.has_permission('sorting.driver.view', zone_id, null));
create policy sr_write on public.sorting_routes for insert to authenticated
  with check (private.has_permission('sorting.center.edit', zone_id, null) and zone_id = private.center_zone(center_id));
create policy sr_update on public.sorting_routes for update to authenticated
  using (private.has_permission('sorting.center.edit', zone_id, null)) with check (private.has_permission('sorting.center.edit', zone_id, null));

create policy srh_read on public.sorting_route_hubs for select to authenticated
  using (private.has_permission_within_zone('sorting.center.view', zone_id) or private.has_permission('sorting.parcel.view', zone_id, hub_id));
create policy srh_insert on public.sorting_route_hubs for insert to authenticated
  with check (private.has_permission('sorting.center.edit', zone_id, null) and zone_id = private.hub_zone(hub_id));
create policy srh_update on public.sorting_route_hubs for update to authenticated
  using (private.has_permission('sorting.center.edit', zone_id, null)) with check (private.has_permission('sorting.center.edit', zone_id, null));
create policy srh_delete on public.sorting_route_hubs for delete to authenticated
  using (private.has_permission('sorting.center.edit', zone_id, null));

create policy ss_read on public.sorting_staff for select to authenticated
  using (private.has_permission('sorting.staff.view', zone_id, null) or employee_id = private.my_employee_id());
create policy ss_insert on public.sorting_staff for insert to authenticated
  with check (private.has_permission('sorting.staff.edit', zone_id, null) and zone_id = private.center_zone(center_id));
create policy ss_update on public.sorting_staff for update to authenticated
  using (private.has_permission('sorting.staff.edit', zone_id, null)) with check (private.has_permission('sorting.staff.edit', zone_id, null));

create policy sf_read on public.sorting_fuel_requests for select to authenticated
  using (private.has_permission('sorting.fuel.view', zone_id, null) or created_by = auth.uid() or employee_id = private.my_employee_id()
      or (charge_hub_id is not null and private.has_permission('da.sheet.view', zone_id, charge_hub_id)));

create policy sh_read on public.sorting_handovers for select to authenticated
  using (private.has_permission('sorting.parcel.view', zone_id, hub_id) or private.has_permission('sorting.report.view', zone_id, null));
create policy sh_insert on public.sorting_handovers for insert to authenticated
  with check (private.has_permission('sorting.parcel.create', zone_id, hub_id) and zone_id = private.center_zone(center_id)
              and zone_id = private.hub_zone(hub_id) and status = 'sent' and received_at is null);
create policy sh_update on public.sorting_handovers for update to authenticated
  using (private.has_permission('sorting.parcel.create', zone_id, hub_id)) with check (private.has_permission('sorting.parcel.create', zone_id, hub_id));

create policy sd_read on public.sorting_driver_reports for select to authenticated
  using (private.has_permission('sorting.driver.view', zone_id, null) or private.has_permission('sorting.report.view', zone_id, null)
      or driver_id = private.my_employee_id());
create policy sd_insert on public.sorting_driver_reports for insert to authenticated
  with check ((private.has_permission('sorting.driver.create', zone_id, null) or driver_id = private.my_employee_id())
              and zone_id = private.center_zone(center_id));
create policy sd_update on public.sorting_driver_reports for update to authenticated
  using (private.has_permission('sorting.driver.create', zone_id, null) or (driver_id = private.my_employee_id() and work_date >= current_date - 1))
  with check (private.has_permission('sorting.driver.create', zone_id, null) or (driver_id = private.my_employee_id() and work_date >= current_date - 1));

create policy jd_read on public.job_duties for select to authenticated
  using (archived_at is null and (private.has_permission_within_zone('hr.duty.view', coalesce(zone_id, (select e.zone_id from public.employees e where e.id = job_duties.employee_id)))
      or private.has_permission('hr.duty.view', null, null)
      or employee_id = private.my_employee_id()
      or position_id = (select e.position_id from public.employees e where e.id = private.my_employee_id())));
create policy jd_insert on public.job_duties for insert to authenticated
  with check (private.has_permission('hr.duty.edit', null, null)
      or (zone_id is not null and private.has_permission('hr.duty.edit', zone_id, null)));
create policy jd_update on public.job_duties for update to authenticated
  using (private.has_permission('hr.duty.edit', null, null) or (zone_id is not null and private.has_permission('hr.duty.edit', zone_id, null)))
  with check (private.has_permission('hr.duty.edit', null, null) or (zone_id is not null and private.has_permission('hr.duty.edit', zone_id, null)));

create policy hr_read on public.hub_routes for select to authenticated
  using (private.has_permission('ops.route.view', zone_id, hub_id)
      or exists (select 1 from public.rider_routes x where x.route_id = hub_routes.id and x.effective_to is null and x.employee_id = private.my_employee_id()));
create policy hr_insert on public.hub_routes for insert to authenticated
  with check (private.has_permission('ops.route.edit', zone_id, hub_id) and zone_id = private.hub_zone(hub_id));
create policy hr_update on public.hub_routes for update to authenticated
  using (private.has_permission('ops.route.edit', zone_id, hub_id)) with check (private.has_permission('ops.route.edit', zone_id, hub_id));

create policy rr_read on public.rider_routes for select to authenticated
  using (private.has_permission('ops.route.view', zone_id, hub_id) or employee_id = private.my_employee_id());
create policy rr_insert on public.rider_routes for insert to authenticated
  with check (private.has_permission('ops.route.edit', zone_id, hub_id) and zone_id = private.hub_zone(hub_id));
create policy rr_update on public.rider_routes for update to authenticated
  using (private.has_permission('ops.route.edit', zone_id, hub_id)) with check (private.has_permission('ops.route.edit', zone_id, hub_id));

-- ---------------------------------------------------------------------
-- 9. Fuel / expense request workflow
-- ---------------------------------------------------------------------
create or replace function public.sorting_fuel_save(
  p_center uuid, p_amount numeric, p_kind text default 'fuel', p_route uuid default null, p_vehicle uuid default null,
  p_employee_code text default null, p_fuel_date date default null, p_litres numeric default null, p_rate numeric default null,
  p_odometer numeric default null, p_pump text default null, p_slip_no text default null, p_slip_path text default null,
  p_note text default null, p_charge_hub uuid default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid := private.center_zone(p_center); v_emp uuid; v_id uuid; r public.sorting_fuel_requests;
begin
  if v_zone is null then raise exception 'Sorting center not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.fuel.create', v_zone, null) then
    raise exception 'Not authorised to write fuel or expense requests.' using errcode = '42501';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Give the amount.' using errcode = '22023'; end if;
  if p_route is not null and not exists (select 1 from public.sorting_routes where id = p_route and center_id = p_center) then
    raise exception 'The route is not on this sorting center.' using errcode = '22023';
  end if;
  if p_charge_hub is not null and not exists (
       select 1 from public.sorting_route_hubs rh join public.sorting_routes sr on sr.id = rh.route_id
        where rh.hub_id = p_charge_hub and rh.can_charge and sr.center_id = p_center and (p_route is null or sr.id = p_route)) then
    raise exception 'This hub''s accounts may not be charged for this route. Turn on "cost from hub" on the route first.' using errcode = '22023';
  end if;
  if nullif(trim(p_employee_code), '') is not null then
    select id into v_emp from public.employees where employee_code = trim(p_employee_code)::extensions.citext and archived_at is null;
    if v_emp is null then raise exception 'No staff with this ID.' using errcode = '22023'; end if;
  else
    v_emp := private.my_employee_id();
  end if;
  if p_id is null then
    insert into public.sorting_fuel_requests (center_id, zone_id, route_id, vehicle_id, employee_id, kind, fuel_date, litres, rate, amount,
      odometer_km, pump_name, slip_no, slip_path, note, charge_to, charge_hub_id)
    values (p_center, v_zone, p_route, p_vehicle, v_emp, coalesce(p_kind, 'fuel'), p_fuel_date, p_litres, p_rate, p_amount,
      p_odometer, nullif(trim(p_pump), ''), nullif(trim(p_slip_no), ''), p_slip_path, nullif(trim(p_note), ''),
      case when p_charge_hub is null then 'center' else 'hub' end, p_charge_hub)
    returning id into v_id;
  else
    select * into r from public.sorting_fuel_requests where id = p_id for update;
    if r.id is null or r.center_id <> p_center then raise exception 'Request not found.' using errcode = 'P0002'; end if;
    if r.status <> 'submitted' then raise exception 'Only a request waiting for approval can be changed.' using errcode = '22023'; end if;
    update public.sorting_fuel_requests set route_id = p_route, vehicle_id = p_vehicle, employee_id = v_emp, kind = coalesce(p_kind, kind),
      fuel_date = p_fuel_date, litres = p_litres, rate = p_rate, amount = p_amount, odometer_km = p_odometer,
      pump_name = nullif(trim(p_pump), ''), slip_no = nullif(trim(p_slip_no), ''), slip_path = coalesce(p_slip_path, slip_path),
      note = nullif(trim(p_note), ''), charge_to = case when p_charge_hub is null then 'center' else 'hub' end, charge_hub_id = p_charge_hub
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- Approve: when charged to a hub, it lands in that hub's "staff bills" queue so the hub's
-- manager picks it into the daily sheet (same path as a staff expense claim).
create or replace function public.sorting_fuel_decide(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.sorting_fuel_requests; e public.employees; v_claim uuid; v_route text; v_center text;
begin
  select * into r from public.sorting_fuel_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.fuel.approve', r.zone_id, null) then
    raise exception 'Not authorised to approve fuel or expense requests.' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then raise exception 'This request is already decided.' using errcode = '22023'; end if;
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write why it is rejected.' using errcode = '22023'; end if;
    update public.sorting_fuel_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = trim(p_note) where id = p_id;
    return;
  end if;
  if r.charge_to = 'hub' then
    if not private.has_permission('sorting.hub_charge.create', r.zone_id, r.charge_hub_id) then
      raise exception 'Not authorised to send sorting costs to a hub''s accounts.' using errcode = '42501';
    end if;
    if r.employee_id is null then raise exception 'Say which staff member paid (employee ID) before sending it to a hub.' using errcode = '22023'; end if;
    select * into e from public.employees where id = r.employee_id;
    select name into v_route from public.sorting_routes where id = r.route_id;
    select name into v_center from public.sorting_centers where id = r.center_id;
    insert into public.da_expense_claims (employee_id, employee_code, employee_name, hub_id, zone_id, kind, expense_name, category,
      amount, bill_date, bill_no, reference_no, vehicle_id, remarks, status)
    values (e.id, e.employee_code::text, e.full_name, r.charge_hub_id, r.zone_id, 'transport',
      left(concat_ws(' · ', 'শটিং গাড়ি খরচ', v_center, v_route), 200),
      case when r.kind = 'fuel' then 'fuel' else 'transport' end,
      r.amount, coalesce(r.fuel_date, r.request_date), r.slip_no, 'SORT-' || r.no, r.vehicle_id,
      nullif(concat_ws(' · ', r.note, nullif(trim(coalesce(p_note, '')), '')), ''), 'submitted')
    returning id into v_claim;
  end if;
  update public.sorting_fuel_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = nullif(trim(coalesce(p_note, '')), ''), claim_id = v_claim where id = p_id;
end $$;

create or replace function public.sorting_fuel_withdraw(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.sorting_fuel_requests;
begin
  select * into r from public.sorting_fuel_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then raise exception 'Only a waiting request can be withdrawn.' using errcode = '22023'; end if;
  if r.created_by is distinct from auth.uid() and not private.has_permission('sorting.fuel.approve', r.zone_id, null) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  update public.sorting_fuel_requests set status = 'withdrawn', review_note = nullif(trim(coalesce(p_reason, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 10. Receive a handover (the other side confirms the count)
-- ---------------------------------------------------------------------
create or replace function public.sorting_handover_receive(p_id uuid, p_count integer, p_wrong integer default null,
  p_returned integer default null, p_damaged integer default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.sorting_handovers; v_name text;
begin
  select * into r from public.sorting_handovers where id = p_id for update;
  if r.id is null then raise exception 'Handover not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.parcel.create', r.zone_id, r.hub_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if r.status <> 'sent' then raise exception 'Already received.' using errcode = '22023'; end if;
  if p_count is null or p_count < 0 then raise exception 'Give the count received.' using errcode = '22023'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.sorting_handovers set received_count = p_count,
    wrong_count = coalesce(p_wrong, wrong_count), returned_count = coalesce(p_returned, returned_count), damaged_count = coalesce(p_damaged, damaged_count),
    status = case when p_count = parcel_count then 'received' else 'disputed' end,
    received_by = auth.uid(), received_by_name = v_name, received_at = now(), receive_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 11. Dashboard and reports
-- ---------------------------------------------------------------------
create or replace function public.sorting_dashboard(p_center uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.center_zone(p_center); v jsonb;
begin
  if v_zone is null then raise exception 'Sorting center not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('sorting.center.view', v_zone, null) or private.has_permission('sorting.report.view', v_zone, null)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'routes', (select count(*) from public.sorting_routes where center_id = p_center and archived_at is null and status = 'active'),
    'hubs', (select count(distinct rh.hub_id) from public.sorting_route_hubs rh join public.sorting_routes r on r.id = rh.route_id
              where r.center_id = p_center and r.archived_at is null),
    'staff', (select count(*) from public.sorting_staff where center_id = p_center and effective_to is null),
    'staff_by_role', (select coalesce(jsonb_object_agg(role, c), '{}') from (select role, count(*) c from public.sorting_staff
              where center_id = p_center and effective_to is null group by role) x),
    'in_parcels', (select coalesce(sum(parcel_count), 0) from public.sorting_handovers where center_id = p_center and direction = 'hub_to_sorting' and work_date between p_from and p_to),
    'out_parcels', (select coalesce(sum(parcel_count), 0) from public.sorting_handovers where center_id = p_center and direction = 'sorting_to_hub' and work_date between p_from and p_to),
    'wrong', (select coalesce(sum(wrong_count), 0) from public.sorting_handovers where center_id = p_center and work_date between p_from and p_to),
    'returned', (select coalesce(sum(returned_count), 0) from public.sorting_handovers where center_id = p_center and work_date between p_from and p_to),
    'damaged', (select coalesce(sum(damaged_count), 0) from public.sorting_handovers where center_id = p_center and work_date between p_from and p_to),
    'not_received', (select count(*) from public.sorting_handovers where center_id = p_center and status = 'sent' and work_date between p_from and p_to),
    'disputed', (select count(*) from public.sorting_handovers where center_id = p_center and status = 'disputed' and work_date between p_from and p_to),
    'fuel_waiting', (select count(*) from public.sorting_fuel_requests where center_id = p_center and status = 'submitted'),
    'fuel_amount', (select coalesce(sum(amount), 0) from public.sorting_fuel_requests where center_id = p_center and status = 'approved'
                    and coalesce(fuel_date, request_date) between p_from and p_to),
    'fuel_litres', (select coalesce(sum(litres), 0) from public.sorting_fuel_requests where center_id = p_center and status = 'approved'
                    and coalesce(fuel_date, request_date) between p_from and p_to),
    'trips', (select count(*) from public.sorting_driver_reports where center_id = p_center and work_date between p_from and p_to),
    'trips_late', (select count(*) from public.sorting_driver_reports where center_id = p_center and status <> 'done' and work_date between p_from and p_to),
    'km', (select coalesce(sum(end_km - start_km), 0) from public.sorting_driver_reports where center_id = p_center and work_date between p_from and p_to)
  ) into v;
  return v;
end $$;

-- Route-wise (and hub-wise inside a route) totals for a period.
create or replace function public.sorting_route_report(p_center uuid, p_from date, p_to date)
returns table (route_id uuid, route_name text, hub_id uuid, hub_name text,
               to_sorting integer, to_hub integer, wrong integer, returned integer, damaged integer,
               not_received integer, disputed integer, fuel numeric, trips integer, km numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.center_zone(p_center);
begin
  if v_zone is null then raise exception 'Sorting center not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('sorting.report.view', v_zone, null) or private.has_permission('sorting.center.view', v_zone, null)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  with hubs as (
    select r.id rid, r.name rname, rh.hub_id hid, h.name hname, rh.seq
      from public.sorting_routes r join public.sorting_route_hubs rh on rh.route_id = r.id join public.hubs h on h.id = rh.hub_id
     where r.center_id = p_center and r.archived_at is null
    union
    select x.route_id, coalesce(r.name, '—'), x.hub_id, h.name, 999
      from public.sorting_handovers x left join public.sorting_routes r on r.id = x.route_id join public.hubs h on h.id = x.hub_id
     where x.center_id = p_center and x.work_date between p_from and p_to
       and not exists (select 1 from public.sorting_route_hubs rh where rh.route_id = x.route_id and rh.hub_id = x.hub_id)
  )
  select hb.rid, hb.rname, hb.hid, hb.hname,
    coalesce(sum(s.parcel_count) filter (where s.direction = 'hub_to_sorting'), 0)::int,
    coalesce(sum(s.parcel_count) filter (where s.direction = 'sorting_to_hub'), 0)::int,
    coalesce(sum(s.wrong_count), 0)::int, coalesce(sum(s.returned_count), 0)::int, coalesce(sum(s.damaged_count), 0)::int,
    (count(s.id) filter (where s.status = 'sent'))::int, (count(s.id) filter (where s.status = 'disputed'))::int,
    coalesce((select sum(f.amount) from public.sorting_fuel_requests f where f.route_id = hb.rid and f.status = 'approved'
              and coalesce(f.fuel_date, f.request_date) between p_from and p_to and (f.charge_hub_id = hb.hid or (f.charge_hub_id is null and hb.seq = (
                select min(rh2.seq) from public.sorting_route_hubs rh2 where rh2.route_id = hb.rid)))), 0),
    (select count(*) from public.sorting_driver_reports d where d.route_id = hb.rid and d.work_date between p_from and p_to
      and hb.seq = (select min(rh2.seq) from public.sorting_route_hubs rh2 where rh2.route_id = hb.rid))::int,
    coalesce((select sum(d.end_km - d.start_km) from public.sorting_driver_reports d where d.route_id = hb.rid and d.work_date between p_from and p_to
      and hb.seq = (select min(rh2.seq) from public.sorting_route_hubs rh2 where rh2.route_id = hb.rid)), 0)
  from hubs hb
  left join public.sorting_handovers s on s.center_id = p_center and s.hub_id = hb.hid
        and s.route_id is not distinct from hb.rid and s.work_date between p_from and p_to
  group by hb.rid, hb.rname, hb.hid, hb.hname, hb.seq
  order by hb.rname, hb.seq, hb.hname;
end $$;

-- Duties of one person: their own and their post's.
create or replace function public.my_duties(p_employee uuid default null)
returns table (id uuid, title text, details text, frequency text, source text)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.title, d.details, d.frequency, case when d.employee_id is not null then 'person' else 'post' end
    from public.job_duties d
   where d.archived_at is null
     and (d.employee_id = coalesce(p_employee, private.my_employee_id())
       or d.position_id = (select e.position_id from public.employees e where e.id = coalesce(p_employee, private.my_employee_id())))
   order by d.sort, d.title
$$;

-- ---------------------------------------------------------------------
-- 12. Fuel slip images
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sorting-slips', 'sorting-slips', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy sorting_slips_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'sorting-slips' and name like 'fuel/' || auth.uid()::text || '/%');
create policy sorting_slips_read on storage.objects for select to authenticated
  using (bucket_id = 'sorting-slips' and (name like 'fuel/' || auth.uid()::text || '/%'
      or exists (select 1 from public.sorting_fuel_requests f where f.slip_path = storage.objects.name)));
