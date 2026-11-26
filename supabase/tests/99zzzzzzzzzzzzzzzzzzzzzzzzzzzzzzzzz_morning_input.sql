-- সকালের জনবল ও রুট প্রকাশ — the morning input, the zonal manager's sight of it, sending back, the server job, the plan's use of it, published versions.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into public.wf_att_policy (zone_id, morning_open, morning_cutoff, morning_extra)
  values (tests.id('zone_a'), '00:00', '23:59:59', 0);
update public.system_settings set value = to_jsonb(((now() at time zone 'Asia/Dhaka')::date - 10)::text) where key = 'workforce.auto_submit_from';   -- this test is about the jobs themselves: start well before
insert into tests.ids values
  ('r1', tests.active_employee('Route Rider', '881', tests.id('hub_a1'), '01711000881', '8810000000', 15000, tests.id('rider_login'))),
  ('r2', tests.active_employee('Leave Rider', '882', tests.id('hub_a1'), '01711000882', '8820000000')),
  ('cc', tests.active_employee('Backup Rider', '883', tests.id('hub_a1'), '01711000883', '8830000000')),
  ('r3', tests.active_employee('Third Rider', '884', tests.id('hub_a1'), '01711000884', '8840000000')),
  ('other', tests.active_employee('Other Hub Rider', '885', tests.id('hub_a2'), '01711000885', '8850000000'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'route1', public.route_save(jsonb_build_object('hub_id', tests.id('hub_a1'), 'name', 'Town East', 'stops', '[{"name":"Kazla"}]'::jsonb));
select public.route_riders_set(tests.id('route1'), array[tests.id('r1'), tests.id('r2')]);
select tests.logout();
-- r2 has approved leave today (a leave request)
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, status)
  select tests.id('r2'), id, current_date, current_date, 'family', 'approved' from public.leave_types where code = 'casual';

-- ---------------------------------------------------------------- the form
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g ->> 'status' = 'open' and (g -> 'can' ->> 'fill')::boolean and not (g -> 'can' ->> 'review')::boolean
                    and (g ->> 'revision')::int = 1 and g -> 'receipt' = 'null'::jsonb and g -> 'returned' = 'null'::jsonb
                    and (select count(*) from jsonb_array_elements(g -> 'people') x where x ->> 'id' in (tests.id('r1')::text, tests.id('r2')::text, tests.id('cc')::text, tests.id('r3')::text)) = 4
                    and not exists (select 1 from jsonb_array_elements(g -> 'people') x where x ->> 'id' = tests.id('other')::text)
                   from public.wf_morning_get(tests.id('hub_a1')) g), 'the hub manager gets the open form with the hub''s own people');
select tests.ok((select x ->> 'state' = 'leave' and x -> 'leave' ->> 'source' = 'leave_request' and x -> 'leave' ->> 'ref' like 'LR-%'
                   from public.wf_morning_get(tests.id('hub_a1')) g, jsonb_array_elements(g -> 'people') x where x ->> 'id' = tests.id('r2')::text),
  'approved leave sits in by itself, with its reference');
select tests.throws(format($$select public.wf_morning_get(%L)$$, tests.id('hub_a2')), 'not the form of another hub', '42501');
select tests.throws(format($$select public.wf_morning_get(%L, current_date + 1)$$, tests.id('hub_a1')), 'not a day in the future', '22023');
select tests.throws(format($$select public.wf_morning_get(%L, current_date - 5)$$, tests.id('hub_a1')), 'nor a day long gone', '22023');
select tests.throws(format($$select public.wf_morning_save(%L, null, %L::jsonb)$$, tests.id('hub_a1'), '[{"employee_id":"' || tests.id('r1') || '","state":"leave"}]'),
  'leave cannot be typed by hand', '22023');
select tests.throws(format($$select public.wf_morning_save(%L, null, %L::jsonb)$$, tests.id('hub_a1'), '[{"employee_id":"' || tests.id('other') || '","state":"present"}]'),
  'a person of another hub is refused', '22023');
select tests.throws(format($$select public.wf_morning_save(%L, null, '"oops"')$$, tests.id('hub_a1')), 'the lines must be a list', '22023');
select public.wf_morning_save(tests.id('hub_a1'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('cc'), 'state', 'present')));
select tests.ok((select x ->> 'state' = 'present' from public.wf_morning_get(tests.id('hub_a1')) g, jsonb_array_elements(g -> 'people') x where x ->> 'id' = tests.id('cc')::text),
  'what is typed is kept on the server before the submit');
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.wf_morning_get(%L)$$, tests.id('hub_a1')), 'a rider cannot open the form', '42501');
select tests.throws(format($$select public.wf_morning_submit(%L, null, '[]')$$, tests.id('hub_a1')), 'nor submit it', '42501');

-- ---------------------------------------------------------------- submit: lock, receipt, one submission
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (s ->> 'revision')::int = 1 and s ->> 'mode' = 'manager' and not (s ->> 'already')::boolean
                   from public.wf_morning_submit(tests.id('hub_a1'), null, jsonb_build_array(
                     jsonb_build_object('employee_id', tests.id('r1'), 'state', 'absent'), jsonb_build_object('employee_id', tests.id('cc'), 'state', 'present'))) s),
  'submitted by the manager as revision one');
select tests.ok((select (s ->> 'already')::boolean from public.wf_morning_submit(tests.id('hub_a1'), null, '[]') s), 'a second submit is the same submission, nothing changes');
select tests.logout();
select tests.ok((select count(*) = 1 from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date = current_date), 'one submission for the hub and day');
select tests.ok((select string_agg(e.employee_code || ':' || l.state, ',' order by e.employee_code) = '881:absent,882:leave,883:present,884:unknown'
                   from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id join public.employees e on e.id = l.employee_id
                  where s.hub_id = tests.id('hub_a1') and s.work_date = current_date and e.employee_code ~ '^88[0-9]$'),
  'present, absent, leave from the record and unchecked for who was left blank');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g ->> 'status' = 'submitted' and not (g -> 'can' ->> 'fill')::boolean and g -> 'people' = 'null'::jsonb and g -> 'receipt' ->> 'mode' = 'manager'
                   from public.wf_morning_get(tests.id('hub_a1')) g), 'after the submit the hub manager sees a receipt and no lines');
select tests.throws(format($$select public.wf_morning_save(%L, null, '[]')$$, tests.id('hub_a1')), 'the form is locked', '22023');
select tests.throws($$select * from public.wf_morning_lines$$, 'the lines cannot be read from the table by the hub manager', '42501');
select tests.throws($$select * from public.wf_morning_subs$$, 'nor the submissions', '42501');
select tests.throws($$update public.wf_morning_lines set state = 'present'$$, 'nor changed directly', '42501');
select tests.ok(public.wf_morning_zone() -> 'hubs' = '[]'::jsonb, 'the hub manager has no zone view');

-- ---------------------------------------------------------------- the zonal manager
select tests.login(tests.id('zonal_a'));
select tests.ok((select g ->> 'status' = 'submitted' and g -> 'people' is not null and jsonb_array_length(g -> 'people') >= 4 and (g -> 'can' ->> 'review')::boolean
                   from public.wf_morning_get(tests.id('hub_a1')) g), 'the zonal manager sees the lines');
select tests.ok((select (h ->> 'present')::int = 1 and (h ->> 'absent')::int = 1 and (h ->> 'leave')::int = 1 and (h ->> 'unknown')::int >= 1 and h ->> 'state' = 'submitted'
                    and jsonb_array_length(h -> 'cover') = 1 and h -> 'cover' -> 0 ->> 'name' = 'Town East'
                   from public.wf_morning_zone(tests.id('zone_a')) z, jsonb_array_elements(z -> 'hubs') h where h ->> 'id' = tests.id('hub_a1')::text),
  'zone view: counts, and the route whose riders are absent or on leave needs cover');
select tests.ok((select h ->> 'state' = 'none' from public.wf_morning_zone(tests.id('zone_a')) z, jsonb_array_elements(z -> 'hubs') h where h ->> 'id' = tests.id('hub_a2')::text),
  'a hub that has not started shows as none');
select tests.ok((select jsonb_array_length(z -> 'hubs') = 2 from public.wf_morning_zone(null) z), 'the zonal manager sees the hubs of the zone only (two)');

-- ---------------------------------------------------------------- the plan stands on the morning input
select tests.ok((select p ->> 'state' = 'absent' and p ->> 'source' = 'morning' from (select private.route_presence(tests.id('r1'), current_date) p) q),
  'the route plan reads presence from the morning input');
select tests.logout();
select tests.ok((select p ->> 'state' = 'off' and p ->> 'source' = 'morning' from (select private.route_presence(tests.id('r2'), current_date) p) q), 'leave reads as off');
select tests.ok((select p ->> 'state' is null from (select private.route_presence(tests.id('r3'), current_date) p) q), 'unchecked reads as not known');
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'plan', public.route_plan_save(tests.id('hub_a1'), current_date, jsonb_build_object('arrived', 100, 'people', jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('r1'), 'parcels', 40, 'detail', jsonb_build_array(jsonb_build_object('route_id', tests.id('route1'), 'parcels', 40))),
  jsonb_build_object('employee_id', tests.id('cc'), 'parcels', 50))), true);
select tests.ok((select (m -> 'morning' ->> 'revision')::int = 1 and not (m ->> 'plan_stale')::boolean and (m ->> 'required')::boolean from public.route_plan_morning(tests.id('hub_a1')) m),
  'the plan page: the morning input is there and the plan is based on it');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.route_plan_decide(%L, true)$$, tests.id('plan')), 'approval is refused: a rider on the plan is absent this morning', '22023');
select tests.logout();
select tests.ok((select not exists (select 1 from public.route_plan_versions where plan_id = tests.id('plan'))), 'and nothing is published');
select tests.login(tests.id('zonal_a'));

-- ---------------------------------------------------------------- send back, revision two
select tests.throws(format($$select public.wf_morning_return(%L, null, 'x')$$, tests.id('hub_a1')), 'sending back needs a reason', '22023');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.wf_morning_return(%L, null, 'please check again')$$, tests.id('hub_a1')), 'the hub manager cannot send it back', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok(public.wf_morning_return(tests.id('hub_a1'), null, 'Route Rider is here, please check') = 2, 'the zonal manager sends it back: revision two opens');
select tests.logout();
select tests.ok((select status = 'returned' and return_reason like 'Route Rider%' from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date = current_date and revision = 1)
            and (select status = 'open' from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date = current_date and revision = 2)
            and (select count(*) = 4 from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id where s.id = (select id from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date = current_date and revision = 2)
                   and l.employee_id in (tests.id('r1'), tests.id('r2'), tests.id('cc'), tests.id('r3'))), 'the old revision is kept; the new one starts from the same lines');
select tests.ok((select p ->> 'state' is null or p ->> 'source' <> 'morning' from (select private.route_presence(tests.id('r1'), current_date) p) q), 'while it is open the plan no longer stands on it');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g ->> 'status' = 'open' and (g -> 'can' ->> 'fill')::boolean and g -> 'returned' ->> 'reason' like 'Route Rider%' and (g ->> 'revision')::int = 2
                   from public.wf_morning_get(tests.id('hub_a1')) g), 'the hub manager opens the returned form with the reason');
select tests.ok((select (m ->> 'waiting')::boolean and (m ->> 'returned')::boolean from public.route_plan_morning(tests.id('hub_a1')) m), 'the plan page says the morning input is back with the hub');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.route_plan_decide(%L, true)$$, tests.id('plan')), 'no approval without a submitted morning input', '22023');
select tests.login(tests.id('hub_mgr'));
select tests.ok((s ->> 'revision')::int = 2, 'resubmitted as revision two') from public.wf_morning_submit(tests.id('hub_a1'), null, jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('r1'), 'state', 'present'), jsonb_build_object('employee_id', tests.id('cc'), 'state', 'present'),
  jsonb_build_object('employee_id', tests.id('r3'), 'state', 'present'))) s;
select tests.ok((m ->> 'plan_stale')::boolean and (m -> 'morning' ->> 'revision')::int = 2, 'the plan made on the old input is marked') from public.route_plan_morning(tests.id('hub_a1')) m;

-- ---------------------------------------------------------------- approval = publication
select tests.login(tests.id('zonal_a'));
select public.route_plan_decide(tests.id('plan'), true);
select tests.logout();
select tests.ok((select published_version = 1 and morning_revision = 2 and status = 'approved' from public.route_day_plans where id = tests.id('plan'))
            and (select count(*) = 1 and bool_and(morning_revision = 2) and bool_and(superseded_at is null) from public.route_plan_versions where plan_id = tests.id('plan'))
            and (select count(*) = 2 from public.route_plan_recipients where plan_id = tests.id('plan') and role <> 'manager' and status = 'active')
            and (select count(*) >= 1 from public.route_plan_recipients where plan_id = tests.id('plan') and role = 'manager'), 'approved: version one, its morning revision, the riders and the manager are recipients');
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('rider_login') and kind = 'route_plan')
            and (select count(*) = 1 from public.notifications where profile_id = tests.id('hub_mgr') and kind = 'route_plan'), 'and the messages are queued in the same step');
select tests.ok((select count(*) = 1 from public.route_plan_events where plan_id = tests.id('plan') and kind = 'published' and version_no = 1), 'the log has it');
select tests.login(tests.id('rider_login'));
select tests.ok((select (m ->> 'parcels')::int = 40 and (m ->> 'version')::int = 1 and m ->> 'hub' = 'Hub A1' from public.route_plan_mine() m), 'the rider sees the route: no accept, no read');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (p -> 'version' ->> 'no')::int = 1 and jsonb_array_length(p -> 'lines') = 2 and not (p ->> 'reopened')::boolean from public.route_plan_published(tests.id('hub_a1')) p), 'the hub manager sees the published plan');
select tests.throws(format($$select public.route_plan_resend(%L)$$, tests.id('plan')), 'the hub manager cannot send it again', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok(public.route_plan_resend(tests.id('plan')) >= 2, 'the zonal manager sends the same version again');
select tests.logout();
select tests.ok((select count(*) = 1 from public.route_plan_versions where plan_id = tests.id('plan')) and (select sent_count = 2 from public.route_plan_recipients where plan_id = tests.id('plan') and employee_id = tests.id('r1'))
            and (select count(*) = 2 from public.notifications where profile_id = tests.id('rider_login') and kind = 'route_plan'), 'a resend adds no version, only a second delivery');

-- ---------------------------------------------------------------- a rider changes: new version, the old assignment is cancelled
select tests.login(tests.id('zonal_a'));
select public.wf_morning_return(tests.id('hub_a1'), null, 'Route Rider has gone home');
select tests.login(tests.id('hub_mgr'));
select public.wf_morning_submit(tests.id('hub_a1'), null, jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('r1'), 'state', 'absent'), jsonb_build_object('employee_id', tests.id('cc'), 'state', 'present'),
  jsonb_build_object('employee_id', tests.id('r3'), 'state', 'present')));
select tests.login(tests.id('zonal_a'));
select public.route_plan_reopen(tests.id('plan'), 'rider changed');
select tests.login(tests.id('rider_login'));
select tests.ok((select (m ->> 'parcels')::int = 40 and (m ->> 'version')::int = 1 from public.route_plan_mine() m), 'while the plan is reopened the version in force still shows');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (p ->> 'reopened')::boolean from public.route_plan_published(tests.id('hub_a1')) p), 'the published view says it is being changed');
select tests.ok((m ->> 'published_stale')::boolean, 'and that the morning input changed after it was published') from public.route_plan_morning(tests.id('hub_a1')) m;
select public.route_plan_save(tests.id('hub_a1'), current_date, jsonb_build_object('people', jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('r3'), 'parcels', 40), jsonb_build_object('employee_id', tests.id('cc'), 'parcels', 50))), true);
select tests.login(tests.id('zonal_a'));
select public.route_plan_decide(tests.id('plan'), true);
select tests.logout();
select tests.ok((select published_version = 2 and morning_revision = 3 from public.route_day_plans where id = tests.id('plan'))
            and (select count(*) = 2 and count(*) filter (where superseded_at is null) = 1 from public.route_plan_versions where plan_id = tests.id('plan'))
            and (select status = 'cancelled' and cancelled_in_version = 2 from public.route_plan_recipients where plan_id = tests.id('plan') and employee_id = tests.id('r1') and version_id = (select id from public.route_plan_versions where plan_id = tests.id('plan') and version_no = 1))
            and (select count(*) = 1 from public.route_plan_events where plan_id = tests.id('plan') and kind = 'cancelled' and note = 'Route Rider'), 'version two: the old rider''s assignment is cancelled and logged');
select tests.login(tests.id('rider_login'));
select tests.ok((select (m ->> 'parcels')::int = 0 and jsonb_array_length(m -> 'cancelled') = 1 from public.route_plan_mine() m), 'the old rider sees the assignment cancelled');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select p -> 'version' ->> 'no' = '2' and jsonb_array_length(p -> 'cancelled') = 1 and jsonb_array_length(p -> 'lines') = 2 from public.route_plan_published(tests.id('hub_a1')) p), 'the hub manager sees version two and who was taken off');

-- ---------------------------------------------------------------- times and the server job
select tests.logout();
delete from public.wf_att_policy where zone_id = tests.id('zone_a');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.wf_att_policy_save(%L, '{"morning_cutoff":"09:00"}')$$, tests.id('zone_a')), 'the hub manager cannot set the times', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok((select p ->> 'morning_open' = '07:00' and p ->> 'morning_cutoff' = '08:00' and (p ->> 'morning_extra')::int = 15 and not (p ->> 'own')::boolean and (p ->> 'can_edit')::boolean
                   from public.wf_att_policy_get(tests.id('zone_a')) p), 'default times come from the settings');
select tests.throws(format($$select public.wf_att_policy_save(%L, '{"morning_open":"09:00","morning_cutoff":"08:00","morning_extra":0}')$$, tests.id('zone_a')),
  'opening must be earlier than closing', '22023');
select tests.throws(format($$select public.wf_att_policy_save(%L, '{"morning_cutoff":"23:50","morning_extra":30}')$$, tests.id('zone_a')), 'the cut-off and extra minutes must end on the same day', '22023');
select tests.throws(format($$select public.wf_att_policy_save(%L, '{"morning_extra":999}')$$, tests.id('zone_a')), 'extra minutes are at most 360', '22023');
select tests.throws(format($$select public.wf_att_policy_save(%L, '{"speed":1}')$$, tests.id('zone_a')), 'an unknown time setting is refused', '22023');
select tests.ok((select p ->> 'morning_cutoff' = '00:00' and (p ->> 'morning_extra')::int = 0 and (p ->> 'own')::boolean
                   from public.wf_att_policy_save(tests.id('zone_a'), '{"morning_cutoff":"00:00","morning_extra":0}') p), 'the zone''s times are saved');
select tests.ok((select (public.wf_att_policy_get(tests.id('zone_a')) ->> 'morning_cutoff') = '00:00'), 'and read back');
select tests.logout();
-- The window is inclusive at opening, exclusive at closing, and uses the Dhaka date.
select tests.ok(not private.wf_morning_window_open(tests.id('zone_b'), date '2026-11-26', timestamptz '2026-11-26 06:59:59+06')
            and private.wf_morning_window_open(tests.id('zone_b'), date '2026-11-26', timestamptz '2026-11-26 07:00+06')
            and private.wf_morning_window_open(tests.id('zone_b'), date '2026-11-26', timestamptz '2026-11-26 08:14:59+06')
            and not private.wf_morning_window_open(tests.id('zone_b'), date '2026-11-26', timestamptz '2026-11-26 08:15+06')
            and private.wf_morning_window_open(tests.id('zone_b'), date '2026-11-27', timestamptz '2026-11-27 07:00+06'),
  'the Dhaka window opens and closes at the exact boundary each day');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.wf_morning_return(%L, null, 'Check again')$$, tests.id('hub_a1')), 'a zonal manager cannot return a form once the window closes', '22023');
select tests.logout();
-- the cut-off (00:00 + 0) has passed. Hub A2 typed nothing: the job does NOT submit an empty morning input, it holds it and tells the managers once
select tests.ok(private.wf_morning_autosubmit() = 0, 'the job does not submit an empty morning input');
select tests.ok(not exists (select 1 from public.wf_morning_subs where hub_id = tests.id('hub_a2') and work_date = current_date and status = 'submitted')
            and (select reason = 'empty' and resolved_at is null and gap_count = 1 from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a2') and work_date = current_date),
  'it is held: the reason is "empty" and one person is unmarked');
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('zonal_a') and title = 'সকালের জনবল জমা আটকে আছে' and body like '%Hub A2 · ' || to_char((now() at time zone 'Asia/Dhaka')::date, 'DD-MM-YYYY') || '%'), 'the zonal manager is told');
select tests.ok(private.wf_morning_autosubmit() = 0 and (select count(*) = 1 from public.notifications where profile_id = tests.id('zonal_a') and title = 'সকালের জনবল জমা আটকে আছে' and body like '%Hub A2 · ' || to_char((now() at time zone 'Asia/Dhaka')::date, 'DD-MM-YYYY') || '%'),
  'and only once, however often the job runs');
-- A complete draft is saved during the window, then the cutoff is advanced.
update public.wf_att_policy set morning_open = '00:00', morning_cutoff = '23:59:59' where zone_id = tests.id('zone_a');
select tests.login(tests.id('super'));
select public.wf_morning_save(tests.id('hub_a2'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('other'), 'state', 'present')));
select tests.logout();
update public.wf_att_policy set morning_open = null, morning_cutoff = '00:00' where zone_id = tests.id('zone_a');
select tests.ok(private.wf_morning_autosubmit() >= 1, 'a complete morning input is submitted by the server at the cut-off');
select tests.ok((select s.submit_mode = 'auto' and s.submitted_by is null and s.revision = 1 from public.wf_morning_subs s where s.hub_id = tests.id('hub_a2') and s.work_date = current_date)
            and (select l.state = 'present' from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id where s.hub_id = tests.id('hub_a2') and s.work_date = current_date and l.employee_id = tests.id('other'))
            and (select resolved_at is not null from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a2') and work_date = current_date), 'submitted by the server, and the hold is over');
select tests.ok(private.wf_morning_autosubmit() = 0, 'running the job again changes nothing');
select tests.ok((select count(*) = 3 from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date = current_date), 'a morning that was sent back (and submitted by hand) is not touched by the job');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g ->> 'status' = 'submitted' from public.wf_morning_get(tests.id('hub_a1')) g), 'hub A1 is still submitted');
select tests.logout();
-- a manual submit that arrives after the job is the same submission
select tests.ok(private.wf_morning_close(tests.id('hub_a2'), current_date, null, 'manager', null) is null, 'a manual close after the job is a no-op (one final submission)');
select tests.ok((select count(*) = 1 from public.wf_morning_subs where hub_id = tests.id('hub_a2') and work_date = current_date), 'one submission for the hub and day');
-- ---------------------------------------------------------------- plans approved before this migration keep showing to their riders
select tests.logout();
insert into public.route_day_plans (hub_id, zone_id, plan_date, arrived, status, decided_at, decided_by_name)
  values (tests.id('hub_a2'), tests.id('zone_a'), current_date + 1, 10, 'approved', now(), 'Old Approver') returning id \gset old_
insert into tests.ids values ('oldplan', :'old_id');
insert into public.route_day_riders (plan_id, hub_id, zone_id, plan_date, employee_id, parcels) values (tests.id('oldplan'), tests.id('hub_a2'), tests.id('zone_a'), current_date + 1, tests.id('other'), 10);
select tests.ok(private.route_plan_backfill() >= 1, 'an old approved plan is given a silent version one');
select tests.ok((select published_version = 1 from public.route_day_plans where id = tests.id('oldplan')) and (select count(*) = 1 from public.route_plan_versions where plan_id = tests.id('oldplan'))
            and (select count(*) = 1 and bool_and(parcels = 10) from public.route_plan_recipients where plan_id = tests.id('oldplan')), 'with its rider as recipient');
select tests.ok(private.route_plan_backfill() = 0, 'running it again does nothing');
rollback;
