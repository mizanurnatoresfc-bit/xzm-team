-- স্টাফ প্যানেল অডিট (21 Nov): the database fixes in 20261121000300_staff_panel_audit_fixes.sql.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('pa1', tests.active_employee('Audit Rider', '801', tests.id('hub_a1'), '01711000801', '8010101010', 15000, tests.id('rider_login'))),
  ('pa2_login', tests.make_user('rider-pa2@test.local', 'Audit Rider Two')),
  ('pa3_login', tests.make_user('rider-pa3@test.local', 'Audit Rider Three'));
insert into tests.ids values
  ('pa2', tests.active_employee('Audit Rider Two', '802', tests.id('hub_a1'), '01711000802', '8020101010', 15000, tests.id('pa2_login'))),
  ('pa3', tests.active_employee('Audit Rider Three', '803', tests.id('hub_a1'), '01711000803', '8030101010', 15000, tests.id('pa3_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
select tests.grant_role(tests.id('pa2_login'), 'rider', 'hub', null, tests.id('hub_a1'));

-- 1. approving a mark when the day is already on the register as leave: works, and the leave stays
select tests.login(tests.id('rider_login'));
select public.att_self_mark('present');
select tests.logout();
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('pa1'), (now() at time zone 'Asia/Dhaka')::date, 'leave');
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.att_self_decide(array(select id from public.attendance_self_marks where employee_id = tests.id('pa1')), true) = 1,
  'a mark can be approved when the day is already on the register as leave');
select tests.ok((select status from public.attendance_records where employee_id = tests.id('pa1')) = 'leave', 'the leave day is not overwritten');
select tests.ok((select status = 'approved' and decided_as is null and decide_note is not null from public.attendance_self_marks where employee_id = tests.id('pa1')),
  'the mark is closed with no attendance word and a note saying the register was left as it is');

-- 2. "not coming": the reason is capped, and sending the same waiting mark again does not page the managers again
select tests.login(tests.id('pa2_login'));
select tests.throws($$select public.att_self_mark('absent', repeat('ক', 501))$$, 'a reason over 500 characters is refused', '22023');
select public.att_self_mark('absent', 'জ্বর');
select tests.logout();
create temp table pa_n on commit drop as
  select count(*) as n from public.notifications where profile_id = tests.id('hub_mgr') and title like 'আজ আসবেন না%';
select tests.login(tests.id('pa2_login'));
select public.att_self_mark('absent', 'জ্বর, ডাক্তার দেখাতে যাচ্ছি');
select public.att_self_mark('absent', 'জ্বর, ডাক্তার দেখাতে যাচ্ছি');
select tests.logout();
select tests.ok((select count(*) from public.notifications where profile_id = tests.id('hub_mgr') and title like 'আজ আসবেন না%') = (select n from pa_n),
  'sending the same waiting "not coming" again does not notify the manager again');
select tests.login(tests.id('pa2_login'));
select public.att_self_mark('present');
select tests.logout();
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('hub_mgr') and title like 'হাজিরা অনুমোদন বাকি%' and body like 'Audit Rider Two%'),
  'changing from "not coming" to "present" does notify the manager');

-- 3. staff panel layout: a role left on the standard page gives the whole page
select tests.login(tests.id('super'));
select public.role_staff_sections_save((select id from public.roles where code = 'rider'), '["attendance"]'::jsonb);
select tests.login(tests.id('pa2_login'));
select tests.ok(public.staff_panel_sections() = '["attendance"]'::jsonb, 'one arranged role: its sections');
select tests.logout();
select tests.grant_role(tests.id('pa2_login'), 'accountant', 'global');
select tests.login(tests.id('pa2_login'));
select tests.ok(public.staff_panel_sections() is null, 'a second role on the standard page: the whole standard page');
select tests.login(tests.id('super'));
select public.role_staff_sections_save((select id from public.roles where code = 'accountant'), '["bill"]'::jsonb);
select tests.login(tests.id('pa2_login'));
select tests.ok(public.staff_panel_sections() = '["attendance","bill"]'::jsonb, 'both roles arranged: merged');
select tests.logout();
update public.user_roles set revoked_at = now()
 where user_id = tests.id('pa2_login') and role_id = (select id from public.roles where code = 'accountant');
select tests.login(tests.id('pa2_login'));
select tests.ok(public.staff_panel_sections() = '["attendance"]'::jsonb, 'a revoked role no longer shapes the layout');

-- 4. my_profile_gaps: only the caller's own line
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 1 and bool_and(employee_id = tests.id('pa1')) from public.my_profile_gaps()), 'a staff member gets only their own profile check');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) <= 1 from public.my_profile_gaps()), 'a manager gets at most their own line, not the whole hub');
select tests.logout();
select tests.throws($$set local role anon; select * from public.my_profile_gaps()$$, 'anon cannot call my_profile_gaps', '42501');

-- 5. zone access follows an ACTIVE employee record (pa3 has a login but no role)
select tests.login(tests.id('pa3_login'));
select tests.ok(private.in_zone_group(tests.id('zone_a')), 'an active employee is in their zone''s group');
select tests.ok(public.zone_contacts() is not null, 'an active employee gets the zonal manager contact');
select tests.logout();
update public.employees set status = 'resigned' where id = tests.id('pa3');
select tests.login(tests.id('pa3_login'));
select tests.ok(not private.in_zone_group(tests.id('zone_a')), 'after leaving, they are out of the zone group');
select tests.ok(public.zone_contacts() is null, 'after leaving, no zonal manager phone numbers');

select tests.logout();
rollback;
