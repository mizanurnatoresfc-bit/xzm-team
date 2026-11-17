-- Hub Operations Dashboard: hub reports, staff statuses, status log, summaries, boss reports.
begin;
create function tests.today() returns date language sql stable as $$ select (now() at time zone 'Asia/Dhaka')::date $$;
grant execute on function tests.today() to authenticated;
select tests.fixture();
select tests.hr_fixture();
insert into public.positions (department_id, code, name, name_bn) values
  (tests.id('dept_ops'), 'MANAGER', 'Manager', 'ম্যানেজার'),
  (tests.id('dept_ops'), 'HUBCC', 'Hub CC', 'হাব সিসি'),
  (tests.id('dept_ops'), 'DATAENTRY', 'Data Entry', 'ডাটা এন্ট্রি');
insert into tests.ids select 'pos_mgr', id from public.positions where code = 'MANAGER';
insert into tests.ids select 'pos_cc', id from public.positions where code = 'HUBCC';
insert into tests.ids select 'pos_entry', id from public.positions where code = 'DATAENTRY';
insert into tests.ids values
  ('boss', tests.make_user('boss@test.local', 'Boss')),
  ('zonal_b', tests.make_user('zonal.b@test.local', 'Zonal B'));
select tests.grant_role(tests.id('boss'), 'head_office_manager');
select tests.grant_role(tests.id('zonal_b'), 'zonal_manager', 'zone', tests.id('zone_b'));
insert into tests.ids values
  ('m1', tests.active_employee('Mgr One', '701', tests.id('hub_a1'), '01711000701', '7010101010')),
  ('c1', tests.active_employee('CC One', '702', tests.id('hub_a1'), '01711000702', '7020101010')),
  ('e1', tests.active_employee('Entry One', '703', tests.id('hub_a1'), '01711000703', '7030101010')),
  ('r1', tests.active_employee('Rider One', '704', tests.id('hub_a1'), '01711000704', '7040101010')),
  ('a2', tests.active_employee('Rider A2', '705', tests.id('hub_a2'), '01711000705', '7050101010')),
  ('b1', tests.active_employee('Rider B1', '706', tests.id('hub_b1'), '01711000706', '7060101010'));
update public.employees set position_id = tests.id('pos_mgr') where id = tests.id('m1');
update public.employees set position_id = tests.id('pos_cc') where id = tests.id('c1');
update public.employees set position_id = tests.id('pos_entry') where id = tests.id('e1');
-- A leave application and an attendance register entry that the panel should show as hints.
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, status)
select tests.id('r1'), id, tests.today(), tests.today(), 'জ্বর', 'pending' from public.leave_types where code = 'sick';
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('c1'), tests.today(), 'present');

-- ---------- access ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.hub_ops_panel(%L, %L)$$, tests.id('hub_a1'), tests.today()), 'a hub manager has no hub operations panel', '42501');
select tests.throws(format($$select public.hub_ops_summary(%L, %L, %L)$$, tests.id('zone_a'), tests.today(), tests.today()), 'nor the zonal summary', '42501');
select tests.throws('select * from public.hub_ops_reports', 'the tables are not read directly', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.hub_ops_panel(%L, %L)$$, tests.id('hub_b1'), tests.today()), 'zonal manager A cannot open a hub of zone B', '42501');
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{}'::jsonb)$$, tests.id('hub_b1'), tests.today()), 'nor write to it', '42501');
select tests.throws(format($$select public.hub_ops_summary(%L, %L, %L)$$, tests.id('zone_b'), tests.today(), tests.today()), 'nor read zone B''s summary', '42501');

-- ---------- the panel ----------
create temp table p as select public.hub_ops_panel(tests.id('hub_a1'), tests.today()) v;
grant select on p to authenticated;
select tests.ok((select v -> 'report' = 'null'::jsonb from p), 'no report yet');
select tests.ok((select jsonb_array_length(v -> 'roster') = 4 from p), 'the hub''s HR staff are listed (no new records)');
select tests.ok((select x ->> 'group_key' = 'manager' from p, jsonb_array_elements(v -> 'roster') x where x ->> 'employee_id' = tests.id('m1')::text), 'Manager goes to the Manager group');
select tests.ok((select x ->> 'group_key' = 'hub_cc' from p, jsonb_array_elements(v -> 'roster') x where x ->> 'employee_id' = tests.id('c1')::text), 'Hub CC goes to the Hub CC group');
select tests.ok((select x ->> 'group_key' = 'entry_man' from p, jsonb_array_elements(v -> 'roster') x where x ->> 'employee_id' = tests.id('e1')::text), 'Data Entry goes to the Entry Man group');
select tests.ok((select x ->> 'group_key' = 'rider' from p, jsonb_array_elements(v -> 'roster') x where x ->> 'employee_id' = tests.id('r1')::text), 'Rider goes to an additional group');
select tests.ok((select x #>> '{hints,leave,status}' = 'pending' from p, jsonb_array_elements(v -> 'roster') x where x ->> 'employee_id' = tests.id('r1')::text), 'a leave application is shown as a hint');
select tests.ok((select x #>> '{hints,register}' = 'present' from p, jsonb_array_elements(v -> 'roster') x where x ->> 'employee_id' = tests.id('c1')::text), 'the attendance register is shown as a hint');
select tests.ok((select (v #>> '{can,create}')::boolean and not (v #>> '{can,approve}')::boolean from p), 'the zonal manager may enter but not review');

-- ---------- saving ----------
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{}'::jsonb)$$, tests.id('hub_a1'), tests.today() + 1), 'no report for a future date', '22023');
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{"total_parcels": 5}'::jsonb, true)$$, tests.id('hub_a1'), tests.today()), 'submit needs both totals', '22023');
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{"total_parcels": -3}'::jsonb)$$, tests.id('hub_a1'), tests.today()), 'negative numbers are refused', '22023');
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{"staff":[{"employee_id":%I}]}'::jsonb)$$, tests.id('hub_a1'), tests.today(), tests.id('b1')), 'a person of another zone cannot be added', '22023');
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{"staff":[{"person_name":"Someone","mobile":"01711000704"}]}'::jsonb)$$, tests.id('hub_a1'), tests.today()), 'a mobile that is already in HR cannot become a second person', '23505');
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{"staff":[{"person_name":"rider one"}]}'::jsonb)$$, tests.id('hub_a1'), tests.today()), 'nor a name already on the hub''s staff', '23505');

-- Draft: parcels only, two people marked, one left unmarked.
select tests.ok(public.hub_ops_save(tests.id('hub_a1'), tests.today(), jsonb_build_object(
  'total_parcels', 120, 'remarks', 'সকাল থেকে কাজ',
  'staff', jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('m1'), 'attendance', 'present'),
    jsonb_build_object('employee_id', tests.id('c1'), 'attendance', 'present'),
    jsonb_build_object('employee_id', tests.id('e1'))))) is not null, 'a draft is saved');
select tests.logout();
select tests.ok((select status = 'pending' and total_pickups is null and total_parcels = 120 from public.hub_ops_reports where hub_id = tests.id('hub_a1')), 'a draft stays pending and an empty number stays empty (not 0)');
select tests.login(tests.id('zonal_a'));
select tests.ok((public.hub_ops_summary(tests.id('zone_a'), tests.today(), tests.today()) #>> '{zone,total_parcels}') is null, 'a draft is not counted in any total');
select tests.ok((public.hub_ops_summary(tests.id('zone_a'), tests.today(), tests.today()) #>> '{zone,pending}')::int = 1, 'the draft shows as pending');

-- Submit with a new person who is not in HR yet, and the rider on leave.
select public.hub_ops_save(tests.id('hub_a1'), tests.today(), jsonb_build_object(
  'total_parcels', 120, 'total_pickups', 45, 'reasons', jsonb_build_array('লোক কম ছিল', 'লোক কম ছিল', ' '), 'remarks', 'সকাল থেকে কাজ',
  'staff', jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('m1'), 'attendance', 'present'),
    jsonb_build_object('employee_id', tests.id('c1'), 'attendance', 'present'),
    jsonb_build_object('employee_id', tests.id('e1')),
    jsonb_build_object('employee_id', tests.id('r1'), 'attendance', 'leave_applied', 'reason', 'জ্বর'),
    jsonb_build_object('person_name', 'New Rider', 'mobile', '01811000999', 'position_id', tests.id('pos_rider'), 'employment', 'new', 'attendance', 'present'))), true);
select tests.logout();
select tests.ok((select status = 'submitted' and total_pickups = 45 and version = 1 and reasons = array['লোক কম ছিল'] from public.hub_ops_reports where hub_id = tests.id('hub_a1')), 'submitted with its totals; repeated and empty reasons are cleaned');
select tests.ok((select count(*) = 5 from public.hub_ops_staff s join public.hub_ops_reports r on r.id = s.report_id where r.hub_id = tests.id('hub_a1')), 'five people on the report');
select tests.ok(not exists (select 1 from public.employees where full_name = 'New Rider'), 'a person not in HR does not create an employee record');
select tests.ok((select count(*) from public.hub_ops_status_log where report_id = (select id from public.hub_ops_reports where hub_id = tests.id('hub_a1'))) = 5,
  'status log: two present, one leave, the new person present and new');
select tests.ok(exists (select 1 from public.hub_ops_status_log where employee_id = tests.id('r1') and to_value = 'leave_applied' and reason = 'জ্বর' and hub_id = tests.id('hub_a1') and status_date = tests.today()),
  'a status change carries date, hub and reason');
select tests.throws('update public.hub_ops_status_log set reason = $$x$$', 'the status log cannot be changed', 'P0001');
select tests.throws('delete from public.hub_ops_reports', 'reports cannot be deleted', 'P0001');

-- ---------- summary ----------
select tests.login(tests.id('zonal_a'));
create temp table s as select public.hub_ops_summary(tests.id('zone_a'), tests.today(), tests.today()) v;
grant select on s to authenticated;
select tests.ok((select (v #>> '{zone,total_parcels}')::int = 120 and (v #>> '{zone,total_pickups}')::int = 45 from s), 'zone totals come from the submitted report only');
select tests.ok((select (v #>> '{zone,att,present}')::int = 3 and (v #>> '{zone,att,leave_applied}')::int = 1 and (v #>> '{zone,att,not_marked}')::int = 1 from s), 'present 3, leave applied 1, not marked 1 (never assumed)');
select tests.ok((select (v #>> '{zone,new}')::int = 1 and (v #>> '{zone,not_in_hr}')::int = 1 from s), 'one new employee, not in HR yet');
select tests.ok((select (v #>> '{zone,missing}')::int = 1 from s), 'hub A2 has not reported: one missing report');
select tests.ok((select x -> 'missing_dates' = '[]'::jsonb from s, jsonb_array_elements(v -> 'hubs') x where x ->> 'hub_id' = tests.id('hub_a1')::text), 'hub A1 is not missing');
select tests.ok((select (x -> 'by_group' ->> 'manager')::int = 1 and (x -> 'by_group' ->> 'rider')::int = 2 from s, jsonb_array_elements(v -> 'hubs') x where x ->> 'hub_id' = tests.id('hub_a1')::text), 'staffing by designation');
select tests.ok((select count(*) = 1 from s, jsonb_array_elements(v -> 'people') x where (x ->> 'leave_applied')::int > 0 and x ->> 'person_name' = 'Rider One'), 'who applied for leave is listed');
select tests.ok(not exists (select 1 from s, jsonb_array_elements(v -> 'hubs') x where x ->> 'hub_id' = tests.id('hub_b1')::text), 'zone B hubs are not in zone A''s summary');

-- ---------- corrections ----------
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{"total_parcels": 130, "total_pickups": 45}'::jsonb)$$, tests.id('hub_a1'), tests.today()), 'a submitted report needs a reason to change', '22023');
select public.hub_ops_save(tests.id('hub_a1'), tests.today(), jsonb_build_object('total_parcels', 130, 'total_pickups', 45,
  'staff', jsonb_build_array(jsonb_build_object('employee_id', tests.id('r1'), 'attendance', 'leave_not_applied', 'reason', 'আবেদন পাওয়া যায়নি'))), false, 'পার্সেল গোনায় ভুল ছিল');
select tests.logout();
select tests.ok((select version = 2 and status = 'submitted' and total_parcels = 130 and last_correction = 'পার্সেল গোনায় ভুল ছিল' from public.hub_ops_reports where hub_id = tests.id('hub_a1')), 'a correction raises the version and keeps the reason');
select tests.ok((select count(*) = 5 from public.hub_ops_staff s join public.hub_ops_reports r on r.id = s.report_id where r.hub_id = tests.id('hub_a1') and s.removed_at is null), 'people not sent in a correction are kept');
select tests.ok(exists (select 1 from public.hub_ops_status_log where employee_id = tests.id('r1') and from_value = 'leave_applied' and to_value = 'leave_not_applied'), 'the status change is logged from → to');
select tests.login(tests.id('zonal_a'));
select tests.ok(exists (select 1 from jsonb_array_elements(public.hub_ops_history('report', (select (v #>> '{hubs,0,report_id}')::uuid from s))) x
  where x -> 'fields' ? 'total_parcels' and (x #>> '{old,total_parcels}')::int = 120 and (x #>> '{new,total_parcels}')::int = 130 and x ->> 'reason' = 'পার্সেল গোনায় ভুল ছিল'),
  'the history shows the old and new value and the reason');
select tests.ok(jsonb_array_length(public.hub_ops_status_log(tests.id('zone_a'), tests.today(), tests.today(), null, tests.id('r1'))) = 2, 'the status log of one person');

-- ---------- reviews and boss reports ----------
insert into tests.ids select 'rep_a1', id from (select (v #>> '{hubs,0,report_id}')::uuid id from s) q;
select tests.throws(format($$select public.hub_ops_review(array[%L]::uuid[])$$, tests.id('rep_a1')), 'the zonal manager cannot review', '42501');
select tests.throws(format($$select public.hub_ops_boss_submit(%L, 'daily', %L)$$, tests.id('zone_a'), tests.today() + 40), 'no boss report for a period that has not started', '22023');
insert into tests.ids select 'boss_d', public.hub_ops_boss_submit(tests.id('zone_a'), 'daily', tests.today(), 'আজকের রিপোর্ট');
select tests.ok((select x ->> 'status' = 'submitted' from jsonb_array_elements(public.hub_ops_boss_list(tests.id('zone_a'), 'daily', 3)) x where x ->> 'period_from' = tests.today()::text), 'today''s daily report is submitted');
select tests.ok((select x ->> 'status' = 'pending' from jsonb_array_elements(public.hub_ops_boss_list(tests.id('zone_a'), 'daily', 3)) x where x ->> 'period_from' = (tests.today() - 1)::text), 'yesterday''s is pending');
select tests.ok((select (x ->> 'missing')::int = 1 from jsonb_array_elements(public.hub_ops_boss_list(tests.id('zone_a'), 'daily', 3)) x where x ->> 'period_from' = tests.today()::text), 'the list shows the missing hub report');
select tests.ok((select (x ->> 'period_to')::date - (x ->> 'period_from')::date = 6 and extract(isodow from (x ->> 'period_from')::date) = 6
  from jsonb_array_elements(public.hub_ops_boss_list(tests.id('zone_a'), 'weekly', 1)) x), 'a week runs Saturday to Friday');
select tests.throws(format($$select public.hub_ops_boss_submit(%L, 'daily', %L)$$, tests.id('zone_a'), tests.today()), 'sending again needs a note', '22023');
select tests.logout();
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('boss') and kind = 'hub_ops'), 'the boss is notified');
select tests.ok(not exists (select 1 from public.notifications where profile_id = tests.id('zonal_b') and kind = 'hub_ops'), 'zone B''s manager is not');

select tests.login(tests.id('zonal_b'));
select tests.throws(format($$select public.hub_ops_boss_get(%L, 'daily', %L)$$, tests.id('zone_a'), tests.today()), 'zone B cannot read zone A''s boss report', '42501');
select tests.throws(format($$select public.hub_ops_history('report', %L)$$, tests.id('rep_a1')), 'nor its history', '42501');

select tests.login(tests.id('boss'));
select tests.ok((public.hub_ops_boss_get(tests.id('zone_a'), 'daily', tests.today()) #>> '{sent,zone,total_parcels}')::int = 130, 'the boss sees the totals as they were sent');
select tests.throws(format($$select public.hub_ops_save(%L, %L, '{}'::jsonb)$$, tests.id('hub_a1'), tests.today() - 1), 'the boss does not enter hub reports', '42501');
select public.hub_ops_boss_review(tests.id('boss_d'), 'ঠিক আছে');
select tests.throws(format($$select public.hub_ops_boss_review(%L)$$, tests.id('boss_d')), 'a reviewed report is not reviewed twice', '22023');
select tests.logout();
select tests.ok((select status = 'reviewed' and review_note = 'ঠিক আছে' from public.hub_ops_reports where id = tests.id('rep_a1')), 'the hub report is reviewed with the boss report');
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('zonal_a') and kind = 'hub_ops'), 'the zonal manager hears it was reviewed');

-- A correction after review goes back for review, and the boss report shows it changed.
select tests.login(tests.id('zonal_a'));
select public.hub_ops_save(tests.id('hub_a1'), tests.today(), '{"total_parcels": 131, "total_pickups": 45}'::jsonb, false, 'আরও একটি পার্সেল');
select tests.ok((public.hub_ops_boss_get(tests.id('zone_a'), 'daily', tests.today()) #>> '{report,changed_after}')::boolean, 'the boss report shows a hub report changed after it was sent');
select tests.ok((public.hub_ops_summary(tests.id('zone_a'), tests.today(), tests.today()) #>> '{hubs,0,status}') = 'submitted', 'the corrected report waits for review again');
select public.hub_ops_boss_submit(tests.id('zone_a'), 'daily', tests.today(), 'সংশোধিত');
select tests.ok((public.hub_ops_boss_get(tests.id('zone_a'), 'daily', tests.today()) #>> '{report,version}')::int = 2, 'sending again raises the boss report''s version');

-- Maker / checker: an admin who submitted cannot review their own report.
select tests.login(tests.id('admin'));
select public.hub_ops_save(tests.id('hub_a2'), tests.today(), jsonb_build_object('total_parcels', 0, 'total_pickups', 0,
  'staff', jsonb_build_array(jsonb_build_object('employee_id', tests.id('a2'), 'attendance', 'absent', 'reason', 'খবর দেয়নি'))), true);
select tests.throws(format($$select public.hub_ops_review(array[(select id from public.hub_ops_reports where hub_id = %L)])$$, tests.id('hub_a2')), 'own report cannot be reviewed', '42501');
select tests.logout();
select tests.ok((select total_parcels = 0 from public.hub_ops_reports where hub_id = tests.id('hub_a2')), 'a real zero is kept as zero');

-- ---------- settings ----------
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.hub_ops_configure(%L, '[{"key":"rider","bn":"রাইডার","en":"Rider"}]'::jsonb, null, null, null)$$, tests.id('zone_a')), 'Manager, Hub CC and Entry Man must stay', '22023');
select tests.throws(format($$select public.hub_ops_configure(%L, null, null, array[%L]::uuid[], null)$$, tests.id('zone_a'), tests.id('hub_b1')), 'a hub of another zone cannot be skipped', '22023');
select public.hub_ops_configure(tests.id('zone_a'), jsonb_build_array(
  jsonb_build_object('key', 'manager', 'bn', 'ম্যানেজার', 'en', 'Manager', 'pattern', 'manager'),
  jsonb_build_object('key', 'hub_cc', 'bn', 'হাব সিসি', 'en', 'Hub CC', 'pattern', 'hub\s*cc'),
  jsonb_build_object('key', 'entry_man', 'bn', 'এন্ট্রি ম্যান', 'en', 'Entry Man', 'pattern', 'entry'),
  jsonb_build_object('key', 'account', 'bn', 'হিসাব', 'en', 'Accounts', 'position_ids', jsonb_build_array(tests.id('pos_rider')))),
  '["লোক কম"]'::jsonb, array[tests.id('hub_a2')], array[5]);
select tests.ok((select x ->> 'group_key' = 'account' from jsonb_array_elements(public.hub_ops_settings(tests.id('zone_a')) -> 'positions') x where x ->> 'id' = tests.id('pos_rider')::text), 'a post can be put into a configured group');
select tests.ok((public.hub_ops_summary(tests.id('zone_a'), tests.today(), tests.today()) #>> '{zone,hubs_expected}')::int = 1, 'a skipped hub is not expected to report');
select tests.login(tests.id('zonal_b'));
select tests.throws(format($$select public.hub_ops_configure(%L, null, null, null, null)$$, tests.id('zone_a')), 'zone B cannot change zone A''s settings', '42501');
select tests.logout();
rollback;
