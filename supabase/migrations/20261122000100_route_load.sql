-- =====================================================================
--  রুটের পার্সেল চাপ ও পরামর্শ (route load: rider capacity per hub, average parcels per route)
--  * route_hub_load: per hub, how many parcels one rider delivers on an average day (set on the zone route page).
--  * hub_routes.avg_parcels: the average parcels of a route per day, typed by the manager (used until the daily
--    accounts have enough days of their own).
--  * route_load_overview(zone, days): the typed numbers, and what the submitted / approved daily accounts say:
--    per hub the days counted and the parcels delivered, per rider their days and parcels.
--    The page works out riders needed and route suggestions from these; nothing is changed by itself.
--  Reading needs ops.route_setting.view, writing ops.route_setting.edit (or ops.route.edit) for that hub.
--  Additive only.
-- =====================================================================
alter table public.hub_routes
  add column if not exists avg_parcels integer check (avg_parcels is null or avg_parcels between 0 and 100000);

create table if not exists public.route_hub_load (
  hub_id        uuid primary key references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  rider_parcels integer check (rider_parcels is null or rider_parcels between 1 and 1000),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists route_hub_load_zone on public.route_hub_load (zone_id);

drop trigger if exists route_hub_load_stamp on public.route_hub_load;
create trigger route_hub_load_stamp before insert or update on public.route_hub_load for each row execute function private.stamp_row();
drop trigger if exists route_hub_load_audit on public.route_hub_load;
create trigger route_hub_load_audit after insert or update or delete on public.route_hub_load for each row execute function private.audit_row('ops');
drop trigger if exists route_hub_load_no_delete on public.route_hub_load;
create trigger route_hub_load_no_delete before delete on public.route_hub_load for each row execute function private.prevent_delete();
alter table public.route_hub_load enable row level security;
revoke all on public.route_hub_load from anon, authenticated;
grant select on public.route_hub_load to authenticated;
drop policy if exists rhl_read on public.route_hub_load;
create policy rhl_read on public.route_hub_load for select to authenticated
  using (private.has_permission('ops.route_setting.view', zone_id, hub_id));

-- Save a hub's numbers. p: {rider_parcels?: number | null, routes?: [{id, avg_parcels: number | null}]}
create or replace function public.route_load_save(p_hub uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; x jsonb; v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.route_can_edit(v_zone, p_hub) then raise exception 'Not authorised to change the routes of this hub.' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The numbers must be an object.' using errcode = '22023'; end if;
  if p ? 'rider_parcels' then
    v_n := nullif(p ->> 'rider_parcels', '')::integer;
    if v_n is not null and v_n not between 1 and 1000 then raise exception 'Parcels per rider must be between 1 and 1000.' using errcode = '22023'; end if;
    insert into public.route_hub_load (hub_id, zone_id, rider_parcels) values (p_hub, v_zone, v_n)
    on conflict (hub_id) do update set rider_parcels = excluded.rider_parcels;
  end if;
  if p ? 'routes' then
    if jsonb_typeof(p -> 'routes') <> 'array' then raise exception 'The routes must be a list.' using errcode = '22023'; end if;
    for x in select e from jsonb_array_elements(p -> 'routes') e loop
      v_n := nullif(x ->> 'avg_parcels', '')::integer;
      if v_n is not null and v_n not between 0 and 100000 then raise exception 'Average parcels of a route must be between 0 and 100000.' using errcode = '22023'; end if;
      update public.hub_routes set avg_parcels = v_n where id = (x ->> 'id')::uuid and hub_id = p_hub and archived_at is null and avg_parcels is distinct from v_n;
      if not found and not exists (select 1 from public.hub_routes where id = (x ->> 'id')::uuid and hub_id = p_hub and archived_at is null) then
        raise exception 'A route does not belong to this hub.' using errcode = '22023';
      end if;
    end loop;
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then raise exception 'A number is written wrongly.' using errcode = '22023';
end $$;

-- The typed numbers and what the daily accounts say for the last p_days days (submitted or approved sheets only).
create or replace function public.route_load_overview(p_zone uuid, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := least(greatest(coalesce(p_days, 30), 1), 180); v_from date;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not private.has_permission_within_zone('ops.route_setting.view', p_zone) then
    raise exception 'Not authorised to see the routes of this zone.' using errcode = '42501';
  end if;
  v_from := current_date - v_days;
  return jsonb_build_object('days', v_days, 'from', v_from,
    'hubs', coalesce((select jsonb_agg(jsonb_build_object(
        'hub_id', h.id, 'rider_parcels', l.rider_parcels,
        'days', (select count(*) from public.da_sessions s
                  where s.hub_id = h.id and s.status in ('submitted', 'approved') and s.account_date >= v_from),
        'delivery', (select coalesce(sum(rl.delivery_qty), 0) from public.da_rider_lines rl join public.da_sessions s on s.id = rl.session_id
                      where s.hub_id = h.id and s.status in ('submitted', 'approved') and s.account_date >= v_from and rl.removed_at is null),
        'pickup', (select coalesce(sum(rl.pickup_qty), 0) from public.da_rider_lines rl join public.da_sessions s on s.id = rl.session_id
                    where s.hub_id = h.id and s.status in ('submitted', 'approved') and s.account_date >= v_from and rl.removed_at is null),
        'riders', coalesce((select jsonb_agg(jsonb_build_object('employee_id', t.employee_id, 'days', t.days, 'delivery', t.delivery, 'pickup', t.pickup))
                    from (select rl.employee_id, count(*) days, sum(rl.delivery_qty) delivery, sum(rl.pickup_qty) pickup
                            from public.da_rider_lines rl join public.da_sessions s on s.id = rl.session_id
                           where s.hub_id = h.id and s.status in ('submitted', 'approved') and s.account_date >= v_from and rl.removed_at is null
                           group by rl.employee_id) t), '[]'::jsonb),
        'routes', coalesce((select jsonb_object_agg(r.id, r.avg_parcels) from public.hub_routes r
                             where r.hub_id = h.id and r.archived_at is null and r.avg_parcels is not null), '{}'::jsonb)
      ) order by h.name)
      from public.hubs h left join public.route_hub_load l on l.hub_id = h.id
     where h.zone_id = p_zone and h.archived_at is null and h.status = 'active'
       and private.has_permission('ops.route_setting.view', p_zone, h.id)), '[]'::jsonb));
end $$;

revoke all on function public.route_load_save(uuid, jsonb), public.route_load_overview(uuid, integer) from public, anon;
grant execute on function public.route_load_save(uuid, jsonb), public.route_load_overview(uuid, integer) to authenticated;
