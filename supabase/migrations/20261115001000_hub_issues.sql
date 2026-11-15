-- =====================================================================
--  ইস্যু / ফলো-আপ + হাব গ্রুপ (Issues, follow-up, hub group feed)
--  * issues: a job given to a person ("assignee") by a giver ("assigned_by").
--      open -> in_progress -> solved -> approved.   The issue stays on the
--      assignee's panel until solved, and on the GIVER's panel until the giver
--      approves (or sends it back with a reason). Nothing is hard-deleted.
--  * hub_posts: the hub's group. Plain messages and issue cards. Reactions per
--    post, and "seen by" per post (who has opened it).
--  * "নদী AI" is the author name used when the assistant posts or follows up
--    (author_profile is null for those rows).
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('issue.issue.view',   'issue', 'issue', 'view',   'See every issue in scope (hub / area)'),
  ('issue.issue.create', 'issue', 'issue', 'create', 'Raise an issue and give it to a person in scope'),
  ('issue.issue.approve', 'issue', 'issue', 'approve', 'Re-assign, approve or cancel any issue in scope'),
  ('issue.group.view',   'issue', 'group', 'view',   'Read a hub group without being posted at that hub')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (r.code in ('admin', 'head_office_manager', 'operations_manager', 'zonal_manager') and p.code like 'issue.%')
  or (r.code = 'hub_manager' and p.code in ('issue.issue.view', 'issue.issue.create', 'issue.issue.approve'))
  or (r.code in ('pickup_manager', 'delivery_manager') and p.code in ('issue.issue.view', 'issue.issue.create'))
  or (r.code = 'auditor' and p.code in ('issue.issue.view', 'issue.group.view'))
) on conflict do nothing;

-- ---------------------------------------------------------------------
create sequence public.issue_no_seq;
create table public.issues (
  id            uuid primary key default gen_random_uuid(),
  issue_no      text not null unique default ('IS-' || lpad(nextval('public.issue_no_seq')::text, 5, '0')),
  hub_id        uuid not null references public.hubs(id),
  zone_id       uuid not null references public.zones(id),
  kind          text not null default 'parcel' check (kind in ('parcel', 'vehicle', 'staff', 'cash', 'other')),
  title         text not null check (length(trim(title)) > 1),
  body          text,
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  parcel_ref    text,                                   -- the parcel ID as typed or read from a photo
  parcel_id     uuid references public.parcels(id),
  photo_path    text,                                   -- private bucket "issue-photos"
  status        text not null default 'open' check (status in ('open', 'in_progress', 'solved', 'approved', 'cancelled')),
  assignee_id   uuid references public.employees(id),   -- who must solve it
  assigned_by   uuid,                                   -- profile of the giver (the checker)
  assigned_by_name text,
  assigned_by_nodi boolean not null default false,      -- Nodi picked the person
  due_at        timestamptz,
  solved_at     timestamptz, solved_note text, solve_photo text,
  approved_at   timestamptz, approved_by uuid, approve_note text,
  reopen_count  integer not null default 0,
  last_nudge_at timestamptz,
  created_at    timestamptz not null default now(), created_by uuid,
  updated_at    timestamptz not null default now(), updated_by uuid,
  constraint issues_zone_hub_chk check (zone_id is not null)
);
create index issues_hub_idx on public.issues (hub_id, status);
create index issues_assignee_idx on public.issues (assignee_id) where status in ('open', 'in_progress');
create index issues_giver_idx on public.issues (assigned_by) where status in ('open', 'in_progress', 'solved');
create index issues_parcel_idx on public.issues (parcel_id) where parcel_id is not null;
create index issues_created_by_idx on public.issues (created_by);

create table public.issue_events (
  id        uuid primary key default gen_random_uuid(),
  issue_id  uuid not null references public.issues(id),
  action    text not null,
  note      text,
  by_user   uuid default auth.uid(),
  by_name   text,
  at        timestamptz not null default now()
);
create index issue_events_issue_idx on public.issue_events (issue_id, at);

create table public.hub_posts (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id),
  author_profile uuid,                                   -- null = নদী AI
  author_name   text not null,
  kind          text not null default 'text' check (kind in ('text', 'issue', 'nodi')),
  body          text,
  photo_path    text,
  issue_id      uuid references public.issues(id),
  created_at    timestamptz not null default now()
);
create index hub_posts_hub_idx on public.hub_posts (hub_id, created_at desc);
create index hub_posts_issue_idx on public.hub_posts (issue_id) where issue_id is not null;

create table public.hub_post_reactions (
  post_id    uuid not null references public.hub_posts(id),
  profile_id uuid not null,
  emoji      text not null check (emoji in ('👍', '❤️', '😮', '😢', '✅', '🙏')),
  at         timestamptz not null default now(),
  primary key (post_id, profile_id, emoji)
);
create table public.hub_post_seen (
  post_id    uuid not null references public.hub_posts(id),
  profile_id uuid not null,
  seen_at    timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index hub_post_seen_profile_idx on public.hub_post_seen (profile_id);
create index hub_post_reactions_profile_idx on public.hub_post_reactions (profile_id);

do $$
declare t text;
begin
  foreach t in array array['issues'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row(%L)', t || '_audit', t, 'issue');
    execute format('create trigger %I before delete on public.%I for each row execute function private.prevent_delete()', t || '_no_delete', t);
  end loop;
end $$;
create trigger issue_events_no_delete before delete on public.issue_events for each row execute function private.prevent_delete();
create trigger hub_posts_no_delete before delete on public.hub_posts for each row execute function private.prevent_delete();

-- ---------------------------------------------------------------------
--  Who may read a hub's group: people posted at that hub, and anyone with a
--  permission that reaches it.
-- ---------------------------------------------------------------------
create or replace function private.in_hub_group(p_hub uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_hub is not null and (
    exists (select 1 from public.employees e where e.profile_id = auth.uid() and e.hub_id = p_hub and e.archived_at is null)
    or private.has_permission('issue.group.view', private.hub_zone(p_hub), p_hub)
    or private.has_permission('issue.issue.view', private.hub_zone(p_hub), p_hub)
    or private.has_permission('issue.issue.create', private.hub_zone(p_hub), p_hub))
$$;

create or replace function private.can_see_issue(p_issue uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.issues i where i.id = p_issue and (
       i.assigned_by = auth.uid() or i.created_by = auth.uid()
    or (i.assignee_id is not null and i.assignee_id = private.my_employee_id())
    or private.in_hub_group(i.hub_id)))
$$;

alter table public.issues enable row level security;
alter table public.issue_events enable row level security;
alter table public.hub_posts enable row level security;
alter table public.hub_post_reactions enable row level security;
alter table public.hub_post_seen enable row level security;
revoke all on public.issues, public.issue_events, public.hub_posts, public.hub_post_reactions, public.hub_post_seen from anon;

create policy issues_read on public.issues for select to authenticated using (
  assigned_by = auth.uid() or created_by = auth.uid()
  or (assignee_id is not null and assignee_id = private.my_employee_id())
  or private.in_hub_group(hub_id));
create policy issue_events_read on public.issue_events for select to authenticated using (exists (select 1 from public.issues i where i.id = issue_id));
create policy hub_posts_read on public.hub_posts for select to authenticated using (private.in_hub_group(hub_id));
create policy hub_post_reactions_read on public.hub_post_reactions for select to authenticated
  using (exists (select 1 from public.hub_posts p where p.id = post_id));
create policy hub_post_seen_read on public.hub_post_seen for select to authenticated
  using (exists (select 1 from public.hub_posts p where p.id = post_id));
grant select on public.issues, public.issue_events, public.hub_posts, public.hub_post_reactions, public.hub_post_seen to authenticated;
-- every write goes through the functions below

-- ---------------------------------------------------------------------
--  private helpers
-- ---------------------------------------------------------------------
create or replace function private.issue_log(p_issue uuid, p_action text, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.issue_events (issue_id, action, note, by_name) values (p_issue, p_action, nullif(trim(coalesce(p_note, '')), ''), private.my_display_name())
$$;

create or replace function private.hub_post_add(p_hub uuid, p_kind text, p_body text, p_issue uuid, p_as_nodi boolean default false, p_photo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into public.hub_posts (hub_id, author_profile, author_name, kind, body, issue_id, photo_path)
  values (p_hub, case when p_as_nodi then null else auth.uid() end, case when p_as_nodi then 'নদী AI' else private.my_display_name() end,
          p_kind, nullif(trim(coalesce(p_body, '')), ''), p_issue, p_photo)
  returning id into v;
  return v;
end $$;

create or replace function private.issue_status_label(p text) returns text
language sql immutable set search_path = '' as $$
  select case p when 'open' then 'নতুন' when 'in_progress' then 'কাজ চলছে' when 'solved' then 'সমাধান হয়েছে — চেক বাকি'
                when 'approved' then 'অনুমোদিত' when 'cancelled' then 'বাতিল' else p end
$$;

-- Names shown on issue cards: a rider may not read the hubs / employees tables, but may see who an issue is with.
create or replace function private.hub_name(p_hub uuid) returns text
language sql stable security definer set search_path = '' as $$ select name from public.hubs where id = p_hub $$;
create or replace function private.emp_name(p_emp uuid) returns text
language sql stable security definer set search_path = '' as $$ select full_name from public.employees where id = p_emp $$;
create or replace function private.emp_code(p_emp uuid) returns text
language sql stable security definer set search_path = '' as $$ select employee_code::text from public.employees where id = p_emp $$;
revoke all on function private.hub_name(uuid), private.emp_name(uuid), private.emp_code(uuid) from public, anon;
grant execute on function private.hub_name(uuid), private.emp_name(uuid), private.emp_code(uuid) to authenticated;

-- ---------------------------------------------------------------------
--  Raise an issue. The person can be named, or — for a parcel — picked from
--  the parcel's own rider (marked as chosen by নদী AI).
-- ---------------------------------------------------------------------
create or replace function public.issue_create(
  p_hub uuid, p_title text, p_body text default null, p_kind text default 'parcel',
  p_parcel_ref text default null, p_photo text default null, p_assignee uuid default null,
  p_due timestamptz default null, p_priority text default 'normal')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := private.hub_zone(p_hub);
  v_parcel public.parcels;
  v_ass public.employees;
  v_ref text := nullif(trim(coalesce(p_parcel_ref, '')), '');
  v_id uuid; v_no text; v_auto boolean := false; v_label text;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_zone is null then raise exception 'হাব বেছে নিন' using errcode = '22023'; end if;
  if not private.in_hub_group(p_hub) then raise exception 'এই হাবের ইস্যু দেওয়ার অনুমতি নেই' using errcode = '42501'; end if;
  if p_kind not in ('parcel', 'vehicle', 'staff', 'cash', 'other') or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'ধরন বা গুরুত্ব ঠিক নয়' using errcode = '22023'; end if;
  if coalesce(trim(p_title), '') = '' and v_ref is null and p_photo is null then raise exception 'কী সমস্যা তা লিখুন, পার্সেল আইডি দিন বা ছবি দিন' using errcode = '22023'; end if;

  if v_ref is not null then
    select * into v_parcel from public.parcels where tracking_no = v_ref and hub_id = p_hub;
  end if;
  if p_assignee is not null then
    select * into v_ass from public.employees where id = p_assignee and archived_at is null and status = 'active';
    if not found then raise exception 'যাকে দেওয়া হচ্ছে তাকে পাওয়া যায়নি বা সে সক্রিয় নয়' using errcode = 'P0002'; end if;
  elsif v_parcel.assigned_rider_id is not null then
    select * into v_ass from public.employees where id = v_parcel.assigned_rider_id and archived_at is null;
    v_auto := found;
  end if;

  perform set_config('app.change_reason', 'ইস্যু তৈরি', true);
  insert into public.issues (hub_id, zone_id, kind, title, body, priority, parcel_ref, parcel_id, photo_path,
                             assignee_id, assigned_by, assigned_by_name, assigned_by_nodi, due_at)
  values (p_hub, v_zone, p_kind,
          coalesce(nullif(trim(coalesce(p_title, '')), ''), case when v_ref is not null then 'পার্সেল ' || v_ref else 'ছবি থেকে ইস্যু' end),
          nullif(trim(coalesce(p_body, '')), ''), p_priority, v_ref, v_parcel.id, p_photo,
          v_ass.id, auth.uid(), private.my_display_name(), v_auto, p_due)
  returning id, issue_no into v_id, v_no;
  perform private.issue_log(v_id, 'created', coalesce(p_body, p_title));
  if v_ass.id is not null then
    perform private.issue_log(v_id, case when v_auto then 'assigned_by_nodi' else 'assigned' end, v_ass.full_name || coalesce(' (' || v_ass.employee_code || ')', ''));
  end if;

  v_label := v_no || ' · ' || (select title from public.issues where id = v_id);
  perform private.hub_post_add(p_hub, 'issue',
    case when v_ass.id is null then 'নতুন ইস্যু — এখনো কাউকে দেওয়া হয়নি'
         when v_auto then 'নদী AI পার্সেলের রাইডার দেখে কাজটি দিল: ' || v_ass.full_name
         else 'কাজ দেওয়া হলো: ' || v_ass.full_name end,
    v_id, v_auto, p_photo);
  perform private.notify(v_ass.profile_id, 'আপনাকে একটি কাজ দেওয়া হয়েছে', v_label, '/app/issues?id=' || v_id, 'issue');
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Give / change the person
-- ---------------------------------------------------------------------
create or replace function public.issue_assign(p_id uuid, p_assignee uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare i public.issues; v_ass public.employees;
begin
  select * into i from public.issues where id = p_id for update;
  if not found then raise exception 'ইস্যু পাওয়া যায়নি' using errcode = 'P0002'; end if;
  if not (i.assigned_by = auth.uid() or i.created_by = auth.uid() or private.has_permission('issue.issue.approve', i.zone_id, i.hub_id)) then
    raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if i.status in ('approved', 'cancelled') then raise exception 'এই ইস্যু শেষ হয়ে গেছে' using errcode = 'P0001'; end if;
  select * into v_ass from public.employees where id = p_assignee and archived_at is null and status = 'active';
  if not found then raise exception 'ব্যক্তিকে পাওয়া যায়নি বা সক্রিয় নয়' using errcode = 'P0002'; end if;
  perform set_config('app.change_reason', 'ইস্যু নতুন করে দেওয়া', true);
  update public.issues set assignee_id = p_assignee, assigned_by = auth.uid(), assigned_by_name = private.my_display_name(),
         assigned_by_nodi = false, status = 'open', last_nudge_at = null where id = p_id;
  perform private.issue_log(p_id, 'assigned', v_ass.full_name || coalesce(' (' || v_ass.employee_code || ')', '') || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  perform private.hub_post_add(i.hub_id, 'issue', 'কাজ দেওয়া হলো: ' || v_ass.full_name, p_id);
  perform private.notify(v_ass.profile_id, 'আপনাকে একটি কাজ দেওয়া হয়েছে', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');
end $$;

-- ---------------------------------------------------------------------
--  Act on an issue:
--    start    (assignee)            open -> in_progress
--    solve    (assignee)            -> solved, needs a note; waits for the giver
--    approve  (giver / manager)     solved -> approved   (leaves every panel)
--    reopen   (giver / manager)     solved -> in_progress, needs a reason
--    cancel   (giver / manager)     -> cancelled, needs a reason
-- ---------------------------------------------------------------------
create or replace function public.issue_act(p_id uuid, p_action text, p_note text default null, p_photo text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.issues;
  v_me uuid := private.my_employee_id();
  v_is_assignee boolean; v_is_giver boolean; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_ass_profile uuid;
begin
  select * into i from public.issues where id = p_id for update;
  if not found then raise exception 'ইস্যু পাওয়া যায়নি' using errcode = 'P0002'; end if;
  v_is_assignee := (i.assignee_id is not null and i.assignee_id = v_me);
  v_is_giver := (i.assigned_by = auth.uid() or i.created_by = auth.uid() or private.has_permission('issue.issue.approve', i.zone_id, i.hub_id));
  if i.status in ('approved', 'cancelled') then raise exception 'এই ইস্যু শেষ হয়ে গেছে' using errcode = 'P0001'; end if;
  select profile_id into v_ass_profile from public.employees where id = i.assignee_id;

  perform set_config('app.change_reason', 'ইস্যু: ' || p_action, true);
  if p_action = 'start' then
    if not v_is_assignee then raise exception 'শুধু যাকে কাজটি দেওয়া হয়েছে সে শুরু করতে পারবে' using errcode = '42501'; end if;
    if i.status <> 'open' then raise exception 'কাজ আগেই শুরু হয়েছে' using errcode = 'P0001'; end if;
    update public.issues set status = 'in_progress' where id = p_id;
    perform private.issue_log(p_id, 'started', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'কাজ শুরু করেছে', p_id);
    perform private.notify(i.assigned_by, 'কাজ শুরু হয়েছে', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'solve' then
    if not v_is_assignee then raise exception 'শুধু যাকে কাজটি দেওয়া হয়েছে সে সমাধান জানাতে পারবে' using errcode = '42501'; end if;
    if v_note is null and p_photo is null then raise exception 'কী করা হয়েছে লিখুন বা ছবি দিন' using errcode = '22023'; end if;
    update public.issues set status = 'solved', solved_at = now(), solved_note = v_note, solve_photo = p_photo where id = p_id;
    perform private.issue_log(p_id, 'solved', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'সমাধান হয়েছে — যিনি কাজ দিয়েছেন তার চেক বাকি' || coalesce(': ' || v_note, ''), p_id, false, p_photo);
    perform private.notify(i.assigned_by, 'সমাধান হয়েছে — চেক করে অনুমোদন দিন', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'approve' then
    if not v_is_giver then raise exception 'শুধু যিনি কাজ দিয়েছেন (বা ম্যানেজার) অনুমোদন দিতে পারবেন' using errcode = '42501'; end if;
    if i.status <> 'solved' then raise exception 'আগে সমাধান জানাতে হবে' using errcode = 'P0001'; end if;
    update public.issues set status = 'approved', approved_at = now(), approved_by = auth.uid(), approve_note = v_note where id = p_id;
    perform private.issue_log(p_id, 'approved', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'চেক করে অনুমোদন দেওয়া হয়েছে ✔', p_id);
    perform private.notify(v_ass_profile, 'আপনার কাজ অনুমোদিত হয়েছে', i.issue_no || ' · ' || i.title, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'reopen' then
    if not v_is_giver then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if i.status <> 'solved' then raise exception 'শুধু সমাধান হয়েছে এমন ইস্যু ফেরত পাঠানো যায়' using errcode = 'P0001'; end if;
    if v_note is null then raise exception 'ফেরত পাঠানোর কারণ লিখুন' using errcode = '22023'; end if;
    update public.issues set status = 'in_progress', reopen_count = reopen_count + 1, solved_at = null, solved_note = null, solve_photo = null, last_nudge_at = null where id = p_id;
    perform private.issue_log(p_id, 'reopened', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'ঠিক হয়নি — আবার করতে বলা হলো: ' || v_note, p_id);
    perform private.notify(v_ass_profile, 'কাজটি আবার করতে বলা হয়েছে', i.issue_no || ' · ' || v_note, '/app/issues?id=' || p_id, 'issue');

  elsif p_action = 'cancel' then
    if not v_is_giver then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
    if v_note is null then raise exception 'বাতিলের কারণ লিখুন' using errcode = '22023'; end if;
    update public.issues set status = 'cancelled' where id = p_id;
    perform private.issue_log(p_id, 'cancelled', v_note);
    perform private.hub_post_add(i.hub_id, 'issue', 'ইস্যু বাতিল: ' || v_note, p_id);
    perform private.notify(v_ass_profile, 'ইস্যু বাতিল হয়েছে', i.issue_no || ' · ' || v_note, '/app/issues?id=' || p_id, 'issue');

  else
    raise exception 'ভুল কাজ' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------
--  The three panels (what each person sees on the issues page)
--    mine     — given to me, not yet solved
--    to_check — I gave it, it is solved, waiting for MY approval
--    given    — I gave it and it is still running
--    hub      — everything open in the hubs I can see (managers)
--  An issue leaves a panel only when it is approved or cancelled.
-- ---------------------------------------------------------------------
create or replace function public.issue_panels()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (select auth.uid() uid, private.my_employee_id() emp),
  v as (
    select i.id, i.issue_no, i.title, i.kind, i.priority, i.status, i.hub_id, private.hub_name(i.hub_id) hub, i.parcel_ref, i.due_at, i.created_at, i.solved_at,
           i.reopen_count, i.assigned_by_name, i.assigned_by_nodi, private.emp_name(i.assignee_id) assignee, private.emp_code(i.assignee_id) assignee_code,
           (i.assignee_id = me.emp) is_mine, (i.assigned_by = me.uid or i.created_by = me.uid) is_giver,
           (i.due_at is not null and i.due_at < now() and i.status in ('open', 'in_progress')) overdue
    from public.issues i, me
    where i.status in ('open', 'in_progress', 'solved'))
  select jsonb_build_object(
    'mine',     coalesce((select jsonb_agg(to_jsonb(v) order by v.overdue desc, v.created_at) from v where is_mine and status in ('open', 'in_progress')), '[]'::jsonb),
    'to_check', coalesce((select jsonb_agg(to_jsonb(v) order by v.solved_at) from v where is_giver and status = 'solved'), '[]'::jsonb),
    'given',    coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from v where is_giver and status in ('open', 'in_progress')), '[]'::jsonb),
    'waiting_for_check_of_mine', coalesce((select jsonb_agg(to_jsonb(v) order by v.solved_at) from v where is_mine and status = 'solved'), '[]'::jsonb),
    'hub',      coalesce((select jsonb_agg(to_jsonb(v) order by v.overdue desc, v.created_at) from v where not is_mine and not is_giver), '[]'::jsonb))
$$;

create or replace function public.issue_detail(p_id uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'issue', to_jsonb(i) || jsonb_build_object('hub', private.hub_name(i.hub_id), 'assignee', private.emp_name(i.assignee_id), 'assignee_code', private.emp_code(i.assignee_id),
        'status_bn', private.issue_status_label(i.status)),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.at) from public.issue_events x where x.issue_id = i.id), '[]'::jsonb),
    'parcel', (select to_jsonb(p) - 'created_by' - 'updated_by' from public.parcels p where p.id = i.parcel_id))
  from public.issues i
  where i.id = p_id
$$;

-- ---------------------------------------------------------------------
--  Hub group
-- ---------------------------------------------------------------------
create or replace function public.hub_post_create(p_hub uuid, p_body text, p_photo text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not private.in_hub_group(p_hub) then raise exception 'এই হাবের গ্রুপে লেখার অনুমতি নেই' using errcode = '42501'; end if;
  if coalesce(trim(p_body), '') = '' and p_photo is null then raise exception 'কিছু লিখুন বা ছবি দিন' using errcode = '22023'; end if;
  return private.hub_post_add(p_hub, 'text', p_body, null, false, p_photo);
end $$;

-- Toggle one reaction
create or replace function public.hub_post_react(p_post uuid, p_emoji text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare p public.hub_posts;
begin
  select * into p from public.hub_posts where id = p_post;
  if not found or not private.in_hub_group(p.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if exists (select 1 from public.hub_post_reactions where post_id = p_post and profile_id = auth.uid() and emoji = p_emoji) then
    delete from public.hub_post_reactions where post_id = p_post and profile_id = auth.uid() and emoji = p_emoji;
    return false;
  end if;
  insert into public.hub_post_reactions (post_id, profile_id, emoji) values (p_post, auth.uid(), p_emoji);
  return true;
end $$;

-- "I have seen these" — called by the page when posts are on screen
create or replace function public.hub_posts_seen(p_posts uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with ok as (select p.id from public.hub_posts p where p.id = any(p_posts) and private.in_hub_group(p.hub_id))
  insert into public.hub_post_seen (post_id, profile_id) select id, auth.uid() from ok on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- The group feed: newest first, with reactions, seen counts and the issue card
create or replace function public.hub_feed(p_hub uuid, p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.in_hub_group(p_hub) then raise exception 'এই হাবের গ্রুপ দেখার অনুমতি নেই' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row order by (row->>'created_at') desc) from (
      select jsonb_build_object(
        'id', p.id, 'author_name', p.author_name, 'is_nodi', p.author_profile is null, 'mine', p.author_profile = auth.uid(),
        'kind', p.kind, 'body', p.body, 'photo_path', p.photo_path, 'created_at', p.created_at,
        'issue', case when i.id is null then null else jsonb_build_object('id', i.id, 'issue_no', i.issue_no, 'title', i.title, 'status', i.status,
              'status_bn', private.issue_status_label(i.status), 'assignee', e.full_name, 'parcel_ref', i.parcel_ref, 'priority', i.priority) end,
        'reactions', coalesce((select jsonb_object_agg(emoji, jsonb_build_object('n', n, 'mine', mine)) from (
              select r.emoji, count(*) n, bool_or(r.profile_id = auth.uid()) mine from public.hub_post_reactions r where r.post_id = p.id group by r.emoji) q), '{}'::jsonb),
        'seen_count', (select count(*) from public.hub_post_seen s where s.post_id = p.id),
        'seen_by_me', exists (select 1 from public.hub_post_seen s where s.post_id = p.id and s.profile_id = auth.uid())
      ) as row
      from public.hub_posts p left join public.issues i on i.id = p.issue_id left join public.employees e on e.id = i.assignee_id
      where p.hub_id = p_hub and (p_before is null or p.created_at < p_before)
      order by p.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) t), '[]'::jsonb);
end $$;

-- Who has seen one post
create or replace function public.hub_post_seen_by(p_post uuid)
returns table (profile_id uuid, full_name text, employee_code text, seen_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare p public.hub_posts;
begin
  select * into p from public.hub_posts where id = p_post;
  if not found or not private.in_hub_group(p.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return query
  select s.profile_id, coalesce(e.full_name, pr.full_name, '—'), e.employee_code::text, s.seen_at
  from public.hub_post_seen s left join public.profiles pr on pr.id = s.profile_id
       left join public.employees e on e.profile_id = s.profile_id and e.archived_at is null
  where s.post_id = p_post order by s.seen_at;
end $$;

-- Who reacted with what
create or replace function public.hub_post_reacted_by(p_post uuid)
returns table (emoji text, full_name text, employee_code text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare p public.hub_posts;
begin
  select * into p from public.hub_posts where id = p_post;
  if not found or not private.in_hub_group(p.hub_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return query
  select r.emoji, coalesce(e.full_name, pr.full_name, '—'), e.employee_code::text, r.at
  from public.hub_post_reactions r left join public.profiles pr on pr.id = r.profile_id
       left join public.employees e on e.profile_id = r.profile_id and e.archived_at is null
  where r.post_id = p_post order by r.at;
end $$;

-- Hubs the caller can open the group of
create or replace function public.hub_group_hubs()
returns table (hub_id uuid, hub_name text, hub_code text, open_issues integer, unseen integer)
language sql stable security definer set search_path = '' as $$
  select h.id, h.name, h.code::text,
         (select count(*)::int from public.issues i where i.hub_id = h.id and i.status in ('open', 'in_progress', 'solved')),
         (select count(*)::int from public.hub_posts p where p.hub_id = h.id and not exists (select 1 from public.hub_post_seen s where s.post_id = p.id and s.profile_id = auth.uid()))
  from public.hubs h where h.archived_at is null and private.in_hub_group(h.id) order by h.name
$$;

-- ---------------------------------------------------------------------
--  নদী AI follow-up: a reminder for every issue nobody has touched for
--  p_hours. Meant to be called on a schedule (Edge Function / cron) with the
--  service key; never by a browser user.
-- ---------------------------------------------------------------------
create or replace function public.issue_nudge_due(p_hours integer default 6)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; v_prof uuid;
begin
  if auth.uid() is not null then raise exception 'শুধু সিস্টেম চালাতে পারে' using errcode = '42501'; end if;
  for r in
    select i.* from public.issues i
    where i.status in ('open', 'in_progress', 'solved')
      and coalesce(i.last_nudge_at, i.updated_at) < now() - make_interval(hours => greatest(p_hours, 1))
  loop
    if r.status = 'solved' then
      perform private.hub_post_add(r.hub_id, 'nodi', r.issue_no || ' · ' || r.title || ' — সমাধান হয়েছে, কিন্তু এখনো চেক করে অনুমোদন দেওয়া হয়নি।', r.id, true);
      perform private.notify(r.assigned_by, 'চেক বাকি আছে', r.issue_no || ' · ' || r.title, '/app/issues?id=' || r.id, 'issue');
    else
      select profile_id into v_prof from public.employees where id = r.assignee_id;
      perform private.hub_post_add(r.hub_id, 'nodi', r.issue_no || ' · ' || r.title || ' — ' ||
        case when r.assignee_id is null then 'এখনো কাউকে দেওয়া হয়নি।' when r.due_at is not null and r.due_at < now() then 'সময় পার হয়ে গেছে, সমাধান বাকি।' else 'এখনো সমাধান হয়নি, কাজ চলছে?' end, r.id, true);
      perform private.notify(v_prof, 'কাজটি এখনো বাকি', r.issue_no || ' · ' || r.title, '/app/issues?id=' || r.id, 'issue');
    end if;
    update public.issues set last_nudge_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
--  Photos: private bucket, path  <hub_id>/<file>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-photos', 'issue-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create or replace function private.issue_object_hub(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' then split_part(p_name, '/', 1)::uuid end
$$;
revoke all on function private.issue_object_hub(text) from public, anon;
grant execute on function private.issue_object_hub(text) to authenticated;
drop policy if exists issue_photos_read on storage.objects;
create policy issue_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'issue-photos' and private.in_hub_group(private.issue_object_hub(name)));
drop policy if exists issue_photos_write on storage.objects;
create policy issue_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-photos' and private.in_hub_group(private.issue_object_hub(name)));

-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.issue_create(uuid, text, text, text, text, text, uuid, timestamptz, text)', 'public.issue_assign(uuid, uuid, text)',
    'public.issue_act(uuid, text, text, text)', 'public.issue_panels()', 'public.issue_detail(uuid)',
    'public.hub_post_create(uuid, text, text)', 'public.hub_post_react(uuid, text)', 'public.hub_posts_seen(uuid[])',
    'public.hub_feed(uuid, timestamptz, integer)', 'public.hub_post_seen_by(uuid)', 'public.hub_post_reacted_by(uuid)', 'public.hub_group_hubs()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.issue_nudge_due(integer) from public, anon, authenticated;
grant execute on function public.issue_nudge_due(integer) to service_role;
revoke all on function private.in_hub_group(uuid), private.can_see_issue(uuid), private.issue_log(uuid, text, text),
  private.hub_post_add(uuid, text, text, uuid, boolean, text) from public, anon;
grant execute on function private.in_hub_group(uuid), private.can_see_issue(uuid) to authenticated;
grant execute on function private.issue_status_label(text) to authenticated;
