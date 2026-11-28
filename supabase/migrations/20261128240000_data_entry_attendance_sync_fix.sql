-- DE-V2 Attendance Sync Bug Fix (Natore Shorting Centre reported 2026-11-28)
--
-- Root cause, two bugs stacked:
-- (1) private.data_entry_target_snapshot's attendance lateral only considered
--     wf_leave_on, data_entry_shift_availability (evening), wf_morning_subs/lines,
--     attendance_records. Online self-marks (attendance_self_marks, kind='present'
--     with status='waiting') and submitted shift reports were ignored, so staff
--     who tap "present" online never show up in Data Entry until manager approval.
-- (2) public.data_entry_shift_control reads only the latest cached run from
--     private.data_entry_target_runs. private.data_entry_target_refresh is gated
--     by data_entry_target_hubs.enabled=true, so hubs still in setup (e.g.
--     Natore Shorting Centre) never get a snapshot persisted; every team member's
--     attendance field is null and the UI shows "বাকি" even when evening
--     availability / self-mark / morning sub exists.
--
-- Fix, additive and back-compatible:
-- (A) Rewrite private.data_entry_target_snapshot — only the `day` attendance
--     lateral is changed; add two left-laterals for self-mark and submitted
--     shift report. Owner-set evening availability still wins.
-- (B) public.data_entry_shift_control falls back to a live snapshot when no
--     cached run exists for the day.
-- (C) Triggers on attendance_self_marks and private.data_entry_shift_reports
--     refresh the cached snapshot for every enabled hub the member belongs to.

-- (A) ----------------------------------------------------------------------
create or replace function private.data_entry_target_snapshot(p_hub uuid, p_day date)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  with mode as (
    select coalesce(
      (select distribution_mode from private.data_entry_target_hubs where hub_id = p_hub),
      'smart'
    ) as distribution_mode
  ), pickup_days as (
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
    -- NEW: online self-mark (any status; owner directive — no manager approval required)
    left join lateral (
      select case x.kind
               when 'present' then 'present'
               when 'late' then 'late'
               when 'half_day' then 'half_day'
               when 'absent' then 'absent'
               when 'leave' then 'leave'
             end as state
      from public.attendance_self_marks x
      where x.employee_id = t.employee_id and x.work_date = p_day
      order by x.marked_at desc limit 1
    ) sm on true
    -- NEW: any submitted shift report ⇒ present (owner directive — report jomar sathe presence nishchit)
    left join lateral (
      select 1 as hit
      from private.data_entry_shift_reports r2
      where r2.member_id = t.member_id and r2.work_date = p_day and r2.submitted_at is not null
      limit 1
    ) rpt on true
    cross join lateral (
      select case when private.wf_leave_on(t.employee_id, p_day) is not null then 'leave'
                  when evening.state is not null then evening.state
                  when am.state is not null and am.state <> 'unknown' then am.state
                  when sm.state is not null then sm.state
                  when rpt.hit is not null then 'present'
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
      coalesce((select sum(o.completed) from observed_work o where o.hub_id = p_hub), 0) as completed,
      coalesce((select count(*) from weights where forecast_capacity > 0), 0) as eligible_count
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
  ), fair as (
    select case when s.eligible_count > 0 then coalesce(f.parcels, 0)::numeric / s.eligible_count end as fair_share_parcels
    from sums s cross join forecast f
  ), splits as (
    select f.*, s.parcels as actual_parcels, s.merchants, s.complex, s.complexity_known,
      s.completed, s.active_completed, s.points as actual_points, s.outstanding,
      m.distribution_mode,
      private.data_entry_target_split(coalesce(f.parcels, 0), coalesce(f.points, f.parcels, 0), coalesce((
        select jsonb_agg(jsonb_build_object('member', member_id, 'capacity',
          case m.distribution_mode when 'equal' then case when forecast_capacity > 0 then 1 else 0 end
          else forecast_capacity * rank_multiplier end
        )) from weights), '[]'::jsonb)) as plan,
      private.data_entry_target_split(s.outstanding, s.points * s.outstanding / nullif(s.parcels, 0), coalesce((
        select jsonb_agg(jsonb_build_object('member', member_id, 'capacity',
          case m.distribution_mode when 'equal'
            then case when (case when maximum is null then raw_actual_capacity else capped_actual_capacity end) > 0 then 1 else 0 end
          else (case when maximum is null then raw_actual_capacity else capped_actual_capacity end) * rank_multiplier end
        )) from weights), '[]'::jsonb)) as actual
    from forecast f cross join supply s cross join mode m
  )
  select jsonb_build_object(
    'rule', 'smart_or_equal_v1_attsync', 'forecast_days', s.days, 'forecast_sample_days', s.samples, 'forecast_pickups', s.parcels,
    'forecast_work_points', s.points,
    'actual_pickups', s.actual_parcels, 'actual_merchants', s.merchants,
    'complex_parcels', case when s.complexity_known then s.complex end,
    'actual_work_points', case when s.actual_parcels is not null then s.actual_points end, 'verified_completed', s.completed,
    'completed_outside_roster', s.completed - s.active_completed,
    'distribution_mode', s.distribution_mode,
    'fair_equal_share_parcels', round((select fair_share_parcels from fair), 4),
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
      'distribution_mode', s.distribution_mode,
      'under_assigned',
        case when (select fair_share_parcels from fair) is not null
                  and ((s.plan->'workers')->w.member_id::text->'parcels')::numeric
                      < (select fair_share_parcels from fair)
             then true else false end,
      'protected_from_negative_eval',
        case when ((select fair_share_parcels from fair) is not null
                   and ((s.plan->'workers')->w.member_id::text->'parcels')::numeric
                       < (select fair_share_parcels from fair))
                 or (s.actual_parcels is not null
                     and ((s.actual->'workers')->w.member_id::text->'parcels')::numeric > 0
                     and w.completed >= ((s.actual->'workers')->w.member_id::text->'parcels')::numeric)
             then true else false end,
      'forecast', case when s.parcels is not null then (s.plan->'workers')->w.member_id::text end,
      'actual_remaining', case when s.actual_parcels is not null then (s.actual->'workers')->w.member_id::text end,
      'completed', w.completed
    )) from weights w), '{}'::jsonb)
  ) from splits s
$function$;

-- (B) ----------------------------------------------------------------------
create or replace function public.data_entry_shift_control(p_hub uuid, p_day date default null::date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  owner boolean := private.data_entry_is_zone_owner(p_hub);
  shift_info record;
  day date;
  snapshot jsonb;
  result jsonb;
begin
  if not private.data_entry_owner_or_head(p_hub,'read') then
    raise exception 'This hub is outside your Data Entry scope' using errcode = '42501';
  end if;
  select * into shift_info from private.data_entry_shift_window(p_hub,private.data_entry_shift_now());
  day := coalesce(p_day,shift_info.day);
  if day not between private.wf_today()-90 and private.wf_today() then
    raise exception 'Date is outside the report window' using errcode = '22023';
  end if;
  select r.snapshot into snapshot from private.data_entry_target_runs r where r.hub_id=p_hub and r.work_date=day order by id desc limit 1;
  -- NEW: compute live if cache is empty (setup-hubs and never-refreshed days still show real attendance)
  if snapshot is null then
    snapshot := private.data_entry_target_snapshot(p_hub, day);
  end if;
  result := private.data_entry_head_payload(p_hub,day);
  if not private.data_entry_owner_or_head(p_hub,'reports') then result := result-'reports'; end if;
  if not private.data_entry_owner_or_head(p_hub,'duties') then result := result-'duties'; end if;
  result := result || jsonb_build_object(
    'day',day,'operating_day',shift_info.day,'elapsed',shift_info.elapsed,
    'running',private.data_entry_shift_ready(p_hub,private.data_entry_shift_now()),'is_owner',owner,
    'can_review',private.data_entry_owner_or_head(p_hub,'reports'), 'can_assign',private.data_entry_owner_or_head(p_hub,'duties'),
    'team',coalesce((select jsonb_agg(jsonb_build_object('id',t.member_id,'name',coalesce(e.full_name_bn,e.full_name),
      'attendance', snapshot->'workers'->t.member_id::text->>'attendance',
      'expected', snapshot->'workers'->t.member_id::text->'forecast'->'parcels',
      'remaining', snapshot->'workers'->t.member_id::text->'actual_remaining'->'parcels',
      'completed',snapshot->'workers'->t.member_id::text->'completed',
      'limit',snapshot->'workers'->t.member_id::text->'daily_limit') order by e.full_name,t.member_id)
      from private.data_entry_target_team(p_hub) t join public.employees e on e.id=t.employee_id), '[]'::jsonb),
    'forecast',snapshot->'forecast_pickups','actual',snapshot->'actual_pickups',
    'unassigned',snapshot->'actual_summary'->'unassigned'
  );
  if not owner then return result; end if;
  return result || jsonb_build_object(
    'schedule',jsonb_build_object('start_time',coalesce((select start_time from private.data_entry_shift_settings where hub_id=p_hub),'18:00'::time),
      'open_minutes',shift_info.open_minutes,'first_minute',shift_info.checkpoints[1],'second_minute',shift_info.checkpoints[2],
      'third_minute',shift_info.checkpoints[3],'pickup_only',shift_info.pickup_only),
    'head',(select to_jsonb(h)-'approved_by'-'hub_id' from private.data_entry_heads h where h.hub_id=p_hub and h.active),
    'head_choices',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(e.full_name_bn,e.full_name)) order by e.full_name,e.id)
       from public.employees e join public.hubs h on h.id=p_hub and h.zone_id=e.zone_id
       where private.data_entry_head_eligible(p_hub,e.id)), '[]'::jsonb),
    'opening',coalesce((select jsonb_agg(jsonb_build_object('date',shift_info.day-g.d,'parcels',s.parcels,'merchants',s.merchants)
       order by g.d desc) from generate_series(1,7) g(d) left join private.data_entry_seed_pickups s
       on s.hub_id=p_hub and s.work_date=shift_info.day-g.d), '[]'::jsonb),
    'updates',coalesce((select jsonb_agg(to_jsonb(item) order by item.submitted_at desc) from (
      select u.id,u.kind,u.note,u.submitted_at,u.read_at,coalesce(author.full_name_bn,author.full_name) as reporter,
        coalesce(subject.full_name_bn,subject.full_name) as subject
      from private.data_entry_peer_updates u
      join public.data_entry_team_members am on am.id=u.reporter_id join public.employees author on author.id=am.employee_id
      join public.data_entry_team_members sm on sm.id=u.subject_id join public.employees subject on subject.id=sm.employee_id
      where u.hub_id=p_hub and u.work_date=day order by u.submitted_at desc,u.id limit 200) item), '[]'::jsonb),
    'performance',coalesce((select jsonb_agg(to_jsonb(item) order by item.accuracy desc nulls last,item.name,item.member_id) from (
      select t.member_id,coalesce(e.full_name_bn,e.full_name) as name, work.correct, work.attempted, work.merchants,
        case when work.attempted>=20 then round(100*work.correct::numeric/work.attempted,2) end as accuracy,
        work.senior_minutes+tasks.senior as senior_minutes,work.training_minutes+tasks.training as training_minutes,
        tasks.approved as verified_duties,tasks.loading,tasks.big_parcel,tasks.assist,tasks.extra_entry,
        n.verified_reports,p.reference_count,p.reporting_note,p.collaboration_note,p.contribution_note
      from private.data_entry_target_team(p_hub) t join public.employees e on e.id=t.employee_id
      left join private.data_entry_performance_profile p on p.member_id=t.member_id
      cross join lateral (select coalesce(sum(o.correct),0) as correct,coalesce(sum(o.attempted),0) as attempted,
        sum(o.merchants) as merchants,coalesce(sum(o.senior_minutes),0) as senior_minutes,
        coalesce(sum(o.training_minutes),0) as training_minutes
        from private.data_entry_target_observations o where o.member_id=t.member_id and o.hub_id=p_hub and o.work_date between day-6 and day) work
      cross join lateral (select count(*) as approved,
        coalesce(sum(d.minutes) filter (where d.kind='senior'),0) as senior,
        coalesce(sum(d.minutes) filter (where d.kind='training'),0) as training,
        count(*) filter (where d.kind='loading') as loading,count(*) filter (where d.kind='big_parcel') as big_parcel,
        count(*) filter (where d.kind='assist') as assist,count(*) filter (where d.kind='extra_entry') as extra_entry
        from private.data_entry_extra_duties d where d.member_id=t.member_id and d.hub_id=p_hub
            and d.approved_at is not null and d.work_date between day-6 and day) tasks
      cross join lateral (select count(*) as verified_reports from private.data_entry_shift_reports r
        where r.member_id=t.member_id and r.hub_id=p_hub and r.reviewed_at is not null and r.work_date between day-6 and day) n
    ) item), '[]'::jsonb)
  );
end $function$;

-- (C) ----------------------------------------------------------------------
create or replace function private.data_entry_refresh_on_self_mark() returns trigger
language plpgsql security definer set search_path to '' as $$
declare h uuid;
begin
  for h in
    select distinct cfg.hub_id
    from private.data_entry_target_hubs cfg
    where cfg.enabled and exists (
      select 1 from public.data_entry_team_members m
      where m.employee_id = coalesce(new.employee_id, old.employee_id)
        and m.is_active
        and (m.primary_hub_id = cfg.hub_id or exists (
          select 1 from public.data_entry_hub_assignments a
          where a.team_member_id = m.id and a.hub_id = cfg.hub_id and a.is_active))
    )
  loop
    perform private.data_entry_target_refresh(h, coalesce(new.work_date, old.work_date), 'attendance_self_mark');
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists de_refresh_on_self_mark on public.attendance_self_marks;
create trigger de_refresh_on_self_mark
after insert or update of kind, status, decided_as, work_date on public.attendance_self_marks
for each row execute function private.data_entry_refresh_on_self_mark();

create or replace function private.data_entry_refresh_on_shift_report() returns trigger
language plpgsql security definer set search_path to '' as $$
declare hub_cfg uuid;
begin
  for hub_cfg in
    select distinct cfg.hub_id
    from private.data_entry_target_hubs cfg
    where cfg.enabled and cfg.hub_id = coalesce(new.hub_id, old.hub_id)
  loop
    perform private.data_entry_target_refresh(hub_cfg, coalesce(new.work_date, old.work_date), 'shift_report_submit');
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists de_refresh_on_shift_report on private.data_entry_shift_reports;
create trigger de_refresh_on_shift_report
after insert or update of submitted_at, reviewed_at on private.data_entry_shift_reports
for each row execute function private.data_entry_refresh_on_shift_report();
