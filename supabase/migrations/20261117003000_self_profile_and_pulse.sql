-- =====================================================================
-- XZM-TEAM ERP — staff complete their own profile; the zonal manager's popup question
--
-- Owner (17 Nov): "সকল Employee তাদের প্রোফাইল কমপ্লিট করবে ইজিলি!" — decision: whatever staff fill in about
--   themselves saves at once, no approval.
-- Owner (17 Nov): "জোনাল ড্যাশবোর্ডে পপআপ রিপোর্ট নিবো! সবার কাছে থেকে ইনপুট দিয়ে দিবে যাস্ট, অথবা হ্যাঁ না হোম
--   স্ক্রিনে সেট করে দেও!" — decision: the zonal manager picks who gets each question (whole zone, some hubs or some posts);
--   staff may postpone ("পরে দেব") and it comes back on the next app open until answered; a push notification goes out.
--
--  1. Self profile: the hub profile form's functions (hr_hub_profile_get / _save — same checks: duplicate mobile / NID,
--     date of birth, an empty value never wipes what is on file) now also accept the caller's own employee record.
--     Staff may upload their own photo, NID front / back and signature (same file rules as HR).
--  2. pulse_questions / pulse_answers with functions for the zonal manager (create, close, list, results) and for staff
--     (my open questions, answer). Permission zonal.pulse.manage: Zonal Manager for their zone, and Admin (a role can only be
--     given by someone holding all its rights).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Self profile
-- ---------------------------------------------------------------------
create or replace function private.can_fill_profile(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.employee_has_permission('hr.employee_profile.edit', p_employee)
      or private.employee_has_permission('hr.employee.edit', p_employee)
      or private.is_self_employee(p_employee)
$$;

create or replace function private.can_upload_employee_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid;
begin
  if p_name !~ '^employee/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  v_emp := split_part(p_name, '/', 2)::uuid;
  return private.employee_has_permission('hr.document.create', v_emp) or private.is_open_draft_of_caller(v_emp)
      or private.is_self_employee(v_emp);
end $$;

alter policy documents_insert on public.employee_documents
  with check (verified_by is null and archived_at is null
              and (private.employee_has_permission('hr.document.create', employee_id)
                   or private.is_open_draft_of_caller(employee_id)
                   or (private.is_self_employee(employee_id) and doc_type in ('photo', 'nid_front', 'nid_back', 'signature'))));

-- ---------------------------------------------------------------------
-- 2. Popup questions
-- ---------------------------------------------------------------------
create table public.pulse_questions (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones(id),
  title text not null check (length(trim(title)) > 1),
  body text,
  kind text not null default 'yes_no' check (kind in ('yes_no', 'text', 'yes_no_text')),
  hub_ids uuid[] not null default '{}',        -- empty = every hub of the zone
  position_ids uuid[] not null default '{}',   -- empty = every post
  closes_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index pulse_questions_zone on public.pulse_questions (zone_id, created_at desc);

create table public.pulse_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.pulse_questions(id),
  employee_id uuid not null references public.employees(id),
  hub_id uuid references public.hubs(id),
  answer text check (answer in ('yes', 'no')),
  note text,
  answered_at timestamptz not null default now(),
  unique (question_id, employee_id),
  check (answer is not null or length(trim(coalesce(note, ''))) > 0)
);
create index pulse_answers_employee on public.pulse_answers (employee_id);
create index pulse_answers_hub on public.pulse_answers (hub_id);

do $$
declare t text;
begin
  foreach t in array array['pulse_questions', 'pulse_answers'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'zonal');
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);   -- only through the functions below
  end loop;
end $$;

insert into public.permissions (code, module, resource, action, description) values
  ('zonal.pulse.manage', 'zonal', 'pulse', 'create', 'Ask the zone''s staff a popup question and see the answers')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'zonal.pulse.manage' where r.code in ('zonal_manager', 'admin')
on conflict do nothing;

-- Who a question is for: active staff of the zone, narrowed by hubs and posts when given.
create or replace function private.pulse_targets(p_question uuid)
returns table (employee_id uuid, profile_id uuid, hub_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id, e.profile_id, e.hub_id
    from public.pulse_questions q
    join public.employees e on e.zone_id = q.zone_id and e.archived_at is null and e.status = 'active'
   where q.id = p_question
     and (cardinality(q.hub_ids) = 0 or e.hub_id = any(q.hub_ids))
     and (cardinality(q.position_ids) = 0 or e.position_id = any(q.position_ids))
$$;
revoke all on function private.pulse_targets(uuid) from public, anon, authenticated;

create or replace function public.pulse_create(p_zone uuid, p_title text, p_body text default null, p_kind text default 'yes_no',
  p_hubs uuid[] default '{}', p_positions uuid[] default '{}', p_closes date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; u record; v_n integer := 0;
begin
  if p_zone is null or not private.has_permission('zonal.pulse.manage', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'Write the question' using errcode = '22023'; end if;
  if coalesce(p_kind, '') not in ('yes_no', 'text', 'yes_no_text') then raise exception 'Unknown answer kind' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_hubs, '{}')) h where not exists (select 1 from public.hubs x where x.id = h and x.zone_id = p_zone)) then
    raise exception 'A hub is not in this zone' using errcode = '22023';
  end if;
  if p_closes is not null and p_closes < (now() at time zone 'Asia/Dhaka')::date then raise exception 'The last day is in the past' using errcode = '22023'; end if;
  insert into public.pulse_questions (zone_id, title, body, kind, hub_ids, position_ids, closes_at, created_by, created_by_name)
  values (p_zone, trim(p_title), nullif(trim(coalesce(p_body, '')), ''), p_kind, coalesce(p_hubs, '{}'), coalesce(p_positions, '{}'),
          case when p_closes is null then null else ((p_closes + 1)::timestamp at time zone 'Asia/Dhaka') end,
          auth.uid(), private.my_display_name())
  returning id into v_id;
  for u in select distinct t.profile_id from private.pulse_targets(v_id) t where t.profile_id is not null and t.profile_id <> auth.uid() loop
    perform private.notify(u.profile_id, 'জোনাল ম্যানেজারের প্রশ্ন', trim(p_title), '/app', 'pulse'); v_n := v_n + 1;
  end loop;
  return v_id;
end $$;

create or replace function public.pulse_close(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.pulse_questions;
begin
  select * into q from public.pulse_questions where id = p_id for update;
  if q.id is null then raise exception 'Question not found' using errcode = 'P0002'; end if;
  if not private.has_permission('zonal.pulse.manage', q.zone_id, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.pulse_questions set status = 'closed', closed_at = now() where id = p_id and status = 'open';
end $$;

-- The zonal manager's list: each question with how many it went to, answered, yes and no.
create or replace function public.pulse_list(p_zone uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_zone is null or not private.has_permission('zonal.pulse.manage', p_zone, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'title', q.title, 'body', q.body, 'kind', q.kind, 'hub_ids', q.hub_ids, 'position_ids', q.position_ids,
      'closes_at', q.closes_at, 'status', case when q.status = 'open' and q.closes_at is not null and q.closes_at < now() then 'closed' else q.status end,
      'created_at', q.created_at, 'created_by_name', q.created_by_name,
      'targets', (select count(*) from private.pulse_targets(q.id)),
      'answered', (select count(*) from public.pulse_answers a where a.question_id = q.id),
      'yes', (select count(*) from public.pulse_answers a where a.question_id = q.id and a.answer = 'yes'),
      'no', (select count(*) from public.pulse_answers a where a.question_id = q.id and a.answer = 'no')) order by q.created_at desc)
    from public.pulse_questions q where q.zone_id = p_zone), '[]'::jsonb);
end $$;

-- Everyone a question went to, with their answer (or none yet).
create or replace function public.pulse_results(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q public.pulse_questions;
begin
  select * into q from public.pulse_questions where id = p_id;
  if q.id is null then raise exception 'Question not found' using errcode = 'P0002'; end if;
  if not private.has_permission('zonal.pulse.manage', q.zone_id, null) then raise exception 'Not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name, 'mobile', e.mobile,
      'hub_name', h.name, 'position', coalesce(p.name_bn, p.name), 'has_login', e.profile_id is not null,
      'answer', a.answer, 'note', a.note, 'answered_at', a.answered_at)
      order by (a.id is null), h.name, e.full_name)
    from private.pulse_targets(p_id) t
    join public.employees e on e.id = t.employee_id
    left join public.hubs h on h.id = e.hub_id
    left join public.positions p on p.id = e.position_id
    left join public.pulse_answers a on a.question_id = p_id and a.employee_id = e.id), '[]'::jsonb);
end $$;

-- Staff: open questions meant for me that I have not answered.
create or replace function public.pulse_mine() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.my_employee_id();
begin
  if v_emp is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'body', q.body, 'kind', q.kind,
      'closes_at', q.closes_at, 'from', q.created_by_name, 'created_at', q.created_at) order by q.created_at)
    from public.pulse_questions q
   where q.status = 'open' and (q.closes_at is null or q.closes_at > now())
     and exists (select 1 from private.pulse_targets(q.id) t where t.employee_id = v_emp)
     and not exists (select 1 from public.pulse_answers a where a.question_id = q.id and a.employee_id = v_emp)), '[]'::jsonb);
end $$;

create or replace function public.pulse_answer(p_id uuid, p_answer text default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.pulse_questions; e public.employees;
begin
  select * into e from public.employees where id = private.my_employee_id();
  if e.id is null then raise exception 'No active staff profile is linked to your login' using errcode = '42501'; end if;
  select * into q from public.pulse_questions where id = p_id;
  if q.id is null or not exists (select 1 from private.pulse_targets(q.id) t where t.employee_id = e.id) then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  if q.status <> 'open' or (q.closes_at is not null and q.closes_at <= now()) then raise exception 'This question is closed' using errcode = '22023'; end if;
  if p_answer is not null and p_answer not in ('yes', 'no') then raise exception 'Answer yes or no' using errcode = '22023'; end if;
  if q.kind in ('yes_no', 'yes_no_text') and p_answer is null then raise exception 'Answer yes or no' using errcode = '22023'; end if;
  if q.kind = 'text' and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Write your answer' using errcode = '22023'; end if;
  insert into public.pulse_answers (question_id, employee_id, hub_id, answer, note)
  values (p_id, e.id, e.hub_id, case when q.kind = 'text' then null else p_answer end, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (question_id, employee_id) do update set answer = excluded.answer, note = excluded.note, answered_at = now();
end $$;

revoke all on function public.pulse_create(uuid, text, text, text, uuid[], uuid[], date), public.pulse_close(uuid), public.pulse_list(uuid),
  public.pulse_results(uuid), public.pulse_mine(), public.pulse_answer(uuid, text, text) from public, anon;
grant execute on function public.pulse_create(uuid, text, text, text, uuid[], uuid[], date), public.pulse_close(uuid), public.pulse_list(uuid),
  public.pulse_results(uuid), public.pulse_mine(), public.pulse_answer(uuid, text, text) to authenticated;
