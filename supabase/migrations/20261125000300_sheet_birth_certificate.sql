-- =====================================================================
-- XZM-TEAM ERP — company sheets: the birth certificate picture
--
-- Owner (25 Nov): the ID Create sheet has "NID / Birth Certificate", so a person who gave a birth certificate
-- instead of the NID card must show up there too.
--
--  1. hr_sheet_people: the "doc:birth_certificate" flag follows the NID rule (hr.employee_sensitive.view),
--     not the ordinary document rule. (Body otherwise as in 20261121000500.)
--  2. The ID Create sheet gets a "Birth Certificate Picture" column after "NID Back Picture" — only if the
--     company has not already put one there; every other column and width is left as the company has it.
-- =====================================================================

-- 1 -------------------------------------------------------------------
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
                 and private.has_permission(case when dc.doc_type in ('nid_front', 'nid_back', 'birth_certificate') then 'hr.employee_sensitive.view' else 'hr.document.view' end,
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


-- 2 -------------------------------------------------------------------
update public.company_sheets s
   set columns = (
     select jsonb_agg(x.col order by x.ord)
       from (
         select c.col, c.ord * 2 as ord from jsonb_array_elements(s.columns) with ordinality c(col, ord)
         union all
         select '{"head":"Birth Certificate Picture","src":"doc:birth_certificate","w":25}'::jsonb,
                (select min(c.ord) * 2 + 1 from jsonb_array_elements(s.columns) with ordinality c(col, ord)
                  where c.col ->> 'src' = 'doc:nid_back')
       ) x
      where x.ord is not null)
 where s.source = 'staff' and s.archived_at is null and s.name ilike '%creat%'
   and exists (select 1 from jsonb_array_elements(s.columns) c where c ->> 'src' = 'doc:nid_back')
   and not exists (select 1 from jsonb_array_elements(s.columns) c where c ->> 'src' = 'doc:birth_certificate');
