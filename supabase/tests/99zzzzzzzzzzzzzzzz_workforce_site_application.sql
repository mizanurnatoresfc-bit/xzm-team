-- The website application's number and date for an absent date "applied on the website".
-- Migration 20261118210000_workforce_site_application.sql. The business clock is moved inside this transaction like the other
-- workforce tests: a month two months back, today = the 10th, so the book (days 1-17) is open and days 1-10 can be given.
begin;
select tests.fixture();
select tests.hr_fixture();

-- ---------------------------------------------------------------- helpers (rolled back with the transaction)
create function tests.fm() returns date language sql stable as $$ select date_trunc('month', ((now() at time zone 'Asia/Dhaka')::date - 60))::date $$;
create function tests.day(n integer) returns date language sql stable as $$ select tests.fm() + (n - 1) $$;
create function tests.set_today(n integer) returns void language sql as $$ select set_config('tests.today', (tests.fm() + (n - 1))::text, true) $$;
create or replace function private.wf_today() returns date language sql stable as
  $$ select coalesce(nullif(current_setting('tests.today', true), ''), (now() at time zone 'Asia/Dhaka')::date::text)::date $$;
create function tests.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function tests.bd(n integer) returns jsonb language sql stable as
  $$ select d from jsonb_array_elements(public.wf_my_book() -> 'days') d where (d ->> 'day')::integer = n $$;
create function tests.mark(p_emp text, p_day integer) returns public.attendance_self_marks language sql stable security definer as
  $$ select m from public.attendance_self_marks m where employee_id = tests.id(p_emp) and work_date = tests.day(p_day) $$;
create function tests.n_hist(p_mark uuid, p_action text default null) returns bigint language sql stable security definer as
  $$ select count(*) from public.wf_att_history where mark_id = p_mark and (p_action is null or action = p_action) $$;
create function tests.site(p_ref text, p_on date, variadic p_dates date[]) returns jsonb language sql immutable as
  $$ select jsonb_build_object('ref', p_ref, 'applied_on', p_on, 'dates', to_jsonb(p_dates)) $$;
select tests.set_today(10);

-- ---------------------------------------------------------------- people
insert into tests.ids values ('u_s1', tests.make_user('site1@test.local', 'Site One')), ('u_s2', tests.make_user('site2@test.local', 'Site Two'));
insert into tests.ids values
  ('e1', tests.active_employee('Site One', '951', tests.id('hub_a1'), '01711000951', '9510101010', 15000, tests.id('u_s1'))),
  ('e2', tests.active_employee('Site Two', '952', tests.id('hub_a1'), '01711000952', '9520101010', 15000, tests.id('u_s2')));
select tests.grant_role(tests.id('u_s1'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_s2'), 'rider', 'hub', null, tests.id('hub_a1'));

-- ---------------------------------------------------------------- the columns and the API
select tests.ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'attendance_self_marks'
                  and column_name in ('site_applied_on', 'site_ref')) = 2, 'attendance_self_marks has the two new columns');
select tests.ok(to_regprocedure('public.wf_att_submit(date, text, boolean, text)') is null
            and to_regprocedure('public.wf_att_submit(date, text, boolean, text, date, text)') is not null
            and to_regprocedure('public.wf_book_fill(date[], date[], date[], text, text)') is null
            and to_regprocedure('public.wf_book_fill(date[], jsonb, date[], text, text)') is not null,
  'the old signatures are gone; one wf_att_submit and one wf_book_fill remain');
select tests.ok(not has_function_privilege('anon', 'public.wf_att_submit(date, text, boolean, text, date, text)', 'execute')
            and has_function_privilege('authenticated', 'public.wf_att_submit(date, text, boolean, text, date, text)', 'execute')
            and not has_function_privilege('anon', 'public.wf_book_fill(date[], jsonb, date[], text, text)', 'execute')
            and has_function_privilege('authenticated', 'public.wf_book_fill(date[], jsonb, date[], text, text)', 'execute'),
  'both: signed-in users only');

-- ---------------------------------------------------------------- one date
select tests.login(tests.id('u_s1'));
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(8), 'absent', true)$$) ~ '^22023 .*application number', 'no number: refused');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(8), 'absent', true, null, null, '   ')$$) ~ '^22023 .*application number', 'spaces are not a number');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(8), 'absent', true, null, null, 'SF-77')$$) ~ '^22023 .*date you applied', 'no date: refused');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(8), 'absent', true, null, tests.day(11), 'SF-77')$$) ~ '^22023 .*after today', 'a date after today: refused');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(8), 'absent', true, null, tests.day(8) - 63, 'SF-77')$$) ~ '^22023 .*62 days', 'more than 62 days before: refused');
select tests.ok(tests.err($$select public.wf_att_submit(tests.day(8), 'absent', true, null, tests.day(8), repeat('৯', 61))$$) ~ '^22023 .*too long', 'a number over 60 characters: refused');
select tests.ok(tests.bd(8) ->> 'state' = 'missing', 'nothing was saved by the refused calls');

select tests.ok(public.wf_att_submit(tests.day(8), 'absent', true, null, tests.day(7), '  SF-77  ') is not null, 'with the number and the date: saved');
select tests.ok((select site_ref = 'SF-77' and site_applied_on = tests.day(7) and applied_on_site and status = 'waiting' from tests.mark('e1', 8)),
  'kept on the input (the number trimmed)');
select tests.ok(tests.bd(8) ->> 'site_ref' = 'SF-77' and (tests.bd(8) ->> 'site_applied_on')::date = tests.day(7), 'the book shows the number and the date');
select tests.ok(public.wf_att_submit(tests.day(8), 'absent', true, null, tests.day(7), 'SF-77') = (tests.mark('e1', 8)).id
            and tests.n_hist((tests.mark('e1', 8)).id) = 1, 'the same answer twice: no second input and no history line');
select public.wf_att_submit(tests.day(8), 'absent', true, null, tests.day(8), 'SF-78');
select tests.ok((select site_ref = 'SF-78' and site_applied_on = tests.day(8) from tests.mark('e1', 8))
            and tests.n_hist((tests.mark('e1', 8)).id, 'edited') = 1, 'a new number or date: changed, and "edited" in the history');
select tests.ok(public.wf_att_submit(tests.day(10), 'absent', true, null, tests.day(10), 'SF-90') is not null, 'today''s date with a number');
select public.wf_att_submit(tests.day(9), 'present');
select public.wf_att_submit(tests.day(9), 'absent', true, null, tests.day(9), 'SF-99');
select public.wf_att_submit(tests.day(9), 'present');
select tests.ok((select applied_on_site is null and site_ref is null and site_applied_on is null from tests.mark('e1', 9)),
  'back to present: the number and the date are cleared');
select public.wf_absence_apply(array[tests.day(6)], 'জ্বর');
select tests.ok((select applied_on_site = false and site_ref is null and site_applied_on is null from tests.mark('e1', 6)),
  'absent without a website application: no number, no date');
select tests.logout();
select tests.ok((select body from public.notifications where profile_id = tests.id('hub_mgr') and title = 'আজ আসেননি — অনুমোদন বাকি'
                  order by created_at desc limit 1) like '%নম্বর SF-90%', 'the hub manager''s note for today names the number');

-- a number written straight into a date that was not applied on the website is dropped (and the table rule backs it up)
update public.attendance_self_marks set site_ref = 'X', site_applied_on = tests.day(6) where employee_id = tests.id('e1') and work_date = tests.day(6);
select tests.ok((select site_ref is null and site_applied_on is null from tests.mark('e1', 6))
            and exists (select 1 from pg_constraint where conname = 'att_self_site_details' and convalidated),
  'a number without "applied on the website" is never kept');

-- ---------------------------------------------------------------- the manager sees it
select tests.login(tests.id('hub_mgr'));
select tests.ok((select m ->> 'site_ref' = 'SF-78' and (m ->> 'site_applied_on')::date = tests.day(8)
                   from jsonb_array_elements(public.wf_marks(null, tests.id('hub_a1'), tests.day(1), tests.day(10))) m
                  where m ->> 'id' = (tests.mark('e1', 8)).id::text),
  'the approval list shows the number and the date');
select tests.ok(public.wf_marks_decide(array[(tests.mark('e1', 8)).id], true, null, null) = 1
            and (select site_ref = 'SF-78' from tests.mark('e1', 8)), 'approving keeps them');
select tests.logout();

-- ---------------------------------------------------------------- many dates at once
select tests.login(tests.id('u_s2'));
select tests.ok(tests.err($$select public.wf_book_fill(null, '{"ref": "SF-1"}'::jsonb)$$) ~ '^22023 .*must be a list', 'p_site must be a list');
select tests.ok(tests.err($$select public.wf_book_fill(null, jsonb_build_array(jsonb_build_object('ref', 'SF-1', 'applied_on', tests.day(2), 'dates', '[]'::jsonb)))$$)
                ~ '^22023 .*absent dates', 'an application without dates: refused');
select tests.ok(tests.err($$select public.wf_book_fill(null, jsonb_build_array(tests.site(null, tests.day(2), tests.day(2))))$$) ~ '^22023 .*application number',
  'an application without a number: refused');
select tests.ok(tests.err($$select public.wf_book_fill(null, jsonb_build_array(tests.site('SF-1', null, tests.day(2))))$$) ~ '^22023 .*date you applied',
  'an application without its date: refused');
select tests.ok(tests.err($$select public.wf_book_fill(null, '[{"ref": "SF-1", "applied_on": "2026-02-31", "dates": ["2026-01-02"]}]'::jsonb)$$) ~ '^22023 .*not a date',
  'a date that does not exist: refused');
select tests.ok(tests.err($$select public.wf_book_fill(null, jsonb_build_array(tests.site('SF-1', tests.day(2), tests.day(2)), tests.site('SF-2', tests.day(3), tests.day(2))))$$)
                ~ '^22023 .*chosen twice', 'one date in two applications: refused');
select tests.ok(tests.err($$select public.wf_book_fill(array[tests.day(1)], jsonb_build_array(tests.site('SF-1', tests.day(12), tests.day(2))))$$)
                ~ ('^22023 On ' || tests.day(2) || ': .*after today'), 'an application date after today: the error names the absent date');
select tests.ok(tests.bd(1) ->> 'state' = 'missing', 'all or nothing: the present date of that call was not saved');

select tests.ok(public.wf_book_fill(array[tests.day(1)],
                                    jsonb_build_array(tests.site('SF-200', tests.day(4), tests.day(2), tests.day(3)), tests.site('SF-300', tests.day(9), tests.day(5))),
                                    array[tests.day(7)], 'অসুস্থ', null)
                  - 'application_id' = '{"present": 1, "site": 3, "absent": 1}'::jsonb, 'fill: one present, two website applications for three dates, one not applied');
select tests.ok(tests.bd(2) ->> 'site_ref' = 'SF-200' and tests.bd(3) ->> 'site_ref' = 'SF-200' and (tests.bd(3) ->> 'site_applied_on')::date = tests.day(4)
            and tests.bd(5) ->> 'site_ref' = 'SF-300' and (tests.bd(5) ->> 'site_applied_on')::date = tests.day(9),
  'each date carries its own application''s number and date');
select tests.ok(tests.bd(1) ->> 'site_ref' is null and tests.bd(7) ->> 'site_ref' is null and tests.bd(7) ->> 'application_no' like 'AB-%',
  'the present date and the not-applied date have none');
select tests.logout();
rollback;
