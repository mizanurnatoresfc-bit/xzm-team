-- =====================================================================
-- XZM-TEAM ERP — Migration 0034: Vehicle Management (গাড়ি ম্যানেজমেন্ট)
--
--  A–Z of every vehicle the business runs:
--  * vehicles gains identity fields (model, engine/chassis, owner, odometer, photo note).
--  * vehicle_assign: hand a vehicle to a staff member by Employee ID — the vehicle's
--    hub (and zone) follow the person's CURRENT hub automatically (no hub typing).
--  * vehicle_documents: registration, fitness, tax token, insurance, route permit …
--    with expiry; alerts 30 days ahead (vehicle.doc_alert_days setting).
--  * vehicle_logs: fuel (litres + odometer), service, repair, parts, toll, fine, wash …
--    Each line can point at the daily-sheet expense that paid for it (da_expenses).
--  * vehicle.* permissions with role defaults; holders always see their own vehicle.
--  * vehicle_overview / vehicle_alerts / vehicle_report — what the pages show.
--  Nothing is hard-deleted: rows are archived with a reason; audit log keeps history.
-- =====================================================================

-- ---------------------------------------------------------------- permissions
insert into public.permissions (code, module, resource, action, description) values
  ('vehicle.vehicle.view',     'vehicle', 'vehicle',  'view',    'See vehicles, who holds them, documents and running costs'),
  ('vehicle.vehicle.create',   'vehicle', 'vehicle',  'create',  'Add vehicles'),
  ('vehicle.vehicle.edit',     'vehicle', 'vehicle',  'edit',    'Change vehicle details'),
  ('vehicle.vehicle.archive',  'vehicle', 'vehicle',  'archive', 'Remove vehicles from the list'),
  ('vehicle.holder.edit',      'vehicle', 'holder',   'edit',    'Hand a vehicle to a staff member / take it back (hub follows the person)'),
  ('vehicle.log.view',         'vehicle', 'log',      'view',    'See fuel, service and repair logs'),
  ('vehicle.log.create',       'vehicle', 'log',      'create',  'Write fuel, service, repair and other vehicle costs'),
  ('vehicle.log.edit',         'vehicle', 'log',      'edit',    'Correct or remove a vehicle log line'),
  ('vehicle.document.edit',    'vehicle', 'document', 'edit',    'Keep vehicle papers (registration, fitness, tax token, insurance …)'),
  ('vehicle.settings.configure','vehicle','settings', 'configure','Vehicle settings: alert days, service interval, cost kinds')
on conflict (code) do nothing;

-- Role defaults. Super Admin has everything already (is_super).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager', 'operations_manager') and p.code like 'vehicle.%')
  or (r.code = 'zonal_manager' and p.code in ('vehicle.vehicle.view', 'vehicle.vehicle.create', 'vehicle.vehicle.edit', 'vehicle.vehicle.archive',
        'vehicle.holder.edit', 'vehicle.log.view', 'vehicle.log.create', 'vehicle.log.edit', 'vehicle.document.edit'))
  or (r.code = 'hub_manager' and p.code in ('vehicle.vehicle.view', 'vehicle.vehicle.create', 'vehicle.vehicle.edit',
        'vehicle.holder.edit', 'vehicle.log.view', 'vehicle.log.create', 'vehicle.document.edit'))
  or (r.code in ('pickup_manager', 'delivery_manager') and p.code in ('vehicle.vehicle.view', 'vehicle.log.view', 'vehicle.log.create'))
  or (r.code in ('accounts_manager', 'accountant') and p.code in ('vehicle.vehicle.view', 'vehicle.log.view', 'vehicle.log.create', 'vehicle.log.edit'))
  or (r.code = 'auditor' and p.code in ('vehicle.vehicle.view', 'vehicle.log.view'))
) on conflict do nothing;

-- ---------------------------------------------------------------- vehicles: more identity
alter table public.vehicles
  add column if not exists model        text,
  add column if not exists model_year   integer check (model_year is null or model_year between 1980 and 2100),
  add column if not exists color        text,
  add column if not exists engine_no    text,
  add column if not exists chassis_no   text,
  add column if not exists owner_type   text not null default 'own' check (owner_type in ('own', 'rented', 'staff_owned')),
  add column if not exists owner_name   text,
  add column if not exists owner_phone  text,
  add column if not exists monthly_rent numeric(12,2) check (monthly_rent is null or monthly_rent >= 0),
  add column if not exists purchase_date date,
  add column if not exists purchase_price numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  add column if not exists odometer     integer not null default 0 check (odometer >= 0),
  add column if not exists fuel_type    text check (fuel_type is null or fuel_type in ('petrol', 'octane', 'diesel', 'cng', 'lpg', 'electric')),
  add column if not exists service_interval_km integer check (service_interval_km is null or service_interval_km > 0),
  add column if not exists last_service_km integer check (last_service_km is null or last_service_km >= 0),
  add column if not exists last_service_on date;

-- "status" grows: a vehicle can be in the workshop or off the road.
alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check check (status in ('active', 'inactive', 'workshop', 'off_road'));

-- Who holds the vehicle: the hub where the vehicle is kept follows them.
alter table public.vehicle_assignments add column if not exists moved_hub boolean not null default false;

-- ---------------------------------------------------------------- documents
create table public.vehicle_documents (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id),
  kind        text not null check (kind in ('registration', 'fitness', 'tax_token', 'insurance', 'route_permit', 'ownership', 'other')),
  title       text,
  doc_no      text,
  issued_on   date,
  expires_on  date,
  amount      numeric(12,2) check (amount is null or amount >= 0),
  file_path   text,            -- object in the private "vehicle-docs" bucket (optional)
  note        text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  constraint vehicle_doc_dates_chk check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index vehicle_documents_vehicle_idx on public.vehicle_documents (vehicle_id) where archived_at is null;
create index vehicle_documents_expiry_idx on public.vehicle_documents (expires_on) where archived_at is null and expires_on is not null;

-- ---------------------------------------------------------------- logs (fuel / service / repair …)
create table public.vehicle_logs (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references public.vehicles(id),
  hub_id        uuid references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  kind          text not null check (kind in ('fuel', 'service', 'repair', 'parts', 'tyre', 'oil', 'wash', 'toll', 'parking', 'fine', 'rent', 'paper', 'other')),
  log_date      date not null default current_date,
  odometer      integer check (odometer is null or odometer >= 0),
  litres        numeric(8,2) check (litres is null or litres > 0),
  amount        numeric(12,2) not null default 0 check (amount >= 0),
  vendor        text,
  bill_no       text,
  driver_id     uuid references public.employees(id),   -- who was holding / driving
  da_expense_id uuid references public.da_expenses(id), -- the sheet line that paid for it, if any
  note          text,
  removed_at    timestamptz, removed_by uuid, remove_reason text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create index vehicle_logs_vehicle_idx on public.vehicle_logs (vehicle_id, log_date desc) where removed_at is null;
create index vehicle_logs_hub_idx on public.vehicle_logs (hub_id, log_date desc) where removed_at is null;

-- stamps, audit, no hard delete
create trigger vehicle_documents_stamp before insert or update on public.vehicle_documents for each row execute function private.stamp_row();
create trigger vehicle_documents_audit after insert or update or delete on public.vehicle_documents for each row execute function private.audit_row('ops');
create trigger vehicle_documents_no_delete before delete on public.vehicle_documents for each row execute function private.prevent_delete();
create trigger vehicle_logs_stamp before insert or update on public.vehicle_logs for each row execute function private.stamp_row();
create trigger vehicle_logs_audit after insert or update or delete on public.vehicle_logs for each row execute function private.audit_row('ops');
create trigger vehicle_logs_no_delete before delete on public.vehicle_logs for each row execute function private.prevent_delete();

alter table public.vehicle_documents enable row level security;
alter table public.vehicle_logs enable row level security;
revoke all on public.vehicle_documents, public.vehicle_logs from anon;
grant select on public.vehicle_documents, public.vehicle_logs to authenticated;

-- ---------------------------------------------------------------- who may see a vehicle
-- vehicle.vehicle.view at the vehicle's hub/zone, the older accounts/ops rights, or being its holder.
create or replace function private.vehicle_can_view(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle
      and (private.has_permission('vehicle.vehicle.view', v.zone_id, v.hub_id)
        or private.has_permission('da.sheet.view', v.zone_id, v.hub_id)
        or private.has_permission('ops.report.view', v.zone_id, v.hub_id)
        or private.vehicle_holder(v.id) = private.my_employee_id()))
$$;
revoke all on function private.vehicle_can_view(uuid) from public, anon;
grant execute on function private.vehicle_can_view(uuid) to authenticated;

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated
  using (private.has_permission('vehicle.vehicle.view', zone_id, hub_id)
      or private.has_permission('da.sheet.view', zone_id, hub_id)
      or private.has_permission('ops.report.view', zone_id, hub_id)
      or exists (select 1 from public.vehicle_assignments a
                  where a.vehicle_id = vehicles.id and a.effective_to is null
                    and a.employee_id = private.my_employee_id()));
drop policy if exists vehicle_assign_read on public.vehicle_assignments;
create policy vehicle_assign_read on public.vehicle_assignments for select to authenticated
  using (private.has_permission('vehicle.vehicle.view', zone_id, hub_id)
      or private.has_permission('da.sheet.view', zone_id, hub_id)
      or private.has_permission('ops.report.view', zone_id, hub_id)
      or employee_id = private.my_employee_id());
create policy vehicle_documents_read on public.vehicle_documents for select to authenticated
  using (private.vehicle_can_view(vehicle_id));
create policy vehicle_logs_read on public.vehicle_logs for select to authenticated
  using (private.has_permission('vehicle.log.view', zone_id, hub_id)
      or private.has_permission('da.sheet.view', zone_id, hub_id)
      or driver_id = private.my_employee_id()
      or private.vehicle_holder(vehicle_id) = private.my_employee_id());

-- ---------------------------------------------------------------- settings
insert into public.system_settings (key, value, description) values
  ('vehicle.doc_alert_days', '30', 'Vehicles: warn this many days before a paper expires'),
  ('vehicle.service_interval_km', '3000', 'Vehicles: default km between services when a vehicle has none set'),
  ('vehicle.fuel_price', '{"petrol":122,"octane":125,"diesel":105,"cng":43,"lpg":66}', 'Vehicles: usual price per litre / m³ (shown as a hint only)')
on conflict (key) do nothing;

create or replace function public.vehicle_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(replace(key, 'vehicle.', ''), value) from public.system_settings where key like 'vehicle.%'
$$;

create or replace function public.vehicle_configure(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('vehicle.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if p_key not in ('doc_alert_days', 'service_interval_km', 'fuel_price') then raise exception 'Unknown setting.' using errcode = '22023'; end if;
  insert into public.system_settings (key, value, description) values ('vehicle.' || p_key, p_value, 'Vehicles setting')
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------------------------------------------------------------- the current hub of a staff member
create or replace function private.employee_current_hub(p_employee uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.hub_id from public.employee_assignments a
   where a.employee_id = p_employee and a.effective_to is null
   order by a.effective_from desc limit 1
$$;
revoke all on function private.employee_current_hub(uuid) from public, anon;
grant execute on function private.employee_current_hub(uuid) to authenticated;

-- Hubs the caller may see vehicles of
create or replace function public.vehicle_hubs()
returns table (hub_id uuid, code text, name text, zone_id uuid, zone_name text, can_edit boolean, can_log boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, h.code::text, h.name, z.id, z.name,
         private.has_permission('vehicle.vehicle.edit', z.id, h.id) or private.has_permission('vehicle.vehicle.create', z.id, h.id),
         private.has_permission('vehicle.log.create', z.id, h.id)
  from public.hubs h join public.zones z on z.id = h.zone_id
  where h.archived_at is null and h.status = 'active'
    and (private.has_permission('vehicle.vehicle.view', z.id, h.id) or private.has_permission('da.sheet.view', z.id, h.id))
  order by z.name, h.name
$$;

-- ---------------------------------------------------------------- save a vehicle (replaces the settings-card version)
drop function if exists public.vehicle_save(text, text, text, uuid, text, text, text, uuid);
create or replace function public.vehicle_save(
  p_name text, p_code text, p_kind text, p_hub uuid, p_reg_no text default null,
  p_status text default 'active', p_remarks text default null, p_id uuid default null,
  p_more jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub); v_id uuid; m jsonb := coalesce(p_more, '{}'::jsonb);
begin
  if v_zone is null then raise exception 'Choose the hub the vehicle belongs to.' using errcode = '22023'; end if;
  if p_id is null then
    if not (private.has_permission('vehicle.vehicle.create', v_zone, p_hub) or private.has_permission('da.settings.configure', v_zone, p_hub)) then
      raise exception 'Not authorised to add vehicles.' using errcode = '42501';
    end if;
  else
    if not (private.has_permission('vehicle.vehicle.edit', v_zone, p_hub) or private.has_permission('da.settings.configure', v_zone, p_hub)) then
      raise exception 'Not authorised to change vehicles.' using errcode = '42501';
    end if;
  end if;
  if p_kind not in ('bike','cng','van','truck','pickup','other') then raise exception 'Unknown kind of vehicle.' using errcode = '22023'; end if;
  if coalesce(p_status, 'active') not in ('active', 'inactive', 'workshop', 'off_road') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if m ? 'owner_phone' and nullif(trim(m->>'owner_phone'), '') is not null and trim(m->>'owner_phone') !~ '^01[3-9][0-9]{8}$' then
    raise exception 'The mobile number must look like 01XXXXXXXXX.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.vehicles (code, name, kind, reg_no, zone_id, hub_id, status, remarks,
                                 model, model_year, color, engine_no, chassis_no, owner_type, owner_name, owner_phone, monthly_rent,
                                 purchase_date, purchase_price, odometer, fuel_type, service_interval_km, last_service_km, last_service_on)
    values (trim(p_code)::extensions.citext, trim(p_name), p_kind, nullif(trim(p_reg_no), ''), v_zone, p_hub,
            coalesce(p_status, 'active'), nullif(trim(p_remarks), ''),
            nullif(trim(m->>'model'), ''), nullif(m->>'model_year', '')::integer, nullif(trim(m->>'color'), ''),
            nullif(trim(m->>'engine_no'), ''), nullif(trim(m->>'chassis_no'), ''), coalesce(nullif(m->>'owner_type', ''), 'own'),
            nullif(trim(m->>'owner_name'), ''), nullif(trim(m->>'owner_phone'), ''), nullif(m->>'monthly_rent', '')::numeric,
            nullif(m->>'purchase_date', '')::date, nullif(m->>'purchase_price', '')::numeric, coalesce(nullif(m->>'odometer', '')::integer, 0),
            nullif(m->>'fuel_type', ''), nullif(m->>'service_interval_km', '')::integer, nullif(m->>'last_service_km', '')::integer,
            nullif(m->>'last_service_on', '')::date)
    returning id into v_id;
  else
    update public.vehicles set code = trim(p_code)::extensions.citext, name = trim(p_name), kind = p_kind,
           reg_no = nullif(trim(p_reg_no), ''), zone_id = v_zone, hub_id = p_hub,
           status = coalesce(p_status, status), remarks = nullif(trim(p_remarks), ''),
           model = case when m ? 'model' then nullif(trim(m->>'model'), '') else model end,
           model_year = case when m ? 'model_year' then nullif(m->>'model_year', '')::integer else model_year end,
           color = case when m ? 'color' then nullif(trim(m->>'color'), '') else color end,
           engine_no = case when m ? 'engine_no' then nullif(trim(m->>'engine_no'), '') else engine_no end,
           chassis_no = case when m ? 'chassis_no' then nullif(trim(m->>'chassis_no'), '') else chassis_no end,
           owner_type = case when m ? 'owner_type' then coalesce(nullif(m->>'owner_type', ''), 'own') else owner_type end,
           owner_name = case when m ? 'owner_name' then nullif(trim(m->>'owner_name'), '') else owner_name end,
           owner_phone = case when m ? 'owner_phone' then nullif(trim(m->>'owner_phone'), '') else owner_phone end,
           monthly_rent = case when m ? 'monthly_rent' then nullif(m->>'monthly_rent', '')::numeric else monthly_rent end,
           purchase_date = case when m ? 'purchase_date' then nullif(m->>'purchase_date', '')::date else purchase_date end,
           purchase_price = case when m ? 'purchase_price' then nullif(m->>'purchase_price', '')::numeric else purchase_price end,
           odometer = case when m ? 'odometer' then coalesce(nullif(m->>'odometer', '')::integer, odometer) else odometer end,
           fuel_type = case when m ? 'fuel_type' then nullif(m->>'fuel_type', '') else fuel_type end,
           service_interval_km = case when m ? 'service_interval_km' then nullif(m->>'service_interval_km', '')::integer else service_interval_km end,
           last_service_km = case when m ? 'last_service_km' then nullif(m->>'last_service_km', '')::integer else last_service_km end,
           last_service_on = case when m ? 'last_service_on' then nullif(m->>'last_service_on', '')::date else last_service_on end
     where id = p_id and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.vehicle_archive(p_vehicle uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('vehicle.vehicle.archive', v.zone_id, v.hub_id) then raise exception 'Not authorised to remove vehicles.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.vehicle_assignments set effective_to = current_date, end_reason = 'Vehicle removed: ' || trim(p_reason)
   where vehicle_id = p_vehicle and effective_to is null;
  update public.vehicles set archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason), status = 'inactive' where id = p_vehicle;
end $$;

-- ---------------------------------------------------------------- hand over: hub follows the person
-- Type the Employee ID only. The vehicle moves to that person's current hub (and zone)
-- unless p_keep_hub is true. The previous holder gives it up the same day.
drop function if exists public.vehicle_assign(uuid, text, text, date);
create or replace function public.vehicle_assign(p_vehicle uuid, p_employee_code text, p_reason text,
                                                 p_from date default null, p_keep_hub boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; e public.employees; v_from date := coalesce(p_from, current_date); v_id uuid;
        v_emp_hub uuid; v_new_hub uuid; v_new_zone uuid; v_moved boolean := false;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('vehicle.holder.edit', v.zone_id, v.hub_id) or private.has_permission('da.settings.configure', v.zone_id, v.hub_id)) then
    raise exception 'Not authorised to hand over a vehicle.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  select * into e from public.employees
   where employee_code = regexp_replace(trim(p_employee_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null and status = 'active';
  if e.id is null then raise exception 'No active employee with ID %.', p_employee_code using errcode = '22023'; end if;

  v_emp_hub := private.employee_current_hub(e.id);
  v_new_hub := v.hub_id; v_new_zone := v.zone_id;
  if not coalesce(p_keep_hub, false) and v_emp_hub is not null and v_emp_hub is distinct from v.hub_id then
    v_new_hub := v_emp_hub; v_new_zone := coalesce(private.hub_zone(v_emp_hub), v.zone_id);
    -- Moving the vehicle to another hub needs the right at the destination too.
    if not (private.has_permission('vehicle.holder.edit', v_new_zone, v_new_hub) or private.has_permission('da.settings.configure', v_new_zone, v_new_hub)) then
      raise exception 'The person works at another hub you may not move vehicles to.' using errcode = '42501';
    end if;
    update public.vehicles set hub_id = v_new_hub, zone_id = v_new_zone where id = p_vehicle;
    v_moved := true;
  end if;

  update public.vehicle_assignments set effective_to = v_from, end_reason = 'Handed to ' || e.full_name
   where vehicle_id = p_vehicle and effective_to is null;
  insert into public.vehicle_assignments (vehicle_id, employee_id, hub_id, zone_id, effective_from, reason, moved_hub)
  values (p_vehicle, e.id, v_new_hub, v_new_zone, v_from, trim(p_reason), v_moved)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.vehicle_release(p_vehicle uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('vehicle.holder.edit', v.zone_id, v.hub_id) or private.has_permission('da.settings.configure', v.zone_id, v.hub_id)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.vehicle_assignments set effective_to = current_date, end_reason = trim(p_reason)
   where vehicle_id = p_vehicle and effective_to is null;
end $$;

-- ---------------------------------------------------------------- documents
create or replace function public.vehicle_document_save(
  p_vehicle uuid, p_kind text, p_doc_no text default null, p_issued date default null, p_expires date default null,
  p_amount numeric default null, p_title text default null, p_note text default null, p_file text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_id uuid;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('vehicle.document.edit', v.zone_id, v.hub_id) then raise exception 'Not authorised to keep vehicle papers.' using errcode = '42501'; end if;
  if p_kind not in ('registration', 'fitness', 'tax_token', 'insurance', 'route_permit', 'ownership', 'other') then raise exception 'Unknown paper.' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.vehicle_documents (vehicle_id, kind, title, doc_no, issued_on, expires_on, amount, file_path, note)
    values (p_vehicle, p_kind, nullif(trim(p_title), ''), nullif(trim(p_doc_no), ''), p_issued, p_expires, p_amount, nullif(trim(p_file), ''), nullif(trim(p_note), ''))
    returning id into v_id;
  else
    update public.vehicle_documents set kind = p_kind, title = nullif(trim(p_title), ''), doc_no = nullif(trim(p_doc_no), ''), issued_on = p_issued,
           expires_on = p_expires, amount = p_amount, file_path = coalesce(nullif(trim(p_file), ''), file_path), note = nullif(trim(p_note), '')
     where id = p_id and vehicle_id = p_vehicle and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'Paper not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.vehicle_document_archive(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.vehicle_documents; v public.vehicles;
begin
  select * into d from public.vehicle_documents where id = p_id and archived_at is null;
  if d.id is null then raise exception 'Paper not found.' using errcode = 'P0002'; end if;
  select * into v from public.vehicles where id = d.vehicle_id;
  if not private.has_permission('vehicle.document.edit', v.zone_id, v.hub_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.vehicle_documents set archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason) where id = p_id;
end $$;

-- ---------------------------------------------------------------- logs
-- The holder of a vehicle may write its fuel / costs even without vehicle.log.create
-- (a rider writes their own fuel); anyone else needs the permission at the vehicle's hub.
create or replace function public.vehicle_log_save(
  p_vehicle uuid, p_kind text, p_amount numeric, p_date date default null, p_odometer integer default null,
  p_litres numeric default null, p_vendor text default null, p_bill_no text default null, p_note text default null,
  p_driver_code text default null, p_da_expense uuid default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_id uuid; v_driver uuid; v_me uuid := private.my_employee_id(); x public.vehicle_logs;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if p_id is null then
    if not (private.has_permission('vehicle.log.create', v.zone_id, v.hub_id) or (v_me is not null and private.vehicle_holder(v.id) = v_me)) then
      raise exception 'Not authorised to write vehicle costs.' using errcode = '42501';
    end if;
  else
    select * into x from public.vehicle_logs where id = p_id and removed_at is null;
    if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
    if not (private.has_permission('vehicle.log.edit', v.zone_id, v.hub_id)
            or (x.created_by = auth.uid() and x.created_at > now() - interval '24 hours')) then
      raise exception 'Not authorised to change this line.' using errcode = '42501';
    end if;
  end if;
  if p_kind not in ('fuel', 'service', 'repair', 'parts', 'tyre', 'oil', 'wash', 'toll', 'parking', 'fine', 'rent', 'paper', 'other') then
    raise exception 'Unknown kind of cost.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount cannot be negative.' using errcode = '22023'; end if;
  if p_kind = 'fuel' and coalesce(p_litres, 0) <= 0 and coalesce(p_amount, 0) = 0 then raise exception 'Write the litres or the amount.' using errcode = '22023'; end if;
  if p_odometer is not null and p_odometer < 0 then raise exception 'Odometer cannot be negative.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_driver_code, '')), '') is not null then
    select id into v_driver from public.employees
     where employee_code = regexp_replace(trim(p_driver_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null;
    if v_driver is null then raise exception 'No employee with ID %.', p_driver_code using errcode = '22023'; end if;
  else
    v_driver := private.vehicle_holder(v.id);
  end if;
  if p_da_expense is not null and not exists (select 1 from public.da_expenses d where d.id = p_da_expense and d.removed_at is null) then
    raise exception 'That sheet line does not exist.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, odometer, litres, amount, vendor, bill_no, driver_id, da_expense_id, note)
    values (p_vehicle, v.hub_id, v.zone_id, p_kind, coalesce(p_date, current_date), p_odometer, p_litres, coalesce(p_amount, 0),
            nullif(trim(p_vendor), ''), nullif(trim(p_bill_no), ''), v_driver, p_da_expense, nullif(trim(p_note), ''))
    returning id into v_id;
  else
    update public.vehicle_logs set kind = p_kind, log_date = coalesce(p_date, log_date), odometer = p_odometer, litres = p_litres,
           amount = coalesce(p_amount, 0), vendor = nullif(trim(p_vendor), ''), bill_no = nullif(trim(p_bill_no), ''),
           driver_id = v_driver, da_expense_id = p_da_expense, note = nullif(trim(p_note), '')
     where id = p_id returning id into v_id;
  end if;
  -- The vehicle remembers its latest odometer and service.
  if p_odometer is not null and p_odometer > v.odometer then update public.vehicles set odometer = p_odometer where id = v.id; end if;
  if p_kind in ('service', 'oil') then
    update public.vehicles set last_service_on = greatest(coalesce(last_service_on, '1900-01-01'::date), coalesce(p_date, current_date)),
                               last_service_km = greatest(coalesce(last_service_km, 0), coalesce(p_odometer, last_service_km, 0))
     where id = v.id;
  end if;
  return v_id;
end $$;

create or replace function public.vehicle_log_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.vehicle_logs; v public.vehicles;
begin
  select * into x from public.vehicle_logs where id = p_id and removed_at is null;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  if not (private.has_permission('vehicle.log.edit', v.zone_id, v.hub_id) or (x.created_by = auth.uid() and x.created_at > now() - interval '24 hours')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.vehicle_logs set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
end $$;

-- ---------------------------------------------------------------- what the pages read
-- Every vehicle the caller may see, with holder, hub, papers status and running cost.
create or replace function public.vehicle_overview(p_hub uuid default null)
returns table (id uuid, code text, name text, kind text, reg_no text, model text, fuel_type text, owner_type text, status text,
               hub_id uuid, hub_name text, hub_code text, zone_id uuid, zone_name text,
               holder_id uuid, holder_code text, holder_name text, holder_mobile text, since date,
               odometer integer, last_service_km integer, last_service_on date, service_interval_km integer, km_since_service integer, service_due boolean,
               spent_30d numeric, fuel_30d numeric, litres_30d numeric, spent_month numeric, last_log date,
               docs_total integer, docs_expired integer, docs_expiring integer, next_expiry date, next_expiry_kind text)
language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := coalesce((select (value)::text::integer from public.system_settings where key = 'vehicle.doc_alert_days'), 30);
        v_interval integer := coalesce((select (value)::text::integer from public.system_settings where key = 'vehicle.service_interval_km'), 3000);
begin
  return query
  select v.id, v.code::text, v.name, v.kind, v.reg_no, v.model, v.fuel_type, v.owner_type, v.status,
         v.hub_id, h.name, h.code::text, v.zone_id, z.name,
         e.id, e.employee_code::text, e.full_name, e.mobile, a.effective_from,
         v.odometer, v.last_service_km, v.last_service_on, coalesce(v.service_interval_km, v_interval),
         greatest(v.odometer - coalesce(v.last_service_km, 0), 0),
         (v.odometer - coalesce(v.last_service_km, 0)) >= coalesce(v.service_interval_km, v_interval),
         coalesce(l.spent_30d, 0), coalesce(l.fuel_30d, 0), coalesce(l.litres_30d, 0), coalesce(l.spent_month, 0), l.last_log,
         coalesce(d.total, 0)::integer, coalesce(d.expired, 0)::integer, coalesce(d.expiring, 0)::integer, d.next_expiry, d.next_kind
  from public.vehicles v
  left join public.hubs h on h.id = v.hub_id
  left join public.zones z on z.id = v.zone_id
  left join public.vehicle_assignments a on a.vehicle_id = v.id and a.effective_to is null
  left join public.employees e on e.id = a.employee_id
  left join lateral (
    select sum(x.amount) filter (where x.log_date >= current_date - 30) as spent_30d,
           sum(x.amount) filter (where x.kind = 'fuel' and x.log_date >= current_date - 30) as fuel_30d,
           sum(x.litres) filter (where x.kind = 'fuel' and x.log_date >= current_date - 30) as litres_30d,
           sum(x.amount) filter (where x.log_date >= date_trunc('month', current_date)::date) as spent_month,
           max(x.log_date) as last_log
    from public.vehicle_logs x where x.vehicle_id = v.id and x.removed_at is null) l on true
  left join lateral (
    select count(*) as total,
           count(*) filter (where dd.expires_on < current_date) as expired,
           count(*) filter (where dd.expires_on >= current_date and dd.expires_on <= current_date + v_days) as expiring,
           min(dd.expires_on) filter (where dd.expires_on >= current_date) as next_expiry,
           (array_agg(dd.kind order by dd.expires_on) filter (where dd.expires_on >= current_date))[1] as next_kind
    from public.vehicle_documents dd where dd.vehicle_id = v.id and dd.archived_at is null) d on true
  where v.archived_at is null and (p_hub is null or v.hub_id = p_hub)
    and (private.has_permission('vehicle.vehicle.view', v.zone_id, v.hub_id)
      or private.has_permission('da.sheet.view', v.zone_id, v.hub_id)
      or private.has_permission('ops.report.view', v.zone_id, v.hub_id)
      or e.id = private.my_employee_id())
  order by v.status, h.name, v.name;
end $$;

-- What needs attention: papers expiring / expired, service due, vehicles with nobody holding them, workshop.
create or replace function public.vehicle_alerts(p_hub uuid default null)
returns table (vehicle_id uuid, vehicle text, hub_name text, kind text, severity text, due date, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := coalesce((select (value)::text::integer from public.system_settings where key = 'vehicle.doc_alert_days'), 30);
begin
  return query
  with vis as (select * from public.vehicle_overview(p_hub))
  select vis.id, vis.name || coalesce(' (' || vis.reg_no || ')', ''), vis.hub_name, 'doc'::text,
         case when dd.expires_on < current_date then 'bad' else 'warn' end, dd.expires_on,
         dd.kind || coalesce(' ' || dd.doc_no, '')
  from vis join public.vehicle_documents dd on dd.vehicle_id = vis.id and dd.archived_at is null
  where dd.expires_on is not null and dd.expires_on <= current_date + v_days
  union all
  select vis.id, vis.name || coalesce(' (' || vis.reg_no || ')', ''), vis.hub_name, 'service', 'warn', null::date,
         vis.km_since_service::text || ' km'
  from vis where vis.service_due and vis.status = 'active'
  union all
  select vis.id, vis.name || coalesce(' (' || vis.reg_no || ')', ''), vis.hub_name, 'no_holder', 'info', null::date, null::text
  from vis where vis.holder_id is null and vis.status = 'active'
  union all
  select vis.id, vis.name || coalesce(' (' || vis.reg_no || ')', ''), vis.hub_name, 'status', 'info', null::date, vis.status
  from vis where vis.status in ('workshop', 'off_road')
  order by 5, 6 nulls last;
end $$;

-- Cost report: per vehicle per kind for a date range (what the monthly sheet shows).
create or replace function public.vehicle_report(p_from date, p_to date, p_hub uuid default null)
returns table (vehicle_id uuid, vehicle text, reg_no text, hub_name text, kind text, lines integer, amount numeric, litres numeric,
               km_start integer, km_end integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  with vis as (select * from public.vehicle_overview(p_hub))
  select vis.id, vis.name, vis.reg_no, vis.hub_name, x.kind, count(*)::integer, sum(x.amount), sum(x.litres),
         min(x.odometer) filter (where x.odometer > 0), max(x.odometer)
  from vis join public.vehicle_logs x on x.vehicle_id = vis.id and x.removed_at is null
  where x.log_date between p_from and p_to
  group by vis.id, vis.name, vis.reg_no, vis.hub_name, x.kind
  order by vis.hub_name, vis.name, x.kind;
end $$;

-- A vehicle's logs, with the driver's name (the page lists them under the vehicle).
create or replace function public.vehicle_log_list(p_vehicle uuid, p_from date default null, p_to date default null)
returns table (id uuid, kind text, log_date date, odometer integer, litres numeric, amount numeric, vendor text, bill_no text,
               driver_id uuid, driver_name text, driver_code text, da_expense_id uuid, note text, created_by uuid, created_at timestamptz, mine boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.vehicle_can_view(p_vehicle) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  return query
  select x.id, x.kind, x.log_date, x.odometer, x.litres, x.amount, x.vendor, x.bill_no,
         x.driver_id, e.full_name, e.employee_code::text, x.da_expense_id, x.note, x.created_by, x.created_at,
         x.created_by = auth.uid() and x.created_at > now() - interval '24 hours'
  from public.vehicle_logs x left join public.employees e on e.id = x.driver_id
  where x.vehicle_id = p_vehicle and x.removed_at is null
    and (p_from is null or x.log_date >= p_from) and (p_to is null or x.log_date <= p_to)
  order by x.log_date desc, x.created_at desc;
end $$;

-- Assignment history of one vehicle
create or replace function public.vehicle_history(p_vehicle uuid)
returns table (id uuid, employee_id uuid, employee_code text, full_name text, hub_name text, effective_from date, effective_to date, reason text, end_reason text, moved_hub boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.vehicle_can_view(p_vehicle) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  return query
  select a.id, a.employee_id, e.employee_code::text, e.full_name, h.name, a.effective_from, a.effective_to, a.reason, a.end_reason, a.moved_hub
  from public.vehicle_assignments a join public.employees e on e.id = a.employee_id left join public.hubs h on h.id = a.hub_id
  where a.vehicle_id = p_vehicle order by a.effective_from desc, a.created_at desc;
end $$;

-- ---------------------------------------------------------------- private bucket for papers
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-docs', 'vehicle-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
-- Path: <vehicle_id>/<file>. Read if you may see the vehicle; write if you may keep its papers.
create or replace function private.vehicle_object_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' then split_part(p_name, '/', 1)::uuid end
$$;
create or replace function private.vehicle_can_upload_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vehicles v where v.id = private.vehicle_object_id(p_name) and v.archived_at is null
                   and private.has_permission('vehicle.document.edit', v.zone_id, v.hub_id))
$$;
revoke all on function private.vehicle_object_id(text), private.vehicle_can_upload_object(text) from public, anon;
grant execute on function private.vehicle_object_id(text), private.vehicle_can_upload_object(text) to authenticated;
drop policy if exists vehicle_docs_read on storage.objects;
create policy vehicle_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-docs' and private.vehicle_can_view(private.vehicle_object_id(name)));
drop policy if exists vehicle_docs_write on storage.objects;
create policy vehicle_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-docs' and private.vehicle_can_upload_object(name));

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.vehicle_settings()', 'public.vehicle_configure(text, jsonb)', 'public.vehicle_hubs()',
    'public.vehicle_save(text, text, text, uuid, text, text, text, uuid, jsonb)', 'public.vehicle_archive(uuid, text)',
    'public.vehicle_assign(uuid, text, text, date, boolean)', 'public.vehicle_release(uuid, text)',
    'public.vehicle_document_save(uuid, text, text, date, date, numeric, text, text, text, uuid)', 'public.vehicle_document_archive(uuid, text)',
    'public.vehicle_log_save(uuid, text, numeric, date, integer, numeric, text, text, text, text, uuid, uuid)', 'public.vehicle_log_remove(uuid, text)',
    'public.vehicle_overview(uuid)', 'public.vehicle_alerts(uuid)', 'public.vehicle_report(date, date, uuid)',
    'public.vehicle_log_list(uuid, date, date)', 'public.vehicle_history(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
