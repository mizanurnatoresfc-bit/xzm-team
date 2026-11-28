-- DEMO fixtures only. The Targets page must see the saved distribution mode even when the hub has no cached run.
begin;
set local time zone 'Asia/Dhaka';
select tests.fixture();
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code = 'zonal_manager' and p.code = 'data_entry.team.edit' on conflict do nothing;

select tests.login(tests.id('zonal_a'));
select tests.ok(public.data_entry_target_admin(tests.id('hub_a1'), current_date, null)->>'distribution_mode' = 'smart',
  'a hub with no saved mode reports smart');
select public.data_entry_distribution_mode_set(tests.id('hub_a1'), 'equal');
-- The hub is still switched off, so no run is written: the cached run cannot carry the mode.
select tests.ok(public.data_entry_target_admin(tests.id('hub_a1'), current_date, null)->'latest' = 'null'::jsonb,
  'a switched-off hub has no cached run');
select tests.ok(public.data_entry_target_admin(tests.id('hub_a1'), current_date, null)->>'distribution_mode' = 'equal',
  'the saved equal mode is reported even without a cached run');
select public.data_entry_distribution_mode_set(tests.id('hub_a1'), 'smart');
select tests.ok(public.data_entry_target_admin(tests.id('hub_a1'), current_date, null)->>'distribution_mode' = 'smart',
  'switching back to smart is reported at once');
select tests.throws(format('select public.data_entry_target_admin(%L, current_date, null)', tests.id('hub_b1')),
  'zone manager still cannot read another zone''s hub', '42501');
rollback;
