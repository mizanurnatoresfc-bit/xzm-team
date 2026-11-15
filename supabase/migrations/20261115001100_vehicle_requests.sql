-- =====================================================================
-- XZM-TEAM ERP — Migration 0036: driver requests (parts / service / problem)
--
--  The crew of a vehicle asks for parts or a service, or reports a problem (an auto
--  that will not charge, a flat tyre …) by filling a FORMAT the owner designs in
--  Vehicle settings (vehicle.request_formats: one field list per kind). Managers of
--  the vehicle's hub (and served hubs) are notified, accept / finish / reject; the
--  crew is told. A manager may also write one on the crew's behalf.
-- =====================================================================

create sequence if not exists public.vehicle_request_seq;
create table public.vehicle_requests (
  id          uuid primary key default gen_random_uuid(),
  no          text not null unique,
  vehicle_id  uuid not null references public.vehicles(id),
  hub_id      uuid references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  kind        text not null check (kind in ('parts', 'service', 'problem', 'other')),
  title       text not null check (length(trim(title)) > 0),
  data        jsonb not null default '{}'::jsonb,
  photo_path  text,
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  status      text not null default 'open' check (status in ('open', 'accepted', 'done', 'rejected', 'cancelled')),
  by_employee uuid references public.employees(id),
  decided_by  uuid, decided_at timestamptz, decision_note text, done_at timestamptz,
  cost        numeric(12,2) check (cost is null or cost >= 0),
  log_id      uuid,                      -- the vehicle_logs line created when it was done with a cost
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid
);
create index vehicle_requests_vehicle_idx on public.vehicle_requests (vehicle_id, created_at desc);
create index vehicle_requests_open_idx on public.vehicle_requests (hub_id) where status in ('open', 'accepted');
create trigger vehicle_requests_stamp before insert or update on public.vehicle_requests for each row execute function private.stamp_row();
create trigger vehicle_requests_audit after insert or update or delete on public.vehicle_requests for each row execute function private.audit_row('ops');
create trigger vehicle_requests_no_delete before delete on public.vehicle_requests for each row execute function private.prevent_delete();
alter table public.vehicle_requests enable row level security;
revoke all on public.vehicle_requests from anon;
grant select on public.vehicle_requests to authenticated;
create policy vehicle_requests_read on public.vehicle_requests for select to authenticated
  using (private.vehicle_can_view(vehicle_id) or created_by = auth.uid() or by_employee = private.my_employee_id());

insert into public.system_settings (key, value, description) values
  ('vehicle.request_formats', '{
    "parts":   [{"key":"part","label":"কী পার্টস লাগবে","type":"text","required":true},{"key":"why","label":"কেন লাগবে / কী সমস্যা","type":"textarea"},{"key":"est","label":"আনুমানিক খরচ (৳)","type":"number"}],
    "service": [{"key":"what","label":"কী সার্ভিসিং","type":"select","required":true,"options":["ইঞ্জিন অয়েল","ফুল সার্ভিসিং","ব্রেক","চেইন / গিয়ার","ইলেকট্রিক","অন্য"]},{"key":"km","label":"এখন মিটারে কত কিমি","type":"number"},{"key":"note","label":"বিস্তারিত","type":"textarea"}],
    "problem": [{"key":"problem","label":"কী সমস্যা","type":"select","required":true,"options":["চার্জ হচ্ছে না","ব্যাটারি দ্রুত শেষ","চাকা / টায়ার","ব্রেক","শব্দ / কাঁপছে","স্টার্ট হচ্ছে না","অন্য"]},{"key":"since","label":"কখন থেকে","type":"text"},{"key":"detail","label":"বিস্তারিত","type":"textarea"},{"key":"can_run","label":"গাড়ি চলছে?","type":"select","options":["চলছে","ধীরে চলছে","বন্ধ"]}]
  }', 'Vehicles: the fields of a driver request, per kind (parts / service / problem)')
on conflict (key) do nothing;

create or replace function public.vehicle_configure(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('vehicle.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if p_key not in ('doc_alert_days', 'service_interval_km', 'fuel_price', 'requisition_format', 'day_format', 'request_formats') then raise exception 'Unknown setting.' using errcode = '22023'; end if;
  if p_key in ('requisition_format', 'day_format') and jsonb_typeof(p_value) <> 'array' then raise exception 'The format must be a list of fields.' using errcode = '22023'; end if;
  if p_key = 'request_formats' and jsonb_typeof(p_value) <> 'object' then raise exception 'Request formats must be an object of lists.' using errcode = '22023'; end if;
  insert into public.system_settings (key, value, description) values ('vehicle.' || p_key, p_value, 'Vehicles setting')
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- Crew (or a manager) writes a request
create or replace function public.vehicle_request_submit(p_vehicle uuid, p_kind text, p_title text, p_data jsonb default '{}'::jsonb,
                                                         p_priority text default 'normal', p_photo text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_id uuid; v_no text; v_manager boolean; v_kind_bn text;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if p_kind not in ('parts', 'service', 'problem', 'other') then raise exception 'Unknown kind of request.' using errcode = '22023'; end if;
  if coalesce(p_priority, 'normal') not in ('low', 'normal', 'urgent') then raise exception 'Unknown priority.' using errcode = '22023'; end if;
  v_manager := private.has_permission('vehicle.log.create', v.zone_id, v.hub_id) or private.vehicle_served_perm(v.id, 'vehicle.log.create');
  if not (v_manager or private.vehicle_is_crew(v.id)) then raise exception 'Not authorised to ask for this vehicle.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Write what you need.' using errcode = '22023'; end if;
  v_no := 'VQ-' || lpad(nextval('public.vehicle_request_seq')::text, 5, '0');
  insert into public.vehicle_requests (no, vehicle_id, hub_id, zone_id, kind, title, data, photo_path, priority, by_employee)
  values (v_no, v.id, v.hub_id, v.zone_id, p_kind, trim(p_title), coalesce(p_data, '{}'::jsonb), nullif(trim(p_photo), ''), coalesce(p_priority, 'normal'), private.my_employee_id())
  returning id into v_id;
  v_kind_bn := case p_kind when 'parts' then 'পার্টস লাগবে' when 'service' then 'সার্ভিসিং লাগবে' when 'problem' then 'গাড়ির সমস্যা' else 'অনুরোধ' end;
  perform private.vehicle_notify_managers(v.id, 'vehicle.log.approve',
    case when coalesce(p_priority, 'normal') = 'urgent' then '🔴 ' else '' end || v_kind_bn || ': ' || v.name || coalesce(' (' || v.reg_no || ')', ''),
    v_no || ' · ' || trim(p_title) || ' · ' || private.my_display_name(), '/app/vehicles/requests?q=' || v_id::text);
  return v_id;
end $$;

-- accepted · done (with the cost, which becomes a vehicle_logs line) · rejected · cancelled
create or replace function public.vehicle_request_update(p_id uuid, p_status text, p_note text default null, p_cost numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.vehicle_requests; v public.vehicles; e public.employees; v_decider boolean; v_log uuid; v_title text;
begin
  select * into q from public.vehicle_requests where id = p_id for update;
  if q.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if p_status not in ('accepted', 'done', 'rejected', 'cancelled') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if q.status in ('done', 'rejected', 'cancelled') then raise exception 'This request is closed.' using errcode = '22023'; end if;
  select * into v from public.vehicles where id = q.vehicle_id;
  v_decider := private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id) or private.has_permission('vehicle.requisition.approve', v.zone_id, v.hub_id)
            or private.vehicle_served_perm(v.id, 'vehicle.log.approve');
  if p_status = 'cancelled' then
    if not (q.created_by = auth.uid() or v_decider) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  else
    if not v_decider then raise exception 'Not authorised to decide vehicle requests.' using errcode = '42501'; end if;
    if p_status = 'rejected' and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  end if;
  if p_status = 'done' and coalesce(p_cost, 0) > 0 then
    insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, amount, driver_id, note, status)
    values (v.id, v.hub_id, v.zone_id, case q.kind when 'parts' then 'parts' when 'service' then 'service' else 'repair' end, private.da_today(), p_cost,
            private.vehicle_holder(v.id), q.no || ' · ' || q.title || coalesce(' · ' || nullif(trim(p_note), ''), ''), 'approved')
    returning id into v_log;
    if q.kind = 'service' then
      update public.vehicles set last_service_on = private.da_today(), last_service_km = greatest(coalesce(last_service_km, 0), odometer) where id = v.id;
    end if;
  end if;
  update public.vehicle_requests
     set status = p_status, cost = coalesce(p_cost, cost), log_id = coalesce(v_log, log_id),
         decided_by = case when p_status in ('accepted', 'rejected') then auth.uid() else decided_by end,
         decided_at = case when p_status in ('accepted', 'rejected') then now() else decided_at end,
         decision_note = coalesce(nullif(trim(p_note), ''), decision_note),
         done_at = case when p_status = 'done' then now() else done_at end
   where id = p_id;
  select * into e from public.employees where id = q.by_employee;
  v_title := q.no || ' ' || case p_status when 'accepted' then 'গ্রহণ হয়েছে — কাজ হবে' when 'done' then 'কাজ শেষ' when 'rejected' then 'না বলা হয়েছে' else 'বাতিল' end;
  perform private.notify(e.profile_id, v_title, q.title || coalesce(' · ' || nullif(trim(p_note), ''), ''), '/app/vehicles/mine', 'vehicle');
  if q.created_by is distinct from e.profile_id then perform private.notify(q.created_by, v_title, q.title, '/app/vehicles/requests?q=' || p_id::text, 'vehicle'); end if;
end $$;

create or replace function public.vehicle_request_list(p_hub uuid default null, p_vehicle uuid default null, p_open_only boolean default false)
returns table (id uuid, no text, vehicle_id uuid, vehicle text, hub_name text, kind text, title text, data jsonb, photo_path text, priority text, status text,
               by_name text, by_code text, decision_note text, cost numeric, created_at timestamptz, done_at timestamptz, can_decide boolean, is_mine boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select q.id, q.no, q.vehicle_id, v.name || coalesce(' (' || v.reg_no || ')', ''), h.name, q.kind, q.title, q.data, q.photo_path, q.priority, q.status,
         e.full_name, e.employee_code::text, q.decision_note, q.cost, q.created_at, q.done_at,
         private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id) or private.has_permission('vehicle.requisition.approve', v.zone_id, v.hub_id) or private.vehicle_served_perm(v.id, 'vehicle.log.approve'),
         q.created_by = auth.uid() or q.by_employee = private.my_employee_id()
  from public.vehicle_requests q join public.vehicles v on v.id = q.vehicle_id left join public.hubs h on h.id = v.hub_id left join public.employees e on e.id = q.by_employee
  where (private.vehicle_can_view(q.vehicle_id) or q.created_by = auth.uid() or q.by_employee = private.my_employee_id())
    and (p_vehicle is null or q.vehicle_id = p_vehicle)
    and (p_hub is null or v.hub_id = p_hub or exists (select 1 from public.vehicle_hubs vh where vh.vehicle_id = v.id and vh.hub_id = p_hub))
    and (not p_open_only or q.status in ('open', 'accepted'))
  order by case q.status when 'open' then 0 when 'accepted' then 1 else 2 end, case q.priority when 'urgent' then 0 when 'normal' then 1 else 2 end, q.created_at desc;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.vehicle_configure(text, jsonb)', 'public.vehicle_request_submit(uuid, text, text, jsonb, text, text)',
                           'public.vehicle_request_update(uuid, text, text, numeric)', 'public.vehicle_request_list(uuid, uuid, boolean)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
