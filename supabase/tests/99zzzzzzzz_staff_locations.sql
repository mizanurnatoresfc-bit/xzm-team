-- Hourly staff location while the app is open; only the zonal manager sees it.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('me', tests.active_employee('Hub Rider', '961', tests.id('hub_a1'), '01711000961', '9610101010', 15000, tests.id('rider_login')));
update public.hubs set latitude = 24.4102, longitude = 89.0076 where id = tests.id('hub_a1');
-- Tests run at any hour: pretend it is duty time (rolled back with the test).
create or replace function private.location_duty_now() returns boolean language sql stable set search_path = '' as $$ select true $$;

select tests.login(tests.id('rider_login'));
select tests.ok((public.my_location_need()->>'track')::boolean, 'an active staff member is asked to send');
select tests.ok((public.staff_location_ping(24.3745, 88.6042, 20)->>'saved')::boolean, 'a location is saved');
select tests.ok(public.staff_location_ping(24.4103, 89.0077, 20)->>'why' = 'too_soon', 'not more than once an hour');
select tests.throws($$select public.staff_location_ping(200, 89, 5)$$, 'a bad location is refused', '22023');
select tests.throws('select * from public.staff_location_pings', 'staff cannot read the pings table', '42501');
select tests.throws(format($$select public.zonal_staff_location_day(%L, current_date)$$, tests.id('me')), 'staff cannot read their trail here', '42501');

-- The hub manager does not see it.
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.zonal_staff_locations()) = 0, 'a hub manager sees nobody');
select tests.throws(format($$select public.zonal_staff_locations(%L)$$, tests.id('zone_a')), 'a hub manager is refused for the zone', '42501');

-- The zonal manager of zone A sees the distance; zone B's does not exist here, so check another zone is refused.
select tests.login(tests.id('zonal_a'));
select tests.ok((select (x->>'place_status') = 'far' and (x->>'distance_m')::int > 30000
  from jsonb_array_elements(public.zonal_staff_locations()) x where x->>'employee_id' = tests.id('me')::text), 'zonal manager sees how far away');
select tests.ok(jsonb_array_length(public.zonal_staff_location_day(tests.id('me'), (now() at time zone 'Asia/Dhaka')::date)) = 1, 'zonal manager sees the day trail');
select tests.throws(format($$select public.zonal_staff_locations(%L)$$, tests.id('zone_b')), 'not another zone', '42501');

-- Off duty nothing is kept.
select tests.logout();
create or replace function private.location_duty_now() returns boolean language sql stable set search_path = '' as $$ select false $$;
update public.staff_location_pings set at = now() - interval '2 hours';
select tests.login(tests.id('rider_login'));
select tests.ok(public.staff_location_ping(24.41, 89.0, 10)->>'why' = 'off_duty', 'outside duty hours nothing is saved');
select tests.login(tests.id('noroles'));
select tests.ok(not (public.my_location_need()->>'track')::boolean, 'someone without a staff profile is not asked');
select tests.logout();
rollback;
