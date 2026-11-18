-- Live-only migration brought into the repository word for word from supabase_migrations.schema_migrations
-- (live version 20261118161122 hub_manager_more_pages, applied on 18 Nov 2026 from another session).
-- The hub manager role also gets the sorting-centre report / staff / fuel / driver pages and editing duties.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'sorting.report.view', 'sorting.staff.view', 'sorting.fuel.view', 'sorting.fuel.create',
  'sorting.driver.view', 'sorting.driver.create', 'hr.duty.edit')
where r.code = 'hub_manager'
on conflict do nothing;
