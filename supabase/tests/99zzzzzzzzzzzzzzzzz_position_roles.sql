-- Phase 0 + Phase 1 (20261119000100, 20261119000200): no duplicate hub names; a role for every post, kept in step.
begin;
select tests.fixture();
select tests.hr_fixture();

-- ---------- Phase 0: one hub per name ----------
select tests.throws($$insert into public.hubs (zone_id, code, name) values (tests.id('zone_a'), 'A1X', 'hub (a1)')$$,
  'a hub whose name differs only in case, spaces or brackets is refused', '23505');
update public.hubs set archived_at = now(), archive_reason = 'test' where id = tests.id('hub_a2');
insert into public.hubs (zone_id, code, name) values (tests.id('zone_a'), 'A2X', 'HubA2');
select tests.ok(true, 'an archived hub''s name may be used again');

-- ---------- the own-work roles ----------
select tests.ok((select count(*) = 5 from public.roles where code in ('sorting_loader','data_entry','hub_cc','fleet','guard')
                 and is_system and not is_super and status = 'active'), 'the five own-work roles exist and are not super roles');
select tests.ok((select count(*) = 5 from public.role_dashboards d join public.roles r on r.id = d.role_id
                 where r.code in ('sorting_loader','data_entry','hub_cc','fleet','guard')), 'each has a home page');
select tests.ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id
                 where r.code in ('sorting_loader','data_entry','hub_cc','fleet','guard')
                   and (p.code like 'system.%' or p.code like 'zonal.%' or p.code like 'hr.%' or p.code like '%.approve' or p.code like '%.archive'
                        or p.code like '%.configure')),
  'none of them can approve, archive, configure, manage people or users (so they open the staff panel)');
select tests.ok((select bool_and(private.hub_login_role(id)) from public.roles where code in ('rider','staff','sorting_loader','data_entry','hub_cc','fleet','guard')),
  'a hub may make logins with every own-work role');
select tests.ok(not private.hub_login_role((select id from public.roles where code = 'hub_manager')), 'but not with the hub manager role');

-- ---------- posts ----------
insert into public.positions (department_id, code, name) values (tests.id('dept_ops'), 'LOADER', 'Sorting + Loader');
insert into tests.ids select 'pos_loader', id from public.positions where code = 'LOADER';
insert into public.positions (department_id, code, name, default_role_id)
  select tests.id('dept_ops'), 'MGR', 'Manager', id from public.roles where code = 'hub_manager';
insert into tests.ids select 'pos_mgr', id from public.positions where code = 'MGR';
select tests.ok((select default_role_id = (select id from public.roles where code = 'staff') from public.positions where id = tests.id('pos_loader')),
  'a new post without a role gets the staff role');
update public.positions set default_role_id = (select id from public.roles where code = 'sorting_loader') where id = tests.id('pos_loader');

insert into tests.ids values ('l_login', tests.make_user('loader@test.local', 'Loader Login'));
insert into tests.ids values ('l1', tests.active_employee('Loader One', '901', tests.id('hub_a1'), '01711000901', '9010000000'));
update public.employees set position_id = tests.id('pos_loader') where id = tests.id('l1');
select tests.ok(not exists (select 1 from public.user_roles where user_id = tests.id('l_login')), 'no login yet, so no role');

-- a manually given role, which must never be touched
select tests.grant_role(tests.id('l_login'), 'pickup_manager', 'hub', null, tests.id('hub_a1'));

-- ---------- linking a login gives the post's role ----------
update public.employees set profile_id = tests.id('l_login') where id = tests.id('l1');
select tests.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('l_login') and r.code = 'sorting_loader' and ur.scope_type = 'hub'
                   and ur.hub_id = tests.id('hub_a1') and ur.granted_via = 'position' and ur.revoked_at is null),
  'linking the login gives the loader role at their hub, marked as coming from the post');

-- ---------- a transfer moves the post role, not the manual one ----------
insert into public.hubs (zone_id, code, name) values (tests.id('zone_a'), 'A3', 'Hub A3');
insert into tests.ids select 'hub_a3', id from public.hubs where code = 'A3';
select tests.login(tests.id('hr'));
select public.hr_transfer_employee(tests.id('l1'), tests.id('hub_a3'), tests.id('dept_ops'), tests.id('pos_loader'), null, current_date, 'বদলি পরীক্ষা');
select tests.logout();
select tests.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('l_login') and r.code = 'sorting_loader' and ur.hub_id = tests.id('hub_a1')
                   and ur.revoked_at is not null and ur.revoke_reason like '%Post or hub changed%'),
  'the old hub''s post role is ended with a reason, not deleted');
select tests.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('l_login') and r.code = 'sorting_loader' and ur.hub_id = tests.id('hub_a3') and ur.revoked_at is null),
  'the new hub''s post role is given');
select tests.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('l_login') and r.code = 'pickup_manager' and ur.hub_id = tests.id('hub_a1') and ur.revoked_at is null),
  'the role given by hand stays as it was');
select tests.ok((select reason = 'বদলি পরীক্ষা' from public.employee_assignments where employee_id = tests.id('l1') and effective_to is null),
  'the transfer keeps its own reason');

-- ---------- a promotion to a post whose role HR may not give waits for an admin ----------
select tests.login(tests.id('hr'));
select public.hr_transfer_employee(tests.id('l1'), tests.id('hub_a3'), tests.id('dept_ops'), tests.id('pos_mgr'), null, current_date, 'পদোন্নতি', 'promotion');
select tests.ok((select count(*) = 0 from public.position_role_gaps()), 'HR cannot read the role list');
select tests.logout();
select tests.ok(not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('l_login') and r.code in ('hub_manager','sorting_loader') and ur.revoked_at is null),
  'the loader role ends, and the hub manager role is not given by someone without that right');
select tests.login(tests.id('super'));
select tests.ok((select role_code = 'hub_manager' from public.position_role_gaps() where employee_id = tests.id('l1')),
  'the person waits in the admin''s list with the role their post needs');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.position_role_apply(%L)$$, tests.id('l1')), 'a hub manager cannot give the hub manager role this way', '42501');
select tests.login(tests.id('super'));
select tests.ok(public.position_role_apply(tests.id('l1')) = 'granted', 'the Super Admin gives it');
select tests.ok((select count(*) = 0 from public.position_role_gaps() where employee_id = tests.id('l1')), 'and the list is clear');
select tests.logout();

-- ---------- changing a post's role changes it for everyone on that post ----------
insert into tests.ids values ('d_login', tests.make_user('driver@test.local', 'Driver Login'));
insert into public.positions (department_id, code, name) values (tests.id('dept_ops'), 'DRV', 'Driver');
insert into tests.ids select 'pos_drv', id from public.positions where code = 'DRV';
insert into tests.ids values ('dr1', tests.active_employee('Driver One', '902', tests.id('hub_a1'), '01711000902', '9020000000'));
update public.employees set position_id = tests.id('pos_drv'), profile_id = tests.id('d_login') where id = tests.id('dr1');
select tests.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('d_login') and r.code = 'staff' and ur.revoked_at is null), 'a post still on the staff role gives staff');
select tests.login(tests.id('super'));
update public.positions set default_role_id = (select id from public.roles where code = 'fleet') where id = tests.id('pos_drv');
select tests.logout();
select tests.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('d_login') and r.code = 'fleet' and ur.hub_id = tests.id('hub_a1') and ur.revoked_at is null)
            and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = tests.id('d_login') and r.code = 'staff' and ur.revoked_at is null),
  'when the Super Admin changes the post''s role, the driver moves from staff to fleet');

-- ---------- leaving ends the post role ----------
update public.employees set status = 'resigned', status_since = current_date where id = tests.id('dr1');
select tests.ok(not exists (select 1 from public.user_roles where user_id = tests.id('d_login') and revoked_at is null),
  'a person who resigns loses the role of their post');

-- ---------- the Super Admin is never changed this way ----------
insert into tests.ids values ('s1', tests.active_employee('Owner Record', '903', tests.id('hub_a1'), '01711000903', '9030000000'));
update public.employees set position_id = tests.id('pos_loader'), profile_id = tests.id('super') where id = tests.id('s1');
select tests.ok((select count(*) = 1 from public.user_roles where user_id = tests.id('super') and revoked_at is null),
  'linking a Super Admin to an employee record adds no role');

-- ---------- nobody can write a "post" role for someone directly ----------
insert into tests.ids values ('x_login', tests.make_user('x@test.local', 'X'));
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$insert into public.user_roles (user_id, role_id, scope_type, hub_id, granted_via)
                              select %L, id, 'hub', %L, 'position' from public.roles where code = 'sorting_loader'$$, tests.id('x_login'), tests.id('hub_a1')),
  'a role marked as coming from a post cannot be written for a person whose post does not give it');
select tests.logout();

rollback;
