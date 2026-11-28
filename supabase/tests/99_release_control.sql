begin;
select tests.fixture();
insert into public.hubs(zone_id, code, name) values (tests.id('zone_a'), 'DEMO', 'DEMO Hub');
insert into tests.ids select 'demo', id from public.hubs where code = 'DEMO';
insert into tests.ids select 'manager_role', id from public.roles where code = 'hub_manager';
select tests.grant_role(tests.id('hub_mgr'), 'hub_manager', 'hub', null, tests.id('demo'));
insert into private.release_module(id, parent) values ('routes.future', 'routes');

select tests.login_anon();
select tests.throws($q$select public.module_release_snapshot('web')$q$, 'anonymous cannot read release decisions', '42501');

select tests.login(tests.id('admin'));
select tests.throws($q$select public.module_release_admin()$q$, 'ordinary admin cannot read configuration', '42501');
select tests.throws($q$select public.module_release_save('routes',0,'{}')$q$, 'ordinary admin cannot write configuration', '42501');
select tests.throws($q$select public.module_release_history('routes')$q$, 'ordinary admin cannot read the audit log', '42501');
select tests.throws($q$select public.module_release_snapshot('web',null,tests.id('manager_role'))$q$, 'ordinary admin cannot preview another role', '42501');
select tests.throws($q$select * from private.release_config$q$, 'configuration table blocks direct reads', '42501');
select tests.throws($q$select * from private.route_plan_get(tests.id('demo'))$q$, 'private feature implementation cannot be called directly', '42501');
select tests.ok((public.module_release_snapshot('web')->'routes'->>'allowed')::boolean, 'existing routes are live by default');
select tests.ok(not (public.module_release_snapshot('web')->'routes.future'->>'allowed')::boolean, 'new registry entry defaults to planning');

select tests.login(tests.id('super'));
select tests.throws($q$select public.module_release_save('routes',0,'{"stage":"ready"}')$q$, 'Release Ready requires trusted evidence', '22023');
select tests.throws($q$select public.module_release_save('routes.future',0,'{"stage":"published"}')$q$, 'new module cannot publish without evidence', '22023');
select tests.throws($q$select public.module_release_save('core',0,'{"enabled":false}')$q$, 'admin recovery cannot be disabled', 'P0002');
select tests.throws($q$select public.module_release_record_evidence('routes',226,repeat('a',40),1,'success','preview_verified')$q$, 'even Super Admin cannot write verification evidence', '42501');
select public.module_release_save('routes.tab-plan',0,jsonb_build_object('stage','testing','demo',true,
  'roles',jsonb_build_array(tests.id('manager_role')), 'menu_order',2));
select tests.throws($q$select public.module_release_save('routes.tab-plan',0,'{}')$q$, 'concurrent stale save is rejected', '40001');
select tests.ok((public.module_release_snapshot('web',tests.id('demo'),tests.id('manager_role'))->'routes.tab-plan'->>'allowed')::boolean, 'admin role preview honors DEMO scope');
select tests.ok((public.module_release_snapshot('web',tests.id('demo'),tests.id('manager_role'))->'routes.tab-plan'->>'order')::integer = 2, 'menu order persists');

select tests.login(tests.id('hub_mgr'));
select tests.ok((public.module_release_snapshot('android',tests.id('demo'))->'routes.tab-plan'->>'allowed')::boolean, 'DEMO assigned role sees testing module on Android');
select tests.ok(not (public.module_release_snapshot('web',tests.id('hub_a1'))->'routes.tab-plan'->>'allowed')::boolean, 'ordinary hub does not see testing module');
select tests.throws($q$select public.route_plan_get(tests.id('hub_a1'))$q$, 'direct plan RPC is blocked outside DEMO', '42501');

select tests.login(tests.id('noroles'));
select tests.throws($q$select public.route_plan_get(tests.id('demo'))$q$, 'DEMO hub selection does not extend role scope', '42501');

select tests.login(tests.id('super'));
select public.module_release_save('routes',0,'{"enabled":false}');
select tests.ok(not (public.module_release_snapshot('web',tests.id('demo'),tests.id('manager_role'))->'routes.tab-plan'->>'allowed')::boolean, 'parent disable applies to sub-module');
select public.module_release_save('routes',(public.module_release_history('routes')->0->>'id')::bigint,null,
  (public.module_release_history('routes')->0->>'id')::bigint);
select tests.ok((public.module_release_snapshot('web',tests.id('demo'),tests.id('manager_role'))->'routes.tab-plan'->>'allowed')::boolean, 'authorized rollback restores effective availability');
select tests.ok((public.module_release_history('routes')->0->>'rollback_of') is not null, 'rollback has an audit entry');
select public.module_release_save('fleet',0,jsonb_build_object('roles','[]'::jsonb,
  'users',jsonb_build_object(tests.id('hub_mgr'),true),'hubs',jsonb_build_array(tests.id('demo')),'platforms','["web"]'::jsonb));

select tests.login(tests.id('hub_mgr'));
select tests.ok((public.module_release_snapshot('web',tests.id('demo'))->'fleet'->>'allowed')::boolean, 'user allow overrides release role list');
select tests.ok(not (public.module_release_snapshot('web',tests.id('hub_a1'))->'fleet'->>'allowed')::boolean, 'user allow leaves hub restriction in force');
select tests.ok(not (public.module_release_snapshot('android',tests.id('demo'))->'fleet'->>'allowed')::boolean, 'user allow leaves Android restriction in force');

select tests.logout();
set local role service_role;
select public.module_release_record_evidence('routes.future',226,repeat('a',40),1,'success','preview_verified');
reset role;
select tests.login(tests.id('super'));
select public.module_release_save('routes.future',0,'{"stage":"ready"}');
select tests.ok(not (public.module_release_snapshot('web')->'routes.future'->>'allowed')::boolean, 'verified readiness does not expose unpublished module');
select public.module_release_save('routes.future',(public.module_release_history('routes.future')->0->>'id')::bigint,'{"stage":"published"}');
select tests.ok((public.module_release_snapshot('web')->'routes.future'->>'allowed')::boolean, 'verified new module may publish');
select tests.ok(not (public.module_release_snapshot('web') ? 'unknown'), 'unregistered module carries no release decision');
rollback;
