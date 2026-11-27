-- Offline check-in: route_checkin takes the time the phone really took the reading (p_at) and counts it for that Bangladesh day.
begin;
select tests.fixture();
select tests.hr_fixture();
update public.hubs set latitude = 24.3745000, longitude = 88.6042000 where id = tests.id('hub_a1');
insert into tests.ids values
  ('r1', tests.active_employee('Route Rider', '861', tests.id('hub_a1'), '01711000861', '8610000000', 15000, tests.id('rider_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'rider' and p.code = 'ops.route_visit.create' on conflict do nothing;

create function tests.stop(p text) returns uuid language sql security definer set search_path = '' as
  $$ select id from public.hub_route_stops where route_id = (select id from public.hub_routes where name = 'Town East' and archived_at is null) and name = p and archived_at is null $$;
grant execute on function tests.stop(text) to authenticated;
create function tests.dhaka_day(p timestamptz) returns date language sql immutable as $$ select (p at time zone 'Asia/Dhaka')::date $$;

select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East',
  'stops', jsonb_build_array(jsonb_build_object('name', 'Kazla', 'lat', 24.3640, 'lng', 88.6290), jsonb_build_object('name', 'Binodpur', 'lat', 24.3690, 'lng', 88.6410),
                             jsonb_build_object('name', 'Talaimari', 'lat', 24.3720, 'lng', 88.6150))));
select public.route_riders_set(tests.id('route1'), array[tests.id('r1')]);
select tests.login(tests.id('rider_login'));

-- the old way still works: no p_at, counted now
select tests.ok((public.route_checkin(tests.stop('Kazla'), 24.3641, 88.6291, 10) ->> 'near')::boolean, 'no p_at: checked in as before');
select tests.ok((select abs(extract(epoch from now() - visited_at)) < 5 and work_date = tests.dhaka_day(now()) from public.route_stop_visits where stop_id = tests.stop('Kazla')),
  'stamped now, counted for today');
select tests.ok((public.route_checkin(p_stop => tests.stop('Kazla'), p_lat => 24.3641, p_lng => 88.6291, p_accuracy => 10) ->> 'near')::boolean, 'a named call without p_at is not ambiguous');

-- a late check-in keeps the time the phone took it
select tests.ok((public.route_checkin(tests.stop('Binodpur'), 24.3691, 88.6411, 10, null, now() - interval '3 hours') ->> 'near')::boolean, 'a check-in from 3 hours ago is accepted');
select tests.ok((select abs(extract(epoch from (now() - interval '3 hours') - visited_at)) < 2 from public.route_stop_visits where stop_id = tests.stop('Binodpur')),
  'it is stamped with the time it was taken, not the time it arrived');

-- it counts for the Bangladesh day it was taken on
select public.route_checkin(tests.stop('Talaimari'), 24.3721, 88.6151, 10, null,
  ((tests.dhaka_day(now()) - 1)::timestamp + time '23:30') at time zone 'Asia/Dhaka');
select tests.ok((select work_date = tests.dhaka_day(now()) - 1 from public.route_stop_visits where stop_id = tests.stop('Talaimari')), '23:30 yesterday counts for yesterday');
select tests.ok((select count(*) = 3 from public.route_stop_visits), 'one visit per stop');

-- the time must be believable
select tests.throws(format($$select public.route_checkin(%L, 24.3641, 88.6291, 10, null, now() + interval '1 hour')$$, tests.stop('Kazla')), 'a time in the future is refused', '22023');
select tests.throws(format($$select public.route_checkin(%L, 24.3641, 88.6291, 10, null, now() - interval '49 hours')$$, tests.stop('Kazla')), 'older than 48 hours is refused', '22023');
select tests.ok((public.route_checkin(tests.stop('Kazla'), 24.3641, 88.6291, 10, null, now() + interval '2 minutes') ->> 'near')::boolean, 'a little clock slack (2 minutes ahead) is allowed');

-- out of order and repeated
select public.route_checkin(tests.stop('Binodpur'), 24.3691, 88.6411, 10, null, now() - interval '1 hour');
select tests.ok((select abs(extract(epoch from (now() - interval '1 hour') - visited_at)) < 2 from public.route_stop_visits where stop_id = tests.stop('Binodpur')), 'a later reading replaces the earlier one');
select tests.ok((public.route_checkin(tests.stop('Binodpur'), 24.3691, 88.6411, 10, null, now() - interval '2 hours') ->> 'kept')::boolean, 'an older reading that arrives late is kept out');
select tests.ok((select abs(extract(epoch from (now() - interval '1 hour') - visited_at)) < 2 from public.route_stop_visits where stop_id = tests.stop('Binodpur')), 'the saved time did not go back');
select public.route_checkin(tests.stop('Binodpur'), 24.3691, 88.6411, 10, null, now() - interval '1 hour');
select tests.ok((select count(*) = 1 from public.route_stop_visits where stop_id = tests.stop('Binodpur') and work_date = tests.dhaka_day(now())), 'sending the same reading twice makes one visit');

-- the near rules and the permission checks are the old ones
select tests.ok((public.route_checkin(tests.stop('Binodpur'), 24.3900, 88.6411, 10, null, now() - interval '30 minutes') ->> 'kept')::boolean, 'a later far reading does not undo a near visit');
select tests.logout();
select tests.login_anon();
select tests.throws(format($$select public.route_checkin(%L, 24.3641, 88.6291, 10)$$, tests.stop('Kazla')), 'signed out: nothing', '42501');
select 'done';
rollback;
