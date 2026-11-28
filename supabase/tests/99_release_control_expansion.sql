-- Expansion-pack assertions: the four extra RPCs wrapped in 20261128070000_module_release_expansion.sql
-- stay transparent while their module is 'published' (default for legacy_live), and start refusing with
-- 42501 once Super Admin flips the module to development/testing without DEMO assignment.
begin;
select tests.fixture();
insert into public.hubs(zone_id, code, name) values (tests.id('zone_a'), 'DEMO', 'DEMO Hub');
insert into tests.ids select 'demo', id from public.hubs where code = 'DEMO';
insert into tests.ids select 'manager_role', id from public.roles where code = 'hub_manager';
select tests.grant_role(tests.id('hub_mgr'), 'hub_manager', 'hub', null, tests.id('demo'));

-- Default behaviour: legacy_live modules are 'published', so each guarded RPC answers normally.
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.fleet_board(tests.id('demo')) is not null, 'fleet_board stays reachable at published default');
select tests.ok(public.fleet_waiting(tests.id('demo')) is not null, 'fleet_waiting stays reachable at published default');
select tests.ok(public.hub_feed(tests.id('demo')) is not null, 'hub_feed stays reachable at published default');

-- Flip `fleet` to development. Guard now refuses, but switching the module back restores access.
select tests.login(tests.id('super'));
select public.module_release_save('fleet', 0, '{"stage":"development"}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select public.fleet_board(tests.id('demo'))$q$, 'release guard blocks fleet_board when the module is not published', '42501');
select tests.throws($q$select public.fleet_waiting(tests.id('demo'))$q$, 'release guard blocks fleet_waiting when the module is not published', '42501');
select tests.login(tests.id('super'));
select public.module_release_save('fleet', (public.module_release_history('fleet')->0->>'id')::bigint, null,
  (public.module_release_history('fleet')->0->>'id')::bigint);
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.fleet_board(tests.id('demo')) is not null, 'rolling back fleet restores the guard-passing default');

-- `hub` → testing + demo opt-in; the hub-manager assigned to DEMO still sees it, an ordinary hub does not.
select tests.login(tests.id('super'));
select public.module_release_save('hub', 0, jsonb_build_object('stage','testing','demo',true,
  'roles', jsonb_build_array(tests.id('manager_role'))));
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.hub_feed(tests.id('demo')) is not null, 'DEMO-assigned manager sees hub_feed during testing');
select tests.throws($q$select public.hub_feed(tests.id('hub_a1'))$q$, 'non-DEMO hub still blocked during testing', '42501');

-- `attendance` disable propagates to att_sheet_save even though its original permission check would have allowed the write.
select tests.login(tests.id('super'));
select public.module_release_save('attendance', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select public.att_sheet_save(tests.id('demo'), current_date, '[]'::jsonb)$q$,
  'release guard blocks att_sheet_save when attendance is disabled', '42501');

rollback;
