-- =====================================================================
-- XZM-TEAM ERP — Migration 0023: vehicles, the reference person, and presets
--
--  * vehicles + vehicle_assignments: a vehicle belongs to a hub and is held by
--    one person at a time. An expense can name the vehicle it was for, and that
--    expense then shows on the holder's own page — what it was for and how much.
--  * da_expenses carries the reference person (name, mobile, position) beside
--    the reference number, set with da_set_expense_reference.
--  * Settings keep the lists people pick from, so the sheet fills in one click:
--    da.reference_people, and the vehicles of the hub.
-- =====================================================================

create table public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  code        extensions.citext not null unique,
  name        text not null check (length(trim(name)) > 0),
  kind        text not null default 'bike' check (kind in ('bike','cng','van','truck','pickup','other')),
  reg_no      text,
  zone_id     uuid not null references public.zones(id),
  hub_id      uuid references public.hubs(id),
  status      text not null default 'active' check (status in ('active','inactive')),
  remarks     text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid
);
create index vehicles_hub_idx on public.vehicles (hub_id) where archived_at is null;

create table public.vehicle_assignments (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references public.vehicles(id),
  employee_id    uuid not null references public.employees(id),
  hub_id         uuid references public.hubs(id),
  zone_id        uuid not null references public.zones(id),
  effective_from date not null default current_date,
  effective_to   date,
  reason         text not null check (length(trim(reason)) > 0),
  end_reason     text,
  created_at     timestamptz not null default now(), created_by uuid,
  updated_at     timestamptz not null default now(), updated_by uuid,
  constraint vehicle_assign_dates_chk check (effective_to is null or effective_to >= effective_from)
);
create unique index vehicle_assign_one_holder on public.vehicle_assignments (vehicle_id) where effective_to is null;
create index vehicle_assign_employee_idx on public.vehicle_assignments (employee_id) where effective_to is null;

alter table public.da_expenses add column if not exists vehicle_id uuid references public.vehicles(id);
alter table public.da_expenses add column if not exists reference_name text;
alter table public.da_expenses add column if not exists reference_phone text;
alter table public.da_expenses add column if not exists reference_position text;

create trigger vehicles_stamp before insert or update on public.vehicles
  for each row execute function private.stamp_row();
create trigger vehicles_audit after insert or update or delete on public.vehicles
  for each row execute function private.audit_row('ops');
create trigger vehicles_no_delete before delete on public.vehicles
  for each row execute function private.prevent_delete();
create trigger vehicle_assign_stamp before insert or update on public.vehicle_assignments
  for each row execute function private.stamp_row();
create trigger vehicle_assign_audit after insert or update or delete on public.vehicle_assignments
  for each row execute function private.audit_row('ops');
create trigger vehicle_assign_no_delete before delete on public.vehicle_assignments
  for each row execute function private.prevent_delete();

alter table public.vehicles enable row level security;
alter table public.vehicle_assignments enable row level security;
revoke all on public.vehicles, public.vehicle_assignments from anon;
grant select on public.vehicles, public.vehicle_assignments to authenticated;

-- Anyone who may see the hub's accounts may see its vehicles; the holder sees their own.
create policy vehicles_read on public.vehicles for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id)
      or private.has_permission('ops.report.view', zone_id, hub_id)
      or exists (select 1 from public.vehicle_assignments a
                  where a.vehicle_id = vehicles.id and a.effective_to is null
                    and a.employee_id = private.my_employee_id()));
create policy vehicle_assign_read on public.vehicle_assignments for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id)
      or private.has_permission('ops.report.view', zone_id, hub_id)
      or employee_id = private.my_employee_id());

-- Who holds a vehicle now
create or replace function private.vehicle_holder(p_vehicle uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.employee_id from public.vehicle_assignments a
   where a.vehicle_id = p_vehicle and a.effective_to is null
   order by a.effective_from desc limit 1
$$;

-- ---------------------------------------------------------------------
-- Keeping the list of vehicles (Accounts settings)
-- ---------------------------------------------------------------------
create or replace function public.vehicle_list(p_hub uuid default null)
returns table (id uuid, code text, name text, kind text, reg_no text, hub_id uuid, hub_name text,
               status text, holder_id uuid, holder_code text, holder_name text, since date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  return query
  select v.id, v.code::text, v.name, v.kind, v.reg_no, v.hub_id, h.name, v.status,
         e.id, e.employee_code::text, e.full_name, a.effective_from
  from public.vehicles v
  left join public.hubs h on h.id = v.hub_id
  left join public.vehicle_assignments a on a.vehicle_id = v.id and a.effective_to is null
  left join public.employees e on e.id = a.employee_id
  where v.archived_at is null and (p_hub is null or v.hub_id = p_hub)
  order by v.status, v.name;
end $$;

create or replace function public.vehicle_save(
  p_name text, p_code text, p_kind text, p_hub uuid, p_reg_no text default null,
  p_status text default 'active', p_remarks text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub); v_id uuid;
begin
  if v_zone is null then raise exception 'Choose the hub the vehicle belongs to.' using errcode = '22023'; end if;
  if not private.has_permission('da.settings.configure', v_zone, p_hub) then
    raise exception 'Not authorised to keep the list of vehicles.' using errcode = '42501';
  end if;
  if p_kind not in ('bike','cng','van','truck','pickup','other') then
    raise exception 'Unknown kind of vehicle.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.vehicles (code, name, kind, reg_no, zone_id, hub_id, status, remarks)
    values (trim(p_code)::extensions.citext, trim(p_name), p_kind, nullif(trim(p_reg_no), ''), v_zone, p_hub,
            coalesce(p_status, 'active'), nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.vehicles set code = trim(p_code)::extensions.citext, name = trim(p_name), kind = p_kind,
           reg_no = nullif(trim(p_reg_no), ''), zone_id = v_zone, hub_id = p_hub,
           status = coalesce(p_status, status), remarks = nullif(trim(p_remarks), '')
     where id = p_id and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Hand a vehicle to someone; the person who held it before gives it up on the same day.
create or replace function public.vehicle_assign(p_vehicle uuid, p_employee_code text, p_reason text,
                                                 p_from date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; e public.employees; v_from date := coalesce(p_from, current_date); v_id uuid;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.settings.configure', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to hand over a vehicle.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  select * into e from public.employees
   where employee_code = trim(p_employee_code)::extensions.citext and archived_at is null and status = 'active';
  if e.id is null then raise exception 'No active employee with ID %.', p_employee_code using errcode = '22023'; end if;

  update public.vehicle_assignments set effective_to = v_from, end_reason = 'Handed to ' || e.full_name
   where vehicle_id = p_vehicle and effective_to is null;
  insert into public.vehicle_assignments (vehicle_id, employee_id, hub_id, zone_id, effective_from, reason)
  values (p_vehicle, e.id, v.hub_id, v.zone_id, v_from, trim(p_reason))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.vehicle_release(p_vehicle uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.settings.configure', v.zone_id, v.hub_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.vehicle_assignments set effective_to = current_date, end_reason = trim(p_reason)
   where vehicle_id = p_vehicle and effective_to is null;
end $$;

-- ---------------------------------------------------------------------
-- The reference person on an expense line
-- ---------------------------------------------------------------------
create or replace function public.da_set_expense_reference(
  p_line uuid, p_name text default null, p_phone text default null, p_position text default null,
  p_vehicle uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.da_expenses%rowtype; v public.vehicles;
begin
  select * into x from public.da_expenses where id = p_line and removed_at is null for update;
  if x.id is null then raise exception 'Expense line not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(x.session_id);
  if p_vehicle is not null then
    select * into v from public.vehicles where id = p_vehicle and archived_at is null;
    if v.id is null or (v.hub_id is not null and v.hub_id <> x.hub_id) then
      raise exception 'Choose a vehicle of this hub.' using errcode = '22023';
    end if;
  end if;
  if p_phone is not null and nullif(trim(p_phone), '') is not null and trim(p_phone) !~ '^01[3-9][0-9]{8}$' then
    raise exception 'The mobile number must look like 01XXXXXXXXX.' using errcode = '22023';
  end if;
  update public.da_expenses
     set reference_name = nullif(trim(p_name), ''), reference_phone = nullif(trim(p_phone), ''),
         reference_position = nullif(trim(p_position), ''), vehicle_id = p_vehicle
   where id = p_line;
end $$;

-- ---------------------------------------------------------------------
-- A person's own page: the expenses of the vehicle they hold
-- ---------------------------------------------------------------------
-- Runs as the system on purpose: the holder of a vehicle may see what was spent on
-- that vehicle even when they cannot see the hub's whole sheet. It never looks past
-- the vehicles the caller holds right now.
create or replace function public.da_my_vehicles()
returns table (vehicle_id uuid, code text, name text, kind text, reg_no text, since date,
               spent_30d numeric, lines jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.my_employee_id();
begin
  if auth.uid() is null or v_me is null then return; end if;
  return query
  select v.id, v.code::text, v.name, v.kind, v.reg_no, a.effective_from,
         coalesce((select sum(x.amount) from public.da_expenses x
                    where x.vehicle_id = v.id and x.removed_at is null and x.bill_date >= current_date - 30), 0),
         coalesce((select jsonb_agg(jsonb_build_object('date', x.bill_date, 'name', x.expense_name,
                            'category', x.category, 'amount', x.amount, 'bill_no', x.bill_no,
                            'voucher_no', x.voucher_no, 'remarks', x.remarks) order by x.bill_date desc)
                     from public.da_expenses x
                    where x.vehicle_id = v.id and x.removed_at is null and x.bill_date >= current_date - 90), '[]'::jsonb)
  from public.vehicle_assignments a
  join public.vehicles v on v.id = a.vehicle_id
  where a.employee_id = v_me and a.effective_to is null and v.archived_at is null
  order by v.name;
end $$;

-- ---------------------------------------------------------------------
-- Lists people pick from, so a line fills in one click
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('da.reference_people', '[]',
   'Daily accounts: the people an expense is often referred to — name, mobile and position')
on conflict (key) do nothing;

do $$
declare f text;
begin
  foreach f in array array['public.vehicle_list(uuid)', 'public.vehicle_save(text, text, text, uuid, text, text, text, uuid)',
                           'public.vehicle_assign(uuid, text, text, date)', 'public.vehicle_release(uuid, text)',
                           'public.da_set_expense_reference(uuid, text, text, text, uuid)', 'public.da_my_vehicles()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.vehicle_holder(uuid) from public, anon;
grant execute on function private.vehicle_holder(uuid) to authenticated;
