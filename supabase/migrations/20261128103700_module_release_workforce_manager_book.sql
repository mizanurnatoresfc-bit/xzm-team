-- Enforce the release policy within the authorized Workforce manager-book workflows.

create or replace function public.wf_mb_book(p_hub uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.wf_today(); v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date;
  v_zone uuid; r jsonb; v_last integer; v_d1 date; v_d2 date; v_people jsonb; v_totals jsonb; v_days jsonb; v_me uuid;
  v_write boolean; v_zonal boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  perform public.module_release_require('workforce', p_hub);
  v_zone := private.hub_zone(p_hub);
  r := private.wf_mb_rules(v_zone);
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_d1 := v_month + (least((r ->> 'from_day')::integer, v_last) - 1);
  v_d2 := v_month + (least((r ->> 'to_day')::integer, v_last) - 1);
  v_me := (select e.id from private.wf_me() e);
  v_write := private.has_permission('hr.attendance.create', v_zone, p_hub);
  v_zonal := private.has_permission('hr.attendance.configure', v_zone, p_hub);

  with t as materialized (select * from private.wf_mb_cells(v_d1, v_d2, array[p_hub]))
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.d::date,
        'closed', bd.id is not null, 'closed_at', bd.closed_at, 'closed_how', bd.how,
        'closed_by_name', (select pr.full_name from public.profiles pr where pr.id = bd.closed_by),
        'submitted', private.wf_mb_locked(v_zone, d.d::date) is not null,
        'entered', (select count(*) from t where t.work_date = d.d::date and t.code is not null),
        'missing', (select count(*) from t where t.work_date = d.d::date and t.missing),
        'missing_others', (select count(*) from t where t.work_date = d.d::date and t.missing and t.employee_id is distinct from v_me),
        'future', d.d::date > v_today) order by d.d), '[]'::jsonb)
       from generate_series(v_d1, v_d2, interval '1 day') d(d)
       left join public.wf_book_days bd on bd.hub_id = p_hub and bd.work_date = d.d::date),
    (select coalesce(jsonb_agg(p.j order by p.nm), '[]'::jsonb) from (
       select e.full_name as nm, jsonb_build_object(
         'employee_id', e.id, 'code', e.employee_code::text, 'name', e.full_name, 'mobile', e.mobile, 'self', e.id = v_me,
         'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
         'cells', jsonb_agg(jsonb_build_object('c', t.code, 't', to_char(t.late_at, 'HH24:MI'), 'p', t.paid, 'id', t.entry_id, 'v', t.revision,
                                               'm', t.missing, 'b', t.in_book, 'sg', t.suggest, 'sr', t.suggest_ref, 'sn', t.suggest_note,
                                               'sf', t.site_from, 'st', t.site_to, 'ref', t.site_ref, 'n', t.note) order by t.work_date),
         'sum', private.wf_mb_sum(array_agg(t.code order by t.work_date), array_agg(t.paid order by t.work_date),
                                  array_agg(t.missing order by t.work_date), array_agg(t.in_book order by t.work_date))) as j
       from t join public.employees e on e.id = t.employee_id
       group by e.id) p),
    (select private.wf_mb_sum(array_agg(t.code), array_agg(t.paid), array_agg(t.missing), array_agg(t.in_book)) from t)
  into v_days, v_people, v_totals;

  return jsonb_build_object('hub', private.wf_hub_json(p_hub), 'month', v_month, 'today', v_today, 'rules', r,
    'open', coalesce((r ->> 'open')::boolean, true) and v_month = date_trunc('month', v_today)::date,
    'can', jsonb_build_object('view', true, 'write', v_write, 'close', v_write, 'zonal', v_zonal),
    'dates', (select coalesce(jsonb_agg(v_d1 + i order by i), '[]'::jsonb) from generate_series(0, v_d2 - v_d1) i),
    'days', v_days, 'people', v_people, 'totals', v_totals);
end $$;

create or replace function public.wf_mb_set(p_hub uuid, p_date date, p_items jsonb, p_reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid; v_how text; x jsonb; e public.employees; b public.wf_book_entries; v_new jsonb; v_old jsonb;
  v_code text; v_late time; v_sf date; v_st date; v_ref text; v_note text; v_reason text := private.wf_clean(p_reason);
  v_closed boolean; n integer := 0; v_status text; v_check timestamptz; m public.attendance_self_marks; v_ids uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null or not exists (select 1 from public.hubs h where h.id = p_hub) then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nothing to save — কিছু বাছা হয়নি' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'At most 500 people at a time' using errcode = '22023'; end if;
  v_zone := private.hub_zone(p_hub);
  perform pg_advisory_xact_lock(hashtextextended('wf_mb:' || p_hub::text || ':' || coalesce(p_date::text, ''), 0));
  v_how := private.wf_mb_may_write(p_hub, v_zone, p_date, null);
  perform public.module_release_require('workforce', p_hub);
  select exists (select 1 from public.wf_book_days d where d.hub_id = p_hub and d.work_date = p_date) into v_closed;

  for x in select * from jsonb_array_elements(p_items) loop
    select * into e from public.employees where id = nullif(x ->> 'employee_id', '')::uuid and archived_at is null;
    if e.id is null or e.hub_id is distinct from p_hub then
      raise exception 'This person is not in this hub — এই কর্মী এই হাবের নন' using errcode = '22023'; end if;
    if e.id = any(v_ids) then raise exception 'The same person is listed twice — একই কর্মী দুবার' using errcode = '22023'; end if;
    v_ids := v_ids || e.id;
    perform private.wf_mb_may_write(p_hub, v_zone, p_date, e.id);
    if e.status <> 'active' then raise exception '% is not active — % সক্রিয় নন', e.full_name, e.full_name using errcode = '22023'; end if;
    if e.joining_date is not null and p_date < e.joining_date then
      raise exception '% joined later — % এর যোগদানের আগের তারিখ', e.full_name, e.full_name using errcode = '22023'; end if;
    v_code := x ->> 'code';
    if v_code is null or not (v_code = any(private.wf_mb_codes())) then
      raise exception 'Choose one of the inputs — একটি ইনপুট বাছুন' using errcode = '22023'; end if;
    v_late := null; v_sf := null; v_st := null; v_ref := null;
    if v_code = 'late' then
      if coalesce(x ->> 'late_at', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Write the time they came — কখন এসেছেন সেই সময় লিখুন (যেমন 10:15)' using errcode = '22023'; end if;
      v_late := (x ->> 'late_at')::time;
    elsif v_code = 'absent_site' then
      v_sf := nullif(x ->> 'site_from', '')::date; v_st := nullif(x ->> 'site_to', '')::date;
      if v_sf is null or v_st is null then
        raise exception 'Write the website application''s dates (from – to) — ওয়েবসাইটের আবেদনের তারিখ (থেকে – পর্যন্ত) দিন' using errcode = '22023'; end if;
      if v_sf > v_st or p_date not between v_sf and v_st then
        raise exception 'The application''s dates must include this date — আবেদনের তারিখের মধ্যে এই দিনটি থাকতে হবে' using errcode = '22023'; end if;
      if v_st - v_sf > 62 then raise exception 'An application covers at most 62 days' using errcode = '22023'; end if;
      v_ref := private.wf_clean(x ->> 'site_ref', 60);
    end if;
    v_note := private.wf_clean(x ->> 'note');
    v_new := jsonb_build_object('code', v_code, 'late_at', to_char(v_late, 'HH24:MI'), 'site_from', v_sf, 'site_to', v_st, 'site_ref', v_ref, 'note', v_note);

    select * into b from public.wf_book_entries where employee_id = e.id and work_date = p_date for update;
    if b.id is not null then
      v_old := private.wf_mb_entry_json(b);
      continue when v_old = v_new;          -- same input again: nothing changes
      if v_closed and v_reason is null then
        raise exception 'Write why this closed day is corrected — ক্লোজ হওয়া দিনের সংশোধনের কারণ লিখুন' using errcode = '22023'; end if;
      update public.wf_book_entries set code = v_code, late_at = v_late, site_from = v_sf, site_to = v_st, site_ref = v_ref, note = v_note,
             revision = revision + 1, hub_id = p_hub, zone_id = v_zone
       where id = b.id returning * into b;
      insert into public.wf_book_entry_log (entry_id, employee_id, hub_id, work_date, revision, action, before, after, reason, by_user)
      values (b.id, e.id, p_hub, p_date, b.revision, case when v_how = 'zonal' then 'corrected' else 'changed' end, v_old, v_new, v_reason, auth.uid());
    else
      insert into public.wf_book_entries (employee_id, hub_id, zone_id, work_date, code, late_at, site_from, site_to, site_ref, note)
      values (e.id, p_hub, v_zone, p_date, v_code, v_late, v_sf, v_st, v_ref, v_note) returning * into b;
      insert into public.wf_book_entry_log (entry_id, employee_id, hub_id, work_date, revision, action, before, after, reason, by_user)
      values (b.id, e.id, p_hub, p_date, 1, case when v_how = 'zonal' and v_closed then 'corrected' else 'created' end, null, v_new, v_reason, auth.uid());
    end if;

    -- the register (one place every older screen reads)
    v_status := case v_code when 'hub_online' then 'present' when 'hub_no_online' then 'present' when 'late' then 'late'
                            when 'absent_site' then 'leave' when 'absent_no_site' then 'absent' else v_code end;
    v_check := case when v_late is not null then (p_date + v_late) at time zone 'Asia/Dhaka' end;
    insert into public.attendance_records as a (employee_id, work_date, status, check_in, source, note)
    values (e.id, p_date, v_status, v_check, 'book', 'হাজিরা খাতা: ' || v_code || coalesce(' — ' || v_reason, ''))
    on conflict (employee_id, work_date) do update
      set status = excluded.status, source = 'book', note = excluded.note,
          check_in = coalesce(excluded.check_in, case when excluded.status = 'late' then a.check_in end),
          check_out = case when a.check_out < coalesce(excluded.check_in, a.check_in) then null else a.check_out end;
    -- the person's own waiting input for that date is settled by the book
    for m in select * from public.attendance_self_marks s where s.employee_id = e.id and s.work_date = p_date and s.status = 'waiting' loop
      perform private.wf_close_on_register(m, 'হাজিরা খাতায় লেখা হয়েছে');
    end loop;
    -- "এখুনি আবেদন করুন": tell the person
    if v_code = 'absent_no_site' and (v_old is null or v_old ->> 'code' is distinct from 'absent_no_site') then
      perform private.notify(e.profile_id, 'ওয়েবসাইটে এখুনি ছুটির আবেদন করুন',
        format('%s তারিখে আপনি অনুপস্থিত, কিন্তু Steadfast ওয়েবসাইটে আবেদন দেওয়া নেই — এখুনি আবেদন করুন, তারপর আবেদনের নম্বর ও তারিখ হাজিরা বইয়ে দিন।', to_char(p_date, 'DD/MM/YYYY')),
        '/app/workforce/attendance', 'attendance');
    end if;
    v_old := null;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.wf_mb_close(p_hub uuid, p_date date, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; v_how text; v_missing integer; v_names text; v_counts jsonb; v_me uuid := (select e.id from private.wf_me() e);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hub is null or not exists (select 1 from public.hubs h where h.id = p_hub) then raise exception 'Choose a hub — হাব বাছুন' using errcode = '22023'; end if;
  v_zone := private.hub_zone(p_hub);
  perform pg_advisory_xact_lock(hashtextextended('wf_mb:' || p_hub::text || ':' || coalesce(p_date::text, ''), 0));
  if exists (select 1 from public.wf_book_days d where d.hub_id = p_hub and d.work_date = p_date) then
    raise exception 'This day is already closed — এই দিনের খাতা আগেই ক্লোজ হয়েছে' using errcode = '23505'; end if;
  v_how := private.wf_mb_may_write(p_hub, v_zone, p_date, null);
  perform public.module_release_require('workforce', p_hub);
  select count(*), string_agg(e.full_name, ', ' order by e.full_name)
    into v_missing, v_names
    from private.wf_mb_cells(p_date, p_date, array[p_hub]) c join public.employees e on e.id = c.employee_id
   where c.missing and (v_how = 'zonal' or c.employee_id is distinct from v_me);
  if v_missing > 0 then
    raise exception '% people still have no input: % — এখনো % জনের হাজিরা লেখা হয়নি', v_missing, left(v_names, 300), v_missing using errcode = '22023';
  end if;
  select private.wf_mb_sum(array_agg(c.code), array_agg(c.paid), array_agg(c.missing), array_agg(c.in_book)) into v_counts
    from private.wf_mb_cells(p_date, p_date, array[p_hub]) c;
  insert into public.wf_book_days (hub_id, work_date, closed_by, how, note, counts)
  values (p_hub, p_date, auth.uid(), v_how, private.wf_clean(p_note), v_counts);
  return v_counts;
end $$;

create or replace function public.wf_mb_history(p_hub uuid, p_employee uuid default null, p_month date default null, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', coalesce(p_month, private.wf_today()))::date;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform 1 from private.wf_hubs('hr.attendance.view', null, p_hub);
  perform public.module_release_require('workforce', p_hub);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'entry_id', l.entry_id, 'employee_id', l.employee_id, 'employee_name', e.full_name,
            'employee_code', e.employee_code::text, 'work_date', l.work_date, 'revision', l.revision, 'action', l.action, 'before', l.before, 'after', l.after,
            'reason', l.reason, 'by_name', pr.full_name, 'at', l.at) order by l.at desc), '[]'::jsonb)
    from (select * from public.wf_book_entry_log l
           where l.hub_id = p_hub and (p_employee is null or l.employee_id = p_employee)
             and l.work_date >= v_month and l.work_date < (v_month + interval '1 month')::date
           order by l.at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) l
    join public.employees e on e.id = l.employee_id
    left join public.profiles pr on pr.id = l.by_user);
end $$;
