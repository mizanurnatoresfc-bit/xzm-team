-- Staff login accounts and role assignment (Users page).
begin;
select tests.fixture();

-- ---------- who may see the list ----------
select tests.login(tests.id('super'));
select tests.ok((select count(*) from public.user_admin_list()) >= 8, 'super admin sees every account');
select tests.ok((select can_manage from public.user_admin_list() where id = tests.id('hub_mgr')), 'super admin may manage a hub manager');
select tests.ok(not (select can_manage from public.user_admin_list() where id = tests.id('super')), 'nobody manages their own account from the list');
select tests.ok(exists (select 1 from public.user_admin_assignable_roles('global') where code = 'super_admin'),
  'super admin may hand out Super Admin');

select tests.ok(not exists (select 1 from public.user_admin_assignable_roles('hub', null, tests.id('hub_a1')) where code = 'super_admin'),
  'Super Admin is not offered for a single hub');
select tests.throws(format('select public.user_admin_assign_role(%L, (select id from public.roles where code=''super_admin''), ''hub'', null, %L)', tests.id('noroles'), tests.id('hub_a1')),
  'Super Admin cannot be given for one hub', '22023');

select tests.login(tests.id('hr'));
select tests.ok((select count(*) from public.user_admin_list()) >= 8, 'HR manager (user view right) sees the list');
select tests.ok(not (select can_manage from public.user_admin_list() where id = tests.id('hub_mgr')), 'HR manager cannot manage accounts');

select tests.login(tests.id('hub_mgr'));
select tests.throws($$select * from public.user_admin_list()$$, 'hub manager cannot list accounts', '42501');

select tests.login_anon();
select tests.throws($$select * from public.user_admin_list()$$, 'anonymous cannot call the users list');

-- ---------- admin: what can be granted ----------
select tests.login(tests.id('admin'));
select tests.ok(not exists (select 1 from public.user_admin_assignable_roles('global') where code = 'super_admin'),
  'admin cannot hand out Super Admin');
select tests.ok(exists (select 1 from public.user_admin_assignable_roles('hub', null, tests.id('hub_a1')) where code = 'hub_manager'),
  'admin may hand out Hub Manager for a hub');
select tests.ok(not public.user_admin_can_manage(tests.id('super')), 'admin cannot manage the super admin account');
select tests.throws(format('select public.user_admin_set_status(%L, false, %L)', tests.id('super'), 'test'),
  'admin cannot deactivate the super admin', '42501');
select tests.throws(format('select public.user_admin_note_reset(%L)', tests.id('super')),
  'admin cannot reset the super admin password', '42501');
select tests.throws(format('select public.user_admin_assign_role(%L, (select id from public.roles where code=''super_admin''), ''global'')', tests.id('noroles')),
  'admin cannot grant Super Admin', '42501');

-- ---------- assign roles ----------
select tests.ok(public.user_admin_assign_role(tests.id('noroles'), (select id from public.roles where code = 'hub_manager'), 'hub', null, tests.id('hub_a2')) is not null,
  'admin assigns Hub Manager for Hub A2');
select tests.throws(format('select public.user_admin_assign_role(%L, (select id from public.roles where code=''hub_manager''), ''hub'', null, %L)', tests.id('noroles'), tests.id('hub_a2')),
  'the same role twice at the same hub is refused', '23505');
select tests.throws(format('select public.user_admin_assign_role(%L, (select id from public.roles where code=''zonal_manager''), ''zone'')', tests.id('noroles')),
  'a zone role needs a zone', '22023');
select tests.ok((select count(*) from public.user_roles where user_id = tests.id('noroles') and revoked_at is null) = 1,
  'assignment saved once');

-- ---------- status, lock ----------
select tests.throws(format('select public.user_admin_set_status(%L, false, '''')', tests.id('hub_mgr')),
  'deactivation needs a reason', '22023');
select tests.throws(format('select public.user_admin_set_status(%L, false, %L)', tests.id('admin'), 'self'),
  'nobody deactivates their own account', '42501');
select public.user_admin_set_status(tests.id('hub_mgr'), false, 'left the company');
select tests.ok((select status from public.profiles where id = tests.id('hub_mgr')) = 'inactive', 'admin deactivates a hub manager');
select public.user_admin_set_status(tests.id('hub_mgr'), true, 'came back');
select tests.ok((select status from public.profiles where id = tests.id('hub_mgr')) = 'active', 'admin reactivates the account');

select tests.logout();
update public.profiles set failed_login_count = 5, locked_until = now() + interval '30 minutes' where id = tests.id('hub_mgr');
select tests.login(tests.id('admin'));
select public.user_admin_unlock(tests.id('hub_mgr'));
select tests.ok((select locked_until is null and failed_login_count = 0 from public.profiles where id = tests.id('hub_mgr')), 'admin unlocks a locked account');

-- ---------- password reset: the new password is used as it is (owner, 22 Nov 2026) ----------
select public.user_admin_note_reset(tests.id('hub_mgr'));
select tests.ok((select not must_change_password from public.profiles where id = tests.id('hub_mgr')), 'reset does not force a password change');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) from public.my_permissions()) > 0, 'after a reset the account works straight away');
select tests.logout();

-- ---------- an account waiting for its own password (a new login) holds no permissions ----------
update public.profiles set must_change_password = true where id = tests.id('hub_mgr');  -- what a new login starts with
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) from public.my_permissions()) = 0, 'account waiting for a new password holds no permissions');
select tests.ok(tests.row_count('select 1 from public.user_roles where user_id = auth.uid()') = 1, 'it can still read its own role (for the menu)');
select tests.throws(format('update public.profiles set must_change_password = false where id = %L', tests.id('hub_mgr')),
  'user cannot clear the flag without changing the password', '42501');
select tests.logout();
update public.profiles set must_change_password = false where id = tests.id('hub_mgr');  -- what the Edge Function does
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) from public.my_permissions()) > 0, 'after the change the permissions come back');

-- ---------- revoke ----------
select tests.login(tests.id('admin'));
select tests.throws(format('select public.user_admin_revoke_role((select id from public.user_roles where user_id = %L and revoked_at is null limit 1), %L)', tests.id('super'), 'x'),
  'admin cannot remove the Super Admin role', '42501');
select public.user_admin_revoke_role((select id from public.user_roles where user_id = tests.id('noroles') and revoked_at is null), 'moved');
select tests.ok((select revoked_at is not null and revoke_reason = 'moved' from public.user_roles where user_id = tests.id('noroles')), 'admin removes a role with a reason');
select tests.throws(format('select public.user_admin_revoke_role((select id from public.user_roles where user_id = %L limit 1), %L)', tests.id('noroles'), 'again'),
  'a removed role cannot be removed again', 'P0001');

select tests.login(tests.id('super'));
select tests.throws(format('select public.user_admin_revoke_role((select id from public.user_roles where user_id = %L and revoked_at is null limit 1), %L)', tests.id('super'), 'x'),
  'the last Super Admin role cannot be removed', 'P0001');
select tests.logout();
select tests.throws(format('update public.profiles set status = ''inactive'' where id = %L', tests.id('super')),
  'the last Super Admin account cannot be deactivated', 'P0001');

-- ---------- creating an account (steps the Edge Function runs as the admin) ----------
select tests.login(tests.id('admin'));
select tests.throws($$select public.user_admin_precheck('hub.a1@test.local', (select id from public.roles where code='rider'), 'hub', null, tests.id('hub_a1'))$$,
  'precheck refuses an email that already has an account', '23505');
select tests.throws($$select public.user_admin_precheck('not-an-email', (select id from public.roles where code='rider'), 'hub', null, tests.id('hub_a1'))$$,
  'precheck refuses a bad email', '22023');
select tests.throws($$select public.user_admin_precheck('new@test.local', (select id from public.roles where code='super_admin'), 'global')$$,
  'precheck refuses a role the admin may not grant', '42501');
select public.user_admin_precheck('new@test.local', (select id from public.roles where code = 'rider'), 'hub', null, tests.id('hub_a1'));
select tests.ok(true, 'precheck passes for a new rider at Hub A1');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.user_admin_precheck('x@test.local', (select id from public.roles where code='rider'), 'hub', null, tests.id('hub_a1'))$$,
  'hub manager cannot create accounts', '42501');

select tests.logout();
insert into tests.ids values ('newbie', tests.make_user('new@test.local', 'New Rider'));
select tests.login(tests.id('admin'));
select public.user_admin_assign_role(tests.id('newbie'), (select id from public.roles where code = 'rider'), 'hub', null, tests.id('hub_a1'));
select public.user_admin_finish_create(tests.id('newbie'), 'New Rider', '01711000000');
select tests.ok((select must_change_password and phone = '01711000000' from public.profiles where id = tests.id('newbie')),
  'new account must change its password at first login');
select tests.logout();
update public.profiles set last_login_at = now() where id = tests.id('newbie');
select tests.login(tests.id('admin'));
select tests.throws(format('select public.user_admin_finish_create(%L, ''X'', null)', tests.id('newbie')),
  'set-up step works only for brand-new accounts', 'P0001');

-- ---------- direct table writes still guarded ----------
select tests.login(tests.id('hr'));
update public.profiles set status = 'inactive' where id = tests.id('hub_mgr');
select tests.logout();
select tests.ok((select status from public.profiles where id = tests.id('hub_mgr')) = 'active',
  'HR manager cannot deactivate accounts by writing the table');

rollback;
