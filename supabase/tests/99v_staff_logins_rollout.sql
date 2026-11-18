-- Launch pieces: the plain staff role, a role per post, a person's own mobile number as a login, roll-out progress by hub.
begin;
select tests.fixture();
select tests.hr_fixture();

insert into tests.ids values
  ('mgr', tests.active_employee('Launch Manager', '820', tests.id('hub_a1'), '01711000820', '8200000000', 15000, tests.id('hub_mgr'))),
  ('r1',  tests.active_employee('Launch Rider', '821', tests.id('hub_a1'), '01711000821', '8210000000', 15000, tests.id('rider_login'))),
  ('r2',  tests.active_employee('Launch Loader', '822', tests.id('hub_a1'), '01711000822', '8220000000')),
  ('b1',  tests.active_employee('Other Hub Person', '823', tests.id('hub_b1'), '01711000823', '8230000000'));

-- ---------- the plain staff role ----------
select tests.ok((select is_system and not is_super from public.roles where code = 'staff'), 'the staff role exists and is not a super role');
select tests.ok((select count(*) = 2 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'staff'), 'it carries only the two read permissions');
select tests.ok((select count(*) = 1 from public.role_dashboards d join public.roles r on r.id = d.role_id where r.code = 'staff'), 'it has a home dashboard');

-- ---------- a role per post ----------
-- a new post starts with the plain staff role (migration 20261119000200)
select tests.ok((select default_role_id = (select id from public.roles where code = 'staff') from public.positions where id = tests.id('pos_rider')), 'a new post starts with the staff role');
select tests.login(tests.id('hub_mgr'));
update public.positions set default_role_id = (select id from public.roles where code = 'rider') where id = tests.id('pos_rider');
select tests.logout();
select tests.ok((select default_role_id = (select id from public.roles where code = 'staff') from public.positions where id = tests.id('pos_rider')), 'a hub manager cannot change the role of a post');
select tests.login(tests.id('super'));
update public.positions set default_role_id = (select id from public.roles where code = 'rider') where id = tests.id('pos_rider');
select tests.logout();
select tests.ok((select default_role_id = (select id from public.roles where code = 'rider') from public.positions where id = tests.id('pos_rider')), 'the Super Admin sets the role of a post');

-- ---------- my own mobile number ----------
select tests.login(tests.id('rider_login'));
select tests.throws($$select public.my_mobile_set('12345')$$, 'a wrong number is refused', '22023');
select tests.throws($$select public.my_mobile_set('01711000822')$$, 'a number another person has is refused', '23505');
select tests.ok(public.my_mobile_set('+৮৮ ০১৯১১-২২৩৩৪৪') = '01911223344', 'Bangla digits, +88 and dashes are tidied');
select tests.logout();
select tests.ok((select mobile = '01911223344' from public.employees where id = tests.id('r1')) and (select phone = '01911223344' from public.profiles where id = tests.id('rider_login')),
  'the number is saved on the employee and on the login');
select tests.ok(public.login_resolve('01911223344') = 'rider@test.local' and public.login_resolve('821') = 'rider@test.local',
  'the new number signs in, and so does the Employee ID');
select tests.ok(public.login_resolve('01711000821') is null, 'the old number no longer signs in');
-- a login with no employee record keeps the number on the login only
select tests.login(tests.id('auditor'));
select tests.ok(public.my_mobile_set('01811000999') = '01811000999', 'a login without an employee record can set a number too');
select tests.logout();

-- ---------- roll-out progress ----------
update public.profiles set last_login_at = now(), must_change_password = false where id = tests.id('hub_mgr');
update public.profiles set last_login_at = now(), must_change_password = true where id = tests.id('rider_login');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 1 from public.rollout_progress()), 'a hub manager sees only their own hub');
select tests.ok((select staff = 3 and with_login = 2 and signed_in = 2 and password_set = 1 and with_mobile = 3 from public.rollout_progress() where hub_id = tests.id('hub_a1')),
  'the hub''s counts: staff, logins, signed in, own password set, mobile given');
select tests.ok((select count(*) = 3 from public.rollout_people(tests.id('hub_a1'))), 'and the people behind the counts');
select tests.ok((select has_login and signed_in_at is not null and not password_set from public.rollout_people(tests.id('hub_a1')) where employee_id = tests.id('r1')),
  'someone still on the first password is shown as such');
select tests.ok((select not has_login and role_name is null from public.rollout_people(tests.id('hub_a1')) where employee_id = tests.id('r2')), 'someone without a login is shown as such');
select tests.throws(format($$select * from public.rollout_people(%L)$$, tests.id('hub_b1')), 'another hub''s people are refused', '42501');
select tests.login(tests.id('noroles'));
select tests.ok((select count(*) = 0 from public.rollout_progress()), 'a person with no role sees no hub');
select tests.login(tests.id('super'));
select tests.ok((select count(*) = 3 from public.rollout_progress()), 'the Super Admin sees every hub');

rollback;
