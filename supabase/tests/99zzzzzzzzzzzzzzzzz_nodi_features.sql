-- নদী AI: an on/off switch for each part (chat, teach, office, gaps, followup).
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('r1', tests.active_employee('Switch Rider', '851', tests.id('hub_a1'), '01711000851', '8510000000', 15000, tests.id('rider_login')));
update public.employees set status_since = current_date - 5, joining_date = current_date - 5 where id = tests.id('r1');

select tests.login(tests.id('hub_mgr'));
select tests.ok(public.nodi_features() = '{"chat": true, "teach": true, "office": true, "gaps": true, "followup": true}'::jsonb, 'every part starts on');
select tests.ok((public.nodi_gate('chat') ->> 'model') is not null, 'the gate lets chat through');
select tests.ok((public.nodi_gate() ->> 'model') is not null, 'an older Edge Function (no part named) still passes');
select tests.throws($$select public.nodi_features_configure('{"chat": false}')$$, 'a hub manager cannot change the switches', '42501');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) > 0 from public.my_att_gaps()), 'with gaps on, a person is asked about their days');

select tests.login(tests.id('admin'));
select tests.throws($$select public.nodi_features_configure('{"voice": false}')$$, 'an unknown part is refused', '22023');
select tests.throws($$select public.nodi_features_configure('{"chat": "no"}')$$, 'a switch is true or false', '22023');
select public.nodi_features_configure('{"chat": false, "gaps": false}');
select tests.ok((public.nodi_settings() -> 'features') = '{"chat": false, "teach": true, "office": true, "gaps": false, "followup": true}'::jsonb, 'the settings page shows the switches');

select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.nodi_gate('chat')$$, 'chat switched off: the gate stops it', 'P0001');
select tests.ok((public.nodi_gate('teach') ->> 'model') is not null, 'the teacher still works');
select tests.ok((public.nodi_features() ->> 'chat') = 'false' and (public.nodi_features() ->> 'office') = 'true', 'the app reads which parts are on');
select tests.throws($$select public.att_gap_remind(current_date - 5, current_date)$$, 'gaps switched off: no reminders are sent', 'P0001');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 0 from public.my_att_gaps()), 'gaps switched off: nobody is asked');

-- the main switch turns off every AI part, but not the two parts without AI
select tests.login(tests.id('admin'));
select public.nodi_features_configure('{"chat": true, "gaps": true}');
select public.nodi_configure(false, 'claude-sonnet-5-5', 50, 1000);
select tests.ok(public.nodi_features() = '{"chat": false, "teach": false, "office": false, "gaps": true, "followup": true}'::jsonb, 'main switch off: AI parts off, gaps and follow-up stay');
select tests.throws($$select public.nodi_gate('office')$$, 'main switch off: office advice stops', 'P0001');
select tests.throws($$select private.nodi_feature_on('chat')$$, 'the private check is not callable from the browser', '42501');

select tests.logout();
select tests.ok(private.nodi_feature_on('followup'), 'follow-up keeps its own switch (the hourly job checks this)');
select tests.login_anon();
select tests.throws($$select public.nodi_features()$$, 'not signed in: nothing to read', '42501');
select 'done';
rollback;
