create index wf_pending_snapshots_hub_day
  on public.wf_pending_snapshots (hub_id, work_date);

create function public.wf_pending_month(p_hub uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  zone uuid;
  today date := private.wf_today();
  current_month date := date_trunc('month', today::timestamp)::date;
  first_day date := date_trunc('month', p_month::timestamp)::date;
begin
  select h.zone_id into zone from public.hubs h where h.id = p_hub;
  if not found or auth.uid() is null
     or not coalesce(private.has_permission('ops.staff_daily.view', zone, p_hub), false) then
    raise exception 'You may not view this hub' using errcode = '42501';
  end if;

  if first_day is null or first_day > current_month
    or (first_day < current_month - interval '1 month'
      and not coalesce(private.has_permission('zonal.dashboard.view', zone, null), false)) then
    raise exception 'This month is outside your archive access' using errcode = '22023';
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(report) order by report.date), '[]'::jsonb)
    from (
      select s.work_date as date,
        count(*) as submissions,
        sum(s.pending_count) as submitted_count,
        count(*) filter (where a.snapshot_id is not null and a.return_reason is null) as approvals,
        sum(s.pending_count) filter (where a.snapshot_id is not null and a.return_reason is null) as approved_count,
        count(*) filter (where a.return_reason is not null) as returned
      from public.wf_pending_snapshots s
      left join public.wf_pending_approvals a on a.snapshot_id = s.id
      where s.hub_id = p_hub and s.work_date >= first_day
        and s.work_date < first_day + interval '1 month' and s.work_date <= today
        and not exists (
          select 1 from public.wf_pending_snapshots newer
          where newer.employee_id = s.employee_id and newer.work_date = s.work_date and newer.id > s.id
        )
      group by s.work_date
    ) report
  );
end $$;

revoke all on function public.wf_pending_month(uuid, date) from public, anon;
grant execute on function public.wf_pending_month(uuid, date) to authenticated;
