-- Phase 2 (20261119000300): the daily gap report — three reasons, no leave request, the hub manager approves; plain staff may report an issue.
begin;
select tests.fixture();
select tests.hr_fixture();

insert into tests.ids values ('s_login', tests.make_user('staffgap@test.local', 'Staff Gap'));
insert into tests.ids values
  ('mgr', tests.active_employee('Gap Hub Manager', '850', tests.id('hub_a1'), '01711000850', '8500000000', 15000, tests.id('hub_mgr'))),
  ('s1',  tests.active_employee('Gap Staff', '851', tests.id('hub_a1'), '01711000851', '8510000000', 15000, tests.id('s_login')));
update public.employees set status_since = current_date - 5, joining_date = current_date - 5 where id = tests.id('s1');
-- present on day -5 and -4; days -3, -2, -1 have nothing
insert into public.attendance_records (employee_id, work_date, status) values
  (tests.id('s1'), current_date - 5, 'present'), (tests.id('s1'), current_date - 4, 'present');

select tests.login(tests.id('s_login'));
select tests.ok((select count(*) = 3 from public.my_att_gaps()), 'the last three days without attendance are asked about');

-- ---------- the three reasons ----------
select tests.ok(public.my_att_gap_answer(array[current_date - 3], 'leave') = 1, '"ছুটিতে ছিলাম" needs no written note and no leave type');
select tests.ok(public.my_att_gap_answer(array[current_date - 2], 'worked', null) = 1, '"কাজে ছিলাম, হাজিরা ওঠেনি" needs no written note');
select tests.throws($$select public.my_att_gap_answer(array[current_date - 1], 'other', '  ')$$, '"অন্য কারণ" needs the reason written', '22023');
select tests.throws(format($$select public.my_att_gap_answer(array[current_date - 1], 'other', %L)$$, repeat('ক', 501)), 'a reason longer than 500 letters is refused', '22023');
select tests.ok(public.my_att_gap_answer(array[current_date - 1], 'other', 'হাব বন্ধ ছিল') = 1, '"অন্য কারণ" with a reason is taken');
select tests.ok(not exists (select 1 from public.leave_requests where employee_id = tests.id('s1')), 'no leave request is filed');
select tests.ok((select count(*) = 3 from public.my_att_gaps() where status = 'answered'), 'all three are submitted and wait for approval');
select tests.logout();

-- ---------- the hub manager is told, and approves or returns ----------
select tests.ok((select count(*) = 3 from public.notifications where profile_id = tests.id('hub_mgr') and kind = 'attendance_gap'),
  'the hub manager of that hub is told of each report');
select tests.ok(not exists (select 1 from public.notifications where profile_id = tests.id('hub_b_mgr') and kind = 'attendance_gap'),
  'another hub''s manager is not');
select tests.ok(not exists (select 1 from public.notifications where profile_id = tests.id('s_login') and kind = 'attendance_gap'),
  'the person is not told of their own report');

select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 3 from public.att_gap_report(current_date - 5, current_date, null, tests.id('hub_a1')) where employee_id = tests.id('s1')),
  'the hub manager sees the reports of their hub');
select tests.ok(public.att_gap_check(array(select id from public.attendance_gap_answers where employee_id = tests.id('s1') and work_date in (current_date - 3, current_date - 2)), true) = 2,
  'the hub manager approves two');
select tests.ok(public.att_gap_check(array(select id from public.attendance_gap_answers where employee_id = tests.id('s1') and work_date = current_date - 1), false, 'হাব খোলা ছিল') = 1,
  'and returns one with a reason');
select tests.logout();
insert into tests.ids select 'ans1', id from public.attendance_gap_answers where employee_id = tests.id('s1') and work_date = current_date - 1;
select tests.login(tests.id('hub_b_mgr'));
select tests.ok((select count(*) = 0 from public.attendance_gap_answers where employee_id = tests.id('s1')), 'a manager of another hub cannot even see the reports');
select tests.throws(format($$select public.att_gap_check(array[%L::uuid], true)$$, tests.id('ans1')), 'nor approve one', '42501');

select tests.login(tests.id('s_login'));
select tests.ok((select status = 'returned' and check_note = 'হাব খোলা ছিল' from public.my_att_gaps() where work_date = current_date - 1), 'the person sees it returned, with the reason');
select tests.throws($$select public.my_att_gap_answer(array[current_date - 3], 'worked')$$, 'an approved report cannot be changed', 'P0001');
select tests.ok(public.my_att_gap_answer(array[current_date - 1], 'worked') = 1, 'a returned one is given again');

-- ---------- reporting an issue ----------
select tests.ok(exists (select 1 from public.role_dashboards d join public.roles r on r.id = d.role_id where r.code = 'staff' and (d.menu is null or d.menu ? '/app/issues')),
  'the staff role may open the issues page');
select tests.ok(public.issue_create(tests.id('hub_a1'), 'দরজার তালা ভাঙা', null, 'other') is not null, 'a staff member raises an issue at their own hub');
select tests.throws(format($$select public.issue_create(%L, 'x', null, 'other')$$, tests.id('hub_b1')), 'but not at another hub', '42501');

rollback;
