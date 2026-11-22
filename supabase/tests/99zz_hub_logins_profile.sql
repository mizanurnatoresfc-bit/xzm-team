-- A hub makes the logins of its own riders / plain staff and fills in their profiles — and nothing more.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

update public.positions set default_role_id = (select id from public.roles where code = 'rider') where code = 'RIDER';
update public.positions set default_role_id = (select id from public.roles where code = 'hub_manager') where code = 'HUBACC';
insert into tests.ids values
  ('rd1', tests.active_employee('Hub Rider One', '7001', tests.id('hub_a1'), '01711007001', '7001700101')),
  ('rd2', tests.active_employee('Hub Rider Two', '7002', tests.id('hub_a1'), '01711007002', '7002700201')),
  ('rdb', tests.active_employee('Other Hub Rider', '7003', tests.id('hub_b1'), '01711007003', '7003700301')),
  ('acc', tests.active_employee('Hub Accountant', '7004', tests.id('hub_a1'), '01711007004', '7004700401'));
update public.employees set position_id = (select id from public.positions where code = 'RIDER') where id in (tests.id('rd1'), tests.id('rd2'), tests.id('rdb'));
update public.employees set position_id = (select id from public.positions where code = 'HUBACC') where id = tests.id('acc');
insert into t values ('rider', (select id::text from public.roles where code = 'rider')), ('mgr', (select id::text from public.roles where code = 'hub_manager'));

-- ---------- the precheck: only one's own hub, only the post's rider / staff role, only the Employee ID ----------
select tests.login(tests.id('hub_mgr'));
select public.user_admin_precheck('id-7001@xzmteam.com', (select v::uuid from t where k = 'rider'), 'hub', null, tests.id('hub_a1'), tests.id('rd1'));
select tests.ok(true, 'a hub manager may make the login of a rider of their hub');
select tests.throws(format($$select public.user_admin_precheck('someone@gmail.com', %L, 'hub', null, %L, %L)$$, (select v from t where k = 'rider'), tests.id('hub_a1'), tests.id('rd1')),
  'the login must be the Employee ID', '22023');
select tests.throws(format($$select public.user_admin_precheck('id-7003@xzmteam.com', %L, 'hub', null, %L, %L)$$, (select v from t where k = 'rider'), tests.id('hub_b1'), tests.id('rdb')),
  'not for a rider of another hub', '42501');
select tests.throws(format($$select public.user_admin_precheck('id-7003@xzmteam.com', %L, 'hub', null, %L, %L)$$, (select v from t where k = 'rider'), tests.id('hub_a1'), tests.id('rdb')),
  'not by naming one''s own hub for someone else''s rider', '42501');
select tests.throws(format($$select public.user_admin_precheck('id-7004@xzmteam.com', %L, 'hub', null, %L, %L)$$, (select v from t where k = 'mgr'), tests.id('hub_a1'), tests.id('acc')),
  'not a manager-level login', '42501');
select tests.throws(format($$select public.user_admin_precheck('id-7004@xzmteam.com', %L, 'hub', null, %L, %L)$$, (select v from t where k = 'rider'), tests.id('hub_a1'), tests.id('acc')),
  'not the rider role for someone whose post is not a rider', '42501');
select tests.throws(format($$select public.user_admin_precheck('id-7001@xzmteam.com', %L, 'global', null, null, %L)$$, (select v from t where k = 'rider'), tests.id('rd1')),
  'not a company-wide role', '42501');
select tests.throws(format($$select public.user_admin_precheck('free@xzmteam.com', %L, 'hub', null, %L, null)$$, (select v from t where k = 'rider'), tests.id('hub_a1')),
  'not a login that belongs to nobody', '42501');

-- ---------- the account is made (the Edge Function does this), then role, finish, link ----------
reset role;
insert into tests.ids values ('u1', tests.make_user('id-7001@xzmteam.com', 'Hub Rider One')), ('u2', tests.make_user('id-7002@xzmteam.com', 'Hub Rider Two')),
  ('ub', tests.make_user('id-7003@xzmteam.com', 'Other Hub Rider'));
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.user_admin_assign_role(%L, %L, 'hub', null, %L)$$, tests.id('u1'), (select v from t where k = 'mgr'), tests.id('hub_a1')),
  'the new login cannot get a manager role', '42501');
select tests.throws(format($$select public.user_admin_assign_role(%L, %L, 'hub', null, %L)$$, tests.id('u1'), (select v from t where k = 'rider'), tests.id('hub_b1')),
  'nor a role at another hub', '42501');
select tests.throws(format($$select public.user_admin_assign_role(%L, %L, 'global')$$, tests.id('u1'), (select v from t where k = 'rider')),
  'nor a company-wide role', '42501');
select tests.throws(format($$select public.user_admin_finish_create(%L, 'X')$$, tests.id('u1')), 'an account without its hub role cannot be finished by the hub', '42501');
select public.user_admin_assign_role(tests.id('u1'), (select v::uuid from t where k = 'rider'), 'hub', null, tests.id('hub_a1'));
select tests.throws(format($$select public.user_admin_assign_role(%L, %L, 'hub', null, %L)$$, tests.id('u1'), (select v from t where k = 'mgr'), tests.id('hub_a1')),
  'a second role cannot be added', '42501');
select public.user_admin_finish_create(tests.id('u1'), 'Hub Rider One', '01711007001');
select tests.throws(format($$select public.hr_link_login(%L, %L)$$, tests.id('rdb'), tests.id('u1')), 'the login cannot be tied to someone of another hub', '42501');
select public.hr_link_login(tests.id('rd1'), tests.id('u1'));
reset role;
select tests.ok((select e.profile_id = tests.id('u1') from public.employees e where e.id = tests.id('rd1'))
  and (select not must_change_password from public.profiles where id = tests.id('u1'))
  and (select count(*) = 1 from public.user_roles where user_id = tests.id('u1') and scope_type = 'hub' and hub_id = tests.id('hub_a1')),
  'the rider has a login at their hub, usable straight away');
select tests.login(tests.id('hub_mgr'));

-- once linked the account is no longer "new": nothing more can be given to it by the hub
select tests.throws(format($$select public.user_admin_assign_role(%L, %L, 'hub', null, %L)$$, tests.id('u1'), (select v from t where k = 'rider'), tests.id('hub_a1')),
  'a finished login gets nothing more from the hub', '42501');

-- ---------- reset / unlock: only one's own riders and staff ----------
select tests.ok(public.user_admin_can_manage(tests.id('u1')), 'the hub may reset the password of its rider');
select tests.ok(not public.user_admin_can_manage(tests.id('admin')) and not public.user_admin_can_manage(tests.id('hub_mgr')) and not public.user_admin_can_manage(tests.id('ub')),
  'but not of an admin, of themselves, or of a stranger');
select public.user_admin_note_reset(tests.id('u1'));
select tests.ok(true, 'the reset is recorded');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(not public.user_admin_can_manage(tests.id('u1')), 'another hub''s manager cannot touch that login');
select tests.throws(format($$select * from public.hub_login_list(%L)$$, tests.id('hub_a1')), 'nor list another hub''s logins', '42501');
select tests.throws(format($$select public.user_admin_assign_role(%L, %L, 'hub', null, %L)$$, tests.id('u2'), (select v from t where k = 'rider'), tests.id('hub_a1')),
  'nor give a role at a hub that is not theirs', '42501');

-- the list for the hub's own manager
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) filter (where user_id is not null) = 1 and bool_and(can_make) filter (where employee_code = '7002')
  and not bool_or(can_make) filter (where employee_code in ('7001', '7004')) from public.hub_login_list(tests.id('hub_a1'))),
  'the list says who has a login and for whom one can be made');

-- an ordinary rider can do none of this
select tests.login(tests.id('u1'));
select tests.throws(format($$select public.user_admin_precheck('id-7002@xzmteam.com', %L, 'hub', null, %L, %L)$$, (select v from t where k = 'rider'), tests.id('hub_a1'), tests.id('rd2')),
  'a rider cannot make logins', '42501');

-- ---------- profiles ----------
select tests.login(tests.id('hub_mgr'));
select public.hr_hub_profile_save(tests.id('rd2'), '{"mobile":"01811007002","full_name_bn":"হাব রাইডার দুই","nid_number":"9988776655","date_of_birth":"1998-03-05","permanent_address":"নাটোর","alt_mobile":"01911007002","blood_group":"B+"}'::jsonb);
reset role;
select tests.ok((select mobile = '01811007002' and full_name_bn = 'হাব রাইডার দুই' and status = 'active' and employee_code = '7002' from public.employees where id = tests.id('rd2'))
  and (select nid_number = '9988776655' and date_of_birth = '1998-03-05' and permanent_address = 'নাটোর' from public.employee_sensitive where employee_id = tests.id('rd2')),
  'contact and identity details are saved; status and ID are untouched');
select tests.login(tests.id('hub_mgr'));
select tests.ok((public.hr_hub_profile_get(tests.id('rd2')) -> 'has' ->> 'nid_number')::boolean and not (public.hr_hub_profile_get(tests.id('rd2')) ? 'nid_number')
  and (public.hr_hub_profile_get(tests.id('rd2')) ->> 'mobile') = '01811007002' and (public.hr_hub_profile_get(tests.id('rd2')) ->> 'blood_group') = 'B+'
  and (public.hr_hub_profile_get(tests.id('rd2')) ->> 'alt_mobile') = '01911007002',
  'identity details come back only as yes / no');
select public.hr_hub_profile_save(tests.id('rd2'), '{"nid_number":"","permanent_address":"   "}'::jsonb);
reset role;
select tests.ok((select nid_number = '9988776655' and permanent_address = 'নাটোর' from public.employee_sensitive where employee_id = tests.id('rd2')),
  'an empty identity value does not wipe what is on file');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.hr_hub_profile_save(%L, '{"mobile":"01711007001"}'::jsonb)$$, tests.id('rd2')), 'a mobile number already used is refused', '23505');
select tests.throws(format($$select public.hr_hub_profile_save(%L, '{"nid_number":"7001700101"}'::jsonb)$$, tests.id('rd2')), 'an NID already used is refused', '23505');
select tests.throws(format($$select public.hr_hub_profile_save(%L, '{"mobile":"01811007003"}'::jsonb)$$, tests.id('rdb')), 'another hub''s person cannot be edited', '42501');
select tests.throws(format($$select public.hr_hub_profile_get(%L)$$, tests.id('rdb')), 'nor looked up', '42501');
select tests.login(tests.id('u1'));
select tests.throws(format($$select public.hr_hub_profile_save(%L, '{"mobile":"01811007009"}'::jsonb)$$, tests.id('rd2')), 'a rider cannot edit a colleague', '42501');

select tests.ok(not has_function_privilege('anon', 'public.hr_hub_profile_save(uuid, jsonb)', 'execute') and not has_function_privilege('anon', 'public.hub_login_list(uuid)', 'execute'),
  'signed-out visitors cannot call the new functions');
rollback;
