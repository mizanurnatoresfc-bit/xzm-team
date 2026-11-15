-- =====================================================================
-- XZM-TEAM ERP — Migration: ID-ready profiles and tidy positions
--
--  The "New Admin & Rider ID Create" format lists what a profile must hold
--  before an ID is opened. Every employee — old and new — is now checked
--  against that one list:
--    name · mobile · alternative mobile · hub · designation · Gmail (admin
--    posts only) · blood group · date of birth · permanent address ·
--    reference · NID / birth certificate no. · photo · NID front · NID back ·
--    basic salary
--  * Two profile fields are added (alternative mobile, blood group), required.
--  * hr_profile_gaps(): one line per person with what is missing; the HR
--    dashboard's "missing information" count uses the same check.
--  * hr_application_missing_fields(): new ID applications need the same.
--  * Pay items from the format: Pick & Drop, Return, Weight bonus, Entry
--    commission (Phone bill = mobile bill; Conveyance = transport).
--  * Positions: Bangla names, a clean order, one "Assistant Manager"
--    (the duplicate "Asst. Manager" folded into it), "Sorting + Loader";
--    old spellings kept as aliases so imports still match them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Settings: which posts are "admin" (need a Gmail)
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('hr.admin_positions', '["MANAGER","ASSISTANTMAN","HUBCC","DATAENTRY","ZONALMANAGER"]',
   'HR: position codes that count as admin posts — these need a Gmail before an ID is opened')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Profile fields from the format
-- ---------------------------------------------------------------------
insert into public.employee_custom_fields (section_id, code, label, label_bn, field_type, is_required, validation, options, sort_order)
select s.id, 'alt_mobile', 'Alternative phone number', 'বিকল্প মোবাইল নম্বর', 'text', true,
       '{"pattern":"^01[3-9][0-9]{8}$"}'::jsonb, '[]'::jsonb, 15
from public.employee_field_sections s where s.code = 'personal'
on conflict (code) do nothing;

insert into public.employee_custom_fields (section_id, code, label, label_bn, field_type, is_required, options, sort_order)
select s.id, 'blood_group', 'Blood group', 'রক্তের গ্রুপ', 'dropdown', true,
       '[{"value":"a_pos","label":"A+"},{"value":"a_neg","label":"A-"},{"value":"b_pos","label":"B+"},{"value":"b_neg","label":"B-"},
         {"value":"o_pos","label":"O+"},{"value":"o_neg","label":"O-"},{"value":"ab_pos","label":"AB+"},{"value":"ab_neg","label":"AB-"}]'::jsonb, 16
from public.employee_field_sections s where s.code = 'personal'
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Pay items from the format
-- ---------------------------------------------------------------------
insert into public.pay_component_types (code, kind, name, name_bn) values
  ('pick_drop',        'allowance', 'Pick & Drop',      'পিক অ্যান্ড ড্রপ'),
  ('return_bonus',     'allowance', 'Return',           'রিটার্ন'),
  ('weight_bonus',     'allowance', 'Weight bonus',     'ওজন বোনাস'),
  ('entry_commission', 'allowance', 'Entry commission', 'এন্ট্রি কমিশন')
on conflict (code) do nothing;
update public.pay_component_types set name = 'Phone bill', name_bn = 'ফোন বিল' where code = 'mobile_bill';

-- ---------------------------------------------------------------------
-- 4. The one check: what a profile still lacks for an ID
-- ---------------------------------------------------------------------
create or replace function private.hr_id_gaps(p_employee uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype; s public.employee_sensitive%rowtype; v text[] := '{}'; d text;
  v_admin boolean;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then return null; end if;
  select * into s from public.employee_sensitive where employee_id = p_employee;
  select coalesce(p.code::text, '') in (select jsonb_array_elements_text(coalesce((select value from public.system_settings where key = 'hr.admin_positions'), '[]')))
    into v_admin from public.positions p where p.id = e.position_id;

  if coalesce(trim(e.full_name), '') = '' then v := v || 'full_name'::text; end if;
  if e.mobile is null then v := v || 'mobile'::text; end if;
  if e.hub_id is null and e.zone_id is null then v := v || 'hub'::text; end if;
  if e.position_id is null then v := v || 'position'::text; end if;
  if coalesce(v_admin, false) and e.email is null then v := v || 'email'::text; end if;
  if s.date_of_birth is null then v := v || 'date_of_birth'::text; end if;
  if coalesce(trim(s.permanent_address), '') = '' then v := v || 'permanent_address'::text; end if;
  if coalesce(trim(s.nid_number), '') = '' then v := v || 'nid_number'::text; end if;
  if e.referred_by_employee_id is null and coalesce(trim(e.reference_info), '') = ''
     and coalesce(e.reference_manual, '{}'::jsonb) in ('{}'::jsonb, 'null'::jsonb) then
    v := v || 'reference'::text;
  end if;
  if not exists (select 1 from public.employee_compensation c where c.employee_id = p_employee and c.status in ('pending','approved')) then
    v := v || 'basic_salary'::text;
  end if;
  for d in select jsonb_array_elements_text(value) from public.system_settings where key = 'hr.required_documents' loop
    if not exists (select 1 from public.employee_documents x where x.employee_id = p_employee and x.doc_type = d and x.archived_at is null) then
      v := v || ('document:' || d);
    end if;
  end loop;
  select v || coalesce(array_agg('field:' || f.code::text order by f.sort_order), '{}') into v
  from public.employee_custom_fields f
  where f.is_required and f.archived_at is null and f.zone_id is null
    and not exists (select 1 from public.employee_custom_field_values cv
                    where cv.field_id = f.id and cv.employee_id = p_employee and cv.value is not null and cv.value <> '""'::jsonb);
  return v;
end $$;
revoke all on function private.hr_id_gaps(uuid) from public, anon;
grant execute on function private.hr_id_gaps(uuid) to authenticated;

create or replace function private.hr_id_check_count() returns integer
language sql stable security definer set search_path = '' as $$
  select 11 + coalesce((select jsonb_array_length(value) from public.system_settings where key = 'hr.required_documents'), 0)
            + (select count(*)::int from public.employee_custom_fields f where f.is_required and f.archived_at is null and f.zone_id is null)
$$;
revoke all on function private.hr_id_check_count() from public, anon;
grant execute on function private.hr_id_check_count() to authenticated;

-- One line per person the caller may see: who they are and what is missing.
create or replace function public.hr_profile_gaps(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, status text, hub_id uuid, hub_name text,
               position_name text, position_name_bn text, missing text[], total_checks integer)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.status, e.hub_id, h.name, p.name, p.name_bn,
         private.hr_id_gaps(e.id), private.hr_id_check_count()
  from public.employees e
  left join public.hubs h on h.id = e.hub_id
  left join public.positions p on p.id = e.position_id
  where e.archived_at is null and e.status in ('active', 'applicant')
    and (p_zone is null or e.zone_id = p_zone) and (p_hub is null or e.hub_id = p_hub)
  order by h.name nulls last, cardinality(private.hr_id_gaps(e.id)) desc, e.full_name
$$;
revoke all on function public.hr_profile_gaps(uuid, uuid) from public, anon;
grant execute on function public.hr_profile_gaps(uuid, uuid) to authenticated;

-- The HR dashboard's count uses the same check.
create or replace function public.hr_missing_information(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, missing text[])
language sql stable set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.hub_id, private.hr_id_gaps(e.id)
  from public.employees e
  where e.status = 'active' and e.archived_at is null
    and (p_zone is null or e.zone_id = p_zone) and (p_hub is null or e.hub_id = p_hub)
$$;

-- New ID applications need the same as the format.
create or replace function public.hr_application_missing_fields(p_employee uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees%rowtype; v text[];
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if not (private.employee_has_permission('hr.application.view', p_employee)
          or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  v := private.hr_id_gaps(p_employee);
  if e.department_id is null then v := v || 'department'::text; end if;
  if e.joining_date is null then v := v || 'joining_date'::text; end if;
  if e.emergency_contact_phone is null then v := v || 'emergency_contact'::text; end if;
  if e.reporting_manager_id is null and exists (
       select 1 from public.employees m
       where m.status = 'active' and m.id <> e.id and m.archived_at is null
         and m.zone_id = coalesce(e.zone_id, private.hub_zone(e.hub_id))) then
    v := v || 'reporting_manager'::text;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 5. Positions: aliases, Bangla names, order, one Assistant Manager
-- ---------------------------------------------------------------------
alter table public.positions add column if not exists aliases text[] not null default '{}';
alter table public.positions add column if not exists sort_order integer not null default 100;

create or replace function private.norm_name(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9ঀ-৿]+', '', 'g')
$$;

create or replace function private.find_position(p_code text, p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.positions x
   where x.archived_at is null
     and ((p_code is not null and x.code = trim(p_code)::extensions.citext)
       or (p_code is null and p_name is not null and (
             private.norm_name(x.name) = private.norm_name(p_name)
          or trim(x.name_bn) = trim(p_name)
          or exists (select 1 from unnest(x.aliases) a where private.norm_name(a) = private.norm_name(p_name)))))
   order by x.sort_order, x.created_at limit 1
$$;

do $$
declare v_keep uuid; v_drop uuid; r record;
begin
  -- Bangla names, level and order (only where the post exists)
  update public.positions set name_bn = 'জোনাল ম্যানেজার', level = 'zone', sort_order = 10 where code = 'ZONALMANAGER';
  update public.positions set name_bn = 'ম্যানেজার',         sort_order = 20 where code = 'MANAGER';
  update public.positions set name_bn = 'সহকারী ম্যানেজার', sort_order = 30 where code = 'ASSISTANTMAN';
  update public.positions set name_bn = 'হাব সিসি',          sort_order = 40 where code = 'HUBCC';
  update public.positions set name_bn = 'ডাটা এন্ট্রি',      sort_order = 50 where code = 'DATAENTRY';
  update public.positions set name_bn = 'কমিশন রাইডার',     sort_order = 60 where code = 'COMMISSIONRI';
  update public.positions set name = 'Sorting + Loader', name_bn = 'সর্টিং + লোডার',
         aliases = array['Shorting+Loader', 'Sorting Loader', 'Loader'], sort_order = 70 where code = 'SHORTINGLOAD';
  update public.positions set name_bn = 'ড্রাইভার',          sort_order = 80 where code = 'DRIVER';
  update public.positions set name_bn = 'অটো ড্রাইভার',      sort_order = 85 where code = 'AUTODRIVER';
  update public.positions set name_bn = 'হেল্পার',           sort_order = 90 where code = 'HELPER';
  update public.positions set name_bn = 'সিকিউরিটি গার্ড',   sort_order = 95 where code = 'SECURITYGUAR';

  -- "Asst. Manager" is the same post as "Assistant Manager": one post, history kept
  select id into v_keep from public.positions where code = 'ASSISTANTMAN' and archived_at is null;
  select id into v_drop from public.positions where code = 'ASSTMANAGER' and archived_at is null;
  if v_keep is not null and v_drop is not null then
    update public.positions set aliases = array['Asst. Manager', 'Asst Manager', 'AM'] where id = v_keep;
    for r in select id, department_id, zone_id, hub_id, reporting_manager_id from public.employees where position_id = v_drop loop
      update public.employee_assignments set effective_to = greatest(effective_from, current_date - 1)
       where employee_id = r.id and effective_to is null;
      insert into public.employee_assignments (employee_id, change_type, department_id, position_id, zone_id, hub_id,
                                               reporting_manager_id, effective_from, reason)
      values (r.id, 'correction', r.department_id, v_keep, r.zone_id, r.hub_id, r.reporting_manager_id, current_date,
              'পদবি একত্র: Asst. Manager → Assistant Manager');
      update public.employees set position_id = v_keep where id = r.id;
    end loop;
    update public.referral_prospects set position_id = v_keep where position_id = v_drop;
    update public.job_duties set position_id = v_keep where position_id = v_drop;
    update public.positions set status = 'inactive', archived_at = now(),
           archive_reason = 'Merged into Assistant Manager (same post)' where id = v_drop;
  end if;
end $$;
