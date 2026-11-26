alter table public.user_permission_overrides
  add column delegated_zone_id uuid references public.zones(id);

create function private.can_delegate_route_plan(p_hub uuid, p_zone uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_permission in ('ops.route_plan.view', 'ops.route_plan.edit', 'ops.route_plan.approve')
    and exists (
      select 1 from public.hubs h
      join public.user_roles ur on ur.zone_id = h.zone_id and ur.scope_type = 'zone'
      join public.roles r on r.id = ur.role_id
      where h.id = p_hub and h.zone_id = p_zone and h.status = 'active' and h.archived_at is null
        and ur.user_id = auth.uid() and ur.revoked_at is null and ur.valid_from <= private.wf_today()
        and (ur.valid_to is null or ur.valid_to >= private.wf_today())
        and r.code = 'zonal_manager' and r.status = 'active' and r.archived_at is null
    )
    and private.has_permission(p_permission, p_zone, null)
$$;
revoke all on function private.can_delegate_route_plan(uuid,uuid,text) from public, anon, authenticated;

create or replace function private.guard_user_override() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_permission text;
begin
  if auth.uid() is not null and not private.is_super_admin() then
    select code into v_permission from public.permissions where id = new.permission_id;
    if new.delegated_zone_id is null or new.scope_type <> 'hub' or new.effect <> 'grant'
       or not coalesce(private.can_delegate_route_plan(new.hub_id, new.delegated_zone_id, v_permission), false) then
      raise exception 'Not authorised to delegate this route plan permission' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and (new.user_id = auth.uid() or not exists (
      select 1 from public.employees e where e.profile_id = new.user_id and e.hub_id = new.hub_id
        and e.status = 'active' and e.archived_at is null
    )) then
      raise exception 'Choose an active employee in this hub' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.revoked_at is null or new.revoked_by is distinct from auth.uid()
      or new.valid_to is distinct from old.valid_to or new.reason is distinct from old.reason) then
      raise exception 'Use the revoke action for a delegated permission' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if (new.user_id, new.permission_id, new.effect, new.scope_type, new.zone_id, new.hub_id, new.valid_from, new.delegated_zone_id)
       is distinct from
       (old.user_id, old.permission_id, old.effect, old.scope_type, old.zone_id, old.hub_id, old.valid_from, old.delegated_zone_id) then
      raise exception 'A personal permission cannot be re-pointed; take it back and add a new one.' using errcode = 'P0001';
    end if;
    if old.revoked_at is not null then
      raise exception 'A personal permission that was taken back cannot be changed.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create function public.route_plan_delegations(p_hub uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'permissions', coalesce((select jsonb_agg(code order by code) from public.permissions
      where private.can_delegate_route_plan(h.id, h.zone_id, code)), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', pr.full_name, 'permission', p.code, 'until', o.valid_to,
      'active', o.valid_to is null or o.valid_to >= private.wf_today()
    ) order by o.created_at desc)
      from public.user_permission_overrides o
      join public.profiles pr on pr.id = o.user_id
      join public.permissions p on p.id = o.permission_id
      where o.delegated_zone_id = h.zone_id and o.hub_id = h.id and o.revoked_at is null
        and private.can_delegate_route_plan(h.id, h.zone_id, p.code)), '[]'::jsonb)
  ) from public.hubs h where h.id = p_hub
$$;

create function public.route_plan_delegate(p_hub uuid, p_employee uuid, p_permission text, p_until date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_user uuid; v_permission uuid;
begin
  select zone_id into v_zone from public.hubs where id = p_hub;
  if not coalesce(private.can_delegate_route_plan(p_hub, v_zone, p_permission), false) then
    raise exception 'Not authorised to delegate this route plan permission' using errcode = '42501';
  end if;
  if p_until is not null and p_until < private.wf_today() then
    raise exception 'Choose today or a future expiry date' using errcode = '22023';
  end if;
  select profile_id into v_user from public.employees where id = p_employee
    and hub_id = p_hub and status = 'active' and archived_at is null;
  if v_user is null or v_user = auth.uid() then
    raise exception 'Choose an active employee in this hub with a login' using errcode = '22023';
  end if;
  select id into v_permission from public.permissions where code = p_permission;
  insert into public.user_permission_overrides
    (user_id, permission_id, effect, scope_type, hub_id, delegated_zone_id, valid_from, valid_to, reason)
  values (v_user, v_permission, 'grant', 'hub', p_hub, v_zone, private.wf_today(), p_until, 'Delegated by Zonal Manager for route planning');
end;
$$;

create function public.route_plan_revoke_delegation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.user_permission_overrides o set revoked_at = now(), revoked_by = auth.uid(),
    revoke_reason = 'Route planning delegation withdrawn'
  from public.permissions p
  where o.id = p_id and p.id = o.permission_id and o.revoked_at is null
    and private.can_delegate_route_plan(o.hub_id, o.delegated_zone_id, p.code);
  if not found then raise exception 'Delegation unavailable' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.route_plan_delegations(uuid), public.route_plan_delegate(uuid,uuid,text,date),
  public.route_plan_revoke_delegation(uuid) from public, anon;
grant execute on function public.route_plan_delegations(uuid), public.route_plan_delegate(uuid,uuid,text,date),
  public.route_plan_revoke_delegation(uuid) to authenticated;
