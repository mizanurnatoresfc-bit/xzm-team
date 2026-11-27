create table public.sorting_dispatches (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.sorting_routes(id),
  work_date date not null,
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid not null references public.employees(id),
  helper_id uuid references public.employees(id),
  dispatched_by uuid not null references public.profiles(id),
  departed_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (route_id, work_date)
);
create unique index sorting_dispatch_active_vehicle on public.sorting_dispatches(vehicle_id) where completed_at is null;

create table public.sorting_dispatch_stops (
  dispatch_id uuid not null references public.sorting_dispatches(id),
  handover_id uuid not null unique references public.sorting_handovers(id),
  position integer not null,
  arrived_at timestamptz,
  departed_at timestamptz,
  primary key (dispatch_id, position)
);

alter table public.sorting_dispatches enable row level security;
alter table public.sorting_dispatch_stops enable row level security;
revoke all on public.sorting_dispatches, public.sorting_dispatch_stops from public, anon, authenticated;

create function private.sorting_dispatch_notify(p_trip uuid, p_position integer, p_initial boolean)
returns void language sql security definer set search_path = '' as $$
  select private.notify(ur.user_id,
    case when s.position = p_position then 'গাড়ি আপনার হাবের পথে' else 'শুটিং সেন্টার থেকে গাড়ি ছেড়েছে' end,
    r.name || ' · ' || h.name || ' · ' || v.name,
    '/app/fleet/mine', 'sorting_dispatch')
  from public.sorting_dispatch_stops s
  join public.sorting_dispatches d on d.id = s.dispatch_id
  join public.sorting_routes r on r.id = d.route_id
  join public.vehicles v on v.id = d.vehicle_id
  join public.sorting_handovers x on x.id = s.handover_id
  join public.hubs h on h.id = x.hub_id
  join public.user_roles ur on (ur.scope_type = 'hub' and ur.hub_id = h.id)
     or (ur.scope_type = 'zone' and ur.zone_id = h.zone_id)
  join public.roles roles on roles.id = ur.role_id and roles.code = 'hub_manager'
    and roles.status = 'active' and roles.archived_at is null
  where s.dispatch_id = p_trip and (p_initial or s.position = p_position)
    and ur.revoked_at is null and ur.valid_from <= current_date
    and (ur.valid_to is null or ur.valid_to >= current_date)
$$;

create function public.sorting_dispatch_start(p_route uuid, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.sorting_routes;
  trip uuid;
  crew_helper uuid;
begin
  select * into r from public.sorting_routes where id = p_route and archived_at is null and status = 'active' for update;
  if r.id is null or not (
    private.has_permission('sorting.parcel.create', r.zone_id, null)
    or exists (select 1 from public.sorting_staff s where s.center_id = r.center_id
      and s.employee_id = private.my_employee_id() and s.role in ('loader', 'sorter', 'supervisor')
      and s.effective_from <= p_date and (s.effective_to is null or s.effective_to >= p_date))
  ) then raise exception 'এই রুট ছাড়ার অনুমতি নেই' using errcode = '42501'; end if;

  select id into trip from public.sorting_dispatches where route_id = p_route and work_date = p_date;
  if trip is not null then return trip; end if;
  if p_date is distinct from private.da_today() then raise exception 'আজকের ট্রিপ বেছে নিন'; end if;
  if r.driver_id is null or not exists (select 1 from public.vehicles v where v.id = r.vehicle_id
    and v.zone_id = r.zone_id and v.status = 'active' and v.archived_at is null) then
    raise exception 'রুটে সক্রিয় গাড়ি ও ড্রাইভার সেট করুন';
  end if;
  select a.employee_id into crew_helper from public.vehicle_assignments a
  where a.vehicle_id = r.vehicle_id and a.role = 'helper' and a.effective_from <= p_date
    and (a.effective_to is null or a.effective_to >= p_date)
  order by a.effective_from desc, a.id limit 1;

  perform pg_advisory_xact_lock(38192, 1);
  if exists (select 1 from public.sorting_dispatches d where d.completed_at is null
    and (d.driver_id = r.driver_id or d.helper_id = r.driver_id
      or (crew_helper is not null and crew_helper in (d.driver_id, d.helper_id)))) then
    raise exception 'এই ড্রাইভার বা হেল্পারের অন্য ট্রিপ চলছে';
  end if;

  perform x.id from public.sorting_handovers x where x.route_id = p_route and x.work_date = p_date for update;
  if not exists (select 1 from public.sorting_route_hubs h where h.route_id = p_route) or exists (
    select 1 from public.sorting_route_hubs h where h.route_id = p_route and (
      select count(*) from public.sorting_handovers x where x.route_id = p_route
        and x.center_id = r.center_id and x.hub_id = h.hub_id and x.work_date = p_date
        and x.direction = 'sorting_to_hub' and x.status = 'sent'
        and (x.vehicle_id is null or x.vehicle_id = r.vehicle_id)
        and (x.driver_id is null or x.driver_id = r.driver_id)
    ) <> 1
  ) then raise exception 'প্রতিটি স্টপের জন্য একটি করে সম্পূর্ণ লোড এন্ট্রি দিন'; end if;

  insert into public.sorting_dispatches (route_id, work_date, vehicle_id, driver_id, helper_id, dispatched_by)
  values (p_route, p_date, r.vehicle_id, r.driver_id, crew_helper, auth.uid()) returning id into trip;
  insert into public.sorting_dispatch_stops (dispatch_id, handover_id, position)
  select trip, x.id, row_number() over (order by h.seq, h.id)::integer
  from public.sorting_route_hubs h join public.sorting_handovers x on x.route_id = h.route_id and x.hub_id = h.hub_id
  where h.route_id = p_route and x.center_id = r.center_id and x.work_date = p_date
    and x.direction = 'sorting_to_hub' and x.status = 'sent'
    and (x.vehicle_id is null or x.vehicle_id = r.vehicle_id)
    and (x.driver_id is null or x.driver_id = r.driver_id);

  perform private.sorting_dispatch_notify(trip, 1, true);
  return trip;
end $$;

create function public.sorting_dispatch_step(p_trip uuid, p_stop integer, p_arrive boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.sorting_dispatches;
  s public.sorting_dispatch_stops;
begin
  select * into d from public.sorting_dispatches where id = p_trip for update;
  if d.id is null or private.my_employee_id() is distinct from d.driver_id
    and private.my_employee_id() is distinct from d.helper_id then
    raise exception 'শুধু এই ট্রিপের ড্রাইভার বা হেল্পার আপডেট দিতে পারবেন' using errcode = '42501';
  end if;
  if private.my_employee_id() is null then raise exception 'Not authorised.' using errcode = '42501'; end if;
  select * into s from public.sorting_dispatch_stops where dispatch_id = p_trip and position = p_stop;
  if s.handover_id is null or p_arrive is null then raise exception 'স্টপ বেছে নিন'; end if;
  if (p_arrive and s.arrived_at is not null) or (not p_arrive and s.departed_at is not null) then return; end if;
  if d.completed_at is not null or exists (select 1 from public.sorting_dispatch_stops
    where dispatch_id = p_trip and position < p_stop and departed_at is null) then
    raise exception 'আগের স্টপ সম্পন্ন করুন';
  end if;
  if p_arrive then
    update public.sorting_dispatch_stops set arrived_at = now() where dispatch_id = p_trip and position = p_stop;
  else
    if s.arrived_at is null or not exists (select 1 from public.sorting_handovers
       where id = s.handover_id and status in ('received', 'disputed')) then
      raise exception 'আগে এই স্টপের রিসিভ জমা দিন';
    end if;
    update public.sorting_dispatch_stops set departed_at = now() where dispatch_id = p_trip and position = p_stop;
    if exists (select 1 from public.sorting_dispatch_stops where dispatch_id = p_trip and position = p_stop + 1) then
      perform private.sorting_dispatch_notify(p_trip, p_stop + 1, false);
    else
      update public.sorting_dispatches set completed_at = now() where id = p_trip;
    end if;
  end if;
end $$;

create function public.sorting_dispatch_board()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'route', r.name, 'vehicle', concat_ws(' · ', v.name, v.reg_no),
    'driver', private.emp_name(d.driver_id), 'helper', private.emp_name(d.helper_id),
    'departed_at', d.departed_at, 'completed_at', d.completed_at,
    'can_step', coalesce(private.my_employee_id() in (d.driver_id, d.helper_id), false),
    'stops', (
      select jsonb_agg(jsonb_build_object('position', s.position, 'hub', h.name,
        'arrived_at', s.arrived_at, 'departed_at', s.departed_at,
        'parcels', case when visibility.allowed then x.parcel_count end,
        'bags', case when visibility.allowed then x.bag_count end,
        'received', case when visibility.allowed then x.status in ('received', 'disputed') end) order by s.position)
      from public.sorting_dispatch_stops s
      join public.sorting_handovers x on x.id = s.handover_id
      join public.hubs h on h.id = x.hub_id
      cross join lateral (select private.my_employee_id() in (d.driver_id, d.helper_id)
        or d.dispatched_by = auth.uid() or (private.has_permission('sorting.parcel.view', x.zone_id, x.hub_id) or private.in_hub_group(x.hub_id)) allowed) visibility
      where s.dispatch_id = d.id
    )
  ) order by d.departed_at desc), '[]'::jsonb)
  from public.sorting_dispatches d join public.sorting_routes r on r.id = d.route_id
  join public.vehicles v on v.id = d.vehicle_id
  where auth.uid() is not null and (d.completed_at is null or d.work_date = private.da_today())
    and (d.dispatched_by = auth.uid() or private.my_employee_id() in (d.driver_id, d.helper_id)
      or exists (select 1 from public.sorting_dispatch_stops s
        join public.sorting_handovers x on x.id = s.handover_id where s.dispatch_id = d.id
        and (private.has_permission('sorting.parcel.view', x.zone_id, x.hub_id) or private.in_hub_group(x.hub_id))))
$$;

revoke all on function private.sorting_dispatch_notify(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.sorting_dispatch_start(uuid, date), public.sorting_dispatch_step(uuid, integer, boolean), public.sorting_dispatch_board() from public, anon;
grant execute on function public.sorting_dispatch_start(uuid, date), public.sorting_dispatch_step(uuid, integer, boolean), public.sorting_dispatch_board() to authenticated;

create function private.sorting_dispatch_guard_handover() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.sorting_dispatch_stops;
begin
  select * into s from public.sorting_dispatch_stops where handover_id = old.id;
  if s.handover_id is null then return new; end if;
  if (new.hub_id, new.zone_id, new.center_id, new.route_id, new.direction, new.work_date,
      new.vehicle_id, new.driver_id, new.parcel_count, new.bag_count)
    is distinct from
     (old.hub_id, old.zone_id, old.center_id, old.route_id, old.direction, old.work_date,
      old.vehicle_id, old.driver_id, old.parcel_count, old.bag_count) then
    raise exception 'গাড়ি ছাড়ার পর লোড বা স্টপ পরিবর্তন করা যাবে না';
  end if;
  if new.status is distinct from old.status and (s.arrived_at is null or old.status <> 'sent') then
    raise exception 'গাড়ি পৌঁছানোর পর একবার রিসিভ নিশ্চিত করুন';
  end if;
  return new;
end $$;
revoke all on function private.sorting_dispatch_guard_handover() from public, anon, authenticated;
create trigger sorting_dispatch_guard_handover before update on public.sorting_handovers
  for each row execute function private.sorting_dispatch_guard_handover();

create table public.sorting_dispatch_reports (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null,
  position integer not null,
  reporter uuid not null references public.profiles(id),
  category text not null check (category in ('late', 'unload', 'absent', 'conduct', 'wrong_hub', 'other')),
  detail text not null check (length(detail) between 1 and 2000),
  assignee uuid references public.employees(id),
  instruction text,
  reply text,
  resolution text,
  created_at timestamptz not null default now(),
  foreign key (dispatch_id, position) references public.sorting_dispatch_stops(dispatch_id, position)
);
alter table public.sorting_dispatch_reports enable row level security;
revoke all on public.sorting_dispatch_reports from public, anon, authenticated;

create function private.sorting_zonal_users(p_zone uuid)
returns table(user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.code = 'zonal_manager' and r.status = 'active' and r.archived_at is null
  where ur.scope_type = 'zone' and ur.zone_id = p_zone and ur.revoked_at is null
    and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
$$;

create function public.sorting_dispatch_report(p_id uuid, p_trip uuid, p_stop integer, p_category text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.sorting_dispatches;
  x public.sorting_handovers;
  recipient uuid;
begin
  select * into d from public.sorting_dispatches where id = p_trip;
  select h.* into x from public.sorting_dispatch_stops s
    join public.sorting_handovers h on h.id = s.handover_id where s.dispatch_id = p_trip and s.position = p_stop;
  if auth.uid() is null or x.id is null or not coalesce(
    d.dispatched_by = auth.uid() or private.my_employee_id() in (d.driver_id, d.helper_id)
    or private.in_hub_group(x.hub_id), false
  ) then raise exception 'রিপোর্ট দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if not exists (select 1 from private.sorting_zonal_users(x.zone_id)) then
    raise exception 'এই জোনে জোনাল ম্যানেজার সেট করা নেই';
  end if;
  insert into public.sorting_dispatch_reports (id, dispatch_id, position, reporter, category, detail)
  values (p_id, p_trip, p_stop, auth.uid(), p_category, trim(p_detail))
  on conflict (id) do nothing;
  if not found then return; end if;
  for recipient in select user_id from private.sorting_zonal_users(x.zone_id) loop
    perform private.notify(recipient, 'শুটিং ট্রিপের নতুন রিপোর্ট', 'জোনাল রিপোর্ট খুলে বিস্তারিত দেখুন', '/app/fleet', 'sorting_dispatch');
  end loop;
end $$;

create function public.sorting_dispatch_report_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'route', r.name, 'hub', h.name, 'category', q.category, 'detail', q.detail,
    'instruction', q.instruction, 'reply', q.reply, 'resolution', q.resolution,
    'assignee', private.emp_name(q.assignee), 'can_manage', auth.uid() in (select user_id from private.sorting_zonal_users(h.zone_id)),
    'can_reply', q.assignee is not null and q.assignee = private.my_employee_id()
  ) order by q.created_at desc), '[]'::jsonb)
  from public.sorting_dispatch_reports q
  join public.sorting_dispatches d on d.id = q.dispatch_id
  join public.sorting_routes r on r.id = d.route_id
  join public.sorting_dispatch_stops s on s.dispatch_id = q.dispatch_id and s.position = q.position
  join public.sorting_handovers x on x.id = s.handover_id
  join public.hubs h on h.id = x.hub_id
  where auth.uid() is not null and (q.reporter = auth.uid() or q.assignee = private.my_employee_id()
    or auth.uid() in (select user_id from private.sorting_zonal_users(h.zone_id)))
$$;

create function public.sorting_dispatch_report_act(p_id uuid, p_action text, p_text text, p_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.sorting_dispatch_reports;
  d public.sorting_dispatches;
  h public.hubs;
  e public.employees;
  note text := nullif(trim(p_text), '');
  zonal boolean;
  recipient uuid;
begin
  select * into q from public.sorting_dispatch_reports where id = p_id for update;
  select * into d from public.sorting_dispatches where id = q.dispatch_id;
  select h1.* into h from public.sorting_dispatch_stops s
    join public.sorting_handovers x on x.id = s.handover_id join public.hubs h1 on h1.id = x.hub_id
    where s.dispatch_id = q.dispatch_id and s.position = q.position;
  zonal := exists (select 1 from private.sorting_zonal_users(h.zone_id) where user_id = auth.uid());
  if auth.uid() is null or q.id is null or not coalesce(
    zonal or (p_action = 'reply' and q.assignee is not null and q.assignee = private.my_employee_id()), false
  ) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if note is null or length(note) > 2000 or q.resolution is not null then raise exception 'খোলা রিপোর্টে ১–২০০০ অক্ষরের জবাব দিন'; end if;

  case p_action
    when 'assign' then
      select * into e from public.employees where employee_code::text = trim(p_code)
        and status = 'active' and archived_at is null and profile_id is not null
        and (hub_id = h.id or id in (d.driver_id, d.helper_id));
      if e.id is null then raise exception 'এই স্টপের কর্মী বা ট্রিপের ড্রাইভার/হেল্পারের আইডি দিন'; end if;
      update public.sorting_dispatch_reports set assignee = e.id, instruction = note, reply = null where id = p_id;
      perform private.notify(e.profile_id, 'শুটিং ট্রিপের নির্দেশনা', note, '/app/fleet/mine', 'sorting_dispatch');
    when 'reply' then
      if q.assignee is null or q.assignee is distinct from private.my_employee_id() then
        raise exception 'নির্দেশনা পাওয়া কর্মী জবাব দেবেন' using errcode = '42501';
      end if;
      update public.sorting_dispatch_reports set reply = note where id = p_id;
      for recipient in select user_id from private.sorting_zonal_users(h.zone_id) loop
        perform private.notify(recipient, 'শুটিং ট্রিপের রিপোর্টে জবাব এসেছে', 'জোনাল রিপোর্টে জবাব দেখুন', '/app/fleet', 'sorting_dispatch');
      end loop;
    when 'resolve' then
      if q.assignee is not null and q.reply is null then raise exception 'নির্দেশনার জবাবের জন্য অপেক্ষা করুন'; end if;
      update public.sorting_dispatch_reports set resolution = note where id = p_id;
      perform private.notify(q.reporter, 'শুটিং ট্রিপের রিপোর্ট সমাধান হয়েছে', 'ট্রিপ প্যানেলে সমাধান দেখুন', '/app/fleet/mine', 'sorting_dispatch');
    else raise exception 'কাজ বেছে নিন';
  end case;
end $$;

revoke all on function private.sorting_zonal_users(uuid) from public, anon, authenticated;
revoke all on function public.sorting_dispatch_report(uuid, uuid, integer, text, text),
  public.sorting_dispatch_report_list(), public.sorting_dispatch_report_act(uuid, text, text, text) from public, anon;
grant execute on function public.sorting_dispatch_report(uuid, uuid, integer, text, text),
  public.sorting_dispatch_report_list(), public.sorting_dispatch_report_act(uuid, text, text, text) to authenticated;
