-- Enforce release policy before creating an Accounts sheet and on both Fleet daily-check RPCs.
create or replace function public.da_start_session(p_hub uuid, p_date date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_today date := private.da_today();
  v_date  date := coalesce(p_date, private.da_today());
  v_start text := coalesce(private.setting_text('da.start_time'), '00:00');
  v_id    uuid;
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised to start daily accounts for this hub.' using errcode = '42501';
  end if;
  perform public.module_release_require('accounts', p_hub);
  if exists (select 1 from public.hubs where id = p_hub and (status <> 'active' or archived_at is not null)) then
    raise exception 'This hub is not active.' using errcode = '22023';
  end if;
  if v_date > v_today or v_date < v_today - coalesce(private.setting_text('da.backdate_days')::integer, 3) then
    raise exception 'The date is outside the allowed period.' using errcode = '22023';
  end if;
  if v_date = v_today and (now() at time zone coalesce(private.setting_text('da.timezone'), 'Asia/Dhaka'))::time < v_start::time then
    raise exception 'Today''s account can be started from % only.', v_start using errcode = '22023';
  end if;
  if exists (select 1 from public.da_sessions where hub_id = p_hub and account_date = v_date) then
    raise exception 'A daily account sheet for this hub and date already exists.' using errcode = '23505';
  end if;
  insert into public.da_sessions (hub_id, zone_id, account_date, started_by, started_by_employee, started_by_name, started_by_code)
  values (p_hub, v_zone, v_date, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code())
  returning id into v_id;
  perform private.da_event(v_id, 'started', null, false);
  perform public.da_apply_fixed(v_id);
  return v_id;
end $$;

create or replace function public.fleet_daily_checks(p_date date, p_vehicle uuid default null)
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
    and private.release_api_allowed('fleet', v.hub_id)
    and (
      private.has_permission('vehicle.check.view', v.zone_id, v.hub_id)
      or private.has_permission('vehicle.check.approve', v.zone_id, v.hub_id)
      or (p_vehicle is not null and exists (
        select 1 from public.vehicle_assignments a
        where a.vehicle_id = v.id and a.employee_id = private.my_employee_id() and a.effective_to is null
      ))
    )
$$;

create or replace function public.fleet_daily_check_save(
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
  perform public.module_release_require('fleet', v.hub_id);
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
