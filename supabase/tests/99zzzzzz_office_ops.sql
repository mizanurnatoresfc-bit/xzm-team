-- Office operations: garage kinds and the lease, bills with memo number and screenshot, expense lines of the hub,
-- lending an item to another place, residents, passwords, broken / needed reports to the zonal manager.
begin;
select tests.fixture();
create temp table t (k text primary key, v text); grant all on t to authenticated;
insert into tests.ids values ('pc_login', tests.make_user('pc.holder@test.local', 'PC Holder'));
insert into tests.ids values ('pcman', tests.active_employee('PC Man', '901', tests.id('hub_a1'), '01711000901', '9010101010', 15000, tests.id('pc_login')));
select tests.grant_role(tests.id('pc_login'), 'rider', 'hub', null, tests.id('hub_a1'));

-- places
select tests.login(tests.id('zonal_a'));
insert into public.office_properties (code, name, kind, zone_id, hub_id, rent, advance, contract_from, contract_to, owner_name, owner_phone)
values ('OA1', 'A1 Office', 'office', tests.id('zone_a'), tests.id('hub_a1'), 12000, 50000, current_date - 300, current_date + 65, 'Karim', '01700000000');
insert into public.office_properties (code, name, kind, zone_id, hub_id) values ('GA1', 'A1 Auto Garage', 'auto_garage', tests.id('zone_a'), tests.id('hub_a1'));
insert into public.office_properties (code, name, kind, zone_id, hub_id) values ('OA2', 'A2 Office', 'office', tests.id('zone_a'), tests.id('hub_a2'));
insert into t select 'oa1', id::text from public.office_properties where code = 'OA1';
insert into t select 'ga1', id::text from public.office_properties where code = 'GA1';
insert into t select 'oa2', id::text from public.office_properties where code = 'OA2';
select tests.ok((select count(*) = 1 from public.office_properties where kind = 'auto_garage'), 'an auto garage can be added to a hub');
select tests.throws($$update public.office_properties set contract_to = contract_from - 1 where code = 'OA1'$$, 'a contract cannot end before it starts', '23514');

-- items with power, a lock on nothing, lending
insert into public.office_assets (property_id, kind, name, quantity, watt, hours_per_day, holder_id)
values ((select v::uuid from t where k = 'oa1'), 'pc', 'PC', 3, 150, 10, tests.id('pcman'));
insert into t select 'pc', id::text from public.office_assets where name = 'PC';
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 2 from public.office_properties), 'the hub manager sees only the places of the hub');
insert into t values ('loan', public.office_lend((select v::uuid from t where k = 'pc'), (select v::uuid from t where k = 'oa2'), 1, 'one set')::text);
select tests.ok(true, 'the hub manager lends one PC to another hub');
select tests.throws(format($$select public.office_lend(%L, %L, 3, null)$$, (select v from t where k = 'pc'), (select v from t where k = 'oa2')), 'cannot lend more than is left', '22023');
select tests.ok((select quantity = 3 from public.office_assets where id = (select v::uuid from t where k = 'pc')), 'the lent PC still counts at the owning hub');
select tests.ok((select count(*) = 1 and bool_and(to_name = 'A2 Office' and can_return) from public.office_loan_list()), 'the lender sees who uses it, by name');
select tests.logout();

select tests.login(tests.id('hub_b_mgr'));
select tests.ok((select count(*) = 0 from public.office_loan_list()), 'another zone''s manager sees no loans');
select tests.throws(format($$select public.office_lend_return(%L)$$, (select v from t where k = 'loan')), 'and cannot return them', '42501');
select tests.logout();

-- bills
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.office_bill_save(%L, 'electricity', current_date, 1850)$$, (select v from t where k = 'oa1')), 'an electricity bill needs the payment screenshot', '22023');
select tests.throws(format($$select public.office_bill_save(%L, 'electricity', current_date, 1850, '{"proof_file":"somewhere/else.jpg"}')$$, (select v from t where k = 'oa1')),
  'the screenshot must be in this office''s folder', '22023');
insert into t values ('eb', public.office_bill_save((select v::uuid from t where k = 'oa1'), 'electricity', current_date, 1850,
  jsonb_build_object('proof_file', (select v from t where k = 'oa1') || '/shot.jpg', 'method', 'bkash', 'txn_id', 'TX123', 'units', 190)) ->> 'id');
select tests.ok((select memo_no like 'OM-%' and bill_month = date_trunc('month', current_date)::date from public.office_bills where id = (select v::uuid from t where k = 'eb')),
  'no memo: the bill gets the office''s own memo number, for the month');
select tests.throws(format($$select public.office_bill_save(%L, 'electricity', current_date, 10, '{"proof_file":"%s/x.jpg"}')$$, (select v from t where k = 'oa1'), (select v from t where k = 'oa1')),
  'one electricity bill a month', '23505');
insert into t values ('rb', public.office_bill_save((select v::uuid from t where k = 'oa1'), 'rent', current_date, 12000, '{"has_memo":true,"method":"cash"}') ->> 'id');
select tests.ok((select memo_no is null and has_memo from public.office_bills where id = (select v::uuid from t where k = 'rb')), 'a rent bill with the landlord''s memo needs no number');
select tests.ok((public.office_bill_save((select v::uuid from t where k = 'oa1'), 'rent', current_date, 12500, '{"has_memo":false}', (select v::uuid from t where k = 'rb')) ->> 'memo_no') like 'OM-%',
  'when the memo is taken off, a number is made');
select tests.throws(format($$select public.office_bill_save(%L, 'wifi', current_date, 800)$$, (select v from t where k = 'oa2')), 'not for another hub''s office', '42501');
select tests.throws(format($$select public.office_bill_remove(%L, ' ')$$, (select v from t where k = 'rb')), 'removing a bill needs a reason', '22023');
select public.office_bill_remove((select v::uuid from t where k = 'rb'), 'wrong month');
select tests.ok((select count(*) = 1 from public.office_bills where archived_at is null), 'the removed bill is archived, not deleted');
select tests.ok((select count(*) = 0 from public.office_expense_lines((select v::uuid from t where k = 'oa1'), current_date - 30, current_date)), 'expense lines: none yet');
select tests.logout();

select tests.login(tests.id('pc_login'));
select tests.ok((select count(*) = 0 from public.office_bills), 'staff do not see the bills');
select tests.throws(format($$select * from public.office_expense_lines(%L, current_date - 30, current_date)$$, (select v from t where k = 'oa1')), 'nor the expense lines', '42501');
-- the holder of an item may report it and keep its lock
insert into public.office_secrets (property_id, asset_id, kind, label, secret) values ((select v::uuid from t where k = 'oa1'), (select v::uuid from t where k = 'pc'), 'pc', 'PC lock', '1234');
select tests.ok((select count(*) = 1 from public.office_secrets), 'the holder shares the lock of the PC they hold');
select tests.throws(format($$insert into public.office_secrets (property_id, kind, label, secret) values (%L, 'cctv', 'DVR', 'x')$$, (select v from t where k = 'oa1')), 'but writes no other password', '42501');
insert into t values ('n1', public.office_notice_send((select v::uuid from t where k = 'oa1'), 'broken', null, (select v::uuid from t where k = 'pc'), null, 1, 'does not start') ->> 'id');
select tests.ok((select title = 'PC' and status = 'open' and notice_no like 'ON-%' from public.office_notices where id = (select v::uuid from t where k = 'n1')), 'the holder reports the PC broken');
select tests.throws(format($$select public.office_notice_send(%L, 'need', 'Fan')$$, (select v from t where k = 'oa1')), 'but may not ask for new things', '42501');
select tests.logout();
select tests.ok((select condition = 'broken' from public.office_assets where id = (select v::uuid from t where k = 'pc')), 'the reported item is marked broken');
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('zonal_a') and kind = 'office' and link = '/app/office/notices'), 'the zonal manager is told');
select tests.ok((select count(*) = 0 from public.notifications where profile_id = tests.id('super') and kind = 'office'), 'the zone has a manager, so head office is not rung');
select tests.ok((select count(*) = 0 from public.audit_logs where table_name = 'office_secrets'), 'passwords stay out of the audit log');

select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.office_notice_send(%L, 'broken', null, %L)$$, (select v from t where k = 'oa1'), (select v from t where k = 'pc')), 'the same item is not reported twice', '23505');
select tests.ok((public.office_notice_send((select v::uuid from t where k = 'oa1'), 'need', 'Executive chair', null, 'chair', 2, null, true) ->> 'notified')::int = 1, 'the manager asks for two chairs');
insert into public.office_secrets (property_id, kind, label, username, secret) values ((select v::uuid from t where k = 'oa1'), 'cctv', 'DVR login', 'admin', 'cam@123');
select tests.ok((select count(*) = 2 from public.office_secrets), 'the manager keeps the CCTV login and sees the PC lock');
insert into public.office_residents (property_id, employee_id) values ((select v::uuid from t where k = 'ga1'), tests.id('pcman'));
select tests.throws(format($$insert into public.office_residents (property_id, employee_id) values (%L, %L)$$, (select v from t where k = 'ga1'), tests.id('pcman')), 'a person is listed once per place', '23505');
select tests.throws(format($$select public.office_notice_update(%L, 'done')$$, (select v from t where k = 'n1')), 'the hub manager does not answer reports', '42501');
select tests.logout();

select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) = 2 from public.office_notices where status = 'open'), 'the zonal manager sees both reports');
select tests.throws(format($$select public.office_notice_update(%L, 'rejected')$$, (select v from t where k = 'n1')), 'saying no needs a reason', '22023');
select public.office_notice_update((select v::uuid from t where k = 'n1'), 'done', 'repaired', true);
select tests.ok((select condition = 'good' from public.office_assets where id = (select v::uuid from t where k = 'pc')), 'done + fixed puts the item back to good');
select tests.throws(format($$select public.office_notice_update(%L, 'seen')$$, (select v from t where k = 'n1')), 'a finished report is closed', '22023');
select public.office_lend_return((select v::uuid from t where k = 'loan'), 'back');
select tests.ok((select count(*) = 0 from public.office_loan_list()), 'the returned PC is no longer on loan');
select tests.logout();
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('pc_login') and kind = 'office'), 'the sender is told the answer');

-- the hub's daily accounts: lines in the matching categories show on the office
insert into public.da_sessions (hub_id, zone_id, account_date, started_by) values (tests.id('hub_a1'), tests.id('zone_a'), current_date, tests.id('hub_mgr'));
insert into public.da_expenses (session_id, hub_id, zone_id, kind, expense_name, category, amount, bill_date)
select s.id, s.hub_id, s.zone_id, 'transport', x.n, x.c, x.a, current_date from public.da_sessions s,
  (values ('Polli Bidyut', 'utilities', 1850), ('Wifi', 'internet', 800), ('Tea', 'entertainment', 60)) x(n, c, a) where s.hub_id = tests.id('hub_a1');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 2 and count(*) filter (where kind = 'electricity' and amount = 1850) = 1 and count(*) filter (where kind = 'wifi') = 1
  from public.office_expense_lines((select v::uuid from t where k = 'oa1'), current_date - 30, current_date)), 'electricity and wifi lines of the hub''s accounts show; tea does not');
select tests.ok((public.office_bill_save((select v::uuid from t where k = 'oa1'), 'electricity', current_date, 1850,
  jsonb_build_object('proof_file', (select v from t where k = 'oa1') || '/shot.jpg', 'da_expense_id', (select id from public.da_expenses where expense_name = 'Polli Bidyut')),
  (select v::uuid from t where k = 'eb')) ->> 'memo_no') like 'OM-%', 'the bill is tied to the accounts line and keeps its memo number');
select tests.ok((select count(*) = 1 from public.office_expense_lines((select v::uuid from t where k = 'oa1'), current_date - 30, current_date) where bill_id is not null), 'the tied line says so');
select tests.throws(format($$select public.office_bill_save(%L, 'wifi', current_date, 800, jsonb_build_object('da_expense_id', gen_random_uuid()))$$, (select v from t where k = 'oa1')),
  'a line of another hub cannot be tied', '22023');
select tests.logout();

select tests.login(tests.id('auditor'));
select tests.ok((select count(*) = 1 from public.office_bills where archived_at is null), 'the auditor sees bills');
select tests.ok((select count(*) = 0 from public.office_secrets), 'but no passwords');
select tests.logout();
select tests.login_anon();
select tests.throws($$select count(*) from public.office_bills$$, 'anon reads nothing', '42501');
select tests.logout();
rollback;
