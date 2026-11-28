begin;

alter table public.job_duties
  add column hub_id uuid references public.hubs(id),
  add column deadline_local time check (deadline_local < time '24:00'),
  add column verification_mode text not null default 'manual'
    check (verification_mode in ('manual', 'automatic', 'both')),
  add column evidence_source text
    check (evidence_source in ('attendance', 'morning_manpower', 'route_planning',
      'rider_visit', 'pickup', 'sorting', 'hub_operations', 'data_entry', 'accounts', 'problem_center')),
  add column reviewer_role text not null default 'hub_manager'
    check (reviewer_role in ('hub_manager', 'zonal_manager', 'super_admin')),
  add constraint xzm013_duty_evidence_required
    check (verification_mode = 'manual' or evidence_source is not null),
  add constraint xzm013_duty_schedule_required
    check (deadline_local is null or frequency in ('daily', 'weekly', 'monthly'));

alter table public.tasks
  add column job_duty_id uuid references public.job_duties(id),
  add column duty_period_start date,
  add column duty_due_at timestamptz,
  add column duty_mode text,
  add column duty_reviewer_role text,
  add column duty_evidence_source text,
  add column duty_evidence_id uuid,
  add column duty_evidence_at timestamptz,
  add column duty_incomplete_reason text,
  add column duty_excused boolean not null default false,
  add column duty_overdue_notified_at timestamptz,
  add column duty_escalated_at timestamptz,
  add constraint xzm013_task_occurrence unique (job_duty_id, related_employee_id, duty_period_start),
  add constraint xzm013_task_evidence_once unique (job_duty_id, duty_evidence_source, duty_evidence_id);

create index xzm013_tasks_due_idx on public.tasks (hub_id, duty_due_at)
  where job_duty_id is not null and status in ('assigned', 'in_progress', 'submitted');
create index xzm013_tasks_report_idx on public.tasks (related_employee_id, due_date)
  where job_duty_id is not null;

create function private.xzm013_reviewers(p_role text, p_zone uuid, p_hub uuid)
returns table(profile_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct u.user_id
  from public.user_roles u
  join public.roles r on r.id = u.role_id and r.status = 'active' and r.archived_at is null
  join public.profiles p on p.id = u.user_id and p.status = 'active' and p.archived_at is null
    and not p.must_change_password and (p.locked_until is null or p.locked_until < now())
  where u.revoked_at is null
    and (now() at time zone 'Asia/Dhaka')::date between u.valid_from and coalesce(u.valid_to, 'infinity'::date)
    and ((p_role = 'hub_manager' and r.code = 'manager' and u.scope_type = 'hub' and u.hub_id = p_hub)
      or (p_role = 'zonal_manager' and r.code = 'zonal_manager' and u.scope_type = 'zone' and u.zone_id = p_zone)
      or (p_role = 'super_admin' and r.is_super and u.scope_type = 'global'));
$$;

create function private.xzm013_duty_scope_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  employee_hub uuid;
  employee_zone uuid;
  hub_zone uuid;
begin
  if tg_op = 'UPDATE' then
    -- Legacy templates can still be archived or edited without changing their scope.
    if row(new.employee_id, new.zone_id, new.hub_id, new.deadline_local)
       is not distinct from row(old.employee_id, old.zone_id, old.hub_id, old.deadline_local) then
      return new;
    end if;
  end if;
  if new.hub_id is not null then
    select h.zone_id into hub_zone from public.hubs h
    where h.id = new.hub_id and h.status = 'active' and h.archived_at is null;
    if hub_zone is null or (new.zone_id is not null and new.zone_id <> hub_zone) then
      raise exception 'Invalid duty hub/zone' using errcode = '23514';
    end if;
    new.zone_id := hub_zone;
  end if;
  if new.employee_id is not null then
    select e.hub_id, e.zone_id into employee_hub, employee_zone from public.employees e
    where e.id = new.employee_id and e.status = 'active' and e.archived_at is null;
    if not found or (new.hub_id is not null and new.hub_id is distinct from employee_hub)
                 or (new.zone_id is not null and new.zone_id is distinct from employee_zone) then
      raise exception 'Employee is outside duty scope' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger xzm013_duty_scope before insert or update on public.job_duties
for each row execute function private.xzm013_duty_scope_guard();

-- The existing permissive policies still decide access. This policy also requires
-- a matching hub on the self-service position/employee path for scoped templates.
create policy xzm013_duty_hub_read on public.job_duties as restrictive
for select to authenticated using (
  (hub_id is null and (deadline_local is null or zone_id is null))
  or private.has_permission('hr.duty.view', zone_id, hub_id)
  or exists (
    select 1 from public.employees e where e.id = private.my_employee_id()
      and (job_duties.hub_id is null or e.hub_id = job_duties.hub_id)
      and (job_duties.zone_id is null or e.zone_id = job_duties.zone_id)
  )
);

create policy xzm013_duty_hub_view on public.job_duties for select to authenticated
  using (hub_id is not null and archived_at is null and private.has_permission('hr.duty.view', zone_id, hub_id));
create policy xzm013_duty_hub_insert on public.job_duties for insert to authenticated
  with check (hub_id is not null and private.has_permission('hr.duty.edit', zone_id, hub_id));
create policy xzm013_duty_hub_update on public.job_duties for update to authenticated
  using (hub_id is not null and private.has_permission('hr.duty.edit', zone_id, hub_id))
  with check (hub_id is not null and private.has_permission('hr.duty.edit', zone_id, hub_id));

create view private.xzm013_evidence as
  select 'attendance'::text source, a.id, a.employee_id, null::uuid profile_id, a.hub_id, a.zone_id,
         a.work_date, a.marked_at occurred_at
  from public.attendance_self_marks a
  where a.kind = 'present' and a.status = 'approved' and a.decided_as in ('present','late','half_day')
    and a.decided_at is not null
  union all
  select 'morning_manpower', m.id, null, m.submitted_by, m.hub_id, m.zone_id, m.work_date, m.submitted_at
  from public.wf_morning_subs m where m.status = 'submitted' and m.submit_mode = 'manager'
  union all
  select 'route_planning', r.id, null, r.sent_by, r.hub_id, r.zone_id, r.plan_date, r.sent_at
  from public.route_day_plans r
  where r.status = 'approved' and r.decided_at is not null and r.archived_at is null
  union all
  select 'rider_visit', v.id, v.employee_id, v.created_by, v.hub_id, v.zone_id, v.work_date, v.visited_at
  from public.route_stop_visits v where v.near is true and v.created_by is not null
  union all
  select 'pickup', p.id, null, p.submitted_by, p.hub_id, p.zone_id, p.pickup_date, p.submitted_at
  from public.pickup_submissions p where p.status = 'approved' and p.decided_at is not null
  union all
  select 'sorting', s.id, null, s.created_by, s.hub_id, s.zone_id, s.work_date, s.created_at
  from public.sorting_handovers s where s.status = 'received' and s.received_at is not null
  union all
  select 'hub_operations', h.id, null, h.submitted_by, h.hub_id, h.zone_id, h.report_date, h.submitted_at
  from public.hub_ops_reports h where h.status = 'reviewed' and h.reviewed_at is not null
  union all
  select 'data_entry', d.id, null, d.submitted_by, d.hub_id, d.zone_id, d.account_date, d.submitted_at
  from public.da_sessions d where d.status = 'approved' and d.verified_at is not null
  union all
  select 'accounts', c.id, null, c.prepared_by, c.hub_id, c.zone_id, c.recon_date, c.created_at
  from public.cash_reconciliations c where c.status = 'approved' and c.decided_at is not null
  union all
  select 'problem_center', i.id, null, e.by_user, i.hub_id, i.zone_id,
         (i.solved_at at time zone 'Asia/Dhaka')::date, i.solved_at
  from public.issues i
  join public.issue_events e on e.issue_id = i.id and e.action = 'solved' and e.at = i.solved_at
  where i.status = 'approved' and i.approved_at >= i.solved_at
    and i.approved_by is not null and e.by_user is not null and i.approved_by <> e.by_user;

create function private.xzm013_find_evidence(p_task public.tasks, p_record uuid)
returns table(id uuid, occurred_at timestamptz)
language sql stable set search_path = ''
as $$
  select e.id, e.occurred_at from private.xzm013_evidence e
  where e.source = p_task.duty_evidence_source
    and (p_record is null or e.id = p_record)
    and (e.employee_id is not null or e.profile_id is not null)
    and (e.employee_id is null or e.employee_id = p_task.related_employee_id)
    and (e.profile_id is null or e.profile_id = p_task.assigned_to)
    and e.hub_id = p_task.hub_id and e.zone_id = p_task.zone_id
    and e.work_date between p_task.duty_period_start and p_task.due_date
    and e.work_date >= (p_task.created_at at time zone 'Asia/Dhaka')::date
    and (e.occurred_at at time zone 'Asia/Dhaka')::date = e.work_date
    and e.occurred_at <= least(p_task.duty_due_at, statement_timestamp())
    and not exists (
      select 1 from public.tasks t where t.job_duty_id = p_task.job_duty_id
        and t.duty_evidence_source = e.source and t.duty_evidence_id = e.id and t.id <> p_task.id
    )
  order by e.occurred_at, e.id limit 1;
$$;

create function private.xzm013_is_excused(p_task public.tasks)
returns boolean
language sql stable set search_path = ''
as $$
  select not exists (
      select 1 from generate_series(0, p_task.due_date - p_task.duty_period_start) n(day_offset)
      where not exists (
        select 1 from public.leave_requests l where l.employee_id = p_task.related_employee_id
          and l.status = 'approved' and p_task.duty_period_start + n.day_offset between l.from_date and l.to_date
      ) and not exists (
        select 1 from public.wf_absence_applications a where a.employee_id = p_task.related_employee_id
          and a.hub_id = p_task.hub_id and a.zone_id = p_task.zone_id and a.status = 'approved'
          and p_task.duty_period_start + n.day_offset = any(a.dates)
      ) and not exists (
        select 1 from public.attendance_self_marks a where a.employee_id = p_task.related_employee_id
          and a.hub_id = p_task.hub_id and a.zone_id = p_task.zone_id and a.status = 'approved'
          and a.decided_as = 'absent' and a.work_date = p_task.duty_period_start + n.day_offset
      )
    );
$$;

create function private.xzm013_task_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  assigned_changed boolean;
begin
  assigned_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    assigned_changed := row(new.assigned_to, new.hub_id, new.zone_id, new.accountable_manager_id)
      is distinct from row(old.assigned_to, old.hub_id, old.zone_id, old.accountable_manager_id);
  end if;

  if (assigned_changed or (tg_op = 'UPDATE' and new.due_date is distinct from old.due_date))
     and new.job_duty_id is null then
    if new.hub_id is not null and not exists (
      select 1 from public.hubs h where h.id = new.hub_id and h.zone_id = new.zone_id
    ) then
      raise exception 'Invalid task hub/zone' using errcode = '23514';
    end if;
    if caller is not null and not private.has_permission(
      case when tg_op = 'INSERT' then 'zonal.task.create' else 'zonal.task.edit' end,
      new.zone_id, new.hub_id
    ) then
      raise exception 'Outside task assignment scope' using errcode = '42501';
    end if;
    if (new.zone_id is not null or new.hub_id is not null) and not (
      exists (
        select 1 from public.employees e where e.profile_id = new.assigned_to
          and e.status = 'active' and e.archived_at is null and e.zone_id = new.zone_id
          and (new.hub_id is null or e.hub_id = new.hub_id)
      ) or (
        not exists (select 1 from public.employees e where e.profile_id = new.assigned_to and e.archived_at is null)
        and exists (select 1 from private.grants_of(new.assigned_to, true) g
          where (g.scope_type = 'hub' and g.hub_id = new.hub_id)
             or (g.scope_type = 'zone' and g.zone_id = new.zone_id))
      )
    ) then
      raise exception 'Assignee is outside task scope' using errcode = '42501';
    end if;
    if new.accountable_manager_id is not null and new.accountable_manager_id is distinct from caller
       and not exists (
         select 1 from private.grants_of(new.accountable_manager_id, true) g
         where (g.permission_code = 'zonal.task.edit' or g.is_super)
           and (g.scope_type = 'global' or (g.scope_type = 'zone' and g.zone_id = new.zone_id)
             or (g.scope_type = 'hub' and g.hub_id = new.hub_id))
       ) then
      raise exception 'Accountable manager is outside task scope' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.job_duty_id is not null then
    if assigned_changed or row(new.job_duty_id, new.related_employee_id, new.duty_period_start,
       new.due_date, new.duty_due_at, new.requires_submission, new.duty_mode, new.duty_reviewer_role,
       new.duty_evidence_source)
       is distinct from row(old.job_duty_id, old.related_employee_id, old.duty_period_start,
       old.due_date, old.duty_due_at, old.requires_submission, old.duty_mode, old.duty_reviewer_role,
       old.duty_evidence_source) then
      raise exception 'Generated duty assignment is immutable' using errcode = '42501';
    end if;
    if new.status = 'completed' and old.status <> 'completed' then
      if not exists (
        select 1 from public.employees e where e.id = new.related_employee_id
          and e.profile_id = new.assigned_to and e.hub_id = new.hub_id and e.zone_id = new.zone_id
          and e.status = 'active' and e.archived_at is null
      ) then
        raise exception 'Duty assignee is outside the current scope' using errcode = '42501';
      end if;
      if private.xzm013_is_excused(new) then
        raise exception 'Duty is excused' using errcode = '22023';
      end if;
      if new.duty_mode = 'automatic' then
        if caller is not null then
          raise exception 'Automatic duties are completed by the evidence worker' using errcode = '42501';
        end if;
      elsif caller is null or caller = new.assigned_to or old.status <> 'submitted'
         or new.completed_by is distinct from caller or not exists (
           select 1 from private.xzm013_reviewers(new.duty_reviewer_role, new.zone_id, new.hub_id) r
           where r.profile_id = caller
         ) then
        raise exception 'Independent scoped reviewer required' using errcode = '42501';
      end if;
      if (new.duty_mode <> 'manual' or new.duty_evidence_id is not null)
        and (new.duty_evidence_id is null or not exists (
          select 1 from private.xzm013_find_evidence(new, new.duty_evidence_id)
        )) then
        raise exception 'Valid module evidence required' using errcode = '22023';
      end if;
    elsif new.status = 'cancelled' and old.status <> 'cancelled' and caller is not null
      and (caller = new.assigned_to or not exists (
        select 1 from private.xzm013_reviewers(new.duty_reviewer_role, new.zone_id, new.hub_id) r
        where r.profile_id = caller
      )) then
      raise exception 'Independent scoped reviewer required' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger xzm013_task_guard before insert or update on public.tasks
for each row execute function private.xzm013_task_guard();

create function public.duty_submit(p_task uuid, p_note text, p_record uuid default null,
                                    p_incomplete boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tasks;
  evidence_at timestamptz;
begin
  select * into t from public.tasks where id = p_task and job_duty_id is not null for update;
  if auth.uid() is null or t.assigned_to is distinct from auth.uid() or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.archived_at is null
  ) then
    raise exception 'Duty unavailable' using errcode = '42501';
  end if;
  if t.status not in ('assigned','in_progress') or private.xzm013_is_excused(t) or p_incomplete is null
     or nullif(btrim(p_note), '') is null or length(p_note) > 2000 then
    raise exception 'An open duty and a note of 1–2000 characters are required' using errcode = '22023';
  end if;
  if p_incomplete then
    update public.tasks set duty_incomplete_reason = btrim(p_note) where id = t.id;
    return;
  end if;
  if t.duty_mode = 'automatic' then
    raise exception 'Automatic duties are completed by the evidence worker' using errcode = '22023';
  end if;
  if t.duty_mode = 'both' and p_record is null then
    raise exception 'Module record ID required' using errcode = '22023';
  end if;
  if p_record is not null then
    select e.occurred_at into evidence_at from private.xzm013_find_evidence(t, p_record) e;
    if not found then raise exception 'Evidence unavailable' using errcode = '22023'; end if;
  end if;
  update public.tasks set status = 'submitted', submission_note = btrim(p_note), submitted_at = now(),
    duty_evidence_id = p_record, duty_evidence_at = evidence_at
  where id = t.id;
end;
$$;

create function public.duty_review(p_task uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task and job_duty_id is not null for update;
  if auth.uid() is null or t.id is null or t.assigned_to = auth.uid() or not exists (
    select 1 from private.xzm013_reviewers(t.duty_reviewer_role, t.zone_id, t.hub_id) r
    where r.profile_id = auth.uid()
  ) then
    raise exception 'Duty unavailable' using errcode = '42501';
  end if;
  if t.status <> 'submitted' or private.xzm013_is_excused(t) or t.duty_mode = 'automatic' or p_approve is null
    or length(p_note) > 2000 or (not p_approve and nullif(btrim(p_note), '') is null) then
    raise exception 'A pending submission and a return reason when applicable are required' using errcode = '22023';
  end if;
  if p_approve then
    update public.tasks set status = 'completed', completed_by = auth.uid(), completed_at = now(),
      completion_note = p_note where id = t.id;
  else
    update public.tasks set status = 'in_progress', submitted_at = null, submission_note = null,
      duty_evidence_id = null, duty_evidence_at = null, progress_note = btrim(p_note) where id = t.id;
  end if;
end;
$$;

create function public.duty_run(p_hub uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  local_day date := (statement_timestamp() at time zone 'Asia/Dhaka')::date;
  hub_zone uuid;
  t public.tasks;
  evidence record;
  recipient uuid;
  should_excuse boolean;
  inserted integer;
  verified integer := 0;
  notified integer := 0;
  escalated integer := 0;
begin
  if auth.uid() is not null then raise exception 'Service role required' using errcode = '42501'; end if;
  select h.zone_id into hub_zone from public.hubs h
    where h.id = p_hub and h.status = 'active' and h.archived_at is null;
  if hub_zone is null then raise exception 'Active hub required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('xzm013:' || p_hub::text, 0));

  insert into public.tasks (job_duty_id, title, description, zone_id, hub_id, assigned_to,
    related_employee_id, accountable_manager_id, due_date, requires_submission, duty_period_start, duty_due_at,
    duty_mode, duty_reviewer_role, duty_evidence_source)
  select d.id, case when char_length(btrim(d.title)) = 2 then d.title || ' ·' else d.title end,
    d.details, e.zone_id, e.hub_id, e.profile_id, e.id, manager.profile_id, dates.last_day, true, dates.first_day,
    (dates.last_day + d.deadline_local) at time zone 'Asia/Dhaka',
    d.verification_mode, d.reviewer_role, d.evidence_source
  from public.employees e
  join public.profiles p on p.id = e.profile_id and p.status = 'active' and p.archived_at is null
  join public.job_duties d on (d.employee_id = e.id or (d.position_id = e.position_id
    and (d.focus is null or d.focus = e.work_focus)))
  cross join lateral (select case d.frequency when 'weekly' then
    date_trunc('week', local_day::timestamp)::date when 'monthly' then
    date_trunc('month', local_day::timestamp)::date else local_day end first_day) start
  cross join lateral (select start.first_day, case d.frequency when 'weekly' then
    start.first_day + 6 when 'monthly' then (start.first_day + interval '1 month - 1 day')::date
    else local_day end last_day) dates
  cross join lateral (
    select r.profile_id from private.xzm013_reviewers(d.reviewer_role, e.zone_id, e.hub_id) r
    where r.profile_id <> e.profile_id
    order by r.profile_id limit 1
  ) manager
  where e.hub_id = p_hub and e.zone_id = hub_zone and e.status = 'active' and e.archived_at is null
    and d.archived_at is null and d.deadline_local is not null
    and (d.hub_id is null or d.hub_id = p_hub) and (d.zone_id is null or d.zone_id = hub_zone)
  on conflict on constraint xzm013_task_occurrence do nothing;
  get diagnostics inserted = row_count;

  for t in select * from public.tasks where job_duty_id is not null and hub_id = p_hub
    and status in ('assigned','in_progress','submitted') order by id for update
  loop
    should_excuse := private.xzm013_is_excused(t);
    if should_excuse is distinct from t.duty_excused then
      update public.tasks set duty_excused = should_excuse where id = t.id returning * into t;
    end if;
    if t.duty_excused then continue; end if;

    if t.duty_mode = 'automatic' and exists (
      select 1 from public.employees e where e.id = t.related_employee_id and e.profile_id = t.assigned_to
        and e.hub_id = t.hub_id and e.zone_id = t.zone_id and e.status = 'active' and e.archived_at is null
    ) then
      select * into evidence from private.xzm013_find_evidence(t, null);
      if found then
        update public.tasks set status = 'completed', completed_at = now(), duty_evidence_id = evidence.id,
          duty_evidence_at = evidence.occurred_at where id = t.id;
        verified := verified + 1;
        continue;
      end if;
    end if;
    if statement_timestamp() > t.duty_due_at and t.duty_overdue_notified_at is null then
      perform private.notify(t.assigned_to, 'দায়িত্বের সময়সীমা পেরিয়েছে', t.title, '/app/hub/tasks', 'task');
      perform private.notify(t.accountable_manager_id, 'দায়িত্বের সময়সীমা পেরিয়েছে', t.title, '/app/hub/tasks', 'task');
      update public.tasks set duty_overdue_notified_at = now() where id = t.id;
      notified := notified + 1;
    end if;
    if statement_timestamp() > t.duty_due_at + interval '24 hours' and t.duty_escalated_at is null then
      for recipient in
        select r.profile_id from private.xzm013_reviewers('zonal_manager', t.zone_id, t.hub_id) r
        where r.profile_id <> t.assigned_to
      loop
        perform private.notify(recipient, 'অসম্পূর্ণ দায়িত্ব যাচাই করুন', t.title, '/app/hub/tasks', 'task');
        update public.tasks set duty_escalated_at = now() where id = t.id;
      end loop;
      if found then escalated := escalated + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', inserted, 'verified', verified,
    'notified', notified, 'escalated', escalated);
end;
$$;

create function public.duty_report(p_date date, p_period text, p_employee uuid default null)
returns table(employee_id uuid, hub_id uuid, zone_id uuid, total bigint, completed bigint,
              excused bigint, overdue bigint, incomplete bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare first_day date; next_day date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.archived_at is null
  ) then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_date is null or p_period is null or p_period not in ('daily', 'monthly') then
    raise exception 'A report date and daily/monthly period are required' using errcode = '22023';
  end if;
  first_day := case when p_period = 'daily' then p_date else date_trunc('month', p_date::timestamp)::date end;
  next_day := case when p_period = 'daily' then first_day + 1 else (first_day + interval '1 month')::date end;
  return query select t.related_employee_id, t.hub_id, t.zone_id, count(*),
    count(*) filter (where t.status = 'completed'),
    count(*) filter (where t.duty_excused and t.status <> 'cancelled'),
    count(*) filter (where t.status not in ('completed','cancelled') and not t.duty_excused
      and t.duty_due_at < statement_timestamp()),
    count(*) filter (where t.status not in ('completed','cancelled') and not t.duty_excused
      and t.duty_incomplete_reason is not null)
  from public.tasks t
  where t.job_duty_id is not null and t.due_date >= first_day and t.due_date < next_day
    and (p_employee is null or p_employee = t.related_employee_id)
    and (t.assigned_to = auth.uid() or private.has_permission('zonal.task.view', t.zone_id, t.hub_id)
      or exists (select 1 from private.xzm013_reviewers(t.duty_reviewer_role, t.zone_id, t.hub_id) r
        where r.profile_id = auth.uid()))
  group by t.related_employee_id, t.hub_id, t.zone_id;
end;
$$;

-- Reviewers can list their queue even when their role lacks the legacy task view permission.
create function private.xzm013_can_review(p_role text, p_zone uuid, p_hub uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from private.xzm013_reviewers(p_role, p_zone, p_hub) r where r.profile_id = auth.uid()
  );
$$;

create policy xzm013_task_review_read on public.tasks for select to authenticated
  using (job_duty_id is not null and private.xzm013_can_review(duty_reviewer_role, zone_id, hub_id));

create policy xzm013_task_scope_read on public.tasks as restrictive for select to authenticated
  using (job_duty_id is null or assigned_to = (select auth.uid())
    or private.has_permission('zonal.task.view', zone_id, hub_id)
    or private.xzm013_can_review(duty_reviewer_role, zone_id, hub_id));

revoke all on private.xzm013_evidence from public, anon, authenticated, service_role;
revoke all on function private.xzm013_duty_scope_guard(), private.xzm013_task_guard(),
  private.xzm013_reviewers(text, uuid, uuid), private.xzm013_find_evidence(public.tasks, uuid),
  private.xzm013_is_excused(public.tasks),
  private.xzm013_can_review(text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.xzm013_can_review(text, uuid, uuid) to authenticated;

revoke all on function public.duty_submit(uuid, text, uuid, boolean), public.duty_review(uuid, boolean, text),
  public.duty_run(uuid), public.duty_report(date, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.duty_submit(uuid, text, uuid, boolean), public.duty_review(uuid, boolean, text),
  public.duty_report(date, text, uuid) to authenticated;
grant execute on function public.duty_run(uuid) to service_role;
commit;
