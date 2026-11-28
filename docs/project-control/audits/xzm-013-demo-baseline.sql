-- Disposable baseline for the SQL regression suite on an empty Supabase project.
create schema if not exists private;
create table public.hubs (
  id uuid primary key default gen_random_uuid(),
  code text,
  zone_id uuid,
  status text,
  archived_at timestamptz
);
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  position_id uuid,
  zone_id uuid,
  hub_id uuid,
  status text,
  archived_at timestamptz,
  work_focus text
);
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  status text,
  archived_at timestamptz,
  must_change_password bool not null default false,
  locked_until timestamptz
);
create table public.job_duties (
  id uuid primary key default gen_random_uuid(),
  position_id uuid,
  employee_id uuid,
  zone_id uuid,
  title text,
  details text,
  frequency text,
  focus text,
  archived_at timestamptz
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 2),
  description text,
  zone_id uuid,
  hub_id uuid,
  assigned_to uuid not null,
  accountable_manager_id uuid not null references public.profiles,
  related_employee_id uuid,
  due_date date not null,
  requires_submission bool not null default false,
  status text not null default 'assigned' check (status in ('assigned','in_progress','submitted','completed','cancelled')),
  progress_note text,
  submission_note text,
  submitted_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  completion_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  priority text not null default 'normal'
);
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text,
  status text,
  archived_at timestamptz,
  is_super bool
);
create table public.user_roles (
  user_id uuid,
  role_id uuid,
  scope_type text,
  zone_id uuid,
  hub_id uuid,
  revoked_at timestamptz,
  valid_from date,
  valid_to date
);
create table public.attendance_self_marks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid,
  hub_id uuid,
  zone_id uuid,
  work_date date,
  kind text,
  marked_at timestamptz,
  status text,
  decided_as text,
  decided_at timestamptz
);
create table public.wf_morning_subs (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid,
  zone_id uuid,
  work_date date,
  status text,
  submit_mode text,
  submitted_by uuid,
  submitted_at timestamptz
);
create table public.route_day_plans (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid,
  zone_id uuid,
  plan_date date,
  sent_by uuid,
  sent_at timestamptz,
  status text,
  decided_at timestamptz,
  archived_at timestamptz
);
create table public.route_stop_visits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid,
  created_by uuid,
  hub_id uuid,
  zone_id uuid,
  work_date date,
  visited_at timestamptz,
  near bool
);
create table public.pickup_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid,
  hub_id uuid,
  zone_id uuid,
  pickup_date date,
  submitted_at timestamptz,
  status text,
  decided_at timestamptz
);
create table public.sorting_handovers (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  hub_id uuid,
  zone_id uuid,
  work_date date,
  created_at timestamptz,
  status text,
  received_at timestamptz
);
create table public.hub_ops_reports (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid,
  hub_id uuid,
  zone_id uuid,
  report_date date,
  submitted_at timestamptz,
  status text,
  reviewed_at timestamptz
);
create table public.da_sessions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid,
  hub_id uuid,
  zone_id uuid,
  account_date date,
  submitted_at timestamptz,
  status text,
  verified_at timestamptz
);
create table public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  prepared_by uuid,
  hub_id uuid,
  zone_id uuid,
  recon_date date,
  created_at timestamptz,
  status text,
  decided_at timestamptz
);
create table public.leave_requests (
  employee_id uuid,
  status text,
  from_date date,
  to_date date
);
create table public.wf_absence_applications (
  employee_id uuid,
  hub_id uuid,
  zone_id uuid,
  status text,
  dates date[]
);
create table public.notifications (
  profile_id uuid,
  title text,
  body text,
  link text,
  kind text
);

alter table public.tasks enable row level security;
alter table public.job_duties enable row level security;
grant usage on schema private to authenticated;
grant select on public.tasks, public.job_duties, public.employees to authenticated;
grant insert, update on public.job_duties to authenticated;
revoke insert, update, delete on public.tasks from authenticated, anon;

-- Test double for surrounding ERP grants.
create function private.grants_of(p_user uuid, p_live boolean)
returns table(permission_code text, scope_type text, zone_id uuid, hub_id uuid, is_super boolean)
language sql stable security definer as $$
  select permission_code, u.scope_type, u.zone_id, u.hub_id, r.is_super
  from public.user_roles u join public.roles r on r.id = u.role_id
  cross join unnest(array['zonal.task.create', 'zonal.task.edit', 'zonal.task.view', 'hr.duty.edit', 'hr.duty.view']) permission_code
  where u.user_id = p_user and r.code in ('manager','zonal_manager','super_admin')
$$;
create function private.my_employee_id() returns uuid
language sql stable security definer as $$
  select e.id from public.employees e where e.profile_id = auth.uid() and e.archived_at is null limit 1
$$;
create function private.has_permission(p_perm text, p_zone uuid, p_hub uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from private.grants_of(auth.uid(), true) g
    where (g.permission_code = p_perm or g.is_super)
      and (g.scope_type = 'global' or (g.scope_type = 'zone' and g.zone_id = p_zone)
        or (g.scope_type = 'hub' and g.hub_id = p_hub)))
$$;
create function private.notify(p_profile uuid, p_title text, p_body text, p_link text, p_kind text)
returns void language sql as $$
  insert into public.notifications(profile_id,title,body,link,kind)
  values (p_profile,p_title,p_body,p_link,p_kind)
$$;
create function private.hub_zone(p_hub uuid) returns uuid language sql stable as $$
  select zone_id from public.hubs where id = p_hub
$$;
create function private.task_is_manager(p_task uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.tasks t where t.id = p_task
    and (t.accountable_manager_id = auth.uid() or t.created_by = auth.uid()
      or private.has_permission('zonal.task.edit', t.zone_id, t.hub_id)))
$$;
create policy fixture_task_read on public.tasks for select to authenticated
  using (assigned_to = auth.uid() or accountable_manager_id = auth.uid()
    or private.has_permission('zonal.task.view', zone_id, hub_id));
create policy fixture_duty_read on public.job_duties for select to authenticated using (archived_at is null);
create policy fixture_duty_insert on public.job_duties for insert to authenticated
  with check (private.has_permission('hr.duty.edit', zone_id, null));
create policy fixture_duty_update on public.job_duties for update to authenticated
  using (private.has_permission('hr.duty.edit', zone_id, null))
  with check (private.has_permission('hr.duty.edit', zone_id, null));
create table public.task_reminders (task_id uuid, remind_at timestamptz, note text);

create function public.task_assign(p_title text, p_assignee uuid, p_due date, p_zone uuid, p_hub uuid, p_description text, p_priority text, p_requires_submission boolean, p_manager uuid, p_employee uuid) returns uuid
language plpgsql security definer set search_path = '' as $legacy$

declare
  v_zone uuid := p_zone;
  v_id uuid;
begin
  if p_hub is not null then v_zone := private.hub_zone(p_hub); end if;
  if not private.has_permission('zonal.task.create', v_zone, p_hub) then
    raise exception 'Not authorised to assign tasks in this scope.' using errcode = '42501';
  end if;
  if p_due is null or p_due < current_date then
    raise exception 'The deadline must be today or later.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_assignee and p.status = 'active' and p.archived_at is null) then
    raise exception 'The assignee must be an active user.' using errcode = '22023';
  end if;
  if p_manager is not null and not exists (select 1 from public.profiles p where p.id = p_manager and p.status = 'active') then
    raise exception 'The accountable manager must be an active user.' using errcode = '22023';
  end if;

  insert into public.tasks (title, description, zone_id, hub_id, assigned_to, accountable_manager_id,
                            related_employee_id, due_date, priority, requires_submission)
  values (p_title, p_description, v_zone, p_hub, p_assignee, coalesce(p_manager, auth.uid()),
          p_employee, p_due, coalesce(p_priority, 'normal'), coalesce(p_requires_submission, false))
  returning id into v_id;

  -- default reminder: 09:00 on the day before the deadline
  if p_due - 1 > current_date then
    insert into public.task_reminders (task_id, remind_at, note)
    values (v_id, (p_due - 1) + time '09:00', 'Deadline tomorrow');
  end if;
  return v_id;
end 
$legacy$;

create function public.task_complete(p_task uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $legacy$

declare
  t public.tasks%rowtype;
  v_mgr boolean;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found or not authorised.' using errcode = '42501'; end if;
  v_mgr := private.task_is_manager(p_task);
  if not (v_mgr or t.assigned_to = auth.uid()) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then
    raise exception 'This task is already %.', t.status using errcode = 'P0001';
  end if;
  if t.requires_submission then
    if t.status <> 'submitted' then
      raise exception 'The assignee must submit the result before this task can be confirmed.' using errcode = 'P0001';
    end if;
    if not v_mgr or t.assigned_to = auth.uid() then
      raise exception 'A submitted task is confirmed by the accountable manager, not by the assignee.' using errcode = '42501';
    end if;
  end if;
  update public.tasks set status = 'completed', completed_at = now(), completed_by = auth.uid(), completion_note = p_note
   where id = p_task;
end 
$legacy$;

create function public.task_reassign(p_task uuid, p_assignee uuid, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $legacy$

declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not private.task_is_manager(p_task) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then raise exception 'This task is closed.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_due is null or p_due < current_date then raise exception 'The deadline must be today or later.' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_assignee and p.status = 'active' and p.archived_at is null) then
    raise exception 'The assignee must be an active user.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.tasks set assigned_to = p_assignee, due_date = p_due, status = 'assigned',
         submission_note = null, submitted_at = null where id = p_task;
end 
$legacy$;

create function public.task_update_progress(p_task uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $legacy$

declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or t.assigned_to <> auth.uid() then
    raise exception 'Only the assignee can update progress on a task.' using errcode = '42501';
  end if;
  if p_status not in ('in_progress','submitted') then
    raise exception 'Status must be in_progress or submitted.' using errcode = '22023';
  end if;
  if t.status not in ('assigned','in_progress') then
    raise exception 'This task is % and cannot be updated.', t.status using errcode = 'P0001';
  end if;
  if p_status = 'submitted' and coalesce(trim(p_note), '') = '' then
    raise exception 'Describe what was done when submitting a task.' using errcode = '22023';
  end if;
  if p_status = 'submitted' then
    update public.tasks set status = 'submitted', submission_note = p_note, submitted_at = now() where id = p_task;
  else
    update public.tasks set status = 'in_progress', progress_note = coalesce(p_note, progress_note) where id = p_task;
  end if;
end 
$legacy$;

create table public.issues (
  id uuid primary key, hub_id uuid, zone_id uuid, status text, solved_at timestamptz,
  approved_at timestamptz, approved_by uuid
);
create table public.issue_events (issue_id uuid, action text, at timestamptz, by_user uuid);
