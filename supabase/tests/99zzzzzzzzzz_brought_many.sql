-- "যাঁদের এনেছেন": add / remove many at once; staff wait for HR, HR applies at once.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('me', tests.active_employee('Staff Me', '721', tests.id('hub_a1'), '01711000721', '7210101010', 12000, tests.id('rider_login'))),
  ('n1', tests.active_employee('New One', '722', tests.id('hub_a1'), '01711000722', '7220101010')),
  ('n2', tests.active_employee('New Two', '723', tests.id('hub_b1'), '01711000723', '7230101010')),
  ('n3', tests.active_employee('New Three', '724', tests.id('hub_b1'), '01711000724', '7240101010'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
create temp table t (k text primary key, v jsonb); grant all on t to authenticated;

select tests.login(tests.id('rider_login'));
insert into t values ('a', public.hr_reference_many(array[tests.id('n1'), tests.id('n2')], 'set', tests.id('me')));
select tests.ok((select v ->> 'waiting' = '2' and v ->> 'applied' = '0' from t where k = 'a'), 'staff: two waiting, nothing applied');
select tests.ok((select jsonb_array_length(public.hr_reference_brought_pending(tests.id('me'))) = 2), 'my brought list shows the two waiting');
select tests.throws(format($$select public.hr_reference_many(array[%L]::uuid[], 'set', %L)$$, tests.id('n3'), tests.id('n1')), 'cannot claim for someone else', '42501');
select tests.throws($$select public.hr_reference_many('{}'::uuid[], 'set', null)$$, 'empty list', '22023');
select tests.logout();
select tests.ok((select count(*) = 0 from public.employees where referred_by_employee_id = tests.id('me')), 'nothing set before approval');

select tests.login(tests.id('hr'));
select tests.ok((select public.hr_reference_decide(array(select (x ->> 'id')::uuid from jsonb_array_elements(public.hr_reference_brought_pending(tests.id('me'))) x), true) = 2), 'HR approves both');
insert into t values ('h', public.hr_reference_many(array[tests.id('n3')], 'set', tests.id('me')));
select tests.ok((select v ->> 'applied' = '1' from t where k = 'h'), 'HR adds at once');
select tests.logout();
select tests.ok((select count(*) = 3 from public.employees where referred_by_employee_id = tests.id('me')), 'three brought');

select tests.login(tests.id('rider_login'));
insert into t values ('r', public.hr_reference_many(array[tests.id('n1'), tests.id('n2')], 'remove', tests.id('me'), 'ভুল'));
select tests.ok((select v ->> 'waiting' = '2' from t where k = 'r'), 'the referrer asks to remove two');
select tests.ok((select (public.hr_reference_pending(tests.id('n1')) ->> 'action') = 'remove'), 'the referrer sees the waiting removal on that profile');
select tests.logout();
select tests.login(tests.id('hr'));
select public.hr_reference_decide(array(select (x ->> 'id')::uuid from jsonb_array_elements(public.hr_reference_brought_pending(tests.id('me'))) x where x ->> 'action' = 'remove'), true);
select tests.logout();
select tests.ok((select array_agg(full_name order by full_name) = array['New Three'] from public.employees where referred_by_employee_id = tests.id('me')), 'removal approved: one left');
rollback;
