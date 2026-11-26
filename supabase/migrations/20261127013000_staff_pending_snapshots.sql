create table public.wf_pending_snapshots (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id),
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  pending_count integer not null check (pending_count between 0 and 100000),
  submitted_at timestamptz not null default clock_timestamp(),
  submitted_by uuid not null
);

create index wf_pending_snapshots_employee_day
  on public.wf_pending_snapshots (employee_id, work_date, id desc);

alter table public.wf_pending_snapshots enable row level security;
revoke all on public.wf_pending_snapshots from public, anon, authenticated;

create function public.wf_pending_today(p_count integer default null, p_work_date date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  staff public.employees := private.wf_me();
  today date := private.wf_today();
  latest public.wf_pending_snapshots;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if staff.id is null or staff.hub_id is null then
    if p_count is null then return null; end if;
    raise exception 'An active hub assignment is required' using errcode = '42501';
  end if;

  if p_count is not null then
    if p_work_date is distinct from today or p_count not between 0 and 100000 then
      raise exception 'Enter a count between 0 and 100000 for today' using errcode = '22023';
    end if;

    -- Serialize submissions from multiple tabs for the same employee and day.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(staff.id::text || ':' || today::text, 0));
  end if;
  select * into latest
    from public.wf_pending_snapshots
    where employee_id = staff.id and work_date = today
    order by id desc limit 1;

  if p_count is not null and (latest.pending_count, latest.hub_id) is distinct from (p_count, staff.hub_id) then
    insert into public.wf_pending_snapshots (employee_id, hub_id, work_date, pending_count, submitted_by)
    values (staff.id, staff.hub_id, today, p_count, auth.uid())
    returning * into latest;
  end if;

  return jsonb_build_object('date', today, 'count', latest.pending_count);
end;
$$;

revoke all on function public.wf_pending_today(integer, date) from public, anon;
grant execute on function public.wf_pending_today(integer, date) to authenticated;
