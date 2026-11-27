-- Administrators need the check grants to assign manager roles under can_assign_role.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('admin', 'head_office_manager', 'operations_manager')
  and p.code in ('vehicle.check.view', 'vehicle.check.approve')
on conflict do nothing;
