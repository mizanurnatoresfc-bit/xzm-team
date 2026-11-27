create table public.sorting_receive_location (
  handover_id uuid primary key references public.sorting_handovers(id),
  network text not null check (network in ('wifi', 'cellular', 'ethernet', 'other', 'unknown')),
  result text not null check (result in ('near_hub', 'outside_hub', 'low_accuracy', 'hub_missing', 'unavailable')),
  distance_m integer,
  accuracy_m integer,
  exception_reason text,
  checked_at timestamptz not null default now()
);

alter table public.sorting_receive_location enable row level security;
revoke all on public.sorting_receive_location from public, anon, authenticated;
grant select on public.sorting_receive_location to authenticated;
create policy sorting_receive_location_read on public.sorting_receive_location
  for select to authenticated using (
    exists (select 1 from public.sorting_handovers h where h.id = handover_id)
  );

create function public.sorting_receive_with_location(
  p_id uuid, p_count integer, p_wrong integer, p_returned integer, p_damaged integer, p_note text,
  p_lat double precision, p_lng double precision, p_accuracy integer, p_network text, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  handover public.sorting_handovers;
  hub public.hubs;
  distance_m integer;
  result text;
  reason text := nullif(trim(p_reason), '');
begin
  select * into handover from public.sorting_handovers where id = p_id for update;
  if handover.id is null or handover.direction <> 'sorting_to_hub' or
    not private.has_permission('sorting.parcel.create', handover.zone_id, handover.hub_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.sorting_receive_location where handover_id = p_id
  ) and handover.received_by = auth.uid() then
    return;
  end if;

  select * into hub from public.hubs where id = handover.hub_id;
  if hub.latitude is null or hub.longitude is null then
    result := 'hub_missing';
  elsif p_lat is null or p_lng is null or p_accuracy is null then
    result := 'unavailable';
  elsif p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy < 0 then
    raise exception 'লোকেশনের তথ্য সঠিক নয়।';
  elsif p_accuracy > 100 then
    result := 'low_accuracy';
  else
    distance_m := round(6371000 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(p_lat - hub.latitude::double precision) / 2), 2)
      + cos(radians(p_lat)) * cos(radians(hub.latitude::double precision))
      * power(sin(radians(p_lng - hub.longitude::double precision) / 2), 2)
    ))));
    result := case when distance_m <= 150 then 'near_hub' else 'outside_hub' end;
  end if;

  if result <> 'near_hub' and reason is null then
    raise exception 'হাবের লোকেশন মেলেনি। আবার চেষ্টা করুন অথবা হাতে রিসিভের কারণ লিখুন।';
  end if;

  perform public.sorting_handover_receive(p_id, p_count, p_wrong, p_returned, p_damaged, p_note);
  insert into public.sorting_receive_location
    (handover_id, network, result, distance_m, accuracy_m, exception_reason)
  values
    (p_id, coalesce(p_network, 'unknown'), result, distance_m,
      case when p_accuracy >= 0 then p_accuracy end, left(reason, 500));
end;
$$;

revoke all on function public.sorting_receive_with_location(uuid, integer, integer, integer, integer, text, double precision, double precision, integer, text, text)
  from public, anon;
grant execute on function public.sorting_receive_with_location(uuid, integer, integer, integer, integer, text, double precision, double precision, integer, text, text)
  to authenticated;
