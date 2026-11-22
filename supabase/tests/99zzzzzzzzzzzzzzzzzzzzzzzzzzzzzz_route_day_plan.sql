-- রুট: আজকের পার্সেল পরিকল্পনা — numbers of the day, who is here, who takes how many, set-up, approve, the rider's own share.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('r1', tests.active_employee('Route Rider', '871', tests.id('hub_a1'), '01711000871', '8710000000', 15000, tests.id('rider_login'))),
  ('r2', tests.active_employee('Second Rider', '872', tests.id('hub_a1'), '01711000872', '8720000000')),
  ('cc', tests.active_employee('Hub Helper', '873', tests.id('hub_a1'), '01711000873', '8730000000')),
  ('other', tests.active_employee('Other Hub Rider', '874', tests.id('hub_a2'), '01711000874', '8740000000'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East', 'stops', '[{"name":"Kazla"}]'::jsonb));
insert into tests.ids select 'route2', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a2'), 'name', 'Other Hub Route', 'stops', '[{"name":"Far"}]'::jsonb));
select public.route_riders_set(tests.id('route1'), array[tests.id('r1'), tests.id('r2')]);

-- who may plan where
select tests.ok(jsonb_array_length(public.route_plan_hubs()) = 2, 'the zonal manager plans the two hubs of the zone');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select jsonb_array_length(h) = 1 and h -> 0 ->> 'id' = tests.id('hub_a1')::text and h -> 0 -> 'plan' = 'null'::jsonb from public.route_plan_hubs() h),
  'the hub manager plans only the own hub, no plan yet');
select tests.throws(format($$select public.route_plan_get(%L)$$, tests.id('hub_a2')), 'not the plan of another hub', '42501');

-- the page before anything is typed
select tests.ok((select g -> 'plan' = 'null'::jsonb and (g -> 'rules' ->> 'avg_days')::int = 14 and g -> 'load' ->> 'pickup_mode' = 'mixed'
                    and (g -> 'can' ->> 'create')::boolean and (g -> 'can' ->> 'edit')::boolean
                    and not (g -> 'can' ->> 'approve')::boolean and not (g -> 'can' ->> 'configure')::boolean and not (g -> 'can' ->> 'archive')::boolean
                    and jsonb_array_length(g -> 'routes') = 1 and jsonb_array_length(g -> 'people') = 3
                    and (select x -> 'routes' = jsonb_build_array(tests.id('route1')) and (x ->> 'rider')::boolean and x -> 'presence' ->> 'state' is null
                           from jsonb_array_elements(g -> 'people') x where x ->> 'id' = tests.id('r1')::text)
                   from public.route_plan_get(tests.id('hub_a1')) g),
  'empty page: default rules, the hub''s route and people, the hub manager may add and edit only');

-- set-up belongs to the zonal manager
select tests.throws(format($$select public.route_plan_setup(%L, '{"pickup_mode": "same"}')$$, tests.id('hub_a1')), 'the hub manager cannot set up', '42501');
select tests.throws(format($$select public.route_plan_rules_save(%L, '{"avg_days": 7}')$$, tests.id('zone_a')), 'nor change the zone rules', '42501');
select tests.login(tests.id('zonal_a'));
select public.route_plan_setup(tests.id('hub_a1'), jsonb_build_object('pickup_mode', 'same', 'pickup_weight', 0.5, 'staff', jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('r1'), 'day_parcels', 70, 'pickup', true),
  jsonb_build_object('employee_id', tests.id('cc'), 'helper', true, 'helper_max', 15))));
select tests.ok((select pickup_mode = 'same' and pickup_weight = 0.5 and rider_parcels is null from public.route_hub_load where hub_id = tests.id('hub_a1'))
            and (select day_parcels = 70 and pickup and not helper from public.route_staff_load where employee_id = tests.id('r1'))
            and (select helper and helper_max = 15 and day_parcels is null from public.route_staff_load where employee_id = tests.id('cc')),
  'who does pickups, a fixed number for a rider and a helper are saved');
select public.route_load_save(tests.id('hub_a1'), '{"rider_parcels": 60}');
select tests.ok((select rider_parcels = 60 and pickup_mode = 'same' from public.route_hub_load where hub_id = tests.id('hub_a1')), 'the rider average of the load tab lives in the same row');
select tests.throws(format($$select public.route_plan_setup(%L, '{"pickup_mode": "nobody"}')$$, tests.id('hub_a1')), 'an unknown pickup mode is refused', '22023');
select tests.throws(format($$select public.route_plan_setup(%L, '{"pickup_weight": 9}')$$, tests.id('hub_a1')), 'a pickup cannot count as nine deliveries', '22023');
select tests.throws(format($$select public.route_plan_setup(%L, jsonb_build_object('staff', jsonb_build_array(jsonb_build_object('employee_id', %L, 'day_parcels', 50))))$$,
  tests.id('hub_a1'), tests.id('other')), 'a person of another hub is refused', '22023');
select tests.throws(format($$select public.route_plan_setup(%L, jsonb_build_object('staff', jsonb_build_array(jsonb_build_object('employee_id', %L, 'day_parcels', 0))))$$,
  tests.id('hub_a1'), tests.id('r2')), 'a fixed number of zero is refused', '22023');
select tests.throws(format($$select public.route_plan_setup(%L, '{"pickup_mode": "same"}')$$, tests.id('hub_b1')), 'not a hub of another zone', '42501');
select tests.ok((select (r ->> 'avg_days')::int = 7 and (r ->> 'over_pct')::int = 120 and (r ->> 'min_days')::int = 3 and not (r ->> 'show_rider')::boolean
                   from public.route_plan_rules_save(tests.id('zone_a'), '{"avg_days": 7, "over_pct": 120, "show_rider": false}') r), 'zone plan rules: the given ones change, the rest stay');
select tests.ok((select max_stops = 40 from public.route_zone_settings where zone_id = tests.id('zone_a')), 'and the route rules of the zone are untouched');
select tests.throws(format($$select public.route_plan_rules_save(%L, '{"over_pct": 500}')$$, tests.id('zone_a')), 'a rule outside its range is refused', '22023');
select tests.throws(format($$select public.route_plan_rules_save(%L, '{"speed": 5}')$$, tests.id('zone_a')), 'an unknown rule is refused', '22023');
select public.route_plan_rules_save(tests.id('zone_a'), '{"show_rider": true, "avg_days": 14}');

-- who is here: the attendance book, the person's own mark, an absence application
select tests.logout();
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('r1'), current_date, 'present');
insert into public.attendance_self_marks (employee_id, hub_id, work_date, kind, note) values (tests.id('r2'), tests.id('hub_a1'), current_date, 'absent', 'sick');
insert into public.wf_daily_ops (employee_id, hub_id, zone_id, work_date, pickup, delivery, delivery_return) values
  (tests.id('r1'), tests.id('hub_a1'), tests.id('zone_a'), current_date - 1, 4, 60, 5),
  (tests.id('r1'), tests.id('hub_a1'), tests.id('zone_a'), current_date - 2, 6, 70, 5),
  (tests.id('r1'), tests.id('hub_a1'), tests.id('zone_a'), current_date - 40, 9, 999, 0),
  (tests.id('r1'), tests.id('hub_a1'), tests.id('zone_a'), current_date, 3, 55, 2);
insert into public.da_sessions (hub_id, zone_id, account_date, started_by, status) values
  (tests.id('hub_a1'), tests.id('zone_a'), current_date - 1, tests.id('hub_mgr'), 'approved'),
  (tests.id('hub_a1'), tests.id('zone_a'), current_date - 2, tests.id('hub_mgr'), 'open');
insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, rider_name, delivery_qty, pickup_qty)
select s.id, s.hub_id, s.zone_id, tests.id('r2'), 'Second Rider', 40, 2 from public.da_sessions s where s.hub_id = tests.id('hub_a1');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (select x -> 'presence' = '{"state":"present","source":"attendance"}'::jsonb and (x ->> 'fixed')::int = 70 and (x ->> 'pickup')::boolean
                           and x -> 'self' = '{"days":2,"delivery":130,"returned":10,"pickup":10}'::jsonb and (x -> 'acc' ->> 'days')::int = 0
                           and x -> 'done' -> 'self' = '{"delivery":55,"returned":2,"pickup":3}'::jsonb
                           from jsonb_array_elements(g -> 'people') x where x ->> 'id' = tests.id('r1')::text)
                    and (select x -> 'presence' = '{"state":"absent","source":"self"}'::jsonb and x -> 'acc' = '{"days":1,"delivery":40,"pickup":2}'::jsonb
                           and x -> 'done' -> 'self' = 'null'::jsonb
                           from jsonb_array_elements(g -> 'people') x where x ->> 'id' = tests.id('r2')::text)
                    and (select (x ->> 'helper')::boolean and (x ->> 'helper_max')::int = 15 from jsonb_array_elements(g -> 'people') x where x ->> 'id' = tests.id('cc')::text)
                    and (g -> 'load' ->> 'rider_parcels')::int = 60
                   from public.route_plan_get(tests.id('hub_a1')) g),
  'people: here or not with its source, the fixed number, the last 14 days of own reports and sent accounts, today''s result');

-- the hub manager types the numbers and the shares
select tests.throws(format($$select public.route_plan_save(%L, current_date + 2, '{"arrived": 5}')$$, tests.id('hub_a1')), 'no plan for the day after tomorrow', '22023');
select tests.throws(format($$select public.route_plan_save(%L, current_date, '{"arrived": -1}')$$, tests.id('hub_a1')), 'a negative number is refused', '22023');
select tests.throws(format($$select public.route_plan_save(%L, current_date, '{"arrived": "many"}')$$, tests.id('hub_a1')), 'a word instead of a number is refused', '22023');
select tests.throws(format($$select public.route_plan_save(%L, current_date, '{"arrived": 5}')$$, tests.id('hub_a2')), 'not at another hub', '42501');
insert into tests.ids select 'plan', public.route_plan_save(tests.id('hub_a1'), current_date, jsonb_build_object(
  'arrived', 120, 'carried', 10, 'sent', 5, 'cancelled', 5, 'pickups', 8, 'source', '{"arrived": "manual"}'::jsonb,
  'route_parcels', jsonb_build_object(tests.id('route1')::text, 120), 'unassigned', 20, 'note', 'Second rider is sick',
  'people', jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('r1'), 'present', true, 'capacity', 66, 'parcels', 85, 'pickups', 8, 'detail', jsonb_build_array(
      jsonb_build_object('route_id', tests.id('route1'), 'parcels', 60), jsonb_build_object('route_id', tests.id('route1'), 'parcels', 25, 'for', tests.id('r2')))),
    jsonb_build_object('employee_id', tests.id('r2'), 'present', false, 'parcels', 0),
    jsonb_build_object('employee_id', tests.id('cc'), 'kind', 'helper', 'capacity', 15, 'parcels', 15))));
select tests.ok((select arrived = 120 and carried = 10 and sent = 5 and cancelled = 5 and pickups = 8 and unassigned = 20 and status = 'draft' and version = 1
                    and (route_parcels ->> tests.id('route1')::text)::int = 120 from public.route_day_plans where id = tests.id('plan'))
            and (select count(*) = 3 and sum(parcels) = 100 from public.route_day_riders where plan_id = tests.id('plan') and removed_at is null),
  'the plan is saved as a draft with its numbers and three people');
select tests.ok((select (h -> 0 -> 'plan' ->> 'given')::int = 100 and (h -> 0 -> 'plan' ->> 'people')::int = 2 and h -> 0 -> 'plan' ->> 'status' = 'draft' from public.route_plan_hubs() h),
  'the hub list shows the plan in short');
select tests.throws(format($$select public.route_plan_save(%L, current_date, jsonb_build_object('people', jsonb_build_array(jsonb_build_object('employee_id', %L, 'parcels', 5))))$$,
  tests.id('hub_a1'), tests.id('other')), 'a person of another hub cannot be on the plan', '22023');
select tests.throws(format($$select public.route_plan_save(%L, current_date, jsonb_build_object('people', jsonb_build_array(
  jsonb_build_object('employee_id', %L, 'parcels', 50, 'detail', jsonb_build_array(jsonb_build_object('route_id', %L, 'parcels', 40))))))$$,
  tests.id('hub_a1'), tests.id('r1'), tests.id('route1')), 'parts that do not add up are refused', '22023');
select tests.throws(format($$select public.route_plan_save(%L, current_date, jsonb_build_object('people', jsonb_build_array(
  jsonb_build_object('employee_id', %L, 'parcels', 40, 'detail', jsonb_build_array(jsonb_build_object('route_id', %L, 'parcels', 40))))))$$,
  tests.id('hub_a1'), tests.id('r1'), tests.id('route2')), 'a part on a route of another hub is refused', '22023');
select tests.throws(format($$select public.route_plan_save(%L, current_date, jsonb_build_object('route_parcels', jsonb_build_object(%L, 5)))$$,
  tests.id('hub_a1'), tests.id('route2')), 'parcels on a route of another hub are refused', '22023');
select tests.throws(format($$select public.route_plan_save(%L, current_date, jsonb_build_object('people', jsonb_build_array(
  jsonb_build_object('employee_id', %L, 'parcels', 1), jsonb_build_object('employee_id', %L, 'parcels', 2))))$$,
  tests.id('hub_a1'), tests.id('r1'), tests.id('r1')), 'the same person twice is refused', '22023');
select tests.ok((select count(*) = 3 and sum(parcels) = 100 from public.route_day_riders where plan_id = tests.id('plan') and removed_at is null), 'a refused save changes nothing');

-- a change: one number only, then the people list without the helper
select public.route_plan_save(tests.id('hub_a1'), current_date, '{"cancelled": 7}');
select tests.ok((select cancelled = 7 and arrived = 120 and version = 2 from public.route_day_plans where id = tests.id('plan'))
            and (select count(*) = 3 from public.route_day_riders where plan_id = tests.id('plan') and removed_at is null), 'one number changes, the rest and the people stay');
select public.route_plan_save(tests.id('hub_a1'), current_date, jsonb_build_object('people', jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('r1'), 'present', true, 'parcels', 85, 'pickups', 8),
  jsonb_build_object('employee_id', tests.id('r2'), 'present', false, 'parcels', 0))));
select tests.ok((select removed_at is not null from public.route_day_riders where plan_id = tests.id('plan') and employee_id = tests.id('cc'))
            and (select jsonb_array_length(g -> 'plan' -> 'lines') = 2 from public.route_plan_get(tests.id('hub_a1')) g), 'a person left off the list is taken off the plan (kept in the table)');
select tests.throws(format($$select public.route_plan_decide(%L, true)$$, tests.id('plan')), 'the hub manager cannot approve', '42501');
select tests.throws(format($$select public.route_plan_remove(%L, 'wrong day')$$, tests.id('plan')), 'nor remove', '42501');
select tests.throws($$delete from public.route_day_plans$$, 'no direct delete', '42501');
select tests.throws($$update public.route_day_plans set arrived = 1$$, 'no direct update', '42501');

-- send, back, send, approve
select public.route_plan_save(tests.id('hub_a1'), current_date, '{}', true);
select tests.ok((select status = 'sent' and sent_by = tests.id('hub_mgr') and sent_at is not null from public.route_day_plans where id = tests.id('plan')), 'sent to the zonal manager');
select tests.login(tests.id('rider_login'));
select tests.ok(public.route_plan_mine() is null, 'the rider sees nothing before the plan is approved');
select tests.throws(format($$select public.route_plan_get(%L)$$, tests.id('hub_a1')), 'and never the whole plan', '42501');
select tests.ok(tests.row_count('select 1 from public.route_day_riders') = 0, 'nor the lines');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.route_plan_decide(%L, false, '')$$, tests.id('plan')), 'sending back needs a reason', '22023');
select public.route_plan_decide(tests.id('plan'), false, 'Give the helper some parcels');
select tests.ok((select status = 'draft' and decide_note = 'Give the helper some parcels' from public.route_day_plans where id = tests.id('plan')), 'sent back with the reason');
select tests.throws(format($$select public.route_plan_decide(%L, false, 'again')$$, tests.id('plan')), 'a draft cannot be sent back', '22023');
select public.route_plan_save(tests.id('hub_a1'), current_date, jsonb_build_object('unassigned', 5, 'people', jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('r1'), 'present', true, 'parcels', 85, 'pickups', 8, 'detail', jsonb_build_array(
    jsonb_build_object('route_id', tests.id('route1'), 'parcels', 60), jsonb_build_object('route_id', tests.id('route1'), 'parcels', 25, 'for', tests.id('r2')))),
  jsonb_build_object('employee_id', tests.id('r2'), 'present', false, 'parcels', 0),
  jsonb_build_object('employee_id', tests.id('cc'), 'kind', 'helper', 'parcels', 15))));
select tests.ok((select removed_at is null and parcels = 15 from public.route_day_riders where plan_id = tests.id('plan') and employee_id = tests.id('cc')), 'the helper is back on the plan');
select public.route_plan_decide(tests.id('plan'), true);
select tests.ok((select status = 'approved' and decided_by = tests.id('zonal_a') from public.route_day_plans where id = tests.id('plan')), 'the zonal manager approves (also straight from a draft)');
select tests.throws(format($$select public.route_plan_save(%L, current_date, '{"arrived": 1}')$$, tests.id('hub_a1')), 'an approved plan does not change', '22023');
select tests.throws(format($$select public.route_plan_decide(%L, true)$$, tests.id('plan')), 'nor is it approved twice', '22023');

-- the rider's own share
select tests.login(tests.id('rider_login'));
select tests.ok((select (m ->> 'parcels')::int = 85 and (m ->> 'pickups')::int = 8 and m ->> 'hub' = 'Hub A1' and jsonb_array_length(m -> 'detail') = 2
                    and m -> 'detail' -> 1 ->> 'for' = 'Second Rider' and m -> 'detail' -> 0 ->> 'route' like '% · Town East'
                   from public.route_plan_mine() m), 'after approval the rider sees the own parcels, by route and for whom');
select tests.login(tests.id('zonal_a'));
select public.route_plan_rules_save(tests.id('zone_a'), '{"show_rider": false}');
select tests.login(tests.id('rider_login'));
select tests.ok(public.route_plan_mine() is null, 'the zone can switch the rider''s view off');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.route_plan_mine() is null, 'a person without a line sees nothing');

-- reopen and remove
select tests.throws(format($$select public.route_plan_reopen(%L, 'more parcels came')$$, tests.id('plan')), 'the hub manager cannot reopen', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.route_plan_reopen(%L, '')$$, tests.id('plan')), 'reopening needs a reason', '22023');
select public.route_plan_reopen(tests.id('plan'), 'more parcels came');
select tests.ok((select status = 'draft' from public.route_day_plans where id = tests.id('plan')), 'reopened: a draft again');
select tests.throws(format($$select public.route_plan_remove(%L, '')$$, tests.id('plan')), 'removing needs a reason', '22023');
select public.route_plan_remove(tests.id('plan'), 'made for the wrong day');
select tests.ok((select archived_at is not null from public.route_day_plans where id = tests.id('plan'))
            and (select g -> 'plan' = 'null'::jsonb from public.route_plan_get(tests.id('hub_a1')) g), 'removed: kept in the table, gone from the page');
insert into tests.ids select 'plan2', public.route_plan_save(tests.id('hub_a1'), current_date, '{"arrived": 90}');
select tests.ok(tests.id('plan2') <> tests.id('plan') and (select (g -> 'plan' ->> 'arrived')::int = 90 and (g -> 'hints' ->> 'unassigned_before') is null from public.route_plan_get(tests.id('hub_a1')) g),
  'a new plan can be started for the same day');
select tests.throws(format($$select public.route_plan_save(%L, current_date, '{}', true)$$, tests.id('hub_a1')), 'an empty plan cannot be sent', '22023');
select tests.throws(format($$select public.route_plan_decide(%L, true)$$, tests.id('plan2')), 'nor approved', '22023');

-- history and strangers
select tests.logout();
select tests.ok((select count(*) >= 5 from public.audit_logs where table_name = 'route_day_plans' and record_id = tests.id('plan')::text), 'every change of the plan is in the audit log');
select tests.login(tests.id('noroles'));
select tests.ok(public.route_plan_hubs() = '[]'::jsonb, 'a person without the permission plans no hub');
select tests.login_anon();
select tests.throws(format($$select public.route_plan_get(%L)$$, tests.id('hub_a1')), 'not signed in: nothing', '42501');
select 'done';
rollback;
