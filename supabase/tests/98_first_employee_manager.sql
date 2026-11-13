-- The first employee of a zone does not need a reporting manager; later ones do.
begin;
select tests.fixture();
select tests.hr_fixture();
select tests.login(tests.id('hr2'));
create temp table t_app as select public.hr_start_application('First Rider', '01711000098', tests.id('hub_b1'), tests.id('dept_ops'), tests.id('pos_rider')) as id;
select tests.ok(not ('reporting_manager' = any(public.hr_application_missing_fields((select id from t_app)))),
  'no active employee in the zone yet: reporting manager not required');
select tests.logout();
select tests.active_employee('Zone B Lead', '98', tests.id('hub_b1'), '01711000099', '9876543210');
select tests.login(tests.id('hr2'));
select tests.ok('reporting_manager' = any(public.hr_application_missing_fields((select id from t_app))),
  'once the zone has an active employee, a reporting manager is required');
select tests.logout();
rollback;
