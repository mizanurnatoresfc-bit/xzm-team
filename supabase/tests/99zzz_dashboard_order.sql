-- The order a Super Admin saves for a role is the order that role's people get.
begin;
select tests.fixture();
select tests.hr_fixture();

-- saved layouts were put into the on-screen order, without changing what each role has
select tests.ok(not exists (
  select 1 from public.role_dashboards rd
   where rd.panels is distinct from (select coalesce(jsonb_agg(x.p order by coalesce(array_position(private.dashboard_screen_order(), x.p), 100), x.o), '[]'::jsonb)
                                       from jsonb_array_elements_text(rd.panels) with ordinality x(p, o))),
  'every saved layout starts in the order the home page has always shown');
select tests.ok((select panels from public.role_dashboards d join public.roles r on r.id = d.role_id where r.code = 'hub_manager') ?& array['ops_today','hub_today','my_work','quick_links'],
  'the hub manager keeps the same panels');

select tests.login(tests.id('hub_mgr'));
select tests.ok((public.dashboard_panels())[1] = 'my_day', 'before any change, the home page starts as it always did');
select tests.logout();

-- the Super Admin rearranges and removes
select tests.login(tests.id('super'));
select public.role_dashboard_save((select id from public.roles where code = 'hub_manager'), array['quick_links','accounts_today','my_work','hub_today']);
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.dashboard_panels() = array['quick_links','accounts_today','my_work','hub_today'], 'the saved order is the order the role gets');
select tests.ok(not ('my_day' = any (public.dashboard_panels())), 'a panel taken off is gone');

-- adding one back puts it where the Super Admin placed it
select tests.login(tests.id('super'));
select public.role_dashboard_save((select id from public.roles where code = 'hub_manager'), array['my_day','quick_links','accounts_today','my_work','hub_today']);
select tests.login(tests.id('hub_mgr'));
select tests.ok((public.dashboard_panels())[1:2] = array['my_day','quick_links'], 'a panel added back sits where it was placed');

-- permissions still decide: a panel the role may not see is left out, the rest keep their order
select tests.login(tests.id('super'));
select public.role_dashboard_save((select id from public.roles where code = 'rider'), array['quick_links','zonal_overview','my_work']);
select tests.logout();
insert into tests.ids values ('do1', tests.active_employee('Order Rider', '611', tests.id('hub_a1'), '01711000611', '6110101010'));
update public.positions set default_role_id = (select id from public.roles where code = 'rider') where id = tests.id('pos_rider');
update public.employees set profile_id = tests.id('rider_login') where id = tests.id('do1');
-- the rider role now comes with the post (migration 20261119000200)
select tests.ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = tests.id('rider_login') and r.code = 'rider' and ur.hub_id = tests.id('hub_a1') and ur.granted_via = 'position' and ur.revoked_at is null), 'linking the login gives the rider role of the post');
select tests.login(tests.id('rider_login'));
select tests.ok(public.dashboard_panels() = array['quick_links','my_work'], 'a panel without permission is left out and the order holds');

-- a role with no layout follows its permissions in the usual order
select tests.logout();
delete from public.role_dashboards where role_id = (select id from public.roles where code = 'rider');
select tests.login(tests.id('rider_login'));
select tests.ok((public.dashboard_panels())[1] = 'my_day' and 'quick_links' = (public.dashboard_panels())[array_length(public.dashboard_panels(), 1)],
  'without a layout the usual order is used');

-- only the Super Admin may arrange
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.role_dashboard_save((select id from public.roles where code = 'rider'), array['my_work'])$$, 'a hub manager cannot arrange a dashboard', '42501');
select tests.logout();
rollback;
