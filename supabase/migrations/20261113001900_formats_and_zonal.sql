-- =====================================================================
-- XZM-TEAM ERP — Migration 0019: export/import formats + zonal staff dashboard
--
--  * employee_formats: a named, ordered list of columns ("format") the company can set up
--    for exporting and importing staff. Head Office makes company formats, a Zonal Manager
--    makes formats for their own zone. Column headings are the company's own words.
--  * hr_export_rows: rows for an export, built from the chosen columns. Every employee is
--    filtered by hr.employee.view for their zone/hub; NID and other private details only
--    for those allowed to see them (and that export is written to the audit log); salary
--    only with hr.compensation.view.
--  * hr_hub_staff_summary: hub-by-hub staff counts for the zonal dashboard.
--  * Imported staff with no ID wait as applicants; a Super Admin may now approve their
--    own submission, so a one-person office can still give them IDs.
--  * hr_next_employee_codes: the next free numeric IDs, for giving IDs to a whole hub.
-- =====================================================================

create table public.employee_formats (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid references public.zones(id),
  name        text not null check (length(trim(name)) > 0),
  name_bn     text,
  purpose     text not null default 'both' check (purpose in ('export','import','both')),
  columns     jsonb not null default '[]'::jsonb,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  constraint employee_formats_columns_chk check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) between 1 and 60)
);
create index employee_formats_zone_idx on public.employee_formats (zone_id);
create unique index employee_formats_name_uq
  on public.employee_formats (coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;

create trigger employee_formats_stamp before insert or update on public.employee_formats
  for each row execute function private.stamp_row();
create trigger employee_formats_audit after insert or update or delete on public.employee_formats
  for each row execute function private.audit_row('hr');
create trigger employee_formats_no_delete before delete on public.employee_formats
  for each row execute function private.prevent_delete();

-- The fields a format column may point at.
create or replace function private.export_field_ok(p_field text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_field = any (array[
    'employee_code','full_name','full_name_bn','mobile','email','hub_name','hub_code','zone_name',
    'department_name','position_name','status','joining_date','status_since',
    'basic_salary','transport_allowance','commission','referrer_code','referrer_name',
    'emergency_contact_name','emergency_contact_phone',
    'nid_number','date_of_birth','father_name','mother_name','present_address','permanent_address'])
  or (p_field like 'cf:%' and exists (
        select 1 from public.employee_custom_fields c
         where c.code = substr(p_field, 4)::extensions.citext and c.archived_at is null))
$$;

create or replace function private.format_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare col jsonb; bad text;
begin
  for col in select * from jsonb_array_elements(new.columns) loop
    if jsonb_typeof(col) <> 'object' or coalesce(col ->> 'field', '') = '' then
      raise exception 'Each column needs a field.' using errcode = '22023';
    end if;
    if not private.export_field_ok(col ->> 'field') then
      raise exception 'Unknown column: %.', col ->> 'field' using errcode = '22023';
    end if;
    if coalesce(trim(col ->> 'label'), '') = '' and coalesce(trim(col ->> 'label_bn'), '') = '' then
      raise exception 'Each column needs a heading.' using errcode = '22023';
    end if;
  end loop;
  select q.f into bad from (select e.value ->> 'field' f, count(*) c
                              from jsonb_array_elements(new.columns) e group by 1 having count(*) > 1) q limit 1;
  if bad is not null then
    raise exception 'Column % is listed twice.', bad using errcode = '22023';
  end if;
  -- only one default per zone (and one company-wide default)
  if new.is_default and new.archived_at is null then
    update public.employee_formats
       set is_default = false
     where id <> new.id and is_default
       and zone_id is not distinct from new.zone_id
       and purpose = new.purpose;
  end if;
  return new;
end $$;
create trigger employee_formats_guard before insert or update on public.employee_formats
  for each row execute function private.format_guard();

alter table public.employee_formats enable row level security;
revoke all on public.employee_formats from anon;
grant select, insert, update on public.employee_formats to authenticated;

create policy formats_read on public.employee_formats for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy formats_insert on public.employee_formats for insert to authenticated
  with check (private.has_permission('hr.profile_field.configure', zone_id));
create policy formats_update on public.employee_formats for update to authenticated
  using (private.has_permission('hr.profile_field.configure', zone_id))
  with check (private.has_permission('hr.profile_field.configure', zone_id));

insert into public.employee_formats (name, name_bn, purpose, is_default, columns) values
  ('Standard staff list', 'সাধারণ কর্মী তালিকা', 'both', true, '[
     {"field":"employee_code","label":"Employee ID","label_bn":"আইডি"},
     {"field":"full_name","label":"Name","label_bn":"নাম"},
     {"field":"position_name","label":"Position","label_bn":"পদবি"},
     {"field":"hub_name","label":"Hub","label_bn":"হাব"},
     {"field":"mobile","label":"Mobile","label_bn":"মোবাইল"},
     {"field":"status","label":"Status","label_bn":"অবস্থা"},
     {"field":"joining_date","label":"Joining date","label_bn":"যোগদান"}]'::jsonb),
  ('Salary sheet columns', 'বেতনের কলাম', 'both', false, '[
     {"field":"employee_code","label":"Employee ID","label_bn":"আইডি"},
     {"field":"full_name","label":"Name","label_bn":"নাম"},
     {"field":"hub_name","label":"Hub","label_bn":"হাব"},
     {"field":"position_name","label":"Position","label_bn":"পদবি"},
     {"field":"basic_salary","label":"Basic","label_bn":"মূল বেতন"},
     {"field":"transport_allowance","label":"Transport","label_bn":"যাতায়াত"},
     {"field":"commission","label":"Commission","label_bn":"কমিশন"}]'::jsonb)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Rows for an export, honouring every permission.
-- ---------------------------------------------------------------------
create or replace function public.hr_export_rows(
  p_fields text[], p_zone uuid default null, p_hub uuid default null,
  p_status text default null, p_q text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f text;
  v_rows jsonb;
  v_sensitive boolean := p_fields && array['nid_number','date_of_birth','father_name','mother_name','present_address','permanent_address'];
begin
  if auth.uid() is null or not exists (select 1 from private.my_grants()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_fields, 1), 0) = 0 then
    raise exception 'Choose at least one column.' using errcode = '22023';
  end if;
  if array_length(p_fields, 1) > 60 then
    raise exception 'Too many columns (60 at most).' using errcode = '22023';
  end if;
  foreach f in array p_fields loop
    if not private.export_field_ok(f) then
      raise exception 'Unknown column: %.', f using errcode = '22023';
    end if;
  end loop;

  select coalesce(jsonb_agg(q.obj order by q.ord nulls last, q.nm), '[]'::jsonb) into v_rows
  from (
    select e.employee_code::text as ord, e.full_name as nm,
           (select jsonb_object_agg(k, v.full_row -> k) from unnest(p_fields) k)
             || jsonb_build_object('_id', e.id::text) as obj
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
        || coalesce(cus.vals, '{}'::jsonb) as full_row) v
    where private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
      and (p_zone is null or e.zone_id = p_zone)
      and (p_hub is null or e.hub_id = p_hub)
      and (case when p_status = 'archived' then e.archived_at is not null
                when p_status is null or p_status = '' then e.archived_at is null
                else e.archived_at is null and e.status = p_status end)
      and (coalesce(trim(p_q), '') = '' or e.full_name ilike '%' || trim(p_q) || '%'
           or e.employee_code::text ilike '%' || trim(p_q) || '%' or e.mobile like '%' || trim(p_q) || '%')
    limit 5000
  ) q;

  if v_sensitive then
    perform private.write_audit('export', 'hr', 'employees', 'bulk', null,
      jsonb_build_object('fields', to_jsonb(p_fields), 'zone', p_zone, 'hub', p_hub, 'status', p_status,
                         'rows', jsonb_array_length(v_rows)),
      'Staff export including private details');
  end if;
  return v_rows;
end $$;

-- ---------------------------------------------------------------------
-- Hub-by-hub staff numbers (zonal dashboard)
-- ---------------------------------------------------------------------
create or replace function public.hr_hub_staff_summary(p_zone uuid default null)
returns table (hub_id uuid, hub_name text, zone_id uuid, zone_name text,
               total integer, active integer, inactive integer, applicant integer,
               without_id integer, with_login integer, by_position jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from private.my_grants()) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
  select h.id, h.name, z.id, z.name,
         coalesce(c.total, 0), coalesce(c.active, 0), coalesce(c.inactive, 0), coalesce(c.applicant, 0),
         coalesce(c.without_id, 0), coalesce(c.with_login, 0), coalesce(q.map, '{}'::jsonb)
  from public.hubs h
  join public.zones z on z.id = h.zone_id
  left join lateral (
    select count(*)::int total,
           count(*) filter (where e.status = 'active')::int active,
           count(*) filter (where e.status = 'inactive')::int inactive,
           count(*) filter (where e.status = 'applicant')::int applicant,
           count(*) filter (where e.employee_code is null and e.status <> 'applicant')::int without_id,
           count(*) filter (where e.profile_id is not null)::int with_login
      from public.employees e
     where e.hub_id = h.id and e.archived_at is null) c on true
  left join lateral (
    select jsonb_object_agg(x.pos, x.c) map from (
      select p.name pos, count(*) c
        from public.employees e2 join public.positions p on p.id = e2.position_id
       where e2.hub_id = h.id and e2.archived_at is null and e2.status = 'active'
       group by p.name) x) q on true
  where h.archived_at is null
    and (p_zone is null or h.zone_id = p_zone)
    and private.has_permission('hr.employee.view', h.zone_id, h.id)
  order by z.name, h.name;
end $$;

-- ---------------------------------------------------------------------
-- Giving an Employee ID to imported staff
--
-- Imported staff with no ID in the file wait as applicants. Normally a second person
-- approves the application, but a company whose only administrator did the import could
-- never give them an ID. A Super Admin may therefore approve an application they
-- submitted themselves; for everyone else the two-person rule stands, and a company can
-- switch the exemption off with hr.application_two_person.
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('hr.application_two_person', 'true', 'A second person must approve an ID application (a Super Admin may approve their own)')
on conflict (key) do nothing;

create or replace function public.hr_approve_application(p_employee uuid, p_employee_code text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  a public.employee_applications%rowtype;
  v_code text := upper(trim(p_employee_code));
begin
  select * into e from public.employees where id = p_employee for update;
  select * into a from public.employee_applications where employee_id = p_employee for update;
  if not private.employee_has_permission('hr.application.approve', p_employee) then
    raise exception 'Not authorised to approve applications.' using errcode = '42501';
  end if;
  if a.status is distinct from 'submitted' then
    raise exception 'Only submitted applications can be approved (current: %).', coalesce(a.status, 'none') using errcode = 'P0001';
  end if;
  if a.submitted_by = auth.uid() and not private.is_super_admin() then
    raise exception 'The person who submitted an application cannot approve it.' using errcode = '42501';
  end if;
  if v_code is null or v_code !~ private.setting_text('hr.employee_code_pattern') then
    raise exception 'Employee ID "%" does not match the company format.', p_employee_code using errcode = '23514';
  end if;
  if exists (select 1 from public.employees where employee_code = v_code::extensions.citext) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  update public.employees
     set employee_code = v_code, status = 'active', status_since = coalesce(joining_date, current_date)
   where id = p_employee;
  update public.employee_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where employee_id = p_employee;
  insert into public.employee_assignments
    (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
  values (p_employee, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id,
          coalesce(e.joining_date, current_date), 'Application approved');
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, 'applicant', 'active', coalesce(e.joining_date, current_date), coalesce(p_note, 'Application approved'));
  update public.employee_compensation
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where employee_id = p_employee and status = 'pending';
end $$;

-- Next free numeric Employee IDs, so a whole hub can be given IDs in one go.
create or replace function public.hr_next_employee_codes(p_count integer)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare out_codes text[] := '{}'; v int; i int := 0;
begin
  if coalesce(p_count, 0) < 1 or p_count > 500 then
    raise exception 'Ask for between 1 and 500 IDs.' using errcode = '22023';
  end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.application.approve' or g.is_super) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select coalesce(max(employee_code::text::int), 0) into v
    from public.employees where employee_code::text ~ '^[0-9]+$';
  while i < p_count loop
    v := v + 1;
    if not exists (select 1 from public.employees where employee_code = v::text::extensions.citext) then
      out_codes := array_append(out_codes, v::text); i := i + 1;
    end if;
  end loop;
  return out_codes;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.hr_export_rows(text[], uuid, uuid, text, text)',
                           'public.hr_hub_staff_summary(uuid)',
                           'public.hr_next_employee_codes(integer)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.export_field_ok(text) from public, anon;
grant execute on function private.export_field_ok(text) to authenticated;
