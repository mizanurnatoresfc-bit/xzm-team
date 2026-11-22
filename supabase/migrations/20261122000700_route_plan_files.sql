-- =====================================================================
--  রুট: পরিকল্পনার পিডিএফ (the Steadfast panel PDFs behind a day's parcel plan)
--
--  Owner (22 Nov): "এখন পিডিএফ আপলোড অংশটা বানাও". Two PDFs of the courier panel fill the plan's numbers:
--    * Update list — one rider's list: how many parcels the rider got, how many were delivered, the COD total
--    * Dispatch    — what a sorting centre sent to the hub: parcels, for another hub, cancelled, scanned in or not
--  The browser reads the file and sends only what the plan needs: the document number and date, the rider's panel id,
--  counts, and the parcel ids. No customer name, phone or address is stored, and the file itself is not kept.
--
--    * route_day_files: one row per document (list / dispatch number). Uploading it again replaces the numbers.
--      A document belongs to one hub; it can be moved to another date of the same hub.
--    * The rider's panel id is matched to an employee by the table the daily accounts already use
--      (da_import_rider_map, then the Employee ID) — no second mapping table.
--    * Rights: whoever may type the plan (ops.route_plan.create / edit) may upload, remove and match a rider.
--  Additive only: nothing dropped, no existing function replaced.
-- =====================================================================

create table if not exists public.route_day_files (
  id          uuid primary key default gen_random_uuid(),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  plan_date   date not null,
  kind        text not null check (kind in ('update_list', 'dispatch')),
  doc_no      text not null check (doc_no ~ '^[0-9]{5,12}$'),
  doc_date    date,                                                          -- the date printed on the document
  hub_text    text check (hub_text is null or length(hub_text) <= 120),      -- the hub as the document names it
  from_text   text check (from_text is null or length(from_text) <= 120),    -- dispatch: where it came from
  rider_code  text check (rider_code is null or rider_code ~ '^[0-9]{1,12}$'),   -- update list: the rider's panel id
  rider_name  text check (rider_name is null or length(rider_name) <= 120),
  counts      jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  parcel_ids  bigint[] not null default '{}' check (cardinality(parcel_ids) <= 5000),
  warnings    text[] not null default '{}',
  file_name   text check (file_name is null or length(file_name) <= 200),
  uploads     integer not null default 1 check (uploads >= 1),
  uploaded_by_name text,
  removed_at  timestamptz, removed_by uuid, remove_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint route_day_files_rider check (kind = 'update_list' or rider_code is null)
);
create unique index if not exists route_day_files_one_live on public.route_day_files (kind, doc_no) where removed_at is null;
create index if not exists route_day_files_hub_day on public.route_day_files (hub_id, plan_date) where removed_at is null;
create index if not exists route_day_files_zone on public.route_day_files (zone_id);

drop trigger if exists route_day_files_stamp on public.route_day_files;
create trigger route_day_files_stamp before insert or update on public.route_day_files for each row execute function private.stamp_row();
drop trigger if exists route_day_files_audit on public.route_day_files;
create trigger route_day_files_audit after insert or update or delete on public.route_day_files for each row execute function private.audit_row('ops');
drop trigger if exists route_day_files_no_delete on public.route_day_files;
create trigger route_day_files_no_delete before delete on public.route_day_files for each row execute function private.prevent_delete();
alter table public.route_day_files enable row level security;
revoke all on public.route_day_files from anon, authenticated;
grant select on public.route_day_files to authenticated;
drop policy if exists rdf_read on public.route_day_files;
create policy rdf_read on public.route_day_files for select to authenticated
  using (private.has_permission('ops.route_plan.view', zone_id, hub_id));

create or replace function private.route_plan_can_type(p_zone uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission('ops.route_plan.create', p_zone, p_hub) or private.has_permission('ops.route_plan.edit', p_zone, p_hub)
$$;

-- p: {kind, doc_no, doc_date?, hub_text?, from_text?, rider_code?, rider_name?, counts: {name: number}, parcel_ids: [..], warnings?: [..], file_name?}
create or replace function public.route_plan_file_save(p_hub uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_old public.route_day_files; v_id uuid; v_kind text; v_no text; v_ids bigint[]; v_doc date; v_rider text; v_name text; k text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null and status = 'active';
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.route_plan_can_type(v_zone, p_hub) then
    raise exception 'Not authorised to upload for the parcel plan of this hub.' using errcode = '42501';
  end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 30 then
    raise exception 'A plan is for a date from 30 days back to tomorrow.' using errcode = '22023';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The document must be an object.' using errcode = '22023'; end if;
  v_kind := p ->> 'kind'; v_no := trim(coalesce(p ->> 'doc_no', ''));
  if v_kind is null or v_kind not in ('update_list', 'dispatch') then raise exception 'The document is an update list or a dispatch sheet.' using errcode = '22023'; end if;
  if v_no !~ '^[0-9]{5,12}$' then raise exception 'The document number is written wrongly.' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p -> 'counts', '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p -> 'parcel_ids', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p -> 'warnings', '[]'::jsonb)) <> 'array' then
    raise exception 'The numbers of the document are written wrongly.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(coalesce(p -> 'counts', '{}'::jsonb)) loop
    if k !~ '^[a-z_:]{1,40}$' or jsonb_typeof(p -> 'counts' -> k) <> 'number' or (p -> 'counts' ->> k)::numeric < 0 or (p -> 'counts' ->> k)::numeric > 1000000000 then
      raise exception 'A number of the document is written wrongly.' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(coalesce(p -> 'parcel_ids', '[]'::jsonb)) > 5000 then raise exception 'The document has too many parcels (5000 at most).' using errcode = '22023'; end if;
  begin
    select coalesce(array_agg(distinct (e #>> '{}')::bigint), '{}') into v_ids from jsonb_array_elements(coalesce(p -> 'parcel_ids', '[]'::jsonb)) e;
    v_doc := nullif(p ->> 'doc_date', '')::date;
  exception when others then raise exception 'A parcel id or the date of the document is written wrongly.' using errcode = '22023'; end;
  if cardinality(v_ids) = 0 then raise exception 'The document has no parcels.' using errcode = '22023'; end if;
  v_rider := nullif(trim(coalesce(p ->> 'rider_code', '')), '');
  if v_kind = 'dispatch' then v_rider := null; end if;
  if v_rider is not null and v_rider !~ '^[0-9]{1,12}$' then raise exception 'The rider id is written wrongly.' using errcode = '22023'; end if;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();

  select * into v_old from public.route_day_files where kind = v_kind and doc_no = v_no and removed_at is null for update;
  if v_old.id is not null and v_old.hub_id <> p_hub then
    raise exception 'This document is already uploaded for another hub.' using errcode = '23505';
  end if;
  if v_old.id is null then
    insert into public.route_day_files (hub_id, zone_id, plan_date, kind, doc_no, doc_date, hub_text, from_text, rider_code, rider_name, counts, parcel_ids, warnings, file_name, uploaded_by_name)
    values (p_hub, v_zone, p_date, v_kind, v_no, v_doc, left(nullif(trim(p ->> 'hub_text'), ''), 120), left(nullif(trim(p ->> 'from_text'), ''), 120), v_rider,
      left(nullif(trim(p ->> 'rider_name'), ''), 120), coalesce(p -> 'counts', '{}'::jsonb), v_ids,
      coalesce((select array_agg(left(e #>> '{}', 40)) from jsonb_array_elements(coalesce(p -> 'warnings', '[]'::jsonb)) e), '{}'),
      left(nullif(trim(p ->> 'file_name'), ''), 200), v_name)
    returning id into v_id;
  else
    v_id := v_old.id;
    update public.route_day_files set plan_date = p_date, doc_date = v_doc, hub_text = left(nullif(trim(p ->> 'hub_text'), ''), 120),
      from_text = left(nullif(trim(p ->> 'from_text'), ''), 120), rider_code = v_rider, rider_name = left(nullif(trim(p ->> 'rider_name'), ''), 120),
      counts = coalesce(p -> 'counts', '{}'::jsonb), parcel_ids = v_ids,
      warnings = coalesce((select array_agg(left(e #>> '{}', 40)) from jsonb_array_elements(coalesce(p -> 'warnings', '[]'::jsonb)) e), '{}'),
      file_name = left(nullif(trim(p ->> 'file_name'), ''), 200), uploads = uploads + 1, uploaded_by_name = v_name
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.route_plan_file_remove(p_file uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_files;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.route_day_files where id = p_file and removed_at is null for update;
  if v.id is null or not private.route_plan_can_type(v.zone_id, v.hub_id) then
    raise exception 'Not authorised to remove this document.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 300 then raise exception 'Write why the document is removed.' using errcode = '22023'; end if;
  update public.route_day_files set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = v.id;
end $$;

-- The rider's id on the courier panel belongs to this employee (the same table the daily accounts import uses).
create or replace function public.route_plan_map_rider(p_hub uuid, p_code text, p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_code text := trim(coalesce(p_code, '')); v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null or not private.route_plan_can_type(v_zone, p_hub) then
    raise exception 'Not authorised to match riders at this hub.' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{1,12}$' then raise exception 'The rider id is written wrongly.' using errcode = '22023'; end if;
  if not exists (select 1 from public.route_day_files f where f.hub_id = p_hub and f.rider_code = v_code and f.removed_at is null) then
    raise exception 'No uploaded list of this hub has this rider id.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.hub_id = p_hub and e.status = 'active' and e.archived_at is null) then
    raise exception 'A person is not an active staff member of this hub.' using errcode = '22023';
  end if;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  insert into public.da_import_rider_map (rider_code, employee_id, mapped_by_name) values (v_code, p_employee, v_name)
  on conflict (rider_code) do update set employee_id = excluded.employee_id, mapped_by_name = excluded.mapped_by_name;
end $$;

-- The documents of a hub and date, each rider's id matched to an employee, and what the two kinds say together.
create or replace function public.route_plan_files(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, current_date); v_zone uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route_plan.view', v_zone, p_hub) then
    raise exception 'Not authorised to see the parcel plan of this hub.' using errcode = '42501';
  end if;
  return jsonb_build_object('date', v_date, 'can_upload', private.route_plan_can_type(v_zone, p_hub),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'doc_no', f.doc_no, 'doc_date', f.doc_date, 'hub_text', f.hub_text,
        'from_text', f.from_text, 'rider_code', f.rider_code, 'rider_name', f.rider_name,
        'employee_id', (select e.id from public.employees e where e.id = private.da_import_emp(f.rider_code) and e.hub_id = p_hub and e.archived_at is null),
        'on_report', f.kind = 'update_list' and exists (select 1 from public.da_import_lists l where l.list_no::text = f.doc_no and l.removed_at is null),
        'counts', f.counts, 'parcels', cardinality(f.parcel_ids), 'warnings', f.warnings, 'file_name', f.file_name, 'uploads', f.uploads,
        'uploaded_by_name', f.uploaded_by_name, 'updated_at', f.updated_at) order by f.kind, f.doc_no)
      from public.route_day_files f where f.hub_id = p_hub and f.plan_date = v_date and f.removed_at is null), '[]'::jsonb),
    -- parcels of the day's dispatch sheets that are on none of the day's update lists (only when both kinds are uploaded)
    'unlisted', (select count(*) from (select distinct x.id from public.route_day_files f cross join lateral unnest(f.parcel_ids) x(id)
                    where f.hub_id = p_hub and f.plan_date = v_date and f.removed_at is null and f.kind = 'dispatch') d
                  where exists (select 1 from public.route_day_files f where f.hub_id = p_hub and f.plan_date = v_date and f.removed_at is null and f.kind = 'update_list')
                    and not exists (select 1 from public.route_day_files f where f.hub_id = p_hub and f.plan_date = v_date and f.removed_at is null
                                      and f.kind = 'update_list' and d.id = any(f.parcel_ids))));
end $$;

revoke all on function private.route_plan_can_type(uuid, uuid) from public, anon;
revoke all on function public.route_plan_file_save(uuid, date, jsonb), public.route_plan_file_remove(uuid, text),
  public.route_plan_map_rider(uuid, text, uuid), public.route_plan_files(uuid, date) from public, anon;
grant execute on function public.route_plan_file_save(uuid, date, jsonb), public.route_plan_file_remove(uuid, text),
  public.route_plan_map_rider(uuid, text, uuid), public.route_plan_files(uuid, date) to authenticated;
