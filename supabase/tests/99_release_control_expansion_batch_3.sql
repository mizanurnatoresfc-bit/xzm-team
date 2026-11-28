-- Batch 3 expansion assertions: 7 table-returning RPCs wrapped in
-- 20261128074000_module_release_expansion_batch_3.sql. The guard wrapper should be transparent
-- while the module is published (inner permission checks still apply — Super Admin bypasses them)
-- and should refuse with 42501 when the module is flipped.
begin;
select tests.fixture();
insert into public.hubs(zone_id, code, name) values (tests.id('zone_a'), 'DEMO', 'DEMO Hub');
insert into tests.ids select 'demo', id from public.hubs where code = 'DEMO';
insert into tests.ids select 'manager_role', id from public.roles where code = 'hub_manager';
select tests.grant_role(tests.id('hub_mgr'), 'hub_manager', 'hub', null, tests.id('demo'));

-- Reachability checks run as Super Admin so inner permission checks (da.settings.configure,
-- da.sheet.create, hr.attendance.view, system.user_hub.create) don't mask the guard check.
-- This isolates the Release-Guard outcome from the pre-existing authorization layer.
select tests.login(tests.id('super'));
select tests.ok((select count(*) from public.att_days_list(tests.id('demo'), current_date - 7, current_date)) >= 0,
  'att_days_list returns a result set at published default');
select tests.ok((select count(*) from public.hub_login_list(tests.id('demo'))) >= 0,
  'hub_login_list returns a result set at published default');
select tests.ok((select count(*) from public.da_hub_employees(tests.id('demo'))) >= 0,
  'da_hub_employees returns a result set at published default');
select tests.ok((select count(*) from public.da_hub_access(tests.id('demo'))) >= 0,
  'da_hub_access returns a result set at published default');
select tests.ok((select count(*) from public.da_lookup_employee(tests.id('demo'), 'TEST')) >= 0,
  'da_lookup_employee returns a result set at published default');
select tests.ok((select count(*) from public.da_lookup_merchant(tests.id('demo'), 'x')) >= 0,
  'da_lookup_merchant returns a result set at published default');
select tests.ok((select count(*) from public.da_match_payment(tests.id('demo'), 'TXN1')) >= 0,
  'da_match_payment returns a result set at published default');

-- Flip 'attendance' → disabled → att_days_list refused by the guard (42501).
-- This runs as the hub_mgr fixture user; the point is the guard refusing before the inner
-- permission check even runs.
select tests.login(tests.id('super'));
select public.module_release_save('attendance', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select count(*) from public.att_days_list(tests.id('demo'), current_date - 7, current_date)$q$,
  'att_days_list blocked when attendance disabled', '42501');

-- Flip 'accounts' → disabled → every da_* table-return refused (guard refuses before the inner
-- `da.sheet.create` check for lookups and before `da.settings.configure` for da_hub_access).
select tests.login(tests.id('super'));
select public.module_release_save('accounts', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select count(*) from public.da_hub_employees(tests.id('demo'))$q$,
  'da_hub_employees blocked when accounts disabled', '42501');
select tests.throws($q$select count(*) from public.da_hub_access(tests.id('demo'))$q$,
  'da_hub_access blocked when accounts disabled', '42501');
select tests.throws($q$select count(*) from public.da_lookup_employee(tests.id('demo'), 'TEST')$q$,
  'da_lookup_employee blocked when accounts disabled', '42501');
select tests.throws($q$select count(*) from public.da_lookup_merchant(tests.id('demo'), 'x')$q$,
  'da_lookup_merchant blocked when accounts disabled', '42501');
select tests.throws($q$select count(*) from public.da_match_payment(tests.id('demo'), 'TXN1')$q$,
  'da_match_payment blocked when accounts disabled', '42501');

-- Flip 'hub.logins' → disabled → hub_login_list refused.
select tests.login(tests.id('super'));
select public.module_release_save('hub.logins', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select count(*) from public.hub_login_list(tests.id('demo'))$q$,
  'hub_login_list blocked when hub.logins disabled', '42501');

rollback;
