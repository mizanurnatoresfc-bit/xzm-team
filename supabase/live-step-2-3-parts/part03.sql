-- Part 3 of 7. Run in the Supabase SQL editor of the LIVE project, in order, one at a time. It only stores text in a scratch table; nothing changes yet.
insert into private._mig_stage(part, body) values (3, $mig$  v_date date := coalesce(p_date, private.wf_today()); s public.att_day_sheets; v_people jsonb; v_checks jsonb; v_pos jsonb;
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
    'hold', (select jsonb_build_object('held_at', k.held_at, 'reason', k.reason, 'gap_count', k.gap_count, 'total', k.total, 'gaps', k.gaps)
               from public.wf_auto_holds k where k.kind = 'daily' and k.hub_id = p_hub and k.work_date = v_date and k.resolved_at is null),
    'window', (select jsonb_build_object('id', w.id, 'from', w.from_date, 'to', w.to_date, 'expires_at', w.expires_at, 'reason', w.reason, 'by', w.approved_by_name)
                 from public.att_reopen_windows w where w.id = private.att_open_window(p_hub, v_date)),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('no', v.version_no, 'mode', v.mode, 'at', v.submitted_at, 'by', v.submitted_by_name) order by v.version_no desc)
                            from public.att_sheet_versions v where v.sheet_id = s.id), '[]'::jsonb),
    'can', jsonb_build_object(
      'edit', private.has_permission('hr.attendance.create', v_zone, p_hub) and coalesce(s.status, 'draft') = 'draft' and v_date <= private.wf_today() and private.att_edit_open(p_hub, v_date),
      'unlock', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted',
      'send', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted',
      'confirm_self', private.has_permission('hr.attendance.configure', v_zone, p_hub) and s.status = 'submitted'),
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
           'held', exists (select 1 from public.wf_auto_holds k where k.kind = 'daily' and k.hub_id = h.id and k.work_date = v_date and k.resolved_at is null),
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
  v := private.att_sheet_close(p_hub, p_date, auth.uid(), 'manager', private.att_open_window(p_hub, p_date));
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
  values (p_hub, v_zone, p_from, p_to, now() + make_interval(mins => p_minutes), p_reason, p_by, v_name) returning id into v_id;$mig$);
