-- A merchant payment written from the Payment ID and the amount alone; the company's own
-- expense voucher for a cost with no bill; and the expense categories handbook.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into public.merchants (code, name, hub_id) values
  ('MX1', 'Naturals Glow RS', tests.id('hub_a1')),
  ('MX2', 'Other Shop',       tests.id('hub_b1'));
insert into tests.ids select 'mx_' || lower(code::text), id from public.merchants where code in ('MX1','MX2');
insert into public.merchant_payments (merchant_id, hub_id, zone_id, payment_date, amount, method, requested_by)
values (tests.id('mx_mx1'), tests.id('hub_a1'), tests.id('zone_a'), current_date, 40598, 'cash', tests.id('super'));
insert into t select 'pay_no', payment_no from public.merchant_payments order by created_at desc limit 1;

-- the hub manager opens today's sheet
select tests.login(tests.id('hub_mgr'));
insert into t values ('s1', public.da_start_session(tests.id('hub_a1'))::text);

-- ---------- Payment ID + amount is enough ----------
insert into t values ('p1', public.da_save_merchant_payment(
  (select v::uuid from t where k = 's1'), null, (select v from t where k = 'pay_no'), null, 40598, null)::text);
select tests.ok((select merchant_id = tests.id('mx_mx1') and merchant_name = 'Naturals Glow RS'
                   and match_status = 'matched' and payment_date = current_date
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'p1')),
  'the merchant, the name and the date come from the hub''s own record for that Payment ID');

insert into t values ('p_free', public.da_save_merchant_payment((select v::uuid from t where k = 's1'), null, 'SFC-00000000', null, 500, null)::text);
select tests.ok((select merchant_id is null and match_status = 'unmatched' and merchant_name = 'SFC-00000000'
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'p_free')),
  'a Payment ID the hub has no record of is written anyway, with nothing invented');
select tests.throws(format($$select public.da_save_merchant_payment(%L, null, null, null, 500, null)$$,
                           (select v from t where k = 's1')),
  'neither a Payment ID nor a merchant is refused', '22023');
select tests.throws(format($$select public.da_save_merchant_payment(%L, %L, 'SFC-11111111', null, 0, null)$$,
                           (select v from t where k = 's1'), tests.id('mx_mx1')),
  'an amount of zero is refused', '22023');
select tests.throws(format($$select public.da_save_merchant_payment(%L, %L, null, null, 100, current_date + 1)$$,
                           (select v from t where k = 's1'), tests.id('mx_mx1')),
  'a payment date in the future is still refused', '22023');
select tests.throws(format($$select public.da_save_merchant_payment(%L, %L, null, null, 100, null)$$,
                           (select v from t where k = 's1'), tests.id('mx_mx2')),
  'a merchant of another hub is still refused', '22023');

-- what the screenshot said is kept beside the line
insert into t values ('p2', public.da_save_merchant_payment(
  (select v::uuid from t where k = 's1'), tests.id('mx_mx1'), 'SFC-33223762', '52655971', 1200, null,
  null, '{"payee":"AFRIN","paid_by":"Maruful OSD","confidence":88}'::jsonb)::text);
select tests.ok((select payee_name = 'AFRIN' and transaction_id = '52655971' and match_status = 'unmatched'
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'p2')),
  'the name read from the screenshot is kept, and an unknown Payment ID is marked unmatched');
select tests.ok((select payment_date = (select account_date from public.da_sessions where id = (select v::uuid from t where k = 's1'))
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'p2')),
  'with no date and no record, the payment takes the sheet''s own day');

-- ---------- the company's own voucher ----------
insert into t values ('x1', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Van bhara to Gurudaspur', 'transport', 450, private.da_today())::text);
insert into t values ('v1', public.da_make_voucher((select v::uuid from t where k = 'x1')));
select tests.ok((select v ~ '^V-[0-9]{4}-[0-9]{5}$' from t where k = 'v1'), 'the voucher number carries the month and a serial');
select tests.ok(public.da_make_voucher((select v::uuid from t where k = 'x1')) = (select v from t where k = 'v1'),
  'asking twice gives the same voucher, not a second one');
select tests.ok((select (public.da_voucher((select v::uuid from t where k = 'x1')) ->> 'amount')::numeric = 450),
  'the voucher carries the amount of the expense');
select tests.ok((select public.da_voucher((select v::uuid from t where k = 'x1')) ->> 'hub') = 'Hub A1',
  'the voucher names the hub it belongs to');

insert into t values ('x2', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Office rent', 'office_rent', 9000, private.da_today(), 'BILL-7788')::text);
select tests.throws(format($$select public.da_make_voucher(%L)$$, (select v from t where k = 'x2')),
  'an expense that already has a bill gets no voucher', '22023');

-- someone who cannot edit the sheet cannot make a voucher either
select tests.login(tests.id('rider'));
select tests.throws(format($$select public.da_make_voucher(%L)$$, (select v from t where k = 'x1')),
  'a rider cannot make a voucher on a hub sheet', '42501');

-- ---------- the categories handbook ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) >= 21 from jsonb_array_elements(private.da_setting('da.expense_categories'))),
  'every category of the handbook is there');
select tests.ok(not exists (select 1 from jsonb_array_elements(private.da_setting('da.expense_categories')) c
                             where coalesce(c ->> 'note_bn', '') = ''),
  'each category says what belongs in it');
select tests.ok((select c ->> 'site_sub' = 'Vehicle Mamla Purpose' and (c ->> 'site_receipt')::boolean
                 from jsonb_array_elements(private.da_setting('da.expense_categories')) c
                 where c ->> 'code' = 'penalties'),
  'the main-site sub-head and receipt rule are kept with the category');
select tests.ok((select (c ->> 'site_limit')::numeric = 3000
                 from jsonb_array_elements(private.da_setting('da.expense_categories')) c
                 where c ->> 'code' = 'transport'),
  'the main-site limit is kept with the category');
select tests.ok((select c ->> 'site_name' is null and c ->> 'site_note_bn' is not null
                 from jsonb_array_elements(private.da_setting('da.expense_categories')) c
                 where c ->> 'code' = 'entertainment'),
  'a category that does not go to the main site says so');

-- head office may rewrite the handbook, a hub manager may not
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.expense_categories',
  '[{"code":"transport","en":"Transport","bn":"যাতায়াত","note_bn":"পার্সেল ডেলিভারি ও যাতায়াত।","site_name":"Transport","site_sub":"All Hub","site_limit":4000,"site_receipt":true}]'::jsonb);
select tests.ok((select (c ->> 'site_limit')::numeric = 4000
                 from jsonb_array_elements(private.da_setting('da.expense_categories')) c
                 where c ->> 'code' = 'transport'),
  'head office can change the main-site limit of a category');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.da_configure('da.expense_categories', '[]'::jsonb)$$,
  'a hub manager cannot rewrite the handbook', '42501');

rollback;
