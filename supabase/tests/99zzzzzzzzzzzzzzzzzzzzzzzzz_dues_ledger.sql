-- দেনা-পাওনা: a person's own dues ledger — statement lines, profiles by number, ticks, changes; private to its owner.
begin;
select tests.fixture();
create temp table t (k text primary key, v text); grant all on t to authenticated;

-- ---- who may use it
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select * from public.dp_profiles()$$, 'a role without the permission cannot open the ledger', '42501');
select tests.throws($$select public.dp_profile_save(null, 'X', array['01711000001'])$$, 'nor write in it', '42501');
select tests.logout();
select tests.login_anon();
select tests.throws($$select * from public.dp_txns()$$, 'anon cannot read lines', '42501');
select tests.logout();

-- ---- upload a statement
select tests.login(tests.id('super'));
insert into t values ('imp', public.dp_statement_import('bkash', '+8801700000000', 'bkash-nov.pdf', $j$[
  {"at":"2026-11-10T09:15:00","dir":"out","amount":"1500","fee":"5","balance":"8500","type":"Send Money","trx":"bka1111111","party":"01711-000001","ref":"loan"},
  {"at":"2026-11-10T23:50:00","dir":"in","amount":500,"type":"Received Money","trx":"BKA2222222","party":"8801711000001"},
  {"at":"2026-11-11T00:10:00","dir":"out","amount":"-250.50","type":"Payment","trx":"BKA3333333","party":"01822000002","party_name":"Shop"},
  {"at":"2026-11-12T12:00:00","dir":"in","amount":"300","type":"Cash In","party":"০১৯৩৩০০০০০৩"},
  {"at":"not a date","dir":"in","amount":"10"},
  {"at":"2026-11-12T13:00:00","dir":"sideways","amount":"10"}
]$j$::jsonb)::text);
select tests.ok((select (v::jsonb ->> 'rows')::int = 6 and (v::jsonb ->> 'added')::int = 4 and (v::jsonb ->> 'bad')::int = 2 and (v::jsonb ->> 'skipped')::int = 0 from t where k = 'imp'),
  'four good lines go in; a line with no date or no side is left out and counted');
select tests.ok((select v::jsonb ->> 'date_from' = '2026-11-10' and v::jsonb ->> 'date_to' = '2026-11-12' from t where k = 'imp'), 'the statement knows its first and last day');
select tests.ok((select count(*) = 4 from public.dp_txns()), 'the lines are listed');
select tests.ok((select party_no = '01711000001' and trx_id = 'BKA1111111' and amount = 1500 and fee = 5 and balance = 8500 from public.dp_txns() where trx_id = 'BKA1111111'),
  'number and trx id are cleaned; amount, fee and balance are kept');
select tests.ok((select party_no = '01711000001' from public.dp_txns() where trx_id = 'BKA2222222'), '+88 / 88 in front of a number is dropped');
select tests.ok((select amount = 250.50 and direction = 'out' from public.dp_txns() where trx_id = 'BKA3333333'), 'a minus amount is stored as a plain amount');
select tests.ok((select party_no = '01933000003' from public.dp_txns() where trx_id is null), 'Bangla digits in a number are read');
select tests.ok((select txn_date = '2026-11-10' from public.dp_txns() where trx_id = 'BKA2222222') and (select txn_date = '2026-11-11' from public.dp_txns() where trx_id = 'BKA3333333'),
  'the day is the Asia/Dhaka day (11:50 pm and 12:10 am fall on two days)');
select tests.ok((select count(*) = 1 from public.dp_txns('2026-11-11', '2026-11-11')), 'lines can be read for one date');
select tests.ok((select count(*) = 1 from public.dp_txns(null, null, null, null, 'all', 'bka1')) and (select count(*) = 1 from public.dp_txns(null, null, null, null, 'all', 'loan')), 'lines can be searched');

-- the same file again, plus one new line: nothing doubles
insert into t values ('imp2', public.dp_statement_import('bkash', '01700000000', 'bkash-nov-2.pdf', $j$[
  {"at":"2026-11-10T09:15:00","dir":"out","amount":"1500","trx":"BKA1111111","party":"01711000001"},
  {"at":"2026-11-12T12:00:00","dir":"in","amount":"300","type":"Cash In","party":"01933000003"},
  {"at":"2026-11-13T08:00:00","dir":"out","amount":"700","trx":"BKA4444444","party":"01711000001"}
]$j$::jsonb)::text);
select tests.ok((select (v::jsonb ->> 'added')::int = 1 and (v::jsonb ->> 'skipped')::int = 2 from t where k = 'imp2'), 'uploading an overlapping statement adds only the new line (with or without a trx id)');
select tests.ok((select count(*) = 5 from public.dp_txns()), 'five lines in all');
select tests.ok((select count(*) = 2 from public.dp_statements()), 'both uploads are listed');
select tests.throws($$select public.dp_statement_import('paypal', null, 'x', '[{"at":"2026-11-10T09:15:00","dir":"in","amount":1}]'::jsonb)$$, 'an unknown wallet is refused', '22023');
select tests.throws($$select public.dp_statement_import('nagad', null, 'x', '[]'::jsonb)$$, 'an empty statement is refused', '22023');
-- the same trx id in another wallet is another line
select public.dp_statement_import('nagad', null, 'nagad.pdf', '[{"at":"2026-11-13T09:00:00","dir":"in","amount":"40","trx":"BKA1111111","party":"01755000009"}]'::jsonb);
select tests.ok((select count(*) = 6 from public.dp_txns()), 'wallets are kept apart');

-- ---- profiles: name + number, the statement shows the name
select tests.ok((select count(*) = 4 and (select txn_count = 3 from public.dp_unknown_numbers() where party_no = '01711000001') from public.dp_unknown_numbers()),
  'numbers with no name yet are listed, busiest first');
insert into t values ('karim', public.dp_profile_save(null, ' Karim Bhai ', array['+880 1711-000001'], 'friend', 0)::text);
select tests.ok((select name = 'Karim Bhai' and numbers = array['01711000001'] from public.dp_profiles()), 'a profile is made from a name and a number');
select tests.ok((select count(*) = 3 and bool_and(profile_name = 'Karim Bhai') from public.dp_txns() where party_no = '01711000001'), 'every line of that number now shows the name');
select tests.ok((select count(*) = 3 from public.dp_txns(null, null, null, (select v::uuid from t where k = 'karim'))), 'the profile page lists all of the person''s lines');
select tests.ok((select given = 2200 and got = 500 and balance = 1700 and txn_count = 3 and unchecked = 3 and last_date = '2026-11-13' from public.dp_profiles()),
  'given 2200, got 500: he owes 1700');
select tests.ok((select count(*) = 3 from public.dp_unknown_numbers()), 'the number is no longer nameless');
select tests.throws($$select public.dp_profile_save(null, 'Other', array['01711000001'])$$, 'one number cannot be in two profiles', '23505');
select tests.throws($$select public.dp_profile_save(null, ' ', array['01711000009'])$$, 'a profile needs a name', '22023');
select public.dp_profile_save((select v::uuid from t where k = 'karim'), 'Karim', array['01711000001', '01755000009'], null, -200);
select tests.ok((select name = 'Karim' and given = 2200 and got = 540 and balance = 1460 and txn_count = 4 from public.dp_profiles()),
  'a profile can be changed: a second number brings its lines, an opening balance is counted');

-- ---- writing by hand and changing
insert into t values ('cash', public.dp_txn_save(null, jsonb_build_object('at', '2026-11-14T10:00', 'dir', 'in', 'amount', 1000, 'provider', 'cash',
  'profile', (select v from t where k = 'karim'), 'note', 'হাতে দিল'))::text);
select tests.ok((select manual and by_hand and profile_name = 'Karim' and provider = 'cash' and txn_date = '2026-11-14' from public.dp_txns() where id = (select v::uuid from t where k = 'cash')),
  'a cash line is written by hand under a profile');
select tests.ok((select balance = 460 from public.dp_profiles()), 'the balance follows');
select tests.throws($$select public.dp_txn_save(null, '{"at":"2026-11-14T10:00","dir":"in","amount":0}'::jsonb)$$, 'a line needs an amount', '22023');
select tests.throws($$select public.dp_txn_save(null, '{"at":"2026-11-14T10:00","amount":5}'::jsonb)$$, 'and a side', '22023');
select tests.throws($$select public.dp_txn_save(null, '{"at":"2999-01-01T10:00","dir":"in","amount":5}'::jsonb)$$, 'and not a date still to come', '22023');
select public.dp_txn_save((select id from public.dp_txns() where trx_id = 'BKA3333333'), jsonb_build_object('profile', (select v from t where k = 'karim'), 'amount', 300, 'note', 'আসলে করিমের'));
select tests.ok((select profile_name = 'Karim' and by_hand and amount = 300 and edited and party_no = '01822000002' and trx_id = 'BKA3333333' from public.dp_txns() where trx_id = 'BKA3333333'),
  'a statement line can be given to a profile and its amount corrected; what was not sent stays');
select public.dp_txn_save((select id from public.dp_txns() where trx_id = 'BKA4444444'), '{"profile":"none"}'::jsonb);
select tests.ok((select profile_name is null from public.dp_txns() where trx_id = 'BKA4444444') and (select txn_count = 5 from public.dp_profiles()),
  'a line can be taken out of a profile although the number matches');
select public.dp_txn_save((select id from public.dp_txns() where trx_id = 'BKA4444444'), '{"profile":""}'::jsonb);
select tests.ok((select profile_name = 'Karim' from public.dp_txns() where trx_id = 'BKA4444444'), 'and put back to follow the number');
select tests.throws(format($$select public.dp_txn_save(%L, '{"amount":5}'::jsonb)$$, gen_random_uuid()), 'a line that does not exist cannot be changed', 'P0002');

-- ---- ticking date by date
select tests.ok(public.dp_txn_check(array(select id from public.dp_txns('2026-11-10', '2026-11-10'))) = 2, 'a whole day is ticked');
select tests.ok((select count(*) = 2 from public.dp_txns(null, null, null, null, 'checked')) and (select count(*) = 5 from public.dp_txns(null, null, null, null, 'unchecked')), 'ticked and unticked lines can be listed apart');
select public.dp_txn_check(array[(select id from public.dp_txns() where trx_id = 'BKA2222222')], false);
select tests.ok((select not checked from public.dp_txns() where trx_id = 'BKA2222222'), 'a tick can be taken off');
select tests.ok((select count(*) = 1 from public.dp_txns(null, null, null, null, 'noname')), 'lines with no name can be listed');
select tests.ok((select count(*) = 1 from public.dp_txns(null, null, 'cash')), 'lines can be listed by wallet');

-- ---- removing
select tests.ok(public.dp_txn_remove(array[(select v::uuid from t where k = 'cash')]) = 1, 'a line is removed');
select tests.ok((select count(*) = 6 from public.dp_txns()) and (select count(*) = 1 from public.dp_txns(null, null, null, null, 'removed')) and (select balance = 1760 from public.dp_profiles()),
  'it leaves the list and the totals, and waits among the removed');
select public.dp_txn_remove(array[(select id from public.dp_txns() where trx_id = 'BKA4444444')]);
select tests.ok(((public.dp_statement_import('bkash', null, 'again.pdf', '[{"at":"2026-11-13T08:00:00","dir":"out","amount":"700","trx":"BKA4444444","party":"01711000001"}]'::jsonb)) ->> 'added')::int = 0,
  'a removed statement line does not come back when the statement is uploaded again');
select tests.ok(public.dp_txn_remove(array[(select id from public.dp_txns(null, null, null, null, 'removed') where trx_id = 'BKA4444444')], true) = 1, 'a removed line can be brought back');
select tests.ok((select count(*) = 6 from public.dp_txns()), 'and is in the list again');
-- taking a statement back: untouched lines go, ticked or changed ones stay
select tests.ok(public.dp_statement_remove((select (v::jsonb ->> 'statement_id')::uuid from t where k = 'imp')) = 2, 'taking a statement back removes its untouched lines');
select tests.ok((select count(*) = 2 from public.dp_txns() where provider = 'bkash' and trx_id in ('BKA1111111', 'BKA3333333')), 'the ticked line and the changed line stay');
select tests.ok((select count(*) = 3 from public.dp_statements()), 'the statement leaves the list');
select public.dp_profile_remove((select v::uuid from t where k = 'karim'));
select tests.ok((select count(*) = 0 from public.dp_profiles()) and (select count(*) = 4 and bool_and(profile_name is null) from public.dp_txns()), 'removing a profile keeps its lines, without a name');
insert into t values ('live', (select id::text from public.dp_txns() where trx_id = 'BKA4444444'));
select tests.logout();

-- ---- each person's book is their own
select tests.login(tests.id('admin'));
select tests.ok((select count(*) = 0 from public.dp_txns()) and (select count(*) = 0 from public.dp_profiles()) and (select count(*) = 0 from public.dp_statements()) and (select count(*) = 0 from public.dp_unknown_numbers()),
  'another person with the permission sees nothing of it');
select tests.ok(public.dp_txn_check(array[(select v::uuid from t where k = 'live')]) = 0, 'and cannot tick it');
select tests.ok(public.dp_txn_remove(array[(select v::uuid from t where k = 'live')]) = 0, 'nor remove a line');
select tests.throws(format($$select public.dp_txn_save(%L, '{"amount":5}'::jsonb)$$, (select v from t where k = 'live')), 'nor change a line', 'P0002');
select tests.throws(format($$select public.dp_profile_save(%L, 'Mine now', array['01711000001'])$$, (select v from t where k = 'karim')), 'nor a profile', 'P0002');
select tests.throws($$select count(*) from public.dp_txns$$, 'the tables themselves are closed', '42501');
insert into t values ('mine', public.dp_profile_save(null, 'Rahim', array['01711000001'])::text);
select tests.ok((select count(*) = 1 from public.dp_profiles()), 'the same number can be a profile in another person''s book');
select tests.logout();
select tests.ok((select count(*) = 0 from public.audit_logs where table_name like 'dp\_%'), 'personal lines are not copied into the audit log');
rollback;
