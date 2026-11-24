begin;

alter table private.wf_morning_rounds drop constraint wf_morning_rounds_check;
alter table private.wf_morning_rounds add column auto_submitted boolean not null default false,
  add constraint wf_morning_submission_actor check (
    (submitted_at is null and submitted_by is null and not auto_submitted)
    or (submitted_at is not null and ((submitted_by is null) = auto_submitted))
  );

alter table public.att_day_sheets add column auto_submitted boolean not null default false;
alter table public.att_day_lines add column auto_review_values jsonb;
create index att_day_sheets_auto_drafts on public.att_day_sheets (hub_id, work_date) where status = 'draft';
create index wf_morning_rounds_auto_drafts on private.wf_morning_rounds (hub_id, work_date)
  where submitted_at is null and returned_at is null;

create table private.attendance_auto_settings (
  hub_id uuid primary key references public.hubs(id),
  morning_cutoff time,
  morning_since date,
  daily_delay_minutes integer check (daily_delay_minutes between 0 and 1439),
  daily_since date,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.profiles(id),
  check ((morning_cutoff is null) = (morning_since is null)),
  check (morning_cutoff is null or morning_cutoff < time '24:00'),
  check ((daily_delay_minutes is null) = (daily_since is null))
);
alter table private.attendance_auto_settings enable row level security;
revoke all on private.attendance_auto_settings from public, anon, authenticated, service_role;

create function public.attendance_automation_get(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare z uuid := private.wf_morning_zone(p_hub); s private.attendance_auto_settings;
begin
  if z is null or not private.has_permission('hr.attendance.configure', z, p_hub) then
    raise exception 'Not authorised to view this hub''s attendance settings' using errcode = '42501';
  end if;
  select * into s from private.attendance_auto_settings where hub_id = p_hub;
  return jsonb_build_object('hub_id', p_hub, 'timezone', 'Asia/Dhaka',
    'morning_cutoff', s.morning_cutoff, 'morning_since', s.morning_since,
    'daily_delay_minutes', s.daily_delay_minutes, 'daily_since', s.daily_since);
end $$;

create function public.attendance_automation_set(p_hub uuid, p_morning_cutoff time, p_daily_delay_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare z uuid := private.wf_morning_zone(p_hub);
begin
  if z is null or not private.has_permission('hr.attendance.configure', z, p_hub) then
    raise exception 'Not authorised to configure this hub''s attendance' using errcode = '42501';
  end if;
  if p_morning_cutoff >= time '24:00' or p_daily_delay_minutes not between 0 and 1439 then
    raise exception 'Choose a time within the day and a daily delay from 0 to 1439 minutes' using errcode = '22023';
  end if;
  insert into private.attendance_auto_settings as s
    (hub_id, morning_cutoff, morning_since, daily_delay_minutes, daily_since, updated_by)
  values (p_hub, p_morning_cutoff, case when p_morning_cutoff is not null then private.wf_today() end,
    p_daily_delay_minutes, case when p_daily_delay_minutes is not null then private.wf_today() end, auth.uid())
  on conflict (hub_id) do update set
    morning_cutoff = excluded.morning_cutoff,
    morning_since = case when excluded.morning_cutoff is not null then coalesce(s.morning_since, excluded.morning_since) end,
    daily_delay_minutes = excluded.daily_delay_minutes,
    daily_since = case when excluded.daily_delay_minutes is not null then coalesce(s.daily_since, excluded.daily_since) end,
    updated_at = statement_timestamp(), updated_by = excluded.updated_by;
  return public.attendance_automation_get(p_hub);
end $$;

create function private.att_sheet_finish(p_hub uuid, p_date date, p_sheet uuid, p_auto boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.att_day_sheets; ln record; v_rec uuid; v_bad text; v_asked integer := 0; v_written integer := 0; v_pending integer := 0; v_pending_ids uuid[];
  v_reasons text[]; v_r text; v_prof uuid; v_hub text := private.hub_name(p_hub);
begin
  select * into s from public.att_day_sheets where id = p_sheet and hub_id = p_hub and work_date = p_date for update;
  if s.id is null or s.status <> 'draft' then
    raise exception 'Only an existing draft can be finalised' using errcode = 'P0001';
  end if;

  -- everyone of the hub is on the register, with a final status and what goes with it
  insert into public.att_day_lines (sheet_id, employee_id, position_id, updated_by)
  select s.id, pp, e.position_id, auth.uid() from private.att_sheet_people(p_hub, p_date) pp join public.employees e on e.id = pp
  on conflict (sheet_id, employee_id) do nothing;
  select string_agg(e.full_name || ': ' || w, '; ' order by e.full_name), array_agg(z.employee_id)
    into v_bad, v_pending_ids from (
    select l.employee_id, case
      when p_auto and l.final_status = 'leave' and not exists (
        select 1 from public.attendance_records r where r.employee_id = l.employee_id and r.work_date = p_date and r.status = 'leave'
        union all
        select 1 from public.leave_requests lr where lr.employee_id = l.employee_id and lr.status = 'approved'
          and p_date between lr.from_date and lr.to_date
      ) then 'ছুটির অনুমোদন যাচাই করুন'
      when p_auto and l.final_status is distinct from 'leave' and exists (
        select 1 from public.attendance_records r where r.employee_id = l.employee_id and r.work_date = p_date and r.status = 'leave'
        union all
        select 1 from public.leave_requests lr where lr.employee_id = l.employee_id and lr.status = 'approved'
          and p_date between lr.from_date and lr.to_date
      ) then 'অনুমোদিত ছুটি মিলিয়ে দেখুন'
      when l.final_status is null then 'হাজিরা বাছুন'
      when l.self_mark_id is not null and l.manager_ok is null then 'হ্যাঁ / না দিন'
      when l.final_status = 'late' and l.late_time is null then 'কখন এসেছেন — সময় দিন'
      when l.final_status in ('present', 'late', 'half_day') and l.online_marked is null then 'অনলাইনে হাজিরা দিয়েছেন কি না — বলুন'
      when l.final_status in ('present', 'late', 'half_day') and not l.online_marked and l.online_reason is null then 'অনলাইনে না দেওয়ার কারণ লিখুন'
      when l.final_status = 'absent' and not l.unauthorized and l.absence_app_date is null then 'অনলাইন আবেদনের তারিখ দিন, অথবা "না জানিয়ে অনুপস্থিত" দিন'
    end w from public.att_day_lines l where l.sheet_id = s.id) z join public.employees e on e.id = z.employee_id
   where w is not null;
  if v_bad is not null and not p_auto then
    raise exception 'Some lines are not complete — কিছু সারি অসম্পূর্ণ: %', v_bad using errcode = '22023';
  end if;

  if p_auto and v_pending_ids is not null then
    update public.att_day_lines l set
      auto_review_values = jsonb_build_object('final_status', l.final_status, 'late_time', l.late_time, 'unauthorized', l.unauthorized),
      final_status = null, late_time = null, unauthorized = false
    where l.sheet_id = s.id and l.employee_id = any(v_pending_ids);
    get diagnostics v_pending = row_count;
  end if;

  perform set_config('app.wf_action', 'approved', true);
  for ln in select x.*, e.profile_id, e.full_name from public.att_day_lines x join public.employees e on e.id = x.employee_id where x.sheet_id = s.id and x.auto_review_values is null loop
    -- the final status goes on the register (every report reads attendance_records)
    insert into public.attendance_records as r (employee_id, work_date, status, check_in, source, note, created_by, updated_by)
    values (ln.employee_id, p_date, ln.final_status,
            case when ln.late_time is not null then ((p_date + ln.late_time) at time zone 'Asia/Dhaka') when ln.final_status in ('present', 'half_day') then null end,
            case when p_auto and ln.final_status = 'leave' then 'leave' else 'manual' end, coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), auth.uid(), auth.uid())
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

  update public.att_day_sheets set status = 'submitted', auto_submitted = p_auto, submitted_by = auth.uid(), submitted_at = now(), updated_at = now(), updated_by = auth.uid()
   where id = s.id;

  -- the zonal managers of the zone hear that the register came in
  for v_prof in select distinct ur.user_id from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                 where ro.code = 'zonal_manager' and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
                   and (ur.zone_id = s.zone_id or ur.scope_type = 'global') loop
    perform private.notify(v_prof, 'দৈনিক ফাইনাল হাজিরা খাতা সাবমিট হয়েছে', coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || case when v_pending > 0 then ' · যাচাই বাকি ' || v_pending else '' end,
      '/app/workforce/zone?tab=final', 'attendance_gap');
  end loop;
  return jsonb_build_object('sheet_id', s.id, 'lines', v_written, 'asked', v_asked, 'pending_review', v_pending);
end $$;


create or replace function public.att_sheet_submit(p_hub uuid, p_date date, p_lines jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  id := private.att_sheet_write(p_hub, p_date, p_lines);
  return private.att_sheet_finish(p_hub, p_date, id, false);
end $$;

create function private.att_sheet_restore_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.att_day_lines l set
    final_status = l.auto_review_values ->> 'final_status',
    late_time = (l.auto_review_values ->> 'late_time')::time,
    unauthorized = (l.auto_review_values ->> 'unauthorized')::boolean,
    auto_review_values = null
  where l.sheet_id = new.id and l.auto_review_values is not null;
  return null;
end $$;

create trigger att_sheet_restore_review after update of status on public.att_day_sheets
for each row when (old.auto_submitted and old.status = 'submitted' and new.status = 'draft')
execute function private.att_sheet_restore_review();

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
               'auto_submitted', s.auto_submitted, 'pending_review', (select count(*) from public.att_day_lines l where l.sheet_id = s.id and l.auto_review_values is not null),
               'unlocked_at', s.unlocked_at, 'unlock_note', s.unlock_note, 'sent_at', s.sent_at) end,
    'can', jsonb_build_object(
      'edit', private.has_permission('hr.attendance.create', v_zone, p_hub) and coalesce(s.status, 'draft') = 'draft' and v_date <= private.wf_today(),
      'unlock', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted',
      'send', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted'),
    'my_check', (select jsonb_build_object('sent_at', c.sent_at, 'ok_at', c.ok_at) from public.att_sheet_checks c where c.sheet_id = s.id and c.profile_id = auth.uid()),
    'people', v_people, 'by_position', v_pos, 'checks', v_checks);
end $$;

create or replace function public.wf_morning_get(p_hub uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  d date := coalesce(p_date, private.wf_today());
  z uuid := private.wf_morning_zone(p_hub);
  is_writer boolean := private.has_permission('hr.morning_attendance.create', z, p_hub);
  is_reviewer boolean := private.has_permission('hr.morning_attendance.approve', z, p_hub);
  r private.wf_morning_rounds;
  people jsonb;
begin
  if auth.uid() is null or z is null or not (is_writer or is_reviewer) then
    raise exception 'Morning headcount is outside your hub scope' using errcode = '42501';
  end if;
  if not isfinite(d) or d > private.wf_today() then
    raise exception 'Choose today or an earlier date' using errcode = '22023';
  end if;

  select * into r from private.wf_morning_rounds
    where hub_id = p_hub and work_date = d order by revision desc limit 1;

  if r.submitted_at is not null and is_reviewer then
    select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'status', m.value)
      order by e.full_name, e.id), '[]'::jsonb) into people
    from jsonb_each_text(r.marks) m join public.employees e on e.id = m.key::uuid;
  elsif r.submitted_at is null and is_writer and d = private.wf_today() then
    select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name,
        'status', case when e.on_leave then 'leave' else coalesce(nullif(r.marks ->> e.id::text, 'leave'), 'unknown') end)
      order by e.full_name, e.id), '[]'::jsonb) into people
    from private.wf_morning_roster(p_hub, d) e;
  end if;

  return jsonb_build_object('hub_id', p_hub, 'work_date', d,
    'revision', coalesce(r.revision, 1),
    'status', case when r.submitted_at is not null then 'submitted'
      when r.returned_at is not null then 'returned'
      when r.revision is null and not is_writer then 'waiting' else 'draft' end,
    'submitted_at', r.submitted_at, 'auto_submitted', coalesce(r.auto_submitted, false), 'return_note', r.return_note,
    'can_edit', is_writer and r.submitted_at is null and d = private.wf_today(),
    'can_return', is_reviewer and r.submitted_at is not null and d = private.wf_today(),
    'people', people);
end $$;


-- Server-only, opt-in, with a clock argument for deterministic database tests.
create function private.attendance_auto_submit(p_now timestamptz default statement_timestamp())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  local_now timestamp := p_now at time zone 'Asia/Dhaka';
  settings private.attendance_auto_settings;
  r private.wf_morning_rounds;
  d public.att_day_sheets;
  v_hub uuid;
  v_date date;
  v_marks jsonb;
  n_morning integer := 0;
  n_daily integer := 0;
  n_errors integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'Scheduled runner requires a system session' using errcode = '42501';
  end if;
  for v_hub, v_date in
    select x.hub_id, x.work_date
    from private.wf_morning_rounds x join private.attendance_auto_settings a using (hub_id)
    join public.hubs h on h.id = x.hub_id and h.status = 'active' and h.archived_at is null
    where x.submitted_at is null and x.returned_at is null and x.work_date >= a.morning_since
      and x.work_date + a.morning_cutoff <= local_now
    order by x.hub_id, x.work_date
  loop
    perform private.wf_morning_lock(v_hub, v_date);
    select * into settings from private.attendance_auto_settings where hub_id = v_hub for share;
    select * into r from private.wf_morning_rounds where hub_id = v_hub and work_date = v_date order by revision desc limit 1;
    if r.submitted_at is null and r.returned_at is null and v_date >= settings.morning_since
        and v_date + settings.morning_cutoff <= local_now then
      select coalesce(jsonb_object_agg(e.id::text, case when e.on_leave then 'leave'
        else coalesce(nullif(r.marks ->> e.id::text, 'leave'), 'unknown') end), '{}'::jsonb)
        into v_marks from private.wf_morning_roster(v_hub, v_date) e;
      update private.wf_morning_rounds set marks = v_marks, submitted_at = p_now, auto_submitted = true
        where hub_id = v_hub and work_date = v_date and revision = r.revision;
      n_morning := n_morning + 1;
    end if;
  end loop;

  for d in
    select x.* from public.att_day_sheets x join private.attendance_auto_settings a using (hub_id)
    join public.hubs h on h.id = x.hub_id and h.status = 'active' and h.archived_at is null
    where x.status = 'draft' and x.unlocked_at is null and x.work_date >= a.daily_since
      and (x.work_date + 1)::timestamp + make_interval(mins => a.daily_delay_minutes) <= local_now
      and x.work_date < private.wf_today()
    order by x.hub_id, x.work_date for update of x skip locked
  loop
    select * into settings from private.attendance_auto_settings where hub_id = d.hub_id for share;
    if d.work_date >= settings.daily_since
        and (d.work_date + 1)::timestamp + make_interval(mins => settings.daily_delay_minutes) <= local_now then
      begin
        perform private.att_sheet_finish(d.hub_id, d.work_date, d.id, true);
        n_daily := n_daily + 1;
      exception when others then
        raise warning 'Attendance auto-submit failed for sheet % (SQLSTATE %)', d.id, sqlstate;
        n_errors := n_errors + 1;
      end;
    end if;
  end loop;
  return jsonb_build_object('morning', n_morning, 'daily', n_daily, 'errors', n_errors);
end $$;

revoke all on function private.att_sheet_finish(uuid, date, uuid, boolean), private.att_sheet_restore_review(),
  private.attendance_auto_submit(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.attendance_automation_get(uuid), public.attendance_automation_set(uuid, time, integer)
from public, anon, authenticated, service_role;
grant execute on function public.attendance_automation_get(uuid), public.attendance_automation_set(uuid, time, integer) to authenticated;

do $$
begin
  if to_regnamespace('cron') is not null and exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('attendance-auto-submit', '* * * * *', $job$select private.attendance_auto_submit()$job$);
  end if;
end $$;

commit;
