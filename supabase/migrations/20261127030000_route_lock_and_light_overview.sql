-- Route centre, step 1 (additive; replaces two functions with the same text plus one change each):
--  * route_save: optional `expected_updated_at` in the payload. When given and the route was saved by someone else meanwhile, the save is refused (SQLSTATE 40001)
--    instead of silently overwriting. Callers that do not send it behave exactly as before.
--  * route_zone_overview: routes come without `road_path` (a `has_road` flag instead); the new route_road_paths(zone) returns the lines when the map needs them.
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
    -- Optional lock: the screen sends the updated_at it opened. If someone saved the route since, nothing is written.
    if nullif(p ->> 'expected_updated_at', '') is not null and r.updated_at is distinct from (p ->> 'expected_updated_at')::timestamptz then
      raise exception 'This route was changed by someone else. Reload it and try again.' using errcode = '40001';
    end if;
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
    'routes', coalesce((select jsonb_agg((private.route_json(r.id) - 'road_path') || jsonb_build_object('has_road', r.road_path is not null) order by hb.name, r.code)
                          from public.hub_routes r join hubs hb on hb.id = r.hub_id where r.archived_at is null), '[]'::jsonb),
    'visits_today', coalesce((select jsonb_object_agg(t.route_id, t.n) from (
        select v.route_id, count(*) n from public.route_stop_visits v join hubs hb on hb.id = v.hub_id
         where v.work_date = current_date group by v.route_id) t), '{}'::jsonb)
  ) into v;
  return v;
end $$;

-- The road lines (up to 3000 points a route) are the heavy part of the zone page: the overview no longer carries them, the map asks for them.
create or replace function public.route_road_paths(p_zone uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not private.has_permission_within_zone('ops.route_setting.view', p_zone) then
    raise exception 'Not authorised to see the routes of this zone.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(r.id, r.road_path)
                     from public.hub_routes r
                     join public.hubs h on h.id = r.hub_id and h.archived_at is null and h.status = 'active'
                    where r.zone_id = p_zone and r.archived_at is null and r.road_path is not null
                      and private.has_permission('ops.route_setting.view', p_zone, h.id)), '{}'::jsonb);
end $$;

revoke all on function public.route_road_paths(uuid) from public, anon;
grant execute on function public.route_road_paths(uuid) to authenticated;
