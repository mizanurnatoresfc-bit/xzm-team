-- Is the staff member at the hub? GPS distance to the hub and the hub's saved Wi-Fi; information only.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('me', tests.active_employee('Hub Rider', '951', tests.id('hub_a1'), '01711000951', '9510101010', 15000, tests.id('rider_login')));
-- Hub A1 at Natore; radius 150 m.
update public.hubs set latitude = 24.4102, longitude = 89.0076 where id = tests.id('hub_a1');

-- The hub manager saves the hub's Wi-Fi while connected to it.
select tests.login(tests.id('hub_mgr'));
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.5, 10.0.0.1"}', true);
select tests.ok((public.hub_place_save(tests.id('hub_a1'), 'add')->>'on_hub_wifi')::boolean, 'manager saves the hub Wi-Fi');
select tests.throws(format($$select public.hub_place_save(%L, null, 24.0, 89.0)$$, tests.id('hub_a1')), 'a hub manager cannot move the hub', '42501');
select tests.throws(format($$select public.hub_place_save(%L, 'add')$$, tests.id('hub_b1')), 'not for another hub', '42501');

-- Staff at the hub, on the hub Wi-Fi.
select tests.login(tests.id('rider_login'));
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.5"}', true);
select tests.ok(public.hub_presence_check(24.4105, 89.0079, 20)->>'status' = 'at_hub', 'about 40 m away is at the hub');
select tests.ok((public.hub_presence_check(null, null, null)->>'wifi')::boolean, 'the hub Wi-Fi is recognised without GPS');
select tests.ok(public.hub_presence_check(null, null, null)->>'status' = 'no_gps', 'no GPS is said plainly');
select tests.ok(public.hub_presence_check(24.4150, 89.0076, 30)->>'status' = 'near', 'about 530 m away is near');
-- On mobile data far away.
select set_config('request.headers', '{"x-forwarded-for":"100.64.1.9"}', true);
select tests.ok(public.hub_presence_check(24.3745, 88.6042, 15)->>'status' = 'far', 'Rajshahi is far from Natore');
select tests.ok(not (public.hub_presence_check(24.3745, 88.6042, 15)->>'wifi')::boolean, 'mobile data is not the hub Wi-Fi');
select tests.ok(public.hub_presence_check(24.4103, 89.0077, 5000)->>'status' = 'near', 'a very rough fix is near, not at');

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.5"}', true);
select public.att_self_mark('present', null, 24.4105, 89.0079, 20);
select tests.ok((public.my_att_today()->'mark'->>'place_status') = 'at_hub', 'my mark keeps the place');
select tests.ok((public.my_att_today()->'mark'->>'wifi_match')::boolean, 'my mark keeps the Wi-Fi match');
select public.att_self_mark('present');
select tests.ok((public.my_att_today()->'mark'->>'place_status') = 'no_gps', 'the old two-argument call still works');

select tests.login(tests.id('hub_mgr'));
select tests.ok((select (x->>'place_status') = 'no_gps' and (x->>'wifi_match')::boolean
  from jsonb_array_elements(public.att_self_list(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date)) x), 'the manager sees the place');
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('hub_mgr') and body like '%হাবের ওয়াইফাই%'), 'the notice says hub Wi-Fi');

-- Zonal manager sets GPS and radius.
select tests.login(tests.id('zonal_a'));
select tests.ok((public.hub_place_save(tests.id('hub_a2'), null, 24.5, 89.1, 300)->>'radius_m')::int = 300, 'zonal manager sets hub GPS and radius');
select tests.ok((public.hub_place_save(tests.id('hub_a1'), 'clear')->>'wifi_count')::int = 0, 'Wi-Fi can be cleared');
select tests.logout();
rollback;
