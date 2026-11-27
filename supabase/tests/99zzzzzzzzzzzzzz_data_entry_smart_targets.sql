-- Isolated DEMO Hub fixtures. No live records or jobs are touched.
begin;
set local time zone 'Asia/Dhaka';
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('smart_a', tests.active_employee('DEMO Ada', '711', tests.id('hub_a1'), '01711000711', '7110101010', 15000, tests.id('rider_login'))),
  ('smart_b', tests.active_employee('DEMO Bina', '712', tests.id('hub_a1'), '01711000712', '7120101010')),
  ('smart_c', tests.active_employee('DEMO Chitra', '713', tests.id('hub_a1'), '01711000713', '7130101010')),
  ('smart_d', tests.active_employee('DEMO Dipa', '714', tests.id('hub_a1'), '01711000714', '7140101010'));
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code = 'zonal_manager' and p.code = 'data_entry.team.edit';

select tests.login(tests.id('zonal_a'));
insert into tests.ids
select 'smart_member_' || right(name,1), public.data_entry_team_save(tests.id('zone_a'), id, tests.id('hub_a1'), '{}', true, null)
from tests.ids where name in ('smart_a','smart_b','smart_c','smart_d');
select public.data_entry_target_save(tests.id('hub_a1'), current_date, id, 'rule',
  jsonb_build_object('working_minutes', 90, 'break_minutes', 30,
    'initial_parcels_per_hour', case when right(name,1) in ('a','b') then 150 else 100 end,
    'initial_points_per_hour', case when right(name,1) in ('a','b') then 300 else 200 end))
from tests.ids where name in ('smart_member_a','smart_member_b','smart_member_c','smart_member_d');
select tests.throws(format('select public.data_entry_target_admin(%L, current_date, null)', tests.id('hub_b1')),
  'zone manager cannot see another zone''s target settings', '42501');
select tests.logout();

with merchants as (
  insert into public.merchants(code, name, hub_id)
  select 'SMART' || x, 'DEMO Merchant ' || x, tests.id('hub_a1') from generate_series(1, 10) x
  returning code, id
)
insert into tests.ids select 'smart_merchant_' || substring(code::text from 6), id from merchants;

with morning as (
  insert into public.wf_morning_subs(hub_id, zone_id, work_date, status, submit_mode, submitted_at)
  values (tests.id('hub_a1'), tests.id('zone_a'), private.wf_today(), 'submitted', 'manager', now())
  returning id
)
insert into public.wf_morning_lines(sub_id, employee_id, state)
select morning.id, tests.id('smart_' || tag), 'present' from morning cross join unnest(array['a','b','c','d']) tag;

insert into public.pickup_consolidations (
  pickup_date, hub_id, zone_id, merchant_id, trip_no, parcel_count,
  cod_amount, collection_amount, accepted_submission_id, submission_count, had_conflict, approved_by
)
select private.wf_today() - offset_days, tests.id('hub_a1'), tests.id('zone_a'), tests.id('smart_merchant_1'), 1, 500,
  0, 0, gen_random_uuid(), 1, false, tests.id('zonal_a')
from generate_series(1, 7) offset_days;

select tests.login(tests.id('zonal_a'));
select public.data_entry_target_save(tests.id('hub_a1'), current_date, null, 'hub', '{"enabled":true}');
select tests.ok(public.data_entry_target_admin(tests.id('hub_a1'), current_date, null)#>>'{latest,forecast_pickups}' = '500',
  'DEMO seven verified days forecast 500');
select tests.ok(public.data_entry_target_admin(tests.id('hub_a1'), current_date, null)#>'{latest,actual_pickups}' = 'null'::jsonb,
  'estimate remains separate before the first actual pickup');
select tests.login(tests.id('rider_login'));
select tests.ok(public.data_entry_target_mine()#>>'{0,worker,forecast,parcels}' = '150',
  'employee sees own 150 parcel forecast and approved initial capacity');
select tests.ok(public.data_entry_target_mine()#>>'{0,worker,parcel_rate_source}' = 'approved_initial',
  'one-tap data explains approved initial capacity');
select tests.ok(not (public.data_entry_target_mine()#>'{0,summary}') ? 'workers', 'self report omits names and rows for other workers');
select tests.throws(format('select public.data_entry_target_admin(%L, current_date, null)', tests.id('hub_a1')),
  'employee cannot read manager settings', '42501');
select tests.logout();

insert into public.pickup_consolidations (
  pickup_date, hub_id, zone_id, merchant_id, trip_no, parcel_count,
  cod_amount, collection_amount, accepted_submission_id, submission_count, had_conflict, approved_by
)
select private.wf_today(), tests.id('hub_a1'), tests.id('zone_a'), tests.id('smart_merchant_' || x), 1, 80,
  0, 0, gen_random_uuid(), 1, false, tests.id('zonal_a')
from generate_series(1, 10) x;
select tests.ok(private.data_entry_target_tick() = 1, 'scheduled tick applies actual pickup changes');
select tests.ok(private.data_entry_target_tick() = 0, 'retry does not create duplicate history');
select tests.ok((select snapshot->>'actual_pickups' = '800' and snapshot->>'actual_merchants' = '10'
 and snapshot->>'actual_work_points' = '850' and snapshot->>'forecast_pickups' = '500'
 and reason = 'verified_pickup_changed' from private.data_entry_target_runs order by id desc limit 1),
  'actual 800 parcel / 10 merchant allocation uses 850 Work Points, keeps forecast 500 and logs its reason');
select tests.ok((select sum((w.value->'actual_remaining'->>'parcels')::integer) = 800
  from jsonb_each(private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today())->'workers') w),
  'whole actual targets reconcile to 800');

select tests.login(tests.id('zonal_a'));
select public.data_entry_target_save(tests.id('hub_a1'), current_date, tests.id('smart_member_a'), 'observation',
  '{"senior_minutes":10,"loading_minutes":10,"big_parcel_minutes":5,"training_minutes":5,"other_minutes":0,"entry_minutes":15,"attempted":30,"correct":27,"merchants":2,"complex":1}');
select public.data_entry_target_save(tests.id('hub_a1'), current_date, null, 'complexity', '{"complex_parcels":20}');
select public.data_entry_target_save(tests.id('hub_a1'), current_date, tests.id('smart_member_a'), 'profile',
  '{"reference_count":100,"reporting_note":"On time","collaboration_note":"Trained a colleague","contribution_note":"Supports the hub"}');
select tests.ok(public.data_entry_target_admin(tests.id('hub_a1'), current_date, tests.id('smart_member_a'))#>>'{profile,reference_count}' = '100',
  'performance profile is stored separately');
select tests.login(tests.id('rider_login'));
select tests.ok(public.data_entry_target_mine()#>>'{0,worker,entry_minutes}' = '30'
 and (public.data_entry_target_mine()#>>'{0,worker,remaining_hub_minutes}')::numeric = 15
 and public.data_entry_target_mine()#>>'{0,worker,completed}' = '27'
 and public.data_entry_target_mine()#>>'{0,summary,actual_work_points}' = '890',
  'approved duties and elapsed time reduce remaining capacity and completed counts stay separate');

select tests.logout();
update public.wf_morning_lines set state = 'absent' where employee_id = tests.id('smart_b');
insert into public.leave_requests(employee_id, leave_type_id, from_date, to_date, reason, status, decided_by, decided_at)
select tests.id('smart_c'), id, private.wf_today(), private.wf_today(), 'DEMO approved leave', 'approved', tests.id('zonal_a'), now()
from public.leave_types where code = 'casual';
select private.data_entry_target_tick();
select tests.ok((select snapshot->'workers'->tests.id('smart_member_b')::text->>'attendance' = 'absent'
 and snapshot->'workers'->tests.id('smart_member_c')::text->>'attendance' = 'leave'
 and (snapshot#>>'{actual_summary,unassigned}')::integer > 0
 from private.data_entry_target_runs order by id desc limit 1),
  'absent and approved leave workers have no new capacity and overflow stays unassigned');

select tests.login(tests.id('zonal_a'));
select public.data_entry_target_save(tests.id('hub_a1'), current_date - offset_days, tests.id('smart_member_a'), 'observation',
  '{"senior_minutes":0,"loading_minutes":0,"big_parcel_minutes":0,"training_minutes":0,"other_minutes":0,"entry_minutes":60,"attempted":100,"correct":90,"merchants":10,"complex":5}')
from generate_series(1, 3) offset_days;
select tests.login(tests.id('rider_login'));
select tests.ok(public.data_entry_target_mine()#>>'{0,worker,point_rate_source}' = 'verified'
 and (public.data_entry_target_mine()#>>'{0,worker,point_rate}')::numeric = 144
 and (public.data_entry_target_mine()#>>'{0,worker,prior_accuracy_pct}')::numeric = 90,
  'three verified hours derive a complexity and accuracy adjusted hourly rate');
select tests.login(tests.id('noroles'));
select tests.ok(public.data_entry_target_mine() = '[]'::jsonb, 'other account sees no employee target data');
rollback;
