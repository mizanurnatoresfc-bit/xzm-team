-- XZM-TEAM: ইউজার ও রোল আপডেট। Supabase -> SQL Editor -> New query -> পুরোটা পেস্ট করে Run চাপুন। দুবার চালালেও সমস্যা নেই।
begin;
-- =====================================================================
-- XZM-TEAM ERP — Migration 0015: staff login accounts and role assignment
--
--  * profiles.must_change_password: set when an admin creates an account or resets a
--    password. While it is set the account holds NO permissions (my_grants), so the
--    temporary password only opens the "change your password" screen.
--  * Account management functions for the Users page. Creating an auth user needs the
--    service key, so that single step runs in the admin-users Edge Function; every
--    other step runs as the signed-in admin and is checked here.
--  * An admin may manage an account only if they could grant every role it holds
--    (so nobody can lock out, reset or take over a Super Admin unless they are one).
-- =====================================================================

alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- Grants: unchanged, except that an account waiting for a password change holds none.
create or replace function private.my_grants()
returns table (permission_code text, scope_type text, zone_id uuid, hub_id uuid, is_super boolean)
language sql stable security definer set search_path = '' as $$
  select p.code, ur.scope_type, ur.zone_id, ur.hub_id, r.is_super
  from public.user_roles ur
  join public.profiles pr on pr.id = ur.user_id
  join public.roles r on r.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = r.id
  left join public.permissions p on p.id = rp.permission_id
  where ur.user_id = auth.uid()
    and ur.revoked_at is null
    and ur.valid_from <= current_date
    and (ur.valid_to is null or ur.valid_to >= current_date)
    and r.status = 'active' and r.archived_at is null
    and pr.status = 'active' and pr.archived_at is null
    and not pr.must_change_password
    and (pr.locked_until is null or pr.locked_until < now())
$$;

-- The password flag joins the fields only user managers may change.
create or replace function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$   -- invoker: current_user reveals direct API writes
begin
  if new.id <> old.id then
    raise exception 'Profile id cannot be changed.' using errcode = 'P0001';
  end if;
  if auth.uid() is null then return new; end if;  -- server-side / service_role
  if current_user not in ('authenticated','anon') then return new; end if;  -- inside audited workflow functions
  if (new.status, new.failed_login_count, new.locked_until, new.archived_at, new.email, new.last_login_at, new.must_change_password)
     is distinct from
     (old.status, old.failed_login_count, old.locked_until, old.archived_at, old.email, old.last_login_at, old.must_change_password)
     and not private.can_manage_user(new.id) then
    raise exception 'Not authorised to change account status fields.' using errcode = '42501';
  end if;
  if new.id = auth.uid() and new.status <> old.status then
    raise exception 'Users cannot change their own account status.' using errcode = '42501';
  end if;
  return new;
end $$;

-- May the caller manage this account (status, unlock, password reset)?
-- Needs company-wide user-edit rights and the right to grant every role the account holds.
create or replace function private.can_manage_user(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_user is null then return false; end if;
  if private.is_super_admin() then return true; end if;
  if not private.has_permission('system.user.edit') then return false; end if;
  return not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user and ur.revoked_at is null
      and (ur.valid_to is null or ur.valid_to >= current_date)
      and not private.can_assign_role(ur.role_id, ur.scope_type, ur.zone_id, ur.hub_id));
end $$;

create or replace function public.user_admin_can_manage(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_manage_user(p_user) and p_user <> auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Lists for the Users page (company-wide user managers only)
-- ---------------------------------------------------------------------
create or replace function public.user_admin_list()
returns table (id uuid, full_name text, email text, phone text, status text, archived_at timestamptz,
               locked boolean, locked_until timestamptz, failed_login_count integer, last_login_at timestamptz,
               must_change_password boolean, created_at timestamptz,
               employee_id uuid, employee_code text, roles jsonb, can_manage boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('system.user.view') then
    raise exception 'Not authorised to view user accounts.' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, p.email::text, p.phone, p.status, p.archived_at,
         (p.locked_until is not null and p.locked_until > now()), p.locked_until, p.failed_login_count, p.last_login_at,
         p.must_change_password, p.created_at,
         e.id, e.employee_code::text,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', ur.id, 'role_id', r.id, 'code', r.code::text, 'name', r.name, 'name_bn', r.name_bn,
                     'is_super', r.is_super, 'scope_type', ur.scope_type,
                     'zone_id', ur.zone_id, 'hub_id', ur.hub_id, 'zone', z.name, 'hub', h.name,
                     'valid_from', ur.valid_from, 'valid_to', ur.valid_to) order by r.is_super desc, r.name)
                   from public.user_roles ur join public.roles r on r.id = ur.role_id
                   left join public.zones z on z.id = ur.zone_id
                   left join public.hubs h on h.id = ur.hub_id
                   where ur.user_id = p.id and ur.revoked_at is null
                     and (ur.valid_to is null or ur.valid_to >= current_date)), '[]'::jsonb),
         private.can_manage_user(p.id) and p.id <> auth.uid()
  from public.profiles p
  left join public.employees e on e.profile_id = p.id
  order by p.archived_at nulls first, p.full_name, p.email;
end $$;

-- Roles the caller may hand out at a given scope (drives the role dropdown).
create or replace function public.user_admin_assignable_roles(p_scope text, p_zone uuid default null, p_hub uuid default null)
returns table (id uuid, code text, name text, name_bn text, is_super boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code::text, r.name, r.name_bn, r.is_super
  from public.roles r
  where r.status = 'active' and r.archived_at is null
    and (not r.is_super or p_scope = 'global')
    and private.can_assign_role(r.id, p_scope,
          case when p_scope = 'zone' then p_zone end, case when p_scope = 'hub' then p_hub end)
  order by r.is_super desc, r.name
$$;

-- Active employees without a login (for "link to employee" when creating an account).
create or replace function public.user_admin_unlinked_employees()
returns table (id uuid, employee_code text, full_name text, mobile text, email text, zone_id uuid, hub_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('system.user.create') then
    raise exception 'Not authorised to create user accounts.' using errcode = '42501';
  end if;
  return query
  select e.id, e.employee_code::text, e.full_name, e.mobile, e.email::text, e.zone_id, e.hub_id
  from public.employees e
  where e.status = 'active' and e.archived_at is null and e.profile_id is null
  order by e.employee_code;
end $$;

-- ---------------------------------------------------------------------
-- Checks used by the admin-users Edge Function (called with the admin's own token)
-- ---------------------------------------------------------------------
create or replace function public.user_admin_precheck(
  p_email text, p_role uuid, p_scope text, p_zone uuid default null, p_hub uuid default null, p_employee uuid default null
) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('system.user.create') then
    raise exception 'Not authorised to create user accounts.' using errcode = '42501';
  end if;
  if coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where email = trim(p_email)::extensions.citext) then
    raise exception 'An account with this email already exists.' using errcode = '23505';
  end if;
  perform private.check_role_scope(p_role, p_scope, p_zone, p_hub);
  if p_employee is not null and not exists (
      select 1 from public.employees e where e.id = p_employee and e.status = 'active'
        and e.archived_at is null and e.profile_id is null) then
    raise exception 'That employee is not active or already has a login.' using errcode = 'P0001';
  end if;
end $$;

-- Validates a role + scope pair and the caller's right to grant it.
create or replace function private.check_role_scope(p_role uuid, p_scope text, p_zone uuid, p_hub uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_scope not in ('global','zone','hub') then
    raise exception 'Scope must be global, zone or hub.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.roles where id = p_role and status = 'active' and archived_at is null) then
    raise exception 'Role not found or inactive.' using errcode = 'P0001';
  end if;
  if p_scope <> 'global' and exists (select 1 from public.roles where id = p_role and is_super) then
    raise exception 'Super Admin can only be given for the whole company.' using errcode = '22023';
  end if;
  if p_scope = 'zone' and not exists (select 1 from public.zones where id = p_zone and archived_at is null and status = 'active') then
    raise exception 'Choose an active zone for a zone-level role.' using errcode = '22023';
  end if;
  if p_scope = 'hub' and not exists (select 1 from public.hubs where id = p_hub and archived_at is null and status = 'active') then
    raise exception 'Choose an active hub for a hub-level role.' using errcode = '22023';
  end if;
  if not private.can_assign_role(p_role, p_scope,
        case when p_scope = 'zone' then p_zone end, case when p_scope = 'hub' then p_hub end) then
    raise exception 'Not authorised to assign this role at this scope.' using errcode = '42501';
  end if;
end $$;

-- Second step after the Edge Function created the auth user: contact details and the
-- "change password at first login" flag. Only for accounts that are still brand new.
create or replace function public.user_admin_finish_create(p_user uuid, p_full_name text, p_phone text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('system.user.create') or not private.can_manage_user(p_user) then
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

-- Records a password reset done by an admin (the Edge Function changes the password).
create or replace function public.user_admin_note_reset(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.user_admin_can_manage(p_user) then
    raise exception 'Not authorised to reset this password.' using errcode = '42501';
  end if;
  perform set_config('app.change_reason', 'Password reset by admin', true);
  update public.profiles set must_change_password = true, failed_login_count = 0, locked_until = null where id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Account actions from the Users page
-- ---------------------------------------------------------------------
create or replace function public.user_admin_set_status(p_user uuid, p_active boolean, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user = auth.uid() then
    raise exception 'Users cannot change their own account status.' using errcode = '42501';
  end if;
  if not private.can_manage_user(p_user) then
    raise exception 'Not authorised to change this account.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.profiles set status = case when p_active then 'active' else 'inactive' end
   where id = p_user and archived_at is null;
  if not found then raise exception 'Account not found.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.user_admin_unlock(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.user_admin_can_manage(p_user) then
    raise exception 'Not authorised to change this account.' using errcode = '42501';
  end if;
  perform set_config('app.change_reason', 'Unlocked by admin', true);
  update public.profiles set locked_until = null, failed_login_count = 0 where id = p_user;
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
  perform private.check_role_scope(p_role, p_scope, p_zone, p_hub);
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

create or replace function public.user_admin_revoke_role(p_assignment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.user_roles%rowtype;
  v_super boolean;
begin
  select * into a from public.user_roles where id = p_assignment for update;
  if a.id is null or a.revoked_at is not null then
    raise exception 'Role assignment not found or already removed.' using errcode = 'P0001';
  end if;
  if not private.has_permission('system.user_role.edit', a.zone_id,
           a.hub_id) and not private.is_super_admin() then
    raise exception 'Not authorised to remove role assignments.' using errcode = '42501';
  end if;
  if not private.can_assign_role(a.role_id, a.scope_type, a.zone_id, a.hub_id) then
    raise exception 'Not authorised to remove this role.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  select is_super into v_super from public.roles where id = a.role_id;
  if v_super and not exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
       join public.profiles p on p.id = ur.user_id
       where r.is_super and ur.scope_type = 'global' and ur.revoked_at is null and ur.id <> a.id
         and (ur.valid_to is null or ur.valid_to >= current_date)
         and p.status = 'active' and p.archived_at is null) then
    raise exception 'The last Super Admin cannot be removed.' using errcode = 'P0001';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.user_roles set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where id = a.id;
end $$;

-- The last active Super Admin account cannot be deactivated either.
create or replace function private.guard_last_super_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'active' or new.archived_at is not null then
    if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = new.id and r.is_super and ur.scope_type = 'global' and ur.revoked_at is null)
       and not exists (
         select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
         join public.profiles p on p.id = ur.user_id
         where r.is_super and ur.scope_type = 'global' and ur.revoked_at is null and ur.user_id <> new.id
           and (ur.valid_to is null or ur.valid_to >= current_date)
           and p.status = 'active' and p.archived_at is null) then
      raise exception 'The last Super Admin account cannot be deactivated.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_last_super_guard on public.profiles;
create trigger profiles_last_super_guard before update of status, archived_at on public.profiles
  for each row execute function private.guard_last_super_admin();

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke all on function private.can_manage_user(uuid) from public, anon;
revoke all on function private.check_role_scope(uuid, text, uuid, uuid) from public, anon;
grant execute on function private.can_manage_user(uuid) to authenticated;
grant execute on function private.check_role_scope(uuid, text, uuid, uuid) to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.user_admin_can_manage(uuid)',
    'public.user_admin_list()',
    'public.user_admin_assignable_roles(text, uuid, uuid)',
    'public.user_admin_unlinked_employees()',
    'public.user_admin_precheck(text, uuid, text, uuid, uuid, uuid)',
    'public.user_admin_finish_create(uuid, text, text)',
    'public.user_admin_note_reset(uuid)',
    'public.user_admin_set_status(uuid, boolean, text)',
    'public.user_admin_unlock(uuid)',
    'public.user_admin_assign_role(uuid, uuid, text, uuid, uuid, date)',
    'public.user_admin_revoke_role(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261113001500','user_admin') on conflict (version) do nothing;
commit;
select 'ইউজার ও রোল আপডেট সম্পন্ন' as result;
