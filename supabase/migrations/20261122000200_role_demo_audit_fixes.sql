-- রোল ডেমো অডিট (22 Nov 2026): what running the site as staff, hub manager and zonal manager turned up.
--
-- 1. A new HR request told nobody who could decide it. The approvers only heard about it from the
--    "waiting too long" reminder hours later. Now everyone who may approve requests for that hub is
--    notified the moment the request is sent (never the sender themselves).
-- 2. Nine notice/reminder functions could be called without signing in. They returned nothing to a
--    visitor, but there is no reason for them to be reachable: only signed-in people may call them now.

create or replace function private.hr_request_tell_approvers() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  v_what text;
  v_who text;
begin
  if new.status is distinct from 'submitted' then return new; end if;
  select f.name into v_what from public.hr_request_formats f where f.id = new.format_id;
  v_who := coalesce(nullif(trim(coalesce(new.data ->> 'full_name', '')), ''),
                    (select e.full_name from public.employees e where e.id = new.employee_id), '');
  for u in select profile_id from private.profiles_with_perm('hr.request.approve', new.zone_id, new.hub_id) loop
    perform private.notify_p(u, 'নতুন আবেদন: ' || coalesce(v_what, new.kind) || ' · ' || new.request_no,
      nullif(v_who, ''), '/app/hr/requests?id=' || new.id, 'hr_request', 'normal');
  end loop;
  return new;
end $$;
revoke all on function private.hr_request_tell_approvers() from public, anon, authenticated;

drop trigger if exists hr_requests_tell_approvers on public.hr_requests;
create trigger hr_requests_tell_approvers after insert on public.hr_requests
  for each row execute function private.hr_request_tell_approvers();

revoke execute on function public.my_report_line() from public, anon;
revoke execute on function public.notice_archive(uuid) from public, anon;
revoke execute on function public.notice_list(integer) from public, anon;
revoke execute on function public.notice_mark_read(uuid) from public, anon;
revoke execute on function public.notice_publish(text, text, text, uuid, uuid, text, boolean, boolean, timestamptz, timestamptz) from public, anon;
revoke execute on function public.reminder_add(text, timestamptz, text, text, text, text) from public, anon;
revoke execute on function public.reminder_done(uuid) from public, anon;
revoke execute on function public.reminder_list(boolean) from public, anon;
revoke execute on function public.reminder_remove(uuid) from public, anon;
grant execute on function public.my_report_line(), public.notice_archive(uuid), public.notice_list(integer), public.notice_mark_read(uuid),
  public.notice_publish(text, text, text, uuid, uuid, text, boolean, boolean, timestamptz, timestamptz),
  public.reminder_add(text, timestamptz, text, text, text, text), public.reminder_done(uuid), public.reminder_list(boolean),
  public.reminder_remove(uuid) to authenticated;

-- 3. "হাজিরা নেই" asked people about days from before their hub had started giving attendance in the system
--    (live: attendance began on 18 Nov, yet everyone was asked about every day since 1 Oct). A day now counts
--    as missing only from the first day anyone in that person's hub has attendance on the register.
create or replace function private.attendance_gap_days(p_from date, p_to date, p_employee uuid default null)
returns table (employee_id uuid, work_date date)
language sql stable security definer set search_path = '' as $$
  select e.id, d::date
  from public.employees e
  cross join lateral (select min(a.work_date) as first_day from public.attendance_records a
                        join public.employees m on m.id = a.employee_id where m.hub_id = e.hub_id) s
  cross join lateral generate_series(greatest(p_from, coalesce(e.status_since, e.joining_date, p_from), s.first_day),
                                     least(p_to, current_date - 1), interval '1 day') d
  where e.status = 'active' and e.archived_at is null and e.employee_code is not null
    and (p_employee is null or e.id = p_employee)
    and s.first_day is not null
    and not exists (select 1 from public.attendance_records a where a.employee_id = e.id and a.work_date = d::date)
$$;
