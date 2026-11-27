-- RECORDED FROM LIVE (drift sync, System Control Center Phase 0).
-- This migration was applied to the live Supabase project as version 20261123210803 (staff_self_employee_scope) but its source was never committed.
-- The statements below are copied unchanged from supabase_migrations.schema_migrations on live; nothing is applied to live by adding this file.

-- Staff can read their own employee record through the existing self policy.
-- Hub-wide employee access also selects the manager home, so reserve it for
-- roles that manage employees.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code = 'staff'
  and p.code = 'hr.employee.view';
