-- Vehicles and their holder, the reference person on an expense, and the bills staff put up themselves.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into tests.ids values
  ('r1', tests.active_employee('Vehicle Rider One', '701', tests.id('hub_a1'), '01711000701', '7010101010')),
  ('r2', tests.active_employee('Vehicle Rider Two', '702', tests.id('hub_a1'), '01711000702', '7020202020')),
  -- the hub manager has an employee record of their own, so they can put up a bill too
  ('mgr', tests.active_employee('Hub Manager Person', '700', tests.id('hub_a1'), '01711000700', '7000000000',
                                15000, tests.id('hub_mgr')));

-- ---------- keeping the list of vehicles ----------
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.vehicle_save('Office bike', 'BIKE-1', 'bike', %L)$$, tests.id('hub_a1')),
  'a rider cannot add a vehicle', '42501');

select tests.login(tests.id('acct_mgr'));
insert into t values ('v1', public.vehicle_save('Office bike', 'BIKE-1', 'bike', tests.id('hub_a1'), 'DHAKA METRO LA 11-2233')::text);
select tests.ok((select count(*) = 1 from public.vehicle_list(tests.id('hub_a1'))), 'the hub has one vehicle');
select tests.ok((select holder_id is null from public.vehicle_list(tests.id('hub_a1'))), 'a new vehicle is held by nobody');
select tests.throws(format($$select public.vehicle_save('Odd thing', 'X-1', 'helicopter', %L)$$, tests.id('hub_a1')),
  'an unknown kind of vehicle is refused', '22023');

select public.vehicle_assign((select v::uuid from t where k = 'v1'), '701', 'Given for deliveries');
select tests.ok((select holder_code = '701' from public.vehicle_list(tests.id('hub_a1'))), 'the vehicle is handed to rider 701');
select public.vehicle_assign((select v::uuid from t where k = 'v1'), '702', 'Moved to the other rider');
select tests.ok((select holder_code = '702' from public.vehicle_list(tests.id('hub_a1'))), 'handing it on moves the holder');
select tests.ok((select count(*) = 1 from public.vehicle_assignments where vehicle_id = (select v::uuid from t where k = 'v1') and effective_to is null),
  'only one person holds a vehicle at a time');
select tests.ok((select count(*) = 2 from public.vehicle_assignments where vehicle_id = (select v::uuid from t where k = 'v1')),
  'the earlier holder stays in the history');
select tests.throws(format($$select public.vehicle_assign(%L, '999', 'Nobody')$$, (select v from t where k = 'v1')),
  'an unknown Employee ID is refused', '22023');

-- ---------- the vehicle's expenses show on the holder's own page ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('s1', public.da_start_session(tests.id('hub_a1'))::text);
insert into t values ('x1', public.da_save_expense((select v::uuid from t where k = 's1'), 'transport', null,
  'Fuel for the bike', 'fuel', 900, private.da_today())::text);
select public.da_set_expense_reference((select v::uuid from t where k = 'x1'), 'Jamal Pump', '01711000900', 'Manager',
                                       (select v::uuid from t where k = 'v1'));
select tests.ok((select reference_name = 'Jamal Pump' and reference_phone = '01711000900' and reference_position = 'Manager'
                 from public.da_expenses where id = (select v::uuid from t where k = 'x1')),
  'the reference person is kept with the expense');
select tests.throws(format($$select public.da_set_expense_reference(%L, 'X', '12345', 'Y')$$, (select v from t where k = 'x1')),
  'a mobile number that is not a mobile number is refused', '22023');

select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 0 from public.da_my_vehicles()), 'someone who holds no vehicle sees none');
select tests.logout();
update public.employees set profile_id = tests.id('rider_login') where id = tests.id('r1');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 0 from public.da_my_vehicles()), 'rider 701 no longer holds the bike, so it is not on their page');
select tests.logout();
update public.vehicle_assignments set effective_to = current_date
 where vehicle_id = (select v::uuid from t where k = 'v1') and employee_id = tests.id('r2');
update public.vehicle_assignments set effective_to = null, end_reason = null
 where vehicle_id = (select v::uuid from t where k = 'v1') and employee_id = tests.id('r1');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 1 from public.da_my_vehicles()), 'the holder sees the vehicle on their own page');
select tests.ok((select (spent_30d)::numeric = 900 from public.da_my_vehicles()),
  'the holder sees what was spent on that vehicle');
select tests.ok((select (lines -> 0 ->> 'name') = 'Fuel for the bike' from public.da_my_vehicles()),
  'and what each line was for');

-- ---------- a person puts up their own bill ----------
select tests.login(tests.id('hr'));
select tests.throws($$select public.da_claim_save('Lunch', 'meal', 300, current_date)$$,
  'someone with no employee record of their own cannot put up a bill', '42501');

select tests.login(tests.id('hub_mgr'));
insert into t values ('c1', public.da_claim_save('CNG to the zone office', 'transport', 350, private.da_today())::text);
select tests.ok((select status = 'submitted' and employee_code is not null
                 from public.da_expense_claims where id = (select v::uuid from t where k = 'c1')),
  'the claim waits with the name of the person who put it up');
select tests.ok((select count(*) = 1 from public.da_my_claims()), 'the person sees their own claim');
select tests.throws($$select public.da_claim_save('Odd', 'no_such_category', 100, current_date)$$,
  'a category that does not exist is refused', '22023');
select tests.throws($$select public.da_claim_save('Future', 'transport', 100, current_date + 1)$$,
  'a bill dated in the future is refused', '22023');
select tests.throws($$select public.da_claim_save('Free', 'transport', 0, current_date)$$,
  'an amount of zero is refused', '22023');
select tests.throws(format($$select public.da_claim_save('Someone else''s file', 'transport', 100, current_date,
   'employee', null, null, null, null, null, null, 'claims/%s/bill.jpg')$$, gen_random_uuid()),
  'a bill file in someone else''s folder is refused', '22023');

-- ---------- the manager takes it into the sheet ----------
select tests.ok((select count(*) = 1 from public.da_sheet_claims((select v::uuid from t where k = 's1'))),
  'the sheet shows the claims of its own hub');
insert into t values ('x2', public.da_claim_add((select v::uuid from t where k = 'c1'), (select v::uuid from t where k = 's1'), 'ঠিক আছে')::text);
select tests.ok((select expense_name = 'CNG to the zone office' and amount = 350 and claim_id is not null
                 from public.da_expenses where id = (select v::uuid from t where k = 'x2')),
  'the claim becomes an expense line on the day''s sheet');
select tests.ok((select status = 'added' and expense_id = (select v::uuid from t where k = 'x2')
                 from public.da_expense_claims where id = (select v::uuid from t where k = 'c1')),
  'the claim is marked as taken in');
select tests.ok((select count(*) = 0 from public.da_sheet_claims((select v::uuid from t where k = 's1'))),
  'a claim that was taken in no longer waits');
select tests.throws(format($$select public.da_claim_add(%L, %L)$$, (select v from t where k = 'c1'), (select v from t where k = 's1')),
  'the same bill cannot go in twice', '22023');

-- the person whose name is on the expense sees it on their own page
select tests.login(tests.id('rider_login'));
insert into t values ('c1r', public.da_claim_save('Van fuel', 'fuel', 900, private.da_today())::text);
select tests.login(tests.id('hub_mgr'));
select public.da_claim_add((select v::uuid from t where k = 'c1r'), (select v::uuid from t where k = 's1'));
select tests.login(tests.id('rider_login'));
select tests.ok((select jsonb_array_length(public.da_my_accounts(private.da_today() - 7, private.da_today()) -> 'my_expenses') >= 1),
  'the expense a manager took into the sheet shows on the rider''s own page');
select tests.ok((select (public.da_my_accounts(private.da_today() - 7, private.da_today()) -> 'my_expenses' -> 0 ->> 'expense_name') = 'Van fuel'),
  'and it is the bill he submitted himself');
select tests.login(tests.id('hub_mgr'));

-- turning one down needs a reason
insert into t values ('c2', public.da_claim_save('Tea for guests', 'entertainment', 120, private.da_today())::text);
select tests.throws(format($$select public.da_claim_reject(%L, '')$$, (select v from t where k = 'c2')),
  'a claim is not turned down without a reason', '22023');
select public.da_claim_reject((select v::uuid from t where k = 'c2'), 'হাবের খরচে পড়ে না');
select tests.ok((select status = 'rejected' and review_note = 'হাবের খরচে পড়ে না'
                 from public.da_expense_claims where id = (select v::uuid from t where k = 'c2')),
  'the reason for turning it down stays with the claim');

-- a rider of another hub cannot deal with this hub's claims
insert into t values ('c3', public.da_claim_save('Rickshaw', 'transport', 80, private.da_today())::text);
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.da_claim_reject(%L, 'না')$$, (select v from t where k = 'c3')),
  'a rider cannot turn down someone else''s claim', '42501');
select tests.ok((select count(*) = 1 and bool_and(expense_name = 'Van fuel') from public.da_my_claims()),
  'a rider sees only the bill he submitted himself, not the ones the hub manager sent');

rollback;
