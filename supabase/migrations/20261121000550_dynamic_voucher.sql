-- =====================================================================
--  খরচের ভাউচার: নম্বরের ধরন সেটিং থেকে (da.voucher), আর জমা দেওয়ার সময় নিজে ভাউচার।
--
--  This file was brought into the repository on 22 Nov 2026 from the live database, where it was
--  applied on 21 Nov as `20261121202903 dynamic_voucher` without a file here. Everything below this
--  header is the live text, character for character (md5 45a891cea6da5d2791f467090773d1bf of the
--  statement stored in supabase_migrations.schema_migrations). Do not run it on live again.
--
--  * setting da.voucher: prefix, date part, digits, when the count starts again, a count per hub,
--    hub code in the number, automatic voucher on submit;
--  * da_voucher_counters + private.da_next_voucher_no(hub): the next free number as the setting says;
--  * da_make_voucher, da_submit, da_close_my_part and da_configure use it and check the setting.
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('da.voucher',
   '{"prefix": "V-", "date": "YYMM", "digits": 5, "reset": "never", "per_hub": false, "hub_code": false, "auto_on_submit": true}',
   'খরচের ভাউচার: নম্বরের ধরন (শুরুর অক্ষর, তারিখের অংশ, ঘর, কখন আবার ১ থেকে, প্রতি হাবে আলাদা গণনা, হাবের কোড) আর বিল-ছাড়া খরচে জমা দেওয়ার সময় নিজে ভাউচার')
on conflict (key) do nothing;

-- Counts that start again at 1. Only the security definer functions below touch this table.
create table if not exists public.da_voucher_counters (
  scope_key  text primary key,
  last_no    bigint not null default 0 check (last_no >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.da_voucher_counters is
  'Last expense voucher number per count (scope_key = all|<period> or <hub id>|<period>). Written only by private.da_next_voucher_no.';
alter table public.da_voucher_counters enable row level security;
revoke all on public.da_voucher_counters from public, anon, authenticated;

-- The next voucher number for an expense of this hub, as da.voucher says.
create or replace function private.da_next_voucher_no(p_hub uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c          jsonb   := coalesce(private.da_setting('da.voucher'), '{}'::jsonb);
  v_prefix   text    := coalesce(c ->> 'prefix', 'V-');
  v_date     text    := coalesce(c ->> 'date', 'YYMM');
  v_digits   int     := coalesce((c ->> 'digits')::int, 5);
  v_reset    text    := coalesce(c ->> 'reset', 'never');
  v_per_hub  boolean := coalesce((c ->> 'per_hub')::boolean, false);
  v_hub_code boolean := coalesce((c ->> 'hub_code')::boolean, false);
  v_today    date    := private.da_today();
  v_key text; v_code text; v_n bigint; v_no text; v_try int := 0;
begin
  if v_hub_code then
    select upper(h.code::text) into v_code from public.hubs h where h.id = p_hub;
  end if;
  v_key := case when v_per_hub then coalesce(p_hub::text, 'none') else 'all' end || '|'
        || case v_reset when 'daily' then to_char(v_today, 'YYYYMMDD') when 'monthly' then to_char(v_today, 'YYYYMM') else 'ever' end;
  loop
    v_try := v_try + 1;
    if v_reset = 'never' and not v_per_hub then
      v_n := nextval('public.da_voucher_seq');
    else
      insert into public.da_voucher_counters as k (scope_key, last_no) values (v_key, 1)
      on conflict (scope_key) do update set last_no = k.last_no + 1, updated_at = now()
      returning k.last_no into v_n;
    end if;
    v_no := v_prefix
         || case when v_code is not null then v_code || '-' else '' end
         || case v_date when 'YYMM' then to_char(v_today, 'YYMM') || '-'
                        when 'YYYYMM' then to_char(v_today, 'YYYYMM') || '-'
                        when 'YYMMDD' then to_char(v_today, 'YYMMDD') || '-'
                        else '' end
         || case when length(v_n::text) >= v_digits then v_n::text else lpad(v_n::text, v_digits, '0') end;
    exit when not exists (select 1 from public.da_expenses e where lower(e.voucher_no) = lower(v_no));
    if v_try >= 10000 then
      raise exception 'Could not find a free voucher number — check the voucher setting.' using errcode = '22023';
    end if;
  end loop;
  return v_no;
end $$;
revoke all on function private.da_next_voucher_no(uuid) from public, anon, authenticated;

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
  v_no := private.da_next_voucher_no(x.hub_id);
  update public.da_expenses set voucher_no = v_no where id = p_expense;
  perform private.da_event(x.session_id, 'note', 'Voucher ' || v_no || ' made for expense: ' || x.expense_name, false);
  return v_no;
end $$;

create or replace function public.da_submit(p_session uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  s public.da_sessions := private.da_require_edit(p_session);
  v_req numeric := nullif(private.da_setting('da.bill_upload') ->> 'required_over', '')::numeric;
  v_ocr boolean := coalesce((private.da_setting('da.ocr') ->> 'require_verification')::boolean, true);
  v_open text; v_pend int; v_missing jsonb;
begin
  select string_agg(coalesce(name, code, user_id::text), ', ') into v_open
    from public.da_sheet_collectors where session_id = s.id and closed_at is null;
  if v_open is not null then
    raise exception 'খাতা এখনো খোলা: % — সবাই "হিসাব নেওয়া শেষ" দিলে জমা হবে।', v_open using errcode = '22023';
  end if;
  select count(*) into v_pend from public.da_rider_lines where session_id = s.id and removed_at is null and source = 'rider' and accepted_at is null;
  if v_pend > 0 then raise exception '% জন রাইডারের পাঠানো হিসাব গ্রহণ বাকি।', v_pend using errcode = '22023'; end if;
  if coalesce(private.setting_text('da.pending_reason_required'), 'true') = 'true' then
    v_missing := public.da_pending_riders(s.id);
    if (v_missing ->> 'pending_count')::int > 0 and nullif(trim(coalesce(p_note,'')), '') is null then
      raise exception '% জনের হিসাব নেই — কারণ লিখুন (নোটে)।', v_missing ->> 'pending_count' using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from public.da_rider_lines where session_id = s.id and removed_at is null)
     and not exists (select 1 from public.da_merchant_payments where session_id = s.id and removed_at is null)
     and not exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null) then
    raise exception 'খাতা খালি — অন্তত একটা লাইন দিন।' using errcode = '22023';
  end if;
  if v_ocr and (exists (select 1 from public.da_merchant_payments where session_id = s.id and removed_at is null and ocr is not null and not ocr_verified)
             or exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null and ocr is not null and not ocr_verified)) then
    raise exception 'OCR-এ পড়া কিছু মান যাচাই বাকি।' using errcode = '22023';
  end if;
  if v_req is not null and exists (select 1 from public.da_expenses where session_id = s.id and removed_at is null and amount >= v_req and attachment_path is null) then
    raise exception '৳% বা বেশি খরচে বিল/মেমো লাগবে।', v_req using errcode = '22023';
  end if;
  -- শেষ সুরক্ষা: বিল-ছাড়া যে খরচে ভাউচার নেই — সেটিং চালু থাকলে এখনই বানাও, বন্ধ থাকলে জমা আটকাও
  if coalesce((private.da_setting('da.voucher') ->> 'auto_on_submit')::boolean, true) then
    perform public.da_make_voucher(x.id) from public.da_expenses x
     where x.session_id = s.id and x.removed_at is null and x.voucher_no is null and x.attachment_path is null and nullif(trim(coalesce(x.bill_no,'')),'') is null;
  elsif exists (select 1 from public.da_expenses x
                 where x.session_id = s.id and x.removed_at is null and x.voucher_no is null and x.attachment_path is null and nullif(trim(coalesce(x.bill_no,'')),'') is null) then
    raise exception 'বিল বা ভাউচার ছাড়া খরচ আছে — বিলের ছবি দিন বা "ভাউচার বানান" চাপুন।' using errcode = '22023';
  end if;
  update public.da_sessions set status = 'submitted', submitted_by = auth.uid(), submitted_by_name = private.da_my_name(),
         submitted_by_code = private.da_my_code(), submitted_at = now(), submit_note = nullif(trim(p_note), ''),
         submit_count = submit_count + 1, verified_by = null, verified_by_name = null, verified_at = null
   where id = s.id;
  perform private.da_event(s.id, case when s.submit_count > 0 then 'resubmitted' else 'submitted' end, p_note, true);
end $$;

-- da_close_my_part: the same body; the automatic voucher on closing one's part follows the same switch.
create or replace function public.da_close_my_part(p_session uuid, p_note text default null, p_done boolean default true)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions := private.da_require_edit(p_session); v_pend int; v_x record; v_made int := 0;
begin
  if p_done then
    select count(*) into v_pend from public.da_rider_lines
     where session_id = s.id and collector_user = auth.uid() and removed_at is null and source = 'rider' and accepted_at is null;
    if v_pend > 0 then
      raise exception '% জন রাইডারের পাঠানো হিসাব এখনো গ্রহণ/ফেরত বাকি।', v_pend using errcode = '22023';
    end if;
    -- বিল-ছাড়া খরচে অটো ভাউচার — শুধু da.voucher.auto_on_submit চালু থাকলে
    if coalesce((private.da_setting('da.voucher') ->> 'auto_on_submit')::boolean, true) then
      for v_x in select id from public.da_expenses
                 where session_id = s.id and created_by = auth.uid() and removed_at is null
                   and voucher_no is null and attachment_path is null and nullif(trim(coalesce(bill_no,'')),'') is null
      loop
        perform public.da_make_voucher(v_x.id); v_made := v_made + 1;
      end loop;
    end if;
  end if;
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code, closed_at, note)
  values (s.id, auth.uid(), private.my_employee_id(), private.da_my_name(), private.da_my_code(),
          case when p_done then now() end, nullif(trim(p_note), ''))
  on conflict (session_id, user_id) do update
     set closed_at = case when p_done then now() end, note = nullif(trim(p_note), ''), updated_at = now();
  perform private.da_event(s.id, 'note',
    case when p_done then 'খাতা বন্ধ: ' else 'খাতা আবার খোলা: ' end || coalesce(private.da_my_name(), 'someone')
    || case when v_made > 0 then ' · ' || v_made || 'টা অটো ভাউচার' else '' end, false);
end $$;

-- da_configure: the same rules as before, plus the checks for da.voucher.
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
  elsif p_key = 'da.voucher' and (jsonb_typeof(p_value) <> 'object'
        or coalesce(jsonb_typeof(p_value -> 'prefix'), '') <> 'string' or p_value ->> 'prefix' !~ '^[A-Za-z0-9/-]{0,8}$'
        or coalesce(p_value ->> 'date', '') not in ('none', 'YYMM', 'YYYYMM', 'YYMMDD')
        or coalesce(jsonb_typeof(p_value -> 'digits'), '') <> 'number' or (p_value ->> 'digits')::numeric not in (3, 4, 5, 6, 7, 8)
        or coalesce(p_value ->> 'reset', '') not in ('never', 'monthly', 'daily')
        or coalesce(jsonb_typeof(p_value -> 'per_hub'), '') <> 'boolean' or coalesce(jsonb_typeof(p_value -> 'hub_code'), '') <> 'boolean'
        or coalesce(jsonb_typeof(p_value -> 'auto_on_submit'), '') <> 'boolean') then
    raise exception 'Voucher: prefix up to 8 letters, digits, / or -; date none, YYMM, YYYYMM or YYMMDD; 3–8 digits; reset never, monthly or daily; three true/false switches.' using errcode = '22023';
  elsif p_key = 'da.voucher' and p_value ->> 'reset' = 'daily' and p_value ->> 'date' <> 'YYMMDD' then
    raise exception 'ভাউচার নম্বর প্রতিদিন ১ থেকে শুরু হলে নম্বরে দিনের তারিখ (YYMMDD) থাকতে হবে, নইলে একই নম্বর দুবার হবে।' using errcode = '22023';
  elsif p_key = 'da.voucher' and p_value ->> 'reset' = 'monthly' and p_value ->> 'date' = 'none' then
    raise exception 'ভাউচার নম্বর প্রতি মাসে ১ থেকে শুরু হলে নম্বরে মাস (YYMM) থাকতে হবে।' using errcode = '22023';
  elsif p_key = 'da.voucher' and (p_value ->> 'per_hub')::boolean and not (p_value ->> 'hub_code')::boolean then
    raise exception 'প্রতি হাবে আলাদা গণনা হলে নম্বরে হাবের কোড থাকতে হবে, নইলে দুই হাবে একই নম্বর হবে।' using errcode = '22023';
  end if;
  update public.system_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform private.write_audit('CONFIGURE', 'da', 'system_settings', p_key, null, jsonb_build_object(p_key, p_value));
end $$;
