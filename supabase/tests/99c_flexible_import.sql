-- Old staff import: only ID, name, position, hub, salary columns; names instead of codes;
-- custom fields; referrer; create missing hubs/positions; Super Admin works alone.
begin;
select tests.fixture();
select tests.hr_fixture();
-- a custom profile field to import into
insert into public.employee_field_sections (code, name) values ('extra', 'Extra') on conflict do nothing;
insert into public.employee_custom_fields (section_id, code, label, field_type, options)
select id, 'blood_group', 'Blood group', 'dropdown', '[{"value":"o_pos","label":"O+"},{"value":"a_pos","label":"A+"}]' from public.employee_field_sections where code = 'extra';
update public.hubs set name_bn = 'হাব এ১' where id = tests.id('hub_a1');

select tests.login(tests.id('super'));
insert into public.employee_import_batches (file_name) values ('old_staff.xlsx');
insert into tests.ids select 'b2', id from public.employee_import_batches where file_name = 'old_staff.xlsx';
insert into public.employee_import_rows (batch_id, row_number, raw)
select tests.id('b2'), n, r::jsonb from (values
 (1, '{"ID":"101","Name":"Old Rider","Post":"Rider","Hub":"Hub A1","Basic":"12,000","Transport":"1500","Commission":"500","Blood":"O+"}'),
 (2, '{"ID":"102","Name":"Old Hub Lead","Post":"Team Lead","Hub":"হাব এ১","Basic":"20000","Ref":"101"}'),
 (3, '{"ID":"103","Name":"New Hub Person","Post":"Rider","Hub":"Gurudaspur","Basic":"11000"}'),
 (4, '{"ID":"104","Name":"Bad Blood","Post":"Rider","Hub":"Hub A1","Blood":"Z-"}'),
 (5, '{"ID":"105","Name":"","Post":"Rider","Hub":"Hub A1"}')
) v(n, r);

select public.hr_validate_import(tests.id('b2'),
  '{"ID":"employee_code","Name":"full_name","Post":"position_name","Hub":"hub_name","Basic":"basic_salary","Transport":"transport_allowance","Commission":"commission","Blood":"cf:blood_group","Ref":"reference_code"}');
select tests.ok((select status from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 1) = 'valid',
  'row with only ID, name, position name, hub name and salary is valid');
select tests.ok((select data ->> 'basic_salary' from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 1) = '12000',
  'thousand separators removed from money');
select tests.ok((select data -> 'cf:blood_group' from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 1) = '"o_pos"',
  'dropdown label converted to its value');
select tests.ok((select 'Unknown position: Team Lead' = any(errors) from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 2),
  'unknown position named');
select tests.ok((select data ? '_hub' from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 2),
  'hub found by its Bangla name');
select tests.ok((select 'Unknown hub: Gurudaspur' = any(errors) from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 3),
  'unknown hub named');
select tests.ok((select 'Invalid value for Blood' = any(errors) from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 4),
  'value outside the dropdown flagged');
select tests.ok((select 'Missing full_name' = any(errors) from public.employee_import_rows where batch_id = tests.id('b2') and row_number = 5),
  'name still required');
select tests.ok((select count(*) from public.hr_import_missing(tests.id('b2'))) = 2, 'missing list: one hub, one position');

select tests.throws(format('select public.hr_import_create_missing(%L, null, null)', tests.id('b2')), 'new hubs need a zone', '22023');
select public.hr_import_create_missing(tests.id('b2'), tests.id('zone_b'), null);
select tests.ok(exists (select 1 from public.hubs where name = 'Gurudaspur' and zone_id = tests.id('zone_b')), 'missing hub created in the chosen zone');
select tests.ok(exists (select 1 from public.positions where name = 'Team Lead'), 'missing position created');

select public.hr_validate_import(tests.id('b2'),
  '{"ID":"employee_code","Name":"full_name","Post":"position_name","Hub":"hub_name","Basic":"basic_salary","Transport":"transport_allowance","Commission":"commission","Blood":"cf:blood_group","Ref":"reference_code"}');
select tests.ok((select valid_rows = 3 and error_rows = 2 from public.employee_import_batches where id = tests.id('b2')), 'after creating: 3 valid, 2 errors');

-- Super Admin may verify own batch (company with one admin)
select public.hr_verify_import(tests.id('b2'));
select tests.ok((public.hr_commit_import(tests.id('b2'), true) ->> 'activated')::int = 3, 'three old staff imported as active');
select tests.ok((select e.status = 'active' and p.name = 'Rider' and h.name = 'Hub A1' from public.employees e
                 join public.positions p on p.id = e.position_id join public.hubs h on h.id = e.hub_id where e.employee_code = '101'),
  'position and hub linked by name');
select tests.ok((select c.basic_salary = 12000 and c.transport_allowance = 1500 and c.commission = 500 and c.status = 'approved'
                 from public.employee_compensation c join public.employees e on e.id = c.employee_id where e.employee_code = '101'),
  'salary, transport and commission saved');
select tests.ok((select v.value = '"o_pos"' from public.employee_custom_field_values v join public.employees e on e.id = v.employee_id where e.employee_code = '101'),
  'custom field value saved');
select tests.ok((select r.employee_code = '101' from public.employees e join public.employees r on r.id = e.referred_by_employee_id where e.employee_code = '102'),
  'referrer linked by Employee ID');
select tests.ok(not exists (select 1 from public.employee_compensation c join public.employees e on e.id = c.employee_id where e.employee_code = '104'),
  'invalid row not imported');

-- other HR person still needs the two-person rule
select tests.login(tests.id('hr'));
insert into public.employee_import_batches (file_name) values ('hr_batch.xlsx');
insert into tests.ids select 'b3', id from public.employee_import_batches where file_name = 'hr_batch.xlsx';
insert into public.employee_import_rows (batch_id, row_number, raw) values (tests.id('b3'), 1, '{"Name":"X Person","Hub":"A1"}');
select public.hr_validate_import(tests.id('b3'), '{"Name":"full_name","Hub":"hub_code"}');
select tests.throws(format('select public.hr_verify_import(%L)', tests.id('b3')), 'HR uploader still cannot verify own import', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select * from public.hr_import_missing(%L)', tests.id('b2')), 'others cannot read the missing list', '42501');
rollback;
