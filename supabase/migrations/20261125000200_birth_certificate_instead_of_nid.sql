-- =====================================================================
-- XZM-TEAM ERP — Birth Certificate in place of NID front / back
--
-- Owner (25 Nov): "প্রোফাইল এ NID back end front end যদি না থাকে Birth Certificate আপ্লোড করার ব্যবস্থা আছে!"
--   Someone without a national ID card (a young rider, say) can give a birth certificate instead.
--
--  1. A new paper type 'birth_certificate'. It is identity paper like the NID images: only people with
--     hr.employee_sensitive.view (and the person themself) can open it. Staff may upload their own.
--  2. The profile check (private.hr_id_gaps, which feeds hr_profile_gaps / my_profile_gaps / hr_missing_information /
--     the ID application) no longer asks for NID front / back once a birth certificate is on file.
--     The same for the zonal "data completion" list.
--  The NID/birth-certificate NUMBER stays one field (nid_number) — the ID Create sheet already calls it
--  "NID/ Birth Certificate Number".
-- =====================================================================

-- 1 -------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.employee_documents'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%doc_type%' loop
    execute format('alter table public.employee_documents drop constraint %I', c.conname);
  end loop;
  alter table public.employee_documents add constraint employee_documents_doc_type_check check (doc_type in
    ('nid_front','nid_back','birth_certificate','photo','signature','cv','experience_certificate','education','other'));
end $$;

alter policy documents_read on public.employee_documents
  using (private.is_self_employee(employee_id)
         or private.is_open_draft_of_caller(employee_id)
         or (doc_type in ('nid_front','nid_back','birth_certificate')
             and private.employee_has_permission('hr.employee_sensitive.view', employee_id))
         or (doc_type not in ('nid_front','nid_back','birth_certificate')
             and private.employee_has_permission('hr.document.view', employee_id)));

alter policy documents_insert on public.employee_documents
  with check (verified_by is null and archived_at is null
              and (private.employee_has_permission('hr.document.create', employee_id)
                   or private.is_open_draft_of_caller(employee_id)
                   or (private.is_self_employee(employee_id)
                       and doc_type in ('photo', 'nid_front', 'nid_back', 'birth_certificate', 'signature'))));

create or replace function private.can_read_employee_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_documents d
    where d.storage_path = p_name and d.archived_at is null
      and (private.is_self_employee(d.employee_id)
           or private.is_open_draft_of_caller(d.employee_id)
           or (d.doc_type in ('nid_front','nid_back','birth_certificate')
               and private.employee_has_permission('hr.employee_sensitive.view', d.employee_id))
           or (d.doc_type not in ('nid_front','nid_back','birth_certificate')
               and private.employee_has_permission('hr.document.view', d.employee_id))))
$$;

-- 2 -------------------------------------------------------------------
-- Same body as 20261115001500; only the document loop changed: NID front / back are not asked for when a birth
-- certificate is on file.
create or replace function private.hr_id_gaps(p_employee uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype; s public.employee_sensitive%rowtype; v text[] := '{}'; d text;
  v_admin boolean; v_birth boolean;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then return null; end if;
  select * into s from public.employee_sensitive where employee_id = p_employee;
  select coalesce(p.code::text, '') in (select jsonb_array_elements_text(coalesce((select value from public.system_settings where key = 'hr.admin_positions'), '[]')))
    into v_admin from public.positions p where p.id = e.position_id;
  select exists (select 1 from public.employee_documents x
                  where x.employee_id = p_employee and x.doc_type = 'birth_certificate' and x.archived_at is null) into v_birth;

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
    if v_birth and d in ('nid_front', 'nid_back') then continue; end if;
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

-- The zonal manager's data-completion list: same rule.
create or replace function public.zm_data_completion(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, hub_name text,
               missing text[], total_checks integer, completion_pct numeric)
language sql stable security definer set search_path = '' as $$
  with req_docs as (
    select distinct q.doc_type from (
      select unnest(array['photo','nid_front','nid_back','signature','cv']::text[]) as doc_type
      union all
      select jsonb_array_elements_text(s.value) from public.system_settings s where s.key = 'hr.required_documents'
    ) q
  ),
  req_fields as (
    select f.id, f.code::text as code, f.sort_order
    from public.employee_custom_fields f where f.is_required and f.archived_at is null
  ),
  totals as (
    select (4 + (select count(*) from req_docs) + (select count(*) from req_fields))::integer as n
  ),
  base as (
    select e.id, e.employee_code::text as code, e.full_name, e.hub_id, h.name as hub_name,
      array_remove(array[
        case when e.mobile is null then 'mobile'::text end,
        case when e.joining_date is null then 'joining_date'::text end,
        case when e.position_id is null then 'position'::text end,
        case when e.hub_id is null then 'hub'::text end
      ], null)
      || coalesce((select array_agg(r.doc_type order by r.doc_type) from req_docs r
                   where not exists (select 1 from public.employee_documents d
                                     where d.employee_id = e.id and d.doc_type = r.doc_type and d.archived_at is null)
                     and not (r.doc_type in ('nid_front', 'nid_back')
                              and exists (select 1 from public.employee_documents b
                                           where b.employee_id = e.id and b.doc_type = 'birth_certificate' and b.archived_at is null))),
                  '{}'::text[])
      || coalesce((select array_agg('field:' || f.code order by f.sort_order) from req_fields f
                   where not exists (select 1 from public.employee_custom_field_values v
                                     where v.field_id = f.id and v.employee_id = e.id)),
                  '{}'::text[]) as missing
    from public.employees e
    left join public.hubs h on h.id = e.hub_id
    where e.status = 'active' and e.archived_at is null
      and (p_zone is null or e.zone_id = p_zone)
      and (p_hub is null or e.hub_id = p_hub)
      and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  )
  select b.id, b.code, b.full_name, b.hub_id, b.hub_name, b.missing, t.n,
         round(100.0 * (t.n - cardinality(b.missing)) / t.n, 1)
  from base b cross join totals t
  order by cardinality(b.missing) desc, b.full_name
$$;
