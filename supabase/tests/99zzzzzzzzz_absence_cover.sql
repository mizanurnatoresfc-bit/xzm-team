-- Absent list by 11 am, corrections, route cover with reminders, staff notes, the zonal day report.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('staff2_login', tests.make_user('s2@test.local', 'Staff Two'));
insert into tests.ids values
  ('r1', tests.active_employee('Rider One', '971', tests.id('hub_a1'), '01711000971', '9710101010', 15000, tests.id('rider_login'))),
  ('r2', tests.active_employee('Rider Two', '972', tests.id('hub_a1'), '01711000972', '9720101010', 15000, tests.id('staff2_login'))),
  ('r3', tests.active_employee('Rider Three', '973', tests.id('hub_a1'), '01711000973', '9730101010')),
  ('b1', tests.active_employee('B Rider', '974', tests.id('hub_b1'), '01711000974', '9740101010'));
-- Rider One holds route R1.
with r as (insert into public.hub_routes (hub_id, zone_id, code, name, areas) values (tests.id('hub_a1'), tests.id('zone_a'), 'R1', 'Station Road', array['Station', 'Bazar']) returning id)
insert into tests.ids select 'route1', id from r;
insert into public.rider_routes (route_id, employee_id, hub_id, zone_id, effective_from) values (tests.id('route1'), tests.id('r1'), tests.id('hub_a1'), tests.id('zone_a'), current_date - 30);

-- ---------- absent list ----------
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.hub_absence_submit(%L, '[]'::jsonb)$$, tests.id('hub_a1')), 'staff cannot send the absent list', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.hub_absence_sheet(tests.id('hub_a1'))->'staff') = 3, 'the sheet lists the hub''s three staff');
select tests.throws(format($$select public.hub_absence_submit(%L, '[{"employee_id":"%s"}]'::jsonb)$$, tests.id('hub_a1'), tests.id('b1')), 'someone from another hub is refused', '22023');
select tests.ok((public.hub_absence_submit(tests.id('hub_a1'), format('[{"employee_id":"%s","status":"absent","note":"জ্বর"}]', tests.id('r1'))::jsonb)->>'present')::int = 2,
  'one absent, the other two present');
select tests.logout();
select tests.ok((select status = 'absent' and source = 'absence_list' from public.attendance_records where employee_id = tests.id('r1') and work_date = (now() at time zone 'Asia/Dhaka')::date), 'absent is on the register');
select tests.ok((select status = 'present' from public.attendance_records where employee_id = tests.id('r3') and work_date = (now() at time zone 'Asia/Dhaka')::date), 'the rest are present');
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('rider_login') and title like '%অনুপস্থিত%'), 'the absent rider is told');
select tests.ok((select count(*) = 1 from public.hub_absence_submissions where hub_id = tests.id('hub_a1')), 'the submission is kept');

-- ---------- correction with a note ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.att_correct(%L, (now() at time zone 'Asia/Dhaka')::date, 'present', '')$$, tests.id('r3')), 'a correction needs a note', '22023');
select public.att_correct(tests.id('r3'), (now() at time zone 'Asia/Dhaka')::date, 'late', 'আসলে ১০টায় এসেছেন');
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.att_correct(%L, (now() at time zone 'Asia/Dhaka')::date, 'present', 'আমি এসেছিলাম')$$, tests.id('r3')), 'staff cannot correct attendance', '42501');
select tests.logout();
select tests.ok((select status = 'late' from public.attendance_records where employee_id = tests.id('r3') and work_date = (now() at time zone 'Asia/Dhaka')::date), 'corrected to late');
select tests.ok((select count(*) = 1 from public.attendance_corrections where employee_id = tests.id('r3')), 'the correction is logged');

-- ---------- route cover ----------
select tests.ok(private.job_route_reminders() >= 0, 'the reminder job runs');
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.route_cover_list(tests.id('hub_a1'))) = 1 and public.route_cover_list(tests.id('hub_a1'))->0->'cover' = 'null'::jsonb, 'the absent rider''s route waits for a cover');
select tests.throws(format($$select public.route_cover_assign(%L, %L, '971')$$, tests.id('route1'), tests.id('r1')), 'the absent rider cannot cover himself', '22023');
select public.route_cover_assign(tests.id('route1'), tests.id('r1'), '972', 'আজ দুই রুট');
select tests.ok(public.route_cover_list(tests.id('hub_a1'))->0->'cover'->>'name' = 'Rider Two', 'Rider Two covers the route');
select tests.logout();
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('staff2_login') and title like '%রুট%'), 'the cover is told');
-- the cover sees it and writes the delivery
select tests.login(tests.id('staff2_login'));
select tests.ok(jsonb_array_length(public.my_day_note()->'covers') = 1, 'the cover sees today''s extra route');
select public.my_day_note_save('দুই রুটে ডেলিভারি', 'বাজারে আরেকজন লাগবে');
select public.route_cover_update((public.my_day_note()->'covers'->0->>'id')::uuid, 40, 3, 'সব শেষ');
select tests.throws($$select * from public.staff_day_notes$$, 'notes are not read directly', '42501');
select tests.logout();
select tests.ok((select delivered = 40 from public.route_covers where route_id = tests.id('route1')), 'the delivery update is kept');

-- ---------- the zonal manager's report ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.zone_daily_report(%L, (now() at time zone 'Asia/Dhaka')::date)$$, tests.id('zone_a')), 'a hub manager does not get the zone report', '42501');
select tests.login(tests.id('zonal_a'));

select tests.ok((select (x->>'absent')::int = 1 and (x->>'late')::int = 1 from jsonb_array_elements(public.zone_daily_report(tests.id('zone_a'), (now() at time zone 'Asia/Dhaka')::date)->'hubs') x
  where x->>'hub_id' = tests.id('hub_a1')::text), 'the report counts the hub''s day');
select tests.ok((select r->>'cover' = 'Rider Two' and r->>'problem' is null from jsonb_array_elements(public.zone_daily_report(tests.id('zone_a'), (now() at time zone 'Asia/Dhaka')::date)->'routes') r),
  'the covered route has no problem');
select tests.ok((select s->>'suggestion' = 'বাজারে আরেকজন লাগবে' from jsonb_array_elements(public.zone_daily_report(tests.id('zone_a'), (now() at time zone 'Asia/Dhaka')::date)->'staff') s
  where s->>'employee_id' = tests.id('r2')::text), 'the suggestion reaches the zonal manager');
select tests.throws(format($$select public.zone_daily_report(%L, (now() at time zone 'Asia/Dhaka')::date)$$, tests.id('zone_b')), 'not another zone', '42501');
select tests.logout();
select tests.ok(private.job_absence_deadline() >= 1, 'hub B1 without a list is chased');
select tests.ok(private.job_midnight_report() >= 0, 'the midnight job runs');
rollback;
