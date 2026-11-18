-- XZM-TEAM: DEMO data for trying the three panels (Staff, Hub Manager, Zonal Manager).
-- This is NOT a migration. Run it by hand (Supabase -> SQL Editor), once.
-- Before running, replace __DEMO_PASSWORD__ (below) with a password of your choice; do not commit it.
--
-- Creates, all marked DEMO and kept apart from real data:
--   * Zone  "DEMO Zone"  (code DEMOZ)  in the existing organization
--   * Hub   "DEMO Hub"   (code DEMOH)  in that zone
--   * 12 employees, Employee IDs DEMO01..DEMO10 (staff), DEMOMGR (hub manager), DEMOZM (zonal manager)
--   * 3 logins (sign in at /staff/login with the Employee ID):
--       DEMO01   -> role staff          (scope: DEMO Hub)
--       DEMOMGR  -> role hub_manager    (scope: DEMO Hub)
--       DEMOZM   -> role zonal_manager  (scope: DEMO Zone)
-- Letter-based IDs keep hr_next_employee_code() (numeric only) from jumping.
-- Remove everything again with supabase/demo-remove.sql.
begin;

do $$
declare
  v_pw    text := '__DEMO_PASSWORD__';
  v_org   uuid := (select id from public.organizations where archived_at is null order by created_at limit 1);
  v_reg   uuid := (select region_id from public.zones where region_id is not null limit 1);
  v_dept  uuid := (select id from public.departments where archived_at is null order by created_at limit 1);
  v_zone  uuid;
  v_hub   uuid;
  r       record;
  v_uid   uuid;
  v_emp   uuid;
begin
  if v_pw = '__DEMO_PASSWORD__' or length(v_pw) < 8 then
    raise exception 'Set the demo password in v_pw first (8+ characters).';
  end if;
  if exists (select 1 from public.zones where code = 'DEMOZ') then
    raise exception 'Demo data already exists. Run demo-remove.sql first.';
  end if;

  insert into public.zones (organization_id, code, name, name_bn, region_id)
  values (v_org, 'DEMOZ', 'DEMO Zone', 'ডেমো জোন', v_reg) returning id into v_zone;

  insert into public.hubs (zone_id, code, name, name_bn, hub_type)
  values (v_zone, 'DEMOH', 'DEMO Hub', 'ডেমো হাব', 'Hub') returning id into v_hub;

  for r in
    select * from (values
      ('DEMO01',  'Demo Staff Rahim',       'ডেমো রহিম',      'Hub CC',           'staff'),
      ('DEMO02',  'Demo Staff Karim',       'ডেমো করিম',      'Data Entry',       null),
      ('DEMO03',  'Demo Staff Salma',       'ডেমো সালমা',     'Data Entry',       null),
      ('DEMO04',  'Demo Rider Jamal',       'ডেমো জামাল',     'Commission Rider', null),
      ('DEMO05',  'Demo Rider Kamal',       'ডেমো কামাল',     'Commission Rider', null),
      ('DEMO06',  'Demo Rider Hasan',       'ডেমো হাসান',     'Commission Rider', null),
      ('DEMO07',  'Demo Driver Babul',      'ডেমো বাবুল',     'Driver',           null),
      ('DEMO08',  'Demo Helper Sumon',      'ডেমো সুমন',      'Helper',           null),
      ('DEMO09',  'Demo Loader Rubel',      'ডেমো রুবেল',     'Sorting + Loader', null),
      ('DEMO10',  'Demo Guard Alamgir',     'ডেমো আলমগীর',   'Security Guard',   null),
      ('DEMOMGR', 'Demo Hub Manager Nasir', 'ডেমো নাসির',     'Manager',          'hub_manager'),
      ('DEMOZM',  'Demo Zonal Manager Faruk','ডেমো ফারুক',    'Zonal Manager',    'zonal_manager')
    ) t(code, name_en, name_bn, pos, role_code)
  loop
    v_uid := null;
    if r.role_code is not null then
      v_uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
              'id-' || lower(r.code) || '@xzmteam.com', extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', r.name_en, 'email_verified', true),
              now(), now(), '', '', '', '');
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (v_uid::text, v_uid,
              jsonb_build_object('sub', v_uid::text, 'email', 'id-' || lower(r.code) || '@xzmteam.com', 'email_verified', false, 'phone_verified', false),
              'email', now(), now(), now());
      -- profile row comes from the on_auth_user_created trigger
      update public.profiles set preferred_language = 'bn', must_change_password = false where id = v_uid;

      insert into public.user_roles (user_id, role_id, scope_type, zone_id, hub_id)
      select v_uid, ro.id,
             case when r.role_code = 'zonal_manager' then 'zone' else 'hub' end,
             case when r.role_code = 'zonal_manager' then v_zone end,
             case when r.role_code = 'zonal_manager' then null else v_hub end
      from public.roles ro where ro.code = r.role_code;
    end if;

    insert into public.employees (employee_code, profile_id, full_name, full_name_bn, department_id, position_id,
                                  hub_id, zone_id, joining_date, status, status_since, reference_info)
    values (r.code, v_uid, r.name_en, r.name_bn, v_dept,
            (select id from public.positions where name = r.pos limit 1),
            case when r.role_code = 'zonal_manager' then null else v_hub end, v_zone,
            current_date - 30, 'active', current_date - 30, 'DEMO data - not a real person')
    returning id into v_emp;
  end loop;

  -- staff report to the hub manager, the hub manager to the zonal manager
  update public.employees set reporting_manager_id = (select id from public.employees where employee_code = 'DEMOMGR')
   where employee_code like 'DEMO__' and employee_code <> 'DEMOZM';
  update public.employees set reporting_manager_id = (select id from public.employees where employee_code = 'DEMOZM')
   where employee_code = 'DEMOMGR';
end $$;

commit;
