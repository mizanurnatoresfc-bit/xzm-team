-- =====================================================================
--  নদী: হাজিরার ফাঁকা দিন (days with no attendance) — ask, answer, check, report
--
--  A "gap" is a past day on which an active staff member has no attendance
--  record at all (present, late, absent, leave, holiday and weekly off all
--  count as recorded). Nodi shows each person their own gaps and asks why:
--     leave   -> a leave request is filed for those days (hub manager approves;
--                approval writes the attendance, so the gap closes by itself)
--     worked  -> "I was at work, it was not marked" (the manager corrects it)
--     other   -> a written reason
--  A Zonal Assistant (new role) sees every hub's gaps and answers in their
--  panel, marks each answer checked or sends it back, and can remind people.
--
--  Nothing here touches pay. Additive: one role, two permissions, one table,
--  five functions. Rollback: drop the functions and the table; the role and
--  permissions can stay.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('hr.attendance_gap.view',    'hr', 'attendance_gap', 'view',    'See days without attendance and the reasons staff gave'),
  ('hr.attendance_gap.approve', 'hr', 'attendance_gap', 'approve', 'Check the reasons staff gave for days without attendance, and remind them')
on conflict (code) do nothing;

insert into public.roles (code, name, name_bn, description, is_system, is_super) values
  ('zonal_assistant', 'Zonal Assistant', 'জোনাল অ্যাসিস্ট্যান্ট', 'Follows up attendance gaps across the area: sees, checks and reminds; approves nothing else', true, false)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code = 'zonal_assistant' and p.code in ('org.organization.view', 'org.zone.view', 'org.hub.view', 'hr.employee.view', 'hr.attendance.view', 'hr.leave.view',
                                                'hr.attendance_gap.view', 'hr.attendance_gap.approve'))
  or (r.code in ('admin', 'hr_manager', 'zonal_manager') and p.code in ('hr.attendance_gap.view', 'hr.attendance_gap.approve'))
  or (r.code in ('head_office_manager', 'operations_manager', 'hub_manager', 'auditor') and p.code = 'hr.attendance_gap.view')
) on conflict do nothing;

insert into public.role_dashboards (role_id, panels, default_view)
select s.id, d.panels, d.default_view
from public.roles s join public.roles r on r.code = 'rider' join public.role_dashboards d on d.role_id = r.id
where s.code = 'zonal_assistant'
on conflict (role_id) do nothing;

-- ---------------------------------------------------------------------
create table public.attendance_gap_answers (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id),
  work_date     date not null,
  kind          text not null check (kind in ('leave', 'worked', 'other')),
  note          text,
  leave_request_id uuid references public.leave_requests(id),
  status        text not null default 'answered' check (status in ('answered', 'verified', 'returned')),
  answered_by   uuid,
  answered_at   timestamptz not null default now(),
  checked_by    uuid,
  checked_at    timestamptz,
  check_note    text,
  unique (employee_id, work_date)
);
create index attendance_gap_answers_leave_fk_idx on public.attendance_gap_answers (leave_request_id);
create index attendance_gap_answers_status_idx on public.attendance_gap_answers (status);

alter table public.attendance_gap_answers enable row level security;
revoke all on public.attendance_gap_answers from anon, authenticated;
grant select on public.attendance_gap_answers to authenticated;
-- read: your own, or the staff you may follow up. Every write goes through the functions below.
create policy attendance_gap_answers_read on public.attendance_gap_answers for select to authenticated
  using (private.is_self_employee(employee_id) or private.employee_has_permission('hr.attendance_gap.view', employee_id));

-- ---------------------------------------------------------------------
--  The gaps themselves: active staff with an Employee ID, counted from the day
--  they became active, up to yesterday. p_employee narrows it to one person.
-- ---------------------------------------------------------------------
create or replace function private.attendance_gap_days(p_from date, p_to date, p_employee uuid default null)
returns table (employee_id uuid, work_date date)
language sql stable security definer set search_path = '' as $$
  select e.id, d::date
  from public.employees e
  cross join lateral generate_series(greatest(p_from, coalesce(e.status_since, e.joining_date, p_from)), least(p_to, current_date - 1), interval '1 day') d
  where e.status = 'active' and e.archived_at is null and e.employee_code is not null
    and (p_employee is null or e.id = p_employee)
    and not exists (select 1 from public.attendance_records a where a.employee_id = e.id and a.work_date = d::date)
$$;

create or replace function public.att_gap_report(p_from date, p_to date, p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, hub_id uuid, hub_name text, has_login boolean,
               work_date date, answer_id uuid, kind text, note text, status text, leave_status text, check_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'তারিখ ঠিক করে দিন (সর্বোচ্চ তিন মাস)' using errcode = '22023'; end if;
  return query
  select e.id, e.employee_code::text, e.full_name, po.name, e.hub_id, private.hub_name(e.hub_id), e.profile_id is not null,
         g.work_date, a.id, a.kind, a.note, coalesce(a.status, 'waiting'), l.status, a.check_note
  from private.attendance_gap_days(p_from, p_to) g
  join public.employees e on e.id = g.employee_id
  left join public.positions po on po.id = e.position_id
  left join public.attendance_gap_answers a on a.employee_id = g.employee_id and a.work_date = g.work_date
  left join public.leave_requests l on l.id = a.leave_request_id
  where (p_zone is null or e.zone_id = p_zone) and (p_hub is null or e.hub_id = p_hub)
    and private.has_permission('hr.attendance_gap.view', e.zone_id, e.hub_id)
  order by private.hub_name(e.hub_id), e.full_name, g.work_date;
end $$;

-- My own gaps this month and last, with what I answered.
create or replace function public.my_att_gaps()
returns table (work_date date, answer_id uuid, kind text, note text, status text, leave_status text, check_note text)
language sql stable security definer set search_path = '' as $$
  select g.work_date, a.id, a.kind, a.note, coalesce(a.status, 'waiting'), l.status, a.check_note
  from private.attendance_gap_days((date_trunc('month', current_date) - interval '1 month')::date, current_date, private.my_employee_id()) g
  left join public.attendance_gap_answers a on a.employee_id = g.employee_id and a.work_date = g.work_date
  left join public.leave_requests l on l.id = a.leave_request_id
  where private.my_employee_id() is not null
  order by g.work_date
$$;

-- ---------------------------------------------------------------------
--  I answer for some of my gap days.
-- ---------------------------------------------------------------------
create or replace function public.my_att_gap_answer(p_dates date[], p_kind text, p_note text default null, p_leave_type uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_dates date[];
  d date; v_from date; v_prev date; v_leave uuid;
begin
  if auth.uid() is null or v_emp is null then raise exception 'আপনার লগইনের সাথে কোনো কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('leave', 'worked', 'other') then raise exception 'কারণের ধরন বেছে নিন' using errcode = '22023'; end if;
  if v_note is null then raise exception 'কারণ লিখুন' using errcode = '22023'; end if;
  select array_agg(distinct x order by x) into v_dates from unnest(coalesce(p_dates, '{}')) x;
  if v_dates is null then raise exception 'কোন তারিখের জন্য — বেছে নিন' using errcode = '22023'; end if;
  -- only real gaps of mine, and not ones already checked
  if exists (select 1 from unnest(v_dates) x
             where not exists (select 1 from private.attendance_gap_days(x, x, v_emp))) then
    raise exception 'বাছাই করা কোনো তারিখে হাজিরা আগেই আছে, অথবা তারিখটি এখনো আসেনি' using errcode = 'P0001'; end if;
  if exists (select 1 from public.attendance_gap_answers a where a.employee_id = v_emp and a.work_date = any (v_dates) and a.status = 'verified') then
    raise exception 'যাচাই হয়ে যাওয়া উত্তর আর বদলানো যায় না' using errcode = 'P0001'; end if;

  if p_kind = 'leave' then
    if p_leave_type is null or not exists (select 1 from public.leave_types t where t.id = p_leave_type and t.status = 'active') then
      raise exception 'ছুটির ধরন বেছে নিন' using errcode = '22023'; end if;
    -- one leave request per unbroken run of days; a day already inside one of my requests uses that request
    v_from := null; v_prev := null;
    foreach d in array v_dates || array[null::date] loop
      if v_from is not null and (d is null or d <> v_prev + 1) then
        select l.id into v_leave from public.leave_requests l
         where l.employee_id = v_emp and l.status in ('pending', 'approved') and l.from_date <= v_from and l.to_date >= v_prev limit 1;
        if v_leave is null then
          insert into public.leave_requests (employee_id, leave_type_id, from_date, to_date, reason)
          values (v_emp, p_leave_type, v_from, v_prev, v_note) returning id into v_leave;
        end if;
        insert into public.attendance_gap_answers (employee_id, work_date, kind, note, leave_request_id, answered_by)
        select v_emp, x, 'leave', v_note, v_leave, auth.uid() from generate_series(v_from, v_prev, interval '1 day') x
        on conflict (employee_id, work_date) do update
          set kind = 'leave', note = excluded.note, leave_request_id = excluded.leave_request_id, status = 'answered',
              answered_by = excluded.answered_by, answered_at = now(), checked_by = null, checked_at = null, check_note = null;
        v_from := null;
      end if;
      if d is not null and v_from is null then v_from := d; end if;
      v_prev := d;
    end loop;
  else
    insert into public.attendance_gap_answers (employee_id, work_date, kind, note, answered_by)
    select v_emp, x, p_kind, v_note, auth.uid() from unnest(v_dates) x
    on conflict (employee_id, work_date) do update
      set kind = excluded.kind, note = excluded.note, leave_request_id = null, status = 'answered',
          answered_by = excluded.answered_by, answered_at = now(), checked_by = null, checked_at = null, check_note = null;
  end if;
  return cardinality(v_dates);
end $$;

-- ---------------------------------------------------------------------
--  The Zonal Assistant checks answers, or sends them back with a note.
-- ---------------------------------------------------------------------
create or replace function public.att_gap_check(p_ids uuid[], p_ok boolean, p_note text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare a public.attendance_gap_answers; n integer := 0; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_ok is null then raise exception 'ঠিক আছে নাকি ফেরত — বলুন' using errcode = '22023'; end if;
  if not p_ok and v_note is null then raise exception 'ফেরত পাঠানোর কারণ লিখুন' using errcode = '22023'; end if;
  for a in select * from public.attendance_gap_answers where id = any (coalesce(p_ids, '{}')) for update loop
    if not private.employee_has_permission('hr.attendance_gap.approve', a.employee_id) then
      raise exception 'এই উত্তর যাচাই করার অনুমতি নেই' using errcode = '42501'; end if;
    if private.is_self_employee(a.employee_id) then raise exception 'নিজের উত্তর নিজে যাচাই করা যায় না' using errcode = '42501'; end if;
    update public.attendance_gap_answers
       set status = case when p_ok then 'verified' else 'returned' end, checked_by = auth.uid(), checked_at = now(), check_note = v_note
     where id = a.id;
    if not p_ok then
      perform private.notify((select e.profile_id from public.employees e where e.id = a.employee_id),
        'নদী: হাজিরার উত্তর ফেরত এসেছে', to_char(a.work_date, 'DD Mon') || ' — ' || v_note, '/app', 'attendance_gap');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Remind everyone in scope who still owes an answer (no answer yet, or sent back). Returns how many people were told.
create or replace function public.att_gap_remind(p_from date, p_to date, p_hub uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  for r in
    select e.profile_id, count(*) days, string_agg(to_char(g.work_date, 'DD'), ', ' order by g.work_date) dates
    from private.attendance_gap_days(p_from, p_to) g
    join public.employees e on e.id = g.employee_id
    left join public.attendance_gap_answers a on a.employee_id = g.employee_id and a.work_date = g.work_date
    where (p_hub is null or e.hub_id = p_hub) and e.profile_id is not null
      and (a.id is null or a.status = 'returned')
      and private.has_permission('hr.attendance_gap.approve', e.zone_id, e.hub_id)
    group by e.profile_id
  loop
    perform private.notify(r.profile_id, 'নদী: আপনার ' || r.days || ' দিনের হাজিরা নেই',
      'তারিখ: ' || r.dates || ' — কারণ জানান (ছুটি হলে এখান থেকেই আবেদন দিন)', '/app', 'attendance_gap');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function private.attendance_gap_days(date, date, uuid) from public, anon, authenticated;
revoke all on function public.att_gap_report(date, date, uuid, uuid), public.my_att_gaps(), public.my_att_gap_answer(date[], text, text, uuid),
  public.att_gap_check(uuid[], boolean, text), public.att_gap_remind(date, date, uuid) from public, anon;
grant execute on function public.att_gap_report(date, date, uuid, uuid), public.my_att_gaps(), public.my_att_gap_answer(date[], text, text, uuid),
  public.att_gap_check(uuid[], boolean, text), public.att_gap_remind(date, date, uuid) to authenticated;
