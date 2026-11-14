-- The day's sheet made easier: a payment from its ID alone, two lines for one rider,
-- who is keeping the sheet, closing the day, cash notes, and the lines that are there every day.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
insert into tests.ids values
  ('r1_emp', tests.active_employee('Easy Rider', '1001', tests.id('hub_a1'), '01711001001', '1001010101', 15000, tests.id('rider_login'))),
  ('hm_emp', tests.active_employee('Easy Boss', '1009', tests.id('hub_a1'), '01711001009', '1009090909', 30000, tests.id('hub_mgr')));
insert into public.merchants (code, name, hub_id) values ('MZ1', 'Naturals Glow RS', tests.id('hub_a1'));
insert into tests.ids select 'mz1', id from public.merchants where code = 'MZ1';
insert into public.merchant_payments (merchant_id, hub_id, zone_id, payment_date, amount, method, requested_by)
values (tests.id('mz1'), tests.id('hub_a1'), tests.id('zone_a'), current_date, 40598, 'cash', tests.id('super'));
insert into t select 'pay_no', payment_no from public.merchant_payments order by created_at desc limit 1;

select tests.login(tests.id('hub_mgr'));
insert into t values ('s1', public.da_start_session(tests.id('hub_a1'))::text);

-- ---------- a payment ID is written one way, however it is typed ----------
select tests.ok(private.da_payment_ref('101001') = 'SFC-101001', 'a plain number gets the prefix');
select tests.ok(private.da_payment_ref('sfc-101001') = 'SFC-101001', 'one already written with the prefix stays as it is');
select tests.ok(private.da_payment_ref(' 10 1001 ') = 'SFC-101001', 'spaces are ignored');
select tests.ok(private.da_payment_ref('') is null, 'nothing in, nothing out');

-- ---------- the ID and the amount are enough; nothing has to match ----------
insert into t values ('p1', public.da_save_merchant_payment((select v::uuid from t where k = 's1'), null, '101001', null, 1500, null)::text);
select tests.ok((select payment_ref = 'SFC-101001' and merchant_id is null and match_status = 'unmatched'
                   and payment_date = (select account_date from public.da_sessions where id = (select v::uuid from t where k = 's1'))
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'p1')),
  'a payment with no record behind it is written anyway, on the sheet''s day');
select tests.ok((select merchant_name = 'SFC-101001' from public.da_merchant_payments where id = (select v::uuid from t where k = 'p1')),
  'with nobody named, the payment goes by its own ID');

-- when this hub does have a record for that ID, the name comes along
insert into t values ('p2', public.da_save_merchant_payment((select v::uuid from t where k = 's1'), null,
  (select v from t where k = 'pay_no'), null, 40598, null)::text);
select tests.ok((select merchant_id = tests.id('mz1') and match_status = 'matched'
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'p2')),
  'a Payment ID this hub knows still fills in the merchant by itself');

-- the name read off a screenshot is kept when there is no merchant
insert into t values ('p3', public.da_save_merchant_payment((select v::uuid from t where k = 's1'), null, '202002', '52655971', 900, null,
  null, '{"payee":"AFRIN","confidence":88}'::jsonb)::text);
select tests.ok((select payee_name = 'AFRIN' and merchant_name = 'AFRIN'
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'p3')),
  'the person named on the screenshot is who the payment went to');
select tests.throws(format($$select public.da_save_merchant_payment(%L, null, '101001', null, 700, null)$$, (select v from t where k = 's1')),
  'the same payment cannot be written twice on one sheet', '23505');
select tests.throws(format($$select public.da_save_merchant_payment(%L, null, null, null, 700, null)$$, (select v from t where k = 's1')),
  'a payment with neither an ID nor a name is refused', '22023');

-- ---------- two lines for one rider ----------
insert into t values ('r1', public.da_save_rider_line((select v::uuid from t where k = 's1'), '1001', 10, 2, 5000, 4000, 1000)::text);
insert into t values ('r2', public.da_save_rider_line((select v::uuid from t where k = 's1'), '1001', 4, 0, 1800, 1800, 0)::text);
select tests.ok((select count(*) = 2 from public.da_rider_lines where session_id = (select v::uuid from t where k = 's1')
                   and employee_code = '1001' and removed_at is null),
  'a rider can have a second hisab on the same day');
select tests.logout();
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.double_rider_lines', 'false'::jsonb);
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.da_save_rider_line(%L, '1001', 1, 0, 100, 100, 0)$$, (select v from t where k = 's1')),
  'with the setting off, one rider keeps one line', '23505');
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.double_rider_lines', 'true'::jsonb);
select tests.login(tests.id('hub_mgr'));

-- ---------- who is keeping this sheet ----------
select tests.ok((select count(*) = 1 from public.da_collectors((select v::uuid from t where k = 's1'))),
  'whoever writes a line is on the sheet''s list of people keeping it');
select tests.ok((select riders = 2 and payments = 3 from public.da_collectors((select v::uuid from t where k = 's1'))),
  'the list counts what each person wrote');
select tests.ok((select closed_at is null from public.da_collectors((select v::uuid from t where k = 's1'))),
  'and nobody has finished yet');
select public.da_close_my_part((select v::uuid from t where k = 's1'), 'আমার অংশ শেষ');
select tests.ok((select closed_at is not null and note = 'আমার অংশ শেষ'
                 from public.da_collectors((select v::uuid from t where k = 's1'))),
  'closing your own part is written down, with your note');
select public.da_close_my_part((select v::uuid from t where k = 's1'), null, false);
select tests.ok((select closed_at is null from public.da_collectors((select v::uuid from t where k = 's1'))),
  'and it can be taken back');
select public.da_close_my_part((select v::uuid from t where k = 's1'));

-- ---------- cash notes ----------
insert into t values ('n1', public.da_note_save((select v::uuid from t where k = 's1'), 2500, 'bkash', '1001', null, 'বিকাশে পাঠিয়েছেন')::text);
select tests.ok((select from_employee = tests.id('r1_emp') or from_code = '1001'
                 from public.da_cash_notes where id = (select v::uuid from t where k = 'n1')),
  'a note says whose money it is');
select tests.throws(format($$select public.da_note_save(%L, 100, 'paypal')$$, (select v from t where k = 's1')),
  'an unknown way of handing money over is refused', '22023');
select tests.throws(format($$select public.da_note_save(%L, 100, 'cash')$$, (select v from t where k = 's1')),
  'a note with nobody and nothing written is refused', '22023');

-- the person it came from sees it on their own page
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 1 and bool_and(amount = 2500) from public.da_my_handovers()),
  'the rider sees the money written against their name');
select tests.login(tests.id('hub_mgr'));

-- ---------- closing the day ----------
select tests.ok((select closed_at is null from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'the day is open until it is closed');
insert into t values ('tot', public.da_close_day((select v::uuid from t where k = 's1'))::text);
select tests.ok(((select v from t where k = 'tot')::jsonb ->> 'payment_amount')::numeric = 42998,
  'closing keeps the day''s total payments');
select tests.ok(((select v from t where k = 'tot')::jsonb ->> 'rider_amount')::numeric = 6800,
  'and the day''s total rider accounts');
select tests.ok(((select v from t where k = 'tot')::jsonb ->> 'notes_in')::numeric = 2500,
  'and what came in on the notes');
select tests.ok((select closed_at is not null and closed_totals is not null
                 from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'the sheet remembers it was closed, and with what');
select tests.throws(format($$select public.da_reopen_day(%L, '')$$, (select v from t where k = 's1')),
  'reopening the day needs a reason', '22023');
select public.da_reopen_day((select v::uuid from t where k = 's1'), 'একটা খরচ বাদ পড়েছে');
select tests.ok((select closed_at is null from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'and it opens again');

-- ---------- the lines that are there every day ----------
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.fixed_riders', '["1001"]'::jsonb);
select public.da_configure('da.fixed_expenses',
  '[{"name":"হাব ভাড়া","category":"office_rent","kind":"transport","amount":500}]'::jsonb);
select tests.login(tests.id('hub_mgr'));
insert into t values ('s2', public.da_start_session(tests.id('hub_a1'), current_date - 1)::text);
select tests.ok((select count(*) = 1 from public.da_rider_lines where session_id = (select v::uuid from t where k = 's2')),
  'a new sheet opens with the rider who is on it every day');
select tests.ok((select count(*) = 1 and bool_and(expense_name = 'হাব ভাড়া' and amount = 500)
                 from public.da_expenses where session_id = (select v::uuid from t where k = 's2')),
  'and with the expense that is on it every day');
select tests.ok((public.da_apply_fixed((select v::uuid from t where k = 's2')) ->> 'riders')::int = 0,
  'asking again adds nothing twice');

rollback;
