-- =====================================================================
--  নোটিফিকেশন সেন্টার (৭) ও ওয়ার্কফ্লো অটোমেশন (৮) — যা আগে ছিল না তা যোগ।
--
--  আগে থেকে ছিল (বদলানো হয়নি): notifications + ঘণ্টা লাইভ + পুশ (FCM), সব নোটিফিকেশন পাতা,
--  hub/zone পোস্ট, tasks (priority, due_date), employees.reporting_manager_id।
--
--  এখানে নতুন:
--   1. notifications.priority (low · normal · high · urgent) — private.notify_p()
--   2. নোটিশ বোর্ড: notices (কোম্পানি / জোন / হাব), পিন, মেয়াদ, "পড়েছি" নিশ্চিত, notice_reads
--   3. ব্যক্তিগত রিমাইন্ডার: user_reminders (একবার / প্রতিদিন / সাপ্তাহিক / মাসিক)
--   4. দায়িত্ব (task) দিলে বা বদলালে যাকে দেওয়া হলো তাকে নোটিফিকেশন (আগে দিত না)
--   5. কাজের রিমাইন্ডার পৌঁছানো (আগে task_due_reminders কেউ ডাকত না)
--   6. ডেডলাইন কন্ট্রোল + অটো ফরওয়ার্ড: সময় পেরোলে ধাপে ধাপে অ্যাসাইনি → দায়িত্বশীল ম্যানেজার ও
--      রিপোর্টিং ম্যানেজার → তাঁর ম্যানেজার; অপেক্ষমাণ অনুমোদনের রিমাইন্ডার (HR রিকুয়েস্ট, ছুটি)
--   7. my_report_line(): আমি কাকে রিপোর্ট করি (ওপরের সারি)
--  সেটিং: workflow.enabled, workflow.escalate_after_days, workflow.approval_remind_hours
--  Additive only. বন্ধ করতে: select cron.unschedule('wf-engine'); select cron.unschedule('reminders-fire');
-- =====================================================================

-- ---------------------------------------------------------------- 1. priority on notifications
alter table public.notifications
  add column if not exists priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent'));

create or replace function private.notify_p(p_profile uuid, p_title text, p_body text, p_link text, p_kind text, p_priority text default 'normal')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (profile_id, title, body, link, kind, priority)
  select p_profile, p_title, p_body, p_link, p_kind, case when p_priority in ('low', 'normal', 'high', 'urgent') then p_priority else 'normal' end
  where p_profile is not null and p_profile is distinct from auth.uid();
$$;
revoke all on function private.notify_p(uuid, text, text, text, text, text) from public, anon, authenticated;

grant select (priority) on public.notifications to authenticated;

-- ---------------------------------------------------------------- helpers
-- Active people holding a permission for a place (global, that zone, that hub, or a super role).
create or replace function private.profiles_with_perm(p_perm text, p_zone uuid default null, p_hub uuid default null)
returns table (profile_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.status = 'active' and r.archived_at is null
  join public.profiles pr on pr.id = ur.user_id and pr.status = 'active' and pr.archived_at is null
  left join public.role_permissions rp on rp.role_id = r.id
  left join public.permissions p on p.id = rp.permission_id
  where ur.revoked_at is null and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
    and (p.code = p_perm or r.is_super)
    and (ur.scope_type = 'global'
         or (ur.scope_type = 'zone' and p_zone is not null and ur.zone_id = p_zone)
         or (ur.scope_type = 'hub' and p_hub is not null and ur.hub_id = p_hub))
$$;
revoke all on function private.profiles_with_perm(text, uuid, uuid) from public, anon, authenticated;

-- The profile of an employee's reporting manager.
create or replace function private.manager_profile(p_profile uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.profile_id from public.employees e join public.employees m on m.id = e.reporting_manager_id
  where e.profile_id = p_profile and e.archived_at is null and m.archived_at is null
$$;
revoke all on function private.manager_profile(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- permissions
insert into public.permissions (code, module, resource, action, description) values
  ('notice.board.create',  'notice', 'board', 'create',  'Publish a notice (company, zone or hub — within your scope)'),
  ('notice.board.archive', 'notice', 'board', 'archive', 'Take a notice down'),
  ('notice.board.view',    'notice', 'board', 'view',    'See who has read a notice')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('notice.board.create', 'notice.board.archive', 'notice.board.view')
where r.code in ('admin', 'head_office_manager', 'zonal_manager', 'hub_manager')
on conflict do nothing;

-- ---------------------------------------------------------------- settings
insert into public.system_settings (key, value, description) values
  ('workflow.enabled',               'true', 'Workflow engine: deadline control, auto forward, pending reminders'),
  ('workflow.escalate_after_days',   '2',    'Days overdue before a task is forwarded up the reporting line (twice this reaches the next manager)'),
  ('workflow.approval_remind_hours', '24',   'Hours a request or leave waits before its approvers are reminded')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 2. notice board
create sequence if not exists public.notice_no_seq;
create table public.notices (
  id            uuid primary key default gen_random_uuid(),
  notice_no     text not null unique default ('NB-' || lpad(nextval('public.notice_no_seq')::text, 5, '0')),
  title         text not null check (length(trim(title)) between 2 and 160),
  body          text not null check (length(trim(body)) between 2 and 4000),
  audience      text not null default 'all' check (audience in ('all', 'zone', 'hub')),
  zone_id       uuid references public.zones(id),
  hub_id        uuid references public.hubs(id),
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  pinned        boolean not null default false,
  requires_read boolean not null default false,           -- "পড়েছি" must be tapped
  publish_at    timestamptz not null default now(),
  expires_at    timestamptz,
  author_name   text not null,
  sent_to       integer not null default 0,
  archived_at   timestamptz, archived_by uuid,
  created_at    timestamptz not null default now(), created_by uuid default auth.uid(),
  constraint notices_aud_chk check ((audience = 'all' and zone_id is null and hub_id is null)
                                    or (audience = 'zone' and zone_id is not null and hub_id is null)
                                    or (audience = 'hub' and hub_id is not null)),
  constraint notices_expiry_chk check (expires_at is null or expires_at > publish_at)
);
create index notices_live_idx on public.notices (publish_at desc) where archived_at is null;
create index notices_zone_idx on public.notices (zone_id) where zone_id is not null;
create index notices_hub_idx on public.notices (hub_id) where hub_id is not null;

create table public.notice_reads (
  notice_id  uuid not null references public.notices(id),
  profile_id uuid not null,
  seen_at    timestamptz not null default now(),
  primary key (notice_id, profile_id)
);
create index notice_reads_profile_idx on public.notice_reads (profile_id);

create trigger notices_no_delete before delete on public.notices for each row execute function private.prevent_delete();
create trigger notice_reads_no_delete before delete on public.notice_reads for each row execute function private.prevent_delete();
create trigger notices_audit after insert or update or delete on public.notices for each row execute function private.audit_row('notice');
alter table public.notices enable row level security;
alter table public.notice_reads enable row level security;
revoke all on public.notices, public.notice_reads from anon, authenticated;   -- every read and write goes through a function

-- Is this notice meant for me? (my place comes from my employee record; a publisher always sees what they may publish)
create or replace function private.notice_for_me(n public.notices) returns boolean
language sql stable security definer set search_path = '' as $$
  select n.archived_at is null and n.publish_at <= now() and (n.expires_at is null or n.expires_at > now())
    and (n.audience = 'all'
      or exists (select 1 from public.employees e where e.profile_id = auth.uid() and e.archived_at is null
                 and ((n.audience = 'zone' and e.zone_id = n.zone_id) or (n.audience = 'hub' and e.hub_id = n.hub_id)))
      or private.has_permission('notice.board.create', n.zone_id, n.hub_id))
$$;
revoke all on function private.notice_for_me(public.notices) from public, anon, authenticated;

create or replace function public.notice_publish(
  p_title text, p_body text, p_audience text default 'all', p_zone uuid default null, p_hub uuid default null,
  p_priority text default 'normal', p_pinned boolean default false, p_requires_read boolean default false,
  p_publish_at timestamptz default null, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_zone uuid := p_zone; v_id uuid; v_n integer := 0; v_name text; u uuid; v_pr text := coalesce(p_priority, 'normal');
begin
  if p_audience = 'hub' and p_hub is not null then v_zone := private.hub_zone(p_hub); end if;
  if p_audience = 'all' then v_zone := null; end if;
  if not private.has_permission('notice.board.create', case when p_audience = 'all' then null else v_zone end, case when p_audience = 'hub' then p_hub end) then
    raise exception 'এই এলাকায় নোটিশ দেওয়ার অনুমতি নেই' using errcode = '42501';
  end if;
  if v_pr not in ('low', 'normal', 'high', 'urgent') then raise exception 'Unknown priority.' using errcode = '22023'; end if;
  v_name := private.my_display_name();
  insert into public.notices (title, body, audience, zone_id, hub_id, priority, pinned, requires_read, publish_at, expires_at, author_name)
  values (trim(p_title), trim(p_body), p_audience, case when p_audience = 'all' then null else v_zone end, case when p_audience = 'hub' then p_hub end,
          v_pr, coalesce(p_pinned, false), coalesce(p_requires_read, false), coalesce(p_publish_at, now()), p_expires_at, v_name)
  returning id into v_id;
  -- a notice that starts later is announced when it starts (see private.workflow_run); one that starts now is announced at once
  if coalesce(p_publish_at, now()) <= now() then v_n := private.notice_announce(v_id); end if;
  return v_id;
end $$;

-- Sends the bell notification of a notice to everyone it is meant for. Once only.
create or replace function private.notice_announce(p_notice uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n public.notices; v_n integer := 0; u uuid;
begin
  select * into n from public.notices where id = p_notice and archived_at is null for update;
  if n.id is null or exists (select 1 from public.workflow_nudges w where w.subject = 'notice' and w.ref_id = n.id and w.step = 0) then return 0; end if;
  insert into public.workflow_nudges (subject, ref_id, step) values ('notice', n.id, 0);
  for u in
    select distinct e.profile_id from public.employees e join public.profiles p on p.id = e.profile_id and p.status = 'active' and p.archived_at is null
    where e.archived_at is null and e.profile_id is not null
      and (n.audience = 'all' or (n.audience = 'zone' and e.zone_id = n.zone_id) or (n.audience = 'hub' and e.hub_id = n.hub_id))
  loop
    perform private.notify_p(u, case when n.pinned then '📌 ' else '' end || n.title, left(n.body, 140), '/app/notices', 'notice', n.priority);
    v_n := v_n + 1;
  end loop;
  update public.notices set sent_to = v_n where id = n.id;
  return v_n;
end $$;
revoke all on function private.notice_announce(uuid) from public, anon, authenticated;

-- My notices: pinned first, then urgent, then newest.
create or replace function public.notice_list(p_limit integer default 50)
returns table (id uuid, notice_no text, title text, body text, audience text, zone_name text, hub_name text, priority text, pinned boolean,
               requires_read boolean, expires_at timestamptz, author_name text, created_at timestamptz, seen boolean, readers bigint, can_manage boolean)
language sql stable security definer set search_path = '' as $$
  select n.id, n.notice_no, n.title, n.body, n.audience, z.name, h.name, n.priority, n.pinned, n.requires_read, n.expires_at, n.author_name,
         n.publish_at, exists (select 1 from public.notice_reads r where r.notice_id = n.id and r.profile_id = auth.uid()),
         case when private.has_permission('notice.board.view', n.zone_id, n.hub_id) then (select count(*) from public.notice_reads r where r.notice_id = n.id) end,
         private.has_permission('notice.board.archive', n.zone_id, n.hub_id)
  from public.notices n left join public.zones z on z.id = n.zone_id left join public.hubs h on h.id = n.hub_id
  where auth.uid() is not null and private.notice_for_me(n)
  order by n.pinned desc, (n.priority = 'urgent') desc, (n.priority = 'high') desc, n.publish_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

create or replace function public.notice_mark_read(p_notice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.notices;
begin
  select * into n from public.notices where id = p_notice;
  if n.id is null or not private.notice_for_me(n) then raise exception 'Notice not found.' using errcode = '42501'; end if;
  insert into public.notice_reads (notice_id, profile_id) values (p_notice, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.notice_archive(p_notice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.notices;
begin
  select * into n from public.notices where id = p_notice and archived_at is null;
  if n.id is null or not private.has_permission('notice.board.archive', n.zone_id, n.hub_id) then
    raise exception 'Notice not found or not authorised.' using errcode = '42501';
  end if;
  update public.notices set archived_at = now(), archived_by = auth.uid() where id = p_notice;
end $$;

-- ---------------------------------------------------------------- 3. personal reminders
create table public.user_reminders (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid(),
  title       text not null check (length(trim(title)) between 2 and 160),
  note        text check (note is null or length(note) <= 1000),
  remind_at   timestamptz not null,
  repeat      text not null default 'none' check (repeat in ('none', 'daily', 'weekly', 'monthly')),
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  link        text check (link is null or link ~ '^/app/'),
  last_sent_at timestamptz,
  done_at     timestamptz,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index user_reminders_due_idx on public.user_reminders (remind_at) where done_at is null and archived_at is null;
create index user_reminders_profile_idx on public.user_reminders (profile_id, remind_at desc);
create trigger user_reminders_no_delete before delete on public.user_reminders for each row execute function private.prevent_delete();
alter table public.user_reminders enable row level security;
revoke all on public.user_reminders from anon, authenticated;

create or replace function public.reminder_add(p_title text, p_remind_at timestamptz, p_repeat text default 'none',
  p_note text default null, p_priority text default 'normal', p_link text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_remind_at is null or p_remind_at <= now() then raise exception 'রিমাইন্ডারের সময় ভবিষ্যতের হতে হবে' using errcode = '22023'; end if;
  if (select count(*) from public.user_reminders where profile_id = auth.uid() and done_at is null and archived_at is null) >= 100 then
    raise exception 'একসাথে ১০০টির বেশি রিমাইন্ডার রাখা যায় না' using errcode = 'P0001';
  end if;
  insert into public.user_reminders (profile_id, title, note, remind_at, repeat, priority, link)
  values (auth.uid(), trim(p_title), nullif(trim(p_note), ''), p_remind_at, coalesce(p_repeat, 'none'), coalesce(p_priority, 'normal'), nullif(trim(p_link), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.reminder_list(p_include_done boolean default false)
returns table (id uuid, title text, note text, remind_at timestamptz, repeat text, priority text, link text, last_sent_at timestamptz, done_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.note, r.remind_at, r.repeat, r.priority, r.link, r.last_sent_at, r.done_at
  from public.user_reminders r
  where r.profile_id = auth.uid() and r.archived_at is null and (coalesce(p_include_done, false) or r.done_at is null)
  order by r.done_at is not null, r.remind_at
  limit 200
$$;

create or replace function public.reminder_done(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.user_reminders set done_at = now() where id = p_id and profile_id = auth.uid() and done_at is null and archived_at is null;
  if not found then raise exception 'Reminder not found.' using errcode = '42501'; end if;
end $$;

create or replace function public.reminder_remove(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.user_reminders set archived_at = now() where id = p_id and profile_id = auth.uid() and archived_at is null;
  if not found then raise exception 'Reminder not found.' using errcode = '42501'; end if;
end $$;

-- Delivers the reminders that are due; a repeating one moves to its next time (never into the past).
create or replace function private.reminders_fire() returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.user_reminders; v_n integer := 0; v_next timestamptz;
begin
  for r in select * from public.user_reminders where done_at is null and archived_at is null and remind_at <= now() order by remind_at limit 500 for update skip locked loop
    perform private.notify_p(r.profile_id, '⏰ ' || r.title, r.note, coalesce(r.link, '/app/notices?tab=reminders'), 'reminder', r.priority);
    v_n := v_n + 1;
    if r.repeat = 'none' then
      update public.user_reminders set last_sent_at = now(), done_at = now() where id = r.id;
    else
      v_next := r.remind_at;
      loop
        v_next := v_next + case r.repeat when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end;
        exit when v_next > now();
      end loop;
      update public.user_reminders set last_sent_at = now(), remind_at = v_next where id = r.id;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function private.reminders_fire() from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. assignment notification
create or replace function private.task_assign_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_pr text := case new.priority when 'urgent' then 'urgent' when 'high' then 'high' when 'low' then 'low' else 'normal' end;
        v_by text := private.my_display_name();
begin
  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    perform private.notify_p(new.assigned_to, 'নতুন দায়িত্ব: ' || new.title,
      'শেষ তারিখ ' || to_char(new.due_date, 'DD-MM-YYYY') || ' · দিয়েছেন ' || v_by, '/app/hub/tasks', 'task', v_pr);
    if new.accountable_manager_id is distinct from new.assigned_to and new.accountable_manager_id is distinct from auth.uid() then
      perform private.notify_p(new.accountable_manager_id, 'আপনার দায়িত্বে কাজ: ' || new.title, 'শেষ তারিখ ' || to_char(new.due_date, 'DD-MM-YYYY'), '/app/hub/tasks', 'task', 'normal');
    end if;
  end if;
  return null;
end $$;
create trigger tasks_assign_notify after insert or update of assigned_to on public.tasks
  for each row execute function private.task_assign_notify();

-- ---------------------------------------------------------------- 5-6. workflow engine
-- One row per reminder / forward already sent, so nothing is sent twice.
create table public.workflow_nudges (
  subject text not null,            -- task · task_submit · hr_request · leave · notice · notice_read
  ref_id  uuid not null,
  step    integer not null default 0,
  at      timestamptz not null default now(),
  primary key (subject, ref_id, step)
);
alter table public.workflow_nudges enable row level security;
revoke all on public.workflow_nudges from anon, authenticated;

create or replace function private.wf_nudge(p_subject text, p_ref uuid, p_step integer) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workflow_nudges (subject, ref_id, step) values (p_subject, p_ref, p_step);
  return true;
exception when unique_violation then return false;
end $$;
revoke all on function private.wf_nudge(text, uuid, integer) from public, anon, authenticated;

create or replace function private.workflow_run() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_on boolean := coalesce(private.setting_text('workflow.enabled'), 'true') = 'true';
  v_days integer := greatest(1, coalesce(nullif(private.setting_text('workflow.escalate_after_days'), '')::integer, 2));
  v_hours integer := greatest(1, coalesce(nullif(private.setting_text('workflow.approval_remind_hours'), '')::integer, 24));
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  t record; q record; u uuid; v_over integer; v_lvl integer; v_m1 uuid; v_m2 uuid;
  v_task integer := 0; v_appr integer := 0; v_notice integer := 0;
begin
  -- notices whose start time has come
  for q in select id from public.notices where archived_at is null and publish_at <= now() and (expires_at is null or expires_at > now())
           and not exists (select 1 from public.workflow_nudges w where w.subject = 'notice' and w.ref_id = notices.id and w.step = 0) limit 100 loop
    v_notice := v_notice + private.notice_announce(q.id);
  end loop;

  -- task reminders set by the assigner or the assignee
  for q in select * from public.task_due_reminders() loop
    perform private.notify_p(q.assigned_to, '⏰ ' || q.title, coalesce(q.note, 'শেষ তারিখ ' || to_char(q.due_date, 'DD-MM-YYYY')), '/app/hub/tasks', 'task', 'high');
  end loop;

  if not v_on then return jsonb_build_object('enabled', false, 'notices', v_notice); end if;

  -- deadline control: overdue → assignee → manager + reporting manager → the next manager up
  for t in select * from public.tasks where status in ('assigned', 'in_progress') and due_date < v_today loop
    v_over := v_today - t.due_date;
    v_lvl := case when v_over >= 2 * v_days then 3 when v_over >= v_days then 2 else 1 end;
    v_m1 := private.manager_profile(t.assigned_to);
    v_m2 := case when v_m1 is not null then private.manager_profile(v_m1) end;
    if v_lvl >= 1 and private.wf_nudge('task', t.id, 1) then
      perform private.notify_p(t.assigned_to, '⚠ সময় পেরিয়ে গেছে: ' || t.title, 'শেষ তারিখ ছিল ' || to_char(t.due_date, 'DD-MM-YYYY'), '/app/hub/tasks', 'task', 'high'); v_task := v_task + 1;
    end if;
    if v_lvl >= 2 and private.wf_nudge('task', t.id, 2) then
      for u in select distinct x from unnest(array[t.accountable_manager_id, v_m1]) x where x is not null and x is distinct from t.assigned_to loop
        perform private.notify_p(u, '⚠ ফরওয়ার্ড: ' || v_over || ' দিন দেরি — ' || t.title, 'দায়িত্বে আছেন ' || coalesce((select pr.full_name from public.profiles pr where pr.id = t.assigned_to), '—'), '/app/hub/tasks', 'task', 'high');
      end loop; v_task := v_task + 1;
    end if;
    if v_lvl >= 3 and private.wf_nudge('task', t.id, 3) then
      for u in select distinct x from unnest(array[v_m2, t.accountable_manager_id]) x where x is not null and x is distinct from t.assigned_to loop
        perform private.notify_p(u, '🔴 জরুরি ফরওয়ার্ড: ' || v_over || ' দিন দেরি — ' || t.title, 'এখনো শেষ হয়নি; ওপরের ম্যানেজারকে জানানো হলো', '/app/hub/tasks', 'task', 'urgent');
      end loop; v_task := v_task + 1;
    end if;
  end loop;

  -- a result waiting for the manager's confirmation for more than a day
  for t in select * from public.tasks where status = 'submitted' and submitted_at < now() - interval '1 day' loop
    if private.wf_nudge('task_submit', t.id, 1) then
      perform private.notify_p(t.accountable_manager_id, 'যাচাইয়ের অপেক্ষায়: ' || t.title, 'জমা পড়েছে ' || to_char(t.submitted_at at time zone 'Asia/Dhaka', 'DD-MM HH24:MI'), '/app/hub/tasks', 'task', 'high'); v_task := v_task + 1;
    end if;
  end loop;

  -- pending approvals: HR requests, then leave — the approvers, and (for leave) the reporting manager too
  for q in select * from public.hr_requests where status in ('submitted', 'processing') and created_at < now() - make_interval(hours => v_hours) loop
    if private.wf_nudge('hr_request', q.id, 1) then
      for u in select profile_id from private.profiles_with_perm('hr.request.approve', q.zone_id, q.hub_id) loop
        perform private.notify_p(u, 'অপেক্ষমাণ: ' || q.request_no, 'অনুরোধটি ' || v_hours || ' ঘণ্টার বেশি অপেক্ষায় আছে', '/app/hr/requests', 'hr_request', 'high'); v_appr := v_appr + 1;
      end loop;
    end if;
  end loop;
  for q in select l.id, l.employee_id, e.zone_id, e.hub_id, e.profile_id, e.full_name from public.leave_requests l join public.employees e on e.id = l.employee_id
           where l.status = 'pending' and l.created_at < now() - make_interval(hours => v_hours) loop
    if private.wf_nudge('leave', q.id, 1) then
      for u in select distinct x from (select profile_id as x from private.profiles_with_perm('hr.leave.approve', q.zone_id, q.hub_id)
                                       union select private.manager_profile(q.profile_id)) s where x is not null loop
        perform private.notify_p(u, 'ছুটির আবেদন অপেক্ষায়: ' || q.full_name, v_hours || ' ঘণ্টার বেশি সিদ্ধান্তের অপেক্ষায়', '/app/hr/leave', 'hr_request', 'high'); v_appr := v_appr + 1;
      end loop;
    end if;
  end loop;

  -- a notice that must be read, still unread after a day
  for q in select n.id, n.title, n.audience, n.zone_id, n.hub_id, n.priority from public.notices n
           where n.requires_read and n.archived_at is null and n.publish_at < now() - interval '1 day' and (n.expires_at is null or n.expires_at > now()) loop
    for u in select distinct e.profile_id from public.employees e join public.profiles p on p.id = e.profile_id and p.status = 'active' and p.archived_at is null
             where e.archived_at is null and e.profile_id is not null
               and (q.audience = 'all' or (q.audience = 'zone' and e.zone_id = q.zone_id) or (q.audience = 'hub' and e.hub_id = q.hub_id))
               and not exists (select 1 from public.notice_reads r where r.notice_id = q.id and r.profile_id = e.profile_id) loop
      if private.wf_nudge('notice_read', q.id, ('x' || substr(md5(u::text), 1, 7))::bit(28)::integer) then
        perform private.notify_p(u, 'নোটিশ এখনো পড়া হয়নি: ' || q.title, 'অনুগ্রহ করে পড়ে "পড়েছি" চাপুন', '/app/notices', 'notice', 'high'); v_notice := v_notice + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('enabled', true, 'task_nudges', v_task, 'approval_nudges', v_appr, 'notice_nudges', v_notice);
end $$;
revoke all on function private.workflow_run() from public, anon, authenticated;

-- ---------------------------------------------------------------- 7. who do I report to
create or replace function public.my_report_line()
returns table (level integer, employee_id uuid, name text, post text, hub_name text, mobile text)
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select 1 as lvl, m.id, m.reporting_manager_id, array[e.id, m.id] as seen
    from public.employees e join public.employees m on m.id = e.reporting_manager_id
    where e.profile_id = auth.uid() and e.archived_at is null and m.archived_at is null
    union all
    select u.lvl + 1, m.id, m.reporting_manager_id, u.seen || m.id
    from up u join public.employees m on m.id = u.reporting_manager_id
    where m.archived_at is null and not m.id = any (u.seen) and u.lvl < 6
  )
  select u.lvl, e.id, e.full_name, pos.name, h.name, e.mobile
  from up u join public.employees e on e.id = u.id
  left join public.positions pos on pos.id = e.position_id
  left join public.hubs h on h.id = e.hub_id
  order by u.lvl
$$;

grant execute on function
  public.notice_publish(text, text, text, uuid, uuid, text, boolean, boolean, timestamptz, timestamptz),
  public.notice_list(integer), public.notice_mark_read(uuid), public.notice_archive(uuid),
  public.reminder_add(text, timestamptz, text, text, text, text), public.reminder_list(boolean),
  public.reminder_done(uuid), public.reminder_remove(uuid), public.my_report_line()
  to authenticated;

-- ---------------------------------------------------------------- schedules
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('reminders-fire', '* * * * *', $c$select private.reminders_fire()$c$);
    perform cron.schedule('wf-engine', '*/30 * * * *', $c$select private.workflow_run()$c$);
  end if;
end $$;
