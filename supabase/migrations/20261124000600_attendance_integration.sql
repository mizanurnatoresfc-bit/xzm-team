begin;

create table private.attendance_cutoff_alerts (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  form_kind text not null check (form_kind in ('morning', 'daily')),
  created_at timestamptz not null default now(),
  primary key (hub_id, work_date, form_kind)
);
alter table private.attendance_cutoff_alerts enable row level security;
revoke all on private.attendance_cutoff_alerts from public, anon, authenticated, service_role;

create function private.attendance_cutoff_alert(p_hub uuid, p_zone uuid, p_date date, p_kind text)
returns void language plpgsql set search_path = '' as $$
declare r record; title text; hub_tab text;
begin
  insert into private.attendance_cutoff_alerts (hub_id, work_date, form_kind)
  values (p_hub, p_date, p_kind) on conflict do nothing;
  if not found then return; end if;

  title := case p_kind when 'morning' then 'সকালের জনবল জমা হয়নি' else 'দৈনিক হাজিরা খাতা জমা হয়নি' end;
  hub_tab := case p_kind when 'morning' then 'morning' else 'final' end;
  for r in
    select ids.profile_id, bool_or(ids.is_zone) as is_zone
    from (
      select x as profile_id, false as is_zone from private.wf_hub_managers(p_hub) x
      union all
      select x as profile_id, true as is_zone from private.wf_zone_managers(p_zone) x
    ) ids join public.profiles p on p.id = ids.profile_id and p.status = 'active' and p.archived_at is null
    group by ids.profile_id
  loop
    perform private.notify(r.profile_id, title,
      coalesce(private.hub_name(p_hub), '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') ||
      '। সময় শেষ হয়েছে। খালি বা অসম্পূর্ণ তথ্য পূরণ করে জমা দিন।',
      case when r.is_zone then '/app/attendance?view=zone&tab=' || hub_tab || '&zone=' || p_zone || '&date=' || p_date
        else '/app/attendance?view=hub&tab=' || hub_tab || '&hub=' || p_hub || '&date=' || p_date end,
      'attendance_cutoff');
  end loop;
end $$;
revoke all on function private.attendance_cutoff_alert(uuid, uuid, date, text) from public, anon, authenticated, service_role;

create or replace function private.wf_morning_autosubmit() returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; v_id uuid; v_n integer := 0;
begin
  for h in
    select hb.id, hb.zone_id, days.work_date
    from public.hubs hb
    cross join lateral (
      select private.wf_today() as work_date
      union
      select s.work_date from public.wf_morning_subs s
      where s.hub_id = hb.id and s.status = 'open' and s.revision = 1
        and s.work_date between private.wf_today() - 2 and private.wf_today() - 1
    ) days
    where hb.archived_at is null and hb.status = 'active'
      and now() >= private.wf_morning_due(hb.zone_id, days.work_date)
      and exists (select 1 from private.wf_morning_people(hb.id))
      and not exists (select 1 from public.wf_morning_subs s
        where s.hub_id = hb.id and s.work_date = days.work_date and (s.revision > 1 or s.status <> 'open'))
    order by hb.id, days.work_date
  loop
    perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || h.id::text || h.work_date::text, 0));
    if exists (select 1 from public.wf_morning_subs s
      where s.hub_id = h.id and s.work_date = h.work_date and (s.revision > 1 or s.status <> 'open')) then
      continue;
    end if;
    if not exists (select 1 from public.wf_morning_subs s where s.hub_id = h.id and s.work_date = h.work_date)
      or exists (
        select 1 from private.wf_morning_people(h.id) e
        where private.wf_leave_on(e.id, h.work_date) is null and not exists (
          select 1 from public.wf_morning_subs s join public.wf_morning_lines l on l.sub_id = s.id
          where s.hub_id = h.id and s.work_date = h.work_date and s.status = 'open'
            and l.employee_id = e.id and l.state in ('present', 'absent')
        )
      )
    then
      perform private.attendance_cutoff_alert(h.id, h.zone_id, h.work_date, 'morning');
      continue;
    end if;
    v_id := private.wf_morning_close(h.id, h.work_date, null, 'auto', null);
    if v_id is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

create or replace function public.route_plan_decide(p_plan uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.route_day_plans; v_name text; v_sub public.wf_morning_subs; l record; v_state text; v_ver uuid; v_no integer; v_prev public.route_plan_versions;
  m uuid; v_emp public.employees;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.route_day_plans where id = p_plan and archived_at is null;
  if v.id is null or not private.has_permission('ops.route_plan.approve', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to decide this plan.' using errcode = '42501';
  end if;
  -- Morning return writes events referencing the plan, so take the morning lock before the plan lock.
  if p_ok then
    perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || v.hub_id::text || v.plan_date::text, 0));
  end if;
  select * into v from public.route_day_plans where id = p_plan and archived_at is null for update;
  if v.id is null or not private.has_permission('ops.route_plan.approve', v.zone_id, v.hub_id) then
    raise exception 'Not authorised to decide this plan.' using errcode = '42501';
  end if;
  if v.status = 'approved' then raise exception 'This plan is already approved.' using errcode = '22023'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'The note is too long (500 letters at most).' using errcode = '22023'; end if;
  select coalesce(pr.full_name, 'user') into v_name from public.profiles pr where pr.id = auth.uid();
  if p_ok then
    if not exists (select 1 from public.route_day_riders x where x.plan_id = v.id and x.removed_at is null and (x.parcels > 0 or x.pickups > 0)) then
      raise exception 'Nobody has parcels on this plan yet.' using errcode = '22023';
    end if;
    -- today's plan stands on today's latest submitted morning input, and each person on it must still be available
    select * into v_sub from public.wf_morning_subs where hub_id = v.hub_id and work_date = v.plan_date and status = 'submitted';
    if v.plan_date = current_date then
      if v_sub.id is null then raise exception 'The morning input of this hub is not submitted yet.' using errcode = '22023'; end if;
      for l in select x.employee_id, e.full_name from public.route_day_riders x join public.employees e on e.id = x.employee_id
                where x.plan_id = v.id and x.removed_at is null and (x.parcels > 0 or x.pickups > 0) loop
        v_state := private.route_presence(l.employee_id, v.plan_date) ->> 'state';
        if private.wf_leave_on(l.employee_id, v.plan_date) is not null or v_state is distinct from 'present' then
          raise exception '% is not available today. Change the rider and approve again.', l.full_name using errcode = '22023';
        end if;
      end loop;
    end if;
    update public.route_day_plans set status = 'approved', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = nullif(trim(p_note), ''), morning_sub_id = v_sub.id, morning_revision = v_sub.revision, published_version = published_version + 1
     where id = v.id returning published_version into v_no;
    select * into v_prev from public.route_plan_versions where plan_id = v.id and superseded_at is null order by version_no desc limit 1;
    insert into public.route_plan_versions (plan_id, hub_id, zone_id, plan_date, version_no, morning_sub_id, morning_revision, snapshot, published_by, published_by_name)
      select v.id, v.hub_id, v.zone_id, v.plan_date, v_no, v_sub.id, v_sub.revision, private.route_plan_json(v.id), auth.uid(), v_name returning id into v_ver;
    update public.route_plan_versions set superseded_at = now() where plan_id = v.id and id <> v_ver and superseded_at is null;
    -- recipients: the hub's managers and everybody who has parcels or pickups
    for m in select * from private.wf_hub_managers(v.hub_id) loop
      insert into public.route_plan_recipients (version_id, plan_id, hub_id, plan_date, role, profile_id) values (v_ver, v.id, v.hub_id, v.plan_date, 'manager', m);
    end loop;
    for l in select x.* from public.route_day_riders x where x.plan_id = v.id and x.removed_at is null and (x.parcels > 0 or x.pickups > 0) loop
      select * into v_emp from public.employees e where e.id = l.employee_id;
      insert into public.route_plan_recipients (version_id, plan_id, hub_id, plan_date, role, profile_id, employee_id, parcels, pickups, detail, note)
      values (v_ver, v.id, v.hub_id, v.plan_date, case when l.kind = 'helper' then 'helper' else 'rider' end, v_emp.profile_id, l.employee_id, l.parcels, l.pickups, l.detail, l.note);
    end loop;
    -- a person of the old version who has nothing now: the old assignment is cancelled and the person is told
    if v_prev.id is not null then
      for l in select r.id, r.profile_id, r.employee_id from public.route_plan_recipients r
                where r.version_id = v_prev.id and r.role <> 'manager' and r.status = 'active'
                  and not exists (select 1 from public.route_plan_recipients n where n.version_id = v_ver and n.employee_id = r.employee_id) loop
        update public.route_plan_recipients set status = 'cancelled', cancelled_at = now(), cancelled_in_version = v_no where id = l.id;
        perform private.notify(l.profile_id, 'রুট বরাদ্দ বাতিল', 'আজকের রুট প্ল্যান বদলেছে। এই বরাদ্দ আর কার্যকর নয়।', '/app/staff', 'route_plan');
        insert into public.route_plan_events (plan_id, hub_id, plan_date, version_no, kind, note, actor, actor_name)
        values (v.id, v.hub_id, v.plan_date, v_no, 'cancelled', (select e.full_name from public.employees e where e.id = l.employee_id), auth.uid(), v_name);
      end loop;
      update public.route_plan_recipients set status = 'cancelled', cancelled_at = now(), cancelled_in_version = v_no
       where version_id = v_prev.id and role = 'manager' and status = 'active';
    end if;
    insert into public.route_plan_events (plan_id, hub_id, plan_date, version_no, kind, actor, actor_name) values (v.id, v.hub_id, v.plan_date, v_no, 'published', auth.uid(), v_name);
    perform private.route_plan_notify(v_ver, 'published');
  else
    if v.status <> 'sent' then raise exception 'Only a sent plan can be sent back.' using errcode = '22023'; end if;
    if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Write why the plan goes back.' using errcode = '22023'; end if;
    update public.route_day_plans set status = 'draft', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
      decide_note = trim(p_note) where id = v.id;
  end if;
end $$;

alter table public.wf_att_policy add column day_auto_since date;

create or replace function public.wf_att_policy_save(p_zone uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.wf_att_policy; v_cut time; v_extra integer; v_day time; v_dextra integer; k text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.zones where id = p_zone and archived_at is null) then raise exception 'Zone not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', p_zone, null) then raise exception 'Not authorised to set the times of this zone.' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The times must be an object.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('morning_cutoff', 'morning_extra', 'day_time', 'day_extra') then raise exception 'Unknown time setting: %.', k using errcode = '22023'; end if;
  end loop;
  select * into v from public.wf_att_policy where zone_id = p_zone;
  begin
    v_cut := coalesce(nullif(p ->> 'morning_cutoff', '')::time, v.morning_cutoff, time '08:00');
    v_day := coalesce(nullif(p ->> 'day_time', '')::time, v.day_time, time '00:00');
    v_extra := coalesce(nullif(p ->> 'morning_extra', '')::integer, v.morning_extra, 15);
    v_dextra := coalesce(nullif(p ->> 'day_extra', '')::integer, v.day_extra, 0);
  exception when others then raise exception 'A time or a number of minutes is written wrongly.' using errcode = '22023'; end;
  if v_day >= time '24:00' then raise exception 'Daily closing time must be before 24:00.' using errcode = '22023'; end if;
  if v_extra not between 0 and 360 or v_dextra not between 0 and 360 then raise exception 'The extra minutes are 0 to 360.' using errcode = '22023'; end if;
  if v_cut + make_interval(mins => v_extra) > time '23:59:59' or v_cut + make_interval(mins => v_extra) < v_cut then
    raise exception 'The morning cut-off and its extra minutes must end on the same day.' using errcode = '22023';
  end if;
  insert into public.wf_att_policy (zone_id, morning_cutoff, morning_extra, day_time, day_extra) values (p_zone, v_cut, v_extra, v_day, v_dextra)
  on conflict (zone_id) do update set morning_cutoff = excluded.morning_cutoff, morning_extra = excluded.morning_extra,
    day_time = excluded.day_time, day_extra = excluded.day_extra;
  if p ? 'day_time' or p ? 'day_extra' then
    update public.wf_att_policy set day_auto_since = coalesce(day_auto_since, private.wf_today())
    where zone_id = p_zone and day_auto_since is null;
  end if;
  return public.wf_att_policy_get(p_zone);
end $$;

create or replace function private.att_sheet_close(p_hub uuid, p_date date, p_by uuid, p_mode text, p_strict boolean, p_window uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.att_day_sheets; ln record; v_rec uuid; v_bad text; v_asked integer := 0; v_written integer := 0; v_reasons text[]; v_r text; v_prof uuid;
  v_hub text := private.hub_name(p_hub); v_name text; v_leave jsonb; v_no integer; v_zone uuid := private.hub_zone(p_hub); v_left integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('att_sheet:' || p_hub::text || p_date::text, 0));
  insert into public.att_day_sheets (hub_id, zone_id, work_date) values (p_hub, v_zone, p_date) on conflict (hub_id, work_date) do nothing;
  select * into s from public.att_day_sheets where hub_id = p_hub and work_date = p_date for update;
  if s.status = 'submitted' then return null; end if;

  -- everyone of the hub is on the register
  insert into public.att_day_lines (sheet_id, employee_id, position_id, updated_by)
  select s.id, pp, e.position_id, p_by from private.att_sheet_people(p_hub, p_date) pp join public.employees e on e.id = pp
  on conflict (sheet_id, employee_id) do nothing;
  -- approved leave puts itself on the line; "marked online" and its time come from the person's own mark
  for ln in select x.id, x.employee_id from public.att_day_lines x where x.sheet_id = s.id loop
    v_leave := private.wf_leave_on(ln.employee_id, p_date);
    if v_leave is not null then
      update public.att_day_lines set final_status = 'leave', late_time = null, unauthorized = false, absence_reason = null, online_marked = null, online_at = null, online_reason = null,
             absence_app_date = (v_leave ->> 'applied_on')::date, absence_app_ref = v_leave ->> 'ref', leave_ref = v_leave ->> 'ref', leave_applied_on = (v_leave ->> 'applied_on')::date
       where id = ln.id;
    end if;
  end loop;
  update public.att_day_lines l set
         online_marked = coalesce((select m.kind = 'present' from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date), false),
         online_at = (select m.marked_at from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present'),
         online_reason = case when exists (select 1 from public.attendance_self_marks m where m.employee_id = l.employee_id and m.work_date = p_date and m.kind = 'present')
                              then null else l.online_reason end
   where l.sheet_id = s.id and l.final_status in ('present', 'late', 'half_day');

  if p_strict then
    select string_agg(e.full_name || ': ' || w, '; ' order by e.full_name) into v_bad
      from (select l.employee_id, private.att_line_gap(l) w from public.att_day_lines l where l.sheet_id = s.id) z join public.employees e on e.id = z.employee_id
     where w is not null;
    if v_bad is not null and p_mode = 'auto' then
      raise exception 'Daily attendance draft requires review' using errcode = 'P2201';
    end if;
    if v_bad is not null then raise exception 'Some lines are not complete — কিছু সারি অসম্পূর্ণ: %', v_bad using errcode = '22023'; end if;
  else
    -- the server never guesses: an unfinished line is "unchecked" (or "leave request waiting")
    for ln in select l.*, private.att_line_gap(l) as gap from public.att_day_lines l where l.sheet_id = s.id loop
      continue when ln.gap is null;
      update public.att_day_lines set final_status = case when private.att_leave_state(ln.employee_id, p_date) ->> 'state' = 'pending' then 'pending_leave' else 'unchecked' end,
             late_time = null, unauthorized = false, absence_reason = null, online_marked = null, online_at = null, online_reason = null
       where id = ln.id;
    end loop;
  end if;

  perform set_config('app.wf_action', 'approved', true);
  for ln in select x.*, e.profile_id, e.full_name from public.att_day_lines x join public.employees e on e.id = x.employee_id where x.sheet_id = s.id loop
    continue when ln.final_status in ('unchecked', 'pending_leave');          -- nothing goes on the register for a line nobody has checked
    insert into public.attendance_records as r (employee_id, work_date, status, check_in, source, note, created_by, updated_by)
    values (ln.employee_id, p_date, ln.final_status,
            case when ln.late_time is not null then ((p_date + ln.late_time) at time zone 'Asia/Dhaka') when ln.final_status in ('present', 'half_day') then null end,
            'manual', coalesce(ln.note, 'দৈনিক ফাইনাল খাতা'), p_by, p_by)
    on conflict (employee_id, work_date) do update set status = excluded.status, check_in = coalesce(excluded.check_in, case when excluded.status in ('present', 'late', 'half_day') then r.check_in end),
      note = excluded.note, updated_by = p_by
    returning r.id into v_rec;
    v_written := v_written + 1;
    update public.attendance_self_marks m set status = 'approved',
           decided_as = case when ln.final_status in ('present', 'late', 'half_day', 'absent') then ln.final_status end,
           decided_by = p_by, decided_at = now(), attendance_id = v_rec, decide_note = 'দৈনিক ফাইনাল খাতা'
     where m.id = ln.self_mark_id and m.status = 'waiting';

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

  select count(*) into v_left from public.att_day_lines where sheet_id = s.id and final_status in ('unchecked', 'pending_leave');
  -- the zonal managers hear that the register came in; when the server did it, the hub's managers hear it too
  for v_prof in select distinct ur.user_id from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                 where ro.code = 'zonal_manager' and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
                   and (ur.zone_id = s.zone_id or ur.scope_type = 'global') loop
    perform private.notify(v_prof, case when p_mode = 'auto' then 'দৈনিক হাজিরা খাতা সার্ভার সাবমিট করেছে' else 'দৈনিক ফাইনাল হাজিরা খাতা সাবমিট হয়েছে' end,
      coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || case when v_left > 0 then ' · ' || v_left || ' জনের হাজিরা যাচাই বাকি' else '' end,
      '/app/attendance?view=zone&tab=final', 'attendance_gap');
  end loop;
  if p_mode = 'auto' then
    for v_prof in select * from private.wf_hub_managers(p_hub) loop
      perform private.notify(v_prof, 'দৈনিক হাজিরা খাতা সার্ভার সাবমিট করেছে', coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY') || case when v_left > 0 then ' · ' || v_left || ' জনের হাজিরা যাচাই বাকি' else '' end,
        '/app/attendance?view=hub&tab=final&hub=' || p_hub::text || '&date=' || p_date::text, 'attendance_gap');
    end loop;
  end if;
  return jsonb_build_object('sheet_id', s.id, 'lines', v_written, 'asked', v_asked, 'version', v_no, 'unchecked', v_left);
end $$;

create or replace function private.att_day_autosubmit(p_hub uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0; v jsonb;
begin
  update public.att_reopen_windows set status = 'expired', closed_at = now() where status = 'open' and expires_at <= now() and (p_hub is null or hub_id = p_hub);
  for r in
    select h.id as hub_id, h.zone_id, d.work_date from public.hubs h
      cross join lateral (
        select g::date as work_date from generate_series(private.wf_today() - 3, private.wf_today() - 1, interval '1 day') g
        union
        select s.work_date from public.att_day_sheets s where s.hub_id = h.id and s.status = 'draft' and s.work_date < private.wf_today()) d
     where h.archived_at is null and h.status = 'active' and (p_hub is null or h.id = p_hub)
       and exists (select 1 from public.wf_att_policy ap where ap.zone_id = h.zone_id and d.work_date >= ap.day_auto_since)
       and not exists (select 1 from public.att_day_sheets s where s.hub_id = h.id and s.work_date = d.work_date and s.status = 'submitted')
       and exists (select 1 from private.att_sheet_people(h.id, d.work_date))
       and private.att_open_window(h.id, d.work_date) is null
       and now() >= private.wf_day_due(h.zone_id, d.work_date)
     order by d.work_date, h.id loop
    perform pg_advisory_xact_lock(hashtextextended('att_sheet:' || r.hub_id::text || r.work_date::text, 0));
    if private.att_open_window(r.hub_id, r.work_date) is not null then continue; end if;
    if not exists (select 1 from public.att_day_sheets s where s.hub_id = r.hub_id and s.work_date = r.work_date) then
      perform private.attendance_cutoff_alert(r.hub_id, r.zone_id, r.work_date, 'daily');
      continue;
    end if;
    begin
      v := private.att_sheet_close(r.hub_id, r.work_date, null, 'auto', true, null);
      if v is not null then v_n := v_n + 1; end if;
    exception when sqlstate 'P2201' then
      perform private.attendance_cutoff_alert(r.hub_id, r.zone_id, r.work_date, 'daily');
    when others then
      raise warning 'Daily attendance cutoff failed for hub % on % (SQLSTATE %)', r.hub_id, r.work_date, sqlstate;
    end;
  end loop;
  return v_n;
end $$;

commit;
