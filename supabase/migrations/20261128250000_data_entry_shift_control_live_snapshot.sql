-- Followup to data_entry_attendance_sync_fix (PR #236).
--
-- That fix added a null-snapshot fallback in `public.data_entry_shift_control`,
-- which handled setup hubs that had never been refreshed. But Natore Shorting
-- Centre had a stale `data_entry_target_runs` row from 19:12 Dhaka (reason
-- 'first_calculation'), written before the self-mark / report attendance
-- sources were added. The fallback didn't fire because the cached snapshot
-- was non-null — so every worker rendered as "হাজিরা বাকি" on the Live
-- Control screen even though the live snapshot had them correctly as
-- 'present'.
--
-- Resolution: cached runs are only useful for the audit history on the
-- Targets page. `data_entry_shift_control` always computes the snapshot
-- live. The live path is a single STABLE SQL function and is cheap enough
-- for the per-page call.

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
  -- Always live: cached runs are only for audit; attendance evidence can land
  -- any second (self-mark, report submit, evening change) and must show up now.
  snapshot := private.data_entry_target_snapshot(p_hub, day);
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
