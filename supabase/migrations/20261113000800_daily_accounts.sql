-- =====================================================================
-- XZM-TEAM ERP — Migration 0008: Accounts Management → Daily Accounts (আজকের হিসাব খাতা)
--   * da_sessions            one daily account sheet per hub per date ("start today's account")
--   * da_rider_lines         rider-wise delivery / pickup / amount / due / mobile banking
--   * da_merchant_payments   merchant cash payments (screenshot + OCR, matched to merchant_payments)
--   * da_expenses            transport and hub employee expenses (bill + OCR)
--   * da_events              append-only history: start, submit, verify, correction (with snapshots)
--   * da_page_visits         who opened the sheet, when they left, how long they stayed
--   * da_hub_accountants     Accounts Manager assignment per hub
--   * da_expense_templates   expense name / category / reference / memo templates
-- Rules (enforced here, not in the UI):
--   * Uses the existing hubs, zones, employees and merchants. Nothing is copied or created there.
--   * One sheet per hub per date; a sheet is submitted once (status check + row lock).
--   * Lines change only while the sheet is open or sent back for correction. After submit a
--     change needs da.correction.edit; an approved sheet is final.
--   * The person who started or submitted a sheet cannot verify it.
--   * Rows read by OCR must be confirmed by a person before the sheet can be submitted.
--   * Mobile banking is kept separate from the due unless the configured rule says otherwise.
--   * Tables are written only through the audited functions below; nothing is deleted.
-- ACCOUNTS HOOK: nothing is posted to a ledger yet; approved sheets carry ledger_entry_id.
-- Record numbers shown to users (no) start at 1.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions and settings
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, resource, action, description)
select 'da.' || r || '.' || a, 'da', r, a, d from (values
  ('sheet','view','View daily account sheets of a hub'),
  ('sheet','create','Start, fill in and submit daily account sheets'),
  ('sheet','approve','Verify daily account sheets (approve, send back for correction, add note)'),
  ('correction','edit','Reopen a submitted daily account sheet for correction'),
  ('report','view','View daily account reports and dashboards'),
  ('report','export','Export daily account reports (Excel / PDF)'),
  ('report','print','Print daily account reports'),
  ('settings','configure','Change daily account settings, templates and Accounts Manager assignment')
) v(r, a, d);

insert into public.system_settings (key, value, description) values
  ('da.timezone',            '"Asia/Dhaka"', 'Daily accounts: time zone used for "today"'),
  ('da.start_time',          '"00:00"',      'Daily accounts: earliest local time a sheet for today can be started (HH:MM)'),
  ('da.backdate_days',       '3',            'Daily accounts: how many days back a sheet may be started'),
  ('da.session_tracking',    'true',         'Daily accounts: record page entry / exit and time spent'),
  ('da.rider_fields',        '["delivery_qty","pickup_qty","amount","paid_amount","due","mobile_banking","remarks"]',
                                             'Daily accounts: rider columns shown in the sheet'),
  ('da.due_rule',            '"manual"',     'Daily accounts: manual = due typed in; amount_minus_paid = amount − cash paid'),
  ('da.mobile_banking_rule', '"separate"',   'Daily accounts: separate | reduces_due | adds_to_due'),
  ('da.expense_categories',  '[{"code":"transport","en":"Transport","bn":"যাতায়াত"},{"code":"fuel","en":"Fuel","bn":"জ্বালানি"},{"code":"conveyance","en":"Conveyance","bn":"কনভেয়েন্স"},{"code":"meal","en":"Meal","bn":"খাবার"},{"code":"office","en":"Office","bn":"অফিস"},{"code":"repair","en":"Repair","bn":"মেরামত"},{"code":"utilities","en":"Utilities","bn":"বিল"},{"code":"other","en":"Other","bn":"অন্যান্য"}]',
                                             'Daily accounts: expense categories'),
  ('da.reference_setup',     '{"expense_prefix":"EXP","merchant_prefix":"MCP","reference_required":false}',
                                             'Daily accounts: reference number prefixes and whether a reference is required'),
  ('da.bill_upload',         '{"max_mb":10,"types":["image/jpeg","image/png","application/pdf"],"required_over":1000}',
                                             'Daily accounts: bill / screenshot upload rules; a bill is required at or above required_over'),
  ('da.ocr',                 '{"engine":"tesseract","languages":"eng+ben","min_confidence":60,"require_verification":true}',
                                             'Daily accounts: OCR settings'),
  ('da.require_assignment',  'false',        'Daily accounts: if true, only the Accounts Managers assigned to a hub verify its sheets');

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function private.da_setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.system_settings where key = p_key
$$;

create or replace function private.da_today() returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(private.setting_text('da.timezone'), 'Asia/Dhaka'))::date
$$;

create or replace function private.da_my_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.full_name from public.employees e where e.profile_id = auth.uid() and e.archived_at is null),
                  (select nullif(p.full_name, '') from public.profiles p where p.id = auth.uid()),
                  (select p.email::text from public.profiles p where p.id = auth.uid()))
$$;

create or replace function private.da_my_code() returns text
language sql stable security definer set search_path = '' as $$
  select e.employee_code::text from public.employees e where e.profile_id = auth.uid() and e.archived_at is null
$$;

-- due = (manual due | amount − paid) ± mobile banking, by the configured rules
create or replace function private.da_due(p_amount numeric, p_paid numeric, p_due numeric, p_mb numeric) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rule text := coalesce(private.setting_text('da.due_rule'), 'manual');
  v_mb   text := coalesce(private.setting_text('da.mobile_banking_rule'), 'separate');
  v numeric;
begin
  v := case when v_rule = 'amount_minus_paid' then coalesce(p_amount, 0) - coalesce(p_paid, 0) else coalesce(p_due, 0) end;
  if v_mb = 'reduces_due' then v := v - coalesce(p_mb, 0);
  elsif v_mb = 'adds_to_due' then v := v + coalesce(p_mb, 0);
  end if;
  return round(v, 2);
end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.da_sessions (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  account_date       date not null,
  status             text not null default 'open' check (status in ('open','submitted','correction','approved')),
  started_by         uuid not null,
  started_by_employee uuid references public.employees(id),
  started_by_name    text,
  started_by_code    text,
  started_at         timestamptz not null default now(),
  last_saved_at      timestamptz not null default now(),
  submitted_by       uuid,
  submitted_by_name  text,
  submitted_by_code  text,
  submitted_at       timestamptz,
  submit_note        text,
  submit_count       integer not null default 0,
  verified_by        uuid,
  verified_by_name   text,
  verified_at        timestamptz,
  verify_note        text,
  ledger_entry_id    uuid,   -- ACCOUNTS HOOK
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint da_sessions_one_per_hub_day unique (hub_id, account_date)
);
create index da_sessions_date_idx on public.da_sessions (account_date desc, status);
create index da_sessions_zone_idx on public.da_sessions (zone_id, account_date desc);

create table public.da_rider_lines (
  id              uuid primary key default gen_random_uuid(),
  no              bigint generated always as identity unique,
  session_id      uuid not null references public.da_sessions(id),
  hub_id          uuid not null references public.hubs(id),
  zone_id         uuid not null references public.zones(id),
  employee_id     uuid not null references public.employees(id),
  employee_code   text,
  rider_name      text not null,
  mobile          text,
  delivery_qty    integer not null default 0 check (delivery_qty between 0 and 100000),
  pickup_qty      integer not null default 0 check (pickup_qty between 0 and 100000),
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  paid_amount     numeric(14,2) not null default 0 check (paid_amount >= 0),
  due_input       numeric(14,2) not null default 0,
  due             numeric(14,2) not null default 0,
  mobile_banking  numeric(14,2) not null default 0 check (mobile_banking >= 0),
  remarks         text,
  removed_at      timestamptz,
  removed_by      uuid,
  remove_reason   text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint da_rider_lines_remove_chk check (removed_at is null or length(trim(coalesce(remove_reason, ''))) > 0)
);
create unique index da_rider_lines_one_per_rider on public.da_rider_lines (session_id, employee_id) where removed_at is null;
create index da_rider_lines_employee_idx on public.da_rider_lines (employee_id);

create table public.da_merchant_payments (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  session_id         uuid not null references public.da_sessions(id),
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  merchant_id        uuid not null references public.merchants(id),
  merchant_name      text not null,
  payment_ref        text,                -- Payment ID (e.g. MP-000123)
  transaction_id     text,
  amount             numeric(14,2) not null check (amount > 0),
  payment_date       date not null,
  screenshot_path    text,
  ocr                jsonb,               -- values read from the screenshot + confidence (null = typed in)
  ocr_verified       boolean not null default false,
  verified_by        uuid,
  match_status       text not null default 'unmatched' check (match_status in ('matched','mismatch','unmatched')),
  matched_payment_id uuid references public.merchant_payments(id),
  remarks            text,
  removed_at         timestamptz,
  removed_by         uuid,
  remove_reason      text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint da_mp_remove_chk check (removed_at is null or length(trim(coalesce(remove_reason, ''))) > 0),
  constraint da_mp_path_chk check (screenshot_path is null or screenshot_path like 'da/' || session_id::text || '/%')
);
create unique index da_mp_txn_unique on public.da_merchant_payments (lower(transaction_id))
  where removed_at is null and transaction_id is not null;
create index da_mp_session_idx on public.da_merchant_payments (session_id);

create table public.da_expense_templates (
  id               uuid primary key default gen_random_uuid(),
  no               bigint generated always as identity unique,
  name             text not null check (length(trim(name)) > 1),
  name_bn          text,
  category         text not null,
  reference_prefix text,
  keywords         text[] not null default '{}',
  memo_template    text,
  default_amount   numeric(14,2) check (default_amount is null or default_amount > 0),
  status           text not null default 'active' check (status in ('active','inactive')),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

create table public.da_expenses (
  id                 uuid primary key default gen_random_uuid(),
  no                 bigint generated always as identity unique,
  session_id         uuid not null references public.da_sessions(id),
  hub_id             uuid not null references public.hubs(id),
  zone_id            uuid not null references public.zones(id),
  kind               text not null check (kind in ('transport','employee')),
  employee_id        uuid references public.employees(id),
  employee_code      text,
  employee_name      text,
  expense_name       text not null check (length(trim(expense_name)) > 1),
  category           text not null,
  amount             numeric(14,2) not null check (amount > 0),
  bill_date          date not null,
  bill_no            text,
  reference_no       text,
  attachment_path    text,
  paid_by_employee   uuid references public.employees(id),
  paid_by_name       text,
  template_id        uuid references public.da_expense_templates(id),
  ocr                jsonb,
  ocr_verified       boolean not null default false,
  verified_by        uuid,
  remarks            text,
  removed_at         timestamptz,
  removed_by         uuid,
  remove_reason      text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint da_exp_remove_chk check (removed_at is null or length(trim(coalesce(remove_reason, ''))) > 0),
  constraint da_exp_path_chk check (attachment_path is null or attachment_path like 'da/' || session_id::text || '/%'),
  constraint da_exp_employee_chk check (kind <> 'employee' or employee_id is not null)
);
create unique index da_exp_reference_unique on public.da_expenses (hub_id, lower(reference_no))
  where removed_at is null and reference_no is not null;
create index da_exp_session_idx on public.da_expenses (session_id);
create index da_exp_employee_idx on public.da_expenses (employee_id);

create table public.da_events (
  id          uuid primary key default gen_random_uuid(),
  no          bigint generated always as identity unique,
  session_id  uuid not null references public.da_sessions(id),
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  actor_code  text,
  action      text not null check (action in ('started','submitted','resubmitted','approved','correction_required',
                                               'note','reopened')),
  note        text,
  snapshot    jsonb
);
create index da_events_session_idx on public.da_events (session_id, at);

create table public.da_page_visits (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.da_sessions(id),
  user_id          uuid not null,
  user_name        text,
  entered_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  left_at          timestamptz,
  duration_seconds integer generated always as
                   (greatest(0, extract(epoch from (coalesce(left_at, last_seen_at) - entered_at)))::integer) stored
);
create index da_page_visits_session_idx on public.da_page_visits (session_id, entered_at);

create table public.da_hub_accountants (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  user_id       uuid not null references public.profiles(id),
  reason        text not null check (length(trim(reason)) > 0),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create unique index da_hub_accountants_active on public.da_hub_accountants (hub_id, user_id) where revoked_at is null;

-- history rows are append-only
create or replace function private.da_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'Daily account history cannot be changed or deleted.' using errcode = 'P0001';
end $$;
create trigger da_events_append_only before update or delete on public.da_events
  for each row execute function private.da_append_only();

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------
create or replace function private.da_session_row(p_session uuid) returns public.da_sessions
language sql stable security definer set search_path = '' as $$
  select * from public.da_sessions where id = p_session
$$;

-- Can the caller change lines of this sheet right now?
create or replace function private.da_can_edit(s public.da_sessions) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.status in ('open','correction') and private.has_permission('da.sheet.create', s.zone_id, s.hub_id)
$$;

create or replace function private.da_require_edit(p_session uuid) returns public.da_sessions
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.create', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to change daily accounts of this hub.' using errcode = '42501';
  end if;
  if s.status = 'submitted' then
    raise exception 'This sheet has been submitted. Reopen it for correction first (needs correction permission).' using errcode = '42501';
  end if;
  if s.status = 'approved' then
    raise exception 'This sheet is approved and final. It cannot be changed.' using errcode = '42501';
  end if;
  update public.da_sessions set last_saved_at = now() where id = s.id;
  return s;
end $$;

-- Full sheet as JSON (used for history snapshots and the sheet screen). Runs as definer:
-- callers check access first.
create or replace function private.da_snapshot(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session', to_jsonb(s) - 'ledger_entry_id',
    'hub', jsonb_build_object('id', h.id, 'code', h.code, 'name', h.name, 'name_bn', h.name_bn),
    'zone', jsonb_build_object('id', z.id, 'code', z.code, 'name', z.name, 'name_bn', z.name_bn),
    'riders', coalesce((select jsonb_agg(to_jsonb(l) order by l.no) from public.da_rider_lines l
                        where l.session_id = s.id and l.removed_at is null), '[]'),
    'merchant_payments', coalesce((select jsonb_agg(to_jsonb(m) order by m.no) from public.da_merchant_payments m
                        where m.session_id = s.id and m.removed_at is null), '[]'),
    'expenses', coalesce((select jsonb_agg(to_jsonb(x) order by x.no) from public.da_expenses x
                        where x.session_id = s.id and x.removed_at is null), '[]'),
    'totals', jsonb_build_object(
       'riders',         (select count(*) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'delivery',       (select coalesce(sum(delivery_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'pickup',         (select coalesce(sum(pickup_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'amount',         (select coalesce(sum(amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'paid',           (select coalesce(sum(paid_amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'due',            (select coalesce(sum(due), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'mobile_banking', (select coalesce(sum(mobile_banking), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
       'merchant_cash',  (select coalesce(sum(amount), 0) from public.da_merchant_payments m where m.session_id = s.id and m.removed_at is null),
       'transport_expense', (select coalesce(sum(amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'transport'),
       'employee_expense',  (select coalesce(sum(amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'employee')))
  from public.da_sessions s
  join public.hubs h on h.id = s.hub_id
  join public.zones z on z.id = s.zone_id
  where s.id = p_session
$$;

create or replace function private.da_event(p_session uuid, p_action text, p_note text, p_snapshot boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.da_events (session_id, actor_id, actor_name, actor_code, action, note, snapshot)
  values (p_session, auth.uid(), private.da_my_name(), private.da_my_code(), p_action, nullif(trim(p_note), ''),
          case when p_snapshot then private.da_snapshot(p_session) end);
end $$;

-- Employee allowed on a hub's sheet: active, and belongs to the hub or is a rider assigned to it.
create or replace function private.da_employee_ok(p_employee uuid, p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 where e.id = p_employee and e.status = 'active' and e.archived_at is null
                   and (e.hub_id = p_hub or private.is_current_rider(e.id, p_hub)))
$$;

create or replace function private.da_find_employee(p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employees where employee_code = trim(p_code)::extensions.citext and archived_at is null
$$;

-- ---------------------------------------------------------------------
-- 1. Start today's account (আজকের হিসাব শুরু করুন)
-- ---------------------------------------------------------------------
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
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Page tracking (entry, still here, exit)
-- ---------------------------------------------------------------------
create or replace function public.da_page_enter(p_session uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_session_row(p_session); v uuid;
begin
  if s.id is null or not (private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
                          or private.has_permission('da.sheet.create', s.zone_id, s.hub_id)
                          or auth.uid() in (s.started_by, s.submitted_by)
                          or exists (select 1 from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null
                                     and l.employee_id = private.my_employee_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(private.setting_text('da.session_tracking'), 'true') <> 'true' then return null; end if;
  insert into public.da_page_visits (session_id, user_id, user_name) values (p_session, auth.uid(), private.da_my_name())
  returning id into v;
  return v;
end $$;

create or replace function public.da_page_ping(p_visit uuid, p_leaving boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.da_page_visits
     set last_seen_at = now(), left_at = case when p_leaving then now() else left_at end
   where id = p_visit and user_id = auth.uid() and left_at is null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Look-ups for auto fill
-- ---------------------------------------------------------------------
create or replace function public.da_lookup_employee(p_hub uuid, p_code text)
returns table (employee_id uuid, employee_code text, full_name text, mobile text, hub_id uuid, hub_name text,
               allowed boolean, is_rider boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not (private.has_permission('da.sheet.create', v_zone, p_hub)
                            or private.has_permission('da.sheet.view', v_zone, p_hub)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select e.id, e.employee_code::text, e.full_name, e.mobile, e.hub_id, h.name,
           private.da_employee_ok(e.id, p_hub), private.is_current_rider(e.id, p_hub)
    from public.employees e left join public.hubs h on h.id = e.hub_id
    where e.employee_code = trim(p_code)::extensions.citext and e.archived_at is null and e.status = 'active';
end $$;

-- Hub-wise employee list for the sheet (riders first)
create or replace function public.da_hub_employees(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, mobile text, is_rider boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not (private.has_permission('da.sheet.create', v_zone, p_hub)
                            or private.has_permission('da.sheet.view', v_zone, p_hub)) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select e.id, e.employee_code::text, e.full_name, e.mobile, private.is_current_rider(e.id, p_hub)
    from public.employees e
    where e.archived_at is null and e.status = 'active'
      and (e.hub_id = p_hub or private.is_current_rider(e.id, p_hub))
    order by private.is_current_rider(e.id, p_hub) desc, e.full_name;
end $$;

create or replace function public.da_lookup_merchant(p_hub uuid, p_query text)
returns table (merchant_id uuid, code text, name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select m.id, m.code::text, m.name from public.merchants m
    where m.hub_id = p_hub and m.archived_at is null and m.status = 'active'
      and (m.code = trim(p_query)::extensions.citext or m.name ilike '%' || trim(p_query) || '%')
    order by (m.code = trim(p_query)::extensions.citext) desc, m.name limit 10;
end $$;

-- Matches a Payment ID against the existing merchant payment requests of the hub
create or replace function public.da_match_payment(p_hub uuid, p_payment_ref text)
returns table (payment_id uuid, payment_no text, merchant_id uuid, merchant_name text, amount numeric, status text, payment_date date)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if v_zone is null or not private.has_permission('da.sheet.create', v_zone, p_hub) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return query
    select mp.id, mp.payment_no, mp.merchant_id, m.name, mp.amount, mp.status, mp.payment_date
    from public.merchant_payments mp join public.merchants m on m.id = mp.merchant_id
    where mp.hub_id = p_hub and upper(mp.payment_no) = upper(trim(p_payment_ref));
end $$;

-- ---------------------------------------------------------------------
-- 4. Rider-wise lines
-- ---------------------------------------------------------------------
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
    if exists (select 1 from public.da_rider_lines where session_id = s.id and employee_id = v_e and removed_at is null) then
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

-- Removes a line of any kind from an open sheet (kept, marked removed, with a reason)
create or replace function public.da_remove_line(p_kind text, p_line uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_session uuid; n int;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required.' using errcode = '22023'; end if;
  if p_kind = 'rider' then select session_id into v_session from public.da_rider_lines where id = p_line;
  elsif p_kind = 'merchant' then select session_id into v_session from public.da_merchant_payments where id = p_line;
  elsif p_kind = 'expense' then select session_id into v_session from public.da_expenses where id = p_line;
  else raise exception 'Kind must be rider, merchant or expense.' using errcode = '22023';
  end if;
  if v_session is null then raise exception 'Line not found.' using errcode = 'P0002'; end if;
  perform private.da_require_edit(v_session);
  if p_kind = 'rider' then
    update public.da_rider_lines set removed_at = now(), removed_by = auth.uid(), remove_reason = p_reason where id = p_line and removed_at is null;
  elsif p_kind = 'merchant' then
    update public.da_merchant_payments set removed_at = now(), removed_by = auth.uid(), remove_reason = p_reason where id = p_line and removed_at is null;
  else
    update public.da_expenses set removed_at = now(), removed_by = auth.uid(), remove_reason = p_reason where id = p_line and removed_at is null;
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'This line was already removed.' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Merchant cash payments
-- ---------------------------------------------------------------------
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
  v_match text := 'unmatched';
  v_id uuid;
begin
  select * into m from public.merchants where id = p_merchant and archived_at is null;
  if m.id is null or m.hub_id <> s.hub_id then raise exception 'Choose a merchant of this hub.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if p_payment_date is null or p_payment_date > private.da_today() then raise exception 'Payment date cannot be in the future.' using errcode = '22023'; end if;
  if p_transaction_id is not null and exists (select 1 from public.da_merchant_payments
       where lower(transaction_id) = lower(trim(p_transaction_id)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Transaction ID % is already recorded.', p_transaction_id using errcode = '23505';
  end if;
  if nullif(trim(p_payment_ref), '') is not null then
    select * into mp from public.merchant_payments where hub_id = s.hub_id and upper(payment_no) = upper(trim(p_payment_ref));
    if mp.id is not null then
      v_match := case when mp.merchant_id = p_merchant and mp.amount = p_amount then 'matched' else 'mismatch' end;
    end if;
  end if;
  if p_line is null then
    insert into public.da_merchant_payments (session_id, hub_id, zone_id, merchant_id, merchant_name, payment_ref, transaction_id,
      amount, payment_date, screenshot_path, ocr, ocr_verified, verified_by, match_status, matched_payment_id, remarks)
    values (s.id, s.hub_id, s.zone_id, m.id, m.name, nullif(trim(p_payment_ref), ''), nullif(trim(p_transaction_id), ''),
      p_amount, p_payment_date, p_screenshot_path, p_ocr, coalesce(p_ocr_verified, false),
      case when p_ocr_verified then auth.uid() end, v_match, mp.id, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_merchant_payments set merchant_id = m.id, merchant_name = m.name, payment_ref = nullif(trim(p_payment_ref), ''),
      transaction_id = nullif(trim(p_transaction_id), ''), amount = p_amount, payment_date = p_payment_date,
      screenshot_path = coalesce(p_screenshot_path, screenshot_path), ocr = coalesce(p_ocr, ocr),
      ocr_verified = coalesce(p_ocr_verified, false), verified_by = case when p_ocr_verified then auth.uid() end,
      match_status = v_match, matched_payment_id = mp.id, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Transport and hub employee expenses
-- ---------------------------------------------------------------------
create or replace function public.da_save_expense(
  p_session uuid, p_kind text, p_employee_code text, p_expense_name text, p_category text, p_amount numeric,
  p_bill_date date, p_bill_no text default null, p_reference_no text default null, p_attachment_path text default null,
  p_paid_by_code text default null, p_ocr jsonb default null, p_ocr_verified boolean default false,
  p_template uuid default null, p_remarks text default null, p_line uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s   public.da_sessions := private.da_require_edit(p_session);
  v_e uuid; e public.employees; v_p uuid; p public.employees;
  v_ref jsonb := coalesce(private.da_setting('da.reference_setup'), '{}');
  v_bill jsonb := coalesce(private.da_setting('da.bill_upload'), '{}');
  v_id uuid;
begin
  if p_kind not in ('transport','employee') then raise exception 'Kind must be transport or employee.' using errcode = '22023'; end if;
  if nullif(trim(p_employee_code), '') is not null then
    v_e := private.da_find_employee(p_employee_code);
    if v_e is null or not private.da_employee_ok(v_e, s.hub_id) then
      raise exception 'Employee % is not an active member of this hub.', p_employee_code using errcode = '22023';
    end if;
    select * into e from public.employees where id = v_e;
  elsif p_kind = 'employee' then
    raise exception 'An employee expense needs the Employee ID.' using errcode = '22023';
  end if;
  if nullif(trim(p_paid_by_code), '') is not null then
    v_p := private.da_find_employee(p_paid_by_code);
    if v_p is null then raise exception 'Paid-by Employee ID % was not found.', p_paid_by_code using errcode = '22023'; end if;
    select * into p from public.employees where id = v_p;
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c
                 where c ->> 'code' = p_category) then
    raise exception 'Unknown expense category %.', p_category using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero.' using errcode = '22023'; end if;
  if p_bill_date is null or p_bill_date > private.da_today() then raise exception 'Bill date cannot be in the future.' using errcode = '22023'; end if;
  if coalesce((v_ref ->> 'reference_required')::boolean, false) and nullif(trim(p_reference_no), '') is null then
    raise exception 'A reference number is required.' using errcode = '22023';
  end if;
  if p_reference_no is not null and exists (select 1 from public.da_expenses where hub_id = s.hub_id
       and lower(reference_no) = lower(trim(p_reference_no)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Reference number % is already used in this hub.', p_reference_no using errcode = '23505';
  end if;
  if p_line is null then
    insert into public.da_expenses (session_id, hub_id, zone_id, kind, employee_id, employee_code, employee_name, expense_name,
      category, amount, bill_date, bill_no, reference_no, attachment_path, paid_by_employee, paid_by_name, template_id,
      ocr, ocr_verified, verified_by, remarks)
    values (s.id, s.hub_id, s.zone_id, p_kind, v_e, e.employee_code::text, e.full_name, trim(p_expense_name), p_category,
      p_amount, p_bill_date, nullif(trim(p_bill_no), ''), nullif(trim(p_reference_no), ''), p_attachment_path,
      v_p, p.full_name, p_template, p_ocr, coalesce(p_ocr_verified, false), case when p_ocr_verified then auth.uid() end,
      nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_expenses set kind = p_kind, employee_id = v_e, employee_code = e.employee_code::text, employee_name = e.full_name,
      expense_name = trim(p_expense_name), category = p_category, amount = p_amount, bill_date = p_bill_date,
      bill_no = nullif(trim(p_bill_no), ''), reference_no = nullif(trim(p_reference_no), ''),
      attachment_path = coalesce(p_attachment_path, attachment_path), paid_by_employee = v_p, paid_by_name = p.full_name,
      template_id = p_template, ocr = coalesce(p_ocr, ocr), ocr_verified = coalesce(p_ocr_verified, false),
      verified_by = case when p_ocr_verified then auth.uid() end, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. Submit (once), reopen for correction, verify
-- ---------------------------------------------------------------------
create or replace function public.da_submit(p_session uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_req numeric := nullif(private.da_setting('da.bill_upload') ->> 'required_over', '')::numeric;
  v_ocr boolean := coalesce((private.da_setting('da.ocr') ->> 'require_verification')::boolean, true);
begin
  if not exists (select 1 from public.da_rider_lines where session_id = s.id and removed_at is null)
     and not exists (select 1 from public.da_merchant_payments where session_id = s.id and removed_at is null)
     and not exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null) then
    raise exception 'The sheet is empty. Add at least one line before submitting.' using errcode = '22023';
  end if;
  if v_ocr and (exists (select 1 from public.da_merchant_payments where session_id = s.id and removed_at is null and ocr is not null and not ocr_verified)
             or exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null and ocr is not null and not ocr_verified)) then
    raise exception 'Some values were read by OCR and have not been checked. Confirm them before submitting.' using errcode = '22023';
  end if;
  if v_req is not null and exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null
                                    and amount >= v_req and attachment_path is null) then
    raise exception 'Expenses of % taka or more need a bill or memo attached.', v_req using errcode = '22023';
  end if;
  update public.da_sessions set status = 'submitted', submitted_by = auth.uid(), submitted_by_name = private.da_my_name(),
         submitted_by_code = private.da_my_code(), submitted_at = now(), submit_note = nullif(trim(p_note), ''),
         submit_count = submit_count + 1, verified_by = null, verified_by_name = null, verified_at = null
   where id = s.id;
  perform private.da_event(s.id, case when s.submit_count > 0 then 'resubmitted' else 'submitted' end, p_note, true);
end $$;

create or replace function public.da_reopen(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.correction.edit', s.zone_id, s.hub_id) then
    raise exception 'Changing a submitted sheet needs the correction permission.' using errcode = '42501';
  end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted sheet that is not yet approved can be reopened.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.da_sessions set status = 'correction' where id = s.id;
  perform private.da_event(s.id, 'reopened', p_reason, false);
end $$;

create or replace function public.da_verify(p_session uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.approve', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to verify daily accounts of this hub.' using errcode = '42501';
  end if;
  if coalesce(private.setting_text('da.require_assignment'), 'false') = 'true' and not private.is_super_admin()
     and exists (select 1 from public.da_hub_accountants where hub_id = s.hub_id and revoked_at is null)
     and not exists (select 1 from public.da_hub_accountants where hub_id = s.hub_id and revoked_at is null and user_id = auth.uid()) then
    raise exception 'Only the Accounts Manager assigned to this hub can verify its sheets.' using errcode = '42501';
  end if;
  if auth.uid() in (s.started_by, s.submitted_by) then
    raise exception 'The person who started or submitted a sheet cannot verify it.' using errcode = '42501';
  end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted sheet can be verified.' using errcode = '22023'; end if;
  if p_action not in ('approve','correction','note') then raise exception 'Action must be approve, correction or note.' using errcode = '22023'; end if;
  if p_action in ('correction','note') and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Write what needs to be corrected or noted.' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    update public.da_sessions set status = 'approved', verified_by = auth.uid(), verified_by_name = private.da_my_name(),
           verified_at = now(), verify_note = nullif(trim(p_note), '') where id = s.id;
    perform private.da_event(s.id, 'approved', p_note, true);
  elsif p_action = 'correction' then
    update public.da_sessions set status = 'correction', verify_note = p_note where id = s.id;
    perform private.da_event(s.id, 'correction_required', p_note, false);
  else
    update public.da_sessions set verify_note = p_note where id = s.id;
    perform private.da_event(s.id, 'note', p_note, false);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Reading: sheet, dashboard, My Accounts, reports
--    These run as the caller (security invoker), so Row Level Security limits them.
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
              'can_edit', (select private.da_can_edit(s) from public.da_sessions s where s.id = p_session),
              'can_verify', (select private.has_permission('da.sheet.approve', s.zone_id, s.hub_id)
                                    and auth.uid() is distinct from s.started_by and auth.uid() is distinct from s.submitted_by
                             from public.da_sessions s where s.id = p_session),
              'can_reopen', (select private.has_permission('da.correction.edit', s.zone_id, s.hub_id) and s.status = 'submitted'
                             from public.da_sessions s where s.id = p_session))
    into v_out;
  -- riders see only their own line when they have no hub-level view
  if not exists (select 1 from public.da_sessions s where s.id = p_session
                 and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)) then
    v_out := jsonb_set(v_out, '{riders}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'riders') r
                                             where (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := jsonb_set(v_out, '{merchant_payments}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'merchant_payments') r
                                             where (r ->> 'created_by')::uuid = auth.uid()), '[]'));
    v_out := jsonb_set(v_out, '{expenses}', coalesce((select jsonb_agg(r) from jsonb_array_elements(v_out -> 'expenses') r
                                             where (r ->> 'created_by')::uuid = auth.uid()
                                                or (r ->> 'employee_id')::uuid = private.my_employee_id()), '[]'));
    v_out := v_out - 'totals' - 'visits';
  end if;
  return v_out;
end $$;

create or replace function public.da_event_snapshot(p_event uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select e.snapshot from public.da_events e where e.id = p_event
$$;

create or replace function public.da_list_sessions(p_from date, p_to date, p_hub uuid default null, p_zone uuid default null,
                                                   p_status text default null)
returns table (id uuid, no bigint, hub_id uuid, hub_name text, zone_id uuid, zone_name text, account_date date, status text,
               started_by_name text, started_at timestamptz, submitted_by_name text, submitted_at timestamptz,
               verified_by_name text, verified_at timestamptz, riders bigint, delivery bigint, pickup bigint,
               amount numeric, due numeric, mobile_banking numeric, merchant_cash numeric, expense numeric)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.no, s.hub_id, h.name, s.zone_id, z.name, s.account_date, s.status, s.started_by_name, s.started_at,
         s.submitted_by_name, s.submitted_at, s.verified_by_name, s.verified_at,
         (select count(*) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.delivery_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.pickup_qty), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.amount), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.due), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(l.mobile_banking), 0) from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null),
         (select coalesce(sum(m.amount), 0) from public.da_merchant_payments m where m.session_id = s.id and m.removed_at is null),
         (select coalesce(sum(x.amount), 0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null)
  from public.da_sessions s join public.hubs h on h.id = s.hub_id join public.zones z on z.id = s.zone_id
  where s.account_date between p_from and p_to
    and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
    and (p_status is null or s.status = p_status)
    and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
  order by s.account_date desc, h.name
$$;

create or replace function public.da_dashboard(p_from date, p_to date, p_hub uuid default null, p_zone uuid default null)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'today', private.da_today(),
    'sheets', count(*),
    'open', count(*) filter (where status = 'open'),
    'submitted', count(*) filter (where status in ('submitted','approved','correction') and submitted_at is not null),
    'pending_verification', count(*) filter (where status = 'submitted'),
    'correction', count(*) filter (where status = 'correction'),
    'approved', count(*) filter (where status = 'approved'),
    'riders', coalesce(sum(riders), 0), 'delivery', coalesce(sum(delivery), 0), 'pickup', coalesce(sum(pickup), 0),
    'amount', coalesce(sum(amount), 0), 'due', coalesce(sum(due), 0), 'mobile_banking', coalesce(sum(mobile_banking), 0),
    'merchant_cash', coalesce(sum(merchant_cash), 0), 'expense', coalesce(sum(expense), 0))
  from public.da_list_sessions(p_from, p_to, p_hub, p_zone, null)
$$;

-- My Accounts: everything that concerns the caller
create or replace function public.da_my_accounts(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (select private.my_employee_id() as emp, auth.uid() as uid)
  select jsonb_build_object(
    'employee', (select jsonb_build_object('id', e.id, 'code', e.employee_code, 'name', e.full_name, 'hub_id', e.hub_id)
                 from public.employees e, me where e.id = me.emp),
    'my_lines', coalesce((select jsonb_agg(jsonb_build_object('line', to_jsonb(l), 'account_date', s.account_date,
                          'status', s.status, 'hub', h.name, 'verify_note', s.verify_note) order by s.account_date desc)
                          from public.da_rider_lines l join public.da_sessions s on s.id = l.session_id
                          join public.hubs h on h.id = s.hub_id, me
                          where l.employee_id = me.emp and l.removed_at is null and s.account_date between p_from and p_to), '[]'),
    'my_sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'no', s.no, 'account_date', s.account_date,
                          'hub', h.name, 'status', s.status, 'submitted_at', s.submitted_at, 'verified_by_name', s.verified_by_name,
                          'verified_at', s.verified_at, 'verify_note', s.verify_note,
                          'started_by_me', s.started_by = me.uid, 'submitted_by_me', s.submitted_by = me.uid) order by s.account_date desc)
                          from public.da_sessions s join public.hubs h on h.id = s.hub_id, me
                          where (s.started_by = me.uid or s.submitted_by = me.uid) and s.account_date between p_from and p_to), '[]'),
    'my_expenses', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('account_date', s.account_date, 'status', s.status) order by x.bill_date desc)
                          from public.da_expenses x join public.da_sessions s on s.id = x.session_id, me
                          where x.removed_at is null and (x.employee_id = me.emp or x.created_by = me.uid)
                            and s.account_date between p_from and p_to), '[]'),
    'my_payments', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('account_date', s.account_date, 'status', s.status) order by m.payment_date desc)
                          from public.da_merchant_payments m join public.da_sessions s on s.id = m.session_id, me
                          where m.removed_at is null and m.created_by = me.uid and s.account_date between p_from and p_to), '[]'),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('at', ev.at, 'action', ev.action, 'note', ev.note, 'by', ev.actor_name,
                          'account_date', s.account_date, 'hub', h.name, 'session_id', s.id) order by ev.at desc)
                          from public.da_events ev join public.da_sessions s on s.id = ev.session_id join public.hubs h on h.id = s.hub_id, me
                          where ev.action in ('correction_required','note','approved')
                            and s.account_date between p_from and p_to
                            and (s.started_by = me.uid or s.submitted_by = me.uid
                                 or exists (select 1 from public.da_rider_lines l where l.session_id = s.id and l.employee_id = me.emp and l.removed_at is null))), '[]'))
$$;

-- Reports. p_kind: hub_daily | rider | employee_expense | merchant_payment | transport_expense |
--                  verification | pending | corrections
create or replace function public.da_report(p_kind text, p_from date, p_to date, p_hub uuid default null, p_zone uuid default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  if not (private.has_permission('da.report.view', p_zone, p_hub)
          or exists (select 1 from private.my_grants() g where g.permission_code = 'da.report.view' or g.is_super)) then
    raise exception 'Not authorised to view daily account reports.' using errcode = '42501';
  end if;
  if p_kind = 'hub_daily' then
    select coalesce(jsonb_agg(to_jsonb(l)), '[]') into v from public.da_list_sessions(p_from, p_to, p_hub, p_zone, null) l;
  elsif p_kind = 'pending' then
    select coalesce(jsonb_agg(to_jsonb(l)), '[]') into v from public.da_list_sessions(p_from, p_to, p_hub, p_zone, 'submitted') l;
  elsif p_kind = 'rider' then
    select coalesce(jsonb_agg(r order by r ->> 'rider_name'), '[]') into v from (
      select jsonb_build_object('employee_code', l.employee_code, 'rider_name', l.rider_name, 'mobile', max(l.mobile),
             'hub', h.name, 'days', count(distinct s.account_date), 'delivery', sum(l.delivery_qty), 'pickup', sum(l.pickup_qty),
             'amount', sum(l.amount), 'paid', sum(l.paid_amount), 'due', sum(l.due), 'mobile_banking', sum(l.mobile_banking)) r
      from public.da_rider_lines l join public.da_sessions s on s.id = l.session_id join public.hubs h on h.id = s.hub_id
      where l.removed_at is null and s.account_date between p_from and p_to
        and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
        and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
      group by l.employee_code, l.rider_name, h.name) q;
  elsif p_kind in ('employee_expense','transport_expense') then
    select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('account_date', s.account_date, 'hub', h.name, 'status', s.status)
                              order by s.account_date desc, x.no), '[]') into v
    from public.da_expenses x join public.da_sessions s on s.id = x.session_id join public.hubs h on h.id = s.hub_id
    where x.removed_at is null and x.kind = case when p_kind = 'employee_expense' then 'employee' else 'transport' end
      and s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
      and private.has_permission('da.sheet.view', s.zone_id, s.hub_id);
  elsif p_kind = 'merchant_payment' then
    select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('account_date', s.account_date, 'hub', h.name, 'status', s.status)
                              order by s.account_date desc, m.no), '[]') into v
    from public.da_merchant_payments m join public.da_sessions s on s.id = m.session_id join public.hubs h on h.id = s.hub_id
    where m.removed_at is null and s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub)
      and (p_zone is null or s.zone_id = p_zone) and private.has_permission('da.sheet.view', s.zone_id, s.hub_id);
  elsif p_kind in ('verification','corrections') then
    select coalesce(jsonb_agg(jsonb_build_object('no', e.no, 'at', e.at, 'action', e.action, 'note', e.note, 'by', e.actor_name,
                              'by_code', e.actor_code, 'session_no', s.no, 'account_date', s.account_date, 'hub', h.name)
                              order by e.at desc), '[]') into v
    from public.da_events e join public.da_sessions s on s.id = e.session_id join public.hubs h on h.id = s.hub_id
    where s.account_date between p_from and p_to and (p_hub is null or s.hub_id = p_hub) and (p_zone is null or s.zone_id = p_zone)
      and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
      and e.action = any (case when p_kind = 'verification' then array['approved','correction_required','note']
                               else array['correction_required','reopened','resubmitted'] end);
  else
    raise exception 'Unknown report %.', p_kind using errcode = '22023';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 9. Settings, templates, Accounts Manager assignment
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
  elsif p_key in ('da.reference_setup','da.bill_upload','da.ocr') and jsonb_typeof(p_value) <> 'object' then
    raise exception 'This setting must be an object.' using errcode = '22023';
  end if;
  update public.system_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform private.write_audit('CONFIGURE', 'da', 'system_settings', p_key, null, jsonb_build_object(p_key, p_value));
end $$;

create or replace function public.da_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- readable by every signed-in user: riders need the field list and rules for My Accounts
  select coalesce(jsonb_object_agg(key, value), '{}') from public.system_settings
  where key like 'da.%' and auth.uid() is not null
$$;

create or replace function public.da_save_template(
  p_name text, p_category text, p_reference_prefix text default null, p_keywords text[] default '{}',
  p_memo_template text default null, p_default_amount numeric default null, p_name_bn text default null,
  p_status text default 'active', p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not private.has_permission('da.settings.configure') then
    raise exception 'Not authorised to change expense templates.' using errcode = '42501';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(private.da_setting('da.expense_categories'), '[]')) c where c ->> 'code' = p_category) then
    raise exception 'Unknown expense category %.', p_category using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.da_expense_templates (name, name_bn, category, reference_prefix, keywords, memo_template, default_amount, status)
    values (trim(p_name), p_name_bn, p_category, nullif(trim(p_reference_prefix), ''), coalesce(p_keywords, '{}'), p_memo_template, p_default_amount, p_status)
    returning id into v;
  else
    update public.da_expense_templates set name = trim(p_name), name_bn = p_name_bn, category = p_category,
      reference_prefix = nullif(trim(p_reference_prefix), ''), keywords = coalesce(p_keywords, '{}'), memo_template = p_memo_template,
      default_amount = p_default_amount, status = p_status where id = p_id returning id into v;
    if v is null then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

create or replace function public.da_assign_accountant(p_hub uuid, p_user uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_zone uuid := private.hub_zone(p_hub);
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_zone is null then raise exception 'Hub not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active' and archived_at is null) then
    raise exception 'The user is not active.' using errcode = '22023';
  end if;
  insert into public.da_hub_accountants (hub_id, zone_id, user_id, reason) values (p_hub, v_zone, p_user, p_reason) returning id into v;
  return v;
end $$;

create or replace function public.da_revoke_accountant(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.da_hub_accountants set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where id = p_id and revoked_at is null;
  if not found then raise exception 'Assignment not found or already revoked.' using errcode = 'P0002'; end if;
end $$;

-- Hubs the caller can work with in Daily Accounts (for hub pickers)
create or replace function public.da_my_hubs()
returns table (hub_id uuid, code text, name text, name_bn text, zone_id uuid, zone_name text,
               can_view boolean, can_submit boolean, can_verify boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, h.code::text, h.name, h.name_bn, z.id, z.name,
         private.has_permission('da.sheet.view', z.id, h.id), private.has_permission('da.sheet.create', z.id, h.id),
         private.has_permission('da.sheet.approve', z.id, h.id)
  from public.hubs h join public.zones z on z.id = h.zone_id
  where h.archived_at is null and h.status = 'active'
    and (private.has_permission('da.sheet.view', z.id, h.id) or private.has_permission('da.sheet.create', z.id, h.id))
  order by z.name, h.name
$$;

-- People who can verify (for the Accounts Manager assignment screen)
create or replace function public.da_verifier_candidates()
returns table (user_id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  return query
    select distinct pr.id, coalesce(nullif(pr.full_name, ''), pr.email::text), pr.email::text
    from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles pr on pr.id = ur.user_id
    where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date) and pr.status = 'active'
      and (r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                                 where rp.role_id = r.id and p.code = 'da.sheet.approve'))
    order by 2;
end $$;

-- Who can work on a hub's daily accounts (for the settings screen)
create or replace function public.da_hub_access(p_hub uuid)
returns table (user_id uuid, full_name text, role_name text, scope_type text, can_submit boolean, can_verify boolean, can_correct boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := private.hub_zone(p_hub);
begin
  if not private.has_permission('da.settings.configure') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  return query
    select pr.id, coalesce(nullif(pr.full_name, ''), pr.email::text), r.name, ur.scope_type,
           r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id and p.code = 'da.sheet.create'),
           r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id and p.code = 'da.sheet.approve'),
           r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id and p.code = 'da.correction.edit')
    from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles pr on pr.id = ur.user_id
    where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date) and pr.status = 'active'
      and (ur.scope_type = 'global' or ur.zone_id = v_zone or ur.hub_id = p_hub)
      and (r.is_super or exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                                 where rp.role_id = r.id and p.module = 'da'))
    order by pr.full_name;
end $$;

-- ---------------------------------------------------------------------
-- Stamp / audit / no-delete
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['da_sessions','da_rider_lines','da_merchant_payments','da_expenses','da_hub_accountants','da_expense_templates'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(''da'')', t || '_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger da_events_audit after insert on public.da_events for each row execute function private.audit_row('da');
create trigger da_page_visits_no_delete before delete on public.da_page_visits for each row execute function private.prevent_delete();

-- ---------------------------------------------------------------------
-- Row Level Security (reads only; every write goes through the functions above)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['da_sessions','da_rider_lines','da_merchant_payments','da_expenses','da_events',
                           'da_page_visits','da_hub_accountants','da_expense_templates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

create policy da_sessions_read on public.da_sessions for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id)
         or started_by = auth.uid() or submitted_by = auth.uid()
         or exists (select 1 from public.da_rider_lines l where l.session_id = da_sessions.id and l.employee_id = private.my_employee_id()
                    and l.removed_at is null));
create policy da_rider_lines_read on public.da_rider_lines for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or employee_id = private.my_employee_id() or created_by = auth.uid());
create policy da_merchant_payments_read on public.da_merchant_payments for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or created_by = auth.uid());
create policy da_expenses_read on public.da_expenses for select to authenticated
  using (private.has_permission('da.sheet.view', zone_id, hub_id) or created_by = auth.uid()
         or employee_id = private.my_employee_id());
create policy da_events_read on public.da_events for select to authenticated
  using (exists (select 1 from public.da_sessions s where s.id = session_id));
create policy da_page_visits_read on public.da_page_visits for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.da_sessions s where s.id = session_id
                                         and private.has_permission('da.sheet.view', s.zone_id, s.hub_id)));
create policy da_hub_accountants_read on public.da_hub_accountants for select to authenticated
  using (user_id = auth.uid() or private.has_permission('da.sheet.view', zone_id, hub_id)
         or private.has_permission('da.settings.configure'));
create policy da_expense_templates_read on public.da_expense_templates for select to authenticated
  using (exists (select 1 from private.my_grants() g where g.permission_code like 'da.%' or g.is_super));

-- ---------------------------------------------------------------------
-- Storage: private bucket for screenshots and bills (only on Supabase)
-- Path: da/<session_id>/<uuid>-<file name>. File access = access to the sheet.
-- ---------------------------------------------------------------------
create or replace function private.da_can_read_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and (private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
                               or private.has_permission('da.sheet.create', s.zone_id, s.hub_id));
end $$;

create or replace function private.da_can_upload_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  if p_name !~ '^da/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  s := private.da_session_row(split_part(p_name, '/', 2)::uuid);
  return s.id is not null and private.da_can_edit(s);
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'buckets') then
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('da-evidence', 'da-evidence', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
             on conflict (id) do nothing$q$;
    execute $q$create policy da_evidence_read on storage.objects for select to authenticated
             using (bucket_id = 'da-evidence' and private.da_can_read_object(name))$q$;
    execute $q$create policy da_evidence_upload on storage.objects for insert to authenticated
             with check (bucket_id = 'da-evidence' and private.da_can_upload_object(name))$q$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'da\_%'
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
join public.permissions p on p.module = 'da' and (
     r.code = 'admin'
  or (r.code = 'accounts_manager' and p.code in ('da.sheet.view','da.sheet.approve','da.correction.edit','da.report.view',
                                                 'da.report.export','da.report.print','da.settings.configure'))
  or (r.code = 'accountant' and p.code in ('da.sheet.view','da.sheet.create','da.report.view','da.report.export','da.report.print'))
  or (r.code in ('head_office_manager','auditor','operations_manager') and p.code in ('da.sheet.view','da.report.view','da.report.export','da.report.print'))
  or (r.code = 'zonal_manager' and p.code in ('da.sheet.view','da.correction.edit','da.report.view','da.report.export','da.report.print'))
  or (r.code = 'hub_manager' and p.code in ('da.sheet.view','da.sheet.create','da.report.view','da.report.print'))
)
on conflict do nothing;
