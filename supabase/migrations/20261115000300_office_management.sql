-- =====================================================================
-- XZM-TEAM ERP — Migration 0028: Office Management
--
--  * office_properties: offices and residences (flats / mess), each in a zone and
--    optionally tied to a hub or a sorting center.
--  * office_rooms: rooms of a property — garage, room, kitchen, bathroom, office room…
--    with the direction it faces (N, NE … centre) and the floor, and who looks after it.
--  * office_desks: desks (Desk 1, Desk 2 …) with the person responsible for each.
--  * office_assets: what is in a room or on a desk — monitor, PC, keyboard, mouse,
--    printer, light, fan, bedding, stove, gas cylinder … with condition and holder.
--  Nothing is hard-deleted: rows are archived with a reason (audit log keeps history).
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('office.property.view',    'office', 'property', 'view',    'See offices, residences, rooms, desks and their resources'),
  ('office.property.create',  'office', 'property', 'create',  'Add offices / residences, rooms and desks'),
  ('office.property.edit',    'office', 'property', 'edit',    'Change offices, rooms and desks, assign people to desks'),
  ('office.property.archive', 'office', 'property', 'archive', 'Remove offices, rooms and desks'),
  ('office.asset.view',       'office', 'asset',    'view',    'See office resources (monitor, PC, fan …)'),
  ('office.asset.edit',       'office', 'asset',    'edit',    'Add / change / remove office resources and who holds them')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager') and p.code like 'office.%')
  or (r.code in ('zonal_manager', 'operations_manager') and p.code in ('office.property.view', 'office.property.create', 'office.property.edit',
        'office.asset.view', 'office.asset.edit'))
  or (r.code in ('hub_manager', 'accounts_manager', 'auditor') and p.code in ('office.property.view', 'office.asset.view'))
) on conflict do nothing;

create table public.office_properties (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique,
  name text not null check (length(trim(name)) > 1),
  kind text not null default 'office' check (kind in ('office', 'residence')),
  zone_id uuid not null references public.zones(id),
  hub_id uuid references public.hubs(id),
  sorting_center_id uuid references public.sorting_centers(id),
  address text, floor_note text, owner_name text, owner_phone text, rent numeric(12,2),
  front_direction text check (front_direction in ('n','ne','e','se','s','sw','w','nw')),
  note text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table public.office_rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.office_properties(id),
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'room' check (kind in ('office_room', 'room', 'garage', 'kitchen', 'bathroom', 'store', 'dining', 'veranda', 'meeting', 'other')),
  direction text not null default 'c' check (direction in ('n','ne','e','se','s','sw','w','nw','c')),
  floor integer not null default 1,
  responsible_id uuid references public.employees(id),
  note text, sort integer not null default 100,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table public.office_desks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.office_properties(id),
  room_id uuid references public.office_rooms(id),
  code text not null, name text not null check (length(trim(name)) > 0),
  responsible_id uuid references public.employees(id),
  duty text, note text, sort integer not null default 100,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index office_desks_code on public.office_desks (property_id, code) where archived_at is null;

create table public.office_assets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.office_properties(id),
  room_id uuid references public.office_rooms(id),
  desk_id uuid references public.office_desks(id),
  kind text not null default 'other',
  name text not null check (length(trim(name)) > 0),
  brand text, serial_no text,
  quantity integer not null default 1 check (quantity > 0),
  condition text not null default 'good' check (condition in ('good', 'repair', 'broken', 'lost')),
  holder_id uuid references public.employees(id),
  purchase_date date, price numeric(12,2) check (price is null or price >= 0),
  note text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index office_assets_prop on public.office_assets (property_id) where archived_at is null;

-- Access follows the property's zone / hub.
create or replace function private.office_can(p_perm text, p_property uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.office_properties p where p.id = p_property
                  and (private.has_permission(p_perm, p.zone_id, p.hub_id) or private.has_permission(p_perm, p.zone_id, null)))
$$;
grant execute on function private.office_can(text, uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['office_properties','office_rooms','office_desks','office_assets'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'office');
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

create policy op_read on public.office_properties for select to authenticated
  using (private.has_permission('office.property.view', zone_id, hub_id) or private.has_permission('office.property.view', zone_id, null)
      or private.has_permission_within_zone('office.property.view', zone_id) and hub_id is null);
create policy op_insert on public.office_properties for insert to authenticated
  with check (private.has_permission('office.property.create', zone_id, hub_id) and (hub_id is null or private.hub_zone(hub_id) = zone_id));
create policy op_update on public.office_properties for update to authenticated
  using (private.has_permission('office.property.edit', zone_id, hub_id) or private.has_permission('office.property.archive', zone_id, hub_id))
  with check (private.has_permission('office.property.edit', zone_id, hub_id) or private.has_permission('office.property.archive', zone_id, hub_id));

create policy orm_read on public.office_rooms for select to authenticated using (private.office_can('office.property.view', property_id));
create policy orm_insert on public.office_rooms for insert to authenticated with check (private.office_can('office.property.create', property_id) or private.office_can('office.property.edit', property_id));
create policy orm_update on public.office_rooms for update to authenticated
  using (private.office_can('office.property.edit', property_id)) with check (private.office_can('office.property.edit', property_id));

create policy od_read on public.office_desks for select to authenticated
  using (private.office_can('office.property.view', property_id) or responsible_id = private.my_employee_id());
create policy od_insert on public.office_desks for insert to authenticated with check (private.office_can('office.property.create', property_id) or private.office_can('office.property.edit', property_id));
create policy od_update on public.office_desks for update to authenticated
  using (private.office_can('office.property.edit', property_id)) with check (private.office_can('office.property.edit', property_id));

create policy oa_read on public.office_assets for select to authenticated
  using (private.office_can('office.asset.view', property_id) or holder_id = private.my_employee_id()
      or exists (select 1 from public.office_desks d where d.id = office_assets.desk_id and d.responsible_id = private.my_employee_id()));
create policy oa_insert on public.office_assets for insert to authenticated with check (private.office_can('office.asset.edit', property_id));
create policy oa_update on public.office_assets for update to authenticated
  using (private.office_can('office.asset.edit', property_id)) with check (private.office_can('office.asset.edit', property_id));
