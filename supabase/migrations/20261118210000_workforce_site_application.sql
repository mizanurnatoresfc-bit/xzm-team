-- =====================================================================
-- ওয়েবসাইটে আবেদনের নম্বর ও তারিখ / The website application's number and date, for an absent date "applied on the website"
--
-- Owner (18 Nov 2026): absent inputs that were applied on the (Steadfast) website must carry that application's date — and its
-- number ("আবেদন নম্বরও লাগবে").
--
--  * attendance_self_marks gets two columns: site_applied_on (the day the staff member applied on the website) and site_ref
--    (the website's application number). Both are filled only when applied_on_site is true; otherwise they are always empty.
--    Inputs given before this migration keep both empty (nobody knows them); everything new must have them.
--  * wf_att_submit(date, 'absent', true, note, site_date, site_ref): both are required for an absent "applied on the website";
--    the date may not be after today nor more than 62 days before the absent date; the number is 1–60 characters.
--  * wf_book_fill: p_site is now a list of website applications, each with its number, date and absent dates:
--    [{"ref": "…", "applied_on": "YYYY-MM-DD", "dates": ["YYYY-MM-DD", …]}, …]. Every date still goes through wf_att_submit.
--  * wf_my_book (days) and wf_marks (the approval list) also return site_applied_on and site_ref.
--  * The correction history counts a change of the number or date as "edited"; audit_logs already records every column.
--
-- Replaced (same behaviour plus the two fields): private.wf_mark_before, private.wf_mark_after, public.wf_marks,
-- public.wf_my_book. Signature changes (old one dropped): public.wf_att_submit (+2 parameters with defaults, so
-- the old named calls still resolve), public.wf_book_fill (p_site date[] -> jsonb).
-- Rollback: run the four replaced functions and wf_att_submit from 20261117010000_workforce_attendance.sql, wf_my_book and
-- wf_book_fill from 20261118200000_workforce_earlier_dates.sql (drop the new signatures first), then drop the two columns.
-- =====================================================================

alter table public.attendance_self_marks
  add column if not exists site_applied_on date,
  add column if not exists site_ref text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'att_self_site_details') then
    alter table public.attendance_self_marks add constraint att_self_site_details
      check (applied_on_site is true or (site_applied_on is null and site_ref is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'att_self_site_ref_len') then
    alter table public.attendance_self_marks add constraint att_self_site_ref_len check (site_ref is null or char_length(site_ref) between 1 and 60);
  end if;
end $$;
comment on column public.attendance_self_marks.site_applied_on is 'Absent and applied on the website: the day the staff member applied there';
comment on column public.attendance_self_marks.site_ref is 'Absent and applied on the website: the website''s application number';

drop function if exists public.wf_att_submit(date, text, boolean, text);
drop function if exists public.wf_book_fill(date[], date[], date[], text, text);

create or replace function private.wf_mark_before() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_book boolean := coalesce(current_setting('app.wf_path', true), '') = 'book';
  v_redo boolean;
begin
  new.zone_id := private.hub_zone(new.hub_id);   -- null when there is no hub
  if new.kind = 'present' then new.applied_on_site := null; new.application_id := null; end if;
  if tg_op = 'UPDATE' and not v_book then
    -- only att_self_mark puts an input back to "waiting" outside the book functions: it is the old one-tap path
    v_redo := new.status = 'waiting' and (old.status <> 'waiting' or new.marked_at is distinct from old.marked_at
                                          or (new.kind, new.note) is distinct from (old.kind, old.note));
    if v_redo then
      if old.status = 'waiting' and old.application_id is not null then
        raise exception 'This date is already in an application — withdraw the application first (এই তারিখ আবেদনে আছে)' using errcode = '23505';
      end if;
      new.via := 'today'; new.application_id := null; new.applied_on_site := null;
    end if;
  end if;
  -- the website application's date and number belong to an absent date "applied on the website" only
  if new.applied_on_site is distinct from true then new.site_applied_on := null; new.site_ref := null; end if;
  return new;
end $$;
create or replace trigger att_self_wf_before before insert or update on public.attendance_self_marks
  for each row execute function private.wf_mark_before();


create or replace function private.wf_mark_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_action text; v_cfg text := nullif(current_setting('app.wf_action', true), ''); v_by uuid := auth.uid(); v_note text;
begin
  if tg_op = 'INSERT' then
    insert into public.wf_att_history (mark_id, employee_id, hub_id, work_date, action, to_kind, to_status, to_as, note, by_user)
    values (new.id, new.employee_id, new.hub_id, new.work_date, 'submitted', new.kind, new.status, new.decided_as, new.note, v_by);
    return null;
  end if;
  if v_cfg is not null then v_action := v_cfg;
  elsif old.status = 'waiting' and new.status = 'approved' then v_action := 'approved';
  elsif old.status = 'waiting' and new.status = 'rejected' then v_action := 'returned';
  elsif old.status = 'rejected' and new.status = 'waiting' then v_action := 'resubmitted';
  elsif old.status = 'waiting' and new.status = 'waiting'
        and (new.kind, new.note, new.applied_on_site, new.application_id, new.site_applied_on, new.site_ref)
            is distinct from (old.kind, old.note, old.applied_on_site, old.application_id, old.site_applied_on, old.site_ref) then v_action := 'edited';
  end if;
  if v_action is not null and (v_cfg is not null or (old.status, old.kind, old.decided_as) is distinct from (new.status, new.kind, new.decided_as)
                              or v_action in ('edited', 'resubmitted')) then
    if v_action in ('approved', 'returned') then v_by := coalesce(new.decided_by, v_by); end if;
    v_note := case when v_action in ('approved', 'returned', 'corrected', 'cancelled') then new.decide_note else new.note end;
    insert into public.wf_att_history (mark_id, employee_id, hub_id, work_date, action, from_kind, to_kind, from_status, to_status, from_as, to_as, note, by_user)
    values (new.id, new.employee_id, new.hub_id, new.work_date, v_action, old.kind, new.kind, old.status, new.status, old.decided_as, new.decided_as, v_note, v_by);
  end if;
  if new.application_id is not null and old.status = 'waiting' and new.status in ('approved', 'rejected') then
    perform private.wf_app_sync(new.application_id, new.decided_by, new.decided_at, new.decide_note);
  end if;
  return null;
end $$;
create or replace trigger att_self_wf_after after insert or update on public.attendance_self_marks
  for each row execute function private.wf_mark_after();


-- Give one date: present, or absent with "I applied on the website" = yes, with that application's date and number.
-- (Absent with "no" goes through wf_absence_apply.)
create or replace function public.wf_att_submit(p_date date, p_kind text, p_applied_on_site boolean default null, p_note text default null,
                                                p_site_date date default null, p_site_ref text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_note text := private.wf_clean(p_note);
  v_site boolean; v_sdate date; v_sref text; m public.attendance_self_marks; v_id uuid; v_i integer; v_action text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then raise exception 'No active staff profile is linked to your login — আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf:' || e.id::text, 0));   -- one of this person's book calls at a time
  if p_kind is null or p_kind not in ('present', 'absent') then raise exception 'Unknown attendance kind' using errcode = '22023'; end if;
  perform private.wf_check_date(p_date, e.joining_date);
  if p_kind = 'absent' then
    if p_applied_on_site is null then
      raise exception 'Answer the website question first: did you apply on the website? (ওয়েবসাইটে আবেদন করেছেন কি? হ্যাঁ / না)' using errcode = '22023';
    end if;
    if not p_applied_on_site then
      raise exception 'This absence needs an application: choose the dates and write the reason (use wf_absence_apply) — আবেদন পাঠান' using errcode = '22023';
    end if;
    v_site := true;
    v_note := coalesce(v_note, 'ওয়েবসাইটে আবেদন করা আছে');
    v_sref := private.wf_clean(p_site_ref, 200);
    if v_sref is null then
      raise exception 'Write the website application number — ওয়েবসাইটের আবেদন নম্বর লিখুন' using errcode = '22023';
    end if;
    if char_length(v_sref) > 60 then
      raise exception 'The website application number is too long (at most 60 characters) — আবেদন নম্বর সর্বোচ্চ ৬০ অক্ষর' using errcode = '22023';
    end if;
    if p_site_date is null then
      raise exception 'Give the date you applied on the website — ওয়েবসাইটে কোন তারিখে আবেদন করেছেন দিন' using errcode = '22023';
    end if;
    if p_site_date > v_today then
      raise exception 'The website application date cannot be after today — আবেদনের তারিখ আজকের পরে হতে পারে না' using errcode = '22023';
    end if;
    if p_site_date < p_date - 62 then
      raise exception 'The website application date is more than 62 days before the absent date — আবেদনের তারিখ অনুপস্থিতির ৬২ দিনের বেশি আগে' using errcode = '22023';
    end if;
    v_sdate := p_site_date;
  end if;
  for v_i in 1..3 loop
    select * into m from public.attendance_self_marks x where x.employee_id = e.id and x.work_date = p_date for update;
    if m.id is null then
      if exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = p_date) then
        raise exception 'This date is already on the register — এই তারিখের হাজিরা আগেই খাতায় উঠেছে' using errcode = '23505';
      end if;
      perform set_config('app.wf_path', 'book', true);
      insert into public.attendance_self_marks (employee_id, hub_id, work_date, kind, note, applied_on_site, site_applied_on, site_ref, via)
      values (e.id, e.hub_id, p_date, p_kind, v_note, v_site, v_sdate, v_sref, 'book')
      on conflict (employee_id, work_date) do nothing returning id into v_id;
      perform set_config('app.wf_path', '', true);
      if v_id is not null then v_action := 'new'; exit; end if;
      -- somebody wrote the date between the look and the insert: look again
    else
      if m.status = 'approved' then
        raise exception 'This date is already approved — only the manager can correct it (আগেই অনুমোদিত)' using errcode = '23505';
      end if;
      if exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = p_date) then
        raise exception 'This date is already on the register — এই তারিখের হাজিরা আগেই খাতায় উঠেছে' using errcode = '23505';
      end if;
      if m.status = 'waiting' and m.application_id is not null then
        raise exception 'This date is already in an application — withdraw the application first (এই তারিখ আবেদনে আছে)' using errcode = '23505';
      end if;
      if m.status = 'waiting' and m.kind = p_kind and m.note is not distinct from v_note and m.applied_on_site is not distinct from v_site
         and m.site_applied_on is not distinct from v_sdate and m.site_ref is not distinct from v_sref then
        v_id := m.id; exit;   -- nothing changed: the same answer twice is not a second input
      end if;
      perform set_config('app.wf_path', 'book', true);
      update public.attendance_self_marks set kind = p_kind, note = v_note, applied_on_site = v_site, site_applied_on = v_sdate, site_ref = v_sref, hub_id = e.hub_id, via = 'book', marked_at = now(),
             status = 'waiting', decided_as = null, decided_by = null, decided_at = null, decide_note = null, application_id = null, attendance_id = null
       where id = m.id;
      perform set_config('app.wf_path', '', true);
      v_id := m.id;
      v_action := case when m.status = 'rejected' then 'resubmitted' else 'edited' end;
      exit;
    end if;
  end loop;
  if v_id is null then raise exception 'Could not save, please try again — আবার চেষ্টা করুন' using errcode = '40001'; end if;
  -- today's date tells the hub's managers (like the one-tap path); older dates wait in the queue and in the daily reminder
  if p_date = v_today and v_action in ('new', 'resubmitted') and e.hub_id is not null then
    perform private.att_notify_hub(e.hub_id,
      case p_kind when 'present' then 'হাজিরা অনুমোদন বাকি' else 'আজ আসেননি — অনুমোদন বাকি' end,
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || case p_kind when 'present' then ' · হাজিরা দিয়েছেন' else ' · ওয়েবসাইটে আবেদন করা আছে (নম্বর ' || v_sref || ')' end,
      '/app/workforce/hub');
  end if;
  return v_id;
end $$;


-- The approval queue / list of staff inputs (rows of attendance_self_marks). Decide them with att_self_decide (unchanged).
create or replace function public.wf_marks(p_zone uuid default null, p_hub uuid default null, p_from date default null, p_to date default null,
  p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', private.wf_today())::date); v_to date := coalesce(p_to, private.wf_today());
  v_hubs uuid[]; v_nohub boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('waiting', 'approved', 'rejected') then raise exception 'Unknown status' using errcode = '22023'; end if;
  v_hubs := array(select w.hub_id from private.wf_hubs('hr.attendance.view', p_zone, p_hub) w);
  v_nohub := p_hub is null and p_zone is null and private.has_permission('hr.attendance.view');
  return coalesce((
    select jsonb_agg(q.j order by q.rn) from (
      select jsonb_build_object(
          'id', m.id, 'employee_id', m.employee_id, 'employee_code', e.employee_code::text, 'full_name', e.full_name,
          'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
          'hub_id', m.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = m.hub_id), 'zone_id', m.zone_id,
          'work_date', m.work_date, 'kind', m.kind, 'applied_on_site', m.applied_on_site,
          'site_applied_on', m.site_applied_on, 'site_ref', m.site_ref, 'note', m.note, 'status', m.status, 'via', m.via,
          'marked_at', m.marked_at, 'decided_as', m.decided_as, 'decide_note', m.decide_note, 'decided_at', m.decided_at,
          'decided_by_name', (select p.full_name from public.profiles p where p.id = m.decided_by),
          'application_id', m.application_id, 'application_no', a.application_no,
          'record_status', (select r.status from public.attendance_records r where r.employee_id = m.employee_id and r.work_date = m.work_date)) as j,
        row_number() over (order by (m.status = 'waiting') desc, m.work_date desc, e.full_name) as rn
      from public.attendance_self_marks m
      join public.employees e on e.id = m.employee_id
      left join public.wf_absence_applications a on a.id = m.application_id
      where m.work_date between v_from and v_to and (p_status is null or m.status = p_status)
        and not (m.status = 'rejected' and coalesce(a.status, '') = 'cancelled')          -- a withdrawn application is not the manager's business
        and e.archived_at is null and (e.hub_id = any (v_hubs) or (v_nohub and e.hub_id is null))
      order by (m.status = 'waiting') desc, m.work_date desc, e.full_name
      limit 3000) q), '[]'::jsonb);
end $$;


create or replace function public.wf_my_book(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees; v_today date := private.wf_today(); v_from integer := private.wf_from_day(); v_to integer := private.wf_to_day();
  v_month date; v_last integer; v_open boolean; v_d1 date; v_d2 date; v_days jsonb; v_codes text[]; v_apps jsonb; v_months jsonb;
  v_zone uuid; v_win jsonb; v_openm jsonb;
begin
  if auth.uid() is null then return null; end if;
  e := private.wf_me();
  if e.id is null then return null; end if;
  v_zone := private.wf_zone_of(e.hub_id, e.zone_id);
  v_month := date_trunc('month', coalesce(p_month, v_today))::date;
  v_last := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_win := private.wf_live_window(v_zone, v_month);
  v_open := (v_month = date_trunc('month', v_today)::date and extract(day from v_today)::integer between v_from and v_to) or v_win is not null;
  v_d1 := v_month + (least(v_from, v_last) - 1);
  v_d2 := v_month + (least(v_to, v_last) - 1);
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', g.work_date, 'day', extract(day from g.work_date)::integer, 'dow', extract(dow from g.work_date)::integer, 'state', g.state,
           'kind', g.kind, 'applied_on_site', g.applied_on_site,
           'site_applied_on', x.site_applied_on, 'site_ref', x.site_ref, 'note', g.note, 'mark_id', g.mark_id,
           'decided_as', g.decided_as, 'decide_note', g.decide_note, 'decided_by_name', g.decided_by_name, 'record_status', g.record_status,
           'application_id', g.application_id, 'application_no', g.application_no, 'application_status', g.application_status,
           'can_give', private.wf_date_open(v_zone, g.work_date) and (e.joining_date is null or g.work_date >= e.joining_date)) order by g.work_date), '[]'::jsonb),
         coalesce(array_agg(private.wf_cell(g.state, g.record_status) order by g.work_date), '{}'::text[])
    into v_days, v_codes
    from private.wf_grid(v_d1, v_d2, null, e.id) g
    left join public.attendance_self_marks x on x.id = g.mark_id;
  select coalesce(jsonb_agg(private.wf_app_json(a) order by a.created_at desc, a.application_no desc), '[]'::jsonb) into v_apps
    from public.wf_absence_applications a where a.employee_id = e.id and a.month = v_month;
  select coalesce(jsonb_agg(m.mm order by m.mm desc), '[]'::jsonb) into v_months from (
    select date_trunc('month', v_today)::date as mm
    union select date_trunc('month', x.work_date)::date from public.attendance_self_marks x where x.employee_id = e.id
    union select date_trunc('month', r.work_date)::date from public.attendance_records r where r.employee_id = e.id
    union select a.month from public.wf_absence_applications a where a.employee_id = e.id
    union select w.month from public.wf_book_windows w where w.zone_id = v_zone and w.ended_at is null and w.open_until >= v_today) m;
  -- the months in which something can be given right now (this month while its book is open, and every open window)
  select coalesce(jsonb_agg(m.mm order by m.mm desc), '[]'::jsonb) into v_openm from (
    select date_trunc('month', v_today)::date as mm where private.wf_open()
    union select w.month from public.wf_book_windows w where w.zone_id = v_zone and w.ended_at is null and w.open_until >= v_today) m;
  return jsonb_build_object(
    'employee', jsonb_build_object('id', e.id, 'code', e.employee_code::text, 'name', e.full_name,
       'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
       'hub_id', e.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = e.hub_id),
       'zone_id', coalesce(e.zone_id, private.hub_zone(e.hub_id)),
       'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = coalesce(e.zone_id, private.hub_zone(e.hub_id)))),
    'month', v_month, 'today', v_today, 'window', jsonb_build_object('from_day', v_from, 'to_day', v_to), 'open', v_open,
    'catch_up', v_win, 'open_months', v_openm,
    'days', v_days, 'summary', private.wf_summary(v_codes), 'applications', v_apps, 'months', v_months);
end $$;


create or replace function public.wf_book_fill(p_present date[] default null, p_site jsonb default null, p_absent date[] default null,
                                               p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_p date[]; v_s date[]; v_a date[]; v_all date[]; d date; v_app uuid; v_older integer;
  g jsonb; v_gd date[]; v_gon date; v_raw text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  e := private.wf_me();
  if e.id is null then raise exception 'No active staff profile is linked to your login — আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wf:' || e.id::text, 0));   -- the same lock as the one-date path (re-entrant here)
  select coalesce(array_agg(distinct x order by x), '{}') into v_p from unnest(coalesce(p_present, '{}'::date[])) x where x is not null;
  if p_site is not null and jsonb_typeof(p_site) <> 'array' then
    raise exception 'Website applications must be a list — ওয়েবসাইটের আবেদনগুলো তালিকা আকারে দিন' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_site, '[]')) > 62 then
    raise exception 'Too many website applications at once (at most 62) — একসাথে সর্বোচ্চ ৬২টি আবেদন' using errcode = '22023';
  end if;
  -- every website application: its number, its date and at least one absent date (checked again per date by wf_att_submit)
  for g in select * from jsonb_array_elements(coalesce(p_site, '[]')) loop
    if jsonb_typeof(g) <> 'object' or jsonb_typeof(g -> 'dates') is distinct from 'array' or jsonb_array_length(g -> 'dates') = 0 then
      raise exception 'Each website application needs its absent dates — প্রতিটি আবেদনের অনুপস্থিত তারিখ বাছুন' using errcode = '22023';
    end if;
    if private.wf_clean(g ->> 'ref', 200) is null then
      raise exception 'Write the website application number — ওয়েবসাইটের আবেদন নম্বর লিখুন' using errcode = '22023';
    end if;
    if nullif(trim(coalesce(g ->> 'applied_on', '')), '') is null then
      raise exception 'Give the date you applied on the website — ওয়েবসাইটে কোন তারিখে আবেদন করেছেন দিন' using errcode = '22023';
    end if;
  end loop;
  begin
    select coalesce(array_agg(x.v::date order by x.v::date), '{}') into v_s
      from jsonb_array_elements(coalesce(p_site, '[]')) gg, jsonb_array_elements_text(gg -> 'dates') x(v) where x.v is not null;
    perform (gg ->> 'applied_on')::date from jsonb_array_elements(coalesce(p_site, '[]')) gg;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'A website application date is not a date — তারিখ ঠিক নেই' using errcode = '22023';
  end;
  select coalesce(array_agg(distinct x order by x), '{}') into v_a from unnest(coalesce(p_absent, '{}'::date[])) x where x is not null;
  v_all := v_p || v_s || v_a;
  if cardinality(v_all) = 0 then raise exception 'Choose at least one date — অন্তত একটি তারিখ বাছুন' using errcode = '22023'; end if;
  if cardinality(v_all) > 62 then raise exception 'Too many dates at once (at most 62) — একসাথে সর্বোচ্চ ৬২টি তারিখ' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(v_all) x) <> cardinality(v_all) then
    raise exception 'A date is chosen twice — একই তারিখ দুই জায়গায় বাছা হয়েছে' using errcode = '22023';
  end if;
  if cardinality(v_a) > 0 and private.wf_clean(p_reason) is null then
    raise exception 'Write the reason for the absence (reason is required) — কারণ লিখুন' using errcode = '22023';
  end if;
  begin
    foreach d in array v_p loop perform public.wf_att_submit(d, 'present'); end loop;
    for g in select * from jsonb_array_elements(coalesce(p_site, '[]')) loop
      v_gon := (g ->> 'applied_on')::date;
      for d in select distinct x.v::date from jsonb_array_elements_text(g -> 'dates') x(v) where x.v is not null order by 1 loop
        perform public.wf_att_submit(d, 'absent', true, p_note, v_gon, g ->> 'ref');
      end loop;
    end loop;
    d := null;
    if cardinality(v_a) > 0 then v_app := public.wf_absence_apply(v_a, p_reason); end if;
  exception when others then
    if d is null then raise; end if;
    raise exception 'On %: %', d, sqlerrm using errcode = sqlstate;
  end;
  -- one note to the hub's managers for older dates (today's date already told them, and an application tells them itself)
  v_older := (select count(*) from unnest(v_p || v_s) x where x < private.wf_today());
  if v_older > 0 and e.hub_id is not null then
    perform private.att_notify_hub(e.hub_id, 'আগের তারিখের হাজিরা অনুমোদন বাকি',
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || ' · ' || v_older || ' দিনের হাজিরা একসাথে দিয়েছেন', '/app/workforce/hub');
  end if;
  return jsonb_build_object('present', cardinality(v_p), 'site', cardinality(v_s), 'absent', cardinality(v_a), 'application_id', v_app);
end $$;

-- Who may call what (same rule as the module): public wf_* for signed-in people and the service role; private helpers for the functions only.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, n.nspname as ns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.proname like 'wf\_%' loop
    if f.ns = 'public' then
      execute format('revoke all on function %s from public, anon', f.sig);
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
