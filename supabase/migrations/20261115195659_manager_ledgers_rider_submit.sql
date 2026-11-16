-- Applied on the live database from another chat on 15 Nov 2026 and copied here unchanged on 16 Nov 2026,
-- so the repository matches the live database (supabase_migrations.schema_migrations, version 20261115195659).

-- ============================================================
-- আজকের হিসাব খাতা · ধাপ ১
-- যার যার খাতা (collector), রাইডারের নিজে হিসাব পাঠানো,
-- একই দিনে একাধিক বার, রুট/ছুটি কাউন্ট, হাবের রিপোর্ট জমার শর্ত
-- ============================================================

-- ---------- settings ----------
insert into public.system_settings (key, value, description) values
  ('da.rider_times', '3'::jsonb, 'রাইডার এক দিনে সর্বোচ্চ কতবার হিসাব দিতে পারবে'),
  ('da.pending_reason_required', 'true'::jsonb, 'রুটের কারো হিসাব না থাকলে হাবের রিপোর্ট জমার সময় কারণ লিখতে হবে'),
  ('da.close_time', '"21:00"'::jsonb, 'এই সময়ের পরেও খাতা খোলা থাকলে রিমাইন্ডার')
on conflict (key) do nothing;

-- ---------- rider lines: কার খাতায়, কে দিয়েছে, কত নম্বর বার ----------
alter table public.da_rider_lines
  add column if not exists collector_user uuid references public.profiles(id),
  add column if not exists source text not null default 'manager' check (source in ('manager','rider')),
  add column if not exists seq integer not null default 1 check (seq >= 1),
  add column if not exists office_deposit boolean not null default false,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references public.profiles(id);

update public.da_rider_lines set collector_user = created_by where collector_user is null;

create index if not exists da_rider_lines_collector_idx on public.da_rider_lines (session_id, collector_user) where removed_at is null;

-- ম্যানেজার নিজে লিখলে তার খাতায়; রাইডার পাঠালে বাছা ম্যানেজারের খাতায় (collector রেজিস্ট্রেশন সেই ম্যানেজারের নামে)
create or replace function private.da_note_collector() returns trigger
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions; v_user uuid; v_emp uuid; v_name text; v_code text;
begin
  v_user := coalesce(new.collector_user, auth.uid());
  if v_user is null then return new; end if;
  if new.collector_user is null then new.collector_user := v_user; end if;
  select * into s from public.da_sessions where id = new.session_id;
  if s.id is null then return new; end if;
  select e.id, e.full_name, e.employee_code::text into v_emp, v_name, v_code
    from public.employees e where e.profile_id = v_user and e.archived_at is null limit 1;
  if v_name is null then select nullif(p.full_name,''), null into v_name, v_code from public.profiles p where p.id = v_user; end if;
  insert into public.da_sheet_collectors (session_id, user_id, employee_id, name, code)
  values (new.session_id, v_user, v_emp, v_name, v_code)
  on conflict (session_id, user_id) do update set updated_at = now();
  return new;
end $$;

-- ---------- রাইডার: আজ কোন ম্যানেজারের খাতা খোলা ----------
create or replace function public.da_rider_open_managers(p_date date default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_emp uuid := private.my_employee_id(); v_hub uuid; v_date date := coalesce(p_date, private.da_today()); s public.da_sessions;
begin
  if v_emp is null then raise exception 'আপনার লগইনের সাথে কোনো কর্মী যুক্ত নেই।' using errcode = '42501'; end if;
  select hub_id into v_hub from public.employees where id = v_emp;
  select * into s from public.da_sessions where hub_id = v_hub and account_date = v_date;
  if s.id is null then
    return jsonb_build_object('session_id', null, 'managers', '[]'::jsonb, 'message', 'আজকের খাতা এখনো কোনো ম্যানেজার খোলেননি।');
  end if;
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'date', s.account_date,
    'managers', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.name, 'code', c.code, 'closed', c.closed_at is not null) order by c.closed_at nulls first, c.name)
                          from public.da_sheet_collectors c where c.session_id = s.id), '[]'::jsonb),
    'my_times', (select count(*) from public.da_rider_lines l where l.session_id = s.id and l.employee_id = v_emp and l.removed_at is null),
    'max_times', coalesce(private.setting_text('da.rider_times')::int, 3));
end $$;

-- ---------- রাইডার: হিসাব পাঠানো ----------
create or replace function public.da_rider_submit(
  p_manager uuid, p_amount numeric, p_delivery integer default 0, p_pickup integer default 0,
  p_office boolean default false, p_mobile_banking numeric default 0, p_remarks text default null, p_date date default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_emp uuid := private.my_employee_id(); e public.employees; s public.da_sessions; c public.da_sheet_collectors;
        v_seq int; v_max int := coalesce(private.setting_text('da.rider_times')::int, 3); v_id uuid; v_date date := coalesce(p_date, private.da_today());
begin
  if v_emp is null then raise exception 'আপনার লগইনের সাথে কোনো কর্মী যুক্ত নেই।' using errcode = '42501'; end if;
  select * into e from public.employees where id = v_emp;
  select * into s from public.da_sessions where hub_id = e.hub_id and account_date = v_date;
  if s.id is null then raise exception 'আজকের খাতা এখনো কোনো ম্যানেজার খোলেননি।' using errcode = 'P0002'; end if;
  if s.status not in ('open','correction') then raise exception 'আজকের হিসাব বন্ধ হয়ে গেছে।' using errcode = '22023'; end if;
  select * into c from public.da_sheet_collectors where session_id = s.id and user_id = p_manager;
  if c.id is null then raise exception 'এই ম্যানেজার আজ খাতা খোলেননি।' using errcode = '22023'; end if;
  if c.closed_at is not null then raise exception '% এর খাতা বন্ধ — অন্য ম্যানেজার বাছুন।', c.name using errcode = '22023'; end if;
  if coalesce(p_amount,0) < 0 or coalesce(p_delivery,0) < 0 or coalesce(p_pickup,0) < 0 then
    raise exception 'সংখ্যা বা টাকা ঋণাত্মক হতে পারে না।' using errcode = '22023'; end if;
  if not p_office and coalesce(p_delivery,0) = 0 and coalesce(p_amount,0) = 0 then
    raise exception 'ডেলিভারি বা টাকা — অন্তত একটা দিন।' using errcode = '22023'; end if;
  select count(*) + 1 into v_seq from public.da_rider_lines where session_id = s.id and employee_id = v_emp and removed_at is null;
  if v_seq > v_max then raise exception 'আজ সর্বোচ্চ % বার হিসাব দেওয়া যায়।', v_max using errcode = '22023'; end if;

  insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, employee_code, rider_name, mobile,
    delivery_qty, pickup_qty, amount, paid_amount, due_input, due, mobile_banking, remarks,
    collector_user, source, seq, office_deposit)
  values (s.id, s.hub_id, s.zone_id, v_emp, e.employee_code::text, e.full_name, e.mobile,
    coalesce(p_delivery,0), coalesce(p_pickup,0), coalesce(p_amount,0), coalesce(p_amount,0), 0,
    private.da_due(p_amount, p_amount, 0, p_mobile_banking), coalesce(p_mobile_banking,0),
    nullif(trim(coalesce(p_remarks,'') || case when p_office then ' · অফিসে টাকা জমা দিয়ে ডেলিভারিতে' else '' end), ''),
    p_manager, 'rider', v_seq, coalesce(p_office,false))
  returning id into v_id;

  perform private.da_event(s.id, 'note', e.full_name || ' (#' || e.employee_code::text || ') নিজে হিসাব পাঠিয়েছে → ' || c.name || ' · বার ' || v_seq, false);
  perform private.notify(p_manager, 'রাইডার হিসাব পাঠিয়েছে', e.full_name || ' · ৳' || coalesce(p_amount,0)::text || case when p_office then ' (অফিসে জমা)' else '' end,
                         '/accounts/today', 'da_rider_line');
  return v_id;
end $$;

-- ---------- ম্যানেজার: গ্রহণ / ফেরত ----------
create or replace function public.da_rider_accept(p_line uuid, p_accept boolean default true, p_note text default null)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare l public.da_rider_lines; s public.da_sessions;
begin
  select * into l from public.da_rider_lines where id = p_line and removed_at is null for update;
  if l.id is null then raise exception 'লাইন পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  s := private.da_require_edit(l.session_id);
  if l.collector_user <> auth.uid() and not private.has_permission('da.sheet.approve', s.zone_id, s.hub_id) then
    raise exception 'এটা আপনার খাতার লাইন নয়।' using errcode = '42501'; end if;
  if l.source <> 'rider' then raise exception 'এই লাইন ম্যানেজার নিজে লিখেছেন, গ্রহণের দরকার নেই।' using errcode = '22023'; end if;
  if p_accept then
    update public.da_rider_lines set accepted_at = now(), accepted_by = auth.uid() where id = l.id;
    perform private.da_event(s.id, 'note', l.rider_name || '-এর পাঠানো হিসাব গ্রহণ (বার ' || l.seq || ')', false);
    if l.employee_id is not null then
      perform private.notify(e.profile_id, 'হিসাব গৃহীত', 'আপনার হিসাব (বার ' || l.seq || ') ম্যানেজার গ্রহণ করেছেন।', '/me/accounts', 'da_rider_line')
        from public.employees e where e.id = l.employee_id and e.profile_id is not null;
    end if;
  else
    update public.da_rider_lines set removed_at = now(), removed_by = auth.uid(),
           remove_reason = coalesce(nullif(trim(p_note),''), 'ম্যানেজার ফেরত দিয়েছেন') where id = l.id;
    perform private.da_event(s.id, 'note', l.rider_name || '-এর পাঠানো হিসাব ফেরত: ' || coalesce(p_note,''), false);
    perform private.notify(e.profile_id, 'হিসাব ফেরত', coalesce(nullif(trim(p_note),''), 'ম্যানেজার হিসাবটি ফেরত দিয়েছেন — আবার পাঠান।'), '/me/accounts', 'da_rider_line')
      from public.employees e where e.id = l.employee_id and e.profile_id is not null;
  end if;
end $$;

-- ---------- রাইডার: শুধু নিজের হিসাব ----------
create or replace function public.da_my_rider_lines(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'date', s.account_date, 'seq', l.seq, 'source', l.source, 'office_deposit', l.office_deposit,
    'delivery', l.delivery_qty, 'pickup', l.pickup_qty, 'amount', l.amount, 'mobile_banking', l.mobile_banking,
    'manager', c.name, 'status', case when l.source = 'manager' then 'taken' when l.accepted_at is not null then 'accepted' else 'pending' end,
    'remarks', l.remarks) order by s.account_date desc, l.seq desc), '[]'::jsonb)
  from public.da_rider_lines l
  join public.da_sessions s on s.id = l.session_id
  left join public.da_sheet_collectors c on c.session_id = l.session_id and c.user_id = l.collector_user
  where l.employee_id = private.my_employee_id() and l.removed_at is null
    and s.account_date >= private.da_today() - greatest(coalesce(p_days,30),1);
$$;

-- ---------- রুট, ছুটি, বাকি ----------
create or replace function public.da_pending_riders(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session;
  if s.id is null then raise exception 'খাতা পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if not (private.has_permission('da.sheet.view', s.zone_id, s.hub_id) or private.has_permission('da.sheet.create', s.zone_id, s.hub_id)) then
    raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  return (
    with route as (
      select distinct e.id, e.full_name, e.full_name_bn, e.employee_code::text as code, e.position_id
      from public.rider_routes rr join public.employees e on e.id = rr.employee_id
      where rr.hub_id = s.hub_id and rr.effective_from <= s.account_date and (rr.effective_to is null or rr.effective_to >= s.account_date)
        and e.status = 'active' and e.archived_at is null
    ),
    on_leave as (
      select distinct employee_id from public.leave_requests
      where status = 'approved' and from_date <= s.account_date and to_date >= s.account_date
      union
      select employee_id from public.attendance_records where work_date = s.account_date and status in ('leave','holiday','weekly_off')
    ),
    done as (
      select distinct employee_id from public.da_rider_lines
      where session_id = s.id and removed_at is null and (source = 'manager' or accepted_at is not null)
    )
    select jsonb_build_object(
      'route', (select count(*) from route),
      'leave', (select count(*) from route r where r.id in (select employee_id from on_leave)),
      'done',  (select count(*) from route r where r.id in (select employee_id from done) and r.id not in (select employee_id from on_leave)),
      'pending_count', (select count(*) from route r where r.id not in (select employee_id from done) and r.id not in (select employee_id from on_leave)),
      'pending', coalesce((select jsonb_agg(jsonb_build_object('employee_id', r.id, 'name', coalesce(r.full_name_bn, r.full_name), 'code', r.code) order by r.code)
                           from route r where r.id not in (select employee_id from done) and r.id not in (select employee_id from on_leave)), '[]'::jsonb),
      'on_leave', coalesce((select jsonb_agg(jsonb_build_object('employee_id', r.id, 'name', coalesce(r.full_name_bn, r.full_name), 'code', r.code) order by r.code)
                            from route r where r.id in (select employee_id from on_leave)), '[]'::jsonb),
      'awaiting_accept', (select count(*) from public.da_rider_lines where session_id = s.id and removed_at is null and source = 'rider' and accepted_at is null)
    ));
end $$;

-- ---------- আমার খাতা বন্ধ: গ্রহণ-বাকি থাকলে নয়; বিল-ছাড়া খরচে অটো ভাউচার ----------
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
    for v_x in select id from public.da_expenses
               where session_id = s.id and created_by = auth.uid() and removed_at is null
                 and voucher_no is null and attachment_path is null and nullif(trim(coalesce(bill_no,'')),'') is null
    loop
      perform public.da_make_voucher(v_x.id); v_made := v_made + 1;
    end loop;
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

-- ---------- হাবের রিপোর্ট জমা: সবার খাতা বন্ধ না হলে নয় ----------
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
  -- শেষ সুরক্ষা: বিল-ছাড়া যে খরচে ভাউচার নেই, এখনই বানাও
  perform public.da_make_voucher(x.id) from public.da_expenses x
   where x.session_id = s.id and x.removed_at is null and x.voucher_no is null and x.attachment_path is null and nullif(trim(coalesce(x.bill_no,'')),'') is null;
  update public.da_sessions set status = 'submitted', submitted_by = auth.uid(), submitted_by_name = private.da_my_name(),
         submitted_by_code = private.da_my_code(), submitted_at = now(), submit_note = nullif(trim(p_note), ''),
         submit_count = submit_count + 1, verified_by = null, verified_by_name = null, verified_at = null
   where id = s.id;
  perform private.da_event(s.id, case when s.submit_count > 0 then 'resubmitted' else 'submitted' end, p_note, true);
end $$;

-- ---------- হাবের রাইডার শিট: সব খাতা বন্ধ হলে নাম একবার, যোগফল ----------
create or replace function public.da_hub_rider_sheet(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare s public.da_sessions; v_all boolean;
begin
  select * into s from public.da_sessions where id = p_session;
  if s.id is null then raise exception 'খাতা পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.view', s.zone_id, s.hub_id) then raise exception 'অনুমতি নেই।' using errcode = '42501'; end if;
  select not exists (select 1 from public.da_sheet_collectors where session_id = s.id and closed_at is null) into v_all;
  return jsonb_build_object('all_closed', v_all,
    'rows', coalesce((
      select jsonb_agg(r order by r ->> 'code') from (
        select jsonb_build_object('employee_id', l.employee_id, 'code', l.employee_code, 'name', l.rider_name,
          'delivery', sum(l.delivery_qty), 'pickup', sum(l.pickup_qty), 'amount', sum(l.amount),
          'mobile_banking', sum(l.mobile_banking), 'times', count(*),
          'managers', (select string_agg(distinct coalesce(c.name, c.code), ', ') from public.da_sheet_collectors c where c.session_id = s.id and c.user_id = any(array_agg(l.collector_user))),
          'collector_user', case when v_all then null else min(l.collector_user::text) end) r
        from public.da_rider_lines l
        where l.session_id = s.id and l.removed_at is null and (l.source = 'manager' or l.accepted_at is not null)
        group by l.employee_id, l.employee_code, l.rider_name, case when v_all then null else l.collector_user end
      ) q), '[]'::jsonb),
    'collectors', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.name, 'closed', c.closed_at is not null,
                     'riders', (select count(distinct employee_id) from public.da_rider_lines l where l.session_id = s.id and l.collector_user = c.user_id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
                     'amount', (select coalesce(sum(amount),0) from public.da_rider_lines l where l.session_id = s.id and l.collector_user = c.user_id and l.removed_at is null and (l.source='manager' or l.accepted_at is not null)),
                     'expense', (select coalesce(sum(amount),0) from public.da_expenses x where x.session_id = s.id and x.created_by = c.user_id and x.removed_at is null))
                     order by c.name) from public.da_sheet_collectors c where c.session_id = s.id), '[]'::jsonb));
end $$;

grant execute on function public.da_rider_open_managers(date), public.da_rider_submit(uuid,numeric,integer,integer,boolean,numeric,text,date),
  public.da_rider_accept(uuid,boolean,text), public.da_my_rider_lines(integer), public.da_pending_riders(uuid), public.da_hub_rider_sheet(uuid) to authenticated;
revoke execute on function public.da_rider_open_managers(date), public.da_rider_submit(uuid,numeric,integer,integer,boolean,numeric,text,date),
  public.da_rider_accept(uuid,boolean,text), public.da_my_rider_lines(integer), public.da_pending_riders(uuid), public.da_hub_rider_sheet(uuid) from anon;
