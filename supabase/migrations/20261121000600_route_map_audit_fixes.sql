-- =====================================================================
--  রুট ম্যাপ অডিটের ঠিক করা (route map audit fixes)
--  1. A rider's "near" check-in is never replaced by a later one from far (a far one can still be put right by going closer).
--  2. The old hub page changed the area list, or the hub's own GPS moved: the saved road line belonged to the old
--     places, so it is cleared, and the straight distance is measured again.
--  3. The day's check-in list named a rider twice when they were taken off a route and put back the same day.
--  4. The code of a removed route (R01 …) can be used again.
--  5. A saved road line must be a list of [lat, lng] pairs inside Bangladesh.
--  Tables keep every row; only functions, one trigger, one index and one check are added or replaced.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Check-in: near stays near
-- ---------------------------------------------------------------------
create or replace function public.route_checkin(p_stop uuid, p_lat numeric, p_lng numeric, p_accuracy numeric default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id(); s public.hub_route_stops; v_rules jsonb; v_d double precision; v_near boolean; v_radius integer;
  v_old public.route_stop_visits;
begin
  if v_emp is null then raise exception 'No active staff profile is linked to this login.' using errcode = '42501'; end if;
  select * into s from public.hub_route_stops where id = p_stop and archived_at is null;
  if s.id is null then raise exception 'Stop not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.rider_routes x join public.hub_routes r on r.id = x.route_id and r.archived_at is null
                  where x.route_id = s.route_id and x.employee_id = v_emp and x.effective_to is null) then
    raise exception 'This stop is not on your route.' using errcode = '42501';
  end if;
  if not private.has_permission('ops.route_visit.create', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to check in on the route yet.' using errcode = '42501';
  end if;
  v_rules := private.route_rules(s.zone_id);
  if not (v_rules ->> 'checkin_open')::boolean then raise exception 'Route check-in is switched off for this zone.' using errcode = 'P0001'; end if;
  if s.lat is null then raise exception 'This stop has no location yet: ask the manager to set it.' using errcode = 'P0001'; end if;
  if p_lat is null or p_lng is null or not private.geo_in_bd(p_lat, p_lng) then raise exception 'The phone location is missing or wrong.' using errcode = '22023'; end if;
  if p_accuracy is not null and p_accuracy > 1000 then raise exception 'The phone location is too rough (more than 1 km). Turn on GPS and try again.' using errcode = '22023'; end if;
  v_d := private.geo_m(s.lat, s.lng, p_lat, p_lng);
  v_radius := coalesce(s.radius_m, (v_rules ->> 'stop_radius_m')::integer);
  v_near := v_d <= v_radius + least(coalesce(p_accuracy, 0), 100);
  -- already checked in near this stop today: that visit stands, a later press from far away does not undo it
  select * into v_old from public.route_stop_visits where stop_id = s.id and employee_id = v_emp and work_date = current_date;
  if v_old.id is not null and v_old.near and not v_near then
    return jsonb_build_object('distance_m', v_old.distance_m, 'near', true, 'radius_m', v_radius, 'kept', true);
  end if;
  insert into public.route_stop_visits as v (route_id, stop_id, employee_id, hub_id, zone_id, lat, lng, accuracy_m, distance_m, near, note)
  values (s.route_id, s.id, v_emp, s.hub_id, s.zone_id, round(p_lat, 7), round(p_lng, 7), round(p_accuracy)::integer, round(v_d)::integer, v_near,
          nullif(trim(coalesce(p_note, '')), ''))
  on conflict (stop_id, employee_id, work_date) do update set visited_at = now(), lat = excluded.lat, lng = excluded.lng,
    accuracy_m = excluded.accuracy_m, distance_m = excluded.distance_m, near = excluded.near, note = coalesce(excluded.note, v.note);
  return jsonb_build_object('distance_m', round(v_d)::integer, 'near', v_near, 'radius_m', v_radius);
end $$;

-- ---------------------------------------------------------------------
-- 2. The road line follows the places it was drawn through
-- ---------------------------------------------------------------------
-- An older screen changed hub_routes.areas directly: follow it, keeping each stop's GPS by its name.
-- When the places or their order changed, the saved road line no longer fits and is cleared.
create or replace function private.hub_routes_follow_areas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_i integer := 0; v_id uuid; v_keep uuid[] := '{}'; v_before text; v_after text;
begin
  if coalesce(current_setting('app.route_fn', true), '') = '1' then return null; end if;
  if tg_op = 'UPDATE' and new.areas is not distinct from old.areas then return null; end if;
  select string_agg(coalesce(lat::text, '-') || ',' || coalesce(lng::text, '-'), '|' order by seq) into v_before
    from public.hub_route_stops where route_id = new.id and archived_at is null;
  foreach v_name in array coalesce(new.areas, '{}') loop
    v_name := trim(v_name);
    continue when v_name = '';
    v_i := v_i + 1;
    select id into v_id from public.hub_route_stops
     where route_id = new.id and archived_at is null and lower(trim(name)) = lower(v_name) and not (id = any(v_keep))
     order by seq limit 1;
    if v_id is null then
      insert into public.hub_route_stops (route_id, hub_id, zone_id, seq, name) values (new.id, new.hub_id, new.zone_id, v_i, v_name) returning id into v_id;
    else
      update public.hub_route_stops set seq = v_i where id = v_id and seq <> v_i;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  update public.hub_route_stops set archived_at = now(), archived_by = auth.uid(), archive_reason = 'Removed from the area list'
   where route_id = new.id and archived_at is null and not (id = any(v_keep));
  select string_agg(coalesce(lat::text, '-') || ',' || coalesce(lng::text, '-'), '|' order by seq) into v_after
    from public.hub_route_stops where route_id = new.id and archived_at is null;
  if v_before is distinct from v_after then
    perform set_config('app.route_fn', '1', true);
    update public.hub_routes set road_km = null, road_minutes = null, road_path = null where id = new.id and road_path is not null;
    perform set_config('app.route_fn', '', true);
  end if;
  perform private.route_recalc(new.id);
  return null;
end $$;

-- The hub's own location moved (or was set for the first time): every route starts there.
create or replace function private.hub_moved_routes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.latitude is not distinct from old.latitude and new.longitude is not distinct from old.longitude then return null; end if;
  for r in select id from public.hub_routes where hub_id = new.id and archived_at is null loop
    perform set_config('app.route_fn', '1', true);
    update public.hub_routes set road_km = null, road_minutes = null, road_path = null where id = r.id and road_path is not null;
    perform set_config('app.route_fn', '', true);
    perform private.route_recalc(r.id);
  end loop;
  return null;
end $$;
drop trigger if exists hubs_moved_routes on public.hubs;
create trigger hubs_moved_routes after update of latitude, longitude on public.hubs
  for each row execute function private.hub_moved_routes();
revoke all on function private.hub_moved_routes() from public, anon, authenticated;

-- Routes already carrying a line or a distance from before: measure the straight distance again from where the hub is now.
do $$
declare r record;
begin
  for r in select id from public.hub_routes where archived_at is null loop perform private.route_recalc(r.id); end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. A day's check-ins: each rider once
-- ---------------------------------------------------------------------
create or replace function public.route_day(p_zone uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, current_date);
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not private.has_permission_within_zone('ops.route_visit.view', p_zone) then
    raise exception 'Not authorised to see route check-ins in this zone.' using errcode = '42501';
  end if;
  return jsonb_build_object('date', v_date,
    'routes', coalesce((select jsonb_agg(jsonb_build_object(
        'route_id', r.id, 'hub_id', r.hub_id, 'hub_name', h.name, 'code', r.code, 'name', r.name, 'color', r.color,
        'stops', (select count(*) from public.hub_route_stops s where s.route_id = r.id and s.archived_at is null),
        'stops_gps', r.stops_gps,
        'riders', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'code', e.employee_code,
            'visited', (select count(*) from public.route_stop_visits v where v.route_id = r.id and v.employee_id = e.id and v.work_date = v_date),
            'far', (select count(*) from public.route_stop_visits v where v.route_id = r.id and v.employee_id = e.id and v.work_date = v_date and not v.near),
            'first_at', (select min(v.visited_at) from public.route_stop_visits v where v.route_id = r.id and v.employee_id = e.id and v.work_date = v_date),
            'last_at', (select max(v.visited_at) from public.route_stop_visits v where v.route_id = r.id and v.employee_id = e.id and v.work_date = v_date)
          ) order by e.full_name)
          from public.employees e
         where e.id in (select x.employee_id from public.rider_routes x
                         where x.route_id = r.id and x.effective_from <= v_date and (x.effective_to is null or x.effective_to >= v_date)
                        union
                        select v.employee_id from public.route_stop_visits v where v.route_id = r.id and v.work_date = v_date)), '[]'::jsonb),
        'visits', coalesce((select jsonb_agg(jsonb_build_object('stop_id', v.stop_id, 'stop', s.name, 'seq', s.seq, 'employee_id', v.employee_id,
            'at', v.visited_at, 'lat', v.lat, 'lng', v.lng, 'distance_m', v.distance_m, 'near', v.near, 'accuracy_m', v.accuracy_m, 'note', v.note) order by v.visited_at)
          from public.route_stop_visits v join public.hub_route_stops s on s.id = v.stop_id
         where v.route_id = r.id and v.work_date = v_date), '[]'::jsonb)
      ) order by h.name, r.code)
      from public.hub_routes r join public.hubs h on h.id = r.hub_id
     where r.zone_id = p_zone and r.archived_at is null and private.has_permission('ops.route_visit.view', r.zone_id, r.hub_id)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 4. The code of a removed route is free again
-- ---------------------------------------------------------------------
alter table public.hub_routes drop constraint if exists hub_routes_hub_id_code_key;
create unique index if not exists hub_routes_hub_code_live on public.hub_routes (hub_id, code) where archived_at is null;

-- ---------------------------------------------------------------------
-- 5. A road line is a list of [lat, lng] pairs inside Bangladesh
-- ---------------------------------------------------------------------
create or replace function private.road_path_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (jsonb_typeof(p) = 'array' and not exists (
    select 1 from jsonb_array_elements(p) x
     where jsonb_typeof(x) <> 'array' or jsonb_array_length(x) <> 2
        or jsonb_typeof(x -> 0) <> 'number' or jsonb_typeof(x -> 1) <> 'number'
        or not ((x ->> 0)::numeric between 20.3 and 26.8 and (x ->> 1)::numeric between 87.9 and 92.8)))
$$;
-- checked as the person who writes the row (the old hub page updates hub_routes directly), so signed-in people may run it
revoke all on function private.road_path_ok(jsonb) from public, anon;
grant execute on function private.road_path_ok(jsonb) to authenticated;
update public.hub_routes set road_km = null, road_minutes = null, road_path = null where road_path is not null and not private.road_path_ok(road_path);
alter table public.hub_routes drop constraint if exists hub_routes_road_path_ok;
alter table public.hub_routes add constraint hub_routes_road_path_ok check (private.road_path_ok(road_path));
