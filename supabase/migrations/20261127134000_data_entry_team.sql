-- Data Entry Phase 1. Role grants are configured separately after review.
insert into public.permissions (code, module, resource, action, description)
values ('data_entry.team.edit', 'data_entry', 'team', 'edit', 'Manage the data entry team in an assigned zone');

create table public.data_entry_team_members (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id),
  zone_id uuid not null references public.zones(id),
  primary_hub_id uuid not null references public.hubs(id),
  is_active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index data_entry_team_zone_idx on public.data_entry_team_members(zone_id);
create index data_entry_team_primary_hub_idx on public.data_entry_team_members(primary_hub_id);

create table public.data_entry_hub_assignments (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.data_entry_team_members(id),
  hub_id uuid not null references public.hubs(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (team_member_id, hub_id)
);
create index data_entry_hub_assignments_hub_idx on public.data_entry_hub_assignments(hub_id);

alter table public.data_entry_team_members enable row level security;
alter table public.data_entry_hub_assignments enable row level security;
revoke all on public.data_entry_team_members, public.data_entry_hub_assignments from public, anon, authenticated;

create trigger data_entry_team_stamp before insert or update on public.data_entry_team_members
  for each row execute function private.stamp_row();
create trigger data_entry_team_audit after insert or update on public.data_entry_team_members
  for each row execute function private.audit_row('data_entry');
create trigger data_entry_team_no_delete before delete on public.data_entry_team_members
  for each row execute function private.prevent_delete();
create trigger data_entry_assignment_stamp before insert or update on public.data_entry_hub_assignments
  for each row execute function private.stamp_row();
create trigger data_entry_assignment_audit after insert or update on public.data_entry_hub_assignments
  for each row execute function private.audit_row('data_entry');
create trigger data_entry_assignment_no_delete before delete on public.data_entry_hub_assignments
  for each row execute function private.prevent_delete();

create function public.data_entry_team_zones()
returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select z.id, coalesce(z.name_bn, z.name)
  from public.zones z
  where z.status = 'active' and z.archived_at is null
    and private.has_permission('data_entry.team.edit', z.id, null)
  order by z.name, z.id
$$;

create function public.data_entry_team_snapshot(p_zone uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'hubs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'name', coalesce(h.name_bn, h.name), 'available', h.status = 'active' and h.archived_at is null
    ) order by h.name, h.id) from public.hubs h where h.zone_id = p_zone), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'employee_id', m.employee_id, 'name', coalesce(e.full_name_bn, e.full_name),
      'code', e.employee_code::text, 'is_active', m.is_active,
      'primary_hub_id', m.primary_hub_id, 'revision', m.revision,
      'eligible', e.status = 'active' and e.archived_at is null,
      'additional_hubs', coalesce((select jsonb_agg(a.hub_id order by a.hub_id)
        from public.data_entry_hub_assignments a where a.team_member_id = m.id and a.is_active), '[]'::jsonb)
    ) order by e.full_name, m.id)
      from public.data_entry_team_members m
      join public.employees e on e.id = m.employee_id and e.zone_id = p_zone
      where m.zone_id = p_zone), '[]'::jsonb)
  );
end $$;

create function public.data_entry_team_candidates(p_zone uuid, p_search text)
returns table (id uuid, name text, code text, hub_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  term text := lower(btrim(coalesce(p_search, '')));
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;
  if char_length(term) not between 2 and 100 then return; end if;

  return query
  select e.id, coalesce(e.full_name_bn, e.full_name), e.employee_code::text, e.hub_id
  from public.employees e
  where e.zone_id = p_zone and e.status = 'active' and e.archived_at is null
    and (strpos(lower(e.full_name), term) > 0 or strpos(lower(e.full_name_bn), term) > 0
      or strpos(lower(e.employee_code::text), term) > 0)
    and not exists (select 1 from public.data_entry_team_members m where m.employee_id = e.id)
  order by e.full_name, e.id
  limit 50;
end $$;

create function public.data_entry_team_save(
  p_zone uuid, p_employee uuid, p_primary_hub uuid, p_additional_hubs uuid[],
  p_is_active boolean, p_version integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  employee public.employees%rowtype;
  member public.data_entry_team_members%rowtype;
  additional uuid[] := coalesce(p_additional_hubs, '{}'::uuid[]);
  valid_hub_id uuid;
  valid_hubs integer := 0;
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;
  select * into employee from public.employees where id = p_employee and zone_id = p_zone for update;
  if not found then raise exception 'Employee must belong to the selected zone' using errcode = '22023'; end if;

  select * into member from public.data_entry_team_members where employee_id = p_employee for update;
  if member.id is not null and member.zone_id <> p_zone then
    raise exception 'Existing membership needs an inter-zone transfer review' using errcode = '22023';
  end if;
  if member.revision is distinct from p_version then
    raise exception 'Team member changed. Refresh the team and retry.' using errcode = '40001';
  end if;

  -- Deactivation preserves assignment history, including any now inactive hubs.
  if p_is_active is false and member.id is not null then
    update public.data_entry_team_members set is_active = false, revision = revision + 1 where id = member.id and is_active;
    return member.id;
  end if;
  if p_is_active is distinct from true or employee.status <> 'active' or employee.archived_at is not null then
    raise exception 'An active employee is required' using errcode = '22023';
  end if;
  if p_primary_hub is null or p_primary_hub = any(additional)
     or cardinality(additional) <> (select count(distinct id) from unnest(additional) as u(id)) then
    raise exception 'Choose a primary hub and distinct additional hubs' using errcode = '22023';
  end if;

  for valid_hub_id in
    select h.id from public.hubs h
    where h.id = any(array_prepend(p_primary_hub, additional))
      and h.zone_id = p_zone and h.status = 'active' and h.archived_at is null
    order by h.id for share
  loop
    valid_hubs := valid_hubs + 1;
  end loop;
  if valid_hubs <> 1 + cardinality(additional) then
    raise exception 'All selected hubs must be active and in the same zone' using errcode = '22023';
  end if;

  if member.id is null then
    insert into public.data_entry_team_members (employee_id, zone_id, primary_hub_id)
    values (p_employee, p_zone, p_primary_hub) returning id into member.id;
  else
    update public.data_entry_team_members set primary_hub_id = p_primary_hub, is_active = true, revision = revision + 1 where id = member.id;
  end if;

  update public.data_entry_hub_assignments
  set is_active = false
  where team_member_id = member.id and is_active and not (hub_id = any(additional));

  insert into public.data_entry_hub_assignments (team_member_id, hub_id)
  select member.id, id from unnest(additional) as u(id)
  on conflict (team_member_id, hub_id) do update set is_active = true
    where not data_entry_hub_assignments.is_active;

  return member.id;
end $$;

revoke all on function public.data_entry_team_zones() from public, anon;
revoke all on function public.data_entry_team_snapshot(uuid) from public, anon;
revoke all on function public.data_entry_team_candidates(uuid, text) from public, anon;
revoke all on function public.data_entry_team_save(uuid, uuid, uuid, uuid[], boolean, integer) from public, anon;
grant execute on function public.data_entry_team_zones() to authenticated;
grant execute on function public.data_entry_team_snapshot(uuid) to authenticated;
grant execute on function public.data_entry_team_candidates(uuid, text) to authenticated;
grant execute on function public.data_entry_team_save(uuid, uuid, uuid, uuid[], boolean, integer) to authenticated;
