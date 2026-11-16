-- Staff give their own attendance; it counts only once the hub manager approves it.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('sa1', tests.active_employee('Self Rider', '701', tests.id('hub_a1'), '01711000701', '7010101010', 15000, tests.id('rider_login'))),
  ('sa2_login', tests.make_user('rider2@test.local', 'Rider Two'));
insert into tests.ids values ('sa2', tests.active_employee('Absent Rider', '702', tests.id('hub_a1'), '01711000702', '7020101010', 15000, tests.id('sa2_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('sa2_login'), 'rider', 'hub', null, tests.id('hub_a1'));

-- the staff member gives "I am at the hub"
select tests.login(tests.id('rider_login'));
select tests.ok(public.my_att_today() ->> 'mark' is null and public.my_att_today() ->> 'record' is null, 'nothing is marked before the staff member taps');
select public.att_self_mark('present');
select tests.ok(public.my_att_today() #>> '{mark,status}' = 'waiting', 'the input waits for the manager');
select tests.ok(not exists (select 1 from public.attendance_records where employee_id = tests.id('sa1')), 'nothing is on the register until it is approved');
select tests.throws($$select public.att_self_decide(array[(select id from public.attendance_self_marks where employee_id = tests.id('sa1'))], true)$$,
  'a staff member cannot approve their own attendance', '42501');

select tests.logout();
insert into tests.ids select 'mark1', id from public.attendance_self_marks where employee_id = tests.id('sa1');

-- "not coming" needs a reason
select tests.login(tests.id('sa2_login'));
select tests.throws($$select public.att_self_mark('absent', '  ')$$, 'not coming without a reason is refused', '22023');
select public.att_self_mark('absent', 'জ্বর');

-- another hub's manager does not see or decide them
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(jsonb_array_length(public.att_self_list(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date)) = 0, 'another hub''s manager sees nothing');
select tests.throws($$select public.att_self_decide(array[tests.id('mark1')], true)$$, 'another hub''s manager cannot approve', '42501');

-- the hub manager is told, sees both, approves one as late and turns the other down
select tests.login(tests.id('hub_mgr'));
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('hub_mgr') and title like 'হাজিরা অনুমোদন বাকি%'), 'the hub manager is told a mark came in');
select tests.ok(jsonb_array_length(public.att_self_list(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date)) = 2, 'the hub manager sees both inputs');
select tests.ok(public.att_self_decide(array(select id from public.attendance_self_marks where employee_id = tests.id('sa1')), true, 'late') = 1, 'approved');
select tests.ok((select status || '/' || source from public.attendance_records where employee_id = tests.id('sa1')) = 'late/self', 'approval writes the register as the manager decided');
select tests.throws($$select public.att_self_decide(array(select id from public.attendance_self_marks where employee_id = tests.id('sa2')), false)$$,
  'turning down needs a reason', '22023');
select public.att_self_decide(array(select id from public.attendance_self_marks where employee_id = tests.id('sa2')), false, null, 'ফোনে কথা হয়নি');
select tests.ok(not exists (select 1 from public.attendance_records where employee_id = tests.id('sa2')), 'a turned-down input writes nothing');

-- the staff members are told, and see the outcome
select tests.login(tests.id('rider_login'));
select tests.ok(public.my_att_today() #>> '{record,status}' = 'late' and public.my_att_today() #>> '{mark,decided_as}' = 'late', 'the staff member sees the approved attendance');
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('rider_login') and title like 'হাজিরা অনুমোদিত%'), 'the staff member is told it was approved');
select tests.throws($$select public.att_self_mark('present')$$, 'once on the register it cannot be given again', '23505');
select tests.login(tests.id('sa2_login'));
select tests.ok(public.my_att_today() #>> '{mark,status}' = 'rejected', 'the turned-down input shows as returned');
select public.att_self_mark('present');
select tests.ok(public.my_att_today() #>> '{mark,status}' = 'waiting', 'after a turn-down the staff member can give it again');

-- a staff member cannot write the table directly
select tests.throws($$insert into public.attendance_self_marks (employee_id, work_date, kind) values (tests.id('sa2'), current_date, 'present')$$,
  'no direct writes', '42501');
select tests.logout();
rollback;
