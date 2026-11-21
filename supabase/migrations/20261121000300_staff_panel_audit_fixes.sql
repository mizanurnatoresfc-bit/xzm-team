-- =====================================================================
--  স্টাফ প্যানেল অডিট (২১ নভেম্বর ২০২৬) — database fixes.
--  1. att_self_decide: approving a staff member's own mark when the day is already on the register as
--     leave / holiday / weekly off no longer fails (decided_as only takes the four attendance words) and
--     never overwrites such a day; an edit right only changes a present / late / half day / absent day.
--  2. att_self_mark: the reason is capped at 500 characters, and managers are notified only for a new
--     mark, a change between "present" and "not coming", or a mark given again after it was returned —
--     not every time the same waiting mark is sent again.
--  3. staff_panel_sections: when any of the person's active roles is on the standard page (nothing set),
--     the whole standard page shows; archived / inactive roles do not shape the layout; Dhaka date.
--  4. my_profile_gaps(): the caller's own profile check only (the staff panel used to fetch everyone's).
--  5. in_zone_group / zone_contacts: only an ACTIVE employee record counts as being in a zone, so
--     someone who left keeps no access to the zone group or the zonal managers' phone numbers.
-- =====================================================================

-- 1 -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.att_self_decide(p_ids uuid[], p_ok boolean, p_as text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.attendance_self_marks; v_as text; v_rec uuid; v_n integer := 0; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_word text; v_prof uuid; v_old text; v_dnote text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not p_ok and v_note is null then raise exception 'Write why it is turned down' using errcode = '22023'; end if;
  if p_as is not null and p_as not in ('present','late','half_day','absent') then raise exception 'Unknown attendance status' using errcode = '22023'; end if;
  for m in select * from public.attendance_self_marks x where x.id = any(coalesce(p_ids, '{}')) and x.status = 'waiting' for update loop
    if not private.employee_has_permission('hr.attendance.create', m.employee_id) then
      raise exception 'You may not approve attendance for this person' using errcode = '42501';
    end if;
    if exists (select 1 from public.employees e where e.id = m.employee_id and e.profile_id = auth.uid()) then
      raise exception 'Your own attendance is approved by another manager' using errcode = '42501';
    end if;
    if p_ok then
      v_as := coalesce(p_as, case m.kind when 'present' then 'present' else 'absent' end);
      v_old := null; v_dnote := v_note;
      select a.id, a.status into v_rec, v_old from public.attendance_records a where a.employee_id = m.employee_id and a.work_date = m.work_date;
      if v_rec is null then
        insert into public.attendance_records (employee_id, work_date, status, check_in, source, note)
        values (m.employee_id, m.work_date, v_as, case when v_as = 'absent' then null else m.marked_at end, 'self',
                coalesce(m.note, 'নিজে দিয়েছেন'))
        returning id into v_rec;
      elsif v_old in ('present','late','half_day','absent') and private.employee_has_permission('hr.attendance.edit', m.employee_id) then
        update public.attendance_records set status = v_as, check_in = case when v_as = 'absent' then null else m.marked_at end,
               source = 'self', note = coalesce(m.note, note) where id = v_rec;
      else
        -- Already on the register and not ours to change (leave, holiday, weekly off, or no edit right): leave the register as it is.
        -- decided_as only takes the four attendance words, so a leave / holiday day is recorded as approved with decided_as empty.
        v_as := case when v_old in ('present','late','half_day','absent') then v_old end;
        v_dnote := coalesce(v_note, 'খাতায় আগেই ছিল — বদলানো হয়নি');
      end if;
      update public.attendance_self_marks set status = 'approved', decided_as = v_as, decided_by = auth.uid(), decided_at = now(),
             decide_note = v_dnote, attendance_id = v_rec where id = m.id;
      v_word := case coalesce(v_as, v_old) when 'present' then 'উপস্থিত' when 'late' then 'দেরিতে' when 'half_day' then 'অর্ধদিবস'
                  when 'leave' then 'ছুটিতে' when 'holiday' then 'সরকারি ছুটি' when 'weekly_off' then 'সাপ্তাহিক ছুটি' else 'অনুপস্থিত' end;
    else
      update public.attendance_self_marks set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decide_note = v_note where id = m.id;
    end if;
    select e.profile_id into v_prof from public.employees e where e.id = m.employee_id;
    perform private.notify(v_prof,
      case when p_ok then 'হাজিরা অনুমোদিত: ' || v_word else 'হাজিরা ফেরত দেওয়া হয়েছে' end,
      case when p_ok then coalesce('মন্তব্য: ' || v_dnote, private.my_display_name() || ' অনুমোদন দিয়েছেন') else 'কারণ: ' || v_note end,
      '/app/staff', 'attendance');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$
;

-- 2 -------------------------------------------------------------------
create or replace function public.att_self_mark(p_kind text, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees; v_day date := (now() at time zone 'Asia/Dhaka')::date; v_id uuid; v_old public.attendance_self_marks;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into e from public.employees x where x.profile_id = auth.uid() and x.archived_at is null and x.status = 'active' limit 1;
  if e.id is null then raise exception 'No active staff profile is linked to your login' using errcode = '42501'; end if;
  if p_kind not in ('present','absent') then raise exception 'Unknown attendance kind' using errcode = '22023'; end if;
  if p_kind = 'absent' and v_note is null then raise exception 'Write the reason for not coming' using errcode = '22023'; end if;
  if length(v_note) > 500 then raise exception 'Keep the reason within 500 characters — কারণ ৫০০ অক্ষরের মধ্যে লিখুন' using errcode = '22023'; end if;
  if exists (select 1 from public.attendance_records a where a.employee_id = e.id and a.work_date = v_day) then
    raise exception 'Today''s attendance is already on the register' using errcode = '23505';
  end if;
  select * into v_old from public.attendance_self_marks m where m.employee_id = e.id and m.work_date = v_day;
  if v_old.id is not null and v_old.status = 'approved' then
    raise exception 'Today''s attendance is already approved' using errcode = '23505';
  end if;
  insert into public.attendance_self_marks (employee_id, hub_id, work_date, kind, note)
  values (e.id, e.hub_id, v_day, p_kind, v_note)
  on conflict (employee_id, work_date) do update
     set kind = excluded.kind, note = excluded.note, hub_id = excluded.hub_id, marked_at = now(), status = 'waiting',
         decided_as = null, decided_by = null, decided_at = null, decide_note = null
  returning id into v_id;
  -- the managers already have this one waiting: sending the same kind again does not page them again
  if e.hub_id is not null and (v_old.id is null or v_old.status <> 'waiting' or v_old.kind <> p_kind
                               or v_old.hub_id is distinct from e.hub_id) then
    perform private.att_notify_hub(e.hub_id,
      case p_kind when 'present' then 'হাজিরা অনুমোদন বাকি' else 'আজ আসবেন না — অনুমোদন বাকি' end,
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || case p_kind when 'present'
        then ' · হাবে এসেছেন ' || to_char(now() at time zone 'Asia/Dhaka', 'HH12:MI AM') else ' · কারণ: ' || v_note end,
      '/app/hub/attendance');
  end if;
  return v_id;
end $$;

-- 3 -------------------------------------------------------------------
create or replace function public.staff_panel_sections()
returns jsonb
language sql stable security definer set search_path = '' as $$
  with mine as (
    select ur.role_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    where ur.user_id = auth.uid() and ur.revoked_at is null
      and ur.valid_from <= private.da_today() and (ur.valid_to is null or ur.valid_to >= private.da_today())
  )
  select case
    -- any active role left on the standard page (no row, or nothing set) gives the whole standard page
    when not exists (select 1 from mine)
      or exists (select 1 from mine m left join public.role_dashboards rd on rd.role_id = m.role_id
                 where rd.staff_sections is null or jsonb_array_length(rd.staff_sections) = 0)
    then null
    else (
      -- ties (two roles both put something first) follow the standard page order
      select jsonb_agg(s order by pos, array_position(array['accounts','work','attendance','bill','route','complaint','issues','people'], s))
      from (
        select x.s, min(x.pos) pos
        from mine m
        join public.role_dashboards rd on rd.role_id = m.role_id
        cross join lateral jsonb_array_elements_text(rd.staff_sections) with ordinality x(s, pos)
        where private.staff_section_ok(x.s)
        group by x.s
      ) t)
  end
$$;

-- 4 -------------------------------------------------------------------
create or replace function public.my_profile_gaps()
returns table (employee_id uuid, employee_code text, full_name text, status text, hub_id uuid, hub_name text,
               position_name text, position_name_bn text, missing text[], total_checks integer)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.status, e.hub_id, h.name, p.name, p.name_bn,
         private.hr_id_gaps(e.id), private.hr_id_check_count()
  from public.employees e
  left join public.hubs h on h.id = e.hub_id
  left join public.positions p on p.id = e.position_id
  where e.id = private.my_employee_id() and e.archived_at is null and e.status in ('active', 'applicant')
$$;
revoke all on function public.my_profile_gaps() from public, anon;
grant execute on function public.my_profile_gaps() to authenticated;

-- 5 -------------------------------------------------------------------
create or replace function private.in_zone_group(p_zone uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_zone is not null and (
    exists (select 1 from public.employees e left join public.hubs h on h.id = e.hub_id
            where e.profile_id = auth.uid() and e.archived_at is null and e.status = 'active' and coalesce(e.zone_id, h.zone_id) = p_zone)
    or private.has_permission_within_zone('issue.group.view', p_zone)
    or private.has_permission_within_zone('issue.issue.view', p_zone)
    or private.has_permission_within_zone('issue.issue.create', p_zone))
$$;

create or replace function public.zone_contacts(p_zone uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := p_zone; z public.zones;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_zone is null then
    select coalesce(e.zone_id, h.zone_id) into v_zone from public.employees e left join public.hubs h on h.id = e.hub_id
    where e.profile_id = auth.uid() and e.archived_at is null and e.status = 'active'
    order by e.created_at desc limit 1;
    if v_zone is null then return null; end if;            -- no staff record: nothing to show
  end if;
  if not private.in_zone_group(v_zone) then raise exception 'এই জোনের তথ্য দেখার অনুমতি নেই' using errcode = '42501'; end if;
  select * into z from public.zones where id = v_zone;
  return jsonb_build_object('zone_id', z.id, 'zone_name', z.name, 'zone_code', z.code::text,
    'managers', coalesce((select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'full_name', m.full_name, 'employee_code', m.employee_code,
                    'position', m.post_name, 'phone', m.phone, 'has_login', m.profile_id is not null, 'is_me', m.profile_id = auth.uid()) order by m.full_name)
                  from private.zone_manager_people(v_zone) m), '[]'::jsonb),
    'sent_today', (select count(*)::int from public.zone_manager_notes n where n.from_profile = auth.uid() and n.created_at > now() - interval '24 hours'));
end $$;
