-- Exercise the review boundary without changing production records.
begin;
select tests.fixture();
select tests.hr_fixture();

create function tests.review_sqlstate(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate;
end $$;

insert into tests.ids values ('review_rider', tests.make_user('review-rider@test.local', 'Review Rider'));
insert into tests.ids values ('review_employee', tests.active_employee('Review Rider', '985', tests.id('hub_a1'), '01711000985', '9850101010', 15000, tests.id('review_rider')));
select tests.grant_role(tests.id('review_rider'), 'rider', 'hub', null, tests.id('hub_a1'));

select tests.ok(not has_function_privilege('anon', 'public.wf_ops_decide(uuid, integer, boolean, text)', 'execute')
  and not has_table_privilege('authenticated', 'public.wf_ops_decisions', 'select'), 'decisions are accessible only through scoped RPCs');
select tests.login(tests.id('review_rider'));
insert into tests.ids select 'review_entry', (public.wf_ops_add(3, 1, 5, 0) ->> 'id')::uuid;
select tests.ok(tests.review_sqlstate(format('select public.wf_ops_decide(%L, 1, true)', tests.id('review_entry'))) = '42501', 'staff cannot approve an entry');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.review_sqlstate(format('select public.wf_ops_decide(%L, 1, true)', tests.id('review_entry'))) = '42501', 'another hub manager cannot approve an entry');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.review_sqlstate(format('select public.wf_ops_decide(%L, 1, false)', tests.id('review_entry'))) = '22023', 'returning requires a reason');
select public.wf_ops_decide(tests.id('review_entry'), 1, false, 'Check the delivery total');
select tests.ok(tests.review_sqlstate(format('select public.wf_ops_decide(%L, 1, true)', tests.id('review_entry'))) = '40001', 'second decision on the same revision is rejected');

select tests.login(tests.id('review_rider'));
select tests.ok(public.wf_ops_mine() #>> '{entry,review_note}' = 'Check the delivery total', 'staff sees the reason on their own entry');
select public.wf_ops_resubmit(tests.id('review_entry'), 1, 3, 1, 4, 0);
select tests.ok(public.wf_ops_mine() #>> '{entry,review_status}' is null
  and public.wf_ops_mine() #>> '{entry,revision}' = '2'
  and public.wf_ops_mine() #>> '{entry,delivery}' = '4', 'correction replaces the totals and reopens review');

select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.review_sqlstate(format('select public.wf_ops_decide(%L, 1, true)', tests.id('review_entry'))) = '40001', 'manager cannot approve a stale revision');
select public.wf_ops_decide(tests.id('review_entry'), 2, true);
select tests.login(tests.id('review_rider'));
select tests.ok(public.wf_ops_mine() #>> '{entry,review_status}' = 'approved', 'staff sees the final approval');
select tests.logout();
rollback;
