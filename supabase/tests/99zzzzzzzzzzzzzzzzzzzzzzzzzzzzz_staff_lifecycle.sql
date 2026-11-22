-- Staff lifecycle: the hub manager asks (left the job / new staff), the zonal manager decides; every approval writes a file.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
insert into t values
  ('emp',   tests.active_employee('Leaver One', '81', tests.id('hub_a1'), '01711000081', '1234567881')),
  ('mover', tests.active_employee('Mover Two', '82', tests.id('hub_a1'), '01711000082', '1234567882')),
  ('other', tests.active_employee('Other Zone', '83', tests.id('hub_b1'), '01711000083', '1234567883'));
insert into public.employee_formats (name, purpose, columns, is_default) values
  ('Company list', 'both', '[{"field":"employee_code","label":"Employee ID"},{"field":"full_name","label":"Name"},{"field":"hub_name","label":"Hub"}]', true);

-- ---------- hub manager: "left the job" ----------
select tests.login(tests.id('hub_mgr'));
insert into t select 'leave', public.hr_staff_leave_request((select v from t where k = 'emp'), 'Went abroad');
select tests.ok((select status = 'submitted' and kind = 'id_inactive' and data ->> 'reason' = 'Went abroad'
                   from public.hr_requests where id = (select v from t where k = 'leave')),
  'the hub manager''s request waits as submitted');
select tests.ok((select status = 'active' from public.employees where id = (select v from t where k = 'emp')),
  'the person stays active until the zonal manager decides');
select tests.throws(format($$select public.hr_staff_leave_request(%L, 'again')$$, (select v from t where k = 'emp')),
  'a second request for the same person is refused', 'P0001');
select tests.throws(format($$select public.hr_staff_leave_request(%L, '  ')$$, (select v from t where k = 'mover')),
  'a reason is required', '22023');
select tests.throws(format($$select public.hr_staff_leave_request(%L, 'x')$$, (select v from t where k = 'other')),
  'a person of another hub is refused', '42501');
select tests.throws(format($$select public.hr_staff_leave_request(%L, 'x', null, 'terminated')$$, (select v from t where k = 'mover')),
  'a hub manager cannot dismiss directly', '42501');
select tests.throws(format($$select public.hr_request_decide(%L, true)$$, (select v from t where k = 'leave')),
  'a hub manager cannot approve', '42501');
select tests.throws(format($$select public.hr_staff_transfer(%L, %L, current_date, 'x')$$, (select v from t where k = 'mover'), tests.id('hub_a2')),
  'a hub manager cannot transfer', '42501');
select tests.ok((select jsonb_array_length(public.hr_request_inbox() -> 'rows') = 0), 'the inbox is empty for a hub manager');
select tests.logout();

select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('zonal_a')
                  and link = '/app/zonal/requests?id=' || (select v from t where k = 'leave')),
  'the zonal manager is told, with a link to the inbox');

-- ---------- zonal manager: inbox, reject, approve ----------
select tests.login(tests.id('zonal_a'));
select tests.ok((select jsonb_array_length(i -> 'rows') = 1 and (i -> 'rows' -> 0 ->> 'employee_name') = 'Leaver One'
                    and (i -> 'rows' -> 0 -> 'accounts' ->> 'last_salary')::numeric = 17500
                    and (i -> 'rows' -> 0 ->> 'own')::boolean = false
                   from public.hr_request_inbox() i),
  'the inbox shows the request with the final accounts');
select tests.throws(format($$select public.hr_request_decide(%L, false, ' ')$$, (select v from t where k = 'leave')),
  'rejecting needs a note', '22023');
select public.hr_request_decide((select v from t where k = 'leave'), true, 'ok', '{"exit_type":"resigned"}');
select tests.logout();

select tests.ok((select status = 'resigned' and status_since = current_date from public.employees where id = (select v from t where k = 'emp')),
  'approving marks the person resigned');
select tests.ok((select count(*) = 1 from public.employee_status_history where employee_id = (select v from t where k = 'emp')
                  and from_status = 'active' and to_status = 'resigned' and reason like '%Went abroad%'),
  'the status history keeps the change and the reason');
select tests.ok((select count(*) = 1 from public.employee_assignments where employee_id = (select v from t where k = 'emp') and change_type = 'exit')
            and not exists (select 1 from public.employee_assignments where employee_id = (select v from t where k = 'emp') and effective_to is null),
  'an exit assignment is written and nothing stays open');
select tests.ok((select status = 'done' and decided_by = tests.id('zonal_a') from public.hr_requests where id = (select v from t where k = 'leave')),
  'the request is done');
select tests.ok((select kind = 'exit' and employee_status = 'resigned' and (accounts ->> 'unpaid_salary') is not null
                    and heads ->> 1 = 'Employee ID' and cells ->> 1 = '81' and cells ->> 2 = 'Leaver One'
                    and heads @> '["Mobile", "Position", "Last Working Day", "Net Payable"]'::jsonb
                    and jsonb_array_length(heads) = jsonb_array_length(cells)
                   from public.hr_record_files where request_id = (select v from t where k = 'leave')),
  'the exit file follows the company layout and carries the final accounts');
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('hub_mgr')
                  and link = '/app/manager/staff?tab=pending' and title like 'অনুমোদিত:%' and priority = 'high'),
  'the hub manager is told about the approval');

select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 0 from public.hr_record_files), 'the archive is closed to a hub manager');
select tests.logout();
select tests.login(tests.id('zonal_a'));
select tests.ok((select count(*) = 1 from public.hr_record_files), 'the zonal manager sees the file');
select tests.throws(format($$select public.hr_request_decide(%L, true)$$, (select v from t where k = 'leave')),
  'a finished request cannot be decided again', 'P0001');
select tests.logout();

-- ---------- new staff: two different people ----------
select tests.login(tests.id('hub_mgr'));
insert into t select 'join', public.hr_staff_join_request(tests.id('hub_a1'), tests.id('pos_rider'),
  '{"full_name":"New Rider","mobile":"01711000091","joining_date":"2026-11-01","basic_salary":"12000","nid_number":"1234567891"}');
select tests.throws(format($$select public.hr_staff_join_request(%L, %L, '{"full_name":"Twin","mobile":"01711000091"}')$$, tests.id('hub_a1'), tests.id('pos_rider')),
  'the same mobile is not taken twice', '23505');
select tests.throws(format($$select public.hr_staff_join_request(%L, %L, '{"full_name":"Far","mobile":"01711000092"}')$$, tests.id('hub_b1'), tests.id('pos_rider')),
  'a hub manager cannot add staff to another hub', '42501');
select tests.logout();
insert into t select 'newemp', employee_id from public.hr_requests where id = (select v from t where k = 'join');
select tests.ok((select e.status = 'applicant' and e.hub_id = tests.id('hub_a1') and a.status = 'submitted' and a.submitted_by = tests.id('hub_mgr')
                   from public.employees e join public.employee_applications a on a.employee_id = e.id where e.id = (select v from t where k = 'newemp')),
  'the new person is an applicant with a submitted application');

select tests.login(tests.id('zonal_a'));
select tests.ok((select (i ->> 'next_code') = '84' and (r ->> 'kind') = 'id_create' and jsonb_array_length(r -> 'missing') > 0
                   from public.hr_request_inbox() i, jsonb_array_elements(i -> 'rows') r),
  'the inbox shows the new-staff request, what is still missing and the next ID');
select public.hr_request_decide((select v from t where k = 'join'), true);
select tests.logout();
select tests.ok((select status = 'active' and employee_code = '84' and joining_date = '2026-11-01' from public.employees where id = (select v from t where k = 'newemp')),
  'approving gives the Employee ID and makes the person active');
select tests.ok((select count(*) = 1 from public.employee_assignments where employee_id = (select v from t where k = 'newemp') and change_type = 'joining' and effective_to is null)
            and (select status = 'approved' and reviewed_by = tests.id('zonal_a') from public.employee_applications where employee_id = (select v from t where k = 'newemp'))
            and (select status = 'approved' from public.employee_compensation where employee_id = (select v from t where k = 'newemp')),
  'the joining assignment, the application and the salary are approved');
select tests.ok((select kind = 'joining' and cells ->> 1 = '84' from public.hr_record_files where request_id = (select v from t where k = 'join')),
  'the joining file is written');

-- the sender can never approve their own new-staff request
select tests.login(tests.id('zonal_a'));
insert into t select 'join2', public.hr_staff_join_request(tests.id('hub_a2'), tests.id('pos_rider'), '{"full_name":"Own Pick","mobile":"01711000093"}');
select tests.throws(format($$select public.hr_request_decide(%L, true)$$, (select v from t where k = 'join2')),
  'the two-person rule holds for a zonal manager''s own request', '42501');
select tests.logout();
select tests.login(tests.id('hr'));
select public.hr_request_decide((select v from t where k = 'join2'), false, 'Not needed now');
select tests.logout();
select tests.ok((select e.status = 'rejected' and a.status = 'rejected' and r.status = 'rejected'
                   from public.hr_requests r join public.employees e on e.id = r.employee_id
                   join public.employee_applications a on a.employee_id = e.id where r.id = (select v from t where k = 'join2')),
  'a rejected new-staff request closes the application too');

-- ---------- transfer and direct exit by the zonal manager ----------
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.hr_staff_transfer(%L, %L, current_date, 'x')$$, (select v from t where k = 'mover'), tests.id('hub_b1')),
  'a transfer into another zone is refused', '42501');
select tests.throws(format($$select public.hr_staff_transfer(%L, %L, current_date, 'x')$$, (select v from t where k = 'mover'), tests.id('hub_a1')),
  'a transfer to the same hub is refused', '22023');
select public.hr_staff_transfer((select v from t where k = 'mover'), tests.id('hub_a2'), current_date, 'A2 needs a rider');
select tests.logout();
select tests.ok((select hub_id = tests.id('hub_a2') from public.employees where id = (select v from t where k = 'mover')),
  'the zonal manager moves the person to the new hub');
select tests.ok((select count(*) = 1 from public.employee_assignments where employee_id = (select v from t where k = 'mover')
                  and change_type = 'transfer' and hub_id = tests.id('hub_a2') and effective_to is null)
            and (select count(*) = 1 from public.employee_assignments where employee_id = (select v from t where k = 'mover') and effective_to is not null),
  'the old assignment is closed and the new one opened');
select tests.ok((select f.kind = 'transfer' and f.hub_id = tests.id('hub_a1') and f.to_hub_id = tests.id('hub_a2') and r.status = 'done'
                    and f.cells @> '["Hub A1", "Hub A2", "A2 needs a rider"]'::jsonb
                   from public.hr_record_files f join public.hr_requests r on r.id = f.request_id where f.employee_id = (select v from t where k = 'mover')),
  'the transfer file names both hubs and the request is done');

select tests.login(tests.id('zonal_a'));
select public.hr_staff_leave_request((select v from t where k = 'mover'), 'Misconduct', current_date, 'terminated');
select tests.logout();
select tests.ok((select status = 'terminated' from public.employees where id = (select v from t where k = 'mover')),
  'the zonal manager''s own button finishes a dismissal in one step');
select tests.ok((select count(*) = 4 from public.hr_record_files), 'four files in the archive: exit, joining, transfer, exit');
rollback;
