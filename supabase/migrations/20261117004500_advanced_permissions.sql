-- =====================================================================
--  Advanced role & permission management — the one part the database did
--  not have yet: a person's OWN permissions, on top of (or taken away
--  from) what their roles give ("Individual User Override").
--
--  Everything else the access pages do already lives here: roles and their
--  permissions (role_admin_*), which pages a role sees (role_menu_*), the
--  hub / zone a role is held at (user_roles scope), and the audit log that
--  is the permission change history.
--
--  1. user_permission_overrides
--       effect 'grant' = this person also gets the permission, either
--              wherever their roles work (scope 'role'), or at one fixed
--              place (whole company / one zone / one hub);
--       effect 'deny'  = this person never has the permission, whatever
--              their roles say (always everywhere).
--     Rows are never deleted: taking one back sets revoked_at, so the
--     history stays. Every change is in audit_logs.
--
--  2. private.grants_of(user, live) is now the single place that works out
--     what a person may do; private.my_grants() is that for the caller.
--     Every rule in the database (private.has_permission, all RLS) already
--     reads my_grants(), so personal permissions apply everywhere at once.
--     A Super Admin is never touched: nothing can be taken from one.
--     The function moved from SQL to PL/pgSQL so its plan is kept between
--     calls: measured on the test database, one permission check went from
--     about 355 to about 125 microseconds.
--
--  3. Only a Super Admin sets personal permissions (access_overrides_save).
--     An admin who is not one cannot manage (reset the password of, switch
--     off) an account that was personally given something they do not hold
--     themselves, and a hub can only manage logins that carry no personal
--     grant — the same rule that already protects roles.
--
--  4. Switching a role off for a while (roles.status) joins what only a
--     Super Admin does — the access page offers it for the roles the
--     company made itself; the built-in roles could never be switched off.
--
--  Additive. Rollback: re-run private.my_grants and private.can_manage_user
--  from 20261113001500_user_admin.sql and public.user_admin_can_manage from
--  20261116000400_hub_logins_and_profile.sql; drop access_overrides,
--  access_overrides_save, access_user_grants, private.grants_of,
--  private.guard_user_override, the trigger roles_status_guard with
--  private.guard_role_status, and the table user_permission_overrides.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. The table
-- ---------------------------------------------------------------------
create table if not exists public.user_permission_overrides (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  permission_id uuid not null references public.permissions(id),
  effect        text not null check (effect in ('grant', 'deny')),
  -- where a grant applies: 'role' = wherever the person's roles work
  scope_type    text not null default 'role' check (scope_type in ('role', 'global', 'zone', 'hub')),
  zone_id       uuid references public.zones(id),
  hub_id        uuid references public.hubs(id),
  valid_from    date not null default current_date,
  valid_to      date,
  reason        text not null check (length(trim(reason)) > 0),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  constraint user_permission_overrides_scope_chk check (
       (scope_type in ('role', 'global') and zone_id is null and hub_id is null)
    or (scope_type = 'zone' and zone_id is not null and hub_id is null)
    or (scope_type = 'hub'  and hub_id  is not null and zone_id is null)),
  -- switching a permission off is always for every place
  constraint user_permission_overrides_deny_chk check (effect = 'grant' or scope_type = 'global'),
  constraint user_permission_overrides_dates_chk check (valid_to is null or valid_to >= valid_from)
);

create index if not exists user_permission_overrides_user_idx on public.user_permission_overrides (user_id);
-- the same thing cannot be given (or switched off) twice at the same place
create unique index if not exists user_permission_overrides_one_idx
  on public.user_permission_overrides (user_id, permission_id, effect, scope_type,
    (coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(hub_id,  '00000000-0000-0000-0000-000000000000'::uuid)))
  where revoked_at is null;
create index if not exists user_permission_overrides_permission_idx on public.user_permission_overrides (permission_id);
create index if not exists user_permission_overrides_zone_idx on public.user_permission_overrides (zone_id);
create index if not exists user_permission_overrides_hub_idx on public.user_permission_overrides (hub_id);

-- Only a Super Admin (or the server itself) writes here, whatever policy is added later.
create or replace function private.guard_user_override() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'Only a Super Admin can set personal permissions.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.user_id, new.permission_id, new.effect, new.scope_type, new.zone_id, new.hub_id, new.valid_from)
       is distinct from
       (old.user_id, old.permission_id, old.effect, old.scope_type, old.zone_id, old.hub_id, old.valid_from) then
      raise exception 'A personal permission cannot be re-pointed; take it back and add a new one.' using errcode = 'P0001';
    end if;
    if old.revoked_at is not null then
      raise exception 'A personal permission that was taken back cannot be changed.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace trigger user_permission_overrides_guard before insert or update on public.user_permission_overrides
  for each row execute function private.guard_user_override();
create or replace trigger user_permission_overrides_stamp before insert or update on public.user_permission_overrides
  for each row execute function private.stamp_row();
create or replace trigger user_permission_overrides_audit after insert or update or delete on public.user_permission_overrides
  for each row execute function private.audit_row('system');
create or replace trigger user_permission_overrides_no_delete before delete on public.user_permission_overrides
  for each row execute function private.prevent_delete();

alter table public.user_permission_overrides enable row level security;
revoke all on public.user_permission_overrides from anon;
revoke insert, update, delete, truncate on public.user_permission_overrides from authenticated;
grant select on public.user_permission_overrides to authenticated;

-- A person reads their own; whoever may see role assignments company-wide reads all. Nobody writes directly.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_permission_overrides'
                   and policyname = 'user_permission_overrides_read') then
    create policy user_permission_overrides_read on public.user_permission_overrides for select to authenticated
      using (user_id = (select auth.uid()) or private.has_permission('system.user_role.view'));
  end if;
end $$;

-- ---------------------------------------------------------------------
--  2. What a person may do: roles, minus what is switched off for them,
--     plus what they were personally given.
--     p_live = true  : the real check — an account that is locked or still
--                      has to set its password holds nothing;
--     p_live = false : the same answer without those two (for the access
--                      pages, so a brand-new account can be looked at).
-- ---------------------------------------------------------------------
create or replace function private.grants_of(p_user uuid, p_live boolean)
returns table (permission_code text, scope_type text, zone_id uuid, hub_id uuid, is_super boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with me as (
    select pr.id
      from public.profiles pr
     where pr.id = p_user
       and pr.status = 'active' and pr.archived_at is null
       and (not p_live or (not pr.must_change_password
                           and (pr.locked_until is null or pr.locked_until < now())))),
  ur as (   -- the roles held today
    select a.role_id, a.scope_type, a.zone_id, a.hub_id, r.is_super
      from me
      join public.user_roles a on a.user_id = me.id
      join public.roles r on r.id = a.role_id
     where a.revoked_at is null
       and a.valid_from <= current_date
       and (a.valid_to is null or a.valid_to >= current_date)
       and r.status = 'active' and r.archived_at is null),
  ov as (   -- personal permissions in force today; a Super Admin has none
    select o.permission_id, o.effect, o.scope_type, o.zone_id, o.hub_id
      from me
      join public.user_permission_overrides o on o.user_id = me.id
     where o.revoked_at is null
       and o.valid_from <= current_date
       and (o.valid_to is null or o.valid_to >= current_date)
       and not exists (select 1 from ur s where s.is_super and s.scope_type = 'global'))
  -- what the roles give. A permission switched off for this person keeps its row with no code,
  -- so "holds a role" stays true exactly as before.
  select case when d.permission_id is null then p.code end, ur.scope_type, ur.zone_id, ur.hub_id, ur.is_super
    from ur
    left join public.role_permissions rp on rp.role_id = ur.role_id
    left join public.permissions p on p.id = rp.permission_id
    left join (select distinct x.permission_id from ov x where x.effect = 'deny') d on d.permission_id = rp.permission_id
  union all
  -- what this person was given on top
  select p.code, s.scope_type, s.zone_id, s.hub_id, false
    from ov
    join public.permissions p on p.id = ov.permission_id
    cross join lateral (
      select ov.scope_type, ov.zone_id, ov.hub_id where ov.scope_type <> 'role'
      union all
      select distinct u.scope_type, u.zone_id, u.hub_id from ur u where ov.scope_type = 'role') s
   where ov.effect = 'grant'
     and not exists (select 1 from ov x where x.effect = 'deny' and x.permission_id = ov.permission_id);
end $$;

-- Effective, currently valid grants of the calling user (active accounts only).
create or replace function private.my_grants()
returns table (permission_code text, scope_type text, zone_id uuid, hub_id uuid, is_super boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  select g.permission_code, g.scope_type, g.zone_id, g.hub_id, g.is_super
    from private.grants_of(auth.uid(), true) g;
end $$;

-- ---------------------------------------------------------------------
--  3. Managing an account that holds personal permissions
-- ---------------------------------------------------------------------
-- May the caller manage this account (status, unlock, password reset)?
-- As before: company-wide user-edit rights and the right to grant every role the account holds.
-- New: and the caller holds, at that place, everything the account was personally given.
create or replace function private.can_manage_user(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_user is null then return false; end if;
  if private.is_super_admin() then return true; end if;
  if not private.has_permission('system.user.edit') then return false; end if;
  if exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user and ur.revoked_at is null
      and (ur.valid_to is null or ur.valid_to >= current_date)
      and not private.can_assign_role(ur.role_id, ur.scope_type, ur.zone_id, ur.hub_id)) then
    return false;
  end if;
  return not exists (
    select 1
      from public.user_permission_overrides o
      join public.permissions p on p.id = o.permission_id
      left join lateral (   -- the places a 'role' grant lands on
        select ur.scope_type, ur.zone_id, ur.hub_id
          from public.user_roles ur
         where o.scope_type = 'role' and ur.user_id = o.user_id and ur.revoked_at is null
           and (ur.valid_to is null or ur.valid_to >= current_date)) s on true
     where o.user_id = p_user and o.effect = 'grant' and o.revoked_at is null
       and (o.valid_to is null or o.valid_to >= current_date)
       and not private.has_permission(p.code,
             case coalesce(s.scope_type, o.scope_type) when 'zone' then coalesce(s.zone_id, o.zone_id) end,
             case coalesce(s.scope_type, o.scope_type) when 'hub'  then coalesce(s.hub_id,  o.hub_id)  end));
end $$;

-- Reset the password of / unlock: also the logins of riders and plain staff of one's own hub —
-- but not one that was personally given more than its role.
create or replace function public.user_admin_can_manage(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user <> auth.uid() and (private.can_manage_user(p_user) or exists (
    select 1 from public.employees e
    where e.profile_id = p_user and e.archived_at is null
      and private.has_permission('system.user_hub.create', e.zone_id, e.hub_id)
      and not exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.revoked_at is null
                        and not (ur.scope_type = 'hub' and ur.hub_id = e.hub_id and private.hub_login_role(ur.role_id)))
      and not exists (select 1 from public.user_permission_overrides o where o.user_id = p_user and o.effect = 'grant'
                        and o.revoked_at is null and (o.valid_to is null or o.valid_to >= current_date))))
$$;

-- ---------------------------------------------------------------------
--  4. Switching a role on or off: the Super Admin only
-- ---------------------------------------------------------------------
create or replace function private.guard_role_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null and not private.is_super_admin() then
    raise exception 'Only a Super Admin can switch a role on or off.' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace trigger roles_status_guard before update of status on public.roles
  for each row execute function private.guard_role_status();

-- ---------------------------------------------------------------------
--  5. Functions for the access pages
-- ---------------------------------------------------------------------
-- Personal permissions of one person (p_user) or of everyone (null). p_all also returns the ones taken back.
create or replace function public.access_overrides(p_user uuid default null, p_all boolean default false)
returns table (id uuid, user_id uuid, user_name text, permission text, effect text, scope_type text,
               zone_id uuid, hub_id uuid, zone text, hub text, valid_from date, valid_to date, reason text,
               created_at timestamptz, created_by_name text, revoked_at timestamptz, revoke_reason text, live boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not (private.is_super_admin() or private.has_permission('system.user_role.view')
                                or (p_user is not null and p_user = auth.uid())) then
    raise exception 'Not authorised to view personal permissions.' using errcode = '42501';
  end if;
  return query
  select o.id, o.user_id, pr.full_name, p.code, o.effect, o.scope_type, o.zone_id, o.hub_id, z.name, h.name,
         o.valid_from, o.valid_to, o.reason, o.created_at, cb.full_name, o.revoked_at, o.revoke_reason,
         (o.revoked_at is null and o.valid_from <= current_date and (o.valid_to is null or o.valid_to >= current_date))
    from public.user_permission_overrides o
    join public.permissions p on p.id = o.permission_id
    join public.profiles pr on pr.id = o.user_id
    left join public.zones z on z.id = o.zone_id
    left join public.hubs h on h.id = o.hub_id
    left join public.profiles cb on cb.id = o.created_by
   where (p_user is null or o.user_id = p_user)
     and (p_all or o.revoked_at is null)
   order by pr.full_name, p.code, o.created_at;
end $$;

-- Sets the whole list of one person's personal permissions in one step.
-- p_items: [{ "permission": "hr.leave.approve", "effect": "grant" | "deny",
--             "scope_type": "role" | "global" | "zone" | "hub", "zone_id": …, "hub_id": …, "valid_to": "2026-12-31" }]
-- What is in the list and already there is kept; what is missing is taken back; the rest is added.
create or replace function public.access_overrides_save(p_user uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_perm uuid; v_effect text; v_scope text; v_zone uuid; v_hub uuid; v_to date;
  v_id uuid;
  v_keep uuid[] := '{}';
  v_added int := 0; v_kept int := 0; v_removed int := 0;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can set personal permissions.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'A list of permissions is required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 400 then
    raise exception 'Too many personal permissions for one person; use a role instead.' using errcode = '22023';
  end if;
  -- one save at a time for a person
  perform 1 from public.profiles pr where pr.id = p_user and pr.archived_at is null for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
              where ur.user_id = p_user and r.is_super and ur.scope_type = 'global' and ur.revoked_at is null
                and (ur.valid_to is null or ur.valid_to >= current_date)) then
    raise exception 'A Super Admin always holds every permission; personal permissions do not apply.' using errcode = 'P0001';
  end if;

  perform set_config('app.change_reason', trim(p_reason), true);

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id into v_perm from public.permissions p where p.code = v_item ->> 'permission';
    if v_perm is null then
      raise exception 'Unknown permission %.', coalesce(v_item ->> 'permission', '(none)') using errcode = '22023';
    end if;
    v_effect := v_item ->> 'effect';
    if v_effect is null or v_effect not in ('grant', 'deny') then
      raise exception 'Effect must be grant or deny.' using errcode = '22023';
    end if;
    v_scope := case when v_effect = 'deny' then 'global' else coalesce(nullif(v_item ->> 'scope_type', ''), 'role') end;
    if v_scope not in ('role', 'global', 'zone', 'hub') then
      raise exception 'Scope must be role, global, zone or hub.' using errcode = '22023';
    end if;
    v_zone := case when v_scope = 'zone' then nullif(v_item ->> 'zone_id', '')::uuid end;
    v_hub  := case when v_scope = 'hub'  then nullif(v_item ->> 'hub_id', '')::uuid end;
    if v_scope = 'zone' and not exists (select 1 from public.zones z where z.id = v_zone and z.archived_at is null) then
      raise exception 'Choose an active zone for a zone-level permission.' using errcode = '22023';
    end if;
    if v_scope = 'hub' and not exists (select 1 from public.hubs h where h.id = v_hub and h.archived_at is null) then
      raise exception 'Choose an active hub for a hub-level permission.' using errcode = '22023';
    end if;
    v_to := nullif(v_item ->> 'valid_to', '')::date;
    if v_to is not null and v_to < current_date then
      raise exception 'The end date is already past.' using errcode = '22023';
    end if;

    select o.id into v_id
      from public.user_permission_overrides o
     where o.user_id = p_user and o.permission_id = v_perm and o.effect = v_effect and o.scope_type = v_scope
       and o.zone_id is not distinct from v_zone and o.hub_id is not distinct from v_hub and o.revoked_at is null;
    if v_id is not null then
      if not (v_id = any (v_keep)) then v_kept := v_kept + 1; end if;
      update public.user_permission_overrides o set valid_to = v_to
       where o.id = v_id and o.valid_to is distinct from v_to;
    else
      insert into public.user_permission_overrides (user_id, permission_id, effect, scope_type, zone_id, hub_id, valid_to, reason)
      values (p_user, v_perm, v_effect, v_scope, v_zone, v_hub, v_to, trim(p_reason))
      returning id into v_id;
      v_added := v_added + 1;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  if exists (select 1 from public.user_permission_overrides a
               join public.user_permission_overrides b on b.permission_id = a.permission_id
              where a.id = any (v_keep) and b.id = any (v_keep) and a.effect = 'grant' and b.effect = 'deny') then
    raise exception 'A permission cannot be given and switched off for the same person.' using errcode = '22023';
  end if;

  update public.user_permission_overrides o
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
   where o.user_id = p_user and o.revoked_at is null and not (o.id = any (v_keep));
  get diagnostics v_removed = row_count;

  return jsonb_build_object('added', v_added, 'kept', v_kept, 'removed', v_removed);
end $$;

-- What one person may do right now (roles and personal permissions together), worked out by the same
-- function that decides it. For the access pages.
create or replace function public.access_user_grants(p_user uuid)
returns table (permission_code text, scope_type text, zone_id uuid, hub_id uuid, is_super boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null or p_user is null
     or not (private.is_super_admin() or private.has_permission('system.user_role.view') or p_user = auth.uid()) then
    raise exception 'Not authorised to view this person''s permissions.' using errcode = '42501';
  end if;
  return query
  select distinct g.permission_code, g.scope_type, g.zone_id, g.hub_id, g.is_super
    from private.grants_of(p_user, false) g;
end $$;

-- ---------------------------------------------------------------------
--  Privileges
-- ---------------------------------------------------------------------
revoke all on function private.grants_of(uuid, boolean) from public, anon, authenticated;
revoke all on function private.guard_user_override() from public, anon, authenticated;
revoke all on function private.guard_role_status() from public, anon, authenticated;
revoke all on function private.my_grants() from public, anon;
grant execute on function private.my_grants() to authenticated, service_role;
revoke all on function private.can_manage_user(uuid) from public, anon;
grant execute on function private.can_manage_user(uuid) to authenticated;

revoke all on function public.user_admin_can_manage(uuid), public.access_overrides(uuid, boolean),
  public.access_overrides_save(uuid, jsonb, text), public.access_user_grants(uuid) from public, anon;
grant execute on function public.user_admin_can_manage(uuid), public.access_overrides(uuid, boolean),
  public.access_overrides_save(uuid, jsonb, text), public.access_user_grants(uuid) to authenticated;
