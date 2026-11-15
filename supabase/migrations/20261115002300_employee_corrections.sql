-- =====================================================================
--  Fixing mistakes in staff data
--
--  hr_remove_wrong_entry(employee, reason)
--     A record that should never have been entered (wrong person, entered
--     twice, test data). It leaves every list at once, and its Employee ID
--     and mobile number become free again. Nothing is destroyed: the row is
--     kept as "rejected + archived", the old ID is written into the reason,
--     and the audit log has the rest. Refused when real work is already
--     recorded against the person (attendance, accounts, salary, leave, open
--     issues) — that is a correction or a resignation, not a mistaken entry.
--     A linked login is switched off.
--
--  hr_correct_employee_code(employee, new_code, reason)
--     The right person with the wrong Employee ID: the ID is changed, and
--     sign-in by ID follows it.
--
--  Additive. Rollback: drop the two functions.
-- =====================================================================

create or replace function public.hr_remove_wrong_entry(p_employee uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_why text := nullif(trim(coalesce(p_reason, '')), '');
  v_used text;
begin
  select * into e from public.employees where id = p_employee for update;
  if not found then raise exception 'কর্মীকে পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.has_permission('hr.employee.archive', e.zone_id, e.hub_id) then
    raise exception 'ভুল এন্ট্রি মোছার অনুমতি নেই' using errcode = '42501'; end if;
  if v_why is null then raise exception 'কারণ লিখুন' using errcode = '22023'; end if;
  if e.archived_at is not null then raise exception 'এই রেকর্ড আগেই সরানো হয়েছে' using errcode = 'P0001'; end if;
  if e.profile_id is not null and e.profile_id = auth.uid() then raise exception 'নিজের রেকর্ড নিজে মোছা যায় না' using errcode = '42501'; end if;

  select string_agg(t, ', ') into v_used from (
    select 'হাজিরা' t where exists (select 1 from public.attendance_records a where a.employee_id = p_employee)
    union all select 'হিসাব খাতা' where exists (select 1 from public.da_rider_lines l where l.employee_id = p_employee)
                                    or exists (select 1 from public.da_expenses x where x.employee_id = p_employee or x.paid_by_employee = p_employee)
    union all select 'বেতন শিট' where exists (select 1 from public.salary_sheet_lines s where s.employee_id = p_employee)
    union all select 'ছুটি' where exists (select 1 from public.leave_requests r where r.employee_id = p_employee)
    union all select 'ইস্যু / অর্ডার' where exists (select 1 from public.issues i where i.assignee_id = p_employee and i.status in ('open', 'in_progress', 'solved'))
    union all select 'গাড়ি' where exists (select 1 from public.vehicle_assignments v where v.employee_id = p_employee and v.effective_to is null)
  ) x;
  if v_used is not null then
    raise exception 'এই কর্মীর নামে কাজের রেকর্ড আছে (%) — ভুল এন্ট্রি হিসেবে মোছা যাবে না। আইডি ভুল হলে আইডি সংশোধন করুন; চাকরিতে না থাকলে অবস্থা বদলে তালিকা থেকে সরান।', v_used
      using errcode = 'P0001'; end if;

  if e.profile_id is not null then
    if not private.can_manage_user(e.profile_id) then
      raise exception 'এই কর্মীর লগইন বন্ধ করার অনুমতি আপনার নেই' using errcode = '42501'; end if;
    perform set_config('app.change_reason', 'ভুল এন্ট্রি মোছা — লগইন বন্ধ', true);
    update public.profiles set status = 'inactive' where id = e.profile_id and status <> 'inactive';
  end if;

  perform set_config('app.change_reason', 'ভুল এন্ট্রি মোছা: ' || v_why, true);
  update public.employee_applications
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = 'ভুল এন্ট্রি: ' || v_why
   where employee_id = p_employee and status in ('draft', 'submitted', 'returned');
  update public.employees
     set status = 'rejected', status_since = current_date, employee_code = null,
         archived_at = now(), archived_by = auth.uid(),
         archive_reason = 'ভুল এন্ট্রি' || coalesce(' (আইডি ছিল ' || e.employee_code::text || ')', '') || ': ' || v_why
   where id = p_employee;
  insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
  values (p_employee, e.status, 'rejected', current_date, 'ভুল এন্ট্রি: ' || v_why);
end $$;

create or replace function public.hr_correct_employee_code(p_employee uuid, p_code text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  v_code text := upper(trim(translate(coalesce(p_code, ''), '০১২৩৪৫৬৭৮৯', '0123456789')));
  v_why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into e from public.employees where id = p_employee for update;
  if not found then raise exception 'কর্মীকে পাওয়া যায়নি' using errcode = 'P0002'; end if;
  -- the same people who may give an Employee ID may correct one
  if auth.uid() is null or not private.employee_has_permission('hr.employee.edit', p_employee)
     or not private.employee_has_permission('hr.application.approve', p_employee) then
    raise exception 'এমপ্লয়ি আইডি সংশোধনের অনুমতি নেই' using errcode = '42501'; end if;
  if e.archived_at is not null or e.employee_code is null then
    raise exception 'যাঁর আইডি আছে শুধু তাঁর আইডি সংশোধন করা যায়' using errcode = 'P0001'; end if;
  if v_why is null then raise exception 'কারণ লিখুন' using errcode = '22023'; end if;
  if v_code !~ private.setting_text('hr.employee_code_pattern') then
    raise exception 'এমপ্লয়ি আইডি "%" কোম্পানির ফরম্যাটে নেই', p_code using errcode = '23514'; end if;
  if v_code = upper(e.employee_code::text) then raise exception 'নতুন আইডি আগেরটার মতোই' using errcode = '22023'; end if;
  if exists (select 1 from public.employees x where x.employee_code = v_code::extensions.citext and x.id <> p_employee) then
    raise exception 'এমপ্লয়ি আইডি % অন্য একজনের নামে আছে', v_code using errcode = '23505'; end if;
  perform set_config('app.change_reason', 'আইডি সংশোধন ' || e.employee_code::text || ' → ' || v_code || ': ' || v_why, true);
  update public.employees set employee_code = v_code where id = p_employee;
  return v_code;
end $$;

revoke all on function public.hr_remove_wrong_entry(uuid, text), public.hr_correct_employee_code(uuid, text, text) from public, anon;
grant execute on function public.hr_remove_wrong_entry(uuid, text), public.hr_correct_employee_code(uuid, text, text) to authenticated;
