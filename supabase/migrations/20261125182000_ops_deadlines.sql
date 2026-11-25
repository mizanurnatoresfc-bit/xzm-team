-- Zone-level deadlines for the four daily operations figures. Empty times leave a figure unscheduled.
-- Times are wall-clock times in Asia/Dhaka. Report submissions and corrections keep their existing rules.
create table private.wf_ops_deadlines (
  zone_id uuid primary key references public.zones(id) on delete cascade,
  pickup time(0),
  pickup_return time(0),
  delivery time(0),
  delivery_return time(0)
);

alter table private.wf_ops_deadlines enable row level security;
revoke all on private.wf_ops_deadlines from public, anon, authenticated;

create or replace function public.wf_ops_deadlines_get(p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_zone uuid := p_zone;
  v_employee public.employees;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_zone is null then
    v_employee := private.wf_me();
    select h.zone_id into v_zone
      from public.hubs h where h.id = v_employee.hub_id and h.archived_at is null;
    if v_zone is null then
      return null;
    end if;
  elsif not (private.has_permission('hr.attendance.configure', p_zone, null)
           or private.has_permission_within_zone('ops.staff_daily.view', p_zone)) then
    raise exception 'Not authorised to see the report deadlines of this zone.' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'zone_id', z.id,
      'pickup', left(d.pickup::text, 5),
      'pickup_return', left(d.pickup_return::text, 5),
      'delivery', left(d.delivery::text, 5),
      'delivery_return', left(d.delivery_return::text, 5)
    )
    from public.zones z
    left join private.wf_ops_deadlines d on d.zone_id = z.id
    where z.id = v_zone and z.archived_at is null
  );
end;
$$;

create or replace function public.wf_ops_deadlines_save(p_zone uuid, p_times jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_zone is null
     or not private.has_permission('hr.attendance.configure', p_zone, null) then
    raise exception 'Not authorised to set the report deadlines of this zone.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.zones z where z.id = p_zone and z.archived_at is null) then
    raise exception 'Zone not found.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_times) is distinct from 'object' then
    raise exception 'Report deadlines must be an object.' using errcode = '22023';
  end if;
  if not (p_times ?& array['pickup', 'pickup_return', 'delivery', 'delivery_return'])
     or exists (
       select 1 from jsonb_each(p_times) as times(field, value)
       where field not in ('pickup', 'pickup_return', 'delivery', 'delivery_return')
          or (value <> 'null'::jsonb and
             (jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
     ) then
    raise exception 'Provide all four deadlines as HH:MM or null.' using errcode = '22023';
  end if;

  insert into private.wf_ops_deadlines (zone_id, pickup, pickup_return, delivery, delivery_return)
  values (p_zone, (p_times ->> 'pickup')::time, (p_times ->> 'pickup_return')::time,
          (p_times ->> 'delivery')::time, (p_times ->> 'delivery_return')::time)
  on conflict (zone_id) do update set
    pickup = excluded.pickup, pickup_return = excluded.pickup_return,
    delivery = excluded.delivery, delivery_return = excluded.delivery_return;
end;
$$;

revoke all on function public.wf_ops_deadlines_get(uuid), public.wf_ops_deadlines_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wf_ops_deadlines_get(uuid), public.wf_ops_deadlines_save(uuid, jsonb) to authenticated;
