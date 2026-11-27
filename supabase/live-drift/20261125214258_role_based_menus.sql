-- RECORDED FROM LIVE (drift sync, System Control Center Phase 0).
-- This migration was applied to the live Supabase project as version 20261125214258 (role_based_menus) but its source was never committed.
-- The statements below are copied unchanged from supabase_migrations.schema_migrations on live; nothing is applied to live by adding this file.

-- Role-based menus: every system role gets a limited page list.
-- Only roles whose menu is still NULL are touched; super_admin and admin
-- stay unrestricted. ALWAYS_OPEN pages open for everyone regardless.

do $$
declare
  v_role record;
  v_menu jsonb;
begin
  for v_role in
    select r.id, r.code
    from public.roles r
    left join public.role_dashboards d on d.role_id = r.id
    where r.archived_at is null
      and not r.is_super
      and r.code not in ('admin', 'super_admin')
      and (d.menu is null)
  loop
    v_menu := case v_role.code
      when 'staff' then '[]'::jsonb
      when 'rider' then jsonb_build_array(
        '/app/hub/routes', '/app/routes/plan', '/app/hub/pickup')
      when 'hub_manager' then jsonb_build_array(
        '/app/staff/list','/app/attendance','/app/hr/requests','/app/manpower',
        '/app/hub/pickup','/app/hub/tasks','/app/hub/ops','/app/hub/accounts',
        '/app/hub/logins','/app/hub/routes','/app/routes/plan',
        '/app/accounts/khata','/app/accounts/daily','/app/accounts/center',
        '/app/accounts/reports','/app/fleet','/app/issues','/app/office/overview')
      when 'zonal_manager' then jsonb_build_array(
        '/app/zonal','/app/zonal/routes','/app/zonal/hub-ops','/app/zonal/requests',
        '/app/zonal/hr-records','/app/zonal/files','/app/zonal/profile',
        '/app/staff/list','/app/attendance','/app/hr/requests','/app/hr/duties',
        '/app/hr/referrals','/app/hr/profile-gaps','/app/manpower',
        '/app/hub/pickup','/app/hub/tasks','/app/hub/ops','/app/hub/accounts',
        '/app/hub/logins','/app/hub/routes','/app/routes/plan',
        '/app/accounts/khata','/app/accounts/daily','/app/accounts/center',
        '/app/accounts/reports','/app/accounts/settings','/app/fleet',
        '/app/issues','/app/office/overview','/app/office/zone',
        '/app/nodi/chat','/app/nodi')
      when 'hr_manager' then jsonb_build_array(
        '/app/staff/list','/app/attendance','/app/hr/requests','/app/hr/duties',
        '/app/hr/referrals','/app/hr/profile-gaps','/app/hr/fields','/app/hr/import',
        '/app/manpower','/app/zonal/requests','/app/zonal/hr-records',
        '/app/zonal/profile','/app/rollout')
      when 'accounts_manager' then jsonb_build_array(
        '/app/accounts/khata','/app/accounts/daily','/app/accounts/center',
        '/app/accounts/reports','/app/accounts/settings','/app/office/bills',
        '/app/office/rent','/app/office/residential/bills',
        '/app/office/residential/rent','/app/office/reports','/app/fleet')
      when 'accountant' then jsonb_build_array(
        '/app/accounts/khata','/app/accounts/daily','/app/accounts/center',
        '/app/accounts/reports','/app/office/bills','/app/office/rent')
      when 'manager_hisab' then jsonb_build_array(
        '/app/accounts/khata','/app/accounts/daily','/app/accounts/center',
        '/app/accounts/reports','/app/hub/accounts')
      when 'operations_manager' then jsonb_build_array(
        '/app/hub/pickup','/app/hub/tasks','/app/hub/ops','/app/hub/routes',
        '/app/routes/plan','/app/zonal/routes','/app/zonal/hub-ops',
        '/app/fleet','/app/issues')
      when 'head_office_manager' then jsonb_build_array(
        '/app/zonal','/app/zonal/routes','/app/zonal/hub-ops','/app/zonal/requests',
        '/app/zonal/hr-records','/app/staff/list','/app/attendance','/app/hr/requests',
        '/app/hr/duties','/app/hr/referrals','/app/accounts/daily',
        '/app/accounts/reports','/app/fleet','/app/issues','/app/office/overview',
        '/app/office/reports')
      when 'pickup_manager' then jsonb_build_array(
        '/app/hub/pickup','/app/hub/tasks','/app/hub/routes','/app/routes/plan')
      when 'delivery_manager' then jsonb_build_array(
        '/app/hub/pickup','/app/hub/tasks','/app/hub/routes','/app/routes/plan',
        '/app/accounts/khata')
      when 'auditor' then jsonb_build_array(
        '/app/zonal','/app/zonal/routes','/app/zonal/hub-ops','/app/zonal/hr-records',
        '/app/staff/list','/app/attendance','/app/hr/requests','/app/accounts/daily',
        '/app/accounts/reports','/app/fleet','/app/office/reports','/app/issues')
      when 'zonal_assistant' then jsonb_build_array(
        '/app/zonal/assistant','/app/attendance','/app/staff/list')
      else null
    end;

    if v_menu is not null then
      insert into public.role_dashboards (role_id, menu)
      values (v_role.id, v_menu)
      on conflict (role_id) do update set menu = excluded.menu, updated_at = now();
    end if;
  end loop;
end $$;

-- Make the staff role always start limited in future deployments.
do $$
declare v_staff uuid;
begin
  select id into v_staff from public.roles where code = 'staff';
  if v_staff is not null then
    insert into public.role_dashboards (role_id, menu)
    values (v_staff, '[]'::jsonb)
    on conflict (role_id) do update
      set menu = coalesce(public.role_dashboards.menu, '[]'::jsonb);
  end if;
end $$;
