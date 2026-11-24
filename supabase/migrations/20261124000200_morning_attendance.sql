-- Morning headcount feeds route planning. It never writes the final attendance book.
begin;

insert into public.permissions (code, module, resource, action, description) values
  ('hr.morning_attendance.create', 'hr', 'morning_attendance', 'create', 'Submit the morning headcount for an assigned hub'),
  ('hr.morning_attendance.approve', 'hr', 'morning_attendance', 'approve', 'Read and return submitted morning headcounts')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on
  (p.code = 'hr.morning_attendance.create' and r.code in ('hub_manager', 'admin'))
  or (p.code = 'hr.morning_attendance.approve' and r.code in ('zonal_manager', 'admin'))
on conflict do nothing;

create table private.wf_morning_rounds (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  revision integer not null check (revision > 0),
  marks jsonb not null default '{}'::jsonb check (jsonb_typeof(marks) = 'object'),
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id),
  returned_at timestamptz,
  returned_by uuid references public.profiles(id),
  return_note text,
  primary key (hub_id, work_date, revision),
  check ((submitted_at is null) = (submitted_by is null)),
  check ((returned_at is null) = (returned_by is null)),
  check ((returned_at is null) = (return_note is null))
);
alter table private.wf_morning_rounds enable row level security;
revoke all on private.wf_morning_rounds from public, anon, authenticated, service_role;

-- Approved HR leave and the canonical register are authoritative for this field.
-- Workforce absence explanations do not alone make a date approved leave.
create function private.wf_morning_roster(p_hub uuid, p_date date)
returns table (id uuid, full_name text, on_leave boolean)
language sql stable set search_path = '' as $$
  select e.id, e.full_name::text,
    exists (select 1 from public.attendance_records r
      where r.employee_id = e.id and r.work_date = p_date and r.status = 'leave')
    or exists (select 1 from public.leave_requests l
      where l.employee_id = e.id and l.status = 'approved'
        and p_date between l.from_date and l.to_date)
  from public.employees e
  where e.hub_id = p_hub and e.status = 'active' and e.archived_at is null
    and (e.joining_date is null or e.joining_date <= p_date)
$$;

create function private.wf_morning_zone(p_hub uuid)
returns uuid language sql stable set search_path = '' as $$
  select h.zone_id from public.hubs h
  where h.id = p_hub and h.status = 'active' and h.archived_at is null
$$;

create function private.wf_morning_lock(p_hub uuid, p_date date)
returns void language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wf_morning_rounds:' || p_hub::text || ':' || (p_date - date '2000-01-01')::text, 0))
$$;

create function public.wf_morning_get(p_hub uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  d date := coalesce(p_date, private.wf_today());
  z uuid := private.wf_morning_zone(p_hub);
  is_writer boolean := private.has_permission('hr.morning_attendance.create', z, p_hub);
  is_reviewer boolean := private.has_permission('hr.morning_attendance.approve', z, p_hub);
  r private.wf_morning_rounds;
  people jsonb;
begin
  if auth.uid() is null or z is null or not (is_writer or is_reviewer) then
    raise exception 'Morning headcount is outside your hub scope' using errcode = '42501';
  end if;
  if not isfinite(d) or d > private.wf_today() then
    raise exception 'Choose today or an earlier date' using errcode = '22023';
  end if;

  select * into r from private.wf_morning_rounds
    where hub_id = p_hub and work_date = d order by revision desc limit 1;

  if r.submitted_at is not null and is_reviewer then
    select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'status', m.value)
      order by e.full_name, e.id), '[]'::jsonb) into people
    from jsonb_each_text(r.marks) m join public.employees e on e.id = m.key::uuid;
  elsif r.submitted_at is null and is_writer and d = private.wf_today() then
    select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name,
        'status', case when e.on_leave then 'leave' else coalesce(nullif(r.marks ->> e.id::text, 'leave'), 'unknown') end)
      order by e.full_name, e.id), '[]'::jsonb) into people
    from private.wf_morning_roster(p_hub, d) e;
  end if;

  return jsonb_build_object('hub_id', p_hub, 'work_date', d,
    'revision', coalesce(r.revision, 1),
    'status', case when r.submitted_at is not null then 'submitted'
      when r.returned_at is not null then 'returned'
      when r.revision is null and not is_writer then 'waiting' else 'draft' end,
    'submitted_at', r.submitted_at, 'return_note', r.return_note,
    'can_edit', is_writer and r.submitted_at is null and d = private.wf_today(),
    'can_return', is_reviewer and r.submitted_at is not null and d = private.wf_today(),
    'people', people);
end $$;

-- Updates are patches keyed by employee UUID. A retry with an empty patch can
-- check the same submission receipt. A stale revision cannot change the next round.
create function public.wf_morning_save(
  p_hub uuid, p_date date, p_revision integer, p_marks jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  z uuid := private.wf_morning_zone(p_hub);
  r private.wf_morning_rounds;
  v_marks jsonb;
begin
  if auth.uid() is null or z is null or not private.has_permission('hr.morning_attendance.create', z, p_hub) then
    raise exception 'You may not write this hub''s morning headcount' using errcode = '42501';
  end if;
  if p_date is distinct from private.wf_today() or p_revision is null or p_revision < 1
      or jsonb_typeof(p_marks) is distinct from 'object' or p_submit is null then
    raise exception 'Provide today, a revision, and an employee status object' using errcode = '22023';
  end if;

  perform private.wf_morning_lock(p_hub, p_date);
  select * into r from private.wf_morning_rounds
    where hub_id = p_hub and work_date = p_date order by revision desc limit 1;
  if coalesce(r.revision, 1) <> p_revision then
    raise exception 'Morning headcount revision changed. Reload before saving' using errcode = 'P0001';
  end if;
  if r.submitted_at is not null then
    if p_submit and p_marks = '{}'::jsonb then
      return public.wf_morning_get(p_hub, p_date);
    end if;
    raise exception 'Morning headcount is submitted and locked' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_each_text(p_marks) m
    left join private.wf_morning_roster(p_hub, p_date) e on m.key = e.id::text
    where e.id is null or coalesce(m.value, '') not in ('present', 'absent', 'unknown')
  ) then
    raise exception 'Use roster employee IDs and present, absent or unknown' using errcode = '22023';
  end if;

  v_marks := coalesce(r.marks, '{}'::jsonb) || p_marks;
  if p_submit then
    select coalesce(jsonb_object_agg(e.id::text, case when e.on_leave then 'leave'
      else coalesce(nullif(v_marks ->> e.id::text, 'leave'), 'unknown') end), '{}'::jsonb)
      into v_marks from private.wf_morning_roster(p_hub, p_date) e;
  end if;

  insert into private.wf_morning_rounds (hub_id, work_date, revision, marks, submitted_at, submitted_by)
  values (p_hub, p_date, p_revision, v_marks,
    case when p_submit then statement_timestamp() end, case when p_submit then auth.uid() end)
  on conflict (hub_id, work_date, revision) do update
  set marks = excluded.marks, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by;

  return public.wf_morning_get(p_hub, p_date);
end $$;

create function public.wf_morning_return(p_hub uuid, p_date date, p_revision integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  z uuid := private.wf_morning_zone(p_hub);
  r private.wf_morning_rounds;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or z is null or not private.has_permission('hr.morning_attendance.approve', z, p_hub) then
    raise exception 'You may not return this hub''s morning headcount' using errcode = '42501';
  end if;
  if p_date is distinct from private.wf_today() or p_revision is null or length(reason) not between 1 and 500 then
    raise exception 'Choose today and supply a revision and a return reason' using errcode = '22023';
  end if;

  perform private.wf_morning_lock(p_hub, p_date);
  select * into r from private.wf_morning_rounds
    where hub_id = p_hub and work_date = p_date order by revision desc limit 1;
  if r.revision is distinct from p_revision or r.submitted_at is null then
    raise exception 'Only the latest submitted revision can be returned' using errcode = 'P0001';
  end if;

  insert into private.wf_morning_rounds (hub_id, work_date, revision, marks, returned_at, returned_by, return_note)
  values (p_hub, p_date, r.revision + 1, r.marks, statement_timestamp(), auth.uid(), reason);

  return public.wf_morning_get(p_hub, p_date);
end $$;

revoke all on function private.wf_morning_roster(uuid, date), private.wf_morning_zone(uuid),
  private.wf_morning_lock(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.wf_morning_get(uuid, date), public.wf_morning_save(uuid, date, integer, jsonb, boolean),
  public.wf_morning_return(uuid, date, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.wf_morning_get(uuid, date), public.wf_morning_save(uuid, date, integer, jsonb, boolean),
  public.wf_morning_return(uuid, date, integer, text) to authenticated;

commit;
