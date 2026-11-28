-- Data Entry V2 · R1.5 — Wire Senior Rank multiplier into the target-split engine.
--
-- R1 (migration 20261128190000) added data_entry_ranks and rank_id on
-- data_entry_team_members, but the smart-target calculation ignored them.
-- R1.5 makes the engine honor the rank's target_multiplier_pct when it
-- splits a hub's forecast and actual-remaining parcels across workers.
--
-- Semantics:
--   * Each member's effective capacity = raw capacity × rank_multiplier_pct / 100.
--   * A member with no rank_id, or whose rank is inactive, keeps a multiplier
--     of 1.0 (fully backward-compatible with Phase 1 behavior).
--   * Shares are still share = effective_capacity / sum(effective_capacity),
--     so the split sums to the assignable parcel count exactly as before —
--     ranks redistribute the split, they do not inflate the parcel total.
--   * `assignable` is capped by p_parcels, so a zone where every member has
--     multiplier > 100 cannot push the hub over its actual parcel count.
--
-- This migration touches ONE function (private.data_entry_target_snapshot) via
-- CREATE OR REPLACE. No table change, no RPC signature change, no new permission.
-- The `workers` output of the snapshot gains two additive fields
-- (`rank_multiplier_pct`, `effective_forecast_capacity`) for transparency.

create or replace function private.data_entry_target_snapshot(p_hub uuid, p_day date)
returns jsonb
language sql stable set search_path = '' as $$
  with pickup_days as (
    select d.day, coalesce(a.parcels, b.parcels) as parcels,
           case when a.parcels is not null then a.merchants else b.merchants end as merchants,
           case when a.parcels is not null then 'approved_pickup' when b.parcels is not null then 'opening_history' end as source,
           least(coalesce(a.parcels,b.parcels,0),coalesce(cx.complex_parcels,0)) as complexity
    from generate_series(1, 7) as lookback(days)
    cross join lateral (select p_day - lookback.days as day) d
    left join lateral (
      select sum(c.parcel_count) as parcels, count(distinct c.merchant_id) as merchants from public.pickup_consolidations c
      where c.hub_id = p_hub and c.pickup_date = d.day and c.voided_at is null
    ) a on true
    left join private.data_entry_seed_pickups b on b.hub_id = p_hub and b.work_date = d.day
    left join private.data_entry_target_complexity cx on cx.hub_id = p_hub and cx.work_date = d.day
  ), forecast as (
    select round(avg(parcels))::bigint as parcels, count(parcels) as samples,
           case when count(merchants) = count(parcels) then avg(parcels + 5 * merchants + 2 * complexity) end as points,
           jsonb_agg(jsonb_build_object('date', day, 'verified_parcels', parcels, 'merchants', merchants, 'source', source) order by day) as days
    from pickup_days
  ), current_pickup as (
    select sum(parcel_count) filter (where voided_at is null) as parcels,
           count(distinct merchant_id) filter (where voided_at is null) as merchants,
           count(*) as observed_rows
    from public.pickup_consolidations
    where hub_id = p_hub and pickup_date = p_day
  ), observed_work as (
    select member_id, hub_id,
           greatest(coalesce(max(correct) filter (where source = 0), 0), coalesce((array_agg(correct order by source desc) filter (where source > 0))[1], 0)) as completed,
           greatest(coalesce(max(entry_minutes) filter (where source = 0), 0), coalesce((array_agg(entry_minutes order by source desc) filter (where source > 0 and entry_minutes is not null))[1], 0)) as elapsed
    from (
      select o.member_id, o.hub_id, o.correct, o.entry_minutes, 0 as source
      from private.data_entry_target_observations o where o.work_date = p_day
      union all
      select r.member_id, r.hub_id, r.correct, r.entry_minutes, r.slot
      from private.data_entry_shift_reports r where r.work_date = p_day and r.reviewed_at is not null
    ) work
    group by member_id, hub_id
  ), rates as (
    select t.member_id, t.employee_id, t.hub_id as attendance_hub, r.working_minutes, r.break_minutes,
           r.initial_parcels_per_hour, r.initial_points_per_hour,
           past.parcel_days, past.parcel_minutes, past.point_days, past.point_minutes,
           past.parcel_rate, past.point_rate, past.accuracy,
           day.attendance, coalesce(done.completed, 0) as completed, limit_cfg.maximum,
           duties.duty_detail, duties.duty_minutes, duties.assigned_duty_minutes, duties.spent_minutes, active_hubs.count as hub_count,
           -- R1.5: rank multiplier from the member's assigned active rank, default 1.0
           coalesce((
             select dr.target_multiplier_pct / 100.0
             from public.data_entry_team_members m
             join public.data_entry_ranks dr on dr.id = m.rank_id
             where m.id = t.member_id and dr.is_active
           ), 1.0) as rank_multiplier
    from private.data_entry_target_team(p_hub) t
    left join private.data_entry_target_rules r using (member_id)
    left join observed_work done on done.member_id = t.member_id and done.hub_id = p_hub
    left join private.data_entry_target_limits limit_cfg
      on limit_cfg.member_id = t.member_id and limit_cfg.hub_id = p_hub and limit_cfg.work_date = p_day
    left join private.data_entry_shift_availability evening
      on evening.hub_id = p_hub and evening.work_date = p_day and evening.member_id = t.member_id
    left join public.attendance_records ar on ar.employee_id = t.employee_id and ar.work_date = p_day
    left join lateral (
      select l.state from public.wf_morning_subs s join public.wf_morning_lines l on l.sub_id = s.id
      where s.hub_id = t.hub_id and s.work_date = p_day and s.status = 'submitted' and l.employee_id = t.employee_id
    ) am on true
    cross join lateral (
      select case when private.wf_leave_on(t.employee_id, p_day) is not null then 'leave'
                  when evening.state is not null then evening.state
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
             coalesce((select sum(ow.elapsed) from observed_work ow where ow.member_id = t.member_id), 0) as spent_minutes,
             coalesce((select sum(d.minutes) from private.data_entry_extra_duties d where d.member_id = t.member_id
               and d.work_date = p_day and d.kind <> 'extra_entry'), 0) as assigned_duty_minutes,
             jsonb_build_object('senior', coalesce(sum(senior_minutes), 0), 'loading', coalesce(sum(loading_minutes), 0),
               'big_parcel', coalesce(sum(big_parcel_minutes), 0), 'training', coalesce(sum(training_minutes), 0),
               'other', coalesce(sum(other_minutes), 0)) as duty_detail
      from private.data_entry_target_observations o where o.member_id = t.member_id and o.work_date = p_day
    ) duties
    cross join lateral (
      select count(distinct work_date) as parcel_days, coalesce(sum(entry_minutes), 0) as parcel_minutes,
             count(distinct work_date) filter (where merchants is not null) as point_days,
             coalesce(sum(entry_minutes) filter (where merchants is not null), 0) as point_minutes,
             round(60 * sum(correct)::numeric / nullif(sum(entry_minutes), 0), 4) as parcel_rate,
             round(60 * sum((attempted + 5 * merchants + 2 * coalesce(complex,0)) * correct::numeric / nullif(attempted, 0))
                / nullif(sum(entry_minutes) filter (where merchants is not null), 0), 4) as point_rate,
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
        greatest(0, effective_shift - break_minutes - duty_minutes - assigned_duty_minutes) else 0 end as entry_minutes
    from timings
  ), weights as (
    select c.*,
      least(coalesce((entry_minutes / nullif(hub_count, 0))
        * case when f.points is not null then applied_point_rate else applied_parcel_rate end / 60, 0),
        maximum * coalesce(f.points / nullif(f.parcels,0), 1)) as forecast_capacity,
      least(coalesce((greatest(0, entry_minutes - spent_minutes) / nullif(hub_count, 0)) * applied_point_rate / 60, 0),
        greatest(0, maximum - completed) * (cp.parcels + 5 * cp.merchants + 2 * least(cp.parcels,coalesce(cx.complex_parcels,0))) / nullif(cp.parcels,0))
            as capped_actual_capacity,
      coalesce((greatest(0, entry_minutes - spent_minutes) / nullif(hub_count, 0)) * applied_point_rate / 60, 0) as raw_actual_capacity
    from capacity c cross join forecast f cross join current_pickup cp
    left join private.data_entry_target_complexity cx on cx.hub_id = p_hub and cx.work_date = p_day
  ), sums as (
    select coalesce((select sum(completed) from weights), 0) as active_completed,
      coalesce((select sum(o.completed) from observed_work o where o.hub_id = p_hub), 0) as completed
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
      s.completed, s.active_completed, s.points as actual_points, s.outstanding,
      -- R1.5: multiply each worker's capacity by its rank multiplier before splitting.
      -- Unranked members pass through unchanged (multiplier = 1.0).
      private.data_entry_target_split(coalesce(f.parcels, 0), coalesce(f.points, f.parcels, 0), coalesce((
        select jsonb_agg(jsonb_build_object('member', member_id, 'capacity', forecast_capacity * rank_multiplier)) from weights), '[]'::jsonb)) as plan,
      private.data_entry_target_split(s.outstanding, s.points * s.outstanding / nullif(s.parcels, 0), coalesce((
        select jsonb_agg(jsonb_build_object('member', member_id, 'capacity',
          (case when maximum is null then raw_actual_capacity else capped_actual_capacity end) * rank_multiplier
        )) from weights), '[]'::jsonb)) as actual
    from forecast f cross join supply s
  )
  select jsonb_build_object(
    'rule', 'smart_auto_v1_rank', 'forecast_days', s.days, 'forecast_sample_days', s.samples, 'forecast_pickups', s.parcels,
    'forecast_work_points', s.points,
    'actual_pickups', s.actual_parcels, 'actual_merchants', s.merchants,
    'complex_parcels', case when s.complexity_known then s.complex end,
    'actual_work_points', case when s.actual_parcels is not null then s.actual_points end, 'verified_completed', s.completed,
    'completed_outside_roster', s.completed - s.active_completed,
    'forecast_summary', s.plan - 'workers',
    'actual_summary', case when s.actual_parcels is not null then s.actual - 'workers' end,
    'workers', coalesce((select jsonb_object_agg(w.member_id::text, jsonb_build_object(
      'attendance', attendance, 'working_minutes', effective_shift, 'break_minutes', break_minutes,
      'duty_minutes', duty_minutes + assigned_duty_minutes, 'assigned_duty_minutes', assigned_duty_minutes, 'daily_limit', maximum, 'duty_detail', duty_detail, 'entry_minutes', entry_minutes,
      'forecast_hub_minutes', entry_minutes / nullif(hub_count, 0),
      'remaining_hub_minutes', greatest(0, entry_minutes - spent_minutes) / nullif(hub_count, 0),
      'worked_minutes', spent_minutes, 'hub_count', hub_count, 'prior_accuracy_pct', accuracy,
      'parcel_sample_days', parcel_days, 'parcel_sample_minutes', parcel_minutes,
      'point_sample_days', point_days, 'point_sample_minutes', point_minutes,
      'parcel_rate', applied_parcel_rate, 'point_rate', applied_point_rate,
      'parcel_rate_source', case when parcel_days >= 3 and parcel_minutes >= 180 then 'verified' when initial_parcels_per_hour is not null then 'approved_initial' else 'missing' end,
      'point_rate_source', case when point_days >= 3 and point_minutes >= 180 then 'verified' when initial_points_per_hour is not null then 'approved_initial' else 'missing' end,
      'rank_multiplier_pct', round(rank_multiplier * 100, 2),
      'effective_forecast_capacity', round(forecast_capacity * rank_multiplier, 4),
      'forecast', case when s.parcels is not null then (s.plan->'workers')->w.member_id::text end,
      'actual_remaining', case when s.actual_parcels is not null then (s.actual->'workers')->w.member_id::text end,
      'completed', w.completed
    )) from weights w), '{}'::jsonb)
  ) from splits s
$$;
