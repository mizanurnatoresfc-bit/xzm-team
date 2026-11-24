-- নিয়ম ২: সকালের জব ও ফর্মের তারিখ যাচাই বাংলাদেশ সময় (Asia/Dhaka) ধরে — সার্ভারের current_date ধরে নয়।
-- Rule 2: the morning job and the form's date check use the Dhaka date. The database session's own date (current_date) is never used.
-- How this is tested at any hour: the same checks run in two session time zones, Pacific/Pago_Pago (UTC-11: its date is behind Dhaka's from 00:00 to 17:00 Dhaka time) and
-- Pacific/Kiritimati (UTC+14: its date is ahead of Dhaka's from 16:00 to 24:00 Dhaka time). One of the two always disagrees with Dhaka, so a check on current_date fails here at every hour.
begin;
select tests.fixture();
select tests.hr_fixture();
select (now() at time zone 'Asia/Dhaka')::date as t, (now() at time zone 'Asia/Dhaka')::date - 1 as y, (now() at time zone 'Asia/Dhaka')::date - 2 as y2,
       (now() at time zone 'Asia/Dhaka')::date - 3 as y3, (now() at time zone 'Asia/Dhaka')::date - 10 as far, (now() at time zone 'Asia/Dhaka')::date + 1 as tm \gset
insert into tests.ids values
  ('a', tests.active_employee('Form Rider A1', '981', tests.id('hub_a1'), '01711000981', '9810000000')),
  ('b', tests.active_employee('Job Rider A2', '982', tests.id('hub_a2'), '01711000982', '9820000000')),
  ('c', tests.active_employee('Job Rider B1', '983', tests.id('hub_b1'), '01711000983', '9830000000'));
insert into public.wf_att_policy (zone_id, morning_cutoff, morning_extra, day_time, day_extra)
  values (tests.id('zone_a'), '00:00', 0, '00:00', 0), (tests.id('zone_b'), '00:00', 0, '00:00', 0);
update public.system_settings set value = to_jsonb(:'far'::text) where key = 'workforce.auto_submit_from';
-- roles are valid from the (UTC) day they were given; a session zone behind UTC would read that as a day in the future. Role validity is not what this test is about.
set local session_replication_role = replica;      -- the table refuses edits of a role; this is test set-up
update public.user_roles set valid_from = valid_from - 2;
set local session_replication_role = origin;

select tests.ok((now() at time zone 'Pacific/Pago_Pago')::date <> :'t'::date or (now() at time zone 'Pacific/Kiritimati')::date <> :'t'::date,
  'sanity: at this very moment at least one of the two test zones is on another date than Dhaka');

-- the helper that says what day it is for the business
select tests.ok(private.wf_today() = :'t'::date, 'the business date is the Dhaka date');

-- ---------------------------------------------------------------- the form's date check, in both session zones
create function pg_temp.form_checks(p_zone_label text) returns void language plpgsql as $$
declare v_t date := (now() at time zone 'Asia/Dhaka')::date; d date;
begin
  perform tests.login(tests.id('hub_mgr'));
  perform tests.ok((public.wf_morning_get(tests.id('hub_a1')) ->> 'date')::date = v_t and (public.wf_morning_get(tests.id('hub_a1')) ->> 'today')::date = v_t,
    p_zone_label || ': the form opens on the Dhaka day and says it is that day');
  foreach d in array array[v_t, v_t - 1, v_t - 2] loop
    perform tests.ok((public.wf_morning_get(tests.id('hub_a1'), d) ->> 'date')::date = d, p_zone_label || ': the form of ' || d || ' (today or one of the last two Dhaka days) opens');
  end loop;
  perform tests.throws(format($q$select public.wf_morning_get(%L, %L)$q$, tests.id('hub_a1'), v_t + 1), p_zone_label || ': tomorrow (Dhaka) is a day in the future', '22023');
  perform tests.throws(format($q$select public.wf_morning_get(%L, %L)$q$, tests.id('hub_a1'), v_t - 3), p_zone_label || ': three Dhaka days back is too old', '22023');
  perform tests.throws(format($q$select public.wf_morning_save(%L, %L, '[]')$q$, tests.id('hub_a1'), v_t + 1), p_zone_label || ': tomorrow cannot be saved', '22023');
  perform tests.throws(format($q$select public.wf_morning_submit(%L, %L, '[]')$q$, tests.id('hub_a1'), v_t - 3), p_zone_label || ': an old day cannot be submitted', '22023');
  perform tests.login(tests.id('zonal_a'));
  perform tests.ok((public.wf_morning_zone(tests.id('zone_a')) ->> 'date')::date = v_t and (public.wf_morning_zone(tests.id('zone_a')) ->> 'today')::date = v_t,
    p_zone_label || ': the zonal manager''s morning is the Dhaka day');
  perform tests.throws(format($q$select public.wf_morning_zone(%L, %L)$q$, tests.id('zone_a'), v_t + 1), p_zone_label || ': the zonal manager cannot open tomorrow', '22023');
  perform tests.ok((public.wf_att_policy_get(tests.id('zone_a')) ->> 'today_due')::timestamptz = (v_t::timestamp at time zone 'Asia/Dhaka'),
    p_zone_label || ': "today''s time" is today''s Dhaka cut-off (00:00 Dhaka)');
  perform tests.logout();
end $$;

set local timezone to 'Pacific/Pago_Pago';
select pg_temp.form_checks('UTC-11');
set local timezone to 'Pacific/Kiritimati';
select pg_temp.form_checks('UTC+14');
-- saving with no date means the Dhaka day
set local timezone to 'Pacific/Pago_Pago';
select tests.login(tests.id('hub_mgr'));
select public.wf_morning_save(tests.id('hub_a1'), null, jsonb_build_array(jsonb_build_object('employee_id', tests.id('a'), 'state', 'present')));
select tests.logout();
select tests.ok(exists (select 1 from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date = :'t'::date and status = 'open'), 'a save with no date lands on the Dhaka day');
select tests.ok(not exists (select 1 from public.wf_morning_subs where hub_id = tests.id('hub_a1') and work_date <> :'t'::date), 'and on no other day');

-- ---------------------------------------------------------------- the jobs, in both session zones
-- hub A2: complete forms of the three days before, today and tomorrow; complete registers of three days back, yesterday and today. Run in UTC-11.
insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status)
  select tests.id('hub_a2'), tests.id('zone_a'), d, 1, 'open' from (values (:'y3'::date), (:'y2'::date), (:'t'::date), (:'tm'::date)) x(d);
insert into public.wf_morning_lines (sub_id, employee_id, state)
  select s.id, tests.id('b'), 'present' from public.wf_morning_subs s where s.hub_id = tests.id('hub_a2');
insert into public.att_day_sheets (hub_id, zone_id, work_date)
  select tests.id('hub_a2'), tests.id('zone_a'), d from (values (:'y3'::date), (:'y'::date), (:'t'::date)) x(d);
insert into public.att_day_lines (sheet_id, employee_id, final_status, unauthorized)
  select s.id, tests.id('b'), 'absent', true from public.att_day_sheets s where s.hub_id = tests.id('hub_a2');
set local timezone to 'Pacific/Pago_Pago';
select private.wf_morning_autosubmit();
select private.att_day_autosubmit();
select tests.ok((select array_agg(work_date order by work_date) = array[:'y2'::date, :'t'::date] from public.wf_morning_subs where hub_id = tests.id('hub_a2') and status = 'submitted'),
  'UTC-11: the morning job submitted exactly today and the day before yesterday of Dhaka (the window is the Dhaka day and two before)');
select tests.ok((select array_agg(work_date order by work_date) = array[:'y3'::date, :'t'::date + 1] from public.wf_morning_subs where hub_id = tests.id('hub_a2') and status = 'open'),
  'UTC-11: three days back and tomorrow are left alone');
select tests.ok((select array_agg(work_date order by work_date) = array[:'y3'::date, :'y'::date] from public.att_day_sheets where hub_id = tests.id('hub_a2') and status = 'submitted')
            and (select status = 'draft' from public.att_day_sheets where hub_id = tests.id('hub_a2') and work_date = :'t'::date),
  'UTC-11: the daily job submitted three days back and yesterday of Dhaka; today''s register is not due');

-- hub B1: the same, run in UTC+14
insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status)
  select tests.id('hub_b1'), tests.id('zone_b'), d, 1, 'open' from (values (:'y3'::date), (:'y2'::date), (:'t'::date), (:'tm'::date)) x(d);
insert into public.wf_morning_lines (sub_id, employee_id, state)
  select s.id, tests.id('c'), 'present' from public.wf_morning_subs s where s.hub_id = tests.id('hub_b1');
insert into public.att_day_sheets (hub_id, zone_id, work_date)
  select tests.id('hub_b1'), tests.id('zone_b'), d from (values (:'y3'::date), (:'y'::date), (:'t'::date)) x(d);
insert into public.att_day_lines (sheet_id, employee_id, final_status, unauthorized)
  select s.id, tests.id('c'), 'absent', true from public.att_day_sheets s where s.hub_id = tests.id('hub_b1');
set local timezone to 'Pacific/Kiritimati';
select private.wf_morning_autosubmit();
select private.att_day_autosubmit();
select tests.ok((select array_agg(work_date order by work_date) = array[:'y2'::date, :'t'::date] from public.wf_morning_subs where hub_id = tests.id('hub_b1') and status = 'submitted'),
  'UTC+14: the morning job submitted exactly today and the day before yesterday of Dhaka');
select tests.ok((select array_agg(work_date order by work_date) = array[:'y3'::date, :'t'::date + 1] from public.wf_morning_subs where hub_id = tests.id('hub_b1') and status = 'open'),
  'UTC+14: three days back and tomorrow are left alone');
select tests.ok((select array_agg(work_date order by work_date) = array[:'y3'::date, :'y'::date] from public.att_day_sheets where hub_id = tests.id('hub_b1') and status = 'submitted')
            and (select status = 'draft' from public.att_day_sheets where hub_id = tests.id('hub_b1') and work_date = :'t'::date),
  'UTC+14: the daily job submitted three days back and yesterday of Dhaka; today''s register is not due');
rollback;
