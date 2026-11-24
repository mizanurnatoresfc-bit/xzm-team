-- Part 2 of 7. Run in the Supabase SQL editor of the LIVE project, in order, one at a time. It only stores text in a scratch table; nothing changes yet.
insert into private._mig_stage(part, body) values (2, $mig$-- write the given lines of a sheet (draft only); returns the sheet id
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
-- Returns null when the register was already submitted (the other caller got there first).
-- The register's draft is made ready: everyone of the hub has a line, approved leave puts itself on its line, "marked online" and its time come from the person's own mark.
create or replace function private.att_sheet_prepare(p_sheet uuid, p_hub uuid, p_date date, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ln record; v_leave jsonb;
begin
  -- everyone of the hub is on the register
  insert into public.att_day_lines (sheet_id, employee_id, position_id, updated_by)
  select p_sheet, pp, e.position_id, p_by from private.att_sheet_people(p_hub, p_date) pp join public.employees e on e.id = pp
  on conflict (sheet_id, employee_id) do nothing;
  -- approved leave puts itself on the line (a line already right is not touched: the job calls this every minute for a held register)
  for ln in select x.id, x.employee_id from public.att_day_lines x where x.sheet_id = p_sheet loop
    v_leave := private.wf_leave_on(ln.employee_id, p_date);
    if v_leave is not null then
      update public.att_day_lines set final_status = 'leave', late_time = null, unauthorized = false, absence_reason = null, online_marked = null, online_at = null, online_reason = null,
             absence_app_date = (v_leave ->> 'applied_on')::date, absence_app_ref = v_leave ->> 'ref', leave_ref = v_leave ->> 'ref', leave_applied_on = (v_leave ->> 'applied_on')::date
       where id = ln.id and (final_status, leave_ref, leave_applied_on) is distinct from ('leave', v_leave ->> 'ref', (v_leave ->> 'applied_on')::date);
    end if;
  end loop;
  -- "marked online" and its time come from the person's own mark
  update public.att_day_lines l set
         online_marked = coalesce((select m.kind = 'present' from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date), false),
         online_at = (select m.marked_at from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present'),
         online_reason = case when exists (select 1 from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present')
                              then null else l.online_reason end
   where l.sheet_id = p_sheet and l.final_status in ('present', 'late', 'half_day')
     and (l.online_marked, l.online_at, l.online_reason) is distinct from (
           coalesce((select m.kind = 'present' from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date), false),
           (select m.marked_at from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present'),
           case when exists (select 1 from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present') then null else l.online_reason end);
end $$;

create or replace function private.att_sheet_close(p_hub uuid, p_date date, p_by uuid, p_mode text, p_window uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.att_day_sheets; ln record; v_rec uuid; v_bad text; v_asked integer := 0; v_written integer := 0; v_reasons text[]; v_r text; v_prof uuid;
  v_hub text := private.hub_name(p_hub); v_name text; v_no integer; v_zone uuid := private.hub_zone(p_hub); v_left integer; v_in timestamptz; v_self boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('att_sheet:' || p_hub::text || p_date::text, 0));
  insert into public.att_day_sheets (hub_id, zone_id, work_date) values (p_hub, v_zone, p_date) on conflict (hub_id, work_date) do nothing;
  select * into s from public.att_day_sheets where hub_id = p_hub and work_date = p_date for update;
  if s.status = 'submitted' then return null; end if;

  perform private.att_sheet_prepare(s.id, p_hub, p_date, p_by);
  select string_agg(e.full_name || ': ' || w, '; ' order by e.full_name) into v_bad
    from (select l.employee_id, private.att_line_gap(l) w from public.att_day_lines l where l.sheet_id = s.id) z join public.employees e on e.id = z.employee_id
   where w is not null;
  -- an empty or unfinished register is never submitted, by anybody
  if v_bad is not null then raise exception 'Some lines are not complete — কিছু সারি অসম্পূর্ণ: %', v_bad using errcode = '22023'; end if;

  perform set_config('app.wf_action', 'approved', true);
  for ln in select x.*, e.profile_id, e.full_name, e.status as emp_status from public.att_day_lines x join public.employees e on e.id = x.employee_id where x.sheet_id = s.id loop
    continue when ln.final_status in ('unchecked', 'pending_leave');          -- nothing goes on the register for a line nobody has checked
    -- The submitter's own line is not theirs to settle: it stays on the sheet as what they say, and the zonal manager makes it final (att_sheet_confirm_self).
    if p_by is not null and ln.profile_id = p_by then
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
           note = coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), updated_by = p_by
     where r.employee_id = ln.employee_id and r.work_date = p_date
    returning r.id into v_rec;
    if v_rec is null and ln.emp_status = 'active' then
      insert into public.attendance_records as r (employee_id, work_date, status, check_in, source, note, created_by, updated_by)
      values (ln.employee_id, p_date, ln.final_status, v_in, 'manual', coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), p_by, p_by)
      on conflict (employee_id, work_date) do update set status = excluded.status, note = excluded.note, updated_by = p_by
      returning r.id into v_rec;
    end if;
    if v_rec is not null then v_written := v_written + 1; end if;
    update public.attendance_self_marks m set status = 'approved',
           decided_as = case when ln.final_status in ('present', 'late', 'half_day', 'absent') then ln.final_status end,
           decided_by = p_by, decided_at = now(), attendance_id = v_rec, decide_note = 'দৈনিক ফাইনাল খাতা'
     where m.id = ln.self_mark_id and m.status = 'waiting' and v_rec is not null;

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

  perform private.wf_hold_resolve('daily', p_hub, p_date);
  select count(*) into v_left from public.att_day_lines where sheet_id = s.id and final_status in ('unchecked', 'pending_leave');
  -- the zonal managers hear that the register came in; when the server did it, the hub's managers hear it too
  for v_prof in select distinct ur.user_id from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                 where ro.code = 'zonal_manager' and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= private.wf_today())
                   and (ur.zone_id = s.zone_id or ur.scope_type = 'global') loop
    perform private.notify(v_prof, case when p_mode = 'auto' then 'দৈনিক হাজিরা খাতা সার্ভার সাবমিট করেছে' else 'দৈনিক ফাইনাল হাজিরা খাতা সাবমিট হয়েছে' end,
      coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || case when v_left > 0 then ' · ' || v_left || ' জনের হাজিরা যাচাই বাকি' else '' end
        || case when v_self then ' — ম্যানেজারের নিজের হাজিরা আপনি চূড়ান্ত করবেন' else '' end,
      case when v_self then '/app/attendance?view=hub&tab=final&hub=' || p_hub::text || '&date=' || p_date::text else '/app/attendance?view=zone&tab=final' end, 'attendance_gap');
  end loop;
  if p_mode = 'auto' then
    for v_prof in select * from private.wf_role_hub_managers(p_hub) loop
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
declare$mig$);
