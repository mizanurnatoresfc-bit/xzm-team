-- Offline check-in (additive in effect; the old signature is replaced because a second one with the same name would make named calls ambiguous):
-- route_checkin takes an optional `p_at`, the time the phone actually took the reading. A rider without signal keeps the check-in on the phone and
-- sends it later; without this the late check-in would be stamped with the time it arrived.
--  * p_at null = now(), exactly as before.
--  * p_at must not be in the future (5 minutes of clock slack) and not older than 48 hours, else 22023.
--  * the day it counts for is the Bangladesh day of p_at (Asia/Dhaka), not the day it arrived.
--  * an older reading never replaces a later one of the same stop and day (check-ins may arrive out of order); "near stays near" still holds.
drop function if exists public.route_checkin(uuid, numeric, numeric, numeric, text);
create or replace function public.route_checkin(p_stop uuid, p_lat numeric, p_lng numeric, p_accuracy numeric default null, p_note text default null,
  p_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id(); s public.hub_route_stops; v_rules jsonb; v_d double precision; v_near boolean; v_radius integer;
  v_old public.route_stop_visits; v_at timestamptz := coalesce(p_at, now()); v_day date := (coalesce(p_at, now()) at time zone 'Asia/Dhaka')::date;
begin
  if v_emp is null then raise exception 'No active staff profile is linked to this login.' using errcode = '42501'; end if;
  if p_at is not null and p_at > now() + interval '5 minutes' then raise exception 'The check-in time is in the future: check the phone clock.' using errcode = '22023'; end if;
  if p_at is not null and p_at < now() - interval '48 hours' then raise exception 'The check-in is too old to be accepted (more than 48 hours).' using errcode = '22023'; end if;
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
  select * into v_old from public.route_stop_visits where stop_id = s.id and employee_id = v_emp and work_date = v_day;
  -- already checked in near this stop that day: that visit stands, a later press from far away does not undo it
  if v_old.id is not null and v_old.near and not v_near then
    return jsonb_build_object('distance_m', v_old.distance_m, 'near', true, 'radius_m', v_radius, 'kept', true);
  end if;
  -- a reading older than the one already saved (it came late) does not replace it
  if v_old.id is not null and v_old.visited_at > v_at then
    return jsonb_build_object('distance_m', v_old.distance_m, 'near', v_old.near, 'radius_m', v_radius, 'kept', true);
  end if;
  insert into public.route_stop_visits as v (route_id, stop_id, employee_id, hub_id, zone_id, work_date, visited_at, lat, lng, accuracy_m, distance_m, near, note)
  values (s.route_id, s.id, v_emp, s.hub_id, s.zone_id, v_day, v_at, round(p_lat, 7), round(p_lng, 7), round(p_accuracy)::integer, round(v_d)::integer, v_near,
          nullif(trim(coalesce(p_note, '')), ''))
  on conflict (stop_id, employee_id, work_date) do update set visited_at = excluded.visited_at, lat = excluded.lat, lng = excluded.lng,
    accuracy_m = excluded.accuracy_m, distance_m = excluded.distance_m, near = excluded.near, note = coalesce(excluded.note, v.note);
  return jsonb_build_object('distance_m', round(v_d)::integer, 'near', v_near, 'radius_m', v_radius, 'at', v_at);
end $$;

revoke all on function public.route_checkin(uuid, numeric, numeric, numeric, text, timestamptz) from public, anon;
grant execute on function public.route_checkin(uuid, numeric, numeric, numeric, text, timestamptz) to authenticated;
