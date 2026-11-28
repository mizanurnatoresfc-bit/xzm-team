-- Vehicle departure time anchors the evening Data Entry shift clock.
-- The hub's standing start time stays the default. A Zone Manager can set the real vehicle departure time
-- for the current or next operating day; the shift hours and the three check-ins then count from that time,
-- and the staff panel shows the same timing. Clearing the override returns to the standing start time.
create table private.data_entry_shift_departures (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  departure_time time not null check (departure_time between '16:00' and '23:59'),
  set_by uuid not null,
  primary key (hub_id, work_date)
);
revoke all on private.data_entry_shift_departures from public, anon, authenticated;
create trigger data_entry_audit after insert or update on private.data_entry_shift_departures
  for each row execute function private.data_entry_target_input_audit();

-- Shift start for one operating day: that day's departure time, else the hub's standing start, else 18:00 Dhaka.
create function private.data_entry_shift_start(p_hub uuid, p_day date)
returns timestamp language sql stable set search_path = '' as $$
  select p_day + coalesce(
    (select d.departure_time from private.data_entry_shift_departures d where d.hub_id = p_hub and d.work_date = p_day),
    (select c.start_time from private.data_entry_shift_settings c where c.hub_id = p_hub),
    '18:00'::time)
$$;
revoke execute on function private.data_entry_shift_start(uuid,date) from public, anon, authenticated;

-- Same contract as before; only the start of each candidate day now honours its departure override.
create or replace function private.data_entry_shift_window(p_hub uuid, p_now timestamptz)
returns table (day date, elapsed integer, open_minutes integer, checkpoints integer[], pickup_only boolean)
language sql stable set search_path = '' as $$
  with local_clock as (select p_now at time zone 'Asia/Dhaka' as local_now),
  defaults as (select coalesce(cfg.open_minutes, 480) as duration,
    array[coalesce(cfg.first_minute, 0),coalesce(cfg.second_minute, 90),coalesce(cfg.third_minute, 180)] as checks,
    coalesce(cfg.pickup_only, false) as pickup_only, local_now
    from local_clock left join private.data_entry_shift_settings cfg on cfg.hub_id = p_hub),
  shift_clock as (select *, private.data_entry_shift_start(p_hub, local_now::date) as today_start,
    private.data_entry_shift_start(p_hub, local_now::date - 1) as yesterday_start from defaults),
  shift as (select *, case when local_now < today_start and local_now < yesterday_start + duration * interval '1 minute'
    then yesterday_start else today_start end as starts_at from shift_clock)
  select starts_at::date, floor(extract(epoch from local_now - starts_at) / 60)::integer, duration, checks, pickup_only from shift
$$;

-- Zone Manager sets (or clears, with a null time) the vehicle departure time for the current or next operating day.
create function public.data_entry_shift_departure(p_hub uuid, p_day date, p_time time)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_window record;
  previous private.data_entry_shift_departures%rowtype;
begin
  if auth.uid() is null or not private.data_entry_is_zone_owner(p_hub) then
    raise exception 'Zone manager access is required' using errcode = '42501';
  end if;
  select * into current_window from private.data_entry_shift_window(p_hub, private.data_entry_shift_now());
  if p_day is null or p_day not between current_window.day and current_window.day + 1 then
    raise exception 'Departure time can be set for the current or next shift only' using errcode = '22023';
  end if;
  if p_time is null then
    delete from private.data_entry_shift_departures where hub_id = p_hub and work_date = p_day returning * into previous;
    if found then
      perform private.write_audit('DELETE', 'data_entry', 'data_entry_shift_departures', p_hub::text, to_jsonb(previous), null);
    end if;
    return;
  end if;
  if p_time not between '16:00'::time and '23:59'::time then
    raise exception 'Departure time must be between 16:00 and 23:59' using errcode = '22023';
  end if;
  insert into private.data_entry_shift_departures values (p_hub, p_day, p_time, auth.uid())
  on conflict (hub_id, work_date) do update set departure_time = excluded.departure_time, set_by = excluded.set_by;
end $$;

-- Timing for the shift panel. Readable by the Zone Manager, a delegated Head and the hub's own Data Entry staff.
create function public.data_entry_shift_timing(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  w record;
  starts timestamp;
  standing time;
begin
  if auth.uid() is null or not (private.data_entry_owner_or_head(p_hub, 'read') or private.data_entry_my_member(p_hub) is not null) then
    raise exception 'This hub is outside your Data Entry scope' using errcode = '42501';
  end if;
  select * into w from private.data_entry_shift_window(p_hub, private.data_entry_shift_now());
  starts := private.data_entry_shift_start(p_hub, w.day);
  standing := coalesce((select c.start_time from private.data_entry_shift_settings c where c.hub_id = p_hub), '18:00'::time);
  return jsonb_build_object(
    'day', w.day, 'elapsed', w.elapsed, 'open_minutes', w.open_minutes,
    'running', private.data_entry_shift_ready(p_hub, private.data_entry_shift_now()),
    'starts_at', starts at time zone 'Asia/Dhaka', 'ends_at', (starts + w.open_minutes * interval '1 minute') at time zone 'Asia/Dhaka',
    'standing_start', to_char(standing, 'HH24:MI'),
    'departure', (select to_char(d.departure_time, 'HH24:MI') from private.data_entry_shift_departures d where d.hub_id = p_hub and d.work_date = w.day),
    'next_day', w.day + 1,
    'next_departure', (select to_char(d.departure_time, 'HH24:MI') from private.data_entry_shift_departures d where d.hub_id = p_hub and d.work_date = w.day + 1),
    'checkpoints', (select jsonb_agg(jsonb_build_object('slot', s, 'minute', w.checkpoints[s],
        'at', (starts + w.checkpoints[s] * interval '1 minute') at time zone 'Asia/Dhaka') order by s) from generate_series(1,3) s));
end $$;

revoke all on function public.data_entry_shift_departure(uuid,date,time), public.data_entry_shift_timing(uuid) from public, anon;
grant execute on function public.data_entry_shift_departure(uuid,date,time), public.data_entry_shift_timing(uuid) to authenticated;
