-- The sheet as a tool: layout, report IDs, deposits with the bank charge, slips and "task complete", own columns.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

select tests.login(tests.id('hub_mgr'));
insert into t values ('s1', public.da_start_session(tests.id('hub_a1'))::text);

-- ---------- the bank charge comes from the amount ----------
select tests.ok(public.da_bank_charge(50000, 'bank', '2026-11-16') = 23, 'up to the limit: 20 + 15% VAT = 23');
select tests.ok(public.da_bank_charge(568652, 'bank', '2026-11-16') = 115, 'above the limit: 100 + 15% VAT = 115');
select tests.ok(public.da_bank_charge(568652, 'bank', '2026-11-13') = 0, 'nothing on a Friday');
select tests.ok(public.da_bank_charge(568652, 'bkash', '2026-11-16') = 0, 'a wallet has no bank charge');

-- only the settings person can change the slabs, and only to something sensible
select tests.throws($$select public.da_configure('da.bank_charge', '{"limit":1,"low":1,"high":1,"vat":15}'::jsonb)$$,
  'a hub manager cannot change the bank charge', '42501');
select tests.login(tests.id('acct_mgr'));
select tests.throws($$select public.da_configure('da.bank_charge', '{"limit":"x","low":1,"high":1,"vat":15}'::jsonb)$$,
  'a limit that is not a number is refused', '22023');
select tests.throws($$select public.da_configure('da.bank_charge', '{"limit":1,"low":1,"high":1,"vat":15,"off_days":[9]}'::jsonb)$$,
  'an off day that is not 1–7 is refused', '22023');
select public.da_configure('da.bank_charge',
  '{"limit":200000,"low":20,"high":100,"vat":15,"off_days":[5,6],"holidays":["2026-12-16"],"transport":60}'::jsonb);
select tests.ok(public.da_bank_charge(150000, 'bank', '2026-11-16') = 23, 'a new limit counts from the next deposit');
select tests.ok(public.da_bank_charge(150000, 'bank', '2026-12-16') = 0, 'nothing on a bank holiday');

-- the layout
select tests.throws($$select public.da_configure('da.layout', '{"riders":{"extra":[{"key":"bad key","label":"x"}]}}'::jsonb)$$,
  'an own column needs a plain x_ key', '22023');
select public.da_configure('da.layout', '{"riders":{"hidden":["মোবাইল"],"labels":{"টাকা":"মোট টাকা"},"extra":[{"key":"x_point","label":"পয়েন্ট"}]}}'::jsonb);
select tests.ok((public.da_settings() -> 'da.layout' -> 'riders' -> 'extra' -> 0 ->> 'label') = 'পয়েন্ট', 'the layout is kept');

-- ---------- report IDs ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('r1', public.da_report_save((select v::uuid from t where k = 's1'), ' #731417 ', 765496)::text);
select tests.ok((select report_no = '#731417' and amount = 765496 from public.da_report_ids where id = (select v::uuid from t where k = 'r1')),
  'a report ID is written with its amount');
select tests.throws(format($$select public.da_report_save(%L, '#731417', 10)$$, (select v from t where k = 's1')),
  'the same report ID cannot be written twice on one sheet', '23505');
select tests.throws(format($$select public.da_report_save(%L, '  ', 10)$$, (select v from t where k = 's1')),
  'a report ID cannot be empty', '22023');

-- ---------- deposits ----------
insert into t values ('d1', public.da_deposit_save((select v::uuid from t where k = 's1'), 568652, 'bank', 'Bank', null, null, '2026-11-16')::text);
select tests.ok((select charge = 115 and charge_auto and transport = 60 from public.da_deposits where id = (select v::uuid from t where k = 'd1')),
  'the deposit takes its charge and transport from the settings');
insert into t values ('d2', public.da_deposit_save((select v::uuid from t where k = 's1'), 1000, 'bank', null, null, null, '2026-11-14')::text);
select tests.ok((select charge = 0 and transport = 0 from public.da_deposits where id = (select v::uuid from t where k = 'd2')),
  'on a Saturday there is no charge and no transport');
select public.da_deposit_save((select v::uuid from t where k = 's1'), 1000, 'bank', null, null, null, '2026-11-14', 50, 10,
  null, null, (select v::uuid from t where k = 'd2'));
select tests.ok((select charge = 10 and not charge_auto and transport = 50 from public.da_deposits where id = (select v::uuid from t where k = 'd2')),
  'a charge or transport written by hand is kept as written');
select tests.throws(format($$select public.da_deposit_save(%L, 100, 'bank', null, null, 'da/00000000-0000-0000-0000-000000000000/x.jpg')$$,
  (select v from t where k = 's1')), 'a slip from another sheet is refused', '22023');

-- task complete needs every slip
select tests.throws(format($$select public.da_bank_done(%L)$$, (select v from t where k = 's1')),
  'the bank task cannot be finished without the slips', '22023');
select public.da_deposit_remove((select v::uuid from t where k = 'd2'), 'written twice');
select public.da_deposit_save((select v::uuid from t where k = 's1'), 568652, 'bank', 'Bank', 'REF-1',
  'da/' || (select v from t where k = 's1') || '/slip.jpg', '2026-11-16', null, null, null, null, (select v::uuid from t where k = 'd1'));
select public.da_bank_done((select v::uuid from t where k = 's1'));
select tests.ok((select bank_done_at is not null from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'with every slip up, the bank task is complete');
select public.da_report_save((select v::uuid from t where k = 's1'), '#731418', 5);
select tests.ok((select bank_done_at is null from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'changing the money afterwards opens the bank task again');

-- ---------- own columns ----------
select public.da_cell_set((select v::uuid from t where k = 's1'), 'riders', (select v::uuid from t where k = 'r1'), 'x_point', 'নাটোর সদর');
select tests.ok((select value = 'নাটোর সদর' from public.da_cells where session_id = (select v::uuid from t where k = 's1') and col_key = 'x_point'),
  'a value is kept in one''s own column');
select public.da_cell_set((select v::uuid from t where k = 's1'), 'riders', (select v::uuid from t where k = 'r1'), 'x_point', '  ');
select tests.ok(not exists (select 1 from public.da_cells where session_id = (select v::uuid from t where k = 's1')),
  'clearing the value removes it');
select tests.throws(format($$select public.da_cell_set(%L, 'riders', gen_random_uuid(), 'point', 'x')$$, (select v from t where k = 's1')),
  'only own columns (x_…) can be written', '22023');

-- the sheet carries all of it
select tests.ok((select jsonb_array_length(j -> 'report_ids') = 2 and jsonb_array_length(j -> 'deposits') = 1 and j ? 'cells' and j ? 'can_layout'
                 from (select public.da_sheet((select v::uuid from t where k = 's1')) j) x),
  'the sheet shows its report IDs, deposits and own columns');

-- ---------- another hub cannot touch it ----------
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.da_report_save(%L, '#1', 1)$$, (select v from t where k = 's1')),
  'a manager of another hub cannot write report IDs here', '42501');
select tests.throws(format($$select public.da_deposit_save(%L, 1)$$, (select v from t where k = 's1')),
  'nor deposits', '42501');
select tests.ok(not exists (select 1 from public.da_deposits), 'and cannot read them');

-- ---------- once submitted, nothing changes ----------
select tests.login(tests.id('hub_mgr'));
select public.da_save_merchant_payment((select v::uuid from t where k = 's1'), null, '101001', null, 1500, null);
select tests.logout();
update public.da_sheet_collectors set closed_at = now() where session_id = (select v::uuid from t where k = 's1');
select tests.login(tests.id('hub_mgr'));
select public.da_submit((select v::uuid from t where k = 's1'));
select tests.throws(format($$select public.da_deposit_save(%L, 5)$$, (select v from t where k = 's1')),
  'a submitted sheet takes no new deposit', '42501');

rollback;
