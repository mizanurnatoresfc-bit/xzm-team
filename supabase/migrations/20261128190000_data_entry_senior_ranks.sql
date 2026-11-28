-- Data Entry V2 · R1 — Senior Rank system (1–8) with editable percentage.
-- Zone-scoped ranks; team members can be assigned a rank.
-- Phase 1 behavior preserved: rank_id is nullable; unassigned members behave exactly
-- as before (treated as 100% in downstream calculations). The target-split engine
-- is NOT modified by this migration — rank wiring is deferred to R1.5.

create table public.data_entry_ranks (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones(id),
  rank_number smallint not null check (rank_number between 1 and 8),
  name_bn text not null check (char_length(btrim(name_bn)) between 1 and 60),
  name text,
  target_multiplier_pct numeric(5,2) not null default 100 check (target_multiplier_pct between 0 and 300),
  is_active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (zone_id, rank_number)
);
create index data_entry_ranks_zone_idx on public.data_entry_ranks(zone_id);

alter table public.data_entry_team_members
  add column rank_id uuid references public.data_entry_ranks(id);
create index data_entry_team_members_rank_idx
  on public.data_entry_team_members(rank_id) where rank_id is not null;

alter table public.data_entry_ranks enable row level security;
revoke all on public.data_entry_ranks from public, anon, authenticated;

create trigger data_entry_ranks_stamp before insert or update on public.data_entry_ranks
  for each row execute function private.stamp_row();
create trigger data_entry_ranks_audit after insert or update on public.data_entry_ranks
  for each row execute function private.audit_row('data_entry');
create trigger data_entry_ranks_no_delete before delete on public.data_entry_ranks
  for each row execute function private.prevent_delete();

-- List ranks for a zone (ordered 1..8). Only returns rows a zone owner can see.
create function public.data_entry_rank_list(p_zone uuid)
returns table (
  id uuid, rank_number smallint, name_bn text, name text,
  target_multiplier_pct numeric, is_active boolean, revision integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;
  return query
  select r.id, r.rank_number, r.name_bn, r.name,
         r.target_multiplier_pct, r.is_active, r.revision
  from public.data_entry_ranks r
  where r.zone_id = p_zone
  order by r.rank_number, r.id;
end $$;

-- Seed defaults: 8 ranks per zone with sensible Bangla names.
-- Idempotent: inserts only ranks that do not yet exist for the zone.
create function public.data_entry_rank_seed_defaults(p_zone uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  inserted_count integer := 0;
  defaults constant text[][] := array[
    array['1', 'সিনিয়র ১', '110'],
    array['2', 'সিনিয়র ২', '108'],
    array['3', 'সিনিয়র ৩', '106'],
    array['4', 'সিনিয়র ৪', '104'],
    array['5', 'সিনিয়র ৫', '102'],
    array['6', 'সিনিয়র ৬', '100'],
    array['7', 'সিনিয়র ৭',  '98'],
    array['8', 'সিনিয়র ৮',  '96']
  ];
  row text[];
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;

  foreach row slice 1 in array defaults loop
    insert into public.data_entry_ranks (zone_id, rank_number, name_bn, target_multiplier_pct)
    values (p_zone, row[1]::smallint, row[2], row[3]::numeric)
    on conflict (zone_id, rank_number) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;

  return inserted_count;
end $$;

-- Edit an existing rank (name_bn, name, multiplier, active flag).
-- Revision check prevents stale overwrites.
create function public.data_entry_rank_save(
  p_zone uuid, p_rank_id uuid, p_name_bn text, p_name text,
  p_multiplier numeric, p_is_active boolean, p_version integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  rec public.data_entry_ranks%rowtype;
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;
  if p_rank_id is null then
    raise exception 'Rank id required' using errcode = '22023';
  end if;
  select * into rec from public.data_entry_ranks where id = p_rank_id and zone_id = p_zone for update;
  if not found then
    raise exception 'Rank not found in zone' using errcode = '22023';
  end if;
  if rec.revision is distinct from p_version then
    raise exception 'Rank changed. Refresh and retry.' using errcode = '40001';
  end if;
  if p_name_bn is null or char_length(btrim(p_name_bn)) < 1 then
    raise exception 'Rank name (Bangla) required' using errcode = '22023';
  end if;
  if p_multiplier is null or p_multiplier < 0 or p_multiplier > 300 then
    raise exception 'Multiplier must be between 0 and 300' using errcode = '22023';
  end if;

  update public.data_entry_ranks
  set name_bn = btrim(p_name_bn),
      name = nullif(btrim(coalesce(p_name, '')), ''),
      target_multiplier_pct = p_multiplier,
      is_active = coalesce(p_is_active, true),
      revision = revision + 1
  where id = p_rank_id;

  return p_rank_id;
end $$;

-- Assign (or clear) a rank for a team member. Member and rank must share the zone.
create function public.data_entry_rank_assign(
  p_zone uuid, p_member uuid, p_rank_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  member public.data_entry_team_members%rowtype;
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;
  select * into member from public.data_entry_team_members where id = p_member for update;
  if not found or member.zone_id <> p_zone then
    raise exception 'Team member not found in zone' using errcode = '22023';
  end if;
  if p_rank_id is not null then
    if not exists (select 1 from public.data_entry_ranks
                   where id = p_rank_id and zone_id = p_zone and is_active) then
      raise exception 'Rank must be active and in the same zone' using errcode = '22023';
    end if;
  end if;

  update public.data_entry_team_members
  set rank_id = p_rank_id, revision = revision + 1
  where id = p_member;

  return p_member;
end $$;

-- Extend team snapshot with rank_id and rank_number for each member (additive JSON fields).
-- Keeps the exact shape of existing fields so the current frontend keeps working.
create or replace function public.data_entry_team_snapshot(p_zone uuid)
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
      'rank_id', m.rank_id,
      'rank_number', (select r.rank_number from public.data_entry_ranks r where r.id = m.rank_id),
      'eligible', e.status = 'active' and e.archived_at is null,
      'additional_hubs', coalesce((select jsonb_agg(a.hub_id order by a.hub_id)
        from public.data_entry_hub_assignments a where a.team_member_id = m.id and a.is_active), '[]'::jsonb)
    ) order by e.full_name, m.id)
      from public.data_entry_team_members m
      join public.employees e on e.id = m.employee_id and e.zone_id = p_zone
      where m.zone_id = p_zone), '[]'::jsonb)
  );
end $$;

revoke all on function public.data_entry_rank_list(uuid) from public, anon;
revoke all on function public.data_entry_rank_seed_defaults(uuid) from public, anon;
revoke all on function public.data_entry_rank_save(uuid, uuid, text, text, numeric, boolean, integer) from public, anon;
revoke all on function public.data_entry_rank_assign(uuid, uuid, uuid) from public, anon;
grant execute on function public.data_entry_rank_list(uuid) to authenticated;
grant execute on function public.data_entry_rank_seed_defaults(uuid) to authenticated;
grant execute on function public.data_entry_rank_save(uuid, uuid, text, text, numeric, boolean, integer) to authenticated;
grant execute on function public.data_entry_rank_assign(uuid, uuid, uuid) to authenticated;
