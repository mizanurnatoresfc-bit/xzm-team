-- =====================================================================
--  রুট থেকে পাঠাচ্ছি (route dispatch)
--  A person on a rider route says "Lalpur: sending 20 parcels, and these office items" to another hub or a
--  sorting centre. The receiving hub manager / sorting staff see it under "আসছে" and confirm it, or raise an
--  objection with the count they found. Parcels are counts (and bags); items are either the hub's office
--  resources or entries of the sorting-items list (setting dispatch.sorting_items).
--  Nothing is read or written directly: the tables have no policies, everything goes through the functions below,
--  which check the person's hub, route and permissions themselves.
-- =====================================================================
insert into public.system_settings (key, value, description) values
  ('dispatch.sorting_items', '["পলি ব্যাগ","সিল","প্যাকেজিং টেপ","স্ট্যাম্প প্যাড","বক্স","লেবেল রোল"]'::jsonb, 'Items that may be sent to the sorting centre (পাঠাচ্ছি)')
on conflict (key) do nothing;

create table public.route_dispatches (
  id            uuid primary key default gen_random_uuid(),
  no            bigint generated always as identity,
  zone_id       uuid not null references public.zones(id),
  route_id      uuid references public.hub_routes(id),
  from_hub_id   uuid not null references public.hubs(id),
  to_kind       text not null check (to_kind in ('hub', 'sorting')),
  to_hub_id     uuid references public.hubs(id),
  to_center_id  uuid references public.sorting_centers(id),
  work_date     date not null default (now() at time zone 'Asia/Dhaka')::date,
  parcel_count  integer not null default 0 check (parcel_count >= 0),
  bag_count     integer check (bag_count is null or bag_count >= 0),
  note          text,
  status        text not null default 'sent' check (status in ('sent', 'received', 'disputed')),
  sender_id     uuid references public.employees(id),
  sender_name   text,
  received_by_name text, received_at timestamptz, received_parcels integer check (received_parcels is null or received_parcels >= 0), receive_note text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid,
  check ((to_kind = 'hub' and to_hub_id is not null and to_center_id is null) or (to_kind = 'sorting' and to_center_id is not null and to_hub_id is null)),
  check (to_hub_id is null or to_hub_id <> from_hub_id),
  check (status <> 'disputed' or length(trim(coalesce(receive_note, ''))) > 0)
);
create index route_dispatches_from on public.route_dispatches (from_hub_id, work_date desc);
create index route_dispatches_to_hub on public.route_dispatches (to_hub_id, status) where to_hub_id is not null;
create index route_dispatches_to_center on public.route_dispatches (to_center_id, status) where to_center_id is not null;
create index route_dispatches_route on public.route_dispatches (route_id) where route_id is not null;
create index route_dispatches_zone on public.route_dispatches (zone_id);
create index route_dispatches_sender on public.route_dispatches (sender_id) where sender_id is not null;

create table public.route_dispatch_items (
  id          uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.route_dispatches(id),
  kind        text not null check (kind in ('asset', 'sorting_item')),
  asset_id    uuid references public.office_assets(id),
  name        text not null check (length(trim(name)) > 0),
  quantity    integer not null default 1 check (quantity > 0),
  check (kind <> 'asset' or asset_id is not null)
);
create index route_dispatch_items_dispatch on public.route_dispatch_items (dispatch_id);
create index route_dispatch_items_asset on public.route_dispatch_items (asset_id) where asset_id is not null;

create trigger route_dispatches_no_delete before delete on public.route_dispatches for each row execute function private.prevent_delete();
create trigger route_dispatch_items_no_delete before delete on public.route_dispatch_items for each row execute function private.prevent_delete();
alter table public.route_dispatches enable row level security;
alter table public.route_dispatch_items enable row level security;
revoke all on public.route_dispatches, public.route_dispatch_items from anon, authenticated;

-- ---------------------------------------------------------------------
--  What the sender may choose from
-- ---------------------------------------------------------------------
create or replace function public.dispatch_context()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_manager boolean;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into e from public.employees where profile_id = auth.uid() and archived_at is null limit 1;
  if e.id is null or e.hub_id is null then raise exception 'আপনার লগইনের সাথে কোনো হাবের কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  v_manager := private.has_permission('sorting.parcel.create', e.zone_id, e.hub_id);
  return jsonb_build_object(
    'employee', jsonb_build_object('id', e.id, 'name', e.full_name, 'hub_id', e.hub_id, 'hub', (select h.name from public.hubs h where h.id = e.hub_id)),
    'routes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'areas', r.areas) order by r.code)
        from public.hub_routes r
        where r.archived_at is null and r.hub_id = e.hub_id
          and (v_manager or exists (select 1 from public.rider_routes rr where rr.route_id = r.id and rr.employee_id = e.id and rr.effective_to is null))), '[]'::jsonb),
    'hubs', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name) order by h.name) from public.hubs h
        where h.zone_id = e.zone_id and h.archived_at is null and h.id <> e.hub_id), '[]'::jsonb),
    'centers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from public.sorting_centers c
        where c.zone_id = e.zone_id and c.archived_at is null and c.status = 'active'), '[]'::jsonb),
    'sorting_items', coalesce((select value from public.system_settings where key = 'dispatch.sorting_items'), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'quantity', a.quantity) order by a.name)
        from public.office_assets a join public.office_properties p on p.id = a.property_id
        where p.hub_id = e.hub_id and a.archived_at is null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
--  Send
-- ---------------------------------------------------------------------
create or replace function public.dispatch_send(p_route uuid, p_to_kind text, p_to uuid, p_parcels integer, p_bags integer, p_items jsonb, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.employees; r public.hub_routes; v_id uuid; it jsonb; v_qty integer; v_name text; v_aid uuid; v_kind text; v_n integer := 0;
        v_parcels integer := coalesce(p_parcels, 0);
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into e from public.employees where profile_id = auth.uid() and archived_at is null limit 1;
  if e.id is null or e.hub_id is null then raise exception 'আপনার লগইনের সাথে কোনো হাবের কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  if p_to_kind not in ('hub', 'sorting') then raise exception 'গন্তব্য হাব নাকি শটিং কেন্দ্র — বলুন' using errcode = '22023'; end if;
  if v_parcels < 0 or coalesce(p_bags, 0) < 0 then raise exception 'সংখ্যা ০ বা তার বেশি হতে হবে' using errcode = '22023'; end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then raise exception 'জিনিসের তালিকা ঠিক নয়' using errcode = '22023'; end if;
  if v_parcels = 0 and coalesce(jsonb_array_length(p_items), 0) = 0 then raise exception 'পার্সেলের সংখ্যা বা অন্তত একটি জিনিস দিন' using errcode = '22023'; end if;
  if p_route is not null then
    select * into r from public.hub_routes where id = p_route and archived_at is null;
    if r.id is null or r.hub_id <> e.hub_id then raise exception 'এই রুট আপনার হাবের নয়' using errcode = '42501'; end if;
    if not (exists (select 1 from public.rider_routes rr where rr.route_id = r.id and rr.employee_id = e.id and rr.effective_to is null)
            or private.has_permission('sorting.parcel.create', e.zone_id, e.hub_id)) then
      raise exception 'আপনি এই রুটে নেই' using errcode = '42501'; end if;
  elsif not private.has_permission('sorting.parcel.create', e.zone_id, e.hub_id) then
    raise exception 'রুট বাছুন' using errcode = '22023';
  end if;
  if p_to_kind = 'hub' then
    if not exists (select 1 from public.hubs h where h.id = p_to and h.zone_id = e.zone_id and h.archived_at is null and h.id <> e.hub_id) then
      raise exception 'গন্তব্য হাব ঠিক নয়' using errcode = '22023'; end if;
  elsif not exists (select 1 from public.sorting_centers c where c.id = p_to and c.zone_id = e.zone_id and c.archived_at is null and c.status = 'active') then
    raise exception 'গন্তব্য শটিং কেন্দ্র ঠিক নয়' using errcode = '22023';
  end if;

  insert into public.route_dispatches (zone_id, route_id, from_hub_id, to_kind, to_hub_id, to_center_id, parcel_count, bag_count, note, sender_id, sender_name, created_by)
  values (e.zone_id, p_route, e.hub_id, p_to_kind, case when p_to_kind = 'hub' then p_to end, case when p_to_kind = 'sorting' then p_to end,
          v_parcels, p_bags, nullif(trim(coalesce(p_note, '')), ''), e.id, e.full_name || coalesce(' (' || e.employee_code || ')', ''), auth.uid())
  returning id into v_id;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_n := v_n + 1; if v_n > 40 then raise exception 'একবারে ৪০টির বেশি জিনিস নয়' using errcode = '22023'; end if;
    v_kind := it ->> 'kind'; v_qty := coalesce((it ->> 'qty')::integer, 1); v_name := nullif(trim(coalesce(it ->> 'name', '')), '');
    if v_qty < 1 or v_qty > 100000 then raise exception 'জিনিসের সংখ্যা ঠিক নয়' using errcode = '22023'; end if;
    if v_kind = 'asset' then
      v_aid := (it ->> 'asset_id')::uuid;
      select a.name into v_name from public.office_assets a join public.office_properties p on p.id = a.property_id
       where a.id = v_aid and a.archived_at is null and p.hub_id = e.hub_id;
      if v_name is null then raise exception 'এই জিনিস আপনার হাবের অফিসের নয়' using errcode = '42501'; end if;
      insert into public.route_dispatch_items (dispatch_id, kind, asset_id, name, quantity) values (v_id, 'asset', v_aid, v_name, v_qty);
    elsif v_kind = 'sorting_item' then
      if p_to_kind <> 'sorting' then raise exception 'শটিং-তালিকার জিনিস শুধু শটিং কেন্দ্রে পাঠানো যায়' using errcode = '22023'; end if;
      if v_name is null or not exists (select 1 from public.system_settings s, jsonb_array_elements_text(s.value) x where s.key = 'dispatch.sorting_items' and x = v_name) then
        raise exception 'এই জিনিস শটিং-তালিকায় নেই' using errcode = '22023'; end if;
      insert into public.route_dispatch_items (dispatch_id, kind, name, quantity) values (v_id, 'sorting_item', v_name, v_qty);
    else raise exception 'জিনিসের ধরন ঠিক নয়' using errcode = '22023';
    end if;
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  List: scope 'mine' (what I sent, plus what my hub sent if I manage it) or 'incoming' (what I may receive)
-- ---------------------------------------------------------------------
create or replace function public.dispatch_list(p_scope text default 'mine', p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid; v_from date := (now() at time zone 'Asia/Dhaka')::date - greatest(coalesce(p_days, 30), 1);
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_scope not in ('mine', 'incoming') then raise exception 'scope?' using errcode = '22023'; end if;
  v_me := private.my_employee_id();
  return coalesce((
    select jsonb_agg(x.j order by x.d desc, x.n desc) from (
      select d.work_date d, d.no n, jsonb_build_object(
        'id', d.id, 'no', d.no, 'date', d.work_date, 'route', (select r.name from public.hub_routes r where r.id = d.route_id),
        'from_hub', (select h.name from public.hubs h where h.id = d.from_hub_id), 'to_kind', d.to_kind,
        'to', case when d.to_kind = 'hub' then (select h.name from public.hubs h where h.id = d.to_hub_id) else (select c.name from public.sorting_centers c where c.id = d.to_center_id) end,
        'parcels', d.parcel_count, 'bags', d.bag_count, 'note', d.note, 'status', d.status, 'sender', d.sender_name,
        'received_by', d.received_by_name, 'received_at', d.received_at, 'received_parcels', d.received_parcels, 'receive_note', d.receive_note,
        'mine', d.created_by = auth.uid(),
        'can_receive', d.status = 'sent' and ((d.to_kind = 'hub' and private.has_permission('sorting.parcel.create', d.zone_id, d.to_hub_id))
                                              or (d.to_kind = 'sorting' and private.has_permission('sorting.parcel.create', d.zone_id, null))),
        'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'name', i.name, 'qty', i.quantity) order by i.name) from public.route_dispatch_items i where i.dispatch_id = d.id), '[]'::jsonb)) j
      from public.route_dispatches d
      where d.work_date >= v_from
        and case when p_scope = 'mine'
              then d.created_by = auth.uid() or d.sender_id = v_me or private.has_permission('sorting.parcel.view', d.zone_id, d.from_hub_id)
              else (d.to_kind = 'hub' and (private.has_permission('sorting.parcel.view', d.zone_id, d.to_hub_id) or private.has_permission('sorting.parcel.create', d.zone_id, d.to_hub_id)))
                or (d.to_kind = 'sorting' and (private.has_permission('sorting.parcel.view', d.zone_id, null) or private.has_permission('sorting.parcel.create', d.zone_id, null)))
            end
      limit 200) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
--  Receive (confirm, or object with the count that was found)
-- ---------------------------------------------------------------------
create or replace function public.dispatch_receive(p_id uuid, p_ok boolean, p_received integer, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.route_dispatches; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_ok is null then raise exception 'ঠিক আছে নাকি আপত্তি — বলুন' using errcode = '22023'; end if;
  select * into d from public.route_dispatches where id = p_id for update;
  if d.id is null then raise exception 'এই পাঠানো পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not ((d.to_kind = 'hub' and private.has_permission('sorting.parcel.create', d.zone_id, d.to_hub_id))
       or (d.to_kind = 'sorting' and private.has_permission('sorting.parcel.create', d.zone_id, null))) then
    raise exception 'এটা বুঝে নেওয়ার অনুমতি আপনার নেই' using errcode = '42501'; end if;
  if d.status <> 'sent' then raise exception 'এটা আগেই বুঝে নেওয়া বা জানানো হয়েছে' using errcode = '22023'; end if;
  if d.created_by = auth.uid() then raise exception 'নিজের পাঠানো নিজে বুঝে নেওয়া যায় না' using errcode = '42501'; end if;
  if coalesce(p_received, d.parcel_count) < 0 then raise exception 'সংখ্যা ০ বা তার বেশি হতে হবে' using errcode = '22023'; end if;
  if not p_ok and v_note is null then raise exception 'আপত্তির কারণ লিখুন' using errcode = '22023'; end if;
  if p_ok and coalesce(p_received, d.parcel_count) <> d.parcel_count and v_note is null then
    raise exception 'সংখ্যা না মিললে কারণ লিখুন বা আপত্তি দিন' using errcode = '22023'; end if;
  update public.route_dispatches set status = case when p_ok then 'received' else 'disputed' end, received_by_name = private.my_display_name(), received_at = now(),
         received_parcels = coalesce(p_received, parcel_count), receive_note = v_note, updated_at = now(), updated_by = auth.uid()
   where id = p_id;
  perform private.notify(d.created_by, case when p_ok then 'পাঠানো বুঝে নেওয়া হয়েছে' else 'পাঠানোয় আপত্তি এসেছে' end,
    '#' || d.no || ' — ' || coalesce(v_note, case when p_ok then 'ঠিকঠাক পৌঁছেছে' else '' end), '/app/dispatch', 'dispatch');
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.dispatch_context()', 'public.dispatch_send(uuid, text, uuid, integer, integer, jsonb, text)',
                           'public.dispatch_list(text, integer)', 'public.dispatch_receive(uuid, boolean, integer, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
