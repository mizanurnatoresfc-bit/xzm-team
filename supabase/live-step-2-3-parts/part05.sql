-- Part 5 of 7. Run in the Supabase SQL editor of the LIVE project, in order, one at a time. It only stores text in a scratch table; nothing changes yet.
insert into private._mig_stage(part, body) values (5, $mig$declare v_m date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_zone uuid := private.hub_zone(p_hub); v_scan jsonb; v_last public.att_month_subs;
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
  for z in select * from private.wf_role_zone_managers(v_zone) loop
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
  for r in select e.id, e.profile_id from private.att_hub_managers(s.hub_id) e loop
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
  for z in select * from private.wf_role_zone_managers(s.zone_id) loop
    perform private.notify(z, 'মাসের হাজিরা খাতায় সংশোধনের অনুরোধ', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.month, 'MM-YYYY') || ' · সংস্করণ ' || s.version_no || ' — ' || v_reason,
      '/app/attendance?view=hub&tab=month&hub=' || s.hub_id::text, 'attendance_gap');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. The server job: when the Dhaka date has changed, submit the registers still open (and end the reopenings whose time is over)
-- ---------------------------------------------------------------------
-- Returns how many registers it submitted. A register that is empty or has an unfinished line is NOT submitted: it is held, and the hub's and
-- the zone's managers are told (wf_auto_holds). p_hub limits it to one hub (used when a reopening is ended by hand).
create or replace function private.att_day_autosubmit(p_hub uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0; v jsonb; v_sheet uuid; v_total integer; v_gaps integer; v_names jsonb; v_held integer := 0;
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
       and d.work_date >= private.wf_auto_from()                                   -- before the start date: never (setting workforce.auto_submit_from)
       and exists (select 1 from private.att_sheet_people(h.id, d.work_date))
       and private.att_open_window(h.id, d.work_date) is null
       and now() >= private.wf_day_due(h.zone_id, d.work_date)
     order by d.work_date, h.id loop
    perform pg_advisory_xact_lock(hashtextextended('att_sheet:' || r.hub_id::text || r.work_date::text, 0));
    select id into v_sheet from public.att_day_sheets where hub_id = r.hub_id and work_date = r.work_date;
    if v_sheet is null then
      insert into public.att_day_sheets (hub_id, zone_id, work_date) values (r.hub_id, r.zone_id, r.work_date) on conflict (hub_id, work_date) do nothing;
      select id into v_sheet from public.att_day_sheets where hub_id = r.hub_id and work_date = r.work_date;
    end if;
    perform private.att_sheet_prepare(v_sheet, r.hub_id, r.work_date, null);
    select count(*), count(*) filter (where private.att_line_gap(l) is not null),
           coalesce(jsonb_agg(jsonb_build_object('name', e.full_name, 'why', private.att_line_gap(l)) order by e.full_name) filter (where private.att_line_gap(l) is not null), '[]'::jsonb)
      into v_total, v_gaps, v_names
      from public.att_day_lines l join public.employees e on e.id = l.employee_id where l.sheet_id = v_sheet;
    if v_gaps > 0 then
      -- empty or unfinished: not submitted. The hub's and the zone's managers are told once; the register stays open for the hub manager.
      perform private.wf_hold_set('daily', r.hub_id, r.work_date, case when v_gaps = v_total then 'empty' else 'incomplete' end, v_total, v_gaps, v_names);
      v_held := v_held + 1;
    else
      v := private.att_sheet_close(r.hub_id, r.work_date, null, 'auto', null);
      if v is not null then v_n := v_n + 1; end if;
    end if;
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
  private.att_line_gap(public.att_day_lines), private.att_sheet_prepare(uuid, uuid, date, uuid), private.att_sheet_close(uuid, date, uuid, text, uuid), private.att_reopen_do(uuid, date, date, integer, text, uuid),
  private.att_month_scan(uuid, date), private.att_day_autosubmit(uuid) from public, anon, authenticated;
revoke all on function public.att_sheet_submit(uuid, date, jsonb), public.att_sheet_unlock(uuid, text), public.att_sheet_send(uuid), public.att_sheet_check_ok(uuid),
  public.att_sheet_check_return(uuid, text), public.att_sheet_version_get(uuid, integer), public.att_reopen_open(uuid, date, date, integer, text),
  public.att_reopen_close(uuid, text), public.att_reopen_list(uuid), public.att_month_get(uuid, date), public.att_month_submit(uuid, date), public.att_month_send(uuid),
  public.att_month_check_ok(uuid), public.att_month_check_return(uuid, text), public.att_sheet_get(uuid, date), public.att_zone_day(uuid, date), public.att_month_sheet(uuid, date) from public, anon;
grant execute on function public.att_sheet_submit(uuid, date, jsonb), public.att_sheet_unlock(uuid, text), public.att_sheet_send(uuid), public.att_sheet_check_ok(uuid),
  public.att_sheet_check_return(uuid, text), public.att_sheet_version_get(uuid, integer), public.att_reopen_open(uuid, date, date, integer, text),
  public.att_reopen_close(uuid, text), public.att_reopen_list(uuid), public.att_month_get(uuid, date), public.att_month_submit(uuid, date), public.att_month_send(uuid),
  public.att_month_check_ok(uuid), public.att_month_check_return(uuid, text), public.att_sheet_get(uuid, date), public.att_zone_day(uuid, date), public.att_month_sheet(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- FILE 3: 20261124000300_staff_work_profile.sql
-- ---------------------------------------------------------------------
-- =====================================================================
--  কর্মীর কাজের প্রোফাইল (the staff work profile, step 3 of 3)
--
--  Owner (24 Nov): the zonal manager opens zone -> hub -> person and sees, on one page: who the person is and what they are
--  assigned to now (with the history), their attendance and leave, their routes, and the work they have submitted in every module.
--    * The key is the permanent employee id. When a person is moved to another hub the new duty counts from its effective date;
--      old work keeps the hub and the work date it was done on.
--    * Every module writes ONE kind of line into staff_work_events: employee, hub, work day, module, source record, activity,
--      status and the server time. The same module, source record and record version is counted once however often it is
--      submitted or a job runs again; a draft and its submitted version are one line that moves from draft to submitted.
--      Drafts and submitted lines are shown apart. A new revision of a record is a new version.
--    * The profile adds no permission: the person is seen by who may see the employee (hr.employee.view), each line only by who
--      may see its hub, and a person may see their own.
--
--  Connected now: morning input, daily attendance register, route plan, daily numbers (pickup / delivery), hub operations,
--  sorting (handovers, driver runs). Problem Center, vehicles / fuel, accounts and other apps join by calling
--  private.staff_work_record from their own submit (module codes issues, fleet, accounts, other are ready).
--
--  Undo: drop function public.staff_profile_people / staff_profile_get, the swe_* triggers and functions,
--  private.staff_work_record / swe_backfill; drop table staff_work_events.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The one line every module writes
-- ---------------------------------------------------------------------
create table if not exists public.staff_work_events (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  hub_id         uuid references public.hubs(id),                 -- the hub the work was done for, whatever the person's hub is now
  zone_id        uuid references public.zones(id),
  work_date      date not null,
  module         text not null check (module in ('morning', 'attendance', 'route', 'daily_ops', 'hub_ops', 'sorting', 'issues', 'fleet', 'accounts', 'other')),
  source_table   text not null check (length(source_table) between 1 and 80),
  source_id      uuid not null,
  source_version integer not null default 1 check (source_version >= 1),
  activity       text not null check (length(activity) between 1 and 120),
  status         text not null check (status in ('draft', 'submitted', 'approved', 'cancelled')),
  status_at      timestamptz not null default now(),
  detail         jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  link           text check (link is null or length(link) <= 300),
  server_time    timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (module, source_id, source_version, employee_id)            -- counted once
);
create index if not exists staff_work_events_emp_day on public.staff_work_events (employee_id, work_date desc);
create index if not exists staff_work_events_hub_day on public.staff_work_events (hub_id, work_date desc);
create index if not exists staff_work_events_zone on public.staff_work_events (zone_id);$mig$);
