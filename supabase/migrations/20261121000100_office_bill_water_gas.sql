-- =====================================================================
--  অফিস / আবাসিকের বিলে পানি ও গ্যাস (owner approved, 21 Nov 2026).
--
--  Additive only: office_bills.kind may now also be 'water' or 'gas'.
--  No row is changed or removed; every existing bill keeps its kind.
--  Like rent / electricity / wifi, one water and one gas bill per place per month
--  (the existing unique index office_bills_once already covers every kind but 'other').
--  office_bill_save is the same function with the two kinds added to its check.
--
--  Rollback (only while no row uses the new kinds):
--    alter table public.office_bills drop constraint office_bills_kind_check;
--    alter table public.office_bills add constraint office_bills_kind_check check (kind in ('rent', 'electricity', 'wifi', 'other'));
--    and re-run office_bill_save from 20261116000800_office_operations.sql.
-- =====================================================================

alter table public.office_bills drop constraint if exists office_bills_kind_check;
alter table public.office_bills add constraint office_bills_kind_check
  check (kind in ('rent', 'electricity', 'wifi', 'water', 'gas', 'other'));

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
  if p_kind is null or p_kind not in ('rent', 'electricity', 'wifi', 'water', 'gas', 'other') then raise exception 'বিলের ধরন ঠিক নয়' using errcode = '22023'; end if;
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
