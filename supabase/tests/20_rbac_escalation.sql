-- Role assignment cannot be used to escalate privileges.
begin;
select tests.fixture();

-- Admin (not super) cannot make anyone Super Admin, including themselves.
select tests.login(tests.id('admin'));
select tests.throws(format($$insert into public.user_roles (user_id, role_id, scope_type)
                            select %L, id, 'global' from public.roles where code = 'super_admin'$$, tests.id('admin')),
                    'admin cannot grant super_admin');

-- Admin can assign a zonal manager role for a zone.
insert into public.user_roles (user_id, role_id, scope_type, zone_id)
select tests.id('noroles'), id, 'zone', tests.id('zone_b') from public.roles where code = 'zonal_manager';
select tests.ok(tests.row_count(format('select * from public.user_roles where user_id = %L', tests.id('noroles'))) = 1,
                'admin can assign zonal manager role');

-- Admin cannot add permissions to a role (only super admin).
select tests.throws($$insert into public.role_permissions (role_id, permission_id)
                      select r.id, p.id from public.roles r, public.permissions p
                      where r.code = 'rider' and p.code = 'system.audit.view'$$,
                    'admin cannot edit role permissions');

-- Zonal manager has no user-role rights at all.
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$insert into public.user_roles (user_id, role_id, scope_type, hub_id)
                            select %L, id, 'hub', %L from public.roles where code = 'hub_manager'$$,
                           tests.id('noroles'), tests.id('hub_a1')),
                    'zonal manager cannot assign roles');

-- A user cannot see other users' role assignments without permission.
select tests.ok(tests.row_count('select * from public.user_roles') = 1, 'zonal manager sees only own role assignment');

-- A user cannot activate themselves / change own status.
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$update public.profiles set status = 'inactive' where id = %L$$, tests.id('hub_mgr')),
                    'user cannot change own account status', '42501');
update public.profiles set preferred_language = 'bn' where id = tests.id('hub_mgr');
select tests.ok((select preferred_language from public.profiles where id = tests.id('hub_mgr')) = 'bn',
                'user can change own language');
select tests.logout();
update public.profiles set failed_login_count = 3 where id = tests.id('hub_mgr');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$update public.profiles set failed_login_count = 0, locked_until = null where id = %L$$, tests.id('hub_mgr')),
                    'user cannot reset own lockout fields', '42501');

-- Role assignments keep history: cannot be re-pointed, only revoked.
select tests.login(tests.id('admin'));
select tests.throws(format($$update public.user_roles set zone_id = %L where user_id = %L$$, tests.id('zone_a'), tests.id('noroles')),
                    'role assignment cannot be re-pointed', 'P0001');
update public.user_roles set revoked_at = now(), revoke_reason = 'Transferred' where user_id = tests.id('noroles');
select tests.logout();
select tests.ok((select revoked_by = tests.id('admin') from public.user_roles where user_id = tests.id('noroles')),
                'revocation records who revoked');
select tests.login(tests.id('noroles'));
select tests.ok(tests.row_count('select * from public.zones') = 0, 'revoked role no longer grants access');

-- System roles cannot be archived.
select tests.login(tests.id('super'));
select tests.throws($$update public.roles set archived_at = now() where code = 'admin'$$,
                    'system role cannot be archived', 'P0001');

-- Super admin can create a custom role and give it permissions.
insert into public.roles (code, name) values ('hub_clerk', 'Hub Clerk');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'hub_clerk' and p.code = 'org.hub.view';
select tests.ok(tests.row_count($$select * from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'hub_clerk'$$) = 1,
                'super admin can configure a custom role');

-- Expired assignment gives no access.
select tests.logout();
update public.user_roles set revoked_at = now() where user_id = tests.id('auditor');
insert into public.user_roles (user_id, role_id, scope_type, valid_from, valid_to)
select tests.id('auditor'), id, 'global', current_date - 10, current_date - 1 from public.roles where code = 'auditor';
select tests.login(tests.id('auditor'));
select tests.ok(tests.row_count('select * from public.my_permissions()') = 0, 'expired assignment grants nothing');
select tests.logout();
insert into public.user_roles (user_id, role_id, scope_type, valid_from)
select tests.id('auditor'), id, 'global', current_date + 1 from public.roles where code = 'auditor';
select tests.login(tests.id('auditor'));
select tests.ok(tests.row_count('select * from public.my_permissions()') = 0, 'future-dated assignment grants nothing yet');
select tests.logout();
select tests.throws($$insert into public.user_roles (user_id, role_id, scope_type, valid_from)
                      select tests.id('auditor'), id, 'global', current_date + 5 from public.roles where code = 'auditor'$$,
                    'overlapping duplicate role assignment is rejected', '23P01');

rollback;
