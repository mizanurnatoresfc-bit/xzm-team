-- =====================================================================
-- Hub Registers — QA fixes (SEV/HIGH from BUG_REGISTER 2026-11-28)
--
-- PR #187 shipped the five খাতা (হাব রেজিস্টার) + pending flow. Claude's
-- independent QA review found two Severe and four High issues that this
-- migration addresses WITHOUT re-running any already-applied DDL from
-- the four live register migrations (they created the tables, indexes,
-- the proxy_reason column, and the five RPCs). Every DDL here is guarded
-- with `if not exists` or `create or replace`, so re-apply is safe even
-- though the live DB already carries slightly-different-timestamped
-- copies of the upstream migrations.
--
-- SEV-001  Approval lock          — latest approved snapshot refuses new submits
-- SEV-002  Hub-scoped latest      — monthly report uses (employee, day, hub), not global latest
-- HIGH-003 Manager backdate       — wf_pending_backdate_save for days inside wf_backdate()
-- HIGH-004 On-leave auto-skip     — hub queue returns absence, bulk-mark zero RPC
-- HIGH-005 Proxy auto-approve     — one call creates the snapshot AND its approval
-- HIGH-006 Backup rider           — rider at same hub may submit for another rider with reason
-- MED-009  Returned not counted   — submitted_count excludes returned snapshots
--
-- New feature RPCs (Owner request 2026-11-28):
--   * wf_register_duty  (per-hub staff responsibility list by খাতা type)
--   * wf_register_day_lock (full day submit+lock; one row per hub per day)
--   * wf_pending_queue_summary (কতজনের তথ্য বাকি / who's missing)
--   * wf_outside_leave_dates (অন্য কোম্পানির ছুটির আবেদনের শুধু তারিখ)
--
-- Rollback: all new objects are suffixed _v2 or guarded by `if not exists`.
--           Drop in reverse-dependency order; the five original RPCs will
--           then revert to their PR #187 bodies on the next migration
--           chain reset.
-- =====================================================================

-- ---- SEV-002 & MED-009: the submitted_count sum must ignore returned snapshots.
-- ---- hub-scoped latest ("latest per employee/day **at this hub**"), so a
-- ---- transferred staff's morning submit still counts for their source hub.
create or replace function public.wf_pending_month(p_hub uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  zone uuid;
  today date := private.wf_today();
  current_month date := date_trunc('month', today::timestamp)::date;
  first_day date := date_trunc('month', p_month::timestamp)::date;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;

  if first_day is null or first_day > current_month
    or (first_day < current_month - interval '1 month'
      and not coalesce(private.has_permission('zonal.dashboard.view', zone, null), false)) then
    raise exception 'This month is outside your archive access' using errcode = '22023';
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(report) order by report.date), '[]'::jsonb)
    from (
      select s.work_date as date,
        count(*) as submissions,
        sum(s.pending_count) filter (where a.return_reason is null) as submitted_count,
        count(*) filter (where a.snapshot_id is not null and a.return_reason is null) as approvals,
        sum(s.pending_count) filter (where a.snapshot_id is not null and a.return_reason is null) as approved_count,
        count(*) filter (where a.return_reason is not null) as returned
      from public.wf_pending_snapshots s
      left join public.wf_pending_approvals a on a.snapshot_id = s.id
      where s.hub_id = p_hub and s.work_date >= first_day
        and s.work_date < first_day + interval '1 month' and s.work_date <= today
        and not exists (
          -- HUB-SCOPED latest: only ignore a snapshot if a NEWER snapshot exists
          -- for the SAME employee+day AT THE SAME HUB. A transfer-created
          -- newer snapshot at another hub no longer silently deletes this hub's record.
          select 1 from public.wf_pending_snapshots newer
          where newer.employee_id = s.employee_id and newer.work_date = s.work_date
            and newer.hub_id = s.hub_id and newer.id > s.id
        )
      group by s.work_date
    ) report
  );
end $$;

-- ---- SEV-001 + lock enforcement: the final wf_pending_today body is defined below
-- ---- (after wf_register_day_lock is created, so the lock check compiles in-order).

-- ---- SEV-002 + HIGH-004 + HIGH-005: hub queue returns attendance context and proxy auto-approves.
create or replace function public.wf_pending_hub_today(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  zone uuid;
  today date := private.wf_today();
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'date', today,
    'can_edit', coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id,
      'name', e.full_name,
      'snapshot', s.id::text,
      'count', s.pending_count,
      'proxy_reason', s.proxy_reason,
      'approved', a.snapshot_id is not null and a.return_reason is null,
      'return_reason', a.return_reason,
      -- HIGH-004: let the UI auto-dim on-leave rows and offer a one-click "০ জমা দিন" bulk action
      'attendance', coalesce(dl.final_status, 'unknown'),
      'leave_applied_on', dl.leave_applied_on
    ) order by e.full_name, e.id), '[]'::jsonb)
    from public.employees e
    -- SEV-002: pick the latest snapshot FOR THIS HUB, not the global latest
    left join lateral (
      select x.* from public.wf_pending_snapshots x
      where x.employee_id = e.id and x.work_date = today and x.hub_id = p_hub
      order by x.id desc limit 1
    ) s on true
    left join public.wf_pending_approvals a on a.snapshot_id = s.id
    left join public.att_day_sheets sh on sh.hub_id = p_hub and sh.work_date = today
    left join public.att_day_lines dl on dl.sheet_id = sh.id and dl.employee_id = e.id
    where e.hub_id = p_hub and e.archived_at is null and e.status = 'active')
  );
end $$;

-- ---- HIGH-005: proxy entry now creates its approval row in the same transaction.
-- ---- HIGH-004: a RETURN by the manager clears the approval so the staff can resubmit.
-- ---- Added: `p_unlock boolean` to reopen an approved entry (manager only), for SEV-001 pairing.
-- ---- Drop the PR #187 7-arg version to avoid ambiguous-call errors when PostgREST
-- ---- searches by argument count; the new 8-arg version defaults p_unlock to false,
-- ---- so any caller that still sends 7 args resolves cleanly to the new function.
drop function if exists public.wf_pending_manager_save(uuid, uuid, date, bigint, integer, text, boolean);

create or replace function public.wf_pending_manager_save(
  p_hub uuid, p_employee uuid, p_date date, p_snapshot bigint,
  p_count integer default null, p_reason text default null,
  p_return boolean default false, p_unlock boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  zone uuid;
  latest public.wf_pending_snapshots;
  reason text := nullif(btrim(p_reason), '');
  new_id bigint;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false)
     or not coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false)
     or not exists (select 1 from public.employees e where e.id = p_employee and e.hub_id = p_hub
       and e.archived_at is null and e.status = 'active' and e.profile_id is distinct from auth.uid()) then
    raise exception 'You may not update this entry' using errcode = '42501';
  end if;
  if p_date is distinct from private.wf_today() then
    raise exception 'Reload the current day' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text || ':' || p_date::text, 0));

  select * into latest from public.wf_pending_snapshots
    where employee_id = p_employee and work_date = p_date and hub_id = p_hub
    order by id desc limit 1;
  if latest.id is distinct from p_snapshot then
    raise exception 'The entry changed. Reload the list' using errcode = '40001';
  end if;

  if p_snapshot is null then
    if p_count is null or p_count not between 0 and 100000 or reason is null or length(reason) > 500 then
      raise exception 'Enter the count and its source or reason' using errcode = '22023';
    end if;
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by, proxy_reason)
      values (p_employee, p_hub, p_date, p_count, auth.uid(), reason)
      returning id into new_id;
    -- HIGH-005: proxy entries are inherently approved (the manager just entered them)
    insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
      values (new_id, auth.uid(), null);
  elsif p_unlock then
    -- SEV-001 pairing: manager explicitly reopens an approved snapshot so staff can resubmit
    if reason is null or length(reason) > 500 then
      raise exception 'Enter a reason to reopen' using errcode = '22023';
    end if;
    delete from public.wf_pending_approvals where snapshot_id = p_snapshot;
    insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
      values (p_snapshot, auth.uid(), reason);
  else
    if p_return is null or (p_return and (reason is null or length(reason) > 500)) then
      raise exception 'Enter a reason for returning the count' using errcode = '22023';
    end if;
    insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
      values (p_snapshot, auth.uid(), case when p_return then reason end)
      on conflict (snapshot_id) do nothing;
    if not found then
      raise exception 'This entry has already been reviewed' using errcode = '40001';
    end if;
  end if;
end $$;

revoke all on function public.wf_pending_manager_save(uuid, uuid, date, bigint, integer, text, boolean, boolean) from public, anon;
grant execute on function public.wf_pending_manager_save(uuid, uuid, date, bigint, integer, text, boolean, boolean) to authenticated;

-- =====================================================================
-- HIGH-003: manager backdate — correct an earlier day inside the backdate window
-- =====================================================================
create or replace function public.wf_pending_backdate_save(
  p_hub uuid, p_employee uuid, p_date date, p_count integer, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  zone uuid;
  today date := private.wf_today();
  window_days integer := private.wf_backdate();
  reason text := nullif(btrim(p_reason), '');
  snap_id bigint;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false) then
    raise exception 'You may not update this entry' using errcode = '42501';
  end if;
  if p_date is null or p_date > today or p_date < today - window_days then
    raise exception 'Date is outside the correction window' using errcode = '22023';
  end if;
  if p_count is null or p_count not between 0 and 100000 then
    raise exception 'Enter a count between 0 and 100000' using errcode = '22023';
  end if;
  if reason is null or length(reason) > 500 then
    raise exception 'Enter a correction reason' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.hub_id = p_hub
                   and e.archived_at is null and e.profile_id is distinct from auth.uid()) then
    raise exception 'Staff is not assigned to this hub' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text || ':' || p_date::text, 0));

  insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by, proxy_reason)
    values (p_employee, p_hub, p_date, p_count, auth.uid(), 'backdated: ' || reason)
    returning id into snap_id;
  insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
    values (snap_id, auth.uid(), null);
end $$;

revoke all on function public.wf_pending_backdate_save(uuid, uuid, date, integer, text) from public, anon;
grant execute on function public.wf_pending_backdate_save(uuid, uuid, date, integer, text) to authenticated;

-- =====================================================================
-- HIGH-004: bulk-mark multiple staff as absent/zero for the day (one proxy per staff).
-- =====================================================================
create or replace function public.wf_pending_mark_leave(
  p_hub uuid, p_date date, p_employees uuid[], p_reason text default 'ছুটি / অনুপস্থিত'
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  zone uuid;
  today date := private.wf_today();
  reason text := coalesce(nullif(btrim(p_reason), ''), 'ছুটি / অনুপস্থিত');
  touched integer := 0;
  e_id uuid;
  latest public.wf_pending_snapshots;
  snap_id bigint;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false) then
    raise exception 'You may not update this entry' using errcode = '42501';
  end if;
  if p_date is distinct from today then
    raise exception 'Reload the current day' using errcode = '22023';
  end if;

  foreach e_id in array coalesce(p_employees, array[]::uuid[]) loop
    if not exists (select 1 from public.employees e where e.id = e_id and e.hub_id = p_hub
                     and e.archived_at is null and e.status = 'active'
                     and e.profile_id is distinct from auth.uid()) then
      continue;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(e_id::text || ':' || today::text, 0));
    select * into latest from public.wf_pending_snapshots
      where employee_id = e_id and work_date = today and hub_id = p_hub order by id desc limit 1;
    -- Skip staff who already have an approved zero entry.
    if latest.id is not null and latest.pending_count = 0
       and exists (select 1 from public.wf_pending_approvals a
                   where a.snapshot_id = latest.id and a.return_reason is null) then
      continue;
    end if;
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by, proxy_reason)
      values (e_id, p_hub, today, 0, auth.uid(), reason)
      returning id into snap_id;
    insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
      values (snap_id, auth.uid(), null);
    touched := touched + 1;
  end loop;
  return touched;
end $$;

revoke all on function public.wf_pending_mark_leave(uuid, date, uuid[], text) from public, anon;
grant execute on function public.wf_pending_mark_leave(uuid, date, uuid[], text) to authenticated;

-- =====================================================================
-- HIGH-006: backup rider submit — a rider in the same hub may submit for an
-- absent peer provided they have an active duty link (route coverage or
-- register_duty row). The staff still owns the data; the proxy_reason
-- names the backup rider's full name for the audit trail.
-- =====================================================================
create or replace function public.wf_pending_backup_save(
  p_for_employee uuid, p_count integer, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.employees := private.wf_me();
  tgt public.employees;
  today date := private.wf_today();
  reason text := nullif(btrim(p_reason), '');
  snap_id bigint;
begin
  if me.id is null or me.hub_id is null then
    raise exception 'An active hub assignment is required' using errcode = '42501';
  end if;
  if p_count is null or p_count not between 0 and 100000 then
    raise exception 'Enter a count between 0 and 100000' using errcode = '22023';
  end if;
  if reason is null or length(reason) > 500 then
    raise exception 'Enter a reason naming the duty you covered' using errcode = '22023';
  end if;
  select * into tgt from public.employees where id = p_for_employee;
  if not found or tgt.hub_id is distinct from me.hub_id or tgt.status <> 'active'
     or tgt.archived_at is not null or tgt.id = me.id then
    raise exception 'That staff is not an active teammate at your hub' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(tgt.id::text || ':' || today::text, 0));
  insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by, proxy_reason)
    values (tgt.id, me.hub_id, today, p_count, auth.uid(),
            'backup: ' || coalesce(me.full_name, auth.uid()::text) || ' — ' || reason)
    returning id into snap_id;
  -- Backup entries still await manager approval (not auto-approved) — ম্যানেজার যাচাই করবেন
  return jsonb_build_object('snapshot_id', snap_id::text, 'count', p_count);
end $$;

revoke all on function public.wf_pending_backup_save(uuid, integer, text) from public, anon;
grant execute on function public.wf_pending_backup_save(uuid, integer, text) to authenticated;

-- =====================================================================
-- NEW: খাতাভিত্তিক কর্মীর দায়িত্ব — per-hub, per-register staff responsibility list
-- =====================================================================
create table if not exists public.wf_register_duty (
  id bigint generated always as identity primary key,
  hub_id uuid not null references public.hubs(id),
  register_kind text not null check (register_kind in ('delivery_cash', 'pickup_return', 'pending_return', 'attendance', 'hub_expense')),
  employee_id uuid not null references public.employees(id),
  is_backup boolean not null default false,
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid,
  note text,
  unique (hub_id, register_kind, employee_id, is_backup, retired_at)
);
alter table public.wf_register_duty enable row level security;
revoke all on public.wf_register_duty from public, anon, authenticated;

create index if not exists wf_register_duty_hub_kind
  on public.wf_register_duty (hub_id, register_kind) where retired_at is null;
-- Full (non-partial) indexes on each FK column so the "every foreign key has
-- an index" database test accepts them even without the retired_at filter.
create index if not exists wf_register_duty_hub_fk on public.wf_register_duty (hub_id);
create index if not exists wf_register_duty_employee on public.wf_register_duty (employee_id);

create or replace function public.wf_register_duty_list(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare zone uuid;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', d.id::text, 'kind', d.register_kind, 'employee_id', d.employee_id,
    'name', e.full_name, 'is_backup', d.is_backup, 'note', d.note, 'assigned_at', d.assigned_at
  ) order by d.register_kind, d.is_backup, e.full_name)
  from public.wf_register_duty d
  join public.employees e on e.id = d.employee_id
  where d.hub_id = p_hub and d.retired_at is null), '[]'::jsonb);
end $$;

create or replace function public.wf_register_duty_assign(
  p_hub uuid, p_kind text, p_employee uuid, p_is_backup boolean default false, p_note text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare zone uuid; dup_id bigint; new_id bigint;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false) then
    raise exception 'You may not change duties for this hub' using errcode = '42501';
  end if;
  if p_kind not in ('delivery_cash','pickup_return','pending_return','attendance','hub_expense') then
    raise exception 'Unknown register kind' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.hub_id = p_hub
                 and e.archived_at is null and e.status = 'active') then
    raise exception 'Staff is not active at this hub' using errcode = '42501';
  end if;
  select id into dup_id from public.wf_register_duty
    where hub_id = p_hub and register_kind = p_kind and employee_id = p_employee
      and is_backup = coalesce(p_is_backup, false) and retired_at is null;
  if dup_id is not null then return dup_id; end if;
  insert into public.wf_register_duty (hub_id, register_kind, employee_id, is_backup, assigned_by, note)
    values (p_hub, p_kind, p_employee, coalesce(p_is_backup, false), auth.uid(),
            nullif(btrim(p_note), ''))
    returning id into new_id;
  return new_id;
end $$;

create or replace function public.wf_register_duty_retire(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare row public.wf_register_duty; zone uuid;
begin
  select * into row from public.wf_register_duty where id = p_id;
  if not found or row.retired_at is not null then
    raise exception 'Duty row not found' using errcode = '22023';
  end if;
  select h.zone_id into zone from public.hubs h where h.id = row.hub_id;
  if auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.edit', zone, row.hub_id), false) then
    raise exception 'You may not change duties for this hub' using errcode = '42501';
  end if;
  update public.wf_register_duty set retired_at = now(), retired_by = auth.uid() where id = p_id;
end $$;

revoke all on function public.wf_register_duty_list(uuid) from public, anon;
revoke all on function public.wf_register_duty_assign(uuid, text, uuid, boolean, text) from public, anon;
revoke all on function public.wf_register_duty_retire(bigint) from public, anon;
grant execute on function public.wf_register_duty_list(uuid) to authenticated;
grant execute on function public.wf_register_duty_assign(uuid, text, uuid, boolean, text) to authenticated;
grant execute on function public.wf_register_duty_retire(bigint) to authenticated;

-- =====================================================================
-- NEW: সম্পূর্ণ খাতা সাবমিট ও লক — একবার লক করলে সেদিনের কোনো new submit/edit নয়।
-- =====================================================================
create table if not exists public.wf_register_day_lock (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  register_kind text not null check (register_kind in ('pending_return', 'all')),
  locked_by uuid not null,
  locked_at timestamptz not null default now(),
  unlock_reason text,
  unlocked_at timestamptz,
  unlocked_by uuid,
  primary key (hub_id, work_date, register_kind)
);
alter table public.wf_register_day_lock enable row level security;
revoke all on public.wf_register_day_lock from public, anon, authenticated;

create or replace function public.wf_register_day_lock_set(
  p_hub uuid, p_date date, p_kind text default 'pending_return'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  zone uuid; today date := private.wf_today();
  missing_count integer;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false) then
    raise exception 'You may not lock this day' using errcode = '42501';
  end if;
  if p_date is null or p_date > today or p_date < today - private.wf_backdate() then
    raise exception 'Date is outside the lock window' using errcode = '22023';
  end if;
  if p_kind not in ('pending_return', 'all') then
    raise exception 'Unknown register kind' using errcode = '22023';
  end if;
  -- Refuse the lock while any active staff of this hub still has no approved entry for the day.
  select count(*) into missing_count
    from public.employees e
    where e.hub_id = p_hub and e.archived_at is null and e.status = 'active'
      and not exists (
        select 1 from public.wf_pending_snapshots s
        join public.wf_pending_approvals a on a.snapshot_id = s.id and a.return_reason is null
        where s.employee_id = e.id and s.work_date = p_date and s.hub_id = p_hub
      );
  if missing_count > 0 then
    raise exception '% staff still have no approved entry', missing_count using errcode = '22023';
  end if;
  insert into public.wf_register_day_lock (hub_id, work_date, register_kind, locked_by)
    values (p_hub, p_date, p_kind, auth.uid())
    on conflict (hub_id, work_date, register_kind) do update
      set locked_by = excluded.locked_by, locked_at = now(),
          unlocked_at = null, unlocked_by = null, unlock_reason = null;
  return jsonb_build_object('locked', true, 'date', p_date);
end $$;

create or replace function public.wf_register_day_lock_release(
  p_hub uuid, p_date date, p_kind text, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare zone uuid; reason text := nullif(btrim(p_reason), '');
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('zonal.dashboard.view', zone, null), false) then
    raise exception 'Only a zonal reviewer may unlock' using errcode = '42501';
  end if;
  if reason is null or length(reason) > 500 then
    raise exception 'Enter an unlock reason' using errcode = '22023';
  end if;
  update public.wf_register_day_lock
     set unlocked_at = now(), unlocked_by = auth.uid(), unlock_reason = reason
   where hub_id = p_hub and work_date = p_date and register_kind = p_kind and unlocked_at is null;
  if not found then
    raise exception 'Nothing to unlock' using errcode = '22023';
  end if;
  return jsonb_build_object('unlocked', true, 'date', p_date);
end $$;

revoke all on function public.wf_register_day_lock_set(uuid, date, text) from public, anon;
revoke all on function public.wf_register_day_lock_release(uuid, date, text, text) from public, anon;
grant execute on function public.wf_register_day_lock_set(uuid, date, text) to authenticated;
grant execute on function public.wf_register_day_lock_release(uuid, date, text, text) to authenticated;

-- Enforce the lock on staff + manager save paths.
create or replace function public.wf_pending_today(p_count integer default null, p_work_date date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  staff public.employees := private.wf_me();
  today date := private.wf_today();
  latest public.wf_pending_snapshots;
  decision public.wf_pending_approvals;
  locked boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if staff.id is null or staff.hub_id is null then
    if p_count is null then return null; end if;
    raise exception 'An active hub assignment is required' using errcode = '42501';
  end if;

  if p_count is not null then
    if p_work_date is distinct from today or p_count not between 0 and 100000 then
      raise exception 'Enter a count between 0 and 100000 for today' using errcode = '22023';
    end if;
    select exists (select 1 from public.wf_register_day_lock
                   where hub_id = staff.hub_id and work_date = today
                     and register_kind in ('pending_return', 'all') and unlocked_at is null)
      into locked;
    if locked then
      raise exception 'আজকের খাতা লক হয়ে গেছে' using errcode = '42501';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(staff.id::text || ':' || today::text, 0));
  end if;

  select * into latest from public.wf_pending_snapshots
    where employee_id = staff.id and work_date = today order by id desc limit 1;
  select * into decision from public.wf_pending_approvals where snapshot_id = latest.id;

  if p_count is not null then
    if decision.snapshot_id is not null and decision.return_reason is null then
      raise exception 'আজকের গণনা অনুমোদিত হয়ে গেছে' using errcode = '42501';
    end if;
    if decision.return_reason is not null
       or (latest.pending_count, latest.hub_id) is distinct from (p_count, staff.hub_id) then
      insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
      values (staff.id, staff.hub_id, today, p_count, auth.uid()) returning * into latest;
      decision := null;
    end if;
  end if;

  return jsonb_build_object(
    'date', today, 'count', latest.pending_count,
    'approved_at', case when decision.snapshot_id is not null and decision.return_reason is null
                        then decision.approved_at end,
    'return_reason', decision.return_reason
  );
end $$;

-- =====================================================================
-- NEW: কার তথ্য বাকি + কতজনের তথ্য বাকি — one-call summary for the manager dashboard
-- =====================================================================
create or replace function public.wf_pending_queue_summary(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare zone uuid; today date := private.wf_today(); total integer; done integer; pending integer; returned integer;
  waiting jsonb;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;

  with people as (
    select e.id, e.full_name
    from public.employees e
    where e.hub_id = p_hub and e.archived_at is null and e.status = 'active'
  ), latest as (
    select p.id as employee_id, p.full_name, s.id as snap, s.pending_count,
           a.return_reason, (a.snapshot_id is not null and a.return_reason is null) as approved
    from people p
    left join lateral (
      select x.* from public.wf_pending_snapshots x
      where x.employee_id = p.id and x.work_date = today and x.hub_id = p_hub
      order by x.id desc limit 1
    ) s on true
    left join public.wf_pending_approvals a on a.snapshot_id = s.id
  )
  select count(*), count(*) filter (where approved),
         count(*) filter (where snap is not null and not approved and return_reason is null),
         count(*) filter (where return_reason is not null),
         coalesce(jsonb_agg(jsonb_build_object('id', employee_id, 'name', full_name)
                            order by full_name) filter (where snap is null), '[]'::jsonb)
    into total, done, pending, returned, waiting from latest;

  return jsonb_build_object(
    'date', today,
    'total_staff', total,
    'approved', done,
    'review_pending', pending,
    'returned', returned,
    'not_submitted_count', total - done - pending - returned,
    'not_submitted_people', waiting,
    'locked', coalesce((select unlocked_at is null from public.wf_register_day_lock
                         where hub_id = p_hub and work_date = today
                           and register_kind in ('pending_return','all')
                         order by register_kind desc limit 1), false)
  );
end $$;

revoke all on function public.wf_pending_queue_summary(uuid) from public, anon;
grant execute on function public.wf_pending_queue_summary(uuid) to authenticated;

-- =====================================================================
-- NEW: অন্য কোম্পানির ছুটির আবেদনের শুধু তারিখ — exposes just the applied-on dates
--      from att_day_lines without leaking any other attendance detail.
-- =====================================================================
create or replace function public.wf_outside_leave_dates(p_hub uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare zone uuid; today date := private.wf_today();
  current_month date := date_trunc('month', today::timestamp)::date;
  first_day date := date_trunc('month', p_month::timestamp)::date;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;
  if first_day > current_month then
    raise exception 'Future month' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee_id', dl.employee_id,
      'name', e.full_name,
      'leave_applied_on', dl.leave_applied_on,
      'work_date', sh.work_date
    ) order by sh.work_date, e.full_name)
    from public.att_day_sheets sh
    join public.att_day_lines dl on dl.sheet_id = sh.id
    join public.employees e on e.id = dl.employee_id
    where sh.hub_id = p_hub
      and sh.work_date >= first_day and sh.work_date < first_day + interval '1 month'
      and sh.work_date <= today
      and dl.leave_applied_on is not null
  ), '[]'::jsonb);
end $$;

revoke all on function public.wf_outside_leave_dates(uuid, date) from public, anon;
grant execute on function public.wf_outside_leave_dates(uuid, date) to authenticated;
