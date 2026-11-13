-- =====================================================================
-- XZM-TEAM ERP — Migration 0002: default permissions, roles, bootstrap
-- These are DEFAULT configuration rows. Admins can create custom roles and
-- (Super Admin) change role permissions from the UI afterwards.
-- Later module migrations add their own permissions (hr.*, ops.*, acc.* ...).
-- =====================================================================

insert into public.permissions (code, module, resource, action, description)
select m || '.' || r || '.' || a, m, r, a, d
from (values
  ('org','organization','view','View company profile'),
  ('org','organization','create','Create company profile'),
  ('org','organization','edit','Edit company profile'),
  ('org','zone','view','View zones'),
  ('org','zone','create','Create zones'),
  ('org','zone','edit','Edit zones'),
  ('org','zone','archive','Archive zones'),
  ('org','hub','view','View hubs'),
  ('org','hub','create','Create hubs'),
  ('org','hub','edit','Edit hubs'),
  ('org','hub','archive','Archive hubs'),
  ('org','department','view','View departments'),
  ('org','department','create','Create departments'),
  ('org','department','edit','Edit departments'),
  ('org','department','archive','Archive departments'),
  ('org','position','view','View positions'),
  ('org','position','create','Create positions'),
  ('org','position','edit','Edit positions'),
  ('org','position','archive','Archive positions'),
  ('system','user','view','View user accounts and login history'),
  ('system','user','create','Invite / create user accounts'),
  ('system','user','edit','Activate, deactivate, unlock users'),
  ('system','user_role','view','View role assignments'),
  ('system','user_role','create','Assign roles to users'),
  ('system','user_role','edit','Revoke / end-date role assignments'),
  ('system','role','view','View roles'),
  ('system','role','create','Create custom roles'),
  ('system','role','edit','Edit roles'),
  ('system','settings','view','View system settings'),
  ('system','settings','configure','Change system settings and branding'),
  ('system','admin_portal','view','Sign in through the /secure-control admin portal'),
  ('system','audit','view','View audit log'),
  ('system','audit','export','Export audit log')
) as v(m, r, a, d);

insert into public.roles (code, name, name_bn, description, is_system, is_super) values
  ('super_admin',         'Super Admin',          'সুপার অ্যাডমিন',        'Full system control', true, true),
  ('admin',               'Admin',                'অ্যাডমিন',              'System administration', true, false),
  ('head_office_manager', 'Head Office Manager',  'হেড অফিস ম্যানেজার',    'Company-wide oversight', true, false),
  ('hr_manager',          'HR Manager',           'এইচআর ম্যানেজার',       'Human resources', true, false),
  ('accounts_manager',    'Accounts Manager',     'অ্যাকাউন্টস ম্যানেজার', 'Finance and accounts', true, false),
  ('operations_manager',  'Operations Manager',   'অপারেশনস ম্যানেজার',    'Courier operations', true, false),
  ('zonal_manager',       'Zonal Manager',        'জোনাল ম্যানেজার',       'Manages one zone', true, false),
  ('hub_manager',         'Hub Manager',          'হাব ম্যানেজার',         'Manages one hub', true, false),
  ('pickup_manager',      'Pickup Manager',       'পিকআপ ম্যানেজার',       'Pickup operations', true, false),
  ('delivery_manager',    'Delivery Manager',     'ডেলিভারি ম্যানেজার',    'Delivery operations', true, false),
  ('rider',               'Rider',                'রাইডার',                'Pickup / delivery rider', true, false),
  ('accountant',          'Accountant',           'হিসাবরক্ষক',            'Bookkeeping', true, false),
  ('auditor',             'Auditor',              'অডিটর',                 'Read-only review and audit', true, false);

-- Role -> permission defaults (foundation scope only).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on (
     (r.code = 'admin')
  or (r.code = 'head_office_manager' and p.action = 'view' and p.code <> 'system.admin_portal.view')
  or (r.code = 'hr_manager' and (p.code like 'org.%.view'
        or p.code in ('org.department.create','org.department.edit',
                      'org.position.create','org.position.edit','system.user.view')))
  or (r.code in ('accounts_manager','operations_manager','accountant') and p.code like 'org.%.view')
  or (r.code = 'zonal_manager' and p.code in ('org.organization.view','org.zone.view','org.hub.view','org.hub.edit',
                                              'org.department.view','org.position.view'))
  or (r.code = 'hub_manager' and p.code in ('org.organization.view','org.zone.view','org.hub.view',
                                            'org.department.view','org.position.view'))
  or (r.code in ('pickup_manager','delivery_manager','rider') and p.code in ('org.organization.view','org.hub.view'))
  or (r.code = 'auditor' and ((p.action = 'view' and p.code <> 'system.admin_portal.view') or p.code = 'system.audit.export'))
);

-- ---------------------------------------------------------------------
-- Bootstrap: make the FIRST super admin. Works only while none exists.
-- Run once from the Supabase SQL editor (never exposed to the API):
--   select private.bootstrap_super_admin('owner@example.com');
-- ---------------------------------------------------------------------
create or replace function private.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
             where r.is_super and ur.revoked_at is null) then
    raise exception 'A Super Admin already exists. Assign further admins from the application.';
  end if;
  select id into v_user from public.profiles where email = p_email::extensions.citext;
  if v_user is null then
    raise exception 'No user with email %. Create the user in Supabase Auth first.', p_email;
  end if;
  insert into public.user_roles (user_id, role_id, scope_type)
  select v_user, id, 'global' from public.roles where code = 'super_admin';
  perform private.write_audit('BOOTSTRAP', 'system', 'user_roles', v_user::text, null,
                              jsonb_build_object('role', 'super_admin'), 'Initial super admin');
  return v_user;
end $$;
revoke all on function private.bootstrap_super_admin(text) from public, anon, authenticated;
