-- =====================================================================
--  প্রোফাইল থেকে "যিনি এনেছেন" — স্টাফ নিজে বা তাঁর ম্যানেজার দেন, HR অনুমোদন দিলে বসে
--  * A staff member (own profile) or anyone who may see that employee
--    (hr.employee.view for their hub/zone) asks to set who referred them:
--    a person in the system or one written by hand (name, ID, post, number, hub).
--  * The request waits; HR (hr.reference.approve, or hr.referral.edit for that
--    employee) approves — then employees.referred_by_employee_id /
--    reference_manual are set exactly as hr_set_reference does — or turns it
--    down with a reason. Both sides are notified. One waiting request per
--    employee; a new one replaces the old.
--  Additive only. Rollback: drop table employee_reference_requests and the
--  hr_reference_* functions created here.
-- =====================================================================
create table if not exists public.employee_reference_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  referrer_id uuid references public.employees(id),
  manual jsonb,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid not null default auth.uid(),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by uuid, decided_by_name text, decided_at timestamptz, decision_note text,
  check (referrer_id is not null or manual is not null)
);
create unique index if not exists employee_reference_requests_one on public.employee_reference_requests (employee_id) where status = 'pending';
create index if not exists employee_reference_requests_referrer_idx on public.employee_reference_requests (referrer_id);
create index if not exists employee_reference_requests_status_idx on public.employee_reference_requests (requested_at) where status = 'pending';
alter table public.employee_reference_requests enable row level security;
revoke all on public.employee_reference_requests from anon, authenticated;   -- read and written through the functions below

create or replace function private.ref_can_ask(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_self_employee(p_employee) or private.employee_has_permission('hr.employee.view', p_employee)
      or private.employee_has_permission('hr.referral.edit', p_employee) or private.employee_has_permission('hr.employee.edit', p_employee)
$$;
create or replace function private.ref_can_decide(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission('hr.reference.approve') or private.employee_has_permission('hr.reference.approve', p_employee)
      or private.employee_has_permission('hr.referral.edit', p_employee)
$$;

-- What a request shows: the referrer's name, ID, post, hub, number.
create or replace function private.ref_person(p_referrer uuid, p_manual jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_referrer is not null then (
    select jsonb_build_object('kind', 'employee', 'id', e.id, 'name', e.full_name, 'code', e.employee_code::text,
      'position', (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id),
      'hub', (select h.name from public.hubs h where h.id = e.hub_id), 'mobile', e.mobile)
    from public.employees e where e.id = p_referrer)
  else jsonb_build_object('kind', 'manual') || coalesce(p_manual, '{}'::jsonb) end
$$;

create or replace function public.hr_reference_request(p_employee uuid, p_referrer uuid default null, p_manual jsonb default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_manual jsonb; v_id uuid; e public.employees; v_who jsonb;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into e from public.employees where id = p_employee and archived_at is null;
  if not found then raise exception 'কর্মীকে পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.ref_can_ask(p_employee) then raise exception 'এই কর্মীর রেফারেন্স দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_referrer is not null then
    if p_referrer = p_employee then raise exception 'নিজেকে নিজের রেফারেন্স দেওয়া যায় না' using errcode = '22023'; end if;
    if not exists (select 1 from public.employees where id = p_referrer and archived_at is null) then raise exception 'এই আইডির কাউকে পাওয়া যায়নি' using errcode = 'P0002'; end if;
  else
    v_manual := jsonb_strip_nulls(jsonb_build_object(
      'name', nullif(trim(p_manual ->> 'name'), ''), 'code', nullif(trim(p_manual ->> 'code'), ''),
      'hub', nullif(trim(p_manual ->> 'hub'), ''), 'position', nullif(trim(p_manual ->> 'position'), ''),
      'mobile', nullif(regexp_replace(coalesce(p_manual ->> 'mobile', ''), '[^0-9+]', '', 'g'), '')));
    if coalesce(v_manual ->> 'name', '') = '' then raise exception 'রেফারেন্সের নাম দিন' using errcode = '22023'; end if;
  end if;
  update public.employee_reference_requests set status = 'cancelled', decided_at = now(), decision_note = 'নতুন অনুরোধ দেওয়া হয়েছে'
   where employee_id = p_employee and status = 'pending';
  insert into public.employee_reference_requests (employee_id, referrer_id, manual, note, requested_by_name)
  values (p_employee, p_referrer, v_manual, nullif(trim(coalesce(p_note, '')), ''), private.my_display_name()) returning id into v_id;
  v_who := private.ref_person(p_referrer, v_manual);
  perform private.ref_notify_approvers(e.zone_id, 'যিনি এনেছেন — অনুমোদন দিন: ' || e.full_name,
    concat_ws(' · ', 'রেফারেন্স: ' || (v_who ->> 'name'), v_who ->> 'position', v_who ->> 'hub', 'অনুরোধ: ' || private.my_display_name()));
  return v_id;
end $$;

-- The waiting request of one employee (for the profile), if the caller may see it.
create or replace function public.hr_reference_pending(p_employee uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.ref_can_ask(p_employee) or private.ref_can_decide(p_employee) then (
    select jsonb_build_object('id', r.id, 'at', r.requested_at, 'by', r.requested_by_name, 'note', r.note, 'person', private.ref_person(r.referrer_id, r.manual),
      'can_decide', private.ref_can_decide(r.employee_id))
    from public.employee_reference_requests r where r.employee_id = p_employee and r.status = 'pending') end
$$;

-- HR's list: every waiting request the caller may decide, and the caller's own recent ones.
create or replace function public.hr_reference_requests()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'at', r.requested_at, 'by', r.requested_by_name, 'note', r.note,
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
    if p_ok then
      perform set_config('app.change_reason', 'Reference set (approved request)', true);
      update public.employees set referred_by_employee_id = r.referrer_id, reference_manual = case when r.referrer_id is null then r.manual else null end
       where id = r.employee_id;
    end if;
    update public.employee_reference_requests set status = case when p_ok then 'approved' else 'rejected' end, decided_by = auth.uid(),
      decided_by_name = private.my_display_name(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
    select full_name into v_name from public.employees where id = r.employee_id;
    perform private.notify(r.requested_by, 'যিনি এনেছেন: ' || case when p_ok then 'অনুমোদিত' else 'হবে না' end,
      v_name || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''), '/app/me', 'hr_request');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.hr_reference_request(uuid, uuid, jsonb, text)', 'public.hr_reference_pending(uuid)',
    'public.hr_reference_requests()', 'public.hr_reference_decide(uuid[], boolean, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.ref_can_ask(uuid), private.ref_can_decide(uuid), private.ref_person(uuid, jsonb) from public, anon;
grant execute on function private.ref_can_ask(uuid), private.ref_can_decide(uuid), private.ref_person(uuid, jsonb) to authenticated;
