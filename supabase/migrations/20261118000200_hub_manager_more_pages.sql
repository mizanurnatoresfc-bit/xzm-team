-- =====================================================================
--  The hub manager can open the sorting-centre reports, staff, fuel slips and driver reports,
--  and write duties — all inside their own hub: the role is given to a person for one hub, so
--  these permissions work only there. Approving fuel, editing centres and hub charges stay with
--  the zonal manager. Office pages (bills, passwords, reports, resources) were already given.
-- =====================================================================
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'sorting.report.view', 'sorting.staff.view', 'sorting.fuel.view', 'sorting.fuel.create',
  'sorting.driver.view', 'sorting.driver.create', 'hr.duty.edit')
where r.code = 'hub_manager'
on conflict do nothing;
