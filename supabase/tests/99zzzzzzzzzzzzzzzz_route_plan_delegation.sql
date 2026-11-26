begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('delegate_user', tests.make_user('delegate.rider@test.local', 'Delegate Rider')),
  ('delegate_employee', tests.active_employee('Delegate Rider', '704', tests.id('hub_a1'), '01711000704', '7040101010'));
update public.employees set profile_id = tests.id('delegate_user') where id = tests.id('delegate_employee');

select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.route_plan_delegate(%L,%L,%L,null)', tests.id('hub_a1'), tests.id('delegate_employee'), 'ops.route_plan.approve'), 'hub manager cannot delegate approval', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.route_plan_delegate(%L,%L,%L,null)', tests.id('hub_b1'), tests.id('delegate_employee'), 'ops.route_plan.approve'), 'zone A cannot delegate for zone B', '42501');
select tests.throws(format('select public.route_plan_delegate(%L,%L,%L,null)', tests.id('hub_a1'), tests.id('delegate_employee'), 'system.user.edit'), 'permissions outside the route plan allowlist are refused', '42501');
select public.route_plan_delegate(tests.id('hub_a1'), tests.id('delegate_employee'), 'ops.route_plan.approve', null);
select tests.ok(jsonb_array_length(public.route_plan_delegations(tests.id('hub_a1'))->'grants') = 1, 'the zonal manager sees the delegated permission');
create temp table delegated_id as select (public.route_plan_delegations(tests.id('hub_a1'))#>>'{grants,0,id}')::uuid as id;
grant select on delegated_id to authenticated;

select tests.login(tests.id('delegate_user'));
select tests.ok(exists (select 1 from private.my_grants() g where g.permission_code = 'ops.route_plan.approve' and g.hub_id = tests.id('hub_a1') and g.scope_type = 'hub'), 'approval reaches the recipient at the intended hub');
select tests.throws('select public.route_plan_revoke_delegation(id) from delegated_id', 'recipient cannot revoke the grant', '42501');
select tests.login(tests.id('zonal_a'));
select public.route_plan_revoke_delegation(id) from delegated_id;
select tests.login(tests.id('delegate_user'));
select tests.ok(not exists (select 1 from private.my_grants() g where g.permission_code = 'ops.route_plan.approve'), 'revocation removes the permission');
select tests.logout();
rollback;
