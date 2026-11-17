-- =====================================================================
--  রেফারেন্স তালিকা: যে কেউ যোগ / বদল / সরানোর অনুরোধ দেয়, HR অনুমোদন দিলে দেখায়
--  Builds on public.da_reference_people (live-only migration cash_payments_refs_…).
--  * Anyone signed in may ask to add a person — picked from a hub's staff
--    (hub → person) or written by hand (name, post, number, hub name) — or to
--    change / remove one. The request waits; people with hr.reference.approve
--    (admin, head office, HR manager) approve or turn it down, and the asker
--    is told. Until approved a new person is not in the list (status inactive),
--    and a change keeps the old values showing.
--  * Everyone signed in sees the approved list (it feeds the "রেফারেন্স"
--    dropdown of expenses); the asker sees their own requests; approvers see all.
--  Additive except the read rule, which is widened to everyone for the approved list (alter policy).
--  Rollback: drop the ref_* functions, put the read rule back as in cash_payments_refs_approvals_requests;
--  the added columns may stay.
-- =====================================================================
insert into public.permissions (code, module, resource, action, description) values
  ('hr.reference.approve', 'hr', 'reference', 'approve', 'Approve, change or turn down requests to add / change / remove people in the reference list')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'hr.reference.approve'
where r.code in ('admin', 'head_office_manager', 'hr_manager')
on conflict do nothing;

alter table public.da_reference_people
  add column if not exists approval text not null default 'approved' check (approval in ('pending', 'approved', 'rejected')),
  add column if not exists pending_action text check (pending_action in ('add', 'edit', 'remove')),
  add column if not exists pending_data jsonb,
  add column if not exists pending_note text,
  add column if not exists hub_name text,
  add column if not exists requested_by uuid,
  add column if not exists requested_by_name text,
  add column if not exists requested_at timestamptz,
  add column if not exists decided_by uuid,
  add column if not exists decided_by_name text,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;
create index if not exists da_reference_people_pending_idx on public.da_reference_people (requested_at) where pending_action is not null;
create index if not exists da_reference_people_requested_by_idx on public.da_reference_people (requested_by);
create index if not exists da_reference_people_list_idx on public.da_reference_people (name) where status = 'active' and approval = 'approved';

-- The read rule changes from "people of the hub's sheet" to: the approved list for everyone, own requests, approvers see all.
alter policy da_reference_people_read on public.da_reference_people
  using ((status = 'active' and approval = 'approved') or requested_by = (select auth.uid()) or private.has_permission('hr.reference.approve'));

-- HR who can approve: those with the right for the person's zone, else company-wide.
create or replace function private.ref_notify_approvers(p_zone uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid; v_n integer := 0; v_scope text;
begin
  foreach v_scope in array array['zone', 'global'] loop
    for u in
      select distinct ur.user_id from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
      join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
      left join public.role_permissions rp on rp.role_id = r.id left join public.permissions p on p.id = rp.permission_id
      where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
        and (p.code = 'hr.reference.approve' or r.is_super) and ur.scope_type = v_scope
        and (v_scope = 'global' or (p_zone is not null and ur.zone_id = p_zone)) and ur.user_id is distinct from auth.uid()
    loop
      perform private.notify(u, p_title, p_body, '/app/references?tab=approve', 'hr_request'); v_n := v_n + 1;
    end loop;
    exit when v_n > 0;
  end loop;
end $$;

-- The fields of a request, filled from the chosen employee when there is one.
create or replace function private.ref_fields(p_employee uuid, p_name text, p_position text, p_phone text, p_hub uuid, p_hub_name text, p_zone uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_hub uuid := p_hub; v jsonb;
begin
  if p_employee is not null then
    select * into e from public.employees where id = p_employee and archived_at is null;
    if not found then raise exception 'কর্মীকে পাওয়া যায়নি' using errcode = 'P0002'; end if;
    v_hub := coalesce(p_hub, e.hub_id);
  end if;
  v := jsonb_build_object(
    'employee_id', e.id,
    'profile_id', e.profile_id,
    'name', coalesce(nullif(trim(coalesce(p_name, '')), ''), e.full_name),
    'position', coalesce(nullif(trim(coalesce(p_position, '')), ''), (select coalesce(nullif(po.name_bn, ''), po.name) from public.positions po where po.id = e.position_id)),
    'phone', coalesce(nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''), e.mobile),
    'hub_id', v_hub,
    'hub_name', coalesce(nullif(trim(coalesce(p_hub_name, '')), ''), (select h.name from public.hubs h where h.id = v_hub)),
    'zone_id', coalesce(p_zone, private.hub_zone(v_hub)));
  if length(trim(coalesce(v ->> 'name', ''))) < 2 then raise exception 'নাম লিখুন' using errcode = '22023'; end if;
  if v ->> 'phone' is not null and length(v ->> 'phone') < 11 then raise exception 'মোবাইল নম্বর ঠিক নয়' using errcode = '22023'; end if;
  return v;
end $$;

create or replace function public.ref_request_add(p_employee uuid default null, p_name text default null, p_position text default null, p_phone text default null,
  p_hub uuid default null, p_hub_name text default null, p_zone uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_id uuid;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  v := private.ref_fields(p_employee, p_name, p_position, p_phone, p_hub, p_hub_name, p_zone);
  if exists (select 1 from public.da_reference_people r where (r.status = 'active' or r.approval = 'pending')
              and ((v ->> 'employee_id') is not null and r.employee_id = (v ->> 'employee_id')::uuid
                   or (v ->> 'phone') is not null and r.phone = v ->> 'phone')) then
    raise exception 'এই লোক আগেই তালিকায় আছেন বা অনুরোধ অপেক্ষায় আছে' using errcode = '23505'; end if;
  insert into public.da_reference_people (zone_id, hub_id, hub_name, name, position, phone, profile_id, employee_id, status, approval, pending_action, pending_note,
                                          requested_by, requested_by_name, requested_at)
  values ((v ->> 'zone_id')::uuid, (v ->> 'hub_id')::uuid, v ->> 'hub_name', v ->> 'name', v ->> 'position', v ->> 'phone', (v ->> 'profile_id')::uuid,
          (v ->> 'employee_id')::uuid, 'inactive', 'pending', 'add', nullif(trim(coalesce(p_note, '')), ''), auth.uid(), private.my_display_name(), now())
  returning id into v_id;
  perform private.ref_notify_approvers((v ->> 'zone_id')::uuid, 'রেফারেন্সে নতুন নাম: ' || (v ->> 'name'),
    concat_ws(' · ', v ->> 'position', v ->> 'hub_name', 'অনুরোধ: ' || private.my_display_name()));
  return v_id;
end $$;

create or replace function public.ref_request_edit(p_id uuid, p_employee uuid default null, p_name text default null, p_position text default null, p_phone text default null,
  p_hub uuid default null, p_hub_name text default null, p_zone uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.da_reference_people; v jsonb;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into r from public.da_reference_people where id = p_id for update;
  if not found then raise exception 'নামটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  v := private.ref_fields(coalesce(p_employee, r.employee_id), coalesce(p_name, r.name), coalesce(p_position, r.position), coalesce(p_phone, r.phone),
                          coalesce(p_hub, r.hub_id), coalesce(p_hub_name, r.hub_name), coalesce(p_zone, r.zone_id));
  if r.approval = 'pending' and r.pending_action = 'add' then
    if r.requested_by is distinct from auth.uid() and not private.has_permission('hr.reference.approve') then
      raise exception 'অন্যের অপেক্ষমাণ অনুরোধ বদলানো যায় না' using errcode = '42501'; end if;
    update public.da_reference_people set zone_id = (v ->> 'zone_id')::uuid, hub_id = (v ->> 'hub_id')::uuid, hub_name = v ->> 'hub_name', name = v ->> 'name',
      position = v ->> 'position', phone = v ->> 'phone', employee_id = (v ->> 'employee_id')::uuid, profile_id = (v ->> 'profile_id')::uuid,
      pending_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), pending_note), updated_at = now(), updated_by = auth.uid() where id = p_id;
    return;
  end if;
  if r.status <> 'active' then raise exception 'এই নাম তালিকায় নেই' using errcode = '22023'; end if;
  if r.pending_action is not null then raise exception 'এই নামের একটা অনুরোধ আগেই অপেক্ষায় আছে' using errcode = '23505'; end if;
  update public.da_reference_people set approval = 'pending', pending_action = 'edit', pending_data = v, pending_note = nullif(trim(coalesce(p_note, '')), ''),
    requested_by = auth.uid(), requested_by_name = private.my_display_name(), requested_at = now() where id = p_id;
  perform private.ref_notify_approvers(r.zone_id, 'রেফারেন্স বদলের অনুরোধ: ' || r.name, concat_ws(' · ', v ->> 'name', v ->> 'position', v ->> 'phone', 'অনুরোধ: ' || private.my_display_name()));
end $$;

create or replace function public.ref_request_remove(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.da_reference_people;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'কেন সরাতে চান, লিখুন' using errcode = '22023'; end if;
  select * into r from public.da_reference_people where id = p_id for update;
  if not found then raise exception 'নামটা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if r.approval = 'pending' and r.pending_action = 'add' then
    if r.requested_by is distinct from auth.uid() and not private.has_permission('hr.reference.approve') then
      raise exception 'অন্যের অপেক্ষমাণ অনুরোধ তুলে নেওয়া যায় না' using errcode = '42501'; end if;
    update public.da_reference_people set approval = 'rejected', pending_action = null, decision_note = 'তুলে নেওয়া: ' || trim(p_reason),
      decided_by = auth.uid(), decided_by_name = private.my_display_name(), decided_at = now() where id = p_id;
    return;
  end if;
  if r.status <> 'active' then raise exception 'এই নাম তালিকায় নেই' using errcode = '22023'; end if;
  if r.pending_action is not null then raise exception 'এই নামের একটা অনুরোধ আগেই অপেক্ষায় আছে' using errcode = '23505'; end if;
  update public.da_reference_people set approval = 'pending', pending_action = 'remove', pending_data = null, pending_note = trim(p_reason),
    requested_by = auth.uid(), requested_by_name = private.my_display_name(), requested_at = now() where id = p_id;
  perform private.ref_notify_approvers(r.zone_id, 'রেফারেন্স থেকে সরানোর অনুরোধ: ' || r.name, trim(p_reason) || ' · অনুরোধ: ' || private.my_display_name());
end $$;

-- HR: approve or turn down one or many requests.
create or replace function public.ref_decide(p_ids uuid[], p_ok boolean, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare r public.da_reference_people; v_n integer := 0; v_who text := private.my_display_name(); d jsonb; v_word text;
begin
  if not private.has_permission('hr.reference.approve') and not exists (
       select 1 from public.da_reference_people x where x.id = any (p_ids) and private.has_permission('hr.reference.approve', x.zone_id, null)) then
    raise exception 'রেফারেন্স অনুমোদনের অনুমতি নেই' using errcode = '42501'; end if;
  if not p_ok and coalesce(trim(p_note), '') = '' then raise exception 'কেন হবে না, লিখুন' using errcode = '22023'; end if;
  for r in select * from public.da_reference_people where id = any (p_ids) and pending_action is not null for update loop
    if not (private.has_permission('hr.reference.approve') or private.has_permission('hr.reference.approve', r.zone_id, null)) then continue; end if;
    d := r.pending_data;
    if p_ok then
      if r.pending_action = 'add' then
        update public.da_reference_people set status = 'active', approval = 'approved', pending_action = null where id = r.id;
      elsif r.pending_action = 'edit' then
        update public.da_reference_people set zone_id = (d ->> 'zone_id')::uuid, hub_id = (d ->> 'hub_id')::uuid, hub_name = d ->> 'hub_name', name = d ->> 'name',
          position = d ->> 'position', phone = d ->> 'phone', employee_id = (d ->> 'employee_id')::uuid, profile_id = (d ->> 'profile_id')::uuid,
          approval = 'approved', pending_action = null, pending_data = null, updated_at = now(), updated_by = auth.uid() where id = r.id;
      else
        update public.da_reference_people set status = 'inactive', approval = 'approved', pending_action = null where id = r.id;
      end if;
    else
      update public.da_reference_people set approval = case when r.pending_action = 'add' then 'rejected' else 'approved' end,
        pending_action = null, pending_data = null where id = r.id;
    end if;
    update public.da_reference_people set decided_by = auth.uid(), decided_by_name = v_who, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
    v_word := case r.pending_action when 'add' then 'যোগ' when 'edit' then 'বদল' else 'সরানো' end;
    perform private.notify(r.requested_by, 'রেফারেন্স ' || v_word || ': ' || case when p_ok then 'অনুমোদিত' else 'হবে না' end,
      r.name || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''), '/app/references?tab=mine', 'hr_request');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- People of a hub to pick from (hub → person). Name, ID, post and mobile of active staff only.
create or replace function public.ref_hub_people(p_hub uuid)
returns table (id uuid, employee_code text, full_name text, post text, mobile text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_code::text, e.full_name, coalesce(nullif(po.name_bn, ''), po.name), e.mobile
  from public.employees e left join public.positions po on po.id = e.position_id
  where auth.uid() is not null and e.hub_id = p_hub and e.archived_at is null and e.status = 'active'
  order by e.full_name limit 1000
$$;

do $$
declare f text;
begin
  foreach f in array array['public.ref_request_add(uuid, text, text, text, uuid, text, uuid, text)',
    'public.ref_request_edit(uuid, uuid, text, text, text, uuid, text, uuid, text)', 'public.ref_request_remove(uuid, text)',
    'public.ref_decide(uuid[], boolean, text)', 'public.ref_hub_people(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.ref_notify_approvers(uuid, text, text), private.ref_fields(uuid, text, text, text, uuid, text, uuid) from public, anon, authenticated;
