-- Nodi's attendance gaps: a day without any attendance record is asked about, answered by the person, checked by the Zonal Assistant.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into tests.ids values
  ('mgr', tests.active_employee('Gap Manager', '840', tests.id('hub_a1'), '01711000840', '8400000000', 15000, tests.id('hub_mgr'))),
  ('r1',  tests.active_employee('Gap Rider', '841', tests.id('hub_a1'), '01711000841', '8410000000', 15000, tests.id('rider_login'))),
  ('b1',  tests.active_employee('Other Hub', '842', tests.id('hub_b1'), '01711000842', '8420000000')),
  ('za',  tests.make_user('za@test.local', 'Zonal Assistant'));
select tests.grant_role(tests.id('za'), 'zonal_assistant', 'zone', tests.id('zone_a'));
-- everyone has been active for ten days; the rider has attendance on all but four of the last six days
update public.employees set status_since = current_date - 10, joining_date = current_date - 10 where id in (tests.id('mgr'), tests.id('r1'), tests.id('b1'));
insert into public.attendance_records (employee_id, work_date, status)
select tests.id('r1'), d::date, 'present' from generate_series(current_date - 10, current_date - 7, interval '1 day') d;
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('r1'), current_date - 4, 'weekly_off'), (tests.id('r1'), current_date - 1, 'absent');

insert into t select 'lt', id::text from public.leave_types where status = 'active' order by name limit 1;

-- ---------- the role ----------
select tests.ok((select count(*) = 8 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id
                  where r.code = 'zonal_assistant' and p.code not in ('system.list_view.configure', 'system.list_mark.edit')), 'the Zonal Assistant role carries its eight permissions');

-- ---------- my own gaps ----------
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 4 and min(work_date) = current_date - 6 and max(work_date) = current_date - 2 from public.my_att_gaps()),
  'a person sees their own days without a record (weekly off and absent count as recorded; today is not asked)');
select tests.throws($$select public.my_att_gap_answer(array[current_date - 6], 'other', ' ')$$, 'a reason is required', '22023');
select tests.throws($$select public.my_att_gap_answer(array[current_date - 8], 'other', 'x')$$, 'a day that has attendance cannot be answered', 'P0001');
select tests.throws($$select public.my_att_gap_answer(array[current_date - 6], 'leave', 'অসুস্থ')$$, 'leave needs a leave type', '22023');
select tests.ok(public.my_att_gap_answer(array[current_date - 6, current_date - 5], 'leave', 'অসুস্থ ছিলাম', (select v::uuid from t where k = 'lt')) = 2,
  'two days in a row are answered as leave');
select tests.ok((select count(*) = 1 and min(from_date) = current_date - 6 and max(to_date) = current_date - 5 and min(days) = 2 and min(status) = 'pending' from public.leave_requests where employee_id = tests.id('r1')),
  'one leave request covers the unbroken run of days');
select tests.ok(public.my_att_gap_answer(array[current_date - 3], 'worked', 'কাজে ছিলাম, হাজিরা ওঠেনি') = 1, 'another day is answered as worked');
select tests.ok((select count(*) filter (where status = 'answered') = 3 and count(*) filter (where status = 'waiting') = 1 from public.my_att_gaps()), 'three answered, one still waiting');
select tests.throws(format($$select public.att_gap_check(array[%L::uuid], true)$$, (select id from public.attendance_gap_answers where work_date = current_date - 3)),
  'a person cannot check their own answer', '42501');

-- ---------- the Zonal Assistant's panel ----------
select tests.login(tests.id('za'));
select tests.ok((select count(distinct employee_id) = 2 and count(*) filter (where employee_id = tests.id('r1')) = 4 from public.att_gap_report(current_date - 10, current_date)),
  'the assistant sees the gaps of their own area only');
select tests.ok((select count(*) = 0 from public.att_gap_report(current_date - 10, current_date) where employee_id = tests.id('b1')), 'not another area''s');
select tests.ok((select leave_status = 'pending' and kind = 'leave' from public.att_gap_report(current_date - 10, current_date) where employee_id = tests.id('r1') and work_date = current_date - 6),
  'the report shows the answer and where the leave request stands');
insert into t select 'worked', id::text from public.attendance_gap_answers where work_date = current_date - 3;
insert into t select 'leave6', id::text from public.attendance_gap_answers where work_date = current_date - 6;
select tests.throws(format($$select public.att_gap_check(array[%L::uuid], false)$$, (select v from t where k = 'worked')), 'sending back needs a reason', '22023');
select tests.ok(public.att_gap_check(array[(select v::uuid from t where k = 'worked')], false, 'ম্যানেজার বলছেন আসেননি') = 1, 'an answer is sent back');
select tests.ok(public.att_gap_remind(current_date - 10, current_date) = 2, 'a reminder goes to each person with a login who still owes an answer');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 2 from public.notifications where profile_id = tests.id('rider_login') and kind = 'attendance_gap'), 'the person is told: once for the return, once by the reminder');
select tests.ok(public.my_att_gap_answer(array[current_date - 3], 'other', 'ব্যক্তিগত কাজে ছিলাম') = 1, 'a returned answer can be given again');
select tests.login(tests.id('za'));
select tests.ok(public.att_gap_check(array[(select v::uuid from t where k = 'worked')], true) = 1, 'and is checked');
select tests.login(tests.id('rider_login'));
select tests.throws($$select public.my_att_gap_answer(array[current_date - 3], 'other', 'আবার বদল')$$, 'a checked answer cannot be changed', 'P0001');

-- ---------- who may not ----------
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.att_gap_check(array[%L::uuid], true)$$, (select v from t where k = 'leave6')),
  'a manager of another hub cannot check', '42501');
select tests.login(tests.id('noroles'));
select tests.ok((select count(*) = 0 from public.att_gap_report(current_date - 10, current_date)), 'a person with no role sees no report');

-- ---------- approving the leave closes the gap by itself ----------
select tests.login(tests.id('hub_mgr'));
select public.hr_decide_leave((select id from public.leave_requests where employee_id = tests.id('r1')), true);
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 2 from public.my_att_gaps()), 'once the manager approves the leave, those days are no longer gaps');

rollback;
