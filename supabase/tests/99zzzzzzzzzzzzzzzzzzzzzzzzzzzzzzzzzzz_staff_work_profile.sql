-- কর্মীর কাজের প্রোফাইল — one line per module record and version, drafts apart from submitted, the hub the work was done for, who may see what.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into public.wf_att_policy (zone_id, morning_open, morning_cutoff, morning_extra)
  values (tests.id('zone_a'), '00:00', '23:59:59', 0);
select (now() at time zone 'Asia/Dhaka')::date as t \gset
insert into public.positions (department_id, code, name, name_bn) values (tests.id('dept_ops'), 'MANAGER', 'Manager', 'ম্যানেজার');
insert into tests.ids values
  ('p1', tests.active_employee('Profile Rider', '901', tests.id('hub_a1'), '01711000901', '9010000000', 15000, tests.id('rider_login'))),
  ('p2', tests.active_employee('Backup Rider', '902', tests.id('hub_a1'), '01711000902', '9020000000')),
  ('mg', tests.active_employee('Hub Boss', '903', tests.id('hub_a1'), '01711000903', '9030000000', 20000, tests.id('hub_mgr')));
update public.employees set position_id = (select id from public.positions where code = 'MANAGER') where id = tests.id('mg');
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
insert into tests.ids values ('zonal_b', tests.make_user('zonal.b@test.local', 'Zonal B'));
select tests.grant_role(tests.id('zonal_b'), 'zonal_manager', 'zone', tests.id('zone_b'));
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East', 'stops', '[{"name":"Kazla"}]'::jsonb));
select public.route_riders_set(tests.id('route1'), array[tests.id('p1')]);
select tests.logout();
insert into public.job_duties (position_id, employee_id, zone_id, title, details, frequency) values
  (null, tests.id('p1'), tests.id('zone_a'), 'Carry the cash bag', 'every evening', 'daily');

-- ---------------------------------------------------------------- the morning input
select tests.login(tests.id('hub_mgr'));
select public.wf_morning_submit(tests.id('hub_a1'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p1'), 'state', 'present'), jsonb_build_object('employee_id', tests.id('p2'), 'state', 'present')));
select tests.logout();
select tests.ok((select count(*) = 1 and bool_and(status = 'submitted' and hub_id = tests.id('hub_a1') and work_date = :'t'::date and activity = 'morning_present' and source_version = 1)
                   from public.staff_work_events where employee_id = tests.id('p1') and module = 'morning'), 'the morning input leaves one submitted line for the person: hub, day, activity');
select tests.ok((select count(*) from public.staff_work_events where module = 'morning') = (select count(*) from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id where s.hub_id = tests.id('hub_a1') and s.status = 'submitted'),
  'one line for every person on the submitted input');

-- ---------------------------------------------------------------- the daily register: a draft, then the same line submitted, then a new version
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_save(tests.id('hub_a1'), :'t'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p1'), 'final_status', 'present', 'online_reason', 'no phone')));
select tests.logout();
select tests.ok((select count(*) = 1 and bool_and(status = 'draft' and source_version = 1) from public.staff_work_events where employee_id = tests.id('p1') and module = 'attendance'), 'a line of a register nobody submitted is a draft');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_submit(tests.id('hub_a1'), :'t'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p1'), 'final_status', 'present', 'online_reason', 'no phone'),
  jsonb_build_object('employee_id', tests.id('p2'), 'final_status', 'late', 'late_time', '10:00', 'online_reason', 'no phone'), jsonb_build_object('employee_id', tests.id('mg'), 'final_status', 'present', 'online_reason', 'no phone')));
select tests.logout();
select tests.ok((select count(*) = 1 and bool_and(status = 'submitted' and source_version = 1 and activity = 'present') from public.staff_work_events where employee_id = tests.id('p1') and module = 'attendance'),
  'the draft line became the submitted line — the same line, counted once');
select tests.login(tests.id('zonal_a'));
select public.att_sheet_unlock((select id from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'t'::date), 'correct p2');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_submit(tests.id('hub_a1'), :'t'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p2'), 'final_status', 'present', 'online_reason', 'no phone')));
select tests.logout();
select tests.ok((select count(*) = 2 and count(*) filter (where source_version = 2 and activity = 'present') = 1 from public.staff_work_events where employee_id = tests.id('p2') and module = 'attendance')
            and (select count(*) = 2 from public.staff_work_events where employee_id = tests.id('p2') and module = 'attendance' and status = 'submitted'), 'a corrected register is version two: its own line, the first stays');

-- ---------------------------------------------------------------- the same record is not counted twice when it is written again
select tests.ok(private.swe_backfill(120) = 0, 'running the backfill again adds nothing');
select private.staff_work_record(tests.id('p1'), tests.id('hub_a1'), tests.id('zone_a'), :'t'::date, 'morning', 'wf_morning_subs', (select source_id from public.staff_work_events where employee_id = tests.id('p1') and module = 'morning'), 1, 'morning_present', 'submitted');
select tests.ok((select count(*) = 1 from public.staff_work_events where employee_id = tests.id('p1') and module = 'morning'), 'the same module, record and version is one line');

-- ---------------------------------------------------------------- daily numbers: a new revision is a new version
insert into public.wf_daily_ops (employee_id, hub_id, zone_id, work_date, pickup, delivery) values (tests.id('p1'), tests.id('hub_a1'), tests.id('zone_a'), :'t'::date, 3, 50);
update public.wf_daily_ops set delivery = 52 where employee_id = tests.id('p1') and work_date = :'t'::date;      -- a real change: revision two
update public.wf_daily_ops set delivery = 52 where employee_id = tests.id('p1') and work_date = :'t'::date;      -- nothing changes: still revision two
select tests.ok((select count(*) = 2 and count(distinct source_id) = 1 and bool_or(source_version = 2 and (detail ->> 'delivery')::int = 52) from public.staff_work_events where employee_id = tests.id('p1') and module = 'daily_ops'),
  'daily numbers: revision one and revision two are two versions of one record; writing the same numbers again adds nothing');

-- ---------------------------------------------------------------- the route plan: published, then taken away
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'plan', public.route_plan_save(tests.id('hub_a1'), :'t'::date, jsonb_build_object('arrived', 60, 'people', jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('p1'), 'parcels', 40), jsonb_build_object('employee_id', tests.id('p2'), 'parcels', 20))), true);
select tests.login(tests.id('zonal_a'));
select public.route_plan_decide(tests.id('plan'), true);
select tests.logout();
select tests.ok((select count(*) = 1 and bool_and(status = 'submitted' and activity = 'route_assigned' and (detail ->> 'parcels')::int = 40) from public.staff_work_events where employee_id = tests.id('p1') and module = 'route'), 'a published assignment is a line');
select tests.login(tests.id('zonal_a'));
select public.route_plan_reopen(tests.id('plan'), 'swap');
select tests.login(tests.id('hub_mgr'));
select public.route_plan_save(tests.id('hub_a1'), :'t'::date, jsonb_build_object('people', jsonb_build_array(jsonb_build_object('employee_id', tests.id('p2'), 'parcels', 60))), true);
select tests.login(tests.id('zonal_a'));
select public.route_plan_decide(tests.id('plan'), true);
select tests.logout();
select tests.ok((select count(*) = 1 and bool_and(status = 'cancelled' and activity = 'route_cancelled') from public.staff_work_events where employee_id = tests.id('p1') and module = 'route' and source_version = 1)
            and (select count(*) = 1 from public.staff_work_events where employee_id = tests.id('p2') and module = 'route' and source_version = 2 and status = 'submitted'), 'the version that took it away cancels the line; the new rider has a line of version two');

-- ---------------------------------------------------------------- the profile
select tests.login(tests.id('zonal_a'));
select tests.ok(jsonb_array_length(public.staff_profile_people(tests.id('hub_a1'))) = 3, 'the zonal manager lists the people of a hub');
select tests.throws(format($$select public.staff_profile_people(%L)$$, tests.id('hub_b1')), 'not the people of a hub of another zone', '42501');
select tests.ok((select g -> 'person' ->> 'code' = '901' and g -> 'person' ->> 'hub' is not null and (g -> 'person' ->> 'has_login')::boolean and jsonb_array_length(g -> 'assignments') >= 1
                    and jsonb_array_length(g -> 'duties') = 1 and g -> 'duties' -> 0 ->> 'source' = 'person' and jsonb_array_length(g -> 'routes') = 1 and not (g ->> 'backup')::boolean
                    and (g -> 'attendance' ->> 'present')::int = 1 and (g -> 'attendance' ->> 'drafts')::int = 0
                    and (select (m ->> 'submitted')::int = 1 from jsonb_array_elements(g -> 'modules') m where m ->> 'module' = 'attendance')
                    and (select (m ->> 'cancelled')::int = 1 and (m ->> 'submitted')::int = 0 from jsonb_array_elements(g -> 'modules') m where m ->> 'module' = 'route')
                    and jsonb_array_length(g -> 'events') >= 5
                   from public.staff_profile_get(tests.id('p1'), :'t'::date, :'t'::date) g), 'the profile: identity, assignments, own duty, route, attendance and every module''s lines');
select tests.ok((select (g -> 'attendance' -> 'days' -> 0 ->> 'sheet_status') = 'submitted' and g -> 'attendance' -> 'days' -> 0 ->> 'hub' is not null from public.staff_profile_get(tests.id('p1'), :'t'::date, :'t'::date) g), 'an attendance day says which hub and whether the register is submitted');
select tests.throws(format($$select public.staff_profile_get(%L, %L, %L)$$, tests.id('p1'), (:'t'::date - 200), :'t'::date), 'a period is at most four months', '22023');

-- who may see it
select tests.login(tests.id('rider_login'));
select tests.ok((select g -> 'person' ->> 'code' = '901' from public.staff_profile_get(tests.id('p1'), :'t'::date, :'t'::date) g), 'a person sees their own profile');
select tests.throws(format($$select public.staff_profile_get(%L)$$, tests.id('p2')), 'but not a colleague''s', '42501');
select tests.throws($$select * from public.staff_work_events$$, 'the lines cannot be read from the table', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g -> 'person' ->> 'code' = '901' from public.staff_profile_get(tests.id('p1'), :'t'::date, :'t'::date) g), 'the hub manager sees the hub''s person');
select tests.login(tests.id('zonal_b'));
select tests.throws(format($$select public.staff_profile_get(%L)$$, tests.id('p1')), 'a zonal manager of another zone does not', '42501');

-- ---------------------------------------------------------------- a transfer: the new hub's duty from its date, the old work keeps its hub and day
select tests.logout();
update public.employees set hub_id = tests.id('hub_b1'), zone_id = tests.id('zone_b') where id = tests.id('p1');
insert into public.wf_daily_ops (employee_id, hub_id, zone_id, work_date, pickup, delivery) values (tests.id('p1'), tests.id('hub_b1'), tests.id('zone_b'), :'t'::date - 1, 1, 9);
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.staff_profile_get(%L)$$, tests.id('p1')), 'the old zone no longer sees the person', '42501');
select tests.login(tests.id('zonal_b'));
select tests.ok((select g -> 'person' ->> 'hub' is not null and (g -> 'person' ->> 'hub_id')::uuid = tests.id('hub_b1')
                    and not exists (select 1 from jsonb_array_elements(g -> 'events') e where (e ->> 'hub_id')::uuid = tests.id('hub_a1'))
                    and exists (select 1 from jsonb_array_elements(g -> 'events') e where (e ->> 'hub_id')::uuid = tests.id('hub_b1') and e ->> 'module' = 'daily_ops')
                   from public.staff_profile_get(tests.id('p1'), :'t'::date - 3, :'t'::date) g), 'the new zone sees the new hub''s work only; the old hub''s lines stay with the old hub');
select tests.logout();
select tests.ok((select count(*) > 0 from public.staff_work_events where employee_id = tests.id('p1') and hub_id = tests.id('hub_a1')), 'and the old hub''s lines are still there, with their hub and day');
rollback;
