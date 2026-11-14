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
