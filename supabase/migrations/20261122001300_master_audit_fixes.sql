-- Master audit of 22 Nov 2026 (second pass: work entered as staff, hub manager and zonal manager). Four database fixes.
-- Every function below is the body that was live before, with only the marked change. Safe to run again.
--
-- 1. att_sheet_submit: a register could never be submitted once someone on it had left the job (the register refuses a new
--    row for a leaver, and that failed the whole hub's day). Now an existing row is updated, a new row is written only for
--    an active person; the leaver's line stays on the sheet.
-- 2. hr_request_decide: an "আইডি সাময়িক বন্ধ" (ID temporarily off) request approved in the zonal inbox made the person
--    resigned with an exit file. It now makes the person inactive (no exit row, no exit file); exit_type 'inactive' is accepted.
-- 3. hr_request_inbox / hr_request_decide: one request with a date that is not YYYY-MM-DD broke the whole inbox for every
--    approver. Dates are now read with private.safe_date (an unreadable date counts as no date).
-- 4. wf_ops_after: a tap sent without a note was listed with the note of an earlier tap.

create or replace function private.safe_date(p text) returns date language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;
revoke all on function private.safe_date(text) from public, anon;

CREATE OR REPLACE FUNCTION public.att_sheet_submit(p_hub uuid, p_date date, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_sheet uuid; s public.att_day_sheets; ln record; v_rec uuid; v_bad text; v_asked integer := 0; v_written integer := 0;
  v_reasons text[]; v_r text; v_prof uuid; v_hub text := private.hub_name(p_hub); v_in timestamptz;
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
    perform private.notify(v_prof, 'দৈনিক ফাইনাল হাজিরা খাতা সাবমিট হয়েছে', coalesce(v_hub, '') || ' · ' || to_char(p_date, 'DD-MM-YYYY'),
      '/app/workforce/zone?tab=final', 'attendance_gap');
  end loop;
  return jsonb_build_object('sheet_id', s.id, 'lines', v_written, 'asked', v_asked);
end $$;

CREATE OR REPLACE FUNCTION public.hr_request_decide(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text, p_opts jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  r public.hr_requests;
  e public.employees%rowtype;
  a public.employee_applications%rowtype;
  o jsonb := coalesce(p_opts, '{}'::jsonb);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_reason text;
  v_eff date;
  v_code text;
  v_status text;
  v_to uuid;
  v_from uuid;
  v_accounts jsonb;
  v_file uuid;
  v_result text;
  v_what text;
  v_title text;
  v_link text;
  u uuid;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into r from public.hr_requests where id = p_id for update;
  if not found then raise exception 'রিকুয়েস্ট পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.request.approve', r.zone_id, r.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if r.status not in ('submitted', 'processing') then raise exception 'এই রিকুয়েস্ট আগেই শেষ হয়েছে' using errcode = 'P0001'; end if;
  if r.kind not in ('id_create', 'id_inactive', 'id_transfer', 'id_active') then
    raise exception 'এই ধরনের রিকুয়েস্ট “রিকুয়েস্ট ও আবেদন” পাতা থেকে শেষ করুন' using errcode = '22023';
  end if;
  if r.employee_id is not null then
    select * into e from public.employees where id = r.employee_id for update;
  end if;
  v_reason := nullif(concat_ws(' — ', nullif(trim(coalesce(r.data ->> 'reason_type', '')), ''), nullif(trim(coalesce(r.data ->> 'reason', '')), '')), '');
  v_what := case r.kind when 'id_create' then 'নতুন স্টাফ' when 'id_inactive' then 'চাকরি ছাড়া'
                        when 'id_transfer' then 'বদলি' else 'আইডি চালু' end;

  if not coalesce(p_approve, false) then
    if v_note is null then raise exception 'বাতিলের কারণ লিখুন' using errcode = '22023'; end if;
    if r.kind = 'id_create' and e.id is not null and e.status = 'applicant' then
      update public.employee_applications
         set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
       where employee_id = e.id and status = 'submitted';
      if found then
        perform set_config('app.change_reason', v_note, true);
        update public.employees set status = 'rejected', status_since = current_date where id = e.id;
        insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
        values (e.id, 'applicant', 'rejected', current_date, v_note);
      end if;
    end if;
    v_status := 'rejected';
  else
    if e.id is null then
      raise exception 'এই রিকুয়েস্টে কোনো স্টাফ যুক্ত নেই — “রিকুয়েস্ট ও আবেদন” পাতা থেকে শেষ করুন' using errcode = 'P0001';
    end if;

    if r.kind = 'id_create' then
      select * into a from public.employee_applications where employee_id = e.id for update;
      if a.status is distinct from 'submitted' or e.status <> 'applicant' then
        raise exception 'আবেদনটি অনুমোদনের অবস্থায় নেই' using errcode = 'P0001';
      end if;
      -- two-person rule, as in hr_approve_application
      if (a.submitted_by = auth.uid() or r.submitted_by = auth.uid()) and not private.is_super_admin() then
        raise exception 'যিনি আবেদন পাঠিয়েছেন তিনি নিজে অনুমোদন করতে পারবেন না — অন্য একজন অনুমোদন করবেন' using errcode = '42501';
      end if;
      v_code := upper(nullif(trim(coalesce(o ->> 'employee_code', '')), ''));
      if v_code is null then v_code := private.hr_next_code(); end if;
      if v_code !~ private.setting_text('hr.employee_code_pattern') then
        raise exception 'এমপ্লয়ি আইডি "%" কোম্পানির নিয়মের সাথে মিলছে না', v_code using errcode = '23514';
      end if;
      if exists (select 1 from public.employees x where x.employee_code = v_code::extensions.citext) then
        raise exception 'এমপ্লয়ি আইডি % আগেই ব্যবহার হয়েছে', v_code using errcode = '23505';
      end if;
      v_eff := coalesce(e.joining_date, current_date);
      perform set_config('app.change_reason', 'New staff request ' || r.request_no || ' approved', true);
      update public.employees
         set employee_code = v_code, status = 'active', status_since = v_eff, joining_date = v_eff
       where id = e.id;
      update public.employee_applications
         set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
       where employee_id = e.id;
      insert into public.employee_assignments
        (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, reason)
      values (e.id, 'joining', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id, v_eff,
              'Application approved (' || r.request_no || ')');
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (e.id, 'applicant', 'active', v_eff, coalesce(v_note, 'Application approved'));
      update public.employee_compensation
         set status = 'approved', approved_by = auth.uid(), approved_at = now()
       where employee_id = e.id and status = 'pending';
      v_file := private.hr_make_record_file(r.id, 'joining', e.id, v_eff, v_note);
      v_result := v_code;

    elsif r.kind = 'id_inactive' then
      if e.status not in ('active', 'inactive') then
        raise exception 'এই স্টাফ এখন সক্রিয় নেই' using errcode = 'P0001';
      end if;
      if e.profile_id = auth.uid() then
        raise exception 'নিজের চাকরির অবস্থা নিজে বদলানো যায় না' using errcode = '42501';
      end if;
      v_status := coalesce(nullif(trim(coalesce(o ->> 'exit_type', '')), ''), 'resigned');
      -- "আইডি সাময়িক বন্ধ" is a pause, not an exit: the person becomes inactive and can be switched on again
      if nullif(trim(coalesce(o ->> 'exit_type', '')), '') is null and trim(coalesce(r.data ->> 'reason_type', '')) = 'আইডি সাময়িক বন্ধ' then
        v_status := 'inactive';
      end if;
      if v_status not in ('resigned', 'terminated', 'inactive') then raise exception 'ভুল ধরন' using errcode = '22023'; end if;
      if v_status = 'inactive' and e.status = 'inactive' then
        raise exception 'এই স্টাফের আইডি আগে থেকেই বন্ধ আছে' using errcode = 'P0001';
      end if;
      v_eff := least(coalesce(private.safe_date(o ->> 'effective_date'), private.safe_date(r.data ->> 'last_date'), current_date), current_date);
      v_reason := coalesce(v_reason, v_note, 'HR request ' || r.request_no);
     if v_status = 'inactive' then
      -- no exit row, no exit file, the login is switched off until the ID is made active again
      perform set_config('app.change_reason', v_reason, true);
      update public.employees set status = 'inactive', status_since = v_eff where id = e.id;
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (e.id, e.status, 'inactive', v_eff, v_reason);
      if e.profile_id is not null then
        update public.profiles set status = 'inactive' where id = e.profile_id;
      end if;
      v_result := 'আইডি সাময়িক বন্ধ';
     else
      v_accounts := private.hr_exit_accounts(e.id, v_eff);

      perform set_config('app.change_reason', v_reason, true);
      update public.employees set status = v_status, status_since = v_eff where id = e.id;
      insert into public.employee_status_history (employee_id, from_status, to_status, effective_date, reason)
      values (e.id, e.status, v_status, v_eff, v_reason);
      update public.employee_assignments set effective_to = greatest(v_eff, effective_from)
       where employee_id = e.id and effective_to is null;
      -- the exit itself, as a closed row of the assignment history
      insert into public.employee_assignments
        (employee_id, change_type, department_id, position_id, zone_id, hub_id, reporting_manager_id, effective_from, effective_to, reason)
      values (e.id, 'exit', e.department_id, e.position_id, e.zone_id, e.hub_id, e.reporting_manager_id, v_eff, v_eff, v_reason);
      if e.profile_id is not null then
        update public.profiles set status = 'inactive' where id = e.profile_id;
      end if;
      v_file := private.hr_make_record_file(r.id, 'exit', e.id, v_eff, v_reason, e.hub_id, null, v_accounts);
      v_result := case v_status when 'terminated' then 'অব্যাহতি' else 'চাকরি ছেড়েছেন' end;
     end if;

    elsif r.kind = 'id_transfer' then
      if coalesce(o ->> 'to_hub', r.data ->> 'to_hub', '') !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'নতুন হাব বেছে নিন' using errcode = '22023';
      end if;
      v_to := coalesce(nullif(o ->> 'to_hub', ''), r.data ->> 'to_hub')::uuid;
      v_from := e.hub_id;
      if v_to = v_from then raise exception 'কর্মী এখনই এই হাবে আছেন — অন্য হাব বেছে নিন' using errcode = '22023'; end if;
      v_eff := coalesce(private.safe_date(o ->> 'effective_date'), private.safe_date(r.data ->> 'effective_date'), current_date);
      v_reason := coalesce(v_reason, v_note, 'HR request ' || r.request_no);
      -- the file is filled while the person is still in the old hub; a refused transfer rolls it back
      v_file := private.hr_make_record_file(r.id, 'transfer', e.id, v_eff, v_reason, v_from, v_to);
      perform public.hr_transfer_employee(e.id, v_to, e.department_id, e.position_id, e.reporting_manager_id, v_eff, v_reason, 'transfer');
      v_result := (select h.name from public.hubs h where h.id = v_to);

    else  -- id_active
      v_eff := least(coalesce(private.safe_date(o ->> 'effective_date'), private.safe_date(r.data ->> 'effective_date'), current_date), current_date);
      perform public.hr_change_status(e.id, 'active', v_eff, coalesce(v_reason, v_note, 'HR request ' || r.request_no));
      v_result := 'আইডি চালু';
    end if;
    v_status := 'done';
  end if;

  perform set_config('app.change_reason', 'HR request ' || r.request_no || ' → ' || v_status, true);
  update public.hr_requests
     set status = v_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(v_note, decision_note), result = coalesce(v_result, result)
   where id = p_id;
  insert into public.hr_request_events (request_id, status, note, by_name)
  values (p_id, v_status, concat_ws(' · ', v_note, v_result), private.my_display_name());

  -- the sender, the hub's managers (both hubs of a transfer) and the person are told; each row also goes out as a phone push
  v_title := case when v_status = 'done' then 'অনুমোদিত: ' else 'বাতিল: ' end || v_what || ' · '
             || coalesce(nullif(r.data ->> 'full_name', ''), e.full_name, '') || ' · ' || r.request_no;
  for u in
    select x.profile_id from (
      select r.submitted_by as profile_id
      union select s.profile_id from private.hub_request_senders(r.hub_id) s
      union select s.profile_id from private.hub_request_senders(v_to) s
    ) x where x.profile_id is not null
  loop
    v_link := case when exists (select 1 from private.profiles_with_perm('hr.request.create', r.zone_id, r.hub_id) w where w.profile_id = u)
                     or exists (select 1 from private.hub_request_senders(v_to) w where w.profile_id = u)
                   then '/app/manager/staff?tab=pending' else '/app/hr/requests?id=' || p_id end;
    perform private.notify_p(u, v_title, coalesce(v_note, v_result), v_link, 'hr_request', 'high');
  end loop;
  if v_status = 'done' and r.kind in ('id_transfer', 'id_active') and e.profile_id is not null
     and e.profile_id is distinct from r.submitted_by then
    perform private.notify_p(e.profile_id, v_title, coalesce(v_note, v_result), '/app/hr/requests?id=' || p_id, 'hr_request', 'normal');
  end if;

  return jsonb_build_object('status', v_status, 'result', v_result, 'record_id', v_file, 'employee_id', e.id);
end $$;

CREATE OR REPLACE FUNCTION public.hr_request_inbox(p_zone uuid DEFAULT NULL::uuid, p_status text DEFAULT 'open'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x.obj order by x.created_at desc), '[]'::jsonb) into v
  from (
    select r.created_at, jsonb_build_object(
      'id', r.id, 'request_no', r.request_no, 'kind', r.kind, 'status', r.status, 'created_at', r.created_at,
      'zone_id', r.zone_id, 'hub_id', r.hub_id, 'hub_name', h.name, 'hub_code', h.code::text,
      'employee_id', r.employee_id, 'employee_name', coalesce(e.full_name, r.data ->> 'full_name'),
      'employee_code', e.employee_code::text, 'mobile', coalesce(e.mobile, r.data ->> 'mobile'),
      'position_name', coalesce(p.name, r.data ->> 'position'), 'employee_status', e.status, 'joining_date', e.joining_date,
      'reason', nullif(concat_ws(' — ', nullif(trim(coalesce(r.data ->> 'reason_type', '')), ''), nullif(trim(coalesce(r.data ->> 'reason', '')), '')), ''),
      'last_date', r.data ->> 'last_date', 'effective_date', r.data ->> 'effective_date',
      'to_hub_id', case when r.kind = 'id_transfer' then r.data ->> 'to_hub' end,
      'to_hub_name', case when r.kind = 'id_transfer' and (r.data ->> 'to_hub') ~ '^[0-9a-fA-F-]{36}$'
                          then (select th.name from public.hubs th where th.id = (r.data ->> 'to_hub')::uuid) end,
      'submitter_name', coalesce(se.full_name || coalesce(' (' || se.employee_code::text || ')', ''), sp.full_name, ''),
      'own', r.submitted_by = auth.uid(),
      'missing', case when r.kind = 'id_create' and e.status = 'applicant' then to_jsonb(private.hr_id_gaps(e.id)) end,
      'accounts', case when r.kind = 'id_inactive' and e.id is not null and r.status in ('submitted', 'processing')
                       then private.hr_exit_accounts(e.id, least(coalesce(private.safe_date(r.data ->> 'last_date'), current_date), current_date)) end,
      'decided_at', r.decided_at, 'decision_note', r.decision_note, 'result', r.result) as obj
    from public.hr_requests r
    left join public.employees e on e.id = r.employee_id
    left join public.positions p on p.id = e.position_id
    left join public.hubs h on h.id = r.hub_id
    left join public.employees se on se.id = r.submitter_employee_id
    left join public.profiles sp on sp.id = r.submitted_by
    where r.kind in ('id_create', 'id_inactive', 'id_transfer', 'id_active')
      and private.has_permission('hr.request.approve', r.zone_id, r.hub_id)
      and (p_zone is null or r.zone_id = p_zone)
      and (case when coalesce(p_status, 'open') = 'open' then r.status in ('submitted', 'processing')
                when p_status = 'all' then true else r.status = p_status end)
    order by r.created_at desc
    limit 1000
  ) x;
  return jsonb_build_object('rows', v, 'next_code', private.hr_next_code());
end $$;

CREATE OR REPLACE FUNCTION private.wf_ops_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.wf_ops_history (entry_id, revision, action, from_vals, to_vals, note, by_user)
    values (new.id, new.revision, 'submitted', null,
            jsonb_build_object('pickup', new.pickup, 'pickup_return', new.pickup_return, 'delivery', new.delivery, 'delivery_return', new.delivery_return),
            new.note, auth.uid());
  elsif new.revision <> old.revision then
    v_action := coalesce(nullif(current_setting('app.wf_action', true), ''), 'edited');
    insert into public.wf_ops_history (entry_id, revision, action, from_vals, to_vals, note, by_user)
    values (new.id, new.revision, v_action,
            jsonb_build_object('pickup', old.pickup, 'pickup_return', old.pickup_return, 'delivery', old.delivery, 'delivery_return', old.delivery_return),
            jsonb_build_object('pickup', new.pickup, 'pickup_return', new.pickup_return, 'delivery', new.delivery, 'delivery_return', new.delivery_return),
            -- an added tap carries only its own note (never the kept note of an earlier tap)
            case when v_action = 'added' then nullif(current_setting('app.wf_note', true), '')
                 else coalesce(nullif(current_setting('app.wf_note', true), ''), new.note) end, auth.uid());
  end if;
  return null;
end $$;
