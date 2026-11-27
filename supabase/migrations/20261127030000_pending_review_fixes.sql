-- Hub pending counts: close the review gaps found when the hub register was walked as staff, hub manager and zonal manager.
--  1. A manager's own count could never be approved: the hub manager saw buttons that always failed and the zonal manager
--     (view only) had none. Now a zonal manager may APPROVE or RETURN counts of the hubs of the zone (not enter them), and
--     the review queue says which row is the caller's own so the page can hide the buttons.
--  2. Staff could overwrite an approved count and silently lose the approval. An approved count is now locked for the
--     staff member; the manager can send it back with a reason, which unlocks it. Staff also see "approved".
--     A hub manager does not decide on a zonal manager's count (entering or reviewing): that needs a company-wide edit right.
--  3. Staff get their own month of pending counts (current and previous month), like the month of pickups/deliveries.

-- A person who holds the zonal dashboard right (zone or company scope) is above the hub manager in this book.
create function private.wf_pending_is_zonal(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    join public.user_roles ur on ur.user_id = e.profile_id
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
    where e.id = p_employee and ur.revoked_at is null
      and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
      and ur.scope_type in ('zone', 'global')
      and (p.code = 'zonal.dashboard.view' or r.is_super)
  )
$$;
revoke all on function private.wf_pending_is_zonal(uuid) from public, anon, authenticated;

create or replace function public.wf_pending_today(p_count integer default null, p_work_date date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  staff public.employees := private.wf_me();
  today date := private.wf_today();
  latest public.wf_pending_snapshots;
  decision public.wf_pending_approvals;
  approved boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if staff.id is null or staff.hub_id is null then
    if p_count is null then return null; end if;
    raise exception 'An active hub assignment is required' using errcode = '42501';
  end if;

  if p_count is not null then
    if p_work_date is distinct from today or p_count not between 0 and 100000 then
      raise exception 'Enter a count between 0 and 100000 for today' using errcode = '22023';
    end if;

    -- Serialize submissions from multiple tabs for the same employee and day.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(staff.id::text || ':' || today::text, 0));
  end if;
  select * into latest
    from public.wf_pending_snapshots
    where employee_id = staff.id and work_date = today
    order by id desc limit 1;

  select * into decision from public.wf_pending_approvals a where a.snapshot_id = latest.id;
  approved := decision.snapshot_id is not null and decision.return_reason is null;

  if p_count is not null then
    if approved and (latest.pending_count, latest.hub_id) is distinct from (p_count, staff.hub_id) then
      raise exception 'This count is already approved. Ask your manager to send it back first' using errcode = '22023';
    end if;
    if decision.return_reason is not null or (latest.pending_count, latest.hub_id) is distinct from (p_count, staff.hub_id) then
      insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
      values (staff.id, staff.hub_id, today, p_count, auth.uid())
      returning * into latest;
      decision := null;
      approved := false;
    end if;
  end if;

  return jsonb_build_object('date', today, 'count', latest.pending_count,
    'return_reason', decision.return_reason, 'approved', coalesce(approved, false));
end;
$$;

create or replace function public.wf_pending_hub_today(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  zone uuid;
  today date := private.wf_today();
  can_edit boolean;
  company boolean;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;
  can_edit := coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false);
  company := coalesce(private.has_permission('ops.staff_daily.edit', null, null), false);

  return jsonb_build_object(
    'date', today,
    'can_edit', can_edit,
    'can_review', can_edit or coalesce(private.has_permission('zonal.dashboard.view', zone, null), false),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'name', e.full_name, 'snapshot', s.id::text, 'count', s.pending_count,
      'proxy_reason', s.proxy_reason, 'approved', a.snapshot_id is not null and a.return_reason is null,
      'return_reason', a.return_reason, 'is_self', e.profile_id is not distinct from auth.uid(),
      'above_you', not company and private.wf_pending_is_zonal(e.id)
    ) order by e.full_name, e.id), '[]'::jsonb)
    from public.employees e
    left join lateral (
      select x.* from public.wf_pending_snapshots x
      where x.employee_id = e.id and x.work_date = today
      order by x.id desc limit 1
    ) s on s.hub_id = p_hub
    left join public.wf_pending_approvals a on a.snapshot_id = s.id
    where e.hub_id = p_hub and e.archived_at is null and e.status = 'active')
  );
end $$;

create or replace function public.wf_pending_manager_save(
  p_hub uuid, p_employee uuid, p_date date, p_snapshot bigint,
  p_count integer default null, p_reason text default null, p_return boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  zone uuid;
  latest public.wf_pending_snapshots;
  reason text := nullif(btrim(p_reason), '');
  allowed boolean;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  -- Entering a count for someone needs the edit right; approving or returning one also allows the zonal manager of the zone.
  allowed := found and auth.uid() is not null
    and coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false)
    and (coalesce(private.has_permission('ops.staff_daily.edit', zone, p_hub), false)
      or (p_snapshot is not null and coalesce(private.has_permission('zonal.dashboard.view', zone, null), false)));
  if not coalesce(allowed, false)
     or (private.wf_pending_is_zonal(p_employee) and not coalesce(private.has_permission('ops.staff_daily.edit', null, null), false))
     or not exists (select 1 from public.employees e where e.id = p_employee and e.hub_id = p_hub
       and e.archived_at is null and e.status = 'active' and e.profile_id is distinct from auth.uid()) then
    raise exception 'You may not update this entry' using errcode = '42501';
  end if;
  if p_date is distinct from private.wf_today() then
    raise exception 'Reload the current day' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text || ':' || p_date::text, 0));
  select * into latest from public.wf_pending_snapshots
    where employee_id = p_employee and work_date = p_date order by id desc limit 1;
  if latest.hub_id is distinct from p_hub then
    latest := null;
  end if;
  if latest.id is distinct from p_snapshot then
    raise exception 'The entry changed. Reload the list' using errcode = '40001';
  end if;

  if p_snapshot is null then
    if p_count is null or p_count not between 0 and 100000 or reason is null or length(reason) > 500 then
      raise exception 'Enter the count and its source or reason' using errcode = '22023';
    end if;
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by, proxy_reason)
      values (p_employee, p_hub, p_date, p_count, auth.uid(), reason);
  else
    if p_return is null or (p_return and (reason is null or length(reason) > 500)) then
      raise exception 'Enter a reason for returning the count' using errcode = '22023';
    end if;
    insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
      values (p_snapshot, auth.uid(), case when p_return then reason end)
      on conflict (snapshot_id) do nothing;
    if not found then
      -- Already decided. An approved count may still be sent back (the staff member can then correct it).
      update public.wf_pending_approvals
        set approved_by = auth.uid(), approved_at = now(), return_reason = reason
        where snapshot_id = p_snapshot and return_reason is null and p_return;
      if not found then
        raise exception 'This entry has already been reviewed' using errcode = '40001';
      end if;
    end if;
  end if;
end $$;

create function public.wf_pending_own_month(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  employee public.employees;
  current_month date := date_trunc('month', private.wf_today()::timestamp)::date;
  first_day date := date_trunc('month', p_month::timestamp)::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if first_day < current_month - interval '1 month' or first_day > current_month then
    raise exception 'Only the current and previous month are available' using errcode = '22023';
  end if;
  employee := private.wf_me();
  if employee.id is null or first_day is null then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', s.work_date, 'count', s.pending_count,
      'approved', a.snapshot_id is not null and a.return_reason is null, 'return_reason', a.return_reason
    ) order by s.work_date), '[]'::jsonb)
    from public.wf_pending_snapshots s
    left join public.wf_pending_approvals a on a.snapshot_id = s.id
    where s.employee_id = employee.id
      and s.work_date >= first_day and s.work_date < first_day + interval '1 month'
      and s.work_date <= private.wf_today()
      and not exists (select 1 from public.wf_pending_snapshots newer
        where newer.employee_id = s.employee_id and newer.work_date = s.work_date and newer.id > s.id)
  );
end;
$$;

revoke all on function public.wf_pending_own_month(date) from public, anon;
grant execute on function public.wf_pending_own_month(date) to authenticated;
