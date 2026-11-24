-- =====================================================================
--  দৈনিক ও মাসিক হাজিরা খাতা: সংস্করণ, সময়ে অটো সাবমিট, সীমিত সংশোধন, যাচাই (step 2 of 3)
--
--  Owner (24 Nov): the daily register becomes versioned and time-bound.
--    * Every submit makes a numbered version of the register (a copy of its lines is kept). A manual submit and the server job
--      that meet at the same moment make ONE version (advisory lock).
--    * When the Dhaka date changes, an open register is submitted by the server at the zone's next-day time + extra minutes
--      (wf_att_policy.day_time / day_extra from step 1). Lines the manager did not finish are submitted as "যাচাই বাকি"
--      (unchecked) — or "ছুটির আবেদন বিচারাধীন" when a leave request is waiting. Nothing is guessed.
--    * An approved leave puts itself on the line (status leave, the leave's reference and the date it was applied for — the date
--      that goes into the report). A waiting leave request is shown on its own. "Marked online" and its date and time come from the
--      person's own mark (the server time of that mark), never from what the manager types; a reason is asked only when there is none.
--      An absence has either a reason (known) or none (unknown, "না জানিয়ে").
--    * A past day is closed. The zonal manager opens a hub for one day, a range or a whole month for some minutes, with a reason; the
--      opening (from, to, expiry, reason, who) is logged. Corrected days are submitted as new versions. When the time is over the
--      permission ends and any draft left in the range is submitted by the server.
--    * Monthly register: a numbered submission made from the daily registers' versions (a map date -> version). A missing day is named.
--      After a daily register is corrected the old monthly version stays and the month must be submitted again.
--    * Checking: the zonal manager sends a daily or monthly register to the hub's managers; each marks it right or sends back the
--      reason. A check belongs to ONE version. Opening again needs the zonal manager.
--
--  Sits on 20261122000800_att_final_sheet and 20261124000100_morning_input. Replaced (same signatures): private.att_line_prefill,
--  private.att_sheet_write, public.att_sheet_get / att_sheet_submit / att_sheet_unlock / att_sheet_send / att_sheet_check_ok /
--  att_zone_day. New: att_sheet_versions, att_reopen_windows, att_month_subs, att_month_checks. No new permission:
--  hr.attendance.create (hub manager), hr.attendance.configure (zonal manager: reopen, send, times), hr.attendance.view (read).
--
--  Undo: drop the new functions (att_reopen_*, att_month_*, att_sheet_check_return, att_sheet_versions_list, private.att_*) and tables,
--  drop the added columns, restore the old definitions from 20261122000800_att_final_sheet.sql, unschedule the two cron jobs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns, constraints, tables
-- ---------------------------------------------------------------------
alter table public.att_day_sheets
  add column if not exists version     integer not null default 0 check (version >= 0),      -- the number of the last submitted version
  add column if not exists submit_mode text check (submit_mode is null or submit_mode in ('manager', 'auto')),
  add column if not exists window_id   uuid;

alter table public.att_day_lines
  add column if not exists online_at         timestamptz,                                      -- the server time of the person's own mark
  add column if not exists absence_reason    text check (absence_reason is null or length(absence_reason) <= 500),
  add column if not exists leave_ref         text check (leave_ref is null or length(leave_ref) <= 60),
  add column if not exists leave_applied_on  date;

alter table public.att_day_lines drop constraint if exists att_day_lines_final_status_check;
alter table public.att_day_lines add constraint att_day_lines_final_status_check
  check (final_status in ('present', 'late', 'half_day', 'absent', 'leave', 'holiday', 'weekly_off', 'pending_leave', 'unchecked'));

alter table public.att_sheet_checks
  add column if not exists version_no    integer not null default 1,
  add column if not exists returned_at   timestamptz,
  add column if not exists return_reason text check (return_reason is null or length(return_reason) <= 500);
alter table public.att_sheet_checks drop constraint if exists att_sheet_checks_sheet_id_profile_id_key;
create unique index if not exists att_sheet_checks_one_per_version on public.att_sheet_checks (sheet_id, profile_id, version_no);

create table if not exists public.att_reopen_windows (
  id           uuid primary key default gen_random_uuid(),
  hub_id       uuid not null references public.hubs(id),
  zone_id      uuid references public.zones(id),
  from_date    date not null,
  to_date      date not null,
  expires_at   timestamptz not null,
  reason       text not null check (length(btrim(reason)) between 3 and 500),
  approved_by  uuid, approved_by_name text,
  status       text not null default 'open' check (status in ('open', 'expired', 'closed')),
  closed_at    timestamptz, closed_by uuid, close_note text check (close_note is null or length(close_note) <= 500),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (to_date >= from_date),
  check ((status = 'open') = (closed_at is null))
);
create index if not exists att_reopen_windows_hub on public.att_reopen_windows (hub_id, status);
create index if not exists att_reopen_windows_zone on public.att_reopen_windows (zone_id);

create table if not exists public.att_sheet_versions (
  id           uuid primary key default gen_random_uuid(),
  sheet_id     uuid not null references public.att_day_sheets(id),
  hub_id       uuid not null references public.hubs(id),
  work_date    date not null,
  version_no   integer not null check (version_no >= 1),
  mode         text not null check (mode in ('manager', 'auto')),
  window_id    uuid references public.att_reopen_windows(id),
  lines        jsonb not null check (jsonb_typeof(lines) = 'array'),
  submitted_by uuid, submitted_by_name text, submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (sheet_id, version_no)
);
create index if not exists att_sheet_versions_hub_day on public.att_sheet_versions (hub_id, work_date);
create index if not exists att_sheet_versions_window on public.att_sheet_versions (window_id) where window_id is not null;

create table if not exists public.att_month_subs (
  id           uuid primary key default gen_random_uuid(),
  hub_id       uuid not null references public.hubs(id),
  zone_id      uuid references public.zones(id),
  month        date not null check (extract(day from month) = 1),
  version_no   integer not null check (version_no >= 1),
  day_versions jsonb not null check (jsonb_typeof(day_versions) = 'object'),     -- {"2026-11-01": 2, ...} the daily versions it was made from
  submitted_by uuid, submitted_by_name text, submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (hub_id, month, version_no)
);
create index if not exists att_month_subs_zone on public.att_month_subs (zone_id);

create table if not exists public.att_month_checks (
  id            uuid primary key default gen_random_uuid(),
  sub_id        uuid not null references public.att_month_subs(id),
  profile_id    uuid not null,
  employee_id   uuid references public.employees(id),
  sent_by       uuid, sent_at timestamptz not null default now(),
  ok_at         timestamptz,
  returned_at   timestamptz, return_reason text check (return_reason is null or length(return_reason) <= 500),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (sub_id, profile_id)
);
create index if not exists att_month_checks_emp on public.att_month_checks (employee_id);

-- the new tables are read through the functions only (RLS on, no policy, no grant)
do $$
declare t text;
begin
  foreach t in array array['att_reopen_windows', 'att_sheet_versions', 'att_month_subs', 'att_month_checks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'hr');
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
-- When an open register of a date is submitted by the server: the next day at the zone's time + extra minutes (Asia/Dhaka).
create or replace function private.wf_day_due(p_zone uuid, p_date date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((p_date + 1 + coalesce(p.day_time, nullif(private.wf_setting_text('workforce.day_close_time', '00:00'), '')::time, time '00:00')
           + make_interval(mins => coalesce(p.day_extra, private.wf_int('workforce.day_close_extra_min', 0, 0, 360))))::timestamp at time zone 'Asia/Dhaka')
  from (select 1) one left join public.wf_att_policy p on p.zone_id = p_zone
$$;

-- An open reopening of the hub that covers the date.
create or replace function private.att_open_window(p_hub uuid, p_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select w.id from public.att_reopen_windows w where w.hub_id = p_hub and w.status = 'open' and w.expires_at > now() and p_date between w.from_date and w.to_date
   order by w.expires_at desc limit 1
$$;

-- May a register of this hub and date be written now? Today always; a past day only inside an open reopening, or before the server closes it.
create or replace function private.att_edit_open(p_hub uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_date = private.wf_today()
      or (p_date < private.wf_today() and (private.att_open_window(p_hub, p_date) is not null or now() < private.wf_day_due(private.hub_zone(p_hub), p_date)))
$$;

-- Leave of a person on a date: approved (with its reference and the date it was applied for), else waiting.
create or replace function private.att_leave_state(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('state', 'approved', 'ref', x ->> 'ref', 'applied_on', x ->> 'applied_on') from (select private.wf_leave_on(p_employee, p_date) as x) q where x is not null),
    (select jsonb_build_object('state', 'pending', 'ref', 'LR-' || upper(left(l.id::text, 8)), 'applied_on', (l.created_at at time zone 'Asia/Dhaka')::date)
       from public.leave_requests l where l.employee_id = p_employee and l.status = 'pending' and p_date between l.from_date and l.to_date order by l.created_at limit 1),
    (select jsonb_build_object('state', 'pending', 'ref', w.application_no, 'applied_on', (w.created_at at time zone 'Asia/Dhaka')::date)
       from public.wf_absence_applications w where w.employee_id = p_employee and w.status = 'pending' and p_date = any(w.dates) order by w.created_at limit 1))
$$;

-- What is still missing on a line (null = complete).
create or replace function private.att_line_gap(l public.att_day_lines) returns text
language sql immutable set search_path = '' as $$
  select case
    when l.final_status is null or l.final_status = 'unchecked' then 'হাজিরা বাছুন'
    when l.final_status = 'pending_leave' then 'ছুটির আবেদন বিচারাধীন — হাজিরা বাছুন'
    when l.self_mark_id is not null and l.manager_ok is null then 'হ্যাঁ / না দিন'
    when l.final_status = 'late' and l.late_time is null then 'কখন এসেছেন — সময় দিন'
    when l.final_status in ('present', 'late', 'half_day') and l.online_marked is null then 'অনলাইনে হাজিরা দিয়েছেন কি না — বলুন'
    when l.final_status in ('present', 'late', 'half_day') and not l.online_marked and l.online_reason is null then 'অনলাইনে না দেওয়ার কারণ লিখুন'
    when l.final_status = 'absent' and not l.unauthorized and l.absence_app_date is null and l.absence_reason is null then 'কারণ বা আবেদনের তারিখ দিন, অথবা "না জানিয়ে অনুপস্থিত" দিন'
  end
$$;

-- What a line looks like before the manager touches it. Approved leave, the person's own mark and its server time are filled in.
create or replace function private.att_line_prefill(p_emp uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'manager_ok', null,
    'final_status', case when lv.j ->> 'state' = 'approved' then 'leave'
                         else coalesce(r.status, case m.kind when 'present' then 'present' when 'absent' then 'absent' end,
                                       case when lv.j ->> 'state' = 'pending' then 'pending_leave' end) end,
    'late_time', case when r.status = 'late' and r.check_in is not null then to_char(r.check_in at time zone 'Asia/Dhaka', 'HH24:MI') end,
    'online_marked', case when m.kind = 'present' then true end, 'online_reason', null, 'online_at', case when m.kind = 'present' then m.marked_at end,
    'absence_app_date', case when lv.j ->> 'state' = 'approved' then (lv.j ->> 'applied_on')::date
                             when m.kind = 'absent' then coalesce(m.site_applied_on, (a.created_at at time zone 'Asia/Dhaka')::date) end,
    'absence_app_ref', case when lv.j ->> 'state' = 'approved' then lv.j ->> 'ref' when m.kind = 'absent' then coalesce(m.site_ref, a.application_no) end,
    'absence_reason', null,
    'leave_ref', case when lv.j ->> 'state' = 'approved' then lv.j ->> 'ref' end,
    'leave_applied_on', case when lv.j ->> 'state' = 'approved' then (lv.j ->> 'applied_on')::date end,
    'leave_pending', case when lv.j ->> 'state' = 'pending' then lv.j end,
    'unauthorized', false, 'note', null)
  from (select 1) one
  left join public.attendance_self_marks m on m.employee_id = p_emp and m.work_date = p_date
  left join public.wf_absence_applications a on a.id = m.application_id
  left join public.attendance_records r on r.employee_id = p_emp and r.work_date = p_date
  left join lateral (select private.att_leave_state(p_emp, p_date) as j) lv on true
$$;

-- write the given lines of a sheet (draft only); returns the sheet id
create or replace function private.att_sheet_write(p_hub uuid, p_date date, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.att_day_sheets; x jsonb; v_emp uuid; v_st text; v_late time; v_mark public.attendance_self_marks; v_pos uuid; v_leave jsonb; v_online boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null or p_date is null then raise exception 'Choose a hub and a date — হাব ও তারিখ বাছুন' using errcode = '22023'; end if;
  if not private.has_permission('hr.attendance.create', private.hub_zone(p_hub), p_hub) then
    raise exception 'You may not keep this hub''s register — এই হাবের হাজিরা খাতা লেখার অনুমতি নেই' using errcode = '42501';
  end if;
  if p_date > private.wf_today() then raise exception 'A future date cannot be written — আগামী তারিখের খাতা লেখা যায় না' using errcode = '22023'; end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then raise exception 'Lines must be a list' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('att_sheet:' || p_hub::text || p_date::text, 0));

  insert into public.att_day_sheets (hub_id, zone_id, work_date, created_by, updated_by)
  values (p_hub, private.hub_zone(p_hub), p_date, auth.uid(), auth.uid())
  on conflict (hub_id, work_date) do nothing;
  select * into s from public.att_day_sheets where hub_id = p_hub and work_date = p_date for update;
  if s.status = 'submitted' then
    raise exception 'This register is submitted and locked — only the zonal manager can unlock it — খাতা সাবমিট হয়ে লক হয়ে গেছে, জোনাল ম্যানেজার খুলে দিলে বদলানো যাবে' using errcode = 'P0001';
  end if;
  if not private.att_edit_open(p_hub, p_date) then
    raise exception 'This day is closed — the zonal manager opens it for correction — এই দিনের খাতা বন্ধ, জোনাল ম্যানেজার সংশোধনের জন্য খুললে লেখা যাবে' using errcode = 'P0001';
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_emp := nullif(x ->> 'employee_id', '')::uuid;
    if v_emp is null or not exists (select 1 from private.att_sheet_people(p_hub, p_date) pp where pp = v_emp) then
      raise exception 'A person on the list is not in this hub — তালিকার একজন এই হাবের কর্মী নন' using errcode = '22023';
    end if;
    v_st := nullif(x ->> 'final_status', '');
    v_leave := private.wf_leave_on(v_emp, p_date);
    if v_leave is not null then v_st := 'leave'; end if;                       -- approved leave puts itself on the line
    v_late := case when v_st = 'late' then nullif(x ->> 'late_time', '')::time end;
    select * into v_mark from public.attendance_self_marks m where m.employee_id = v_emp and m.work_date = p_date;
    select e.position_id into v_pos from public.employees e where e.id = v_emp;
    -- "marked online" and its time are the person's own mark; the manager only gives the reason when there is none
    v_online := case when v_st in ('present', 'late', 'half_day') then coalesce(v_mark.id is not null and v_mark.kind = 'present', false) end;
    insert into public.att_day_lines as l (sheet_id, employee_id, position_id, self_mark_id, staff_kind, manager_ok, final_status, late_time,
                                           online_marked, online_at, online_reason, absence_app_date, absence_app_ref, absence_reason, unauthorized, note,
                                           leave_ref, leave_applied_on, updated_by)
    values (s.id, v_emp, v_pos, v_mark.id, v_mark.kind,
            case when v_mark.id is not null and jsonb_typeof(x -> 'manager_ok') = 'boolean' then (x -> 'manager_ok')::text::boolean end,
            v_st, v_late,
            v_online, case when v_online then v_mark.marked_at end,
            case when v_online is false then private.wf_clean(x ->> 'online_reason') end,
            case when v_st = 'leave' then (v_leave ->> 'applied_on')::date when v_st = 'absent' then nullif(x ->> 'absence_app_date', '')::date end,
            case when v_st = 'leave' then v_leave ->> 'ref' when v_st = 'absent' then private.wf_clean(x ->> 'absence_app_ref', 60) end,
            case when v_st = 'absent' and not coalesce((x ->> 'unauthorized')::boolean, false) then private.wf_clean(x ->> 'absence_reason') end,
            coalesce((x ->> 'unauthorized')::boolean and v_st = 'absent', false),
            private.wf_clean(x ->> 'note'),
            case when v_st = 'leave' then v_leave ->> 'ref' end, case when v_st = 'leave' then (v_leave ->> 'applied_on')::date end, auth.uid())
    on conflict (sheet_id, employee_id) do update set
      position_id = excluded.position_id, self_mark_id = excluded.self_mark_id, staff_kind = excluded.staff_kind,
      manager_ok = excluded.manager_ok, final_status = excluded.final_status, late_time = excluded.late_time,
      online_marked = excluded.online_marked, online_at = excluded.online_at, online_reason = excluded.online_reason,
      absence_app_date = excluded.absence_app_date, absence_app_ref = excluded.absence_app_ref, absence_reason = excluded.absence_reason,
      unauthorized = excluded.unauthorized, note = excluded.note, leave_ref = excluded.leave_ref, leave_applied_on = excluded.leave_applied_on,
      updated_at = now(), updated_by = auth.uid();
  end loop;
  update public.att_day_sheets set updated_at = now(), updated_by = auth.uid() where id = s.id;
  return s.id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Closing a register (by the manager, or by the server): one place, one version
-- ---------------------------------------------------------------------
-- p_strict: the manager's submit — an unfinished line stops it. Not strict: the server's submit — an unfinished line becomes "unchecked".
-- Returns null when the register was already submitted (the other caller got there first).
create or replace function private.att_sheet_close(p_hub uuid, p_date date, p_by uuid, p_mode text, p_strict boolean, p_window uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.att_day_sheets; ln record; v_rec uuid; v_bad text; v_asked integer := 0; v_written integer := 0; v_reasons text[]; v_r text; v_prof uuid;
  v_hub text := private.hub_name(p_hub); v_name text; v_leave jsonb; v_no integer; v_zone uuid := private.hub_zone(p_hub); v_left integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('att_sheet:' || p_hub::text || p_date::text, 0));
  insert into public.att_day_sheets (hub_id, zone_id, work_date) values (p_hub, v_zone, p_date) on conflict (hub_id, work_date) do nothing;
  select * into s from public.att_day_sheets where hub_id = p_hub and work_date = p_date for update;
  if s.status = 'submitted' then return null; end if;

  -- everyone of the hub is on the register
  insert into public.att_day_lines (sheet_id, employee_id, position_id, updated_by)
  select s.id, pp, e.position_id, p_by from private.att_sheet_people(p_hub, p_date) pp join public.employees e on e.id = pp
  on conflict (sheet_id, employee_id) do nothing;
  -- approved leave puts itself on the line; "marked online" and its time come from the person's own mark
  for ln in select x.id, x.employee_id from public.att_day_lines x where x.sheet_id = s.id loop
    v_leave := private.wf_leave_on(ln.employee_id, p_date);
    if v_leave is not null then
      update public.att_day_lines set final_status = 'leave', late_time = null, unauthorized = false, absence_reason = null, online_marked = null, online_at = null, online_reason = null,
             absence_app_date = (v_leave ->> 'applied_on')::date, absence_app_ref = v_leave ->> 'ref', leave_ref = v_leave ->> 'ref', leave_applied_on = (v_leave ->> 'applied_on')::date
       where id = ln.id;
    end if;
  end loop;
  update public.att_day_lines l set
         online_marked = coalesce((select m.kind = 'present' from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date), false),
         online_at = (select m.marked_at from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present'),
         online_reason = case when exists (select 1 from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present')
                              then null else l.online_reason end
   where l.sheet_id = s.id and l.final_status in ('present', 'late', 'half_day');

  if p_strict then
    select string_agg(e.full_name || ': ' || w, '; ' order by e.full_name) into v_bad
      from (select l.employee_id, private.att_line_gap(l) w from public.att_day_lines l where l.sheet_id = s.id) z join public.employees e on e.id = z.employee_id
     where w is not null;
    if v_bad is not null then raise exception 'Some lines are not complete — কিছু সারি অসম্পূর্ণ: %', v_bad using errcode = '22023'; end if;
  else
    -- the server never guesses: an unfinished line is "unchecked" (or "leave request waiting")
    for ln in select l.*, private.att_line_gap(l) as gap from public.att_day_lines l where l.sheet_id = s.id loop
      continue when ln.gap is null;
      update public.att_day_lines set final_status = case when private.att_leave_state(ln.employee_id, p_date) ->> 'state' = 'pending' then 'pending_leave' else 'unchecked' end,
             late_time = null, unauthorized = false, absence_reason = null, online_marked = null, online_at = null, online_reason = null
       where id = ln.id;
    end loop;
  end if;

  perform set_config('app.wf_action', 'approved', true);
  for ln in select x.*, e.profile_id, e.full_name from public.att_day_lines x join public.employees e on e.id = x.employee_id where x.sheet_id = s.id loop
    continue when ln.final_status in ('unchecked', 'pending_leave');          -- nothing goes on the register for a line nobody has checked
    insert into public.attendance_records as r (employee_id, work_date, status, check_in, source, note, created_by, updated_by)
    values (ln.employee_id, p_date, ln.final_status,
            case when ln.late_time is not null then ((p_date + ln.late_time) at time zone 'Asia/Dhaka') when ln.final_status in ('present', 'half_day') then null end,
            'manual', coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), p_by, p_by)
    on conflict (employee_id, work_date) do update set status = excluded.status, check_in = coalesce(excluded.check_in, case when excluded.status in ('present', 'late', 'half_day') then r.check_in end),
      note = excluded.note, updated_by = p_by
    returning r.id into v_rec;
    v_written := v_written + 1;
    update public.attendance_self_marks m set status = 'approved',
           decided_as = case when ln.final_status in ('present', 'late', 'half_day', 'absent') then ln.final_status end,
           decided_by = p_by, decided_at = now(), attendance_id = v_rec, decide_note = 'দৈনিক ফাইনাল খাতা'
     where m.id = ln.self_mark_id and m.status = 'waiting';

    v_reasons := array_remove(array[case when ln.manager_ok is false then 'not_ok' end, case when ln.final_status = 'late' then 'late' end,
                                    case when ln.unauthorized then 'unauthorized' end], null);
    delete from public.att_explanations q where q.line_id = ln.id and q.reply is null and not (q.reason = any (v_reasons));
    foreach v_r in array v_reasons loop
      insert into public.att_explanations (line_id, sheet_id, employee_id, hub_id, zone_id, work_date, reason, asked_by)
      values (ln.id, s.id, ln.employee_id, p_hub, s.zone_id, p_date, v_r, p_by)
      on conflict (line_id, reason) do nothing;
      if found then
        v_asked := v_asked + 1;
        perform private.notify(ln.profile_id, 'হাজিরার ব্যাখ্যা চাওয়া হয়েছে',
          to_char(p_date, 'DD-MM-YYYY') || ' — ' || case v_r when 'not_ok' then 'আপনার দেওয়া হাজিরা ঠিক নেই' when 'late' then 'দেরিতে আসা' else 'না জানিয়ে অনুপস্থিত' end
          || '। কারণ লিখে জবাব দিন।', '/app/attendance', 'attendance_gap');
      end if;
    end loop;
  end loop;
  perform set_config('app.wf_action', '', true);

  v_no := s.version + 1;
  select coalesce(pr.full_name, case when p_by is null then 'সার্ভার (অটো)' else 'user' end) into v_name from (select 1) one left join public.profiles pr on pr.id = p_by;
  update public.att_day_sheets set status = 'submitted', submitted_by = p_by, submitted_at = now(), version = v_no, submit_mode = p_mode, window_id = p_window,
         updated_at = now() where id = s.id;
  insert into public.att_sheet_versions (sheet_id, hub_id, work_date, version_no, mode, window_id, lines, submitted_by, submitted_by_name)
    select s.id, p_hub, p_date, v_no, p_mode, p_window, coalesce(jsonb_agg(to_jsonb(l) - 'updated_by' order by l.employee_id), '[]'::jsonb), p_by, v_name
      from public.att_day_lines l where l.sheet_id = s.id;

  select count(*) into v_left from public.att_day_lines where sheet_id = s.id and final_status in ('unchecked', 'pending_leave');
  -- the zonal managers hear that the register came in; when the server did it, the hub's managers hear it too
  for v_prof in select distinct ur.user_id from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                 where ro.code = 'zonal_manager' and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
                   and (ur.zone_id = s.zone_id or ur.scope_type = 'global') loop
    perform private.notify(v_prof, case when p_mode = 'auto' then 'দৈনিক হাজিরা খাতা সার্ভার সাবমিট করেছে' else 'দৈনিক ফাইনাল হাজিরা খাতা সাবমিট হয়েছে' end,
      coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || case when v_left > 0 then ' · ' || v_left || ' জনের হাজিরা যাচাই বাকি' else '' end,
      '/app/attendance?view=zone&tab=final', 'attendance_gap');
  end loop;
  if p_mode = 'auto' then
    for v_prof in select * from private.wf_hub_managers(p_hub) loop
      perform private.notify(v_prof, 'দৈনিক হাজিরা খাতা সার্ভার সাবমিট করেছে', coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || case when v_left > 0 then ' · ' || v_left || ' জনের হাজিরা যাচাই বাকি' else '' end,
        '/app/attendance?view=hub&tab=final&hub=' || p_hub::text || '&date=' || p_date::text, 'attendance_gap');
    end loop;
  end if;
  return jsonb_build_object('sheet_id', s.id, 'lines', v_written, 'asked', v_asked, 'version', v_no, 'unchecked', v_left);
end $$;

-- ---------------------------------------------------------------------
-- 4. Read: one hub and a date (with version, due time, reopening, history) and the zonal manager's day
-- ---------------------------------------------------------------------
create or replace function public.att_sheet_get(p_hub uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, private.wf_today()); s public.att_day_sheets; v_people jsonb; v_checks jsonb; v_pos jsonb;
  v_zone uuid := private.hub_zone(p_hub);
begin
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  select * into s from public.att_day_sheets where hub_id = p_hub and work_date = v_date;

  with ppl as (
    select e.id, e.employee_code::text code, e.full_name, e.profile_id, po.code::text pcode,
           coalesce(nullif(po.name_bn, ''), po.name) pname, coalesce(po.sort_order, 999) psort
      from private.att_sheet_people(p_hub, v_date) pp join public.employees e on e.id = pp
      left join public.positions po on po.id = coalesce((select l.position_id from public.att_day_lines l where l.sheet_id = s.id and l.employee_id = e.id), e.position_id)
  ), rows as (
    select p.*, m.id mark_id, m.kind, m.note mnote, m.status mstatus, m.marked_at, m.applied_on_site, m.site_applied_on, m.site_ref, a.application_no,
           l.id line_id, r.status rec,
           case when l.id is not null then jsonb_build_object('manager_ok', l.manager_ok, 'final_status', l.final_status,
                  'late_time', to_char(l.late_time, 'HH24:MI'), 'online_marked', l.online_marked, 'online_reason', l.online_reason,
                  'absence_app_date', l.absence_app_date, 'absence_app_ref', l.absence_app_ref, 'unauthorized', l.unauthorized, 'note', l.note,
                  'online_at', l.online_at, 'absence_reason', l.absence_reason, 'leave_ref', l.leave_ref, 'leave_applied_on', l.leave_applied_on,
                  'leave_pending', (select private.att_leave_state(p.id, v_date) where private.att_leave_state(p.id, v_date) ->> 'state' = 'pending'))
                else private.att_line_prefill(p.id, v_date) end val
      from ppl p
      left join public.attendance_self_marks m on m.employee_id = p.id and m.work_date = v_date
      left join public.wf_absence_applications a on a.id = m.application_id
      left join public.att_day_lines l on l.sheet_id = s.id and l.employee_id = p.id
      left join public.attendance_records r on r.employee_id = p.id and r.work_date = v_date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', x.id, 'code', x.code, 'name', x.full_name, 'position', x.pname, 'position_code', x.pcode, 'has_login', x.profile_id is not null,
           'mark', case when x.mark_id is null then null else jsonb_build_object('id', x.mark_id, 'kind', x.kind, 'note', x.mnote, 'status', x.mstatus,
                    'marked_at', x.marked_at, 'applied_on_site', x.applied_on_site, 'site_applied_on', x.site_applied_on, 'site_ref', x.site_ref,
                    'application_no', x.application_no) end,
           'saved', x.line_id is not null, 'value', x.val, 'record_status', x.rec,
           'explanations', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'reason', q.reason, 'asked_at', q.asked_at, 'reply', q.reply, 'replied_at', q.replied_at) order by q.asked_at)
                                     from public.att_explanations q where q.line_id = x.line_id), '[]'::jsonb))
         order by x.psort, x.full_name), '[]'::jsonb) into v_people
    from rows x;

  -- by position: how many, who gave nothing themself, and what the register says
  select coalesce(jsonb_agg(g order by (g ->> 'sort')::int, g ->> 'position'), '[]'::jsonb) into v_pos from (
    select jsonb_build_object('position', coalesce(p ->> 'position', '—'), 'sort', min(coalesce(po.sort_order, 999)),
      'total', count(*), 'not_given', count(*) filter (where p -> 'mark' = 'null'::jsonb),
      'present', count(*) filter (where p -> 'value' ->> 'final_status' in ('present', 'late', 'half_day')),
      'late', count(*) filter (where p -> 'value' ->> 'final_status' = 'late'),
      'absent', count(*) filter (where p -> 'value' ->> 'final_status' = 'absent'),
      'unauthorized', count(*) filter (where (p -> 'value' ->> 'unauthorized')::boolean),
      'off', count(*) filter (where p -> 'value' ->> 'final_status' in ('leave', 'holiday', 'weekly_off')),
      'blank', count(*) filter (where p -> 'value' ->> 'final_status' is null or p -> 'value' ->> 'final_status' in ('unchecked', 'pending_leave'))) g
    from jsonb_array_elements(v_people) p left join public.positions po on po.code::text = p ->> 'position_code'
    group by coalesce(p ->> 'position', '—')) t;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', c.profile_id, 'name', coalesce(e.full_name, pr.full_name), 'sent_at', c.sent_at, 'ok_at', c.ok_at,
           'returned_at', c.returned_at, 'return_reason', c.return_reason, 'version_no', c.version_no) order by e.full_name), '[]'::jsonb)
    into v_checks from public.att_sheet_checks c left join public.employees e on e.id = c.employee_id left join public.profiles pr on pr.id = c.profile_id
   where c.sheet_id = s.id and c.version_no = s.version;

  return jsonb_build_object(
    'hub', jsonb_build_object('id', p_hub, 'name', private.hub_name(p_hub)), 'date', v_date, 'today', private.wf_today(),
    'sheet', case when s.id is null then null else jsonb_build_object('id', s.id, 'status', s.status, 'submitted_at', s.submitted_at,
               'submitted_by_name', (select full_name from public.profiles where id = s.submitted_by),
               'unlocked_at', s.unlocked_at, 'unlock_note', s.unlock_note, 'sent_at', s.sent_at,
               'version', s.version, 'mode', s.submit_mode) end,
    'due', private.wf_day_due(v_zone, v_date),
    'window', (select jsonb_build_object('id', w.id, 'from', w.from_date, 'to', w.to_date, 'expires_at', w.expires_at, 'reason', w.reason, 'by', w.approved_by_name)
                 from public.att_reopen_windows w where w.id = private.att_open_window(p_hub, v_date)),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('no', v.version_no, 'mode', v.mode, 'at', v.submitted_at, 'by', v.submitted_by_name) order by v.version_no desc)
                            from public.att_sheet_versions v where v.sheet_id = s.id), '[]'::jsonb),
    'can', jsonb_build_object(
      'edit', private.has_permission('hr.attendance.create', v_zone, p_hub) and coalesce(s.status, 'draft') = 'draft' and v_date <= private.wf_today() and private.att_edit_open(p_hub, v_date),
      'unlock', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted',
      'send', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted'),
    'my_check', (select jsonb_build_object('sent_at', c.sent_at, 'ok_at', c.ok_at, 'returned_at', c.returned_at, 'return_reason', c.return_reason, 'version_no', c.version_no)
                   from public.att_sheet_checks c where c.sheet_id = s.id and c.profile_id = auth.uid() and c.version_no = s.version),
    'people', v_people, 'by_position', v_pos, 'checks', v_checks);
end $$;

create or replace function public.att_zone_day(p_zone uuid default null, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, private.wf_today()); v_hubs jsonb; v_marks jsonb; v_missing jsonb; v_expl jsonb; v_ids uuid[];
begin
  select coalesce(array_agg(h.hub_id), '{}') into v_ids from private.wf_hubs('hr.attendance.view', p_zone, null) h;

  -- per hub: the register's state and the managers' checks
  select coalesce(jsonb_agg(jsonb_build_object('hub_id', h.id, 'name', private.hub_name(h.id),
           'staff', (select count(*) from private.att_sheet_people(h.id, v_date)),
           'given', (select count(*) from public.attendance_self_marks m where m.hub_id = h.id and m.work_date = v_date),
           'sheet_id', s.id, 'status', s.status, 'submitted_at', s.submitted_at, 'sent_at', s.sent_at,
           'present', (select count(*) from public.att_day_lines l where l.sheet_id = s.id and l.final_status in ('present', 'late', 'half_day')),
           'late', (select count(*) from public.att_day_lines l where l.sheet_id = s.id and l.final_status = 'late'),
           'absent', (select count(*) from public.att_day_lines l where l.sheet_id = s.id and l.final_status = 'absent'),
           'unauthorized', (select count(*) from public.att_day_lines l where l.sheet_id = s.id and l.unauthorized),
           'checks', (select count(*) from public.att_sheet_checks c where c.sheet_id = s.id and c.version_no = s.version),
           'checks_ok', (select count(*) from public.att_sheet_checks c where c.sheet_id = s.id and c.version_no = s.version and c.ok_at is not null),
           'checks_returned', (select count(*) from public.att_sheet_checks c where c.sheet_id = s.id and c.version_no = s.version and c.returned_at is not null and c.ok_at is null),
           'version', s.version, 'mode', s.submit_mode,
           'unchecked', (select count(*) from public.att_day_lines l where l.sheet_id = s.id and l.final_status in ('unchecked', 'pending_leave')),
           'due', private.wf_day_due(h.zone_id, v_date),
           'can_manage', private.has_permission('hr.attendance.configure', h.zone_id, h.id))
         order by private.hub_name(h.id)), '[]'::jsonb) into v_hubs
    from public.hubs h left join public.att_day_sheets s on s.hub_id = h.id and s.work_date = v_date
   where h.id = any (v_ids);

  -- 1. what staff gave themselves
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name,
           'position', coalesce(nullif(po.name_bn, ''), po.name), 'hub_id', m.hub_id, 'hub', private.hub_name(m.hub_id),
           'kind', m.kind, 'note', m.note, 'marked_at', m.marked_at, 'status', m.status, 'site_applied_on', m.site_applied_on, 'site_ref', m.site_ref)
         order by private.hub_name(m.hub_id), e.full_name), '[]'::jsonb) into v_marks
    from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
    left join public.positions po on po.id = e.position_id
   where m.work_date = v_date and m.hub_id = any (v_ids);

  -- 2. who gave nothing themself, by position
  select coalesce(jsonb_agg(jsonb_build_object('position', t.pname, 'count', t.cnt, 'people', t.people) order by t.psort, t.pname), '[]'::jsonb) into v_missing from (
    select coalesce(coalesce(nullif(po.name_bn, ''), po.name), '—') pname, min(coalesce(po.sort_order, 999)) psort, count(*) cnt,
           jsonb_agg(jsonb_build_object('name', e.full_name, 'code', e.employee_code::text, 'hub', private.hub_name(e.hub_id)) order by private.hub_name(e.hub_id), e.full_name) people
      from unnest(v_ids) h(id) cross join lateral private.att_sheet_people(h.id, v_date) pp join public.employees e on e.id = pp
      left join public.positions po on po.id = e.position_id
     where not exists (select 1 from public.attendance_self_marks m where m.employee_id = e.id and m.work_date = v_date)
     group by coalesce(coalesce(nullif(po.name_bn, ''), po.name), '—')) t;

  -- the explanations asked and the replies (with the line's three facts: status, late time, application date)
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', e.full_name, 'code', e.employee_code::text, 'hub', private.hub_name(q.hub_id),
           'reason', q.reason, 'reply', q.reply, 'replied_at', q.replied_at, 'final_status', l.final_status,
           'late_time', to_char(l.late_time, 'HH24:MI'), 'absence_app_date', l.absence_app_date) order by private.hub_name(q.hub_id), e.full_name), '[]'::jsonb) into v_expl
    from public.att_explanations q join public.employees e on e.id = q.employee_id join public.att_day_lines l on l.id = q.line_id
   where q.work_date = v_date and q.hub_id = any (v_ids);

  return jsonb_build_object('date', v_date, 'today', private.wf_today(), 'hubs', v_hubs, 'marks', v_marks, 'missing', v_missing, 'explanations', v_expl);
end $$;

-- the monthly grid: a line nobody checked shows as U (not as leave)
create or replace function public.att_month_sheet(p_hub uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_m date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_last date; v_dates jsonb; v_people jsonb; v_days jsonb;
begin
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  v_last := least((v_m + interval '1 month' - interval '1 day')::date, private.wf_today());
  select coalesce(jsonb_agg(g::date order by g), '[]'::jsonb) into v_dates from generate_series(v_m, v_last, interval '1 day') g;
  select coalesce(jsonb_agg(jsonb_build_object('date', s.work_date, 'status', s.status) order by s.work_date), '[]'::jsonb) into v_days
    from public.att_day_sheets s where s.hub_id = p_hub and s.work_date between v_m and v_last;

  with ppl as (
    select distinct e.id, e.employee_code::text code, e.full_name, coalesce(nullif(po.name_bn, ''), po.name) pname, coalesce(po.sort_order, 999) psort
      from public.employees e left join public.positions po on po.id = e.position_id
     where (e.hub_id = p_hub and e.archived_at is null and e.status = 'active' and (e.joining_date is null or e.joining_date <= v_last))
        or e.id in (select l.employee_id from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                     where s.hub_id = p_hub and s.status = 'submitted' and s.work_date between v_m and v_last)
  )
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', p.id, 'code', p.code, 'name', p.full_name, 'position', p.pname,
           'cells', (select jsonb_agg(coalesce(c.v, '') order by dd.d) from (select (x)::text::date d from jsonb_array_elements_text(v_dates) x) dd
                       left join lateral (select case when l.final_status in ('present', 'late', 'half_day') then 'P' when l.final_status = 'absent' then 'A'
                                                      when l.final_status in ('unchecked', 'pending_leave') then 'U'
                                                      when l.final_status is not null then 'O' end v
                                            from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                                           where s.hub_id = p_hub and s.work_date = dd.d and s.status = 'submitted' and l.employee_id = p.id) c on true),
           'present', (select count(*) from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                        where s.hub_id = p_hub and s.status = 'submitted' and s.work_date between v_m and v_last and l.employee_id = p.id and l.final_status in ('present', 'late', 'half_day')),
           'absent', (select count(*) from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                        where s.hub_id = p_hub and s.status = 'submitted' and s.work_date between v_m and v_last and l.employee_id = p.id and l.final_status = 'absent'),
           'off', (select count(*) from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
                        where s.hub_id = p_hub and s.status = 'submitted' and s.work_date between v_m and v_last and l.employee_id = p.id and l.final_status in ('leave', 'holiday', 'weekly_off')))
         order by p.psort, p.full_name), '[]'::jsonb) into v_people from ppl p;

  return jsonb_build_object('hub', jsonb_build_object('id', p_hub, 'name', private.hub_name(p_hub)), 'month', v_m, 'today', private.wf_today(),
    'dates', v_dates, 'days', v_days, 'people', v_people);
end $$;

-- ---------------------------------------------------------------------
-- 5. Submit, reopen (by window), send for checking, check, send back
-- ---------------------------------------------------------------------
create or replace function public.att_sheet_submit(p_hub uuid, p_date date, p_lines jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.att_sheet_write(p_hub, p_date, p_lines);
  v := private.att_sheet_close(p_hub, p_date, auth.uid(), 'manager', true, private.att_open_window(p_hub, p_date));
  if v is null then raise exception 'This register is already submitted — খাতা আগেই সাবমিট হয়েছে' using errcode = 'P0001'; end if;
  return v;
end $$;

-- Open a hub's registers for correction: a day, a range or a whole month, for some minutes, with a reason. Submitted days in the range
-- become drafts (their last version is kept); days not made yet can be written. When the time is over the permission ends and
-- the server submits whatever is still a draft.
create or replace function private.att_reopen_do(p_hub uuid, p_from date, p_to date, p_minutes integer, p_reason text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub); v_id uuid; v_n integer; v_name text; m uuid;
begin
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = p_by;
  insert into public.att_reopen_windows (hub_id, zone_id, from_date, to_date, expires_at, reason, approved_by, approved_by_name)
  values (p_hub, v_zone, p_from, p_to, now() + make_interval(mins => p_minutes), p_reason, p_by, v_name) returning id into v_id;
  update public.att_day_sheets set status = 'draft', submitted_at = null, submitted_by = null, unlocked_by = p_by, unlocked_at = now(), unlock_note = p_reason,
         window_id = v_id, updated_at = now()
   where hub_id = p_hub and work_date between p_from and p_to and status = 'submitted';
  get diagnostics v_n = row_count;
  for m in select * from private.wf_hub_managers(p_hub) loop
    perform private.notify(m, 'হাজিরা খাতা সংশোধনের জন্য খোলা হয়েছে',
      coalesce(private.hub_name(p_hub), '') || ' · ' || to_char(p_from, 'DD-MM-YYYY') || case when p_to <> p_from then ' থেকে ' || to_char(p_to, 'DD-MM-YYYY') else '' end
      || ' · ' || p_minutes || ' মিনিট — ' || p_reason, '/app/attendance?view=hub&tab=final&hub=' || p_hub::text || '&date=' || p_from::text, 'attendance_gap');
  end loop;
  return jsonb_build_object('window', v_id, 'opened', v_n, 'expires_at', now() + make_interval(mins => p_minutes));
end $$;

create or replace function public.att_reopen_open(p_hub uuid, p_from date, p_to date, p_minutes integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_reason text := private.wf_clean(p_reason);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v_zone := private.hub_zone(p_hub);
  if v_zone is null then raise exception 'Hub not found' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', v_zone, p_hub) then
    raise exception 'Only the zonal manager opens a register for correction — শুধু জোনাল ম্যানেজার সংশোধনের জন্য খুলতে পারেন' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to > private.wf_today() then
    raise exception 'Give a first and last date, the last not after today — শুরু ও শেষ তারিখ দিন, শেষ তারিখ আজকের পরে নয়' using errcode = '22023'; end if;
  if p_to - p_from > 92 then raise exception 'At most three months at a time — একবারে সর্বোচ্চ তিন মাস' using errcode = '22023'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 43200 then raise exception 'Give the minutes (1 to 43200) — মিনিট দিন (১ থেকে ৪৩২০০)' using errcode = '22023'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'Write why it is opened — কেন খুলছেন লিখুন' using errcode = '22023'; end if;
  return private.att_reopen_do(p_hub, p_from, p_to, p_minutes, v_reason, auth.uid());
end $$;

-- The one-day unlock of the daily register is a reopening of that day (two hours).
create or replace function public.att_sheet_unlock(p_sheet uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets; v_note text := private.wf_clean(p_note);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet for update;
  if s.id is null then raise exception 'No such register — খাতা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', s.zone_id, s.hub_id) then
    raise exception 'Only the zonal manager unlocks a register — শুধু জোনাল ম্যানেজার খাতা খুলতে পারেন' using errcode = '42501'; end if;
  if s.status <> 'submitted' then raise exception 'This register is not locked — খাতা লক করা নেই' using errcode = 'P0001'; end if;
  if v_note is null then raise exception 'Write why it is unlocked — কেন খুলছেন লিখুন' using errcode = '22023'; end if;
  perform private.att_reopen_do(s.hub_id, s.work_date, s.work_date, 120, v_note, auth.uid());
end $$;

-- Close a reopening early: the permission ends and the server submits what is still a draft.
create or replace function public.att_reopen_close(p_window uuid, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare w public.att_reopen_windows; v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into w from public.att_reopen_windows where id = p_window for update;
  if w.id is null then raise exception 'No such opening — খোলা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', w.zone_id, w.hub_id) then
    raise exception 'Only the zonal manager ends an opening — শুধু জোনাল ম্যানেজার শেষ করতে পারেন' using errcode = '42501'; end if;
  if w.status <> 'open' then raise exception 'This opening has already ended — এই খোলা আগেই শেষ হয়েছে' using errcode = 'P0001'; end if;
  update public.att_reopen_windows set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_note = private.wf_clean(p_note) where id = w.id;
  v_n := private.att_day_autosubmit(w.hub_id);
  return v_n;
end $$;

-- A hub's openings (the last twenty): who, which days, until when, why.
create or replace function public.att_reopen_list(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'from', w.from_date, 'to', w.to_date, 'expires_at', w.expires_at, 'reason', w.reason, 'by', w.approved_by_name,
      'status', case when w.status = 'open' and w.expires_at <= now() then 'expired' else w.status end, 'created_at', w.created_at, 'closed_at', w.closed_at,
      'can_close', w.status = 'open' and w.expires_at > now() and private.has_permission('hr.attendance.configure', w.zone_id, w.hub_id)) order by w.created_at desc)
    from (select * from public.att_reopen_windows x where x.hub_id = p_hub order by x.created_at desc limit 20) w), '[]'::jsonb);
end $$;

-- An old version of a register: who was on it and in which state.
create or replace function public.att_sheet_version_get(p_sheet uuid, p_no integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.att_day_sheets; v public.att_sheet_versions;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet;
  if s.id is null or not private.has_permission('hr.attendance.view', s.zone_id, s.hub_id) then
    raise exception 'You may not see this register — এই খাতা দেখার অনুমতি নেই' using errcode = '42501'; end if;
  select * into v from public.att_sheet_versions where sheet_id = p_sheet and version_no = p_no;
  if v.id is null then raise exception 'No such version — এই সংস্করণ নেই' using errcode = 'P0002'; end if;
  return jsonb_build_object('no', v.version_no, 'mode', v.mode, 'at', v.submitted_at, 'by', v.submitted_by_name, 'date', v.work_date,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'final_status', x ->> 'final_status',
        'late_time', x ->> 'late_time', 'unauthorized', (x ->> 'unauthorized')::boolean, 'absence_reason', x ->> 'absence_reason', 'absence_app_date', x ->> 'absence_app_date',
        'leave_ref', x ->> 'leave_ref', 'online_marked', (x ->> 'online_marked')::boolean, 'online_at', x ->> 'online_at', 'note', x ->> 'note') order by e.full_name)
      from jsonb_array_elements(v.lines) x join public.employees e on e.id = (x ->> 'employee_id')::uuid), '[]'::jsonb));
end $$;

-- the zonal manager sends a submitted register (this version) once to every manager of the hub
create or replace function public.att_sheet_send(p_sheet uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets; n integer := 0; r record;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet for update;
  if s.id is null then raise exception 'No such register — খাতা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', s.zone_id, s.hub_id) then
    raise exception 'Only the zonal manager sends a register for checking — শুধু জোনাল ম্যানেজার যাচাইয়ে পাঠাতে পারেন' using errcode = '42501'; end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted register is sent — আগে ম্যানেজার খাতা সাবমিট দিন' using errcode = 'P0001'; end if;
  for r in select e.id, e.profile_id from public.employees e join public.positions po on po.id = e.position_id
            where e.hub_id = s.hub_id and e.archived_at is null and e.status = 'active' and e.profile_id is not null
              and po.code::text in ('MANAGER', 'ASSISTANTMAN') loop
    insert into public.att_sheet_checks (sheet_id, profile_id, employee_id, sent_by, version_no) values (s.id, r.profile_id, r.id, auth.uid(), s.version)
    on conflict (sheet_id, profile_id, version_no) do nothing;
    if found then
      n := n + 1;
      perform private.notify(r.profile_id, 'হাজিরা খাতা যাচাই করুন', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.work_date, 'DD-MM-YYYY') || ' · সংস্করণ ' || s.version || ' — দেখে "ঠিক আছে" দিন, নইলে সংশোধনের কারণ লিখুন',
        '/app/attendance?view=hub&tab=final&hub=' || s.hub_id || '&date=' || s.work_date, 'attendance_gap');
    end if;
  end loop;
  if n = 0 and not exists (select 1 from public.att_sheet_checks c where c.sheet_id = s.id and c.version_no = s.version) then
    raise exception 'This hub has no manager with a login — এই হাবে লগইনসহ কোনো ম্যানেজার নেই' using errcode = 'P0001';
  end if;
  update public.att_day_sheets set sent_by = auth.uid(), sent_at = coalesce(sent_at, now()) where id = s.id;
  return n;
end $$;

-- "ঠিক আছে" belongs to the version that was sent
create or replace function public.att_sheet_check_ok(p_sheet uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet;
  update public.att_sheet_checks set ok_at = now(), returned_at = null, return_reason = null
   where sheet_id = p_sheet and profile_id = auth.uid() and version_no = s.version and ok_at is null;
  if not found and not exists (select 1 from public.att_sheet_checks where sheet_id = p_sheet and profile_id = auth.uid() and version_no = s.version) then
    raise exception 'This register was not sent to you — খাতাটি আপনাকে যাচাইয়ে পাঠানো হয়নি' using errcode = '42501';
  end if;
end $$;

-- the hub manager does not agree: the reason goes to the zonal manager, who may reopen it
create or replace function public.att_sheet_check_return(p_sheet uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets; v_reason text := private.wf_clean(p_reason); z uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet;
  if v_reason is null or length(v_reason) < 3 then raise exception 'Write what must be corrected — কী সংশোধন করতে হবে লিখুন' using errcode = '22023'; end if;
  update public.att_sheet_checks set returned_at = now(), return_reason = v_reason, ok_at = null
   where sheet_id = p_sheet and profile_id = auth.uid() and version_no = s.version;
  if not found then raise exception 'This register was not sent to you — খাতাটি আপনাকে যাচাইয়ে পাঠানো হয়নি' using errcode = '42501'; end if;
  for z in select * from private.wf_zone_managers(s.zone_id) loop
    perform private.notify(z, 'হাজিরা খাতায় সংশোধনের অনুরোধ', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.work_date, 'DD-MM-YYYY') || ' · সংস্করণ ' || s.version || ' — ' || v_reason,
      '/app/attendance?view=hub&tab=final&hub=' || s.hub_id || '&date=' || s.work_date, 'attendance_gap');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. The monthly register: numbered submissions made from the daily versions
-- ---------------------------------------------------------------------
-- The days a month's submission rests on: from the hub's first submitted register (or the 1st) to the month's end or yesterday.
create or replace function private.att_month_scan(p_hub uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_m date := date_trunc('month', p_month)::date; v_from date; v_to date; v_first date;
begin
  select min(s.work_date) into v_first from public.att_day_sheets s where s.hub_id = p_hub and s.version > 0;
  v_from := greatest(v_m, coalesce(v_first, v_m));
  v_to := least((v_m + interval '1 month' - interval '1 day')::date, private.wf_today() - 1);
  return jsonb_build_object('from', v_from, 'to', v_to,
    'days', coalesce((select jsonb_object_agg(s.work_date::text, s.version) from public.att_day_sheets s
                       where s.hub_id = p_hub and s.work_date between v_from and v_to and s.status = 'submitted'), '{}'::jsonb),
    'missing', coalesce((select jsonb_agg(g::date order by g) from generate_series(v_from, v_to, interval '1 day') g
                          where not exists (select 1 from public.att_day_sheets s where s.hub_id = p_hub and s.work_date = g::date and s.status = 'submitted')), '[]'::jsonb));
end $$;

create or replace function public.att_month_get(p_hub uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_m date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_zone uuid := private.hub_zone(p_hub); v_scan jsonb; v_sub public.att_month_subs;
begin
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  v_scan := private.att_month_scan(p_hub, v_m);
  select * into v_sub from public.att_month_subs where hub_id = p_hub and month = v_m order by version_no desc limit 1;
  return jsonb_build_object('hub', jsonb_build_object('id', p_hub, 'name', private.hub_name(p_hub)), 'month', v_m, 'today', private.wf_today(),
    'from', v_scan -> 'from', 'to', v_scan -> 'to', 'missing', v_scan -> 'missing', 'days', v_scan -> 'days',
    'sub', case when v_sub.id is null then null else jsonb_build_object('id', v_sub.id, 'version_no', v_sub.version_no, 'at', v_sub.submitted_at, 'by', v_sub.submitted_by_name, 'days', v_sub.day_versions) end,
    -- the daily registers moved after the monthly one was made from them: the month must be submitted again
    'changed', v_sub.id is not null and v_sub.day_versions is distinct from v_scan -> 'days',
    'changed_days', case when v_sub.id is null then '[]'::jsonb else coalesce((select jsonb_agg(d order by d) from (
        select k as d from jsonb_object_keys(v_scan -> 'days') k where (v_scan -> 'days' -> k) is distinct from (v_sub.day_versions -> k)
        union select k from jsonb_object_keys(v_sub.day_versions) k where not (v_scan -> 'days') ? k) q), '[]'::jsonb) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('version_no', x.version_no, 'at', x.submitted_at, 'by', x.submitted_by_name, 'days', (select count(*) from jsonb_object_keys(x.day_versions))) order by x.version_no desc)
                          from public.att_month_subs x where x.hub_id = p_hub and x.month = v_m), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('profile_id', c.profile_id, 'name', coalesce(e.full_name, pr.full_name), 'sent_at', c.sent_at, 'ok_at', c.ok_at,
        'returned_at', c.returned_at, 'return_reason', c.return_reason) order by e.full_name)
        from public.att_month_checks c left join public.employees e on e.id = c.employee_id left join public.profiles pr on pr.id = c.profile_id where c.sub_id = v_sub.id), '[]'::jsonb),
    'my_check', (select jsonb_build_object('sent_at', c.sent_at, 'ok_at', c.ok_at, 'returned_at', c.returned_at, 'return_reason', c.return_reason)
                   from public.att_month_checks c where c.sub_id = v_sub.id and c.profile_id = auth.uid()),
    'can', jsonb_build_object('submit', private.has_permission('hr.attendance.create', v_zone, p_hub),
                              'send', private.has_permission('hr.attendance.configure', v_zone, p_hub) and v_sub.id is not null and not coalesce(v_sub.day_versions is distinct from v_scan -> 'days', false)));
end $$;

-- Submit the month (the manager). A missing day is named; the same days at the same versions are the same submission.
create or replace function public.att_month_submit(p_hub uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_m date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_zone uuid := private.hub_zone(p_hub); v_scan jsonb; v_last public.att_month_subs;
  v_id uuid; v_no integer; v_name text; z uuid; v_first text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_zone is null then raise exception 'Hub not found' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.create', v_zone, p_hub) then
    raise exception 'You may not submit this hub''s month — এই হাবের মাসের খাতা জমার অনুমতি নেই' using errcode = '42501'; end if;
  if v_m > date_trunc('month', private.wf_today())::date then raise exception 'That month has not started — মাস এখনো শুরু হয়নি' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('att_month:' || p_hub::text || v_m::text, 0));
  v_scan := private.att_month_scan(p_hub, v_m);
  if jsonb_array_length(v_scan -> 'missing') > 0 then
    v_first := v_scan -> 'missing' ->> 0;
    raise exception 'Daily register missing: % — দৈনিক খাতা বাকি: %', v_first, v_first using errcode = '22023';
  end if;
  if (v_scan -> 'days') = '{}'::jsonb then raise exception 'There is no submitted daily register in this month yet — এই মাসের কোনো দৈনিক খাতা এখনো সাবমিট হয়নি' using errcode = '22023'; end if;
  select * into v_last from public.att_month_subs where hub_id = p_hub and month = v_m order by version_no desc limit 1;
  if v_last.id is not null and v_last.day_versions = v_scan -> 'days' then
    return jsonb_build_object('id', v_last.id, 'version_no', v_last.version_no, 'already', true);
  end if;
  v_no := coalesce(v_last.version_no, 0) + 1;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  insert into public.att_month_subs (hub_id, zone_id, month, version_no, day_versions, submitted_by, submitted_by_name)
  values (p_hub, v_zone, v_m, v_no, v_scan -> 'days', auth.uid(), v_name) returning id into v_id;
  for z in select * from private.wf_zone_managers(v_zone) loop
    perform private.notify(z, 'মাসের হাজিরা খাতা জমা হয়েছে', coalesce(private.hub_name(p_hub), '') || ' · ' || to_char(v_m, 'MM-YYYY') || ' · সংস্করণ ' || v_no,
      '/app/attendance?view=hub&tab=month&hub=' || p_hub::text, 'attendance_gap');
  end loop;
  return jsonb_build_object('id', v_id, 'version_no', v_no, 'already', false);
end $$;

-- the zonal manager sends the latest monthly submission to the hub's managers
create or replace function public.att_month_send(p_sub uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare s public.att_month_subs; n integer := 0; r record; v_latest integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_month_subs where id = p_sub;
  if s.id is null then raise exception 'No such monthly register — মাসের খাতা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', s.zone_id, s.hub_id) then
    raise exception 'Only the zonal manager sends a register for checking — শুধু জোনাল ম্যানেজার যাচাইয়ে পাঠাতে পারেন' using errcode = '42501'; end if;
  select max(version_no) into v_latest from public.att_month_subs where hub_id = s.hub_id and month = s.month;
  if s.version_no <> v_latest then raise exception 'A newer monthly version exists — মাসের খাতার নতুন সংস্করণ আছে' using errcode = 'P0001'; end if;
  for r in select e.id, e.profile_id from public.employees e join public.positions po on po.id = e.position_id
            where e.hub_id = s.hub_id and e.archived_at is null and e.status = 'active' and e.profile_id is not null and po.code::text in ('MANAGER', 'ASSISTANTMAN') loop
    insert into public.att_month_checks (sub_id, profile_id, employee_id, sent_by) values (s.id, r.profile_id, r.id, auth.uid()) on conflict (sub_id, profile_id) do nothing;
    if found then
      n := n + 1;
      perform private.notify(r.profile_id, 'মাসের হাজিরা খাতা যাচাই করুন', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.month, 'MM-YYYY') || ' · সংস্করণ ' || s.version_no,
        '/app/attendance?view=hub&tab=month&hub=' || s.hub_id::text, 'attendance_gap');
    end if;
  end loop;
  if n = 0 and not exists (select 1 from public.att_month_checks where sub_id = s.id) then
    raise exception 'This hub has no manager with a login — এই হাবে লগইনসহ কোনো ম্যানেজার নেই' using errcode = 'P0001'; end if;
  return n;
end $$;

create or replace function public.att_month_check_ok(p_sub uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  update public.att_month_checks set ok_at = now(), returned_at = null, return_reason = null where sub_id = p_sub and profile_id = auth.uid() and ok_at is null;
  if not found and not exists (select 1 from public.att_month_checks where sub_id = p_sub and profile_id = auth.uid()) then
    raise exception 'This register was not sent to you — খাতাটি আপনাকে যাচাইয়ে পাঠানো হয়নি' using errcode = '42501'; end if;
end $$;

create or replace function public.att_month_check_return(p_sub uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.att_month_subs; v_reason text := private.wf_clean(p_reason); z uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_month_subs where id = p_sub;
  if v_reason is null or length(v_reason) < 3 then raise exception 'Write what must be corrected — কী সংশোধন করতে হবে লিখুন' using errcode = '22023'; end if;
  update public.att_month_checks set returned_at = now(), return_reason = v_reason, ok_at = null where sub_id = p_sub and profile_id = auth.uid();
  if not found then raise exception 'This register was not sent to you — খাতাটি আপনাকে যাচাইয়ে পাঠানো হয়নি' using errcode = '42501'; end if;
  for z in select * from private.wf_zone_managers(s.zone_id) loop
    perform private.notify(z, 'মাসের হাজিরা খাতায় সংশোধনের অনুরোধ', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.month, 'MM-YYYY') || ' · সংস্করণ ' || s.version_no || ' — ' || v_reason,
      '/app/attendance?view=hub&tab=month&hub=' || s.hub_id::text, 'attendance_gap');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. The server job: when the Dhaka date has changed, submit the registers still open (and end the reopenings whose time is over)
-- ---------------------------------------------------------------------
-- Returns how many registers it submitted. p_hub limits it to one hub (used when a reopening is ended by hand).
create or replace function private.att_day_autosubmit(p_hub uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0; v jsonb;
begin
  update public.att_reopen_windows set status = 'expired', closed_at = now() where status = 'open' and expires_at <= now() and (p_hub is null or hub_id = p_hub);
  for r in
    select h.id as hub_id, h.zone_id, d.work_date from public.hubs h
      cross join lateral (
        select g::date as work_date from generate_series(private.wf_today() - 3, private.wf_today() - 1, interval '1 day') g
        union
        select s.work_date from public.att_day_sheets s where s.hub_id = h.id and s.status = 'draft' and s.work_date < private.wf_today()) d
     where h.archived_at is null and h.status = 'active' and (p_hub is null or h.id = p_hub)
       and not exists (select 1 from public.att_day_sheets s where s.hub_id = h.id and s.work_date = d.work_date and s.status = 'submitted')
       and exists (select 1 from private.att_sheet_people(h.id, d.work_date))
       and private.att_open_window(h.id, d.work_date) is null
       and now() >= private.wf_day_due(h.zone_id, d.work_date)
     order by d.work_date, h.id loop
    v := private.att_sheet_close(r.hub_id, r.work_date, null, 'auto', false, null);
    if v is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin perform cron.unschedule('att-day-autosubmit'); exception when others then null; end;
    perform cron.schedule('att-day-autosubmit', '* * * * *', $c$select private.att_day_autosubmit()$c$);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Registers submitted before this change are version one
-- ---------------------------------------------------------------------
update public.att_day_sheets s set version = 1, submit_mode = coalesce(submit_mode, 'manager')
 where s.version = 0 and (s.status = 'submitted' or s.unlocked_at is not null or exists (select 1 from public.att_sheet_checks c where c.sheet_id = s.id));
insert into public.att_sheet_versions (sheet_id, hub_id, work_date, version_no, mode, lines, submitted_by, submitted_by_name, submitted_at)
select s.id, s.hub_id, s.work_date, 1, 'manager', coalesce((select jsonb_agg(to_jsonb(l) - 'updated_by' order by l.employee_id) from public.att_day_lines l where l.sheet_id = s.id), '[]'::jsonb),
       s.submitted_by, (select pr.full_name from public.profiles pr where pr.id = s.submitted_by), coalesce(s.submitted_at, s.updated_at)
  from public.att_day_sheets s where s.version = 1 and not exists (select 1 from public.att_sheet_versions v where v.sheet_id = s.id);

-- ---------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------
revoke all on function private.wf_day_due(uuid, date), private.att_open_window(uuid, date), private.att_edit_open(uuid, date), private.att_leave_state(uuid, date),
  private.att_line_gap(public.att_day_lines), private.att_sheet_close(uuid, date, uuid, text, boolean, uuid), private.att_reopen_do(uuid, date, date, integer, text, uuid),
  private.att_month_scan(uuid, date), private.att_day_autosubmit(uuid) from public, anon, authenticated;
revoke all on function public.att_sheet_submit(uuid, date, jsonb), public.att_sheet_unlock(uuid, text), public.att_sheet_send(uuid), public.att_sheet_check_ok(uuid),
  public.att_sheet_check_return(uuid, text), public.att_sheet_version_get(uuid, integer), public.att_reopen_open(uuid, date, date, integer, text),
  public.att_reopen_close(uuid, text), public.att_reopen_list(uuid), public.att_month_get(uuid, date), public.att_month_submit(uuid, date), public.att_month_send(uuid),
  public.att_month_check_ok(uuid), public.att_month_check_return(uuid, text), public.att_sheet_get(uuid, date), public.att_zone_day(uuid, date), public.att_month_sheet(uuid, date) from public, anon;
grant execute on function public.att_sheet_submit(uuid, date, jsonb), public.att_sheet_unlock(uuid, text), public.att_sheet_send(uuid), public.att_sheet_check_ok(uuid),
  public.att_sheet_check_return(uuid, text), public.att_sheet_version_get(uuid, integer), public.att_reopen_open(uuid, date, date, integer, text),
  public.att_reopen_close(uuid, text), public.att_reopen_list(uuid), public.att_month_get(uuid, date), public.att_month_submit(uuid, date), public.att_month_send(uuid),
  public.att_month_check_ok(uuid), public.att_month_check_return(uuid, text), public.att_sheet_get(uuid, date), public.att_zone_day(uuid, date), public.att_month_sheet(uuid, date) to authenticated;
