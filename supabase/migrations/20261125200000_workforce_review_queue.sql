-- Review the exact revision a manager saw. Staff changes create a new pending revision.
create table public.wf_ops_decisions (
  entry_id uuid not null references public.wf_daily_ops(id),
  revision integer not null check (revision > 0),
  status text not null check (status in ('approved', 'returned')),
  note text check (length(note) <= 500),
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  primary key (entry_id, revision),
  check (status <> 'returned' or nullif(btrim(note), '') is not null)
);
alter table public.wf_ops_decisions enable row level security;
revoke all on public.wf_ops_decisions from public, anon, authenticated;

create or replace function private.wf_ops_json(o public.wf_daily_ops) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'employee_id', o.employee_id, 'employee_code', e.employee_code::text, 'employee_name', e.full_name,
    'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
    'hub_id', o.hub_id, 'hub_name', (select coalesce(nullif(h.name_bn, ''), h.name) from public.hubs h where h.id = o.hub_id),
    'zone_id', o.zone_id, 'zone_name', (select coalesce(nullif(z.name_bn, ''), z.name) from public.zones z where z.id = o.zone_id),
    'work_date', o.work_date, 'pickup', o.pickup, 'pickup_return', o.pickup_return, 'delivery', o.delivery, 'delivery_return', o.delivery_return,
    'note', o.note, 'revision', o.revision, 'submitted_at', o.created_at, 'updated_at', o.updated_at,
    'review_status', d.status, 'review_note', d.note)
  from public.employees e
  left join public.wf_ops_decisions d on d.entry_id = o.id and d.revision = o.revision
  where e.id = o.employee_id
$$;

create function public.wf_ops_decide(p_entry uuid, p_revision integer, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  item public.wf_daily_ops;
  reason text := private.wf_clean(p_note);
  recipient uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into item from public.wf_daily_ops where id = p_entry for update;
  if item.id is null
    or not coalesce(private.has_permission('ops.staff_daily.view', item.zone_id, item.hub_id), false)
    or not coalesce(private.has_permission('ops.staff_daily.edit', item.zone_id, item.hub_id), false)
    or private.is_self_employee(item.employee_id) then
    raise exception 'You may not review this entry — এই এন্ট্রি অনুমোদনের অনুমতি আপনার নেই' using errcode = '42501';
  end if;
  if item.revision is distinct from p_revision or exists (
    select 1 from public.wf_ops_decisions where entry_id = item.id and revision = item.revision
  ) then
    raise exception 'This entry changed — এন্ট্রি বদলেছে বা সিদ্ধান্ত হয়েছে, তালিকা রিফ্রেশ করুন' using errcode = '40001';
  end if;
  if p_approve is null or (not p_approve and reason is null) then
    raise exception 'Write why it is turned down' using errcode = '22023';
  end if;
  insert into public.wf_ops_decisions (entry_id, revision, status, note, decided_by)
  values (item.id, item.revision, case when p_approve then 'approved' else 'returned' end, reason, auth.uid());
  select profile_id into recipient from public.employees where id = item.employee_id;
  perform private.notify(recipient, case when p_approve then 'দৈনিক এন্ট্রি অনুমোদিত' else 'দৈনিক এন্ট্রি ফেরত দেওয়া হয়েছে' end,
    coalesce(reason, to_char(item.work_date, 'DD-MM-YYYY')), '/app/staff', 'attendance');
end $$;
revoke all on function public.wf_ops_decide(uuid, integer, boolean, text) from public, anon;
grant execute on function public.wf_ops_decide(uuid, integer, boolean, text) to authenticated;

-- Replace the returned daily total. Ordinary incremental submissions still use wf_ops_add.
create function public.wf_ops_resubmit(p_entry uuid, p_revision integer, p_pickup integer, p_pickup_return integer, p_delivery integer, p_delivery_return integer, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  item public.wf_daily_ops;
  staff public.employees := private.wf_me();
  new_note text := private.wf_clean(p_note);
begin
  if auth.uid() is null or staff.id is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into item from public.wf_daily_ops where id = p_entry for update;
  if item.id is null or item.employee_id is distinct from staff.id then
    raise exception 'You may not resubmit this entry' using errcode = '42501';
  end if;
  if item.revision is distinct from p_revision or not exists (
    select 1 from public.wf_ops_decisions where entry_id = item.id and revision = item.revision and status = 'returned'
  ) then
    raise exception 'This entry changed — এন্ট্রি বদলেছে, আবার খুলুন' using errcode = '40001';
  end if;
  if p_pickup is null or p_pickup_return is null or p_delivery is null or p_delivery_return is null
    or least(p_pickup, p_pickup_return, p_delivery, p_delivery_return) < 0
    or greatest(p_pickup, p_pickup_return, p_delivery, p_delivery_return) > 100000 then
    raise exception 'The four numbers must be between 0 and 100000' using errcode = '22023';
  end if;
  if (p_pickup, p_pickup_return, p_delivery, p_delivery_return, new_note)
     is not distinct from (item.pickup, item.pickup_return, item.delivery, item.delivery_return, item.note) then
    raise exception 'Change a number or note — অন্তত একটি সংখ্যা বা নোট বদলান' using errcode = '22023';
  end if;
  update public.wf_daily_ops set pickup = p_pickup, pickup_return = p_pickup_return,
    delivery = p_delivery, delivery_return = p_delivery_return, note = new_note where id = item.id;
end $$;
revoke all on function public.wf_ops_resubmit(uuid, integer, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.wf_ops_resubmit(uuid, integer, integer, integer, integer, integer, text) to authenticated;

-- Use the existing attendance return path without writing a final-register entry.
create function public.wf_review_return_mark(p_mark uuid, p_marked_at timestamptz, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  mark public.attendance_self_marks;
  reason text := private.wf_clean(p_note);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if reason is null then raise exception 'Write why it is turned down' using errcode = '22023'; end if;
  select * into mark from public.attendance_self_marks where id = p_mark for update;
  if mark.id is null
    or not coalesce(private.has_permission('hr.attendance.create', mark.zone_id, mark.hub_id), false)
    or private.is_self_employee(mark.employee_id) then
    raise exception 'You may not review this attendance' using errcode = '42501';
  end if;
  if mark.status <> 'waiting' or mark.marked_at is distinct from p_marked_at or mark.application_id is not null
    or exists (select 1 from public.attendance_records where employee_id = mark.employee_id and work_date = mark.work_date) then
    raise exception 'This entry changed — হাজিরাটি বদলেছে বা খাতায় উঠেছে, তালিকা রিফ্রেশ করুন' using errcode = '40001';
  end if;
  perform public.wf_marks_decide(array[mark.id], false, null, reason);
end $$;
revoke all on function public.wf_review_return_mark(uuid, timestamptz, text) from public, anon;
grant execute on function public.wf_review_return_mark(uuid, timestamptz, text) to authenticated;
