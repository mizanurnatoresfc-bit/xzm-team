-- Retain endpoint authorization and enforce release policies before serving data or changing state.

create or replace function public.att_sheet_get(p_hub uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, private.wf_today()); s public.att_day_sheets; v_people jsonb; v_checks jsonb; v_pos jsonb;
  v_zone uuid := private.hub_zone(p_hub);
begin
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  perform public.module_release_require('attendance', p_hub);
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

create or replace function public.wf_hub_overview(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, private.wf_today()); h public.hubs; v_can jsonb; v_ops boolean;
  v_att jsonb; v_total integer; v_people jsonb; v_pend jsonb; v_opsj jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);   -- raises 42501 when the caller may not see this hub
  perform public.module_release_require('workforce', p_hub);
  select * into h from public.hubs x where x.id = p_hub;
  v_can := private.wf_can(h.id);
  v_ops := (v_can ->> 'ops')::boolean;
  with g as (select * from private.wf_grid(v_date, v_date, p_hub)),
  p as (
    select g.*, e.employee_code::text as code, e.full_name, e.mobile,
           (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id) as pos,
           (private.is_current_rider(e.id, p_hub)
            or exists (select 1 from public.positions po where po.id = e.position_id
                         and (po.code::text ilike '%rider%' or po.name ilike '%rider%' or coalesce(po.name_bn, '') like '%রাইডার%'))) as is_rider
    from g join public.employees e on e.id = g.employee_id)
  select jsonb_build_object('present', count(*) filter (where record_status = 'present'), 'late', count(*) filter (where record_status = 'late'),
           'half_day', count(*) filter (where record_status = 'half_day'), 'absent', count(*) filter (where record_status = 'absent'),
           'leave', count(*) filter (where record_status = 'leave'), 'other', count(*) filter (where record_status in ('holiday', 'weekly_off')),
           'not_given', count(*) filter (where record_status is null and state in ('missing', 'closed')),
           'waiting_marks', count(*) filter (where state = 'waiting'), 'returned_marks', count(*) filter (where state = 'returned')),
         count(*),
         coalesce(jsonb_agg(jsonb_build_object('employee_id', p.employee_id, 'code', p.code, 'name', p.full_name, 'position', p.pos, 'mobile', p.mobile,
           'is_rider', p.is_rider, 'record_status', p.record_status, 'mark_kind', p.kind, 'mark_status', p.mark_status,
           'ops_submitted', case when v_ops then exists (select 1 from public.wf_daily_ops o where o.employee_id = p.employee_id and o.work_date = v_date) end)
           order by p.full_name), '[]'::jsonb)
    into v_att, v_total, v_people from p;
  v_pend := jsonb_build_object(
    'marks', (select count(*) from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
               where m.status = 'waiting' and e.hub_id = p_hub and e.archived_at is null and e.profile_id is distinct from auth.uid()),
    'applications', (select count(*) from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
               where a.status = 'pending' and e.hub_id = p_hub and e.archived_at is null and e.profile_id is distinct from auth.uid()));
  if v_ops then
    select jsonb_build_object('submitted', count(*), 'missing', (select count(*) from private.wf_ops_missing(v_date, array[p_hub])),
             'pickup', coalesce(sum(o.pickup), 0), 'pickup_return', coalesce(sum(o.pickup_return), 0),
             'delivery', coalesce(sum(o.delivery), 0), 'delivery_return', coalesce(sum(o.delivery_return), 0))
      into v_opsj from public.wf_daily_ops o where o.hub_id = p_hub and o.work_date = v_date;
  end if;
  return jsonb_build_object('hub', private.wf_hub_json(h.id), 'date', v_date, 'can', v_can, 'staff_total', v_total,
                            'attendance', v_att, 'pending', v_pend, 'ops', v_opsj, 'people', v_people);
end $$;

create or replace function public.wf_hub_book(p_hub uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day();
  v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_last integer; v_d1 date; v_d2 date;
  v_open boolean; v_dates jsonb; v_people jsonb; v_all text[]; v_win jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  perform public.module_release_require('workforce', p_hub);
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_win := private.wf_live_window(private.wf_zone_of(p_hub, null), v_month);
  v_open := (v_month = date_trunc('month', v_today)::date and extract(day from v_today)::integer between v_from and v_to) or v_win is not null;
  v_d1 := v_month + (least(v_from, v_last) - 1);
  v_d2 := v_month + (least(v_to, v_last) - 1);
  select coalesce(jsonb_agg(v_d1 + i order by i), '[]'::jsonb) into v_dates from generate_series(0, v_d2 - v_d1) i;
  with g as (select * from private.wf_grid(v_d1, v_d2, p_hub)),
  per as (
    select g.employee_id, array_agg(private.wf_cell(g.state, g.record_status) order by g.work_date) as codes,
           jsonb_agg(jsonb_build_object('s', private.wf_cell(g.state, g.record_status), 'k', g.kind, 'a', g.applied_on_site, 'id', g.mark_id) order by g.work_date) as cells
    from g group by g.employee_id)
  select (select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name,
                   'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
                   'cells', per.cells, 'summary', private.wf_summary(per.codes)) order by e.full_name), '[]'::jsonb)
            from per join public.employees e on e.id = per.employee_id),
         (select coalesce(array_agg(c), '{}'::text[]) from per cross join lateral unnest(per.codes) c)
    into v_people, v_all;
  return jsonb_build_object('hub', private.wf_hub_json(p_hub), 'month', v_month, 'today', v_today,
    'window', jsonb_build_object('from_day', v_from, 'to_day', v_to), 'open', v_open, 'catch_up', v_win, 'can', private.wf_can(p_hub),
    'dates', v_dates, 'people', v_people, 'totals', private.wf_summary(v_all));
end $$;

create or replace function public.issue_create(
  p_hub uuid, p_title text, p_body text default null, p_kind text default 'parcel',
  p_parcel_ref text default null, p_photo text default null, p_assignee uuid default null,
  p_due timestamptz default null, p_priority text default 'normal')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  v_parcel public.parcels;
  v_ass public.employees;
  v_ref text := nullif(trim(coalesce(p_parcel_ref, '')), '');
  v_id uuid; v_no text; v_auto boolean := false; v_label text;
  v_order boolean := p_kind in ('store', 'it');
  v_what text := case p_kind when 'store' then 'স্টোর অর্ডার' when 'it' then 'আইটি অর্ডার' end;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_zone is null then raise exception 'হাব বেছে নিন' using errcode = '22023'; end if;
  if not private.in_hub_group(p_hub) then raise exception 'এই হাবের ইস্যু দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  perform public.module_release_require('issues', p_hub);
  if p_kind not in ('parcel', 'vehicle', 'staff', 'cash', 'other', 'store', 'it') or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'ধরন বা গুরুত্ব ঠিক নয়' using errcode = '22023'; end if;
  if v_order then
    if coalesce(trim(p_title), '') = '' and coalesce(trim(p_body), '') = '' then raise exception 'কী কী লাগবে লিখুন' using errcode = '22023'; end if;
  elsif coalesce(trim(p_title), '') = '' and v_ref is null and p_photo is null then
    raise exception 'কী সমস্যা তা লিখুন, পার্সেল আইডি দিন বা ছবি দিন' using errcode = '22023';
  end if;

  if v_ref is not null then
    select * into v_parcel from public.parcels where tracking_no = v_ref and hub_id = p_hub;
  end if;
  if p_assignee is not null then
    select * into v_ass from public.employees where id = p_assignee and archived_at is null and status = 'active';
    if not found then raise exception 'যাকে দেওয়া হচ্ছে তাকে পাওয়া যায়নি বা সে সক্রিয় নয়' using errcode = 'P0002'; end if;
  elsif v_order then
    select * into v_ass from public.employees where id = private.issue_order_assignee(p_kind);
  elsif v_parcel.assigned_rider_id is not null then
    select * into v_ass from public.employees where id = v_parcel.assigned_rider_id and archived_at is null;
    v_auto := found;
  end if;

  perform set_config('app.change_reason', case when v_order then v_what else 'ইস্যু তৈরি' end, true);
  insert into public.issues (hub_id, zone_id, kind, title, body, priority, parcel_ref, parcel_id, photo_path,
                             assignee_id, assigned_by, assigned_by_name, assigned_by_nodi, due_at)
  values (p_hub, v_zone, p_kind,
          coalesce(nullif(trim(coalesce(p_title, '')), ''),
                   case when v_order then v_what when v_ref is not null then 'পার্সেল ' || v_ref else 'ছবি থেকে ইস্যু' end),
          nullif(trim(coalesce(p_body, '')), ''), p_priority, v_ref, v_parcel.id, p_photo,
          v_ass.id, auth.uid(), private.my_display_name(), v_auto, p_due)
  returning id, issue_no into v_id, v_no;
  perform private.issue_log(v_id, 'created', coalesce(p_body, p_title));
  if v_ass.id is not null then
    perform private.issue_log(v_id, case when v_auto then 'assigned_by_nodi' else 'assigned' end, v_ass.full_name || coalesce(' (' || v_ass.employee_code || ')', ''));
  end if;

  v_label := v_no || ' · ' || (select title from public.issues where id = v_id);
  perform private.hub_post_add(p_hub, 'issue',
    case when v_order and v_ass.id is null then 'নতুন ' || v_what || ' — দায়িত্বে কাউকে ঠিক করা নেই'
         when v_order then v_what || ' দেওয়া হলো: ' || v_ass.full_name
         when v_ass.id is null then 'নতুন ইস্যু — এখনো কাউকে দেওয়া হয়নি'
         when v_auto then 'নদী AI পার্সেলের রাইডার দেখে কাজটি দিল: ' || v_ass.full_name
         else 'কাজ দেওয়া হলো: ' || v_ass.full_name end,
    v_id, v_auto, p_photo);
  perform private.notify(v_ass.profile_id,
    case when v_order then 'আপনার কাছে একটি ' || v_what || ' এসেছে' else 'আপনাকে একটি কাজ দেওয়া হয়েছে' end,
    v_label, '/app/issues?id=' || v_id, 'issue');
  return v_id;
end $$;

create or replace function public.fleet_post(p_log uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x public.vehicle_logs; v public.vehicles;
begin
  select * into x from public.vehicle_logs where id = p_log and removed_at is null;
  if x.id is null then raise exception 'Log line not found.' using errcode = 'P0002'; end if;
  select * into v from public.vehicles where id = x.vehicle_id;
  if not (private.has_permission('vehicle.log.approve', v.zone_id, v.hub_id) or (x.kind = 'khoraki' and private.has_permission('vehicle.khoraki.post', v.zone_id, v.hub_id))) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  perform public.module_release_require('fleet', v.hub_id);
  return private.fleet_post(p_log);
end $$;

create or replace function public.fleet_garage_save(p_vehicle uuid, p_date date, p_charged boolean, p_cost numeric default null, p_place text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.vehicles; v_day uuid; v_log uuid; r jsonb := '{}'::jsonb;
begin
  select * into v from public.vehicles where id = p_vehicle and archived_at is null;
  if v.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if not private.fleet_on('garage') then raise exception 'Garage charge is switched off in the vehicle settings.' using errcode = '22023'; end if;
  if not private.has_permission('vehicle.log.create', v.zone_id, v.hub_id) then raise exception 'Not authorised to write the garage charge.' using errcode = '42501'; end if;
  perform public.module_release_require('fleet', v.hub_id);
  if p_cost is not null and p_cost < 0 then raise exception 'The bill cannot be negative.' using errcode = '22023'; end if;
  v_day := public.vehicle_day_save(v.id, p_date, p_charged, p_place, case when p_charged then p_cost end, null, null, null, null, null, '{}'::jsonb, p_note, null);
  select id into v_log from public.vehicle_logs where day_log_id = v_day and removed_at is null;
  if v_log is not null then
    begin
      r := private.fleet_post(v_log);
    exception when others then
      r := jsonb_build_object('posted', false, 'error', sqlerrm);
    end;
  end if;
  return r || jsonb_build_object('day', v_day);
end $$;
