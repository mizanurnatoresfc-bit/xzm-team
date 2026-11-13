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
