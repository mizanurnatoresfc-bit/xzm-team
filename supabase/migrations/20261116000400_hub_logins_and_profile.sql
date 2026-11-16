-- =====================================================================
--  A hub sets up its own people
--
--  1. Logins. Someone holding system.user_hub.create at a hub (the hub
--     manager) may make the login of a rider / plain staff member of that
--     hub: the login ID is the Employee ID (id-<code>@xzmteam.com), the role
--     is the one that belongs to the person's post and only 'rider' or
--     'staff', at that hub. They may also reset the password of, and unlock,
--     such a login. Nothing else about accounts or roles opens up: the same
--     four steps the admin flow uses each get one narrow extra way in.
--
--  2. Profiles. hr.employee_profile.edit lets the hub fill in a person's
--     contact and identity details (mobile, Bangla name, email, emergency
--     contact, alternative mobile, blood group, NID, date of birth, parents,
--     addresses) through one function. It cannot change status, post, hub,
--     Employee ID or pay, and it never shows identity details back: only
--     whether each one is on file.
--
--  Rollback: re-run private.guard_user_role from 20261111000100_foundation.sql,
--  user_admin_precheck, user_admin_assign_role,
--  user_admin_finish_create, user_admin_can_manage from
--  20261113001500_user_admin.sql and hr_link_login from
--  20261111000300_hr_core.sql; drop hub_login_list, hr_hub_profile_get,
--  hr_hub_profile_save and the private.hub_login_* helpers; take the two
--  permissions off the roles.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('system.user_hub.create',     'system', 'user_hub',         'create', 'Make and reset the logins of riders and plain staff of one''s own hub'),
  ('hr.employee_profile.edit',   'hr',     'employee_profile', 'edit',   'Fill in contact and identity details of staff (not status, post, hub, ID or pay)')
on conflict (code) do nothing;

-- The hub manager gets both. So does every role that may hand out roles: a role can only be given by someone
-- who holds everything in it, so without this an admin could no longer make a hub manager.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('system.user_hub.create', 'hr.employee_profile.edit')
where not r.is_super and (r.code = 'hub_manager' or exists (
  select 1 from public.role_permissions rp join public.permissions q on q.id = rp.permission_id
  where rp.role_id = r.id and q.code = 'system.user_role.create'))
on conflict do nothing;

-- Whoever may edit staff records may also fill profiles; the two extra details of the ID sheet (alternative
-- mobile, blood group) are then tied to the narrower right, so the hub can write them and nobody loses them.
insert into public.role_permissions (role_id, permission_id)
select rp.role_id, (select id from public.permissions where code = 'hr.employee_profile.edit')
from public.role_permissions rp join public.permissions q on q.id = rp.permission_id where q.code = 'hr.employee.edit'
on conflict do nothing;
update public.employee_custom_fields set edit_permission = 'hr.employee_profile.edit'
 where code in ('alt_mobile', 'blood_group') and (edit_permission is null or edit_permission = 'hr.employee.edit');

-- ---------------------------------------------------------------------
--  1. Logins
-- ---------------------------------------------------------------------
-- The only roles a hub may hand out with a login.
create or replace function private.hub_login_role(p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.roles r where r.id = p_role and r.code::text in ('rider', 'staff')
                   and r.status = 'active' and r.archived_at is null and not r.is_super)
$$;

-- May the caller make this login: an active person of a hub they hold the right at, without a login,
-- with an Employee ID, getting the role of their post (rider / staff only) at that hub.
create or replace function private.hub_login_ok(p_employee uuid, p_role uuid, p_scope text, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_scope = 'hub' and private.hub_login_role(p_role) and exists (
    select 1 from public.employees e join public.positions p on p.id = e.position_id
    where e.id = p_employee and e.hub_id = p_hub and e.status = 'active' and e.archived_at is null
      and e.profile_id is null and e.employee_code is not null and p.default_role_id = p_role
      and private.has_permission('system.user_hub.create', e.zone_id, e.hub_id))
$$;

-- A brand-new account (made in the last 10 minutes, never signed in, linked to nobody) that holds nothing
-- but a rider / staff role at this hub so far, at a hub where the caller may make logins.
create or replace function private.hub_login_fresh(p_user uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission('system.user_hub.create', private.hub_zone(p_hub), p_hub)
     and exists (select 1 from public.hubs h where h.id = p_hub and h.archived_at is null and h.status = 'active')
     and exists (select 1 from public.profiles pr where pr.id = p_user and pr.archived_at is null
                   and pr.created_at > now() - interval '10 minutes' and pr.last_login_at is null)
     and not exists (select 1 from public.employees e where e.profile_id = p_user)
     and not exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.revoked_at is null
                       and not (ur.scope_type = 'hub' and ur.hub_id = p_hub and private.hub_login_role(ur.role_id)))
$$;

-- ...and that already has its rider / staff role at a hub of the caller.
create or replace function private.hub_login_mine(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.revoked_at is null
                   and ur.scope_type = 'hub' and private.hub_login_role(ur.role_id) and private.hub_login_fresh(p_user, ur.hub_id))
$$;

-- The guard on role assignments lets that one case through as well (it otherwise asks for the right to hand out roles).
create or replace function private.guard_user_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- Only revocation / end-dating is allowed after creation (keeps history honest).
    if (new.user_id, new.role_id, new.scope_type, new.zone_id, new.hub_id, new.valid_from)
       is distinct from
       (old.user_id, old.role_id, old.scope_type, old.zone_id, old.hub_id, old.valid_from) then
      raise exception 'Role assignments cannot be re-pointed; revoke and create a new one.'
        using errcode = 'P0001';
    end if;
    if old.revoked_at is not null then
      raise exception 'A revoked assignment cannot be changed.' using errcode = 'P0001';
    end if;
    if auth.uid() is not null and new.revoked_at is not null and new.user_id = auth.uid()
       and not private.is_super_admin() then
      raise exception 'You cannot revoke your own role assignments.' using errcode = '42501';
    end if;
    if new.revoked_at is not null then
      new.revoked_by := coalesce(new.revoked_by, auth.uid());
    end if;
    return new;
  end if;

  if auth.uid() is not null and not private.can_assign_role(new.role_id, new.scope_type, new.zone_id, new.hub_id)
     and not (new.scope_type = 'hub' and new.valid_to is null and private.hub_login_role(new.role_id)
              and private.hub_login_fresh(new.user_id, new.hub_id)
              and not exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.revoked_at is null)) then
    raise exception 'Not authorised to assign this role at this scope.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.user_admin_precheck(
  p_email text, p_role uuid, p_scope text, p_zone uuid default null, p_hub uuid default null, p_employee uuid default null
) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_hub boolean := false; v_code text;
begin
  if not private.has_permission('system.user.create') then
    if p_employee is null or not private.hub_login_ok(p_employee, p_role, p_scope, p_hub) then
      raise exception 'Not authorised to create user accounts.' using errcode = '42501';
    end if;
    v_hub := true;
  end if;
  if coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where email = trim(p_email)::extensions.citext) then
    raise exception 'An account with this email already exists.' using errcode = '23505';
  end if;
  if v_hub then
    -- a hub's login is always the person's Employee ID
    select lower(regexp_replace(e.employee_code::text, '[^a-zA-Z0-9]', '', 'g')) into v_code from public.employees e where e.id = p_employee;
    if lower(trim(p_email)) <> 'id-' || v_code || '@xzmteam.com' then
      raise exception 'হাব থেকে শুধু এমপ্লয়ি আইডি দিয়েই লগইন বানানো যায়।' using errcode = '22023';
    end if;
  else
    perform private.check_role_scope(p_role, p_scope, p_zone, p_hub);
  end if;
  if p_employee is not null and not exists (
      select 1 from public.employees e where e.id = p_employee and e.status = 'active'
        and e.archived_at is null and e.profile_id is null) then
    raise exception 'That employee is not active or already has a login.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.user_admin_assign_role(
  p_user uuid, p_role uuid, p_scope text, p_zone uuid default null, p_hub uuid default null,
  p_valid_to date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user and archived_at is null) then
    raise exception 'Account not found.' using errcode = 'P0001';
  end if;
  if p_scope = 'hub' and p_valid_to is null and private.hub_login_role(p_role)
     and not private.can_assign_role(p_role, 'hub', null, p_hub)
     and private.hub_login_fresh(p_user, p_hub)
     and not exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.revoked_at is null) then
    null;  -- a hub giving the rider / staff role to the login it is making right now
  else
    perform private.check_role_scope(p_role, p_scope, p_zone, p_hub);
  end if;
  if exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role_id = p_role
               and ur.scope_type = p_scope and ur.revoked_at is null
               and ur.zone_id is not distinct from case when p_scope = 'zone' then p_zone end
               and ur.hub_id is not distinct from case when p_scope = 'hub' then p_hub end
               and (ur.valid_to is null or ur.valid_to >= current_date)) then
    raise exception 'This account already has that role at that place.' using errcode = '23505';
  end if;
  insert into public.user_roles (user_id, role_id, scope_type, zone_id, hub_id, valid_to)
  values (p_user, p_role, p_scope,
          case when p_scope = 'zone' then p_zone end, case when p_scope = 'hub' then p_hub end, p_valid_to)
  returning id into v;
  return v;
end $$;

create or replace function public.user_admin_finish_create(p_user uuid, p_full_name text, p_phone text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ((private.has_permission('system.user.create') and private.can_manage_user(p_user)) or private.hub_login_mine(p_user)) then
    raise exception 'Not authorised to set up this account.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and created_at > now() - interval '10 minutes'
                 and last_login_at is null) then
    raise exception 'Only a newly created account can be set up this way.' using errcode = 'P0001';
  end if;
  perform set_config('app.change_reason', 'Account created', true);
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         phone = nullif(trim(coalesce(p_phone, '')), ''),
         must_change_password = true,
         preferred_language = 'bn'
   where id = p_user;
end $$;

create or replace function public.hr_link_login(p_employee uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ((private.employee_has_permission('hr.employee.edit', p_employee) and private.has_permission('system.user.edit'))
       or (private.hub_login_mine(p_profile) and exists (
             select 1 from public.employees e join public.user_roles ur
               on ur.user_id = p_profile and ur.revoked_at is null and ur.scope_type = 'hub' and ur.hub_id = e.hub_id
             where e.id = p_employee and e.profile_id is null
               and private.has_permission('system.user_hub.create', e.zone_id, e.hub_id)))) then
    raise exception 'Requires HR edit and user management rights.' using errcode = '42501';
  end if;
  update public.employees set profile_id = p_profile where id = p_employee and status = 'active';
  if not found then raise exception 'Only active employees can be linked to a login.' using errcode = 'P0001'; end if;
end $$;

-- Reset the password of / unlock: also the logins of riders and plain staff of one's own hub.
create or replace function public.user_admin_can_manage(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user <> auth.uid() and (private.can_manage_user(p_user) or exists (
    select 1 from public.employees e
    where e.profile_id = p_user and e.archived_at is null
      and private.has_permission('system.user_hub.create', e.zone_id, e.hub_id)
      and not exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.revoked_at is null
                        and not (ur.scope_type = 'hub' and ur.hub_id = e.hub_id and private.hub_login_role(ur.role_id)))))
$$;

-- The hub's people with where each one's login stands.
create or replace function public.hub_login_list(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, position_name_bn text, mobile text,
               role_id uuid, role_code text, can_make boolean, user_id uuid, login_id text, must_change boolean,
               last_login_at timestamptz, locked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('system.user_hub.create', private.hub_zone(p_hub), p_hub) then
    raise exception 'এই হাবের লগইন বানানোর অনুমতি নেই।' using errcode = '42501';
  end if;
  return query
  select e.id, e.employee_code::text, e.full_name, p.name, p.name_bn, e.mobile::text,
         p.default_role_id, r.code::text,
         (e.profile_id is null and e.employee_code is not null and p.default_role_id is not null and private.hub_login_role(p.default_role_id)),
         e.profile_id, pr.email::text, coalesce(pr.must_change_password, false), pr.last_login_at,
         coalesce(pr.locked_until > now(), false)
  from public.employees e
  left join public.positions p on p.id = e.position_id
  left join public.roles r on r.id = p.default_role_id
  left join public.profiles pr on pr.id = e.profile_id
  where e.hub_id = p_hub and e.archived_at is null and e.status = 'active'
  order by (e.profile_id is not null), p.name nulls last, e.full_name;
end $$;

-- ---------------------------------------------------------------------
--  2. Profiles
-- ---------------------------------------------------------------------
create or replace function private.can_fill_profile(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.employee_has_permission('hr.employee_profile.edit', p_employee)
      or private.employee_has_permission('hr.employee.edit', p_employee)
$$;

-- What is on file: contact details as they are, identity details only as yes / no.
create or replace function public.hr_hub_profile_get(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; s public.employee_sensitive;
begin
  if not private.can_fill_profile(p_employee) then
    raise exception 'এই কর্মীর প্রোফাইল পূর্ণ করার অনুমতি নেই।' using errcode = '42501';
  end if;
  select * into e from public.employees where id = p_employee and archived_at is null;
  if e.id is null then raise exception 'কর্মীকে পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  select * into s from public.employee_sensitive where employee_id = p_employee;
  return jsonb_build_object(
    'full_name', e.full_name, 'employee_code', e.employee_code, 'full_name_bn', e.full_name_bn, 'mobile', e.mobile, 'email', e.email,
    'emergency_contact_name', e.emergency_contact_name, 'emergency_contact_phone', e.emergency_contact_phone,
    'alt_mobile', (select v.value #>> '{}' from public.employee_custom_field_values v join public.employee_custom_fields f on f.id = v.field_id
                   where v.employee_id = p_employee and f.code = 'alt_mobile'),
    -- shown the way people write it (B+), kept the way the field's list has it
    'blood_group', (select coalesce((select o ->> 'label' from jsonb_array_elements(f.options) o where o ->> 'value' = v.value #>> '{}' limit 1), v.value #>> '{}')
                    from public.employee_custom_field_values v join public.employee_custom_fields f on f.id = v.field_id
                    where v.employee_id = p_employee and f.code = 'blood_group'),
    'has', jsonb_build_object('nid_number', s.nid_number is not null, 'date_of_birth', s.date_of_birth is not null,
                              'father_name', s.father_name is not null, 'mother_name', s.mother_name is not null,
                              'present_address', s.present_address is not null, 'permanent_address', s.permanent_address is not null));
end $$;

-- Only the keys sent are touched; an empty identity value never wipes what is on file.
create or replace function public.hr_hub_profile_save(p_employee uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  v_field uuid; k text;
  v text;
begin
  if not private.can_fill_profile(p_employee) then
    raise exception 'এই কর্মীর প্রোফাইল পূর্ণ করার অনুমতি নেই।' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'তথ্য দিন।' using errcode = '22023'; end if;
  select * into e from public.employees where id = p_employee and archived_at is null for update;
  if e.id is null then raise exception 'কর্মীকে পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  perform set_config('app.change_reason', 'হাব থেকে প্রোফাইল পূর্ণ করা', true);

  begin
    update public.employees set
      mobile = case when p ? 'mobile' then nullif(trim(p ->> 'mobile'), '') else mobile end,
      full_name_bn = case when p ? 'full_name_bn' then nullif(trim(p ->> 'full_name_bn'), '') else full_name_bn end,
      email = case when p ? 'email' then nullif(lower(trim(p ->> 'email')), '') else email end,
      emergency_contact_name = case when p ? 'emergency_contact_name' then nullif(trim(p ->> 'emergency_contact_name'), '') else emergency_contact_name end,
      emergency_contact_phone = case when p ? 'emergency_contact_phone' then nullif(trim(p ->> 'emergency_contact_phone'), '') else emergency_contact_phone end
    where id = p_employee;
  exception when unique_violation then
    raise exception 'এই মোবাইল নম্বর অন্য একজন কর্মীর নামে আছে।' using errcode = '23505';
  end;

  if p ?| array['nid_number', 'date_of_birth', 'father_name', 'mother_name', 'present_address', 'permanent_address'] then
    if nullif(trim(p ->> 'date_of_birth'), '') is not null and (p ->> 'date_of_birth')::date > current_date - interval '14 years' then
      raise exception 'জন্মতারিখ ঠিক নয়।' using errcode = '22023';
    end if;
    begin
      insert into public.employee_sensitive (employee_id, nid_number, date_of_birth, father_name, mother_name, present_address, permanent_address)
      values (p_employee, nullif(trim(p ->> 'nid_number'), ''), nullif(trim(p ->> 'date_of_birth'), '')::date, nullif(trim(p ->> 'father_name'), ''),
              nullif(trim(p ->> 'mother_name'), ''), nullif(trim(p ->> 'present_address'), ''), nullif(trim(p ->> 'permanent_address'), ''))
      on conflict (employee_id) do update set
        nid_number = coalesce(excluded.nid_number, public.employee_sensitive.nid_number),
        date_of_birth = coalesce(excluded.date_of_birth, public.employee_sensitive.date_of_birth),
        father_name = coalesce(excluded.father_name, public.employee_sensitive.father_name),
        mother_name = coalesce(excluded.mother_name, public.employee_sensitive.mother_name),
        present_address = coalesce(excluded.present_address, public.employee_sensitive.present_address),
        permanent_address = coalesce(excluded.permanent_address, public.employee_sensitive.permanent_address),
        updated_at = now(), updated_by = auth.uid();
    exception when unique_violation then
      raise exception 'এই NID নম্বর অন্য একজন কর্মীর নামে আছে।' using errcode = '23505';
    end;
  end if;

  foreach k in array array['alt_mobile', 'blood_group'] loop
    if p ? k then
      v := nullif(trim(p ->> k), '');
      -- a field with a list accepts the label people write (B+) as well as the list's own value
      select f.id, coalesce((select o ->> 'value' from jsonb_array_elements(case when jsonb_typeof(f.options) = 'array' then f.options else '[]'::jsonb end) o
                              where o ->> 'label' = v or o ->> 'value' = v limit 1), v)
        into v_field, v from public.employee_custom_fields f where f.code = k and f.archived_at is null;
      if v_field is not null and v is not null then   -- an empty value leaves what is on file
        insert into public.employee_custom_field_values (employee_id, field_id, value) values (p_employee, v_field, to_jsonb(v))
        on conflict (employee_id, field_id) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
      end if;
    end if;
  end loop;
end $$;

revoke all on function private.hub_login_role(uuid), private.hub_login_ok(uuid, uuid, text, uuid), private.hub_login_fresh(uuid, uuid),
  private.hub_login_mine(uuid), private.can_fill_profile(uuid) from public, anon;
revoke all on function public.user_admin_precheck(text, uuid, text, uuid, uuid, uuid), public.user_admin_assign_role(uuid, uuid, text, uuid, uuid, date),
  public.user_admin_finish_create(uuid, text, text), public.hr_link_login(uuid, uuid), public.user_admin_can_manage(uuid),
  public.hub_login_list(uuid), public.hr_hub_profile_get(uuid), public.hr_hub_profile_save(uuid, jsonb) from public, anon;
grant execute on function public.user_admin_precheck(text, uuid, text, uuid, uuid, uuid), public.user_admin_assign_role(uuid, uuid, text, uuid, uuid, date),
  public.user_admin_finish_create(uuid, text, text), public.hr_link_login(uuid, uuid), public.user_admin_can_manage(uuid),
  public.hub_login_list(uuid), public.hr_hub_profile_get(uuid), public.hr_hub_profile_save(uuid, jsonb) to authenticated;
