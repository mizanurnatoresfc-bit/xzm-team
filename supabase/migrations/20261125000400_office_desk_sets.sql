alter table public.office_properties add column desk_set_template jsonb
  check (desk_set_template is null or jsonb_typeof(desk_set_template) = 'object');

alter table public.office_desks add column desk_set_items jsonb;

create function public.office_save_desk_set(
  p_desk uuid, p_employee uuid, p_items jsonb, p_expected timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.office_desks;
  p public.office_properties;
  a public.office_assets;
  copy public.office_assets;
  requested integer;
  matched integer := 0;
begin
  select * into d from public.office_desks where id = p_desk and archived_at is null for update;
  if not found then raise exception 'ডেস্ক পাওয়া যায়নি'; end if;
  if not private.office_can('office.property.edit', d.property_id)
    or not private.office_can('office.asset.edit', d.property_id) then
    raise exception 'ডেস্ক সেট বদলানোর অনুমতি নেই' using errcode = '42501';
  end if;
  select * into p from public.office_properties where id = d.property_id and archived_at is null;
  if not found then raise exception 'অফিস পাওয়া যায়নি'; end if;
  if d.updated_at is distinct from p_expected then raise exception 'ডেস্ক বদলেছে। পেজ রিফ্রেশ করে আবার চেষ্টা করুন।'; end if;
  if jsonb_typeof(p_items) is distinct from 'object' then raise exception 'সম্পদের তালিকা ঠিক নেই'; end if;
  if p_employee is null and p_items <> '{}'::jsonb then raise exception 'স্টাফ বাছুন'; end if;
  if p_employee is not null and not exists (
    select 1 from public.employees e where e.id = p_employee and e.status = 'active' and e.archived_at is null
      and (p.hub_id is null or e.hub_id = p.hub_id)
      and (p.zone_id is null or e.zone_id = p.zone_id or (p.hub_id is not null and e.hub_id = p.hub_id))
  ) then raise exception 'এই অফিসের সক্রিয় স্টাফ বাছুন'; end if;

  perform set_config('app.change_reason', 'ডেস্ক সেট বরাদ্দ বা ফেরত', true);
  for a in select * from public.office_assets
    where property_id = d.property_id and archived_at is null and (desk_id = d.id or p_items ? id::text)
    order by id for update
  loop
    requested := 0;
    if p_items ? a.id::text then
      matched := matched + 1;
      if jsonb_typeof(p_items -> a.id::text) <> 'number' then raise exception 'পরিমাণ ঠিক নেই'; end if;
      requested := (p_items ->> a.id::text)::integer;
      if requested < 1 or requested > a.quantity
        or (a.desk_id is distinct from d.id and (a.desk_id is not null or a.holder_id is not null or a.condition <> 'good')) then
        raise exception 'সম্পদের বরাদ্দ বা মজুত বদলেছে। আবার বাছুন।';
      end if;
    end if;
    if requested = a.quantity and a.desk_id = d.id and a.holder_id is not distinct from p_employee then continue; end if;
    if exists (select 1 from public.office_asset_loans where asset_id = a.id and returned_at is null) then
      raise exception 'ধারে থাকা সম্পদ আগে ফেরত নিন: %', a.name;
    end if;
    if requested > 0 and requested < a.quantity then
      if a.serial_no is not null or a.vehicle_id is not null then raise exception 'সিরিয়াল বা গাড়ির সাথে যুক্ত সম্পদ ভাগ করা যাবে না'; end if;
      copy := a;
      copy.id := gen_random_uuid();
      copy.quantity := a.quantity - requested;
      copy.desk_id := null;
      copy.holder_id := null;
      copy.created_at := now();
      copy.created_by := auth.uid();
      copy.updated_at := now();
      copy.updated_by := auth.uid();
      insert into public.office_assets select (copy).*;
    end if;
    update public.office_assets set
      desk_id = case when requested > 0 then d.id end,
      holder_id = case when requested > 0 then p_employee end,
      room_id = case when requested > 0 then d.room_id else a.room_id end,
      quantity = case when requested > 0 then requested else a.quantity end
    where id = a.id;
  end loop;
  if matched <> (select count(*) from jsonb_object_keys(p_items)) then raise exception 'বাছাই করা সম্পদ পাওয়া যায়নি'; end if;
  update public.office_desks set responsible_id = p_employee, desk_set_items = (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'quantity', quantity) order by id), '[]'::jsonb)
    from public.office_assets where desk_id = d.id and property_id = d.property_id and archived_at is null
  ) where id = d.id;
end $$;

revoke all on function public.office_save_desk_set(uuid, uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.office_save_desk_set(uuid, uuid, jsonb, timestamptz) to authenticated;
