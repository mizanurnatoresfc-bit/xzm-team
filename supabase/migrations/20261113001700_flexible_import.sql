-- =====================================================================
-- XZM-TEAM ERP — Migration 0017: flexible employee import (old staff from Excel)
--
--  * Any spreadsheet column can be mapped to a field; only the fields listed in the
--    company setting hr.import_required_fields are compulsory (default: name + hub).
--    Old staff usually have just ID, name, position, hub, Basic, Transport, Commission.
--  * Hub / position / department by code OR name (English or Bangla).
--  * Columns can go into custom profile fields ("cf:<field code>") and the referrer
--    ("reference_code" = the referrer's Employee ID).
--  * Unknown hubs / positions can be created in one step (hr_import_create_missing).
--  * Two-person rule for imports follows hr.import_two_person; a Super Admin may verify
--    their own batch (a company with one admin must be able to work).
-- =====================================================================

-- Who referred this employee (Employee ID entered as "reference").
alter table public.employees add column if not exists referred_by_employee_id uuid references public.employees(id);
create index if not exists employees_referred_by_idx on public.employees (referred_by_employee_id);
alter table public.employees drop constraint if exists employees_not_self_referrer;
alter table public.employees add constraint employees_not_self_referrer check (referred_by_employee_id is null or referred_by_employee_id <> id);

insert into public.system_settings (key, value, description) values
  ('hr.import_required_fields', '["full_name","hub"]', 'Columns every import row must have (hub = hub code or hub name)'),
  ('hr.import_two_person', 'true', 'A second person must verify an import before it is saved (Super Admin may verify own)')
on conflict (key) do nothing;

-- Finds a hub / position / department by code or by name (English or Bangla), case-insensitive.
create or replace function private.find_hub(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select h.id from public.hubs h
   where h.archived_at is null
     and ((p_code is not null and h.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (lower(trim(h.name)) = lower(trim(p_name)) or trim(h.name_bn) = trim(p_name))))
   order by h.created_at limit 1
$$;
create or replace function private.find_position(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.positions x
   where x.archived_at is null
     and ((p_code is not null and x.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (lower(trim(x.name)) = lower(trim(p_name)) or trim(x.name_bn) = trim(p_name))))
   order by x.created_at limit 1
$$;
create or replace function private.find_department(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.departments x
   where x.archived_at is null
     and ((p_code is not null and x.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (lower(trim(x.name)) = lower(trim(p_name)) or trim(x.name_bn) = trim(p_name))))
   order by x.created_at limit 1
$$;

-- Converts a spreadsheet cell to the JSON value a custom field expects; null if it does not fit.
create or replace function private.import_custom_value(p_field uuid, p_text text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f public.employee_custom_fields%rowtype; t text := trim(p_text); d date; o jsonb;
begin
  select * into f from public.employee_custom_fields where id = p_field;
  if t is null or t = '' then return null; end if;
  case f.field_type
    when 'text', 'textarea' then return to_jsonb(t);
    when 'number' then
      if replace(t, ',', '') ~ '^-?\d+(\.\d+)?$' then return to_jsonb(replace(t, ',', '')::numeric); end if;
    when 'date' then
      d := private.parse_date_bd(t);
      if d is not null then return to_jsonb(d::text); end if;
    when 'checkbox' then
      if lower(t) in ('yes','y','true','1','হ্যাঁ','হা') then return 'true'::jsonb; end if;
      if lower(t) in ('no','n','false','0','না') then return 'false'::jsonb; end if;
    when 'dropdown' then
      select x into o from jsonb_array_elements(f.options) x
       where lower(x ->> 'value') = lower(t) or lower(x ->> 'label') = lower(t) or x ->> 'label_bn' = t limit 1;
      if o is not null then return to_jsonb(o ->> 'value'); end if;
    else null;
  end case;
  return null;
end $$;

create or replace function public.hr_validate_import(p_batch uuid, p_mapping jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record;
  m jsonb;
  errs text[];
  v_hub uuid; v_zone uuid; v_pos uuid; v_dept uuid; v_dob date; v_join date;
  v_min int := coalesce(private.setting_text('hr.min_age_years')::int, 18);
  allowed text[] := array['employee_code','full_name','full_name_bn','mobile','email','date_of_birth','nid_number',
                          'hub_code','hub_name','department_code','department_name','position_code','position_name',
                          'joining_date','basic_salary','transport_allowance','commission',
                          'emergency_contact_name','emergency_contact_phone','father_name','mother_name',
                          'present_address','permanent_address','reference_code'];
  required text[];
  f text; t text; cf record; cv jsonb;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.id is null then raise exception 'Import batch not found.' using errcode = 'P0001'; end if;
  if b.created_by <> auth.uid() and not private.has_permission('hr.import.approve') then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','validated') then raise exception 'Batch is already %.', b.status using errcode = 'P0001'; end if;
  for t in select x.value from jsonb_each_text(p_mapping) x loop
    if t <> all(allowed) and not (t like 'cf:%' and exists (
         select 1 from public.employee_custom_fields c where c.code = substr(t, 4)::extensions.citext and c.archived_at is null
           and c.field_type in ('text','textarea','number','date','checkbox','dropdown'))) then
      raise exception 'Mapping contains an unknown target field: %.', t using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_each_text(p_mapping)) <> (select count(distinct x.value) from jsonb_each_text(p_mapping) x) then
    raise exception 'Two columns are mapped to the same field.' using errcode = '22023';
  end if;
  select coalesce(array_agg(x), array['full_name','hub']) into required
    from jsonb_array_elements_text(coalesce((select value from public.system_settings where key = 'hr.import_required_fields'), '["full_name","hub"]'::jsonb)) x;
  foreach f in array required loop
    if f = 'hub' then
      if not exists (select 1 from jsonb_each_text(p_mapping) x where x.value in ('hub_code','hub_name')) then
        raise exception 'Required column "hub" is not mapped.' using errcode = '22023';
      end if;
    elsif not exists (select 1 from jsonb_each_text(p_mapping) x where x.value = f) then
      raise exception 'Required column "%" is not mapped.', f using errcode = '22023';
    end if;
  end loop;

  for r in select * from public.employee_import_rows where batch_id = p_batch order by row_number loop
    select coalesce(jsonb_object_agg(mp.value, nullif(trim(r.raw ->> mp.key), '')), '{}'::jsonb) into m
    from jsonb_each_text(p_mapping) mp;
    m := jsonb_strip_nulls(m);
    errs := '{}';
    foreach f in array required loop
      if f = 'hub' then
        if m ->> 'hub_code' is null and m ->> 'hub_name' is null then errs := array_append(errs, 'Missing hub'::text); end if;
      elsif m ->> f is null then errs := array_append(errs, 'Missing ' || f); end if;
    end loop;
    if m ->> 'mobile' is not null then
      m := jsonb_set(m, '{mobile}', to_jsonb(regexp_replace(regexp_replace(m ->> 'mobile', '[^0-9]', '', 'g'), '^(88)?', '')));
      if m ->> 'mobile' !~ private.setting_text('hr.mobile_pattern') then errs := array_append(errs, 'Invalid mobile'::text); end if;
    end if;
    if m ->> 'emergency_contact_phone' is not null and m ->> 'emergency_contact_phone' !~ private.setting_text('hr.mobile_pattern') then
      errs := array_append(errs, 'Invalid emergency_contact_phone'::text); end if;
    if m ->> 'nid_number' is not null and m ->> 'nid_number' !~ private.setting_text('hr.nid_pattern') then
      errs := array_append(errs, 'Invalid NID'::text); end if;
    v_dob := private.parse_date_bd(m ->> 'date_of_birth');
    v_join := private.parse_date_bd(m ->> 'joining_date');
    if m ->> 'date_of_birth' is not null and v_dob is null then errs := array_append(errs, 'Invalid date_of_birth'::text); end if;
    if m ->> 'joining_date' is not null and v_join is null then errs := array_append(errs, 'Invalid joining_date'::text); end if;
    if v_dob is not null and v_dob > coalesce(v_join, current_date) - make_interval(years => v_min) then
      errs := array_append(errs, 'Younger than ' || v_min); end if;
    if v_join is not null and v_join > current_date + 60 then errs := array_append(errs, 'Joining date too far in future'::text); end if;
    foreach f in array array['basic_salary','transport_allowance','commission'] loop
      if m ->> f is not null then
        m := jsonb_set(m, array[f], to_jsonb(replace(replace(m ->> f, ',', ''), '৳', '')));
        if (m ->> f) !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid ' || f); end if;
      end if;
    end loop;
    if m ->> 'basic_salary' is null and (m ->> 'transport_allowance' is not null or m ->> 'commission' is not null) then
      errs := array_append(errs, 'Missing basic_salary (needed when allowances are given)'::text); end if;

    v_hub := private.find_hub(m ->> 'hub_code', m ->> 'hub_name'); v_zone := null;
    if v_hub is not null then select zone_id into v_zone from public.hubs where id = v_hub; end if;
    if (m ->> 'hub_code' is not null or m ->> 'hub_name' is not null) and v_hub is null then
      errs := array_append(errs, 'Unknown hub: ' || coalesce(m ->> 'hub_code', m ->> 'hub_name')); end if;
    if v_hub is not null and not private.has_permission('hr.import.create', v_zone, v_hub) then
      errs := array_append(errs, 'Hub outside your scope'::text); end if;
    v_pos := private.find_position(m ->> 'position_code', m ->> 'position_name');
    if (m ->> 'position_code' is not null or m ->> 'position_name' is not null) and v_pos is null then
      errs := array_append(errs, 'Unknown position: ' || coalesce(m ->> 'position_code', m ->> 'position_name')); end if;
    v_dept := private.find_department(m ->> 'department_code', m ->> 'department_name');
    if (m ->> 'department_code' is not null or m ->> 'department_name' is not null) and v_dept is null then
      errs := array_append(errs, 'Unknown department: ' || coalesce(m ->> 'department_code', m ->> 'department_name')); end if;
    m := m || jsonb_strip_nulls(jsonb_build_object('_hub', v_hub, '_position', v_pos,
               '_department', coalesce(v_dept, (select p.department_id from public.positions p where p.id = v_pos))));

    if m ->> 'employee_code' is not null then
      m := jsonb_set(m, '{employee_code}', to_jsonb(upper(m ->> 'employee_code')));
      if (m ->> 'employee_code') !~ private.setting_text('hr.employee_code_pattern') then errs := array_append(errs, 'Invalid employee_code format'::text); end if;
      if exists (select 1 from public.employees where employee_code = (m ->> 'employee_code')::extensions.citext) then errs := array_append(errs, 'employee_code already exists'::text); end if;
    end if;
    if m ->> 'reference_code' is not null then
      if not exists (select 1 from public.employees e where e.employee_code = upper(m ->> 'reference_code')::extensions.citext)
         and not exists (select 1 from public.employee_import_rows o where o.batch_id = p_batch and o.row_number <> r.row_number
                           and upper(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'employee_code' limit 1)) = upper(m ->> 'reference_code')) then
        errs := array_append(errs, 'Unknown reference ID: ' || (m ->> 'reference_code'));
      elsif upper(m ->> 'reference_code') = m ->> 'employee_code' then
        errs := array_append(errs, 'Employee cannot refer themselves'::text);
      end if;
    end if;
    if m ->> 'nid_number' is not null and exists (select 1 from public.employee_sensitive where nid_number = m ->> 'nid_number') then errs := array_append(errs, 'NID already exists'::text); end if;
    if m ->> 'mobile' is not null and exists (select 1 from public.employees where mobile = m ->> 'mobile' and status <> 'rejected' and archived_at is null) then errs := array_append(errs, 'Mobile already exists'::text); end if;

    -- custom profile fields
    for cf in select x.key as col, substr(x.value, 4) as code from jsonb_each_text(p_mapping) x where x.value like 'cf:%' loop
      t := m ->> ('cf:' || cf.code);
      if t is not null then
        cv := private.import_custom_value((select c.id from public.employee_custom_fields c where c.code = cf.code::extensions.citext), t);
        if cv is null then errs := array_append(errs, 'Invalid value for ' || cf.col);
        else m := jsonb_set(m, array['cf:' || cf.code], cv); end if;
      end if;
    end loop;

    -- duplicates inside the same file
    if exists (select 1 from public.employee_import_rows o where o.batch_id = p_batch and o.row_number <> r.row_number
               and ((m ->> 'nid_number' is not null and o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'nid_number' limit 1) = m ->> 'nid_number')
                 or (m ->> 'mobile' is not null and regexp_replace(regexp_replace(coalesce(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'mobile' limit 1), ''), '[^0-9]', '', 'g'), '^(88)?', '') = m ->> 'mobile')
                 or (m ->> 'employee_code' is not null and upper(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'employee_code' limit 1)) = m ->> 'employee_code'))) then
      errs := array_append(errs, 'Duplicate of another row in this file'::text);
    end if;
    update public.employee_import_rows
       set data = m, errors = errs, status = case when cardinality(errs) = 0 then 'valid' else 'error' end
     where id = r.id;
  end loop;

  update public.employee_import_batches b2
     set status = 'validated', column_mapping = p_mapping, validated_at = now(),
         total_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch),
         valid_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch and status = 'valid'),
         error_rows = (select count(*) from public.employee_import_rows where batch_id = p_batch and status = 'error'),
         verified_by = null, verified_at = null
   where b2.id = p_batch;
  return (select jsonb_build_object('total', total_rows, 'valid', valid_rows, 'errors', error_rows)
          from public.employee_import_batches where id = p_batch);
end $$;

-- Hubs / positions the validated rows name but that do not exist yet.
create or replace function public.hr_import_missing(p_batch uuid)
returns table (kind text, name text, row_count integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.employee_import_batches b where b.id = p_batch
                   and (b.created_by = auth.uid() or private.has_permission('hr.import.approve'))) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select x.k, x.n, count(*)::int from (
    select 'hub'::text k, coalesce(r.data ->> 'hub_code', r.data ->> 'hub_name') n
      from public.employee_import_rows r
     where r.batch_id = p_batch and (r.data ? 'hub_code' or r.data ? 'hub_name') and not (r.data ? '_hub')
    union all
    select 'position', coalesce(r.data ->> 'position_code', r.data ->> 'position_name')
      from public.employee_import_rows r
     where r.batch_id = p_batch and (r.data ? 'position_code' or r.data ? 'position_name') and not (r.data ? '_position')
    union all
    select 'department', coalesce(r.data ->> 'department_code', r.data ->> 'department_name')
      from public.employee_import_rows r
     where r.batch_id = p_batch and (r.data ? 'department_code' or r.data ? 'department_name') and not (r.data ? '_department')
  ) x
  group by x.k, x.n order by x.k, x.n;
end $$;

-- Creates the missing hubs (in p_zone), departments and positions (in p_department), then
-- the caller validates again. Uses the normal org permissions.
create or replace function public.hr_import_create_missing(p_batch uuid, p_zone uuid, p_department uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype; x record; v_code text; n_hub int := 0; n_pos int := 0; n_dept int := 0; v_org uuid;
begin
  select * into b from public.employee_import_batches where id = p_batch;
  if b.id is null or (b.created_by <> auth.uid() and not private.has_permission('hr.import.approve')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','validated') then raise exception 'Batch is already %.', b.status using errcode = 'P0001'; end if;
  select organization_id into v_org from public.zones where id = p_zone;
  if v_org is null then select id into v_org from public.organizations order by created_at limit 1; end if;
  for x in select * from public.hr_import_missing(p_batch) loop
    v_code := upper(left(regexp_replace(x.name, '[^A-Za-z0-9]+', '', 'g'), 12));
    if v_code = '' or exists (select 1 from public.hubs where code = v_code::extensions.citext)
       or exists (select 1 from public.positions where code = v_code::extensions.citext)
       or exists (select 1 from public.departments where code = v_code::extensions.citext) then
      v_code := v_code || upper(substr(md5(random()::text), 1, 4));
    end if;
    if x.kind = 'hub' then
      if p_zone is null then raise exception 'Choose the zone for the new hubs.' using errcode = '22023'; end if;
      if not private.has_permission('org.hub.create', p_zone) then raise exception 'Not authorised to create hubs in this zone.' using errcode = '42501'; end if;
      insert into public.hubs (zone_id, code, name) values (p_zone, v_code, trim(x.name)); n_hub := n_hub + 1;
    elsif x.kind = 'department' then
      if not private.has_permission('org.department.create') then raise exception 'Not authorised to create departments.' using errcode = '42501'; end if;
      insert into public.departments (organization_id, code, name) values (v_org, v_code, trim(x.name)); n_dept := n_dept + 1;
    else
      if not private.has_permission('org.position.create') then raise exception 'Not authorised to create positions.' using errcode = '42501'; end if;
      insert into public.positions (department_id, code, name) values (p_department, v_code, trim(x.name)); n_pos := n_pos + 1;
    end if;
  end loop;
  return jsonb_build_object('hubs', n_hub, 'positions', n_pos, 'departments', n_dept);
end $$;

create or replace function public.hr_verify_import(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.employee_import_batches%rowtype;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.status <> 'validated' then raise exception 'Validate the batch first.' using errcode = 'P0001'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve' or g.is_super) then
    raise exception 'Not authorised to verify imports.' using errcode = '42501';
  end if;
  if b.created_by = auth.uid() and not private.is_super_admin()
     and coalesce((select value from public.system_settings where key = 'hr.import_two_person'), 'true'::jsonb) = 'true'::jsonb then
    raise exception 'The uploader cannot verify their own import.' using errcode = '42501';
  end if;
  update public.employee_import_batches set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_batch;
end $$;

create or replace function public.hr_commit_import(p_batch uuid, p_skip_invalid boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record; d jsonb; v_emp uuid; v_code text; n_active int := 0; n_app int := 0; v_join date; cf record; v_warn text[];
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.status <> 'verified' then raise exception 'Only verified batches can be committed.' using errcode = 'P0001'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.error_rows > 0 and not p_skip_invalid then
    raise exception '% row(s) have errors. Fix the file, or explicitly choose to skip invalid rows (they stay listed in the error report).', b.error_rows
      using errcode = 'P0001';
  end if;
  perform set_config('app.change_reason', 'Imported (batch ' || b.file_name || ')', true);

  for r in select * from public.employee_import_rows where batch_id = p_batch and status = 'valid' order by row_number loop
    d := r.data; v_warn := '{}';
    v_code := d ->> 'employee_code';
    v_join := private.parse_date_bd(d ->> 'joining_date');
    insert into public.employees (employee_code, full_name, full_name_bn, mobile, email, emergency_contact_name, emergency_contact_phone,
                                  hub_id, zone_id, department_id, position_id, joining_date, status, status_since, created_by)
    values (v_code, d ->> 'full_name', d ->> 'full_name_bn', d ->> 'mobile', d ->> 'email', d ->> 'emergency_contact_name', d ->> 'emergency_contact_phone',
            (d ->> '_hub')::uuid, (select zone_id from public.hubs where id = (d ->> '_hub')::uuid),
            (d ->> '_department')::uuid, (d ->> '_position')::uuid,
            v_join, case when v_code is null then 'applicant' else 'active' end, coalesce(v_join, current_date), b.created_by)
    returning id into v_emp;
    if d ?| array['nid_number','date_of_birth','father_name','mother_name','present_address','permanent_address'] then
      insert into public.employee_sensitive (employee_id, nid_number, date_of_birth, father_name, mother_name, present_address, permanent_address)
      values (v_emp, d ->> 'nid_number', private.parse_date_bd(d ->> 'date_of_birth'), d ->> 'father_name', d ->> 'mother_name',
              d ->> 'present_address', d ->> 'permanent_address');
    end if;
    if d ? 'basic_salary' then
      insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, reason,
                                                status, approved_by, approved_at, created_by)
      values (v_emp, coalesce(v_join, current_date), (d ->> 'basic_salary')::numeric, coalesce((d ->> 'transport_allowance')::numeric, 0),
              coalesce((d ->> 'commission')::numeric, 0), 'Imported (batch ' || b.file_name || ')',
              case when v_code is null then 'pending' else 'approved' end,
              case when v_code is null then null else b.verified_by end,
              case when v_code is null then null else now() end, b.created_by);
    end if;
    for cf in select substr(x.key, 4) as code, x.value from jsonb_each(d) x where x.key like 'cf:%' loop
      begin
        insert into public.employee_custom_field_values (employee_id, field_id, value, created_by)
        values (v_emp, (select c.id from public.employee_custom_fields c where c.code = cf.code::extensions.citext), cf.value, b.created_by);
      exception when others then
        v_warn := array_append(v_warn, 'Not saved: ' || cf.code || ' (' || sqlerrm || ')');
      end;
    end loop;
    if v_code is null then
      insert into public.employee_applications (employee_id, status, submitted_by, submitted_at, created_by)
      values (v_emp, 'submitted', b.created_by, now(), b.created_by);
      n_app := n_app + 1;
    else
      insert into public.employee_assignments (employee_id, change_type, department_id, position_id, zone_id, hub_id, effective_from, reason)
      select e.id, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, coalesce(v_join, current_date), 'Imported'
      from public.employees e where e.id = v_emp;
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (v_emp, null, 'active', coalesce(v_join, current_date), 'Imported, verified by HR');
      n_active := n_active + 1;
    end if;
    update public.employee_import_rows set status = 'imported', employee_id = v_emp, errors = v_warn where id = r.id;
  end loop;

  -- referrers last, so a referrer imported in the same file is found
  update public.employees e
     set referred_by_employee_id = ref.id
    from public.employee_import_rows ir
    join public.employees ref on ref.employee_code = upper(ir.data ->> 'reference_code')::extensions.citext
   where ir.batch_id = p_batch and ir.status = 'imported' and ir.employee_id = e.id and ref.id <> e.id;

  update public.employee_import_rows set status = 'skipped' where batch_id = p_batch and status = 'error';
  update public.employee_import_batches set status = 'committed', committed_by = auth.uid(), committed_at = now() where id = p_batch;
  return jsonb_build_object('activated', n_active, 'awaiting_employee_id', n_app, 'skipped', b.error_rows);
end $$;

-- Lets the importer cancel a batch they do not want.
create or replace function public.hr_cancel_import(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.employee_import_batches%rowtype;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.id is null or (b.created_by <> auth.uid() and not private.has_permission('hr.import.approve')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status = 'committed' then raise exception 'A saved import cannot be cancelled.' using errcode = 'P0001'; end if;
  update public.employee_import_batches set status = 'cancelled' where id = p_batch;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.hr_import_missing(uuid)', 'public.hr_import_create_missing(uuid, uuid, uuid)',
                           'public.hr_cancel_import(uuid)', 'public.hr_validate_import(uuid, jsonb)',
                           'public.hr_verify_import(uuid)', 'public.hr_commit_import(uuid, boolean)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.find_hub(text, text), private.find_position(text, text), private.find_department(text, text),
                       private.import_custom_value(uuid, text) from public, anon;
