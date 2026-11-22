-- Zonal managers switch staff between active and inactive in their own zone; nothing more.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
insert into t values
  ('emp',   tests.active_employee('Switch Me', 'XZ-00081', tests.id('hub_a1'), '01711000081', '1234567881')),
  ('other', tests.active_employee('Other Zone', 'XZ-00082', tests.id('hub_b1'), '01711000082', '1234567882'));

select tests.ok((select count(*) = 4 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                  join public.roles r on r.id = rp.role_id
                 where p.code = 'hr.status.edit' and r.code in ('admin', 'head_office_manager', 'hr_manager', 'zonal_manager')),
  'four roles hold hr.status.edit');

select tests.login(tests.id('zonal_a'));
select public.hr_change_status((select v from t where k = 'emp'), 'inactive', current_date, 'Long leave');
select tests.ok((select status = 'inactive' from public.employees where id = (select v from t where k = 'emp')),
  'zonal manager makes a person inactive');
select public.hr_change_status((select v from t where k = 'emp'), 'active', current_date, 'Back at work');
select tests.ok((select status = 'active' from public.employees where id = (select v from t where k = 'emp')),
  'zonal manager makes the person active again');
select tests.logout();
select tests.ok((select count(*) = 2 from public.employee_status_history where employee_id = (select v from t where k = 'emp')),
  'both changes are kept in the status history');

select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.hr_change_status(%L, 'resigned', current_date, 'x')$$, (select v from t where k = 'emp')),
  'a zonal manager cannot record a resignation', '42501');
select tests.throws(format($$select public.hr_change_status(%L, 'terminated', current_date, 'x')$$, (select v from t where k = 'emp')),
  'a zonal manager cannot dismiss', '42501');
select tests.throws(format($$select public.hr_change_status(%L, 'inactive', current_date, 'x')$$, (select v from t where k = 'other')),
  'a person in another zone is refused', '42501');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.hr_change_status(%L, 'inactive', current_date, 'x')$$, (select v from t where k = 'emp')),
  'a hub manager cannot switch status', '42501');
select tests.logout();

select tests.login(tests.id('hr'));
select public.hr_change_status((select v from t where k = 'emp'), 'resigned', current_date, 'Left');
select tests.logout();
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.hr_change_status(%L, 'active', current_date, 'x')$$, (select v from t where k = 'emp')),
  'a zonal manager cannot take a leaver back', '42501');
select tests.logout();

-- a plain transfer to the same hub is refused; a real move still works
select tests.login(tests.id('hr'));
select tests.throws(format($$select public.hr_transfer_employee(%L, %L, %L, %L, null, current_date, 'x')$$,
  (select v from t where k = 'other'), tests.id('hub_b1'), tests.id('dept_ops'), tests.id('pos_rider')),
  'a transfer to the same hub is refused', '22023');
select public.hr_transfer_employee((select v from t where k = 'other'), tests.id('hub_a1'), tests.id('dept_ops'), tests.id('pos_rider'),
  null, current_date, 'Hub A1 needs staff');
select tests.logout();
select tests.ok((select hub_id = tests.id('hub_a1') from public.employees where id = (select v from t where k = 'other')),
  'a move to another hub still works');
rollback;
