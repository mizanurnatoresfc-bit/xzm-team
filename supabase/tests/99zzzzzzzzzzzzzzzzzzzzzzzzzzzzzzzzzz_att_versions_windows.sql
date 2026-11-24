-- দৈনিক ও মাসিক হাজিরা খাতা: সংস্করণ, অনলাইন হাজিরার সার্ভার সময়, ছুটি, সীমিত সংশোধন, সময়ে অটো সাবমিট, মাসের সংস্করণ, যাচাইয়ে ফেরত।
begin;
select tests.fixture();
select tests.hr_fixture();
select (now() at time zone 'Asia/Dhaka')::date as t, (now() at time zone 'Asia/Dhaka')::date - 1 as y, (now() at time zone 'Asia/Dhaka')::date - 2 as y2,
       date_trunc('month', (now() at time zone 'Asia/Dhaka')::date - 1)::date as m \gset
insert into public.positions (department_id, code, name, name_bn) values (tests.id('dept_ops'), 'MANAGER', 'Manager', 'ম্যানেজার');
insert into tests.ids values
  ('s1', tests.active_employee('Self Rider', '891', tests.id('hub_a1'), '01711000891', '8910000000', 15000, tests.id('rider_login'))),
  ('s2', tests.active_employee('Leave Rider', '892', tests.id('hub_a1'), '01711000892', '8920000000')),
  ('s3', tests.active_employee('Waiting Leave', '893', tests.id('hub_a1'), '01711000893', '8930000000')),
  ('mg', tests.active_employee('Hub Boss', '894', tests.id('hub_a1'), '01711000894', '8940000000', 20000, tests.id('hub_mgr'))),
  ('o1', tests.active_employee('Other Hub', '895', tests.id('hub_a2'), '01711000895', '8950000000'));
update public.employees set position_id = (select id from public.positions where code = 'MANAGER') where id = tests.id('mg');
select tests.grant_role(tests.id('rider_login'), 'staff', 'hub', null, tests.id('hub_a1'));
-- s2: approved leave today; s3: a leave request waiting today
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, status) select tests.id('s2'), id, :'t'::date, :'t'::date, 'family', 'approved' from public.leave_types where code = 'casual';
insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason, status) select tests.id('s3'), id, :'t'::date, :'t'::date, 'trip', 'pending' from public.leave_types where code = 'sick';
select tests.login(tests.id('rider_login'));
select public.att_self_mark('present');

-- ---------------------------------------------------------------- the lines before the manager touches them
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (x -> 'value' ->> 'final_status') = 'leave' and x -> 'value' ->> 'leave_ref' like 'LR-%' and (x -> 'value' ->> 'leave_applied_on')::date = :'t'::date
                   from public.att_sheet_get(tests.id('hub_a1')) g, jsonb_array_elements(g -> 'people') x where x ->> 'employee_id' = tests.id('s2')::text),
  'approved leave puts itself on the line with its reference and the date it was applied for');
select tests.ok((select (x -> 'value' ->> 'final_status') = 'pending_leave' and x -> 'value' -> 'leave_pending' ->> 'ref' like 'LR-%'
                   from public.att_sheet_get(tests.id('hub_a1')) g, jsonb_array_elements(g -> 'people') x where x ->> 'employee_id' = tests.id('s3')::text),
  'a leave request that is still waiting is shown on its own');
select tests.ok((select g ->> 'due' is not null and (g -> 'sheet') = 'null'::jsonb and g -> 'window' = 'null'::jsonb from public.att_sheet_get(tests.id('hub_a1')) g), 'the page knows when the server will submit the day');

-- a waiting leave request is not an answer: the manager decides
select tests.throws(format($$select public.att_sheet_submit(%L, %L, %L::jsonb)$$, tests.id('hub_a1'), :'t'::date, jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('s1'), 'manager_ok', true, 'final_status', 'present'),
    jsonb_build_object('employee_id', tests.id('s2'), 'final_status', 'present'),
    jsonb_build_object('employee_id', tests.id('mg'), 'final_status', 'present', 'online_marked', true))), 'the manager cannot call a person without their own mark "marked online" and the waiting leave is not settled', '22023');
select tests.ok((select (r ->> 'version')::int = 1 and (r ->> 'unchecked')::int = 0 from public.att_sheet_submit(tests.id('hub_a1'), :'t'::date, jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('s1'), 'manager_ok', true, 'final_status', 'late', 'late_time', '10:15'),
    jsonb_build_object('employee_id', tests.id('s2'), 'final_status', 'present'),
    jsonb_build_object('employee_id', tests.id('s3'), 'final_status', 'absent', 'absence_reason', 'sick child'),
    jsonb_build_object('employee_id', tests.id('mg'), 'final_status', 'present', 'online_marked', true, 'online_reason', 'net was down'))) r),
  'submitted: version one');
select tests.logout();
select tests.ok((select online_marked and online_at is not null from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                  where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date and l.employee_id = tests.id('s1'))
            and (select online_at = m.marked_at from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id, public.attendance_self_marks m
                  where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date and l.employee_id = tests.id('s1') and m.employee_id = l.employee_id and m.work_date = s.work_date),
  'marked online and its time are the person''s own mark (server time)');
select tests.ok((select not online_marked and online_at is null and online_reason = 'net was down' from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                  where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date and l.employee_id = tests.id('mg')), 'a person with no mark of their own is "not marked online", whatever the manager types, and the reason stays');
select tests.ok((select final_status = 'leave' and leave_ref like 'LR-%' and leave_applied_on = :'t'::date and absence_app_date = :'t'::date from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                  where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date and l.employee_id = tests.id('s2'))
            and (select status = 'leave' from public.attendance_records where employee_id = tests.id('s2') and work_date = :'t'::date), 'the leave stays leave whatever the manager typed; the application date is on the report row');
select tests.ok((select final_status = 'absent' and absence_reason = 'sick child' and not unauthorized from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                  where s.hub_id = tests.id('hub_a1') and s.work_date = :'t'::date and l.employee_id = tests.id('s3')), 'a known absence has its reason');
insert into tests.ids select 'sheet', id from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'t'::date;
select tests.ok((select version = 1 and submit_mode = 'manager' from public.att_day_sheets where id = tests.id('sheet'))
            and (select count(*) = 1 and bool_and(jsonb_array_length(lines) = 4) from public.att_sheet_versions where sheet_id = tests.id('sheet')), 'the version keeps a copy of all four lines');

-- an absence needs a reason, an application date or "without telling"
select tests.login(tests.id('zonal_a'));
select public.att_sheet_unlock(tests.id('sheet'), 'check the absence');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.att_sheet_submit(%L, %L, %L::jsonb)$$, tests.id('hub_a1'), :'t'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('s3'), 'final_status', 'absent'))),
  'an absence with nothing said is not complete', '22023');
select tests.ok((select (r ->> 'version')::int = 2 from public.att_sheet_submit(tests.id('hub_a1'), :'t'::date, jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('s3'), 'final_status', 'absent', 'unauthorized', true))) r), 'corrected and submitted again: version two');
select tests.ok((select (g -> 'sheet' ->> 'version')::int = 2 and jsonb_array_length(g -> 'versions') = 2 and g -> 'versions' -> 0 ->> 'mode' = 'manager' from public.att_sheet_get(tests.id('hub_a1'), :'t'::date) g),
  'the page lists both versions');
select tests.ok((select jsonb_array_length(v -> 'lines') = 4 and (select x ->> 'absence_reason' from jsonb_array_elements(v -> 'lines') x where x ->> 'employee_id' = tests.id('s3')::text) = 'sick child'
                   from public.att_sheet_version_get(tests.id('sheet'), 1) v), 'version one is kept as it was (the reason, not the correction)');
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.att_sheet_version_get(%L, 1)$$, tests.id('sheet')), 'staff cannot read the versions', '42501');

-- ---------------------------------------------------------------- checking belongs to one version
select tests.login(tests.id('zonal_a'));
select tests.ok(public.att_sheet_send(tests.id('sheet')) = 1, 'version two is sent to the hub''s manager');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.att_sheet_check_return(%L, 'x')$$, tests.id('sheet')), 'the reason of a return is written', '22023');
select public.att_sheet_check_return(tests.id('sheet'), 'Waiting Leave was on a trip');
select tests.ok((select g -> 'my_check' ->> 'returned_at' is not null and g -> 'my_check' ->> 'return_reason' like 'Waiting%' and (g -> 'my_check' ->> 'version_no')::int = 2 from public.att_sheet_get(tests.id('hub_a1')) g),
  'the manager sent it back with the reason, on version two');
select tests.login(tests.id('zonal_a'));
select tests.ok((select (h ->> 'checks_returned')::int = 1 and (h ->> 'version')::int = 2 from public.att_zone_day(tests.id('zone_a')) z, jsonb_array_elements(z -> 'hubs') h where h ->> 'hub_id' = tests.id('hub_a1')::text),
  'the zonal manager sees one check sent back');
select public.att_sheet_unlock(tests.id('sheet'), 'trip, not absent');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_submit(tests.id('hub_a1'), :'t'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('s3'), 'final_status', 'present', 'online_reason', 'was away')));
select tests.ok((select (g -> 'sheet' ->> 'version')::int = 3 and jsonb_array_length(g -> 'checks') = 0 and g -> 'my_check' = 'null'::jsonb from public.att_sheet_get(tests.id('hub_a1')) g),
  'a new version starts with no checks: the old verification stays with version two');

-- ---------------------------------------------------------------- a past day is closed until the zonal manager opens it
select tests.throws(format($$select public.att_sheet_save(%L, %L, '[]')$$, tests.id('hub_a1'), :'y2'::date), 'a past day cannot be written', 'P0001');
select tests.ok((select not (g -> 'can' ->> 'edit')::boolean from public.att_sheet_get(tests.id('hub_a1'), :'y2'::date) g), 'and the page says so');
select tests.throws(format($$select public.att_reopen_open(%L, %L, %L, 60, 'missing days')$$, tests.id('hub_a1'), :'y2'::date, :'y'::date), 'the hub manager cannot open it', '42501');
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.att_reopen_open(%L, %L, %L, 60, 'x')$$, tests.id('hub_a1'), :'y2'::date, :'y'::date), 'a reason is written', '22023');
select tests.throws(format($$select public.att_reopen_open(%L, %L, %L, 0, 'missing days')$$, tests.id('hub_a1'), :'y2'::date, :'y'::date), 'minutes are given', '22023');
select tests.throws(format($$select public.att_reopen_open(%L, %L, %L, 60, 'missing days')$$, tests.id('hub_a1'), :'y'::date, :'y2'::date), 'the first date is not after the last', '22023');
select tests.throws(format($$select public.att_reopen_open(%L, %L, %L, 60, 'missing days')$$, tests.id('hub_a1'), :'y'::date, (:'t'::date + 1)), 'not a day in the future', '22023');
select tests.throws(format($$select public.att_reopen_open(%L, %L, %L, 60, 'x of another zone')$$, tests.id('hub_b1'), :'y2'::date, :'y'::date), 'nor a hub of another zone', '42501');
select tests.ok((r ->> 'opened')::int = 0 and r ->> 'window' is not null, 'a range is opened for sixty minutes (nothing was submitted on those days yet)') from public.att_reopen_open(tests.id('hub_a1'), :'y2'::date, :'y'::date, 60, 'missing days') r;
select tests.ok((select x ->> 'status' = 'open' and x ->> 'by' is not null and (x ->> 'can_close')::boolean and (x ->> 'from')::date = :'y2'::date and (x ->> 'to')::date = :'y'::date and (x ->> 'expires_at') is not null
                   from jsonb_array_elements(public.att_reopen_list(tests.id('hub_a1'))) x where x ->> 'reason' = 'missing days')
            and jsonb_array_length(public.att_reopen_list(tests.id('hub_a1'))) = 3, 'the opening is logged: from, to, expiry, reason, who (the two one-day unlocks of before are there too)');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (g -> 'can' ->> 'edit')::boolean and g -> 'window' ->> 'reason' = 'missing days' from public.att_sheet_get(tests.id('hub_a1'), :'y2'::date) g), 'inside the opening the manager may write the day');
select tests.ok((select (r ->> 'version')::int = 1 from public.att_sheet_submit(tests.id('hub_a1'), :'y2'::date, jsonb_build_array(
    jsonb_build_object('employee_id', tests.id('s1'), 'final_status', 'absent', 'unauthorized', true), jsonb_build_object('employee_id', tests.id('s2'), 'final_status', 'present', 'online_reason', 'no phone'),
    jsonb_build_object('employee_id', tests.id('s3'), 'final_status', 'present', 'online_reason', 'no phone'), jsonb_build_object('employee_id', tests.id('mg'), 'final_status', 'weekly_off'))) r), 'the missing day is submitted as version one');
select tests.logout();
select tests.ok((select window_id is not null and submit_mode = 'manager' from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'y2'::date)
            and (select v.window_id is not null from public.att_sheet_versions v join public.att_day_sheets s on s.id = v.sheet_id where s.hub_id = tests.id('hub_a1') and s.work_date = :'y2'::date), 'the version remembers the opening it was made in');

-- ---------------------------------------------------------------- the server job
-- yesterday of hub A1 is under an open opening: the job leaves it alone; hub A2 has no opening and nobody wrote: submitted by the server, unchecked
select tests.ok(private.att_day_autosubmit() >= 1, 'the job submits the registers still open when the date has changed');
select tests.ok((select submit_mode = 'auto' and version = 1 and submitted_by is null and status = 'submitted' from public.att_day_sheets where hub_id = tests.id('hub_a2') and work_date = :'y'::date)
            and (select final_status = 'unchecked' from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id where s.hub_id = tests.id('hub_a2') and s.work_date = :'y'::date and l.employee_id = tests.id('o1'))
            and not exists (select 1 from public.attendance_records where employee_id = tests.id('o1') and work_date = :'y'::date), 'an unfinished line is submitted as "unchecked" and nothing goes on the register for it');
select tests.ok(not exists (select 1 from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'y'::date and status = 'submitted'), 'a day under an open opening is not touched by the job');
select tests.ok(private.att_day_autosubmit() = 0, 'running the job again changes nothing');
select tests.ok(private.att_sheet_close(tests.id('hub_a2'), :'y'::date, null, 'manager', true) is null, 'a manual submit meeting the job afterwards is the same version');
select tests.ok((select count(*) = 1 from public.att_sheet_versions v join public.att_day_sheets s on s.id = v.sheet_id where s.hub_id = tests.id('hub_a2') and s.work_date = :'y'::date), 'one version for that day');
-- the opening ends: the permission ends and the draft is submitted by the server
update public.att_reopen_windows set expires_at = now() - interval '1 minute' where hub_id = tests.id('hub_a1');
select tests.ok(private.att_day_autosubmit() >= 1, 'when the opening is over the server submits what is left');
select tests.ok((select bool_and(status = 'expired') from public.att_reopen_windows where hub_id = tests.id('hub_a1') and from_date = :'y2'::date and to_date = :'y'::date)
            and (select status = 'submitted' and submit_mode = 'auto' and version = 1 from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = :'y'::date)
            and (select count(*) = 4 from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id where s.hub_id = tests.id('hub_a1') and s.work_date = :'y'::date and l.final_status in ('unchecked', 'pending_leave')),
  'the opening expired and yesterday was submitted by the server with every line unchecked');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.att_sheet_save(%L, %L, '[]')$$, tests.id('hub_a1'), :'y2'::date), 'once the opening is over the days are closed again', 'P0001');

-- ---------------------------------------------------------------- the month
select tests.login(tests.id('hub_mgr'));
select tests.ok((m ->> 'version_no')::int = 1 and not (m ->> 'already')::boolean, 'the month is submitted from the daily versions') from public.att_month_submit(tests.id('hub_a1'), :'m'::date) m;
select tests.ok((m ->> 'already')::boolean, 'the same days at the same versions are the same submission') from public.att_month_submit(tests.id('hub_a1'), :'m'::date) m;
select tests.ok((select not (g ->> 'changed')::boolean and g -> 'sub' ->> 'version_no' = '1' and jsonb_array_length(g -> 'missing') = 0 from public.att_month_get(tests.id('hub_a1'), :'m'::date) g), 'the page: submitted, nothing changed');
select tests.throws(format($$select public.att_month_submit(%L, %L)$$, tests.id('hub_a2'), :'m'::date), 'not the month of another hub', '42501');
select tests.throws(format($$select public.att_month_submit(%L, %L)$$, tests.id('hub_a1'), (:'t'::date + interval '40 days')::date), 'not a month that has not started', '22023');
select tests.login(tests.id('zonal_a'));
select tests.ok((select id::text from public.att_month_get(tests.id('hub_a1'), :'m'::date) g, lateral (select (g -> 'sub' ->> 'id') as id) q) is not null, 'the zonal manager sees the monthly submission');
select tests.ok(public.att_month_send((select (public.att_month_get(tests.id('hub_a1'), :'m'::date) -> 'sub' ->> 'id')::uuid)) = 1, 'sent to the hub''s manager');
-- the day is corrected afterwards: the old monthly version stays and the month must be submitted again
select tests.ok((r ->> 'opened')::int = 1, 'a corrected day: one submitted register is opened') from public.att_reopen_open(tests.id('hub_a1'), :'y2'::date, :'y2'::date, 30, 'wrong status') r;
select tests.login(tests.id('hub_mgr'));
select tests.ok((s ->> 'version')::int = 2, 'corrected as version two of that day') from public.att_sheet_submit(tests.id('hub_a1'), :'y2'::date, jsonb_build_array(jsonb_build_object('employee_id', tests.id('s1'), 'final_status', 'absent', 'absence_reason', 'sick'))) s;
select tests.ok((select (g ->> 'changed')::boolean and g -> 'changed_days' ->> 0 = :'y2'::text and g -> 'sub' ->> 'version_no' = '1' from public.att_month_get(tests.id('hub_a1'), :'m'::date) g),
  'the month says it must be submitted again, and which day moved');
select tests.ok((m ->> 'version_no')::int = 2, 'submitted again as version two') from public.att_month_submit(tests.id('hub_a1'), :'m'::date) m;
select tests.ok((select jsonb_array_length(g -> 'history') = 2 and not (g ->> 'changed')::boolean and jsonb_array_length(g -> 'checks') = 0 from public.att_month_get(tests.id('hub_a1'), :'m'::date) g),
  'both monthly versions are kept; the check of version one does not carry over');
select tests.login(tests.id('zonal_a'));
select tests.ok(public.att_month_send((select (public.att_month_get(tests.id('hub_a1'), :'m'::date) -> 'sub' ->> 'id')::uuid)) = 1, 'version two is sent for checking');
select tests.login(tests.id('hub_mgr'));
select public.att_month_check_return((select (public.att_month_get(tests.id('hub_a1'), :'m'::date) -> 'sub' ->> 'id')::uuid), 'Hub Boss weekly off was a working day');
select tests.ok((select g -> 'my_check' ->> 'return_reason' like 'Hub Boss%' from public.att_month_get(tests.id('hub_a1'), :'m'::date) g), 'the hub manager sent the month back with the reason');
select public.att_month_check_ok((select (public.att_month_get(tests.id('hub_a1'), :'m'::date) -> 'sub' ->> 'id')::uuid));
select tests.ok((select g -> 'my_check' ->> 'ok_at' is not null and g -> 'my_check' ->> 'return_reason' is null from public.att_month_get(tests.id('hub_a1'), :'m'::date) g), 'or marked it right');
insert into tests.ids select 'msub', (public.att_month_get(tests.id('hub_a1'), :'m'::date) -> 'sub' ->> 'id')::uuid;
select tests.login(tests.id('rider_login'));
select tests.throws(format($$select public.att_month_submit(%L, %L)$$, tests.id('hub_a1'), :'m'::date), 'staff cannot submit the month', '42501');
select tests.throws(format($$select public.att_month_send(%L)$$, tests.id('msub')), 'nor send it', '42501');
-- the monthly grid shows an unchecked line as U
select tests.login(tests.id('hub_mgr'));
select tests.ok(exists (select 1 from jsonb_array_elements(public.att_month_sheet(tests.id('hub_a1'), :'m'::date) -> 'people') p, jsonb_array_elements_text(p -> 'cells') c where c = 'U'), 'the monthly grid marks a line nobody checked as U, not as leave');
rollback;
