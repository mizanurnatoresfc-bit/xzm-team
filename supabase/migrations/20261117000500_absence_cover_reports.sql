-- =====================================================================
-- XZM-TEAM ERP — Absent list by 11 am, route cover for riders who are out, staff day notes,
-- and the zonal manager's midnight report.
--
-- Owner (16 Nov):
--   "রাইডার ছুটিতে থাকলে ম্যানেজারকে প্রতি ঘণ্টায় জানাবে — যতক্ষণ না ওই রাইডারের রুট কাকে দিচ্ছেন এসাইন করেন।
--    তার ডেলিভারির আপডেট না এলে রাত ১২টার পর কাজের রিপোর্ট যাবে। সকল স্টাফের কাজের রিপোর্ট, পরামর্শ যাবে।
--    হাব ম্যানেজার সকাল ১১টার মধ্যে অনুপস্থিত সাবমিট করবেন; বাকি সবাই উপস্থিত দেখাবে; ভুল হলে নোট দিয়ে কারেকশন।"
-- Decisions (16 Nov): keep staff self-marking too (the manager's list is final for the day); the midnight report goes to
-- the zonal manager; staff work report = the system's day summary + the staff member's own note and suggestion.
--
--  1. hub_absence_submit: the hub manager sends only who is absent / late / half day. Every other working staff member
--     of the hub becomes present (source 'absence_list'); approved leave stays; waiting self-marks are closed with it.
--     After 11:00 it is still taken but marked late. att_correct fixes one day with a note (logged, staff told).
--  2. route_covers: a rider with an open route who is on approved leave or marked absent / half day needs a cover.
--     Hub managers get a reminder every hour 08:00–20:00 until a cover is assigned. The cover's delivery comes from the
--     day's sheet (or the manager writes it); missing → the midnight report says so.
--  3. staff_day_notes: what I did today + a suggestion, from the staff panel.
--  4. zone_daily_report(zone, date) for the zonal manager; a job just after midnight tells them what went wrong.
--  Jobs run with pg_cron when the database has it (Supabase does); times are Dhaka.
-- =====================================================================

alter table public.attendance_records drop constraint if exists attendance_records_source_check;
alter table public.attendance_records add constraint attendance_records_source_check
  check (source in ('manual','kiosk','import','leave','self','absence_list'));

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.hub_absence_submissions (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references public.hubs(id),
  zone_id uuid not null references public.zones(id),
  work_date date not null,
  submitted_by uuid, submitted_by_name text,
  submitted_at timestamptz not null default now(),
  late_submit boolean not null default false,
  absent_count integer not null default 0, present_count integer not null default 0,
  note text,
  unique (hub_id, work_date)
);
create index hub_absence_submissions_zone on public.hub_absence_submissions (zone_id, work_date);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid references public.attendance_records(id),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  old_status text, new_status text not null,
  note text not null check (length(trim(note)) > 0),
  corrected_by uuid, corrected_by_name text,
  corrected_at timestamptz not null default now()
);
create index attendance_corrections_emp on public.attendance_corrections (employee_id, work_date);
create index attendance_corrections_att on public.attendance_corrections (attendance_id);

create table public.route_covers (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references public.hubs(id),
  zone_id uuid not null references public.zones(id),
  route_id uuid not null references public.hub_routes(id),
  work_date date not null,
  absent_employee_id uuid not null references public.employees(id),
  cover_employee_id uuid references public.employees(id),
  cover_name text not null, cover_phone text,
  note text,
  assigned_by uuid, assigned_by_name text, assigned_at timestamptz not null default now(),
  delivered integer check (delivered is null or delivered >= 0),
  returned integer check (returned is null or returned >= 0),
  update_note text, updated_by_name text, update_at timestamptz,
  unique (route_id, work_date, absent_employee_id)
);
create index route_covers_hub_day on public.route_covers (hub_id, work_date);
create index route_covers_zone_day on public.route_covers (zone_id, work_date);
create index route_covers_cover on public.route_covers (cover_employee_id, work_date);
create index route_covers_absent on public.route_covers (absent_employee_id);

create table public.staff_day_notes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  hub_id uuid references public.hubs(id),
  zone_id uuid references public.zones(id),
  work_date date not null,
  work text, suggestion text,
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index staff_day_notes_zone on public.staff_day_notes (zone_id, work_date);
create index staff_day_notes_hub on public.staff_day_notes (hub_id);

do $$
declare t text;
begin
  foreach t in array array['hub_absence_submissions', 'attendance_corrections', 'route_covers', 'staff_day_notes'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t,
                   case when t = 'route_covers' then 'ops' else 'hr' end);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);   -- read and written only through the functions below
  end loop;
end $$;

insert into public.permissions (code, module, resource, action, description) values
  ('zonal.daily_report.view', 'zonal', 'daily_report', 'view', 'The midnight report: absent lists, route covers, every staff member''s day and suggestions')
on conflict (code) do nothing;
-- Admin too: a role can only be given by someone holding all its rights (Zonal Manager has it).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'zonal.daily_report.view' where r.code in ('zonal_manager', 'admin')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function private.dhaka_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Dhaka')::date $$;

-- Tell everyone holding a permission at a hub (hub grants) or for a zone (zone grants). Super Admins are not paged.
create or replace function private.notify_holders(p_perm text, p_zone uuid, p_hub uuid, p_title text, p_body text, p_link text, p_kind text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid; v_n integer := 0;
begin
  for u in
    select distinct ur.user_id
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
      join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions p on p.id = rp.permission_id and p.code = p_perm
     where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
       and ((p_hub is not null and ur.scope_type = 'hub' and ur.hub_id = p_hub) or (p_zone is not null and ur.scope_type = 'zone' and ur.zone_id = p_zone))
  loop
    perform private.notify(u, p_title, p_body, p_link, p_kind); v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- The hub's working staff (hub posts only, active).
create or replace function private.hub_staff(p_hub uuid) returns setof public.employees
language sql stable security definer set search_path = '' as $$
  select e.* from public.employees e where e.hub_id = p_hub and e.archived_at is null and e.status = 'active' and private.is_hub_post(e.position_id)
$$;

-- Riders who hold a route and are out that day: approved leave, or marked absent / half day.
create or replace function private.riders_out(p_hub uuid, p_date date)
returns table (route_id uuid, route_name text, route_code text, areas text[], employee_id uuid, employee_code text, full_name text, mobile text, reason text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, r.code, r.areas, e.id, e.employee_code::text, e.full_name, e.mobile,
         case when lv.id is not null or a.status = 'leave' then 'leave' else a.status end
    from public.rider_routes rr
    join public.hub_routes r on r.id = rr.route_id and r.archived_at is null and r.status = 'active'
    join public.employees e on e.id = rr.employee_id and e.archived_at is null and e.status = 'active'
    left join public.attendance_records a on a.employee_id = e.id and a.work_date = p_date
    left join lateral (select l.id from public.leave_requests l where l.employee_id = e.id and l.status = 'approved'
                        and p_date between l.from_date and l.to_date limit 1) lv on true
   where r.hub_id = p_hub and rr.effective_from <= p_date and (rr.effective_to is null or rr.effective_to >= p_date)
     and (lv.id is not null or a.status in ('absent', 'leave', 'half_day'))
$$;

-- Deliveries of one person on a day, from the daily sheets.
create or replace function private.sheet_day(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when count(l.id) = 0 then null else jsonb_build_object('delivery', sum(l.delivery_qty), 'pickup', sum(l.pickup_qty), 'amount', sum(l.amount)) end
    from public.da_rider_lines l join public.da_sessions s on s.id = l.session_id
   where l.employee_id = p_employee and s.account_date = p_date and l.removed_at is null
$$;

revoke all on function private.dhaka_today(), private.notify_holders(text, uuid, uuid, text, text, text, text), private.hub_staff(uuid),
  private.riders_out(uuid, date), private.sheet_day(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Absent list by 11 am
-- ---------------------------------------------------------------------
create or replace function public.hub_absence_sheet(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, private.dhaka_today()); s public.hub_absence_submissions;
begin
  if not (private.has_permission('hr.attendance.create', null, p_hub) or private.has_permission('hr.attendance.view', null, p_hub)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into s from public.hub_absence_submissions where hub_id = p_hub and work_date = v_date;
  return jsonb_build_object('work_date', v_date, 'deadline', '11:00', 'today', private.dhaka_today(),
    'past_deadline', v_date < private.dhaka_today() or (v_date = private.dhaka_today() and (now() at time zone 'Asia/Dhaka')::time > time '11:00'),
    'submission', case when s.id is null then null else jsonb_build_object('submitted_at', s.submitted_at, 'by', s.submitted_by_name,
       'late', s.late_submit, 'absent', s.absent_count, 'present', s.present_count) end,
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'employee_id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name, 'position', p.name_bn, 'position_en', p.name,
        'status', a.status, 'source', a.source, 'note', a.note,
        'on_leave', exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and v_date between l.from_date and l.to_date),
        'self', (select jsonb_build_object('kind', m.kind, 'status', m.status, 'note', m.note, 'place_status', m.place_status)
                   from public.attendance_self_marks m where m.employee_id = e.id and m.work_date = v_date),
        'corrections', (select count(*) from public.attendance_corrections c where c.employee_id = e.id and c.work_date = v_date))
        order by e.full_name)
      from private.hub_staff(p_hub) e
      left join public.positions p on p.id = e.position_id
      left join public.attendance_records a on a.employee_id = e.id and a.work_date = v_date), '[]'::jsonb));
end $$;

-- p_absent: [{employee_id, status: absent | late | half_day, note}]. Everyone else of the hub becomes present.
create or replace function public.hub_absence_submit(p_hub uuid, p_absent jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_date date := private.dhaka_today(); h public.hubs; e public.employees; x jsonb; v_status text; v_note text; a public.attendance_records;
  v_abs integer := 0; v_pre integer := 0; v_name text := private.my_display_name(); v_late boolean; v_rec uuid;
begin
  select * into h from public.hubs where id = p_hub and archived_at is null;
  if h.id is null then raise exception 'Hub not found' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.create', null, p_hub) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_absent, '[]'::jsonb)) <> 'array' then raise exception 'Bad list' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_absent, '[]'::jsonb)) loop
    if coalesce(x->>'status', 'absent') not in ('absent', 'late', 'half_day') then raise exception 'Unknown attendance status' using errcode = '22023'; end if;
    if not exists (select 1 from private.hub_staff(p_hub) s where s.id = (x->>'employee_id')::uuid) then
      raise exception 'Someone on the list is not working at this hub' using errcode = '22023';
    end if;
  end loop;
  v_late := (now() at time zone 'Asia/Dhaka')::time > time '11:00';

  for e in select * from private.hub_staff(p_hub) loop
    select * into x from jsonb_array_elements(coalesce(p_absent, '[]'::jsonb)) y where (y->>'employee_id')::uuid = e.id limit 1;
    select * into a from public.attendance_records r where r.employee_id = e.id and r.work_date = v_date;
    -- approved leave and holidays stay as they are
    if a.id is not null and a.status in ('leave', 'holiday', 'weekly_off') then continue; end if;
    if exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and v_date between l.from_date and l.to_date) then continue; end if;
    if e.joining_date is not null and e.joining_date > v_date then continue; end if;
    v_status := case when x is null then 'present' else coalesce(x->>'status', 'absent') end;
    v_note := coalesce(nullif(trim(coalesce(x->>'note', '')), ''), case when v_status = 'present' then 'হাব ম্যানেজারের তালিকা: উপস্থিত' else 'হাব ম্যানেজারের তালিকা' end);
    if a.id is null then
      insert into public.attendance_records (employee_id, work_date, status, check_in, source, note)
      values (e.id, v_date, v_status, case when v_status = 'absent' then null else coalesce(
                (select m.marked_at from public.attendance_self_marks m where m.employee_id = e.id and m.work_date = v_date and m.kind = 'present'), now()) end,
              'absence_list', v_note)
      returning id into v_rec;
    else
      v_rec := a.id;
      if a.status is distinct from v_status then
        update public.attendance_records set status = v_status, source = 'absence_list', note = v_note,
               check_in = case when v_status = 'absent' then null else coalesce(check_in, now()) end where id = a.id;
      end if;
    end if;
    -- a self-mark still waiting is closed with the manager's list
    update public.attendance_self_marks set status = 'approved', decided_as = v_status, decided_by = auth.uid(), decided_at = now(),
           decide_note = 'হাব ম্যানেজারের অনুপস্থিত তালিকা', attendance_id = v_rec
     where employee_id = e.id and work_date = v_date and status = 'waiting';
    if v_status = 'present' then v_pre := v_pre + 1; else
      v_abs := v_abs + 1;
      if e.profile_id is not null then
        perform private.notify(e.profile_id, case v_status when 'absent' then 'আজ আপনাকে অনুপস্থিত দেখানো হয়েছে' when 'late' then 'আজ আপনাকে দেরিতে দেখানো হয়েছে' else 'আজ আপনাকে অর্ধদিবস দেখানো হয়েছে' end,
          'ভুল হলে হাব ম্যানেজারকে বলুন — নোট দিয়ে ঠিক করা যায়', '/app/staff', 'attendance');
      end if;
    end if;
  end loop;

  insert into public.hub_absence_submissions (hub_id, zone_id, work_date, submitted_by, submitted_by_name, late_submit, absent_count, present_count, note)
  values (p_hub, h.zone_id, v_date, auth.uid(), v_name, v_late, v_abs, v_pre, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (hub_id, work_date) do update set submitted_by = excluded.submitted_by, submitted_by_name = excluded.submitted_by_name,
     submitted_at = now(), late_submit = public.hub_absence_submissions.late_submit,   -- the first sending decides on time / late
     absent_count = excluded.absent_count, present_count = excluded.present_count, note = excluded.note;
  return jsonb_build_object('absent', v_abs, 'present', v_pre, 'late_submit', v_late);
end $$;

-- Fix one person's day with a note. Hub managers: today and the two days before; older days need hr.attendance.edit.
create or replace function public.att_correct(p_employee uuid, p_date date, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.attendance_records; e public.employees; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_note is null then raise exception 'Write why it is corrected' using errcode = '22023'; end if;
  if p_status not in ('present', 'late', 'half_day', 'absent') then raise exception 'Unknown attendance status' using errcode = '22023'; end if;
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Staff not found' using errcode = 'P0002'; end if;
  if e.profile_id is not distinct from auth.uid() then raise exception 'Your own attendance is corrected by another manager' using errcode = '42501'; end if;
  if p_date > private.dhaka_today() then raise exception 'Attendance cannot be recorded for a future date.' using errcode = '22023'; end if;
  if not (private.employee_has_permission('hr.attendance.edit', p_employee)
          or (private.employee_has_permission('hr.attendance.create', p_employee) and p_date >= private.dhaka_today() - 2)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into a from public.attendance_records where employee_id = p_employee and work_date = p_date for update;
  if a.status = 'leave' then raise exception 'Approved leave cannot be changed here' using errcode = '22023'; end if;
  if a.id is null then
    insert into public.attendance_records (employee_id, work_date, status, source, note, check_in)
    values (p_employee, p_date, p_status, 'manual', v_note, case when p_status = 'absent' then null else now() end) returning * into a;
    insert into public.attendance_corrections (attendance_id, employee_id, work_date, old_status, new_status, note, corrected_by, corrected_by_name)
    values (a.id, p_employee, p_date, null, p_status, v_note, auth.uid(), private.my_display_name());
  else
    insert into public.attendance_corrections (attendance_id, employee_id, work_date, old_status, new_status, note, corrected_by, corrected_by_name)
    values (a.id, p_employee, p_date, a.status, p_status, v_note, auth.uid(), private.my_display_name());
    update public.attendance_records set status = p_status, note = v_note,
           check_in = case when p_status = 'absent' then null else coalesce(check_in, now()) end where id = a.id;
  end if;
  if e.profile_id is not null then
    perform private.notify(e.profile_id, 'হাজিরা সংশোধন: ' || case p_status when 'present' then 'উপস্থিত' when 'late' then 'দেরিতে' when 'half_day' then 'অর্ধদিবস' else 'অনুপস্থিত' end,
      to_char(p_date, 'DD Mon') || ' · ' || v_note, '/app/staff', 'attendance');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Route cover
-- ---------------------------------------------------------------------
create or replace function public.route_cover_list(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, private.dhaka_today());
begin
  if not (private.has_permission('ops.route.view', null, p_hub) or private.has_permission('ops.route.edit', null, p_hub)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'route_id', o.route_id, 'route_name', o.route_name, 'areas', o.areas, 'employee_id', o.employee_id, 'employee_code', o.employee_code,
      'full_name', o.full_name, 'reason', o.reason,
      'cover', case when c.id is null then null else jsonb_build_object('id', c.id, 'employee_id', c.cover_employee_id,
          'employee_code', (select x.employee_code from public.employees x where x.id = c.cover_employee_id), 'name', c.cover_name, 'phone', c.cover_phone,
          'note', c.note, 'by', c.assigned_by_name, 'at', c.assigned_at, 'delivered', c.delivered, 'returned', c.returned,
          'update_note', c.update_note, 'update_at', c.update_at,
          'sheet', case when c.cover_employee_id is null then null else private.sheet_day(c.cover_employee_id, v_date) end) end)
      order by c.id is not null, o.route_name)
    from private.riders_out(p_hub, v_date) o
    left join public.route_covers c on c.route_id = o.route_id and c.work_date = v_date and c.absent_employee_id = o.employee_id), '[]'::jsonb);
end $$;

create or replace function public.route_cover_assign(p_route uuid, p_absent uuid, p_cover_code text, p_note text default null, p_date date default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.hub_routes; c public.employees; v_date date := coalesce(p_date, private.dhaka_today()); v_id uuid; v_absent text;
begin
  select * into r from public.hub_routes where id = p_route and archived_at is null;
  if r.id is null then raise exception 'Route not found' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route.edit', null, r.hub_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if v_date < private.dhaka_today() - 1 or v_date > private.dhaka_today() then raise exception 'Only today or yesterday' using errcode = '22023'; end if;
  if not exists (select 1 from private.riders_out(r.hub_id, v_date) o where o.route_id = p_route and o.employee_id = p_absent) then
    raise exception 'This rider is not out on this route that day' using errcode = '22023';
  end if;
  select * into c from public.employees where employee_code = regexp_replace(trim(coalesce(p_cover_code, '')), '^[A-Za-z]+-', '')::extensions.citext
     and archived_at is null and status = 'active';
  if c.id is null then raise exception 'No active staff with this ID' using errcode = '22023'; end if;
  if c.id = p_absent then raise exception 'The cover must be someone else' using errcode = '22023'; end if;
  select full_name into v_absent from public.employees where id = p_absent;
  insert into public.route_covers (hub_id, zone_id, route_id, work_date, absent_employee_id, cover_employee_id, cover_name, cover_phone, note, assigned_by, assigned_by_name)
  values (r.hub_id, r.zone_id, p_route, v_date, p_absent, c.id, c.full_name, c.mobile, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), private.my_display_name())
  on conflict (route_id, work_date, absent_employee_id) do update set cover_employee_id = excluded.cover_employee_id, cover_name = excluded.cover_name,
     cover_phone = excluded.cover_phone, note = excluded.note, assigned_by = excluded.assigned_by, assigned_by_name = excluded.assigned_by_name, assigned_at = now()
  returning id into v_id;
  if c.profile_id is not null then
    perform private.notify(c.profile_id, 'আজ আপনাকে একটা রুট দেওয়া হলো', r.name || ' · ' || coalesce(v_absent, '') || '-এর বদলে' ||
      coalesce(' · ' || nullif(array_to_string(r.areas[1:6], ', '), ''), ''), '/app/staff', 'route');
  end if;
  return v_id;
end $$;

-- The cover's delivery result, written by the hub manager or the cover himself (when the sheet does not show it).
create or replace function public.route_cover_update(p_id uuid, p_delivered integer, p_returned integer default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.route_covers;
begin
  select * into c from public.route_covers where id = p_id for update;
  if c.id is null then raise exception 'Cover not found' using errcode = 'P0002'; end if;
  if not (private.has_permission('ops.route.edit', null, c.hub_id) or c.cover_employee_id = private.my_employee_id()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if c.work_date < private.dhaka_today() - 1 then raise exception 'Only today or yesterday' using errcode = '22023'; end if;
  update public.route_covers set delivered = p_delivered, returned = p_returned, update_note = nullif(trim(coalesce(p_note, '')), ''),
         updated_by_name = private.my_display_name(), update_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Staff day notes (and today's route cover for the staff member)
-- ---------------------------------------------------------------------
create or replace function public.my_day_note() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id(); v_date date := private.dhaka_today();
begin
  if v_emp is null then return null; end if;
  return jsonb_build_object('work_date', v_date,
    'note', (select jsonb_build_object('work', n.work, 'suggestion', n.suggestion, 'updated_at', n.updated_at)
               from public.staff_day_notes n where n.employee_id = v_emp and n.work_date = v_date),
    'covers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'route', r.name, 'areas', r.areas,
        'for', (select x.full_name from public.employees x where x.id = c.absent_employee_id), 'note', c.note, 'delivered', c.delivered,
        'sheet', private.sheet_day(v_emp, v_date)))
      from public.route_covers c join public.hub_routes r on r.id = c.route_id
     where c.cover_employee_id = v_emp and c.work_date = v_date), '[]'::jsonb));
end $$;

create or replace function public.my_day_note_save(p_work text, p_suggestion text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees;
begin
  select * into e from public.employees where id = private.my_employee_id();
  if e.id is null then raise exception 'No active staff profile is linked to your login' using errcode = '42501'; end if;
  if length(trim(coalesce(p_work, ''))) = 0 and length(trim(coalesce(p_suggestion, ''))) = 0 then raise exception 'Write something first' using errcode = '22023'; end if;
  insert into public.staff_day_notes (employee_id, hub_id, zone_id, work_date, work, suggestion)
  values (e.id, e.hub_id, e.zone_id, private.dhaka_today(), nullif(trim(coalesce(p_work, '')), ''), nullif(trim(coalesce(p_suggestion, '')), ''))
  on conflict (employee_id, work_date) do update set work = excluded.work, suggestion = excluded.suggestion, updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 4. The zonal manager's day report
-- ---------------------------------------------------------------------
create or replace function public.zone_daily_report(p_zone uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_zone is null or not private.has_permission('zonal.daily_report.view', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  return jsonb_build_object('zone_id', p_zone, 'date', p_date,
    'hubs', coalesce((select jsonb_agg(x order by x->>'hub_name') from (
      select jsonb_build_object('hub_id', h.id, 'hub_name', h.name,
        'staff', (select count(*) from private.hub_staff(h.id)),
        'present', (select count(*) from private.hub_staff(h.id) s join public.attendance_records a on a.employee_id = s.id and a.work_date = p_date and a.status = 'present'),
        'late', (select count(*) from private.hub_staff(h.id) s join public.attendance_records a on a.employee_id = s.id and a.work_date = p_date and a.status = 'late'),
        'half_day', (select count(*) from private.hub_staff(h.id) s join public.attendance_records a on a.employee_id = s.id and a.work_date = p_date and a.status = 'half_day'),
        'absent', (select count(*) from private.hub_staff(h.id) s join public.attendance_records a on a.employee_id = s.id and a.work_date = p_date and a.status = 'absent'),
        'leave', (select count(*) from private.hub_staff(h.id) s join public.attendance_records a on a.employee_id = s.id and a.work_date = p_date and a.status = 'leave'),
        'unmarked', (select count(*) from private.hub_staff(h.id) s where not exists (select 1 from public.attendance_records a where a.employee_id = s.id and a.work_date = p_date)),
        'submitted_at', sb.submitted_at, 'submitted_by', sb.submitted_by_name, 'late_submit', sb.late_submit,
        'corrections', (select count(*) from public.attendance_corrections c join public.employees e on e.id = c.employee_id where e.hub_id = h.id and c.work_date = p_date)) x
      from public.hubs h left join public.hub_absence_submissions sb on sb.hub_id = h.id and sb.work_date = p_date
     where h.zone_id = p_zone and h.archived_at is null and exists (select 1 from private.hub_staff(h.id))) q), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(jsonb_build_object('hub_name', h.name, 'route_name', o.route_name, 'absent', o.full_name, 'absent_code', o.employee_code,
        'reason', o.reason, 'cover', c.cover_name, 'cover_phone', c.cover_phone, 'assigned_at', c.assigned_at,
        'sheet', case when c.cover_employee_id is null then null else private.sheet_day(c.cover_employee_id, p_date) end,
        'delivered', c.delivered, 'update_note', c.update_note,
        'problem', case when c.id is null then 'no_cover'
                        when c.delivered is null and private.sheet_day(c.cover_employee_id, p_date) is null then 'no_update' end)
        order by h.name, o.route_name)
      from public.hubs h cross join lateral private.riders_out(h.id, p_date) o
      left join public.route_covers c on c.route_id = o.route_id and c.work_date = p_date and c.absent_employee_id = o.employee_id
     where h.zone_id = p_zone and h.archived_at is null), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
        'hub_name', h.name, 'position', coalesce(p.name_bn, p.name), 'attendance', a.status, 'sheet', private.sheet_day(e.id, p_date),
        'routes', (select string_agg(r.name, ', ') from public.rider_routes rr join public.hub_routes r on r.id = rr.route_id
                    where rr.employee_id = e.id and rr.effective_from <= p_date and (rr.effective_to is null or rr.effective_to >= p_date)),
        'covered_for', (select string_agg(x.full_name, ', ') from public.route_covers c join public.employees x on x.id = c.absent_employee_id
                    where c.cover_employee_id = e.id and c.work_date = p_date),
        'bills', (select count(*) from public.da_expense_claims b where b.employee_id = e.id and b.bill_date = p_date),
        'work', n.work, 'suggestion', n.suggestion) order by h.name, e.full_name)
      from public.employees e join public.hubs h on h.id = e.hub_id
      left join public.positions p on p.id = e.position_id
      left join public.attendance_records a on a.employee_id = e.id and a.work_date = p_date
      left join public.staff_day_notes n on n.employee_id = e.id and n.work_date = p_date
     where h.zone_id = p_zone and e.archived_at is null and e.status = 'active' and private.is_hub_post(e.position_id)), '[]'::jsonb));
end $$;

revoke all on function public.hub_absence_sheet(uuid, date), public.hub_absence_submit(uuid, jsonb, text), public.att_correct(uuid, date, text, text),
  public.route_cover_list(uuid, date), public.route_cover_assign(uuid, uuid, text, text, date), public.route_cover_update(uuid, integer, integer, text),
  public.my_day_note(), public.my_day_note_save(text, text), public.zone_daily_report(uuid, date) from public, anon;
grant execute on function public.hub_absence_sheet(uuid, date), public.hub_absence_submit(uuid, jsonb, text), public.att_correct(uuid, date, text, text),
  public.route_cover_list(uuid, date), public.route_cover_assign(uuid, uuid, text, text, date), public.route_cover_update(uuid, integer, integer, text),
  public.my_day_note(), public.my_day_note_save(text, text), public.zone_daily_report(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Jobs (run by the scheduler; each returns how many notices it sent)
-- ---------------------------------------------------------------------
-- Every hour 08:00–20:00: hubs with a rider out and no cover on the route.
create or replace function private.job_route_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; v_n integer := 0; v_date date := private.dhaka_today(); v_hour integer := extract(hour from now() at time zone 'Asia/Dhaka');
begin
  if v_hour < 8 or v_hour > 20 then return 0; end if;
  for h in
    select hb.id, hb.zone_id, hb.name, string_agg(o.full_name || ' (' || o.route_name || ')', ', ' order by o.route_name) who, count(*) c
      from public.hubs hb cross join lateral private.riders_out(hb.id, v_date) o
     where hb.archived_at is null
       and not exists (select 1 from public.route_covers c where c.route_id = o.route_id and c.work_date = v_date and c.absent_employee_id = o.employee_id)
     group by hb.id, hb.zone_id, hb.name
  loop
    v_n := v_n + private.notify_holders('ops.route.edit', null, h.id, 'রুট কাকে দিচ্ছেন? ' || h.c || 'টি রুট খালি',
      h.name || ': ' || h.who || ' — ছুটিতে / অনুপস্থিত। রুট এসাইন না করা পর্যন্ত প্রতি ঘণ্টায় মনে করানো হবে।', '/app/hub/routes', 'route');
  end loop;
  return v_n;
end $$;

-- 11:05: hubs that have not sent today's absent list.
create or replace function private.job_absence_deadline() returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; v_n integer := 0; v_date date := private.dhaka_today();
begin
  for h in
    select hb.id, hb.zone_id, hb.name from public.hubs hb
     where hb.archived_at is null and exists (select 1 from private.hub_staff(hb.id))
       and not exists (select 1 from public.hub_absence_submissions s where s.hub_id = hb.id and s.work_date = v_date)
  loop
    v_n := v_n + private.notify_holders('hr.attendance.create', null, h.id, 'অনুপস্থিত তালিকা ১১টার মধ্যে দেওয়া হয়নি',
      h.name || ' — এখনই দিন; বাকি সবাই উপস্থিত হয়ে যাবে।', '/app/hub/attendance', 'attendance');
    v_n := v_n + private.notify_holders('zonal.daily_report.view', h.zone_id, null, 'হাব ১১টার মধ্যে অনুপস্থিত দেয়নি', h.name,
      '/app/zonal/daily-report?date=' || v_date, 'attendance');
  end loop;
  return v_n;
end $$;

-- Just after midnight: yesterday's report to each zone's zonal manager.
create or replace function private.job_midnight_report() returns integer
language plpgsql security definer set search_path = '' as $$
declare z record; v_n integer := 0; v_date date := private.dhaka_today() - 1;
  v_nocover integer; v_noupd integer; v_late integer; v_miss integer; v_sugg integer; v_notes integer;
begin
  for z in select id, name from public.zones where archived_at is null loop
    select count(*) filter (where c.id is null),
           count(*) filter (where c.id is not null and c.delivered is null and private.sheet_day(c.cover_employee_id, v_date) is null)
      into v_nocover, v_noupd
      from public.hubs h cross join lateral private.riders_out(h.id, v_date) o
      left join public.route_covers c on c.route_id = o.route_id and c.work_date = v_date and c.absent_employee_id = o.employee_id
     where h.zone_id = z.id and h.archived_at is null;
    select count(*) filter (where s.late_submit), count(*) filter (where s.id is null) into v_late, v_miss
      from public.hubs h left join public.hub_absence_submissions s on s.hub_id = h.id and s.work_date = v_date
     where h.zone_id = z.id and h.archived_at is null and exists (select 1 from private.hub_staff(h.id));
    select count(*) filter (where n.suggestion is not null), count(*) into v_sugg, v_notes
      from public.staff_day_notes n where n.zone_id = z.id and n.work_date = v_date;
    v_n := v_n + private.notify_holders('zonal.daily_report.view', z.id, null, 'গতকালের কাজের রিপোর্ট — ' || z.name,
      concat_ws(' · ',
        case when v_nocover > 0 then v_nocover || 'টি রুটে কেউ যায়নি' end,
        case when v_noupd > 0 then v_noupd || 'টি রুটের ডেলিভারি আপডেট নেই' end,
        case when v_miss > 0 then v_miss || 'টি হাব অনুপস্থিত দেয়নি' end,
        case when v_late > 0 then v_late || 'টি হাব দেরিতে দিয়েছে' end,
        v_notes || ' জন কাজের নোট', case when v_sugg > 0 then v_sugg || 'টি পরামর্শ' end),
      '/app/zonal/daily-report?date=' || v_date, 'report');
  end loop;
  return v_n;
end $$;
revoke all on function private.job_route_reminders(), private.job_absence_deadline(), private.job_midnight_report() from public, anon, authenticated;

-- The scheduler: Supabase has pg_cron; a database without it (local tests) just skips this. Cron times are UTC (Dhaka − 6 h).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('xzm-route-reminders', '0 2-14 * * *', 'select private.job_route_reminders()');   -- 08:00–20:00 Dhaka, hourly
    perform cron.schedule('xzm-absence-deadline', '5 5 * * *', 'select private.job_absence_deadline()');    -- 11:05 Dhaka
    perform cron.schedule('xzm-midnight-report', '10 18 * * *', 'select private.job_midnight_report()');    -- 00:10 Dhaka
  else
    raise notice 'pg_cron is not available here: reminders and the midnight report will not run on a schedule.';
  end if;
end $$;
