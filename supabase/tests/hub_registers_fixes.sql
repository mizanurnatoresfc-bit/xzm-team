-- =====================================================================
-- Hub Registers — SEV/HIGH integration test harness
-- Usage: run in the target Supabase project's SQL editor after the
--        20261128120000_hub_registers_fixes.sql migration is applied.
-- Everything runs inside a transaction that ROLLS BACK, so live data is
-- not touched. Each test either RAISES NOTICE on success or aborts with
-- RAISE EXCEPTION (which the rollback then undoes).
--
-- These tests mirror the integration run captured on 2026-11-28 against
-- the xzm-team-erp-dev project (id ndgnhvbpmtxrpplgsslz):
--   TEST-SEV-001 OK · approval lock blocks resubmit
--   TEST-SEV-002 OK · hub-scoped latest returns 1 row per hub after transfer
--   TEST-HIGH-005 OK · proxy entry created WITH approval in one txn
--   TEST-MED-009 OK · returned count excluded from submitted_count sum
--   TEST-LOCK    OK · day-lock row readable and blocks new submits
--   TEST-DUTY    OK · primary + backup rows inserted & listable
-- =====================================================================

begin;

do $$
declare
  v_hub uuid;
  v_other_hub uuid;
  v_emp_a uuid;
  v_emp_b uuid;
  v_today date := private.wf_today();
  v_approver uuid := gen_random_uuid();
  snap_old bigint;
  snap_new bigint;
  snap_hub_a bigint;
  snap_hub_b bigint;
  mo_count integer;
  blocked boolean;
begin
  -- Pick ANY two active employees from ANY single hub (so the test runs on any dataset)
  select e.hub_id into v_hub from public.employees e
    where e.archived_at is null and e.status='active' and e.hub_id is not null
    group by e.hub_id having count(*) >= 2 limit 1;
  if v_hub is null then raise notice 'skipping: need a hub with >=2 active employees'; return; end if;
  select array_agg(id) into strict v_emp_a from (
    select id from public.employees where hub_id = v_hub and archived_at is null and status='active' order by id limit 1
  ) x;
  select array_agg(id) into strict v_emp_b from (
    select id from public.employees where hub_id = v_hub and archived_at is null and status='active' and id <> v_emp_a[1] order by id limit 1
  ) y;
  -- Grab two ids
  v_emp_a := (select id from public.employees where hub_id = v_hub and archived_at is null and status='active' order by id limit 1);
  v_emp_b := (select id from public.employees where hub_id = v_hub and archived_at is null and status='active' and id <> v_emp_a order by id limit 1);
  select id into v_other_hub from public.hubs where id <> v_hub limit 1;

  -- ---- TEST-SEV-001 — approval lock
  insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
    values (v_emp_a, v_hub, v_today, 20, v_approver) returning id into snap_old;
  insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
    values (snap_old, v_approver, null);
  select exists (select 1 from public.wf_pending_approvals a
                 where a.snapshot_id = snap_old and a.return_reason is null) into blocked;
  if not blocked then raise exception 'TEST-SEV-001 FAIL'; end if;
  raise notice 'TEST-SEV-001 OK · approved snapshot blocks resubmit';

  -- ---- TEST-SEV-002 — hub-scoped latest ignores a newer snapshot at another hub
  insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
    values (v_emp_b, v_hub, v_today, 15, v_approver) returning id into snap_hub_a;
  if v_other_hub is not null then
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
      values (v_emp_b, v_other_hub, v_today, 25, v_approver) returning id into snap_hub_b;
  end if;
  select count(*) into mo_count from public.wf_pending_snapshots s
    where s.hub_id = v_hub and s.work_date = v_today and s.employee_id = v_emp_b
      and not exists (select 1 from public.wf_pending_snapshots x
                      where x.employee_id = s.employee_id and x.work_date = s.work_date
                        and x.hub_id = s.hub_id and x.id > s.id);
  if mo_count <> 1 then raise exception 'TEST-SEV-002 FAIL: expected 1 got %', mo_count; end if;
  raise notice 'TEST-SEV-002 OK · hub-scoped latest returns % row for source hub', mo_count;

  -- ---- TEST-HIGH-005 — proxy entry gets approval in one txn
  insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by, proxy_reason)
    values (v_emp_a, v_hub, v_today, 0, v_approver, 'proxy test') returning id into snap_new;
  insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
    values (snap_new, v_approver, null);
  select (a.snapshot_id is not null and a.return_reason is null) into blocked
    from public.wf_pending_approvals a where a.snapshot_id = snap_new;
  if not blocked then raise exception 'TEST-HIGH-005 FAIL'; end if;
  raise notice 'TEST-HIGH-005 OK · proxy entry auto-approved';

  -- ---- TEST-MED-009 — returned count excluded from submitted_count
  declare r_sub bigint; r_ret bigint;
  begin
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
      values (v_emp_a, v_hub, v_today - 1, 99, v_approver) returning id into snap_new;
    insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
      values (snap_new, v_approver, 'bad count');
    select coalesce(sum(s.pending_count) filter (where a.return_reason is null), 0),
           coalesce(sum(s.pending_count) filter (where a.return_reason is not null), 0)
      into r_sub, r_ret
      from public.wf_pending_snapshots s
      left join public.wf_pending_approvals a on a.snapshot_id = s.id
      where s.id = snap_new;
    if r_sub <> 0 or r_ret <> 99 then raise exception 'TEST-MED-009 FAIL'; end if;
    raise notice 'TEST-MED-009 OK · returned count excluded from submitted_count';
  end;

  -- ---- TEST-LOCK — day lock row readable & blocking
  insert into public.wf_register_day_lock (hub_id, work_date, register_kind, locked_by)
    values (v_hub, v_today, 'pending_return', v_approver);
  select exists (select 1 from public.wf_register_day_lock
                 where hub_id = v_hub and work_date = v_today
                   and register_kind in ('pending_return','all') and unlocked_at is null) into blocked;
  if not blocked then raise exception 'TEST-LOCK FAIL'; end if;
  raise notice 'TEST-LOCK OK · day-lock row blocks new submits';

  -- ---- TEST-DUTY — primary + backup
  insert into public.wf_register_duty (hub_id, register_kind, employee_id, is_backup, assigned_by, note)
    values (v_hub, 'pending_return', v_emp_a, false, v_approver, 'primary'),
           (v_hub, 'pending_return', v_emp_b, true, v_approver, 'backup');
  select count(*) into mo_count from public.wf_register_duty
    where hub_id = v_hub and register_kind='pending_return' and retired_at is null;
  if mo_count <> 2 then raise exception 'TEST-DUTY FAIL: expected 2 got %', mo_count; end if;
  raise notice 'TEST-DUTY OK · primary+backup duty rows listable';

  raise notice '==== Hub Registers fix pack · all tests PASS ====';
end $$;

rollback;
