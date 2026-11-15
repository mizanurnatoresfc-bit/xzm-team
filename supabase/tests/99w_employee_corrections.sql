-- Fixing mistakes in staff data: removing a mistaken entry, and correcting a wrong Employee ID.
begin;
select tests.fixture();
select tests.hr_fixture();

insert into tests.ids values
  ('wrong',  tests.active_employee('Entered By Mistake', '831', tests.id('hub_a1'), '01711000831', '8310000000')),
  ('worked', tests.active_employee('Has Attendance', '832', tests.id('hub_a1'), '01711000832', '8320000000')),
  ('login',  tests.active_employee('Wrong With Login', '833', tests.id('hub_a1'), '01711000833', '8330000000', 15000, tests.id('rider_login'))),
  ('me',     tests.active_employee('HR Person', '834', tests.id('hub_a1'), '01711000834', '8340000000', 15000, tests.id('hr'))),
  ('fixid',  tests.active_employee('Right Person Wrong ID', '835', tests.id('hub_a1'), '01711000835', '8350000000', 15000, tests.id('hub_mgr')));
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('worked'), current_date, 'present');

-- ---------- removing a mistaken entry ----------
select tests.login(tests.id('auditor'));
select tests.throws(format($$select public.hr_remove_wrong_entry(%L, 'test')$$, tests.id('wrong')), 'someone without the right cannot remove an entry', '42501');
select tests.login(tests.id('hr'));
select tests.throws(format($$select public.hr_remove_wrong_entry(%L, '  ')$$, tests.id('wrong')), 'a reason is required', '22023');
select tests.throws(format($$select public.hr_remove_wrong_entry(%L, 'test')$$, tests.id('worked')), 'a person with attendance is not a mistaken entry', 'P0001');
select tests.throws(format($$select public.hr_remove_wrong_entry(%L, 'test')$$, tests.id('me')), 'nobody removes their own record', '42501');
select public.hr_remove_wrong_entry(tests.id('wrong'), 'একই লোক দুবার উঠেছে');
select tests.logout();
select tests.ok((select status = 'rejected' and employee_code is null and archived_at is not null and archive_reason like '%831%' from public.employees where id = tests.id('wrong')),
  'the entry leaves the lists; its old ID is kept in the reason');
select tests.ok((select count(*) = 1 from public.employee_status_history where employee_id = tests.id('wrong') and to_status = 'rejected'), 'the change is in the status history');
select tests.ok(tests.active_employee('The Right Person', '831', tests.id('hub_a1'), '01711000831', '8319999999') is not null, 'the ID and the mobile number are free for the right person');
select tests.login(tests.id('hr'));
select tests.throws(format($$select public.hr_remove_wrong_entry(%L, 'again')$$, tests.id('wrong')), 'an entry is removed only once', 'P0001');

-- a mistaken entry that already has a login: the login is switched off
select tests.login(tests.id('super'));
select public.hr_remove_wrong_entry(tests.id('login'), 'ভুল লোকের নামে লগইন');
select tests.logout();
select tests.ok((select status = 'inactive' from public.profiles where id = tests.id('rider_login')), 'its login is switched off');
select tests.ok(public.login_resolve('833') is null, 'and its old ID no longer signs in');

-- ---------- correcting a wrong Employee ID ----------
select tests.login(tests.id('auditor'));
select tests.throws(format($$select public.hr_correct_employee_code(%L, '8350', 'typo')$$, tests.id('fixid')), 'someone without the right cannot change an ID', '42501');
select tests.login(tests.id('hr'));
select tests.throws(format($$select public.hr_correct_employee_code(%L, '8350', '')$$, tests.id('fixid')), 'a reason is required for an ID change', '22023');
select tests.throws(format($$select public.hr_correct_employee_code(%L, 'not an id', 'typo')$$, tests.id('fixid')), 'an ID outside the company format is refused', '23514');
select tests.throws(format($$select public.hr_correct_employee_code(%L, '832', 'typo')$$, tests.id('fixid')), 'an ID another person holds is refused', '23505');
select tests.throws(format($$select public.hr_correct_employee_code(%L, '835', 'typo')$$, tests.id('fixid')), 'the same ID is not a change', '22023');
select tests.ok(public.hr_correct_employee_code(tests.id('fixid'), '৮৩৫০', 'টাইপের ভুল') = '8350', 'the ID is corrected (Bangla digits accepted)');
select tests.logout();
select tests.ok((select employee_code = '8350' and status = 'active' from public.employees where id = tests.id('fixid')), 'the person keeps everything else');
select tests.ok(public.login_resolve('8350') = 'hub.a1@test.local' and public.login_resolve('835') is null, 'sign-in follows the corrected ID');

rollback;
