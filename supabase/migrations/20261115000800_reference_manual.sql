-- =====================================================================
--  Reference (who brought an employee): a person in the system, OR a
--  manually written person (outside / not in the system).
--  * employees.reference_manual jsonb {name, code, hub, position, mobile}
--  * hr_set_reference(employee, referrer uuid, manual jsonb): one of the two, or clear
--  * hr_reference_of(employee): what is set, with hub and post names
-- =====================================================================

alter table public.employees add column if not exists reference_manual jsonb
  check (reference_manual is null or jsonb_typeof(reference_manual) = 'object');

create or replace function public.hr_set_reference(p_employee uuid, p_referrer uuid, p_manual jsonb default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_manual jsonb;
begin
  if not (private.employee_has_permission('hr.referral.edit', p_employee)
          or private.employee_has_permission('hr.employee.edit', p_employee)
          or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised to change the referrer.' using errcode = '42501';
  end if;
  if p_referrer is not null then
    if p_referrer = p_employee then raise exception 'Employee cannot refer themselves.' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.employees where id = p_referrer and archived_at is null) then
      raise exception 'Unknown reference ID.' using errcode = 'P0001';
    end if;
  elsif p_manual is not null then
    v_manual := jsonb_strip_nulls(jsonb_build_object(
      'name', nullif(trim(p_manual->>'name'), ''), 'code', nullif(trim(p_manual->>'code'), ''),
      'hub', nullif(trim(p_manual->>'hub'), ''), 'position', nullif(trim(p_manual->>'position'), ''),
      'mobile', nullif(trim(p_manual->>'mobile'), '')));
    if coalesce(v_manual->>'name', '') = '' then raise exception 'রেফারেন্সের নাম দিন' using errcode = '22023'; end if;
  end if;
  perform set_config('app.change_reason', 'Reference set', true);
  update public.employees set referred_by_employee_id = p_referrer,
    reference_manual = case when p_referrer is null then v_manual else null end
  where id = p_employee;
end $$;

create or replace function public.hr_reference_of(p_employee uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when r.id is not null then jsonb_build_object('kind', 'employee', 'id', r.id, 'code', r.employee_code::text, 'name', r.full_name,
      'hub', h.name, 'hub_code', h.code::text, 'position', p.name, 'mobile', r.mobile)
    when e.reference_manual is not null then e.reference_manual || jsonb_build_object('kind', 'manual')
    else null end
  from public.employees e
  left join public.employees r on r.id = e.referred_by_employee_id
  left join public.hubs h on h.id = r.hub_id
  left join public.positions p on p.id = r.position_id
  where e.id = p_employee
    and (private.is_self_employee(p_employee) or private.employee_has_permission('hr.employee.view', p_employee)
         or private.employee_has_permission('hr.referral.view', p_employee) or private.is_open_draft_of_caller(p_employee))
$$;

revoke all on function public.hr_set_reference(uuid, uuid, jsonb) from public, anon;
revoke all on function public.hr_reference_of(uuid) from public, anon;
grant execute on function public.hr_set_reference(uuid, uuid, jsonb) to authenticated;
grant execute on function public.hr_reference_of(uuid) to authenticated;
