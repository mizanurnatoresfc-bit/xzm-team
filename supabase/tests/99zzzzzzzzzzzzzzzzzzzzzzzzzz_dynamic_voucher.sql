-- The expense voucher number and the automatic voucher follow the setting da.voucher.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

-- ---------- the default is exactly the old behaviour ----------
select tests.ok((select value ->> 'prefix' = 'V-' and value ->> 'date' = 'YYMM' and (value ->> 'digits')::int = 5
                   and value ->> 'reset' = 'never' and not (value ->> 'per_hub')::boolean and (value ->> 'auto_on_submit')::boolean
                 from public.system_settings where key = 'da.voucher'),
  'the setting starts as V-, YYMM, 5 digits, never reset, one count, auto voucher on');

select tests.login(tests.id('hub_mgr'));
insert into t values ('s1', public.da_start_session(tests.id('hub_a1'))::text);
insert into t values ('x1', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Van bhara', 'transport', 450, private.da_today())::text);
insert into t values ('v1', public.da_make_voucher((select v::uuid from t where k = 'x1')));
select tests.ok((select v ~ ('^V-' || to_char(private.da_today(), 'YYMM') || '-[0-9]{5}$') from t where k = 'v1'),
  'with the default setting the number still looks like V-YYMM-00001');

-- ---------- only someone allowed to change settings can change it, and only to something safe ----------
select tests.throws($$select public.da_configure('da.voucher', '{"prefix":"AV-","date":"YYMMDD","digits":3,"reset":"daily","per_hub":true,"hub_code":true,"auto_on_submit":true}')$$,
  'a hub manager cannot change the voucher setting', '42501');

select tests.login(tests.id('acct_mgr'));
select tests.throws($$select public.da_configure('da.voucher', '{"prefix":"AV-","date":"YYMM","digits":3,"reset":"daily","per_hub":false,"hub_code":false,"auto_on_submit":true}')$$,
  'a daily restart without the day in the number is refused (it would repeat numbers)', '22023');
select tests.throws($$select public.da_configure('da.voucher', '{"prefix":"AV-","date":"none","digits":3,"reset":"monthly","per_hub":false,"hub_code":false,"auto_on_submit":true}')$$,
  'a monthly restart without the month in the number is refused', '22023');
select tests.throws($$select public.da_configure('da.voucher', '{"prefix":"AV-","date":"YYMM","digits":3,"reset":"never","per_hub":true,"hub_code":false,"auto_on_submit":true}')$$,
  'a count per hub without the hub code is refused (two hubs would share numbers)', '22023');
select tests.throws($$select public.da_configure('da.voucher', '{"prefix":"A V<","date":"YYMM","digits":3,"reset":"never","per_hub":false,"hub_code":false,"auto_on_submit":true}')$$,
  'a prefix with spaces or symbols is refused', '22023');
select tests.throws($$select public.da_configure('da.voucher', '{"prefix":"AV-","date":"YYMM","digits":12,"reset":"never","per_hub":false,"hub_code":false,"auto_on_submit":true}')$$,
  'more than 8 digits is refused', '22023');
select tests.throws($$select public.da_configure('da.voucher', '{"prefix":"AV-","date":"YYMM","digits":4,"reset":"never","per_hub":false,"hub_code":false}')$$,
  'a missing switch is refused', '22023');

-- ---------- a per-hub, daily count with the hub code ----------
select public.da_configure('da.voucher', '{"prefix":"AV-","date":"YYMMDD","digits":3,"reset":"daily","per_hub":true,"hub_code":true,"auto_on_submit":true}');
select tests.logout();
select tests.ok(exists (select 1 from public.audit_logs where module = 'da' and action = 'CONFIGURE' and record_id = 'da.voucher'),
  'the change is written to the audit log');

select tests.login(tests.id('hub_mgr'));
insert into t values ('x2', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Toll', 'toll', 150, private.da_today())::text);
insert into t values ('x3', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Lunch', 'meal', 200, private.da_today())::text);
insert into t values ('v2', public.da_make_voucher((select v::uuid from t where k = 'x2')));
insert into t values ('v3', public.da_make_voucher((select v::uuid from t where k = 'x3')));
select tests.ok((select v = 'AV-' || (select upper(code::text) from public.hubs where id = tests.id('hub_a1')) || '-' || to_char(private.da_today(), 'YYMMDD') || '-001'
                 from t where k = 'v2'),
  'the first voucher of the day for this hub is AV-<hub code>-YYMMDD-001');
select tests.ok((select v like '%-002' from t where k = 'v3'), 'the next one is 002');
select tests.ok(public.da_make_voucher((select v::uuid from t where k = 'x2')) = (select v from t where k = 'v2'),
  'asking again for the same expense gives the same number');

-- another hub keeps its own count
select tests.login(tests.id('hub_b_mgr'));
insert into t values ('s2', public.da_start_session(tests.id('hub_b1'))::text);
insert into t values ('x4', public.da_save_expense((select v::uuid from t where k = 's2'), 'transport', null,
  'Van', 'transport', 100, private.da_today())::text);
insert into t values ('v4', public.da_make_voucher((select v::uuid from t where k = 'x4')));
select tests.ok((select v like '%-001' and v <> (select v from t where k = 'v2') from t where k = 'v4'),
  'a second hub starts its own count at 001 and never shares a number');

-- a number that already exists is skipped, never reused
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.voucher', '{"prefix":"V-","date":"YYMM","digits":5,"reset":"monthly","per_hub":false,"hub_code":false,"auto_on_submit":true}');
select tests.login(tests.id('hub_mgr'));
insert into t values ('x5', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Rickshaw', 'transport', 60, private.da_today())::text);
insert into t values ('v5', public.da_make_voucher((select v::uuid from t where k = 'x5')));
select tests.ok((select count(*) = 1 from public.da_expenses where lower(voucher_no) = lower((select v from t where k = 'v5'))),
  'after switching to a monthly count the new number does not repeat the old V-YYMM-00001');
select tests.ok((select v <> (select v from t where k = 'v1') from t where k = 'v5'), 'the old number is skipped');
-- the count starts again (as on the first of a month) while this month's numbers already exist
select tests.logout();
delete from public.da_voucher_counters;
select tests.login(tests.id('hub_mgr'));
insert into t values ('x7', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Auto', 'transport', 70, private.da_today())::text);
insert into t values ('v7', public.da_make_voucher((select v::uuid from t where k = 'x7')));
select tests.ok((select v <> (select v from t where k = 'v5') and v like '%-00002' from t where k = 'v7'),
  'a number that is already taken is skipped: the next free one is used, never a duplicate');

-- the counter table cannot be read or written directly
select tests.throws($$select * from public.da_voucher_counters$$, 'people cannot read the counters directly', '42501');

-- ---------- auto voucher on submit can be switched off ----------
insert into t values ('x6', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Tea', 'meal', 80, private.da_today())::text);
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.voucher', '{"prefix":"V-","date":"YYMM","digits":5,"reset":"never","per_hub":false,"hub_code":false,"auto_on_submit":false}');
select tests.login(tests.id('hub_mgr'));
select public.da_close_my_part((select v::uuid from t where k = 's1'));
select tests.throws(format($$select public.da_submit(%L, 'test')$$, (select v from t where k = 's1')),
  'with the auto voucher off, a sheet with an expense that has neither bill nor voucher is not submitted', '22023');
select tests.ok((select voucher_no is null from public.da_expenses where id = (select v::uuid from t where k = 'x6')),
  'and no voucher was made for it');

select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.voucher', '{"prefix":"V-","date":"YYMM","digits":5,"reset":"never","per_hub":false,"hub_code":false,"auto_on_submit":true}');
select tests.login(tests.id('hub_mgr'));
select public.da_submit((select v::uuid from t where k = 's1'), 'test');
select tests.ok((select voucher_no is not null from public.da_expenses where id = (select v::uuid from t where k = 'x6')),
  'with the auto voucher on, submitting makes the missing voucher by itself');
select tests.ok((select status = 'submitted' from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'and the sheet is submitted');

rollback;
