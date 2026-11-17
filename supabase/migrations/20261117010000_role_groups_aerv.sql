-- =====================================================================
--  Role groups + AERV permissions (owner, 17 Nov 2026)
--
--  1. Every role belongs to one of three groups, which decides the menu
--     panels, the home view and the tab bar the people holding it get:
--       'zone' = সুপার অ্যাডমিন / জোনাল ম্যানেজার
--       'hub'  = ম্যানেজার
--       'self' = স্টাফ / রাইডার
--     role_dashboards.panel_group: null = worked out from the role's
--     permissions, as before. Setting a group also sets the role's
--     default home view to the same group.
--
--  2. AERV: per feature, the Super Admin ticks Add / Edit / Remove / View
--     for a role. The app works out which permission codes each tick means;
--     the database only adds or takes away those exact codes, and checks
--     every one exists. The Super Admin role cannot be changed.
--
--  Additive only. Rollback: drop my_panel_group, role_group_list,
--  role_group_set, role_aerv_save; the column panel_group may stay
--  (null everywhere = groups worked out from permissions, as before).
-- =====================================================================

alter table public.role_dashboards add column if not exists panel_group text;
alter table public.role_dashboards drop constraint if exists role_dashboards_group_chk;
alter table public.role_dashboards add constraint role_dashboards_group_chk
  check (panel_group is null or panel_group in ('self', 'hub', 'zone'));

-- The caller's group: the highest group among their current roles; a Super
-- Admin is always 'zone'. null = no role has a group set (the app works it out).
create or replace function public.my_panel_group() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then null
    when private.is_super_admin() then 'zone'
    else (select d.panel_group
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id and r.archived_at is null
            join public.role_dashboards d on d.role_id = r.id
           where ur.user_id = auth.uid() and ur.revoked_at is null
             and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
             and d.panel_group is not null
           order by case d.panel_group when 'zone' then 1 when 'hub' then 2 else 3 end
           limit 1)
  end
$$;

-- Every role with its group, home view, users and permission codes (Super Admin only).
create or replace function public.role_group_list()
returns table (role_id uuid, code text, name text, name_bn text, is_super boolean, is_system boolean,
               panel_group text, default_view text, user_count integer, permissions text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can see role groups.' using errcode = '42501';
  end if;
  return query
  select r.id, r.code::text, r.name, r.name_bn, r.is_super, r.is_system,
         case when r.is_super then 'zone' else d.panel_group end, d.default_view,
         (select count(*)::int from public.user_roles ur where ur.role_id = r.id and ur.revoked_at is null),
         coalesce((select array_agg(p.code::text order by p.code)
                     from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                    where rp.role_id = r.id), '{}')
  from public.roles r
  left join public.role_dashboards d on d.role_id = r.id
  where r.archived_at is null
  order by r.is_super desc, r.name;
end $$;

-- Put a role in a group (null = work it out from permissions). Its home view follows.
create or replace function public.role_group_set(p_role uuid, p_group text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can change role groups.' using errcode = '42501';
  end if;
  if p_group is not null and p_group not in ('self', 'hub', 'zone') then
    raise exception 'Unknown group: %.', p_group using errcode = '22023';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role and r.archived_at is null) then
    raise exception 'Role not found.' using errcode = '22023';
  end if;
  if exists (select 1 from public.roles r where r.id = p_role and r.is_super) then
    raise exception 'সুপার অ্যাডমিন সবসময় সবার উপরের গ্রুপে থাকে।' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', 'রোলের গ্রুপ বদল', true);
  insert into public.role_dashboards (role_id, panels, panel_group, default_view)
  values (p_role, '[]'::jsonb, p_group, p_group)
  on conflict (role_id) do update
    set panel_group = excluded.panel_group,
        default_view = coalesce(excluded.panel_group, public.role_dashboards.default_view);
end $$;

-- AERV save: add and take away exact permission codes on one role. Returns
-- how many permissions the role has afterwards.
create or replace function public.role_aerv_save(p_role uuid, p_grant text[], p_revoke text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_unknown text;
  v_count integer;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can change role permissions.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role and r.archived_at is null) then
    raise exception 'Role not found.' using errcode = '22023';
  end if;
  if exists (select 1 from public.roles r where r.id = p_role and r.is_super) then
    raise exception 'The Super Admin role always has every permission and cannot be edited.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_grant), 0) + coalesce(cardinality(p_revoke), 0) > 600 then
    raise exception 'Too many changes at once.' using errcode = '22023';
  end if;
  select x into v_unknown from unnest(coalesce(p_grant, '{}') || coalesce(p_revoke, '{}')) x
   where not exists (select 1 from public.permissions p where p.code = x) limit 1;
  if v_unknown is not null then
    raise exception 'Unknown permission %.', v_unknown using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_grant, '{}')) g where g = any(coalesce(p_revoke, '{}'))) then
    raise exception 'A permission cannot be added and taken away at once.' using errcode = '22023';
  end if;

  perform set_config('app.change_reason', 'AERV অনুমতি (সুপার অ্যাডমিন)', true);
  delete from public.role_permissions rp
   using public.permissions p
   where rp.role_id = p_role and p.id = rp.permission_id and p.code = any(coalesce(p_revoke, '{}'));
  insert into public.role_permissions (role_id, permission_id)
  select p_role, p.id from public.permissions p where p.code = any(coalesce(p_grant, '{}'))
  on conflict do nothing;

  select count(*)::int into v_count from public.role_permissions where role_id = p_role;
  return v_count;
end $$;

revoke all on function public.my_panel_group() from public, anon;
revoke all on function public.role_group_list() from public, anon;
revoke all on function public.role_group_set(uuid, text) from public, anon;
revoke all on function public.role_aerv_save(uuid, text[], text[]) from public, anon;
grant execute on function public.my_panel_group() to authenticated;
grant execute on function public.role_group_list() to authenticated;
grant execute on function public.role_group_set(uuid, text) to authenticated;
grant execute on function public.role_aerv_save(uuid, text[], text[]) to authenticated;
