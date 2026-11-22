-- রোল ডেমো অডিট (22 Nov): a new HR request reaches the approvers at once; notice/reminder functions are closed to visitors.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('da1', tests.active_employee('Demo Rider', '871', tests.id('hub_a1'), '01711000871', '8710000000', 15000, tests.id('rider_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

select tests.login(tests.id('rider_login'));
insert into tests.ids select 'req1', public.hr_request_submit(
  (select id from public.hr_request_formats where kind = 'id_inactive' order by created_at limit 1), tests.id('da1'), tests.id('hub_a1'),
  jsonb_build_object('full_name', 'Demo Rider', 'employee_code', '871', 'hub', 'Hub A1', 'position', 'Rider', 'last_date', current_date::text,
                     'reason_type', 'চাকরি ছেড়ে দিচ্ছি', 'reason', 'test'), null, null, null, null, null, null);
select tests.logout();

select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('zonal_a') and title like 'নতুন আবেদন:%'
  and link = '/app/zonal/requests?id=' || tests.id('req1')), 'the zonal manager of that zone is told about the new request at once, with a link to the zonal inbox');
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('hr') and title like 'নতুন আবেদন:%'), 'HR (whole company) is told too');
select tests.ok(not exists (select 1 from public.notifications where profile_id = tests.id('rider_login') and title like 'নতুন আবেদন:%'), 'the sender is not told about their own request');
select tests.ok(not exists (select 1 from public.notifications where profile_id = tests.id('hub_b_mgr') and title like 'নতুন আবেদন:%'), 'a manager of another zone is not told');
select tests.ok(not exists (select 1 from public.notifications where profile_id = tests.id('inactive') and title like 'নতুন আবেদন:%'), 'an inactive account is not told');

select tests.ok((select bool_and(not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'))
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('my_report_line', 'notice_archive', 'notice_list', 'notice_mark_read', 'notice_publish', 'reminder_add', 'reminder_done', 'reminder_list', 'reminder_remove')),
  'notice and reminder functions: signed-in people only');
select tests.ok((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) = 1
  and has_function_privilege('anon', 'public.branding()', 'execute'), 'the only definer function a visitor may call is the public branding');
-- missing attendance: nothing before the hub's first day on the register
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) from public.my_att_gaps()) = 0, 'a hub that has never given attendance: no day is asked about');
select tests.logout();
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('da1'), current_date - 3, 'present');
insert into tests.ids values ('da2', tests.active_employee('Demo Rider Two', '872', tests.id('hub_a1'), '01711000872', '8720000000'));
select tests.ok((select array_agg(work_date order by work_date) from private.attendance_gap_days(current_date - 30, current_date, tests.id('da1'))) = array[current_date - 2, current_date - 1],
  'the person: only the days after the hub started, that have no attendance');
select tests.ok((select array_agg(work_date order by work_date) from private.attendance_gap_days(current_date - 30, current_date, tests.id('da2'))) = array[current_date - 3, current_date - 2, current_date - 1],
  'a colleague in the same hub: from the hub''s first day, not from a month back');
rollback;
