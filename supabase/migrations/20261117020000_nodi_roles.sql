-- নদী AI — choose which roles can see/use it (role-wise show/hide).
-- Backed by the existing 'nodi.assistant.view' grant on role_permissions, so the menu,
-- the floating button and nodi_gate() all follow it with no other change.
-- Roles that hold 'nodi.settings.configure' (or are super) always keep access, so nobody can lock themselves out.

create or replace function public.nodi_roles()
returns table (code text, name text, name_bn text, enabled boolean, locked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('nodi.settings.configure') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return query
  select r.code::text, r.name, r.name_bn,
         (r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                                where rp.role_id = r.id and p.code in ('nodi.assistant.view', 'nodi.settings.configure'))),
         (r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                                where rp.role_id = r.id and p.code = 'nodi.settings.configure'))
  from public.roles r
  where r.archived_at is null and r.status = 'active'
  order by r.name;
end $$;

create or replace function public.nodi_set_roles(p_codes text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare v_perm uuid;
begin
  if not private.has_permission('nodi.settings.configure') then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  select id into v_perm from public.permissions where code = 'nodi.assistant.view';
  perform set_config('app.change_reason', 'নদী AI কোন ভূমিকা দেখবে', true);
  -- remove the grant from roles not chosen (settings-level roles are never touched)
  delete from public.role_permissions rp using public.roles r
   where rp.role_id = r.id and rp.permission_id = v_perm
     and not (r.code::text = any (coalesce(p_codes, '{}')))
     and not exists (select 1 from public.role_permissions x join public.permissions px on px.id = x.permission_id
                     where x.role_id = r.id and px.code = 'nodi.settings.configure');
  insert into public.role_permissions (role_id, permission_id)
  select r.id, v_perm from public.roles r
   where r.code::text = any (coalesce(p_codes, '{}')) and r.archived_at is null and r.status = 'active'
  on conflict do nothing;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.nodi_roles()', 'public.nodi_set_roles(text[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
