-- =====================================================================
--  অফিস অপারেশন (office operations) — built on the Office tables of
--  20261115000300_office_management.sql. Nothing existing is removed.
--
--  * A place may now also be a garage or an auto garage tied to a hub.
--    A place carries its lease: advance, contract dates, contract photo,
--    rent day, electricity meter and unit rate, wifi provider and bill.
--  * office_bills: the month's rent / electricity / wifi bill of a place,
--    with the memo (or the office's own memo number when there is none)
--    and the payment screenshot. An electricity bill needs the screenshot.
--    office_expense_lines() shows what the hub's daily accounts already
--    hold in the matching expense categories.
--  * office_assets: watt, hours a day, size / type, and the vehicle a lock
--    belongs to. office_asset_loans: an item used by another place stays
--    counted at the place that owns it.
--  * office_residents: who lives in a residence.
--  * office_secrets: CCTV / DVR / router / wifi / PC-lock user names and
--    passwords. Kept out of the audit log; read only with office.secret.view
--    or by the person who holds the item.
--  * office_notices: "this is broken" / "we need this" to the zonal manager.
--
--  Rollback: drop the tables office_notices, office_secrets, office_residents,
--  office_bills, office_asset_loans, the functions office_* created here, the
--  storage policies office_docs_*, the added columns, and put the old list
--  back on office_properties_kind_check (once no row uses the new kinds).
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('office.bill.view',     'office', 'bill',   'view',   'See rent, electricity and wifi bills of an office, and the matching lines of the daily accounts'),
  ('office.bill.edit',     'office', 'bill',   'edit',   'Write rent, electricity and wifi bills, memos and payment screenshots'),
  ('office.secret.view',   'office', 'secret', 'view',   'See CCTV / router / PC user names and passwords of an office'),
  ('office.secret.edit',   'office', 'secret', 'edit',   'Write CCTV / router / PC user names and passwords of an office'),
  ('office.notice.create', 'office', 'notice', 'create', 'Tell the zonal manager what is broken or needed'),
  ('office.notice.approve', 'office', 'notice', 'approve','Receive and answer the offices'' broken / needed reports')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager', 'zonal_manager', 'operations_manager')
        and p.code in ('office.bill.view', 'office.bill.edit', 'office.secret.view', 'office.secret.edit', 'office.notice.create', 'office.notice.approve'))
  or (r.code = 'hub_manager'
        and p.code in ('office.property.edit', 'office.asset.edit', 'office.bill.view', 'office.bill.edit', 'office.secret.view', 'office.secret.edit', 'office.notice.create'))
  or (r.code = 'accounts_manager' and p.code in ('office.bill.view', 'office.bill.edit'))
  or (r.code = 'auditor' and p.code = 'office.bill.view')
) on conflict do nothing;

insert into public.system_settings (key, value, description) values
  ('office.bill_categories', '{"rent":["office_rent","others_rental"],"electricity":["utilities"],"wifi":["internet"]}'::jsonb,
   'Which expense categories of the daily accounts count as office rent, electricity and wifi')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- places: garage kinds + the lease
alter table public.office_properties drop constraint office_properties_kind_check;
alter table public.office_properties add constraint office_properties_kind_check
  check (kind in ('office', 'residence', 'garage', 'auto_garage'));
alter table public.office_properties
  add column if not exists advance       numeric(12,2) check (advance is null or advance >= 0),
  add column if not exists contract_from date,
  add column if not exists contract_to   date,
  add column if not exists contract_file text,
  add column if not exists rent_due_day  smallint check (rent_due_day is null or rent_due_day between 1 and 31),
  add column if not exists meter_no      text,
  add column if not exists unit_rate     numeric(6,2) check (unit_rate is null or unit_rate > 0),
  add column if not exists wifi_provider text,
  add column if not exists wifi_bill     numeric(10,2) check (wifi_bill is null or wifi_bill >= 0),
  add column if not exists capacity      integer check (capacity is null or capacity >= 0);
alter table public.office_properties drop constraint if exists office_properties_contract_chk;
alter table public.office_properties add constraint office_properties_contract_chk
  check (contract_to is null or contract_from is null or contract_to >= contract_from);

-- ---------------------------------------------------------------- items: power, size, vehicle
alter table public.office_assets
  add column if not exists watt          integer check (watt is null or watt between 0 and 20000),
  add column if not exists hours_per_day numeric(4,1) check (hours_per_day is null or hours_per_day between 0 and 24),
  add column if not exists spec          text,
  add column if not exists vehicle_id    uuid references public.vehicles(id);
create index if not exists office_assets_vehicle on public.office_assets (vehicle_id) where vehicle_id is not null and archived_at is null;

-- ---------------------------------------------------------------- an item used by another place
create table public.office_asset_loans (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.office_assets(id),
  from_property_id uuid not null references public.office_properties(id),
  to_property_id uuid not null references public.office_properties(id),
  quantity integer not null default 1 check (quantity > 0),
  since date not null default (now() at time zone 'Asia/Dhaka')::date,
  note text,
  returned_at timestamptz, returned_by uuid, return_note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint office_loan_other_place check (from_property_id <> to_property_id)
);
create index office_asset_loans_asset on public.office_asset_loans (asset_id) where returned_at is null;
create index office_asset_loans_to on public.office_asset_loans (to_property_id) where returned_at is null;
create index office_asset_loans_from on public.office_asset_loans (from_property_id);

-- ---------------------------------------------------------------- who lives in a residence
create table public.office_residents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.office_properties(id),
  room_id uuid references public.office_rooms(id),
  employee_id uuid not null references public.employees(id),
  since date not null default (now() at time zone 'Asia/Dhaka')::date,
  note text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index office_residents_once on public.office_residents (property_id, employee_id) where archived_at is null;
create index office_residents_emp on public.office_residents (employee_id) where archived_at is null;
create index office_residents_room on public.office_residents (room_id);

-- ---------------------------------------------------------------- user names and passwords
create table public.office_secrets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.office_properties(id),
  asset_id uuid references public.office_assets(id),
  kind text not null default 'other' check (kind in ('cctv', 'dvr', 'router', 'wifi', 'pc', 'other')),
  label text not null check (length(trim(label)) > 0),
  username text, secret text, note text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index office_secrets_prop on public.office_secrets (property_id) where archived_at is null;
create index office_secrets_asset on public.office_secrets (asset_id);

-- ---------------------------------------------------------------- the month's bills
create sequence public.office_memo_no_seq;
create table public.office_bills (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.office_properties(id),
  kind text not null check (kind in ('rent', 'electricity', 'wifi', 'other')),
  bill_month date not null check (bill_month = date_trunc('month', bill_month)::date),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date,
  method text check (method in ('cash', 'bkash', 'nagad', 'rocket', 'bank', 'other')),
  txn_id text, payee text, payee_phone text,
  units numeric(10,2) check (units is null or units >= 0),
  has_memo boolean not null default false,      -- the landlord / the office gave a memo
  memo_file text,                               -- its photo (bucket office-docs)
  memo_no text unique,                          -- the office's own memo, when there is none
  proof_file text,                              -- mobile-banking / payment screenshot
  da_expense_id uuid references public.da_expenses(id),
  note text,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  created_at timestamptz not null default now(), created_by uuid, created_by_name text,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint office_bill_electricity_proof check (kind <> 'electricity' or proof_file is not null)
);
create unique index office_bills_once on public.office_bills (property_id, kind, bill_month) where archived_at is null and kind <> 'other';
create index office_bills_prop on public.office_bills (property_id, bill_month desc);
create index office_bills_expense on public.office_bills (da_expense_id);

-- ---------------------------------------------------------------- broken / needed, to the zonal manager
create sequence public.office_notice_no_seq;
create table public.office_notices (
  id uuid primary key default gen_random_uuid(),
  notice_no text not null unique default ('ON-' || lpad(nextval('public.office_notice_no_seq')::text, 5, '0')),
  property_id uuid not null references public.office_properties(id),
  zone_id uuid not null references public.zones(id),
  hub_id uuid references public.hubs(id),
  asset_id uuid references public.office_assets(id),
  kind text not null check (kind in ('broken', 'need', 'other')),
  item_kind text,
  title text not null check (length(trim(title)) > 0),
  quantity integer not null default 1 check (quantity > 0),
  note text,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status text not null default 'open' check (status in ('open', 'seen', 'done', 'rejected')),
  reply text, decided_by uuid, decided_by_name text, decided_at timestamptz,
  by_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index office_notices_prop on public.office_notices (property_id, created_at desc);
create index office_notices_zone_open on public.office_notices (zone_id) where status in ('open', 'seen');
create index office_notices_asset on public.office_notices (asset_id);
create index office_notices_hub on public.office_notices (hub_id);

-- ---------------------------------------------------------------- stamps, audit, access
do $$
declare t text;
begin
  foreach t in array array['office_asset_loans', 'office_residents', 'office_secrets', 'office_bills', 'office_notices'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    -- passwords stay out of the audit log
    if t <> 'office_secrets' then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'office');
    end if;
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant insert, update on public.office_residents, public.office_secrets to authenticated;

-- May the caller use this item as its keeper (holder, or responsible for its desk)?
create or replace function private.office_asset_mine(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.office_assets a left join public.office_desks d on d.id = a.desk_id
                  where a.id = p_asset and private.my_employee_id() is not null
                    and (a.holder_id = private.my_employee_id() or d.responsible_id = private.my_employee_id()))
$$;
grant execute on function private.office_asset_mine(uuid) to authenticated;

create policy oal_read on public.office_asset_loans for select to authenticated
  using (private.office_can('office.asset.view', from_property_id) or private.office_can('office.asset.view', to_property_id));

create policy ors_read on public.office_residents for select to authenticated
  using (private.office_can('office.property.view', property_id) or employee_id = private.my_employee_id());
create policy ors_insert on public.office_residents for insert to authenticated with check (private.office_can('office.property.edit', property_id));
create policy ors_update on public.office_residents for update to authenticated
  using (private.office_can('office.property.edit', property_id)) with check (private.office_can('office.property.edit', property_id));

create policy osc_read on public.office_secrets for select to authenticated
  using (private.office_can('office.secret.view', property_id) or (asset_id is not null and private.office_asset_mine(asset_id)));
create policy osc_insert on public.office_secrets for insert to authenticated
  with check ((private.office_can('office.secret.edit', property_id) or (asset_id is not null and private.office_asset_mine(asset_id)))
          and (asset_id is null or exists (select 1 from public.office_assets a where a.id = asset_id and a.property_id = office_secrets.property_id)));
create policy osc_update on public.office_secrets for update to authenticated
  using (private.office_can('office.secret.edit', property_id) or (asset_id is not null and private.office_asset_mine(asset_id)))
  with check ((private.office_can('office.secret.edit', property_id) or (asset_id is not null and private.office_asset_mine(asset_id)))
          and (asset_id is null or exists (select 1 from public.office_assets a where a.id = asset_id and a.property_id = office_secrets.property_id)));

create policy obl_read on public.office_bills for select to authenticated using (private.office_can('office.bill.view', property_id));

create policy ont_read on public.office_notices for select to authenticated
  using (created_by = (select auth.uid()) or private.office_can('office.notice.approve', property_id) or private.office_can('office.notice.create', property_id));

-- ---------------------------------------------------------------- lend an item to another place
create or replace function public.office_lend(p_asset uuid, p_to uuid, p_quantity integer default 1, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.office_assets; v_out integer; v_id uuid;
begin
  select * into a from public.office_assets where id = p_asset and archived_at is null;
  if not found then raise exception 'জিনিসটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.asset.edit', a.property_id) then raise exception 'এই অফিসের জিনিস অন্য জায়গায় দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_to is null or p_to = a.property_id or not exists (select 1 from public.office_properties where id = p_to and archived_at is null) then
    raise exception 'কোন অফিসে দেবেন, বেছে নিন' using errcode = '22023'; end if;
  if coalesce(p_quantity, 0) < 1 then raise exception 'কয়টা দেবেন লিখুন' using errcode = '22023'; end if;
  select coalesce(sum(quantity), 0) into v_out from public.office_asset_loans where asset_id = a.id and returned_at is null;
  if v_out + p_quantity > a.quantity then
    raise exception 'এই জিনিস আছে %টা, এর মধ্যে %টা আগেই অন্য জায়গায় দেওয়া', a.quantity, v_out using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'অন্য অফিসে ব্যবহারের জন্য দেওয়া', true);
  insert into public.office_asset_loans (asset_id, from_property_id, to_property_id, quantity, note)
  values (a.id, a.property_id, p_to, p_quantity, nullif(trim(coalesce(p_note, '')), '')) returning id into v_id;
  return v_id;
end $$;

create or replace function public.office_lend_return(p_loan uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.office_asset_loans;
begin
  select * into l from public.office_asset_loans where id = p_loan and returned_at is null;
  if not found then raise exception 'এই দেওয়াটা পাওয়া যায়নি বা আগেই ফেরত এসেছে' using errcode = 'P0002'; end if;
  if not (private.office_can('office.asset.edit', l.from_property_id) or private.office_can('office.asset.edit', l.to_property_id)) then
    raise exception 'ফেরত লেখার অনুমতি নেই' using errcode = '42501'; end if;
  perform set_config('app.change_reason', 'জিনিস ফেরত', true);
  update public.office_asset_loans set returned_at = now(), returned_by = auth.uid(), return_note = nullif(trim(coalesce(p_note, '')), '') where id = l.id;
end $$;

-- Everything lent or borrowed that the caller may see, with the names of both sides
-- (the other side's office may be outside what the caller can open).
create or replace function public.office_loan_list(p_open_only boolean default true)
returns table (id uuid, asset_id uuid, asset_kind text, asset_name text, quantity integer, since date, note text, returned_at timestamptz,
               from_property_id uuid, from_name text, from_hub_id uuid, to_property_id uuid, to_name text, to_hub_id uuid, can_return boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, l.asset_id, a.kind, a.name, l.quantity, l.since, l.note, l.returned_at,
         l.from_property_id, f.name, f.hub_id, l.to_property_id, t.name, t.hub_id,
         private.office_can('office.asset.edit', l.from_property_id) or private.office_can('office.asset.edit', l.to_property_id)
  from public.office_asset_loans l
  join public.office_assets a on a.id = l.asset_id
  join public.office_properties f on f.id = l.from_property_id
  join public.office_properties t on t.id = l.to_property_id
  where (not p_open_only or l.returned_at is null)
    and (private.office_can('office.asset.view', l.from_property_id) or private.office_can('office.asset.view', l.to_property_id))
  order by l.returned_at nulls first, l.since desc
$$;

-- ---------------------------------------------------------------- bills
-- p_more: paid_on, method, txn_id, payee, payee_phone, units, has_memo, memo_file, proof_file, da_expense_id, note
create or replace function public.office_bill_save(p_property uuid, p_kind text, p_month date, p_amount numeric, p_more jsonb default '{}'::jsonb, p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(p_more, '{}'::jsonb);
  v_month date := date_trunc('month', p_month)::date;
  v_has boolean := coalesce((m ->> 'has_memo')::boolean, false);
  v_proof text := nullif(m ->> 'proof_file', '');
  v_memo_file text := nullif(m ->> 'memo_file', '');
  v_exp uuid := nullif(m ->> 'da_expense_id', '')::uuid;
  v_hub uuid; v_id uuid; v_no text; old public.office_bills;
begin
  if not private.office_can('office.bill.edit', p_property) then raise exception 'এই অফিসের বিল লেখার অনুমতি নেই' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('rent', 'electricity', 'wifi', 'other') then raise exception 'বিলের ধরন ঠিক নয়' using errcode = '22023'; end if;
  if p_month is null then raise exception 'কোন মাসের বিল, দিন' using errcode = '22023'; end if;
  if v_month > (now() at time zone 'Asia/Dhaka')::date + 31 then raise exception 'এত আগাম মাসের বিল লেখা যায় না' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'টাকার অঙ্ক দিন' using errcode = '22023'; end if;
  if p_kind = 'electricity' and v_proof is null then
    raise exception 'বিদ্যুৎ বিলে মোবাইল ব্যাংকিংয়ের স্ক্রিনশট দিতে হবে' using errcode = '22023'; end if;
  if (v_proof is not null and v_proof not like p_property::text || '/%') or (v_memo_file is not null and v_memo_file not like p_property::text || '/%') then
    raise exception 'ছবিটা এই অফিসের ফোল্ডারে নেই' using errcode = '22023'; end if;
  select hub_id into v_hub from public.office_properties where id = p_property;
  if v_exp is not null and not exists (select 1 from public.da_expenses e where e.id = v_exp and e.hub_id = v_hub and e.removed_at is null) then
    raise exception 'হিসাব খাতার এই লাইনটা এই হাবের নয়' using errcode = '22023'; end if;

  perform set_config('app.change_reason', 'অফিসের বিল', true);
  if p_id is not null then
    select * into old from public.office_bills where id = p_id and property_id = p_property and archived_at is null;
    if not found then raise exception 'বিলটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
    v_no := old.memo_no;
  end if;
  if not v_has and v_no is null then
    v_no := 'OM-' || to_char((now() at time zone 'Asia/Dhaka'), 'YYMM') || '-' || lpad(nextval('public.office_memo_no_seq')::text, 5, '0');
  end if;
  if p_id is not null then
    update public.office_bills set kind = p_kind, bill_month = v_month, amount = p_amount,
      paid_on = nullif(m ->> 'paid_on', '')::date, method = nullif(m ->> 'method', ''), txn_id = nullif(trim(m ->> 'txn_id'), ''),
      payee = nullif(trim(m ->> 'payee'), ''), payee_phone = nullif(trim(m ->> 'payee_phone'), ''), units = nullif(m ->> 'units', '')::numeric,
      has_memo = v_has, memo_file = v_memo_file, memo_no = v_no, proof_file = v_proof, da_expense_id = v_exp, note = nullif(trim(m ->> 'note'), '')
    where id = p_id returning id into v_id;
  else
    if p_kind <> 'other' and exists (select 1 from public.office_bills where property_id = p_property and kind = p_kind and bill_month = v_month and archived_at is null) then
      raise exception 'এই মাসের এই বিল আগেই লেখা আছে — সেটাই বদলান' using errcode = '23505'; end if;
    insert into public.office_bills (property_id, kind, bill_month, amount, paid_on, method, txn_id, payee, payee_phone, units,
                                     has_memo, memo_file, memo_no, proof_file, da_expense_id, note, created_by_name)
    values (p_property, p_kind, v_month, p_amount, nullif(m ->> 'paid_on', '')::date, nullif(m ->> 'method', ''), nullif(trim(m ->> 'txn_id'), ''),
            nullif(trim(m ->> 'payee'), ''), nullif(trim(m ->> 'payee_phone'), ''), nullif(m ->> 'units', '')::numeric,
            v_has, v_memo_file, v_no, v_proof, v_exp, nullif(trim(m ->> 'note'), ''), private.my_display_name())
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'memo_no', v_no);
end $$;

create or replace function public.office_bill_remove(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare b public.office_bills;
begin
  select * into b from public.office_bills where id = p_id and archived_at is null;
  if not found then raise exception 'বিলটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.bill.edit', b.property_id) then raise exception 'এই অফিসের বিল সরানোর অনুমতি নেই' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'কেন সরাচ্ছেন লিখুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'অফিসের বিল সরানো: ' || p_reason, true);
  update public.office_bills set archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason) where id = p_id;
end $$;

-- What the hub's daily accounts hold in the rent / electricity / wifi categories.
create or replace function public.office_expense_lines(p_property uuid, p_from date, p_to date)
returns table (id uuid, account_date date, bill_date date, kind text, category text, expense_name text, amount numeric,
               bill_no text, voucher_no text, has_file boolean, sheet_status text, bill_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_hub uuid; v_map jsonb;
begin
  if not private.office_can('office.bill.view', p_property) then raise exception 'এই অফিসের বিল দেখার অনুমতি নেই' using errcode = '42501'; end if;
  select op.hub_id into v_hub from public.office_properties op where op.id = p_property;
  if v_hub is null then return; end if;
  select ss.value into v_map from public.system_settings ss where ss.key = 'office.bill_categories';
  v_map := coalesce(v_map, '{"rent":["office_rent","others_rental"],"electricity":["utilities"],"wifi":["internet"]}'::jsonb);
  return query
  select e.id, s.account_date, e.bill_date, k.key, e.category, e.expense_name, e.amount, e.bill_no, e.voucher_no,
         e.attachment_path is not null, s.status,
         (select b.id from public.office_bills b where b.da_expense_id = e.id and b.archived_at is null limit 1)
  from public.da_expenses e
  join public.da_sessions s on s.id = e.session_id
  join lateral (select m.key from jsonb_each(v_map) m where m.value ? e.category limit 1) k on true
  where e.hub_id = v_hub and e.removed_at is null
    and s.account_date between coalesce(p_from, current_date - 400) and coalesce(p_to, current_date + 1)
  order by s.account_date desc, e.created_at desc
  limit 500;
end $$;

-- ---------------------------------------------------------------- broken / needed
-- Who hears about it: the people who hold office.notice.approve for the place's zone;
-- only when the zone has nobody, those who hold it for the whole company.
create or replace function private.office_notify_managers(p_property uuid, p_title text, p_body text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_zone uuid; u uuid; v_n integer := 0; v_scope text;
begin
  select zone_id into v_zone from public.office_properties where id = p_property;
  foreach v_scope in array array['zone', 'global'] loop
    for u in
      select distinct ur.user_id
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
      join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
      left join public.role_permissions rp on rp.role_id = r.id
      left join public.permissions p on p.id = rp.permission_id
      where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
        and (p.code = 'office.notice.approve' or r.is_super)
        and ur.scope_type = v_scope and (v_scope = 'global' or ur.zone_id = v_zone)
        and ur.user_id is distinct from auth.uid()
    loop
      perform private.notify(u, p_title, p_body, '/app/office/notices', 'office');
      v_n := v_n + 1;
    end loop;
    exit when v_n > 0;
  end loop;
  return v_n;
end $$;

create or replace function public.office_notice_send(
  p_property uuid, p_kind text, p_title text, p_asset uuid default null, p_item_kind text default null,
  p_quantity integer default 1, p_note text default null, p_urgent boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pr public.office_properties; a public.office_assets; v_id uuid; v_no text; v_n integer; v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into pr from public.office_properties where id = p_property and archived_at is null;
  if not found then raise exception 'অফিসটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if p_kind is null or p_kind not in ('broken', 'need', 'other') then raise exception 'ধরন ঠিক নয়' using errcode = '22023'; end if;
  if p_asset is not null then
    select * into a from public.office_assets where id = p_asset and property_id = p_property and archived_at is null;
    if not found then raise exception 'জিনিসটা এই অফিসে পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  if not (private.office_can('office.notice.create', p_property) or (p_asset is not null and private.office_asset_mine(p_asset))) then
    raise exception 'এই অফিসের রিপোর্ট দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  v_title := coalesce(v_title, a.name);
  if v_title is null then raise exception 'কী নষ্ট বা কী লাগবে লিখুন' using errcode = '22023'; end if;
  if coalesce(p_quantity, 0) < 1 then raise exception 'সংখ্যা ঠিক নয়' using errcode = '22023'; end if;
  if p_asset is not null and exists (select 1 from public.office_notices n where n.asset_id = p_asset and n.kind = p_kind and n.status in ('open', 'seen')) then
    raise exception 'এই জিনিসের রিপোর্ট আগেই দেওয়া আছে — উত্তরের অপেক্ষায়' using errcode = '23505'; end if;

  perform set_config('app.change_reason', 'জোনাল ম্যানেজারকে রিপোর্ট', true);
  insert into public.office_notices (property_id, zone_id, hub_id, asset_id, kind, item_kind, title, quantity, note, priority, by_name)
  values (p_property, pr.zone_id, pr.hub_id, p_asset, p_kind, coalesce(nullif(trim(coalesce(p_item_kind, '')), ''), a.kind), v_title, p_quantity,
          nullif(trim(coalesce(p_note, '')), ''), case when p_urgent then 'urgent' else 'normal' end, private.my_display_name())
  returning id, notice_no into v_id, v_no;
  if p_kind = 'broken' and p_asset is not null and a.condition in ('good', 'repair') then
    update public.office_assets set condition = 'broken' where id = p_asset;
  end if;
  v_n := private.office_notify_managers(p_property,
    case p_kind when 'broken' then 'নষ্ট হয়েছে: ' when 'need' then 'লাগবে: ' else 'অফিস রিপোর্ট: ' end || v_title
      || case when p_quantity > 1 then ' ×' || p_quantity else '' end || case when p_urgent then ' (জরুরি)' else '' end,
    v_no || ' · ' || pr.name || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  return jsonb_build_object('id', v_id, 'no', v_no, 'notified', v_n);
end $$;

create or replace function public.office_notice_update(p_id uuid, p_status text, p_reply text default null, p_fixed boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare n public.office_notices; v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  select * into n from public.office_notices where id = p_id;
  if not found then raise exception 'রিপোর্টটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.office_can('office.notice.approve', n.property_id) then raise exception 'এই রিপোর্টের উত্তর দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('seen', 'done', 'rejected') then raise exception 'অবস্থা ঠিক নয়' using errcode = '22023'; end if;
  if n.status in ('done', 'rejected') then raise exception 'এই রিপোর্টের কাজ আগেই শেষ' using errcode = '22023'; end if;
  if p_status = 'rejected' and v_reply is null then raise exception 'কেন হবে না, লিখুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', 'অফিস রিপোর্ট ' || n.notice_no || ' → ' || p_status, true);
  update public.office_notices set status = p_status, reply = coalesce(v_reply, reply), decided_by = auth.uid(),
         decided_by_name = private.my_display_name(), decided_at = now() where id = p_id;
  if p_status = 'done' and p_fixed and n.asset_id is not null then
    update public.office_assets set condition = 'good' where id = n.asset_id and condition in ('broken', 'repair');
  end if;
  perform private.notify(n.created_by,
    n.notice_no || ': ' || case p_status when 'seen' then 'জোনাল ম্যানেজার দেখেছেন' when 'done' then 'ব্যবস্থা হয়েছে' else 'হবে না' end,
    n.title || coalesce(' — ' || v_reply, ''), '/app/office/notices', 'office');
end $$;

-- ---------------------------------------------------------------- photos: contract, memo, payment screenshot
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('office-docs', 'office-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
-- Path: <property_id>/<file>.
create or replace function private.office_object_property(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' then split_part(p_name, '/', 1)::uuid end
$$;
create or replace function private.office_doc_readable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.office_can('office.bill.view', private.office_object_property(p_name))
      or private.office_can('office.property.edit', private.office_object_property(p_name))
$$;
create or replace function private.office_doc_writable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.office_can('office.bill.edit', private.office_object_property(p_name))
      or private.office_can('office.property.edit', private.office_object_property(p_name))
$$;
drop policy if exists office_docs_read on storage.objects;
create policy office_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'office-docs' and private.office_doc_readable(name));
drop policy if exists office_docs_write on storage.objects;
create policy office_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'office-docs' and private.office_doc_writable(name));

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.office_lend(uuid, uuid, integer, text)', 'public.office_lend_return(uuid, text)', 'public.office_loan_list(boolean)',
    'public.office_bill_save(uuid, text, date, numeric, jsonb, uuid)', 'public.office_bill_remove(uuid, text)',
    'public.office_expense_lines(uuid, date, date)',
    'public.office_notice_send(uuid, text, text, uuid, text, integer, text, boolean)', 'public.office_notice_update(uuid, text, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.office_notify_managers(uuid, text, text) from public, anon, authenticated;
revoke all on function private.office_asset_mine(uuid), private.office_object_property(text), private.office_doc_readable(text), private.office_doc_writable(text) from public, anon;
grant execute on function private.office_object_property(text), private.office_doc_readable(text), private.office_doc_writable(text) to authenticated;
