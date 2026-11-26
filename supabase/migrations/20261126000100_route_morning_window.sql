-- Route-planning attendance is editable only during its daily Dhaka window.
alter table public.wf_att_policy add column morning_open time;

-- Keep existing zone deadlines. Legacy deadlines before 07:00 get an earlier opening.
create function private.wf_morning_opens(p_zone uuid, p_date date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (p_date + p.morning_open) at time zone 'Asia/Dhaka'
       from public.wf_att_policy p where p.zone_id = p_zone),
    least((p_date + time '07:00') at time zone 'Asia/Dhaka',
          greatest(p_date::timestamp at time zone 'Asia/Dhaka',
                   private.wf_morning_due(p_zone, p_date) - interval '1 hour')))
$$;

create function private.wf_morning_window_open(p_zone uuid, p_date date, p_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_date = (p_at at time zone 'Asia/Dhaka')::date
     and p_at >= private.wf_morning_opens(p_zone, p_date)
     and p_at < private.wf_morning_due(p_zone, p_date)
$$;

revoke all on function private.wf_morning_opens(uuid, date),
  private.wf_morning_window_open(uuid, date, timestamptz) from public, anon, authenticated;

create or replace function public.wf_att_policy_get(p_zone uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not (private.has_permission('hr.attendance.configure', p_zone, null) or private.has_permission('hr.attendance.view', p_zone, null)
          or private.has_permission_within_zone('hr.attendance.view', p_zone)) then
    raise exception 'Not authorised to see the times of this zone.' using errcode = '42501';
  end if;
  return jsonb_build_object('zone_id', p_zone,
    'morning_open', to_char(private.wf_morning_opens(p_zone, private.wf_today()) at time zone 'Asia/Dhaka', 'HH24:MI'),
    'morning_cutoff', to_char(coalesce(p.morning_cutoff, nullif(private.wf_setting_text('workforce.morning_cutoff', '08:00'), '')::time, time '08:00'), 'HH24:MI'),
    'morning_extra', coalesce(p.morning_extra, private.wf_int('workforce.morning_extra_min', 15, 0, 360)),
    'day_time', to_char(coalesce(p.day_time, nullif(private.wf_setting_text('workforce.day_close_time', '00:00'), '')::time, time '00:00'), 'HH24:MI'),
    'day_extra', coalesce(p.day_extra, private.wf_int('workforce.day_close_extra_min', 0, 0, 360)),
    'own', p.zone_id is not null, 'today_due', private.wf_morning_due(p_zone, private.wf_today()),
    'can_edit', private.has_permission('hr.attendance.configure', p_zone, null))
  from (select 1) one left join public.wf_att_policy p on p.zone_id = p_zone;
end $$;

create or replace function public.wf_att_policy_save(p_zone uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.wf_att_policy; v_open time; v_cut time; v_extra integer; v_day time; v_dextra integer; k text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.zones where id = p_zone and archived_at is null) then raise exception 'Zone not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', p_zone, null) then raise exception 'Not authorised to set the times of this zone.' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The times must be an object.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('morning_open', 'morning_cutoff', 'morning_extra', 'day_time', 'day_extra') then raise exception 'Unknown time setting: %.', k using errcode = '22023'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('wf_att_policy:' || p_zone::text, 0));
  select * into v from public.wf_att_policy where zone_id = p_zone;
  begin
    v_open := coalesce(nullif(p ->> 'morning_open', '')::time, v.morning_open);
    v_cut := coalesce(nullif(p ->> 'morning_cutoff', '')::time, v.morning_cutoff, nullif(private.wf_setting_text('workforce.morning_cutoff', '08:00'), '')::time, time '08:00');
    v_day := coalesce(nullif(p ->> 'day_time', '')::time, v.day_time, nullif(private.wf_setting_text('workforce.day_close_time', '00:00'), '')::time, time '00:00');
    v_extra := coalesce(nullif(p ->> 'morning_extra', '')::integer, v.morning_extra, private.wf_int('workforce.morning_extra_min', 15, 0, 360));
    v_dextra := coalesce(nullif(p ->> 'day_extra', '')::integer, v.day_extra, private.wf_int('workforce.day_close_extra_min', 0, 0, 360));
  exception when others then raise exception 'A time or a number of minutes is written wrongly.' using errcode = '22023'; end;
  if v_extra not between 0 and 360 or v_dextra not between 0 and 360 then raise exception 'The extra minutes are 0 to 360.' using errcode = '22023'; end if;
  if v_cut + make_interval(mins => v_extra) > time '23:59:59' or v_cut + make_interval(mins => v_extra) < v_cut then
    raise exception 'The morning cut-off and its extra minutes must end on the same day.' using errcode = '22023';
  end if;
  if v_open >= v_cut + make_interval(mins => v_extra) then
    raise exception 'Opening must be before closing — শুরুর সময় বন্ধের সময়ের আগে দিন।' using errcode = '22023';
  end if;
  insert into public.wf_att_policy (zone_id, morning_open, morning_cutoff, morning_extra, day_time, day_extra) values (p_zone, v_open, v_cut, v_extra, v_day, v_dextra)
  on conflict (zone_id) do update set morning_open = excluded.morning_open, morning_cutoff = excluded.morning_cutoff, morning_extra = excluded.morning_extra,
    day_time = excluded.day_time, day_extra = excluded.day_extra;
  return public.wf_att_policy_get(p_zone);
end $$;

create or replace function public.wf_morning_get(p_hub uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_cur public.wf_morning_subs; v_sub public.wf_morning_subs; v_fill boolean; v_review boolean; v_show boolean;
  v_people jsonb := null; v_back public.wf_morning_subs;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null and status = 'active';
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  v_fill := private.has_permission('hr.attendance.create', v_zone, p_hub);
  v_review := private.has_permission('ops.route_plan.approve', v_zone, p_hub);
  if not (v_fill or v_review) then raise exception 'Not authorised to open the morning input of this hub.' using errcode = '42501'; end if;
  select * into v_cur from public.wf_morning_subs where hub_id = p_hub and work_date = v_date order by revision desc limit 1;
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'submitted';
  select * into v_back from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'returned' order by revision desc limit 1;
  -- the form: only while open and only to who fills it. The lines of a submission: only to the zone.
  v_show := (v_cur.id is null or v_cur.status = 'open') and v_fill and private.wf_morning_window_open(v_zone, v_date, clock_timestamp());
  if v_show or (v_review and v_sub.id is not null) then
    v_people := coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'code', q.code, 'name', q.name, 'post', q.post,
        'state', case when lv.j is not null then 'leave' else coalesce(l.state, 'unknown') end,
        'leave', lv.j) order by q.name)
      from private.wf_morning_people(p_hub) q
      left join public.wf_morning_lines l on l.employee_id = q.id and l.sub_id = coalesce(v_sub.id, v_cur.id)
      left join lateral (select private.wf_leave_on(q.id, v_date) as j) lv on true), '[]'::jsonb);
  end if;
  return jsonb_build_object('hub', (select jsonb_build_object('id', h.id, 'name', h.name, 'zone_id', h.zone_id) from public.hubs h where h.id = p_hub),
    'date', v_date, 'today', private.wf_today(), 'now', clock_timestamp(), 'opens_at', private.wf_morning_opens(v_zone, v_date), 'due', private.wf_morning_due(v_zone, v_date),
    'status', case when v_sub.id is not null then 'submitted' else 'open' end,
    'revision', coalesce(v_sub.revision, v_cur.revision, 1),
    'can', jsonb_build_object('fill', v_show, 'review', v_review),
    'receipt', case when v_sub.id is not null then jsonb_build_object('revision', v_sub.revision, 'mode', v_sub.submit_mode, 'submitted_at', v_sub.submitted_at,
        'submitted_by_name', (select coalesce(pr.full_name, 'user') from public.profiles pr where pr.id = v_sub.submitted_by)) end,
    'returned', case when v_back.id is not null and v_sub.id is null then jsonb_build_object('reason', v_back.return_reason, 'at', v_back.returned_at) end,
    'hold', (select jsonb_build_object('held_at', k.held_at, 'reason', k.reason, 'gap_count', k.gap_count, 'total', k.total, 'gaps', k.gaps)
               from public.wf_auto_holds k where k.kind = 'morning' and k.hub_id = p_hub and k.work_date = v_date and k.resolved_at is null),
    'people', v_people);
end $$;

create or replace function public.wf_morning_save(p_hub uuid, p_date date, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_sub public.wf_morning_subs; x jsonb; v_emp uuid; v_state text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null and status = 'active';
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.create', v_zone, p_hub) then raise exception 'Not authorised to fill the morning input of this hub.' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'The lines must be a list.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || p_hub::text || v_date::text, 0));
  if not private.wf_morning_window_open(v_zone, v_date, clock_timestamp()) then
    raise exception 'The morning window is closed — সকালের রুট হাজিরার সময় শেষ বা এখনো শুরু হয়নি।' using errcode = '22023';
  end if;
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'open' for update;
  if v_sub.id is null then
    if exists (select 1 from public.wf_morning_subs where hub_id = p_hub and work_date = v_date) then raise exception 'The morning input is locked.' using errcode = '22023'; end if;
    insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status) values (p_hub, v_zone, v_date, 1, 'open') returning * into v_sub;
  end if;
  for x in select e from jsonb_array_elements(p_lines) e loop
    begin v_emp := (x ->> 'employee_id')::uuid; exception when others then raise exception 'A person is written wrongly.' using errcode = '22023'; end;
    v_state := x ->> 'state';
    if v_state is null or v_state not in ('present', 'absent', 'unknown') then raise exception 'A person is present, absent or unchecked.' using errcode = '22023'; end if;
    if not exists (select 1 from private.wf_morning_people(p_hub) q where q.id = v_emp) then raise exception 'A person does not work at this hub.' using errcode = '22023'; end if;
    insert into public.wf_morning_lines (sub_id, employee_id, state) values (v_sub.id, v_emp, v_state)
    on conflict (sub_id, employee_id) do update set state = excluded.state where wf_morning_lines.state is distinct from excluded.state;
  end loop;
end $$;

create or replace function public.wf_morning_submit(p_hub uuid, p_date date, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_id uuid; v_sub public.wf_morning_subs;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null and status = 'active';
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.create', v_zone, p_hub) then raise exception 'Not authorised to submit the morning input of this hub.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || p_hub::text || v_date::text, 0));
  select * into v_sub from public.wf_morning_subs
   where hub_id = p_hub and work_date = v_date and status = 'submitted';
  if v_sub.id is not null then
    return jsonb_build_object('revision', v_sub.revision, 'mode', v_sub.submit_mode, 'submitted_at', v_sub.submitted_at, 'already', true);
  end if;
  if not private.wf_morning_window_open(v_zone, v_date, clock_timestamp()) then
    raise exception 'The morning window is closed — সকালের রুট হাজিরার সময় শেষ বা এখনো শুরু হয়নি।' using errcode = '22023';
  end if;
  v_id := private.wf_morning_close(p_hub, v_date, p_lines, 'manager', auth.uid());
  select * into v_sub from public.wf_morning_subs where id = v_id;
  return jsonb_build_object('revision', v_sub.revision, 'mode', v_sub.submit_mode, 'submitted_at', v_sub.submitted_at, 'already', false);
end $$;

create or replace function public.wf_morning_zone(p_zone uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_date date;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  return jsonb_build_object('date', v_date, 'today', private.wf_today(), 'now', now(), 'hubs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id, 'name', h.name, 'zone_id', h.zone_id, 'zone_name', z.name,
      'staff', (select count(*) from private.wf_morning_people(h.id)),
      'due', private.wf_morning_due(h.zone_id, v_date),
      'window_open', private.wf_morning_window_open(h.zone_id, v_date, now()),
      'state', case when s.id is not null then 'submitted' when o.id is not null then 'open' else 'none' end,
      'held', exists (select 1 from public.wf_auto_holds k where k.kind = 'morning' and k.hub_id = h.id and k.work_date = v_date and k.resolved_at is null),
      'hold', (select jsonb_build_object('reason', k.reason, 'gap_count', k.gap_count, 'total', k.total, 'gaps', k.gaps) from public.wf_auto_holds k
                where k.kind = 'morning' and k.hub_id = h.id and k.work_date = v_date and k.resolved_at is null),
      'sub_id', s.id, 'revision', coalesce(s.revision, o.revision), 'mode', s.submit_mode, 'submitted_at', s.submitted_at,
      'returned', (select jsonb_build_object('reason', b.return_reason, 'at', b.returned_at) from public.wf_morning_subs b
                    where b.hub_id = h.id and b.work_date = v_date and b.status = 'returned' and s.id is null order by b.revision desc limit 1),
      'present', (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'present'),
      'absent',  (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'absent'),
      'leave',   (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'leave'),
      'unknown', (select count(*) from public.wf_morning_lines l where l.sub_id = s.id and l.state = 'unknown'),
      'people', case when s.id is not null then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name, 'code', e.employee_code, 'state', l.state, 'leave_ref', l.leave_ref) order by e.full_name)
                          from public.wf_morning_lines l join public.employees e on e.id = l.employee_id where l.sub_id = s.id), '[]'::jsonb) end,
      -- a route is "to cover" when it has no rider who is here (a route nobody rides counts too)
      'cover', case when s.id is not null then coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name,
                    'regular', coalesce((select jsonb_agg(e.full_name order by e.full_name) from public.rider_routes rr join public.employees e on e.id = rr.employee_id
                                          where rr.route_id = r.id and rr.effective_from <= v_date and (rr.effective_to is null or rr.effective_to >= v_date)), '[]'::jsonb)) order by r.code)
                  from public.hub_routes r where r.hub_id = h.id and r.archived_at is null and r.status = 'active'
                   and not exists (select 1 from public.rider_routes rr join public.wf_morning_lines l on l.employee_id = rr.employee_id and l.sub_id = s.id
                                    where rr.route_id = r.id and rr.effective_from <= v_date and (rr.effective_to is null or rr.effective_to >= v_date) and l.state = 'present')), '[]'::jsonb) end,
      'plan', (select jsonb_build_object('id', p.id, 'status', p.status, 'published_version', p.published_version) from public.route_day_plans p
                where p.hub_id = h.id and p.plan_date = v_date and p.archived_at is null)
    ) order by z.name, h.name)
    from public.hubs h join public.zones z on z.id = h.zone_id
    left join public.wf_morning_subs s on s.hub_id = h.id and s.work_date = v_date and s.status = 'submitted'
    left join public.wf_morning_subs o on o.hub_id = h.id and o.work_date = v_date and o.status = 'open'
    where h.archived_at is null and h.status = 'active' and (p_zone is null or h.zone_id = p_zone)
      and private.has_permission('ops.route_plan.approve', h.zone_id, h.id)), '[]'::jsonb));
end $$;

create or replace function public.wf_morning_return(p_hub uuid, p_date date, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_zone uuid; v_sub public.wf_morning_subs; v_new uuid; v_reason text := trim(coalesce(p_reason, '')); m uuid; p record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  v_date := private.wf_morning_date(p_date);
  select zone_id into v_zone from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('ops.route_plan.approve', v_zone, p_hub) then raise exception 'Not authorised to send the morning input back.' using errcode = '42501'; end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'Write why the morning input goes back.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || p_hub::text || v_date::text, 0));
  if not private.wf_morning_window_open(v_zone, v_date, clock_timestamp()) then
    raise exception 'The morning window is closed — সকালের রুট হাজিরার সময় শেষ বা এখনো শুরু হয়নি।' using errcode = '22023';
  end if;
  select * into v_sub from public.wf_morning_subs where hub_id = p_hub and work_date = v_date and status = 'submitted' for update;
  if v_sub.id is null then raise exception 'There is no submitted morning input to send back.' using errcode = '22023'; end if;
  update public.wf_morning_subs set status = 'returned', returned_by = auth.uid(), returned_at = now(), return_reason = v_reason where id = v_sub.id;
  insert into public.wf_morning_subs (hub_id, zone_id, work_date, revision, status) values (p_hub, v_zone, v_date, v_sub.revision + 1, 'open') returning id into v_new;
  insert into public.wf_morning_lines (sub_id, employee_id, state, leave_ref)
    select v_new, l.employee_id, l.state, l.leave_ref from public.wf_morning_lines l where l.sub_id = v_sub.id;
  -- plans that are not approved yet must be checked again (the approved version stays in force until a new one is published)
  for p in select pl.id from public.route_day_plans pl where pl.hub_id = p_hub and pl.plan_date = v_date and pl.archived_at is null loop
    insert into public.route_plan_events (plan_id, hub_id, plan_date, kind, note, actor, actor_name)
    values (p.id, p_hub, v_date, 'morning_returned', v_reason, auth.uid(), (select coalesce(pr.full_name, 'user') from public.profiles pr where pr.id = auth.uid()));
  end loop;
  for m in select * from private.wf_role_hub_managers(p_hub) loop
    perform private.notify(m, 'সকালের জনবল ফেরত এসেছে', v_reason, '/app?morningHub=' || p_hub::text, 'wf_morning');
  end loop;
  return v_sub.revision + 1;
end $$;

create or replace function private.wf_hold_set(p_kind text, p_hub uuid, p_date date, p_reason text, p_total integer, p_gap_count integer, p_gaps jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare h public.wf_auto_holds; v_zone uuid := private.hub_zone(p_hub); v_new boolean; m uuid; v_names text; v_body text; v_link text; v_title text;
begin
  select * into h from public.wf_auto_holds where kind = p_kind and hub_id = p_hub and work_date = p_date for update;
  v_new := h.id is null or h.resolved_at is not null;
  insert into public.wf_auto_holds (kind, hub_id, zone_id, work_date, reason, gap_count, total, gaps)
  values (p_kind, p_hub, v_zone, p_date, p_reason, p_gap_count, p_total, coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(p_gaps) x limit 12) q), '[]'::jsonb))
  on conflict (kind, hub_id, work_date) do update set reason = excluded.reason, gap_count = excluded.gap_count, total = excluded.total, gaps = excluded.gaps,
    held_at = case when public.wf_auto_holds.resolved_at is not null then now() else public.wf_auto_holds.held_at end, resolved_at = null;
  if v_new then
    select string_agg(x ->> 'name', ', ') into v_names from (select x from jsonb_array_elements(p_gaps) x limit 5) q;
    v_title := case p_kind when 'morning' then 'সকালের জনবল জমা আটকে আছে' else 'দৈনিক হাজিরা খাতা জমা আটকে আছে' end;
    v_body := coalesce(private.hub_name(p_hub), '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || ' — '
      || case when p_reason = 'empty' then 'কিছুই লেখা হয়নি' else p_gap_count || ' জনের হাজিরা অসম্পূর্ণ' || coalesce(' (' || v_names || ')', '') end
      || case p_kind when 'morning' then '। সময় শেষ হয়েছে।'
           else '। অসম্পূর্ণ হাজিরা সার্ভার জমা দেয় না — হাব ম্যানেজার পূরণ করে জমা দিন।' end;
    if p_kind = 'morning' then
      for m in select * from private.wf_role_zone_managers(v_zone) loop
        perform private.notify(m, v_title, v_body, '/app/routes?tab=morning&zone=' || v_zone::text, 'wf_morning');
      end loop;
      for m in select * from private.wf_role_hub_managers(p_hub)
        except select * from private.wf_role_zone_managers(v_zone) loop
        perform private.notify(m, v_title, v_body, '/app?morningHub=' || p_hub::text, 'wf_morning');
      end loop;
    else
      v_link := '/app/attendance?view=hub&tab=final&hub=' || p_hub::text || '&date=' || p_date::text;
      for m in select * from private.wf_role_hub_managers(p_hub) union select * from private.wf_role_zone_managers(v_zone) loop
        perform private.notify(m, v_title, v_body, v_link, 'attendance_gap');
      end loop;
    end if;
  end if;
  return v_new;
end $$;

create or replace function private.wf_morning_autosubmit() returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; d date; v_id uuid; v_n integer := 0; v_left integer; m uuid; v_need integer; v_done integer; v_names jsonb;
begin
  for h in select hb.id, hb.zone_id from public.hubs hb where hb.archived_at is null and hb.status = 'active'
            and exists (select 1 from private.wf_morning_people(hb.id)) loop
    for d in select g::date from generate_series(private.wf_today() - 2, private.wf_today(), interval '1 day') g loop
      continue when d < private.wf_auto_from();
      continue when now() < private.wf_morning_due(h.zone_id, d);
      -- an empty or unfinished morning input is not submitted: every person who is not on approved leave must be marked came or did not come
      perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || h.id::text || d::text, 0));
      continue when clock_timestamp() < private.wf_morning_due(h.zone_id, d);
      continue when exists (select 1 from public.wf_morning_subs s where s.hub_id = h.id and s.work_date = d and s.status = 'submitted');
      select count(*), count(*) filter (where t.st in ('present', 'absent')),
             coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'why', 'অবস্থা বসানো হয়নি') order by t.name) filter (where t.st not in ('present', 'absent')), '[]'::jsonb)
        into v_need, v_done, v_names
        from (select q.name, coalesce((select l.state from public.wf_morning_lines l join public.wf_morning_subs s on s.id = l.sub_id
                                         where s.hub_id = h.id and s.work_date = d and s.status = 'open' and l.employee_id = q.id), 'unknown') as st
                from private.wf_morning_people(h.id) q where private.wf_leave_on(q.id, d) is null) t;
      if v_need > v_done then
        perform private.wf_hold_set('morning', h.id, d, case when v_done = 0 then 'empty' else 'incomplete' end, v_need, v_need - v_done, v_names);
        continue;
      end if;
      v_id := private.wf_morning_close(h.id, d, null, 'auto', null);
      if v_id is not null then
        v_n := v_n + 1;
        continue when exists (select 1 from public.wf_morning_subs s where s.hub_id = h.id and s.work_date = d and s.status = 'submitted');
      select count(*) into v_left from public.wf_morning_lines where sub_id = v_id and state = 'unknown';
        for m in select * from private.wf_role_hub_managers(h.id) loop
          perform private.notify(m, 'সকালের জনবল নিজে জমা হয়েছে',
            case when v_left > 0 then v_left || ' জনের হাজিরা যাচাই বাকি আছে' else 'সবার অবস্থা বসানো ছিল' end, '/app?morningHub=' || h.id::text, 'wf_morning');
        end loop;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;
