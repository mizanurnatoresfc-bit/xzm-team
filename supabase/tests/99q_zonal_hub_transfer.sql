-- Zonal managers move staff between hubs of their own zone (same post only).
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
insert into t values ('emp', tests.active_employee('Move Me', 'XZ-00092', tests.id('hub_a1'), '01711000092', '1234567892'));

select tests.login(tests.id('zonal_a'));
select public.hr_transfer_employee((select v from t where k = 'emp'), tests.id('hub_a2'),
  (select department_id from public.employees where id = (select v from t where k = 'emp')),
  (select position_id from public.employees where id = (select v from t where k = 'emp')), null, current_date, 'Hub A2 needs staff');
select tests.ok((select hub_id = tests.id('hub_a2') from public.employees where id = (select v from t where k = 'emp')),
  'zonal manager moves a person from Hub A1 to Hub A2');
select tests.ok((select count(*) = 2 from public.employee_assignments where employee_id = (select v from t where k = 'emp')),
  'the move is kept in the assignment history');
select tests.throws(format($$select public.hr_transfer_employee(%L, %L, null, null, null, current_date, 'x')$$,
  (select v from t where k = 'emp'), tests.id('hub_b1')), 'a hub in another zone is refused', '42501');
select tests.throws(format($$select public.hr_transfer_employee(%L, %L, null, null, null, current_date, 'x', 'promotion')$$,
  (select v from t where k = 'emp'), tests.id('hub_a1')), 'changing post needs HR edit rights', '42501');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.hr_transfer_employee(%L, %L, null, null, null, current_date, 'x')$$,
  (select v from t where k = 'emp'), tests.id('hub_a1')), 'a hub manager cannot transfer', '42501');
select tests.logout();
rollback;
