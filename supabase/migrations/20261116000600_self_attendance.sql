-- XZM-TEAM ERP — staff give their own attendance; the hub manager approves it.
--
-- The owner's rule: whatever a staff member puts in counts only once a manager approves it.
--   * A staff member taps "হাবে এসেছি" (present) or "আজ আসব না" (absent, with a reason) for today.
--     No location check: the input is enough, the manager's approval is the check.
--   * It waits in attendance_self_marks. Nothing is written to attendance_records yet.
--   * A manager who may mark attendance for that person approves it (as present, late or absent)
--     or turns it down with a reason. Approval writes the day's attendance row (source 'self').
--   * The staff member is told either way; the hub's managers are told when a mark comes in.

alter table public.attendance_records drop constraint if exists attendance_records_source_check;
alter table public.attendance_records add constraint attendance_records_source_check
  check (source in ('manual','kiosk','import','leave','self'));

create table public.attendance_self_marks (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id),
  hub_id        uuid references public.hubs(id),
  work_date     date not null,
  kind          text not null check (kind in ('present','absent')),
  note          text,
  marked_at     timestamptz not null default now(),
  status        text not null default 'waiting' check (status in ('waiting','approved','rejected')),
  decided_as    text check (decided_as in ('present','late','half_day','absent')),
  decided_by    uuid,
  decided_at    timestamptz,
  decide_note   text,
  attendance_id uuid references public.attendance_records(id),
  unique (employee_id, work_date),
  constraint att_self_absent_reason check (kind <> 'absent' or length(trim(coalesce(note, ''))) > 0),
  constraint att_self_reject_reason check (status <> 'rejected' or length(trim(coalesce(decide_note, ''))) > 0)
);
create index att_self_hub_day_idx on public.attendance_self_marks (hub_id, work_date, status);
create index att_self_attendance_idx on public.attendance_self_marks (attendance_id);
create trigger att_self_audit after insert or update or delete on public.attendance_self_marks
  for each row execute function private.audit_row('hr');
create trigger att_self_no_delete before delete on public.attendance_self_marks
  for each row execute function private.prevent_delete();

alter table public.attendance_self_marks enable row level security;
revoke all on public.attendance_self_marks from anon;
-- Read only; every write goes through the functions below.
create policy att_self_read on public.attendance_self_marks for select to authenticated
  using (private.is_self_employee(employee_id) or private.employee_has_permission('hr.attendance.view', employee_id)
         or private.employee_has_permission('hr.attendance.create', employee_id));
grant select on public.attendance_self_marks to authenticated;

-- ---------------------------------------------------------------------
-- Tell everyone who may mark attendance in a hub.
create or replace function private.att_notify_hub(p_hub uuid, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; u uuid;
begin
  select h.zone_id into v_zone from public.hubs h where h.id = p_hub;
  for u in
    select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
    join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
    where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
      and p.code = 'hr.attendance.create'   -- the hub's own managers; a Super Admin is not paged for every arrival
      and ((ur.scope_type = 'hub' and ur.hub_id = p_hub) or (ur.scope_type = 'zone' and ur.zone_id = v_zone))
  loop
    perform private.notify(u, p_title, p_body, p_link, 'attendance');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- The staff member: today's own mark, and giving it.
create or replace function public.my_att_today() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid; v_day date := (now() at time zone 'Asia/Dhaka')::date;
begin
  select e.id into v_emp from public.employees e where e.profile_id = auth.uid() and e.archived_at is null and auth.uid() is not null
   order by (e.status = 'active') desc limit 1;
  if v_emp is null then return null; end if;
  return jsonb_build_object(
    'work_date', v_day,
    'record', (select jsonb_build_object('status', a.status, 'check_in', a.check_in, 'source', a.source)
                 from public.attendance_records a where a.employee_id = v_emp and a.work_date = v_day),
    'mark', (select jsonb_build_object('id', m.id, 'kind', m.kind, 'note', m.note, 'marked_at', m.marked_at, 'status', m.status,
                                       'decided_as', m.decided_as, 'decide_note', m.decide_note, 'decided_at', m.decided_at,
                                       'decided_by_name', (select p.full_name from public.profiles p where p.id = m.decided_by))
               from public.attendance_self_marks m where m.employee_id = v_emp and m.work_date = v_day));
end $$;

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
  if e.hub_id is not null then
    perform private.att_notify_hub(e.hub_id,
      case p_kind when 'present' then 'হাজিরা অনুমোদন বাকি' else 'আজ আসবেন না — অনুমোদন বাকি' end,
      e.full_name || coalesce(' (' || e.employee_code || ')', '') || case p_kind when 'present'
        then ' · হাবে এসেছেন ' || to_char(now() at time zone 'Asia/Dhaka', 'HH12:MI AM') else ' · কারণ: ' || v_note end,
      '/app/hub/attendance');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- The manager: what waits in a hub on a day, and the decision.
create or replace function public.att_self_list(p_hub uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'employee_id', m.employee_id, 'employee_code', e.employee_code, 'full_name', e.full_name,
           'kind', m.kind, 'note', m.note, 'marked_at', m.marked_at, 'status', m.status, 'decided_as', m.decided_as,
           'decide_note', m.decide_note, 'decided_at', m.decided_at,
           'decided_by_name', (select p.full_name from public.profiles p where p.id = m.decided_by))
         order by (m.status = 'waiting') desc, m.marked_at), '[]'::jsonb)
  from public.attendance_self_marks m join public.employees e on e.id = m.employee_id
  where m.hub_id = p_hub and m.work_date = p_date
    and (private.employee_has_permission('hr.attendance.create', m.employee_id)
         or private.employee_has_permission('hr.attendance.view', m.employee_id))
$$;

create or replace function public.att_self_decide(p_ids uuid[], p_ok boolean, p_as text default null, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m public.attendance_self_marks; v_as text; v_rec uuid; v_n integer := 0; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_word text; v_prof uuid;
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
      select a.id into v_rec from public.attendance_records a where a.employee_id = m.employee_id and a.work_date = m.work_date;
      if v_rec is null then
        insert into public.attendance_records (employee_id, work_date, status, check_in, source, note)
        values (m.employee_id, m.work_date, v_as, case when v_as = 'absent' then null else m.marked_at end, 'self',
                coalesce(m.note, 'নিজে দিয়েছেন'))
        returning id into v_rec;
      elsif private.employee_has_permission('hr.attendance.edit', m.employee_id) then
        update public.attendance_records set status = v_as, check_in = case when v_as = 'absent' then null else m.marked_at end,
               source = 'self', note = coalesce(m.note, note) where id = v_rec;
      else
        -- the day was already marked by hand; that stays, and the staff member's input is closed with it
        select a.status into v_as from public.attendance_records a where a.id = v_rec;
      end if;
      update public.attendance_self_marks set status = 'approved', decided_as = v_as, decided_by = auth.uid(), decided_at = now(),
             decide_note = v_note, attendance_id = v_rec where id = m.id;
      v_word := case v_as when 'present' then 'উপস্থিত' when 'late' then 'দেরিতে' when 'half_day' then 'অর্ধদিবস' else 'অনুপস্থিত' end;
    else
      update public.attendance_self_marks set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decide_note = v_note where id = m.id;
    end if;
    select e.profile_id into v_prof from public.employees e where e.id = m.employee_id;
    perform private.notify(v_prof,
      case when p_ok then 'হাজিরা অনুমোদিত: ' || v_word else 'হাজিরা ফেরত দেওয়া হয়েছে' end,
      case when p_ok then coalesce('মন্তব্য: ' || v_note, private.my_display_name() || ' অনুমোদন দিয়েছেন') else 'কারণ: ' || v_note end,
      '/app/staff', 'attendance');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function private.att_notify_hub(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.my_att_today(), public.att_self_mark(text, text), public.att_self_list(uuid, date),
  public.att_self_decide(uuid[], boolean, text, text) from public, anon;
grant execute on function public.my_att_today(), public.att_self_mark(text, text), public.att_self_list(uuid, date),
  public.att_self_decide(uuid[], boolean, text, text) to authenticated;
