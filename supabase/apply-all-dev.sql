-- Generated: every migration in order, for a fresh local database.

-- ===== 20261111000100_foundation.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0001: Foundation
--   * private helper schema (not exposed through the API)
--   * system settings (branding / security configuration)
--   * organisation structure: organizations, zones, hubs, departments, positions
--   * profiles (1:1 with auth.users)
--   * RBAC: roles, permissions, role_permissions, scoped user_roles
--   * audit log (append-only) + generic audit trigger
--   * login attempt tracking + account lockout
--   * RLS on every table
-- Target: Supabase (PostgreSQL 15+). Idempotency: run once via migrations.
-- =====================================================================

-- Supabase keeps extensions in the `extensions` schema; types are referenced fully qualified.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Generic helpers
-- ---------------------------------------------------------------------

-- Stamps updated_at / updated_by and keeps created_* immutable.
create or replace function private.stamp_row() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_at := new.created_at;
    new.updated_by := new.created_by;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- Important records are archived, never deleted (applies even to service_role).
create or replace function private.prevent_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Deleting % records is not allowed. Archive the record instead.', tg_table_name
    using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------
-- 2. Audit log (append-only)
-- ---------------------------------------------------------------------

create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,                       -- auth.users.id (null = system / migration)
  action       text not null,              -- INSERT | UPDATE | ARCHIVE | APPROVE | ...
  module       text not null,              -- org | system | hr | accounts | ...
  table_name   text,
  record_id    text,
  old_data     jsonb,
  new_data     jsonb,
  changed_fields text[],
  reason       text,
  ip_address   text,
  user_agent   text
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_actor_idx  on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_time_idx   on public.audit_logs (occurred_at desc);

create or replace function private.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'Audit log entries cannot be modified or deleted.' using errcode = 'P0001';
end $$;

create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function private.audit_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_immutable();

-- Reads request metadata that PostgREST exposes (null outside API calls).
create or replace function private.request_header(p_name text) returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> p_name
$$;

-- Writes one audit row. SECURITY DEFINER so ordinary users can never write
-- audit_logs directly. Reason for a change: set_config('app.change_reason', '...', true).
create or replace function private.write_audit(
  p_action text, p_module text, p_table text, p_record text,
  p_old jsonb, p_new jsonb, p_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fields text[];
begin
  if p_old is not null and p_new is not null then
    select array_agg(k order by k) into v_fields
    from (select key as k from jsonb_each(p_new)
          except
          select key from jsonb_each(p_old) o where p_new -> o.key = o.value) d
    where k not in ('updated_at', 'updated_by');
  end if;

  insert into public.audit_logs
    (actor_id, action, module, table_name, record_id, old_data, new_data,
     changed_fields, reason, ip_address, user_agent)
  values
    (auth.uid(), p_action, p_module, p_table, p_record, p_old, p_new, v_fields,
     coalesce(p_reason, nullif(current_setting('app.change_reason', true), '')),
     split_part(coalesce(private.request_header('x-forwarded-for'), ''), ',', 1),
     private.request_header('user-agent'));
end $$;

-- Generic row trigger. TG_ARGV[0] = module name.
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_action text := tg_op;
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' then
    if v_old = v_new then return new; end if;
    if (v_old ->> 'archived_at') is null and (v_new ->> 'archived_at') is not null then
      v_action := 'ARCHIVE';
    elsif (v_old ->> 'archived_at') is not null and (v_new ->> 'archived_at') is null then
      v_action := 'RESTORE';
    end if;
  end if;
  perform private.write_audit(v_action, tg_argv[0], tg_table_name,
                              coalesce(v_new ->> 'id', v_old ->> 'id'), v_old, v_new);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- 3. System settings (branding, language, security policy)
-- ---------------------------------------------------------------------

create table public.system_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value       jsonb not null,
  description text,
  is_public   boolean not null default false,  -- readable before login (branding only)
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.system_settings (key, value, description, is_public) values
  ('branding.company_name',   '"XZM-TEAM"',                         'Company name',                  true),
  ('branding.system_title',   '"XZM-TEAM — Management + Accounts ERP"', 'Browser/system title',     true),
  ('branding.logo_path',      'null',                             'Storage path of logo',          true),
  ('branding.favicon_path',   'null',                             'Storage path of favicon',       true),
  ('branding.address',        '""',                               'Company address',               true),
  ('branding.contact_phone',  '""',                               'Public contact phone',          true),
  ('branding.contact_email',  '""',                               'Public contact email',          true),
  ('branding.theme',          '{"primary":"#0F7A3D","primaryDark":"#0A4D27"}', 'Theme colours',   true),
  ('i18n.default_language',   '"en"',                             'Default UI language (en|bn)',   true),
  ('i18n.enabled_languages',  '["en","bn"]',                      'Selectable languages',          true),
  ('security.max_failed_logins', '5',                             'Failed logins before lockout',  false),
  ('security.lockout_minutes',   '30',                            'Lockout duration in minutes',   false),
  ('security.session_idle_minutes', '60',                         'Idle session timeout',          false);

-- ---------------------------------------------------------------------
-- 4. Organisation structure
-- ---------------------------------------------------------------------

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  code          extensions.citext not null unique,
  name          text not null check (length(trim(name)) > 0),
  name_bn       text,
  head_office_address text,
  phone         text,
  email         extensions.citext,
  status        text not null default 'active' check (status in ('active','inactive')),
  archived_at   timestamptz,
  archived_by   uuid,
  archive_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

create table public.zones (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            extensions.citext not null unique,
  name            text not null check (length(trim(name)) > 0),
  name_bn         text,
  address         text,
  phone           text,
  status          text not null default 'active' check (status in ('active','inactive')),
  archived_at     timestamptz,
  archived_by     uuid,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
create index zones_org_idx on public.zones (organization_id);

create table public.hubs (
  id              uuid primary key default gen_random_uuid(),
  zone_id         uuid not null references public.zones(id),
  code            extensions.citext not null unique,
  name            text not null check (length(trim(name)) > 0),
  name_bn         text,
  address         text,
  phone           text,
  email           extensions.citext,
  status          text not null default 'active' check (status in ('active','inactive')),
  archived_at     timestamptz,
  archived_by     uuid,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
create index hubs_zone_idx on public.hubs (zone_id);

create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            extensions.citext not null unique,
  name            text not null check (length(trim(name)) > 0),
  name_bn         text,
  status          text not null default 'active' check (status in ('active','inactive')),
  archived_at     timestamptz,
  archived_by     uuid,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

create table public.positions (
  id              uuid primary key default gen_random_uuid(),
  department_id   uuid references public.departments(id),
  code            extensions.citext not null unique,
  name            text not null check (length(trim(name)) > 0),
  name_bn         text,
  status          text not null default 'active' check (status in ('active','inactive')),
  archived_at     timestamptz,
  archived_by     uuid,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
create index positions_dept_idx on public.positions (department_id);

-- ---------------------------------------------------------------------
-- 5. Profiles (one per auth user)
-- ---------------------------------------------------------------------

create table public.profiles (
  id                 uuid primary key references auth.users(id),
  full_name          text not null default '',
  email              extensions.citext,
  phone              text,
  preferred_language text not null default 'en' check (preferred_language in ('en','bn')),
  status             text not null default 'active' check (status in ('active','inactive')),
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until       timestamptz,
  last_login_at      timestamptz,
  archived_at        timestamptz,
  archived_by        uuid,
  archive_reason     text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);

-- Auto-create a profile when Supabase Auth creates a user.
create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, created_by)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.id)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- 6. RBAC
-- ---------------------------------------------------------------------

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'),  -- module.resource.action
  module      text not null,
  resource    text not null,
  action      text not null check (action in
              ('view','create','edit','archive','delete','approve','reject',
               'export','print','share','configure')),
  description text,
  created_at  timestamptz not null default now()
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  code        extensions.citext not null unique,
  name        text not null,
  name_bn     text,
  description text,
  is_system   boolean not null default false,  -- shipped default; cannot be archived
  is_super    boolean not null default false,  -- implicitly holds every permission
  status      text not null default 'active' check (status in ('active','inactive')),
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id),
  permission_id uuid not null references public.permissions(id),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  primary key (role_id, permission_id)
);
create index role_permissions_perm_idx on public.role_permissions (permission_id);

-- A role assignment always carries a data scope:
--   global = whole company (Head Office)
--   zone   = one zone and all hubs inside it
--   hub    = one hub only
-- A user may hold several assignments (multiple roles / multiple hubs).
-- Rows are never deleted; revocation sets revoked_at (keeps history).
create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id),
  role_id     uuid not null references public.roles(id),
  scope_type  text not null check (scope_type in ('global','zone','hub')),
  zone_id     uuid references public.zones(id),
  hub_id      uuid references public.hubs(id),
  valid_from  date not null default current_date,
  valid_to    date,
  revoked_at  timestamptz,
  revoked_by  uuid,
  revoke_reason text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint user_roles_scope_chk check (
       (scope_type = 'global' and zone_id is null and hub_id is null)
    or (scope_type = 'zone'   and zone_id is not null and hub_id is null)
    or (scope_type = 'hub'    and hub_id  is not null and zone_id is null)),
  constraint user_roles_dates_chk check (valid_to is null or valid_to >= valid_from)
);
create index user_roles_user_idx on public.user_roles (user_id) where revoked_at is null;
-- The same role at the same scope cannot be held twice for overlapping dates.
alter table public.user_roles add constraint user_roles_no_overlap exclude using gist (
  user_id with =, role_id with =, scope_type with =,
  (coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
  (coalesce(hub_id,  '00000000-0000-0000-0000-000000000000'::uuid)) with =,
  daterange(valid_from, valid_to, '[]') with &&
) where (revoked_at is null);

-- Effective, currently valid grants of the calling user (active accounts only).
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
    and (pr.locked_until is null or pr.locked_until < now())
$$;

create or replace function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.my_grants() g where g.is_super and g.scope_type = 'global')
$$;

-- Core authorisation check.
--   p_zone/p_hub null  -> requires a GLOBAL grant
--   p_hub given        -> global, zone grant for the hub's zone, or hub grant for that hub
--   p_zone given only  -> global or zone grant for that zone
create or replace function private.has_permission(
  p_perm text, p_zone uuid default null, p_hub uuid default null
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hub_zone uuid;
begin
  if auth.uid() is null then return false; end if;
  if p_hub is not null then
    select h.zone_id into v_hub_zone from public.hubs h where h.id = p_hub;
  end if;
  return exists (
    select 1 from private.my_grants() g
    where (g.permission_code = p_perm or (g.is_super and g.scope_type = 'global'))
      and (
            g.scope_type = 'global'
         or (p_hub is not null and g.scope_type = 'hub'  and g.hub_id  = p_hub)
         or (p_hub is not null and g.scope_type = 'zone' and g.zone_id = v_hub_zone)
         or (p_hub is null and p_zone is not null and g.scope_type = 'zone' and g.zone_id = p_zone)
      ));
end $$;

-- True if the permission is held anywhere inside the zone (zone grant, or a hub grant
-- for any hub in it). Used so a Hub Manager can see the zone their hub belongs to.
create or replace function private.has_permission_within_zone(p_perm text, p_zone uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_perm, p_zone, null)
      or exists (select 1 from private.my_grants() g
                 join public.hubs h on h.id = g.hub_id
                 where g.scope_type = 'hub' and h.zone_id = p_zone
                   and (g.permission_code = p_perm))
$$;

-- Can the caller grant this role at this scope? Prevents privilege escalation:
-- the granter must hold user-management rights at that scope AND every permission
-- contained in the role at that scope. Only super admins can grant super roles.
create or replace function private.can_assign_role(
  p_role uuid, p_scope text, p_zone uuid, p_hub uuid
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_super boolean;
begin
  select r.is_super into v_super from public.roles r where r.id = p_role;
  if v_super is null then return false; end if;
  if private.is_super_admin() then return true; end if;
  if v_super then return false; end if;
  if p_scope = 'global' then p_zone := null; p_hub := null; end if;
  if not private.has_permission('system.user_role.create', p_zone, p_hub) then
    return false;
  end if;
  return not exists (
    select 1 from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role_id = p_role
      and not private.has_permission(p.code, p_zone, p_hub));
end $$;

-- ---------------------------------------------------------------------
-- 7. Login tracking and lockout
-- ---------------------------------------------------------------------

create table public.login_events (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id     uuid references public.profiles(id),
  email       extensions.citext,
  portal      text not null check (portal in ('staff','admin')),
  success     boolean not null,
  failure_reason text,
  ip_address  text,
  user_agent  text
);
create index login_events_user_idx  on public.login_events (user_id, occurred_at desc);
create index login_events_email_idx on public.login_events (email, occurred_at desc);

create trigger login_events_no_update before update or delete on public.login_events
  for each row execute function private.audit_immutable();

-- Called ONLY by the server-side login edge function (service_role), never by browsers.
-- Returns the lockout state after recording the attempt.
create or replace function public.record_login_attempt(
  p_email text, p_success boolean, p_portal text,
  p_failure_reason text default null, p_ip text default null, p_user_agent text default null
) returns table (locked boolean, locked_until timestamptz, failed_count integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  v_max int := coalesce((select (value)::text::int from public.system_settings
                         where key = 'security.max_failed_logins'), 5);
  v_minutes int := coalesce((select (value)::text::int from public.system_settings
                         where key = 'security.lockout_minutes'), 30);
begin
  select * into v_profile from public.profiles where email = p_email::extensions.citext for update;

  insert into public.login_events (user_id, email, portal, success, failure_reason, ip_address, user_agent)
  values (v_profile.id, p_email, p_portal, p_success, p_failure_reason, p_ip, p_user_agent);

  if v_profile.id is null then
    return query select false, null::timestamptz, 0;
    return;
  end if;

  if p_success then
    update public.profiles
       set failed_login_count = 0, locked_until = null, last_login_at = now()
     where id = v_profile.id;
    return query select false, null::timestamptz, 0;
  else
    update public.profiles
       set failed_login_count = failed_login_count + 1,
           locked_until = case when failed_login_count + 1 >= v_max
                               then now() + make_interval(mins => v_minutes)
                               else locked_until end
     where id = v_profile.id
     returning (profiles.locked_until is not null and profiles.locked_until > now()),
               profiles.locked_until, profiles.failed_login_count
      into locked, locked_until, failed_count;
    return next;
  end if;
end $$;

revoke all on function public.record_login_attempt(text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_login_attempt(text, boolean, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 8. Profile column protection
-- ---------------------------------------------------------------------
-- Users may edit their own name/phone/language. Status, lockout and archive
-- fields can only be changed by user managers.
create or replace function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$   -- invoker: current_user reveals direct API writes
begin
  if new.id <> old.id then
    raise exception 'Profile id cannot be changed.' using errcode = 'P0001';
  end if;
  if auth.uid() is null then return new; end if;  -- server-side / service_role
  if current_user not in ('authenticated','anon') then return new; end if;  -- inside audited workflow functions
  if (new.status, new.failed_login_count, new.locked_until, new.archived_at, new.email, new.last_login_at)
     is distinct from
     (old.status, old.failed_login_count, old.locked_until, old.archived_at, old.email, old.last_login_at)
     and not private.has_permission('system.user.edit') then
    raise exception 'Not authorised to change account status fields.' using errcode = '42501';
  end if;
  if new.id = auth.uid() and new.status <> old.status then
    raise exception 'Users cannot change their own account status.' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 9. Triggers: stamping, audit, no-delete
-- ---------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select * from (values
      ('organizations','org'), ('zones','org'), ('hubs','org'),
      ('departments','org'), ('positions','org'),
      ('profiles','system'), ('roles','system'), ('user_roles','system'),
      ('system_settings','system')) as v(tbl, module)
  loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function private.stamp_row()', t.tbl || '_stamp', t.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.audit_row(%L)', t.tbl || '_audit', t.tbl, t.module);
    execute format('create trigger %I before delete on public.%I
                    for each row execute function private.prevent_delete()', t.tbl || '_no_delete', t.tbl);
  end loop;
end $$;

create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function private.audit_row('system');

create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile_update();

-- System roles cannot be archived / deactivated / renamed by code.
create or replace function private.guard_system_role() returns trigger
language plpgsql as $$
begin
  if old.is_system and (new.archived_at is not null or new.status <> 'active'
                        or new.code <> old.code or new.is_super <> old.is_super) then
    raise exception 'System roles cannot be archived, deactivated or re-coded.' using errcode = 'P0001';
  end if;
  if new.is_super and not old.is_super then
    raise exception 'Super flag cannot be added to an existing role.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger roles_guard before update on public.roles
  for each row execute function private.guard_system_role();

-- Moving a hub to another zone needs zone-level edit rights in BOTH zones.
create or replace function private.guard_hub_zone_move() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.zone_id is distinct from old.zone_id
     and not (private.has_permission('org.hub.edit', old.zone_id)
              and private.has_permission('org.hub.edit', new.zone_id)) then
    raise exception 'Moving a hub between zones requires zone-level rights in both zones.'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hubs_zone_move_guard before update on public.hubs
  for each row execute function private.guard_hub_zone_move();

-- Assignment scope must reference active, existing units; grants are validated.
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

  if auth.uid() is not null and not private.can_assign_role(new.role_id, new.scope_type, new.zone_id, new.hub_id) then
    raise exception 'Not authorised to assign this role at this scope.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger user_roles_guard before insert or update on public.user_roles
  for each row execute function private.guard_user_role();

-- role_permissions changes: only super admins (prevents self-escalation by editing a role).
create or replace function private.guard_role_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'Only a Super Admin can change role permissions.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function private.guard_role_permission();

-- ---------------------------------------------------------------------
-- 10. Row Level Security
-- ---------------------------------------------------------------------
alter table public.system_settings  enable row level security;
alter table public.organizations    enable row level security;
alter table public.zones            enable row level security;
alter table public.hubs             enable row level security;
alter table public.departments      enable row level security;
alter table public.positions        enable row level security;
alter table public.profiles         enable row level security;
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.login_events     enable row level security;

-- Anonymous visitors: only public branding settings.
revoke all on all tables in schema public from anon;
-- Future tables/functions created by migrations are not exposed to anon by default.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
grant select on public.system_settings to anon;

-- Authenticated: table privileges are broad, RLS decides rows. Deletes are never granted.
revoke delete, truncate on all tables in schema public from authenticated;
revoke insert, update on public.audit_logs, public.login_events, public.permissions from authenticated;

-- system_settings
create policy settings_public_read on public.system_settings for select to anon, authenticated
  using (is_public);
create policy settings_staff_read on public.system_settings for select to authenticated
  using (private.has_permission('system.settings.view'));
create policy settings_write on public.system_settings for update to authenticated
  using (private.has_permission('system.settings.configure'))
  with check (private.has_permission('system.settings.configure'));
create policy settings_insert on public.system_settings for insert to authenticated
  with check (private.has_permission('system.settings.configure'));

-- organizations: any active staff member can read the company record.
create policy org_read on public.organizations for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy org_write on public.organizations for update to authenticated
  using (private.has_permission('org.organization.edit'))
  with check (private.has_permission('org.organization.edit'));
create policy org_insert on public.organizations for insert to authenticated
  with check (private.has_permission('org.organization.create'));

-- zones
create policy zones_read on public.zones for select to authenticated
  using (private.has_permission_within_zone('org.zone.view', id));
create policy zones_insert on public.zones for insert to authenticated
  with check (private.has_permission('org.zone.create'));
create policy zones_update on public.zones for update to authenticated
  using (private.has_permission('org.zone.edit', id))
  with check (private.has_permission('org.zone.edit', id)
              and (archived_at is null or private.has_permission('org.zone.archive', id)));

-- hubs
create policy hubs_read on public.hubs for select to authenticated
  using (private.has_permission('org.hub.view', zone_id, id));
create policy hubs_insert on public.hubs for insert to authenticated
  with check (private.has_permission('org.hub.create', zone_id));
create policy hubs_update on public.hubs for update to authenticated
  using (private.has_permission('org.hub.edit', zone_id, id))
  with check (private.has_permission('org.hub.edit', zone_id, id)
              and (archived_at is null or private.has_permission('org.hub.archive', zone_id, id)));

-- departments / positions: company-wide reference data
create policy departments_read on public.departments for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy departments_insert on public.departments for insert to authenticated
  with check (private.has_permission('org.department.create'));
create policy departments_update on public.departments for update to authenticated
  using (private.has_permission('org.department.edit'))
  with check (private.has_permission('org.department.edit'));

create policy positions_read on public.positions for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy positions_insert on public.positions for insert to authenticated
  with check (private.has_permission('org.position.create'));
create policy positions_update on public.positions for update to authenticated
  using (private.has_permission('org.position.edit'))
  with check (private.has_permission('org.position.edit'));

-- profiles
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated
  using (private.has_permission('system.user.view'));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (private.has_permission('system.user.edit'))
  with check (private.has_permission('system.user.edit'));
-- Profiles are created only by the auth trigger (no insert policy).

-- permissions / roles / role_permissions: readable by staff, managed by super admin
create policy permissions_read on public.permissions for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy roles_read on public.roles for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy roles_insert on public.roles for insert to authenticated
  with check (private.has_permission('system.role.create') and not is_super and not is_system);
create policy roles_update on public.roles for update to authenticated
  using (private.has_permission('system.role.edit'))
  with check (private.has_permission('system.role.edit'));
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (private.is_super_admin());
-- Removing a permission from a role is a delete on a link table; allowed for super admin only.
grant delete on public.role_permissions to authenticated;
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (private.is_super_admin());

-- user_roles
create policy user_roles_self_read on public.user_roles for select to authenticated
  using (user_id = auth.uid());
create policy user_roles_admin_read on public.user_roles for select to authenticated
  using (private.has_permission('system.user_role.view',
           coalesce(zone_id, (select h.zone_id from public.hubs h where h.id = hub_id)), hub_id)
         or private.has_permission('system.user_role.view'));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (private.can_assign_role(role_id, scope_type, zone_id, hub_id));
create policy user_roles_update on public.user_roles for update to authenticated
  using (private.can_assign_role(role_id, scope_type, zone_id, hub_id))
  with check (private.can_assign_role(role_id, scope_type, zone_id, hub_id));

-- audit_logs: read-only, for auditors/admins
create policy audit_read on public.audit_logs for select to authenticated
  using (private.has_permission('system.audit.view'));

-- login_events: own history, or user managers
create policy login_events_self on public.login_events for select to authenticated
  using (user_id = auth.uid());
create policy login_events_admin on public.login_events for select to authenticated
  using (private.has_permission('system.user.view'));

-- ---------------------------------------------------------------------
-- 11. API functions for the frontend
-- ---------------------------------------------------------------------

-- Effective permissions of the signed-in user (drives menus/buttons in the UI;
-- the database still enforces every rule independently).
create or replace function public.my_permissions()
returns table (permission_code text, scope_type text, zone_id uuid, hub_id uuid, is_super boolean)
language sql stable security definer set search_path = '' as $$
  select distinct g.permission_code, g.scope_type, g.zone_id, g.hub_id, g.is_super
  from private.my_grants() g
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- Archive helper with mandatory reason (one call = one audited ARCHIVE event).
create or replace function public.archive_org_unit(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_rows int;
begin
  if p_table not in ('zones','hubs','departments','positions') then
    raise exception 'Unsupported table %', p_table;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'An archive reason is required.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  execute format('update public.%I set archived_at = now(), archived_by = auth.uid(),
                  archive_reason = $1, status = ''inactive'' where id = $2 and archived_at is null', p_table)
    using p_reason, p_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Record not found, already archived, or not authorised.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.archive_org_unit(text, uuid, text) from public, anon;
grant execute on function public.archive_org_unit(text, uuid, text) to authenticated;

-- Private helpers are not callable through the API by anon.
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ===== 20261111000200_seed_rbac.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0002: default permissions, roles, bootstrap
-- These are DEFAULT configuration rows. Admins can create custom roles and
-- (Super Admin) change role permissions from the UI afterwards.
-- Later module migrations add their own permissions (hr.*, ops.*, acc.* ...).
-- =====================================================================

insert into public.permissions (code, module, resource, action, description)
select m || '.' || r || '.' || a, m, r, a, d
from (values
  ('org','organization','view','View company profile'),
  ('org','organization','create','Create company profile'),
  ('org','organization','edit','Edit company profile'),
  ('org','zone','view','View zones'),
  ('org','zone','create','Create zones'),
  ('org','zone','edit','Edit zones'),
  ('org','zone','archive','Archive zones'),
  ('org','hub','view','View hubs'),
  ('org','hub','create','Create hubs'),
  ('org','hub','edit','Edit hubs'),
  ('org','hub','archive','Archive hubs'),
  ('org','department','view','View departments'),
  ('org','department','create','Create departments'),
  ('org','department','edit','Edit departments'),
  ('org','department','archive','Archive departments'),
  ('org','position','view','View positions'),
  ('org','position','create','Create positions'),
  ('org','position','edit','Edit positions'),
  ('org','position','archive','Archive positions'),
  ('system','user','view','View user accounts and login history'),
  ('system','user','create','Invite / create user accounts'),
  ('system','user','edit','Activate, deactivate, unlock users'),
  ('system','user_role','view','View role assignments'),
  ('system','user_role','create','Assign roles to users'),
  ('system','user_role','edit','Revoke / end-date role assignments'),
  ('system','role','view','View roles'),
  ('system','role','create','Create custom roles'),
  ('system','role','edit','Edit roles'),
  ('system','settings','view','View system settings'),
  ('system','settings','configure','Change system settings and branding'),
  ('system','admin_portal','view','Sign in through the /secure-control admin portal'),
  ('system','audit','view','View audit log'),
  ('system','audit','export','Export audit log')
) as v(m, r, a, d);

insert into public.roles (code, name, name_bn, description, is_system, is_super) values
  ('super_admin',         'Super Admin',          'সুপার অ্যাডমিন',        'Full system control', true, true),
  ('admin',               'Admin',                'অ্যাডমিন',              'System administration', true, false),
  ('head_office_manager', 'Head Office Manager',  'হেড অফিস ম্যানেজার',    'Company-wide oversight', true, false),
  ('hr_manager',          'HR Manager',           'এইচআর ম্যানেজার',       'Human resources', true, false),
  ('accounts_manager',    'Accounts Manager',     'অ্যাকাউন্টস ম্যানেজার', 'Finance and accounts', true, false),
  ('operations_manager',  'Operations Manager',   'অপারেশনস ম্যানেজার',    'Courier operations', true, false),
  ('zonal_manager',       'Zonal Manager',        'জোনাল ম্যানেজার',       'Manages one zone', true, false),
  ('hub_manager',         'Hub Manager',          'হাব ম্যানেজার',         'Manages one hub', true, false),
  ('pickup_manager',      'Pickup Manager',       'পিকআপ ম্যানেজার',       'Pickup operations', true, false),
  ('delivery_manager',    'Delivery Manager',     'ডেলিভারি ম্যানেজার',    'Delivery operations', true, false),
  ('rider',               'Rider',                'রাইডার',                'Pickup / delivery rider', true, false),
  ('accountant',          'Accountant',           'হিসাবরক্ষক',            'Bookkeeping', true, false),
  ('auditor',             'Auditor',              'অডিটর',                 'Read-only review and audit', true, false);

-- Role -> permission defaults (foundation scope only).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on (
     (r.code = 'admin')
  or (r.code = 'head_office_manager' and p.action = 'view' and p.code <> 'system.admin_portal.view')
  or (r.code = 'hr_manager' and (p.code like 'org.%.view'
        or p.code in ('org.department.create','org.department.edit',
                      'org.position.create','org.position.edit','system.user.view')))
  or (r.code in ('accounts_manager','operations_manager','accountant') and p.code like 'org.%.view')
  or (r.code = 'zonal_manager' and p.code in ('org.organization.view','org.zone.view','org.hub.view','org.hub.edit',
                                              'org.department.view','org.position.view'))
  or (r.code = 'hub_manager' and p.code in ('org.organization.view','org.zone.view','org.hub.view',
                                            'org.department.view','org.position.view'))
  or (r.code in ('pickup_manager','delivery_manager','rider') and p.code in ('org.organization.view','org.hub.view'))
  or (r.code = 'auditor' and ((p.action = 'view' and p.code <> 'system.admin_portal.view') or p.code = 'system.audit.export'))
);

-- ---------------------------------------------------------------------
-- Bootstrap: make the FIRST super admin. Works only while none exists.
-- Run once from the Supabase SQL editor (never exposed to the API):
--   select private.bootstrap_super_admin('owner@example.com');
-- ---------------------------------------------------------------------
create or replace function private.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
             where r.is_super and ur.revoked_at is null) then
    raise exception 'A Super Admin already exists. Assign further admins from the application.';
  end if;
  select id into v_user from public.profiles where email = p_email::extensions.citext;
  if v_user is null then
    raise exception 'No user with email %. Create the user in Supabase Auth first.', p_email;
  end if;
  insert into public.user_roles (user_id, role_id, scope_type)
  select v_user, id, 'global' from public.roles where code = 'super_admin';
  perform private.write_audit('BOOTSTRAP', 'system', 'user_roles', v_user::text, null,
                              jsonb_build_object('role', 'super_admin'), 'Initial super admin');
  return v_user;
end $$;
revoke all on function private.bootstrap_super_admin(text) from public, anon, authenticated;

-- ===== 20261111000300_hr_core.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0003: HR core
--   employees (current snapshot) + employee_sensitive (NID etc., separate
--   table so row security can protect it) + assignment & status history,
--   Employee ID applications (3-page flow → HR review → activation),
--   employee documents, dynamic profile builder (custom fields).
-- Rules:
--   * Employee ID (employee_code) is entered by authorised HR/Admin, never generated.
--   * Status / hub / position changes only through audited functions.
--   * Nothing is deleted; leavers are archived.
--   * A signature image is only an image: it is never treated as consent or payment proof.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'hr.' || r || '.' || a, 'hr', r, a, d from (values
  ('employee','view','View employees in scope'),
  ('employee','create','Start employee records / applications'),
  ('employee','edit','Edit employee details, transfer, resign'),
  ('employee','approve','Terminate / reinstate employees'),
  ('employee','archive','Archive former employees'),
  ('employee','export','Export employee lists'),
  ('employee_sensitive','view','Reveal NID, date of birth, family and address (audited)'),
  ('employee_sensitive','edit','Change NID and other sensitive identity data'),
  ('application','view','View Employee ID applications'),
  ('application','create','Prepare and submit Employee ID applications'),
  ('application','approve','Approve applications and assign Employee ID'),
  ('application','reject','Return or reject applications'),
  ('document','view','View employee documents (non-identity)'),
  ('document','create','Upload employee documents'),
  ('document','approve','Verify employee documents'),
  ('document','archive','Archive employee documents'),
  ('profile_field','configure','Configure the dynamic employee profile'),
  ('import','create','Upload and validate employee imports'),
  ('import','approve','Verify and commit employee imports')
) v(r, a, d);

-- ---------------------------------------------------------------------
-- Settings used by HR validation (configurable, not hard-coded)
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('hr.employee_code_pattern', '"^[A-Z]{2,4}-[0-9]{3,6}$"', 'Regex the company Employee ID must match'),
  ('hr.mobile_pattern',        '"^01[3-9][0-9]{8}$"',      'Bangladesh mobile number format'),
  ('hr.nid_pattern',           '"^([0-9]{10}|[0-9]{13}|[0-9]{17})$"', 'NID: 10, 13 or 17 digits'),
  ('hr.min_age_years',         '18',                        'Minimum age on joining date'),
  ('hr.required_documents',    '["nid_front","nid_back","photo"]', 'Documents required before an application can be submitted');

create or replace function private.setting_text(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value #>> '{}' from public.system_settings where key = p_key
$$;

-- ---------------------------------------------------------------------
-- Employees (current state)
-- ---------------------------------------------------------------------
create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  employee_code      extensions.citext unique,           -- assigned by HR on approval
  profile_id         uuid unique references public.profiles(id), -- login account, optional
  full_name          text not null check (length(trim(full_name)) > 1),
  full_name_bn       text,
  mobile             text,
  email              extensions.citext,
  emergency_contact_name  text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  reference_info     text,
  department_id      uuid references public.departments(id),
  position_id        uuid references public.positions(id),
  zone_id            uuid references public.zones(id),
  hub_id             uuid references public.hubs(id),
  reporting_manager_id uuid references public.employees(id),
  joining_date       date,
  status             text not null default 'applicant'
                     check (status in ('applicant','active','inactive','resigned','terminated','rejected')),
  status_since       date not null default current_date,
  archived_at        timestamptz,
  archived_by        uuid,
  archive_reason     text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint employees_code_when_active check (status in ('applicant','rejected') or employee_code is not null),
  constraint employees_not_self_manager check (reporting_manager_id is null or reporting_manager_id <> id)
);
create index employees_hub_idx on public.employees (hub_id) where archived_at is null;
create index employees_zone_idx on public.employees (zone_id) where archived_at is null;
create index employees_status_idx on public.employees (status);
create index employees_name_trgm on public.employees using gin (full_name extensions.gin_trgm_ops);
create unique index employees_mobile_uniq on public.employees (mobile)
  where mobile is not null and status not in ('rejected') and archived_at is null;

-- Sensitive identity data (separate table: row security can protect it as a whole).
create table public.employee_sensitive (
  employee_id      uuid primary key references public.employees(id),
  nid_number       text unique,
  date_of_birth    date,
  father_name      text,
  mother_name      text,
  present_address  text,
  permanent_address text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

-- History of where/what an employee works. Current row has effective_to null.
create table public.employee_assignments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id),
  change_type      text not null check (change_type in ('joining','transfer','promotion','correction','exit')),
  department_id    uuid references public.departments(id),
  position_id      uuid references public.positions(id),
  zone_id          uuid references public.zones(id),
  hub_id           uuid references public.hubs(id),
  reporting_manager_id uuid references public.employees(id),
  effective_from   date not null,
  effective_to     date,
  reason           text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  constraint employee_assignments_dates check (effective_to is null or effective_to >= effective_from)
);
create index employee_assignments_emp_idx on public.employee_assignments (employee_id, effective_from desc);
create unique index employee_assignments_one_current on public.employee_assignments (employee_id) where effective_to is null;

create table public.employee_status_history (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  from_status    text,
  to_status      text not null,
  effective_date date not null,
  reason         text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);
create index employee_status_history_emp_idx on public.employee_status_history (employee_id, created_at desc);
create index employee_status_history_date_idx on public.employee_status_history (to_status, effective_date);

create table public.employee_applications (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null unique references public.employees(id),
  status        text not null default 'draft' check (status in ('draft','submitted','returned','approved','rejected')),
  submitted_by  uuid,
  submitted_at  timestamptz,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create index employee_applications_status_idx on public.employee_applications (status);

-- Documents: metadata here, file in private Storage bucket "employee-docs".
create table public.employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id),
  doc_type      text not null check (doc_type in
                ('nid_front','nid_back','photo','signature','cv','experience_certificate','education','other')),
  title         text,
  storage_path  text not null unique,     -- employee/<employee_id>/<uuid>-<name>
  file_name     text not null,
  mime_type     text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  version       integer not null default 1,
  expiry_date   date,
  verified_by   uuid,
  verified_at   timestamptz,
  archived_at   timestamptz,
  archived_by   uuid,
  archive_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  constraint employee_documents_path check (storage_path like 'employee/' || employee_id::text || '/%')
);
create index employee_documents_emp_idx on public.employee_documents (employee_id, doc_type) where archived_at is null;
comment on table public.employee_documents is
  'Employee files. A signature image is stored for identification only and is never treated as proof of consent or payment.';

-- ---------------------------------------------------------------------
-- Dynamic profile builder
-- ---------------------------------------------------------------------
create table public.employee_field_sections (
  id          uuid primary key default gen_random_uuid(),
  code        extensions.citext not null unique,
  name        text not null,
  name_bn     text,
  sort_order  integer not null default 100,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.employee_custom_fields (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references public.employee_field_sections(id),
  code            extensions.citext not null unique check (code ~ '^[a-z][a-z0-9_]{1,48}$'),
  label           text not null,
  label_bn        text,
  field_type      text not null check (field_type in
                  ('text','number','date','dropdown','multi_select','checkbox','textarea',
                   'photo','document','signature','employee_ref','hub_ref')),
  is_required     boolean not null default false,
  is_visible      boolean not null default true,
  view_permission text references public.permissions(code),   -- null = anyone who can view the employee
  edit_permission text references public.permissions(code),   -- null = hr.employee.edit
  validation      jsonb not null default '{}'::jsonb,         -- {min,max,maxLength,pattern,minDate,maxDate}
  options         jsonb not null default '[]'::jsonb,         -- [{"value":"o_pos","label":"O+","label_bn":"ও+"}]
  sort_order      integer not null default 100,
  archived_at     timestamptz,
  archived_by     uuid,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint custom_fields_options_chk check (
    (field_type in ('dropdown','multi_select') and jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0)
    or (field_type not in ('dropdown','multi_select'))),
  constraint custom_fields_validation_obj check (jsonb_typeof(validation) = 'object')
);
create index employee_custom_fields_section_idx on public.employee_custom_fields (section_id, sort_order);

create table public.employee_custom_field_values (
  employee_id uuid not null references public.employees(id),
  field_id    uuid not null references public.employee_custom_fields(id),
  value       jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (employee_id, field_id)
);
create index employee_custom_field_values_field_idx on public.employee_custom_field_values (field_id);

-- ---------------------------------------------------------------------
-- Scope helpers
-- ---------------------------------------------------------------------
create or replace function private.employee_has_permission(p_perm text, p_employee uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.has_permission(p_perm, e.zone_id, e.hub_id)
                   from public.employees e where e.id = p_employee), false)
$$;

create or replace function private.is_self_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 where e.id = p_employee and e.profile_id = auth.uid() and e.profile_id is not null)
$$;

-- The person who created a still-editable application may keep working on it.
create or replace function private.is_open_draft_of_caller(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 left join public.employee_applications a on a.employee_id = e.id
                 where e.id = p_employee and e.status = 'applicant'
                   and (a.status is null or a.status in ('draft','returned'))
                   and e.created_by = auth.uid()
                   and private.has_permission('hr.application.create', e.zone_id, e.hub_id))
$$;

create or replace function private.is_api_user() returns boolean
language sql stable as $$ select current_user in ('authenticated','anon') $$;

-- ---------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------
-- zone always follows hub; protected columns change only through HR functions.
create or replace function private.hub_zone(p_hub uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select zone_id from public.hubs where id = p_hub
$$;

-- NOTE: guard triggers are SECURITY INVOKER on purpose: current_user is then
-- 'authenticated' for direct API writes but the owner inside workflow functions.
create or replace function private.employees_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.hub_id is not null then
    new.zone_id := private.hub_zone(new.hub_id);
  end if;
  if new.mobile is not null and new.mobile !~ private.setting_text('hr.mobile_pattern') then
    raise exception 'Mobile number % is not a valid Bangladesh mobile number.', new.mobile using errcode = '23514';
  end if;
  if new.emergency_contact_phone is not null and new.emergency_contact_phone !~ private.setting_text('hr.mobile_pattern') then
    raise exception 'Emergency contact phone is not a valid mobile number.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if private.is_api_user() and (new.status <> 'applicant' or new.employee_code is not null or new.profile_id is not null) then
      raise exception 'New employees start as applicants. Use the application approval to activate and assign an Employee ID.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if private.is_api_user() then
    if (new.employee_code, new.status, new.profile_id, new.archived_at, new.status_since)
       is distinct from (old.employee_code, old.status, old.profile_id, old.archived_at, old.status_since) then
      raise exception 'Employee ID, status, login link and archive state change only through HR workflow functions.'
        using errcode = '42501';
    end if;
    if old.status <> 'applicant'
       and (new.hub_id, new.zone_id, new.department_id, new.position_id, new.reporting_manager_id, new.joining_date)
           is distinct from
           (old.hub_id, old.zone_id, old.department_id, old.position_id, old.reporting_manager_id, old.joining_date) then
      raise exception 'Use the transfer / promotion function to change hub, department, position or manager (keeps history).'
        using errcode = '42501';
    end if;
    if old.archived_at is not null then
      raise exception 'Archived employee records are read-only.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger employees_guard before insert or update on public.employees
  for each row execute function private.employees_guard();

create or replace function private.employee_sensitive_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_join date;
  v_min int := coalesce(private.setting_text('hr.min_age_years')::int, 18);
begin
  if new.nid_number is not null and new.nid_number !~ private.setting_text('hr.nid_pattern') then
    raise exception 'NID must be 10, 13 or 17 digits.' using errcode = '23514';
  end if;
  if new.date_of_birth is not null then
    select joining_date into v_join from public.employees where id = new.employee_id;
    if new.date_of_birth > coalesce(v_join, current_date) - make_interval(years => v_min) then
      raise exception 'Employee must be at least % years old on the joining date.', v_min using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger employee_sensitive_guard before insert or update on public.employee_sensitive
  for each row execute function private.employee_sensitive_guard();

-- Audit for the sensitive table records WHICH fields changed, never the values.
create or replace function private.audit_sensitive() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fields jsonb;
begin
  select jsonb_object_agg(k, '***') into v_fields
  from jsonb_each(to_jsonb(new)) n(k, v)
  where k not in ('updated_at','updated_by','created_at','created_by','employee_id')
    and (tg_op = 'INSERT' or (to_jsonb(old) -> k) is distinct from v);
  perform private.write_audit(tg_op, 'hr', 'employee_sensitive', new.employee_id::text, null, v_fields);
  return new;
end $$;
create trigger employee_sensitive_audit after insert or update on public.employee_sensitive
  for each row execute function private.audit_sensitive();

-- History tables are append-only.
create or replace function private.append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is history and cannot be deleted.', tg_table_name using errcode = 'P0001';
  end if;
  -- employee_assignments: only closing the current row (effective_to) is allowed.
  if tg_table_name = 'employee_assignments' then
    if (to_jsonb(new) - 'effective_to') = (to_jsonb(old) - 'effective_to') and old.effective_to is null then
      return new;
    end if;
  end if;
  raise exception '% is history and cannot be changed.', tg_table_name using errcode = 'P0001';
end $$;
create trigger employee_assignments_append_only before update or delete on public.employee_assignments
  for each row execute function private.append_only();
create trigger employee_status_history_append_only before update or delete on public.employee_status_history
  for each row execute function private.append_only();

-- Custom field values: type/option/validation checks, archived fields locked, edit permission.
create or replace function private.custom_value_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  f public.employee_custom_fields%rowtype;
  v jsonb := new.value;
  n numeric;
  d date;
  el jsonb;
begin
  select * into f from public.employee_custom_fields where id = new.field_id;
  if f.archived_at is not null then
    raise exception 'Field "%" is archived; its old values are kept but it cannot be changed.', f.label using errcode = 'P0001';
  end if;
  if auth.uid() is not null
     and not private.employee_has_permission(coalesce(f.edit_permission, 'hr.employee.edit'), new.employee_id)
     and not private.is_open_draft_of_caller(new.employee_id) then
    raise exception 'Not allowed to edit field "%".', f.label using errcode = '42501';
  end if;
  if jsonb_typeof(v) = 'null' then
    raise exception 'Use an explicit value; to clear a field, archive the value through HR.' using errcode = '23514';
  end if;

  case f.field_type
    when 'text', 'textarea' then
      if jsonb_typeof(v) <> 'string' then raise exception '"%" must be text.', f.label using errcode = '23514'; end if;
      if (f.validation ? 'maxLength') and length(v #>> '{}') > (f.validation ->> 'maxLength')::int then
        raise exception '"%" is longer than % characters.', f.label, f.validation ->> 'maxLength' using errcode = '23514'; end if;
      if (f.validation ? 'pattern') and (v #>> '{}') !~ (f.validation ->> 'pattern') then
        raise exception '"%" has an invalid format.', f.label using errcode = '23514'; end if;
    when 'number' then
      if jsonb_typeof(v) <> 'number' then raise exception '"%" must be a number.', f.label using errcode = '23514'; end if;
      n := (v #>> '{}')::numeric;
      if (f.validation ? 'min' and n < (f.validation ->> 'min')::numeric)
         or (f.validation ? 'max' and n > (f.validation ->> 'max')::numeric) then
        raise exception '"%" is out of the allowed range.', f.label using errcode = '23514'; end if;
    when 'date' then
      begin d := (v #>> '{}')::date;
      exception when others then raise exception '"%" must be a date (YYYY-MM-DD).', f.label using errcode = '23514'; end;
      if (f.validation ? 'minDate' and d < (f.validation ->> 'minDate')::date)
         or (f.validation ? 'maxDate' and d > (f.validation ->> 'maxDate')::date) then
        raise exception '"%" is outside the allowed dates.', f.label using errcode = '23514'; end if;
    when 'dropdown' then
      if jsonb_typeof(v) <> 'string' or not exists (select 1 from jsonb_array_elements(f.options) o where o ->> 'value' = v #>> '{}') then
        raise exception '"%" must be one of the configured options.', f.label using errcode = '23514'; end if;
    when 'multi_select' then
      if jsonb_typeof(v) <> 'array' then raise exception '"%" must be a list.', f.label using errcode = '23514'; end if;
      for el in select * from jsonb_array_elements(v) loop
        if not exists (select 1 from jsonb_array_elements(f.options) o where o ->> 'value' = el #>> '{}') then
          raise exception '"%" contains an option that is not configured.', f.label using errcode = '23514'; end if;
      end loop;
    when 'checkbox' then
      if jsonb_typeof(v) <> 'boolean' then raise exception '"%" must be true or false.', f.label using errcode = '23514'; end if;
    when 'photo', 'document', 'signature' then
      if not exists (select 1 from public.employee_documents dd
                     where dd.id::text = v #>> '{}' and dd.employee_id = new.employee_id and dd.archived_at is null) then
        raise exception '"%" must reference an uploaded document of this employee.', f.label using errcode = '23514'; end if;
    when 'employee_ref' then
      if not exists (select 1 from public.employees e where e.id::text = v #>> '{}') then
        raise exception '"%" must reference an existing employee.', f.label using errcode = '23514'; end if;
    when 'hub_ref' then
      if not exists (select 1 from public.hubs h where h.id::text = v #>> '{}') then
        raise exception '"%" must reference an existing hub.', f.label using errcode = '23514'; end if;
  end case;
  return new;
end $$;
create trigger custom_value_guard before insert or update on public.employee_custom_field_values
  for each row execute function private.custom_value_guard();

-- A field's type cannot change once values exist (would corrupt history).
create or replace function private.custom_field_guard() returns trigger
language plpgsql as $$
begin
  if new.field_type <> old.field_type
     and exists (select 1 from public.employee_custom_field_values where field_id = old.id) then
    raise exception 'Field type cannot change after values exist. Archive this field and create a new one.' using errcode = 'P0001';
  end if;
  if new.code <> old.code then
    raise exception 'Field code cannot change.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger custom_field_guard before update on public.employee_custom_fields
  for each row execute function private.custom_field_guard();

-- Stamp / audit / no-delete on every HR table.
do $$
declare t record;
begin
  for t in select * from (values
    ('employees', true, true), ('employee_sensitive', true, false),
    ('employee_applications', true, true), ('employee_documents', true, true),
    ('employee_field_sections', true, true), ('employee_custom_fields', true, true),
    ('employee_custom_field_values', true, true)) v(tbl, stamp, audit)
  loop
    if t.stamp then
      execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t.tbl||'_stamp', t.tbl);
    end if;
    if t.audit then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''hr'')', t.tbl||'_audit', t.tbl);
    end if;
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t.tbl||'_no_delete', t.tbl);
  end loop;
end $$;
create trigger employee_assignments_audit after insert or update on public.employee_assignments
  for each row execute function private.audit_row('hr');
create trigger employee_status_history_audit after insert on public.employee_status_history
  for each row execute function private.audit_row('hr');

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.employees                  enable row level security;
alter table public.employee_sensitive         enable row level security;
alter table public.employee_assignments       enable row level security;
alter table public.employee_status_history    enable row level security;
alter table public.employee_applications      enable row level security;
alter table public.employee_documents         enable row level security;
alter table public.employee_field_sections    enable row level security;
alter table public.employee_custom_fields     enable row level security;
alter table public.employee_custom_field_values enable row level security;

revoke all on public.employees, public.employee_sensitive, public.employee_assignments,
  public.employee_status_history, public.employee_applications, public.employee_documents,
  public.employee_field_sections, public.employee_custom_fields, public.employee_custom_field_values from anon;
revoke delete, truncate on public.employees, public.employee_sensitive, public.employee_assignments,
  public.employee_status_history, public.employee_applications, public.employee_documents,
  public.employee_field_sections, public.employee_custom_fields, public.employee_custom_field_values from authenticated;
-- History and workflow tables are written only by functions.
revoke insert, update on public.employee_assignments, public.employee_status_history,
  public.employee_applications from authenticated;

-- employees
create policy employees_read on public.employees for select to authenticated
  using (private.has_permission('hr.employee.view', zone_id, hub_id)
         or profile_id = auth.uid()
         or private.is_open_draft_of_caller(id));
create policy employees_insert on public.employees for insert to authenticated
  with check (private.has_permission('hr.application.create', zone_id, hub_id)
              or private.has_permission('hr.employee.create', zone_id, hub_id));
create policy employees_update on public.employees for update to authenticated
  using (private.has_permission('hr.employee.edit', zone_id, hub_id) or private.is_open_draft_of_caller(id))
  with check (private.has_permission('hr.employee.edit', zone_id, hub_id) or private.is_open_draft_of_caller(id));

-- employee_sensitive: NO general read policy. Others read it only through
-- hr_reveal_sensitive(), which checks permission and writes an audit entry.
create policy sensitive_self_read on public.employee_sensitive for select to authenticated
  using (private.is_self_employee(employee_id) or private.is_open_draft_of_caller(employee_id));
create policy sensitive_insert on public.employee_sensitive for insert to authenticated
  with check (private.is_open_draft_of_caller(employee_id)
              or private.employee_has_permission('hr.employee_sensitive.edit', employee_id));
create policy sensitive_update on public.employee_sensitive for update to authenticated
  using (private.is_open_draft_of_caller(employee_id)
         or private.employee_has_permission('hr.employee_sensitive.edit', employee_id))
  with check (private.is_open_draft_of_caller(employee_id)
              or private.employee_has_permission('hr.employee_sensitive.edit', employee_id));

create policy assignments_read on public.employee_assignments for select to authenticated
  using (private.employee_has_permission('hr.employee.view', employee_id) or private.is_self_employee(employee_id));
create policy status_history_read on public.employee_status_history for select to authenticated
  using (private.employee_has_permission('hr.employee.view', employee_id) or private.is_self_employee(employee_id));
create policy applications_read on public.employee_applications for select to authenticated
  using (private.employee_has_permission('hr.application.view', employee_id) or private.is_open_draft_of_caller(employee_id));

-- documents: identity documents (NID images) need the sensitive permission.
create policy documents_read on public.employee_documents for select to authenticated
  using (private.is_self_employee(employee_id)
         or private.is_open_draft_of_caller(employee_id)
         or (doc_type in ('nid_front','nid_back')
             and private.employee_has_permission('hr.employee_sensitive.view', employee_id))
         or (doc_type not in ('nid_front','nid_back')
             and private.employee_has_permission('hr.document.view', employee_id)));
create policy documents_insert on public.employee_documents for insert to authenticated
  with check (verified_by is null and archived_at is null
              and (private.employee_has_permission('hr.document.create', employee_id)
                   or private.is_open_draft_of_caller(employee_id)));
create policy documents_update on public.employee_documents for update to authenticated
  using (private.employee_has_permission('hr.document.approve', employee_id)
         or private.employee_has_permission('hr.document.archive', employee_id))
  with check (private.employee_has_permission('hr.document.approve', employee_id)
              or private.employee_has_permission('hr.document.archive', employee_id));

-- profile builder configuration
create policy sections_read on public.employee_field_sections for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy sections_write on public.employee_field_sections for insert to authenticated
  with check (private.has_permission('hr.profile_field.configure'));
create policy sections_update on public.employee_field_sections for update to authenticated
  using (private.has_permission('hr.profile_field.configure'))
  with check (private.has_permission('hr.profile_field.configure'));
create policy fields_read on public.employee_custom_fields for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy fields_insert on public.employee_custom_fields for insert to authenticated
  with check (private.has_permission('hr.profile_field.configure'));
create policy fields_update on public.employee_custom_fields for update to authenticated
  using (private.has_permission('hr.profile_field.configure'))
  with check (private.has_permission('hr.profile_field.configure'));

create policy values_read on public.employee_custom_field_values for select to authenticated
  using ((private.employee_has_permission('hr.employee.view', employee_id)
          or private.is_self_employee(employee_id)
          or private.is_open_draft_of_caller(employee_id))
         and coalesce((select private.employee_has_permission(f.view_permission, employee_id)
                       from public.employee_custom_fields f
                       where f.id = field_id and f.view_permission is not null), true));
create policy values_insert on public.employee_custom_field_values for insert to authenticated
  with check (private.employee_has_permission('hr.employee.view', employee_id) or private.is_open_draft_of_caller(employee_id));
create policy values_update on public.employee_custom_field_values for update to authenticated
  using (private.employee_has_permission('hr.employee.view', employee_id) or private.is_open_draft_of_caller(employee_id))
  with check (private.employee_has_permission('hr.employee.view', employee_id) or private.is_open_draft_of_caller(employee_id));
-- (the value guard trigger enforces the field's own edit permission)

-- ---------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------

-- Start an application (page 1+2 data are then filled with normal updates while in draft).
create or replace function public.hr_start_application(
  p_full_name text, p_mobile text, p_hub uuid, p_department uuid default null, p_position uuid default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.employees (full_name, mobile, hub_id, department_id, position_id)
  values (p_full_name, p_mobile, p_hub, p_department, p_position)
  returning id into v_id;
  perform private.create_application_row(v_id);
  return v_id;
end $$;

create or replace function private.create_application_row(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.employees where id = p_employee and created_by = auth.uid() and status = 'applicant') then
    raise exception 'Application can only be opened for an applicant you created.' using errcode = '42501';
  end if;
  insert into public.employee_applications (employee_id) values (p_employee);
end $$;

-- What is still missing before submission (page 3 "show missing fields").
create or replace function public.hr_application_missing_fields(p_employee uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  s public.employee_sensitive%rowtype;
  v text[] := '{}';
  d text;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if not (private.employee_has_permission('hr.application.view', p_employee)
          or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into s from public.employee_sensitive where employee_id = p_employee;

  if coalesce(trim(e.full_name), '') = '' then v := array_append(v, 'full_name'::text); end if;
  if e.mobile is null then v := array_append(v, 'mobile'::text); end if;
  if s.date_of_birth is null then v := array_append(v, 'date_of_birth'::text); end if;
  if s.nid_number is null then v := array_append(v, 'nid_number'::text); end if;
  if e.department_id is null then v := array_append(v, 'department'::text); end if;
  if e.position_id is null then v := array_append(v, 'position'::text); end if;
  if e.hub_id is null and e.zone_id is null then v := array_append(v, 'hub'::text); end if;
  if e.joining_date is null then v := array_append(v, 'joining_date'::text); end if;
  if e.emergency_contact_phone is null then v := array_append(v, 'emergency_contact'::text); end if;
  if e.reporting_manager_id is null then v := array_append(v, 'reporting_manager'::text); end if;
  if not exists (select 1 from public.employee_compensation c where c.employee_id = p_employee and c.status in ('pending','approved')) then
    v := array_append(v, 'basic_salary'::text);
  end if;
  for d in select jsonb_array_elements_text(value) from public.system_settings where key = 'hr.required_documents' loop
    if not exists (select 1 from public.employee_documents x where x.employee_id = p_employee
                   and x.doc_type = d and x.archived_at is null) then
      v := v || ('document:' || d);
    end if;
  end loop;
  select v || coalesce(array_agg('field:' || f.code::text order by f.sort_order), '{}') into v
  from public.employee_custom_fields f
  where f.is_required and f.archived_at is null
    and not exists (select 1 from public.employee_custom_field_values cv where cv.field_id = f.id and cv.employee_id = p_employee);
  return v;
end $$;

create or replace function public.hr_submit_application(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_missing text[];
begin
  if not private.is_open_draft_of_caller(p_employee) then
    raise exception 'Only the preparer can submit an open draft application.' using errcode = '42501';
  end if;
  v_missing := public.hr_application_missing_fields(p_employee);
  if cardinality(v_missing) > 0 then
    raise exception 'Application is incomplete. Missing: %', array_to_string(v_missing, ', ') using errcode = '23514';
  end if;
  update public.employee_applications
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
   where employee_id = p_employee;
  perform private.write_audit('SUBMIT', 'hr', 'employee_applications', p_employee::text, null, null, 'Sent to HR review');
end $$;

create or replace function public.hr_return_application(p_employee uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.employee_has_permission('hr.application.reject', p_employee) then
    raise exception 'Not authorised to return applications.' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  update public.employee_applications
     set status = 'returned', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where employee_id = p_employee and status = 'submitted';
  if not found then raise exception 'Only submitted applications can be returned.' using errcode = 'P0001'; end if;
  perform private.write_audit('RETURN', 'hr', 'employee_applications', p_employee::text, null, null, p_note);
end $$;

create or replace function public.hr_reject_application(p_employee uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.employee_has_permission('hr.application.reject', p_employee) then
    raise exception 'Not authorised to reject applications.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.employee_applications
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_reason
   where employee_id = p_employee and status = 'submitted';
  if not found then raise exception 'Only submitted applications can be rejected.' using errcode = 'P0001'; end if;
  update public.employees set status = 'rejected', status_since = current_date where id = p_employee;
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, 'applicant', 'rejected', current_date, p_reason);
end $$;

-- HR review → approve → assign company Employee ID → activate.
create or replace function public.hr_approve_application(p_employee uuid, p_employee_code text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  a public.employee_applications%rowtype;
  v_code text := upper(trim(p_employee_code));
begin
  select * into e from public.employees where id = p_employee for update;
  select * into a from public.employee_applications where employee_id = p_employee for update;
  if not private.employee_has_permission('hr.application.approve', p_employee) then
    raise exception 'Not authorised to approve applications.' using errcode = '42501';
  end if;
  if a.status is distinct from 'submitted' then
    raise exception 'Only submitted applications can be approved (current: %).', coalesce(a.status, 'none') using errcode = 'P0001';
  end if;
  if a.submitted_by = auth.uid() then
    raise exception 'The person who submitted an application cannot approve it.' using errcode = '42501';
  end if;
  if v_code is null or v_code !~ private.setting_text('hr.employee_code_pattern') then
    raise exception 'Employee ID "%" does not match the company format.', p_employee_code using errcode = '23514';
  end if;
  if exists (select 1 from public.employees where employee_code = v_code::extensions.citext) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  update public.employees
     set employee_code = v_code, status = 'active', status_since = coalesce(joining_date, current_date)
   where id = p_employee;
  update public.employee_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where employee_id = p_employee;
  insert into public.employee_assignments
    (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
  values (p_employee, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id,
          coalesce(e.joining_date, current_date), 'Application approved');
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, 'applicant', 'active', coalesce(e.joining_date, current_date), coalesce(p_note, 'Application approved'));
  -- The salary proposed in the application becomes effective now (preparer ≠ approver already enforced).
  update public.employee_compensation
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where employee_id = p_employee and status = 'pending';
end $$;

-- Bulk ID assignment: all-or-nothing. p_items = [{"employee_id": "...", "employee_code": "..."}]
create or replace function public.hr_bulk_assign_ids(p_items jsonb, p_note text default 'Bulk ID assignment')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  it jsonb; n int := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Provide a non-empty list.' using errcode = '22023';
  end if;
  if (select count(distinct upper(x ->> 'employee_code')) from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'The list contains the same Employee ID twice.' using errcode = '23505';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    perform public.hr_approve_application((it ->> 'employee_id')::uuid, it ->> 'employee_code', p_note);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Transfer / promotion / correction of assignment with history.
create or replace function public.hr_transfer_employee(
  p_employee uuid, p_hub uuid, p_department uuid, p_position uuid, p_manager uuid,
  p_effective date, p_reason text, p_change_type text default 'transfer'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_zone uuid;
begin
  select * into e from public.employees where id = p_employee for update;
  if e.status <> 'active' then raise exception 'Only active employees can be transferred.' using errcode = 'P0001'; end if;
  if p_change_type not in ('transfer','promotion','correction') then raise exception 'Invalid change type.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_effective is null or p_effective < (select max(effective_from) from public.employee_assignments where employee_id = p_employee) then
    raise exception 'Effective date must be on or after the current assignment start.' using errcode = '22023';
  end if;
  select zone_id into v_zone from public.hubs where id = p_hub;
  if not private.has_permission('hr.employee.edit', e.zone_id, e.hub_id)
     or not private.has_permission('hr.employee.edit', coalesce(v_zone, e.zone_id), p_hub) then
    raise exception 'You need HR edit rights in both the current and the new hub.' using errcode = '42501';
  end if;
  if p_manager = p_employee then raise exception 'An employee cannot report to themselves.' using errcode = '22023'; end if;

  update public.employee_assignments set effective_to = greatest(p_effective - 1, effective_from)
   where employee_id = p_employee and effective_to is null;
  insert into public.employee_assignments
    (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
  values (p_employee, p_change_type, p_department, p_position, coalesce(v_zone, e.zone_id), p_hub, p_manager, p_effective, p_reason);
  perform set_config('app.change_reason', p_reason, true);
  update public.employees
     set hub_id = p_hub, zone_id = coalesce(v_zone, e.zone_id), department_id = p_department,
         position_id = p_position, reporting_manager_id = p_manager
   where id = p_employee;
end $$;

-- Activate / deactivate / resign / terminate / reinstate.
create or replace function public.hr_change_status(p_employee uuid, p_status text, p_effective date, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_perm text;
begin
  select * into e from public.employees where id = p_employee for update;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if e.archived_at is not null then raise exception 'Archived employees cannot change status.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if not ((e.status, p_status) in (('active','inactive'), ('inactive','active'), ('active','resigned'),
                                   ('inactive','resigned'), ('active','terminated'), ('inactive','terminated'),
                                   ('resigned','active'), ('terminated','active'))) then
    raise exception 'Status cannot change from % to %.', e.status, p_status using errcode = 'P0001';
  end if;
  v_perm := case when p_status = 'terminated' or e.status in ('resigned','terminated') then 'hr.employee.approve'
                 else 'hr.employee.edit' end;
  if not private.has_permission(v_perm, e.zone_id, e.hub_id) then
    raise exception 'Not authorised (requires %).', v_perm using errcode = '42501';
  end if;
  if e.profile_id = auth.uid() then
    raise exception 'You cannot change your own employment status.' using errcode = '42501';
  end if;

  perform set_config('app.change_reason', p_reason, true);
  update public.employees set status = p_status, status_since = coalesce(p_effective, current_date) where id = p_employee;
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, e.status, p_status, coalesce(p_effective, current_date), p_reason);

  if p_status in ('resigned','terminated') then
    update public.employee_assignments set effective_to = greatest(coalesce(p_effective, current_date), effective_from)
     where employee_id = p_employee and effective_to is null;
  elsif e.status in ('resigned','terminated') and p_status = 'active' then
    insert into public.employee_assignments
      (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
    values (p_employee, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id,
            coalesce(p_effective, current_date), 'Reinstated: ' || p_reason);
  end if;

  -- Leavers and inactive staff lose system access immediately; reactivation restores it.
  if e.profile_id is not null then
    update public.profiles set status = case when p_status = 'active' then 'active' else 'inactive' end
     where id = e.profile_id;
  end if;
end $$;

create or replace function public.hr_archive_employee(p_employee uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype;
begin
  select * into e from public.employees where id = p_employee for update;
  if not private.has_permission('hr.employee.archive', e.zone_id, e.hub_id) then
    raise exception 'Not authorised to archive employees.' using errcode = '42501';
  end if;
  if e.status in ('active','applicant') then
    raise exception 'Active employees and open applications cannot be archived. Resign/terminate or reject first.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.employees set archived_at = now(), archived_by = auth.uid(), archive_reason = p_reason where id = p_employee;
end $$;

-- Link / unlink a login account to an employee.
create or replace function public.hr_link_login(p_employee uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.employee_has_permission('hr.employee.edit', p_employee) or not private.has_permission('system.user.edit') then
    raise exception 'Requires HR edit and user management rights.' using errcode = '42501';
  end if;
  update public.employees set profile_id = p_profile where id = p_employee and status = 'active';
  if not found then raise exception 'Only active employees can be linked to a login.' using errcode = 'P0001'; end if;
end $$;

-- Reveal sensitive identity data: permission-checked and audited (reason required).
create or replace function public.hr_reveal_sensitive(p_employee uuid, p_reason text)
returns table (nid_number text, date_of_birth date, father_name text, mother_name text,
               present_address text, permanent_address text)
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.employee_has_permission('hr.employee_sensitive.view', p_employee) or private.is_self_employee(p_employee)) then
    raise exception 'Not authorised to view sensitive employee data.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' and not private.is_self_employee(p_employee) then
    raise exception 'A reason is required to view sensitive data.' using errcode = '22023';
  end if;
  perform private.write_audit('VIEW_SENSITIVE', 'hr', 'employee_sensitive', p_employee::text, null, null, p_reason);
  return query select s.nid_number, s.date_of_birth, s.father_name, s.mother_name, s.present_address, s.permanent_address
               from public.employee_sensitive s where s.employee_id = p_employee;
end $$;

-- Masked identity for lists: last 4 NID digits only, no audit needed.
create or replace function public.hr_masked_nid(p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when private.employee_has_permission('hr.employee.view', p_employee) or private.is_self_employee(p_employee)
              then '•••• ' || right(s.nid_number, 4) end
  from public.employee_sensitive s where s.employee_id = p_employee
$$;

-- Missing information per employee, computed from the ACTIVE profile configuration.
create or replace function public.hr_missing_information(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, missing text[])
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.hub_id,
    array_remove(array[
      case when e.mobile is null then 'mobile' end,
      case when e.joining_date is null then 'joining_date' end,
      case when e.position_id is null then 'position' end,
      case when e.hub_id is null and e.zone_id is null then 'hub' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='photo' and d.archived_at is null) then 'photo' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='nid_front' and d.archived_at is null) then 'nid_front' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='nid_back' and d.archived_at is null) then 'nid_back' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='signature' and d.archived_at is null) then 'signature' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='cv' and d.archived_at is null) then 'cv' end
    ], null)
    || coalesce((select array_agg('field:' || f.code::text order by f.sort_order)
                 from public.employee_custom_fields f
                 where f.is_required and f.archived_at is null
                   and not exists (select 1 from public.employee_custom_field_values v
                                   where v.field_id = f.id and v.employee_id = e.id)), '{}')
  from public.employees e
  where e.status = 'active' and e.archived_at is null
    and (p_zone is null or e.zone_id = p_zone) and (p_hub is null or e.hub_id = p_hub)
$$;

revoke all on function public.hr_start_application(text, text, uuid, uuid, uuid), public.hr_application_missing_fields(uuid),
  public.hr_submit_application(uuid), public.hr_return_application(uuid, text), public.hr_reject_application(uuid, text),
  public.hr_approve_application(uuid, text, text), public.hr_bulk_assign_ids(jsonb, text),
  public.hr_transfer_employee(uuid, uuid, uuid, uuid, uuid, date, text, text), public.hr_change_status(uuid, text, date, text),
  public.hr_archive_employee(uuid, text), public.hr_link_login(uuid, uuid), public.hr_reveal_sensitive(uuid, text),
  public.hr_masked_nid(uuid), public.hr_missing_information(uuid, uuid) from public, anon;
grant execute on function public.hr_start_application(text, text, uuid, uuid, uuid), public.hr_application_missing_fields(uuid),
  public.hr_submit_application(uuid), public.hr_return_application(uuid, text), public.hr_reject_application(uuid, text),
  public.hr_approve_application(uuid, text, text), public.hr_bulk_assign_ids(jsonb, text),
  public.hr_transfer_employee(uuid, uuid, uuid, uuid, uuid, date, text, text), public.hr_change_status(uuid, text, date, text),
  public.hr_archive_employee(uuid, text), public.hr_link_login(uuid, uuid), public.hr_reveal_sensitive(uuid, text),
  public.hr_masked_nid(uuid), public.hr_missing_information(uuid, uuid) to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ===== 20261111000400_hr_pay_attendance.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0004: compensation, salary sheets, attendance, leave
--   Net Payable = Basic Salary + Transport + Commission + Other Allowances − Deductions
--   * Salary sheets use only APPROVED compensation records (maker ≠ checker).
--   * Approved sheets are locked; attendance in a locked month is locked.
--   * Payment is recorded later by Accounts; a sheet, voucher or signature image
--     is never treated as proof of payment.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description)
select 'hr.' || r || '.' || a, 'hr', r, a, d from (values
  ('compensation','view','View salary structure of employees in scope'),
  ('compensation','create','Propose salary / allowance changes'),
  ('compensation','approve','Approve salary / allowance changes'),
  ('compensation','reject','Reject salary / allowance changes'),
  ('compensation','configure','Configure allowance and deduction types'),
  ('salary_sheet','view','View salary sheets'),
  ('salary_sheet','create','Prepare salary sheets'),
  ('salary_sheet','approve','Approve salary sheets'),
  ('salary_sheet','export','Export / print salary sheets'),
  ('attendance','view','View attendance'),
  ('attendance','create','Record attendance'),
  ('attendance','edit','Correct attendance'),
  ('attendance','export','Export attendance reports'),
  ('leave','view','View leave requests'),
  ('leave','create','Request leave for staff'),
  ('leave','approve','Approve leave'),
  ('leave','reject','Reject leave'),
  ('leave','configure','Configure leave types')
) v(r, a, d);

-- ---------------------------------------------------------------------
-- Allowance / deduction types (configurable)
-- ---------------------------------------------------------------------
create table public.pay_component_types (
  id          uuid primary key default gen_random_uuid(),
  code        extensions.citext not null unique,
  kind        text not null check (kind in ('allowance','deduction')),
  name        text not null,
  name_bn     text,
  status      text not null default 'active' check (status in ('active','inactive')),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid
);
insert into public.pay_component_types (code, kind, name, name_bn) values
  ('mobile_bill','allowance','Mobile bill','মোবাইল বিল'),
  ('meal','allowance','Meal allowance','খাবার ভাতা'),
  ('house_rent','allowance','House rent','বাড়ি ভাড়া'),
  ('other_allowance','allowance','Other allowance','অন্যান্য ভাতা'),
  ('absence','deduction','Absence deduction','অনুপস্থিতি কর্তন'),
  ('advance_recovery','deduction','Salary advance recovery','অগ্রিম বেতন সমন্বয়'),
  ('penalty','deduction','Penalty','জরিমানা'),
  ('tax','deduction','Income tax (TDS)','আয়কর'),
  ('other_deduction','deduction','Other deduction','অন্যান্য কর্তন');

-- ---------------------------------------------------------------------
-- Compensation (salary structure per employee, effective-dated, approved)
-- ---------------------------------------------------------------------
create table public.employee_compensation (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees(id),
  effective_from      date not null,
  effective_to        date,
  basic_salary        numeric(14,2) not null check (basic_salary >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  commission          numeric(14,2) not null default 0 check (commission >= 0),  -- default monthly commission
  status              text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason              text not null,
  approved_by         uuid,
  approved_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz not null default now(), created_by uuid,
  updated_at          timestamptz not null default now(), updated_by uuid,
  constraint compensation_dates check (effective_to is null or effective_to >= effective_from),
  constraint compensation_no_overlap exclude using gist (
    employee_id with =, daterange(effective_from, effective_to, '[]') with &&) where (status = 'approved')
);
create index employee_compensation_emp_idx on public.employee_compensation (employee_id, effective_from desc);

create table public.employee_compensation_items (
  id              uuid primary key default gen_random_uuid(),
  compensation_id uuid not null references public.employee_compensation(id),
  type_id         uuid not null references public.pay_component_types(id),
  amount          numeric(14,2) not null check (amount > 0),
  created_at      timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (compensation_id, type_id)
);

-- Approved compensation is frozen except closing its end date.
create or replace function private.compensation_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('approved','rejected') then
    if old.status = 'approved' and new.status = 'approved'
       and (to_jsonb(new) - array['effective_to','updated_at','updated_by'])
           = (to_jsonb(old) - array['effective_to','updated_at','updated_by']) then
      return new;
    end if;
    raise exception 'Approved or rejected salary records cannot be changed. Propose a new record.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger compensation_guard before update on public.employee_compensation
  for each row execute function private.compensation_guard();

create or replace function private.compensation_item_guard() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.employee_compensation c
             where c.id = coalesce(new.compensation_id, old.compensation_id) and c.status <> 'pending') then
    raise exception 'Items of an approved/rejected salary record cannot change.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger compensation_item_guard before insert or update or delete on public.employee_compensation_items
  for each row execute function private.compensation_item_guard();

-- Propose salary (also used by the application preparer for a new joiner).
create or replace function public.hr_propose_compensation(
  p_employee uuid, p_effective_from date, p_basic numeric, p_transport numeric, p_commission numeric,
  p_items jsonb default '[]'::jsonb, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; it jsonb;
begin
  if not (private.employee_has_permission('hr.compensation.create', p_employee) or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised to propose salary for this employee.' using errcode = '42501';
  end if;
  if p_effective_from is null then raise exception 'Effective date is required.' using errcode = '22023'; end if;
  if exists (select 1 from public.employee_compensation where employee_id = p_employee and status = 'pending') then
    raise exception 'This employee already has a pending salary proposal.' using errcode = 'P0001';
  end if;
  insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, reason)
  values (p_employee, p_effective_from, p_basic, coalesce(p_transport, 0), coalesce(p_commission, 0),
          coalesce(nullif(trim(p_reason), ''), 'Initial salary'))
  returning id into v_id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.employee_compensation_items (compensation_id, type_id, amount)
    select v_id, t.id, (it ->> 'amount')::numeric
    from public.pay_component_types t where t.code = (it ->> 'code')::extensions.citext and t.status = 'active';
    if not found then raise exception 'Unknown allowance/deduction type %.', it ->> 'code' using errcode = '22023'; end if;
  end loop;
  return v_id;
end $$;

create or replace function public.hr_approve_compensation(p_compensation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.employee_compensation%rowtype;
begin
  select * into c from public.employee_compensation where id = p_compensation for update;
  if c.status is distinct from 'pending' then raise exception 'Only pending salary records can be approved.' using errcode = 'P0001'; end if;
  if not private.employee_has_permission('hr.compensation.approve', c.employee_id) then
    raise exception 'Not authorised to approve salary changes.' using errcode = '42501';
  end if;
  if c.created_by = auth.uid() then
    raise exception 'The person who proposed a salary change cannot approve it.' using errcode = '42501';
  end if;
  if (select status from public.employees where id = c.employee_id) = 'applicant' then
    raise exception 'A new joiner''s salary is approved together with the application.' using errcode = 'P0001';
  end if;
  update public.employee_compensation set effective_to = c.effective_from - 1
   where employee_id = c.employee_id and status = 'approved' and effective_to is null and effective_from < c.effective_from;
  if exists (select 1 from public.employee_compensation where employee_id = c.employee_id and status = 'approved'
             and daterange(effective_from, effective_to, '[]') && daterange(c.effective_from, null, '[]')) then
    raise exception 'An approved salary already exists on or after %. Back-dated changes need a correction record.', c.effective_from
      using errcode = 'P0001';
  end if;
  update public.employee_compensation set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_compensation;
end $$;

create or replace function public.hr_reject_compensation(p_compensation uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.employee_compensation%rowtype;
begin
  select * into c from public.employee_compensation where id = p_compensation for update;
  if c.status is distinct from 'pending' then raise exception 'Only pending salary records can be rejected.' using errcode = 'P0001'; end if;
  if not private.employee_has_permission('hr.compensation.reject', c.employee_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.employee_compensation set status = 'rejected', rejection_reason = p_reason where id = p_compensation;
end $$;

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.attendance_records (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  work_date   date not null,
  status      text not null check (status in ('present','late','half_day','absent','leave','holiday','weekly_off')),
  check_in    timestamptz,
  check_out   timestamptz,
  source      text not null default 'manual' check (source in ('manual','kiosk','import','leave')),
  note        text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  unique (employee_id, work_date),
  constraint attendance_times check (check_out is null or check_in is null or check_out >= check_in)
);
create index attendance_date_idx on public.attendance_records (work_date);

-- ---------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------
create table public.leave_types (
  id            uuid primary key default gen_random_uuid(),
  code          extensions.citext not null unique,
  name          text not null,
  name_bn       text,
  is_paid       boolean not null default true,
  annual_quota  numeric(5,1) check (annual_quota is null or annual_quota >= 0),  -- null = no limit
  status        text not null default 'active' check (status in ('active','inactive')),
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
insert into public.leave_types (code, name, name_bn, is_paid, annual_quota) values
  ('casual','Casual leave','নৈমিত্তিক ছুটি', true, 10),
  ('sick','Sick leave','অসুস্থতাজনিত ছুটি', true, 14),
  ('annual','Earned / annual leave','অর্জিত ছুটি', true, null),
  ('unpaid','Leave without pay','বিনা বেতনে ছুটি', false, null);

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id),
  leave_type_id uuid not null references public.leave_types(id),
  from_date     date not null,
  to_date       date not null,
  days          integer generated always as (to_date - from_date + 1) stored,
  reason        text not null check (length(trim(reason)) > 0),
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid,
  constraint leave_dates check (to_date >= from_date),
  constraint leave_no_overlap exclude using gist (
    employee_id with =, daterange(from_date, to_date, '[]') with &&) where (status in ('pending','approved'))
);
create index leave_requests_emp_idx on public.leave_requests (employee_id, from_date desc);

-- ---------------------------------------------------------------------
-- Salary sheets
-- ---------------------------------------------------------------------
create table public.salary_sheets (
  id            uuid primary key default gen_random_uuid(),
  period_month  date not null check (extract(day from period_month) = 1),
  zone_id       uuid references public.zones(id),
  hub_id        uuid references public.hubs(id),
  status        text not null default 'draft' check (status in ('draft','submitted','approved','cancelled')),
  submitted_by  uuid, submitted_at timestamptz,
  approved_by   uuid, approved_at timestamptz,
  cancel_reason text,
  note          text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create unique index salary_sheets_one_per_period on public.salary_sheets
  (period_month, coalesce(hub_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status <> 'cancelled';

create table public.salary_sheet_lines (
  id                  uuid primary key default gen_random_uuid(),
  sheet_id            uuid not null references public.salary_sheets(id),
  employee_id         uuid not null references public.employees(id),
  compensation_id     uuid references public.employee_compensation(id),
  present_days        integer not null default 0,
  leave_days          integer not null default 0,
  absent_days         integer not null default 0,
  basic_salary        numeric(14,2) not null default 0 check (basic_salary >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  commission          numeric(14,2) not null default 0 check (commission >= 0),
  other_allowances    numeric(14,2) not null default 0 check (other_allowances >= 0),
  deductions          numeric(14,2) not null default 0 check (deductions >= 0),
  net_payable         numeric(14,2) generated always as
                      (basic_salary + transport_allowance + commission + other_allowances - deductions) stored,
  adjustment_note     text,
  issue               text,      -- e.g. 'No approved salary' — blocks submission
  created_at          timestamptz not null default now(), created_by uuid,
  updated_at          timestamptz not null default now(), updated_by uuid,
  unique (sheet_id, employee_id)
);

-- Lines: only commission / allowances / deductions may be adjusted, only in draft, with a note.
create or replace function private.salary_line_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.salary_sheets where id = coalesce(new.sheet_id, old.sheet_id);
  if v_status <> 'draft' then
    raise exception 'Salary sheet is % and locked.', v_status using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and private.is_api_user() then
    if (new.employee_id, new.compensation_id, new.basic_salary, new.transport_allowance,
        new.present_days, new.leave_days, new.absent_days, new.issue, new.sheet_id)
       is distinct from
       (old.employee_id, old.compensation_id, old.basic_salary, old.transport_allowance,
        old.present_days, old.leave_days, old.absent_days, old.issue, old.sheet_id) then
      raise exception 'Basic salary, transport and attendance come from approved records and cannot be edited on the sheet.'
        using errcode = '42501';
    end if;
    if (new.commission, new.other_allowances, new.deductions) is distinct from (old.commission, old.other_allowances, old.deductions)
       and coalesce(trim(new.adjustment_note), '') = '' then
      raise exception 'Explain the adjustment in the note.' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT' and private.is_api_user() then
    raise exception 'Lines are created by generating the sheet.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger salary_line_guard before insert or update on public.salary_sheet_lines
  for each row execute function private.salary_line_guard();

create or replace function private.salary_sheet_guard() returns trigger
language plpgsql as $$
begin
  if private.is_api_user() and (new.status, new.approved_by, new.submitted_by, new.period_month, new.hub_id)
     is distinct from (old.status, old.approved_by, old.submitted_by, old.period_month, old.hub_id) then
    raise exception 'Use the salary sheet workflow functions.' using errcode = '42501';
  end if;
  if old.status = 'approved' and to_jsonb(new) - array['updated_at','updated_by'] <> to_jsonb(old) - array['updated_at','updated_by'] then
    raise exception 'Approved salary sheets are locked.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger salary_sheet_guard before update on public.salary_sheets
  for each row execute function private.salary_sheet_guard();

-- Attendance in a month covered by a submitted/approved sheet is locked.
create or replace function private.attendance_rules(p_employee uuid, p_date date, p_is_insert boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees%rowtype;
begin
  select * into e from public.employees where id = p_employee;
  if exists (select 1 from public.salary_sheet_lines l join public.salary_sheets s on s.id = l.sheet_id
             where l.employee_id = p_employee and s.status in ('submitted','approved')
               and s.period_month = date_trunc('month', p_date)::date) then
    raise exception 'Attendance for this month is locked by a submitted/approved salary sheet.' using errcode = 'P0001';
  end if;
  if p_is_insert then
    if e.status <> 'active' then raise exception 'Attendance can only be recorded for active employees.' using errcode = 'P0001'; end if;
    if e.joining_date is not null and p_date < e.joining_date then
      raise exception 'Date is before the joining date.' using errcode = '22023';
    end if;
  end if;
end $$;

create or replace function private.attendance_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.attendance_rules(new.employee_id, new.work_date, tg_op = 'INSERT');
  if tg_op = 'UPDATE' and old.work_date <> new.work_date then
    perform private.attendance_rules(old.employee_id, old.work_date, false);
  end if;
  if new.work_date > current_date then raise exception 'Attendance cannot be recorded for a future date.' using errcode = '22023'; end if;
  if private.is_api_user() and (new.status = 'leave' or new.source = 'leave')
     and (tg_op = 'INSERT' or old.status <> 'leave' or old.source <> 'leave') then
    raise exception 'Leave days come from approved leave requests.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and private.is_api_user() and coalesce(trim(new.note), '') = '' then
    raise exception 'A correction note is required.' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger attendance_guard before insert or update on public.attendance_records
  for each row execute function private.attendance_guard();

create or replace function private.leave_request_guard() returns trigger
language plpgsql as $$
begin
  if private.is_api_user() then
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception 'Leave requests start as pending.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      raise exception 'Use the leave approval / cancellation functions.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger leave_request_guard before insert or update on public.leave_requests
  for each row execute function private.leave_request_guard();

-- Stamp / audit / no-delete
do $$
declare t text;
begin
  foreach t in array array['pay_component_types','employee_compensation','attendance_records','leave_types',
                           'leave_requests','salary_sheets','salary_sheet_lines'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t||'_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''hr'')', t||'_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t||'_no_delete', t);
  end loop;
end $$;
create trigger compensation_items_audit after insert or update or delete on public.employee_compensation_items
  for each row execute function private.audit_row('hr');

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.pay_component_types        enable row level security;
alter table public.employee_compensation      enable row level security;
alter table public.employee_compensation_items enable row level security;
alter table public.attendance_records         enable row level security;
alter table public.leave_types                enable row level security;
alter table public.leave_requests             enable row level security;
alter table public.salary_sheets              enable row level security;
alter table public.salary_sheet_lines         enable row level security;

revoke all on public.pay_component_types, public.employee_compensation, public.employee_compensation_items,
  public.attendance_records, public.leave_types, public.leave_requests, public.salary_sheets,
  public.salary_sheet_lines from anon;
revoke delete, truncate on public.pay_component_types, public.employee_compensation, public.attendance_records,
  public.leave_types, public.leave_requests, public.salary_sheets, public.salary_sheet_lines from authenticated;
revoke insert, update, delete on public.employee_compensation, public.employee_compensation_items, public.salary_sheets from authenticated;
revoke insert on public.salary_sheet_lines from authenticated;

create policy pct_read on public.pay_component_types for select to authenticated using (exists (select 1 from private.my_grants()));
create policy pct_insert on public.pay_component_types for insert to authenticated with check (private.has_permission('hr.compensation.configure'));
create policy pct_update on public.pay_component_types for update to authenticated
  using (private.has_permission('hr.compensation.configure')) with check (private.has_permission('hr.compensation.configure'));

create policy comp_read on public.employee_compensation for select to authenticated
  using (private.employee_has_permission('hr.compensation.view', employee_id)
         or private.is_self_employee(employee_id) or private.is_open_draft_of_caller(employee_id));
create policy comp_items_read on public.employee_compensation_items for select to authenticated
  using (exists (select 1 from public.employee_compensation c where c.id = compensation_id));

create policy att_read on public.attendance_records for select to authenticated
  using (private.employee_has_permission('hr.attendance.view', employee_id) or private.is_self_employee(employee_id));
create policy att_insert on public.attendance_records for insert to authenticated
  with check (private.employee_has_permission('hr.attendance.create', employee_id));
create policy att_update on public.attendance_records for update to authenticated
  using (private.employee_has_permission('hr.attendance.edit', employee_id))
  with check (private.employee_has_permission('hr.attendance.edit', employee_id));

create policy lt_read on public.leave_types for select to authenticated using (exists (select 1 from private.my_grants()));
create policy lt_insert on public.leave_types for insert to authenticated with check (private.has_permission('hr.leave.configure'));
create policy lt_update on public.leave_types for update to authenticated
  using (private.has_permission('hr.leave.configure')) with check (private.has_permission('hr.leave.configure'));

create policy lr_read on public.leave_requests for select to authenticated
  using (private.employee_has_permission('hr.leave.view', employee_id) or private.is_self_employee(employee_id));
create policy lr_insert on public.leave_requests for insert to authenticated
  with check (private.is_self_employee(employee_id) or private.employee_has_permission('hr.leave.create', employee_id));

create or replace function private.salary_sheet_status(p_sheet uuid) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.salary_sheets where id = p_sheet
$$;

create policy sheets_read on public.salary_sheets for select to authenticated
  using (private.has_permission('hr.salary_sheet.view', zone_id, hub_id));
create policy lines_read on public.salary_sheet_lines for select to authenticated
  using (exists (select 1 from public.salary_sheets s where s.id = sheet_id
                 and private.has_permission('hr.salary_sheet.view', s.zone_id, s.hub_id))
         or (private.is_self_employee(employee_id) and private.salary_sheet_status(sheet_id) = 'approved'));
create policy lines_update on public.salary_sheet_lines for update to authenticated
  using (exists (select 1 from public.salary_sheets s where s.id = sheet_id and s.status = 'draft'
                 and private.has_permission('hr.salary_sheet.create', s.zone_id, s.hub_id)))
  with check (exists (select 1 from public.salary_sheets s where s.id = sheet_id and s.status = 'draft'
                 and private.has_permission('hr.salary_sheet.create', s.zone_id, s.hub_id)));

-- ---------------------------------------------------------------------
-- Leave workflow
-- ---------------------------------------------------------------------
create or replace function public.hr_decide_leave(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests%rowtype;
  t public.leave_types%rowtype;
  v_used numeric;
  d date;
  v_existing text;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.status is distinct from 'pending' then raise exception 'Only pending requests can be decided.' using errcode = 'P0001'; end if;
  if not private.employee_has_permission(case when p_approve then 'hr.leave.approve' else 'hr.leave.reject' end, r.employee_id) then
    raise exception 'Not authorised to decide this leave request.' using errcode = '42501';
  end if;
  if private.is_self_employee(r.employee_id) or r.created_by = auth.uid() then
    raise exception 'You cannot decide your own leave request or one you filed.' using errcode = '42501';
  end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'A reason is required to reject.' using errcode = '22023'; end if;
    update public.leave_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
    return;
  end if;

  select * into t from public.leave_types where id = r.leave_type_id;
  if t.annual_quota is not null then
    select coalesce(sum(days), 0) into v_used from public.leave_requests
     where employee_id = r.employee_id and leave_type_id = r.leave_type_id and status = 'approved'
       and extract(year from from_date) = extract(year from r.from_date);
    if v_used + r.days > t.annual_quota then
      raise exception '% would exceed the yearly quota (% used of %).', t.name, v_used, t.annual_quota using errcode = 'P0001';
    end if;
  end if;

  for d in select generate_series(r.from_date, r.to_date, interval '1 day')::date loop
    select status into v_existing from public.attendance_records where employee_id = r.employee_id and work_date = d;
    if v_existing in ('present','late','half_day') then
      raise exception 'Attendance on % is already marked %. Correct it first.', d, v_existing using errcode = 'P0001';
    end if;
    if d <= current_date then
      insert into public.attendance_records (employee_id, work_date, status, source, note)
      values (r.employee_id, d, 'leave', 'leave', 'Approved leave')
      on conflict (employee_id, work_date) do update set status = 'leave', source = 'leave', note = 'Approved leave';
    end if;
  end loop;
  update public.leave_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
end $$;

create or replace function public.hr_cancel_leave(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests%rowtype;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.status <> 'pending' then
    raise exception 'Only pending requests can be cancelled. Ask HR to correct approved leave.' using errcode = 'P0001';
  end if;
  if not (r.created_by = auth.uid() or private.is_self_employee(r.employee_id)) then
    raise exception 'Only the requester can cancel.' using errcode = '42501';
  end if;
  update public.leave_requests set status = 'cancelled', decision_note = p_reason where id = p_request;
end $$;

create or replace function public.hr_leave_balance(p_employee uuid, p_year integer)
returns table (leave_type text, quota numeric, used numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select t.name, t.annual_quota,
    coalesce(sum(r.days) filter (where r.status = 'approved'), 0),
    coalesce(sum(r.days) filter (where r.status = 'pending'), 0),
    case when t.annual_quota is null then null
         else t.annual_quota - coalesce(sum(r.days) filter (where r.status = 'approved'), 0) end
  from public.leave_types t
  left join public.leave_requests r on r.leave_type_id = t.id and r.employee_id = p_employee
       and extract(year from r.from_date) = p_year
  where t.status = 'active'
    and (private.employee_has_permission('hr.leave.view', p_employee) or private.is_self_employee(p_employee))
  group by t.id, t.name, t.annual_quota order by t.name
$$;

-- Monthly attendance summary (report).
create or replace function public.hr_attendance_summary(p_month date, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, present integer, late integer,
               half_day integer, absent integer, leave integer, holiday integer, weekly_off integer, not_recorded integer)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name,
    count(*) filter (where a.status = 'present')::int, count(*) filter (where a.status = 'late')::int,
    count(*) filter (where a.status = 'half_day')::int, count(*) filter (where a.status = 'absent')::int,
    count(*) filter (where a.status = 'leave')::int, count(*) filter (where a.status = 'holiday')::int,
    count(*) filter (where a.status = 'weekly_off')::int,
    (least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, current_date)
       - greatest(date_trunc('month', p_month)::date, coalesce(e.joining_date, date_trunc('month', p_month)::date)) + 1
       - count(a.id))::int
  from public.employees e
  left join public.attendance_records a on a.employee_id = e.id
       and a.work_date >= date_trunc('month', p_month)::date
       and a.work_date < (date_trunc('month', p_month) + interval '1 month')::date
  where e.status = 'active' and (p_hub is null or e.hub_id = p_hub)
  group by e.id, e.employee_code, e.full_name, e.joining_date
  order by e.full_name
$$;

-- ---------------------------------------------------------------------
-- Salary sheet workflow
-- ---------------------------------------------------------------------
create or replace function public.hr_generate_salary_sheet(p_month date, p_hub uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_zone uuid;
  v_sheet uuid;
begin
  select zone_id into v_zone from public.hubs where id = p_hub;
  if not private.has_permission('hr.salary_sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised to prepare salary sheets for this hub.' using errcode = '42501';
  end if;
  if v_month > date_trunc('month', current_date)::date then
    raise exception 'Cannot prepare a sheet for a future month.' using errcode = '22023';
  end if;
  insert into public.salary_sheets (period_month, zone_id, hub_id) values (v_month, v_zone, p_hub) returning id into v_sheet;

  insert into public.salary_sheet_lines
    (sheet_id, employee_id, compensation_id, present_days, leave_days, absent_days,
     basic_salary, transport_allowance, commission, other_allowances, deductions, issue)
  select v_sheet, e.id, c.id,
    (select count(*) from public.attendance_records a where a.employee_id = e.id and a.work_date between v_month and v_end and a.status in ('present','late','half_day')),
    (select count(*) from public.attendance_records a where a.employee_id = e.id and a.work_date between v_month and v_end and a.status = 'leave'),
    (select count(*) from public.attendance_records a where a.employee_id = e.id and a.work_date between v_month and v_end and a.status = 'absent'),
    coalesce(c.basic_salary, 0), coalesce(c.transport_allowance, 0), coalesce(c.commission, 0),
    coalesce((select sum(i.amount) from public.employee_compensation_items i join public.pay_component_types t on t.id = i.type_id
              where i.compensation_id = c.id and t.kind = 'allowance'), 0),
    coalesce((select sum(i.amount) from public.employee_compensation_items i join public.pay_component_types t on t.id = i.type_id
              where i.compensation_id = c.id and t.kind = 'deduction'), 0),
    case when c.id is null then 'No approved salary for this month' end
  from public.employees e
  left join lateral (select * from public.employee_compensation x
                     where x.employee_id = e.id and x.status = 'approved'
                       and x.effective_from <= v_end and (x.effective_to is null or x.effective_to >= v_end)
                     order by x.effective_from desc limit 1) c on true
  where e.hub_id = p_hub and e.status = 'active' and e.archived_at is null
    and (e.joining_date is null or e.joining_date <= v_end);
  return v_sheet;
end $$;

create or replace function public.hr_submit_salary_sheet(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.salary_sheets%rowtype; v_bad int;
begin
  select * into s from public.salary_sheets where id = p_sheet for update;
  if s.status <> 'draft' then raise exception 'Only draft sheets can be submitted.' using errcode = 'P0001'; end if;
  if not private.has_permission('hr.salary_sheet.create', s.zone_id, s.hub_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select count(*) into v_bad from public.salary_sheet_lines where sheet_id = p_sheet and (issue is not null or net_payable < 0);
  if v_bad > 0 then
    raise exception '% line(s) have problems (missing approved salary or negative net payable). Fix them first.', v_bad
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.salary_sheet_lines where sheet_id = p_sheet) then
    raise exception 'The sheet has no lines.' using errcode = '23514';
  end if;
  update public.salary_sheets set status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where id = p_sheet;
end $$;

create or replace function public.hr_approve_salary_sheet(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.salary_sheets%rowtype;
begin
  select * into s from public.salary_sheets where id = p_sheet for update;
  if s.status <> 'submitted' then raise exception 'Only submitted sheets can be approved.' using errcode = 'P0001'; end if;
  if not private.has_permission('hr.salary_sheet.approve', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to approve salary sheets.' using errcode = '42501';
  end if;
  if auth.uid() in (s.created_by, s.submitted_by) then
    raise exception 'The preparer of a salary sheet cannot approve it.' using errcode = '42501';
  end if;
  update public.salary_sheets set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_sheet;
end $$;

create or replace function public.hr_cancel_salary_sheet(p_sheet uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.salary_sheets%rowtype;
begin
  select * into s from public.salary_sheets where id = p_sheet for update;
  if s.status not in ('draft','submitted') then raise exception 'Approved sheets cannot be cancelled; use a correction in Accounts.' using errcode = 'P0001'; end if;
  if not private.has_permission('hr.salary_sheet.approve', s.zone_id, s.hub_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.salary_sheets set status = 'cancelled', cancel_reason = p_reason where id = p_sheet;
end $$;

revoke all on function public.hr_propose_compensation(uuid, date, numeric, numeric, numeric, jsonb, text),
  public.hr_approve_compensation(uuid), public.hr_reject_compensation(uuid, text),
  public.hr_decide_leave(uuid, boolean, text), public.hr_cancel_leave(uuid, text), public.hr_leave_balance(uuid, integer),
  public.hr_attendance_summary(date, uuid), public.hr_generate_salary_sheet(date, uuid),
  public.hr_submit_salary_sheet(uuid), public.hr_approve_salary_sheet(uuid), public.hr_cancel_salary_sheet(uuid, text)
  from public, anon;
grant execute on function public.hr_propose_compensation(uuid, date, numeric, numeric, numeric, jsonb, text),
  public.hr_approve_compensation(uuid), public.hr_reject_compensation(uuid, text),
  public.hr_decide_leave(uuid, boolean, text), public.hr_cancel_leave(uuid, text), public.hr_leave_balance(uuid, integer),
  public.hr_attendance_summary(date, uuid), public.hr_generate_salary_sheet(date, uuid),
  public.hr_submit_salary_sheet(uuid), public.hr_approve_salary_sheet(uuid), public.hr_cancel_salary_sheet(uuid, text)
  to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ===== 20261111000500_hr_import_dashboard.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0005: bulk employee import, HR dashboard,
-- storage policies for employee documents, default HR role permissions.
-- Import flow: upload rows → map columns → validate → verify (another person)
--              → commit (valid rows only; invalid rows never imported silently).
-- =====================================================================

create table public.employee_import_batches (
  id             uuid primary key default gen_random_uuid(),
  file_name      text not null,
  status         text not null default 'uploaded' check (status in ('uploaded','validated','verified','committed','cancelled')),
  column_mapping jsonb not null default '{}'::jsonb,
  total_rows     integer not null default 0,
  valid_rows     integer not null default 0,
  error_rows     integer not null default 0,
  validated_at   timestamptz,
  verified_by    uuid, verified_at timestamptz,
  committed_by   uuid, committed_at timestamptz,
  created_at     timestamptz not null default now(), created_by uuid,
  updated_at     timestamptz not null default now(), updated_by uuid
);

create table public.employee_import_rows (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.employee_import_batches(id),
  row_number  integer not null check (row_number > 0),
  raw         jsonb not null,               -- the spreadsheet row as uploaded {"Header": "value"}
  data        jsonb,                        -- after column mapping
  errors      text[] not null default '{}',
  status      text not null default 'pending' check (status in ('pending','valid','error','imported','skipped')),
  employee_id uuid references public.employees(id),
  created_at  timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (batch_id, row_number)
);

create or replace function private.import_row_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_api_user() then
    if tg_op <> 'INSERT' then raise exception 'Import rows are processed by the import functions.' using errcode = '42501'; end if;
    if (select status from public.employee_import_batches where id = new.batch_id) <> 'uploaded' then
      raise exception 'Rows can only be added while the batch is uploaded (not yet validated).' using errcode = 'P0001';
    end if;
    if new.status <> 'pending' or new.data is not null or new.employee_id is not null then
      raise exception 'New rows must be pending.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger import_row_guard before insert or update on public.employee_import_rows
  for each row execute function private.import_row_guard();

create or replace function private.import_batch_guard() returns trigger
language plpgsql as $$
begin
  if private.is_api_user() and tg_op = 'UPDATE' then
    raise exception 'Use the import functions.' using errcode = '42501';
  end if;
  if private.is_api_user() and tg_op = 'INSERT' and new.status <> 'uploaded' then
    raise exception 'New batches start as uploaded.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger import_batch_guard before insert or update on public.employee_import_batches
  for each row execute function private.import_batch_guard();

create trigger employee_import_batches_stamp before insert or update on public.employee_import_batches
  for each row execute function private.stamp_row();
create trigger employee_import_batches_audit after insert or update on public.employee_import_batches
  for each row execute function private.audit_row('hr');
create trigger employee_import_batches_no_delete before delete on public.employee_import_batches
  for each row execute function private.prevent_delete();
create trigger employee_import_rows_no_delete before delete on public.employee_import_rows
  for each row execute function private.prevent_delete();

alter table public.employee_import_batches enable row level security;
alter table public.employee_import_rows enable row level security;
revoke all on public.employee_import_batches, public.employee_import_rows from anon;
revoke update, delete, truncate on public.employee_import_batches, public.employee_import_rows from authenticated;

create policy import_batches_read on public.employee_import_batches for select to authenticated
  using (created_by = auth.uid() or private.has_permission('hr.import.approve')
         or exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve'));
create policy import_batches_insert on public.employee_import_batches for insert to authenticated
  with check (exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.create' or g.is_super));
create policy import_rows_read on public.employee_import_rows for select to authenticated
  using (exists (select 1 from public.employee_import_batches b where b.id = batch_id));
create policy import_rows_insert on public.employee_import_rows for insert to authenticated
  with check (exists (select 1 from public.employee_import_batches b where b.id = batch_id and b.created_by = auth.uid()));

-- Parse a date written as YYYY-MM-DD or DD/MM/YYYY; null if invalid.
create or replace function private.parse_date_bd(p text) returns date
language plpgsql immutable as $$
declare d date;
begin
  if p is null or trim(p) = '' then return null; end if;
  p := trim(p);
  if p ~ '^\d{4}-\d{2}-\d{2}$' then d := to_date(p, 'YYYY-MM-DD');
  elsif p ~ '^\d{1,2}/\d{1,2}/\d{4}$' then d := to_date(p, 'DD/MM/YYYY');
  else return null; end if;
  -- to_date silently rolls over invalid days (31/02 -> 03/03); reject that.
  if (p ~ '-' and to_char(d, 'YYYY-MM-DD') <> p)
     or (p ~ '/' and to_char(d, 'FMDD/FMMM/YYYY') <> regexp_replace(regexp_replace(p, '^0', ''), '/0', '/')) then
    return null;
  end if;
  return d;
exception when others then return null;
end $$;

create or replace function public.hr_validate_import(p_batch uuid, p_mapping jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record;
  m jsonb;
  errs text[];
  v_hub uuid; v_zone uuid; v_dob date; v_join date; v_min int := coalesce(private.setting_text('hr.min_age_years')::int, 18);
  allowed text[] := array['employee_code','full_name','mobile','date_of_birth','nid_number','hub_code','department_code',
                          'position_code','joining_date','basic_salary','transport_allowance','commission',
                          'emergency_contact_phone','father_name','mother_name'];
  required text[] := array['full_name','mobile','date_of_birth','nid_number','hub_code','department_code',
                           'position_code','joining_date','basic_salary'];
  f text;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.created_by <> auth.uid() and not private.has_permission('hr.import.approve') then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','validated') then raise exception 'Batch is already %.', b.status using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_each_text(p_mapping) x where x.value <> all(allowed)) then
    raise exception 'Mapping contains an unknown target field.' using errcode = '22023';
  end if;
  foreach f in array required loop
    if not exists (select 1 from jsonb_each_text(p_mapping) x where x.value = f) then
      raise exception 'Required column "%" is not mapped.', f using errcode = '22023';
    end if;
  end loop;

  for r in select * from public.employee_import_rows where batch_id = p_batch order by row_number loop
    select coalesce(jsonb_object_agg(mp.value, nullif(trim(r.raw ->> mp.key), '')), '{}'::jsonb) into m
    from jsonb_each_text(p_mapping) mp;
    errs := '{}';
    foreach f in array required loop
      if m ->> f is null then errs := errs || ('Missing ' || f); end if;
    end loop;
    if m ? 'mobile' and m ->> 'mobile' is not null and m ->> 'mobile' !~ private.setting_text('hr.mobile_pattern') then
      errs := array_append(errs, 'Invalid mobile'::text); end if;
    if m ->> 'nid_number' is not null and m ->> 'nid_number' !~ private.setting_text('hr.nid_pattern') then
      errs := array_append(errs, 'Invalid NID'::text); end if;
    v_dob := private.parse_date_bd(m ->> 'date_of_birth');
    v_join := private.parse_date_bd(m ->> 'joining_date');
    if m ->> 'date_of_birth' is not null and v_dob is null then errs := array_append(errs, 'Invalid date_of_birth'::text); end if;
    if m ->> 'joining_date' is not null and v_join is null then errs := array_append(errs, 'Invalid joining_date'::text); end if;
    if v_dob is not null and v_dob > coalesce(v_join, current_date) - make_interval(years => v_min) then
      errs := errs || ('Younger than ' || v_min); end if;
    if v_join is not null and v_join > current_date + 60 then errs := array_append(errs, 'Joining date too far in future'::text); end if;
    if m ->> 'basic_salary' is not null and (m ->> 'basic_salary') !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid basic_salary'::text); end if;
    if m ->> 'transport_allowance' is not null and (m ->> 'transport_allowance') !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid transport_allowance'::text); end if;
    if m ->> 'commission' is not null and (m ->> 'commission') !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid commission'::text); end if;
    v_hub := null; v_zone := null;
    select id, zone_id into v_hub, v_zone from public.hubs where code = (m ->> 'hub_code')::extensions.citext and archived_at is null;
    if m ->> 'hub_code' is not null and v_hub is null then errs := array_append(errs, 'Unknown hub_code'::text); end if;
    if v_hub is not null and not private.has_permission('hr.import.create', v_zone, v_hub) then errs := array_append(errs, 'Hub outside your scope'::text); end if;
    if m ->> 'department_code' is not null and not exists (select 1 from public.departments where code = (m ->> 'department_code')::extensions.citext) then
      errs := array_append(errs, 'Unknown department_code'::text); end if;
    if m ->> 'position_code' is not null and not exists (select 1 from public.positions where code = (m ->> 'position_code')::extensions.citext) then
      errs := array_append(errs, 'Unknown position_code'::text); end if;
    if m ->> 'employee_code' is not null then
      if upper(m ->> 'employee_code') !~ private.setting_text('hr.employee_code_pattern') then errs := array_append(errs, 'Invalid employee_code format'::text); end if;
      if exists (select 1 from public.employees where employee_code = (m ->> 'employee_code')::extensions.citext) then errs := array_append(errs, 'employee_code already exists'::text); end if;
    end if;
    if exists (select 1 from public.employee_sensitive where nid_number = m ->> 'nid_number') then errs := array_append(errs, 'NID already exists'::text); end if;
    if exists (select 1 from public.employees where mobile = m ->> 'mobile' and status <> 'rejected' and archived_at is null) then errs := array_append(errs, 'Mobile already exists'::text); end if;
    -- duplicates inside the same file
    if exists (select 1 from public.employee_import_rows o where o.batch_id = p_batch and o.row_number <> r.row_number
               and ((o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'nid_number' limit 1)) = m ->> 'nid_number'
                 or (o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'mobile' limit 1)) = m ->> 'mobile'
                 or (m ->> 'employee_code' is not null and upper(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'employee_code' limit 1)) = upper(m ->> 'employee_code')))) then
      errs := array_append(errs, 'Duplicate of another row in this file'::text);
    end if;
    update public.employee_import_rows
       set data = m, errors = errs, status = case when cardinality(errs) = 0 then 'valid' else 'error' end
     where id = r.id;
  end loop;

  update public.employee_import_batches b2
     set status = 'validated', column_mapping = p_mapping, validated_at = now(),
         total_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch),
         valid_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch and status = 'valid'),
         error_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch and status = 'error'),
         verified_by = null, verified_at = null
   where b2.id = p_batch;
  return (select jsonb_build_object('total', total_rows, 'valid', valid_rows, 'errors', error_rows)
          from public.employee_import_batches where id = p_batch);
end $$;

create or replace function public.hr_verify_import(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.employee_import_batches%rowtype;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.status <> 'validated' then raise exception 'Validate the batch first.' using errcode = 'P0001'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve' or g.is_super) then
    raise exception 'Not authorised to verify imports.' using errcode = '42501';
  end if;
  if b.created_by = auth.uid() then raise exception 'The uploader cannot verify their own import.' using errcode = '42501'; end if;
  update public.employee_import_batches set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_batch;
end $$;

create or replace function public.hr_commit_import(p_batch uuid, p_skip_invalid boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record; d jsonb; v_emp uuid; v_hub uuid; v_code text; n_active int := 0; n_app int := 0; v_join date;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.status <> 'verified' then raise exception 'Only verified batches can be committed.' using errcode = 'P0001'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.error_rows > 0 and not p_skip_invalid then
    raise exception '% row(s) have errors. Fix the file, or explicitly choose to skip invalid rows (they stay listed in the error report).', b.error_rows
      using errcode = 'P0001';
  end if;

  for r in select * from public.employee_import_rows where batch_id = p_batch and status = 'valid' order by row_number loop
    d := r.data;
    v_code := upper(d ->> 'employee_code');
    v_join := private.parse_date_bd(d ->> 'joining_date');
    select id into v_hub from public.hubs where code = (d ->> 'hub_code')::extensions.citext;
    insert into public.employees (employee_code, full_name, mobile, emergency_contact_phone, hub_id, department_id, position_id,
                                  joining_date, status, status_since, created_by)
    values (v_code, d ->> 'full_name', d ->> 'mobile', d ->> 'emergency_contact_phone', v_hub,
            (select id from public.departments where code = (d ->> 'department_code')::extensions.citext),
            (select id from public.positions where code = (d ->> 'position_code')::extensions.citext),
            v_join, case when v_code is null then 'applicant' else 'active' end, coalesce(v_join, current_date), b.created_by)
    returning id into v_emp;
    insert into public.employee_sensitive (employee_id, nid_number, date_of_birth, father_name, mother_name)
    values (v_emp, d ->> 'nid_number', private.parse_date_bd(d ->> 'date_of_birth'), d ->> 'father_name', d ->> 'mother_name');
    insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, reason,
                                              status, approved_by, approved_at, created_by)
    values (v_emp, coalesce(v_join, current_date), (d ->> 'basic_salary')::numeric, coalesce((d ->> 'transport_allowance')::numeric, 0),
            coalesce((d ->> 'commission')::numeric, 0), 'Imported (batch ' || b.file_name || ')',
            case when v_code is null then 'pending' else 'approved' end,
            case when v_code is null then null else b.verified_by end,
            case when v_code is null then null else now() end, b.created_by);
    if v_code is null then
      insert into public.employee_applications (employee_id, status, submitted_by, submitted_at, created_by)
      values (v_emp, 'submitted', b.created_by, now(), b.created_by);
      n_app := n_app + 1;
    else
      insert into public.employee_assignments (employee_id, change_type, department_id, position_id, zone_id, hub_id, effective_from, reason)
      select e.id, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, coalesce(v_join, current_date), 'Imported'
      from public.employees e where e.id = v_emp;
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (v_emp, null, 'active', coalesce(v_join, current_date), 'Imported, verified by HR');
      n_active := n_active + 1;
    end if;
    update public.employee_import_rows set status = 'imported', employee_id = v_emp where id = r.id;
  end loop;
  update public.employee_import_rows set status = 'skipped' where batch_id = p_batch and status = 'error';
  update public.employee_import_batches set status = 'committed', committed_by = auth.uid(), committed_at = now() where id = p_batch;
  return jsonb_build_object('activated', n_active, 'awaiting_employee_id', n_app, 'skipped', b.error_rows);
end $$;

-- ---------------------------------------------------------------------
-- HR dashboard (runs as the caller: counts only what the caller may see)
-- ---------------------------------------------------------------------
create or replace function public.hr_dashboard(p_from date, p_to date, p_zone uuid default null, p_hub uuid default null)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with e as (
    select * from public.employees
    where archived_at is null and (p_zone is null or zone_id = p_zone) and (p_hub is null or hub_id = p_hub)
  )
  select jsonb_build_object(
    'total_employees',      (select count(*) from e where status in ('active','inactive')),
    'active',               (select count(*) from e where status = 'active'),
    'inactive',             (select count(*) from e where status = 'inactive'),
    'new_joining',          (select count(*) from e where status not in ('applicant','rejected') and joining_date between p_from and p_to),
    'resigned',             (select count(*) from public.employee_status_history h join e on e.id = h.employee_id
                              where h.to_status = 'resigned' and h.effective_date between p_from and p_to),
    'terminated',           (select count(*) from public.employee_status_history h join e on e.id = h.employee_id
                              where h.to_status = 'terminated' and h.effective_date between p_from and p_to),
    'transferred',          (select count(*) from public.employee_assignments a join e on e.id = a.employee_id
                              where a.change_type = 'transfer' and a.effective_from between p_from and p_to),
    'pending_applications', (select count(*) from public.employee_applications a join e on e.id = a.employee_id
                              where a.status = 'submitted'),
    'pending_leave',        (select count(*) from public.leave_requests l join e on e.id = l.employee_id where l.status = 'pending'),
    'pending_salary_changes', (select count(*) from public.employee_compensation c join e on e.id = c.employee_id
                              where c.status = 'pending' and e.status <> 'applicant'),
    'employees_with_missing_info', (select count(*) from public.hr_missing_information(p_zone, p_hub) mi where cardinality(mi.missing) > 0)
  )
$$;

revoke all on function public.hr_validate_import(uuid, jsonb), public.hr_verify_import(uuid),
  public.hr_commit_import(uuid, boolean), public.hr_dashboard(date, date, uuid, uuid) from public, anon;
grant execute on function public.hr_validate_import(uuid, jsonb), public.hr_verify_import(uuid),
  public.hr_commit_import(uuid, boolean), public.hr_dashboard(date, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: private bucket for employee files (only on Supabase, where the
-- storage schema exists). File access = access to its document row.
-- ---------------------------------------------------------------------
create or replace function private.can_read_employee_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_documents d
    where d.storage_path = p_name and d.archived_at is null
      and (private.is_self_employee(d.employee_id)
           or private.is_open_draft_of_caller(d.employee_id)
           or (d.doc_type in ('nid_front','nid_back') and private.employee_has_permission('hr.employee_sensitive.view', d.employee_id))
           or (d.doc_type not in ('nid_front','nid_back') and private.employee_has_permission('hr.document.view', d.employee_id))))
$$;

create or replace function private.can_upload_employee_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid;
begin
  if p_name !~ '^employee/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  v_emp := split_part(p_name, '/', 2)::uuid;
  return private.employee_has_permission('hr.document.create', v_emp) or private.is_open_draft_of_caller(v_emp);
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'buckets') then
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('employee-docs', 'employee-docs', false, 10485760,
                     array['image/jpeg','image/png','image/webp','application/pdf'])
             on conflict (id) do nothing$q$;
    execute $q$create policy employee_docs_read on storage.objects for select to authenticated
             using (bucket_id = 'employee-docs' and private.can_read_employee_object(name))$q$;
    execute $q$create policy employee_docs_upload on storage.objects for insert to authenticated
             with check (bucket_id = 'employee-docs' and private.can_upload_employee_object(name))$q$;
    -- no update/delete policies: originals are never overwritten or removed through the API.
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Default HR permissions per role (editable later by Super Admin)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'hr' and (
     r.code in ('admin','hr_manager')
  or (r.code = 'head_office_manager' and p.action in ('view','export') and p.resource <> 'employee_sensitive')
  or (r.code = 'auditor' and p.action in ('view','export') and p.resource <> 'employee_sensitive')
  or (r.code = 'zonal_manager' and p.code in ('hr.employee.view','hr.application.view','hr.application.create',
        'hr.document.view','hr.document.create','hr.attendance.view','hr.attendance.export','hr.leave.view',
        'hr.leave.approve','hr.leave.reject','hr.compensation.view','hr.salary_sheet.view'))
  or (r.code = 'hub_manager' and p.code in ('hr.employee.view','hr.application.view','hr.application.create',
        'hr.document.view','hr.document.create','hr.attendance.view','hr.attendance.create','hr.attendance.edit',
        'hr.leave.view','hr.leave.create','hr.leave.approve','hr.leave.reject','hr.compensation.view',
        'hr.salary_sheet.view','hr.salary_sheet.create'))
  or (r.code = 'accounts_manager' and p.code in ('hr.employee.view','hr.compensation.view','hr.salary_sheet.view',
        'hr.salary_sheet.approve','hr.salary_sheet.export'))
  or (r.code = 'accountant' and p.code in ('hr.employee.view','hr.compensation.view','hr.salary_sheet.view','hr.salary_sheet.export'))
  or (r.code in ('operations_manager','pickup_manager','delivery_manager') and p.code in ('hr.employee.view','hr.attendance.view'))
)
on conflict do nothing;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ===== 20261111000600_zonal_management.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0006: Zonal management, analytics, workforce planning
--   * hub_daily_metrics   daily hub figures (pickup, delivery, merchants, rider
--                         capacity, cash, expenses, backlog, hours). Entered by the
--                         hub, verified by a second person. Only VERIFIED rows
--                         feed dashboards, reports and planning.
--   * hub_visits          Zonal Manager hub visits with km / fuel / meal /
--                         transport / other expenses
--   * travel_claims       weekly or monthly claim over the visits; approver is
--                         never the claimant; approval records the voucher number
--   * tasks, task_reminders   assignment, deadlines, submissions, accountability
--   * workforce_recommendations   saved planning recommendations (advisory only)
--   * dashboard, drill-down, comparison, data-completion and report functions
-- Rules:
--   * Planning output is ADVICE. Nothing in this migration hires, dismisses,
--     transfers, changes pay or disciplines anyone. Those stay in the audited
--     HR workflows and need an authorised person.
--   * Every figure is limited to the caller's zone / hub scope.
--   * Nothing is deleted.
-- NOTE: the detailed courier tables (parcels, pickups, cash handovers) are a
-- separate module. Until they exist, hub_daily_metrics is the operational
-- source; later that module will write the same rows from approved records.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'zonal.' || r || '.' || a, 'zonal', r, a, d from (values
  ('dashboard','view','Open the Zonal Manager dashboard'),
  ('hub_metric','view','View daily hub figures'),
  ('hub_metric','create','Enter daily hub figures'),
  ('hub_metric','approve','Verify or reopen daily hub figures'),
  ('visit','view','View hub visit reports of others'),
  ('visit','create','Record own hub visits and travel expenses'),
  ('claim','view','View travel claims'),
  ('claim','create','Submit travel claims'),
  ('claim','approve','Approve travel claims and record the voucher'),
  ('claim','reject','Return or reject travel claims'),
  ('task','view','View tasks in scope'),
  ('task','create','Assign tasks'),
  ('task','edit','Reassign, confirm or cancel tasks'),
  ('planning','view','View workforce planning recommendations'),
  ('planning','create','Save workforce planning recommendations'),
  ('planning','edit','Acknowledge or dismiss recommendations'),
  ('report','view','View zonal reports'),
  ('report','export','Export zonal reports (PDF / Excel)'),
  ('report','print','Print zonal reports')
) v(r, a, d);

-- Planning assumptions are configuration, not code.
insert into public.system_settings (key, value, description) values
  ('zonal.parcels_per_rider_day',  '45',  'Planning: parcels one rider can handle per day (pickup + delivery)'),
  ('zonal.backlog_clear_days',     '3',   'Planning: days within which a backlog should be cleared'),
  ('zonal.backlog_alert_days',     '1.5', 'Planning: backlog above this many days of deliveries needs review'),
  ('zonal.max_rider_hours_per_day','10',  'Planning: average rider hours per day above this needs review'),
  ('zonal.planning_min_days',      '5',   'Planning: minimum verified days of figures before any recommendation');

-- ---------------------------------------------------------------------
-- Daily hub figures
-- ---------------------------------------------------------------------
create table public.hub_daily_metrics (
  id              uuid primary key default gen_random_uuid(),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),   -- always follows the hub
  metric_date     date not null,
  pickup_count    integer not null default 0 check (pickup_count >= 0),
  delivery_count  integer not null default 0 check (delivery_count >= 0),
  pending_parcels integer not null default 0 check (pending_parcels >= 0),   -- backlog at end of day
  merchant_count  integer not null default 0 check (merchant_count >= 0),    -- merchants served
  rider_count     integer not null default 0 check (rider_count >= 0),       -- riders on duty
  rider_capacity  integer not null default 0 check (rider_capacity >= 0),    -- parcels those riders can handle
  working_hours   numeric(8,2) not null default 0 check (working_hours >= 0),-- total rider hours
  cash_collected  numeric(14,2) not null default 0 check (cash_collected >= 0),
  expenses        numeric(14,2) not null default 0 check (expenses >= 0),
  note            text,
  status          text not null default 'submitted' check (status in ('submitted','verified')),
  verified_by     uuid,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint hub_daily_metrics_one_per_day unique (hub_id, metric_date),
  constraint hub_daily_metrics_hours_chk check (working_hours <= rider_count * 24)
);
create index hub_daily_metrics_zone_idx on public.hub_daily_metrics (zone_id, metric_date);

create or replace function private.hub_metric_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker: see note in the HR migration
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if new.metric_date > current_date then
    raise exception 'Figures cannot be entered for a future date.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if private.is_api_user() and (new.status <> 'submitted' or new.verified_by is not null or new.verified_at is not null) then
      raise exception 'New figures start as submitted. A second person verifies them.' using errcode = '42501';
    end if;
    return new;
  end if;
  if private.is_api_user() then
    if old.status = 'verified' then
      raise exception 'Verified figures are locked. Ask a verifier to reopen them with a reason.' using errcode = '42501';
    end if;
    if (new.status, new.verified_by, new.verified_at, new.hub_id, new.metric_date)
       is distinct from (old.status, old.verified_by, old.verified_at, old.hub_id, old.metric_date) then
      raise exception 'Hub, date and verification state cannot be changed directly.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger hub_daily_metrics_guard before insert or update on public.hub_daily_metrics
  for each row execute function private.hub_metric_guard();

create or replace function public.zm_verify_hub_metric(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.hub_daily_metrics%rowtype;
begin
  select * into m from public.hub_daily_metrics where id = p_id for update;
  if m.id is null or not private.has_permission('zonal.hub_metric.approve', m.zone_id, m.hub_id) then
    raise exception 'Record not found or not authorised to verify.' using errcode = '42501';
  end if;
  if m.status = 'verified' then raise exception 'These figures are already verified.' using errcode = 'P0001'; end if;
  if m.created_by = auth.uid() then
    raise exception 'The person who entered the figures cannot verify them.' using errcode = '42501';
  end if;
  update public.hub_daily_metrics set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_id;
end $$;

create or replace function public.zm_reopen_hub_metric(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.hub_daily_metrics%rowtype;
begin
  select * into m from public.hub_daily_metrics where id = p_id for update;
  if m.id is null or not private.has_permission('zonal.hub_metric.approve', m.zone_id, m.hub_id) then
    raise exception 'Record not found or not authorised.' using errcode = '42501';
  end if;
  if m.status <> 'verified' then raise exception 'Only verified figures can be reopened.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.hub_daily_metrics set status = 'submitted', verified_by = null, verified_at = null where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Hub visits and travel claims
-- ---------------------------------------------------------------------
create sequence public.travel_claim_no_seq;

create table public.travel_claims (
  id               uuid primary key default gen_random_uuid(),
  claim_no         text not null unique default ('TC-' || lpad(nextval('public.travel_claim_no_seq')::text, 6, '0')),
  claimant_id      uuid not null references public.profiles(id),
  zone_id          uuid not null references public.zones(id),
  period_type      text not null check (period_type in ('weekly','monthly')),
  period_from      date not null,
  period_to        date not null,
  visit_count      integer not null check (visit_count > 0),
  total_km         numeric(10,1) not null default 0,
  fuel_amount      numeric(14,2) not null default 0,
  meal_amount      numeric(14,2) not null default 0,
  transport_amount numeric(14,2) not null default 0,
  other_amount     numeric(14,2) not null default 0,
  total_amount     numeric(14,2) not null default 0,
  status           text not null default 'submitted' check (status in ('submitted','approved','rejected','returned')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  voucher_no       text,          -- voucher reference recorded by the approver
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint travel_claims_period_chk check (period_to >= period_from),
  constraint travel_claims_voucher_chk check (status <> 'approved' or length(trim(coalesce(voucher_no, ''))) > 0)
);
create index travel_claims_zone_idx on public.travel_claims (zone_id, period_from);
create index travel_claims_claimant_idx on public.travel_claims (claimant_id, period_from);

create table public.hub_visits (
  id               uuid primary key default gen_random_uuid(),
  visitor_id       uuid not null default auth.uid() references public.profiles(id),
  hub_id           uuid not null references public.hubs(id),
  zone_id          uuid not null references public.zones(id),
  visit_date       date not null,
  purpose          text not null check (length(trim(purpose)) > 2),
  findings         text,
  distance_km      numeric(8,1) not null default 0 check (distance_km >= 0 and distance_km <= 2000),
  fuel_amount      numeric(12,2) not null default 0 check (fuel_amount >= 0),
  meal_amount      numeric(12,2) not null default 0 check (meal_amount >= 0),
  transport_amount numeric(12,2) not null default 0 check (transport_amount >= 0),
  other_amount     numeric(12,2) not null default 0 check (other_amount >= 0),
  other_note       text,
  total_amount     numeric(14,2) generated always as (fuel_amount + meal_amount + transport_amount + other_amount) stored,
  claim_id         uuid references public.travel_claims(id),
  archived_at      timestamptz,
  archived_by      uuid,
  archive_reason   text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint hub_visits_other_note_chk check (other_amount = 0 or length(trim(coalesce(other_note, ''))) > 0),
  constraint hub_visits_archive_chk check (archived_at is null or length(trim(coalesce(archive_reason, ''))) > 0)
);
create index hub_visits_visitor_idx on public.hub_visits (visitor_id, visit_date);
create index hub_visits_zone_idx on public.hub_visits (zone_id, visit_date);
create index hub_visits_claim_idx on public.hub_visits (claim_id);

create or replace function private.hub_visit_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if new.visit_date > current_date then
    raise exception 'A visit cannot be recorded for a future date.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if private.is_api_user() then
      new.visitor_id := auth.uid();
      if new.claim_id is not null or new.archived_at is not null then
        raise exception 'New visits cannot be created as claimed or archived.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if private.is_api_user() then
    if old.claim_id is not null then
      raise exception 'This visit is part of a submitted claim and can no longer be changed.' using errcode = '42501';
    end if;
    if old.archived_at is not null then
      raise exception 'Archived visits are read-only.' using errcode = '42501';
    end if;
    if (new.claim_id, new.visitor_id) is distinct from (old.claim_id, old.visitor_id) then
      raise exception 'Claim link and visitor cannot be changed directly.' using errcode = '42501';
    end if;
    if new.archived_at is not null then new.archived_by := auth.uid(); end if;
  end if;
  return new;
end $$;
create trigger hub_visits_guard before insert or update on public.hub_visits
  for each row execute function private.hub_visit_guard();

-- Bundle the caller's unclaimed visits of one week or month into a claim.
create or replace function public.zm_submit_claim(p_zone uuid, p_period_type text, p_from date, p_to date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v record;
begin
  if p_zone is null or p_from is null or p_to is null then
    raise exception 'Zone and period are required.' using errcode = '22023';
  end if;
  if not private.has_permission('zonal.claim.create', p_zone) then
    raise exception 'Not authorised to submit travel claims for this zone.' using errcode = '42501';
  end if;
  if p_period_type = 'weekly' then
    if p_to - p_from <> 6 then raise exception 'A weekly claim covers exactly 7 days.' using errcode = '22023'; end if;
  elsif p_period_type = 'monthly' then
    if p_from <> date_trunc('month', p_from::timestamp)::date
       or p_to <> (date_trunc('month', p_from::timestamp) + interval '1 month' - interval '1 day')::date then
      raise exception 'A monthly claim covers one full calendar month.' using errcode = '22023';
    end if;
  else
    raise exception 'Period type must be weekly or monthly.' using errcode = '22023';
  end if;

  select count(*)::int as n, coalesce(sum(hv.distance_km), 0) as km, coalesce(sum(hv.fuel_amount), 0) as fuel,
         coalesce(sum(hv.meal_amount), 0) as meal, coalesce(sum(hv.transport_amount), 0) as transport,
         coalesce(sum(hv.other_amount), 0) as other, coalesce(sum(hv.total_amount), 0) as total
    into v
  from public.hub_visits hv
  where hv.visitor_id = auth.uid() and hv.zone_id = p_zone and hv.visit_date between p_from and p_to
    and hv.claim_id is null and hv.archived_at is null;
  if v.n = 0 then
    raise exception 'There are no unclaimed visits in this period.' using errcode = 'P0001';
  end if;

  insert into public.travel_claims (claimant_id, zone_id, period_type, period_from, period_to, visit_count,
                                    total_km, fuel_amount, meal_amount, transport_amount, other_amount, total_amount)
  values (auth.uid(), p_zone, p_period_type, p_from, p_to, v.n, v.km, v.fuel, v.meal, v.transport, v.other, v.total)
  returning id into v_id;

  update public.hub_visits hv set claim_id = v_id
  where hv.visitor_id = auth.uid() and hv.zone_id = p_zone and hv.visit_date between p_from and p_to
    and hv.claim_id is null and hv.archived_at is null;
  return v_id;
end $$;

-- Approve (voucher number required), reject, or return for correction.
create or replace function public.zm_decide_claim(p_claim uuid, p_decision text, p_note text default null, p_voucher_no text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare c public.travel_claims%rowtype;
begin
  select * into c from public.travel_claims where id = p_claim for update;
  if p_decision not in ('approved','rejected','returned') then
    raise exception 'Decision must be approved, rejected or returned.' using errcode = '22023';
  end if;
  if c.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'zonal.claim.approve' else 'zonal.claim.reject' end, c.zone_id) then
    raise exception 'Claim not found or not authorised.' using errcode = '42501';
  end if;
  if c.claimant_id = auth.uid() then
    raise exception 'You cannot decide your own travel claim.' using errcode = '42501';
  end if;
  if c.status <> 'submitted' then
    raise exception 'This claim has already been decided.' using errcode = 'P0001';
  end if;
  if p_decision = 'approved' and coalesce(trim(p_voucher_no), '') = '' then
    raise exception 'A voucher number is required to approve a claim.' using errcode = '22023';
  end if;
  if p_decision <> 'approved' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a claim is returned or rejected.' using errcode = '22023';
  end if;

  perform set_config('app.change_reason', coalesce(p_note, p_decision), true);
  update public.travel_claims
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
         voucher_no = case when p_decision = 'approved' then trim(p_voucher_no) end
   where id = p_claim;
  if p_decision = 'returned' then   -- visits become editable again and can be claimed anew
    update public.hub_visits set claim_id = null where claim_id = p_claim;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------
create sequence public.task_no_seq;

create table public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  task_no                text not null unique default ('T-' || lpad(nextval('public.task_no_seq')::text, 6, '0')),
  title                  text not null check (length(trim(title)) > 2),
  description            text,
  zone_id                uuid references public.zones(id),     -- null = company-wide
  hub_id                 uuid references public.hubs(id),
  assigned_to            uuid not null references public.profiles(id),
  accountable_manager_id uuid not null references public.profiles(id),  -- answers for the result
  related_employee_id    uuid references public.employees(id),
  due_date               date not null,
  priority               text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  requires_submission    boolean not null default false,   -- assignee submits, manager confirms
  status                 text not null default 'assigned'
                         check (status in ('assigned','in_progress','submitted','completed','cancelled')),
  progress_note          text,
  submission_note        text,
  submitted_at           timestamptz,
  completed_at           timestamptz,
  completed_by           uuid,
  completion_note        text,
  cancelled_reason       text,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);
create index tasks_assignee_idx on public.tasks (assigned_to) where status not in ('completed','cancelled');
create index tasks_manager_idx on public.tasks (accountable_manager_id, due_date);
create index tasks_scope_idx on public.tasks (zone_id, hub_id, status);
create index tasks_due_idx on public.tasks (due_date) where status not in ('completed','cancelled');

create table public.task_reminders (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id),
  remind_at   timestamptz not null,
  note        text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index task_reminders_due_idx on public.task_reminders (remind_at) where sent_at is null;

create or replace function private.task_scope_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.hub_id is not null then new.zone_id := private.hub_zone(new.hub_id); end if;
  return new;
end $$;
create trigger tasks_scope_guard before insert or update on public.tasks
  for each row execute function private.task_scope_guard();

-- May the caller manage (confirm / reassign / cancel) this task?
create or replace function private.task_is_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select t.accountable_manager_id = auth.uid() or t.created_by = auth.uid()
                          or private.has_permission('zonal.task.edit', t.zone_id, t.hub_id)
                   from public.tasks t where t.id = p_task), false)
$$;

create or replace function public.task_assign(
  p_title text, p_assignee uuid, p_due date,
  p_zone uuid default null, p_hub uuid default null, p_description text default null,
  p_priority text default 'normal', p_requires_submission boolean default false,
  p_manager uuid default null, p_employee uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := p_zone;
  v_id uuid;
begin
  if p_hub is not null then v_zone := private.hub_zone(p_hub); end if;
  if not private.has_permission('zonal.task.create', v_zone, p_hub) then
    raise exception 'Not authorised to assign tasks in this scope.' using errcode = '42501';
  end if;
  if p_due is null or p_due < current_date then
    raise exception 'The deadline must be today or later.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_assignee and p.status = 'active' and p.archived_at is null) then
    raise exception 'The assignee must be an active user.' using errcode = '22023';
  end if;
  if p_manager is not null and not exists (select 1 from public.profiles p where p.id = p_manager and p.status = 'active') then
    raise exception 'The accountable manager must be an active user.' using errcode = '22023';
  end if;

  insert into public.tasks (title, description, zone_id, hub_id, assigned_to, accountable_manager_id,
                            related_employee_id, due_date, priority, requires_submission)
  values (p_title, p_description, v_zone, p_hub, p_assignee, coalesce(p_manager, auth.uid()),
          p_employee, p_due, coalesce(p_priority, 'normal'), coalesce(p_requires_submission, false))
  returning id into v_id;

  -- default reminder: 09:00 on the day before the deadline
  if p_due - 1 > current_date then
    insert into public.task_reminders (task_id, remind_at, note)
    values (v_id, (p_due - 1) + time '09:00', 'Deadline tomorrow');
  end if;
  return v_id;
end $$;

-- Assignee: start work, or submit the result for confirmation.
create or replace function public.task_update_progress(p_task uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or t.assigned_to <> auth.uid() then
    raise exception 'Only the assignee can update progress on a task.' using errcode = '42501';
  end if;
  if p_status not in ('in_progress','submitted') then
    raise exception 'Status must be in_progress or submitted.' using errcode = '22023';
  end if;
  if t.status not in ('assigned','in_progress') then
    raise exception 'This task is % and cannot be updated.', t.status using errcode = 'P0001';
  end if;
  if p_status = 'submitted' and coalesce(trim(p_note), '') = '' then
    raise exception 'Describe what was done when submitting a task.' using errcode = '22023';
  end if;
  if p_status = 'submitted' then
    update public.tasks set status = 'submitted', submission_note = p_note, submitted_at = now() where id = p_task;
  else
    update public.tasks set status = 'in_progress', progress_note = coalesce(p_note, progress_note) where id = p_task;
  end if;
end $$;

-- Manager: send a submission back for more work.
create or replace function public.task_return(p_task uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not private.task_is_manager(p_task) or t.assigned_to = auth.uid() then
    raise exception 'Only the accountable manager can return a submission.' using errcode = '42501';
  end if;
  if t.status <> 'submitted' then raise exception 'Only submitted tasks can be returned.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_note, true);
  update public.tasks set status = 'in_progress', progress_note = 'Returned: ' || p_note, submitted_at = null where id = p_task;
end $$;

-- Completion. Tasks that require a submission are confirmed by the manager,
-- never by the assignee.
create or replace function public.task_complete(p_task uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks%rowtype;
  v_mgr boolean;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found or not authorised.' using errcode = '42501'; end if;
  v_mgr := private.task_is_manager(p_task);
  if not (v_mgr or t.assigned_to = auth.uid()) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then
    raise exception 'This task is already %.', t.status using errcode = 'P0001';
  end if;
  if t.requires_submission then
    if t.status <> 'submitted' then
      raise exception 'The assignee must submit the result before this task can be confirmed.' using errcode = 'P0001';
    end if;
    if not v_mgr or t.assigned_to = auth.uid() then
      raise exception 'A submitted task is confirmed by the accountable manager, not by the assignee.' using errcode = '42501';
    end if;
  end if;
  update public.tasks set status = 'completed', completed_at = now(), completed_by = auth.uid(), completion_note = p_note
   where id = p_task;
end $$;

create or replace function public.task_reassign(p_task uuid, p_assignee uuid, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not private.task_is_manager(p_task) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then raise exception 'This task is closed.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_due is null or p_due < current_date then raise exception 'The deadline must be today or later.' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_assignee and p.status = 'active' and p.archived_at is null) then
    raise exception 'The assignee must be an active user.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.tasks set assigned_to = p_assignee, due_date = p_due, status = 'assigned',
         submission_note = null, submitted_at = null where id = p_task;
end $$;

create or replace function public.task_cancel(p_task uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not private.task_is_manager(p_task) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then raise exception 'This task is closed.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.tasks set status = 'cancelled', cancelled_reason = p_reason where id = p_task;
end $$;

create or replace function public.task_add_reminder(p_task uuid, p_remind_at timestamptz, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks%rowtype;
  v_id uuid;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not (t.assigned_to = auth.uid() or private.task_is_manager(p_task)) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then raise exception 'This task is closed.' using errcode = 'P0001'; end if;
  if p_remind_at is null or p_remind_at <= now() then
    raise exception 'The reminder time must be in the future.' using errcode = '22023';
  end if;
  insert into public.task_reminders (task_id, remind_at, note) values (p_task, p_remind_at, p_note) returning id into v_id;
  return v_id;
end $$;

-- Called by the scheduled server job (service role only). Marks due reminders
-- as sent and returns them so the job can deliver the notifications.
create or replace function public.task_due_reminders()
returns table (reminder_id uuid, task_id uuid, task_no text, title text, assigned_to uuid, due_date date, note text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  update public.task_reminders r set sent_at = now()
  from public.tasks t
  where t.id = r.task_id and r.sent_at is null and r.remind_at <= now()
    and t.status not in ('completed','cancelled')
  returning r.id, t.id, t.task_no, t.title, t.assigned_to, t.due_date, r.note;
end $$;

-- Per accountable manager: what was assigned, finished on time, overdue, waiting.
create or replace function public.zm_task_accountability(p_from date, p_to date, p_zone uuid default null)
returns table (manager_id uuid, manager_name text, assigned bigint, completed bigint, completed_on_time bigint,
               overdue bigint, pending_submissions bigint, awaiting_confirmation bigint, on_time_pct numeric)
language sql stable security definer set search_path = '' as $$
  select q.manager_id, q.manager_name, q.assigned, q.completed, q.completed_on_time, q.overdue,
         q.pending_submissions, q.awaiting_confirmation,
         round(100.0 * q.completed_on_time / nullif(q.completed, 0), 1)
  from (
    select t.accountable_manager_id as manager_id, p.full_name as manager_name,
           count(*) filter (where t.status <> 'cancelled') as assigned,
           count(*) filter (where t.status = 'completed') as completed,
           count(*) filter (where t.status = 'completed' and t.completed_at::date <= t.due_date) as completed_on_time,
           count(*) filter (where t.status not in ('completed','cancelled') and t.due_date < current_date) as overdue,
           count(*) filter (where t.requires_submission and t.status in ('assigned','in_progress')) as pending_submissions,
           count(*) filter (where t.status = 'submitted') as awaiting_confirmation
    from public.tasks t
    join public.profiles p on p.id = t.accountable_manager_id
    where t.due_date between p_from and p_to
      and (p_zone is null or t.zone_id = p_zone)
      and (t.accountable_manager_id = auth.uid() or private.has_permission('zonal.task.view', t.zone_id, t.hub_id))
    group by t.accountable_manager_id, p.full_name
  ) q
  order by q.overdue desc, q.manager_name
$$;

-- ---------------------------------------------------------------------
-- Workforce statistics (dashboard numbers and the records behind them)
-- ---------------------------------------------------------------------
-- One function returns the rows behind every statistic, and the dashboard
-- counts those same rows, so a number always matches the list it opens.
create or replace function public.zm_workforce_details(
  p_stat text, p_zone uuid, p_from date, p_to date, p_hub uuid default null
) returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, hub_name text,
                 position_name text, status text, event_date date, detail text)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.hub_id, h.name, po.name, e.status, x.event_date, x.detail
  from public.employees e
  left join public.hubs h on h.id = e.hub_id
  left join public.positions po on po.id = e.position_id
  join lateral (
    select e.joining_date as event_date, null::text as detail
      where p_stat = 'total' and e.status in ('active','inactive')
    union all
    select e.status_since, null::text where p_stat = 'active' and e.status = 'active'
    union all
    select e.status_since, null::text where p_stat = 'inactive' and e.status = 'inactive'
    union all
    select e.joining_date, null::text
      where p_stat = 'new_joining' and e.status not in ('applicant','rejected') and e.joining_date between p_from and p_to
    union all
    select sh.effective_date, sh.reason from public.employee_status_history sh
      where p_stat = 'resigned' and sh.employee_id = e.id and sh.to_status = 'resigned'
        and sh.effective_date between p_from and p_to
    union all
    select a.effective_from, a.reason from public.employee_assignments a
      where p_stat = 'transferred' and a.employee_id = e.id and a.change_type = 'transfer'
        and a.effective_from between p_from and p_to
    union all
    select ap.reviewed_at::date, ap.review_note from public.employee_applications ap
      where p_stat = 'employee_id_issued' and ap.employee_id = e.id and ap.status = 'approved'
        and ap.reviewed_at::date between p_from and p_to
    union all
    select ap.submitted_at::date, null::text from public.employee_applications ap
      where p_stat = 'pending_applications' and ap.employee_id = e.id and ap.status = 'submitted'
  ) x on true
  where e.archived_at is null
    and (p_zone is null or e.zone_id = p_zone)
    and (p_hub is null or e.hub_id = p_hub)
  order by x.event_date desc nulls last, e.full_name
$$;

-- Missing profile information, from the ACTIVE profile requirements:
-- core fields + standard documents + documents required by settings + required
-- custom fields. Runs with definer rights so a manager without access to NID
-- images still learns WHETHER they are on file (never their content).
create or replace function public.zm_data_completion(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, hub_name text,
               missing text[], total_checks integer, completion_pct numeric)
language sql stable security definer set search_path = '' as $$
  with req_docs as (
    select distinct q.doc_type from (
      select unnest(array['photo','nid_front','nid_back','signature','cv']::text[]) as doc_type
      union all
      select jsonb_array_elements_text(s.value) from public.system_settings s where s.key = 'hr.required_documents'
    ) q
  ),
  req_fields as (
    select f.id, f.code::text as code, f.sort_order
    from public.employee_custom_fields f where f.is_required and f.archived_at is null
  ),
  totals as (
    select (4 + (select count(*) from req_docs) + (select count(*) from req_fields))::integer as n
  ),
  base as (
    select e.id, e.employee_code::text as code, e.full_name, e.hub_id, h.name as hub_name,
      array_remove(array[
        case when e.mobile is null then 'mobile'::text end,
        case when e.joining_date is null then 'joining_date'::text end,
        case when e.position_id is null then 'position'::text end,
        case when e.hub_id is null then 'hub'::text end
      ], null)
      || coalesce((select array_agg(r.doc_type order by r.doc_type) from req_docs r
                   where not exists (select 1 from public.employee_documents d
                                     where d.employee_id = e.id and d.doc_type = r.doc_type and d.archived_at is null)),
                  '{}'::text[])
      || coalesce((select array_agg('field:' || f.code order by f.sort_order) from req_fields f
                   where not exists (select 1 from public.employee_custom_field_values v
                                     where v.field_id = f.id and v.employee_id = e.id)),
                  '{}'::text[]) as missing
    from public.employees e
    left join public.hubs h on h.id = e.hub_id
    where e.status = 'active' and e.archived_at is null
      and (p_zone is null or e.zone_id = p_zone)
      and (p_hub is null or e.hub_id = p_hub)
      and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  )
  select b.id, b.code, b.full_name, b.hub_id, b.hub_name, b.missing, t.n,
         round(100.0 * (t.n - cardinality(b.missing)) / t.n, 1)
  from base b cross join totals t
  order by cardinality(b.missing) desc, b.full_name
$$;

-- ---------------------------------------------------------------------
-- Hub performance and comparison (verified figures only)
-- ---------------------------------------------------------------------
create or replace function public.zm_hub_performance(p_zone uuid, p_from date, p_to date)
returns table (hub_id uuid, hub_code text, hub_name text, days_verified integer, days_unverified integer,
               pickups bigint, deliveries bigint, merchants integer, avg_rider_capacity numeric, avg_riders numeric,
               cash_collected numeric, expenses numeric, pending_parcels integer,
               parcels_per_rider_day numeric, expense_per_parcel numeric, volume_share_pct numeric, volume_rank integer)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select hb.id, hb.code::text as code, hb.name,
      (count(d.id) filter (where d.status = 'verified'))::integer as days_v,
      (count(d.id) filter (where d.status = 'submitted'))::integer as days_u,
      coalesce(sum(d.pickup_count) filter (where d.status = 'verified'), 0)::bigint as pk,
      coalesce(sum(d.delivery_count) filter (where d.status = 'verified'), 0)::bigint as dl,
      (array_agg(d.merchant_count order by d.metric_date desc) filter (where d.status = 'verified'))[1] as merchants,
      (array_agg(d.pending_parcels order by d.metric_date desc) filter (where d.status = 'verified'))[1] as pending,
      avg(d.rider_capacity) filter (where d.status = 'verified') as cap,
      avg(d.rider_count) filter (where d.status = 'verified') as riders,
      coalesce(sum(d.rider_count) filter (where d.status = 'verified'), 0) as rider_days,
      coalesce(sum(d.cash_collected) filter (where d.status = 'verified'), 0) as cash,
      coalesce(sum(d.expenses) filter (where d.status = 'verified'), 0) as spent
    from public.hubs hb
    left join public.hub_daily_metrics d on d.hub_id = hb.id and d.metric_date between p_from and p_to
    where hb.archived_at is null and (p_zone is null or hb.zone_id = p_zone)
    group by hb.id, hb.code, hb.name
  )
  select m.id, m.code, m.name, m.days_v, m.days_u, m.pk, m.dl, coalesce(m.merchants, 0),
         round(m.cap, 1), round(m.riders, 1), m.cash, m.spent, coalesce(m.pending, 0),
         round((m.pk + m.dl)::numeric / nullif(m.rider_days, 0), 1),
         round(m.spent / nullif(m.pk + m.dl, 0), 2),
         round(100.0 * (m.pk + m.dl) / nullif(sum(m.pk + m.dl) over (), 0), 1),
         (rank() over (order by (m.pk + m.dl) desc))::integer
  from m
  order by (m.pk + m.dl) desc, m.name
$$;

-- ---------------------------------------------------------------------
-- Zonal dashboard
-- ---------------------------------------------------------------------
create or replace function public.zm_dashboard(p_zone uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  -- p_zone null = whole company and needs a global grant
  if not private.has_permission('zonal.dashboard.view', p_zone) then
    raise exception 'Not authorised to open the zonal dashboard for this zone.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'workforce', (
      select jsonb_object_agg(s.stat, (select count(*) from public.zm_workforce_details(s.stat, p_zone, p_from, p_to)))
      from unnest(array['total','active','inactive','new_joining','resigned','transferred',
                        'employee_id_issued','pending_applications']::text[]) as s(stat)),
    'hubs', (
      select jsonb_build_object(
        'hub_count', count(*),
        'pickups', coalesce(sum(hp.pickups), 0),
        'deliveries', coalesce(sum(hp.deliveries), 0),
        'merchants', coalesce(sum(hp.merchants), 0),
        'rider_capacity', coalesce(sum(hp.avg_rider_capacity), 0),
        'cash_collected', coalesce(sum(hp.cash_collected), 0),
        'expenses', coalesce(sum(hp.expenses), 0),
        'pending_parcels', coalesce(sum(hp.pending_parcels), 0),
        'unverified_days', coalesce(sum(hp.days_unverified), 0))
      from public.zm_hub_performance(p_zone, p_from, p_to) hp),
    'data_completion', (
      select jsonb_build_object(
        'employees', count(*),
        'incomplete', count(*) filter (where cardinality(dc.missing) > 0),
        'average_pct', coalesce(round(avg(dc.completion_pct), 1), 100))
      from public.zm_data_completion(p_zone, null) dc),
    'tasks', (
      select jsonb_build_object(
        'open', count(*) filter (where t.status in ('assigned','in_progress','submitted')),
        'overdue', count(*) filter (where t.status in ('assigned','in_progress','submitted') and t.due_date < current_date),
        'pending_submissions', count(*) filter (where t.requires_submission and t.status in ('assigned','in_progress')),
        'awaiting_confirmation', count(*) filter (where t.status = 'submitted'),
        'completed', count(*) filter (where t.status = 'completed' and t.completed_at::date between p_from and p_to))
      from public.tasks t where p_zone is null or t.zone_id = p_zone),
    'travel', (
      select jsonb_build_object(
        'visits', count(*),
        'total_km', coalesce(sum(hv.distance_km), 0),
        'fuel', coalesce(sum(hv.fuel_amount), 0),
        'meal', coalesce(sum(hv.meal_amount), 0),
        'transport', coalesce(sum(hv.transport_amount), 0),
        'other', coalesce(sum(hv.other_amount), 0),
        'total', coalesce(sum(hv.total_amount), 0),
        'unclaimed', count(*) filter (where hv.claim_id is null))
      from public.hub_visits hv
      where hv.archived_at is null and hv.visit_date between p_from and p_to
        and (p_zone is null or hv.zone_id = p_zone)),
    'claims_pending', (
      select count(*) from public.travel_claims c
      where c.status = 'submitted' and (p_zone is null or c.zone_id = p_zone))
  );
end $$;

-- ---------------------------------------------------------------------
-- Workforce planning (advisory only)
-- ---------------------------------------------------------------------
create table public.workforce_recommendations (
  id            uuid primary key default gen_random_uuid(),
  zone_id       uuid not null references public.zones(id),
  hub_id        uuid not null references public.hubs(id),
  period_from   date not null,
  period_to     date not null,
  -- Only advisory categories exist. There is deliberately no category that
  -- hires, dismisses, changes pay or disciplines.
  kind          text not null check (kind in
                ('add_riders','rebalance_riders','review_backlog','review_overtime','data_gap','no_change')),
  summary       text not null,
  evidence      jsonb not null,
  assumptions   jsonb not null,
  status        text not null default 'proposed' check (status in ('proposed','acknowledged','dismissed')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  constraint workforce_recommendations_period_chk check (period_to >= period_from),
  constraint workforce_recommendations_evidence_chk check (jsonb_typeof(evidence) = 'object' and jsonb_typeof(assumptions) = 'array')
);
create index workforce_recommendations_zone_idx on public.workforce_recommendations (zone_id, period_from desc);
comment on table public.workforce_recommendations is
  'Advisory planning output. A recommendation never changes employees, pay or status; an authorised person decides and acts through the HR workflows.';

-- Computes recommendations for every active hub of a zone from VERIFIED daily
-- figures. Returns evidence and assumptions with each one. p_save stores them.
create or replace function public.zm_workforce_plan(p_zone uuid, p_from date, p_to date, p_save boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ppr      numeric := coalesce(private.setting_text('zonal.parcels_per_rider_day')::numeric, 45);
  v_clear    numeric := coalesce(private.setting_text('zonal.backlog_clear_days')::numeric, 3);
  v_alert    numeric := coalesce(private.setting_text('zonal.backlog_alert_days')::numeric, 1.5);
  v_maxh     numeric := coalesce(private.setting_text('zonal.max_rider_hours_per_day')::numeric, 10);
  v_min_days integer := coalesce(private.setting_text('zonal.planning_min_days')::integer, 5);
  v_len      integer;
  h          record;
  c          record;
  pv         record;
  e          jsonb;
  v_rows     jsonb := '[]'::jsonb;
  v_items    jsonb := '[]'::jsonb;
  v_assume   jsonb;
  v_evidence jsonb;
  v_kind     text;
  v_summary  text;
  v_required integer;
  v_gap      integer;
  v_surplus  text;
  v_days     integer;
begin
  if p_zone is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'Zone and a valid period are required.' using errcode = '22023';
  end if;
  if not private.has_permission('zonal.planning.view', p_zone) then
    raise exception 'Not authorised to view workforce planning for this zone.' using errcode = '42501';
  end if;
  if p_save and not private.has_permission('zonal.planning.create', p_zone) then
    raise exception 'Not authorised to save workforce recommendations.' using errcode = '42501';
  end if;
  if v_ppr <= 0 or v_clear <= 0 then
    raise exception 'Planning settings must be greater than zero.' using errcode = '22023';
  end if;
  v_len := p_to - p_from + 1;

  v_assume := jsonb_build_array(
    format('One rider handles about %s parcels per day (pickup + delivery).', v_ppr),
    format('A backlog should be cleared within %s day(s).', v_clear),
    format('A backlog above %s day(s) of deliveries needs review.', v_alert),
    format('Average rider hours above %s per day need review.', v_maxh),
    format('At least %s verified day(s) of figures are needed for a recommendation.', v_min_days),
    'Only verified daily hub figures are used; unverified days are ignored.',
    'Rider numbers are riders on duty as reported by the hub, not contracts or headcount.',
    'Seasonal peaks, holidays, route distance and parcel size are not modelled.');

  -- pass 1: measure every active hub
  for h in select hb.id, hb.name, hb.code::text as code from public.hubs hb
           where hb.zone_id = p_zone and hb.status = 'active' and hb.archived_at is null order by hb.name
  loop
    select count(*)::integer as days,
           avg(m.pickup_count) as avg_pickup, avg(m.delivery_count) as avg_delivery,
           avg(m.pickup_count + m.delivery_count) as avg_workload,
           avg(m.rider_count) as avg_riders, avg(m.rider_capacity) as avg_capacity,
           sum(m.working_hours) as hours, sum(m.rider_count) as rider_days,
           (array_agg(m.pending_parcels order by m.metric_date desc))[1] as backlog,
           (array_agg(m.merchant_count order by m.metric_date desc))[1] as merchants
      into c
    from public.hub_daily_metrics m
    where m.hub_id = h.id and m.status = 'verified' and m.metric_date between p_from and p_to;

    select count(*)::integer as days, avg(m.pickup_count + m.delivery_count) as avg_workload
      into pv
    from public.hub_daily_metrics m
    where m.hub_id = h.id and m.status = 'verified' and m.metric_date between p_from - v_len and p_from - 1;

    v_required := null; v_gap := null;
    if c.days >= v_min_days then
      v_required := ceil((c.avg_workload + coalesce(c.backlog, 0) / v_clear) / v_ppr)::integer;
      v_gap := v_required - round(c.avg_riders)::integer;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'hub_id', h.id, 'hub_name', h.name, 'hub_code', h.code,
      'days_of_data', c.days,
      'avg_pickup_per_day', round(c.avg_pickup, 1),
      'avg_delivery_per_day', round(c.avg_delivery, 1),
      'avg_workload_per_day', round(c.avg_workload, 1),
      'avg_riders_on_duty', round(c.avg_riders, 1),
      'avg_rider_capacity', round(c.avg_capacity, 1),
      'capacity_used_pct', round(100 * c.avg_workload / nullif(c.avg_capacity, 0), 1),
      'backlog_parcels', c.backlog,
      'backlog_days', round(c.backlog / nullif(c.avg_delivery, 0), 2),
      'merchants', c.merchants,
      'hours_per_rider_day', round(c.hours / nullif(c.rider_days, 0), 1),
      'workload_trend_pct', case when pv.days >= v_min_days
                                 then round(100 * (c.avg_workload - pv.avg_workload) / nullif(pv.avg_workload, 0), 1) end,
      'previous_period_days', pv.days,
      'riders_needed', v_required,
      'rider_gap', v_gap);
  end loop;

  -- a hub with clearly more riders than its workload needs
  select r ->> 'hub_name' into v_surplus
  from jsonb_array_elements(v_rows) r
  where (r ->> 'rider_gap')::integer <= -2
  order by (r ->> 'rider_gap')::integer limit 1;

  -- pass 2: one recommendation per hub
  for e in select * from jsonb_array_elements(v_rows) loop
    v_days := (e ->> 'days_of_data')::integer;
    v_gap := (e ->> 'rider_gap')::integer;
    if v_days < v_min_days then
      v_kind := 'data_gap';
      v_summary := format('%s has only %s verified day(s) of figures in this period; at least %s are needed. No recommendation is made.',
                          e ->> 'hub_name', v_days, v_min_days);
    elsif v_gap >= 1 and ((e ->> 'capacity_used_pct')::numeric > 100 or (e ->> 'backlog_days')::numeric > v_alert) then
      if v_surplus is not null and v_surplus <> (e ->> 'hub_name') then
        v_kind := 'rebalance_riders';
        v_summary := format('%s needs about %s riders for its workload but has %s on duty on average. %s appears to have spare riders: review a temporary reallocation before considering recruitment.',
                            e ->> 'hub_name', e ->> 'riders_needed', e ->> 'avg_riders_on_duty', v_surplus);
      else
        v_kind := 'add_riders';
        v_summary := format('%s needs about %s riders for its workload and backlog but has %s on duty on average. Consider requesting %s additional rider(s); HR and management decide.',
                            e ->> 'hub_name', e ->> 'riders_needed', e ->> 'avg_riders_on_duty', v_gap);
      end if;
    elsif (e ->> 'backlog_days')::numeric > v_alert then
      v_kind := 'review_backlog';
      v_summary := format('%s holds %s pending parcels, about %s day(s) of deliveries. Rider numbers look sufficient: review routing, attendance and failed deliveries.',
                          e ->> 'hub_name', e ->> 'backlog_parcels', e ->> 'backlog_days');
    elsif (e ->> 'hours_per_rider_day')::numeric > v_maxh then
      v_kind := 'review_overtime';
      v_summary := format('Riders at %s average %s hours per day, above the %s-hour guide. Review shifts and workload distribution.',
                          e ->> 'hub_name', e ->> 'hours_per_rider_day', v_maxh);
    else
      v_kind := 'no_change';
      v_summary := format('%s is handling its workload with the riders on duty. No change is suggested.', e ->> 'hub_name');
    end if;

    v_evidence := (e - 'hub_id' - 'hub_name' - 'hub_code') || jsonb_build_object(
      'source', 'hub_daily_metrics (verified rows only)',
      'period_from', p_from, 'period_to', p_to);

    v_items := v_items || jsonb_build_object(
      'hub_id', e ->> 'hub_id', 'hub_name', e ->> 'hub_name', 'hub_code', e ->> 'hub_code',
      'kind', v_kind, 'summary', v_summary, 'evidence', v_evidence, 'assumptions', v_assume);

    if p_save then
      insert into public.workforce_recommendations (zone_id, hub_id, period_from, period_to, kind, summary, evidence, assumptions)
      values (p_zone, (e ->> 'hub_id')::uuid, p_from, p_to, v_kind, v_summary, v_evidence, v_assume);
    end if;
  end loop;

  return jsonb_build_object(
    'zone_id', p_zone, 'period_from', p_from, 'period_to', p_to, 'generated_at', now(), 'saved', p_save,
    'policy', 'Advisory only. The system never hires, dismisses, transfers, changes pay or disciplines anyone. Every recommendation needs a decision by an authorised person through the normal HR workflow.',
    'assumptions', v_assume,
    'items', v_items);
end $$;

-- A person records that they have seen / set aside a recommendation. This
-- changes nothing else in the system.
create or replace function public.zm_review_recommendation(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.workforce_recommendations%rowtype;
begin
  select * into r from public.workforce_recommendations where id = p_id for update;
  if r.id is null or not private.has_permission('zonal.planning.edit', r.zone_id) then
    raise exception 'Recommendation not found or not authorised.' using errcode = '42501';
  end if;
  if p_status not in ('acknowledged','dismissed') then
    raise exception 'Status must be acknowledged or dismissed.' using errcode = '22023';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  if r.status <> 'proposed' then raise exception 'This recommendation has already been reviewed.' using errcode = 'P0001'; end if;
  perform set_config('app.change_reason', p_note, true);
  update public.workforce_recommendations
     set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Reports (the application renders these as PDF, Excel or a print view)
-- ---------------------------------------------------------------------
-- Operations: p_group = week | month | hub | zone
create or replace function public.zm_report_operations(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (group_key text, group_label text, days_reported integer, pickups bigint, deliveries bigint,
                 cash_collected numeric, expenses numeric, avg_pending_parcels numeric)
language sql stable security invoker set search_path = '' as $$
  select k.gkey, k.glabel, (count(distinct d.metric_date))::integer,
         sum(d.pickup_count)::bigint, sum(d.delivery_count)::bigint,
         sum(d.cash_collected), sum(d.expenses), round(avg(d.pending_parcels), 1)
  from public.hub_daily_metrics d
  join public.hubs h on h.id = d.hub_id
  join public.zones z on z.id = d.zone_id
  cross join lateral (
    select case p_group
             when 'week'  then to_char(date_trunc('week', d.metric_date::timestamp), 'YYYY-MM-DD')
             when 'month' then to_char(d.metric_date::timestamp, 'YYYY-MM')
             when 'hub'   then h.code::text
             when 'zone'  then z.code::text end as gkey,
           case p_group
             when 'week'  then 'Week of ' || to_char(date_trunc('week', d.metric_date::timestamp), 'DD/MM/YYYY')
             when 'month' then to_char(d.metric_date::timestamp, 'Mon YYYY')
             when 'hub'   then h.name
             when 'zone'  then z.name end as glabel
  ) k
  where d.status = 'verified' and d.metric_date between p_from and p_to
    and p_group in ('week','month','hub','zone')
    and (p_zone is null or d.zone_id = p_zone)
    and (p_hub is null or d.hub_id = p_hub)
  group by k.gkey, k.glabel
  order by k.gkey
$$;

-- Workforce: p_group = hub | zone | department
create or replace function public.zm_report_workforce(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (group_key text, group_label text, headcount bigint, active bigint, inactive bigint,
                 new_joining bigint, resigned bigint, transferred bigint)
language sql stable security invoker set search_path = '' as $$
  select k.gkey, k.glabel,
         count(*) filter (where e.status in ('active','inactive')),
         count(*) filter (where e.status = 'active'),
         count(*) filter (where e.status = 'inactive'),
         count(*) filter (where e.status not in ('applicant','rejected') and e.joining_date between p_from and p_to),
         count(*) filter (where f.has_resigned),
         count(*) filter (where f.has_transfer)
  from public.employees e
  left join public.hubs h on h.id = e.hub_id
  left join public.zones z on z.id = e.zone_id
  left join public.departments dp on dp.id = e.department_id
  cross join lateral (
    select exists (select 1 from public.employee_status_history sh
                   where sh.employee_id = e.id and sh.to_status = 'resigned'
                     and sh.effective_date between p_from and p_to) as has_resigned,
           exists (select 1 from public.employee_assignments a
                   where a.employee_id = e.id and a.change_type = 'transfer'
                     and a.effective_from between p_from and p_to) as has_transfer
  ) f
  cross join lateral (
    select case p_group when 'hub' then coalesce(h.code::text, '-')
                        when 'zone' then coalesce(z.code::text, '-')
                        when 'department' then coalesce(dp.code::text, '-') end as gkey,
           case p_group when 'hub' then coalesce(h.name, 'No hub')
                        when 'zone' then coalesce(z.name, 'No zone')
                        when 'department' then coalesce(dp.name, 'No department') end as glabel
  ) k
  where e.archived_at is null and p_group in ('hub','zone','department')
    and (p_zone is null or e.zone_id = p_zone)
    and (p_hub is null or e.hub_id = p_hub)
  group by k.gkey, k.glabel
  order by k.glabel
$$;

-- Employee-wise report: one row per employee with attendance and task counts.
create or replace function public.zm_report_employees(
  p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (employee_id uuid, employee_code text, full_name text, zone_name text, hub_name text,
                 department_name text, position_name text, status text, joining_date date,
                 present_days bigint, absent_days bigint, leave_days bigint, open_tasks bigint, overdue_tasks bigint)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, z.name, h.name, dp.name, po.name, e.status, e.joining_date,
         a.present_days, a.absent_days, a.leave_days, tk.open_tasks, tk.overdue_tasks
  from public.employees e
  left join public.zones z on z.id = e.zone_id
  left join public.hubs h on h.id = e.hub_id
  left join public.departments dp on dp.id = e.department_id
  left join public.positions po on po.id = e.position_id
  cross join lateral (
    select count(*) filter (where ar.status in ('present','late','half_day')) as present_days,
           count(*) filter (where ar.status = 'absent') as absent_days,
           count(*) filter (where ar.status = 'leave') as leave_days
    from public.attendance_records ar
    where ar.employee_id = e.id and ar.work_date between p_from and p_to
  ) a
  cross join lateral (
    select count(*) as open_tasks,
           count(*) filter (where t.due_date < current_date) as overdue_tasks
    from public.tasks t
    where t.status in ('assigned','in_progress','submitted')
      and (t.related_employee_id = e.id or (e.profile_id is not null and t.assigned_to = e.profile_id))
  ) tk
  where e.archived_at is null and e.status not in ('applicant','rejected')
    and (p_zone is null or e.zone_id = p_zone)
    and (p_hub is null or e.hub_id = p_hub)
  order by z.name, h.name, e.full_name
$$;

-- Hub visit & travel report: p_group = week | month
create or replace function public.zm_visit_report(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_visitor uuid default null
) returns table (group_key text, group_label text, visits bigint, hubs_visited bigint, total_km numeric,
                 fuel numeric, meal numeric, transport numeric, other numeric, total numeric,
                 claimed numeric, approved numeric)
language sql stable security invoker set search_path = '' as $$
  select k.gkey, k.glabel, count(*), count(distinct hv.hub_id), sum(hv.distance_km),
         sum(hv.fuel_amount), sum(hv.meal_amount), sum(hv.transport_amount), sum(hv.other_amount), sum(hv.total_amount),
         coalesce(sum(hv.total_amount) filter (where hv.claim_id is not null), 0),
         coalesce(sum(hv.total_amount) filter (where c.status = 'approved'), 0)
  from public.hub_visits hv
  left join public.travel_claims c on c.id = hv.claim_id
  cross join lateral (
    select case p_group
             when 'week'  then to_char(date_trunc('week', hv.visit_date::timestamp), 'YYYY-MM-DD')
             when 'month' then to_char(hv.visit_date::timestamp, 'YYYY-MM') end as gkey,
           case p_group
             when 'week'  then 'Week of ' || to_char(date_trunc('week', hv.visit_date::timestamp), 'DD/MM/YYYY')
             when 'month' then to_char(hv.visit_date::timestamp, 'Mon YYYY') end as glabel
  ) k
  where hv.archived_at is null and hv.visit_date between p_from and p_to
    and p_group in ('week','month')
    and (p_zone is null or hv.zone_id = p_zone)
    and (p_visitor is null or hv.visitor_id = p_visitor)
  group by k.gkey, k.glabel
  order by k.gkey
$$;

-- Every export / print is recorded in the audit log.
create or replace function public.zm_log_export(p_report text, p_format text, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_perm text;
begin
  if p_format not in ('pdf','excel','print') then
    raise exception 'Format must be pdf, excel or print.' using errcode = '22023';
  end if;
  if coalesce(trim(p_report), '') = '' then raise exception 'Report name is required.' using errcode = '22023'; end if;
  v_perm := case when p_format = 'print' then 'zonal.report.print' else 'zonal.report.export' end;
  if not exists (select 1 from private.my_grants() g
                 where g.permission_code = v_perm or (g.is_super and g.scope_type = 'global')) then
    raise exception 'Not authorised to % reports.', case when p_format = 'print' then 'print' else 'export' end
      using errcode = '42501';
  end if;
  perform private.write_audit(case when p_format = 'print' then 'PRINT' else 'EXPORT' end, 'zonal', 'report', p_report,
                              null, jsonb_build_object('format', p_format, 'filters', coalesce(p_filters, '{}'::jsonb)), null);
end $$;

-- ---------------------------------------------------------------------
-- Stamp / audit / no-delete
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hub_daily_metrics','hub_visits','travel_claims','tasks','workforce_recommendations'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''zonal'')', t || '_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger task_reminders_no_delete before delete on public.task_reminders
  for each row execute function private.prevent_delete();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.hub_daily_metrics         enable row level security;
alter table public.hub_visits                enable row level security;
alter table public.travel_claims             enable row level security;
alter table public.tasks                     enable row level security;
alter table public.task_reminders            enable row level security;
alter table public.workforce_recommendations enable row level security;

revoke all on public.hub_daily_metrics, public.hub_visits, public.travel_claims, public.tasks,
  public.task_reminders, public.workforce_recommendations from anon;
revoke all on sequence public.travel_claim_no_seq, public.task_no_seq from anon;
revoke delete, truncate on public.hub_daily_metrics, public.hub_visits, public.travel_claims, public.tasks,
  public.task_reminders, public.workforce_recommendations from authenticated;
-- Claims, tasks, reminders and recommendations are written only by functions.
revoke insert, update on public.travel_claims, public.tasks, public.task_reminders,
  public.workforce_recommendations from authenticated;

-- daily hub figures
create policy hub_metrics_read on public.hub_daily_metrics for select to authenticated
  using (private.has_permission('zonal.hub_metric.view', zone_id, hub_id));
create policy hub_metrics_insert on public.hub_daily_metrics for insert to authenticated
  with check (private.has_permission('zonal.hub_metric.create', zone_id, hub_id));
create policy hub_metrics_update on public.hub_daily_metrics for update to authenticated
  using (private.has_permission('zonal.hub_metric.create', zone_id, hub_id))
  with check (private.has_permission('zonal.hub_metric.create', zone_id, hub_id));

-- hub visits: own visits, or visits in a scope where the caller may view them
create policy hub_visits_read on public.hub_visits for select to authenticated
  using (visitor_id = auth.uid() or private.has_permission('zonal.visit.view', zone_id, hub_id));
create policy hub_visits_insert on public.hub_visits for insert to authenticated
  with check (visitor_id = auth.uid() and private.has_permission('zonal.visit.create', zone_id, hub_id));
create policy hub_visits_update on public.hub_visits for update to authenticated
  using (visitor_id = auth.uid())   -- the guard trigger refuses changes to claimed visits with a clear message
  with check (visitor_id = auth.uid() and private.has_permission('zonal.visit.create', zone_id, hub_id));

create policy travel_claims_read on public.travel_claims for select to authenticated
  using (claimant_id = auth.uid() or private.has_permission('zonal.claim.view', zone_id));

-- tasks: the people involved, or anyone who may view tasks in that scope
create policy tasks_read on public.tasks for select to authenticated
  using (assigned_to = auth.uid() or accountable_manager_id = auth.uid() or created_by = auth.uid()
         or private.has_permission('zonal.task.view', zone_id, hub_id));
create policy task_reminders_read on public.task_reminders for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

create policy workforce_recommendations_read on public.workforce_recommendations for select to authenticated
  using (private.has_permission('zonal.planning.view', zone_id, hub_id));

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'zm\_%' or p.proname like 'task\_%')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname = 'task_due_reminders' then
      execute format('revoke all on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Default permissions per role (editable later by Super Admin)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'zonal' and (
     r.code = 'admin'
  or (r.code in ('head_office_manager','auditor') and p.action in ('view','export','print'))
  or (r.code = 'zonal_manager' and p.code in ('zonal.dashboard.view','zonal.hub_metric.view','zonal.hub_metric.approve',
        'zonal.visit.view','zonal.visit.create','zonal.claim.view','zonal.claim.create',
        'zonal.task.view','zonal.task.create','zonal.task.edit',
        'zonal.planning.view','zonal.planning.create','zonal.planning.edit',
        'zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'operations_manager' and p.code in ('zonal.dashboard.view','zonal.hub_metric.view','zonal.hub_metric.create',
        'zonal.hub_metric.approve','zonal.visit.view','zonal.task.view','zonal.task.create','zonal.task.edit',
        'zonal.planning.view','zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'hub_manager' and p.code in ('zonal.hub_metric.view','zonal.hub_metric.create','zonal.task.view','zonal.report.view'))
  or (r.code = 'hr_manager' and p.code in ('zonal.dashboard.view','zonal.planning.view','zonal.task.view','zonal.task.create',
        'zonal.task.edit','zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'accounts_manager' and p.code in ('zonal.visit.view','zonal.claim.view','zonal.claim.approve','zonal.claim.reject',
        'zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'accountant' and p.code in ('zonal.visit.view','zonal.claim.view','zonal.report.view'))
)
on conflict do nothing;

-- ===== 20261111000700_courier_operations.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0007: Hub, zone and courier operations
--   * merchants, parcels
--   * ops_assignments        Hub Manager / Zonal Manager / rider assignment history
--   * pickup_submissions     independent submissions from Pickup Manager, Hub
--                            Manager and Rider; duplicate / conflict detection;
--                            Pending -> Verified -> Approved | Rejected
--   * pickup_consolidations  ONE approved record per pickup (date, hub, merchant,
--                            trip). Reports read these, never the raw submissions.
--   * delivery_records       delivered / failed / returned, approved by a second person
--   * cash_collections       rider and hub cash-in (COD rows are written on approval)
--   * cash_handovers         rider -> hub -> Main Accounts, receiver confirms the
--                            amount actually received; any shortage is recorded
--   * merchant_payments, operational_expenses, cash_reconciliations
--   * parcel_issues + parcel_issue_events (append-only history)
--   * report functions; approved data refreshes hub_daily_metrics so the zonal
--     dashboards of migration 0006 run on real courier records
-- Rules:
--   * Submissions of the same pickup are NEVER summed. They are compared, and
--     one consolidated record is approved.
--   * The maker is never the checker (submitter / verifier / approver / receiver).
--   * Workflow tables are written only through the audited functions below.
--   * Nothing is deleted. Every figure is limited to the caller's zone / hub scope.
-- ACCOUNTS HOOK: this migration posts NOTHING to a ledger. Every financial row
--   carries ledger_entry_id (null = not yet posted). The Accounts phase posts
--   approved / confirmed rows and stores its entry id there:
--     cash_collections (not voided), cash_handovers (confirmed, incl. shortage),
--     merchant_payments (approved), operational_expenses (approved),
--     cash_reconciliations (approved, difference <> 0).
-- NOTE: assigning a Hub Manager / Zonal Manager / rider here records WHO runs a
--   unit. It does not grant login permissions; roles stay in user_roles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions and settings
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'ops.' || r || '.' || a, 'ops', r, a, d from (values
  ('merchant','view','View merchants'),
  ('merchant','create','Create merchants'),
  ('merchant','edit','Edit merchants'),
  ('merchant','archive','Archive merchants'),
  ('parcel','view','View parcels and search by parcel ID'),
  ('parcel','create','Book parcels into a hub'),
  ('parcel','edit','Edit, dispatch to riders and cancel parcels'),
  ('assignment','view','View Hub Manager, Zonal Manager and rider assignments'),
  ('assignment','create','Assign Hub Manager, Zonal Manager and riders'),
  ('assignment','edit','End assignments'),
  ('pickup','view','View pickup submissions and approved pickups'),
  ('pickup','approve','Approve the consolidated pickup record'),
  ('pickup','reject','Reject pickup submissions'),
  ('pickup_as_pickup_manager','create','Submit pickups as Pickup Manager'),
  ('pickup_as_hub_manager','create','Submit pickups as Hub Manager'),
  ('pickup_as_rider','create','Submit own pickups as Rider'),
  ('pickup_verification','create','Verify pickup submissions'),
  ('delivery','view','View delivery records'),
  ('delivery','create','Record delivery outcomes'),
  ('delivery','approve','Approve delivery records'),
  ('delivery','reject','Reject delivery records'),
  ('cash','view','View cash collections, rider ledger and hub cash position'),
  ('cash','create','Record hub cash collections and act for riders without a login'),
  ('handover','view','View cash handovers'),
  ('rider_handover','create','Hand rider cash over to the hub'),
  ('rider_handover','approve','Confirm cash received from riders'),
  ('hub_handover','create','Hand hub cash over to Main Accounts'),
  ('hub_handover','approve','Confirm cash received from hubs (Main Accounts)'),
  ('merchant_payment','view','View merchant payments'),
  ('merchant_payment','create','Request merchant payments'),
  ('merchant_payment','approve','Approve merchant payments'),
  ('merchant_payment','reject','Reject merchant payments'),
  ('expense','view','View operational expenses'),
  ('expense','create','Record operational expenses'),
  ('expense','approve','Approve operational expenses'),
  ('expense','reject','Reject operational expenses'),
  ('reconciliation','view','View daily cash reconciliations'),
  ('reconciliation','create','Submit the daily cash count'),
  ('reconciliation','approve','Approve or reject daily cash reconciliations'),
  ('issue','view','View parcel issues'),
  ('issue','create','Report parcel issues'),
  ('issue','edit','Assign, resolve and reopen parcel issues'),
  ('report','view','View courier operation reports'),
  ('report','export','Export courier operation reports'),
  ('report','print','Print courier operation reports')
) v(r, a, d);

insert into public.system_settings (key, value, description) values
  ('ops.backdate_days', '3', 'Operations: how many days back pickups, deliveries, expenses and cash may be entered');

-- Daily hub figures now say where they come from. Rows generated from approved
-- courier records are locked: the underlying record is corrected instead.
alter table public.hub_daily_metrics
  add column source text not null default 'manual' check (source in ('manual','courier'));

create or replace function private.hub_metric_courier_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.source = 'courier' and (new.status <> 'verified' or new.source <> 'courier') then
    raise exception 'These figures are generated from approved courier records. Correct the underlying record instead.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger hub_daily_metrics_courier_guard before update on public.hub_daily_metrics
  for each row execute function private.hub_metric_courier_guard();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function private.my_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e where e.profile_id = auth.uid() and e.archived_at is null
$$;

create or replace function private.employee_label(p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(e.employee_code::text || ' — ', '') || e.full_name from public.employees e where e.id = p_employee
$$;

create or replace function private.ops_date_ok(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_date is not null and p_date <= current_date
     and p_date >= current_date - coalesce(private.setting_text('ops.backdate_days')::integer, 3)
$$;

-- ---------------------------------------------------------------------
-- Merchants and parcels
-- ---------------------------------------------------------------------
create table public.merchants (
  id             uuid primary key default gen_random_uuid(),
  code           extensions.citext not null unique,
  name           text not null check (length(trim(name)) > 1),
  phone          text,
  address        text,
  hub_id         uuid not null references public.hubs(id),    -- hub that serves the merchant
  zone_id        uuid not null references public.zones(id),   -- always follows the hub
  status         text not null default 'active' check (status in ('active','inactive')),
  archived_at    timestamptz,
  archived_by    uuid,
  archive_reason text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint merchants_archive_chk check (archived_at is null or length(trim(coalesce(archive_reason, ''))) > 0)
);
create index merchants_hub_idx on public.merchants (hub_id) where archived_at is null;

create or replace function private.merchant_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if private.is_api_user() then
    if tg_op = 'INSERT' and new.archived_at is not null then
      raise exception 'New merchants cannot be created as archived.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if old.archived_at is not null then
        raise exception 'Archived merchants are read-only.' using errcode = '42501';
      end if;
      if new.archived_at is not null then new.archived_by := auth.uid(); new.status := 'inactive'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger merchants_guard before insert or update on public.merchants
  for each row execute function private.merchant_guard();

create table public.parcels (
  id                uuid primary key default gen_random_uuid(),
  tracking_no       extensions.citext not null unique check (length(trim(tracking_no::text)) >= 4),  -- the parcel ID
  merchant_id       uuid not null references public.merchants(id),
  hub_id            uuid not null references public.hubs(id),
  zone_id           uuid not null references public.zones(id),
  received_date     date not null default current_date,
  customer_name     text not null check (length(trim(customer_name)) > 1),
  customer_phone    text,
  customer_address  text,
  cod_amount        numeric(14,2) not null default 0 check (cod_amount >= 0),
  status            text not null default 'at_hub'
                    check (status in ('at_hub','out_for_delivery','delivered','returned','cancelled')),
  assigned_rider_id uuid references public.employees(id),
  attempt_count     integer not null default 0 check (attempt_count >= 0),
  closed_at         timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint parcels_rider_chk check ((status = 'out_for_delivery') = (assigned_rider_id is not null))
);
create index parcels_hub_idx on public.parcels (hub_id, status);
create index parcels_rider_idx on public.parcels (assigned_rider_id) where assigned_rider_id is not null;
create index parcels_merchant_idx on public.parcels (merchant_id);

create or replace function private.parcel_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if new.received_date > current_date then
    raise exception 'A parcel cannot be booked for a future date.' using errcode = '23514';
  end if;
  if not private.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'at_hub' or new.assigned_rider_id is not null or new.attempt_count <> 0 or new.closed_at is not null then
      raise exception 'New parcels start at the hub. Dispatch and delivery go through the workflow.' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.status, new.assigned_rider_id, new.attempt_count, new.closed_at, new.cancel_reason, new.hub_id,
      new.merchant_id, new.tracking_no, new.received_date)
     is distinct from
     (old.status, old.assigned_rider_id, old.attempt_count, old.closed_at, old.cancel_reason, old.hub_id,
      old.merchant_id, old.tracking_no, old.received_date) then
    raise exception 'Parcel ID, merchant, hub, status and rider change only through the workflow functions.' using errcode = '42501';
  end if;
  if old.status <> 'at_hub' then
    raise exception 'A parcel can be edited only while it is at the hub.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger parcels_guard before insert or update on public.parcels
  for each row execute function private.parcel_guard();

-- ---------------------------------------------------------------------
-- Hub Manager / Zonal Manager / rider assignments (history; current = effective_to is null)
-- ---------------------------------------------------------------------
create table public.ops_assignments (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('hub_manager','zonal_manager','rider')),
  employee_id    uuid not null references public.employees(id),
  zone_id        uuid not null references public.zones(id),
  hub_id         uuid references public.hubs(id),
  duty           text check (duty in ('pickup','delivery','both')),   -- riders only
  effective_from date not null,
  effective_to   date,
  reason         text not null check (length(trim(reason)) > 0),
  end_reason     text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint ops_assignments_dates_chk check (effective_to is null or effective_to >= effective_from),
  constraint ops_assignments_shape_chk check (
       (kind = 'zonal_manager' and hub_id is null and duty is null)
    or (kind = 'hub_manager'   and hub_id is not null and duty is null)
    or (kind = 'rider'         and hub_id is not null and duty is not null))
);
create unique index ops_assignments_one_hub_manager on public.ops_assignments (hub_id)
  where kind = 'hub_manager' and effective_to is null;
create unique index ops_assignments_one_zonal_manager on public.ops_assignments (zone_id)
  where kind = 'zonal_manager' and effective_to is null;
create unique index ops_assignments_one_rider_hub on public.ops_assignments (employee_id)
  where kind = 'rider' and effective_to is null;
create index ops_assignments_hub_idx on public.ops_assignments (hub_id, kind);

create or replace function private.is_current_rider(p_employee uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ops_assignments a
                 where a.kind = 'rider' and a.employee_id = p_employee and a.hub_id = p_hub
                   and a.effective_to is null and a.effective_from <= current_date)
$$;

-- Assign a Hub Manager (zone-level right), Zonal Manager (company-level right)
-- or rider (hub-level right). The previous holder / previous hub is closed.
create or replace function public.ops_assign(
  p_kind text, p_employee uuid, p_hub uuid default null, p_zone uuid default null,
  p_from date default null, p_reason text default null, p_duty text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid;
  v_from date := coalesce(p_from, current_date);
  v_ok   boolean;
  v_id   uuid;
  cur    record;
begin
  if p_kind = 'zonal_manager' then
    if p_zone is null then raise exception 'A zone is required.' using errcode = '22023'; end if;
    v_zone := p_zone; p_hub := null; p_duty := null;
    v_ok := private.has_permission('ops.assignment.create');
  elsif p_kind in ('hub_manager','rider') then
    v_zone := private.hub_zone(p_hub);
    if v_zone is null then raise exception 'A hub is required.' using errcode = '22023'; end if;
    if p_kind = 'hub_manager' then
      p_duty := null;
      v_ok := private.has_permission('ops.assignment.create', v_zone);
    else
      p_duty := coalesce(p_duty, 'both');
      v_ok := private.has_permission('ops.assignment.create', v_zone, p_hub);
    end if;
  else
    raise exception 'Kind must be hub_manager, zonal_manager or rider.' using errcode = '22023';
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'Not authorised to make this assignment.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.status = 'active' and e.archived_at is null) then
    raise exception 'Only an active employee can be assigned.' using errcode = '22023';
  end if;

  for cur in
    select a.id, a.effective_from from public.ops_assignments a
    where a.kind = p_kind and a.effective_to is null
      and (   (p_kind = 'zonal_manager' and a.zone_id = v_zone)
           or (p_kind = 'hub_manager' and a.hub_id = p_hub)
           or (p_kind = 'rider' and a.employee_id = p_employee))
    for update
  loop
    if v_from <= cur.effective_from then
      raise exception 'The new assignment must start after the current one began.' using errcode = 'P0001';
    end if;
    update public.ops_assignments set effective_to = v_from - 1, end_reason = 'Replaced: ' || p_reason where id = cur.id;
  end loop;

  insert into public.ops_assignments (kind, employee_id, zone_id, hub_id, duty, effective_from, reason)
  values (p_kind, p_employee, v_zone, p_hub, p_duty, v_from, p_reason)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_end_assignment(p_id uuid, p_to date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.ops_assignments%rowtype;
begin
  select * into a from public.ops_assignments where id = p_id for update;
  if a.id is null or not (case a.kind
        when 'zonal_manager' then private.has_permission('ops.assignment.edit')
        when 'hub_manager'   then private.has_permission('ops.assignment.edit', a.zone_id)
        else private.has_permission('ops.assignment.edit', a.zone_id, a.hub_id) end) then
    raise exception 'Assignment not found or not authorised.' using errcode = '42501';
  end if;
  if a.effective_to is not null then raise exception 'This assignment has already ended.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_to is null or p_to < a.effective_from then
    raise exception 'The end date cannot be before the start date.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.ops_assignments set effective_to = p_to, end_reason = p_reason where id = p_id;
end $$;

-- Hub-wise employees with their operational role.
create or replace function public.ops_hub_staff(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, ops_role text, duty text, since date)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, po.name,
         coalesce(a.kind, 'staff'), a.duty, coalesce(a.effective_from, e.joining_date)
  from public.employees e
  left join public.positions po on po.id = e.position_id
  left join lateral (
    select x.kind, x.duty, x.effective_from from public.ops_assignments x
    where x.employee_id = e.id and x.hub_id = p_hub and x.effective_to is null
    order by (x.kind = 'hub_manager') desc limit 1) a on true
  where private.has_permission('ops.assignment.view', null, p_hub)
    and e.status = 'active' and e.archived_at is null
    and (e.hub_id = p_hub or a.kind is not null)
  order by (a.kind = 'hub_manager') desc nulls last, e.full_name
$$;

-- ---------------------------------------------------------------------
-- Pickup submissions and the consolidated (approved) pickup
-- ---------------------------------------------------------------------
create sequence public.pickup_submission_no_seq;
create sequence public.cash_handover_no_seq;
create sequence public.merchant_payment_no_seq;
create sequence public.parcel_issue_no_seq;

create table public.pickup_consolidations (
  id                     uuid primary key default gen_random_uuid(),
  pickup_date            date not null,
  hub_id                 uuid not null references public.hubs(id),
  zone_id                uuid not null references public.zones(id),
  merchant_id            uuid not null references public.merchants(id),
  trip_no                smallint not null,
  rider_id               uuid references public.employees(id),
  parcel_count           integer not null check (parcel_count > 0),
  cod_amount             numeric(14,2) not null check (cod_amount >= 0),
  collection_amount      numeric(14,2) not null check (collection_amount >= 0),
  accepted_submission_id uuid not null,
  submission_count       integer not null,      -- how many submissions described this pickup
  had_conflict           boolean not null,      -- true = submissions disagreed; approval_note says why these figures
  approved_by            uuid not null,
  approved_at            timestamptz not null default now(),
  approval_note          text,
  voided_at              timestamptz,
  voided_by              uuid,
  void_reason            text,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  constraint pickup_consolidations_conflict_chk check (not had_conflict or length(trim(coalesce(approval_note, ''))) > 0)
);
create unique index pickup_consolidations_one_live on public.pickup_consolidations (pickup_date, hub_id, merchant_id, trip_no)
  where voided_at is null;
create index pickup_consolidations_hub_idx on public.pickup_consolidations (hub_id, pickup_date);

create table public.pickup_submissions (
  id                uuid primary key default gen_random_uuid(),
  submission_no     text not null unique default ('PS-' || lpad(nextval('public.pickup_submission_no_seq')::text, 6, '0')),
  pickup_date       date not null,
  hub_id            uuid not null references public.hubs(id),
  zone_id           uuid not null references public.zones(id),
  merchant_id       uuid not null references public.merchants(id),
  trip_no           smallint not null default 1 check (trip_no between 1 and 20),   -- 2nd, 3rd pickup of the same day
  source            text not null check (source in ('pickup_manager','hub_manager','rider')),
  submitted_by      uuid not null references public.profiles(id),
  submitted_at      timestamptz not null default now(),
  rider_id          uuid references public.employees(id),
  parcel_count      integer not null check (parcel_count > 0),
  cod_amount        numeric(14,2) not null default 0 check (cod_amount >= 0),         -- COD value of the parcels
  collection_amount numeric(14,2) not null default 0 check (collection_amount >= 0),  -- cash taken at pickup
  note              text,
  status            text not null default 'pending' check (status in ('pending','verified','approved','rejected')),
  verified_by       uuid,
  verified_at       timestamptz,
  decided_by        uuid,
  decided_at        timestamptz,
  decision_note     text,
  consolidation_id  uuid references public.pickup_consolidations(id),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);
-- One person submits a given pickup once (a rejected / withdrawn one may be redone).
create unique index pickup_submissions_one_per_person
  on public.pickup_submissions (pickup_date, hub_id, merchant_id, trip_no, submitted_by) where status <> 'rejected';
create index pickup_submissions_group_idx on public.pickup_submissions (hub_id, pickup_date, merchant_id, trip_no);

-- Cash collections are declared here because pickup approval writes them.
create table public.cash_collections (
  id                      uuid primary key default gen_random_uuid(),
  collection_date         date not null,
  hub_id                  uuid not null references public.hubs(id),
  zone_id                 uuid not null references public.zones(id),
  source                  text not null check (source in ('cod_delivery','pickup_collection','merchant_deposit','other')),
  holder                  text not null check (holder in ('rider','hub')),   -- who holds the cash after collection
  rider_id                uuid references public.employees(id),
  merchant_id             uuid references public.merchants(id),
  amount                  numeric(14,2) not null check (amount > 0),
  delivery_record_id      uuid,
  pickup_consolidation_id uuid references public.pickup_consolidations(id),
  note                    text,
  recorded_by             uuid,
  voided_at               timestamptz,
  voided_by               uuid,
  void_reason             text,
  ledger_entry_id         uuid,   -- ACCOUNTS HOOK: set when posted
  created_at              timestamptz not null default now(),
  created_by              uuid,
  updated_at              timestamptz not null default now(),
  updated_by              uuid,
  constraint cash_collections_holder_chk check ((holder = 'rider') = (rider_id is not null))
);
create index cash_collections_hub_idx on public.cash_collections (hub_id, collection_date);
create index cash_collections_rider_idx on public.cash_collections (rider_id, collection_date) where rider_id is not null;
create unique index cash_collections_one_per_delivery on public.cash_collections (delivery_record_id)
  where delivery_record_id is not null;

-- Compares the submissions of each pickup. NEVER sums them.
--   single    = one submission
--   duplicate = several submissions with identical figures (count once)
--   conflict  = submissions disagree; an approver must choose and explain
create or replace function public.ops_pickup_groups(
  p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (pickup_date date, hub_id uuid, merchant_id uuid, merchant_name text, trip_no smallint,
                 submissions integer, sources text[], check_state text, group_status text,
                 min_parcels integer, max_parcels integer, min_cod numeric, max_cod numeric,
                 min_collection numeric, max_collection numeric)
language sql stable security invoker set search_path = '' as $$
  select s.pickup_date, s.hub_id, s.merchant_id, max(m.name), s.trip_no, count(*)::integer,
         array_agg(distinct s.source order by s.source),
         case when count(*) = 1 then 'single'
              when min(s.parcel_count) = max(s.parcel_count) and min(s.cod_amount) = max(s.cod_amount)
                   and min(s.collection_amount) = max(s.collection_amount) then 'duplicate'
              else 'conflict' end,
         case when bool_or(s.status = 'approved') then 'approved'
              when bool_or(s.status = 'verified') then 'verified' else 'pending' end,
         min(s.parcel_count), max(s.parcel_count), min(s.cod_amount), max(s.cod_amount),
         min(s.collection_amount), max(s.collection_amount)
  from public.pickup_submissions s
  left join public.merchants m on m.id = s.merchant_id
  where (s.status <> 'rejected' or s.consolidation_id is not null)   -- withdrawn / rejected-before-approval are out
    and s.pickup_date between p_from and p_to
    and (p_zone is null or s.zone_id = p_zone)
    and (p_hub is null or s.hub_id = p_hub)
  group by s.pickup_date, s.hub_id, s.merchant_id, s.trip_no
  order by s.pickup_date, s.hub_id, max(m.name), s.trip_no
$$;

-- Is the caller one of the people who submitted this pickup?
create or replace function private.pickup_is_submitter(p_date date, p_hub uuid, p_merchant uuid, p_trip smallint)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pickup_submissions s
                 where s.pickup_date = p_date and s.hub_id = p_hub and s.merchant_id = p_merchant and s.trip_no = p_trip
                   and s.status <> 'rejected' and s.submitted_by = auth.uid())
$$;

create or replace function public.ops_submit_pickup(
  p_source text, p_date date, p_hub uuid, p_merchant uuid, p_parcels integer,
  p_cod numeric default 0, p_collection numeric default 0,
  p_rider uuid default null, p_trip integer default 1, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_rider uuid := p_rider;
  v_id    uuid;
begin
  if p_source is null or p_source not in ('pickup_manager','hub_manager','rider') then
    raise exception 'Source must be pickup_manager, hub_manager or rider.' using errcode = '22023';
  end if;
  if v_zone is null or not private.has_permission('ops.pickup_as_' || p_source || '.create', v_zone, p_hub) then
    raise exception 'Not authorised to submit pickups as % for this hub.', p_source using errcode = '42501';
  end if;
  if not private.ops_date_ok(p_date) then
    raise exception 'The pickup date must be today or within the allowed back-dating period.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.merchants m where m.id = p_merchant and m.status = 'active' and m.archived_at is null) then
    raise exception 'The merchant must be active.' using errcode = '22023';
  end if;
  if p_source = 'rider' then
    v_rider := private.my_employee_id();
    if v_rider is null or not private.is_current_rider(v_rider, p_hub) then
      raise exception 'Only a rider currently assigned to this hub can submit a rider pickup.' using errcode = '42501';
    end if;
  elsif v_rider is not null and not private.is_current_rider(v_rider, p_hub) then
    raise exception 'The rider is not currently assigned to this hub.' using errcode = '22023';
  end if;
  if exists (select 1 from public.pickup_consolidations c
             where c.pickup_date = p_date and c.hub_id = p_hub and c.merchant_id = p_merchant
               and c.trip_no = coalesce(p_trip, 1) and c.voided_at is null) then
    raise exception 'This pickup has already been approved. Ask an approver to reopen it if it is wrong.' using errcode = 'P0001';
  end if;
  if private.pickup_is_submitter(p_date, p_hub, p_merchant, coalesce(p_trip, 1)::smallint) then
    raise exception 'You have already submitted this pickup. Withdraw it first, or use the next trip number for a second pickup.'
      using errcode = '23505';
  end if;

  insert into public.pickup_submissions (pickup_date, hub_id, zone_id, merchant_id, trip_no, source, submitted_by, rider_id,
                                         parcel_count, cod_amount, collection_amount, note)
  values (p_date, p_hub, v_zone, p_merchant, coalesce(p_trip, 1), p_source, auth.uid(), v_rider,
          p_parcels, coalesce(p_cod, 0), coalesce(p_collection, 0), p_note)
  returning id into v_id;
  return v_id;
end $$;

-- The submitter takes back a submission that has not been checked yet.
create or replace function public.ops_withdraw_pickup(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.pickup_submissions%rowtype;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or s.submitted_by <> auth.uid() then
    raise exception 'Only the submitter can withdraw a submission.' using errcode = '42501';
  end if;
  if s.status <> 'pending' then raise exception 'Only a pending submission can be withdrawn.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.pickup_submissions
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'Withdrawn by submitter: ' || p_reason
   where id = p_id;
end $$;

create or replace function public.ops_verify_pickup(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.pickup_submissions%rowtype;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or not private.has_permission('ops.pickup_verification.create', s.zone_id, s.hub_id) then
    raise exception 'Submission not found or not authorised to verify.' using errcode = '42501';
  end if;
  if s.status <> 'pending' then raise exception 'Only a pending submission can be verified.' using errcode = 'P0001'; end if;
  if private.pickup_is_submitter(s.pickup_date, s.hub_id, s.merchant_id, s.trip_no) then
    raise exception 'A person who submitted this pickup cannot verify it.' using errcode = '42501';
  end if;
  update public.pickup_submissions set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_id;
end $$;

create or replace function public.ops_reject_pickup(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.pickup_submissions%rowtype;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or not private.has_permission('ops.pickup.reject', s.zone_id, s.hub_id) then
    raise exception 'Submission not found or not authorised.' using errcode = '42501';
  end if;
  if s.submitted_by = auth.uid() then
    raise exception 'You cannot reject your own submission; withdraw it instead.' using errcode = '42501';
  end if;
  if s.status not in ('pending','verified') then
    raise exception 'This submission has already been decided.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.pickup_submissions
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_reason
   where id = p_id;
end $$;

-- Approves ONE consolidated record for the pickup, using the figures of the
-- chosen (verified) submission. Submissions with the same figures are marked
-- approved duplicates; submissions that disagree are rejected. A note is
-- required when submissions conflict.
create or replace function public.ops_approve_pickup(p_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s          public.pickup_submissions%rowtype;
  v_n        integer;
  v_conflict boolean;
  v_id       uuid;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or not private.has_permission('ops.pickup.approve', s.zone_id, s.hub_id) then
    raise exception 'Submission not found or not authorised to approve.' using errcode = '42501';
  end if;
  if s.status <> 'verified' then
    raise exception 'A submission must be verified before it can be approved.' using errcode = 'P0001';
  end if;
  if private.pickup_is_submitter(s.pickup_date, s.hub_id, s.merchant_id, s.trip_no) then
    raise exception 'A person who submitted this pickup cannot approve it.' using errcode = '42501';
  end if;
  perform 1 from public.pickup_submissions g
   where g.pickup_date = s.pickup_date and g.hub_id = s.hub_id and g.merchant_id = s.merchant_id and g.trip_no = s.trip_no
     and g.status in ('pending','verified')
   for update;
  if exists (select 1 from public.pickup_consolidations c
             where c.pickup_date = s.pickup_date and c.hub_id = s.hub_id and c.merchant_id = s.merchant_id
               and c.trip_no = s.trip_no and c.voided_at is null) then
    raise exception 'This pickup has already been approved.' using errcode = 'P0001';
  end if;

  select count(*)::integer,
         coalesce(bool_or((g.parcel_count, g.cod_amount, g.collection_amount)
                          is distinct from (s.parcel_count, s.cod_amount, s.collection_amount)), false)
    into v_n, v_conflict
  from public.pickup_submissions g
  where g.pickup_date = s.pickup_date and g.hub_id = s.hub_id and g.merchant_id = s.merchant_id and g.trip_no = s.trip_no
    and g.status in ('pending','verified');
  if v_conflict and coalesce(trim(p_note), '') = '' then
    raise exception 'The submissions for this pickup conflict. A note explaining the accepted figures is required.'
      using errcode = '22023';
  end if;

  insert into public.pickup_consolidations (pickup_date, hub_id, zone_id, merchant_id, trip_no, rider_id, parcel_count,
                                            cod_amount, collection_amount, accepted_submission_id, submission_count,
                                            had_conflict, approved_by, approval_note)
  values (s.pickup_date, s.hub_id, s.zone_id, s.merchant_id, s.trip_no, s.rider_id, s.parcel_count,
          s.cod_amount, s.collection_amount, s.id, v_n, v_conflict, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;

  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), 'Pickup approved'), true);
  update public.pickup_submissions g
     set status = case when (g.parcel_count, g.cod_amount, g.collection_amount)
                            is not distinct from (s.parcel_count, s.cod_amount, s.collection_amount)
                       then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), consolidation_id = v_id,
         decision_note = case
           when g.id = s.id then nullif(trim(p_note), '')
           when (g.parcel_count, g.cod_amount, g.collection_amount)
                is not distinct from (s.parcel_count, s.cod_amount, s.collection_amount)
             then 'Duplicate of ' || s.submission_no || ' (same figures, counted once)'
           else 'Conflicts with accepted submission ' || s.submission_no end
   where g.pickup_date = s.pickup_date and g.hub_id = s.hub_id and g.merchant_id = s.merchant_id and g.trip_no = s.trip_no
     and g.status in ('pending','verified');

  if s.collection_amount > 0 then
    insert into public.cash_collections (collection_date, hub_id, zone_id, source, holder, rider_id, merchant_id, amount,
                                         pickup_consolidation_id, note, recorded_by)
    values (s.pickup_date, s.hub_id, s.zone_id, 'pickup_collection',
            case when s.rider_id is null then 'hub' else 'rider' end, s.rider_id, s.merchant_id, s.collection_amount,
            v_id, 'Cash taken at pickup ' || s.submission_no, auth.uid());
  end if;
  perform private.ops_refresh_hub_day(s.hub_id, s.pickup_date);
  return v_id;
end $$;

-- Reopens an approved pickup that turned out to be wrong. The accepted
-- submissions go back to "verified"; the consolidated record is voided.
create or replace function public.ops_void_pickup(p_consolidation uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.pickup_consolidations%rowtype;
begin
  select * into c from public.pickup_consolidations where id = p_consolidation for update;
  if c.id is null or not private.has_permission('ops.pickup.approve', c.zone_id, c.hub_id) then
    raise exception 'Approved pickup not found or not authorised.' using errcode = '42501';
  end if;
  if c.voided_at is not null then raise exception 'This pickup has already been reopened.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.pickup_consolidations set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = c.id;
  update public.pickup_submissions
     set status = case when status = 'approved' then 'verified' else status end,
         consolidation_id = null,
         decided_by = case when status = 'approved' then null else decided_by end,
         decided_at = case when status = 'approved' then null else decided_at end,
         decision_note = case when status = 'approved' then 'Reopened: ' || p_reason else decision_note end
   where consolidation_id = c.id;
  update public.cash_collections set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where pickup_consolidation_id = c.id and voided_at is null;
  perform private.ops_refresh_hub_day(c.hub_id, c.pickup_date);
end $$;

-- ---------------------------------------------------------------------
-- Dispatch and delivery
-- ---------------------------------------------------------------------
create table public.delivery_records (
  id             uuid primary key default gen_random_uuid(),
  parcel_id      uuid not null references public.parcels(id),
  merchant_id    uuid not null references public.merchants(id),
  hub_id         uuid not null references public.hubs(id),
  zone_id        uuid not null references public.zones(id),
  rider_id       uuid not null references public.employees(id),
  delivery_date  date not null,
  outcome        text not null check (outcome in ('delivered','failed','returned')),
  cod_expected   numeric(14,2) not null default 0 check (cod_expected >= 0),
  cod_collected  numeric(14,2) not null default 0 check (cod_collected >= 0),
  failure_reason text,
  recipient_name text,
  recorded_by    uuid not null,
  recorded_at    timestamptz not null default now(),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint delivery_records_cod_chk check (outcome = 'delivered' or cod_collected = 0),
  constraint delivery_records_reason_chk check (outcome = 'delivered' or length(trim(coalesce(failure_reason, ''))) > 0)
);
create unique index delivery_records_one_open on public.delivery_records (parcel_id) where status = 'pending';
create unique index delivery_records_one_final on public.delivery_records (parcel_id)
  where status = 'approved' and outcome in ('delivered','returned');
create index delivery_records_hub_idx on public.delivery_records (hub_id, delivery_date);
create index delivery_records_rider_idx on public.delivery_records (rider_id, delivery_date);
alter table public.cash_collections
  add constraint cash_collections_delivery_fk foreign key (delivery_record_id) references public.delivery_records(id);

create or replace function public.ops_dispatch_parcels(p_rider uuid, p_parcels uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p    public.parcels%rowtype;
  v_id uuid;
  v_n  integer := 0;
begin
  foreach v_id in array coalesce(p_parcels, '{}'::uuid[]) loop
    select * into p from public.parcels where id = v_id for update;
    if p.id is null or not private.has_permission('ops.parcel.edit', p.zone_id, p.hub_id) then
      raise exception 'Parcel not found or not authorised.' using errcode = '42501';
    end if;
    if p.status <> 'at_hub' then
      raise exception 'Parcel % is % and cannot be dispatched.', p.tracking_no, p.status using errcode = 'P0001';
    end if;
    if not private.is_current_rider(p_rider, p.hub_id) then
      raise exception 'The rider is not currently assigned to the hub of parcel %.', p.tracking_no using errcode = '22023';
    end if;
    update public.parcels set status = 'out_for_delivery', assigned_rider_id = p_rider where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.ops_cancel_parcel(p_parcel uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.parcels%rowtype;
begin
  select * into p from public.parcels where id = p_parcel for update;
  if p.id is null or not private.has_permission('ops.parcel.edit', p.zone_id, p.hub_id) then
    raise exception 'Parcel not found or not authorised.' using errcode = '42501';
  end if;
  if p.status <> 'at_hub' then raise exception 'Only a parcel at the hub can be cancelled.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.parcels set status = 'cancelled', cancel_reason = p_reason, closed_at = now() where id = p_parcel;
end $$;

-- The rider (for own parcels) or hub staff (on the rider's behalf) records the outcome.
create or replace function public.ops_record_delivery(
  p_parcel uuid, p_outcome text, p_cod_collected numeric default 0, p_reason text default null,
  p_recipient text default null, p_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p      public.parcels%rowtype;
  v_date date := coalesce(p_date, current_date);
  v_id   uuid;
begin
  select * into p from public.parcels where id = p_parcel for update;
  if p.id is null or not private.has_permission('ops.delivery.create', p.zone_id, p.hub_id)
     or not (p.assigned_rider_id = private.my_employee_id()
             or private.has_permission('ops.parcel.edit', p.zone_id, p.hub_id)) is true then
    raise exception 'Parcel not found or not authorised to record its delivery.' using errcode = '42501';
  end if;
  if p.status <> 'out_for_delivery' then
    raise exception 'Parcel % is % and is not out for delivery.', p.tracking_no, p.status using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('delivered','failed','returned') then
    raise exception 'Outcome must be delivered, failed or returned.' using errcode = '22023';
  end if;
  if not private.ops_date_ok(v_date) or v_date < p.received_date then
    raise exception 'The delivery date is outside the allowed period.' using errcode = '22023';
  end if;
  if p_outcome <> 'delivered' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for a failed or returned parcel.' using errcode = '22023';
  end if;
  if exists (select 1 from public.delivery_records d where d.parcel_id = p.id and d.status = 'pending') then
    raise exception 'This parcel already has a delivery record waiting for approval.' using errcode = 'P0001';
  end if;

  insert into public.delivery_records (parcel_id, merchant_id, hub_id, zone_id, rider_id, delivery_date, outcome,
                                       cod_expected, cod_collected, failure_reason, recipient_name, recorded_by)
  values (p.id, p.merchant_id, p.hub_id, p.zone_id, p.assigned_rider_id, v_date, p_outcome,
          case when p_outcome = 'delivered' then p.cod_amount else 0 end,
          case when p_outcome = 'delivered' then coalesce(p_cod_collected, 0) else 0 end,
          nullif(trim(p_reason), ''), p_recipient, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- A second person approves or rejects. Approval moves the parcel and, for a
-- delivered COD parcel, records the cash now held by the rider.
create or replace function public.ops_decide_delivery(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.delivery_records%rowtype;
begin
  select * into d from public.delivery_records where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if d.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'ops.delivery.approve' else 'ops.delivery.reject' end, d.zone_id, d.hub_id) then
    raise exception 'Delivery record not found or not authorised.' using errcode = '42501';
  end if;
  if d.recorded_by = auth.uid() or d.rider_id = private.my_employee_id() then
    raise exception 'The person who recorded or made the delivery cannot decide it.' using errcode = '42501';
  end if;
  if d.status <> 'pending' then raise exception 'This delivery record has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a delivery record is rejected.' using errcode = '22023';
  end if;
  if p_decision = 'approved' and d.cod_collected <> d.cod_expected and coalesce(trim(p_note), '') = '' then
    raise exception 'COD collected (%) differs from COD expected (%). A note is required.', d.cod_collected, d.cod_expected
      using errcode = '22023';
  end if;

  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.delivery_records
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_decision = 'rejected' then return; end if;   -- parcel stays with the rider; a new record is made

  if d.outcome = 'failed' then
    update public.parcels set status = 'at_hub', assigned_rider_id = null, attempt_count = attempt_count + 1 where id = d.parcel_id;
  else
    update public.parcels set status = d.outcome, assigned_rider_id = null, attempt_count = attempt_count + 1, closed_at = now()
     where id = d.parcel_id;
  end if;
  if d.outcome = 'delivered' and d.cod_collected > 0 then
    insert into public.cash_collections (collection_date, hub_id, zone_id, source, holder, rider_id, merchant_id, amount,
                                         delivery_record_id, note, recorded_by)
    values (d.delivery_date, d.hub_id, d.zone_id, 'cod_delivery', 'rider', d.rider_id, d.merchant_id, d.cod_collected,
            d.id, 'COD of delivered parcel', auth.uid());
  end if;
  perform private.ops_refresh_hub_day(d.hub_id, d.delivery_date);
end $$;

-- ---------------------------------------------------------------------
-- Cash: hub collections, handover chain, merchant payments, expenses
-- ---------------------------------------------------------------------
-- Cash a manager takes in at the hub counter (not through a rider).
create or replace function public.ops_record_cash_collection(
  p_hub uuid, p_date date, p_amount numeric, p_source text, p_note text, p_merchant uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  v_id   uuid;
begin
  if v_zone is null or not private.has_permission('ops.cash.create', v_zone, p_hub) then
    raise exception 'Not authorised to record cash for this hub.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('merchant_deposit','other') then
    raise exception 'Source must be merchant_deposit or other. COD and pickup cash come from approved records.'
      using errcode = '22023';
  end if;
  if not private.ops_date_ok(p_date) then raise exception 'The date is outside the allowed period.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  insert into public.cash_collections (collection_date, hub_id, zone_id, source, holder, merchant_id, amount, note, recorded_by)
  values (p_date, p_hub, v_zone, p_source, 'hub', p_merchant, p_amount, p_note, auth.uid())
  returning id into v_id;
  perform private.ops_refresh_hub_day(p_hub, p_date);
  return v_id;
end $$;

create table public.operational_expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_date    date not null,
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  category        text not null check (category in
                  ('fuel','vehicle_maintenance','rent','utilities','packaging','office','conveyance','other')),
  amount          numeric(14,2) not null check (amount > 0),
  description     text not null check (length(trim(description)) > 2),
  rider_id        uuid references public.employees(id),
  paid_from       text not null default 'hub_cash' check (paid_from in ('hub_cash','rider_cash')),
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  recorded_by     uuid not null,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  ledger_entry_id uuid,   -- ACCOUNTS HOOK
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint operational_expenses_rider_chk check (paid_from <> 'rider_cash' or rider_id is not null)
);
create index operational_expenses_hub_idx on public.operational_expenses (hub_id, expense_date);

create table public.cash_handovers (
  id              uuid primary key default gen_random_uuid(),
  handover_no     text not null unique default ('HO-' || lpad(nextval('public.cash_handover_no_seq')::text, 6, '0')),
  level           text not null check (level in ('rider_to_hub','hub_to_accounts')),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  rider_id        uuid references public.employees(id),
  handover_date   date not null default current_date,
  expected_amount numeric(14,2) not null,                          -- balance on record when submitted
  declared_amount numeric(14,2) not null check (declared_amount > 0),   -- what the giver says was handed over
  received_amount numeric(14,2) check (received_amount >= 0),           -- what the receiver counted
  shortage_amount numeric(14,2) generated always as (declared_amount - received_amount) stored,  -- + short, - excess
  status          text not null default 'submitted' check (status in ('submitted','confirmed','cancelled')),
  handed_by       uuid not null,
  handed_at       timestamptz not null default now(),
  note            text,
  received_by     uuid,
  received_at     timestamptz,
  receiver_note   text,
  cancel_reason   text,
  ledger_entry_id uuid,   -- ACCOUNTS HOOK (a shortage becomes a receivable from the giver)
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint cash_handovers_rider_chk check ((level = 'rider_to_hub') = (rider_id is not null)),
  constraint cash_handovers_confirm_chk check (status <> 'confirmed' or (received_amount is not null and received_by is not null)),
  constraint cash_handovers_shortage_chk check (status <> 'confirmed' or received_amount = declared_amount
                                                or length(trim(coalesce(receiver_note, ''))) > 0)
);
create unique index cash_handovers_one_open_per_rider on public.cash_handovers (rider_id)
  where level = 'rider_to_hub' and status = 'submitted';
create index cash_handovers_hub_idx on public.cash_handovers (hub_id, handover_date);

create table public.merchant_payments (
  id              uuid primary key default gen_random_uuid(),
  payment_no      text not null unique default ('MP-' || lpad(nextval('public.merchant_payment_no_seq')::text, 6, '0')),
  merchant_id     uuid not null references public.merchants(id),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  payment_date    date not null,
  amount          numeric(14,2) not null check (amount > 0),
  method          text not null check (method in ('cash','bank','mobile_banking')),
  reference       text,
  note            text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by    uuid not null,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  ledger_entry_id uuid,   -- ACCOUNTS HOOK
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint merchant_payments_reference_chk check (method = 'cash' or length(trim(coalesce(reference, ''))) > 0)
);
create index merchant_payments_merchant_idx on public.merchant_payments (merchant_id, payment_date);
create index merchant_payments_hub_idx on public.merchant_payments (hub_id, payment_date);

create table public.cash_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  recon_date         date not null,
  opening_balance    numeric(14,2) not null,
  rider_handovers_in numeric(14,2) not null,
  hub_collections_in numeric(14,2) not null,
  sent_to_accounts   numeric(14,2) not null,
  merchant_cash_paid numeric(14,2) not null,
  expenses_paid      numeric(14,2) not null,
  expected_closing   numeric(14,2) not null,
  counted_cash       numeric(14,2) not null check (counted_cash >= 0),
  difference         numeric(14,2) generated always as (counted_cash - expected_closing) stored,   -- - short, + excess
  note               text,
  status             text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  prepared_by        uuid not null,
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  ledger_entry_id    uuid,   -- ACCOUNTS HOOK (post the difference)
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint cash_reconciliations_note_chk check (counted_cash = expected_closing or length(trim(coalesce(note, ''))) > 0)
);
create unique index cash_reconciliations_one_per_day on public.cash_reconciliations (hub_id, recon_date)
  where status <> 'rejected';

-- Cash a rider still holds: collected - received by the hub - approved expenses paid from it.
-- A shortage stays in this balance until it is settled.
create or replace function private.rider_cash_balance(p_rider uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(c.amount) from public.cash_collections c
                   where c.rider_id = p_rider and c.holder = 'rider' and c.voided_at is null), 0)
       - coalesce((select sum(h.received_amount) from public.cash_handovers h
                   where h.rider_id = p_rider and h.level = 'rider_to_hub' and h.status = 'confirmed'), 0)
       - coalesce((select sum(e.amount) from public.operational_expenses e
                   where e.rider_id = p_rider and e.paid_from = 'rider_cash' and e.status = 'approved'), 0)
$$;

-- Hub cash movements between two dates (p_from null = from the beginning).
create or replace function private.hub_cash_movements(p_hub uuid, p_from date, p_to date)
returns table (rider_in numeric, hub_in numeric, accounts_out numeric, merchant_out numeric, expense_out numeric)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(h.received_amount) from public.cash_handovers h
              where h.hub_id = p_hub and h.level = 'rider_to_hub' and h.status = 'confirmed'
                and h.handover_date <= p_to and (p_from is null or h.handover_date >= p_from)), 0),
    coalesce((select sum(c.amount) from public.cash_collections c
              where c.hub_id = p_hub and c.holder = 'hub' and c.voided_at is null
                and c.collection_date <= p_to and (p_from is null or c.collection_date >= p_from)), 0),
    coalesce((select sum(h.declared_amount) from public.cash_handovers h      -- cash leaves the hub when it is sent
              where h.hub_id = p_hub and h.level = 'hub_to_accounts' and h.status in ('submitted','confirmed')
                and h.handover_date <= p_to and (p_from is null or h.handover_date >= p_from)), 0),
    coalesce((select sum(m.amount) from public.merchant_payments m
              where m.hub_id = p_hub and m.method = 'cash' and m.status = 'approved'
                and m.payment_date <= p_to and (p_from is null or m.payment_date >= p_from)), 0),
    coalesce((select sum(e.amount) from public.operational_expenses e
              where e.hub_id = p_hub and e.paid_from = 'hub_cash' and e.status = 'approved'
                and e.expense_date <= p_to and (p_from is null or e.expense_date >= p_from)), 0)
$$;

-- Expected hub cash for a day. Opening = cash counted at the last approved
-- reconciliation plus movements since; without one, all movements so far.
create or replace function private.hub_cash_position(
  p_hub uuid, p_date date,
  out opening_balance numeric, out rider_handovers_in numeric, out hub_collections_in numeric,
  out sent_to_accounts numeric, out merchant_cash_paid numeric, out expenses_paid numeric,
  out expected_closing numeric, out last_reconciled date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_counted numeric;
  m record;
begin
  select r.recon_date, r.counted_cash into last_reconciled, v_counted
  from public.cash_reconciliations r
  where r.hub_id = p_hub and r.status = 'approved' and r.recon_date < p_date
  order by r.recon_date desc limit 1;

  select x.rider_in + x.hub_in - x.accounts_out - x.merchant_out - x.expense_out as net into m
  from private.hub_cash_movements(p_hub, last_reconciled + 1, p_date - 1) x;
  opening_balance := coalesce(v_counted, 0) + m.net;

  select x.* into m from private.hub_cash_movements(p_hub, p_date, p_date) x;
  rider_handovers_in := m.rider_in;
  hub_collections_in := m.hub_in;
  sent_to_accounts   := m.accounts_out;
  merchant_cash_paid := m.merchant_out;
  expenses_paid      := m.expense_out;
  expected_closing   := opening_balance + m.rider_in + m.hub_in - m.accounts_out - m.merchant_out - m.expense_out;
end $$;

create or replace function public.ops_cash_position(p_hub uuid, p_date date)
returns table (opening_balance numeric, rider_handovers_in numeric, hub_collections_in numeric, sent_to_accounts numeric,
               merchant_cash_paid numeric, expenses_paid numeric, expected_closing numeric, last_reconciled date)
language sql stable security definer set search_path = '' as $$
  select p.* from private.hub_cash_position(p_hub, p_date) p
  where private.has_permission('ops.cash.view', null, p_hub) or private.has_permission('ops.reconciliation.view', null, p_hub)
$$;

-- Rider hands cash to the hub. Hub staff may submit for a rider without a login.
create or replace function public.ops_submit_rider_handover(
  p_hub uuid, p_amount numeric, p_rider uuid default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone     uuid := private.hub_zone(p_hub);
  v_me       uuid := private.my_employee_id();
  v_rider    uuid := coalesce(p_rider, private.my_employee_id());
  v_expected numeric;
  v_id       uuid;
begin
  if v_zone is null or not private.has_permission('ops.rider_handover.create', v_zone, p_hub)
     or not (v_rider = v_me or private.has_permission('ops.cash.create', v_zone, p_hub)) is true then
    raise exception 'Not authorised to submit this handover.' using errcode = '42501';
  end if;
  if not private.is_current_rider(v_rider, p_hub) then
    raise exception 'The rider is not currently assigned to this hub.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if exists (select 1 from public.cash_handovers h where h.rider_id = v_rider and h.level = 'rider_to_hub' and h.status = 'submitted') then
    raise exception 'This rider already has a handover waiting for confirmation.' using errcode = 'P0001';
  end if;
  v_expected := private.rider_cash_balance(v_rider);
  if p_amount <> v_expected and coalesce(trim(p_note), '') = '' then
    raise exception 'The amount (%) differs from the cash on record for this rider (%). A note is required.', p_amount, v_expected
      using errcode = '22023';
  end if;
  insert into public.cash_handovers (level, hub_id, zone_id, rider_id, expected_amount, declared_amount, handed_by, note)
  values ('rider_to_hub', p_hub, v_zone, v_rider, v_expected, p_amount, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Hub sends cash to Main Accounts. Cannot exceed the hub cash on record.
create or replace function public.ops_submit_hub_handover(p_hub uuid, p_amount numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone     uuid := private.hub_zone(p_hub);
  v_expected numeric;
  v_id       uuid;
begin
  if v_zone is null or not private.has_permission('ops.hub_handover.create', v_zone, p_hub) then
    raise exception 'Not authorised to hand over cash for this hub.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  select p.expected_closing into v_expected from private.hub_cash_position(p_hub, current_date) p;
  if p_amount > v_expected then
    raise exception 'The amount (%) is more than the hub cash on record (%). Confirm rider handovers first.', p_amount, v_expected
      using errcode = 'P0001';
  end if;
  insert into public.cash_handovers (level, hub_id, zone_id, expected_amount, declared_amount, handed_by, note)
  values ('hub_to_accounts', p_hub, v_zone, v_expected, p_amount, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

-- The RECEIVER states what was actually received. A difference needs a note
-- and is recorded as a shortage (or excess) against the giver.
create or replace function public.ops_confirm_handover(p_id uuid, p_received numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.cash_handovers%rowtype;
begin
  select * into h from public.cash_handovers where id = p_id for update;
  if h.id is null or not private.has_permission(
       case when h.level = 'rider_to_hub' then 'ops.rider_handover.approve' else 'ops.hub_handover.approve' end,
       h.zone_id, h.hub_id) then
    raise exception 'Handover not found or not authorised to confirm.' using errcode = '42501';
  end if;
  if h.handed_by = auth.uid() or h.rider_id = private.my_employee_id() then
    raise exception 'The person who hands over cash cannot confirm receiving it.' using errcode = '42501';
  end if;
  if h.status <> 'submitted' then raise exception 'This handover is already %.', h.status using errcode = 'P0001'; end if;
  if p_received is null or p_received < 0 then raise exception 'Enter the amount actually received.' using errcode = '22023'; end if;
  if p_received <> h.declared_amount and coalesce(trim(p_note), '') = '' then
    raise exception 'Received (%) differs from declared (%). A note is required.', p_received, h.declared_amount
      using errcode = '22023';
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), 'Handover confirmed'), true);
  update public.cash_handovers
     set status = 'confirmed', received_amount = p_received, received_by = auth.uid(), received_at = now(),
         receiver_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;

create or replace function public.ops_cancel_handover(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.cash_handovers%rowtype;
begin
  select * into h from public.cash_handovers where id = p_id for update;
  if h.id is null or h.handed_by <> auth.uid() then
    raise exception 'Only the person who submitted a handover can cancel it.' using errcode = '42501';
  end if;
  if h.status <> 'submitted' then raise exception 'This handover is already %.', h.status using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.cash_handovers set status = 'cancelled', cancel_reason = p_reason where id = p_id;
end $$;

create or replace function public.ops_record_expense(
  p_hub uuid, p_date date, p_category text, p_amount numeric, p_description text,
  p_paid_from text default 'hub_cash', p_rider uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_me    uuid := private.my_employee_id();
  v_rider uuid := p_rider;
  v_id    uuid;
begin
  if v_zone is null or not private.has_permission('ops.expense.create', v_zone, p_hub) then
    raise exception 'Not authorised to record expenses for this hub.' using errcode = '42501';
  end if;
  if coalesce(p_paid_from, '') not in ('hub_cash','rider_cash') then
    raise exception 'Paid from must be hub_cash or rider_cash.' using errcode = '22023';
  end if;
  if p_paid_from = 'rider_cash' and v_rider is null then v_rider := v_me; end if;
  if (v_rider is distinct from v_me or p_paid_from = 'hub_cash')
     and not private.has_permission('ops.cash.create', v_zone, p_hub) then
    raise exception 'Riders can record only their own expenses paid from the cash they hold.' using errcode = '42501';
  end if;
  if v_rider is not null and not private.is_current_rider(v_rider, p_hub) then
    raise exception 'The rider is not currently assigned to this hub.' using errcode = '22023';
  end if;
  if not private.ops_date_ok(p_date) then raise exception 'The date is outside the allowed period.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  insert into public.operational_expenses (expense_date, hub_id, zone_id, category, amount, description, rider_id, paid_from, recorded_by)
  values (p_date, p_hub, v_zone, p_category, p_amount, p_description, v_rider, p_paid_from, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_decide_expense(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.operational_expenses%rowtype;
begin
  select * into e from public.operational_expenses where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if e.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'ops.expense.approve' else 'ops.expense.reject' end, e.zone_id, e.hub_id) then
    raise exception 'Expense not found or not authorised.' using errcode = '42501';
  end if;
  if e.recorded_by = auth.uid() or e.rider_id = private.my_employee_id() then
    raise exception 'You cannot decide an expense you recorded or spent.' using errcode = '42501';
  end if;
  if e.status <> 'pending' then raise exception 'This expense has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when an expense is rejected.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.operational_expenses
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_decision = 'approved' then perform private.ops_refresh_hub_day(e.hub_id, e.expense_date); end if;
end $$;

-- COD collected for the merchant on approved deliveries, less payments already approved.
-- (Delivery charges are deducted by the Accounts phase; until then this is the ceiling.)
create or replace function private.merchant_payable(p_merchant uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(d.cod_collected) from public.delivery_records d
                   where d.merchant_id = p_merchant and d.status = 'approved' and d.outcome = 'delivered'), 0)
       - coalesce((select sum(m.amount) from public.merchant_payments m
                   where m.merchant_id = p_merchant and m.status = 'approved'), 0)
$$;

create or replace function public.ops_request_merchant_payment(
  p_merchant uuid, p_hub uuid, p_amount numeric, p_method text,
  p_reference text default null, p_date date default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  v_id   uuid;
begin
  if v_zone is null or not private.has_permission('ops.merchant_payment.create', v_zone, p_hub) then
    raise exception 'Not authorised to request merchant payments for this hub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.merchants m where m.id = p_merchant and m.archived_at is null) then
    raise exception 'Merchant not found.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if coalesce(p_method, '') not in ('cash','bank','mobile_banking') then
    raise exception 'Method must be cash, bank or mobile_banking.' using errcode = '22023';
  end if;
  if p_method <> 'cash' and coalesce(trim(p_reference), '') = '' then
    raise exception 'A transaction reference is required for bank and mobile banking payments.' using errcode = '22023';
  end if;
  if not private.ops_date_ok(coalesce(p_date, current_date)) then
    raise exception 'The date is outside the allowed period.' using errcode = '22023';
  end if;
  insert into public.merchant_payments (merchant_id, hub_id, zone_id, payment_date, amount, method, reference, note, requested_by)
  values (p_merchant, p_hub, v_zone, coalesce(p_date, current_date), p_amount, p_method, nullif(trim(p_reference), ''), p_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_decide_merchant_payment(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m         public.merchant_payments%rowtype;
  v_payable numeric;
begin
  select * into m from public.merchant_payments where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if m.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'ops.merchant_payment.approve' else 'ops.merchant_payment.reject' end,
       m.zone_id, m.hub_id) then
    raise exception 'Merchant payment not found or not authorised.' using errcode = '42501';
  end if;
  if m.requested_by = auth.uid() then
    raise exception 'You cannot decide a merchant payment you requested.' using errcode = '42501';
  end if;
  if m.status <> 'pending' then raise exception 'This payment has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a payment is rejected.' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    perform 1 from public.merchants x where x.id = m.merchant_id for update;   -- serialise payments per merchant
    v_payable := private.merchant_payable(m.merchant_id);
    if m.amount > v_payable then
      raise exception 'The payment (%) is more than the COD collected and not yet paid for this merchant (%).', m.amount, v_payable
        using errcode = 'P0001';
    end if;
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.merchant_payments
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;

-- Daily cash count of a hub against the expected closing balance.
create or replace function public.ops_submit_reconciliation(p_hub uuid, p_date date, p_counted numeric, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  pos    record;
  v_id   uuid;
begin
  if v_zone is null or not private.has_permission('ops.reconciliation.create', v_zone, p_hub) then
    raise exception 'Not authorised to reconcile cash for this hub.' using errcode = '42501';
  end if;
  if p_date is null or p_date > current_date then raise exception 'The date cannot be in the future.' using errcode = '22023'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash counted.' using errcode = '22023'; end if;
  if exists (select 1 from public.cash_reconciliations r where r.hub_id = p_hub and r.recon_date = p_date and r.status <> 'rejected') then
    raise exception 'This day has already been reconciled.' using errcode = 'P0001';
  end if;
  select * into pos from private.hub_cash_position(p_hub, p_date);
  if p_counted <> pos.expected_closing and coalesce(trim(p_note), '') = '' then
    raise exception 'Cash counted (%) differs from expected (%). A note explaining the difference is required.',
      p_counted, pos.expected_closing using errcode = '22023';
  end if;
  insert into public.cash_reconciliations (hub_id, zone_id, recon_date, opening_balance, rider_handovers_in, hub_collections_in,
                                           sent_to_accounts, merchant_cash_paid, expenses_paid, expected_closing, counted_cash,
                                           note, prepared_by)
  values (p_hub, v_zone, p_date, pos.opening_balance, pos.rider_handovers_in, pos.hub_collections_in, pos.sent_to_accounts,
          pos.merchant_cash_paid, pos.expenses_paid, pos.expected_closing, p_counted, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_decide_reconciliation(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cash_reconciliations%rowtype;
begin
  select * into r from public.cash_reconciliations where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if r.id is null or not private.has_permission('ops.reconciliation.approve', r.zone_id, r.hub_id) then
    raise exception 'Reconciliation not found or not authorised.' using errcode = '42501';
  end if;
  if r.prepared_by = auth.uid() then
    raise exception 'You cannot decide a reconciliation you prepared.' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then raise exception 'This reconciliation has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a reconciliation is rejected.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.cash_reconciliations
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Parcel issues
-- ---------------------------------------------------------------------
create table public.parcel_issues (
  id          uuid primary key default gen_random_uuid(),
  issue_no    text not null unique default ('PI-' || lpad(nextval('public.parcel_issue_no_seq')::text, 6, '0')),
  parcel_id   uuid not null references public.parcels(id),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  issue_type  text not null check (issue_type in
              ('damaged','lost','wrong_address','customer_complaint','cod_mismatch','delay','merchant_dispute','other')),
  priority    text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  description text not null check (length(trim(description)) > 2),
  status      text not null default 'open' check (status in ('open','assigned','resolved')),
  reported_by uuid not null,
  assigned_to uuid references public.profiles(id),
  assigned_at timestamptz,
  resolution  text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint parcel_issues_resolution_chk check (status <> 'resolved' or length(trim(coalesce(resolution, ''))) > 0)
);
create index parcel_issues_parcel_idx on public.parcel_issues (parcel_id);
create index parcel_issues_open_idx on public.parcel_issues (hub_id, status) where status <> 'resolved';
create index parcel_issues_assignee_idx on public.parcel_issues (assigned_to) where status = 'assigned';

create table public.parcel_issue_events (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.parcel_issues(id),
  event      text not null check (event in ('created','assigned','comment','resolved','reopened')),
  note       text,
  actor_id   uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index parcel_issue_events_issue_idx on public.parcel_issue_events (issue_id, created_at);
create trigger parcel_issue_events_append_only before update or delete on public.parcel_issue_events
  for each row execute function private.append_only();

create or replace function public.ops_open_issue(
  p_tracking_no text, p_type text, p_description text, p_priority text default 'normal'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p    public.parcels%rowtype;
  v_id uuid;
begin
  -- explicit operator: with an empty search_path a bare "=" would compare as case-sensitive text
  select * into p from public.parcels x where x.tracking_no operator(extensions.=) trim(p_tracking_no)::extensions.citext;
  if p.id is null or not private.has_permission('ops.issue.create', p.zone_id, p.hub_id) then
    raise exception 'Parcel not found or not authorised to report an issue for it.' using errcode = '42501';
  end if;
  insert into public.parcel_issues (parcel_id, hub_id, zone_id, issue_type, priority, description, reported_by)
  values (p.id, p.hub_id, p.zone_id, p_type, coalesce(p_priority, 'normal'), p_description, auth.uid())
  returning id into v_id;
  insert into public.parcel_issue_events (issue_id, event, note) values (v_id, 'created', p_description);
  return v_id;
end $$;

create or replace function public.ops_assign_issue(p_issue uuid, p_assignee uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue for update;
  if i.id is null or not private.has_permission('ops.issue.edit', i.zone_id, i.hub_id) then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if i.status = 'resolved' then raise exception 'A resolved issue must be reopened first.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_assignee and pr.status = 'active' and pr.archived_at is null) then
    raise exception 'The assignee must be an active user.' using errcode = '22023';
  end if;
  update public.parcel_issues set status = 'assigned', assigned_to = p_assignee, assigned_at = now() where id = p_issue;
  insert into public.parcel_issue_events (issue_id, event, note)
  values (p_issue, 'assigned', coalesce(nullif(trim(p_note), ''), 'Assigned') || ' → ' ||
          (select pr.full_name from public.profiles pr where pr.id = p_assignee));
end $$;

create or replace function public.ops_comment_issue(p_issue uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue;
  if i.id is null or not (i.reported_by = auth.uid() or i.assigned_to = auth.uid()
                          or private.has_permission('ops.issue.edit', i.zone_id, i.hub_id)) is true then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A comment is required.' using errcode = '22023'; end if;
  insert into public.parcel_issue_events (issue_id, event, note) values (p_issue, 'comment', p_note);
end $$;

create or replace function public.ops_resolve_issue(p_issue uuid, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue for update;
  if i.id is null or not (i.assigned_to = auth.uid()
                          or private.has_permission('ops.issue.edit', i.zone_id, i.hub_id)) is true then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if i.status = 'resolved' then raise exception 'This issue is already resolved.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_resolution), '') = '' then raise exception 'Describe how the issue was resolved.' using errcode = '22023'; end if;
  update public.parcel_issues set status = 'resolved', resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now()
   where id = p_issue;
  insert into public.parcel_issue_events (issue_id, event, note) values (p_issue, 'resolved', p_resolution);
end $$;

create or replace function public.ops_reopen_issue(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue for update;
  if i.id is null or not private.has_permission('ops.issue.edit', i.zone_id, i.hub_id) then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if i.status <> 'resolved' then raise exception 'Only a resolved issue can be reopened.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.parcel_issues
     set status = case when assigned_to is null then 'open' else 'assigned' end, resolved_by = null, resolved_at = null
   where id = p_issue;
  insert into public.parcel_issue_events (issue_id, event, note) values (p_issue, 'reopened', p_reason);
end $$;

-- Search by parcel ID: the parcel, its delivery attempts and its issues with
-- full history. Runs with the caller's rights, so scope rules apply.
create or replace function public.ops_parcel_lookup(p_tracking_no text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'parcel', to_jsonb(p) || jsonb_build_object('merchant_name', (select m.name from public.merchants m where m.id = p.merchant_id)),
    'deliveries', coalesce((select jsonb_agg(to_jsonb(d) order by d.recorded_at)
                            from public.delivery_records d where d.parcel_id = p.id), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('history',
                          coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'note', e.note, 'actor_id', e.actor_id,
                                                                       'at', e.created_at) order by e.created_at, e.event)
                                    from public.parcel_issue_events e where e.issue_id = i.id), '[]'::jsonb))
                        order by i.created_at)
                        from public.parcel_issues i where i.parcel_id = p.id), '[]'::jsonb))
  from public.parcels p
  where p.tracking_no operator(extensions.=) trim(p_tracking_no)::extensions.citext
$$;

-- ---------------------------------------------------------------------
-- Approved data -> hub_daily_metrics (feeds the zonal dashboards of 0006)
-- ---------------------------------------------------------------------
-- Rebuilds one hub-day from APPROVED courier records only. working_hours is
-- not known to this module and is left as entered (0 for generated rows).
create or replace function private.ops_refresh_hub_day(p_hub uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v     record;
  v_ppr numeric := coalesce(private.setting_text('zonal.parcels_per_rider_day')::numeric, 45);
begin
  if p_hub is null or p_date is null or p_date > current_date then return; end if;
  select
    (select coalesce(sum(c.parcel_count), 0) from public.pickup_consolidations c
      where c.hub_id = p_hub and c.pickup_date = p_date and c.voided_at is null)::integer as pk,
    (select count(*) from public.delivery_records d
      where d.hub_id = p_hub and d.delivery_date = p_date and d.status = 'approved' and d.outcome = 'delivered')::integer as dl,
    (select count(*) from public.parcels p
      where p.hub_id = p_hub and p.received_date <= p_date and p.status <> 'cancelled'
        and not exists (select 1 from public.delivery_records d
                        where d.parcel_id = p.id and d.status = 'approved' and d.outcome in ('delivered','returned')
                          and d.delivery_date <= p_date))::integer as pend,
    (select count(distinct q.m) from (
        select c.merchant_id as m from public.pickup_consolidations c
         where c.hub_id = p_hub and c.pickup_date = p_date and c.voided_at is null
        union all
        select d.merchant_id from public.delivery_records d
         where d.hub_id = p_hub and d.delivery_date = p_date and d.status = 'approved') q)::integer as mer,
    (select count(distinct q.r) from (
        select c.rider_id as r from public.pickup_consolidations c
         where c.hub_id = p_hub and c.pickup_date = p_date and c.voided_at is null
        union all
        select d.rider_id from public.delivery_records d
         where d.hub_id = p_hub and d.delivery_date = p_date and d.status = 'approved') q)::integer as riders,
    (select coalesce(sum(c.amount), 0) from public.cash_collections c
      where c.hub_id = p_hub and c.collection_date = p_date and c.voided_at is null) as cash,
    (select coalesce(sum(e.amount), 0) from public.operational_expenses e
      where e.hub_id = p_hub and e.expense_date = p_date and e.status = 'approved') as spent
  into v;

  insert into public.hub_daily_metrics as hm
    (hub_id, zone_id, metric_date, pickup_count, delivery_count, pending_parcels, merchant_count, rider_count,
     rider_capacity, cash_collected, expenses, note, status, verified_by, verified_at, source)
  values (p_hub, private.hub_zone(p_hub), p_date, v.pk, v.dl, v.pend, v.mer, v.riders,
          (v.riders * v_ppr)::integer, v.cash, v.spent, 'Generated from approved courier records',
          'verified', auth.uid(), now(), 'courier')
  on conflict (hub_id, metric_date) do update
    set pickup_count = excluded.pickup_count, delivery_count = excluded.delivery_count,
        pending_parcels = excluded.pending_parcels, merchant_count = excluded.merchant_count,
        rider_count = excluded.rider_count, rider_capacity = excluded.rider_capacity,
        working_hours = least(hm.working_hours, excluded.rider_count * 24),
        cash_collected = excluded.cash_collected, expenses = excluded.expenses,
        note = excluded.note, status = 'verified', verified_by = excluded.verified_by,
        verified_at = excluded.verified_at, source = 'courier';
end $$;

-- ---------------------------------------------------------------------
-- Reports (approved records only)
-- ---------------------------------------------------------------------
-- p_group = date | hub | zone | rider | merchant. Runs with the caller's rights.
create or replace function public.ops_daily_report(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (group_key text, group_label text, pickup_parcels bigint, pickup_cod numeric,
                 delivered bigint, failed bigint, returned bigint, success_pct numeric,
                 cod_expected numeric, cod_collected numeric, cash_collected numeric, expenses numeric)
language sql stable security invoker set search_path = '' as $$
  with f as (
    select c.pickup_date as d, c.hub_id, c.zone_id, c.rider_id, c.merchant_id,
           c.parcel_count::bigint as pk, c.cod_amount as pk_cod, 0::bigint as dl, 0::bigint as fl, 0::bigint as rt,
           0::numeric as cod_exp, 0::numeric as cod_col, 0::numeric as cash, 0::numeric as spent
    from public.pickup_consolidations c
    where c.voided_at is null and c.pickup_date between p_from and p_to
    union all
    select r.delivery_date, r.hub_id, r.zone_id, r.rider_id, r.merchant_id, 0, 0,
           (r.outcome = 'delivered')::integer, (r.outcome = 'failed')::integer, (r.outcome = 'returned')::integer,
           r.cod_expected, r.cod_collected, 0, 0
    from public.delivery_records r
    where r.status = 'approved' and r.delivery_date between p_from and p_to
    union all
    select cc.collection_date, cc.hub_id, cc.zone_id, cc.rider_id, cc.merchant_id, 0, 0, 0, 0, 0, 0, 0, cc.amount, 0
    from public.cash_collections cc
    where cc.voided_at is null and cc.collection_date between p_from and p_to
    union all
    select e.expense_date, e.hub_id, e.zone_id, e.rider_id, null::uuid, 0, 0, 0, 0, 0, 0, 0, 0, e.amount
    from public.operational_expenses e
    where e.status = 'approved' and e.expense_date between p_from and p_to
  )
  select k.gkey, k.glabel, sum(f.pk)::bigint, sum(f.pk_cod), sum(f.dl)::bigint, sum(f.fl)::bigint, sum(f.rt)::bigint,
         round(100.0 * sum(f.dl) / nullif(sum(f.dl + f.fl + f.rt), 0), 1),
         sum(f.cod_exp), sum(f.cod_col), sum(f.cash), sum(f.spent)
  from f
  left join public.hubs h on h.id = f.hub_id
  left join public.zones z on z.id = f.zone_id
  left join public.merchants m on m.id = f.merchant_id
  cross join lateral (
    select case p_group when 'date' then to_char(f.d::timestamp, 'YYYY-MM-DD')
                        when 'hub' then h.code::text
                        when 'zone' then z.code::text
                        when 'rider' then f.rider_id::text
                        when 'merchant' then m.code::text end as gkey,
           case p_group when 'date' then to_char(f.d::timestamp, 'DD/MM/YYYY')
                        when 'hub' then h.name
                        when 'zone' then z.name
                        when 'rider' then private.employee_label(f.rider_id)
                        when 'merchant' then m.name end as glabel
  ) k
  where p_group in ('date','hub','zone','rider','merchant')
    and (p_zone is null or f.zone_id = p_zone)
    and (p_hub is null or f.hub_id = p_hub)
    and (p_group <> 'rider' or f.rider_id is not null)
    and (p_group <> 'merchant' or f.merchant_id is not null)
  group by k.gkey, k.glabel
  order by k.gkey
$$;

-- Rider ledger: cash collected, expenses paid from it, handovers received by
-- the hub, with a running balance of what the rider still holds.
create or replace function public.ops_rider_ledger(p_rider uuid, p_from date, p_to date)
returns table (entry_date date, kind text, reference text, cash_in numeric, cash_out numeric, balance numeric)
language sql stable security definer set search_path = '' as $$
  with x as (
    select c.collection_date as d, c.created_at as ts, 1 as ord, c.source as kind, coalesce(c.note, '') as ref,
           c.amount as cin, 0::numeric as cout, c.zone_id, c.hub_id
    from public.cash_collections c
    where c.rider_id = p_rider and c.holder = 'rider' and c.voided_at is null
    union all
    select h.handover_date, h.received_at, 3, 'handover',
           h.handover_no || case when h.shortage_amount > 0 then ' (short ' || h.shortage_amount || ')'
                                 when h.shortage_amount < 0 then ' (excess ' || (-h.shortage_amount) || ')' else '' end,
           0, h.received_amount, h.zone_id, h.hub_id
    from public.cash_handovers h
    where h.rider_id = p_rider and h.level = 'rider_to_hub' and h.status = 'confirmed'
    union all
    select e.expense_date, e.decided_at, 2, 'expense', e.category || ': ' || e.description, 0, e.amount, e.zone_id, e.hub_id
    from public.operational_expenses e
    where e.rider_id = p_rider and e.paid_from = 'rider_cash' and e.status = 'approved'
  ), v as (
    select x.*, sum(x.cin - x.cout) over (order by x.d, x.ts, x.ord, x.ref
                                          rows between unbounded preceding and current row) as bal
    from x
    where p_rider = private.my_employee_id() or private.has_permission('ops.cash.view', x.zone_id, x.hub_id)
  )
  select v.d, v.kind, v.ref, v.cin, v.cout, v.bal from v
  where v.d between p_from and p_to
  order by v.d, v.ts, v.ord, v.ref
$$;

-- COD reconciliation per rider: expected vs collected vs handed over.
create or replace function public.ops_cod_reconciliation(
  p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (rider_id uuid, rider_label text, delivered bigint, cod_expected numeric, cod_collected numeric,
                 cod_difference numeric, handed_over numeric, shortage_recorded numeric, balance_outstanding numeric)
language sql stable security invoker set search_path = '' as $$
  select d.rider_id, private.employee_label(d.rider_id),
         count(*) filter (where d.outcome = 'delivered'),
         sum(d.cod_expected), sum(d.cod_collected), sum(d.cod_expected - d.cod_collected),
         coalesce((select sum(h.received_amount) from public.cash_handovers h
                   where h.rider_id = d.rider_id and h.level = 'rider_to_hub' and h.status = 'confirmed'
                     and h.handover_date between p_from and p_to), 0),
         coalesce((select sum(h.shortage_amount) from public.cash_handovers h
                   where h.rider_id = d.rider_id and h.level = 'rider_to_hub' and h.status = 'confirmed'
                     and h.handover_date between p_from and p_to), 0),
         private.rider_cash_balance(d.rider_id)
  from public.delivery_records d
  where d.status = 'approved' and d.delivery_date between p_from and p_to
    and (p_zone is null or d.zone_id = p_zone)
    and (p_hub is null or d.hub_id = p_hub)
  group by d.rider_id
  order by 2
$$;

-- One hub, one day: approved figures plus everything still waiting for someone.
create or replace function public.ops_hub_summary(p_hub uuid, p_date date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.has_permission('ops.report.view', null, p_hub) then
    raise exception 'Not authorised to view reports for this hub.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hub_id', p_hub, 'date', p_date,
    'approved', (select to_jsonb(r) - 'group_key' - 'group_label'
                 from public.ops_daily_report('hub', p_date, p_date, null, p_hub) r),
    'pickups', (select jsonb_build_object(
                  'groups', count(*),
                  'waiting', count(*) filter (where g.group_status <> 'approved'),
                  'duplicates', count(*) filter (where g.check_state = 'duplicate'),
                  'conflicts', count(*) filter (where g.check_state = 'conflict' and g.group_status <> 'approved'))
                from public.ops_pickup_groups(p_date, p_date, null, p_hub) g),
    'parcels', (select jsonb_build_object(
                  'at_hub', count(*) filter (where p.status = 'at_hub'),
                  'out_for_delivery', count(*) filter (where p.status = 'out_for_delivery'))
                from public.parcels p where p.hub_id = p_hub),
    'deliveries_waiting', (select count(*) from public.delivery_records d where d.hub_id = p_hub and d.status = 'pending'),
    'handovers_waiting', (select count(*) from public.cash_handovers h where h.hub_id = p_hub and h.status = 'submitted'),
    'expenses_waiting', (select count(*) from public.operational_expenses e where e.hub_id = p_hub and e.status = 'pending'),
    'open_issues', (select count(*) from public.parcel_issues i where i.hub_id = p_hub and i.status <> 'resolved'),
    'cash', (select to_jsonb(c) from public.ops_cash_position(p_hub, p_date) c));
end $$;

-- ---------------------------------------------------------------------
-- Stamp / audit / no-delete
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['merchants','parcels','ops_assignments','pickup_submissions','pickup_consolidations',
                           'delivery_records','cash_collections','cash_handovers','merchant_payments',
                           'operational_expenses','cash_reconciliations','parcel_issues'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''ops'')', t || '_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger parcel_issue_events_audit after insert on public.parcel_issue_events
  for each row execute function private.audit_row('ops');

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['merchants','parcels','ops_assignments','pickup_submissions','pickup_consolidations',
                           'delivery_records','cash_collections','cash_handovers','merchant_payments',
                           'operational_expenses','cash_reconciliations','parcel_issues','parcel_issue_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke delete, truncate on public.%I from authenticated', t);
    -- Only merchants and parcels are written directly; everything else goes through the workflow functions.
    if t not in ('merchants','parcels') then
      execute format('revoke insert, update on public.%I from authenticated', t);
    end if;
  end loop;
end $$;
revoke all on sequence public.pickup_submission_no_seq, public.cash_handover_no_seq,
  public.merchant_payment_no_seq, public.parcel_issue_no_seq from anon, authenticated;

create policy merchants_read on public.merchants for select to authenticated
  using (private.has_permission('ops.merchant.view', zone_id, hub_id));
create policy merchants_insert on public.merchants for insert to authenticated
  with check (private.has_permission('ops.merchant.create', zone_id, hub_id));
create policy merchants_update on public.merchants for update to authenticated
  using (private.has_permission('ops.merchant.edit', zone_id, hub_id))
  with check (private.has_permission('ops.merchant.edit', zone_id, hub_id)
              and (archived_at is null or private.has_permission('ops.merchant.archive', zone_id, hub_id)));

-- parcels: by scope, or the rider currently carrying the parcel
create policy parcels_read on public.parcels for select to authenticated
  using (private.has_permission('ops.parcel.view', zone_id, hub_id) or assigned_rider_id = private.my_employee_id());
create policy parcels_insert on public.parcels for insert to authenticated
  with check (private.has_permission('ops.parcel.create', zone_id, hub_id));
create policy parcels_update on public.parcels for update to authenticated
  using (private.has_permission('ops.parcel.edit', zone_id, hub_id))
  with check (private.has_permission('ops.parcel.edit', zone_id, hub_id));

create policy ops_assignments_read on public.ops_assignments for select to authenticated
  using (private.has_permission('ops.assignment.view', zone_id, hub_id) or employee_id = private.my_employee_id());

-- pickups: by scope, or a person's own submissions
create policy pickup_submissions_read on public.pickup_submissions for select to authenticated
  using (private.has_permission('ops.pickup.view', zone_id, hub_id) or submitted_by = auth.uid());
create policy pickup_consolidations_read on public.pickup_consolidations for select to authenticated
  using (private.has_permission('ops.pickup.view', zone_id, hub_id));

create policy delivery_records_read on public.delivery_records for select to authenticated
  using (private.has_permission('ops.delivery.view', zone_id, hub_id)
         or rider_id = private.my_employee_id() or recorded_by = auth.uid());

create policy cash_collections_read on public.cash_collections for select to authenticated
  using (private.has_permission('ops.cash.view', zone_id, hub_id) or rider_id = private.my_employee_id());
create policy cash_handovers_read on public.cash_handovers for select to authenticated
  using (private.has_permission('ops.handover.view', zone_id, hub_id)
         or handed_by = auth.uid() or rider_id = private.my_employee_id());
create policy merchant_payments_read on public.merchant_payments for select to authenticated
  using (private.has_permission('ops.merchant_payment.view', zone_id, hub_id));
create policy operational_expenses_read on public.operational_expenses for select to authenticated
  using (private.has_permission('ops.expense.view', zone_id, hub_id)
         or recorded_by = auth.uid() or rider_id = private.my_employee_id());
create policy cash_reconciliations_read on public.cash_reconciliations for select to authenticated
  using (private.has_permission('ops.reconciliation.view', zone_id, hub_id));

create policy parcel_issues_read on public.parcel_issues for select to authenticated
  using (private.has_permission('ops.issue.view', zone_id, hub_id)
         or reported_by = auth.uid() or assigned_to = auth.uid());
create policy parcel_issue_events_read on public.parcel_issue_events for select to authenticated
  using (exists (select 1 from public.parcel_issues i where i.id = issue_id));

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ops\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Default permissions per role (editable later by Super Admin)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'ops' and (
     r.code = 'admin'
  or (r.code in ('head_office_manager','auditor') and p.action in ('view','export','print'))
  or (r.code = 'operations_manager' and (p.action in ('view','export','print') or p.code in (
        'ops.merchant.create','ops.merchant.edit','ops.merchant.archive','ops.parcel.create','ops.parcel.edit',
        'ops.assignment.create','ops.assignment.edit','ops.pickup.approve','ops.pickup.reject',
        'ops.pickup_verification.create','ops.delivery.approve','ops.delivery.reject',
        'ops.expense.approve','ops.expense.reject','ops.reconciliation.approve','ops.issue.create','ops.issue.edit')))
  or (r.code = 'zonal_manager' and (p.action in ('view','export','print') or p.code in (
        'ops.merchant.create','ops.merchant.edit','ops.assignment.create','ops.assignment.edit',
        'ops.pickup.approve','ops.pickup.reject','ops.pickup_verification.create',
        'ops.delivery.approve','ops.delivery.reject','ops.expense.approve','ops.expense.reject',
        'ops.reconciliation.approve','ops.issue.create','ops.issue.edit')))
  or (r.code = 'hub_manager' and (p.action = 'view' or p.code in (
        'ops.merchant.create','ops.merchant.edit','ops.parcel.create','ops.parcel.edit','ops.assignment.create',
        'ops.assignment.edit','ops.pickup_as_hub_manager.create','ops.pickup_verification.create',
        'ops.delivery.create','ops.delivery.approve','ops.delivery.reject','ops.cash.create',
        'ops.rider_handover.create','ops.rider_handover.approve','ops.hub_handover.create',
        'ops.merchant_payment.create','ops.expense.create','ops.reconciliation.create',
        'ops.issue.create','ops.issue.edit')))
  or (r.code = 'pickup_manager' and p.code in (
        'ops.merchant.view','ops.parcel.view','ops.parcel.create','ops.pickup.view',
        'ops.pickup_as_pickup_manager.create','ops.issue.view','ops.issue.create','ops.report.view'))
  or (r.code = 'delivery_manager' and p.code in (
        'ops.merchant.view','ops.parcel.view','ops.parcel.edit','ops.assignment.view','ops.delivery.view',
        'ops.delivery.create','ops.delivery.approve','ops.delivery.reject',
        'ops.issue.view','ops.issue.create','ops.issue.edit','ops.report.view'))
  or (r.code = 'rider' and p.code in (
        'ops.merchant.view','ops.pickup_as_rider.create','ops.delivery.create','ops.rider_handover.create',
        'ops.expense.create','ops.issue.create'))
  or (r.code = 'accounts_manager' and (p.action in ('view','export','print') or p.code in (
        'ops.hub_handover.approve','ops.merchant_payment.approve','ops.merchant_payment.reject',
        'ops.expense.approve','ops.expense.reject','ops.reconciliation.approve')))
  or (r.code = 'accountant' and (p.action = 'view' or p.code in ('ops.hub_handover.approve','ops.merchant_payment.create')))
)
on conflict do nothing;

-- ===== 20261113000800_daily_accounts.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0008: Accounts Management → Daily Accounts (আজকের হিসাব খাতা)
--   * da_sessions            one daily account sheet per hub per date ("start today's account")
--   * da_rider_lines         rider-wise delivery / pickup / amount / due / mobile banking
--   * da_merchant_payments   merchant cash payments (screenshot + OCR, matched to merchant_payments)
--   * da_expenses            transport and hub employee expenses (bill + OCR)
--   * da_events              append-only history: start, submit, verify, correction (with snapshots)
--   * da_page_visits         who opened the sheet, when they left, how long they stayed
--   * da_hub_accountants     Accounts Manager assignment per hub
--   * da_expense_templates   expense name / category / reference / memo templates
-- Rules (enforced here, not in the UI):
--   * Uses the existing hubs, zones, employees and merchants. Nothing is copied or created there.
--   * One sheet per hub per date; a sheet is submitted once (status check + row lock).
--   * Lines change only while the sheet is open or sent back for correction. After submit a
--     change needs da.correction.edit; an approved sheet is final.
--   * The person who started or submitted a sheet cannot verify it.
--   * Rows read by OCR must be confirmed by a person before the sheet can be submitted.
--   * Mobile banking is kept separate from the due unless the configured rule says otherwise.
--   * Tables are written only through the audited functions below; nothing is deleted.
-- ACCOUNTS HOOK: nothing is posted to a ledger yet; approved sheets carry ledger_entry_id.
-- Record numbers shown to users (no) start at 1.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions and settings
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'da.' || r || '.' || a, 'da', r, a, d from (values
  ('sheet','view','View daily account sheets of a hub'),
  ('sheet','create','Start, fill in and submit daily account sheets'),
  ('sheet','approve','Verify daily account sheets (approve, send back for correction, add note)'),
  ('correction','edit','Reopen a submitted daily account sheet for correction'),
  ('report','view','View daily account reports and dashboards'),
  ('report','export','Export daily account reports (Excel / PDF)'),
  ('report','print','Print daily account reports'),
  ('settings','configure','Change daily account settings, templates and Accounts Manager assignment')
) v(r, a, d);

insert into public.system_settings (key, value, description) values
  ('da.timezone',            '"Asia/Dhaka"', 'Daily accounts: time zone used for "today"'),
  ('da.start_time',          '"00:00"',      'Daily accounts: earliest local time a sheet for today can be started (HH:MM)'),
  ('da.backdate_days',       '3',            'Daily accounts: how many days back a sheet may be started'),
  ('da.session_tracking',    'true',         'Daily accounts: record page entry / exit and time spent'),
  ('da.rider_fields',        '["delivery_qty","pickup_qty","amount","paid_amount","due","mobile_banking","remarks"]',
                                             'Daily accounts: rider columns shown in the sheet'),
  ('da.due_rule',            '"manual"',     'Daily accounts: manual = due typed in; amount_minus_paid = amount − cash paid'),
  ('da.mobile_banking_rule', '"separate"',   'Daily accounts: separate | reduces_due | adds_to_due'),
  ('da.expense_categories',  '[{"code":"transport","en":"Transport","bn":"যাতায়াত"},{"code":"fuel","en":"Fuel","bn":"জ্বালানি"},{"code":"conveyance","en":"Conveyance","bn":"কনভেয়েন্স"},{"code":"meal","en":"Meal","bn":"খাবার"},{"code":"office","en":"Office","bn":"অফিস"},{"code":"repair","en":"Repair","bn":"মেরামত"},{"code":"utilities","en":"Utilities","bn":"বিল"},{"code":"other","en":"Other","bn":"অন্যান্য"}]',
                                             'Daily accounts: expense categories'),
  ('da.reference_setup',     '{"expense_prefix":"EXP","merchant_prefix":"MCP","reference_required":false}',
                                             'Daily accounts: reference number prefixes and whether a reference is required'),
  ('da.bill_upload',         '{"max_mb":10,"types":["image/jpeg","image/png","application/pdf"],"required_over":1000}',
                                             'Daily accounts: bill / screenshot upload rules; a bill is required at or above required_over'),
  ('da.ocr',                 '{"engine":"tesseract","languages":"eng+ben","min_confidence":60,"require_verification":true}',
                                             'Daily accounts: OCR settings'),
  ('da.require_assignment',  'false',        'Daily accounts: if true, only the Accounts Managers assigned to a hub verify its sheets');

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function private.da_setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.system_settings where key = p_key
$$;

create or replace function private.da_today() returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(private.setting_text('da.timezone'), 'Asia/Dhaka'))::date
$$;

create or replace function private.da_my_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.full_name from public.employees e where e.profile_id = auth.uid() and e.archived_at is null),
                  (select nullif(p.full_name, '') from public.profiles p where p.id = auth.uid()),
                  (select p.email::text from public.profiles p where p.id = auth.uid()))
$$;

create or replace function private.da_my_code() returns text
language sql stable security definer set search_path = '' as $$
  select e.employee_code::text from public.employees e where e.profile_id = auth.uid() and e.archived_at is null
$$;

-- due = (manual due | amount − paid) ± mobile banking, by the configured rules
create or replace function private.da_due(p_amount numeric, p_paid numeric, p_due numeric, p_mb numeric) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rule text := coalesce(private.setting_text('da.due_rule'), 'manual');
  v_mb   text := coalesce(private.setting_text('da.mobile_banking_rule'), 'separate');
  v numeric;
begin
  v := case when v_rule = 'amount_minus_paid' then coalesce(p_amount, 0) - coalesce(p_paid, 0) else coalesce(p_due, 0) end;
  if v_mb = 'reduces_due' then v := v - coalesce(p_mb, 0);
  elsif v_mb = 'adds_to_due' then v := v + coalesce(p_mb, 0);
  end if;
  return round(v, 2);
end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.da_sessions (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  account_date       date not null,
  status             text not null default 'open' check (status in ('open','submitted','correction','approved')),
  started_by         uuid not null,
  started_by_employee uuid references public.employees(id),
  started_by_name    text,
  started_by_code    text,
  started_at         timestamptz not null default now(),
  last_saved_at      timestamptz not null default now(),
  submitted_by       uuid,
  submitted_by_name  text,
  submitted_by_code  text,
  submitted_at       timestamptz,
  submit_note        text,
  submit_count       integer not null default 0,
  verified_by        uuid,
  verified_by_name   text,
  verified_at        timestamptz,
  verify_note        text,
  ledger_entry_id    uuid,   -- ACCOUNTS HOOK
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint da_sessions_one_per_hub_day unique (hub_id, account_date)
);
create index da_sessions_date_idx on public.da_sessions (account_date desc, status);
create index da_sessions_zone_idx on public.da_sessions (zone_id, account_date desc);

create table public.da_rider_lines (
  id              uuid primary key default gen_random_uuid(),
  no              bigint generated always as identity unique,
  session_id      uuid not null references public.da_sessions(id),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  employee_id     uuid not null references public.employees(id),
  employee_code   text,
  rider_name      text not null,
  mobile          text,
  delivery_qty    integer not null default 0 check (delivery_qty between 0 and 100000),
  pickup_qty      integer not null default 0 check (pickup_qty between 0 and 100000),
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  paid_amount     numeric(14,2) not null default 0 check (paid_amount >= 0),
  due_input       numeric(14,2) not null default 0,
  due             numeric(14,2) not null default 0,
  mobile_banking  numeric(14,2) not null default 0 check (mobile_banking >= 0),
  remarks         text,
  removed_at      timestamptz,
  removed_by      uuid,
  remove_reason   text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint da_rider_lines_remove_chk check (removed_at is null or length(trim(coalesce(remove_reason, ''))) > 0)
);
create unique index da_rider_lines_one_per_rider on public.da_rider_lines (session_id, employee_id) where removed_at is null;
create index da_rider_lines_employee_idx on public.da_rider_lines (employee_id);

create table public.da_merchant_payments (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  session_id         uuid not null references public.da_sessions(id),
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  merchant_id        uuid not null references public.merchants(id),
  merchant_name      text not null,
  payment_ref        text,                -- Payment ID (e.g. MP-000123)
  transaction_id     text,
  amount             numeric(14,2) not null check (amount > 0),
  payment_date       date not null,
  screenshot_path    text,
  ocr                jsonb,               -- values read from the screenshot + confidence (null = typed in)
  ocr_verified       boolean not null default false,
  verified_by        uuid,
  match_status       text not null default 'unmatched' check (match_status in ('matched','mismatch','unmatched')),
  matched_payment_id uuid references public.merchant_payments(id),
  remarks            text,
  removed_at         timestamptz,
  removed_by         uuid,
  remove_reason      text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint da_mp_remove_chk check (removed_at is null or length(trim(coalesce(remove_reason, ''))) > 0),
  constraint da_mp_path_chk check (screenshot_path is null or screenshot_path like 'da/' || session_id::text || '/%')
);
create unique index da_mp_txn_unique on public.da_merchant_payments (lower(transaction_id))
  where removed_at is null and transaction_id is not null;
create index da_mp_session_idx on public.da_merchant_payments (session_id);

create table public.da_expense_templates (
  id               uuid primary key default gen_random_uuid(),
  no               bigint generated always as identity unique,
  name             text not null check (length(trim(name)) > 1),
  name_bn          text,
  category         text not null,
  reference_prefix text,
  keywords         text[] not null default '{}',
  memo_template    text,
  default_amount   numeric(14,2) check (default_amount is null or default_amount > 0),
  status           text not null default 'active' check (status in ('active','inactive')),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

create table public.da_expenses (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  session_id         uuid not null references public.da_sessions(id),
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  kind               text not null check (kind in ('transport','employee')),
  employee_id        uuid references public.employees(id),
  employee_code      text,
  employee_name      text,
  expense_name       text not null check (length(trim(expense_name)) > 1),
  category           text not null,
  amount             numeric(14,2) not null check (amount > 0),
  bill_date          date not null,
  bill_no            text,
  reference_no       text,
  attachment_path    text,
  paid_by_employee   uuid references public.employees(id),
  paid_by_name       text,
  template_id        uuid references public.da_expense_templates(id),
  ocr                jsonb,
  ocr_verified       boolean not null default false,
  verified_by        uuid,
  remarks            text,
  removed_at         timestamptz,
  removed_by         uuid,
  remove_reason      text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint da_exp_remove_chk check (removed_at is null or length(trim(coalesce(remove_reason, ''))) > 0),
  constraint da_exp_path_chk check (attachment_path is null or attachment_path like 'da/' || session_id::text || '/%'),
  constraint da_exp_employee_chk check (kind <> 'employee' or employee_id is not null)
);
create unique index da_exp_reference_unique on public.da_expenses (hub_id, lower(reference_no))
  where removed_at is null and reference_no is not null;
create index da_exp_session_idx on public.da_expenses (session_id);
create index da_exp_employee_idx on public.da_expenses (employee_id);

create table public.da_events (
  id          uuid primary key default gen_random_uuid(),
  no          bigint generated always as identity unique,
  session_id  uuid not null references public.da_sessions(id),
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  actor_code  text,
  action      text not null check (action in ('started','submitted','resubmitted','approved','correction_required',
                                               'note','reopened')),
  note        text,
  snapshot    jsonb
);
create index da_events_session_idx on public.da_events (session_id, at);

create table public.da_page_visits (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.da_sessions(id),
  user_id          uuid not null,
  user_name        text,
  entered_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  left_at          timestamptz,
  duration_seconds integer generated always as
                   (greatest(0, extract(epoch from (coalesce(left_at, last_seen_at) - entered_at)))::integer) stored
);
create index da_page_visits_session_idx on public.da_page_visits (session_id, entered_at);

create table public.da_hub_accountants (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  user_id       uuid not null references public.profiles(id),
  reason        text not null check (length(trim(reason)) > 0),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create unique index da_hub_accountants_active on public.da_hub_accountants (hub_id, user_id) where revoked_at is null;

-- history rows are append-only
create or replace function private.da_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'Daily account history cannot be changed or deleted.' using errcode = 'P0001';
end $$;
create trigger da_events_append_only before update or delete on public.da_events
  for each row execute function private.da_append_only();

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------
create or replace function private.da_session_row(p_session uuid) returns public.da_sessions
language sql stable security definer set search_path = '' as $$
  select * from public.da_sessions where id = p_session
$$;

-- Can the caller change lines of this sheet right now?
create or replace function private.da_can_edit(s public.da_sessions) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.status in ('open','correction') and private.has_permission('da.sheet.create', s.zone_id, s.hub_id)
$$;

create or replace function private.da_require_edit(p_session uuid) returns public.da_sessions
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.create', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to change daily accounts of this hub.' using errcode = '42501';
  end if;
  if s.status = 'submitted' then
    raise exception 'This sheet has been submitted. Reopen it for correction first (needs correction permission).' using errcode = '42501';
  end if;
  if s.status = 'approved' then
    raise exception 'This sheet is approved and final. It cannot be changed.' using errcode = '42501';
  end if;
  update public.da_sessions set last_saved_at = now() where id = s.id;
  return s;
end $$;

-- Full sheet as JSON (used for history snapshots and the sheet screen). Runs as definer:
-- callers check access first.
create or replace function private.da_snapshot(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session', to_jsonb(s) - 'ledger_entry_id',
    'hub', jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name, 'name_bn', h.name_bn),
    'zone', jsonb_build_object('id', z.id, 'code', z.code, 'name', z.name, 'name_bn', z.name_bn),
    'riders', coalesce((select jsonb_agg(to_jsonb(l) order by l.no) from public.da_rider_lines l
                        where l.session_id = s.id and l.removed_at is null), '[]'),
    'merchant_payments', coalesce((select jsonb_agg(to_jsonb(m) order by m.no) from public.da_merchant_payments m
                        where m.session_id = s.id and m.removed_at is null), '[]'),
    'expenses', coalesce((select jsonb_agg(to_jsonb(x) order by x.no) from public.da_expenses x
                        where x.session_id = s.id and x.removed_at is null), '[]'),
    'totals', jsonb_build_object(
       'riders',         (select count(*) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'delivery',       (select coalesce(sum(delivery_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'pickup',         (select coalesce(sum(pickup_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'amount',         (select coalesce(sum(amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'paid',           (select coalesce(sum(paid_amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'due',            (select coalesce(sum(due), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'mobile_banking', (select coalesce(sum(mobile_banking), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'merchant_cash',  (select coalesce(sum(amount), 0) from public.da_merchant_payments m where m.session_id = s.id and m.removed_at is null),
       'transport_expense', (select coalesce(sum(amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'transport'),
       'employee_expense',  (select coalesce(sum(amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'employee')))
  from public.da_sessions s
  join public.hubs h on h.id = s.hub_id
  join public.zones z on z.id = s.zone_id
  where s.id = p_session
$$;

create or replace function private.da_event(p_session uuid, p_action text, p_note text, p_snapshot boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.da_events (session_id, actor_id, actor_name, actor_code, action, note, snapshot)
  values (p_session, auth.uid(), private.da_my_name(), private.da_my_code(), p_action, nullif(trim(p_note), ''),
          case when p_snapshot then private.da_snapshot(p_session) end);
end $$;

-- Employee allowed on a hub's sheet: active, and belongs to the hub or is a rider assigned to it.
create or replace function private.da_employee_ok(p_employee uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 where e.id = p_employee and e.status = 'active' and e.archived_at is null
                   and (e.hub_id = p_hub or private.is_current_rider(e.id, p_hub)))
$$;

create or replace function private.da_find_employee(p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employees where employee_code = trim(p_code)::extensions.citext and archived_at is null
$$;

-- ---------------------------------------------------------------------
-- 1. Start today's account (আজকের হিসাব শুরু করুন)
-- ---------------------------------------------------------------------
create or replace function public.da_start_session(p_hub uuid, p_date date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_today date := private.da_today();
  v_date  date := coalesce(p_date, private.da_today());
  v_start text := coalesce(private.setting_text('da.start_time'), '00:00');
  v_id    uuid;
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised to start daily accounts for this hub.' using errcode = '42501';
  end if;
  if exists (select 1 from public.hubs where id = p_hub and (status <> 'active' or archived_at is not null)) then
    raise exception 'This hub is not active.' using errcode = '22023';
  end if;
  if v_date > v_today or v_date < v_today - coalesce(private.setting_text('da.backdate_days')::integer, 3) then
    raise exception 'The date is outside the allowed period.' using errcode = '22023';
  end if;
  if v_date = v_today and (now() at time zone coalesce(private.setting_text('da.timezone'), 'Asia/Dhaka'))::time < v_start::time then
    raise exception 'Today''s account can be started from % only.', v_start using errcode = '22023';
  end if;
  if exists (select 1 from public.da_sessions where hub_id = p_hub and account_date = v_date) then
    raise exception 'A daily account sheet for this hub and date already exists.' using errcode = '23505';
  end if;
  insert into public.da_sessions (hub_id, zone_id, account_date, started_by, started_by_employee, started_by_name, started_by_code)
  values (p_hub, v_zone, v_date, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code())
  returning id into v_id;
  perform private.da_event(v_id, 'started', null, false);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Page tracking (entry, still here, exit)
-- ---------------------------------------------------------------------
create or replace function public.da_page_enter(p_session uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_session_row(p_session); v uuid;
begin
  if s.id is null or not (private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
                          or private.has_permission('da.sheet.create', s.zone_id, s.hub_id)
                          or auth.uid() in (s.started_by, s.submitted_by)
                          or exists (select 1 from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null
                                     and l.employee_id = private.my_employee_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(private.setting_text('da.session_tracking'), 'true') <> 'true' then return null; end if;
  insert into public.da_page_visits (session_id, user_id, user_name) values (p_session, auth.uid(), private.da_my_name())
  returning id into v;
  return v;
end $$;

create or replace function public.da_page_ping(p_visit uuid, p_leaving boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.da_page_visits
     set last_seen_at = now(), left_at = case when p_leaving then now() else left_at end
   where id = p_visit and user_id = auth.uid() and left_at is null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Look-ups for auto fill
-- ---------------------------------------------------------------------
create or replace function public.da_lookup_employee(p_hub uuid, p_code text)
returns table (employee_id uuid, employee_code text, full_name text, mobile text, hub_id uuid, hub_name text,
               allowed boolean, is_rider boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not (private.has_permission('da.sheet.create', v_zone, p_hub)
                            or private.has_permission('da.sheet.view', v_zone, p_hub)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select e.id, e.employee_code::text, e.full_name, e.mobile, e.hub_id, h.name,
           private.da_employee_ok(e.id, p_hub), private.is_current_rider(e.id, p_hub)
    from public.employees e left join public.hubs h on h.id = e.hub_id
    where e.employee_code = trim(p_code)::extensions.citext and e.archived_at is null and e.status = 'active';
end $$;

-- Hub-wise employee list for the sheet (riders first)
create or replace function public.da_hub_employees(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, mobile text, is_rider boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not (private.has_permission('da.sheet.create', v_zone, p_hub)
                            or private.has_permission('da.sheet.view', v_zone, p_hub)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select e.id, e.employee_code::text, e.full_name, e.mobile, private.is_current_rider(e.id, p_hub)
    from public.employees e
    where e.archived_at is null and e.status = 'active'
      and (e.hub_id = p_hub or private.is_current_rider(e.id, p_hub))
    order by private.is_current_rider(e.id, p_hub) desc, e.full_name;
end $$;

create or replace function public.da_lookup_merchant(p_hub uuid, p_query text)
returns table (merchant_id uuid, code text, name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select m.id, m.code::text, m.name from public.merchants m
    where m.hub_id = p_hub and m.archived_at is null and m.status = 'active'
      and (m.code = trim(p_query)::extensions.citext or m.name ilike '%' || trim(p_query) || '%')
    order by (m.code = trim(p_query)::extensions.citext) desc, m.name limit 10;
end $$;

-- Matches a Payment ID against the existing merchant payment requests of the hub
create or replace function public.da_match_payment(p_hub uuid, p_payment_ref text)
returns table (payment_id uuid, payment_no text, merchant_id uuid, merchant_name text, amount numeric, status text, payment_date date)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select mp.id, mp.payment_no, mp.merchant_id, m.name, mp.amount, mp.status, mp.payment_date
    from public.merchant_payments mp join public.merchants m on m.id = mp.merchant_id
    where mp.hub_id = p_hub and upper(mp.payment_no) = upper(trim(p_payment_ref));
end $$;

-- ---------------------------------------------------------------------
-- 4. Rider-wise lines
-- ---------------------------------------------------------------------
create or replace function public.da_save_rider_line(
  p_session uuid, p_employee_code text,
  p_delivery integer default 0, p_pickup integer default 0, p_amount numeric default 0,
  p_paid numeric default 0, p_due numeric default 0, p_mobile_banking numeric default 0,
  p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s   public.da_sessions := private.da_require_edit(p_session);
  v_e uuid := private.da_find_employee(p_employee_code);
  e   public.employees;
  v_id uuid;
begin
  if v_e is null then raise exception 'Employee ID % was not found.', p_employee_code using errcode = '22023'; end if;
  select * into e from public.employees where id = v_e;
  if not private.da_employee_ok(v_e, s.hub_id) then
    raise exception 'Employee % is not an active member or rider of this hub.', p_employee_code using errcode = '22023';
  end if;
  if coalesce(p_delivery, 0) < 0 or coalesce(p_pickup, 0) < 0 or coalesce(p_amount, 0) < 0
     or coalesce(p_paid, 0) < 0 or coalesce(p_mobile_banking, 0) < 0 then
    raise exception 'Quantities and amounts cannot be negative.' using errcode = '22023';
  end if;
  if p_line is null then
    if exists (select 1 from public.da_rider_lines where session_id = s.id and employee_id = v_e and removed_at is null) then
      raise exception 'This rider is already on the sheet. Edit the existing line.' using errcode = '23505';
    end if;
    insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, employee_code, rider_name, mobile,
      delivery_qty, pickup_qty, amount, paid_amount, due_input, due, mobile_banking, remarks)
    values (s.id, s.hub_id, s.zone_id, v_e, e.employee_code::text, e.full_name, e.mobile,
      coalesce(p_delivery, 0), coalesce(p_pickup, 0), coalesce(p_amount, 0), coalesce(p_paid, 0), coalesce(p_due, 0),
      private.da_due(p_amount, p_paid, p_due, p_mobile_banking), coalesce(p_mobile_banking, 0), nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_rider_lines set
      employee_id = v_e, employee_code = e.employee_code::text, rider_name = e.full_name, mobile = e.mobile,
      delivery_qty = coalesce(p_delivery, 0), pickup_qty = coalesce(p_pickup, 0), amount = coalesce(p_amount, 0),
      paid_amount = coalesce(p_paid, 0), due_input = coalesce(p_due, 0),
      due = private.da_due(p_amount, p_paid, p_due, p_mobile_banking), mobile_banking = coalesce(p_mobile_banking, 0),
      remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null
    returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Removes a line of any kind from an open sheet (kept, marked removed, with a reason)
create or replace function public.da_remove_line(p_kind text, p_line uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_session uuid; n int;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_kind = 'rider' then select session_id into v_session from public.da_rider_lines where id = p_line;
  elsif p_kind = 'merchant' then select session_id into v_session from public.da_merchant_payments where id = p_line;
  elsif p_kind = 'expense' then select session_id into v_session from public.da_expenses where id = p_line;
  else raise exception 'Kind must be rider, merchant or expense.' using errcode = '22023';
  end if;
  if v_session is null then raise exception 'Line not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(v_session);
  if p_kind = 'rider' then
    update public.da_rider_lines set removed_at = now(), removed_by = auth.uid(), remove_reason = p_reason where id = p_line and removed_at is null;
  elsif p_kind = 'merchant' then
    update public.da_merchant_payments set removed_at = now(), removed_by = auth.uid(), remove_reason = p_reason where id = p_line and removed_at is null;
  else
    update public.da_expenses set removed_at = now(), removed_by = auth.uid(), remove_reason = p_reason where id = p_line and removed_at is null;
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'This line was already removed.' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Merchant cash payments
-- ---------------------------------------------------------------------
create or replace function public.da_save_merchant_payment(
  p_session uuid, p_merchant uuid, p_payment_ref text, p_transaction_id text, p_amount numeric, p_payment_date date,
  p_screenshot_path text default null, p_ocr jsonb default null, p_ocr_verified boolean default false,
  p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s  public.da_sessions := private.da_require_edit(p_session);
  m  public.merchants;
  mp public.merchant_payments;
  v_match text := 'unmatched';
  v_id uuid;
begin
  select * into m from public.merchants where id = p_merchant and archived_at is null;
  if m.id is null or m.hub_id <> s.hub_id then raise exception 'Choose a merchant of this hub.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if p_payment_date is null or p_payment_date > private.da_today() then raise exception 'Payment date cannot be in the future.' using errcode = '22023'; end if;
  if p_transaction_id is not null and exists (select 1 from public.da_merchant_payments
       where lower(transaction_id) = lower(trim(p_transaction_id)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Transaction ID % is already recorded.', p_transaction_id using errcode = '23505';
  end if;
  if nullif(trim(p_payment_ref), '') is not null then
    select * into mp from public.merchant_payments where hub_id = s.hub_id and upper(payment_no) = upper(trim(p_payment_ref));
    if mp.id is not null then
      v_match := case when mp.merchant_id = p_merchant and mp.amount = p_amount then 'matched' else 'mismatch' end;
    end if;
  end if;
  if p_line is null then
    insert into public.da_merchant_payments (session_id, hub_id, zone_id, merchant_id, merchant_name, payment_ref, transaction_id,
      amount, payment_date, screenshot_path, ocr, ocr_verified, verified_by, match_status, matched_payment_id, remarks)
    values (s.id, s.hub_id, s.zone_id, m.id, m.name, nullif(trim(p_payment_ref), ''), nullif(trim(p_transaction_id), ''),
      p_amount, p_payment_date, p_screenshot_path, p_ocr, coalesce(p_ocr_verified, false),
      case when p_ocr_verified then auth.uid() end, v_match, mp.id, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_merchant_payments set merchant_id = m.id, merchant_name = m.name, payment_ref = nullif(trim(p_payment_ref), ''),
      transaction_id = nullif(trim(p_transaction_id), ''), amount = p_amount, payment_date = p_payment_date,
      screenshot_path = coalesce(p_screenshot_path, screenshot_path), ocr = coalesce(p_ocr, ocr),
      ocr_verified = coalesce(p_ocr_verified, false), verified_by = case when p_ocr_verified then auth.uid() end,
      match_status = v_match, matched_payment_id = mp.id, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Transport and hub employee expenses
-- ---------------------------------------------------------------------
create or replace function public.da_save_expense(
  p_session uuid, p_kind text, p_employee_code text, p_expense_name text, p_category text, p_amount numeric,
  p_bill_date date, p_bill_no text default null, p_reference_no text default null, p_attachment_path text default null,
  p_paid_by_code text default null, p_ocr jsonb default null, p_ocr_verified boolean default false,
  p_template uuid default null, p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s   public.da_sessions := private.da_require_edit(p_session);
  v_e uuid; e public.employees; v_p uuid; p public.employees;
  v_ref jsonb := coalesce(private.da_setting('da.reference_setup'), '{}');
  v_bill jsonb := coalesce(private.da_setting('da.bill_upload'), '{}');
  v_id uuid;
begin
  if p_kind not in ('transport','employee') then raise exception 'Kind must be transport or employee.' using errcode = '22023'; end if;
  if nullif(trim(p_employee_code), '') is not null then
    v_e := private.da_find_employee(p_employee_code);
    if v_e is null or not private.da_employee_ok(v_e, s.hub_id) then
      raise exception 'Employee % is not an active member of this hub.', p_employee_code using errcode = '22023';
    end if;
    select * into e from public.employees where id = v_e;
  elsif p_kind = 'employee' then
    raise exception 'An employee expense needs the Employee ID.' using errcode = '22023';
  end if;
  if nullif(trim(p_paid_by_code), '') is not null then
    v_p := private.da_find_employee(p_paid_by_code);
    if v_p is null then raise exception 'Paid-by Employee ID % was not found.', p_paid_by_code using errcode = '22023'; end if;
    select * into p from public.employees where id = v_p;
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c
                 where c ->> 'code' = p_category) then
    raise exception 'Unknown expense category %.', p_category using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if p_bill_date is null or p_bill_date > private.da_today() then raise exception 'Bill date cannot be in the future.' using errcode = '22023'; end if;
  if coalesce((v_ref ->> 'reference_required')::boolean, false) and nullif(trim(p_reference_no), '') is null then
    raise exception 'A reference number is required.' using errcode = '22023';
  end if;
  if p_reference_no is not null and exists (select 1 from public.da_expenses where hub_id = s.hub_id
       and lower(reference_no) = lower(trim(p_reference_no)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Reference number % is already used in this hub.', p_reference_no using errcode = '23505';
  end if;
  if p_line is null then
    insert into public.da_expenses (session_id, hub_id, zone_id, kind, employee_id, employee_code, employee_name, expense_name,
      category, amount, bill_date, bill_no, reference_no, attachment_path, paid_by_employee, paid_by_name, template_id,
      ocr, ocr_verified, verified_by, remarks)
    values (s.id, s.hub_id, s.zone_id, p_kind, v_e, e.employee_code::text, e.full_name, trim(p_expense_name), p_category,
      p_amount, p_bill_date, nullif(trim(p_bill_no), ''), nullif(trim(p_reference_no), ''), p_attachment_path,
      v_p, p.full_name, p_template, p_ocr, coalesce(p_ocr_verified, false), case when p_ocr_verified then auth.uid() end,
      nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_expenses set kind = p_kind, employee_id = v_e, employee_code = e.employee_code::text, employee_name = e.full_name,
      expense_name = trim(p_expense_name), category = p_category, amount = p_amount, bill_date = p_bill_date,
      bill_no = nullif(trim(p_bill_no), ''), reference_no = nullif(trim(p_reference_no), ''),
      attachment_path = coalesce(p_attachment_path, attachment_path), paid_by_employee = v_p, paid_by_name = p.full_name,
      template_id = p_template, ocr = coalesce(p_ocr, ocr), ocr_verified = coalesce(p_ocr_verified, false),
      verified_by = case when p_ocr_verified then auth.uid() end, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. Submit (once), reopen for correction, verify
-- ---------------------------------------------------------------------
create or replace function public.da_submit(p_session uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_req numeric := nullif(private.da_setting('da.bill_upload') ->> 'required_over', '')::numeric;
  v_ocr boolean := coalesce((private.da_setting('da.ocr') ->> 'require_verification')::boolean, true);
begin
  if not exists (select 1 from public.da_rider_lines where session_id = s.id and removed_at is null)
     and not exists (select 1 from public.da_merchant_payments where session_id = s.id and removed_at is null)
     and not exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null) then
    raise exception 'The sheet is empty. Add at least one line before submitting.' using errcode = '22023';
  end if;
  if v_ocr and (exists (select 1 from public.da_merchant_payments where session_id = s.id and removed_at is null and ocr is not null and not ocr_verified)
             or exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null and ocr is not null and not ocr_verified)) then
    raise exception 'Some values were read by OCR and have not been checked. Confirm them before submitting.' using errcode = '22023';
  end if;
  if v_req is not null and exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null
                                    and amount >= v_req and attachment_path is null) then
    raise exception 'Expenses of % taka or more need a bill or memo attached.', v_req using errcode = '22023';
  end if;
  update public.da_sessions set status = 'submitted', submitted_by = auth.uid(), submitted_by_name = private.da_my_name(),
         submitted_by_code = private.da_my_code(), submitted_at = now(), submit_note = nullif(trim(p_note), ''),
         submit_count = submit_count + 1, verified_by = null, verified_by_name = null, verified_at = null
   where id = s.id;
  perform private.da_event(s.id, case when s.submit_count > 0 then 'resubmitted' else 'submitted' end, p_note, true);
end $$;

create or replace function public.da_reopen(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.correction.edit', s.zone_id, s.hub_id) then
    raise exception 'Changing a submitted sheet needs the correction permission.' using errcode = '42501';
  end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted sheet that is not yet approved can be reopened.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.da_sessions set status = 'correction' where id = s.id;
  perform private.da_event(s.id, 'reopened', p_reason, false);
end $$;

create or replace function public.da_verify(p_session uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.approve', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to verify daily accounts of this hub.' using errcode = '42501';
  end if;
  if coalesce(private.setting_text('da.require_assignment'), 'false') = 'true' and not private.is_super_admin()
     and exists (select 1 from public.da_hub_accountants where hub_id = s.hub_id and revoked_at is null)
     and not exists (select 1 from public.da_hub_accountants where hub_id = s.hub_id and revoked_at is null and user_id = auth.uid()) then
    raise exception 'Only the Accounts Manager assigned to this hub can verify its sheets.' using errcode = '42501';
  end if;
  if auth.uid() in (s.started_by, s.submitted_by) then
    raise exception 'The person who started or submitted a sheet cannot verify it.' using errcode = '42501';
  end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted sheet can be verified.' using errcode = '22023'; end if;
  if p_action not in ('approve','correction','note') then raise exception 'Action must be approve, correction or note.' using errcode = '22023'; end if;
  if p_action in ('correction','note') and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Write what needs to be corrected or noted.' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    update public.da_sessions set status = 'approved', verified_by = auth.uid(), verified_by_name = private.da_my_name(),
           verified_at = now(), verify_note = nullif(trim(p_note), '') where id = s.id;
    perform private.da_event(s.id, 'approved', p_note, true);
  elsif p_action = 'correction' then
    update public.da_sessions set status = 'correction', verify_note = p_note where id = s.id;
    perform private.da_event(s.id, 'correction_required', p_note, false);
  else
    update public.da_sessions set verify_note = p_note where id = s.id;
    perform private.da_event(s.id, 'note', p_note, false);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Reading: sheet, dashboard, My Accounts, reports
--    These run as the caller (security invoker), so Row Level Security limits them.
-- ---------------------------------------------------------------------
create or replace function public.da_sheet(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.da_sessions where id = p_session) then
    raise exception 'Daily account sheet not found or not visible to you.' using errcode = 'P0002';
  end if;
  select private.da_snapshot(p_session)
         || jsonb_build_object(
              'events', coalesce((select jsonb_agg(to_jsonb(e) - 'snapshot' || jsonb_build_object('has_snapshot', e.snapshot is not null) order by e.at)
                                  from public.da_events e where e.session_id = p_session), '[]'),
              'visits', coalesce((select jsonb_agg(to_jsonb(v) order by v.entered_at desc)
                                  from public.da_page_visits v where v.session_id = p_session), '[]'),
              'can_edit', (select private.da_can_edit(s) from public.da_sessions s where s.id = p_session),
              'can_verify', (select private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)
                                    and auth.uid() is distinct from s.started_by and auth.uid() is distinct from s.submitted_by
                             from public.da_sessions s where s.id = p_session),
              'can_reopen', (select private.has_permission('da.correction.edit', s.zone_id, s.hub_id) and s.status = 'submitted'
                             from public.da_sessions s where s.id = p_session))
    into v_out;
  -- riders see only their own line when they have no hub-level view
  if not exists (select 1 from public.da_sessions s where s.id = p_session
                 and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)) then
    v_out := jsonb_set(v_out, '{riders}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'riders') r
                                             where (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{merchant_payments}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'merchant_payments') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{expenses}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'expenses') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := v_out - 'totals' - 'visits';
  end if;
  return v_out;
end $$;

create or replace function public.da_event_snapshot(p_event uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select e.snapshot from public.da_events e where e.id = p_event
$$;

create or replace function public.da_list_sessions(p_from date, p_to date, p_hub uuid default null, p_zone uuid default null,
                                                   p_status text default null)
returns table (id uuid, no bigint, hub_id uuid, hub_name text, zone_id uuid, zone_name text, account_date date, status text,
               started_by_name text, started_at timestamptz, submitted_by_name text, submitted_at timestamptz,
               verified_by_name text, verified_at timestamptz, riders bigint, delivery bigint, pickup bigint,
               amount numeric, due numeric, mobile_banking numeric, merchant_cash numeric, expense numeric)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.no, s.hub_id, h.name, s.zone_id, z.name, s.account_date, s.status, s.started_by_name, s.started_at,
         s.submitted_by_name, s.submitted_at, s.verified_by_name, s.verified_at,
         (select count(*) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.delivery_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.pickup_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.due), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.mobile_banking), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(m.amount), 0) from public.da_merchant_payments m where m.session_id = s.id and m.removed_at is null),
         (select coalesce(sum(x.amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null)
  from public.da_sessions s join public.hubs h on h.id = s.hub_id join public.zones z on z.id = s.zone_id
  where s.account_date between p_from and p_to
    and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
    and (p_status is null or s.status = p_status)
    and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
  order by s.account_date desc, h.name
$$;

create or replace function public.da_dashboard(p_from date, p_to date, p_hub uuid default null, p_zone uuid default null)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'today', private.da_today(),
    'sheets', count(*),
    'open', count(*) filter (where status = 'open'),
    'submitted', count(*) filter (where status in ('submitted','approved','correction') and submitted_at is not null),
    'pending_verification', count(*) filter (where status = 'submitted'),
    'correction', count(*) filter (where status = 'correction'),
    'approved', count(*) filter (where status = 'approved'),
    'riders', coalesce(sum(riders), 0), 'delivery', coalesce(sum(delivery), 0), 'pickup', coalesce(sum(pickup), 0),
    'amount', coalesce(sum(amount), 0), 'due', coalesce(sum(due), 0), 'mobile_banking', coalesce(sum(mobile_banking), 0),
    'merchant_cash', coalesce(sum(merchant_cash), 0), 'expense', coalesce(sum(expense), 0))
  from public.da_list_sessions(p_from, p_to, p_hub, p_zone, null)
$$;

-- My Accounts: everything that concerns the caller
create or replace function public.da_my_accounts(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (select private.my_employee_id() as emp, auth.uid() as uid)
  select jsonb_build_object(
    'employee', (select jsonb_build_object('id', e.id, 'code', e.employee_code, 'name', e.full_name, 'hub_id', e.hub_id)
                 from public.employees e, me where e.id = me.emp),
    'my_lines', coalesce((select jsonb_agg(jsonb_build_object('line', to_jsonb(l), 'account_date', s.account_date,
                          'status', s.status, 'hub', h.name, 'verify_note', s.verify_note) order by s.account_date desc)
                          from public.da_rider_lines l join public.da_sessions s on s.id = l.session_id
                          join public.hubs h on h.id = s.hub_id, me
                          where l.employee_id = me.emp and l.removed_at is null and s.account_date between p_from and p_to), '[]'),
    'my_sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'no', s.no, 'account_date', s.account_date,
                          'hub', h.name, 'status', s.status, 'submitted_at', s.submitted_at, 'verified_by_name', s.verified_by_name,
                          'verified_at', s.verified_at, 'verify_note', s.verify_note,
                          'started_by_me', s.started_by = me.uid, 'submitted_by_me', s.submitted_by = me.uid) order by s.account_date desc)
                          from public.da_sessions s join public.hubs h on h.id = s.hub_id, me
                          where (s.started_by = me.uid or s.submitted_by = me.uid) and s.account_date between p_from and p_to), '[]'),
    'my_expenses', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('account_date', s.account_date, 'status', s.status) order by x.bill_date desc)
                          from public.da_expenses x join public.da_sessions s on s.id = x.session_id, me
                          where x.removed_at is null and (x.employee_id = me.emp or x.created_by = me.uid)
                            and s.account_date between p_from and p_to), '[]'),
    'my_payments', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('account_date', s.account_date, 'status', s.status) order by m.payment_date desc)
                          from public.da_merchant_payments m join public.da_sessions s on s.id = m.session_id, me
                          where m.removed_at is null and m.created_by = me.uid and s.account_date between p_from and p_to), '[]'),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('at', ev.at, 'action', ev.action, 'note', ev.note, 'by', ev.actor_name,
                          'account_date', s.account_date, 'hub', h.name, 'session_id', s.id) order by ev.at desc)
                          from public.da_events ev join public.da_sessions s on s.id = ev.session_id join public.hubs h on h.id = s.hub_id, me
                          where ev.action in ('correction_required','note','approved')
                            and s.account_date between p_from and p_to
                            and (s.started_by = me.uid or s.submitted_by = me.uid
                                 or exists (select 1 from public.da_rider_lines l where l.session_id = s.id and l.employee_id = me.emp and l.removed_at is null))), '[]'))
$$;

-- Reports. p_kind: hub_daily | rider | employee_expense | merchant_payment | transport_expense |
--                  verification | pending | corrections
create or replace function public.da_report(p_kind text, p_from date, p_to date, p_hub uuid default null, p_zone uuid default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  if not (private.has_permission('da.report.view', p_zone, p_hub)
          or exists (select 1 from private.my_grants() g where g.permission_code = 'da.report.view' or g.is_super)) then
    raise exception 'Not authorised to view daily account reports.' using errcode = '42501';
  end if;
  if p_kind = 'hub_daily' then
    select coalesce(jsonb_agg(to_jsonb(l)), '[]') into v from public.da_list_sessions(p_from, p_to, p_hub, p_zone, null) l;
  elsif p_kind = 'pending' then
    select coalesce(jsonb_agg(to_jsonb(l)), '[]') into v from public.da_list_sessions(p_from, p_to, p_hub, p_zone, 'submitted') l;
  elsif p_kind = 'rider' then
    select coalesce(jsonb_agg(r order by r ->> 'rider_name'), '[]') into v from (
      select jsonb_build_object('employee_code', l.employee_code, 'rider_name', l.rider_name, 'mobile', max(l.mobile),
             'hub', h.name, 'days', count(distinct s.account_date), 'delivery', sum(l.delivery_qty), 'pickup', sum(l.pickup_qty),
             'amount', sum(l.amount), 'paid', sum(l.paid_amount), 'due', sum(l.due), 'mobile_banking', sum(l.mobile_banking)) r
      from public.da_rider_lines l join public.da_sessions s on s.id = l.session_id join public.hubs h on h.id = s.hub_id
      where l.removed_at is null and s.account_date between p_from and p_to
        and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
        and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
      group by l.employee_code, l.rider_name, h.name) q;
  elsif p_kind in ('employee_expense','transport_expense') then
    select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('account_date', s.account_date, 'hub', h.name, 'status', s.status)
                              order by s.account_date desc, x.no), '[]') into v
    from public.da_expenses x join public.da_sessions s on s.id = x.session_id join public.hubs h on h.id = s.hub_id
    where x.removed_at is null and x.kind = case when p_kind = 'employee_expense' then 'employee' else 'transport' end
      and s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
      and private.has_permission('da.sheet.view', s.zone_id, s.hub_id);
  elsif p_kind = 'merchant_payment' then
    select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('account_date', s.account_date, 'hub', h.name, 'status', s.status)
                              order by s.account_date desc, m.no), '[]') into v
    from public.da_merchant_payments m join public.da_sessions s on s.id = m.session_id join public.hubs h on h.id = s.hub_id
    where m.removed_at is null and s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub)
      and (p_zone is null or s.zone_id = p_zone) and private.has_permission('da.sheet.view', s.zone_id, s.hub_id);
  elsif p_kind in ('verification','corrections') then
    select coalesce(jsonb_agg(jsonb_build_object('no', e.no, 'at', e.at, 'action', e.action, 'note', e.note, 'by', e.actor_name,
                              'by_code', e.actor_code, 'session_no', s.no, 'account_date', s.account_date, 'hub', h.name)
                              order by e.at desc), '[]') into v
    from public.da_events e join public.da_sessions s on s.id = e.session_id join public.hubs h on h.id = s.hub_id
    where s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
      and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
      and e.action = any (case when p_kind = 'verification' then array['approved','correction_required','note']
                               else array['correction_required','reopened','resubmitted'] end);
  else
    raise exception 'Unknown report %.', p_kind using errcode = '22023';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 9. Settings, templates, Accounts Manager assignment
-- ---------------------------------------------------------------------
create or replace function public.da_configure(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then
    raise exception 'Not authorised to change daily account settings.' using errcode = '42501';
  end if;
  if p_key not like 'da.%' or not exists (select 1 from public.system_settings where key = p_key) then
    raise exception 'Unknown daily account setting %.', p_key using errcode = '22023';
  end if;
  if p_key = 'da.start_time' and (jsonb_typeof(p_value) <> 'string' or p_value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'Start time must look like 08:30.' using errcode = '22023';
  elsif p_key = 'da.due_rule' and p_value #>> '{}' not in ('manual','amount_minus_paid') then
    raise exception 'Due rule must be manual or amount_minus_paid.' using errcode = '22023';
  elsif p_key = 'da.mobile_banking_rule' and p_value #>> '{}' not in ('separate','reduces_due','adds_to_due') then
    raise exception 'Mobile banking rule must be separate, reduces_due or adds_to_due.' using errcode = '22023';
  elsif p_key in ('da.session_tracking','da.require_assignment') and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'This setting must be true or false.' using errcode = '22023';
  elsif p_key = 'da.backdate_days' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 31) then
    raise exception 'Back-dating must be 0 to 31 days.' using errcode = '22023';
  elsif p_key = 'da.expense_categories' and (jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0
        or exists (select 1 from jsonb_array_elements(p_value) c where coalesce(c ->> 'code', '') !~ '^[a-z][a-z0-9_]*$'
                                                                       or length(trim(coalesce(c ->> 'en', ''))) = 0)) then
    raise exception 'Each category needs a code (a-z, 0-9, _) and a name.' using errcode = '22023';
  elsif p_key = 'da.rider_fields' and (jsonb_typeof(p_value) <> 'array'
        or exists (select 1 from jsonb_array_elements_text(p_value) f
                   where f not in ('delivery_qty','pickup_qty','amount','paid_amount','due','mobile_banking','remarks'))) then
    raise exception 'Unknown rider field.' using errcode = '22023';
  elsif p_key in ('da.reference_setup','da.bill_upload','da.ocr') and jsonb_typeof(p_value) <> 'object' then
    raise exception 'This setting must be an object.' using errcode = '22023';
  end if;
  update public.system_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform private.write_audit('CONFIGURE', 'da', 'system_settings', p_key, null, jsonb_build_object(p_key, p_value));
end $$;

create or replace function public.da_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- readable by every signed-in user: riders need the field list and rules for My Accounts
  select coalesce(jsonb_object_agg(key, value), '{}') from public.system_settings
  where key like 'da.%' and auth.uid() is not null
$$;

create or replace function public.da_save_template(
  p_name text, p_category text, p_reference_prefix text default null, p_keywords text[] default '{}',
  p_memo_template text default null, p_default_amount numeric default null, p_name_bn text default null,
  p_status text default 'active', p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not private.has_permission('da.settings.configure') then
    raise exception 'Not authorised to change expense templates.' using errcode = '42501';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = p_category) then
    raise exception 'Unknown expense category %.', p_category using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.da_expense_templates (name, name_bn, category, reference_prefix, keywords, memo_template, default_amount, status)
    values (trim(p_name), p_name_bn, p_category, nullif(trim(p_reference_prefix), ''), coalesce(p_keywords, '{}'), p_memo_template, p_default_amount, p_status)
    returning id into v;
  else
    update public.da_expense_templates set name = trim(p_name), name_bn = p_name_bn, category = p_category,
      reference_prefix = nullif(trim(p_reference_prefix), ''), keywords = coalesce(p_keywords, '{}'), memo_template = p_memo_template,
      default_amount = p_default_amount, status = p_status where id = p_id returning id into v;
    if v is null then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

create or replace function public.da_assign_accountant(p_hub uuid, p_user uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_zone uuid := private.hub_zone(p_hub);
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active' and archived_at is null) then
    raise exception 'The user is not active.' using errcode = '22023';
  end if;
  insert into public.da_hub_accountants (hub_id, zone_id, user_id, reason) values (p_hub, v_zone, p_user, p_reason) returning id into v;
  return v;
end $$;

create or replace function public.da_revoke_accountant(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.da_hub_accountants set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where id = p_id and revoked_at is null;
  if not found then raise exception 'Assignment not found or already revoked.' using errcode = 'P0002'; end if;
end $$;

-- Hubs the caller can work with in Daily Accounts (for hub pickers)
create or replace function public.da_my_hubs()
returns table (hub_id uuid, code text, name text, name_bn text, zone_id uuid, zone_name text,
               can_view boolean, can_submit boolean, can_verify boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, h.code::text, h.name, h.name_bn, z.id, z.name,
         private.has_permission('da.sheet.view', z.id, h.id), private.has_permission('da.sheet.create', z.id, h.id),
         private.has_permission('da.sheet.approve', z.id, h.id)
  from public.hubs h join public.zones z on z.id = h.zone_id
  where h.archived_at is null and h.status = 'active'
    and (private.has_permission('da.sheet.view', z.id, h.id) or private.has_permission('da.sheet.create', z.id, h.id))
  order by z.name, h.name
$$;

-- People who can verify (for the Accounts Manager assignment screen)
create or replace function public.da_verifier_candidates()
returns table (user_id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  return query
    select distinct pr.id, coalesce(nullif(pr.full_name, ''), pr.email::text), pr.email::text
    from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles pr on pr.id = ur.user_id
    where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date) and pr.status = 'active'
      and (r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                                 where rp.role_id = r.id and p.code = 'da.sheet.approve'))
    order by 2;
end $$;

-- Who can work on a hub's daily accounts (for the settings screen)
create or replace function public.da_hub_access(p_hub uuid)
returns table (user_id uuid, full_name text, role_name text, scope_type text, can_submit boolean, can_verify boolean, can_correct boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  return query
    select pr.id, coalesce(nullif(pr.full_name, ''), pr.email::text), r.name, ur.scope_type,
           r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id and p.code = 'da.sheet.create'),
           r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id and p.code = 'da.sheet.approve'),
           r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id and p.code = 'da.correction.edit')
    from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles pr on pr.id = ur.user_id
    where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date) and pr.status = 'active'
      and (ur.scope_type = 'global' or ur.zone_id = v_zone or ur.hub_id = p_hub)
      and (r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                                 where rp.role_id = r.id and p.module = 'da'))
    order by pr.full_name;
end $$;

-- ---------------------------------------------------------------------
-- Stamp / audit / no-delete
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['da_sessions','da_rider_lines','da_merchant_payments','da_expenses','da_hub_accountants','da_expense_templates'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''da'')', t || '_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger da_events_audit after insert on public.da_events for each row execute function private.audit_row('da');
create trigger da_page_visits_no_delete before delete on public.da_page_visits for each row execute function private.prevent_delete();

-- ---------------------------------------------------------------------
-- Row Level Security (reads only; every write goes through the functions above)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['da_sessions','da_rider_lines','da_merchant_payments','da_expenses','da_events',
                           'da_page_visits','da_hub_accountants','da_expense_templates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

create policy da_sessions_read on public.da_sessions for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id)
         or started_by = auth.uid() or submitted_by = auth.uid()
         or exists (select 1 from public.da_rider_lines l where l.session_id = da_sessions.id and l.employee_id = private.my_employee_id()
                    and l.removed_at is null));
create policy da_rider_lines_read on public.da_rider_lines for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or employee_id = private.my_employee_id() or created_by = auth.uid());
create policy da_merchant_payments_read on public.da_merchant_payments for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or created_by = auth.uid());
create policy da_expenses_read on public.da_expenses for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or created_by = auth.uid()
         or employee_id = private.my_employee_id());
create policy da_events_read on public.da_events for select to authenticated
  using (exists (select 1 from public.da_sessions s where s.id = session_id));
create policy da_page_visits_read on public.da_page_visits for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.da_sessions s where s.id = session_id
                                         and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)));
create policy da_hub_accountants_read on public.da_hub_accountants for select to authenticated
  using (user_id = auth.uid() or private.has_permission('da.sheet.view', zone_id, hub_id)
         or private.has_permission('da.settings.configure'));
create policy da_expense_templates_read on public.da_expense_templates for select to authenticated
  using (exists (select 1 from private.my_grants() g where g.permission_code like 'da.%' or g.is_super));

-- ---------------------------------------------------------------------
-- Storage: private bucket for screenshots and bills (only on Supabase)
-- Path: da/<session_id>/<uuid>-<file name>. File access = access to the sheet.
-- ---------------------------------------------------------------------
create or replace function private.da_can_read_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and (private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
                               or private.has_permission('da.sheet.create', s.zone_id, s.hub_id));
end $$;

create or replace function private.da_can_upload_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and private.da_can_edit(s);
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'buckets') then
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('da-evidence', 'da-evidence', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
             on conflict (id) do nothing$q$;
    execute $q$create policy da_evidence_read on storage.objects for select to authenticated
             using (bucket_id = 'da-evidence' and private.da_can_read_object(name))$q$;
    execute $q$create policy da_evidence_upload on storage.objects for insert to authenticated
             with check (bucket_id = 'da-evidence' and private.da_can_upload_object(name))$q$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'da\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Default permissions per role (editable later by Super Admin)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'da' and (
     r.code = 'admin'
  or (r.code = 'accounts_manager' and p.code in ('da.sheet.view','da.sheet.approve','da.correction.edit','da.report.view',
                                                 'da.report.export','da.report.print','da.settings.configure'))
  or (r.code = 'accountant' and p.code in ('da.sheet.view','da.sheet.create','da.report.view','da.report.export','da.report.print'))
  or (r.code in ('head_office_manager','auditor','operations_manager') and p.code in ('da.sheet.view','da.report.view','da.report.export','da.report.print'))
  or (r.code = 'zonal_manager' and p.code in ('da.sheet.view','da.correction.edit','da.report.view','da.report.export','da.report.print'))
  or (r.code = 'hub_manager' and p.code in ('da.sheet.view','da.sheet.create','da.report.view','da.report.print'))
)
on conflict do nothing;

-- ===== 20261113000900_business_timezone.sql =====
-- Business day = Bangladesh day (Asia/Dhaka, UTC+6).
--
-- Supabase databases run in UTC by default. Many rules use current_date / now()::date
-- (attendance, leave, hub figures, parcels, imports, role validity). In UTC, between
-- 00:00 and 05:59 Dhaka time the database still thinks it is the previous day, so
-- "today" would be rejected as a future date and reports would land on the wrong day.
--
-- Setting the database time zone makes every new connection use Dhaka time. Stored
-- timestamps (timestamptz) are absolute and do not change; only how "today" and
-- times are read changes. This is the method Supabase documents for changing the
-- time zone. Pooled connections pick it up as they are recycled (a project restart
-- applies it everywhere at once).

do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Dhaka');
end $$;

-- The rest of this migration session uses it too.
set timezone to 'Asia/Dhaka';

insert into public.system_settings (key, value, description, is_public) values
  ('system.timezone', '"Asia/Dhaka"', 'Business time zone. "Today" for every rule is the Bangladesh date.', true)
on conflict (key) do nothing;

-- Health check an admin (or a monitoring job) can call: returns false if the
-- connection is not running in the business time zone.
create or replace function public.system_timezone_ok()
returns table (ok boolean, session_timezone text, business_timezone text, business_today date, server_today date)
language sql stable security invoker set search_path = '' as $$
  select current_setting('TimeZone') = s.tz,
         current_setting('TimeZone'),
         s.tz,
         (now() at time zone s.tz)::date,
         current_date
  from (select coalesce(private.setting_text('system.timezone'), 'Asia/Dhaka') as tz) s
$$;
revoke all on function public.system_timezone_ok() from public, anon;
grant execute on function public.system_timezone_ok() to authenticated;

-- ===== 20261113001000_function_search_path.sql =====
-- Supabase Security Advisor (lint 0011 "function_search_path_mutable"): pin search_path
-- on the 15 helper/trigger functions that did not set it. They are SECURITY INVOKER and
-- only use pg_catalog built-ins or fully qualified names, so an empty search_path is safe.
alter function private.append_only()                 set search_path = '';
alter function private.audit_immutable()             set search_path = '';
alter function private.compensation_guard()          set search_path = '';
alter function private.compensation_item_guard()     set search_path = '';
alter function private.custom_field_guard()          set search_path = '';
alter function private.da_append_only()              set search_path = '';
alter function private.guard_system_role()           set search_path = '';
alter function private.import_batch_guard()          set search_path = '';
alter function private.is_api_user()                 set search_path = '';
alter function private.leave_request_guard()         set search_path = '';
alter function private.parse_date_bd(text)           set search_path = '';
alter function private.prevent_delete()              set search_path = '';
alter function private.request_header(text)          set search_path = '';
alter function private.salary_sheet_guard()          set search_path = '';
alter function private.stamp_row()                   set search_path = '';

-- ===== 20261113001100_foreign_key_indexes.sql =====
-- Supabase Performance Advisor (lint 0001 "unindexed_foreign_keys"): one index per foreign key
-- that had no covering index (59). Speeds up joins, scope filters and parent-row checks.
create index if not exists cash_collections_merchant_id_fk_idx on public.cash_collections (merchant_id);
create index if not exists cash_collections_pickup_consolidation_id_fk_idx on public.cash_collections (pickup_consolidation_id);
create index if not exists cash_collections_zone_id_fk_idx on public.cash_collections (zone_id);
create index if not exists cash_handovers_zone_id_fk_idx on public.cash_handovers (zone_id);
create index if not exists cash_reconciliations_zone_id_fk_idx on public.cash_reconciliations (zone_id);
create index if not exists da_expenses_paid_by_employee_fk_idx on public.da_expenses (paid_by_employee);
create index if not exists da_expenses_template_id_fk_idx on public.da_expenses (template_id);
create index if not exists da_expenses_zone_id_fk_idx on public.da_expenses (zone_id);
create index if not exists da_hub_accountants_user_id_fk_idx on public.da_hub_accountants (user_id);
create index if not exists da_hub_accountants_zone_id_fk_idx on public.da_hub_accountants (zone_id);
create index if not exists da_merchant_payments_hub_id_fk_idx on public.da_merchant_payments (hub_id);
create index if not exists da_merchant_payments_matched_payment_id_fk_idx on public.da_merchant_payments (matched_payment_id);
create index if not exists da_merchant_payments_merchant_id_fk_idx on public.da_merchant_payments (merchant_id);
create index if not exists da_merchant_payments_zone_id_fk_idx on public.da_merchant_payments (zone_id);
create index if not exists da_rider_lines_hub_id_fk_idx on public.da_rider_lines (hub_id);
create index if not exists da_rider_lines_zone_id_fk_idx on public.da_rider_lines (zone_id);
create index if not exists da_sessions_started_by_employee_fk_idx on public.da_sessions (started_by_employee);
create index if not exists delivery_records_merchant_id_fk_idx on public.delivery_records (merchant_id);
create index if not exists delivery_records_zone_id_fk_idx on public.delivery_records (zone_id);
create index if not exists departments_organization_id_fk_idx on public.departments (organization_id);
create index if not exists employee_assignments_department_id_fk_idx on public.employee_assignments (department_id);
create index if not exists employee_assignments_hub_id_fk_idx on public.employee_assignments (hub_id);
create index if not exists employee_assignments_position_id_fk_idx on public.employee_assignments (position_id);
create index if not exists employee_assignments_reporting_manager_id_fk_idx on public.employee_assignments (reporting_manager_id);
create index if not exists employee_assignments_zone_id_fk_idx on public.employee_assignments (zone_id);
create index if not exists employee_compensation_items_type_id_fk_idx on public.employee_compensation_items (type_id);
create index if not exists employee_custom_fields_edit_permission_fk_idx on public.employee_custom_fields (edit_permission);
create index if not exists employee_custom_fields_view_permission_fk_idx on public.employee_custom_fields (view_permission);
create index if not exists employee_import_rows_employee_id_fk_idx on public.employee_import_rows (employee_id);
create index if not exists employees_department_id_fk_idx on public.employees (department_id);
create index if not exists employees_position_id_fk_idx on public.employees (position_id);
create index if not exists employees_reporting_manager_id_fk_idx on public.employees (reporting_manager_id);
create index if not exists hub_visits_hub_id_fk_idx on public.hub_visits (hub_id);
create index if not exists leave_requests_leave_type_id_fk_idx on public.leave_requests (leave_type_id);
create index if not exists merchant_payments_zone_id_fk_idx on public.merchant_payments (zone_id);
create index if not exists merchants_zone_id_fk_idx on public.merchants (zone_id);
create index if not exists operational_expenses_rider_id_fk_idx on public.operational_expenses (rider_id);
create index if not exists operational_expenses_zone_id_fk_idx on public.operational_expenses (zone_id);
create index if not exists parcel_issues_zone_id_fk_idx on public.parcel_issues (zone_id);
create index if not exists parcels_zone_id_fk_idx on public.parcels (zone_id);
create index if not exists pickup_consolidations_merchant_id_fk_idx on public.pickup_consolidations (merchant_id);
create index if not exists pickup_consolidations_rider_id_fk_idx on public.pickup_consolidations (rider_id);
create index if not exists pickup_consolidations_zone_id_fk_idx on public.pickup_consolidations (zone_id);
create index if not exists pickup_submissions_consolidation_id_fk_idx on public.pickup_submissions (consolidation_id);
create index if not exists pickup_submissions_merchant_id_fk_idx on public.pickup_submissions (merchant_id);
create index if not exists pickup_submissions_rider_id_fk_idx on public.pickup_submissions (rider_id);
create index if not exists pickup_submissions_submitted_by_fk_idx on public.pickup_submissions (submitted_by);
create index if not exists pickup_submissions_zone_id_fk_idx on public.pickup_submissions (zone_id);
create index if not exists salary_sheet_lines_compensation_id_fk_idx on public.salary_sheet_lines (compensation_id);
create index if not exists salary_sheet_lines_employee_id_fk_idx on public.salary_sheet_lines (employee_id);
create index if not exists salary_sheets_hub_id_fk_idx on public.salary_sheets (hub_id);
create index if not exists salary_sheets_zone_id_fk_idx on public.salary_sheets (zone_id);
create index if not exists task_reminders_task_id_fk_idx on public.task_reminders (task_id);
create index if not exists tasks_hub_id_fk_idx on public.tasks (hub_id);
create index if not exists tasks_related_employee_id_fk_idx on public.tasks (related_employee_id);
create index if not exists user_roles_hub_id_fk_idx on public.user_roles (hub_id);
create index if not exists user_roles_role_id_fk_idx on public.user_roles (role_id);
create index if not exists user_roles_zone_id_fk_idx on public.user_roles (zone_id);
create index if not exists workforce_recommendations_hub_id_fk_idx on public.workforce_recommendations (hub_id);

-- ===== 20261113001200_login_lockout_hook.sql =====
-- Login lockout, enforced by Supabase Auth itself.
--
-- 1. The `auth-login` Edge Function counts failed passwords with record_login_attempt()
--    (5 failures -> locked 30 minutes; both numbers are system settings).
-- 2. This Custom Access Token hook makes Supabase Auth refuse to issue or refresh a
--    session for an account that is locked, inactive or archived - even when someone
--    calls the Auth API directly with the public key instead of going through the
--    Edge Function. Turn it on once in the dashboard:
--    Authentication -> Hooks -> Customize Access Token (JWT) Claims -> Postgres function
--    -> public.custom_access_token_hook.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = (event ->> 'user_id')::uuid;
  if p.id is not null then
    if p.locked_until is not null and p.locked_until > now() then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403,
        'message', 'Account locked after too many failed sign-ins. Try again after '
                   || to_char(p.locked_until at time zone 'Asia/Dhaka', 'DD/MM/YYYY HH24:MI') || ' (Dhaka time).'));
    end if;
    if p.status <> 'active' or p.archived_at is not null then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'This account is not active. Contact your system administrator.'));
    end if;
  end if;
  return jsonb_build_object('claims', event -> 'claims');
end $$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

-- Lockout state for the Edge Function, before it asks Auth to check the password.
-- service_role only (the Edge Function); browsers cannot call it.
create or replace function public.login_lock_state(p_email text)
returns table (locked boolean, locked_until timestamptz, active boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(p.locked_until > now(), false), p.locked_until,
         p.status = 'active' and p.archived_at is null
  from public.profiles p where p.email = p_email::extensions.citext
$$;
revoke all on function public.login_lock_state(text) from public, anon, authenticated;
grant execute on function public.login_lock_state(text) to service_role;

-- ===== 20261113001300_numeric_employee_ids.sql =====
-- Employee IDs as plain numbers starting at 1 (the office's own numbering), while
-- still accepting the older "XZ-1234" style so existing records stay valid.
update public.system_settings
   set value = to_jsonb('^([A-Z]{2,4}-[0-9]{3,6}|[1-9][0-9]{0,5})$'::text),
       description = 'Employee ID format: a number from 1 (e.g. 14) or the older XZ-1234 style'
 where key = 'hr.employee_code_pattern';

-- Suggests the next free numeric Employee ID for the approval screen. Only people who
-- can approve applications may ask. The approver can still type another free number.
create or replace function public.hr_next_employee_code()
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.application.approve' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return (select (coalesce(max((employee_code::text)::bigint), 0) + 1)::text
            from public.employees where employee_code::text ~ '^[0-9]{1,9}$');
end $$;
revoke all on function public.hr_next_employee_code() from public, anon;
grant execute on function public.hr_next_employee_code() to authenticated;

-- ===== 20261113001400_first_employee_manager.sql =====
-- The first employees of a new zone have nobody to report to yet, so the
-- "reporting manager" field is required only when the zone already has an active employee.
create or replace function public.hr_application_missing_fields(p_employee uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  s public.employee_sensitive%rowtype;
  v text[] := '{}';
  d text;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if not (private.employee_has_permission('hr.application.view', p_employee)
          or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into s from public.employee_sensitive where employee_id = p_employee;

  if coalesce(trim(e.full_name), '') = '' then v := array_append(v, 'full_name'::text); end if;
  if e.mobile is null then v := array_append(v, 'mobile'::text); end if;
  if s.date_of_birth is null then v := array_append(v, 'date_of_birth'::text); end if;
  if s.nid_number is null then v := array_append(v, 'nid_number'::text); end if;
  if e.department_id is null then v := array_append(v, 'department'::text); end if;
  if e.position_id is null then v := array_append(v, 'position'::text); end if;
  if e.hub_id is null and e.zone_id is null then v := array_append(v, 'hub'::text); end if;
  if e.joining_date is null then v := array_append(v, 'joining_date'::text); end if;
  if e.emergency_contact_phone is null then v := array_append(v, 'emergency_contact'::text); end if;
  -- A reporting manager is required only once the zone has someone to report to
  -- (the very first employees of a new zone cannot name one).
  if e.reporting_manager_id is null and exists (
       select 1 from public.employees m
       where m.status = 'active' and m.id <> e.id and m.archived_at is null
         and m.zone_id = coalesce(e.zone_id, private.hub_zone(e.hub_id))) then
    v := array_append(v, 'reporting_manager'::text);
  end if;
  if not exists (select 1 from public.employee_compensation c where c.employee_id = p_employee and c.status in ('pending','approved')) then
    v := array_append(v, 'basic_salary'::text);
  end if;
  for d in select jsonb_array_elements_text(value) from public.system_settings where key = 'hr.required_documents' loop
    if not exists (select 1 from public.employee_documents x where x.employee_id = p_employee
                   and x.doc_type = d and x.archived_at is null) then
      v := v || ('document:' || d);
    end if;
  end loop;
  select v || coalesce(array_agg('field:' || f.code::text order by f.sort_order), '{}') into v
  from public.employee_custom_fields f
  where f.is_required and f.archived_at is null
    and not exists (select 1 from public.employee_custom_field_values cv where cv.field_id = f.id and cv.employee_id = p_employee);
  return v;
end $$;

-- ===== 20261113001500_user_admin.sql =====
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

-- ===== 20261113001600_role_builder.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0016: role builder
-- The Super Admin creates roles and decides exactly which permissions each role has
-- ("who sees what"). The menu and every database rule already follow permissions, so a
-- change here takes effect at the user's next page load. Every change is audited
-- (role_permissions audit trigger + roles audit trigger).
-- =====================================================================

-- Roles with counts, for the Roles page.
create or replace function public.role_admin_list()
returns table (id uuid, code text, name text, name_bn text, description text, is_system boolean, is_super boolean,
               status text, archived_at timestamptz, permission_count integer, user_count integer, permissions text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('system.role.view') then
    raise exception 'Not authorised to view roles.' using errcode = '42501';
  end if;
  return query
  select r.id, r.code::text, r.name, r.name_bn, r.description, r.is_system, r.is_super, r.status, r.archived_at,
         (select count(*)::int from public.role_permissions rp where rp.role_id = r.id),
         (select count(distinct ur.user_id)::int from public.user_roles ur
           where ur.role_id = r.id and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)),
         coalesce((select array_agg(p.code order by p.code) from public.role_permissions rp
                   join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id), '{}')
  from public.roles r
  order by r.archived_at nulls first, r.is_super desc, r.is_system desc, r.name;
end $$;

-- Create (p_id null) or update a role and set its full permission list in one step.
create or replace function public.role_admin_save(
  p_id uuid, p_name text, p_name_bn text, p_description text, p_permissions text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.roles%rowtype;
  v_id uuid;
  v_code text;
  v_unknown text;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can create roles or change their permissions.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A role name is required.' using errcode = '22023';
  end if;
  select x into v_unknown from unnest(coalesce(p_permissions, '{}')) x
   where not exists (select 1 from public.permissions p where p.code = x) limit 1;
  if v_unknown is not null then
    raise exception 'Unknown permission %.', v_unknown using errcode = '22023';
  end if;

  if p_id is null then
    -- code from the English name: "Hub Cashier" -> hub_cashier (unique suffix if taken)
    v_code := nullif(regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '_', 'g'), '');
    v_code := trim(both '_' from coalesce(v_code, ''));
    if v_code = '' or v_code !~ '^[a-z]' then v_code := 'role_' || substr(md5(random()::text), 1, 6); end if;
    if exists (select 1 from public.roles where code = v_code::extensions.citext) then
      v_code := v_code || '_' || substr(md5(random()::text), 1, 4);
    end if;
    insert into public.roles (code, name, name_bn, description, is_system, is_super)
    values (v_code, trim(p_name), nullif(trim(coalesce(p_name_bn, '')), ''), nullif(trim(coalesce(p_description, '')), ''), false, false)
    returning id into v_id;
  else
    select * into r from public.roles where id = p_id for update;
    if r.id is null then raise exception 'Role not found.' using errcode = 'P0001'; end if;
    if r.is_super then
      raise exception 'The Super Admin role always has every permission and cannot be edited.' using errcode = 'P0001';
    end if;
    if r.archived_at is not null then raise exception 'Archived roles cannot be edited.' using errcode = 'P0001'; end if;
    update public.roles
       set name = trim(p_name),
           name_bn = nullif(trim(coalesce(p_name_bn, '')), ''),
           description = nullif(trim(coalesce(p_description, '')), '')
     where id = p_id;
    v_id := p_id;
  end if;

  perform set_config('app.change_reason', 'Role permissions set by Super Admin', true);
  delete from public.role_permissions rp
   where rp.role_id = v_id
     and not exists (select 1 from public.permissions p where p.id = rp.permission_id and p.code = any(coalesce(p_permissions, '{}')));
  insert into public.role_permissions (role_id, permission_id)
  select v_id, p.id from public.permissions p
   where p.code = any(coalesce(p_permissions, '{}'))
  on conflict do nothing;
  return v_id;
end $$;

-- Archive a custom role (system roles stay). Refused while anyone still holds it.
create or replace function public.role_admin_archive(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.roles%rowtype;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can archive roles.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  select * into r from public.roles where id = p_id for update;
  if r.id is null then raise exception 'Role not found.' using errcode = 'P0001'; end if;
  if r.is_system then raise exception 'System roles cannot be archived.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.user_roles ur where ur.role_id = p_id and ur.revoked_at is null
               and (ur.valid_to is null or ur.valid_to >= current_date)) then
    raise exception 'Remove this role from every user before archiving it.' using errcode = 'P0001';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.roles set archived_at = now(), archived_by = auth.uid(), archive_reason = p_reason, status = 'inactive'
   where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.role_admin_list()',
                           'public.role_admin_save(uuid, text, text, text, text[])',
                           'public.role_admin_archive(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ===== 20261113001700_flexible_import.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0017: flexible employee import (old staff from Excel)
--
--  * Any spreadsheet column can be mapped to a field; only the fields listed in the
--    company setting hr.import_required_fields are compulsory (default: name + hub).
--    Old staff usually have just ID, name, position, hub, Basic, Transport, Commission.
--  * Hub / position / department by code OR name (English or Bangla).
--  * Columns can go into custom profile fields ("cf:<field code>") and the referrer
--    ("reference_code" = the referrer's Employee ID).
--  * Unknown hubs / positions can be created in one step (hr_import_create_missing).
--  * Two-person rule for imports follows hr.import_two_person; a Super Admin may verify
--    their own batch (a company with one admin must be able to work).
-- =====================================================================

-- Who referred this employee (Employee ID entered as "reference").
alter table public.employees add column if not exists referred_by_employee_id uuid references public.employees(id);
create index if not exists employees_referred_by_idx on public.employees (referred_by_employee_id);
alter table public.employees drop constraint if exists employees_not_self_referrer;
alter table public.employees add constraint employees_not_self_referrer check (referred_by_employee_id is null or referred_by_employee_id <> id);

insert into public.system_settings (key, value, description) values
  ('hr.import_required_fields', '["full_name","hub"]', 'Columns every import row must have (hub = hub code or hub name)'),
  ('hr.import_two_person', 'true', 'A second person must verify an import before it is saved (Super Admin may verify own)')
on conflict (key) do nothing;

-- Finds a hub / position / department by code or by name (English or Bangla), case-insensitive.
create or replace function private.find_hub(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select h.id from public.hubs h
   where h.archived_at is null
     and ((p_code is not null and h.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (lower(trim(h.name)) = lower(trim(p_name)) or trim(h.name_bn) = trim(p_name))))
   order by h.created_at limit 1
$$;
create or replace function private.find_position(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.positions x
   where x.archived_at is null
     and ((p_code is not null and x.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (lower(trim(x.name)) = lower(trim(p_name)) or trim(x.name_bn) = trim(p_name))))
   order by x.created_at limit 1
$$;
create or replace function private.find_department(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.departments x
   where x.archived_at is null
     and ((p_code is not null and x.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (lower(trim(x.name)) = lower(trim(p_name)) or trim(x.name_bn) = trim(p_name))))
   order by x.created_at limit 1
$$;

-- Converts a spreadsheet cell to the JSON value a custom field expects; null if it does not fit.
create or replace function private.import_custom_value(p_field uuid, p_text text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f public.employee_custom_fields%rowtype; t text := trim(p_text); d date; o jsonb;
begin
  select * into f from public.employee_custom_fields where id = p_field;
  if t is null or t = '' then return null; end if;
  case f.field_type
    when 'text', 'textarea' then return to_jsonb(t);
    when 'number' then
      if replace(t, ',', '') ~ '^-?\d+(\.\d+)?$' then return to_jsonb(replace(t, ',', '')::numeric); end if;
    when 'date' then
      d := private.parse_date_bd(t);
      if d is not null then return to_jsonb(d::text); end if;
    when 'checkbox' then
      if lower(t) in ('yes','y','true','1','হ্যাঁ','হা') then return 'true'::jsonb; end if;
      if lower(t) in ('no','n','false','0','না') then return 'false'::jsonb; end if;
    when 'dropdown' then
      select x into o from jsonb_array_elements(f.options) x
       where lower(x ->> 'value') = lower(t) or lower(x ->> 'label') = lower(t) or x ->> 'label_bn' = t limit 1;
      if o is not null then return to_jsonb(o ->> 'value'); end if;
    else null;
  end case;
  return null;
end $$;

create or replace function public.hr_validate_import(p_batch uuid, p_mapping jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record;
  m jsonb;
  errs text[];
  v_hub uuid; v_zone uuid; v_pos uuid; v_dept uuid; v_dob date; v_join date;
  v_min int := coalesce(private.setting_text('hr.min_age_years')::int, 18);
  allowed text[] := array['employee_code','full_name','full_name_bn','mobile','email','date_of_birth','nid_number',
                          'hub_code','hub_name','department_code','department_name','position_code','position_name',
                          'joining_date','basic_salary','transport_allowance','commission',
                          'emergency_contact_name','emergency_contact_phone','father_name','mother_name',
                          'present_address','permanent_address','reference_code'];
  required text[];
  f text; t text; cf record; cv jsonb;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.id is null then raise exception 'Import batch not found.' using errcode = 'P0001'; end if;
  if b.created_by <> auth.uid() and not private.has_permission('hr.import.approve') then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','validated') then raise exception 'Batch is already %.', b.status using errcode = 'P0001'; end if;
  for t in select x.value from jsonb_each_text(p_mapping) x loop
    if t <> all(allowed) and not (t like 'cf:%' and exists (
         select 1 from public.employee_custom_fields c where c.code = substr(t, 4)::extensions.citext and c.archived_at is null
           and c.field_type in ('text','textarea','number','date','checkbox','dropdown'))) then
      raise exception 'Mapping contains an unknown target field: %.', t using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_each_text(p_mapping)) <> (select count(distinct x.value) from jsonb_each_text(p_mapping) x) then
    raise exception 'Two columns are mapped to the same field.' using errcode = '22023';
  end if;
  select coalesce(array_agg(x), array['full_name','hub']) into required
    from jsonb_array_elements_text(coalesce((select value from public.system_settings where key = 'hr.import_required_fields'), '["full_name","hub"]'::jsonb)) x;
  foreach f in array required loop
    if f = 'hub' then
      if not exists (select 1 from jsonb_each_text(p_mapping) x where x.value in ('hub_code','hub_name')) then
        raise exception 'Required column "hub" is not mapped.' using errcode = '22023';
      end if;
    elsif not exists (select 1 from jsonb_each_text(p_mapping) x where x.value = f) then
      raise exception 'Required column "%" is not mapped.', f using errcode = '22023';
    end if;
  end loop;

  for r in select * from public.employee_import_rows where batch_id = p_batch order by row_number loop
    select coalesce(jsonb_object_agg(mp.value, nullif(trim(r.raw ->> mp.key), '')), '{}'::jsonb) into m
    from jsonb_each_text(p_mapping) mp;
    m := jsonb_strip_nulls(m);
    errs := '{}';
    foreach f in array required loop
      if f = 'hub' then
        if m ->> 'hub_code' is null and m ->> 'hub_name' is null then errs := array_append(errs, 'Missing hub'::text); end if;
      elsif m ->> f is null then errs := array_append(errs, 'Missing ' || f); end if;
    end loop;
    if m ->> 'mobile' is not null then
      m := jsonb_set(m, '{mobile}', to_jsonb(regexp_replace(regexp_replace(m ->> 'mobile', '[^0-9]', '', 'g'), '^(88)?', '')));
      if m ->> 'mobile' !~ private.setting_text('hr.mobile_pattern') then errs := array_append(errs, 'Invalid mobile'::text); end if;
    end if;
    if m ->> 'emergency_contact_phone' is not null and m ->> 'emergency_contact_phone' !~ private.setting_text('hr.mobile_pattern') then
      errs := array_append(errs, 'Invalid emergency_contact_phone'::text); end if;
    if m ->> 'nid_number' is not null and m ->> 'nid_number' !~ private.setting_text('hr.nid_pattern') then
      errs := array_append(errs, 'Invalid NID'::text); end if;
    v_dob := private.parse_date_bd(m ->> 'date_of_birth');
    v_join := private.parse_date_bd(m ->> 'joining_date');
    if m ->> 'date_of_birth' is not null and v_dob is null then errs := array_append(errs, 'Invalid date_of_birth'::text); end if;
    if m ->> 'joining_date' is not null and v_join is null then errs := array_append(errs, 'Invalid joining_date'::text); end if;
    if v_dob is not null and v_dob > coalesce(v_join, current_date) - make_interval(years => v_min) then
      errs := array_append(errs, 'Younger than ' || v_min); end if;
    if v_join is not null and v_join > current_date + 60 then errs := array_append(errs, 'Joining date too far in future'::text); end if;
    foreach f in array array['basic_salary','transport_allowance','commission'] loop
      if m ->> f is not null then
        m := jsonb_set(m, array[f], to_jsonb(replace(replace(m ->> f, ',', ''), '৳', '')));
        if (m ->> f) !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid ' || f); end if;
      end if;
    end loop;
    if m ->> 'basic_salary' is null and (m ->> 'transport_allowance' is not null or m ->> 'commission' is not null) then
      errs := array_append(errs, 'Missing basic_salary (needed when allowances are given)'::text); end if;

    v_hub := private.find_hub(m ->> 'hub_code', m ->> 'hub_name'); v_zone := null;
    if v_hub is not null then select zone_id into v_zone from public.hubs where id = v_hub; end if;
    if (m ->> 'hub_code' is not null or m ->> 'hub_name' is not null) and v_hub is null then
      errs := array_append(errs, 'Unknown hub: ' || coalesce(m ->> 'hub_code', m ->> 'hub_name')); end if;
    if v_hub is not null and not private.has_permission('hr.import.create', v_zone, v_hub) then
      errs := array_append(errs, 'Hub outside your scope'::text); end if;
    v_pos := private.find_position(m ->> 'position_code', m ->> 'position_name');
    if (m ->> 'position_code' is not null or m ->> 'position_name' is not null) and v_pos is null then
      errs := array_append(errs, 'Unknown position: ' || coalesce(m ->> 'position_code', m ->> 'position_name')); end if;
    v_dept := private.find_department(m ->> 'department_code', m ->> 'department_name');
    if (m ->> 'department_code' is not null or m ->> 'department_name' is not null) and v_dept is null then
      errs := array_append(errs, 'Unknown department: ' || coalesce(m ->> 'department_code', m ->> 'department_name')); end if;
    m := m || jsonb_strip_nulls(jsonb_build_object('_hub', v_hub, '_position', v_pos,
               '_department', coalesce(v_dept, (select p.department_id from public.positions p where p.id = v_pos))));

    if m ->> 'employee_code' is not null then
      m := jsonb_set(m, '{employee_code}', to_jsonb(upper(m ->> 'employee_code')));
      if (m ->> 'employee_code') !~ private.setting_text('hr.employee_code_pattern') then errs := array_append(errs, 'Invalid employee_code format'::text); end if;
      if exists (select 1 from public.employees where employee_code = (m ->> 'employee_code')::extensions.citext) then errs := array_append(errs, 'employee_code already exists'::text); end if;
    end if;
    if m ->> 'reference_code' is not null then
      if not exists (select 1 from public.employees e where e.employee_code = upper(m ->> 'reference_code')::extensions.citext)
         and not exists (select 1 from public.employee_import_rows o where o.batch_id = p_batch and o.row_number <> r.row_number
                           and upper(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'employee_code' limit 1)) = upper(m ->> 'reference_code')) then
        errs := array_append(errs, 'Unknown reference ID: ' || (m ->> 'reference_code'));
      elsif upper(m ->> 'reference_code') = m ->> 'employee_code' then
        errs := array_append(errs, 'Employee cannot refer themselves'::text);
      end if;
    end if;
    if m ->> 'nid_number' is not null and exists (select 1 from public.employee_sensitive where nid_number = m ->> 'nid_number') then errs := array_append(errs, 'NID already exists'::text); end if;
    if m ->> 'mobile' is not null and exists (select 1 from public.employees where mobile = m ->> 'mobile' and status <> 'rejected' and archived_at is null) then errs := array_append(errs, 'Mobile already exists'::text); end if;

    -- custom profile fields
    for cf in select x.key as col, substr(x.value, 4) as code from jsonb_each_text(p_mapping) x where x.value like 'cf:%' loop
      t := m ->> ('cf:' || cf.code);
      if t is not null then
        cv := private.import_custom_value((select c.id from public.employee_custom_fields c where c.code = cf.code::extensions.citext), t);
        if cv is null then errs := array_append(errs, 'Invalid value for ' || cf.col);
        else m := jsonb_set(m, array['cf:' || cf.code], cv); end if;
      end if;
    end loop;

    -- duplicates inside the same file
    if exists (select 1 from public.employee_import_rows o where o.batch_id = p_batch and o.row_number <> r.row_number
               and ((m ->> 'nid_number' is not null and o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'nid_number' limit 1) = m ->> 'nid_number')
                 or (m ->> 'mobile' is not null and regexp_replace(regexp_replace(coalesce(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'mobile' limit 1), ''), '[^0-9]', '', 'g'), '^(88)?', '') = m ->> 'mobile')
                 or (m ->> 'employee_code' is not null and upper(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'employee_code' limit 1)) = m ->> 'employee_code'))) then
      errs := array_append(errs, 'Duplicate of another row in this file'::text);
    end if;
    update public.employee_import_rows
       set data = m, errors = errs, status = case when cardinality(errs) = 0 then 'valid' else 'error' end
     where id = r.id;
  end loop;

  update public.employee_import_batches b2
     set status = 'validated', column_mapping = p_mapping, validated_at = now(),
         total_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch),
         valid_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch and status = 'valid'),
         error_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch and status = 'error'),
         verified_by = null, verified_at = null
   where b2.id = p_batch;
  return (select jsonb_build_object('total', total_rows, 'valid', valid_rows, 'errors', error_rows)
          from public.employee_import_batches where id = p_batch);
end $$;

-- Hubs / positions the validated rows name but that do not exist yet.
create or replace function public.hr_import_missing(p_batch uuid)
returns table (kind text, name text, row_count integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.employee_import_batches b where b.id = p_batch
                   and (b.created_by = auth.uid() or private.has_permission('hr.import.approve'))) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select x.k, x.n, count(*)::int from (
    select 'hub'::text k, coalesce(r.data ->> 'hub_code', r.data ->> 'hub_name') n
      from public.employee_import_rows r
     where r.batch_id = p_batch and (r.data ? 'hub_code' or r.data ? 'hub_name') and not (r.data ? '_hub')
    union all
    select 'position', coalesce(r.data ->> 'position_code', r.data ->> 'position_name')
      from public.employee_import_rows r
     where r.batch_id = p_batch and (r.data ? 'position_code' or r.data ? 'position_name') and not (r.data ? '_position')
    union all
    select 'department', coalesce(r.data ->> 'department_code', r.data ->> 'department_name')
      from public.employee_import_rows r
     where r.batch_id = p_batch and (r.data ? 'department_code' or r.data ? 'department_name') and not (r.data ? '_department')
  ) x
  group by x.k, x.n order by x.k, x.n;
end $$;

-- Creates the missing hubs (in p_zone), departments and positions (in p_department), then
-- the caller validates again. Uses the normal org permissions.
create or replace function public.hr_import_create_missing(p_batch uuid, p_zone uuid, p_department uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype; x record; v_code text; n_hub int := 0; n_pos int := 0; n_dept int := 0; v_org uuid;
begin
  select * into b from public.employee_import_batches where id = p_batch;
  if b.id is null or (b.created_by <> auth.uid() and not private.has_permission('hr.import.approve')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','validated') then raise exception 'Batch is already %.', b.status using errcode = 'P0001'; end if;
  select organization_id into v_org from public.zones where id = p_zone;
  if v_org is null then select id into v_org from public.organizations order by created_at limit 1; end if;
  for x in select * from public.hr_import_missing(p_batch) loop
    v_code := upper(left(regexp_replace(x.name, '[^A-Za-z0-9]+', '', 'g'), 12));
    if v_code = '' or exists (select 1 from public.hubs where code = v_code::extensions.citext)
       or exists (select 1 from public.positions where code = v_code::extensions.citext)
       or exists (select 1 from public.departments where code = v_code::extensions.citext) then
      v_code := v_code || upper(substr(md5(random()::text), 1, 4));
    end if;
    if x.kind = 'hub' then
      if p_zone is null then raise exception 'Choose the zone for the new hubs.' using errcode = '22023'; end if;
      if not private.has_permission('org.hub.create', p_zone) then raise exception 'Not authorised to create hubs in this zone.' using errcode = '42501'; end if;
      insert into public.hubs (zone_id, code, name) values (p_zone, v_code, trim(x.name)); n_hub := n_hub + 1;
    elsif x.kind = 'department' then
      if not private.has_permission('org.department.create') then raise exception 'Not authorised to create departments.' using errcode = '42501'; end if;
      insert into public.departments (organization_id, code, name) values (v_org, v_code, trim(x.name)); n_dept := n_dept + 1;
    else
      if not private.has_permission('org.position.create') then raise exception 'Not authorised to create positions.' using errcode = '42501'; end if;
      insert into public.positions (department_id, code, name) values (p_department, v_code, trim(x.name)); n_pos := n_pos + 1;
    end if;
  end loop;
  return jsonb_build_object('hubs', n_hub, 'positions', n_pos, 'departments', n_dept);
end $$;

create or replace function public.hr_verify_import(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.employee_import_batches%rowtype;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.status <> 'validated' then raise exception 'Validate the batch first.' using errcode = 'P0001'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve' or g.is_super) then
    raise exception 'Not authorised to verify imports.' using errcode = '42501';
  end if;
  if b.created_by = auth.uid() and not private.is_super_admin()
     and coalesce((select value from public.system_settings where key = 'hr.import_two_person'), 'true'::jsonb) = 'true'::jsonb then
    raise exception 'The uploader cannot verify their own import.' using errcode = '42501';
  end if;
  update public.employee_import_batches set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_batch;
end $$;

create or replace function public.hr_commit_import(p_batch uuid, p_skip_invalid boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record; d jsonb; v_emp uuid; v_code text; n_active int := 0; n_app int := 0; v_join date; cf record; v_warn text[];
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.status <> 'verified' then raise exception 'Only verified batches can be committed.' using errcode = 'P0001'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.error_rows > 0 and not p_skip_invalid then
    raise exception '% row(s) have errors. Fix the file, or explicitly choose to skip invalid rows (they stay listed in the error report).', b.error_rows
      using errcode = 'P0001';
  end if;
  perform set_config('app.change_reason', 'Imported (batch ' || b.file_name || ')', true);

  for r in select * from public.employee_import_rows where batch_id = p_batch and status = 'valid' order by row_number loop
    d := r.data; v_warn := '{}';
    v_code := d ->> 'employee_code';
    v_join := private.parse_date_bd(d ->> 'joining_date');
    insert into public.employees (employee_code, full_name, full_name_bn, mobile, email, emergency_contact_name, emergency_contact_phone,
                                  hub_id, zone_id, department_id, position_id, joining_date, status, status_since, created_by)
    values (v_code, d ->> 'full_name', d ->> 'full_name_bn', d ->> 'mobile', d ->> 'email', d ->> 'emergency_contact_name', d ->> 'emergency_contact_phone',
            (d ->> '_hub')::uuid, (select zone_id from public.hubs where id = (d ->> '_hub')::uuid),
            (d ->> '_department')::uuid, (d ->> '_position')::uuid,
            v_join, case when v_code is null then 'applicant' else 'active' end, coalesce(v_join, current_date), b.created_by)
    returning id into v_emp;
    if d ?| array['nid_number','date_of_birth','father_name','mother_name','present_address','permanent_address'] then
      insert into public.employee_sensitive (employee_id, nid_number, date_of_birth, father_name, mother_name, present_address, permanent_address)
      values (v_emp, d ->> 'nid_number', private.parse_date_bd(d ->> 'date_of_birth'), d ->> 'father_name', d ->> 'mother_name',
              d ->> 'present_address', d ->> 'permanent_address');
    end if;
    if d ? 'basic_salary' then
      insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, reason,
                                                status, approved_by, approved_at, created_by)
      values (v_emp, coalesce(v_join, current_date), (d ->> 'basic_salary')::numeric, coalesce((d ->> 'transport_allowance')::numeric, 0),
              coalesce((d ->> 'commission')::numeric, 0), 'Imported (batch ' || b.file_name || ')',
              case when v_code is null then 'pending' else 'approved' end,
              case when v_code is null then null else b.verified_by end,
              case when v_code is null then null else now() end, b.created_by);
    end if;
    for cf in select substr(x.key, 4) as code, x.value from jsonb_each(d) x where x.key like 'cf:%' loop
      begin
        insert into public.employee_custom_field_values (employee_id, field_id, value, created_by)
        values (v_emp, (select c.id from public.employee_custom_fields c where c.code = cf.code::extensions.citext), cf.value, b.created_by);
      exception when others then
        v_warn := array_append(v_warn, 'Not saved: ' || cf.code || ' (' || sqlerrm || ')');
      end;
    end loop;
    if v_code is null then
      insert into public.employee_applications (employee_id, status, submitted_by, submitted_at, created_by)
      values (v_emp, 'submitted', b.created_by, now(), b.created_by);
      n_app := n_app + 1;
    else
      insert into public.employee_assignments (employee_id, change_type, department_id, position_id, zone_id, hub_id, effective_from, reason)
      select e.id, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, coalesce(v_join, current_date), 'Imported'
      from public.employees e where e.id = v_emp;
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (v_emp, null, 'active', coalesce(v_join, current_date), 'Imported, verified by HR');
      n_active := n_active + 1;
    end if;
    update public.employee_import_rows set status = 'imported', employee_id = v_emp, errors = v_warn where id = r.id;
  end loop;

  -- referrers last, so a referrer imported in the same file is found
  update public.employees e
     set referred_by_employee_id = ref.id
    from public.employee_import_rows ir
    join public.employees ref on ref.employee_code = upper(ir.data ->> 'reference_code')::extensions.citext
   where ir.batch_id = p_batch and ir.status = 'imported' and ir.employee_id = e.id and ref.id <> e.id;

  update public.employee_import_rows set status = 'skipped' where batch_id = p_batch and status = 'error';
  update public.employee_import_batches set status = 'committed', committed_by = auth.uid(), committed_at = now() where id = p_batch;
  return jsonb_build_object('activated', n_active, 'awaiting_employee_id', n_app, 'skipped', b.error_rows);
end $$;

-- Lets the importer cancel a batch they do not want.
create or replace function public.hr_cancel_import(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.employee_import_batches%rowtype;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.id is null or (b.created_by <> auth.uid() and not private.has_permission('hr.import.approve')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status = 'committed' then raise exception 'A saved import cannot be cancelled.' using errcode = 'P0001'; end if;
  update public.employee_import_batches set status = 'cancelled' where id = p_batch;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.hr_import_missing(uuid)', 'public.hr_import_create_missing(uuid, uuid, uuid)',
                           'public.hr_cancel_import(uuid)', 'public.hr_validate_import(uuid, jsonb)',
                           'public.hr_verify_import(uuid)', 'public.hr_commit_import(uuid, boolean)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.find_hub(text, text), private.find_position(text, text), private.find_department(text, text),
                       private.import_custom_value(uuid, text) from public, anon;

-- ===== 20261113001800_fields_and_referrals.sql =====
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

-- ===== 20261113001900_formats_and_zonal.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0019: export/import formats + zonal staff dashboard
--
--  * employee_formats: a named, ordered list of columns ("format") the company can set up
--    for exporting and importing staff. Head Office makes company formats, a Zonal Manager
--    makes formats for their own zone. Column headings are the company's own words.
--  * hr_export_rows: rows for an export, built from the chosen columns. Every employee is
--    filtered by hr.employee.view for their zone/hub; NID and other private details only
--    for those allowed to see them (and that export is written to the audit log); salary
--    only with hr.compensation.view.
--  * hr_hub_staff_summary: hub-by-hub staff counts for the zonal dashboard.
--  * Imported staff with no ID wait as applicants; a Super Admin may now approve their
--    own submission, so a one-person office can still give them IDs.
--  * hr_next_employee_codes: the next free numeric IDs, for giving IDs to a whole hub.
-- =====================================================================

create table public.employee_formats (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid references public.zones(id),
  name        text not null check (length(trim(name)) > 0),
  name_bn     text,
  purpose     text not null default 'both' check (purpose in ('export','import','both')),
  columns     jsonb not null default '[]'::jsonb,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  constraint employee_formats_columns_chk check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) between 1 and 60)
);
create index employee_formats_zone_idx on public.employee_formats (zone_id);
create unique index employee_formats_name_uq
  on public.employee_formats (coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;

create trigger employee_formats_stamp before insert or update on public.employee_formats
  for each row execute function private.stamp_row();
create trigger employee_formats_audit after insert or update or delete on public.employee_formats
  for each row execute function private.audit_row('hr');
create trigger employee_formats_no_delete before delete on public.employee_formats
  for each row execute function private.prevent_delete();

-- The fields a format column may point at.
create or replace function private.export_field_ok(p_field text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_field = any (array[
    'employee_code','full_name','full_name_bn','mobile','email','hub_name','hub_code','zone_name',
    'department_name','position_name','status','joining_date','status_since',
    'basic_salary','transport_allowance','commission','referrer_code','referrer_name',
    'emergency_contact_name','emergency_contact_phone',
    'nid_number','date_of_birth','father_name','mother_name','present_address','permanent_address'])
  or (p_field like 'cf:%' and exists (
        select 1 from public.employee_custom_fields c
         where c.code = substr(p_field, 4)::extensions.citext and c.archived_at is null))
$$;

create or replace function private.format_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare col jsonb; bad text;
begin
  for col in select * from jsonb_array_elements(new.columns) loop
    if jsonb_typeof(col) <> 'object' or coalesce(col ->> 'field', '') = '' then
      raise exception 'Each column needs a field.' using errcode = '22023';
    end if;
    if not private.export_field_ok(col ->> 'field') then
      raise exception 'Unknown column: %.', col ->> 'field' using errcode = '22023';
    end if;
    if coalesce(trim(col ->> 'label'), '') = '' and coalesce(trim(col ->> 'label_bn'), '') = '' then
      raise exception 'Each column needs a heading.' using errcode = '22023';
    end if;
  end loop;
  select q.f into bad from (select e.value ->> 'field' f, count(*) c
                              from jsonb_array_elements(new.columns) e group by 1 having count(*) > 1) q limit 1;
  if bad is not null then
    raise exception 'Column % is listed twice.', bad using errcode = '22023';
  end if;
  -- only one default per zone (and one company-wide default)
  if new.is_default and new.archived_at is null then
    update public.employee_formats
       set is_default = false
     where id <> new.id and is_default
       and zone_id is not distinct from new.zone_id
       and purpose = new.purpose;
  end if;
  return new;
end $$;
create trigger employee_formats_guard before insert or update on public.employee_formats
  for each row execute function private.format_guard();

alter table public.employee_formats enable row level security;
revoke all on public.employee_formats from anon;
grant select, insert, update on public.employee_formats to authenticated;

create policy formats_read on public.employee_formats for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy formats_insert on public.employee_formats for insert to authenticated
  with check (private.has_permission('hr.profile_field.configure', zone_id));
create policy formats_update on public.employee_formats for update to authenticated
  using (private.has_permission('hr.profile_field.configure', zone_id))
  with check (private.has_permission('hr.profile_field.configure', zone_id));

insert into public.employee_formats (name, name_bn, purpose, is_default, columns) values
  ('Standard staff list', 'সাধারণ কর্মী তালিকা', 'both', true, '[
     {"field":"employee_code","label":"Employee ID","label_bn":"আইডি"},
     {"field":"full_name","label":"Name","label_bn":"নাম"},
     {"field":"position_name","label":"Position","label_bn":"পদবি"},
     {"field":"hub_name","label":"Hub","label_bn":"হাব"},
     {"field":"mobile","label":"Mobile","label_bn":"মোবাইল"},
     {"field":"status","label":"Status","label_bn":"অবস্থা"},
     {"field":"joining_date","label":"Joining date","label_bn":"যোগদান"}]'::jsonb),
  ('Salary sheet columns', 'বেতনের কলাম', 'both', false, '[
     {"field":"employee_code","label":"Employee ID","label_bn":"আইডি"},
     {"field":"full_name","label":"Name","label_bn":"নাম"},
     {"field":"hub_name","label":"Hub","label_bn":"হাব"},
     {"field":"position_name","label":"Position","label_bn":"পদবি"},
     {"field":"basic_salary","label":"Basic","label_bn":"মূল বেতন"},
     {"field":"transport_allowance","label":"Transport","label_bn":"যাতায়াত"},
     {"field":"commission","label":"Commission","label_bn":"কমিশন"}]'::jsonb)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Rows for an export, honouring every permission.
-- ---------------------------------------------------------------------
create or replace function public.hr_export_rows(
  p_fields text[], p_zone uuid default null, p_hub uuid default null,
  p_status text default null, p_q text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f text;
  v_rows jsonb;
  v_sensitive boolean := p_fields && array['nid_number','date_of_birth','father_name','mother_name','present_address','permanent_address'];
begin
  if auth.uid() is null or not exists (select 1 from private.my_grants()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_fields, 1), 0) = 0 then
    raise exception 'Choose at least one column.' using errcode = '22023';
  end if;
  if array_length(p_fields, 1) > 60 then
    raise exception 'Too many columns (60 at most).' using errcode = '22023';
  end if;
  foreach f in array p_fields loop
    if not private.export_field_ok(f) then
      raise exception 'Unknown column: %.', f using errcode = '22023';
    end if;
  end loop;

  select coalesce(jsonb_agg(q.obj order by q.ord nulls last, q.nm), '[]'::jsonb) into v_rows
  from (
    select e.employee_code::text as ord, e.full_name as nm,
           (select jsonb_object_agg(k, v.full_row -> k) from unnest(p_fields) k)
             || jsonb_build_object('_id', e.id::text) as obj
    from public.employees e
    left join public.hubs h on h.id = e.hub_id
    left join public.zones z on z.id = e.zone_id
    left join public.departments d on d.id = e.department_id
    left join public.positions p on p.id = e.position_id
    left join public.employees rf on rf.id = e.referred_by_employee_id
    left join public.employee_sensitive s on s.employee_id = e.id
    left join lateral (
      select c.basic_salary, c.transport_allowance, c.commission
        from public.employee_compensation c
       where c.employee_id = e.id and c.status = 'approved' and c.effective_from <= current_date
       order by c.effective_from desc limit 1) comp on true
    left join lateral (
      select jsonb_object_agg('cf:' || cf.code, cv.value) vals
        from public.employee_custom_field_values cv
        join public.employee_custom_fields cf on cf.id = cv.field_id
       where cv.employee_id = e.id and cf.archived_at is null
         and (cf.view_permission is null or private.has_permission(cf.view_permission, e.zone_id, e.hub_id))) cus on true
    cross join lateral (
      select jsonb_build_object(
        'employee_code', e.employee_code::text, 'full_name', e.full_name, 'full_name_bn', e.full_name_bn,
        'mobile', e.mobile, 'email', e.email::text,
        'hub_name', h.name, 'hub_code', h.code::text, 'zone_name', z.name,
        'department_name', d.name, 'position_name', p.name,
        'status', e.status, 'joining_date', e.joining_date, 'status_since', e.status_since,
        'referrer_code', rf.employee_code::text, 'referrer_name', rf.full_name,
        'emergency_contact_name', e.emergency_contact_name, 'emergency_contact_phone', e.emergency_contact_phone)
        || case when private.has_permission('hr.compensation.view', e.zone_id, e.hub_id)
             then jsonb_build_object('basic_salary', comp.basic_salary, 'transport_allowance', comp.transport_allowance,
                                     'commission', comp.commission) else '{}'::jsonb end
        || case when private.has_permission('hr.employee_sensitive.view', e.zone_id, e.hub_id)
             then jsonb_build_object('nid_number', s.nid_number, 'date_of_birth', s.date_of_birth,
                                     'father_name', s.father_name, 'mother_name', s.mother_name,
                                     'present_address', s.present_address, 'permanent_address', s.permanent_address)
             else '{}'::jsonb end
        || coalesce(cus.vals, '{}'::jsonb) as full_row) v
    where private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
      and (p_zone is null or e.zone_id = p_zone)
      and (p_hub is null or e.hub_id = p_hub)
      and (case when p_status = 'archived' then e.archived_at is not null
                when p_status is null or p_status = '' then e.archived_at is null
                else e.archived_at is null and e.status = p_status end)
      and (coalesce(trim(p_q), '') = '' or e.full_name ilike '%' || trim(p_q) || '%'
           or e.employee_code::text ilike '%' || trim(p_q) || '%' or e.mobile like '%' || trim(p_q) || '%')
    limit 5000
  ) q;

  if v_sensitive then
    perform private.write_audit('export', 'hr', 'employees', 'bulk', null,
      jsonb_build_object('fields', to_jsonb(p_fields), 'zone', p_zone, 'hub', p_hub, 'status', p_status,
                         'rows', jsonb_array_length(v_rows)),
      'Staff export including private details');
  end if;
  return v_rows;
end $$;

-- ---------------------------------------------------------------------
-- Hub-by-hub staff numbers (zonal dashboard)
-- ---------------------------------------------------------------------
create or replace function public.hr_hub_staff_summary(p_zone uuid default null)
returns table (hub_id uuid, hub_name text, zone_id uuid, zone_name text,
               total integer, active integer, inactive integer, applicant integer,
               without_id integer, with_login integer, by_position jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from private.my_grants()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select h.id, h.name, z.id, z.name,
         coalesce(c.total, 0), coalesce(c.active, 0), coalesce(c.inactive, 0), coalesce(c.applicant, 0),
         coalesce(c.without_id, 0), coalesce(c.with_login, 0), coalesce(q.map, '{}'::jsonb)
  from public.hubs h
  join public.zones z on z.id = h.zone_id
  left join lateral (
    select count(*)::int total,
           count(*) filter (where e.status = 'active')::int active,
           count(*) filter (where e.status = 'inactive')::int inactive,
           count(*) filter (where e.status = 'applicant')::int applicant,
           count(*) filter (where e.employee_code is null and e.status <> 'applicant')::int without_id,
           count(*) filter (where e.profile_id is not null)::int with_login
      from public.employees e
     where e.hub_id = h.id and e.archived_at is null) c on true
  left join lateral (
    select jsonb_object_agg(x.pos, x.c) map from (
      select p.name pos, count(*) c
        from public.employees e2 join public.positions p on p.id = e2.position_id
       where e2.hub_id = h.id and e2.archived_at is null and e2.status = 'active'
       group by p.name) x) q on true
  where h.archived_at is null
    and (p_zone is null or h.zone_id = p_zone)
    and private.has_permission('hr.employee.view', h.zone_id, h.id)
  order by z.name, h.name;
end $$;

-- ---------------------------------------------------------------------
-- Giving an Employee ID to imported staff
--
-- Imported staff with no ID in the file wait as applicants. Normally a second person
-- approves the application, but a company whose only administrator did the import could
-- never give them an ID. A Super Admin may therefore approve an application they
-- submitted themselves; for everyone else the two-person rule stands, and a company can
-- switch the exemption off with hr.application_two_person.
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('hr.application_two_person', 'true', 'A second person must approve an ID application (a Super Admin may approve their own)')
on conflict (key) do nothing;

create or replace function public.hr_approve_application(p_employee uuid, p_employee_code text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  a public.employee_applications%rowtype;
  v_code text := upper(trim(p_employee_code));
begin
  select * into e from public.employees where id = p_employee for update;
  select * into a from public.employee_applications where employee_id = p_employee for update;
  if not private.employee_has_permission('hr.application.approve', p_employee) then
    raise exception 'Not authorised to approve applications.' using errcode = '42501';
  end if;
  if a.status is distinct from 'submitted' then
    raise exception 'Only submitted applications can be approved (current: %).', coalesce(a.status, 'none') using errcode = 'P0001';
  end if;
  if a.submitted_by = auth.uid() and not private.is_super_admin() then
    raise exception 'The person who submitted an application cannot approve it.' using errcode = '42501';
  end if;
  if v_code is null or v_code !~ private.setting_text('hr.employee_code_pattern') then
    raise exception 'Employee ID "%" does not match the company format.', p_employee_code using errcode = '23514';
  end if;
  if exists (select 1 from public.employees where employee_code = v_code::extensions.citext) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  update public.employees
     set employee_code = v_code, status = 'active', status_since = coalesce(joining_date, current_date)
   where id = p_employee;
  update public.employee_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where employee_id = p_employee;
  insert into public.employee_assignments
    (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
  values (p_employee, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id,
          coalesce(e.joining_date, current_date), 'Application approved');
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, 'applicant', 'active', coalesce(e.joining_date, current_date), coalesce(p_note, 'Application approved'));
  update public.employee_compensation
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where employee_id = p_employee and status = 'pending';
end $$;

-- Next free numeric Employee IDs, so a whole hub can be given IDs in one go.
create or replace function public.hr_next_employee_codes(p_count integer)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare out_codes text[] := '{}'; v int; i int := 0;
begin
  if coalesce(p_count, 0) < 1 or p_count > 500 then
    raise exception 'Ask for between 1 and 500 IDs.' using errcode = '22023';
  end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.application.approve' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select coalesce(max(employee_code::text::int), 0) into v
    from public.employees where employee_code::text ~ '^[0-9]+$';
  while i < p_count loop
    v := v + 1;
    if not exists (select 1 from public.employees where employee_code = v::text::extensions.citext) then
      out_codes := array_append(out_codes, v::text); i := i + 1;
    end if;
  end loop;
  return out_codes;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.hr_export_rows(text[], uuid, uuid, text, text)',
                           'public.hr_hub_staff_summary(uuid)',
                           'public.hr_next_employee_codes(integer)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.export_field_ok(text) from public, anon;
grant execute on function private.export_field_ok(text) to authenticated;

-- ===== 20261113002000_role_dashboards.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0020: role-based dashboard
--
-- The home page is built from "panels". Which panels a person sees comes from
-- their roles: a Super Admin decides, role by role, what that role's dashboard
-- holds (role_dashboards). A panel is still only shown if the person's
-- permissions allow its contents, and every number is read as the person
-- themselves (security invoker + RLS), so nobody sees past their own scope.
--
--   dashboard_home()            -> panels + the numbers for them, in one call
--   role_dashboard_list()       -> every role with its panels (Super Admin)
--   role_dashboard_save()       -> set one role's panels (Super Admin)
--   private.dashboard_catalogue -> the panels that exist, and what each needs
-- =====================================================================

-- ---------------------------------------------------------------------
-- The catalogue of panels
-- ---------------------------------------------------------------------
create or replace function private.dashboard_catalogue()
returns table (panel text, needs text[])
language sql immutable set search_path = '' as $$
  values
    ('my_work',        array[]::text[]),                                       -- anyone with a login
    ('hr_overview',    array['hr.employee.view']),
    ('hr_pending',     array['hr.application.view','hr.leave.approve','hr.compensation.approve','hr.document.verify']),
    ('hub_staff',      array['hr.employee.view']),
    ('ops_today',      array['ops.report.view','ops.parcel.view','ops.pickup.view','ops.delivery.view']),
    ('cash_today',     array['ops.cash.view','ops.rider_handover.approve','ops.expense.approve','ops.reconciliation.view']),
    ('accounts_today', array['da.sheet.view','da.report.view']),
    ('zonal_overview', array['zonal.dashboard.view','zonal.report.view']),
    ('quick_links',    array[]::text[])
$$;

create or replace function private.dashboard_panel_ok(p_panel text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from private.dashboard_catalogue() c where c.panel = p_panel)
$$;

-- Does the caller have at least one of the permissions a panel needs?
create or replace function private.dashboard_panel_allowed(p_panel text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when coalesce(array_length((select c.needs from private.dashboard_catalogue() c where c.panel = p_panel), 1), 0) = 0
      then true
    else exists (
      select 1 from private.dashboard_catalogue() c, private.my_grants() g
       where c.panel = p_panel and (g.is_super or g.permission_code = any (c.needs)))
  end
$$;

-- ---------------------------------------------------------------------
-- What each role's dashboard holds
-- ---------------------------------------------------------------------
create table public.role_dashboards (
  role_id    uuid primary key references public.roles(id),
  panels     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint role_dashboards_panels_chk check (jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) <= 20)
);

create or replace function private.role_dashboard_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  for p in select jsonb_array_elements_text(new.panels) loop
    if not private.dashboard_panel_ok(p) then
      raise exception 'Unknown dashboard panel: %.', p using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct x) from jsonb_array_elements_text(new.panels) x) <> jsonb_array_length(new.panels) then
    raise exception 'The same panel is listed twice.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger role_dashboards_guard before insert or update on public.role_dashboards
  for each row execute function private.role_dashboard_guard();
create trigger role_dashboards_stamp before insert or update on public.role_dashboards
  for each row execute function private.stamp_row();
create trigger role_dashboards_audit after insert or update or delete on public.role_dashboards
  for each row execute function private.audit_row('system');

alter table public.role_dashboards enable row level security;
revoke all on public.role_dashboards from anon;
grant select, insert, update on public.role_dashboards to authenticated;

-- Everyone with a role may read the layouts (their own dashboard is built from them).
create policy role_dashboards_read on public.role_dashboards for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy role_dashboards_insert on public.role_dashboards for insert to authenticated
  with check (private.is_super_admin());
create policy role_dashboards_update on public.role_dashboards for update to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

-- Starting layouts for the roles that ship with the system. A Super Admin can
-- change any of these, and a role with no row falls back to its permissions.
insert into public.role_dashboards (role_id, panels)
select r.id, d.panels::jsonb
from public.roles r
join (values
  ('super_admin',        '["hr_overview","hub_staff","ops_today","cash_today","accounts_today","zonal_overview","my_work","quick_links"]'),
  ('admin',              '["hr_overview","hr_pending","ops_today","accounts_today","my_work","quick_links"]'),
  ('head_office_manager','["zonal_overview","hr_overview","ops_today","cash_today","accounts_today","quick_links"]'),
  ('zonal_manager',      '["zonal_overview","hub_staff","hr_pending","ops_today","accounts_today","my_work","quick_links"]'),
  ('hr_manager',         '["hr_overview","hr_pending","hub_staff","my_work","quick_links"]'),
  ('hub_manager',        '["ops_today","cash_today","hub_staff","accounts_today","my_work","quick_links"]'),
  ('operations_manager', '["ops_today","cash_today","hub_staff","my_work","quick_links"]'),
  ('delivery_manager',   '["ops_today","cash_today","my_work","quick_links"]'),
  ('pickup_manager',     '["ops_today","my_work","quick_links"]'),
  ('accounts_manager',   '["accounts_today","cash_today","my_work","quick_links"]'),
  ('accountant',         '["accounts_today","my_work","quick_links"]'),
  ('auditor',            '["hr_overview","accounts_today","ops_today","quick_links"]'),
  ('rider',              '["my_work","quick_links"]')
) as d(code, panels) on d.code = r.code::text
on conflict (role_id) do nothing;

-- ---------------------------------------------------------------------
-- The panels this person should see
-- ---------------------------------------------------------------------
create or replace function public.dashboard_panels()
returns text[]
language plpgsql stable security invoker set search_path = '' as $$
declare v_panels text[];
begin
  -- the panels their roles ask for, in catalogue order
  select array_agg(c.panel order by c.ord) into v_panels
  from (select c.panel, row_number() over () ord from private.dashboard_catalogue() c) c
  where private.dashboard_panel_allowed(c.panel)
    and exists (
      select 1 from public.user_roles ur
      join public.role_dashboards rd on rd.role_id = ur.role_id
      where ur.user_id = auth.uid() and ur.revoked_at is null
        and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
        and rd.panels ? c.panel);

  -- a role with no layout of its own: fall back to whatever their permissions allow
  if coalesce(array_length(v_panels, 1), 0) = 0 then
    select array_agg(c.panel order by c.ord) into v_panels
    from (select c.panel, row_number() over () ord from private.dashboard_catalogue() c) c
    where private.dashboard_panel_allowed(c.panel);
  end if;
  return coalesce(v_panels, array['my_work','quick_links']);
end $$;

-- ---------------------------------------------------------------------
-- The dashboard itself: only the panels this person has, with their numbers.
-- security invoker — every count is read as the person, under RLS.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_home()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_panels text[] := public.dashboard_panels();
  v_me     uuid   := private.my_employee_id();
  v_today  date   := (now() at time zone private.setting_text('system.timezone'))::date;
  v_out    jsonb  := jsonb_build_object('panels', to_jsonb(v_panels), 'today', v_today);
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  v_out := v_out || jsonb_build_object('me', (
    select jsonb_build_object('employee_code', e.employee_code::text, 'name', e.full_name,
                              'hub', h.name, 'zone', z.name, 'position', p.name)
      from public.employees e
      left join public.hubs h on h.id = e.hub_id
      left join public.zones z on z.id = e.zone_id
      left join public.positions p on p.id = e.position_id
     where e.id = v_me));

  if 'my_work' = any (v_panels) then
    v_out := v_out || jsonb_build_object('my_work', jsonb_build_object(
      'tasks_open',     (select count(*) from public.tasks t
                          where t.assigned_to = auth.uid() and t.status in ('assigned','in_progress')),
      'tasks_due',      (select count(*) from public.tasks t
                          where t.assigned_to = auth.uid() and t.status in ('assigned','in_progress') and t.due_date <= v_today),
      'tasks_to_check', (select count(*) from public.tasks t
                          where t.accountable_manager_id = auth.uid() and t.status = 'submitted'),
      'leave_pending',  (select count(*) from public.leave_requests l where l.employee_id = v_me and l.status = 'pending'),
      'marked_today',   (select exists (select 1 from public.attendance_records a
                                         where a.employee_id = v_me and a.work_date = v_today))));
  end if;

  if 'hr_overview' = any (v_panels) then
    v_out := v_out || jsonb_build_object('hr_overview', (
      select jsonb_build_object(
        'total',      count(*) filter (where e.status in ('active','inactive')),
        'active',     count(*) filter (where e.status = 'active'),
        'inactive',   count(*) filter (where e.status = 'inactive'),
        'applicant',  count(*) filter (where e.status = 'applicant'),
        'joined_30d', count(*) filter (where e.joining_date >= v_today - 30 and e.status <> 'applicant'),
        'left_30d',   count(*) filter (where e.status in ('resigned','terminated') and e.status_since >= v_today - 30))
      from public.employees e where e.archived_at is null));
  end if;

  if 'hr_pending' = any (v_panels) then
    v_out := v_out || jsonb_build_object('hr_pending', jsonb_build_object(
      'applications', (select count(*) from public.employee_applications a where a.status = 'submitted'),
      'leave',        (select count(*) from public.leave_requests l where l.status = 'pending'),
      'salary',       (select count(*) from public.employee_compensation c where c.status = 'pending'),
      'documents',    (select count(*) from public.employee_documents d where d.verified_at is null and d.archived_at is null)));
  end if;

  if 'hub_staff' = any (v_panels) then
    v_out := v_out || jsonb_build_object('hub_staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'hub_id', s.hub_id, 'hub', s.hub_name, 'zone', s.zone_name, 'total', s.total,
               'active', s.active, 'inactive', s.inactive, 'applicant', s.applicant)
             order by s.zone_name, s.hub_name), '[]'::jsonb)
      from public.hr_hub_staff_summary() s));
  end if;

  if 'ops_today' = any (v_panels) then
    v_out := v_out || jsonb_build_object('ops_today', jsonb_build_object(
      'at_hub',            (select count(*) from public.parcels p where p.status = 'at_hub'),
      'out_for_delivery',  (select count(*) from public.parcels p where p.status = 'out_for_delivery'),
      'received_today',    (select count(*) from public.parcels p where p.received_date = v_today),
      'pickups_waiting',   (select count(*) from public.pickup_submissions s where s.status in ('submitted','verified')),
      'deliveries_waiting',(select count(*) from public.delivery_records d where d.status = 'pending'),
      'issues_open',       (select count(*) from public.parcel_issues i where i.status in ('open','assigned'))));
  end if;

  if 'cash_today' = any (v_panels) then
    v_out := v_out || jsonb_build_object('cash_today', jsonb_build_object(
      'handovers_waiting',  (select count(*) from public.cash_handovers h where h.status = 'submitted'),
      'expenses_waiting',   (select count(*) from public.operational_expenses e where e.status = 'pending'),
      'payments_waiting',   (select count(*) from public.merchant_payments m where m.status = 'pending'),
      'recons_waiting',     (select count(*) from public.cash_reconciliations r where r.status = 'submitted'),
      'collected_today',    (select coalesce(sum(d.cod_collected), 0) from public.delivery_records d
                              where d.delivery_date = v_today and d.status = 'approved')));
  end if;

  if 'accounts_today' = any (v_panels) then
    v_out := v_out || jsonb_build_object('accounts_today', (
      select jsonb_build_object(
        'open',       count(*) filter (where s.status = 'open'),
        'submitted',  count(*) filter (where s.status = 'submitted'),
        'correction', count(*) filter (where s.status = 'correction'),
        'approved',   count(*) filter (where s.status = 'approved'),
        'hubs',       count(distinct s.hub_id))
      from public.da_sessions s where s.account_date = v_today));
  end if;

  if 'zonal_overview' = any (v_panels) then
    v_out := v_out || jsonb_build_object('zonal_overview', jsonb_build_object(
      'zones',          (select count(*) from public.zones z where z.archived_at is null),
      'hubs',           (select count(*) from public.hubs h where h.archived_at is null),
      'staff',          (select count(*) from public.employees e where e.archived_at is null and e.status = 'active'),
      'tasks_open',     (select count(*) from public.tasks t where t.status in ('assigned','in_progress')),
      'tasks_overdue',  (select count(*) from public.tasks t where t.status in ('assigned','in_progress') and t.due_date < v_today),
      'claims_waiting', (select count(*) from public.travel_claims c where c.status = 'submitted'),
      'metrics_waiting',(select count(*) from public.hub_daily_metrics m where m.status = 'submitted')));
  end if;

  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- Setting the layouts (Super Admin)
-- ---------------------------------------------------------------------
create or replace function public.role_dashboard_list()
returns table (role_id uuid, code text, name text, name_bn text, is_super boolean, panels jsonb, user_count integer)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code::text, r.name, r.name_bn, r.is_super,
         coalesce(d.panels, '[]'::jsonb),
         (select count(*)::int from public.user_roles ur where ur.role_id = r.id and ur.revoked_at is null)
  from public.roles r
  left join public.role_dashboards d on d.role_id = r.id
  where r.archived_at is null and private.is_super_admin()
  order by r.is_super desc, r.name
$$;

create or replace function public.role_dashboard_save(p_role uuid, p_panels text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can set what a role sees on its dashboard.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role and r.archived_at is null) then
    raise exception 'Role not found.' using errcode = '22023';
  end if;
  foreach p in array coalesce(p_panels, '{}') loop
    if not private.dashboard_panel_ok(p) then
      raise exception 'Unknown dashboard panel: %.', p using errcode = '22023';
    end if;
  end loop;
  insert into public.role_dashboards (role_id, panels)
  values (p_role, to_jsonb(coalesce(p_panels, '{}')))
  on conflict (role_id) do update set panels = excluded.panels;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.dashboard_home()', 'public.dashboard_panels()',
                           'public.role_dashboard_list()', 'public.role_dashboard_save(uuid, text[])']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.dashboard_catalogue(), private.dashboard_panel_ok(text),
                      private.dashboard_panel_allowed(text) from public, anon;
grant execute on function private.dashboard_catalogue(), private.dashboard_panel_ok(text),
                         private.dashboard_panel_allowed(text) to authenticated;

-- ===== 20261113002100_expense_categories_voucher.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0021: the company's expense categories + expense vouchers
--
--  * da.expense_categories now carries the company's own list (the categories
--    handbook): what belongs in each category, and what to do with it on the
--    main site — its category there, the sub-head, the limit, whether a receipt
--    is needed, or that it does not go to the main site at all. Head Office can
--    change every line of this from Accounts settings.
--  * An expense whose shop or payee gave no bill can be given a voucher number
--    (da_make_voucher) and printed as the company's own voucher. Nothing is
--    generated on its own: a person asks for it, and an expense that already has
--    a bill does not get one.
-- =====================================================================

update public.system_settings
   set value = '[
  {"code":"bank_charge","en":"Bank Charge","bn":"ব্যাংক চার্জ",
   "note_bn":"ব্যাংক ডিপোজিট চার্জ বাবদ খরচ।",
   "site_name":"Bank Charge","site_sub":"Bank Fee","site_limit":500,"site_receipt":true},
  {"code":"meal","en":"Canteen Expense","bn":"ক্যান্টিন খরচ",
   "note_bn":"ড্রাইভার-হেল্পারের লাঞ্চ বিল বাবদ।",
   "site_name":"Canteen Expense","site_sub":"Canteen","site_limit":105000,"site_receipt":true},
  {"code":"cleaning","en":"Cleaning & Sanitation","bn":"পরিচ্ছন্নতা",
   "note_bn":"ঝাড়ু, মপ, ফ্লোর ক্লিনার, টয়লেট ক্লিনার, হারপিক, হ্যান্ডওয়াশ, টিস্যু, ময়লার ব্যাগ ও পরিচ্ছন্নতার সামগ্রী।",
   "site_name":"Cleaning & Sanitation","site_sub":"Cleaning","site_limit":500,"site_receipt":true},
  {"code":"entertainment","en":"Entertainment","bn":"আপ্যায়ন",
   "note_bn":"অতিথি/ক্লায়েন্ট আপ্যায়ন, অফিসিয়াল মিটিংয়ের চা-নাশতা এবং অনুমোদিত অফিসিয়াল অনুষ্ঠান।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"festival_bonus","en":"Festival Bonus","bn":"উৎসব বোনাস",
   "note_bn":"ঈদ বোনাস বাবদ খরচ।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"fuel","en":"Fuel Cost","bn":"জ্বালানি",
   "note_bn":"অফিসের গাড়ি ফুয়েল বাবদ খরচ।",
   "site_name":"Fuel Cost","site_sub":"Vehicle Fuel Cost","site_limit":null,"site_receipt":true},
  {"code":"hr_treatment","en":"H.R Treatment","bn":"চিকিৎসা",
   "note_bn":"কর্মীদের চিকিৎসা খরচ, ডাক্তার ফি, ওষুধ ও অনুমোদিত মেডিকেল বিল; প্রতিষ্ঠানের HR নীতিমালা অনুযায়ী।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"internet","en":"Internet Bill","bn":"ইন্টারনেট বিল",
   "note_bn":"অফিসের ব্রডব্যান্ড বিল, ইন্টারনেট প্যাকেজ ও অফিসিয়াল ডেটা কানেকশন।",
   "site_name":"Internet Bill","site_sub":"Internet Bill","site_limit":1500,"site_receipt":true},
  {"code":"labour_wages","en":"Labour Wages","bn":"শ্রমিক মজুরি",
   "note_bn":"দৈনিক মজুরিভিত্তিক/অস্থায়ী শ্রমিকের মজুরি, লোডিং-আনলোডিং শ্রমিকের পারিশ্রমিক।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"vehicle_parts","en":"Motor Vehicle Parts","bn":"গাড়ির পার্টস",
   "note_bn":"শুধু মাত্র গাড়ি সার্ভিসিং এর জন্য যে সকল পার্টস ক্রয় বা ফিটিং করা বাবদ খরচ।",
   "site_name":"Motor Vehicle Parts","site_sub":"Parts","site_limit":null,"site_receipt":true},
  {"code":"office","en":"Office And Hub Material","bn":"অফিস ও হাব মালামাল",
   "note_bn":"অফিস ও হাবের মালামাল কেনা বাবদ খরচ।",
   "site_name":"Office And Hub Material","site_sub":"Hub Material","site_limit":null,"site_receipt":true},
  {"code":"office_rent","en":"Office Rent","bn":"অফিস ভাড়া",
   "note_bn":"অফিস/হাব ভাড়া, রাইডার-ম্যানেজারদের বাসা ভাড়া এবং অফিসের অগ্রিম বা জামানত বাবদ খরচ।",
   "site_name":"Office Rent","site_sub":"Office Rent","site_limit":null,"site_receipt":true},
  {"code":"others_rental","en":"Others Rental Expense","bn":"অন্যান্য ভাড়া",
   "note_bn":"গ্যারেজ ভাড়া, অটো চার্জ বা গাড়ি পার্কিং বাবদ খরচ।",
   "site_name":"Others Rental Expense","site_sub":"Others Rental Expense","site_limit":null,"site_receipt":true},
  {"code":"conveyance","en":"Others Transport Cost","bn":"অন্যান্য ট্রান্সপোর্ট",
   "note_bn":"জোনাল/ডিভিশনাল বা অডিট এর যাবতীয় লাঞ্চ এবং ট্রান্সপোর্ট খরচ।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"penalties","en":"Penalties Motor Vehicle","bn":"গাড়ির জরিমানা",
   "note_bn":"গাড়ি/অটো ট্রাফিক মামলা বা অনুমোদিত জরিমানা বা পুলিশ রেকার বিল ইত্যাদি।",
   "site_name":"Penalties Motor Vehicle","site_sub":"Vehicle Mamla Purpose","site_limit":null,"site_receipt":true},
  {"code":"stationery","en":"Printing & Stationery","bn":"ছাপা ও স্টেশনারি",
   "note_bn":"কাগজ, কলম, খাতা, ফাইল, খাম, প্রিন্ট/ফটোকপি, টোনার ও প্রিন্টার কালি।",
   "site_name":"Printing & Stationery","site_sub":"Stationery","site_limit":null,"site_receipt":true},
  {"code":"repair","en":"Repairs And Maintenance","bn":"মেরামত ও রক্ষণাবেক্ষণ",
   "note_bn":"অফিসের অটো সার্ভিসিং, অফিসের বাইক সার্ভিসিং এবং গাড়ির ছোটখাটো মেরামত/রক্ষণাবেক্ষণ খরচ।",
   "site_name":"Repairs And Maintenance","site_sub":"Repairs And Maintenance","site_limit":null,"site_receipt":true},
  {"code":"salary_wages","en":"Salary & Wages","bn":"বেতন ও মজুরি",
   "note_bn":"নিয়মিত কর্মীদের মাসিক বেতন, নিয়মিত মজুরি, অনুমোদিত ওভারটাইম ও বেতন-সংশ্লিষ্ট পরিশোধ।",
   "site_name":"Salary & Wages","site_sub":"Salary /Wages","site_limit":null,"site_receipt":true},
  {"code":"telephone","en":"Telephone Bill","bn":"টেলিফোন বিল",
   "note_bn":"অফিসের মোবাইল/ল্যান্ডফোন বিল, সিম রিচার্জ ও অফিসিয়াল কল চার্জ।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"toll","en":"Toll Cost","bn":"টোল",
   "note_bn":"টোল প্লাজা, সেতু ও এক্সপ্রেসওয়ের অনুমোদিত টোল ফি।",
   "site_name":"Toll Cost","site_sub":"Toll Cost","site_limit":130000,"site_receipt":true},
  {"code":"transport","en":"Transport","bn":"যাতায়াত",
   "note_bn":"পার্সেল ডেলিভারি, ব্যাকআপ রাইডার এবং ম্যানেজার যাতায়াত বাবদ খরচ।",
   "site_name":"Transport","site_sub":"All Hub","site_limit":3000,"site_receipt":true},
  {"code":"utilities","en":"Utility Bill","bn":"ইউটিলিটি বিল",
   "note_bn":"বিদ্যুৎ, পানি, গ্যাস এবং অফিসের অন্যান্য ইউটিলিটি বিল।",
   "site_name":"Utility Bill","site_sub":"Utility Bill","site_limit":30000,"site_receipt":true},
  {"code":"wrong_delivery","en":"Wrong Delivery (Parcel Problem)","bn":"ভুল ডেলিভারি (পার্সেল সমস্যা)",
   "note_bn":"ভুল ডেলিভারি বা পার্সেল সমস্যার কারণে যে খরচ হয়।",
   "site_name":"Wrong Delivery (Parcel Problem)","site_sub":"Wrong Delivery (Parcel Problem)","site_limit":null,"site_receipt":true},
  {"code":"other","en":"Miscellaneous Expenses","bn":"বিবিধ খরচ",
   "note_bn":"উপরের কোনোটিতে না পড়লে এখানে দিন — বিবরণে খরচের আসল নাম লিখুন।",
   "site_name":"Miscellaneous Expenses","site_sub":"Miscellaneous Expenses","site_limit":null,"site_receipt":true}
]'::jsonb,
       description = 'Daily accounts: expense categories — what belongs in each, and what to do with it on the main site'
 where key = 'da.expense_categories';

-- ---------------------------------------------------------------------
-- The company's own voucher, for an expense with no bill from the payee
-- ---------------------------------------------------------------------
alter table public.da_expenses add column if not exists voucher_no text;
create unique index if not exists da_expenses_voucher_uq
  on public.da_expenses (lower(voucher_no)) where voucher_no is not null;
create sequence if not exists public.da_voucher_seq;

create or replace function public.da_make_voucher(p_expense uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  x public.da_expenses%rowtype;
  s public.da_sessions;
  v_no text;
begin
  select * into x from public.da_expenses where id = p_expense and removed_at is null for update;
  if x.id is null then raise exception 'Expense line not found.' using errcode = 'P0002'; end if;
  s := private.da_require_edit(x.session_id);
  if x.voucher_no is not null then return x.voucher_no; end if;
  if x.attachment_path is not null or nullif(trim(coalesce(x.bill_no, '')), '') is not null then
    raise exception 'This expense already has a bill, so it needs no voucher.' using errcode = '22023';
  end if;
  v_no := 'V-' || to_char(private.da_today(), 'YYMM') || '-' || lpad(nextval('public.da_voucher_seq')::text, 5, '0');
  update public.da_expenses set voucher_no = v_no where id = p_expense;
  perform private.da_event(x.session_id, 'note', 'Voucher ' || v_no || ' made for expense: ' || x.expense_name, false);
  return v_no;
end $$;

-- Everything a printed voucher shows, read as the person themselves.
create or replace function public.da_voucher(p_expense uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_out jsonb;
begin
  select jsonb_build_object(
    'voucher_no', x.voucher_no, 'expense_no', x.no, 'amount', x.amount, 'bill_date', x.bill_date,
    'expense_name', x.expense_name, 'category', x.category, 'kind', x.kind, 'remarks', x.remarks,
    'employee_code', x.employee_code, 'employee_name', x.employee_name,
    'paid_by_name', x.paid_by_name, 'reference_no', x.reference_no,
    'hub', h.name, 'hub_code', h.code::text, 'zone', z.name,
    'account_date', s.account_date, 'sheet_no', s.no,
    'made_by', coalesce(p.full_name, p.email::text), 'made_at', now())
    into v_out
  from public.da_expenses x
  join public.da_sessions s on s.id = x.session_id
  join public.hubs h on h.id = x.hub_id
  join public.zones z on z.id = x.zone_id
  left join public.profiles p on p.id = auth.uid()
  where x.id = p_expense and x.removed_at is null;
  if v_out is null then raise exception 'Expense line not found.' using errcode = 'P0002'; end if;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.da_make_voucher(uuid)', 'public.da_voucher(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant usage on sequence public.da_voucher_seq to authenticated;

-- ---------------------------------------------------------------------
-- A merchant cash payment from the Payment ID alone
--
-- The screenshot of the main site's payment page carries the Payment ID and the
-- amount, so those two are all a person has to put in. The merchant, the payee
-- and the date come from the hub's own payment record for that Payment ID. When
-- no such record exists the merchant must still be chosen by hand, because a
-- payment with nobody against it is not a record worth keeping.
-- ---------------------------------------------------------------------
alter table public.da_merchant_payments alter column merchant_id drop not null;
alter table public.da_merchant_payments add column if not exists payee_name text;

create or replace function public.da_save_merchant_payment(
  p_session uuid, p_merchant uuid, p_payment_ref text, p_transaction_id text, p_amount numeric, p_payment_date date,
  p_screenshot_path text default null, p_ocr jsonb default null, p_ocr_verified boolean default false,
  p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s  public.da_sessions := private.da_require_edit(p_session);
  m  public.merchants;
  mp public.merchant_payments;
  v_match text := 'unmatched';
  v_date date := p_payment_date;
  v_name text;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be greater than zero.' using errcode = '22023';
  end if;

  -- the hub's own record for this Payment ID fills in the rest
  if nullif(trim(p_payment_ref), '') is not null then
    select * into mp from public.merchant_payments
     where hub_id = s.hub_id and upper(payment_no) = upper(trim(p_payment_ref));
  end if;

  if p_merchant is not null then
    select * into m from public.merchants where id = p_merchant and archived_at is null;
    if m.id is null or m.hub_id <> s.hub_id then
      raise exception 'Choose a merchant of this hub.' using errcode = '22023';
    end if;
  elsif mp.id is not null then
    select * into m from public.merchants where id = mp.merchant_id;
  else
    raise exception 'This Payment ID has no record in this hub, so choose the merchant by hand.' using errcode = '22023';
  end if;

  v_date := coalesce(v_date, mp.payment_date, s.account_date);
  if v_date > private.da_today() then
    raise exception 'Payment date cannot be in the future.' using errcode = '22023';
  end if;
  v_name := coalesce(m.name, mp.merchant_id::text, '—');

  if p_transaction_id is not null and exists (select 1 from public.da_merchant_payments
       where lower(transaction_id) = lower(trim(p_transaction_id)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Transaction ID % is already recorded.', p_transaction_id using errcode = '23505';
  end if;
  if mp.id is not null then
    v_match := case when mp.merchant_id = m.id and mp.amount = p_amount then 'matched' else 'mismatch' end;
  end if;

  if p_line is null then
    insert into public.da_merchant_payments (session_id, hub_id, zone_id, merchant_id, merchant_name, payee_name, payment_ref, transaction_id,
      amount, payment_date, screenshot_path, ocr, ocr_verified, verified_by, match_status, matched_payment_id, remarks)
    values (s.id, s.hub_id, s.zone_id, m.id, v_name, nullif(trim(p_ocr ->> 'payee'), ''), nullif(trim(p_payment_ref), ''),
      nullif(trim(p_transaction_id), ''), p_amount, v_date, p_screenshot_path, p_ocr, coalesce(p_ocr_verified, false),
      case when p_ocr_verified then auth.uid() end, v_match, mp.id, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_merchant_payments set merchant_id = m.id, merchant_name = v_name,
      payee_name = coalesce(nullif(trim(p_ocr ->> 'payee'), ''), payee_name),
      payment_ref = nullif(trim(p_payment_ref), ''),
      transaction_id = nullif(trim(p_transaction_id), ''), amount = p_amount, payment_date = v_date,
      screenshot_path = coalesce(p_screenshot_path, screenshot_path), ocr = coalesce(p_ocr, ocr),
      ocr_verified = coalesce(p_ocr_verified, false), verified_by = case when p_ocr_verified then auth.uid() end,
      match_status = v_match, matched_payment_id = mp.id, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- What a Payment ID looks like on the main site, so the screenshot reader and the
-- form know what to expect. Head Office can change it from Accounts settings.
insert into public.system_settings (key, value, description) values
  ('da.payment_id_pattern', '"^[A-Z]{2,5}-[0-9]{4,}$"'::jsonb,
   'Daily accounts: what a main-site Payment ID looks like (regular expression)')
on conflict (key) do nothing;

-- ===== 20261113002200_branding.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0022: branding a person can change
--
-- The name, the short mark, the one-line description, the logo, the favicon and
-- the colour all sit in system_settings under branding.*, which anyone may read
-- before signing in (the login page needs them) and only someone with
-- system.settings.configure may write. Pictures are kept as data URLs and are
-- always shown through an <img>, never put into the page as markup, so a picture
-- can never run anything. The guard below holds that line in the database too.
-- =====================================================================

insert into public.system_settings (key, value, description, is_public) values
  ('branding.name_bn',    '"XZM-TEAM"', 'Name in Bangla', true),
  ('branding.short_name', '"X"',        'Short mark shown when there is no logo', true),
  ('branding.tagline',    '{"bn":"নিজের কাজের জন্য নিজের টুল","en":"My own tool for my own work"}',
                          'One line under the name', true),
  ('branding.logo',       '"data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27 role=%27img%27 aria-label=%27XZM-TEAM%27> <defs><linearGradient id=%27g%27 x1=%270%27 y1=%270%27 x2=%271%27 y2=%271%27> <stop offset=%270%27 stop-color=%27%2317A95B%27/><stop offset=%271%27 stop-color=%27%230A4D27%27/></linearGradient></defs> <rect width=%2764%27 height=%2764%27 rx=%2715%27 fill=%27url(%23g)%27/> <path d=%27M19.5 18.5 L44.5 45.5 M44.5 18.5 L19.5 45.5%27 stroke=%27%23ffffff%27 stroke-width=%277.5%27 stroke-linecap=%27round%27/> <path d=%27M12 52.5 h40%27 stroke=%27%23ffffff%27 stroke-opacity=%27.55%27 stroke-width=%273%27 stroke-linecap=%27round%27/> </svg>"', 'Logo as a data URL (SVG, PNG or JPEG)', true),
  ('branding.favicon',    '"data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27 role=%27img%27 aria-label=%27XZM-TEAM%27> <defs><linearGradient id=%27g%27 x1=%270%27 y1=%270%27 x2=%271%27 y2=%271%27> <stop offset=%270%27 stop-color=%27%2317A95B%27/><stop offset=%271%27 stop-color=%27%230A4D27%27/></linearGradient></defs> <rect width=%2764%27 height=%2764%27 rx=%2715%27 fill=%27url(%23g)%27/> <path d=%27M19.5 18.5 L44.5 45.5 M44.5 18.5 L19.5 45.5%27 stroke=%27%23ffffff%27 stroke-width=%277.5%27 stroke-linecap=%27round%27/> <path d=%27M12 52.5 h40%27 stroke=%27%23ffffff%27 stroke-opacity=%27.55%27 stroke-width=%273%27 stroke-linecap=%27round%27/> </svg>"', 'Browser tab icon as a data URL', true)
on conflict (key) do nothing;

-- Pictures: a data URL of a picture, nothing else, and nothing that could run.
create or replace function private.branding_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if new.key not in ('branding.logo', 'branding.favicon') then return new; end if;
  if jsonb_typeof(new.value) = 'null' then return new; end if;
  if jsonb_typeof(new.value) <> 'string' then
    raise exception 'The logo must be a picture address (data URL).' using errcode = '22023';
  end if;
  v := new.value #>> '{}';
  if v !~ '^data:image/(svg\+xml|png|jpeg|webp)[,;]' then
    raise exception 'Only an SVG, PNG, JPEG or WebP picture can be used here.' using errcode = '22023';
  end if;
  if length(v) > 262144 then
    raise exception 'The picture is too large (256 KB at most).' using errcode = '22023';
  end if;
  if v ~* '<script|javascript:|onload=|onerror=|onclick=|<foreignobject' then
    raise exception 'This picture carries something that can run, so it cannot be used.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger system_settings_branding_guard before insert or update on public.system_settings
  for each row execute function private.branding_guard();

-- Everything the login page and the app need, in one read, before sign-in.
create or replace function public.branding() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(replace(s.key, 'branding.', ''), s.value), '{}'::jsonb)
    from public.system_settings s
   where s.key like 'branding.%' and s.is_public
$$;

create or replace function public.branding_save(p_values jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb;
begin
  if not private.has_permission('system.settings.configure') then
    raise exception 'You are not allowed to change the branding.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_values) <> 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_values) loop
    if k not in ('company_name','name_bn','short_name','tagline','logo','favicon','theme','system_title',
                 'address','contact_phone','contact_email') then
      raise exception 'Unknown branding setting: %.', k using errcode = '22023';
    end if;
    insert into public.system_settings (key, value, description, is_public)
    values ('branding.' || k, v, 'Branding', true)
    on conflict (key) do update set value = excluded.value;
  end loop;
end $$;

revoke all on function public.branding() from public;
grant execute on function public.branding() to anon, authenticated;
revoke all on function public.branding_save(jsonb) from public, anon;
grant execute on function public.branding_save(jsonb) to authenticated;

-- ===== 20261113002300_vehicles_and_presets.sql =====
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

-- ===== 20261113002400_expense_claims.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0024: staff put up their own bills, the manager takes them in
--
-- A person adds the money they spent from their own page — what it was for, how
-- much, the bill or voucher, the vehicle it was for. It waits there as a claim.
-- The hub's sheet shows the claims of that hub, and the manager takes one in with
-- one click: it becomes an ordinary expense line on the day's sheet, and the claim
-- is marked as taken in, so the same bill cannot go in twice.
-- =====================================================================

create table public.da_expense_claims (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  employee_id        uuid not null references public.employees(id),
  employee_code      text,
  employee_name      text,
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  kind               text not null default 'employee' check (kind in ('transport','employee')),
  expense_name       text not null check (length(trim(expense_name)) > 1),
  category           text not null,
  amount             numeric(14,2) not null check (amount > 0),
  bill_date          date not null,
  bill_no            text,
  reference_no       text,
  reference_name     text,
  reference_phone    text,
  reference_position text,
  vehicle_id         uuid references public.vehicles(id),
  attachment_path    text,
  remarks            text,
  status             text not null default 'submitted' check (status in ('submitted','added','rejected','withdrawn')),
  session_id         uuid references public.da_sessions(id),
  expense_id         uuid references public.da_expenses(id),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz not null default now(), created_by uuid,
  updated_at         timestamptz not null default now(), updated_by uuid,
  constraint da_claim_path_chk check (attachment_path is null or attachment_path like 'claims/%'),
  constraint da_claim_done_chk check (status <> 'added' or expense_id is not null),
  constraint da_claim_note_chk check (status <> 'rejected' or length(trim(coalesce(review_note, ''))) > 0)
);
create index da_claims_hub_idx on public.da_expense_claims (hub_id, status);
create index da_claims_employee_idx on public.da_expense_claims (employee_id, status);

alter table public.da_expenses add column if not exists claim_id uuid references public.da_expense_claims(id);
alter table public.da_expenses add column if not exists claim_file text;

create trigger da_claims_stamp before insert or update on public.da_expense_claims
  for each row execute function private.stamp_row();
create trigger da_claims_audit after insert or update or delete on public.da_expense_claims
  for each row execute function private.audit_row('da');
create trigger da_claims_no_delete before delete on public.da_expense_claims
  for each row execute function private.prevent_delete();

alter table public.da_expense_claims enable row level security;
revoke all on public.da_expense_claims from anon;
grant select on public.da_expense_claims to authenticated;

create policy da_claims_read on public.da_expense_claims for select to authenticated
  using (employee_id = private.my_employee_id()
      or private.has_permission('da.sheet.view', zone_id, hub_id)
      or private.has_permission('da.sheet.create', zone_id, hub_id));

-- Files live under claims/<employee id>/…, read by the owner and by the hub's accounts people.
create or replace function private.da_can_read_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions; v_emp uuid;
begin
  if p_name ~ '^claims/[0-9a-f-]{36}/[^/]+$' then
    v_emp := split_part(p_name, '/', 2)::uuid;
    if v_emp = private.my_employee_id() then return true; end if;
    return exists (select 1 from public.employees e
                    where e.id = v_emp
                      and (private.has_permission('da.sheet.view', e.zone_id, e.hub_id)
                           or private.has_permission('da.sheet.create', e.zone_id, e.hub_id)));
  end if;
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and (private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
                               or private.has_permission('da.sheet.create', s.zone_id, s.hub_id));
end $$;

create or replace function private.da_can_upload_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  -- a person's own claim folder
  if p_name ~ '^claims/[0-9a-f-]{36}/[^/]+$' then
    return split_part(p_name, '/', 2)::uuid = private.my_employee_id();
  end if;
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and private.da_can_edit(s);
end $$;

-- ---------------------------------------------------------------------
-- Putting up a claim, and taking it back
-- ---------------------------------------------------------------------
create or replace function public.da_claim_save(
  p_expense_name text, p_category text, p_amount numeric, p_bill_date date,
  p_kind text default 'employee', p_bill_no text default null, p_reference_no text default null,
  p_reference_name text default null, p_reference_phone text default null, p_reference_position text default null,
  p_vehicle uuid default null, p_attachment_path text default null, p_remarks text default null,
  p_claim uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_id uuid; c public.da_expense_claims;
begin
  select * into e from public.employees where id = private.my_employee_id();
  if e.id is null then raise exception 'Only a member of staff can put up a bill.' using errcode = '42501'; end if;
  if e.hub_id is null then raise exception 'Your account is not set to a hub yet.' using errcode = '22023'; end if;
  if p_kind not in ('transport','employee') then raise exception 'Kind must be transport or employee.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if p_bill_date is null or p_bill_date > private.da_today() then
    raise exception 'The bill date cannot be in the future.' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c2
                 where c2 ->> 'code' = p_category) then
    raise exception 'Unknown expense category %.', p_category using errcode = '22023';
  end if;
  if p_reference_phone is not null and nullif(trim(p_reference_phone), '') is not null
     and trim(p_reference_phone) !~ '^01[3-9][0-9]{8}$' then
    raise exception 'The mobile number must look like 01XXXXXXXXX.' using errcode = '22023';
  end if;
  if p_attachment_path is not null and p_attachment_path not like 'claims/' || e.id::text || '/%' then
    raise exception 'The bill file must be in your own folder.' using errcode = '22023';
  end if;

  if p_claim is null then
    insert into public.da_expense_claims (employee_id, employee_code, employee_name, hub_id, zone_id, kind,
      expense_name, category, amount, bill_date, bill_no, reference_no, reference_name, reference_phone,
      reference_position, vehicle_id, attachment_path, remarks)
    values (e.id, e.employee_code::text, e.full_name, e.hub_id, e.zone_id, p_kind,
      trim(p_expense_name), p_category, p_amount, p_bill_date, nullif(trim(p_bill_no), ''),
      nullif(trim(p_reference_no), ''), nullif(trim(p_reference_name), ''), nullif(trim(p_reference_phone), ''),
      nullif(trim(p_reference_position), ''), p_vehicle, p_attachment_path, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    select * into c from public.da_expense_claims where id = p_claim for update;
    if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
    if c.employee_id <> e.id then raise exception 'You can change only your own claim.' using errcode = '42501'; end if;
    if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
    update public.da_expense_claims
       set kind = p_kind, expense_name = trim(p_expense_name), category = p_category, amount = p_amount,
           bill_date = p_bill_date, bill_no = nullif(trim(p_bill_no), ''), reference_no = nullif(trim(p_reference_no), ''),
           reference_name = nullif(trim(p_reference_name), ''), reference_phone = nullif(trim(p_reference_phone), ''),
           reference_position = nullif(trim(p_reference_position), ''), vehicle_id = p_vehicle,
           attachment_path = coalesce(p_attachment_path, attachment_path), remarks = nullif(trim(p_remarks), '')
     where id = p_claim returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.da_claim_withdraw(p_claim uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.da_expense_claims;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if c.employee_id <> private.my_employee_id() then raise exception 'You can take back only your own claim.' using errcode = '42501'; end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_expense_claims set status = 'withdrawn', review_note = trim(p_reason),
         reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
end $$;

-- ---------------------------------------------------------------------
-- What a person sees of their own, and what the sheet shows the manager
-- ---------------------------------------------------------------------
create or replace function public.da_my_claims(p_days integer default 90)
returns setof public.da_expense_claims
language sql stable security invoker set search_path = '' as $$
  select * from public.da_expense_claims
   where employee_id = private.my_employee_id()
     and bill_date >= current_date - greatest(coalesce(p_days, 90), 1)
   order by created_at desc
$$;

create or replace function public.da_sheet_claims(p_session uuid)
returns table (id uuid, no bigint, employee_code text, employee_name text, kind text, expense_name text,
               category text, amount numeric, bill_date date, bill_no text, reference_no text,
               reference_name text, reference_phone text, reference_position text,
               vehicle_id uuid, vehicle_name text, attachment_path text, remarks text, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions ses where ses.id = p_session;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  return query
  select c.id, c.no, c.employee_code, c.employee_name, c.kind, c.expense_name, c.category, c.amount,
         c.bill_date, c.bill_no, c.reference_no, c.reference_name, c.reference_phone, c.reference_position,
         c.vehicle_id, v.name, c.attachment_path, c.remarks, c.created_at
  from public.da_expense_claims c
  left join public.vehicles v on v.id = c.vehicle_id
  where c.hub_id = s.hub_id and c.status = 'submitted'
  order by c.bill_date, c.no;
end $$;

-- ---------------------------------------------------------------------
-- The manager takes a claim in, or turns it down
-- ---------------------------------------------------------------------
create or replace function public.da_claim_add(p_claim uuid, p_session uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.da_expense_claims;
  s public.da_sessions := private.da_require_edit(p_session);
  v_expense uuid;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if c.hub_id <> s.hub_id then raise exception 'This claim belongs to another hub.' using errcode = '22023'; end if;

  insert into public.da_expenses (session_id, hub_id, zone_id, kind, employee_id, employee_code, employee_name,
    expense_name, category, amount, bill_date, bill_no, reference_no, reference_name, reference_phone,
    reference_position, vehicle_id, remarks, claim_id, claim_file)
  values (s.id, s.hub_id, s.zone_id, c.kind, c.employee_id, c.employee_code, c.employee_name,
    c.expense_name, c.category, c.amount, c.bill_date, c.bill_no, c.reference_no, c.reference_name,
    c.reference_phone, c.reference_position, c.vehicle_id,
    nullif(trim(coalesce(c.remarks, '') || case when p_note is not null then ' · ' || trim(p_note) else '' end), ''),
    c.id, c.attachment_path)
  returning id into v_expense;

  update public.da_expense_claims
     set status = 'added', session_id = s.id, expense_id = v_expense,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_claim;
  perform private.da_event(s.id, 'note',
    'Claim ' || c.no::text || ' taken in: ' || c.expense_name || ' (' || c.employee_name || ')', false);
  return v_expense;
end $$;

create or replace function public.da_claim_reject(p_claim uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.da_expense_claims;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.create', c.zone_id, c.hub_id) then
    raise exception 'Not authorised to deal with the claims of this hub.' using errcode = '42501';
  end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write why it is turned down.' using errcode = '22023'; end if;
  update public.da_expense_claims set status = 'rejected', review_note = trim(p_note),
         reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.da_claim_save(text, text, numeric, date, text, text, text, text, text, text, uuid, text, text, uuid)',
    'public.da_claim_withdraw(uuid, text)', 'public.da_my_claims(integer)', 'public.da_sheet_claims(uuid)',
    'public.da_claim_add(uuid, uuid, text)', 'public.da_claim_reject(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- A sheet that carries a line in your name is a sheet you may see
--
-- A rider could already see the sheet his rider line sits on. Now that a manager
-- can pull a person's own bill into the day's sheet, the same must hold for an
-- expense in that person's name — otherwise "আমার খরচ" on his page comes back
-- empty, because the sheet behind his expense is invisible to him.
-- ---------------------------------------------------------------------
drop policy if exists da_sessions_read on public.da_sessions;
create policy da_sessions_read on public.da_sessions for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id)
         or started_by = auth.uid() or submitted_by = auth.uid()
         or exists (select 1 from public.da_rider_lines l where l.session_id = da_sessions.id
                    and l.employee_id = private.my_employee_id() and l.removed_at is null)
         or exists (select 1 from public.da_expenses x where x.session_id = da_sessions.id
                    and x.employee_id = private.my_employee_id() and x.removed_at is null));

-- ===== 20261113002500_sheet_made_easy.sql =====
-- =====================================================================
-- XZM-TEAM ERP — Migration 0025: the day's sheet, made easier to keep
--
--  * A payment needs nothing but its ID and the amount. 101001 and SFC-101001
--    are the same payment; both are kept as SFC-101001. Nothing has to match a
--    record in this database — a payment is written the way an expense is.
--  * The same rider may have more than one line in a day.
--  * Everyone who writes on a sheet appears on it. Each closes their own part,
--    the sheet shows who is left, and the day is closed with the three totals.
--  * A cash note: who handed money over, how much, by which wallet — and the
--    person who handed it sees it on their own page.
--  * A bill taken in from a person's page carries the sheet's date.
--  * Riders and expenses that are on every sheet are put there when it starts.
--  * Every one of these is a setting, so the Super Admin can change it later.
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('da.payment_id_prefix', '"SFC-"',
   'Daily accounts: what a plain payment number is prefixed with (101001 becomes SFC-101001)'),
  ('da.double_rider_lines', 'true',
   'Daily accounts: a rider may have more than one line on the same sheet'),
  ('da.claim_date_source', '"sheet"',
   'Daily accounts: a bill taken in shows the sheet''s date (sheet) or the date on the bill (bill)'),
  ('da.close_needs_all', 'false',
   'Daily accounts: everyone writing on the sheet must close their own part before the day can be closed'),
  ('da.fixed_riders', '[]',
   'Daily accounts: Employee IDs put on every new sheet'),
  ('da.fixed_expenses', '[]',
   'Daily accounts: expenses put on every new sheet — name, category, kind and amount'),
  ('da.note_methods', '["cash","bkash","nagad","rocket","bank","other"]',
   'Daily accounts: how money can come in on a cash note')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. A payment ID is written one way, however it is typed
-- ---------------------------------------------------------------------
create or replace function private.da_payment_ref(p_ref text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text := upper(trim(coalesce(p_ref, ''))); v_pre text;
begin
  if v = '' then return null; end if;
  v := regexp_replace(v, '\s+', '', 'g');
  v_pre := upper(coalesce(private.setting_text('da.payment_id_prefix'), ''));
  if v_pre = '' then return v; end if;
  if v ~ ('^' || regexp_replace(v_pre, '([^a-zA-Z0-9])', '\\\1', 'g')) then return v; end if;
  if v ~ '^[0-9]+$' then return v_pre || v; end if;
  return v;
end $$;

-- A payment: the ID and the amount are enough. The merchant is filled in when
-- this hub happens to have a record for that ID, and left alone when it does not.
create or replace function public.da_save_merchant_payment(
  p_session uuid, p_merchant uuid, p_payment_ref text, p_transaction_id text, p_amount numeric, p_payment_date date,
  p_screenshot_path text default null, p_ocr jsonb default null, p_ocr_verified boolean default false,
  p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s  public.da_sessions := private.da_require_edit(p_session);
  m  public.merchants;
  mp public.merchant_payments;
  v_ref text := private.da_payment_ref(p_payment_ref);
  v_payee text := nullif(trim(p_ocr ->> 'payee'), '');
  v_match text := 'unmatched';
  v_date date := p_payment_date;
  v_name text;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be greater than zero.' using errcode = '22023';
  end if;
  if v_ref is null and p_merchant is null and v_payee is null then
    raise exception 'Write the Payment ID, or say who took the cash.' using errcode = '22023';
  end if;

  if v_ref is not null then
    select * into mp from public.merchant_payments
     where hub_id = s.hub_id and upper(payment_no) = v_ref;
  end if;
  if p_merchant is not null then
    select * into m from public.merchants where id = p_merchant and archived_at is null;
    if m.id is null or m.hub_id <> s.hub_id then
      raise exception 'Choose a merchant of this hub.' using errcode = '22023';
    end if;
  elsif mp.id is not null then
    select * into m from public.merchants where id = mp.merchant_id;
  end if;

  v_date := coalesce(v_date, mp.payment_date, s.account_date);
  if v_date > private.da_today() then
    raise exception 'Payment date cannot be in the future.' using errcode = '22023';
  end if;
  v_name := coalesce(m.name, v_payee, v_ref, '—');

  if p_transaction_id is not null and exists (select 1 from public.da_merchant_payments
       where lower(transaction_id) = lower(trim(p_transaction_id)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Transaction ID % is already recorded.', p_transaction_id using errcode = '23505';
  end if;
  if v_ref is not null and exists (select 1 from public.da_merchant_payments
       where payment_ref = v_ref and session_id = s.id and removed_at is null and id is distinct from p_line) then
    raise exception 'Payment % is already on this sheet.', v_ref using errcode = '23505';
  end if;
  if mp.id is not null and m.id is not null then
    v_match := case when mp.merchant_id = m.id and mp.amount = p_amount then 'matched' else 'mismatch' end;
  end if;

  if p_line is null then
    insert into public.da_merchant_payments (session_id, hub_id, zone_id, merchant_id, merchant_name, payee_name,
      payment_ref, transaction_id, amount, payment_date, screenshot_path, ocr, ocr_verified, verified_by,
      match_status, matched_payment_id, remarks)
    values (s.id, s.hub_id, s.zone_id, m.id, v_name, v_payee, v_ref, nullif(trim(p_transaction_id), ''),
      p_amount, v_date, p_screenshot_path, p_ocr, coalesce(p_ocr_verified, false),
      case when p_ocr_verified then auth.uid() end, v_match, mp.id, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_merchant_payments set merchant_id = m.id, merchant_name = v_name,
      payee_name = coalesce(v_payee, payee_name), payment_ref = v_ref,
      transaction_id = nullif(trim(p_transaction_id), ''), amount = p_amount, payment_date = v_date,
      screenshot_path = coalesce(p_screenshot_path, screenshot_path), ocr = coalesce(p_ocr, ocr),
      ocr_verified = coalesce(p_ocr_verified, false), verified_by = case when p_ocr_verified then auth.uid() end,
      match_status = v_match, matched_payment_id = mp.id, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. More than one line for the same rider, when the setting allows it
-- ---------------------------------------------------------------------
drop index if exists public.da_rider_lines_one_per_rider;
create index if not exists da_rider_lines_rider_idx on public.da_rider_lines (session_id, employee_id) where removed_at is null;

create or replace function public.da_save_rider_line(
  p_session uuid, p_employee_code text,
  p_delivery integer default 0, p_pickup integer default 0, p_amount numeric default 0,
  p_paid numeric default 0, p_due numeric default 0, p_mobile_banking numeric default 0,
  p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s   public.da_sessions := private.da_require_edit(p_session);
  v_e uuid := private.da_find_employee(p_employee_code);
  e   public.employees;
  v_id uuid;
begin
  if v_e is null then raise exception 'Employee ID % was not found.', p_employee_code using errcode = '22023'; end if;
  select * into e from public.employees where id = v_e;
  if not private.da_employee_ok(v_e, s.hub_id) then
    raise exception 'Employee % is not an active member or rider of this hub.', p_employee_code using errcode = '22023';
  end if;
  if coalesce(p_delivery, 0) < 0 or coalesce(p_pickup, 0) < 0 or coalesce(p_amount, 0) < 0
     or coalesce(p_paid, 0) < 0 or coalesce(p_mobile_banking, 0) < 0 then
    raise exception 'Quantities and amounts cannot be negative.' using errcode = '22023';
  end if;
  if p_line is null then
    if coalesce(private.setting_text('da.double_rider_lines'), 'true') <> 'true'
       and exists (select 1 from public.da_rider_lines where session_id = s.id and employee_id = v_e and removed_at is null) then
      raise exception 'This rider is already on the sheet. Edit the existing line.' using errcode = '23505';
    end if;
    insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, employee_code, rider_name, mobile,
      delivery_qty, pickup_qty, amount, paid_amount, due_input, due, mobile_banking, remarks)
    values (s.id, s.hub_id, s.zone_id, v_e, e.employee_code::text, e.full_name, e.mobile,
      coalesce(p_delivery, 0), coalesce(p_pickup, 0), coalesce(p_amount, 0), coalesce(p_paid, 0), coalesce(p_due, 0),
      private.da_due(p_amount, p_paid, p_due, p_mobile_banking), coalesce(p_mobile_banking, 0), nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_rider_lines set
      employee_id = v_e, employee_code = e.employee_code::text, rider_name = e.full_name, mobile = e.mobile,
      delivery_qty = coalesce(p_delivery, 0), pickup_qty = coalesce(p_pickup, 0), amount = coalesce(p_amount, 0),
      paid_amount = coalesce(p_paid, 0), due_input = coalesce(p_due, 0),
      due = private.da_due(p_amount, p_paid, p_due, p_mobile_banking), mobile_banking = coalesce(p_mobile_banking, 0),
      remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null
    returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Who is writing on this sheet, who has finished, and closing the day
-- ---------------------------------------------------------------------
create table public.da_sheet_collectors (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.da_sessions(id),
  user_id     uuid not null,
  employee_id uuid references public.employees(id),
  name        text,
  code        text,
  closed_at   timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(), updated_by uuid,
  unique (session_id, user_id)
);
create index da_collectors_session_idx on public.da_sheet_collectors (session_id);

alter table public.da_sessions add column if not exists closed_at timestamptz;
alter table public.da_sessions add column if not exists closed_by uuid;
alter table public.da_sessions add column if not exists closed_totals jsonb;

alter table public.da_sheet_collectors enable row level security;
revoke all on public.da_sheet_collectors from anon;
grant select on public.da_sheet_collectors to authenticated;
create policy da_collectors_read on public.da_sheet_collectors for select to authenticated
  using (user_id = auth.uid()
      or exists (select 1 from public.da_sessions s where s.id = session_id
                  and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)));

-- Writing any line puts you on the sheet's list of people keeping it.
create or replace function private.da_note_collector() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  if auth.uid() is null then return new; end if;
  select * into s from public.da_sessions where id = new.session_id;
  if s.id is null then return new; end if;
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code)
  values (new.session_id, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code())
  on conflict (session_id, user_id) do update set updated_at = now(), closed_at = null;
  return new;
end $$;

create trigger da_rider_collector after insert on public.da_rider_lines
  for each row execute function private.da_note_collector();
create trigger da_payment_collector after insert on public.da_merchant_payments
  for each row execute function private.da_note_collector();
create trigger da_expense_collector after insert on public.da_expenses
  for each row execute function private.da_note_collector();

-- "My part is done" / taking it back
create or replace function public.da_close_my_part(p_session uuid, p_note text default null, p_done boolean default true)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session);
begin
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code, closed_at, note)
  values (s.id, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code(),
          case when p_done then now() end, nullif(trim(p_note), ''))
  on conflict (session_id, user_id) do update
     set closed_at = case when p_done then now() end, note = nullif(trim(p_note), ''), updated_at = now();
  perform private.da_event(s.id, 'note',
    case when p_done then 'Part closed by ' else 'Part reopened by ' end || coalesce(private.da_my_name(), 'someone'), false);
end $$;

drop function if exists public.da_collectors(uuid);
create or replace function public.da_collectors(p_session uuid)
returns table (user_id uuid, name text, code text, closed_at timestamptz, note text, created_at timestamptz,
               riders integer, payments integer, expenses integer, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select c.user_id, c.name, c.code, c.closed_at, c.note, c.created_at,
         (select count(*)::int from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null),
         (select count(*)::int from public.da_merchant_payments m where m.session_id = c.session_id and m.created_by = c.user_id and m.removed_at is null),
         (select count(*)::int from public.da_expenses x where x.session_id = c.session_id and x.created_by = c.user_id and x.removed_at is null),
         coalesce((select sum(r.amount) from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null), 0)
  from public.da_sheet_collectors c
  where c.session_id = p_session
  order by c.closed_at nulls first, c.created_at
$$;

-- Closing the day: the three totals are kept with the sheet.
create or replace function public.da_close_day(p_session uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_open int;
  v_tot jsonb;
begin
  if coalesce(private.setting_text('da.close_needs_all'), 'false') = 'true' then
    select count(*) into v_open from public.da_sheet_collectors
     where session_id = s.id and closed_at is null and user_id <> auth.uid();
    if v_open > 0 then
      raise exception '% of the people keeping this sheet have not closed their part yet.', v_open using errcode = '22023';
    end if;
  end if;
  select jsonb_build_object(
    'riders', (select count(*) from public.da_rider_lines where session_id = s.id and removed_at is null),
    'rider_amount', coalesce((select sum(amount) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'collected', coalesce((select sum(paid_amount) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'due', coalesce((select sum(due) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'mobile_banking', coalesce((select sum(mobile_banking) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'payments', (select count(*) from public.da_merchant_payments where session_id = s.id and removed_at is null),
    'payment_amount', coalesce((select sum(amount) from public.da_merchant_payments where session_id = s.id and removed_at is null), 0),
    'expenses', (select count(*) from public.da_expenses where session_id = s.id and removed_at is null),
    'expense_amount', coalesce((select sum(amount) from public.da_expenses where session_id = s.id and removed_at is null), 0),
    'notes_in', coalesce((select sum(amount) from public.da_cash_notes where session_id = s.id and removed_at is null), 0))
    into v_tot;
  update public.da_sessions set closed_at = now(), closed_by = auth.uid(), closed_totals = v_tot where id = s.id;
  perform private.da_event(s.id, 'note', coalesce(nullif(trim(p_note), ''), 'Day closed'), true);
  return v_tot;
end $$;

create or replace function public.da_reopen_day(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session);
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_sessions set closed_at = null, closed_by = null where id = s.id;
  perform private.da_event(s.id, 'note', 'Day reopened: ' || trim(p_reason), false);
end $$;

-- ---------------------------------------------------------------------
-- 4. Cash notes: who handed money over, and how
-- ---------------------------------------------------------------------
create table public.da_cash_notes (
  id             uuid primary key default gen_random_uuid(),
  no             bigint generated always as identity unique,
  session_id     uuid not null references public.da_sessions(id),
  hub_id         uuid not null references public.hubs(id),
  zone_id        uuid not null references public.zones(id),
  from_employee  uuid references public.employees(id),
  from_name      text,
  from_code      text,
  amount         numeric(14,2) not null default 0 check (amount >= 0),
  method         text not null default 'cash',
  note           text,
  removed_at     timestamptz, removed_by uuid, remove_reason text,
  created_at     timestamptz not null default now(), created_by uuid,
  updated_at     timestamptz not null default now(), updated_by uuid
);
create index da_cash_notes_session_idx on public.da_cash_notes (session_id) where removed_at is null;
create index da_cash_notes_from_idx on public.da_cash_notes (from_employee) where removed_at is null;

create trigger da_cash_notes_stamp before insert or update on public.da_cash_notes
  for each row execute function private.stamp_row();
create trigger da_cash_notes_audit after insert or update or delete on public.da_cash_notes
  for each row execute function private.audit_row('da');
create trigger da_cash_notes_no_delete before delete on public.da_cash_notes
  for each row execute function private.prevent_delete();

alter table public.da_cash_notes enable row level security;
revoke all on public.da_cash_notes from anon;
grant select on public.da_cash_notes to authenticated;
-- The person who wrote it, the person the money came from, and the hub's accounts people.
create policy da_cash_notes_read on public.da_cash_notes for select to authenticated
  using (created_by = auth.uid() or from_employee = private.my_employee_id()
      or private.has_permission('da.sheet.view', zone_id, hub_id));

create or replace function public.da_note_save(
  p_session uuid, p_amount numeric, p_method text default 'cash', p_from_code text default null,
  p_from_name text default null, p_note text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_e uuid; e public.employees; v_id uuid;
begin
  if p_amount is null or p_amount < 0 then raise exception 'The amount cannot be less than zero.' using errcode = '22023'; end if;
  if not (private.da_setting('da.note_methods') ? coalesce(p_method, 'cash')) then
    raise exception 'Unknown way of handing money over: %.', p_method using errcode = '22023';
  end if;
  if nullif(trim(p_from_code), '') is not null then
    v_e := private.da_find_employee(p_from_code);
    if v_e is null then raise exception 'Employee ID % was not found.', p_from_code using errcode = '22023'; end if;
    select * into e from public.employees where id = v_e;
  end if;
  if v_e is null and nullif(trim(p_from_name), '') is null and nullif(trim(p_note), '') is null then
    raise exception 'Write whose money it is, or a note.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.da_cash_notes (session_id, hub_id, zone_id, from_employee, from_name, from_code, amount, method, note)
    values (s.id, s.hub_id, s.zone_id, v_e, coalesce(e.full_name, nullif(trim(p_from_name), '')), e.employee_code::text,
            coalesce(p_amount, 0), coalesce(p_method, 'cash'), nullif(trim(p_note), ''))
    returning id into v_id;
  else
    update public.da_cash_notes set from_employee = v_e, from_name = coalesce(e.full_name, nullif(trim(p_from_name), '')),
           from_code = e.employee_code::text, amount = coalesce(p_amount, 0), method = coalesce(p_method, 'cash'),
           note = nullif(trim(p_note), '')
     where id = p_id and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Note not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.da_note_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.da_cash_notes;
begin
  select * into n from public.da_cash_notes where id = p_id and removed_at is null;
  if n.id is null then raise exception 'Note not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(n.session_id);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_cash_notes set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
end $$;

-- What the staff member sees on their own page: money they handed over.
create or replace function public.da_my_handovers(p_days integer default 30)
returns table (id uuid, account_date date, hub_name text, amount numeric, method text, note text,
               taken_by text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, s.account_date, h.name, n.amount, n.method, n.note,
         coalesce(p.full_name, p.email::text), n.created_at
  from public.da_cash_notes n
  join public.da_sessions s on s.id = n.session_id
  join public.hubs h on h.id = n.hub_id
  left join public.profiles p on p.id = n.created_by
  where n.removed_at is null and n.from_employee = private.my_employee_id()
    and s.account_date >= current_date - greatest(coalesce(p_days, 30), 1)
  order by s.account_date desc, n.created_at desc
$$;

-- ---------------------------------------------------------------------
-- 5. A bill taken in carries the sheet's date
-- ---------------------------------------------------------------------
drop function if exists public.da_my_claims(integer);
create or replace function public.da_my_claims(p_days integer default 90)
returns table (id uuid, no bigint, kind text, expense_name text, category text, amount numeric,
               bill_date date, bill_no text, reference_no text, reference_name text, reference_phone text,
               reference_position text, vehicle_id uuid, attachment_path text, remarks text,
               status text, review_note text, reviewed_at timestamptz,
               account_date date, shown_date date, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.no, c.kind, c.expense_name, c.category, c.amount, c.bill_date, c.bill_no, c.reference_no,
         c.reference_name, c.reference_phone, c.reference_position, c.vehicle_id, c.attachment_path, c.remarks,
         c.status, c.review_note, c.reviewed_at, s.account_date,
         case when c.status = 'added' and coalesce(private.setting_text('da.claim_date_source'), 'sheet') = 'sheet'
              then coalesce(s.account_date, c.bill_date) else c.bill_date end,
         c.created_at
  from public.da_expense_claims c
  left join public.da_sessions s on s.id = c.session_id
  where c.employee_id = private.my_employee_id()
    and c.bill_date >= current_date - greatest(coalesce(p_days, 90), 1)
  order by c.created_at desc
$$;

-- Taking a bill in puts the sheet's date on the expense line, when that is the rule.
create or replace function public.da_claim_add(p_claim uuid, p_session uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.da_expense_claims;
  s public.da_sessions := private.da_require_edit(p_session);
  v_expense uuid;
  v_date date;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if c.hub_id <> s.hub_id then raise exception 'This claim belongs to another hub.' using errcode = '22023'; end if;
  v_date := case when coalesce(private.setting_text('da.claim_date_source'), 'sheet') = 'sheet'
                 then s.account_date else c.bill_date end;

  insert into public.da_expenses (session_id, hub_id, zone_id, kind, employee_id, employee_code, employee_name,
    expense_name, category, amount, bill_date, bill_no, reference_no, reference_name, reference_phone,
    reference_position, vehicle_id, remarks, claim_id, claim_file)
  values (s.id, s.hub_id, s.zone_id, c.kind, c.employee_id, c.employee_code, c.employee_name,
    c.expense_name, c.category, c.amount, v_date, c.bill_no, c.reference_no, c.reference_name,
    c.reference_phone, c.reference_position, c.vehicle_id,
    nullif(trim(coalesce(c.remarks, '')
      || case when v_date <> c.bill_date then ' · বিলের তারিখ ' || to_char(c.bill_date, 'DD/MM/YYYY') else '' end
      || case when p_note is not null then ' · ' || trim(p_note) else '' end), ''),
    c.id, c.attachment_path)
  returning id into v_expense;

  update public.da_expense_claims
     set status = 'added', session_id = s.id, expense_id = v_expense,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_claim;
  perform private.da_event(s.id, 'note',
    'Claim ' || c.no::text || ' taken in: ' || c.expense_name || ' (' || c.employee_name || ')', false);
  return v_expense;
end $$;

-- ---------------------------------------------------------------------
-- 6. Riders and expenses that are on every sheet
-- ---------------------------------------------------------------------
create or replace function public.da_apply_fixed(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  r jsonb; v_e uuid; e public.employees;
  v_riders int := 0; v_expenses int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(private.da_setting('da.fixed_riders'), '[]')) loop
    v_e := private.da_find_employee(r #>> '{}');
    continue when v_e is null or not private.da_employee_ok(v_e, s.hub_id);
    continue when exists (select 1 from public.da_rider_lines where session_id = s.id and employee_id = v_e and removed_at is null);
    select * into e from public.employees where id = v_e;
    insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, employee_code, rider_name, mobile)
    values (s.id, s.hub_id, s.zone_id, v_e, e.employee_code::text, e.full_name, e.mobile);
    v_riders := v_riders + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(private.da_setting('da.fixed_expenses'), '[]')) loop
    continue when coalesce(trim(r ->> 'name'), '') = '';
    continue when exists (select 1 from public.da_expenses x where x.session_id = s.id and x.removed_at is null
                            and lower(x.expense_name) = lower(trim(r ->> 'name')));
    insert into public.da_expenses (session_id, hub_id, zone_id, kind, expense_name, category, amount, bill_date, remarks)
    values (s.id, s.hub_id, s.zone_id, coalesce(nullif(r ->> 'kind', ''), 'transport'), trim(r ->> 'name'),
            coalesce(nullif(r ->> 'category', ''), 'other'), coalesce((r ->> 'amount')::numeric, 0),
            s.account_date, 'প্রতিদিনের খরচ');
    v_expenses := v_expenses + 1;
  end loop;
  return jsonb_build_object('riders', v_riders, 'expenses', v_expenses);
end $$;

-- A new sheet starts with those lines already on it.
create or replace function public.da_start_session(p_hub uuid, p_date date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_today date := private.da_today();
  v_date  date := coalesce(p_date, private.da_today());
  v_start text := coalesce(private.setting_text('da.start_time'), '00:00');
  v_id    uuid;
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised to start daily accounts for this hub.' using errcode = '42501';
  end if;
  if exists (select 1 from public.hubs where id = p_hub and (status <> 'active' or archived_at is not null)) then
    raise exception 'This hub is not active.' using errcode = '22023';
  end if;
  if v_date > v_today or v_date < v_today - coalesce(private.setting_text('da.backdate_days')::integer, 3) then
    raise exception 'The date is outside the allowed period.' using errcode = '22023';
  end if;
  if v_date = v_today and (now() at time zone coalesce(private.setting_text('da.timezone'), 'Asia/Dhaka'))::time < v_start::time then
    raise exception 'Today''s account can be started from % only.', v_start using errcode = '22023';
  end if;
  if exists (select 1 from public.da_sessions where hub_id = p_hub and account_date = v_date) then
    raise exception 'A daily account sheet for this hub and date already exists.' using errcode = '23505';
  end if;
  insert into public.da_sessions (hub_id, zone_id, account_date, started_by, started_by_employee, started_by_name, started_by_code)
  values (p_hub, v_zone, v_date, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code())
  returning id into v_id;
  perform private.da_event(v_id, 'started', null, false);
  perform public.da_apply_fixed(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. The sheet carries its people, its notes and its closing
-- ---------------------------------------------------------------------
create or replace function public.da_sheet(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.da_sessions where id = p_session) then
    raise exception 'Daily account sheet not found or not visible to you.' using errcode = 'P0002';
  end if;
  select private.da_snapshot(p_session)
         || jsonb_build_object(
              'events', coalesce((select jsonb_agg(to_jsonb(e) - 'snapshot' || jsonb_build_object('has_snapshot', e.snapshot is not null) order by e.at)
                                  from public.da_events e where e.session_id = p_session), '[]'),
              'visits', coalesce((select jsonb_agg(to_jsonb(v) order by v.entered_at desc)
                                  from public.da_page_visits v where v.session_id = p_session), '[]'),
              'collectors', coalesce((select jsonb_agg(to_jsonb(c) order by c.closed_at nulls first, c.created_at)
                                  from public.da_collectors(p_session) c), '[]'),
              'notes_in', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at)
                                  from public.da_cash_notes n where n.session_id = p_session and n.removed_at is null), '[]'),
              'can_edit', (select private.da_can_edit(s) from public.da_sessions s where s.id = p_session),
              'can_verify', (select private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)
                                    and auth.uid() is distinct from s.started_by and auth.uid() is distinct from s.submitted_by
                             from public.da_sessions s where s.id = p_session),
              'can_reopen', (select private.has_permission('da.correction.edit', s.zone_id, s.hub_id) and s.status = 'submitted'
                             from public.da_sessions s where s.id = p_session))
    into v_out;
  if not exists (select 1 from public.da_sessions s where s.id = p_session
                 and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)) then
    v_out := jsonb_set(v_out, '{riders}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'riders') r
                                             where (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{merchant_payments}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'merchant_payments') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{expenses}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'expenses') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{notes_in}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'notes_in') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'from_employee')::uuid = private.my_employee_id()), '[]'));
    v_out := v_out - 'totals' - 'visits' - 'collectors';
  end if;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.da_close_my_part(uuid, text, boolean)', 'public.da_collectors(uuid)',
                           'public.da_close_day(uuid, text)', 'public.da_reopen_day(uuid, text)',
                           'public.da_note_save(uuid, numeric, text, text, text, text, uuid)',
                           'public.da_note_remove(uuid, text)', 'public.da_my_handovers(integer)',
                           'public.da_apply_fixed(uuid)', 'public.da_my_claims(integer)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.da_payment_ref(text) from public, anon;
grant execute on function private.da_payment_ref(text) to authenticated;

-- =====================================================================
-- XZM-TEAM ERP — Migration 0026: the sheet as a tool
--
--  * Every part of the sheet can be laid out by the Super Admin: hide a
--    column, give it another name, add a column of one's own, switch a part
--    off. Kept in one setting, da.layout.
--  * Values of the columns one adds are kept per sheet, line and column.
--  * Update report IDs with their amounts: the money the hub must account for.
--  * Bank deposits: amount, bank or wallet, transport, the bank charge worked
--    out from the amount (a lower and a higher slab, plus VAT, nothing on
--    Fridays, Saturdays and bank holidays), the slip and its reference.
--  * The day's bank task is finished once a slip is up: "task complete".
--  * Nothing here changes an earlier table or rule.
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('da.layout', '{}',
   'Daily accounts: per part of the sheet — hidden columns, column names, own columns, and whether the part is shown'),
  ('da.bank_charge', '{"limit":100000,"low":20,"high":100,"vat":15,"off_days":[5,6],"holidays":[],"transport":60,"effective_from":null}',
   'Daily accounts: bank charge on a deposit — up to "limit" costs "low", above it "high", plus VAT %; nothing on off days (ISO weekday, 5 = Friday) and holidays; transport to the bank')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Settings: the two new keys are checked like the others
-- ---------------------------------------------------------------------
create or replace function public.da_configure(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then
    raise exception 'Not authorised to change daily account settings.' using errcode = '42501';
  end if;
  if p_key not like 'da.%' or not exists (select 1 from public.system_settings where key = p_key) then
    raise exception 'Unknown daily account setting %.', p_key using errcode = '22023';
  end if;
  if p_key = 'da.start_time' and (jsonb_typeof(p_value) <> 'string' or p_value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'Start time must look like 08:30.' using errcode = '22023';
  elsif p_key = 'da.due_rule' and p_value #>> '{}' not in ('manual','amount_minus_paid') then
    raise exception 'Due rule must be manual or amount_minus_paid.' using errcode = '22023';
  elsif p_key = 'da.mobile_banking_rule' and p_value #>> '{}' not in ('separate','reduces_due','adds_to_due') then
    raise exception 'Mobile banking rule must be separate, reduces_due or adds_to_due.' using errcode = '22023';
  elsif p_key in ('da.session_tracking','da.require_assignment') and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'This setting must be true or false.' using errcode = '22023';
  elsif p_key = 'da.backdate_days' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 31) then
    raise exception 'Back-dating must be 0 to 31 days.' using errcode = '22023';
  elsif p_key = 'da.expense_categories' and (jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0
        or exists (select 1 from jsonb_array_elements(p_value) c where coalesce(c ->> 'code', '') !~ '^[a-z][a-z0-9_]*$'
                                                                       or length(trim(coalesce(c ->> 'en', ''))) = 0)) then
    raise exception 'Each category needs a code (a-z, 0-9, _) and a name.' using errcode = '22023';
  elsif p_key = 'da.rider_fields' and (jsonb_typeof(p_value) <> 'array'
        or exists (select 1 from jsonb_array_elements_text(p_value) f
                   where f not in ('delivery_qty','pickup_qty','amount','paid_amount','due','mobile_banking','remarks'))) then
    raise exception 'Unknown rider field.' using errcode = '22023';
  elsif p_key in ('da.reference_setup','da.bill_upload','da.ocr','da.layout') and jsonb_typeof(p_value) <> 'object' then
    raise exception 'This setting must be an object.' using errcode = '22023';
  elsif p_key = 'da.layout' and exists (
        select 1 from jsonb_each(p_value) sec
        where sec.key !~ '^[a-z_]{2,30}$' or jsonb_typeof(sec.value) <> 'object'
           or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(sec.value -> 'extra') = 'array' then sec.value -> 'extra' else '[]' end) x
                      where coalesce(x ->> 'key', '') !~ '^x_[a-z0-9_]{1,30}$' or length(trim(coalesce(x ->> 'label', ''))) = 0)) then
    raise exception 'Layout: each part needs a plain name, and each own column a key (x_…) and a name.' using errcode = '22023';
  elsif p_key = 'da.bank_charge' and (jsonb_typeof(p_value) <> 'object'
        or jsonb_typeof(p_value -> 'limit') <> 'number' or (p_value ->> 'limit')::numeric < 0
        or jsonb_typeof(p_value -> 'low') <> 'number' or (p_value ->> 'low')::numeric < 0
        or jsonb_typeof(p_value -> 'high') <> 'number' or (p_value ->> 'high')::numeric < 0
        or jsonb_typeof(p_value -> 'vat') <> 'number' or (p_value ->> 'vat')::numeric not between 0 and 100
        or jsonb_typeof(coalesce(p_value -> 'off_days', '[]')) <> 'array'
        or exists (select 1 from jsonb_array_elements_text(coalesce(p_value -> 'off_days', '[]')) d where d !~ '^[1-7]$')
        or jsonb_typeof(coalesce(p_value -> 'holidays', '[]')) <> 'array'
        or exists (select 1 from jsonb_array_elements_text(coalesce(p_value -> 'holidays', '[]')) d where d !~ '^\d{4}-\d{2}-\d{2}$')
        or (p_value ? 'transport' and (jsonb_typeof(p_value -> 'transport') <> 'number' or (p_value ->> 'transport')::numeric < 0))) then
    raise exception 'Bank charge: limit, low, high and VAT must be numbers (VAT 0–100); off days 1–7; holidays as dates.' using errcode = '22023';
  end if;
  update public.system_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform private.write_audit('CONFIGURE', 'da', 'system_settings', p_key, null, jsonb_build_object(p_key, p_value));
end $$;

-- ---------------------------------------------------------------------
-- 2. The bank charge on one deposit
-- ---------------------------------------------------------------------
create or replace function private.da_is_bank_off(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  -- off days may be kept as numbers or as text ("5"); holidays as 'YYYY-MM-DD'
  select exists (select 1 from jsonb_array_elements_text(coalesce(private.da_setting('da.bank_charge') -> 'off_days', '[]')) d
                 where d = extract(isodow from p_date)::int::text)
      or exists (select 1 from jsonb_array_elements_text(coalesce(private.da_setting('da.bank_charge') -> 'holidays', '[]')) h
                 where h = p_date::text)
$$;

create or replace function public.da_bank_charge(p_amount numeric, p_method text default 'bank', p_date date default null)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := coalesce(private.da_setting('da.bank_charge'), '{}'); v_fee numeric;
begin
  if coalesce(p_method, 'bank') <> 'bank' or coalesce(p_amount, 0) <= 0 then return 0; end if;
  if private.da_is_bank_off(coalesce(p_date, private.da_today())) then return 0; end if;
  v_fee := case when p_amount <= coalesce((c ->> 'limit')::numeric, 0) then coalesce((c ->> 'low')::numeric, 0)
                else coalesce((c ->> 'high')::numeric, 0) end;
  return round(v_fee * (1 + coalesce((c ->> 'vat')::numeric, 0) / 100), 2);
end $$;

-- ---------------------------------------------------------------------
-- 3. Tables: report IDs, deposits, own-column values
-- ---------------------------------------------------------------------
create table public.da_report_ids (
  id            uuid primary key default gen_random_uuid(),
  no            bigint generated always as identity unique,
  session_id    uuid not null references public.da_sessions(id),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  report_no     text not null check (length(trim(report_no)) between 1 and 60),
  amount        numeric(14,2) not null default 0 check (amount >= 0),
  remarks       text,
  removed_at    timestamptz, removed_by uuid, remove_reason text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create unique index da_report_ids_once on public.da_report_ids (session_id, upper(trim(report_no))) where removed_at is null;
create index da_report_ids_session_idx on public.da_report_ids (session_id) where removed_at is null;
create index da_report_ids_hub_fk_idx on public.da_report_ids (hub_id);
create index da_report_ids_zone_fk_idx on public.da_report_ids (zone_id);

create table public.da_deposits (
  id            uuid primary key default gen_random_uuid(),
  no            bigint generated always as identity unique,
  session_id    uuid not null references public.da_sessions(id),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  method        text not null default 'bank' check (method in ('bank','bkash','nagad','rocket','other')),
  bank_name     text,
  amount        numeric(14,2) not null check (amount > 0),
  charge        numeric(14,2) not null default 0 check (charge >= 0),
  charge_auto   boolean not null default true,
  transport     numeric(14,2) not null default 0 check (transport >= 0),
  people        text,
  ref_no        text,
  slip_path     text,
  deposited_on  date not null,
  remarks       text,
  removed_at    timestamptz, removed_by uuid, remove_reason text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create index da_deposits_session_idx on public.da_deposits (session_id) where removed_at is null;
create index da_deposits_hub_fk_idx on public.da_deposits (hub_id);
create index da_deposits_zone_fk_idx on public.da_deposits (zone_id);

create table public.da_cells (
  session_id    uuid not null references public.da_sessions(id),
  section       text not null check (section in ('riders','payment','expense','reports','deposits','notes')),
  row_id        uuid not null,
  col_key       text not null check (col_key ~ '^x_[a-z0-9_]{1,30}$'),
  value         text check (value is null or length(value) <= 500),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  primary key (session_id, section, row_id, col_key)
);
create index da_cells_hub_fk_idx on public.da_cells (hub_id);
create index da_cells_zone_fk_idx on public.da_cells (zone_id);

do $$
declare t text;
begin
  foreach t in array array['da_report_ids','da_deposits'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t||'_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''da'')', t||'_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t||'_no_delete', t);
  end loop;
end $$;
create trigger da_cells_audit after insert or update or delete on public.da_cells
  for each row execute function private.audit_row('da');

alter table public.da_report_ids enable row level security;
alter table public.da_deposits   enable row level security;
alter table public.da_cells      enable row level security;
revoke all on public.da_report_ids, public.da_deposits, public.da_cells from anon;
grant select on public.da_report_ids, public.da_deposits, public.da_cells to authenticated;
create policy da_report_ids_read on public.da_report_ids for select to authenticated
  using (created_by = auth.uid() or private.has_permission('da.sheet.view', zone_id, hub_id));
create policy da_deposits_read on public.da_deposits for select to authenticated
  using (created_by = auth.uid() or private.has_permission('da.sheet.view', zone_id, hub_id));
create policy da_cells_read on public.da_cells for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or private.has_permission('da.sheet.create', zone_id, hub_id));

alter table public.da_sessions add column if not exists bank_done_at timestamptz;
alter table public.da_sessions add column if not exists bank_done_by uuid;
alter table public.da_sessions add column if not exists bank_done_note text;

-- ---------------------------------------------------------------------
-- 4. Report IDs
-- ---------------------------------------------------------------------
create or replace function public.da_report_save(
  p_session uuid, p_report_no text, p_amount numeric, p_remarks text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session); v_id uuid; v_no text := upper(trim(coalesce(p_report_no, '')));
begin
  if length(v_no) = 0 then raise exception 'Write the report ID.' using errcode = '22023'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'The amount cannot be less than zero.' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.da_report_ids (session_id, hub_id, zone_id, report_no, amount, remarks)
    values (s.id, s.hub_id, s.zone_id, v_no, p_amount, nullif(trim(p_remarks), '')) returning id into v_id;
  else
    update public.da_report_ids set report_no = v_no, amount = p_amount, remarks = nullif(trim(p_remarks), '')
     where id = p_id and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Report ID not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = s.id and bank_done_at is not null;
  return v_id;
end $$;

create or replace function public.da_report_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.da_report_ids;
begin
  select * into r from public.da_report_ids where id = p_id and removed_at is null;
  if r.id is null then raise exception 'Report ID not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(r.session_id);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_report_ids set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = r.session_id and bank_done_at is not null;
end $$;

-- ---------------------------------------------------------------------
-- 5. Deposits
-- ---------------------------------------------------------------------
create or replace function public.da_deposit_save(
  p_session uuid, p_amount numeric, p_method text default 'bank', p_bank text default null, p_ref text default null,
  p_slip text default null, p_date date default null, p_transport numeric default null, p_charge numeric default null,
  p_people text default null, p_remarks text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_id uuid; v_date date; v_method text := coalesce(nullif(trim(p_method), ''), 'bank');
  v_charge numeric; v_transport numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Write the amount deposited.' using errcode = '22023'; end if;
  if p_charge is not null and p_charge < 0 or p_transport is not null and p_transport < 0 then
    raise exception 'Charge and transport cannot be less than zero.' using errcode = '22023';
  end if;
  if p_slip is not null and p_slip !~ ('^da/' || s.id::text || '/[^/]+$') then
    raise exception 'The slip must be uploaded to this sheet.' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, s.account_date);
  v_charge := coalesce(p_charge, public.da_bank_charge(p_amount, v_method, v_date));
  v_transport := coalesce(p_transport, case when v_method = 'bank' and not private.da_is_bank_off(v_date)
                                            then coalesce((private.da_setting('da.bank_charge') ->> 'transport')::numeric, 0) else 0 end);
  if p_id is null then
    insert into public.da_deposits (session_id, hub_id, zone_id, method, bank_name, amount, charge, charge_auto, transport,
                                    people, ref_no, slip_path, deposited_on, remarks)
    values (s.id, s.hub_id, s.zone_id, v_method, nullif(trim(p_bank), ''), p_amount, v_charge, p_charge is null, v_transport,
            nullif(trim(p_people), ''), nullif(trim(p_ref), ''), p_slip, v_date, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_deposits set method = v_method, bank_name = nullif(trim(p_bank), ''), amount = p_amount, charge = v_charge,
           charge_auto = p_charge is null, transport = v_transport, people = nullif(trim(p_people), ''), ref_no = nullif(trim(p_ref), ''),
           slip_path = coalesce(p_slip, slip_path), deposited_on = v_date, remarks = nullif(trim(p_remarks), '')
     where id = p_id and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Deposit not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = s.id and bank_done_at is not null;
  return v_id;
end $$;

create or replace function public.da_deposit_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.da_deposits;
begin
  select * into d from public.da_deposits where id = p_id and removed_at is null;
  if d.id is null then raise exception 'Deposit not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(d.session_id);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_deposits set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = d.session_id and bank_done_at is not null;
end $$;

-- The day's bank work is done: at least one deposit, and every deposit has its slip.
create or replace function public.da_bank_done(p_session uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session);
begin
  if not exists (select 1 from public.da_deposits where session_id = s.id and removed_at is null) then
    raise exception 'Write the deposit first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.da_deposits where session_id = s.id and removed_at is null and slip_path is null) then
    raise exception 'Upload the bank slip of every deposit first.' using errcode = '22023';
  end if;
  update public.da_sessions set bank_done_at = now(), bank_done_by = auth.uid(), bank_done_note = nullif(trim(p_note), '') where id = s.id;
  perform private.da_event(s.id, 'note', 'Bank deposit done' || coalesce(': ' || nullif(trim(p_note), ''), ''), false);
end $$;

-- ---------------------------------------------------------------------
-- 6. Values of one's own columns
-- ---------------------------------------------------------------------
create or replace function public.da_cell_set(p_session uuid, p_section text, p_row uuid, p_col text, p_value text)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session); v text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_section not in ('riders','payment','expense','reports','deposits','notes') then
    raise exception 'Unknown part of the sheet: %.', p_section using errcode = '22023';
  end if;
  if coalesce(p_col, '') !~ '^x_[a-z0-9_]{1,30}$' then raise exception 'Unknown column.' using errcode = '22023'; end if;
  if v is not null and length(v) > 500 then raise exception 'Keep it under 500 letters.' using errcode = '22023'; end if;
  if v is null then
    delete from public.da_cells where session_id = s.id and section = p_section and row_id = p_row and col_key = p_col;
  else
    insert into public.da_cells (session_id, section, row_id, col_key, value, hub_id, zone_id, updated_by)
    values (s.id, p_section, p_row, p_col, v, s.hub_id, s.zone_id, auth.uid())
    on conflict (session_id, section, row_id, col_key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. The sheet carries its report IDs, deposits and own-column values
-- ---------------------------------------------------------------------
create or replace function public.da_sheet(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.da_sessions where id = p_session) then
    raise exception 'Daily account sheet not found or not visible to you.' using errcode = 'P0002';
  end if;
  select private.da_snapshot(p_session)
         || jsonb_build_object(
              'events', coalesce((select jsonb_agg(to_jsonb(e) - 'snapshot' || jsonb_build_object('has_snapshot', e.snapshot is not null) order by e.at)
                                  from public.da_events e where e.session_id = p_session), '[]'),
              'visits', coalesce((select jsonb_agg(to_jsonb(v) order by v.entered_at desc)
                                  from public.da_page_visits v where v.session_id = p_session), '[]'),
              'collectors', coalesce((select jsonb_agg(to_jsonb(c) order by c.closed_at nulls first, c.created_at)
                                  from public.da_collectors(p_session) c), '[]'),
              'notes_in', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at)
                                  from public.da_cash_notes n where n.session_id = p_session and n.removed_at is null), '[]'),
              'report_ids', coalesce((select jsonb_agg(to_jsonb(r) order by r.no)
                                  from public.da_report_ids r where r.session_id = p_session and r.removed_at is null), '[]'),
              'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.no)
                                  from public.da_deposits d where d.session_id = p_session and d.removed_at is null), '[]'),
              'cells', coalesce((select jsonb_agg(jsonb_build_object('section', c.section, 'row_id', c.row_id, 'col', c.col_key, 'value', c.value))
                                  from public.da_cells c where c.session_id = p_session), '[]'),
              'can_edit', (select private.da_can_edit(s) from public.da_sessions s where s.id = p_session),
              'can_verify', (select private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)
                                    and auth.uid() is distinct from s.started_by and auth.uid() is distinct from s.submitted_by
                             from public.da_sessions s where s.id = p_session),
              'can_reopen', (select private.has_permission('da.correction.edit', s.zone_id, s.hub_id) and s.status = 'submitted'
                             from public.da_sessions s where s.id = p_session),
              'can_layout', private.has_permission('da.settings.configure'))
    into v_out;
  if not exists (select 1 from public.da_sessions s where s.id = p_session
                 and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)) then
    v_out := jsonb_set(v_out, '{riders}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'riders') r
                                             where (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{merchant_payments}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'merchant_payments') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{expenses}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'expenses') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{notes_in}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'notes_in') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'from_employee')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{report_ids}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'report_ids') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{deposits}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'deposits') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := v_out - 'totals' - 'visits' - 'collectors' - 'cells';
  end if;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.da_bank_charge(numeric, text, date)',
                           'public.da_report_save(uuid, text, numeric, text, uuid)', 'public.da_report_remove(uuid, text)',
                           'public.da_deposit_save(uuid, numeric, text, text, text, text, date, numeric, numeric, text, text, uuid)',
                           'public.da_deposit_remove(uuid, text)', 'public.da_bank_done(uuid, text)',
                           'public.da_cell_set(uuid, text, uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.da_is_bank_off(date) from public, anon;
grant execute on function private.da_is_bank_off(date) to authenticated;

-- =====================================================================
-- XZM-TEAM ERP — Migration: performance cleanup
--
--  * Row-level security: every policy that calls auth.uid() directly now calls
--    (select auth.uid()), so Postgres works it out once per query instead of
--    once per row. What each policy allows does not change.
--  * Every foreign key in public gets an index on its columns (if none covers
--    them), so joins and deletes on the parent stay fast as data grows.
--  * Nothing is removed; no table, rule or permission changes.
-- =====================================================================

do $$
declare
  p record; v_qual text; v_check text; v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (   (qual is not null and qual ~ 'auth\.uid\(\)' and qual !~* 'select\s+auth\.uid\(\)')
           or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~* 'select\s+auth\.uid\(\)'))
  loop
    v_qual  := case when p.qual is null then null else replace(p.qual, 'auth.uid()', '(select auth.uid())') end;
    v_check := case when p.with_check is null then null else replace(p.with_check, 'auth.uid()', '(select auth.uid())') end;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;
end $$;

do $$
declare
  fk record; v_cols text; v_name text;
begin
  for fk in
    select c.conrelid, c.conname, c.conkey, cl.relname as tbl
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord) into v_cols
    from unnest(fk.conkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.attnum;
    v_name := left(fk.conname, 55) || '_ix';
    execute format('create index if not exists %I on public.%I (%s)', v_name, fk.tbl, v_cols);
  end loop;
end $$;

-- =====================================================================
-- XZM-TEAM ERP — Migration: ID-ready profiles and tidy positions
--
--  The "New Admin & Rider ID Create" format lists what a profile must hold
--  before an ID is opened. Every employee — old and new — is now checked
--  against that one list:
--    name · mobile · alternative mobile · hub · designation · Gmail (admin
--    posts only) · blood group · date of birth · permanent address ·
--    reference · NID / birth certificate no. · photo · NID front · NID back ·
--    basic salary
--  * Two profile fields are added (alternative mobile, blood group), required.
--  * hr_profile_gaps(): one line per person with what is missing; the HR
--    dashboard's "missing information" count uses the same check.
--  * hr_application_missing_fields(): new ID applications need the same.
--  * Pay items from the format: Pick & Drop, Return, Weight bonus, Entry
--    commission (Phone bill = mobile bill; Conveyance = transport).
--  * Positions: Bangla names, a clean order, one "Assistant Manager"
--    (the duplicate "Asst. Manager" folded into it), "Sorting + Loader";
--    old spellings kept as aliases so imports still match them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Settings: which posts are "admin" (need a Gmail)
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('hr.admin_positions', '["MANAGER","ASSISTANTMAN","HUBCC","DATAENTRY","ZONALMANAGER"]',
   'HR: position codes that count as admin posts — these need a Gmail before an ID is opened')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Profile fields from the format
-- ---------------------------------------------------------------------
insert into public.employee_custom_fields (section_id, code, label, label_bn, field_type, is_required, validation, options, sort_order)
select s.id, 'alt_mobile', 'Alternative phone number', 'বিকল্প মোবাইল নম্বর', 'text', true,
       '{"pattern":"^01[3-9][0-9]{8}$"}'::jsonb, '[]'::jsonb, 15
from public.employee_field_sections s where s.code = 'personal'
on conflict (code) do nothing;

insert into public.employee_custom_fields (section_id, code, label, label_bn, field_type, is_required, options, sort_order)
select s.id, 'blood_group', 'Blood group', 'রক্তের গ্রুপ', 'dropdown', true,
       '[{"value":"a_pos","label":"A+"},{"value":"a_neg","label":"A-"},{"value":"b_pos","label":"B+"},{"value":"b_neg","label":"B-"},
         {"value":"o_pos","label":"O+"},{"value":"o_neg","label":"O-"},{"value":"ab_pos","label":"AB+"},{"value":"ab_neg","label":"AB-"}]'::jsonb, 16
from public.employee_field_sections s where s.code = 'personal'
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Pay items from the format
-- ---------------------------------------------------------------------
insert into public.pay_component_types (code, kind, name, name_bn) values
  ('pick_drop',        'allowance', 'Pick & Drop',      'পিক অ্যান্ড ড্রপ'),
  ('return_bonus',     'allowance', 'Return',           'রিটার্ন'),
  ('weight_bonus',     'allowance', 'Weight bonus',     'ওজন বোনাস'),
  ('entry_commission', 'allowance', 'Entry commission', 'এন্ট্রি কমিশন')
on conflict (code) do nothing;
update public.pay_component_types set name = 'Phone bill', name_bn = 'ফোন বিল' where code = 'mobile_bill';

-- ---------------------------------------------------------------------
-- 4. The one check: what a profile still lacks for an ID
-- ---------------------------------------------------------------------
create or replace function private.hr_id_gaps(p_employee uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype; s public.employee_sensitive%rowtype; v text[] := '{}'; d text;
  v_admin boolean;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then return null; end if;
  select * into s from public.employee_sensitive where employee_id = p_employee;
  select coalesce(p.code::text, '') in (select jsonb_array_elements_text(coalesce((select value from public.system_settings where key = 'hr.admin_positions'), '[]')))
    into v_admin from public.positions p where p.id = e.position_id;

  if coalesce(trim(e.full_name), '') = '' then v := v || 'full_name'::text; end if;
  if e.mobile is null then v := v || 'mobile'::text; end if;
  if e.hub_id is null and e.zone_id is null then v := v || 'hub'::text; end if;
  if e.position_id is null then v := v || 'position'::text; end if;
  if coalesce(v_admin, false) and e.email is null then v := v || 'email'::text; end if;
  if s.date_of_birth is null then v := v || 'date_of_birth'::text; end if;
  if coalesce(trim(s.permanent_address), '') = '' then v := v || 'permanent_address'::text; end if;
  if coalesce(trim(s.nid_number), '') = '' then v := v || 'nid_number'::text; end if;
  if e.referred_by_employee_id is null and coalesce(trim(e.reference_info), '') = ''
     and coalesce(e.reference_manual, '{}'::jsonb) in ('{}'::jsonb, 'null'::jsonb) then
    v := v || 'reference'::text;
  end if;
  if not exists (select 1 from public.employee_compensation c where c.employee_id = p_employee and c.status in ('pending','approved')) then
    v := v || 'basic_salary'::text;
  end if;
  for d in select jsonb_array_elements_text(value) from public.system_settings where key = 'hr.required_documents' loop
    if not exists (select 1 from public.employee_documents x where x.employee_id = p_employee and x.doc_type = d and x.archived_at is null) then
      v := v || ('document:' || d);
    end if;
  end loop;
  select v || coalesce(array_agg('field:' || f.code::text order by f.sort_order), '{}') into v
  from public.employee_custom_fields f
  where f.is_required and f.archived_at is null and f.zone_id is null
    and not exists (select 1 from public.employee_custom_field_values cv
                    where cv.field_id = f.id and cv.employee_id = p_employee and cv.value is not null and cv.value <> '""'::jsonb);
  return v;
end $$;
revoke all on function private.hr_id_gaps(uuid) from public, anon;
grant execute on function private.hr_id_gaps(uuid) to authenticated;

create or replace function private.hr_id_check_count() returns integer
language sql stable security definer set search_path = '' as $$
  select 11 + coalesce((select jsonb_array_length(value) from public.system_settings where key = 'hr.required_documents'), 0)
            + (select count(*)::int from public.employee_custom_fields f where f.is_required and f.archived_at is null and f.zone_id is null)
$$;
revoke all on function private.hr_id_check_count() from public, anon;
grant execute on function private.hr_id_check_count() to authenticated;

-- One line per person the caller may see: who they are and what is missing.
create or replace function public.hr_profile_gaps(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, status text, hub_id uuid, hub_name text,
               position_name text, position_name_bn text, missing text[], total_checks integer)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.status, e.hub_id, h.name, p.name, p.name_bn,
         private.hr_id_gaps(e.id), private.hr_id_check_count()
  from public.employees e
  left join public.hubs h on h.id = e.hub_id
  left join public.positions p on p.id = e.position_id
  where e.archived_at is null and e.status in ('active', 'applicant')
    and (p_zone is null or e.zone_id = p_zone) and (p_hub is null or e.hub_id = p_hub)
  order by h.name nulls last, cardinality(private.hr_id_gaps(e.id)) desc, e.full_name
$$;
revoke all on function public.hr_profile_gaps(uuid, uuid) from public, anon;
grant execute on function public.hr_profile_gaps(uuid, uuid) to authenticated;

-- The HR dashboard's count uses the same check.
create or replace function public.hr_missing_information(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, missing text[])
language sql stable set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.hub_id, private.hr_id_gaps(e.id)
  from public.employees e
  where e.status = 'active' and e.archived_at is null
    and (p_zone is null or e.zone_id = p_zone) and (p_hub is null or e.hub_id = p_hub)
$$;

-- New ID applications need the same as the format.
create or replace function public.hr_application_missing_fields(p_employee uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees%rowtype; v text[];
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if not (private.employee_has_permission('hr.application.view', p_employee)
          or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  v := private.hr_id_gaps(p_employee);
  if e.department_id is null then v := v || 'department'::text; end if;
  if e.joining_date is null then v := v || 'joining_date'::text; end if;
  if e.emergency_contact_phone is null then v := v || 'emergency_contact'::text; end if;
  if e.reporting_manager_id is null and exists (
       select 1 from public.employees m
       where m.status = 'active' and m.id <> e.id and m.archived_at is null
         and m.zone_id = coalesce(e.zone_id, private.hub_zone(e.hub_id))) then
    v := v || 'reporting_manager'::text;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 5. Positions: aliases, Bangla names, order, one Assistant Manager
-- ---------------------------------------------------------------------
alter table public.positions add column if not exists aliases text[] not null default '{}';
alter table public.positions add column if not exists sort_order integer not null default 100;

create or replace function private.norm_name(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9ঀ-৿]+', '', 'g')
$$;

create or replace function private.find_position(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.positions x
   where x.archived_at is null
     and ((p_code is not null and x.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (
             private.norm_name(x.name) = private.norm_name(p_name)
          or trim(x.name_bn) = trim(p_name)
          or exists (select 1 from unnest(x.aliases) a where private.norm_name(a) = private.norm_name(p_name)))))
   order by x.sort_order, x.created_at limit 1
$$;

do $$
declare v_keep uuid; v_drop uuid; r record;
begin
  -- Bangla names, level and order (only where the post exists)
  update public.positions set name_bn = 'জোনাল ম্যানেজার', level = 'zone', sort_order = 10 where code = 'ZONALMANAGER';
  update public.positions set name_bn = 'ম্যানেজার',         sort_order = 20 where code = 'MANAGER';
  update public.positions set name_bn = 'সহকারী ম্যানেজার', sort_order = 30 where code = 'ASSISTANTMAN';
  update public.positions set name_bn = 'হাব সিসি',          sort_order = 40 where code = 'HUBCC';
  update public.positions set name_bn = 'ডাটা এন্ট্রি',      sort_order = 50 where code = 'DATAENTRY';
  update public.positions set name_bn = 'কমিশন রাইডার',     sort_order = 60 where code = 'COMMISSIONRI';
  update public.positions set name = 'Sorting + Loader', name_bn = 'সর্টিং + লোডার',
         aliases = array['Shorting+Loader', 'Sorting Loader', 'Loader'], sort_order = 70 where code = 'SHORTINGLOAD';
  update public.positions set name_bn = 'ড্রাইভার',          sort_order = 80 where code = 'DRIVER';
  update public.positions set name_bn = 'অটো ড্রাইভার',      sort_order = 85 where code = 'AUTODRIVER';
  update public.positions set name_bn = 'হেল্পার',           sort_order = 90 where code = 'HELPER';
  update public.positions set name_bn = 'সিকিউরিটি গার্ড',   sort_order = 95 where code = 'SECURITYGUAR';

  -- "Asst. Manager" is the same post as "Assistant Manager": one post, history kept
  select id into v_keep from public.positions where code = 'ASSISTANTMAN' and archived_at is null;
  select id into v_drop from public.positions where code = 'ASSTMANAGER' and archived_at is null;
  if v_keep is not null and v_drop is not null then
    update public.positions set aliases = array['Asst. Manager', 'Asst Manager', 'AM'] where id = v_keep;
    for r in select id, department_id, zone_id, hub_id, reporting_manager_id from public.employees where position_id = v_drop loop
      update public.employee_assignments set effective_to = greatest(effective_from, current_date - 1)
       where employee_id = r.id and effective_to is null;
      insert into public.employee_assignments (employee_id, change_type, department_id, position_id, zone_id, hub_id,
                                               reporting_manager_id, effective_from, reason)
      values (r.id, 'correction', r.department_id, v_keep, r.zone_id, r.hub_id, r.reporting_manager_id, current_date,
              'পদবি একত্র: Asst. Manager → Assistant Manager');
      update public.employees set position_id = v_keep where id = r.id;
    end loop;
    update public.referral_prospects set position_id = v_keep where position_id = v_drop;
    update public.job_duties set position_id = v_keep where position_id = v_drop;
    update public.positions set status = 'inactive', archived_at = now(),
           archive_reason = 'Merged into Assistant Manager (same post)' where id = v_drop;
  end if;
end $$;
-- =====================================================================
-- XZM-TEAM ERP — Migration: work focus inside one post
--
--  One post can hold people who mainly do different work. "Sorting + Loader"
--  stays ONE post, but each person is marked Sorting (blue) or Loader
--  (orange); the profile shows it in its colour, and duties written for a
--  focus reach only the people with that focus.
--  * positions.focus_options: the focuses a post offers (code, names, colour)
--  * employees.work_focus: the person's focus (one of their post's focuses)
--  * job_duties.focus: a duty for one focus of the post (null = everyone in it)
--  * hr_set_work_focus(): HR / duty editors set it; changing post clears it
-- =====================================================================

alter table public.positions add column if not exists focus_options jsonb not null default '[]'::jsonb;
alter table public.positions drop constraint if exists positions_focus_options_array;
alter table public.positions add constraint positions_focus_options_array check (jsonb_typeof(focus_options) = 'array');
alter table public.employees add column if not exists work_focus text;
alter table public.job_duties add column if not exists focus text;

update public.positions
   set focus_options = '[{"code":"sorting","label":"Sorting","label_bn":"সর্টিং","color":"blue"},
                         {"code":"loader","label":"Loader","label_bn":"লোডার","color":"orange"}]'::jsonb
 where code = 'SHORTINGLOAD' and focus_options = '[]'::jsonb;

-- A focus must be one the post offers; a new post clears an old focus.
create or replace function private.employee_focus_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.work_focus is not null and not exists (
       select 1 from public.positions p, jsonb_array_elements(p.focus_options) o
        where p.id = new.position_id and o ->> 'code' = new.work_focus) then
    if tg_op = 'UPDATE' and new.position_id is distinct from old.position_id then
      new.work_focus := null;
    else
      raise exception 'This work focus is not one of the post''s focuses.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists employees_work_focus on public.employees;
create trigger employees_work_focus before insert or update of work_focus, position_id on public.employees
  for each row execute function private.employee_focus_check();

create or replace function public.hr_set_work_focus(p_employee uuid, p_focus text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.employee_has_permission('hr.employee.edit', p_employee)
          or private.employee_has_permission('hr.duty.edit', p_employee)) then
    raise exception 'Not authorised to set the work focus.' using errcode = '42501';
  end if;
  update public.employees set work_focus = nullif(trim(p_focus), '') where id = p_employee and archived_at is null;
  if not found then raise exception 'Employee not found.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.hr_set_work_focus(uuid, text) from public, anon;
grant execute on function public.hr_set_work_focus(uuid, text) to authenticated;

-- My duties: the person's own, the post's for everyone, and the post's for the person's focus.
create or replace function public.my_duties(p_employee uuid default null)
returns table (id uuid, title text, details text, frequency text, source text)
language sql stable security invoker set search_path = '' as $$
  with me as (select e.id, e.position_id, e.work_focus from public.employees e
               where e.id = coalesce(p_employee, private.my_employee_id()))
  select d.id, d.title, d.details, d.frequency, case when d.employee_id is not null then 'person' else 'post' end
    from public.job_duties d, me
   where d.archived_at is null
     and (d.employee_id = me.id
       or (d.position_id = me.position_id and (d.focus is null or d.focus = me.work_focus)))
   order by d.sort, d.title
$$;
-- =====================================================================
-- XZM-TEAM ERP — Migration: hub-to-hub transfer from the zonal panel
--
--  Zonal managers can move staff between hubs of their own zone without
--  full HR edit rights. New permission hr.transfer.edit: a plain hub move
--  (same post and department) is allowed when the caller holds it in both
--  the old and the new hub. Changing post or department still needs
--  hr.employee.edit. Every move stays in the assignment history.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('hr.transfer.edit', 'hr', 'transfer', 'edit', 'Move staff from one hub to another (same post) within scope')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'hr.transfer.edit'
 where r.code in ('admin', 'head_office_manager', 'hr_manager', 'zonal_manager')
on conflict do nothing;

create or replace function public.hr_transfer_employee(
  p_employee uuid, p_hub uuid, p_department uuid, p_position uuid, p_manager uuid,
  p_effective date, p_reason text, p_change_type text default 'transfer'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_zone uuid;
  v_plain boolean;
begin
  select * into e from public.employees where id = p_employee for update;
  if e.id is null then raise exception 'Employee not found.' using errcode = 'P0002'; end if;
  if e.status <> 'active' then raise exception 'Only active employees can be transferred.' using errcode = 'P0001'; end if;
  if p_change_type not in ('transfer','promotion','correction') then raise exception 'Invalid change type.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_effective is null or p_effective < (select max(effective_from) from public.employee_assignments where employee_id = p_employee) then
    raise exception 'Effective date must be on or after the current assignment start.' using errcode = '22023';
  end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if p_hub is not null and v_zone is null then raise exception 'The new hub was not found.' using errcode = 'P0002'; end if;
  v_plain := p_change_type = 'transfer'
             and p_department is not distinct from e.department_id
             and p_position is not distinct from e.position_id;
  if not ((private.has_permission('hr.employee.edit', e.zone_id, e.hub_id)
           and private.has_permission('hr.employee.edit', coalesce(v_zone, e.zone_id), p_hub))
       or (v_plain and private.has_permission('hr.transfer.edit', e.zone_id, e.hub_id)
           and private.has_permission('hr.transfer.edit', coalesce(v_zone, e.zone_id), p_hub))) then
    raise exception 'You need transfer rights in both the current and the new hub.' using errcode = '42501';
  end if;
  if p_manager = p_employee then raise exception 'An employee cannot report to themselves.' using errcode = '22023'; end if;

  update public.employee_assignments set effective_to = greatest(p_effective - 1, effective_from)
   where employee_id = p_employee and effective_to is null;
  insert into public.employee_assignments
    (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
  values (p_employee, p_change_type, p_department, p_position, coalesce(v_zone, e.zone_id), p_hub, p_manager, p_effective, p_reason);
  perform set_config('app.change_reason', p_reason, true);
  update public.employees
     set hub_id = p_hub, zone_id = coalesce(v_zone, e.zone_id), department_id = p_department,
         position_id = p_position, reporting_manager_id = p_manager
   where id = p_employee;
end $$;
-- =====================================================================
-- XZM-TEAM ERP — Migration: "লোক লাগবে" (manpower requests) and the
-- staff change register used for company Excel files.
--
--  * manpower_requests: any staff member asks for people for their hub
--    (post, how many, why, daily pickup / delivery / big parcels, other
--    issues). Zonal/HR approvers decide; on approval the hub or the whole
--    zone is told (optionally only chosen posts) so whoever knows someone
--    can refer them. Approvers are told about new requests.
--  * hr_change_register(): one list of every staff change in a period —
--    transfers / promotions / corrections done in the system, status
--    changes (inactive -> active etc.) and marked HR requests (transfer,
--    active, inactive, ID create) — so a zonal manager can export one file.
--  Nothing is hard-deleted.
-- =====================================================================

create sequence if not exists public.manpower_request_no_seq;
create table public.manpower_requests (
  id              uuid primary key default gen_random_uuid(),
  request_no      text not null unique default ('MP-' || lpad(nextval('public.manpower_request_no_seq')::text, 5, '0')),
  zone_id         uuid not null references public.zones(id),
  hub_id          uuid not null references public.hubs(id),
  position_id     uuid references public.positions(id),
  needed          integer not null check (needed between 1 and 200),
  reason          text not null check (length(trim(reason)) > 2),
  daily_pickup    integer check (daily_pickup >= 0),
  daily_delivery  integer check (daily_delivery >= 0),
  big_parcels     integer check (big_parcels >= 0),
  other_issues    text,
  status          text not null default 'submitted' check (status in ('submitted','approved','rejected','filled','closed','cancelled')),
  scope           text not null default 'hub' check (scope in ('hub','zone')),
  notify_positions uuid[] not null default '{}',
  filled          integer not null default 0 check (filled >= 0),
  submitted_by    uuid not null default auth.uid(),
  submitter_employee_id uuid references public.employees(id),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  notified_count  integer not null default 0,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create index manpower_requests_zone_idx on public.manpower_requests (zone_id, status, created_at desc);
create index manpower_requests_hub_idx on public.manpower_requests (hub_id);
create index manpower_requests_position_idx on public.manpower_requests (position_id);
create index manpower_requests_submitter_idx on public.manpower_requests (submitter_employee_id);
create trigger manpower_requests_stamp before insert or update on public.manpower_requests for each row execute function private.stamp_row();
create trigger manpower_requests_audit after insert or update or delete on public.manpower_requests for each row execute function private.audit_row('hr');
create trigger manpower_requests_no_delete before delete on public.manpower_requests for each row execute function private.prevent_delete();
alter table public.manpower_requests enable row level security;

-- Who may read: the submitter, anyone with HR request rights in scope, and —
-- once approved — every staff member of that hub (hub scope) or zone (zone scope).
create or replace function private.mp_can_read(r public.manpower_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.submitted_by = (select auth.uid())
      or private.has_permission('hr.request.view', r.zone_id, r.hub_id)
      or (r.status = 'approved' and exists (
            select 1 from public.employees e
             where e.profile_id = (select auth.uid()) and e.archived_at is null
               and (e.hub_id = r.hub_id or (r.scope = 'zone' and e.zone_id = r.zone_id))))
$$;
create policy manpower_requests_read on public.manpower_requests for select to authenticated using (private.mp_can_read(manpower_requests));
grant select on public.manpower_requests to authenticated;

-- Profiles that can approve requests for this zone (global or zone grants, and super admins).
create or replace function private.request_approvers(p_zone uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
   where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date) and ur.valid_from <= current_date
     and (r.is_super or p.code = 'hr.request.approve')
     and (ur.scope_type = 'global' or (ur.scope_type = 'zone' and ur.zone_id = p_zone))
$$;
revoke all on function private.request_approvers(uuid) from public, anon, authenticated;

create or replace function public.mp_submit(
  p_hub uuid, p_position uuid, p_needed integer, p_reason text,
  p_pickup integer default null, p_delivery integer default null, p_big integer default null, p_issues text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_zone uuid; v_hub_name text; v_id uuid; v_no text; v_post text; a uuid;
begin
  select * into v_me from public.employees where profile_id = auth.uid() and archived_at is null limit 1;
  select zone_id, name into v_zone, v_hub_name from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'হাব পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not (v_me.hub_id = p_hub or private.has_permission('hr.request.create', v_zone, p_hub)) then
    raise exception 'শুধু নিজের হাবের জন্য লোক চাইতে পারবেন' using errcode = '42501';
  end if;
  if coalesce(p_needed, 0) < 1 then raise exception 'কতজন লাগবে লিখুন' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'কেন লাগবে লিখুন' using errcode = '22023'; end if;
  insert into public.manpower_requests (zone_id, hub_id, position_id, needed, reason, daily_pickup, daily_delivery, big_parcels, other_issues, submitter_employee_id)
  values (v_zone, p_hub, p_position, p_needed, trim(p_reason), p_pickup, p_delivery, p_big, nullif(trim(coalesce(p_issues, '')), ''), v_me.id)
  returning id, request_no into v_id, v_no;
  select coalesce(name_bn, name) into v_post from public.positions where id = p_position;
  for a in select private.request_approvers(v_zone) loop
    perform private.notify(a, 'লোক লাগবে: ' || v_hub_name || ' — ' || coalesce(v_post, 'যেকোনো পদ') || ' ' || p_needed || ' জন',
      v_no || ' · ' || trim(p_reason), '/app/manpower?id=' || v_id, 'manpower');
  end loop;
  return v_id;
end $$;

create or replace function public.mp_decide(
  p_id uuid, p_status text, p_note text default null, p_scope text default 'hub',
  p_notify_positions uuid[] default '{}', p_needed integer default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.manpower_requests;
  v_hub_name text; v_post text; v_title text; v_count integer := 0; p uuid;
begin
  select * into r from public.manpower_requests where id = p_id for update;
  if r.id is null then raise exception 'চাহিদা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.request.approve', r.zone_id, r.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if r.status <> 'submitted' then raise exception 'এই চাহিদার সিদ্ধান্ত আগেই হয়েছে' using errcode = 'P0001'; end if;
  if p_status not in ('approved','rejected') then raise exception 'ভুল সিদ্ধান্ত' using errcode = '22023'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'বাতিলের কারণ লিখুন' using errcode = '22023'; end if;
  if p_scope not in ('hub','zone') then raise exception 'ভুল এলাকা' using errcode = '22023'; end if;

  update public.manpower_requests
     set status = p_status, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''),
         scope = p_scope, notify_positions = coalesce(p_notify_positions, '{}'), needed = coalesce(p_needed, needed)
   where id = p_id returning * into r;
  select name into v_hub_name from public.hubs where id = r.hub_id;
  select coalesce(name_bn, name) into v_post from public.positions where id = r.position_id;

  perform private.notify(r.submitted_by, 'লোক লাগবে ' || r.request_no || ': ' || case when p_status = 'approved' then 'অনুমোদিত' else 'বাতিল' end,
    r.decision_note, '/app/manpower?id=' || r.id, 'manpower');
  if p_status = 'approved' then
    v_title := 'লোক লাগবে — ' || v_hub_name || ': ' || coalesce(v_post, 'যেকোনো পদ') || ' ' || r.needed || ' জন';
    for p in
      select distinct e.profile_id from public.employees e
       where e.profile_id is not null and e.archived_at is null and e.status = 'active'
         and (case when r.scope = 'zone' then e.zone_id = r.zone_id else e.hub_id = r.hub_id end)
         and (cardinality(r.notify_positions) = 0 or e.position_id = any(r.notify_positions))
         and e.profile_id is distinct from r.submitted_by
    loop
      perform private.notify(p, v_title, 'পরিচিত কেউ থাকলে রেফার করুন। ' || r.reason, '/app/manpower?id=' || r.id, 'manpower');
      v_count := v_count + 1;
    end loop;
    update public.manpower_requests set notified_count = v_count where id = r.id;
  end if;
  return v_count;
end $$;

-- Close an approved request (people found / no longer needed) or withdraw one's own.
create or replace function public.mp_close(p_id uuid, p_status text, p_filled integer default null, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.manpower_requests;
begin
  select * into r from public.manpower_requests where id = p_id for update;
  if r.id is null then raise exception 'চাহিদা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if p_status = 'cancelled' then
    if r.submitted_by <> auth.uid() or r.status <> 'submitted' then raise exception 'শুধু নিজের, সিদ্ধান্ত না হওয়া চাহিদা তুলে নেওয়া যায়' using errcode = '42501'; end if;
  elsif p_status in ('filled','closed') then
    if not private.has_permission('hr.request.approve', r.zone_id, r.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if r.status <> 'approved' then raise exception 'শুধু অনুমোদিত চাহিদা বন্ধ করা যায়' using errcode = 'P0001'; end if;
  else raise exception 'ভুল অবস্থা' using errcode = '22023';
  end if;
  update public.manpower_requests set status = p_status, filled = coalesce(p_filled, filled),
         decision_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decision_note)
   where id = p_id;
end $$;

revoke all on function public.mp_submit(uuid, uuid, integer, text, integer, integer, integer, text) from public, anon;
revoke all on function public.mp_decide(uuid, text, text, text, uuid[], integer) from public, anon;
revoke all on function public.mp_close(uuid, text, integer, text) from public, anon;
grant execute on function public.mp_submit(uuid, uuid, integer, text, integer, integer, integer, text) to authenticated;
grant execute on function public.mp_decide(uuid, text, text, text, uuid[], integer) to authenticated;
grant execute on function public.mp_close(uuid, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- Staff change register (for the company Excel file)
-- ---------------------------------------------------------------------
create or replace function public.hr_change_register(p_zone uuid, p_from date, p_to date)
returns table (source text, kind text, event_date date, employee_id uuid, employee_code text, full_name text, mobile text,
               position_name text, from_hub text, to_hub text, from_status text, to_status text, reason text,
               request_no text, request_status text, reference text, done_by text, recorded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- moves made in the system (not joining / exit, which show as status)
  select 'system', a.change_type, a.effective_from, e.id, e.employee_code::text, e.full_name, e.mobile,
         coalesce(po.name_bn, po.name), ph.name, h.name, null::text, null::text, a.reason, null::text, null::text, null::text,
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = a.created_by limit 1),
         a.created_at
    from public.employee_assignments a
    join public.employees e on e.id = a.employee_id
    left join public.positions po on po.id = a.position_id
    left join public.hubs h on h.id = a.hub_id
    left join lateral (select p.hub_id from public.employee_assignments p where p.employee_id = a.employee_id and p.id <> a.id
                         and p.effective_to is not null and p.effective_from <= a.effective_from
                       order by p.effective_to desc, p.effective_from desc limit 1) prev on true
    left join public.hubs ph on ph.id = prev.hub_id
   where a.change_type in ('transfer','promotion','correction')
     and a.effective_from between p_from and p_to
     and (p_zone is null or a.zone_id = p_zone or e.zone_id = p_zone)
     and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  union all
  -- status changes (inactive -> active, resign, terminate ...)
  select 'system', 'status', (l.occurred_at at time zone 'Asia/Dhaka')::date, e.id, e.employee_code::text, e.full_name, e.mobile,
         coalesce(po.name_bn, po.name), h.name, null, l.old_data ->> 'status', l.new_data ->> 'status', l.reason, null, null, null,
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = l.actor_id limit 1),
         l.occurred_at
    from public.audit_logs l
    join public.employees e on e.id::text = l.record_id
    left join public.positions po on po.id = e.position_id
    left join public.hubs h on h.id = e.hub_id
   where l.table_name = 'employees' and 'status' = any(l.changed_fields)
     and coalesce(l.old_data ->> 'status', '') <> 'applicant'
     and (l.occurred_at at time zone 'Asia/Dhaka')::date between p_from and p_to
     and (p_zone is null or e.zone_id = p_zone)
     and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  union all
  -- HR requests (marked for the company file)
  select 'request', r.kind, coalesce(nullif(r.data ->> 'effective_date', '')::date, nullif(r.data ->> 'last_date', '')::date, (r.created_at at time zone 'Asia/Dhaka')::date),
         e.id, coalesce(e.employee_code::text, r.data ->> 'employee_code'), coalesce(e.full_name, r.data ->> 'full_name'), coalesce(e.mobile, r.data ->> 'mobile'),
         coalesce(po.name_bn, po.name, r.data ->> 'position'), coalesce(h.name, r.data ->> 'from_hub', r.data ->> 'hub'),
         coalesce(th.name, case when r.data ->> 'to_hub' !~ '^[0-9a-f-]{36}$' then r.data ->> 'to_hub' end),
         null, null, coalesce(r.data ->> 'reason', r.data ->> 'reason_type', r.note), r.request_no, r.status,
         nullif(concat_ws(' ', r.ref_name, '(' || r.ref_code || ')'), ''),
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = r.submitted_by limit 1),
         r.created_at
    from public.hr_requests r
    left join public.employees e on e.id = r.employee_id
    left join public.positions po on po.id = e.position_id
    left join public.hubs h on h.id = coalesce(e.hub_id, r.hub_id)
    left join public.hubs th on th.id::text = r.data ->> 'to_hub'
   where r.kind in ('id_transfer','id_active','id_inactive','id_create') and r.status <> 'cancelled'
     and (r.created_at at time zone 'Asia/Dhaka')::date between p_from and p_to
     and (p_zone is null or r.zone_id = p_zone)
     and private.has_permission('hr.request.view', r.zone_id, r.hub_id)
  order by 18 desc
$$;
revoke all on function public.hr_change_register(uuid, date, date) from public, anon;
grant execute on function public.hr_change_register(uuid, date, date) to authenticated;

-- Hub x post headcount (active staff) with open manpower needs, for the zonal matrix.
create or replace function public.hr_hub_post_matrix(p_zone uuid default null)
returns table (hub_id uuid, hub_name text, position_id uuid, position_name text, sort_order integer, active integer, inactive integer, applicant integer, needed integer)
language sql stable security definer set search_path = '' as $$
  with staff as (
    select e.hub_id, e.position_id,
           count(*) filter (where e.status = 'active')::integer act,
           count(*) filter (where e.status = 'inactive')::integer inact,
           count(*) filter (where e.status = 'applicant')::integer appl
      from public.employees e
     where e.archived_at is null and e.hub_id is not null and e.status in ('active','inactive','applicant')
     group by 1, 2),
  need as (
    select m.hub_id, m.position_id, sum(greatest(m.needed - m.filled, 0))::integer n
      from public.manpower_requests m where m.status = 'approved' group by 1, 2)
  select h.id, h.name, coalesce(s.position_id, n.position_id), coalesce(p.name_bn, p.name, 'পদ ছাড়া'), coalesce(p.sort_order, 999),
         coalesce(s.act, 0), coalesce(s.inact, 0), coalesce(s.appl, 0), coalesce(n.n, 0)
    from public.hubs h
    join (select hub_id, position_id from staff union select hub_id, position_id from need) k on k.hub_id = h.id
    left join staff s on s.hub_id = k.hub_id and s.position_id is not distinct from k.position_id
    left join need n on n.hub_id = k.hub_id and n.position_id is not distinct from k.position_id
    left join public.positions p on p.id = k.position_id
   where h.archived_at is null and (p_zone is null or h.zone_id = p_zone)
     and private.has_permission('hr.employee.view', h.zone_id, h.id)
   order by h.name, 5
$$;
revoke all on function public.hr_hub_post_matrix(uuid) from public, anon;
grant execute on function public.hr_hub_post_matrix(uuid) to authenticated;
-- =====================================================================
-- XZM-TEAM ERP — Migration: assign hubs to a sorting center
--
--  A sorting center serves a set of hubs. Each hub belongs to at most one
--  sorting center (hubs.sorting_center_id). The center may also point to the
--  hub record that is the center itself (e.g. "Natore Shorting Centre"), so
--  that hub's staff are the center's staff. Set in one call from the
--  Sorting Center page; every change is audited on hubs.
-- =====================================================================

alter table public.hubs add column if not exists sorting_center_id uuid references public.sorting_centers(id);
create index if not exists hubs_sorting_center_ix on public.hubs (sorting_center_id);
alter table public.sorting_centers add column if not exists home_hub_id uuid references public.hubs(id);
create index if not exists sorting_centers_home_hub_ix on public.sorting_centers (home_hub_id);

create or replace function public.sorting_assign_hubs(p_center uuid, p_hubs uuid[], p_home_hub uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.sorting_centers; v_bad integer; v_n integer;
begin
  select * into c from public.sorting_centers where id = p_center and archived_at is null for update;
  if c.id is null then raise exception 'শটিং সেন্টার পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.center.edit', c.zone_id, null) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  p_hubs := coalesce(p_hubs, '{}');
  select count(*) into v_bad from public.hubs h where h.id = any(p_hubs) and (h.zone_id <> c.zone_id or h.archived_at is not null);
  if v_bad > 0 then raise exception 'শুধু এই সেন্টারের এরিয়ার চালু হাব এসাইন করা যায়' using errcode = '22023'; end if;
  if p_home_hub is not null and not exists (select 1 from public.hubs h where h.id = p_home_hub and h.zone_id = c.zone_id and h.archived_at is null) then
    raise exception 'সেন্টারের নিজের হাব এই এরিয়ার হতে হবে' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', 'Sorting center ' || c.name || ': hub assignment', true);
  update public.hubs set sorting_center_id = null where sorting_center_id = p_center and not (id = any(p_hubs));
  update public.hubs set sorting_center_id = p_center where id = any(p_hubs) and sorting_center_id is distinct from p_center;
  update public.sorting_centers set home_hub_id = p_home_hub where id = p_center and home_hub_id is distinct from p_home_hub;
  select count(*) into v_n from public.hubs where sorting_center_id = p_center;
  return v_n;
end $$;
revoke all on function public.sorting_assign_hubs(uuid, uuid[], uuid) from public, anon;
grant execute on function public.sorting_assign_hubs(uuid, uuid[], uuid) to authenticated;
-- =====================================================================
-- XZM-TEAM ERP — Migration: hub addresses live in the Office section
--
--  * office_create_hub_offices(): one click makes an office record for every
--    active hub that has none yet — name, address and the sorting center
--    (when the hub is a center's own hub or is served by one) come from the hub.
--  * Editing the address of a hub's office updates the hub's address too, so
--    the address is kept in one place.
-- =====================================================================

create or replace function public.office_create_hub_offices(p_zone uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; v_n integer := 0;
begin
  for h in
    select hb.* from public.hubs hb
     where hb.archived_at is null and hb.status = 'active'
       and (p_zone is null or hb.zone_id = p_zone)
       and private.has_permission('office.property.create', hb.zone_id, hb.id)
       and not exists (select 1 from public.office_properties p where p.hub_id = hb.id and p.kind = 'office' and p.archived_at is null)
  loop
    insert into public.office_properties (code, name, kind, zone_id, hub_id, sorting_center_id, address, note)
    values ('HUB-' || h.code, h.name, 'office', h.zone_id, h.id,
            coalesce((select c.id from public.sorting_centers c where c.home_hub_id = h.id and c.archived_at is null limit 1), h.sorting_center_id),
            h.address, case when h.phone is not null then 'হাবের ফোন: ' || h.phone end)
    on conflict (code) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.office_create_hub_offices(uuid) from public, anon;
grant execute on function public.office_create_hub_offices(uuid) to authenticated;

create or replace function private.office_address_to_hub() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hub_id is not null and new.kind = 'office' and new.archived_at is null
     and nullif(trim(coalesce(new.address, '')), '') is not null
     and (tg_op = 'INSERT' or new.address is distinct from old.address or new.hub_id is distinct from old.hub_id) then
    perform set_config('app.change_reason', 'Address from office ' || new.name, true);
    update public.hubs set address = new.address where id = new.hub_id and address is distinct from new.address;
  end if;
  return new;
end $$;
drop trigger if exists office_properties_hub_address on public.office_properties;
create trigger office_properties_hub_address after insert or update of address, hub_id on public.office_properties
  for each row execute function private.office_address_to_hub();
