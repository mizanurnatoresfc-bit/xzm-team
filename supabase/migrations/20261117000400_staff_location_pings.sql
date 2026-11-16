-- =====================================================================
-- XZM-TEAM ERP — Where are the staff? Hourly location while the app is open (zonal manager only)
--
-- Owner (16 Nov): "সকল স্টাফরা যখন অ্যাপ ব্যবহার করবে, জোনাল প্যানেল থেকে দেখবে উনি হাব এরিয়া থেকে
--   কত কিমি দূরে — ১ ঘণ্টা পর পর।" Chosen: option 1 — only while the app is open, only the zonal manager sees it.
--
--  * While a staff member has the app open in duty hours (08:00–20:00 Dhaka), the app sends the phone's
--    location at most once an hour (after the staff member has seen a one-line notice). Nothing is sent
--    when the app is closed or outside duty hours.
--  * Each ping keeps the distance to the person's own hub and the verdict (at the hub / near / far) and
--    whether it came from the hub's saved Wi-Fi (see 20261117000300_hub_presence).
--  * Only `zonal.location.view` may read it — given to the Zonal Manager role for their zone, and to Admin (who assigns
--    zonal managers); a Super Admin sees everything as always. Hub managers and staff never see it.
--    Pings older than 30 days are removed.
-- =====================================================================

create table public.staff_location_pings (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  hub_id      uuid references public.hubs(id),
  zone_id     uuid references public.zones(id),
  at          timestamptz not null default now(),
  latitude    numeric(10,7) not null check (latitude between -90 and 90),
  longitude   numeric(10,7) not null check (longitude between -180 and 180),
  accuracy_m  integer,
  distance_m  integer,
  place_status text check (place_status in ('at_hub', 'near', 'far', 'hub_no_gps')),
  wifi_match  boolean not null default false
);
create index staff_location_pings_emp on public.staff_location_pings (employee_id, at desc);
create index staff_location_pings_zone on public.staff_location_pings (zone_id, at desc);
create index staff_location_pings_hub on public.staff_location_pings (hub_id);
create index staff_location_pings_at on public.staff_location_pings (at);
alter table public.staff_location_pings enable row level security;
revoke all on public.staff_location_pings from anon, authenticated;   -- only through the functions below

insert into public.permissions (code, module, resource, action, description) values
  ('zonal.location.view', 'zonal', 'location', 'view', 'See how far staff are from their hub (hourly location while the app is open)')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
-- Admin too: a role can only be given by someone holding all its rights, so without it an Admin could no longer assign Zonal Managers.
select r.id, p.id from public.roles r join public.permissions p on p.code = 'zonal.location.view' where r.code in ('zonal_manager', 'admin')
on conflict do nothing;

-- Duty hours for sending (Dhaka time).
create or replace function private.location_duty_now() returns boolean
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Dhaka')::time between time '08:00' and time '20:00'
$$;

-- ---------------------------------------------------------------------
-- The app asks once a session: should this person send, and when was the last one?
create or replace function public.my_location_need() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_last timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('track', false); end if;
  select * into e from public.employees x where x.profile_id = auth.uid() and x.archived_at is null and x.status = 'active' limit 1;
  if e.id is null or e.hub_id is null then return jsonb_build_object('track', false); end if;
  select max(at) into v_last from public.staff_location_pings where employee_id = e.id;
  return jsonb_build_object('track', true, 'duty_now', private.location_duty_now(), 'from', '08:00', 'to', '20:00', 'last_at', v_last);
end $$;

-- The app sends a location; kept at most once in 50 minutes, only in duty hours.
create or replace function public.staff_location_ping(p_lat numeric, p_lng numeric, p_accuracy numeric default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_last timestamptz; v_place jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad location' using errcode = '22023';
  end if;
  select * into e from public.employees x where x.profile_id = auth.uid() and x.archived_at is null and x.status = 'active' limit 1;
  if e.id is null or e.hub_id is null then return jsonb_build_object('saved', false, 'why', 'not_staff'); end if;
  if not private.location_duty_now() then return jsonb_build_object('saved', false, 'why', 'off_duty'); end if;
  select max(at) into v_last from public.staff_location_pings where employee_id = e.id;
  if v_last is not null and v_last > now() - interval '50 minutes' then
    return jsonb_build_object('saved', false, 'why', 'too_soon', 'last_at', v_last);
  end if;
  v_place := private.hub_place(e.hub_id, p_lat, p_lng, p_accuracy);
  insert into public.staff_location_pings (employee_id, hub_id, zone_id, latitude, longitude, accuracy_m, distance_m, place_status, wifi_match)
  values (e.id, e.hub_id, e.zone_id, p_lat, p_lng, round(p_accuracy), (v_place->>'distance_m')::int, v_place->>'status',
          coalesce((v_place->>'wifi')::boolean, false));
  -- keep 30 days
  delete from public.staff_location_pings where employee_id = e.id and at < now() - interval '30 days';
  return jsonb_build_object('saved', true, 'status', v_place->>'status', 'distance_m', (v_place->>'distance_m')::int);
end $$;

-- ---------------------------------------------------------------------
-- Zonal manager: every active staff member of the zone(s) with their latest location today.
create or replace function public.zonal_staff_locations(p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_zone is not null and not private.has_permission('zonal.location.view', p_zone, null) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.zone_name, x.hub_name, x.full_name) from (
    select e.id employee_id, e.employee_code, e.full_name, e.mobile, p.name position, e.hub_id, h.name hub_name, h.code hub_code,
           e.zone_id, z.name zone_name, h.latitude hub_lat, h.longitude hub_lng,
           l.at last_at, l.latitude, l.longitude, l.accuracy_m, l.distance_m, l.place_status, l.wifi_match,
           (select count(*) from public.staff_location_pings t where t.employee_id = e.id and t.at >= date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka')::int today_count
      from public.employees e
      join public.zones z on z.id = e.zone_id
      left join public.hubs h on h.id = e.hub_id
      left join public.positions p on p.id = e.position_id
      left join lateral (select * from public.staff_location_pings t where t.employee_id = e.id order by t.at desc limit 1) l on true
     where e.archived_at is null and e.status = 'active' and e.hub_id is not null
       and (p_zone is null or e.zone_id = p_zone)
       and private.has_permission('zonal.location.view', e.zone_id, null)) x), '[]'::jsonb);
end $$;

-- One person's pings on a day (the hourly trail).
create or replace function public.zonal_staff_location_day(p_employee uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid;
begin
  select zone_id into v_zone from public.employees where id = p_employee;
  if v_zone is null or not private.has_permission('zonal.location.view', v_zone, null) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', t.at, 'latitude', t.latitude, 'longitude', t.longitude, 'accuracy_m', t.accuracy_m,
      'distance_m', t.distance_m, 'place_status', t.place_status, 'wifi_match', t.wifi_match) order by t.at)
    from public.staff_location_pings t
   where t.employee_id = p_employee and (t.at at time zone 'Asia/Dhaka')::date = p_date), '[]'::jsonb);
end $$;

revoke all on function private.location_duty_now() from public, anon;
revoke all on function public.my_location_need(), public.staff_location_ping(numeric, numeric, numeric),
  public.zonal_staff_locations(uuid), public.zonal_staff_location_day(uuid, date) from public, anon;
grant execute on function public.my_location_need(), public.staff_location_ping(numeric, numeric, numeric),
  public.zonal_staff_locations(uuid), public.zonal_staff_location_day(uuid, date) to authenticated;
