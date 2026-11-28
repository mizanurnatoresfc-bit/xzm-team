-- Data Entry V2 · R1.1 — Rank system hotfix (correctness items raised by
-- ChatGPT's independent SQL review of PR #228).
--
-- Fixes applied (backend-only, no UI change — owner-approved ownership split
-- 2026-11-28 keeps frontend on ChatGPT's separate branch):
--
-- 1. Null-safe zone comparison: the existing 3-arg
--    data_entry_rank_assign(uuid, uuid, uuid) is updated via CREATE OR
--    REPLACE to use `is distinct from` instead of `<>`. No signature change,
--    the live frontend keeps working.
-- 2. New 4-arg OVERLOAD data_entry_rank_assign(uuid, uuid, uuid, integer)
--    adds optimistic concurrency (p_version against member.revision), matching
--    data_entry_team_save. Frontend can switch to the 4-arg call at its own
--    pace; both overloads live side-by-side via Postgres function overloading.
-- 3. Database-level same-zone invariant between a team member and its rank is
--    enforced by a BEFORE INSERT OR UPDATE trigger on
--    data_entry_team_members, so even a direct-table write (should RLS ever
--    allow one) cannot cross zones.

-- Fix #1: null-safe zone comparison in the existing 3-arg signature.
create or replace function public.data_entry_rank_assign(
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
  if not found or member.zone_id is distinct from p_zone then
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

-- Fix #2: 4-arg overload with optimistic concurrency.
create function public.data_entry_rank_assign(
  p_zone uuid, p_member uuid, p_rank_id uuid, p_version integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  member public.data_entry_team_members%rowtype;
begin
  if p_zone is null or not private.has_permission('data_entry.team.edit', p_zone, null) then
    raise exception 'Data entry team permission required' using errcode = '42501';
  end if;
  select * into member from public.data_entry_team_members where id = p_member for update;
  if not found or member.zone_id is distinct from p_zone then
    raise exception 'Team member not found in zone' using errcode = '22023';
  end if;
  if p_version is not null and member.revision is distinct from p_version then
    raise exception 'Team member changed. Refresh the team and retry.' using errcode = '40001';
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

revoke all on function public.data_entry_rank_assign(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.data_entry_rank_assign(uuid, uuid, uuid, integer) to authenticated;

-- Fix #3: DB-level same-zone invariant between member and rank.
create or replace function private.data_entry_member_rank_zone_check()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.rank_id is not null then
    perform 1 from public.data_entry_ranks r
      where r.id = new.rank_id and r.zone_id = new.zone_id;
    if not found then
      raise exception 'rank % does not belong to zone % (data_entry_team_members row %)',
        new.rank_id, new.zone_id, new.id using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger data_entry_team_members_rank_zone
  before insert or update of rank_id, zone_id on public.data_entry_team_members
  for each row execute function private.data_entry_member_rank_zone_check();
