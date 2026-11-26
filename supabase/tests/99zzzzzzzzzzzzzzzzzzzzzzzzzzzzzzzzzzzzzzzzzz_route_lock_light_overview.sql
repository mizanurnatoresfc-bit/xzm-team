-- Route centre step 1: the save lock (expected_updated_at) and the light zone overview (road lines come from route_road_paths).
begin;
select tests.fixture();
select tests.hr_fixture();
update public.hubs set latitude = 24.3745000, longitude = 88.6042000 where id = tests.id('hub_a1');
create function tests.rj(p uuid) returns jsonb language sql security definer set search_path = '' as $$ select private.route_json(p) $$;
grant execute on function tests.rj(uuid) to authenticated;

select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East',
  'stops', jsonb_build_array(jsonb_build_object('name', 'Kazla', 'lat', 24.3640, 'lng', 88.6290), jsonb_build_object('name', 'Binodpur', 'lat', 24.3690, 'lng', 88.6410))));
insert into tests.ids select 'route2', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town West',
  'stops', jsonb_build_array(jsonb_build_object('name', 'Uposhohor', 'lat', 24.38, 'lng', 88.59))));

-- the lock ------------------------------------------------------------
select tests.ok(public.route_save(tests.rj(tests.id('route1')) || jsonb_build_object('note', 'no lock sent')) = tests.id('route1'), 'no expected_updated_at: saves as before');
select tests.ok(public.route_save(tests.rj(tests.id('route1')) || jsonb_build_object('note', 'right stamp',
  'expected_updated_at', (select updated_at from public.hub_routes where id = tests.id('route1')))) = tests.id('route1'), 'the stamp the screen opened with: saves');
select tests.ok((select note = 'right stamp' from public.hub_routes where id = tests.id('route1')), 'and the change is written');
select tests.throws(format($$select public.route_save(jsonb_set(tests.rj(%L), '{note}', '"stale"') || jsonb_build_object('expected_updated_at', %L::timestamptz - interval '1 minute'))$$,
  tests.id('route1'), (select updated_at from public.hub_routes where id = tests.id('route1'))), 'an older stamp: refused', '40001');
select tests.ok((select note = 'right stamp' from public.hub_routes where id = tests.id('route1')), 'a refused save writes nothing');
select tests.ok((select count(*) = 2 from public.hub_route_stops where route_id = tests.id('route1') and archived_at is null), 'stops untouched by the refused save');
select tests.ok(public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'New route', 'expected_updated_at', now() - interval '1 day',
  'stops', jsonb_build_array(jsonb_build_object('name', 'X')))) is not null, 'a new route ignores the stamp');

-- the light overview --------------------------------------------------
select public.route_save(tests.rj(tests.id('route1')) || jsonb_build_object('road', jsonb_build_object('km', 5.4, 'minutes', 21,
  'path', jsonb_build_array(jsonb_build_array(24.3745, 88.6042), jsonb_build_array(24.364, 88.629)))));
select tests.ok((select bool_and(not (r ? 'road_path')) from jsonb_array_elements(public.route_zone_overview(tests.id('zone_a')) -> 'routes') r), 'the overview carries no road lines');
select tests.ok((select bool_or((r ->> 'has_road')::boolean) and not bool_and((r ->> 'has_road')::boolean)
                   from jsonb_array_elements(public.route_zone_overview(tests.id('zone_a')) -> 'routes') r), 'has_road says which routes have one');
select tests.ok((select (r ->> 'road_km')::numeric = 5.4 and jsonb_array_length(r -> 'stops') = 2
                   from jsonb_array_elements(public.route_zone_overview(tests.id('zone_a')) -> 'routes') r where r ->> 'id' = tests.id('route1')::text), 'the rest of a route is still in the overview');
select tests.ok(jsonb_array_length(public.route_road_paths(tests.id('zone_a')) -> tests.id('route1')::text) = 2, 'route_road_paths returns the line');
select tests.ok(not (public.route_road_paths(tests.id('zone_a')) ? tests.id('route2')::text), 'routes without a line are left out');

-- who may read the lines ----------------------------------------------
select tests.throws(format($$select public.route_road_paths(%L)$$, tests.id('zone_b')), 'not another zone', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.route_road_paths(%L)$$, tests.id('zone_a')), 'a role without route settings cannot read them', '42501');
select tests.logout();
select tests.login_anon();
select tests.throws(format($$select public.route_road_paths(%L)$$, tests.id('zone_a')), 'signed out: nothing', '42501');
select 'done';
rollback;
