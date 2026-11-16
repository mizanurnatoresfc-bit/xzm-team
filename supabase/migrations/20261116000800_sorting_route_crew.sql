-- =====================================================================
-- XZM-TEAM ERP — Sorting routes: locations, crew, hub → sorting reports
--
-- Owner (16 Nov): "রুট প্যানেলে লোকেশন এড ও রাইডার এস্যাইন করা যাবে।
--   যে যে হাবে পার্সেল সেন্ড করে তাদের — ড্রাইভার, হেল্পার, ম্যানেজার এসাইন।
--   হাব ম্যানেজার ও স্টাফরা তাদের হাবের প্যানেলে সেই লোকগুলোর নাম ও নাম্বার দেখবে।
--   রিপোর্ট টু শটিং: পার্সেলের ছবি বা টেক্সট — শটিংয়ের প্যানেলে 'হাব টু শটিং রিপোর্ট'।
--   শটিং থেকে বিভিন্ন রুট (নাটোর → সাভার, → রাজশাহী-চাপাই, → বগুড়া-রংপুর) — সব হাবের জন্য নির্দেশনা।"
--
--  * sorting_routes: kind (hub | linehaul), return_time, instructions (for every hub).
--  * sorting_route_hubs becomes the route's STOPS: a hub (any area) or a free place
--    (e.g. "সাভার") with GPS, arrive time and stop instructions.
--  * sorting_route_crew: driver / helper / manager / rider / supervisor / other —
--    name + phone (by employee ID or typed), for the whole route or for one stop.
--  * sorting_hub_reports: a hub tells its sorting center about parcels (text and photos);
--    the center marks it seen / solved with a reply. Hub managers AND staff of that hub see them.
--  * Hub people (staff by their employee hub, managers by permission) read everything through
--    sorting_hub_panel(); the center reads through sorting_routes_full() / sorting_hub_reports().
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Routes and stops
-- ---------------------------------------------------------------------
alter table public.sorting_routes
  add column if not exists kind text not null default 'hub' check (kind in ('hub', 'linehaul')),
  add column if not exists return_time time,
  add column if not exists instructions text;

alter table public.sorting_route_hubs alter column hub_id drop not null;
alter table public.sorting_route_hubs
  add column if not exists place text,
  add column if not exists latitude numeric(10,7) check (latitude is null or latitude between -90 and 90),
  add column if not exists longitude numeric(10,7) check (longitude is null or longitude between -180 and 180),
  add column if not exists arrive_time time,
  add column if not exists instructions text;
alter table public.sorting_route_hubs add constraint sorting_route_hubs_hub_or_place
  check (hub_id is not null or length(trim(coalesce(place, ''))) > 1);

-- ---------------------------------------------------------------------
-- 2. Crew
-- ---------------------------------------------------------------------
create table public.sorting_route_crew (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.sorting_routes(id),
  center_id uuid not null references public.sorting_centers(id),
  zone_id uuid not null references public.zones(id),
  stop_id uuid references public.sorting_route_hubs(id) on delete set null,
  role text not null check (role in ('driver', 'helper', 'manager', 'rider', 'supervisor', 'other')),
  employee_id uuid references public.employees(id),
  name text not null check (length(trim(name)) > 1),
  phone text not null check (length(regexp_replace(phone, '\D', '', 'g')) >= 6),
  note text,
  effective_from date not null default current_date,
  effective_to date, end_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (effective_to is null or effective_to >= effective_from)
);
create index sorting_route_crew_route on public.sorting_route_crew (route_id) where effective_to is null;
create index sorting_route_crew_stop on public.sorting_route_crew (stop_id);
create index sorting_route_crew_center on public.sorting_route_crew (center_id);
create index sorting_route_crew_zone on public.sorting_route_crew (zone_id);
create index sorting_route_crew_emp on public.sorting_route_crew (employee_id);

-- ---------------------------------------------------------------------
-- 3. Hub → sorting reports
-- ---------------------------------------------------------------------
create table public.sorting_hub_reports (
  id uuid primary key default gen_random_uuid(),
  no bigint generated always as identity,
  center_id uuid not null references public.sorting_centers(id),
  zone_id uuid not null references public.zones(id),
  hub_id uuid not null references public.hubs(id),
  route_id uuid references public.sorting_routes(id),
  kind text not null default 'other' check (kind in ('wrong', 'damaged', 'missing', 'late', 'extra', 'other')),
  body text,
  tracking text,
  parcel_count integer check (parcel_count is null or parcel_count >= 0),
  photos text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'seen', 'solved')),
  reply text, replied_by uuid, replied_by_name text, replied_at timestamptz,
  reporter_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (length(trim(coalesce(body, ''))) > 0 or cardinality(photos) > 0),
  check (cardinality(photos) <= 6)
);
create index sorting_hub_reports_center on public.sorting_hub_reports (center_id, created_at desc);
create index sorting_hub_reports_hub on public.sorting_hub_reports (hub_id, created_at desc);
create index sorting_hub_reports_zone on public.sorting_hub_reports (zone_id);
create index sorting_hub_reports_route on public.sorting_hub_reports (route_id);

do $$
declare t text;
begin
  foreach t in array array['sorting_route_crew', 'sorting_hub_reports'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'sorting');
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Permissions (hub-report side of the center)
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description) values
  ('sorting.hub_report.view',  'sorting', 'hub_report', 'view',  'See hub → sorting reports at the sorting center'),
  ('sorting.hub_report.reply', 'sorting', 'hub_report', 'approve', 'Mark hub → sorting reports seen / solved and reply')
on conflict (code) do nothing;

-- Zone roles get it for the zone; hub roles only count at the center's own hub (has_permission with the home hub).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('sorting.hub_report.view', 'sorting.hub_report.reply')
 where r.code in ('admin', 'head_office_manager', 'operations_manager', 'zonal_manager', 'hub_manager', 'delivery_manager', 'pickup_manager')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'sorting.hub_report.view'
 where r.code in ('auditor')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------
-- Is the caller a working staff member of this hub (by their employee record)?
create or replace function private.in_hub(p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                  where e.profile_id = auth.uid() and e.archived_at is null and e.hub_id = p_hub
                    and e.status in ('active', 'applicant'))
$$;

-- The center that serves a hub: the hub's own assignment, else a center with a route stopping there.
create or replace function private.hub_center(p_hub uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select h.sorting_center_id from public.hubs h join public.sorting_centers c on c.id = h.sorting_center_id
      where h.id = p_hub and c.archived_at is null),
    (select c.id from public.sorting_centers c where c.home_hub_id = p_hub and c.archived_at is null limit 1),
    (select r.center_id from public.sorting_route_hubs rh join public.sorting_routes r on r.id = rh.route_id
       join public.sorting_centers c on c.id = r.center_id
      where rh.hub_id = p_hub and r.archived_at is null and c.archived_at is null
      order by r.created_at limit 1))
$$;

-- May the caller open the hub panel for this hub?
create or replace function private.hub_panel_ok(p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.in_hub(p_hub)
      or private.has_permission('sorting.parcel.view', null, p_hub)
      or private.has_permission('sorting.parcel.create', null, p_hub)
      or private.has_permission('ops.route.view', null, p_hub)
$$;

-- Center side: an active sorting staff member of the center, or the permission for the
-- center's area (zone/global grant) or at the center's own hub.
create or replace function private.sorting_side(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sorting_centers c
     where c.id = p_center and (
           private.has_permission(p_perm, c.zone_id, null)
        or (c.home_hub_id is not null and private.has_permission(p_perm, null, c.home_hub_id))
        or (c.home_hub_id is not null and private.in_hub(c.home_hub_id))
        or exists (select 1 from public.sorting_staff s where s.center_id = c.id and s.effective_to is null
                     and s.employee_id = private.my_employee_id())))
$$;

-- One route as JSON: stops (with hub name and GPS) and the people on it.
create or replace function private.sorting_route_json(p_route uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'center_id', r.center_id, 'zone_id', r.zone_id, 'code', r.code, 'name', r.name, 'kind', r.kind,
    'vehicle_id', r.vehicle_id, 'vehicle', (select concat_ws(' ', v.name, '(' || v.reg_no || ')') from public.vehicles v where v.id = r.vehicle_id),
    'driver_id', r.driver_id, 'depart_time', r.depart_time, 'return_time', r.return_time, 'note', r.note,
    'instructions', r.instructions, 'status', r.status,
    'stops', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'hub_id', s.hub_id, 'hub_name', h.name, 'place', s.place,
        'label', coalesce(h.name, s.place),
        'latitude', coalesce(s.latitude, h.latitude), 'longitude', coalesce(s.longitude, h.longitude),
        'arrive_time', s.arrive_time, 'instructions', s.instructions, 'can_charge', s.can_charge,
        'other_zone', h.zone_id is not null and h.zone_id <> r.zone_id) order by s.seq)
      from public.sorting_route_hubs s left join public.hubs h on h.id = s.hub_id where s.route_id = r.id), '[]'::jsonb),
    'crew', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'role', k.role, 'name', k.name, 'phone', k.phone, 'note', k.note, 'stop_id', k.stop_id,
        'employee_id', k.employee_id, 'employee_code', e.employee_code, 'since', k.effective_from)
        order by array_position(array['manager','supervisor','driver','helper','rider','other'], k.role), k.name)
      from public.sorting_route_crew k left join public.employees e on e.id = k.employee_id
      where k.route_id = r.id and k.effective_to is null), '[]'::jsonb))
  from public.sorting_routes r where r.id = p_route
$$;

revoke all on function private.in_hub(uuid), private.hub_center(uuid), private.hub_panel_ok(uuid),
  private.sorting_side(uuid, text), private.sorting_route_json(uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 6. Save a route with its stops in one call
--    p_route: {code, name, kind, vehicle_id, depart_time, return_time, note, instructions}
--    p_stops: [{id?, hub_id?, place?, latitude?, longitude?, arrive_time?, instructions?, can_charge?}] in order
-- ---------------------------------------------------------------------
create or replace function public.sorting_route_save(p_center uuid, p_route jsonb, p_stops jsonb, p_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.sorting_centers; v_id uuid := p_id; v_name text := trim(coalesce(p_route->>'name', ''));
  v_code text := nullif(trim(coalesce(p_route->>'code', '')), ''); s jsonb; i integer := 0; v_keep uuid[] := '{}';
  v_hub uuid; v_place text; v_stop uuid; v_seen uuid[] := '{}';
begin
  select * into c from public.sorting_centers where id = p_center and archived_at is null;
  if c.id is null then raise exception 'শটিং সেন্টার পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.center.edit', c.zone_id, null) then raise exception 'রুট বদলানোর অনুমতি নেই' using errcode = '42501'; end if;
  if length(v_name) < 2 then raise exception 'রুটের নাম দিন' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_stops, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_stops, '[]'::jsonb)) = 0 then
    raise exception 'অন্তত একটা হাব বা লোকেশন দিন' using errcode = '22023';
  end if;
  v_code := coalesce(v_code, upper(left(regexp_replace(v_name, '[^A-Za-z0-9]+', '', 'g'), 8)), '');
  if v_code = '' then v_code := 'R' || to_char(clock_timestamp(), 'MMDDHH24MISS'); end if;

  if v_id is null then
    insert into public.sorting_routes (center_id, zone_id, code, name, kind, vehicle_id, depart_time, return_time, note, instructions)
    values (p_center, c.zone_id, v_code, v_name, coalesce(nullif(p_route->>'kind', ''), 'hub'),
      nullif(p_route->>'vehicle_id', '')::uuid, nullif(p_route->>'depart_time', '')::time, nullif(p_route->>'return_time', '')::time,
      nullif(trim(coalesce(p_route->>'note', '')), ''), nullif(trim(coalesce(p_route->>'instructions', '')), ''))
    returning id into v_id;
  else
    if not exists (select 1 from public.sorting_routes where id = v_id and center_id = p_center and archived_at is null) then
      raise exception 'রুট পাওয়া যায়নি' using errcode = 'P0002';
    end if;
    update public.sorting_routes set code = v_code, name = v_name, kind = coalesce(nullif(p_route->>'kind', ''), kind),
      vehicle_id = nullif(p_route->>'vehicle_id', '')::uuid, depart_time = nullif(p_route->>'depart_time', '')::time,
      return_time = nullif(p_route->>'return_time', '')::time, note = nullif(trim(coalesce(p_route->>'note', '')), ''),
      instructions = nullif(trim(coalesce(p_route->>'instructions', '')), '')
     where id = v_id;
  end if;

  -- Stops kept by id; the rest go (their crew becomes route-wide).
  select coalesce(array_agg((x->>'id')::uuid), '{}') into v_keep
    from jsonb_array_elements(p_stops) x where nullif(x->>'id', '') is not null;
  delete from public.sorting_route_hubs where route_id = v_id and not (id = any(v_keep));
  -- Free the seq/hub slots before writing them again in the new order.
  update public.sorting_route_hubs set seq = seq + 10000 where route_id = v_id;

  for s in select * from jsonb_array_elements(p_stops) loop
    i := i + 1;
    v_hub := nullif(s->>'hub_id', '')::uuid;
    v_place := nullif(trim(coalesce(s->>'place', '')), '');
    if v_hub is null and coalesce(length(v_place), 0) < 2 then raise exception 'লোকেশন %-এর নাম দিন', i using errcode = '22023'; end if;
    if v_hub is not null then
      if not exists (select 1 from public.hubs where id = v_hub and archived_at is null) then
        raise exception 'হাবটি চালু নেই' using errcode = '22023';
      end if;
      if v_hub = any(v_seen) then raise exception 'একই হাব একটা রুটে দুবার দেওয়া যায় না' using errcode = '22023'; end if;
      v_seen := v_seen || v_hub;
    end if;
    v_stop := nullif(s->>'id', '')::uuid;
    if v_stop is not null and exists (select 1 from public.sorting_route_hubs where id = v_stop and route_id = v_id) then
      update public.sorting_route_hubs set hub_id = v_hub, place = case when v_hub is null then v_place else v_place end, seq = i,
        latitude = nullif(s->>'latitude', '')::numeric, longitude = nullif(s->>'longitude', '')::numeric,
        arrive_time = nullif(s->>'arrive_time', '')::time, instructions = nullif(trim(coalesce(s->>'instructions', '')), ''),
        can_charge = v_hub is not null and coalesce((s->>'can_charge')::boolean, false)
       where id = v_stop;
    else
      insert into public.sorting_route_hubs (route_id, hub_id, zone_id, seq, can_charge, place, latitude, longitude, arrive_time, instructions)
      values (v_id, v_hub, c.zone_id, i, v_hub is not null and coalesce((s->>'can_charge')::boolean, false), v_place,
        nullif(s->>'latitude', '')::numeric, nullif(s->>'longitude', '')::numeric, nullif(s->>'arrive_time', '')::time,
        nullif(trim(coalesce(s->>'instructions', '')), ''));
    end if;
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. Crew: assign by employee ID or by typed name + phone; end with a reason
-- ---------------------------------------------------------------------
create or replace function public.sorting_crew_save(
  p_route uuid, p_role text, p_name text default null, p_phone text default null, p_employee_code text default null,
  p_stop uuid default null, p_note text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.sorting_routes; e public.employees; v_id uuid; v_name text; v_phone text; v_code text;
begin
  select * into r from public.sorting_routes where id = p_route and archived_at is null;
  if r.id is null then raise exception 'রুট পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.center.edit', r.zone_id, null) then raise exception 'লোক এসাইনের অনুমতি নেই' using errcode = '42501'; end if;
  if p_role not in ('driver', 'helper', 'manager', 'rider', 'supervisor', 'other') then raise exception 'কাজ বেছে নিন' using errcode = '22023'; end if;
  if p_stop is not null and not exists (select 1 from public.sorting_route_hubs where id = p_stop and route_id = p_route) then
    raise exception 'লোকেশনটি এই রুটের নয়' using errcode = '22023';
  end if;
  v_code := nullif(regexp_replace(trim(coalesce(p_employee_code, '')), '^[A-Za-z]+-', ''), '');
  if v_code is not null then
    select * into e from public.employees where employee_code = v_code::extensions.citext and archived_at is null;
    if e.id is null then raise exception 'এই আইডির কাউকে পাওয়া যায়নি' using errcode = '22023'; end if;
  end if;
  v_name := coalesce(nullif(trim(coalesce(p_name, '')), ''), e.full_name);
  v_phone := coalesce(nullif(trim(coalesce(p_phone, '')), ''), e.mobile);
  if coalesce(length(v_name), 0) < 2 then raise exception 'নাম দিন' using errcode = '22023'; end if;
  if coalesce(length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')), 0) < 6 then raise exception 'মোবাইল নাম্বার দিন' using errcode = '22023'; end if;

  if p_id is null then
    if e.id is not null and exists (select 1 from public.sorting_route_crew where route_id = p_route and employee_id = e.id and role = p_role
         and stop_id is not distinct from p_stop and effective_to is null) then
      raise exception 'এই মানুষটি এই কাজে আগে থেকেই আছেন' using errcode = '23505';
    end if;
    insert into public.sorting_route_crew (route_id, center_id, zone_id, stop_id, role, employee_id, name, phone, note)
    values (p_route, r.center_id, r.zone_id, p_stop, p_role, e.id, v_name, v_phone, nullif(trim(coalesce(p_note, '')), ''))
    returning id into v_id;
  else
    update public.sorting_route_crew set role = p_role, stop_id = p_stop, employee_id = coalesce(e.id, employee_id), name = v_name, phone = v_phone,
      note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_id and route_id = p_route and effective_to is null returning id into v_id;
    if v_id is null then raise exception 'এসাইন পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  -- The route's main driver (used to prefill trips / handovers) follows the first route-wide driver with an ID.
  update public.sorting_routes set driver_id = (select k.employee_id from public.sorting_route_crew k where k.route_id = p_route and k.role = 'driver'
      and k.stop_id is null and k.effective_to is null and k.employee_id is not null order by k.effective_from, k.created_at limit 1)
   where id = p_route and driver_id is distinct from (select k.employee_id from public.sorting_route_crew k where k.route_id = p_route and k.role = 'driver'
      and k.stop_id is null and k.effective_to is null and k.employee_id is not null order by k.effective_from, k.created_at limit 1);
  if e.profile_id is not null then
    perform private.notify(e.profile_id, 'আপনাকে শটিং রুটে এসাইন করা হলো', r.name, '/app/hub-sorting', 'sorting');
  end if;
  return v_id;
end $$;

create or replace function public.sorting_crew_end(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.sorting_route_crew;
begin
  select * into k from public.sorting_route_crew where id = p_id and effective_to is null;
  if k.id is null then raise exception 'এসাইন পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.center.edit', k.zone_id, null) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  update public.sorting_route_crew set effective_to = greatest(current_date, effective_from), end_reason = nullif(trim(coalesce(p_reason, '')), '') where id = p_id;
  if k.role = 'driver' then
    update public.sorting_routes set driver_id = (select x.employee_id from public.sorting_route_crew x where x.route_id = k.route_id and x.role = 'driver'
        and x.stop_id is null and x.effective_to is null and x.employee_id is not null order by x.effective_from, x.created_at limit 1)
     where id = k.route_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Reads: the center's routes in full; the hub panel
-- ---------------------------------------------------------------------
create or replace function public.sorting_routes_full(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.sorting_centers;
begin
  select * into c from public.sorting_centers where id = p_center and archived_at is null;
  if c.id is null then raise exception 'শটিং সেন্টার পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not (private.has_permission_within_zone('sorting.center.view', c.zone_id) or private.has_permission_within_zone('sorting.parcel.view', c.zone_id)
          or private.sorting_side(p_center, 'sorting.center.view')) then
    raise exception 'অনুমতি নেই' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'center', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address, 'home_hub_id', c.home_hub_id,
      'latitude', (select h.latitude from public.hubs h where h.id = c.home_hub_id), 'longitude', (select h.longitude from public.hubs h where h.id = c.home_hub_id)),
    'routes', coalesce((select jsonb_agg(private.sorting_route_json(r.id) order by r.kind, r.code)
      from public.sorting_routes r where r.center_id = p_center and r.archived_at is null), '[]'::jsonb));
end $$;

-- Hubs the caller may open in the hub ↔ sorting panel: their own hub first, then hubs they manage that a center serves.
create or replace function public.sorting_panel_hubs()
returns table (hub_id uuid, hub_name text, center_id uuid, center_name text, mine boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, h.name, c.id, c.name, private.in_hub(h.id)
    from public.hubs h
    left join public.sorting_centers c on c.id = private.hub_center(h.id)
   where h.archived_at is null and auth.uid() is not null
     and (private.in_hub(h.id) or ((private.has_permission('sorting.parcel.view', null, h.id) or private.has_permission('sorting.parcel.create', null, h.id)
           or private.has_permission('ops.route.view', null, h.id)) and c.id is not null))
   order by private.in_hub(h.id) desc, h.name
   limit 300
$$;

create or replace function public.sorting_hub_panel(p_hub uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hub uuid := p_hub; h public.hubs; c public.sorting_centers; v_center uuid; v_own uuid;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_hub is null then select e.hub_id into v_hub from public.employees e where e.profile_id = auth.uid() and e.archived_at is null; end if;
  if v_hub is null then raise exception 'আপনার হাব পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.hub_panel_ok(v_hub) then raise exception 'এই হাবের প্যানেল দেখার অনুমতি নেই' using errcode = '42501'; end if;
  select * into h from public.hubs where id = v_hub;
  v_center := private.hub_center(v_hub);
  -- The center the hub belongs to (assigned, or its own hub): all its routes are shown as information.
  -- A hub that is only a stop on another center's route sees just the routes that stop there.
  v_own := coalesce(h.sorting_center_id, (select x.id from public.sorting_centers x where x.home_hub_id = v_hub and x.archived_at is null limit 1));
  select * into c from public.sorting_centers where id = v_center;
  return jsonb_build_object(
    'hub', jsonb_build_object('id', h.id, 'name', h.name, 'latitude', h.latitude, 'longitude', h.longitude),
    'center', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address,
      'latitude', (select x.latitude from public.hubs x where x.id = c.home_hub_id), 'longitude', (select x.longitude from public.hubs x where x.id = c.home_hub_id)) end,
    -- Routes that stop at this hub first ("mine"), then the center's other routes as general information.
    'routes', coalesce((select jsonb_agg(private.sorting_route_json(r.id) || jsonb_build_object('mine', exists (
        select 1 from public.sorting_route_hubs s where s.route_id = r.id and s.hub_id = v_hub))
        order by (exists (select 1 from public.sorting_route_hubs s where s.route_id = r.id and s.hub_id = v_hub)) desc, r.kind, r.code)
      from public.sorting_routes r
      where r.archived_at is null and r.status = 'active'
        and (r.center_id = v_own or exists (select 1 from public.sorting_route_hubs s where s.route_id = r.id and s.hub_id = v_hub))), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select t.id, t.no, t.kind, t.body, t.tracking, t.parcel_count, t.photos, t.status, t.reply, t.replied_by_name, t.replied_at,
               t.reporter_name, t.created_at, t.route_id, (select r.name from public.sorting_routes r where r.id = t.route_id) route_name,
               t.created_by = auth.uid() mine
          from public.sorting_hub_reports t where t.hub_id = v_hub order by t.created_at desc limit 60) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 9. Hub → sorting reports
-- ---------------------------------------------------------------------
create or replace function public.sorting_hub_report_submit(
  p_hub uuid, p_kind text, p_body text default null, p_photos text[] default '{}', p_tracking text default null,
  p_parcels integer default null, p_route uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_center uuid; c public.sorting_centers; v_id uuid; v_no bigint; v_name text; v_hub text; u uuid; p text;
begin
  if p_hub is null or not (private.in_hub(p_hub) or private.has_permission('sorting.parcel.create', null, p_hub)
                            or private.has_permission('sorting.parcel.view', null, p_hub)) then
    raise exception 'এই হাব থেকে রিপোর্ট দেওয়ার অনুমতি নেই' using errcode = '42501';
  end if;
  -- A report about a route goes to that route's center; otherwise to the hub's own center.
  v_center := coalesce((select r.center_id from public.sorting_routes r where r.id = p_route), private.hub_center(p_hub));
  if v_center is null then raise exception 'এই হাব এখনো কোনো শটিং সেন্টারে এসাইন নেই' using errcode = '22023'; end if;
  select * into c from public.sorting_centers where id = v_center;
  p_photos := coalesce(p_photos, '{}');
  foreach p in array p_photos loop
    if p not like 'hubreport/' || auth.uid()::text || '/%' then raise exception 'ছবিটি আপনার আপলোড করা নয়' using errcode = '22023'; end if;
  end loop;
  if length(trim(coalesce(p_body, ''))) = 0 and cardinality(p_photos) = 0 then raise exception 'লিখুন বা ছবি দিন' using errcode = '22023'; end if;
  if p_route is not null and not exists (select 1 from public.sorting_routes r where r.id = p_route and r.archived_at is null
       and (r.center_id = private.hub_center(p_hub) or exists (select 1 from public.sorting_route_hubs s where s.route_id = r.id and s.hub_id = p_hub))) then
    raise exception 'রুটটি এই হাবের নয়' using errcode = '22023';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  select name into v_hub from public.hubs where id = p_hub;
  insert into public.sorting_hub_reports (center_id, zone_id, hub_id, route_id, kind, body, tracking, parcel_count, photos, reporter_name)
  values (v_center, c.zone_id, p_hub, p_route, coalesce(nullif(p_kind, ''), 'other'), nullif(trim(coalesce(p_body, '')), ''),
          nullif(trim(coalesce(p_tracking, '')), ''), p_parcels, p_photos, v_name)
  returning id, no into v_id, v_no;

  -- Tell the center: people with the reply right for its area or its own hub, and its active supervisors.
  for u in
    select distinct ur.user_id
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
      join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
      left join public.role_permissions rp on rp.role_id = r.id
      left join public.permissions pm on pm.id = rp.permission_id
     where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
       and (pm.code = 'sorting.hub_report.reply' or r.is_super)
       and ((ur.scope_type = 'zone' and ur.zone_id = c.zone_id) or (ur.scope_type = 'hub' and ur.hub_id = c.home_hub_id)
            or (ur.scope_type = 'global' and not r.is_super))
    union
    select e.profile_id from public.sorting_staff s join public.employees e on e.id = s.employee_id
     where s.center_id = v_center and s.effective_to is null and s.role in ('supervisor', 'data_entry') and e.profile_id is not null
  loop
    if u is distinct from auth.uid() then
      perform private.notify(u, 'হাব টু শটিং রিপোর্ট: ' || coalesce(v_hub, ''), left(coalesce(nullif(trim(coalesce(p_body, '')), ''), 'ছবি পাঠানো হয়েছে'), 140),
        '/app/sorting/hubreports?id=' || v_id, 'sorting');
    end if;
  end loop;
  return v_id;
end $$;

create or replace function public.sorting_hub_reports(p_center uuid, p_from date, p_to date, p_status text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.sorting_centers where id = p_center) then raise exception 'শটিং সেন্টার পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.sorting_side(p_center, 'sorting.hub_report.view') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select t.id, t.no, t.hub_id, h.name hub_name, t.route_id, r.name route_name, t.kind, t.body, t.tracking, t.parcel_count, t.photos,
           t.status, t.reply, t.replied_by_name, t.replied_at, t.reporter_name, t.created_at
      from public.sorting_hub_reports t join public.hubs h on h.id = t.hub_id left join public.sorting_routes r on r.id = t.route_id
     where t.center_id = p_center
       and ((t.created_at at time zone 'Asia/Dhaka')::date between p_from and p_to or (t.status = 'open' and p_status is null))
       and (p_status is null or t.status = p_status)
     order by t.created_at desc limit 500) x), '[]'::jsonb);
end $$;

create or replace function public.sorting_hub_report_reply(p_id uuid, p_status text, p_reply text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.sorting_hub_reports; v_name text; u uuid;
begin
  select * into t from public.sorting_hub_reports where id = p_id for update;
  if t.id is null then raise exception 'রিপোর্ট পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.sorting_side(t.center_id, 'sorting.hub_report.reply') then raise exception 'উত্তর দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_status not in ('open', 'seen', 'solved') then raise exception 'অবস্থা বেছে নিন' using errcode = '22023'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.sorting_hub_reports set status = p_status, reply = coalesce(nullif(trim(coalesce(p_reply, '')), ''), reply),
    replied_by = auth.uid(), replied_by_name = v_name, replied_at = now() where id = p_id;
  -- The reporter and the hub's working staff with a login hear back.
  for u in
    select t.created_by where t.created_by is not null
    union
    select e.profile_id from public.employees e where e.hub_id = t.hub_id and e.archived_at is null and e.status = 'active' and e.profile_id is not null
       and p_status = 'solved'
  loop
    if u is distinct from auth.uid() then
      perform private.notify(u, case p_status when 'solved' then 'শটিং রিপোর্টের সমাধান করেছে' when 'seen' then 'শটিং রিপোর্ট দেখেছে' else 'শটিং রিপোর্ট আবার খোলা হলো' end,
        coalesce(nullif(trim(coalesce(p_reply, '')), ''), '#' || t.no), '/app/hub-sorting', 'sorting');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. Report photos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sorting-reports', 'sorting-reports', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.can_see_report_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sorting_hub_reports t where p_name = any(t.photos)
                  and (private.hub_panel_ok(t.hub_id) or private.sorting_side(t.center_id, 'sorting.hub_report.view')))
$$;
revoke all on function private.can_see_report_photo(text) from public, anon;

create policy sorting_reports_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'sorting-reports' and name like 'hubreport/' || (select auth.uid())::text || '/%');
create policy sorting_reports_read on storage.objects for select to authenticated
  using (bucket_id = 'sorting-reports' and (name like 'hubreport/' || (select auth.uid())::text || '/%' or private.can_see_report_photo(name)));

-- ---------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------
revoke all on function public.sorting_route_save(uuid, jsonb, jsonb, uuid), public.sorting_crew_save(uuid, text, text, text, text, uuid, text, uuid),
  public.sorting_crew_end(uuid, text), public.sorting_routes_full(uuid), public.sorting_panel_hubs(), public.sorting_hub_panel(uuid),
  public.sorting_hub_report_submit(uuid, text, text, text[], text, integer, uuid), public.sorting_hub_reports(uuid, date, date, text),
  public.sorting_hub_report_reply(uuid, text, text) from public, anon;
grant execute on function public.sorting_route_save(uuid, jsonb, jsonb, uuid), public.sorting_crew_save(uuid, text, text, text, text, uuid, text, uuid),
  public.sorting_crew_end(uuid, text), public.sorting_routes_full(uuid), public.sorting_panel_hubs(), public.sorting_hub_panel(uuid),
  public.sorting_hub_report_submit(uuid, text, text, text[], text, integer, uuid), public.sorting_hub_reports(uuid, date, date, text),
  public.sorting_hub_report_reply(uuid, text, text) to authenticated;

-- Dashboard: open hub reports.
create or replace function public.sorting_hub_reports_open(p_center uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when private.sorting_side(p_center, 'sorting.hub_report.view')
    then (select count(*)::int from public.sorting_hub_reports where center_id = p_center and status = 'open') else 0 end
$$;
revoke all on function public.sorting_hub_reports_open(uuid) from public, anon;
grant execute on function public.sorting_hub_reports_open(uuid) to authenticated;
