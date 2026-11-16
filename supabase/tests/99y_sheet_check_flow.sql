-- Draft -> submit -> check -> report OK: the number of people per hub, submitting for someone else,
-- a reason when fewer have submitted, and the report amount against the sheet.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;
select tests.active_employee('Rider One', '1001', tests.id('hub_a1'), '01711000001', '1234567890');
select tests.active_employee('Rider Two', '1002', tests.id('hub_a1'), '01711000002', '1234567891');

-- ---------- settings: how many people take the accounts ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.da_hub_collectors_set(%L, 2)$$, tests.id('hub_a1')), 'a hub manager cannot set the number', '42501');
select tests.login(tests.id('acct_mgr'));
select tests.throws(format($$select public.da_hub_collectors_set(%L, 0)$$, tests.id('hub_a1')), 'the number must be 1 or more', '22023');
select public.da_hub_collectors_set(tests.id('hub_a1'), 2);
select tests.ok((public.da_settings() -> 'da.hub_collectors' ->> tests.id('hub_a1')::text) = '2', 'the number is kept for the hub');
select tests.ok(private.da_collectors_needed(tests.id('hub_a1')) = 2 and private.da_collectors_needed(tests.id('hub_b1')) = 1,
  'a hub without its own number uses the default');

-- ---------- two people write on one sheet: two drafts ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('s1', public.da_start_session(tests.id('hub_a1'))::text);
select public.da_save_rider_line((select v::uuid from t where k = 's1'), '1001', 10, 2, 5000, 5000, 0);
select tests.login(tests.id('admin'));
select public.da_save_rider_line((select v::uuid from t where k = 's1'), '1002', 6, 1, 3000, 3000, 0);
select tests.ok((select people = 2 and submitted = 0 and needed = 2 and checked_at is null
  from public.da_flow_list(current_date - 1, current_date + 1) where session_id = (select v::uuid from t where k = 's1')),
  'the list shows two drafts, none submitted, two needed');

-- nothing accepted yet: the daily sheet cannot be opened, and a draft cannot be accepted
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.da_check(%L, 'x')$$, (select v from t where k = 's1')), 'the daily sheet needs at least one accepted khata', '22023');
select tests.throws(format($$select public.da_parts_accept(%L, array[%L]::uuid[])$$, (select v from t where k = 's1'), tests.id('admin')), 'a draft cannot be accepted', '22023');

-- the manager submits their own part, and the other person's part for them
select public.da_close_my_part((select v::uuid from t where k = 's1'));
select tests.throws(format($$select public.da_close_part_for(%L, %L)$$, (select v from t where k = 's1'), tests.id('auditor')),
  'someone who has no draft on the sheet cannot be submitted', 'P0002');
select public.da_close_part_for((select v::uuid from t where k = 's1'), tests.id('admin'));
select tests.ok((select closed_at is not null and closed_by = tests.id('hub_mgr') and closed_by_name is not null
  from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's1') and user_id = tests.id('admin')),
  'a part submitted for someone else says who submitted it');
select tests.ok((select submitted = 2 from public.da_flow_list(current_date - 1, current_date + 1) where session_id = (select v::uuid from t where k = 's1')),
  'both parts count as submitted');
select tests.login(tests.id('auditor'));
select tests.throws(format($$select public.da_close_part_for(%L, %L, false)$$, (select v from t where k = 's1'), tests.id('admin')),
  'someone who cannot write on the sheet cannot change a part', '42501');

-- ---------- the report cannot be confirmed before the check ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.da_report_ok(%L)$$, (select v from t where k = 's1')), 'the report waits for the check', '22023');

-- ---------- accept: several at once, one's own too; only accepted khatas are added up ----------
select tests.ok(public.da_parts_accept((select v::uuid from t where k = 's1'), array[tests.id('hub_mgr')]) = 1, 'a manager may accept their own khata');
select tests.throws(format($$select public.da_check(%L)$$, (select v from t where k = 's1')), 'a khata left out needs a reason', '22023');
select tests.ok((public.da_check((select v::uuid from t where k = 's1'), 'অন্যটি কাল মিলবে') ->> 'rider_amount')::numeric = 5000, 'only the accepted khata is added up');
select tests.ok((select check_left is not null and check_done = 1 from public.da_sessions where id = (select v::uuid from t where k = 's1')), 'the khata left out is named');
select tests.throws(format($$select public.da_parts_accept(%L, array[%L]::uuid[])$$, (select v from t where k = 's1'), tests.id('admin')), 'nothing is accepted once the daily sheet is open', '22023');
select public.da_reopen_day((select v::uuid from t where k = 's1'), 'দ্বিতীয় খাতাও নেব');
select tests.ok(public.da_parts_accept((select v::uuid from t where k = 's1'), array[tests.id('hub_mgr'), tests.id('admin')]) = 1, 'marking two accepts the one not yet accepted');
select tests.ok((select accepted = 2 and submitted = 2 from public.da_flow_list(current_date - 1, current_date + 1) where session_id = (select v::uuid from t where k = 's1')), 'the list counts the accepted khatas');
select tests.login(tests.id('auditor'));
select tests.throws(format($$select public.da_parts_accept(%L, array[%L]::uuid[], false)$$, (select v from t where k = 's1'), tests.id('admin')), 'someone who cannot write on the sheet cannot accept', '42501');
select tests.login(tests.id('hub_mgr'));

-- ---------- check: everything accepted, no reason needed ----------
select tests.ok((public.da_check((select v::uuid from t where k = 's1')) ->> 'rider_amount')::numeric = 8000, 'the check keeps the totals of the day');
select tests.ok((select closed_at is not null and check_done = 2 and check_needed = 2 and check_note is null
  from public.da_sessions where id = (select v::uuid from t where k = 's1')), 'the sheet is checked: 2 of 2');

-- ---------- report OK ----------
select tests.throws(format($$select public.da_report_ok(%L)$$, (select v from t where k = 's1')), 'a report ID is needed first', '22023');
select public.da_report_save((select v::uuid from t where k = 's1'), '#743858', 7500);
select tests.throws(format($$select public.da_report_ok(%L)$$, (select v from t where k = 's1')), 'a different amount needs a reason', '22023');
select tests.ok((public.da_report_ok((select v::uuid from t where k = 's1'), 'একটি পার্সেল পরের রিপোর্টে') ->> 'diff')::numeric = -500, 'with a reason the difference is kept');
select tests.ok((select report_ok_at is not null and report_total = 7500 and report_diff = -500 and report_note is not null and report_ok_by = tests.id('hub_mgr')
  from public.da_sessions where id = (select v::uuid from t where k = 's1')), 'the confirmation says who, how much and why');
select tests.ok((select report_ok_at is not null and report_diff = -500 from public.da_flow_list(current_date - 1, current_date + 1)
  where session_id = (select v::uuid from t where k = 's1')), 'the list shows the report is confirmed');
select tests.ok(((public.da_sheet((select v::uuid from t where k = 's1')) -> 'session' ->> 'report_total')::numeric) = 7500, 'the sheet carries the confirmation');

-- taking it back, and an exact match
select tests.throws(format($$select public.da_report_ok_undo(%L, ' ')$$, (select v from t where k = 's1')), 'taking it back needs a reason', '22023');
select public.da_report_ok_undo((select v::uuid from t where k = 's1'), 'ভুল রিপোর্ট');
select public.da_report_save((select v::uuid from t where k = 's1'), '#743859', 500);
select tests.ok((public.da_report_ok((select v::uuid from t where k = 's1')) ->> 'diff')::numeric = 0, 'matching amounts need no reason');

-- reopening the day takes the confirmation back
select public.da_reopen_day((select v::uuid from t where k = 's1'), 'একটি লাইন বাদ পড়েছে');
select tests.ok((select closed_at is null and report_ok_at is null and check_done is null from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'reopening the day clears the check and the confirmation');

-- ---------- fewer people than the hub needs: a reason is asked ----------
select tests.login(tests.id('acct_mgr'));
select public.da_hub_collectors_set(tests.id('hub_a1'), 3);
select tests.login(tests.id('hub_mgr'));
select public.da_parts_accept((select v::uuid from t where k = 's1'), array[tests.id('hub_mgr'), tests.id('admin')]);
select tests.throws(format($$select public.da_check(%L, '  ')$$, (select v from t where k = 's1')), 'two of three needs a reason', '22023');
select public.da_check((select v::uuid from t where k = 's1'), 'একজন ছুটিতে');
select tests.ok((select check_done = 2 and check_needed = 3 and check_note = 'একজন ছুটিতে' from public.da_sessions where id = (select v::uuid from t where k = 's1')),
  'with a reason the check goes through and the reason is kept');
select tests.login(tests.id('acct_mgr'));
select public.da_hub_collectors_set(tests.id('hub_a1'), null);
select tests.ok(private.da_collectors_needed(tests.id('hub_a1')) = 1, 'clearing the number goes back to the default');

-- a khata that goes back to draft is no longer accepted
select tests.login(tests.id('hub_mgr'));
select public.da_reopen_day((select v::uuid from t where k = 's1'), 'আরও একটি লাইন');
select tests.login(tests.id('admin'));
select public.da_save_rider_line((select v::uuid from t where k = 's1'), '1002', 1, 0, 100, 100, 0);
select tests.ok((select closed_at is null and accepted_at is null from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's1') and user_id = tests.id('admin')),
  'writing again puts the khata back to draft and takes the acceptance away');

-- nobody outside may call these
select tests.ok(not has_function_privilege('anon', 'public.da_check(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.da_report_ok(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.da_close_part_for(uuid, uuid, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'public.da_parts_accept(uuid, uuid[], boolean)', 'execute'), 'signed-out visitors cannot call the new functions');
rollback;
