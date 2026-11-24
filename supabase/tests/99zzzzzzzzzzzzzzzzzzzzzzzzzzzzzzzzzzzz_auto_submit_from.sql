-- অটো-সাবমিট শুরুর তারিখ — the two server jobs never submit for a day before workforce.auto_submit_from, and run by their rules from that day on.
begin;
select tests.fixture();
select tests.hr_fixture();
select (now() at time zone 'Asia/Dhaka')::date as t, (now() at time zone 'Asia/Dhaka')::date - 1 as y, (now() at time zone 'Asia/Dhaka')::date - 2 as y2,
       (now() at time zone 'Asia/Dhaka')::date - 3 as y3 \gset
insert into tests.ids values
  ('a', tests.active_employee('Hub A1 Rider', '961', tests.id('hub_a1'), '01711000961', '9610000000')),
  ('b', tests.active_employee('Hub A2 Rider', '962', tests.id('hub_a2'), '01711000962', '9620000000'));
-- the morning cut-off has passed for every day (00:00 + 0), so only the start date decides
insert into public.wf_att_policy (zone_id, morning_cutoff, morning_extra, day_time, day_extra) values (tests.id('zone_a'), '00:00', 0, '00:00', 0);

-- the migration sets the start on the day it first runs (Asia/Dhaka) and a second run keeps it
select tests.ok((select (value #>> '{}')::date <= :'t'::date from public.system_settings where key = 'workforce.auto_submit_from'), 'the setting exists and is a Dhaka date');
select tests.ok(private.wf_auto_from() = (select (value #>> '{}')::date from public.system_settings where key = 'workforce.auto_submit_from'), 'the helper reads it');

-- start = today: the three days before are not touched, by either job
update public.system_settings set value = to_jsonb(:'t'::text) where key = 'workforce.auto_submit_from';
select private.att_day_autosubmit();
select private.wf_morning_autosubmit();
select tests.ok(not exists (select 1 from public.att_day_sheets where work_date < :'t'::date), 'start today: no daily register is made for the three days before');
select tests.ok(not exists (select 1 from public.wf_morning_subs where work_date < :'t'::date), 'start today: no morning input is made for the days before');
select tests.ok(not exists (select 1 from public.notifications where kind in ('attendance_gap', 'wf_morning') and created_at >= now() - interval '1 minute' and title like '%সার্ভার%'), 'and nobody is told anything about them');
select tests.ok((select count(*) = 2 from public.wf_morning_subs where work_date = :'t'::date and submit_mode = 'auto'), 'the start day itself runs: its morning inputs are submitted by the server at the cut-off');
select tests.ok(not exists (select 1 from public.att_day_sheets where work_date = :'t'::date), 'today''s daily register is not due before the date changes, as ever');

-- start = yesterday: yesterday's register is made, the day before is not
update public.system_settings set value = to_jsonb(:'y'::text) where key = 'workforce.auto_submit_from';
select tests.ok(private.att_day_autosubmit() = 2, 'start yesterday: the job submits yesterday''s register for both hubs');
select tests.ok((select count(*) = 2 from public.att_day_sheets where work_date = :'y'::date and submit_mode = 'auto' and status = 'submitted')
            and not exists (select 1 from public.att_day_sheets where work_date in (:'y2'::date, :'y3'::date)), 'yesterday is there; the two days before it are not');
select tests.ok(private.att_day_autosubmit() = 0, 'running it again changes nothing');
select private.wf_morning_autosubmit();
select tests.ok((select count(*) = 2 from public.wf_morning_subs where work_date = :'y'::date) and not exists (select 1 from public.wf_morning_subs where work_date in (:'y2'::date, :'y3'::date)),
  'the morning job follows the same start: yesterday and today, not the days before');

-- start = three days back: all of the window is reached, as the rules say
update public.system_settings set value = to_jsonb(:'y3'::text) where key = 'workforce.auto_submit_from';
select tests.ok(private.att_day_autosubmit() = 4, 'start three days back: the two days before yesterday are now made too (two hubs each)');

-- an unreadable or missing start: the jobs do nothing (never the other way round)
delete from public.att_day_sheets where false;
update public.system_settings set value = '"garbage"'::jsonb where key = 'workforce.auto_submit_from';
select tests.ok(private.wf_auto_from() = date '9999-12-31', 'an unreadable start reads as "never"');
select tests.ok(private.att_day_autosubmit() = 0 and private.wf_morning_autosubmit() = 0, 'and neither job does anything');
rollback;
