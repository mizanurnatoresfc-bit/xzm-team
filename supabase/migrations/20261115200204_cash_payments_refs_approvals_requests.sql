-- Applied on the live database from another chat on 15 Nov 2026 and copied here unchanged on 16 Nov 2026,
-- so the repository matches the live database (supabase_migrations.schema_migrations, version 20261115200204).

-- ============================================================
-- আজকের হিসাব খাতা · ধাপ ২
-- হাব ক্যাশ পেমেন্ট, রেফারেন্স (নাম·পদবি·নম্বর), স্টাফ-ওয়াইজ অ্যাপ্রুভাল,
-- রাইডারের খরচের রিকুয়েস্ট (ট্রান্সপোর্ট ব্রেকডাউন), ক্যাটাগরি সাজেশন,
-- ফুল চেক, রিপোর্ট টেক্সট, রিমাইন্ডার
-- ============================================================

-- ---------- সাধারণ: কারা জোনাল অ্যাপ্রুভার ----------
create or replace function private.da_approvers(p_zone uuid, p_hub uuid) returns setof uuid
language sql stable security definer set search_path = public, private, pg_temp as $$
  select distinct ur.user_id
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.code = 'da.sheet.approve' and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date)
    and (ur.scope_type = 'global' or (ur.scope_type = 'zone' and ur.zone_id = p_zone) or (ur.scope_type = 'hub' and ur.hub_id = p_hub))
$$;

-- ============================================================
-- ১. কাকে ক্যাশ পেমেন্ট দেওয়া যায় (অ্যাডমিন লিস্ট)
-- ============================================================
create table if not exists public.da_payees (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references public.zones(id),
  hub_id uuid references public.hubs(id),
  name text not null check (length(trim(name)) > 1),
  name_bn text,
  kind text not null default 'merchant' check (kind in ('merchant','rider_advance','hub','zone_office','other')),
  phone text,
  merchant_code text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists da_payees_zone_idx on public.da_payees (zone_id, status);
alter table public.da_payees enable row level security;
drop policy if exists da_payees_read on public.da_payees;
create policy da_payees_read on public.da_payees for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or private.has_permission('da.sheet.create', zone_id, hub_id));

create or replace function public.da_payee_save(p_name text, p_kind text default 'merchant', p_zone uuid default null, p_hub uuid default null,
  p_phone text default null, p_merchant_code text default null, p_name_bn text default null, p_status text default 'active', p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_id uuid; v_zone uuid := coalesce(p_zone, private.hub_zone(p_hub));
begin
  if not private.has_permission('da.settings.configure', v_zone, p_hub) then raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.da_payees (zone_id, hub_id, name, name_bn, kind, phone, merchant_code, status)
    values (v_zone, p_hub, trim(p_name), nullif(trim(p_name_bn),''), p_kind, nullif(trim(p_phone),''), nullif(trim(p_merchant_code),''), p_status) returning id into v_id;
  else
    update public.da_payees set name = trim(p_name), name_bn = nullif(trim(p_name_bn),''), kind = p_kind, phone = nullif(trim(p_phone),''),
      merchant_code = nullif(trim(p_merchant_code),''), status = p_status, updated_at = now(), updated_by = auth.uid()
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- ============================================================
-- ২. হাব ক্যাশ পেমেন্ট
-- ============================================================
create sequence if not exists public.da_cash_payment_no_seq;
create table if not exists public.da_cash_payments (
  id uuid primary key default gen_random_uuid(),
  no bigint not null default nextval('public.da_cash_payment_no_seq'),
  session_id uuid not null references public.da_sessions(id),
  hub_id uuid not null references public.hubs(id),
  zone_id uuid not null references public.zones(id),
  collector_user uuid references public.profiles(id),
  payee_id uuid references public.da_payees(id),
  payee_name text not null,
  payment_ref text,
  amount numeric not null check (amount > 0),
  screenshot_path text,
  ocr jsonb,
  ocr_verified boolean not null default false,
  source text not null default 'manual' check (source in ('manual','screenshot','paste')),
  note text,
  removed_at timestamptz, removed_by uuid, remove_reason text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists da_cash_payments_session_idx on public.da_cash_payments (session_id) where removed_at is null;
create unique index if not exists da_cash_payments_ref_uq on public.da_cash_payments (hub_id, payment_ref) where removed_at is null and payment_ref is not null;
alter table public.da_cash_payments enable row level security;
drop policy if exists da_cash_payments_read on public.da_cash_payments;
create policy da_cash_payments_read on public.da_cash_payments for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or created_by = (select auth.uid()));
drop trigger if exists da_cash_payments_no_delete on public.da_cash_payments;
create trigger da_cash_payments_no_delete before delete on public.da_cash_payments for each row execute function private.da_append_only();

create or replace function public.da_cash_payment_save(p_session uuid, p_amount numeric, p_payee uuid default null, p_payee_name text default null,
  p_payment_ref text default null, p_screenshot_path text default null, p_ocr jsonb default null, p_ocr_verified boolean default false,
  p_source text default 'manual', p_note text default null, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions := private.da_require_edit(p_session); v_name text; v_ref text := private.da_payment_ref(p_payment_ref); v_id uuid;
begin
  if p_payee is not null then
    select coalesce(name_bn, name) into v_name from public.da_payees where id = p_payee and status = 'active';
    if v_name is null then raise exception 'এই নাম লিস্টে নেই — অ্যাডমিন যোগ করবেন।' using errcode = '22023'; end if;
  else
    v_name := nullif(trim(p_payee_name), '');
    if v_name is null then raise exception 'কাকে দেওয়া হলো — লিস্ট থেকে বাছুন।' using errcode = '22023'; end if;
  end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'টাকা শূন্যের বেশি হতে হবে।' using errcode = '22023'; end if;
  if v_ref is not null and exists (select 1 from public.da_cash_payments where hub_id = s.hub_id and payment_ref = v_ref and removed_at is null and id is distinct from p_id) then
    raise exception 'পেমেন্ট আইডি % আগেই খাতায় আছে।', v_ref using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.da_cash_payments (session_id, hub_id, zone_id, collector_user, payee_id, payee_name, payment_ref, amount, screenshot_path, ocr, ocr_verified, source, note)
    values (s.id, s.hub_id, s.zone_id, auth.uid(), p_payee, v_name, v_ref, p_amount, p_screenshot_path, p_ocr, coalesce(p_ocr_verified,false), coalesce(p_source,'manual'), nullif(trim(p_note),''))
    returning id into v_id;
    perform private.da_event(s.id, 'note', 'ক্যাশ পেমেন্ট: ' || v_name || ' ৳' || p_amount::text || coalesce(' · ' || v_ref, ''), false);
  else
    update public.da_cash_payments set payee_id = p_payee, payee_name = v_name, payment_ref = v_ref, amount = p_amount,
      screenshot_path = coalesce(p_screenshot_path, screenshot_path), ocr = coalesce(p_ocr, ocr), ocr_verified = coalesce(p_ocr_verified, ocr_verified),
      note = nullif(trim(p_note),''), updated_at = now(), updated_by = auth.uid()
    where id = p_id and session_id = s.id and removed_at is null and (collector_user = auth.uid() or private.has_permission('da.sheet.approve', s.zone_id, s.hub_id))
    returning id into v_id;
    if v_id is null then raise exception 'লাইন পাওয়া যায়নি বা আপনার খাতার নয়।' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.da_cash_payment_remove(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare x public.da_cash_payments; s public.da_sessions;
begin
  select * into x from public.da_cash_payments where id = p_id and removed_at is null for update;
  if x.id is null then raise exception 'লাইন পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  s := private.da_require_edit(x.session_id);
  if x.collector_user <> auth.uid() and not private.has_permission('da.sheet.approve', s.zone_id, s.hub_id) then raise exception 'আপনার খাতার লাইন নয়।' using errcode = '42501'; end if;
  update public.da_cash_payments set removed_at = now(), removed_by = auth.uid(), remove_reason = coalesce(nullif(trim(p_reason),''), 'মুছে ফেলা') where id = p_id;
  perform private.da_event(s.id, 'note', 'ক্যাশ পেমেন্ট বাদ: ' || x.payee_name || ' ৳' || x.amount::text || ' · ' || coalesce(p_reason,''), false);
end $$;

-- ============================================================
-- ৩. রেফারেন্স: নাম · পদবি · নম্বর (+ জোনের প্যানেল আইডি)
-- ============================================================
create table if not exists public.da_reference_people (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references public.zones(id),
  hub_id uuid references public.hubs(id),
  name text not null check (length(trim(name)) > 1),
  position text,
  phone text,
  profile_id uuid references public.profiles(id),   -- জোনের কারো প্যানেল আইডি হলে এখানে
  employee_id uuid references public.employees(id),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table public.da_reference_people enable row level security;
drop policy if exists da_reference_people_read on public.da_reference_people;
create policy da_reference_people_read on public.da_reference_people for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or private.has_permission('da.sheet.create', zone_id, hub_id));

-- পুরনো সেটিং থেকে একবার টেনে আনা
insert into public.da_reference_people (name, position, phone)
select trim(r ->> 'name'), nullif(trim(r ->> 'position'),''), nullif(trim(r ->> 'phone'),'')
from jsonb_array_elements(coalesce((select value from public.system_settings where key = 'da.reference_people'), '[]'::jsonb)) r
where not exists (select 1 from public.da_reference_people p where p.name = trim(r ->> 'name'));

create or replace function public.da_reference_save(p_name text, p_position text default null, p_phone text default null, p_profile uuid default null,
  p_employee uuid default null, p_zone uuid default null, p_hub uuid default null, p_status text default 'active', p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_id uuid; v_zone uuid := coalesce(p_zone, private.hub_zone(p_hub)); v_profile uuid := p_profile;
begin
  if not private.has_permission('da.settings.configure', v_zone, p_hub) then raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  if v_profile is null and p_employee is not null then select profile_id into v_profile from public.employees where id = p_employee; end if;
  if p_id is null then
    insert into public.da_reference_people (zone_id, hub_id, name, position, phone, profile_id, employee_id, status)
    values (v_zone, p_hub, trim(p_name), nullif(trim(p_position),''), nullif(trim(p_phone),''), v_profile, p_employee, p_status) returning id into v_id;
  else
    update public.da_reference_people set name = trim(p_name), position = nullif(trim(p_position),''), phone = nullif(trim(p_phone),''),
      profile_id = v_profile, employee_id = p_employee, status = p_status, updated_at = now(), updated_by = auth.uid() where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- ============================================================
-- ৪. খরচে নতুন ঘর: রেফারেন্স লিংক, ট্রান্সপোর্ট ব্রেকডাউন, অ্যাপ্রুভাল
-- ============================================================
alter table public.da_expenses
  add column if not exists reference_person_id uuid references public.da_reference_people(id),
  add column if not exists transport_breakdown jsonb,
  add column if not exists approval_status text not null default 'approved' check (approval_status in ('approved','pending','rejected')),
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

create table if not exists public.da_approval_rules (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references public.zones(id),
  hub_id uuid references public.hubs(id),
  user_id uuid references public.profiles(id),
  position_id uuid references public.positions(id),
  self_limit numeric not null default 0 check (self_limit >= 0),   -- এত টাকা পর্যন্ত নিজে অ্যাপ্রুভ
  transport_breakdown_required boolean not null default true,
  note text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid,
  check (user_id is not null or position_id is not null or (user_id is null and position_id is null))
);
alter table public.da_approval_rules enable row level security;
drop policy if exists da_approval_rules_read on public.da_approval_rules;
create policy da_approval_rules_read on public.da_approval_rules for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or private.has_permission('da.sheet.create', zone_id, hub_id));

-- ডিফল্ট: কোনো নিয়ম না থাকলে সীমাহীন (আগের মতো); থাকলে সবচেয়ে নির্দিষ্টটা
create or replace function private.da_self_limit(p_user uuid, p_zone uuid, p_hub uuid) returns numeric
language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce((
    select r.self_limit from public.da_approval_rules r
    left join public.employees e on e.profile_id = p_user and e.archived_at is null
    where r.status = 'active'
      and (r.user_id = p_user or (r.user_id is null and r.position_id is not null and r.position_id = e.position_id) or (r.user_id is null and r.position_id is null))
      and (r.hub_id is null or r.hub_id = p_hub) and (r.zone_id is null or r.zone_id = p_zone)
    order by (r.user_id is not null) desc, (r.position_id is not null) desc, (r.hub_id is not null) desc, (r.zone_id is not null) desc
    limit 1), 'Infinity'::numeric)
$$;

create or replace function public.da_approval_rule_save(p_self_limit numeric, p_user uuid default null, p_position uuid default null,
  p_zone uuid default null, p_hub uuid default null, p_breakdown_required boolean default true, p_note text default null, p_status text default 'active', p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_id uuid;
begin
  if not private.has_permission('da.settings.configure', p_zone, p_hub) then raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.da_approval_rules (zone_id, hub_id, user_id, position_id, self_limit, transport_breakdown_required, note, status)
    values (p_zone, p_hub, p_user, p_position, p_self_limit, p_breakdown_required, p_note, p_status) returning id into v_id;
  else
    update public.da_approval_rules set self_limit = p_self_limit, user_id = p_user, position_id = p_position, zone_id = p_zone, hub_id = p_hub,
      transport_breakdown_required = p_breakdown_required, note = p_note, status = p_status, updated_at = now(), updated_by = auth.uid() where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- নতুন খরচ ঢুকলে: সীমার বেশি → pending + জোনাল অ্যাপ্রুভারদের নোটিফিকেশন; রেফারেন্স জোনের আইডি হলে → তার প্যানেলে
create or replace function private.da_expense_after_insert() returns trigger
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_limit numeric; v_ref public.da_reference_people; v_u uuid;
begin
  v_limit := private.da_self_limit(coalesce(new.created_by, auth.uid()), new.zone_id, new.hub_id);
  if new.amount > v_limit then
    update public.da_expenses set approval_status = 'pending' where id = new.id;
    for v_u in select * from private.da_approvers(new.zone_id, new.hub_id) loop
      perform private.notify(v_u, 'খরচ অ্যাপ্রুভাল দরকার', new.expense_name || ' · ৳' || new.amount::text || ' (সীমা ৳' || v_limit::text || ')', '/accounts/approvals', 'da_expense_approval');
    end loop;
  end if;
  if new.reference_person_id is not null then
    select * into v_ref from public.da_reference_people where id = new.reference_person_id;
    if v_ref.profile_id is not null then
      perform private.notify(v_ref.profile_id, 'আপনার রেফারেন্সে খরচ', new.expense_name || ' · ৳' || new.amount::text || ' · ' || coalesce(new.remarks,''), '/accounts/referenced', 'da_expense_reference');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists da_expenses_after_insert on public.da_expenses;
create trigger da_expenses_after_insert after insert on public.da_expenses for each row execute function private.da_expense_after_insert();

-- খরচের বাড়তি ঘর সেট করা (রেফারেন্স লিংক, ব্রেকডাউন) — da_save_expense-এর পরে ডাকা হবে
create or replace function public.da_expense_set_extra(p_line uuid, p_reference_person uuid default null, p_breakdown jsonb default null)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare x public.da_expenses; s public.da_sessions; r public.da_reference_people;
begin
  select * into x from public.da_expenses where id = p_line and removed_at is null for update;
  if x.id is null then raise exception 'খরচ পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  s := private.da_require_edit(x.session_id);
  if p_reference_person is not null then
    select * into r from public.da_reference_people where id = p_reference_person and status = 'active';
    if r.id is null then raise exception 'রেফারেন্স লিস্টে নেই।' using errcode = '22023'; end if;
    update public.da_expenses set reference_person_id = r.id, reference_name = r.name, reference_phone = r.phone, reference_position = r.position where id = x.id;
    if r.profile_id is not null and x.reference_person_id is distinct from r.id then
      perform private.notify(r.profile_id, 'আপনার রেফারেন্সে খরচ', x.expense_name || ' · ৳' || x.amount::text || ' · ' || coalesce(x.remarks,''), '/accounts/referenced', 'da_expense_reference');
    end if;
  end if;
  if p_breakdown is not null then update public.da_expenses set transport_breakdown = p_breakdown where id = x.id; end if;
end $$;

create or replace function public.da_expense_approve(p_expense uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare x public.da_expenses;
begin
  select * into x from public.da_expenses where id = p_expense and removed_at is null for update;
  if x.id is null then raise exception 'খরচ পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.approve', x.zone_id, x.hub_id) then raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  if not p_approve and nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'বাতিলের কারণ লিখুন।' using errcode = '22023'; end if;
  update public.da_expenses set approval_status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now(), approval_note = nullif(trim(p_note),'') where id = x.id;
  perform private.da_event(x.session_id, 'note', 'খরচ ' || case when p_approve then 'অ্যাপ্রুভ' else 'বাতিল' end || ': ' || x.expense_name || ' ৳' || x.amount::text || coalesce(' · ' || p_note, ''), false);
  perform private.notify(x.created_by, case when p_approve then 'খরচ অ্যাপ্রুভ হয়েছে' else 'খরচ বাতিল' end, x.expense_name || ' ৳' || x.amount::text || coalesce(' · ' || p_note,''), '/accounts/today', 'da_expense_approval');
end $$;

create or replace function public.da_pending_approvals(p_zone uuid default null, p_hub uuid default null)
returns jsonb language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'date', s.account_date, 'hub', h.name, 'name', x.expense_name, 'category', x.category, 'amount', x.amount,
    'by', x.created_by, 'reference', x.reference_name, 'remarks', x.remarks, 'bill', x.attachment_path is not null, 'voucher', x.voucher_no, 'breakdown', x.transport_breakdown) order by s.account_date desc, x.no), '[]'::jsonb)
  from public.da_expenses x join public.da_sessions s on s.id = x.session_id join public.hubs h on h.id = x.hub_id
  where x.removed_at is null and x.approval_status = 'pending'
    and (p_zone is null or x.zone_id = p_zone) and (p_hub is null or x.hub_id = p_hub)
    and private.has_permission('da.sheet.approve', x.zone_id, x.hub_id)
$$;

-- ============================================================
-- ৫. রাইডারের খরচের রিকুয়েস্ট (বিদ্যমান da_expense_claims-এর ওপর)
-- ============================================================
alter table public.da_expense_claims
  add column if not exists to_user uuid references public.profiles(id),
  add column if not exists transport_breakdown jsonb;

create or replace function public.da_request_expense(p_to_user uuid, p_expense_name text, p_category text, p_amount numeric,
  p_kind text default 'employee', p_attachment_path text default null, p_breakdown jsonb default null, p_remarks text default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare e public.employees; v_id uuid; v_cat text := p_category; v_req boolean;
begin
  select * into e from public.employees where id = private.my_employee_id();
  if e.id is null then raise exception 'শুধু কর্মীরা খরচের রিকুয়েস্ট পাঠাতে পারে।' using errcode = '42501'; end if;
  if v_cat is null or v_cat = '' then v_cat := coalesce(public.da_suggest_category(p_expense_name), 'other'); end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = v_cat) then
    raise exception 'ক্যাটাগরি % পাওয়া যায়নি।', v_cat using errcode = '22023'; end if;
  select coalesce(bool_or(transport_breakdown_required), true) into v_req from public.da_approval_rules where status = 'active' and (zone_id is null or zone_id = e.zone_id);
  if (v_cat = 'transport' or p_kind = 'transport') and v_req and (p_breakdown is null or p_breakdown = '{}'::jsonb) then
    raise exception 'ট্রান্সপোর্ট খরচে ব্রেকডাউন দিন (কোথা থেকে, কোথায়, বাহন, ট্রিপ)।' using errcode = '22023'; end if;
  if p_to_user is not null and not exists (select 1 from public.da_sheet_collectors c join public.da_sessions s on s.id = c.session_id
       where s.hub_id = e.hub_id and s.account_date = private.da_today() and c.user_id = p_to_user and c.closed_at is null) then
    raise exception 'এই ম্যানেজারের খাতা আজ খোলা নেই।' using errcode = '22023'; end if;
  insert into public.da_expense_claims (employee_id, employee_code, employee_name, hub_id, zone_id, kind, expense_name, category, amount, bill_date,
    attachment_path, remarks, to_user, transport_breakdown)
  values (e.id, e.employee_code::text, e.full_name, e.hub_id, e.zone_id, case when p_kind in ('transport','employee') then p_kind else 'employee' end,
    trim(p_expense_name), v_cat, p_amount, private.da_today(), p_attachment_path, nullif(trim(p_remarks),''), p_to_user, p_breakdown)
  returning id into v_id;
  perform private.notify(p_to_user, 'খরচের রিকুয়েস্ট', e.full_name || ': ' || trim(p_expense_name) || ' ৳' || p_amount::text, '/accounts/today', 'da_expense_request');
  return v_id;
end $$;

-- ম্যানেজার: আমার খাতার জন্য আসা রিকুয়েস্ট
create or replace function public.da_my_expense_requests(p_session uuid)
returns jsonb language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'no', c.no, 'employee', c.employee_name, 'code', c.employee_code, 'name', c.expense_name, 'category', c.category,
    'amount', c.amount, 'bill', c.attachment_path is not null, 'breakdown', c.transport_breakdown, 'remarks', c.remarks, 'at', c.created_at) order by c.created_at), '[]'::jsonb)
  from public.da_expense_claims c join public.da_sessions s on s.id = p_session
  where c.status = 'submitted' and c.hub_id = s.hub_id and (c.to_user = auth.uid() or c.to_user is null)
    and private.has_permission('da.sheet.create', s.zone_id, s.hub_id)
$$;

-- da_claim_add: ব্রেকডাউন সাথে নিয়ে যাও
create or replace function public.da_claim_add(p_claim uuid, p_session uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare c public.da_expense_claims; s public.da_sessions := private.da_require_edit(p_session); v_expense uuid; v_date date;
begin
  select * into c from public.da_expense_claims where id = p_claim for update;
  if c.id is null then raise exception 'রিকুয়েস্ট পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if c.status <> 'submitted' then raise exception 'এই রিকুয়েস্টের সিদ্ধান্ত আগেই হয়েছে।' using errcode = '22023'; end if;
  if c.hub_id <> s.hub_id then raise exception 'এটা অন্য হাবের রিকুয়েস্ট।' using errcode = '22023'; end if;
  v_date := case when coalesce(private.setting_text('da.claim_date_source'), 'sheet') = 'sheet' then s.account_date else c.bill_date end;
  insert into public.da_expenses (session_id, hub_id, zone_id, kind, employee_id, employee_code, employee_name,
    expense_name, category, amount, bill_date, bill_no, reference_no, reference_name, reference_phone,
    reference_position, vehicle_id, remarks, claim_id, claim_file, attachment_path, transport_breakdown)
  values (s.id, s.hub_id, s.zone_id, c.kind, c.employee_id, c.employee_code, c.employee_name,
    c.expense_name, c.category, c.amount, v_date, c.bill_no, c.reference_no, c.reference_name,
    c.reference_phone, c.reference_position, c.vehicle_id,
    nullif(trim(coalesce(c.remarks, '')
      || case when c.transport_breakdown is not null then ' · ' || coalesce(c.transport_breakdown->>'from','') || '→' || coalesce(c.transport_breakdown->>'to','') || ', ' || coalesce(c.transport_breakdown->>'vehicle','') || ', ' || coalesce(c.transport_breakdown->>'trips','1') || ' ট্রিপ' else '' end
      || case when v_date <> c.bill_date then ' · বিলের তারিখ ' || to_char(c.bill_date, 'DD/MM/YYYY') else '' end
      || case when p_note is not null then ' · ' || trim(p_note) else '' end), ''),
    c.id, c.attachment_path, c.attachment_path, c.transport_breakdown)
  returning id into v_expense;
  if c.attachment_path is null then perform public.da_make_voucher(v_expense); end if;
  update public.da_expense_claims set status = 'added', session_id = s.id, expense_id = v_expense, reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '') where id = p_claim;
  perform private.da_event(s.id, 'note', 'রিকুয়েস্ট ' || c.no::text || ' খাতায়: ' || c.expense_name || ' (' || c.employee_name || ')', false);
  perform private.notify(e.profile_id, 'খরচ অ্যাপ্রুভ', c.expense_name || ' ৳' || c.amount::text || ' খাতায় উঠেছে।', '/me/accounts', 'da_expense_request') from public.employees e where e.id = c.employee_id and e.profile_id is not null;
  return v_expense;
end $$;

-- ============================================================
-- ৬. ক্যাটাগরি সাজেশন (নাম লিখলেই)
-- ============================================================
insert into public.system_settings (key, value, description) values ('da.category_keywords', '{
 "bank_charge":["ব্যাংক","চার্জ","bank"],
 "meal":["লাঞ্চ","খাবার","নাস্তা","ভাত","lunch"],
 "cleaning":["ঝাড়ু","মপ","ক্লিনার","টিস্যু","হ্যান্ডওয়াশ","ময়লা","হারপিক"],
 "entertainment":["চা","মিটিং","অতিথি","আপ্যায়ন"],
 "festival_bonus":["বোনাস","ঈদ"],
 "fuel":["ফুয়েল","তেল","অকটেন","পেট্রোল","গ্যাস","fuel"],
 "hr_treatment":["ডাক্তার","ওষুধ","চিকিৎসা","হাসপাতাল"],
 "internet":["ইন্টারনেট","ওয়াইফাই","ব্রডব্যান্ড","ডেটা","wifi"],
 "labour_wages":["লেবার","শ্রমিক","লোডিং","আনলোডিং"],
 "vehicle_parts":["পার্টস","টায়ার","ব্রেক","চেইন","ব্যাটারি"],
 "office":["মালামাল","টেবিল","চেয়ার","ফ্যান","লাইট","তালা"],
 "office_rent":["ভাড়া","হাব ভাড়া","বাসা ভাড়া","rent"],
 "others_rental":["গ্যারেজ","পার্কিং","অটো চার্জ"],
 "conveyance":["জোনাল","অডিট","ডিভিশনাল"],
 "penalties":["মামলা","জরিমানা","রেকার","ট্রাফিক"],
 "stationery":["পলিব্যাগ","টেপ","মার্কার","কলম","খাতা","কাগজ","প্রিন্ট","ফটোকপি","স্টিকার","পলি"],
 "repair":["সার্ভিসিং","মেরামত","রিপেয়ার","চার্জার","মিস্ত্রি"],
 "salary_wages":["বেতন","ওভারটাইম","স্যালারি"],
 "telephone":["রিচার্জ","মোবাইল","সিম","ফোন"],
 "toll":["টোল","সেতু","ব্রিজ"],
 "transport":["রিকশা","ভ্যান","অটো ভাড়া","পার্সেল","ব্যাকআপ","যাতায়াত","সিএনজি","বাস","ডেলিভারি"],
 "utilities":["বিদ্যুৎ","কারেন্ট","পানি","ইউটিলিটি"],
 "wrong_delivery":["ভুল ডেলিভারি","রিটার্ন","পার্সেল সমস্যা"]
}'::jsonb, 'খরচের নামে এই শব্দ থাকলে কোন ক্যাটাগরি সাজেস্ট হবে (code → keywords)')
on conflict (key) do update set value = excluded.value;

create or replace function public.da_suggest_category(p_text text) returns text
language sql stable security definer set search_path = public, private, pg_temp as $$
  with kw as (
    select k.key as code, lower(v.value) as word
    from jsonb_each(coalesce(private.da_setting('da.category_keywords'), '{}'::jsonb)) k, jsonb_array_elements_text(k.value) v
    union all
    select t.category, lower(w) from public.da_expense_templates t, unnest(t.keywords) w where t.status = 'active'
  )
  select code from kw where lower(coalesce(p_text,'')) like '%' || word || '%' order by length(word) desc limit 1
$$;

-- ============================================================
-- ৭. ফুল চেক: প্যানেলের পার্স করা সারি খাতার সাথে মেলানো
--    rows: [{"code":"3","delivery":34,"pickup":20,"amount":52998},{"payment_ref":"SFC-33241663","amount":33680}]
-- ============================================================
create or replace function public.da_reconcile(p_session uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions; v_mine boolean;
begin
  select * into s from public.da_sessions where id = p_session;
  if s.id is null then raise exception 'খাতা পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if not (private.has_permission('da.sheet.view', s.zone_id, s.hub_id) or private.has_permission('da.sheet.create', s.zone_id, s.hub_id)) then raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  v_mine := not private.has_permission('da.sheet.view', s.zone_id, s.hub_id);   -- শুধু create থাকলে নিজের খাতার সাথে মেলাও
  return (
    with rows as (select r, row_number() over () i from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r),
    riders as (
      select l.employee_code as code, sum(l.delivery_qty) d, sum(l.pickup_qty) p, sum(l.amount) a
      from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)
        and (not v_mine or l.collector_user = auth.uid()) group by l.employee_code),
    pays as (select c.payment_ref ref, sum(c.amount) a from public.da_cash_payments c where c.session_id = s.id and c.removed_at is null and (not v_mine or c.collector_user = auth.uid()) group by c.payment_ref),
    out as (
      select i, case when r ? 'payment_ref' then 'payment' else 'rider' end kind,
        coalesce(r->>'payment_ref', r->>'code') key,
        case when r ? 'payment_ref' then
          case when p.ref is null then 'missing' when p.a = (r->>'amount')::numeric then 'match' else 'mismatch' end
        else
          case when x.code is null then 'missing'
               when x.d = coalesce((r->>'delivery')::int, x.d) and x.p = coalesce((r->>'pickup')::int, x.p) and x.a = coalesce((r->>'amount')::numeric, x.a) then 'match' else 'mismatch' end end as result,
        jsonb_build_object('delivery', x.d, 'pickup', x.p, 'amount', coalesce(x.a, p.a)) as ours, r as theirs
      from rows left join riders x on not (r ? 'payment_ref') and x.code = trim(r->>'code')
                left join pays p on (r ? 'payment_ref') and p.ref = private.da_payment_ref(r->>'payment_ref'))
    select jsonb_build_object('match', count(*) filter (where result='match'), 'mismatch', count(*) filter (where result='mismatch'), 'missing', count(*) filter (where result='missing'),
      'rows', coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'key', key, 'result', result, 'ours', ours, 'theirs', theirs) order by i), '[]'::jsonb))
    from out);
end $$;

-- ============================================================
-- ৮. রিপোর্ট টেক্সট (Facebook/WhatsApp-এ পেস্ট করার মতো)
-- ============================================================
create or replace function public.da_report_text(p_session uuid) returns text
language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions; h public.hubs; t text; v numeric;
begin
  select * into s from public.da_sessions where id = p_session;
  if s.id is null then raise exception 'খাতা পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if not private.has_permission('da.report.view', s.zone_id, s.hub_id) then raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  select * into h from public.hubs where id = s.hub_id;
  t := coalesce(h.name_bn, h.name) || ' — ' || to_char(s.account_date, 'DD/MM/YYYY') || E'\n\nরাইডার হিসাব:\n';
  select t || coalesce(string_agg(r.rider_name || ' (#' || r.employee_code || '): ডেলি ' || r.d || ' · পিক ' || r.p || ' · ৳' || r.a, E'\n' order by r.employee_code), '—') into t
  from (select rider_name, employee_code, sum(delivery_qty) d, sum(pickup_qty) p, sum(amount) a from public.da_rider_lines where session_id = s.id and removed_at is null and (source='manager' or accepted_at is not null) group by 1,2) r;
  select t || E'\nমোট: ডেলি ' || coalesce(sum(delivery_qty),0) || ' · পিক ' || coalesce(sum(pickup_qty),0) || ' · ৳' || coalesce(sum(amount),0) into t from public.da_rider_lines where session_id = s.id and removed_at is null and (source='manager' or accepted_at is not null);
  select t || E'\n\nখরচ: ৳' || coalesce(sum(amount),0) || E'\n' || coalesce(string_agg('- ' || expense_name || ' ৳' || amount || case when attachment_path is not null then ' [বিল]' else ' [ভাউচার ' || coalesce(voucher_no,'-') || ']' end, E'\n' order by no), '—') into t from public.da_expenses where session_id = s.id and removed_at is null;
  select t || E'\n\nক্যাশ পেমেন্ট: ৳' || coalesce(sum(amount),0) || E'\n' || coalesce(string_agg('- ' || payee_name || ' ' || coalesce(payment_ref,'') || ' ৳' || amount, E'\n' order by no), '—') into t from public.da_cash_payments where session_id = s.id and removed_at is null;
  select t || E'\n\nডেইলি রিপোর্ট: ' || coalesce(string_agg(report_no || ' ৳' || amount, ', ' order by no), '—') into t from public.da_report_ids where session_id = s.id and removed_at is null;
  select t || E'\nব্যাংক জমা: ৳' || coalesce(sum(amount),0) || coalesce(' (' || max(bank_name) || ')', '') into t from public.da_deposits where session_id = s.id and removed_at is null;
  return t;
end $$;

-- ============================================================
-- ৯. রিমাইন্ডার: খাতা খোলা / জমা হয়নি
-- ============================================================
create or replace function public.da_remind_open() returns integer
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_now time := (now() at time zone coalesce(private.setting_text('da.timezone'), 'Asia/Dhaka'))::time;
        v_close time := coalesce(nullif(private.setting_text('da.close_time'),'')::time, '21:00'::time); n int := 0; r record; v_u uuid;
begin
  if v_now < v_close then return 0; end if;
  -- আজ যাদের খাতা এখনো খোলা (একই ঘণ্টায় একবারই)
  for r in select c.user_id, c.name, s.id sid, h.name hub from public.da_sheet_collectors c join public.da_sessions s on s.id = c.session_id join public.hubs h on h.id = s.hub_id
           where s.account_date = private.da_today() and c.closed_at is null and s.status in ('open','correction')
             and not exists (select 1 from public.notifications nt where nt.profile_id = c.user_id and nt.kind = 'da_reminder' and nt.created_at > now() - interval '55 minutes')
  loop
    insert into public.notifications (profile_id, title, body, link, kind) values (r.user_id, 'আজকের খাতা এখনো খোলা', r.hub || ' — "হিসাব নেওয়া শেষ" দিন, নইলে হাবের রিপোর্ট জমা হবে না।', '/accounts/today', 'da_reminder');
    n := n + 1;
  end loop;
  -- যে হাবের আজকের রিপোর্ট জমা হয়নি → জোনাল অ্যাপ্রুভার (রাতে একবার)
  for r in select s.id sid, s.zone_id, s.hub_id, h.name hub from public.da_sessions s join public.hubs h on h.id = s.hub_id
           where s.account_date = private.da_today() and s.status in ('open','correction') and v_now >= v_close + interval '2 hours'
  loop
    for v_u in select * from private.da_approvers(r.zone_id, r.hub_id) loop
      if not exists (select 1 from public.notifications nt where nt.profile_id = v_u and nt.kind = 'da_reminder_zone' and nt.body like r.hub || '%' and nt.created_at::date = current_date) then
        insert into public.notifications (profile_id, title, body, link, kind) values (v_u, 'হাবের রিপোর্ট জমা হয়নি', r.hub || ' — আজকের হিসাব এখনো জমা পড়েনি।', '/accounts', 'da_reminder_zone'); n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.da_remind_open() from public, anon, authenticated;
select cron.unschedule(jobname) from cron.job where jobname = 'da-remind-open';
select cron.schedule('da-remind-open', '*/15 * * * *', $$select public.da_remind_open()$$);

-- ============================================================
-- ১০. স্ন্যাপশট/শিটে ক্যাশ পেমেন্ট যুক্ত
-- ============================================================
create or replace function private.da_snapshot(p_session uuid) returns jsonb
language sql stable security definer set search_path = public, private, pg_temp as $$
  select jsonb_build_object(
    'session', to_jsonb(s) - 'ledger_entry_id',
    'hub', jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name, 'name_bn', h.name_bn),
    'zone', jsonb_build_object('id', z.id, 'code', z.code, 'name', z.name, 'name_bn', z.name_bn),
    'riders', coalesce((select jsonb_agg(to_jsonb(l) order by l.no) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null), '[]'),
    'merchant_payments', coalesce((select jsonb_agg(to_jsonb(m) order by m.no) from public.da_merchant_payments m where m.session_id = s.id and m.removed_at is null), '[]'),
    'cash_payments', coalesce((select jsonb_agg(to_jsonb(c) order by c.no) from public.da_cash_payments c where c.session_id = s.id and c.removed_at is null), '[]'),
    'expenses', coalesce((select jsonb_agg(to_jsonb(x) order by x.no) from public.da_expenses x where x.session_id = s.id and x.removed_at is null), '[]'),
    'totals', jsonb_build_object(
       'riders',         (select count(distinct employee_id) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
       'delivery',       (select coalesce(sum(delivery_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
       'pickup',         (select coalesce(sum(pickup_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
       'amount',         (select coalesce(sum(amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
       'paid',           (select coalesce(sum(paid_amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
       'due',            (select coalesce(sum(due), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
       'mobile_banking', (select coalesce(sum(mobile_banking), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
       'awaiting_accept',(select count(*) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null and l.source='rider' and l.accepted_at is null),
       'merchant_cash',  (select coalesce(sum(amount), 0) from public.da_merchant_payments m where m.session_id = s.id and m.removed_at is null),
       'cash_payments',  (select coalesce(sum(amount), 0) from public.da_cash_payments c where c.session_id = s.id and c.removed_at is null),
       'transport_expense', (select coalesce(sum(amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'transport'),
       'employee_expense',  (select coalesce(sum(amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'employee'),
       'expense',        (select coalesce(sum(amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null),
       'report_ids',     (select coalesce(sum(amount), 0) from public.da_report_ids r where r.session_id = s.id and r.removed_at is null),
       'deposit',        (select coalesce(sum(amount), 0) from public.da_deposits d where d.session_id = s.id and d.removed_at is null)))
  from public.da_sessions s join public.hubs h on h.id = s.hub_id join public.zones z on z.id = s.zone_id where s.id = p_session
$$;

-- da_sheet: ক্যাশ পেমেন্ট ও রিকুয়েস্ট অন্যের থেকে লুকানো (শুধু create পারমিশনে নিজেরটা)
create or replace function public.da_sheet(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.da_sessions where id = p_session) then raise exception 'খাতা পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  select private.da_snapshot(p_session)
         || jsonb_build_object(
              'events', coalesce((select jsonb_agg(to_jsonb(e) - 'snapshot' || jsonb_build_object('has_snapshot', e.snapshot is not null) order by e.at) from public.da_events e where e.session_id = p_session), '[]'),
              'visits', coalesce((select jsonb_agg(to_jsonb(v) order by v.entered_at desc) from public.da_page_visits v where v.session_id = p_session), '[]'),
              'collectors', coalesce((select jsonb_agg(to_jsonb(c) order by c.closed_at nulls first, c.created_at) from public.da_collectors(p_session) c), '[]'),
              'notes_in', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.da_cash_notes n where n.session_id = p_session and n.removed_at is null), '[]'),
              'report_ids', coalesce((select jsonb_agg(to_jsonb(r) order by r.no) from public.da_report_ids r where r.session_id = p_session and r.removed_at is null), '[]'),
              'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.no) from public.da_deposits d where d.session_id = p_session and d.removed_at is null), '[]'),
              'cells', coalesce((select jsonb_agg(jsonb_build_object('section', c.section, 'row_id', c.row_id, 'col', c.col_key, 'value', c.value)) from public.da_cells c where c.session_id = p_session), '[]'),
              'expense_requests', public.da_my_expense_requests(p_session),
              'pending_riders', public.da_pending_riders(p_session),
              'me', auth.uid(),
              'can_edit', (select private.da_can_edit(s) from public.da_sessions s where s.id = p_session),
              'can_verify', (select private.has_permission('da.sheet.approve', s.zone_id, s.hub_id) and auth.uid() is distinct from s.started_by and auth.uid() is distinct from s.submitted_by from public.da_sessions s where s.id = p_session),
              'can_reopen', (select private.has_permission('da.correction.edit', s.zone_id, s.hub_id) and s.status = 'submitted' from public.da_sessions s where s.id = p_session),
              'can_layout', private.has_permission('da.settings.configure'))
    into v_out;
  if not exists (select 1 from public.da_sessions s where s.id = p_session and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)) then
    v_out := jsonb_set(v_out, '{riders}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'riders') r where (r ->> 'employee_id')::uuid = private.my_employee_id() or (r ->> 'collector_user')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{merchant_payments}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'merchant_payments') r where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{cash_payments}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'cash_payments') r where (r ->> 'collector_user')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{expenses}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'expenses') r where (r ->> 'created_by')::uuid = auth.uid() or (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{notes_in}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'notes_in') r where (r ->> 'created_by')::uuid = auth.uid() or (r ->> 'from_employee')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{report_ids}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'report_ids') r where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{deposits}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'deposits') r where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := v_out - 'totals' - 'visits' - 'cells';
  end if;
  return v_out;
end $$;

-- ---------- grants ----------
grant execute on function
  public.da_payee_save(text,text,uuid,uuid,text,text,text,text,uuid),
  public.da_cash_payment_save(uuid,numeric,uuid,text,text,text,jsonb,boolean,text,text,uuid),
  public.da_cash_payment_remove(uuid,text),
  public.da_reference_save(text,text,text,uuid,uuid,uuid,uuid,text,uuid),
  public.da_approval_rule_save(numeric,uuid,uuid,uuid,uuid,boolean,text,text,uuid),
  public.da_expense_set_extra(uuid,uuid,jsonb),
  public.da_expense_approve(uuid,boolean,text),
  public.da_pending_approvals(uuid,uuid),
  public.da_request_expense(uuid,text,text,numeric,text,text,jsonb,text),
  public.da_my_expense_requests(uuid),
  public.da_suggest_category(text),
  public.da_reconcile(uuid,jsonb),
  public.da_report_text(uuid)
to authenticated;
revoke execute on function
  public.da_payee_save(text,text,uuid,uuid,text,text,text,text,uuid),
  public.da_cash_payment_save(uuid,numeric,uuid,text,text,text,jsonb,boolean,text,text,uuid),
  public.da_cash_payment_remove(uuid,text),
  public.da_reference_save(text,text,text,uuid,uuid,uuid,uuid,text,uuid),
  public.da_approval_rule_save(numeric,uuid,uuid,uuid,uuid,boolean,text,text,uuid),
  public.da_expense_set_extra(uuid,uuid,jsonb),
  public.da_expense_approve(uuid,boolean,text),
  public.da_pending_approvals(uuid,uuid),
  public.da_request_expense(uuid,text,text,numeric,text,text,jsonb,text),
  public.da_my_expense_requests(uuid),
  public.da_suggest_category(text),
  public.da_reconcile(uuid,jsonb),
  public.da_report_text(uuid)
from anon;
