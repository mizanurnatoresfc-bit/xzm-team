-- =====================================================================
-- XZM-TEAM ERP — Migration: "লোক লাগবে" (manpower requests) and the
-- staff change register used for company Excel files.
--
--  * manpower_requests: any staff member asks for people for their hub
--    (post, how many, why, daily pickup / delivery / big parcels, other
--    issues). Zonal/HR approvers decide; on approval the hub or the whole
--    zone is told (optionally only chosen posts) so whoever knows someone
--    can refer them. Approvers are told about new requests.
--  * hr_change_register(): one list of every staff change in a period —
--    transfers / promotions / corrections done in the system, status
--    changes (inactive -> active etc.) and marked HR requests (transfer,
--    active, inactive, ID create) — so a zonal manager can export one file.
--  Nothing is hard-deleted.
-- =====================================================================

create sequence if not exists public.manpower_request_no_seq;
create table public.manpower_requests (
  id              uuid primary key default gen_random_uuid(),
  request_no      text not null unique default ('MP-' || lpad(nextval('public.manpower_request_no_seq')::text, 5, '0')),
  zone_id         uuid not null references public.zones(id),
  hub_id          uuid not null references public.hubs(id),
  position_id     uuid references public.positions(id),
  needed          integer not null check (needed between 1 and 200),
  reason          text not null check (length(trim(reason)) > 2),
  daily_pickup    integer check (daily_pickup >= 0),
  daily_delivery  integer check (daily_delivery >= 0),
  big_parcels     integer check (big_parcels >= 0),
  other_issues    text,
  status          text not null default 'submitted' check (status in ('submitted','approved','rejected','filled','closed','cancelled')),
  scope           text not null default 'hub' check (scope in ('hub','zone')),
  notify_positions uuid[] not null default '{}',
  filled          integer not null default 0 check (filled >= 0),
  submitted_by    uuid not null default auth.uid(),
  submitter_employee_id uuid references public.employees(id),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  notified_count  integer not null default 0,
  created_at      timestamptz not null default now(), created_by uuid,
  updated_at      timestamptz not null default now(), updated_by uuid
);
create index manpower_requests_zone_idx on public.manpower_requests (zone_id, status, created_at desc);
create index manpower_requests_hub_idx on public.manpower_requests (hub_id);
create index manpower_requests_position_idx on public.manpower_requests (position_id);
create index manpower_requests_submitter_idx on public.manpower_requests (submitter_employee_id);
create trigger manpower_requests_stamp before insert or update on public.manpower_requests for each row execute function private.stamp_row();
create trigger manpower_requests_audit after insert or update or delete on public.manpower_requests for each row execute function private.audit_row('hr');
create trigger manpower_requests_no_delete before delete on public.manpower_requests for each row execute function private.prevent_delete();
alter table public.manpower_requests enable row level security;

-- Who may read: the submitter, anyone with HR request rights in scope, and —
-- once approved — every staff member of that hub (hub scope) or zone (zone scope).
create or replace function private.mp_can_read(r public.manpower_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.submitted_by = (select auth.uid())
      or private.has_permission('hr.request.view', r.zone_id, r.hub_id)
      or (r.status = 'approved' and exists (
            select 1 from public.employees e
             where e.profile_id = (select auth.uid()) and e.archived_at is null
               and (e.hub_id = r.hub_id or (r.scope = 'zone' and e.zone_id = r.zone_id))))
$$;
create policy manpower_requests_read on public.manpower_requests for select to authenticated using (private.mp_can_read(manpower_requests));
grant select on public.manpower_requests to authenticated;

-- Profiles that can approve requests for this zone (global or zone grants, and super admins).
create or replace function private.request_approvers(p_zone uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
   where ur.revoked_at is null and (ur.valid_to is null or ur.valid_to >= current_date) and ur.valid_from <= current_date
     and (r.is_super or p.code = 'hr.request.approve')
     and (ur.scope_type = 'global' or (ur.scope_type = 'zone' and ur.zone_id = p_zone))
$$;
revoke all on function private.request_approvers(uuid) from public, anon, authenticated;

create or replace function public.mp_submit(
  p_hub uuid, p_position uuid, p_needed integer, p_reason text,
  p_pickup integer default null, p_delivery integer default null, p_big integer default null, p_issues text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_zone uuid; v_hub_name text; v_id uuid; v_no text; v_post text; a uuid;
begin
  select * into v_me from public.employees where profile_id = auth.uid() and archived_at is null limit 1;
  select zone_id, name into v_zone, v_hub_name from public.hubs where id = p_hub and archived_at is null;
  if v_zone is null then raise exception 'হাব পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not (v_me.hub_id = p_hub or private.has_permission('hr.request.create', v_zone, p_hub)) then
    raise exception 'শুধু নিজের হাবের জন্য লোক চাইতে পারবেন' using errcode = '42501';
  end if;
  if coalesce(p_needed, 0) < 1 then raise exception 'কতজন লাগবে লিখুন' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'কেন লাগবে লিখুন' using errcode = '22023'; end if;
  insert into public.manpower_requests (zone_id, hub_id, position_id, needed, reason, daily_pickup, daily_delivery, big_parcels, other_issues, submitter_employee_id)
  values (v_zone, p_hub, p_position, p_needed, trim(p_reason), p_pickup, p_delivery, p_big, nullif(trim(coalesce(p_issues, '')), ''), v_me.id)
  returning id, request_no into v_id, v_no;
  select coalesce(name_bn, name) into v_post from public.positions where id = p_position;
  for a in select private.request_approvers(v_zone) loop
    perform private.notify(a, 'লোক লাগবে: ' || v_hub_name || ' — ' || coalesce(v_post, 'যেকোনো পদ') || ' ' || p_needed || ' জন',
      v_no || ' · ' || trim(p_reason), '/app/manpower?id=' || v_id, 'manpower');
  end loop;
  return v_id;
end $$;

create or replace function public.mp_decide(
  p_id uuid, p_status text, p_note text default null, p_scope text default 'hub',
  p_notify_positions uuid[] default '{}', p_needed integer default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.manpower_requests;
  v_hub_name text; v_post text; v_title text; v_count integer := 0; p uuid;
begin
  select * into r from public.manpower_requests where id = p_id for update;
  if r.id is null then raise exception 'চাহিদা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.request.approve', r.zone_id, r.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if r.status <> 'submitted' then raise exception 'এই চাহিদার সিদ্ধান্ত আগেই হয়েছে' using errcode = 'P0001'; end if;
  if p_status not in ('approved','rejected') then raise exception 'ভুল সিদ্ধান্ত' using errcode = '22023'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'বাতিলের কারণ লিখুন' using errcode = '22023'; end if;
  if p_scope not in ('hub','zone') then raise exception 'ভুল এলাকা' using errcode = '22023'; end if;

  update public.manpower_requests
     set status = p_status, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''),
         scope = p_scope, notify_positions = coalesce(p_notify_positions, '{}'), needed = coalesce(p_needed, needed)
   where id = p_id returning * into r;
  select name into v_hub_name from public.hubs where id = r.hub_id;
  select coalesce(name_bn, name) into v_post from public.positions where id = r.position_id;

  perform private.notify(r.submitted_by, 'লোক লাগবে ' || r.request_no || ': ' || case when p_status = 'approved' then 'অনুমোদিত' else 'বাতিল' end,
    r.decision_note, '/app/manpower?id=' || r.id, 'manpower');
  if p_status = 'approved' then
    v_title := 'লোক লাগবে — ' || v_hub_name || ': ' || coalesce(v_post, 'যেকোনো পদ') || ' ' || r.needed || ' জন';
    for p in
      select distinct e.profile_id from public.employees e
       where e.profile_id is not null and e.archived_at is null and e.status = 'active'
         and (case when r.scope = 'zone' then e.zone_id = r.zone_id else e.hub_id = r.hub_id end)
         and (cardinality(r.notify_positions) = 0 or e.position_id = any(r.notify_positions))
         and e.profile_id is distinct from r.submitted_by
    loop
      perform private.notify(p, v_title, 'পরিচিত কেউ থাকলে রেফার করুন। ' || r.reason, '/app/manpower?id=' || r.id, 'manpower');
      v_count := v_count + 1;
    end loop;
    update public.manpower_requests set notified_count = v_count where id = r.id;
  end if;
  return v_count;
end $$;

-- Close an approved request (people found / no longer needed) or withdraw one's own.
create or replace function public.mp_close(p_id uuid, p_status text, p_filled integer default null, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.manpower_requests;
begin
  select * into r from public.manpower_requests where id = p_id for update;
  if r.id is null then raise exception 'চাহিদা পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if p_status = 'cancelled' then
    if r.submitted_by <> auth.uid() or r.status <> 'submitted' then raise exception 'শুধু নিজের, সিদ্ধান্ত না হওয়া চাহিদা তুলে নেওয়া যায়' using errcode = '42501'; end if;
  elsif p_status in ('filled','closed') then
    if not private.has_permission('hr.request.approve', r.zone_id, r.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if r.status <> 'approved' then raise exception 'শুধু অনুমোদিত চাহিদা বন্ধ করা যায়' using errcode = 'P0001'; end if;
  else raise exception 'ভুল অবস্থা' using errcode = '22023';
  end if;
  update public.manpower_requests set status = p_status, filled = coalesce(p_filled, filled),
         decision_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decision_note)
   where id = p_id;
end $$;

revoke all on function public.mp_submit(uuid, uuid, integer, text, integer, integer, integer, text) from public, anon;
revoke all on function public.mp_decide(uuid, text, text, text, uuid[], integer) from public, anon;
revoke all on function public.mp_close(uuid, text, integer, text) from public, anon;
grant execute on function public.mp_submit(uuid, uuid, integer, text, integer, integer, integer, text) to authenticated;
grant execute on function public.mp_decide(uuid, text, text, text, uuid[], integer) to authenticated;
grant execute on function public.mp_close(uuid, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- Staff change register (for the company Excel file)
-- ---------------------------------------------------------------------
create or replace function public.hr_change_register(p_zone uuid, p_from date, p_to date)
returns table (source text, kind text, event_date date, employee_id uuid, employee_code text, full_name text, mobile text,
               position_name text, from_hub text, to_hub text, from_status text, to_status text, reason text,
               request_no text, request_status text, reference text, done_by text, recorded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- moves made in the system (not joining / exit, which show as status)
  select 'system', a.change_type, a.effective_from, e.id, e.employee_code::text, e.full_name, e.mobile,
         coalesce(po.name_bn, po.name), ph.name, h.name, null::text, null::text, a.reason, null::text, null::text, null::text,
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = a.created_by limit 1),
         a.created_at
    from public.employee_assignments a
    join public.employees e on e.id = a.employee_id
    left join public.positions po on po.id = a.position_id
    left join public.hubs h on h.id = a.hub_id
    left join lateral (select p.hub_id from public.employee_assignments p where p.employee_id = a.employee_id and p.id <> a.id
                         and p.effective_to is not null and p.effective_from <= a.effective_from
                       order by p.effective_to desc, p.effective_from desc limit 1) prev on true
    left join public.hubs ph on ph.id = prev.hub_id
   where a.change_type in ('transfer','promotion','correction')
     and a.effective_from between p_from and p_to
     and (p_zone is null or a.zone_id = p_zone or e.zone_id = p_zone)
     and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  union all
  -- status changes (inactive -> active, resign, terminate ...)
  select 'system', 'status', (l.occurred_at at time zone 'Asia/Dhaka')::date, e.id, e.employee_code::text, e.full_name, e.mobile,
         coalesce(po.name_bn, po.name), h.name, null, l.old_data ->> 'status', l.new_data ->> 'status', l.reason, null, null, null,
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = l.actor_id limit 1),
         l.occurred_at
    from public.audit_logs l
    join public.employees e on e.id::text = l.record_id
    left join public.positions po on po.id = e.position_id
    left join public.hubs h on h.id = e.hub_id
   where l.table_name = 'employees' and 'status' = any(l.changed_fields)
     and coalesce(l.old_data ->> 'status', '') <> 'applicant'
     and (l.occurred_at at time zone 'Asia/Dhaka')::date between p_from and p_to
     and (p_zone is null or e.zone_id = p_zone)
     and private.has_permission('hr.employee.view', e.zone_id, e.hub_id)
  union all
  -- HR requests (marked for the company file)
  select 'request', r.kind, coalesce(nullif(r.data ->> 'effective_date', '')::date, nullif(r.data ->> 'last_date', '')::date, (r.created_at at time zone 'Asia/Dhaka')::date),
         e.id, coalesce(e.employee_code::text, r.data ->> 'employee_code'), coalesce(e.full_name, r.data ->> 'full_name'), coalesce(e.mobile, r.data ->> 'mobile'),
         coalesce(po.name_bn, po.name, r.data ->> 'position'), coalesce(h.name, r.data ->> 'from_hub', r.data ->> 'hub'),
         coalesce(th.name, case when r.data ->> 'to_hub' !~ '^[0-9a-f-]{36}$' then r.data ->> 'to_hub' end),
         null, null, coalesce(r.data ->> 'reason', r.data ->> 'reason_type', r.note), r.request_no, r.status,
         nullif(concat_ws(' ', r.ref_name, '(' || r.ref_code || ')'), ''),
         (select coalesce(x.full_name, pr.full_name) from public.profiles pr left join public.employees x on x.profile_id = pr.id where pr.id = r.submitted_by limit 1),
         r.created_at
    from public.hr_requests r
    left join public.employees e on e.id = r.employee_id
    left join public.positions po on po.id = e.position_id
    left join public.hubs h on h.id = coalesce(e.hub_id, r.hub_id)
    left join public.hubs th on th.id::text = r.data ->> 'to_hub'
   where r.kind in ('id_transfer','id_active','id_inactive','id_create') and r.status <> 'cancelled'
     and (r.created_at at time zone 'Asia/Dhaka')::date between p_from and p_to
     and (p_zone is null or r.zone_id = p_zone)
     and private.has_permission('hr.request.view', r.zone_id, r.hub_id)
  order by 18 desc
$$;
revoke all on function public.hr_change_register(uuid, date, date) from public, anon;
grant execute on function public.hr_change_register(uuid, date, date) to authenticated;

-- Hub x post headcount (active staff) with open manpower needs, for the zonal matrix.
create or replace function public.hr_hub_post_matrix(p_zone uuid default null)
returns table (hub_id uuid, hub_name text, position_id uuid, position_name text, sort_order integer, active integer, inactive integer, applicant integer, needed integer)
language sql stable security definer set search_path = '' as $$
  with staff as (
    select e.hub_id, e.position_id,
           count(*) filter (where e.status = 'active')::integer act,
           count(*) filter (where e.status = 'inactive')::integer inact,
           count(*) filter (where e.status = 'applicant')::integer appl
      from public.employees e
     where e.archived_at is null and e.hub_id is not null and e.status in ('active','inactive','applicant')
     group by 1, 2),
  need as (
    select m.hub_id, m.position_id, sum(greatest(m.needed - m.filled, 0))::integer n
      from public.manpower_requests m where m.status = 'approved' group by 1, 2)
  select h.id, h.name, coalesce(s.position_id, n.position_id), coalesce(p.name_bn, p.name, 'পদ ছাড়া'), coalesce(p.sort_order, 999),
         coalesce(s.act, 0), coalesce(s.inact, 0), coalesce(s.appl, 0), coalesce(n.n, 0)
    from public.hubs h
    join (select hub_id, position_id from staff union select hub_id, position_id from need) k on k.hub_id = h.id
    left join staff s on s.hub_id = k.hub_id and s.position_id is not distinct from k.position_id
    left join need n on n.hub_id = k.hub_id and n.position_id is not distinct from k.position_id
    left join public.positions p on p.id = k.position_id
   where h.archived_at is null and (p_zone is null or h.zone_id = p_zone)
     and private.has_permission('hr.employee.view', h.zone_id, h.id)
   order by h.name, 5
$$;
revoke all on function public.hr_hub_post_matrix(uuid) from public, anon;
grant execute on function public.hr_hub_post_matrix(uuid) to authenticated;
