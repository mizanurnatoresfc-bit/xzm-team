-- Zonal management: hub figures, dashboard + drill-down, data completion, visits & claims,
-- tasks, workforce planning (advisory only), reports.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values ('zonal_b', tests.make_user('zonal.b@test.local', 'Zonal B'));
select tests.grant_role(tests.id('zonal_b'), 'zonal_manager', 'zone', tests.id('zone_b'));
insert into tests.ids values
  ('emp_a1', tests.active_employee('Rider One',   'XZ-00011', tests.id('hub_a1'), '01711000011', '1234567811')),
  ('emp_a2', tests.active_employee('Rider Two',   'XZ-00012', tests.id('hub_a2'), '01711000012', '1234567812')),
  ('emp_b1', tests.active_employee('Rider Three', 'XZ-00013', tests.id('hub_b1'), '01711000013', '1234567813'));

-- Seven verified days per hub (as the owner): A1 overloaded, A2 light, B1 overloaded.
insert into public.hub_daily_metrics (hub_id, metric_date, pickup_count, delivery_count, pending_parcels, merchant_count,
                                      rider_count, rider_capacity, working_hours, cash_collected, expenses, status, verified_at)
select v.hub, d::date, v.pk, v.dl, v.pend, v.mer, v.riders, v.cap, v.hrs, v.cash, v.spent, 'verified', now()
from generate_series(current_date - 7, current_date - 1, interval '1 day') d
cross join (values
  (tests.id('hub_a1'), 300, 300, 500, 40, 8, 400, 80, 100000, 5000),
  (tests.id('hub_a2'),  50,  50,   0, 10, 6, 300, 40,  20000, 2000),
  (tests.id('hub_b1'), 300, 300, 500, 35, 8, 400, 80,  90000, 4000)
) as v(hub, pk, dl, pend, mer, riders, cap, hrs, cash, spent);

-- ---------- 1. Daily hub figures: entry, second-person verification, lock ----------
select tests.login(tests.id('hub_mgr'));
insert into public.hub_daily_metrics (hub_id, metric_date, pickup_count, delivery_count, rider_count, rider_capacity, working_hours)
  values (tests.id('hub_a1'), current_date, 120, 110, 8, 400, 64);
insert into tests.ids select 'metric_today', id from public.hub_daily_metrics
  where hub_id = tests.id('hub_a1') and metric_date = current_date;
select tests.ok(tests.id('metric_today') is not null, 'hub manager can enter figures for own hub');
select tests.throws(format($$insert into public.hub_daily_metrics (hub_id, metric_date) values (%L, current_date)$$, tests.id('hub_b1')),
                    'hub manager cannot enter figures for another hub', '42501');
select tests.throws(format($$insert into public.hub_daily_metrics (hub_id, metric_date) values (%L, current_date + 1)$$, tests.id('hub_a1')),
                    'figures for a future date are rejected', '23514');
select tests.throws(format($$insert into public.hub_daily_metrics (hub_id, metric_date, status) values (%L, current_date - 20, 'verified')$$, tests.id('hub_a1')),
                    'figures cannot be inserted as already verified', '42501');
select tests.throws(format('select public.zm_verify_hub_metric(%L)', tests.id('metric_today')),
                    'the person who entered figures cannot verify them', '42501');

select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count(format('select 1 from public.hub_daily_metrics where hub_id = %L', tests.id('hub_a1'))) = 0,
                'hub manager of another zone sees no figures of hub A1');
select tests.ok(tests.row_count('select 1 from public.hub_daily_metrics') = 7, 'hub manager sees only own hub figures');

select tests.login(tests.id('zonal_a'));
select public.zm_verify_hub_metric(tests.id('metric_today'));
select tests.ok((select status = 'verified' and verified_by = tests.id('zonal_a') from public.hub_daily_metrics where id = tests.id('metric_today')),
                'zonal manager verifies figures of a hub in own zone');
select tests.throws(format('select public.zm_verify_hub_metric(%L)', tests.id('metric_today')),
                    'figures cannot be verified twice', 'P0001');

select tests.login(tests.id('hub_mgr'));
select tests.throws(format('update public.hub_daily_metrics set pickup_count = 999 where id = %L', tests.id('metric_today')),
                    'verified figures are locked', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.zm_reopen_hub_metric(%L, ' ')$$, tests.id('metric_today')),
                    'reopening verified figures needs a reason', '22023');
select public.zm_reopen_hub_metric(tests.id('metric_today'), 'Delivery count mistyped');
select tests.login(tests.id('hub_mgr'));
update public.hub_daily_metrics set delivery_count = 115 where id = tests.id('metric_today');
select tests.ok((select delivery_count = 115 and status = 'submitted' from public.hub_daily_metrics where id = tests.id('metric_today')),
                'reopened figures can be corrected by the hub');

-- ---------- 2. Dashboard and the records behind each number ----------
select tests.login(tests.id('hr'));
select public.hr_transfer_employee(tests.id('emp_a2'), tests.id('hub_a1'), tests.id('dept_ops'), tests.id('pos_rider'), null,
                                   current_date, 'Workload at Hub A1');

select tests.login(tests.id('zonal_a'));
select tests.ok((public.zm_dashboard(tests.id('zone_a'), current_date - 7, current_date) -> 'workforce' ->> 'active')::int = 2,
                'dashboard counts active employees of own zone only');
select tests.ok((public.zm_dashboard(tests.id('zone_a'), current_date - 7, current_date) -> 'workforce' ->> 'transferred')::int = 1,
                'dashboard counts transfers in the period');
select tests.ok((public.zm_dashboard(tests.id('zone_a'), current_date - 7, current_date - 1) -> 'hubs' ->> 'pickups')::int = 2450,
                'dashboard pickup volume uses verified figures of the zone');
select tests.ok(tests.row_count(format($$select * from public.zm_workforce_details('active', %L, current_date - 7, current_date)$$, tests.id('zone_a'))) = 2,
                'clicking a statistic lists exactly the counted employees');
select tests.ok((select detail = 'Workload at Hub A1' and employee_id = tests.id('emp_a2')
                 from public.zm_workforce_details('transferred', tests.id('zone_a'), current_date - 7, current_date)),
                'transfer details show who moved and why');
select tests.ok(tests.row_count(format($$select * from public.zm_workforce_details('active', %L, current_date - 7, current_date)$$, tests.id('zone_b'))) = 0,
                'details of another zone are empty for a zonal manager');
select tests.throws(format('select public.zm_dashboard(%L, current_date - 7, current_date)', tests.id('zone_b')),
                    'zonal manager cannot open the dashboard of another zone', '42501');
select tests.throws('select public.zm_dashboard(null, current_date - 7, current_date)',
                    'company-wide dashboard needs a global grant', '42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.zm_dashboard(%L, current_date - 7, current_date)', tests.id('zone_a')),
                    'hub manager cannot open the zonal dashboard', '42501');
select tests.login(tests.id('super'));
select tests.ok((public.zm_dashboard(null, current_date - 7, current_date) -> 'workforce' ->> 'active')::int = 3,
                'super admin sees the company-wide dashboard');

-- ---------- 3. Employee data completion ----------
select tests.logout();
insert into public.employee_documents (employee_id, doc_type, storage_path, file_name, mime_type, size_bytes)
values (tests.id('emp_a1'), 'nid_front', 'employee/' || tests.id('emp_a1') || '/nid_front.jpg', 'nid_front.jpg', 'image/jpeg', 120000);

select tests.login(tests.id('zonal_a'));
select tests.ok(tests.row_count('select 1 from public.employee_documents') = 0,
                'zonal manager still cannot read NID images');
select tests.ok((select not ('nid_front' = any(missing)) and 'nid_back' = any(missing) and 'photo' = any(missing)
                        and 'signature' = any(missing) and 'cv' = any(missing)
                 from public.zm_data_completion(tests.id('zone_a')) where employee_id = tests.id('emp_a1')),
                'completion report knows an NID image is on file without exposing it');
select tests.ok((select total_checks = 11 and completion_pct = 45.5  -- + alternative mobile and blood group (ID-ready format)
                 from public.zm_data_completion(tests.id('zone_a')) where employee_id = tests.id('emp_a1')),
                'completion percentage is calculated from the required items');
select tests.ok(tests.row_count(format('select * from public.zm_data_completion(%L)', tests.id('zone_b'))) = 0,
                'completion report of another zone is empty');

select tests.logout();
insert into public.employee_field_sections (code, name) values ('extra', 'Extra information');
insert into public.employee_custom_fields (section_id, code, label, field_type, is_required, options)
  select id, 'blood_test', 'Blood group', 'dropdown', true, '[{"value":"o_pos","label":"O+"}]'
  from public.employee_field_sections where code = 'extra';
select tests.login(tests.id('zonal_a'));
select tests.ok((select total_checks = 12 and 'field:blood_test' = any(missing)
                 from public.zm_data_completion(tests.id('zone_a')) where employee_id = tests.id('emp_a1')),
                'a newly required profile field is counted automatically');
select tests.ok((public.zm_dashboard(tests.id('zone_a'), current_date - 7, current_date) -> 'data_completion' ->> 'incomplete')::int = 2,
                'dashboard shows how many employees have incomplete data');

-- ---------- 4. Hub visits and travel claims ----------
insert into public.hub_visits (hub_id, visit_date, purpose, distance_km, fuel_amount, meal_amount, transport_amount)
values (tests.id('hub_a1'), current_date - 2, 'Monthly hub inspection', 42.5, 850, 300, 0),
       (tests.id('hub_a2'), current_date - 1, 'Cash count check', 30, 600, 250, 100);
select tests.ok((select count(*) = 2 and sum(total_amount) = 2100 from public.hub_visits), 'zonal manager records visits with expenses');
select tests.throws(format($$insert into public.hub_visits (hub_id, visit_date, purpose) values (%L, current_date, 'Outside zone')$$, tests.id('hub_b1')),
                    'visit to a hub outside the zone is rejected', '42501');
select tests.throws(format($$insert into public.hub_visits (hub_id, visit_date, purpose) values (%L, current_date + 2, 'Future visit')$$, tests.id('hub_a1')),
                    'future visit date rejected', '23514');
select tests.throws(format($$insert into public.hub_visits (hub_id, visit_date, purpose, other_amount) values (%L, current_date, 'Other cost', 200)$$, tests.id('hub_a1')),
                    'other expenses need a description', '23514');
select tests.throws(format($$select public.zm_submit_claim(%L, 'weekly', current_date - 4, current_date)$$, tests.id('zone_a')),
                    'weekly claim must cover exactly 7 days', '22023');
select tests.throws(format($$select public.zm_submit_claim(%L, 'monthly', current_date - 6, current_date)$$, tests.id('zone_a')),
                    'monthly claim must cover one calendar month', '22023');
insert into tests.ids select 'claim1', public.zm_submit_claim(tests.id('zone_a'), 'weekly', current_date - 6, current_date);
select tests.ok((select visit_count = 2 and total_amount = 2100 and total_km = 72.5 and status = 'submitted'
                 from public.travel_claims where id = tests.id('claim1')),
                'weekly claim totals the visits of the period');
select tests.throws(format('update public.hub_visits set fuel_amount = 1 where hub_id = %L', tests.id('hub_a1')),
                    'visits inside a submitted claim are locked', '42501');
select tests.throws(format($$select public.zm_submit_claim(%L, 'weekly', current_date - 6, current_date)$$, tests.id('zone_a')),
                    'the same visits cannot be claimed twice', 'P0001');
select tests.throws(format($$select public.zm_decide_claim(%L, 'approved', 'ok', 'PV-1')$$, tests.id('claim1')),
                    'claimant cannot approve own claim', '42501');

select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.zm_submit_claim(%L, 'weekly', current_date - 6, current_date)$$, tests.id('zone_a')),
                    'hub manager cannot submit zonal travel claims', '42501');
select tests.login(tests.id('zonal_b'));
select tests.ok(tests.row_count('select 1 from public.travel_claims') = 0 and tests.row_count('select 1 from public.hub_visits') = 0,
                'another zonal manager sees no visits or claims of zone A');

select tests.login(tests.id('acct_mgr'));
select tests.throws(format($$select public.zm_decide_claim(%L, 'approved', 'ok')$$, tests.id('claim1')),
                    'approval needs a voucher number', '22023');
select tests.throws(format($$select public.zm_decide_claim(%L, 'rejected')$$, tests.id('claim1')),
                    'rejection needs a note', '22023');
select public.zm_decide_claim(tests.id('claim1'), 'approved', 'Receipts checked', 'PV-2611-0042');
select tests.ok((select status = 'approved' and voucher_no = 'PV-2611-0042' and decided_by = tests.id('acct_mgr')
                 from public.travel_claims where id = tests.id('claim1')),
                'accounts approves the claim and records the voucher');
select tests.throws(format($$select public.zm_decide_claim(%L, 'rejected', 'too late')$$, tests.id('claim1')),
                    'a decided claim cannot be decided again', 'P0001');

select tests.login(tests.id('zonal_a'));
insert into public.hub_visits (hub_id, visit_date, purpose, distance_km, fuel_amount)
values (tests.id('hub_a1'), current_date - 3, 'Follow-up visit', 40, 500);
insert into tests.ids select 'claim2', public.zm_submit_claim(tests.id('zone_a'), 'weekly', current_date - 6, current_date);
select tests.login(tests.id('acct_mgr'));
select public.zm_decide_claim(tests.id('claim2'), 'returned', 'Fuel receipt missing');
select tests.login(tests.id('zonal_a'));
update public.hub_visits set fuel_amount = 450 where purpose = 'Follow-up visit';
select tests.ok((select fuel_amount = 450 and claim_id is null from public.hub_visits where purpose = 'Follow-up visit'),
                'a returned claim releases its visits for correction');
select tests.ok((select sum(total) = 2550 and sum(approved) = 2100 and sum(visits) = 3
                 from public.zm_visit_report('month', current_date - 6, current_date, tests.id('zone_a'))),
                'visit report totals km and expenses and separates approved amounts');

-- ---------- 5. Tasks ----------
insert into tests.ids select 'task1', public.task_assign('Upload missing NID back', tests.id('hub_mgr'), current_date + 5,
  null, tests.id('hub_a1'), 'For Rider One', 'high', true, null, tests.id('emp_a1'));
select tests.ok((select status = 'assigned' and zone_id = tests.id('zone_a') and accountable_manager_id = tests.id('zonal_a')
                 from public.tasks where id = tests.id('task1')),
                'zonal manager assigns a task and becomes accountable for it');
select tests.ok(tests.row_count('select 1 from public.task_reminders') = 1, 'a reminder is created for the day before the deadline');
select tests.throws(format($$select public.task_assign('Other zone task', %L, current_date + 5, null, %L)$$, tests.id('hub_b_mgr'), tests.id('hub_b1')),
                    'tasks cannot be assigned outside own zone', '42501');
select tests.throws(format($$select public.task_assign('Late task', %L, current_date - 1, null, %L)$$, tests.id('hub_mgr'), tests.id('hub_a1')),
                    'deadline in the past rejected', '22023');
select tests.throws(format($$select public.task_assign('Inactive user task', %L, current_date + 5, null, %L)$$, tests.id('inactive'), tests.id('hub_a1')),
                    'tasks cannot be assigned to an inactive user', '22023');

select tests.login(tests.id('hub_b_mgr'));
select tests.ok(tests.row_count('select 1 from public.tasks') = 0, 'unrelated hub manager sees no tasks');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count('select 1 from public.tasks') = 1, 'assignee sees own task');
select tests.throws($$update public.tasks set status = 'completed'$$, 'tasks cannot be changed directly', '42501');
select tests.throws(format('select public.task_complete(%L)', tests.id('task1')),
                    'a task that needs a submission cannot be completed before it is submitted', 'P0001');
select tests.throws(format($$select public.task_update_progress(%L, 'submitted', '')$$, tests.id('task1')),
                    'submission needs a description', '22023');
select public.task_update_progress(tests.id('task1'), 'submitted', 'NID back uploaded to the employee profile');
select tests.throws(format('select public.task_complete(%L)', tests.id('task1')),
                    'assignee cannot confirm own submission', '42501');
select tests.throws('select * from public.task_due_reminders()', 'reminder processing is server-side only', '42501');

select tests.login(tests.id('zonal_a'));
select tests.ok((public.zm_dashboard(tests.id('zone_a'), current_date - 7, current_date) -> 'tasks' ->> 'awaiting_confirmation')::int = 1,
                'dashboard shows submissions waiting for the manager');
select public.task_complete(tests.id('task1'), 'Checked');
select tests.ok((select status = 'completed' and completed_by = tests.id('zonal_a') from public.tasks where id = tests.id('task1')),
                'accountable manager confirms the submission');
select tests.ok((select completed = 1 and completed_on_time = 1 and on_time_pct = 100
                 from public.zm_task_accountability(current_date, current_date + 30, tests.id('zone_a'))
                 where manager_id = tests.id('zonal_a')),
                'accountability report counts on-time completion per manager');

insert into tests.ids select 'task2', public.task_assign('Count hub cash box', tests.id('hub_mgr'), current_date + 1, null, tests.id('hub_a1'));
insert into tests.ids select 'task3', public.task_assign('Old instruction', tests.id('hub_mgr'), current_date + 1, null, tests.id('hub_a1'));
select tests.throws(format($$select public.task_cancel(%L, '')$$, tests.id('task3')), 'cancelling a task needs a reason', '22023');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.task_cancel(%L, 'not needed')$$, tests.id('task3')), 'assignee cannot cancel a task', '42501');
select public.task_complete(tests.id('task2'));
select tests.ok((select status = 'completed' from public.tasks where id = tests.id('task2')),
                'a simple task is completed by the assignee');
select tests.login(tests.id('zonal_a'));
select public.task_cancel(tests.id('task3'), 'Replaced by a notice');
select tests.ok((select status = 'cancelled' from public.tasks where id = tests.id('task3')), 'manager cancels a task with a reason');

-- ---------- 6. Workforce planning: evidence, assumptions, advice only ----------
select tests.logout();
insert into tests.ids values ('n_before', md5(
  (select count(*) from public.employees)::text || '/' || (select count(*) from public.employee_compensation)::text || '/' ||
  (select count(*) from public.employee_status_history)::text || '/' || (select count(*) from public.employee_assignments)::text ||
  '/' || (select string_agg(status, ',' order by id) from public.employees))::uuid);

select tests.login(tests.id('zonal_a'));
select tests.ok(jsonb_array_length(public.zm_workforce_plan(tests.id('zone_a'), current_date - 7, current_date - 1) -> 'items') = 2,
                'one recommendation per active hub of the zone');
select tests.ok((select i ->> 'kind' = 'rebalance_riders'
                        and (i -> 'evidence' ->> 'days_of_data')::int = 7
                        and (i -> 'evidence' ->> 'riders_needed')::int = 18
                        and (i -> 'evidence' ->> 'rider_gap')::int = 10
                        and jsonb_array_length(i -> 'assumptions') >= 5
                 from jsonb_array_elements(public.zm_workforce_plan(tests.id('zone_a'), current_date - 7, current_date - 1) -> 'items') i
                 where i ->> 'hub_code' = 'A1'),
                'overloaded hub: reallocation is suggested first, with evidence and assumptions');
select tests.ok((select i ->> 'kind' = 'no_change'
                 from jsonb_array_elements(public.zm_workforce_plan(tests.id('zone_a'), current_date - 7, current_date - 1) -> 'items') i
                 where i ->> 'hub_code' = 'A2'),
                'a hub that copes with its workload gets no change');
select tests.ok((select bool_and(i ->> 'kind' = 'data_gap')
                 from jsonb_array_elements(public.zm_workforce_plan(tests.id('zone_a'), current_date - 2, current_date - 1) -> 'items') i),
                'too few verified days: no recommendation is made');
select tests.ok(public.zm_workforce_plan(tests.id('zone_a'), current_date - 7, current_date - 1) ->> 'policy' like 'Advisory only%',
                'plan states that it is advisory only');
select tests.throws(format('select public.zm_workforce_plan(%L, current_date - 7, current_date - 1)', tests.id('zone_b')),
                    'zonal manager cannot plan for another zone', '42501');
select public.zm_workforce_plan(tests.id('zone_a'), current_date - 7, current_date - 1, true);
select tests.ok((select count(*) = 2 and bool_and(status = 'proposed') from public.workforce_recommendations),
                'saved recommendations start as proposed');
select tests.throws($$select public.zm_review_recommendation((select id from public.workforce_recommendations where kind = 'rebalance_riders'), 'acknowledged', '')$$,
                    'reviewing a recommendation needs a note', '22023');
select public.zm_review_recommendation((select id from public.workforce_recommendations where kind = 'rebalance_riders'), 'acknowledged', 'Discussed with HR');
select tests.throws($$select public.zm_review_recommendation((select id from public.workforce_recommendations where kind = 'rebalance_riders'), 'dismissed', 'again')$$,
                    'a reviewed recommendation cannot be reviewed again', 'P0001');

select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.zm_workforce_plan(%L, current_date - 7, current_date - 1)', tests.id('zone_a')),
                    'hub manager cannot run workforce planning', '42501');
select tests.login(tests.id('zonal_b'));
select tests.ok(tests.row_count('select 1 from public.workforce_recommendations') = 0, 'recommendations of zone A are hidden from zone B');
select tests.ok((select i ->> 'kind' = 'add_riders' and i ->> 'summary' like '%HR and management decide%'
                 from jsonb_array_elements(public.zm_workforce_plan(tests.id('zone_b'), current_date - 7, current_date - 1) -> 'items') i),
                'no spare hub in the zone: extra riders are suggested for a human decision');

select tests.logout();
select tests.ok(tests.id('n_before') = md5(
  (select count(*) from public.employees)::text || '/' || (select count(*) from public.employee_compensation)::text || '/' ||
  (select count(*) from public.employee_status_history)::text || '/' || (select count(*) from public.employee_assignments)::text ||
  '/' || (select string_agg(status, ',' order by id) from public.employees))::uuid,
  'planning changed no employee, salary, status or assignment record');
select tests.throws(format($$insert into public.workforce_recommendations (zone_id, hub_id, period_from, period_to, kind, summary, evidence, assumptions)
                            values (%L, %L, current_date, current_date, 'terminate_employee', 'x', '{}', '[]')$$, tests.id('zone_a'), tests.id('hub_a1')),
                    'no hiring / firing / pay / discipline category can be stored', '23514');

-- ---------- 7. Reports and export log ----------
select tests.login(tests.id('zonal_a'));
select tests.ok((select pickups = 2100 and deliveries = 2100 and volume_rank = 1 and days_verified = 7 and parcels_per_rider_day = 75
                 from public.zm_hub_performance(tests.id('zone_a'), current_date - 7, current_date - 1) where hub_code = 'A1'),
                'hub performance totals and ranks hubs');
select tests.ok(tests.row_count(format('select * from public.zm_hub_performance(%L, current_date - 7, current_date - 1)', tests.id('zone_a'))) = 2,
                'hub comparison lists the hubs of the zone');
select tests.ok(tests.row_count($$select * from public.zm_report_operations('hub', current_date - 7, current_date - 1)$$) = 2,
                'hub-wise report is limited to the caller''s zone');
select tests.ok((select sum(pickups) = 2450 from public.zm_report_operations('zone', current_date - 7, current_date - 1)),
                'zone-wise report totals the zone');
select tests.ok(tests.row_count($$select * from public.zm_report_operations('week', current_date - 7, current_date - 1)$$) >= 1
                and tests.row_count($$select * from public.zm_report_operations('month', current_date - 7, current_date - 1)$$) >= 1,
                'weekly and monthly reports return periods');
select tests.ok(tests.row_count($$select * from public.zm_report_operations('bogus', current_date - 7, current_date - 1)$$) = 0,
                'unknown grouping returns nothing');
select tests.ok((select headcount = 2 and transferred = 1
                 from public.zm_report_workforce('hub', current_date - 7, current_date, tests.id('zone_a')) where group_key = 'A1'),
                'hub-wise workforce report');
select tests.ok((select headcount = 2 from public.zm_report_workforce('department', current_date - 7, current_date, tests.id('zone_a')) where group_key = 'OPS'),
                'department-wise workforce report');
select tests.ok(tests.row_count('select * from public.zm_report_employees(current_date - 7, current_date)') = 2,
                'employee-wise report lists employees in scope only');
select public.zm_log_export('hub_performance', 'excel', '{"zone":"ZA"}');
select tests.throws($$select public.zm_log_export('hub_performance', 'docx')$$, 'unknown export format rejected', '22023');
select tests.login(tests.id('hub_mgr'));
select tests.ok(tests.row_count($$select * from public.zm_report_operations('hub', current_date - 7, current_date - 1)$$) = 1,
                'hub manager report shows own hub only');
select tests.throws($$select public.zm_log_export('hub_performance', 'pdf')$$, 'export needs the export permission', '42501');
select tests.login(tests.id('super'));
select tests.ok(tests.row_count($$select * from public.zm_report_operations('hub', current_date - 7, current_date - 1)$$) = 3,
                'head office sees every hub');

select tests.login_anon();
select tests.throws('select * from public.hub_daily_metrics', 'anonymous users cannot read hub figures', '42501');
select tests.throws('select * from public.tasks', 'anonymous users cannot read tasks', '42501');
select tests.throws(format('select public.zm_dashboard(%L, current_date - 7, current_date)', tests.id('zone_a')),
                    'anonymous users cannot call the dashboard', '42501');

select tests.logout();
select tests.ok(exists (select 1 from public.audit_logs where action = 'EXPORT' and module = 'zonal' and record_id = 'hub_performance'
                        and actor_id = tests.id('zonal_a')),
                'every export is written to the audit log');
rollback;
