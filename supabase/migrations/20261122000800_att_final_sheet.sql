-- =====================================================================
--  হাজিরা: ম্যানেজারের দৈনিক ফাইনাল খাতা (the hub manager's final attendance register of a day)
--
--  Owner (22 Nov):
--    * Staff give their own attendance once a day (already there: attendance_self_marks).
--    * The hub manager keeps ONE final register per day: every staff member of the hub, with what the person gave
--      already filled in ("উপস্থিত"), the manager's yes / no on it, "marked online?" (with a reason when not),
--      the date of the online application when absent, "absent without telling" and "late" (with the time).
--      The manager submits it with all corrections; then it is LOCKED. Only the zonal manager unlocks it.
--    * A "no", a late arrival or an absence without telling asks the staff member for an explanation in the staff
--      panel; the reply shows on the register line.
--    * The zonal manager approves nothing. They see: the staff's own inputs, who did not give (by position) and the
--      final register; and they send a day's register (with preview) once to all managers of the hub, who mark "ঠিক আছে".
--    * The submitted daily registers are the monthly register (present / absent), kept with the hub manager.
--
--  Sits on what is there: employees, positions, attendance_self_marks, wf_absence_applications, attendance_records.
--  Submitting writes the final status to attendance_records (so every existing report counts it) and settles the
--  staff member's waiting input of that date. Additive only: nothing dropped, no existing function replaced.
--
--  Permissions used (no new ones): hr.attendance.view (see), hr.attendance.create (keep & submit the register),
--  hr.attendance.configure (zonal: unlock, send for checking).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.att_day_sheets (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid references public.zones(id),
  work_date     date not null,
  status        text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_by  uuid, submitted_at timestamptz,
  unlocked_by   uuid, unlocked_at  timestamptz, unlock_note text check (unlock_note is null or length(unlock_note) <= 500),
  sent_by       uuid, sent_at      timestamptz,          -- the zonal manager sent it to the hub's managers for checking
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid,
  unique (hub_id, work_date),
  check ((status = 'submitted') = (submitted_at is not null))
);
create index if not exists att_day_sheets_zone on public.att_day_sheets (zone_id, work_date);

create table if not exists public.att_day_lines (
  id               uuid primary key default gen_random_uuid(),
  sheet_id         uuid not null references public.att_day_sheets(id),
  employee_id      uuid not null references public.employees(id),
  position_id      uuid references public.positions(id),
  self_mark_id     uuid references public.attendance_self_marks(id),
  staff_kind       text check (staff_kind in ('present', 'absent')),          -- what the person gave themself (null = gave nothing)
  manager_ok       boolean,                                                   -- yes / no on what the person gave
  final_status     text check (final_status in ('present', 'late', 'half_day', 'absent', 'leave', 'holiday', 'weekly_off')),
  late_time        time,
  online_marked    boolean,                                                   -- marked attendance online (the company site)
  online_reason    text check (online_reason is null or length(online_reason) <= 500),
  absence_app_date date,                                                      -- the date the online absence application was given
  absence_app_ref  text check (absence_app_ref is null or length(absence_app_ref) <= 60),
  unauthorized     boolean not null default false,                            -- absent without telling anyone
  note             text check (note is null or length(note) <= 500),
  updated_at       timestamptz not null default now(), updated_by uuid,
  unique (sheet_id, employee_id),
  check (not unauthorized or final_status = 'absent'),
  check (late_time is null or final_status = 'late')
);
create index if not exists att_day_lines_emp on public.att_day_lines (employee_id);
create index if not exists att_day_lines_pos on public.att_day_lines (position_id);
create index if not exists att_day_lines_mark on public.att_day_lines (self_mark_id);

create table if not exists public.att_explanations (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid not null references public.att_day_lines(id),
  sheet_id    uuid not null references public.att_day_sheets(id),
  employee_id uuid not null references public.employees(id),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid references public.zones(id),
  work_date   date not null,
  reason      text not null check (reason in ('not_ok', 'late', 'unauthorized')),
  asked_by    uuid, asked_at timestamptz not null default now(),
  reply       text check (reply is null or (length(btrim(reply)) between 1 and 1000)),
  replied_at  timestamptz,
  unique (line_id, reason),
  check ((reply is null) = (replied_at is null))
);
create index if not exists att_explanations_emp on public.att_explanations (employee_id, work_date);
create index if not exists att_explanations_zone on public.att_explanations (zone_id, work_date);
create index if not exists att_explanations_sheet on public.att_explanations (sheet_id);
create index if not exists att_explanations_hub on public.att_explanations (hub_id, work_date);

create table if not exists public.att_sheet_checks (
  id          uuid primary key default gen_random_uuid(),
  sheet_id    uuid not null references public.att_day_sheets(id),
  profile_id  uuid not null,
  employee_id uuid references public.employees(id),
  sent_by     uuid, sent_at timestamptz not null default now(),
  ok_at       timestamptz,
  unique (sheet_id, profile_id)
);
create index if not exists att_sheet_checks_emp on public.att_sheet_checks (employee_id);

do $$
declare t text;
begin
  foreach t in array array['att_day_sheets', 'att_day_lines', 'att_explanations', 'att_sheet_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists ads_read on public.att_day_sheets;
create policy ads_read on public.att_day_sheets for select to authenticated
  using (private.has_permission('hr.attendance.view', zone_id, hub_id));
drop policy if exists adl_read on public.att_day_lines;
create policy adl_read on public.att_day_lines for select to authenticated
  using (exists (select 1 from public.att_day_sheets s where s.id = sheet_id and private.has_permission('hr.attendance.view', s.zone_id, s.hub_id)));
drop policy if exists aex_read on public.att_explanations;
create policy aex_read on public.att_explanations for select to authenticated
  using (private.is_self_employee(employee_id) or private.has_permission('hr.attendance.view', zone_id, hub_id));
drop policy if exists asc_read on public.att_sheet_checks;
create policy asc_read on public.att_sheet_checks for select to authenticated
  using (profile_id = (select auth.uid()) or exists (select 1 from public.att_day_sheets s where s.id = sheet_id and private.has_permission('hr.attendance.view', s.zone_id, s.hub_id)));

-- live refresh on the pages (Realtime applies the row security above)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['att_day_sheets', 'att_day_lines', 'att_explanations', 'att_sheet_checks'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
-- the people of a hub's register on a date: the active staff of the hub (joined by then), plus anyone already on the sheet
create or replace function private.att_sheet_people(p_hub uuid, p_date date)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
   where e.hub_id = p_hub and e.archived_at is null and e.status = 'active' and (e.joining_date is null or e.joining_date <= p_date)
  union
  select l.employee_id from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
   where s.hub_id = p_hub and s.work_date = p_date
$$;

-- what a line looks like before the manager touches it: filled from the person's own input, or an earlier register row
create or replace function private.att_line_prefill(p_emp uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'manager_ok', null,
    'final_status', coalesce(r.status, case m.kind when 'present' then 'present' when 'absent' then 'absent' end),
    'late_time', case when r.status = 'late' and r.check_in is not null then to_char(r.check_in at time zone 'Asia/Dhaka', 'HH24:MI') end,
    'online_marked', null, 'online_reason', null,
    'absence_app_date', case when m.kind = 'absent' then coalesce(m.site_applied_on, (a.created_at at time zone 'Asia/Dhaka')::date) end,
    'absence_app_ref', case when m.kind = 'absent' then coalesce(m.site_ref, a.application_no) end,
    'unauthorized', false, 'note', null)
  from (select 1) one
  left join public.attendance_self_marks m on m.employee_id = p_emp and m.work_date = p_date
  left join public.wf_absence_applications a on a.id = m.application_id
  left join public.attendance_records r on r.employee_id = p_emp and r.work_date = p_date
$$;

-- write the given lines of a sheet (draft only); returns the sheet id
create or replace function private.att_sheet_write(p_hub uuid, p_date date, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.att_day_sheets; x jsonb; v_emp uuid; v_st text; v_late time; v_mark public.attendance_self_marks; v_pos uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null or p_date is null then raise exception 'Choose a hub and a date — হাব ও তারিখ বাছুন' using errcode = '22023'; end if;
  if not private.has_permission('hr.attendance.create', private.hub_zone(p_hub), p_hub) then
    raise exception 'You may not keep this hub''s register — এই হাবের হাজিরা খাতা লেখার অনুমতি নেই' using errcode = '42501';
  end if;
  if p_date > private.wf_today() then raise exception 'A future date cannot be written — আগামী তারিখের খাতা লেখা যায় না' using errcode = '22023'; end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then raise exception 'Lines must be a list' using errcode = '22023'; end if;

  insert into public.att_day_sheets (hub_id, zone_id, work_date, created_by, updated_by)
  values (p_hub, private.hub_zone(p_hub), p_date, auth.uid(), auth.uid())
  on conflict (hub_id, work_date) do nothing;
  select * into s from public.att_day_sheets where hub_id = p_hub and work_date = p_date for update;
  if s.status = 'submitted' then
    raise exception 'This register is submitted and locked — only the zonal manager can unlock it — খাতা সাবমিট হয়ে লক হয়ে গেছে, জোনাল ম্যানেজার খুলে দিলে বদলানো যাবে' using errcode = 'P0001';
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_emp := nullif(x ->> 'employee_id', '')::uuid;
    if v_emp is null or not exists (select 1 from private.att_sheet_people(p_hub, p_date) pp where pp = v_emp) then
      raise exception 'A person on the list is not in this hub — তালিকার একজন এই হাবের কর্মী নন' using errcode = '22023';
    end if;
    v_st := nullif(x ->> 'final_status', '');
    v_late := case when v_st = 'late' then nullif(x ->> 'late_time', '')::time end;
    select * into v_mark from public.attendance_self_marks m where m.employee_id = v_emp and m.work_date = p_date;
    select e.position_id into v_pos from public.employees e where e.id = v_emp;
    insert into public.att_day_lines as l (sheet_id, employee_id, position_id, self_mark_id, staff_kind, manager_ok, final_status, late_time,
                                           online_marked, online_reason, absence_app_date, absence_app_ref, unauthorized, note, updated_by)
    values (s.id, v_emp, v_pos, v_mark.id, v_mark.kind,
            case when v_mark.id is not null and jsonb_typeof(x -> 'manager_ok') = 'boolean' then (x -> 'manager_ok')::text::boolean end,
            v_st, v_late,
            case when jsonb_typeof(x -> 'online_marked') = 'boolean' then (x -> 'online_marked')::text::boolean end,
            private.wf_clean(x ->> 'online_reason'),
            case when v_st = 'absent' then nullif(x ->> 'absence_app_date', '')::date end,
            case when v_st = 'absent' then private.wf_clean(x ->> 'absence_app_ref', 60) end,
            coalesce((x ->> 'unauthorized')::boolean and v_st = 'absent', false),
            private.wf_clean(x ->> 'note'), auth.uid())
    on conflict (sheet_id, employee_id) do update set
      position_id = excluded.position_id, self_mark_id = excluded.self_mark_id, staff_kind = excluded.staff_kind,
      manager_ok = excluded.manager_ok, final_status = excluded.final_status, late_time = excluded.late_time,
      online_marked = excluded.online_marked, online_reason = excluded.online_reason,
      absence_app_date = excluded.absence_app_date, absence_app_ref = excluded.absence_app_ref,
      unauthorized = excluded.unauthorized, note = excluded.note, updated_at = now(), updated_by = auth.uid();
  end loop;
  update public.att_day_sheets set updated_at = now(), updated_by = auth.uid() where id = s.id;
  return s.id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Read: one hub, one date
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
                  'absence_app_date', l.absence_app_date, 'absence_app_ref', l.absence_app_ref, 'unauthorized', l.unauthorized, 'note', l.note)
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
      'blank', count(*) filter (where p -> 'value' ->> 'final_status' is null)) g
    from jsonb_array_elements(v_people) p left join public.positions po on po.code::text = p ->> 'position_code'
    group by coalesce(p ->> 'position', '—')) t;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', c.profile_id, 'name', coalesce(e.full_name, pr.full_name), 'sent_at', c.sent_at, 'ok_at', c.ok_at) order by e.full_name), '[]'::jsonb)
    into v_checks from public.att_sheet_checks c left join public.employees e on e.id = c.employee_id left join public.profiles pr on pr.id = c.profile_id
   where c.sheet_id = s.id;

  return jsonb_build_object(
    'hub', jsonb_build_object('id', p_hub, 'name', private.hub_name(p_hub)), 'date', v_date, 'today', private.wf_today(),
    'sheet', case when s.id is null then null else jsonb_build_object('id', s.id, 'status', s.status, 'submitted_at', s.submitted_at,
               'submitted_by_name', (select full_name from public.profiles where id = s.submitted_by),
               'unlocked_at', s.unlocked_at, 'unlock_note', s.unlock_note, 'sent_at', s.sent_at) end,
    'can', jsonb_build_object(
      'edit', private.has_permission('hr.attendance.create', v_zone, p_hub) and coalesce(s.status, 'draft') = 'draft' and v_date <= private.wf_today(),
      'unlock', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted',
      'send', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted'),
    'my_check', (select jsonb_build_object('sent_at', c.sent_at, 'ok_at', c.ok_at) from public.att_sheet_checks c where c.sheet_id = s.id and c.profile_id = auth.uid()),
    'people', v_people, 'by_position', v_pos, 'checks', v_checks);
end $$;

-- ---------------------------------------------------------------------
-- 4. Write: save a draft, submit (lock), unlock, send for checking, check ok
-- ---------------------------------------------------------------------
create or replace function public.att_sheet_save(p_hub uuid, p_date date, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.att_sheet_write(p_hub, p_date, p_lines);
end $$;

create or replace function public.att_sheet_submit(p_hub uuid, p_date date, p_lines jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sheet uuid; s public.att_day_sheets; ln record; v_rec uuid; v_bad text; v_asked integer := 0; v_written integer := 0;
  v_reasons text[]; v_r text; v_prof uuid; v_hub text := private.hub_name(p_hub);
begin
  v_sheet := private.att_sheet_write(p_hub, p_date, p_lines);
  select * into s from public.att_day_sheets where id = v_sheet for update;

  -- everyone of the hub is on the register, with a final status and what goes with it
  insert into public.att_day_lines (sheet_id, employee_id, position_id, updated_by)
  select s.id, pp, e.position_id, auth.uid() from private.att_sheet_people(p_hub, p_date) pp join public.employees e on e.id = pp
  on conflict (sheet_id, employee_id) do nothing;
  select string_agg(e.full_name || ': ' || w, '; ' order by e.full_name) into v_bad from (
    select l.employee_id, case
      when l.final_status is null then 'হাজিরা বাছুন'
      when l.self_mark_id is not null and l.manager_ok is null then 'হ্যাঁ / না দিন'
      when l.final_status = 'late' and l.late_time is null then 'কখন এসেছেন — সময় দিন'
      when l.final_status in ('present', 'late', 'half_day') and l.online_marked is null then 'অনলাইনে হাজিরা দিয়েছেন কি না — বলুন'
      when l.final_status in ('present', 'late', 'half_day') and not l.online_marked and l.online_reason is null then 'অনলাইনে না দেওয়ার কারণ লিখুন'
      when l.final_status = 'absent' and not l.unauthorized and l.absence_app_date is null then 'অনলাইন আবেদনের তারিখ দিন, অথবা "না জানিয়ে অনুপস্থিত" দিন'
    end w from public.att_day_lines l where l.sheet_id = s.id) z join public.employees e on e.id = z.employee_id
   where w is not null;
  if v_bad is not null then
    raise exception 'Some lines are not complete — কিছু সারি অসম্পূর্ণ: %', v_bad using errcode = '22023';
  end if;

  perform set_config('app.wf_action', 'approved', true);
  for ln in select x.*, e.profile_id, e.full_name from public.att_day_lines x join public.employees e on e.id = x.employee_id where x.sheet_id = s.id loop
    -- the final status goes on the register (every report reads attendance_records)
    insert into public.attendance_records as r (employee_id, work_date, status, check_in, source, note, created_by, updated_by)
    values (ln.employee_id, p_date, ln.final_status,
            case when ln.late_time is not null then ((p_date + ln.late_time) at time zone 'Asia/Dhaka') when ln.final_status in ('present', 'half_day') then null end,
            'manual', coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), auth.uid(), auth.uid())
    on conflict (employee_id, work_date) do update set status = excluded.status, check_in = coalesce(excluded.check_in, case when excluded.status in ('present', 'late', 'half_day') then r.check_in end),
      note = excluded.note, updated_by = auth.uid()
    returning r.id into v_rec;
    v_written := v_written + 1;
    -- the person's own waiting input of the date is settled by the register
    update public.attendance_self_marks m set status = 'approved',
           decided_as = case when ln.final_status in ('present', 'late', 'half_day', 'absent') then ln.final_status end,
           decided_by = auth.uid(), decided_at = now(), attendance_id = v_rec, decide_note = 'দৈনিক ফাইনাল খাতা'
     where m.id = ln.self_mark_id and m.status = 'waiting';

    -- explanations: a "no", a late arrival, an absence without telling
    v_reasons := array_remove(array[case when ln.manager_ok is false then 'not_ok' end, case when ln.final_status = 'late' then 'late' end,
                                    case when ln.unauthorized then 'unauthorized' end], null);
    delete from public.att_explanations q where q.line_id = ln.id and q.reply is null and not (q.reason = any (v_reasons));
    foreach v_r in array v_reasons loop
      insert into public.att_explanations (line_id, sheet_id, employee_id, hub_id, zone_id, work_date, reason, asked_by)
      values (ln.id, s.id, ln.employee_id, p_hub, s.zone_id, p_date, v_r, auth.uid())
      on conflict (line_id, reason) do nothing;
      if found then
        v_asked := v_asked + 1;
        perform private.notify(ln.profile_id, 'হাজিরার ব্যাখ্যা চাওয়া হয়েছে',
          to_char(p_date, 'DD-MM-YYYY') || ' — ' || case v_r when 'not_ok' then 'আপনার দেওয়া হাজিরা ঠিক নেই' when 'late' then 'দেরিতে আসা' else 'না জানিয়ে অনুপস্থিত' end
          || '। কারণ লিখে জবাব দিন।', '/app/workforce/attendance', 'attendance_gap');
      end if;
    end loop;
  end loop;
  perform set_config('app.wf_action', '', true);

  update public.att_day_sheets set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now(), updated_by = auth.uid()
   where id = s.id;

  -- the zonal managers of the zone hear that the register came in
  for v_prof in select distinct ur.user_id from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                 where ro.code = 'zonal_manager' and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
                   and (ur.zone_id = s.zone_id or ur.scope_type = 'global') loop
    perform private.notify(v_prof, 'দৈনিক ফাইনাল হাজিরা খাতা সাবমিট হয়েছে', coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY'),
      '/app/workforce/zone?tab=final', 'attendance_gap');
  end loop;
  return jsonb_build_object('sheet_id', s.id, 'lines', v_written, 'asked', v_asked);
end $$;

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
  update public.att_day_sheets set status = 'draft', submitted_at = null, submitted_by = null,
         unlocked_by = auth.uid(), unlocked_at = now(), unlock_note = v_note, updated_at = now(), updated_by = auth.uid() where id = s.id;
  perform private.notify(e.profile_id, 'হাজিরা খাতা আবার খোলা হয়েছে', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.work_date, 'DD-MM-YYYY') || ' — ' || v_note,
    '/app/workforce/hub?tab=final&hub=' || s.hub_id || '&date=' || s.work_date, 'attendance_gap')
    from public.employees e join public.positions po on po.id = e.position_id
   where e.hub_id = s.hub_id and e.archived_at is null and e.status = 'active' and po.code::text in ('MANAGER', 'ASSISTANTMAN') and e.profile_id is not null;
end $$;

-- the zonal manager sends a submitted register (the page shows it as a preview) once to every manager of the hub
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
    insert into public.att_sheet_checks (sheet_id, profile_id, employee_id, sent_by) values (s.id, r.profile_id, r.id, auth.uid())
    on conflict (sheet_id, profile_id) do nothing;
    if found then
      n := n + 1;
      perform private.notify(r.profile_id, 'হাজিরা খাতা যাচাই করুন', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.work_date, 'DD-MM-YYYY') || ' — দেখে "ঠিক আছে" দিন',
        '/app/workforce/hub?tab=final&hub=' || s.hub_id || '&date=' || s.work_date, 'attendance_gap');
    end if;
  end loop;
  if n = 0 and not exists (select 1 from public.att_sheet_checks c where c.sheet_id = s.id) then
    raise exception 'This hub has no manager with a login — এই হাবে লগইনসহ কোনো ম্যানেজার নেই' using errcode = 'P0001';
  end if;
  update public.att_day_sheets set sent_by = auth.uid(), sent_at = coalesce(sent_at, now()) where id = s.id;
  return n;
end $$;

create or replace function public.att_sheet_check_ok(p_sheet uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  update public.att_sheet_checks set ok_at = now() where sheet_id = p_sheet and profile_id = auth.uid() and ok_at is null;
  if not found and not exists (select 1 from public.att_sheet_checks where sheet_id = p_sheet and profile_id = auth.uid()) then
    raise exception 'This register was not sent to you — খাতাটি আপনাকে যাচাইয়ে পাঠানো হয়নি' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Staff: my explanations and my reply
-- ---------------------------------------------------------------------
create or replace function public.att_my_explanations(p_days integer default 62)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id();
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_emp is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'work_date', q.work_date, 'reason', q.reason, 'asked_at', q.asked_at,
            'reply', q.reply, 'replied_at', q.replied_at, 'final_status', l.final_status, 'late_time', to_char(l.late_time, 'HH24:MI'), 'hub', private.hub_name(q.hub_id))
            order by (q.reply is null) desc, q.work_date desc)
    from public.att_explanations q join public.att_day_lines l on l.id = q.line_id
   where q.employee_id = v_emp and q.work_date >= private.wf_today() - least(greatest(coalesce(p_days, 62), 1), 366)), '[]'::jsonb);
end $$;

create or replace function public.att_explain_reply(p_id uuid, p_reply text)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.att_explanations; v_reply text := private.wf_clean(p_reply, 1000); v_prof uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into q from public.att_explanations where id = p_id for update;
  if q.id is null or not private.is_self_employee(q.employee_id) then
    raise exception 'This question is not yours — এই প্রশ্নটি আপনার নয়' using errcode = '42501'; end if;
  if q.reply is not null then raise exception 'You have already replied — জবাব আগেই দেওয়া হয়েছে' using errcode = 'P0001'; end if;
  if v_reply is null then raise exception 'Write the reply — জবাব লিখুন' using errcode = '22023'; end if;
  update public.att_explanations set reply = v_reply, replied_at = now() where id = q.id;
  select s.submitted_by into v_prof from public.att_day_sheets s where s.id = q.sheet_id;
  perform private.notify(v_prof, 'হাজিরার ব্যাখ্যার জবাব এসেছে', (select full_name from public.employees where id = q.employee_id) || ' · ' || to_char(q.work_date, 'DD-MM-YYYY'),
    '/app/workforce/hub?tab=final&hub=' || q.hub_id || '&date=' || q.work_date, 'attendance_gap');
end $$;

-- ---------------------------------------------------------------------
-- 6. Zonal manager: the day's data of every hub (no approving)
-- ---------------------------------------------------------------------
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
           'checks', (select count(*) from public.att_sheet_checks c where c.sheet_id = s.id),
           'checks_ok', (select count(*) from public.att_sheet_checks c where c.sheet_id = s.id and c.ok_at is not null),
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

-- ---------------------------------------------------------------------
-- 7. The monthly register: the submitted days of a hub, present / absent
-- ---------------------------------------------------------------------
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
-- 8. Grants
-- ---------------------------------------------------------------------
revoke all on function private.att_sheet_people(uuid, date), private.att_line_prefill(uuid, date), private.att_sheet_write(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.att_sheet_get(uuid, date), public.att_sheet_save(uuid, date, jsonb), public.att_sheet_submit(uuid, date, jsonb),
  public.att_sheet_unlock(uuid, text), public.att_sheet_send(uuid), public.att_sheet_check_ok(uuid), public.att_my_explanations(integer),
  public.att_explain_reply(uuid, text), public.att_zone_day(uuid, date), public.att_month_sheet(uuid, date) from public, anon;
grant execute on function public.att_sheet_get(uuid, date), public.att_sheet_save(uuid, date, jsonb), public.att_sheet_submit(uuid, date, jsonb),
  public.att_sheet_unlock(uuid, text), public.att_sheet_send(uuid), public.att_sheet_check_ok(uuid), public.att_my_explanations(integer),
  public.att_explain_reply(uuid, text), public.att_zone_day(uuid, date), public.att_month_sheet(uuid, date) to authenticated;
