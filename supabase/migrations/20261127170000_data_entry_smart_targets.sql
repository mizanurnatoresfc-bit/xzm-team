-- Phase 2: Smart Auto is the default distribution algorithm for enabled hubs.
-- Keep the scheduler and data writes inside the database. Existing pickup approvals stay independent.
create table private.data_entry_target_hubs (
  hub_id uuid primary key references public.hubs(id),
  enabled boolean not null default false
);
create table private.data_entry_target_rules (
  member_id uuid primary key references public.data_entry_team_members(id),
  working_minutes integer not null check (working_minutes between 1 and 1440),
  break_minutes integer not null check (break_minutes between 0 and working_minutes),
  initial_parcels_per_hour numeric(10,2) not null check (initial_parcels_per_hour > 0),
  initial_points_per_hour numeric(10,2) not null check (initial_points_per_hour > 0)
);
create table private.data_entry_target_observations (
  member_id uuid not null references public.data_entry_team_members(id),
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  senior_minutes integer not null default 0 check (senior_minutes >= 0),
  loading_minutes integer not null default 0 check (loading_minutes >= 0),
  big_parcel_minutes integer not null default 0 check (big_parcel_minutes >= 0),
  training_minutes integer not null default 0 check (training_minutes >= 0),
  other_minutes integer not null default 0 check (other_minutes >= 0),
  entry_minutes integer not null default 0 check (entry_minutes between 0 and 1440),
  attempted integer not null default 0 check (attempted between 0 and 100000),
  correct integer not null default 0 check (correct between 0 and attempted),
  merchants integer check (merchants between 0 and attempted),
  complex integer check (complex between 0 and attempted),
  verified_by uuid not null,
  primary key (member_id, hub_id, work_date),
  check (senior_minutes::bigint + loading_minutes + big_parcel_minutes + training_minutes + other_minutes <= 1440),
  check ((attempted = 0 and entry_minutes = 0) or (attempted > 0 and entry_minutes > 0))
);
create index data_entry_target_obs_hub_idx on private.data_entry_target_observations(hub_id, work_date);
create table private.data_entry_performance_profile (
  member_id uuid primary key references public.data_entry_team_members(id),
  reference_count integer not null check (reference_count >= 0),
  reporting_note text not null check (char_length(reporting_note) <= 500),
  collaboration_note text not null check (char_length(collaboration_note) <= 500),
  contribution_note text not null check (char_length(contribution_note) <= 500),
  approved_by uuid not null
);
create table private.data_entry_target_complexity (
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  complex_parcels integer not null check (complex_parcels >= 0),
  approved_by uuid not null,
  primary key (hub_id, work_date)
);
create table private.data_entry_target_runs (
  id bigint generated always as identity primary key,
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  recorded_at timestamptz not null default clock_timestamp(),
  reason text not null,
  snapshot jsonb not null
);
create index data_entry_target_runs_latest on private.data_entry_target_runs(hub_id, work_date, id desc);

revoke all on private.data_entry_target_hubs, private.data_entry_target_rules, private.data_entry_target_observations,
  private.data_entry_target_complexity, private.data_entry_target_runs, private.data_entry_performance_profile from public, anon, authenticated;

create function private.data_entry_target_input_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(tg_op, 'data_entry', tg_table_name, coalesce(to_jsonb(new)->>'member_id', to_jsonb(new)->>'hub_id'), null, to_jsonb(new));
  elsif to_jsonb(old) is distinct from to_jsonb(new) then
    perform private.write_audit(tg_op, 'data_entry', tg_table_name, coalesce(to_jsonb(new)->>'member_id', to_jsonb(new)->>'hub_id'), to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;
create trigger data_entry_target_hubs_audit after insert or update on private.data_entry_target_hubs
  for each row execute function private.data_entry_target_input_audit();
create trigger data_entry_target_rules_audit after insert or update on private.data_entry_target_rules
  for each row execute function private.data_entry_target_input_audit();
create trigger data_entry_target_observations_audit after insert or update on private.data_entry_target_observations
  for each row execute function private.data_entry_target_input_audit();
create trigger data_entry_performance_profile_audit after insert or update on private.data_entry_performance_profile
  for each row execute function private.data_entry_target_input_audit();
create trigger data_entry_target_complexity_audit after insert or update on private.data_entry_target_complexity
  for each row execute function private.data_entry_target_input_audit();

create function private.data_entry_target_team(p_hub uuid)
returns table (member_id uuid, employee_id uuid, hub_id uuid, zone_id uuid)
language sql stable set search_path = '' as $$
  select m.id, e.id, e.hub_id, m.zone_id
  from public.data_entry_team_members m
  join public.employees e on e.id = m.employee_id and e.zone_id = m.zone_id
  join public.hubs h on h.id = p_hub and h.zone_id = m.zone_id and h.status = 'active' and h.archived_at is null
  where m.is_active and e.status = 'active' and e.archived_at is null
    and (m.primary_hub_id = p_hub or exists (
      select 1 from public.data_entry_hub_assignments a where a.team_member_id = m.id and a.hub_id = p_hub and a.is_active))
$$;

-- Allocate integer parcels by largest remainder, using capacity weights in the selected unit.
-- Work Points are normalized against the hub's shipment mix to produce parcel-equivalent assignments.
create function private.data_entry_target_split(
  p_parcels bigint, p_work_units numeric, p_workers jsonb
) returns jsonb
language sql immutable set search_path = '' as $$
  with workers as (
    select (w->>'member')::uuid as member_id, coalesce((w->>'capacity')::numeric, 0) as capacity
    from jsonb_array_elements(p_workers) w
  ), totals as (
    select coalesce(sum(capacity), 0) as capacity from workers
  ), requested as (
    select case when p_work_units > 0 then least(p_parcels, floor(p_parcels * t.capacity / p_work_units)) else 0 end as assignable, t.capacity
    from totals t
  ), shares as (
    select w.member_id, w.capacity, r.assignable, coalesce(r.assignable * w.capacity / nullif(r.capacity, 0), 0) as share
    from workers w cross join requested r
  ), ordered as (
    select *, sum(floor(share)) over () as base_sum,
           row_number() over (order by share - floor(share) desc, member_id) as priority
    from shares
  )
  select jsonb_build_object('assignable', (select assignable from requested), 'total_capacity', (select capacity from requested),
    'unassigned', p_parcels - (select assignable from requested), 'workers',
    coalesce((select jsonb_object_agg(member_id, jsonb_build_object(
      'capacity', capacity,
      'share', round(share, 4),
      'parcels', floor(share) + case when priority <= assignable - base_sum then 1 else 0 end
    )) from ordered), '{}'::jsonb))
$$;

create function private.data_entry_target_snapshot(p_hub uuid, p_day date)
returns jsonb
language sql stable set search_path = '' as $$
  with pickup_days as (
    select d::date as day, sum(c.parcel_count) as parcels
    from generate_series(1, 7) as lookback(days)
    cross join lateral (select p_day - lookback.days as d) calendar
    left join public.pickup_consolidations c on c.hub_id = p_hub and c.pickup_date = d and c.voided_at is null
    group by d
  ), forecast as (
    select round(avg(parcels))::bigint as parcels, count(parcels) as samples,
           jsonb_agg(jsonb_build_object('date', day, 'verified_parcels', parcels) order by day) as days
    from pickup_days
  ), current_pickup as (
    select sum(parcel_count) filter (where voided_at is null) as parcels,
           count(distinct merchant_id) filter (where voided_at is null) as merchants,
           count(*) as observed_rows
    from public.pickup_consolidations
    where hub_id = p_hub and pickup_date = p_day
  ), rates as (
    select t.member_id, t.employee_id, t.hub_id as attendance_hub, r.working_minutes, r.break_minutes,
           r.initial_parcels_per_hour, r.initial_points_per_hour,
           past.parcel_days, past.parcel_minutes, past.point_days, past.point_minutes,
           past.parcel_rate, past.point_rate, past.accuracy,
           day.attendance, coalesce(done.correct, 0) as completed,
           duties.duty_detail, duties.duty_minutes, duties.spent_minutes, active_hubs.count as hub_count
    from private.data_entry_target_team(p_hub) t
    left join private.data_entry_target_rules r using (member_id)
    left join private.data_entry_target_observations done
      on done.member_id = t.member_id and done.hub_id = p_hub and done.work_date = p_day
    left join public.attendance_records ar on ar.employee_id = t.employee_id and ar.work_date = p_day
    left join lateral (
      select l.state from public.wf_morning_subs s join public.wf_morning_lines l on l.sub_id = s.id
      where s.hub_id = t.hub_id and s.work_date = p_day and s.status = 'submitted' and l.employee_id = t.employee_id
    ) am on true
    cross join lateral (
      select case when private.wf_leave_on(t.employee_id, p_day) is not null then 'leave'
                  when am.state is not null and am.state <> 'unknown' then am.state
                  else coalesce(ar.status, 'pending') end as attendance
    ) day
    cross join lateral (
      select count(*) as count
      from private.data_entry_target_hubs cfg
      join public.hubs h on h.id = cfg.hub_id and h.zone_id = t.zone_id and h.status = 'active' and h.archived_at is null
      join public.data_entry_team_members m on m.id = t.member_id
      where cfg.enabled and (m.primary_hub_id = cfg.hub_id or exists (
        select 1 from public.data_entry_hub_assignments a where a.team_member_id = m.id and a.hub_id = cfg.hub_id and a.is_active))
    ) active_hubs
    cross join lateral (
      select coalesce(sum(senior_minutes::bigint + loading_minutes + big_parcel_minutes + training_minutes + other_minutes), 0) as duty_minutes,
             coalesce(sum(entry_minutes), 0) as spent_minutes,
             jsonb_build_object('senior', coalesce(sum(senior_minutes), 0), 'loading', coalesce(sum(loading_minutes), 0),
               'big_parcel', coalesce(sum(big_parcel_minutes), 0), 'training', coalesce(sum(training_minutes), 0),
               'other', coalesce(sum(other_minutes), 0)) as duty_detail
      from private.data_entry_target_observations o where o.member_id = t.member_id and o.work_date = p_day
    ) duties
    cross join lateral (
      select count(distinct work_date) as parcel_days, coalesce(sum(entry_minutes), 0) as parcel_minutes,
             count(distinct work_date) filter (where merchants is not null and complex is not null) as point_days,
             coalesce(sum(entry_minutes) filter (where merchants is not null and complex is not null), 0) as point_minutes,
             round(60 * sum(correct)::numeric / nullif(sum(entry_minutes), 0), 4) as parcel_rate,
             round(60 * sum((attempted + 5 * merchants + 2 * complex) * correct::numeric / nullif(attempted, 0))
                / nullif(sum(entry_minutes) filter (where merchants is not null and complex is not null), 0), 4) as point_rate,
             round(100 * sum(correct)::numeric / nullif(sum(attempted), 0), 2) as accuracy
      from private.data_entry_target_observations o
      where o.member_id = t.member_id and o.work_date between p_day - 28 and p_day - 1 and o.entry_minutes > 0
    ) past
  ), timings as (
    select *,
      case when attendance = 'half_day' then floor(working_minutes / 2.0) else working_minutes end as effective_shift,
      case when parcel_days >= 3 and parcel_minutes >= 180 then parcel_rate else initial_parcels_per_hour end as applied_parcel_rate,
      case when point_days >= 3 and point_minutes >= 180 then point_rate else initial_points_per_hour end as applied_point_rate
    from rates
  ), capacity as (
    select *,
      case when attendance in ('present','late','half_day') and effective_shift is not null then
        greatest(0, effective_shift - break_minutes - duty_minutes) else 0 end as entry_minutes
    from timings
  ), weights as (
    select *,
      coalesce((entry_minutes / nullif(hub_count, 0)) * applied_parcel_rate / 60, 0) as forecast_capacity,
      coalesce((greatest(0, entry_minutes - spent_minutes) / nullif(hub_count, 0)) * applied_point_rate / 60, 0) as actual_capacity
    from capacity
  ), sums as (
    select coalesce((select sum(completed) from weights), 0) as active_completed,
      coalesce((select sum(o.correct) from private.data_entry_target_observations o
        where o.hub_id = p_hub and o.work_date = p_day), 0) as completed
  ), actual as (
    select case when cp.observed_rows > 0 then coalesce(cp.parcels, 0) end as parcels, cp.merchants,
      least(coalesce(cp.parcels, 0), coalesce(cx.complex_parcels, 0)) as complex,
      cx.complex_parcels is not null as complexity_known,
      sums.completed, sums.active_completed
    from current_pickup cp cross join sums
    left join private.data_entry_target_complexity cx on cx.hub_id = p_hub and cx.work_date = p_day
  ), supply as (
    select a.*, greatest(0, a.parcels - a.completed) as outstanding,
      a.parcels + 5 * a.merchants + 2 * a.complex as points from actual a
  ), splits as (
    select f.*, s.parcels as actual_parcels, s.merchants, s.complex, s.complexity_known,
      s.completed, s.active_completed, s.points, s.outstanding,
      private.data_entry_target_split(coalesce(f.parcels, 0), coalesce(f.parcels, 0), coalesce((
        select jsonb_agg(jsonb_build_object('member', member_id, 'capacity', forecast_capacity)) from weights), '[]'::jsonb)) as plan,
      private.data_entry_target_split(s.outstanding, s.points * s.outstanding / nullif(s.parcels, 0), coalesce((
        select jsonb_agg(jsonb_build_object('member', member_id, 'capacity', actual_capacity)) from weights), '[]'::jsonb)) as actual
    from forecast f cross join supply s
  )
  select jsonb_build_object(
    'rule', 'smart_auto_v1', 'forecast_days', s.days, 'forecast_sample_days', s.samples, 'forecast_pickups', s.parcels,
    'actual_pickups', s.actual_parcels, 'actual_merchants', s.merchants,
    'complex_parcels', case when s.complexity_known then s.complex end,
    'actual_work_points', case when s.actual_parcels is not null then s.points end, 'verified_completed', s.completed,
    'completed_outside_roster', s.completed - s.active_completed,
    'forecast_summary', s.plan - 'workers',
    'actual_summary', case when s.actual_parcels is not null then s.actual - 'workers' end,
    'workers', coalesce((select jsonb_object_agg(w.member_id::text, jsonb_build_object(
      'attendance', attendance, 'working_minutes', effective_shift, 'break_minutes', break_minutes,
      'duty_minutes', duty_minutes, 'duty_detail', duty_detail, 'entry_minutes', entry_minutes,
      'forecast_hub_minutes', entry_minutes / nullif(hub_count, 0),
      'remaining_hub_minutes', greatest(0, entry_minutes - spent_minutes) / nullif(hub_count, 0),
      'worked_minutes', spent_minutes, 'hub_count', hub_count, 'prior_accuracy_pct', accuracy,
      'parcel_sample_days', parcel_days, 'parcel_sample_minutes', parcel_minutes,
      'point_sample_days', point_days, 'point_sample_minutes', point_minutes,
      'parcel_rate', applied_parcel_rate, 'point_rate', applied_point_rate,
      'parcel_rate_source', case when parcel_days >= 3 and parcel_minutes >= 180 then 'verified' when initial_parcels_per_hour is not null then 'approved_initial' else 'missing' end,
      'point_rate_source', case when point_days >= 3 and point_minutes >= 180 then 'verified' when initial_points_per_hour is not null then 'approved_initial' else 'missing' end,
      'forecast', case when s.parcels is not null then (s.plan->'workers')->w.member_id::text end,
      'actual_remaining', case when s.actual_parcels is not null then (s.actual->'workers')->w.member_id::text end,
      'completed', w.completed
    )) from weights w), '{}'::jsonb)
  ) from splits s
$$;

create function private.data_entry_target_refresh(p_hub uuid, p_day date, p_trigger text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  next_snapshot jsonb;
  previous jsonb;
  explanation text;
begin
  if not exists (select 1 from private.data_entry_target_hubs where hub_id = p_hub and enabled) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_hub::text || '/' || p_day::text, 0));
  next_snapshot := private.data_entry_target_snapshot(p_hub, p_day);
  select snapshot into previous from private.data_entry_target_runs where hub_id = p_hub and work_date = p_day order by id desc limit 1;
  if next_snapshot is not distinct from previous then return false; end if;
  explanation := case
    when previous is null then 'first_calculation'
    when p_trigger <> 'schedule' then p_trigger
    when (next_snapshot->'actual_pickups', next_snapshot->'actual_merchants', next_snapshot->'complex_parcels')
      is distinct from (previous->'actual_pickups', previous->'actual_merchants', previous->'complex_parcels') then 'verified_pickup_changed'
    when next_snapshot->'forecast_days' is distinct from previous->'forecast_days' then 'verified_history_changed'
    else 'attendance_capacity_or_roster_changed'
  end;
  insert into private.data_entry_target_runs (hub_id, work_date, reason, snapshot)
  values (p_hub, p_day, explanation, next_snapshot);
  return true;
end $$;

create function private.data_entry_target_tick()
returns integer
language plpgsql security definer set search_path = '' as $$
declare hub record; changes integer := 0;
begin
  for hub in select cfg.hub_id from private.data_entry_target_hubs cfg
    join public.hubs h on h.id = cfg.hub_id and h.status = 'active' and h.archived_at is null
    join public.zones z on z.id = h.zone_id and z.status = 'active' and z.archived_at is null
    where cfg.enabled order by cfg.hub_id
  loop
    begin
      if private.data_entry_target_refresh(hub.hub_id, private.wf_today(), 'schedule') then changes := changes + 1; end if;
    exception when others then
      raise warning 'Data Entry target refresh for hub % failed [%]', hub.hub_id, sqlstate;
    end;
  end loop;
  return changes;
end $$;

revoke execute on function private.data_entry_target_tick(), private.data_entry_target_refresh(uuid,date,text),
  private.data_entry_target_team(uuid), private.data_entry_target_snapshot(uuid,date),
  private.data_entry_target_split(bigint,numeric,jsonb), private.data_entry_target_input_audit() from public, anon, authenticated;

create function private.data_entry_target_require_zone(p_hub uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare zone uuid;
begin
  select h.zone_id into zone from public.hubs h join public.zones z on z.id = h.zone_id
  where h.id = p_hub and h.status = 'active' and h.archived_at is null and z.status = 'active' and z.archived_at is null;
  if zone is null or not private.has_permission('data_entry.team.edit', zone, null) then
    raise exception 'Data Entry zone management permission required' using errcode = '42501';
  end if;
  return zone;
end $$;

create function public.data_entry_target_admin(p_hub uuid, p_day date, p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.data_entry_target_require_zone(p_hub);
  if p_member is not null and not exists (select 1 from private.data_entry_target_team(p_hub) where member_id = p_member) then
    raise exception 'Member is outside this hub' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'enabled', coalesce((select enabled from private.data_entry_target_hubs where hub_id = p_hub), false),
    'complex_parcels', (select complex_parcels from private.data_entry_target_complexity where hub_id = p_hub and work_date = p_day),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', t.member_id, 'name', coalesce(e.full_name_bn, e.full_name)) order by e.full_name, t.member_id)
      from private.data_entry_target_team(p_hub) t join public.employees e on e.id = t.employee_id), '[]'::jsonb),
    'rule', (select to_jsonb(r) - 'member_id' from private.data_entry_target_rules r where member_id = p_member),
    'observation', (select to_jsonb(o) - 'member_id' - 'hub_id' - 'work_date' - 'verified_by'
      from private.data_entry_target_observations o where member_id = p_member and hub_id = p_hub and work_date = p_day),
    'profile', (select to_jsonb(p) - 'member_id' - 'approved_by' from private.data_entry_performance_profile p where member_id = p_member),
    'latest', (select snapshot - 'workers' from private.data_entry_target_runs where hub_id = p_hub and work_date = p_day order by id desc limit 1),
    'history', coalesce((select jsonb_agg(to_jsonb(x) order by id desc) from (
      select id, reason, recorded_at, snapshot->'forecast_pickups' as forecast_pickups, snapshot->'actual_pickups' as actual_pickups,
        (snapshot->'workers')->p_member::text->'forecast'->'parcels' as forecast_target,
        (snapshot->'workers')->p_member::text->'actual_remaining'->'parcels' as actual_remaining
      from private.data_entry_target_runs where hub_id = p_hub and work_date = p_day order by id desc limit 20) x), '[]'::jsonb)
  );
end $$;

create function public.data_entry_target_save(p_hub uuid, p_day date, p_member uuid, p_kind text, p_values jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  today date := private.wf_today();
  observation private.data_entry_target_observations;
  settings private.data_entry_target_rules;
begin
  perform private.data_entry_target_require_zone(p_hub);
  if p_day is null or p_day not between today - 90 and today then
    raise exception 'Choose today or a date in the preceding 90 days' using errcode = '22023';
  end if;
  if p_kind in ('rule', 'observation', 'profile') then
    perform 1 from public.data_entry_team_members where id = p_member for update;
    if not exists (select 1 from private.data_entry_target_team(p_hub) where member_id = p_member) then
      raise exception 'Member is outside this hub' using errcode = '42501';
    end if;
  end if;
  case p_kind
    when 'hub' then
      insert into private.data_entry_target_hubs (hub_id, enabled)
      values (p_hub, (p_values->>'enabled')::boolean)
      on conflict (hub_id) do update set enabled = excluded.enabled;
    when 'rule' then
      settings := jsonb_populate_record(null::private.data_entry_target_rules, p_values);
      insert into private.data_entry_target_rules values (p_member, settings.working_minutes, settings.break_minutes,
        settings.initial_parcels_per_hour, settings.initial_points_per_hour)
      on conflict (member_id) do update set
        working_minutes = excluded.working_minutes, break_minutes = excluded.break_minutes,
        initial_parcels_per_hour = excluded.initial_parcels_per_hour, initial_points_per_hour = excluded.initial_points_per_hour;
    when 'observation' then
      observation := jsonb_populate_record(null::private.data_entry_target_observations, p_values);
      if coalesce((select sum(o.entry_minutes::bigint + o.senior_minutes + o.loading_minutes + o.big_parcel_minutes + o.training_minutes + o.other_minutes)
                   from private.data_entry_target_observations o
                   where o.member_id = p_member and o.work_date = p_day and o.hub_id <> p_hub), 0)
          + observation.entry_minutes::bigint + observation.senior_minutes + observation.loading_minutes
          + observation.big_parcel_minutes + observation.training_minutes + observation.other_minutes > 1440 then
        raise exception 'Combined verified minutes exceed one day' using errcode = '22023';
      end if;
      insert into private.data_entry_target_observations (
        member_id, hub_id, work_date, senior_minutes, loading_minutes, big_parcel_minutes, training_minutes,
        other_minutes, entry_minutes, attempted, correct, merchants, complex, verified_by
      ) values (
        p_member, p_hub, p_day, observation.senior_minutes, observation.loading_minutes, observation.big_parcel_minutes,
        observation.training_minutes, observation.other_minutes, observation.entry_minutes,
        observation.attempted, observation.correct, observation.merchants, observation.complex, auth.uid()
      )
      on conflict (member_id, hub_id, work_date) do update set
        senior_minutes = excluded.senior_minutes, loading_minutes = excluded.loading_minutes,
        big_parcel_minutes = excluded.big_parcel_minutes, training_minutes = excluded.training_minutes, other_minutes = excluded.other_minutes,
        entry_minutes = excluded.entry_minutes, attempted = excluded.attempted, correct = excluded.correct,
        merchants = excluded.merchants, complex = excluded.complex, verified_by = excluded.verified_by;
    when 'complexity' then
      insert into private.data_entry_target_complexity values (p_hub, p_day, (p_values->>'complex_parcels')::integer, auth.uid())
      on conflict (hub_id, work_date) do update set complex_parcels = excluded.complex_parcels, approved_by = excluded.approved_by;
    when 'profile' then
      insert into private.data_entry_performance_profile values (p_member, (p_values->>'reference_count')::integer,
        p_values->>'reporting_note', p_values->>'collaboration_note', p_values->>'contribution_note', auth.uid())
      on conflict (member_id) do update set reference_count = excluded.reference_count, reporting_note = excluded.reporting_note,
        collaboration_note = excluded.collaboration_note, contribution_note = excluded.contribution_note, approved_by = excluded.approved_by;
      return;
    else raise exception 'Unknown Data Entry setting' using errcode = '22023';
  end case;
  -- Today's run incorporates settings or historical evidence immediately. Other hubs refresh on the minute.
  perform private.data_entry_target_refresh(p_hub, today, p_kind || '_updated');
end $$;

create function public.data_entry_target_mine(p_day date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (
    select m.id as member_id
    from public.data_entry_team_members m join public.employees e on e.id = m.employee_id
    where e.profile_id = auth.uid() and e.status = 'active' and e.archived_at is null
  ), latest as (
    select distinct on (r.hub_id) r.*, me.member_id
    from private.data_entry_target_runs r cross join me
    where work_date = coalesce(p_day, private.wf_today()) and work_date between private.wf_today() - 90 and private.wf_today()
      and exists (select 1 from private.data_entry_target_runs prior where prior.hub_id = r.hub_id and prior.work_date = r.work_date
                  and (prior.snapshot->'workers') ? me.member_id::text)
    order by r.hub_id, r.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('hub', coalesce(h.name_bn, h.name), 'hub_id', h.id, 'date', latest.work_date,
    'enabled', latest.work_date <> private.wf_today() or exists (select 1 from private.data_entry_target_hubs c where c.hub_id = h.id and c.enabled),
    'summary', snapshot - 'workers', 'worker', (snapshot->'workers')->member_id::text,
    'history', (select jsonb_agg(to_jsonb(x) order by id desc) from (
      select r.id, r.recorded_at, r.reason, (r.snapshot->'workers')->member_id::text->'forecast'->'parcels' as forecast_target,
        (r.snapshot->'workers')->member_id::text->'actual_remaining'->'parcels' as actual_remaining
      from private.data_entry_target_runs r where r.hub_id = latest.hub_id and r.work_date = latest.work_date
        and ((r.snapshot->'workers') ? member_id::text or r.id = latest.id)
      order by r.id desc limit 20) x)
    ) order by h.name, h.id), '[]'::jsonb)
  from latest join public.hubs h on h.id = latest.hub_id
$$;

revoke execute on function private.data_entry_target_require_zone(uuid) from public, anon, authenticated;
revoke all on function public.data_entry_target_admin(uuid,date,uuid), public.data_entry_target_save(uuid,date,uuid,text,jsonb),
  public.data_entry_target_mine(date) from public, anon;
grant execute on function public.data_entry_target_admin(uuid,date,uuid), public.data_entry_target_save(uuid,date,uuid,text,jsonb),
  public.data_entry_target_mine(date) to authenticated;

-- Standard local CI has no cron. Production and staging must verify this job before enabling hubs.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('data-entry-smart-targets', '* * * * *', 'select private.data_entry_target_tick()');
  end if;
end $cron$;
