-- Master audit of 22 Nov 2026, second pass (20261122001300_master_audit_fixes.sql).
begin;
select tests.fixture(); select tests.hr_fixture();
insert into tests.ids values
 ('ma_mgr', tests.active_employee('Audit Manager', '9102', tests.id('hub_a1'), '01711009102', '9102101010', 25000, tests.id('hub_mgr'))),
 ('ma_r1',  tests.active_employee('Audit Rider One', '9103', tests.id('hub_a1'), '01711009103', '9103101010', 15000, tests.id('rider_login'))),
 ('ma_r2',  tests.active_employee('Audit Rider Two', '9104', tests.id('hub_a1'), '01711009104', '9104101010'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

-- 1. a register with a leaver on it can still be submitted
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_save(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, (
  select jsonb_agg(jsonb_build_object('employee_id', p->>'employee_id', 'final_status', 'present', 'online_marked', true, 'online_reason', 'no phone'))
  from jsonb_array_elements(public.att_sheet_get(tests.id('hub_a1'))->'people') p));
insert into tests.ids select 'ma_req', public.hr_staff_leave_request(tests.id('ma_r2'), 'Left the job');
select tests.login(tests.id('zonal_a'));
select tests.ok((public.hr_request_decide(tests.id('ma_req'), true, 'ok', '{"exit_type":"resigned"}') ->> 'status') = 'done', 'the exit is approved while the register is a draft');
select tests.login(tests.id('hub_mgr'));
select tests.ok((public.att_sheet_submit(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date) ->> 'sheet_id') is not null, 'the register is submitted although one person on it has left');
select tests.logout();
select tests.ok((select status from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = (now() at time zone 'Asia/Dhaka')::date) = 'submitted', 'the register is locked');
select tests.ok(exists (select 1 from public.att_day_lines l where l.employee_id = tests.id('ma_r2')), 'the leaver keeps the line on the sheet');
select tests.ok(not exists (select 1 from public.attendance_records r where r.employee_id = tests.id('ma_r2') and r.work_date = (now() at time zone 'Asia/Dhaka')::date), 'no new register row is written for the leaver');
select tests.ok((select status from public.attendance_records r where r.employee_id = tests.id('ma_r1') and r.work_date = (now() at time zone 'Asia/Dhaka')::date) = 'present', 'the others are on the register');
-- unlock, correct, submit again: an existing row is updated
select tests.login(tests.id('zonal_a'));
select public.att_sheet_unlock((select id from public.att_day_sheets where hub_id = tests.id('hub_a1') and work_date = (now() at time zone 'Asia/Dhaka')::date), 'one line was wrong');
select tests.login(tests.id('hub_mgr'));
select public.att_sheet_submit(tests.id('hub_a1'), (now() at time zone 'Asia/Dhaka')::date, jsonb_build_array(
  jsonb_build_object('employee_id', tests.id('ma_r1'), 'final_status', 'late', 'late_time', '10:45', 'online_marked', true, 'online_reason', 'no phone')));
select tests.logout();
select tests.ok((select status from public.attendance_records r where r.employee_id = tests.id('ma_r1') and r.work_date = (now() at time zone 'Asia/Dhaka')::date) = 'late', 'a second submit updates the existing register row');
select tests.ok((select (check_in at time zone 'Asia/Dhaka')::time from public.attendance_records r where r.employee_id = tests.id('ma_r1') and r.work_date = (now() at time zone 'Asia/Dhaka')::date) = '10:45', 'with the arrival time');

-- 2. "ID temporarily off" pauses the person instead of ending the job
insert into tests.ids values ('ma_r3', tests.active_employee('Audit Rider Three', '9105', tests.id('hub_a1'), '01711009105', '9105101010'));
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'ma_off', public.hr_request_submit((select id from public.hr_request_formats where code = 'ID_INACTIVE'), tests.id('ma_r3'), null,
  jsonb_build_object('last_date', (now() at time zone 'Asia/Dhaka')::date::text, 'reason_type', 'আইডি সাময়িক বন্ধ', 'reason', 'bike in the garage for a week'));
select tests.login(tests.id('zonal_a'));
select tests.ok((public.hr_request_decide(tests.id('ma_off'), true, 'ok') ->> 'result') = 'আইডি সাময়িক বন্ধ', 'a temporary-off request is approved as a pause');
select tests.logout();
select tests.ok((select status from public.employees where id = tests.id('ma_r3')) = 'inactive', 'the person is inactive, not resigned');
select tests.ok(not exists (select 1 from public.employee_assignments a where a.employee_id = tests.id('ma_r3') and a.change_type = 'exit'), 'no exit row');
select tests.ok(not exists (select 1 from public.hr_record_files f where f.employee_id = tests.id('ma_r3') and f.kind = 'exit'), 'no exit file');
select tests.ok((select effective_to from public.employee_assignments a where a.employee_id = tests.id('ma_r3') order by created_at desc limit 1) is null, 'the posting stays open');
-- an explicit choice still ends the job
insert into tests.ids values ('ma_r4', tests.active_employee('Audit Rider Four', '9106', tests.id('hub_a1'), '01711009106', '9106101010'));
select tests.login(tests.id('hub_mgr'));
insert into tests.ids select 'ma_off2', public.hr_request_submit((select id from public.hr_request_formats where code = 'ID_INACTIVE'), tests.id('ma_r4'), null,
  jsonb_build_object('last_date', '30/11/2026', 'reason_type', 'চাকরি ছেড়ে দিচ্ছি', 'reason', 'going home'));

-- 3. a date that is not YYYY-MM-DD no longer breaks the inbox or the decision
select tests.login(tests.id('zonal_a'));
select tests.ok(jsonb_array_length(public.hr_request_inbox() -> 'rows') >= 1, 'the inbox opens with an unreadable date in one request');
select tests.ok((public.hr_request_decide(tests.id('ma_off2'), true, 'ok', '{"exit_type":"resigned"}') ->> 'result') = 'চাকরি ছেড়েছেন', 'and that request can be decided (the date falls back to today)');
select tests.logout();
select tests.ok((select status_since from public.employees where id = tests.id('ma_r4')) = (now() at time zone 'Asia/Dhaka')::date, 'the exit date is today');
select tests.ok(private.safe_date('2026-11-30') = date '2026-11-30' and private.safe_date('30/11/2026') is null and private.safe_date('2026-13-45') is null and private.safe_date('') is null,
  'safe_date reads only real YYYY-MM-DD dates');

-- 4. a tap without a note does not repeat an earlier note
select tests.login(tests.id('rider_login'));
select public.wf_ops_add(1, 0, 5, 0, 'first');
select public.wf_ops_add(null, null, 3, 1);
select tests.ok((select count(*) from jsonb_array_elements(public.wf_ops_taps() -> 'taps') t where t ->> 'note' = 'first') = 1, 'only the tap that carried the note shows it');
select tests.ok((select delivery = 8 and pickup = 1 and delivery_return = 1 from public.wf_daily_ops where employee_id = tests.id('ma_r1') and work_date = (now() at time zone 'Asia/Dhaka')::date), 'totals are unchanged');
select tests.logout();
rollback;
