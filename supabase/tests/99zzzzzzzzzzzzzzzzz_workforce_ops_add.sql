-- আজকের কাজের হিসাব: এক ক্লিকে যোগ — every tap adds to the day's total and is counted.
-- Migration 20261122000800_workforce_ops_add.sql. The business clock is moved inside this transaction like the other workforce tests.
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
create function tests.row(p_emp text, p_day integer) returns public.wf_daily_ops language sql stable security definer as
  $$ select o from public.wf_daily_ops o where employee_id = tests.id(p_emp) and work_date = tests.day(p_day) $$;
select tests.set_today(10);

insert into tests.ids values ('u_t1', tests.make_user('tap1@test.local', 'Tap One')), ('u_t2', tests.make_user('tap2@test.local', 'Tap Two'));
insert into tests.ids values
  ('e1', tests.active_employee('Tap One', '961', tests.id('hub_a1'), '01711000961', '9610101010', 15000, tests.id('u_t1'))),
  ('e2', tests.active_employee('Tap Two', '962', tests.id('hub_a1'), '01711000962', '9620101010', 15000, tests.id('u_t2')));
select tests.grant_role(tests.id('u_t1'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('u_t2'), 'rider', 'hub', null, tests.id('hub_a1'));

select tests.ok(not has_function_privilege('anon', 'public.wf_ops_add(integer, integer, integer, integer, text, date)', 'execute')
            and has_function_privilege('authenticated', 'public.wf_ops_add(integer, integer, integer, integer, text, date)', 'execute')
            and not has_function_privilege('anon', 'public.wf_ops_taps(date)', 'execute')
            and has_function_privilege('authenticated', 'public.wf_ops_taps(date)', 'execute'), 'both: signed-in users only');
select tests.ok(public.wf_ops_taps() is null, 'signed out: no taps');

select tests.login(tests.id('u_t1'));
select tests.ok(public.wf_ops_taps() = jsonb_build_object('date', tests.day(10), 'count', 0, 'total', null, 'taps', '[]'::jsonb), 'nothing yet: 0 taps, no total');
select tests.ok(tests.err($$select public.wf_ops_add(-1, 0, 0, 0)$$) ~ '^22023 .*non-negative', 'a negative number is refused');
select tests.ok(tests.err($$select public.wf_ops_add(100001, 0, 0, 0)$$) ~ '^22023 .*at most', 'a number above 100000 is refused');
select tests.ok(tests.err($$select public.wf_ops_add(1, 0, 0, 0, null, tests.day(11))$$) ~ '^22023 .*future', 'a future day is refused');
select tests.ok(tests.err($$select public.wf_ops_add(1, 0, 0, 0, null, tests.day(8))$$) ~ '^42501', 'two days back is refused');

-- tap 1 (empty boxes are 0), tap 2, tap 3
select tests.ok((public.wf_ops_add(10, null, 20, null) ->> 'pickup')::integer = 10, 'tap 1: an empty box counts as 0');
select tests.ok((public.wf_ops_add(5, 1, 7, 2, 'দুপুর') ->> 'pickup')::integer = 15, 'tap 2 adds');
select tests.ok(public.wf_ops_add(0, 2, 3, 0) is not null, 'tap 3 adds');
select tests.ok((select (pickup, pickup_return, delivery, delivery_return, revision, note) = (15, 3, 30, 2, 3, 'দুপুর') from tests.row('e1', 10)),
  'one row per day: it holds the total (15 · 3 · 30 · 2), revision 3, the last note');
select tests.ok((public.wf_ops_taps() ->> 'count')::integer = 3
            and public.wf_ops_taps() -> 'total' = '{"pickup": 15, "pickup_return": 3, "delivery": 30, "delivery_return": 2}'::jsonb, 'taps: count 3 and the total');
select tests.ok((select array_agg((t ->> 'pickup')::integer || '/' || (t ->> 'pickup_return') || '/' || (t ->> 'delivery') || '/' || (t ->> 'delivery_return') order by ord)
                   from jsonb_array_elements(public.wf_ops_taps() -> 'taps') with ordinality x(t, ord)) = array['0/2/3/0', '5/1/7/2', '10/0/20/0'],
  'each tap with its own numbers, newest first');
select tests.ok((select array_agg(action order by revision) from public.wf_ops_history where entry_id = (tests.row('e1', 10)).id) = array['submitted', 'added', 'added'],
  'history: submitted, then added, added');
select tests.ok(tests.err($$select public.wf_ops_add(0, 0, 0, 0)$$) ~ '^22023 .*Nothing to add', 'all zero after the first tap: nothing to add');
select tests.ok(tests.err($$select public.wf_ops_add(99990, 0, 0, 0)$$) ~ '^22023 .*day total', 'the day total cannot pass 100000');
select tests.ok((public.wf_ops_taps() ->> 'count')::integer = 3, 'refused taps are not counted');

-- yesterday is its own day
select tests.ok(public.wf_ops_add(4, 0, 4, 0, null, tests.day(9)) is not null, 'yesterday can be added to');
select tests.ok((public.wf_ops_taps(tests.day(9)) ->> 'count')::integer = 1
            and (public.wf_ops_taps() ->> 'count')::integer = 3, 'yesterday counts on its own');

-- a first tap of all zero is a report ("no work today")
select tests.login(tests.id('u_t2'));
select tests.ok((public.wf_ops_add(0, 0, 0, 0) ->> 'pickup')::integer = 0, 'the first tap may be all zero');
select tests.ok((public.wf_ops_taps() ->> 'count')::integer = 1 and public.wf_ops_taps() #>> '{total,pickup}' = '0', 'and each person sees only their own taps');

-- the manager corrects: the person can no longer add
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.err(format($$select public.wf_ops_correct(%L, 14, 3, 30, 2, 'গণনায় ভুল')$$, (tests.row('e1', 10)).id)) is null, 'the hub manager corrects');
select tests.login(tests.id('u_t1'));
select tests.ok(tests.err($$select public.wf_ops_add(1, 0, 0, 0)$$) ~ '^42501 .*corrected', 'after a correction the person cannot add');
select tests.ok((public.wf_ops_taps() ->> 'count')::integer = 3 and public.wf_ops_taps() #>> '{total,pickup}' = '14', 'the correction is not a tap; the total follows it');

-- the old "replace" call still works the old way
select tests.login(tests.id('u_t2'));
select tests.ok((public.wf_ops_submit(9, 0, 9, 0) ->> 'pickup')::integer = 9, 'wf_ops_submit still works');
select tests.ok((public.wf_ops_taps() ->> 'count')::integer = 1 and public.wf_ops_taps() #>> '{total,pickup}' = '9', 'wf_ops_submit still replaces (an edit, not a tap)');
select tests.logout();
rollback;
