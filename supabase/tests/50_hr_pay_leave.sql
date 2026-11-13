-- HR: compensation approval, attendance, leave, salary sheets (Net Payable formula), dashboard.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('e1', tests.active_employee('Rider One', 'XZ-00011', tests.id('hub_a1'), '01711000011', '1111111111', 15000, tests.id('rider_login'))),
  ('e2', tests.active_employee('Rider Two', 'XZ-00012', tests.id('hub_a1'), '01711000012', '2222222222', 18000)),
  ('eb', tests.active_employee('Rider B',   'XZ-00021', tests.id('hub_b1'), '01711000021', '3333333333', 14000));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

-- ---------- compensation: maker ≠ checker, history ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.hr_propose_compensation(%L, current_date, 99999, 0, 0)$$, tests.id('e1')),
                    'hub manager cannot propose salary changes', '42501');
select tests.throws(format($$update public.employee_compensation set basic_salary = 99999 where employee_id = %L$$, tests.id('e1')),
                    'salary cannot be edited directly', '42501');
select tests.login(tests.id('hr'));
insert into tests.ids select 'raise1', public.hr_propose_compensation(tests.id('e2'), date_trunc('month', current_date)::date, 20000, 2500, 800,
                                                                 '[{"code":"mobile_bill","amount":500},{"code":"advance_recovery","amount":1000}]', 'Annual increment');
select tests.throws(format('select public.hr_approve_compensation(%L)', tests.id('raise1')),
                    'proposer cannot approve own salary change', '42501');
select tests.throws(format($$select public.hr_propose_compensation(%L, current_date, 1, 0, 0)$$, tests.id('e2')),
                    'only one pending proposal per employee', 'P0001');
select tests.login(tests.id('hr2'));
select public.hr_approve_compensation(tests.id('raise1'));
select tests.ok((select count(*) = 2 and count(*) filter (where effective_to is null) = 1
                 from public.employee_compensation where employee_id = tests.id('e2') and status = 'approved'),
                'approved raise closes the previous salary and keeps history');
select tests.logout();
select tests.throws(format($$update public.employee_compensation set basic_salary = 1 where id = %L$$, tests.id('raise1')),
                    'approved salary record is frozen even for the owner', 'P0001');

-- ---------- attendance ----------
select tests.login(tests.id('hub_mgr'));
insert into public.attendance_records (employee_id, work_date, status)
select tests.id('e1'), d, 'present' from generate_series(date_trunc('month', current_date)::date, current_date - 1, '1 day') d;
insert into public.attendance_records (employee_id, work_date, status) values (tests.id('e2'), current_date, 'absent');
select tests.ok((select count(*) from public.attendance_records where employee_id = tests.id('e1')) = current_date - date_trunc('month', current_date)::date,
                'hub manager records attendance for own hub');
select tests.throws(format($$insert into public.attendance_records (employee_id, work_date, status) values (%L, current_date, 'present')$$, tests.id('eb')),
                    'hub manager cannot record attendance for another hub', '42501');
select tests.throws(format($$insert into public.attendance_records (employee_id, work_date, status) values (%L, current_date + 1, 'present')$$, tests.id('e2')),
                    'no attendance for future dates', '22023');
select tests.throws(format($$update public.attendance_records set status = 'present' where employee_id = %L and work_date = current_date$$, tests.id('e2')),
                    'attendance correction needs a note', '22023');
update public.attendance_records set status = 'late', note = 'Arrived 10:40, traffic' where employee_id = tests.id('e2') and work_date = current_date;
select tests.throws(format($$insert into public.attendance_records (employee_id, work_date, status) values (%L, current_date - 40, 'leave')$$, tests.id('e2')),
                    'leave cannot be typed into attendance directly', '42501');

-- ---------- leave ----------
select tests.login(tests.id('rider_login'));
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason)
select tests.id('e1'), id, current_date + 3, current_date + 4, 'Family wedding' from public.leave_types where code = 'casual';
select tests.ok(tests.row_count('select * from public.leave_requests') = 1, 'employee can request own leave');
select tests.throws($$insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason)
                      select tests.id('e1'), id, current_date + 4, current_date + 6, 'Overlap' from public.leave_types where code = 'sick'$$,
                    'overlapping leave rejected', '23P01');
select tests.throws($$insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason)
                      select tests.id('e2'), id, current_date + 3, current_date + 3, 'For a colleague' from public.leave_types where code = 'casual'$$,
                    'employee cannot request leave for someone else', '42501');
select tests.throws($$select public.hr_decide_leave((select id from public.leave_requests limit 1), true)$$,
                    'employee cannot approve own leave', '42501');
select tests.login(tests.id('hub_mgr'));
select public.hr_decide_leave((select id from public.leave_requests where employee_id = tests.id('e1')), true, 'Enjoy');
select tests.ok((select status from public.leave_requests where employee_id = tests.id('e1')) = 'approved', 'hub manager approved leave');
-- past-dated leave creates attendance rows
select tests.logout();
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, created_by)
select tests.id('e2'), id, current_date - 60, current_date - 58, 'Fever', tests.id('hr') from public.leave_types where code = 'sick';
select tests.login(tests.id('hub_mgr'));
select public.hr_decide_leave((select id from public.leave_requests where employee_id = tests.id('e2')), true);
select tests.ok((select count(*) = 3 from public.attendance_records where employee_id = tests.id('e2') and status = 'leave' and source = 'leave'),
                'approved past leave fills attendance as leave');
select tests.logout();
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, created_by)
select tests.id('e2'), id, current_date + 20, current_date + 31, 'Long trip', tests.id('hr') from public.leave_types where code = 'casual';
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.hr_decide_leave((select id from public.leave_requests where reason = 'Long trip'), true)$$,
                    'leave beyond yearly quota is refused', 'P0001');
select tests.throws($$select public.hr_decide_leave((select id from public.leave_requests where reason = 'Long trip'), false, '')$$,
                    'rejecting leave needs a reason', '22023');
select tests.ok((select remaining from public.hr_leave_balance(tests.id('e1'), extract(year from current_date)::int) where leave_type = 'Casual leave') = 8,
                'leave balance shows remaining casual leave');

-- ---------- salary sheet ----------
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'sheet', public.hr_generate_salary_sheet(current_date, tests.id('hub_a1'));
select tests.ok((select count(*) from public.salary_sheet_lines where sheet_id = tests.id('sheet')) = 2,
                'sheet includes only active employees of the hub');
select tests.ok((select net_payable = 15000 + 2000 + 500 + 0 - 0 from public.salary_sheet_lines where employee_id = tests.id('e1') and sheet_id = tests.id('sheet')),
                'Net Payable = Basic + Transport + Commission + Allowances - Deductions (e1)');
select tests.ok((select basic_salary = 20000 and other_allowances = 500 and deductions = 1000 and net_payable = 20000 + 2500 + 800 + 500 - 1000
                 from public.salary_sheet_lines where employee_id = tests.id('e2') and sheet_id = tests.id('sheet')),
                'sheet uses the newly APPROVED salary with its allowances and deductions (e2)');
select tests.ok((select present_days = current_date - date_trunc('month', current_date)::date from public.salary_sheet_lines where employee_id = tests.id('e1') and sheet_id = tests.id('sheet')),
                'attendance days copied to the sheet');
select tests.throws(format($$update public.salary_sheet_lines set basic_salary = 50000, adjustment_note = 'x' where sheet_id = %L$$, tests.id('sheet')),
                    'basic salary cannot be edited on the sheet', '42501');
select tests.throws(format($$update public.salary_sheet_lines set commission = 3000 where employee_id = %L$$, tests.id('e1')),
                    'commission adjustment needs a note', '22023');
update public.salary_sheet_lines set commission = 3200, adjustment_note = '320 deliveries x 10' where employee_id = tests.id('e1');
select tests.ok((select net_payable = 15000 + 2000 + 3200 from public.salary_sheet_lines where employee_id = tests.id('e1')),
                'net payable recalculates after commission adjustment');
select tests.throws(format($$select public.hr_generate_salary_sheet(current_date, %L)$$, tests.id('hub_a1')),
                    'only one active sheet per hub and month', '23505');
select tests.throws(format($$select public.hr_generate_salary_sheet((current_date + interval '2 months')::date, %L)$$, tests.id('hub_a1')),
                    'no sheet for a future month', '22023');
select public.hr_submit_salary_sheet(tests.id('sheet'));
update public.salary_sheet_lines set deductions = 10, adjustment_note = 'x' where sheet_id = tests.id('sheet');
select tests.logout();
select tests.ok((select sum(deductions) = 1000 from public.salary_sheet_lines where sheet_id = tests.id('sheet')),
                'submitted sheet lines are locked for the preparer');
select tests.throws(format($$update public.salary_sheet_lines set deductions = 10 where sheet_id = %L$$, tests.id('sheet')),
                    'submitted sheet lines are locked even for the owner', 'P0001');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.hr_approve_salary_sheet(%L)', tests.id('sheet')),
                    'hub manager cannot approve salary sheet', '42501');
select tests.throws(format($$update public.attendance_records set status = 'absent', note = 'fix' where employee_id = %L and work_date = current_date - 1$$, tests.id('e1')),
                    'attendance is locked once the month sheet is submitted', 'P0001');
select tests.login(tests.id('acct_mgr'));
select public.hr_approve_salary_sheet(tests.id('sheet'));
select tests.ok((select status = 'approved' and approved_by = tests.id('acct_mgr') from public.salary_sheets where id = tests.id('sheet')),
                'accounts manager approved the salary sheet');
select tests.throws(format($$select public.hr_cancel_salary_sheet(%L, 'oops')$$, tests.id('sheet')),
                    'approved sheet cannot be cancelled', 'P0001');

-- employee sees own approved salary line only
select tests.login(tests.id('rider_login'));
select tests.ok(tests.row_count('select * from public.salary_sheet_lines') = 1, 'employee sees only own salary line');
select tests.ok(tests.row_count('select * from public.employee_compensation') = 1, 'employee sees only own salary structure');

-- sheet with missing approved salary cannot be submitted
select tests.logout();
insert into public.employees (employee_code, full_name, mobile, hub_id, joining_date, status) values ('XZ-00031', 'No Salary', '01711000031', tests.id('hub_b1'), current_date - 30, 'active');
select tests.login(tests.id('hub_b_mgr'));
insert into tests.ids select 'sheet_b', public.hr_generate_salary_sheet(current_date, tests.id('hub_b1'));
select tests.ok((select count(*) = 1 from public.salary_sheet_lines where sheet_id = tests.id('sheet_b') and issue is not null),
                'employee without approved salary is flagged on the sheet');
select tests.throws(format('select public.hr_submit_salary_sheet(%L)', tests.id('sheet_b')),
                    'sheet with flagged lines cannot be submitted', '23514');

-- ---------- dashboard respects scope ----------
select tests.login(tests.id('hr'));
select tests.ok((public.hr_dashboard(current_date - 500, current_date) ->> 'active')::int = 4, 'HR dashboard counts all active employees');
select tests.login(tests.id('hub_mgr'));
select tests.ok((public.hr_dashboard(current_date - 500, current_date) ->> 'active')::int = 2, 'hub manager dashboard counts only own hub');
select tests.ok((public.hr_dashboard(current_date - 500, current_date) ->> 'new_joining')::int = 2, 'new joining counted in date range');

rollback;
