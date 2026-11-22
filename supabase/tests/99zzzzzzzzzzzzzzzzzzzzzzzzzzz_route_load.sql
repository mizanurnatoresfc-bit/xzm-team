-- রুটের পার্সেল চাপ: rider capacity per hub, average parcels per route, what the daily accounts say.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('r1', tests.active_employee('Route Rider', '861', tests.id('hub_a1'), '01711000861', '8610000000')),
  ('r2', tests.active_employee('Second Rider', '862', tests.id('hub_a1'), '01711000862', '8620000000'));
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East', 'stops', '[{"name":"Kazla"}]'::jsonb));

-- nothing typed yet
select tests.ok((select (h ->> 'rider_parcels') is null and (h ->> 'days')::int = 0 and h -> 'routes' = '{}'::jsonb
                   from jsonb_array_elements(public.route_load_overview(tests.id('zone_a')) -> 'hubs') h where h ->> 'hub_id' = tests.id('hub_a1')::text), 'empty: no capacity, no days, no route numbers');

-- the zonal manager types the numbers
select public.route_load_save(tests.id('hub_a1'), jsonb_build_object('rider_parcels', 60, 'routes', jsonb_build_array(jsonb_build_object('id', tests.id('route1'), 'avg_parcels', 150))));
select tests.ok((select (h ->> 'rider_parcels')::int = 60 and (h -> 'routes' ->> tests.id('route1')::text)::int = 150
                   from jsonb_array_elements(public.route_load_overview(tests.id('zone_a')) -> 'hubs') h where h ->> 'hub_id' = tests.id('hub_a1')::text), 'capacity per rider and the route average are saved');
select public.route_load_save(tests.id('hub_a1'), '{"rider_parcels": 70}');
select tests.ok((select rider_parcels = 70 from public.route_hub_load where hub_id = tests.id('hub_a1'))
            and (select avg_parcels = 150 from public.hub_routes where id = tests.id('route1')), 'saving one number leaves the other alone');
select public.route_load_save(tests.id('hub_a1'), jsonb_build_object('routes', jsonb_build_array(jsonb_build_object('id', tests.id('route1'), 'avg_parcels', null))));
select tests.ok((select avg_parcels is null from public.hub_routes where id = tests.id('route1')), 'a route average can be cleared');
select tests.throws(format($$select public.route_load_save(%L, '{"rider_parcels": 0}')$$, tests.id('hub_a1')), 'zero parcels per rider is refused', '22023');
select tests.throws(format($$select public.route_load_save(%L, '{"rider_parcels": "many"}')$$, tests.id('hub_a1')), 'a word instead of a number is refused', '22023');
select tests.throws(format($$select public.route_load_save(%L, jsonb_build_object('routes', jsonb_build_array(jsonb_build_object('id', %L, 'avg_parcels', 5))))$$,
  tests.id('hub_a2'), tests.id('route1')), 'a route of another hub is refused', '22023');
select tests.throws(format($$select public.route_load_save(%L, '{"rider_parcels": 50}')$$, tests.id('hub_b1')), 'not a hub of another zone', '42501');
select tests.throws(format($$select public.route_load_overview(%L)$$, tests.id('zone_b')), 'not another zone', '42501');

-- who else
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.route_load_overview(%L)$$, tests.id('zone_a')), 'a hub manager has no zone route page yet', '42501');
select tests.ok(tests.row_count('select 1 from public.route_hub_load') = 0, 'and reads no capacity rows');

-- what the daily accounts say: only submitted / approved sheets of the period, removed lines left out
select tests.logout();
insert into public.da_sessions (hub_id, zone_id, account_date, started_by, status) values
  (tests.id('hub_a1'), tests.id('zone_a'), current_date - 1, tests.id('hub_mgr'), 'approved'),
  (tests.id('hub_a1'), tests.id('zone_a'), current_date - 2, tests.id('hub_mgr'), 'submitted'),
  (tests.id('hub_a1'), tests.id('zone_a'), current_date - 3, tests.id('hub_mgr'), 'open'),
  (tests.id('hub_a1'), tests.id('zone_a'), current_date - 60, tests.id('hub_mgr'), 'approved');
insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, rider_name, delivery_qty, pickup_qty)
select s.id, s.hub_id, s.zone_id, tests.id('r1'), 'Route Rider', 80, 5 from public.da_sessions s where s.hub_id = tests.id('hub_a1');
insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, rider_name, delivery_qty, pickup_qty)
select s.id, s.hub_id, s.zone_id, tests.id('r2'), 'Second Rider', 40, 0 from public.da_sessions s where s.hub_id = tests.id('hub_a1') and s.account_date = current_date - 1;
insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, rider_name, delivery_qty, removed_at, removed_by, remove_reason)
select s.id, s.hub_id, s.zone_id, tests.id('r2'), 'Second Rider', 999, now(), tests.id('hub_mgr'), 'wrong' from public.da_sessions s where s.hub_id = tests.id('hub_a1') and s.account_date = current_date - 2;
select tests.login(tests.id('zonal_a'));
select tests.ok((select (h ->> 'days')::int = 2 and (h ->> 'delivery')::int = 200 and (h ->> 'pickup')::int = 10
                   and (select (x ->> 'days')::int = 2 and (x ->> 'delivery')::int = 160 from jsonb_array_elements(h -> 'riders') x where x ->> 'employee_id' = tests.id('r1')::text)
                   and (select (x ->> 'days')::int = 1 and (x ->> 'delivery')::int = 40 from jsonb_array_elements(h -> 'riders') x where x ->> 'employee_id' = tests.id('r2')::text)
                   from jsonb_array_elements(public.route_load_overview(tests.id('zone_a'), 30) -> 'hubs') h where h ->> 'hub_id' = tests.id('hub_a1')::text),
  '30 days: two sent sheets counted, the open and the old one and the removed line left out');
select tests.ok((select (h ->> 'days')::int = 3 and (h ->> 'delivery')::int = 280
                   from jsonb_array_elements(public.route_load_overview(tests.id('zone_a'), 90) -> 'hubs') h where h ->> 'hub_id' = tests.id('hub_a1')::text), '90 days: the older sheet is counted too');

select tests.login_anon();
select tests.throws(format($$select public.route_load_overview(%L)$$, tests.id('zone_a')), 'not signed in: nothing', '42501');
select 'done';
rollback;
