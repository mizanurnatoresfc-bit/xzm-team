-- =====================================================================
--  HR & Operation requests ("রিপোর্ট সাবমিট")
--  * hr_request_formats: configurable formats (ID CREATE / TRANSFER / ACTIVE /
--    INACTIVE-REMOVE + any new report name) with their own field list.
--  * hr_requests: one submitted form; status log in hr_request_events.
--  * Staff/managers may always send ID ACTIVE / ID INACTIVE (resign) for
--    THEMSELVES (formats marked self_service). Submitting for others needs
--    hr.request.create in that hub; HR decides with hr.request.approve.
--  * notifications: in-app notices (bell) — reference person, the employee
--    and the submitter are told about new requests and every status change.
--  Nothing is hard-deleted.
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('hr.request.view',      'hr', 'request', 'view',      'See HR / operation requests in scope'),
  ('hr.request.create',    'hr', 'request', 'create',    'Submit HR requests for staff in scope (ID create, transfer, active, inactive)'),
  ('hr.request.approve',    'hr', 'request', 'approve',    'Process, complete or reject HR requests'),
  ('hr.request.configure', 'hr', 'request', 'configure', 'Add / edit / remove request formats and their fields')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager', 'hr_manager') and p.code like 'hr.request.%')
  or (r.code = 'zonal_manager' and p.code in ('hr.request.view', 'hr.request.create', 'hr.request.approve'))
  or (r.code in ('operations_manager', 'hub_manager') and p.code in ('hr.request.view', 'hr.request.create'))
  or (r.code in ('pickup_manager', 'delivery_manager') and p.code = 'hr.request.create')
  or (r.code = 'auditor' and p.code = 'hr.request.view')
) on conflict do nothing;

-- ---------------------------------------------------------------------
create table public.hr_request_formats (
  id            uuid primary key default gen_random_uuid(),
  code          extensions.citext not null unique,
  kind          text not null default 'custom' check (kind in ('id_create','id_transfer','id_active','id_inactive','custom')),
  name          text not null check (length(trim(name)) > 1),
  name_bn       text,
  description   text,
  fields        jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  needs_employee boolean not null default true,
  self_service  boolean not null default false,
  sort_order    integer not null default 100,
  archived_at   timestamptz,
  archived_by   uuid,
  archive_reason text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);

create sequence public.hr_request_no_seq;
create table public.hr_requests (
  id            uuid primary key default gen_random_uuid(),
  request_no    text not null unique default ('HR-' || lpad(nextval('public.hr_request_no_seq')::text, 5, '0')),
  format_id     uuid not null references public.hr_request_formats(id),
  kind          text not null,
  employee_id   uuid references public.employees(id),
  zone_id       uuid not null references public.zones(id),
  hub_id        uuid references public.hubs(id),
  data          jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  note          text,
  status        text not null default 'submitted' check (status in ('submitted','processing','done','rejected','cancelled')),
  submitted_by  uuid not null default auth.uid(),
  submitter_employee_id uuid references public.employees(id),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  result        text,
  ref_employee_id uuid references public.employees(id),
  ref_name      text,
  ref_code      text,
  ref_hub       text,
  ref_position  text,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid
);
create index hr_requests_status_idx on public.hr_requests (status, created_at desc);
create index hr_requests_employee_idx on public.hr_requests (employee_id);
create index hr_requests_ref_idx on public.hr_requests (ref_employee_id);
create index hr_requests_submitter_idx on public.hr_requests (submitted_by);
create index hr_requests_hub_idx on public.hr_requests (hub_id);

create table public.hr_request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.hr_requests(id),
  status      text not null,
  note        text,
  by_user     uuid default auth.uid(),
  by_name     text,
  at          timestamptz not null default now()
);
create index hr_request_events_req_idx on public.hr_request_events (request_id, at);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null,
  title       text not null,
  body        text,
  link        text,
  kind        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_profile_idx on public.notifications (profile_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['hr_request_formats','hr_requests'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'hr');
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger hr_request_events_no_delete before delete on public.hr_request_events for each row execute function private.prevent_delete();
create trigger notifications_no_delete before delete on public.notifications for each row execute function private.prevent_delete();

-- ---------------------------------------------------------------------
alter table public.hr_request_formats enable row level security;
alter table public.hr_requests enable row level security;
alter table public.hr_request_events enable row level security;
alter table public.notifications enable row level security;
revoke all on public.hr_request_formats, public.hr_requests, public.hr_request_events, public.notifications from anon;

create policy hr_request_formats_read on public.hr_request_formats for select to authenticated using (true);
create policy hr_request_formats_insert on public.hr_request_formats for insert to authenticated
  with check (private.has_permission('hr.request.configure'));
create policy hr_request_formats_update on public.hr_request_formats for update to authenticated
  using (private.has_permission('hr.request.configure')) with check (private.has_permission('hr.request.configure'));
grant select, insert, update on public.hr_request_formats to authenticated;

create policy hr_requests_read on public.hr_requests for select to authenticated using (
  submitted_by = auth.uid()
  or (employee_id is not null and employee_id = private.my_employee_id())
  or (ref_employee_id is not null and ref_employee_id = private.my_employee_id())
  or private.has_permission('hr.request.view', zone_id, hub_id)
  or private.has_permission('hr.request.approve', zone_id, hub_id));
grant select on public.hr_requests to authenticated;

create policy hr_request_events_read on public.hr_request_events for select to authenticated
  using (exists (select 1 from public.hr_requests r where r.id = request_id));
grant select on public.hr_request_events to authenticated;

create policy notifications_read on public.notifications for select to authenticated using (profile_id = auth.uid());
create policy notifications_mark on public.notifications for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
grant select, update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------
create or replace function private.notify(p_profile uuid, p_title text, p_body text, p_link text, p_kind text default 'hr_request')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (profile_id, title, body, link, kind)
  select p_profile, p_title, p_body, p_link, p_kind where p_profile is not null and p_profile is distinct from auth.uid();
$$;

create or replace function private.my_display_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.full_name || coalesce(' (' || e.employee_code || ')', '') from public.employees e where e.profile_id = auth.uid() and e.archived_at is null limit 1),
                  (select p.full_name from public.profiles p where p.id = auth.uid()), 'System')
$$;

create or replace function private.hr_request_label(p_status text) returns text
language sql immutable set search_path = '' as $$
  select case p_status when 'submitted' then 'জমা হয়েছে' when 'processing' then 'কাজ চলছে' when 'done' then 'সম্পন্ন'
    when 'rejected' then 'বাতিল (রিজেক্ট)' when 'cancelled' then 'তুলে নেওয়া হয়েছে' else p_status end
$$;

create or replace function public.hr_request_submit(
  p_format uuid, p_employee uuid, p_hub uuid, p_data jsonb, p_note text default null,
  p_ref_employee uuid default null, p_ref_name text default null, p_ref_code text default null,
  p_ref_hub text default null, p_ref_position text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  f public.hr_request_formats;
  e public.employees;
  v_me uuid := private.my_employee_id();
  v_hub uuid := p_hub;
  v_zone uuid;
  v_id uuid;
  v_no text;
  v_field jsonb;
  v_ref public.employees;
  v_self boolean := false;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  select * into f from public.hr_request_formats where id = p_format and archived_at is null;
  if not found then raise exception 'ফরম্যাট পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'তথ্য দিন' using errcode = '22023'; end if;

  if f.needs_employee then
    if p_employee is null then raise exception 'স্টাফ বেছে নিন' using errcode = '22023'; end if;
    select * into e from public.employees where id = p_employee and archived_at is null;
    if not found then raise exception 'স্টাফ পাওয়া যায়নি' using errcode = 'P0002'; end if;
    v_hub := coalesce(e.hub_id, p_hub);
    v_self := (v_me is not null and p_employee = v_me);
  end if;
  if v_hub is null then raise exception 'হাব বেছে নিন' using errcode = '22023'; end if;
  v_zone := private.hub_zone(v_hub);
  if v_zone is null then raise exception 'হাব পাওয়া যায়নি' using errcode = 'P0002'; end if;

  if not ((v_self and f.self_service) or private.has_permission('hr.request.create', v_zone, v_hub)) then
    raise exception 'এই রিকুয়েস্ট পাঠানোর অনুমতি নেই — নিজের জন্য শুধু আইডি চালু বা চাকরি ছাড়ার রিকুয়েস্ট দেওয়া যায়' using errcode = '42501';
  end if;

  for v_field in select * from jsonb_array_elements(f.fields) loop
    if coalesce((v_field->>'required')::boolean, false)
       and coalesce(trim(p_data->>(v_field->>'key')), '') = '' then
      raise exception '"%" ঘরটি পূরণ করুন', coalesce(v_field->>'label', v_field->>'key') using errcode = '22023';
    end if;
  end loop;

  if p_ref_employee is not null then
    select * into v_ref from public.employees where id = p_ref_employee and archived_at is null;
    if not found then raise exception 'রেফারেন্স পাওয়া যায়নি' using errcode = 'P0002'; end if;
  end if;

  perform set_config('app.change_reason', 'HR request: ' || f.name, true);
  insert into public.hr_requests (format_id, kind, employee_id, zone_id, hub_id, data, note, submitter_employee_id,
      ref_employee_id, ref_name, ref_code, ref_hub, ref_position)
  values (f.id, f.kind, p_employee, v_zone, v_hub, p_data, nullif(trim(coalesce(p_note, '')), ''), v_me,
      p_ref_employee,
      coalesce(nullif(trim(coalesce(p_ref_name, '')), ''), v_ref.full_name),
      coalesce(nullif(trim(coalesce(p_ref_code, '')), ''), v_ref.employee_code),
      nullif(trim(coalesce(p_ref_hub, '')), ''), nullif(trim(coalesce(p_ref_position, '')), ''))
  returning id, request_no into v_id, v_no;

  insert into public.hr_request_events (request_id, status, note, by_name)
  values (v_id, 'submitted', nullif(trim(coalesce(p_note, '')), ''), private.my_display_name());

  perform private.notify(v_ref.profile_id, 'আপনাকে রেফারেন্স দেওয়া হয়েছে',
    f.name || ' · ' || coalesce(p_data->>'full_name', e.full_name, '') || ' · ' || v_no, '/app/hr/requests?id=' || v_id);
  if e.id is not null and not v_self then
    perform private.notify(e.profile_id, 'আপনার নামে নতুন রিকুয়েস্ট', f.name || ' · ' || v_no, '/app/hr/requests?id=' || v_id);
  end if;
  return v_id;
end $$;

create or replace function public.hr_request_update(p_id uuid, p_status text, p_note text default null, p_result text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_requests;
  f public.hr_request_formats;
  v_emp_profile uuid; v_ref_profile uuid; v_title text;
begin
  select * into r from public.hr_requests where id = p_id for update;
  if not found then raise exception 'রিকুয়েস্ট পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not private.has_permission('hr.request.approve', r.zone_id, r.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if p_status not in ('processing', 'done', 'rejected') then raise exception 'ভুল অবস্থা' using errcode = '22023'; end if;
  if r.status in ('done', 'rejected', 'cancelled') then raise exception 'এই রিকুয়েস্ট আগেই শেষ হয়েছে' using errcode = 'P0001'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'রিজেক্টের কারণ লিখুন' using errcode = '22023'; end if;
  select * into f from public.hr_request_formats where id = r.format_id;

  perform set_config('app.change_reason', 'HR request ' || r.request_no || ' → ' || p_status, true);
  update public.hr_requests set status = p_status,
    decided_by = case when p_status in ('done','rejected') then auth.uid() else decided_by end,
    decided_at = case when p_status in ('done','rejected') then now() else decided_at end,
    decision_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decision_note),
    result = coalesce(nullif(trim(coalesce(p_result, '')), ''), result)
  where id = p_id;
  insert into public.hr_request_events (request_id, status, note, by_name)
  values (p_id, p_status, concat_ws(' · ', nullif(trim(coalesce(p_note, '')), ''), nullif(trim(coalesce(p_result, '')), '')), private.my_display_name());

  v_title := f.name || ' ' || r.request_no || ': ' || private.hr_request_label(p_status);
  select profile_id into v_emp_profile from public.employees where id = r.employee_id;
  select profile_id into v_ref_profile from public.employees where id = r.ref_employee_id;
  perform private.notify(r.submitted_by, v_title, coalesce(p_note, p_result), '/app/hr/requests?id=' || p_id);
  if v_emp_profile is distinct from r.submitted_by then perform private.notify(v_emp_profile, v_title, coalesce(p_note, p_result), '/app/hr/requests?id=' || p_id); end if;
  if v_ref_profile is distinct from r.submitted_by and v_ref_profile is distinct from v_emp_profile then
    perform private.notify(v_ref_profile, v_title, coalesce(p_note, p_result), '/app/hr/requests?id=' || p_id);
  end if;
end $$;

create or replace function public.hr_request_cancel(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests;
begin
  select * into r from public.hr_requests where id = p_id for update;
  if not found or r.submitted_by <> auth.uid() then raise exception 'শুধু যিনি পাঠিয়েছেন তিনি তুলে নিতে পারবেন' using errcode = '42501'; end if;
  if r.status <> 'submitted' then raise exception 'কাজ শুরু হয়ে গেছে — আর তুলে নেওয়া যাবে না' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'কারণ লিখুন' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.hr_requests set status = 'cancelled', decision_note = p_reason where id = p_id;
  insert into public.hr_request_events (request_id, status, note, by_name) values (p_id, 'cancelled', p_reason, private.my_display_name());
end $$;

-- Counts for dashboards and the report tab. Invoker: only rows the caller may see.
create or replace function public.hr_request_summary()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (select auth.uid() uid, private.my_employee_id() emp),
  v as (select r.*, (r.submitted_by = me.uid) mine, (r.ref_employee_id = me.emp) asref, (r.employee_id = me.emp) aboutme, (r.decided_by = me.uid) decided
        from public.hr_requests r, me)
  select jsonb_build_object(
    'mine',      coalesce((select jsonb_object_agg(k, c) from (select kind || ':' || status k, count(*) c from v where mine group by 1) x), '{}'::jsonb),
    'decided',   coalesce((select jsonb_object_agg(k, c) from (select kind || ':' || status k, count(*) c from v where decided group by 1) x), '{}'::jsonb),
    'all',       coalesce((select jsonb_object_agg(k, c) from (select kind || ':' || status k, count(*) c from v group by 1) x), '{}'::jsonb),
    'as_ref',    (select count(*) from v where asref),
    'about_me',  (select count(*) from v where aboutme),
    'open',      (select count(*) from v where status in ('submitted','processing')),
    'recent',    coalesce((select jsonb_agg(t) from (select v.id, v.request_no, v.kind, v.status, v.created_at, v.mine, v.asref, v.aboutme,
                    coalesce(v.data->>'full_name', e.full_name) person, coalesce(e.employee_code, v.result) code, h.name hub, f.name format
                  from v left join public.employees e on e.id = v.employee_id left join public.hubs h on h.id = v.hub_id
                  join public.hr_request_formats f on f.id = v.format_id
                  where v.mine or v.asref or v.aboutme order by v.created_at desc limit 8) t), '[]'::jsonb))
$$;

revoke all on function public.hr_request_submit(uuid, uuid, uuid, jsonb, text, uuid, text, text, text, text) from public, anon;
revoke all on function public.hr_request_update(uuid, text, text, text) from public, anon;
revoke all on function public.hr_request_cancel(uuid, text) from public, anon;
revoke all on function public.hr_request_summary() from public, anon;
grant execute on function public.hr_request_submit(uuid, uuid, uuid, jsonb, text, uuid, text, text, text, text) to authenticated;
grant execute on function public.hr_request_update(uuid, text, text, text) to authenticated;
grant execute on function public.hr_request_cancel(uuid, text) to authenticated;
grant execute on function public.hr_request_summary() to authenticated;
revoke all on function private.notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.my_display_name() from public, anon;
grant execute on function private.my_display_name() to authenticated;
grant execute on function private.hr_request_label(text) to authenticated;

-- ---------------------------------------------------------------------
--  Starting formats (editable in Setting)
-- ---------------------------------------------------------------------
insert into public.hr_request_formats (code, kind, name, name_bn, description, needs_employee, self_service, sort_order, fields) values
('ID_CREATE', 'id_create', 'ID CREATE', 'নতুন আইডি তৈরি', 'নতুন লোকের আইডি খোলার রিকুয়েস্ট', false, false, 10, '[
  {"key":"full_name","label":"পুরো নাম","type":"text","required":true},
  {"key":"mobile","label":"মোবাইল","type":"phone","required":true},
  {"key":"position","label":"পদবি","type":"position","required":true},
  {"key":"nid","label":"NID নম্বর","type":"text"},
  {"key":"joining_date","label":"যোগদানের তারিখ","type":"date"},
  {"key":"address","label":"ঠিকানা","type":"textarea"}
]'::jsonb),
('ID_TRANSFER', 'id_transfer', 'ID TRANSFER', 'আইডি বদলি', 'এক হাব থেকে আরেক হাবে বদলি', true, false, 20, '[
  {"key":"employee_code","label":"আইডি","type":"text","prefill":"employee_code"},
  {"key":"full_name","label":"নাম","type":"text","prefill":"full_name"},
  {"key":"from_hub","label":"বর্তমান হাব","type":"text","prefill":"hub"},
  {"key":"position","label":"পদবি","type":"text","prefill":"position"},
  {"key":"to_hub","label":"নতুন হাব","type":"hub","required":true},
  {"key":"effective_date","label":"কবে থেকে","type":"date","required":true},
  {"key":"reason","label":"কারণ","type":"textarea","required":true}
]'::jsonb),
('ID_ACTIVE', 'id_active', 'ID ACTIVE', 'আইডি চালু', 'বন্ধ আইডি আবার চালুর রিকুয়েস্ট', true, true, 30, '[
  {"key":"employee_code","label":"আইডি","type":"text","prefill":"employee_code"},
  {"key":"full_name","label":"নাম","type":"text","prefill":"full_name"},
  {"key":"hub","label":"হাব","type":"text","prefill":"hub"},
  {"key":"position","label":"পদবি","type":"text","prefill":"position"},
  {"key":"mobile","label":"মোবাইল","type":"phone","prefill":"mobile"},
  {"key":"effective_date","label":"কবে থেকে চালু","type":"date","required":true},
  {"key":"reason","label":"কারণ","type":"textarea"}
]'::jsonb),
('ID_INACTIVE', 'id_inactive', 'ID INACTIVE / REMOVE', 'আইডি বন্ধ / চাকরি ছাড়া', 'আইডি বন্ধ বা চাকরি ছেড়ে দেওয়ার রিকুয়েস্ট', true, true, 40, '[
  {"key":"employee_code","label":"আইডি","type":"text","prefill":"employee_code"},
  {"key":"full_name","label":"নাম","type":"text","prefill":"full_name"},
  {"key":"hub","label":"হাব","type":"text","prefill":"hub"},
  {"key":"position","label":"পদবি","type":"text","prefill":"position"},
  {"key":"last_date","label":"শেষ কর্মদিবস","type":"date","required":true},
  {"key":"reason_type","label":"ধরন","type":"select","required":true,"options":["চাকরি ছেড়ে দিচ্ছি","আইডি সাময়িক বন্ধ","অফিস থেকে বাদ","অন্য কারণ"]},
  {"key":"reason","label":"বিস্তারিত কারণ","type":"textarea","required":true}
]'::jsonb)
on conflict (code) do nothing;
