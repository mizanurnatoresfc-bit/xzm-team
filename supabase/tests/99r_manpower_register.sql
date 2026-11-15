-- "লোক লাগবে": staff ask for people, zonal approves, the hub is told; change register and hub x post matrix.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
insert into t values
  ('u_staff', tests.make_user('staff.mp@test.local', 'Staff MP')),
  ('u_peer',  tests.make_user('peer.mp@test.local', 'Peer MP')),
  ('u_other', tests.make_user('other.mp@test.local', 'Other MP'));
insert into t values
  ('staff', tests.active_employee('Staff MP', 'XZ-00093', tests.id('hub_a1'), '01711000093', '1234567893', 15000, (select v from t where k = 'u_staff'))),
  ('peer',  tests.active_employee('Peer MP',  'XZ-00094', tests.id('hub_a1'), '01711000094', '1234567894', 15000, (select v from t where k = 'u_peer'))),
  ('other', tests.active_employee('Other MP', 'XZ-00095', tests.id('hub_a2'), '01711000095', '1234567895', 15000, (select v from t where k = 'u_other')));

-- a staff member asks for 2 riders for their own hub
select tests.login((select v from t where k = 'u_staff'));
insert into t select 'mp', public.mp_submit(tests.id('hub_a1'), tests.id('pos_rider'), 2, 'Deliveries are piling up', 400, 520, 30, 'Two riders left');
select tests.throws(format($$select public.mp_submit(%L, null, 1, 'need help')$$, tests.id('hub_a2')), 'cannot ask for another hub', '42501');
select tests.ok((select count(*) = 1 from public.manpower_requests), 'submitter sees own request');
select tests.logout();

select tests.ok((select count(*) >= 1 from public.notifications n where n.kind = 'manpower' and n.profile_id = tests.id('zonal_a')),
  'zonal manager is told about the new request');

-- peer cannot see it before approval
select tests.login((select v from t where k = 'u_peer'));
select tests.ok((select count(*) = 0 from public.manpower_requests), 'colleague does not see an unapproved request');
select tests.logout();

-- zonal manager approves for the hub only
select tests.login(tests.id('zonal_a'));
select tests.ok(public.mp_decide((select v from t where k = 'mp'), 'approved', 'OK', 'hub', '{}', 3) = 1, 'approval notifies the active staff of the hub (not the submitter)');
select tests.throws(format($$select public.mp_decide(%L, 'approved')$$, (select v from t where k = 'mp')), 'cannot decide twice', 'P0001');
select tests.ok((select needed = 3 and status = 'approved' from public.manpower_requests where id = (select v from t where k = 'mp')), 'approver can change how many are needed');
select tests.ok((select needed = 3 from public.hr_hub_post_matrix(tests.id('zone_a')) where hub_id = tests.id('hub_a1') and position_id = tests.id('pos_rider')),
  'the open need shows in the hub x post matrix');
select tests.ok((select active >= 2 from public.hr_hub_post_matrix(tests.id('zone_a')) where hub_id = tests.id('hub_a1') and position_id = tests.id('pos_rider')),
  'matrix counts active staff per post');
select tests.logout();

select tests.ok((select count(*) = 1 from public.notifications where profile_id = (select v from t where k = 'u_peer') and kind = 'manpower'), 'colleague in the hub is told');
select tests.ok((select count(*) = 0 from public.notifications where profile_id = (select v from t where k = 'u_other') and kind = 'manpower'), 'staff of other hubs are not told (hub scope)');

select tests.login((select v from t where k = 'u_peer'));
select tests.ok((select count(*) = 1 from public.manpower_requests), 'colleague sees the approved request');
select tests.throws(format($$select public.mp_close(%L, 'filled', 3)$$, (select v from t where k = 'mp')), 'staff cannot close it', '42501');
select tests.logout();

select tests.login(tests.id('zonal_a'));
select public.mp_close((select v from t where k = 'mp'), 'filled', 3, 'Found 3');
select tests.ok((select status = 'filled' from public.manpower_requests where id = (select v from t where k = 'mp')), 'zonal closes it as filled');

-- change register: a transfer done in the system appears
select public.hr_transfer_employee((select v from t where k = 'other'), tests.id('hub_a1'),
  (select department_id from public.employees where id = (select v from t where k = 'other')),
  (select position_id from public.employees where id = (select v from t where k = 'other')), null, current_date, 'Rebalance');
select tests.ok((select count(*) = 1 from public.hr_change_register(tests.id('zone_a'), current_date - 1, current_date)
                  where kind = 'transfer' and employee_id = (select v from t where k = 'other') and to_hub = 'Hub A1' and from_hub = 'Hub A2'),
  'the register shows the transfer with old and new hub');
select tests.logout();

select tests.login(tests.id('hub_b_mgr'));
select tests.ok((select count(*) = 0 from public.hr_change_register(tests.id('zone_a'), current_date - 1, current_date)), 'another zone''s manager sees nothing');
select tests.logout();
rollback;
