-- Role-based dashboard: which panels each role gets, what the numbers hold, who may change a layout.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('d1', tests.active_employee('Dash Rider One', '601', tests.id('hub_a1'), '01711000601', '6010101010')),
  ('d2', tests.active_employee('Dash Rider Two', '602', tests.id('hub_b1'), '01711000602', '6020202020'));
-- give the rider a login of their own, so "my work" has an owner
update public.employees set profile_id = tests.id('rider_login') where id = tests.id('d1');
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

-- ---------- the catalogue and the seeded layouts ----------
-- 9 panels at first; dashboard_views (15 Nov) added my_day, my_requests, hub_today, approvals, network
select tests.ok((select count(*) from private.dashboard_catalogue()) = 14, 'fourteen panels exist');
-- 13 roles at first; staff (staff_logins_rollout) and zonal_assistant (attendance_gaps) came later
select tests.ok((select count(*) from public.role_dashboards) = (select count(*) from public.roles where is_system), 'every shipped role starts with a layout');
select tests.ok((select panels from public.role_dashboards d join public.roles r on r.id = d.role_id where r.code = 'rider')
                = '["my_day","my_requests","my_work","quick_links"]'::jsonb, 'a rider starts with their own day and work only');

-- ---------- each role gets its own dashboard ----------
select tests.login(tests.id('super'));
select tests.ok('hr_overview' = any (public.dashboard_panels()), 'super admin sees the staff panel');
select tests.ok('zonal_overview' = any (public.dashboard_panels()), 'super admin sees the zonal panel');
select tests.ok('accounts_today' = any (public.dashboard_panels()), 'super admin sees the accounts panel');

select tests.login(tests.id('hr'));
select tests.ok('hr_overview' = any (public.dashboard_panels()), 'HR sees the staff panel');
select tests.ok(not ('cash_today' = any (public.dashboard_panels())), 'HR does not get the cash panel');
select tests.ok(not ('zonal_overview' = any (public.dashboard_panels())), 'HR does not get the zonal panel');

select tests.login(tests.id('hub_mgr'));
select tests.ok('ops_today' = any (public.dashboard_panels()), 'a hub manager sees today''s operations');
select tests.ok(not ('hr_pending' = any (public.dashboard_panels())), 'a hub manager does not get HR approvals');

select tests.login(tests.id('rider_login'));
select tests.ok(public.dashboard_panels() = array['my_day','my_requests','my_work','quick_links'], 'a rider sees only their own day and work');

-- a role may ask for a panel, but the permissions still decide
select tests.logout();
update public.role_dashboards set panels = '["my_work","cash_today","quick_links"]'::jsonb
 where role_id = (select id from public.roles where code = 'rider');
select tests.login(tests.id('rider_login'));
select tests.ok(not ('cash_today' = any (public.dashboard_panels())),
  'a panel the role has no permission for is left out');
select tests.logout();
update public.role_dashboards set panels = '["my_work","quick_links"]'::jsonb
 where role_id = (select id from public.roles where code = 'rider');

-- a role with no layout of its own falls back to its permissions
select tests.logout();
delete from public.role_dashboards where role_id = (select id from public.roles where code = 'hr_manager');
select tests.login(tests.id('hr'));
select tests.ok('hr_overview' = any (public.dashboard_panels()), 'without a layout, the panels follow the permissions');
select tests.logout();
insert into public.role_dashboards (role_id, panels)
select id, '["hr_overview","hr_pending","hub_staff","my_work","quick_links"]'::jsonb from public.roles where code = 'hr_manager';

-- someone with no role at all still gets a usable page
select tests.login(tests.id('noroles'));
select tests.ok(public.dashboard_panels() = array['my_day','my_requests','my_work','quick_links'], 'a user with no role still has a home page (the panels that need no permission)');

-- ---------- the numbers ----------
select tests.login(tests.id('hr'));
select tests.ok((public.dashboard_home() -> 'hr_overview' ->> 'active')::int
                = (select count(*) from public.employees where status = 'active' and archived_at is null),
  'the staff panel counts the active employees');
select tests.ok(public.dashboard_home() -> 'cash_today' is null, 'panels this role has no permission for carry no numbers');
select tests.ok(jsonb_array_length(public.dashboard_home() -> 'hub_staff') = 3, 'HR sees all three hubs in the hub panel');
select tests.ok((public.dashboard_home() ->> 'today')::date = current_date, 'the dashboard knows today');

select tests.login(tests.id('zonal_a'));
select tests.ok(jsonb_array_length(public.dashboard_home() -> 'hub_staff') = 2, 'a zonal manager sees only their own zone''s hubs');
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.dashboard_home() -> 'hub_staff') = 1, 'a hub manager sees only their own hub');

-- "my work" is the caller's own
select tests.login(tests.id('rider_login'));
select tests.ok((public.dashboard_home() -> 'me' ->> 'employee_code') = '601', 'the rider sees their own ID on the dashboard');
select tests.ok((public.dashboard_home() -> 'my_work' ->> 'marked_today') = 'false', 'attendance for today is not marked yet');
select tests.logout();
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('d1'), current_date, 'present');
select tests.login(tests.id('rider_login'));
select tests.ok((public.dashboard_home() -> 'my_work' ->> 'marked_today') = 'true', 'once marked, the dashboard says so');

-- pending work shows up for the person who must act on it
select tests.logout();
insert into public.leave_types (code, name, annual_quota) values ('CAS', 'Casual', 10) on conflict do nothing;
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, status)
select tests.id('d2'), id, current_date + 3, current_date + 4, 'Family', 'pending' from public.leave_types where code = 'CAS';
select tests.login(tests.id('hr'));
select tests.ok((public.dashboard_home() -> 'hr_pending' ->> 'leave')::int >= 1, 'HR is shown the leave waiting for a decision');

-- ---------- only a Super Admin changes a layout ----------
select tests.login(tests.id('super'));
select public.role_dashboard_save((select id from public.roles where code = 'rider'), array['my_work','ops_today','quick_links']);
select tests.ok((select panels from public.role_dashboards d join public.roles r on r.id = d.role_id where r.code = 'rider')
                = '["my_work","ops_today","quick_links"]'::jsonb, 'super admin sets what a role sees');
select tests.ok((select count(*) from public.role_dashboard_list()) = (select count(*) from public.roles where archived_at is null), 'the layout list shows every role');
select tests.throws($$select public.role_dashboard_save((select id from public.roles where code = 'rider'), array['no_such_panel'])$$,
  'an unknown panel is refused', '22023');
select tests.throws($$update public.role_dashboards set panels = '["my_work","my_work"]'::jsonb
                       where role_id = (select id from public.roles where code = 'rider')$$,
  'the same panel twice is refused', '22023');

select tests.login(tests.id('hr'));
select tests.throws($$select public.role_dashboard_save((select id from public.roles where code = 'rider'), array['my_work'])$$,
  'an HR manager cannot change what a role sees', '42501');
select tests.ok((select count(*) from public.role_dashboard_list()) = 0, 'the layout list is empty for anyone but a super admin');
update public.role_dashboards set panels = '["my_work"]'::jsonb
 where role_id = (select id from public.roles where code = 'rider');
select tests.ok((select panels from public.role_dashboards d join public.roles r on r.id = d.role_id where r.code = 'rider')
                = '["my_work","ops_today","quick_links"]'::jsonb,
  'a direct write by anyone but a super admin changes nothing');
select tests.ok(exists (select 1 from public.role_dashboards), 'but everyone with a role may read the layouts');

rollback;
