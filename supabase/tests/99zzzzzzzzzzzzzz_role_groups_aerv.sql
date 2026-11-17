-- Role groups (zone / hub / self) and AERV permission saves.
begin;
select tests.fixture();

-- ---------- groups ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.my_panel_group() is null, 'no group set yet: the app works it out from permissions');
select tests.throws($$ select * from public.role_group_list() $$, 'a hub manager cannot list role groups', '42501');
select tests.throws($$ select public.role_group_set((select id from public.roles where code = 'hub_manager'), 'zone') $$,
  'a hub manager cannot move their own role up a group', '42501');

select tests.login(tests.id('super'));
select tests.ok(public.my_panel_group() = 'zone', 'a Super Admin is always in the top group');
select tests.ok((select panel_group from public.role_group_list() where code = 'super_admin') = 'zone', 'the list shows the Super Admin in the top group');
select tests.ok((select count(*) from public.role_group_list() where code = 'hub_manager' and 'hr.employee.view' = any(permissions)) = 1,
  'the list carries each role''s permission codes');
select public.role_group_set((select id from public.roles where code = 'hub_manager'), 'hub');
select tests.ok((select panel_group from public.role_group_list() where code = 'hub_manager') = 'hub', 'hub manager put in the manager group');
select tests.ok((select default_view from public.role_group_list() where code = 'hub_manager') = 'hub', 'its home view follows the group');
select tests.throws($$ select public.role_group_set((select id from public.roles where code = 'hub_manager'), 'boss') $$, 'an unknown group is refused', '22023');
select tests.throws($$ select public.role_group_set((select id from public.roles where code = 'super_admin'), 'self') $$, 'the Super Admin cannot be moved down', '22023');

select tests.login(tests.id('hub_mgr'));
select tests.ok(public.my_panel_group() = 'hub', 'the hub manager now reads their group');

-- several roles: the highest group wins
select tests.logout();
select tests.grant_role(tests.id('hub_mgr'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.login(tests.id('super'));
select public.role_group_set((select id from public.roles where code = 'rider'), 'self');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.my_panel_group() = 'hub', 'with a manager and a rider role, the manager group wins');

-- back to automatic
select tests.login(tests.id('super'));
select public.role_group_set((select id from public.roles where code = 'hub_manager'), null);
select tests.ok((select panel_group from public.role_group_list() where code = 'hub_manager') is null, 'group cleared: automatic again');
select tests.ok((select default_view from public.role_group_list() where code = 'hub_manager') = 'hub', 'clearing the group keeps the home view');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.my_panel_group() = 'self', 'only the rider role still has a group');

-- ---------- AERV ----------
select tests.login(tests.id('super'));
select tests.ok((select not ('hr.leave.approve' = any(permissions)) from public.role_group_list() where code = 'rider'), 'a rider cannot approve leave to start with');
select tests.ok(public.role_aerv_save((select id from public.roles where code = 'rider'), array['hr.leave.approve'], '{}') > 0, 'AERV save returns the new count');
select tests.ok((select 'hr.leave.approve' = any(permissions) from public.role_group_list() where code = 'rider'), 'the ticked permission is on the role');
select public.role_aerv_save((select id from public.roles where code = 'rider'), '{}', array['hr.leave.approve']);
select tests.ok((select not ('hr.leave.approve' = any(permissions)) from public.role_group_list() where code = 'rider'), 'the unticked permission is off again');
select tests.ok((select count(*) from public.role_group_list() r where r.code = 'rider' and cardinality(r.permissions) > 0) = 1, 'other permissions stay');
select tests.throws($$ select public.role_aerv_save((select id from public.roles where code = 'rider'), array['hr.nothing.view'], '{}') $$, 'an unknown permission is refused', '22023');
select tests.throws($$ select public.role_aerv_save((select id from public.roles where code = 'rider'), array['hr.leave.view'], array['hr.leave.view']) $$, 'add and remove the same code at once is refused', '22023');
select tests.throws($$ select public.role_aerv_save((select id from public.roles where code = 'super_admin'), '{}', array['hr.leave.view']) $$, 'the Super Admin role cannot be changed', '22023');

select tests.login(tests.id('zonal_a'));
select tests.throws($$ select public.role_aerv_save((select id from public.roles where code = 'rider'), array['hr.leave.approve'], '{}') $$, 'a zonal manager cannot change role permissions', '42501');

rollback;
