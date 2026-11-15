-- =====================================================================
-- XZM-TEAM ERP — Migration 0026: the sheet as a tool
--
--  * Every part of the sheet can be laid out by the Super Admin: hide a
--    column, give it another name, add a column of one's own, switch a part
--    off. Kept in one setting, da.layout.
--  * Values of the columns one adds are kept per sheet, line and column.
--  * Update report IDs with their amounts: the money the hub must account for.
--  * Bank deposits: amount, bank or wallet, transport, the bank charge worked
--    out from the amount (a lower and a higher slab, plus VAT, nothing on
--    Fridays, Saturdays and bank holidays), the slip and its reference.
--  * The day's bank task is finished once a slip is up: "task complete".
--  * Nothing here changes an earlier table or rule.
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('da.layout', '{}',
   'Daily accounts: per part of the sheet — hidden columns, column names, own columns, and whether the part is shown'),
  ('da.bank_charge', '{"limit":100000,"low":20,"high":100,"vat":15,"off_days":[5,6],"holidays":[],"transport":60,"effective_from":null}',
   'Daily accounts: bank charge on a deposit — up to "limit" costs "low", above it "high", plus VAT %; nothing on off days (ISO weekday, 5 = Friday) and holidays; transport to the bank')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Settings: the two new keys are checked like the others
-- ---------------------------------------------------------------------
create or replace function public.da_configure(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then
    raise exception 'Not authorised to change daily account settings.' using errcode = '42501';
  end if;
  if p_key not like 'da.%' or not exists (select 1 from public.system_settings where key = p_key) then
    raise exception 'Unknown daily account setting %.', p_key using errcode = '22023';
  end if;
  if p_key = 'da.start_time' and (jsonb_typeof(p_value) <> 'string' or p_value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'Start time must look like 08:30.' using errcode = '22023';
  elsif p_key = 'da.due_rule' and p_value #>> '{}' not in ('manual','amount_minus_paid') then
    raise exception 'Due rule must be manual or amount_minus_paid.' using errcode = '22023';
  elsif p_key = 'da.mobile_banking_rule' and p_value #>> '{}' not in ('separate','reduces_due','adds_to_due') then
    raise exception 'Mobile banking rule must be separate, reduces_due or adds_to_due.' using errcode = '22023';
  elsif p_key in ('da.session_tracking','da.require_assignment') and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'This setting must be true or false.' using errcode = '22023';
  elsif p_key = 'da.backdate_days' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 31) then
    raise exception 'Back-dating must be 0 to 31 days.' using errcode = '22023';
  elsif p_key = 'da.expense_categories' and (jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0
        or exists (select 1 from jsonb_array_elements(p_value) c where coalesce(c ->> 'code', '') !~ '^[a-z][a-z0-9_]*$'
                                                                       or length(trim(coalesce(c ->> 'en', ''))) = 0)) then
    raise exception 'Each category needs a code (a-z, 0-9, _) and a name.' using errcode = '22023';
  elsif p_key = 'da.rider_fields' and (jsonb_typeof(p_value) <> 'array'
        or exists (select 1 from jsonb_array_elements_text(p_value) f
                   where f not in ('delivery_qty','pickup_qty','amount','paid_amount','due','mobile_banking','remarks'))) then
    raise exception 'Unknown rider field.' using errcode = '22023';
  elsif p_key in ('da.reference_setup','da.bill_upload','da.ocr','da.layout') and jsonb_typeof(p_value) <> 'object' then
    raise exception 'This setting must be an object.' using errcode = '22023';
  elsif p_key = 'da.layout' and exists (
        select 1 from jsonb_each(p_value) sec
        where sec.key !~ '^[a-z_]{2,30}$' or jsonb_typeof(sec.value) <> 'object'
           or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(sec.value -> 'extra') = 'array' then sec.value -> 'extra' else '[]' end) x
                      where coalesce(x ->> 'key', '') !~ '^x_[a-z0-9_]{1,30}$' or length(trim(coalesce(x ->> 'label', ''))) = 0)) then
    raise exception 'Layout: each part needs a plain name, and each own column a key (x_…) and a name.' using errcode = '22023';
  elsif p_key = 'da.bank_charge' and (jsonb_typeof(p_value) <> 'object'
        or jsonb_typeof(p_value -> 'limit') <> 'number' or (p_value ->> 'limit')::numeric < 0
        or jsonb_typeof(p_value -> 'low') <> 'number' or (p_value ->> 'low')::numeric < 0
        or jsonb_typeof(p_value -> 'high') <> 'number' or (p_value ->> 'high')::numeric < 0
        or jsonb_typeof(p_value -> 'vat') <> 'number' or (p_value ->> 'vat')::numeric not between 0 and 100
        or jsonb_typeof(coalesce(p_value -> 'off_days', '[]')) <> 'array'
        or exists (select 1 from jsonb_array_elements_text(coalesce(p_value -> 'off_days', '[]')) d where d !~ '^[1-7]$')
        or jsonb_typeof(coalesce(p_value -> 'holidays', '[]')) <> 'array'
        or exists (select 1 from jsonb_array_elements_text(coalesce(p_value -> 'holidays', '[]')) d where d !~ '^\d{4}-\d{2}-\d{2}$')
        or (p_value ? 'transport' and (jsonb_typeof(p_value -> 'transport') <> 'number' or (p_value ->> 'transport')::numeric < 0))) then
    raise exception 'Bank charge: limit, low, high and VAT must be numbers (VAT 0–100); off days 1–7; holidays as dates.' using errcode = '22023';
  end if;
  update public.system_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform private.write_audit('CONFIGURE', 'da', 'system_settings', p_key, null, jsonb_build_object(p_key, p_value));
end $$;

-- ---------------------------------------------------------------------
-- 2. The bank charge on one deposit
-- ---------------------------------------------------------------------
create or replace function private.da_is_bank_off(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  -- off days may be kept as numbers or as text ("5"); holidays as 'YYYY-MM-DD'
  select exists (select 1 from jsonb_array_elements_text(coalesce(private.da_setting('da.bank_charge') -> 'off_days', '[]')) d
                 where d = extract(isodow from p_date)::int::text)
      or exists (select 1 from jsonb_array_elements_text(coalesce(private.da_setting('da.bank_charge') -> 'holidays', '[]')) h
                 where h = p_date::text)
$$;

create or replace function public.da_bank_charge(p_amount numeric, p_method text default 'bank', p_date date default null)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := coalesce(private.da_setting('da.bank_charge'), '{}'); v_fee numeric;
begin
  if coalesce(p_method, 'bank') <> 'bank' or coalesce(p_amount, 0) <= 0 then return 0; end if;
  if private.da_is_bank_off(coalesce(p_date, private.da_today())) then return 0; end if;
  v_fee := case when p_amount <= coalesce((c ->> 'limit')::numeric, 0) then coalesce((c ->> 'low')::numeric, 0)
                else coalesce((c ->> 'high')::numeric, 0) end;
  return round(v_fee * (1 + coalesce((c ->> 'vat')::numeric, 0) / 100), 2);
end $$;

-- ---------------------------------------------------------------------
-- 3. Tables: report IDs, deposits, own-column values
-- ---------------------------------------------------------------------
create table public.da_report_ids (
  id            uuid primary key default gen_random_uuid(),
  no            bigint generated always as identity unique,
  session_id    uuid not null references public.da_sessions(id),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  report_no     text not null check (length(trim(report_no)) between 1 and 60),
  amount        numeric(14,2) not null default 0 check (amount >= 0),
  remarks       text,
  removed_at    timestamptz, removed_by uuid, remove_reason text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create unique index da_report_ids_once on public.da_report_ids (session_id, upper(trim(report_no))) where removed_at is null;
create index da_report_ids_session_idx on public.da_report_ids (session_id) where removed_at is null;
create index da_report_ids_hub_fk_idx on public.da_report_ids (hub_id);
create index da_report_ids_zone_fk_idx on public.da_report_ids (zone_id);

create table public.da_deposits (
  id            uuid primary key default gen_random_uuid(),
  no            bigint generated always as identity unique,
  session_id    uuid not null references public.da_sessions(id),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  method        text not null default 'bank' check (method in ('bank','bkash','nagad','rocket','other')),
  bank_name     text,
  amount        numeric(14,2) not null check (amount > 0),
  charge        numeric(14,2) not null default 0 check (charge >= 0),
  charge_auto   boolean not null default true,
  transport     numeric(14,2) not null default 0 check (transport >= 0),
  people        text,
  ref_no        text,
  slip_path     text,
  deposited_on  date not null,
  remarks       text,
  removed_at    timestamptz, removed_by uuid, remove_reason text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create index da_deposits_session_idx on public.da_deposits (session_id) where removed_at is null;
create index da_deposits_hub_fk_idx on public.da_deposits (hub_id);
create index da_deposits_zone_fk_idx on public.da_deposits (zone_id);

create table public.da_cells (
  session_id    uuid not null references public.da_sessions(id),
  section       text not null check (section in ('riders','payment','expense','reports','deposits','notes')),
  row_id        uuid not null,
  col_key       text not null check (col_key ~ '^x_[a-z0-9_]{1,30}$'),
  value         text check (value is null or length(value) <= 500),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  primary key (session_id, section, row_id, col_key)
);
create index da_cells_hub_fk_idx on public.da_cells (hub_id);
create index da_cells_zone_fk_idx on public.da_cells (zone_id);

do $$
declare t text;
begin
  foreach t in array array['da_report_ids','da_deposits'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t||'_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''da'')', t||'_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t||'_no_delete', t);
  end loop;
end $$;
create trigger da_cells_audit after insert or update or delete on public.da_cells
  for each row execute function private.audit_row('da');

alter table public.da_report_ids enable row level security;
alter table public.da_deposits   enable row level security;
alter table public.da_cells      enable row level security;
revoke all on public.da_report_ids, public.da_deposits, public.da_cells from anon;
grant select on public.da_report_ids, public.da_deposits, public.da_cells to authenticated;
create policy da_report_ids_read on public.da_report_ids for select to authenticated
  using (created_by = auth.uid() or private.has_permission('da.sheet.view', zone_id, hub_id));
create policy da_deposits_read on public.da_deposits for select to authenticated
  using (created_by = auth.uid() or private.has_permission('da.sheet.view', zone_id, hub_id));
create policy da_cells_read on public.da_cells for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or private.has_permission('da.sheet.create', zone_id, hub_id));

alter table public.da_sessions add column if not exists bank_done_at timestamptz;
alter table public.da_sessions add column if not exists bank_done_by uuid;
alter table public.da_sessions add column if not exists bank_done_note text;

-- ---------------------------------------------------------------------
-- 4. Report IDs
-- ---------------------------------------------------------------------
create or replace function public.da_report_save(
  p_session uuid, p_report_no text, p_amount numeric, p_remarks text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session); v_id uuid; v_no text := upper(trim(coalesce(p_report_no, '')));
begin
  if length(v_no) = 0 then raise exception 'Write the report ID.' using errcode = '22023'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'The amount cannot be less than zero.' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.da_report_ids (session_id, hub_id, zone_id, report_no, amount, remarks)
    values (s.id, s.hub_id, s.zone_id, v_no, p_amount, nullif(trim(p_remarks), '')) returning id into v_id;
  else
    update public.da_report_ids set report_no = v_no, amount = p_amount, remarks = nullif(trim(p_remarks), '')
     where id = p_id and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Report ID not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = s.id and bank_done_at is not null;
  return v_id;
end $$;

create or replace function public.da_report_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.da_report_ids;
begin
  select * into r from public.da_report_ids where id = p_id and removed_at is null;
  if r.id is null then raise exception 'Report ID not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(r.session_id);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_report_ids set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = r.session_id and bank_done_at is not null;
end $$;

-- ---------------------------------------------------------------------
-- 5. Deposits
-- ---------------------------------------------------------------------
create or replace function public.da_deposit_save(
  p_session uuid, p_amount numeric, p_method text default 'bank', p_bank text default null, p_ref text default null,
  p_slip text default null, p_date date default null, p_transport numeric default null, p_charge numeric default null,
  p_people text default null, p_remarks text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_id uuid; v_date date; v_method text := coalesce(nullif(trim(p_method), ''), 'bank');
  v_charge numeric; v_transport numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Write the amount deposited.' using errcode = '22023'; end if;
  if p_charge is not null and p_charge < 0 or p_transport is not null and p_transport < 0 then
    raise exception 'Charge and transport cannot be less than zero.' using errcode = '22023';
  end if;
  if p_slip is not null and p_slip !~ ('^da/' || s.id::text || '/[^/]+$') then
    raise exception 'The slip must be uploaded to this sheet.' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, s.account_date);
  v_charge := coalesce(p_charge, public.da_bank_charge(p_amount, v_method, v_date));
  v_transport := coalesce(p_transport, case when v_method = 'bank' and not private.da_is_bank_off(v_date)
                                            then coalesce((private.da_setting('da.bank_charge') ->> 'transport')::numeric, 0) else 0 end);
  if p_id is null then
    insert into public.da_deposits (session_id, hub_id, zone_id, method, bank_name, amount, charge, charge_auto, transport,
                                    people, ref_no, slip_path, deposited_on, remarks)
    values (s.id, s.hub_id, s.zone_id, v_method, nullif(trim(p_bank), ''), p_amount, v_charge, p_charge is null, v_transport,
            nullif(trim(p_people), ''), nullif(trim(p_ref), ''), p_slip, v_date, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_deposits set method = v_method, bank_name = nullif(trim(p_bank), ''), amount = p_amount, charge = v_charge,
           charge_auto = p_charge is null, transport = v_transport, people = nullif(trim(p_people), ''), ref_no = nullif(trim(p_ref), ''),
           slip_path = coalesce(p_slip, slip_path), deposited_on = v_date, remarks = nullif(trim(p_remarks), '')
     where id = p_id and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Deposit not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = s.id and bank_done_at is not null;
  return v_id;
end $$;

create or replace function public.da_deposit_remove(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.da_deposits;
begin
  select * into d from public.da_deposits where id = p_id and removed_at is null;
  if d.id is null then raise exception 'Deposit not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(d.session_id);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write why.' using errcode = '22023'; end if;
  update public.da_deposits set removed_at = now(), removed_by = auth.uid(), remove_reason = trim(p_reason) where id = p_id;
  update public.da_sessions set bank_done_at = null, bank_done_by = null where id = d.session_id and bank_done_at is not null;
end $$;

-- The day's bank work is done: at least one deposit, and every deposit has its slip.
create or replace function public.da_bank_done(p_session uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session);
begin
  if not exists (select 1 from public.da_deposits where session_id = s.id and removed_at is null) then
    raise exception 'Write the deposit first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.da_deposits where session_id = s.id and removed_at is null and slip_path is null) then
    raise exception 'Upload the bank slip of every deposit first.' using errcode = '22023';
  end if;
  update public.da_sessions set bank_done_at = now(), bank_done_by = auth.uid(), bank_done_note = nullif(trim(p_note), '') where id = s.id;
  perform private.da_event(s.id, 'note', 'Bank deposit done' || coalesce(': ' || nullif(trim(p_note), ''), ''), false);
end $$;

-- ---------------------------------------------------------------------
-- 6. Values of one's own columns
-- ---------------------------------------------------------------------
create or replace function public.da_cell_set(p_session uuid, p_section text, p_row uuid, p_col text, p_value text)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_require_edit(p_session); v text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_section not in ('riders','payment','expense','reports','deposits','notes') then
    raise exception 'Unknown part of the sheet: %.', p_section using errcode = '22023';
  end if;
  if coalesce(p_col, '') !~ '^x_[a-z0-9_]{1,30}$' then raise exception 'Unknown column.' using errcode = '22023'; end if;
  if v is not null and length(v) > 500 then raise exception 'Keep it under 500 letters.' using errcode = '22023'; end if;
  if v is null then
    delete from public.da_cells where session_id = s.id and section = p_section and row_id = p_row and col_key = p_col;
  else
    insert into public.da_cells (session_id, section, row_id, col_key, value, hub_id, zone_id, updated_by)
    values (s.id, p_section, p_row, p_col, v, s.hub_id, s.zone_id, auth.uid())
    on conflict (session_id, section, row_id, col_key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. The sheet carries its report IDs, deposits and own-column values
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
              'report_ids', coalesce((select jsonb_agg(to_jsonb(r) order by r.no)
                                  from public.da_report_ids r where r.session_id = p_session and r.removed_at is null), '[]'),
              'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.no)
                                  from public.da_deposits d where d.session_id = p_session and d.removed_at is null), '[]'),
              'cells', coalesce((select jsonb_agg(jsonb_build_object('section', c.section, 'row_id', c.row_id, 'col', c.col_key, 'value', c.value))
                                  from public.da_cells c where c.session_id = p_session), '[]'),
              'can_edit', (select private.da_can_edit(s) from public.da_sessions s where s.id = p_session),
              'can_verify', (select private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)
                                    and auth.uid() is distinct from s.started_by and auth.uid() is distinct from s.submitted_by
                             from public.da_sessions s where s.id = p_session),
              'can_reopen', (select private.has_permission('da.correction.edit', s.zone_id, s.hub_id) and s.status = 'submitted'
                             from public.da_sessions s where s.id = p_session),
              'can_layout', private.has_permission('da.settings.configure'))
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
    v_out := jsonb_set(v_out, '{report_ids}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'report_ids') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{deposits}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'deposits') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := v_out - 'totals' - 'visits' - 'collectors' - 'cells';
  end if;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.da_bank_charge(numeric, text, date)',
                           'public.da_report_save(uuid, text, numeric, text, uuid)', 'public.da_report_remove(uuid, text)',
                           'public.da_deposit_save(uuid, numeric, text, text, text, text, date, numeric, numeric, text, text, uuid)',
                           'public.da_deposit_remove(uuid, text)', 'public.da_bank_done(uuid, text)',
                           'public.da_cell_set(uuid, text, uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.da_is_bank_off(date) from public, anon;
grant execute on function private.da_is_bank_off(date) to authenticated;
