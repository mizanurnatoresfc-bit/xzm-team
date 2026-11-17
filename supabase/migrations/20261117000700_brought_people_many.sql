-- =====================================================================
--  "যাঁদের এনেছেন" — যোগ, বদল, সরানো; একসাথে অনেকজন
--  * From a profile's "people they brought" list: add several employees at
--    once (this person brought them), change one's referrer, or remove the
--    link for several at once.
--  * HR (who may decide for that employee) applies at once; everyone else —
--    the person on their own profile, or a manager — sends requests that wait
--    for HR, exactly like 20261117000600.
--  * New column action ('set' | 'remove'); a removal keeps the referrer it
--    removes in referrer_id / manual, so the old check still holds.
--  Additive only (no DROP). Rollback: drop column action and the functions
--  hr_reference_many, hr_reference_brought_pending, private.ref_apply.
-- =====================================================================
alter table public.employee_reference_requests add column if not exists action text not null default 'set';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employee_reference_requests_action_check') then
    alter table public.employee_reference_requests add constraint employee_reference_requests_action_check check (action in ('set', 'remove'));
  end if;
end $$;

-- The current referrer of an employee may also ask about that employee (to change or remove the link).
create or replace function private.ref_can_ask(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_self_employee(p_employee) or private.employee_has_permission('hr.employee.view', p_employee)
      or private.employee_has_permission('hr.referral.edit', p_employee) or private.employee_has_permission('hr.employee.edit', p_employee)
      or exists (select 1 from public.employees e where e.id = p_employee and e.referred_by_employee_id is not null
                 and private.is_self_employee(e.referred_by_employee_id))
$$;

-- Set or remove one employee's referrer (the write HR's approval does).
create or replace function private.ref_apply(p_employee uuid, p_action text, p_referrer uuid, p_manual jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.change_reason', 'Reference ' || p_action || ' (referrals)', true);
  if p_action = 'remove' then
    update public.employees set referred_by_employee_id = null, reference_manual = null
     where id = p_employee and (p_referrer is null or referred_by_employee_id = p_referrer);
  else
    update public.employees set referred_by_employee_id = p_referrer, reference_manual = case when p_referrer is null then p_manual else null end
     where id = p_employee;
  end if;
end $$;

-- Many at once. p_action 'set': p_referrer brought every one of p_employees.
-- 'remove': clear the referrer of every one of p_employees (only if it is still p_referrer, when given).
-- Returns {"applied": n, "waiting": n}.
create or replace function public.hr_reference_many(p_employees uuid[], p_action text, p_referrer uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; e public.employees; v_applied integer := 0; v_wait integer := 0; v_names text[] := '{}'; v_zone uuid; v_ref text;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_action not in ('set', 'remove') then raise exception 'ভুল কাজ' using errcode = '22023'; end if;
  if coalesce(array_length(p_employees, 1), 0) = 0 then raise exception 'অন্তত একজন বাছুন' using errcode = '22023'; end if;
  if p_action = 'set' then
    if p_referrer is null then raise exception 'কে এনেছেন, বাছুন' using errcode = '22023'; end if;
    if not exists (select 1 from public.employees where id = p_referrer and archived_at is null) then raise exception 'এই আইডির কাউকে পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;
  select full_name into v_ref from public.employees where id = p_referrer;
  foreach v_emp in array (select array_agg(distinct x) from unnest(p_employees) x) loop
    select * into e from public.employees where id = v_emp and archived_at is null;
    if not found then raise exception 'কর্মীকে পাওয়া যায়নি' using errcode = 'P0002'; end if;
    if v_emp = p_referrer and p_action = 'set' then raise exception 'নিজেকে নিজের রেফারেন্স দেওয়া যায় না' using errcode = '22023'; end if;
    if not (private.ref_can_ask(v_emp) or private.ref_can_decide(v_emp) or (p_referrer is not null and private.ref_can_ask(p_referrer))) then
      raise exception '"%"-এর রেফারেন্স দেওয়ার অনুমতি নেই', e.full_name using errcode = '42501';
    end if;
    if p_action = 'remove' and e.referred_by_employee_id is null and e.reference_manual is null then continue; end if;
    if p_action = 'remove' and p_referrer is not null and e.referred_by_employee_id is distinct from p_referrer then continue; end if;
    update public.employee_reference_requests set status = 'cancelled', decided_at = now(), decision_note = 'নতুন অনুরোধ দেওয়া হয়েছে'
     where employee_id = v_emp and status = 'pending';
    if private.ref_can_decide(v_emp) then
      perform private.ref_apply(v_emp, p_action, p_referrer, null);
      v_applied := v_applied + 1;
    else
      insert into public.employee_reference_requests (employee_id, referrer_id, manual, note, requested_by_name, action)
      values (v_emp, case when p_action = 'remove' then e.referred_by_employee_id else p_referrer end,
              case when p_action = 'remove' and e.referred_by_employee_id is null then e.reference_manual end,
              nullif(trim(coalesce(p_note, '')), ''), private.my_display_name(), p_action);
      v_wait := v_wait + 1; v_names := v_names || e.full_name; v_zone := coalesce(v_zone, e.zone_id);
    end if;
  end loop;
  if v_wait > 0 then
    perform private.ref_notify_approvers(v_zone,
      case when p_action = 'set' then 'যাঁদের এনেছেন — অনুমোদন দিন: ' || coalesce(v_ref, '') else 'রেফারেন্স সরানো — অনুমোদন দিন' end,
      array_to_string(v_names[1:5], ', ') || case when v_wait > 5 then ' +' || (v_wait - 5) else '' end || ' · অনুরোধ: ' || private.my_display_name());
  end if;
  return jsonb_build_object('applied', v_applied, 'waiting', v_wait);
end $$;

-- Waiting requests that touch one person's "brought" list (added to it, or removed from it).
create or replace function public.hr_reference_brought_pending(p_referrer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.ref_can_ask(p_referrer) or private.ref_can_decide(p_referrer) then coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'action', r.action, 'at', r.requested_at, 'by', r.requested_by_name,
      'can_decide', private.ref_can_decide(r.employee_id),
      'employee', jsonb_build_object('id', e.id, 'name', e.full_name, 'code', e.employee_code::text,
        'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
        'hub', (select h.name from public.hubs h where h.id = e.hub_id))) order by r.requested_at)
    from public.employee_reference_requests r join public.employees e on e.id = r.employee_id
    where r.status = 'pending' and r.referrer_id = p_referrer), '[]'::jsonb) end
$$;

create or replace function public.hr_reference_pending(p_employee uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.ref_can_ask(p_employee) or private.ref_can_decide(p_employee) then (
    select jsonb_build_object('id', r.id, 'action', r.action, 'at', r.requested_at, 'by', r.requested_by_name, 'note', r.note, 'person', private.ref_person(r.referrer_id, r.manual),
      'can_decide', private.ref_can_decide(r.employee_id))
    from public.employee_reference_requests r where r.employee_id = p_employee and r.status = 'pending') end
$$;

create or replace function public.hr_reference_requests()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'action', r.action, 'status', r.status, 'at', r.requested_at, 'by', r.requested_by_name, 'note', r.note,
      'decided_by', r.decided_by_name, 'decided_at', r.decided_at, 'decision_note', r.decision_note, 'mine', r.requested_by = auth.uid(),
      'can_decide', r.status = 'pending' and private.ref_can_decide(r.employee_id),
      'employee', jsonb_build_object('id', e.id, 'name', e.full_name, 'code', e.employee_code::text, 'hub', (select h.name from public.hubs h where h.id = e.hub_id)),
      'person', private.ref_person(r.referrer_id, r.manual)) order by r.requested_at desc), '[]'::jsonb)
  from public.employee_reference_requests r join public.employees e on e.id = r.employee_id
  where (r.status = 'pending' and private.ref_can_decide(r.employee_id))
     or (r.requested_by = auth.uid() and r.requested_at > now() - interval '60 days')
$$;

create or replace function public.hr_reference_decide(p_ids uuid[], p_ok boolean, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare r public.employee_reference_requests; v_n integer := 0; v_name text;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if not p_ok and coalesce(trim(p_note), '') = '' then raise exception 'কেন হবে না, লিখুন' using errcode = '22023'; end if;
  for r in select * from public.employee_reference_requests where id = any (p_ids) and status = 'pending' for update loop
    if not private.ref_can_decide(r.employee_id) then raise exception 'এই রেফারেন্স অনুমোদনের অনুমতি নেই' using errcode = '42501'; end if;
    if p_ok then perform private.ref_apply(r.employee_id, r.action, r.referrer_id, r.manual); end if;
    update public.employee_reference_requests set status = case when p_ok then 'approved' else 'rejected' end, decided_by = auth.uid(),
      decided_by_name = private.my_display_name(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
    select full_name into v_name from public.employees where id = r.employee_id;
    perform private.notify(r.requested_by, case when r.action = 'remove' then 'রেফারেন্স সরানো: ' else 'যিনি এনেছেন: ' end
      || case when p_ok then 'অনুমোদিত' else 'হবে না' end,
      v_name || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''), '/app/me', 'hr_request');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.hr_reference_many(uuid[], text, uuid, text), public.hr_reference_brought_pending(uuid) from public, anon;
grant execute on function public.hr_reference_many(uuid[], text, uuid, text), public.hr_reference_brought_pending(uuid) to authenticated;
revoke all on function private.ref_apply(uuid, text, uuid, jsonb) from public, anon, authenticated;
