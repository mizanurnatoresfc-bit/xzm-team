-- ============================================================
-- নদী AI — হিসাব শেখা ও ম্যানেজমেন্ট (Accounts Learning & Management)
--
--  1. ব্যাংকে জমার স্লিপ: OCR-এ পড়া টাকা, MATCH / NOT MATCH / NEEDS REVIEW,
--     কে কখন স্লিপ দিলেন। OCR দিয়ে কখনো "ব্যাংকে নিশ্চিত" হয় না —
--     একজন মানুষ নিজে মিলিয়ে আলাদা বোতামে নিশ্চিত করেন (da_deposit_confirm)।
--  2. da.learn_official: হেড অফিসের দেওয়া SteadFast-এর অফিশিয়াল নিয়ম (মডিউল অনুযায়ী লেখা)।
--     শেখার পাতায় ও AI শিক্ষকের কাছে এটা "অফিশিয়াল" হিসেবে আলাদা দেখায়;
--     বাকি সব নির্দেশনা "নদী AI-র অভ্যন্তরীণ নির্দেশনা"।
--  3. da_accounts_history: হিসাবের প্রতিটি তৈরি, বদল, অনুমোদন — আগের ও নতুন মান,
--     কে, কখন (audit_logs থেকে, শুধু পড়া)।
--  4. da_center_overview: যে হাবগুলো দেখার অনুমতি আছে, দিনের হিসাবের চিত্র —
--     জোনাল ম্যানেজার ও হেড অফিসের মনিটরিং।
--
-- Additive only: new columns on da_deposits (all nullable), one setting, new functions,
-- one trigger. Rollback: drop the trigger da_deposits_slip_guard and its function, the
-- functions below, the setting, and the new columns.
-- ============================================================

insert into public.system_settings (key, value, description) values
  ('da.learn_official', '{}'::jsonb, 'SteadFast-এর অফিশিয়াল নিয়ম — হেড অফিস মডিউল অনুযায়ী লিখে দেন (শেখার পাতা ও AI শিক্ষক এটাকেই অফিশিয়াল ধরে)'),
  ('da.slip_ocr_min_confidence', '60'::jsonb, 'স্লিপের OCR এর চেয়ে কম নিশ্চিত হলে NEEDS REVIEW')
on conflict (key) do nothing;

-- ---------- 1. deposit slips ----------
alter table public.da_deposits
  add column if not exists slip_uploaded_at       timestamptz,
  add column if not exists slip_uploaded_by       uuid,
  add column if not exists slip_uploaded_by_name  text,
  add column if not exists slip_ocr_amount        numeric(14,2),
  add column if not exists slip_ocr_confidence    integer,
  add column if not exists slip_ocr_at            timestamptz,
  add column if not exists slip_match             text check (slip_match in ('match','not_match','review')),
  add column if not exists bank_confirmed_at      timestamptz,
  add column if not exists bank_confirmed_by      uuid,
  add column if not exists bank_confirmed_by_name text,
  add column if not exists bank_confirm_note      text;

-- slips already on the record: when and by whom is the last change we know
update public.da_deposits set slip_uploaded_at = coalesce(updated_at, created_at), slip_uploaded_by = coalesce(updated_by, created_by)
 where slip_path is not null and slip_uploaded_at is null;

create or replace function private.da_slip_match(p_amount numeric, p_ocr numeric, p_conf integer) returns text
language sql stable set search_path = '' as $$
  select case
    when p_ocr is null then 'review'
    when coalesce(p_conf, 0) < coalesce(nullif(private.setting_text('da.slip_ocr_min_confidence'), '')::integer, 60) then 'review'
    when abs(p_amount - p_ocr) < 1 then 'match'
    else 'not_match' end
$$;

-- Only the two functions below may write the OCR reading and the bank confirmation.
-- A new slip or a new amount clears the confirmation; a new slip clears the old reading.
create or replace function private.da_deposits_slip_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_ocr boolean := coalesce(current_setting('xzm.da_slip_ocr', true), '') = 'on';
        v_ok  boolean := coalesce(current_setting('xzm.da_bank_confirm', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_ocr then new.slip_ocr_amount := null; new.slip_ocr_confidence := null; new.slip_ocr_at := null; new.slip_match := null; end if;
    if not v_ok then new.bank_confirmed_at := null; new.bank_confirmed_by := null; new.bank_confirmed_by_name := null; new.bank_confirm_note := null; end if;
    if new.slip_path is not null then
      new.slip_uploaded_at := now(); new.slip_uploaded_by := auth.uid(); new.slip_uploaded_by_name := private.da_my_name();
    end if;
    return new;
  end if;
  if not v_ocr and (new.slip_ocr_amount is distinct from old.slip_ocr_amount or new.slip_ocr_confidence is distinct from old.slip_ocr_confidence
                    or new.slip_ocr_at is distinct from old.slip_ocr_at or new.slip_match is distinct from old.slip_match) then
    new.slip_ocr_amount := old.slip_ocr_amount; new.slip_ocr_confidence := old.slip_ocr_confidence;
    new.slip_ocr_at := old.slip_ocr_at; new.slip_match := old.slip_match;
  end if;
  if not v_ok and (new.bank_confirmed_at is distinct from old.bank_confirmed_at or new.bank_confirmed_by is distinct from old.bank_confirmed_by
                   or new.bank_confirmed_by_name is distinct from old.bank_confirmed_by_name or new.bank_confirm_note is distinct from old.bank_confirm_note) then
    raise exception 'ব্যাংকে জমা শুধু "ব্যাংকে নিশ্চিত করুন" দিয়ে নিশ্চিত করা যায়।' using errcode = '42501';
  end if;
  if new.slip_path is distinct from old.slip_path then
    new.slip_uploaded_at := case when new.slip_path is null then null else now() end;
    new.slip_uploaded_by := case when new.slip_path is null then null else auth.uid() end;
    new.slip_uploaded_by_name := case when new.slip_path is null then null else private.da_my_name() end;
    new.slip_ocr_amount := null; new.slip_ocr_confidence := null; new.slip_ocr_at := null; new.slip_match := null;
  elsif new.amount is distinct from old.amount and new.slip_ocr_at is not null then
    new.slip_match := private.da_slip_match(new.amount, new.slip_ocr_amount, new.slip_ocr_confidence);
  end if;
  if (new.slip_path is distinct from old.slip_path or new.amount is distinct from old.amount or new.removed_at is not null) and not v_ok then
    new.bank_confirmed_at := null; new.bank_confirmed_by := null; new.bank_confirmed_by_name := null; new.bank_confirm_note := null;
  end if;
  return new;
end $$;

drop trigger if exists da_deposits_slip_guard on public.da_deposits;
create trigger da_deposits_slip_guard before insert or update on public.da_deposits
  for each row execute function private.da_deposits_slip_guard();

-- The page read the slip with OCR: keep what it read and compare it with the amount written.
-- The result is only MATCH / NOT MATCH / NEEDS REVIEW — never "confirmed".
create or replace function public.da_deposit_slip_read(p_deposit uuid, p_ocr_amount numeric, p_confidence integer default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare x public.da_deposits; v_match text;
begin
  select * into x from public.da_deposits where id = p_deposit and removed_at is null for update;
  if x.id is null then raise exception 'জমার লাইন পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  perform private.da_require_edit(x.session_id);
  if x.slip_path is null then raise exception 'আগে স্লিপের ছবি দিন।' using errcode = '22023'; end if;
  if p_ocr_amount is not null and p_ocr_amount < 0 then raise exception 'টাকা ঋণাত্মক হতে পারে না।' using errcode = '22023'; end if;
  v_match := private.da_slip_match(x.amount, p_ocr_amount, p_confidence);
  perform set_config('xzm.da_slip_ocr', 'on', true);
  update public.da_deposits set slip_ocr_amount = p_ocr_amount, slip_ocr_confidence = p_confidence, slip_ocr_at = now(), slip_match = v_match
   where id = x.id;
  perform set_config('xzm.da_slip_ocr', '', true);
  perform private.da_event(x.session_id, 'note', 'ব্যাংক স্লিপ পড়া হলো: লেখা ৳' || x.amount || ', স্লিপে ' || coalesce('৳' || p_ocr_amount, 'পড়া যায়নি')
    || ' → ' || case v_match when 'match' then 'MATCH' when 'not_match' then 'NOT MATCH' else 'NEEDS REVIEW' end, false);
  return jsonb_build_object('match', v_match, 'amount', x.amount, 'ocr_amount', p_ocr_amount);
end $$;

-- A person checked the slip (and the bank, where they can) and confirms the deposit. Only this marks it confirmed.
create or replace function public.da_deposit_confirm(p_deposit uuid, p_confirm boolean default true, p_note text default null)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare x public.da_deposits;
begin
  select * into x from public.da_deposits where id = p_deposit and removed_at is null for update;
  if x.id is null then raise exception 'জমার লাইন পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if not (private.has_permission('da.sheet.approve', x.zone_id, x.hub_id) or private.has_permission('da.sheet.create', x.zone_id, x.hub_id)) then
    raise exception 'এই হাবের ব্যাংক জমা নিশ্চিত করার অনুমতি নেই।' using errcode = '42501'; end if;
  if p_confirm then
    if x.slip_path is null then raise exception 'স্লিপ ছাড়া ব্যাংকে জমা নিশ্চিত করা যায় না।' using errcode = '22023'; end if;
    if coalesce(x.slip_match, 'review') <> 'match' and nullif(trim(coalesce(p_note, '')), '') is null then
      raise exception 'স্লিপের টাকা মেলেনি বা পড়া যায়নি — নিজে মিলিয়ে কারণ/মন্তব্য লিখুন।' using errcode = '22023'; end if;
  end if;
  perform set_config('xzm.da_bank_confirm', 'on', true);
  update public.da_deposits
     set bank_confirmed_at = case when p_confirm then now() end, bank_confirmed_by = case when p_confirm then auth.uid() end,
         bank_confirmed_by_name = case when p_confirm then private.da_my_name() end, bank_confirm_note = nullif(trim(coalesce(p_note, '')), '')
   where id = x.id;
  perform set_config('xzm.da_bank_confirm', '', true);
  perform private.da_event(x.session_id, 'note',
    case when p_confirm then 'ব্যাংকে জমা নিশ্চিত: ৳' else 'ব্যাংকে জমার নিশ্চয়তা তুলে নেওয়া হলো: ৳' end || x.amount
    || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''), false);
end $$;

-- ---------- 3. accounts history: every create, change and approval, old and new values ----------
create or replace function public.da_accounts_history(p_hub uuid, p_from date default null, p_to date default null, p_limit integer default 300)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare v_zone uuid := private.hub_zone(p_hub); v_from date := coalesce(p_from, private.da_today() - 7); v_to date := coalesce(p_to, private.da_today());
begin
  if v_zone is null or not (private.has_permission('da.sheet.view', v_zone, p_hub) or private.has_permission('da.sheet.create', v_zone, p_hub)) then
    raise exception 'এই হাবের হিসাবের ইতিহাস দেখার অনুমতি নেই।' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'at', a.occurred_at, 'action', a.action, 'table', a.table_name, 'record', a.record_id,
      'by', coalesce(nullif(p.full_name, ''), p.email::text, 'সিস্টেম'), 'by_id', a.actor_id,
      'fields', coalesce(to_jsonb(a.changed_fields), '[]'::jsonb),
      'old', case when a.changed_fields is null then null else (select jsonb_object_agg(k, a.old_data -> k) from unnest(a.changed_fields) k where k not in ('updated_at','updated_by')) end,
      'new', case when a.changed_fields is null then a.new_data - 'id' - 'session_id' - 'hub_id' - 'zone_id' - 'created_at' - 'created_by' - 'updated_at' - 'updated_by' - 'ocr'
                  else (select jsonb_object_agg(k, a.new_data -> k) from unnest(a.changed_fields) k where k not in ('updated_at','updated_by')) end)
      order by a.occurred_at desc, a.id desc)
    from (select * from public.audit_logs l
           where l.table_name in ('da_sessions','da_rider_lines','da_merchant_payments','da_expenses','da_expense_claims','da_cash_notes','da_report_ids','da_deposits')
             and l.occurred_at >= (v_from::timestamp at time zone 'Asia/Dhaka') and l.occurred_at < ((v_to + 1)::timestamp at time zone 'Asia/Dhaka')
             and coalesce(l.new_data ->> 'hub_id', l.old_data ->> 'hub_id') = p_hub::text
           order by l.occurred_at desc, l.id desc
           limit least(greatest(coalesce(p_limit, 300), 1), 1000)) a
    left join public.profiles p on p.id = a.actor_id), '[]'::jsonb);
end $$;

-- ---------- 4. one day across the hubs I may see ----------
create or replace function public.da_center_overview(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare v_date date := coalesce(p_date, private.da_today());
begin
  return coalesce((
    with hubs as (
      select h.id, coalesce(h.name_bn, h.name) as name, h.code::text as code, h.zone_id, z.name as zone
      from public.hubs h join public.zones z on z.id = h.zone_id
      where h.archived_at is null and h.status = 'active'
        and (private.has_permission('da.sheet.view', h.zone_id, h.id) or private.has_permission('da.sheet.create', h.zone_id, h.id))
    ), rows as (
      select hb.*, s.id as session_id, s.status, s.started_at, s.started_by_name, s.submitted_at, s.submitted_by_name, s.verified_at, s.verified_by_name,
        s.closed_at, s.bank_done_at,
        (select coalesce(sum(r.amount),0) from public.da_report_ids r where r.session_id = s.id and r.removed_at is null) as report_total,
        (select count(*) from public.da_report_ids r where r.session_id = s.id and r.removed_at is null) as reports,
        (select coalesce(sum(m.amount),0) from public.da_merchant_payments m where m.session_id = s.id and m.removed_at is null) as merchant,
        (select coalesce(sum(x.amount),0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null) as expense,
        (select coalesce(sum(x.amount),0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'employee') as staff_expense,
        (select coalesce(sum(x.amount),0) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.kind = 'transport') as transport_expense,
        (select count(*) from public.da_expenses x where x.session_id = s.id and x.removed_at is null and x.attachment_path is null and x.claim_file is null) as missing_vouchers,
        (select coalesce(sum(d.amount),0) from public.da_deposits d where d.session_id = s.id and d.removed_at is null) as deposited,
        (select coalesce(sum(d.charge + d.transport),0) from public.da_deposits d where d.session_id = s.id and d.removed_at is null) as bank_costs,
        (select count(*) from public.da_deposits d where d.session_id = s.id and d.removed_at is null) as deposits,
        (select count(*) from public.da_deposits d where d.session_id = s.id and d.removed_at is null and d.slip_path is null) as slips_missing,
        (select count(*) from public.da_deposits d where d.session_id = s.id and d.removed_at is null and d.slip_match = 'match') as slips_match,
        (select count(*) from public.da_deposits d where d.session_id = s.id and d.removed_at is null and d.slip_match = 'not_match') as slips_not_match,
        (select count(*) from public.da_deposits d where d.session_id = s.id and d.removed_at is null and d.slip_path is not null and coalesce(d.slip_match,'review') = 'review') as slips_review,
        (select count(*) from public.da_deposits d where d.session_id = s.id and d.removed_at is null and d.bank_confirmed_at is not null) as bank_confirmed,
        (select count(*) from public.da_expense_claims c where c.hub_id = hb.id and c.status = 'submitted') as bills_waiting
      from hubs hb left join public.da_sessions s on s.hub_id = hb.id and s.account_date = v_date
    )
    select jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'bank_amount', r.report_total - r.merchant - r.expense - r.bank_costs,
      'hub_due', round(r.report_total - r.merchant - r.expense - r.bank_costs - r.deposited, 2)) order by r.zone, r.name)
    from rows r), '[]'::jsonb);
end $$;

revoke all on function private.da_slip_match(numeric, numeric, integer), private.da_deposits_slip_guard() from public, anon, authenticated;
grant execute on function private.da_slip_match(numeric, numeric, integer) to authenticated;
revoke all on function public.da_deposit_slip_read(uuid, numeric, integer), public.da_deposit_confirm(uuid, boolean, text),
  public.da_accounts_history(uuid, date, date, integer), public.da_center_overview(date) from public, anon;
grant execute on function public.da_deposit_slip_read(uuid, numeric, integer), public.da_deposit_confirm(uuid, boolean, text),
  public.da_accounts_history(uuid, date, date, integer), public.da_center_overview(date) to authenticated;

-- ---------- 5. the main site's report: keep its screenshot / PDF / text with the report ID ----------
alter table public.da_report_ids
  add column if not exists file_path text,
  add column if not exists raw_text  text check (raw_text is null or length(raw_text) <= 20000),
  add column if not exists file_at   timestamptz,
  add column if not exists file_by   uuid;

create or replace function public.da_report_attach(p_report uuid, p_path text default null, p_text text default null)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare r public.da_report_ids;
begin
  select * into r from public.da_report_ids where id = p_report and removed_at is null for update;
  if r.id is null then raise exception 'রিপোর্ট আইডি পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  perform private.da_require_edit(r.session_id);
  if p_path is not null and p_path !~ ('^da/' || r.session_id::text || '/[^/]+$') then
    raise exception 'ফাইলটি এই খাতায় আপলোড করতে হবে।' using errcode = '22023'; end if;
  if p_path is null and nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'ফাইল বা রিপোর্টের লেখা দিন।' using errcode = '22023'; end if;
  update public.da_report_ids set file_path = coalesce(p_path, file_path), raw_text = coalesce(nullif(trim(coalesce(p_text, '')), ''), raw_text),
         file_at = now(), file_by = auth.uid() where id = r.id;
end $$;
revoke all on function public.da_report_attach(uuid, text, text) from public, anon;
grant execute on function public.da_report_attach(uuid, text, text) to authenticated;
