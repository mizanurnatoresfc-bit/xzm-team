-- =====================================================================
-- XZM-TEAM ERP — Migration 0025: the day's sheet, made easier to keep
--
--  * A payment needs nothing but its ID and the amount. 101001 and SFC-101001
--    are the same payment; both are kept as SFC-101001. Nothing has to match a
--    record in this database — a payment is written the way an expense is.
--  * The same rider may have more than one line in a day.
--  * Everyone who writes on a sheet appears on it. Each closes their own part,
--    the sheet shows who is left, and the day is closed with the three totals.
--  * A cash note: who handed money over, how much, by which wallet — and the
--    person who handed it sees it on their own page.
--  * A bill taken in from a person's page carries the sheet's date.
--  * Riders and expenses that are on every sheet are put there when it starts.
--  * Every one of these is a setting, so the Super Admin can change it later.
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('da.payment_id_prefix', '"SFC-"',
   'Daily accounts: what a plain payment number is prefixed with (101001 becomes SFC-101001)'),
  ('da.double_rider_lines', 'true',
   'Daily accounts: a rider may have more than one line on the same sheet'),
  ('da.claim_date_source', '"sheet"',
   'Daily accounts: a bill taken in shows the sheet''s date (sheet) or the date on the bill (bill)'),
  ('da.close_needs_all', 'false',
   'Daily accounts: everyone writing on the sheet must close their own part before the day can be closed'),
  ('da.fixed_riders', '[]',
   'Daily accounts: Employee IDs put on every new sheet'),
  ('da.fixed_expenses', '[]',
   'Daily accounts: expenses put on every new sheet — name, category, kind and amount'),
  ('da.note_methods', '["cash","bkash","nagad","rocket","bank","other"]',
   'Daily accounts: how money can come in on a cash note')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. A payment ID is written one way, however it is typed
-- ---------------------------------------------------------------------
create or replace function private.da_payment_ref(p_ref text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text := upper(trim(coalesce(p_ref, ''))); v_pre text;
begin
  if v = '' then return null; end if;
  v := regexp_replace(v, '\s+', '', 'g');
  v_pre := upper(coalesce(private.setting_text('da.payment_id_prefix'), ''));
  if v_pre = '' then return v; end if;
  if v ~ ('^' || regexp_replace(v_pre, '([^a-zA-Z0-9])', '\\\1', 'g')) then return v; end if;
  if v ~ '^[0-9]+$' then return v_pre || v; end if;
  return v;
end $$;

-- A payment: the ID and the amount are enough. The merchant is filled in when
-- this hub happens to have a record for that ID, and left alone when it does not.
create or replace function public.da_save_merchant_payment(
  p_session uuid, p_merchant uuid, p_payment_ref text, p_transaction_id text, p_amount numeric, p_payment_date date,
  p_screenshot_path text default null, p_ocr jsonb default null, p_ocr_verified boolean default false,
  p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s  public.da_sessions := private.da_require_edit(p_session);
  m  public.merchants;
  mp public.merchant_payments;
  v_ref text := private.da_payment_ref(p_payment_ref);
  v_payee text := nullif(trim(p_ocr ->> 'payee'), '');
  v_match text := 'unmatched';
  v_date date := p_payment_date;
  v_name text;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be greater than zero.' using errcode = '22023';
  end if;
  if v_ref is null and p_merchant is null and v_payee is null then
    raise exception 'Write the Payment ID, or say who took the cash.' using errcode = '22023';
  end if;

  if v_ref is not null then
    select * into mp from public.merchant_payments
     where hub_id = s.hub_id and upper(payment_no) = v_ref;
  end if;
  if p_merchant is not null then
    select * into m from public.merchants where id = p_merchant and archived_at is null;
    if m.id is null or m.hub_id <> s.hub_id then
      raise exception 'Choose a merchant of this hub.' using errcode = '22023';
    end if;
  elsif mp.id is not null then
    select * into m from public.merchants where id = mp.merchant_id;
  end if;

  v_date := coalesce(v_date, mp.payment_date, s.account_date);
  if v_date > private.da_today() then
    raise exception 'Payment date cannot be in the future.' using errcode = '22023';
  end if;
  v_name := coalesce(m.name, v_payee, v_ref, '—');

  if p_transaction_id is not null and exists (select 1 from public.da_merchant_payments
       where lower(transaction_id) = lower(trim(p_transaction_id)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Transaction ID % is already recorded.', p_transaction_id using errcode = '23505';
  end if;
  if v_ref is not null and exists (select 1 from public.da_merchant_payments
       where payment_ref = v_ref and session_id = s.id and removed_at is null and id is distinct from p_line) then
    raise exception 'Payment % is already on this sheet.', v_ref using errcode = '23505';
  end if;
  if mp.id is not null and m.id is not null then
    v_match := case when mp.merchant_id = m.id and mp.amount = p_amount then 'matched' else 'mismatch' end;
  end if;

  if p_line is null then
    insert into public.da_merchant_payments (session_id, hub_id, zone_id, merchant_id, merchant_name, payee_name,
      payment_ref, transaction_id, amount, payment_date, screenshot_path, ocr, ocr_verified, verified_by,
      match_status, matched_payment_id, remarks)
    values (s.id, s.hub_id, s.zone_id, m.id, v_name, v_payee, v_ref, nullif(trim(p_transaction_id), ''),
      p_amount, v_date, p_screenshot_path, p_ocr, coalesce(p_ocr_verified, false),
      case when p_ocr_verified then auth.uid() end, v_match, mp.id, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_merchant_payments set merchant_id = m.id, merchant_name = v_name,
      payee_name = coalesce(v_payee, payee_name), payment_ref = v_ref,
      transaction_id = nullif(trim(p_transaction_id), ''), amount = p_amount, payment_date = v_date,
      screenshot_path = coalesce(p_screenshot_path, screenshot_path), ocr = coalesce(p_ocr, ocr),
      ocr_verified = coalesce(p_ocr_verified, false), verified_by = case when p_ocr_verified then auth.uid() end,
      match_status = v_match, matched_payment_id = mp.id, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. More than one line for the same rider, when the setting allows it
-- ---------------------------------------------------------------------
drop index if exists public.da_rider_lines_one_per_rider;
create index if not exists da_rider_lines_rider_idx on public.da_rider_lines (session_id, employee_id) where removed_at is null;

create or replace function public.da_save_rider_line(
  p_session uuid, p_employee_code text,
  p_delivery integer default 0, p_pickup integer default 0, p_amount numeric default 0,
  p_paid numeric default 0, p_due numeric default 0, p_mobile_banking numeric default 0,
  p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s   public.da_sessions := private.da_require_edit(p_session);
  v_e uuid := private.da_find_employee(p_employee_code);
  e   public.employees;
  v_id uuid;
begin
  if v_e is null then raise exception 'Employee ID % was not found.', p_employee_code using errcode = '22023'; end if;
  select * into e from public.employees where id = v_e;
  if not private.da_employee_ok(v_e, s.hub_id) then
    raise exception 'Employee % is not an active member or rider of this hub.', p_employee_code using errcode = '22023';
  end if;
  if coalesce(p_delivery, 0) < 0 or coalesce(p_pickup, 0) < 0 or coalesce(p_amount, 0) < 0
     or coalesce(p_paid, 0) < 0 or coalesce(p_mobile_banking, 0) < 0 then
    raise exception 'Quantities and amounts cannot be negative.' using errcode = '22023';
  end if;
  if p_line is null then
    if coalesce(private.setting_text('da.double_rider_lines'), 'true') <> 'true'
       and exists (select 1 from public.da_rider_lines where session_id = s.id and employee_id = v_e and removed_at is null) then
      raise exception 'This rider is already on the sheet. Edit the existing line.' using errcode = '23505';
    end if;
    insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, employee_code, rider_name, mobile,
      delivery_qty, pickup_qty, amount, paid_amount, due_input, due, mobile_banking, remarks)
    values (s.id, s.hub_id, s.zone_id, v_e, e.employee_code::text, e.full_name, e.mobile,
      coalesce(p_delivery, 0), coalesce(p_pickup, 0), coalesce(p_amount, 0), coalesce(p_paid, 0), coalesce(p_due, 0),
      private.da_due(p_amount, p_paid, p_due, p_mobile_banking), coalesce(p_mobile_banking, 0), nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_rider_lines set
      employee_id = v_e, employee_code = e.employee_code::text, rider_name = e.full_name, mobile = e.mobile,
      delivery_qty = coalesce(p_delivery, 0), pickup_qty = coalesce(p_pickup, 0), amount = coalesce(p_amount, 0),
      paid_amount = coalesce(p_paid, 0), due_input = coalesce(p_due, 0),
      due = private.da_due(p_amount, p_paid, p_due, p_mobile_banking), mobile_banking = coalesce(p_mobile_banking, 0),
      remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null
    returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Who is writing on this sheet, who has finished, and closing the day
-- ---------------------------------------------------------------------
create table public.da_sheet_collectors (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.da_sessions(id),
  user_id     uuid not null,
  employee_id uuid references public.employees(id),
  name        text,
  code        text,
  closed_at   timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(), updated_by uuid,
  unique (session_id, user_id)
);
create index da_collectors_session_idx on public.da_sheet_collectors (session_id);

alter table public.da_sessions add column if not exists closed_at timestamptz;
alter table public.da_sessions add column if not exists closed_by uuid;
alter table public.da_sessions add column if not exists closed_totals jsonb;

alter table public.da_sheet_collectors enable row level security;
revoke all on public.da_sheet_collectors from anon;
grant select on public.da_sheet_collectors to authenticated;
create policy da_collectors_read on public.da_sheet_collectors for select to authenticated
  using (user_id = auth.uid()
      or exists (select 1 from public.da_sessions s where s.id = session_id
                  and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)));

-- Writing any line puts you on the sheet's list of people keeping it.
create or replace function private.da_note_collector() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  if auth.uid() is null then return new; end if;
  select * into s from public.da_sessions where id = new.session_id;
  if s.id is null then return new; end if;
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code)
  values (new.session_id, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code())
  on conflict (session_id, user_id) do update set updated_at = now(), closed_at = null;
  return new;
end $$;

create trigger da_rider_collector after insert on public.da_rider_lines
  for each row execute function private.da_note_collector();
create trigger da_payment_collector after insert on public.da_merchant_payments
  for each row execute function private.da_note_collector();
create trigger da_expense_collector after insert on public.da_expenses
  for each row execute function private.da_note_collector();

-- "My part is done" / taking it back
create or replace function public.da_close_my_part(p_session uuid, p_note text default null, p_done boolean default true)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session);
begin
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code, closed_at, note)
  values (s.id, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code(),
          case when p_done then now() end, nullif(trim(p_note), ''))
  on conflict (session_id, user_id) do update
     set closed_at = case when p_done then now() end, note = nullif(trim(p_note), ''), updated_at = now();
  perform private.da_event(s.id, 'note',
    case when p_done then 'Part closed by ' else 'Part reopened by ' end || coalesce(private.da_my_name(), 'someone'), false);
end $$;

drop function if exists public.da_collectors(uuid);
create or replace function public.da_collectors(p_session uuid)
returns table (user_id uuid, name text, code text, closed_at timestamptz, note text, created_at timestamptz,
               riders integer, payments integer, expenses integer, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select c.user_id, c.name, c.code, c.closed_at, c.note, c.created_at,
         (select count(*)::int from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null),
         (select count(*)::int from public.da_merchant_payments m where m.session_id = c.session_id and m.created_by = c.user_id and m.removed_at is null),
         (select count(*)::int from public.da_expenses x where x.session_id = c.session_id and x.created_by = c.user_id and x.removed_at is null),
         coalesce((select sum(r.amount) from public.da_rider_lines r where r.session_id = c.session_id and r.created_by = c.user_id and r.removed_at is null), 0)
  from public.da_sheet_collectors c
  where c.session_id = p_session
  order by c.closed_at nulls first, c.created_at
$$;

-- Closing the day: the three totals are kept with the sheet.
create or replace function public.da_close_day(p_session uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_open int;
  v_tot jsonb;
begin
  if coalesce(private.setting_text('da.close_needs_all'), 'false') = 'true' then
    select count(*) into v_open from public.da_sheet_collectors
     where session_id = s.id and closed_at is null and user_id <> auth.uid();
    if v_open > 0 then
      raise exception '% of the people keeping this sheet have not closed their part yet.', v_open using errcode = '22023';
    end if;
  end if;
  select jsonb_build_object(
    'riders', (select count(*) from public.da_rider_lines where session_id = s.id and removed_at is null),
    'rider_amount', coalesce((select sum(amount) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'collected', coalesce((select sum(paid_amount) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'due', coalesce((select sum(due) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'mobile_banking', coalesce((select sum(mobile_banking) from public.da_rider_lines where session_id = s.id and removed_at is null), 0),
    'payments', (select count(*) from public.da_merchant_payments where session_id = s.id and removed_at is null),
    'payment_amount', coalesce((select sum(amount) from public.da_merchant_payments where session_id = s.id and removed_at is null), 0),
    'expenses', (select count(*) from public.da_expenses where session_id = s.id and removed_at is null),
    'expense_amount', coalesce((select sum(amount) from public.da_expenses where session_id = s.id and removed_at is null), 0),
    'notes_in', coalesce((select sum(amount) from public.da_cash_notes where session_id = s.id and removed_at is null), 0))
    into v_tot;
  update public.da_sessions set closed_at = now(), closed_by = auth.uid(), closed_totals = v_tot where id = s.id;
  perform private.da_event(s.id, 'note', coalesce(nullif(trim(p_note), ''), 'Day closed'), true);
  return v_tot;
end $$;

create or replace function public.da_reopen_day(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session);
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_sessions set closed_at = null, closed_by = null where id = s.id;
  perform private.da_event(s.id, 'note', 'Day reopened: ' || trim(p_reason), false);
end $$;

-- ---------------------------------------------------------------------
-- 4. Cash notes: who handed money over, and how
-- ---------------------------------------------------------------------
create table public.da_cash_notes (
  id             uuid primary key default gen_random_uuid(),
  no             bigint generated always as identity unique,
  session_id     uuid not null references public.da_sessions(id),
  hub_id         uuid not null references public.hubs(id),
  zone_id        uuid not null references public.zones(id),
  from_employee  uuid references public.employees(id),
  from_name      text,
  from_code      text,
  amount         numeric(14,2) not null default 0 check (amount >= 0),
  method         text not null default 'cash',
  note           text,
  removed_at     timestamptz, removed_by uuid, remove_reason text,
  created_at     timestamptz not null default now(), created_by uuid,
  updated_at     timestamptz not null default now(), updated_by uuid
);
create index da_cash_notes_session_idx on public.da_cash_notes (session_id) where removed_at is null;
create index da_cash_notes_from_idx on public.da_cash_notes (from_employee) where removed_at is null;

create trigger da_cash_notes_stamp before insert or update on public.da_cash_notes
  for each row execute function private.stamp_row();
create trigger da_cash_notes_audit after insert or update or delete on public.da_cash_notes
  for each row execute function private.audit_row('da');
create trigger da_cash_notes_no_delete before delete on public.da_cash_notes
  for each row execute function private.prevent_delete();

alter table public.da_cash_notes enable row level security;
revoke all on public.da_cash_notes from anon;
grant select on public.da_cash_notes to authenticated;
-- The person who wrote it, the person the money came from, and the hub's accounts people.
create policy da_cash_notes_read on public.da_cash_notes for select to authenticated
  using (created_by = auth.uid() or from_employee = private.my_employee_id()
      or private.has_permission('da.sheet.view', zone_id, hub_id));

create or replace function public.da_note_save(
  p_session uuid, p_amount numeric, p_method text default 'cash', p_from_code text default null,
  p_from_name text default null, p_note text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_e uuid; e public.employees; v_id uuid;
begin
  if p_amount is null or p_amount < 0 then raise exception 'The amount cannot be less than zero.' using errcode = '22023'; end if;
  if not (private.da_setting('da.note_methods') ? coalesce(p_method, 'cash')) then
    raise exception 'Unknown way of handing money over: %.', p_method using errcode = '22023';
  end if;
  if nullif(trim(p_from_code), '') is not null then
    v_e := private.da_find_employee(p_from_code);
    if v_e is null then raise exception 'Employee ID % was not found.', p_from_code using errcode = '22023'; end if;
    select * into e from public.employees where id = v_e;
  end if;
  if v_e is null and nullif(trim(p_from_name), '') is null and nullif(trim(p_note), '') is null then
    raise exception 'Write whose money it is, or a note.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.da_cash_notes (session_id, hub_id, zone_id, from_employee, from_name, from_code, amount, method, note)
    values (s.id, s.hub_id, s.zone_id, v_e, coalesce(e.full_name, nullif(trim(p_from_name), '')), e.employee_code::text,
            coalesce(p_amount, 0), coalesce(p_method, 'cash'), nullif(trim(p_note), ''))
    returning id into v_id;
  else
    update public.da_cash_notes set from_employee = v_e, from_name = coalesce(e.full_name, nullif(trim(p_from_name), '')),
           from_code = e.employee_code::text, amount = coalesce(p_amount, 0), method = coalesce(p_method, 'cash'),
           note = nullif(trim(p_note), '')
     where id = p_id and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Note not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.da_note_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.da_cash_notes;
begin
  select * into n from public.da_cash_notes where id = p_id and removed_at is null;
  if n.id is null then raise exception 'Note not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(n.session_id);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_cash_notes set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
end $$;

-- What the staff member sees on their own page: money they handed over.
create or replace function public.da_my_handovers(p_days integer default 30)
returns table (id uuid, account_date date, hub_name text, amount numeric, method text, note text,
               taken_by text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, s.account_date, h.name, n.amount, n.method, n.note,
         coalesce(p.full_name, p.email::text), n.created_at
  from public.da_cash_notes n
  join public.da_sessions s on s.id = n.session_id
  join public.hubs h on h.id = n.hub_id
  left join public.profiles p on p.id = n.created_by
  where n.removed_at is null and n.from_employee = private.my_employee_id()
    and s.account_date >= current_date - greatest(coalesce(p_days, 30), 1)
  order by s.account_date desc, n.created_at desc
$$;

-- ---------------------------------------------------------------------
-- 5. A bill taken in carries the sheet's date
-- ---------------------------------------------------------------------
drop function if exists public.da_my_claims(integer);
create or replace function public.da_my_claims(p_days integer default 90)
returns table (id uuid, no bigint, kind text, expense_name text, category text, amount numeric,
               bill_date date, bill_no text, reference_no text, reference_name text, reference_phone text,
               reference_position text, vehicle_id uuid, attachment_path text, remarks text,
               status text, review_note text, reviewed_at timestamptz,
               account_date date, shown_date date, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.no, c.kind, c.expense_name, c.category, c.amount, c.bill_date, c.bill_no, c.reference_no,
         c.reference_name, c.reference_phone, c.reference_position, c.vehicle_id, c.attachment_path, c.remarks,
         c.status, c.review_note, c.reviewed_at, s.account_date,
         case when c.status = 'added' and coalesce(private.setting_text('da.claim_date_source'), 'sheet') = 'sheet'
              then coalesce(s.account_date, c.bill_date) else c.bill_date end,
         c.created_at
  from public.da_expense_claims c
  left join public.da_sessions s on s.id = c.session_id
  where c.employee_id = private.my_employee_id()
    and c.bill_date >= current_date - greatest(coalesce(p_days, 90), 1)
  order by c.created_at desc
$$;

-- Taking a bill in puts the sheet's date on the expense line, when that is the rule.
create or replace function public.da_claim_add(p_claim uuid, p_session uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.da_expense_claims;
  s public.da_sessions := private.da_require_edit(p_session);
  v_expense uuid;
  v_date date;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if c.hub_id <> s.hub_id then raise exception 'This claim belongs to another hub.' using errcode = '22023'; end if;
  v_date := case when coalesce(private.setting_text('da.claim_date_source'), 'sheet') = 'sheet'
                 then s.account_date else c.bill_date end;

  insert into public.da_expenses (session_id, hub_id, zone_id, kind, employee_id, employee_code, employee_name,
    expense_name, category, amount, bill_date, bill_no, reference_no, reference_name, reference_phone,
    reference_position, vehicle_id, remarks, claim_id, claim_file)
  values (s.id, s.hub_id, s.zone_id, c.kind, c.employee_id, c.employee_code, c.employee_name,
    c.expense_name, c.category, c.amount, v_date, c.bill_no, c.reference_no, c.reference_name,
    c.reference_phone, c.reference_position, c.vehicle_id,
    nullif(trim(coalesce(c.remarks, '')
      || case when v_date <> c.bill_date then ' · বিলের তারিখ ' || to_char(c.bill_date, 'DD/MM/YYYY') else '' end
      || case when p_note is not null then ' · ' || trim(p_note) else '' end), ''),
    c.id, c.attachment_path)
  returning id into v_expense;

  update public.da_expense_claims
     set status = 'added', session_id = s.id, expense_id = v_expense,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_claim;
  perform private.da_event(s.id, 'note',
    'Claim ' || c.no::text || ' taken in: ' || c.expense_name || ' (' || c.employee_name || ')', false);
  return v_expense;
end $$;

-- ---------------------------------------------------------------------
-- 6. Riders and expenses that are on every sheet
-- ---------------------------------------------------------------------
create or replace function public.da_apply_fixed(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  r jsonb; v_e uuid; e public.employees;
  v_riders int := 0; v_expenses int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(private.da_setting('da.fixed_riders'), '[]')) loop
    v_e := private.da_find_employee(r #>> '{}');
    continue when v_e is null or not private.da_employee_ok(v_e, s.hub_id);
    continue when exists (select 1 from public.da_rider_lines where session_id = s.id and employee_id = v_e and removed_at is null);
    select * into e from public.employees where id = v_e;
    insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, employee_code, rider_name, mobile)
    values (s.id, s.hub_id, s.zone_id, v_e, e.employee_code::text, e.full_name, e.mobile);
    v_riders := v_riders + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(private.da_setting('da.fixed_expenses'), '[]')) loop
    continue when coalesce(trim(r ->> 'name'), '') = '';
    continue when exists (select 1 from public.da_expenses x where x.session_id = s.id and x.removed_at is null
                            and lower(x.expense_name) = lower(trim(r ->> 'name')));
    insert into public.da_expenses (session_id, hub_id, zone_id, kind, expense_name, category, amount, bill_date, remarks)
    values (s.id, s.hub_id, s.zone_id, coalesce(nullif(r ->> 'kind', ''), 'transport'), trim(r ->> 'name'),
            coalesce(nullif(r ->> 'category', ''), 'other'), coalesce((r ->> 'amount')::numeric, 0),
            s.account_date, 'প্রতিদিনের খরচ');
    v_expenses := v_expenses + 1;
  end loop;
  return jsonb_build_object('riders', v_riders, 'expenses', v_expenses);
end $$;

-- A new sheet starts with those lines already on it.
create or replace function public.da_start_session(p_hub uuid, p_date date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone  uuid := private.hub_zone(p_hub);
  v_today date := private.da_today();
  v_date  date := coalesce(p_date, private.da_today());
  v_start text := coalesce(private.setting_text('da.start_time'), '00:00');
  v_id    uuid;
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised to start daily accounts for this hub.' using errcode = '42501';
  end if;
  if exists (select 1 from public.hubs where id = p_hub and (status <> 'active' or archived_at is not null)) then
    raise exception 'This hub is not active.' using errcode = '22023';
  end if;
  if v_date > v_today or v_date < v_today - coalesce(private.setting_text('da.backdate_days')::integer, 3) then
    raise exception 'The date is outside the allowed period.' using errcode = '22023';
  end if;
  if v_date = v_today and (now() at time zone coalesce(private.setting_text('da.timezone'), 'Asia/Dhaka'))::time < v_start::time then
    raise exception 'Today''s account can be started from % only.', v_start using errcode = '22023';
  end if;
  if exists (select 1 from public.da_sessions where hub_id = p_hub and account_date = v_date) then
    raise exception 'A daily account sheet for this hub and date already exists.' using errcode = '23505';
  end if;
  insert into public.da_sessions (hub_id, zone_id, account_date, started_by, started_by_employee, started_by_name, started_by_code)
  values (p_hub, v_zone, v_date, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code())
  returning id into v_id;
  perform private.da_event(v_id, 'started', null, false);
  perform public.da_apply_fixed(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. The sheet carries its people, its notes and its closing
-- ---------------------------------------------------------------------
create or replace function public.da_sheet(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.da_sessions where id = p_session) then
    raise exception 'Daily account sheet not found or not visible to you.' using errcode = 'P0002';
  end if;
  select private.da_snapshot(p_session)
         || jsonb_build_object(
              'events', coalesce((select jsonb_agg(to_jsonb(e) - 'snapshot' || jsonb_build_object('has_snapshot', e.snapshot is not null) order by e.at)
                                  from public.da_events e where e.session_id = p_session), '[]'),
              'visits', coalesce((select jsonb_agg(to_jsonb(v) order by v.entered_at desc)
                                  from public.da_page_visits v where v.session_id = p_session), '[]'),
              'collectors', coalesce((select jsonb_agg(to_jsonb(c) order by c.closed_at nulls first, c.created_at)
                                  from public.da_collectors(p_session) c), '[]'),
              'notes_in', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at)
                                  from public.da_cash_notes n where n.session_id = p_session and n.removed_at is null), '[]'),
              'can_edit', (select private.da_can_edit(s) from public.da_sessions s where s.id = p_session),
              'can_verify', (select private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)
                                    and auth.uid() is distinct from s.started_by and auth.uid() is distinct from s.submitted_by
                             from public.da_sessions s where s.id = p_session),
              'can_reopen', (select private.has_permission('da.correction.edit', s.zone_id, s.hub_id) and s.status = 'submitted'
                             from public.da_sessions s where s.id = p_session))
    into v_out;
  if not exists (select 1 from public.da_sessions s where s.id = p_session
                 and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)) then
    v_out := jsonb_set(v_out, '{riders}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'riders') r
                                             where (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{merchant_payments}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'merchant_payments') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{expenses}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'expenses') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{notes_in}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'notes_in') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'from_employee')::uuid = private.my_employee_id()), '[]'));
    v_out := v_out - 'totals' - 'visits' - 'collectors';
  end if;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.da_close_my_part(uuid, text, boolean)', 'public.da_collectors(uuid)',
                           'public.da_close_day(uuid, text)', 'public.da_reopen_day(uuid, text)',
                           'public.da_note_save(uuid, numeric, text, text, text, text, uuid)',
                           'public.da_note_remove(uuid, text)', 'public.da_my_handovers(integer)',
                           'public.da_apply_fixed(uuid)', 'public.da_my_claims(integer)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.da_payment_ref(text) from public, anon;
grant execute on function private.da_payment_ref(text) to authenticated;
