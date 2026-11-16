-- Pages a role sees, and the attendance days a hub writes down for comparison.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;
insert into tests.ids values ('e1', tests.active_employee('Alamin Sarker', '7982', tests.id('hub_a1'), '01711007982', '7982798201')),
  ('e2', tests.active_employee('Other Hub', '7983', tests.id('hub_b1'), '01711007983', '7983798301'));

-- ---------- the menu ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.my_menu() is null, 'a role without a list is not limited');
select tests.throws(format($$select public.role_menu_save(%L, array['/app/hub/team'])$$, (select id from public.roles where code = 'hub_manager')),
  'only a Super Admin sets the pages of a role', '42501');
select tests.login(tests.id('super'));
select tests.throws(format($$select public.role_menu_save(%L, array['/app/hub/team'])$$, (select id from public.roles where code = 'super_admin')),
  'the Super Admin role cannot be limited', '22023');
select tests.throws(format($$select public.role_menu_save(%L, array['https://x.test'])$$, (select id from public.roles where code = 'hub_manager')),
  'only pages of the app can be listed', '22023');
select public.role_menu_save((select id from public.roles where code = 'hub_manager'), array['/app/hub/team', '/app/accounts/khata']);
select tests.ok(public.my_menu() is null, 'the Super Admin stays unlimited');
select tests.ok((select menu = '["/app/hub/team", "/app/accounts/khata"]'::jsonb from public.role_menu_list() where code = 'hub_manager'), 'the list is kept with the role');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.my_menu() @> '["/app/hub/team"]'::jsonb and jsonb_array_length(public.my_menu()) = 2, 'the manager now gets only the listed pages');
select tests.login(tests.id('super'));
select public.role_menu_save((select id from public.roles where code = 'hub_manager'), null);
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.my_menu() is null, 'clearing the list removes the limit');

-- ---------- attendance days ----------
select tests.ok((select count(*) = 1 and bool_and(online_days is null) from public.att_days_list(tests.id('hub_a1'), '2026-11-01', '2026-11-15') where employee_code = '7982'),
  'the hub''s people are listed before anything is written');
select tests.throws(format($$select public.att_days_save(%L, '2026-11-01', '2026-11-15', '[{"employee_id":"%s","online_days":16,"register_days":15}]'::jsonb)$$, tests.id('hub_a1'), tests.id('e1')),
  'more days than the period has is refused', '22023');
select tests.throws(format($$select public.att_days_save(%L, '2026-11-01', '2026-11-15', '[{"employee_id":"%s","online_days":10,"register_days":10}]'::jsonb)$$, tests.id('hub_a1'), tests.id('e2')),
  'someone of another hub is refused', '22023');
select tests.throws(format($$select public.att_days_save(%L, '2026-11-01', '2026-11-15', '[{"employee_id":"%s","online_days":10,"register_days":10}]'::jsonb)$$, tests.id('hub_b1'), tests.id('e2')),
  'a manager cannot write for another hub', '42501');
select tests.ok(public.att_days_save(tests.id('hub_a1'), '2026-11-01', '2026-11-15', format('[{"employee_id":"%s","online_days":13,"register_days":15,"note":"দুই দিন অ্যাপ চলেনি"}]', tests.id('e1'))::jsonb) = 1,
  'the two counts are saved');
select public.att_days_save(tests.id('hub_a1'), '2026-11-01', '2026-11-15', format('[{"employee_id":"%s","online_days":15,"register_days":15}]', tests.id('e1'))::jsonb);
select tests.ok((select online_days = 15 and register_days = 15 and note is null and submitted_by_name is not null
  from public.att_days_list(tests.id('hub_a1'), '2026-11-01', '2026-11-15') where employee_code = '7982'), 'saving again replaces the counts of that period');
select tests.ok((select count(*) = 1 from public.attendance_day_counts), 'one row per person and period');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok((select count(*) = 0 from public.attendance_day_counts), 'another hub''s manager does not see them');
select tests.ok(not has_function_privilege('anon', 'public.att_days_save(uuid, date, date, jsonb)', 'execute') and not has_function_privilege('anon', 'public.my_menu()', 'execute'),
  'signed-out visitors cannot call the new functions');
rollback;
