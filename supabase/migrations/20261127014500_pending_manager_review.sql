alter table public.wf_pending_snapshots add column proxy_reason text
  check (length(btrim(proxy_reason)) between 1 and 500);

create table public.wf_pending_approvals (
  snapshot_id bigint primary key references public.wf_pending_snapshots(id),
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  return_reason text check (length(btrim(return_reason)) between 1 and 500)
);
alter table public.wf_pending_approvals enable row level security;
revoke all on public.wf_pending_approvals from public, anon, authenticated;

create function public.wf_pending_hub_today(p_hub uuid)
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
      'employee_id', e.id, 'name', e.full_name, 'snapshot', s.id::text, 'count', s.pending_count,
      'proxy_reason', s.proxy_reason, 'approved', a.snapshot_id is not null and a.return_reason is null, 'return_reason', a.return_reason
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

create function public.wf_pending_manager_save(
  p_hub uuid, p_employee uuid, p_date date, p_snapshot bigint,
  p_count integer default null, p_reason text default null, p_return boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  zone uuid;
  latest public.wf_pending_snapshots;
  reason text := nullif(btrim(p_reason), '');
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
      raise exception 'This entry has already been reviewed' using errcode = '40001';
    end if;
  end if;
end $$;

revoke all on function public.wf_pending_hub_today(uuid) from public, anon;
revoke all on function public.wf_pending_manager_save(uuid, uuid, date, bigint, integer, text, boolean) from public, anon;
grant execute on function public.wf_pending_hub_today(uuid) to authenticated;
grant execute on function public.wf_pending_manager_save(uuid, uuid, date, bigint, integer, text, boolean) to authenticated;

-- Staff see the decision for their latest submission and may resubmit a returned count.
create or replace function public.wf_pending_today(p_count integer default null, p_work_date date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  staff public.employees := private.wf_me();
  today date := private.wf_today();
  latest public.wf_pending_snapshots;
  returned text;
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

  select a.return_reason into returned from public.wf_pending_approvals a where a.snapshot_id = latest.id;

  if p_count is not null and
    (returned is not null or (latest.pending_count, latest.hub_id) is distinct from (p_count, staff.hub_id)) then
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
    values (staff.id, staff.hub_id, today, p_count, auth.uid())
    returning * into latest;
    returned := null;
  end if;

  return jsonb_build_object('date', today, 'count', latest.pending_count, 'return_reason', returned);
end;
$$;
