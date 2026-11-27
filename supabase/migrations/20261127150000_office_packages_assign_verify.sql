-- Office resources: packages, responsibility in bulk, the hub manager's verification of a problem report, and both hubs (and optional
-- people) on a loan.
--  * Package: a named set of parts ("manager desk = PC + monitor + keyboard + mouse + chair + table"). The zonal manager makes the zone's
--    packages; the hub uses them to fill a desk in one go. Parts are kinds with a count, not particular items.
--  * Responsibility in bulk: one person gets one item, every item of one kind, or everything of a place (hub) at once.
--  * Verification: a problem report goes to the zonal manager at once (as before) and also to the hub manager, who verifies it;
--    the verifier's name and time are kept and listed.
--  * A loan keeps who gave and who took (the hub of each side is read from the place), and an optional person on each side.

insert into public.permissions (code, module, resource, action, description) values
  ('office.package.edit', 'office', 'package', 'edit', 'Make, change and remove the zone''s resource packages'),
  ('office.notice_verify.approve',  'office', 'notice_verify', 'approve', 'Verify a problem report of the own hub (the name is kept on the verify list)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager', 'zonal_manager', 'operations_manager') and p.code in ('office.package.edit', 'office.notice_verify.approve'))
  or (r.code = 'hub_manager' and p.code = 'office.notice_verify.approve')
) on conflict do nothing;

-- ---------------------------------------------------------------- packages
create table private.office_packages (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones(id),
  name text not null check (length(trim(name)) > 0),
  items jsonb not null check (jsonb_typeof(items) = 'object' and items <> '{}'::jsonb),     -- { kind: count }
  note text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index office_packages_name on private.office_packages (zone_id, lower(name)) where archived_at is null;
alter table private.office_packages enable row level security;
revoke all on private.office_packages from public, anon, authenticated;
create trigger office_packages_stamp before insert or update on private.office_packages for each row execute function private.stamp_row();
create trigger office_packages_audit after insert or update or delete on private.office_packages for each row execute function private.audit_row('office');
create trigger office_packages_no_delete before delete on private.office_packages for each row execute function private.prevent_delete();

alter table public.office_desks add column package_id uuid references private.office_packages(id);
create index office_desks_package on public.office_desks (package_id) where package_id is not null;

create function public.office_package_save(p_zone uuid, p_name text, p_items jsonb, p_note text default null, p_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; k text; v jsonb;
begin
  if auth.uid() is null or not coalesce(private.has_permission('office.package.edit', p_zone, null), false) then
    raise exception 'প্যাকেজ বানানোর অনুমতি নেই' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'প্যাকেজের নাম দিন' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' or p_items = '{}'::jsonb then raise exception 'অন্তত একটা পার্ট দিন' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(p_items)) > 40 then raise exception 'পার্ট অনেক বেশি' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(p_items) loop
    if k !~ '^[a-z_]{1,40}$' or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,3}$' or (v #>> '{}')::int < 1 then
      raise exception 'পার্টের সংখ্যা ঠিক নয়' using errcode = '22023'; end if;
  end loop;
  perform set_config('app.change_reason', 'অফিসের রিসোর্স প্যাকেজ', true);
  if p_id is null then
    insert into private.office_packages (zone_id, name, items, note) values (p_zone, trim(p_name), p_items, nullif(trim(coalesce(p_note, '')), ''))
    returning id into v_id;
  else
    update private.office_packages set name = trim(p_name), items = p_items, note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_id and zone_id = p_zone and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'প্যাকেজটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'এই নামে প্যাকেজ আগেই আছে' using errcode = '23505';
end $$;

create function public.office_package_archive(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare pk private.office_packages;
begin
  select * into pk from private.office_packages where id = p_id and archived_at is null;
  if not found then raise exception 'প্যাকেজটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if auth.uid() is null or not coalesce(private.has_permission('office.package.edit', pk.zone_id, null), false) then
    raise exception 'প্যাকেজ সরানোর অনুমতি নেই' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'সরানোর কারণ লিখুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update private.office_packages set archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason) where id = p_id;
end $$;

-- The packages of the place's zone: whoever may view the place sees them; can_manage tells who may change them.
create function public.office_package_list(p_property uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'zone_id', k.zone_id, 'name', k.name, 'items', k.items, 'note', k.note,
           'can_manage', coalesce(private.has_permission('office.package.edit', k.zone_id, null), false)) order by k.name), '[]'::jsonb)
  from public.office_properties p join private.office_packages k on k.zone_id = p.zone_id and k.archived_at is null
  where p.id = p_property and auth.uid() is not null and private.office_can('office.property.view', p.id)
$$;

-- Which package a desk follows (null = none). Same zone only.
create function public.office_desk_package_set(p_desk uuid, p_package uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.office_desks; pr public.office_properties;
begin
  select * into d from public.office_desks where id = p_desk and archived_at is null;
  if not found then raise exception 'ডেস্ক পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.property.edit', d.property_id) then raise exception 'ডেস্ক বদলানোর অনুমতি নেই' using errcode = '42501'; end if;
  select * into pr from public.office_properties where id = d.property_id;
  if p_package is not null and not exists (select 1 from private.office_packages k where k.id = p_package and k.zone_id = pr.zone_id and k.archived_at is null) then
    raise exception 'এই জোনের প্যাকেজ বাছুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'ডেস্কের প্যাকেজ', true);
  update public.office_desks set package_id = p_package where id = p_desk;
end $$;

-- ---------------------------------------------------------------- responsibility in bulk
-- p_mode: 'items' (the ids given), 'kind' (every item of p_kind), 'all' (everything of the place). Items that sit on a desk follow the desk's
-- own set, so they are left out. p_employee null takes the responsibility away. Returns how many items changed.
create function public.office_assign_assets(p_property uuid, p_employee uuid, p_mode text, p_ids uuid[] default null, p_kind text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare p public.office_properties; v_n integer;
begin
  select * into p from public.office_properties where id = p_property and archived_at is null;
  if not found then raise exception 'জায়গাটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.asset.edit', p_property) then raise exception 'দায়িত্ব দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('items', 'kind', 'all') then raise exception 'কীভাবে দেবেন, বেছে নিন' using errcode = '22023'; end if;
  if p_mode = 'items' and coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'অন্তত একটা জিনিস বাছুন' using errcode = '22023'; end if;
  if p_mode = 'kind' and nullif(trim(coalesce(p_kind, '')), '') is null then raise exception 'কোন ধরন, বেছে নিন' using errcode = '22023'; end if;
  if p_employee is not null and not exists (
    select 1 from public.employees e where e.id = p_employee and e.status = 'active' and e.archived_at is null
      and (p.hub_id is null or e.hub_id = p.hub_id)
      and (p.zone_id is null or e.zone_id = p.zone_id or (p.hub_id is not null and e.hub_id = p.hub_id))
  ) then raise exception 'এই জায়গার সক্রিয় স্টাফ বাছুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', case when p_employee is null then 'দায়িত্ব সরানো' else 'দায়িত্ব দেওয়া' end ||
    case p_mode when 'items' then ' (বাছাই করা)' when 'kind' then ' (ধরন ধরে)' else ' (সব)' end, true);
  update public.office_assets a set holder_id = p_employee
   where a.property_id = p_property and a.archived_at is null and a.desk_id is null
     and a.holder_id is distinct from p_employee
     and (p_mode = 'all' or (p_mode = 'items' and a.id = any(p_ids)) or (p_mode = 'kind' and a.kind = p_kind));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- a problem report is verified by the hub manager
alter table public.office_notices
  add column hub_verified_by uuid, add column hub_verified_by_name text, add column hub_verified_at timestamptz, add column hub_verify_note text;
create index office_notices_unverified on public.office_notices (hub_id) where hub_verified_at is null and status in ('open', 'seen');

-- Who at the hub hears about a report: the holders of office.notice_verify.approve for the place's hub.
create function private.office_notify_hub_verifiers(p_property uuid, p_title text, p_body text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_hub uuid; u uuid; v_n integer := 0;
begin
  select hub_id into v_hub from public.office_properties where id = p_property;
  if v_hub is null then return 0; end if;
  for u in
    select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id and p.code = 'office.notice_verify.approve'
    where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
      and ur.scope_type = 'hub' and ur.hub_id = v_hub and ur.user_id is distinct from auth.uid()
  loop
    perform private.notify(u, p_title, p_body, '/app/office/notices', 'office');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Same as before, and the hub's verifiers are told too (the count it returns is still the zonal managers who were told).
create or replace function public.office_notice_send(
  p_property uuid, p_kind text, p_title text, p_asset uuid default null, p_item_kind text default null,
  p_quantity integer default 1, p_note text default null, p_urgent boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pr public.office_properties; a public.office_assets; v_id uuid; v_no text; v_n integer; v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_head text;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into pr from public.office_properties where id = p_property and archived_at is null;
  if not found then raise exception 'অফিসটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if p_kind is null or p_kind not in ('broken', 'need', 'other') then raise exception 'ধরন ঠিক নয়' using errcode = '22023'; end if;
  if p_asset is not null then
    select * into a from public.office_assets where id = p_asset and property_id = p_property and archived_at is null;
    if not found then raise exception 'জিনিসটা এই অফিসে পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  if not (private.office_can('office.notice.create', p_property) or (p_asset is not null and private.office_asset_mine(p_asset))) then
    raise exception 'এই অফিসের রিপোর্ট দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  v_title := coalesce(v_title, a.name);
  if v_title is null then raise exception 'কী নষ্ট বা কী লাগবে লিখুন' using errcode = '22023'; end if;
  if coalesce(p_quantity, 0) < 1 then raise exception 'সংখ্যা ঠিক নয়' using errcode = '22023'; end if;
  if p_asset is not null and exists (select 1 from public.office_notices n where n.asset_id = p_asset and n.kind = p_kind and n.status in ('open', 'seen')) then
    raise exception 'এই জিনিসের রিপোর্ট আগেই দেওয়া আছে — উত্তরের অপেক্ষায়' using errcode = '23505'; end if;

  perform set_config('app.change_reason', 'জোনাল ম্যানেজারকে রিপোর্ট', true);
  insert into public.office_notices (property_id, zone_id, hub_id, asset_id, kind, item_kind, title, quantity, note, priority, by_name)
  values (p_property, pr.zone_id, pr.hub_id, p_asset, p_kind, coalesce(nullif(trim(coalesce(p_item_kind, '')), ''), a.kind), v_title, p_quantity,
          nullif(trim(coalesce(p_note, '')), ''), case when p_urgent then 'urgent' else 'normal' end, private.my_display_name())
  returning id, notice_no into v_id, v_no;
  if p_kind = 'broken' and p_asset is not null and a.condition in ('good', 'repair') then
    update public.office_assets set condition = 'broken' where id = p_asset;
  end if;
  v_head := case p_kind when 'broken' then 'নষ্ট হয়েছে: ' when 'need' then 'লাগবে: ' else 'অফিস রিপোর্ট: ' end || v_title
      || case when p_quantity > 1 then ' ×' || p_quantity else '' end || case when p_urgent then ' (জরুরি)' else '' end;
  v_n := private.office_notify_managers(p_property, v_head, v_no || ' · ' || pr.name || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  perform private.office_notify_hub_verifiers(p_property, v_head || ' — যাচাই করুন', v_no || ' · ' || pr.name || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  return jsonb_build_object('id', v_id, 'no', v_no, 'notified', v_n);
end $$;

create function public.office_notice_verify(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare n public.office_notices; v_name text := private.my_display_name();
begin
  select * into n from public.office_notices where id = p_id;
  if not found then raise exception 'রিপোর্টটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.notice_verify.approve', n.property_id) then raise exception 'রিপোর্ট যাচাইয়ের অনুমতি নেই' using errcode = '42501'; end if;
  if n.status in ('done', 'rejected') then raise exception 'এই রিপোর্টের কাজ আগেই শেষ' using errcode = '22023'; end if;
  if n.hub_verified_at is not null then raise exception 'আগেই যাচাই হয়েছে (%)', coalesce(n.hub_verified_by_name, '—') using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'হাব ম্যানেজারের যাচাই ' || n.notice_no, true);
  update public.office_notices set hub_verified_by = auth.uid(), hub_verified_by_name = v_name, hub_verified_at = now(),
         hub_verify_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  perform private.notify(n.created_by, n.notice_no || ': ' || coalesce(v_name, 'হাব ম্যানেজার') || ' যাচাই করেছেন', n.title, '/app/office/notices', 'office');
  perform private.office_notify_managers(n.property_id, n.notice_no || ': ' || coalesce(v_name, 'হাব ম্যানেজার') || ' যাচাই করেছেন', n.title);
end $$;

-- ---------------------------------------------------------------- a loan keeps both hubs and an optional person on each side
alter table public.office_asset_loans
  add column from_person_id uuid references public.employees(id), add column to_person_id uuid references public.employees(id);
create index office_asset_loans_from_person on public.office_asset_loans (from_person_id) where from_person_id is not null;
create index office_asset_loans_to_person on public.office_asset_loans (to_person_id) where to_person_id is not null;

drop function public.office_lend(uuid, uuid, integer, text);
create function public.office_lend(p_asset uuid, p_to uuid, p_quantity integer default 1, p_note text default null,
                                   p_from_person uuid default null, p_to_person uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.office_assets; v_out integer; v_id uuid; pf public.office_properties; pt public.office_properties;
begin
  select * into a from public.office_assets where id = p_asset and archived_at is null;
  if not found then raise exception 'জিনিসটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.asset.edit', a.property_id) then raise exception 'এই অফিসের জিনিস অন্য জায়গায় দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  select * into pf from public.office_properties where id = a.property_id;
  select * into pt from public.office_properties where id = p_to and archived_at is null;
  if p_to is null or p_to = a.property_id or not found then raise exception 'কোন অফিসে দেবেন, বেছে নিন' using errcode = '22023'; end if;
  if coalesce(p_quantity, 0) < 1 then raise exception 'কয়টা দেবেন লিখুন' using errcode = '22023'; end if;
  -- Each side's person, when given, is an active member of that side's hub.
  if p_from_person is not null and not exists (select 1 from public.employees e where e.id = p_from_person and e.status = 'active' and e.archived_at is null
        and (pf.hub_id is null or e.hub_id = pf.hub_id)) then raise exception 'যে হাব দিচ্ছে তার সক্রিয় স্টাফ বাছুন' using errcode = '22023'; end if;
  if p_to_person is not null and not exists (select 1 from public.employees e where e.id = p_to_person and e.status = 'active' and e.archived_at is null
        and (pt.hub_id is null or e.hub_id = pt.hub_id)) then raise exception 'যে হাব নিচ্ছে তার সক্রিয় স্টাফ বাছুন' using errcode = '22023'; end if;
  select coalesce(sum(quantity), 0) into v_out from public.office_asset_loans where asset_id = a.id and returned_at is null;
  if v_out + p_quantity > a.quantity then
    raise exception 'এই জিনিস আছে %টা, এর মধ্যে %টা আগেই অন্য জায়গায় দেওয়া', a.quantity, v_out using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'অন্য অফিসে ব্যবহারের জন্য দেওয়া', true);
  insert into public.office_asset_loans (asset_id, from_property_id, to_property_id, quantity, note, from_person_id, to_person_id)
  values (a.id, a.property_id, p_to, p_quantity, nullif(trim(coalesce(p_note, '')), ''), p_from_person, p_to_person) returning id into v_id;
  return v_id;
end $$;

drop function public.office_loan_list(boolean);
create function public.office_loan_list(p_open_only boolean default true)
returns table (id uuid, asset_id uuid, asset_kind text, asset_name text, quantity integer, since date, note text, returned_at timestamptz,
               from_property_id uuid, from_name text, from_hub_id uuid, to_property_id uuid, to_name text, to_hub_id uuid, can_return boolean,
               from_hub_name text, to_hub_name text, from_person text, to_person text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.asset_id, a.kind, a.name, l.quantity, l.since, l.note, l.returned_at,
         l.from_property_id, f.name, f.hub_id, l.to_property_id, t.name, t.hub_id,
         private.office_can('office.asset.edit', l.from_property_id) or private.office_can('office.asset.edit', l.to_property_id),
         private.hub_name(f.hub_id), private.hub_name(t.hub_id), private.emp_name(l.from_person_id), private.emp_name(l.to_person_id)
  from public.office_asset_loans l
  join public.office_assets a on a.id = l.asset_id
  join public.office_properties f on f.id = l.from_property_id
  join public.office_properties t on t.id = l.to_property_id
  where (not p_open_only or l.returned_at is null)
    and (private.office_can('office.asset.view', l.from_property_id) or private.office_can('office.asset.view', l.to_property_id))
  order by l.returned_at nulls first, l.since desc
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.office_package_save(uuid, text, jsonb, text, uuid)', 'public.office_package_archive(uuid, text)', 'public.office_package_list(uuid)',
    'public.office_desk_package_set(uuid, uuid)', 'public.office_assign_assets(uuid, uuid, text, uuid[], text)',
    'public.office_notice_send(uuid, text, text, uuid, text, integer, text, boolean)', 'public.office_notice_verify(uuid, text)',
    'public.office_lend(uuid, uuid, integer, text, uuid, uuid)', 'public.office_loan_list(boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.office_notify_hub_verifiers(uuid, text, text) from public, anon, authenticated;
