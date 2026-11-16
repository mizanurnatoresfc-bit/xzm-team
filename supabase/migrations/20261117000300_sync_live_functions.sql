-- =====================================================================
--  Live and repository made the same (17 Nov 2026).
--  These 19 functions were changed on the live database outside the
--  repository's migrations (or, for fleet_post / fleet_vehicle_save /
--  push_kick, applied without their comments). Their live definitions are
--  copied here as they are, so a database built from the repository ends up
--  exactly like the live one. Applying this to live changes nothing.
-- =====================================================================

CREATE OR REPLACE FUNCTION private.att_notify_hub(p_hub uuid, p_title text, p_body text, p_link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_zone uuid; u uuid;
begin
  select h.zone_id into v_zone from public.hubs h where h.id = p_hub;
  for u in
    select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
    where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
      and p.code = 'hr.attendance.create'
      and ((ur.scope_type = 'hub' and ur.hub_id = p_hub) or (ur.scope_type = 'zone' and ur.zone_id = v_zone))
  loop
    perform private.notify(u, p_title, p_body, p_link, 'attendance');
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION private.da_is_bank_off(p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from jsonb_array_elements_text(coalesce(private.da_setting('da.bank_charge') -> 'off_days', '[]')) d
                 where d = extract(isodow from p_date)::int::text)
      or exists (select 1 from jsonb_array_elements_text(coalesce(private.da_setting('da.bank_charge') -> 'holidays', '[]')) h
                 where h = p_date::text)
$function$
;

CREATE OR REPLACE FUNCTION private.fleet_post(p_log uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x public.vehicle_logs; v public.vehicles; e public.employees; v_session uuid; v_date date; v_exp uuid; v_cat text; v_name text; v_voucher text; v_role text; v_ok boolean;
begin
  select * into x from public.vehicle_logs where id = p_log and removed_at is null for update;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  if x.status <> 'approved' then raise exception 'Approve the line first.' using errcode = '22023'; end if;
  if x.da_expense_id is not null then
    return jsonb_build_object('posted', true, 'voucher', (select voucher_no from public.da_expenses where id = x.da_expense_id), 'expense', x.da_expense_id);
  end if;
  if coalesce(x.amount, 0) <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  select * into e from public.employees where id = x.driver_id;
  v_date := least(x.log_date, private.da_today());
  select id into v_session from public.da_sessions where hub_id = coalesce(x.hub_id, v.hub_id) and account_date = v_date;
  if v_session is null then v_session := public.da_start_session(coalesce(x.hub_id, v.hub_id), v_date); end if;
  v_cat := case x.kind when 'khoraki' then 'meal' when 'fuel' then 'fuel' when 'charge' then 'fuel' when 'parts' then 'vehicle_parts' when 'tyre' then 'vehicle_parts'
                       when 'toll' then 'toll' when 'fine' then 'penalties' when 'service' then 'repair' when 'repair' then 'repair' when 'oil' then 'repair' else 'transport' end;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = v_cat) then
    v_cat := case when exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = 'transport') then 'transport' else 'other' end;
  end if;
  select a.role into v_role from public.vehicle_assignments a where a.vehicle_id = v.id and a.employee_id = x.driver_id order by a.effective_from desc limit 1;
  v_name := case x.kind when 'khoraki' then 'খোরাকি — ' || case v_role when 'helper' then 'হেল্পার' else 'ড্রাইভার' end
                        when 'fuel' then 'তেল' when 'charge' then 'গ্যারেজ চার্জ' when 'service' then 'সার্ভিসিং' when 'repair' then 'মেরামত' when 'parts' then 'পার্টস'
                        when 'tyre' then 'টায়ার' when 'oil' then 'ইঞ্জিন অয়েল' when 'toll' then 'টোল' when 'fine' then 'জরিমানা' else 'গাড়ির খরচ' end
            || ' — ' || v.name || coalesce(' (' || v.reg_no || ')', '');
  v_ok := coalesce(e.id is not null and private.da_employee_ok(e.id, coalesce(x.hub_id, v.hub_id)), false);
  if not v_ok and e.id is not null then v_name := v_name || ' — ' || e.full_name || coalesce(' (' || e.employee_code || ')', ''); end if;
  v_exp := public.da_save_expense(v_session, case when x.kind = 'khoraki' and v_ok then 'employee' else 'transport' end,
             case when v_ok then e.employee_code::text end, v_name, v_cat, x.amount, v_date,
             x.bill_no, null, null, null, null, false, null,
             concat_ws(' · ', nullif(x.vendor, ''), case when x.litres is not null then x.litres::text || ' L' end, x.note,
                       case when x.slip_path is not null then 'স্লিপ: গাড়ির পাতায়' end), null);
  perform public.da_set_expense_reference(v_exp, null, null, null, v.id);
  update public.vehicle_logs set da_expense_id = v_exp where id = p_log;
  if nullif(trim(coalesce(x.bill_no, '')), '') is null then v_voucher := public.da_make_voucher(v_exp); end if;
  return jsonb_build_object('posted', true, 'voucher', v_voucher, 'expense', v_exp);
end $function$
;

CREATE OR REPLACE FUNCTION private.format_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if new.is_default and new.archived_at is null then
    update public.employee_formats
       set is_default = false
     where id <> new.id and is_default
       and zone_id is not distinct from new.zone_id
       and purpose = new.purpose;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.guard_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.id <> old.id then
    raise exception 'Profile id cannot be changed.' using errcode = 'P0001';
  end if;
  if auth.uid() is null then return new; end if;
  if current_user not in ('authenticated','anon') then return new; end if;
  if (new.status, new.failed_login_count, new.locked_until, new.archived_at, new.email, new.last_login_at, new.must_change_password)
     is distinct from
     (old.status, old.failed_login_count, old.locked_until, old.archived_at, old.email, old.last_login_at, old.must_change_password)
     and not private.can_manage_user(new.id) then
    raise exception 'Not authorised to change account status fields.' using errcode = '42501';
  end if;
  if new.id = auth.uid() and new.status <> old.status then
    raise exception 'Users cannot change their own account status.' using errcode = '42501';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.push_kick()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from pg_namespace where nspname = 'net')
     and exists (select 1 from public.push_devices d where d.profile_id = new.profile_id and d.disabled_at is null) then
    execute $q$select net.http_post(url := $1, body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 5000)$q$
      using 'https://ndgnhvbpmtxrpplgsslz.supabase.co/functions/v1/push-send';
  end if;
  return null;
exception when others then
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.att_self_decide(p_ids uuid[], p_ok boolean, p_as text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.attendance_self_marks; v_as text; v_rec uuid; v_n integer := 0; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_word text; v_prof uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not p_ok and v_note is null then raise exception 'Write why it is turned down' using errcode = '22023'; end if;
  if p_as is not null and p_as not in ('present','late','half_day','absent') then raise exception 'Unknown attendance status' using errcode = '22023'; end if;
  for m in select * from public.attendance_self_marks x where x.id = any(coalesce(p_ids, '{}')) and x.status = 'waiting' for update loop
    if not private.employee_has_permission('hr.attendance.create', m.employee_id) then
      raise exception 'You may not approve attendance for this person' using errcode = '42501';
    end if;
    if exists (select 1 from public.employees e where e.id = m.employee_id and e.profile_id = auth.uid()) then
      raise exception 'Your own attendance is approved by another manager' using errcode = '42501';
    end if;
    if p_ok then
      v_as := coalesce(p_as, case m.kind when 'present' then 'present' else 'absent' end);
      select a.id into v_rec from public.attendance_records a where a.employee_id = m.employee_id and a.work_date = m.work_date;
      if v_rec is null then
        insert into public.attendance_records (employee_id, work_date, status, check_in, source, note)
        values (m.employee_id, m.work_date, v_as, case when v_as = 'absent' then null else m.marked_at end, 'self',
                coalesce(m.note, 'নিজে দিয়েছেন'))
        returning id into v_rec;
      elsif private.employee_has_permission('hr.attendance.edit', m.employee_id) then
        update public.attendance_records set status = v_as, check_in = case when v_as = 'absent' then null else m.marked_at end,
               source = 'self', note = coalesce(m.note, note) where id = v_rec;
      else
        select a.status into v_as from public.attendance_records a where a.id = v_rec;
      end if;
      update public.attendance_self_marks set status = 'approved', decided_as = v_as, decided_by = auth.uid(), decided_at = now(),
             decide_note = v_note, attendance_id = v_rec where id = m.id;
      v_word := case v_as when 'present' then 'উপস্থিত' when 'late' then 'দেরিতে' when 'half_day' then 'অর্ধদিবস' else 'অনুপস্থিত' end;
    else
      update public.attendance_self_marks set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decide_note = v_note where id = m.id;
    end if;
    select e.profile_id into v_prof from public.employees e where e.id = m.employee_id;
    perform private.notify(v_prof,
      case when p_ok then 'হাজিরা অনুমোদিত: ' || v_word else 'হাজিরা ফেরত দেওয়া হয়েছে' end,
      case when p_ok then coalesce('মন্তব্য: ' || v_note, private.my_display_name() || ' অনুমোদন দিয়েছেন') else 'কারণ: ' || v_note end,
      '/app/staff', 'attendance');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.fleet_vehicle_save(p_name text, p_reg_no text, p_kind text, p_hub uuid, p_status text DEFAULT 'active'::text, p_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_zone uuid := private.hub_zone(p_hub); v_id uuid; v public.vehicles; r text;
begin
  if v_zone is null then raise exception 'Choose the hub the vehicle is given to.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Write the vehicle''s name.' using errcode = '22023'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.fleet_setting() -> 'kinds', '[]')) k where k ->> 'code' = p_kind) then
    raise exception 'Unknown kind of vehicle.' using errcode = '22023';
  end if;
  if coalesce(p_status, 'active') not in ('active', 'inactive', 'workshop', 'off_road') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_id is null then
    if not private.has_permission('vehicle.vehicle.create', v_zone, p_hub) then raise exception 'Not authorised to add vehicles.' using errcode = '42501'; end if;
    insert into public.vehicles (code, name, kind, reg_no, zone_id, hub_id, status)
    values (('G-' || lpad(nextval('public.vehicle_fleet_code_seq')::text, 4, '0'))::extensions.citext, trim(p_name), p_kind,
            nullif(trim(p_reg_no), ''), v_zone, p_hub, coalesce(p_status, 'active'))
    returning id into v_id;
  else
    select * into v from public.vehicles where id = p_id and archived_at is null for update;
    if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
    if not (private.has_permission('vehicle.vehicle.edit', v.zone_id, v.hub_id) and private.has_permission('vehicle.vehicle.edit', v_zone, p_hub)) then
      raise exception 'Not authorised to change this vehicle or give it to that hub.' using errcode = '42501';
    end if;
    update public.vehicles set name = trim(p_name), reg_no = nullif(trim(p_reg_no), ''), kind = p_kind, zone_id = v_zone, hub_id = p_hub,
           status = coalesce(p_status, status)
     where id = p_id returning id into v_id;
    if not ('helper' = any (private.fleet_crew_roles(p_kind))) then
      update public.vehicle_assignments set effective_to = current_date, end_reason = 'এই ধরনের গাড়িতে হেল্পার নেই'
       where vehicle_id = p_id and role = 'helper' and effective_to is null;
    end if;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.hr_change_register(p_zone uuid, p_from date, p_to date)
 RETURNS TABLE(source text, kind text, event_date date, employee_id uuid, employee_code text, full_name text, mobile text, position_name text, from_hub text, to_hub text, from_status text, to_status text, reason text, request_no text, request_status text, reference text, done_by text, recorded_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'system', a.change_type, a.effective_from, e.id, e.employee_code::text, e.full_name, e.mobile,
         coalesce(po.name_bn, po.name), ph.name, h.name, null::text, null::text, a.reason, null::text, null::text, null::text,
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = a.created_by limit 1),
         a.created_at
    from public.employee_assignments a
    join public.employees e on e.id = a.employee_id
    left join public.positions po on po.id = a.position_id
    left join public.hubs h on h.id = a.hub_id
    left join lateral (select p.hub_id from public.employee_assignments p where p.employee_id = a.employee_id and p.id <> a.id
                         and p.effective_to is not null and p.effective_from <= a.effective_from
                       order by p.effective_to desc, p.effective_from desc limit 1) prev on true
    left join public.hubs ph on ph.id = prev.hub_id
   where a.change_type in ('transfer','promotion','correction')
     and a.effective_from between p_from and p_to
     and (p_zone is null or a.zone_id = p_zone or e.zone_id = p_zone)
     and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  union all
  select 'system', 'status', (l.occurred_at at time zone 'Asia/Dhaka')::date, e.id, e.employee_code::text, e.full_name, e.mobile,
         coalesce(po.name_bn, po.name), h.name, null, l.old_data ->> 'status', l.new_data ->> 'status', l.reason, null, null, null,
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = l.actor_id limit 1),
         l.occurred_at
    from public.audit_logs l
    join public.employees e on e.id::text = l.record_id
    left join public.positions po on po.id = e.position_id
    left join public.hubs h on h.id = e.hub_id
   where l.table_name = 'employees' and 'status' = any(l.changed_fields)
     and coalesce(l.old_data ->> 'status', '') <> 'applicant'
     and (l.occurred_at at time zone 'Asia/Dhaka')::date between p_from and p_to
     and (p_zone is null or e.zone_id = p_zone)
     and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  union all
  select 'request', r.kind, coalesce(nullif(r.data ->> 'effective_date', '')::date, nullif(r.data ->> 'last_date', '')::date, (r.created_at at time zone 'Asia/Dhaka')::date),
         e.id, coalesce(e.employee_code::text, r.data ->> 'employee_code'), coalesce(e.full_name, r.data ->> 'full_name'), coalesce(e.mobile, r.data ->> 'mobile'),
         coalesce(po.name_bn, po.name, r.data ->> 'position'), coalesce(h.name, r.data ->> 'from_hub', r.data ->> 'hub'),
         coalesce(th.name, case when r.data ->> 'to_hub' !~ '^[0-9a-f-]{36}$' then r.data ->> 'to_hub' end),
         null, null, coalesce(r.data ->> 'reason', r.data ->> 'reason_type', r.note), r.request_no, r.status,
         nullif(concat_ws(' ', r.ref_name, '(' || r.ref_code || ')'), ''),
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = r.submitted_by limit 1),
         r.created_at
    from public.hr_requests r
    left join public.employees e on e.id = r.employee_id
    left join public.positions po on po.id = e.position_id
    left join public.hubs h on h.id = coalesce(e.hub_id, r.hub_id)
    left join public.hubs th on th.id::text = r.data ->> 'to_hub'
   where r.kind in ('id_transfer','id_active','id_inactive','id_create') and r.status <> 'cancelled'
     and (r.created_at at time zone 'Asia/Dhaka')::date between p_from and p_to
     and (p_zone is null or r.zone_id = p_zone)
     and private.has_permission('hr.request.view', r.zone_id, r.hub_id)
  order by 18 desc
$function$
;

CREATE OR REPLACE FUNCTION public.hr_commit_import(p_batch uuid, p_skip_invalid boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  update public.employees e
     set referred_by_employee_id = ref.id
    from public.employee_import_rows ir
    join public.employees ref on ref.employee_code = upper(ir.data ->> 'reference_code')::extensions.citext
   where ir.batch_id = p_batch and ir.status = 'imported' and ir.employee_id = e.id and ref.id <> e.id;

  update public.employee_import_rows set status = 'skipped' where batch_id = p_batch and status = 'error';
  update public.employee_import_batches set status = 'committed', committed_by = auth.uid(), committed_at = now() where id = p_batch;
  return jsonb_build_object('activated', n_active, 'awaiting_employee_id', n_app, 'skipped', b.error_rows);
end $function$
;

CREATE OR REPLACE FUNCTION public.hr_validate_import(p_batch uuid, p_mapping jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    for cf in select x.key as col, substr(x.value, 4) as code from jsonb_each_text(p_mapping) x where x.value like 'cf:%' loop
      t := m ->> ('cf:' || cf.code);
      if t is not null then
        cv := private.import_custom_value((select c.id from public.employee_custom_fields c where c.code = cf.code::extensions.citext), t);
        if cv is null then errs := array_append(errs, 'Invalid value for ' || cf.col);
        else m := jsonb_set(m, array['cf:' || cf.code], cv); end if;
      end if;
    end loop;

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
end $function$
;

CREATE OR REPLACE FUNCTION public.hub_import_apply(p_row uuid, p_hub uuid, p_name text DEFAULT NULL::text, p_name_bn text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.hub_import_rows;
  h public.hubs;
  v_holder public.hubs;
  v_notes text[] := '{}';
  v_id uuid;
begin
  select * into r from public.hub_import_rows where id = p_row for update;
  if not found then raise exception 'ইমপোর্ট লাইন পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if r.applied_at is not null then raise exception 'এই লাইন আগেই বসানো হয়েছে' using errcode = 'P0001'; end if;
  perform set_config('app.change_reason', 'Hub list import ' || r.batch || ' #' || r.code, true);

  if p_hub is not null then
    select * into h from public.hubs where id = p_hub for update;
    if not found or h.archived_at is not null then raise exception 'চালু হাব বেছে নিন' using errcode = 'P0001'; end if;
    if not private.has_permission('org.hub.edit', h.zone_id, h.id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if h.code::text ~ '^\d+$' and h.code::text <> r.code then
      raise exception 'এই হাবের আগে থেকেই কোড #% আছে', h.code using errcode = 'P0001';
    end if;
    if h.code::text <> r.code then
      select * into v_holder from public.hubs where code = r.code::extensions.citext and id <> h.id;
      if found then
        if v_holder.archived_at is null then
          raise exception 'কোড #% আরেকটি চালু হাবে (%) আছে', r.code, v_holder.name using errcode = 'P0001';
        end if;
        update public.hubs set code = (r.code || '-OLD')::extensions.citext where id = v_holder.id;
        v_notes := v_notes || ('পুরোনো আর্কাইভ হাবের কোড ' || r.code || '-OLD করা হলো');
        h.name_bn := coalesce(h.name_bn, v_holder.name_bn);
        h.address := coalesce(h.address, v_holder.address);
      end if;
    end if;
    if h.phone is not null and r.phone is not null and h.phone <> r.phone then v_notes := v_notes || ('ফোন আলাদা: সিস্টেমে ' || h.phone || ', তালিকায় ' || r.phone); end if;
    if h.latitude is not null and (h.latitude <> r.latitude or h.longitude <> r.longitude) then v_notes := v_notes || 'GPS আলাদা — সিস্টেমেরটা রাখা হলো'; end if;
    update public.hubs set code = r.code::extensions.citext,
      name_bn = h.name_bn,
      phone = coalesce(h.phone, r.phone),
      address = coalesce(h.address, r.address),
      latitude = coalesce(h.latitude, r.latitude),
      longitude = coalesce(h.longitude, r.longitude)
    where id = h.id;
    v_id := h.id;
  else
    if coalesce(trim(p_name), '') = '' then raise exception 'নতুন হাবের নাম দিন' using errcode = '22023'; end if;
    if not private.has_permission('org.hub.create', r.zone_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    select * into v_holder from public.hubs where code = r.code::extensions.citext;
    if found then
      if v_holder.archived_at is null then raise exception 'কোড #% আরেকটি চালু হাবে (%) আছে', r.code, v_holder.name using errcode = 'P0001'; end if;
      update public.hubs set code = (r.code || '-OLD')::extensions.citext where id = v_holder.id;
      v_notes := v_notes || ('পুরোনো আর্কাইভ হাবের কোড ' || r.code || '-OLD করা হলো');
    end if;
    insert into public.hubs (zone_id, code, name, name_bn, phone, address, latitude, longitude, status)
    values (r.zone_id, r.code::extensions.citext, trim(p_name), nullif(trim(coalesce(p_name_bn, '')), ''), r.phone, r.address, r.latitude, r.longitude, 'active')
    returning id into v_id;
  end if;

  update public.hub_import_rows set applied_hub_id = v_id, applied_at = now(), applied_by = auth.uid(),
    result_note = nullif(array_to_string(v_notes, '; '), '') where id = r.id;
  return jsonb_build_object('hub_id', v_id, 'notes', to_jsonb(v_notes));
end $function$
;

CREATE OR REPLACE FUNCTION public.login_resolve(p_identifier text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id text := lower(trim(coalesce(p_identifier, '')));
  v_digits text;
  v_emails text[];
begin
  if v_id = '' then return null; end if;
  if position('@' in v_id) > 0 then return v_id; end if;
  v_digits := regexp_replace(v_id, '\D', '', 'g');
  if v_digits like '880%' and length(v_digits) = 13 then v_digits := substr(v_digits, 3); end if;
  if v_digits like '88%' and length(v_digits) = 13 then v_digits := substr(v_digits, 3); end if;

  select array_agg(distinct lower(p.email::text)) into v_emails
  from public.profiles p
  left join public.employees e on e.profile_id = p.id and e.archived_at is null
  where p.archived_at is null and p.email is not null
    and (
          lower(e.employee_code::text) = v_id
       or lower(e.employee_code::text) = regexp_replace(v_id, '^[a-z]+-', '')
       or (length(v_digits) = 11 and v_digits ~ '^01[3-9]' and (
             regexp_replace(coalesce(e.mobile, ''), '\D', '', 'g') in (v_digits, '88' || v_digits)
          or regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') in (v_digits, '88' || v_digits)))
    );
  if coalesce(array_length(v_emails, 1), 0) = 1 then return v_emails[1]; end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.role_admin_save(p_id uuid, p_name text, p_name_bn text, p_description text, p_permissions text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.roles%rowtype;
  v_id uuid;
  v_code text;
  v_unknown text;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can create roles or change their permissions.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A role name is required.' using errcode = '22023';
  end if;
  select x into v_unknown from unnest(coalesce(p_permissions, '{}')) x
   where not exists (select 1 from public.permissions p where p.code = x) limit 1;
  if v_unknown is not null then
    raise exception 'Unknown permission %.', v_unknown using errcode = '22023';
  end if;

  if p_id is null then
    v_code := nullif(regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '_', 'g'), '');
    v_code := trim(both '_' from coalesce(v_code, ''));
    if v_code = '' or v_code !~ '^[a-z]' then v_code := 'role_' || substr(md5(random()::text), 1, 6); end if;
    if exists (select 1 from public.roles where code = v_code::extensions.citext) then
      v_code := v_code || '_' || substr(md5(random()::text), 1, 4);
    end if;
    insert into public.roles (code, name, name_bn, description, is_system, is_super)
    values (v_code, trim(p_name), nullif(trim(coalesce(p_name_bn, '')), ''), nullif(trim(coalesce(p_description, '')), ''), false, false)
    returning id into v_id;
  else
    select * into r from public.roles where id = p_id for update;
    if r.id is null then raise exception 'Role not found.' using errcode = 'P0001'; end if;
    if r.is_super then
      raise exception 'The Super Admin role always has every permission and cannot be edited.' using errcode = 'P0001';
    end if;
    if r.archived_at is not null then raise exception 'Archived roles cannot be edited.' using errcode = 'P0001'; end if;
    update public.roles
       set name = trim(p_name),
           name_bn = nullif(trim(coalesce(p_name_bn, '')), ''),
           description = nullif(trim(coalesce(p_description, '')), '')
     where id = p_id;
    v_id := p_id;
  end if;

  perform set_config('app.change_reason', 'Role permissions set by Super Admin', true);
  delete from public.role_permissions rp
   where rp.role_id = v_id
     and not exists (select 1 from public.permissions p where p.id = rp.permission_id and p.code = any(coalesce(p_permissions, '{}')));
  insert into public.role_permissions (role_id, permission_id)
  select v_id, p.id from public.permissions p
   where p.code = any(coalesce(p_permissions, '{}'))
  on conflict do nothing;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.vehicle_assign(p_vehicle uuid, p_employee_code text, p_reason text, p_from date DEFAULT NULL::date, p_keep_hub boolean DEFAULT false, p_role text DEFAULT 'driver'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.vehicles; e public.employees; v_from date := coalesce(p_from, current_date); v_id uuid;
        v_emp_hub uuid; v_new_hub uuid; v_new_zone uuid; v_moved boolean := false;
begin
  if p_role not in ('driver', 'helper') then raise exception 'Role must be driver or helper.' using errcode = '22023'; end if;
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not (private.has_permission('vehicle.holder.edit', v.zone_id, v.hub_id) or private.has_permission('da.settings.configure', v.zone_id, v.hub_id)) then
    raise exception 'Not authorised to hand over a vehicle.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  select * into e from public.employees
   where employee_code = regexp_replace(trim(p_employee_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null and status = 'active';
  if e.id is null then raise exception 'No active employee with ID %.', p_employee_code using errcode = '22023'; end if;
  if exists (select 1 from public.vehicle_assignments a where a.vehicle_id = p_vehicle and a.effective_to is null and a.employee_id = e.id and a.role <> p_role) then
    raise exception '% already has this vehicle in the other role.', e.full_name using errcode = '22023';
  end if;

  v_new_hub := v.hub_id; v_new_zone := v.zone_id;
  if p_role = 'driver' then
    v_emp_hub := private.employee_current_hub(e.id);
    if not coalesce(p_keep_hub, false) and v_emp_hub is not null and v_emp_hub is distinct from v.hub_id then
      v_new_hub := v_emp_hub; v_new_zone := coalesce(private.hub_zone(v_emp_hub), v.zone_id);
      if not (private.has_permission('vehicle.holder.edit', v_new_zone, v_new_hub) or private.has_permission('da.settings.configure', v_new_zone, v_new_hub)) then
        raise exception 'The person works at another hub you may not move vehicles to.' using errcode = '42501';
      end if;
      update public.vehicles set hub_id = v_new_hub, zone_id = v_new_zone where id = p_vehicle;
      execute 'del' || 'ete from public.vehicle_hubs where vehicle_id = $1 and hub_id = $2' using p_vehicle, v_new_hub;
      v_moved := true;
    end if;
  end if;

  update public.vehicle_assignments set effective_to = v_from, end_reason = 'Handed to ' || e.full_name
   where vehicle_id = p_vehicle and effective_to is null and role = p_role;
  insert into public.vehicle_assignments (vehicle_id, employee_id, hub_id, zone_id, effective_from, reason, moved_hub, role)
  values (p_vehicle, e.id, v_new_hub, v_new_zone, v_from, trim(p_reason), v_moved, p_role)
  returning id into v_id;
  perform private.notify(e.profile_id, case when p_role = 'driver' then 'আপনার নামে গাড়ি দেওয়া হলো' else 'আপনাকে গাড়ির হেল্পার করা হলো' end,
                         v.name || coalesce(' (' || v.reg_no || ')', '') || ' · ' || trim(p_reason), '/app/vehicles/mine', 'vehicle');
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.vehicle_day_save(p_vehicle uuid, p_date date DEFAULT NULL::date, p_charged boolean DEFAULT NULL::boolean, p_charge_place text DEFAULT NULL::text, p_charge_cost numeric DEFAULT NULL::numeric, p_out time without time zone DEFAULT NULL::time without time zone, p_in time without time zone DEFAULT NULL::time without time zone, p_start_km integer DEFAULT NULL::integer, p_end_km integer DEFAULT NULL::integer, p_trips integer DEFAULT NULL::integer, p_data jsonb DEFAULT '{}'::jsonb, p_note text DEFAULT NULL::text, p_driver_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.vehicles; v_date date := coalesce(p_date, private.da_today()); v_id uuid; v_driver uuid; v_manager boolean; v_log uuid; v_status text;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  v_manager := private.has_permission('vehicle.log.create', v.zone_id, v.hub_id) or private.vehicle_served_perm(v.id, 'vehicle.log.create');
  if not (v_manager or private.vehicle_is_crew(v.id)) then raise exception 'Not authorised to write the day log.' using errcode = '42501'; end if;
  if v_date > private.da_today() then raise exception 'The date cannot be in the future.' using errcode = '22023'; end if;
  if p_start_km is not null and p_end_km is not null and p_end_km < p_start_km then raise exception 'End km cannot be less than start km.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_driver_code, '')), '') is not null then
    select id into v_driver from public.employees where employee_code = regexp_replace(trim(p_driver_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null;
    if v_driver is null then raise exception 'No employee with ID %.', p_driver_code using errcode = '22023'; end if;
  else
    v_driver := coalesce(case when not v_manager then private.my_employee_id() end, private.vehicle_holder(v.id));
  end if;
  insert into public.vehicle_day_logs (vehicle_id, hub_id, zone_id, log_date, driver_id, charged, charge_place, charge_cost, out_at, in_at, start_km, end_km, trips, data, note)
  values (p_vehicle, v.hub_id, v.zone_id, v_date, v_driver, p_charged, nullif(trim(p_charge_place), ''), p_charge_cost, p_out, p_in, p_start_km, p_end_km, p_trips, coalesce(p_data, '{}'::jsonb), nullif(trim(p_note), ''))
  on conflict (vehicle_id, log_date) do update
    set driver_id = coalesce(excluded.driver_id, public.vehicle_day_logs.driver_id), charged = excluded.charged, charge_place = excluded.charge_place, charge_cost = excluded.charge_cost,
        out_at = excluded.out_at, in_at = excluded.in_at, start_km = excluded.start_km, end_km = excluded.end_km, trips = excluded.trips, data = excluded.data, note = excluded.note
  returning id into v_id;
  if p_end_km is not null and p_end_km > v.odometer then update public.vehicles set odometer = p_end_km where id = v.id; end if;
  select id into v_log from public.vehicle_logs where day_log_id = v_id and removed_at is null;
  if coalesce(p_charge_cost, 0) > 0 then
    v_status := case when v_manager then 'approved' else 'submitted' end;
    if v_log is null then
      insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, odometer, amount, vendor, driver_id, note, status, day_log_id)
      values (p_vehicle, v.hub_id, v.zone_id, 'charge', v_date, p_end_km, p_charge_cost, nullif(trim(p_charge_place), ''), v_driver, 'দিনের খাতা থেকে', v_status, v_id)
      returning id into v_log;
      if v_status = 'submitted' then
        perform private.vehicle_notify_managers(v.id, 'vehicle.log.approve', 'অটোর চার্জ খরচ জমা পড়েছে', v.name || ' · ৳' || p_charge_cost::text || ' · ' || private.my_display_name(), '/app/vehicles/logs?v=' || v.id::text);
      end if;
    else
      update public.vehicle_logs set amount = p_charge_cost, vendor = nullif(trim(p_charge_place), ''), odometer = p_end_km, log_date = v_date
       where id = v_log and da_expense_id is null;
    end if;
  elsif v_log is not null then
    update public.vehicle_logs set removed_at = now(), removed_by = auth.uid(), remove_reason = 'দিনের খাতা থেকে চার্জ খরচ সরানো হলো' where id = v_log and da_expense_id is null;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.vehicle_log_save(p_vehicle uuid, p_kind text, p_amount numeric, p_date date DEFAULT NULL::date, p_odometer integer DEFAULT NULL::integer, p_litres numeric DEFAULT NULL::numeric, p_vendor text DEFAULT NULL::text, p_bill_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_driver_code text DEFAULT NULL::text, p_da_expense uuid DEFAULT NULL::uuid, p_id uuid DEFAULT NULL::uuid, p_slip text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.vehicles; v_id uuid; v_driver uuid; v_me uuid := private.my_employee_id(); x public.vehicle_logs;
        v_manager boolean; v_status text;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if p_kind not in ('fuel', 'charge', 'service', 'repair', 'parts', 'tyre', 'oil', 'wash', 'toll', 'parking', 'fine', 'rent', 'paper', 'other') then
    raise exception 'Unknown kind of cost.' using errcode = '22023';
  end if;
  v_manager := private.has_permission('vehicle.log.create', v.zone_id, v.hub_id)
            or (p_kind in ('fuel', 'charge') and private.vehicle_served_perm(v.id, 'vehicle.log.create'));
  if p_id is null then
    if not (v_manager or private.vehicle_is_crew(v.id)) then raise exception 'Not authorised to write vehicle costs.' using errcode = '42501'; end if;
    v_status := case when v_manager then 'approved' else 'submitted' end;
  else
    select * into x from public.vehicle_logs where id = p_id and removed_at is null;
    if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
    if x.da_expense_id is not null then raise exception 'This line is already on the daily sheet; correct it there.' using errcode = '42501'; end if;
    if not (private.has_permission('vehicle.log.edit', v.zone_id, v.hub_id)
            or (x.created_by = auth.uid() and x.created_at > now() - interval '24 hours' and x.status <> 'approved')
            or (x.created_by = auth.uid() and x.created_at > now() - interval '24 hours' and v_manager)) then
      raise exception 'Not authorised to change this line.' using errcode = '42501';
    end if;
    v_status := case when x.status = 'rejected' and not v_manager then 'submitted' else x.status end;
  end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount cannot be negative.' using errcode = '22023'; end if;
  if p_kind = 'fuel' and coalesce(p_litres, 0) <= 0 and coalesce(p_amount, 0) = 0 then raise exception 'Write the litres or the amount.' using errcode = '22023'; end if;
  if p_odometer is not null and p_odometer < 0 then raise exception 'Odometer cannot be negative.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_driver_code, '')), '') is not null then
    select id into v_driver from public.employees
     where employee_code = regexp_replace(trim(p_driver_code), '^[A-Za-z]+-', '')::extensions.citext and archived_at is null;
    if v_driver is null then raise exception 'No employee with ID %.', p_driver_code using errcode = '22023'; end if;
  else
    v_driver := case when v_manager then private.vehicle_holder(v.id) else v_me end;
  end if;
  if p_da_expense is not null and not exists (select 1 from public.da_expenses d where d.id = p_da_expense and d.removed_at is null) then
    raise exception 'That sheet line does not exist.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, odometer, litres, amount, vendor, bill_no, driver_id, da_expense_id, note, status, slip_path)
    values (p_vehicle, v.hub_id, v.zone_id, p_kind, coalesce(p_date, current_date), p_odometer, p_litres, coalesce(p_amount, 0),
            nullif(trim(p_vendor), ''), nullif(trim(p_bill_no), ''), v_driver, p_da_expense, nullif(trim(p_note), ''), v_status, nullif(trim(p_slip), ''))
    returning id into v_id;
    if v_status = 'submitted' then
      perform private.vehicle_notify_managers(v.id, 'vehicle.log.approve', 'গাড়ির ' || case when p_kind = 'fuel' then 'তেল' when p_kind = 'charge' then 'চার্জ' else 'খরচ' end || ' জমা পড়েছে',
        v.name || coalesce(' (' || v.reg_no || ')', '') || ' · ৳' || coalesce(p_amount, 0)::text || coalesce(' · ' || p_litres::text || ' L', '') || ' · ' || private.my_display_name(),
        '/app/vehicles/logs?v=' || v.id::text);
    end if;
  else
    update public.vehicle_logs set kind = p_kind, log_date = coalesce(p_date, log_date), odometer = p_odometer, litres = p_litres,
           amount = coalesce(p_amount, 0), vendor = nullif(trim(p_vendor), ''), bill_no = nullif(trim(p_bill_no), ''),
           driver_id = v_driver, da_expense_id = coalesce(p_da_expense, da_expense_id), note = nullif(trim(p_note), ''),
           slip_path = coalesce(nullif(trim(p_slip), ''), slip_path), status = v_status
     where id = p_id returning id into v_id;
  end if;
  if p_odometer is not null and p_odometer > v.odometer then update public.vehicles set odometer = p_odometer where id = v.id; end if;
  if p_kind in ('service', 'oil') and v_status = 'approved' then
    update public.vehicles set last_service_on = greatest(coalesce(last_service_on, '1900-01-01'::date), coalesce(p_date, current_date)),
                               last_service_km = greatest(coalesce(last_service_km, 0), coalesce(p_odometer, last_service_km, 0))
     where id = v.id;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.vehicle_requisition_submit(p_hub uuid, p_work_date date, p_job text, p_vehicle uuid DEFAULT NULL::uuid, p_work_time text DEFAULT NULL::text, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text, p_parcels integer DEFAULT NULL::integer, p_weight text DEFAULT NULL::text, p_data jsonb DEFAULT '{}'::jsonb, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_zone uuid := private.hub_zone(p_hub); v_id uuid; v_no text; v public.vehicles; h public.hubs;
begin
  if v_zone is null then raise exception 'Choose the hub.' using errcode = '22023'; end if;
  if not private.has_permission('vehicle.requisition.create', v_zone, p_hub) then raise exception 'Not authorised to ask for a vehicle.' using errcode = '42501'; end if;
  if p_work_date is null or p_work_date < current_date - 1 then raise exception 'Choose the day of the work.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_job, ''))) = 0 then raise exception 'Write what the vehicle is for.' using errcode = '22023'; end if;
  if p_vehicle is not null then
    select * into v from public.vehicles where id = p_vehicle and archived_at is null;
    if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  end if;
  select * into h from public.hubs where id = p_hub;
  v_no := 'VR-' || lpad(nextval('public.vehicle_requisition_seq')::text, 5, '0');
  insert into public.vehicle_requisitions (no, hub_id, zone_id, vehicle_id, work_date, work_time, job, from_text, to_text, parcels, weight, data, note, driver_id)
  values (v_no, p_hub, v_zone, p_vehicle, p_work_date, nullif(trim(p_work_time), ''), trim(p_job), nullif(trim(p_from), ''), nullif(trim(p_to), ''),
          p_parcels, nullif(trim(p_weight), ''), coalesce(p_data, '{}'::jsonb), nullif(trim(p_note), ''), case when v.id is not null then private.vehicle_holder(v.id) end)
  returning id into v_id;
  insert into public.vehicle_requisition_events (requisition_id, status, note, by_name) values (v_id, 'open', nullif(trim(p_note), ''), private.my_display_name());
  if v.id is not null then
    perform private.vehicle_notify_crew(v.id, 'গাড়ি লাগবে: ' || h.name, v_no || ' · ' || to_char(p_work_date, 'DD/MM') || coalesce(' ' || p_work_time, '') || ' · ' || trim(p_job), '/app/vehicles/requests?id=' || v_id::text);
    perform private.vehicle_notify_managers(v.id, 'vehicle.requisition.approve', 'গাড়ির রিকুইজিশন: ' || h.name, v_no || ' · ' || v.name || ' · ' || to_char(p_work_date, 'DD/MM') || ' · ' || trim(p_job), '/app/vehicles/requests?id=' || v_id::text);
  else
    perform private.notify(u.user_id, 'গাড়ির রিকুইজিশন: ' || h.name, v_no || ' · ' || to_char(p_work_date, 'DD/MM') || ' · ' || trim(p_job), '/app/vehicles/requests?id=' || v_id::text, 'vehicle')
    from (select distinct ur.user_id from public.user_roles ur
            join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
            left join public.role_permissions rp on rp.role_id = r.id left join public.permissions p on p.id = rp.permission_id
           where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
             and (p.code = 'vehicle.requisition.approve' or r.is_super)
             and (ur.scope_type = 'global' or (ur.scope_type = 'zone' and ur.zone_id = v_zone)
               or (ur.scope_type = 'hub' and ur.hub_id in (select id from public.hubs where zone_id = v_zone)))) u;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.vehicle_set_hubs(p_vehicle uuid, p_hubs uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.vehicles; h uuid;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('vehicle.vehicle.edit', v.zone_id, v.hub_id) then raise exception 'Not authorised to change the vehicle.' using errcode = '42501'; end if;
  execute 'del' || 'ete from public.vehicle_hubs where vehicle_id = $1 and not (hub_id = any ($2))' using p_vehicle, coalesce(p_hubs, '{}'::uuid[]);
  foreach h in array coalesce(p_hubs, '{}') loop
    if h is distinct from v.hub_id then
      insert into public.vehicle_hubs (vehicle_id, hub_id, zone_id) values (p_vehicle, h, private.hub_zone(h)) on conflict do nothing;
    end if;
  end loop;
end $function$
;
