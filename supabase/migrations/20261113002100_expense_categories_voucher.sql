-- =====================================================================
-- XZM-TEAM ERP — Migration 0021: the company's expense categories + expense vouchers
--
--  * da.expense_categories now carries the company's own list (the categories
--    handbook): what belongs in each category, and what to do with it on the
--    main site — its category there, the sub-head, the limit, whether a receipt
--    is needed, or that it does not go to the main site at all. Head Office can
--    change every line of this from Accounts settings.
--  * An expense whose shop or payee gave no bill can be given a voucher number
--    (da_make_voucher) and printed as the company's own voucher. Nothing is
--    generated on its own: a person asks for it, and an expense that already has
--    a bill does not get one.
-- =====================================================================

update public.system_settings
   set value = '[
  {"code":"bank_charge","en":"Bank Charge","bn":"ব্যাংক চার্জ",
   "note_bn":"ব্যাংক ডিপোজিট চার্জ বাবদ খরচ।",
   "site_name":"Bank Charge","site_sub":"Bank Fee","site_limit":500,"site_receipt":true},
  {"code":"meal","en":"Canteen Expense","bn":"ক্যান্টিন খরচ",
   "note_bn":"ড্রাইভার-হেল্পারের লাঞ্চ বিল বাবদ।",
   "site_name":"Canteen Expense","site_sub":"Canteen","site_limit":105000,"site_receipt":true},
  {"code":"cleaning","en":"Cleaning & Sanitation","bn":"পরিচ্ছন্নতা",
   "note_bn":"ঝাড়ু, মপ, ফ্লোর ক্লিনার, টয়লেট ক্লিনার, হারপিক, হ্যান্ডওয়াশ, টিস্যু, ময়লার ব্যাগ ও পরিচ্ছন্নতার সামগ্রী।",
   "site_name":"Cleaning & Sanitation","site_sub":"Cleaning","site_limit":500,"site_receipt":true},
  {"code":"entertainment","en":"Entertainment","bn":"আপ্যায়ন",
   "note_bn":"অতিথি/ক্লায়েন্ট আপ্যায়ন, অফিসিয়াল মিটিংয়ের চা-নাশতা এবং অনুমোদিত অফিসিয়াল অনুষ্ঠান।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"festival_bonus","en":"Festival Bonus","bn":"উৎসব বোনাস",
   "note_bn":"ঈদ বোনাস বাবদ খরচ।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"fuel","en":"Fuel Cost","bn":"জ্বালানি",
   "note_bn":"অফিসের গাড়ি ফুয়েল বাবদ খরচ।",
   "site_name":"Fuel Cost","site_sub":"Vehicle Fuel Cost","site_limit":null,"site_receipt":true},
  {"code":"hr_treatment","en":"H.R Treatment","bn":"চিকিৎসা",
   "note_bn":"কর্মীদের চিকিৎসা খরচ, ডাক্তার ফি, ওষুধ ও অনুমোদিত মেডিকেল বিল; প্রতিষ্ঠানের HR নীতিমালা অনুযায়ী।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"internet","en":"Internet Bill","bn":"ইন্টারনেট বিল",
   "note_bn":"অফিসের ব্রডব্যান্ড বিল, ইন্টারনেট প্যাকেজ ও অফিসিয়াল ডেটা কানেকশন।",
   "site_name":"Internet Bill","site_sub":"Internet Bill","site_limit":1500,"site_receipt":true},
  {"code":"labour_wages","en":"Labour Wages","bn":"শ্রমিক মজুরি",
   "note_bn":"দৈনিক মজুরিভিত্তিক/অস্থায়ী শ্রমিকের মজুরি, লোডিং-আনলোডিং শ্রমিকের পারিশ্রমিক।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"vehicle_parts","en":"Motor Vehicle Parts","bn":"গাড়ির পার্টস",
   "note_bn":"শুধু মাত্র গাড়ি সার্ভিসিং এর জন্য যে সকল পার্টস ক্রয় বা ফিটিং করা বাবদ খরচ।",
   "site_name":"Motor Vehicle Parts","site_sub":"Parts","site_limit":null,"site_receipt":true},
  {"code":"office","en":"Office And Hub Material","bn":"অফিস ও হাব মালামাল",
   "note_bn":"অফিস ও হাবের মালামাল কেনা বাবদ খরচ।",
   "site_name":"Office And Hub Material","site_sub":"Hub Material","site_limit":null,"site_receipt":true},
  {"code":"office_rent","en":"Office Rent","bn":"অফিস ভাড়া",
   "note_bn":"অফিস/হাব ভাড়া, রাইডার-ম্যানেজারদের বাসা ভাড়া এবং অফিসের অগ্রিম বা জামানত বাবদ খরচ।",
   "site_name":"Office Rent","site_sub":"Office Rent","site_limit":null,"site_receipt":true},
  {"code":"others_rental","en":"Others Rental Expense","bn":"অন্যান্য ভাড়া",
   "note_bn":"গ্যারেজ ভাড়া, অটো চার্জ বা গাড়ি পার্কিং বাবদ খরচ।",
   "site_name":"Others Rental Expense","site_sub":"Others Rental Expense","site_limit":null,"site_receipt":true},
  {"code":"conveyance","en":"Others Transport Cost","bn":"অন্যান্য ট্রান্সপোর্ট",
   "note_bn":"জোনাল/ডিভিশনাল বা অডিট এর যাবতীয় লাঞ্চ এবং ট্রান্সপোর্ট খরচ।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"penalties","en":"Penalties Motor Vehicle","bn":"গাড়ির জরিমানা",
   "note_bn":"গাড়ি/অটো ট্রাফিক মামলা বা অনুমোদিত জরিমানা বা পুলিশ রেকার বিল ইত্যাদি।",
   "site_name":"Penalties Motor Vehicle","site_sub":"Vehicle Mamla Purpose","site_limit":null,"site_receipt":true},
  {"code":"stationery","en":"Printing & Stationery","bn":"ছাপা ও স্টেশনারি",
   "note_bn":"কাগজ, কলম, খাতা, ফাইল, খাম, প্রিন্ট/ফটোকপি, টোনার ও প্রিন্টার কালি।",
   "site_name":"Printing & Stationery","site_sub":"Stationery","site_limit":null,"site_receipt":true},
  {"code":"repair","en":"Repairs And Maintenance","bn":"মেরামত ও রক্ষণাবেক্ষণ",
   "note_bn":"অফিসের অটো সার্ভিসিং, অফিসের বাইক সার্ভিসিং এবং গাড়ির ছোটখাটো মেরামত/রক্ষণাবেক্ষণ খরচ।",
   "site_name":"Repairs And Maintenance","site_sub":"Repairs And Maintenance","site_limit":null,"site_receipt":true},
  {"code":"salary_wages","en":"Salary & Wages","bn":"বেতন ও মজুরি",
   "note_bn":"নিয়মিত কর্মীদের মাসিক বেতন, নিয়মিত মজুরি, অনুমোদিত ওভারটাইম ও বেতন-সংশ্লিষ্ট পরিশোধ।",
   "site_name":"Salary & Wages","site_sub":"Salary /Wages","site_limit":null,"site_receipt":true},
  {"code":"telephone","en":"Telephone Bill","bn":"টেলিফোন বিল",
   "note_bn":"অফিসের মোবাইল/ল্যান্ডফোন বিল, সিম রিচার্জ ও অফিসিয়াল কল চার্জ।",
   "site_name":null,"site_note_bn":"মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"},
  {"code":"toll","en":"Toll Cost","bn":"টোল",
   "note_bn":"টোল প্লাজা, সেতু ও এক্সপ্রেসওয়ের অনুমোদিত টোল ফি।",
   "site_name":"Toll Cost","site_sub":"Toll Cost","site_limit":130000,"site_receipt":true},
  {"code":"transport","en":"Transport","bn":"যাতায়াত",
   "note_bn":"পার্সেল ডেলিভারি, ব্যাকআপ রাইডার এবং ম্যানেজার যাতায়াত বাবদ খরচ।",
   "site_name":"Transport","site_sub":"All Hub","site_limit":3000,"site_receipt":true},
  {"code":"utilities","en":"Utility Bill","bn":"ইউটিলিটি বিল",
   "note_bn":"বিদ্যুৎ, পানি, গ্যাস এবং অফিসের অন্যান্য ইউটিলিটি বিল।",
   "site_name":"Utility Bill","site_sub":"Utility Bill","site_limit":30000,"site_receipt":true},
  {"code":"wrong_delivery","en":"Wrong Delivery (Parcel Problem)","bn":"ভুল ডেলিভারি (পার্সেল সমস্যা)",
   "note_bn":"ভুল ডেলিভারি বা পার্সেল সমস্যার কারণে যে খরচ হয়।",
   "site_name":"Wrong Delivery (Parcel Problem)","site_sub":"Wrong Delivery (Parcel Problem)","site_limit":null,"site_receipt":true},
  {"code":"other","en":"Miscellaneous Expenses","bn":"বিবিধ খরচ",
   "note_bn":"উপরের কোনোটিতে না পড়লে এখানে দিন — বিবরণে খরচের আসল নাম লিখুন।",
   "site_name":"Miscellaneous Expenses","site_sub":"Miscellaneous Expenses","site_limit":null,"site_receipt":true}
]'::jsonb,
       description = 'Daily accounts: expense categories — what belongs in each, and what to do with it on the main site'
 where key = 'da.expense_categories';

-- ---------------------------------------------------------------------
-- The company's own voucher, for an expense with no bill from the payee
-- ---------------------------------------------------------------------
alter table public.da_expenses add column if not exists voucher_no text;
create unique index if not exists da_expenses_voucher_uq
  on public.da_expenses (lower(voucher_no)) where voucher_no is not null;
create sequence if not exists public.da_voucher_seq;

create or replace function public.da_make_voucher(p_expense uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  x public.da_expenses%rowtype;
  s public.da_sessions;
  v_no text;
begin
  select * into x from public.da_expenses where id = p_expense and removed_at is null for update;
  if x.id is null then raise exception 'Expense line not found.' using errcode = 'P0002'; end if;
  s := private.da_require_edit(x.session_id);
  if x.voucher_no is not null then return x.voucher_no; end if;
  if x.attachment_path is not null or nullif(trim(coalesce(x.bill_no, '')), '') is not null then
    raise exception 'This expense already has a bill, so it needs no voucher.' using errcode = '22023';
  end if;
  v_no := 'V-' || to_char(private.da_today(), 'YYMM') || '-' || lpad(nextval('public.da_voucher_seq')::text, 5, '0');
  update public.da_expenses set voucher_no = v_no where id = p_expense;
  perform private.da_event(x.session_id, 'note', 'Voucher ' || v_no || ' made for expense: ' || x.expense_name, false);
  return v_no;
end $$;

-- Everything a printed voucher shows, read as the person themselves.
create or replace function public.da_voucher(p_expense uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_out jsonb;
begin
  select jsonb_build_object(
    'voucher_no', x.voucher_no, 'expense_no', x.no, 'amount', x.amount, 'bill_date', x.bill_date,
    'expense_name', x.expense_name, 'category', x.category, 'kind', x.kind, 'remarks', x.remarks,
    'employee_code', x.employee_code, 'employee_name', x.employee_name,
    'paid_by_name', x.paid_by_name, 'reference_no', x.reference_no,
    'hub', h.name, 'hub_code', h.code::text, 'zone', z.name,
    'account_date', s.account_date, 'sheet_no', s.no,
    'made_by', coalesce(p.full_name, p.email::text), 'made_at', now())
    into v_out
  from public.da_expenses x
  join public.da_sessions s on s.id = x.session_id
  join public.hubs h on h.id = x.hub_id
  join public.zones z on z.id = x.zone_id
  left join public.profiles p on p.id = auth.uid()
  where x.id = p_expense and x.removed_at is null;
  if v_out is null then raise exception 'Expense line not found.' using errcode = 'P0002'; end if;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.da_make_voucher(uuid)', 'public.da_voucher(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant usage on sequence public.da_voucher_seq to authenticated;

-- ---------------------------------------------------------------------
-- A merchant cash payment from the Payment ID alone
--
-- The screenshot of the main site's payment page carries the Payment ID and the
-- amount, so those two are all a person has to put in. The merchant, the payee
-- and the date come from the hub's own payment record for that Payment ID. When
-- no such record exists the merchant must still be chosen by hand, because a
-- payment with nobody against it is not a record worth keeping.
-- ---------------------------------------------------------------------
alter table public.da_merchant_payments alter column merchant_id drop not null;
alter table public.da_merchant_payments add column if not exists payee_name text;

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
  v_date date := p_payment_date;
  v_name text;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be greater than zero.' using errcode = '22023';
  end if;

  -- the hub's own record for this Payment ID fills in the rest
  if nullif(trim(p_payment_ref), '') is not null then
    select * into mp from public.merchant_payments
     where hub_id = s.hub_id and upper(payment_no) = upper(trim(p_payment_ref));
  end if;

  if p_merchant is not null then
    select * into m from public.merchants where id = p_merchant and archived_at is null;
    if m.id is null or m.hub_id <> s.hub_id then
      raise exception 'Choose a merchant of this hub.' using errcode = '22023';
    end if;
  elsif mp.id is not null then
    select * into m from public.merchants where id = mp.merchant_id;
  else
    raise exception 'This Payment ID has no record in this hub, so choose the merchant by hand.' using errcode = '22023';
  end if;

  v_date := coalesce(v_date, mp.payment_date, s.account_date);
  if v_date > private.da_today() then
    raise exception 'Payment date cannot be in the future.' using errcode = '22023';
  end if;
  v_name := coalesce(m.name, mp.merchant_id::text, '—');

  if p_transaction_id is not null and exists (select 1 from public.da_merchant_payments
       where lower(transaction_id) = lower(trim(p_transaction_id)) and removed_at is null and id is distinct from p_line) then
    raise exception 'Transaction ID % is already recorded.', p_transaction_id using errcode = '23505';
  end if;
  if mp.id is not null then
    v_match := case when mp.merchant_id = m.id and mp.amount = p_amount then 'matched' else 'mismatch' end;
  end if;

  if p_line is null then
    insert into public.da_merchant_payments (session_id, hub_id, zone_id, merchant_id, merchant_name, payee_name, payment_ref, transaction_id,
      amount, payment_date, screenshot_path, ocr, ocr_verified, verified_by, match_status, matched_payment_id, remarks)
    values (s.id, s.hub_id, s.zone_id, m.id, v_name, nullif(trim(p_ocr ->> 'payee'), ''), nullif(trim(p_payment_ref), ''),
      nullif(trim(p_transaction_id), ''), p_amount, v_date, p_screenshot_path, p_ocr, coalesce(p_ocr_verified, false),
      case when p_ocr_verified then auth.uid() end, v_match, mp.id, nullif(trim(p_remarks), ''))
    returning id into v_id;
  else
    update public.da_merchant_payments set merchant_id = m.id, merchant_name = v_name,
      payee_name = coalesce(nullif(trim(p_ocr ->> 'payee'), ''), payee_name),
      payment_ref = nullif(trim(p_payment_ref), ''),
      transaction_id = nullif(trim(p_transaction_id), ''), amount = p_amount, payment_date = v_date,
      screenshot_path = coalesce(p_screenshot_path, screenshot_path), ocr = coalesce(p_ocr, ocr),
      ocr_verified = coalesce(p_ocr_verified, false), verified_by = case when p_ocr_verified then auth.uid() end,
      match_status = v_match, matched_payment_id = mp.id, remarks = nullif(trim(p_remarks), '')
    where id = p_line and session_id = s.id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'Line not found on this sheet.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- What a Payment ID looks like on the main site, so the screenshot reader and the
-- form know what to expect. Head Office can change it from Accounts settings.
insert into public.system_settings (key, value, description) values
  ('da.payment_id_pattern', '"^[A-Z]{2,5}-[0-9]{4,}$"'::jsonb,
   'Daily accounts: what a main-site Payment ID looks like (regular expression)')
on conflict (key) do nothing;
