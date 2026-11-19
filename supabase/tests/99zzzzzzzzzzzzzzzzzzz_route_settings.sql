-- রাইডার রুট: real locations, zone route settings, rider check-in.
begin;
select tests.fixture();
select tests.hr_fixture();
update public.hubs set latitude = 24.3745000, longitude = 88.6042000 where id = tests.id('hub_a1');
insert into tests.ids values
  ('r1', tests.active_employee('Route Rider', '861', tests.id('hub_a1'), '01711000861', '8610000000', 15000, tests.id('rider_login'))),
  ('r2', tests.active_employee('Second Rider', '862', tests.id('hub_a1'), '01711000862', '8620000000')),
  ('rb', tests.active_employee('Other Hub Rider', '863', tests.id('hub_b1'), '01711000863', '8630000000'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
create function tests.rj(p uuid) returns jsonb language sql security definer set search_path = '' as $$ select private.route_json(p) $$;
grant execute on function tests.rj(uuid) to authenticated;

-- who sees the zone page
select tests.login(tests.id('zonal_a'));
select tests.ok(public.route_zones() = jsonb_build_array(jsonb_build_object('id', tests.id('zone_a'), 'code', 'ZA', 'name', 'Zone A')), 'a zonal manager sees only their zone');
select tests.throws(format($$select public.route_zone_overview(%L)$$, tests.id('zone_b')), 'not another zone', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.route_zones() = '[]'::jsonb, 'a hub manager has no route settings yet (given later)');
select tests.throws(format($$select public.route_zone_overview(%L)$$, tests.id('zone_a')), 'the hub manager cannot open the zone page', '42501');
select tests.throws(format($$select public.route_settings_save(%L, '{"max_stops": 5}')$$, tests.id('zone_a')), 'the hub manager cannot change the rules', '42501');

-- a route with real locations
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East', 'color', '#2563EB',
  'stops', jsonb_build_array(
    jsonb_build_object('name', 'Kazla', 'lat', 24.3640, 'lng', 88.6290),
    jsonb_build_object('name', 'Binodpur', 'lat', 24.3690, 'lng', 88.6410, 'kind', 'landmark', 'radius_m', 200),
    jsonb_build_object('name', 'Talaimari'))));
select tests.ok((select code = 'R01' and areas = array['Kazla', 'Binodpur', 'Talaimari'] and stops_gps = 2 and distance_km between 2 and 6
                   from public.hub_routes where id = tests.id('route1')), 'saved: code given, areas follow the stops, km from the hub GPS');
select tests.ok((select count(*) = 3 from public.hub_route_stops where route_id = tests.id('route1') and archived_at is null), 'three stops in order');
select tests.throws(format($$select public.route_save(jsonb_build_object('hub_id', %L, 'name', 'Wrong', 'stops', jsonb_build_array(jsonb_build_object('name', 'X', 'lat', 88.6, 'lng', 24.3))))$$,
  tests.id('hub_a1')), 'latitude and longitude swapped: refused', '22023');
select tests.throws(format($$select public.route_save(jsonb_build_object('hub_id', %L, 'name', 'Other', 'stops', jsonb_build_array(jsonb_build_object('name', 'X'))))$$,
  tests.id('hub_b1')), 'not a hub of another zone', '42501');
select tests.throws(format($$select public.route_save(jsonb_build_object('hub_id', %L, 'name', 'Empty', 'stops', '[]'::jsonb))$$, tests.id('hub_a1')),
  'a route needs a stop', '22023');

-- a road line is kept until a stop moves
select public.route_save(tests.rj(tests.id('route1')) || jsonb_build_object('road', jsonb_build_object('km', 5.4, 'minutes', 21,
  'path', jsonb_build_array(jsonb_build_array(24.3745, 88.6042), jsonb_build_array(24.364, 88.629)))));
select tests.ok((select road_km = 5.4 and road_minutes = 21 and jsonb_array_length(road_path) = 2 from public.hub_routes where id = tests.id('route1')), 'road line saved');
select public.route_save(tests.rj(tests.id('route1')));
select tests.ok((select road_km = 5.4 from public.hub_routes where id = tests.id('route1')), 'saved again unchanged: road line stays');
select public.route_save(jsonb_set(tests.rj(tests.id('route1')), '{stops,2}',
  (tests.rj(tests.id('route1')) -> 'stops' -> 2) || '{"lat": 24.3720, "lng": 88.6150}'::jsonb));
select tests.ok((select road_km is null and stops_gps = 3 from public.hub_routes where id = tests.id('route1')), 'a stop got a location: the old road line is cleared');

-- an older screen writes the area list: the stops follow and keep their GPS
select tests.login(tests.id('hub_mgr'));
update public.hub_routes set areas = array['Binodpur', 'Kazla', 'New Market'] where id = tests.id('route1');
select tests.ok((select string_agg(name || ':' || coalesce(lat::text, '-'), ',' order by seq) = 'Binodpur:24.3690000,Kazla:24.3640000,New Market:-'
                   from public.hub_route_stops where route_id = tests.id('route1') and archived_at is null), 'old page: order follows, GPS kept by name, new area has none');
select tests.ok((select count(*) = 1 from public.hub_route_stops where route_id = tests.id('route1') and archived_at is not null), 'the dropped area is archived, not deleted');
select tests.ok((select stops_gps = 2 from public.hub_routes where id = tests.id('route1')), 'counts recalculated');
select tests.ok(tests.row_count(format('select 1 from public.hub_route_stops where route_id = %L', tests.id('route1'))) = 4, 'the hub manager reads the stops (ops.route.view)');
-- the hub manager may still edit through the new function (ops.route.edit)
select tests.ok(public.route_save(tests.rj(tests.id('route1')) || '{"note": "from hub"}'::jsonb) = tests.id('route1'), 'the hub manager saves through the same function');

-- zone rules
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.route_settings_save(%L, '{"speed": 5}')$$, tests.id('zone_a')), 'an unknown rule is refused', '22023');
select tests.throws(format($$select public.route_settings_save(%L, '{"stop_radius_m": 5}')$$, tests.id('zone_a')), 'a rule out of range is refused', '22023');
select tests.ok((public.route_settings_save(tests.id('zone_a'), '{"max_stops": 3, "max_riders": 1, "max_routes_per_rider": 1, "stop_radius_m": 100}') ->> 'max_stops') = '3', 'rules saved');
select tests.throws(format($$select public.route_save(jsonb_build_object('hub_id', %L, 'name', 'Big', 'stops', '[{"name":"a"},{"name":"b"},{"name":"c"},{"name":"d"}]'::jsonb))$$,
  tests.id('hub_a1')), 'more stops than the zone allows', '22023');

-- riders
select tests.throws(format($$select public.route_riders_set(%L, array[%L, %L]::uuid[])$$, tests.id('route1'), tests.id('r1'), tests.id('r2')), 'more riders than allowed', '22023');
select tests.throws(format($$select public.route_riders_set(%L, array[%L]::uuid[])$$, tests.id('route1'), tests.id('rb')), 'a rider of another hub is refused', '22023');
select tests.ok((public.route_riders_set(tests.id('route1'), array[tests.id('r1')]) ->> 'added') = '1', 'rider given');
insert into tests.ids select 'route2', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town West', 'stops', '[{"name":"Uposhohor","lat":24.38,"lng":88.59}]'::jsonb));
select tests.throws(format($$select public.route_riders_set(%L, array[%L]::uuid[])$$, tests.id('route2'), tests.id('r1')), 'routes per rider limit', '22023');
select tests.ok((select (x -> 'routes' -> 0 -> 'riders' -> 0 ->> 'name') = 'Route Rider' and jsonb_array_length(x -> 'hubs') = 2
                   and (x -> 'can' ->> 'configure')::boolean from (select public.route_zone_overview(tests.id('zone_a')) x) t), 'the zone page shows routes, riders and hubs');

-- check-in: not given to riders yet
select tests.login(tests.id('rider_login'));
select tests.ok(jsonb_array_length(public.my_route_today() -> 'routes') = 1 and not (public.my_route_today() -> 'routes' -> 0 ->> 'can_checkin')::boolean, 'the rider sees the route, check-in not given yet');
select tests.throws(format($$select public.route_checkin((select id from public.hub_route_stops where route_id = %L and name = 'Kazla' and archived_at is null), 24.364, 88.629, 10)$$,
  tests.id('route1')), 'no permission: no check-in', '42501');
-- the Super Admin gives it to the rider role later
select tests.logout();
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'rider' and p.code = 'ops.route_visit.create';
select tests.login(tests.id('rider_login'));
select tests.ok((public.route_checkin((select id from public.hub_route_stops where route_id = tests.id('route1') and name = 'Kazla' and archived_at is null), 24.3641, 88.6291, 10) ->> 'near')::boolean,
  'at the stop: near');
select tests.ok(not (public.route_checkin((select id from public.hub_route_stops where route_id = tests.id('route1') and name = 'Binodpur' and archived_at is null), 24.3745, 88.6042, 10) ->> 'near')::boolean,
  'far from the stop: kept, marked far');
select tests.throws(format($$select public.route_checkin((select id from public.hub_route_stops where route_id = %L and name = 'New Market' and archived_at is null), 24.37, 88.6)$$,
  tests.id('route1')), 'a stop without a location cannot be checked in', 'P0001');
select tests.throws(format($$select public.route_checkin((select id from public.hub_route_stops where route_id = %L limit 1), 24.38, 88.59)$$, tests.id('route2')), 'not my route', '42501');
select tests.ok((select count(*) = 2 from public.route_stop_visits), 'two check-ins, one per stop and day');

-- the zonal manager reads the day
select tests.login(tests.id('zonal_a'));
select tests.ok((select (r -> 'riders' -> 0 ->> 'visited') = '2' and (r -> 'riders' -> 0 ->> 'far') = '1'
                   from jsonb_array_elements(public.route_day(tests.id('zone_a')) -> 'routes') r where r ->> 'route_id' = tests.id('route1')::text), 'day: visited and far counted');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.route_day(%L)$$, tests.id('zone_a')), 'the hub manager has no check-in view yet', '42501');
select tests.ok(tests.row_count('select 1 from public.route_stop_visits') = 0, 'and reads no check-ins');

-- remove
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.route_archive(%L, '')$$, tests.id('route1')), 'removing needs a reason', '22023');
select public.route_archive(tests.id('route1'), 'Merged with Town West');
select tests.ok((select archived_at is not null from public.hub_routes where id = tests.id('route1'))
            and not exists (select 1 from public.rider_routes where route_id = tests.id('route1') and effective_to is null), 'removed and its riders ended');

select tests.login_anon();
select tests.throws($$select public.route_zones()$$, 'not signed in: nothing', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws($$select private.route_rules(null)$$, 'private helpers are closed', '42501');
select 'done';
rollback;
