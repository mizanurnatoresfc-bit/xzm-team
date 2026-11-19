-- হাজিরা খাতা (ম্যানেজারের): the hub manager's book, day close, zonal correction and submission, paid / unpaid, setting, photo.
-- Migration 20261120000200_workforce_manager_book.sql. The business clock is moved inside this transaction
-- (private.wf_today reads a setting) to a month two months back, so every date is in the past for the register.
begin;
select tests.fixture();
select tests.hr_fixture();

create function tests.fm() returns date language sql stable as $$ select date_trunc('month', ((now() at time zone 'Asia/Dhaka')::date - 60))::date $$;
create function tests.day(n integer) returns date language sql stable as $$ select tests.fm() + (n - 1) $$;
create function tests.set_today(n integer) returns void language sql as $$ select set_config('tests.today', (tests.fm() + (n - 1))::text, true) $$;
create or replace function private.wf_today() returns date language sql stable as
  $$ select coalesce(nullif(current_setting('tests.today', true), ''), (now() at time zone 'Asia/Dhaka')::date::text)::date $$;
create function tests.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function tests.item(p_emp text, p_code text, p_extra jsonb default '{}') returns jsonb language sql stable as
  $$ select jsonb_build_array(jsonb_build_object('employee_id', tests.id(p_emp), 'code', p_code) || p_extra) $$;
create function tests.cell(p_emp text, n integer, m date default null) returns jsonb language sql stable as
  $$ select p -> 'cells' -> (n - 1) from jsonb_array_elements(public.wf_mb_book(tests.id('hub_a1'), m) -> 'people') p where p ->> 'employee_id' = tests.id(p_emp)::text $$;
create function tests.psum(p_emp text) returns jsonb language sql stable as
  $$ select p -> 'sum' from jsonb_array_elements(public.wf_mb_book(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id(p_emp)::text $$;
create function tests.reg(p_emp text, n integer) returns text language sql stable security definer as
  $$ select status || '/' || source from public.attendance_records where employee_id = tests.id(p_emp) and work_date = tests.day(n) $$;
create function tests.n_notes(p_user text, p_title text) returns bigint language sql stable security definer as
  $$ select count(*) from public.notifications where profile_id = tests.id(p_user) and title like p_title $$;
create function tests.n_log(p_emp text) returns bigint language sql stable security definer as
  $$ select count(*) from public.wf_book_entry_log where employee_id = tests.id(p_emp) $$;
select tests.set_today(5);

-- ---------------------------------------------------------------- people: three in hub A1, the hub manager is one of them
insert into tests.ids values
  ('u_s1', tests.make_user('mb.s1@test.local', 'Book One')), ('u_s2', tests.make_user('mb.s2@test.local', 'Book Two')),
  ('u_s3', tests.make_user('mb.s3@test.local', 'Book Three'));
insert into tests.ids values
  ('s1', tests.active_employee('Book One', '7101', tests.id('hub_a1'), '01711007101', '7101010101', 15000, tests.id('u_s1'))),
  ('s2', tests.active_employee('Book Two', '7102', tests.id('hub_a1'), '01711007102', '7102010101', 15000, tests.id('u_s2'))),
  ('s3', tests.active_employee('Book Three', '7103', tests.id('hub_a1'), '01711007103', '7103010101', 15000, tests.id('u_s3'))),
  ('smgr', tests.active_employee('Hub Manager Self', '7104', tests.id('hub_a1'), '01711007104', '7104010101', 15000, tests.id('hub_mgr')));
select tests.grant_role(tests.id('u_s1'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_s2'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_s3'), 'rider', 'hub', null, tests.id('hub_a1'));
-- nobody else is in hub A1 (other test files' people are rolled back)
select tests.ok((select count(*) from public.employees where hub_id = tests.id('hub_a1') and status = 'active' and archived_at is null) = 4, 'four active people in hub A1');

-- ---------------------------------------------------------------- shape and safety
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and (p.proname like 'wf\_mb\_%' or p.proname in ('wf_absence_photo', 'wf_absence_photos'))
                               and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute') or not p.prosecdef)),
  'every new public function: security definer, signed-in users only');
select tests.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wf\_mb\_%') = 11,
  'eleven wf_mb_* functions');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'private' and p.proname like 'wf\_mb\_%' and has_function_privilege('authenticated', p.oid, 'execute')),
  'the private helpers are not reachable from the API');
select tests.ok(not has_table_privilege('authenticated', 'public.wf_book_entries', 'insert') and not has_table_privilege('authenticated', 'public.wf_book_entries', 'update')
            and not has_table_privilege('anon', 'public.wf_book_entries', 'select') and has_table_privilege('authenticated', 'public.wf_book_entries', 'select')
            and not has_table_privilege('authenticated', 'public.wf_book_days', 'insert') and not has_table_privilege('authenticated', 'public.wf_book_submissions', 'update')
            and not has_table_privilege('authenticated', 'public.wf_book_rules', 'update'),
  'the API may only read the tables');
select tests.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
                  and c.relname in ('wf_book_rules', 'wf_book_entries', 'wf_book_days', 'wf_book_submissions', 'wf_book_entry_log') and c.relrowsecurity) = 5,
  'row security is on for all five tables');
select tests.ok((select count(*) from public.wf_book_rules where zone_id is null) = 1, 'the company default setting exists');

-- ---------------------------------------------------------------- the setting
select tests.login(tests.id('u_s1'));
select tests.ok((public.wf_mb_rules_get(null) #>> '{effective,to_day}')::integer = 17 and (public.wf_mb_rules_get(null) #>> '{effective,paid,absent_site}') = 'quota',
  'anyone signed in reads the setting: days 1-17, website leave counts against the paid-leave quota');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{"to_day": 20}')$$) ~ '^42501', 'a staff member may not change the setting');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{"to_day": 20}')$$) ~ '^42501', 'a hub manager may not either');
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.err($$select public.wf_mb_rules_save(null, '{"to_day": 20}')$$) ~ '^42501', 'a zonal manager may not change the company default');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_b'), '{"to_day": 20}')$$) ~ '^42501', 'nor another zone');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{"to_day": 40}')$$) ~ '^22023', 'the last day is 1-31');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{"from_day": 10, "to_day": 5}')$$) ~ '^22023 .*before the first', 'the last day cannot come first');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{"paid": {"late": "maybe"}}')$$) ~ '^22023', 'paid / unpaid / quota only');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{"colour": 1}')$$) ~ '^22023 .*Unknown setting', 'unknown keys are refused');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{"late_after": "9.30"}')$$) ~ '^22023', 'late after must be HH:MI');
select tests.ok(tests.err($$select public.wf_mb_rules_save(tests.id('zone_a'), '{}', '[{"key": "Bad Key"}]')$$) ~ '^22023', 'format keys are checked');
select tests.ok((public.wf_mb_rules_save(tests.id('zone_a'), '{"to_day": 20, "paid_leave_quota": 1, "late_per_deduct": 2, "paid": {"hub_no_online": "unpaid"}}') ->> 'to_day')::integer = 20,
  'the zonal manager sets the zone: book days 1-20, one paid leave, every 2nd late unpaid, present without online attendance unpaid');
select tests.ok((select (q.r #>> '{paid,late}') = 'paid' and (q.r #>> '{paid,hub_no_online}') = 'unpaid' and (q.r ->> 'own')::boolean and (q.r ->> 'from_day')::integer = 1
                   from (select public.wf_mb_rules_get(tests.id('zone_a')) -> 'effective' as r) q),
  'the zone keeps the company values it did not change (paid merged per input)');
select tests.ok((public.wf_mb_rules_get(tests.id('zone_b')) #>> '{effective,to_day}')::integer = 17, 'another zone still follows the company default');
select tests.ok((public.wf_mb_rules_save(tests.id('zone_a'), '{}', '[{"key":"name","label":"নাম"},{"key":"paid_days","label":"বেতনসহ দিন"}]') -> 'format') @> '[{"key":"name"}]',
  'the zone may keep its own export format');

-- ---------------------------------------------------------------- the hub manager writes the book
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.wf_mb_book(tests.id('hub_a1')) -> 'dates') = 20, 'the book shows the zone''s 20 book days');
select tests.ok((tests.cell('s1', 1) ->> 'm')::boolean and (tests.cell('s1', 6) ->> 'm')::boolean is false, 'a past day without input is missing, a future day is not');
select tests.ok((public.wf_mb_book(tests.id('hub_a1')) #>> '{can,write}')::boolean and not (public.wf_mb_book(tests.id('hub_a1')) #>> '{can,zonal}')::boolean,
  'the hub manager may write, but is not the zonal manager');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(6), tests.item('s1', 'hub_online'))$$) ~ '^22023 .*future', 'a future date cannot be written');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'sleeping'))$$) ~ '^22023', 'only the seven inputs');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'late'))$$) ~ '^22023 .*time', 'late needs the time');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'absent_site'))$$) ~ '^22023 .*website', 'website leave needs the dates');
select tests.ok(tests.err(format($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'absent_site', '{"site_from": "%s", "site_to": "%s"}'))$$, tests.day(2), tests.day(3))) ~ '^22023 .*include this date',
  'the application dates must include the day');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('smgr', 'hub_online'))$$) ~ '^42501', 'the manager may not write their own attendance');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a2'), tests.day(1), tests.item('s1', 'hub_online'))$$) ~ '^42501', 'nor another hub''s book');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'hub_online') || tests.item('s1', 'late', '{"late_at": "10:00"}'))$$) ~ '^22023 .*twice',
  'one person once per save');
select tests.ok(public.wf_mb_set(tests.id('hub_a1'), tests.day(1),
  tests.item('s1', 'hub_online') || tests.item('s2', 'late', '{"late_at": "10:15"}')
  || tests.item('s3', 'absent_site', format('{"site_from": "%s", "site_to": "%s", "site_ref": "SF-77"}', tests.day(1), tests.day(2))::jsonb)) = 3,
  'day 1: present with online attendance, late at 10:15, absent with a website application (days 1-2, SF-77)');
select tests.ok(tests.reg('s1', 1) = 'present/book' and tests.reg('s2', 1) = 'late/book' and tests.reg('s3', 1) = 'leave/book',
  'each input is on the register too (source book)');
select tests.ok((tests.cell('s2', 1) ->> 't') = '10:15' and (tests.cell('s3', 1) ->> 'ref') = 'SF-77', 'the late time and the website number are kept');
select tests.ok(public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'hub_online')) = 0 and tests.n_log('s1') = 1,
  'the same input again changes nothing (no new history)');
select tests.ok(public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'hub_no_online')) = 1, 'before closing the manager may change it');
select tests.ok(tests.n_log('s1') = 2 and (tests.cell('s1', 1) ->> 'v')::integer = 2, 'revision 2, logged');

-- "এখুনি আবেদন করুন"
select tests.ok(tests.n_notes('u_s1', 'ওয়েবসাইটে এখুনি%') = 0, 'nobody is told to apply yet');
select tests.ok(public.wf_mb_set(tests.id('hub_a1'), tests.day(2), tests.item('s1', 'absent_no_site')
   || tests.item('s3', 'absent_site', format('{"site_from": "%s", "site_to": "%s", "site_ref": "SF-77"}', tests.day(1), tests.day(2))::jsonb)) = 2,
  'day 2: s1 absent without a website application, s3 still on the website leave');
select tests.ok(tests.n_notes('u_s1', 'ওয়েবসাইটে এখুনি%') = 1 and tests.reg('s1', 2) = 'absent/book', 's1 is told to apply on the website now; the register says absent');

-- the staff member's own input becomes a suggestion, and is settled when the book is written
select tests.login(tests.id('u_s2'));
select public.wf_att_submit(tests.day(2), 'present');
select tests.login(tests.id('hub_mgr'));
select tests.ok((tests.cell('s2', 2) ->> 'sg') = 'hub_online', 'what the person gave shows as a suggestion');
select public.wf_mb_set(tests.id('hub_a1'), tests.day(2), tests.item('s2', 'hub_online'));
select tests.ok((select status from public.attendance_self_marks where employee_id = tests.id('s2') and work_date = tests.day(2)) = 'approved',
  'writing the book settles the person''s waiting input');

-- ---------------------------------------------------------------- close the day
select tests.ok(tests.err($$select public.wf_mb_close(tests.id('hub_a1'), tests.day(3))$$) ~ '^22023 .*3 people', 'day 3 cannot close: three people still have no input');
select tests.ok((public.wf_mb_close(tests.id('hub_a1'), tests.day(1)) ->> 'entered')::integer = 3, 'day 1 closes (the manager''s own row is left for the zonal manager)');
select tests.ok(tests.err($$select public.wf_mb_close(tests.id('hub_a1'), tests.day(1))$$) ~ '^23505', 'a day closes once');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'hub_online'))$$) ~ '^22023 .*closed', 'after closing the hub manager cannot correct it');
select tests.ok((public.wf_mb_book(tests.id('hub_a1')) -> 'days' -> 0 ->> 'closed')::boolean, 'the book shows day 1 closed');

-- ---------------------------------------------------------------- the zonal manager corrects
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'hub_online'))$$) ~ '^22023 .*why', 'a closed day is corrected with a reason');
select public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('s1', 'hub_online'), 'অনলাইন হাজিরা পরে পাওয়া গেছে');
select tests.ok((select action || ':' || reason from public.wf_book_entry_log where employee_id = tests.id('s1') order by at desc, revision desc limit 1) = 'corrected:অনলাইন হাজিরা পরে পাওয়া গেছে',
  'the zonal manager corrects it; the history says corrected, with the reason');
select tests.ok(public.wf_mb_set(tests.id('hub_a1'), tests.day(1), tests.item('smgr', 'hub_online'), 'ম্যানেজার উপস্থিত ছিলেন') = 1, 'and writes the hub manager''s own row');

-- ---------------------------------------------------------------- paid / unpaid
-- zone A: one paid leave a month, every 2nd late unpaid, present without online attendance unpaid
select tests.login(tests.id('hub_mgr'));
select public.wf_mb_set(tests.id('hub_a1'), tests.day(3), tests.item('s2', 'late', '{"late_at": "09:50"}'));
select tests.ok((tests.cell('s3', 1) ->> 'p')::boolean and not (tests.cell('s3', 2) ->> 'p')::boolean,
  'website leave: the first day is paid (quota 1), the second is not');
select tests.ok((tests.cell('s2', 1) ->> 'p')::boolean and not (tests.cell('s2', 3) ->> 'p')::boolean, 'the 2nd late of the month is an unpaid day');
select tests.ok(not (tests.cell('s1', 2) ->> 'p')::boolean, 'absent without application is unpaid');
select tests.ok((select (q.s ->> 'paid_days')::integer = 2 and (q.s ->> 'unpaid_days')::integer = 1 and (q.s ->> 'late')::integer = 2 and (q.s ->> 'present')::integer = 3
                   from (select tests.psum('s2') as s) q), 's2: 3 present (2 late), 2 paid, 1 unpaid');

-- ---------------------------------------------------------------- the staff side: my count, the photo
select tests.login(tests.id('u_s3'));
select tests.ok((public.wf_mb_mine() #>> '{sum,paid_days}')::integer = 1 and (public.wf_mb_mine() #>> '{sum,unpaid_days}')::integer = 1,
  'the staff member sees their own paid / unpaid count');
select tests.ok(tests.err($$select public.wf_mb_book(tests.id('hub_a1'))$$) ~ '^42501', 'but not the hub''s book');
select public.wf_absence_apply(array[tests.day(4)], 'জ্বর');
select tests.ok(tests.err(format($$select public.wf_absence_photo((select id from public.wf_absence_applications where employee_id = tests.id('s3')), '%s/x.jpg')$$, tests.id('s1'))) ~ '^22023',
  'the photo must be in the person''s own folder');
select public.wf_absence_photo((select id from public.wf_absence_applications where employee_id = tests.id('s3')), tests.id('s3') || '/leave-1.jpg');
select tests.ok((select photo_path from public.wf_absence_applications where employee_id = tests.id('s3')) = tests.id('s3') || '/leave-1.jpg', 'the photo is on the application');
select tests.login(tests.id('u_s1'));
select tests.ok(tests.err($$select public.wf_absence_photo((select a.id from public.wf_absence_applications a join public.employees e on e.id = a.employee_id where e.employee_code = '7103'), 'x')$$) ~ '^42501',
  'nobody else may set it');
select tests.ok(public.wf_absence_photos(array(select id from public.wf_absence_applications)) = '{}'::jsonb, 'nor see it');
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_typeof(public.wf_absence_photos(array(select id from public.wf_absence_applications)) -> (select id::text from public.wf_absence_applications limit 1)) = 'string',
  'the hub manager sees the photo');

-- ---------------------------------------------------------------- the zonal sheet and the submission
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) from jsonb_array_elements(public.wf_mb_sheet(tests.id('zone_a'), null, tests.day(1), tests.day(3)) -> 'people')) >= 4,
  'the zonal manager sees everyone of the zone by name and date');
select tests.ok(tests.err($$select public.wf_mb_submit(tests.id('zone_a'), 'week', tests.day(1))$$) ~ '^22023 .*not ended', 'a week that has not ended cannot be submitted');
select tests.set_today(12);
select tests.ok(tests.err($$select public.wf_mb_submit(tests.id('zone_a'), 'week', tests.day(1))$$) ~ '^22023 .*missing', 'nor while inputs are missing');
-- fill days 1-7 for everyone of zone A (hub A1 and hub A2 have people in other files only, rolled back)
select public.wf_mb_set(tests.id('hub_a1'), tests.day(d),
         (select jsonb_agg(jsonb_build_object('employee_id', c ->> 'employee_id', 'code', 'hub_online'))
            from jsonb_array_elements(public.wf_mb_sheet(tests.id('zone_a'), null, tests.day(d), tests.day(d)) -> 'people') c
           where (c -> 'cells' -> 0 ->> 'm')::boolean), 'সপ্তাহ পূরণ')
  from generate_series(2, 7) d
 where exists (select 1 from jsonb_array_elements(public.wf_mb_sheet(tests.id('zone_a'), null, tests.day(d), tests.day(d)) -> 'people') c where (c -> 'cells' -> 0 ->> 'm')::boolean);
select tests.ok((public.wf_mb_sheet(tests.id('zone_a'), null, tests.day(1), tests.day(7)) #>> '{totals,missing}')::integer = 0, 'week 1 is complete');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err($$select public.wf_mb_submit(tests.id('zone_a'), 'week', tests.day(1))$$) ~ '^42501', 'the hub manager cannot submit for the zone');
select tests.login(tests.id('zonal_a'));
insert into tests.ids values ('sub1', public.wf_mb_submit(tests.id('zone_a'), 'week', tests.day(1), 'প্রথম সপ্তাহ'));
select tests.ok((select date_to = tests.day(7) and (totals ->> 'missing')::integer = 0 and snapshot ? 'people' from public.wf_book_submissions where id = tests.id('sub1')),
  'the week is submitted with a snapshot');
select tests.ok((select count(*) from public.wf_book_days where hub_id = tests.id('hub_a1') and work_date between tests.day(1) and tests.day(7)) = 7,
  'the submission closes the hub''s remaining days');
select tests.ok(tests.err($$select public.wf_mb_submit(tests.id('zone_a'), 'week', tests.day(3))$$) ~ '^23505', 'overlapping weeks are refused');
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(2), tests.item('s1', 'hub_online'), 'ভুল')$$) ~ '^22023 .*submitted', 'a submitted date is locked, even for the zonal manager');
select tests.ok(jsonb_array_length(public.wf_mb_submissions(tests.id('zone_a'))) = 1 and public.wf_mb_submissions(tests.id('zone_a')) -> 0 -> 'snapshot' = 'null'::jsonb
            and public.wf_mb_submissions(null, tests.id('sub1')) -> 0 -> 'snapshot' ? 'people', 'the list is light; one submission comes with its snapshot');
select tests.ok(tests.err($$select public.wf_mb_reopen(tests.id('sub1'), 'ভুল')$$) ~ '^42501', 'the zonal manager cannot reopen it');
select tests.login(tests.id('admin'));
select tests.ok(tests.err($$select public.wf_mb_reopen(tests.id('sub1'), '')$$) ~ '^22023', 'reopening needs a reason');
select public.wf_mb_reopen(tests.id('sub1'), 'হেড অফিসের নির্দেশে সংশোধন');
select tests.login(tests.id('zonal_a'));
select tests.ok(public.wf_mb_set(tests.id('hub_a1'), tests.day(2), tests.item('s1', 'hub_online'), 'হেড অফিস খুলে দিয়েছে') = 1, 'after reopening the zonal manager corrects again');

-- ---------------------------------------------------------------- the book closed by the zonal setting, and other months
select public.wf_mb_rules_save(tests.id('zone_a'), '{"open": false}');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(8), tests.item('s1', 'hub_online'))$$) ~ '^22023 .*closed the book', 'the zonal manager can keep the book closed');
select tests.logout(); select tests.login(tests.id('zonal_a'));
select public.wf_mb_rules_save(tests.id('zone_a'), '{"open": true}');
select tests.login(tests.id('hub_mgr'));
select tests.set_today(40);   -- next month
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(8), tests.item('s1', 'hub_online'))$$) ~ '^22023 .*this month', 'last month''s book is the zonal manager''s');
select tests.set_today(5);
select tests.ok(tests.err($$select public.wf_mb_set(tests.id('hub_a1'), tests.day(25), tests.item('s1', 'hub_online'))$$) ~ '^22023', 'day 25 is not one of the 20 book days (and has not come)');

-- ---------------------------------------------------------------- history cannot be changed
select tests.logout();
select tests.ok(tests.err($$update public.wf_book_entry_log set reason = 'x'$$) ~ '^42501', 'the history cannot be changed');
select tests.ok(tests.err($$delete from public.wf_book_entries$$) is not null, 'entries are never deleted');
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.wf_mb_history(tests.id('hub_a1'))) >= 8, 'the hub''s history lists every change');

rollback;
