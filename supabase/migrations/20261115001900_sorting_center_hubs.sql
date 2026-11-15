-- =====================================================================
-- XZM-TEAM ERP — Migration: assign hubs to a sorting center
--
--  A sorting center serves a set of hubs. Each hub belongs to at most one
--  sorting center (hubs.sorting_center_id). The center may also point to the
--  hub record that is the center itself (e.g. "Natore Shorting Centre"), so
--  that hub's staff are the center's staff. Set in one call from the
--  Sorting Center page; every change is audited on hubs.
-- =====================================================================

alter table public.hubs add column if not exists sorting_center_id uuid references public.sorting_centers(id);
create index if not exists hubs_sorting_center_ix on public.hubs (sorting_center_id);
alter table public.sorting_centers add column if not exists home_hub_id uuid references public.hubs(id);
create index if not exists sorting_centers_home_hub_ix on public.sorting_centers (home_hub_id);

create or replace function public.sorting_assign_hubs(p_center uuid, p_hubs uuid[], p_home_hub uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.sorting_centers; v_bad integer; v_n integer;
begin
  select * into c from public.sorting_centers where id = p_center and archived_at is null for update;
  if c.id is null then raise exception 'শটিং সেন্টার পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('sorting.center.edit', c.zone_id, null) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  p_hubs := coalesce(p_hubs, '{}');
  select count(*) into v_bad from public.hubs h where h.id = any(p_hubs) and (h.zone_id <> c.zone_id or h.archived_at is not null);
  if v_bad > 0 then raise exception 'শুধু এই সেন্টারের এরিয়ার চালু হাব এসাইন করা যায়' using errcode = '22023'; end if;
  if p_home_hub is not null and not exists (select 1 from public.hubs h where h.id = p_home_hub and h.zone_id = c.zone_id and h.archived_at is null) then
    raise exception 'সেন্টারের নিজের হাব এই এরিয়ার হতে হবে' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', 'Sorting center ' || c.name || ': hub assignment', true);
  update public.hubs set sorting_center_id = null where sorting_center_id = p_center and not (id = any(p_hubs));
  update public.hubs set sorting_center_id = p_center where id = any(p_hubs) and sorting_center_id is distinct from p_center;
  update public.sorting_centers set home_hub_id = p_home_hub where id = p_center and home_hub_id is distinct from p_home_hub;
  select count(*) into v_n from public.hubs where sorting_center_id = p_center;
  return v_n;
end $$;
revoke all on function public.sorting_assign_hubs(uuid, uuid[], uuid) from public, anon;
grant execute on function public.sorting_assign_hubs(uuid, uuid[], uuid) to authenticated;
