insert into public.permissions (code, module, resource, action, description)
values ('vehicle.check.view', 'vehicle', 'check', 'view', 'See daily fleet checks'),
       ('vehicle.check.approve', 'vehicle', 'check', 'approve', 'Confirm daily departures, charging and garage checks')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where (r.code in ('manager', 'hub_manager') and p.code in ('vehicle.check.view', 'vehicle.check.approve'))
   or (r.code = 'zonal_manager' and p.code = 'vehicle.check.view')
on conflict do nothing;

create table private.fleet_daily_checks (
  vehicle_id uuid not null references public.vehicles(id),
  hub_id uuid not null references public.hubs(id),
  check_date date not null,
  kind text not null,
  source text not null check (source in ('crew', 'manager')),
  state text not null,
  detail text,
  checked_by uuid not null,
  checked_name text,
  checked_at timestamptz not null default now(),
  primary key (vehicle_id, hub_id, check_date, kind, source),
  check (
    (kind = 'departure' and state in ('departed', 'no_trip')) or
    (kind = 'charge' and state in ('charging', 'charged', 'issue', 'not_needed')) or
    (kind = 'garage' and state in ('parked', 'outside', 'service'))
  ),
  check (state not in ('departed', 'no_trip', 'issue', 'outside', 'service') or nullif(btrim(detail), '') is not null)
);

alter table private.fleet_daily_checks enable row level security;
revoke all on private.fleet_daily_checks from public, anon, authenticated;

create function public.fleet_daily_checks(p_date date, p_vehicle uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', v.id, 'name', v.name, 'kind', v.kind, 'hub_id', v.hub_id, 'hub_name', h.name,
    'can_confirm', private.has_permission('vehicle.check.approve', v.zone_id, v.hub_id),
    'checks', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', c.kind, 'source', c.source, 'state', c.state, 'detail', c.detail,
      'checked_name', c.checked_name, 'checked_at', c.checked_at
    ) order by c.kind, c.source)
    from private.fleet_daily_checks c
    where c.vehicle_id = v.id and c.hub_id = v.hub_id and c.check_date = p_date), '[]'::jsonb)
  )), '[]'::jsonb)
  from public.vehicles v join public.hubs h on h.id = v.hub_id
  where auth.uid() is not null and v.archived_at is null and v.status <> 'inactive'
    and (p_vehicle is null or v.id = p_vehicle)
    and (
      private.has_permission('vehicle.check.view', v.zone_id, v.hub_id)
      or private.has_permission('vehicle.check.approve', v.zone_id, v.hub_id)
      or (p_vehicle is not null and exists (
        select 1 from public.vehicle_assignments a
        where a.vehicle_id = v.id and a.employee_id = private.my_employee_id() and a.effective_to is null
      ))
    )
$$;

create function public.fleet_daily_check_save(
  p_vehicle uuid, p_date date, p_kind text, p_source text, p_state text, p_detail text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.vehicles%rowtype;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null for share;
  if auth.uid() is null or not found or v.hub_id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_source = 'manager' then
    if not coalesce(private.has_permission('vehicle.check.approve', v.zone_id, v.hub_id), false) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
  elsif p_source = 'crew' then
    if not exists (
      select 1 from public.vehicle_assignments a
      where a.vehicle_id = v.id and a.employee_id = private.my_employee_id()
        and a.role = 'driver' and a.effective_to is null
    ) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'Invalid check source';
  end if;
  if p_date is distinct from private.da_today() or
    (p_kind in ('charge', 'garage') and v.kind <> 'auto') or
    length(coalesce(p_detail, '')) > 500 then
    raise exception 'Invalid daily check';
  end if;

  insert into private.fleet_daily_checks as c
    (vehicle_id, hub_id, check_date, kind, source, state, detail, checked_by, checked_name)
  values (v.id, v.hub_id, p_date, p_kind, p_source, p_state, nullif(btrim(p_detail), ''), auth.uid(), private.my_display_name())
  on conflict (vehicle_id, hub_id, check_date, kind, source) do update
    set state = excluded.state, detail = excluded.detail, checked_by = excluded.checked_by,
        checked_name = excluded.checked_name, checked_at = now()
  where (c.state, c.detail, c.checked_by) is distinct from (excluded.state, excluded.detail, excluded.checked_by);
end
$$;

revoke all on function public.fleet_daily_checks(date, uuid),
  public.fleet_daily_check_save(uuid, date, text, text, text, text) from public, anon;
grant execute on function public.fleet_daily_checks(date, uuid),
  public.fleet_daily_check_save(uuid, date, text, text, text, text) to authenticated;
