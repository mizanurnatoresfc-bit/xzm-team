insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'manager' and r.archived_at is null
  and p.code in ('org.hub.view', 'hr.attendance.view', 'hr.attendance.create', 'ops.staff_daily.view',
    'ops.staff_daily.edit', 'da.sheet.view', 'da.sheet.create')
on conflict do nothing;

-- Keep existing role menu choices, adding the pages linked by the hub register.
update public.role_dashboards d
set menu = d.menu || (select coalesce(jsonb_agg(path order by path), '[]')
  from jsonb_array_elements('["/app/attendance","/app/accounts/daily","/app/accounts/center"]') p(path)
  where not d.menu @> jsonb_build_array(path))
from public.roles r
where d.role_id = r.id and r.code = 'manager' and r.archived_at is null
  and d.menu is not null and not d.menu @> '["/app/attendance","/app/accounts/daily","/app/accounts/center"]';

create function public.wf_pending_hub_on(p_hub uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone uuid;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub and h.archived_at is null;
  if not found or auth.uid() is null or not private.has_permission('ops.staff_daily.view', zone, p_hub) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;
  if p_date is null or p_date > private.wf_today() then
    raise exception 'Choose a valid register date' using errcode = '22023';
  end if;
  return jsonb_build_object('date', p_date, 'can_edit', private.has_permission('ops.staff_daily.edit', zone, p_hub),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'name', e.full_name, 'snapshot', s.id::text, 'count', s.pending_count,
      'proxy_reason', s.proxy_reason, 'approved', a.snapshot_id is not null and a.return_reason is null,
      'return_reason', a.return_reason, 'can_review', e.profile_id is distinct from auth.uid()
    ) order by e.full_name, e.id), '[]'::jsonb)
    from public.employees e
    left join lateral (
      select x.id, x.hub_id, x.pending_count, x.proxy_reason from public.wf_pending_snapshots x
      where x.employee_id = e.id and x.work_date = p_date order by x.id desc limit 1
    ) s on s.hub_id = p_hub
    left join public.wf_pending_approvals a on a.snapshot_id = s.id
    where s.id is not null or (e.hub_id = p_hub and e.archived_at is null and e.status = 'active')
    ));
end
$$;
revoke all on function public.wf_pending_hub_on(uuid, date) from public, anon;
grant execute on function public.wf_pending_hub_on(uuid, date) to authenticated;

create or replace function public.wf_pending_manager_save(
  p_hub uuid, p_employee uuid, p_date date, p_snapshot bigint,
  p_count integer default null, p_reason text default null, p_return boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  zone uuid;
  latest public.wf_pending_snapshots;
  employee public.employees;
  reason text := nullif(btrim(p_reason), '');
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub and h.archived_at is null;
  if not found or auth.uid() is null or not private.has_permission('ops.staff_daily.view', zone, p_hub)
     or not private.has_permission('ops.staff_daily.edit', zone, p_hub) then
    raise exception 'You may not update this entry' using errcode = '42501';
  end if;
  select * into employee from public.employees e where e.id = p_employee and e.profile_id is distinct from auth.uid();
  if not found then
    raise exception 'You may not update this entry' using errcode = '42501';
  end if;
  if p_date is null or p_date > private.wf_today() or p_return is null then
    raise exception 'Choose a valid register date' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee::text || ':' || p_date::text, 0));
  select * into latest from public.wf_pending_snapshots
    where employee_id = p_employee and work_date = p_date order by id desc limit 1;
  if latest.hub_id is distinct from p_hub then
    latest := null;
  end if;
  if latest.id is distinct from p_snapshot then
    raise exception 'The entry changed. Reload the list' using errcode = '40001';
  end if;
  if latest.id is null and (employee.hub_id is distinct from p_hub
    or employee.archived_at is not null or employee.status <> 'active') then
    raise exception 'You may not update this entry' using errcode = '42501';
  end if;

  if p_snapshot is null or p_count is not null then
    if p_return or p_count is null or p_count not between 0 and 100000 or reason is null or length(reason) > 500 then
      raise exception 'Enter the count and its source or reason' using errcode = '22023';
    end if;
    if p_snapshot is not null and not exists (
      select 1 from public.wf_pending_approvals a where a.snapshot_id = p_snapshot and a.return_reason is not null
    ) then
      raise exception 'Only a returned entry can be replaced' using errcode = '22023';
    end if;
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by, proxy_reason)
      values (p_employee, p_hub, p_date, p_count, auth.uid(), reason);
  else
    if p_return and (reason is null or length(reason) > 500) then
      raise exception 'Enter a reason for returning the count' using errcode = '22023';
    end if;
    insert into public.wf_pending_approvals (snapshot_id, approved_by, return_reason)
      values (p_snapshot, auth.uid(), case when p_return then reason end)
      on conflict (snapshot_id) do nothing;
    if not found then
      raise exception 'This entry has already been reviewed' using errcode = '40001';
    end if;
  end if;
end
$$;

create table private.wf_hub_register_submissions (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  version integer not null check (version > 0),
  sources jsonb not null,
  source_key text not null,
  manual jsonb not null,
  totals jsonb not null,
  note text check (length(note) <= 500),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  primary key (hub_id, work_date, version)
);
alter table private.wf_hub_register_submissions enable row level security;
revoke all on private.wf_hub_register_submissions from public, anon, authenticated;

create function private.wf_hub_register_source(p_hub uuid, p_date date)
returns jsonb
language sql stable set search_path = '' as $$
  with ops as (
    select o.id, o.revision, d.status, o.pickup, o.pickup_return, o.delivery, o.delivery_return
    from public.wf_daily_ops o
    left join public.wf_ops_decisions d on (d.entry_id, d.revision) = (o.id, o.revision)
    where o.hub_id = p_hub and o.work_date = p_date
  ), pending as (
    select s.id, s.pending_count, a.snapshot_id is not null and a.return_reason is null as approved
    from public.wf_pending_snapshots s
    left join public.wf_pending_approvals a on a.snapshot_id = s.id
    where s.hub_id = p_hub and s.work_date = p_date
      and not exists (
        select 1 from public.wf_pending_snapshots latest
        where latest.employee_id = s.employee_id and latest.work_date = s.work_date and latest.id > s.id
      )
  ), ops_summary as (
    select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]') as rows,
      count(*) filter (where status = 'approved') as approved,
      count(*) filter (where status is distinct from 'approved') as unresolved,
      coalesce(sum(pickup) filter (where status = 'approved'), 0) as pickup,
      coalesce(sum(pickup_return) filter (where status = 'approved'), 0) as pickup_return,
      coalesce(sum(delivery) filter (where status = 'approved'), 0) as delivery,
      coalesce(sum(delivery_return) filter (where status = 'approved'), 0) as delivery_return
    from ops o
  ), pending_summary as (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]') as rows,
      count(*) filter (where approved) as approved,
      count(*) filter (where not approved) as unresolved,
      coalesce(sum(pending_count) filter (where approved), 0) as total
    from pending p
  )
  select jsonb_build_object(
    'sources', jsonb_build_object('operations', o.rows, 'pending', p.rows),
    'approved_count', o.approved + p.approved,
    'unresolved_count', o.unresolved + p.unresolved,
    'staff_totals', jsonb_build_object('pickup', o.pickup, 'pickup_return', o.pickup_return,
      'delivery', o.delivery, 'delivery_return', o.delivery_return, 'pending', p.total)
  )
  from ops_summary o cross join pending_summary p
$$;
revoke all on function private.wf_hub_register_source(uuid, date) from public, anon, authenticated;

create function public.wf_hub_register_status(p_hub uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  current_source jsonb;
  submitted jsonb;
begin
  perform 1 from private.wf_hubs('ops.staff_daily.view', null, p_hub);
  if p_hub is null or p_date is null or p_date > private.wf_today() then
    raise exception 'Choose a hub and a valid register date' using errcode = '22023';
  end if;
  current_source := private.wf_hub_register_source(p_hub, p_date);
  select jsonb_build_object('version', s.version, 'source_key', s.source_key, 'manual', s.manual,
    'totals', s.totals, 'note', s.note, 'submitted_at', s.submitted_at)
  into submitted
  from private.wf_hub_register_submissions s
  where s.hub_id = p_hub and s.work_date = p_date
  order by s.version desc limit 1;
  return (current_source - 'sources') || jsonb_build_object(
    'source_key', md5((current_source->'sources')::text), 'submitted', submitted);
end
$$;

create function public.wf_hub_register_submit(p_hub uuid, p_date date, p_source_key text,
  p_version integer, p_manual jsonb, p_note text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  keys constant text[] := array['pickup', 'pickup_return', 'delivery', 'delivery_return', 'pending'];
  zone uuid;
  current_source jsonb;
  current_key text;
  previous private.wf_hub_register_submissions;
  new_totals jsonb;
  note text := nullif(btrim(p_note), '');
  has_manual boolean;
  next_version integer;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub and h.archived_at is null;
  if not found or auth.uid() is null
     or not private.has_permission('ops.staff_daily.view', zone, p_hub)
     or not private.has_permission('ops.staff_daily.edit', zone, p_hub) then
    raise exception 'You may not submit this hub register' using errcode = '42501';
  end if;
  if p_date is null or p_date > private.wf_today() or jsonb_typeof(p_manual) is distinct from 'object'
     or not (p_manual ?& keys) or p_manual - keys <> '{}'::jsonb or length(note) > 500 then
    raise exception 'Choose a valid date and enter five whole counts' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_manual) m where jsonb_typeof(m.value) <> 'number'
    or m.value::text !~ '^(0|[1-9][0-9]{0,5})$' or length(m.value::text) = 6 and m.value::text <> '100000') then
    raise exception 'Enter whole counts between 0 and 100000' using errcode = '22023';
  end if;
  select exists (select 1 from jsonb_each_text(p_manual) m where m.value <> '0') into has_manual;
  if has_manual and note is null then
    raise exception 'Enter a reason for the additional manager entries' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('wf_hub_register:' || p_hub::text || ':' || p_date::text, 0));
  current_source := private.wf_hub_register_source(p_hub, p_date);
  current_key := md5((current_source->'sources')::text);
  select * into previous from private.wf_hub_register_submissions s
    where s.hub_id = p_hub and s.work_date = p_date order by s.version desc limit 1;
  if current_key is distinct from p_source_key then
    raise exception 'Staff entries changed. Reload the hub register' using errcode = '40001';
  end if;
  if previous.source_key = current_key and previous.manual = p_manual and previous.note is not distinct from note then
    return previous.version;
  end if;
  if p_version is distinct from coalesce(previous.version, 0) then
    raise exception 'Another manager submitted a version. Reload the hub register' using errcode = '40001';
  end if;
  if (current_source->>'unresolved_count')::integer > 0 then
    raise exception 'Review or correct the outstanding entries before submitting the hub register' using errcode = '22023';
  end if;
  if (current_source->>'approved_count')::integer = 0 and note is null then
    raise exception 'The hub register has no entries' using errcode = '22023';
  end if;

  select jsonb_object_agg(m.key, (current_source->'staff_totals'->>m.key)::bigint + m.value::integer)
    into new_totals from jsonb_each_text(p_manual) m;
  next_version := coalesce(previous.version, 0) + 1;
  insert into private.wf_hub_register_submissions
    (hub_id, work_date, version, sources, source_key, manual, totals, note, submitted_by)
  values (p_hub, p_date, next_version, current_source->'sources', current_key, p_manual, new_totals, note, auth.uid());
  return next_version;
end
$$;

revoke all on function public.wf_hub_register_status(uuid, date) from public, anon;
revoke all on function public.wf_hub_register_submit(uuid, date, text, integer, jsonb, text) from public, anon;
grant execute on function public.wf_hub_register_status(uuid, date) to authenticated;
grant execute on function public.wf_hub_register_submit(uuid, date, text, integer, jsonb, text) to authenticated;
