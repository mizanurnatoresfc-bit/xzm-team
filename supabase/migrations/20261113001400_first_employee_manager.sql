-- The first employees of a new zone have nobody to report to yet, so the
-- "reporting manager" field is required only when the zone already has an active employee.
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
  -- A reporting manager is required only once the zone has someone to report to
  -- (the very first employees of a new zone cannot name one).
  if e.reporting_manager_id is null and exists (
       select 1 from public.employees m
       where m.status = 'active' and m.id <> e.id and m.archived_at is null
         and m.zone_id = coalesce(e.zone_id, private.hub_zone(e.hub_id))) then
    v := array_append(v, 'reporting_manager'::text);
  end if;
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
