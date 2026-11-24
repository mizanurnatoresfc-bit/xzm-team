-- Part 7 of 7. Run in the Supabase SQL editor of the LIVE project, in order, one at a time. It only stores text in a scratch table; nothing changes yet.
insert into private._mig_stage(part, body) values (7, $mig$  if v_from > v_to or v_to - v_from > 123 then raise exception 'Choose a period of at most four months.' using errcode = '22023'; end if;

  -- attendance: this person's lines of the registers, each only where the viewer may see that hub's attendance; draft and submitted apart
  select coalesce(jsonb_agg(jsonb_build_object('date', s.work_date, 'hub_id', s.hub_id, 'hub', private.hub_name(s.hub_id), 'status', l.final_status, 'sheet_status', s.status, 'version', s.version,
           'late_time', to_char(l.late_time, 'HH24:MI'), 'absence_reason', l.absence_reason, 'unauthorized', l.unauthorized, 'leave_ref', l.leave_ref, 'leave_applied_on', l.leave_applied_on,
           'online_marked', l.online_marked, 'online_at', l.online_at, 'mode', s.submit_mode) order by s.work_date desc), '[]'::jsonb) into v_days
    from public.att_day_lines l join public.att_day_sheets s on s.id = l.sheet_id
   where l.employee_id = p_employee and s.work_date between v_from and v_to and (v_self or private.has_permission('hr.attendance.view', s.zone_id, s.hub_id));
  v_att := jsonb_build_object('days', v_days,
    'present', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' in ('present', 'late', 'half_day')),
    'late', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' = 'late'),
    'absent', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' = 'absent'),
    'unauthorized', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and (d ->> 'unauthorized')::boolean),
    'leave', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' = 'leave'),
    'off', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' in ('holiday', 'weekly_off')),
    'unchecked', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'submitted' and d ->> 'status' in ('unchecked', 'pending_leave')),
    'drafts', (select count(*) from jsonb_array_elements(v_days) d where d ->> 'sheet_status' = 'draft'));

  -- every module's lines, each only where the viewer may see its hub (a line of a zone-wide record needs the zone)
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'date', w.work_date, 'module', w.module, 'activity', w.activity, 'status', w.status, 'hub_id', w.hub_id, 'hub', private.hub_name(w.hub_id),
           'source_id', w.source_id, 'version', w.source_version, 'detail', w.detail, 'server_time', w.server_time, 'link', w.link) order by w.work_date desc, w.server_time desc), '[]'::jsonb) into v_events
    from (select * from public.staff_work_events x where x.employee_id = p_employee and x.work_date between v_from and v_to
             and (v_self or private.has_permission('hr.employee.view', x.zone_id, x.hub_id)) order by x.work_date desc, x.server_time desc limit 300) w;
  select coalesce(jsonb_agg(jsonb_build_object('module', t.module, 'submitted', t.submitted, 'draft', t.draft, 'cancelled', t.cancelled, 'last_at', t.last_at) order by t.module), '[]'::jsonb) into v_mods
    from (select x.module, count(distinct x.source_id) filter (where x.status in ('submitted', 'approved')) as submitted, count(distinct x.source_id) filter (where x.status = 'draft') as draft,
                 count(distinct x.source_id) filter (where x.status = 'cancelled') as cancelled, max(x.server_time) as last_at
            from public.staff_work_events x where x.employee_id = p_employee and x.work_date between v_from and v_to
             and (v_self or private.has_permission('hr.employee.view', x.zone_id, x.hub_id)) group by x.module) t;

  return jsonb_build_object('from', v_from, 'to', v_to, 'today', private.wf_today(),
    'person', jsonb_build_object('id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'name_bn', e.full_name_bn, 'status', e.status, 'joining_date', e.joining_date,
      'position_id', e.position_id, 'position', (select coalesce(ps.name_bn, ps.name) from public.positions ps where ps.id = e.position_id),
      'department', (select coalesce(d.name_bn, d.name) from public.departments d where d.id = e.department_id),
      'hub_id', e.hub_id, 'hub', private.hub_name(e.hub_id), 'zone_id', e.zone_id, 'zone', (select z.name from public.zones z where z.id = e.zone_id),
      'manager', (select m.full_name from public.employees m where m.id = e.reporting_manager_id),
      'has_login', e.profile_id is not null,
      'focus', (select jsonb_build_object('code', o ->> 'code', 'label', coalesce(o ->> 'label_bn', o ->> 'label'), 'color', o ->> 'color')
                  from public.positions ps, jsonb_array_elements(ps.focus_options) o where ps.id = e.position_id and o ->> 'code' = e.work_focus)),
    -- the assignment now and before: the new hub's duty counts from its effective date, what was done earlier keeps its own hub and day
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('type', a.change_type, 'from', a.effective_from, 'to', a.effective_to,
          'position', (select coalesce(ps.name_bn, ps.name) from public.positions ps where ps.id = a.position_id), 'hub', private.hub_name(a.hub_id),
          'zone', (select z.name from public.zones z where z.id = a.zone_id), 'reason', a.reason) order by a.effective_from desc, a.created_at desc)
        from public.employee_assignments a where a.employee_id = p_employee), '[]'::jsonb),
    -- duties: the person's own and the post's (for the person's focus too)
    'duties', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'details', d.details, 'frequency', d.frequency,
          'source', case when d.employee_id is not null then 'person' else 'post' end) order by d.sort, d.title)
        from public.job_duties d where d.archived_at is null and (d.employee_id = e.id or (d.position_id = e.position_id and (d.focus is null or d.focus = e.work_focus)))), '[]'::jsonb),
    'attendance', v_att,
    'leave', case when v_self or private.employee_has_permission('hr.leave.view', p_employee) then coalesce((select jsonb_agg(jsonb_build_object('ref', 'LR-' || upper(left(l.id::text, 8)), 'from', l.from_date, 'to', l.to_date,
          'days', l.days, 'status', l.status, 'applied_on', (l.created_at at time zone 'Asia/Dhaka')::date) order by l.from_date desc)
        from public.leave_requests l where l.employee_id = p_employee and l.to_date >= v_from and l.from_date <= v_to), '[]'::jsonb) end,
    'routes', coalesce((select jsonb_agg(jsonb_build_object('route_id', r.id, 'code', r.code, 'name', r.name, 'hub', private.hub_name(r.hub_id), 'from', rr.effective_from, 'to', rr.effective_to) order by r.code)
        from public.rider_routes rr join public.hub_routes r on r.id = rr.route_id
       where rr.employee_id = p_employee and (rr.effective_to is null or rr.effective_to >= private.wf_today()) and r.archived_at is null
         and (v_self or private.has_permission('hr.employee.view', r.zone_id, r.hub_id))), '[]'::jsonb),
    'backup', coalesce((select sl.helper from public.route_staff_load sl where sl.employee_id = p_employee), false),
    'modules', v_mods, 'events', v_events,
    'connected', jsonb_build_array('morning', 'attendance', 'route', 'daily_ops', 'hub_ops', 'sorting'));
end $$;

revoke all on function private.staff_work_record(uuid, uuid, uuid, date, text, text, uuid, integer, text, text, jsonb, text, timestamptz), private.swe_backfill(integer),
  private.swe_hubops_row(public.hub_ops_staff) from public, anon, authenticated;
revoke all on function public.staff_profile_people(uuid), public.staff_profile_get(uuid, date, date) from public, anon;
grant execute on function public.staff_profile_people(uuid), public.staff_profile_get(uuid, date, date) to authenticated;$mig$);
