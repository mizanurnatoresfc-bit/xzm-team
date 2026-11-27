begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('data_entry_employee', tests.active_employee('Data Entry Employee', '705', tests.id('hub_a1'), '01711000705', '7050101010'));

select tests.login_anon();
select tests.throws('select public.data_entry_team_zones()', 'anonymous cannot list zones', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) = 0 from public.data_entry_team_zones()), 'existing roles have no automatic grant');
select tests.logout();

-- The role grant in this fixture applies only within the transaction.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code = 'zonal_manager' and p.code = 'data_entry.team.edit';

select tests.login(tests.id('zonal_a'));
select tests.ok((select array_agg(id) = array[tests.id('zone_a')] from public.data_entry_team_zones()), 'zonal manager can list only their zone');
select tests.throws(format('select public.data_entry_team_snapshot(%L)', tests.id('zone_b')), 'other zone team is denied', '42501');
select tests.throws('select * from public.data_entry_team_members', 'raw membership reads are denied', '42501');
select tests.ok((select count(*) = 1 from public.data_entry_team_candidates(tests.id('zone_a'), '705')), 'search returns the existing employee');
select tests.throws(format('select public.data_entry_team_save(%L, %L, %L, array[%L]::uuid[], true, null)',
  tests.id('zone_a'), tests.id('data_entry_employee'), tests.id('hub_a1'), tests.id('hub_b1')),
  'additional hub must belong to the same zone', '22023');
select public.data_entry_team_save(tests.id('zone_a'), tests.id('data_entry_employee'), tests.id('hub_a1'), array[tests.id('hub_a2')], true, null);
select tests.ok(public.data_entry_team_snapshot(tests.id('zone_a')) #>> '{members,0,additional_hubs,0}' = tests.id('hub_a2')::text,
  'primary and additional hub save together');
select tests.ok((select count(*) = 0 from public.data_entry_team_candidates(tests.id('zone_a'), '705')), 'employee cannot be added twice');
select tests.throws(format('select public.data_entry_team_save(%L, %L, %L, null, true, null)',
  tests.id('zone_a'), tests.id('data_entry_employee'), tests.id('hub_a1')),
  'duplicate or stale create is rejected', '40001');

select public.data_entry_team_save(tests.id('zone_a'), tests.id('data_entry_employee'), tests.id('hub_a2'), array[]::uuid[], true, 1);
select tests.throws(format('select public.data_entry_team_save(%L, %L, %L, null, false, 1)',
  tests.id('zone_a'), tests.id('data_entry_employee'), tests.id('hub_a2')),
  'stale edit is rejected', '40001');
select public.data_entry_team_save(tests.id('zone_a'), tests.id('data_entry_employee'), null, null, false, 2);
select tests.ok(public.data_entry_team_snapshot(tests.id('zone_a')) #>> '{members,0,is_active}' = 'false', 'inactive membership stays in the roster');

select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.data_entry_team_snapshot(%L)', tests.id('zone_a')), 'hub manager cannot manage the zone team', '42501');
select tests.login(tests.id('super'));
select tests.ok((select count(*) = 2 from public.data_entry_team_zones()), 'global super admin can list both zones');

select tests.logout();
select tests.ok((select count(*) = 1 and bool_and(not is_active) from public.data_entry_hub_assignments), 'removed assignment retained as inactive');
select tests.ok((select count(*) >= 4 from public.audit_logs where module = 'data_entry'), 'changes are recorded in the existing audit log');
rollback;
