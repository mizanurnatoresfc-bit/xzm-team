-- =====================================================================
-- XZM-TEAM ERP — Migration: active / inactive from the zonal panel, transfer fixes
--
--  Audit of hub transfer and active / inactive:
--  * Zonal managers could move staff between hubs but not switch a person
--    between active and inactive, so an ID ACTIVE / ID INACTIVE request they
--    marked done failed with "not authorised". New permission hr.status.edit:
--    only active <-> inactive, within scope. Resignation still needs
--    hr.employee.edit; dismissal and taking a leaver back still need
--    hr.employee.approve.
--  * A plain "transfer" to the hub the person is already in is refused: it
--    only left an empty row in the assignment history.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('hr.status.edit', 'hr', 'status', 'edit', 'Switch staff between active and inactive within scope')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'hr.status.edit'
 where r.code in ('admin', 'head_office_manager', 'hr_manager', 'zonal_manager')
on conflict do nothing;

create or replace function public.hr_change_status(p_employee uuid, p_status text, p_effective date, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_perm text;
  v_switch boolean;
begin
  select * into e from public.employees where id = p_employee for update;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if e.archived_at is not null then raise exception 'Archived employees cannot change status.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if not ((e.status, p_status) in (('active','inactive'), ('inactive','active'), ('active','resigned'),
                                   ('inactive','resigned'), ('active','terminated'), ('inactive','terminated'),
                                   ('resigned','active'), ('terminated','active'))) then
    raise exception 'Status cannot change from % to %.', e.status, p_status using errcode = 'P0001';
  end if;
  v_perm := case when p_status = 'terminated' or e.status in ('resigned','terminated') then 'hr.employee.approve'
                 else 'hr.employee.edit' end;
  v_switch := (e.status, p_status) in (('active','inactive'), ('inactive','active'));
  if not (private.has_permission(v_perm, e.zone_id, e.hub_id)
          or (v_switch and private.has_permission('hr.status.edit', e.zone_id, e.hub_id))) then
    raise exception 'Not authorised (requires %).', v_perm using errcode = '42501';
  end if;
  if e.profile_id = auth.uid() then
    raise exception 'You cannot change your own employment status.' using errcode = '42501';
  end if;

  perform set_config('app.change_reason', p_reason, true);
  update public.employees set status = p_status, status_since = coalesce(p_effective, current_date) where id = p_employee;
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, e.status, p_status, coalesce(p_effective, current_date), p_reason);

  if p_status in ('resigned','terminated') then
    update public.employee_assignments set effective_to = greatest(coalesce(p_effective, current_date), effective_from)
     where employee_id = p_employee and effective_to is null;
  elsif e.status in ('resigned','terminated') and p_status = 'active' then
    insert into public.employee_assignments
      (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
    values (p_employee, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id,
            coalesce(p_effective, current_date), 'Reinstated: ' || p_reason);
  end if;

  -- Leavers and inactive staff lose system access immediately; reactivation restores it.
  if e.profile_id is not null then
    update public.profiles set status = case when p_status = 'active' then 'active' else 'inactive' end
     where id = e.profile_id;
  end if;
end $$;

create or replace function public.hr_transfer_employee(
  p_employee uuid, p_hub uuid, p_department uuid, p_position uuid, p_manager uuid,
  p_effective date, p_reason text, p_change_type text default 'transfer'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_zone uuid;
  v_plain boolean;
begin
  select * into e from public.employees where id = p_employee for update;
  if e.id is null then raise exception 'Employee not found.' using errcode = 'P0002'; end if;
  if e.status <> 'active' then raise exception 'Only active employees can be transferred.' using errcode = 'P0001'; end if;
  if p_change_type not in ('transfer','promotion','correction') then raise exception 'Invalid change type.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_effective is null or p_effective < (select max(effective_from) from public.employee_assignments where employee_id = p_employee) then
    raise exception 'Effective date must be on or after the current assignment start.' using errcode = '22023';
  end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if p_hub is not null and v_zone is null then raise exception 'The new hub was not found.' using errcode = 'P0002'; end if;
  v_plain := p_change_type = 'transfer'
             and p_department is not distinct from e.department_id
             and p_position is not distinct from e.position_id;
  if not ((private.has_permission('hr.employee.edit', e.zone_id, e.hub_id)
           and private.has_permission('hr.employee.edit', coalesce(v_zone, e.zone_id), p_hub))
       or (v_plain and private.has_permission('hr.transfer.edit', e.zone_id, e.hub_id)
           and private.has_permission('hr.transfer.edit', coalesce(v_zone, e.zone_id), p_hub))) then
    raise exception 'You need transfer rights in both the current and the new hub.' using errcode = '42501';
  end if;
  if p_manager = p_employee then raise exception 'An employee cannot report to themselves.' using errcode = '22023'; end if;
  if v_plain and p_hub is not distinct from e.hub_id and p_manager is not distinct from e.reporting_manager_id then
    raise exception 'The employee is already in this hub. Choose another hub.' using errcode = '22023';
  end if;

  update public.employee_assignments set effective_to = greatest(p_effective - 1, effective_from)
   where employee_id = p_employee and effective_to is null;
  insert into public.employee_assignments
    (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
  values (p_employee, p_change_type, p_department, p_position, coalesce(v_zone, e.zone_id), p_hub, p_manager, p_effective, p_reason);
  perform set_config('app.change_reason', p_reason, true);
  update public.employees
     set hub_id = p_hub, zone_id = coalesce(v_zone, e.zone_id), department_id = p_department,
         position_id = p_position, reporting_manager_id = p_manager
   where id = p_employee;
end $$;
