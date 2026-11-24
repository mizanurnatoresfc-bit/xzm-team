begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('present_worker', tests.active_employee('Ready staff', '951', tests.id('hub_a1'), '01711000951', '9510000000')),
  ('pending_worker', tests.active_employee('Pending staff', '952', tests.id('hub_a1'), '01711000952', '9520000000'));

select tests.login(tests.id('zonal_a'));
select public.wf_att_policy_save(tests.id('zone_a'), '{"morning_cutoff":"08:00"}');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date - 1,
  jsonb_build_array(jsonb_build_object('employee_id', tests.id('present_worker'), 'final_status', 'present', 'online_marked', true),
    jsonb_build_object('employee_id', tests.id('pending_worker'), 'final_status', 'late', 'online_marked', true)));

select tests.logout();
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '12:00') at time zone 'Asia/Dhaka') ->> 'daily' = '0',
  'morning settings do not enable daily submission');
select tests.login(tests.id('zonal_a'));
select public.wf_att_policy_save(tests.id('zone_a'), '{"day_time":"00:00","day_extra":10}');
select tests.logout();
select tests.ok((select day_auto_since = (now() at time zone 'Asia/Dhaka')::date
  from public.wf_att_policy where zone_id = tests.id('zone_a')), 'daily settings activate on the local work date');
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '12:00') at time zone 'Asia/Dhaka') ->> 'daily' = '0',
  'activation does not unexpectedly process earlier drafts');
update public.wf_att_policy set day_auto_since = day_auto_since - 1 where zone_id = tests.id('zone_a');
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '00:09') at time zone 'Asia/Dhaka') ->> 'daily' = '0',
  'nothing submits before the configured daily deadline');
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '00:10') at time zone 'Asia/Dhaka') = '{"daily":1,"errors":0}'::jsonb,
  'daily draft submits at the configured local deadline');
select tests.ok(exists (select 1 from public.attendance_records where employee_id = tests.id('present_worker') and status = 'present')
  and not exists (select 1 from public.attendance_records where employee_id = tests.id('pending_worker')),
  'complete rows are recorded and incomplete rows do not enter the register');
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '00:11') at time zone 'Asia/Dhaka') ->> 'daily' = '0',
  'the next scheduled run does not submit the same sheet again');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g -> 'sheet' ->> 'auto_submitted' = 'true' and g -> 'sheet' ->> 'pending_review' = '1'
  from public.att_sheet_get(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date - 1) g),
  'manager can see the automatic submission and pending rows');
select tests.login(tests.id('zonal_a'));
select public.att_sheet_unlock((select id from public.att_day_sheets where hub_id = tests.id('hub_a1')), 'Check the missing late time');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select x -> 'value' ->> 'final_status' = 'late' from jsonb_array_elements(public.att_sheet_get(tests.id('hub_a1'),
  (now() at time zone 'Asia/Dhaka')::date - 1) -> 'people') x where x ->> 'employee_id' = tests.id('pending_worker')::text),
  'the incomplete original input is restored for correction');
select tests.logout();
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '00:11') at time zone 'Asia/Dhaka') ->> 'daily' = '0',
  'reopened corrections remain editable for manual resubmission');
rollback;
