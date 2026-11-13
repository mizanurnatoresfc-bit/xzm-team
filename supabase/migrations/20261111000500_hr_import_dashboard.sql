-- =====================================================================
-- XZM-TEAM ERP — Migration 0005: bulk employee import, HR dashboard,
-- storage policies for employee documents, default HR role permissions.
-- Import flow: upload rows → map columns → validate → verify (another person)
--              → commit (valid rows only; invalid rows never imported silently).
-- =====================================================================

create table public.employee_import_batches (
  id             uuid primary key default gen_random_uuid(),
  file_name      text not null,
  status         text not null default 'uploaded' check (status in ('uploaded','validated','verified','committed','cancelled')),
  column_mapping jsonb not null default '{}'::jsonb,
  total_rows     integer not null default 0,
  valid_rows     integer not null default 0,
  error_rows     integer not null default 0,
  validated_at   timestamptz,
  verified_by    uuid, verified_at timestamptz,
  committed_by   uuid, committed_at timestamptz,
  created_at     timestamptz not null default now(), created_by uuid,
  updated_at     timestamptz not null default now(), updated_by uuid
);

create table public.employee_import_rows (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.employee_import_batches(id),
  row_number  integer not null check (row_number > 0),
  raw         jsonb not null,               -- the spreadsheet row as uploaded {"Header": "value"}
  data        jsonb,                        -- after column mapping
  errors      text[] not null default '{}',
  status      text not null default 'pending' check (status in ('pending','valid','error','imported','skipped')),
  employee_id uuid references public.employees(id),
  created_at  timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (batch_id, row_number)
);

create or replace function private.import_row_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_api_user() then
    if tg_op <> 'INSERT' then raise exception 'Import rows are processed by the import functions.' using errcode = '42501'; end if;
    if (select status from public.employee_import_batches where id = new.batch_id) <> 'uploaded' then
      raise exception 'Rows can only be added while the batch is uploaded (not yet validated).' using errcode = 'P0001';
    end if;
    if new.status <> 'pending' or new.data is not null or new.employee_id is not null then
      raise exception 'New rows must be pending.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger import_row_guard before insert or update on public.employee_import_rows
  for each row execute function private.import_row_guard();

create or replace function private.import_batch_guard() returns trigger
language plpgsql as $$
begin
  if private.is_api_user() and tg_op = 'UPDATE' then
    raise exception 'Use the import functions.' using errcode = '42501';
  end if;
  if private.is_api_user() and tg_op = 'INSERT' and new.status <> 'uploaded' then
    raise exception 'New batches start as uploaded.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger import_batch_guard before insert or update on public.employee_import_batches
  for each row execute function private.import_batch_guard();

create trigger employee_import_batches_stamp before insert or update on public.employee_import_batches
  for each row execute function private.stamp_row();
create trigger employee_import_batches_audit after insert or update on public.employee_import_batches
  for each row execute function private.audit_row('hr');
create trigger employee_import_batches_no_delete before delete on public.employee_import_batches
  for each row execute function private.prevent_delete();
create trigger employee_import_rows_no_delete before delete on public.employee_import_rows
  for each row execute function private.prevent_delete();

alter table public.employee_import_batches enable row level security;
alter table public.employee_import_rows enable row level security;
revoke all on public.employee_import_batches, public.employee_import_rows from anon;
revoke update, delete, truncate on public.employee_import_batches, public.employee_import_rows from authenticated;

create policy import_batches_read on public.employee_import_batches for select to authenticated
  using (created_by = auth.uid() or private.has_permission('hr.import.approve')
         or exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve'));
create policy import_batches_insert on public.employee_import_batches for insert to authenticated
  with check (exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.create' or g.is_super));
create policy import_rows_read on public.employee_import_rows for select to authenticated
  using (exists (select 1 from public.employee_import_batches b where b.id = batch_id));
create policy import_rows_insert on public.employee_import_rows for insert to authenticated
  with check (exists (select 1 from public.employee_import_batches b where b.id = batch_id and b.created_by = auth.uid()));

-- Parse a date written as YYYY-MM-DD or DD/MM/YYYY; null if invalid.
create or replace function private.parse_date_bd(p text) returns date
language plpgsql immutable as $$
declare d date;
begin
  if p is null or trim(p) = '' then return null; end if;
  p := trim(p);
  if p ~ '^\d{4}-\d{2}-\d{2}$' then d := to_date(p, 'YYYY-MM-DD');
  elsif p ~ '^\d{1,2}/\d{1,2}/\d{4}$' then d := to_date(p, 'DD/MM/YYYY');
  else return null; end if;
  -- to_date silently rolls over invalid days (31/02 -> 03/03); reject that.
  if (p ~ '-' and to_char(d, 'YYYY-MM-DD') <> p)
     or (p ~ '/' and to_char(d, 'FMDD/FMMM/YYYY') <> regexp_replace(regexp_replace(p, '^0', ''), '/0', '/')) then
    return null;
  end if;
  return d;
exception when others then return null;
end $$;

create or replace function public.hr_validate_import(p_batch uuid, p_mapping jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record;
  m jsonb;
  errs text[];
  v_hub uuid; v_zone uuid; v_dob date; v_join date; v_min int := coalesce(private.setting_text('hr.min_age_years')::int, 18);
  allowed text[] := array['employee_code','full_name','mobile','date_of_birth','nid_number','hub_code','department_code',
                          'position_code','joining_date','basic_salary','transport_allowance','commission',
                          'emergency_contact_phone','father_name','mother_name'];
  required text[] := array['full_name','mobile','date_of_birth','nid_number','hub_code','department_code',
                           'position_code','joining_date','basic_salary'];
  f text;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.created_by <> auth.uid() and not private.has_permission('hr.import.approve') then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if b.status not in ('uploaded','validated') then raise exception 'Batch is already %.', b.status using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_each_text(p_mapping) x where x.value <> all(allowed)) then
    raise exception 'Mapping contains an unknown target field.' using errcode = '22023';
  end if;
  foreach f in array required loop
    if not exists (select 1 from jsonb_each_text(p_mapping) x where x.value = f) then
      raise exception 'Required column "%" is not mapped.', f using errcode = '22023';
    end if;
  end loop;

  for r in select * from public.employee_import_rows where batch_id = p_batch order by row_number loop
    select coalesce(jsonb_object_agg(mp.value, nullif(trim(r.raw ->> mp.key), '')), '{}'::jsonb) into m
    from jsonb_each_text(p_mapping) mp;
    errs := '{}';
    foreach f in array required loop
      if m ->> f is null then errs := errs || ('Missing ' || f); end if;
    end loop;
    if m ? 'mobile' and m ->> 'mobile' is not null and m ->> 'mobile' !~ private.setting_text('hr.mobile_pattern') then
      errs := array_append(errs, 'Invalid mobile'::text); end if;
    if m ->> 'nid_number' is not null and m ->> 'nid_number' !~ private.setting_text('hr.nid_pattern') then
      errs := array_append(errs, 'Invalid NID'::text); end if;
    v_dob := private.parse_date_bd(m ->> 'date_of_birth');
    v_join := private.parse_date_bd(m ->> 'joining_date');
    if m ->> 'date_of_birth' is not null and v_dob is null then errs := array_append(errs, 'Invalid date_of_birth'::text); end if;
    if m ->> 'joining_date' is not null and v_join is null then errs := array_append(errs, 'Invalid joining_date'::text); end if;
    if v_dob is not null and v_dob > coalesce(v_join, current_date) - make_interval(years => v_min) then
      errs := errs || ('Younger than ' || v_min); end if;
    if v_join is not null and v_join > current_date + 60 then errs := array_append(errs, 'Joining date too far in future'::text); end if;
    if m ->> 'basic_salary' is not null and (m ->> 'basic_salary') !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid basic_salary'::text); end if;
    if m ->> 'transport_allowance' is not null and (m ->> 'transport_allowance') !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid transport_allowance'::text); end if;
    if m ->> 'commission' is not null and (m ->> 'commission') !~ '^\d+(\.\d{1,2})?$' then errs := array_append(errs, 'Invalid commission'::text); end if;
    v_hub := null; v_zone := null;
    select id, zone_id into v_hub, v_zone from public.hubs where code = (m ->> 'hub_code')::extensions.citext and archived_at is null;
    if m ->> 'hub_code' is not null and v_hub is null then errs := array_append(errs, 'Unknown hub_code'::text); end if;
    if v_hub is not null and not private.has_permission('hr.import.create', v_zone, v_hub) then errs := array_append(errs, 'Hub outside your scope'::text); end if;
    if m ->> 'department_code' is not null and not exists (select 1 from public.departments where code = (m ->> 'department_code')::extensions.citext) then
      errs := array_append(errs, 'Unknown department_code'::text); end if;
    if m ->> 'position_code' is not null and not exists (select 1 from public.positions where code = (m ->> 'position_code')::extensions.citext) then
      errs := array_append(errs, 'Unknown position_code'::text); end if;
    if m ->> 'employee_code' is not null then
      if upper(m ->> 'employee_code') !~ private.setting_text('hr.employee_code_pattern') then errs := array_append(errs, 'Invalid employee_code format'::text); end if;
      if exists (select 1 from public.employees where employee_code = (m ->> 'employee_code')::extensions.citext) then errs := array_append(errs, 'employee_code already exists'::text); end if;
    end if;
    if exists (select 1 from public.employee_sensitive where nid_number = m ->> 'nid_number') then errs := array_append(errs, 'NID already exists'::text); end if;
    if exists (select 1 from public.employees where mobile = m ->> 'mobile' and status <> 'rejected' and archived_at is null) then errs := array_append(errs, 'Mobile already exists'::text); end if;
    -- duplicates inside the same file
    if exists (select 1 from public.employee_import_rows o where o.batch_id = p_batch and o.row_number <> r.row_number
               and ((o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'nid_number' limit 1)) = m ->> 'nid_number'
                 or (o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'mobile' limit 1)) = m ->> 'mobile'
                 or (m ->> 'employee_code' is not null and upper(o.raw ->> (select key from jsonb_each_text(p_mapping) where value = 'employee_code' limit 1)) = upper(m ->> 'employee_code')))) then
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

create or replace function public.hr_verify_import(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.employee_import_batches%rowtype;
begin
  select * into b from public.employee_import_batches where id = p_batch for update;
  if b.status <> 'validated' then raise exception 'Validate the batch first.' using errcode = 'P0001'; end if;
  if not exists (select 1 from private.my_grants() g where g.permission_code = 'hr.import.approve' or g.is_super) then
    raise exception 'Not authorised to verify imports.' using errcode = '42501';
  end if;
  if b.created_by = auth.uid() then raise exception 'The uploader cannot verify their own import.' using errcode = '42501'; end if;
  update public.employee_import_batches set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_batch;
end $$;

create or replace function public.hr_commit_import(p_batch uuid, p_skip_invalid boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.employee_import_batches%rowtype;
  r record; d jsonb; v_emp uuid; v_hub uuid; v_code text; n_active int := 0; n_app int := 0; v_join date;
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

  for r in select * from public.employee_import_rows where batch_id = p_batch and status = 'valid' order by row_number loop
    d := r.data;
    v_code := upper(d ->> 'employee_code');
    v_join := private.parse_date_bd(d ->> 'joining_date');
    select id into v_hub from public.hubs where code = (d ->> 'hub_code')::extensions.citext;
    insert into public.employees (employee_code, full_name, mobile, emergency_contact_phone, hub_id, department_id, position_id,
                                  joining_date, status, status_since, created_by)
    values (v_code, d ->> 'full_name', d ->> 'mobile', d ->> 'emergency_contact_phone', v_hub,
            (select id from public.departments where code = (d ->> 'department_code')::extensions.citext),
            (select id from public.positions where code = (d ->> 'position_code')::extensions.citext),
            v_join, case when v_code is null then 'applicant' else 'active' end, coalesce(v_join, current_date), b.created_by)
    returning id into v_emp;
    insert into public.employee_sensitive (employee_id, nid_number, date_of_birth, father_name, mother_name)
    values (v_emp, d ->> 'nid_number', private.parse_date_bd(d ->> 'date_of_birth'), d ->> 'father_name', d ->> 'mother_name');
    insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, reason,
                                              status, approved_by, approved_at, created_by)
    values (v_emp, coalesce(v_join, current_date), (d ->> 'basic_salary')::numeric, coalesce((d ->> 'transport_allowance')::numeric, 0),
            coalesce((d ->> 'commission')::numeric, 0), 'Imported (batch ' || b.file_name || ')',
            case when v_code is null then 'pending' else 'approved' end,
            case when v_code is null then null else b.verified_by end,
            case when v_code is null then null else now() end, b.created_by);
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
    update public.employee_import_rows set status = 'imported', employee_id = v_emp where id = r.id;
  end loop;
  update public.employee_import_rows set status = 'skipped' where batch_id = p_batch and status = 'error';
  update public.employee_import_batches set status = 'committed', committed_by = auth.uid(), committed_at = now() where id = p_batch;
  return jsonb_build_object('activated', n_active, 'awaiting_employee_id', n_app, 'skipped', b.error_rows);
end $$;

-- ---------------------------------------------------------------------
-- HR dashboard (runs as the caller: counts only what the caller may see)
-- ---------------------------------------------------------------------
create or replace function public.hr_dashboard(p_from date, p_to date, p_zone uuid default null, p_hub uuid default null)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with e as (
    select * from public.employees
    where archived_at is null and (p_zone is null or zone_id = p_zone) and (p_hub is null or hub_id = p_hub)
  )
  select jsonb_build_object(
    'total_employees',      (select count(*) from e where status in ('active','inactive')),
    'active',               (select count(*) from e where status = 'active'),
    'inactive',             (select count(*) from e where status = 'inactive'),
    'new_joining',          (select count(*) from e where status not in ('applicant','rejected') and joining_date between p_from and p_to),
    'resigned',             (select count(*) from public.employee_status_history h join e on e.id = h.employee_id
                              where h.to_status = 'resigned' and h.effective_date between p_from and p_to),
    'terminated',           (select count(*) from public.employee_status_history h join e on e.id = h.employee_id
                              where h.to_status = 'terminated' and h.effective_date between p_from and p_to),
    'transferred',          (select count(*) from public.employee_assignments a join e on e.id = a.employee_id
                              where a.change_type = 'transfer' and a.effective_from between p_from and p_to),
    'pending_applications', (select count(*) from public.employee_applications a join e on e.id = a.employee_id
                              where a.status = 'submitted'),
    'pending_leave',        (select count(*) from public.leave_requests l join e on e.id = l.employee_id where l.status = 'pending'),
    'pending_salary_changes', (select count(*) from public.employee_compensation c join e on e.id = c.employee_id
                              where c.status = 'pending' and e.status <> 'applicant'),
    'employees_with_missing_info', (select count(*) from public.hr_missing_information(p_zone, p_hub) mi where cardinality(mi.missing) > 0)
  )
$$;

revoke all on function public.hr_validate_import(uuid, jsonb), public.hr_verify_import(uuid),
  public.hr_commit_import(uuid, boolean), public.hr_dashboard(date, date, uuid, uuid) from public, anon;
grant execute on function public.hr_validate_import(uuid, jsonb), public.hr_verify_import(uuid),
  public.hr_commit_import(uuid, boolean), public.hr_dashboard(date, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: private bucket for employee files (only on Supabase, where the
-- storage schema exists). File access = access to its document row.
-- ---------------------------------------------------------------------
create or replace function private.can_read_employee_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_documents d
    where d.storage_path = p_name and d.archived_at is null
      and (private.is_self_employee(d.employee_id)
           or private.is_open_draft_of_caller(d.employee_id)
           or (d.doc_type in ('nid_front','nid_back') and private.employee_has_permission('hr.employee_sensitive.view', d.employee_id))
           or (d.doc_type not in ('nid_front','nid_back') and private.employee_has_permission('hr.document.view', d.employee_id))))
$$;

create or replace function private.can_upload_employee_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid;
begin
  if p_name !~ '^employee/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  v_emp := split_part(p_name, '/', 2)::uuid;
  return private.employee_has_permission('hr.document.create', v_emp) or private.is_open_draft_of_caller(v_emp);
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'buckets') then
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('employee-docs', 'employee-docs', false, 10485760,
                     array['image/jpeg','image/png','image/webp','application/pdf'])
             on conflict (id) do nothing$q$;
    execute $q$create policy employee_docs_read on storage.objects for select to authenticated
             using (bucket_id = 'employee-docs' and private.can_read_employee_object(name))$q$;
    execute $q$create policy employee_docs_upload on storage.objects for insert to authenticated
             with check (bucket_id = 'employee-docs' and private.can_upload_employee_object(name))$q$;
    -- no update/delete policies: originals are never overwritten or removed through the API.
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Default HR permissions per role (editable later by Super Admin)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'hr' and (
     r.code in ('admin','hr_manager')
  or (r.code = 'head_office_manager' and p.action in ('view','export') and p.resource <> 'employee_sensitive')
  or (r.code = 'auditor' and p.action in ('view','export') and p.resource <> 'employee_sensitive')
  or (r.code = 'zonal_manager' and p.code in ('hr.employee.view','hr.application.view','hr.application.create',
        'hr.document.view','hr.document.create','hr.attendance.view','hr.attendance.export','hr.leave.view',
        'hr.leave.approve','hr.leave.reject','hr.compensation.view','hr.salary_sheet.view'))
  or (r.code = 'hub_manager' and p.code in ('hr.employee.view','hr.application.view','hr.application.create',
        'hr.document.view','hr.document.create','hr.attendance.view','hr.attendance.create','hr.attendance.edit',
        'hr.leave.view','hr.leave.create','hr.leave.approve','hr.leave.reject','hr.compensation.view',
        'hr.salary_sheet.view','hr.salary_sheet.create'))
  or (r.code = 'accounts_manager' and p.code in ('hr.employee.view','hr.compensation.view','hr.salary_sheet.view',
        'hr.salary_sheet.approve','hr.salary_sheet.export'))
  or (r.code = 'accountant' and p.code in ('hr.employee.view','hr.compensation.view','hr.salary_sheet.view','hr.salary_sheet.export'))
  or (r.code in ('operations_manager','pickup_manager','delivery_manager') and p.code in ('hr.employee.view','hr.attendance.view'))
)
on conflict do nothing;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
