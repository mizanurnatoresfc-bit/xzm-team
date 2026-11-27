-- Hub pending counts: review rules (migration 20261127030000_pending_review_fixes.sql).
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
 ('e_zonal', tests.active_employee('Karim Zonal', '101', tests.id('hub_a1'), '01711000101', '1010101010', 40000, tests.id('zonal_a'))),
 ('e_mgr',   tests.active_employee('Sohel Manager', '102', tests.id('hub_a1'), '01711000102', '1020101010', 25000, tests.id('hub_mgr'))),
 ('e_staff', tests.active_employee('Rahim Rider', '103', tests.id('hub_a1'), '01711000103', '1030101010', 15000, tests.id('rider_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
create function tests.td() returns date language sql stable security definer set search_path = '' as $$ select private.wf_today() $$;
create function tests.snap(p_emp text) returns text language sql stable security definer set search_path = '' as
  $$ select id::text from public.wf_pending_snapshots where employee_id = tests.id(p_emp) order by id desc limit 1 $$;

-- staff submits, locked after approval
select tests.login(tests.id('rider_login'));
select tests.ok((public.wf_pending_today(7, tests.td()) ->> 'approved')::boolean = false, 'a new count is not approved');
select tests.logout();

-- the hub manager sees who is who
select tests.login(tests.id('hub_mgr'));
select tests.ok((public.wf_pending_hub_today(tests.id('hub_a1')) ->> 'can_review')::boolean
  and (select (r ->> 'is_self')::boolean from jsonb_array_elements(public.wf_pending_hub_today(tests.id('hub_a1')) -> 'rows') r where r ->> 'name' = 'Sohel Manager'),
  'the manager can review and sees which row is their own');
select public.wf_pending_manager_save(tests.id('hub_a1'), tests.id('e_staff'), tests.td(), tests.snap('e_staff')::bigint, null, null, false);
select tests.logout();

select tests.login(tests.id('rider_login'));
select tests.ok((public.wf_pending_today() ->> 'approved')::boolean, 'the staff member sees the approval');
select tests.ok((public.wf_pending_today(7, tests.td()) ->> 'count')::integer = 7, 'the same count again changes nothing');
select tests.throws(format('select public.wf_pending_today(10, %L)', tests.td()), 'an approved count cannot be changed by the staff member', '22023');
select tests.logout();

-- the manager sends the approved count back, then the staff member corrects it
select tests.login(tests.id('hub_mgr'));
select public.wf_pending_manager_save(tests.id('hub_a1'), tests.id('e_staff'), tests.td(), tests.snap('e_staff')::bigint, null, 'গণনা ভুল', true);
select tests.logout();
select tests.login(tests.id('rider_login'));
select tests.ok((public.wf_pending_today() ->> 'return_reason') = 'গণনা ভুল' and not (public.wf_pending_today() ->> 'approved')::boolean, 'a returned count shows its reason');
select tests.ok((public.wf_pending_today(10, tests.td()) ->> 'count')::integer = 10, 'after the return the staff member can submit a new count');
select tests.ok((select count(*) from jsonb_array_elements(public.wf_pending_own_month(date_trunc('month', tests.td()::timestamp)::date)) r where (r ->> 'count')::integer = 10) = 1,
  'the staff member sees their own month of pending counts (latest per day)');
select tests.throws($$select public.wf_pending_own_month(date '2020-01-01')$$, 'an old month is refused', '22023');
select tests.logout();

-- the manager's own count: nobody can approve it by themselves, the zonal manager can
select tests.login(tests.id('hub_mgr'));
select public.wf_pending_today(4, tests.td());
select tests.throws(format('select public.wf_pending_manager_save(%L, %L, %L, %s, null, null, false)', tests.id('hub_a1'), tests.id('e_mgr'), tests.td(), tests.snap('e_mgr')),
  'a manager cannot approve their own count', '42501');
select tests.logout();

select tests.login(tests.id('zonal_a'));
select tests.ok((public.wf_pending_hub_today(tests.id('hub_a1')) ->> 'can_review')::boolean and not (public.wf_pending_hub_today(tests.id('hub_a1')) ->> 'can_edit')::boolean,
  'the zonal manager can review but not edit');
select tests.throws(format('select public.wf_pending_manager_save(%L, %L, %L, null, 5, %L, false)', tests.id('hub_a1'), tests.id('e_staff'), tests.td(), 'x'),
  'the zonal manager cannot enter a count for someone', '42501');
select public.wf_pending_manager_save(tests.id('hub_a1'), tests.id('e_mgr'), tests.td(), tests.snap('e_mgr')::bigint, null, null, false);
select tests.ok((select (r ->> 'approved')::boolean from jsonb_array_elements(public.wf_pending_hub_today(tests.id('hub_a1')) -> 'rows') r where r ->> 'name' = 'Sohel Manager'),
  'the zonal manager approved the hub manager''s count');
select tests.throws(format('select public.wf_pending_manager_save(%L, %L, %L, %s, null, null, false)', tests.id('hub_a1'), tests.id('e_mgr'), tests.td(), tests.snap('e_mgr')),
  'a decided count cannot be approved twice', '40001');
select tests.logout();

-- other zones stay out of reach
select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.wf_pending_manager_save(%L, %L, %L, %s, null, null, false)', tests.id('hub_b1'), tests.id('e_staff'), tests.td(), tests.snap('e_staff')),
  'a zonal manager cannot review a hub of another zone', '42501');
select tests.logout();
rollback;
