-- Master audit of 22 Nov 2026 — the three points the owner decided ("রোল, জোনাল আপ্রুভাল"). Safe to run again.
--
-- 1. A hub manager no longer settles their own attendance. On the final register the submitter's own line is kept as what
--    they say (self_pending); it goes on the attendance register only when the zonal manager makes it final with
--    att_sheet_confirm_self (the zonal manager may change the status). Every other line is as before.
-- 2. "Send for checking" and the unlock notice find the hub's managers by ROLE (hub_manager scoped to the hub) as well as
--    by the position codes MANAGER / ASSISTANTMAN, so a hub whose manager has another position is not left out.
-- Each replaced function is the body that was live before with only the marked change.

alter table public.att_day_lines add column if not exists self_pending boolean not null default false;
alter table public.att_day_lines add column if not exists confirmed_by uuid;
alter table public.att_day_lines add column if not exists confirmed_at timestamptz;

-- The hub's managers with a login: the hub_manager role on this hub, or the manager / assistant manager positions.
create or replace function private.att_hub_managers(p_hub uuid) returns table (id uuid, profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id, e.profile_id
    from public.employees e left join public.positions po on po.id = e.position_id
   where e.hub_id = p_hub and e.archived_at is null and e.status = 'active' and e.profile_id is not null
     and (po.code::text in ('MANAGER', 'ASSISTANTMAN')
          or exists (select 1 from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                      where ur.user_id = e.profile_id and ro.code = 'hub_manager' and ur.hub_id = p_hub and ur.revoked_at is null
                        and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)))
$$;
revoke all on function private.att_hub_managers(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.att_sheet_submit(p_hub uuid, p_date date, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_sheet uuid; s public.att_day_sheets; ln record; v_rec uuid; v_bad text; v_asked integer := 0; v_written integer := 0;
  v_reasons text[]; v_r text; v_prof uuid; v_hub text := private.hub_name(p_hub); v_in timestamptz; v_self boolean := false;
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
  for ln in select x.*, e.profile_id, e.full_name, e.status as emp_status from public.att_day_lines x join public.employees e on e.id = x.employee_id where x.sheet_id = s.id loop
    -- the final status goes on the register (every report reads attendance_records)
    -- The submitter's own line is not theirs to settle: it stays on the sheet as what they say, and the zonal manager makes it final.
    if ln.profile_id = auth.uid() then
      update public.att_day_lines set self_pending = true, confirmed_by = null, confirmed_at = null where id = ln.id;
      v_self := true;
      continue;
    end if;
    update public.att_day_lines set self_pending = false where id = ln.id and self_pending;
    -- An existing register row is updated; a new one is written only for someone still active. A person who left after
    -- the line was put on the register keeps the line, but gets no new register row (the register refuses leavers).
    v_in := case when ln.late_time is not null then ((p_date + ln.late_time) at time zone 'Asia/Dhaka') end;
    v_rec := null;
    update public.attendance_records r
       set status = ln.final_status, check_in = coalesce(v_in, case when ln.final_status in ('present', 'late', 'half_day') then r.check_in end),
           note = coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), updated_by = auth.uid()
     where r.employee_id = ln.employee_id and r.work_date = p_date
    returning r.id into v_rec;
    if v_rec is null and ln.emp_status = 'active' then
      insert into public.attendance_records as r (employee_id, work_date, status, check_in, source, note, created_by, updated_by)
      values (ln.employee_id, p_date, ln.final_status, v_in, 'manual', coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), auth.uid(), auth.uid())
      on conflict (employee_id, work_date) do update set status = excluded.status, note = excluded.note, updated_by = auth.uid()
      returning r.id into v_rec;
    end if;
    if v_rec is not null then v_written := v_written + 1; end if;
    -- the person's own waiting input of the date is settled by the register
    update public.attendance_self_marks m set status = 'approved',
           decided_as = case when ln.final_status in ('present', 'late', 'half_day', 'absent') then ln.final_status end,
           decided_by = auth.uid(), decided_at = now(), attendance_id = v_rec, decide_note = 'দৈনিক ফাইনাল খাতা'
     where m.id = ln.self_mark_id and m.status = 'waiting' and v_rec is not null;

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
    perform private.notify(v_prof, 'দৈনিক ফাইনাল হাজিরা খাতা সাবমিট হয়েছে', coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY')
      || case when v_self then ' — ম্যানেজারের নিজের হাজিরা আপনি চূড়ান্ত করবেন' else '' end,
      case when v_self then '/app/workforce/hub?tab=final&hub=' || p_hub || '&date=' || p_date else '/app/workforce/zone?tab=final' end, 'attendance_gap');
  end loop;
  return jsonb_build_object('sheet_id', s.id, 'lines', v_written, 'asked', v_asked);
end $$;

CREATE OR REPLACE FUNCTION public.att_sheet_get(p_hub uuid, p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
           l.id line_id, coalesce(l.self_pending, false) self_pending, l.confirmed_at, r.status rec,
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
           'saved', x.line_id is not null, 'line_id', x.line_id, 'self_pending', x.self_pending, 'confirmed_at', x.confirmed_at, 'value', x.val, 'record_status', x.rec,
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
      'send', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted',
      'confirm_self', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted'),
    'my_check', (select jsonb_build_object('sent_at', c.sent_at, 'ok_at', c.ok_at) from public.att_sheet_checks c where c.sheet_id = s.id and c.profile_id = auth.uid()),
    'people', v_people, 'by_position', v_pos, 'checks', v_checks);
end $$;

CREATE OR REPLACE FUNCTION public.att_sheet_unlock(p_sheet uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
    from private.att_hub_managers(s.hub_id) e;
end $$;

CREATE OR REPLACE FUNCTION public.att_sheet_send(p_sheet uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare s public.att_day_sheets; n integer := 0; r record;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet for update;
  if s.id is null then raise exception 'No such register — খাতা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', s.zone_id, s.hub_id) then
    raise exception 'Only the zonal manager sends a register for checking — শুধু জোনাল ম্যানেজার যাচাইয়ে পাঠাতে পারেন' using errcode = '42501'; end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted register is sent — আগে ম্যানেজার খাতা সাবমিট দিন' using errcode = 'P0001'; end if;
  for r in select e.id, e.profile_id from private.att_hub_managers(s.hub_id) e loop
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

-- The zonal manager makes a manager's own line final (and may correct it first).
create or replace function public.att_sheet_confirm_self(p_line uuid, p_status text default null, p_late_time text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.att_day_lines; s public.att_day_sheets; e public.employees; v_status text; v_late time; v_in timestamptz; v_rec uuid;
  v_note text := private.wf_clean(p_note);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into l from public.att_day_lines where id = p_line for update;
  if l.id is null then raise exception 'No such line — সারিটি পাওয়া যায়নি' using errcode = 'P0002'; end if;
  select * into s from public.att_day_sheets where id = l.sheet_id for update;
  if not private.has_permission('hr.attendance.configure', s.zone_id, s.hub_id) then
    raise exception 'Only the zonal manager makes a manager''s own attendance final — ম্যানেজারের নিজের হাজিরা শুধু জোনাল ম্যানেজার চূড়ান্ত করেন' using errcode = '42501'; end if;
  if s.status <> 'submitted' then raise exception 'The register is not submitted — খাতা এখনো সাবমিট হয়নি' using errcode = 'P0001'; end if;
  if not l.self_pending then raise exception 'This line is already final — এই সারি আগেই চূড়ান্ত' using errcode = 'P0001'; end if;
  select * into e from public.employees where id = l.employee_id;
  if e.profile_id = auth.uid() then
    raise exception 'Your own attendance is made final by someone else — নিজের হাজিরা নিজে চূড়ান্ত করা যায় না' using errcode = '42501'; end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), l.final_status);
  if v_status is null or v_status not in ('present', 'late', 'half_day', 'absent', 'leave', 'holiday', 'weekly_off') then
    raise exception 'Choose the attendance — হাজিরা বাছুন' using errcode = '22023'; end if;
  if v_status = 'late' then
    if nullif(btrim(coalesce(p_late_time, '')), '') is not null and btrim(p_late_time) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Write the time as HH:MM — সময় ঘণ্টা:মিনিট এভাবে দিন' using errcode = '22023'; end if;
    v_late := coalesce(nullif(btrim(coalesce(p_late_time, '')), '')::time, l.late_time);
    if v_late is null then raise exception 'Give the arrival time — কখন এসেছেন, সময় দিন' using errcode = '22023'; end if;
  end if;

  update public.att_day_lines
     set final_status = v_status, late_time = v_late, unauthorized = unauthorized and v_status = 'absent',
         note = coalesce(v_note, note), self_pending = false, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now(), updated_by = auth.uid()
   where id = l.id;

  v_in := case when v_late is not null then ((s.work_date + v_late) at time zone 'Asia/Dhaka') end;
  perform set_config('app.wf_action', 'approved', true);
  update public.attendance_records r
     set status = v_status, check_in = coalesce(v_in, case when v_status in ('present', 'late', 'half_day') then r.check_in end),
         note = coalesce(v_note, l.note, 'দৈনিক ফাইনাল খাতা — জোনাল ম্যানেজার চূড়ান্ত করেছেন'), updated_by = auth.uid()
   where r.employee_id = l.employee_id and r.work_date = s.work_date
  returning r.id into v_rec;
  if v_rec is null and e.status = 'active' then
    insert into public.attendance_records as r (employee_id, work_date, status, check_in, source, note, created_by, updated_by)
    values (l.employee_id, s.work_date, v_status, v_in, 'manual', coalesce(v_note, l.note, 'দৈনিক ফাইনাল খাতা — জোনাল ম্যানেজার চূড়ান্ত করেছেন'), auth.uid(), auth.uid())
    returning r.id into v_rec;
  end if;
  update public.attendance_self_marks m set status = 'approved',
         decided_as = case when v_status in ('present', 'late', 'half_day', 'absent') then v_status end,
         decided_by = auth.uid(), decided_at = now(), attendance_id = v_rec, decide_note = 'দৈনিক ফাইনাল খাতা'
   where m.id = l.self_mark_id and m.status = 'waiting' and v_rec is not null;
  perform set_config('app.wf_action', '', true);

  perform private.notify(e.profile_id, 'আপনার হাজিরা চূড়ান্ত হয়েছে', to_char(s.work_date, 'DD-MM-YYYY') || ' — জোনাল ম্যানেজার চূড়ান্ত করেছেন',
    '/app/workforce/attendance', 'attendance_gap');
  return jsonb_build_object('line_id', l.id, 'final_status', v_status, 'record_id', v_rec);
end $$;
revoke all on function public.att_sheet_confirm_self(uuid, text, text, text) from public, anon;
grant execute on function public.att_sheet_confirm_self(uuid, text, text, text) to authenticated, service_role;
