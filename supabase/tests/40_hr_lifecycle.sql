-- HR: application → review → activation, sensitive data, transfer, status, archive, profile builder.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('mgr_emp', tests.active_employee('Manager Emp', 'XZ-00001', tests.id('hub_a1'), '01711000001', '1234567890'));

-- ---------- Page 1: hub manager starts an application in own hub ----------
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'app1', public.hr_start_application('Abdul Mannan', '01711245688', tests.id('hub_a1'), tests.id('dept_ops'), tests.id('pos_rider'));
select tests.ok(tests.id('app1') is not null, 'hub manager can start an application in own hub');
select tests.throws(format($$select public.hr_start_application('X Y', '01711999999', %L)$$, tests.id('hub_b1')),
                    'hub manager cannot start an application for another hub', '42501');
select tests.throws($$select public.hr_start_application('X Y', '12345', tests.id('hub_a1'))$$,
                    'invalid mobile number rejected', '23514');
select tests.throws(format($$insert into public.employees (full_name, hub_id, status, employee_code) values ('Sneaky', %L, 'active', 'XZ-99999')$$, tests.id('hub_a1')),
                    'cannot insert an employee directly as active with an ID', '42501');

select tests.throws(format($$insert into public.employee_sensitive (employee_id, nid_number) values (%L, '12AB')$$, tests.id('app1')),
                    'invalid NID rejected', '23514');
update public.employees set joining_date = current_date, emergency_contact_phone = '01811000000',
       reporting_manager_id = tests.id('mgr_emp') where id = tests.id('app1');
select tests.throws(format($$insert into public.employee_sensitive (employee_id, nid_number, date_of_birth) values (%L, '4512889022', current_date - interval '15 years')$$, tests.id('app1')),
                    'under-age date of birth rejected', '23514');
insert into public.employee_sensitive (employee_id, nid_number, date_of_birth, father_name, permanent_address)
  values (tests.id('app1'), '4512889022', '1998-02-14', 'Abdul Karim', 'Natore Sadar, Natore');
select tests.ok((select nid_number from public.employee_sensitive where employee_id = tests.id('app1')) = '4512889022',
                'preparer can read NID of own open draft');

-- ---------- Page 3: missing fields shown, submit blocked ----------
select tests.ok(public.hr_application_missing_fields(tests.id('app1')) @> array['basic_salary','document:nid_front','document:photo'],
                'missing fields list salary and required documents');
select tests.throws(format('select public.hr_submit_application(%L)', tests.id('app1')),
                    'incomplete application cannot be submitted', '23514');

-- required custom field configured by HR appears in missing list
select tests.login(tests.id('hr'));
insert into public.employee_field_sections (code, name) values ('extra', 'Extra information');
insert into public.employee_custom_fields (section_id, code, label, field_type, is_required, options)
  select id, 'blood_test', 'Blood group', 'dropdown', true,
         '[{"value":"a_pos","label":"A+"},{"value":"o_pos","label":"O+"}]' from public.employee_field_sections where code = 'extra';
insert into public.employee_custom_fields (section_id, code, label, field_type, validation)
  select id, 'bike_cc', 'Motorbike engine (cc)', 'number', '{"min":50,"max":500}' from public.employee_field_sections where code = 'extra';
select tests.login(tests.id('hub_mgr'));
select tests.throws($$insert into public.employee_custom_fields (section_id, code, label, field_type)
                      select id, 'hack', 'Hack', 'text' from public.employee_field_sections limit 1$$,
                    'hub manager cannot configure profile fields', '42501');
select tests.ok('field:blood_test' = any(public.hr_application_missing_fields(tests.id('app1'))),
                'new required custom field appears automatically in missing fields');

select tests.throws(format($$insert into public.employee_custom_field_values (employee_id, field_id, value)
                            select %L, id, '"b_neg"' from public.employee_custom_fields where code = 'blood_test'$$, tests.id('app1')),
                    'dropdown value outside options rejected', '23514');
insert into public.employee_custom_field_values (employee_id, field_id, value)
  select tests.id('app1'), id, '"o_pos"' from public.employee_custom_fields where code = 'blood_test';
select tests.throws(format($$insert into public.employee_custom_field_values (employee_id, field_id, value)
                            select %L, id, '900' from public.employee_custom_fields where code = 'bike_cc'$$, tests.id('app1')),
                    'number outside validation range rejected', '23514');

-- documents + proposed salary
insert into public.employee_documents (employee_id, doc_type, storage_path, file_name, mime_type, size_bytes)
select tests.id('app1'), t, 'employee/' || tests.id('app1') || '/' || t || '.jpg', t || '.jpg', 'image/jpeg', 120000
from unnest(array['nid_front','nid_back','photo']) t;
select tests.throws(format($$insert into public.employee_documents (employee_id, doc_type, storage_path, file_name, mime_type, size_bytes)
                            values (%L, 'cv', 'other/path.pdf', 'cv.pdf', 'application/pdf', 1000)$$, tests.id('app1')),
                    'document path must belong to the employee folder', '23514');
select tests.throws(format($$insert into public.employee_documents (employee_id, doc_type, storage_path, file_name, mime_type, size_bytes)
                            values (%L, 'cv', 'employee/%s/cv.exe', 'cv.exe', 'application/x-msdownload', 1000)$$, tests.id('app1'), tests.id('app1')),
                    'disallowed file type rejected', '23514');
select public.hr_propose_compensation(tests.id('app1'), current_date, 16000, 2000, 0, '[{"code":"meal","amount":1500}]', 'Joining salary');
-- the ID-create format also needs a reference, an alternative mobile and the blood group
update public.employees set reference_info = 'Rahim, ID 12' where id = tests.id('app1');
insert into public.employee_custom_field_values (employee_id, field_id, value)
  select tests.id('app1'), id, case code when 'alt_mobile' then '"01911000000"'::jsonb else '"o_pos"'::jsonb end
  from public.employee_custom_fields where code in ('alt_mobile', 'blood_group');
select tests.ok(cardinality(public.hr_application_missing_fields(tests.id('app1'))) = 0, 'application complete after all fields');
select public.hr_submit_application(tests.id('app1'));
select tests.ok((select status from public.employee_applications where employee_id = tests.id('app1')) = 'submitted', 'application submitted to HR');

-- after submission the preparer loses edit access and NID visibility
update public.employees set full_name = 'Changed' where id = tests.id('app1');
select tests.ok(tests.row_count(format('select * from public.employee_sensitive where employee_id = %L', tests.id('app1'))) = 0,
                'hub manager cannot read NID after submission');
select tests.throws(format($$select public.hr_approve_application(%L, 'XZ-10421')$$, tests.id('app1')),
                    'hub manager cannot approve applications', '42501');

-- ---------- HR review and activation ----------
select tests.login(tests.id('hr'));
select tests.ok((select full_name from public.employees where id = tests.id('app1')) = 'Abdul Mannan', 'preparer edit after submission had no effect');
select tests.throws(format($$select public.hr_approve_application(%L, 'abc')$$, tests.id('app1')), 'Employee ID must match company format', '23514');
select tests.throws(format($$select public.hr_approve_application(%L, 'XZ-00001')$$, tests.id('app1')), 'duplicate Employee ID rejected', '23505');
select public.hr_approve_application(tests.id('app1'), 'xz-10421', 'Documents checked');
select tests.ok((select status = 'active' and employee_code = 'XZ-10421' from public.employees where id = tests.id('app1')),
                'approval activates employee with HR-entered ID');
select tests.ok((select count(*) = 1 from public.employee_assignments where employee_id = tests.id('app1') and change_type = 'joining' and effective_to is null),
                'joining assignment recorded');
select tests.ok((select status = 'approved' and approved_by = tests.id('hr') from public.employee_compensation where employee_id = tests.id('app1')),
                'proposed salary approved with the application');
select tests.throws(format($$select public.hr_approve_application(%L, 'XZ-10422')$$, tests.id('app1')),
                    'an approved application cannot be approved twice', 'P0001');

-- protected columns cannot be changed directly
select tests.throws(format($$update public.employees set status = 'inactive' where id = %L$$, tests.id('app1')),
                    'status cannot be changed by direct update', '42501');
select tests.throws(format($$update public.employees set hub_id = %L where id = %L$$, tests.id('hub_b1'), tests.id('app1')),
                    'hub cannot be changed without the transfer workflow', '42501');

-- ---------- sensitive data ----------
select tests.ok(tests.row_count(format('select * from public.employee_sensitive where employee_id = %L', tests.id('app1'))) = 0,
                'even HR cannot read NID table directly (only audited reveal)');
select tests.throws(format($$select * from public.hr_reveal_sensitive(%L, '')$$, tests.id('app1')), 'reveal needs a reason', '22023');
select tests.ok((select nid_number from public.hr_reveal_sensitive(tests.id('app1'), 'Bank account opening')) = '4512889022',
                'HR can reveal NID with a reason');
select tests.logout();
select tests.ok(exists (select 1 from public.audit_logs where action = 'VIEW_SENSITIVE' and record_id = tests.id('app1')::text
                        and actor_id = tests.id('hr') and reason = 'Bank account opening'), 'NID reveal is audited');
select tests.ok(not exists (select 1 from public.audit_logs where table_name = 'employee_sensitive' and (new_data::text like '%4512889022%' or old_data::text like '%4512889022%')),
                'audit log never stores the NID value');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select * from public.hr_reveal_sensitive(%L, 'curious')$$, tests.id('app1')),
                    'hub manager cannot reveal NID', '42501');
select tests.ok(public.hr_masked_nid(tests.id('app1')) = '•••• 9022', 'hub manager sees masked NID only');
select tests.ok(tests.row_count(format($$select * from public.employee_documents where employee_id = %L and doc_type like 'nid%%'$$, tests.id('app1'))) = 0,
                'hub manager cannot see NID images');
select tests.ok(tests.row_count(format($$select * from public.employee_documents where employee_id = %L and doc_type = 'photo'$$, tests.id('app1'))) = 1,
                'hub manager can see the photo');
select tests.login(tests.id('auditor'));
select tests.throws(format($$select * from public.hr_reveal_sensitive(%L, 'audit')$$, tests.id('app1')),
                    'auditor cannot reveal NID either', '42501');

-- ---------- transfer ----------
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.hr_transfer_employee(%L, %L, %L, %L, null, current_date, 'Need staff')$$,
                           tests.id('app1'), tests.id('hub_a2'), tests.id('dept_ops'), tests.id('pos_rider')),
                    'zonal manager without HR edit cannot transfer', '42501');
select tests.login(tests.id('hr'));
select tests.throws(format($$select public.hr_transfer_employee(%L, %L, %L, %L, null, current_date, '')$$,
                           tests.id('app1'), tests.id('hub_b1'), tests.id('dept_ops'), tests.id('pos_rider')),
                    'transfer needs a reason', '22023');
select public.hr_transfer_employee(tests.id('app1'), tests.id('hub_b1'), tests.id('dept_ops'), tests.id('pos_rider'), null,
                                   current_date + 1, 'Bogura needs riders');
select tests.ok((select hub_id = tests.id('hub_b1') and zone_id = tests.id('zone_b') from public.employees where id = tests.id('app1')),
                'transfer moves employee and zone follows hub');
select tests.ok((select count(*) = 2 and count(*) filter (where effective_to is null and hub_id = tests.id('hub_b1')) = 1
                 from public.employee_assignments where employee_id = tests.id('app1')), 'transfer keeps assignment history');
select tests.logout();
select tests.throws(format($$update public.employee_assignments set hub_id = %L where employee_id = %L$$, tests.id('hub_a2'), tests.id('app1')),
                    'assignment history cannot be rewritten even by owner', 'P0001');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count(format('select * from public.employees where id = %L', tests.id('app1'))) = 0,
                'old hub manager no longer sees transferred employee');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count(format('select * from public.employees where id = %L', tests.id('app1'))) = 1,
                'new hub manager sees transferred employee');

-- ---------- status changes, login deactivation, archive ----------
select tests.logout();
update public.employees set profile_id = tests.id('rider_login') where id = tests.id('app1');
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_b1'));
select tests.login(tests.id('rider_login'));
select tests.ok(tests.row_count('select * from public.employees') = 1, 'employee sees own record via linked login');
select tests.throws(format($$select public.hr_change_status(%L, 'resigned', current_date, 'self')$$, tests.id('app1')),
                    'employee cannot change own status', '42501');
select tests.login(tests.id('hr'));
select tests.throws(format($$select public.hr_archive_employee(%L, 'cleanup')$$, tests.id('app1')),
                    'active employee cannot be archived', 'P0001');
select public.hr_change_status(tests.id('app1'), 'resigned', current_date + 30, 'Personal reasons');
select tests.ok((select status = 'resigned' from public.employees where id = tests.id('app1')), 'resignation recorded');
select tests.ok((select status = 'inactive' from public.profiles where id = tests.id('rider_login')), 'resigned employee login is deactivated');
select tests.throws(format($$select public.hr_change_status(%L, 'inactive', current_date, 'x')$$, tests.id('app1')),
                    'invalid status transition rejected', 'P0001');
select tests.ok((select count(*) = 2 from public.employee_status_history where employee_id = tests.id('app1')),
                'status history kept (joining + resignation)');
select public.hr_archive_employee(tests.id('app1'), 'Left the company');
select tests.throws(format($$update public.employees set full_name = 'X' where id = %L$$, tests.id('app1')),
                    'archived employee is read-only', '42501');
select tests.logout();
select tests.throws(format('delete from public.employees where id = %L', tests.id('app1')), 'employees can never be deleted', 'P0001');

-- ---------- profile builder history ----------
select tests.login(tests.id('hr'));
update public.employee_custom_fields set archived_at = now(), archive_reason = 'No longer collected' where code = 'blood_test';
select tests.ok((select count(*) = 1 from public.employee_custom_field_values v join public.employee_custom_fields f on f.id = v.field_id
                 where f.code = 'blood_test'), 'archived field keeps its historical values');
select tests.logout();
select tests.throws(format($$update public.employee_custom_field_values set value = '"a_pos"' where employee_id = %L$$, tests.id('app1')),
                    'archived field values cannot be changed', 'P0001');
select tests.throws($$update public.employee_custom_fields set field_type = 'text' where code = 'blood_test'$$,
                    'field type cannot change after values exist', 'P0001');
select tests.ok(not ('field:blood_test' = any(coalesce((select missing from public.hr_missing_information() where employee_id = tests.id('mgr_emp')), '{}'))),
                'archived required field no longer counts as missing');

-- ---------- return / reject path ----------
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'app2', public.hr_start_application('Second Person', '01722000002', tests.id('hub_a1'));
select tests.login(tests.id('hr'));
select tests.throws(format($$select public.hr_reject_application(%L, 'no')$$, tests.id('app2')),
                    'draft cannot be rejected before submission', 'P0001');
select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count(format('select * from public.employees where id = %L', tests.id('app2'))) = 0,
                'other hub manager cannot see the draft');

rollback;
