-- =====================================================================
-- LOCAL TEST SHIM — NEVER run this against a real Supabase project.
-- Recreates the small parts of Supabase that our migrations depend on
-- (roles, auth.users, auth.uid(), default grants) so migrations and RLS
-- policies can be tested on a plain PostgreSQL server.
-- On real Supabase these objects already exist.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Same definition Supabase uses: reads the JWT claims PostgREST puts in the GUC.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- Supabase grants table privileges in `public` to the API roles by default.
-- Reproduce that so tests prove RLS (not missing grants) is what protects data.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
do $$ begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;

-- Minimal Supabase Storage tables so migrations that create buckets and object policies can run locally.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;

-- pg_cron stand-in (local tests only): live schedules jobs with cron.schedule; here they are recorded and never run.
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(p_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = p_name returning 1) select exists (select 1 from d) $$;
