-- গাড়ি (fleet): a zone's vehicles given to hubs, crew by kind with a daily allowance that reaches the sheet with a voucher,
-- the auto's garage charge, hub reports to the zonal manager, requests with photos, fuel approved onto the sheet, and the assign log.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into tests.ids values
  ('drv', tests.active_employee('Truck Driver', '801', tests.id('hub_a1'), '01711000801', '8010101010', 15000, tests.id('rider_login'))),
  ('hlp_login', tests.make_user('helper@test.local', 'Helper Login')),
  ('auto_login', tests.make_user('auto@test.local', 'Auto Login'));
insert into tests.ids values
  ('hlp', tests.active_employee('Truck Helper', '802', tests.id('hub_a1'), '01711000802', '8020101010', 15000, tests.id('hlp_login'))),
  ('adr', tests.active_employee('Auto Driver', '803', tests.id('hub_a1'), '01711000803', '8030101010', 15000, tests.id('auto_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('hlp_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('auto_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('hub_mgr'), 'accounts_manager', 'hub', null, tests.id('hub_a1'));   -- writes the hub's sheet and approves vehicle costs

-- ---------- vehicles of the zone, given to a hub ----------
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.fleet_vehicle_save('Truck', 'DM-TA-11', 'truck', %L)$$, tests.id('hub_a1')), 'a driver cannot add a vehicle', '42501');
select tests.login(tests.id('zonal_a'));
insert into t values ('truck', public.fleet_vehicle_save('Natore Truck', 'DM-TA 11-2233', 'truck', tests.id('hub_a1'))::text);
insert into t values ('auto', public.fleet_vehicle_save('Lalpur Auto', null, 'auto', tests.id('hub_a1'))::text);
select tests.ok((select code::text like 'G-%' from public.vehicles where id = (select v::uuid from t where k = 'truck')), 'a vehicle gets its own code');
select tests.throws(format($$select public.fleet_vehicle_save('Plane', null, 'helicopter', %L)$$, tests.id('hub_a1')), 'an unknown kind is refused', '22023');
select public.fleet_vehicle_save('Natore Truck', 'DM-TA 11-2233', 'truck', tests.id('hub_a2'), 'active', (select v::uuid from t where k = 'truck'));
select tests.ok((select hub_id = tests.id('hub_a2') from public.vehicles where id = (select v::uuid from t where k = 'truck')), 'the zonal manager gives the truck to another hub');
select public.fleet_vehicle_save('Natore Truck', 'DM-TA 11-2233', 'truck', tests.id('hub_a1'), 'active', (select v::uuid from t where k = 'truck'));
select tests.throws(format($$select public.fleet_vehicle_save('Natore Truck', null, 'truck', %L, 'active', %L)$$, tests.id('hub_b1'), (select v from t where k = 'truck')),
  'a vehicle cannot go to a hub outside the manager''s zone', '42501');

-- ---------- crew by kind, with a daily allowance ----------
select public.fleet_set_crew((select v::uuid from t where k = 'truck'), 'driver', '801', 150);
select public.fleet_set_crew((select v::uuid from t where k = 'truck'), 'helper', '802', 100);
select public.fleet_set_crew((select v::uuid from t where k = 'auto'), 'driver', '803', 120);
select tests.throws(format($$select public.fleet_set_crew(%L, 'helper', '801', 50)$$, (select v from t where k = 'auto')), 'an auto has no helper', '22023');
select tests.ok((select hub_id = tests.id('hub_a1') from public.vehicles where id = (select v::uuid from t where k = 'truck')), 'setting the driver does not move the vehicle');
select public.fleet_set_crew((select v::uuid from t where k = 'truck'), 'helper', '802', 110);
select tests.ok((select daily_allowance = 110 from public.vehicle_assignments where vehicle_id = (select v::uuid from t where k = 'truck') and role = 'helper' and effective_to is null),
  'the same person''s allowance can be changed');
select tests.ok((select count(*) from public.vehicle_assignments where vehicle_id = (select v::uuid from t where k = 'truck') and role = 'helper') = 1, 'changing the allowance does not reassign');

-- ---------- the assign log ----------
select tests.ok((select string_agg(distinct x ->> 'action', ',' order by x ->> 'action') from jsonb_array_elements(public.fleet_events((select v::uuid from t where k = 'truck'))) x)
  = 'allowance,created,crew_set,hub', 'the log keeps creation, hub moves, crew and allowance changes');

-- ---------- khoraki: on the hub's sheet, with a voucher, once a day ----------
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.fleet_khoraki_post(%L)$$, (select v from t where k = 'truck')), 'a driver cannot post the allowance', '42501');
select tests.login(tests.id('hub_mgr'));
insert into t values ('k1', public.fleet_khoraki_post((select v::uuid from t where k = 'truck'))::text);
select tests.ok((select count(*) from jsonb_array_elements((select v::jsonb from t where k = 'k1')) x where (x ->> 'posted')::boolean and x ->> 'voucher' like 'V-%') = 2,
  'driver and helper allowances go on the sheet, each with a voucher');
select tests.ok((select count(*) from public.da_expenses where expense_name like 'খোরাকি%' and voucher_no is not null and removed_at is null) = 2, 'two allowance lines are on the sheet');
select tests.ok((select bool_and(category = 'meal' or category <> 'meal') from public.da_expenses where expense_name like 'খোরাকি%'), 'allowance lines have a category');
select tests.ok((select count(*) from jsonb_array_elements(public.fleet_khoraki_post((select v::uuid from t where k = 'truck'))) x where (x ->> 'skipped')::boolean) = 2,
  'posting again the same day adds nothing');

-- ---------- the auto's garage charge ----------
insert into t values ('g1', public.fleet_garage_save((select v::uuid from t where k = 'auto'), null, true, 80, 'Rahim Garage')::text);
select tests.ok(((select v::jsonb from t where k = 'g1') ->> 'posted')::boolean, 'a garage bill goes on the sheet');
select tests.ok((select charged and charge_cost = 80 from public.vehicle_day_logs where vehicle_id = (select v::uuid from t where k = 'auto')), 'the day shows it was charged');

-- ---------- fuel with a slip: the crew puts it up, the manager approves, it reaches the sheet ----------
select tests.login(tests.id('rider_login'));
insert into t values ('f1', public.vehicle_log_save((select v::uuid from t where k = 'truck'), 'fuel', 1050, null, null, 10, 'Padma Pump', null, null, null, null, null,
                                                    (select v from t where k = 'truck') || '/slip.jpg')::text);
select tests.ok((select status = 'submitted' and da_expense_id is null from public.vehicle_logs where id = (select v::uuid from t where k = 'f1')), 'fuel waits for the manager');
select tests.throws(format($$select public.fleet_approve(%L)$$, (select v from t where k = 'f1')), 'the driver cannot approve their own fuel', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select jsonb_array_length(public.fleet_waiting() -> 'logs')) >= 1, 'the manager sees the fuel waiting');
insert into t values ('a1', public.fleet_approve((select v::uuid from t where k = 'f1'))::text);
select tests.ok(((select v::jsonb from t where k = 'a1') ->> 'posted')::boolean and (select v::jsonb from t where k = 'a1') ->> 'voucher' like 'V-%',
  'approving fuel puts it on the sheet with a voucher');

-- ---------- requests with photos ----------
select tests.login(tests.id('auto_login'));
select tests.throws(format($$select public.fleet_request(%L, 'service', 'Brake', '{}'::jsonb, 'normal', array['someone-else/x.jpg'])$$, (select v from t where k = 'auto')),
  'a photo must be the vehicle''s own', '22023');
insert into t values ('q1', public.fleet_request((select v::uuid from t where k = 'auto'), 'service', 'Brake is weak', '{"what":"ব্রেক"}'::jsonb, 'urgent',
                                                 array[(select v from t where k = 'auto') || '/a.jpg', (select v from t where k = 'auto') || '/b.jpg'])::text);
select tests.ok((select cardinality(photos) = 2 from public.vehicle_requests where id = (select v::uuid from t where k = 'q1')), 'a request keeps all its photos');
select tests.ok((select jsonb_array_length(public.fleet_mine() #> '{vehicles,0,requests}')) = 1, 'the auto driver sees the request on their panel');
select tests.login(tests.id('hub_mgr'));
insert into t values ('d1', public.fleet_request_done((select v::uuid from t where k = 'q1'), 450, 'Brake shoe changed')::text);
select tests.ok(((select v::jsonb from t where k = 'd1') ->> 'posted')::boolean, 'a finished request with a cost goes on the sheet');
select tests.login(tests.id('auto_login'));
select tests.ok((select count(*) from jsonb_array_elements(public.fleet_mine() #> '{vehicles,0,costs}') c where c ->> 'kind' = 'charge') = 1
  and (select count(*) from jsonb_array_elements(public.fleet_mine() #> '{vehicles,0,garage}')) = 1, 'the auto driver sees the garage bill and costs');

-- ---------- hub reports to the zonal manager ----------
select tests.login(tests.id('hlp_login'));
select tests.throws(format($$select public.fleet_hub_report(%L, %L, 'no_trip')$$, (select v from t where k = 'truck'), tests.id('hub_a2')), '"no trip" needs a note', '22023');
select tests.throws(format($$select public.fleet_hub_report(%L, %L, 'on_time')$$, (select v from t where k = 'truck'), tests.id('hub_b1')), 'a hub outside the zone is refused', '22023');
select public.fleet_hub_report((select v::uuid from t where k = 'truck'), tests.id('hub_a1'), 'on_time');
select public.fleet_hub_report((select v::uuid from t where k = 'truck'), tests.id('hub_a2'), 'unload_late', 45, 'লোক ছিল না');
select tests.login(tests.id('auto_login'));
select tests.throws(format($$select public.fleet_hub_report(%L, %L, 'on_time')$$, (select v from t where k = 'truck'), tests.id('hub_a1')), 'only the vehicle''s own crew reports', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('zonal_a') and title like 'Hub A2: আনলোডে দেরি%'), 'the zonal manager is told about late unloading');
select tests.ok(jsonb_array_length(public.fleet_hub_reports(private.da_today() - 1, private.da_today())) = 2, 'the zonal manager sees the day''s hub reports');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(jsonb_array_length(public.fleet_hub_reports(private.da_today() - 1, private.da_today())) = 0, 'another zone''s manager sees none');

-- ---------- the crew's panel ----------
select tests.login(tests.id('rider_login'));
select tests.ok((select (x ->> 'role') = 'driver' and jsonb_array_length(x -> 'crew') = 1 and (x ->> 'allowance')::numeric = 150
                 from jsonb_array_elements(public.fleet_mine() -> 'vehicles') x), 'the driver sees the truck, the helper and the allowance');
select tests.ok((select count(*) from jsonb_array_elements(public.fleet_mine() #> '{vehicles,0,costs}') c where c ->> 'kind' = 'khoraki') = 1,
  'a crew member sees only their own allowance');

-- ---------- settings ----------
select tests.login(tests.id('super'));
select public.vehicle_configure('fleet', jsonb_set(private.fleet_setting(), '{functions,hub_report}', 'false'));
select tests.login(tests.id('hlp_login'));
select tests.throws(format($$select public.fleet_hub_report(%L, %L, 'on_time')$$, (select v from t where k = 'truck'), tests.id('hub_a1')), 'a function switched off is refused', '22023');
select tests.login(tests.id('super'));
select tests.throws($$select public.vehicle_configure('fleet', '{"kinds":[{"code":"auto","crew":["helper"]}]}'::jsonb)$$, 'every kind needs a driver', '22023');
select tests.ok(jsonb_array_length(public.fleet_approvers()) >= 10, 'settings show who holds each vehicle permission');

-- ---------- old links ----------
select tests.logout();
select private.notify(tests.id('hub_mgr'), 'x', 'y', '/app/vehicles/logs?v=1', 'vehicle');
select tests.ok((select link = '/app/fleet' from public.notifications where profile_id = tests.id('hub_mgr') and title = 'x'), 'old vehicle links point to the new page');
rollback;
