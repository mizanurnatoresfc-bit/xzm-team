-- হাজিরার নিয়ম, টেস্ট অ্যাকাউন্টে: হাব ম্যানেজার, জোনাল ম্যানেজার, স্টাফ, অন্য হাবের ম্যানেজার।
-- An empty or unfinished attendance is never submitted — by the manager or by the server — and the hub's and the zone's managers are told.
-- The server jobs count the day in Asia/Dhaka.
begin;
select tests.fixture();
select tests.hr_fixture();
select (now() at time zone 'Asia/Dhaka')::date as t, (now() at time zone 'Asia/Dhaka')::date - 1 as y, (now() at time zone 'Asia/Dhaka')::date - 2 as y2 \gset
update public.system_settings set value = to_jsonb(((now() at time zone 'Asia/Dhaka')::date - 10)::text) where key = 'workforce.auto_submit_from';
insert into tests.ids values
  ('p1', tests.active_employee('Rider One', '971', tests.id('hub_a1'), '01711000971', '9710000000', 15000, tests.id('rider_login'))),
  ('p2', tests.active_employee('Rider Two', '972', tests.id('hub_a1'), '01711000972', '9720000000')),
  ('q1', tests.active_employee('Other Hub Rider', '973', tests.id('hub_a2'), '01711000973', '9730000000')),
  ('mgr2', tests.make_user('mgr2@test.local', 'Hub A2 Manager'));
select tests.grant_role(tests.id('rider_login'), 'staff', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('mgr2'), 'hub_manager', 'hub', null, tests.id('hub_a2'));
insert into public.wf_att_policy (zone_id, morning_cutoff, morning_extra, day_time, day_extra) values (tests.id('zone_a'), '00:00', 0, '00:00', 0);
create temp table pre as select count(*) n from public.notifications;

-- ---------------------------------------------------------------- by hand: an empty or unfinished register is refused
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.att_sheet_submit(%L, %L, '[]')$$, tests.id('hub_a1'), :'t'::date), 'the hub manager cannot submit an empty register', '22023');
select tests.throws(format($$select public.att_sheet_submit(%L, %L, %L::jsonb)$$, tests.id('hub_a1'), :'t'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p1'), 'final_status', 'present', 'online_reason', 'no phone'))),
  'nor one with a person left out', '22023');
select tests.throws(format($$select public.att_sheet_submit(%L, %L, %L::jsonb)$$, tests.id('hub_a1'), :'t'::date, jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('p1'), 'final_status', 'present', 'online_reason', 'no phone'),
  jsonb_build_object('employee_id', tests.id('p2'), 'final_status', 'late', 'online_reason', 'no phone'))), 'nor one where a late arrival has no time', '22023');
select tests.throws(format($$select public.att_sheet_submit(%L, %L, %L::jsonb)$$, tests.id('hub_a1'), :'t'::date, jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('p1'), 'final_status', 'present', 'online_reason', 'no phone'), jsonb_build_object('employee_id', tests.id('p2'), 'final_status', 'absent'))),
  'nor one where an absence says nothing', '22023');
select tests.logout();
select tests.ok(not exists (select 1 from public.att_day_sheets where hub_id = tests.id('hub_a1') and status = 'submitted') and not exists (select 1 from public.attendance_records where employee_id in (tests.id('p1'), tests.id('p2'))),
  'nothing was submitted and nothing went on the register');

-- who may write it
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.att_sheet_submit(%L, %L, '[]')$$, tests.id('hub_a1'), :'t'::date), 'a staff member cannot submit the register', '42501');
select tests.login(tests.id('mgr2'));
select tests.throws(format($$select public.att_sheet_submit(%L, %L, '[]')$$, tests.id('hub_a1'), :'t'::date), 'nor the manager of another hub', '42501');
select tests.throws(format($$select public.att_sheet_get(%L)$$, tests.id('hub_a1')), 'who cannot even open it', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.att_sheet_save(%L, %L, '[]')$$, tests.id('hub_a1'), :'t'::date), 'the zonal manager does not write the register', '42501');

-- ---------------------------------------------------------------- by the server: held, told once, finished by the manager, submitted
select tests.logout();
select tests.ok(private.att_day_autosubmit() = 0, 'the job does not submit yesterday''s empty registers');
select tests.ok((select reason = 'empty' and gap_count = 2 and total = 2 from public.wf_auto_holds where kind = 'daily' and hub_id = tests.id('hub_a1') and work_date = :'y'::date)
            and (select reason = 'empty' from public.wf_auto_holds where kind = 'daily' and hub_id = tests.id('hub_a2') and work_date = :'y'::date)
            and not exists (select 1 from public.att_day_sheets where status = 'submitted'), 'both hubs'' empty registers are held, none is submitted');
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('hub_mgr') and title = 'দৈনিক হাজিরা খাতা জমা আটকে আছে' and body like '%Hub A1 · ' || to_char(:'y'::date, 'DD-MM-YYYY') || '%')
            and (select count(*) = 1 from public.notifications where profile_id = tests.id('zonal_a') and title = 'দৈনিক হাজিরা খাতা জমা আটকে আছে' and body like '%Hub A1 · ' || to_char(:'y'::date, 'DD-MM-YYYY') || '%')
            and (select count(*) = 1 from public.notifications where profile_id = tests.id('mgr2') and title = 'দৈনিক হাজিরা খাতা জমা আটকে আছে' and body like '%Hub A2 · ' || to_char(:'y'::date, 'DD-MM-YYYY') || '%')
            and not exists (select 1 from public.notifications where profile_id = tests.id('mgr2') and body like '%Hub A1%'), 'the hub''s manager and the zonal manager are told; the other hub''s manager hears only about his own hub');
select private.att_day_autosubmit();
select tests.ok((select count(*) from public.notifications where title = 'দৈনিক হাজিরা খাতা জমা আটকে আছে' and body like '%' || to_char(:'y'::date, 'DD-MM-YYYY') || '%') = 4, 'running the job again tells nobody again (hub A1: manager + zone; hub A2: manager + zone)');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g -> 'hold' ->> 'reason' = 'empty' and (g -> 'hold' ->> 'gap_count')::int = 2 and (g -> 'can' ->> 'edit')::boolean from public.att_sheet_get(tests.id('hub_a1'), :'y'::date) g),
  'the hub manager sees the hold on the page, and a day the server refused stays open for him');
select public.att_sheet_save(tests.id('hub_a1'), :'y'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p1'), 'final_status', 'present', 'online_reason', 'no phone')));
select tests.logout();
select private.att_day_autosubmit();          -- (a statement of its own: what the job wrote is not visible to a query that runs it)
select tests.ok((select reason = 'incomplete' and gap_count = 1 from public.wf_auto_holds where kind = 'daily' and hub_id = tests.id('hub_a1') and work_date = :'y'::date)
            and (select count(*) = 1 from public.notifications where profile_id = tests.id('zonal_a') and title = 'দৈনিক হাজিরা খাতা জমা আটকে আছে' and body like '%Hub A1 · ' || to_char(:'y'::date, 'DD-MM-YYYY') || '%'),
  'half finished: still not submitted, now "incomplete" with one person to go, and no second message');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_save(tests.id('hub_a1'), :'y'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p2'), 'final_status', 'absent', 'unauthorized', true)));
select tests.logout();
select tests.ok(private.att_day_autosubmit() = 1, 'finished: the next run submits it');
select tests.ok((select status = 'submitted' and submit_mode = 'auto' and version = 1 from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'y'::date)
            and (select status = 'present' from public.attendance_records where employee_id = tests.id('p1') and work_date = :'y'::date)
            and (select status = 'absent' from public.attendance_records where employee_id = tests.id('p2') and work_date = :'y'::date)
            and (select resolved_at is not null from public.wf_auto_holds where kind = 'daily' and hub_id = tests.id('hub_a1') and work_date = :'y'::date), 'by the server, with the managers'' own answers, and the hold is over');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.att_sheet_save(%L, %L, '[]')$$, tests.id('hub_a1'), :'y'::date), 'a submitted day is locked again', 'P0001');
-- a manager can still submit by hand the same day he is allowed to: today
select tests.ok((select (r ->> 'version')::int = 1 from public.att_sheet_submit(tests.id('hub_a1'), :'t'::date, jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('p1'), 'final_status', 'present', 'online_reason', 'no phone'), jsonb_build_object('employee_id', tests.id('p2'), 'final_status', 'present', 'online_reason', 'no phone'))) r), 'a complete register is submitted by hand');
select tests.logout();

-- ---------------------------------------------------------------- the morning input: an empty or unfinished one is not submitted by the server either
select tests.ok(private.wf_morning_autosubmit() = 0, 'the morning job does not submit empty morning inputs');
select tests.ok((select count(*) = 4 from public.wf_auto_holds where kind = 'morning' and reason = 'empty' and work_date in (:'t'::date, :'y'::date)), 'both hubs, today and yesterday: held');
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('hub_mgr') and title = 'সকালের জনবল জমা আটকে আছে' and body like '%Hub A1 · ' || to_char(:'t'::date, 'DD-MM-YYYY') || '%')
            and (select count(*) = 1 from public.notifications where profile_id = tests.id('zonal_a') and title = 'সকালের জনবল জমা আটকে আছে' and body like '%Hub A1 · ' || to_char(:'t'::date, 'DD-MM-YYYY') || '%'), 'the hub manager and the zonal manager are told, once');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g -> 'hold' ->> 'reason' = 'empty' and g ->> 'status' = 'open' and not (g -> 'can' ->> 'fill')::boolean from public.wf_morning_get(tests.id('hub_a1')) g), 'the form shows the hold and is locked after cutoff');
select tests.throws(format($$select public.wf_morning_save(%L, null, '[]')$$, tests.id('hub_a1')), 'a manager cannot save after cutoff', '22023');
select tests.logout();
update public.wf_att_policy set morning_open = '00:00', morning_cutoff = '23:59:59' where zone_id = tests.id('zone_a');
select tests.login(tests.id('hub_mgr'));
select public.wf_morning_save(tests.id('hub_a1'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p1'), 'state', 'present')));
select tests.login(tests.id('zonal_a'));
select tests.ok((select (h ->> 'held')::boolean and h -> 'hold' ->> 'reason' = 'empty' from public.wf_morning_zone(tests.id('zone_a')) z, jsonb_array_elements(z -> 'hubs') h where h ->> 'id' = tests.id('hub_a1')::text), 'the zonal manager sees which hub is held');
select tests.logout();
update public.wf_att_policy set morning_open = null, morning_cutoff = '00:00' where zone_id = tests.id('zone_a');
select private.wf_morning_autosubmit();
select tests.ok((select reason = 'incomplete' and gap_count = 1 from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a1') and work_date = :'t'::date),
  'one person marked, one not: still not submitted — "incomplete"');
update public.wf_att_policy set morning_open = '00:00', morning_cutoff = '23:59:59' where zone_id = tests.id('zone_a');
select tests.login(tests.id('hub_mgr'));
select public.wf_morning_save(tests.id('hub_a1'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('p2'), 'state', 'absent')));
select tests.logout();
update public.wf_att_policy set morning_open = null, morning_cutoff = '00:00' where zone_id = tests.id('zone_a');
select tests.ok(private.wf_morning_autosubmit() = 1, 'everybody marked: the server submits it');
select tests.ok((select submit_mode = 'auto' from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date = :'t'::date and status = 'submitted')
            and (select resolved_at is not null from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a1') and work_date = :'t'::date), 'submitted by the server, the hold is over');
-- A missed previous day remains held.
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.wf_morning_submit(%L, %L, '[]')$$, tests.id('hub_a1'), :'y'::date), 'a manager cannot submit a past morning', '22023');
select tests.logout();
select tests.ok((select resolved_at is null from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a1') and work_date = :'y'::date), 'the hold is still visible for the missed day');

-- ---------------------------------------------------------------- the day is the Asia/Dhaka day, whatever the database clock says
-- the older function of the same family (whoever may mark a hub's attendance) is not ours and is still as it was
select tests.ok((select prosrc like '%hr.attendance.create%' and prosrc like '%scope_type = ''zone''%' from pg_proc where proname = 'wf_hub_managers' and pronamespace = 'private'::regnamespace), 'private.wf_hub_managers (the reminders'' list of who may mark attendance) is untouched');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname in ('public', 'private') and p.prosrc ilike '%current_date%'
                               and p.proname ~ '^(wf_morning|wf_hold|wf_auto|wf_att_policy|wf_role_hub_managers|wf_role_zone_managers|att_sheet_prepare|att_sheet_close|att_day_|att_edit|att_month|att_reopen|route_plan_(morning|published|mine|decide|resend|backfill|notify)|staff_profile|swe_|staff_work)'),
  'none of the new functions asks the database for "today": they all use the Dhaka day');
set local timezone to 'Etc/GMT+12';      -- twelve hours behind UTC: a date behind Dhaka's for most of the day
select private.wf_morning_autosubmit();
select tests.ok((select count(*) >= 1 from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a2') and work_date = :'t'::date), 'with the database clock far behind, the job still reaches Dhaka''s today');
set local timezone to 'Pacific/Kiritimati';
select private.wf_morning_autosubmit();
select tests.ok(not exists (select 1 from public.wf_auto_holds where work_date > :'t'::date) and not exists (select 1 from public.wf_morning_subs where work_date > :'t'::date), 'and with the clock far ahead it never reaches tomorrow');
reset timezone;
rollback;
