-- =====================================================================
-- XZM-TEAM ERP — Migration 0035: Vehicle operations
--
--  * Crew: a vehicle has a DRIVER and a HELPER (vehicle_assignments.role). Handing a
--    vehicle to a driver still moves it to the driver's hub; a helper never moves it.
--  * Served hubs (vehicle_hubs): a big pickup works for several hubs. Those hubs'
--    managers see the vehicle and ONLY its fuel / charge costs (nothing else).
--  * Fuel submitted by the crew: status 'submitted' + slip picture → managers are
--    notified, approve or reject → "put on the sheet" creates the daily-sheet expense.
--  * Requisitions ("need the pickup on Tuesday for 300 parcels"): hub manager writes,
--    crew and managers are notified, driver accepts / starts / finishes.
--  * Day log for autos (battery / CNG): charged?, out / in time, km — the driver writes
--    it; if not, the manager does. Format fields are settings, editable by the owner.
-- =====================================================================

-- ---------------------------------------------------------------- permissions
insert into public.permissions (code, module, resource, action, description) values
  ('vehicle.log.approve',          'vehicle', 'log',         'approve', 'Approve / reject fuel and costs the crew submitted, put them on the daily sheet'),
  ('vehicle.requisition.view',     'vehicle', 'requisition', 'view',    'See vehicle requisitions'),
  ('vehicle.requisition.create',   'vehicle', 'requisition', 'create',  'Ask for a vehicle (requisition)'),
  ('vehicle.requisition.approve',  'vehicle', 'requisition', 'approve', 'Accept, assign, reject or close vehicle requisitions')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager', 'operations_manager', 'zonal_manager') and p.code in ('vehicle.log.approve', 'vehicle.requisition.view', 'vehicle.requisition.create', 'vehicle.requisition.approve'))
  or (r.code = 'hub_manager' and p.code in ('vehicle.log.approve', 'vehicle.requisition.view', 'vehicle.requisition.create', 'vehicle.requisition.approve'))
  or (r.code in ('pickup_manager', 'delivery_manager') and p.code in ('vehicle.requisition.view', 'vehicle.requisition.create'))
  or (r.code in ('accounts_manager', 'accountant') and p.code in ('vehicle.log.approve', 'vehicle.requisition.view'))
  or (r.code = 'auditor' and p.code in ('vehicle.requisition.view'))
) on conflict do nothing;

-- ---------------------------------------------------------------- crew: driver + helper
alter table public.vehicle_assignments add column if not exists role text not null default 'driver' check (role in ('driver', 'helper'));
drop index if exists public.vehicle_assign_one_holder;
create unique index if not exists vehicle_assign_one_per_role on public.vehicle_assignments (vehicle_id, role) where effective_to is null;

create or replace function private.vehicle_holder(p_vehicle uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.employee_id from public.vehicle_assignments a
   where a.vehicle_id = p_vehicle and a.effective_to is null and a.role = 'driver'
   order by a.effective_from desc limit 1
$$;
create or replace function private.vehicle_helper(p_vehicle uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.employee_id from public.vehicle_assignments a
   where a.vehicle_id = p_vehicle and a.effective_to is null and a.role = 'helper'
   order by a.effective_from desc limit 1
$$;
-- Is the caller the driver or helper of this vehicle right now?
create or replace function private.vehicle_is_crew(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vehicle_assignments a
                  where a.vehicle_id = p_vehicle and a.effective_to is null and a.employee_id = private.my_employee_id())
$$;
revoke all on function private.vehicle_helper(uuid), private.vehicle_is_crew(uuid) from public, anon;
grant execute on function private.vehicle_helper(uuid), private.vehicle_is_crew(uuid) to authenticated;

-- ---------------------------------------------------------------- served hubs
create table public.vehicle_hubs (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id),
  hub_id     uuid not null references public.hubs(id),
  zone_id    uuid not null references public.zones(id),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (vehicle_id, hub_id)
);
alter table public.vehicle_hubs enable row level security;
revoke all on public.vehicle_hubs from anon;
grant select on public.vehicle_hubs to authenticated;

-- Does the caller manage one of the hubs this vehicle serves (not its home hub)?
create or replace function private.vehicle_served_perm(p_vehicle uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vehicle_hubs vh where vh.vehicle_id = p_vehicle and private.has_permission(p_perm, vh.zone_id, vh.hub_id))
$$;
revoke all on function private.vehicle_served_perm(uuid, text) from public, anon;
grant execute on function private.vehicle_served_perm(uuid, text) to authenticated;

create or replace function private.vehicle_can_view(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle
      and (private.has_permission('vehicle.vehicle.view', v.zone_id, v.hub_id)
        or private.has_permission('da.sheet.view', v.zone_id, v.hub_id)
        or private.has_permission('ops.report.view', v.zone_id, v.hub_id)
        or private.vehicle_served_perm(v.id, 'vehicle.vehicle.view')
        or private.vehicle_served_perm(v.id, 'da.sheet.view')
        or private.vehicle_is_crew(v.id)))
$$;

create policy vehicle_hubs_read on public.vehicle_hubs for select to authenticated using (private.vehicle_can_view(vehicle_id));

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated using (private.vehicle_can_view(id));
drop policy if exists vehicle_assign_read on public.vehicle_assignments;
create policy vehicle_assign_read on public.vehicle_assignments for select to authenticated
  using (private.vehicle_can_view(vehicle_id) or employee_id = private.my_employee_id());

-- The hubs a vehicle works for (replaces the whole list)
create or replace function public.vehicle_set_hubs(p_vehicle uuid, p_hubs uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; h uuid;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('vehicle.vehicle.edit', v.zone_id, v.hub_id) then raise exception 'Not authorised to change the vehicle.' using errcode = '42501'; end if;
  delete from public.vehicle_hubs where vehicle_id = p_vehicle and not (hub_id = any (coalesce(p_hubs, '{}')));
  foreach h in array coalesce(p_hubs, '{}') loop
    if h is distinct from v.hub_id then
      insert into public.vehicle_hubs (vehicle_id, hub_id, zone_id) values (p_vehicle, h, private.hub_zone(h)) on conflict do nothing;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- hand over with a role
drop function if exists public.vehicle_assign(uuid, text, text, date, boolean);
create or replace function public.vehicle_assign(p_vehicle uuid, p_employee_code text, p_reason text,
                                                 p_from date default null, p_keep_hub boolean default false, p_role text default 'driver') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; e public.employees; v_from date := coalesce(p_from, current_date); v_id uuid;
        v_emp_hub uuid; v_new_hub uuid; v_new_zone uuid; v_moved boolean := false;
begin
  if p_role not in ('driver', 'helper') then raise exception 'Role must be driver or helper.' using errcode = '22023'; end if;
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('vehicle.holder.edit', v.zone_id, v.hub_id) or private.has_permission('da.settings.configure', v.zone_id, v.hub_id)) then
    raise exception 'Not authorised to hand over a vehicle.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  select * into e from public.employees
   where employee_code = regexp_replace(trim(p_employee_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null and status = 'active';
  if e.id is null then raise exception 'No active employee with ID %.', p_employee_code using errcode = '22023'; end if;
  if exists (select 1 from public.vehicle_assignments a where a.vehicle_id = p_vehicle and a.effective_to is null and a.employee_id = e.id and a.role <> p_role) then
    raise exception '% already has this vehicle in the other role.', e.full_name using errcode = '22023';
  end if;

  v_new_hub := v.hub_id; v_new_zone := v.zone_id;
  if p_role = 'driver' then
    v_emp_hub := private.employee_current_hub(e.id);
    if not coalesce(p_keep_hub, false) and v_emp_hub is not null and v_emp_hub is distinct from v.hub_id then
      v_new_hub := v_emp_hub; v_new_zone := coalesce(private.hub_zone(v_emp_hub), v.zone_id);
      if not (private.has_permission('vehicle.holder.edit', v_new_zone, v_new_hub) or private.has_permission('da.settings.configure', v_new_zone, v_new_hub)) then
        raise exception 'The person works at another hub you may not move vehicles to.' using errcode = '42501';
      end if;
      update public.vehicles set hub_id = v_new_hub, zone_id = v_new_zone where id = p_vehicle;
      delete from public.vehicle_hubs where vehicle_id = p_vehicle and hub_id = v_new_hub;
      v_moved := true;
    end if;
  end if;

  update public.vehicle_assignments set effective_to = v_from, end_reason = 'Handed to ' || e.full_name
   where vehicle_id = p_vehicle and effective_to is null and role = p_role;
  insert into public.vehicle_assignments (vehicle_id, employee_id, hub_id, zone_id, effective_from, reason, moved_hub, role)
  values (p_vehicle, e.id, v_new_hub, v_new_zone, v_from, trim(p_reason), v_moved, p_role)
  returning id into v_id;
  perform private.notify(e.profile_id, case when p_role = 'driver' then 'আপনার নামে গাড়ি দেওয়া হলো' else 'আপনাকে গাড়ির হেল্পার করা হলো' end,
                         v.name || coalesce(' (' || v.reg_no || ')', '') || ' · ' || trim(p_reason), '/app/vehicles/mine', 'vehicle');
  return v_id;
end $$;

drop function if exists public.vehicle_release(uuid, text);
create or replace function public.vehicle_release(p_vehicle uuid, p_reason text, p_role text default 'driver') returns void
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('vehicle.holder.edit', v.zone_id, v.hub_id) or private.has_permission('da.settings.configure', v.zone_id, v.hub_id)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.vehicle_assignments set effective_to = current_date, end_reason = trim(p_reason)
   where vehicle_id = p_vehicle and effective_to is null and role = coalesce(p_role, 'driver');
end $$;

-- ---------------------------------------------------------------- notify the managers of a vehicle
-- Everyone who holds p_perm for the vehicle's home hub or one of its served hubs (hub, zone or global grant).
create or replace function private.vehicle_notify_managers(p_vehicle uuid, p_perm text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; u uuid;
begin
  select * into v from public.vehicles where id = p_vehicle;
  for u in
    select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
    where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
      and (p.code = p_perm or r.is_super)
      and (ur.scope_type = 'global'
        or (ur.scope_type = 'zone' and ur.zone_id in (select v.zone_id union select vh.zone_id from public.vehicle_hubs vh where vh.vehicle_id = v.id))
        or (ur.scope_type = 'hub' and ur.hub_id in (select v.hub_id union select vh.hub_id from public.vehicle_hubs vh where vh.vehicle_id = v.id)))
  loop
    perform private.notify(u, p_title, p_body, p_link, 'vehicle');
  end loop;
end $$;
create or replace function private.vehicle_notify_crew(p_vehicle uuid, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = '' as $$
  select private.notify(e.profile_id, p_title, p_body, p_link, 'vehicle')
  from public.vehicle_assignments a join public.employees e on e.id = a.employee_id
  where a.vehicle_id = p_vehicle and a.effective_to is null and e.profile_id is not null
$$;

-- ---------------------------------------------------------------- logs: submitted → approved → on the sheet
alter table public.vehicle_logs
  add column if not exists status text not null default 'approved' check (status in ('submitted', 'approved', 'rejected')),
  add column if not exists slip_path text,
  add column if not exists decided_by uuid, add column if not exists decided_at timestamptz, add column if not exists decision_note text,
  add column if not exists day_log_id uuid;
alter table public.vehicle_logs drop constraint if exists vehicle_logs_kind_check;
alter table public.vehicle_logs add constraint vehicle_logs_kind_check
  check (kind in ('fuel', 'charge', 'service', 'repair', 'parts', 'tyre', 'oil', 'wash', 'toll', 'parking', 'fine', 'rent', 'paper', 'other'));
create index if not exists vehicle_logs_pending_idx on public.vehicle_logs (vehicle_id) where removed_at is null and status = 'submitted';

-- Home-hub managers see everything; served-hub managers see fuel & charge only; the crew sees their vehicle's lines.
drop policy if exists vehicle_logs_read on public.vehicle_logs;
create policy vehicle_logs_read on public.vehicle_logs for select to authenticated
  using (private.has_permission('vehicle.log.view', zone_id, hub_id)
      or private.has_permission('da.sheet.view', zone_id, hub_id)
      or (kind in ('fuel', 'charge') and (private.vehicle_served_perm(vehicle_id, 'vehicle.log.view') or private.vehicle_served_perm(vehicle_id, 'da.sheet.view')))
      or driver_id = private.my_employee_id()
      or private.vehicle_is_crew(vehicle_id));

drop function if exists public.vehicle_log_save(uuid, text, numeric, date, integer, numeric, text, text, text, text, uuid, uuid);
create or replace function public.vehicle_log_save(
  p_vehicle uuid, p_kind text, p_amount numeric, p_date date default null, p_odometer integer default null,
  p_litres numeric default null, p_vendor text default null, p_bill_no text default null, p_note text default null,
  p_driver_code text default null, p_da_expense uuid default null, p_id uuid default null, p_slip text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_id uuid; v_driver uuid; v_me uuid := private.my_employee_id(); x public.vehicle_logs;
        v_manager boolean; v_status text;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if p_kind not in ('fuel', 'charge', 'service', 'repair', 'parts', 'tyre', 'oil', 'wash', 'toll', 'parking', 'fine', 'rent', 'paper', 'other') then
    raise exception 'Unknown kind of cost.' using errcode = '22023';
  end if;
  -- A manager of the home hub writes anything; a served-hub manager writes fuel / charge; the crew submits for approval.
  v_manager := private.has_permission('vehicle.log.create', v.zone_id, v.hub_id)
            or (p_kind in ('fuel', 'charge') and private.vehicle_served_perm(v.id, 'vehicle.log.create'));
  if p_id is null then
    if not (v_manager or private.vehicle_is_crew(v.id)) then raise exception 'Not authorised to write vehicle costs.' using errcode = '42501'; end if;
    v_status := case when v_manager then 'approved' else 'submitted' end;
  else
    select * into x from public.vehicle_logs where id = p_id and removed_at is null;
    if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
    if x.da_expense_id is not null then raise exception 'This line is already on the daily sheet; correct it there.' using errcode = '42501'; end if;
    if not (private.has_permission('vehicle.log.edit', v.zone_id, v.hub_id)
            or (x.created_by = auth.uid() and x.created_at > now() - interval '24 hours' and x.status <> 'approved')
            or (x.created_by = auth.uid() and x.created_at > now() - interval '24 hours' and v_manager)) then
      raise exception 'Not authorised to change this line.' using errcode = '42501';
    end if;
    v_status := case when x.status = 'rejected' and not v_manager then 'submitted' else x.status end;
  end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount cannot be negative.' using errcode = '22023'; end if;
  if p_kind = 'fuel' and coalesce(p_litres, 0) <= 0 and coalesce(p_amount, 0) = 0 then raise exception 'Write the litres or the amount.' using errcode = '22023'; end if;
  if p_odometer is not null and p_odometer < 0 then raise exception 'Odometer cannot be negative.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_driver_code, '')), '') is not null then
    select id into v_driver from public.employees
     where employee_code = regexp_replace(trim(p_driver_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null;
    if v_driver is null then raise exception 'No employee with ID %.', p_driver_code using errcode = '22023'; end if;
  else
    v_driver := case when v_manager then private.vehicle_holder(v.id) else v_me end;
  end if;
  if p_da_expense is not null and not exists (select 1 from public.da_expenses d where d.id = p_da_expense and d.removed_at is null) then
    raise exception 'That sheet line does not exist.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, odometer, litres, amount, vendor, bill_no, driver_id, da_expense_id, note, status, slip_path)
    values (p_vehicle, v.hub_id, v.zone_id, p_kind, coalesce(p_date, current_date), p_odometer, p_litres, coalesce(p_amount, 0),
            nullif(trim(p_vendor), ''), nullif(trim(p_bill_no), ''), v_driver, p_da_expense, nullif(trim(p_note), ''), v_status, nullif(trim(p_slip), ''))
    returning id into v_id;
    if v_status = 'submitted' then
      perform private.vehicle_notify_managers(v.id, 'vehicle.log.approve', 'গাড়ির ' || case when p_kind = 'fuel' then 'তেল' when p_kind = 'charge' then 'চার্জ' else 'খরচ' end || ' জমা পড়েছে',
        v.name || coalesce(' (' || v.reg_no || ')', '') || ' · ৳' || coalesce(p_amount, 0)::text || coalesce(' · ' || p_litres::text || ' L', '') || ' · ' || private.my_display_name(),
        '/app/vehicles/logs?v=' || v.id::text);
    end if;
  else
    update public.vehicle_logs set kind = p_kind, log_date = coalesce(p_date, log_date), odometer = p_odometer, litres = p_litres,
           amount = coalesce(p_amount, 0), vendor = nullif(trim(p_vendor), ''), bill_no = nullif(trim(p_bill_no), ''),
           driver_id = v_driver, da_expense_id = coalesce(p_da_expense, da_expense_id), note = nullif(trim(p_note), ''),
           slip_path = coalesce(nullif(trim(p_slip), ''), slip_path), status = v_status
     where id = p_id returning id into v_id;
  end if;
  if p_odometer is not null and p_odometer > v.odometer then update public.vehicles set odometer = p_odometer where id = v.id; end if;
  if p_kind in ('service', 'oil') and v_status = 'approved' then
    update public.vehicles set last_service_on = greatest(coalesce(last_service_on, '1900-01-01'::date), coalesce(p_date, current_date)),
                               last_service_km = greatest(coalesce(last_service_km, 0), coalesce(p_odometer, last_service_km, 0))
     where id = v.id;
  end if;
  return v_id;
end $$;

create or replace function public.vehicle_log_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.vehicle_logs; v public.vehicles;
begin
  select * into x from public.vehicle_logs where id = p_id and removed_at is null;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  if x.da_expense_id is not null and not private.has_permission('vehicle.log.edit', v.zone_id, v.hub_id) then
    raise exception 'This line is on the daily sheet; remove it there first.' using errcode = '42501';
  end if;
  if not (private.has_permission('vehicle.log.edit', v.zone_id, v.hub_id)
          or (x.created_by = auth.uid() and x.created_at > now() - interval '24 hours' and x.da_expense_id is null)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.vehicle_logs set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
end $$;

-- Approve or reject what the crew submitted
create or replace function public.vehicle_log_decide(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.vehicle_logs; v public.vehicles; e public.employees;
begin
  select * into x from public.vehicle_logs where id = p_id and removed_at is null;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  if not (private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id)
          or (x.kind in ('fuel', 'charge') and private.vehicle_served_perm(v.id, 'vehicle.log.approve'))) then
    raise exception 'Not authorised to approve vehicle costs.' using errcode = '42501';
  end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write why it is rejected.' using errcode = '22023'; end if;
  update public.vehicle_logs set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
  if p_approve and x.kind in ('service', 'oil') then
    update public.vehicles set last_service_on = greatest(coalesce(last_service_on, '1900-01-01'::date), x.log_date),
                               last_service_km = greatest(coalesce(last_service_km, 0), coalesce(x.odometer, last_service_km, 0)) where id = v.id;
  end if;
  select * into e from public.employees where id = x.driver_id;
  perform private.notify(e.profile_id, case when p_approve then 'তেল / খরচ অনুমোদন হলো' else 'তেল / খরচ বাতিল হলো' end,
    v.name || ' · ৳' || x.amount::text || coalesce(' · ' || nullif(trim(p_note), ''), ''), '/app/vehicles/mine', 'vehicle');
end $$;

-- Put an approved line on the hub's daily sheet (today's sheet, or the date given), as a transport expense.
create or replace function public.vehicle_log_to_sheet(p_id uuid, p_hub uuid default null, p_date date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare x public.vehicle_logs; v public.vehicles; v_hub uuid; v_date date; v_session uuid; v_exp uuid; v_cat text; v_name text; e public.employees;
begin
  select * into x from public.vehicle_logs where id = p_id and removed_at is null;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  if x.status <> 'approved' then raise exception 'Approve the line first.' using errcode = '22023'; end if;
  if x.da_expense_id is not null then raise exception 'Already on the sheet.' using errcode = '23505'; end if;
  if coalesce(x.amount, 0) <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  v_hub := coalesce(p_hub, x.hub_id, v.hub_id);
  if v_hub is distinct from v.hub_id and not exists (select 1 from public.vehicle_hubs vh where vh.vehicle_id = v.id and vh.hub_id = v_hub) then
    raise exception 'This vehicle does not work for that hub.' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, private.da_today());
  select id into v_session from public.da_sessions where hub_id = v_hub and account_date = v_date;
  if v_session is null then v_session := public.da_start_session(v_hub, v_date); end if;
  v_cat := case when x.kind in ('fuel', 'charge') then 'fuel' when x.kind in ('repair', 'service', 'parts', 'tyre', 'oil') then 'repair' else 'transport' end;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = v_cat) then v_cat := 'transport'; end if;
  select * into e from public.employees where id = x.driver_id;
  v_name := case x.kind when 'fuel' then 'তেল' when 'charge' then 'চার্জ' when 'service' then 'সার্ভিসিং' when 'repair' then 'মেরামত' when 'parts' then 'পার্টস'
                        when 'tyre' then 'টায়ার' when 'oil' then 'ইঞ্জিন অয়েল' when 'wash' then 'ওয়াশ' when 'toll' then 'টোল' when 'parking' then 'পার্কিং'
                        when 'fine' then 'জরিমানা' when 'rent' then 'গাড়ি ভাড়া' when 'paper' then 'কাগজপত্র' else 'গাড়ির খরচ' end
            || ' — ' || v.name || coalesce(' (' || v.reg_no || ')', '');
  v_exp := public.da_save_expense(v_session, 'transport', null, v_name, v_cat, x.amount, least(x.log_date, private.da_today()),
             x.bill_no, null, null, e.employee_code::text, null, false, null,
             concat_ws(' · ', nullif(x.vendor, ''), case when x.litres is not null then x.litres::text || ' L' end, case when x.odometer is not null then x.odometer::text || ' km' end, x.note,
                       case when x.slip_path is not null then 'স্লিপ: গাড়ি মডিউলে' end));
  perform public.da_set_expense_reference(v_exp, null, null, null, v.id);
  update public.vehicle_logs set da_expense_id = v_exp where id = p_id;
  return v_exp;
end $$;

-- ---------------------------------------------------------------- requisitions
create sequence if not exists public.vehicle_requisition_seq;
create table public.vehicle_requisitions (
  id            uuid primary key default gen_random_uuid(),
  no            text not null unique,
  hub_id        uuid not null references public.hubs(id),      -- who asks
  zone_id       uuid not null references public.zones(id),
  vehicle_id    uuid references public.vehicles(id),           -- which vehicle (may be chosen later)
  work_date     date not null,
  work_time     text,
  job           text not null check (length(trim(job)) > 0),
  from_text     text, to_text text,
  parcels       integer check (parcels is null or parcels >= 0),
  weight        text,
  data          jsonb not null default '{}'::jsonb,
  note          text,
  status        text not null default 'open' check (status in ('open', 'accepted', 'started', 'done', 'rejected', 'cancelled')),
  driver_id     uuid references public.employees(id),
  decided_by    uuid, decided_at timestamptz, decision_note text,
  started_at    timestamptz, done_at timestamptz,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create index vehicle_requisitions_hub_idx on public.vehicle_requisitions (hub_id, work_date desc);
create index vehicle_requisitions_vehicle_idx on public.vehicle_requisitions (vehicle_id, work_date desc);
create table public.vehicle_requisition_events (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.vehicle_requisitions(id),
  status text not null, note text, by_name text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index vehicle_requisition_events_idx on public.vehicle_requisition_events (requisition_id, created_at);
create trigger vehicle_requisitions_stamp before insert or update on public.vehicle_requisitions for each row execute function private.stamp_row();
create trigger vehicle_requisitions_audit after insert or update or delete on public.vehicle_requisitions for each row execute function private.audit_row('ops');
create trigger vehicle_requisitions_no_delete before delete on public.vehicle_requisitions for each row execute function private.prevent_delete();
alter table public.vehicle_requisitions enable row level security;
alter table public.vehicle_requisition_events enable row level security;
revoke all on public.vehicle_requisitions, public.vehicle_requisition_events from anon;
grant select on public.vehicle_requisitions, public.vehicle_requisition_events to authenticated;

create or replace function private.vehicle_req_can_view(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vehicle_requisitions q where q.id = p_id
    and (q.created_by = auth.uid()
      or private.has_permission('vehicle.requisition.view', q.zone_id, q.hub_id)
      or private.has_permission('vehicle.requisition.approve', q.zone_id, q.hub_id)
      or (q.vehicle_id is not null and (private.vehicle_is_crew(q.vehicle_id)
            or exists (select 1 from public.vehicles v where v.id = q.vehicle_id and private.has_permission('vehicle.requisition.approve', v.zone_id, v.hub_id))))
      or (q.vehicle_id is null and private.has_permission_within_zone('vehicle.requisition.approve', q.zone_id))
      or q.driver_id = private.my_employee_id()))
$$;
create or replace function private.vehicle_req_can_decide(q public.vehicle_requisitions) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission('vehicle.requisition.approve', q.zone_id, q.hub_id)
      or (q.vehicle_id is not null and exists (select 1 from public.vehicles v where v.id = q.vehicle_id and private.has_permission('vehicle.requisition.approve', v.zone_id, v.hub_id)))
      or (q.vehicle_id is null and private.has_permission_within_zone('vehicle.requisition.approve', q.zone_id))
$$;
revoke all on function private.vehicle_req_can_view(uuid), private.vehicle_req_can_decide(public.vehicle_requisitions) from public, anon;
grant execute on function private.vehicle_req_can_view(uuid), private.vehicle_req_can_decide(public.vehicle_requisitions) to authenticated;
create policy vehicle_requisitions_read on public.vehicle_requisitions for select to authenticated using (private.vehicle_req_can_view(id));
create policy vehicle_requisition_events_read on public.vehicle_requisition_events for select to authenticated using (private.vehicle_req_can_view(requisition_id));

create or replace function public.vehicle_requisition_submit(
  p_hub uuid, p_work_date date, p_job text, p_vehicle uuid default null, p_work_time text default null,
  p_from text default null, p_to text default null, p_parcels integer default null, p_weight text default null,
  p_data jsonb default '{}'::jsonb, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub); v_id uuid; v_no text; v public.vehicles; h public.hubs;
begin
  if v_zone is null then raise exception 'Choose the hub.' using errcode = '22023'; end if;
  if not private.has_permission('vehicle.requisition.create', v_zone, p_hub) then raise exception 'Not authorised to ask for a vehicle.' using errcode = '42501'; end if;
  if p_work_date is null or p_work_date < current_date - 1 then raise exception 'Choose the day of the work.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_job, ''))) = 0 then raise exception 'Write what the vehicle is for.' using errcode = '22023'; end if;
  if p_vehicle is not null then
    select * into v from public.vehicles where id = p_vehicle and archived_at is null;
    if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  end if;
  select * into h from public.hubs where id = p_hub;
  v_no := 'VR-' || lpad(nextval('public.vehicle_requisition_seq')::text, 5, '0');
  insert into public.vehicle_requisitions (no, hub_id, zone_id, vehicle_id, work_date, work_time, job, from_text, to_text, parcels, weight, data, note, driver_id)
  values (v_no, p_hub, v_zone, p_vehicle, p_work_date, nullif(trim(p_work_time), ''), trim(p_job), nullif(trim(p_from), ''), nullif(trim(p_to), ''),
          p_parcels, nullif(trim(p_weight), ''), coalesce(p_data, '{}'::jsonb), nullif(trim(p_note), ''), case when v.id is not null then private.vehicle_holder(v.id) end)
  returning id into v_id;
  insert into public.vehicle_requisition_events (requisition_id, status, note, by_name) values (v_id, 'open', nullif(trim(p_note), ''), private.my_display_name());
  if v.id is not null then
    perform private.vehicle_notify_crew(v.id, 'গাড়ি লাগবে: ' || h.name, v_no || ' · ' || to_char(p_work_date, 'DD/MM') || coalesce(' ' || p_work_time, '') || ' · ' || trim(p_job), '/app/vehicles/requests?id=' || v_id::text);
    perform private.vehicle_notify_managers(v.id, 'vehicle.requisition.approve', 'গাড়ির রিকুইজিশন: ' || h.name, v_no || ' · ' || v.name || ' · ' || to_char(p_work_date, 'DD/MM') || ' · ' || trim(p_job), '/app/vehicles/requests?id=' || v_id::text);
  else
    -- No vehicle named: tell everyone who may assign one in this zone.
    perform private.notify(u.user_id, 'গাড়ির রিকুইজিশন: ' || h.name, v_no || ' · ' || to_char(p_work_date, 'DD/MM') || ' · ' || trim(p_job), '/app/vehicles/requests?id=' || v_id::text, 'vehicle')
    from (select distinct ur.user_id from public.user_roles ur
            join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
            left join public.role_permissions rp on rp.role_id = r.id left join public.permissions p on p.id = rp.permission_id
           where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
             and (p.code = 'vehicle.requisition.approve' or r.is_super)
             and (ur.scope_type = 'global' or (ur.scope_type = 'zone' and ur.zone_id = v_zone)
               or (ur.scope_type = 'hub' and ur.hub_id in (select id from public.hubs where zone_id = v_zone)))) u;
  end if;
  return v_id;
end $$;

-- accepted (optionally naming the vehicle / driver) · started · done · rejected · cancelled
create or replace function public.vehicle_requisition_update(p_id uuid, p_status text, p_note text default null, p_vehicle uuid default null, p_driver_code text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.vehicle_requisitions; v public.vehicles; v_driver uuid; v_crew boolean; v_decider boolean; h public.hubs; v_title text;
begin
  select * into q from public.vehicle_requisitions where id = p_id for update;
  if q.id is null then raise exception 'Requisition not found.' using errcode = 'P0002'; end if;
  if p_status not in ('accepted', 'started', 'done', 'rejected', 'cancelled') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if q.status in ('done', 'rejected', 'cancelled') then raise exception 'This requisition is closed.' using errcode = '22023'; end if;
  if p_vehicle is not null then
    select * into v from public.vehicles where id = p_vehicle and archived_at is null;
    if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
    q.vehicle_id := v.id;
  elsif q.vehicle_id is not null then
    select * into v from public.vehicles where id = q.vehicle_id;
  end if;
  v_crew := q.vehicle_id is not null and private.vehicle_is_crew(q.vehicle_id);
  v_decider := private.vehicle_req_can_decide(q);
  if p_status = 'cancelled' then
    if not (q.created_by = auth.uid() or v_decider) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  elsif p_status = 'rejected' then
    if not v_decider then raise exception 'Not authorised.' using errcode = '42501'; end if;
    if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  else
    if not (v_decider or v_crew) then raise exception 'Not authorised.' using errcode = '42501'; end if;
    if p_status in ('accepted', 'started') and q.vehicle_id is null then raise exception 'Choose the vehicle first.' using errcode = '22023'; end if;
  end if;
  if nullif(trim(coalesce(p_driver_code, '')), '') is not null then
    select id into v_driver from public.employees where employee_code = regexp_replace(trim(p_driver_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null;
    if v_driver is null then raise exception 'No employee with ID %.', p_driver_code using errcode = '22023'; end if;
  else
    v_driver := coalesce(q.driver_id, case when v_crew then private.my_employee_id() end, case when v.id is not null then private.vehicle_holder(v.id) end);
  end if;
  update public.vehicle_requisitions
     set status = p_status, vehicle_id = q.vehicle_id, driver_id = v_driver,
         decided_by = case when p_status in ('accepted', 'rejected') then auth.uid() else decided_by end,
         decided_at = case when p_status in ('accepted', 'rejected') then now() else decided_at end,
         decision_note = case when p_status in ('accepted', 'rejected', 'cancelled') then nullif(trim(p_note), '') else decision_note end,
         started_at = case when p_status = 'started' then now() else started_at end,
         done_at = case when p_status = 'done' then now() else done_at end
   where id = p_id;
  insert into public.vehicle_requisition_events (requisition_id, status, note, by_name) values (p_id, p_status, nullif(trim(p_note), ''), private.my_display_name());
  select * into h from public.hubs where id = q.hub_id;
  v_title := q.no || ' ' || case p_status when 'accepted' then 'গ্রহণ হয়েছে' when 'started' then 'গাড়ি রওনা দিয়েছে' when 'done' then 'কাজ শেষ' when 'rejected' then 'বাতিল (না)' else 'বাতিল' end;
  perform private.notify(q.created_by, v_title, coalesce(v.name, '') || coalesce(' · ' || nullif(trim(p_note), ''), ''), '/app/vehicles/requests?id=' || p_id::text, 'vehicle');
  if q.vehicle_id is not null and p_status in ('accepted', 'cancelled', 'rejected') then
    perform private.vehicle_notify_crew(q.vehicle_id, v_title || ' — ' || h.name, to_char(q.work_date, 'DD/MM') || coalesce(' ' || q.work_time, '') || ' · ' || q.job, '/app/vehicles/requests?id=' || p_id::text);
  end if;
  if p_status in ('started', 'done') and q.vehicle_id is not null then
    perform private.vehicle_notify_managers(q.vehicle_id, 'vehicle.requisition.approve', v_title || ' — ' || h.name, q.job, '/app/vehicles/requests?id=' || p_id::text);
  end if;
end $$;

create or replace function public.vehicle_requisition_list(p_hub uuid default null, p_from date default null, p_to date default null)
returns table (id uuid, no text, hub_id uuid, hub_name text, vehicle_id uuid, vehicle text, work_date date, work_time text, job text, from_text text, to_text text,
               parcels integer, weight text, data jsonb, note text, status text, driver_id uuid, driver_name text, driver_code text,
               requested_by_name text, decision_note text, started_at timestamptz, done_at timestamptz, created_at timestamptz,
               can_decide boolean, is_crew boolean, is_mine boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select q.id, q.no, q.hub_id, h.name, q.vehicle_id, case when v.id is not null then v.name || coalesce(' (' || v.reg_no || ')', '') end,
         q.work_date, q.work_time, q.job, q.from_text, q.to_text, q.parcels, q.weight, q.data, q.note, q.status,
         q.driver_id, e.full_name, e.employee_code::text,
         coalesce(pr.full_name, pr.email::text), q.decision_note, q.started_at, q.done_at, q.created_at,
         private.vehicle_req_can_decide(q), q.vehicle_id is not null and private.vehicle_is_crew(q.vehicle_id), q.created_by = auth.uid()
  from public.vehicle_requisitions q
  join public.hubs h on h.id = q.hub_id
  left join public.vehicles v on v.id = q.vehicle_id
  left join public.employees e on e.id = q.driver_id
  left join public.profiles pr on pr.id = q.created_by
  where private.vehicle_req_can_view(q.id)
    and (p_hub is null or q.hub_id = p_hub or v.hub_id = p_hub or exists (select 1 from public.vehicle_hubs vh where vh.vehicle_id = q.vehicle_id and vh.hub_id = p_hub))
    and (p_from is null or q.work_date >= p_from) and (p_to is null or q.work_date <= p_to)
  order by case q.status when 'open' then 0 when 'accepted' then 1 when 'started' then 2 else 3 end, q.work_date, q.created_at;
end $$;

-- ---------------------------------------------------------------- day log (autos): charged? out / in, km
create table public.vehicle_day_logs (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id),
  hub_id      uuid references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  log_date    date not null default current_date,
  driver_id   uuid references public.employees(id),
  charged     boolean,
  charge_place text,
  charge_cost numeric(12,2) check (charge_cost is null or charge_cost >= 0),
  out_at      time, in_at time,
  start_km    integer check (start_km is null or start_km >= 0),
  end_km      integer check (end_km is null or end_km >= 0),
  trips       integer check (trips is null or trips >= 0),
  data        jsonb not null default '{}'::jsonb,
  note        text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  unique (vehicle_id, log_date)
);
create trigger vehicle_day_logs_stamp before insert or update on public.vehicle_day_logs for each row execute function private.stamp_row();
create trigger vehicle_day_logs_audit after insert or update or delete on public.vehicle_day_logs for each row execute function private.audit_row('ops');
alter table public.vehicle_day_logs enable row level security;
revoke all on public.vehicle_day_logs from anon;
grant select on public.vehicle_day_logs to authenticated;
create policy vehicle_day_logs_read on public.vehicle_day_logs for select to authenticated using (private.vehicle_can_view(vehicle_id));

create or replace function public.vehicle_day_save(
  p_vehicle uuid, p_date date default null, p_charged boolean default null, p_charge_place text default null, p_charge_cost numeric default null,
  p_out time default null, p_in time default null, p_start_km integer default null, p_end_km integer default null, p_trips integer default null,
  p_data jsonb default '{}'::jsonb, p_note text default null, p_driver_code text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_date date := coalesce(p_date, private.da_today()); v_id uuid; v_driver uuid; v_manager boolean; v_log uuid; v_status text;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  v_manager := private.has_permission('vehicle.log.create', v.zone_id, v.hub_id) or private.vehicle_served_perm(v.id, 'vehicle.log.create');
  if not (v_manager or private.vehicle_is_crew(v.id)) then raise exception 'Not authorised to write the day log.' using errcode = '42501'; end if;
  if v_date > private.da_today() then raise exception 'The date cannot be in the future.' using errcode = '22023'; end if;
  if p_start_km is not null and p_end_km is not null and p_end_km < p_start_km then raise exception 'End km cannot be less than start km.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_driver_code, '')), '') is not null then
    select id into v_driver from public.employees where employee_code = regexp_replace(trim(p_driver_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null;
    if v_driver is null then raise exception 'No employee with ID %.', p_driver_code using errcode = '22023'; end if;
  else
    v_driver := coalesce(case when not v_manager then private.my_employee_id() end, private.vehicle_holder(v.id));
  end if;
  insert into public.vehicle_day_logs (vehicle_id, hub_id, zone_id, log_date, driver_id, charged, charge_place, charge_cost, out_at, in_at, start_km, end_km, trips, data, note)
  values (p_vehicle, v.hub_id, v.zone_id, v_date, v_driver, p_charged, nullif(trim(p_charge_place), ''), p_charge_cost, p_out, p_in, p_start_km, p_end_km, p_trips, coalesce(p_data, '{}'::jsonb), nullif(trim(p_note), ''))
  on conflict (vehicle_id, log_date) do update
    set driver_id = coalesce(excluded.driver_id, public.vehicle_day_logs.driver_id), charged = excluded.charged, charge_place = excluded.charge_place, charge_cost = excluded.charge_cost,
        out_at = excluded.out_at, in_at = excluded.in_at, start_km = excluded.start_km, end_km = excluded.end_km, trips = excluded.trips, data = excluded.data, note = excluded.note
  returning id into v_id;
  if p_end_km is not null and p_end_km > v.odometer then update public.vehicles set odometer = p_end_km where id = v.id; end if;
  -- The charge cost is a vehicle cost too: one 'charge' line per day log, kept in step.
  select id into v_log from public.vehicle_logs where day_log_id = v_id and removed_at is null;
  if coalesce(p_charge_cost, 0) > 0 then
    v_status := case when v_manager then 'approved' else 'submitted' end;
    if v_log is null then
      insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, odometer, amount, vendor, driver_id, note, status, day_log_id)
      values (p_vehicle, v.hub_id, v.zone_id, 'charge', v_date, p_end_km, p_charge_cost, nullif(trim(p_charge_place), ''), v_driver, 'দিনের খাতা থেকে', v_status, v_id)
      returning id into v_log;
      if v_status = 'submitted' then
        perform private.vehicle_notify_managers(v.id, 'vehicle.log.approve', 'অটোর চার্জ খরচ জমা পড়েছে', v.name || ' · ৳' || p_charge_cost::text || ' · ' || private.my_display_name(), '/app/vehicles/logs?v=' || v.id::text);
      end if;
    else
      update public.vehicle_logs set amount = p_charge_cost, vendor = nullif(trim(p_charge_place), ''), odometer = p_end_km, log_date = v_date
       where id = v_log and da_expense_id is null;
    end if;
  elsif v_log is not null then
    update public.vehicle_logs set removed_at = now(), removed_by = auth.uid(), remove_reason = 'দিনের খাতা থেকে চার্জ খরচ সরানো হলো' where id = v_log and da_expense_id is null;
  end if;
  return v_id;
end $$;

create or replace function public.vehicle_day_list(p_vehicle uuid default null, p_from date default null, p_to date default null, p_hub uuid default null)
returns table (id uuid, vehicle_id uuid, vehicle text, hub_name text, log_date date, driver_id uuid, driver_name text, charged boolean, charge_place text, charge_cost numeric,
               out_at time, in_at time, start_km integer, end_km integer, trips integer, data jsonb, note text, created_by uuid, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select d.id, d.vehicle_id, v.name || coalesce(' (' || v.reg_no || ')', ''), h.name, d.log_date, d.driver_id, e.full_name, d.charged, d.charge_place, d.charge_cost,
         d.out_at, d.in_at, d.start_km, d.end_km, d.trips, d.data, d.note, d.created_by, d.updated_at
  from public.vehicle_day_logs d join public.vehicles v on v.id = d.vehicle_id left join public.hubs h on h.id = v.hub_id left join public.employees e on e.id = d.driver_id
  where private.vehicle_can_view(d.vehicle_id)
    and (p_vehicle is null or d.vehicle_id = p_vehicle)
    and (p_hub is null or v.hub_id = p_hub or exists (select 1 from public.vehicle_hubs vh where vh.vehicle_id = v.id and vh.hub_id = p_hub))
    and (p_from is null or d.log_date >= p_from) and (p_to is null or d.log_date <= p_to)
  order by d.log_date desc, v.name;
end $$;

-- ---------------------------------------------------------------- settings: formats the owner can edit
insert into public.system_settings (key, value, description) values
  ('vehicle.requisition_format', '[{"key":"parcels","label":"পার্সেল (আনুমানিক)","type":"number"},{"key":"weight","label":"ওজন / মালের বিবরণ","type":"text"},{"key":"contact","label":"যোগাযোগের মোবাইল","type":"phone"}]',
   'Vehicles: extra fields on a requisition (date, time, hub, vehicle and job are always there)'),
  ('vehicle.day_format', '[{"key":"battery","label":"ব্যাটারির অবস্থা","type":"select","options":["ফুল","অর্ধেক","কম"]},{"key":"problem","label":"কোনো সমস্যা?","type":"textarea"}]',
   'Vehicles: extra fields on the day log (charged, out / in time, km and trips are always there)')
on conflict (key) do nothing;

create or replace function public.vehicle_configure(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('vehicle.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if p_key not in ('doc_alert_days', 'service_interval_km', 'fuel_price', 'requisition_format', 'day_format') then raise exception 'Unknown setting.' using errcode = '22023'; end if;
  if p_key in ('requisition_format', 'day_format') and jsonb_typeof(p_value) <> 'array' then raise exception 'The format must be a list of fields.' using errcode = '22023'; end if;
  insert into public.system_settings (key, value, description) values ('vehicle.' || p_key, p_value, 'Vehicles setting')
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------------------------------------------------------------- overview: crew, served hubs, pending lines
drop function if exists public.vehicle_overview(uuid);
create or replace function public.vehicle_overview(p_hub uuid default null)
returns table (id uuid, code text, name text, kind text, reg_no text, model text, fuel_type text, owner_type text, status text,
               hub_id uuid, hub_name text, hub_code text, zone_id uuid, zone_name text,
               holder_id uuid, holder_code text, holder_name text, holder_mobile text, since date,
               helper_id uuid, helper_code text, helper_name text,
               served_hub_ids uuid[], served_hubs text,
               odometer integer, last_service_km integer, last_service_on date, service_interval_km integer, km_since_service integer, service_due boolean,
               spent_30d numeric, fuel_30d numeric, litres_30d numeric, spent_month numeric, last_log date, pending_logs integer,
               docs_total integer, docs_expired integer, docs_expiring integer, next_expiry date, next_expiry_kind text,
               is_crew boolean, home_manager boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := coalesce((select (value)::text::integer from public.system_settings where key = 'vehicle.doc_alert_days'), 30);
        v_interval integer := coalesce((select (value)::text::integer from public.system_settings where key = 'vehicle.service_interval_km'), 3000);
begin
  return query
  select v.id, v.code::text, v.name, v.kind, v.reg_no, v.model, v.fuel_type, v.owner_type, v.status,
         v.hub_id, h.name, h.code::text, v.zone_id, z.name,
         e.id, e.employee_code::text, e.full_name, e.mobile, a.effective_from,
         e2.id, e2.employee_code::text, e2.full_name,
         sh.ids, sh.names,
         v.odometer, v.last_service_km, v.last_service_on, coalesce(v.service_interval_km, v_interval),
         greatest(v.odometer - coalesce(v.last_service_km, 0), 0),
         (v.odometer - coalesce(v.last_service_km, 0)) >= coalesce(v.service_interval_km, v_interval),
         coalesce(l.spent_30d, 0), coalesce(l.fuel_30d, 0), coalesce(l.litres_30d, 0), coalesce(l.spent_month, 0), l.last_log, coalesce(l.pending, 0)::integer,
         coalesce(d.total, 0)::integer, coalesce(d.expired, 0)::integer, coalesce(d.expiring, 0)::integer, d.next_expiry, d.next_kind,
         (e.id is not null and e.id = private.my_employee_id()) or (e2.id is not null and e2.id = private.my_employee_id()),
         private.has_permission('vehicle.vehicle.view', v.zone_id, v.hub_id) or private.has_permission('da.sheet.view', v.zone_id, v.hub_id)
  from public.vehicles v
  left join public.hubs h on h.id = v.hub_id
  left join public.zones z on z.id = v.zone_id
  left join public.vehicle_assignments a on a.vehicle_id = v.id and a.effective_to is null and a.role = 'driver'
  left join public.employees e on e.id = a.employee_id
  left join public.vehicle_assignments a2 on a2.vehicle_id = v.id and a2.effective_to is null and a2.role = 'helper'
  left join public.employees e2 on e2.id = a2.employee_id
  left join lateral (
    select array_agg(vh.hub_id order by hh.name) as ids, string_agg(hh.name || ' #' || hh.code, ', ' order by hh.name) as names
    from public.vehicle_hubs vh join public.hubs hh on hh.id = vh.hub_id where vh.vehicle_id = v.id) sh on true
  left join lateral (
    select sum(x.amount) filter (where x.status = 'approved' and x.log_date >= current_date - 30) as spent_30d,
           sum(x.amount) filter (where x.status = 'approved' and x.kind in ('fuel', 'charge') and x.log_date >= current_date - 30) as fuel_30d,
           sum(x.litres) filter (where x.status = 'approved' and x.kind = 'fuel' and x.log_date >= current_date - 30) as litres_30d,
           sum(x.amount) filter (where x.status = 'approved' and x.log_date >= date_trunc('month', current_date)::date) as spent_month,
           max(x.log_date) as last_log,
           count(*) filter (where x.status = 'submitted') as pending
    from public.vehicle_logs x where x.vehicle_id = v.id and x.removed_at is null) l on true
  left join lateral (
    select count(*) as total,
           count(*) filter (where dd.expires_on < current_date) as expired,
           count(*) filter (where dd.expires_on >= current_date and dd.expires_on <= current_date + v_days) as expiring,
           min(dd.expires_on) filter (where dd.expires_on >= current_date) as next_expiry,
           (array_agg(dd.kind order by dd.expires_on) filter (where dd.expires_on >= current_date))[1] as next_kind
    from public.vehicle_documents dd where dd.vehicle_id = v.id and dd.archived_at is null) d on true
  where v.archived_at is null
    and (p_hub is null or v.hub_id = p_hub or exists (select 1 from public.vehicle_hubs vh where vh.vehicle_id = v.id and vh.hub_id = p_hub))
    and private.vehicle_can_view(v.id)
  order by v.status, h.name, v.name;
end $$;

-- Logs listed under a vehicle: status, slip, who decided
drop function if exists public.vehicle_log_list(uuid, date, date);
create or replace function public.vehicle_log_list(p_vehicle uuid, p_from date default null, p_to date default null)
returns table (id uuid, kind text, log_date date, odometer integer, litres numeric, amount numeric, vendor text, bill_no text,
               driver_id uuid, driver_name text, driver_code text, da_expense_id uuid, note text, created_by uuid, created_at timestamptz, mine boolean,
               status text, slip_path text, decision_note text, decided_at timestamptz, can_approve boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v public.vehicles; v_home boolean; v_served boolean; v_crew boolean; v_appr boolean;
begin
  if not private.vehicle_can_view(p_vehicle) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  select * into v from public.vehicles vv where vv.id = p_vehicle;
  v_home := private.has_permission('vehicle.log.view', v.zone_id, v.hub_id) or private.has_permission('da.sheet.view', v.zone_id, v.hub_id);
  v_served := private.vehicle_served_perm(v.id, 'vehicle.log.view') or private.vehicle_served_perm(v.id, 'da.sheet.view');
  v_crew := private.vehicle_is_crew(v.id);
  v_appr := private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id);
  return query
  select x.id, x.kind, x.log_date, x.odometer, x.litres, x.amount, x.vendor, x.bill_no,
         x.driver_id, e.full_name, e.employee_code::text, x.da_expense_id, x.note, x.created_by, x.created_at,
         x.created_by = auth.uid() and x.created_at > now() - interval '24 hours' and x.da_expense_id is null,
         x.status, x.slip_path, x.decision_note, x.decided_at,
         v_appr or (x.kind in ('fuel', 'charge') and private.vehicle_served_perm(v.id, 'vehicle.log.approve'))
  from public.vehicle_logs x left join public.employees e on e.id = x.driver_id
  where x.vehicle_id = p_vehicle and x.removed_at is null
    and (v_home or v_crew or x.driver_id = private.my_employee_id() or (v_served and x.kind in ('fuel', 'charge')))
    and (p_from is null or x.log_date >= p_from) and (p_to is null or x.log_date <= p_to)
  order by case x.status when 'submitted' then 0 else 1 end, x.log_date desc, x.created_at desc;
end $$;

-- Everything waiting for a decision across the hubs the caller manages
create or replace function public.vehicle_pending(p_hub uuid default null)
returns table (id uuid, vehicle_id uuid, vehicle text, hub_name text, kind text, log_date date, litres numeric, amount numeric, vendor text, slip_path text,
               driver_name text, driver_code text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select x.id, v.id, v.name || coalesce(' (' || v.reg_no || ')', ''), h.name, x.kind, x.log_date, x.litres, x.amount, x.vendor, x.slip_path,
         e.full_name, e.employee_code::text, x.note, x.created_at
  from public.vehicle_logs x join public.vehicles v on v.id = x.vehicle_id left join public.hubs h on h.id = v.hub_id left join public.employees e on e.id = x.driver_id
  where x.removed_at is null and x.status = 'submitted' and v.archived_at is null
    and (p_hub is null or v.hub_id = p_hub or exists (select 1 from public.vehicle_hubs vh where vh.vehicle_id = v.id and vh.hub_id = p_hub))
    and (private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id) or (x.kind in ('fuel', 'charge') and private.vehicle_served_perm(v.id, 'vehicle.log.approve')))
  order by x.created_at;
end $$;

-- Assignment history now shows the role
drop function if exists public.vehicle_history(uuid);
create or replace function public.vehicle_history(p_vehicle uuid)
returns table (id uuid, employee_id uuid, employee_code text, full_name text, hub_name text, effective_from date, effective_to date, reason text, end_reason text, moved_hub boolean, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.vehicle_can_view(p_vehicle) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  return query
  select a.id, a.employee_id, e.employee_code::text, e.full_name, h.name, a.effective_from, a.effective_to, a.reason, a.end_reason, a.moved_hub, a.role
  from public.vehicle_assignments a join public.employees e on e.id = a.employee_id left join public.hubs h on h.id = a.hub_id
  where a.vehicle_id = p_vehicle order by a.effective_from desc, a.created_at desc;
end $$;

-- Crew may upload a fuel slip for their own vehicle (the bucket policy only allowed paper-keepers).
create or replace function private.vehicle_can_upload_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vehicles v where v.id = private.vehicle_object_id(p_name) and v.archived_at is null
                   and (private.has_permission('vehicle.document.edit', v.zone_id, v.hub_id)
                     or private.has_permission('vehicle.log.create', v.zone_id, v.hub_id)
                     or private.vehicle_served_perm(v.id, 'vehicle.log.create')
                     or private.vehicle_is_crew(v.id)))
$$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.vehicle_set_hubs(uuid, uuid[])', 'public.vehicle_assign(uuid, text, text, date, boolean, text)', 'public.vehicle_release(uuid, text, text)',
    'public.vehicle_log_save(uuid, text, numeric, date, integer, numeric, text, text, text, text, uuid, uuid, text)', 'public.vehicle_log_remove(uuid, text)',
    'public.vehicle_log_decide(uuid, boolean, text)', 'public.vehicle_log_to_sheet(uuid, uuid, date)',
    'public.vehicle_requisition_submit(uuid, date, text, uuid, text, text, text, integer, text, jsonb, text)',
    'public.vehicle_requisition_update(uuid, text, text, uuid, text)', 'public.vehicle_requisition_list(uuid, date, date)',
    'public.vehicle_day_save(uuid, date, boolean, text, numeric, time, time, integer, integer, integer, jsonb, text, text)', 'public.vehicle_day_list(uuid, date, date, uuid)',
    'public.vehicle_configure(text, jsonb)', 'public.vehicle_overview(uuid)', 'public.vehicle_log_list(uuid, date, date)', 'public.vehicle_pending(uuid)', 'public.vehicle_history(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.vehicle_notify_managers(uuid, text, text, text, text), private.vehicle_notify_crew(uuid, text, text, text) from public, anon, authenticated;
