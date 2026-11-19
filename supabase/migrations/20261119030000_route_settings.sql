-- =====================================================================
--  রাইডার রুট — আসল লোকেশন দিয়ে, জোনাল ম্যানেজার প্যানেলে "রুট সেটিং"।
--
--  * hub_route_stops: every stop (area / merchant / landmark / point) of a route, in order, with GPS (lat/lng),
--    a reach radius and minutes spent there. hub_routes.areas stays the list of stop names, so every older screen
--    keeps working; an older screen that writes areas directly is followed by a trigger (GPS kept by name).
--  * hub_routes: + colour, shift, straight-line km (hub → stops in order), road km / minutes / path
--    (the road line the browser fetched from a routing service), number of stops with GPS.
--  * route_zone_settings: the zone's route rules (max stops, riders per route, routes per rider, reach radius,
--    speed, minutes per stop, start time, GPS required, rider check-in open).
--  * route_stop_visits: a rider's "এখানে পৌঁছেছি" at a stop: phone location, distance from the stop, near / far.
--  * Six new permissions. Only Admin and Zonal Manager get them now; the Super Admin gives them to managers
--    or staff later (role or personal permission). A hub-scoped grant works for that hub only.
--      ops.route_setting.view / edit / archive / configure, ops.route_visit.view / create
--  * The hub page keeps ops.route.view / ops.route.edit as before.
--  Additive only: nothing dropped, no existing function replaced.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description) values
  ('ops.route_setting.view',      'ops', 'route_setting', 'view',      'See route settings: the map, routes, stops with location and riders'),
  ('ops.route_setting.edit',      'ops', 'route_setting', 'edit',      'Make and change routes with real locations and give them to riders'),
  ('ops.route_setting.archive',   'ops', 'route_setting', 'archive',   'Remove routes'),
  ('ops.route_setting.configure', 'ops', 'route_setting', 'configure', 'Change the zone route rules'),
  ('ops.route_visit.view',        'ops', 'route_visit',   'view',      'See riders'' stop check-ins on their routes'),
  ('ops.route_visit.create',      'ops', 'route_visit',   'create',    'Check in at a route stop with the phone location (rider)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.code in ('ops.route_setting.view', 'ops.route_setting.edit', 'ops.route_setting.archive', 'ops.route_setting.configure', 'ops.route_visit.view')
 where r.code in ('admin', 'zonal_manager')
on conflict do nothing;
-- ops.route_visit.create (rider check-in) is given to nobody yet: the Super Admin turns it on for riders when ready.

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
alter table public.hub_routes
  add column if not exists color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists shift text not null default 'day' check (shift in ('day', 'morning', 'evening', 'night')),
  add column if not exists distance_km numeric(8,2),
  add column if not exists road_km numeric(8,2) check (road_km is null or road_km >= 0),
  add column if not exists road_minutes integer check (road_minutes is null or road_minutes >= 0),
  add column if not exists road_path jsonb check (road_path is null or (jsonb_typeof(road_path) = 'array' and jsonb_array_length(road_path) <= 3000)),
  add column if not exists stops_gps integer not null default 0;

create table if not exists public.route_zone_settings (
  zone_id              uuid primary key references public.zones(id),
  max_stops            integer not null default 40 check (max_stops between 2 and 200),
  max_riders           integer not null default 4 check (max_riders between 1 and 20),
  max_routes_per_rider integer not null default 2 check (max_routes_per_rider between 1 and 10),
  stop_radius_m        integer not null default 150 check (stop_radius_m between 20 and 2000),
  speed_kmh            numeric(5,1) not null default 18 check (speed_kmh between 5 and 80),
  stop_minutes         integer not null default 4 check (stop_minutes between 0 and 60),
  start_time           time not null default '10:00',
  gps_required         boolean not null default false,
  checkin_open         boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table if not exists public.hub_route_stops (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references public.hub_routes(id),
  hub_id     uuid not null references public.hubs(id),
  zone_id    uuid not null references public.zones(id),
  seq        integer not null check (seq >= 1),
  name       text not null check (length(trim(name)) between 1 and 120),
  kind       text not null default 'area' check (kind in ('area', 'merchant', 'landmark', 'point')),
  lat        numeric(10,7) check (lat between -90 and 90),
  lng        numeric(10,7) check (lng between -180 and 180),
  radius_m   integer check (radius_m is null or radius_m between 20 and 2000),
  minutes    integer check (minutes is null or minutes between 0 and 240),
  note       text check (note is null or length(note) <= 300),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check ((lat is null) = (lng is null))
);
create index if not exists hub_route_stops_route on public.hub_route_stops (route_id, seq) where archived_at is null;
create index if not exists hub_route_stops_zone on public.hub_route_stops (zone_id);
create index if not exists hub_route_stops_hub on public.hub_route_stops (hub_id);

create table if not exists public.route_stop_visits (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null references public.hub_routes(id),
  stop_id     uuid not null references public.hub_route_stops(id),
  employee_id uuid not null references public.employees(id),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  work_date   date not null default current_date,
  visited_at  timestamptz not null default now(),
  lat         numeric(10,7) not null,
  lng         numeric(10,7) not null,
  accuracy_m  integer,
  distance_m  integer not null,
  near        boolean not null,
  note        text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (stop_id, employee_id, work_date)
);
create index if not exists route_stop_visits_day on public.route_stop_visits (zone_id, work_date);
create index if not exists route_stop_visits_route on public.route_stop_visits (route_id, work_date);
create index if not exists route_stop_visits_emp on public.route_stop_visits (employee_id);
create index if not exists route_stop_visits_hub on public.route_stop_visits (hub_id);

do $$
declare t text;
begin
  foreach t in array array['route_zone_settings', 'hub_route_stops', 'route_stop_visits'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'ops');
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Reading: the table rules. Writing: only through the functions below.
drop policy if exists rzs_read on public.route_zone_settings;
create policy rzs_read on public.route_zone_settings for select to authenticated
  using (private.has_permission_within_zone('ops.route_setting.view', zone_id) or private.has_permission_within_zone('ops.route.view', zone_id));

drop policy if exists hrs_read on public.hub_route_stops;
create policy hrs_read on public.hub_route_stops for select to authenticated
  using (private.has_permission('ops.route.view', zone_id, hub_id) or private.has_permission('ops.route_setting.view', zone_id, hub_id)
      or exists (select 1 from public.rider_routes x where x.route_id = hub_route_stops.route_id and x.effective_to is null
                 and x.employee_id = private.my_employee_id()));

drop policy if exists rsv_read on public.route_stop_visits;
create policy rsv_read on public.route_stop_visits for select to authenticated
  using (private.has_permission('ops.route_visit.view', zone_id, hub_id) or employee_id = private.my_employee_id());

-- The zone route page also reads routes and assignments through the table rules.
drop policy if exists hr_read_setting on public.hub_routes;
create policy hr_read_setting on public.hub_routes for select to authenticated
  using (private.has_permission('ops.route_setting.view', zone_id, hub_id));
drop policy if exists rr_read_setting on public.rider_routes;
create policy rr_read_setting on public.rider_routes for select to authenticated
  using (private.has_permission('ops.route_setting.view', zone_id, hub_id));

-- ---------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------
-- Distance in metres between two points (haversine).
create or replace function private.geo_m(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns double precision
language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians((b_lat - a_lat)::double precision) / 2), 2)
    + cos(radians(a_lat::double precision)) * cos(radians(b_lat::double precision)) * power(sin(radians((b_lng - a_lng)::double precision) / 2), 2)))
$$;

-- Inside Bangladesh (a little margin): catches swapped latitude / longitude and a wrong pasted link.
create or replace function private.geo_in_bd(p_lat numeric, p_lng numeric) returns boolean
language sql immutable set search_path = '' as $$ select p_lat between 20.3 and 26.8 and p_lng between 87.9 and 92.8 $$;

-- The zone's rules (defaults when nothing is saved yet).
create or replace function private.route_rules(p_zone uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'max_stops', coalesce(s.max_stops, 40), 'max_riders', coalesce(s.max_riders, 4),
    'max_routes_per_rider', coalesce(s.max_routes_per_rider, 2), 'stop_radius_m', coalesce(s.stop_radius_m, 150),
    'speed_kmh', coalesce(s.speed_kmh, 18), 'stop_minutes', coalesce(s.stop_minutes, 4),
    'start_time', to_char(coalesce(s.start_time, '10:00'::time), 'HH24:MI'),
    'gps_required', coalesce(s.gps_required, false), 'checkin_open', coalesce(s.checkin_open, true),
    'saved', s.zone_id is not null, 'updated_at', s.updated_at)
  from (select 1) one left join public.route_zone_settings s on s.zone_id = p_zone
$$;

create or replace function private.route_can_edit(p_zone uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission('ops.route.edit', p_zone, p_hub) or private.has_permission('ops.route_setting.edit', p_zone, p_hub)
$$;

-- Straight-line length (hub GPS → each stop with GPS, in order), stops with GPS, and the areas list.
create or replace function private.route_recalc(p_route uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_lat numeric; v_lng numeric; v_m double precision := 0; v_n integer := 0; s record;
begin
  select h.latitude, h.longitude into v_lat, v_lng from public.hub_routes r join public.hubs h on h.id = r.hub_id where r.id = p_route;
  for s in select lat, lng from public.hub_route_stops where route_id = p_route and archived_at is null and lat is not null order by seq loop
    if v_lat is not null then v_m := v_m + private.geo_m(v_lat, v_lng, s.lat, s.lng); end if;
    v_lat := s.lat; v_lng := s.lng; v_n := v_n + 1;
  end loop;
  perform set_config('app.route_fn', '1', true);
  update public.hub_routes r set
    stops_gps = v_n,
    distance_km = case when v_n = 0 then null else round((v_m / 1000)::numeric, 2) end,
    areas = coalesce((select array_agg(x.name order by x.seq) from public.hub_route_stops x where x.route_id = p_route and x.archived_at is null), '{}')
  where r.id = p_route;
  perform set_config('app.route_fn', '', true);
end $$;

-- An older screen changed hub_routes.areas directly: follow it, keeping each stop's GPS by its name.
create or replace function private.hub_routes_follow_areas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_i integer := 0; v_id uuid; v_keep uuid[] := '{}';
begin
  if coalesce(current_setting('app.route_fn', true), '') = '1' then return null; end if;
  if tg_op = 'UPDATE' and new.areas is not distinct from old.areas then return null; end if;
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
  perform private.route_recalc(new.id);
  return null;
end $$;

drop trigger if exists hub_routes_follow_areas on public.hub_routes;
create trigger hub_routes_follow_areas after insert or update of areas on public.hub_routes
  for each row execute function private.hub_routes_follow_areas();

-- Routes made before this update: one stop per area name, no GPS yet.
insert into public.hub_route_stops (route_id, hub_id, zone_id, seq, name)
select r.id, r.hub_id, r.zone_id, a.i, trim(a.name)
  from public.hub_routes r cross join lateral unnest(r.areas) with ordinality a(name, i)
 where trim(a.name) <> '' and not exists (select 1 from public.hub_route_stops s where s.route_id = r.id);
update public.hub_routes r set stops_gps = 0 where stops_gps is null;

-- A person counts as a rider when the post says so (code or name).
create or replace function private.is_rider_post(p_position uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.code::text ilike '%rider%' or p.name ilike '%rider%' or p.name like '%রাইডার%' or p.name ilike '%delivery%'
                     from public.positions p where p.id = p_position), false)
$$;

-- ---------------------------------------------------------------------
-- 4. Zone rules
-- ---------------------------------------------------------------------
create or replace function public.route_zones() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'code', z.code, 'name', z.name) order by z.name), '[]'::jsonb)
  from public.zones z
  where z.archived_at is null and private.has_permission_within_zone('ops.route_setting.view', z.id)
$$;

create or replace function public.route_settings_save(p_zone uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.zones where id = p_zone) then raise exception 'Unknown zone.' using errcode = '22023'; end if;
  if not private.has_permission('ops.route_setting.configure', p_zone, null) then
    raise exception 'Not authorised to change the route rules of this zone.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The rules must be an object.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('max_stops', 'max_riders', 'max_routes_per_rider', 'stop_radius_m', 'speed_kmh', 'stop_minutes', 'start_time', 'gps_required', 'checkin_open') then
      raise exception 'Unknown route rule: %.', k using errcode = '22023';
    end if;
  end loop;
  begin
    insert into public.route_zone_settings as s (zone_id, max_stops, max_riders, max_routes_per_rider, stop_radius_m, speed_kmh, stop_minutes, start_time, gps_required, checkin_open)
    values (p_zone,
      coalesce((p ->> 'max_stops')::integer, 40), coalesce((p ->> 'max_riders')::integer, 4), coalesce((p ->> 'max_routes_per_rider')::integer, 2),
      coalesce((p ->> 'stop_radius_m')::integer, 150), coalesce((p ->> 'speed_kmh')::numeric, 18), coalesce((p ->> 'stop_minutes')::integer, 4),
      coalesce((p ->> 'start_time')::time, '10:00'), coalesce((p ->> 'gps_required')::boolean, false), coalesce((p ->> 'checkin_open')::boolean, true))
    on conflict (zone_id) do update set
      max_stops = coalesce((p ->> 'max_stops')::integer, s.max_stops),
      max_riders = coalesce((p ->> 'max_riders')::integer, s.max_riders),
      max_routes_per_rider = coalesce((p ->> 'max_routes_per_rider')::integer, s.max_routes_per_rider),
      stop_radius_m = coalesce((p ->> 'stop_radius_m')::integer, s.stop_radius_m),
      speed_kmh = coalesce((p ->> 'speed_kmh')::numeric, s.speed_kmh),
      stop_minutes = coalesce((p ->> 'stop_minutes')::integer, s.stop_minutes),
      start_time = coalesce((p ->> 'start_time')::time, s.start_time),
      gps_required = coalesce((p ->> 'gps_required')::boolean, s.gps_required),
      checkin_open = coalesce((p ->> 'checkin_open')::boolean, s.checkin_open);
  exception
    when check_violation then raise exception 'A route rule is outside its allowed range.' using errcode = '22023';
    when invalid_text_representation or invalid_datetime_format or datatype_mismatch then
      raise exception 'A route rule has the wrong kind of value.' using errcode = '22023';
  end;
  return private.route_rules(p_zone);
end $$;

-- ---------------------------------------------------------------------
-- 5. Save a route with its stops (one call, all or nothing)
--   p: {id?, hub_id, code?, name, note?, color?, shift?, stops: [{id?, name, kind?, lat?, lng?, radius_m?, minutes?, note?}],
--       road?: {km, minutes, path: [[lat,lng],...]} }
-- ---------------------------------------------------------------------
create or replace function public.route_save(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid; v_hub uuid; v_zone uuid; r public.hub_routes;
  v_rules jsonb; v_name text := trim(coalesce(p ->> 'name', '')); v_code text := upper(trim(coalesce(p ->> 'code', '')));
  s jsonb; v_i integer := 0; v_keep uuid[] := '{}'; v_sid uuid; v_lat numeric; v_lng numeric; v_sname text;
  v_road jsonb := p -> 'road'; v_before text; v_after text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if v_id is not null then
    select * into r from public.hub_routes where id = v_id and archived_at is null;
    if r.id is null then raise exception 'Route not found.' using errcode = 'P0002'; end if;
    v_hub := r.hub_id; v_zone := r.zone_id;
  else
    v_hub := nullif(p ->> 'hub_id', '')::uuid;
    select zone_id into v_zone from public.hubs where id = v_hub and archived_at is null;
    if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  end if;
  if not private.route_can_edit(v_zone, v_hub) then raise exception 'Not authorised to change the routes of this hub.' using errcode = '42501'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Give the route a name (2-80 letters).' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p -> 'stops', 'null')) <> 'array' or jsonb_array_length(p -> 'stops') = 0 then
    raise exception 'A route needs at least one stop.' using errcode = '22023';
  end if;
  v_rules := private.route_rules(v_zone);
  if jsonb_array_length(p -> 'stops') > (v_rules ->> 'max_stops')::integer then
    raise exception 'Too many stops: this zone allows % per route.', v_rules ->> 'max_stops' using errcode = '22023';
  end if;
  if coalesce(p ->> 'shift', 'day') not in ('day', 'morning', 'evening', 'night') then raise exception 'Unknown shift.' using errcode = '22023'; end if;
  if nullif(p ->> 'color', '') is not null and (p ->> 'color') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'The colour must look like #15803D.' using errcode = '22023'; end if;

  -- check every stop before writing anything
  for s in select x from jsonb_array_elements(p -> 'stops') x loop
    v_sname := trim(coalesce(s ->> 'name', ''));
    if v_sname = '' or length(v_sname) > 120 then raise exception 'Every stop needs a name (up to 120 letters).' using errcode = '22023'; end if;
    v_lat := nullif(s ->> 'lat', '')::numeric; v_lng := nullif(s ->> 'lng', '')::numeric;
    if (v_lat is null) <> (v_lng is null) then raise exception 'Stop "%": give both latitude and longitude.', v_sname using errcode = '22023'; end if;
    if v_lat is not null and not private.geo_in_bd(v_lat, v_lng) then
      raise exception 'Stop "%": the location is outside Bangladesh (latitude and longitude swapped?).', v_sname using errcode = '22023';
    end if;
    if v_lat is null and (v_rules ->> 'gps_required')::boolean then
      raise exception 'Stop "%": this zone needs a location for every stop.', v_sname using errcode = '22023';
    end if;
    if coalesce(s ->> 'kind', 'area') not in ('area', 'merchant', 'landmark', 'point') then raise exception 'Unknown stop kind.' using errcode = '22023'; end if;
    if nullif(s ->> 'id', '') is not null and not exists (select 1 from public.hub_route_stops x where x.id = (s ->> 'id')::uuid and x.route_id = v_id and x.archived_at is null) then
      raise exception 'A stop does not belong to this route.' using errcode = '22023';
    end if;
  end loop;

  if v_road is not null and jsonb_typeof(v_road) = 'object' then
    if jsonb_typeof(coalesce(v_road -> 'path', 'null')) <> 'array' or jsonb_array_length(v_road -> 'path') > 3000 then
      raise exception 'The road line is too long or missing.' using errcode = '22023';
    end if;
  else v_road := null; end if;

  perform set_config('app.route_fn', '1', true);
  begin
    if v_id is null then
      if v_code = '' then
        select 'R' || lpad((coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::integer), 0) + 1)::text, 2, '0') into v_code
          from public.hub_routes where hub_id = v_hub and code ~ '^R\d+$';
      end if;
      insert into public.hub_routes (hub_id, zone_id, code, name, note, color, shift, areas)
      values (v_hub, v_zone, v_code, v_name, nullif(trim(coalesce(p ->> 'note', '')), ''), nullif(p ->> 'color', ''), coalesce(p ->> 'shift', 'day'), '{}')
      returning id into v_id;
    else
      update public.hub_routes set code = case when v_code = '' then code else v_code end, name = v_name,
        note = nullif(trim(coalesce(p ->> 'note', '')), ''), color = nullif(p ->> 'color', ''), shift = coalesce(p ->> 'shift', 'day')
      where id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'This hub already has a route with code %.', v_code using errcode = '23505';
  end;

  select string_agg(coalesce(lat::text, '-') || ',' || coalesce(lng::text, '-'), '|' order by seq) into v_before
    from public.hub_route_stops where route_id = v_id and archived_at is null;

  for s in select x from jsonb_array_elements(p -> 'stops') x loop
    v_i := v_i + 1;
    v_sid := nullif(s ->> 'id', '')::uuid;
    v_lat := nullif(s ->> 'lat', '')::numeric; v_lng := nullif(s ->> 'lng', '')::numeric;
    if v_sid is null then
      insert into public.hub_route_stops (route_id, hub_id, zone_id, seq, name, kind, lat, lng, radius_m, minutes, note)
      values (v_id, v_hub, v_zone, v_i, trim(s ->> 'name'), coalesce(s ->> 'kind', 'area'), v_lat, v_lng,
              nullif(s ->> 'radius_m', '')::integer, nullif(s ->> 'minutes', '')::integer, nullif(trim(coalesce(s ->> 'note', '')), ''))
      returning id into v_sid;
    else
      update public.hub_route_stops set seq = v_i, name = trim(s ->> 'name'), kind = coalesce(s ->> 'kind', 'area'), lat = v_lat, lng = v_lng,
        radius_m = nullif(s ->> 'radius_m', '')::integer, minutes = nullif(s ->> 'minutes', '')::integer, note = nullif(trim(coalesce(s ->> 'note', '')), '')
      where id = v_sid;
    end if;
    v_keep := v_keep || v_sid;
  end loop;
  update public.hub_route_stops set archived_at = now(), archived_by = auth.uid(), archive_reason = 'Removed from the route'
   where route_id = v_id and archived_at is null and not (id = any(v_keep));

  select string_agg(coalesce(lat::text, '-') || ',' || coalesce(lng::text, '-'), '|' order by seq) into v_after
    from public.hub_route_stops where route_id = v_id and archived_at is null;

  -- the road line belongs to one order of stops: a new line replaces it, moved stops clear it
  if v_road is not null then
    update public.hub_routes set road_km = round(nullif(v_road ->> 'km', '')::numeric, 2), road_minutes = round(nullif(v_road ->> 'minutes', '')::numeric)::integer,
      road_path = v_road -> 'path' where id = v_id;
  elsif v_before is distinct from v_after then
    update public.hub_routes set road_km = null, road_minutes = null, road_path = null where id = v_id;
  end if;
  perform set_config('app.route_fn', '', true);
  perform private.route_recalc(v_id);
  return v_id;
exception
  when check_violation then raise exception 'A value of the route or a stop is outside its allowed range.' using errcode = '22023';
  when invalid_text_representation then raise exception 'A number or a location is written wrongly.' using errcode = '22023';
end $$;

create or replace function public.route_archive(p_route uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.hub_routes;
begin
  select * into r from public.hub_routes where id = p_route and archived_at is null;
  if r.id is null then raise exception 'Route not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('ops.route.edit', r.zone_id, r.hub_id) or private.has_permission('ops.route_setting.archive', r.zone_id, r.hub_id)) then
    raise exception 'Not authorised to remove this route.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'Write why the route is removed.' using errcode = '22023'; end if;
  perform set_config('app.route_fn', '1', true);
  update public.hub_routes set archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason), status = 'inactive' where id = p_route;
  update public.rider_routes set effective_to = current_date where route_id = p_route and effective_to is null;
  perform set_config('app.route_fn', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 6. Riders of a route (exactly this list; the others end today)
-- ---------------------------------------------------------------------
create or replace function public.route_riders_set(p_route uuid, p_employees uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.hub_routes; v_rules jsonb; e record; v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(p_employees) x where x is not null), '{}');
  v_added integer := 0; v_ended integer := 0;
begin
  select * into r from public.hub_routes where id = p_route and archived_at is null;
  if r.id is null then raise exception 'Route not found.' using errcode = 'P0002'; end if;
  if not private.route_can_edit(r.zone_id, r.hub_id) then raise exception 'Not authorised to give this route to riders.' using errcode = '42501'; end if;
  v_rules := private.route_rules(r.zone_id);
  if cardinality(v_ids) > (v_rules ->> 'max_riders')::integer then
    raise exception 'Too many riders: this zone allows % per route.', v_rules ->> 'max_riders' using errcode = '22023';
  end if;
  for e in select x.id, x.full_name, x.hub_id, x.status, x.archived_at from public.employees x where x.id = any(v_ids) loop
    if e.archived_at is not null or e.status <> 'active' then raise exception '% is not an active staff member.', e.full_name using errcode = '22023'; end if;
    if e.hub_id is distinct from r.hub_id then raise exception '% works at another hub.', e.full_name using errcode = '22023'; end if;
    if not exists (select 1 from public.rider_routes x where x.route_id = p_route and x.employee_id = e.id and x.effective_to is null)
       and (select count(*) from public.rider_routes x join public.hub_routes h on h.id = x.route_id and h.archived_at is null
             where x.employee_id = e.id and x.effective_to is null) >= (v_rules ->> 'max_routes_per_rider')::integer then
      raise exception '% already has % route(s), the most this zone allows.', e.full_name, v_rules ->> 'max_routes_per_rider' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from public.employees x where x.id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'Unknown staff member.' using errcode = '22023';
  end if;
  update public.rider_routes set effective_to = current_date
   where route_id = p_route and effective_to is null and not (employee_id = any(v_ids));
  get diagnostics v_ended = row_count;
  insert into public.rider_routes (route_id, employee_id, hub_id, zone_id)
  select p_route, x, r.hub_id, r.zone_id from unnest(v_ids) x
   where not exists (select 1 from public.rider_routes y where y.route_id = p_route and y.employee_id = x and y.effective_to is null);
  get diagnostics v_added = row_count;
  return jsonb_build_object('added', v_added, 'ended', v_ended);
end $$;

-- ---------------------------------------------------------------------
-- 7. Reading: the whole zone, a day's check-ins, my route today
-- ---------------------------------------------------------------------
create or replace function private.route_json(p_route uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'hub_id', r.hub_id, 'zone_id', r.zone_id, 'code', r.code, 'name', r.name, 'note', r.note,
    'color', r.color, 'shift', r.shift, 'distance_km', r.distance_km, 'road_km', r.road_km, 'road_minutes', r.road_minutes,
    'road_path', r.road_path, 'stops_gps', r.stops_gps, 'updated_at', r.updated_at,
    'stops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'name', s.name, 'kind', s.kind, 'lat', s.lat, 'lng', s.lng,
                 'radius_m', s.radius_m, 'minutes', s.minutes, 'note', s.note) order by s.seq)
               from public.hub_route_stops s where s.route_id = r.id and s.archived_at is null), '[]'::jsonb),
    'riders', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'code', e.employee_code, 'name', e.full_name, 'mobile', e.mobile,
                 'from', x.effective_from) order by e.full_name)
               from public.rider_routes x join public.employees e on e.id = x.employee_id
              where x.route_id = r.id and x.effective_to is null), '[]'::jsonb))
  from public.hub_routes r where r.id = p_route
$$;

create or replace function public.route_zone_overview(p_zone uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not private.has_permission_within_zone('ops.route_setting.view', p_zone) then
    raise exception 'Not authorised to see the routes of this zone.' using errcode = '42501';
  end if;
  with hubs as (
    select h.* from public.hubs h
     where h.zone_id = p_zone and h.archived_at is null and h.status = 'active'
       and private.has_permission('ops.route_setting.view', p_zone, h.id))
  select jsonb_build_object(
    'zone', (select jsonb_build_object('id', z.id, 'code', z.code, 'name', z.name) from public.zones z where z.id = p_zone),
    'rules', private.route_rules(p_zone),
    'can', jsonb_build_object(
      'configure', private.has_permission('ops.route_setting.configure', p_zone, null),
      'visits', private.has_permission_within_zone('ops.route_visit.view', p_zone),
      'edit_hubs', coalesce((select jsonb_agg(h.id) from hubs h where private.route_can_edit(p_zone, h.id)), '[]'::jsonb),
      'archive_hubs', coalesce((select jsonb_agg(h.id) from hubs h
                                 where private.has_permission('ops.route.edit', p_zone, h.id) or private.has_permission('ops.route_setting.archive', p_zone, h.id)), '[]'::jsonb)),
    'hubs', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name, 'lat', h.latitude, 'lng', h.longitude,
        'staff', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.employee_code, 'name', e.full_name,
                      'rider', private.is_rider_post(e.position_id),
                      'routes', (select count(*) from public.rider_routes x join public.hub_routes hr on hr.id = x.route_id and hr.archived_at is null
                                  where x.employee_id = e.id and x.effective_to is null)) order by e.full_name)
                   from public.employees e where e.hub_id = h.id and e.status = 'active' and e.archived_at is null), '[]'::jsonb)
      ) order by h.name) from hubs h), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(private.route_json(r.id) order by hb.name, r.code)
                          from public.hub_routes r join hubs hb on hb.id = r.hub_id where r.archived_at is null), '[]'::jsonb),
    'visits_today', coalesce((select jsonb_object_agg(t.route_id, t.n) from (
        select v.route_id, count(*) n from public.route_stop_visits v join hubs hb on hb.id = v.hub_id
         where v.work_date = current_date group by v.route_id) t), '{}'::jsonb)
  ) into v;
  return v;
end $$;

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
          from public.rider_routes x join public.employees e on e.id = x.employee_id
         where x.route_id = r.id and x.effective_from <= v_date and (x.effective_to is null or x.effective_to >= v_date)), '[]'::jsonb),
        'visits', coalesce((select jsonb_agg(jsonb_build_object('stop_id', v.stop_id, 'stop', s.name, 'seq', s.seq, 'employee_id', v.employee_id,
            'at', v.visited_at, 'lat', v.lat, 'lng', v.lng, 'distance_m', v.distance_m, 'near', v.near, 'accuracy_m', v.accuracy_m, 'note', v.note) order by v.visited_at)
          from public.route_stop_visits v join public.hub_route_stops s on s.id = v.stop_id
         where v.route_id = r.id and v.work_date = v_date), '[]'::jsonb)
      ) order by h.name, r.code)
      from public.hub_routes r join public.hubs h on h.id = r.hub_id
     where r.zone_id = p_zone and r.archived_at is null and private.has_permission('ops.route_visit.view', r.zone_id, r.hub_id)), '[]'::jsonb));
end $$;

create or replace function public.my_route_today() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id();
begin
  if v_emp is null then return jsonb_build_object('routes', '[]'::jsonb); end if;
  return jsonb_build_object('date', current_date,
    'routes', coalesce((select jsonb_agg(private.route_json(r.id) || jsonb_build_object(
        'hub', (select jsonb_build_object('name', h.name, 'lat', h.latitude, 'lng', h.longitude) from public.hubs h where h.id = r.hub_id),
        'rules', private.route_rules(r.zone_id) - 'saved' - 'updated_at',
        'can_checkin', private.has_permission('ops.route_visit.create', r.zone_id, r.hub_id) and (private.route_rules(r.zone_id) ->> 'checkin_open')::boolean,
        'visits', coalesce((select jsonb_agg(jsonb_build_object('stop_id', v.stop_id, 'at', v.visited_at, 'distance_m', v.distance_m, 'near', v.near))
                   from public.route_stop_visits v where v.route_id = r.id and v.employee_id = v_emp and v.work_date = current_date), '[]'::jsonb)
      ) order by r.code)
      from public.rider_routes x join public.hub_routes r on r.id = x.route_id and r.archived_at is null
     where x.employee_id = v_emp and x.effective_to is null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 8. Rider check-in at a stop (phone location)
-- ---------------------------------------------------------------------
create or replace function public.route_checkin(p_stop uuid, p_lat numeric, p_lng numeric, p_accuracy numeric default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id(); s public.hub_route_stops; v_rules jsonb; v_d double precision; v_near boolean; v_radius integer;
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
  insert into public.route_stop_visits as v (route_id, stop_id, employee_id, hub_id, zone_id, lat, lng, accuracy_m, distance_m, near, note)
  values (s.route_id, s.id, v_emp, s.hub_id, s.zone_id, round(p_lat, 7), round(p_lng, 7), round(p_accuracy)::integer, round(v_d)::integer, v_near,
          nullif(trim(coalesce(p_note, '')), ''))
  on conflict (stop_id, employee_id, work_date) do update set visited_at = now(), lat = excluded.lat, lng = excluded.lng,
    accuracy_m = excluded.accuracy_m, distance_m = excluded.distance_m, near = excluded.near, note = coalesce(excluded.note, v.note);
  return jsonb_build_object('distance_m', round(v_d)::integer, 'near', v_near, 'radius_m', v_radius);
end $$;

-- ---------------------------------------------------------------------
-- 9. Who may call what
-- ---------------------------------------------------------------------
revoke all on function private.geo_m(numeric, numeric, numeric, numeric), private.geo_in_bd(numeric, numeric), private.route_rules(uuid),
  private.route_can_edit(uuid, uuid), private.route_recalc(uuid), private.hub_routes_follow_areas(), private.is_rider_post(uuid),
  private.route_json(uuid) from public, anon, authenticated;

revoke all on function public.route_zones(), public.route_settings_save(uuid, jsonb), public.route_save(jsonb), public.route_archive(uuid, text),
  public.route_riders_set(uuid, uuid[]), public.route_zone_overview(uuid), public.route_day(uuid, date), public.my_route_today(),
  public.route_checkin(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.route_zones(), public.route_settings_save(uuid, jsonb), public.route_save(jsonb), public.route_archive(uuid, text),
  public.route_riders_set(uuid, uuid[]), public.route_zone_overview(uuid), public.route_day(uuid, date), public.my_route_today(),
  public.route_checkin(uuid, numeric, numeric, numeric, text) to authenticated;
