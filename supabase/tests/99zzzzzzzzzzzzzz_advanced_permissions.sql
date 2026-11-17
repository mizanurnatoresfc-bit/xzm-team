-- Personal permissions (individual user override): given on top of, or taken away from, what the roles give.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

-- ---------- before: what the hub manager holds from the role alone ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok(private.has_permission('hr.attendance.create', null, tests.id('hub_a1')), 'before: the hub manager records attendance at the hub');
select tests.ok(not private.has_permission('da.sheet.approve', null, tests.id('hub_a1')), 'before: the hub manager cannot approve sheets');
select tests.ok((select count(*) from public.hubs) = 1, 'before: the hub manager sees the own hub only');
insert into t select 'rows_before', count(*)::text from private.my_grants();
insert into t select 'grants_before', md5(coalesce(string_agg(g.permission_code || '|' || g.scope_type || '|' || coalesce(g.hub_id::text, ''), ',' order by g.permission_code), ''))
  from public.my_permissions() g where g.permission_code is not null;

-- ---------- only the Super Admin sets them; nobody writes the table ----------
select tests.login(tests.id('admin'));
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"grant"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'an admin who is not the Super Admin cannot set personal permissions', '42501');
select tests.throws(format($$insert into public.user_permission_overrides (user_id, permission_id, effect, scope_type, reason)
  select %L, id, 'grant', 'role', 'x' from public.permissions where code = 'da.sheet.approve'$$, tests.id('hub_mgr')),
  'the table cannot be written directly', '42501');

select tests.login(tests.id('super'));
select tests.throws(format($$insert into public.user_permission_overrides (user_id, permission_id, effect, scope_type, reason)
  select %L, id, 'grant', 'role', 'x' from public.permissions where code = 'da.sheet.approve'$$, tests.id('hub_mgr')),
  'not even the Super Admin writes the table directly', '42501');

-- ---------- what is refused ----------
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"no.such.thing","effect":"grant"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'an unknown permission is refused', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"grant"}]'::jsonb, '  ')$$, tests.id('hub_mgr')),
  'a reason is required', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"maybe"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'the effect must be grant or deny', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"grant","scope_type":"moon"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'the place must be one of the four kinds', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"grant","scope_type":"zone"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'a zone-level permission needs a zone', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"grant","scope_type":"hub","hub_id":"00000000-0000-0000-0000-000000000001"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'a hub-level permission needs a real hub', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"grant","valid_to":"2020-01-01"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'an end date in the past is refused', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"grant"},{"permission":"da.sheet.approve","effect":"deny"}]'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'a permission cannot be given and switched off together', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '{"permission":"da.sheet.approve"}'::jsonb, 'x')$$, tests.id('hub_mgr')),
  'the list must be a list', '22023');
select tests.throws(format($$select public.access_overrides_save(%L, '[{"permission":"da.sheet.approve","effect":"deny"}]'::jsonb, 'x')$$, tests.id('super')),
  'nothing can be taken from a Super Admin', 'P0001');
select tests.throws($$select public.access_overrides_save('00000000-0000-0000-0000-000000000009', '[]'::jsonb, 'x')$$,
  'an unknown account is refused', 'P0001');
select tests.ok((select count(*) from public.user_permission_overrides) = 0, 'a refused save leaves nothing behind');

-- ---------- give and take ----------
insert into t select 'r1', public.access_overrides_save(tests.id('hub_mgr'), format($j$[
  {"permission":"hr.attendance.create","effect":"deny"},
  {"permission":"da.sheet.approve","effect":"grant"},
  {"permission":"da.sheet.approve","effect":"grant"},
  {"permission":"hr.employee.edit","effect":"grant","scope_type":"zone","zone_id":"%s"},
  {"permission":"org.hub.view","effect":"grant","scope_type":"hub","hub_id":"%s"},
  {"permission":"system.audit.view","effect":"grant","scope_type":"global","valid_to":"%s"}
]$j$, tests.id('zone_b'), tests.id('hub_b1'), (current_date + 30)::text)::jsonb, 'অস্থায়ী দায়িত্ব')::text;
select tests.ok((select v::jsonb from t where k = 'r1') = '{"added": 5, "kept": 0, "removed": 0}'::jsonb, 'five personal permissions saved (the repeated line counts once)');
select tests.ok((select count(*) from public.user_permission_overrides where user_id = tests.id('hub_mgr') and revoked_at is null) = 5, 'five rows in force');
select tests.ok((select count(*) from public.access_overrides(tests.id('hub_mgr')) where live) = 5
  and (select zone from public.access_overrides(tests.id('hub_mgr')) where permission = 'hr.employee.edit') = 'Zone B'
  and (select hub from public.access_overrides(tests.id('hub_mgr')) where permission = 'org.hub.view') = 'Hub B1'
  and (select created_by_name from public.access_overrides(tests.id('hub_mgr')) limit 1) = 'Super',
  'the list shows them with the place and who gave them');
insert into t select 'seen_by_super', md5(coalesce(string_agg(g.permission_code || '|' || g.scope_type || '|' || coalesce(g.zone_id::text, '') || '|' || coalesce(g.hub_id::text, ''), ','
  order by g.permission_code, g.scope_type, g.zone_id, g.hub_id), ''))
  from public.access_user_grants(tests.id('hub_mgr')) g where g.permission_code is not null;

select tests.login(tests.id('hub_mgr'));
select tests.ok(not private.has_permission('hr.attendance.create', null, tests.id('hub_a1')), 'switched off: attendance can no longer be recorded');
select tests.ok(not exists (select 1 from public.my_permissions() where permission_code = 'hr.attendance.create'), 'switched off: it is gone from the person''s own list');
select tests.ok(private.has_permission('hr.attendance.view', null, tests.id('hub_a1')), 'the rest of the role is untouched');
select tests.ok(private.has_permission('da.sheet.approve', null, tests.id('hub_a1')), 'given where the roles work: sheets can be approved at the own hub');
select tests.ok(not private.has_permission('da.sheet.approve', null, tests.id('hub_a2')) and not private.has_permission('da.sheet.approve'),
  '…and nowhere else');
select tests.ok(exists (select 1 from public.my_permissions() where permission_code = 'da.sheet.approve' and scope_type = 'hub' and hub_id = tests.id('hub_a1')),
  'the given permission is listed at the role''s hub');
select tests.ok(private.has_permission('hr.employee.edit', null, tests.id('hub_b1')) and private.has_permission('hr.employee.edit', tests.id('zone_b'))
  and not private.has_permission('hr.employee.edit', null, tests.id('hub_a1')), 'given for one zone: it works in that zone only');
select tests.ok((select count(*) from public.hubs) = 2 and exists (select 1 from public.hubs where id = tests.id('hub_b1')),
  'given for one hub: the rules of the database follow (a second hub is now visible)');
select tests.ok(private.has_permission('system.audit.view') and (select count(*) from public.audit_logs) > 0, 'given for the whole company: the audit log opens');
select tests.ok((select count(*) from private.my_grants()) = (select v::int from t where k = 'rows_before') + 4, 'the role''s rows are all still there, plus the four given');
select tests.ok((select md5(coalesce(string_agg(g.permission_code || '|' || g.scope_type || '|' || coalesce(g.zone_id::text, '') || '|' || coalesce(g.hub_id::text, ''), ','
    order by g.permission_code, g.scope_type, g.zone_id, g.hub_id), '')) from public.my_permissions() g where g.permission_code is not null) = (select v from t where k = 'seen_by_super'),
  'what the Super Admin is shown for this person is exactly what the person holds');

-- reading: own list yes, other people's no
select tests.ok((select count(*) from public.access_overrides(tests.id('hub_mgr'))) = 5, 'a person may read their own personal permissions');
select tests.ok((select count(*) from public.user_permission_overrides) = 5, 'the table shows a person their own rows');
select tests.throws($$select * from public.access_overrides()$$, 'but not everybody''s', '42501');
select tests.throws(format($$select * from public.access_user_grants(%L)$$, tests.id('admin')), 'nor what another person holds', '42501');
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) from public.user_permission_overrides) = 0, 'another person sees none of the rows');
select tests.throws(format($$select * from public.access_overrides(%L)$$, tests.id('hub_mgr')), 'a zonal manager cannot read someone else''s personal permissions', '42501');
select tests.login(tests.id('auditor'));
select tests.ok((select count(*) from public.access_overrides()) = 5, 'whoever may see role assignments company-wide may read them all');

-- ---------- change the list: what is missing is taken back, the rest stays ----------
select tests.login(tests.id('super'));
insert into t select 'r2', public.access_overrides_save(tests.id('hub_mgr'), format($j$[
  {"permission":"hr.attendance.create","effect":"deny"},
  {"permission":"da.sheet.approve","effect":"grant"},
  {"permission":"system.audit.view","effect":"grant","scope_type":"global"},
  {"permission":"hr.leave.approve","effect":"deny"}
]$j$)::jsonb, 'কাজ শেষ')::text;
select tests.ok((select v::jsonb from t where k = 'r2') = '{"added": 1, "kept": 3, "removed": 2}'::jsonb, 'second save: one added, three kept, two taken back');
select tests.ok((select valid_to is null from public.user_permission_overrides o join public.permissions p on p.id = o.permission_id
                  where o.user_id = tests.id('hub_mgr') and p.code = 'system.audit.view' and o.revoked_at is null), 'a kept line takes the new end date');
select tests.ok((select count(*) from public.access_overrides(tests.id('hub_mgr'), true) where revoked_at is not null and revoke_reason = 'কাজ শেষ' and not live) = 2,
  'what was taken back stays in the history, with the reason');
select tests.ok((select count(*) from public.audit_logs where table_name = 'user_permission_overrides' and action = 'INSERT' and actor_id = tests.id('super')) = 6
  and (select count(*) from public.audit_logs where table_name = 'user_permission_overrides' and action = 'UPDATE' and reason = 'কাজ শেষ') = 3,
  'every change is in the audit log, with who and why');
select tests.login(tests.id('hub_mgr'));
select tests.ok(not private.has_permission('hr.employee.edit', null, tests.id('hub_b1')) and (select count(*) from public.hubs) = 1, 'what was taken back stops at once');
select tests.ok(not private.has_permission('hr.leave.approve', null, tests.id('hub_a1')) and private.has_permission('da.sheet.approve', null, tests.id('hub_a1')), 'the new list is in force');

-- ---------- dates: not yet started, already ended ----------
select tests.logout();
insert into public.user_permission_overrides (user_id, permission_id, effect, scope_type, valid_from, valid_to, reason)
  select tests.id('hub_mgr'), id, 'grant', 'role', current_date - 10, current_date - 1, 'old' from public.permissions where code = 'hr.employee.archive';
insert into public.user_permission_overrides (user_id, permission_id, effect, scope_type, valid_from, reason)
  select tests.id('hub_mgr'), id, 'grant', 'role', current_date + 5, 'later' from public.permissions where code = 'hr.duty.edit';
select tests.throws($$delete from public.user_permission_overrides$$, 'rows are never deleted, not even by the owner', 'P0001');
select tests.login(tests.id('hub_mgr'));
select tests.ok(not private.has_permission('hr.employee.archive', null, tests.id('hub_a1')), 'a personal permission that has ended gives nothing');
select tests.ok(not private.has_permission('hr.duty.edit', null, tests.id('hub_a1')), 'one that has not started yet gives nothing');
select tests.login(tests.id('super'));
select tests.ok((select count(*) from public.access_overrides(tests.id('hub_mgr')) where not live) = 2, 'the list marks both as not in force');

-- ---------- everything switched off: the person still holds the role ----------
select public.access_overrides_save(tests.id('noroles'), '[]'::jsonb, 'x');
select public.user_admin_assign_role(tests.id('noroles'), (select id from public.roles where code = 'staff'), 'hub', null, tests.id('hub_a1'));
select public.access_overrides_save(tests.id('noroles'), '[{"permission":"org.hub.view","effect":"deny"},{"permission":"org.organization.view","effect":"deny"}]'::jsonb, 'পরীক্ষা');
select tests.login(tests.id('noroles'));
select tests.ok(not exists (select 1 from public.my_permissions() where permission_code is not null), 'every permission of the role is switched off');
select tests.ok(exists (select 1 from private.my_grants()) and (select count(*) from public.departments) = 3, 'yet the person still counts as staff (company lists stay readable)');
select tests.ok((select count(*) from public.hubs) = 0, 'and the hub is no longer visible');

-- ---------- a personal permission without any role ----------
select tests.login(tests.id('super'));
select public.user_admin_revoke_role((select id from public.user_roles where user_id = tests.id('noroles') and revoked_at is null), 'পরীক্ষা');
select public.access_overrides_save(tests.id('noroles'), format('[{"permission":"org.hub.view","effect":"grant"},{"permission":"hr.employee.view","effect":"grant","scope_type":"hub","hub_id":"%s"}]', tests.id('hub_a2'))::jsonb, 'পরীক্ষা');
select tests.login(tests.id('noroles'));
select tests.ok(private.has_permission('hr.employee.view', null, tests.id('hub_a2')) and not private.has_permission('org.hub.view', null, tests.id('hub_a2')),
  'with no role: a permission for a fixed place works, one that follows the roles has nowhere to land');

-- ---------- the Super Admin is never touched ----------
select tests.logout();
insert into public.user_permission_overrides (user_id, permission_id, effect, scope_type, reason)
  select tests.id('super'), id, 'deny', 'global', 'forced in by hand' from public.permissions where code = 'system.role.edit';
select tests.login(tests.id('super'));
select tests.ok(private.is_super_admin() and private.has_permission('system.role.edit') and private.has_permission('hr.employee.view', null, tests.id('hub_b1')),
  'a row forced in by hand takes nothing from a Super Admin');

-- ---------- an account that cannot work yet holds nothing, but can be looked at ----------
select tests.logout();
update public.profiles set must_change_password = true where id = tests.id('hub_mgr');
select tests.login(tests.id('hub_mgr'));
select tests.ok(not exists (select 1 from private.my_grants()), 'a login that still has to set its password holds nothing, personal permissions included');
select tests.login(tests.id('super'));
select tests.ok(exists (select 1 from public.access_user_grants(tests.id('hub_mgr')) where permission_code = 'da.sheet.approve'), 'the access page still shows what it will hold');
select tests.ok(not exists (select 1 from public.access_user_grants(tests.id('inactive'))), 'a switched-off account holds nothing either way');
select tests.logout();
update public.profiles set must_change_password = false where id = tests.id('hub_mgr');

-- ---------- nobody takes over an account that was personally given more than they hold ----------
select tests.login(tests.id('super'));
insert into tests.ids values ('lite_role', public.role_admin_save(null, 'User Desk', 'ইউজার ডেস্ক', null,
  (select array_agg(p.code) from public.permissions p
    where p.code in ('system.user.view', 'system.user.edit', 'system.user_role.view', 'system.user_role.create', 'system.user_role.edit')
       or exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'rider' and rp.permission_id = p.id))));
select tests.logout();
insert into tests.ids values ('lite', tests.make_user('lite@test.local', 'User Desk')), ('rider1', tests.make_user('rider1@test.local', 'Rider One'));
select tests.login(tests.id('super'));
select public.user_admin_assign_role(tests.id('lite'), tests.id('lite_role'), 'global');
select public.user_admin_assign_role(tests.id('rider1'), (select id from public.roles where code = 'rider'), 'hub', null, tests.id('hub_a1'));
select tests.login(tests.id('lite'));
select tests.ok(public.user_admin_can_manage(tests.id('rider1')), 'before: the user desk may manage a plain rider login');
select tests.login(tests.id('super'));
select public.access_overrides_save(tests.id('rider1'), '[{"permission":"da.sheet.approve","effect":"grant"}]'::jsonb, 'দায়িত্ব');
select tests.login(tests.id('lite'));
select tests.ok(not public.user_admin_can_manage(tests.id('rider1')), 'after a personal grant the desk does not hold: it can no longer manage that login');
select tests.throws(format($$select public.user_admin_set_status(%L, false, 'x')$$, tests.id('rider1')), 'so it cannot switch the account off', '42501');
select tests.login(tests.id('super'));
select public.access_overrides_save(tests.id('rider1'), '[{"permission":"ops.delivery.create","effect":"deny"},{"permission":"ops.route.view","effect":"grant","scope_type":"global"}]'::jsonb, 'দায়িত্ব শেষ');
select tests.login(tests.id('lite'));
select tests.ok(public.user_admin_can_manage(tests.id('rider1')), 'a grant the desk holds itself, or a permission switched off, does not get in the way');

-- the hub and its own riders' logins: a login that carries a personal grant is no longer the hub's to reset
select tests.logout();
insert into tests.ids values ('emp_r1', tests.active_employee('Rider One', '7101', tests.id('hub_a1'), '01711007101', '7101710101', 15000, tests.id('rider1')));
select tests.login(tests.id('hub_mgr'));
select tests.ok(not public.user_admin_can_manage(tests.id('rider1')), 'the hub cannot manage a rider login that was personally given something');
select tests.login(tests.id('super'));
select public.access_overrides_save(tests.id('rider1'), '[{"permission":"ops.delivery.create","effect":"deny"}]'::jsonb, 'x');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.user_admin_can_manage(tests.id('rider1')), 'once only a switched-off permission is left, the hub manages its rider''s login again');

-- ---------- a role the company made can be switched off for a while — by the Super Admin only ----------
select tests.login(tests.id('lite'));
select tests.ok(private.has_permission('system.user.edit'), 'before: the desk role works');
select tests.login(tests.id('admin'));
select tests.throws(format($$update public.roles set status = 'inactive' where id = %L$$, tests.id('lite_role')), 'an admin who is not Super Admin cannot switch a role off', '42501');
select tests.login(tests.id('super'));
update public.roles set status = 'inactive' where id = tests.id('lite_role');
select tests.throws($$update public.roles set status = 'inactive' where code = 'rider'$$, 'a built-in role cannot be switched off, even by the Super Admin', 'P0001');
select tests.login(tests.id('lite'));
select tests.ok(not exists (select 1 from private.my_grants()), 'a role that is switched off gives its holders nothing');
select tests.login(tests.id('super'));
update public.roles set status = 'active' where id = tests.id('lite_role');
select tests.login(tests.id('lite'));
select tests.ok(private.has_permission('system.user.edit'), 'switched on again, it works as before');
select tests.login(tests.id('super'));
select tests.ok((select count(*) from public.audit_logs where table_name = 'roles' and record_id = tests.id('lite_role')::text and 'status' = any (changed_fields)) = 2,
  'switching a role off and on is in the audit log');

rollback;
