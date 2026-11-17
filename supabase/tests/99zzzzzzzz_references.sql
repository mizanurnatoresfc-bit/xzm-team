-- Reference list: anyone asks to add / change / remove; HR approves before it shows.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('r1', tests.active_employee('Ref Person', '701', tests.id('hub_a1'), '01711000701', '7010101010'));
create temp table t (k text primary key, v text); grant all on t to authenticated;
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 1 from public.ref_hub_people(tests.id('hub_a1')) where full_name = 'Ref Person'), 'anyone sees a hub''s people to pick from');
insert into t values ('a', public.ref_request_add(tests.id('r1'))::text);
insert into t values ('m', public.ref_request_add(null, 'Outside Man', 'Shop owner', '01811-222333', null, 'Bazar', tests.id('zone_a'))::text);
select tests.ok((select count(*) = 2 and bool_and(approval = 'pending' and status = 'inactive') from public.da_reference_people where requested_by = tests.id('rider_login')), 'a rider asks for two people; both wait');
select tests.ok((select name = 'Ref Person' and phone = '01711000701' and hub_name = 'Hub A1' from public.da_reference_people where id = (select v::uuid from t where k = 'a')), 'picked from the hub: name, number and hub fill themselves');
select tests.ok((select phone = '01811222333' from public.da_reference_people where id = (select v::uuid from t where k = 'm')), 'a hand-written number is cleaned');
select tests.throws(format($$select public.ref_request_add(%L)$$, tests.id('r1')), 'the same person cannot be asked twice', '23505');
select tests.throws($$select public.ref_request_add(null, 'X')$$, 'a one-letter name is refused', '22023');
select tests.throws(format($$select public.ref_decide(array[%L]::uuid[], true)$$, (select v from t where k = 'a')), 'the asker cannot approve', '42501');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 0 from public.da_reference_people where approval = 'pending'), 'others do not see waiting requests');
select tests.logout();
select tests.ok((select count(*) >= 1 from public.notifications where kind = 'hr_request' and title like 'রেফারেন্সে নতুন নাম%'), 'HR is told');

select tests.login(tests.id('hr'));
select tests.ok((select count(*) = 2 from public.da_reference_people where pending_action = 'add'), 'HR sees both requests');
select tests.ok(public.ref_decide(array[(select v::uuid from t where k = 'a')], true) = 1, 'HR approves one');
select tests.throws(format($$select public.ref_decide(array[%L]::uuid[], false)$$, (select v from t where k = 'm')), 'turning down needs a reason', '22023');
select public.ref_decide(array[(select v::uuid from t where k = 'm')], false, 'not needed');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 1 from public.da_reference_people where status = 'active' and approval = 'approved' and name = 'Ref Person'), 'after approval everyone sees it');
select tests.ok(not exists (select 1 from public.da_reference_people where name = 'Outside Man'), 'a turned-down one stays hidden');
select public.ref_request_edit((select v::uuid from t where k = 'a'), null, null, 'Senior Rider');
select tests.ok((select position = 'রাইডার' or position = 'Rider' from public.da_reference_people where id = (select v::uuid from t where k = 'a')) is not false, 'a change keeps the old values showing while it waits');
select tests.throws(format($$select public.ref_request_remove(%L, 'gone')$$, (select v from t where k = 'a')), 'one waiting request at a time', '23505');
select tests.logout();

select tests.login(tests.id('hr'));
select public.ref_decide(array[(select v::uuid from t where k = 'a')], true);
select tests.ok((select position = 'Senior Rider' and pending_action is null from public.da_reference_people where id = (select v::uuid from t where k = 'a')), 'approved change is applied');
select tests.logout();
select tests.login(tests.id('hub_mgr'));
select public.ref_request_remove((select v::uuid from t where k = 'a'), 'left the company');
select tests.ok((select status = 'active' from public.da_reference_people where id = (select v::uuid from t where k = 'a')), 'still listed until HR agrees to remove');
select tests.logout();
select tests.login(tests.id('hr'));
select public.ref_decide(array[(select v::uuid from t where k = 'a')], true);
select tests.logout();
select tests.ok((select status = 'inactive' from public.da_reference_people where id = (select v::uuid from t where k = 'a')), 'removed after approval');
select tests.ok((select count(*) >= 3 from public.notifications where profile_id = tests.id('rider_login') or profile_id = tests.id('hub_mgr')), 'the askers are told the answers');
select tests.login_anon();
select tests.throws($$select * from public.ref_hub_people(gen_random_uuid())$$, 'anon cannot read hub people', '42501');
select tests.logout();
rollback;
