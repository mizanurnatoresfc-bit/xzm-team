-- =====================================================================
-- XZM-TEAM ERP — Migration: hub-to-hub transfer from the zonal panel
--
--  Zonal managers can move staff between hubs of their own zone without
--  full HR edit rights. New permission hr.transfer.edit: a plain hub move
--  (same post and department) is allowed when the caller holds it in both
--  the old and the new hub. Changing post or department still needs
--  hr.employee.edit. Every move stays in the assignment history.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('hr.transfer.edit', 'hr', 'transfer', 'edit', 'Move staff from one hub to another (same post) within scope')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'hr.transfer.edit'
 where r.code in ('admin', 'head_office_manager', 'hr_manager', 'zonal_manager')
on conflict do nothing;

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
