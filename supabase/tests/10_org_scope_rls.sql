-- Organisation data is visible/editable only within the user's scope.
begin;
select tests.fixture();

-- Anonymous visitor -------------------------------------------------------
select tests.login_anon();
select tests.throws('select * from public.zones', 'anon cannot query zones', '42501');
select tests.throws('select * from public.profiles', 'anon cannot query profiles', '42501');
select tests.ok(tests.row_count('select * from public.system_settings') =
                tests.row_count('select * from public.system_settings where is_public'),
                'anon sees only public settings');
select tests.ok(tests.row_count($$select * from public.system_settings where key like 'security.%'$$) = 0,
                'anon cannot see security settings');

-- Super admin ---------------------------------------------------------------
select tests.login(tests.id('super'));
select tests.ok(tests.row_count('select * from public.zones') = 2, 'super admin sees all zones');
select tests.ok(tests.row_count('select * from public.hubs') = 3, 'super admin sees all hubs');
insert into public.zones (organization_id, code, name) values (tests.id('org'), 'ZC', 'Zone C');
select tests.ok(tests.row_count($$select * from public.zones where code = 'ZC'$$) = 1, 'super admin can create zone');

-- Zonal manager of Zone A ---------------------------------------------------
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.row_count('select * from public.zones') = 1, 'zonal manager sees only own zone');
select tests.ok(tests.row_count('select * from public.hubs') = 2, 'zonal manager sees only hubs in own zone');
select tests.ok(tests.row_count($$select * from public.hubs where code = 'B1'$$) = 0, 'zonal manager cannot see Zone B hub');
select tests.throws($$insert into public.zones (organization_id, code, name) values (tests.id('org'), 'ZX', 'X')$$,
                    'zonal manager cannot create zones', '42501');
update public.hubs set phone = '01700000000' where code = 'A2';
select tests.ok((select phone from public.hubs where code = 'A2') = '01700000000', 'zonal manager can edit hub in own zone');
update public.hubs set phone = 'hacked' where id = tests.id('hub_b1');   -- silently filtered by RLS
select tests.logout();
select tests.ok((select phone from public.hubs where id = tests.id('hub_b1')) is null, 'zonal manager cannot edit hub in other zone');

select tests.login(tests.id('zonal_a'));
select tests.throws(format('update public.hubs set zone_id = %L where code = %L', tests.id('zone_b'), 'A2'),
                    'zonal manager cannot move a hub into another zone', '42501');

-- Hub manager of Hub A1 -----------------------------------------------------
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count('select * from public.hubs') = 1, 'hub manager sees only own hub');
select tests.ok(tests.row_count('select * from public.zones') = 1, 'hub manager can see the zone of own hub');
select tests.ok(tests.row_count($$select * from public.zones where code = 'ZB'$$) = 0, 'hub manager cannot see other zones');
update public.hubs set phone = 'x' where code = 'A1';
select tests.logout();
select tests.ok((select phone from public.hubs where code = 'A1') is null, 'hub manager cannot edit hub (no edit permission)');

-- Inactive account ------------------------------------------------------------
select tests.login(tests.id('inactive'));
select tests.ok(tests.row_count('select * from public.hubs') = 0, 'inactive user sees no hubs');
select tests.ok(tests.row_count('select * from public.organizations') = 0, 'inactive user sees no organisation data');
select tests.ok(tests.row_count('select * from public.my_permissions()') = 0, 'inactive user has no effective permissions');

-- Locked account ----------------------------------------------------------------
select tests.logout();
update public.profiles set locked_until = now() + interval '10 minutes' where id = tests.id('hub_mgr');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count('select * from public.hubs') = 0, 'locked user sees nothing until lock expires');

-- User with no roles ------------------------------------------------------------
select tests.login(tests.id('noroles'));
select tests.ok(tests.row_count('select * from public.zones') = 0, 'user without roles sees no zones');
select tests.ok(tests.row_count('select * from public.profiles') = 1, 'user sees only own profile');

-- Deletion is impossible, even for the database owner ----------------------------
select tests.login(tests.id('super'));
select tests.throws($$delete from public.hubs where code = 'A2'$$, 'super admin cannot delete via API (no grant)', '42501');
select tests.logout();
select tests.throws($$delete from public.hubs where code = 'A2'$$, 'owner/service role cannot delete hub (archive only)', 'P0001');

-- Archive workflow requires a reason and permission ---------------------------------
select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.archive_org_unit(%L, %L, %L)', 'hubs', tests.id('hub_a2'), ''),
                    'archive requires a reason', '22023');
select tests.throws(format('select public.archive_org_unit(%L, %L, %L)', 'hubs', tests.id('hub_a2'), 'closing'),
                    'zonal manager without archive permission cannot archive hub');
select tests.login(tests.id('admin'));
select public.archive_org_unit('hubs', tests.id('hub_a2'), 'Hub merged into A1');
select tests.ok((select archived_at is not null and status = 'inactive' from public.hubs where code = 'A2'),
                'admin archived hub with reason');

rollback;
