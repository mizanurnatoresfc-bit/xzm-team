-- =====================================================================
--  Region → Area → Hub
--  * regions: new top level (Rajshahi Region). Existing "zones" are the Areas.
--  * hubs get GPS (latitude/longitude, kept exactly as given), hub_type and
--    ops_zone (both null = Unassigned). GPS is NOT unique: two hubs may share it.
--  * hub_import_rows: the 10 Natore hubs from the owner's list. Rows whose hub
--    is certain (phone match) are applied here; the rest wait for the owner
--    to pick the hub (or create a new one) from the Hub list page.
--  Nothing is deleted. Existing values are only filled where blank.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('org.region.view',    'org', 'region', 'view',    'See regions'),
  ('org.region.create',  'org', 'region', 'create',  'Add regions'),
  ('org.region.edit',    'org', 'region', 'edit',    'Change regions and which areas sit under them'),
  ('org.region.archive', 'org', 'region', 'archive', 'Close (archive) a region')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager') and p.code like 'org.region.%')
  or (r.code in ('zonal_manager', 'operations_manager', 'hub_manager', 'accounts_manager', 'auditor') and p.code = 'org.region.view')
) on conflict do nothing;

create table public.regions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            extensions.citext not null unique,
  name            text not null check (length(trim(name)) > 0),
  name_bn         text,
  status          text not null default 'active' check (status in ('active','inactive')),
  archived_at     timestamptz,
  archived_by     uuid,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
create trigger regions_stamp before insert or update on public.regions for each row execute function private.stamp_row();
create trigger regions_audit after insert or update or delete on public.regions for each row execute function private.audit_row('org');
create trigger regions_no_delete before delete on public.regions for each row execute function private.prevent_delete();

alter table public.zones add column region_id uuid references public.regions(id);
create index zones_region_idx on public.zones (region_id);

alter table public.hubs
  add column latitude  numeric(10,7) check (latitude between -90 and 90),
  add column longitude numeric(10,7) check (longitude between -180 and 180),
  add column hub_type  text,      -- null = Unassigned
  add column ops_zone  text;      -- null = Unassigned (operational zone, separate from Area)

alter table public.regions enable row level security;
create policy regions_read on public.regions for select to authenticated using (
  private.has_permission('org.region.view')
  or exists (select 1 from public.zones z where z.region_id = regions.id and private.has_permission_within_zone('org.zone.view', z.id)));
create policy regions_insert on public.regions for insert to authenticated
  with check (private.has_permission('org.region.create'));
create policy regions_update on public.regions for update to authenticated
  using (private.has_permission('org.region.edit'))
  with check (private.has_permission('org.region.edit') and (archived_at is null or private.has_permission('org.region.archive')));
grant select, insert, update on public.regions to authenticated;

-- archive_org_unit now also closes regions.
create or replace function public.archive_org_unit(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_rows int;
begin
  if p_table not in ('regions','zones','hubs','departments','positions') then
    raise exception 'Unsupported table %', p_table;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'An archive reason is required.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  execute format('update public.%I set archived_at = now(), archived_by = auth.uid(),
                  archive_reason = $1, status = ''inactive'' where id = $2 and archived_at is null', p_table)
    using p_reason, p_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Record not found, already archived, or not authorised.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.archive_org_unit(text, uuid, text) from public, anon;
grant execute on function public.archive_org_unit(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
--  Import list
-- ---------------------------------------------------------------------
create table public.hub_import_rows (
  id             uuid primary key default gen_random_uuid(),
  batch          text not null,
  sl             int not null,
  zone_id        uuid not null references public.zones(id),
  code           text not null,
  phone          text,
  address        text,
  latitude       numeric(10,7),
  longitude      numeric(10,7),
  suggested_hub_id uuid references public.hubs(id),
  suggest_note   text,
  applied_hub_id uuid references public.hubs(id),
  applied_at     timestamptz,
  applied_by     uuid,
  result_note    text,
  created_at     timestamptz not null default now(),
  unique (batch, code)
);
create trigger hub_import_rows_audit after insert or update or delete on public.hub_import_rows for each row execute function private.audit_row('org');
create trigger hub_import_rows_no_delete before delete on public.hub_import_rows for each row execute function private.prevent_delete();
alter table public.hub_import_rows enable row level security;
create policy hub_import_rows_read on public.hub_import_rows for select to authenticated
  using (private.has_permission('org.hub.view', zone_id));
grant select on public.hub_import_rows to authenticated;

-- Apply one import row: to an existing hub (p_hub) or as a new hub (p_name).
-- Existing hub values are only filled where blank; differences are reported.
create or replace function public.hub_import_apply(p_row uuid, p_hub uuid, p_name text default null, p_name_bn text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.hub_import_rows;
  h public.hubs;
  v_holder public.hubs;
  v_notes text[] := '{}';
  v_id uuid;
begin
  select * into r from public.hub_import_rows where id = p_row for update;
  if not found then raise exception 'ইমপোর্ট লাইন পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if r.applied_at is not null then raise exception 'এই লাইন আগেই বসানো হয়েছে' using errcode = 'P0001'; end if;
  perform set_config('app.change_reason', 'Hub list import ' || r.batch || ' #' || r.code, true);

  if p_hub is not null then
    select * into h from public.hubs where id = p_hub for update;
    if not found or h.archived_at is not null then raise exception 'চালু হাব বেছে নিন' using errcode = 'P0001'; end if;
    if not private.has_permission('org.hub.edit', h.zone_id, h.id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if h.code::text ~ '^\d+$' and h.code::text <> r.code then
      raise exception 'এই হাবের আগে থেকেই কোড #% আছে', h.code using errcode = 'P0001';
    end if;
    if h.code::text <> r.code then
      select * into v_holder from public.hubs where code = r.code::extensions.citext and id <> h.id;
      if found then
        if v_holder.archived_at is null then
          raise exception 'কোড #% আরেকটি চালু হাবে (%) আছে', r.code, v_holder.name using errcode = 'P0001';
        end if;
        update public.hubs set code = (r.code || '-OLD')::extensions.citext where id = v_holder.id;
        v_notes := v_notes || ('পুরোনো আর্কাইভ হাবের কোড ' || r.code || '-OLD করা হলো');
        -- take blanks from the archived twin (same hub, fuller data)
        h.name_bn := coalesce(h.name_bn, v_holder.name_bn);
        h.address := coalesce(h.address, v_holder.address);
      end if;
    end if;
    if h.phone is not null and r.phone is not null and h.phone <> r.phone then v_notes := v_notes || ('ফোন আলাদা: সিস্টেমে ' || h.phone || ', তালিকায় ' || r.phone); end if;
    if h.latitude is not null and (h.latitude <> r.latitude or h.longitude <> r.longitude) then v_notes := v_notes || 'GPS আলাদা — সিস্টেমেরটা রাখা হলো'; end if;
    update public.hubs set code = r.code::extensions.citext,
      name_bn = h.name_bn,
      phone = coalesce(h.phone, r.phone),
      address = coalesce(h.address, r.address),
      latitude = coalesce(h.latitude, r.latitude),
      longitude = coalesce(h.longitude, r.longitude)
    where id = h.id;
    v_id := h.id;
  else
    if coalesce(trim(p_name), '') = '' then raise exception 'নতুন হাবের নাম দিন' using errcode = '22023'; end if;
    if not private.has_permission('org.hub.create', r.zone_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    select * into v_holder from public.hubs where code = r.code::extensions.citext;
    if found then
      if v_holder.archived_at is null then raise exception 'কোড #% আরেকটি চালু হাবে (%) আছে', r.code, v_holder.name using errcode = 'P0001'; end if;
      update public.hubs set code = (r.code || '-OLD')::extensions.citext where id = v_holder.id;
      v_notes := v_notes || ('পুরোনো আর্কাইভ হাবের কোড ' || r.code || '-OLD করা হলো');
    end if;
    insert into public.hubs (zone_id, code, name, name_bn, phone, address, latitude, longitude, status)
    values (r.zone_id, r.code::extensions.citext, trim(p_name), nullif(trim(coalesce(p_name_bn, '')), ''), r.phone, r.address, r.latitude, r.longitude, 'active')
    returning id into v_id;
  end if;

  update public.hub_import_rows set applied_hub_id = v_id, applied_at = now(), applied_by = auth.uid(),
    result_note = nullif(array_to_string(v_notes, '; '), '') where id = r.id;
  return jsonb_build_object('hub_id', v_id, 'notes', to_jsonb(v_notes));
end $$;
revoke all on function public.hub_import_apply(uuid, uuid, text, text) from public, anon;
grant execute on function public.hub_import_apply(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
--  Data: Rajshahi Region, Natore Area, the 10-hub list
-- ---------------------------------------------------------------------
do $$
declare
  v_zone uuid; v_org uuid; v_region uuid;
  v_old public.hubs;
begin
  perform set_config('app.change_reason', 'Region → Area → Hub setup (owner approved)', true);
  select id, organization_id into v_zone, v_org from public.zones where code = 'NAT';
  if v_zone is null then return; end if;

  insert into public.regions (organization_id, code, name, name_bn)
  values (v_org, 'RAJ', 'Rajshahi Region', 'রাজশাহী রিজিওন')
  on conflict (code) do nothing;
  select id into v_region from public.regions where code = 'RAJ';

  update public.zones set region_id = v_region,
    name = case when name = 'Natore Zone' then 'Natore Area' else name end,
    name_bn = case when name_bn = 'নাটোর জোন' then 'নাটোর এরিয়া' else name_bn end
  where id = v_zone;

  insert into public.hub_import_rows (batch, sl, zone_id, code, phone, address, latitude, longitude, suggested_hub_id, suggest_note) values
   ('natore-10', 1,  v_zone, '731',  '01332567007', 'হোল্ডিং নংঃ ১৪৫, ওয়ার্ড নংঃ ০৫ (সোনাপাতিল), মালঞ্চি বাজার, বা...', 24.3035390, 88.9597730,
      (select id from public.hubs where code = '731'), 'কোড ও ফোন মিলেছে'),
   ('natore-10', 2,  v_zone, '986',  '01334919511', 'দোকান নং: ০২, শাহীন সুপার মার্কেট, বনপাড়া বাইপাস, বড়াইগ্রাম...', 24.2977770, 89.0798180,
      (select id from public.hubs where code = 'BORAIGRAMNAT'), 'ঠিকানায় বনপাড়া/বড়াইগ্রাম'),
   ('natore-10', 3,  v_zone, '276',  '01329671848', 'হোল্ডিং নম্বর - ৬২২, ওয়ার্ড - ০৩, শফিক ইঞ্জিনিয়ার এর গোডাউন, সর...', 24.2847510, 89.0835090,
      null, 'GPS বড়াইগ্রামের কাছে — নিশ্চিত নয়'),
   ('natore-10', 4,  v_zone, '564',  '01332567006', 'হোল্ডিং নং: এ-০০৫২-০০, মোঃ আব্দুর রাজ্জাক বাসা নিচতলা, আমজা...', 24.3688560, 89.2465440,
      (select id from public.hubs where code = 'GURUDASPURNA'), 'GPS গুরুদাসপুরের কাছে'),
   ('natore-10', 5,  v_zone, '779',  '01334766031', 'পল্লী বিদ্যুৎ অফিসের পাশে (গোপালপুর রোড), গৌরীপুর, লালপুর, নাট...', 24.1834500, 88.9735690,
      (select id from public.hubs where code = 'LALPURNATORE'), 'ফোন মিলেছে (পুরোনো লালপুর #779)'),
   ('natore-10', 6,  v_zone, '861',  '01332846529', null, 24.4977880, 88.9543020,
      (select id from public.hubs where code = 'NALDANGANATO'), 'GPS নলডাঙ্গার কাছে — নিশ্চিত নয়'),
   ('natore-10', 7,  v_zone, '80',   '01321230727', 'বাসা নংঃ ১১৯, রোড নংঃ ০১, ওয়ার্ড নংঃ ০৩, চক রামপুর, নাটোর', 24.4124350, 89.0024500,
      (select id from public.hubs where code = 'NATORESADAR'), 'ফোন মিলেছে পুরোনো "Natore #80"-এর সাথে'),
   ('natore-10', 8,  v_zone, '832',  '01332843429', 'দোআ কমপ্লেক্স, বড় হরিশপুর (একতার মোড়), নাটোর', 24.4108020, 89.0047540,
      null, 'নাটোর শহর — নতুন হাব হতে পারে'),
   ('natore-10', 9,  v_zone, '1016', '01334930536', '১১৯ এর (লিয়াকত সাহেবের বাসার বিপরীত গোডাউন), রোড নংঃ ০১, ওয়ার্ড...', 24.4124350, 89.0024500,
      null, '#80-এর একই GPS — আলাদা হাব'),
   ('natore-10', 10, v_zone, '782',  '01334766030', 'হোল্ডিং নংঃ ৪৩৮, ওয়ার্ড নংঃ পৌর ০৮, মহল্লার নামঃ গোডাউন পাড়া, থা...', 24.5003390, 89.1407840,
      (select id from public.hubs where code = 'SINGRANATOREAABB'), 'GPS সিংড়ার কাছে')
  on conflict (batch, code) do nothing;

  -- Certain matches (phone match), applied now. Blanks only.
  update public.hubs set latitude = 24.3035390, longitude = 88.9597730
   where code = '731' and archived_at is null and latitude is null;
  update public.hub_import_rows set applied_hub_id = (select id from public.hubs where code = '731'), applied_at = now(),
    result_note = 'GPS যোগ হলো; ফোন ও ঠিকানা আগের মতো' where batch = 'natore-10' and code = '731' and applied_at is null;

  select * into v_old from public.hubs where code = '779' and archived_at is not null;
  if found and exists (select 1 from public.hubs where code = 'LALPURNATORE' and archived_at is null) then
    update public.hubs set code = '779-OLD' where id = v_old.id;
    update public.hubs set code = '779',
      name_bn = coalesce(name_bn, v_old.name_bn),
      phone = coalesce(phone, '01334766031'),
      address = coalesce(address, v_old.address),
      latitude = coalesce(latitude, 24.1834500), longitude = coalesce(longitude, 88.9735690)
     where code = 'LALPURNATORE' and archived_at is null;
    update public.hub_import_rows set applied_hub_id = (select id from public.hubs where code = '779'), applied_at = now(),
      result_note = 'চালু Lalpur(Natore)-এ কোড #779, ফোন, পুরো ঠিকানা ও GPS বসলো; পুরোনো আর্কাইভ হাবের কোড 779-OLD'
     where batch = 'natore-10' and code = '779' and applied_at is null;
  end if;
end $$;
