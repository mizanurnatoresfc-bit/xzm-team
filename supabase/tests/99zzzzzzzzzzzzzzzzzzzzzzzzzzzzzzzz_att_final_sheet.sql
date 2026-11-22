-- হাজিরা: ম্যানেজারের দৈনিক ফাইনাল খাতা — prefill from the staff's own input, submit + lock, explanations and replies,
-- the zonal manager's data (no approving), unlock, sending for checking, and the monthly register.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into public.positions (department_id, code, name, name_bn) values (tests.id('dept_ops'), 'MANAGER', 'Manager', 'ম্যানেজার');
insert into tests.ids values
  ('s1', tests.active_employee('Self Rider', '881', tests.id('hub_a1'), '01711000881', '8810000000', 15000, tests.id('rider_login'))),
  ('s2', tests.active_employee('No Login Rider', '882', tests.id('hub_a1'), '01711000882', '8820000000')),
  ('mg', tests.active_employee('Hub Boss', '883', tests.id('hub_a1'), '01711000883', '8830000000', 20000, tests.id('hub_mgr'))),
  ('o1', tests.active_employee('Other Hub', '884', tests.id('hub_a2'), '01711000884', '8840000000'));
update public.employees set position_id = (select id from public.positions where code = 'MANAGER') where id = tests.id('mg');
select tests.grant_role(tests.id('rider_login'), 'staff', 'hub', null, tests.id('hub_a1'));

-- the staff member gives today's attendance once
select tests.login(tests.id('rider_login'));
select public.att_self_mark('present');

-- the manager's register is filled from it
select tests.login(tests.id('hub_mgr'));
select tests.ok((select jsonb_array_length(g -> 'people') = 3 and g -> 'sheet' = 'null'::jsonb and (g -> 'can' ->> 'edit')::boolean
                    and not (g -> 'can' ->> 'unlock')::boolean
                    and (select p -> 'value' ->> 'final_status' = 'present' and p -> 'mark' ->> 'kind' = 'present' from jsonb_array_elements(g -> 'people') p where p ->> 'employee_id' = tests.id('s1')::text)
                    and (select p -> 'mark' = 'null'::jsonb and p -> 'value' ->> 'final_status' is null from jsonb_array_elements(g -> 'people') p where p ->> 'employee_id' = tests.id('s2')::text)
                   from public.att_sheet_get(tests.id('hub_a1')) g),
  'the register lists the hub''s staff: what a person gave is filled in, the others are blank');
select tests.ok((select (x ->> 'not_given')::int = 1 from jsonb_array_elements(public.att_sheet_get(tests.id('hub_a1')) -> 'by_position') x where x ->> 'position' = 'Rider'),
  'by position: one rider gave nothing');
select tests.throws(format($$select public.att_sheet_get(%L)$$, tests.id('hub_a2')), 'not another hub''s register', '42501');

-- incomplete lines are refused, with names
select tests.throws(format($$select public.att_sheet_submit(%L, %L)$$, tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date), 'an incomplete register is not submitted', '22023');

select tests.ok((public.att_sheet_submit(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('s1'), 'manager_ok', false, 'final_status', 'late', 'late_time', '10:15', 'online_marked', true),
    jsonb_build_object('employee_id', tests.id('s2'), 'final_status', 'absent', 'unauthorized', true),
    jsonb_build_object('employee_id', tests.id('mg'), 'final_status', 'present', 'online_marked', false, 'online_reason', 'net was down'))) ->> 'asked')::int = 3,
  'submitted: a "no" and a late arrival of one person, an absence without telling of another -> three explanations asked');
select tests.ok((select status = 'late' and check_in is not null from public.attendance_records where employee_id = tests.id('s1') and work_date = (now() at time zone 'Asia/Dhaka')::date)
            and (select status = 'absent' from public.attendance_records where employee_id = tests.id('s2') and work_date = (now() at time zone 'Asia/Dhaka')::date)
            and (select status = 'approved' and decided_as = 'late' from public.attendance_self_marks where employee_id = tests.id('s1') and work_date = (now() at time zone 'Asia/Dhaka')::date),
  'the final status is on the register (late with the time) and the person''s own input is settled');

-- locked
select tests.throws(format($$select public.att_sheet_save(%L, %L, '[]')$$, tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date), 'a submitted register is locked', 'P0001');
insert into tests.ids select 'sheet', id from public.att_day_sheets where hub_id = tests.id('hub_a1');
select tests.throws(format($$select public.att_sheet_unlock(%L, 'oops')$$, tests.id('sheet')), 'the hub manager cannot unlock', '42501');
select tests.throws(format($$select public.att_sheet_send(%L)$$, tests.id('sheet')), 'nor send it for checking', '42501');

-- the staff member answers in the staff panel
select tests.login(tests.id('rider_login'));
select tests.ok(jsonb_array_length(public.att_my_explanations()) = 2, 'the person sees the two questions');
select public.att_explain_reply((select id from public.att_explanations where employee_id = tests.id('s1') and reason = 'late'), 'bus was late');
select tests.throws(format($$select public.att_explain_reply(%L, 'again')$$, (select id from public.att_explanations where employee_id = tests.id('s1') and reason = 'late')), 'one reply only', 'P0001');
select tests.throws(format($$select public.att_explain_reply(%L, 'not mine')$$, (select id from public.att_explanations where employee_id = tests.id('s2'))), 'not another person''s question', '42501');

-- the zonal manager: the data, no approving
select tests.login(tests.id('zonal_a'));
select tests.ok((select jsonb_array_length(z -> 'marks') = 1 and jsonb_array_length(z -> 'explanations') = 3
                    and (select count(*) = 1 from jsonb_array_elements(z -> 'explanations') x where x ->> 'reply' = 'bus was late')
                    and (select (h ->> 'status') = 'submitted' and (h ->> 'unauthorized')::int = 1 from jsonb_array_elements(z -> 'hubs') h where h ->> 'hub_id' = tests.id('hub_a1')::text)
                    and (select sum((m ->> 'count')::int) = 3 from jsonb_array_elements(z -> 'missing') m)
                   from public.att_zone_day(tests.id('zone_a')) z),
  'zonal data: the staff input, the explanations with the reply, the register, and who gave nothing by position');
select tests.throws(format($$select public.att_sheet_save(%L, current_date, '[]')$$, tests.id('hub_a1')), 'the zonal manager does not write the register', '42501');
select tests.ok(public.att_sheet_send(tests.id('sheet')) = 1, 'sent once to the hub''s manager');
select tests.ok(public.att_sheet_send(tests.id('sheet')) = 0, 'sending again adds nobody');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_check_ok(tests.id('sheet'));
select tests.ok((select g -> 'my_check' ->> 'ok_at' is not null and (g -> 'checks' -> 0 ->> 'ok_at') is not null from public.att_sheet_get(tests.id('hub_a1')) g), 'the manager marked it ঠিক আছে');

-- the monthly register counts the submitted day: late is present
select tests.ok((select (p ->> 'present')::int = 1 and p -> 'cells' ->> -1 = 'P' from jsonb_array_elements(public.att_month_sheet(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('s1')::text)
            and (select (p ->> 'absent')::int = 1 from jsonb_array_elements(public.att_month_sheet(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('s2')::text),
  'monthly register: late counts as present, the absence as absent');

-- only the zonal manager unlocks, with a reason
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.att_sheet_unlock(%L, '')$$, tests.id('sheet')), 'unlocking needs a reason', '22023');
select public.att_sheet_unlock(tests.id('sheet'), 'wrong time for Self Rider');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (g -> 'can' ->> 'edit')::boolean and g -> 'sheet' ->> 'status' = 'draft' from public.att_sheet_get(tests.id('hub_a1')) g), 'unlocked: the manager can correct it');
select tests.ok((select (p ->> 'present')::int = 0 from jsonb_array_elements(public.att_month_sheet(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('s1')::text),
  'an unlocked day is not in the monthly register until it is submitted again');
select public.att_sheet_submit(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('s1'), 'manager_ok', true, 'final_status', 'present', 'online_marked', true)));
select tests.ok((select count(*) = 2 from public.att_explanations where sheet_id = tests.id('sheet'))
            and exists (select 1 from public.att_explanations where sheet_id = tests.id('sheet') and reason = 'late' and reply is not null)
            and not exists (select 1 from public.att_explanations where sheet_id = tests.id('sheet') and reason = 'not_ok'),
  'submitted again: a question that no longer applies goes unless it was answered');

select tests.login_anon();
select tests.throws(format($$select public.att_sheet_get(%L)$$, tests.id('hub_a1')), 'not signed in: nothing', '42501');
select 'done';
rollback;
