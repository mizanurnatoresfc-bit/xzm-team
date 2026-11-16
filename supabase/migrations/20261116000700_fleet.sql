-- XZM-TEAM ERP — গাড়ি (fleet), the way the owner asked for it on 16 Nov 2026.
--
--   * A zone's vehicles: name, number, which hub it is given to. The kind decides the crew
--     (a truck / covered van has a driver and a helper; an auto has an auto driver only).
--   * Each crew member has a daily allowance (খোরাকি). A manager posts it for a day: it goes on
--     that hub's daily sheet as an expense, with a voucher.
--   * Auto: the manager records each day whether it was charged at the garage, and the bill.
--   * The crew report each hub: loaded and released on time, late to unload, no trip today.
--     The zonal manager sees these.
--   * The crew ask for service / parts / report a problem in the set format, with photos; they put up
--     fuel with the slip. Every money item counts only once a manager approves it, and approval puts
--     it on the hub's sheet with a voucher.
--   * Settings: which functions are on, the kinds and their crew, default allowance, request formats.
--   * Every change of hub, crew, allowance or status is kept in an assign log.
--
-- Builds on the vehicle tables already in the database (vehicles, vehicle_assignments, vehicle_logs,
-- vehicle_day_logs, vehicle_requests). Their data stays as it is.

-- ---------------------------------------------------------------- permissions
insert into public.permissions (code, module, resource, action, description) values
  ('vehicle.report.view',   'vehicle', 'report',  'view',   'See the hub reports the drivers and helpers give (loading, unloading, no trip)'),
  ('vehicle.khoraki.post',  'vehicle', 'khoraki', 'create', 'Post the drivers'' and helpers'' daily allowance (খোরাকি) to the daily sheet')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager', 'operations_manager', 'zonal_manager') and p.code in ('vehicle.report.view', 'vehicle.khoraki.post'))
  or (r.code = 'hub_manager' and p.code in ('vehicle.khoraki.post'))
) on conflict do nothing;

-- ---------------------------------------------------------------- kinds, allowance, khoraki lines
alter table public.vehicles drop constraint if exists vehicles_kind_check;
alter table public.vehicles add constraint vehicles_kind_check
  check (kind in ('bike', 'cng', 'van', 'truck', 'pickup', 'covered_van', 'auto', 'other'));

alter table public.vehicle_assignments add column if not exists daily_allowance numeric(10,2)
  check (daily_allowance is null or daily_allowance >= 0);

alter table public.vehicle_logs drop constraint if exists vehicle_logs_kind_check;
alter table public.vehicle_logs add constraint vehicle_logs_kind_check
  check (kind in ('fuel', 'charge', 'service', 'repair', 'parts', 'tyre', 'oil', 'wash', 'toll', 'parking', 'fine', 'rent', 'paper', 'khoraki', 'other'));
create unique index if not exists vehicle_logs_khoraki_once on public.vehicle_logs (vehicle_id, driver_id, log_date)
  where kind = 'khoraki' and removed_at is null;

alter table public.vehicle_requests add column if not exists photos text[] not null default '{}';

-- ---------------------------------------------------------------- settings
insert into public.system_settings (key, value, description) values
  ('vehicle.fleet', '{
     "functions": {"hub_report": true, "fuel": true, "service": true, "garage": true, "khoraki": true},
     "kinds": [
       {"code": "truck",       "bn": "ট্রাক",        "crew": ["driver", "helper"]},
       {"code": "covered_van", "bn": "কাভার্ড ভ্যান", "crew": ["driver", "helper"]},
       {"code": "pickup",      "bn": "পিকআপ",        "crew": ["driver", "helper"]},
       {"code": "auto",        "bn": "অটো",          "crew": ["driver"]},
       {"code": "cng",         "bn": "সিএনজি",       "crew": ["driver"]},
       {"code": "bike",        "bn": "বাইক",         "crew": ["driver"]},
       {"code": "van",         "bn": "ভ্যান",        "crew": ["driver"]},
       {"code": "other",       "bn": "অন্যান্য",      "crew": ["driver", "helper"]}
     ],
     "khoraki": {"driver": 150, "helper": 100}
   }', 'Vehicles: which functions are on, the kinds and their crew, default daily allowance (খোরাকি)')
on conflict (key) do nothing;

create or replace function private.fleet_setting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.system_settings where key = 'vehicle.fleet'), '{}'::jsonb)
$$;
-- Is a function switched on? (missing = on)
create or replace function private.fleet_on(p_fn text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((private.fleet_setting() #>> array['functions', p_fn])::boolean, true)
$$;
-- The crew roles a kind of vehicle has.
create or replace function private.fleet_crew_roles(p_kind text) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select array(select jsonb_array_elements_text(k -> 'crew'))
                     from jsonb_array_elements(coalesce(private.fleet_setting() -> 'kinds', '[]'::jsonb)) k where k ->> 'code' = p_kind limit 1),
                  array['driver', 'helper'])
$$;

create or replace function public.vehicle_configure(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k jsonb;
begin
  if not private.has_permission('vehicle.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if p_key not in ('doc_alert_days', 'service_interval_km', 'fuel_price', 'requisition_format', 'day_format', 'request_formats', 'fleet') then
    raise exception 'Unknown setting.' using errcode = '22023';
  end if;
  if p_key in ('requisition_format', 'day_format') and jsonb_typeof(p_value) <> 'array' then raise exception 'The format must be a list of fields.' using errcode = '22023'; end if;
  if p_key = 'request_formats' and jsonb_typeof(p_value) <> 'object' then raise exception 'Request formats must be an object of lists.' using errcode = '22023'; end if;
  if p_key = 'fleet' then
    if jsonb_typeof(p_value) <> 'object' or jsonb_typeof(coalesce(p_value -> 'kinds', '[]')) <> 'array' then
      raise exception 'Fleet settings must be an object with a list of kinds.' using errcode = '22023';
    end if;
    for k in select * from jsonb_array_elements(coalesce(p_value -> 'kinds', '[]')) loop
      if (k ->> 'code') not in ('bike', 'cng', 'van', 'truck', 'pickup', 'covered_van', 'auto', 'other') then
        raise exception 'Unknown kind of vehicle: %', k ->> 'code' using errcode = '22023';
      end if;
      if not ((k -> 'crew') ?| array['driver']) or exists (select 1 from jsonb_array_elements_text(coalesce(k -> 'crew', '[]')) r where r not in ('driver', 'helper')) then
        raise exception 'Every kind has a driver; the crew may be driver and helper only.' using errcode = '22023';
      end if;
    end loop;
    if exists (select 1 from jsonb_each(coalesce(p_value -> 'khoraki', '{}')) x where jsonb_typeof(x.value) <> 'number' or (x.value)::numeric < 0) then
      raise exception 'The daily allowance must be a number, zero or more.' using errcode = '22023';
    end if;
  end if;
  insert into public.system_settings (key, value, description) values ('vehicle.' || p_key, p_value, 'Vehicles setting')
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------------------------------------------------------------- assign log
create table if not exists public.vehicle_events (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id),
  at          timestamptz not null default now(),
  by_user     uuid default auth.uid(),
  action      text not null check (action in ('created', 'hub', 'details', 'status', 'archived', 'crew_set', 'crew_removed', 'allowance')),
  role        text,
  employee_id uuid references public.employees(id),
  detail      text
);
create index if not exists vehicle_events_vehicle_idx on public.vehicle_events (vehicle_id, at desc);
create index if not exists vehicle_events_employee_idx on public.vehicle_events (employee_id);
create trigger vehicle_events_no_delete before delete on public.vehicle_events for each row execute function private.prevent_delete();
alter table public.vehicle_events enable row level security;
revoke all on public.vehicle_events from anon;
grant select on public.vehicle_events to authenticated;
create policy vehicle_events_read on public.vehicle_events for select to authenticated using (private.vehicle_can_view(vehicle_id));

create or replace function private.fleet_log_vehicle() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h_old text; h_new text;
begin
  if tg_op = 'INSERT' then
    select name into h_new from public.hubs where id = new.hub_id;
    insert into public.vehicle_events (vehicle_id, action, detail)
    values (new.id, 'created', concat_ws(' · ', new.name, new.reg_no, new.kind, h_new));
    return new;
  end if;
  if new.hub_id is distinct from old.hub_id then
    select name into h_old from public.hubs where id = old.hub_id;
    select name into h_new from public.hubs where id = new.hub_id;
    insert into public.vehicle_events (vehicle_id, action, detail) values (new.id, 'hub', coalesce(h_old, '—') || ' → ' || coalesce(h_new, '—'));
  end if;
  if new.name is distinct from old.name or new.reg_no is distinct from old.reg_no or new.kind is distinct from old.kind then
    insert into public.vehicle_events (vehicle_id, action, detail)
    values (new.id, 'details', concat_ws(' · ', old.name, old.reg_no, old.kind) || ' → ' || concat_ws(' · ', new.name, new.reg_no, new.kind));
  end if;
  if new.status is distinct from old.status then
    insert into public.vehicle_events (vehicle_id, action, detail) values (new.id, 'status', old.status || ' → ' || new.status);
  end if;
  if new.archived_at is not null and old.archived_at is null then
    insert into public.vehicle_events (vehicle_id, action, detail) values (new.id, 'archived', new.archive_reason);
  end if;
  return new;
end $$;
drop trigger if exists vehicles_fleet_log on public.vehicles;
create trigger vehicles_fleet_log after insert or update on public.vehicles for each row execute function private.fleet_log_vehicle();

create or replace function private.fleet_log_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.vehicle_events (vehicle_id, action, role, employee_id, detail)
    values (new.vehicle_id, 'crew_set', new.role, new.employee_id,
            concat_ws(' · ', new.reason, case when new.daily_allowance is not null then 'খোরাকি ৳' || new.daily_allowance::text end));
    return new;
  end if;
  if new.effective_to is not null and old.effective_to is null then
    insert into public.vehicle_events (vehicle_id, action, role, employee_id, detail) values (new.vehicle_id, 'crew_removed', new.role, new.employee_id, new.end_reason);
  end if;
  if new.daily_allowance is distinct from old.daily_allowance and new.effective_to is null then
    insert into public.vehicle_events (vehicle_id, action, role, employee_id, detail)
    values (new.vehicle_id, 'allowance', new.role, new.employee_id, '৳' || coalesce(old.daily_allowance::text, '০') || ' → ৳' || coalesce(new.daily_allowance::text, '০'));
  end if;
  return new;
end $$;
drop trigger if exists vehicle_assignments_fleet_log on public.vehicle_assignments;
create trigger vehicle_assignments_fleet_log after insert or update on public.vehicle_assignments for each row execute function private.fleet_log_assignment();

-- Earlier notifications pointed at the old vehicle pages; send them to the new ones.
create or replace function private.fleet_fix_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.link like '/app/vehicles/mine%' then new.link := '/app/fleet/mine';
  elsif new.link like '/app/vehicles%' then new.link := '/app/fleet';
  end if;
  return new;
end $$;
drop trigger if exists notifications_fleet_link on public.notifications;
create trigger notifications_fleet_link before insert on public.notifications for each row execute function private.fleet_fix_link();
update public.notifications set link = case when link like '/app/vehicles/mine%' then '/app/fleet/mine' else '/app/fleet' end where link like '/app/vehicles%';

-- ---------------------------------------------------------------- vehicles and crew
create sequence if not exists public.vehicle_fleet_code_seq;

create or replace function public.fleet_vehicle_save(p_name text, p_reg_no text, p_kind text, p_hub uuid, p_status text default 'active', p_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub); v_id uuid; v public.vehicles; r text;
begin
  if v_zone is null then raise exception 'Choose the hub the vehicle is given to.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Write the vehicle''s name.' using errcode = '22023'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.fleet_setting() -> 'kinds', '[]')) k where k ->> 'code' = p_kind) then
    raise exception 'Unknown kind of vehicle.' using errcode = '22023';
  end if;
  if coalesce(p_status, 'active') not in ('active', 'inactive', 'workshop', 'off_road') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_id is null then
    if not private.has_permission('vehicle.vehicle.create', v_zone, p_hub) then raise exception 'Not authorised to add vehicles.' using errcode = '42501'; end if;
    insert into public.vehicles (code, name, kind, reg_no, zone_id, hub_id, status)
    values (('G-' || lpad(nextval('public.vehicle_fleet_code_seq')::text, 4, '0'))::extensions.citext, trim(p_name), p_kind,
            nullif(trim(p_reg_no), ''), v_zone, p_hub, coalesce(p_status, 'active'))
    returning id into v_id;
  else
    select * into v from public.vehicles where id = p_id and archived_at is null for update;
    if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
    if not (private.has_permission('vehicle.vehicle.edit', v.zone_id, v.hub_id) and private.has_permission('vehicle.vehicle.edit', v_zone, p_hub)) then
      raise exception 'Not authorised to change this vehicle or give it to that hub.' using errcode = '42501';
    end if;
    update public.vehicles set name = trim(p_name), reg_no = nullif(trim(p_reg_no), ''), kind = p_kind, zone_id = v_zone, hub_id = p_hub,
           status = coalesce(p_status, status)
     where id = p_id returning id into v_id;
    -- a kind with no helper: the helper steps down
    if not ('helper' = any (private.fleet_crew_roles(p_kind))) then
      update public.vehicle_assignments set effective_to = current_date, end_reason = 'এই ধরনের গাড়িতে হেল্পার নেই'
       where vehicle_id = p_id and role = 'helper' and effective_to is null;
    end if;
  end if;
  return v_id;
end $$;

-- Put a driver / helper on a vehicle (or change their allowance). The vehicle stays with its hub.
create or replace function public.fleet_set_crew(p_vehicle uuid, p_role text, p_employee_code text, p_allowance numeric default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; e public.employees; cur public.vehicle_assignments; v_id uuid;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('vehicle.holder.edit', v.zone_id, v.hub_id) then raise exception 'Not authorised to set the crew.' using errcode = '42501'; end if;
  if not (p_role = any (private.fleet_crew_roles(v.kind))) then raise exception 'This kind of vehicle has no %.', p_role using errcode = '22023'; end if;
  if p_allowance is not null and p_allowance < 0 then raise exception 'The daily allowance cannot be negative.' using errcode = '22023'; end if;
  select * into e from public.employees
   where employee_code = regexp_replace(trim(coalesce(p_employee_code, '')), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null and status = 'active';
  if e.id is null then raise exception 'No active employee with ID %.', p_employee_code using errcode = '22023'; end if;
  select * into cur from public.vehicle_assignments where vehicle_id = v.id and role = p_role and effective_to is null;
  if cur.id is not null and cur.employee_id = e.id then
    update public.vehicle_assignments set daily_allowance = p_allowance where id = cur.id;
    return cur.id;
  end if;
  v_id := public.vehicle_assign(v.id, e.employee_code::text, coalesce(nullif(trim(p_reason), ''), case p_role when 'driver' then 'ড্রাইভার করা হলো' else 'হেল্পার করা হলো' end),
                                null, true, p_role);
  update public.vehicle_assignments set daily_allowance = p_allowance where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- money: approve → hub sheet with a voucher
-- Puts an approved vehicle line on the daily sheet of the vehicle's hub (the day it is for, or today), and makes a voucher when there is no bill number.
create or replace function private.fleet_post(p_log uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x public.vehicle_logs; v public.vehicles; e public.employees; v_session uuid; v_date date; v_exp uuid; v_cat text; v_name text; v_voucher text; v_role text; v_ok boolean;
begin
  select * into x from public.vehicle_logs where id = p_log and removed_at is null for update;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  if x.status <> 'approved' then raise exception 'Approve the line first.' using errcode = '22023'; end if;
  if x.da_expense_id is not null then
    return jsonb_build_object('posted', true, 'voucher', (select voucher_no from public.da_expenses where id = x.da_expense_id), 'expense', x.da_expense_id);
  end if;
  if coalesce(x.amount, 0) <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  select * into e from public.employees where id = x.driver_id;
  v_date := least(x.log_date, private.da_today());
  select id into v_session from public.da_sessions where hub_id = coalesce(x.hub_id, v.hub_id) and account_date = v_date;
  if v_session is null then v_session := public.da_start_session(coalesce(x.hub_id, v.hub_id), v_date); end if;
  v_cat := case x.kind when 'khoraki' then 'meal' when 'fuel' then 'fuel' when 'charge' then 'fuel' when 'parts' then 'vehicle_parts' when 'tyre' then 'vehicle_parts'
                       when 'toll' then 'toll' when 'fine' then 'penalties' when 'service' then 'repair' when 'repair' then 'repair' when 'oil' then 'repair' else 'transport' end;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = v_cat) then
    v_cat := case when exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = 'transport') then 'transport' else 'other' end;
  end if;
  select a.role into v_role from public.vehicle_assignments a where a.vehicle_id = v.id and a.employee_id = x.driver_id order by a.effective_from desc limit 1;
  v_name := case x.kind when 'khoraki' then 'খোরাকি — ' || case v_role when 'helper' then 'হেল্পার' else 'ড্রাইভার' end
                        when 'fuel' then 'তেল' when 'charge' then 'গ্যারেজ চার্জ' when 'service' then 'সার্ভিসিং' when 'repair' then 'মেরামত' when 'parts' then 'পার্টস'
                        when 'tyre' then 'টায়ার' when 'oil' then 'ইঞ্জিন অয়েল' when 'toll' then 'টোল' when 'fine' then 'জরিমানা' else 'গাড়ির খরচ' end
            || ' — ' || v.name || coalesce(' (' || v.reg_no || ')', '');
  -- the sheet takes an Employee ID only for a member of that hub; otherwise the name goes in the line's text
  v_ok := coalesce(e.id is not null and private.da_employee_ok(e.id, coalesce(x.hub_id, v.hub_id)), false);
  if not v_ok and e.id is not null then v_name := v_name || ' — ' || e.full_name || coalesce(' (' || e.employee_code || ')', ''); end if;
  v_exp := public.da_save_expense(v_session, case when x.kind = 'khoraki' and v_ok then 'employee' else 'transport' end,
             case when v_ok then e.employee_code::text end, v_name, v_cat, x.amount, v_date,
             x.bill_no, null, null, null, null, false, null,
             concat_ws(' · ', nullif(x.vendor, ''), case when x.litres is not null then x.litres::text || ' L' end, x.note,
                       case when x.slip_path is not null then 'স্লিপ: গাড়ির পাতায়' end), null);
  perform public.da_set_expense_reference(v_exp, null, null, null, v.id);
  update public.vehicle_logs set da_expense_id = v_exp where id = p_log;
  if nullif(trim(coalesce(x.bill_no, '')), '') is null then v_voucher := public.da_make_voucher(v_exp); end if;
  return jsonb_build_object('posted', true, 'voucher', v_voucher, 'expense', v_exp);
end $$;

-- Approve what the crew put up and put it on the sheet at once. If the sheet cannot take it now
-- (closed, or the approver may not write it), the line stays approved and can be posted later.
create or replace function public.fleet_approve(p_log uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.vehicle_log_decide(p_log, true, p_note);
  begin
    r := private.fleet_post(p_log);
  exception when others then
    r := jsonb_build_object('posted', false, 'error', sqlerrm);
  end;
  return r;
end $$;

-- Post an approved line that has not reached the sheet yet.
create or replace function public.fleet_post(p_log uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x public.vehicle_logs; v public.vehicles;
begin
  select * into x from public.vehicle_logs where id = p_log and removed_at is null;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  if not (private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id) or (x.kind = 'khoraki' and private.has_permission('vehicle.khoraki.post', v.zone_id, v.hub_id))) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return private.fleet_post(p_log);
end $$;

-- The day's allowance for the vehicle's crew: one line per person, once per day.
create or replace function public.fleet_khoraki_post(p_vehicle uuid, p_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; a record; v_date date := coalesce(p_date, private.da_today()); v_log uuid; v_out jsonb := '[]'::jsonb; r jsonb;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.fleet_on('khoraki') then raise exception 'The daily allowance is switched off in the vehicle settings.' using errcode = '22023'; end if;
  if not private.has_permission('vehicle.khoraki.post', v.zone_id, v.hub_id) then raise exception 'Not authorised to post the daily allowance.' using errcode = '42501'; end if;
  if v_date > private.da_today() then raise exception 'The date cannot be in the future.' using errcode = '22023'; end if;
  for a in select x.employee_id, x.role, x.daily_allowance, em.full_name, em.profile_id from public.vehicle_assignments x join public.employees em on em.id = x.employee_id
            where x.vehicle_id = v.id and x.effective_from <= v_date and (x.effective_to is null or x.effective_to >= v_date)
              and coalesce(x.daily_allowance, 0) > 0 order by x.role loop
    if exists (select 1 from public.vehicle_logs l where l.vehicle_id = v.id and l.driver_id = a.employee_id and l.log_date = v_date and l.kind = 'khoraki' and l.removed_at is null) then
      v_out := v_out || jsonb_build_object('name', a.full_name, 'role', a.role, 'skipped', true);
      continue;
    end if;
    insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, amount, driver_id, note, status, decided_by, decided_at)
    values (v.id, v.hub_id, v.zone_id, 'khoraki', v_date, a.daily_allowance, a.employee_id, 'দৈনিক খোরাকি', 'approved', auth.uid(), now())
    returning id into v_log;
    begin
      r := private.fleet_post(v_log);
    exception when others then
      r := jsonb_build_object('posted', false, 'error', sqlerrm);
    end;
    perform private.notify(a.profile_id, 'খোরাকি উঠেছে: ৳' || a.daily_allowance::text, v.name || ' · ' || to_char(v_date, 'DD Mon'), '/app/fleet/mine', 'vehicle');
    v_out := v_out || (jsonb_build_object('name', a.full_name, 'role', a.role, 'amount', a.daily_allowance) || r);
  end loop;
  return v_out;
end $$;

-- The manager's daily line for an auto: was it charged at the garage, and the bill.
create or replace function public.fleet_garage_save(p_vehicle uuid, p_date date, p_charged boolean, p_cost numeric default null, p_place text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_day uuid; v_log uuid; r jsonb := '{}'::jsonb;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.fleet_on('garage') then raise exception 'Garage charge is switched off in the vehicle settings.' using errcode = '22023'; end if;
  if not private.has_permission('vehicle.log.create', v.zone_id, v.hub_id) then raise exception 'Not authorised to write the garage charge.' using errcode = '42501'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'The bill cannot be negative.' using errcode = '22023'; end if;
  v_day := public.vehicle_day_save(v.id, p_date, p_charged, p_place, case when p_charged then p_cost end, null, null, null, null, null, '{}'::jsonb, p_note, null);
  select id into v_log from public.vehicle_logs where day_log_id = v_day and removed_at is null;
  if v_log is not null then
    begin
      r := private.fleet_post(v_log);
    exception when others then
      r := jsonb_build_object('posted', false, 'error', sqlerrm);
    end;
  end if;
  return r || jsonb_build_object('day', v_day);
end $$;

-- ---------------------------------------------------------------- requests with photos; done → sheet
create or replace function public.fleet_request(p_vehicle uuid, p_kind text, p_title text, p_data jsonb default '{}'::jsonb,
                                                p_priority text default 'normal', p_photos text[] default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_photos text[] := array(select p from unnest(coalesce(p_photos, '{}')) p where nullif(trim(p), '') is not null);
begin
  if not private.fleet_on('service') then raise exception 'Service requests are switched off in the vehicle settings.' using errcode = '22023'; end if;
  if cardinality(v_photos) > 6 then raise exception 'Up to six photos.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_photos) p where p not like p_vehicle::text || '/%') then raise exception 'A photo is not this vehicle''s.' using errcode = '22023'; end if;
  v_id := public.vehicle_request_submit(p_vehicle, p_kind, p_title, p_data, p_priority, v_photos[1]);
  update public.vehicle_requests set photos = v_photos where id = v_id;
  return v_id;
end $$;

create or replace function public.fleet_request_done(p_id uuid, p_cost numeric default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_log uuid; r jsonb := jsonb_build_object('posted', false);
begin
  perform public.vehicle_request_update(p_id, 'done', p_note, p_cost);
  select log_id into v_log from public.vehicle_requests where id = p_id;
  if v_log is not null then
    begin
      r := private.fleet_post(v_log);
    exception when others then
      r := jsonb_build_object('posted', false, 'error', sqlerrm);
    end;
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------- hub reports from the crew
create table if not exists public.vehicle_hub_reports (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id),
  zone_id      uuid not null references public.zones(id),
  hub_id       uuid not null references public.hubs(id),
  report_date  date not null,
  status       text not null check (status in ('on_time', 'load_late', 'unload_late', 'no_trip', 'other')),
  late_minutes integer check (late_minutes is null or late_minutes between 0 and 1440),
  note         text,
  photo_path   text,
  by_employee  uuid references public.employees(id),
  created_at   timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (vehicle_id, hub_id, report_date)
);
create index if not exists vehicle_hub_reports_zone_day_idx on public.vehicle_hub_reports (zone_id, report_date desc);
create index if not exists vehicle_hub_reports_hub_idx on public.vehicle_hub_reports (hub_id, report_date desc);
create index if not exists vehicle_hub_reports_employee_idx on public.vehicle_hub_reports (by_employee);
create trigger vehicle_hub_reports_audit after insert or update or delete on public.vehicle_hub_reports for each row execute function private.audit_row('ops');
create trigger vehicle_hub_reports_no_delete before delete on public.vehicle_hub_reports for each row execute function private.prevent_delete();
alter table public.vehicle_hub_reports enable row level security;
revoke all on public.vehicle_hub_reports from anon;
grant select on public.vehicle_hub_reports to authenticated;
create policy vehicle_hub_reports_read on public.vehicle_hub_reports for select to authenticated
  using (private.has_permission('vehicle.report.view', zone_id, hub_id) or private.vehicle_can_view(vehicle_id) or by_employee = private.my_employee_id());

create or replace function public.fleet_hub_report(p_vehicle uuid, p_hub uuid, p_status text, p_minutes integer default null, p_note text default null,
                                                   p_photo text default null, p_date date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_id uuid; v_date date := coalesce(p_date, private.da_today()); h public.hubs; u uuid; v_word text;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.fleet_on('hub_report') then raise exception 'Hub reports are switched off in the vehicle settings.' using errcode = '22023'; end if;
  if not (private.vehicle_is_crew(v.id) or private.has_permission('vehicle.log.create', v.zone_id, v.hub_id)) then
    raise exception 'Only this vehicle''s driver or helper reports for it.' using errcode = '42501';
  end if;
  select * into h from public.hubs where id = p_hub and archived_at is null;
  if h.id is null or h.zone_id <> v.zone_id then raise exception 'Choose a hub in this vehicle''s zone.' using errcode = '22023'; end if;
  if p_status not in ('on_time', 'load_late', 'unload_late', 'no_trip', 'other') then raise exception 'Unknown report.' using errcode = '22023'; end if;
  if p_status in ('no_trip', 'other') and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write what happened.' using errcode = '22023'; end if;
  if v_date > private.da_today() or v_date < private.da_today() - 3 then raise exception 'Report today or the last three days.' using errcode = '22023'; end if;
  if nullif(trim(p_photo), '') is not null and p_photo not like v.id::text || '/%' then raise exception 'The photo is not this vehicle''s.' using errcode = '22023'; end if;
  insert into public.vehicle_hub_reports (vehicle_id, zone_id, hub_id, report_date, status, late_minutes, note, photo_path, by_employee)
  values (v.id, v.zone_id, p_hub, v_date, p_status, p_minutes, nullif(trim(p_note), ''), nullif(trim(p_photo), ''), private.my_employee_id())
  on conflict (vehicle_id, hub_id, report_date) do update
    set status = excluded.status, late_minutes = excluded.late_minutes, note = excluded.note,
        photo_path = coalesce(excluded.photo_path, public.vehicle_hub_reports.photo_path), by_employee = excluded.by_employee, updated_at = now()
  returning id into v_id;
  if p_status <> 'on_time' then
    v_word := case p_status when 'load_late' then 'লোড করে ছাড়তে দেরি' when 'unload_late' then 'আনলোডে দেরি' when 'no_trip' then 'আজ ট্রিপ দেয়নি' else 'হাব রিপোর্ট' end;
    for u in
      select distinct ur.user_id from public.user_roles ur
        join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
        join public.role_permissions rp on rp.role_id = r.id join public.permissions p on p.id = rp.permission_id and p.code = 'vehicle.report.view'
       where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
         and ur.scope_type = 'zone' and ur.zone_id = v.zone_id
    loop
      perform private.notify(u, h.name || ': ' || v_word, v.name || coalesce(' · ' || p_minutes::text || ' মিনিট', '') || coalesce(' · ' || nullif(trim(p_note), ''), '') || ' · ' || private.my_display_name(),
                             '/app/fleet?tab=reports', 'vehicle');
    end loop;
  end if;
  return v_id;
end $$;

create or replace function public.fleet_hub_reports(p_from date, p_to date, p_hub uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'report_date', r.report_date, 'status', r.status, 'late_minutes', r.late_minutes, 'note', r.note, 'photo_path', r.photo_path,
           'hub_id', r.hub_id, 'hub_name', h.name, 'vehicle_id', r.vehicle_id, 'vehicle', v.name || coalesce(' (' || v.reg_no || ')', ''),
           'by_name', e.full_name, 'by_code', e.employee_code, 'created_at', r.created_at, 'updated_at', r.updated_at)
         order by r.report_date desc, h.name, r.created_at), '[]'::jsonb)
  from public.vehicle_hub_reports r join public.hubs h on h.id = r.hub_id join public.vehicles v on v.id = r.vehicle_id
  left join public.employees e on e.id = r.by_employee
  where r.report_date between p_from and p_to and (p_hub is null or r.hub_id = p_hub)
    and (private.has_permission('vehicle.report.view', r.zone_id, r.hub_id) or private.vehicle_can_view(r.vehicle_id) or r.by_employee = private.my_employee_id())
$$;

-- ---------------------------------------------------------------- what each screen reads
-- The managers' board: every vehicle they may see, its crew and allowance, and today's state.
create or replace function public.fleet_board(p_hub uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'code', v.code, 'name', v.name, 'reg_no', v.reg_no, 'kind', v.kind, 'status', v.status,
    'hub_id', v.hub_id, 'hub_name', h.name, 'zone_id', v.zone_id, 'zone_name', z.name, 'roles', to_jsonb(private.fleet_crew_roles(v.kind)),
    'crew', coalesce((select jsonb_agg(jsonb_build_object('role', a.role, 'employee_id', a.employee_id, 'code', e.employee_code, 'name', e.full_name,
                                                          'mobile', e.mobile, 'allowance', a.daily_allowance, 'since', a.effective_from) order by a.role)
                        from public.vehicle_assignments a join public.employees e on e.id = a.employee_id
                       where a.vehicle_id = v.id and a.effective_to is null), '[]'::jsonb),
    'khoraki_today', coalesce((select jsonb_agg(jsonb_build_object('employee_id', l.driver_id, 'amount', l.amount, 'posted', l.da_expense_id is not null, 'log_id', l.id))
                                 from public.vehicle_logs l where l.vehicle_id = v.id and l.kind = 'khoraki' and l.log_date = private.da_today() and l.removed_at is null), '[]'::jsonb),
    'garage_today', (select jsonb_build_object('charged', d.charged, 'cost', d.charge_cost, 'place', d.charge_place, 'note', d.note,
                                               'posted', exists (select 1 from public.vehicle_logs l where l.day_log_id = d.id and l.removed_at is null and l.da_expense_id is not null))
                       from public.vehicle_day_logs d where d.vehicle_id = v.id and d.log_date = private.da_today()),
    'pending', (select count(*) from public.vehicle_logs l where l.vehicle_id = v.id and l.status = 'submitted' and l.removed_at is null),
    'unposted', (select count(*) from public.vehicle_logs l where l.vehicle_id = v.id and l.status = 'approved' and l.da_expense_id is null and l.removed_at is null
                   and l.amount > 0 and l.created_at > now() - interval '30 days'),
    'requests_open', (select count(*) from public.vehicle_requests q where q.vehicle_id = v.id and q.status in ('open', 'accepted')),
    'can_edit', private.has_permission('vehicle.vehicle.edit', v.zone_id, v.hub_id),
    'can_crew', private.has_permission('vehicle.holder.edit', v.zone_id, v.hub_id),
    'can_approve', private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id),
    'can_khoraki', private.has_permission('vehicle.khoraki.post', v.zone_id, v.hub_id),
    'can_garage', private.has_permission('vehicle.log.create', v.zone_id, v.hub_id))
    order by z.name, h.name, v.name), '[]'::jsonb)
  from public.vehicles v left join public.hubs h on h.id = v.hub_id left join public.zones z on z.id = v.zone_id
  where v.archived_at is null and (p_hub is null or v.hub_id = p_hub)
    and (private.has_permission('vehicle.vehicle.view', v.zone_id, v.hub_id) or private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id))
$$;

-- What waits for the managers: fuel / garage / costs to approve, approved lines not on the sheet yet, open requests.
create or replace function public.fleet_waiting(p_hub uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'logs', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'vehicle_id', l.vehicle_id, 'vehicle', v.name || coalesce(' (' || v.reg_no || ')', ''), 'hub_name', h.name,
                                       'kind', l.kind, 'log_date', l.log_date, 'amount', l.amount, 'litres', l.litres, 'vendor', l.vendor, 'bill_no', l.bill_no, 'slip_path', l.slip_path,
                                       'note', l.note, 'status', l.status, 'by_name', e.full_name, 'by_code', e.employee_code, 'created_at', l.created_at) order by l.created_at)
                        from public.vehicle_logs l join public.vehicles v on v.id = l.vehicle_id left join public.hubs h on h.id = l.hub_id left join public.employees e on e.id = l.driver_id
                       where l.removed_at is null and v.archived_at is null and (p_hub is null or l.hub_id = p_hub)
                         and ((l.status = 'submitted') or (l.status = 'approved' and l.da_expense_id is null and l.amount > 0 and l.created_at > now() - interval '30 days'))
                         and private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id)), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'no', q.no, 'vehicle_id', q.vehicle_id, 'vehicle', v.name || coalesce(' (' || v.reg_no || ')', ''),
                                           'hub_name', h.name, 'kind', q.kind, 'title', q.title, 'data', q.data, 'photos', q.photos, 'priority', q.priority, 'status', q.status,
                                           'by_name', e.full_name, 'by_code', e.employee_code, 'created_at', q.created_at) order by (q.priority = 'urgent') desc, q.created_at)
                            from public.vehicle_requests q join public.vehicles v on v.id = q.vehicle_id left join public.hubs h on h.id = q.hub_id left join public.employees e on e.id = q.by_employee
                           where q.status in ('open', 'accepted') and (p_hub is null or q.hub_id = p_hub)
                             and (private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id) or private.has_permission('vehicle.requisition.approve', v.zone_id, v.hub_id))), '[]'::jsonb))
$$;

create or replace function public.fleet_events(p_vehicle uuid default null, p_limit integer default 200) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) from (
    select jsonb_build_object('id', ev.id, 'at', ev.at, 'action', ev.action, 'role', ev.role, 'detail', ev.detail,
             'vehicle_id', ev.vehicle_id, 'vehicle', v.name || coalesce(' (' || v.reg_no || ')', ''),
             'employee', e.full_name, 'employee_code', e.employee_code,
             'by_name', coalesce((select em.full_name from public.employees em where em.profile_id = ev.by_user limit 1), (select p.full_name from public.profiles p where p.id = ev.by_user))) as x
    from public.vehicle_events ev join public.vehicles v on v.id = ev.vehicle_id left join public.employees e on e.id = ev.employee_id
    where (p_vehicle is null or ev.vehicle_id = p_vehicle) and private.vehicle_can_view(ev.vehicle_id)
    order by ev.at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) s
$$;

-- The driver's / helper's own panel.
create or replace function public.fleet_mine() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.my_employee_id();
begin
  if v_me is null then return null; end if;
  return jsonb_build_object(
    'functions', coalesce(private.fleet_setting() -> 'functions', '{}'::jsonb),
    'formats', coalesce((select value from public.system_settings where key = 'vehicle.request_formats'), '{}'::jsonb),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'reg_no', v.reg_no, 'kind', v.kind, 'status', v.status, 'hub_id', v.hub_id, 'hub_name', h.name, 'zone_id', v.zone_id,
        'role', a.role, 'allowance', a.daily_allowance, 'since', a.effective_from,
        'crew', coalesce((select jsonb_agg(jsonb_build_object('role', b.role, 'name', e.full_name, 'code', e.employee_code, 'mobile', e.mobile))
                            from public.vehicle_assignments b join public.employees e on e.id = b.employee_id
                           where b.vehicle_id = v.id and b.effective_to is null and b.employee_id <> v_me), '[]'::jsonb),
        'zone_hubs', coalesce((select jsonb_agg(jsonb_build_object('id', zh.id, 'name', zh.name) order by zh.name)
                                 from public.hubs zh where zh.zone_id = v.zone_id and zh.archived_at is null), '[]'::jsonb),
        'garage', coalesce((select jsonb_agg(jsonb_build_object('date', d.log_date, 'charged', d.charged, 'cost', d.charge_cost, 'place', d.charge_place, 'note', d.note) order by d.log_date desc)
                              from public.vehicle_day_logs d where d.vehicle_id = v.id and d.log_date > private.da_today() - 60), '[]'::jsonb),
        'costs', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'date', l.log_date, 'amount', l.amount, 'litres', l.litres, 'status', l.status,
                                                               'note', coalesce(l.decision_note, l.note), 'posted', l.da_expense_id is not null,
                                                               'voucher', (select x.voucher_no from public.da_expenses x where x.id = l.da_expense_id), 'mine', l.driver_id = v_me)
                                             order by l.log_date desc, l.created_at desc)
                             from public.vehicle_logs l where l.vehicle_id = v.id and l.removed_at is null and l.log_date > private.da_today() - 60
                              and (l.kind <> 'khoraki' or l.driver_id = v_me)), '[]'::jsonb),
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'no', q.no, 'kind', q.kind, 'title', q.title, 'status', q.status, 'priority', q.priority,
                                                                  'note', q.decision_note, 'cost', q.cost, 'photos', q.photos, 'created_at', q.created_at) order by q.created_at desc)
                                from public.vehicle_requests q where q.vehicle_id = v.id and q.created_at > now() - interval '90 days'), '[]'::jsonb),
        'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'date', r.report_date, 'hub_id', r.hub_id, 'hub_name', rh.name, 'status', r.status,
                                                                 'late_minutes', r.late_minutes, 'note', r.note) order by r.report_date desc, rh.name)
                               from public.vehicle_hub_reports r join public.hubs rh on rh.id = r.hub_id
                              where r.vehicle_id = v.id and r.report_date > private.da_today() - 14), '[]'::jsonb)
      ) order by a.role, v.name)
      from public.vehicle_assignments a join public.vehicles v on v.id = a.vehicle_id and v.archived_at is null left join public.hubs h on h.id = v.hub_id
      where a.employee_id = v_me and a.effective_to is null), '[]'::jsonb));
end $$;

-- Settings screen: which roles hold each vehicle permission (to show who approves what).
create or replace function public.fleet_approvers() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not private.has_permission('vehicle.settings.configure') then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
           'code', p.code, 'description', p.description,
           'roles', coalesce((select jsonb_agg(coalesce(r.name_bn, r.name) order by r.name) from public.role_permissions rp join public.roles r on r.id = rp.role_id
                               where rp.permission_id = p.id and r.archived_at is null and r.status = 'active'), '[]'::jsonb)) order by p.code), '[]'::jsonb) end
  from public.permissions p where p.code like 'vehicle.%'
$$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.vehicle_configure(text, jsonb)', 'public.fleet_vehicle_save(text, text, text, uuid, text, uuid)',
    'public.fleet_set_crew(uuid, text, text, numeric, text)', 'public.fleet_approve(uuid, text)', 'public.fleet_post(uuid)',
    'public.fleet_khoraki_post(uuid, date)', 'public.fleet_garage_save(uuid, date, boolean, numeric, text, text)',
    'public.fleet_request(uuid, text, text, jsonb, text, text[])', 'public.fleet_request_done(uuid, numeric, text)',
    'public.fleet_hub_report(uuid, uuid, text, integer, text, text, date)', 'public.fleet_hub_reports(date, date, uuid)',
    'public.fleet_board(uuid)', 'public.fleet_waiting(uuid)', 'public.fleet_events(uuid, integer)', 'public.fleet_mine()', 'public.fleet_approvers()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.fleet_post(uuid), private.fleet_log_vehicle(), private.fleet_log_assignment(), private.fleet_fix_link() from public, anon, authenticated;
revoke all on function private.fleet_setting(), private.fleet_on(text), private.fleet_crew_roles(text) from public, anon;
grant execute on function private.fleet_setting(), private.fleet_on(text), private.fleet_crew_roles(text) to authenticated;
