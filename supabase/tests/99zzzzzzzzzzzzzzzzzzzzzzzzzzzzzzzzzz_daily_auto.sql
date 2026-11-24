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
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '00:10') at time zone 'Asia/Dhaka') = '{"daily":0,"errors":0}'::jsonb,
  'incomplete daily draft stays open at cutoff');
select tests.ok(not exists (select 1 from public.attendance_records where employee_id in (tests.id('present_worker'), tests.id('pending_worker'))),
  'no official rows are written from an incomplete draft');
select tests.ok((select count(*) = 2 and count(distinct profile_id) = 2 from public.notifications
  where kind = 'attendance_cutoff' and profile_id in (tests.id('hub_mgr'), tests.id('zonal_a'))), 'hub and zonal managers are notified');
select private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '00:11') at time zone 'Asia/Dhaka');
select tests.ok((select count(*) = 2 from public.notifications where kind = 'attendance_cutoff'),
  'a repeat cutoff does not duplicate alerts');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date - 1,
  jsonb_build_array(jsonb_build_object('employee_id', tests.id('pending_worker'), 'final_status', 'late', 'online_marked', true, 'late_time', '08:30')));
select tests.logout();
select tests.ok(private.att_daily_auto_submit(((now() at time zone 'Asia/Dhaka')::date + time '00:12') at time zone 'Asia/Dhaka') = '{"daily":1,"errors":0}'::jsonb,
  'once complete, the draft submits on the next run');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.att_sheet_get(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date - 1) #>> '{sheet,auto_submitted}' = 'true',
  'manager sees automatic submission');
rollback;
