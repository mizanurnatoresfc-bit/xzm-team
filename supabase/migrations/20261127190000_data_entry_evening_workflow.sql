-- Simplified Data Entry workflow. Reuses the existing team, target engine and audit trail.
create table private.data_entry_heads (
  hub_id uuid primary key references public.hubs(id),
  employee_id uuid not null references public.employees(id),
  verify_reports boolean not null,
  assign_duties boolean not null,
  active boolean not null default true,
  approved_by uuid not null,
  check (verify_reports or assign_duties)
);
create index data_entry_heads_employee_idx on private.data_entry_heads(employee_id) where active;
create table private.data_entry_peer_updates (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references public.hubs(id),
  work_date date not null,
  reporter_id uuid not null references public.data_entry_team_members(id),
  subject_id uuid not null references public.data_entry_team_members(id),
  kind text not null check (kind in ('attendance','duty','support','good_work','issue')),
  note text not null check (length(btrim(note)) between 1 and 500),
  submitted_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  read_by uuid,
  check (reporter_id <> subject_id)
);
create index data_entry_peer_updates_hub_idx on private.data_entry_peer_updates(hub_id, work_date);
create index data_entry_peer_updates_reporter_idx on private.data_entry_peer_updates(reporter_id);
create index data_entry_peer_updates_subject_idx on private.data_entry_peer_updates(subject_id);

do $audit$
declare name text;
begin
  foreach name in array array['data_entry_shift_settings','data_entry_seed_pickups','data_entry_heads',
    'data_entry_shift_reports','data_entry_extra_duties','data_entry_peer_updates','data_entry_target_limits','data_entry_shift_availability']
  loop
    execute format('revoke all on private.%I from public, anon, authenticated', name);
    execute format('create trigger data_entry_audit after insert or update on private.%I
      for each row execute function private.data_entry_target_input_audit()', name);
  end loop;
end $audit$;

create function private.data_entry_is_zone_owner(p_hub uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hubs h join public.zones z on z.id = h.zone_id
     where h.id = p_hub and h.status = 'active' and h.archived_at is null and z.status = 'active' and z.archived_at is null
        and private.has_permission('data_entry.team.edit', h.zone_id, null))
$$;

create function private.data_entry_head_eligible(p_hub uuid,p_employee uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.employees e join public.hubs h on h.id = p_hub and h.zone_id = e.zone_id
    join public.profiles p on p.id = e.profile_id and p.status = 'active'
    where e.id = p_employee and e.status = 'active' and e.archived_at is null
      and (exists (select 1 from private.data_entry_target_team(p_hub) t where t.employee_id = e.id)
        or exists (
          select 1 from public.user_roles ur join public.roles role on role.id = ur.role_id
          where ur.user_id = p.id and role.code = 'hub_manager' and role.status = 'active' and role.archived_at is null
            and ur.revoked_at is null and private.wf_today() between ur.valid_from and coalesce(ur.valid_to,'infinity'::date)
            and (ur.scope_type = 'hub' and ur.hub_id = h.id
              or e.hub_id = h.id and (ur.scope_type = 'global' or (ur.scope_type = 'zone' and ur.zone_id = h.zone_id)))))
  )
$$;

create function private.data_entry_owner_or_head(p_hub uuid, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.data_entry_is_zone_owner(p_hub) or exists (
    select 1 from private.data_entry_heads d
    join public.hubs h on h.id = d.hub_id and h.status = 'active' and h.archived_at is null
    join public.zones z on z.id = h.zone_id and z.status = 'active' and z.archived_at is null
    join public.employees e on e.id = d.employee_id and e.profile_id = auth.uid()
      and e.status = 'active' and e.archived_at is null and e.zone_id = h.zone_id
    where d.hub_id = p_hub and d.active
      and ((p_action = 'reports' and d.verify_reports) or (p_action = 'duties' and d.assign_duties)
        or p_action = 'read')
      and private.data_entry_head_eligible(p_hub,e.id)
  )
$$;

create function private.data_entry_my_member(p_hub uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select t.member_id from private.data_entry_target_team(p_hub) t join public.employees e on e.id = t.employee_id
  where e.profile_id = auth.uid() and exists (select 1 from public.profiles p where p.id=e.profile_id and p.status='active')
$$;

create function private.data_entry_shift_ready(p_hub uuid, p_now timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select w.elapsed >= 0 and w.elapsed < w.open_minutes
    and exists (select 1 from private.data_entry_target_hubs c where c.hub_id = p_hub and c.enabled)
  from private.data_entry_shift_window(p_hub,p_now) w
$$;

create function private.data_entry_report_due(p_hub uuid,p_day date,p_slot integer,p_now timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_slot between 1 and 3 and p_day = w.day and w.elapsed >= w.checkpoints[p_slot]
    and private.data_entry_shift_ready(p_hub,p_now)
    and (not w.pickup_only or exists (select 1 from public.pickup_consolidations c
      where c.hub_id = p_hub and c.pickup_date = p_day and c.voided_at is null)), false)
  from private.data_entry_shift_window(p_hub,p_now) w
$$;

create or replace function private.data_entry_target_tick()
returns integer language plpgsql security definer set search_path = '' as $$
declare hub record; changes integer := 0;
begin
  for hub in select cfg.hub_id, w.day from private.data_entry_target_hubs cfg
    join public.hubs h on h.id = cfg.hub_id and h.status = 'active' and h.archived_at is null
    join public.zones z on z.id = h.zone_id and z.status = 'active' and z.archived_at is null
    cross join lateral private.data_entry_shift_window(cfg.hub_id, private.data_entry_shift_now()) w
    where cfg.enabled and w.elapsed between 0 and w.open_minutes-1 order by cfg.hub_id
  loop
    begin
      if private.data_entry_target_refresh(hub.hub_id, hub.day, 'schedule') then changes := changes + 1; end if;
    exception when others then
      raise warning 'Data Entry target refresh for hub % failed [%]', hub.hub_id, sqlstate;
    end;
  end loop;
  return changes;
end $$;

create function public.data_entry_shift_action(p_hub uuid,p_day date,p_action text,p_values jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  self uuid := private.data_entry_my_member(p_hub);
  target uuid := (p_values->>'member_id')::uuid;
  owner boolean := private.data_entry_is_zone_owner(p_hub);
  slot_no integer := (p_values->>'slot')::integer;
  amount integer := (p_values->>'attempted')::integer;
  duration integer := (p_values->>'entry_minutes')::integer;
  verified_count integer := (p_values->>'correct')::integer;
  duty_kind text := p_values->>'kind';
  item uuid := (p_values->>'id')::uuid;
  note_value text := coalesce(btrim(p_values->>'note'),'');
  actor uuid := auth.uid();
  day_window record;
  work_report private.data_entry_shift_reports%rowtype;
  duty private.data_entry_extra_duties%rowtype;
begin
  select * into day_window from private.data_entry_shift_window(p_hub,private.data_entry_shift_now());
  if actor is null or p_day is null or p_day not between private.wf_today()-90 and private.wf_today() then
    raise exception 'Sign in and choose a valid shift date' using errcode = '42501';
  end if;

  if p_action = 'report' then
    if self is null or not private.data_entry_report_due(p_hub,p_day,slot_no,private.data_entry_shift_now())
      or not exists (select 1 from private.data_entry_target_runs r
        where r.hub_id=p_hub and r.work_date=p_day and r.snapshot->'workers'->self::text->>'attendance' in ('present','late','half_day')
          and r.id=(select max(rr.id) from private.data_entry_target_runs rr where rr.hub_id=p_hub and rr.work_date=p_day))
    then raise exception 'Report is not open for this worker and shift' using errcode = '42501'; end if;

    perform 1 from public.data_entry_team_members where id=self for update;
    if exists (select 1 from private.data_entry_shift_reports r where r.hub_id=p_hub and r.work_date=p_day and r.member_id=self
      and ((r.slot < slot_no and (r.attempted > amount or r.entry_minutes > duration))
        or (r.slot > slot_no and (r.attempted < amount or r.entry_minutes < duration))))
    then raise exception 'Cumulative entries or minutes conflict with an adjacent report' using errcode = '22023'; end if;
    if slot_no = 3 and ((amount > 0 and coalesce(duration,0) <= 0) or (amount = 0 and coalesce(duration,0) <> 0)) then
      raise exception 'The final report needs actual entry minutes' using errcode = '22023';
    end if;
    insert into private.data_entry_shift_reports(hub_id,work_date,member_id,slot,attempted,merchants,entry_minutes,note)
    values (p_hub,p_day,self,slot_no,amount,(p_values->>'merchants')::integer,duration,note_value);
    return;
  end if;

  if p_action = 'peer' then
    if self is null or target is null or not exists (select 1 from private.data_entry_target_team(p_hub) where member_id=target)
      or p_day <> day_window.day
    then raise exception 'Select a colleague in your own hub and shift' using errcode = '42501'; end if;
    insert into private.data_entry_peer_updates(hub_id,work_date,reporter_id,subject_id,kind,note)
    values (p_hub,p_day,self,target,duty_kind,note_value);
    return;
  end if;

  if p_action = 'complete_duty' then
    if self is null then raise exception 'Team membership is required' using errcode = '42501'; end if;
    update private.data_entry_extra_duties set completed_at=now() where id=item and hub_id=p_hub and work_date=p_day
      and member_id=self and completed_at is null;
    if not found then raise exception 'Open duty not found' using errcode = '42501'; end if;
    return;
  end if;

  if p_action = 'review' then
    if not private.data_entry_owner_or_head(p_hub,'reports') or (self is not null and self=target) then
      raise exception 'Permission to verify this report is required' using errcode = '42501';
    end if;
    perform 1 from public.data_entry_team_members where id=target for update;
    select * into work_report from private.data_entry_shift_reports where hub_id=p_hub and work_date=p_day and member_id=target and slot=slot_no for update;
    if not found or verified_count is null or verified_count not between 0 and work_report.attempted or work_report.reviewed_at is not null then
      raise exception 'Choose a pending report and enter a valid verified count' using errcode = '22023';
    end if;
    if exists (select 1 from private.data_entry_shift_reports r
      where r.hub_id=p_hub and r.work_date=p_day and r.member_id=target
        and (r.slot < slot_no and r.correct > verified_count or r.slot > slot_no and r.correct < verified_count))
    then raise exception 'Verified entry totals must remain cumulative' using errcode = '22023'; end if;

    if slot_no=3 then
      if coalesce((select sum(o.entry_minutes) from private.data_entry_target_observations o
        where o.member_id=target and o.work_date=p_day and o.hub_id<>p_hub),0)+coalesce(work_report.entry_minutes,0)>1440 then
        raise exception 'Combined verified minutes exceed one day' using errcode = '22023';
      end if;
      insert into private.data_entry_target_observations(
        member_id,hub_id,work_date,entry_minutes,attempted,correct,merchants,verified_by
      ) values (target,p_hub,p_day,coalesce(work_report.entry_minutes,0),work_report.attempted,verified_count,work_report.merchants,actor)
      on conflict (member_id,hub_id,work_date) do update set entry_minutes=excluded.entry_minutes,
        attempted=excluded.attempted,correct=excluded.correct,merchants=excluded.merchants,
        complex=case when data_entry_target_observations.complex<=excluded.attempted
                     then data_entry_target_observations.complex end,verified_by=excluded.verified_by;
    end if;
    update private.data_entry_shift_reports set correct=verified_count, reviewed_at=now(),reviewed_by=actor
    where hub_id=p_hub and work_date=p_day and member_id=target and slot=slot_no;
    perform private.data_entry_target_refresh(p_hub,day_window.day,'shift_report_verified');
    return;
  end if;

  if p_action in ('assign_duty','approve_duty') then
    if not private.data_entry_owner_or_head(p_hub,'duties') then
      raise exception 'Permission to assign duties is required' using errcode = '42501';
    end if;
    if p_action='approve_duty' then
      update private.data_entry_extra_duties set approved_at=now(), approved_by=actor where id=item and hub_id=p_hub and work_date=p_day
        and completed_at is not null and approved_at is null and (self is null or member_id<>self);
      if not found then raise exception 'Completed duty is not available for verification' using errcode = '42501'; end if;
      return;
    end if;
    perform 1 from public.data_entry_team_members where id=target for update;
    if p_day<>day_window.day or not private.data_entry_shift_ready(p_hub,private.data_entry_shift_now())
      or not exists (select 1 from private.data_entry_target_team(p_hub) where member_id=target)
      or not exists (select 1 from (
          select snapshot->'workers'->target::text worker from private.data_entry_target_runs
          where hub_id=p_hub and work_date=p_day order by id desc limit 1
        ) latest where latest.worker->>'attendance' in ('present','late','half_day') and (
         (owner and coalesce((p_values->>'override')::boolean,false)) or (latest.worker->'actual_remaining'->>'parcels')::integer=0))
    then raise exception 'Choose an available worker with zero remaining quota, or use an explicit Zonal Manager exception' using errcode = '22023'; end if;
    if duration is null or duration>day_window.open_minutes-day_window.elapsed then
      raise exception 'Duty must fit within the time remaining in this shift' using errcode = '22023';
    end if;
    if coalesce((select sum(minutes) from private.data_entry_extra_duties where member_id=target and work_date=p_day and completed_at is null),0)
          + duration > day_window.open_minutes-day_window.elapsed then
      raise exception 'Open duties already use this worker''s remaining time' using errcode = '22023';
    end if;
    insert into private.data_entry_extra_duties(hub_id,member_id,work_date,kind,minutes,note,assigned_by)
    values (p_hub,target,p_day,duty_kind,duration,note_value,actor);
    perform private.data_entry_target_refresh(p_hub,p_day,'extra_duty_assigned');
    return;
  end if;

  if not owner then raise exception 'Zone manager access is required' using errcode = '42501'; end if;
  case p_action
    when 'seed_pickups' then
      if p_day not between day_window.day-7 and day_window.day-1 then
        raise exception 'Opening history accepts the seven days before the operating date' using errcode = '22023';
      end if;
      insert into private.data_entry_seed_pickups values (p_hub,p_day,(p_values->>'parcels')::integer,(p_values->>'merchants')::integer,actor)
      on conflict (hub_id,work_date) do update set parcels=excluded.parcels,merchants=excluded.merchants,approved_by=excluded.approved_by;
    when 'schedule' then
      insert into private.data_entry_shift_settings
      values (p_hub,(p_values->>'start_time')::time,(p_values->>'open_minutes')::integer,(p_values->>'first_minute')::integer,
        (p_values->>'second_minute')::integer,(p_values->>'third_minute')::integer,(p_values->>'pickup_only')::boolean)
      on conflict (hub_id) do update set start_time=excluded.start_time,open_minutes=excluded.open_minutes,
        first_minute=excluded.first_minute,second_minute=excluded.second_minute,third_minute=excluded.third_minute,pickup_only=excluded.pickup_only;
    when 'appoint_head' then
      if not private.data_entry_head_eligible(p_hub,(p_values->>'employee_id')::uuid) then
        raise exception 'Select an eligible Hub Manager or Data Entry employee' using errcode = '22023';
      end if;
      insert into private.data_entry_heads values (p_hub,(p_values->>'employee_id')::uuid,
        (p_values->>'verify_reports')::boolean,(p_values->>'assign_duties')::boolean,true,actor)
      on conflict (hub_id) do update set employee_id=excluded.employee_id, verify_reports=excluded.verify_reports,
        assign_duties=excluded.assign_duties, active=true,approved_by=excluded.approved_by;
    when 'revoke_head' then
      update private.data_entry_heads set active=false,approved_by=actor where hub_id=p_hub and active;
    when 'availability' then
      if p_day<>day_window.day or not exists (select 1 from private.data_entry_target_team(p_hub) where member_id=target) then
        raise exception 'Choose a worker and the current operating date' using errcode = '22023';
      end if;
      insert into private.data_entry_shift_availability values(p_hub,p_day,target,p_values->>'state',note_value,actor)
      on conflict (hub_id,work_date,member_id) do update set state=excluded.state,note=excluded.note,approved_by=excluded.approved_by;
    when 'limit' then
      if p_day<>day_window.day or not exists (select 1 from private.data_entry_target_team(p_hub) where member_id=target) then
        raise exception 'Choose a team member and the current operating date' using errcode = '22023';
      end if;
      insert into private.data_entry_target_limits values (p_hub,p_day,target,(p_values->>'maximum')::integer,actor)
      on conflict (hub_id,work_date,member_id) do update set maximum=excluded.maximum,approved_by=excluded.approved_by;
    when 'peer_read' then
      update private.data_entry_peer_updates set read_at=now(),read_by=actor where id=item and hub_id=p_hub and read_at is null;
    else raise exception 'Unknown Data Entry action' using errcode = '22023';
  end case;
  if p_action in ('seed_pickups','limit','availability') then
    perform private.data_entry_target_refresh(p_hub,day_window.day,p_action);
  end if;
end $$;
create function private.data_entry_head_payload(p_hub uuid,p_day date,p_self uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('member_id',r.member_id,'name',coalesce(e.full_name_bn,e.full_name),
      'slot',r.slot,'attempted',r.attempted,'merchants',r.merchants,'entry_minutes',r.entry_minutes,'note',r.note,
      'submitted_at',r.submitted_at,'correct',r.correct,'reviewed_at',r.reviewed_at)
      order by r.slot,e.full_name,r.member_id)
      from private.data_entry_shift_reports r join public.data_entry_team_members m on m.id=r.member_id
      join public.employees e on e.id=m.employee_id
      where r.hub_id=p_hub and r.work_date=p_day and (p_self is null or r.member_id=p_self)), '[]'::jsonb),
    'duties', coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'member_id',d.member_id,'name',coalesce(e.full_name_bn,e.full_name),
      'kind',d.kind,'minutes',d.minutes,'note',d.note,'completed_at',d.completed_at,'approved_at',d.approved_at)
      order by d.completed_at nulls first,d.id)
      from private.data_entry_extra_duties d join public.data_entry_team_members m on m.id=d.member_id
      join public.employees e on e.id=m.employee_id
      where d.hub_id=p_hub and d.work_date=p_day and (p_self is null or d.member_id=p_self)), '[]'::jsonb)
  )
$$;

create function public.data_entry_shift_control(p_hub uuid,p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
end $$;

create function public.data_entry_shift_mine()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (
    select m.id as member_id,e.id as employee_id from public.employees e
    left join public.data_entry_team_members m on m.employee_id=e.id and m.is_active and m.zone_id=e.zone_id
    join public.profiles p on p.id=e.profile_id and p.status='active'
    where e.profile_id=auth.uid() and e.status='active' and e.archived_at is null
  ), my_hubs as (
    select m.primary_hub_id as hub_id, me.member_id from me join public.data_entry_team_members m on m.id=me.member_id
    union
    select a.hub_id,me.member_id from me join public.data_entry_hub_assignments a on a.team_member_id=me.member_id and a.is_active
  ), own as (
    select h.id,coalesce(h.name_bn,h.name) as name, w.day,
      private.data_entry_shift_ready(h.id,private.data_entry_shift_now()) as running,
      (select r.snapshot->'workers'->mine.member_id::text->>'attendance'
       from private.data_entry_target_runs r where r.hub_id=h.id and r.work_date=w.day order by r.id desc limit 1) as attendance,
      (select max(s.attempted) from private.data_entry_shift_reports s where s.hub_id=h.id and s.work_date=w.day and s.member_id=mine.member_id) as last_attempted,
      (select max(s.entry_minutes) from private.data_entry_shift_reports s where s.hub_id=h.id and s.work_date=w.day and s.member_id=mine.member_id) as last_minutes,
      prompts.due_slots[1] as next_slot, coalesce(prompts.due_slots,'{}'::integer[]) as due_slots,
      (select coalesce(jsonb_agg(jsonb_build_object('id',t.member_id,'name',coalesce(e.full_name_bn,e.full_name)) order by e.full_name,t.member_id), '[]'::jsonb)
        from private.data_entry_target_team(h.id) t join public.employees e on e.id=t.employee_id where t.member_id<>mine.member_id) as colleagues,
      private.data_entry_head_payload(h.id,w.day,mine.member_id)->'duties' as duties
    from my_hubs mine join public.hubs h on h.id=mine.hub_id cross join lateral private.data_entry_shift_window(h.id,private.data_entry_shift_now()) w
    cross join lateral (
      select array_agg(s order by s) as due_slots from generate_series(1,3) s
      where private.data_entry_report_due(h.id,w.day,s,private.data_entry_shift_now())
        and not exists (select 1 from private.data_entry_shift_reports r
          where r.hub_id=h.id and r.work_date=w.day and r.member_id=mine.member_id and r.slot=s)
    ) prompts
    where private.data_entry_my_member(h.id)=mine.member_id
  )
  select jsonb_build_object('hubs',coalesce((select jsonb_agg(to_jsonb(own) order by name,id) from own),'[]'::jsonb),
    'heads',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'name',coalesce(h.name_bn,h.name)) order by h.name,h.id)
      from me join private.data_entry_heads d on d.employee_id=me.employee_id and d.active
      join public.hubs h on h.id=d.hub_id where private.data_entry_owner_or_head(h.id,'read')), '[]'::jsonb))
$$;

revoke execute on function private.data_entry_head_payload(uuid,date,uuid),private.data_entry_is_zone_owner(uuid),
  private.data_entry_head_eligible(uuid,uuid),private.data_entry_owner_or_head(uuid,text),private.data_entry_my_member(uuid),
  private.data_entry_shift_ready(uuid,timestamptz),private.data_entry_report_due(uuid,date,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.data_entry_shift_action(uuid,date,text,jsonb),public.data_entry_shift_control(uuid,date),
  public.data_entry_shift_mine() from public,anon;
grant execute on function public.data_entry_shift_action(uuid,date,text,jsonb),public.data_entry_shift_control(uuid,date),
  public.data_entry_shift_mine() to authenticated;
