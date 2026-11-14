-- =====================================================================
-- XZM-TEAM ERP — Migration 0024: staff put up their own bills, the manager takes them in
--
-- A person adds the money they spent from their own page — what it was for, how
-- much, the bill or voucher, the vehicle it was for. It waits there as a claim.
-- The hub's sheet shows the claims of that hub, and the manager takes one in with
-- one click: it becomes an ordinary expense line on the day's sheet, and the claim
-- is marked as taken in, so the same bill cannot go in twice.
-- =====================================================================

create table public.da_expense_claims (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  employee_id        uuid not null references public.employees(id),
  employee_code      text,
  employee_name      text,
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  kind               text not null default 'employee' check (kind in ('transport','employee')),
  expense_name       text not null check (length(trim(expense_name)) > 1),
  category           text not null,
  amount             numeric(14,2) not null check (amount > 0),
  bill_date          date not null,
  bill_no            text,
  reference_no       text,
  reference_name     text,
  reference_phone    text,
  reference_position text,
  vehicle_id         uuid references public.vehicles(id),
  attachment_path    text,
  remarks            text,
  status             text not null default 'submitted' check (status in ('submitted','added','rejected','withdrawn')),
  session_id         uuid references public.da_sessions(id),
  expense_id         uuid references public.da_expenses(id),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz not null default now(), created_by uuid,
  updated_at         timestamptz not null default now(), updated_by uuid,
  constraint da_claim_path_chk check (attachment_path is null or attachment_path like 'claims/%'),
  constraint da_claim_done_chk check (status <> 'added' or expense_id is not null),
  constraint da_claim_note_chk check (status <> 'rejected' or length(trim(coalesce(review_note, ''))) > 0)
);
create index da_claims_hub_idx on public.da_expense_claims (hub_id, status);
create index da_claims_employee_idx on public.da_expense_claims (employee_id, status);

alter table public.da_expenses add column if not exists claim_id uuid references public.da_expense_claims(id);
alter table public.da_expenses add column if not exists claim_file text;

create trigger da_claims_stamp before insert or update on public.da_expense_claims
  for each row execute function private.stamp_row();
create trigger da_claims_audit after insert or update or delete on public.da_expense_claims
  for each row execute function private.audit_row('da');
create trigger da_claims_no_delete before delete on public.da_expense_claims
  for each row execute function private.prevent_delete();

alter table public.da_expense_claims enable row level security;
revoke all on public.da_expense_claims from anon;
grant select on public.da_expense_claims to authenticated;

create policy da_claims_read on public.da_expense_claims for select to authenticated
  using (employee_id = private.my_employee_id()
      or private.has_permission('da.sheet.view', zone_id, hub_id)
      or private.has_permission('da.sheet.create', zone_id, hub_id));

-- Files live under claims/<employee id>/…, read by the owner and by the hub's accounts people.
create or replace function private.da_can_read_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions; v_emp uuid;
begin
  if p_name ~ '^claims/[0-9a-f-]{36}/[^/]+$' then
    v_emp := split_part(p_name, '/', 2)::uuid;
    if v_emp = private.my_employee_id() then return true; end if;
    return exists (select 1 from public.employees e
                    where e.id = v_emp
                      and (private.has_permission('da.sheet.view', e.zone_id, e.hub_id)
                           or private.has_permission('da.sheet.create', e.zone_id, e.hub_id)));
  end if;
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and (private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
                               or private.has_permission('da.sheet.create', s.zone_id, s.hub_id));
end $$;

create or replace function private.da_can_upload_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  -- a person's own claim folder
  if p_name ~ '^claims/[0-9a-f-]{36}/[^/]+$' then
    return split_part(p_name, '/', 2)::uuid = private.my_employee_id();
  end if;
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and private.da_can_edit(s);
end $$;

-- ---------------------------------------------------------------------
-- Putting up a claim, and taking it back
-- ---------------------------------------------------------------------
create or replace function public.da_claim_save(
  p_expense_name text, p_category text, p_amount numeric, p_bill_date date,
  p_kind text default 'employee', p_bill_no text default null, p_reference_no text default null,
  p_reference_name text default null, p_reference_phone text default null, p_reference_position text default null,
  p_vehicle uuid default null, p_attachment_path text default null, p_remarks text default null,
  p_claim uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_id uuid; c public.da_expense_claims;
begin
  select * into e from public.employees where id = private.my_employee_id();
  if e.id is null then raise exception 'Only a member of staff can put up a bill.' using errcode = '42501'; end if;
  if e.hub_id is null then raise exception 'Your account is not set to a hub yet.' using errcode = '22023'; end if;
  if p_kind not in ('transport','employee') then raise exception 'Kind must be transport or employee.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if p_bill_date is null or p_bill_date > private.da_today() then
    raise exception 'The bill date cannot be in the future.' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c2
                 where c2 ->> 'code' = p_category) then
    raise exception 'Unknown expense category %.', p_category using errcode = '22023';
  end if;
  if p_reference_phone is not null and nullif(trim(p_reference_phone), '') is not null
     and trim(p_reference_phone) !~ '^01[3-9][0-9]{8}$' then
    raise exception 'The mobile number must look like 01XXXXXXXXX.' using errcode = '22023';
  end if;
  if p_attachment_path is not null and p_attachment_path not like 'claims/' || e.id::text || '/%' then
    raise exception 'The bill file must be in your own folder.' using errcode = '22023';
  end if;

  if p_claim is null then
    insert into public.da_expense_claims (employee_id, employee_code, employee_name, hub_id, zone_id, kind,
      expense_name, category, amount, bill_date, bill_no, reference_no, reference_name, reference_phone,
      reference_position, vehicle_id, attachment_path, remarks)
    values (e.id, e.employee_code::text, e.full_name, e.hub_id, e.zone_id, p_kind,
      trim(p_expense_name), p_category, p_amount, p_bill_date, nullif(trim(p_bill_no), ''),
      nullif(trim(p_reference_no), ''), nullif(trim(p_reference_name), ''), nullif(trim(p_reference_phone), ''),
      nullif(trim(p_reference_position), ''), p_vehicle, p_attachment_path, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    select * into c from public.da_expense_claims where id = p_claim for update;
    if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
    if c.employee_id <> e.id then raise exception 'You can change only your own claim.' using errcode = '42501'; end if;
    if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
    update public.da_expense_claims
       set kind = p_kind, expense_name = trim(p_expense_name), category = p_category, amount = p_amount,
           bill_date = p_bill_date, bill_no = nullif(trim(p_bill_no), ''), reference_no = nullif(trim(p_reference_no), ''),
           reference_name = nullif(trim(p_reference_name), ''), reference_phone = nullif(trim(p_reference_phone), ''),
           reference_position = nullif(trim(p_reference_position), ''), vehicle_id = p_vehicle,
           attachment_path = coalesce(p_attachment_path, attachment_path), remarks = nullif(trim(p_remarks), '')
     where id = p_claim returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.da_claim_withdraw(p_claim uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.da_expense_claims;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if c.employee_id <> private.my_employee_id() then raise exception 'You can take back only your own claim.' using errcode = '42501'; end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_expense_claims set status = 'withdrawn', review_note = trim(p_reason),
         reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
end $$;

-- ---------------------------------------------------------------------
-- What a person sees of their own, and what the sheet shows the manager
-- ---------------------------------------------------------------------
create or replace function public.da_my_claims(p_days integer default 90)
returns setof public.da_expense_claims
language sql stable security invoker set search_path = '' as $$
  select * from public.da_expense_claims
   where employee_id = private.my_employee_id()
     and bill_date >= current_date - greatest(coalesce(p_days, 90), 1)
   order by created_at desc
$$;

create or replace function public.da_sheet_claims(p_session uuid)
returns table (id uuid, no bigint, employee_code text, employee_name text, kind text, expense_name text,
               category text, amount numeric, bill_date date, bill_no text, reference_no text,
               reference_name text, reference_phone text, reference_position text,
               vehicle_id uuid, vehicle_name text, attachment_path text, remarks text, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions ses where ses.id = p_session;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  return query
  select c.id, c.no, c.employee_code, c.employee_name, c.kind, c.expense_name, c.category, c.amount,
         c.bill_date, c.bill_no, c.reference_no, c.reference_name, c.reference_phone, c.reference_position,
         c.vehicle_id, v.name, c.attachment_path, c.remarks, c.created_at
  from public.da_expense_claims c
  left join public.vehicles v on v.id = c.vehicle_id
  where c.hub_id = s.hub_id and c.status = 'submitted'
  order by c.bill_date, c.no;
end $$;

-- ---------------------------------------------------------------------
-- The manager takes a claim in, or turns it down
-- ---------------------------------------------------------------------
create or replace function public.da_claim_add(p_claim uuid, p_session uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.da_expense_claims;
  s public.da_sessions := private.da_require_edit(p_session);
  v_expense uuid;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if c.hub_id <> s.hub_id then raise exception 'This claim belongs to another hub.' using errcode = '22023'; end if;

  insert into public.da_expenses (session_id, hub_id, zone_id, kind, employee_id, employee_code, employee_name,
    expense_name, category, amount, bill_date, bill_no, reference_no, reference_name, reference_phone,
    reference_position, vehicle_id, remarks, claim_id, claim_file)
  values (s.id, s.hub_id, s.zone_id, c.kind, c.employee_id, c.employee_code, c.employee_name,
    c.expense_name, c.category, c.amount, c.bill_date, c.bill_no, c.reference_no, c.reference_name,
    c.reference_phone, c.reference_position, c.vehicle_id,
    nullif(trim(coalesce(c.remarks, '') || case when p_note is not null then ' · ' || trim(p_note) else '' end), ''),
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

create or replace function public.da_claim_reject(p_claim uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.da_expense_claims;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.create', c.zone_id, c.hub_id) then
    raise exception 'Not authorised to deal with the claims of this hub.' using errcode = '42501';
  end if;
  if c.status <> 'submitted' then raise exception 'This claim has already been dealt with.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write why it is turned down.' using errcode = '22023'; end if;
  update public.da_expense_claims set status = 'rejected', review_note = trim(p_note),
         reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.da_claim_save(text, text, numeric, date, text, text, text, text, text, text, uuid, text, text, uuid)',
    'public.da_claim_withdraw(uuid, text)', 'public.da_my_claims(integer)', 'public.da_sheet_claims(uuid)',
    'public.da_claim_add(uuid, uuid, text)', 'public.da_claim_reject(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- A sheet that carries a line in your name is a sheet you may see
--
-- A rider could already see the sheet his rider line sits on. Now that a manager
-- can pull a person's own bill into the day's sheet, the same must hold for an
-- expense in that person's name — otherwise "আমার খরচ" on his page comes back
-- empty, because the sheet behind his expense is invisible to him.
-- ---------------------------------------------------------------------
drop policy if exists da_sessions_read on public.da_sessions;
create policy da_sessions_read on public.da_sessions for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id)
         or started_by = auth.uid() or submitted_by = auth.uid()
         or exists (select 1 from public.da_rider_lines l where l.session_id = da_sessions.id
                    and l.employee_id = private.my_employee_id() and l.removed_at is null)
         or exists (select 1 from public.da_expenses x where x.session_id = da_sessions.id
                    and x.employee_id = private.my_employee_id() and x.removed_at is null));
