-- Zone-level profile fields and referrals.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('ref', tests.active_employee('Referrer One', '301', tests.id('hub_a1'), '01711000301', '3010101010')),
  ('newbie', tests.active_employee('New Comer', '302', tests.id('hub_a1'), '01711000302', '3020202020')),
  ('b_emp', tests.active_employee('Zone B Person', '303', tests.id('hub_b1'), '01711000303', '3030303030'));
update public.employees set profile_id = tests.id('noroles') where id = tests.id('ref');   -- the referrer can sign in

-- ---------- zone fields ----------
select tests.login(tests.id('zonal_a'));
insert into public.employee_custom_fields (section_id, code, label, label_bn, field_type, zone_id)
select id, 'za_bike', 'Bike number', 'বাইক নম্বর', 'text', tests.id('zone_a') from public.employee_field_sections where code = 'zonal';
select tests.ok(exists (select 1 from public.employee_custom_fields where code = 'za_bike'), 'zonal manager adds a field for own zone');
select tests.throws($$insert into public.employee_custom_fields (section_id, code, label, field_type)
  select id, 'company_x', 'X', 'text' from public.employee_field_sections where code = 'other'$$,
  'zonal manager cannot add a company-wide field', '42501');
select tests.throws(format($$insert into public.employee_custom_fields (section_id, code, label, field_type, zone_id)
  select id, 'zb_x', 'X', 'text', %L from public.employee_field_sections where code = 'other'$$, tests.id('zone_b')),
  'zonal manager cannot add a field for another zone', '42501');
select tests.throws(format($$insert into public.employee_custom_fields (section_id, code, label, field_type, zone_id, is_required)
  select id, 'za_req', 'R', 'text', %L, true from public.employee_field_sections where code = 'zonal'$$, tests.id('zone_a')),
  'zone fields cannot be required', '23514');

select tests.login(tests.id('super'));
insert into public.employee_custom_field_values (employee_id, field_id, value)
select tests.id('newbie'), id, '"RAJ-1234"' from public.employee_custom_fields where code = 'za_bike';
select tests.ok(exists (select 1 from public.employee_custom_field_values v join public.employee_custom_fields f on f.id = v.field_id
                        where f.code = 'za_bike' and v.employee_id = tests.id('newbie')), 'value saved for a zone A employee');
select tests.throws(format($$insert into public.employee_custom_field_values (employee_id, field_id, value)
  select %L, id, '"X"' from public.employee_custom_fields where code = 'za_bike'$$, tests.id('b_emp')),
  'zone A field refused for a zone B employee', 'P0001');

-- ---------- referrals ----------
select tests.login(tests.id('hr'));
select tests.ok((select full_name from public.hr_lookup_employee('301')) = 'Referrer One', 'reference ID shows the name');
select public.hr_set_referrer(tests.id('newbie'), '301');
select tests.ok((select referred_by_employee_id from public.employees where id = tests.id('newbie')) = tests.id('ref'), 'referrer saved');
select tests.throws(format('select public.hr_set_referrer(%L, %L)', tests.id('ref'), '301'), 'nobody refers themselves', 'P0001');
select tests.throws(format('select public.hr_set_referrer(%L, %L)', tests.id('newbie'), '999999'), 'unknown reference ID refused', 'P0001');

-- the referrer sees in their own profile whom they brought
select tests.login(tests.id('noroles'));
select tests.ok(public.my_employee_id() = tests.id('ref'), 'signed-in staff finds own employee record');
select tests.ok((select count(*) from public.hr_referrals()) = 1 and (select full_name from public.hr_referrals()) = 'New Comer',
  'referrer sees the person they brought');
-- and keeps people in hand
insert into public.referral_prospects (referrer_id, full_name, mobile, position_id, area)
values (tests.id('ref'), 'Possible Rider', '+8801711000999', (select id from public.positions limit 1), 'Gurudaspur');
select tests.ok((select mobile from public.referral_prospects where full_name = 'Possible Rider') = '01711000999', 'mobile cleaned to local format');
select tests.throws(format($$insert into public.referral_prospects (referrer_id, full_name) values (%L, 'Not mine')$$, tests.id('newbie')),
  'cannot add prospects for someone else', '42501');
select tests.ok(tests.row_count('select * from public.referral_prospects') = 1, 'sees own prospect list');

-- managers of the area see it; others do not
select tests.login(tests.id('zonal_a'));
select tests.ok(tests.row_count('select * from public.referral_prospects') = 1, 'zonal manager of the zone sees the prospects');
select tests.ok((select brought from public.hr_referral_summary() where referrer_id = tests.id('ref')) = 1, 'summary counts people brought');
select tests.ok((select in_hand from public.hr_referral_summary() where referrer_id = tests.id('ref')) = 1, 'summary counts people in hand');
insert into public.referral_prospect_columns (zone_id, code, label, field_type) values (tests.id('zone_a'), 'has_bike', 'Has bike', 'text');
select tests.ok(exists (select 1 from public.referral_prospect_columns where code = 'has_bike'), 'zonal manager adds a column for own zone');
select tests.throws($$insert into public.referral_prospect_columns (code, label) values ('company_col', 'C')$$,
  'zonal manager cannot add a company-wide column', '42501');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count('select * from public.referral_prospects') = 0, 'manager of another zone sees nothing');
select tests.throws(format('select * from public.hr_referrals(%L)', tests.id('ref')), 'other zone cannot read the referral list', '42501');

rollback;
