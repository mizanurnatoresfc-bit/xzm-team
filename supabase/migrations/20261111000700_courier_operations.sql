-- =====================================================================
-- XZM-TEAM ERP — Migration 0007: Hub, zone and courier operations
--   * merchants, parcels
--   * ops_assignments        Hub Manager / Zonal Manager / rider assignment history
--   * pickup_submissions     independent submissions from Pickup Manager, Hub
--                            Manager and Rider; duplicate / conflict detection;
--                            Pending -> Verified -> Approved | Rejected
--   * pickup_consolidations  ONE approved record per pickup (date, hub, merchant,
--                            trip). Reports read these, never the raw submissions.
--   * delivery_records       delivered / failed / returned, approved by a second person
--   * cash_collections       rider and hub cash-in (COD rows are written on approval)
--   * cash_handovers         rider -> hub -> Main Accounts, receiver confirms the
--                            amount actually received; any shortage is recorded
--   * merchant_payments, operational_expenses, cash_reconciliations
--   * parcel_issues + parcel_issue_events (append-only history)
--   * report functions; approved data refreshes hub_daily_metrics so the zonal
--     dashboards of migration 0006 run on real courier records
-- Rules:
--   * Submissions of the same pickup are NEVER summed. They are compared, and
--     one consolidated record is approved.
--   * The maker is never the checker (submitter / verifier / approver / receiver).
--   * Workflow tables are written only through the audited functions below.
--   * Nothing is deleted. Every figure is limited to the caller's zone / hub scope.
-- ACCOUNTS HOOK: this migration posts NOTHING to a ledger. Every financial row
--   carries ledger_entry_id (null = not yet posted). The Accounts phase posts
--   approved / confirmed rows and stores its entry id there:
--     cash_collections (not voided), cash_handovers (confirmed, incl. shortage),
--     merchant_payments (approved), operational_expenses (approved),
--     cash_reconciliations (approved, difference <> 0).
-- NOTE: assigning a Hub Manager / Zonal Manager / rider here records WHO runs a
--   unit. It does not grant login permissions; roles stay in user_roles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions and settings
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'ops.' || r || '.' || a, 'ops', r, a, d from (values
  ('merchant','view','View merchants'),
  ('merchant','create','Create merchants'),
  ('merchant','edit','Edit merchants'),
  ('merchant','archive','Archive merchants'),
  ('parcel','view','View parcels and search by parcel ID'),
  ('parcel','create','Book parcels into a hub'),
  ('parcel','edit','Edit, dispatch to riders and cancel parcels'),
  ('assignment','view','View Hub Manager, Zonal Manager and rider assignments'),
  ('assignment','create','Assign Hub Manager, Zonal Manager and riders'),
  ('assignment','edit','End assignments'),
  ('pickup','view','View pickup submissions and approved pickups'),
  ('pickup','approve','Approve the consolidated pickup record'),
  ('pickup','reject','Reject pickup submissions'),
  ('pickup_as_pickup_manager','create','Submit pickups as Pickup Manager'),
  ('pickup_as_hub_manager','create','Submit pickups as Hub Manager'),
  ('pickup_as_rider','create','Submit own pickups as Rider'),
  ('pickup_verification','create','Verify pickup submissions'),
  ('delivery','view','View delivery records'),
  ('delivery','create','Record delivery outcomes'),
  ('delivery','approve','Approve delivery records'),
  ('delivery','reject','Reject delivery records'),
  ('cash','view','View cash collections, rider ledger and hub cash position'),
  ('cash','create','Record hub cash collections and act for riders without a login'),
  ('handover','view','View cash handovers'),
  ('rider_handover','create','Hand rider cash over to the hub'),
  ('rider_handover','approve','Confirm cash received from riders'),
  ('hub_handover','create','Hand hub cash over to Main Accounts'),
  ('hub_handover','approve','Confirm cash received from hubs (Main Accounts)'),
  ('merchant_payment','view','View merchant payments'),
  ('merchant_payment','create','Request merchant payments'),
  ('merchant_payment','approve','Approve merchant payments'),
  ('merchant_payment','reject','Reject merchant payments'),
  ('expense','view','View operational expenses'),
  ('expense','create','Record operational expenses'),
  ('expense','approve','Approve operational expenses'),
  ('expense','reject','Reject operational expenses'),
  ('reconciliation','view','View daily cash reconciliations'),
  ('reconciliation','create','Submit the daily cash count'),
  ('reconciliation','approve','Approve or reject daily cash reconciliations'),
  ('issue','view','View parcel issues'),
  ('issue','create','Report parcel issues'),
  ('issue','edit','Assign, resolve and reopen parcel issues'),
  ('report','view','View courier operation reports'),
  ('report','export','Export courier operation reports'),
  ('report','print','Print courier operation reports')
) v(r, a, d);

insert into public.system_settings (key, value, description) values
  ('ops.backdate_days', '3', 'Operations: how many days back pickups, deliveries, expenses and cash may be entered');

-- Daily hub figures now say where they come from. Rows generated from approved
-- courier records are locked: the underlying record is corrected instead.
alter table public.hub_daily_metrics
  add column source text not null default 'manual' check (source in ('manual','courier'));

create or replace function private.hub_metric_courier_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.source = 'courier' and (new.status <> 'verified' or new.source <> 'courier') then
    raise exception 'These figures are generated from approved courier records. Correct the underlying record instead.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger hub_daily_metrics_courier_guard before update on public.hub_daily_metrics
  for each row execute function private.hub_metric_courier_guard();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function private.my_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e where e.profile_id = auth.uid() and e.archived_at is null
$$;

create or replace function private.employee_label(p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(e.employee_code::text || ' — ', '') || e.full_name from public.employees e where e.id = p_employee
$$;

create or replace function private.ops_date_ok(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_date is not null and p_date <= current_date
     and p_date >= current_date - coalesce(private.setting_text('ops.backdate_days')::integer, 3)
$$;

-- ---------------------------------------------------------------------
-- Merchants and parcels
-- ---------------------------------------------------------------------
create table public.merchants (
  id             uuid primary key default gen_random_uuid(),
  code           extensions.citext not null unique,
  name           text not null check (length(trim(name)) > 1),
  phone          text,
  address        text,
  hub_id         uuid not null references public.hubs(id),    -- hub that serves the merchant
  zone_id        uuid not null references public.zones(id),   -- always follows the hub
  status         text not null default 'active' check (status in ('active','inactive')),
  archived_at    timestamptz,
  archived_by    uuid,
  archive_reason text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint merchants_archive_chk check (archived_at is null or length(trim(coalesce(archive_reason, ''))) > 0)
);
create index merchants_hub_idx on public.merchants (hub_id) where archived_at is null;

create or replace function private.merchant_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if private.is_api_user() then
    if tg_op = 'INSERT' and new.archived_at is not null then
      raise exception 'New merchants cannot be created as archived.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if old.archived_at is not null then
        raise exception 'Archived merchants are read-only.' using errcode = '42501';
      end if;
      if new.archived_at is not null then new.archived_by := auth.uid(); new.status := 'inactive'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger merchants_guard before insert or update on public.merchants
  for each row execute function private.merchant_guard();

create table public.parcels (
  id                uuid primary key default gen_random_uuid(),
  tracking_no       extensions.citext not null unique check (length(trim(tracking_no::text)) >= 4),  -- the parcel ID
  merchant_id       uuid not null references public.merchants(id),
  hub_id            uuid not null references public.hubs(id),
  zone_id           uuid not null references public.zones(id),
  received_date     date not null default current_date,
  customer_name     text not null check (length(trim(customer_name)) > 1),
  customer_phone    text,
  customer_address  text,
  cod_amount        numeric(14,2) not null default 0 check (cod_amount >= 0),
  status            text not null default 'at_hub'
                    check (status in ('at_hub','out_for_delivery','delivered','returned','cancelled')),
  assigned_rider_id uuid references public.employees(id),
  attempt_count     integer not null default 0 check (attempt_count >= 0),
  closed_at         timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint parcels_rider_chk check ((status = 'out_for_delivery') = (assigned_rider_id is not null))
);
create index parcels_hub_idx on public.parcels (hub_id, status);
create index parcels_rider_idx on public.parcels (assigned_rider_id) where assigned_rider_id is not null;
create index parcels_merchant_idx on public.parcels (merchant_id);

create or replace function private.parcel_guard() returns trigger
language plpgsql set search_path = '' as $$   -- invoker
begin
  new.zone_id := private.hub_zone(new.hub_id);
  if new.received_date > current_date then
    raise exception 'A parcel cannot be booked for a future date.' using errcode = '23514';
  end if;
  if not private.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'at_hub' or new.assigned_rider_id is not null or new.attempt_count <> 0 or new.closed_at is not null then
      raise exception 'New parcels start at the hub. Dispatch and delivery go through the workflow.' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.status, new.assigned_rider_id, new.attempt_count, new.closed_at, new.cancel_reason, new.hub_id,
      new.merchant_id, new.tracking_no, new.received_date)
     is distinct from
     (old.status, old.assigned_rider_id, old.attempt_count, old.closed_at, old.cancel_reason, old.hub_id,
      old.merchant_id, old.tracking_no, old.received_date) then
    raise exception 'Parcel ID, merchant, hub, status and rider change only through the workflow functions.' using errcode = '42501';
  end if;
  if old.status <> 'at_hub' then
    raise exception 'A parcel can be edited only while it is at the hub.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger parcels_guard before insert or update on public.parcels
  for each row execute function private.parcel_guard();

-- ---------------------------------------------------------------------
-- Hub Manager / Zonal Manager / rider assignments (history; current = effective_to is null)
-- ---------------------------------------------------------------------
create table public.ops_assignments (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('hub_manager','zonal_manager','rider')),
  employee_id    uuid not null references public.employees(id),
  zone_id        uuid not null references public.zones(id),
  hub_id         uuid references public.hubs(id),
  duty           text check (duty in ('pickup','delivery','both')),   -- riders only
  effective_from date not null,
  effective_to   date,
  reason         text not null check (length(trim(reason)) > 0),
  end_reason     text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint ops_assignments_dates_chk check (effective_to is null or effective_to >= effective_from),
  constraint ops_assignments_shape_chk check (
       (kind = 'zonal_manager' and hub_id is null and duty is null)
    or (kind = 'hub_manager'   and hub_id is not null and duty is null)
    or (kind = 'rider'         and hub_id is not null and duty is not null))
);
create unique index ops_assignments_one_hub_manager on public.ops_assignments (hub_id)
  where kind = 'hub_manager' and effective_to is null;
create unique index ops_assignments_one_zonal_manager on public.ops_assignments (zone_id)
  where kind = 'zonal_manager' and effective_to is null;
create unique index ops_assignments_one_rider_hub on public.ops_assignments (employee_id)
  where kind = 'rider' and effective_to is null;
create index ops_assignments_hub_idx on public.ops_assignments (hub_id, kind);

create or replace function private.is_current_rider(p_employee uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ops_assignments a
                 where a.kind = 'rider' and a.employee_id = p_employee and a.hub_id = p_hub
                   and a.effective_to is null and a.effective_from <= current_date)
$$;

-- Assign a Hub Manager (zone-level right), Zonal Manager (company-level right)
-- or rider (hub-level right). The previous holder / previous hub is closed.
create or replace function public.ops_assign(
  p_kind text, p_employee uuid, p_hub uuid default null, p_zone uuid default null,
  p_from date default null, p_reason text default null, p_duty text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid;
  v_from date := coalesce(p_from, current_date);
  v_ok   boolean;
  v_id   uuid;
  cur    record;
begin
  if p_kind = 'zonal_manager' then
    if p_zone is null then raise exception 'A zone is required.' using errcode = '22023'; end if;
    v_zone := p_zone; p_hub := null; p_duty := null;
    v_ok := private.has_permission('ops.assignment.create');
  elsif p_kind in ('hub_manager','rider') then
    v_zone := private.hub_zone(p_hub);
    if v_zone is null then raise exception 'A hub is required.' using errcode = '22023'; end if;
    if p_kind = 'hub_manager' then
      p_duty := null;
      v_ok := private.has_permission('ops.assignment.create', v_zone);
    else
      p_duty := coalesce(p_duty, 'both');
      v_ok := private.has_permission('ops.assignment.create', v_zone, p_hub);
    end if;
  else
    raise exception 'Kind must be hub_manager, zonal_manager or rider.' using errcode = '22023';
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'Not authorised to make this assignment.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.status = 'active' and e.archived_at is null) then
    raise exception 'Only an active employee can be assigned.' using errcode = '22023';
  end if;

  for cur in
    select a.id, a.effective_from from public.ops_assignments a
    where a.kind = p_kind and a.effective_to is null
      and (   (p_kind = 'zonal_manager' and a.zone_id = v_zone)
           or (p_kind = 'hub_manager' and a.hub_id = p_hub)
           or (p_kind = 'rider' and a.employee_id = p_employee))
    for update
  loop
    if v_from <= cur.effective_from then
      raise exception 'The new assignment must start after the current one began.' using errcode = 'P0001';
    end if;
    update public.ops_assignments set effective_to = v_from - 1, end_reason = 'Replaced: ' || p_reason where id = cur.id;
  end loop;

  insert into public.ops_assignments (kind, employee_id, zone_id, hub_id, duty, effective_from, reason)
  values (p_kind, p_employee, v_zone, p_hub, p_duty, v_from, p_reason)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_end_assignment(p_id uuid, p_to date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.ops_assignments%rowtype;
begin
  select * into a from public.ops_assignments where id = p_id for update;
  if a.id is null or not (case a.kind
        when 'zonal_manager' then private.has_permission('ops.assignment.edit')
        when 'hub_manager'   then private.has_permission('ops.assignment.edit', a.zone_id)
        else private.has_permission('ops.assignment.edit', a.zone_id, a.hub_id) end) then
    raise exception 'Assignment not found or not authorised.' using errcode = '42501';
  end if;
  if a.effective_to is not null then raise exception 'This assignment has already ended.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_to is null or p_to < a.effective_from then
    raise exception 'The end date cannot be before the start date.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.ops_assignments set effective_to = p_to, end_reason = p_reason where id = p_id;
end $$;

-- Hub-wise employees with their operational role.
create or replace function public.ops_hub_staff(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, ops_role text, duty text, since date)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, po.name,
         coalesce(a.kind, 'staff'), a.duty, coalesce(a.effective_from, e.joining_date)
  from public.employees e
  left join public.positions po on po.id = e.position_id
  left join lateral (
    select x.kind, x.duty, x.effective_from from public.ops_assignments x
    where x.employee_id = e.id and x.hub_id = p_hub and x.effective_to is null
    order by (x.kind = 'hub_manager') desc limit 1) a on true
  where private.has_permission('ops.assignment.view', null, p_hub)
    and e.status = 'active' and e.archived_at is null
    and (e.hub_id = p_hub or a.kind is not null)
  order by (a.kind = 'hub_manager') desc nulls last, e.full_name
$$;

-- ---------------------------------------------------------------------
-- Pickup submissions and the consolidated (approved) pickup
-- ---------------------------------------------------------------------
create sequence public.pickup_submission_no_seq;
create sequence public.cash_handover_no_seq;
create sequence public.merchant_payment_no_seq;
create sequence public.parcel_issue_no_seq;

create table public.pickup_consolidations (
  id                     uuid primary key default gen_random_uuid(),
  pickup_date            date not null,
  hub_id                 uuid not null references public.hubs(id),
  zone_id                uuid not null references public.zones(id),
  merchant_id            uuid not null references public.merchants(id),
  trip_no                smallint not null,
  rider_id               uuid references public.employees(id),
  parcel_count           integer not null check (parcel_count > 0),
  cod_amount             numeric(14,2) not null check (cod_amount >= 0),
  collection_amount      numeric(14,2) not null check (collection_amount >= 0),
  accepted_submission_id uuid not null,
  submission_count       integer not null,      -- how many submissions described this pickup
  had_conflict           boolean not null,      -- true = submissions disagreed; approval_note says why these figures
  approved_by            uuid not null,
  approved_at            timestamptz not null default now(),
  approval_note          text,
  voided_at              timestamptz,
  voided_by              uuid,
  void_reason            text,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  constraint pickup_consolidations_conflict_chk check (not had_conflict or length(trim(coalesce(approval_note, ''))) > 0)
);
create unique index pickup_consolidations_one_live on public.pickup_consolidations (pickup_date, hub_id, merchant_id, trip_no)
  where voided_at is null;
create index pickup_consolidations_hub_idx on public.pickup_consolidations (hub_id, pickup_date);

create table public.pickup_submissions (
  id                uuid primary key default gen_random_uuid(),
  submission_no     text not null unique default ('PS-' || lpad(nextval('public.pickup_submission_no_seq')::text, 6, '0')),
  pickup_date       date not null,
  hub_id            uuid not null references public.hubs(id),
  zone_id           uuid not null references public.zones(id),
  merchant_id       uuid not null references public.merchants(id),
  trip_no           smallint not null default 1 check (trip_no between 1 and 20),   -- 2nd, 3rd pickup of the same day
  source            text not null check (source in ('pickup_manager','hub_manager','rider')),
  submitted_by      uuid not null references public.profiles(id),
  submitted_at      timestamptz not null default now(),
  rider_id          uuid references public.employees(id),
  parcel_count      integer not null check (parcel_count > 0),
  cod_amount        numeric(14,2) not null default 0 check (cod_amount >= 0),         -- COD value of the parcels
  collection_amount numeric(14,2) not null default 0 check (collection_amount >= 0),  -- cash taken at pickup
  note              text,
  status            text not null default 'pending' check (status in ('pending','verified','approved','rejected')),
  verified_by       uuid,
  verified_at       timestamptz,
  decided_by        uuid,
  decided_at        timestamptz,
  decision_note     text,
  consolidation_id  uuid references public.pickup_consolidations(id),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);
-- One person submits a given pickup once (a rejected / withdrawn one may be redone).
create unique index pickup_submissions_one_per_person
  on public.pickup_submissions (pickup_date, hub_id, merchant_id, trip_no, submitted_by) where status <> 'rejected';
create index pickup_submissions_group_idx on public.pickup_submissions (hub_id, pickup_date, merchant_id, trip_no);

-- Cash collections are declared here because pickup approval writes them.
create table public.cash_collections (
  id                      uuid primary key default gen_random_uuid(),
  collection_date         date not null,
  hub_id                  uuid not null references public.hubs(id),
  zone_id                 uuid not null references public.zones(id),
  source                  text not null check (source in ('cod_delivery','pickup_collection','merchant_deposit','other')),
  holder                  text not null check (holder in ('rider','hub')),   -- who holds the cash after collection
  rider_id                uuid references public.employees(id),
  merchant_id             uuid references public.merchants(id),
  amount                  numeric(14,2) not null check (amount > 0),
  delivery_record_id      uuid,
  pickup_consolidation_id uuid references public.pickup_consolidations(id),
  note                    text,
  recorded_by             uuid,
  voided_at               timestamptz,
  voided_by               uuid,
  void_reason             text,
  ledger_entry_id         uuid,   -- ACCOUNTS HOOK: set when posted
  created_at              timestamptz not null default now(),
  created_by              uuid,
  updated_at              timestamptz not null default now(),
  updated_by              uuid,
  constraint cash_collections_holder_chk check ((holder = 'rider') = (rider_id is not null))
);
create index cash_collections_hub_idx on public.cash_collections (hub_id, collection_date);
create index cash_collections_rider_idx on public.cash_collections (rider_id, collection_date) where rider_id is not null;
create unique index cash_collections_one_per_delivery on public.cash_collections (delivery_record_id)
  where delivery_record_id is not null;

-- Compares the submissions of each pickup. NEVER sums them.
--   single    = one submission
--   duplicate = several submissions with identical figures (count once)
--   conflict  = submissions disagree; an approver must choose and explain
create or replace function public.ops_pickup_groups(
  p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (pickup_date date, hub_id uuid, merchant_id uuid, merchant_name text, trip_no smallint,
                 submissions integer, sources text[], check_state text, group_status text,
                 min_parcels integer, max_parcels integer, min_cod numeric, max_cod numeric,
                 min_collection numeric, max_collection numeric)
language sql stable security invoker set search_path = '' as $$
  select s.pickup_date, s.hub_id, s.merchant_id, max(m.name), s.trip_no, count(*)::integer,
         array_agg(distinct s.source order by s.source),
         case when count(*) = 1 then 'single'
              when min(s.parcel_count) = max(s.parcel_count) and min(s.cod_amount) = max(s.cod_amount)
                   and min(s.collection_amount) = max(s.collection_amount) then 'duplicate'
              else 'conflict' end,
         case when bool_or(s.status = 'approved') then 'approved'
              when bool_or(s.status = 'verified') then 'verified' else 'pending' end,
         min(s.parcel_count), max(s.parcel_count), min(s.cod_amount), max(s.cod_amount),
         min(s.collection_amount), max(s.collection_amount)
  from public.pickup_submissions s
  left join public.merchants m on m.id = s.merchant_id
  where (s.status <> 'rejected' or s.consolidation_id is not null)   -- withdrawn / rejected-before-approval are out
    and s.pickup_date between p_from and p_to
    and (p_zone is null or s.zone_id = p_zone)
    and (p_hub is null or s.hub_id = p_hub)
  group by s.pickup_date, s.hub_id, s.merchant_id, s.trip_no
  order by s.pickup_date, s.hub_id, max(m.name), s.trip_no
$$;

-- Is the caller one of the people who submitted this pickup?
create or replace function private.pickup_is_submitter(p_date date, p_hub uuid, p_merchant uuid, p_trip smallint)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pickup_submissions s
                 where s.pickup_date = p_date and s.hub_id = p_hub and s.merchant_id = p_merchant and s.trip_no = p_trip
                   and s.status <> 'rejected' and s.submitted_by = auth.uid())
$$;

create or replace function public.ops_submit_pickup(
  p_source text, p_date date, p_hub uuid, p_merchant uuid, p_parcels integer,
  p_cod numeric default 0, p_collection numeric default 0,
  p_rider uuid default null, p_trip integer default 1, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_rider uuid := p_rider;
  v_id    uuid;
begin
  if p_source is null or p_source not in ('pickup_manager','hub_manager','rider') then
    raise exception 'Source must be pickup_manager, hub_manager or rider.' using errcode = '22023';
  end if;
  if v_zone is null or not private.has_permission('ops.pickup_as_' || p_source || '.create', v_zone, p_hub) then
    raise exception 'Not authorised to submit pickups as % for this hub.', p_source using errcode = '42501';
  end if;
  if not private.ops_date_ok(p_date) then
    raise exception 'The pickup date must be today or within the allowed back-dating period.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.merchants m where m.id = p_merchant and m.status = 'active' and m.archived_at is null) then
    raise exception 'The merchant must be active.' using errcode = '22023';
  end if;
  if p_source = 'rider' then
    v_rider := private.my_employee_id();
    if v_rider is null or not private.is_current_rider(v_rider, p_hub) then
      raise exception 'Only a rider currently assigned to this hub can submit a rider pickup.' using errcode = '42501';
    end if;
  elsif v_rider is not null and not private.is_current_rider(v_rider, p_hub) then
    raise exception 'The rider is not currently assigned to this hub.' using errcode = '22023';
  end if;
  if exists (select 1 from public.pickup_consolidations c
             where c.pickup_date = p_date and c.hub_id = p_hub and c.merchant_id = p_merchant
               and c.trip_no = coalesce(p_trip, 1) and c.voided_at is null) then
    raise exception 'This pickup has already been approved. Ask an approver to reopen it if it is wrong.' using errcode = 'P0001';
  end if;
  if private.pickup_is_submitter(p_date, p_hub, p_merchant, coalesce(p_trip, 1)::smallint) then
    raise exception 'You have already submitted this pickup. Withdraw it first, or use the next trip number for a second pickup.'
      using errcode = '23505';
  end if;

  insert into public.pickup_submissions (pickup_date, hub_id, zone_id, merchant_id, trip_no, source, submitted_by, rider_id,
                                         parcel_count, cod_amount, collection_amount, note)
  values (p_date, p_hub, v_zone, p_merchant, coalesce(p_trip, 1), p_source, auth.uid(), v_rider,
          p_parcels, coalesce(p_cod, 0), coalesce(p_collection, 0), p_note)
  returning id into v_id;
  return v_id;
end $$;

-- The submitter takes back a submission that has not been checked yet.
create or replace function public.ops_withdraw_pickup(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.pickup_submissions%rowtype;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or s.submitted_by <> auth.uid() then
    raise exception 'Only the submitter can withdraw a submission.' using errcode = '42501';
  end if;
  if s.status <> 'pending' then raise exception 'Only a pending submission can be withdrawn.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.pickup_submissions
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'Withdrawn by submitter: ' || p_reason
   where id = p_id;
end $$;

create or replace function public.ops_verify_pickup(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.pickup_submissions%rowtype;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or not private.has_permission('ops.pickup_verification.create', s.zone_id, s.hub_id) then
    raise exception 'Submission not found or not authorised to verify.' using errcode = '42501';
  end if;
  if s.status <> 'pending' then raise exception 'Only a pending submission can be verified.' using errcode = 'P0001'; end if;
  if private.pickup_is_submitter(s.pickup_date, s.hub_id, s.merchant_id, s.trip_no) then
    raise exception 'A person who submitted this pickup cannot verify it.' using errcode = '42501';
  end if;
  update public.pickup_submissions set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_id;
end $$;

create or replace function public.ops_reject_pickup(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.pickup_submissions%rowtype;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or not private.has_permission('ops.pickup.reject', s.zone_id, s.hub_id) then
    raise exception 'Submission not found or not authorised.' using errcode = '42501';
  end if;
  if s.submitted_by = auth.uid() then
    raise exception 'You cannot reject your own submission; withdraw it instead.' using errcode = '42501';
  end if;
  if s.status not in ('pending','verified') then
    raise exception 'This submission has already been decided.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.pickup_submissions
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_reason
   where id = p_id;
end $$;

-- Approves ONE consolidated record for the pickup, using the figures of the
-- chosen (verified) submission. Submissions with the same figures are marked
-- approved duplicates; submissions that disagree are rejected. A note is
-- required when submissions conflict.
create or replace function public.ops_approve_pickup(p_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s          public.pickup_submissions%rowtype;
  v_n        integer;
  v_conflict boolean;
  v_id       uuid;
begin
  select * into s from public.pickup_submissions where id = p_id for update;
  if s.id is null or not private.has_permission('ops.pickup.approve', s.zone_id, s.hub_id) then
    raise exception 'Submission not found or not authorised to approve.' using errcode = '42501';
  end if;
  if s.status <> 'verified' then
    raise exception 'A submission must be verified before it can be approved.' using errcode = 'P0001';
  end if;
  if private.pickup_is_submitter(s.pickup_date, s.hub_id, s.merchant_id, s.trip_no) then
    raise exception 'A person who submitted this pickup cannot approve it.' using errcode = '42501';
  end if;
  perform 1 from public.pickup_submissions g
   where g.pickup_date = s.pickup_date and g.hub_id = s.hub_id and g.merchant_id = s.merchant_id and g.trip_no = s.trip_no
     and g.status in ('pending','verified')
   for update;
  if exists (select 1 from public.pickup_consolidations c
             where c.pickup_date = s.pickup_date and c.hub_id = s.hub_id and c.merchant_id = s.merchant_id
               and c.trip_no = s.trip_no and c.voided_at is null) then
    raise exception 'This pickup has already been approved.' using errcode = 'P0001';
  end if;

  select count(*)::integer,
         coalesce(bool_or((g.parcel_count, g.cod_amount, g.collection_amount)
                          is distinct from (s.parcel_count, s.cod_amount, s.collection_amount)), false)
    into v_n, v_conflict
  from public.pickup_submissions g
  where g.pickup_date = s.pickup_date and g.hub_id = s.hub_id and g.merchant_id = s.merchant_id and g.trip_no = s.trip_no
    and g.status in ('pending','verified');
  if v_conflict and coalesce(trim(p_note), '') = '' then
    raise exception 'The submissions for this pickup conflict. A note explaining the accepted figures is required.'
      using errcode = '22023';
  end if;

  insert into public.pickup_consolidations (pickup_date, hub_id, zone_id, merchant_id, trip_no, rider_id, parcel_count,
                                            cod_amount, collection_amount, accepted_submission_id, submission_count,
                                            had_conflict, approved_by, approval_note)
  values (s.pickup_date, s.hub_id, s.zone_id, s.merchant_id, s.trip_no, s.rider_id, s.parcel_count,
          s.cod_amount, s.collection_amount, s.id, v_n, v_conflict, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;

  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), 'Pickup approved'), true);
  update public.pickup_submissions g
     set status = case when (g.parcel_count, g.cod_amount, g.collection_amount)
                            is not distinct from (s.parcel_count, s.cod_amount, s.collection_amount)
                       then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), consolidation_id = v_id,
         decision_note = case
           when g.id = s.id then nullif(trim(p_note), '')
           when (g.parcel_count, g.cod_amount, g.collection_amount)
                is not distinct from (s.parcel_count, s.cod_amount, s.collection_amount)
             then 'Duplicate of ' || s.submission_no || ' (same figures, counted once)'
           else 'Conflicts with accepted submission ' || s.submission_no end
   where g.pickup_date = s.pickup_date and g.hub_id = s.hub_id and g.merchant_id = s.merchant_id and g.trip_no = s.trip_no
     and g.status in ('pending','verified');

  if s.collection_amount > 0 then
    insert into public.cash_collections (collection_date, hub_id, zone_id, source, holder, rider_id, merchant_id, amount,
                                         pickup_consolidation_id, note, recorded_by)
    values (s.pickup_date, s.hub_id, s.zone_id, 'pickup_collection',
            case when s.rider_id is null then 'hub' else 'rider' end, s.rider_id, s.merchant_id, s.collection_amount,
            v_id, 'Cash taken at pickup ' || s.submission_no, auth.uid());
  end if;
  perform private.ops_refresh_hub_day(s.hub_id, s.pickup_date);
  return v_id;
end $$;

-- Reopens an approved pickup that turned out to be wrong. The accepted
-- submissions go back to "verified"; the consolidated record is voided.
create or replace function public.ops_void_pickup(p_consolidation uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.pickup_consolidations%rowtype;
begin
  select * into c from public.pickup_consolidations where id = p_consolidation for update;
  if c.id is null or not private.has_permission('ops.pickup.approve', c.zone_id, c.hub_id) then
    raise exception 'Approved pickup not found or not authorised.' using errcode = '42501';
  end if;
  if c.voided_at is not null then raise exception 'This pickup has already been reopened.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.pickup_consolidations set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = c.id;
  update public.pickup_submissions
     set status = case when status = 'approved' then 'verified' else status end,
         consolidation_id = null,
         decided_by = case when status = 'approved' then null else decided_by end,
         decided_at = case when status = 'approved' then null else decided_at end,
         decision_note = case when status = 'approved' then 'Reopened: ' || p_reason else decision_note end
   where consolidation_id = c.id;
  update public.cash_collections set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where pickup_consolidation_id = c.id and voided_at is null;
  perform private.ops_refresh_hub_day(c.hub_id, c.pickup_date);
end $$;

-- ---------------------------------------------------------------------
-- Dispatch and delivery
-- ---------------------------------------------------------------------
create table public.delivery_records (
  id             uuid primary key default gen_random_uuid(),
  parcel_id      uuid not null references public.parcels(id),
  merchant_id    uuid not null references public.merchants(id),
  hub_id         uuid not null references public.hubs(id),
  zone_id        uuid not null references public.zones(id),
  rider_id       uuid not null references public.employees(id),
  delivery_date  date not null,
  outcome        text not null check (outcome in ('delivered','failed','returned')),
  cod_expected   numeric(14,2) not null default 0 check (cod_expected >= 0),
  cod_collected  numeric(14,2) not null default 0 check (cod_collected >= 0),
  failure_reason text,
  recipient_name text,
  recorded_by    uuid not null,
  recorded_at    timestamptz not null default now(),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint delivery_records_cod_chk check (outcome = 'delivered' or cod_collected = 0),
  constraint delivery_records_reason_chk check (outcome = 'delivered' or length(trim(coalesce(failure_reason, ''))) > 0)
);
create unique index delivery_records_one_open on public.delivery_records (parcel_id) where status = 'pending';
create unique index delivery_records_one_final on public.delivery_records (parcel_id)
  where status = 'approved' and outcome in ('delivered','returned');
create index delivery_records_hub_idx on public.delivery_records (hub_id, delivery_date);
create index delivery_records_rider_idx on public.delivery_records (rider_id, delivery_date);
alter table public.cash_collections
  add constraint cash_collections_delivery_fk foreign key (delivery_record_id) references public.delivery_records(id);

create or replace function public.ops_dispatch_parcels(p_rider uuid, p_parcels uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p    public.parcels%rowtype;
  v_id uuid;
  v_n  integer := 0;
begin
  foreach v_id in array coalesce(p_parcels, '{}'::uuid[]) loop
    select * into p from public.parcels where id = v_id for update;
    if p.id is null or not private.has_permission('ops.parcel.edit', p.zone_id, p.hub_id) then
      raise exception 'Parcel not found or not authorised.' using errcode = '42501';
    end if;
    if p.status <> 'at_hub' then
      raise exception 'Parcel % is % and cannot be dispatched.', p.tracking_no, p.status using errcode = 'P0001';
    end if;
    if not private.is_current_rider(p_rider, p.hub_id) then
      raise exception 'The rider is not currently assigned to the hub of parcel %.', p.tracking_no using errcode = '22023';
    end if;
    update public.parcels set status = 'out_for_delivery', assigned_rider_id = p_rider where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.ops_cancel_parcel(p_parcel uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.parcels%rowtype;
begin
  select * into p from public.parcels where id = p_parcel for update;
  if p.id is null or not private.has_permission('ops.parcel.edit', p.zone_id, p.hub_id) then
    raise exception 'Parcel not found or not authorised.' using errcode = '42501';
  end if;
  if p.status <> 'at_hub' then raise exception 'Only a parcel at the hub can be cancelled.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.parcels set status = 'cancelled', cancel_reason = p_reason, closed_at = now() where id = p_parcel;
end $$;

-- The rider (for own parcels) or hub staff (on the rider's behalf) records the outcome.
create or replace function public.ops_record_delivery(
  p_parcel uuid, p_outcome text, p_cod_collected numeric default 0, p_reason text default null,
  p_recipient text default null, p_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p      public.parcels%rowtype;
  v_date date := coalesce(p_date, current_date);
  v_id   uuid;
begin
  select * into p from public.parcels where id = p_parcel for update;
  if p.id is null or not private.has_permission('ops.delivery.create', p.zone_id, p.hub_id)
     or not (p.assigned_rider_id = private.my_employee_id()
             or private.has_permission('ops.parcel.edit', p.zone_id, p.hub_id)) is true then
    raise exception 'Parcel not found or not authorised to record its delivery.' using errcode = '42501';
  end if;
  if p.status <> 'out_for_delivery' then
    raise exception 'Parcel % is % and is not out for delivery.', p.tracking_no, p.status using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('delivered','failed','returned') then
    raise exception 'Outcome must be delivered, failed or returned.' using errcode = '22023';
  end if;
  if not private.ops_date_ok(v_date) or v_date < p.received_date then
    raise exception 'The delivery date is outside the allowed period.' using errcode = '22023';
  end if;
  if p_outcome <> 'delivered' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for a failed or returned parcel.' using errcode = '22023';
  end if;
  if exists (select 1 from public.delivery_records d where d.parcel_id = p.id and d.status = 'pending') then
    raise exception 'This parcel already has a delivery record waiting for approval.' using errcode = 'P0001';
  end if;

  insert into public.delivery_records (parcel_id, merchant_id, hub_id, zone_id, rider_id, delivery_date, outcome,
                                       cod_expected, cod_collected, failure_reason, recipient_name, recorded_by)
  values (p.id, p.merchant_id, p.hub_id, p.zone_id, p.assigned_rider_id, v_date, p_outcome,
          case when p_outcome = 'delivered' then p.cod_amount else 0 end,
          case when p_outcome = 'delivered' then coalesce(p_cod_collected, 0) else 0 end,
          nullif(trim(p_reason), ''), p_recipient, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- A second person approves or rejects. Approval moves the parcel and, for a
-- delivered COD parcel, records the cash now held by the rider.
create or replace function public.ops_decide_delivery(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.delivery_records%rowtype;
begin
  select * into d from public.delivery_records where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if d.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'ops.delivery.approve' else 'ops.delivery.reject' end, d.zone_id, d.hub_id) then
    raise exception 'Delivery record not found or not authorised.' using errcode = '42501';
  end if;
  if d.recorded_by = auth.uid() or d.rider_id = private.my_employee_id() then
    raise exception 'The person who recorded or made the delivery cannot decide it.' using errcode = '42501';
  end if;
  if d.status <> 'pending' then raise exception 'This delivery record has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a delivery record is rejected.' using errcode = '22023';
  end if;
  if p_decision = 'approved' and d.cod_collected <> d.cod_expected and coalesce(trim(p_note), '') = '' then
    raise exception 'COD collected (%) differs from COD expected (%). A note is required.', d.cod_collected, d.cod_expected
      using errcode = '22023';
  end if;

  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.delivery_records
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_decision = 'rejected' then return; end if;   -- parcel stays with the rider; a new record is made

  if d.outcome = 'failed' then
    update public.parcels set status = 'at_hub', assigned_rider_id = null, attempt_count = attempt_count + 1 where id = d.parcel_id;
  else
    update public.parcels set status = d.outcome, assigned_rider_id = null, attempt_count = attempt_count + 1, closed_at = now()
     where id = d.parcel_id;
  end if;
  if d.outcome = 'delivered' and d.cod_collected > 0 then
    insert into public.cash_collections (collection_date, hub_id, zone_id, source, holder, rider_id, merchant_id, amount,
                                         delivery_record_id, note, recorded_by)
    values (d.delivery_date, d.hub_id, d.zone_id, 'cod_delivery', 'rider', d.rider_id, d.merchant_id, d.cod_collected,
            d.id, 'COD of delivered parcel', auth.uid());
  end if;
  perform private.ops_refresh_hub_day(d.hub_id, d.delivery_date);
end $$;

-- ---------------------------------------------------------------------
-- Cash: hub collections, handover chain, merchant payments, expenses
-- ---------------------------------------------------------------------
-- Cash a manager takes in at the hub counter (not through a rider).
create or replace function public.ops_record_cash_collection(
  p_hub uuid, p_date date, p_amount numeric, p_source text, p_note text, p_merchant uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  v_id   uuid;
begin
  if v_zone is null or not private.has_permission('ops.cash.create', v_zone, p_hub) then
    raise exception 'Not authorised to record cash for this hub.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('merchant_deposit','other') then
    raise exception 'Source must be merchant_deposit or other. COD and pickup cash come from approved records.'
      using errcode = '22023';
  end if;
  if not private.ops_date_ok(p_date) then raise exception 'The date is outside the allowed period.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = '22023'; end if;
  insert into public.cash_collections (collection_date, hub_id, zone_id, source, holder, merchant_id, amount, note, recorded_by)
  values (p_date, p_hub, v_zone, p_source, 'hub', p_merchant, p_amount, p_note, auth.uid())
  returning id into v_id;
  perform private.ops_refresh_hub_day(p_hub, p_date);
  return v_id;
end $$;

create table public.operational_expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_date    date not null,
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  category        text not null check (category in
                  ('fuel','vehicle_maintenance','rent','utilities','packaging','office','conveyance','other')),
  amount          numeric(14,2) not null check (amount > 0),
  description     text not null check (length(trim(description)) > 2),
  rider_id        uuid references public.employees(id),
  paid_from       text not null default 'hub_cash' check (paid_from in ('hub_cash','rider_cash')),
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  recorded_by     uuid not null,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  ledger_entry_id uuid,   -- ACCOUNTS HOOK
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint operational_expenses_rider_chk check (paid_from <> 'rider_cash' or rider_id is not null)
);
create index operational_expenses_hub_idx on public.operational_expenses (hub_id, expense_date);

create table public.cash_handovers (
  id              uuid primary key default gen_random_uuid(),
  handover_no     text not null unique default ('HO-' || lpad(nextval('public.cash_handover_no_seq')::text, 6, '0')),
  level           text not null check (level in ('rider_to_hub','hub_to_accounts')),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  rider_id        uuid references public.employees(id),
  handover_date   date not null default current_date,
  expected_amount numeric(14,2) not null,                          -- balance on record when submitted
  declared_amount numeric(14,2) not null check (declared_amount > 0),   -- what the giver says was handed over
  received_amount numeric(14,2) check (received_amount >= 0),           -- what the receiver counted
  shortage_amount numeric(14,2) generated always as (declared_amount - received_amount) stored,  -- + short, - excess
  status          text not null default 'submitted' check (status in ('submitted','confirmed','cancelled')),
  handed_by       uuid not null,
  handed_at       timestamptz not null default now(),
  note            text,
  received_by     uuid,
  received_at     timestamptz,
  receiver_note   text,
  cancel_reason   text,
  ledger_entry_id uuid,   -- ACCOUNTS HOOK (a shortage becomes a receivable from the giver)
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint cash_handovers_rider_chk check ((level = 'rider_to_hub') = (rider_id is not null)),
  constraint cash_handovers_confirm_chk check (status <> 'confirmed' or (received_amount is not null and received_by is not null)),
  constraint cash_handovers_shortage_chk check (status <> 'confirmed' or received_amount = declared_amount
                                                or length(trim(coalesce(receiver_note, ''))) > 0)
);
create unique index cash_handovers_one_open_per_rider on public.cash_handovers (rider_id)
  where level = 'rider_to_hub' and status = 'submitted';
create index cash_handovers_hub_idx on public.cash_handovers (hub_id, handover_date);

create table public.merchant_payments (
  id              uuid primary key default gen_random_uuid(),
  payment_no      text not null unique default ('MP-' || lpad(nextval('public.merchant_payment_no_seq')::text, 6, '0')),
  merchant_id     uuid not null references public.merchants(id),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  payment_date    date not null,
  amount          numeric(14,2) not null check (amount > 0),
  method          text not null check (method in ('cash','bank','mobile_banking')),
  reference       text,
  note            text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by    uuid not null,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  ledger_entry_id uuid,   -- ACCOUNTS HOOK
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint merchant_payments_reference_chk check (method = 'cash' or length(trim(coalesce(reference, ''))) > 0)
);
create index merchant_payments_merchant_idx on public.merchant_payments (merchant_id, payment_date);
create index merchant_payments_hub_idx on public.merchant_payments (hub_id, payment_date);

create table public.cash_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  recon_date         date not null,
  opening_balance    numeric(14,2) not null,
  rider_handovers_in numeric(14,2) not null,
  hub_collections_in numeric(14,2) not null,
  sent_to_accounts   numeric(14,2) not null,
  merchant_cash_paid numeric(14,2) not null,
  expenses_paid      numeric(14,2) not null,
  expected_closing   numeric(14,2) not null,
  counted_cash       numeric(14,2) not null check (counted_cash >= 0),
  difference         numeric(14,2) generated always as (counted_cash - expected_closing) stored,   -- - short, + excess
  note               text,
  status             text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  prepared_by        uuid not null,
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  ledger_entry_id    uuid,   -- ACCOUNTS HOOK (post the difference)
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint cash_reconciliations_note_chk check (counted_cash = expected_closing or length(trim(coalesce(note, ''))) > 0)
);
create unique index cash_reconciliations_one_per_day on public.cash_reconciliations (hub_id, recon_date)
  where status <> 'rejected';

-- Cash a rider still holds: collected - received by the hub - approved expenses paid from it.
-- A shortage stays in this balance until it is settled.
create or replace function private.rider_cash_balance(p_rider uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(c.amount) from public.cash_collections c
                   where c.rider_id = p_rider and c.holder = 'rider' and c.voided_at is null), 0)
       - coalesce((select sum(h.received_amount) from public.cash_handovers h
                   where h.rider_id = p_rider and h.level = 'rider_to_hub' and h.status = 'confirmed'), 0)
       - coalesce((select sum(e.amount) from public.operational_expenses e
                   where e.rider_id = p_rider and e.paid_from = 'rider_cash' and e.status = 'approved'), 0)
$$;

-- Hub cash movements between two dates (p_from null = from the beginning).
create or replace function private.hub_cash_movements(p_hub uuid, p_from date, p_to date)
returns table (rider_in numeric, hub_in numeric, accounts_out numeric, merchant_out numeric, expense_out numeric)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(h.received_amount) from public.cash_handovers h
              where h.hub_id = p_hub and h.level = 'rider_to_hub' and h.status = 'confirmed'
                and h.handover_date <= p_to and (p_from is null or h.handover_date >= p_from)), 0),
    coalesce((select sum(c.amount) from public.cash_collections c
              where c.hub_id = p_hub and c.holder = 'hub' and c.voided_at is null
                and c.collection_date <= p_to and (p_from is null or c.collection_date >= p_from)), 0),
    coalesce((select sum(h.declared_amount) from public.cash_handovers h      -- cash leaves the hub when it is sent
              where h.hub_id = p_hub and h.level = 'hub_to_accounts' and h.status in ('submitted','confirmed')
                and h.handover_date <= p_to and (p_from is null or h.handover_date >= p_from)), 0),
    coalesce((select sum(m.amount) from public.merchant_payments m
              where m.hub_id = p_hub and m.method = 'cash' and m.status = 'approved'
                and m.payment_date <= p_to and (p_from is null or m.payment_date >= p_from)), 0),
    coalesce((select sum(e.amount) from public.operational_expenses e
              where e.hub_id = p_hub and e.paid_from = 'hub_cash' and e.status = 'approved'
                and e.expense_date <= p_to and (p_from is null or e.expense_date >= p_from)), 0)
$$;

-- Expected hub cash for a day. Opening = cash counted at the last approved
-- reconciliation plus movements since; without one, all movements so far.
create or replace function private.hub_cash_position(
  p_hub uuid, p_date date,
  out opening_balance numeric, out rider_handovers_in numeric, out hub_collections_in numeric,
  out sent_to_accounts numeric, out merchant_cash_paid numeric, out expenses_paid numeric,
  out expected_closing numeric, out last_reconciled date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_counted numeric;
  m record;
begin
  select r.recon_date, r.counted_cash into last_reconciled, v_counted
  from public.cash_reconciliations r
  where r.hub_id = p_hub and r.status = 'approved' and r.recon_date < p_date
  order by r.recon_date desc limit 1;

  select x.rider_in + x.hub_in - x.accounts_out - x.merchant_out - x.expense_out as net into m
  from private.hub_cash_movements(p_hub, last_reconciled + 1, p_date - 1) x;
  opening_balance := coalesce(v_counted, 0) + m.net;

  select x.* into m from private.hub_cash_movements(p_hub, p_date, p_date) x;
  rider_handovers_in := m.rider_in;
  hub_collections_in := m.hub_in;
  sent_to_accounts   := m.accounts_out;
  merchant_cash_paid := m.merchant_out;
  expenses_paid      := m.expense_out;
  expected_closing   := opening_balance + m.rider_in + m.hub_in - m.accounts_out - m.merchant_out - m.expense_out;
end $$;

create or replace function public.ops_cash_position(p_hub uuid, p_date date)
returns table (opening_balance numeric, rider_handovers_in numeric, hub_collections_in numeric, sent_to_accounts numeric,
               merchant_cash_paid numeric, expenses_paid numeric, expected_closing numeric, last_reconciled date)
language sql stable security definer set search_path = '' as $$
  select p.* from private.hub_cash_position(p_hub, p_date) p
  where private.has_permission('ops.cash.view', null, p_hub) or private.has_permission('ops.reconciliation.view', null, p_hub)
$$;

-- Rider hands cash to the hub. Hub staff may submit for a rider without a login.
create or replace function public.ops_submit_rider_handover(
  p_hub uuid, p_amount numeric, p_rider uuid default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone     uuid := private.hub_zone(p_hub);
  v_me       uuid := private.my_employee_id();
  v_rider    uuid := coalesce(p_rider, private.my_employee_id());
  v_expected numeric;
  v_id       uuid;
begin
  if v_zone is null or not private.has_permission('ops.rider_handover.create', v_zone, p_hub)
     or not (v_rider = v_me or private.has_permission('ops.cash.create', v_zone, p_hub)) is true then
    raise exception 'Not authorised to submit this handover.' using errcode = '42501';
  end if;
  if not private.is_current_rider(v_rider, p_hub) then
    raise exception 'The rider is not currently assigned to this hub.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if exists (select 1 from public.cash_handovers h where h.rider_id = v_rider and h.level = 'rider_to_hub' and h.status = 'submitted') then
    raise exception 'This rider already has a handover waiting for confirmation.' using errcode = 'P0001';
  end if;
  v_expected := private.rider_cash_balance(v_rider);
  if p_amount <> v_expected and coalesce(trim(p_note), '') = '' then
    raise exception 'The amount (%) differs from the cash on record for this rider (%). A note is required.', p_amount, v_expected
      using errcode = '22023';
  end if;
  insert into public.cash_handovers (level, hub_id, zone_id, rider_id, expected_amount, declared_amount, handed_by, note)
  values ('rider_to_hub', p_hub, v_zone, v_rider, v_expected, p_amount, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Hub sends cash to Main Accounts. Cannot exceed the hub cash on record.
create or replace function public.ops_submit_hub_handover(p_hub uuid, p_amount numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone     uuid := private.hub_zone(p_hub);
  v_expected numeric;
  v_id       uuid;
begin
  if v_zone is null or not private.has_permission('ops.hub_handover.create', v_zone, p_hub) then
    raise exception 'Not authorised to hand over cash for this hub.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  select p.expected_closing into v_expected from private.hub_cash_position(p_hub, current_date) p;
  if p_amount > v_expected then
    raise exception 'The amount (%) is more than the hub cash on record (%). Confirm rider handovers first.', p_amount, v_expected
      using errcode = 'P0001';
  end if;
  insert into public.cash_handovers (level, hub_id, zone_id, expected_amount, declared_amount, handed_by, note)
  values ('hub_to_accounts', p_hub, v_zone, v_expected, p_amount, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

-- The RECEIVER states what was actually received. A difference needs a note
-- and is recorded as a shortage (or excess) against the giver.
create or replace function public.ops_confirm_handover(p_id uuid, p_received numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.cash_handovers%rowtype;
begin
  select * into h from public.cash_handovers where id = p_id for update;
  if h.id is null or not private.has_permission(
       case when h.level = 'rider_to_hub' then 'ops.rider_handover.approve' else 'ops.hub_handover.approve' end,
       h.zone_id, h.hub_id) then
    raise exception 'Handover not found or not authorised to confirm.' using errcode = '42501';
  end if;
  if h.handed_by = auth.uid() or h.rider_id = private.my_employee_id() then
    raise exception 'The person who hands over cash cannot confirm receiving it.' using errcode = '42501';
  end if;
  if h.status <> 'submitted' then raise exception 'This handover is already %.', h.status using errcode = 'P0001'; end if;
  if p_received is null or p_received < 0 then raise exception 'Enter the amount actually received.' using errcode = '22023'; end if;
  if p_received <> h.declared_amount and coalesce(trim(p_note), '') = '' then
    raise exception 'Received (%) differs from declared (%). A note is required.', p_received, h.declared_amount
      using errcode = '22023';
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), 'Handover confirmed'), true);
  update public.cash_handovers
     set status = 'confirmed', received_amount = p_received, received_by = auth.uid(), received_at = now(),
         receiver_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;

create or replace function public.ops_cancel_handover(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.cash_handovers%rowtype;
begin
  select * into h from public.cash_handovers where id = p_id for update;
  if h.id is null or h.handed_by <> auth.uid() then
    raise exception 'Only the person who submitted a handover can cancel it.' using errcode = '42501';
  end if;
  if h.status <> 'submitted' then raise exception 'This handover is already %.', h.status using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.cash_handovers set status = 'cancelled', cancel_reason = p_reason where id = p_id;
end $$;

create or replace function public.ops_record_expense(
  p_hub uuid, p_date date, p_category text, p_amount numeric, p_description text,
  p_paid_from text default 'hub_cash', p_rider uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_me    uuid := private.my_employee_id();
  v_rider uuid := p_rider;
  v_id    uuid;
begin
  if v_zone is null or not private.has_permission('ops.expense.create', v_zone, p_hub) then
    raise exception 'Not authorised to record expenses for this hub.' using errcode = '42501';
  end if;
  if coalesce(p_paid_from, '') not in ('hub_cash','rider_cash') then
    raise exception 'Paid from must be hub_cash or rider_cash.' using errcode = '22023';
  end if;
  if p_paid_from = 'rider_cash' and v_rider is null then v_rider := v_me; end if;
  if (v_rider is distinct from v_me or p_paid_from = 'hub_cash')
     and not private.has_permission('ops.cash.create', v_zone, p_hub) then
    raise exception 'Riders can record only their own expenses paid from the cash they hold.' using errcode = '42501';
  end if;
  if v_rider is not null and not private.is_current_rider(v_rider, p_hub) then
    raise exception 'The rider is not currently assigned to this hub.' using errcode = '22023';
  end if;
  if not private.ops_date_ok(p_date) then raise exception 'The date is outside the allowed period.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  insert into public.operational_expenses (expense_date, hub_id, zone_id, category, amount, description, rider_id, paid_from, recorded_by)
  values (p_date, p_hub, v_zone, p_category, p_amount, p_description, v_rider, p_paid_from, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_decide_expense(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.operational_expenses%rowtype;
begin
  select * into e from public.operational_expenses where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if e.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'ops.expense.approve' else 'ops.expense.reject' end, e.zone_id, e.hub_id) then
    raise exception 'Expense not found or not authorised.' using errcode = '42501';
  end if;
  if e.recorded_by = auth.uid() or e.rider_id = private.my_employee_id() then
    raise exception 'You cannot decide an expense you recorded or spent.' using errcode = '42501';
  end if;
  if e.status <> 'pending' then raise exception 'This expense has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when an expense is rejected.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.operational_expenses
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_decision = 'approved' then perform private.ops_refresh_hub_day(e.hub_id, e.expense_date); end if;
end $$;

-- COD collected for the merchant on approved deliveries, less payments already approved.
-- (Delivery charges are deducted by the Accounts phase; until then this is the ceiling.)
create or replace function private.merchant_payable(p_merchant uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(d.cod_collected) from public.delivery_records d
                   where d.merchant_id = p_merchant and d.status = 'approved' and d.outcome = 'delivered'), 0)
       - coalesce((select sum(m.amount) from public.merchant_payments m
                   where m.merchant_id = p_merchant and m.status = 'approved'), 0)
$$;

create or replace function public.ops_request_merchant_payment(
  p_merchant uuid, p_hub uuid, p_amount numeric, p_method text,
  p_reference text default null, p_date date default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  v_id   uuid;
begin
  if v_zone is null or not private.has_permission('ops.merchant_payment.create', v_zone, p_hub) then
    raise exception 'Not authorised to request merchant payments for this hub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.merchants m where m.id = p_merchant and m.archived_at is null) then
    raise exception 'Merchant not found.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if coalesce(p_method, '') not in ('cash','bank','mobile_banking') then
    raise exception 'Method must be cash, bank or mobile_banking.' using errcode = '22023';
  end if;
  if p_method <> 'cash' and coalesce(trim(p_reference), '') = '' then
    raise exception 'A transaction reference is required for bank and mobile banking payments.' using errcode = '22023';
  end if;
  if not private.ops_date_ok(coalesce(p_date, current_date)) then
    raise exception 'The date is outside the allowed period.' using errcode = '22023';
  end if;
  insert into public.merchant_payments (merchant_id, hub_id, zone_id, payment_date, amount, method, reference, note, requested_by)
  values (p_merchant, p_hub, v_zone, coalesce(p_date, current_date), p_amount, p_method, nullif(trim(p_reference), ''), p_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_decide_merchant_payment(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m         public.merchant_payments%rowtype;
  v_payable numeric;
begin
  select * into m from public.merchant_payments where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if m.id is null or not private.has_permission(
       case when p_decision = 'approved' then 'ops.merchant_payment.approve' else 'ops.merchant_payment.reject' end,
       m.zone_id, m.hub_id) then
    raise exception 'Merchant payment not found or not authorised.' using errcode = '42501';
  end if;
  if m.requested_by = auth.uid() then
    raise exception 'You cannot decide a merchant payment you requested.' using errcode = '42501';
  end if;
  if m.status <> 'pending' then raise exception 'This payment has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a payment is rejected.' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    perform 1 from public.merchants x where x.id = m.merchant_id for update;   -- serialise payments per merchant
    v_payable := private.merchant_payable(m.merchant_id);
    if m.amount > v_payable then
      raise exception 'The payment (%) is more than the COD collected and not yet paid for this merchant (%).', m.amount, v_payable
        using errcode = 'P0001';
    end if;
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.merchant_payments
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;

-- Daily cash count of a hub against the expected closing balance.
create or replace function public.ops_submit_reconciliation(p_hub uuid, p_date date, p_counted numeric, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  pos    record;
  v_id   uuid;
begin
  if v_zone is null or not private.has_permission('ops.reconciliation.create', v_zone, p_hub) then
    raise exception 'Not authorised to reconcile cash for this hub.' using errcode = '42501';
  end if;
  if p_date is null or p_date > current_date then raise exception 'The date cannot be in the future.' using errcode = '22023'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash counted.' using errcode = '22023'; end if;
  if exists (select 1 from public.cash_reconciliations r where r.hub_id = p_hub and r.recon_date = p_date and r.status <> 'rejected') then
    raise exception 'This day has already been reconciled.' using errcode = 'P0001';
  end if;
  select * into pos from private.hub_cash_position(p_hub, p_date);
  if p_counted <> pos.expected_closing and coalesce(trim(p_note), '') = '' then
    raise exception 'Cash counted (%) differs from expected (%). A note explaining the difference is required.',
      p_counted, pos.expected_closing using errcode = '22023';
  end if;
  insert into public.cash_reconciliations (hub_id, zone_id, recon_date, opening_balance, rider_handovers_in, hub_collections_in,
                                           sent_to_accounts, merchant_cash_paid, expenses_paid, expected_closing, counted_cash,
                                           note, prepared_by)
  values (p_hub, v_zone, p_date, pos.opening_balance, pos.rider_handovers_in, pos.hub_collections_in, pos.sent_to_accounts,
          pos.merchant_cash_paid, pos.expenses_paid, pos.expected_closing, p_counted, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ops_decide_reconciliation(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cash_reconciliations%rowtype;
begin
  select * into r from public.cash_reconciliations where id = p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if r.id is null or not private.has_permission('ops.reconciliation.approve', r.zone_id, r.hub_id) then
    raise exception 'Reconciliation not found or not authorised.' using errcode = '42501';
  end if;
  if r.prepared_by = auth.uid() then
    raise exception 'You cannot decide a reconciliation you prepared.' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then raise exception 'This reconciliation has already been decided.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required when a reconciliation is rejected.' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_note), ''), p_decision), true);
  update public.cash_reconciliations
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Parcel issues
-- ---------------------------------------------------------------------
create table public.parcel_issues (
  id          uuid primary key default gen_random_uuid(),
  issue_no    text not null unique default ('PI-' || lpad(nextval('public.parcel_issue_no_seq')::text, 6, '0')),
  parcel_id   uuid not null references public.parcels(id),
  hub_id      uuid not null references public.hubs(id),
  zone_id     uuid not null references public.zones(id),
  issue_type  text not null check (issue_type in
              ('damaged','lost','wrong_address','customer_complaint','cod_mismatch','delay','merchant_dispute','other')),
  priority    text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  description text not null check (length(trim(description)) > 2),
  status      text not null default 'open' check (status in ('open','assigned','resolved')),
  reported_by uuid not null,
  assigned_to uuid references public.profiles(id),
  assigned_at timestamptz,
  resolution  text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint parcel_issues_resolution_chk check (status <> 'resolved' or length(trim(coalesce(resolution, ''))) > 0)
);
create index parcel_issues_parcel_idx on public.parcel_issues (parcel_id);
create index parcel_issues_open_idx on public.parcel_issues (hub_id, status) where status <> 'resolved';
create index parcel_issues_assignee_idx on public.parcel_issues (assigned_to) where status = 'assigned';

create table public.parcel_issue_events (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.parcel_issues(id),
  event      text not null check (event in ('created','assigned','comment','resolved','reopened')),
  note       text,
  actor_id   uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index parcel_issue_events_issue_idx on public.parcel_issue_events (issue_id, created_at);
create trigger parcel_issue_events_append_only before update or delete on public.parcel_issue_events
  for each row execute function private.append_only();

create or replace function public.ops_open_issue(
  p_tracking_no text, p_type text, p_description text, p_priority text default 'normal'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p    public.parcels%rowtype;
  v_id uuid;
begin
  -- explicit operator: with an empty search_path a bare "=" would compare as case-sensitive text
  select * into p from public.parcels x where x.tracking_no operator(extensions.=) trim(p_tracking_no)::extensions.citext;
  if p.id is null or not private.has_permission('ops.issue.create', p.zone_id, p.hub_id) then
    raise exception 'Parcel not found or not authorised to report an issue for it.' using errcode = '42501';
  end if;
  insert into public.parcel_issues (parcel_id, hub_id, zone_id, issue_type, priority, description, reported_by)
  values (p.id, p.hub_id, p.zone_id, p_type, coalesce(p_priority, 'normal'), p_description, auth.uid())
  returning id into v_id;
  insert into public.parcel_issue_events (issue_id, event, note) values (v_id, 'created', p_description);
  return v_id;
end $$;

create or replace function public.ops_assign_issue(p_issue uuid, p_assignee uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue for update;
  if i.id is null or not private.has_permission('ops.issue.edit', i.zone_id, i.hub_id) then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if i.status = 'resolved' then raise exception 'A resolved issue must be reopened first.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_assignee and pr.status = 'active' and pr.archived_at is null) then
    raise exception 'The assignee must be an active user.' using errcode = '22023';
  end if;
  update public.parcel_issues set status = 'assigned', assigned_to = p_assignee, assigned_at = now() where id = p_issue;
  insert into public.parcel_issue_events (issue_id, event, note)
  values (p_issue, 'assigned', coalesce(nullif(trim(p_note), ''), 'Assigned') || ' → ' ||
          (select pr.full_name from public.profiles pr where pr.id = p_assignee));
end $$;

create or replace function public.ops_comment_issue(p_issue uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue;
  if i.id is null or not (i.reported_by = auth.uid() or i.assigned_to = auth.uid()
                          or private.has_permission('ops.issue.edit', i.zone_id, i.hub_id)) is true then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A comment is required.' using errcode = '22023'; end if;
  insert into public.parcel_issue_events (issue_id, event, note) values (p_issue, 'comment', p_note);
end $$;

create or replace function public.ops_resolve_issue(p_issue uuid, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue for update;
  if i.id is null or not (i.assigned_to = auth.uid()
                          or private.has_permission('ops.issue.edit', i.zone_id, i.hub_id)) is true then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if i.status = 'resolved' then raise exception 'This issue is already resolved.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_resolution), '') = '' then raise exception 'Describe how the issue was resolved.' using errcode = '22023'; end if;
  update public.parcel_issues set status = 'resolved', resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now()
   where id = p_issue;
  insert into public.parcel_issue_events (issue_id, event, note) values (p_issue, 'resolved', p_resolution);
end $$;

create or replace function public.ops_reopen_issue(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.parcel_issues%rowtype;
begin
  select * into i from public.parcel_issues where id = p_issue for update;
  if i.id is null or not private.has_permission('ops.issue.edit', i.zone_id, i.hub_id) then
    raise exception 'Issue not found or not authorised.' using errcode = '42501';
  end if;
  if i.status <> 'resolved' then raise exception 'Only a resolved issue can be reopened.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.parcel_issues
     set status = case when assigned_to is null then 'open' else 'assigned' end, resolved_by = null, resolved_at = null
   where id = p_issue;
  insert into public.parcel_issue_events (issue_id, event, note) values (p_issue, 'reopened', p_reason);
end $$;

-- Search by parcel ID: the parcel, its delivery attempts and its issues with
-- full history. Runs with the caller's rights, so scope rules apply.
create or replace function public.ops_parcel_lookup(p_tracking_no text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'parcel', to_jsonb(p) || jsonb_build_object('merchant_name', (select m.name from public.merchants m where m.id = p.merchant_id)),
    'deliveries', coalesce((select jsonb_agg(to_jsonb(d) order by d.recorded_at)
                            from public.delivery_records d where d.parcel_id = p.id), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('history',
                          coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'note', e.note, 'actor_id', e.actor_id,
                                                                       'at', e.created_at) order by e.created_at, e.event)
                                    from public.parcel_issue_events e where e.issue_id = i.id), '[]'::jsonb))
                        order by i.created_at)
                        from public.parcel_issues i where i.parcel_id = p.id), '[]'::jsonb))
  from public.parcels p
  where p.tracking_no operator(extensions.=) trim(p_tracking_no)::extensions.citext
$$;

-- ---------------------------------------------------------------------
-- Approved data -> hub_daily_metrics (feeds the zonal dashboards of 0006)
-- ---------------------------------------------------------------------
-- Rebuilds one hub-day from APPROVED courier records only. working_hours is
-- not known to this module and is left as entered (0 for generated rows).
create or replace function private.ops_refresh_hub_day(p_hub uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v     record;
  v_ppr numeric := coalesce(private.setting_text('zonal.parcels_per_rider_day')::numeric, 45);
begin
  if p_hub is null or p_date is null or p_date > current_date then return; end if;
  select
    (select coalesce(sum(c.parcel_count), 0) from public.pickup_consolidations c
      where c.hub_id = p_hub and c.pickup_date = p_date and c.voided_at is null)::integer as pk,
    (select count(*) from public.delivery_records d
      where d.hub_id = p_hub and d.delivery_date = p_date and d.status = 'approved' and d.outcome = 'delivered')::integer as dl,
    (select count(*) from public.parcels p
      where p.hub_id = p_hub and p.received_date <= p_date and p.status <> 'cancelled'
        and not exists (select 1 from public.delivery_records d
                        where d.parcel_id = p.id and d.status = 'approved' and d.outcome in ('delivered','returned')
                          and d.delivery_date <= p_date))::integer as pend,
    (select count(distinct q.m) from (
        select c.merchant_id as m from public.pickup_consolidations c
         where c.hub_id = p_hub and c.pickup_date = p_date and c.voided_at is null
        union all
        select d.merchant_id from public.delivery_records d
         where d.hub_id = p_hub and d.delivery_date = p_date and d.status = 'approved') q)::integer as mer,
    (select count(distinct q.r) from (
        select c.rider_id as r from public.pickup_consolidations c
         where c.hub_id = p_hub and c.pickup_date = p_date and c.voided_at is null
        union all
        select d.rider_id from public.delivery_records d
         where d.hub_id = p_hub and d.delivery_date = p_date and d.status = 'approved') q)::integer as riders,
    (select coalesce(sum(c.amount), 0) from public.cash_collections c
      where c.hub_id = p_hub and c.collection_date = p_date and c.voided_at is null) as cash,
    (select coalesce(sum(e.amount), 0) from public.operational_expenses e
      where e.hub_id = p_hub and e.expense_date = p_date and e.status = 'approved') as spent
  into v;

  insert into public.hub_daily_metrics as hm
    (hub_id, zone_id, metric_date, pickup_count, delivery_count, pending_parcels, merchant_count, rider_count,
     rider_capacity, cash_collected, expenses, note, status, verified_by, verified_at, source)
  values (p_hub, private.hub_zone(p_hub), p_date, v.pk, v.dl, v.pend, v.mer, v.riders,
          (v.riders * v_ppr)::integer, v.cash, v.spent, 'Generated from approved courier records',
          'verified', auth.uid(), now(), 'courier')
  on conflict (hub_id, metric_date) do update
    set pickup_count = excluded.pickup_count, delivery_count = excluded.delivery_count,
        pending_parcels = excluded.pending_parcels, merchant_count = excluded.merchant_count,
        rider_count = excluded.rider_count, rider_capacity = excluded.rider_capacity,
        working_hours = least(hm.working_hours, excluded.rider_count * 24),
        cash_collected = excluded.cash_collected, expenses = excluded.expenses,
        note = excluded.note, status = 'verified', verified_by = excluded.verified_by,
        verified_at = excluded.verified_at, source = 'courier';
end $$;

-- ---------------------------------------------------------------------
-- Reports (approved records only)
-- ---------------------------------------------------------------------
-- p_group = date | hub | zone | rider | merchant. Runs with the caller's rights.
create or replace function public.ops_daily_report(
  p_group text, p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (group_key text, group_label text, pickup_parcels bigint, pickup_cod numeric,
                 delivered bigint, failed bigint, returned bigint, success_pct numeric,
                 cod_expected numeric, cod_collected numeric, cash_collected numeric, expenses numeric)
language sql stable security invoker set search_path = '' as $$
  with f as (
    select c.pickup_date as d, c.hub_id, c.zone_id, c.rider_id, c.merchant_id,
           c.parcel_count::bigint as pk, c.cod_amount as pk_cod, 0::bigint as dl, 0::bigint as fl, 0::bigint as rt,
           0::numeric as cod_exp, 0::numeric as cod_col, 0::numeric as cash, 0::numeric as spent
    from public.pickup_consolidations c
    where c.voided_at is null and c.pickup_date between p_from and p_to
    union all
    select r.delivery_date, r.hub_id, r.zone_id, r.rider_id, r.merchant_id, 0, 0,
           (r.outcome = 'delivered')::integer, (r.outcome = 'failed')::integer, (r.outcome = 'returned')::integer,
           r.cod_expected, r.cod_collected, 0, 0
    from public.delivery_records r
    where r.status = 'approved' and r.delivery_date between p_from and p_to
    union all
    select cc.collection_date, cc.hub_id, cc.zone_id, cc.rider_id, cc.merchant_id, 0, 0, 0, 0, 0, 0, 0, cc.amount, 0
    from public.cash_collections cc
    where cc.voided_at is null and cc.collection_date between p_from and p_to
    union all
    select e.expense_date, e.hub_id, e.zone_id, e.rider_id, null::uuid, 0, 0, 0, 0, 0, 0, 0, 0, e.amount
    from public.operational_expenses e
    where e.status = 'approved' and e.expense_date between p_from and p_to
  )
  select k.gkey, k.glabel, sum(f.pk)::bigint, sum(f.pk_cod), sum(f.dl)::bigint, sum(f.fl)::bigint, sum(f.rt)::bigint,
         round(100.0 * sum(f.dl) / nullif(sum(f.dl + f.fl + f.rt), 0), 1),
         sum(f.cod_exp), sum(f.cod_col), sum(f.cash), sum(f.spent)
  from f
  left join public.hubs h on h.id = f.hub_id
  left join public.zones z on z.id = f.zone_id
  left join public.merchants m on m.id = f.merchant_id
  cross join lateral (
    select case p_group when 'date' then to_char(f.d::timestamp, 'YYYY-MM-DD')
                        when 'hub' then h.code::text
                        when 'zone' then z.code::text
                        when 'rider' then f.rider_id::text
                        when 'merchant' then m.code::text end as gkey,
           case p_group when 'date' then to_char(f.d::timestamp, 'DD/MM/YYYY')
                        when 'hub' then h.name
                        when 'zone' then z.name
                        when 'rider' then private.employee_label(f.rider_id)
                        when 'merchant' then m.name end as glabel
  ) k
  where p_group in ('date','hub','zone','rider','merchant')
    and (p_zone is null or f.zone_id = p_zone)
    and (p_hub is null or f.hub_id = p_hub)
    and (p_group <> 'rider' or f.rider_id is not null)
    and (p_group <> 'merchant' or f.merchant_id is not null)
  group by k.gkey, k.glabel
  order by k.gkey
$$;

-- Rider ledger: cash collected, expenses paid from it, handovers received by
-- the hub, with a running balance of what the rider still holds.
create or replace function public.ops_rider_ledger(p_rider uuid, p_from date, p_to date)
returns table (entry_date date, kind text, reference text, cash_in numeric, cash_out numeric, balance numeric)
language sql stable security definer set search_path = '' as $$
  with x as (
    select c.collection_date as d, c.created_at as ts, 1 as ord, c.source as kind, coalesce(c.note, '') as ref,
           c.amount as cin, 0::numeric as cout, c.zone_id, c.hub_id
    from public.cash_collections c
    where c.rider_id = p_rider and c.holder = 'rider' and c.voided_at is null
    union all
    select h.handover_date, h.received_at, 3, 'handover',
           h.handover_no || case when h.shortage_amount > 0 then ' (short ' || h.shortage_amount || ')'
                                 when h.shortage_amount < 0 then ' (excess ' || (-h.shortage_amount) || ')' else '' end,
           0, h.received_amount, h.zone_id, h.hub_id
    from public.cash_handovers h
    where h.rider_id = p_rider and h.level = 'rider_to_hub' and h.status = 'confirmed'
    union all
    select e.expense_date, e.decided_at, 2, 'expense', e.category || ': ' || e.description, 0, e.amount, e.zone_id, e.hub_id
    from public.operational_expenses e
    where e.rider_id = p_rider and e.paid_from = 'rider_cash' and e.status = 'approved'
  ), v as (
    select x.*, sum(x.cin - x.cout) over (order by x.d, x.ts, x.ord, x.ref
                                          rows between unbounded preceding and current row) as bal
    from x
    where p_rider = private.my_employee_id() or private.has_permission('ops.cash.view', x.zone_id, x.hub_id)
  )
  select v.d, v.kind, v.ref, v.cin, v.cout, v.bal from v
  where v.d between p_from and p_to
  order by v.d, v.ts, v.ord, v.ref
$$;

-- COD reconciliation per rider: expected vs collected vs handed over.
create or replace function public.ops_cod_reconciliation(
  p_from date, p_to date, p_zone uuid default null, p_hub uuid default null
) returns table (rider_id uuid, rider_label text, delivered bigint, cod_expected numeric, cod_collected numeric,
                 cod_difference numeric, handed_over numeric, shortage_recorded numeric, balance_outstanding numeric)
language sql stable security invoker set search_path = '' as $$
  select d.rider_id, private.employee_label(d.rider_id),
         count(*) filter (where d.outcome = 'delivered'),
         sum(d.cod_expected), sum(d.cod_collected), sum(d.cod_expected - d.cod_collected),
         coalesce((select sum(h.received_amount) from public.cash_handovers h
                   where h.rider_id = d.rider_id and h.level = 'rider_to_hub' and h.status = 'confirmed'
                     and h.handover_date between p_from and p_to), 0),
         coalesce((select sum(h.shortage_amount) from public.cash_handovers h
                   where h.rider_id = d.rider_id and h.level = 'rider_to_hub' and h.status = 'confirmed'
                     and h.handover_date between p_from and p_to), 0),
         private.rider_cash_balance(d.rider_id)
  from public.delivery_records d
  where d.status = 'approved' and d.delivery_date between p_from and p_to
    and (p_zone is null or d.zone_id = p_zone)
    and (p_hub is null or d.hub_id = p_hub)
  group by d.rider_id
  order by 2
$$;

-- One hub, one day: approved figures plus everything still waiting for someone.
create or replace function public.ops_hub_summary(p_hub uuid, p_date date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.has_permission('ops.report.view', null, p_hub) then
    raise exception 'Not authorised to view reports for this hub.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hub_id', p_hub, 'date', p_date,
    'approved', (select to_jsonb(r) - 'group_key' - 'group_label'
                 from public.ops_daily_report('hub', p_date, p_date, null, p_hub) r),
    'pickups', (select jsonb_build_object(
                  'groups', count(*),
                  'waiting', count(*) filter (where g.group_status <> 'approved'),
                  'duplicates', count(*) filter (where g.check_state = 'duplicate'),
                  'conflicts', count(*) filter (where g.check_state = 'conflict' and g.group_status <> 'approved'))
                from public.ops_pickup_groups(p_date, p_date, null, p_hub) g),
    'parcels', (select jsonb_build_object(
                  'at_hub', count(*) filter (where p.status = 'at_hub'),
                  'out_for_delivery', count(*) filter (where p.status = 'out_for_delivery'))
                from public.parcels p where p.hub_id = p_hub),
    'deliveries_waiting', (select count(*) from public.delivery_records d where d.hub_id = p_hub and d.status = 'pending'),
    'handovers_waiting', (select count(*) from public.cash_handovers h where h.hub_id = p_hub and h.status = 'submitted'),
    'expenses_waiting', (select count(*) from public.operational_expenses e where e.hub_id = p_hub and e.status = 'pending'),
    'open_issues', (select count(*) from public.parcel_issues i where i.hub_id = p_hub and i.status <> 'resolved'),
    'cash', (select to_jsonb(c) from public.ops_cash_position(p_hub, p_date) c));
end $$;

-- ---------------------------------------------------------------------
-- Stamp / audit / no-delete
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['merchants','parcels','ops_assignments','pickup_submissions','pickup_consolidations',
                           'delivery_records','cash_collections','cash_handovers','merchant_payments',
                           'operational_expenses','cash_reconciliations','parcel_issues'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''ops'')', t || '_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger parcel_issue_events_audit after insert on public.parcel_issue_events
  for each row execute function private.audit_row('ops');

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['merchants','parcels','ops_assignments','pickup_submissions','pickup_consolidations',
                           'delivery_records','cash_collections','cash_handovers','merchant_payments',
                           'operational_expenses','cash_reconciliations','parcel_issues','parcel_issue_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke delete, truncate on public.%I from authenticated', t);
    -- Only merchants and parcels are written directly; everything else goes through the workflow functions.
    if t not in ('merchants','parcels') then
      execute format('revoke insert, update on public.%I from authenticated', t);
    end if;
  end loop;
end $$;
revoke all on sequence public.pickup_submission_no_seq, public.cash_handover_no_seq,
  public.merchant_payment_no_seq, public.parcel_issue_no_seq from anon, authenticated;

create policy merchants_read on public.merchants for select to authenticated
  using (private.has_permission('ops.merchant.view', zone_id, hub_id));
create policy merchants_insert on public.merchants for insert to authenticated
  with check (private.has_permission('ops.merchant.create', zone_id, hub_id));
create policy merchants_update on public.merchants for update to authenticated
  using (private.has_permission('ops.merchant.edit', zone_id, hub_id))
  with check (private.has_permission('ops.merchant.edit', zone_id, hub_id)
              and (archived_at is null or private.has_permission('ops.merchant.archive', zone_id, hub_id)));

-- parcels: by scope, or the rider currently carrying the parcel
create policy parcels_read on public.parcels for select to authenticated
  using (private.has_permission('ops.parcel.view', zone_id, hub_id) or assigned_rider_id = private.my_employee_id());
create policy parcels_insert on public.parcels for insert to authenticated
  with check (private.has_permission('ops.parcel.create', zone_id, hub_id));
create policy parcels_update on public.parcels for update to authenticated
  using (private.has_permission('ops.parcel.edit', zone_id, hub_id))
  with check (private.has_permission('ops.parcel.edit', zone_id, hub_id));

create policy ops_assignments_read on public.ops_assignments for select to authenticated
  using (private.has_permission('ops.assignment.view', zone_id, hub_id) or employee_id = private.my_employee_id());

-- pickups: by scope, or a person's own submissions
create policy pickup_submissions_read on public.pickup_submissions for select to authenticated
  using (private.has_permission('ops.pickup.view', zone_id, hub_id) or submitted_by = auth.uid());
create policy pickup_consolidations_read on public.pickup_consolidations for select to authenticated
  using (private.has_permission('ops.pickup.view', zone_id, hub_id));

create policy delivery_records_read on public.delivery_records for select to authenticated
  using (private.has_permission('ops.delivery.view', zone_id, hub_id)
         or rider_id = private.my_employee_id() or recorded_by = auth.uid());

create policy cash_collections_read on public.cash_collections for select to authenticated
  using (private.has_permission('ops.cash.view', zone_id, hub_id) or rider_id = private.my_employee_id());
create policy cash_handovers_read on public.cash_handovers for select to authenticated
  using (private.has_permission('ops.handover.view', zone_id, hub_id)
         or handed_by = auth.uid() or rider_id = private.my_employee_id());
create policy merchant_payments_read on public.merchant_payments for select to authenticated
  using (private.has_permission('ops.merchant_payment.view', zone_id, hub_id));
create policy operational_expenses_read on public.operational_expenses for select to authenticated
  using (private.has_permission('ops.expense.view', zone_id, hub_id)
         or recorded_by = auth.uid() or rider_id = private.my_employee_id());
create policy cash_reconciliations_read on public.cash_reconciliations for select to authenticated
  using (private.has_permission('ops.reconciliation.view', zone_id, hub_id));

create policy parcel_issues_read on public.parcel_issues for select to authenticated
  using (private.has_permission('ops.issue.view', zone_id, hub_id)
         or reported_by = auth.uid() or assigned_to = auth.uid());
create policy parcel_issue_events_read on public.parcel_issue_events for select to authenticated
  using (exists (select 1 from public.parcel_issues i where i.id = issue_id));

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ops\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
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
join public.permissions p on p.module = 'ops' and (
     r.code = 'admin'
  or (r.code in ('head_office_manager','auditor') and p.action in ('view','export','print'))
  or (r.code = 'operations_manager' and (p.action in ('view','export','print') or p.code in (
        'ops.merchant.create','ops.merchant.edit','ops.merchant.archive','ops.parcel.create','ops.parcel.edit',
        'ops.assignment.create','ops.assignment.edit','ops.pickup.approve','ops.pickup.reject',
        'ops.pickup_verification.create','ops.delivery.approve','ops.delivery.reject',
        'ops.expense.approve','ops.expense.reject','ops.reconciliation.approve','ops.issue.create','ops.issue.edit')))
  or (r.code = 'zonal_manager' and (p.action in ('view','export','print') or p.code in (
        'ops.merchant.create','ops.merchant.edit','ops.assignment.create','ops.assignment.edit',
        'ops.pickup.approve','ops.pickup.reject','ops.pickup_verification.create',
        'ops.delivery.approve','ops.delivery.reject','ops.expense.approve','ops.expense.reject',
        'ops.reconciliation.approve','ops.issue.create','ops.issue.edit')))
  or (r.code = 'hub_manager' and (p.action = 'view' or p.code in (
        'ops.merchant.create','ops.merchant.edit','ops.parcel.create','ops.parcel.edit','ops.assignment.create',
        'ops.assignment.edit','ops.pickup_as_hub_manager.create','ops.pickup_verification.create',
        'ops.delivery.create','ops.delivery.approve','ops.delivery.reject','ops.cash.create',
        'ops.rider_handover.create','ops.rider_handover.approve','ops.hub_handover.create',
        'ops.merchant_payment.create','ops.expense.create','ops.reconciliation.create',
        'ops.issue.create','ops.issue.edit')))
  or (r.code = 'pickup_manager' and p.code in (
        'ops.merchant.view','ops.parcel.view','ops.parcel.create','ops.pickup.view',
        'ops.pickup_as_pickup_manager.create','ops.issue.view','ops.issue.create','ops.report.view'))
  or (r.code = 'delivery_manager' and p.code in (
        'ops.merchant.view','ops.parcel.view','ops.parcel.edit','ops.assignment.view','ops.delivery.view',
        'ops.delivery.create','ops.delivery.approve','ops.delivery.reject',
        'ops.issue.view','ops.issue.create','ops.issue.edit','ops.report.view'))
  or (r.code = 'rider' and p.code in (
        'ops.merchant.view','ops.pickup_as_rider.create','ops.delivery.create','ops.rider_handover.create',
        'ops.expense.create','ops.issue.create'))
  or (r.code = 'accounts_manager' and (p.action in ('view','export','print') or p.code in (
        'ops.hub_handover.approve','ops.merchant_payment.approve','ops.merchant_payment.reject',
        'ops.expense.approve','ops.expense.reject','ops.reconciliation.approve')))
  or (r.code = 'accountant' and (p.action = 'view' or p.code in ('ops.hub_handover.approve','ops.merchant_payment.create')))
)
on conflict do nothing;
