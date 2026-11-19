-- রুটের এলাকার নাম: Natore upazilas, villages, markets, unions; fixing and adding places.
begin;
select tests.fixture();
select tests.hr_fixture();
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 7 from public.geo_upazilas), 'every signed-in person reads the seven upazilas');
select tests.ok((select count(*) > 600 from public.route_places where not hidden), 'and the place names (villages, markets, unions)');
select tests.ok((select count(distinct upazila_code) = 7 from public.route_places where kind = 'village'), 'villages in every upazila');
select tests.ok((select count(*) = 52 from public.route_places where kind = 'union'), 'all 52 unions with their official names');
select tests.ok(not exists (select 1 from public.route_places where lat is not null and not (lat between 20.3 and 26.8 and lng between 87.9 and 92.8)), 'every location is inside Bangladesh');
select tests.throws($$select public.route_place_save('{"upazila_code": 146, "name_bn": "নতুন পাড়া", "kind": "para", "lat": 24.31, "lng": 88.95}')$$, 'a rider cannot add places', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.route_place_hide((select id from public.route_places limit 1), true, 'wrong')$$, 'nor a hub manager (not given yet)', '42501');

select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'pl', public.route_place_save('{"upazila_code": 146, "name_bn": "নতুন পাড়া", "kind": "para", "lat": 24.31, "lng": 88.95}');
select tests.ok((select source = 'manual' and bn_checked and kind = 'para' from public.route_places where id = tests.id('pl')), 'the zonal manager adds a place');
select tests.throws($$select public.route_place_save('{"upazila_code": 146, "name_bn": "উল্টো", "lat": 88.95, "lng": 24.31}')$$, 'swapped location refused', '22023');
select tests.throws($$select public.route_place_save('{"upazila_code": 999, "name_bn": "কোথাও"}')$$, 'unknown upazila refused', '22023');
select public.route_place_save(jsonb_build_object('id', (select id from public.route_places where source = 'geonames' and upazila_code = 146 order by name limit 1),
  'name_bn', 'আব্দুলপুর', 'kind', 'village', 'lat', 24.3229, 'lng', 88.9425));
select tests.ok((select name_bn = 'আব্দুলপুর' and bn_checked and name is not null from public.route_places where source = 'geonames' and upazila_code = 146 order by name limit 1), 'a machine-made spelling is fixed and marked checked');
select tests.throws(format($$select public.route_place_hide(%L, true, '')$$, tests.id('pl')), 'hiding needs a reason', '22023');
select public.route_place_hide(tests.id('pl'), true, 'duplicate');
select tests.ok((select hidden from public.route_places where id = tests.id('pl')), 'hidden, not deleted');
select tests.login(tests.id('rider_login'));
select tests.throws($$update public.route_places set hidden = false$$, 'the table cannot be written directly', '42501');
select tests.login_anon();
select tests.throws($$select count(*) from public.route_places$$, 'not signed in: nothing', '42501');
select 'done';
rollback;
