-- স্টাফ প্যানেল arranged by the Super Admin, per role: who may set it, what is checked, what each person gets.
begin;
select tests.fixture();
select tests.hr_fixture();
select tests.grant_role(tests.id('rider_login'), 'rider', 'global');

-- nothing set: the standard page
select tests.login(tests.id('rider_login'));
select tests.ok(public.staff_panel_sections() is null, 'with nothing set, a rider gets the standard staff panel');

-- only a Super Admin may arrange it
select tests.throws($$select public.role_staff_sections_save((select id from public.roles where code = 'rider'), '["bill"]'::jsonb)$$,
  'a rider cannot arrange the staff panel', '42501');

select tests.login(tests.id('super'));
select tests.throws($$select public.role_staff_sections_save((select id from public.roles where code = 'rider'), '["bill","nope"]'::jsonb)$$,
  'an unknown section is refused', '22023');
select tests.throws($$select public.role_staff_sections_save((select id from public.roles where code = 'rider'), '["bill","bill"]'::jsonb)$$,
  'the same section twice is refused', '22023');
select public.role_staff_sections_save((select id from public.roles where code = 'rider'), '["attendance","accounts","bill"]'::jsonb);

select tests.login(tests.id('rider_login'));
select tests.ok(public.staff_panel_sections() = '["attendance","accounts","bill"]'::jsonb, 'the rider gets the sections in the order set');

-- two roles: a section shows when either role has it, earliest position first
select tests.logout();
select tests.grant_role(tests.id('rider_login'), 'accountant', 'global');
select tests.login(tests.id('super'));
select public.role_staff_sections_save((select id from public.roles where code = 'accountant'), '["people","accounts"]'::jsonb);
select tests.login(tests.id('rider_login'));
select tests.ok(public.staff_panel_sections() = '["attendance","people","accounts","bill"]'::jsonb, 'two roles merge, earliest position wins');

-- clearing goes back to the standard page
select tests.login(tests.id('super'));
select public.role_staff_sections_save((select id from public.roles where code = 'rider'), null);
select public.role_staff_sections_save((select id from public.roles where code = 'accountant'), null);
select tests.login(tests.id('rider_login'));
select tests.ok(public.staff_panel_sections() is null, 'cleared: the standard staff panel again');

select tests.logout();
rollback;
