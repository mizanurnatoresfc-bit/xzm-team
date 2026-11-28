-- Batch 3 expansion assertions: 7 table-returning RPCs wrapped in
-- 20261128074000_module_release_expansion_batch_3.sql. Transparent while each module
-- stays published, refused with 42501 once Super Admin flips the module.
begin;
select tests.fixture();
insert into public.hubs(zone_id, code, name) values (tests.id('zone_a'), 'DEMO', 'DEMO Hub');
insert into tests.ids select 'demo', id from public.hubs where code = 'DEMO';
insert into tests.ids select 'manager_role', id from public.roles where code = 'hub_manager';
select tests.grant_role(tests.id('hub_mgr'), 'hub_manager', 'hub', null, tests.id('demo'));

select tests.login(tests.id('hub_mgr'));
-- Published-default: every table-returning wrapper runs its private body
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

-- Flip 'attendance' → disabled → att_days_list refused
select tests.login(tests.id('super'));
select public.module_release_save('attendance', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select count(*) from public.att_days_list(tests.id('demo'), current_date - 7, current_date)$q$,
  'att_days_list blocked when attendance disabled', '42501');

-- Flip 'accounts' → disabled → every da_* table-return refused
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

-- Flip 'hub.logins' → disabled → hub_login_list refused
select tests.login(tests.id('super'));
select public.module_release_save('hub.logins', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select count(*) from public.hub_login_list(tests.id('demo'))$q$,
  'hub_login_list blocked when hub.logins disabled', '42501');

rollback;
