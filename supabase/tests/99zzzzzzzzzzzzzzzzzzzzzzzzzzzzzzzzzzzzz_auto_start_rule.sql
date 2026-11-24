-- নিয়ম ১: অটো-সাবমিট শুরুর তারিখ (workforce.auto_submit_from) অনুপস্থিত বা ভুল হলে দুই জবই বন্ধ থাকে।
-- Rule 1: when the start date is missing or wrong, the morning-input job and the daily-register job both do nothing. Only a clearly written, real date (YYYY-MM-DD, as JSON text) turns them on.
begin;
select tests.fixture();
select tests.hr_fixture();
select (now() at time zone 'Asia/Dhaka')::date as t, (now() at time zone 'Asia/Dhaka')::date - 1 as y, (now() at time zone 'Asia/Dhaka')::date - 10 as far \gset
insert into tests.ids values
  ('a', tests.active_employee('Hub A1 Rider', '971', tests.id('hub_a1'), '01711000971', '9710000000')),
  ('b', tests.active_employee('Hub A2 Rider', '972', tests.id('hub_a2'), '01711000972', '9720000000'));
-- the cut-off of the morning and of the day have passed for every day (00:00 + 0)
insert into public.wf_att_policy (zone_id, morning_cutoff, morning_extra, day_time, day_extra) values (tests.id('zone_a'), '00:00', 0, '00:00', 0);
-- everything is READY to be submitted: complete morning forms of today and yesterday, complete registers of yesterday, for both hubs. Only the start date decides.
insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status)
  select h.id, tests.id('zone_a'), d, 1, 'open' from (values (tests.id('hub_a1')), (tests.id('hub_a2'))) h(id), (values (:'t'::date), (:'y'::date)) x(d);
insert into public.wf_morning_lines (sub_id, employee_id, state)
  select s.id, e.id, 'present' from public.wf_morning_subs s join public.employees e on e.hub_id = s.hub_id and e.employee_code in ('971', '972');
insert into public.att_day_sheets (hub_id, zone_id, work_date)
  select h.id, tests.id('zone_a'), :'y'::date from (values (tests.id('hub_a1')), (tests.id('hub_a2'))) h(id);
insert into public.att_day_lines (sheet_id, employee_id, final_status, unauthorized)
  select s.id, e.id, 'absent', true from public.att_day_sheets s join public.employees e on e.hub_id = s.hub_id and e.employee_code in ('971', '972');

-- a start date that is not readable reads as "never", and both jobs do nothing
create function pg_temp.try_start(p_value text, p_label text) returns void language plpgsql as $$
begin
  update public.system_settings set value = p_value::jsonb where key = 'workforce.auto_submit_from';
  perform tests.ok(private.wf_auto_from() = date '9999-12-31', 'start date ' || p_label || ': reads as "never"');
  perform tests.ok(private.wf_morning_autosubmit() = 0 and private.att_day_autosubmit() = 0, 'start date ' || p_label || ': neither job does anything');
  perform tests.ok(not exists (select 1 from public.wf_morning_subs where status = 'submitted') and not exists (select 1 from public.att_day_sheets where status = 'submitted'),
    'start date ' || p_label || ': nothing was submitted');
end $$;

-- the setting row is DELETED (a plain cast would have given null, and null does not stop a job)
-- the table refuses an ordinary delete (a trigger); the row can only go the way the undo notes of the migrations do it, with triggers off
select tests.throws($$delete from public.system_settings where key = 'workforce.auto_submit_from'$$, 'an ordinary delete of the setting is refused by the table');
set local session_replication_role = replica;
delete from public.system_settings where key = 'workforce.auto_submit_from';
set local session_replication_role = origin;
select tests.ok(not exists (select 1 from public.system_settings where key = 'workforce.auto_submit_from'), 'the setting row is deleted');
select tests.ok(private.wf_auto_from() = date '9999-12-31', 'start date deleted: reads as "never"');
select tests.ok(private.wf_morning_autosubmit() = 0 and private.att_day_autosubmit() = 0, 'start date deleted: neither job does anything (morning job and daily job)');
select tests.ok(not exists (select 1 from public.wf_morning_subs where status = 'submitted') and not exists (select 1 from public.att_day_sheets where status = 'submitted'), 'start date deleted: nothing was submitted');
select tests.ok(private.wf_morning_autosubmit() = 0 and private.att_day_autosubmit() = 0, 'start date deleted: and the next minute is the same');
-- put the row back (the way the migration writes it) for the cases below
insert into public.system_settings (key, value, description) values ('workforce.auto_submit_from', '"2026-11-10"', 'test');

-- present but wrong
select pg_temp.try_start('null', 'JSON null');
select pg_temp.try_start('""', 'empty text');
select pg_temp.try_start('"garbage"', 'a word');
select pg_temp.try_start('"today"', 'the word "today" (would be read as the server''s date)');
select pg_temp.try_start('"yesterday"', 'the word "yesterday"');
select pg_temp.try_start('"epoch"', 'the word "epoch" (1970)');
select pg_temp.try_start('"-infinity"', '"-infinity" (would start every day)');
select pg_temp.try_start('"infinity"', '"infinity"');
select pg_temp.try_start('"2026-13-45"', 'a day that is not on the calendar');
select pg_temp.try_start('"2026-02-30"', '30 February');
select pg_temp.try_start('"24/11/2026"', 'a day written the other way (24/11/2026)');
select pg_temp.try_start('"11/12/2026"', 'a day that can be read two ways (11/12/2026)');
select pg_temp.try_start('"2026-11-1"', 'a day without two-digit month and day');
select pg_temp.try_start('" 2026-11-10"', 'a date with a space before it');
select pg_temp.try_start('"2026-11-10 08:00"', 'a date with a time');
select pg_temp.try_start('"2026-11-10T08:00:00+06:00"', 'a time stamp');
select pg_temp.try_start('20261110', 'a number');
select pg_temp.try_start('true', 'true');
select pg_temp.try_start('["2026-11-10"]', 'a list');
select pg_temp.try_start('{"from":"2026-11-10"}', 'an object');

-- a start tomorrow is a good date too: it keeps the jobs off until then
update public.system_settings set value = to_jsonb(((:'t'::date + 1)::text)) where key = 'workforce.auto_submit_from';
select tests.ok(private.wf_auto_from() = :'t'::date + 1 and private.wf_morning_autosubmit() = 0 and private.att_day_autosubmit() = 0, 'a start date tomorrow: the jobs wait');

-- written right: the jobs run
update public.system_settings set value = to_jsonb(:'far'::text) where key = 'workforce.auto_submit_from';
select tests.ok(private.wf_auto_from() = :'far'::date, 'a clear date is read as it is');
select tests.ok(private.wf_morning_autosubmit() = 4, 'a good start date: the morning job submits the four complete forms (two hubs, yesterday and today)');
select tests.ok(private.att_day_autosubmit() = 2, 'and the daily job submits the two complete registers of yesterday');
select tests.ok(private.wf_morning_autosubmit() = 0 and private.att_day_autosubmit() = 0, 'running them again changes nothing');
rollback;
