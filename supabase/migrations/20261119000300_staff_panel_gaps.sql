-- =====================================================================
--  Phase 2 — স্টাফ প্যানেল: হাজিরার ফাঁকা দিনের রিপোর্ট / Staff panel: daily gap reports
--
--  Owner's rule (spec 2.2): there is no separate leave request. A working day with no
--  attendance is answered with one of three reasons, and the hub manager approves it.
--
--  1. my_att_gap_answer (same signature, so the old screens keep working):
--       * "ছুটিতে ছিলাম" no longer files a leave request (p_leave_type is ignored);
--         the answer itself is the report.
--       * A written note is needed only for "অন্য কারণ"; for the other two it is optional
--         (people answer from a phone).
--       * The hub's managers (anyone who may check that person's answers) are told.
--     Status stays answered -> verified | returned (shown as জমা -> অনুমোদিত | ফেরত).
--  2. The hub manager role may approve (check) gap answers of their own hub
--     (hr.attendance_gap.approve, hub scope). The zonal manager already may, and sees the zone.
--  3. Plain staff can report an issue: "/app/issues" is added to the staff role's page list
--     (issue_create already lets anyone posted at the hub raise one).
--
--  Old answers that already filed a leave request keep it; nothing is deleted.
--  Rollback: put back my_att_gap_answer from 20261115002400_attendance_gaps.sql; remove the
--  permission row (hub_manager, hr.attendance_gap.approve); take "/app/issues" off the staff page list.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The answer
-- ---------------------------------------------------------------------
create or replace function public.my_att_gap_answer(p_dates date[], p_kind text, p_note text default null, p_leave_type uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_dates date[];
  e record;
  v_to uuid;
begin
  if auth.uid() is null or v_emp is null then raise exception 'আপনার লগইনের সাথে কোনো কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('leave', 'worked', 'other') then raise exception 'কারণের ধরন বেছে নিন' using errcode = '22023'; end if;
  if p_kind = 'other' and v_note is null then raise exception 'কারণ লিখুন' using errcode = '22023'; end if;
  if length(coalesce(v_note, '')) > 500 then raise exception 'কারণ ৫০০ অক্ষরের মধ্যে লিখুন' using errcode = '22023'; end if;
  select array_agg(distinct x order by x) into v_dates from unnest(coalesce(p_dates, '{}')) x;
  if v_dates is null then raise exception 'কোন তারিখের জন্য — বেছে নিন' using errcode = '22023'; end if;
  -- only real gaps of mine, and not ones already approved
  if exists (select 1 from unnest(v_dates) x
             where not exists (select 1 from private.attendance_gap_days(x, x, v_emp))) then
    raise exception 'বাছাই করা কোনো তারিখে হাজিরা আগেই আছে, অথবা তারিখটি এখনো আসেনি' using errcode = 'P0001'; end if;
  if exists (select 1 from public.attendance_gap_answers a where a.employee_id = v_emp and a.work_date = any (v_dates) and a.status = 'verified') then
    raise exception 'অনুমোদন হয়ে যাওয়া উত্তর আর বদলানো যায় না' using errcode = 'P0001'; end if;

  insert into public.attendance_gap_answers (employee_id, work_date, kind, note, answered_by)
  select v_emp, x, p_kind, v_note, auth.uid() from unnest(v_dates) x
  on conflict (employee_id, work_date) do update
    set kind = excluded.kind, note = excluded.note, leave_request_id = null, status = 'answered',
        answered_by = excluded.answered_by, answered_at = now(), checked_by = null, checked_at = null, check_note = null;

  -- tell the people who may approve it at the person's hub (not the person themselves)
  select em.full_name, em.hub_id, em.zone_id into e from public.employees em where em.id = v_emp;
  for v_to in
    select distinct ur.user_id
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id and p.code = 'hr.attendance_gap.approve'
     where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
       and ur.scope_type = 'hub' and ur.hub_id = e.hub_id and ur.user_id <> auth.uid()
  loop
    perform private.notify(v_to, 'হাজিরার ফাঁকা দিনের রিপোর্ট এসেছে',
      e.full_name || ' — ' || cardinality(v_dates) || ' দিন: ' ||
      case p_kind when 'leave' then 'ছুটিতে ছিলাম' when 'worked' then 'কাজে ছিলাম, হাজিরা ওঠেনি' else 'অন্য কারণ' end,
      '/app/hub/attendance', 'attendance_gap');
  end loop;
  return cardinality(v_dates);
end $$;

-- ---------------------------------------------------------------------
-- 2. The hub manager approves at their own hub
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'hr.attendance_gap.approve'
 where r.code = 'hub_manager'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Plain staff may open the issues page (to report one)
-- ---------------------------------------------------------------------
update public.role_dashboards d
   set menu = d.menu || '["/app/issues"]'::jsonb, updated_at = now()
  from public.roles r
 where r.id = d.role_id and r.code = 'staff'
   and d.menu is not null and not d.menu ? '/app/issues';
