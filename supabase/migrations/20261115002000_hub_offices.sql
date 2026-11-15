-- =====================================================================
-- XZM-TEAM ERP — Migration: hub addresses live in the Office section
--
--  * office_create_hub_offices(): one click makes an office record for every
--    active hub that has none yet — name, address and the sorting center
--    (when the hub is a center's own hub or is served by one) come from the hub.
--  * Editing the address of a hub's office updates the hub's address too, so
--    the address is kept in one place.
-- =====================================================================

create or replace function public.office_create_hub_offices(p_zone uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; v_n integer := 0;
begin
  for h in
    select hb.* from public.hubs hb
     where hb.archived_at is null and hb.status = 'active'
       and (p_zone is null or hb.zone_id = p_zone)
       and private.has_permission('office.property.create', hb.zone_id, hb.id)
       and not exists (select 1 from public.office_properties p where p.hub_id = hb.id and p.kind = 'office' and p.archived_at is null)
  loop
    insert into public.office_properties (code, name, kind, zone_id, hub_id, sorting_center_id, address, note)
    values ('HUB-' || h.code, h.name, 'office', h.zone_id, h.id,
            coalesce((select c.id from public.sorting_centers c where c.home_hub_id = h.id and c.archived_at is null limit 1), h.sorting_center_id),
            h.address, case when h.phone is not null then 'হাবের ফোন: ' || h.phone end)
    on conflict (code) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.office_create_hub_offices(uuid) from public, anon;
grant execute on function public.office_create_hub_offices(uuid) to authenticated;

create or replace function private.office_address_to_hub() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hub_id is not null and new.kind = 'office' and new.archived_at is null
     and nullif(trim(coalesce(new.address, '')), '') is not null
     and (tg_op = 'INSERT' or new.address is distinct from old.address or new.hub_id is distinct from old.hub_id) then
    perform set_config('app.change_reason', 'Address from office ' || new.name, true);
    update public.hubs set address = new.address where id = new.hub_id and address is distinct from new.address;
  end if;
  return new;
end $$;
drop trigger if exists office_properties_hub_address on public.office_properties;
create trigger office_properties_hub_address after insert or update of address, hub_id on public.office_properties
  for each row execute function private.office_address_to_hub();
