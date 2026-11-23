-- "আমার লোক দেওয়া" (owner, 23 Nov 2026): a staff member may have brought people to any hub of the zone,
-- so the hub list on that page shows every hub of the caller's own zone, not only the hubs their role may open.
-- Name, code and zone only — nothing else about a hub. Hubs the caller's role may see anywhere else are added too.
create or replace function public.ref_zone_hubs()
returns table(id uuid, zone_id uuid, code text, name text)
language sql stable security definer set search_path to ''
as $$
  select h.id, h.zone_id, h.code::text, h.name
  from public.hubs h
  where auth.uid() is not null and h.archived_at is null
    and (h.zone_id in (select mh.zone_id from public.employees e join public.hubs mh on mh.id = e.hub_id
                       where e.profile_id = auth.uid() and e.archived_at is null)
         or private.has_permission('org.hub.view', h.zone_id, h.id))
  order by h.name
$$;
revoke all on function public.ref_zone_hubs() from public, anon;
grant execute on function public.ref_zone_hubs() to authenticated;
