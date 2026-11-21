-- রুট ম্যাপ অডিটের ঠিক করা: near check-in stays, the road line follows its places, each rider once, a removed code is free, a road line is checked.
begin;
select tests.fixture();
select tests.hr_fixture();
update public.hubs set latitude = 24.3745000, longitude = 88.6042000 where id = tests.id('hub_a1');
insert into tests.ids values
  ('r1', tests.active_employee('Route Rider', '861', tests.id('hub_a1'), '01711000861', '8610000000', 15000, tests.id('rider_login'))),
  ('r2', tests.active_employee('Second Rider', '862', tests.id('hub_a1'), '01711000862', '8620000000'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'rider' and p.code = 'ops.route_visit.create' on conflict do nothing;
create function tests.rj(p uuid) returns jsonb language sql security definer set search_path = '' as $$ select private.route_json(p) $$;
grant execute on function tests.rj(uuid) to authenticated;
create function tests.road() returns jsonb language sql as $$
  select jsonb_build_object('km', 5.4, 'minutes', 21, 'path', jsonb_build_array(jsonb_build_array(24.3745, 88.6042), jsonb_build_array(24.364, 88.629))) $$;

select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East', 'road', tests.road(),
  'stops', jsonb_build_array(jsonb_build_object('name', 'Kazla', 'lat', 24.3640, 'lng', 88.6290), jsonb_build_object('name', 'Binodpur', 'lat', 24.3690, 'lng', 88.6410))));
select tests.ok((select road_km = 5.4 from public.hub_routes where id = tests.id('route1')), 'a proper road line is saved');

-- a road line must be [lat, lng] pairs inside Bangladesh
select tests.throws(format($$select public.route_save(tests.rj(%L) || '{"road": {"km": 3, "minutes": 1, "path": ["x", {"a": 1}]}}'::jsonb)$$, tests.id('route1')),
  'a road line that is not a list of points is refused', '22023');
select tests.throws(format($$select public.route_save(tests.rj(%L) || '{"road": {"km": 3, "minutes": 1, "path": [[88.6, 24.3], [999, 999]]}}'::jsonb)$$, tests.id('route1')),
  'a road line outside Bangladesh is refused', '22023');
select tests.ok((select road_km = 5.4 and jsonb_array_length(road_path) = 2 from public.hub_routes where id = tests.id('route1')), 'the good line is still there');

-- the old hub page: same areas keep the line, a changed list clears it
select tests.login(tests.id('hub_mgr'));
update public.hub_routes set note = 'from the hub page' where id = tests.id('route1');
select tests.ok((select road_km = 5.4 and note = 'from the hub page' from public.hub_routes where id = tests.id('route1')), 'old page: a plain change keeps the road line');
update public.hub_routes set areas = array['Binodpur', 'New Market'] where id = tests.id('route1');
select tests.ok((select road_km is null and road_minutes is null and road_path is null and areas = array['Binodpur', 'New Market'] and stops_gps = 1
                   from public.hub_routes where id = tests.id('route1')), 'old page: a changed area list clears the old road line');

-- the hub moves: distance measured again, the road line (it started at the hub) cleared
select tests.login(tests.id('zonal_a'));
select public.route_save(tests.rj(tests.id('route1')) || jsonb_build_object('road', tests.road()));
select tests.ok((select road_km = 5.4 and distance_km < 10 from public.hub_routes where id = tests.id('route1')), 'line drawn again; the stop is a few km from the hub');
select tests.logout();
update public.hubs set name = name || ' ' where id = tests.id('hub_a1');
select tests.ok((select road_km = 5.4 from public.hub_routes where id = tests.id('route1')), 'another change to the hub leaves the line alone');
update public.hubs set latitude = 24.6000000, longitude = 88.9000000 where id = tests.id('hub_a1');
select tests.ok((select road_km is null and road_path is null and distance_km > 25 from public.hub_routes where id = tests.id('route1')),
  'the hub moved: straight distance measured from the new place, old road line cleared');
update public.hubs set latitude = 24.3745000, longitude = 88.6042000 where id = tests.id('hub_a1');

-- a rider taken off and put back the same day is named once
select tests.login(tests.id('zonal_a'));
select public.route_save(jsonb_set(tests.rj(tests.id('route1')), '{stops,1}', (tests.rj(tests.id('route1')) -> 'stops' -> 1) || '{"lat": 24.3640, "lng": 88.6290}'::jsonb));
select public.route_riders_set(tests.id('route1'), array[tests.id('r1'), tests.id('r2')]);
select public.route_riders_set(tests.id('route1'), array[tests.id('r1')]);
select public.route_riders_set(tests.id('route1'), array[tests.id('r1'), tests.id('r2')]);
select tests.ok((select string_agg(x ->> 'name', ', ') = 'Route Rider, Second Rider'
                   from jsonb_array_elements(public.route_day(tests.id('zone_a')) -> 'routes' -> 0 -> 'riders') x), 'day list: each rider once');

-- check-in: far can be put right, near is not undone
select tests.login(tests.id('rider_login'));
select tests.ok(not (public.route_checkin((select id from public.hub_route_stops where route_id = tests.id('route1') and name = 'New Market' and archived_at is null), 24.3700, 88.6290, 10) ->> 'near')::boolean,
  'first press from far: marked far');
select tests.ok((public.route_checkin((select id from public.hub_route_stops where route_id = tests.id('route1') and name = 'New Market' and archived_at is null), 24.3641, 88.6290, 10) ->> 'near')::boolean,
  'went closer and pressed again: near');
select tests.ok((select (x ->> 'near')::boolean and (x ->> 'kept')::boolean and (x ->> 'distance_m')::integer < 150
                   from (select public.route_checkin((select id from public.hub_route_stops where route_id = tests.id('route1') and name = 'New Market' and archived_at is null), 24.3900, 88.6290, 10) x) t),
  'a later press from far away does not undo it');
select tests.ok((select count(*) = 1 and bool_and(near) and max(distance_m) < 150 from public.route_stop_visits), 'one visit for the stop, still near');

-- the code of a removed route can be used again; two live routes still cannot share one
select tests.login(tests.id('zonal_a'));
select public.route_archive(tests.id('route1'), 'made again');
insert into tests.ids select 'route2', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East 2', 'code', 'R01', 'stops', '[{"name":"Kazla"}]'::jsonb));
select tests.ok((select code = 'R01' and archived_at is null from public.hub_routes where id = tests.id('route2')), 'the removed route''s code is free again');
select tests.throws(format($$select public.route_save(jsonb_build_object('hub_id', %L, 'name', 'Clash', 'code', 'R01', 'stops', '[{"name":"X"}]'::jsonb))$$, tests.id('hub_a1')),
  'two live routes of a hub cannot share a code', '23505');
select 'done';
rollback;
