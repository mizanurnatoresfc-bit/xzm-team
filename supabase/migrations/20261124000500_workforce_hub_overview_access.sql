-- Match the hub route: attendance and daily reports each use their own scoped grant.
create or replace function public.wf_hub_overview(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, private.wf_today()); h public.hubs; v_can jsonb; v_attendance boolean; v_ops boolean;
  v_att jsonb; v_total integer; v_people jsonb; v_pend jsonb; v_opsj jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  select * into h from public.hubs x where x.id = p_hub;
  v_can := private.wf_can(h.id);
  v_attendance := coalesce((v_can ->> 'attendance')::boolean, false);
  v_ops := coalesce((v_can ->> 'ops')::boolean, false);
  if not (v_attendance or v_ops) then
    raise exception 'You may not see this hub — এই হাবের তথ্য দেখার অনুমতি নেই' using errcode = '42501';
  end if;

  -- Attendance records can affect who appears in the attendance roster.
  -- A daily-report viewer gets the active roster and submission status only.
  with g as (
    select employee_id, record_status, state, kind, mark_status
    from private.wf_grid(v_date, v_date, p_hub) where v_attendance
    union all
    select e.id, null, null, null, null
    from public.employees e
    where not v_attendance and e.hub_id = p_hub and e.archived_at is null and e.status = 'active'
  ),
  p as (
    select g.*, e.employee_code::text as code, e.full_name, case when v_attendance then e.mobile end as mobile,
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
           'ops_submitted', case when v_ops then exists (select 1 from public.wf_daily_ops o where o.employee_id = p.employee_id and o.hub_id = p_hub and o.work_date = v_date) end)
           order by p.full_name), '[]'::jsonb)
    into v_att, v_total, v_people from p;
  if v_attendance then
    v_pend := jsonb_build_object(
      'marks', (select count(*) from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
                 where m.status = 'waiting' and e.hub_id = p_hub and e.archived_at is null and e.profile_id is distinct from auth.uid()),
      'applications', (select count(*) from public.wf_absence_applications a join public.employees e on e.id = a.employee_id
                 where a.status = 'pending' and e.hub_id = p_hub and e.archived_at is null and e.profile_id is distinct from auth.uid()));
  else
    v_pend := jsonb_build_object('marks', 0, 'applications', 0);
  end if;
  if v_ops then
    select jsonb_build_object('submitted', count(*), 'missing', (select count(*) from private.wf_ops_missing(v_date, array[p_hub])),
             'pickup', coalesce(sum(o.pickup), 0), 'pickup_return', coalesce(sum(o.pickup_return), 0),
             'delivery', coalesce(sum(o.delivery), 0), 'delivery_return', coalesce(sum(o.delivery_return), 0))
      into v_opsj from public.wf_daily_ops o where o.hub_id = p_hub and o.work_date = v_date;
  end if;
  return jsonb_build_object('hub', private.wf_hub_json(h.id), 'date', v_date, 'can', v_can, 'staff_total', v_total,
                            'attendance', v_att, 'pending', v_pend, 'ops', v_opsj, 'people', v_people);
end $$;
