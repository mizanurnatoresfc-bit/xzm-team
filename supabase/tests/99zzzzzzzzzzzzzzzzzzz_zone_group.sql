-- জোন গ্রুপ ও জোনাল ম্যানেজার: who is in a zone's group, posting, seen / reactions, the zonal manager's contact and a note to them.
begin;
select tests.fixture();
select tests.hr_fixture();

-- a rider at hub A1 (zone A) with a login; the zonal manager of zone A has a staff record with a phone
select tests.active_employee('Rider A', '501', tests.id('hub_a1'), '01711000001', '1111111111', 15000, tests.id('rider_login'));
insert into tests.ids values
  ('zonal_employee', tests.active_employee('Zonal A Person', '502', tests.id('hub_a1'), '01711000002', '2222222222', 30000, tests.id('zonal_a'))),
  ('zonal_role', (select id from public.roles where code = 'zonal_manager'));

select tests.login(tests.id('super'));
select tests.ok(exists (select 1 from public.user_admin_assignable_roles('zone', tests.id('zone_a')) where code = 'zonal_manager')
  and not exists (select 1 from public.user_admin_assignable_roles('global') where code = 'zonal_manager')
  and not exists (select 1 from public.user_admin_assignable_roles('hub', null, tests.id('hub_a1')) where code = 'zonal_manager'),
  'the existing role picker offers Zonal Manager only at area scope');
select tests.throws(format($$select public.user_admin_assign_role(%L, %L, 'global')$$,
  tests.id('noroles'), tests.id('zonal_role')), 'the role API rejects a company-wide zonal grant', '22023');
select tests.throws(format($$insert into public.user_roles (user_id, role_id, scope_type, hub_id) values (%L, %L, 'hub', %L)$$,
  tests.id('noroles'), tests.id('zonal_role'), tests.id('hub_a1')), 'a direct hub-scope zonal grant is rejected', '22023');
select tests.ok(public.user_admin_assign_role(tests.id('noroles'), tests.id('zonal_role'), 'zone', tests.id('zone_b')) is not null,
  'the admin can assign the role to a selected active area');
select public.user_admin_revoke_role((select id from public.user_roles where user_id = tests.id('noroles')), 'Remove test assignment');
select tests.ok(exists (select from public.employees where id = tests.id('zonal_employee')), 'the super admin sees the zonal employee record');

select tests.login(tests.id('zonal_a'));
select tests.ok(public.staff_profile_get(tests.id('zonal_employee')) -> 'person' ->> 'name' = 'Zonal A Person',
  'the zonal manager can still open their own work profile');
select tests.login(tests.id('hub_mgr'));
select tests.ok(not exists (select from public.employees where id = tests.id('zonal_employee')),
  'even the manager of the same hub cannot select the zonal employee row');
select tests.ok(not exists (select from jsonb_array_elements(public.staff_profile_people(tests.id('hub_a1'))) person
  where person ->> 'id' = tests.id('zonal_employee')::text), 'the hub work-profile picker hides the zonal manager');
select tests.throws(format($$select public.staff_profile_get(%L)$$, tests.id('zonal_employee')),
  'knowing the employee ID does not let a hub manager open the zonal work profile', '42501');
select tests.throws(format($$select public.hr_hub_profile_get(%L)$$, tests.id('zonal_employee')),
  'the hub manager cannot open the personal details form', '42501');
select tests.ok(public.zone_contacts(tests.id('zone_a')) -> 'managers' = '[]'::jsonb,
  'the hub manager also receives no personal contact data');

-- who is in the group
select tests.login(tests.id('rider_login'));
select tests.ok(private.in_zone_group(tests.id('zone_a')), 'a rider at a hub of zone A is in zone A''s group');
select tests.ok(not private.in_zone_group(tests.id('zone_b')), 'the rider is not in zone B''s group');
select tests.ok((select count(*) from public.zone_group_list()) = 1 and (select bool_and(mine) from public.zone_group_list()), 'the rider sees one zone group, their own');
select tests.login(tests.id('hub_mgr'));
select tests.ok(private.in_zone_group(tests.id('zone_a')), 'the hub manager of A1 is in zone A''s group');
select tests.ok(not private.in_zone_group(tests.id('zone_b')), 'the hub manager of A1 is not in zone B''s group');
select tests.login(tests.id('super'));
select tests.ok((select count(*) from public.zone_group_list()) = 2, 'the Super Admin sees every zone group');
select tests.login(tests.id('noroles'));
select tests.ok((select count(*) from public.zone_group_list()) = 0, 'a login with no staff record and no role sees no zone group');
select tests.throws(format($$select public.zone_feed(%L)$$, tests.id('zone_a')), 'an outsider cannot read the zone feed', '42501');

-- posting and reading
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.zone_post_create(%L, '   ')$$, tests.id('zone_a')), 'an empty message is refused', '22023');
select tests.throws(format($$select public.zone_post_create(%L, 'hello')$$, tests.id('zone_b')), 'the rider cannot post in zone B', '42501');
select tests.throws(format($$select public.zone_post_create(%L, null, %L)$$, tests.id('zone_a'), tests.id('zone_b') || '/x.jpg'), 'a photo outside the zone folder is refused', '22023');
select tests.ok(public.zone_post_create(tests.id('zone_a'), 'সবাইকে শুভ সকাল') is not null, 'the rider posts in the zone group');
select tests.ok(public.zone_post_create(tests.id('zone_a'), null, 'zone/' || tests.id('zone_a') || '/1.jpg') is not null, 'a photo-only post in the zone folder is fine');
select tests.ok(jsonb_array_length(public.zone_feed(tests.id('zone_a'))) = 2, 'the feed has both posts');
select tests.ok((select unseen from public.zone_group_list()) = 0, 'my own posts are not counted as new for me');

select tests.login(tests.id('hub_mgr'));
select tests.ok((select unseen from public.zone_group_list() where zone_id = tests.id('zone_a')) = 2, 'the hub manager has two new posts');
select tests.ok(public.zone_posts_seen(array(select (x->>'id')::uuid from jsonb_array_elements(public.zone_feed(tests.id('zone_a'))) x)) = 2, 'opening the group marks both seen');
select tests.ok((select unseen from public.zone_group_list() where zone_id = tests.id('zone_a')) = 0, 'nothing new after that');
select tests.ok(public.zone_post_react((select id from public.zone_posts where body = 'সবাইকে শুভ সকাল'), '👍'), 'a reaction is added');
select tests.ok((select count(*) from public.zone_post_reacted_by((select id from public.zone_posts where body = 'সবাইকে শুভ সকাল'))) = 1, 'who reacted is listed');
select tests.ok(not public.zone_post_react((select id from public.zone_posts where body = 'সবাইকে শুভ সকাল'), '👍'), 'the same reaction again takes it back');
select tests.ok((select count(*) from public.zone_post_seen_by((select id from public.zone_posts where body = 'সবাইকে শুভ সকাল'))) = 1, 'who has seen it is listed');

select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.zone_post_react(%L, '👍')$$, (select id from public.zone_posts where body = 'সবাইকে শুভ সকাল')), 'another zone''s hub manager cannot react', '42501');
select tests.ok((select count(*) from public.zone_posts) = 0, 'and cannot read zone A''s posts directly');

-- the zonal manager's contact
select tests.login(tests.id('rider_login'));
select tests.ok(public.zone_contacts() ->> 'zone_id' = tests.id('zone_a')::text, 'with no zone given, the rider''s own zone is used');
select tests.ok((public.zone_contacts() ->> 'can_message')::boolean, 'zone A has a zonal manager who can receive a note');
select tests.ok(public.zone_contacts() -> 'managers' = '[]'::jsonb, 'staff see no name, phone or profile ID in the contact response');
select tests.throws(format($$select public.staff_profile_get(%L)$$, tests.id('zonal_employee')),
  'a rider cannot open the zonal manager work profile', '42501');
select tests.throws(format($$select public.zone_contacts(%L)$$, tests.id('zone_b')), 'the rider cannot read zone B''s contacts', '42501');
select tests.login(tests.id('noroles'));
select tests.ok(public.zone_contacts() is null, 'a login without a staff record gets nothing');

-- a note to the zonal manager
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.zone_manager_tell(%L, ' ')$$, tests.id('zone_a')), 'an empty note is refused', '22023');
select tests.throws(format($$select public.zone_manager_tell(%L, 'hello')$$, tests.id('zone_b')), 'a note to another zone is refused', '42501');
select tests.ok(public.zone_manager_tell(tests.id('zone_a'), 'হাবে ফ্যান নষ্ট') = 1, 'the note reaches one zonal manager');
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) from public.notifications where kind = 'zone_manager_note') = 1, 'the zonal manager has the notification');
select tests.login(tests.id('rider_login'));
select tests.ok((public.zone_contacts() ->> 'sent_today')::int = 1, 'the rider sees how many notes went today');
select tests.logout();
select tests.throws($$delete from public.zone_manager_notes$$, 'a note is never deleted (not even by the owner)', 'P0001');
select tests.throws($$delete from public.zone_posts$$, 'a zone post is never deleted', 'P0001');

-- Only an assigned Zonal Manager receives messages, even with a legacy zone-level post.
select tests.logout();
update public.user_roles set revoked_at = now() where user_id = tests.id('zonal_a');
select tests.login(tests.id('rider_login'));
select tests.ok(not (public.zone_contacts() ->> 'can_message')::boolean, 'without the area role there is no recipient');
select tests.throws(format($$select public.zone_manager_tell(%L, 'কেউ আছেন?')$$, tests.id('zone_a')), 'with nobody to receive it the note is refused', '22023');
select tests.logout();
insert into public.positions (department_id, code, name, level) values (tests.id('dept_ops'), 'ZM', 'Zonal Manager', 'zone');
update public.employees set position_id = (select id from public.positions where code = 'ZM') where employee_code = '502';
select tests.login(tests.id('rider_login'));
select tests.ok(not (public.zone_contacts() ->> 'can_message')::boolean, 'a zone-level post alone does not receive messages');

-- anon cannot run any of it
select tests.login_anon();
select tests.throws($$select public.zone_group_list()$$, 'anon cannot list zone groups', '42501');

select tests.logout();
rollback;
