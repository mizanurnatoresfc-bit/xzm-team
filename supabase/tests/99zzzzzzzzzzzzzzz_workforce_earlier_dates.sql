-- Earlier dates of the attendance book, opened by the zonal manager for one zone, and filling many dates in one step.
-- Migration 20261118200000_workforce_earlier_dates.sql. Like the workforce test, the business clock is moved inside this
-- transaction (private.wf_today reads a setting) to a month two months back, so every date is in the past for the register.
begin;
select tests.fixture();
select tests.hr_fixture();

-- ---------------------------------------------------------------- helpers (rolled back with the transaction)
create function tests.fm() returns date language sql stable as $$ select date_trunc('month', ((now() at time zone 'Asia/Dhaka')::date - 60))::date $$;
create function tests.day(n integer) returns date language sql stable as $$ select tests.fm() + (n - 1) $$;
create function tests.pday(n integer) returns date language sql stable as $$ select (tests.fm() - interval '1 month')::date + (n - 1) $$;   -- the month before
create function tests.set_today(n integer) returns void language sql as $$ select set_config('tests.today', (tests.fm() + (n - 1))::text, true) $$;
create or replace function private.wf_today() returns date language sql stable as
  $$ select coalesce(nullif(current_setting('tests.today', true), ''), (now() at time zone 'Asia/Dhaka')::date::text)::date $$;
create function tests.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function tests.bd(n integer, m date default null) returns jsonb language sql stable as
  $$ select d from jsonb_array_elements(public.wf_my_book(m) -> 'days') d where (d ->> 'day')::integer = n $$;
create function tests.states(m date default null) returns text language sql stable as
  $$ select string_agg(left(d ->> 'state', 1), '' order by (d ->> 'day')::integer) from jsonb_array_elements(public.wf_my_book(m) -> 'days') d $$;
create function tests.mark_of(p_emp text, p_date date) returns uuid language sql stable security definer as
  $$ select id from public.attendance_self_marks where employee_id = tests.id(p_emp) and work_date = p_date $$;
create function tests.n_notes(p_user text, p_title text) returns bigint language sql stable security definer as
  $$ select count(*) from public.notifications where profile_id = tests.id(p_user) and title like p_title $$;
create function tests.n_windows(p_zone text, p_live boolean default null) returns bigint language sql stable security definer as
  $$ select count(*) from public.wf_book_windows where zone_id = tests.id(p_zone) and (p_live is null or (ended_at is null) = p_live) $$;
select tests.set_today(20);   -- the 20th: this month's book (days 1-17) is closed

-- ---------------------------------------------------------------- people
insert into tests.ids values
  ('u_a1', tests.make_user('a1@test.local', 'Staff A One')), ('u_a2', tests.make_user('a2@test.local', 'Staff A Two')),
  ('u_b1', tests.make_user('b1@test.local', 'Staff B One')), ('zonal_b', tests.make_user('zonal.b@test.local', 'Zonal B'));
insert into tests.ids values
  ('ea1', tests.active_employee('Staff A One', '901', tests.id('hub_a1'), '01711000901', '9010101010', 15000, tests.id('u_a1'))),
  ('ea2', tests.active_employee('Staff A Two', '902', tests.id('hub_a2'), '01711000902', '9020101010', 15000, tests.id('u_a2'))),
  ('eb1', tests.active_employee('Staff B One', '903', tests.id('hub_b1'), '01711000903', '9030101010', 15000, tests.id('u_b1')));
select tests.grant_role(tests.id('u_a1'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_a2'), 'rider', 'hub', null, tests.id('hub_a2'));
select tests.grant_role(tests.id('u_b1'), 'rider', 'hub', null, tests.id('hub_b1'));
select tests.grant_role(tests.id('zonal_b'), 'zonal_manager', 'zone', tests.id('zone_b'));

-- ---------------------------------------------------------------- the permission and the table
select tests.ok((select count(*) from public.permissions where code = 'hr.attendance.configure' and module = 'hr' and resource = 'attendance' and action = 'configure') = 1,
  'permission hr.attendance.configure exists');
select tests.ok((select array_agg(r.code::text order by r.code::text) from public.role_permissions rp join public.roles r on r.id = rp.role_id
                  join public.permissions p on p.id = rp.permission_id where p.code = 'hr.attendance.configure') = array['admin', 'hr_manager', 'zonal_manager'],
  'admin, HR manager and zonal manager may open earlier dates; nobody else by default');
select tests.ok((select count(*) = 8 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'zonal_assistant'),
  'the Zonal Assistant role keeps exactly its eight permissions');
select tests.ok(not has_table_privilege('anon', 'public.wf_book_windows', 'select') and has_table_privilege('authenticated', 'public.wf_book_windows', 'select')
            and not has_table_privilege('authenticated', 'public.wf_book_windows', 'insert') and not has_table_privilege('authenticated', 'public.wf_book_windows', 'update'),
  'the API may only read the windows table; writes go through the functions');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname in ('wf_book_fill', 'wf_window_save', 'wf_window_end', 'wf_windows')
                               and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute') or not p.prosecdef)),
  'the four new functions: security definer, signed-in users only');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'private' and p.proname in ('wf_zone_of', 'wf_date_open', 'wf_window_json', 'wf_live_window')
                               and has_function_privilege('authenticated', p.oid, 'execute')),
  'the private helpers are not reachable from the API');

-- ---------------------------------------------------------------- before any window: closed as before
select tests.login(tests.id('u_a1'));
select tests.ok(not (public.wf_my_book() ->> 'open')::boolean and public.wf_my_book() -> 'catch_up' = 'null'::jsonb and tests.states() = repeat('c', 17),
  'day 20, no window: the book is closed and every date shows closed');
select tests.ok(not (tests.bd(5) ->> 'can_give')::boolean, 'a day says it cannot be given');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(5), 'present')$$) ~ '^22023 .*book is closed', 'and the database refuses it');
select tests.ok((public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 0 and public.wf_pending_counts() #> '{mine,catch_up_until}' = 'null'::jsonb,
  'nobody is nagged and there is no open window');

-- ---------------------------------------------------------------- who may open a zone's book
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(25))$$) ~ '^42501', 'a staff member may not open the book');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(25))$$) ~ '^42501', 'a hub manager may not either');
select tests.login(tests.id('zonal_b'));
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(25))$$) ~ '^42501', 'the zonal manager of another zone may not');
select tests.logout(); select tests.login_anon();
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(25))$$) ~ '^42501', 'not signed in: refused');

-- ---------------------------------------------------------------- what can be opened
select tests.logout(); select tests.login(tests.id('zonal_a'));
select tests.ok(tests.err($$select public.wf_window_save(null, tests.day(1), tests.day(17), tests.day(25))$$) ~ '^22023', 'a zone is needed');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), null, tests.day(17), tests.day(25))$$) ~ '^22023', 'both dates are needed');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(10), tests.day(5), tests.day(25))$$) ~ '^22023 .*first date is after', 'the first date must come first');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.pday(5), tests.day(5), tests.day(25))$$) ~ '^22023 .*one month at a time', 'one month at a time');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(22), tests.day(25))$$) ~ '^22023 .*dates that have come', 'a date that has not come cannot be opened');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(19), tests.day(25))$$) ~ '^22023 .*book''s days 1 to 17', 'only the book''s days 1-17');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), (tests.fm() - interval '3 months')::date, (tests.fm() - interval '3 months')::date + 4, tests.day(25))$$) ~ '^22023 .*two months back',
  'at most two months back');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(19))$$) ~ '^22023 .*today or later', 'the last day to give cannot be in the past');
select tests.ok(tests.err($$select public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(20) + 32)$$) ~ '^22023 .*31 days', 'at most 31 days ahead');
select tests.ok(tests.n_windows('zone_a') = 0, 'nothing was saved by the refused calls');

-- ---------------------------------------------------------------- the zonal manager opens days 1-17 for zone A until the 25th
insert into tests.ids values ('w1', public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(25), 'সাইট দেরিতে চালু হয়েছে'));
select tests.ok(tests.n_windows('zone_a', true) = 1 and tests.id('w1') is not null, 'one live window for zone A');
select tests.ok(public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(25), 'সাইট দেরিতে চালু হয়েছে') = tests.id('w1')
            and tests.n_windows('zone_a') = 1, 'the same setting twice changes nothing');
select tests.logout();
select tests.ok(tests.n_notes('u_a1', 'আগের তারিখের হাজিরা দিন') = 1 and tests.n_notes('u_a2', 'আগের তারিখের হাজিরা দিন') = 1
            and tests.n_notes('u_b1', 'আগের তারিখের হাজিরা দিন') = 0, 'the staff of zone A are told (once), zone B is not');
select tests.ok((select body from public.notifications where profile_id = tests.id('u_a1') and title = 'আগের তারিখের হাজিরা দিন') like '17 দিনের হাজিরা বাকি — ' || to_char(tests.day(25), 'DD/MM/YYYY') || '%',
  'the note says how many dates and until when');
select tests.ok((select count(*) from public.audit_logs where table_name = 'wf_book_windows') > 0, 'the window is in the audit log');
select tests.ok(tests.err($$delete from public.wf_book_windows$$) ~ '^P0001', 'a window can never be deleted');

-- what the zonal setting page reads
select tests.login(tests.id('zonal_a'));
select tests.ok(jsonb_array_length(public.wf_windows() -> 'zones') = 1 and (public.wf_windows() #>> '{zones,0,can_configure}')::boolean
            and public.wf_windows() #>> '{zones,0,id}' = tests.id('zone_a')::text, 'zonal A sees only zone A, and may set it');
select tests.ok(jsonb_array_length(public.wf_windows() -> 'rows') = 1 and public.wf_windows() #>> '{rows,0,state}' = 'open'
            and (public.wf_windows() #>> '{rows,0,people}')::integer = 2 and (public.wf_windows() #>> '{rows,0,people_left}')::integer = 2
            and (public.wf_windows() #>> '{rows,0,days_left}')::integer = 34 and public.wf_windows() #>> '{rows,0,by_name}' = 'Zonal A',
  'the window row: open, two people with 17 dates each still to give, who opened it');
select tests.ok(public.wf_windows() -> 'window' = '{"from_day": 1, "to_day": 17}' and (public.wf_windows() ->> 'earliest')::date = (tests.fm() - interval '2 months')::date
            and (public.wf_windows() ->> 'latest_until')::date = tests.day(20) + 31, 'the limits the form needs');
select tests.ok((select count(*) from public.wf_book_windows) = 1, 'zonal A reads zone A''s windows from the table');
select tests.login(tests.id('zonal_b'));
select tests.ok(jsonb_array_length(public.wf_windows() -> 'rows') = 0 and (select count(*) from public.wf_book_windows) = 0, 'zonal B sees nothing of zone A');
select tests.ok(tests.err($$select public.wf_windows(tests.id('zone_a'))$$) ~ '^42501', 'and may not ask for zone A');
select tests.login(tests.id('u_a1'));
select tests.ok(jsonb_array_length(public.wf_windows() -> 'zones') = 0 and (select count(*) from public.wf_book_windows) = 0, 'a staff member does not read the setting');
select tests.login(tests.id('admin'));
select tests.ok(jsonb_array_length(public.wf_windows() -> 'zones') = 2, 'a company-wide admin sees every zone');

-- ---------------------------------------------------------------- the staff of zone A may give the earlier dates now
select tests.login(tests.id('u_a1'));
select tests.ok((public.wf_my_book() ->> 'open')::boolean and (public.wf_my_book() #>> '{catch_up,open_until}')::date = tests.day(25)
            and (public.wf_my_book() #>> '{catch_up,date_to}')::date = tests.day(17) and public.wf_my_book() #>> '{catch_up,note}' = 'সাইট দেরিতে চালু হয়েছে',
  'zone A: the book is open again and says until when and why');
select tests.ok(tests.states() = repeat('m', 17) and (tests.bd(5) ->> 'can_give')::boolean and (public.wf_my_book() #>> '{summary,missing}')::integer = 17,
  'every date 1-17 is "missing" again and may be given');
select tests.ok((public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 17 and (public.wf_pending_counts() #>> '{mine,catch_up_until}')::date = tests.day(25)
            and not (public.wf_pending_counts() ->> 'open')::boolean, 'the alert counts the 17 dates; "open" still means today''s book');
insert into tests.ids values ('m3', public.wf_att_submit(tests.day(3), 'present'));
select tests.ok(tests.bd(3) ->> 'state' = 'waiting', 'one date the old way: it waits for the manager');
select tests.login(tests.id('u_b1'));
select tests.ok(not (public.wf_my_book() ->> 'open')::boolean and public.wf_my_book() -> 'catch_up' = 'null'::jsonb
            and tests.err($$select public.wf_att_submit(tests.day(5), 'present')$$) ~ '^22023 .*book is closed', 'zone B: still closed');

-- ---------------------------------------------------------------- many dates in one step
select tests.login(tests.id('u_a1'));
select tests.ok(tests.err($$select public.wf_book_fill()$$) ~ '^22023 .*at least one date', 'nothing chosen: refused');
select tests.ok(tests.err($$select public.wf_book_fill(array[tests.day(15)], jsonb_build_array(jsonb_build_object('ref', 'SF-1', 'applied_on', tests.day(15), 'dates', jsonb_build_array(tests.day(15)))))$$) ~ '^22023 .*chosen twice', 'one date in two places: refused');
select tests.ok(tests.err($$select public.wf_book_fill(null, null, array[tests.day(15)])$$) ~ '^22023 .*reason', 'absent without applying needs a reason');
select tests.ok(tests.err($$select public.wf_book_fill(array[tests.day(15), tests.day(21)])$$) ~ ('^22023 On ' || tests.day(21) || ': A future date'),
  'a date that has not come: the error names the date');
select tests.ok(tests.bd(15) ->> 'state' = 'missing', 'all or nothing: the good date of the refused call was not saved');
select tests.ok(public.wf_book_fill(array[tests.day(1), tests.day(2), tests.day(4), tests.day(5), tests.day(6), tests.day(7), tests.day(8), tests.day(9), tests.day(10)],
                                    jsonb_build_array(jsonb_build_object('ref', 'SF-2211', 'applied_on', tests.day(12), 'dates', jsonb_build_array(tests.day(11), tests.day(12)))),
                                    array[tests.day(13), tests.day(14)], 'জ্বর ছিল', 'Steadfast-এ আবেদন করা')
                  - 'application_id' = '{"present": 9, "site": 2, "absent": 2}'::jsonb, 'fill: 9 present, 2 applied on the Steadfast website, 2 in an application');
select tests.ok(tests.bd(11) ->> 'kind' = 'absent' and (tests.bd(11) ->> 'applied_on_site')::boolean and tests.bd(11) ->> 'note' = 'Steadfast-এ আবেদন করা'
            and tests.bd(11) ->> 'application_id' is null, 'a website date: absent, applied on the website, with the note');
select tests.ok(tests.bd(13) ->> 'application_no' like 'AB-%' and tests.bd(13) ->> 'application_no' = tests.bd(14) ->> 'application_no'
            and not (tests.bd(13) ->> 'applied_on_site')::boolean and jsonb_array_length(public.wf_my_book() -> 'applications') = 1,
  'the two not-applied dates are one application');
select tests.ok(tests.states() = repeat('w', 14) || 'mmm' and (public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 3,
  'fourteen dates wait for the manager, three are still to give');
select tests.ok(tests.err($$select public.wf_book_fill(array[tests.day(15), tests.day(13)])$$) ~ ('^23505 On ' || tests.day(13) || ': This date is already in an application'),
  'a date inside an application cannot be filled over (and the error names it)');
select tests.ok(tests.bd(15) ->> 'state' = 'missing', 'and the other date of that call was not saved either');
select tests.logout();
select tests.ok(tests.n_notes('hub_mgr', 'আগের তারিখের হাজিরা অনুমোদন বাকি') = 1
            and (select body from public.notifications where profile_id = tests.id('hub_mgr') and title = 'আগের তারিখের হাজিরা অনুমোদন বাকি') like '%11 দিনের হাজিরা একসাথে দিয়েছেন',
  'the hub manager gets one note for the eleven older dates');
select tests.ok(tests.n_notes('hub_mgr', 'অনুপস্থিতির আবেদন AB-%') = 1, 'and the application''s own note');
select tests.ok(tests.n_notes('hub_b_mgr', 'আগের তারিখের%') = 0 and tests.n_notes('hub_b_mgr', 'অনুপস্থিতির আবেদন%') = 0, 'the other zone''s manager hears nothing');

-- the second person fills the whole book at once
select tests.login(tests.id('u_a2'));
select tests.ok((public.wf_book_fill(array(select tests.day(i) from generate_series(1, 17) i)) ->> 'present')::integer = 17, 'all seventeen dates "present" in one step');
select tests.ok((public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 0 and tests.states() = repeat('w', 17), 'nothing is left to give');

-- ---------------------------------------------------------------- the manager approves as always
select tests.login(tests.id('hub_mgr'));
select tests.ok((public.wf_hub_book(tests.id('hub_a1')) ->> 'open')::boolean and (public.wf_hub_book(tests.id('hub_a1')) #>> '{catch_up,open_until}')::date = tests.day(25),
  'the hub book shows the window too');
select tests.ok(public.wf_marks_decide(array[tests.mark_of('ea1', tests.day(1)), tests.mark_of('ea1', tests.day(11))], true, null, null) = 2, 'the hub manager approves two dates');
select tests.ok((select status from public.attendance_records where employee_id = tests.id('ea1') and work_date = tests.day(1)) = 'present'
            and (select status from public.attendance_records where employee_id = tests.id('ea1') and work_date = tests.day(11)) = 'absent',
  'they are on the register: present, and absent for the website date');
select tests.login(tests.id('u_a1'));
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(1), 'absent', true, null, tests.day(1), 'SF-1')$$) ~ '^23505', 'an approved date stays as it is');

-- ---------------------------------------------------------------- the daily reminder while a window is open
select tests.logout();
-- the business clock is two months back, so "already told today" is measured against it: move earlier notes before that day
update public.notifications set created_at = (tests.day(20) - 3)::timestamp at time zone 'Asia/Dhaka' where kind = 'workforce';
select tests.ok(private.wf_remind() >= 1, 'reminders run');
select tests.ok(tests.n_notes('u_a1', 'আগের তারিখের হাজিরা বাকি') = 1
            and (select body from public.notifications where profile_id = tests.id('u_a1') and title = 'আগের তারিখের হাজিরা বাকি') like '3 দিনের হাজিরা এখনো দেওয়া হয়নি — ' || to_char(tests.day(25), 'DD/MM/YYYY') || '%',
  'u_a1 (three dates left) is reminded, with the last day');
select tests.ok(tests.n_notes('u_a2', 'আগের তারিখের হাজিরা বাকি') = 0 and tests.n_notes('u_b1', 'আগের তারিখের হাজিরা বাকি') = 0, 'who gave everything, or is in another zone, is not');
select private.wf_remind();
select tests.ok(tests.n_notes('u_a1', 'আগের তারিখের হাজিরা বাকি') = 1, 'once a day only');

-- ---------------------------------------------------------------- the month before, and changing a window
select tests.login(tests.id('zonal_a'));
insert into tests.ids values ('w0', public.wf_window_save(tests.id('zone_a'), tests.pday(1), tests.pday(17), tests.day(25)));
select tests.login(tests.id('u_a1'));
select tests.ok(public.wf_my_book() -> 'months' ? (tests.fm() - interval '1 month')::date::text and (public.wf_my_book(tests.pday(1)) ->> 'open')::boolean
            and tests.states(tests.pday(1)) = repeat('m', 17), 'the month before: in the month list, open, every date to give');
select tests.ok(public.wf_my_book() -> 'open_months' = jsonb_build_array(tests.fm(), (tests.fm() - interval '1 month')::date), 'open_months: both open months, newest first');
select tests.ok(public.wf_att_submit(tests.pday(2), 'present') is not null, 'a date of the month before can be given');
select tests.ok((public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 3 + 16, 'the alert counts the dates of both months');
select tests.login(tests.id('zonal_a'));
insert into tests.ids values ('w2', public.wf_window_save(tests.id('zone_a'), tests.day(1), tests.day(17), tests.day(28), 'আরও তিন দিন'));
select tests.ok(tests.id('w2') <> tests.id('w1') and tests.n_windows('zone_a', true) = 2 and tests.n_windows('zone_a') = 3
            and (select end_note from public.wf_book_windows where id = tests.id('w1')) = 'নতুন সেটিং দিয়ে বদলানো হয়েছে',
  'a new setting for the same month replaces the old one, which stays as history');
select tests.ok(jsonb_array_length(public.wf_windows() -> 'rows') = 3 and public.wf_windows() #>> '{rows,0,state}' = 'open' and public.wf_windows() #>> '{rows,1,state}' = 'open'
            and public.wf_windows() #>> '{rows,2,state}' = 'ended' and public.wf_windows() #>> '{rows,2,id}' = tests.id('w1')::text,
  'the page lists the open ones first, then the history');

-- ---------------------------------------------------------------- closing early, and the last day passing
select tests.login(tests.id('zonal_b'));
select tests.ok(tests.err($$select public.wf_window_end(tests.id('w2'))$$) ~ '^42501', 'another zone''s manager cannot close it');
select tests.login(tests.id('zonal_a'));
select public.wf_window_end(tests.id('w2'), 'সবাই দিয়ে দিয়েছেন');
select public.wf_window_end(tests.id('w2'));
select tests.ok((select end_note from public.wf_book_windows where id = tests.id('w2')) = 'সবাই দিয়ে দিয়েছেন', 'closed early with a note (closing twice is harmless)');
select tests.login(tests.id('u_a1'));
select tests.ok(not (public.wf_my_book() ->> 'open')::boolean and tests.states() = 'a' || repeat('w', 9) || 'a' || 'www' || 'ccc'
            and tests.err($$select public.wf_att_submit(tests.day(16), 'present')$$) ~ '^22023 .*book is closed', 'this month is closed again; what was given stays');
select tests.ok((public.wf_pending_counts() #>> '{mine,catch_up_until}')::date = tests.day(25) and (public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 16,
  'the month before is still open until the 25th');
select tests.logout(); select tests.set_today(26); select tests.login(tests.id('u_a1'));
select tests.ok(not (public.wf_my_book(tests.pday(1)) ->> 'open')::boolean and tests.err($$select public.wf_att_submit(tests.pday(3), 'present')$$) ~ '^22023 .*book is closed'
            and (public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 0 and public.wf_pending_counts() #> '{mine,catch_up_until}' = 'null'::jsonb,
  'after the last day the window closes by itself');
select tests.login(tests.id('zonal_a'));
select tests.ok((select r ->> 'state' from jsonb_array_elements(public.wf_windows() -> 'rows') r where r ->> 'id' = tests.id('w0')::text) = 'expired'
            and (select r ->> 'state' from jsonb_array_elements(public.wf_windows() -> 'rows') r where r ->> 'id' = tests.id('w2')::text) = 'ended'
            and not exists (select 1 from jsonb_array_elements(public.wf_windows() -> 'rows') r where r ->> 'state' = 'open'),
  'the page shows the passed one as expired, the closed one as ended');

-- ---------------------------------------------------------------- the old rule is untouched
select tests.logout(); select tests.set_today(10); select tests.login(tests.id('u_b1'));
select tests.ok((public.wf_my_book() ->> 'open')::boolean and public.wf_att_submit(tests.day(5), 'present') is not null
            and tests.err($$select public.wf_att_submit(tests.pday(5), 'present')$$) ~ '^22023 .*book is closed',
  'day 10 without a window: this month open as always, the month before closed');
select tests.logout();
rollback;
