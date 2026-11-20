-- Fleet visibility follows the scoped vehicle permissions. Vehicle ownership,
-- hub assignment, crew assignment, and assignment/event history are unchanged.
-- The system zone and hub roles are view/operations roles; vehicle setup is kept
-- with the global administration roles. Retain all vehicle and history rows.
begin;

delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code in ('zonal_manager', 'hub_manager')
  and p.code in ('vehicle.vehicle.create', 'vehicle.vehicle.edit',
                 'vehicle.vehicle.archive', 'vehicle.holder.edit');

commit;
