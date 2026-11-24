-- The manager's own line on the final register is made final by the zonal manager; managers are found by role
-- (20261122001400_att_self_line_and_manager_roles.sql).
begin;
select tests.fixture(); select tests.hr_fixture();
insert into tests.ids values
 ('sl_mgr', tests.active_employee('Self Manager', '9202', tests.id('hub_a1'), '01711009202', '9202101010', 25000, tests.id('hub_mgr'))),
 ('sl_r1',  tests.active_employee('Self Rider', '9203', tests.id('hub_a1'), '01711009203', '9203101010'));

-- the manager says "absent" themself, then writes "present" for themself on the register
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'sl_mark', public.att_self_mark('absent', 'sick');
select public.att_sheet_submit(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, (
  select jsonb_agg(case when p ->> 'employee_id' = tests.id('sl_mgr')::text
     then jsonb_build_object('employee_id', p ->> 'employee_id', 'manager_ok', true, 'final_status', 'present', 'online_marked', true, 'online_reason', 'no phone')
     else jsonb_build_object('employee_id', p ->> 'employee_id', 'final_status', 'present', 'online_marked', true, 'online_reason', 'no phone') end)
  from jsonb_array_elements(public.att_sheet_get(tests.id('hub_a1')) -> 'people') p));
select tests.logout();
insert into tests.ids select 'sl_line', l.id from public.att_day_lines l where l.employee_id = tests.id('sl_mgr');
select tests.ok((select status from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = (now() at time zone 'Asia/Dhaka')::date) = 'submitted', 'the register is submitted');
select tests.ok((select self_pending from public.att_day_lines where id = tests.id('sl_line')), 'the manager''s own line waits for the zonal manager');
select tests.ok(not exists (select 1 from public.attendance_records r where r.employee_id = tests.id('sl_mgr') and r.work_date = (now() at time zone 'Asia/Dhaka')::date), 'nothing is written on the register for the manager');
select tests.ok((select status from public.attendance_self_marks where id = tests.id('sl_mark')) = 'waiting', 'the manager''s own input is still waiting');
select tests.ok((select status from public.attendance_records r where r.employee_id = tests.id('sl_r1') and r.work_date = (now() at time zone 'Asia/Dhaka')::date) = 'present', 'everyone else is on the register as before');
select tests.ok(exists (select 1 from public.notifications n where n.profile_id = tests.id('zonal_a') and n.body like '%নিজের হাজিরা%'), 'the zonal manager is told to make it final');

-- the manager cannot make it final
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.att_sheet_confirm_self(%L)', tests.id('sl_line')), 'the manager cannot make their own line final', '42501');
select tests.ok((public.att_sheet_get(tests.id('hub_a1')) -> 'can' ->> 'confirm_self')::boolean is not true, 'and is not offered the button');

-- the zonal manager does, and may correct it
select tests.login(tests.id('zonal_a'));
select tests.ok((public.att_sheet_get(tests.id('hub_a1')) -> 'can' ->> 'confirm_self')::boolean, 'the zonal manager is offered it');
select tests.ok((select (p ->> 'self_pending')::boolean from jsonb_array_elements(public.att_sheet_get(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('sl_mgr')::text), 'the page is told which line waits');
select tests.throws(format('select public.att_sheet_confirm_self(%L, %L)', tests.id('sl_line'), 'late'), 'late needs the arrival time', '22023');
select tests.ok((public.att_sheet_confirm_self(tests.id('sl_line'), 'late', '11:15', 'came late') ->> 'final_status') = 'late', 'the zonal manager makes it final as late');
select tests.throws(format('select public.att_sheet_confirm_self(%L)', tests.id('sl_line')), 'a line is made final once', 'P0001');
select tests.logout();
select tests.ok((select status from public.attendance_records r where r.employee_id = tests.id('sl_mgr') and r.work_date = (now() at time zone 'Asia/Dhaka')::date) = 'late', 'now the register has the manager''s day');
select tests.ok((select status = 'approved' and decided_as = 'late' and decided_by = tests.id('zonal_a') from public.attendance_self_marks where id = tests.id('sl_mark')), 'and the manager''s input is settled by the zonal manager');
select tests.ok((select not self_pending and confirmed_by = tests.id('zonal_a') from public.att_day_lines where id = tests.id('sl_line')), 'the line records who made it final');

-- managers are found by role: this manager's position is not MANAGER / ASSISTANTMAN
select tests.ok(not exists (select 1 from public.employees e join public.positions po on po.id = e.position_id where e.id = tests.id('sl_mgr') and po.code::text in ('MANAGER', 'ASSISTANTMAN')), 'the manager has another position');
select tests.login(tests.id('zonal_a'));
select tests.ok(public.att_sheet_send((select id from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = (now() at time zone 'Asia/Dhaka')::date)) = 1, 'send for checking reaches the manager by role');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_check_ok((select id from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = (now() at time zone 'Asia/Dhaka')::date));
select tests.logout();
select tests.ok((select ok_at is not null from public.att_sheet_checks c where c.profile_id = tests.id('hub_mgr')), 'and the manager marks it OK');
rollback;
