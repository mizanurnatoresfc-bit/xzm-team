-- =====================================================================
-- XZM-TEAM ERP — Migration 0003: HR core
--   employees (current snapshot) + employee_sensitive (NID etc., separate
--   table so row security can protect it) + assignment & status history,
--   Employee ID applications (3-page flow → HR review → activation),
--   employee documents, dynamic profile builder (custom fields).
-- Rules:
--   * Employee ID (employee_code) is entered by authorised HR/Admin, never generated.
--   * Status / hub / position changes only through audited functions.
--   * Nothing is deleted; leavers are archived.
--   * A signature image is only an image: it is never treated as consent or payment proof.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'hr.' || r || '.' || a, 'hr', r, a, d from (values
  ('employee','view','View employees in scope'),
  ('employee','create','Start employee records / applications'),
  ('employee','edit','Edit employee details, transfer, resign'),
  ('employee','approve','Terminate / reinstate employees'),
  ('employee','archive','Archive former employees'),
  ('employee','export','Export employee lists'),
  ('employee_sensitive','view','Reveal NID, date of birth, family and address (audited)'),
  ('employee_sensitive','edit','Change NID and other sensitive identity data'),
  ('application','view','View Employee ID applications'),
  ('application','create','Prepare and submit Employee ID applications'),
  ('application','approve','Approve applications and assign Employee ID'),
  ('application','reject','Return or reject applications'),
  ('document','view','View employee documents (non-identity)'),
  ('document','create','Upload employee documents'),
  ('document','approve','Verify employee documents'),
  ('document','archive','Archive employee documents'),
  ('profile_field','configure','Configure the dynamic employee profile'),
  ('import','create','Upload and validate employee imports'),
  ('import','approve','Verify and commit employee imports')
) v(r, a, d);

-- ---------------------------------------------------------------------
-- Settings used by HR validation (configurable, not hard-coded)
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('hr.employee_code_pattern', '"^[A-Z]{2,4}-[0-9]{3,6}$"', 'Regex the company Employee ID must match'),
  ('hr.mobile_pattern',        '"^01[3-9][0-9]{8}$"',      'Bangladesh mobile number format'),
  ('hr.nid_pattern',           '"^([0-9]{10}|[0-9]{13}|[0-9]{17})$"', 'NID: 10, 13 or 17 digits'),
  ('hr.min_age_years',         '18',                        'Minimum age on joining date'),
  ('hr.required_documents',    '["nid_front","nid_back","photo"]', 'Documents required before an application can be submitted');

create or replace function private.setting_text(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value #>> '{}' from public.system_settings where key = p_key
$$;

-- ---------------------------------------------------------------------
-- Employees (current state)
-- ---------------------------------------------------------------------
create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  employee_code      extensions.citext unique,           -- assigned by HR on approval
  profile_id         uuid unique references public.profiles(id), -- login account, optional
  full_name          text not null check (length(trim(full_name)) > 1),
  full_name_bn       text,
  mobile             text,
  email              extensions.citext,
  emergency_contact_name  text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  reference_info     text,
  department_id      uuid references public.departments(id),
  position_id        uuid references public.positions(id),
  zone_id            uuid references public.zones(id),
  hub_id             uuid references public.hubs(id),
  reporting_manager_id uuid references public.employees(id),
  joining_date       date,
  status             text not null default 'applicant'
                     check (status in ('applicant','active','inactive','resigned','terminated','rejected')),
  status_since       date not null default current_date,
  archived_at        timestamptz,
  archived_by        uuid,
  archive_reason     text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint employees_code_when_active check (status in ('applicant','rejected') or employee_code is not null),
  constraint employees_not_self_manager check (reporting_manager_id is null or reporting_manager_id <> id)
);
create index employees_hub_idx on public.employees (hub_id) where archived_at is null;
create index employees_zone_idx on public.employees (zone_id) where archived_at is null;
create index employees_status_idx on public.employees (status);
create index employees_name_trgm on public.employees using gin (full_name extensions.gin_trgm_ops);
create unique index employees_mobile_uniq on public.employees (mobile)
  where mobile is not null and status not in ('rejected') and archived_at is null;

-- Sensitive identity data (separate table: row security can protect it as a whole).
create table public.employee_sensitive (
  employee_id      uuid primary key references public.employees(id),
  nid_number       text unique,
  date_of_birth    date,
  father_name      text,
  mother_name      text,
  present_address  text,
  permanent_address text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

-- History of where/what an employee works. Current row has effective_to null.
create table public.employee_assignments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id),
  change_type      text not null check (change_type in ('joining','transfer','promotion','correction','exit')),
  department_id    uuid references public.departments(id),
  position_id      uuid references public.positions(id),
  zone_id          uuid references public.zones(id),
  hub_id           uuid references public.hubs(id),
  reporting_manager_id uuid references public.employees(id),
  effective_from   date not null,
  effective_to     date,
  reason           text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  constraint employee_assignments_dates check (effective_to is null or effective_to >= effective_from)
);
create index employee_assignments_emp_idx on public.employee_assignments (employee_id, effective_from desc);
create unique index employee_assignments_one_current on public.employee_assignments (employee_id) where effective_to is null;

create table public.employee_status_history (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  from_status    text,
  to_status      text not null,
  effective_date date not null,
  reason         text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);
create index employee_status_history_emp_idx on public.employee_status_history (employee_id, created_at desc);
create index employee_status_history_date_idx on public.employee_status_history (to_status, effective_date);

create table public.employee_applications (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null unique references public.employees(id),
  status        text not null default 'draft' check (status in ('draft','submitted','returned','approved','rejected')),
  submitted_by  uuid,
  submitted_at  timestamptz,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create index employee_applications_status_idx on public.employee_applications (status);

-- Documents: metadata here, file in private Storage bucket "employee-docs".
create table public.employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id),
  doc_type      text not null check (doc_type in
                ('nid_front','nid_back','photo','signature','cv','experience_certificate','education','other')),
  title         text,
  storage_path  text not null unique,     -- employee/<employee_id>/<uuid>-<name>
  file_name     text not null,
  mime_type     text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  version       integer not null default 1,
  expiry_date   date,
  verified_by   uuid,
  verified_at   timestamptz,
  archived_at   timestamptz,
  archived_by   uuid,
  archive_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  constraint employee_documents_path check (storage_path like 'employee/' || employee_id::text || '/%')
);
create index employee_documents_emp_idx on public.employee_documents (employee_id, doc_type) where archived_at is null;
comment on table public.employee_documents is
  'Employee files. A signature image is stored for identification only and is never treated as proof of consent or payment.';

-- ---------------------------------------------------------------------
-- Dynamic profile builder
-- ---------------------------------------------------------------------
create table public.employee_field_sections (
  id          uuid primary key default gen_random_uuid(),
  code        extensions.citext not null unique,
  name        text not null,
  name_bn     text,
  sort_order  integer not null default 100,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.employee_custom_fields (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references public.employee_field_sections(id),
  code            extensions.citext not null unique check (code ~ '^[a-z][a-z0-9_]{1,48}$'),
  label           text not null,
  label_bn        text,
  field_type      text not null check (field_type in
                  ('text','number','date','dropdown','multi_select','checkbox','textarea',
                   'photo','document','signature','employee_ref','hub_ref')),
  is_required     boolean not null default false,
  is_visible      boolean not null default true,
  view_permission text references public.permissions(code),   -- null = anyone who can view the employee
  edit_permission text references public.permissions(code),   -- null = hr.employee.edit
  validation      jsonb not null default '{}'::jsonb,         -- {min,max,maxLength,pattern,minDate,maxDate}
  options         jsonb not null default '[]'::jsonb,         -- [{"value":"o_pos","label":"O+","label_bn":"ও+"}]
  sort_order      integer not null default 100,
  archived_at     timestamptz,
  archived_by     uuid,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint custom_fields_options_chk check (
    (field_type in ('dropdown','multi_select') and jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0)
    or (field_type not in ('dropdown','multi_select'))),
  constraint custom_fields_validation_obj check (jsonb_typeof(validation) = 'object')
);
create index employee_custom_fields_section_idx on public.employee_custom_fields (section_id, sort_order);

create table public.employee_custom_field_values (
  employee_id uuid not null references public.employees(id),
  field_id    uuid not null references public.employee_custom_fields(id),
  value       jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (employee_id, field_id)
);
create index employee_custom_field_values_field_idx on public.employee_custom_field_values (field_id);

-- ---------------------------------------------------------------------
-- Scope helpers
-- ---------------------------------------------------------------------
create or replace function private.employee_has_permission(p_perm text, p_employee uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.has_permission(p_perm, e.zone_id, e.hub_id)
                   from public.employees e where e.id = p_employee), false)
$$;

create or replace function private.is_self_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 where e.id = p_employee and e.profile_id = auth.uid() and e.profile_id is not null)
$$;

-- The person who created a still-editable application may keep working on it.
create or replace function private.is_open_draft_of_caller(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 left join public.employee_applications a on a.employee_id = e.id
                 where e.id = p_employee and e.status = 'applicant'
                   and (a.status is null or a.status in ('draft','returned'))
                   and e.created_by = auth.uid()
                   and private.has_permission('hr.application.create', e.zone_id, e.hub_id))
$$;

create or replace function private.is_api_user() returns boolean
language sql stable as $$ select current_user in ('authenticated','anon') $$;

-- ---------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------
-- zone always follows hub; protected columns change only through HR functions.
create or replace function private.hub_zone(p_hub uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select zone_id from public.hubs where id = p_hub
$$;

-- NOTE: guard triggers are SECURITY INVOKER on purpose: current_user is then
-- 'authenticated' for direct API writes but the owner inside workflow functions.
create or replace function private.employees_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.hub_id is not null then
    new.zone_id := private.hub_zone(new.hub_id);
  end if;
  if new.mobile is not null and new.mobile !~ private.setting_text('hr.mobile_pattern') then
    raise exception 'Mobile number % is not a valid Bangladesh mobile number.', new.mobile using errcode = '23514';
  end if;
  if new.emergency_contact_phone is not null and new.emergency_contact_phone !~ private.setting_text('hr.mobile_pattern') then
    raise exception 'Emergency contact phone is not a valid mobile number.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if private.is_api_user() and (new.status <> 'applicant' or new.employee_code is not null or new.profile_id is not null) then
      raise exception 'New employees start as applicants. Use the application approval to activate and assign an Employee ID.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if private.is_api_user() then
    if (new.employee_code, new.status, new.profile_id, new.archived_at, new.status_since)
       is distinct from (old.employee_code, old.status, old.profile_id, old.archived_at, old.status_since) then
      raise exception 'Employee ID, status, login link and archive state change only through HR workflow functions.'
        using errcode = '42501';
    end if;
    if old.status <> 'applicant'
       and (new.hub_id, new.zone_id, new.department_id, new.position_id, new.reporting_manager_id, new.joining_date)
           is distinct from
           (old.hub_id, old.zone_id, old.department_id, old.position_id, old.reporting_manager_id, old.joining_date) then
      raise exception 'Use the transfer / promotion function to change hub, department, position or manager (keeps history).'
        using errcode = '42501';
    end if;
    if old.archived_at is not null then
      raise exception 'Archived employee records are read-only.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger employees_guard before insert or update on public.employees
  for each row execute function private.employees_guard();

create or replace function private.employee_sensitive_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_join date;
  v_min int := coalesce(private.setting_text('hr.min_age_years')::int, 18);
begin
  if new.nid_number is not null and new.nid_number !~ private.setting_text('hr.nid_pattern') then
    raise exception 'NID must be 10, 13 or 17 digits.' using errcode = '23514';
  end if;
  if new.date_of_birth is not null then
    select joining_date into v_join from public.employees where id = new.employee_id;
    if new.date_of_birth > coalesce(v_join, current_date) - make_interval(years => v_min) then
      raise exception 'Employee must be at least % years old on the joining date.', v_min using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger employee_sensitive_guard before insert or update on public.employee_sensitive
  for each row execute function private.employee_sensitive_guard();

-- Audit for the sensitive table records WHICH fields changed, never the values.
create or replace function private.audit_sensitive() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fields jsonb;
begin
  select jsonb_object_agg(k, '***') into v_fields
  from jsonb_each(to_jsonb(new)) n(k, v)
  where k not in ('updated_at','updated_by','created_at','created_by','employee_id')
    and (tg_op = 'INSERT' or (to_jsonb(old) -> k) is distinct from v);
  perform private.write_audit(tg_op, 'hr', 'employee_sensitive', new.employee_id::text, null, v_fields);
  return new;
end $$;
create trigger employee_sensitive_audit after insert or update on public.employee_sensitive
  for each row execute function private.audit_sensitive();

-- History tables are append-only.
create or replace function private.append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is history and cannot be deleted.', tg_table_name using errcode = 'P0001';
  end if;
  -- employee_assignments: only closing the current row (effective_to) is allowed.
  if tg_table_name = 'employee_assignments' then
    if (to_jsonb(new) - 'effective_to') = (to_jsonb(old) - 'effective_to') and old.effective_to is null then
      return new;
    end if;
  end if;
  raise exception '% is history and cannot be changed.', tg_table_name using errcode = 'P0001';
end $$;
create trigger employee_assignments_append_only before update or delete on public.employee_assignments
  for each row execute function private.append_only();
create trigger employee_status_history_append_only before update or delete on public.employee_status_history
  for each row execute function private.append_only();

-- Custom field values: type/option/validation checks, archived fields locked, edit permission.
create or replace function private.custom_value_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  f public.employee_custom_fields%rowtype;
  v jsonb := new.value;
  n numeric;
  d date;
  el jsonb;
begin
  select * into f from public.employee_custom_fields where id = new.field_id;
  if f.archived_at is not null then
    raise exception 'Field "%" is archived; its old values are kept but it cannot be changed.', f.label using errcode = 'P0001';
  end if;
  if auth.uid() is not null
     and not private.employee_has_permission(coalesce(f.edit_permission, 'hr.employee.edit'), new.employee_id)
     and not private.is_open_draft_of_caller(new.employee_id) then
    raise exception 'Not allowed to edit field "%".', f.label using errcode = '42501';
  end if;
  if jsonb_typeof(v) = 'null' then
    raise exception 'Use an explicit value; to clear a field, archive the value through HR.' using errcode = '23514';
  end if;

  case f.field_type
    when 'text', 'textarea' then
      if jsonb_typeof(v) <> 'string' then raise exception '"%" must be text.', f.label using errcode = '23514'; end if;
      if (f.validation ? 'maxLength') and length(v #>> '{}') > (f.validation ->> 'maxLength')::int then
        raise exception '"%" is longer than % characters.', f.label, f.validation ->> 'maxLength' using errcode = '23514'; end if;
      if (f.validation ? 'pattern') and (v #>> '{}') !~ (f.validation ->> 'pattern') then
        raise exception '"%" has an invalid format.', f.label using errcode = '23514'; end if;
    when 'number' then
      if jsonb_typeof(v) <> 'number' then raise exception '"%" must be a number.', f.label using errcode = '23514'; end if;
      n := (v #>> '{}')::numeric;
      if (f.validation ? 'min' and n < (f.validation ->> 'min')::numeric)
         or (f.validation ? 'max' and n > (f.validation ->> 'max')::numeric) then
        raise exception '"%" is out of the allowed range.', f.label using errcode = '23514'; end if;
    when 'date' then
      begin d := (v #>> '{}')::date;
      exception when others then raise exception '"%" must be a date (YYYY-MM-DD).', f.label using errcode = '23514'; end;
      if (f.validation ? 'minDate' and d < (f.validation ->> 'minDate')::date)
         or (f.validation ? 'maxDate' and d > (f.validation ->> 'maxDate')::date) then
        raise exception '"%" is outside the allowed dates.', f.label using errcode = '23514'; end if;
    when 'dropdown' then
      if jsonb_typeof(v) <> 'string' or not exists (select 1 from jsonb_array_elements(f.options) o where o ->> 'value' = v #>> '{}') then
        raise exception '"%" must be one of the configured options.', f.label using errcode = '23514'; end if;
    when 'multi_select' then
      if jsonb_typeof(v) <> 'array' then raise exception '"%" must be a list.', f.label using errcode = '23514'; end if;
      for el in select * from jsonb_array_elements(v) loop
        if not exists (select 1 from jsonb_array_elements(f.options) o where o ->> 'value' = el #>> '{}') then
          raise exception '"%" contains an option that is not configured.', f.label using errcode = '23514'; end if;
      end loop;
    when 'checkbox' then
      if jsonb_typeof(v) <> 'boolean' then raise exception '"%" must be true or false.', f.label using errcode = '23514'; end if;
    when 'photo', 'document', 'signature' then
      if not exists (select 1 from public.employee_documents dd
                     where dd.id::text = v #>> '{}' and dd.employee_id = new.employee_id and dd.archived_at is null) then
        raise exception '"%" must reference an uploaded document of this employee.', f.label using errcode = '23514'; end if;
    when 'employee_ref' then
      if not exists (select 1 from public.employees e where e.id::text = v #>> '{}') then
        raise exception '"%" must reference an existing employee.', f.label using errcode = '23514'; end if;
    when 'hub_ref' then
      if not exists (select 1 from public.hubs h where h.id::text = v #>> '{}') then
        raise exception '"%" must reference an existing hub.', f.label using errcode = '23514'; end if;
  end case;
  return new;
end $$;
create trigger custom_value_guard before insert or update on public.employee_custom_field_values
  for each row execute function private.custom_value_guard();

-- A field's type cannot change once values exist (would corrupt history).
create or replace function private.custom_field_guard() returns trigger
language plpgsql as $$
begin
  if new.field_type <> old.field_type
     and exists (select 1 from public.employee_custom_field_values where field_id = old.id) then
    raise exception 'Field type cannot change after values exist. Archive this field and create a new one.' using errcode = 'P0001';
  end if;
  if new.code <> old.code then
    raise exception 'Field code cannot change.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger custom_field_guard before update on public.employee_custom_fields
  for each row execute function private.custom_field_guard();

-- Stamp / audit / no-delete on every HR table.
do $$
declare t record;
begin
  for t in select * from (values
    ('employees', true, true), ('employee_sensitive', true, false),
    ('employee_applications', true, true), ('employee_documents', true, true),
    ('employee_field_sections', true, true), ('employee_custom_fields', true, true),
    ('employee_custom_field_values', true, true)) v(tbl, stamp, audit)
  loop
    if t.stamp then
      execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t.tbl||'_stamp', t.tbl);
    end if;
    if t.audit then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''hr'')', t.tbl||'_audit', t.tbl);
    end if;
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t.tbl||'_no_delete', t.tbl);
  end loop;
end $$;
create trigger employee_assignments_audit after insert or update on public.employee_assignments
  for each row execute function private.audit_row('hr');
create trigger employee_status_history_audit after insert on public.employee_status_history
  for each row execute function private.audit_row('hr');

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.employees                  enable row level security;
alter table public.employee_sensitive         enable row level security;
alter table public.employee_assignments       enable row level security;
alter table public.employee_status_history    enable row level security;
alter table public.employee_applications      enable row level security;
alter table public.employee_documents         enable row level security;
alter table public.employee_field_sections    enable row level security;
alter table public.employee_custom_fields     enable row level security;
alter table public.employee_custom_field_values enable row level security;

revoke all on public.employees, public.employee_sensitive, public.employee_assignments,
  public.employee_status_history, public.employee_applications, public.employee_documents,
  public.employee_field_sections, public.employee_custom_fields, public.employee_custom_field_values from anon;
revoke delete, truncate on public.employees, public.employee_sensitive, public.employee_assignments,
  public.employee_status_history, public.employee_applications, public.employee_documents,
  public.employee_field_sections, public.employee_custom_fields, public.employee_custom_field_values from authenticated;
-- History and workflow tables are written only by functions.
revoke insert, update on public.employee_assignments, public.employee_status_history,
  public.employee_applications from authenticated;

-- employees
create policy employees_read on public.employees for select to authenticated
  using (private.has_permission('hr.employee.view', zone_id, hub_id)
         or profile_id = auth.uid()
         or private.is_open_draft_of_caller(id));
create policy employees_insert on public.employees for insert to authenticated
  with check (private.has_permission('hr.application.create', zone_id, hub_id)
              or private.has_permission('hr.employee.create', zone_id, hub_id));
create policy employees_update on public.employees for update to authenticated
  using (private.has_permission('hr.employee.edit', zone_id, hub_id) or private.is_open_draft_of_caller(id))
  with check (private.has_permission('hr.employee.edit', zone_id, hub_id) or private.is_open_draft_of_caller(id));

-- employee_sensitive: NO general read policy. Others read it only through
-- hr_reveal_sensitive(), which checks permission and writes an audit entry.
create policy sensitive_self_read on public.employee_sensitive for select to authenticated
  using (private.is_self_employee(employee_id) or private.is_open_draft_of_caller(employee_id));
create policy sensitive_insert on public.employee_sensitive for insert to authenticated
  with check (private.is_open_draft_of_caller(employee_id)
              or private.employee_has_permission('hr.employee_sensitive.edit', employee_id));
create policy sensitive_update on public.employee_sensitive for update to authenticated
  using (private.is_open_draft_of_caller(employee_id)
         or private.employee_has_permission('hr.employee_sensitive.edit', employee_id))
  with check (private.is_open_draft_of_caller(employee_id)
              or private.employee_has_permission('hr.employee_sensitive.edit', employee_id));

create policy assignments_read on public.employee_assignments for select to authenticated
  using (private.employee_has_permission('hr.employee.view', employee_id) or private.is_self_employee(employee_id));
create policy status_history_read on public.employee_status_history for select to authenticated
  using (private.employee_has_permission('hr.employee.view', employee_id) or private.is_self_employee(employee_id));
create policy applications_read on public.employee_applications for select to authenticated
  using (private.employee_has_permission('hr.application.view', employee_id) or private.is_open_draft_of_caller(employee_id));

-- documents: identity documents (NID images) need the sensitive permission.
create policy documents_read on public.employee_documents for select to authenticated
  using (private.is_self_employee(employee_id)
         or private.is_open_draft_of_caller(employee_id)
         or (doc_type in ('nid_front','nid_back')
             and private.employee_has_permission('hr.employee_sensitive.view', employee_id))
         or (doc_type not in ('nid_front','nid_back')
             and private.employee_has_permission('hr.document.view', employee_id)));
create policy documents_insert on public.employee_documents for insert to authenticated
  with check (verified_by is null and archived_at is null
              and (private.employee_has_permission('hr.document.create', employee_id)
                   or private.is_open_draft_of_caller(employee_id)));
create policy documents_update on public.employee_documents for update to authenticated
  using (private.employee_has_permission('hr.document.approve', employee_id)
         or private.employee_has_permission('hr.document.archive', employee_id))
  with check (private.employee_has_permission('hr.document.approve', employee_id)
              or private.employee_has_permission('hr.document.archive', employee_id));

-- profile builder configuration
create policy sections_read on public.employee_field_sections for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy sections_write on public.employee_field_sections for insert to authenticated
  with check (private.has_permission('hr.profile_field.configure'));
create policy sections_update on public.employee_field_sections for update to authenticated
  using (private.has_permission('hr.profile_field.configure'))
  with check (private.has_permission('hr.profile_field.configure'));
create policy fields_read on public.employee_custom_fields for select to authenticated
  using (exists (select 1 from private.my_grants()));
create policy fields_insert on public.employee_custom_fields for insert to authenticated
  with check (private.has_permission('hr.profile_field.configure'));
create policy fields_update on public.employee_custom_fields for update to authenticated
  using (private.has_permission('hr.profile_field.configure'))
  with check (private.has_permission('hr.profile_field.configure'));

create policy values_read on public.employee_custom_field_values for select to authenticated
  using ((private.employee_has_permission('hr.employee.view', employee_id)
          or private.is_self_employee(employee_id)
          or private.is_open_draft_of_caller(employee_id))
         and coalesce((select private.employee_has_permission(f.view_permission, employee_id)
                       from public.employee_custom_fields f
                       where f.id = field_id and f.view_permission is not null), true));
create policy values_insert on public.employee_custom_field_values for insert to authenticated
  with check (private.employee_has_permission('hr.employee.view', employee_id) or private.is_open_draft_of_caller(employee_id));
create policy values_update on public.employee_custom_field_values for update to authenticated
  using (private.employee_has_permission('hr.employee.view', employee_id) or private.is_open_draft_of_caller(employee_id))
  with check (private.employee_has_permission('hr.employee.view', employee_id) or private.is_open_draft_of_caller(employee_id));
-- (the value guard trigger enforces the field's own edit permission)

-- ---------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------

-- Start an application (page 1+2 data are then filled with normal updates while in draft).
create or replace function public.hr_start_application(
  p_full_name text, p_mobile text, p_hub uuid, p_department uuid default null, p_position uuid default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.employees (full_name, mobile, hub_id, department_id, position_id)
  values (p_full_name, p_mobile, p_hub, p_department, p_position)
  returning id into v_id;
  perform private.create_application_row(v_id);
  return v_id;
end $$;

create or replace function private.create_application_row(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.employees where id = p_employee and created_by = auth.uid() and status = 'applicant') then
    raise exception 'Application can only be opened for an applicant you created.' using errcode = '42501';
  end if;
  insert into public.employee_applications (employee_id) values (p_employee);
end $$;

-- What is still missing before submission (page 3 "show missing fields").
create or replace function public.hr_application_missing_fields(p_employee uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  s public.employee_sensitive%rowtype;
  v text[] := '{}';
  d text;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if not (private.employee_has_permission('hr.application.view', p_employee)
          or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into s from public.employee_sensitive where employee_id = p_employee;

  if coalesce(trim(e.full_name), '') = '' then v := array_append(v, 'full_name'::text); end if;
  if e.mobile is null then v := array_append(v, 'mobile'::text); end if;
  if s.date_of_birth is null then v := array_append(v, 'date_of_birth'::text); end if;
  if s.nid_number is null then v := array_append(v, 'nid_number'::text); end if;
  if e.department_id is null then v := array_append(v, 'department'::text); end if;
  if e.position_id is null then v := array_append(v, 'position'::text); end if;
  if e.hub_id is null and e.zone_id is null then v := array_append(v, 'hub'::text); end if;
  if e.joining_date is null then v := array_append(v, 'joining_date'::text); end if;
  if e.emergency_contact_phone is null then v := array_append(v, 'emergency_contact'::text); end if;
  if e.reporting_manager_id is null then v := array_append(v, 'reporting_manager'::text); end if;
  if not exists (select 1 from public.employee_compensation c where c.employee_id = p_employee and c.status in ('pending','approved')) then
    v := array_append(v, 'basic_salary'::text);
  end if;
  for d in select jsonb_array_elements_text(value) from public.system_settings where key = 'hr.required_documents' loop
    if not exists (select 1 from public.employee_documents x where x.employee_id = p_employee
                   and x.doc_type = d and x.archived_at is null) then
      v := v || ('document:' || d);
    end if;
  end loop;
  select v || coalesce(array_agg('field:' || f.code::text order by f.sort_order), '{}') into v
  from public.employee_custom_fields f
  where f.is_required and f.archived_at is null
    and not exists (select 1 from public.employee_custom_field_values cv where cv.field_id = f.id and cv.employee_id = p_employee);
  return v;
end $$;

create or replace function public.hr_submit_application(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_missing text[];
begin
  if not private.is_open_draft_of_caller(p_employee) then
    raise exception 'Only the preparer can submit an open draft application.' using errcode = '42501';
  end if;
  v_missing := public.hr_application_missing_fields(p_employee);
  if cardinality(v_missing) > 0 then
    raise exception 'Application is incomplete. Missing: %', array_to_string(v_missing, ', ') using errcode = '23514';
  end if;
  update public.employee_applications
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
   where employee_id = p_employee;
  perform private.write_audit('SUBMIT', 'hr', 'employee_applications', p_employee::text, null, null, 'Sent to HR review');
end $$;

create or replace function public.hr_return_application(p_employee uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.employee_has_permission('hr.application.reject', p_employee) then
    raise exception 'Not authorised to return applications.' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  update public.employee_applications
     set status = 'returned', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where employee_id = p_employee and status = 'submitted';
  if not found then raise exception 'Only submitted applications can be returned.' using errcode = 'P0001'; end if;
  perform private.write_audit('RETURN', 'hr', 'employee_applications', p_employee::text, null, null, p_note);
end $$;

create or replace function public.hr_reject_application(p_employee uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.employee_has_permission('hr.application.reject', p_employee) then
    raise exception 'Not authorised to reject applications.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.employee_applications
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_reason
   where employee_id = p_employee and status = 'submitted';
  if not found then raise exception 'Only submitted applications can be rejected.' using errcode = 'P0001'; end if;
  update public.employees set status = 'rejected', status_since = current_date where id = p_employee;
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, 'applicant', 'rejected', current_date, p_reason);
end $$;

-- HR review → approve → assign company Employee ID → activate.
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
  if a.submitted_by = auth.uid() then
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
  -- The salary proposed in the application becomes effective now (preparer ≠ approver already enforced).
  update public.employee_compensation
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where employee_id = p_employee and status = 'pending';
end $$;

-- Bulk ID assignment: all-or-nothing. p_items = [{"employee_id": "...", "employee_code": "..."}]
create or replace function public.hr_bulk_assign_ids(p_items jsonb, p_note text default 'Bulk ID assignment')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  it jsonb; n int := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Provide a non-empty list.' using errcode = '22023';
  end if;
  if (select count(distinct upper(x ->> 'employee_code')) from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'The list contains the same Employee ID twice.' using errcode = '23505';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    perform public.hr_approve_application((it ->> 'employee_id')::uuid, it ->> 'employee_code', p_note);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Transfer / promotion / correction of assignment with history.
create or replace function public.hr_transfer_employee(
  p_employee uuid, p_hub uuid, p_department uuid, p_position uuid, p_manager uuid,
  p_effective date, p_reason text, p_change_type text default 'transfer'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_zone uuid;
begin
  select * into e from public.employees where id = p_employee for update;
  if e.status <> 'active' then raise exception 'Only active employees can be transferred.' using errcode = 'P0001'; end if;
  if p_change_type not in ('transfer','promotion','correction') then raise exception 'Invalid change type.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_effective is null or p_effective < (select max(effective_from) from public.employee_assignments where employee_id = p_employee) then
    raise exception 'Effective date must be on or after the current assignment start.' using errcode = '22023';
  end if;
  select zone_id into v_zone from public.hubs where id = p_hub;
  if not private.has_permission('hr.employee.edit', e.zone_id, e.hub_id)
     or not private.has_permission('hr.employee.edit', coalesce(v_zone, e.zone_id), p_hub) then
    raise exception 'You need HR edit rights in both the current and the new hub.' using errcode = '42501';
  end if;
  if p_manager = p_employee then raise exception 'An employee cannot report to themselves.' using errcode = '22023'; end if;

  update public.employee_assignments set effective_to = greatest(p_effective - 1, effective_from)
   where employee_id = p_employee and effective_to is null;
  insert into public.employee_assignments
    (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
  values (p_employee, p_change_type, p_department, p_position, coalesce(v_zone, e.zone_id), p_hub, p_manager, p_effective, p_reason);
  perform set_config('app.change_reason', p_reason, true);
  update public.employees
     set hub_id = p_hub, zone_id = coalesce(v_zone, e.zone_id), department_id = p_department,
         position_id = p_position, reporting_manager_id = p_manager
   where id = p_employee;
end $$;

-- Activate / deactivate / resign / terminate / reinstate.
create or replace function public.hr_change_status(p_employee uuid, p_status text, p_effective date, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_perm text;
begin
  select * into e from public.employees where id = p_employee for update;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if e.archived_at is not null then raise exception 'Archived employees cannot change status.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if not ((e.status, p_status) in (('active','inactive'), ('inactive','active'), ('active','resigned'),
                                   ('inactive','resigned'), ('active','terminated'), ('inactive','terminated'),
                                   ('resigned','active'), ('terminated','active'))) then
    raise exception 'Status cannot change from % to %.', e.status, p_status using errcode = 'P0001';
  end if;
  v_perm := case when p_status = 'terminated' or e.status in ('resigned','terminated') then 'hr.employee.approve'
                 else 'hr.employee.edit' end;
  if not private.has_permission(v_perm, e.zone_id, e.hub_id) then
    raise exception 'Not authorised (requires %).', v_perm using errcode = '42501';
  end if;
  if e.profile_id = auth.uid() then
    raise exception 'You cannot change your own employment status.' using errcode = '42501';
  end if;

  perform set_config('app.change_reason', p_reason, true);
  update public.employees set status = p_status, status_since = coalesce(p_effective, current_date) where id = p_employee;
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, e.status, p_status, coalesce(p_effective, current_date), p_reason);

  if p_status in ('resigned','terminated') then
    update public.employee_assignments set effective_to = greatest(coalesce(p_effective, current_date), effective_from)
     where employee_id = p_employee and effective_to is null;
  elsif e.status in ('resigned','terminated') and p_status = 'active' then
    insert into public.employee_assignments
      (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
    values (p_employee, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id,
            coalesce(p_effective, current_date), 'Reinstated: ' || p_reason);
  end if;

  -- Leavers and inactive staff lose system access immediately; reactivation restores it.
  if e.profile_id is not null then
    update public.profiles set status = case when p_status = 'active' then 'active' else 'inactive' end
     where id = e.profile_id;
  end if;
end $$;

create or replace function public.hr_archive_employee(p_employee uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype;
begin
  select * into e from public.employees where id = p_employee for update;
  if not private.has_permission('hr.employee.archive', e.zone_id, e.hub_id) then
    raise exception 'Not authorised to archive employees.' using errcode = '42501';
  end if;
  if e.status in ('active','applicant') then
    raise exception 'Active employees and open applications cannot be archived. Resign/terminate or reject first.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.employees set archived_at = now(), archived_by = auth.uid(), archive_reason = p_reason where id = p_employee;
end $$;

-- Link / unlink a login account to an employee.
create or replace function public.hr_link_login(p_employee uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.employee_has_permission('hr.employee.edit', p_employee) or not private.has_permission('system.user.edit') then
    raise exception 'Requires HR edit and user management rights.' using errcode = '42501';
  end if;
  update public.employees set profile_id = p_profile where id = p_employee and status = 'active';
  if not found then raise exception 'Only active employees can be linked to a login.' using errcode = 'P0001'; end if;
end $$;

-- Reveal sensitive identity data: permission-checked and audited (reason required).
create or replace function public.hr_reveal_sensitive(p_employee uuid, p_reason text)
returns table (nid_number text, date_of_birth date, father_name text, mother_name text,
               present_address text, permanent_address text)
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.employee_has_permission('hr.employee_sensitive.view', p_employee) or private.is_self_employee(p_employee)) then
    raise exception 'Not authorised to view sensitive employee data.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' and not private.is_self_employee(p_employee) then
    raise exception 'A reason is required to view sensitive data.' using errcode = '22023';
  end if;
  perform private.write_audit('VIEW_SENSITIVE', 'hr', 'employee_sensitive', p_employee::text, null, null, p_reason);
  return query select s.nid_number, s.date_of_birth, s.father_name, s.mother_name, s.present_address, s.permanent_address
               from public.employee_sensitive s where s.employee_id = p_employee;
end $$;

-- Masked identity for lists: last 4 NID digits only, no audit needed.
create or replace function public.hr_masked_nid(p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when private.employee_has_permission('hr.employee.view', p_employee) or private.is_self_employee(p_employee)
              then '•••• ' || right(s.nid_number, 4) end
  from public.employee_sensitive s where s.employee_id = p_employee
$$;

-- Missing information per employee, computed from the ACTIVE profile configuration.
create or replace function public.hr_missing_information(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, missing text[])
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.hub_id,
    array_remove(array[
      case when e.mobile is null then 'mobile' end,
      case when e.joining_date is null then 'joining_date' end,
      case when e.position_id is null then 'position' end,
      case when e.hub_id is null and e.zone_id is null then 'hub' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='photo' and d.archived_at is null) then 'photo' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='nid_front' and d.archived_at is null) then 'nid_front' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='nid_back' and d.archived_at is null) then 'nid_back' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='signature' and d.archived_at is null) then 'signature' end,
      case when not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.doc_type='cv' and d.archived_at is null) then 'cv' end
    ], null)
    || coalesce((select array_agg('field:' || f.code::text order by f.sort_order)
                 from public.employee_custom_fields f
                 where f.is_required and f.archived_at is null
                   and not exists (select 1 from public.employee_custom_field_values v
                                   where v.field_id = f.id and v.employee_id = e.id)), '{}')
  from public.employees e
  where e.status = 'active' and e.archived_at is null
    and (p_zone is null or e.zone_id = p_zone) and (p_hub is null or e.hub_id = p_hub)
$$;

revoke all on function public.hr_start_application(text, text, uuid, uuid, uuid), public.hr_application_missing_fields(uuid),
  public.hr_submit_application(uuid), public.hr_return_application(uuid, text), public.hr_reject_application(uuid, text),
  public.hr_approve_application(uuid, text, text), public.hr_bulk_assign_ids(jsonb, text),
  public.hr_transfer_employee(uuid, uuid, uuid, uuid, uuid, date, text, text), public.hr_change_status(uuid, text, date, text),
  public.hr_archive_employee(uuid, text), public.hr_link_login(uuid, uuid), public.hr_reveal_sensitive(uuid, text),
  public.hr_masked_nid(uuid), public.hr_missing_information(uuid, uuid) from public, anon;
grant execute on function public.hr_start_application(text, text, uuid, uuid, uuid), public.hr_application_missing_fields(uuid),
  public.hr_submit_application(uuid), public.hr_return_application(uuid, text), public.hr_reject_application(uuid, text),
  public.hr_approve_application(uuid, text, text), public.hr_bulk_assign_ids(jsonb, text),
  public.hr_transfer_employee(uuid, uuid, uuid, uuid, uuid, date, text, text), public.hr_change_status(uuid, text, date, text),
  public.hr_archive_employee(uuid, text), public.hr_link_login(uuid, uuid), public.hr_reveal_sensitive(uuid, text),
  public.hr_masked_nid(uuid), public.hr_missing_information(uuid, uuid) to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
