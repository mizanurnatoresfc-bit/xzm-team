-- Batch 2 expansion assertions: the 14 additional RPCs wrapped in
-- 20261128070100_module_release_expansion_batch_2.sql stay transparent while their module is
-- at the `legacy_live = true` published default, and start refusing with 42501 once Super
-- Admin flips the module. Covers attendance, accounts, workforce and hr families.
begin;
select tests.fixture();
insert into public.hubs(zone_id, code, name) values (tests.id('zone_a'), 'DEMO', 'DEMO Hub');
insert into tests.ids select 'demo', id from public.hubs where code = 'DEMO';
insert into tests.ids select 'manager_role', id from public.roles where code = 'hub_manager';
select tests.grant_role(tests.id('hub_mgr'), 'hub_manager', 'hub', null, tests.id('demo'));

select tests.login(tests.id('hub_mgr'));

-- Published-default: every new wrapper runs the underlying RPC.
select tests.ok(public.att_reopen_list(tests.id('demo')) is not null, 'att_reopen_list reachable at published default');
select tests.ok(public.att_self_list(tests.id('demo'), current_date) is not null, 'att_self_list reachable at published default');
select tests.ok(public.att_month_get(tests.id('demo'), current_date) is not null, 'att_month_get reachable at published default');
select tests.ok(public.da_accounts_history(tests.id('demo')) is not null, 'da_accounts_history reachable at published default');
select tests.ok(public.wf_pending_hub_today(tests.id('demo')) is not null, 'wf_pending_hub_today reachable at published default');

-- Flip 'attendance' to disabled → every attendance wrapper refuses with 42501.
select tests.login(tests.id('super'));
select public.module_release_save('attendance', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select public.att_sheet_submit(tests.id('demo'), current_date, '[]'::jsonb)$q$, 'att_sheet_submit blocked when attendance disabled', '42501');
select tests.throws($q$select public.att_days_save(tests.id('demo'), current_date, current_date, '[]'::jsonb)$q$, 'att_days_save blocked when attendance disabled', '42501');
select tests.throws($q$select public.att_month_sheet(tests.id('demo'), current_date)$q$, 'att_month_sheet blocked when attendance disabled', '42501');
select tests.throws($q$select public.att_month_submit(tests.id('demo'), current_date)$q$, 'att_month_submit blocked when attendance disabled', '42501');
select tests.throws($q$select public.att_reopen_open(tests.id('demo'), current_date, current_date, 30, 'test')$q$, 'att_reopen_open blocked when attendance disabled', '42501');

-- Restore attendance via rollback.
select tests.login(tests.id('super'));
select public.module_release_save('attendance', (public.module_release_history('attendance')->0->>'id')::bigint, null,
  (public.module_release_history('attendance')->0->>'id')::bigint);
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.att_reopen_list(tests.id('demo')) is not null, 'rollback restores attendance wrappers');

-- Flip 'accounts' to testing + demo opt-in → DEMO manager passes, other hubs still blocked.
select tests.login(tests.id('super'));
select public.module_release_save('accounts', 0, jsonb_build_object('stage','testing','demo',true,
  'roles', jsonb_build_array(tests.id('manager_role'))));
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.da_accounts_history(tests.id('demo')) is not null, 'DEMO-assigned manager sees da_accounts_history during testing');
select tests.throws($q$select public.da_assign_accountant(tests.id('hub_a1'), tests.id('hub_mgr'), 'test')$q$, 'non-DEMO hub blocked for da_assign_accountant during testing', '42501');
select tests.throws($q$select public.da_import_save(tests.id('hub_a1'), current_date, 'x', '{}'::jsonb)$q$, 'non-DEMO hub blocked for da_import_save during testing', '42501');

-- Workforce + HR flips exercise the other two module keys.
select tests.login(tests.id('super'));
select public.module_release_save('workforce', 0, '{"stage":"development"}');
select public.module_release_save('hr', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select public.wf_pending_hub_today(tests.id('demo'))$q$, 'wf_pending_hub_today blocked when workforce in development', '42501');
select tests.throws($q$select public.wf_pending_month(tests.id('demo'), current_date)$q$, 'wf_pending_month blocked when workforce in development', '42501');
select tests.throws($q$select public.hr_staff_join_request(tests.id('demo'), tests.id('position_a'), '{}'::jsonb)$q$, 'hr_staff_join_request blocked when hr disabled', '42501');

rollback;
