
-- Run after the baseline and migration in the same disposable transaction.
create function public.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function public.fixture_assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
end
$$;

insert into public.hubs(id, code, zone_id, status) values
  (fixture_id(1), 'DEMO', fixture_id(10), 'active'),
  (fixture_id(2), 'DEMO-B', fixture_id(10), 'active'),
  (fixture_id(3), 'DEMO-C', fixture_id(11), 'active');
insert into public.profiles(id, status)
select fixture_id(i), 'active' from generate_series(21, 28) i;
insert into public.employees(id, profile_id, position_id, hub_id, zone_id, status)
select fixture_id(i + 10), fixture_id(i), fixture_id(49),
  fixture_id(case i when 23 then 2 when 24 then 3 else 1 end),
  fixture_id(case i when 24 then 11 else 10 end), 'active'
from generate_series(21, 25) i;
insert into public.roles(id, code, status, is_super) values
  (fixture_id(51), 'manager', 'active', false),
  (fixture_id(52), 'zonal_manager', 'active', false);
insert into public.user_roles(user_id, role_id, scope_type, hub_id, zone_id, valid_from) values
  (fixture_id(21), fixture_id(51), 'hub', fixture_id(1), fixture_id(10), current_date - 1),
  (fixture_id(23), fixture_id(51), 'hub', fixture_id(2), fixture_id(10), current_date - 1),
  (fixture_id(24), fixture_id(52), 'zone', null, fixture_id(11), current_date - 1),
  (fixture_id(25), fixture_id(51), 'hub', fixture_id(1), fixture_id(10), current_date - 1),
  (fixture_id(26), fixture_id(52), 'zone', null, fixture_id(10), current_date - 1);
insert into public.job_duties(id, position_id, hub_id, title, frequency,
  deadline_local, verification_mode, evidence_source, reviewer_role) values
  (fixture_id(61), fixture_id(49), fixture_id(1), 'Morning', 'daily', time '23:59:59.999999',
    'automatic','morning_manpower','hub_manager'),
  (fixture_id(62), fixture_id(49), fixture_id(1), 'Attendance', 'daily', time '23:59:59.999999',
    'both','attendance','zonal_manager'),
  (fixture_id(63), fixture_id(49), fixture_id(1), 'Weekly', 'weekly', time '12:00',
    'manual',null,'hub_manager'),
  (fixture_id(64), fixture_id(49), fixture_id(1), 'Monthly', 'monthly', time '12:00',
    'manual',null,'hub_manager'),
  (fixture_id(65), fixture_id(49), fixture_id(1), 'Legacy', 'as_needed', null,
    'manual',null,'hub_manager');
insert into public.leave_requests(employee_id, status, from_date, to_date)
values (fixture_id(35), 'approved', (now() at time zone 'Asia/Dhaka')::date,
    (now() at time zone 'Asia/Dhaka')::date);
insert into public.wf_morning_subs(id, hub_id, zone_id, work_date, status, submit_mode, submitted_by, submitted_at)
values (fixture_id(71), fixture_id(1), fixture_id(10), (now() at time zone 'Asia/Dhaka')::date,
    'submitted', 'manager', fixture_id(21), now()),
  (fixture_id(72), fixture_id(1), fixture_id(10), (now() at time zone 'Asia/Dhaka')::date,
    'submitted', 'auto', fixture_id(22), now());
insert into public.attendance_self_marks(id, employee_id, hub_id, zone_id, work_date,
    kind, marked_at, status, decided_as, decided_at)
select fixture_id(i), fixture_id(32), fixture_id(case i when 74 then 2 else 1 end), fixture_id(10),
  (now() at time zone 'Asia/Dhaka')::date, 'present',
  case i when 76 then now() + interval '1 day' else now() end,
  case i when 75 then 'waiting' else 'approved' end, 'present', now()
from generate_series(73, 77) i;
update public.attendance_self_marks set employee_id = fixture_id(31) where id = fixture_id(77);
insert into public.tasks(id, job_duty_id, title, zone_id, hub_id, assigned_to, accountable_manager_id,
  related_employee_id, due_date, requires_submission, duty_period_start, duty_due_at,
  duty_mode, duty_reviewer_role)
values (fixture_id(81), fixture_id(61), 'Previous duty', fixture_id(10), fixture_id(1), fixture_id(22),
  fixture_id(21), fixture_id(32), (now() at time zone 'Asia/Dhaka')::date - 2, true,
  (now() at time zone 'Asia/Dhaka')::date - 2, now() - interval '48 hours', 'manual','hub_manager');

set local role service_role;
select public.fixture_assert((public.duty_run(public.fixture_id(1))->>'inserted')::int = 12, 'daily/weekly/monthly generation');
select public.fixture_assert(public.duty_run(public.fixture_id(1)) = '{"inserted":0,"verified":0,"notified":0,"escalated":0}', 'retry idempotency');
reset role;
select public.fixture_assert((select count(*) = 1 from public.tasks where duty_evidence_id = fixture_id(71)
  and assigned_to = fixture_id(21) and status = 'completed'), 'morning report credits its real submitter only');
select public.fixture_assert((select count(*) = 1 from public.tasks where job_duty_id = fixture_id(61)
  and assigned_to = fixture_id(22) and status = 'assigned' and id <> fixture_id(81)), 'auto-submission cannot credit employee');
select public.fixture_assert((select count(*) = 2 from public.tasks where duty_excused and related_employee_id = fixture_id(35)), 'approved leave');
select public.fixture_assert((select bool_and((duty_due_at at time zone 'Asia/Dhaka') = due_date + time '12:00')
  from public.tasks where job_duty_id in (fixture_id(63),fixture_id(64))), 'Dhaka deadline');
select public.fixture_assert((select duty_overdue_notified_at is not null and duty_escalated_at is not null
  from public.tasks where id = fixture_id(81)), 'notification and escalation');
select public.fixture_assert((select count(*) = 3 from public.notifications where body = 'Previous duty'), 'one notification per recipient');
select public.fixture_assert(not has_function_privilege('anon', 'public.duty_report(date,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.duty_run(uuid)', 'EXECUTE'), 'RPC grants');

select set_config('request.jwt.claim.sub', fixture_id(22)::text, true);
set local role authenticated;
do $$
declare t uuid; bad integer;
begin
  select id into strict t from public.tasks where job_duty_id = public.fixture_id(62) and assigned_to = auth.uid();
  if exists (select 1 from public.tasks where job_duty_id is not null and assigned_to <> auth.uid()) then
    raise exception 'Employee task RLS leak';
  end if;
  perform public.duty_submit(t, 'Reason', null, true);
  foreach bad in array array[71,74,75,76,77] loop
    begin
      perform public.duty_submit(t, 'Checked', public.fixture_id(bad));
      raise exception 'Wrong source, hub, approval or time was accepted';
    exception when sqlstate '22023' then null;
    end;
  end loop;
  perform public.duty_submit(t, 'Checked', public.fixture_id(73));
  begin
    perform public.duty_review(t, true);
    raise exception 'Self-review was accepted';
  exception when insufficient_privilege then null;
  end;
  perform public.fixture_assert((select count(*) = 1 from public.duty_report(
    (now() at time zone 'Asia/Dhaka')::date,'daily')), 'own daily report');
end
$$;
reset role;

do $$
declare t uuid; actor integer;
begin
  select id into strict t from public.tasks where job_duty_id = fixture_id(62)
    and assigned_to = fixture_id(22);
  foreach actor in array array[21,23,24] loop
    perform set_config('request.jwt.claim.sub', fixture_id(actor)::text, true);
    begin
      perform public.duty_review(t, true);
      raise exception 'Wrong-role/hub/zone review was accepted';
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', fixture_id(26)::text, true);
  perform public.duty_review(t, false, 'Add explanation');
  perform set_config('request.jwt.claim.sub', fixture_id(22)::text, true);
  perform public.duty_submit(t, 'Updated explanation', fixture_id(73));
  perform set_config('request.jwt.claim.sub', fixture_id(26)::text, true);
  perform public.duty_review(t, true);
  perform public.fixture_assert((select status = 'completed' and duty_evidence_id = fixture_id(73)
    and completed_by = fixture_id(26) from public.tasks where id = t), 'independent zonal review keeps record ID');
end
$$;

select set_config('request.jwt.claim.sub', fixture_id(21)::text, true);
set local role authenticated;
do $$
declare t uuid; target integer;
begin
  select id into strict t from public.tasks where job_duty_id = public.fixture_id(63) and assigned_to = auth.uid();
  perform public.duty_submit(t, 'Weekly work');
  begin
    perform public.task_complete(t, null);
    raise exception 'Legacy self-approval bypass';
  exception when insufficient_privilege then null;
  end;
  foreach target in array array[23,24] loop
    begin
      perform public.task_assign('Out of scope', public.fixture_id(target), current_date,
        public.fixture_id(10), public.fixture_id(1), null, null, false, null, null);
      raise exception 'Cross-hub/zone assignment accepted';
    exception when insufficient_privilege then null;
    end;
  end loop;
  t := public.task_assign('Legacy task', public.fixture_id(22), current_date,
    public.fixture_id(10), public.fixture_id(1), null, null, false, null, null);
  begin
    perform public.task_reassign(t, public.fixture_id(24), current_date, 'Cross zone');
    raise exception 'Cross-zone reassignment accepted';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

select set_config('request.jwt.claim.sub', fixture_id(23)::text, true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.job_duties where hub_id = public.fixture_id(1)) then
    raise exception 'Cross-hub duty template RLS leak';
  end if;
  begin
    insert into public.job_duties(employee_id, hub_id, title, frequency, deadline_local)
    values(public.fixture_id(32), public.fixture_id(2), 'Wrong employee', 'daily', time '10:00');
    raise exception 'Cross-hub duty template assignment accepted';
  exception when insufficient_privilege then null;
  end;
  insert into public.job_duties(employee_id, hub_id, title, frequency, deadline_local)
  values(public.fixture_id(33), public.fixture_id(2), 'Own hub employee', 'daily', time '10:00');
end
$$;
reset role;

select set_config('request.jwt.claim.sub', fixture_id(25)::text, true);
set local role authenticated;
select public.duty_review((select id from public.tasks where job_duty_id = public.fixture_id(63)
  and assigned_to = public.fixture_id(21)), true);
select public.fixture_assert((select count(*) >= 1 from public.duty_report(
    (now() at time zone 'Asia/Dhaka')::date,'monthly')), 'manager monthly report');
reset role;

insert into public.wf_absence_applications(employee_id, hub_id, zone_id, status, dates)
values (fixture_id(32), fixture_id(1), fixture_id(10), 'approved', array[(now() at time zone 'Asia/Dhaka')::date]);
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select public.duty_run(public.fixture_id(1));
reset role;
select public.fixture_assert((select duty_excused from public.tasks where job_duty_id = fixture_id(61)
  and assigned_to = fixture_id(22) and id <> fixture_id(81)), 'newly approved absence reconciles an open duty');
select public.fixture_assert((select not duty_excused from public.tasks where job_duty_id = fixture_id(62)
  and assigned_to = fixture_id(22)), 'absence reconciliation preserves completed duties');
insert into public.issues values (fixture_id(78), fixture_id(1), fixture_id(10),
  'approved', now(), now(), fixture_id(26));
insert into public.issue_events values (fixture_id(78), 'solved', now(), fixture_id(22));
select public.fixture_assert((select count(*) = 1 from private.xzm013_evidence
  where source = 'problem_center' and id = fixture_id(78) and profile_id = fixture_id(22)),
  'Problem Center credits the recorded solver of an independently approved issue');
select 'xzm013 DEMO fixture passed' as result;
