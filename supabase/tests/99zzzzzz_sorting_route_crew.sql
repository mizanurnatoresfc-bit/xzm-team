-- Sorting routes with locations and crew; hub people see them; hub → sorting reports.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into tests.ids values ('staff_login', tests.make_user('hubstaff@test.local', 'Hub Staff'));
insert into tests.ids values
  ('drv', tests.active_employee('Line Driver', '901', tests.id('hub_a1'), '01711000901', '9010101010', 15000, tests.id('rider_login'))),
  ('stf', tests.active_employee('Hub Staff', '902', tests.id('hub_a2'), '01711000902', '9020101010', 15000, tests.id('staff_login')));

-- Center A in zone A serves A1 and A2; its own hub is A1.
with x as (insert into public.sorting_centers (code, name, zone_id) values ('NSC', 'Natore Sorting', tests.id('zone_a')) returning id)
insert into t select 'c', id::text from x;
update public.hubs set sorting_center_id = (select v::uuid from t where k = 'c') where id in (tests.id('hub_a1'), tests.id('hub_a2'));
update public.sorting_centers set home_hub_id = tests.id('hub_a1') where id = (select v::uuid from t where k = 'c');

-- ---------- routes with hub stops and free locations ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.sorting_route_save(%L, '{"name":"X"}'::jsonb, '[{"place":"Savar"}]'::jsonb)$$, (select v from t where k = 'c')),
  'a hub manager cannot make a sorting route', '42501');

select tests.login(tests.id('zonal_a'));
insert into t values ('r1', public.sorting_route_save((select v::uuid from t where k = 'c'),
  '{"name":"Natore → Savar","kind":"linehaul","depart_time":"21:00","instructions":"রাত ৯টার মধ্যে ব্যাগ রেডি"}'::jsonb,
  '[{"place":"সাভার","latitude":23.8583,"longitude":90.2667,"arrive_time":"03:30","instructions":"গেট ২ দিয়ে ঢুকবে"}]'::jsonb)::text);
insert into t values ('r2', public.sorting_route_save((select v::uuid from t where k = 'c'),
  '{"name":"Natore → A2 → Rajshahi"}'::jsonb,
  format('[{"hub_id":"%s","can_charge":true},{"place":"রাজশাহী","latitude":24.3745,"longitude":88.6042}]', tests.id('hub_a2'))::jsonb)::text);
select tests.ok((select count(*) = 1 from public.sorting_route_hubs where route_id = (select v::uuid from t where k = 'r1') and hub_id is null and place = 'সাভার'), 'a free location is a stop');
select tests.ok((select kind = 'linehaul' and instructions is not null from public.sorting_routes where id = (select v::uuid from t where k = 'r1')), 'route keeps kind and instructions');
select tests.throws(format($$select public.sorting_route_save(%L, '{"name":"Bad"}'::jsonb, '[{"place":""}]'::jsonb)$$, (select v from t where k = 'c')),
  'a stop needs a hub or a place name', '22023');
select tests.throws(format($$select public.sorting_route_save(%L, '{"name":"Bad"}'::jsonb, '[{"hub_id":"%s"},{"hub_id":"%s"}]'::jsonb)$$,
  (select v from t where k = 'c'), tests.id('hub_a2'), tests.id('hub_a2')), 'the same hub twice is refused', '22023');
-- A hub of another area may be a stop (long routes cross areas).
insert into t values ('stop_a2', (select id::text from public.sorting_route_hubs where route_id = (select v::uuid from t where k = 'r2') and hub_id = tests.id('hub_a2')));
select public.sorting_route_save((select v::uuid from t where k = 'c'), '{"name":"Natore → A2 → Rajshahi → B1"}'::jsonb,
  format('[{"id":"%s","hub_id":"%s","can_charge":true},{"place":"রাজশাহী"},{"hub_id":"%s"}]', (select v from t where k = 'stop_a2'), tests.id('hub_a2'), tests.id('hub_b1'))::jsonb,
  (select v::uuid from t where k = 'r2'));
select tests.ok((select count(*) = 3 from public.sorting_route_hubs where route_id = (select v::uuid from t where k = 'r2')), 'route now has three stops');
select tests.ok((select seq = 1 and can_charge from public.sorting_route_hubs where id = (select v::uuid from t where k = 'stop_a2')), 'a kept stop keeps its id and order');

-- ---------- crew: by employee ID or typed name + phone ----------
insert into t values ('k1', public.sorting_crew_save((select v::uuid from t where k = 'r1'), 'driver', p_employee_code => '901')::text);
select tests.ok(tests.row_count('select 1 from public.sorting_route_crew') = 0, 'crew rows are not readable directly — only through the functions');
select tests.logout();
select tests.ok((select name = 'Line Driver' and phone = '01711000901' from public.sorting_route_crew where id = (select v::uuid from t where k = 'k1')), 'name and phone come from the employee ID');
select tests.login(tests.id('zonal_a'));
select tests.ok((select driver_id = tests.id('drv') from public.sorting_routes where id = (select v::uuid from t where k = 'r1')), 'the route driver follows the crew');
select tests.throws(format($$select public.sorting_crew_save(%L, 'driver', p_employee_code => '901')$$, (select v from t where k = 'r1')), 'the same person twice is refused', '23505');
insert into t values ('k2', public.sorting_crew_save((select v::uuid from t where k = 'r1'), 'helper', 'Rahim Helper', '01811-222333')::text);
insert into t values ('k3', public.sorting_crew_save((select v::uuid from t where k = 'r2'), 'manager', 'A2 Receiver', '01911222333',
  p_stop => (select v::uuid from t where k = 'stop_a2'))::text);
select tests.throws(format($$select public.sorting_crew_save(%L, 'helper', 'No Phone', '')$$, (select v from t where k = 'r1')), 'a phone number is required', '22023');
select tests.throws(format($$select public.sorting_crew_save(%L, 'rider', 'Wrong Stop', '01700000000', p_stop => %L)$$, (select v from t where k = 'r1'), (select v from t where k = 'stop_a2')),
  'a stop of another route is refused', '22023');
select tests.ok(jsonb_array_length((public.sorting_routes_full((select v::uuid from t where k = 'c'))->'routes')) = 2, 'the center sees both routes');

-- ---------- the hub panel: staff see the people with numbers ----------
select tests.login(tests.id('staff_login'));
insert into t values ('panel', public.sorting_hub_panel()::text);
select tests.ok(((select v::jsonb from t where k = 'panel')->'hub'->>'id')::uuid = tests.id('hub_a2'), 'a staff member gets their own hub');
select tests.ok(((select v::jsonb from t where k = 'panel')->'routes'->0->>'mine')::boolean, 'the route stopping at the hub comes first');
select tests.ok(exists (select 1 from jsonb_array_elements((select v::jsonb from t where k = 'panel')->'routes') r, jsonb_array_elements(r->'crew') k
  where k->>'phone' = '01911222333'), 'staff see the stop manager''s number');
select tests.ok(jsonb_array_length((select v::jsonb from t where k = 'panel')->'routes') = 2, 'staff also see the center''s other routes as information');
select tests.throws(format($$select public.sorting_hub_panel(%L)$$, tests.id('hub_b1')), 'staff cannot open another hub''s panel', '42501');
select tests.throws(format($$select public.sorting_crew_save(%L, 'helper', 'Me', '01700000000')$$, (select v from t where k = 'r1')), 'staff cannot assign crew', '42501');

-- ---------- hub → sorting report ----------
insert into t values ('rep', public.sorting_hub_report_submit(tests.id('hub_a2'), 'damaged', '৩টা পার্সেল ভেজা এসেছে', '{}', 'SF123, SF124', 3,
  (select v::uuid from t where k = 'r2'))::text);
select tests.throws(format($$select public.sorting_hub_report_submit(%L, 'other', '')$$, tests.id('hub_a2')), 'an empty report is refused', '22023');
select tests.throws(format($$select public.sorting_hub_report_submit(%L, 'other', 'x', array['hubreport/someone-else/a.jpg'])$$, tests.id('hub_a2')),
  'a photo uploaded by someone else is refused', '22023');
select tests.throws(format($$select public.sorting_hub_report_submit(%L, 'other', 'x')$$, tests.id('hub_b1')), 'staff cannot report for another hub', '42501');
select tests.ok(jsonb_array_length(public.sorting_hub_panel()->'reports') = 1, 'the hub panel lists its reports');
select tests.throws(format($$select public.sorting_hub_report_reply(%L, 'solved', 'ok')$$, (select v from t where k = 'rep')), 'hub staff cannot answer for the center', '42501');
select tests.throws(format($$select public.sorting_hub_reports(%L, current_date, current_date)$$, (select v from t where k = 'c')), 'hub staff do not see the center list', '42501');

-- The center's own hub manager (A1) sees and answers.
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.sorting_hub_reports((select v::uuid from t where k = 'c'), current_date, current_date)) = 1, 'the center sees the hub report');
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('hub_mgr') and link like '/app/sorting/hubreports%'), 'the center was notified');
select public.sorting_hub_report_reply((select v::uuid from t where k = 'rep'), 'solved', 'বদলে পাঠানো হচ্ছে');
select tests.logout();
select tests.ok((select status = 'solved' and replied_by_name is not null from public.sorting_hub_reports where id = (select v::uuid from t where k = 'rep')), 'report solved with a reply');
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('staff_login') and link = '/app/hub-sorting'), 'the reporter hears back');

-- B1's manager (another area, B1 not on center A except as a stop) sees the route stopping at B1.
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(exists (select 1 from public.sorting_panel_hubs() where hub_id = tests.id('hub_b1')), 'B1 manager may open B1''s panel');
select tests.ok((select count(*) = 1 from jsonb_array_elements(public.sorting_hub_panel(tests.id('hub_b1'))->'routes')), 'B1 sees the route that stops there');
select tests.throws(format($$select public.sorting_hub_reports(%L, current_date, current_date)$$, (select v from t where k = 'c')), 'B1 manager does not see the center reports', '42501');

-- ---------- end a crew assignment ----------
select tests.login(tests.id('zonal_a'));
select public.sorting_crew_end((select v::uuid from t where k = 'k1'), 'ছুটিতে');
select tests.ok((select driver_id is null from public.sorting_routes where id = (select v::uuid from t where k = 'r1')), 'ending the driver clears the route driver');
select tests.ok(jsonb_array_length((select r->'crew' from jsonb_array_elements(public.sorting_routes_full((select v::uuid from t where k = 'c'))->'routes') r
  where r->>'id' = (select v from t where k = 'r1'))) = 1, 'only the helper is left on the route');
select tests.logout();
rollback;
