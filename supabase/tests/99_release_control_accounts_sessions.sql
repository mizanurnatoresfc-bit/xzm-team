begin;
select tests.fixture();

insert into public.da_sessions (hub_id, zone_id, account_date, started_by)
values (tests.id('hub_a1'), tests.id('zone_a'), current_date, tests.id('hub_mgr'));
insert into tests.ids
select 'release_sheet', id from public.da_sessions where hub_id = tests.id('hub_a1');

select tests.ok(not has_function_privilege('authenticated', 'private.da_release_session_hub(uuid)', 'execute'),
  'authenticated callers cannot invoke the internal session lookup');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select public.da_bank_done(tests.id('release_sheet'))$q$,
  'published bank workflow keeps deposit validation', '22023');
select tests.throws($q$select public.da_cell_set(tests.id('release_sheet'), 'riders', null, 'invalid', 'test')$q$,
  'published cell workflow keeps column validation', '22023');
select tests.ok(public.da_report_save(tests.id('release_sheet'), 'RELEASE-TEST', 5) is not null,
  'published accounts allow saving a report ID');
select tests.ok(public.da_deposit_save(tests.id('release_sheet'), 5) is not null,
  'published accounts allow saving a deposit');
select tests.throws($q$select public.da_bank_done(null)$q$,
  'unknown session does not fall back to unscoped release access', '42501');

select tests.login(tests.id('super'));
select public.module_release_save('accounts', 0, '{"stage":"disabled","enabled":false}');
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select public.da_bank_done(tests.id('release_sheet'))$q$,
  'disabled accounts block bank confirmation for the stored hub', '42501');
select tests.throws($q$select public.da_cell_set(tests.id('release_sheet'), 'riders', null, 'invalid', 'test')$q$,
  'disabled accounts block editing cells for the stored hub', '42501');

select tests.throws($q$select public.da_report_save(tests.id('release_sheet'), 'BLOCKED', 5)$q$,
  'disabled accounts block saving report IDs', '42501');
select tests.throws($q$select public.da_deposit_save(tests.id('release_sheet'), 5)$q$,
  'disabled accounts block saving deposits', '42501');
select tests.throws($q$select public.da_apply_fixed(tests.id('release_sheet'))$q$,
  'disabled accounts block sheet presets through shared edit authorization', '42501');

select tests.login(tests.id('super'));
select tests.throws($q$select public.da_verify(tests.id('release_sheet'), 'note', 'blocked')$q$,
  'disabled accounts block sheet verification', '42501');
select tests.throws($q$select public.da_reopen(tests.id('release_sheet'), 'blocked')$q$,
  'disabled accounts block reopening a sheet', '42501');
select tests.throws($q$select public.da_page_enter(tests.id('release_sheet'))$q$,
  'disabled accounts block tracking a sheet visit', '42501');
select public.module_release_save('accounts', (public.module_release_history('accounts')->0->>'id')::bigint, null,
  (public.module_release_history('accounts')->0->>'id')::bigint);
select tests.login(tests.id('hub_mgr'));
select tests.throws($q$select public.da_bank_done(tests.id('release_sheet'))$q$,
  'rollback restores bank workflow validation', '22023');
select tests.ok(public.da_apply_fixed(tests.id('release_sheet')) is not null,
  'rollback restores sheet presets through shared edit authorization');
rollback;
