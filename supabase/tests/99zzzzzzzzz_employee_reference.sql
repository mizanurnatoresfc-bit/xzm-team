-- "যিনি এনেছেন" from the profile: staff or their manager ask, HR approves.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('me', tests.active_employee('Staff Me', '711', tests.id('hub_a1'), '01711000711', '7110101010', 12000, tests.id('rider_login'))),
  ('boss', tests.active_employee('Old Hand', '712', tests.id('hub_a1'), '01711000712', '7120101010')),
  ('far', tests.active_employee('Far Away', '713', tests.id('hub_b1'), '01711000713', '7130101010'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
create temp table t (k text primary key, v text); grant all on t to authenticated;

select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.hr_reference_request(%L, %L)$$, tests.id('me'), tests.id('me')), 'not oneself', '22023');
select tests.throws(format($$select public.hr_reference_request(%L, %L)$$, tests.id('far'), tests.id('boss')), 'a staff member cannot ask for someone else', '42501');
insert into t values ('r1', public.hr_reference_request(tests.id('me'), tests.id('boss'))::text);
select tests.ok((select (public.hr_reference_pending(tests.id('me')) -> 'person' ->> 'name') = 'Old Hand'), 'the own profile shows the waiting request');
select tests.ok((select referred_by_employee_id is null from public.employees where id = tests.id('me')), 'nothing is set before HR approves');
select tests.throws(format($$select public.hr_reference_decide(array[%L]::uuid[], true)$$, (select v from t where k = 'r1')), 'the asker cannot approve', '42501');
insert into t values ('r2', public.hr_reference_request(tests.id('me'), null, '{"name":"Outside Uncle","mobile":"01811-000000","hub":"Bazar"}'::jsonb)::text);
select tests.throws($$select count(*) from public.employee_reference_requests$$, 'no direct reading of the table', '42501');
select tests.logout();
select tests.ok((select status = 'cancelled' from public.employee_reference_requests where id = (select v::uuid from t where k = 'r1')), 'a new request replaces the waiting one');
select tests.ok((select count(*) >= 1 from public.notifications where title like 'যিনি এনেছেন — অনুমোদন দিন%'), 'HR is told');

select tests.login(tests.id('hub_mgr'));
insert into t values ('r3', public.hr_reference_request(tests.id('boss'), tests.id('me'))::text);
select tests.ok(true, 'a hub manager asks for a staff member of the hub');
select tests.logout();

select tests.login(tests.id('hr'));
select tests.ok((select jsonb_array_length(public.hr_reference_requests()) = 2), 'HR sees the two waiting requests');
select tests.throws(format($$select public.hr_reference_decide(array[%L]::uuid[], false)$$, (select v from t where k = 'r3')), 'saying no needs a reason', '22023');
select tests.ok(public.hr_reference_decide(array[(select v::uuid from t where k = 'r2')], true) = 1, 'HR approves the hand-written one');
select public.hr_reference_decide(array[(select v::uuid from t where k = 'r3')], false, 'wrong person');
select tests.logout();
select tests.ok((select reference_manual ->> 'name' = 'Outside Uncle' and reference_manual ->> 'mobile' = '01811000000' and referred_by_employee_id is null
                 from public.employees where id = tests.id('me')), 'approved: the reference is set on the employee');
select tests.ok((select referred_by_employee_id is null from public.employees where id = tests.id('boss')), 'turned down: nothing set');
select tests.ok((select count(*) >= 2 from public.notifications where title like 'যিনি এনেছেন: %'), 'the askers are told');
rollback;
