-- =====================================================================
-- XZM-TEAM ERP — Migration 0018: zone-level profile fields + referrals
--
--  * Custom profile fields can belong to one zone (zone_id): the Zonal Manager keeps the
--    extra information their zone needs. Company-wide fields (zone_id null) stay with
--    Head Office. Zone fields are optional (never block an application) and apply only
--    to employees of that zone.
--  * Referrals: every employee may have a referrer (employees.referred_by_employee_id,
--    added in 0017). Staff see in their own profile whom they brought and in which
--    position/hub those people now work, and keep a list of "people in hand" (prospects)
--    by position. Prospect columns can be added company-wide or per zone.
-- =====================================================================

-- ---------- zone-level profile fields ----------
alter table public.employee_custom_fields add column if not exists zone_id uuid references public.zones(id);
create index if not exists employee_custom_fields_zone_idx on public.employee_custom_fields (zone_id);
alter table public.employee_custom_fields drop constraint if exists custom_fields_zone_optional;
alter table public.employee_custom_fields add constraint custom_fields_zone_optional check (zone_id is null or not is_required);

drop policy if exists fields_insert on public.employee_custom_fields;
drop policy if exists fields_update on public.employee_custom_fields;
create policy fields_insert on public.employee_custom_fields for insert to authenticated
  with check (private.has_permission('hr.profile_field.configure', zone_id));
create policy fields_update on public.employee_custom_fields for update to authenticated
  using (private.has_permission('hr.profile_field.configure', zone_id))
  with check (private.has_permission('hr.profile_field.configure', zone_id));

-- A zone field only takes values for employees of that zone.
create or replace function private.custom_value_zone_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid;
begin
  select zone_id into v_zone from public.employee_custom_fields where id = new.field_id;
  if v_zone is not null and v_zone is distinct from (select e.zone_id from public.employees e where e.id = new.employee_id) then
    raise exception 'This field belongs to another zone.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists custom_value_zone_guard on public.employee_custom_field_values;
create trigger custom_value_zone_guard before insert or update on public.employee_custom_field_values
  for each row execute function private.custom_value_zone_guard();

-- Starting sections (the company can rename or add more).
insert into public.employee_field_sections (code, name, name_bn, sort_order) values
  ('personal', 'Personal', 'ব্যক্তিগত তথ্য', 10),
  ('job', 'Job', 'চাকরির তথ্য', 20),
  ('other', 'Other', 'অন্যান্য', 90),
  ('zonal', 'Zone information', 'জোনের নিজস্ব তথ্য', 95)
on conflict (code) do nothing;

-- ---------- referrals ----------
insert into public.permissions (code, module, resource, action, description) values
  ('hr.referral.view', 'hr', 'referral', 'view', 'See referrals and people-in-hand lists of staff in your area'),
  ('hr.referral.edit', 'hr', 'referral', 'edit', 'Set who referred an employee; update prospects'),
  ('hr.referral.configure', 'hr', 'referral', 'configure', 'Add columns to the people-in-hand list (company or own zone)')
on conflict (code) do nothing;

-- Default grants (the Super Admin can change them on the Roles page).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code = 'admin' and p.code in ('hr.referral.view','hr.referral.edit','hr.referral.configure'))
  or (r.code = 'hr_manager' and p.code in ('hr.referral.view','hr.referral.edit','hr.referral.configure','hr.profile_field.configure'))
  or (r.code = 'zonal_manager' and p.code in ('hr.referral.view','hr.referral.edit','hr.referral.configure','hr.profile_field.configure'))
  or (r.code in ('head_office_manager','auditor') and p.code = 'hr.referral.view')
  or (r.code = 'hub_manager' and p.code = 'hr.referral.view'))
on conflict do nothing;

-- Extra columns for the people-in-hand list; zone_id null = whole company.
create table public.referral_prospect_columns (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid references public.zones(id),
  code        text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label       text not null check (length(trim(label)) > 0),
  label_bn    text,
  field_type  text not null default 'text' check (field_type in ('text','number','date','dropdown')),
  options     jsonb not null default '[]'::jsonb,
  sort_order  integer not null default 100,
  archived_at timestamptz,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  constraint prospect_columns_options_chk check (field_type <> 'dropdown' or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0))
);
create unique index referral_prospect_columns_code_uq on public.referral_prospect_columns (coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

-- People a staff member can bring in (not yet employees).
create table public.referral_prospects (
  id            uuid primary key default gen_random_uuid(),
  referrer_id   uuid not null references public.employees(id),
  full_name     text not null check (length(trim(full_name)) > 1),
  mobile        text,
  position_id   uuid references public.positions(id),
  area          text,
  note          text,
  status        text not null default 'available' check (status in ('available','contacted','joined','not_interested')),
  extra         jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  joined_employee_id uuid references public.employees(id),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create index referral_prospects_referrer_idx on public.referral_prospects (referrer_id);
create index referral_prospects_position_idx on public.referral_prospects (position_id);
create index referral_prospects_joined_idx on public.referral_prospects (joined_employee_id);

do $$
declare t text;
begin
  foreach t in array array['referral_prospect_columns','referral_prospects'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'hr');
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;

-- Mobile format on prospects follows the company setting.
create or replace function private.prospect_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mobile is not null then
    new.mobile := regexp_replace(regexp_replace(new.mobile, '[^0-9]', '', 'g'), '^(88)?', '');
    if new.mobile !~ private.setting_text('hr.mobile_pattern') then
      raise exception 'Invalid mobile number.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.referrer_id <> old.referrer_id then
    raise exception 'A prospect cannot be moved to another referrer.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger referral_prospects_guard before insert or update on public.referral_prospects
  for each row execute function private.prospect_guard();

alter table public.referral_prospect_columns enable row level security;
alter table public.referral_prospects enable row level security;
revoke all on public.referral_prospect_columns, public.referral_prospects from anon;

create policy prospect_columns_read on public.referral_prospect_columns for select to authenticated
  using (exists (select 1 from private.my_grants()) or exists (select 1 from public.employees e where e.profile_id = auth.uid()));
create policy prospect_columns_insert on public.referral_prospect_columns for insert to authenticated
  with check (private.has_permission('hr.referral.configure', zone_id));
create policy prospect_columns_update on public.referral_prospect_columns for update to authenticated
  using (private.has_permission('hr.referral.configure', zone_id))
  with check (private.has_permission('hr.referral.configure', zone_id));

-- The referrer sees and keeps their own list; managers of the referrer's area see it.
create policy prospects_read on public.referral_prospects for select to authenticated
  using (private.is_self_employee(referrer_id) or private.employee_has_permission('hr.referral.view', referrer_id));
create policy prospects_insert on public.referral_prospects for insert to authenticated
  with check (private.is_self_employee(referrer_id) or private.employee_has_permission('hr.referral.edit', referrer_id));
create policy prospects_update on public.referral_prospects for update to authenticated
  using (private.is_self_employee(referrer_id) or private.employee_has_permission('hr.referral.edit', referrer_id))
  with check (private.is_self_employee(referrer_id) or private.employee_has_permission('hr.referral.edit', referrer_id));

-- ---------- referral functions ----------
-- Name lookup for an Employee ID typed as "reference" (name, position, hub only).
create or replace function public.hr_lookup_employee(p_code text)
returns table (id uuid, employee_code text, full_name text, position_name text, hub_name text, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from private.my_grants()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select e.id, e.employee_code::text, e.full_name, p.name, h.name, e.status
  from public.employees e
  left join public.positions p on p.id = e.position_id
  left join public.hubs h on h.id = e.hub_id
  where e.employee_code = upper(trim(p_code))::extensions.citext and e.archived_at is null
  limit 1;
end $$;

-- Set (or clear with null/'') the referrer of an employee.
create or replace function public.hr_set_referrer(p_employee uuid, p_referrer_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ref uuid;
begin
  if not (private.employee_has_permission('hr.referral.edit', p_employee)
          or private.employee_has_permission('hr.employee.edit', p_employee)
          or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised to change the referrer.' using errcode = '42501';
  end if;
  if coalesce(trim(p_referrer_code), '') <> '' then
    select id into v_ref from public.employees
     where employee_code = upper(trim(p_referrer_code))::extensions.citext and archived_at is null;
    if v_ref is null then raise exception 'Unknown reference ID.' using errcode = 'P0001'; end if;
    if v_ref = p_employee then raise exception 'Employee cannot refer themselves.' using errcode = 'P0001'; end if;
  end if;
  perform set_config('app.change_reason', 'Referrer set', true);
  update public.employees set referred_by_employee_id = v_ref where id = p_employee;
end $$;

-- People this employee brought in (default: the signed-in user's own employee record).
create or replace function public.hr_referrals(p_employee uuid default null)
returns table (id uuid, employee_code text, full_name text, position_name text, hub_name text, zone_name text,
               status text, joining_date date)
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := coalesce(p_employee, (select e.id from public.employees e where e.profile_id = auth.uid() limit 1));
begin
  if v_emp is null then return; end if;
  if not (private.is_self_employee(v_emp) or private.employee_has_permission('hr.referral.view', v_emp)
          or private.employee_has_permission('hr.employee.view', v_emp)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select e.id, e.employee_code::text, e.full_name, p.name, h.name, z.name, e.status, e.joining_date
  from public.employees e
  left join public.positions p on p.id = e.position_id
  left join public.hubs h on h.id = e.hub_id
  left join public.zones z on z.id = e.zone_id
  where e.referred_by_employee_id = v_emp and e.archived_at is null
  order by e.joining_date desc nulls last, e.full_name;
end $$;

-- Referrer of an employee (name only), for the profile header.
create or replace function public.hr_referrer_of(p_employee uuid)
returns table (id uuid, employee_code text, full_name text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.employee_code::text, r.full_name
  from public.employees e join public.employees r on r.id = e.referred_by_employee_id
  where e.id = p_employee
    and (private.is_self_employee(p_employee) or private.employee_has_permission('hr.employee.view', p_employee)
         or private.employee_has_permission('hr.referral.view', p_employee) or private.is_open_draft_of_caller(p_employee))
$$;

-- The signed-in user's own employee record id (for "My profile").
create or replace function public.my_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e where e.profile_id = auth.uid() and e.archived_at is null limit 1
$$;

-- Referral overview for managers: per referrer, how many brought and their positions.
create or replace function public.hr_referral_summary(p_zone uuid default null)
returns table (referrer_id uuid, employee_code text, full_name text, hub_name text,
               brought integer, active integer, by_position jsonb, in_hand integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.referral.view' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select r.id, r.employee_code::text, r.full_name, h.name,
         (select count(*)::int from public.employees e where e.referred_by_employee_id = r.id and e.archived_at is null),
         (select count(*)::int from public.employees e where e.referred_by_employee_id = r.id and e.status = 'active' and e.archived_at is null),
         coalesce((select jsonb_object_agg(coalesce(pn, '—'), c) from (
             select p.name pn, count(*) c from public.employees e left join public.positions p on p.id = e.position_id
              where e.referred_by_employee_id = r.id and e.archived_at is null group by p.name) q), '{}'::jsonb),
         (select count(*)::int from public.referral_prospects x where x.referrer_id = r.id and x.archived_at is null and x.status in ('available','contacted'))
  from public.employees r
  left join public.hubs h on h.id = r.hub_id
  where r.archived_at is null
    and (p_zone is null or r.zone_id = p_zone)
    and private.has_permission('hr.referral.view', r.zone_id, r.hub_id)
    and (exists (select 1 from public.employees e where e.referred_by_employee_id = r.id)
         or exists (select 1 from public.referral_prospects x where x.referrer_id = r.id and x.archived_at is null))
  order by 5 desc, r.full_name;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.hr_lookup_employee(text)', 'public.hr_set_referrer(uuid, text)',
                           'public.hr_referrals(uuid)', 'public.hr_referrer_of(uuid)', 'public.my_employee_id()',
                           'public.hr_referral_summary(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant select, insert, update on public.referral_prospect_columns, public.referral_prospects to authenticated;

-- Position names are not sensitive: every signed-in staff member may read active ones
-- (needed to say "I have a person for the Rider position").
create policy positions_read_staff on public.positions for select to authenticated
  using (archived_at is null and (exists (select 1 from private.my_grants())
                                  or exists (select 1 from public.employees e where e.profile_id = auth.uid())));
