-- Bank deposit slips: OCR gives MATCH / NOT MATCH / NEEDS REVIEW, never "confirmed"; a person confirms.
-- Accounts history keeps old and new values; the centre overview shows only hubs one may see.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;
select tests.active_employee('Rider One', '1001', tests.id('hub_a1'), '01711000001', '1234567890');

select tests.login(tests.id('hub_mgr'));
insert into t values ('s', public.da_start_session(tests.id('hub_a1'))::text);
select public.da_save_rider_line((select v::uuid from t where k = 's'), '1001', 10, 2, 5000, 5000, 0);
select public.da_report_save((select v::uuid from t where k = 's'), '#743858', 5000);
insert into t values ('d', public.da_deposit_save((select v::uuid from t where k = 's'), 4800, 'bank', 'DBBL', 'R-1', null)::text);

-- no slip yet: nothing to read
select tests.throws(format($$select public.da_deposit_slip_read(%L, 4800, 90)$$, (select v from t where k = 'd')), 'a slip must be there before it is read', '22023');
select tests.throws(format($$select public.da_deposit_confirm(%L)$$, (select v from t where k = 'd')), 'no confirmation without a slip', '22023');

-- the slip comes: who and when is kept
select public.da_deposit_save((select v::uuid from t where k = 's'), 4800, 'bank', 'DBBL', 'R-1', 'da/' || (select v from t where k = 's') || '/slip.jpg',
  null, null, null, null, null, (select v::uuid from t where k = 'd'));
select tests.ok((select slip_uploaded_at is not null and slip_uploaded_by = tests.id('hub_mgr') and slip_match is null and bank_confirmed_at is null
  from public.da_deposits where id = (select v::uuid from t where k = 'd')), 'the slip records who gave it and when');

-- OCR: same amount and sure → MATCH; unsure → NEEDS REVIEW; different → NOT MATCH; none of these confirms
select tests.ok(public.da_deposit_slip_read((select v::uuid from t where k = 'd'), 4800, 92) ->> 'match' = 'match', 'the same amount read clearly is MATCH');
select tests.ok((select bank_confirmed_at is null from public.da_deposits where id = (select v::uuid from t where k = 'd')), 'MATCH by OCR does not confirm the deposit');
select tests.ok(public.da_deposit_slip_read((select v::uuid from t where k = 'd'), 4800, 30) ->> 'match' = 'review', 'an unsure reading needs review');
select tests.ok(public.da_deposit_slip_read((select v::uuid from t where k = 'd'), null, 80) ->> 'match' = 'review', 'nothing read needs review');
select tests.ok(public.da_deposit_slip_read((select v::uuid from t where k = 'd'), 4300, 95) ->> 'match' = 'not_match', 'another amount is NOT MATCH');

-- the reading and the confirmation cannot be written straight into the table
select tests.logout();
select tests.throws(format($$update public.da_deposits set bank_confirmed_at = now() where id = %L$$, (select v from t where k = 'd')),
  'the table itself refuses a confirmation written directly, even by the owner', '42501');
update public.da_deposits set slip_match = 'match' where id = (select v::uuid from t where k = 'd');
select tests.ok((select slip_match = 'not_match' from public.da_deposits where id = (select v::uuid from t where k = 'd')), 'the slip reading cannot be changed by hand');
select tests.login(tests.id('hub_mgr'));

-- confirming: a NOT MATCH needs the person's own note
select tests.throws(format($$select public.da_deposit_confirm(%L)$$, (select v from t where k = 'd')), 'a slip that did not match needs a note to confirm', '22023');
select public.da_deposit_confirm((select v::uuid from t where k = 'd'), true, 'ব্যাংক স্টেটমেন্টে ৪৮০০ দেখেছি, স্লিপের ছবি ঝাপসা');
select tests.ok((select bank_confirmed_at is not null and bank_confirmed_by = tests.id('hub_mgr') and bank_confirm_note is not null
  from public.da_deposits where id = (select v::uuid from t where k = 'd')), 'a person confirms, with name, time and note');

-- changing the amount clears the confirmation and compares again
select public.da_deposit_save((select v::uuid from t where k = 's'), 4300, 'bank', 'DBBL', 'R-1', null, null, null, null, null, null, (select v::uuid from t where k = 'd'));
select tests.ok((select bank_confirmed_at is null and slip_match = 'match' from public.da_deposits where id = (select v::uuid from t where k = 'd')),
  'a new amount clears the confirmation and is compared with the slip again');

-- someone without the right cannot read slips or confirm
select tests.login(tests.id('auditor'));
select tests.throws(format($$select public.da_deposit_confirm(%L, true, 'x')$$, (select v from t where k = 'd')), 'someone without accounts rights cannot confirm', '42501');

-- ---------- history: old and new values, who, when ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) > 0 from jsonb_array_elements(public.da_accounts_history(tests.id('hub_a1'))) h
                  where h ->> 'table' = 'da_deposits' and h ->> 'action' = 'UPDATE' and h -> 'old' ? 'amount' and (h -> 'new' ->> 'amount')::numeric = 4300),
  'the history keeps the old and the new amount of a changed deposit');
select tests.ok((select bool_and(h ->> 'by' is not null and h ->> 'at' is not null) from jsonb_array_elements(public.da_accounts_history(tests.id('hub_a1'))) h),
  'every history line says who and when');
select tests.ok(jsonb_array_length(public.da_accounts_history(tests.id('hub_a1'))) > 0, 'the history shows the hub''s changes to its manager');
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.da_accounts_history(%L)$$, tests.id('hub_a1')), 'the history of a hub one may not see is refused', '42501');

-- ---------- centre overview ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (r ->> 'report_total')::numeric = 5000 and (r ->> 'deposited')::numeric = 4300 and (r ->> 'bank_confirmed')::int = 0
                   and (r ->> 'slips_match')::int = 1 and r ? 'hub_due' and r ? 'missing_vouchers'
                 from jsonb_array_elements(public.da_center_overview()) r where r ->> 'id' = tests.id('hub_a1')::text),
  'the overview shows the report, the deposit and the slip status of the hub');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.da_center_overview()) r where r ->> 'id' = tests.id('hub_b1')::text),
  'a hub manager does not see other hubs in the overview');
select tests.login(tests.id('admin'));
select tests.ok((select count(*) >= 2 from jsonb_array_elements(public.da_center_overview())), 'head office sees every hub');

-- ---------- the official rules head office writes are a setting like the others ----------
select tests.login(tests.id('acct_mgr'));
select public.da_configure('da.learn_official', '{"bank": "অফিশিয়াল: স্লিপের ছবি একই দিনে দিন"}'::jsonb);
select tests.ok(public.da_settings() -> 'da.learn_official' ->> 'bank' like 'অফিশিয়াল%', 'head office writes the official rule of a module');
-- ---------- the report's file or text stays with the report ID ----------
select tests.login(tests.id('hub_mgr'));
select public.da_report_attach((select id from public.da_report_ids where session_id = (select v::uuid from t where k = 's')),
  'da/' || (select v from t where k = 's') || '/report.pdf', 'Update Report #743858 Total 5000');
select tests.ok((select file_path like 'da/%/report.pdf' and raw_text like 'Update Report%' and file_by = tests.id('hub_mgr')
  from public.da_report_ids where session_id = (select v::uuid from t where k = 's')), 'the report file and text are kept with the report ID');
select tests.throws(format($$select public.da_report_attach(%L, 'da/elsewhere/x.pdf')$$, (select id from public.da_report_ids where session_id = (select v::uuid from t where k = 's'))),
  'a file from another sheet is refused', '22023');
rollback;
