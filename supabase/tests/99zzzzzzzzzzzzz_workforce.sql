-- My Workforce & Attendance: the monthly attendance book (days 1-17), absence applications, the four daily numbers,
-- the manager and zonal panels, scope, duplicates, history, reminders. Migration 20261117010000_workforce_attendance.sql.
-- The business clock is moved inside this transaction (private.wf_today reads a setting) to a month two months back,
-- so every date is in the past for the register's own "no future dates" rule and the window edges can be tested on any day.
begin;
select tests.fixture();
select tests.hr_fixture();

-- ---------------------------------------------------------------- test helpers (rolled back with the transaction)
create function tests.fm() returns date language sql stable as $$ select date_trunc('month', ((now() at time zone 'Asia/Dhaka')::date - 60))::date $$;
create function tests.day(n integer) returns date language sql stable as $$ select tests.fm() + (n - 1) $$;
create function tests.set_today(n integer) returns void language sql as $$ select set_config('tests.today', (tests.fm() + (n - 1))::text, true) $$;
create or replace function private.wf_today() returns date language sql stable as
  $$ select coalesce(nullif(current_setting('tests.today', true), ''), (now() at time zone 'Asia/Dhaka')::date::text)::date $$;
create function tests.keys(j jsonb, k text[]) returns boolean language sql immutable as
  $$ select j is not null and jsonb_typeof(j) = 'object' and not exists (select 1 from unnest(k) x where not (j ? x)) $$;
create function tests.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function tests.mark_of(p_emp text, p_day integer) returns uuid language sql stable security definer as
  $$ select id from public.attendance_self_marks where employee_id = tests.id(p_emp) and work_date = tests.day(p_day) $$;
create function tests.n_hist(p_mark uuid, p_action text default null) returns bigint language sql stable security definer as
  $$ select count(*) from public.wf_att_history where mark_id = p_mark and (p_action is null or action = p_action) $$;
create function tests.n_notes(p_user text, p_title text) returns bigint language sql stable security definer as
  $$ select count(*) from public.notifications where profile_id = tests.id(p_user) and title like p_title $$;
create function tests.bd(n integer) returns jsonb language sql stable as
  $$ select d from jsonb_array_elements(public.wf_my_book() -> 'days') d where (d ->> 'day')::integer = n $$;
create function tests.arr_sum(j jsonb, k text) returns numeric language sql immutable as
  $$ select coalesce(sum((x ->> k)::numeric), 0) from jsonb_array_elements(j) x $$;
select tests.set_today(10);

-- ---------------------------------------------------------------- people
insert into tests.ids values
  ('u_s2', tests.make_user('s2@test.local', 'Staff Two')), ('u_s3', tests.make_user('s3@test.local', 'Staff Three')),
  ('u_sb', tests.make_user('sb@test.local', 'Staff B')), ('u_nh', tests.make_user('nh@test.local', 'Office Staff')),
  ('u_s4', tests.make_user('s4@test.local', 'Staff Four')), ('mgr2', tests.make_user('mgr2@test.local', 'Second Manager')),
  ('u_old', tests.make_user('old@test.local', 'Leaver'));
insert into tests.ids values
  ('e1', tests.active_employee('Staff One',   '801', tests.id('hub_a1'), '01711000801', '8010101010', 15000, tests.id('rider_login'))),
  ('e2', tests.active_employee('Staff Two',   '802', tests.id('hub_a1'), '01711000802', '8020101010', 15000, tests.id('u_s2'))),
  ('e3', tests.active_employee('Staff Three', '803', tests.id('hub_a2'), '01711000803', '8030101010', 15000, tests.id('u_s3'))),
  ('eb', tests.active_employee('Staff B',     '804', tests.id('hub_b1'), '01711000804', '8040101010', 15000, tests.id('u_sb'))),
  ('enh', tests.active_employee('Office Staff', '805', null,             '01711000805', '8050101010', 15000, tests.id('u_nh'))),
  ('e4', tests.active_employee('Staff Four',  '806', tests.id('hub_a1'), '01711000806', '8060101010', 15000, tests.id('u_s4'))),
  ('em', tests.active_employee('Hub A1 Mgr',  '807', tests.id('hub_a1'), '01711000807', '8070101010', 15000, tests.id('hub_mgr'))),
  ('eold', tests.active_employee('Leaver',    '808', tests.id('hub_a1'), '01711000808', '8080101010', 15000, tests.id('u_old')));
update public.employees set position_id = (select id from public.positions where code = 'HUBACC') where id = tests.id('em');
update public.employees set status = 'inactive' where id = tests.id('eold');
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_s2'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_s4'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_s3'), 'rider', 'hub', null, tests.id('hub_a2'));
select tests.grant_role(tests.id('u_sb'), 'rider', 'hub', null, tests.id('hub_b1'));
select tests.grant_role(tests.id('mgr2'), 'hub_manager', 'hub', null, tests.id('hub_a1'));

-- ---------------------------------------------------------------- settings and permissions
select tests.ok((select value::text from public.system_settings where key = 'workforce.book_from_day') = '1'
            and (select value::text from public.system_settings where key = 'workforce.book_to_day') = '17'
            and (select value::text from public.system_settings where key = 'workforce.ops_backdate_days') = '1', 'settings: book open on days 1 to 17, daily numbers one day back');
select tests.ok((select count(*) from public.permissions where code in ('ops.staff_daily.view', 'ops.staff_daily.edit') and module = 'ops') = 2, 'both new permissions exist');
select tests.ok((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id
                  where p.code = 'ops.staff_daily.view' and r.code in ('admin', 'head_office_manager', 'operations_manager', 'zonal_manager',
                    'hub_manager', 'pickup_manager', 'delivery_manager', 'auditor', 'hr_manager')) = 9
            and (select count(*) = 8 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id
                  where r.code = 'zonal_assistant' and p.code not in ('system.list_view.configure', 'system.list_mark.edit', 'system.list_tools.view')),
  'nine roles may view the daily numbers; the existing Zonal Assistant role keeps exactly its eight permissions');
select tests.ok((select array_agg(r.code::text order by r.code::text) from public.role_permissions rp join public.roles r on r.id = rp.role_id
                  join public.permissions p on p.id = rp.permission_id where p.code = 'ops.staff_daily.edit') = array['admin', 'hub_manager'],
  'only admin and hub manager may correct them (the zonal manager only reads)');
select tests.ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id
                             where p.code like 'ops.staff_daily.%' and r.code in ('rider', 'staff')), 'a rider or plain staff holds neither');

-- ---------------------------------------------------------------- the book: window, states, keys
select tests.login(tests.id('rider_login'));
select tests.ok(tests.keys(public.wf_my_book(), array['employee', 'month', 'today', 'window', 'open', 'days', 'summary', 'applications', 'months']), 'book: top level keys');
select tests.ok(tests.keys(public.wf_my_book() -> 'employee', array['id', 'code', 'name', 'position', 'hub_id', 'hub_name', 'zone_id', 'zone_name'])
            and public.wf_my_book() #>> '{employee,hub_name}' = 'Hub A1' and public.wf_my_book() #>> '{employee,zone_name}' = 'Zone A', 'book: the person with hub and zone');
select tests.ok(tests.keys(tests.bd(1), array['date', 'day', 'dow', 'state', 'kind', 'applied_on_site', 'note', 'mark_id', 'decided_as', 'decide_note', 'decided_by_name',
                  'record_status', 'application_id', 'application_no', 'application_status']), 'book: a day has every key');
select tests.ok(tests.keys(public.wf_my_book() -> 'summary', array['present', 'late', 'half_day', 'absent', 'leave', 'other', 'waiting', 'returned', 'missing', 'total_days'])
            and public.wf_my_book() -> 'window' = '{"from_day": 1, "to_day": 17}', 'book: summary keys and the window');
select tests.ok((public.wf_my_book() ->> 'open')::boolean and (public.wf_my_book() ->> 'today')::date = tests.day(10)
            and (public.wf_my_book() ->> 'month')::date = tests.fm(), 'book: the current month opens by itself and today is the Dhaka date');
select tests.ok(jsonb_array_length(public.wf_my_book() -> 'days') = 17 and public.wf_my_book() #>> '{days,0,date}' = tests.day(1)::text
            and public.wf_my_book() #>> '{days,16,date}' = tests.day(17)::text, 'book: the window is the 1st to the 17th, in order');
select tests.ok((select count(*) from jsonb_array_elements(public.wf_my_book() -> 'days') d where d ->> 'state' = 'missing') = 10
            and (select count(*) from jsonb_array_elements(public.wf_my_book() -> 'days') d where d ->> 'state' = 'future') = 7, 'book: days up to today are "missing", later ones "future"');
select tests.ok((public.wf_my_book() #>> '{summary,missing}')::integer = 10 and (public.wf_my_book() #>> '{summary,total_days}')::integer = 17, 'book: summary counts the missing days and all days');
select tests.ok(public.wf_my_book() -> 'months' ? tests.fm()::text and jsonb_typeof(public.wf_my_book() -> 'applications') = 'array'
            and jsonb_array_length(public.wf_my_book() -> 'applications') = 0, 'book: the archive picker always has the current month; no applications yet');
select tests.ok(jsonb_array_length(public.wf_my_book(tests.fm() - 40) -> 'days') = 17
            and (select bool_and(d ->> 'state' = 'closed') from jsonb_array_elements(public.wf_my_book(tests.fm() - 40) -> 'days') d)
            and not (public.wf_my_book(tests.fm() - 40) ->> 'open')::boolean, 'archive: a past month is read only (all closed when nothing was given)');
select tests.ok((select bool_and(d ->> 'state' = 'future') from jsonb_array_elements(public.wf_my_book(tests.fm() + 40) -> 'days') d), 'a month that has not come is all "future"');

-- ---------------------------------------------------------------- the window edge (day 17 open, day 18 closed) and the settings
select tests.login(tests.id('u_s4'));
select tests.logout(); select tests.set_today(17); select tests.login(tests.id('u_s4'));
select tests.ok((public.wf_my_book() ->> 'open')::boolean, 'day 17: the book is still open');
insert into tests.ids values ('m_edge', public.wf_att_submit(tests.day(17), 'present'));
select tests.ok((public.wf_pending_counts() ->> 'open')::boolean and (public.wf_pending_counts() #>> '{mine,waiting_days}')::integer = 1, 'day 17: the last day can be given');
select tests.logout(); select tests.set_today(18); select tests.login(tests.id('u_s4'));
select tests.ok(not (public.wf_my_book() ->> 'open')::boolean and not (public.wf_pending_counts() ->> 'open')::boolean, 'day 18: the book is closed');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(18), 'present')$$) ~ '^22023 .*book is closed', 'day 18: nothing can be given');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(16), 'present')$$) ~ '^22023 .*book is closed', 'day 18: not even an earlier date of the same month');
select tests.ok(tests.err($$select public.wf_absence_apply(array[tests.day(16)], 'কারণ')$$) ~ '^22023 .*book is closed', 'day 18: no application either');
-- + 3 from 20261125200000_workforce_review_queue (wf_ops_decide, wf_ops_resubmit, wf_review_return_mark)
select tests.ok((select count(*) filter (where d ->> 'state' = 'closed') from jsonb_array_elements(public.wf_my_book() -> 'days') d) = 16
            and tests.bd(17) ->> 'state' = 'waiting' and (public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 0,
  'day 18: what was given stays, the rest is closed and nobody is nagged');
select tests.logout(); select tests.set_today(10);
-- the first day of the window comes from the setting
update public.system_settings set value = '3' where key = 'workforce.book_from_day';
select tests.login(tests.id('u_s4'));
select tests.ok(jsonb_array_length(public.wf_my_book() -> 'days') = 15 and public.wf_my_book() #>> '{days,0,day}' = '3', 'setting book_from_day = 3: the window starts on the 3rd');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(2), 'present')$$) ~ '^22023 .*book is closed', 'a date before the first day is refused');
select tests.logout();
update public.system_settings set value = '12' where key = 'workforce.book_from_day';
update public.system_settings set value = '1' where key = 'workforce.book_from_day';
update public.system_settings set value = '12' where key = 'workforce.book_to_day';
select tests.login(tests.id('u_s4'));
select tests.ok(jsonb_array_length(public.wf_my_book() -> 'days') = 12 and (public.wf_my_book() ->> 'open')::boolean, 'setting book_to_day = 12: the window ends on the 12th');
select tests.logout();
update public.system_settings set value = '"abc"' where key = 'workforce.book_to_day';
select tests.login(tests.id('u_s4'));
select tests.ok(jsonb_array_length(public.wf_my_book() -> 'days') = 17, 'a garbage setting falls back to the default 17');
select tests.logout();
update public.system_settings set value = '17' where key = 'workforce.book_to_day';

-- ---------------------------------------------------------------- giving a date
select tests.login(tests.id('rider_login'));
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(12), 'present')$$) ~ '^22023 .*future', 'a future date of the window cannot be given');
select tests.ok(tests.err($$select public.wf_att_submit(tests.fm() + 40, 'present')$$) ~ '^22023 .*future', 'a date of next month is a future date');
select tests.ok(tests.err($$select public.wf_att_submit(tests.fm() - 5, 'present')$$) ~ '^22023 .*book is closed', 'a date of an earlier month is closed');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(10), 'late')$$) ~ '^22023', 'only present or absent can be given');
select tests.ok(tests.err($$select public.wf_att_submit(null, 'present')$$) ~ '^22023', 'a date is needed');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(10), 'absent')$$) ~ '^22023 .*website question', 'absent without the website answer is refused');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(10), 'absent', null, 'জ্বর')$$) ~ '^22023 .*website question', 'a note does not replace the website answer');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(10), 'absent', false, 'জ্বর')$$) ~ '^22023 .*needs an application', 'absent and "not applied" must go through an application');
insert into tests.ids values ('m1', public.wf_att_submit(tests.day(10), 'present'));
select tests.ok((select status = 'waiting' and via = 'book' and kind = 'present' and hub_id = tests.id('hub_a1') and zone_id = tests.id('zone_a')
                   and applied_on_site is null and application_id is null from public.attendance_self_marks where id = tests.id('m1')),
  'present: one waiting input of the book, with hub and zone filled in');
select tests.ok(tests.bd(10) ->> 'state' = 'waiting' and tests.bd(10) ->> 'kind' = 'present' and tests.bd(10) ->> 'mark_id' = tests.id('m1')::text, 'the book shows it as waiting');
select tests.ok(public.wf_att_submit(tests.day(10), 'present') = tests.id('m1')
            and (select count(*) from public.attendance_self_marks where employee_id = tests.id('e1') and work_date = tests.day(10)) = 1
            and tests.n_hist(tests.id('m1')) = 1, 'duplicate prevention: the same date twice is one input and one history line');
select tests.ok(public.wf_att_submit(tests.day(10), 'absent', true, null, tests.day(9), 'SF-1001') = tests.id('m1'), 'absent + "applied on the website" (with its date and number) is accepted for the same date');
select tests.ok((select kind = 'absent' and applied_on_site and note = 'ওয়েবসাইটে আবেদন করা আছে' and status = 'waiting' from public.attendance_self_marks where id = tests.id('m1')),
  'absent + "applied on the website": the answer is kept and the note defaults');
select tests.ok(tests.n_hist(tests.id('m1'), 'edited') = 1 and tests.bd(10) ->> 'applied_on_site' = 'true', 'a waiting input can be changed by the person, and it is in the history');
select public.wf_att_submit(tests.day(10), 'present');
select tests.ok(tests.n_hist(tests.id('m1'), 'edited') = 2 and (select applied_on_site is null from public.attendance_self_marks where id = tests.id('m1')),
  'changing back to present clears the website answer');
select tests.ok(tests.n_notes('hub_mgr', 'হাজিরা অনুমোদন বাকি%') = 2 and tests.n_notes('mgr2', 'হাজিরা অনুমোদন বাকি%') = 2,
  'today''s input tells the hub''s managers once (the second line is the day-17 input of the window test); edits and repeats do not ping again');
insert into tests.ids values ('m1b', public.wf_att_submit(tests.day(9), 'present'));
select tests.ok(tests.n_notes('hub_mgr', 'হাজিরা অনুমোদন বাকি%') = 2, 'an earlier date waits in the queue without another ping');

-- the hub manager approves; the person cannot touch an approved date any more
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.att_self_decide(array[tests.id('m1')], true, 'late', 'দেরিতে এসেছে') = 1, 'the manager approves it with the existing function');
select tests.ok((select status || '/' || source from public.attendance_records where employee_id = tests.id('e1') and work_date = tests.day(10)) = 'late/self', 'the existing approval writes the register');
select tests.login(tests.id('rider_login'));
select tests.ok(tests.bd(10) ->> 'state' = 'approved' and tests.bd(10) ->> 'decided_as' = 'late' and tests.bd(10) ->> 'record_status' = 'late'
            and tests.bd(10) ->> 'decided_by_name' = 'Hub A1 Mgr' and tests.bd(10) ->> 'decide_note' = 'দেরিতে এসেছে', 'the book shows who approved it and as what');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(10), 'present')$$) ~ '^23505 .*already approved', 'after approval the person cannot give it again');
select tests.ok(tests.err($$select public.wf_absence_apply(array[tests.day(10)], 'কারণ')$$) ~ '^23505 .*already approved', 'nor apply for it');
select tests.ok(tests.n_hist(tests.id('m1'), 'approved') = 1, 'the approval is in the history');

-- a date the manager wrote on the register by hand
select tests.login(tests.id('hub_mgr'));
insert into public.attendance_records (employee_id, work_date, status, source) values (tests.id('e2'), tests.day(5), 'present', 'manual');
select tests.login(tests.id('u_s2'));
select tests.ok(tests.bd(5) ->> 'state' = 'approved' and tests.bd(5) ->> 'record_status' = 'present' and tests.bd(5) ->> 'mark_id' is null and tests.bd(5) ->> 'kind' is null,
  'a register row written by the manager with no input is "approved"');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(5), 'present')$$) ~ '^23505 .*already on the register', 'a date already on the register cannot be given');
select tests.ok(tests.err($$select public.wf_absence_apply(array[tests.day(4), tests.day(5)], 'কারণ')$$) ~ '^23505 .*already on the register', 'nor applied for');
select tests.ok((select count(*) from public.wf_absence_applications where employee_id = tests.id('e2')) = 0, 'the refused application left nothing behind');
-- a waiting input and then the manager writes the register: the register wins on the book
select tests.login(tests.id('u_s4'));
insert into tests.ids values ('m4_6', public.wf_att_submit(tests.day(6), 'present'));
select tests.login(tests.id('hub_mgr'));
insert into public.attendance_records (employee_id, work_date, status, source) values (tests.id('e4'), tests.day(6), 'late', 'manual');
select tests.login(tests.id('u_s4'));
select tests.ok(tests.bd(6) ->> 'state' = 'approved' and tests.bd(6) ->> 'record_status' = 'late' and tests.err($$select public.wf_att_submit(tests.day(6), 'absent', true, null, tests.day(1), 'SF-1')$$) ~ '^23505 .*already on the register',
  'a register row beats a waiting input on the book');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.att_self_decide(array[tests.id('m4_6')], true, 'late') = 1, 'the waiting input is closed by the manager (who decides as late, like the register)');
select tests.ok((select status = 'approved' and decided_as = 'late' from public.attendance_self_marks where id = tests.id('m4_6'))
            and (select status from public.attendance_records where employee_id = tests.id('e4') and work_date = tests.day(6)) = 'late', 'closing that input leaves the register as the manager wrote it');

-- returned and given again
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.att_self_decide(array[tests.id('m1b')], false, null, 'আগের দিন আসেননি') = 1, 'the manager turns a date down with a reason');
select tests.login(tests.id('rider_login'));
select tests.ok(tests.bd(9) ->> 'state' = 'returned' and tests.bd(9) ->> 'decide_note' = 'আগের দিন আসেননি' and (public.wf_pending_counts() #>> '{mine,returned_days}')::integer = 1,
  'the person sees it as returned, with the reason, and it is counted');
select tests.ok(public.wf_att_submit(tests.day(9), 'present') = tests.id('m1b'), 'a returned date is given again on the same input');
select tests.ok(tests.bd(9) ->> 'state' = 'waiting' and tests.bd(9) ->> 'decide_note' is null
            and tests.n_hist(tests.id('m1b'), 'returned') = 1 and tests.n_hist(tests.id('m1b'), 'resubmitted') = 1, 'a returned date is given again (history: returned, resubmitted)');

-- ---------------------------------------------------------------- absence applications
select tests.login(tests.id('u_s2'));
select tests.ok(tests.err($$select public.wf_absence_apply(array[tests.day(2)], '   ')$$) ~ '^22023 .*reason', 'an application needs a reason');
select tests.ok(tests.err($$select public.wf_absence_apply(array[]::date[], 'জ্বর')$$) ~ '^22023', 'an application needs at least one date');
select tests.ok(tests.err($$select public.wf_absence_apply(array[tests.day(12)], 'জ্বর')$$) ~ '^22023 .*future', 'an application cannot name a future date');
insert into tests.ids values ('app1', public.wf_absence_apply(array[tests.day(4), tests.day(2), tests.day(3), tests.day(2)], 'জ্বর ও ডাক্তার'));
select tests.ok((select application_no ~ '^AB-[0-9]{5}$' and status = 'pending' and dates = array[tests.day(2), tests.day(3), tests.day(4)] and month = tests.fm()
                   and hub_id = tests.id('hub_a1') and zone_id = tests.id('zone_a') and reason = 'জ্বর ও ডাক্তার' from public.wf_absence_applications where id = tests.id('app1')),
  'application: AB-numbered, pending, sorted distinct dates, hub and zone');
select tests.ok((select count(*) = 3 and bool_and(kind = 'absent' and applied_on_site = false and application_id = tests.id('app1') and status = 'waiting' and via = 'book')
                   from public.attendance_self_marks where employee_id = tests.id('e2') and work_date in (tests.day(2), tests.day(3), tests.day(4))),
  'one waiting input per date, linked to the application');
select tests.ok(tests.bd(3) ->> 'state' = 'waiting' and tests.bd(3) ->> 'application_status' = 'pending' and tests.bd(3) ->> 'application_no' = (select application_no from public.wf_absence_applications where id = tests.id('app1')),
  'the book shows the application number and its status on each date');
select tests.ok(tests.keys(public.wf_my_book() -> 'applications' -> 0, array['id', 'application_no', 'employee_id', 'employee_code', 'employee_name', 'hub_id', 'hub_name', 'zone_id', 'zone_name',
                  'month', 'dates', 'reason', 'status', 'created_at', 'decided_at', 'decided_by_name', 'decision_note', 'cancelled_at'])
            and public.wf_my_book() #>> '{applications,0,dates,0}' = tests.day(2)::text, 'the person''s own application list has every key');
select tests.ok(tests.n_notes('hub_mgr', 'অনুপস্থিতির আবেদন AB-%') = 1 and tests.n_notes('mgr2', 'অনুপস্থিতির আবেদন AB-%') = 1, 'one notification to each hub manager for the application');
select tests.ok(tests.err($$select public.wf_absence_apply(array[tests.day(3), tests.day(1)], 'আবার')$$) ~ '^23505 .*already in an application', 'a date that is in an application cannot be in another');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(3), 'present')$$) ~ '^23505 .*already in an application', 'nor given on its own');
select tests.ok(tests.err(format($$select public.wf_absence_cancel(%L)$$, tests.id('app1'))) is null, 'the owner withdraws a pending application');
select tests.ok((select status = 'cancelled' and cancelled_at is not null from public.wf_absence_applications where id = tests.id('app1'))
            and (select count(*) = 3 and bool_and(status = 'rejected' and decide_note = 'আবেদন তুলে নেওয়া হয়েছে') from public.attendance_self_marks where application_id = tests.id('app1'))
            and tests.n_hist(tests.mark_of('e2', 3), 'cancelled') = 1, 'its waiting inputs are closed with a note and the history says withdrawn');
select tests.ok(tests.bd(3) ->> 'state' = 'missing' and tests.bd(3) ->> 'application_status' = 'cancelled' and tests.bd(3) ->> 'kind' is null
            and (public.wf_pending_counts() #>> '{mine,returned_days}')::integer = 0, 'a withdrawn date is open again (missing), not "returned"');
select tests.ok(tests.err(format($$select public.wf_absence_cancel(%L)$$, tests.id('app1'))) ~ '^22023 .*pending', 'a withdrawn application cannot be withdrawn again');
select tests.login(tests.id('rider_login'));
select tests.ok(tests.err(format($$select public.wf_absence_cancel(%L)$$, tests.id('app1'))) ~ '^42501 .*may not', 'nobody else can withdraw it');
select tests.login(tests.id('u_s2'));
insert into tests.ids values ('app2', public.wf_absence_apply(array[tests.day(2), tests.day(3)], 'ফের আবেদন'));
select tests.ok((select application_no from public.wf_absence_applications where id = tests.id('app2')) > (select application_no from public.wf_absence_applications where id = tests.id('app1'))
            and tests.n_hist(tests.mark_of('e2', 3), 'resubmitted') = 1 and tests.bd(2) ->> 'state' = 'waiting', 'a withdrawn date can be applied for again (new number, history: resubmitted)');

-- who may decide
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.err(format($$select public.wf_absence_decide(%L, true)$$, tests.id('app2'))) ~ '^42501 .*may not', 'another hub''s manager cannot decide it');
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.err(format($$select public.wf_absence_decide(%L, true)$$, tests.id('app2'))) ~ '^42501 .*may not', 'the zonal manager only reads (no approval right)');
select tests.login(tests.id('rider_login'));
select tests.ok(tests.err(format($$select public.wf_absence_decide(%L, true)$$, tests.id('app2'))) ~ '^42501 .*may not', 'a colleague cannot decide it');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err(format($$select public.wf_absence_decide(%L, false)$$, tests.id('app2'))) ~ '^22023 .*turned down', 'turning down needs a reason');
select tests.ok(public.wf_absence_decide(tests.id('app2'), true, 'ঠিক আছে') = 2, 'the hub manager approves both dates in one tap');
select tests.ok((select status = 'approved' and decided_at is not null and decision_note = 'ঠিক আছে' and decided_by = tests.id('hub_mgr') from public.wf_absence_applications where id = tests.id('app2'))
            and (select count(*) = 2 and bool_and(status = 'absent' and source = 'self') from public.attendance_records where employee_id = tests.id('e2') and work_date in (tests.day(2), tests.day(3))),
  'tracking: approved with who, when and the note; the register has the absent days');
select tests.ok(tests.err(format($$select public.wf_absence_decide(%L, true)$$, tests.id('app2'))) ~ '^P0001 .*already settled', 'a settled application cannot be decided again');
select tests.login(tests.id('u_s2'));
select tests.ok(tests.bd(2) ->> 'state' = 'approved' and tests.bd(2) ->> 'application_status' = 'approved' and tests.bd(2) ->> 'record_status' = 'absent'
            and public.wf_my_book() #>> '{applications,0,decided_by_name}' = 'Hub A1 Mgr', 'the person sees the decision on the date and on the application');
-- turned down
insert into tests.ids values ('app3', public.wf_absence_apply(array[tests.day(6), tests.day(7)], 'ঘরে কাজ'));
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.wf_absence_decide(tests.id('app3'), false, 'কাগজ দিন') = 2, 'the manager turns the application down');
select tests.ok((select status = 'rejected' and decision_note = 'কাগজ দিন' from public.wf_absence_applications where id = tests.id('app3'))
            and (select count(*) = 2 and bool_and(status = 'rejected' and decide_note = 'কাগজ দিন') from public.attendance_self_marks where application_id = tests.id('app3'))
            and not exists (select 1 from public.attendance_records where employee_id = tests.id('e2') and work_date in (tests.day(6), tests.day(7))), 'turned down: the application and its dates are rejected, nothing on the register');
select tests.login(tests.id('u_s2'));
select tests.ok(tests.bd(6) ->> 'state' = 'returned' and tests.bd(6) ->> 'application_status' = 'rejected' and (public.wf_pending_counts() #>> '{mine,returned_days}')::integer = 2, 'the person sees both dates as returned');
insert into tests.ids values ('app4', public.wf_absence_apply(array[tests.day(6)], 'কাগজ জমা দিলাম'));
select tests.ok(tests.bd(6) ->> 'state' = 'waiting' and tests.bd(6) ->> 'application_id' = tests.id('app4')::text and tests.n_hist(tests.mark_of('e2', 6), 'resubmitted') = 1
            and (select status from public.wf_absence_applications where id = tests.id('app3')) = 'rejected', 'after a turn-down the same date can be applied for again; the old application stays as it was');

-- the application follows its dates when the manager uses the old list one date at a time
select tests.login(tests.id('u_s4'));
insert into tests.ids values ('app5', public.wf_absence_apply(array[tests.day(1), tests.day(2), tests.day(3)], 'বাড়ি গিয়েছিলাম'));
select tests.login(tests.id('hub_mgr'));
select public.att_self_decide(array[tests.mark_of('e4', 1)], true, 'absent');
select tests.ok((select status from public.wf_absence_applications where id = tests.id('app5')) = 'pending', 'one date decided: the application still waits for the others');
select public.att_self_decide(array[tests.mark_of('e4', 2), tests.mark_of('e4', 3)], true, 'absent');
select tests.ok((select status = 'approved' and decided_by = tests.id('hub_mgr') and decided_at is not null from public.wf_absence_applications where id = tests.id('app5')), 'every date decided: the application is approved');
select tests.login(tests.id('u_s4'));
insert into tests.ids values ('app6', public.wf_absence_apply(array[tests.day(4), tests.day(5)], 'দুই দিন'));
select tests.login(tests.id('hub_mgr'));
select public.att_self_decide(array[tests.mark_of('e4', 4)], false, null, 'এই দিন অফিস ছিল');
select public.att_self_decide(array[tests.mark_of('e4', 5)], true, 'absent');
select tests.ok((select status = 'approved' from public.wf_absence_applications where id = tests.id('app6')), 'one date approved and one turned down: the application counts as approved');
select tests.login(tests.id('u_s4'));
select tests.ok(tests.bd(4) ->> 'state' = 'returned' and tests.bd(4) ->> 'decide_note' = 'এই দিন অফিস ছিল', 'the turned-down date is returned to the person');

-- nobody approves their own
select tests.login(tests.id('hub_mgr'));
insert into tests.ids values ('mm10', public.wf_att_submit(tests.day(10), 'present'));
insert into tests.ids values ('app7', public.wf_absence_apply(array[tests.day(3)], 'নিজের কারণ'));
select tests.ok(tests.err(format($$select public.att_self_decide(array[%L::uuid], true)$$, tests.id('mm10'))) ~ '^42501 .*Your own attendance', 'a manager cannot approve their own input');
select tests.ok(tests.err(format($$select public.wf_absence_decide(%L, true)$$, tests.id('app7'))) ~ '^42501 .*Your own attendance', 'nor their own application');
select tests.login(tests.id('mgr2'));
select tests.ok(public.wf_absence_decide(tests.id('app7'), true) = 1 and public.att_self_decide(array[tests.id('mm10')], true) = 1, 'another manager of the hub decides them');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'absent', 'নিজেরটা')$$, tests.id('mm10'))) ~ '^42501 .*Your own attendance', 'nor correct their own attendance');

-- ---------------------------------------------------------------- correction by the manager, and its history
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'absent', '  ')$$, tests.id('m1'))) ~ '^22023 .*correction note', 'a correction needs a note');
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'absent', 'কারণ')$$, tests.id('m1b'))) ~ '^22023 .*approved', 'only an approved input is corrected (a waiting one is approved or returned)');
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'late', 'কারণ')$$, tests.id('m1'))) ~ '^22023 .*Nothing to correct', 'correcting to the same status is refused');
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'on_leave', 'কারণ')$$, tests.id('m1'))) ~ '^22023', 'only the four register answers are allowed');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'absent', 'কারণ')$$, tests.id('m1'))) ~ '^42501 .*may not', 'another hub''s manager cannot correct');
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'absent', 'কারণ')$$, tests.id('m1'))) ~ '^42501 .*may not', 'the zonal manager cannot correct (view only)');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err(format($$select public.wf_att_correct(%L, 'absent', 'ভুল তথ্য ছিল')$$, tests.id('m1'))) is null, 'the hub manager corrects an approved date with a note');
select tests.ok((select status = 'absent' and check_in is null and note = 'ভুল তথ্য ছিল' from public.attendance_records where employee_id = tests.id('e1') and work_date = tests.day(10))
            and (select decided_as = 'absent' and decide_note = 'ভুল তথ্য ছিল' and status = 'approved' from public.attendance_self_marks where id = tests.id('m1')), 'the register and the input both show the correction');
select tests.ok((select count(*) = 1 and bool_and(from_as = 'late' and to_as = 'absent' and note = 'ভুল তথ্য ছিল' and to_status = 'approved') from public.wf_att_history
                  where mark_id = tests.id('m1') and action = 'corrected'), 'correction history: from, to and the note');
select tests.ok(tests.n_notes('rider_login', 'হাজিরা সংশোধন হয়েছে%') = 1, 'the person is told about the correction');
select tests.ok(tests.keys(public.wf_att_history(null, tests.id('hub_a1'), null, tests.fm()) -> 0, array['id', 'mark_id', 'employee_id', 'employee_code', 'employee_name', 'hub_id', 'hub_name',
                  'work_date', 'action', 'from_kind', 'to_kind', 'from_status', 'to_status', 'from_as', 'to_as', 'note', 'by_name', 'at'])
            and public.wf_att_history(null, tests.id('hub_a1'), null, tests.fm()) #>> '{0,action}' = 'corrected' and public.wf_att_history(null, tests.id('hub_a1'), null, tests.fm()) #>> '{0,by_name}' = 'Hub A1 Mgr',
  'the history reads newest first, with keys and who did it');
select tests.ok(jsonb_array_length(public.wf_att_history(null, null, tests.id('e1'))) = (select count(*) from public.wf_att_history where employee_id = tests.id('e1'))
            and jsonb_array_length(public.wf_att_history(null, null, tests.id('e1'), tests.fm(), 2)) = 2, 'by person, month and limit');
select tests.login(tests.id('rider_login'));
select tests.ok(jsonb_array_length(public.wf_att_history(null, null, tests.id('e1'))) >= 4, 'a staff member reads their own history');
select tests.ok(tests.err(format($$select public.wf_att_history(null, null, %L)$$, tests.id('e2'))) ~ '^42501', 'but not a colleague''s');
select tests.ok(jsonb_array_length(public.wf_att_history()) = 0, 'a staff member with no manager right sees no hub history');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(public.wf_att_history() = '[]'::jsonb and tests.err(format($$select public.wf_att_history(null, %L)$$, tests.id('hub_a1'))) ~ '^42501', 'another hub''s manager sees none of it');
select tests.logout();
select tests.ok(tests.err($$update public.wf_att_history set note = 'x'$$) ~ '^P0001', 'history can never be changed');
select tests.ok(tests.err($$delete from public.wf_att_history$$) ~ '^P0001', 'nor removed');

-- ---------------------------------------------------------------- the old one-tap path keeps working with the new columns
select tests.login(tests.id('u_s3'));
select tests.ok(public.att_self_mark('present') is not null, 'att_self_mark (today, one tap) still works');
select tests.logout();
select tests.ok((select via = 'today' and zone_id = tests.id('zone_a') and application_id is null and applied_on_site is null and status = 'waiting' from public.attendance_self_marks where employee_id = tests.id('e3')),
  'it writes via = today and the zone follows the hub');
select tests.ok((select count(*) = 1 and bool_and(action = 'submitted') from public.wf_att_history where employee_id = tests.id('e3')), 'and it is in the history too');
select tests.login(tests.id('admin'));
select tests.ok(public.att_self_decide(array(select id from public.attendance_self_marks where employee_id = tests.id('e3')), true, 'present') = 1, 'att_self_decide is untouched and approves it');
select tests.logout();
select tests.ok((select count(*) = 1 from public.wf_att_history where employee_id = tests.id('e3') and action = 'approved'), 'the approval is in the history');
-- a date that sits in a pending application cannot be taken over by the one-tap path
insert into public.wf_absence_applications (id, application_no, employee_id, hub_id, zone_id, month, dates, reason)
  values (gen_random_uuid(), 'AB-99998', tests.id('eb'), tests.id('hub_b1'), tests.id('zone_b'), date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)::date,
          array[(now() at time zone 'Asia/Dhaka')::date], 'পরীক্ষা');
insert into public.attendance_self_marks (employee_id, hub_id, work_date, kind, note, applied_on_site, application_id, via)
  select tests.id('eb'), tests.id('hub_b1'), (now() at time zone 'Asia/Dhaka')::date, 'absent', 'পরীক্ষা', false, id, 'book' from public.wf_absence_applications where application_no = 'AB-99998';
select tests.login(tests.id('u_sb'));
select tests.ok(tests.err($$select public.att_self_mark('present')$$) ~ '^23505 .*already in an application', 'the one-tap path cannot take over a date of a pending application');
select tests.logout();
update public.attendance_self_marks set status = 'rejected', decide_note = 'ফেরত' where employee_id = tests.id('eb');
select tests.ok((select status from public.wf_absence_applications where application_no = 'AB-99998') = 'rejected', 'a date turned down through any path settles its application');
select tests.login(tests.id('u_sb'));
select tests.ok(public.att_self_mark('present') is not null, 'after the turn-down the one-tap path gives the date again');
select tests.logout();
select tests.ok((select via = 'today' and application_id is null and applied_on_site is null and status = 'waiting' and kind = 'present' from public.attendance_self_marks where employee_id = tests.id('eb')), 'and it resets the book columns (via = today, no application)');

-- ---------------------------------------------------------------- the four daily numbers
select tests.login(tests.id('rider_login'));
select tests.ok(tests.keys(public.wf_ops_mine(), array['today', 'backdate_days', 'entry', 'recent', 'hint']) and public.wf_ops_mine() ->> 'entry' is null
            and public.wf_ops_mine() -> 'recent' = '[]'::jsonb and public.wf_ops_mine() ->> 'hint' is null and (public.wf_ops_mine() ->> 'backdate_days')::integer = 1, 'ops: nothing yet, nothing to hint');
select tests.ok(tests.err($$select public.wf_ops_submit(-1, 0, 0, 0)$$) ~ '^22023 .*numbers must be', 'a negative number is refused');
select tests.ok(tests.err($$select public.wf_ops_submit(0, 0, 100001, 0)$$) ~ '^22023 .*numbers must be', 'a number above 100000 is refused');
select tests.ok(tests.err($$select public.wf_ops_submit(1, 1, 1, 1, null, tests.day(11))$$) ~ '^22023 .*future', 'a future day is refused');
select tests.ok(tests.err($$select public.wf_ops_submit(1, 1, 1, 1, null, tests.day(8))$$) ~ '^42501 .*may not', 'two days back is refused (one day back is allowed)');
insert into tests.ids values ('o1', ((public.wf_ops_submit(40, 3, 55, 6, 'ভালো দিন')) ->> 'id')::uuid);
select tests.ok(tests.keys(public.wf_ops_submit(40, 3, 55, 6, 'ভালো দিন'), array['id', 'employee_id', 'employee_code', 'employee_name', 'position', 'hub_id', 'hub_name', 'zone_id', 'zone_name',
                  'work_date', 'pickup', 'pickup_return', 'delivery', 'delivery_return', 'note', 'revision', 'submitted_at', 'updated_at']), 'ops: the saved row comes back with every key');
select tests.ok((select (pickup, pickup_return, delivery, delivery_return, revision, hub_id, zone_id, work_date) = (40, 3, 55, 6, 1, tests.id('hub_a1'), tests.id('zone_a'), tests.day(10))
                   from public.wf_daily_ops where id = tests.id('o1')), 'ops: stored by date, person, hub and zone');
select tests.ok((select count(*) from public.wf_daily_ops where employee_id = tests.id('e1')) = 1 and (select revision from public.wf_daily_ops where id = tests.id('o1')) = 1
            and (select count(*) from public.wf_ops_history where entry_id = tests.id('o1')) = 1, 'ops: the same numbers twice are one row, revision 1, one history line');
select tests.ok((public.wf_ops_submit(42, 3, 55, 6, 'ভালো দিন') ->> 'revision')::integer = 2, 'ops: a change is revision 2');
select tests.ok((select count(*) from public.wf_ops_history where entry_id = tests.id('o1')) = 2
            and (select from_vals ->> 'pickup' = '40' and to_vals ->> 'pickup' = '42' and action = 'edited' from public.wf_ops_history where entry_id = tests.id('o1') and revision = 2),
  'ops: a change is revision 2 and the history keeps the old and new numbers');
insert into tests.ids values ('o1y', ((public.wf_ops_submit(10, 0, 20, 1, null, tests.day(9))) ->> 'id')::uuid);
select tests.ok((select work_date = tests.day(9) and revision = 1 from public.wf_daily_ops where id = tests.id('o1y')), 'ops: yesterday can still be filled');
select tests.ok(public.wf_ops_mine() #>> '{entry,id}' = tests.id('o1')::text and public.wf_ops_mine() #>> '{recent,0,id}' = tests.id('o1y')::text
            and jsonb_array_length(public.wf_ops_mine() -> 'recent') = 1 and (public.wf_ops_mine() #>> '{entry,pickup}')::integer = 42, 'ops: today''s entry and the recent days');
select tests.logout();
update public.system_settings set value = '0' where key = 'workforce.ops_backdate_days';
select tests.login(tests.id('rider_login'));
select tests.ok(tests.err($$select public.wf_ops_submit(1, 1, 1, 1, null, tests.day(9))$$) ~ '^42501', 'setting ops_backdate_days = 0: only today');
select tests.logout();
update public.system_settings set value = '3' where key = 'workforce.ops_backdate_days';
select tests.login(tests.id('rider_login'));
select tests.ok(public.wf_ops_submit(1, 1, 1, 1, null, tests.day(7)) is not null and tests.err($$select public.wf_ops_submit(1, 1, 1, 1, null, tests.day(6))$$) ~ '^42501', 'setting ops_backdate_days = 3: three days back, not four');
select tests.logout();
update public.system_settings set value = '1' where key = 'workforce.ops_backdate_days';
-- the hint: what the person already sent to the manager's sheet (read only)
insert into public.da_sessions (hub_id, zone_id, account_date, started_by) values (tests.id('hub_a1'), tests.id('zone_a'), tests.day(10), tests.id('hub_mgr'));
insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, rider_name, delivery_qty, pickup_qty)
  select id, tests.id('hub_a1'), tests.id('zone_a'), tests.id('e1'), 'Staff One', 12, 4 from public.da_sessions where hub_id = tests.id('hub_a1') and account_date = tests.day(10);
select tests.login(tests.id('rider_login'));
select tests.ok(public.wf_ops_mine() -> 'hint' = '{"pickup": 4, "delivery": 12, "lines": 1}'::jsonb, 'the hint is the person''s own line on the hub sheet, never copied');
-- an employee without a hub
select tests.login(tests.id('u_nh'));
insert into tests.ids values ('onh', ((public.wf_ops_submit(5, 0, 9, 0)) ->> 'id')::uuid);
select tests.ok((select hub_id is null and zone_id is null from public.wf_daily_ops where id = tests.id('onh')), 'an employee without a hub can submit; hub and zone stay empty');
select tests.ok(public.wf_ops_mine() ->> 'hint' is null, 'and has no hint');
-- other staff
select tests.login(tests.id('u_s2'));
insert into tests.ids values ('o2y', ((public.wf_ops_submit(7, 1, 8, 0, null, tests.day(9))) ->> 'id')::uuid);
select tests.login(tests.id('u_s3'));
insert into tests.ids values ('o3', ((public.wf_ops_submit(11, 0, 12, 2)) ->> 'id')::uuid);
select tests.login(tests.id('u_sb'));
insert into tests.ids values ('ob', ((public.wf_ops_submit(1, 1, 1, 1)) ->> 'id')::uuid);
select tests.login(tests.id('noroles'));
select tests.ok(public.wf_ops_mine() is null and public.wf_my_book() is null and tests.err($$select public.wf_ops_submit(1, 1, 1, 1)$$) ~ '^42501 .*No active staff profile'
            and tests.err($$select public.wf_att_submit(tests.day(10), 'present')$$) ~ '^42501 .*No active staff profile', 'a login without a staff profile gets nothing and a polite refusal');
select tests.login(tests.id('u_old'));
select tests.ok(public.wf_my_book() is null and tests.err($$select public.wf_att_submit(tests.day(10), 'present')$$) ~ '^42501 .*No active staff profile', 'an inactive employee cannot give attendance');
select tests.logout();

-- ---------------------------------------------------------------- manager: the numbers
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.keys(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)), array['from', 'to', 'today', 'can_edit', 'rows', 'totals', 'by_person', 'by_day', 'missing_today'])
            and tests.keys(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'rows' -> 0, array['id', 'employee_name', 'work_date', 'pickup', 'revision', 'hub_name'])
            and tests.keys(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'totals', array['pickup', 'pickup_return', 'delivery', 'delivery_return', 'entries', 'people'])
            and tests.keys(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'by_person' -> 0, array['employee_id', 'code', 'name', 'position', 'hub_id', 'hub_name', 'days', 'pickup', 'pickup_return', 'delivery', 'delivery_return'])
            and tests.keys(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'by_day' -> 0, array['date', 'people', 'pickup', 'pickup_return', 'delivery', 'delivery_return'])
            and tests.keys(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'missing_today' -> 0, array['employee_id', 'code', 'name', 'position', 'hub_id', 'hub_name', 'mobile']),
  'ops report: keys of the report, rows, totals, by person, by day and missing');
select tests.ok((public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) #>> '{totals,entries}')::integer = 4
            and (public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) #>> '{totals,people}')::integer = 2
            and (public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) #>> '{totals,pickup}')::integer = 42 + 10 + 1 + 7
            and jsonb_array_length(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'rows') = 4,
  'ops report: the hub''s own entries only (no other hub, no hub-less staff) and the totals add up');
select tests.ok(tests.arr_sum(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'by_person', 'delivery') = (public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) #>> '{totals,delivery}')::numeric
            and tests.arr_sum(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 'by_day', 'pickup_return') = (public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) #>> '{totals,pickup_return}')::numeric
            and public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) #>> '{by_day,0,date}' = tests.day(10)::text, 'ops report: by person and by day add up to the totals; newest day first');
select tests.ok(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) ->> 'rows_total' = '4' and public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) ->> 'truncated' = 'false',
  'ops report: says how many entries there are and whether the list was cut');
select tests.ok((public.wf_ops_report(null, tests.id('hub_a1'), tests.day(10), tests.day(10)) #>> '{totals,entries}')::integer = 1 and (public.wf_ops_report(null, tests.id('hub_a1'), tests.day(10), tests.day(10)) ->> 'can_edit')::boolean
            and tests.err($$select public.wf_ops_report(null, null, tests.day(10), tests.day(1))$$) ~ '^22023' and tests.err($$select public.wf_ops_report(null, null, tests.day(1), tests.day(1) + 200)$$) ~ '^22023',
  'ops report: a single day, the manager may edit, a bad range is refused');
select tests.ok(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(10), tests.day(10)) -> 'missing_today' @> jsonb_build_array(jsonb_build_object('employee_id', tests.id('e2')))
            and jsonb_array_length(public.wf_ops_report(null, tests.id('hub_a1'), tests.day(10), tests.day(10)) -> 'missing_today') = 1, 'ops report: who sent numbers yesterday but not today is listed (and nobody else)');
select tests.ok(tests.err(format($$select public.wf_ops_report(null, %L, %L, %L)$$, tests.id('hub_b1'), tests.day(1), tests.day(17))) ~ '^42501', 'a manager cannot ask for another hub''s numbers');
select tests.ok(public.wf_ops_report(null, null, tests.day(1), tests.day(17)) #>> '{totals,entries}' = '4', 'without a hub the manager gets just their own hub''s numbers');
-- correction
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, 1, 1, 1, 1, '   ')$$, tests.id('o1'))) ~ '^22023 .*correction note', 'correcting the numbers needs a note');
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, -3, 1, 1, 1, 'ভুল')$$, tests.id('o1'))) ~ '^22023 .*numbers must be', 'a corrected number cannot be negative');
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, 45, 3, 55, 6, 'গণনায় ভুল')$$, tests.id('o1'))) is null, 'the hub manager corrects a person''s numbers with a note');
select tests.ok((select (pickup, revision) = (45, 3) from public.wf_daily_ops where id = tests.id('o1'))
            and (select action = 'corrected' and note = 'গণনায় ভুল' and from_vals ->> 'pickup' = '42' and to_vals ->> 'pickup' = '45' from public.wf_ops_history where entry_id = tests.id('o1') and revision = 3),
  'the correction is revision 3 and the history has the note');
select public.wf_ops_correct(tests.id('o1'), 45, 3, 55, 6, 'একই');
select tests.ok((select revision from public.wf_daily_ops where id = tests.id('o1')) = 3 and (select count(*) from public.wf_ops_history where entry_id = tests.id('o1')) = 3, 'the same numbers again change nothing');
select tests.ok(tests.n_notes('rider_login', 'আপনার দৈনিক সংখ্যা সংশোধন হয়েছে%') = 1, 'the person is told');
select tests.ok(public.wf_ops_history(tests.id('o1')) #>> '{0,revision}' = '3' and jsonb_array_length(public.wf_ops_history(tests.id('o1'))) = 3
            and tests.keys(public.wf_ops_history(tests.id('o1')) -> 0, array['id', 'entry_id', 'work_date', 'employee_name', 'revision', 'from', 'to', 'note', 'by_name', 'at'])
            and public.wf_ops_history(tests.id('o1')) #>> '{0,by_name}' = 'Hub A1 Mgr' and public.wf_ops_history(tests.id('o1')) #>> '{2,from}' is null, 'the numbers'' history: newest first, first line has no "from"');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, 1, 1, 1, 1, 'কারণ')$$, tests.id('o1'))) ~ '^42501 .*may not' and tests.err(format($$select public.wf_ops_history(%L)$$, tests.id('o1'))) ~ '^42501',
  'another hub''s manager can neither correct nor read the history');
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, 1, 1, 1, 1, 'কারণ')$$, tests.id('o1'))) ~ '^42501 .*may not'
            and not (public.wf_ops_report(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) ->> 'can_edit')::boolean
            and jsonb_array_length(public.wf_ops_history(tests.id('o1'))) = 3, 'the zonal manager reads but cannot correct');
select tests.login(tests.id('rider_login'));
select tests.ok(jsonb_array_length(public.wf_ops_history(tests.id('o1'))) = 3 and tests.err(format($$select public.wf_ops_correct(%L, 1, 1, 1, 1, 'কারণ')$$, tests.id('o1'))) ~ '^42501', 'the person reads their own history; cannot correct');
select tests.login(tests.id('u_s2'));
select tests.ok(tests.err(format($$select public.wf_ops_history(%L)$$, tests.id('o1'))) ~ '^42501', 'a colleague cannot read it');
select tests.login(tests.id('hub_mgr'));
insert into tests.ids values ('om', ((public.wf_ops_submit(2, 0, 3, 0)) ->> 'id')::uuid);
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, 9, 0, 3, 0, 'নিজেরটা')$$, tests.id('om'))) ~ '^42501 .*may not', 'a manager cannot correct their own numbers');
select tests.logout();

-- ---------------------------------------------------------------- the alert numbers
select tests.login(tests.id('rider_login'));
select tests.ok(tests.keys(public.wf_pending_counts(), array['today', 'open', 'mine', 'manage']) and tests.keys(public.wf_pending_counts() -> 'mine',
                  array['missing_days', 'returned_days', 'waiting_days', 'applications_pending', 'ops_expected', 'ops_submitted_today'])
            and public.wf_pending_counts() ->> 'manage' is null, 'counts: a staff member has "mine" and no "manage"');
select tests.ok((public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 8 and (public.wf_pending_counts() #>> '{mine,waiting_days}')::integer = 1
            and (public.wf_pending_counts() #>> '{mine,returned_days}')::integer = 0 and (public.wf_pending_counts() #>> '{mine,applications_pending}')::integer = 0
            and (public.wf_pending_counts() #>> '{mine,ops_expected}')::boolean and (public.wf_pending_counts() #>> '{mine,ops_submitted_today}')::boolean,
  'counts: 10 days so far - 2 on the register/approved (day 10 approved) - 1 waiting (day 9) = 8 missing');
select tests.login(tests.id('u_s3'));
select tests.ok((public.wf_pending_counts() #>> '{mine,ops_expected}')::boolean, 'counts: the person who sent numbers is expected to');
select tests.login(tests.id('u_nh'));
select tests.ok((public.wf_pending_counts() #>> '{mine,missing_days}')::integer = 10 and (public.wf_pending_counts() #>> '{mine,waiting_days}')::integer = 0
            and (public.wf_pending_counts() #>> '{mine,ops_submitted_today}')::boolean, 'counts: a person with nothing given has every day so far missing');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.keys(public.wf_pending_counts() -> 'manage', array['marks_waiting', 'applications_pending', 'ops_missing_today'])
            and (public.wf_pending_counts() #>> '{manage,marks_waiting}')::integer = (select count(*) from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
                                                                                       where m.status = 'waiting' and e.hub_id = tests.id('hub_a1') and e.profile_id <> tests.id('hub_mgr'))
            and (public.wf_pending_counts() #>> '{manage,applications_pending}')::integer = 1 and (public.wf_pending_counts() #>> '{manage,ops_missing_today}')::integer = 1,
  'counts: the manager''s waiting inputs (not their own), pending applications and people missing today''s numbers');
select tests.login(tests.id('zonal_a'));
select tests.ok(public.wf_pending_counts() ->> 'manage' is null and public.wf_pending_counts() ->> 'mine' is null, 'counts: a view-only zonal manager has nothing to decide');
select tests.login(tests.id('admin'));
select tests.ok(public.wf_pending_counts() ->> 'manage' is not null, 'counts: a company-wide approver has the numbers');
select tests.login(tests.id('noroles'));
select tests.ok(public.wf_pending_counts() ->> 'mine' is null and public.wf_pending_counts() ->> 'manage' is null and (public.wf_pending_counts() ->> 'today')::date = tests.day(10), 'counts: nobody linked, nothing to manage -> both null');
select tests.logout();

-- ---------------------------------------------------------------- the manager's panel for one hub
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.keys(public.wf_hub_overview(tests.id('hub_a1')), array['hub', 'date', 'can', 'staff_total', 'attendance', 'pending', 'ops', 'people'])
            and tests.keys(public.wf_hub_overview(tests.id('hub_a1')) -> 'hub', array['id', 'code', 'name', 'zone_id', 'zone_name'])
            and tests.keys(public.wf_hub_overview(tests.id('hub_a1')) -> 'can', array['attendance', 'decide', 'correct', 'ops', 'ops_edit'])
            and tests.keys(public.wf_hub_overview(tests.id('hub_a1')) -> 'attendance', array['present', 'late', 'half_day', 'absent', 'leave', 'other', 'not_given', 'waiting_marks', 'returned_marks'])
            and tests.keys(public.wf_hub_overview(tests.id('hub_a1')) -> 'pending', array['marks', 'applications'])
            and tests.keys(public.wf_hub_overview(tests.id('hub_a1')) -> 'ops', array['submitted', 'missing', 'pickup', 'pickup_return', 'delivery', 'delivery_return'])
            and tests.keys(public.wf_hub_overview(tests.id('hub_a1')) -> 'people' -> 0, array['employee_id', 'code', 'name', 'position', 'mobile', 'is_rider', 'record_status', 'mark_kind', 'mark_status', 'ops_submitted']),
  'hub overview: every key of the contract');
select tests.ok((public.wf_hub_overview(tests.id('hub_a1')) ->> 'date')::date = tests.day(10) and (public.wf_hub_overview(tests.id('hub_a1')) ->> 'staff_total')::integer = 4
            and jsonb_array_length(public.wf_hub_overview(tests.id('hub_a1')) -> 'people') = 4
            and (select bool_and(p ->> 'employee_id' in (tests.id('e1')::text, tests.id('e2')::text, tests.id('e4')::text, tests.id('em')::text)) from jsonb_array_elements(public.wf_hub_overview(tests.id('hub_a1')) -> 'people') p),
  'hub overview: today, the hub''s four active staff only (not other hubs, not hub-less, not the leaver)');
select tests.ok((select (a ->> 'present')::integer + (a ->> 'late')::integer + (a ->> 'half_day')::integer + (a ->> 'absent')::integer + (a ->> 'leave')::integer + (a ->> 'other')::integer
                       + (a ->> 'not_given')::integer + (a ->> 'waiting_marks')::integer + (a ->> 'returned_marks')::integer
                   from (select public.wf_hub_overview(tests.id('hub_a1')) -> 'attendance' a) q) = 4, 'hub overview: the counts of the day add up to the staff');
select tests.ok(public.wf_hub_overview(tests.id('hub_a1')) #>> '{attendance,absent}' = '1' and public.wf_hub_overview(tests.id('hub_a1')) #>> '{attendance,present}' = '1'
            and public.wf_hub_overview(tests.id('hub_a1')) #>> '{attendance,not_given}' = '2' and public.wf_hub_overview(tests.id('hub_a1')) #>> '{attendance,waiting_marks}' = '0',
  'hub overview: day 10 = e1 absent (corrected), em present, e2 and e4 nothing given');
select tests.ok((public.wf_hub_overview(tests.id('hub_a1')) #>> '{pending,marks}')::integer = (public.wf_pending_counts() #>> '{manage,marks_waiting}')::integer
            and (public.wf_hub_overview(tests.id('hub_a1')) #>> '{pending,applications}')::integer = 1, 'hub overview: pending equals the bell''s numbers');
select tests.ok(public.wf_hub_overview(tests.id('hub_a1')) #>> '{ops,submitted}' = '2' and public.wf_hub_overview(tests.id('hub_a1')) #>> '{ops,pickup}' = '47'
            and public.wf_hub_overview(tests.id('hub_a1')) #>> '{ops,missing}' = '1', 'hub overview: ops of the day');
select tests.ok((select p ->> 'is_rider' = 'true' and p ->> 'ops_submitted' = 'true' and p ->> 'record_status' = 'absent' from jsonb_array_elements(public.wf_hub_overview(tests.id('hub_a1')) -> 'people') p
                  where p ->> 'employee_id' = tests.id('e1')::text)
            and (select p ->> 'is_rider' = 'false' and p ->> 'record_status' = 'present' and p ->> 'mark_kind' = 'present' from jsonb_array_elements(public.wf_hub_overview(tests.id('hub_a1')) -> 'people') p
                  where p ->> 'employee_id' = tests.id('em')::text), 'hub overview: rider flag, register status, own input and ops flag of each person');
select tests.ok(public.wf_hub_overview(tests.id('hub_a1'), tests.day(9)) #>> '{attendance,waiting_marks}' = '1' and (public.wf_hub_overview(tests.id('hub_a1'), tests.day(9)) ->> 'date')::date = tests.day(9),
  'hub overview: another day of the same hub (day 9: e1 waits)');
select tests.ok((public.wf_hub_overview(tests.id('hub_a1')) -> 'can') = '{"attendance": true, "decide": true, "correct": true, "ops": true, "ops_edit": true}'::jsonb, 'hub overview: the hub manager can do everything');
select tests.ok(tests.err(format($$select public.wf_hub_overview(%L)$$, tests.id('hub_b1'))) ~ '^42501' and tests.err(format($$select public.wf_hub_overview(%L)$$, tests.id('hub_a2'))) ~ '^42501'
            and tests.err(format($$select public.wf_hub_book(%L)$$, tests.id('hub_b1'))) ~ '^42501', 'scope: a hub manager cannot open any other hub');
select tests.ok(tests.err($$select public.wf_hub_overview(null)$$) ~ '^22023', 'a hub must be chosen');
-- month grid
select tests.ok(tests.keys(public.wf_hub_book(tests.id('hub_a1')), array['hub', 'month', 'today', 'window', 'open', 'can', 'dates', 'people', 'totals'])
            and tests.keys(public.wf_hub_book(tests.id('hub_a1')) -> 'people' -> 0, array['employee_id', 'code', 'name', 'position', 'cells', 'summary'])
            and tests.keys(public.wf_hub_book(tests.id('hub_a1')) #> '{people,0,cells,0}', array['s', 'k', 'a', 'id'])
            and tests.keys(public.wf_hub_book(tests.id('hub_a1')) -> 'totals', array['present', 'late', 'half_day', 'absent', 'leave', 'other', 'waiting', 'returned', 'missing', 'total_days']), 'hub book: every key');
select tests.ok(jsonb_array_length(public.wf_hub_book(tests.id('hub_a1')) -> 'dates') = 17 and public.wf_hub_book(tests.id('hub_a1')) #>> '{dates,0}' = tests.day(1)::text
            and jsonb_array_length(public.wf_hub_book(tests.id('hub_a1')) -> 'people') = 4
            and (select bool_and(jsonb_array_length(p -> 'cells') = 17) from jsonb_array_elements(public.wf_hub_book(tests.id('hub_a1')) -> 'people') p), 'hub book: cells[i] is dates[i], for every person');
select tests.ok((select (p #>> '{cells,9,s}') || (p #>> '{cells,8,s}') || (p #>> '{cells,16,s}') from jsonb_array_elements(public.wf_hub_book(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('e1')::text) = 'Awf'
            and (select (p #>> '{cells,1,s}') || (p #>> '{cells,2,s}') from jsonb_array_elements(public.wf_hub_book(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('e2')::text) = 'AA'
            and (select (p #>> '{cells,3,s}') || (p #>> '{cells,4,s}') || (p #>> '{cells,5,s}') || (p #>> '{cells,6,s}') from jsonb_array_elements(public.wf_hub_book(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('e2')::text) = 'mPwr'
            and (select (p #>> '{cells,9,id}') is not null and (p #>> '{cells,9,k}') = 'present' from jsonb_array_elements(public.wf_hub_book(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('em')::text),
  'hub book: cells carry the register (A, P) / waiting (w) / returned (r) / missing (m) / future (f) and the person''s own input');
select tests.ok((select (public.wf_hub_book(tests.id('hub_a1')) #>> '{totals,total_days}')::integer = sum((p #>> '{summary,total_days}')::integer)
                       and (public.wf_hub_book(tests.id('hub_a1')) #>> '{totals,absent}')::integer = sum((p #>> '{summary,absent}')::integer)
                       and (public.wf_hub_book(tests.id('hub_a1')) #>> '{totals,missing}')::integer = sum((p #>> '{summary,missing}')::integer)
                       and (public.wf_hub_book(tests.id('hub_a1')) #>> '{totals,waiting}')::integer = sum((p #>> '{summary,waiting}')::integer)
                   from jsonb_array_elements(public.wf_hub_book(tests.id('hub_a1')) -> 'people') p) and (public.wf_hub_book(tests.id('hub_a1')) #>> '{totals,total_days}')::integer = 4 * 17,
  'hub book: the totals are the people''s summaries added up');
select tests.ok((public.wf_hub_book(tests.id('hub_a1'), tests.fm() - 40) ->> 'open')::boolean is false and jsonb_array_length(public.wf_hub_book(tests.id('hub_a1'), tests.fm() - 40) -> 'dates') = 17
            and (public.wf_hub_book(tests.id('hub_a1'), tests.fm() - 40) #>> '{totals,missing}')::integer = 0, 'hub book: a past month is the archive (closed, nothing "missing")');
select tests.ok((select (public.wf_my_book() #>> '{summary,absent}')::integer = 1 from (select tests.login(tests.id('u_s2'))) x) is not null, 'smoke');
select tests.login(tests.id('u_s2'));
select tests.ok((public.wf_my_book() #>> '{summary,absent}')::integer = 2 and (public.wf_my_book() #>> '{summary,present}')::integer = 1 and (public.wf_my_book() #>> '{summary,waiting}')::integer = 1
            and (public.wf_my_book() #>> '{summary,returned}')::integer = 1 and (public.wf_my_book() #>> '{summary,missing}')::integer = 5
            and (select sum(v::integer) from jsonb_each_text(public.wf_my_book() -> 'summary') j(k, v) where k <> 'total_days') + 7 = 17,
  'my book summary: absent 2 (2,3), present 1 (5), waiting 1 (6), returned 1 (7), missing 5 (1,4,8,9,10) and 7 future days = 17');
select tests.logout();

-- abilities by role: the zonal manager and the auditor read; the hub manager works
select tests.login(tests.id('zonal_a'));
select tests.ok(public.wf_hub_overview(tests.id('hub_a1')) -> 'can' = '{"attendance": true, "decide": false, "correct": false, "ops": true, "ops_edit": false}'::jsonb, 'abilities: the zonal manager can read everything and change nothing');
select tests.login(tests.id('auditor'));
select tests.ok(public.wf_hub_overview(tests.id('hub_a1')) -> 'can' = '{"attendance": true, "decide": false, "correct": false, "ops": true, "ops_edit": false}'::jsonb
            and public.wf_hub_overview(tests.id('hub_b1')) #>> '{hub,code}' = 'B1', 'abilities: the auditor reads every hub and changes nothing');
select tests.login(tests.id('admin'));
select tests.ok(public.wf_hub_overview(tests.id('hub_b1')) -> 'can' = '{"attendance": true, "decide": true, "correct": true, "ops": true, "ops_edit": true}'::jsonb, 'abilities: the admin can do everything');
select tests.logout();

-- the month archive: after the 17th the book is read only, and still shows what was given
select tests.set_today(25);
select tests.login(tests.id('hub_mgr'));
select tests.ok(not (public.wf_hub_book(tests.id('hub_a1')) ->> 'open')::boolean and jsonb_array_length(public.wf_hub_book(tests.id('hub_a1')) -> 'dates') = 17
            and (select (p #>> '{cells,9,s}') || (p #>> '{cells,1,s}') || (p #>> '{cells,16,s}') from jsonb_array_elements(public.wf_hub_book(tests.id('hub_a1')) -> 'people') p where p ->> 'employee_id' = tests.id('e1')::text) = 'Acc'
            and (public.wf_hub_book(tests.id('hub_a1')) #>> '{totals,missing}')::integer = 0 and (public.wf_hub_book(tests.id('hub_a1')) #>> '{totals,absent}')::integer = 8,
  'archive: the month stays as it was (absent days kept), what nobody gave is "closed", nothing is "missing"');
select tests.login(tests.id('rider_login'));
select tests.ok(not (public.wf_my_book() ->> 'open')::boolean and public.wf_my_book() ->> 'month' = tests.fm()::text and (public.wf_my_book() #>> '{summary,missing}')::integer = 0
            and tests.bd(10) ->> 'state' = 'approved' and tests.bd(11) ->> 'state' = 'closed' and tests.bd(9) ->> 'state' = 'waiting'
            and public.wf_my_book() -> 'months' ? tests.fm()::text, 'archive: the person sees the same month, closed, with their approved and waiting days');
select tests.logout();
-- a longer window by setting
select tests.set_today(20);
update public.system_settings set value = '31' where key = 'workforce.book_to_day';
select tests.login(tests.id('rider_login'));
select tests.ok((public.wf_my_book() ->> 'open')::boolean and jsonb_array_length(public.wf_my_book() -> 'days') = extract(day from (tests.fm() + interval '1 month' - interval '1 day'))::integer
            and public.wf_my_book() #>> '{window,to_day}' = '31', 'setting book_to_day = 31: the book stays open on the 20th and shows the whole month');
select tests.logout();
update public.system_settings set value = '17' where key = 'workforce.book_to_day';
select tests.set_today(10);

-- ---------------------------------------------------------------- lists: marks, applications
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.keys(public.wf_marks(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) -> 0, array['id', 'employee_id', 'employee_code', 'full_name', 'position', 'hub_id', 'hub_name', 'zone_id',
                  'work_date', 'kind', 'applied_on_site', 'note', 'status', 'via', 'marked_at', 'decided_as', 'decide_note', 'decided_at', 'decided_by_name', 'application_id', 'application_no', 'record_status']),
  'marks list: every key');
select tests.ok(public.wf_marks(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) #>> '{0,status}' = 'waiting'
            and (select bool_and(m ->> 'hub_id' = tests.id('hub_a1')::text) from jsonb_array_elements(public.wf_marks(null, tests.id('hub_a1'), tests.day(1), tests.day(17)) ) m)
            and not exists (select 1 from jsonb_array_elements(public.wf_marks(null, tests.id('hub_a1'), tests.day(1), tests.day(17))) m where m ->> 'application_id' = tests.id('app1')::text),
  'marks list: waiting first, only this hub, withdrawn application dates are left out');
select tests.ok((select count(*) from jsonb_array_elements(public.wf_marks(null, tests.id('hub_a1'), tests.day(1), tests.day(17), 'waiting')) m) = (public.wf_hub_overview(tests.id('hub_a1')) #>> '{pending,marks}')::integer + 0
            or (select count(*) from jsonb_array_elements(public.wf_marks(null, tests.id('hub_a1'), tests.day(1), tests.day(17), 'waiting')) m) = (public.wf_hub_overview(tests.id('hub_a1')) #>> '{pending,marks}')::integer + 1,
  'marks list: the waiting filter matches the pending count (plus the manager''s own, which they cannot decide)');
select tests.ok(jsonb_array_length(public.wf_marks(null, tests.id('hub_a1'), tests.day(9), tests.day(9))) = 1 and tests.err($$select public.wf_marks(null, null, null, null, 'nope')$$) ~ '^22023', 'marks list: a day, and a wrong status is refused');
select tests.ok(public.wf_marks(null, null, tests.day(1), tests.day(17)) @> jsonb_build_array(jsonb_build_object('employee_id', tests.id('e2'), 'application_no', (select application_no from public.wf_absence_applications where id = tests.id('app4'))))
            and (select count(*) from jsonb_array_elements(public.wf_marks(null, null, tests.day(1), tests.day(17))) m where m ->> 'employee_id' in (tests.id('e3')::text, tests.id('eb')::text, tests.id('enh')::text)) = 0,
  'marks list: without a hub it is the manager''s own hubs only');
select tests.ok(tests.keys(public.wf_applications(null, tests.id('hub_a1')) -> 0, array['id', 'application_no', 'employee_id', 'employee_code', 'employee_name', 'hub_id', 'hub_name', 'zone_id', 'zone_name',
                  'month', 'dates', 'reason', 'status', 'created_at', 'decided_at', 'decided_by_name', 'decision_note', 'cancelled_at']) and jsonb_array_length(public.wf_applications(null, tests.id('hub_a1'))) = 7,
  'applications list: every key; seven applications of the hub (six of the staff, one by the manager)');
select tests.ok(public.wf_applications(null, tests.id('hub_a1')) #>> '{0,status}' = 'pending' and jsonb_array_length(public.wf_applications(null, tests.id('hub_a1'), 'pending')) = 1
            and jsonb_array_length(public.wf_applications(null, tests.id('hub_a1'), 'cancelled')) = 1 and jsonb_array_length(public.wf_applications(null, tests.id('hub_a1'), 'rejected')) = 1
            and jsonb_array_length(public.wf_applications(null, tests.id('hub_a1'), 'approved')) = 4 and jsonb_array_length(public.wf_applications(null, tests.id('hub_a1'), null, tests.fm())) = 7
            and jsonb_array_length(public.wf_applications(null, tests.id('hub_a1'), null, tests.fm() - 40)) = 0, 'applications list: pending first; by status and by month');
select tests.ok((select a ->> 'decided_by_name' = 'Hub A1 Mgr' and a ->> 'decision_note' = 'ঠিক আছে' and a ->> 'status' = 'approved' from jsonb_array_elements(public.wf_applications(null, tests.id('hub_a1'), 'approved')) a
                  where a ->> 'id' = tests.id('app2')::text), 'applications list: the tracking (who decided, the note)');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(public.wf_marks(null, null, tests.day(1), tests.day(17)) = '[]'::jsonb and public.wf_applications(null, null, null, tests.fm()) = '[]'::jsonb and jsonb_array_length(public.wf_applications()) = 1
            and tests.err(format($$select public.wf_marks(null, %L, null, null)$$, tests.id('hub_a1'))) ~ '^42501' and tests.err(format($$select public.wf_applications(null, %L)$$, tests.id('hub_a1'))) ~ '^42501',
  'scope: another hub''s manager gets empty lists, or a refusal when they name the hub');
select tests.login(tests.id('rider_login'));
select tests.ok(public.wf_marks() = '[]'::jsonb and public.wf_applications() = '[]'::jsonb and tests.err(format($$select public.wf_hub_overview(%L)$$, tests.id('hub_a1'))) ~ '^42501'
            and tests.err($$select public.wf_zone_overview()$$) is null and jsonb_array_length(public.wf_zone_overview() -> 'hubs') = 0, 'scope: a staff member sees nothing of the manager''s panels');
select tests.login(tests.id('zonal_a'));
select tests.ok((select bool_and(m ->> 'hub_id' in (tests.id('hub_a1')::text, tests.id('hub_a2')::text)) from jsonb_array_elements(public.wf_marks(null, null, tests.day(1), tests.day(17))) m)
            and (select count(*) from jsonb_array_elements(public.wf_marks(null, null, tests.fm() - 1, (now() at time zone 'Asia/Dhaka')::date)) m where m ->> 'hub_id' = tests.id('hub_b1')::text) = 0
            and public.wf_marks(null, null, tests.fm(), (now() at time zone 'Asia/Dhaka')::date) @> jsonb_build_array(jsonb_build_object('employee_id', tests.id('e3'))),
  'scope: the zonal manager reads the marks of all hubs of the zone (A1 and A2), not zone B');
select tests.ok(tests.err($$select public.wf_marks(null, null, null, null)$$) is null and jsonb_array_length(public.wf_applications(tests.id('zone_a'))) = 7
            and tests.err(format($$select public.wf_applications(%L, %L)$$, tests.id('zone_b'), null::uuid)) is null and public.wf_applications(tests.id('zone_b')) = '[]'::jsonb, 'scope: the zonal manager reads zone A''s applications and nothing of zone B');
select tests.logout();

-- ---------------------------------------------------------------- the zonal panel
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.keys(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)), array['from', 'to', 'today', 'zone', 'hubs', 'totals'])
            and tests.keys(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'zone', array['id', 'name'])
            and tests.keys(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'hubs' -> 0, array['hub_id', 'code', 'name', 'zone_id', 'zone_name', 'staff_total', 'att', 'pending_marks', 'pending_applications', 'returned_marks', 'ops'])
            and tests.keys(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) #> '{hubs,0,att}', array['present', 'late', 'half_day', 'absent', 'leave', 'other', 'not_given_today'])
            and tests.keys(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) #> '{hubs,0,ops}', array['submitted_people', 'missing_today', 'pickup', 'pickup_return', 'delivery', 'delivery_return'])
            and tests.keys(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'totals', array['staff_total', 'att', 'pending_marks', 'pending_applications', 'returned_marks', 'ops']),
  'zone overview: every key of the contract');
select tests.ok(jsonb_array_length(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'hubs') = 2
            and (select array_agg(h ->> 'code' order by h ->> 'code') from jsonb_array_elements(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'hubs') h) = array['A1', 'A2']
            and public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) #>> '{zone,name}' = 'Zone A', 'zone overview: the zone''s hubs only');
select tests.ok(tests.arr_sum(public.wf_zone_overview(null, tests.day(1), tests.day(17)) -> 'hubs', 'staff_total') = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,staff_total}')::numeric
            and (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,staff_total}')::integer = 5 and public.wf_zone_overview(null, tests.day(1), tests.day(17)) -> 'zone' = 'null'::jsonb,
  'zone overview: staff total = the sum of the hubs (A1: 4, A2: 1); no zone given = all the zonal manager''s zones');
select tests.ok((select sum((h #>> '{att,absent}')::integer) = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,att,absent}')::integer
                       and sum((h #>> '{att,present}')::integer) = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,att,present}')::integer
                       and sum((h #>> '{att,not_given_today}')::integer) = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,att,not_given_today}')::integer
                       and sum((h ->> 'pending_marks')::integer) = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,pending_marks}')::integer
                       and sum((h ->> 'returned_marks')::integer) = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,returned_marks}')::integer
                       and sum((h #>> '{ops,pickup}')::integer) = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,ops,pickup}')::integer
                       and sum((h #>> '{ops,submitted_people}')::integer) = (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,ops,submitted_people}')::integer
                   from jsonb_array_elements(public.wf_zone_overview(null, tests.day(1), tests.day(17)) -> 'hubs') h), 'zone overview: every total is the sum of the hubs');
select tests.ok((select (h #>> '{att,absent}')::integer from jsonb_array_elements(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'hubs') h where h ->> 'code' = 'A1')
                  = (select count(*) from public.attendance_records r join public.employees e on e.id = r.employee_id where e.hub_id = tests.id('hub_a1') and r.status = 'absent' and r.work_date between tests.day(1) and tests.day(17))
            and (select (h #>> '{att,present}')::integer from jsonb_array_elements(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'hubs') h where h ->> 'code' = 'A2') = 0
            and (select (h #>> '{att,present}')::integer from jsonb_array_elements(public.wf_zone_overview(tests.id('zone_a'), tests.fm(), (now() at time zone 'Asia/Dhaka')::date) -> 'hubs') h where h ->> 'code' = 'A2') = 1,
  'zone overview: the attendance numbers are the register rows of the range (A2''s one row is of today, outside the first range)');
select tests.ok((select h ->> 'pending_marks' = (public.wf_hub_overview(tests.id('hub_a1')) #>> '{pending,marks}') and h ->> 'pending_applications' = (public.wf_hub_overview(tests.id('hub_a1')) #>> '{pending,applications}')
                       and h #>> '{att,not_given_today}' = (public.wf_hub_overview(tests.id('hub_a1')) #>> '{attendance,not_given}')
                   from jsonb_array_elements(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'hubs') h where h ->> 'code' = 'A1'), 'zone overview agrees with the hub overview of the same day (waiting, applications, not given)');
select tests.ok((select (h #>> '{ops,submitted_people}')::integer = 3 and (h #>> '{ops,missing_today}')::integer = 1 and (h #>> '{ops,pickup}')::integer = 45 + 10 + 1 + 7 + 2
                   from jsonb_array_elements(public.wf_zone_overview(tests.id('zone_a'), tests.day(1), tests.day(17)) -> 'hubs') h where h ->> 'code' = 'A1'),
  'zone overview: ops of the range (three people, 65 pickups after the correction) and who is missing today');
select tests.ok(tests.err(format($$select public.wf_zone_overview(%L)$$, tests.id('zone_b'))) ~ '^42501' and not exists (select 1 from jsonb_array_elements(public.wf_zone_overview() -> 'hubs') h where h ->> 'code' = 'B1'),
  'scope: the zonal manager of zone A cannot see zone B (by name or by default)');
select tests.ok(public.wf_zone_overview() #>> '{hubs,0,ops}' is not null and not exists (select 1 from jsonb_array_elements(public.wf_zone_overview() -> 'hubs') h where h ->> 'hub_id' is null), 'scope: no hub-less row for a zone-level manager');
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.wf_zone_overview() -> 'hubs') = 1 and public.wf_zone_overview() #>> '{hubs,0,code}' = 'A1', 'a hub manager''s zone overview is just their hub');
select tests.login(tests.id('admin'));
select tests.ok((select count(*) from jsonb_array_elements(public.wf_zone_overview(null, tests.day(1), tests.day(17)) -> 'hubs') h) = 4
            and exists (select 1 from jsonb_array_elements(public.wf_zone_overview(null, tests.day(1), tests.day(17)) -> 'hubs') h where h ->> 'hub_id' is null and (h ->> 'staff_total')::integer = 1 and h #>> '{ops,pickup}' = '5')
            and (public.wf_zone_overview(null, tests.day(1), tests.day(17)) #>> '{totals,staff_total}')::integer = 7
            and tests.arr_sum(public.wf_zone_overview(null, tests.day(1), tests.day(17)) -> 'hubs', 'staff_total') = 7, 'a company-wide approver sees every hub, and a row for people without a hub; the total adds up');
select tests.ok(jsonb_array_length(public.wf_marks(null, null, tests.fm(), (now() at time zone 'Asia/Dhaka')::date)) > 0 and public.wf_ops_report(null, null, tests.day(1), tests.day(17)) #>> '{totals,entries}' = '8'
            and exists (select 1 from jsonb_array_elements(public.wf_ops_report(null, null, tests.day(1), tests.day(17)) -> 'rows') r where r ->> 'hub_id' is null), 'the company-wide approver also sees hub-less staff''s numbers (8 entries in all)');
select tests.logout();

-- ---------------------------------------------------------------- row level security: direct reads
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) from public.wf_absence_applications) = 0 and (select count(*) from public.wf_daily_ops) = 3 and (select count(*) from public.wf_daily_ops where employee_id <> tests.id('e1')) = 0
            and (select count(*) from public.wf_att_history where employee_id <> tests.id('e1')) = 0 and (select count(*) from public.wf_ops_history) = 5, 'RLS: a staff member reads only their own rows');
select tests.login(tests.id('u_s2'));
select tests.ok((select count(*) from public.wf_absence_applications) = 4 and (select count(*) from public.wf_absence_applications where employee_id <> tests.id('e2')) = 0, 'RLS: own applications (all four, whatever their state)');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) from public.wf_absence_applications) = 7 and (select count(*) from public.wf_daily_ops) = 5 and (select count(*) from public.wf_daily_ops where hub_id is distinct from tests.id('hub_a1')) = 0,
  'RLS: the hub manager reads the applications and numbers of the hub, not hub-less or other hubs'' numbers');
select tests.ok((select count(*) from public.wf_att_history where hub_id is distinct from tests.id('hub_a1')) = 0 and (select count(*) from public.wf_ops_history) = 7, 'RLS: and the histories of the hub');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok((select count(*) from public.wf_absence_applications) = 1 and (select count(*) from public.wf_daily_ops) = 1 and (select count(*) from public.wf_att_history) > 0
            and (select count(*) from public.wf_att_history where hub_id is distinct from tests.id('hub_b1')) = 0 and (select count(*) from public.wf_ops_history) = 1, 'RLS: another hub''s manager reads only hub B');
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) from public.wf_daily_ops) = 6 and (select count(*) from public.wf_absence_applications) = 7, 'RLS: the zonal manager reads zone A (both hubs), not B');
select tests.login(tests.id('admin'));
select tests.ok((select count(*) from public.wf_daily_ops) = 8, 'RLS: an admin reads everything, hub-less staff included');
select tests.login(tests.id('noroles'));
select tests.ok((select count(*) from public.wf_absence_applications) = 0 and (select count(*) from public.wf_daily_ops) = 0 and (select count(*) from public.wf_att_history) = 0 and (select count(*) from public.wf_ops_history) = 0,
  'RLS: a login with no role and no employee reads nothing');
select tests.login(tests.id('rider_login'));
select tests.throws($$insert into public.wf_daily_ops (employee_id, work_date) values (tests.id('e1'), tests.day(3))$$, 'no direct insert of daily numbers', '42501');
select tests.throws($$update public.wf_daily_ops set pickup = 999$$, 'no direct update of daily numbers', '42501');
select tests.throws($$delete from public.wf_daily_ops$$, 'no direct delete of daily numbers', '42501');
select tests.throws($$insert into public.wf_absence_applications (application_no, employee_id, month, dates, reason) values ('AB-1', tests.id('e1'), tests.fm(), array[tests.day(3)], 'x')$$, 'no direct insert of applications', '42501');
select tests.throws($$update public.wf_absence_applications set status = 'approved'$$, 'no direct update of applications', '42501');
select tests.throws($$insert into public.wf_att_history (employee_id, work_date, action) values (tests.id('e1'), tests.day(3), 'edited')$$, 'no direct insert into the history', '42501');
update public.attendance_self_marks set status = 'approved', decided_as = 'present' where employee_id = tests.id('e1');
select tests.logout();
select tests.ok((select status from public.attendance_self_marks where id = tests.id('m1b')) = 'waiting', 'a staff member cannot approve their own input by hand either (no row changes)');
select tests.login_anon();
select tests.throws($$select count(*) from public.wf_daily_ops$$, 'anonymous visitors cannot read the numbers', '42501');
select tests.throws($$select count(*) from public.wf_absence_applications$$, 'nor the applications', '42501');
select tests.throws($$select public.wf_pending_counts()$$, 'nor call the functions', '42501');
select tests.throws($$select public.wf_att_submit(current_date, 'present')$$, 'not even the one that gives a date', '42501');
select tests.login(tests.id('rider_login'));
select tests.throws($$select private.wf_grid(current_date, current_date, null, null, true)$$, 'the internal helpers are not for the API', '42501');
select tests.logout();
select tests.throws($$delete from public.wf_daily_ops$$, 'daily numbers are never deleted (not even by the owner)', 'P0001');
select tests.throws($$delete from public.wf_absence_applications$$, 'applications are never deleted', 'P0001');
select tests.throws($$insert into public.wf_daily_ops (employee_id, work_date) values (tests.id('e1'), tests.day(10))$$, 'one row per person per date, enforced by the table', '23505');
select tests.throws($$insert into public.wf_daily_ops (employee_id, work_date, pickup) values (tests.id('e1'), tests.day(3), -1)$$, 'the table refuses negative numbers', '23514');
select tests.ok((select count(*) from public.audit_logs where table_name in ('wf_daily_ops', 'wf_absence_applications')) > 0, 'both new tables are audited');

-- ---------------------------------------------------------------- an employee before the joining date, and the day a person joined
update public.employees set joining_date = tests.day(7) where id = tests.id('e4');
select tests.login(tests.id('u_s4'));
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(5), 'present')$$) ~ '^22023 .*joining date', 'a date before the joining date is refused');
select tests.ok(tests.bd(10) ->> 'state' = 'missing' and tests.bd(2) ->> 'state' = 'approved' and tests.bd(4) ->> 'state' = 'returned', 'what exists stays visible; a date before joining with nothing is not "missing"');
select tests.ok((public.wf_my_book() #>> '{summary,missing}')::integer = 4, 'only the days from joining count as missing (7, 8, 9 and 10)');
select tests.logout();
update public.employees set joining_date = null where id = tests.id('e4');

-- ---------------------------------------------------------------- staff without a hub
select tests.login(tests.id('u_nh'));
insert into tests.ids values ('mnh', public.wf_att_submit(tests.day(8), 'present'));
select tests.logout();
select tests.ok((select hub_id is null and zone_id is null and status = 'waiting' and via = 'book' from public.attendance_self_marks where id = tests.id('mnh')), 'a staff member without a hub can give a date (hub and zone stay empty)');
select tests.login(tests.id('hub_mgr'));
select tests.ok(not exists (select 1 from jsonb_array_elements(public.wf_marks(null, null, tests.day(1), tests.day(17))) m where m ->> 'id' = tests.id('mnh')::text)
            and tests.err(format($$select public.att_self_decide(array[%L::uuid], true)$$, tests.id('mnh'))) ~ '^42501', 'a hub manager neither sees nor decides a hub-less staff member''s date');
select tests.login(tests.id('admin'));
select tests.ok(exists (select 1 from jsonb_array_elements(public.wf_marks(null, null, tests.day(1), tests.day(17))) m where m ->> 'id' = tests.id('mnh')::text and m ->> 'hub_id' is null)
            and public.att_self_decide(array[tests.id('mnh')], true) = 1, 'a company-wide approver sees it and decides it');
select tests.logout();

-- ---------------------------------------------------------------- reminders (once per person per Dhaka day)
select tests.ok(private.wf_remind() > 0, 'reminders: the first run tells people');
select tests.ok(tests.n_notes('u_s3', 'আজকের হাজিরা বাকি') = 1 and tests.n_notes('u_nh', 'আজকের হাজিরা বাকি') = 1 and tests.n_notes('u_s2', 'আজকের হাজিরা বাকি') = 1
            and tests.n_notes('rider_login', 'আজকের হাজিরা বাকি') = 0 and tests.n_notes('u_old', 'আজকের হাজিরা বাকি') = 0 and tests.n_notes('noroles', 'আজকের হাজিরা বাকি') = 0,
  'reminders: whoever has not given today is told (not who has, not the inactive, not a login without staff)');
select tests.ok(tests.n_notes('u_s2', 'ফেরত দেওয়া হাজিরা আবার দিন') = 1 and tests.n_notes('u_s4', 'ফেরত দেওয়া হাজিরা আবার দিন') = 1 and tests.n_notes('rider_login', 'ফেরত দেওয়া হাজিরা আবার দিন') = 0
            and (select body from public.notifications where profile_id = tests.id('u_s2') and title = 'ফেরত দেওয়া হাজিরা আবার দিন') like '1 %', 'reminders: returned dates are named once per person');
select tests.ok(tests.n_notes('u_s2', 'আজকের সংখ্যা বাকি') = 1 and tests.n_notes('u_s3', 'আজকের সংখ্যা বাকি') = 0 and tests.n_notes('u_nh', 'আজকের সংখ্যা বাকি') = 0 and tests.n_notes('rider_login', 'আজকের সংখ্যা বাকি') = 0,
  'reminders: only people who send their numbers every day, and have not yet today, are asked for them');
select tests.ok(tests.n_notes('hub_mgr', 'অনুমোদনের জন্য অপেক্ষায়%') = 1 and tests.n_notes('mgr2', 'অনুমোদনের জন্য অপেক্ষায়%') = 1 and tests.n_notes('hub_b_mgr', 'অনুমোদনের জন্য অপেক্ষায়%') = 1
            and (select body from public.notifications where profile_id = tests.id('mgr2') and title like 'অনুমোদনের জন্য অপেক্ষায়%') like '% টি হাজিরা ও 1 টি অনুপস্থিতির আবেদন%'
            and tests.n_notes('zonal_a', 'অনুমোদনের জন্য অপেক্ষায়%') = 0, 'reminders: one digest per hub manager while something waits in their hub (a zonal viewer is not asked to approve)');
select tests.ok(private.wf_remind() = 0 and tests.n_notes('u_s3', 'আজকের হাজিরা বাকি') = 1, 'reminders: running again the same day tells nobody twice');
select tests.ok((select count(*) from public.notifications where kind = 'workforce' and link in ('/app/workforce/attendance', '/app/workforce/hub')) = (select count(*) from public.notifications where kind = 'workforce'),
  'reminders: every one is a "workforce" notification with a link into the module');
select tests.set_today(18);
update public.notifications set created_at = created_at - interval '3 days' where kind = 'workforce';
select tests.ok(private.wf_remind() > 0 and tests.n_notes('u_s3', 'আজকের হাজিরা বাকি') = 1 and tests.n_notes('u_s3', 'আজকের সংখ্যা বাকি') = 0, 'reminders: after the book closes nobody is asked for dates any more (the digest still goes to managers)');
select tests.set_today(10);

-- ================================================================ after the independent review (fixes F1-F13)
insert into tests.ids values ('u_s5', tests.make_user('s5@test.local', 'Staff Five'));
insert into tests.ids values ('e5', tests.active_employee('Staff Five', '809', tests.id('hub_a1'), '01711000809', '8090101010', 15000, tests.id('u_s5')));
select tests.grant_role(tests.id('u_s5'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.set_today(16);

-- F2: deciding an application never overwrites a register row that is already there
select tests.login(tests.id('hub_mgr'));
insert into public.attendance_records (employee_id, work_date, status, source) values (tests.id('e5'), tests.day(13), 'present', 'manual');
select tests.logout();
insert into public.attendance_records (employee_id, work_date, status, source, note) values (tests.id('e5'), tests.day(14), 'leave', 'leave', 'Approved leave');
select tests.login(tests.id('u_s5'));
-- the register rows came after the person applied: apply first, the manager's rows land in between
insert into tests.ids values ('app9', public.wf_absence_apply(array[tests.day(15), tests.day(16)], 'পারিবারিক কাজ'));
select tests.logout();
insert into public.attendance_records (employee_id, work_date, status, source) values (tests.id('e5'), tests.day(15), 'late', 'manual');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.wf_absence_decide(tests.id('app9'), true, 'ঠিক আছে') = 2, 'F2: the application is decided (two dates)');
select tests.ok((select status from public.attendance_records where employee_id = tests.id('e5') and work_date = tests.day(15)) = 'late'
            and (select source from public.attendance_records where employee_id = tests.id('e5') and work_date = tests.day(15)) = 'manual',
  'F2: a register row the manager wrote by hand is NOT overwritten by approving the application');
select tests.ok((select status from public.attendance_records where employee_id = tests.id('e5') and work_date = tests.day(16)) = 'absent'
            and (select source from public.attendance_records where employee_id = tests.id('e5') and work_date = tests.day(16)) = 'self',
  'F2: a date with no register row goes on the register as absent');
select tests.ok((select status = 'approved' and decided_as = 'late' and attendance_id is not null from public.attendance_self_marks where employee_id = tests.id('e5') and work_date = tests.day(15)),
  'F2: its input is closed with the register as it is (approved, as late)');
select tests.ok(tests.n_notes('u_s5', 'আবেদন AB-% অনুমোদিত') = 1 and tests.n_notes('u_s5', 'হাজিরা অনুমোদিত%') = 0, 'F7: the person gets ONE notice for the application, not one per date');
-- the approval list does the same for a single date
select tests.logout();
select tests.login(tests.id('u_s5'));
select public.wf_att_submit(tests.day(12), 'present');
insert into tests.ids values ('m12', tests.mark_of('e5', 12));
select tests.logout();
select tests.login(tests.id('hub_mgr'));
insert into public.attendance_records (employee_id, work_date, status, source) values (tests.id('e5'), tests.day(12), 'half_day', 'manual');
select tests.ok(public.wf_marks_decide(array[tests.id('m12')], true, 'present', 'নোট') = 1, 'F2: wf_marks_decide handles the input');
select tests.ok((select status from public.attendance_records where employee_id = tests.id('e5') and work_date = tests.day(12)) = 'half_day'
            and (select status = 'approved' and decided_as = 'half_day' from public.attendance_self_marks where id = tests.id('m12')),
  'F2: wf_marks_decide closes an input whose date is already on the register without overwriting it');
select tests.ok(tests.err(format($$select public.wf_marks_decide(array[%L::uuid], true)$$, tests.id('m12'))) is null
            and public.wf_marks_decide(null, true) = 0, 'F2: deciding nothing is harmless');
select tests.logout();
select tests.login(tests.id('u_s5'));
select public.wf_att_submit(tests.day(11), 'present');
insert into tests.ids values ('m11', tests.mark_of('e5', 11));
select tests.logout();
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.wf_marks_decide(array[tests.id('m11')], true, 'late') = 1, 'wf_marks_decide handles an input with no register row');
select tests.ok((select status || '/' || source from public.attendance_records where employee_id = tests.id('e5') and work_date = tests.day(11)) = 'late/self',
  'wf_marks_decide with no register row behaves as the old approval (register written as decided)');
select tests.ok(tests.err(format($$select public.wf_marks_decide(array[%L::uuid], true)$$, tests.id('m12'))) is null, 'deciding an already closed input again is harmless');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.err(format($$select public.wf_marks_decide(array[%L::uuid], true)$$, tests.id('m12'))) is null, 'another hub''s manager closes nothing (the input is no longer waiting)');
select tests.logout();

-- F5: no withdrawing after part of the application was decided
select tests.login(tests.id('u_s5'));
insert into tests.ids values ('app10', public.wf_absence_apply(array[tests.day(8), tests.day(9)], 'অসুস্থ'));
select tests.logout();
select tests.login(tests.id('hub_mgr'));
select public.att_self_decide(array[tests.mark_of('e5', 8)], true, 'absent');
select tests.login(tests.id('u_s5'));
select tests.ok(tests.err(format($$select public.wf_absence_cancel(%L)$$, tests.id('app10'))) ~ '^22023 .*already approved', 'F5: an application cannot be withdrawn after one of its dates was approved');
select tests.ok((select status from public.wf_absence_applications where id = tests.id('app10')) = 'pending' and tests.mark_of('e5', 9) is not null
            and (select status from public.attendance_self_marks where id = tests.mark_of('e5', 9)) = 'waiting', 'F5: the refused withdrawal changed nothing');

-- F6 / F12: text is bounded and "only a newline" is empty
select tests.ok(tests.err(format($$select public.wf_att_submit(tests.day(7), 'present', null, %L)$$, repeat('ক', 501))) ~ '^22023 .*too long', 'F6: a note over 500 characters is refused');
select tests.ok(tests.err(format($$select public.wf_absence_apply(array[tests.day(6)], %L)$$, repeat('x', 501))) ~ '^22023 .*too long', 'F6: so is a reason');
select tests.ok(tests.err(format($$select public.wf_ops_submit(1, 1, 1, 1, %L)$$, repeat('x', 501))) ~ '^22023 .*too long', 'F6: and an ops note');
select tests.ok(tests.err($$select public.wf_absence_apply(array[tests.day(6)], E'\n\t \r')$$) ~ '^22023 .*reason', 'F12: a reason of only a newline / tab is empty');
select tests.logout();
select tests.ok(tests.err(format($$insert into public.wf_absence_applications (application_no, employee_id, month, dates, reason) values ('AB-99999', %L, %L, array[%L::date], E'\n')$$,
                                 tests.id('e5'), tests.fm(), tests.day(6))) ~ '^23514', 'F12: the table check says the same');
select tests.login(tests.id('u_s5'));
select tests.logout();

-- F13: numbers are never silently NULL -> 0, and the person cannot overwrite a manager's correction
select tests.login(tests.id('u_s5'));
select tests.ok(tests.err($$select public.wf_ops_submit(1, null, 1, 1)$$) ~ '^22023 .*four numbers', 'F13: an empty number is refused, not turned into 0');
select public.wf_ops_submit(10, 2, 20, 1);
insert into tests.ids values ('o5', (select id from public.wf_daily_ops where employee_id = tests.id('e5') and work_date = tests.day(16)));
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, null, 2, 20, 1, 'নোট')$$, tests.id('o5'))) ~ '^22023 .*four numbers', 'F13: the manager''s correction needs all four numbers too');
select public.wf_ops_correct(tests.id('o5'), 12, 2, 20, 1, 'গণনা ঠিক করা হলো');
select tests.login(tests.id('u_s5'));
select tests.ok(tests.err($$select public.wf_ops_submit(99, 99, 99, 99)$$) ~ '^42501 .*corrected', 'F13: the person cannot overwrite what the manager corrected');
select tests.ok((select pickup from public.wf_daily_ops where id = tests.id('o5')) = 12, 'F13: the corrected numbers stand');
select tests.logout();

-- F9: the histories cannot be truncated, even by the owner
select tests.ok(tests.err('truncate public.wf_att_history') is not null and tests.err('truncate public.wf_ops_history') is not null
            and (select count(*) from public.wf_att_history) > 0, 'F9: neither history table can be truncated');

-- F10: the zone follows the hub even when the hub becomes empty
update public.employees set hub_id = null, zone_id = null where id = tests.id('e5');
select tests.login(tests.id('u_s5'));
select public.wf_att_submit(tests.day(5), 'present');
select tests.logout();
select tests.ok((select zone_id is null and hub_id is null from public.attendance_self_marks where employee_id = tests.id('e5') and work_date = tests.day(5)), 'F10: a person with no hub leaves no stale zone on the input');

-- F1: wf_hubs returns exactly the hubs the permission gives, by scope (private helper: reached through a definer shim here)
create function tests.hubs_of(p_perm text) returns uuid[] language sql stable security definer as
  $$ select coalesce(array_agg(hub_id order by hub_id), '{}') from private.wf_hubs(p_perm) $$;
grant execute on function tests.hubs_of(text) to authenticated;
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.hubs_of('hr.attendance.view') = array[tests.id('hub_a1')], 'F1: a hub manager sees exactly their hub');
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.hubs_of('hr.attendance.view') = (select array_agg(id order by id) from public.hubs where zone_id = tests.id('zone_a') and archived_at is null),
  'F1: a zonal manager sees exactly the hubs of their zone');
select tests.login(tests.id('rider_login'));
select tests.ok(cardinality(tests.hubs_of('hr.attendance.view')) = 0, 'F1: a rider sees no hub through the manager helpers');
select tests.login(tests.id('admin'));
select tests.ok(tests.hubs_of('hr.attendance.view') = (select array_agg(id order by id) from public.hubs where archived_at is null), 'F1: a company-wide role sees every active hub');
select tests.logout();

-- F7: one digest per hub, titled with the hub, and old waiting inputs are not nagged
update public.notifications set created_at = created_at - interval '3 days' where kind = 'workforce';
select tests.set_today(10);
select tests.ok(private.wf_remind() >= 0, 'F7: reminders still run');
select tests.ok(not exists (select 1 from public.notifications where kind = 'workforce' and title = 'অনুমোদনের জন্য অপেক্ষায়'), 'F7: the digest title names the hub');

-- 19 from this module + 4 from 20261118200000_workforce_earlier_dates (wf_book_fill, wf_window_save, wf_window_end, wf_windows)
-- + 2 from 20261121000400_book_full_month (wf_book_mode, wf_book_full_month_set)
-- + 2 from 20261122001000_workforce_ops_add (wf_ops_add, wf_ops_taps)
-- (the 13 of 20261122001100_workforce_manager_book were removed again by 20261122001200)
-- + 7 from 20261124000100_morning_input (wf_morning_get/save/submit/zone/return, wf_att_policy_get/save)
-- + 2 from 20261125182000_ops_deadlines (wf_ops_deadlines_get/save)
select tests.ok((select count(*) filter (where p.prosecdef and p.proconfig @> array['search_path=""']) = 39 and count(*) = 39
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wf\_%'),
  'all thirty-nine public functions are security definer with an empty search path');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wf\_%'
                              and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'anon cannot run any of them; signed-in users can');
rollback;
