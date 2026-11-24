-- নিয়ম ৩: সকালের ফর্ম বা দৈনিক খাতা খালি বা অসম্পূর্ণ থাকলে সার্ভার জমা করে না — খোলা রাখে, হাব ও জোনাল ম্যানেজারকে একবার জানায়।
-- Rule 3: an empty or unfinished morning form or daily register is NOT submitted by the server. It stays open (the hub manager can still write it), the hub's managers and the zone's
-- managers are told once, and the job looks again every minute. When everybody has an answer (approved leave counts) the server submits it.
begin;
select tests.fixture();
select tests.hr_fixture();
select (now() at time zone 'Asia/Dhaka')::date as t, (now() at time zone 'Asia/Dhaka')::date - 1 as y, (now() at time zone 'Asia/Dhaka')::date - 2 as y2,
       to_char((now() at time zone 'Asia/Dhaka')::date, 'DD-MM-YYYY') as ts, to_char((now() at time zone 'Asia/Dhaka')::date - 1, 'DD-MM-YYYY') as ys \gset
insert into tests.ids values
  ('a', tests.active_employee('Rider One', '991', tests.id('hub_a1'), '01711000991', '9910000000')),
  ('b', tests.active_employee('Rider Two', '992', tests.id('hub_a1'), '01711000992', '9920000000')),
  ('c', tests.active_employee('Rider On Leave', '993', tests.id('hub_a1'), '01711000993', '9930000000')),
  ('d', tests.active_employee('Only Rider On Leave', '994', tests.id('hub_a2'), '01711000994', '9940000000'));
-- c (hub A1) and d (hub A2) have approved leave yesterday and today
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, status)
  select e, lt.id, :'y'::date, :'t'::date, 'family', 'approved' from (values (tests.id('c')), (tests.id('d'))) x(e), (select id from public.leave_types where code = 'casual') lt;
-- the times have passed for every day (00:00 + 0); the jobs start yesterday
insert into public.wf_att_policy (zone_id, morning_cutoff, morning_extra, day_time, day_extra) values (tests.id('zone_a'), '00:00', 0, '00:00', 0);
update public.system_settings set value = to_jsonb(:'y'::text) where key = 'workforce.auto_submit_from';

create function pg_temp.notes(p_user text, p_title text, p_body text) returns bigint language sql as $$
  select count(*) from public.notifications where profile_id = tests.id(p_user) and title like p_title and body like p_body $$;

-- ================================================================ the morning form
-- hub A1: nobody typed anything. hub A2: its only person is on approved leave, so every person has an answer.
select tests.ok(private.wf_morning_autosubmit() = 2, 'the job submits only what is complete: hub A2''s forms of yesterday and today (leave is an answer)');
select tests.ok((select count(*) = 2 and bool_and(submit_mode = 'auto' and submitted_by is null) from public.wf_morning_subs where hub_id = tests.id('hub_a2') and status = 'submitted'), 'hub A2''s forms are submitted by the server');
select tests.ok(not exists (select 1 from public.wf_morning_subs where hub_id = tests.id('hub_a1')), 'hub A1''s empty forms are not touched: no form row, no line, nothing submitted');
select tests.ok((select count(*) = 2 and bool_and(gap_count = 2 and resolved_at is null) from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a1'))
            and not exists (select 1 from public.wf_auto_holds where hub_id = tests.id('hub_a2')), 'hub A1 yesterday and today are held (two people without an answer; the one on leave is not counted); hub A2 is not held');
select tests.ok(pg_temp.notes('hub_mgr', 'সকালের জনবল জমা আটকে%', '%' || :'ts' || '%') = 1 and pg_temp.notes('hub_mgr', 'সকালের জনবল জমা আটকে%', '%' || :'ys' || '%') = 1,
  'the hub manager is told, once for each day');
select tests.ok(pg_temp.notes('zonal_a', 'সকালের জনবল জমা আটকে%', '%' || :'ts' || '%') = 1 and pg_temp.notes('zonal_a', 'সকালের জনবল জমা আটকে%', '%' || :'ys' || '%') = 1
            and (select link from public.notifications where profile_id = tests.id('zonal_a') and title like 'সকালের জনবল জমা আটকে%' limit 1) like '/app/attendance?view=hub&tab=morning&hub=%', 'and so is the zonal manager, with a link to the form');
select tests.ok(pg_temp.notes('hub_b_mgr', '%জমা আটকে আছে%', '%') = 0 and pg_temp.notes('rider_login', '%জমা আটকে আছে%', '%') = 0, 'nobody of another hub or zone is told');
select tests.ok(private.wf_morning_autosubmit() = 0 and pg_temp.notes('hub_mgr', 'সকালের জনবল জমা আটকে%', '%') = 2 and pg_temp.notes('zonal_a', 'সকালের জনবল জমা আটকে%', '%') = 2,
  'the next minute changes nothing and tells nobody twice');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select g ->> 'status' = 'open' and (g -> 'can' ->> 'fill')::boolean from public.wf_morning_get(tests.id('hub_a1')) g), 'the form is still open for the hub manager after the cut-off');
-- part of it typed: still unfinished
select public.wf_morning_save(tests.id('hub_a1'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('a'), 'state', 'present')));
select tests.logout();
select tests.ok(private.wf_morning_autosubmit() = 0 and not exists (select 1 from public.wf_morning_subs where hub_id = tests.id('hub_a1') and status = 'submitted'), 'a form with one person still unchecked is not submitted by the server');
select tests.ok((select gap_count = 1 from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a1') and work_date = :'t'::date)
            and pg_temp.notes('hub_mgr', 'সকালের জনবল জমা আটকে%', '%' || :'ts' || '%') = 1, 'the list now says one person is missing; nobody is told again');
select tests.ok((select l.state = 'present' from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date and l.employee_id = tests.id('a'))
            and (select count(*) = 1 from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date),
  'what the hub manager typed is kept, and the server added no "unchecked" line');
-- the manager may still submit late, by hand, and may leave people unchecked: that is her / his own submit, and it releases yesterday's hold
select tests.login(tests.id('hub_mgr'));
select tests.ok((s ->> 'mode' = 'manager') and not (s ->> 'already')::boolean, 'the hub manager submits yesterday by hand after the cut-off') from public.wf_morning_submit(tests.id('hub_a1'), :'y'::date, '[]') s;
select tests.logout();
select tests.ok((select resolved_at is not null from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a1') and work_date = :'y'::date)
            and (select count(*) = 2 from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id where s.hub_id = tests.id('hub_a1') and s.work_date = :'y'::date and l.state = 'unknown'), 'that releases the hold; the people left blank are unchecked, as the manager sent it');
select tests.ok(private.wf_morning_autosubmit() = 0, 'the job does not touch a form that has been submitted');
-- now everybody has an answer: the server submits it
select tests.login(tests.id('hub_mgr'));
select public.wf_morning_save(tests.id('hub_a1'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('b'), 'state', 'absent')));
select tests.logout();
select tests.ok(private.wf_morning_autosubmit() = 1, 'when the last person has an answer the next run submits the form');
select tests.ok((select s.submit_mode = 'auto' and s.status = 'submitted' from public.wf_morning_subs s where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date)
            and (select string_agg(e.employee_code || ':' || l.state, ',' order by e.employee_code) = '991:present,992:absent,993:leave' from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id
                  join public.employees e on e.id = l.employee_id where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date)
            and (select resolved_at is not null from public.wf_auto_holds where kind = 'morning' and hub_id = tests.id('hub_a1') and work_date = :'t'::date),
  'submitted by the server with exactly what was typed (and the leave), and the hold is released');
select tests.ok(not exists (select 1 from public.wf_morning_lines where state = 'unknown' and sub_id in (select id from public.wf_morning_subs where submit_mode = 'auto')), 'no form the server submitted has an unchecked person');

-- ================================================================ the daily register of yesterday
-- hub A1: no register at all. hub A2: its only person is on approved leave.
select tests.ok(private.att_day_autosubmit() = 1, 'the daily job submits only hub A2''s register (everybody has an answer: leave)');
select tests.ok((select status = 'submitted' and submit_mode = 'auto' and version = 1 from public.att_day_sheets where hub_id = tests.id('hub_a2') and work_date = :'y'::date), 'it is submitted by the server');
select tests.ok(not exists (select 1 from public.att_day_sheets where hub_id = tests.id('hub_a1') and status = 'submitted') and not exists (select 1 from public.attendance_records where employee_id in (tests.id('a'), tests.id('b')) and work_date = :'y'::date),
  'hub A1''s register that nobody wrote is not submitted (it stays a draft), and nothing goes on anybody''s attendance');
select tests.ok((select gap_count = 2 and resolved_at is null from public.wf_auto_holds where kind = 'daily' and hub_id = tests.id('hub_a1') and work_date = :'y'::date), 'it is held: two people without an answer');
select tests.ok(pg_temp.notes('hub_mgr', 'দৈনিক হাজিরা খাতা জমা আটকে%', '%' || :'ys' || '%') = 1 and pg_temp.notes('zonal_a', 'দৈনিক হাজিরা খাতা জমা আটকে%', '%' || :'ys' || '%') = 1
            and (select link from public.notifications where profile_id = tests.id('zonal_a') and title like 'দৈনিক হাজিরা খাতা জমা আটকে%') like '/app/attendance?view=hub&tab=final&hub=%', 'the hub manager and the zonal manager are told, once');
select tests.ok(private.att_day_autosubmit() = 0 and pg_temp.notes('hub_mgr', 'দৈনিক হাজিরা খাতা জমা আটকে%', '%') = 1 and pg_temp.notes('zonal_a', 'দৈনিক হাজিরা খাতা জমা আটকে%', '%') = 1, 'the next minute changes nothing and tells nobody twice');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (g -> 'can' ->> 'edit')::boolean from public.att_sheet_get(tests.id('hub_a1'), :'y'::date) g), 'the held day is still open for the hub manager, although its time is past');
select tests.ok((select not (g -> 'can' ->> 'edit')::boolean from public.att_sheet_get(tests.id('hub_a1'), :'y2'::date) g), 'while a day nobody held (before the start date) stays closed, as ever');
select tests.throws(format($$select public.att_sheet_save(%L, %L, '[]')$$, tests.id('hub_a1'), :'y2'::date), 'and cannot be written', 'P0001');
-- part of it written: still unfinished
select public.att_sheet_save(tests.id('hub_a1'), :'y'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('a'), 'final_status', 'absent', 'unauthorized', true)));
select tests.logout();
select tests.ok(private.att_day_autosubmit() = 0 and (select status = 'draft' from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'y'::date), 'a register with one person still without an answer is not submitted by the server');
select tests.ok((select gap_count = 1 and resolved_at is null from public.wf_auto_holds where kind = 'daily' and hub_id = tests.id('hub_a1') and work_date = :'y'::date)
            and pg_temp.notes('hub_mgr', 'দৈনিক হাজিরা খাতা জমা আটকে%', '%') = 1, 'the list says one person is missing; nobody is told again');
select tests.ok(not exists (select 1 from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id where s.hub_id = tests.id('hub_a1') and l.final_status = 'unchecked'), 'the server wrote no "unchecked" line');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_save(tests.id('hub_a1'), :'y'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('b'), 'final_status', 'present', 'online_reason', 'no phone')));
select tests.logout();
select tests.ok(private.att_day_autosubmit() = 1, 'when every person has an answer the next run submits the register');
select tests.ok((select status = 'submitted' and submit_mode = 'auto' and version = 1 and submitted_by is null from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'y'::date)
            and (select string_agg(e.employee_code || ':' || l.final_status, ',' order by e.employee_code) = '991:absent,992:present,993:leave' from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                  join public.employees e on e.id = l.employee_id where s.hub_id = tests.id('hub_a1') and s.work_date = :'y'::date)
            and (select resolved_at is not null from public.wf_auto_holds where kind = 'daily' and hub_id = tests.id('hub_a1') and work_date = :'y'::date),
  'submitted by the server with exactly what was written, and the hold is released');
select tests.ok(not exists (select 1 from public.att_day_lines where final_status in ('unchecked', 'pending_leave')), 'no register the server submitted has a line nobody checked');
select tests.ok(private.att_day_autosubmit() = 0 and private.wf_morning_autosubmit() = 0, 'and then there is nothing left for either job');
-- the manager's own submit still refuses an unfinished register (as before)
select tests.login(tests.id('zonal_a'));
select public.att_sheet_unlock((select id from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'y'::date), 'check again');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.att_sheet_submit(%L, %L, %L::jsonb)$$, tests.id('hub_a1'), :'y'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('b'), 'final_status', 'absent'))),
  'the manager''s own submit still refuses an unfinished line', '22023');
rollback;
