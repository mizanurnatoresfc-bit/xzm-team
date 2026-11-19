create table if not exists public.geo_upazilas (
  code        integer primary key,
  district    text not null,
  district_bn text not null,
  name        text not null,
  name_bn     text not null,
  boundary    jsonb check (boundary is null or jsonb_typeof(boundary) = 'array'),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table if not exists public.route_places (
  id           uuid primary key default gen_random_uuid(),
  upazila_code integer not null references public.geo_upazilas(code),
  kind         text not null check (kind in ('village', 'para', 'market', 'union', 'town', 'other')),
  name         text check (name is null or length(name) <= 160),
  name_bn      text check (name_bn is null or length(name_bn) <= 160),
  bn_checked   boolean not null default false,
  lat          numeric(10,7) check (lat between 20.3 and 26.8),
  lng          numeric(10,7) check (lng between 87.9 and 92.8),
  source       text not null check (source in ('geonames', 'osm', 'bbs', 'manual')),
  source_ref   text,
  hidden       boolean not null default false,
  hidden_reason text,
  note         text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (coalesce(nullif(trim(name_bn), ''), nullif(trim(name), '')) is not null),
  check ((lat is null) = (lng is null)),
  unique (source, source_ref)
);
create index if not exists route_places_upazila on public.route_places (upazila_code) where not hidden;

do $$
declare t text;
begin
  foreach t in array array['geo_upazilas', 'route_places'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'ops');
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Place names are reference data (like a map): every signed-in person may read them.
drop policy if exists gu_read on public.geo_upazilas;
create policy gu_read on public.geo_upazilas for select to authenticated using (true);
drop policy if exists rp_read on public.route_places;
create policy rp_read on public.route_places for select to authenticated using (true);

-- The caller holds this permission somewhere (any scope).
create or replace function private.has_permission_anywhere(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.my_grants() g where g.permission_code = p_perm or (g.is_super and g.scope_type = 'global'))
$$;

-- Add a place, or fix one (spelling, kind, location, note). p: {id?, upazila_code, name_bn, name?, kind, lat?, lng?, note?}
create or replace function public.route_place_save(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_lat numeric := nullif(p ->> 'lat', '')::numeric; v_lng numeric := nullif(p ->> 'lng', '')::numeric;
  v_bn text := nullif(trim(coalesce(p ->> 'name_bn', '')), ''); v_en text := nullif(trim(coalesce(p ->> 'name', '')), '');
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'village'); v_upz integer := nullif(p ->> 'upazila_code', '')::integer;
begin
  if not private.has_permission_anywhere('ops.route_setting.edit') then
    raise exception 'Not authorised to change place names.' using errcode = '42501';
  end if;
  if coalesce(v_bn, v_en) is null then raise exception 'Give the place a name.' using errcode = '22023'; end if;
  if v_kind not in ('village', 'para', 'market', 'union', 'town', 'other') then raise exception 'Unknown place kind.' using errcode = '22023'; end if;
  if (v_lat is null) <> (v_lng is null) then raise exception 'Give both latitude and longitude.' using errcode = '22023'; end if;
  if v_lat is not null and not private.geo_in_bd(v_lat, v_lng) then
    raise exception 'The location is outside Bangladesh (latitude and longitude swapped?).' using errcode = '22023';
  end if;
  if v_id is null then
    if not exists (select 1 from public.geo_upazilas where code = v_upz) then raise exception 'Unknown upazila.' using errcode = '22023'; end if;
    insert into public.route_places (upazila_code, kind, name, name_bn, bn_checked, lat, lng, source, source_ref, note)
    values (v_upz, v_kind, v_en, v_bn, v_bn is not null, v_lat, v_lng, 'manual', gen_random_uuid()::text, nullif(trim(coalesce(p ->> 'note', '')), ''))
    returning id into v_id;
  else
    update public.route_places set kind = v_kind, name = coalesce(v_en, name), name_bn = v_bn,
      bn_checked = bn_checked or (v_bn is distinct from name_bn) or coalesce((p ->> 'bn_checked')::boolean, false),
      lat = v_lat, lng = v_lng, note = nullif(trim(coalesce(p ->> 'note', '')), ''),
      upazila_code = coalesce(v_upz, upazila_code)
    where id = v_id;
    if not found then raise exception 'Place not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception
  when check_violation then raise exception 'A value of the place is outside its allowed range.' using errcode = '22023';
  when invalid_text_representation then raise exception 'A number or a location is written wrongly.' using errcode = '22023';
end $$;

-- Hide a wrong / duplicate place (kept, never deleted), or show it again.
create or replace function public.route_place_hide(p_id uuid, p_hidden boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission_anywhere('ops.route_setting.edit') then
    raise exception 'Not authorised to change place names.' using errcode = '42501';
  end if;
  if p_hidden and length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'Write why the place is hidden.' using errcode = '22023'; end if;
  update public.route_places set hidden = p_hidden, hidden_reason = case when p_hidden then trim(p_reason) end where id = p_id;
  if not found then raise exception 'Place not found.' using errcode = 'P0002'; end if;
end $$;

revoke all on function private.has_permission_anywhere(text) from public, anon, authenticated;
revoke all on function public.route_place_save(jsonb), public.route_place_hide(uuid, boolean, text) from public, anon;
grant execute on function public.route_place_save(jsonb), public.route_place_hide(uuid, boolean, text) to authenticated;
