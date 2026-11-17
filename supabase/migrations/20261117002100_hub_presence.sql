-- =====================================================================
-- XZM-TEAM ERP — Is the staff member at the hub? (location + hub Wi-Fi)
--
-- Owner (16 Nov): "হাবের লোকেশন তো আছে — ওয়াইফাই বা ডাটা যেভাবেই হোক, হাবের কাছে বা হাবে আছেন
--   এই রকম ইনফো পাওয়া যাবে।"
--
--  * GPS: the phone's location (works on Wi-Fi or mobile data) is compared with the hub's GPS:
--      at_hub (within the hub's radius, default 150 m) · near (within 1 km) · far · no_gps (phone gave none)
--      · hub_no_gps (the hub has no GPS yet).
--  * Wi-Fi: a web page cannot read the Wi-Fi name, but the server sees the public internet address (IP)
--    a request comes from. A hub manager saves the hub's Wi-Fi once while connected to it; afterwards a
--    request from that address is "from the hub's Wi-Fi". Mobile data addresses change and are never matched.
--  * Information only: it is shown to the manager next to the staff member's attendance and never blocks it
--    (the owner's rule stays: a manager's approval decides).
-- =====================================================================

alter table public.hubs
  add column if not exists geo_radius_m integer not null default 150 check (geo_radius_m between 30 and 2000),
  add column if not exists wifi_ips text[] not null default '{}';

alter table public.attendance_self_marks
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(10,7),
  add column if not exists accuracy_m integer,
  add column if not exists distance_m integer,
  add column if not exists place_status text check (place_status in ('at_hub', 'near', 'far', 'no_gps', 'hub_no_gps')),
  add column if not exists client_ip text,
  add column if not exists wifi_match boolean not null default false;

-- ---------------------------------------------------------------------
-- The caller's public internet address, as the API gateway passed it on.
create or replace function private.client_ip() returns text
language sql stable set search_path = '' as $$
  select nullif(trim(coalesce(
    split_part(private.request_header('x-forwarded-for'), ',', 1),
    private.request_header('cf-connecting-ip'),
    private.request_header('x-real-ip'), '')), '')
$$;

-- Distance in metres between two GPS points.
create or replace function private.geo_m(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns integer
language sql immutable set search_path = '' as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians((b_lat - a_lat)::float8) / 2), 2) +
    cos(radians(a_lat::float8)) * cos(radians(b_lat::float8)) * power(sin(radians((b_lng - a_lng)::float8) / 2), 2))))::int
$$;

-- Where is this point relative to the hub, and is the request from the hub's Wi-Fi?
create or replace function private.hub_place(p_hub uuid, p_lat numeric, p_lng numeric, p_accuracy numeric) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.hubs; v_d integer; v_ip text := private.client_ip(); v_status text;
begin
  select * into h from public.hubs where id = p_hub;
  if h.id is null then return null; end if;
  if p_lat is not null and p_lng is not null and h.latitude is not null and h.longitude is not null then
    v_d := private.geo_m(h.latitude, h.longitude, p_lat, p_lng);
  end if;
  v_status := case
    when p_lat is null or p_lng is null then 'no_gps'
    when h.latitude is null or h.longitude is null then 'hub_no_gps'
    -- a rough fix (big accuracy circle) that still touches the hub counts as near, not at
    when v_d <= h.geo_radius_m and coalesce(p_accuracy, 0) <= greatest(h.geo_radius_m * 2, 200) then 'at_hub'
    when v_d - least(coalesce(p_accuracy, 0), 1000) <= 1000 then 'near'
    else 'far' end;
  return jsonb_build_object('hub_id', h.id, 'hub_name', h.name, 'distance_m', v_d, 'status', v_status, 'radius_m', h.geo_radius_m,
    'accuracy_m', round(p_accuracy), 'wifi', v_ip is not null and v_ip = any(h.wifi_ips), 'hub_has_gps', h.latitude is not null,
    'hub_has_wifi', cardinality(h.wifi_ips) > 0);
end $$;
revoke all on function private.client_ip(), private.hub_place(uuid, numeric, numeric, numeric) from public, anon;

-- ---------------------------------------------------------------------
-- Staff: "am I at my hub?" any time, without marking anything.
create or replace function public.hub_presence_check(p_lat numeric default null, p_lng numeric default null, p_accuracy numeric default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hub uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select e.hub_id into v_hub from public.employees e where e.profile_id = auth.uid() and e.archived_at is null
   order by (e.status = 'active') desc limit 1;
  if v_hub is null then return null; end if;
  return private.hub_place(v_hub, p_lat, p_lng, p_accuracy);
end $$;

-- ---------------------------------------------------------------------
-- Self attendance now carries the place (the old two-argument form is replaced; old callers still work).
drop function if exists public.att_self_mark(text, text);
create or replace function public.att_self_mark(p_kind text, p_note text default null,
  p_lat numeric default null, p_lng numeric default null, p_accuracy numeric default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_day date := (now() at time zone 'Asia/Dhaka')::date; v_id uuid; v_old public.attendance_self_marks;
  v_note text := nullif(trim(coalesce(p_note, '')), ''); v_place jsonb; v_where text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into e from public.employees x where x.profile_id = auth.uid() and x.archived_at is null and x.status = 'active' limit 1;
  if e.id is null then raise exception 'No active staff profile is linked to your login' using errcode = '42501'; end if;
  if p_kind not in ('present','absent') then raise exception 'Unknown attendance kind' using errcode = '22023'; end if;
  if p_kind = 'absent' and v_note is null then raise exception 'Write the reason for not coming' using errcode = '22023'; end if;
  if (p_lat is not null and (p_lat < -90 or p_lat > 90)) or (p_lng is not null and (p_lng < -180 or p_lng > 180)) then
    raise exception 'Bad location' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_records a where a.employee_id = e.id and a.work_date = v_day) then
    raise exception 'Today''s attendance is already on the register' using errcode = '23505';
  end if;
  select * into v_old from public.attendance_self_marks m where m.employee_id = e.id and m.work_date = v_day;
  if v_old.id is not null and v_old.status = 'approved' then
    raise exception 'Today''s attendance is already approved' using errcode = '23505';
  end if;
  if p_kind = 'present' and e.hub_id is not null then v_place := private.hub_place(e.hub_id, p_lat, p_lng, p_accuracy); end if;
  insert into public.attendance_self_marks (employee_id, hub_id, work_date, kind, note, latitude, longitude, accuracy_m, distance_m, place_status, client_ip, wifi_match)
  values (e.id, e.hub_id, v_day, p_kind, v_note, p_lat, p_lng, round(p_accuracy), (v_place->>'distance_m')::int, v_place->>'status',
          case when p_kind = 'present' then private.client_ip() end, coalesce((v_place->>'wifi')::boolean, false))
  on conflict (employee_id, work_date) do update
     set kind = excluded.kind, note = excluded.note, hub_id = excluded.hub_id, marked_at = now(), status = 'waiting',
         decided_as = null, decided_by = null, decided_at = null, decide_note = null,
         latitude = excluded.latitude, longitude = excluded.longitude, accuracy_m = excluded.accuracy_m, distance_m = excluded.distance_m,
         place_status = excluded.place_status, client_ip = excluded.client_ip, wifi_match = excluded.wifi_match
  returning id into v_id;
  v_where := case v_place->>'status'
    when 'at_hub' then ' · হাবে আছেন' when 'near' then ' · হাবের কাছে (' || (v_place->>'distance_m') || ' মি)'
    when 'far' then ' · হাব থেকে দূরে (' || round((v_place->>'distance_m')::numeric / 1000, 1) || ' কিমি)'
    when 'no_gps' then ' · লোকেশন দেননি' else '' end
    || case when (v_place->>'wifi')::boolean then ' · হাবের ওয়াইফাই' else '' end;
  if e.hub_id is not null then
    perform private.att_notify_hub(e.hub_id,
      case p_kind when 'present' then 'হাজিরা অনুমোদন বাকি' else 'আজ আসবেন না — অনুমোদন বাকি' end,
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || case p_kind when 'present'
        then ' · হাবে এসেছেন ' || to_char(now() at time zone 'Asia/Dhaka', 'HH12:MI AM') || coalesce(v_where, '') else ' · কারণ: ' || v_note end,
      '/app/hub/attendance');
  end if;
  return v_id;
end $$;

-- Today's own mark, with the place.
create or replace function public.my_att_today() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid; v_day date := (now() at time zone 'Asia/Dhaka')::date;
begin
  select e.id into v_emp from public.employees e where e.profile_id = auth.uid() and e.archived_at is null and auth.uid() is not null
   order by (e.status = 'active') desc limit 1;
  if v_emp is null then return null; end if;
  return jsonb_build_object(
    'work_date', v_day,
    'record', (select jsonb_build_object('status', a.status, 'check_in', a.check_in, 'source', a.source)
                 from public.attendance_records a where a.employee_id = v_emp and a.work_date = v_day),
    'mark', (select jsonb_build_object('id', m.id, 'kind', m.kind, 'note', m.note, 'marked_at', m.marked_at, 'status', m.status,
                                       'decided_as', m.decided_as, 'decide_note', m.decide_note, 'decided_at', m.decided_at,
                                       'decided_by_name', (select p.full_name from public.profiles p where p.id = m.decided_by),
                                       'place_status', m.place_status, 'distance_m', m.distance_m, 'wifi_match', m.wifi_match)
               from public.attendance_self_marks m where m.employee_id = v_emp and m.work_date = v_day));
end $$;

-- The manager's list, with the place. (The raw GPS and address are not sent; the distance and the verdict are.)
create or replace function public.att_self_list(p_hub uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'employee_id', m.employee_id, 'employee_code', e.employee_code, 'full_name', e.full_name,
           'kind', m.kind, 'note', m.note, 'marked_at', m.marked_at, 'status', m.status, 'decided_as', m.decided_as,
           'decide_note', m.decide_note, 'decided_at', m.decided_at,
           'decided_by_name', (select p.full_name from public.profiles p where p.id = m.decided_by),
           'place_status', m.place_status, 'distance_m', m.distance_m, 'accuracy_m', m.accuracy_m, 'wifi_match', m.wifi_match)
         order by (m.status = 'waiting') desc, m.marked_at), '[]'::jsonb)
  from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
  where m.hub_id = p_hub and m.work_date = p_date
    and (private.employee_has_permission('hr.attendance.create', m.employee_id)
         or private.employee_has_permission('hr.attendance.view', m.employee_id))
$$;

-- ---------------------------------------------------------------------
-- Hub settings for the check: GPS + radius (people who may edit hubs), the hub's Wi-Fi (also the hub's managers).
create or replace function public.hub_place_info(p_hub uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.hubs; v_ip text := private.client_ip();
begin
  select * into h from public.hubs where id = p_hub;
  if h.id is null then raise exception 'Hub not found' using errcode = 'P0002'; end if;
  if not (private.has_permission('hr.attendance.create', null, p_hub) or private.has_permission('org.hub.edit', null, p_hub)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object('hub_id', h.id, 'latitude', h.latitude, 'longitude', h.longitude, 'radius_m', h.geo_radius_m,
    'wifi_count', cardinality(h.wifi_ips), 'on_hub_wifi', v_ip is not null and v_ip = any(h.wifi_ips), 'have_ip', v_ip is not null,
    'can_edit_gps', private.has_permission('org.hub.edit', null, p_hub));
end $$;

create or replace function public.hub_place_save(p_hub uuid, p_wifi text default null, p_lat numeric default null, p_lng numeric default null,
  p_radius integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.hubs; v_ip text := private.client_ip();
begin
  select * into h from public.hubs where id = p_hub and archived_at is null for update;
  if h.id is null then raise exception 'Hub not found' using errcode = 'P0002'; end if;
  if p_wifi is not null then
    if not (private.has_permission('hr.attendance.create', null, p_hub) or private.has_permission('org.hub.edit', null, p_hub)) then
      raise exception 'Not authorised' using errcode = '42501';
    end if;
    if p_wifi = 'add' then
      if v_ip is null then raise exception 'Your internet address could not be read' using errcode = '22023'; end if;
      perform set_config('app.change_reason', 'Hub Wi-Fi saved for the at-the-hub check', true);
      update public.hubs set wifi_ips = (select array_agg(distinct x) from unnest(wifi_ips || v_ip) x) where id = p_hub;
    elsif p_wifi = 'clear' then
      perform set_config('app.change_reason', 'Hub Wi-Fi cleared', true);
      update public.hubs set wifi_ips = '{}' where id = p_hub;
    else
      raise exception 'Unknown Wi-Fi action' using errcode = '22023';
    end if;
  end if;
  if p_lat is not null or p_lng is not null or p_radius is not null then
    if not private.has_permission('org.hub.edit', null, p_hub) then raise exception 'Not authorised' using errcode = '42501'; end if;
    if (p_lat is null) <> (p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
      raise exception 'Bad location' using errcode = '22023';
    end if;
    perform set_config('app.change_reason', 'Hub location for the at-the-hub check', true);
    update public.hubs set latitude = coalesce(p_lat, latitude), longitude = coalesce(p_lng, longitude),
      geo_radius_m = coalesce(p_radius, geo_radius_m) where id = p_hub;
  end if;
  return public.hub_place_info(p_hub);
end $$;

revoke all on function public.hub_presence_check(numeric, numeric, numeric), public.att_self_mark(text, text, numeric, numeric, numeric),
  public.my_att_today(), public.att_self_list(uuid, date), public.hub_place_info(uuid), public.hub_place_save(uuid, text, numeric, numeric, integer)
  from public, anon;
grant execute on function public.hub_presence_check(numeric, numeric, numeric), public.att_self_mark(text, text, numeric, numeric, numeric),
  public.my_att_today(), public.att_self_list(uuid, date), public.hub_place_info(uuid), public.hub_place_save(uuid, text, numeric, numeric, integer)
  to authenticated;
