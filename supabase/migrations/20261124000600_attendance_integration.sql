begin;

create or replace function private.wf_morning_autosubmit() returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; v_id uuid; v_n integer := 0; v_left integer; m uuid;
begin
  for h in
    select hb.id, hb.zone_id, s.work_date
    from public.wf_morning_subs s join public.hubs hb on hb.id = s.hub_id
    where s.status = 'open' and s.revision = 1
      and s.work_date between private.wf_today() - 2 and private.wf_today()
      and hb.archived_at is null and hb.status = 'active'
      and now() >= private.wf_morning_due(hb.zone_id, s.work_date)
    order by hb.id, s.work_date
  loop
      perform pg_advisory_xact_lock(hashtextextended('wf_morning:' || h.id::text || h.work_date::text, 0));
      continue when not exists (select 1 from public.wf_morning_subs s where s.hub_id = h.id and s.work_date = h.work_date
        and s.status = 'open' and s.revision = 1);
      v_id := private.wf_morning_close(h.id, h.work_date, null, 'auto', null);
      if v_id is not null then
        v_n := v_n + 1;
        select count(*) into v_left from public.wf_morning_lines where sub_id = v_id and state = 'unknown';
        for m in select * from private.wf_hub_managers(h.id) loop
          perform private.notify(m, 'সকালের জনবল নিজে জমা হয়েছে',
            case when v_left > 0 then v_left || ' জনের হাজিরা যাচাই বাকি আছে' else 'সবার অবস্থা বসানো ছিল' end, '/app/attendance?view=hub&tab=morning&hub=' || h.id::text, 'wf_morning');
        end loop;
      end if;
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
alter table public.att_day_sheets add column auto_submitted boolean not null default false;
alter table public.att_day_lines add column auto_review_values jsonb;
create index att_day_sheets_auto_drafts on public.att_day_sheets (hub_id, work_date) where status = 'draft';

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



create function private.att_daily_auto_submit(p_now timestamptz default statement_timestamp())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  local_now timestamp := p_now at time zone 'Asia/Dhaka';
  policy public.wf_att_policy;
  d public.att_day_sheets;
  n_daily integer := 0;
  n_errors integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'Scheduled runner requires a system session' using errcode = '42501';
  end if;
  for d in
    select x.* from public.att_day_sheets x join public.hubs h on h.id = x.hub_id and h.zone_id = x.zone_id
    join public.wf_att_policy a on a.zone_id = h.zone_id
    where h.status = 'active' and h.archived_at is null and x.status = 'draft' and x.unlocked_at is null
      and x.work_date >= a.day_auto_since and x.work_date < private.wf_today()
      and x.work_date + 1 + a.day_time + make_interval(mins => a.day_extra) <= local_now
    order by x.hub_id, x.work_date for update of x skip locked
  loop
    select * into policy from public.wf_att_policy where zone_id = d.zone_id for share;
    if d.work_date >= policy.day_auto_since
        and d.work_date + 1 + policy.day_time + make_interval(mins => policy.day_extra) <= local_now then
      begin
        perform private.att_sheet_finish(d.hub_id, d.work_date, d.id, true);
        n_daily := n_daily + 1;
      exception when others then
        raise warning 'Attendance auto-submit failed for sheet % (SQLSTATE %)', d.id, sqlstate;
        n_errors := n_errors + 1;
      end;
    end if;
  end loop;
  return jsonb_build_object('daily', n_daily, 'errors', n_errors);
end $$;

revoke all on function private.att_sheet_finish(uuid, date, uuid, boolean), private.att_sheet_restore_review(),
  private.att_daily_auto_submit(timestamptz) from public, anon, authenticated, service_role;

do $$
begin
  if to_regnamespace('cron') is not null and exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('att-daily-auto-submit', '* * * * *', $job$select private.att_daily_auto_submit()$job$);
  end if;
end $$;

commit;
