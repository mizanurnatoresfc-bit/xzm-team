-- Private configuration. The only client writes go through the audited admin RPC.
create table private.release_module (
  id text primary key,
  parent text references private.release_module(id),
  legacy_live boolean not null default false,
  check (parent is null or (parent = left(id, length(parent)) and substr(id, length(parent) + 1, 1) = '.'))
);
create table private.release_config (
  module text primary key references private.release_module(id),
  revision bigint not null,
  config jsonb not null
);
create table private.release_audit (
  id bigint generated always as identity primary key,
  module text not null references private.release_module(id),
  actor uuid not null,
  created_at timestamptz not null default now(),
  before_config jsonb,
  after_config jsonb not null,
  rollback_of bigint references private.release_audit(id)
);
create index release_audit_module_idx on private.release_audit(module, id desc);
create table private.release_evidence (
  id bigint generated always as identity primary key,
  module text not null references private.release_module(id),
  pr integer not null check (pr > 0),
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{40}$'),
  test_run bigint not null check (test_run > 0),
  test_result text not null check (test_result in ('pending', 'failure', 'success')),
  deployment text not null check (deployment in ('pending', 'failure', 'preview_verified', 'production_verified')),
  recorded_at timestamptz not null default now()
);
create index release_evidence_module_idx on private.release_evidence(module, id desc);
alter table private.release_module enable row level security;
alter table private.release_config enable row level security;
alter table private.release_audit enable row level security;
alter table private.release_evidence enable row level security;
revoke all on private.release_module, private.release_config, private.release_audit, private.release_evidence from public, anon, authenticated;

insert into private.release_module (id, parent) values
  ('access', null),
  ('access.role', 'access'),
  ('access.role.id', 'access.role'),
  ('access.section', 'access'),
  ('access.user', 'access'),
  ('access.user.id', 'access.user'),
  ('accounts', null),
  ('accounts.center', 'accounts'),
  ('accounts.daily', 'accounts'),
  ('accounts.daily.id', 'accounts.daily'),
  ('accounts.daily.id.main', 'accounts.daily.id'),
  ('accounts.khata', 'accounts'),
  ('accounts.learn', 'accounts'),
  ('accounts.mine', 'accounts'),
  ('accounts.report-import', 'accounts'),
  ('accounts.reports', 'accounts'),
  ('accounts.settings', 'accounts'),
  ('attendance', null),
  ('branding', null),
  ('dashboard', null),
  ('dashboard.accounts-today', 'dashboard'),
  ('dashboard.approvals', 'dashboard'),
  ('dashboard.cash-today', 'dashboard'),
  ('dashboard.hub-today', 'dashboard'),
  ('dashboard.hr-overview', 'dashboard'),
  ('dashboard.hr-pending', 'dashboard'),
  ('dashboard.hub-staff', 'dashboard'),
  ('dashboard.ops-today', 'dashboard'),
  ('dashboard.my-day', 'dashboard'),
  ('dashboard.my-requests', 'dashboard'),
  ('dashboard.my-work', 'dashboard'),
  ('dashboard.network', 'dashboard'),
  ('dashboard.office-items', 'dashboard'),
  ('dashboard.quick-links', 'dashboard'),
  ('dashboard.zonal-overview', 'dashboard'),
  ('fleet', null),
  ('fleet.mine', 'fleet'),
  ('hr', null),
  ('hr.duties', 'hr'),
  ('hr.employees', 'hr'),
  ('hr.employees.id', 'hr.employees'),
  ('hr.fields', 'hr'),
  ('hr.import', 'hr'),
  ('hr.profile-gaps', 'hr'),
  ('hr.referrals', 'hr'),
  ('hr.requests', 'hr'),
  ('hub', null),
  ('hub-registers', null),
  ('hub.accounts', 'hub'),
  ('hub.logins', 'hub'),
  ('hub.ops', 'hub'),
  ('hub.pickup', 'hub'),
  ('hub.section', 'hub'),
  ('hub.tasks', 'hub'),
  ('issues', null),
  ('manpower', null),
  ('me', null),
  ('me.permissions', 'me'),
  ('menu', null),
  ('menu-roles', null),
  ('nodi', null),
  ('nodi.action-chat', 'nodi'),
  ('nodi.action-office', 'nodi'),
  ('nodi.action-teach', 'nodi'),
  ('nodi.chat', 'nodi'),
  ('notices', null),
  ('notifications', null),
  ('office', null),
  ('office.assets', 'office'),
  ('office.bills', 'office'),
  ('office.desks', 'office'),
  ('office.notices', 'office'),
  ('office.places', 'office'),
  ('office.reports', 'office'),
  ('office.residential.places', 'office.residential'),
  ('office.residential.reports', 'office.residential'),
  ('office.overview', 'office'),
  ('office.people', 'office'),
  ('office.power', 'office'),
  ('office.rent', 'office'),
  ('office.residential', 'office'),
  ('office.residential.assets', 'office.residential'),
  ('office.residential.bills', 'office.residential'),
  ('office.residential.desks', 'office.residential'),
  ('office.residential.notices', 'office.residential'),
  ('office.residential.overview', 'office.residential'),
  ('office.residential.people', 'office.residential'),
  ('office.residential.power', 'office.residential'),
  ('office.residential.rent', 'office.residential'),
  ('office.residential.rooms', 'office.residential'),
  ('office.residential.section', 'office.residential'),
  ('office.residential.security', 'office.residential'),
  ('office.residential.zone', 'office.residential'),
  ('office.rooms', 'office'),
  ('office.section', 'office'),
  ('office.security', 'office'),
  ('office.zone', 'office'),
  ('org', null),
  ('org.hubs', 'org'),
  ('preview', null),
  ('preview.flow-mockups', 'preview'),
  ('references', null),
  ('role-dashboards', null),
  ('roles', null),
  ('roles.id', 'roles'),
  ('rollout', null),
  ('routes', null),
  ('routes.tab-routes', 'routes'),
  ('routes.tab-locations', 'routes'),
  ('routes.tab-places', 'routes'),
  ('routes.tab-cover', 'routes'),
  ('routes.tab-morning', 'routes'),
  ('routes.tab-load', 'routes'),
  ('routes.tab-day', 'routes'),
  ('routes.tab-warn', 'routes'),
  ('routes.tab-rules', 'routes'),
  ('routes.tab-hub', 'routes'),
  ('routes.tab-map', 'routes'),
  ('routes.tab-plan', 'routes'),
  ('routes.tab-sorting', 'routes'),
  ('settings', null),
  ('sorting', null),
  ('sorting.centers', 'sorting'),
  ('sorting.dashboard', 'sorting'),
  ('sorting.drivers', 'sorting'),
  ('sorting.fuel', 'sorting'),
  ('sorting.parcels', 'sorting'),
  ('sorting.reports', 'sorting'),
  ('sorting.section', 'sorting'),
  ('sorting.staff', 'sorting'),
  ('staff', null),
  ('staff.entry', 'staff'),
  ('staff.list', 'staff'),
  ('training', null),
  ('users', null),
  ('users.id', 'users'),
  ('workforce', null),
  ('workforce.given', 'workforce'),
  ('workforce.hand', 'workforce'),
  ('workforce.tab', 'workforce'),
  ('zonal', null),
  ('zonal.assistant', 'zonal'),
  ('zonal.files', 'zonal'),
  ('zonal.hr-records', 'zonal'),
  ('zonal.hub-ops', 'zonal'),
  ('zonal.hub-ops.hub', 'zonal.hub-ops'),
  ('zonal.hub-ops.hub.hub', 'zonal.hub-ops.hub'),
  ('zonal.hub-ops.hub.hub.d', 'zonal.hub-ops.hub.hub'),
  ('zonal.profile', 'zonal'),
  ('zonal.requests', 'zonal');
update private.release_module set legacy_live = true;

create function private.release_default(p_live boolean) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('stage', case when p_live then 'published' else 'planning' end,
    'enabled', true, 'roles', null, 'hubs', null, 'users', '{}'::jsonb,
    'platforms', jsonb_build_array('web', 'android'), 'demo', false, 'menu_order', null)
$$;

create function private.release_ready(p_module text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select test_result = 'success' and deployment in ('preview_verified', 'production_verified')
    from private.release_evidence where module = p_module order by id desc limit 1), false)
$$;

-- Administrative preview uses only the selected role and excludes user exceptions.
-- For live requests the scope comes from current assignments, never from JWT user metadata.
create function private.release_context(p_hub uuid, p_preview uuid)
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
    select h.id, h.zone_id, lower(h.code::text) = 'demo' as demo
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

create function private.release_rule(p_cfg jsonb, p_platform text, p_hub uuid, p_roles text[], p_demo boolean, p_user uuid)
returns boolean language sql immutable set search_path = '' as $$
  select (p_cfg->>'enabled')::boolean
    and (p_cfg->>'stage' = 'published' or
      ((p_cfg->>'demo')::boolean and p_demo and p_cfg->>'stage' in ('testing', 'ready')))
    and case when p_platform is null then p_cfg->'platforms' ?& array['web','android']
             else p_cfg->'platforms' ? p_platform end
    and (p_cfg->'hubs' = 'null'::jsonb or p_cfg->'hubs' ? p_hub::text)
    and coalesce((p_cfg->'users'->>p_user::text)::boolean,
       p_cfg->'roles' = 'null'::jsonb or p_cfg->'roles' ?| p_roles)
$$;

create function private.release_decisions(p_platform text, p_hub uuid, p_preview uuid)
returns table (module text, allowed boolean, menu_order integer)
language sql stable set search_path = '' as $$
  with recursive subject as (
    select * from private.release_context(p_hub, p_preview)
  ), rules as (
    select m.id, m.parent, coalesce(c.config, private.release_default(m.legacy_live)) as cfg
    from private.release_module m left join private.release_config c on c.module = m.id
  ), local_rules as (
    select r.id, r.parent, (r.cfg->>'menu_order')::integer as rank,
      private.release_rule(r.cfg, p_platform, s.hub, s.roles, s.demo,
          case when p_preview is null then auth.uid() end) is true as allowed
    from rules r cross join subject s
  ), effective as (
    select id, allowed, rank from local_rules where parent is null
    union all
    select l.id, e.allowed and l.allowed, l.rank from local_rules l join effective e on e.id = l.parent
  )
  select id, allowed, rank from effective
$$;

create function public.module_release_snapshot(p_platform text, p_hub uuid default null, p_preview uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_platform is null or p_platform not in ('web','android')
      or (p_preview is not null and not private.is_super_admin()) then
    raise exception 'Release configuration access denied' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_object_agg(module, jsonb_build_object('allowed', allowed, 'order', menu_order)), '{}'::jsonb)
    from private.release_decisions(p_platform, p_hub, p_preview));
end $$;

-- Single-endpoint path for RPC and RLS hot paths. Walk only the requested module's dependencies.
create function private.release_api_allowed(p_module text, p_hub uuid)
returns boolean language sql stable set search_path = '' as $$
  with recursive ancestors as (
    select id, parent, legacy_live from private.release_module where id = p_module
    union all
    select m.id, m.parent, m.legacy_live from private.release_module m join ancestors a on m.id = a.parent
  )
  select coalesce(bool_and(private.release_rule(coalesce(c.config, private.release_default(a.legacy_live)),
    null, s.hub, s.roles, s.demo, auth.uid()) is true), false)
  from ancestors a left join private.release_config c on c.module = a.id
  cross join private.release_context(p_hub, null) s
$$;

-- Call inside feature RPCs or edge functions in addition to their own authorization.
-- Direct APIs have no verified Android/Web identity. Apply the intersection there.
create function public.module_release_require(p_module text, p_hub uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.release_api_allowed(p_module, p_hub) then
    raise exception 'Module release access denied' using errcode = '42501';
  end if;
end $$;

create function public.module_release_admin()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'modules', (select jsonb_agg(jsonb_build_object('id', m.id, 'parent', m.parent,
      'revision', coalesce(c.revision, 0), 'config', coalesce(c.config, private.release_default(m.legacy_live)),
      'evidence', to_jsonb(e), 'verified', private.release_ready(m.id)) order by m.id)
      from private.release_module m left join private.release_config c on c.module = m.id
      left join lateral (select * from private.release_evidence where module = m.id order by id desc limit 1) e on true),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
      from public.roles where status = 'active' and archived_at is null),
    'hubs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) order by name), '[]'::jsonb)
      from public.hubs where status = 'active' and archived_at is null));
end $$;

create function public.module_release_history(p_module text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc)
    from (select * from private.release_audit where module = p_module order by id desc limit 50) h), '[]'::jsonb);
end $$;

create function public.module_release_save(p_module text, p_revision bigint, p_config jsonb, p_rollback bigint default null)
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
    where lower(code::text) = 'demo' and status = 'active' and archived_at is null) then
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

-- Integration identity only. Browser admins cannot certify their own release.
create function public.module_release_record_evidence(p_module text, p_pr integer, p_commit text, p_run bigint,
  p_tests text, p_deployment text) returns void
language sql security definer set search_path = '' as $$
  insert into private.release_evidence(module, pr, commit_sha, test_run, test_result, deployment)
  values (p_module, p_pr, p_commit, p_run, p_tests, p_deployment)
$$;

revoke execute on function private.release_default(boolean), private.release_ready(text),
  private.release_context(uuid,uuid), private.release_rule(jsonb,text,uuid,text[],boolean,uuid),
  private.release_decisions(text,uuid,uuid), private.release_api_allowed(text,uuid) from public, anon, authenticated;
revoke execute on function public.module_release_snapshot(text,uuid,uuid), public.module_release_require(text,uuid),
  public.module_release_admin(), public.module_release_history(text), public.module_release_save(text,bigint,jsonb,bigint),
  public.module_release_record_evidence(text,integer,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.module_release_snapshot(text,uuid,uuid), public.module_release_require(text,uuid),
  public.module_release_admin(), public.module_release_history(text), public.module_release_save(text,bigint,jsonb,bigint) to authenticated;
grant execute on function public.module_release_record_evidence(text,integer,text,bigint,text,text) to service_role;

-- Keep original validation, permissions and resource checks inside the private implementations.
-- The public wrappers enforce release policy against the same hub argument as the original RPC.

alter function public.nodi_gate() set schema private;
revoke all on function private.nodi_gate() from public, anon, authenticated;
create function public.nodi_gate() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('nodi.action-chat');
  perform public.module_release_require('nodi.chat');
  return private.nodi_gate();
end $$;
revoke all on function public.nodi_gate() from public, anon, authenticated;
grant execute on function public.nodi_gate() to authenticated;

alter function public.nodi_gate(text) set schema private;
revoke all on function private.nodi_gate(text) from public, anon, authenticated;
create function public.nodi_gate(p_feature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_feature = 'chat' then perform public.module_release_require('nodi.chat'); end if;
  perform public.module_release_require('nodi.action-' || p_feature);
  return private.nodi_gate(p_feature);
end $$;
revoke all on function public.nodi_gate(text) from public, anon, authenticated;
grant execute on function public.nodi_gate(text) to authenticated;

alter function public.route_plan_get(uuid,date) set schema private;
revoke all on function private.route_plan_get(uuid,date) from public, anon, authenticated;
create function public.route_plan_get(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('routes.tab-plan', p_hub);
  return private.route_plan_get(p_hub, p_date);
end $$;
revoke all on function public.route_plan_get(uuid,date) from public, anon, authenticated;
grant execute on function public.route_plan_get(uuid,date) to authenticated;

alter function public.route_plan_save(uuid,date,jsonb,boolean) set schema private;
revoke all on function private.route_plan_save(uuid,date,jsonb,boolean) from public, anon, authenticated;
create function public.route_plan_save(p_hub uuid, p_date date, p jsonb, p_send boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('routes.tab-plan', p_hub);
  return private.route_plan_save(p_hub, p_date, p, p_send);
end $$;
revoke all on function public.route_plan_save(uuid,date,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.route_plan_save(uuid,date,jsonb,boolean) to authenticated;

alter function public.route_plan_setup(uuid,jsonb) set schema private;
revoke all on function private.route_plan_setup(uuid,jsonb) from public, anon, authenticated;
create function public.route_plan_setup(p_hub uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('routes.tab-plan', p_hub);
  perform private.route_plan_setup(p_hub, p);
end $$;
revoke all on function public.route_plan_setup(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.route_plan_setup(uuid,jsonb) to authenticated;

alter function public.route_plan_morning(uuid,date) set schema private;
revoke all on function private.route_plan_morning(uuid,date) from public, anon, authenticated;
create function public.route_plan_morning(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('routes.tab-morning', p_hub);
  return private.route_plan_morning(p_hub, p_date);
end $$;
revoke all on function public.route_plan_morning(uuid,date) from public, anon, authenticated;
grant execute on function public.route_plan_morning(uuid,date) to authenticated;

alter function public.route_plan_files(uuid,date) set schema private;
revoke all on function private.route_plan_files(uuid,date) from public, anon, authenticated;
create function public.route_plan_files(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('routes.tab-plan', p_hub);
  return private.route_plan_files(p_hub, p_date);
end $$;
revoke all on function public.route_plan_files(uuid,date) from public, anon, authenticated;
grant execute on function public.route_plan_files(uuid,date) to authenticated;

alter function public.route_plan_file_save(uuid,date,jsonb) set schema private;
revoke all on function private.route_plan_file_save(uuid,date,jsonb) from public, anon, authenticated;
create function public.route_plan_file_save(p_hub uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('routes.tab-plan', p_hub);
  return private.route_plan_file_save(p_hub, p_date, p);
end $$;
revoke all on function public.route_plan_file_save(uuid,date,jsonb) from public, anon, authenticated;
grant execute on function public.route_plan_file_save(uuid,date,jsonb) to authenticated;

-- Restrictive policies compose with the existing permissive policies.
create function private.release_route_plan_row_allowed(p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.release_api_allowed('routes.tab-plan', p_hub)
$$;
revoke execute on function private.release_route_plan_row_allowed(uuid) from public, anon, authenticated;
grant execute on function private.release_route_plan_row_allowed(uuid) to authenticated;
create policy route_day_plans_release on public.route_day_plans as restrictive for all to authenticated
  using (private.release_route_plan_row_allowed(hub_id))
  with check (private.release_route_plan_row_allowed(hub_id));
