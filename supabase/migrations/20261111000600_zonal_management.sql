-- =====================================================================
-- XZM-TEAM ERP — Migration 0006: Zonal management, analytics, workforce planning
--   * hub_daily_metrics   daily hub figures (pickup, delivery, merchants, rider
--                         capacity, cash, expenses, backlog, hours). Entered by the
--                         hub, verified by a second person. Only VERIFIED rows
--                         feed dashboards, reports and planning.
--   * hub_visits          Zonal Manager hub visits with km / fuel / meal /
--                         transport / other expenses
--   * travel_claims       weekly or monthly claim over the visits; approver is
--                         never the claimant; approval records the voucher number
--   * tasks, task_reminders   assignment, deadlines, submissions, accountability
--   * workforce_recommendations   saved planning recommendations (advisory only)
--   * dashboard, drill-down, comparison, data-completion and report functions
-- Rules:
--   * Planning output is ADVICE. Nothing in this migration hires, dismisses,
--     transfers, changes pay or disciplines anyone. Those stay in the audited
--     HR workflows and need an authorised person.
--   * Every figure is limited to the caller's zone / hub scope.
--   * Nothing is deleted.
-- NOTE: the detailed courier tables (parcels, pickups, cash handovers) are a
-- separate module. Until they exist, hub_daily_metrics is the operational
-- source; later that module will write the same rows from approved records.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'zonal.' || r || '.' || a, 'zonal', r, a, d from (values
  ('dashboard','view','Open the Zonal Manager dashboard'),
  ('hub_metric','view','View daily hub figures'),
  ('hub_metric','create','Enter daily hub figures'),
  ('hub_metric','approve','Verify or reopen daily hub figures'),
  ('visit','view','View hub visit reports of others'),
  ('visit','create','Record own hub visits and travel expenses'),
  ('claim','view','View travel claims'),
  ('claim','create','Submit travel claims'),
  ('claim','approve','Approve travel claims and record the voucher'),
  ('claim','reject','Return or reject travel claims'),
  ('task','view','View tasks in scope'),
  ('task','create','Assign tasks'),
  ('task','edit','Reassign, confirm or cancel tasks'),
  ('planning','view','View workforce planning recommendations'),
  ('planning','create','Save workforce planning recommendations'),
  ('planning','edit','Acknowledge or dismiss recommendations'),
  ('report','view','View zonal reports'),
  ('report','export','Export zonal reports (PDF / Excel)'),
  ('report','print','Print zonal reports')
) v(r, a, d);

-- Planning assumptions are configuration, not code.
insert into public.system_settings (key, value, description) values
  ('zonal.parcels_per_rider_day',  '45',  'Planning: parcels one rider can handle per day (pickup + delivery)'),
  ('zonal.backlog_clear_days',     '3',   'Planning: days within which a backlog should be cleared'),
  ('zonal.backlog_alert_days',     '1.5', 'Planning: backlog above this many days of deliveries needs review'),
  ('zonal.max_rider_hours_per_day','10',  'Planning: average rider hours per day above this needs review'),
  ('zonal.planning_min_days',      '5',   'Planning: minimum verified days of figures before any recommendation');

-- ---------------------------------------------------------------------
-- Daily hub figures
-- ---------------------------------------------------------------------
create table public.hub_daily_metrics (
  id              uuid primary key default gen_random_uuid(),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),   -- always follows the hub
  metric_date     date not null,
  pickup_count    integer not null default 0 check (pickup_count >= 0),
  delivery_count  integer not null default 0 check (delivery_count >= 0),
  pending_parcels integer not null default 0 check (pending_parcels >= 0),   -- backlog at end of day
  merchant_count  integer not null default 0 check (merchant_count >= 0),    -- merchants served
  rider_count     integer not null default 0 check (rider_count >= 0),       -- riders on duty
  rider_capacity  integer not null default 0 check (rider_capacity >= 0),    -- parcels those riders can handle
  working_hours   numeric(8,2) not null default 0 check (working_hours >= 0),-- total rider hours
  cash_collected  numeric(14,2) not null default 0 check (cash_collected >= 0),
  expenses        numeric(14,2) not null default 0 check (expenses >= 0),
  note            text,
  status          text not null default 'submitted' check (status in ('submitted','verified')),
  verified_by     uuid,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint hub_daily_metrics_one_per_day unique (hub_id, metric_date),
  constraint hub_daily_metrics_hours_chk check (working_hours <= rider_count * 24)
);
create index hub_daily_metrics_zone_idx on public.hub_daily_metrics (zone_id, metric_date);

create or replace function private.hub_metric_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker: see note in the HR migration
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if new.metric_date > current_date then
    raise exception 'Figures cannot be entered for a future date.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if private.is_api_user() and (new.status <> 'submitted' or new.verified_by is not null or new.verified_at is not null) then
      raise exception 'New figures start as submitted. A second person verifies them.' using errcode = '42501';
    end if;
    return new;
  end if;
  if private.is_api_user() then
    if old.status = 'verified' then
      raise exception 'Verified figures are locked. Ask a verifier to reopen them with a reason.' using errcode = '42501';
    end if;
    if (new.status, new.verified_by, new.verified_at, new.hub_id, new.metric_date)
       is distinct from (old.status, old.verified_by, old.verified_at, old.hub_id, old.metric_date) then
      raise exception 'Hub, date and verification state cannot be changed directly.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger hub_daily_metrics_guard before insert or update on public.hub_daily_metrics
  for each row execute function private.hub_metric_guard();

create or replace function public.zm_verify_hub_metric(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.hub_daily_metrics%rowtype;
begin
  select * into m from public.hub_daily_metrics where id = p_id for update;
  if m.id is null or not private.has_permission('zonal.hub_metric.approve', m.zone_id, m.hub_id) then
    raise exception 'Record not found or not authorised to verify.' using errcode = '42501';
  end if;
  if m.status = 'verified' then raise exception 'These figures are already verified.' using errcode = 'P0001'; end if;
  if m.created_by = auth.uid() then
    raise exception 'The person who entered the figures cannot verify them.' using errcode = '42501';
  end if;
  update public.hub_daily_metrics set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_id;
end $$;

create or replace function public.zm_reopen_hub_metric(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.hub_daily_metrics%rowtype;
begin
  select * into m from public.hub_daily_metrics where id = p_id for update;
  if m.id is null or not private.has_permission('zonal.hub_metric.approve', m.zone_id, m.hub_id) then
    raise exception 'Record not found or not authorised.' using errcode = '42501';
  end if;
  if m.status <> 'verified' then raise exception 'Only verified figures can be reopened.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.hub_daily_metrics set status = 'submitted', verified_by = null, verified_at = null where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Hub visits and travel claims
-- ---------------------------------------------------------------------
create sequence public.travel_claim_no_seq;

create table public.travel_claims (
  id               uuid primary key default gen_random_uuid(),
  claim_no         text not null unique default ('TC-' || lpad(nextval('public.travel_claim_no_seq')::text, 6, '0')),
  claimant_id      uuid not null references public.profiles(id),
  zone_id          uuid not null references public.zones(id),
  period_type      text not null check (period_type in ('weekly','monthly')),
  period_from      date not null,
  period_to        date not null,
  visit_count      integer not null check (visit_count > 0),
  total_km         numeric(10,1) not null default 0,
  fuel_amount      numeric(14,2) not null default 0,
  meal_amount      numeric(14,2) not null default 0,
  transport_amount numeric(14,2) not null default 0,
  other_amount     numeric(14,2) not null default 0,
  total_amount     numeric(14,2) not null default 0,
  status           text not null default 'submitted' check (status in ('submitted','approved','rejected','returned')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  voucher_no       text,          -- voucher reference recorded by the approver
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint travel_claims_period_chk check (period_to >= period_from),
  constraint travel_claims_voucher_chk check (status <> 'approved' or length(trim(coalesce(voucher_no, ''))) > 0)
);
create index travel_claims_zone_idx on public.travel_claims (zone_id, period_from);
create index travel_claims_claimant_idx on public.travel_claims (claimant_id, period_from);

create table public.hub_visits (
  id               uuid primary key default gen_random_uuid(),
  visitor_id       uuid not null default auth.uid() references public.profiles(id),
  hub_id           uuid not null references public.hubs(id),
  zone_id          uuid not null references public.zones(id),
  visit_date       date not null,
  purpose          text not null check (length(trim(purpose)) > 2),
  findings         text,
  distance_km      numeric(8,1) not null default 0 check (distance_km >= 0 and distance_km <= 2000),
  fuel_amount      numeric(12,2) not null default 0 check (fuel_amount >= 0),
  meal_amount      numeric(12,2) not null default 0 check (meal_amount >= 0),
  transport_amount numeric(12,2) not null default 0 check (transport_amount >= 0),
  other_amount     numeric(12,2) not null default 0 check (other_amount >= 0),
  other_note       text,
  total_amount     numeric(14,2) generated always as (fuel_amount + meal_amount + transport_amount + other_amount) stored,
  claim_id         uuid references public.travel_claims(id),
  archived_at      timestamptz,
  archived_by      uuid,
  archive_reason   text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint hub_visits_other_note_chk check (other_amount = 0 or length(trim(coalesce(other_note, ''))) > 0),
  constraint hub_visits_archive_chk check (archived_at is null or length(trim(coalesce(archive_reason, ''))) > 0)
);
create index hub_visits_visitor_idx on public.hub_visits (visitor_id, visit_date);
create index hub_visits_zone_idx on public.hub_visits (zone_id, visit_date);
create index hub_visits_claim_idx on public.hub_visits (claim_id);

create or replace function private.hub_visit_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if new.visit_date > current_date then
    raise exception 'A visit cannot be recorded for a future date.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if private.is_api_user() then
      new.visitor_id := auth.uid();
      if new.claim_id is not null or new.archived_at is not null then
        raise exception 'New visits cannot be created as claimed or archived.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if private.is_api_user() then
    if old.claim_id is not null then
      raise exception 'This visit is part of a submitted claim and can no longer be changed.' using errcode = '42501';
    end if;
    if old.archived_at is not null then
      raise exception 'Archived visits are read-only.' using errcode = '42501';
    end if;
    if (new.claim_id, new.visitor_id) is distinct from (old.claim_id, old.visitor_id) then
      raise exception 'Claim link and visitor cannot be changed directly.' using errcode = '42501';
    end if;
    if new.archived_at is not null then new.archived_by := auth.uid(); end if;
  end if;
  return new;
end $$;
create trigger hub_visits_guard before insert or update on public.hub_visits
  for each row execute function private.hub_visit_guard();

-- Bundle the caller's unclaimed visits of one week or month into a claim.
create or replace function public.zm_submit_claim(p_zone uuid, p_period_type text, p_from date, p_to date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v record;
begin
  if p_zone is null or p_from is null or p_to is null then
    raise exception 'Zone and period are required.' using errcode = '22023';
  end if;
  if not private.has_permission('zonal.claim.create', p_zone) then
    raise exception 'Not authorised to submit travel claims for this zone.' using errcode = '42501';
  end if;
  if p_period_type = 'weekly' then
    if p_to - p_from <> 6 then raise exception 'A weekly claim covers exactly 7 days.' using errcode = '22023'; end if;
  elsif p_period_type = 'monthly' then
    if p_from <> date_trunc('month', p_from::timestamp)::date
       or p_to <> (date_trunc('month', p_from::timestamp) + interval '1 month' - interval '1 day')::date then
      raise exception 'A monthly claim covers one full calendar month.' using errcode = '22023';
    end if;
  else
    raise exception 'Period type must be weekly or monthly.' using errcode = '22023';
  end if;

  select count(*)::int as n, coalesce(sum(hv.distance_km), 0) as km, coalesce(sum(hv.fuel_amount), 0) as fuel,
         coalesce(sum(hv.meal_amount), 0) as meal, coalesce(sum(hv.transport_amount), 0) as transport,
         coalesce(sum(hv.other_amount), 0) as other, coalesce(sum(hv.total_amount), 0) as total
    into v
  from public.hub_visits hv
  where hv.visitor_id = auth.uid() and hv.zone_id = p_zone and hv.visit_date between p_from and p_to
    and hv.claim_id is null and hv.archived_at is null;
  if v.n = 0 then
    raise exception 'There are no unclaimed visits in this period.' using errcode = 'P0001';
  end if;

  insert into public.travel_claims (claimant_id, zone_id, period_type, period_from, period_to, visit_count,
                                    total_km, fuel_amount, meal_amount, transport_amount, other_amount, total_amount)
  values (auth.uid(), p_zone, p_period_type, p_from, p_to, v.n, v.km, v.fuel, v.meal, v.transport, v.other, v.total)
  returning id into v_id;

  update public.hub_visits hv set claim_id = v_id
  where hv.visitor_id = auth.uid() and hv.zone_id = p_zone and hv.visit_date between p_from and p_to
    and hv.claim_id is null and hv.archived_at is null;
  return v_id;
end $$;

-- Approve (voucher number required), reject, or return for correction.
create or replace function public.zm_decide_claim(p_claim uuid, p_decision text, p_note text default null, p_voucher_no text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare c public.travel_claims%rowtype;
begin
  select * into c from public.travel_claims where id = p_claim for update;
  if p_decision not in ('approved','rejected','returned') then
    raise exception 'Decision must be approved, rejected or returned.' using errcode = '22023';
  end if;
  if c.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'zonal.claim.approve' else 'zonal.claim.reject' end, c.zone_id) then
    raise exception 'Claim not found or not authorised.' using errcode = '42501';
  end if;
  if c.claimant_id = auth.uid() then
    raise exception 'You cannot decide your own travel claim.' using errcode = '42501';
  end if;
  if c.status <> 'submitted' then
    raise exception 'This claim has already been decided.' using errcode = 'P0001';
  end if;
  if p_decision = 'approved' and coalesce(trim(p_voucher_no), '') = '' then
    raise exception 'A voucher number is required to approve a claim.' using errcode = '22023';
  end if;
  if p_decision <> 'approved' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a claim is returned or rejected.' using errcode = '22023';
  end if;

  perform set_config('app.change_reason', coalesce(p_note, p_decision), true);
  update public.travel_claims
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
         voucher_no = case when p_decision = 'approved' then trim(p_voucher_no) end
   where id = p_claim;
  if p_decision = 'returned' then   -- visits become editable again and can be claimed anew
    update public.hub_visits set claim_id = null where claim_id = p_claim;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------
create sequence public.task_no_seq;

create table public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  task_no                text not null unique default ('T-' || lpad(nextval('public.task_no_seq')::text, 6, '0')),
  title                  text not null check (length(trim(title)) > 2),
  description            text,
  zone_id                uuid references public.zones(id),     -- null = company-wide
  hub_id                 uuid references public.hubs(id),
  assigned_to            uuid not null references public.profiles(id),
  accountable_manager_id uuid not null references public.profiles(id),  -- answers for the result
  related_employee_id    uuid references public.employees(id),
  due_date               date not null,
  priority               text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  requires_submission    boolean not null default false,   -- assignee submits, manager confirms
  status                 text not null default 'assigned'
                         check (status in ('assigned','in_progress','submitted','completed','cancelled')),
  progress_note          text,
  submission_note        text,
  submitted_at           timestamptz,
  completed_at           timestamptz,
  completed_by           uuid,
  completion_note        text,
  cancelled_reason       text,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);
create index tasks_assignee_idx on public.tasks (assigned_to) where status not in ('completed','cancelled');
create index tasks_manager_idx on public.tasks (accountable_manager_id, due_date);
create index tasks_scope_idx on public.tasks (zone_id, hub_id, status);
create index tasks_due_idx on public.tasks (due_date) where status not in ('completed','cancelled');

create table public.task_reminders (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id),
  remind_at   timestamptz not null,
  note        text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index task_reminders_due_idx on public.task_reminders (remind_at) where sent_at is null;

create or replace function private.task_scope_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.hub_id is not null then new.zone_id := private.hub_zone(new.hub_id); end if;
  return new;
end $$;
create trigger tasks_scope_guard before insert or update on public.tasks
  for each row execute function private.task_scope_guard();

-- May the caller manage (confirm / reassign / cancel) this task?
create or replace function private.task_is_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select t.accountable_manager_id = auth.uid() or t.created_by = auth.uid()
                          or private.has_permission('zonal.task.edit', t.zone_id, t.hub_id)
                   from public.tasks t where t.id = p_task), false)
$$;

create or replace function public.task_assign(
  p_title text, p_assignee uuid, p_due date,
  p_zone uuid default null, p_hub uuid default null, p_description text default null,
  p_priority text default 'normal', p_requires_submission boolean default false,
  p_manager uuid default null, p_employee uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- Assignee: start work, or submit the result for confirmation.
create or replace function public.task_update_progress(p_task uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- Manager: send a submission back for more work.
create or replace function public.task_return(p_task uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not private.task_is_manager(p_task) or t.assigned_to = auth.uid() then
    raise exception 'Only the accountable manager can return a submission.' using errcode = '42501';
  end if;
  if t.status <> 'submitted' then raise exception 'Only submitted tasks can be returned.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_note, true);
  update public.tasks set status = 'in_progress', progress_note = 'Returned: ' || p_note, submitted_at = null where id = p_task;
end $$;

-- Completion. Tasks that require a submission are confirmed by the manager,
-- never by the assignee.
create or replace function public.task_complete(p_task uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
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
end $$;

create or replace function public.task_reassign(p_task uuid, p_assignee uuid, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
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
end $$;

create or replace function public.task_cancel(p_task uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not private.task_is_manager(p_task) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then raise exception 'This task is closed.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.tasks set status = 'cancelled', cancelled_reason = p_reason where id = p_task;
end $$;

create or replace function public.task_add_reminder(p_task uuid, p_remind_at timestamptz, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks%rowtype;
  v_id uuid;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not (t.assigned_to = auth.uid() or private.task_is_manager(p_task)) then
    raise exception 'Task not found or not authorised.' using errcode = '42501';
  end if;
  if t.status in ('completed','cancelled') then raise exception 'This task is closed.' using errcode = 'P0001'; end if;
  if p_remind_at is null or p_remind_at <= now() then
    raise exception 'The reminder time must be in the future.' using errcode = '22023';
  end if;
  insert into public.task_reminders (task_id, remind_at, note) values (p_task, p_remind_at, p_note) returning id into v_id;
  return v_id;
end $$;

-- Called by the scheduled server job (service role only). Marks due reminders
-- as sent and returns them so the job can deliver the notifications.
create or replace function public.task_due_reminders()
returns table (reminder_id uuid, task_id uuid, task_no text, title text, assigned_to uuid, due_date date, note text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  update public.task_reminders r set sent_at = now()
  from public.tasks t
  where t.id = r.task_id and r.sent_at is null and r.remind_at <= now()
    and t.status not in ('completed','cancelled')
  returning r.id, t.id, t.task_no, t.title, t.assigned_to, t.due_date, r.note;
end $$;

-- Per accountable manager: what was assigned, finished on time, overdue, waiting.
create or replace function public.zm_task_accountability(p_from date, p_to date, p_zone uuid default null)
returns table (manager_id uuid, manager_name text, assigned bigint, completed bigint, completed_on_time bigint,
               overdue bigint, pending_submissions bigint, awaiting_confirmation bigint, on_time_pct numeric)
language sql stable security definer set search_path = '' as $$
  select q.manager_id, q.manager_name, q.assigned, q.completed, q.completed_on_time, q.overdue,
         q.pending_submissions, q.awaiting_confirmation,
         round(100.0 * q.completed_on_time / nullif(q.completed, 0), 1)
  from (
    select t.accountable_manager_id as manager_id, p.full_name as manager_name,
           count(*) filter (where t.status <> 'cancelled') as assigned,
           count(*) filter (where t.status = 'completed') as completed,
           count(*) filter (where t.status = 'completed' and t.completed_at::date <= t.due_date) as completed_on_time,
           count(*) filter (where t.status not in ('completed','cancelled') and t.due_date < current_date) as overdue,
           count(*) filter (where t.requires_submission and t.status in ('assigned','in_progress')) as pending_submissions,
           count(*) filter (where t.status = 'submitted') as awaiting_confirmation
    from public.tasks t
    join public.profiles p on p.id = t.accountable_manager_id
    where t.due_date between p_from and p_to
      and (p_zone is null or t.zone_id = p_zone)
      and (t.accountable_manager_id = auth.uid() or private.has_permission('zonal.task.view', t.zone_id, t.hub_id))
    group by t.accountable_manager_id, p.full_name
  ) q
  order by q.overdue desc, q.manager_name
$$;

-- ---------------------------------------------------------------------
-- Workforce statistics (dashboard numbers and the records behind them)
-- ---------------------------------------------------------------------
-- One function returns the rows behind every statistic, and the dashboard
-- counts those same rows, so a number always matches the list it opens.
create or replace function public.zm_workforce_details(
  p_stat text, p_zone uuid, p_from date, p_to date, p_hub uuid default null
) returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, hub_name text,
                 position_name text, status text, event_date date, detail text)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, e.hub_id, h.name, po.name, e.status, x.event_date, x.detail
  from public.employees e
  left join public.hubs h on h.id = e.hub_id
  left join public.positions po on po.id = e.position_id
  join lateral (
    select e.joining_date as event_date, null::text as detail
      where p_stat = 'total' and e.status in ('active','inactive')
    union all
    select e.status_since, null::text where p_stat = 'active' and e.status = 'active'
    union all
    select e.status_since, null::text where p_stat = 'inactive' and e.status = 'inactive'
    union all
    select e.joining_date, null::text
      where p_stat = 'new_joining' and e.status not in ('applicant','rejected') and e.joining_date between p_from and p_to
    union all
    select sh.effective_date, sh.reason from public.employee_status_history sh
      where p_stat = 'resigned' and sh.employee_id = e.id and sh.to_status = 'resigned'
        and sh.effective_date between p_from and p_to
    union all
    select a.effective_from, a.reason from public.employee_assignments a
      where p_stat = 'transferred' and a.employee_id = e.id and a.change_type = 'transfer'
        and a.effective_from between p_from and p_to
    union all
    select ap.reviewed_at::date, ap.review_note from public.employee_applications ap
      where p_stat = 'employee_id_issued' and ap.employee_id = e.id and ap.status = 'approved'
        and ap.reviewed_at::date between p_from and p_to
    union all
    select ap.submitted_at::date, null::text from public.employee_applications ap
      where p_stat = 'pending_applications' and ap.employee_id = e.id and ap.status = 'submitted'
  ) x on true
  where e.archived_at is null
    and (p_zone is null or e.zone_id = p_zone)
    and (p_hub is null or e.hub_id = p_hub)
  order by x.event_date desc nulls last, e.full_name
$$;

-- Missing profile information, from the ACTIVE profile requirements:
-- core fields + standard documents + documents required by settings + required
-- custom fields. Runs with definer rights so a manager without access to NID
-- images still learns WHETHER they are on file (never their content).
create or replace function public.zm_data_completion(p_zone uuid default null, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, hub_id uuid, hub_name text,
               missing text[], total_checks integer, completion_pct numeric)
language sql stable security definer set search_path = '' as $$
  with req_docs as (
    select distinct q.doc_type from (
      select unnest(array['photo','nid_front','nid_back','signature','cv']::text[]) as doc_type
      union all
      select jsonb_array_elements_text(s.value) from public.system_settings s where s.key = 'hr.required_documents'
    ) q
  ),
  req_fields as (
    select f.id, f.code::text as code, f.sort_order
    from public.employee_custom_fields f where f.is_required and f.archived_at is null
  ),
  totals as (
    select (4 + (select count(*) from req_docs) + (select count(*) from req_fields))::integer as n
  ),
  base as (
    select e.id, e.employee_code::text as code, e.full_name, e.hub_id, h.name as hub_name,
      array_remove(array[
        case when e.mobile is null then 'mobile'::text end,
        case when e.joining_date is null then 'joining_date'::text end,
        case when e.position_id is null then 'position'::text end,
        case when e.hub_id is null then 'hub'::text end
      ], null)
      || coalesce((select array_agg(r.doc_type order by r.doc_type) from req_docs r
                   where not exists (select 1 from public.employee_documents d
                                     where d.employee_id = e.id and d.doc_type = r.doc_type and d.archived_at is null)),
                  '{}'::text[])
      || coalesce((select array_agg('field:' || f.code order by f.sort_order) from req_fields f
                   where not exists (select 1 from public.employee_custom_field_values v
                                     where v.field_id = f.id and v.employee_id = e.id)),
                  '{}'::text[]) as missing
    from public.employees e
    left join public.hubs h on h.id = e.hub_id
    where e.status = 'active' and e.archived_at is null
      and (p_zone is null or e.zone_id = p_zone)
      and (p_hub is null or e.hub_id = p_hub)
      and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  )
  select b.id, b.code, b.full_name, b.hub_id, b.hub_name, b.missing, t.n,
         round(100.0 * (t.n - cardinality(b.missing)) / t.n, 1)
  from base b cross join totals t
  order by cardinality(b.missing) desc, b.full_name
$$;

-- ---------------------------------------------------------------------
-- Hub performance and comparison (verified figures only)
-- ---------------------------------------------------------------------
create or replace function public.zm_hub_performance(p_zone uuid, p_from date, p_to date)
returns table (hub_id uuid, hub_code text, hub_name text, days_verified integer, days_unverified integer,
               pickups bigint, deliveries bigint, merchants integer, avg_rider_capacity numeric, avg_riders numeric,
               cash_collected numeric, expenses numeric, pending_parcels integer,
               parcels_per_rider_day numeric, expense_per_parcel numeric, volume_share_pct numeric, volume_rank integer)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select hb.id, hb.code::text as code, hb.name,
      (count(d.id) filter (where d.status = 'verified'))::integer as days_v,
      (count(d.id) filter (where d.status = 'submitted'))::integer as days_u,
      coalesce(sum(d.pickup_count) filter (where d.status = 'verified'), 0)::bigint as pk,
      coalesce(sum(d.delivery_count) filter (where d.status = 'verified'), 0)::bigint as dl,
      (array_agg(d.merchant_count order by d.metric_date desc) filter (where d.status = 'verified'))[1] as merchants,
      (array_agg(d.pending_parcels order by d.metric_date desc) filter (where d.status = 'verified'))[1] as pending,
      avg(d.rider_capacity) filter (where d.status = 'verified') as cap,
      avg(d.rider_count) filter (where d.status = 'verified') as riders,
      coalesce(sum(d.rider_count) filter (where d.status = 'verified'), 0) as rider_days,
      coalesce(sum(d.cash_collected) filter (where d.status = 'verified'), 0) as cash,
      coalesce(sum(d.expenses) filter (where d.status = 'verified'), 0) as spent
    from public.hubs hb
    left join public.hub_daily_metrics d on d.hub_id = hb.id and d.metric_date between p_from and p_to
    where hb.archived_at is null and (p_zone is null or hb.zone_id = p_zone)
    group by hb.id, hb.code, hb.name
  )
  select m.id, m.code, m.name, m.days_v, m.days_u, m.pk, m.dl, coalesce(m.merchants, 0),
         round(m.cap, 1), round(m.riders, 1), m.cash, m.spent, coalesce(m.pending, 0),
         round((m.pk + m.dl)::numeric / nullif(m.rider_days, 0), 1),
         round(m.spent / nullif(m.pk + m.dl, 0), 2),
         round(100.0 * (m.pk + m.dl) / nullif(sum(m.pk + m.dl) over (), 0), 1),
         (rank() over (order by (m.pk + m.dl) desc))::integer
  from m
  order by (m.pk + m.dl) desc, m.name
$$;

-- ---------------------------------------------------------------------
-- Zonal dashboard
-- ---------------------------------------------------------------------
create or replace function public.zm_dashboard(p_zone uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  -- p_zone null = whole company and needs a global grant
  if not private.has_permission('zonal.dashboard.view', p_zone) then
    raise exception 'Not authorised to open the zonal dashboard for this zone.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'workforce', (
      select jsonb_object_agg(s.stat, (select count(*) from public.zm_workforce_details(s.stat, p_zone, p_from, p_to)))
      from unnest(array['total','active','inactive','new_joining','resigned','transferred',
                        'employee_id_issued','pending_applications']::text[]) as s(stat)),
    'hubs', (
      select jsonb_build_object(
        'hub_count', count(*),
        'pickups', coalesce(sum(hp.pickups), 0),
        'deliveries', coalesce(sum(hp.deliveries), 0),
        'merchants', coalesce(sum(hp.merchants), 0),
        'rider_capacity', coalesce(sum(hp.avg_rider_capacity), 0),
        'cash_collected', coalesce(sum(hp.cash_collected), 0),
        'expenses', coalesce(sum(hp.expenses), 0),
        'pending_parcels', coalesce(sum(hp.pending_parcels), 0),
        'unverified_days', coalesce(sum(hp.days_unverified), 0))
      from public.zm_hub_performance(p_zone, p_from, p_to) hp),
    'data_completion', (
      select jsonb_build_object(
        'employees', count(*),
        'incomplete', count(*) filter (where cardinality(dc.missing) > 0),
        'average_pct', coalesce(round(avg(dc.completion_pct), 1), 100))
      from public.zm_data_completion(p_zone, null) dc),
    'tasks', (
      select jsonb_build_object(
        'open', count(*) filter (where t.status in ('assigned','in_progress','submitted')),
        'overdue', count(*) filter (where t.status in ('assigned','in_progress','submitted') and t.due_date < current_date),
        'pending_submissions', count(*) filter (where t.requires_submission and t.status in ('assigned','in_progress')),
        'awaiting_confirmation', count(*) filter (where t.status = 'submitted'),
        'completed', count(*) filter (where t.status = 'completed' and t.completed_at::date between p_from and p_to))
      from public.tasks t where p_zone is null or t.zone_id = p_zone),
    'travel', (
      select jsonb_build_object(
        'visits', count(*),
        'total_km', coalesce(sum(hv.distance_km), 0),
        'fuel', coalesce(sum(hv.fuel_amount), 0),
        'meal', coalesce(sum(hv.meal_amount), 0),
        'transport', coalesce(sum(hv.transport_amount), 0),
        'other', coalesce(sum(hv.other_amount), 0),
        'total', coalesce(sum(hv.total_amount), 0),
        'unclaimed', count(*) filter (where hv.claim_id is null))
      from public.hub_visits hv
      where hv.archived_at is null and hv.visit_date between p_from and p_to
        and (p_zone is null or hv.zone_id = p_zone)),
    'claims_pending', (
      select count(*) from public.travel_claims c
      where c.status = 'submitted' and (p_zone is null or c.zone_id = p_zone))
  );
end $$;

-- ---------------------------------------------------------------------
-- Workforce planning (advisory only)
-- ---------------------------------------------------------------------
create table public.workforce_recommendations (
  id            uuid primary key default gen_random_uuid(),
  zone_id       uuid not null references public.zones(id),
  hub_id        uuid not null references public.hubs(id),
  period_from   date not null,
  period_to     date not null,
  -- Only advisory categories exist. There is deliberately no category that
  -- hires, dismisses, changes pay or disciplines.
  kind          text not null check (kind in
                ('add_riders','rebalance_riders','review_backlog','review_overtime','data_gap','no_change')),
  summary       text not null,
  evidence      jsonb not null,
  assumptions   jsonb not null,
  status        text not null default 'proposed' check (status in ('proposed','acknowledged','dismissed')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  constraint workforce_recommendations_period_chk check (period_to >= period_from),
  constraint workforce_recommendations_evidence_chk check (jsonb_typeof(evidence) = 'object' and jsonb_typeof(assumptions) = 'array')
);
create index workforce_recommendations_zone_idx on public.workforce_recommendations (zone_id, period_from desc);
comment on table public.workforce_recommendations is
  'Advisory planning output. A recommendation never changes employees, pay or status; an authorised person decides and acts through the HR workflows.';

-- Computes recommendations for every active hub of a zone from VERIFIED daily
-- figures. Returns evidence and assumptions with each one. p_save stores them.
create or replace function public.zm_workforce_plan(p_zone uuid, p_from date, p_to date, p_save boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ppr      numeric := coalesce(private.setting_text('zonal.parcels_per_rider_day')::numeric, 45);
  v_clear    numeric := coalesce(private.setting_text('zonal.backlog_clear_days')::numeric, 3);
  v_alert    numeric := coalesce(private.setting_text('zonal.backlog_alert_days')::numeric, 1.5);
  v_maxh     numeric := coalesce(private.setting_text('zonal.max_rider_hours_per_day')::numeric, 10);
  v_min_days integer := coalesce(private.setting_text('zonal.planning_min_days')::integer, 5);
  v_len      integer;
  h          record;
  c          record;
  pv         record;
  e          jsonb;
  v_rows     jsonb := '[]'::jsonb;
  v_items    jsonb := '[]'::jsonb;
  v_assume   jsonb;
  v_evidence jsonb;
  v_kind     text;
  v_summary  text;
  v_required integer;
  v_gap      integer;
  v_surplus  text;
  v_days     integer;
begin
  if p_zone is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'Zone and a valid period are required.' using errcode = '22023';
  end if;
  if not private.has_permission('zonal.planning.view', p_zone) then
    raise exception 'Not authorised to view workforce planning for this zone.' using errcode = '42501';
  end if;
  if p_save and not private.has_permission('zonal.planning.create', p_zone) then
    raise exception 'Not authorised to save workforce recommendations.' using errcode = '42501';
  end if;
  if v_ppr <= 0 or v_clear <= 0 then
    raise exception 'Planning settings must be greater than zero.' using errcode = '22023';
  end if;
  v_len := p_to - p_from + 1;

  v_assume := jsonb_build_array(
    format('One rider handles about %s parcels per day (pickup + delivery).', v_ppr),
    format('A backlog should be cleared within %s day(s).', v_clear),
    format('A backlog above %s day(s) of deliveries needs review.', v_alert),
    format('Average rider hours above %s per day need review.', v_maxh),
    format('At least %s verified day(s) of figures are needed for a recommendation.', v_min_days),
    'Only verified daily hub figures are used; unverified days are ignored.',
    'Rider numbers are riders on duty as reported by the hub, not contracts or headcount.',
    'Seasonal peaks, holidays, route distance and parcel size are not modelled.');

  -- pass 1: measure every active hub
  for h in select hb.id, hb.name, hb.code::text as code from public.hubs hb
           where hb.zone_id = p_zone and hb.status = 'active' and hb.archived_at is null order by hb.name
  loop
    select count(*)::integer as days,
           avg(m.pickup_count) as avg_pickup, avg(m.delivery_count) as avg_delivery,
           avg(m.pickup_count + m.delivery_count) as avg_workload,
           avg(m.rider_count) as avg_riders, avg(m.rider_capacity) as avg_capacity,
           sum(m.working_hours) as hours, sum(m.rider_count) as rider_days,
           (array_agg(m.pending_parcels order by m.metric_date desc))[1] as backlog,
           (array_agg(m.merchant_count order by m.metric_date desc))[1] as merchants
      into c
    from public.hub_daily_metrics m
    where m.hub_id = h.id and m.status = 'verified' and m.metric_date between p_from and p_to;

    select count(*)::integer as days, avg(m.pickup_count + m.delivery_count) as avg_workload
      into pv
    from public.hub_daily_metrics m
    where m.hub_id = h.id and m.status = 'verified' and m.metric_date between p_from - v_len and p_from - 1;

    v_required := null; v_gap := null;
    if c.days >= v_min_days then
      v_required := ceil((c.avg_workload + coalesce(c.backlog, 0) / v_clear) / v_ppr)::integer;
      v_gap := v_required - round(c.avg_riders)::integer;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'hub_id', h.id, 'hub_name', h.name, 'hub_code', h.code,
      'days_of_data', c.days,
      'avg_pickup_per_day', round(c.avg_pickup, 1),
      'avg_delivery_per_day', round(c.avg_delivery, 1),
      'avg_workload_per_day', round(c.avg_workload, 1),
      'avg_riders_on_duty', round(c.avg_riders, 1),
      'avg_rider_capacity', round(c.avg_capacity, 1),
      'capacity_used_pct', round(100 * c.avg_workload / nullif(c.avg_capacity, 0), 1),
      'backlog_parcels', c.backlog,
      'backlog_days', round(c.backlog / nullif(c.avg_delivery, 0), 2),
      'merchants', c.merchants,
      'hours_per_rider_day', round(c.hours / nullif(c.rider_days, 0), 1),
      'workload_trend_pct', case when pv.days >= v_min_days
                                 then round(100 * (c.avg_workload - pv.avg_workload) / nullif(pv.avg_workload, 0), 1) end,
      'previous_period_days', pv.days,
      'riders_needed', v_required,
      'rider_gap', v_gap);
  end loop;

  -- a hub with clearly more riders than its workload needs
  select r ->> 'hub_name' into v_surplus
  from jsonb_array_elements(v_rows) r
  where (r ->> 'rider_gap')::integer <= -2
  order by (r ->> 'rider_gap')::integer limit 1;

  -- pass 2: one recommendation per hub
  for e in select * from jsonb_array_elements(v_rows) loop
    v_days := (e ->> 'days_of_data')::integer;
    v_gap := (e ->> 'rider_gap')::integer;
    if v_days < v_min_days then
      v_kind := 'data_gap';
      v_summary := format('%s has only %s verified day(s) of figures in this period; at least %s are needed. No recommendation is made.',
                          e ->> 'hub_name', v_days, v_min_days);
    elsif v_gap >= 1 and ((e ->> 'capacity_used_pct')::numeric > 100 or (e ->> 'backlog_days')::numeric > v_alert) then
      if v_surplus is not null and v_surplus <> (e ->> 'hub_name') then
        v_kind := 'rebalance_riders';
        v_summary := format('%s needs about %s riders for its workload but has %s on duty on average. %s appears to have spare riders: review a temporary reallocation before considering recruitment.',
                            e ->> 'hub_name', e ->> 'riders_needed', e ->> 'avg_riders_on_duty', v_surplus);
      else
        v_kind := 'add_riders';
        v_summary := format('%s needs about %s riders for its workload and backlog but has %s on duty on average. Consider requesting %s additional rider(s); HR and management decide.',
                            e ->> 'hub_name', e ->> 'riders_needed', e ->> 'avg_riders_on_duty', v_gap);
      end if;
    elsif (e ->> 'backlog_days')::numeric > v_alert then
      v_kind := 'review_backlog';
      v_summary := format('%s holds %s pending parcels, about %s day(s) of deliveries. Rider numbers look sufficient: review routing, attendance and failed deliveries.',
                          e ->> 'hub_name', e ->> 'backlog_parcels', e ->> 'backlog_days');
    elsif (e ->> 'hours_per_rider_day')::numeric > v_maxh then
      v_kind := 'review_overtime';
      v_summary := format('Riders at %s average %s hours per day, above the %s-hour guide. Review shifts and workload distribution.',
                          e ->> 'hub_name', e ->> 'hours_per_rider_day', v_maxh);
    else
      v_kind := 'no_change';
      v_summary := format('%s is handling its workload with the riders on duty. No change is suggested.', e ->> 'hub_name');
    end if;

    v_evidence := (e - 'hub_id' - 'hub_name' - 'hub_code') || jsonb_build_object(
      'source', 'hub_daily_metrics (verified rows only)',
      'period_from', p_from, 'period_to', p_to);

    v_items := v_items || jsonb_build_object(
      'hub_id', e ->> 'hub_id', 'hub_name', e ->> 'hub_name', 'hub_code', e ->> 'hub_code',
      'kind', v_kind, 'summary', v_summary, 'evidence', v_evidence, 'assumptions', v_assume);

    if p_save then
      insert into public.workforce_recommendations (zone_id, hub_id, period_from, period_to, kind, summary, evidence, assumptions)
      values (p_zone, (e ->> 'hub_id')::uuid, p_from, p_to, v_kind, v_summary, v_evidence, v_assume);
    end if;
  end loop;

  return jsonb_build_object(
    'zone_id', p_zone, 'period_from', p_from, 'period_to', p_to, 'generated_at', now(), 'saved', p_save,
    'policy', 'Advisory only. The system never hires, dismisses, transfers, changes pay or disciplines anyone. Every recommendation needs a decision by an authorised person through the normal HR workflow.',
    'assumptions', v_assume,
    'items', v_items);
end $$;

-- A person records that they have seen / set aside a recommendation. This
-- changes nothing else in the system.
create or replace function public.zm_review_recommendation(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.workforce_recommendations%rowtype;
begin
  select * into r from public.workforce_recommendations where id = p_id for update;
  if r.id is null or not private.has_permission('zonal.planning.edit', r.zone_id) then
    raise exception 'Recommendation not found or not authorised.' using errcode = '42501';
  end if;
  if p_status not in ('acknowledged','dismissed') then
    raise exception 'Status must be acknowledged or dismissed.' using errcode = '22023';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  if r.status <> 'proposed' then raise exception 'This recommendation has already been reviewed.' using errcode = 'P0001'; end if;
  perform set_config('app.change_reason', p_note, true);
  update public.workforce_recommendations
     set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Reports (the application renders these as PDF, Excel or a print view)
-- ---------------------------------------------------------------------
-- Operations: p_group = week | month | hub | zone
create or replace function public.zm_report_operations(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (group_key text, group_label text, days_reported integer, pickups bigint, deliveries bigint,
                 cash_collected numeric, expenses numeric, avg_pending_parcels numeric)
language sql stable security invoker set search_path = '' as $$
  select k.gkey, k.glabel, (count(distinct d.metric_date))::integer,
         sum(d.pickup_count)::bigint, sum(d.delivery_count)::bigint,
         sum(d.cash_collected), sum(d.expenses), round(avg(d.pending_parcels), 1)
  from public.hub_daily_metrics d
  join public.hubs h on h.id = d.hub_id
  join public.zones z on z.id = d.zone_id
  cross join lateral (
    select case p_group
             when 'week'  then to_char(date_trunc('week', d.metric_date::timestamp), 'YYYY-MM-DD')
             when 'month' then to_char(d.metric_date::timestamp, 'YYYY-MM')
             when 'hub'   then h.code::text
             when 'zone'  then z.code::text end as gkey,
           case p_group
             when 'week'  then 'Week of ' || to_char(date_trunc('week', d.metric_date::timestamp), 'DD/MM/YYYY')
             when 'month' then to_char(d.metric_date::timestamp, 'Mon YYYY')
             when 'hub'   then h.name
             when 'zone'  then z.name end as glabel
  ) k
  where d.status = 'verified' and d.metric_date between p_from and p_to
    and p_group in ('week','month','hub','zone')
    and (p_zone is null or d.zone_id = p_zone)
    and (p_hub is null or d.hub_id = p_hub)
  group by k.gkey, k.glabel
  order by k.gkey
$$;

-- Workforce: p_group = hub | zone | department
create or replace function public.zm_report_workforce(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (group_key text, group_label text, headcount bigint, active bigint, inactive bigint,
                 new_joining bigint, resigned bigint, transferred bigint)
language sql stable security invoker set search_path = '' as $$
  select k.gkey, k.glabel,
         count(*) filter (where e.status in ('active','inactive')),
         count(*) filter (where e.status = 'active'),
         count(*) filter (where e.status = 'inactive'),
         count(*) filter (where e.status not in ('applicant','rejected') and e.joining_date between p_from and p_to),
         count(*) filter (where f.has_resigned),
         count(*) filter (where f.has_transfer)
  from public.employees e
  left join public.hubs h on h.id = e.hub_id
  left join public.zones z on z.id = e.zone_id
  left join public.departments dp on dp.id = e.department_id
  cross join lateral (
    select exists (select 1 from public.employee_status_history sh
                   where sh.employee_id = e.id and sh.to_status = 'resigned'
                     and sh.effective_date between p_from and p_to) as has_resigned,
           exists (select 1 from public.employee_assignments a
                   where a.employee_id = e.id and a.change_type = 'transfer'
                     and a.effective_from between p_from and p_to) as has_transfer
  ) f
  cross join lateral (
    select case p_group when 'hub' then coalesce(h.code::text, '-')
                        when 'zone' then coalesce(z.code::text, '-')
                        when 'department' then coalesce(dp.code::text, '-') end as gkey,
           case p_group when 'hub' then coalesce(h.name, 'No hub')
                        when 'zone' then coalesce(z.name, 'No zone')
                        when 'department' then coalesce(dp.name, 'No department') end as glabel
  ) k
  where e.archived_at is null and p_group in ('hub','zone','department')
    and (p_zone is null or e.zone_id = p_zone)
    and (p_hub is null or e.hub_id = p_hub)
  group by k.gkey, k.glabel
  order by k.glabel
$$;

-- Employee-wise report: one row per employee with attendance and task counts.
create or replace function public.zm_report_employees(
  p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (employee_id uuid, employee_code text, full_name text, zone_name text, hub_name text,
                 department_name text, position_name text, status text, joining_date date,
                 present_days bigint, absent_days bigint, leave_days bigint, open_tasks bigint, overdue_tasks bigint)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, z.name, h.name, dp.name, po.name, e.status, e.joining_date,
         a.present_days, a.absent_days, a.leave_days, tk.open_tasks, tk.overdue_tasks
  from public.employees e
  left join public.zones z on z.id = e.zone_id
  left join public.hubs h on h.id = e.hub_id
  left join public.departments dp on dp.id = e.department_id
  left join public.positions po on po.id = e.position_id
  cross join lateral (
    select count(*) filter (where ar.status in ('present','late','half_day')) as present_days,
           count(*) filter (where ar.status = 'absent') as absent_days,
           count(*) filter (where ar.status = 'leave') as leave_days
    from public.attendance_records ar
    where ar.employee_id = e.id and ar.work_date between p_from and p_to
  ) a
  cross join lateral (
    select count(*) as open_tasks,
           count(*) filter (where t.due_date < current_date) as overdue_tasks
    from public.tasks t
    where t.status in ('assigned','in_progress','submitted')
      and (t.related_employee_id = e.id or (e.profile_id is not null and t.assigned_to = e.profile_id))
  ) tk
  where e.archived_at is null and e.status not in ('applicant','rejected')
    and (p_zone is null or e.zone_id = p_zone)
    and (p_hub is null or e.hub_id = p_hub)
  order by z.name, h.name, e.full_name
$$;

-- Hub visit & travel report: p_group = week | month
create or replace function public.zm_visit_report(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_visitor uuid default null
) returns table (group_key text, group_label text, visits bigint, hubs_visited bigint, total_km numeric,
                 fuel numeric, meal numeric, transport numeric, other numeric, total numeric,
                 claimed numeric, approved numeric)
language sql stable security invoker set search_path = '' as $$
  select k.gkey, k.glabel, count(*), count(distinct hv.hub_id), sum(hv.distance_km),
         sum(hv.fuel_amount), sum(hv.meal_amount), sum(hv.transport_amount), sum(hv.other_amount), sum(hv.total_amount),
         coalesce(sum(hv.total_amount) filter (where hv.claim_id is not null), 0),
         coalesce(sum(hv.total_amount) filter (where c.status = 'approved'), 0)
  from public.hub_visits hv
  left join public.travel_claims c on c.id = hv.claim_id
  cross join lateral (
    select case p_group
             when 'week'  then to_char(date_trunc('week', hv.visit_date::timestamp), 'YYYY-MM-DD')
             when 'month' then to_char(hv.visit_date::timestamp, 'YYYY-MM') end as gkey,
           case p_group
             when 'week'  then 'Week of ' || to_char(date_trunc('week', hv.visit_date::timestamp), 'DD/MM/YYYY')
             when 'month' then to_char(hv.visit_date::timestamp, 'Mon YYYY') end as glabel
  ) k
  where hv.archived_at is null and hv.visit_date between p_from and p_to
    and p_group in ('week','month')
    and (p_zone is null or hv.zone_id = p_zone)
    and (p_visitor is null or hv.visitor_id = p_visitor)
  group by k.gkey, k.glabel
  order by k.gkey
$$;

-- Every export / print is recorded in the audit log.
create or replace function public.zm_log_export(p_report text, p_format text, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_perm text;
begin
  if p_format not in ('pdf','excel','print') then
    raise exception 'Format must be pdf, excel or print.' using errcode = '22023';
  end if;
  if coalesce(trim(p_report), '') = '' then raise exception 'Report name is required.' using errcode = '22023'; end if;
  v_perm := case when p_format = 'print' then 'zonal.report.print' else 'zonal.report.export' end;
  if not exists (select 1 from private.my_grants() g
                 where g.permission_code = v_perm or (g.is_super and g.scope_type = 'global')) then
    raise exception 'Not authorised to % reports.', case when p_format = 'print' then 'print' else 'export' end
      using errcode = '42501';
  end if;
  perform private.write_audit(case when p_format = 'print' then 'PRINT' else 'EXPORT' end, 'zonal', 'report', p_report,
                              null, jsonb_build_object('format', p_format, 'filters', coalesce(p_filters, '{}'::jsonb)), null);
end $$;

-- ---------------------------------------------------------------------
-- Stamp / audit / no-delete
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hub_daily_metrics','hub_visits','travel_claims','tasks','workforce_recommendations'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''zonal'')', t || '_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger task_reminders_no_delete before delete on public.task_reminders
  for each row execute function private.prevent_delete();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.hub_daily_metrics         enable row level security;
alter table public.hub_visits                enable row level security;
alter table public.travel_claims             enable row level security;
alter table public.tasks                     enable row level security;
alter table public.task_reminders            enable row level security;
alter table public.workforce_recommendations enable row level security;

revoke all on public.hub_daily_metrics, public.hub_visits, public.travel_claims, public.tasks,
  public.task_reminders, public.workforce_recommendations from anon;
revoke all on sequence public.travel_claim_no_seq, public.task_no_seq from anon;
revoke delete, truncate on public.hub_daily_metrics, public.hub_visits, public.travel_claims, public.tasks,
  public.task_reminders, public.workforce_recommendations from authenticated;
-- Claims, tasks, reminders and recommendations are written only by functions.
revoke insert, update on public.travel_claims, public.tasks, public.task_reminders,
  public.workforce_recommendations from authenticated;

-- daily hub figures
create policy hub_metrics_read on public.hub_daily_metrics for select to authenticated
  using (private.has_permission('zonal.hub_metric.view', zone_id, hub_id));
create policy hub_metrics_insert on public.hub_daily_metrics for insert to authenticated
  with check (private.has_permission('zonal.hub_metric.create', zone_id, hub_id));
create policy hub_metrics_update on public.hub_daily_metrics for update to authenticated
  using (private.has_permission('zonal.hub_metric.create', zone_id, hub_id))
  with check (private.has_permission('zonal.hub_metric.create', zone_id, hub_id));

-- hub visits: own visits, or visits in a scope where the caller may view them
create policy hub_visits_read on public.hub_visits for select to authenticated
  using (visitor_id = auth.uid() or private.has_permission('zonal.visit.view', zone_id, hub_id));
create policy hub_visits_insert on public.hub_visits for insert to authenticated
  with check (visitor_id = auth.uid() and private.has_permission('zonal.visit.create', zone_id, hub_id));
create policy hub_visits_update on public.hub_visits for update to authenticated
  using (visitor_id = auth.uid())   -- the guard trigger refuses changes to claimed visits with a clear message
  with check (visitor_id = auth.uid() and private.has_permission('zonal.visit.create', zone_id, hub_id));

create policy travel_claims_read on public.travel_claims for select to authenticated
  using (claimant_id = auth.uid() or private.has_permission('zonal.claim.view', zone_id));

-- tasks: the people involved, or anyone who may view tasks in that scope
create policy tasks_read on public.tasks for select to authenticated
  using (assigned_to = auth.uid() or accountable_manager_id = auth.uid() or created_by = auth.uid()
         or private.has_permission('zonal.task.view', zone_id, hub_id));
create policy task_reminders_read on public.task_reminders for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

create policy workforce_recommendations_read on public.workforce_recommendations for select to authenticated
  using (private.has_permission('zonal.planning.view', zone_id, hub_id));

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'zm\_%' or p.proname like 'task\_%')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname = 'task_due_reminders' then
      execute format('revoke all on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Default permissions per role (editable later by Super Admin)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'zonal' and (
     r.code = 'admin'
  or (r.code in ('head_office_manager','auditor') and p.action in ('view','export','print'))
  or (r.code = 'zonal_manager' and p.code in ('zonal.dashboard.view','zonal.hub_metric.view','zonal.hub_metric.approve',
        'zonal.visit.view','zonal.visit.create','zonal.claim.view','zonal.claim.create',
        'zonal.task.view','zonal.task.create','zonal.task.edit',
        'zonal.planning.view','zonal.planning.create','zonal.planning.edit',
        'zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'operations_manager' and p.code in ('zonal.dashboard.view','zonal.hub_metric.view','zonal.hub_metric.create',
        'zonal.hub_metric.approve','zonal.visit.view','zonal.task.view','zonal.task.create','zonal.task.edit',
        'zonal.planning.view','zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'hub_manager' and p.code in ('zonal.hub_metric.view','zonal.hub_metric.create','zonal.task.view','zonal.report.view'))
  or (r.code = 'hr_manager' and p.code in ('zonal.dashboard.view','zonal.planning.view','zonal.task.view','zonal.task.create',
        'zonal.task.edit','zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'accounts_manager' and p.code in ('zonal.visit.view','zonal.claim.view','zonal.claim.approve','zonal.claim.reject',
        'zonal.report.view','zonal.report.export','zonal.report.print'))
  or (r.code = 'accountant' and p.code in ('zonal.visit.view','zonal.claim.view','zonal.report.view'))
)
on conflict do nothing;
