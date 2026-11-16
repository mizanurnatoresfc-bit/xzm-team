-- ডেইলি রিপোর্ট ইম্পোর্ট: three checks or nothing, the same report twice is one, a list in two reports counts once,
-- the khata follows the report's manager (not the uploader), riders by ID, unknown ID -> map, scope.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('ri_mgr',  tests.active_employee('Rashed Miah',  '6865',  tests.id('hub_a1'), '01711006865', '6865010101', 30000, tests.id('hub_mgr'))),
  ('ri_r1',   tests.active_employee('Sazib Ali',    '44174', tests.id('hub_a1'), '01711044174', '4417401010')),
  ('ri_r2',   tests.active_employee('Amirul Islam', '35541', tests.id('hub_a1'), '01711035541', '3554101010')),
  ('ri_r3',   tests.active_employee('No Code Yet',  '9001',  tests.id('hub_a1'), '01711009001', '9001010101'));
create temp table t (k text primary key, v jsonb);
grant all on t to authenticated;
-- report 744847 (manager 6865): 3 lists, 8 + 27 + 37 = 72 parcels, 43490 + 20789 + 44054 = 108333, charge 230 -> 108563
insert into t values ('r1', '{"report_no":"744847","manager_code":"6865","manager_name":"MD. RASHED MIAH","hub_text":"Hub A1",
  "reported_at":"2026-11-16T20:37:00","collected":108563,"delivery_charge":230,"declared_lists":3,"declared_parcels":72,
  "lists":[{"list_no":"11440804","point":true,"rider_code":null,"rider_name":null,"parcels":8,"amount":43490},
           {"list_no":"11450821","point":false,"rider_code":"44174","rider_name":"Md Sazib Ali","parcels":27,"amount":20789},
           {"list_no":"11451178","point":false,"rider_code":"35541","rider_name":"amirul islam","parcels":37,"amount":44054}]}');
create function pg_temp.raw() returns text language sql as $$ select 'Update Report #744847 … the pasted text, kept as proof' $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Dhaka')::date $$;

-- ---------- who may upload ----------
select tests.login_anon();
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), (select v from t where k = 'r1'))$$, 'anonymous cannot upload', '42501');
select tests.login(tests.id('hub_b_mgr'));
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), (select v from t where k = 'r1'))$$, 'another hub''s manager cannot upload for this hub', '42501');
select tests.login(tests.id('auditor'));
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), (select v from t where k = 'r1'))$$, 'a viewer cannot upload', '42501');

-- ---------- the three checks: one digit off and nothing is saved ----------
select tests.login(tests.id('zonal_a'));
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), jsonb_set((select v from t where k = 'r1'), '{collected}', '108564'))$$,
  'money does not add up -> refused', '22023');
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), jsonb_set((select v from t where k = 'r1'), '{lists,1,amount}', '20788'))$$,
  'one digit changed in a list amount -> refused', '22023');
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), jsonb_set((select v from t where k = 'r1'), '{declared_parcels}', '73'))$$,
  'parcels do not add up -> refused', '22023');
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), jsonb_set((select v from t where k = 'r1'), '{declared_lists}', '4'))$$,
  'number of lists differs -> refused', '22023');
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), jsonb_set((select v from t where k = 'r1'), '{lists,1,list_no}', '"11440804"'))$$,
  'the same list twice in one report -> refused', '22023');
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), jsonb_set((select v from t where k = 'r1'), '{lists,1,rider_code}', 'null'))$$,
  'a rider list without a rider ID -> refused', '22023');
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today() + 1, pg_temp.raw(), (select v from t where k = 'r1'))$$, 'a future date is refused', '22023');
select tests.throws($$select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), '', (select v from t where k = 'r1'))$$, 'the pasted text is needed as proof', '22023');
select tests.logout();
select tests.ok((select count(*) from public.da_import_reports) = 0 and (select count(*) from public.da_import_lists) = 0, 'after all the refusals nothing was saved');

-- ---------- saving; the zonal manager uploads for a hub of the zone ----------
select tests.login(tests.id('zonal_a'));
select tests.ok((public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), (select v from t where k = 'r1')) ->> 'created')::boolean, 'a report that passes is saved (zonal manager, any hub of the zone)');
select tests.throws($$select public.da_import_save(tests.id('hub_b1'), pg_temp.today(), pg_temp.raw(), (select v from t where k = 'r1'))$$, 'the zonal manager cannot upload for another zone''s hub', '42501');
select tests.ok((select raw_text = pg_temp.raw() and uploaded_by = tests.id('zonal_a') and manager_code = '6865' and lists_amount = 108333
                   from public.da_import_reports where report_no = 744847), 'the pasted text, the uploader and the report''s manager are kept');

-- the same report again (by someone else): still one, updated
select tests.login(tests.id('hub_mgr'));
select tests.ok(not (public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw() || ' again', (select v from t where k = 'r1')) ->> 'created')::boolean, 'the same report ID again is an update');
select tests.ok((select count(*) = 1 and max(upload_count) = 2 and max(raw_text) like '% again' from public.da_import_reports), 'the same report twice leaves one report');
select tests.ok((select count(*) = 3 from public.da_import_lists where removed_at is null), '…and its lists once');

-- ---------- the khata: one per manager per day, riders by ID ----------
insert into t values ('day', public.da_import_day(pg_temp.today(), tests.id('hub_a1')));
select tests.ok((select jsonb_array_length(v) = 1 and v #>> '{0,manager_code}' = '6865' and v #>> '{0,manager_name}' = 'Rashed Miah'
                        and (v #>> '{0,lists}')::int = 3 and (v #>> '{0,parcels}')::int = 72 and (v #>> '{0,lists_amount}')::numeric = 108333
                        and (v #>> '{0,delivery_charge}')::numeric = 230 and (v #>> '{0,total}')::numeric = 108563 from t where k = 'day'),
  'one khata for the manager written in the report (not the uploader), with the day''s totals');
select tests.ok((select jsonb_array_length(v #> '{0,riders}') = 2 and (v #>> '{0,point,amount}')::numeric = 43490 and (v #>> '{0,point,parcels}')::int = 8 from t where k = 'day'),
  'Point delivery is its own row, riders are separate');
select tests.ok((select bool_and((r ->> 'known')::boolean) and bool_or(r ->> 'name' = 'Sazib Ali') from t, jsonb_array_elements(v #> '{0,riders}') r where k = 'day'),
  'riders are matched by ID and shown with the system''s name, not the report''s');

-- a second report of the same manager, same day: one known rider again, one unknown ID, and list 11450821 repeated
insert into t values ('r2', '{"report_no":"744900","manager_code":"6865","manager_name":"MD. RASHED MIAH","hub_text":"Hub A1",
  "reported_at":"2026-11-16T22:10:00","collected":31789,"delivery_charge":0,"declared_lists":3,"declared_parcels":40,
  "lists":[{"list_no":"11450821","point":false,"rider_code":"44174","rider_name":"Md Sazib Ali","parcels":27,"amount":20789},
           {"list_no":"11460001","point":false,"rider_code":"44174","rider_name":"Md Sazib Ali","parcels":3,"amount":1000},
           {"list_no":"11460002","point":false,"rider_code":"77777","rider_name":"New Rider","parcels":10,"amount":10000}]}');
select tests.ok((public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), (select v from t where k = 'r2')) ->> 'in_other_reports')::int = 1,
  'a list that is also in another report is noticed');
update t set v = public.da_import_day(pg_temp.today(), tests.id('hub_a1')) where k = 'day';
select tests.ok((select jsonb_array_length(v) = 1 and jsonb_array_length(v #> '{0,reports}') = 2 from t where k = 'day'), 'two reports of one manager on one day are still one khata');
select tests.ok((select (v #>> '{0,lists}')::int = 5 and (v #>> '{0,parcels}')::int = 85 and (v #>> '{0,lists_amount}')::numeric = 119333 from t where k = 'day'),
  'a list ID in two reports is counted once (5 lists, 85 parcels, 119,333)');
select tests.ok((select (r ->> 'parcels')::int = 30 and (r ->> 'amount')::numeric = 21789 and jsonb_array_length(r -> 'lists') = 2
                   from t, jsonb_array_elements(v #> '{0,riders}') r where k = 'day' and r ->> 'rider_code' = '44174'),
  'a rider is one row with the sum of the day''s lists, and the lists underneath');
select tests.ok((select not (r ->> 'known')::boolean and r ->> 'name' = 'New Rider' from t, jsonb_array_elements(v #> '{0,riders}') r where k = 'day' and r ->> 'rider_code' = '77777'),
  'an ID the system does not know is shown as unknown');
select tests.ok((select unknown_riders = 1 and reports = 2 and managers = 1 and lists = 5 and amount = 119333 and can_upload
                   from public.da_import_status(pg_temp.today()) where hub_id = tests.id('hub_a1')), 'the hub''s status for the day');

-- map the unknown ID
select tests.login(tests.id('hub_b_mgr'));
select tests.throws($$select public.da_import_map_rider('77777', tests.id('ri_r3'))$$, 'another hub''s manager cannot map the ID', '42501');
select tests.login(tests.id('hub_mgr'));
select public.da_import_map_rider('77777', tests.id('ri_r3'));
select tests.ok((select (r ->> 'known')::boolean and r ->> 'name' = 'No Code Yet' from jsonb_array_elements(public.da_import_day(pg_temp.today(), tests.id('hub_a1')) #> '{0,riders}') r
                  where r ->> 'rider_code' = '77777'), 'after mapping the ID is the staff member');
select tests.ok((select unknown_riders = 0 from public.da_import_status(pg_temp.today()) where hub_id = tests.id('hub_a1')), '…and no unknown rider is left');

-- another manager's report the same day is another khata, whoever uploads it
insert into t values ('r3', '{"report_no":"745000","manager_code":"5555","manager_name":"OTHER MANAGER","hub_text":"Hub A1",
  "reported_at":"2026-11-16T21:00:00","collected":500,"delivery_charge":0,"declared_lists":1,"declared_parcels":1,
  "lists":[{"list_no":"11470001","point":false,"rider_code":"35541","rider_name":"amirul islam","parcels":1,"amount":500}]}');
select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(), (select v from t where k = 'r3'));
select tests.ok(jsonb_array_length(public.da_import_day(pg_temp.today(), tests.id('hub_a1'))) = 2, 'a different manager ID is a different khata, though the same person uploaded');

-- re-upload with a list taken out: the list leaves the khata
select public.da_import_save(tests.id('hub_a1'), pg_temp.today(), pg_temp.raw(),
  (select jsonb_set(jsonb_set(jsonb_set(jsonb_set(v, '{lists}', (v -> 'lists') - 2), '{declared_lists}', '2'), '{declared_parcels}', '30'), '{collected}', '21789') from t where k = 'r2'));
select tests.ok((select count(*) = 0 from jsonb_array_elements(public.da_import_day(pg_temp.today(), tests.id('hub_a1')) #> '{1,riders}') r where r ->> 'rider_code' = '77777')
            and (select removed_at is not null from public.da_import_lists where list_no = 11460002), 'a list no longer in a re-uploaded report is no longer counted');

-- the date is the uploader's choice: moving the report moves it to that day's khata
select public.da_import_save(tests.id('hub_a1'), pg_temp.today() - 1, pg_temp.raw(), (select v from t where k = 'r3'));
select tests.ok(jsonb_array_length(public.da_import_day(pg_temp.today(), tests.id('hub_a1'))) = 1
            and jsonb_array_length(public.da_import_day(pg_temp.today() - 1, tests.id('hub_a1'))) = 1, 'the report sits in the khata of the date picked at upload');

-- ---------- scope ----------
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(jsonb_array_length(public.da_import_day(pg_temp.today())) = 0 and (select count(*) from public.da_import_reports) = 0
            and (select count(*) from public.da_import_lists) = 0, 'another hub''s manager sees nothing of this hub');
select tests.ok((select count(*) = 1 and bool_and(hub_id = tests.id('hub_b1') and reports = 0) from public.da_import_status(pg_temp.today())), '…only the own hub, with nothing uploaded');
select tests.login(tests.id('auditor'));
select tests.ok(jsonb_array_length(public.da_import_day(pg_temp.today())) = 1 and (select not can_upload from public.da_import_status(pg_temp.today()) where hub_id = tests.id('hub_a1')),
  'a viewer sees the khata but may not upload');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$insert into public.da_import_rider_map (rider_code, employee_id) values ('1', tests.id('ri_r1'))$$, 'no direct writes', '42501');
select tests.throws($$update public.da_import_reports set collected = 1$$, 'no direct updates', '42501');
select tests.logout();
rollback;
