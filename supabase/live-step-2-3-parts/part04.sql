-- Part 4 of 7. Run in the Supabase SQL editor of the LIVE project, in order, one at a time. It only stores text in a scratch table; nothing changes yet.
insert into private._mig_stage(part, body) values (4, $mig$  update public.att_day_sheets set status = 'draft', submitted_at = null, submitted_by = null, unlocked_by = p_by, unlocked_at = now(), unlock_note = p_reason,
         window_id = v_id, updated_at = now()
   where hub_id = p_hub and work_date between p_from and p_to and status = 'submitted';
  get diagnostics v_n = row_count;
  for m in select e.profile_id from private.att_hub_managers(p_hub) e union select * from private.wf_role_hub_managers(p_hub) loop      -- live's unlock notice: role or position (att_hub_managers)
    perform private.notify(m, 'হাজিরা খাতা সংশোধনের জন্য খোলা হয়েছে',
      coalesce(private.hub_name(p_hub), '') || ' · ' || to_char(p_from, 'DD-MM-YYYY') || case when p_to <> p_from then ' থেকে ' || to_char(p_to, 'DD-MM-YYYY') else '' end
      || ' · ' || p_minutes || ' মিনিট — ' || p_reason, '/app/attendance?view=hub&tab=final&hub=' || p_hub::text || '&date=' || p_from::text, 'attendance_gap');
  end loop;
  return jsonb_build_object('window', v_id, 'opened', v_n, 'expires_at', now() + make_interval(mins => p_minutes));
end $$;

create or replace function public.att_reopen_open(p_hub uuid, p_from date, p_to date, p_minutes integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_reason text := private.wf_clean(p_reason);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v_zone := private.hub_zone(p_hub);
  if v_zone is null then raise exception 'Hub not found' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', v_zone, p_hub) then
    raise exception 'Only the zonal manager opens a register for correction — শুধু জোনাল ম্যানেজার সংশোধনের জন্য খুলতে পারেন' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to > private.wf_today() then
    raise exception 'Give a first and last date, the last not after today — শুরু ও শেষ তারিখ দিন, শেষ তারিখ আজকের পরে নয়' using errcode = '22023'; end if;
  if p_to - p_from > 92 then raise exception 'At most three months at a time — একবারে সর্বোচ্চ তিন মাস' using errcode = '22023'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 43200 then raise exception 'Give the minutes (1 to 43200) — মিনিট দিন (১ থেকে ৪৩২০০)' using errcode = '22023'; end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'Write why it is opened — কেন খুলছেন লিখুন' using errcode = '22023'; end if;
  return private.att_reopen_do(p_hub, p_from, p_to, p_minutes, v_reason, auth.uid());
end $$;

-- The one-day unlock of the daily register is a reopening of that day (two hours).
create or replace function public.att_sheet_unlock(p_sheet uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets; v_note text := private.wf_clean(p_note);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet for update;
  if s.id is null then raise exception 'No such register — খাতা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', s.zone_id, s.hub_id) then
    raise exception 'Only the zonal manager unlocks a register — শুধু জোনাল ম্যানেজার খাতা খুলতে পারেন' using errcode = '42501'; end if;
  if s.status <> 'submitted' then raise exception 'This register is not locked — খাতা লক করা নেই' using errcode = 'P0001'; end if;
  if v_note is null then raise exception 'Write why it is unlocked — কেন খুলছেন লিখুন' using errcode = '22023'; end if;
  perform private.att_reopen_do(s.hub_id, s.work_date, s.work_date, 120, v_note, auth.uid());
end $$;

-- Close a reopening early: the permission ends and the server submits what is still a draft.
create or replace function public.att_reopen_close(p_window uuid, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare w public.att_reopen_windows; v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into w from public.att_reopen_windows where id = p_window for update;
  if w.id is null then raise exception 'No such opening — খোলা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', w.zone_id, w.hub_id) then
    raise exception 'Only the zonal manager ends an opening — শুধু জোনাল ম্যানেজার শেষ করতে পারেন' using errcode = '42501'; end if;
  if w.status <> 'open' then raise exception 'This opening has already ended — এই খোলা আগেই শেষ হয়েছে' using errcode = 'P0001'; end if;
  update public.att_reopen_windows set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_note = private.wf_clean(p_note) where id = w.id;
  v_n := private.att_day_autosubmit(w.hub_id);
  return v_n;
end $$;

-- A hub's openings (the last twenty): who, which days, until when, why.
create or replace function public.att_reopen_list(p_hub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'from', w.from_date, 'to', w.to_date, 'expires_at', w.expires_at, 'reason', w.reason, 'by', w.approved_by_name,
      'status', case when w.status = 'open' and w.expires_at <= now() then 'expired' else w.status end, 'created_at', w.created_at, 'closed_at', w.closed_at,
      'can_close', w.status = 'open' and w.expires_at > now() and private.has_permission('hr.attendance.configure', w.zone_id, w.hub_id)) order by w.created_at desc)
    from (select * from public.att_reopen_windows x where x.hub_id = p_hub order by x.created_at desc limit 20) w), '[]'::jsonb);
end $$;

-- An old version of a register: who was on it and in which state.
create or replace function public.att_sheet_version_get(p_sheet uuid, p_no integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.att_day_sheets; v public.att_sheet_versions;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet;
  if s.id is null or not private.has_permission('hr.attendance.view', s.zone_id, s.hub_id) then
    raise exception 'You may not see this register — এই খাতা দেখার অনুমতি নেই' using errcode = '42501'; end if;
  select * into v from public.att_sheet_versions where sheet_id = p_sheet and version_no = p_no;
  if v.id is null then raise exception 'No such version — এই সংস্করণ নেই' using errcode = 'P0002'; end if;
  return jsonb_build_object('no', v.version_no, 'mode', v.mode, 'at', v.submitted_at, 'by', v.submitted_by_name, 'date', v.work_date,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'final_status', x ->> 'final_status',
        'late_time', x ->> 'late_time', 'unauthorized', (x ->> 'unauthorized')::boolean, 'absence_reason', x ->> 'absence_reason', 'absence_app_date', x ->> 'absence_app_date',
        'leave_ref', x ->> 'leave_ref', 'online_marked', (x ->> 'online_marked')::boolean, 'online_at', x ->> 'online_at', 'note', x ->> 'note') order by e.full_name)
      from jsonb_array_elements(v.lines) x join public.employees e on e.id = (x ->> 'employee_id')::uuid), '[]'::jsonb));
end $$;

-- the zonal manager sends a submitted register (this version) once to every manager of the hub
create or replace function public.att_sheet_send(p_sheet uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets; n integer := 0; r record;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet for update;
  if s.id is null then raise exception 'No such register — খাতা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.attendance.configure', s.zone_id, s.hub_id) then
    raise exception 'Only the zonal manager sends a register for checking — শুধু জোনাল ম্যানেজার যাচাইয়ে পাঠাতে পারেন' using errcode = '42501'; end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted register is sent — আগে ম্যানেজার খাতা সাবমিট দিন' using errcode = 'P0001'; end if;
  for r in select e.id, e.profile_id from private.att_hub_managers(s.hub_id) e loop            -- by role or by position, as live (att_self_line_and_manager_roles)
    insert into public.att_sheet_checks (sheet_id, profile_id, employee_id, sent_by, version_no) values (s.id, r.profile_id, r.id, auth.uid(), s.version)
    on conflict (sheet_id, profile_id, version_no) do nothing;
    if found then
      n := n + 1;
      perform private.notify(r.profile_id, 'হাজিরা খাতা যাচাই করুন', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.work_date, 'DD-MM-YYYY') || ' · সংস্করণ ' || s.version || ' — দেখে "ঠিক আছে" দিন, নইলে সংশোধনের কারণ লিখুন',
        '/app/attendance?view=hub&tab=final&hub=' || s.hub_id || '&date=' || s.work_date, 'attendance_gap');
    end if;
  end loop;
  if n = 0 and not exists (select 1 from public.att_sheet_checks c where c.sheet_id = s.id and c.version_no = s.version) then
    raise exception 'This hub has no manager with a login — এই হাবে লগইনসহ কোনো ম্যানেজার নেই' using errcode = 'P0001';
  end if;
  update public.att_day_sheets set sent_by = auth.uid(), sent_at = coalesce(sent_at, now()) where id = s.id;
  return n;
end $$;

-- "ঠিক আছে" belongs to the version that was sent
create or replace function public.att_sheet_check_ok(p_sheet uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet;
  update public.att_sheet_checks set ok_at = now(), returned_at = null, return_reason = null
   where sheet_id = p_sheet and profile_id = auth.uid() and version_no = s.version and ok_at is null;
  if not found and not exists (select 1 from public.att_sheet_checks where sheet_id = p_sheet and profile_id = auth.uid() and version_no = s.version) then
    raise exception 'This register was not sent to you — খাতাটি আপনাকে যাচাইয়ে পাঠানো হয়নি' using errcode = '42501';
  end if;
end $$;

-- the hub manager does not agree: the reason goes to the zonal manager, who may reopen it
create or replace function public.att_sheet_check_return(p_sheet uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.att_day_sheets; v_reason text := private.wf_clean(p_reason); z uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from public.att_day_sheets where id = p_sheet;
  if v_reason is null or length(v_reason) < 3 then raise exception 'Write what must be corrected — কী সংশোধন করতে হবে লিখুন' using errcode = '22023'; end if;
  update public.att_sheet_checks set returned_at = now(), return_reason = v_reason, ok_at = null
   where sheet_id = p_sheet and profile_id = auth.uid() and version_no = s.version;
  if not found then raise exception 'This register was not sent to you — খাতাটি আপনাকে যাচাইয়ে পাঠানো হয়নি' using errcode = '42501'; end if;
  for z in select * from private.wf_role_zone_managers(s.zone_id) loop
    perform private.notify(z, 'হাজিরা খাতায় সংশোধনের অনুরোধ', coalesce(private.hub_name(s.hub_id), '') || ' · ' || to_char(s.work_date, 'DD-MM-YYYY') || ' · সংস্করণ ' || s.version || ' — ' || v_reason,
      '/app/attendance?view=hub&tab=final&hub=' || s.hub_id || '&date=' || s.work_date, 'attendance_gap');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. The monthly register: numbered submissions made from the daily versions
-- ---------------------------------------------------------------------
-- The days a month's submission rests on: from the hub's first submitted register (or the 1st) to the month's end or yesterday.
create or replace function private.att_month_scan(p_hub uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_m date := date_trunc('month', p_month)::date; v_from date; v_to date; v_first date;
begin
  select min(s.work_date) into v_first from public.att_day_sheets s where s.hub_id = p_hub and s.version > 0;
  v_from := greatest(v_m, coalesce(v_first, v_m));
  v_to := least((v_m + interval '1 month' - interval '1 day')::date, private.wf_today() - 1);
  return jsonb_build_object('from', v_from, 'to', v_to,
    'days', coalesce((select jsonb_object_agg(s.work_date::text, s.version) from public.att_day_sheets s
                       where s.hub_id = p_hub and s.work_date between v_from and v_to and s.status = 'submitted'), '{}'::jsonb),
    'missing', coalesce((select jsonb_agg(g::date order by g) from generate_series(v_from, v_to, interval '1 day') g
                          where not exists (select 1 from public.att_day_sheets s where s.hub_id = p_hub and s.work_date = g::date and s.status = 'submitted')), '[]'::jsonb));
end $$;

create or replace function public.att_month_get(p_hub uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_m date := date_trunc('month', coalesce(p_month, private.wf_today()))::date; v_zone uuid := private.hub_zone(p_hub); v_scan jsonb; v_sub public.att_month_subs;
begin
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  v_scan := private.att_month_scan(p_hub, v_m);
  select * into v_sub from public.att_month_subs where hub_id = p_hub and month = v_m order by version_no desc limit 1;
  return jsonb_build_object('hub', jsonb_build_object('id', p_hub, 'name', private.hub_name(p_hub)), 'month', v_m, 'today', private.wf_today(),
    'from', v_scan -> 'from', 'to', v_scan -> 'to', 'missing', v_scan -> 'missing', 'days', v_scan -> 'days',
    'sub', case when v_sub.id is null then null else jsonb_build_object('id', v_sub.id, 'version_no', v_sub.version_no, 'at', v_sub.submitted_at, 'by', v_sub.submitted_by_name, 'days', v_sub.day_versions) end,
    -- the daily registers moved after the monthly one was made from them: the month must be submitted again
    'changed', v_sub.id is not null and v_sub.day_versions is distinct from v_scan -> 'days',
    'changed_days', case when v_sub.id is null then '[]'::jsonb else coalesce((select jsonb_agg(d order by d) from (
        select k as d from jsonb_object_keys(v_scan -> 'days') k where (v_scan -> 'days' -> k) is distinct from (v_sub.day_versions -> k)
        union select k from jsonb_object_keys(v_sub.day_versions) k where not (v_scan -> 'days') ? k) q), '[]'::jsonb) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('version_no', x.version_no, 'at', x.submitted_at, 'by', x.submitted_by_name, 'days', (select count(*) from jsonb_object_keys(x.day_versions))) order by x.version_no desc)
                          from public.att_month_subs x where x.hub_id = p_hub and x.month = v_m), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('profile_id', c.profile_id, 'name', coalesce(e.full_name, pr.full_name), 'sent_at', c.sent_at, 'ok_at', c.ok_at,
        'returned_at', c.returned_at, 'return_reason', c.return_reason) order by e.full_name)
        from public.att_month_checks c left join public.employees e on e.id = c.employee_id left join public.profiles pr on pr.id = c.profile_id where c.sub_id = v_sub.id), '[]'::jsonb),
    'my_check', (select jsonb_build_object('sent_at', c.sent_at, 'ok_at', c.ok_at, 'returned_at', c.returned_at, 'return_reason', c.return_reason)
                   from public.att_month_checks c where c.sub_id = v_sub.id and c.profile_id = auth.uid()),
    'can', jsonb_build_object('submit', private.has_permission('hr.attendance.create', v_zone, p_hub),
                              'send', private.has_permission('hr.attendance.configure', v_zone, p_hub) and v_sub.id is not null and not coalesce(v_sub.day_versions is distinct from v_scan -> 'days', false)));
end $$;

-- Submit the month (the manager). A missing day is named; the same days at the same versions are the same submission.
create or replace function public.att_month_submit(p_hub uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = '' as $$$mig$);
