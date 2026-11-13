-- =====================================================================
-- XZM-TEAM ERP — Migration 0004: compensation, salary sheets, attendance, leave
--   Net Payable = Basic Salary + Transport + Commission + Other Allowances − Deductions
--   * Salary sheets use only APPROVED compensation records (maker ≠ checker).
--   * Approved sheets are locked; attendance in a locked month is locked.
--   * Payment is recorded later by Accounts; a sheet, voucher or signature image
--     is never treated as proof of payment.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description)
select 'hr.' || r || '.' || a, 'hr', r, a, d from (values
  ('compensation','view','View salary structure of employees in scope'),
  ('compensation','create','Propose salary / allowance changes'),
  ('compensation','approve','Approve salary / allowance changes'),
  ('compensation','reject','Reject salary / allowance changes'),
  ('compensation','configure','Configure allowance and deduction types'),
  ('salary_sheet','view','View salary sheets'),
  ('salary_sheet','create','Prepare salary sheets'),
  ('salary_sheet','approve','Approve salary sheets'),
  ('salary_sheet','export','Export / print salary sheets'),
  ('attendance','view','View attendance'),
  ('attendance','create','Record attendance'),
  ('attendance','edit','Correct attendance'),
  ('attendance','export','Export attendance reports'),
  ('leave','view','View leave requests'),
  ('leave','create','Request leave for staff'),
  ('leave','approve','Approve leave'),
  ('leave','reject','Reject leave'),
  ('leave','configure','Configure leave types')
) v(r, a, d);

-- ---------------------------------------------------------------------
-- Allowance / deduction types (configurable)
-- ---------------------------------------------------------------------
create table public.pay_component_types (
  id          uuid primary key default gen_random_uuid(),
  code        extensions.citext not null unique,
  kind        text not null check (kind in ('allowance','deduction')),
  name        text not null,
  name_bn     text,
  status      text not null default 'active' check (status in ('active','inactive')),
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid
);
insert into public.pay_component_types (code, kind, name, name_bn) values
  ('mobile_bill','allowance','Mobile bill','মোবাইল বিল'),
  ('meal','allowance','Meal allowance','খাবার ভাতা'),
  ('house_rent','allowance','House rent','বাড়ি ভাড়া'),
  ('other_allowance','allowance','Other allowance','অন্যান্য ভাতা'),
  ('absence','deduction','Absence deduction','অনুপস্থিতি কর্তন'),
  ('advance_recovery','deduction','Salary advance recovery','অগ্রিম বেতন সমন্বয়'),
  ('penalty','deduction','Penalty','জরিমানা'),
  ('tax','deduction','Income tax (TDS)','আয়কর'),
  ('other_deduction','deduction','Other deduction','অন্যান্য কর্তন');

-- ---------------------------------------------------------------------
-- Compensation (salary structure per employee, effective-dated, approved)
-- ---------------------------------------------------------------------
create table public.employee_compensation (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees(id),
  effective_from      date not null,
  effective_to        date,
  basic_salary        numeric(14,2) not null check (basic_salary >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  commission          numeric(14,2) not null default 0 check (commission >= 0),  -- default monthly commission
  status              text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason              text not null,
  approved_by         uuid,
  approved_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz not null default now(), created_by uuid,
  updated_at          timestamptz not null default now(), updated_by uuid,
  constraint compensation_dates check (effective_to is null or effective_to >= effective_from),
  constraint compensation_no_overlap exclude using gist (
    employee_id with =, daterange(effective_from, effective_to, '[]') with &&) where (status = 'approved')
);
create index employee_compensation_emp_idx on public.employee_compensation (employee_id, effective_from desc);

create table public.employee_compensation_items (
  id              uuid primary key default gen_random_uuid(),
  compensation_id uuid not null references public.employee_compensation(id),
  type_id         uuid not null references public.pay_component_types(id),
  amount          numeric(14,2) not null check (amount > 0),
  created_at      timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (compensation_id, type_id)
);

-- Approved compensation is frozen except closing its end date.
create or replace function private.compensation_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('approved','rejected') then
    if old.status = 'approved' and new.status = 'approved'
       and (to_jsonb(new) - array['effective_to','updated_at','updated_by'])
           = (to_jsonb(old) - array['effective_to','updated_at','updated_by']) then
      return new;
    end if;
    raise exception 'Approved or rejected salary records cannot be changed. Propose a new record.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger compensation_guard before update on public.employee_compensation
  for each row execute function private.compensation_guard();

create or replace function private.compensation_item_guard() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.employee_compensation c
             where c.id = coalesce(new.compensation_id, old.compensation_id) and c.status <> 'pending') then
    raise exception 'Items of an approved/rejected salary record cannot change.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger compensation_item_guard before insert or update or delete on public.employee_compensation_items
  for each row execute function private.compensation_item_guard();

-- Propose salary (also used by the application preparer for a new joiner).
create or replace function public.hr_propose_compensation(
  p_employee uuid, p_effective_from date, p_basic numeric, p_transport numeric, p_commission numeric,
  p_items jsonb default '[]'::jsonb, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; it jsonb;
begin
  if not (private.employee_has_permission('hr.compensation.create', p_employee) or private.is_open_draft_of_caller(p_employee)) then
    raise exception 'Not authorised to propose salary for this employee.' using errcode = '42501';
  end if;
  if p_effective_from is null then raise exception 'Effective date is required.' using errcode = '22023'; end if;
  if exists (select 1 from public.employee_compensation where employee_id = p_employee and status = 'pending') then
    raise exception 'This employee already has a pending salary proposal.' using errcode = 'P0001';
  end if;
  insert into public.employee_compensation (employee_id, effective_from, basic_salary, transport_allowance, commission, reason)
  values (p_employee, p_effective_from, p_basic, coalesce(p_transport, 0), coalesce(p_commission, 0),
          coalesce(nullif(trim(p_reason), ''), 'Initial salary'))
  returning id into v_id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.employee_compensation_items (compensation_id, type_id, amount)
    select v_id, t.id, (it ->> 'amount')::numeric
    from public.pay_component_types t where t.code = (it ->> 'code')::extensions.citext and t.status = 'active';
    if not found then raise exception 'Unknown allowance/deduction type %.', it ->> 'code' using errcode = '22023'; end if;
  end loop;
  return v_id;
end $$;

create or replace function public.hr_approve_compensation(p_compensation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.employee_compensation%rowtype;
begin
  select * into c from public.employee_compensation where id = p_compensation for update;
  if c.status is distinct from 'pending' then raise exception 'Only pending salary records can be approved.' using errcode = 'P0001'; end if;
  if not private.employee_has_permission('hr.compensation.approve', c.employee_id) then
    raise exception 'Not authorised to approve salary changes.' using errcode = '42501';
  end if;
  if c.created_by = auth.uid() then
    raise exception 'The person who proposed a salary change cannot approve it.' using errcode = '42501';
  end if;
  if (select status from public.employees where id = c.employee_id) = 'applicant' then
    raise exception 'A new joiner''s salary is approved together with the application.' using errcode = 'P0001';
  end if;
  update public.employee_compensation set effective_to = c.effective_from - 1
   where employee_id = c.employee_id and status = 'approved' and effective_to is null and effective_from < c.effective_from;
  if exists (select 1 from public.employee_compensation where employee_id = c.employee_id and status = 'approved'
             and daterange(effective_from, effective_to, '[]') && daterange(c.effective_from, null, '[]')) then
    raise exception 'An approved salary already exists on or after %. Back-dated changes need a correction record.', c.effective_from
      using errcode = 'P0001';
  end if;
  update public.employee_compensation set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_compensation;
end $$;

create or replace function public.hr_reject_compensation(p_compensation uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.employee_compensation%rowtype;
begin
  select * into c from public.employee_compensation where id = p_compensation for update;
  if c.status is distinct from 'pending' then raise exception 'Only pending salary records can be rejected.' using errcode = 'P0001'; end if;
  if not private.employee_has_permission('hr.compensation.reject', c.employee_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.employee_compensation set status = 'rejected', rejection_reason = p_reason where id = p_compensation;
end $$;

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.attendance_records (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  work_date   date not null,
  status      text not null check (status in ('present','late','half_day','absent','leave','holiday','weekly_off')),
  check_in    timestamptz,
  check_out   timestamptz,
  source      text not null default 'manual' check (source in ('manual','kiosk','import','leave')),
  note        text,
  created_at  timestamptz not null default now(), created_by uuid,
  updated_at  timestamptz not null default now(), updated_by uuid,
  unique (employee_id, work_date),
  constraint attendance_times check (check_out is null or check_in is null or check_out >= check_in)
);
create index attendance_date_idx on public.attendance_records (work_date);

-- ---------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------
create table public.leave_types (
  id            uuid primary key default gen_random_uuid(),
  code          extensions.citext not null unique,
  name          text not null,
  name_bn       text,
  is_paid       boolean not null default true,
  annual_quota  numeric(5,1) check (annual_quota is null or annual_quota >= 0),  -- null = no limit
  status        text not null default 'active' check (status in ('active','inactive')),
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
insert into public.leave_types (code, name, name_bn, is_paid, annual_quota) values
  ('casual','Casual leave','নৈমিত্তিক ছুটি', true, 10),
  ('sick','Sick leave','অসুস্থতাজনিত ছুটি', true, 14),
  ('annual','Earned / annual leave','অর্জিত ছুটি', true, null),
  ('unpaid','Leave without pay','বিনা বেতনে ছুটি', false, null);

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id),
  leave_type_id uuid not null references public.leave_types(id),
  from_date     date not null,
  to_date       date not null,
  days          integer generated always as (to_date - from_date + 1) stored,
  reason        text not null check (length(trim(reason)) > 0),
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid,
  constraint leave_dates check (to_date >= from_date),
  constraint leave_no_overlap exclude using gist (
    employee_id with =, daterange(from_date, to_date, '[]') with &&) where (status in ('pending','approved'))
);
create index leave_requests_emp_idx on public.leave_requests (employee_id, from_date desc);

-- ---------------------------------------------------------------------
-- Salary sheets
-- ---------------------------------------------------------------------
create table public.salary_sheets (
  id            uuid primary key default gen_random_uuid(),
  period_month  date not null check (extract(day from period_month) = 1),
  zone_id       uuid references public.zones(id),
  hub_id        uuid references public.hubs(id),
  status        text not null default 'draft' check (status in ('draft','submitted','approved','cancelled')),
  submitted_by  uuid, submitted_at timestamptz,
  approved_by   uuid, approved_at timestamptz,
  cancel_reason text,
  note          text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create unique index salary_sheets_one_per_period on public.salary_sheets
  (period_month, coalesce(hub_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status <> 'cancelled';

create table public.salary_sheet_lines (
  id                  uuid primary key default gen_random_uuid(),
  sheet_id            uuid not null references public.salary_sheets(id),
  employee_id         uuid not null references public.employees(id),
  compensation_id     uuid references public.employee_compensation(id),
  present_days        integer not null default 0,
  leave_days          integer not null default 0,
  absent_days         integer not null default 0,
  basic_salary        numeric(14,2) not null default 0 check (basic_salary >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  commission          numeric(14,2) not null default 0 check (commission >= 0),
  other_allowances    numeric(14,2) not null default 0 check (other_allowances >= 0),
  deductions          numeric(14,2) not null default 0 check (deductions >= 0),
  net_payable         numeric(14,2) generated always as
                      (basic_salary + transport_allowance + commission + other_allowances - deductions) stored,
  adjustment_note     text,
  issue               text,      -- e.g. 'No approved salary' — blocks submission
  created_at          timestamptz not null default now(), created_by uuid,
  updated_at          timestamptz not null default now(), updated_by uuid,
  unique (sheet_id, employee_id)
);

-- Lines: only commission / allowances / deductions may be adjusted, only in draft, with a note.
create or replace function private.salary_line_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.salary_sheets where id = coalesce(new.sheet_id, old.sheet_id);
  if v_status <> 'draft' then
    raise exception 'Salary sheet is % and locked.', v_status using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and private.is_api_user() then
    if (new.employee_id, new.compensation_id, new.basic_salary, new.transport_allowance,
        new.present_days, new.leave_days, new.absent_days, new.issue, new.sheet_id)
       is distinct from
       (old.employee_id, old.compensation_id, old.basic_salary, old.transport_allowance,
        old.present_days, old.leave_days, old.absent_days, old.issue, old.sheet_id) then
      raise exception 'Basic salary, transport and attendance come from approved records and cannot be edited on the sheet.'
        using errcode = '42501';
    end if;
    if (new.commission, new.other_allowances, new.deductions) is distinct from (old.commission, old.other_allowances, old.deductions)
       and coalesce(trim(new.adjustment_note), '') = '' then
      raise exception 'Explain the adjustment in the note.' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT' and private.is_api_user() then
    raise exception 'Lines are created by generating the sheet.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger salary_line_guard before insert or update on public.salary_sheet_lines
  for each row execute function private.salary_line_guard();

create or replace function private.salary_sheet_guard() returns trigger
language plpgsql as $$
begin
  if private.is_api_user() and (new.status, new.approved_by, new.submitted_by, new.period_month, new.hub_id)
     is distinct from (old.status, old.approved_by, old.submitted_by, old.period_month, old.hub_id) then
    raise exception 'Use the salary sheet workflow functions.' using errcode = '42501';
  end if;
  if old.status = 'approved' and to_jsonb(new) - array['updated_at','updated_by'] <> to_jsonb(old) - array['updated_at','updated_by'] then
    raise exception 'Approved salary sheets are locked.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger salary_sheet_guard before update on public.salary_sheets
  for each row execute function private.salary_sheet_guard();

-- Attendance in a month covered by a submitted/approved sheet is locked.
create or replace function private.attendance_rules(p_employee uuid, p_date date, p_is_insert boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees%rowtype;
begin
  select * into e from public.employees where id = p_employee;
  if exists (select 1 from public.salary_sheet_lines l join public.salary_sheets s on s.id = l.sheet_id
             where l.employee_id = p_employee and s.status in ('submitted','approved')
               and s.period_month = date_trunc('month', p_date)::date) then
    raise exception 'Attendance for this month is locked by a submitted/approved salary sheet.' using errcode = 'P0001';
  end if;
  if p_is_insert then
    if e.status <> 'active' then raise exception 'Attendance can only be recorded for active employees.' using errcode = 'P0001'; end if;
    if e.joining_date is not null and p_date < e.joining_date then
      raise exception 'Date is before the joining date.' using errcode = '22023';
    end if;
  end if;
end $$;

create or replace function private.attendance_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.attendance_rules(new.employee_id, new.work_date, tg_op = 'INSERT');
  if tg_op = 'UPDATE' and old.work_date <> new.work_date then
    perform private.attendance_rules(old.employee_id, old.work_date, false);
  end if;
  if new.work_date > current_date then raise exception 'Attendance cannot be recorded for a future date.' using errcode = '22023'; end if;
  if private.is_api_user() and (new.status = 'leave' or new.source = 'leave')
     and (tg_op = 'INSERT' or old.status <> 'leave' or old.source <> 'leave') then
    raise exception 'Leave days come from approved leave requests.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and private.is_api_user() and coalesce(trim(new.note), '') = '' then
    raise exception 'A correction note is required.' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger attendance_guard before insert or update on public.attendance_records
  for each row execute function private.attendance_guard();

create or replace function private.leave_request_guard() returns trigger
language plpgsql as $$
begin
  if private.is_api_user() then
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception 'Leave requests start as pending.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      raise exception 'Use the leave approval / cancellation functions.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger leave_request_guard before insert or update on public.leave_requests
  for each row execute function private.leave_request_guard();

-- Stamp / audit / no-delete
do $$
declare t text;
begin
  foreach t in array array['pay_component_types','employee_compensation','attendance_records','leave_types',
                           'leave_requests','salary_sheets','salary_sheet_lines'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t||'_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''hr'')', t||'_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t||'_no_delete', t);
  end loop;
end $$;
create trigger compensation_items_audit after insert or update or delete on public.employee_compensation_items
  for each row execute function private.audit_row('hr');

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.pay_component_types        enable row level security;
alter table public.employee_compensation      enable row level security;
alter table public.employee_compensation_items enable row level security;
alter table public.attendance_records         enable row level security;
alter table public.leave_types                enable row level security;
alter table public.leave_requests             enable row level security;
alter table public.salary_sheets              enable row level security;
alter table public.salary_sheet_lines         enable row level security;

revoke all on public.pay_component_types, public.employee_compensation, public.employee_compensation_items,
  public.attendance_records, public.leave_types, public.leave_requests, public.salary_sheets,
  public.salary_sheet_lines from anon;
revoke delete, truncate on public.pay_component_types, public.employee_compensation, public.attendance_records,
  public.leave_types, public.leave_requests, public.salary_sheets, public.salary_sheet_lines from authenticated;
revoke insert, update, delete on public.employee_compensation, public.employee_compensation_items, public.salary_sheets from authenticated;
revoke insert on public.salary_sheet_lines from authenticated;

create policy pct_read on public.pay_component_types for select to authenticated using (exists (select 1 from private.my_grants()));
create policy pct_insert on public.pay_component_types for insert to authenticated with check (private.has_permission('hr.compensation.configure'));
create policy pct_update on public.pay_component_types for update to authenticated
  using (private.has_permission('hr.compensation.configure')) with check (private.has_permission('hr.compensation.configure'));

create policy comp_read on public.employee_compensation for select to authenticated
  using (private.employee_has_permission('hr.compensation.view', employee_id)
         or private.is_self_employee(employee_id) or private.is_open_draft_of_caller(employee_id));
create policy comp_items_read on public.employee_compensation_items for select to authenticated
  using (exists (select 1 from public.employee_compensation c where c.id = compensation_id));

create policy att_read on public.attendance_records for select to authenticated
  using (private.employee_has_permission('hr.attendance.view', employee_id) or private.is_self_employee(employee_id));
create policy att_insert on public.attendance_records for insert to authenticated
  with check (private.employee_has_permission('hr.attendance.create', employee_id));
create policy att_update on public.attendance_records for update to authenticated
  using (private.employee_has_permission('hr.attendance.edit', employee_id))
  with check (private.employee_has_permission('hr.attendance.edit', employee_id));

create policy lt_read on public.leave_types for select to authenticated using (exists (select 1 from private.my_grants()));
create policy lt_insert on public.leave_types for insert to authenticated with check (private.has_permission('hr.leave.configure'));
create policy lt_update on public.leave_types for update to authenticated
  using (private.has_permission('hr.leave.configure')) with check (private.has_permission('hr.leave.configure'));

create policy lr_read on public.leave_requests for select to authenticated
  using (private.employee_has_permission('hr.leave.view', employee_id) or private.is_self_employee(employee_id));
create policy lr_insert on public.leave_requests for insert to authenticated
  with check (private.is_self_employee(employee_id) or private.employee_has_permission('hr.leave.create', employee_id));

create or replace function private.salary_sheet_status(p_sheet uuid) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.salary_sheets where id = p_sheet
$$;

create policy sheets_read on public.salary_sheets for select to authenticated
  using (private.has_permission('hr.salary_sheet.view', zone_id, hub_id));
create policy lines_read on public.salary_sheet_lines for select to authenticated
  using (exists (select 1 from public.salary_sheets s where s.id = sheet_id
                 and private.has_permission('hr.salary_sheet.view', s.zone_id, s.hub_id))
         or (private.is_self_employee(employee_id) and private.salary_sheet_status(sheet_id) = 'approved'));
create policy lines_update on public.salary_sheet_lines for update to authenticated
  using (exists (select 1 from public.salary_sheets s where s.id = sheet_id and s.status = 'draft'
                 and private.has_permission('hr.salary_sheet.create', s.zone_id, s.hub_id)))
  with check (exists (select 1 from public.salary_sheets s where s.id = sheet_id and s.status = 'draft'
                 and private.has_permission('hr.salary_sheet.create', s.zone_id, s.hub_id)));

-- ---------------------------------------------------------------------
-- Leave workflow
-- ---------------------------------------------------------------------
create or replace function public.hr_decide_leave(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests%rowtype;
  t public.leave_types%rowtype;
  v_used numeric;
  d date;
  v_existing text;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.status is distinct from 'pending' then raise exception 'Only pending requests can be decided.' using errcode = 'P0001'; end if;
  if not private.employee_has_permission(case when p_approve then 'hr.leave.approve' else 'hr.leave.reject' end, r.employee_id) then
    raise exception 'Not authorised to decide this leave request.' using errcode = '42501';
  end if;
  if private.is_self_employee(r.employee_id) or r.created_by = auth.uid() then
    raise exception 'You cannot decide your own leave request or one you filed.' using errcode = '42501';
  end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'A reason is required to reject.' using errcode = '22023'; end if;
    update public.leave_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
    return;
  end if;

  select * into t from public.leave_types where id = r.leave_type_id;
  if t.annual_quota is not null then
    select coalesce(sum(days), 0) into v_used from public.leave_requests
     where employee_id = r.employee_id and leave_type_id = r.leave_type_id and status = 'approved'
       and extract(year from from_date) = extract(year from r.from_date);
    if v_used + r.days > t.annual_quota then
      raise exception '% would exceed the yearly quota (% used of %).', t.name, v_used, t.annual_quota using errcode = 'P0001';
    end if;
  end if;

  for d in select generate_series(r.from_date, r.to_date, interval '1 day')::date loop
    select status into v_existing from public.attendance_records where employee_id = r.employee_id and work_date = d;
    if v_existing in ('present','late','half_day') then
      raise exception 'Attendance on % is already marked %. Correct it first.', d, v_existing using errcode = 'P0001';
    end if;
    if d <= current_date then
      insert into public.attendance_records (employee_id, work_date, status, source, note)
      values (r.employee_id, d, 'leave', 'leave', 'Approved leave')
      on conflict (employee_id, work_date) do update set status = 'leave', source = 'leave', note = 'Approved leave';
    end if;
  end loop;
  update public.leave_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
end $$;

create or replace function public.hr_cancel_leave(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests%rowtype;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.status <> 'pending' then
    raise exception 'Only pending requests can be cancelled. Ask HR to correct approved leave.' using errcode = 'P0001';
  end if;
  if not (r.created_by = auth.uid() or private.is_self_employee(r.employee_id)) then
    raise exception 'Only the requester can cancel.' using errcode = '42501';
  end if;
  update public.leave_requests set status = 'cancelled', decision_note = p_reason where id = p_request;
end $$;

create or replace function public.hr_leave_balance(p_employee uuid, p_year integer)
returns table (leave_type text, quota numeric, used numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select t.name, t.annual_quota,
    coalesce(sum(r.days) filter (where r.status = 'approved'), 0),
    coalesce(sum(r.days) filter (where r.status = 'pending'), 0),
    case when t.annual_quota is null then null
         else t.annual_quota - coalesce(sum(r.days) filter (where r.status = 'approved'), 0) end
  from public.leave_types t
  left join public.leave_requests r on r.leave_type_id = t.id and r.employee_id = p_employee
       and extract(year from r.from_date) = p_year
  where t.status = 'active'
    and (private.employee_has_permission('hr.leave.view', p_employee) or private.is_self_employee(p_employee))
  group by t.id, t.name, t.annual_quota order by t.name
$$;

-- Monthly attendance summary (report).
create or replace function public.hr_attendance_summary(p_month date, p_hub uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, present integer, late integer,
               half_day integer, absent integer, leave integer, holiday integer, weekly_off integer, not_recorded integer)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name,
    count(*) filter (where a.status = 'present')::int, count(*) filter (where a.status = 'late')::int,
    count(*) filter (where a.status = 'half_day')::int, count(*) filter (where a.status = 'absent')::int,
    count(*) filter (where a.status = 'leave')::int, count(*) filter (where a.status = 'holiday')::int,
    count(*) filter (where a.status = 'weekly_off')::int,
    (least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, current_date)
       - greatest(date_trunc('month', p_month)::date, coalesce(e.joining_date, date_trunc('month', p_month)::date)) + 1
       - count(a.id))::int
  from public.employees e
  left join public.attendance_records a on a.employee_id = e.id
       and a.work_date >= date_trunc('month', p_month)::date
       and a.work_date < (date_trunc('month', p_month) + interval '1 month')::date
  where e.status = 'active' and (p_hub is null or e.hub_id = p_hub)
  group by e.id, e.employee_code, e.full_name, e.joining_date
  order by e.full_name
$$;

-- ---------------------------------------------------------------------
-- Salary sheet workflow
-- ---------------------------------------------------------------------
create or replace function public.hr_generate_salary_sheet(p_month date, p_hub uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_zone uuid;
  v_sheet uuid;
begin
  select zone_id into v_zone from public.hubs where id = p_hub;
  if not private.has_permission('hr.salary_sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised to prepare salary sheets for this hub.' using errcode = '42501';
  end if;
  if v_month > date_trunc('month', current_date)::date then
    raise exception 'Cannot prepare a sheet for a future month.' using errcode = '22023';
  end if;
  insert into public.salary_sheets (period_month, zone_id, hub_id) values (v_month, v_zone, p_hub) returning id into v_sheet;

  insert into public.salary_sheet_lines
    (sheet_id, employee_id, compensation_id, present_days, leave_days, absent_days,
     basic_salary, transport_allowance, commission, other_allowances, deductions, issue)
  select v_sheet, e.id, c.id,
    (select count(*) from public.attendance_records a where a.employee_id = e.id and a.work_date between v_month and v_end and a.status in ('present','late','half_day')),
    (select count(*) from public.attendance_records a where a.employee_id = e.id and a.work_date between v_month and v_end and a.status = 'leave'),
    (select count(*) from public.attendance_records a where a.employee_id = e.id and a.work_date between v_month and v_end and a.status = 'absent'),
    coalesce(c.basic_salary, 0), coalesce(c.transport_allowance, 0), coalesce(c.commission, 0),
    coalesce((select sum(i.amount) from public.employee_compensation_items i join public.pay_component_types t on t.id = i.type_id
              where i.compensation_id = c.id and t.kind = 'allowance'), 0),
    coalesce((select sum(i.amount) from public.employee_compensation_items i join public.pay_component_types t on t.id = i.type_id
              where i.compensation_id = c.id and t.kind = 'deduction'), 0),
    case when c.id is null then 'No approved salary for this month' end
  from public.employees e
  left join lateral (select * from public.employee_compensation x
                     where x.employee_id = e.id and x.status = 'approved'
                       and x.effective_from <= v_end and (x.effective_to is null or x.effective_to >= v_end)
                     order by x.effective_from desc limit 1) c on true
  where e.hub_id = p_hub and e.status = 'active' and e.archived_at is null
    and (e.joining_date is null or e.joining_date <= v_end);
  return v_sheet;
end $$;

create or replace function public.hr_submit_salary_sheet(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.salary_sheets%rowtype; v_bad int;
begin
  select * into s from public.salary_sheets where id = p_sheet for update;
  if s.status <> 'draft' then raise exception 'Only draft sheets can be submitted.' using errcode = 'P0001'; end if;
  if not private.has_permission('hr.salary_sheet.create', s.zone_id, s.hub_id) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select count(*) into v_bad from public.salary_sheet_lines where sheet_id = p_sheet and (issue is not null or net_payable < 0);
  if v_bad > 0 then
    raise exception '% line(s) have problems (missing approved salary or negative net payable). Fix them first.', v_bad
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.salary_sheet_lines where sheet_id = p_sheet) then
    raise exception 'The sheet has no lines.' using errcode = '23514';
  end if;
  update public.salary_sheets set status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where id = p_sheet;
end $$;

create or replace function public.hr_approve_salary_sheet(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.salary_sheets%rowtype;
begin
  select * into s from public.salary_sheets where id = p_sheet for update;
  if s.status <> 'submitted' then raise exception 'Only submitted sheets can be approved.' using errcode = 'P0001'; end if;
  if not private.has_permission('hr.salary_sheet.approve', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to approve salary sheets.' using errcode = '42501';
  end if;
  if auth.uid() in (s.created_by, s.submitted_by) then
    raise exception 'The preparer of a salary sheet cannot approve it.' using errcode = '42501';
  end if;
  update public.salary_sheets set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_sheet;
end $$;

create or replace function public.hr_cancel_salary_sheet(p_sheet uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.salary_sheets%rowtype;
begin
  select * into s from public.salary_sheets where id = p_sheet for update;
  if s.status not in ('draft','submitted') then raise exception 'Approved sheets cannot be cancelled; use a correction in Accounts.' using errcode = 'P0001'; end if;
  if not private.has_permission('hr.salary_sheet.approve', s.zone_id, s.hub_id) then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.salary_sheets set status = 'cancelled', cancel_reason = p_reason where id = p_sheet;
end $$;

revoke all on function public.hr_propose_compensation(uuid, date, numeric, numeric, numeric, jsonb, text),
  public.hr_approve_compensation(uuid), public.hr_reject_compensation(uuid, text),
  public.hr_decide_leave(uuid, boolean, text), public.hr_cancel_leave(uuid, text), public.hr_leave_balance(uuid, integer),
  public.hr_attendance_summary(date, uuid), public.hr_generate_salary_sheet(date, uuid),
  public.hr_submit_salary_sheet(uuid), public.hr_approve_salary_sheet(uuid), public.hr_cancel_salary_sheet(uuid, text)
  from public, anon;
grant execute on function public.hr_propose_compensation(uuid, date, numeric, numeric, numeric, jsonb, text),
  public.hr_approve_compensation(uuid), public.hr_reject_compensation(uuid, text),
  public.hr_decide_leave(uuid, boolean, text), public.hr_cancel_leave(uuid, text), public.hr_leave_balance(uuid, integer),
  public.hr_attendance_summary(date, uuid), public.hr_generate_salary_sheet(date, uuid),
  public.hr_submit_salary_sheet(uuid), public.hr_approve_salary_sheet(uuid), public.hr_cancel_salary_sheet(uuid, text)
  to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
