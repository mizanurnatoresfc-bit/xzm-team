begin;
select tests.fixture();
select tests.hr_fixture();
select tests.active_employee('Deadline Rider', 'OPS-0001', tests.id('hub_a1'), '01711000912', '1234567890',
                             15000, tests.id('rider_login'));

select tests.login_anon();
select tests.throws('select public.wf_ops_deadlines_get()', 'anonymous cannot read report deadlines', '42501');

select tests.login(tests.id('zonal_a'));
select tests.ok(public.wf_ops_deadlines_get(tests.id('zone_a')) -> 'pickup' = 'null'::jsonb,
                'new zone starts with no pickup deadline');
select public.wf_ops_deadlines_save(tests.id('zone_a'),
  '{"pickup":"18:15","pickup_return":null,"delivery":"21:30","delivery_return":"20:00"}');
select tests.ok(public.wf_ops_deadlines_get(tests.id('zone_a')) ->> 'pickup' = '18:15',
                'zonal manager can set the pickup deadline');
select tests.throws(format('select public.wf_ops_deadlines_save(%L, %L)', tests.id('zone_a'),
  '{"pickup":"24:00","pickup_return":null,"delivery":"21:30","delivery_return":"20:00"}'),
  'deadline must use a valid time-of-day', '22023');
select tests.throws(format('select public.wf_ops_deadlines_save(%L, %L)', tests.id('zone_b'),
  '{"pickup":"18:15","pickup_return":null,"delivery":"21:30","delivery_return":"20:00"}'),
  'zonal manager cannot change another zone', '42501');

select tests.login(tests.id('hub_mgr'));
select tests.ok(public.wf_ops_deadlines_get(tests.id('zone_a')) ->> 'delivery' = '21:30',
                'hub manager reads the deadline for the assigned hub zone');
select tests.throws(format('select public.wf_ops_deadlines_save(%L, %L)', tests.id('zone_a'),
  '{"pickup":"18:15","pickup_return":null,"delivery":"21:30","delivery_return":"20:00"}'),
  'hub manager cannot set deadlines', '42501');

select tests.login(tests.id('rider_login'));
select tests.ok(public.wf_ops_deadlines_get() ->> 'pickup' = '18:15', 'staff can see the deadline for their own hub');
select tests.throws(format('select public.wf_ops_deadlines_get(%L)', tests.id('zone_b')),
                   'staff cannot read a different zone', '42501');

select tests.login(tests.id('super'));
select public.wf_ops_deadlines_save(tests.id('zone_a'),
  '{"pickup":null,"pickup_return":null,"delivery":"21:30","delivery_return":"20:00"}');
select tests.ok(public.wf_ops_deadlines_get(tests.id('zone_a')) -> 'pickup' = 'null'::jsonb,
                'an existing deadline can be cleared');
rollback;
