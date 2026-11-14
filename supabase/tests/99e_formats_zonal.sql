-- Export/import formats, hub-wise staff summary, giving an Employee ID to imported staff.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('a1', tests.active_employee('Hub A1 Rider', '401', tests.id('hub_a1'), '01711000401', '4010101010')),
  ('a2', tests.active_employee('Hub A2 Rider', '402', tests.id('hub_a2'), '01711000402', '4020202020')),
  ('b1', tests.active_employee('Hub B1 Rider', '403', tests.id('hub_b1'), '01711000403', '4030303030'));
-- someone imported without an ID waits as an applicant
select tests.login(tests.id('super'));
select tests.ok(public.hr_start_application('No Id Person', '01711000404', tests.id('hub_a1'), null, null) is not null, 'import-style applicant created');
insert into tests.ids select 'noid', id from public.employees where full_name = 'No Id Person';

-- ---------- formats ----------
select tests.login(tests.id('super'));
select tests.ok((select count(*) from public.employee_formats) = 2, 'two starting formats');
select tests.ok((select is_default from public.employee_formats where name = 'Standard staff list'), 'one of them is the default');
insert into public.employee_formats (name, name_bn, purpose, columns) values
  ('Bank file', 'ব্যাংক ফাইল', 'export', '[{"field":"employee_code","label":"ID"},{"field":"full_name","label":"Name"},{"field":"basic_salary","label":"Basic"}]');
select tests.ok(exists (select 1 from public.employee_formats where name = 'Bank file'), 'super admin adds a company format');
select tests.throws($$insert into public.employee_formats (name, columns) values ('Bad', '[{"field":"no_such_field","label":"X"}]')$$,
  'unknown column refused', '22023');
select tests.throws($$insert into public.employee_formats (name, columns) values ('Bad2', '[{"field":"full_name"}]')$$,
  'a column without a heading is refused', '22023');
select tests.throws($$insert into public.employee_formats (name, columns) values ('Bad3', '[{"field":"full_name","label":"A"},{"field":"full_name","label":"B"}]')$$,
  'the same column twice is refused', '22023');
select tests.throws($$insert into public.employee_formats (name, columns) values ('Bad4', '[]')$$,
  'a format needs at least one column', '23514');
update public.employee_formats set is_default = true where name = 'Bank file';
select tests.ok((select count(*) from public.employee_formats where is_default and zone_id is null and purpose = 'export') = 1,
  'only one default per purpose');

select tests.login(tests.id('zonal_a'));
insert into public.employee_formats (zone_id, name, columns) values
  (tests.id('zone_a'), 'Zone A list', '[{"field":"full_name","label":"Name"},{"field":"mobile","label":"Mobile"}]');
select tests.ok(exists (select 1 from public.employee_formats where name = 'Zone A list'), 'zonal manager adds a format for own zone');
select tests.throws($$insert into public.employee_formats (name, columns) values ('Company try', '[{"field":"full_name","label":"N"}]')$$,
  'zonal manager cannot add a company-wide format', '42501');
select tests.throws(format($$insert into public.employee_formats (zone_id, name, columns) values (%L, 'Zone B try', '[{"field":"full_name","label":"N"}]')$$, tests.id('zone_b')),
  'zonal manager cannot add a format for another zone', '42501');

-- ---------- export ----------
select tests.login(tests.id('hr'));
select tests.ok(jsonb_array_length(public.hr_export_rows(array['employee_code','full_name','hub_name'])) >= 3, 'HR exports the staff list');
select tests.ok((public.hr_export_rows(array['employee_code','full_name']) -> 0 ->> 'employee_code') = '401', 'rows come ordered by Employee ID');
select tests.ok((select count(*) from jsonb_array_elements(public.hr_export_rows(array['full_name'], tests.id('zone_a'))) x) = 3,
  'zone filter works');
select tests.ok((select count(*) from jsonb_array_elements(public.hr_export_rows(array['full_name'], null, tests.id('hub_a1'))) x) = 2,
  'hub filter works');
select tests.throws($$select public.hr_export_rows(array['salary_secret'])$$, 'unknown export column refused', '22023');
select tests.throws($$select public.hr_export_rows('{}'::text[])$$, 'export needs at least one column', '22023');
select tests.ok((public.hr_export_rows(array['employee_code','nid_number']) -> 0 ->> 'nid_number') = '4010101010',
  'HR with NID rights sees the NID column');
select tests.logout();
select tests.ok(exists (select 1 from public.audit_logs where action = 'export' and table_name = 'employees'),
  'exporting private details is written to the audit log');

select tests.login(tests.id('hub_mgr'));
select tests.ok((public.hr_export_rows(array['employee_code','nid_number']) -> 0 ->> 'nid_number') is null,
  'hub manager gets no NID even when the column is asked for');
select tests.ok((select count(*) from jsonb_array_elements(public.hr_export_rows(array['full_name'])) x) = 2,
  'hub manager only exports their own hub');

-- ---------- hub-wise summary ----------
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) from public.hr_hub_staff_summary()) = 2, 'zonal manager sees both hubs of their zone');
select tests.ok((select active from public.hr_hub_staff_summary() where hub_id = tests.id('hub_a1'))
                = (select count(*) from public.employees where hub_id = tests.id('hub_a1') and status = 'active' and archived_at is null),
  'the hub active count matches the staff list');
select tests.ok((select applicant from public.hr_hub_staff_summary() where hub_id = tests.id('hub_a1'))
                = (select count(*) from public.employees where hub_id = tests.id('hub_a1') and status = 'applicant' and archived_at is null),
  'waiting applicants are counted');
select tests.ok((select by_position from public.hr_hub_staff_summary() where hub_id = tests.id('hub_a1')) <> '{}'::jsonb,
  'the hub shows how many staff are in each position');
-- counts must not multiply when a hub has staff in several positions
select tests.ok((select sum(c)::int from (select (jsonb_each_text(by_position)).value::int c
                   from public.hr_hub_staff_summary() where hub_id = tests.id('hub_a1')) p)
                = (select count(*) from public.employees e join public.positions po on po.id = e.position_id
                    where e.hub_id = tests.id('hub_a1') and e.status = 'active' and e.archived_at is null),
  'the per-position numbers add up to the active staff who have a position');
select tests.ok((select total from public.hr_hub_staff_summary() where hub_id = tests.id('hub_a1'))
                = (select count(*) from public.employees where hub_id = tests.id('hub_a1') and archived_at is null),
  'the hub total counts each person once, however many positions the hub uses');
select tests.ok(not exists (select 1 from (select jsonb_object_keys(by_position) k
                   from public.hr_hub_staff_summary()) x where x.k = '-' or x.k is null),
  'staff without a position are left out of the position list instead of showing a dash');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) from public.hr_hub_staff_summary()) = 1, 'hub manager sees only their hub');

-- ---------- giving an Employee ID to imported staff ----------
-- the importer puts applications straight into "submitted", as hr_commit_import does
select tests.logout();
update public.employee_applications set status = 'submitted', submitted_by = tests.id('super'), submitted_at = now()
 where employee_id = tests.id('noid');
select tests.login(tests.id('super'));
select tests.ok(array_length(public.hr_next_employee_codes(3), 1) = 3, 'next free IDs suggested');
select tests.ok((public.hr_next_employee_codes(1))[1] = '404', 'the first free ID follows the highest used one');
select public.hr_approve_application(tests.id('noid'), '404', 'Imported staff');
select tests.ok((select employee_code = '404' and status = 'active' from public.employees where id = tests.id('noid')),
  'a super admin may approve their own submission, so the ID is given');
select tests.ok(exists (select 1 from public.employee_status_history where employee_id = tests.id('noid') and to_status = 'active'),
  'the change is kept in the history');

-- others still need a second person
select tests.login(tests.id('hr'));
select tests.ok(public.hr_start_application('Second Person Test', '01711000407', tests.id('hub_a1'), null, null) is not null, 'HR opens an application');
insert into tests.ids select 'hrapp', id from public.employees where full_name = 'Second Person Test';
select tests.logout();
update public.employee_applications set status = 'submitted', submitted_by = tests.id('hr'), submitted_at = now()
 where employee_id = tests.id('hrapp');
select tests.login(tests.id('hr'));
select tests.throws(format('select public.hr_approve_application(%L, %L)', tests.id('hrapp'), '408'),
  'HR still cannot approve their own submission', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.hr_next_employee_codes(2)$$, 'hub manager cannot ask for IDs', '42501');

rollback;
