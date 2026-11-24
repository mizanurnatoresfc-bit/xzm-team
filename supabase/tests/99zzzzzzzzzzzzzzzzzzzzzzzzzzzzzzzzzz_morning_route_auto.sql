begin;
select tests.fixture();
select tests.hr_fixture();

insert into tests.ids values
  ('worker', tests.active_employee('Route Auto Rider', '951', tests.id('hub_a1'), '01711000951', '9510000000', 15000, tests.id('rider_login'))),
  ('pending_worker', tests.active_employee('Pending Auto Rider', '952', tests.id('hub_a1'), '01711000952', '9520000000'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

select tests.login(tests.id('zonal_a'));
select public.attendance_automation_set(tests.id('hub_a1'), '08:15', 10);
select tests.ok((public.attendance_automation_get(tests.id('hub_a1')) ->> 'daily_delay_minutes')::integer = 10,
  'zonal manager configures the hub deadline');
select tests.throws(format('select public.attendance_automation_get(%L)', tests.id('hub_b1')),
  'settings stay in the reviewers zone', '42501');
insert into tests.ids select 'route_today', public.route_save(jsonb_build_object(
  'hub_id', tests.id('hub_a1'), 'name', 'Morning Route', 'stops', '[{"name":"Station"}]'::jsonb));

select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.attendance_automation_set(%L,%L,0)', tests.id('hub_a1'), '08:00'),
  'hub manager cannot change the deadline', '42501');
select public.wf_morning_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 1,
  jsonb_build_object(tests.id('worker'), 'present'));
insert into tests.ids select 'morning_plan', public.route_plan_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date,
  jsonb_build_object('people', jsonb_build_array(jsonb_build_object('employee_id', tests.id('worker'), 'parcels', 7,
    'detail', jsonb_build_array(jsonb_build_object('route_id', tests.id('route_today'), 'parcels', 7))))), true);
select public.att_sheet_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date - 1,
  jsonb_build_array(jsonb_build_object('employee_id', tests.id('worker'), 'final_status', 'present', 'online_marked', true),
    jsonb_build_object('employee_id', tests.id('pending_worker'), 'final_status', 'late', 'online_marked', true)));

select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.route_plan_publish(%L,1,1)', tests.id('morning_plan')),
  'publication requires a submitted morning form', 'P0001');

select tests.logout();
update private.attendance_auto_settings set daily_since = daily_since - 1 where hub_id = tests.id('hub_a1');
select tests.ok((select j ->> 'morning' = '0' and j ->> 'daily' = '0' from private.attendance_auto_submit(
  (((now() at time zone 'Asia/Dhaka')::date + time '00:09') at time zone 'Asia/Dhaka')) j), 'nothing runs before deadline');
select tests.ok((select j ->> 'daily' = '1' and j ->> 'errors' = '0' from private.attendance_auto_submit(
  (((now() at time zone 'Asia/Dhaka')::date + time '00:10') at time zone 'Asia/Dhaka')) j), 'day sheet submits at next day grace deadline');
select tests.ok((select bool_and(s.status = 'submitted' and s.auto_submitted and s.submitted_by is null)
  from public.att_day_sheets s where s.hub_id = tests.id('hub_a1')),
  'automatic submission does not impersonate a manager');
select tests.ok(exists (select 1 from public.attendance_records where employee_id = tests.id('worker') and status = 'present')
  and not exists (select 1 from public.attendance_records where employee_id = tests.id('pending_worker')),
  'only verified lines reach the attendance register');

select tests.ok((select j ->> 'morning' = '1' and j ->> 'daily' = '0' from private.attendance_auto_submit(
  (((now() at time zone 'Asia/Dhaka')::date + time '08:15') at time zone 'Asia/Dhaka')) j),
  'morning draft submits once at local cutoff');
select tests.ok((select j ->> 'morning' = '0' and j ->> 'daily' = '0' from private.attendance_auto_submit(
  (((now() at time zone 'Asia/Dhaka')::date + time '08:16') at time zone 'Asia/Dhaka')) j),
  'repeated clock ticks do not resubmit');

select tests.login(tests.id('hub_mgr'));
select tests.ok((select g ->> 'auto_submitted' = 'true' and g -> 'people' = 'null'::jsonb
  from public.wf_morning_get(tests.id('hub_a1')) g), 'auto submission gives the hub manager a receipt');
select tests.ok((select g -> 'sheet' ->> 'pending_review' = '1'
  from public.att_sheet_get(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date - 1) g),
  'incomplete lines are visible as pending review');

select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.route_plan_publish(%L,1,2)', tests.id('morning_plan')),
  'an incorrect morning revision cannot approve', 'P0001');
select tests.throws(format('select public.route_plan_decide(%L,true)', tests.id('morning_plan')),
  'legacy decision cannot bypass a morning submission', 'P0001');
select tests.ok((public.route_plan_publish(tests.id('morning_plan'), 1, 1) ->> 'notifications')::integer = 2,
  'approval publishes and notifies the rider and hub manager');
select tests.ok((public.route_plan_publish(tests.id('morning_plan'), 1, 1) ->> 'already_published')::boolean,
  'retrying publication does not send another notification');
select tests.ok(public.route_plan_resend(tests.id('morning_plan'), 1, '33a5b2dc-00f3-492c-a4e0-15d04daaefe2') = 2,
  'explicit resend delivers the same approved revision');
select tests.ok(public.route_plan_resend(tests.id('morning_plan'), 1, '33a5b2dc-00f3-492c-a4e0-15d04daaefe2') = 2,
  'retrying a resend returns the original receipt');

select tests.login(tests.id('rider_login'));
select tests.ok(public.route_plan_mine() ->> 'parcels' = '7', 'rider immediately sees the approved work');
select tests.ok((select count(*) = 2 from public.notifications where kind = 'route_plan'),
  'rider gets precisely the approval and intentional resend');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.route_plan_published(tests.id('hub_a1')) ->> 'morning_revision' = '1',
  'hub manager sees the published plan snapshot');

select tests.login(tests.id('zonal_a'));
select public.route_plan_reopen(tests.id('morning_plan'), 'Review tomorrow''s load');
select tests.ok(public.route_plan_published(tests.id('hub_a1')) ->> 'version' = '1', 'approved version remains published during edits');
select public.att_sheet_unlock((select id from public.att_day_sheets where hub_id = tests.id('hub_a1')), 'Check the missing late time');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select x -> 'value' ->> 'final_status' = 'late' from jsonb_array_elements(public.att_sheet_get(tests.id('hub_a1'),
  (now() at time zone 'Asia/Dhaka')::date - 1) -> 'people') x where x ->> 'employee_id' = tests.id('pending_worker')::text),
  'unlock restores the incomplete draft values for correction');
rollback;
