-- HR: Excel bulk import — mapping, validation, verification, commit, bulk ID assignment.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('existing', tests.active_employee('Existing', 'XZ-00050', tests.id('hub_a1'), '01711000050', '5555555555'));

select tests.ok(private.parse_date_bd('14/02/1998') = '1998-02-14' and private.parse_date_bd('1998-02-14') = '1998-02-14',
                'dates accepted as DD/MM/YYYY and YYYY-MM-DD');
select tests.ok(private.parse_date_bd('31/02/2026') is null and private.parse_date_bd('2026-13-01') is null and private.parse_date_bd('12-03-2020') is null,
                'impossible or ambiguous dates rejected');

select tests.login(tests.id('hr'));
insert into public.employee_import_batches (file_name) values ('riders_nov.xlsx');
insert into tests.ids select 'batch', id from public.employee_import_batches;
insert into public.employee_import_rows (batch_id, row_number, raw)
select tests.id('batch'), n, r::jsonb from (values
 (1, '{"ID":"XZ-00101","Name":"Good Coded","Phone":"01711000101","DOB":"14/02/1998","NID":"1010101010","Hub":"A1","Dept":"OPS","Pos":"RIDER","Join":"01/10/2026","Basic":"15000"}'),
 (2, '{"ID":"","Name":"Good Applicant","Phone":"01711000102","DOB":"1999-01-01","NID":"1020202020","Hub":"A2","Dept":"OPS","Pos":"RIDER","Join":"2026-10-05","Basic":"14000","Transport":"1500"}'),
 (3, '{"ID":"","Name":"Bad Date","Phone":"01711000103","DOB":"31/02/1997","NID":"1030303030","Hub":"A1","Dept":"OPS","Pos":"RIDER","Join":"01/10/2026","Basic":"15000"}'),
 (4, '{"ID":"","Name":"Dup NID","Phone":"01711000104","DOB":"01/01/1990","NID":"1030303030","Hub":"A1","Dept":"OPS","Pos":"RIDER","Join":"01/10/2026","Basic":"15000"}'),
 (5, '{"ID":"","Name":"Existing NID","Phone":"01711000105","DOB":"01/01/1990","NID":"5555555555","Hub":"A1","Dept":"OPS","Pos":"RIDER","Join":"01/10/2026","Basic":"abc"}'),
 (6, '{"ID":"","Name":"No Hub","Phone":"01711000106","DOB":"01/01/1990","NID":"1060606060","Hub":"ZZ","Dept":"OPS","Pos":"RIDER","Join":"01/10/2026","Basic":"15000"}'),
 (7, '{"ID":"XZ-00050","Name":"Taken ID","Phone":"01711000107","DOB":"01/01/1990","NID":"1070707070","Hub":"A1","Dept":"OPS","Pos":"RIDER","Join":"","Basic":"15000"}')
) v(n, r);

select tests.throws(format($$select public.hr_validate_import(%L, '{"Name":"full_name"}')$$, tests.id('batch')),
                    'validation refuses a mapping without required columns', '22023');
select tests.throws(format($$select public.hr_validate_import(%L, '{"Name":"salary_secret"}')$$, tests.id('batch')),
                    'validation refuses unknown target fields', '22023');
select public.hr_validate_import(tests.id('batch'),
  '{"ID":"employee_code","Name":"full_name","Phone":"mobile","DOB":"date_of_birth","NID":"nid_number","Hub":"hub_code",
    "Dept":"department_code","Pos":"position_code","Join":"joining_date","Basic":"basic_salary","Transport":"transport_allowance"}');
select tests.ok((select valid_rows = 2 and error_rows = 5 from public.employee_import_batches where id = tests.id('batch')),
                'validation: 2 valid rows, 5 rows with errors');
select tests.ok((select 'Invalid date_of_birth' = any(errors) from public.employee_import_rows where row_number = 3), 'impossible date of birth flagged');
select tests.ok((select 'Duplicate of another row in this file' = any(errors) from public.employee_import_rows where row_number = 4), 'duplicate NID inside the file flagged (both rows marked for HR to decide)');
select tests.ok((select errors @> array['NID already exists','Invalid basic_salary'] from public.employee_import_rows where row_number = 5),
                'existing NID and bad salary flagged');
select tests.ok((select 'Unknown hub: ZZ' = any(errors) from public.employee_import_rows where row_number = 6), 'unknown hub flagged');
select tests.ok((select errors @> array['employee_code already exists'] from public.employee_import_rows where row_number = 7),
                'used Employee ID flagged (joining date is optional for imports)');
select tests.throws(format($$insert into public.employee_import_rows (batch_id, row_number, raw) values (%L, 99, '{}')$$, tests.id('batch')),
                    'rows cannot be added after validation', 'P0001');

select tests.throws(format('select public.hr_verify_import(%L)', tests.id('batch')), 'uploader cannot verify own import', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count('select * from public.employee_import_batches') = 0, 'hub manager cannot see HR import batches');
select tests.login(tests.id('hr2'));
select public.hr_verify_import(tests.id('batch'));
select tests.throws(format('select public.hr_commit_import(%L)', tests.id('batch')),
                    'commit refuses while invalid rows exist unless skipping is explicit', 'P0001');
select tests.ok((public.hr_commit_import(tests.id('batch'), true) ->> 'activated')::int = 1, 'commit imports valid rows only');
select tests.ok((select status = 'active' from public.employees where employee_code = 'XZ-00101'), 'row with Employee ID imported as active');
select tests.ok((select e.status = 'applicant' and a.status = 'submitted' from public.employees e join public.employee_applications a on a.employee_id = e.id
                 where e.full_name = 'Good Applicant'), 'row without Employee ID waits for HR ID assignment');
select tests.ok((select count(*) = 5 from public.employee_import_rows where batch_id = tests.id('batch') and status = 'skipped'),
                'invalid rows are kept as skipped (error report), not silently dropped');
select tests.ok(not exists (select 1 from public.employees where full_name in ('Bad Date','Dup NID','Existing NID','No Hub','Taken ID')),
                'no invalid row created an employee');

-- bulk ID assignment: all-or-nothing
select tests.throws(format($$select public.hr_bulk_assign_ids('[{"employee_id":"%s","employee_code":"XZ-00050"}]')$$,
                           (select id from public.employees where full_name = 'Good Applicant')),
                    'bulk assignment fails as a whole on a used ID', '23505');
select tests.ok((select status = 'applicant' from public.employees where full_name = 'Good Applicant'), 'nothing assigned after failed bulk run');
select tests.ok(public.hr_bulk_assign_ids(format('[{"employee_id":"%s","employee_code":"XZ-00102"}]',
                (select id from public.employees where full_name = 'Good Applicant'))::jsonb) = 1, 'bulk ID assignment activates applicants');
select tests.ok((select c.status = 'approved' from public.employee_compensation c join public.employees e on e.id = c.employee_id
                 where e.employee_code = 'XZ-00102'), 'imported salary approved at ID assignment');

rollback;
