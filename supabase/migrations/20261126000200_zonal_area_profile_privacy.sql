-- Zonal Manager remains an existing role grant, assigned to an active area.
-- Existing grants keep their history and can still be revoked.
create function private.guard_zonal_role_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.roles where id = new.role_id and code = 'zonal_manager') then
    if new.scope_type <> 'zone' then
      raise exception 'Choose an area for a Zonal Manager assignment.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.zones where id = new.zone_id and status = 'active' and archived_at is null) then
      raise exception 'Choose an active area for a Zonal Manager assignment.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

revoke all on function private.guard_zonal_role_scope() from public, anon, authenticated;

create trigger user_roles_zonal_scope before insert on public.user_roles
  for each row execute function private.guard_zonal_role_scope();

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
  if p_scope is distinct from 'zone' and exists (
    select 1 from public.roles where id = p_role and code = 'zonal_manager'
  ) then
    raise exception 'Choose an area for a Zonal Manager assignment.' using errcode = '22023';
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

create or replace function public.user_admin_assignable_roles(p_scope text, p_zone uuid default null, p_hub uuid default null)
returns table (id uuid, code text, name text, name_bn text, is_super boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code::text, r.name, r.name_bn, r.is_super
  from public.roles r
  where r.status = 'active' and r.archived_at is null
    and (r.code <> 'zonal_manager' or p_scope = 'zone')
    and (not r.is_super or p_scope = 'global')
    and private.can_assign_role(r.id, p_scope,
          case when p_scope = 'zone' then p_zone end, case when p_scope = 'hub' then p_hub end)
  order by r.is_super desc, r.name
$$;

-- Keep Zonal Managers out of subordinate employee lists and profile reads.
-- The owner and administrators with organization-wide HR visibility retain access.
create function private.can_see_employee_profile(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    private.is_self_employee(p_employee)
    or private.has_permission('hr.employee.view')
    or not exists (
      select 1 from public.employees e
      where e.id = p_employee and (
        exists (
          select 1 from public.user_roles ur
          join public.roles r on r.id = ur.role_id and r.code = 'zonal_manager'
          where ur.user_id = e.profile_id and ur.revoked_at is null
            and (ur.valid_to is null or ur.valid_to >= private.wf_today())
        )
        or exists (
          select 1 from public.positions p where p.id = e.position_id and p.level = 'zone'
            and (p.name ilike '%zonal manager%' or p.name_bn like '%জোনাল ম্যানেজার%')
        )
      )
    )
  )
$$;

revoke all on function private.can_see_employee_profile(uuid) from public, anon;
grant execute on function private.can_see_employee_profile(uuid) to authenticated;

create policy employees_zonal_profile_privacy on public.employees
  as restrictive for select to authenticated
  using (private.can_see_employee_profile(id));

create or replace function private.employee_has_permission(p_perm text, p_employee uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.has_permission(p_perm, e.zone_id, e.hub_id)
                     and (p_perm !~ '^hr[.](employee(_profile|_sensitive)?|document|application|referral)[.]'
                          or private.can_see_employee_profile(e.id))
                   from public.employees e where e.id = p_employee), false)
$$;

create or replace function public.staff_profile_people(p_hub uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.employee.view', v_zone, p_hub) then raise exception 'Not authorised to see the staff of this hub.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'post', coalesce(ps.name_bn, ps.name), 'status', e.status)
                     order by (e.status <> 'active'), e.full_name)
                     from public.employees e left join public.positions ps on ps.id = e.position_id where e.hub_id = p_hub and e.archived_at is null
                       and private.can_see_employee_profile(e.id)), '[]'::jsonb);
end $$;

-- Route staff notes to the active area role without returning any personal fields.

create function private.zone_manager_recipients(p_zone uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select manager.profile_id
  from private.wf_role_zone_managers(p_zone) manager(profile_id)
  join public.zones z on z.id = p_zone and z.status = 'active' and z.archived_at is null
  where manager.profile_id <> auth.uid()
$$;

revoke all on function private.zone_manager_recipients(uuid) from public, anon, authenticated;

create or replace function public.zone_contacts(p_zone uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := p_zone; z public.zones;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_zone is null then
    select coalesce(e.zone_id, h.zone_id) into v_zone from public.employees e left join public.hubs h on h.id = e.hub_id
    where e.profile_id = auth.uid() and e.archived_at is null and e.status = 'active'
    order by e.created_at desc limit 1;
    if v_zone is null then return null; end if;            -- no staff record: nothing to show
  end if;
  if not private.in_zone_group(v_zone) then raise exception 'এই জোনের তথ্য দেখার অনুমতি নেই' using errcode = '42501'; end if;
  select * into z from public.zones where id = v_zone;
  return jsonb_build_object('zone_id', z.id, 'zone_name', z.name, 'zone_code', z.code::text,
    'can_message', exists (select 1 from private.zone_manager_recipients(v_zone)),
    'managers', '[]'::jsonb, -- Empty for older app versions that still expect this field.
    'sent_today', (select count(*)::int from public.zone_manager_notes n where n.from_profile = auth.uid() and n.created_at > now() - interval '24 hours'));
end $$;

create or replace function public.zone_manager_tell(p_zone uuid, p_body text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_body text := nullif(trim(coalesce(p_body, '')), ''); v_name text; v_n integer := 0; v_recipient uuid;
begin
  if not private.in_zone_group(p_zone) then raise exception 'এই জোনের জোনাল ম্যানেজারকে লেখার অনুমতি নেই' using errcode = '42501'; end if;
  if v_body is null or length(v_body) < 2 then raise exception 'কী জানাতে চান লিখুন' using errcode = '22023'; end if;
  if length(v_body) > 500 then raise exception '৫০০ অক্ষরের মধ্যে লিখুন' using errcode = '22023'; end if;
  if (select count(*) from public.zone_manager_notes n where n.from_profile = auth.uid() and n.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'গত ২৪ ঘণ্টায় বার্তা পাঠানোর সীমা পূর্ণ হয়েছে' using errcode = '22023'; end if;
  v_name := private.my_display_name();
  for v_recipient in select * from private.zone_manager_recipients(p_zone) loop
    perform private.notify(v_recipient, 'স্টাফের বার্তা — ' || v_name,
      v_body || coalesce(' · ' || (select h.name from public.employees e join public.hubs h on h.id = e.hub_id where e.profile_id = auth.uid() and e.archived_at is null limit 1), ''),
      '/app/issues?tab=zone&z=' || p_zone::text, 'zone_manager_note');
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'এই এরিয়ায় এখনো কোনো জোনাল ম্যানেজার বরাদ্দ নেই' using errcode = '22023'; end if;
  insert into public.zone_manager_notes (zone_id, from_profile, from_name, body, sent_to) values (p_zone, auth.uid(), v_name, v_body, v_n);
  return v_n;
end $$;

drop function private.zone_manager_people(uuid);
