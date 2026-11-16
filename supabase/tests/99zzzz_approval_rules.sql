-- Approval rules: who sets them, and that the hisab khata obeys them.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

-- ---------- nothing changes until a rule is set ----------
select tests.ok(private.approval_mode('khata', tests.id('zone_a')) = 'approve', 'with no rule, an input waits for approval');
select tests.login(tests.id('hub_mgr'));
insert into t values ('s0', public.da_start_session(tests.id('hub_a1'))::text);
select public.da_close_my_part((select v::uuid from t where k = 's0'));
select tests.ok((select accepted_at is null from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's0')), 'a submitted khata still waits to be accepted');
select tests.ok(public.da_parts_accept((select v::uuid from t where k = 's0'), array[tests.id('hub_mgr')]) = 1, 'and is accepted by hand as before');

-- ---------- who may set a rule ----------
select tests.throws($$select * from public.approval_rules_list(null)$$, 'a hub manager cannot open the rules', '42501');
select tests.throws(format($$select public.approval_rule_save('khata', %L, 'auto')$$, tests.id('zone_a')), 'a hub manager cannot set a rule', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) = 7 and bool_and(mode = 'approve') from public.approval_rules_list(tests.id('zone_a'))), 'the zonal manager sees every kind, all on "approval" to begin with');
select tests.throws($$select public.approval_rule_save('khata', null, 'auto')$$, 'a zonal manager cannot set the rule for all zones', '42501');
select tests.throws(format($$select public.approval_rule_save('khata', %L, 'auto')$$, tests.id('zone_b')), 'nor for another zone', '42501');
select tests.throws(format($$select public.approval_rule_save('leave', %L, 'auto')$$, tests.id('zone_a')), 'a kind that is not switched on yet cannot be set', '22023');
select tests.throws(format($$select public.approval_rule_save('khata', %L, 'whatever')$$, tests.id('zone_a')), 'an unknown rule is refused', '22023');
select tests.throws($$insert into public.approval_rules (kind, mode) values ('khata', 'auto')$$, 'rules cannot be written past the function', '42501');
select public.approval_rule_save('khata', tests.id('zone_a'), 'auto');
select tests.ok((select mode = 'auto' and zone_mode = 'auto' and all_mode = 'approve' and set_by_name is not null from public.approval_rules_list(tests.id('zone_a')) where kind = 'khata'),
  'the zonal manager sets their own zone to auto accept');
select tests.ok(private.approval_mode('khata', tests.id('zone_b')) = 'approve', 'another zone is not touched');

-- ---------- auto: accepted on submit, the manager may take it back ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.approval_mode_at('khata', tests.id('hub_a1')) = 'auto', 'the hub''s pages can ask what applies');
select tests.ok((select accepted_by = tests.id('hub_mgr') from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's0')), 'a khata accepted earlier by hand is left as it was');
select public.da_close_my_part((select v::uuid from t where k = 's0'), null, false);
select tests.ok((select accepted_at is null and closed_at is null from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's0')), 'reopening a khata still clears its acceptance');
select public.da_close_my_part((select v::uuid from t where k = 's0'));
select tests.ok((select accepted_at is not null and accepted_by is null and accepted_by_name = 'অটো গ্রহণ' from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's0')),
  'on auto, a khata is accepted the moment it is submitted');
select tests.ok(public.da_parts_accept((select v::uuid from t where k = 's0'), array[tests.id('hub_mgr')], false) = 1, 'on auto, the manager may take the acceptance back');
select tests.ok((select accepted_at is null and closed_at is not null from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's0')), 'taken back, it waits again and is not accepted a second time by itself');
select tests.ok(public.da_parts_accept((select v::uuid from t where k = 's0'), array[tests.id('hub_mgr')]) = 1, 'and can be accepted by hand');

-- ---------- view: accepted on submit, cannot be taken back from above ----------
select tests.login(tests.id('super'));
select public.approval_rule_save('khata', null, 'view');
select tests.ok(private.approval_mode('khata', tests.id('zone_b')) = 'view' and private.approval_mode('khata', tests.id('zone_a')) = 'auto', 'the rule for all zones applies where a zone has none of its own');
select public.approval_rule_save('khata', tests.id('zone_a'), null);
select tests.ok(private.approval_mode('khata', tests.id('zone_a')) = 'view', 'clearing a zone''s rule makes it follow "all zones" again');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.da_parts_accept(%L, array[%L]::uuid[], false)$$, (select v from t where k = 's0'), tests.id('hub_mgr')), 'on view, an acceptance cannot be taken back', '22023');
select public.da_close_my_part((select v::uuid from t where k = 's0'), null, false);
select public.da_close_my_part((select v::uuid from t where k = 's0'));
select tests.ok((select accepted_by_name = 'সরাসরি গৃহীত' from public.da_sheet_collectors where session_id = (select v::uuid from t where k = 's0')), 'on view, the person reopens and submits, and it is accepted again');
select tests.ok((public.da_check((select v::uuid from t where k = 's0'), 'একজনই হিসাব নিয়েছেন')->>'khatas')::int = 1, 'the daily sheet opens from an automatically accepted khata');

-- ---------- back to approval ----------
select tests.login(tests.id('super'));
select public.approval_rule_save('khata', null, 'approve');
select tests.ok(private.approval_mode('khata', tests.id('zone_a')) = 'approve', 'the Super Admin can put everything back on approval');
select tests.logout();
select tests.ok(not has_function_privilege('anon', 'public.approval_rule_save(text, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.approval_rules_list(uuid)', 'execute') and not has_table_privilege('anon', 'public.approval_rules', 'select'),
  'signed-out visitors cannot reach the rules');
rollback;
