-- Role builder: only the Super Admin creates roles and sets their permissions.
begin;
select tests.fixture();

select tests.login(tests.id('super'));
select tests.ok((select count(*) from public.role_admin_list()) >= 13, 'super admin lists roles');
insert into tests.ids values ('cashier', public.role_admin_save(null, 'Hub Cashier', 'হাব ক্যাশিয়ার', 'Counts cash',
  array['org.hub.view','ops.cash.view','ops.cash.create']));
select tests.ok((select code from public.roles where id = tests.id('cashier')) = 'hub_cashier', 'code made from the English name');
select tests.ok((select permission_count from public.role_admin_list() where id = tests.id('cashier')) = 3, 'three permissions saved');

-- change the list: one removed, one added
select public.role_admin_save(tests.id('cashier'), 'Hub Cashier', 'হাব ক্যাশিয়ার', null, array['org.hub.view','ops.cash.view','ops.report.view']);
select tests.ok((select permissions from public.role_admin_list() where id = tests.id('cashier')) = array['ops.cash.view','ops.report.view','org.hub.view'],
  'permission list replaced exactly');
select tests.throws(format('select public.role_admin_save(%L, ''X'', null, null, array[''no.such.thing''])', tests.id('cashier')),
  'unknown permission refused', '22023');
select tests.throws($$select public.role_admin_save((select id from public.roles where code='super_admin'), 'S', null, null, '{}')$$,
  'Super Admin role cannot be edited', 'P0001');

-- a system role's permissions can be tuned by the Super Admin (company policy)
select public.role_admin_save((select id from public.roles where code='rider'), 'Rider', 'রাইডার', null,
  array['org.organization.view','org.hub.view','ops.pickup_as_rider.create']);
select tests.ok((select permission_count from public.role_admin_list() where code = 'rider') = 3, 'system role permissions tuned');

-- the role works: assign it and the holder gets exactly those permissions
select public.user_admin_assign_role(tests.id('noroles'), tests.id('cashier'), 'hub', null, tests.id('hub_a1'));
select tests.login(tests.id('noroles'));
select tests.ok(exists (select 1 from public.my_permissions() where permission_code = 'ops.report.view' and hub_id = tests.id('hub_a1')),
  'holder gets the new permission at the hub');
select tests.ok(not exists (select 1 from public.my_permissions() where permission_code = 'ops.cash.create'),
  'removed permission is gone');

-- others cannot build roles
select tests.login(tests.id('admin'));
select tests.ok((select count(*) from public.role_admin_list()) >= 14, 'admin can view roles');
select tests.throws($$select public.role_admin_save(null, 'Sneaky', null, null, array['system.user.edit'])$$,
  'admin cannot create roles', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select * from public.role_admin_list()$$, 'hub manager cannot see the role list', '42501');

-- archive
select tests.login(tests.id('super'));
select tests.throws(format('select public.role_admin_archive(%L, ''old'')', tests.id('cashier')),
  'role in use cannot be archived', 'P0001');
select public.user_admin_revoke_role((select id from public.user_roles where role_id = tests.id('cashier') and revoked_at is null), 'test');
select public.role_admin_archive(tests.id('cashier'), 'not needed');
select tests.ok((select archived_at is not null from public.roles where id = tests.id('cashier')), 'unused custom role archived');
select tests.throws($$select public.role_admin_archive((select id from public.roles where code='rider'), 'x')$$,
  'system roles cannot be archived', 'P0001');
select tests.ok(not exists (select 1 from public.user_admin_assignable_roles('hub', null, tests.id('hub_a1')) where id = tests.id('cashier')),
  'archived role is no longer offered');

rollback;
