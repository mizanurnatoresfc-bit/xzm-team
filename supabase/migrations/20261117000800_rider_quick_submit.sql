-- ============================================================
-- রাইডার/স্টাফ ড্যাশবোর্ড থেকে এক ক্লিকে পিকআপ, ডেলিভারি আর টাকা পাঠান;
-- ম্যানেজার এক ক্লিকে গ্রহণ (একটা বা সবগুলো একসাথে)।
--
-- What changes:
--  * da_rider_submit: the line is written into the chosen manager's khata
--    (created_by = that manager), so it shows on the manager's page and in the
--    khata totals the hub accepts. When only one manager's khata is open the
--    rider need not choose (p_manager may be null). Notification links point at
--    the real pages.
--  * da_rider_open_managers: also returns the hub name and my lines of the day,
--    so the dashboard card needs one call.
--  * da_rider_accept: same rules, notification link fixed.
--  * da_rider_accept_all (new): accept every line riders sent into my khata.
--
-- Additive only: no table change. Rollback: re-run the three functions from
-- 20261115002410_manager_ledgers_rider_submit.sql and drop da_rider_accept_all.
-- ============================================================

create or replace function public.da_rider_open_managers(p_date date default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_emp uuid := private.my_employee_id(); v_hub uuid; v_hub_name text; v_date date := coalesce(p_date, private.da_today()); s public.da_sessions;
        v_rider boolean;
begin
  if v_emp is null then raise exception 'আপনার লগইনের সাথে কোনো কর্মী যুক্ত নেই।' using errcode = '42501'; end if;
  select e.hub_id, coalesce(h.name_bn, h.name) into v_hub, v_hub_name
    from public.employees e left join public.hubs h on h.id = e.hub_id where e.id = v_emp;
  -- a rider: assigned as rider, on a route, a rider post, or holding the rider role
  v_rider := private.is_current_rider(v_emp, v_hub)
    or exists (select 1 from public.rider_routes rr where rr.employee_id = v_emp and rr.effective_from <= v_date and (rr.effective_to is null or rr.effective_to >= v_date))
    or exists (select 1 from public.employees e join public.positions p on p.id = e.position_id where e.id = v_emp
                 and (p.code::text ilike '%rider%' or p.name ilike '%rider%' or coalesce(p.name_bn, '') like '%রাইডার%'))
    or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = auth.uid()
                 and ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= v_date) and r.code::text ilike '%rider%');
  select * into s from public.da_sessions where hub_id = v_hub and account_date = v_date;
  if s.id is null then
    return jsonb_build_object('session_id', null, 'hub', v_hub_name, 'is_rider', v_rider, 'date', v_date, 'managers', '[]'::jsonb, 'mine', '[]'::jsonb,
      'my_times', 0, 'max_times', coalesce(private.setting_text('da.rider_times')::int, 3),
      'message', 'আজকের খাতা এখনো কোনো ম্যানেজার খোলেননি।');
  end if;
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'date', s.account_date, 'hub', v_hub_name, 'is_rider', v_rider,
    'managers', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.name, 'code', c.code, 'closed', c.closed_at is not null) order by c.closed_at nulls first, c.name)
                          from public.da_sheet_collectors c where c.session_id = s.id), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'seq', l.seq, 'source', l.source,
                        'delivery', l.delivery_qty, 'pickup', l.pickup_qty, 'amount', l.amount, 'office_deposit', l.office_deposit,
                        'manager', c.name, 'at', l.created_at,
                        'status', case when l.source = 'manager' then 'taken' when l.accepted_at is not null then 'accepted' else 'pending' end)
                        order by l.created_at)
                      from public.da_rider_lines l
                      left join public.da_sheet_collectors c on c.session_id = l.session_id and c.user_id = coalesce(l.collector_user, l.created_by)
                      where l.session_id = s.id and l.employee_id = v_emp and l.removed_at is null), '[]'::jsonb),
    'my_times', (select count(*) from public.da_rider_lines l where l.session_id = s.id and l.employee_id = v_emp and l.removed_at is null and l.source = 'rider'),
    'max_times', coalesce(private.setting_text('da.rider_times')::int, 3));
end $$;

create or replace function public.da_rider_submit(
  p_manager uuid, p_amount numeric, p_delivery integer default 0, p_pickup integer default 0,
  p_office boolean default false, p_mobile_banking numeric default 0, p_remarks text default null, p_date date default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_emp uuid := private.my_employee_id(); e public.employees; s public.da_sessions; c public.da_sheet_collectors;
        v_seq int; v_max int := coalesce(private.setting_text('da.rider_times')::int, 3); v_id uuid; v_date date := coalesce(p_date, private.da_today());
        v_open int; v_mgr uuid := p_manager;
begin
  if v_emp is null then raise exception 'আপনার লগইনের সাথে কোনো কর্মী যুক্ত নেই।' using errcode = '42501'; end if;
  select * into e from public.employees where id = v_emp;
  select * into s from public.da_sessions where hub_id = e.hub_id and account_date = v_date;
  if s.id is null then raise exception 'আজকের খাতা এখনো কোনো ম্যানেজার খোলেননি।' using errcode = 'P0002'; end if;
  if s.status not in ('open','correction') then raise exception 'আজকের হিসাব বন্ধ হয়ে গেছে।' using errcode = '22023'; end if;
  if v_mgr is null then
    select count(*) into v_open from public.da_sheet_collectors where session_id = s.id and closed_at is null;
    if v_open = 0 then raise exception 'এখন কোনো ম্যানেজারের খাতা খোলা নেই।' using errcode = '22023'; end if;
    if v_open > 1 then raise exception 'কোন ম্যানেজারের কাছে দিচ্ছেন — বেছে নিন।' using errcode = '22023'; end if;
    select user_id into v_mgr from public.da_sheet_collectors where session_id = s.id and closed_at is null;
  end if;
  if v_mgr = auth.uid() then raise exception 'নিজের খাতায় নিজে পাঠানো যায় না — খাতায় সরাসরি লিখুন।' using errcode = '22023'; end if;
  select * into c from public.da_sheet_collectors where session_id = s.id and user_id = v_mgr;
  if c.id is null then raise exception 'এই ম্যানেজার আজ খাতা খোলেননি।' using errcode = '22023'; end if;
  if c.closed_at is not null then raise exception '% এর খাতা বন্ধ — অন্য ম্যানেজার বাছুন।', c.name using errcode = '22023'; end if;
  if coalesce(p_amount,0) < 0 or coalesce(p_delivery,0) < 0 or coalesce(p_pickup,0) < 0 or coalesce(p_mobile_banking,0) < 0 then
    raise exception 'সংখ্যা বা টাকা ঋণাত্মক হতে পারে না।' using errcode = '22023'; end if;
  if not coalesce(p_office,false) and coalesce(p_delivery,0) = 0 and coalesce(p_pickup,0) = 0 and coalesce(p_amount,0) = 0 then
    raise exception 'পিকআপ, ডেলিভারি বা টাকা — অন্তত একটা দিন।' using errcode = '22023'; end if;
  select count(*) + 1 into v_seq from public.da_rider_lines
   where session_id = s.id and employee_id = v_emp and removed_at is null and source = 'rider';
  if v_seq > v_max then raise exception 'আজ সর্বোচ্চ % বার হিসাব দেওয়া যায়।', v_max using errcode = '22023'; end if;

  insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, employee_code, rider_name, mobile,
    delivery_qty, pickup_qty, amount, paid_amount, due_input, due, mobile_banking, remarks,
    collector_user, created_by, source, seq, office_deposit)
  values (s.id, s.hub_id, s.zone_id, v_emp, e.employee_code::text, e.full_name, e.mobile,
    coalesce(p_delivery,0), coalesce(p_pickup,0), coalesce(p_amount,0), coalesce(p_amount,0), 0,
    private.da_due(p_amount, p_amount, 0, p_mobile_banking), coalesce(p_mobile_banking,0),
    nullif(trim(coalesce(p_remarks,'') || case when p_office then ' · অফিসে টাকা জমা দিয়ে ডেলিভারিতে' else '' end), ''),
    v_mgr, v_mgr, 'rider', v_seq, coalesce(p_office,false))
  returning id into v_id;

  perform private.da_event(s.id, 'note', e.full_name || ' (#' || e.employee_code::text || ') নিজে হিসাব পাঠিয়েছে → ' || c.name || ' · বার ' || v_seq, false);
  perform private.notify(v_mgr, 'রাইডার হিসাব পাঠিয়েছে',
    e.full_name || ' · ' || coalesce(p_pickup,0) || ' পিকআপ · ' || coalesce(p_delivery,0) || ' ডেলিভারি · ৳' || coalesce(p_amount,0)::text
      || case when p_office then ' (অফিসে জমা)' else '' end,
    '/app/accounts/khata', 'da_rider_line');
  return v_id;
end $$;

create or replace function public.da_rider_accept(p_line uuid, p_accept boolean default true, p_note text default null)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare l public.da_rider_lines; s public.da_sessions;
begin
  select * into l from public.da_rider_lines where id = p_line and removed_at is null for update;
  if l.id is null then raise exception 'লাইন পাওয়া যায়নি।' using errcode = 'P0002'; end if;
  s := private.da_require_edit(l.session_id);
  if coalesce(l.collector_user, l.created_by) <> auth.uid() and not private.has_permission('da.sheet.approve', s.zone_id, s.hub_id) then
    raise exception 'এটা আপনার খাতার লাইন নয়।' using errcode = '42501'; end if;
  if l.source <> 'rider' then raise exception 'এই লাইন ম্যানেজার নিজে লিখেছেন, গ্রহণের দরকার নেই।' using errcode = '22023'; end if;
  if p_accept then
    if l.accepted_at is not null then return; end if;
    update public.da_rider_lines set accepted_at = now(), accepted_by = auth.uid() where id = l.id;
    perform private.da_event(s.id, 'note', l.rider_name || '-এর পাঠানো হিসাব গ্রহণ (বার ' || l.seq || ')', false);
    perform private.notify(e.profile_id, 'হিসাব গৃহীত', 'আপনার হিসাব (বার ' || l.seq || ') ম্যানেজার গ্রহণ করেছেন।', '/app', 'da_rider_line')
      from public.employees e where e.id = l.employee_id and e.profile_id is not null;
  else
    update public.da_rider_lines set removed_at = now(), removed_by = auth.uid(),
           remove_reason = coalesce(nullif(trim(p_note),''), 'ম্যানেজার ফেরত দিয়েছেন') where id = l.id;
    perform private.da_event(s.id, 'note', l.rider_name || '-এর পাঠানো হিসাব ফেরত: ' || coalesce(p_note,''), false);
    perform private.notify(e.profile_id, 'হিসাব ফেরত', coalesce(nullif(trim(p_note),''), 'ম্যানেজার হিসাবটি ফেরত দিয়েছেন — আবার পাঠান।'), '/app', 'da_rider_line')
      from public.employees e where e.id = l.employee_id and e.profile_id is not null;
  end if;
end $$;

-- এক ক্লিকে: আমার খাতায় রাইডারদের পাঠানো সব হিসাব গ্রহণ
create or replace function public.da_rider_accept_all(p_session uuid)
returns integer language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_n int := 0; x record;
begin
  perform private.da_require_edit(p_session);
  for x in select id from public.da_rider_lines
           where session_id = p_session and removed_at is null and source = 'rider' and accepted_at is null
             and coalesce(collector_user, created_by) = auth.uid()
           order by created_at
  loop
    perform public.da_rider_accept(x.id, true, null); v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.da_rider_open_managers(date), public.da_rider_submit(uuid,numeric,integer,integer,boolean,numeric,text,date),
  public.da_rider_accept(uuid,boolean,text), public.da_rider_accept_all(uuid) from public, anon;
grant execute on function public.da_rider_open_managers(date), public.da_rider_submit(uuid,numeric,integer,integer,boolean,numeric,text,date),
  public.da_rider_accept(uuid,boolean,text), public.da_rider_accept_all(uuid) to authenticated;
