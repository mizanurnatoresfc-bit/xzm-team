-- =====================================================================
--  Company sheets ("কোম্পানি শিট")
--
--  The company asks for Excel sheets in its own layout (ID create, ID transfer, ...) and
--  the layout changes from time to time. A company sheet remembers one such layout:
--  the title, the grouped headings and every column in order, and for each column where
--  its value comes from in this system. The sheet is then filled from HR requests or from
--  the staff records and downloaded looking like the company's own file.
--
--  * company_sheets: one layout. source = 'requests' (one row per HR request of a kind)
--    or 'staff' (one row per employee).
--  * columns: [{ "head": "...", "group": "...", "src": "...", "w": 18 }]
--      src is one or more places, the first that has a value wins:  a|b|c
--        sl                 running number
--        emp:<field>        a staff column (the same names hr_export_rows knows, cf:<code> too)
--        doc:<type>         "Yes" when that paper is on file (photo, nid_front, nid_back, ...)
--        req:<key>          an answer from the request form
--        req.<no|date|status|result|note|decision|hub>
--        ref                reference person: name and ID
--        fixed:<text>       always this text
--        blank              left empty (typed by hand before sending)
--  * hr_sheet_people: staff details for a list of people, under exactly the rules of
--    hr_export_rows (who you may see; NID / salary only with the right; exports of private
--    details go to the audit log). A column that no longer exists is skipped, not an error.
--  Nothing is hard-deleted.
-- =====================================================================

create table public.company_sheets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 1),
  name_bn     text,
  source      text not null default 'requests' check (source in ('requests', 'staff')),
  kind        text check (kind is null or kind in ('id_create', 'id_transfer', 'id_active', 'id_inactive', 'custom')),
  format_id   uuid references public.hr_request_formats(id),
  title       text,
  title_at    jsonb check (title_at is null or (jsonb_typeof(title_at) = 'array' and jsonb_array_length(title_at) = 2)),
  columns     jsonb not null check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) between 1 and 80),
  file_name   text,
  sort_order  integer not null default 100,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  constraint company_sheets_source_chk check ((source = 'requests' and kind is not null) or (source = 'staff' and kind is null and format_id is null))
);
create unique index company_sheets_name_uq on public.company_sheets (lower(name)) where archived_at is null;
create index company_sheets_format_idx on public.company_sheets (format_id);

-- One place a column may take its value from.
create or replace function private.sheet_src_ok(p_src text) returns boolean
language sql immutable set search_path = '' as $$
  select p_src in ('sl', 'blank', 'ref', 'req.no', 'req.date', 'req.status', 'req.result', 'req.note', 'req.decision', 'req.hub')
      or p_src ~ '^emp:(cf:)?[a-z][a-z0-9_]{0,60}$'
      or p_src ~ '^doc:[a-z][a-z0-9_]{0,40}$'
      or p_src ~ '^req:[a-z][a-z0-9_]{0,60}$'
      or (p_src like 'fixed:%' and length(p_src) <= 206)
$$;

create or replace function private.company_sheet_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare col jsonb; part text; v_staff boolean := new.source = 'staff';
begin
  for col in select * from jsonb_array_elements(new.columns) loop
    if jsonb_typeof(col) <> 'object' or coalesce(trim(col ->> 'head'), '') = '' then
      raise exception 'Each column needs a heading.' using errcode = '22023';
    end if;
    if coalesce(col ->> 'src', '') = '' then
      raise exception 'Column "%" needs a source.', col ->> 'head' using errcode = '22023';
    end if;
    -- "fixed:" text may hold a bar, so it is always the last place
    if col ->> 'src' like 'fixed:%' then
      if length(col ->> 'src') > 206 then raise exception 'Column "%": the fixed text is too long.', col ->> 'head' using errcode = '22023'; end if;
      continue;
    end if;
    foreach part in array string_to_array(regexp_replace(col ->> 'src', '\|fixed:.*$', ''), '|') loop
      if not private.sheet_src_ok(part) then
        raise exception 'Column "%": unknown source %.', col ->> 'head', part using errcode = '22023';
      end if;
      if v_staff and (part like 'req:%' or part like 'req.%') then
        raise exception 'Column "%": a staff sheet cannot take a value from a request.', col ->> 'head' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if new.format_id is not null and not exists (select 1 from public.hr_request_formats f where f.id = new.format_id and f.kind = new.kind) then
    raise exception 'The request format does not match the kind of sheet.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null then new.archived_by := auth.uid(); end if;
  return new;
end $$;

create trigger company_sheets_guard before insert or update on public.company_sheets
  for each row execute function private.company_sheet_guard();
create trigger company_sheets_stamp before insert or update on public.company_sheets
  for each row execute function private.stamp_row();
create trigger company_sheets_audit after insert or update or delete on public.company_sheets
  for each row execute function private.audit_row('hr');
create trigger company_sheets_no_delete before delete on public.company_sheets
  for each row execute function private.prevent_delete();

alter table public.company_sheets enable row level security;
revoke all on public.company_sheets from anon;
grant select, insert, update on public.company_sheets to authenticated;

create policy company_sheets_read on public.company_sheets for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy company_sheets_insert on public.company_sheets for insert to authenticated
  with check (private.has_permission('hr.request.configure'));
create policy company_sheets_update on public.company_sheets for update to authenticated
  using (private.has_permission('hr.request.configure')) with check (private.has_permission('hr.request.configure'));

-- ---------------------------------------------------------------------
-- Staff details for the people on a sheet, honouring every permission.
-- Returns { "<employee id>": { "<field>": value, "doc:photo": true, ... } }; a field with no value is left out.
-- ---------------------------------------------------------------------
create or replace function public.hr_sheet_people(p_ids uuid[], p_fields text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_fields text[];
  v_out jsonb;
  v_sensitive boolean;
begin
  if auth.uid() is null or not exists (select 1 from private.my_grants()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return '{}'::jsonb; end if;
  if array_length(p_ids, 1) > 5000 then
    raise exception 'Too many people for one sheet (5000 at most).' using errcode = '22023';
  end if;
  if coalesce(array_length(p_fields, 1), 0) > 120 then
    raise exception 'Too many columns.' using errcode = '22023';
  end if;
  -- columns that no longer exist are simply left out
  select coalesce(array_agg(distinct f), '{}'::text[]) into v_fields
    from unnest(coalesce(p_fields, '{}'::text[])) f
   where f ~ '^doc:[a-z][a-z0-9_]{0,40}$' or private.export_field_ok(f);
  v_sensitive := v_fields && array['nid_number','date_of_birth','father_name','mother_name','present_address','permanent_address'];

  select coalesce(jsonb_object_agg(q.id, q.obj), '{}'::jsonb) into v_out
  from (
    select e.id::text as id,
           jsonb_strip_nulls(coalesce((select jsonb_object_agg(k, v.full_row -> k) from unnest(v_fields) k), '{}'::jsonb)) as obj
    from public.employees e
    left join public.hubs h on h.id = e.hub_id
    left join public.zones z on z.id = e.zone_id
    left join public.departments d on d.id = e.department_id
    left join public.positions p on p.id = e.position_id
    left join public.employees rf on rf.id = e.referred_by_employee_id
    left join public.employee_sensitive s on s.employee_id = e.id
    left join lateral (
      select c.basic_salary, c.transport_allowance, c.commission
        from public.employee_compensation c
       where c.employee_id = e.id and c.status = 'approved' and c.effective_from <= current_date
       order by c.effective_from desc limit 1) comp on true
    left join lateral (
      select jsonb_object_agg('cf:' || cf.code, cv.value) vals
        from public.employee_custom_field_values cv
        join public.employee_custom_fields cf on cf.id = cv.field_id
       where cv.employee_id = e.id and cf.archived_at is null
         and (cf.view_permission is null or private.has_permission(cf.view_permission, e.zone_id, e.hub_id))) cus on true
    left join lateral (
      select jsonb_object_agg('doc:' || x.doc_type, true) flags
        from (select distinct dc.doc_type from public.employee_documents dc
               where dc.employee_id = e.id and dc.archived_at is null
                 and private.has_permission(case when dc.doc_type in ('nid_front', 'nid_back') then 'hr.employee_sensitive.view' else 'hr.document.view' end,
                                            e.zone_id, e.hub_id)) x) docs on true
    cross join lateral (
      select jsonb_build_object(
        'employee_code', e.employee_code::text, 'full_name', e.full_name, 'full_name_bn', e.full_name_bn,
        'mobile', e.mobile, 'email', e.email::text,
        'hub_name', h.name, 'hub_code', h.code::text, 'zone_name', z.name,
        'department_name', d.name, 'position_name', p.name,
        'status', e.status, 'joining_date', e.joining_date, 'status_since', e.status_since,
        'referrer_code', rf.employee_code::text, 'referrer_name', rf.full_name,
        'emergency_contact_name', e.emergency_contact_name, 'emergency_contact_phone', e.emergency_contact_phone)
        || case when private.has_permission('hr.compensation.view', e.zone_id, e.hub_id)
             then jsonb_build_object('basic_salary', comp.basic_salary, 'transport_allowance', comp.transport_allowance,
                                     'commission', comp.commission) else '{}'::jsonb end
        || case when private.has_permission('hr.employee_sensitive.view', e.zone_id, e.hub_id)
             then jsonb_build_object('nid_number', s.nid_number, 'date_of_birth', s.date_of_birth,
                                     'father_name', s.father_name, 'mother_name', s.mother_name,
                                     'present_address', s.present_address, 'permanent_address', s.permanent_address)
             else '{}'::jsonb end
        || coalesce(cus.vals, '{}'::jsonb) || coalesce(docs.flags, '{}'::jsonb) as full_row) v
    where e.id = any (p_ids)
      and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  ) q;

  if v_sensitive and v_out <> '{}'::jsonb then
    perform private.write_audit('export', 'hr', 'employees', 'bulk', null,
      jsonb_build_object('fields', to_jsonb(v_fields), 'rows', (select count(*) from jsonb_object_keys(v_out)), 'sheet', true),
      'Company sheet including private details');
  end if;
  return v_out;
end $$;

revoke all on function public.hr_sheet_people(uuid[], text[]) from public, anon;
grant execute on function public.hr_sheet_people(uuid[], text[]) to authenticated;
revoke all on function private.sheet_src_ok(text) from public, anon;
revoke all on function private.company_sheet_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  The transfer sheet asks for the new salary, so the transfer form may carry it
--  (three optional number boxes; left empty = same as before).
-- ---------------------------------------------------------------------
update public.hr_request_formats f
   set fields = f.fields || (
     select coalesce(jsonb_agg(n.fld order by n.ord), '[]'::jsonb)
       from (values
         (1, '{"key":"new_basic","label":"নতুন বেসিক (বদলালে)","type":"number"}'::jsonb),
         (2, '{"key":"new_bill","label":"নতুন ফুয়েল / ফোন বিল (বদলালে)","type":"number"}'::jsonb),
         (3, '{"key":"new_commission","label":"নতুন কমিশন (বদলালে)","type":"number"}'::jsonb)) n(ord, fld)
      where not exists (select 1 from jsonb_array_elements(f.fields) x where x ->> 'key' = n.fld ->> 'key'))
 where f.code = 'ID_TRANSFER';

-- ---------------------------------------------------------------------
--  The three sheets the company uses today (all editable on the page)
-- ---------------------------------------------------------------------
insert into public.company_sheets (name, name_bn, source, kind, title, title_at, file_name, sort_order, columns)
select v.name, v.name_bn, v.source, v.kind, v.title, v.title_at, v.file_name, v.sort_order, v.columns
from (values
('New Admin & Rider ID Creat Information', 'নতুন আইডি তৈরির শিট', 'staff', null::text, 'New Admin & Rider ID Creat Format', null::jsonb,
 'New-Admin-Rider-ID-Creat-Information.xlsx', 10, '[
  {"head":"SL","src":"sl","w":7.4},
  {"head":"Name","src":"emp:full_name","w":17.6},
  {"head":"Phone Number","src":"emp:mobile","w":26.7},
  {"head":"Alternative Phone Number","src":"emp:cf:alt_mobile|emp:emergency_contact_phone","w":29.9},
  {"head":"Hub Name","src":"emp:hub_name"},
  {"head":"Designation","src":"emp:position_name"},
  {"head":"Gmail Only for Admin","src":"emp:email","w":24.4},
  {"head":"Blood Group","src":"emp:cf:blood_group"},
  {"head":"Date Of Birth","src":"emp:date_of_birth"},
  {"head":"Permament Address","src":"emp:permanent_address|emp:present_address","w":20.7},
  {"head":"Raferance Name & ID","src":"ref","w":21.4},
  {"head":"NID/ Birth Certificate Number","src":"emp:nid_number","w":25.6},
  {"head":"Employee Picture","src":"doc:photo","w":21.3},
  {"head":"NID Front Picture","src":"doc:nid_front","w":19.7},
  {"head":"NID Back Picture","src":"doc:nid_back","w":23.7},
  {"head":"Basic","src":"emp:basic_salary"},
  {"head":"Phn bill","src":"blank"},
  {"head":"Conveyance","src":"emp:transport_allowance"},
  {"head":"Commission","src":"emp:commission"},
  {"head":"Pick & Drop","src":"blank"},
  {"head":"Return","src":"blank"},
  {"head":"Weight Bonus","src":"blank","w":18.7},
  {"head":"Entry Com.","src":"blank"},
  {"head":"Reason","src":"blank"},
  {"head":"Remarks","src":"blank"}]'::jsonb),
('Admin & Rider ID Transfer Information', 'আইডি বদলির শিট', 'requests', 'id_transfer', 'Admin & Rider ID Transfer Format', null,
 'New-Admin-Rider-ID-Transfer-Information.xlsx', 20, '[
  {"head":"SL","src":"sl","w":10.1},
  {"head":"Name","src":"emp:full_name|req:full_name","w":24},
  {"head":"Phone Number","src":"emp:mobile","w":16},
  {"head":"ID","src":"emp:employee_code|req:employee_code"},
  {"head":"Designation","src":"emp:position_name|req:position","w":18},
  {"head":"Old Hub Name","src":"req.hub|req:from_hub","w":22},
  {"head":"New Hub Name","src":"req:to_hub","w":22},
  {"head":"Date Of Birth","src":"emp:date_of_birth","w":14},
  {"head":"NID/ Birth Certificate Number","src":"emp:nid_number","w":38.7},
  {"head":"Transfer Raferance Name & ID","src":"ref","w":41.1},
  {"head":"Transfer Reason/ Remarks","src":"req:reason|req.note","w":37.4}]'::jsonb),
('Transfer - 02 (with salary)', 'আইডি বদলির শিট — বেতনসহ', 'requests', 'id_transfer', 'Admin & Rider ID Create Information', '[4,7]'::jsonb,
 'Transfer - 02.xlsx', 30, '[
  {"head":"SL","src":"sl","w":8.2},
  {"head":"Name","src":"emp:full_name|req:full_name","w":27.6},
  {"head":"Phone Number","src":"emp:mobile","w":23.5},
  {"head":"ID","src":"emp:employee_code|req:employee_code","w":19.4},
  {"head":"Designation","src":"emp:position_name|req:position","w":27.4},
  {"head":"Old Hub","src":"req.hub|req:from_hub","w":22},
  {"head":"New Hub Name","src":"req:to_hub","w":26},
  {"head":"Date Of Birth","src":"emp:date_of_birth","w":37},
  {"head":"NID/ Birth Certificate Number","src":"emp:nid_number","w":42.6},
  {"head":"Transfer Raferance Name & ID","src":"ref","w":49.4},
  {"head":"Basic","group":"Previous Salary System","src":"emp:basic_salary","w":18.9},
  {"head":"Fuyel/Phn Bill","group":"Previous Salary System","src":"emp:transport_allowance","w":27.1},
  {"head":"Commision","group":"Previous Salary System","src":"emp:commission","w":21},
  {"head":"Basic","group":"New Salary System","src":"req:new_basic|emp:basic_salary"},
  {"head":"Fuyel/Phn Bill","group":"New Salary System","src":"req:new_bill|emp:transport_allowance"},
  {"head":"Commision","group":"New Salary System","src":"req:new_commission|emp:commission"},
  {"head":"Transfer Reason/ Remarks","src":"req:reason|req.note","w":44.5}]'::jsonb)
) v(name, name_bn, source, kind, title, title_at, file_name, sort_order, columns)
where not exists (select 1 from public.company_sheets);
