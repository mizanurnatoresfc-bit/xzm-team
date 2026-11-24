begin;

-- Keep the existing profile contract and run the new source reads as the caller.
-- Source RLS and the profile's work-hub scope must both allow a record.
alter function public.staff_profile_get(uuid, date, date) rename to staff_profile_base;
alter function public.staff_profile_base(uuid, date, date) set schema private;

create function public.staff_profile_get(p_employee uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  base jsonb := private.staff_profile_base(p_employee, p_from, p_to);
  v_from date := (base ->> 'from')::date;
  v_to date := (base ->> 'to')::date;
  is_self boolean := private.is_self_employee(p_employee);
  extra_events jsonb;
  extra_modules jsonb;
begin
  with sources as (
    select i.id, i.hub_id, i.zone_id, (i.created_at at time zone 'Asia/Dhaka')::date as work_date,
      'issues'::text as module, 'issue_assignment'::text as activity,
      case i.status when 'cancelled' then 'cancelled' when 'approved' then 'approved' else 'submitted' end as status,
      i.updated_at as server_time, jsonb_build_object('reference', i.issue_no, 'state', i.status) as detail,
      '/app/issues?id=' || i.id::text as link
    from public.issues i where i.assignee_id = p_employee

    union all

    select l.id, l.hub_id, l.zone_id, l.log_date, 'fleet',
      case l.kind when 'fuel' then 'fleet_fuel' when 'charge' then 'fleet_charge' else 'fleet_log' end,
      case when l.removed_at is not null or l.status = 'rejected' then 'cancelled'
           when l.status = 'approved' then 'approved' else 'submitted' end,
      l.updated_at, jsonb_build_object('kind', l.kind, 'state', l.status), '/app/fleet'
    from public.vehicle_logs l where l.driver_id = p_employee and l.log_date between v_from and v_to

    union all

    select l.id, l.hub_id, l.zone_id, l.log_date, 'fleet', 'fleet_day_log', 'submitted',
      l.updated_at, jsonb_build_object('trips', l.trips), '/app/fleet'
    from public.vehicle_day_logs l where l.driver_id = p_employee and l.log_date between v_from and v_to

    union all

    select c.id, c.hub_id, c.zone_id, c.bill_date, 'accounts', 'accounts_expense_claim',
      case c.status when 'added' then 'approved' when 'submitted' then 'submitted' else 'cancelled' end,
      c.updated_at, jsonb_build_object('state', c.status), null
    from public.da_expense_claims c where c.employee_id = p_employee and c.bill_date between v_from and v_to

    union all

    select l.id, l.hub_id, l.zone_id, s.account_date, 'accounts', 'accounts_rider_sheet',
      case when l.removed_at is not null then 'cancelled'
           when s.status in ('approved', 'submitted') then s.status else 'draft' end,
      greatest(l.updated_at, s.updated_at), jsonb_build_object('state', s.status), null
    from public.da_rider_lines l join public.da_sessions s on s.id = l.session_id
    where l.employee_id = p_employee and s.account_date between v_from and v_to
  ), visible as (
    select * from sources x
    where x.work_date between v_from and v_to
      and (is_self or private.has_permission('hr.employee.view', x.zone_id, x.hub_id))
  ), totals as (
    select module, count(*) filter (where status in ('submitted', 'approved')) as submitted,
      count(*) filter (where status = 'draft') as draft,
      count(*) filter (where status = 'cancelled') as cancelled, max(server_time) as last_at
    from visible group by module
  ), latest as (
    select * from visible order by work_date desc, server_time desc, id limit 300
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'date', x.work_date, 'module', x.module, 'activity', x.activity, 'status', x.status,
      'hub_id', x.hub_id, 'hub', h.name, 'source_id', x.id, 'version', 1,
      'detail', x.detail, 'server_time', x.server_time, 'link', x.link
    ) order by x.work_date desc, x.server_time desc, x.id)
    from latest x left join public.hubs h on h.id = x.hub_id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(t) order by t.module) from totals t), '[]'::jsonb)
  into extra_events, extra_modules;

  return base || jsonb_build_object(
    'connected', (base -> 'connected') || '["issues","fleet","accounts"]'::jsonb,
    'modules', (select coalesce(jsonb_agg(x.value order by x.value ->> 'module'), '[]'::jsonb)
      from jsonb_array_elements((base -> 'modules') || extra_modules) x),
    'events', (select coalesce(jsonb_agg(e.value order by e.value ->> 'date' desc,
      (e.value ->> 'server_time')::timestamptz desc, e.value ->> 'id'), '[]'::jsonb)
      from (select x.value from jsonb_array_elements((base -> 'events') || extra_events) x
        order by x.value ->> 'date' desc, (x.value ->> 'server_time')::timestamptz desc, x.value ->> 'id' limit 300) e)
  );
end $$;
revoke all on function public.staff_profile_get(uuid, date, date) from public, anon, authenticated, service_role;
grant execute on function public.staff_profile_get(uuid, date, date) to authenticated;

commit;
