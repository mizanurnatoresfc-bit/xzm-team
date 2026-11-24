begin;
select tests.fixture();
select tests.hr_fixture();

insert into tests.ids values
  ('morning_present', tests.active_employee('Morning Rider', '961', tests.id('hub_a1'), '01711000961', '9610000000', 15000, tests.id('rider_login'))),
  ('morning_leave', tests.active_employee('Approved Leave', '962', tests.id('hub_a1'), '01711000962', '9620000000')),
  ('morning_other', tests.active_employee('Other Hub', '963', tests.id('hub_a2'), '01711000963', '9630000000')),
  ('morning_unknown', tests.active_employee('Awaiting Input', '964', tests.id('hub_a1'), '01711000964', '9640000000'));

select tests.grant_role(tests.id('rider_login'), 'staff', 'hub', null, tests.id('hub_a1'));
insert into public.attendance_records (employee_id, work_date, status, source)
values (tests.id('morning_leave'), (now() at time zone 'Asia/Dhaka')::date, 'leave', 'leave');

select tests.login(tests.id('rider_login'));
select tests.throws(format('select public.wf_morning_get(%L)', tests.id('hub_a1')), 'staff cannot open the hub headcount', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select jsonb_array_length(g -> 'people') = 3 and (g ->> 'can_edit')::boolean
  from public.wf_morning_get(tests.id('hub_a1')) g), 'hub manager gets today''s roster');
select tests.throws(format('select public.wf_morning_get(%L)', tests.id('hub_a2')), 'hub manager cannot open a sibling hub', '42501');

select tests.throws(format('select public.wf_morning_save(%L,%L,1,%L)', tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date,
  jsonb_build_object(tests.id('morning_other'), 'present')), 'reject a different hub employee', '22023');
select tests.throws(format('select public.wf_morning_save(%L,%L,1,%L)', tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date,
  jsonb_build_object(tests.id('morning_present'), 'leave')), 'reject manually supplied approved leave', '22023');

select tests.ok((select g ->> 'status' = 'draft' and exists (
  select 1 from jsonb_array_elements(g -> 'people') x
  where x ->> 'employee_id' = tests.id('morning_present')::text and x ->> 'status' = 'present')
  from public.wf_morning_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 1,
      jsonb_build_object(tests.id('morning_present'), 'present')) g), 'draft can be saved and read by the manager');
select tests.ok((select g -> 'people' = 'null'::jsonb and g ->> 'status' = 'submitted' and not (g ->> 'can_edit')::boolean
  from public.wf_morning_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 1, '{}', true) g),
  'manager gets only a receipt after submission');
select tests.throws(format('select public.wf_morning_save(%L,%L,1,%L)', tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, '{}'),
  'submitted round is locked', 'P0001');
select tests.ok((select g ->> 'status' = 'submitted' and g -> 'people' = 'null'::jsonb
  from public.wf_morning_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 1, '{}', true) g),
  'an empty submit retry returns the same receipt');
select tests.throws('select * from private.wf_morning_rounds', 'manager cannot read the table directly', '42501');
select tests.throws(format('select public.wf_morning_return(%L,%L,1,%L)', tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 'edit'),
  'manager cannot reopen a submitted round', '42501');

select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.wf_morning_get(%L)', tests.id('hub_b1')), 'zonal manager cannot read another zone', '42501');
select tests.ok((select g ->> 'status' = 'waiting' from public.wf_morning_get(tests.id('hub_a2')) g),
  'zonal manager sees a waiting sibling hub in the same zone');
select tests.ok((select g ->> 'status' = 'submitted' and (g ->> 'can_return')::boolean and
    (select count(*) from jsonb_array_elements(g -> 'people') x where x ->> 'status' in ('present','unknown','leave')) = 3 and
    (select x ->> 'status' from jsonb_array_elements(g -> 'people') x where x ->> 'employee_id' = tests.id('morning_leave')::text) = 'leave' and
    (select x ->> 'status' from jsonb_array_elements(g -> 'people') x where x ->> 'employee_id' = tests.id('morning_unknown')::text) = 'unknown'
  from public.wf_morning_get(tests.id('hub_a1')) g), 'zonal manager sees approved leave and unresolved staff in the snapshot');
select tests.throws(format('select public.wf_morning_return(%L,%L,1,%L)', tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, ''),
  'return requires a reason', '22023');
select tests.ok((select g ->> 'status' = 'returned' and g ->> 'revision' = '2' and g ->> 'return_note' = 'Verify arrival'
  from public.wf_morning_return(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 1, 'Verify arrival') g),
  'zonal return opens a new revision');
select tests.throws(format('select public.wf_morning_return(%L,%L,1,%L)', tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 'again'),
  'retrying a return does not make another revision', 'P0001');

select tests.login(tests.id('hub_mgr'));
select tests.ok((select (g ->> 'can_edit')::boolean and g ->> 'return_note' = 'Verify arrival'
  from public.wf_morning_get(tests.id('hub_a1')) g), 'manager can edit the returned round');
select tests.throws(format('select public.wf_morning_save(%L,%L,1,%L,true)', tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, '{}'),
  'an old submission cannot affect the opened revision', 'P0001');
select public.wf_morning_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, 2,
  jsonb_build_object(tests.id('morning_present'), 'absent'), true);

select tests.logout();
select tests.ok((select count(*) = 2 and
  bool_and(submitted_at is not null) and
  max(marks ->> tests.id('morning_present')::text) filter (where revision = 1) = 'present' and
  max(marks ->> tests.id('morning_present')::text) filter (where revision = 2) = 'absent'
  from private.wf_morning_rounds where hub_id = tests.id('hub_a1')), 'both submitted versions are preserved');
select tests.ok(not exists (select 1 from public.att_day_sheets where hub_id = tests.id('hub_a1')),
  'morning submission does not create a final attendance sheet');
select tests.login_anon();
select tests.throws(format('select public.wf_morning_get(%L)', tests.id('hub_a1')), 'anonymous cannot execute the RPC', '42501');
rollback;
