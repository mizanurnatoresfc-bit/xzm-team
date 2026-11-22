-- The Driver role does not write or approve anyone's attendance (owner, 22 Nov: "সব ঠিক আছে" to removing it).
-- Drivers still give their own attendance from the staff panel (that needs no permission).
delete from public.role_permissions rp
 using public.roles r, public.permissions p
 where rp.role_id = r.id and rp.permission_id = p.id and r.code = 'driver' and p.code = 'hr.attendance.create';
