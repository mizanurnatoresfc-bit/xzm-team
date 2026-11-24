-- Part 1 of 7. Run in the Supabase SQL editor of the LIVE project, in order, one at a time. It only stores text in a scratch table; nothing changes yet.
create table if not exists private._mig_stage(part int primary key, body text not null);
insert into private._mig_stage(part, body) values (1, $mig$-- =====================================================================
--  LIVE STEP 2 + 3 in ONE script (one transaction): 20261124000200_att_versions_windows + 20261124000300_staff_work_profile
--
--  Step 1 (20261124000100_morning_input) is ALREADY applied on the live project. This script is the other two files, unchanged, in order.
--  Run it ONCE, in the Supabase SQL editor (it is a single transaction: if anything fails nothing is kept). Do NOT use `supabase db push`
--  for it: the live history knows step 1 under another version number, so db push would try to run step 1 again.
--  After it: run supabase/verify-live-step-2-3.sql and compare with the numbers written there.
--  Generated from the two files by concatenation; to change anything, change the migration files and generate again.
-- =====================================================================

-- Safety: stop if step 1 is not there, or if the live database is not the one these files were written against.
do $$
begin
  if to_regclass('public.wf_auto_holds') is null or to_regprocedure('private.wf_hold_set(text,uuid,date,text,integer,integer,jsonb)') is null then
    raise exception 'Step 1 (morning_input) is not applied on this database - stop.';
  end if;
  if to_regprocedure('private.att_hub_managers(uuid)') is null or to_regprocedure('public.att_sheet_confirm_self(uuid,text,text,text)') is null then
    raise exception 'The live-only migrations att_self_line_and_manager_roles / master_audit_fixes are not here - stop.';
  end if;
  if to_regclass('public.att_reopen_windows') is not null then
    raise exception 'Step 2 looks already applied (att_reopen_windows exists) - stop.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- FILE 2 of 2 parts: 20261124000200_att_versions_windows.sql
-- ---------------------------------------------------------------------
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
      or (p_date < private.wf_today() and (private.att_open_window(p_hub, p_date) is not null or now() < private.wf_day_due(private.hub_zone(p_hub), p_date)
          -- a register the server refused to submit (empty or unfinished) stays open for the manager to finish
          or exists (select 1 from public.wf_auto_holds k where k.kind = 'daily' and k.hub_id = p_hub and k.work_date = p_date and k.resolved_at is null)))
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
$$;$mig$);
