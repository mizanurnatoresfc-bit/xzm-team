-- Daily Accounts (আজকের হিসাব খাতা): start, rider lines, due rules, merchant cash payments,
-- expenses, OCR confirmation, submit once, correction, verification (maker ≠ checker),
-- Accounts Manager assignment, scope (RLS), history, page tracking, dashboard, reports, My Accounts.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('acct2',  tests.make_user('acct2@test.local', 'Accounts Two')),
  ('rider2', tests.make_user('rider2.da@test.local', 'Rider Two Login'));
select tests.grant_role(tests.id('acct2'), 'accounts_manager');
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('rider2'), 'rider', 'hub', null, tests.id('hub_a1'));
insert into tests.ids values
  ('emp_r1', tests.active_employee('Rider One',  '21', tests.id('hub_a1'), '01711000021', '1234567821', 15000, tests.id('rider_login'))),
  ('emp_r2', tests.active_employee('Rider Two',  '22', tests.id('hub_a1'), '01711000022', '1234567822', 15000, tests.id('rider2'))),
  ('emp_hm', tests.active_employee('Hub Boss',   '23', tests.id('hub_a1'), '01711000023', '1234567823', 30000, tests.id('hub_mgr'))),
  ('emp_rb', tests.active_employee('Rider B',    '25', tests.id('hub_b1'), '01711000025', '1234567825'));
insert into public.merchants (code, name, hub_id) values
  ('M1', 'Merchant One', tests.id('hub_a1')), ('MB', 'Merchant B', tests.id('hub_b1'));
insert into tests.ids select 'm_' || lower(code::text), id from public.merchants;
insert into public.merchant_payments (merchant_id, hub_id, zone_id, payment_date, amount, method, requested_by)
values (tests.id('m_m1'), tests.id('hub_a1'), tests.id('zone_a'), current_date - 1, 5000, 'cash', tests.id('hub_mgr')),
       -- a second payment of the hub's own, for the sheet-written-with-the-wrong-amount case
       (tests.id('m_m1'), tests.id('hub_a1'), tests.id('zone_a'), current_date - 1, 7000, 'cash', tests.id('hub_mgr'));
create temp table t (k text primary key, v text);
grant all on t to authenticated;
insert into t select 'payment_no', payment_no from public.merchant_payments where amount = 5000;

-- ---------- 1. Starting today's account ----------
select tests.login_anon();
select tests.throws(format($$select public.da_start_session(%L)$$, tests.id('hub_a1')), 'anonymous users cannot start a sheet', '42501');
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.da_start_session(%L)$$, tests.id('hub_a1')), 'a hub manager cannot start another hub''s sheet', '42501');
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.da_start_session(%L)$$, tests.id('hub_a1')), 'a rider cannot start the hub sheet', '42501');

select tests.login(tests.id('hub_mgr'));
insert into t values ('s1', public.da_start_session(tests.id('hub_a1'))::text);
select tests.ok((select status = 'open' and account_date = private.da_today() and started_by = tests.id('hub_mgr')
                        and started_by_name = 'Hub Boss' and started_by_code = '23'
                 from public.da_sessions where id = (select v::uuid from t where k = 's1')),
                'start saves the date, the hub and who started it (ID and name) automatically');
select tests.ok((select count(*) = 1 from public.da_events where session_id = (select v::uuid from t where k = 's1') and action = 'started'),
                'starting is written to the sheet history');
select tests.throws(format($$select public.da_start_session(%L)$$, tests.id('hub_a1')), 'only one sheet per hub per date', '23505');
select tests.throws(format($$select public.da_start_session(%L, private.da_today() + 1)$$, tests.id('hub_a1')), 'a sheet cannot be started for a future date', '22023');
select tests.throws(format($$select public.da_start_session(%L, private.da_today() - 10)$$, tests.id('hub_a1')), 'a sheet cannot be back-dated beyond the allowed days', '22023');
insert into t values ('s_old', public.da_start_session(tests.id('hub_a1'), private.da_today() - 1)::text);
select tests.ok((select v from t where k = 's_old') is not null, 'a sheet can be started for a recent past date');

-- start-time rule
select tests.logout();
update public.system_settings set value = '"23:59"' where key = 'da.start_time';
select tests.login(tests.id('admin'));
do $$ begin
  if (now() at time zone 'Asia/Dhaka')::time < '23:59' then
    perform tests.throws(format($q$select public.da_start_session(%L)$q$, tests.id('hub_a2')), 'today''s sheet cannot be started before the configured start time', '22023');
  else
    raise notice 'PASS: start time (skipped — test ran after 23:59 Dhaka time)';
  end if;
end $$;
select tests.logout();
update public.system_settings set value = '"00:00"' where key = 'da.start_time';

-- ---------- 2. Look-ups and rider lines ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select allowed and full_name = 'Rider One' and mobile = '01711000021' from public.da_lookup_employee(tests.id('hub_a1'), '21')),
                'typing an Employee ID returns name, mobile and hub');
select tests.ok((select not allowed from public.da_lookup_employee(tests.id('hub_a1'), '25')),
                'an employee of another hub is flagged as not allowed');
select tests.ok((select count(*) >= 3 from public.da_hub_employees(tests.id('hub_a1'))), 'hub-wise employee list');

insert into t values ('l1', public.da_save_rider_line((select v::uuid from t where k = 's1'), '21', 40, 12, 18000, 0, 2500, 1500, 'evening shift')::text);
select tests.ok((select rider_name = 'Rider One' and mobile = '01711000021' and employee_code = '21' and due = 2500 and mobile_banking = 1500
                 from public.da_rider_lines where id = (select v::uuid from t where k = 'l1')),
                'rider line is filled from the employee record; mobile banking does not change the due (separate rule)');
insert into t values ('l1b', public.da_save_rider_line((select v::uuid from t where k = 's1'), '21', 1, 1, 1, 0, 0, 0)::text);
select tests.ok((select count(*) = 2 from public.da_rider_lines where session_id = (select v::uuid from t where k = 's1')
                   and employee_code = '21' and removed_at is null),
                'one rider can have a second hisab on the same sheet (see 99j for the setting that stops it)');
select public.da_remove_line('rider', (select v::uuid from t where k = 'l1b'), 'দুইবার লেখা হয়েছিল');
select tests.throws(format($$select public.da_save_rider_line(%L, '25', 1, 1, 1, 0, 0, 0)$$, (select v from t where k = 's1')),
                    'a rider of another hub cannot be added', '22023');
select tests.throws(format($$select public.da_save_rider_line(%L, '999', 1, 1, 1, 0, 0, 0)$$, (select v from t where k = 's1')),
                    'an unknown Employee ID is rejected', '22023');
select tests.throws(format($$select public.da_save_rider_line(%L, '22', -1, 1, 1, 0, 0, 0)$$, (select v from t where k = 's1')),
                    'negative quantities are rejected', '22023');

-- due rules from settings
select tests.throws($$select public.da_configure('da.due_rule', '"amount_minus_paid"')$$, 'a hub manager cannot change the settings', '42501');
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.due_rule', '"amount_minus_paid"');
select tests.throws($$select public.da_configure('da.due_rule', '"guess"')$$, 'an unknown due rule is rejected', '22023');
select tests.throws($$select public.da_configure('da.start_time', '"25:00"')$$, 'an invalid start time is rejected', '22023');
select tests.login(tests.id('hub_mgr'));
insert into t values ('l2', public.da_save_rider_line((select v::uuid from t where k = 's1'), '22', 30, 5, 5000, 4000, 0, 300)::text);
select tests.ok((select due = 1000 from public.da_rider_lines where id = (select v::uuid from t where k = 'l2')),
                'amount − paid rule: due = 1000, mobile banking kept separate');
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.mobile_banking_rule', '"reduces_due"');
select tests.login(tests.id('hub_mgr'));
select public.da_save_rider_line((select v::uuid from t where k = 's1'), '22', 30, 5, 5000, 4000, 0, 300, null, (select v::uuid from t where k = 'l2'));
select tests.ok((select due = 700 from public.da_rider_lines where id = (select v::uuid from t where k = 'l2')),
                'when the rule says so, mobile banking reduces the due');
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.mobile_banking_rule', '"separate"');
select public.da_configure('da.due_rule', '"manual"');

-- ---------- 3. Merchant cash payments ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 1 from public.da_match_payment(tests.id('hub_a1'), (select v from t where k = 'payment_no'))),
                'Payment ID is matched against existing merchant payments');
insert into t values ('mp1', public.da_save_merchant_payment((select v::uuid from t where k = 's1'), tests.id('m_m1'),
       (select v from t where k = 'payment_no'), 'TXN-1001', 5000, private.da_today())::text);
select tests.ok((select match_status = 'matched' and matched_payment_id is not null and merchant_name = 'Merchant One'
                 from public.da_merchant_payments where id = (select v::uuid from t where k = 'mp1')),
                'same merchant and amount = matched');
insert into t select 'payment_no2', payment_no from public.merchant_payments where amount = 7000 limit 1;
insert into t values ('mp2', public.da_save_merchant_payment((select v::uuid from t where k = 's1'), tests.id('m_m1'),
       (select v from t where k = 'payment_no2'), 'TXN-1002', 4500, private.da_today())::text);
select tests.ok((select match_status = 'mismatch' from public.da_merchant_payments where id = (select v::uuid from t where k = 'mp2')),
                'different amount = mismatch is shown');
select tests.throws(format($$select public.da_save_merchant_payment(%L, %L, %L, 'TXN-1003', 5000, private.da_today())$$,
                           (select v from t where k = 's1'), tests.id('m_m1'), (select v from t where k = 'payment_no')),
                    'the same Payment ID cannot be written twice on one sheet', '23505');
select tests.throws(format($$select public.da_save_merchant_payment(%L, %L, null, 'txn-1001', 100, private.da_today())$$,
                           (select v from t where k = 's1'), tests.id('m_m1')),
                    'the same transaction ID cannot be recorded twice', '23505');
select tests.throws(format($$select public.da_save_merchant_payment(%L, %L, null, 'TXN-9', 100, private.da_today())$$,
                           (select v from t where k = 's1'), tests.id('m_mb')),
                    'a merchant of another hub cannot be used', '22023');
select tests.throws(format($$select public.da_save_merchant_payment(%L, %L, null, 'TXN-9', 100, private.da_today() + 1)$$,
                           (select v from t where k = 's1'), tests.id('m_m1')),
                    'a payment date in the future is rejected', '22023');
-- read by OCR, not yet confirmed
insert into t values ('mp3', public.da_save_merchant_payment((select v::uuid from t where k = 's1'), tests.id('m_m1'), null, 'TXN-1003', 2200,
       private.da_today(), null, '{"amount":2200,"transaction_id":"TXN-1003","confidence":71}', false)::text);

-- ---------- 4. Expenses ----------
select tests.throws(format($$select public.da_save_expense(%L, 'employee', null, 'Lunch', 'meal', 120, private.da_today())$$, (select v from t where k = 's1')),
                    'an employee expense needs the Employee ID', '22023');
select tests.throws(format($$select public.da_save_expense(%L, 'transport', null, 'Van rent', 'flying', 120, private.da_today())$$, (select v from t where k = 's1')),
                    'an unknown category is rejected', '22023');
insert into t values ('x1', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', '21', 'CNG to Natore', 'transport', 350,
       private.da_today(), 'B-77', 'EXP-1')::text);
insert into t values ('x2', public.da_save_expense((select v::uuid from t where k = 's1'), 'employee', '22', 'Mobile recharge', 'office', 1200,
       private.da_today(), null, 'EXP-2')::text);
select tests.ok((select employee_name = 'Rider Two' and category = 'office' from public.da_expenses where id = (select v::uuid from t where k = 'x2')),
                'expense is linked to the hub employee by ID');
select tests.throws(format($$select public.da_save_expense(%L, 'transport', null, 'Second bill', 'transport', 50, private.da_today(), null, 'exp-1')$$, (select v from t where k = 's1')),
                    'the same reference number cannot be used twice in a hub', '23505');
select tests.throws(format($$select public.da_save_expense(%L, 'transport', null, 'Bad path', 'transport', 50, private.da_today(), null, null, 'other/file.png')$$, (select v from t where k = 's1')),
                    'a bill must be stored under this sheet''s folder', '23514');

-- ---------- 5. Submit: checks first, then once ----------
select tests.throws(format($$select public.da_submit(%L)$$, (select v from t where k = 's1')),
                    'submit is blocked while OCR values are unconfirmed', '22023');
select public.da_save_merchant_payment((select v::uuid from t where k = 's1'), tests.id('m_m1'), null, 'TXN-1003', 2200,
       private.da_today(), null, null, true, null, (select v::uuid from t where k = 'mp3'));
select tests.throws(format($$select public.da_submit(%L)$$, (select v from t where k = 's1')),
                    'an expense of 1,000 or more needs a bill attached', '22023');
select public.da_save_expense((select v::uuid from t where k = 's1'), 'employee', '22', 'Mobile recharge', 'office', 1200, private.da_today(),
       null, 'EXP-2', 'da/' || (select v from t where k = 's1') || '/bill.png', null, null, false, null, null, (select v::uuid from t where k = 'x2'));
select tests.throws(format($$select public.da_remove_line('rider', %L, ' ')$$, (select v from t where k = 'l2')), 'removing a line needs a reason', '22023');
select public.da_remove_line('merchant', (select v::uuid from t where k = 'mp2'), 'entered by mistake');
-- every khata on the sheet is closed before the hub submits (live rule since manager_ledgers_rider_submit)
select public.da_close_my_part((select v::uuid from t where k = 's1'));
select public.da_submit((select v::uuid from t where k = 's1'), 'All checked');
select tests.ok((select status = 'submitted' and submitted_by = tests.id('hub_mgr') and submitted_by_name = 'Hub Boss'
                        and submitted_at is not null and submit_count = 1
                 from public.da_sessions where id = (select v::uuid from t where k = 's1')),
                'submit saves the submitter''s ID, name and time');
select tests.ok((select snapshot -> 'totals' ->> 'merchant_cash' = '7200.00' or (snapshot -> 'totals' ->> 'merchant_cash')::numeric = 7200
                 from public.da_events where session_id = (select v::uuid from t where k = 's1') and action = 'submitted'),
                'the submitted sheet is kept as a snapshot (removed lines excluded)');
select tests.throws(format($$select public.da_submit(%L)$$, (select v from t where k = 's1')), 'a sheet cannot be submitted twice', '42501');
select tests.throws(format($$select public.da_save_rider_line(%L, '22', 1, 1, 1, 0, 0, 0, null, %L)$$, (select v from t where k = 's1'), (select v from t where k = 'l2')),
                    'after submit, lines cannot be changed without correction permission', '42501');
select tests.throws(format($$select public.da_reopen(%L, 'typo')$$, (select v from t where k = 's1')),
                    'a hub manager without correction permission cannot reopen', '42501');

-- ---------- 6. Verification ----------
select tests.throws(format($$select public.da_verify(%L, 'approve')$$, (select v from t where k = 's1')), 'a hub manager cannot verify', '42501');
select tests.login(tests.id('acct_mgr'));
select tests.throws(format($$select public.da_verify(%L, 'correction')$$, (select v from t where k = 's1')), 'correction needs a note', '22023');
select public.da_verify((select v::uuid from t where k = 's1'), 'note', 'Please keep receipts');
select tests.ok((select status = 'submitted' from public.da_sessions where id = (select v::uuid from t where k = 's1')),
                'adding a note keeps the sheet waiting for approval');
select public.da_verify((select v::uuid from t where k = 's1'), 'correction', 'Rider Two delivery should be 32');
select tests.ok((select status = 'correction' and verify_note = 'Rider Two delivery should be 32'
                 from public.da_sessions where id = (select v::uuid from t where k = 's1')),
                'correction required sends the sheet back with the reason');
select tests.login(tests.id('hub_mgr'));
select public.da_save_rider_line((select v::uuid from t where k = 's1'), '22', 32, 5, 5000, 4000, 0, 300, null, (select v::uuid from t where k = 'l2'));
select public.da_submit((select v::uuid from t where k = 's1'), 'Corrected');
select tests.ok((select count(*) = 2 from public.da_events where session_id = (select v::uuid from t where k = 's1')
                 and action in ('submitted','resubmitted') and snapshot is not null),
                'old and new versions are both kept in the history');
select tests.ok((select (e2.snapshot #>> '{riders,1,delivery_qty}')::int = 32 and (e1.snapshot #>> '{riders,1,delivery_qty}')::int = 30
                 from public.da_events e1, public.da_events e2
                 where e1.session_id = (select v::uuid from t where k = 's1') and e1.action = 'submitted'
                   and e2.session_id = e1.session_id and e2.action = 'resubmitted'),
                'history shows the value before and after the correction');

-- Accounts Manager assignment rule
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.require_assignment', 'true');
select public.da_assign_accountant(tests.id('hub_a1'), tests.id('acct_mgr'), 'Hub A1 accounts');
select tests.login(tests.id('acct2'));
select tests.throws(format($$select public.da_verify(%L, 'approve')$$, (select v from t where k = 's1')),
                    'when assignment is required, an unassigned Accounts Manager cannot verify', '42501');
select tests.login(tests.id('acct_mgr'));
select public.da_verify((select v::uuid from t where k = 's1'), 'approve', 'All good');
select tests.ok((select status = 'approved' and verified_by = tests.id('acct_mgr') and verified_at is not null
                 from public.da_sessions where id = (select v::uuid from t where k = 's1')),
                'approve finalises the sheet and records who verified it and when');
select public.da_configure('da.require_assignment', 'false');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.da_save_rider_line(%L, '22', 1, 1, 1, 0, 0, 0, null, %L)$$, (select v from t where k = 's1'), (select v from t where k = 'l2')),
                    'an approved sheet cannot be changed', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.da_reopen(%L, 'late change')$$, (select v from t where k = 's1')),
                    'an approved sheet cannot be reopened', '22023');

-- maker ≠ checker, and reopening with correction permission
select tests.login(tests.id('admin'));
insert into t values ('s2', public.da_start_session(tests.id('hub_a2'))::text);
select public.da_save_expense((select v::uuid from t where k = 's2'), 'transport', null, 'Courier van', 'transport', 400, private.da_today());
select public.da_close_my_part((select v::uuid from t where k = 's2'));
select public.da_submit((select v::uuid from t where k = 's2'));
select tests.throws(format($$select public.da_verify(%L, 'approve')$$, (select v from t where k = 's2')),
                    'the person who submitted a sheet cannot verify it', '42501');
select tests.login(tests.id('zonal_a'));
select public.da_reopen((select v::uuid from t where k = 's2'), 'Wrong amount');
select tests.ok((select status = 'correction' from public.da_sessions where id = (select v::uuid from t where k = 's2')),
                'a person with correction permission can reopen a submitted sheet');

-- ---------- 7. Scope (RLS) and immutability ----------
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count('select 1 from public.da_sessions') = 0, 'a hub manager does not see other hubs'' sheets');
select tests.ok(tests.row_count('select 1 from public.da_rider_lines') = 0, 'nor their rider lines');
select tests.login(tests.id('noroles'));
select tests.ok(tests.row_count('select 1 from public.da_sessions') = 0, 'a user without roles sees nothing');
select tests.login(tests.id('rider_login'));
select tests.ok(tests.row_count('select 1 from public.da_rider_lines where removed_at is null') = 1, 'a rider sees only own rider lines');
-- live rule: a rider does not open the hub's sheet at all (their own lines are on "আমার হিসাব")
select tests.throws(format($$select public.da_sheet(%L)$$, (select v from t where k = 's1')), 'a rider cannot open the hub''s sheet');
select tests.throws('update public.da_rider_lines set amount = 1', 'direct updates are not allowed', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws('delete from public.da_sessions', 'direct deletes are not allowed', '42501');
select tests.logout();
select tests.throws('delete from public.da_rider_lines', 'not even the owner can delete lines', 'P0001');
select tests.throws('update public.da_events set note = ''x''', 'sheet history cannot be changed', 'P0001');
select tests.ok((select count(*) > 10 from public.audit_logs where module = 'da'), 'every change is in the audit log');
select tests.ok((select count(*) >= 1 from public.audit_logs where module = 'da' and action = 'CONFIGURE'), 'setting changes are audited');

-- ---------- 8. Page tracking ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('visit', public.da_page_enter((select v::uuid from t where k = 's_old'))::text);
select public.da_page_ping((select v::uuid from t where k = 'visit'), true);
select tests.ok((select left_at is not null and duration_seconds >= 0 and user_name = 'Hub Boss'
                 from public.da_page_visits where id = (select v::uuid from t where k = 'visit')),
                'entry and exit time and time spent are recorded');
select tests.login(tests.id('rider_login'));
select tests.ok(public.da_page_enter((select v::uuid from t where k = 's1')) is not null, 'a rider who is on the sheet is tracked too');
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.da_page_enter(%L)$$, (select v from t where k = 's1')), 'someone outside the hub cannot open the sheet', '42501');
select tests.login(tests.id('acct_mgr'));
select public.da_page_ping((select v::uuid from t where k = 'visit'), false);
select tests.ok((select last_seen_at <= left_at from public.da_page_visits where id = (select v::uuid from t where k = 'visit')),
                'nobody can change another person''s visit');

-- ---------- 9. Dashboard, reports, My Accounts, templates, access ----------
select tests.login(tests.id('acct_mgr'));
select tests.ok((select (d ->> 'approved')::int = 1 and (d ->> 'correction')::int = 1 and (d ->> 'riders')::int = 2
                        and (d ->> 'delivery')::int = 72 and (d ->> 'mobile_banking')::numeric = 1800
                 from public.da_dashboard(private.da_today() - 3, private.da_today()) d),
                'dashboard totals: sheets by status, riders, delivery, mobile banking');
select tests.ok((select jsonb_array_length(public.da_report('rider', private.da_today() - 3, private.da_today())) = 2), 'rider-wise report');
select tests.ok((select jsonb_array_length(public.da_report('transport_expense', private.da_today() - 3, private.da_today())) = 2), 'transport expense report');
select tests.ok((select jsonb_array_length(public.da_report('employee_expense', private.da_today() - 3, private.da_today())) = 1), 'employee expense report');
select tests.ok((select jsonb_array_length(public.da_report('merchant_payment', private.da_today() - 3, private.da_today())) = 2), 'merchant payment report (removed rows excluded)');
select tests.ok((select jsonb_array_length(public.da_report('verification', private.da_today() - 3, private.da_today())) = 6), 'verification report (note, correction, approve, and the "খাতা বন্ধ" notes each person leaves)');
select tests.ok((select jsonb_array_length(public.da_report('corrections', private.da_today() - 3, private.da_today())) = 3), 'correction history (sent back, resubmitted, reopened)');
select tests.ok((select jsonb_array_length(public.da_report('pending', private.da_today() - 3, private.da_today())) = 0), 'pending verification report');
select tests.ok((select count(*) = 1 from public.da_list_sessions(private.da_today() - 3, private.da_today(), null, null, 'approved')), 'filter by status');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok((select (d ->> 'sheets')::int = 0 from public.da_dashboard(private.da_today() - 3, private.da_today()) d), 'the dashboard follows the caller''s scope');
select tests.login(tests.id('rider_login'));
select tests.ok((select jsonb_array_length(m -> 'my_lines') = 1 and jsonb_array_length(m -> 'my_expenses') = 1
                        and jsonb_array_length(m -> 'notes') >= 2
                 from public.da_my_accounts(private.da_today() - 3, private.da_today()) m),
                'My Accounts shows own line, own expense, and the manager''s notes');
select tests.throws($$select public.da_report('rider', current_date, current_date)$$, 'a rider cannot open hub reports', '42501');

select tests.login(tests.id('acct_mgr'));
insert into t values ('tpl', public.da_save_template('CNG fare', 'transport', 'CNG', array['cng','auto'], 'CNG fare {from} → {to}')::text);
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count('select 1 from public.da_expense_templates') = 1, 'hub staff can read expense templates');
select tests.throws($$select public.da_save_template('X', 'transport')$$, 'only settings users change templates', '42501');
select tests.login(tests.id('acct_mgr'));
select tests.ok((select count(*) >= 2 from public.da_hub_access(tests.id('hub_a1'))), 'hub-wise access list for the settings screen');
select tests.ok((select count(*) = 1 from public.da_hub_accountants where revoked_at is null), 'Accounts Manager assignment is kept');
select tests.ok((select count(*) >= 2 from public.da_verifier_candidates()), 'list of people who can verify');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 1 and bool_and(can_submit) and not bool_or(can_verify) from public.da_my_hubs()), 'a hub manager gets only own hub in the hub picker');
select tests.throws('select * from public.da_verifier_candidates()', 'only settings users list verifiers', '42501');
select tests.login(tests.id('acct_mgr'));
select public.da_revoke_accountant((select id from public.da_hub_accountants limit 1), 'moved');
select tests.ok((select count(*) = 0 from public.da_hub_accountants where revoked_at is null), 'assignment is revoked, not deleted');

rollback;
