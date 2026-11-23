-- Pickups: merchants, pickup submissions from three sources (pickup manager, rider, hub manager),
-- verify -> approve / reject, one consolidated record per pickup, hub figures refreshed.
-- The old parcel / cash engine (ops_assign, deliveries, handovers, reports) was removed on 23 Nov 2026
-- (migration 20261123000100_cleanup_unused); its tests went with it.
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


-- ---------- 1. Rider assignments (set up directly: the assignment page was part of the removed engine), merchants ----------
select tests.logout();
insert into public.ops_assignments (kind, employee_id, zone_id, hub_id, duty, effective_from, reason) values
  ('hub_manager', tests.id('emp_hm'), tests.id('zone_a'), tests.id('hub_a1'), null, current_date - 30, 'Appointed'),
  ('rider', tests.id('emp_r1'), tests.id('zone_a'), tests.id('hub_a1'), 'both', current_date - 30, 'Joined as rider'),
  ('rider', tests.id('emp_r2'), tests.id('zone_a'), tests.id('hub_a1'), 'both', current_date - 30, 'Joined as rider');
select tests.login(tests.id('hub_mgr'));
insert into public.merchants (code, name, hub_id) values
  ('M1', 'Merchant One', tests.id('hub_a1')), ('M2', 'Merchant Two', tests.id('hub_a1')), ('M3', 'Merchant Three', tests.id('hub_a1'));
insert into tests.ids select 'm' || right(code::text, 1), id from public.merchants;
select tests.ok(tests.id('m3') is not null, 'hub manager creates merchants for own hub');
select tests.throws(format($$insert into public.merchants (code, name, hub_id) values ('MB', 'Merchant B', %L)$$, tests.id('hub_b1')),
                    'hub manager cannot create a merchant in another hub', '42501');
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

-- ---------- 3. Another hub sees nothing ----------
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count('select 1 from public.pickup_submissions') = 0, 'another hub sees no pickup submissions of hub A1');

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
select tests.ok(not exists (select 1 from public.hub_daily_metrics where hub_id = tests.id('hub_a1') and metric_date = current_date),
                'pending and verified submissions do not reach the hub figures');

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

-- ---------- 5. No direct writes, nothing deleted, nothing for outsiders ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$insert into public.pickup_submissions (pickup_date, hub_id, zone_id, merchant_id, source, submitted_by, parcel_count, status)
                             values (current_date, %L, %L, %L, 'hub_manager', %L, 99, 'approved')$$,
                           tests.id('hub_a1'), tests.id('zone_a'), tests.id('m3'), tests.id('hub_mgr')),
                    'pickup submissions cannot be inserted directly', '42501');
select tests.throws($$update public.pickup_consolidations set parcel_count = 99$$, 'approved pickups cannot be changed directly', '42501');
select tests.throws($$delete from public.merchants$$, 'merchants cannot be deleted through the API', '42501');

select tests.login(tests.id('noroles'));
select tests.ok(tests.row_count('select 1 from public.merchants') = 0 and tests.row_count('select 1 from public.pickup_submissions') = 0,
                'a user without roles sees nothing');
select tests.login(tests.id('inactive'));
select tests.throws(format($$select public.ops_submit_pickup('hub_manager', current_date, %L, %L, 3, 0, 0)$$, tests.id('hub_a1'), tests.id('m3')),
                    'an inactive account cannot submit pickups', '42501');

select tests.login_anon();
select tests.throws('select * from public.merchants', 'anonymous users cannot read merchants', '42501');
select tests.throws('select * from public.pickup_submissions', 'anonymous users cannot read pickup submissions', '42501');

select tests.logout();
select tests.throws('delete from public.pickup_submissions', 'pickup submissions are never deleted, even by the owner', 'P0001');
rollback;
