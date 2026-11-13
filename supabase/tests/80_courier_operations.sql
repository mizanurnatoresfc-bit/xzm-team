-- Courier operations: assignments, merchants, pickup submissions (duplicate / conflict
-- detection, verify -> approve), delivery, cash handover chain, merchant payments,
-- expenses, daily reconciliation, parcel issues, reports, hub_daily_metrics refresh.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('pm',     tests.make_user('pickup.a1@test.local', 'Pickup Mgr A1')),
  ('rider2', tests.make_user('rider2@test.local', 'Rider Two Login'));
select tests.grant_role(tests.id('pm'),          'pickup_manager', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('rider_login'), 'rider',          'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('rider2'),      'rider',          'hub', null, tests.id('hub_a1'));
insert into tests.ids values
  ('emp_r1', tests.active_employee('Rider One',  'XZ-00021', tests.id('hub_a1'), '01711000021', '1234567821', 15000, tests.id('rider_login'))),
  ('emp_r2', tests.active_employee('Rider Two',  'XZ-00022', tests.id('hub_a1'), '01711000022', '1234567822', 15000, tests.id('rider2'))),
  ('emp_hm', tests.active_employee('Hub Boss',   'XZ-00023', tests.id('hub_a1'), '01711000023', '1234567823', 30000, tests.id('hub_mgr'))),
  ('emp_zm', tests.active_employee('Zone Boss',  'XZ-00024', tests.id('hub_a1'), '01711000024', '1234567824', 40000, tests.id('zonal_a'))),
  ('emp_rb', tests.active_employee('Rider B',    'XZ-00025', tests.id('hub_b1'), '01711000025', '1234567825'));

-- ---------- 1. Hub Manager / Zonal Manager / rider assignments, hub staff, merchants ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.ops_assign('hub_manager', %L, %L, null, current_date - 30, 'Appointed')$$,
                           tests.id('emp_hm'), tests.id('hub_a1')),
                    'a hub manager cannot appoint a hub manager', '42501');
select tests.login(tests.id('zonal_a'));
select public.ops_assign('hub_manager', tests.id('emp_hm'), tests.id('hub_a1'), null, current_date - 30, 'Appointed');
select tests.ok((select count(*) = 1 from public.ops_assignments where kind = 'hub_manager' and hub_id = tests.id('hub_a1') and effective_to is null),
                'zonal manager assigns the hub manager of a hub in own zone');
select tests.throws(format($$select public.ops_assign('zonal_manager', %L, null, %L, current_date - 30, 'Appointed')$$,
                           tests.id('emp_zm'), tests.id('zone_a')),
                    'a zonal manager cannot appoint a zonal manager', '42501');
select tests.throws(format($$select public.ops_assign('hub_manager', %L, %L, null, current_date - 30, 'Appointed')$$,
                           tests.id('emp_rb'), tests.id('hub_b1')),
                    'zonal manager cannot assign in another zone', '42501');
select tests.login(tests.id('admin'));
select public.ops_assign('zonal_manager', tests.id('emp_zm'), null, tests.id('zone_a'), current_date - 30, 'Appointed');
select tests.throws(format($$select public.ops_assign('zonal_manager', %L, null, %L, current_date, ' ')$$,
                           tests.id('emp_zm'), tests.id('zone_a')),
                    'an assignment needs a reason', '22023');

select tests.login(tests.id('hub_mgr'));
select public.ops_assign('rider', tests.id('emp_r1'), tests.id('hub_a1'), null, current_date - 30, 'Joined as rider', 'both');
select public.ops_assign('rider', tests.id('emp_r2'), tests.id('hub_a1'), null, current_date - 30, 'Joined as rider', 'both');
select tests.throws(format($$select public.ops_assign('rider', %L, %L, null, current_date - 30, 'Joined')$$,
                           tests.id('emp_rb'), tests.id('hub_b1')),
                    'hub manager cannot assign riders in another hub', '42501');
select public.ops_assign('rider', tests.id('emp_r2'), tests.id('hub_a1'), null, current_date, 'Delivery only from today', 'delivery');
select tests.ok((select count(*) = 2 and count(*) filter (where effective_to is null) = 1
                        and bool_or(effective_to = current_date - 1)
                 from public.ops_assignments where employee_id = tests.id('emp_r2')),
                'a new rider assignment closes the previous one and keeps the history');
select tests.ok((select count(*) = 4 and count(*) filter (where ops_role = 'hub_manager') = 1
                        and count(*) filter (where ops_role = 'rider') = 2
                 from public.ops_hub_staff(tests.id('hub_a1'))),
                'hub-wise employee list shows the hub manager and riders');

insert into public.merchants (code, name, hub_id) values
  ('M1', 'Merchant One', tests.id('hub_a1')), ('M2', 'Merchant Two', tests.id('hub_a1')), ('M3', 'Merchant Three', tests.id('hub_a1'));
insert into tests.ids select 'm' || right(code::text, 1), id from public.merchants;
select tests.ok(tests.id('m3') is not null, 'hub manager creates merchants for own hub');
select tests.throws(format($$insert into public.merchants (code, name, hub_id) values ('MB', 'Merchant B', %L)$$, tests.id('hub_b1')),
                    'hub manager cannot create a merchant in another hub', '42501');

select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count('select 1 from public.merchants') = 0, 'hub manager of another zone sees no merchants of hub A1');
select tests.ok(tests.row_count('select 1 from public.ops_assignments') = 0, 'and none of its assignments');
select tests.ok(tests.row_count(format('select 1 from public.ops_hub_staff(%L)', tests.id('hub_a1'))) = 0, 'and not its staff list');
select tests.login(tests.id('rider_login'));
select tests.ok(tests.row_count('select 1 from public.ops_assignments') = 1, 'a rider sees only the own assignment');

-- ---------- 2. Pickup submissions: three independent sources ----------
select tests.login(tests.id('pm'));
insert into tests.ids select 'ps_m1_pm', public.ops_submit_pickup('pickup_manager', current_date, tests.id('hub_a1'), tests.id('m1'), 10, 5000, 0, tests.id('emp_r1'));
insert into tests.ids select 'ps_m2_pm', public.ops_submit_pickup('pickup_manager', current_date, tests.id('hub_a1'), tests.id('m2'), 5, 2500, 0, tests.id('emp_r1'));
insert into tests.ids select 'ps_m3_pm', public.ops_submit_pickup('pickup_manager', current_date, tests.id('hub_a1'), tests.id('m3'), 7, 0, 0);
select tests.ok((select status = 'pending' and source = 'pickup_manager' and submitted_by = tests.id('pm') and submitted_at is not null
                 from public.pickup_submissions where id = tests.id('ps_m1_pm')),
                'pickup manager submission is stored with submitter, time and pending status');
select tests.throws(format($$select public.ops_submit_pickup('hub_manager', current_date, %L, %L, 10, 5000, 0)$$, tests.id('hub_a1'), tests.id('m1')),
                    'pickup manager cannot submit as hub manager', '42501');
select tests.throws(format($$select public.ops_submit_pickup('pickup_manager', current_date, %L, %L, 10, 5000, 0)$$, tests.id('hub_a1'), tests.id('m1')),
                    'the same person cannot submit the same pickup twice', '23505');
select tests.throws(format($$select public.ops_submit_pickup('pickup_manager', current_date, %L, %L, 10, 5000, 0)$$, tests.id('hub_b1'), tests.id('m1')),
                    'pickup manager cannot submit for another hub', '42501');
select tests.throws(format($$select public.ops_submit_pickup('pickup_manager', current_date + 1, %L, %L, 3, 0, 0)$$, tests.id('hub_a1'), tests.id('m2')),
                    'a pickup cannot be submitted for a future date', '22023');
insert into tests.ids select 'ps_m1_t2', public.ops_submit_pickup('pickup_manager', current_date, tests.id('hub_a1'), tests.id('m1'), 4, 0, 0, null, 2);
select public.ops_withdraw_pickup(tests.id('ps_m1_t2'), 'Entered by mistake');
select tests.ok((select status = 'rejected' from public.pickup_submissions where id = tests.id('ps_m1_t2')),
                'the submitter can withdraw a pending submission');

select tests.login(tests.id('rider_login'));
insert into tests.ids select 'ps_m1_rd', public.ops_submit_pickup('rider', current_date, tests.id('hub_a1'), tests.id('m1'), 10, 5000, 0);
insert into tests.ids select 'ps_m2_rd', public.ops_submit_pickup('rider', current_date, tests.id('hub_a1'), tests.id('m2'), 5, 2500, 0);
select tests.ok((select rider_id = tests.id('emp_r1') and source = 'rider' from public.pickup_submissions where id = tests.id('ps_m1_rd')),
                'a rider submission is tied to the rider''s own employee record');
select tests.ok(tests.row_count('select 1 from public.pickup_submissions') = 2, 'a rider sees only own submissions');

select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'ps_m1_hm', public.ops_submit_pickup('hub_manager', current_date, tests.id('hub_a1'), tests.id('m1'), 12, 6000, 0, tests.id('emp_r1'));
select tests.ok(tests.row_count('select 1 from public.pickup_submissions') = 7, 'every submission is stored independently');

-- ---------- 3. Duplicate and conflict detection ----------
select tests.login(tests.id('zonal_a'));
select tests.ok((select check_state = 'conflict' and submissions = 3 and min_parcels = 10 and max_parcels = 12
                        and sources = array['hub_manager','pickup_manager','rider']
                 from public.ops_pickup_groups(current_date, current_date, tests.id('zone_a')) where merchant_id = tests.id('m1')),
                'three submissions with different figures are flagged as a conflict');
select tests.ok((select check_state = 'duplicate' and submissions = 2
                 from public.ops_pickup_groups(current_date, current_date, tests.id('zone_a')) where merchant_id = tests.id('m2')),
                'two submissions with the same figures are flagged as duplicates');
select tests.ok((select check_state = 'single' and group_status = 'pending'
                 from public.ops_pickup_groups(current_date, current_date, tests.id('zone_a')) where merchant_id = tests.id('m3')),
                'a lone submission is single');
select tests.ok(tests.row_count(format('select 1 from public.ops_pickup_groups(current_date, current_date, %L)', tests.id('zone_a'))) = 3,
                'withdrawn submissions are left out of the comparison');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count('select 1 from public.pickup_submissions') = 0, 'another hub sees no pickup submissions of hub A1');
select tests.ok(tests.row_count('select 1 from public.ops_pickup_groups(current_date, current_date)') = 0, 'and no pickup comparison');

-- ---------- 4. Pending -> Verified -> Approved / Rejected ----------
select tests.login(tests.id('pm'));
select tests.throws(format('select public.ops_verify_pickup(%L)', tests.id('ps_m2_rd')), 'pickup manager cannot verify', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.ops_verify_pickup(%L)', tests.id('ps_m1_pm')),
                    'a person who submitted the pickup cannot verify another submission of it', '42501');
select public.ops_verify_pickup(tests.id('ps_m2_pm'));
select public.ops_verify_pickup(tests.id('ps_m3_pm'));
select tests.ok((select status = 'verified' and verified_by = tests.id('hub_mgr') from public.pickup_submissions where id = tests.id('ps_m2_pm')),
                'hub manager verifies a submission of a pickup they did not submit');
select tests.throws(format('select public.ops_approve_pickup(%L)', tests.id('ps_m2_pm')), 'hub manager cannot approve pickups', '42501');

select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.ops_approve_pickup(%L)', tests.id('ps_m1_pm')), 'a pending submission cannot be approved', 'P0001');
select public.ops_verify_pickup(tests.id('ps_m1_pm'));
select tests.throws(format('select public.ops_approve_pickup(%L)', tests.id('ps_m1_pm')),
                    'conflicting submissions cannot be approved without a note', '22023');
select tests.ok(tests.row_count(format($$select 1 from public.ops_daily_report('date', current_date, current_date, %L)$$, tests.id('zone_a'))) = 0,
                'pending and verified submissions do not appear in the daily report');
select tests.ok(not exists (select 1 from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date),
                'and do not reach the hub figures');

insert into tests.ids select 'pc_m1', public.ops_approve_pickup(tests.id('ps_m1_pm'), 'Rider and pickup manager agree; hub count was a recount error');
select tests.ok((select string_agg(source || '=' || status, ',' order by source) = 'hub_manager=rejected,pickup_manager=approved,rider=approved'
                 from public.pickup_submissions where consolidation_id = tests.id('pc_m1')),
                'matching submissions are approved, the conflicting one is rejected');
select tests.ok((select parcel_count = 10 and cod_amount = 5000 and submission_count = 3 and had_conflict
                        and approved_by = tests.id('zonal_a') and accepted_submission_id = tests.id('ps_m1_pm')
                 from public.pickup_consolidations where id = tests.id('pc_m1')),
                'one consolidated record holds the accepted figures');
insert into tests.ids select 'pc_m2', public.ops_approve_pickup(tests.id('ps_m2_pm'));
select tests.ok((select count(*) = 2 and bool_and(status = 'approved') from public.pickup_submissions where consolidation_id = tests.id('pc_m2')),
                'duplicate submissions are both closed by one approval');
select tests.ok((select pickup_parcels = 15 and pickup_cod = 7500
                 from public.ops_daily_report('date', current_date, current_date, tests.id('zone_a'))),
                'the report counts each pickup once: 10 + 5, not the sum of all submissions (42)');
select tests.ok((select pickup_count = 15 and status = 'verified' and source = 'courier'
                 from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date),
                'approved pickups refresh the daily hub figures');
select tests.throws(format('select public.ops_approve_pickup(%L)', tests.id('ps_m1_pm')), 'a pickup cannot be approved twice', 'P0001');
select tests.login(tests.id('rider2'));
select tests.throws(format($$select public.ops_submit_pickup('rider', current_date, %L, %L, 9, 0, 0)$$, tests.id('hub_a1'), tests.id('m1')),
                    'no new submission for a pickup that is already approved', 'P0001');

select tests.login(tests.id('admin'));
select public.ops_submit_pickup('hub_manager', current_date, tests.id('hub_a1'), tests.id('m3'), 7, 0, 0);
select tests.throws(format('select public.ops_approve_pickup(%L)', tests.id('ps_m3_pm')),
                    'a person who submitted the pickup cannot approve it', '42501');
select tests.throws(format($$select public.ops_reject_pickup(%L, ' ')$$, tests.id('ps_m3_pm')), 'rejecting needs a reason', '22023');
select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'pc_m3', public.ops_approve_pickup(tests.id('ps_m3_pm'));
select tests.ok((select pickup_parcels = 22 from public.ops_daily_report('date', current_date, current_date, tests.id('zone_a'))),
                'a newly approved pickup enters the report');
select public.ops_void_pickup(tests.id('pc_m3'), 'Merchant cancelled the pickup');
select tests.ok((select pickup_parcels = 15 from public.ops_daily_report('date', current_date, current_date, tests.id('zone_a')))
                and (select status = 'verified' and consolidation_id is null from public.pickup_submissions where id = tests.id('ps_m3_pm'))
                and (select pickup_count = 15 from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date),
                'reopening an approved pickup removes it from the report and the hub figures');

-- ---------- 5. Parcels, dispatch, delivery ----------
select tests.login(tests.id('hub_mgr'));
insert into public.parcels (tracking_no, merchant_id, hub_id, customer_name, cod_amount) values
  ('XZ-1001', tests.id('m1'), tests.id('hub_a1'), 'Customer One', 1000),
  ('XZ-1002', tests.id('m1'), tests.id('hub_a1'), 'Customer Two', 1000),
  ('XZ-1003', tests.id('m1'), tests.id('hub_a1'), 'Customer Three', 1000),
  ('XZ-1004', tests.id('m1'), tests.id('hub_a1'), 'Customer Four', 0);
insert into tests.ids select 'p_' || right(tracking_no::text, 4), id from public.parcels;
select tests.throws(format($$insert into public.parcels (tracking_no, merchant_id, hub_id, customer_name, status) values ('XZ-1999', %L, %L, 'X Y', 'delivered')$$,
                           tests.id('m1'), tests.id('hub_a1')),
                    'a parcel cannot be booked as already delivered', '42501');
select tests.throws(format($$update public.parcels set status = 'delivered' where id = %L$$, tests.id('p_1001')),
                    'parcel status cannot be changed directly', '42501');
select tests.throws(format('select public.ops_dispatch_parcels(%L, array[%L]::uuid[])', tests.id('emp_rb'), tests.id('p_1001')),
                    'a parcel cannot be dispatched to a rider of another hub', '22023');
select tests.ok(public.ops_dispatch_parcels(tests.id('emp_r1'), array[tests.id('p_1001'), tests.id('p_1002'), tests.id('p_1003')]) = 3,
                'hub manager dispatches parcels to a rider');
select public.ops_dispatch_parcels(tests.id('emp_r2'), array[tests.id('p_1004')]);

select tests.login(tests.id('rider_login'));
select tests.ok(tests.row_count('select 1 from public.parcels') = 3, 'a rider sees only the parcels they carry');
insert into tests.ids select 'd_1001', public.ops_record_delivery(tests.id('p_1001'), 'delivered', 1000);
insert into tests.ids select 'd_1002', public.ops_record_delivery(tests.id('p_1002'), 'failed', 0, 'Customer not at home');
insert into tests.ids select 'd_1003', public.ops_record_delivery(tests.id('p_1003'), 'delivered', 800);
select tests.throws(format($$select public.ops_record_delivery(%L, 'delivered', 0)$$, tests.id('p_1004')),
                    'a rider cannot record delivery of another rider''s parcel', '42501');
select tests.throws(format($$select public.ops_record_delivery(%L, 'delivered', 1000)$$, tests.id('p_1001')),
                    'a parcel cannot have two open delivery records', 'P0001');
select tests.throws(format($$select public.ops_record_delivery(%L, 'failed')$$, tests.id('p_1001')),
                    'a failed delivery needs a reason', '22023');
select tests.throws(format($$select public.ops_decide_delivery(%L, 'approved')$$, tests.id('d_1001')),
                    'a rider cannot approve own delivery', '42501');

select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'd_1004', public.ops_record_delivery(tests.id('p_1004'), 'delivered', 0);
select tests.throws(format($$select public.ops_decide_delivery(%L, 'approved')$$, tests.id('d_1004')),
                    'the person who recorded a delivery cannot approve it', '42501');
select tests.ok((select coalesce(sum(delivered), 0) = 0 and coalesce(sum(cash_collected), 0) = 0
                 from public.ops_daily_report('hub', current_date, current_date, tests.id('zone_a'))),
                'unapproved deliveries are not in the report');
select public.ops_decide_delivery(tests.id('d_1001'), 'approved');
select tests.throws(format($$select public.ops_decide_delivery(%L, 'approved')$$, tests.id('d_1003')),
                    'a COD mismatch cannot be approved without a note', '22023');
select public.ops_decide_delivery(tests.id('d_1003'), 'approved', 'Customer paid 800; merchant agreed a 200 discount');
select public.ops_decide_delivery(tests.id('d_1002'), 'approved');
select tests.login(tests.id('zonal_a'));
select public.ops_decide_delivery(tests.id('d_1004'), 'approved');

select tests.ok((select delivered = 3 and failed = 1 and returned = 0 and success_pct = 75.0
                        and cod_expected = 2000 and cod_collected = 1800 and cash_collected = 1800
                 from public.ops_daily_report('hub', current_date, current_date, tests.id('zone_a')) where group_key = 'A1'),
                'hub report: success, failed and COD from approved deliveries');
select tests.ok((select status = 'delivered' and assigned_rider_id is null and closed_at is not null from public.parcels where id = tests.id('p_1001'))
                and (select status = 'at_hub' and attempt_count = 1 from public.parcels where id = tests.id('p_1002')),
                'approval closes a delivered parcel and returns a failed one to the hub');
select tests.ok((select delivered = 2 and pickup_parcels = 15 from public.ops_daily_report('rider', current_date, current_date, tests.id('zone_a'))
                 where group_key = tests.id('emp_r1')::text),
                'rider-wise report');
select tests.ok((select delivered = 3 and pickup_parcels = 10 from public.ops_daily_report('merchant', current_date, current_date, tests.id('zone_a'))
                 where group_key = 'M1'),
                'merchant-wise report');
select tests.ok((select pickup_parcels = 15 and delivered = 3 from public.ops_daily_report('zone', current_date, current_date) where group_key = 'ZA'),
                'zone-wise report (zonal manager sees only own zone)');
select tests.ok((select delivery_count = 3 and pending_parcels = 1 and cash_collected = 1800 and pickup_count = 15 and rider_count = 2
                 from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date),
                'approved deliveries refresh the daily hub figures (pending parcel = the failed one)');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.ops_dispatch_parcels(%L, array[%L]::uuid[])$$, tests.id('emp_r1'), tests.id('p_1001')),
                    'a delivered parcel cannot be dispatched again', 'P0001');

-- ---------- 6. Cash: rider -> hub handover with shortage ----------
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 2 and sum(amount) = 1800 from public.cash_collections), 'the rider sees the COD they hold');
select tests.throws(format('select public.ops_submit_rider_handover(%L, 1500)', tests.id('hub_a1')),
                    'handing over a different amount than on record needs a note', '22023');
insert into tests.ids select 'ho_r1', public.ops_submit_rider_handover(tests.id('hub_a1'), 1800);
select tests.throws(format('select public.ops_submit_rider_handover(%L, 1800)', tests.id('hub_a1')),
                    'a rider cannot have two open handovers', 'P0001');
select tests.throws(format('select public.ops_confirm_handover(%L, 1800)', tests.id('ho_r1')),
                    'a rider cannot confirm own handover', '42501');
select tests.login(tests.id('rider2'));
select tests.ok(tests.row_count('select 1 from public.cash_handovers') = 0 and tests.row_count('select 1 from public.cash_collections') = 0,
                'another rider sees neither the handover nor the cash');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.ops_confirm_handover(%L, 1700)', tests.id('ho_r1')),
                    'receiving less than declared needs a note', '22023');
select public.ops_confirm_handover(tests.id('ho_r1'), 1700, 'Counted twice with the rider: 100 short');
select tests.ok((select status = 'confirmed' and received_amount = 1700 and shortage_amount = 100 and expected_amount = 1800
                        and received_by = tests.id('hub_mgr')
                 from public.cash_handovers where id = tests.id('ho_r1')),
                'the receiver confirms the amount received and the shortage is recorded');
select tests.throws(format('select public.ops_confirm_handover(%L, 1800)', tests.id('ho_r1')), 'a handover cannot be confirmed twice', 'P0001');
select tests.ok((select count(*) = 3 and max(balance) filter (where kind = 'handover') = 100
                 from public.ops_rider_ledger(tests.id('emp_r1'), current_date, current_date)),
                'rider ledger: the shortage stays as the rider''s outstanding balance');
select tests.ok((select rider_handovers_in = 1700 and expected_closing = 1700 from public.ops_cash_position(tests.id('hub_a1'), current_date)),
                'hub cash position counts what was actually received');

-- ---------- 7. Expenses ----------
insert into tests.ids select 'ex1', public.ops_record_expense(tests.id('hub_a1'), current_date, 'office', 200, 'Printer paper and tape');
select tests.throws(format($$select public.ops_decide_expense(%L, 'approved')$$, tests.id('ex1')), 'hub manager cannot approve expenses', '42501');
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.ops_record_expense(%L, current_date, 'fuel', 100, 'Fuel', 'hub_cash')$$, tests.id('hub_a1')),
                    'a rider cannot book an expense against hub cash', '42501');
insert into tests.ids select 'ex2', public.ops_record_expense(tests.id('hub_a1'), current_date, 'fuel', 60, 'Fuel for the delivery run', 'rider_cash');
select tests.login(tests.id('admin'));
insert into tests.ids select 'ex3', public.ops_record_expense(tests.id('hub_a1'), current_date, 'other', 10, 'Maker-checker test');
select tests.throws(format($$select public.ops_decide_expense(%L, 'approved')$$, tests.id('ex3')),
                    'the person who recorded an expense cannot approve it', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok((select expenses = 0 from public.ops_daily_report('hub', current_date, current_date, tests.id('zone_a')) where group_key = 'A1'),
                'pending expenses are not in the report');
select public.ops_decide_expense(tests.id('ex1'), 'approved');
select public.ops_decide_expense(tests.id('ex2'), 'approved');
select tests.ok((select expenses = 260 from public.ops_daily_report('hub', current_date, current_date, tests.id('zone_a')) where group_key = 'A1')
                and (select expenses = 260 from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date),
                'approved expenses enter the report and the hub figures');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select expenses_paid = 200 and expected_closing = 1500 from public.ops_cash_position(tests.id('hub_a1'), current_date)),
                'only hub-cash expenses reduce the hub cash');
select tests.ok((select delivered = 2 and cod_expected = 2000 and cod_collected = 1800 and cod_difference = 200
                        and handed_over = 1700 and shortage_recorded = 100 and balance_outstanding = 40
                 from public.ops_cod_reconciliation(current_date, current_date, null, tests.id('hub_a1')) where rider_id = tests.id('emp_r1')),
                'COD reconciliation per rider: expected, collected, handed over, outstanding');

-- ---------- 8. Merchant payments ----------
insert into tests.ids select 'mp1', public.ops_request_merchant_payment(tests.id('m1'), tests.id('hub_a1'), 500, 'cash');
select tests.throws(format($$select public.ops_request_merchant_payment(%L, %L, 300, 'bank')$$, tests.id('m1'), tests.id('hub_a1')),
                    'a bank payment needs a reference', '22023');
insert into tests.ids select 'mp2', public.ops_request_merchant_payment(tests.id('m1'), tests.id('hub_a1'), 5000, 'bank', 'TXN-778');
select tests.throws(format($$select public.ops_decide_merchant_payment(%L, 'approved')$$, tests.id('mp1')),
                    'hub manager cannot approve merchant payments', '42501');
select tests.login(tests.id('acct_mgr'));
select public.ops_decide_merchant_payment(tests.id('mp1'), 'approved');
select tests.throws(format($$select public.ops_decide_merchant_payment(%L, 'approved')$$, tests.id('mp2')),
                    'a merchant cannot be paid more than the COD collected for them', 'P0001');
select public.ops_decide_merchant_payment(tests.id('mp2'), 'rejected', 'More than the COD collected');
select tests.ok((select string_agg(status, ',' order by payment_no) = 'approved,rejected' from public.merchant_payments),
                'Accounts approves or rejects merchant payments');
select tests.login(tests.id('admin'));
insert into tests.ids select 'mp3', public.ops_request_merchant_payment(tests.id('m1'), tests.id('hub_a1'), 100, 'cash');
select tests.throws(format($$select public.ops_decide_merchant_payment(%L, 'approved')$$, tests.id('mp3')),
                    'the requester cannot approve a merchant payment', '42501');

-- ---------- 9. Hub -> Main Accounts handover, daily reconciliation ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select merchant_cash_paid = 500 and expected_closing = 1000 from public.ops_cash_position(tests.id('hub_a1'), current_date)),
                'an approved cash payment to a merchant reduces the hub cash');
select tests.throws(format('select public.ops_submit_hub_handover(%L, 5000)', tests.id('hub_a1')),
                    'a hub cannot hand over more cash than it has on record', 'P0001');
insert into tests.ids select 'ho_hub', public.ops_submit_hub_handover(tests.id('hub_a1'), 600, 'Daily deposit');
select tests.throws(format('select public.ops_confirm_handover(%L, 600)', tests.id('ho_hub')),
                    'a hub manager cannot confirm a handover to Main Accounts', '42501');
select tests.login(tests.id('acct_mgr'));
select public.ops_confirm_handover(tests.id('ho_hub'), 600);
select tests.ok((select status = 'confirmed' and shortage_amount = 0 and received_by = tests.id('acct_mgr')
                 from public.cash_handovers where id = tests.id('ho_hub')),
                'Main Accounts confirms the hub handover');
select tests.login(tests.id('admin'));
insert into tests.ids select 'ho_adm', public.ops_submit_hub_handover(tests.id('hub_a1'), 100);
select tests.throws(format('select public.ops_confirm_handover(%L, 100)', tests.id('ho_adm')),
                    'the person who hands over cash cannot confirm receiving it', '42501');
select public.ops_cancel_handover(tests.id('ho_adm'), 'Entered twice');

select tests.login(tests.id('hub_mgr'));
select tests.ok((select sent_to_accounts = 600 and expected_closing = 400 from public.ops_cash_position(tests.id('hub_a1'), current_date)),
                'cash sent to Main Accounts leaves the hub; a cancelled handover does not');
select tests.throws(format('select public.ops_submit_reconciliation(%L, current_date, 350)', tests.id('hub_a1')),
                    'a cash difference cannot be submitted without a note', '22023');
insert into tests.ids select 'rc1', public.ops_submit_reconciliation(tests.id('hub_a1'), current_date, 350, 'Fifty taka missing from the drawer');
select tests.ok((select expected_closing = 400 and counted_cash = 350 and difference = -50 and status = 'submitted'
                 from public.cash_reconciliations where id = tests.id('rc1')),
                'the daily reconciliation detects the difference');
select tests.throws(format($$select public.ops_decide_reconciliation(%L, 'approved')$$, tests.id('rc1')),
                    'hub manager cannot approve the reconciliation', '42501');
select tests.throws(format('select public.ops_submit_reconciliation(%L, current_date, 400)', tests.id('hub_a1')),
                    'a day is reconciled once', 'P0001');
select tests.login(tests.id('zonal_a'));
select public.ops_decide_reconciliation(tests.id('rc1'), 'approved');
select tests.ok((select opening_balance = 350 and expected_closing = 350 from public.ops_cash_position(tests.id('hub_a1'), current_date + 1)),
                'the next day opens with the cash actually counted');

select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count('select 1 from public.parcels') = 0 and tests.row_count('select 1 from public.delivery_records') = 0
                and tests.row_count('select 1 from public.cash_collections') = 0 and tests.row_count('select 1 from public.cash_handovers') = 0
                and tests.row_count('select 1 from public.operational_expenses') = 0 and tests.row_count('select 1 from public.merchant_payments') = 0
                and tests.row_count('select 1 from public.cash_reconciliations') = 0,
                'another hub sees no parcels, deliveries, cash, expenses, payments or reconciliations of hub A1');
select tests.ok(tests.row_count(format('select 1 from public.ops_cash_position(%L, current_date)', tests.id('hub_a1'))) = 0
                and tests.row_count(format('select 1 from public.ops_rider_ledger(%L, current_date, current_date)', tests.id('emp_r1'))) = 0
                and tests.row_count('select 1 from public.ops_daily_report(''hub'', current_date, current_date)') = 0,
                'and gets nothing from its cash position, rider ledger or reports');
select tests.throws(format('select public.ops_hub_summary(%L, current_date)', tests.id('hub_a1')),
                    'and cannot open its daily summary', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (s -> 'approved' ->> 'delivered')::int = 3 and (s -> 'pickups' ->> 'groups')::int = 3
                        and (s -> 'parcels' ->> 'at_hub')::int = 1 and (s -> 'cash' ->> 'expected_closing')::numeric = 400
                 from public.ops_hub_summary(tests.id('hub_a1'), current_date) s),
                'hub daily summary');

-- ---------- 10. Parcel issues ----------
select tests.login(tests.id('hub_b_mgr'));
select tests.throws($$select public.ops_open_issue('XZ-1002', 'delay', 'Customer keeps calling')$$,
                    'an issue cannot be opened for a parcel outside the caller''s scope', '42501');
select tests.ok(public.ops_parcel_lookup('XZ-1002') is null, 'and the parcel cannot be found by its ID');
select tests.login(tests.id('rider_login'));
insert into tests.ids select 'iss1', public.ops_open_issue('xz-1002', 'wrong_address', 'House number does not exist', 'high');
select tests.ok((select status = 'open' and parcel_id = tests.id('p_1002') and reported_by = tests.id('rider_login')
                 from public.parcel_issues where id = tests.id('iss1')),
                'an issue is created from the parcel ID (case-insensitive)');
select tests.throws(format($$select public.ops_assign_issue(%L, %L)$$, tests.id('iss1'), tests.id('pm')), 'a rider cannot assign issues', '42501');
select tests.login(tests.id('hub_mgr'));
select public.ops_assign_issue(tests.id('iss1'), tests.id('pm'), 'Call the merchant');
select tests.login(tests.id('rider2'));
select tests.throws(format($$select public.ops_resolve_issue(%L, 'Done')$$, tests.id('iss1')), 'only the assignee or a manager resolves an issue', '42501');
select tests.login(tests.id('pm'));
select tests.throws(format($$select public.ops_resolve_issue(%L, ' ')$$, tests.id('iss1')), 'resolving needs a resolution text', '22023');
select public.ops_comment_issue(tests.id('iss1'), 'Merchant gave a new address');
select public.ops_resolve_issue(tests.id('iss1'), 'Address corrected with the merchant; re-dispatch tomorrow');
select tests.ok((select status = 'resolved' and resolved_by = tests.id('pm') from public.parcel_issues where id = tests.id('iss1')),
                'the assignee resolves the issue');
select tests.login(tests.id('hub_mgr'));
select public.ops_reopen_issue(tests.id('iss1'), 'Customer still unreachable');
select tests.ok((select status = 'assigned' from public.parcel_issues where id = tests.id('iss1'))
                and (select string_agg(event, ',' order by case event when 'created' then 1 when 'assigned' then 2 when 'comment' then 3
                                                                      when 'resolved' then 4 else 5 end) = 'created,assigned,comment,resolved,reopened'
                     from public.parcel_issue_events where issue_id = tests.id('iss1')),
                'the issue keeps its full history');
select tests.ok((select jsonb_array_length(l -> 'issues') = 1 and jsonb_array_length(l -> 'issues' -> 0 -> 'history') = 5
                        and jsonb_array_length(l -> 'deliveries') = 1 and l -> 'parcel' ->> 'merchant_name' = 'Merchant One'
                 from public.ops_parcel_lookup('xz-1002') l),
                'search by parcel ID returns the parcel, its delivery attempts and issue history');

-- ---------- 11. Zonal dashboards now run on courier records ----------
select tests.login(tests.id('zonal_a'));
select tests.ok((select pickups = 15 and deliveries = 3 and cash_collected = 1800 and expenses = 260 and pending_parcels = 1
                 from public.zm_hub_performance(tests.id('zone_a'), current_date, current_date) where hub_code = 'A1'),
                'the zonal hub comparison uses the approved courier records');
select tests.throws(format($$select public.zm_reopen_hub_metric(%L, 'Edit by hand')$$,
                           (select id from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date)),
                    'figures generated from courier records cannot be reopened for manual editing', 'P0001');

-- ---------- 11b. Counter cash, rejected / returned delivery, cancel parcel, end assignment ----------
select tests.login(tests.id('hub_mgr'));
select public.ops_record_cash_collection(tests.id('hub_a1'), current_date, 250, 'merchant_deposit', 'Booking charge paid at the counter', tests.id('m2'));
select tests.ok((select hub_collections_in = 250 from public.ops_cash_position(tests.id('hub_a1'), current_date)),
                'cash taken at the hub counter enters the hub cash position');
select tests.throws(format($$select public.ops_record_cash_collection(%L, current_date, 250, 'cod_delivery', 'Typed in by hand')$$, tests.id('hub_a1')),
                    'COD cash cannot be keyed in by hand', '22023');
select public.ops_dispatch_parcels(tests.id('emp_r2'), array[tests.id('p_1002')]);
insert into tests.ids select 'd_1002b', public.ops_record_delivery(tests.id('p_1002'), 'returned', 0, 'Customer refused');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.ops_decide_delivery(%L, 'rejected')$$, tests.id('d_1002b')), 'rejecting a delivery record needs a note', '22023');
select public.ops_decide_delivery(tests.id('d_1002b'), 'rejected', 'Try once more before returning');
select tests.ok((select status = 'out_for_delivery' and assigned_rider_id = tests.id('emp_r2') and attempt_count = 1
                 from public.parcels where id = tests.id('p_1002')),
                'a rejected delivery record leaves the parcel with the rider');
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'd_1002c', public.ops_record_delivery(tests.id('p_1002'), 'returned', 0, 'Customer refused again');
select tests.login(tests.id('zonal_a'));
select public.ops_decide_delivery(tests.id('d_1002c'), 'approved');
select tests.ok((select status = 'returned' and attempt_count = 2 and closed_at is not null from public.parcels where id = tests.id('p_1002'))
                and (select r.returned = 1 from public.ops_daily_report('hub', current_date, current_date, tests.id('zone_a')) r
                     where r.group_key = 'A1')
                and (select pending_parcels = 0 from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date),
                'an approved return closes the parcel and clears it from the pending count');
select tests.login(tests.id('hub_mgr'));
insert into public.parcels (tracking_no, merchant_id, hub_id, customer_name) values ('XZ-1005', tests.id('m2'), tests.id('hub_a1'), 'Customer Five');
insert into tests.ids select 'p_1005', id from public.parcels where tracking_no = 'XZ-1005';
select tests.throws(format($$select public.ops_cancel_parcel(%L, ' ')$$, tests.id('p_1005')), 'cancelling a parcel needs a reason', '22023');
select public.ops_cancel_parcel(tests.id('p_1005'), 'Merchant withdrew the parcel');
select tests.ok((select status = 'cancelled' and cancel_reason is not null from public.parcels where id = tests.id('p_1005')), 'a parcel at the hub can be cancelled with a reason');
select public.ops_end_assignment((select id from public.ops_assignments where employee_id = tests.id('emp_r2') and effective_to is null),
                                 current_date, 'Left the hub');
select tests.ok((select count(*) = 0 from public.ops_assignments where employee_id = tests.id('emp_r2') and effective_to is null),
                'an assignment can be ended and stays in history');

-- ---------- 12. No direct writes, nothing deleted, nothing for outsiders ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$insert into public.pickup_submissions (pickup_date, hub_id, zone_id, merchant_id, source, submitted_by, parcel_count, status)
                             values (current_date, %L, %L, %L, 'hub_manager', %L, 99, 'approved')$$,
                           tests.id('hub_a1'), tests.id('zone_a'), tests.id('m3'), tests.id('hub_mgr')),
                    'pickup submissions cannot be inserted directly', '42501');
select tests.throws($$update public.cash_handovers set received_amount = declared_amount$$, 'handovers cannot be changed directly', '42501');
select tests.throws($$update public.delivery_records set status = 'approved'$$, 'delivery records cannot be changed directly', '42501');
select tests.throws($$update public.pickup_consolidations set parcel_count = 99$$, 'approved pickups cannot be changed directly', '42501');
select tests.throws($$delete from public.merchants$$, 'merchants cannot be deleted through the API', '42501');

select tests.login(tests.id('noroles'));
select tests.ok(tests.row_count('select 1 from public.merchants') = 0 and tests.row_count('select 1 from public.parcels') = 0
                and tests.row_count('select 1 from public.pickup_submissions') = 0 and tests.row_count('select 1 from public.cash_handovers') = 0,
                'a user without roles sees nothing');
select tests.login(tests.id('inactive'));
select tests.throws(format($$select public.ops_submit_pickup('hub_manager', current_date, %L, %L, 3, 0, 0)$$, tests.id('hub_a1'), tests.id('m3')),
                    'an inactive account cannot submit pickups', '42501');

select tests.login_anon();
select tests.throws('select * from public.merchants', 'anonymous users cannot read merchants', '42501');
select tests.throws('select * from public.parcels', 'anonymous users cannot read parcels', '42501');
select tests.throws('select * from public.pickup_submissions', 'anonymous users cannot read pickup submissions', '42501');
select tests.throws('select * from public.cash_handovers', 'anonymous users cannot read handovers', '42501');
select tests.throws($$select * from public.ops_daily_report('date', current_date, current_date)$$, 'anonymous users cannot run reports', '42501');
select tests.throws($$select public.ops_parcel_lookup('XZ-1001')$$, 'anonymous users cannot search parcels', '42501');

select tests.logout();
select tests.throws('delete from public.pickup_submissions', 'pickup submissions are never deleted, even by the owner', 'P0001');
select tests.throws('delete from public.cash_handovers', 'handovers are never deleted, even by the owner', 'P0001');
select tests.throws($$update public.parcel_issue_events set note = 'changed'$$, 'issue history is append-only', 'P0001');
select tests.ok((select count(*) > 0 from public.audit_logs where module = 'ops' and table_name = 'cash_handovers' and action = 'UPDATE'),
                'workflow changes are written to the audit log');
rollback;
