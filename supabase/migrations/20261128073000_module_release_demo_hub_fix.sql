-- Priority 01 hotfix: DEMO hub detection matches real hub codes.
-- Staging and production seed DEMO hubs as `DEMO-HUB`, `DEMO-HUB-2`, `DEMO-HUB-3`
-- (one per testing zone), but the original 20261128062647 migration matches only the
-- bare code `demo`. That made module_release_save reject every DEMO opt-in with
-- "An active DEMO hub is required" and left release_context silently non-DEMO, so the
-- Release Ready / Testing workflow against the real staging hubs would never pass.
--
-- Fix: accept a hub whose code is literally `demo` OR starts with `demo-`. This stays
-- deliberately strict (a hub called `demo-site` or `demolition` still fails), so no
-- real hub is silently promoted into DEMO scope.

create or replace function private.release_context(p_hub uuid, p_preview uuid)
returns table (hub uuid, roles text[], demo boolean)
language sql stable set search_path = '' as $$
  with assignments as (
    select u.role_id, u.scope_type, u.hub_id, u.zone_id
    from public.user_roles u join public.profiles p on p.id = u.user_id
    join public.roles r on r.id = u.role_id
    where u.user_id = auth.uid() and p.status = 'active' and p.archived_at is null
      and (p.locked_until is null or p.locked_until < now())
      and r.status = 'active' and r.archived_at is null and u.revoked_at is null
      and u.valid_from <= current_date and (u.valid_to is null or u.valid_to >= current_date)
  ), preferred as (
    select coalesce(p_hub, (select min(hub_id::text)::uuid from assignments
      having count(distinct hub_id) = 1 and not bool_or(scope_type <> 'hub'))) as id
  ), scoped as (
    select h.id, h.zone_id,
      (lower(h.code::text) = 'demo' or lower(h.code::text) like 'demo-%') as demo
    from preferred x join public.hubs h on h.id = x.id
    where h.status = 'active' and h.archived_at is null
      and (p_preview is not null or exists (select 1 from assignments a
           where a.scope_type = 'global' or a.zone_id = h.zone_id or a.hub_id = h.id))
  )
  select s.id,
    case when p_preview is not null then array[p_preview::text]
      else array(select distinct a.role_id::text from assignments a
        where (s.id is null and p_hub is null) or a.scope_type = 'global' or a.zone_id = s.zone_id or a.hub_id = s.id) end,
    coalesce(s.demo, false)
  from (select 1) singleton left join scoped s on true
$$;
revoke execute on function private.release_context(uuid, uuid) from public, anon, authenticated;

-- module_release_save's DEMO-hub prerequisite applies the same match.
create or replace function public.module_release_save(p_module text, p_revision bigint, p_config jsonb, p_rollback bigint default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_old private.release_config%rowtype;
  v_module private.release_module%rowtype;
  v_config jsonb := p_config;
  v_revision bigint;
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501';
  end if;
  select * into strict v_module from private.release_module where id = p_module for update;
  select * into v_old from private.release_config where module = p_module;
  if coalesce(v_old.revision, 0) is distinct from p_revision then
    raise exception 'Configuration changed. Reload and try again.' using errcode = '40001';
  end if;
  if p_rollback is not null then
    select before_config into strict v_config from private.release_audit where id = p_rollback and module = p_module;
  end if;
  if v_config is null or jsonb_typeof(v_config) <> 'object' then
    raise exception 'Configuration must be an object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_config) k where not (private.release_default(true) ? k)) then
    raise exception 'Unknown release setting' using errcode = '22023';
  end if;
  v_config := private.release_default(v_module.legacy_live) || v_config;
  if coalesce(v_config->>'stage', '') not in ('planning','development','testing','ready','published','maintenance','disabled')
    or jsonb_typeof(v_config->'enabled') <> 'boolean' or jsonb_typeof(v_config->'demo') <> 'boolean'
    or jsonb_typeof(v_config->'users') <> 'object' or jsonb_typeof(v_config->'platforms') <> 'array'
    or jsonb_typeof(v_config->'roles') not in ('array','null') or jsonb_typeof(v_config->'hubs') not in ('array','null')
    or (v_config->'menu_order' <> 'null'::jsonb and
      (jsonb_typeof(v_config->'menu_order') <> 'number' or coalesce(v_config->>'menu_order', '') !~ '^-?[0-9]{1,8}$'))
  then raise exception 'Invalid release settings' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(v_config->'platforms') x where x not in ('"web"'::jsonb, '"android"'::jsonb))
    or exists (select 1 from jsonb_each(v_config->'users') u
      where jsonb_typeof(u.value) <> 'boolean' or not exists (select 1 from public.profiles p where p.id::text = u.key))
    or exists (select 1 from jsonb_array_elements_text(coalesce(nullif(v_config->'roles', 'null'::jsonb), '[]'::jsonb)) x
      where not exists (select 1 from public.roles r where r.id::text = x))
    or exists (select 1 from jsonb_array_elements_text(coalesce(nullif(v_config->'hubs', 'null'::jsonb), '[]'::jsonb)) x
      where not exists (select 1 from public.hubs h where h.id::text = x))
  then raise exception 'Invalid release scope' using errcode = '22023'; end if;
  if (v_config->>'demo')::boolean and not exists (select 1 from public.hubs
    where (lower(code::text) = 'demo' or lower(code::text) like 'demo-%')
      and status = 'active' and archived_at is null) then
    raise exception 'An active DEMO hub is required' using errcode = '22023';
  end if;
  if (v_config->>'stage' = 'ready' or (v_config->>'stage' = 'published' and not v_module.legacy_live))
      and not private.release_ready(p_module) then
    raise exception 'Verified test and deployment evidence required' using errcode = '22023';
  end if;
  insert into private.release_audit(module, actor, before_config, after_config, rollback_of)
  values (p_module, auth.uid(), coalesce(v_old.config, private.release_default(v_module.legacy_live)), v_config, p_rollback)
  returning id into v_revision;
  insert into private.release_config(module, revision, config) values (p_module, v_revision, v_config)
  on conflict (module) do update set revision = excluded.revision, config = excluded.config;
  return v_revision;
end $$;
revoke all on function public.module_release_save(text, bigint, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.module_release_save(text, bigint, jsonb, bigint) to authenticated;
