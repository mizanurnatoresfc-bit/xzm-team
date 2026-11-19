-- =====================================================================
--  জোন গ্রুপ ও জোনাল ম্যানেজার (Zone group + zonal manager contact)
--  The staff panel's two "শীঘ্রই" rows, made real.
--  * zone_posts: one group per zone — everyone posted at any hub of the zone
--    (or at the zone itself), plus anyone whose issue permissions reach a hub
--    of the zone (hub managers, zonal manager, head office). Same shape as the
--    hub group: messages with an optional photo, reactions, "seen by".
--  * zone_contacts(zone): the zone's zonal manager(s) — people holding the
--    zonal_manager role for that zone, or else the zone-level posts there —
--    with their phone number, for call / SMS / WhatsApp.
--  * zone_manager_tell(zone, text): a written note straight to the zonal
--    manager(s) as a notification; kept in zone_manager_notes (20 a day each).
--  Nothing is hard-deleted; every write goes through a function.
-- =====================================================================

create table public.zone_posts (
  id             uuid primary key default gen_random_uuid(),
  zone_id        uuid not null references public.zones(id),
  author_profile uuid,                                   -- null = system
  author_name    text not null,
  body           text,
  photo_path     text,                                   -- private bucket "issue-photos", path zone/<zone_id>/<file>
  created_at     timestamptz not null default now(),
  constraint zone_posts_has_something check (body is not null or photo_path is not null)
);
create index zone_posts_zone_idx on public.zone_posts (zone_id, created_at desc);

create table public.zone_post_reactions (
  post_id    uuid not null references public.zone_posts(id),
  profile_id uuid not null,
  emoji      text not null check (emoji in ('👍', '❤️', '😮', '😢', '✅', '🙏')),
  at         timestamptz not null default now(),
  primary key (post_id, profile_id, emoji)
);
create index zone_post_reactions_profile_idx on public.zone_post_reactions (profile_id);

create table public.zone_post_seen (
  post_id    uuid not null references public.zone_posts(id),
  profile_id uuid not null,
  seen_at    timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index zone_post_seen_profile_idx on public.zone_post_seen (profile_id);

create table public.zone_manager_notes (
  id           uuid primary key default gen_random_uuid(),
  zone_id      uuid not null references public.zones(id),
  from_profile uuid not null,
  from_name    text not null,
  body         text not null check (length(trim(body)) between 2 and 500),
  sent_to      integer not null default 0,               -- how many managers were notified
  created_at   timestamptz not null default now()
);
create index zone_manager_notes_zone_idx on public.zone_manager_notes (zone_id, created_at desc);
create index zone_manager_notes_from_idx on public.zone_manager_notes (from_profile, created_at desc);

create trigger zone_posts_no_delete before delete on public.zone_posts for each row execute function private.prevent_delete();
create trigger zone_manager_notes_no_delete before delete on public.zone_manager_notes for each row execute function private.prevent_delete();

-- ---------------------------------------------------------------------
--  Who is in a zone's group
-- ---------------------------------------------------------------------
create or replace function private.in_zone_group(p_zone uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_zone is not null and (
    exists (select 1 from public.employees e left join public.hubs h on h.id = e.hub_id
            where e.profile_id = auth.uid() and e.archived_at is null and coalesce(e.zone_id, h.zone_id) = p_zone)
    or private.has_permission_within_zone('issue.group.view', p_zone)
    or private.has_permission_within_zone('issue.issue.view', p_zone)
    or private.has_permission_within_zone('issue.issue.create', p_zone))
$$;

-- The zone's zonal manager(s): zonal_manager role holders for the zone; if none, active zone-level posts in the zone.
create or replace function private.zone_manager_people(p_zone uuid)
returns table (profile_id uuid, employee_id uuid, full_name text, employee_code text, post_name text, phone text, via text)
language sql stable security definer set search_path = '' as $$
  with by_role as (
    select distinct on (ur.user_id) ur.user_id as profile_id, e.id as employee_id,
           coalesce(e.full_name, nullif(p.full_name, ''), 'জোনাল ম্যানেজার') as full_name, e.employee_code::text as employee_code,
           coalesce(ps.name, 'জোনাল ম্যানেজার') as post_name, coalesce(nullif(e.mobile, ''), nullif(p.phone, '')) as phone, 'role'::text as via
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.code = 'zonal_manager'
    join public.profiles p on p.id = ur.user_id and p.archived_at is null and p.status = 'active'
    left join public.employees e on e.profile_id = ur.user_id and e.archived_at is null
    left join public.positions ps on ps.id = e.position_id
    where ur.scope_type = 'zone' and ur.zone_id = p_zone and ur.revoked_at is null
      and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)
    order by ur.user_id, ur.created_at
  ), by_post as (
    select e.profile_id, e.id, e.full_name, e.employee_code::text, ps.name, nullif(e.mobile, ''), 'post'::text
    from public.employees e join public.positions ps on ps.id = e.position_id and ps.level = 'zone'
    where coalesce(e.zone_id, private.hub_zone(e.hub_id)) = p_zone and e.archived_at is null and e.status = 'active'
      and not exists (select 1 from by_role)
  )
  select * from by_role union all select * from by_post
$$;

alter table public.zone_posts enable row level security;
alter table public.zone_post_reactions enable row level security;
alter table public.zone_post_seen enable row level security;
alter table public.zone_manager_notes enable row level security;
revoke all on public.zone_posts, public.zone_post_reactions, public.zone_post_seen, public.zone_manager_notes from anon;
create policy zone_posts_read on public.zone_posts for select to authenticated using (private.in_zone_group(zone_id));
create policy zone_post_reactions_read on public.zone_post_reactions for select to authenticated
  using (exists (select 1 from public.zone_posts p where p.id = post_id));
create policy zone_post_seen_read on public.zone_post_seen for select to authenticated
  using (exists (select 1 from public.zone_posts p where p.id = post_id));
create policy zone_manager_notes_read on public.zone_manager_notes for select to authenticated
  using (from_profile = (select auth.uid()) or private.has_permission('issue.group.view', zone_id, null));
grant select on public.zone_posts, public.zone_post_reactions, public.zone_post_seen, public.zone_manager_notes to authenticated;

-- ---------------------------------------------------------------------
--  Zone groups the caller can open
-- ---------------------------------------------------------------------
create or replace function public.zone_group_list()
returns table (zone_id uuid, zone_name text, zone_code text, hubs integer, unseen integer, last_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select z.id, z.name, z.code::text,
         (select count(*)::int from public.hubs h where h.zone_id = z.id and h.archived_at is null),
         (select count(*)::int from public.zone_posts p where p.zone_id = z.id and p.author_profile is distinct from auth.uid()
            and not exists (select 1 from public.zone_post_seen s where s.post_id = p.id and s.profile_id = auth.uid())),
         (select max(p.created_at) from public.zone_posts p where p.zone_id = z.id),
         exists (select 1 from public.employees e left join public.hubs h on h.id = e.hub_id
                 where e.profile_id = auth.uid() and e.archived_at is null and coalesce(e.zone_id, h.zone_id) = z.id)
  from public.zones z where z.archived_at is null and private.in_zone_group(z.id)
  order by 7 desc, z.name
$$;

create or replace function public.zone_post_create(p_zone uuid, p_body text, p_photo text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  if not private.in_zone_group(p_zone) then raise exception 'এই জোনের গ্রুপে লেখার অনুমতি নেই' using errcode = '42501'; end if;
  if v_body is null and p_photo is null then raise exception 'কিছু লিখুন বা ছবি দিন' using errcode = '22023'; end if;
  if length(v_body) > 4000 then raise exception 'বার্তা অনেক বড় — ৪০০০ অক্ষরের মধ্যে লিখুন' using errcode = '22023'; end if;
  if p_photo is not null and p_photo not like 'zone/' || p_zone::text || '/%' then raise exception 'ছবিটা এই জোনের নয়' using errcode = '22023'; end if;
  insert into public.zone_posts (zone_id, author_profile, author_name, body, photo_path)
  values (p_zone, auth.uid(), private.my_display_name(), v_body, p_photo) returning id into v;
  return v;
end $$;

create or replace function public.zone_post_react(p_post uuid, p_emoji text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare p public.zone_posts;
begin
  select * into p from public.zone_posts where id = p_post;
  if not found or not private.in_zone_group(p.zone_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  if exists (select 1 from public.zone_post_reactions where post_id = p_post and profile_id = auth.uid() and emoji = p_emoji) then
    delete from public.zone_post_reactions where post_id = p_post and profile_id = auth.uid() and emoji = p_emoji;
    return false;
  end if;
  insert into public.zone_post_reactions (post_id, profile_id, emoji) values (p_post, auth.uid(), p_emoji);
  return true;
end $$;

create or replace function public.zone_posts_seen(p_posts uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with ok as (select p.id from public.zone_posts p where p.id = any(p_posts) and private.in_zone_group(p.zone_id))
  insert into public.zone_post_seen (post_id, profile_id) select id, auth.uid() from ok on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Same shape as hub_feed, so the page draws both the same way.
create or replace function public.zone_feed(p_zone uuid, p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.in_zone_group(p_zone) then raise exception 'এই জোনের গ্রুপ দেখার অনুমতি নেই' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row order by (row->>'created_at') desc) from (
      select jsonb_build_object(
        'id', p.id, 'author_name', p.author_name, 'is_nodi', p.author_profile is null, 'mine', p.author_profile = auth.uid(),
        'kind', 'text', 'body', p.body, 'photo_path', p.photo_path, 'created_at', p.created_at, 'issue', null,
        'reactions', coalesce((select jsonb_object_agg(emoji, jsonb_build_object('n', n, 'mine', mine)) from (
              select r.emoji, count(*) n, bool_or(r.profile_id = auth.uid()) mine from public.zone_post_reactions r where r.post_id = p.id group by r.emoji) q), '{}'::jsonb),
        'seen_count', (select count(*) from public.zone_post_seen s where s.post_id = p.id),
        'seen_by_me', p.author_profile = auth.uid() or exists (select 1 from public.zone_post_seen s where s.post_id = p.id and s.profile_id = auth.uid())
      ) as row
      from public.zone_posts p
      where p.zone_id = p_zone and (p_before is null or p.created_at < p_before)
      order by p.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) t), '[]'::jsonb);
end $$;

create or replace function public.zone_post_seen_by(p_post uuid)
returns table (profile_id uuid, full_name text, employee_code text, seen_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare p public.zone_posts;
begin
  select * into p from public.zone_posts where id = p_post;
  if not found or not private.in_zone_group(p.zone_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return query
  select s.profile_id, coalesce(e.full_name, pr.full_name, '—'), e.employee_code::text, s.seen_at
  from public.zone_post_seen s left join public.profiles pr on pr.id = s.profile_id
       left join public.employees e on e.profile_id = s.profile_id and e.archived_at is null
  where s.post_id = p_post order by s.seen_at;
end $$;

create or replace function public.zone_post_reacted_by(p_post uuid)
returns table (emoji text, full_name text, employee_code text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare p public.zone_posts;
begin
  select * into p from public.zone_posts where id = p_post;
  if not found or not private.in_zone_group(p.zone_id) then raise exception 'অনুমতি নেই' using errcode = '42501'; end if;
  return query
  select r.emoji, coalesce(e.full_name, pr.full_name, '—'), e.employee_code::text, r.at
  from public.zone_post_reactions r left join public.profiles pr on pr.id = r.profile_id
       left join public.employees e on e.profile_id = r.profile_id and e.archived_at is null
  where r.post_id = p_post order by r.at;
end $$;

-- ---------------------------------------------------------------------
--  Zonal manager contact
-- ---------------------------------------------------------------------
-- p_zone null = the caller's own zone (from their employee record).
create or replace function public.zone_contacts(p_zone uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_zone uuid := p_zone; z public.zones;
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if v_zone is null then
    select coalesce(e.zone_id, h.zone_id) into v_zone from public.employees e left join public.hubs h on h.id = e.hub_id
    where e.profile_id = auth.uid() and e.archived_at is null limit 1;
    if v_zone is null then return null; end if;            -- no staff record: nothing to show
  end if;
  if not private.in_zone_group(v_zone) then raise exception 'এই জোনের তথ্য দেখার অনুমতি নেই' using errcode = '42501'; end if;
  select * into z from public.zones where id = v_zone;
  return jsonb_build_object('zone_id', z.id, 'zone_name', z.name, 'zone_code', z.code::text,
    'managers', coalesce((select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'full_name', m.full_name, 'employee_code', m.employee_code,
                    'position', m.post_name, 'phone', m.phone, 'has_login', m.profile_id is not null, 'is_me', m.profile_id = auth.uid()) order by m.full_name)
                  from private.zone_manager_people(v_zone) m), '[]'::jsonb),
    'sent_today', (select count(*)::int from public.zone_manager_notes n where n.from_profile = auth.uid() and n.created_at > now() - interval '24 hours'));
end $$;

create or replace function public.zone_manager_tell(p_zone uuid, p_body text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_body text := nullif(trim(coalesce(p_body, '')), ''); v_name text; v_n integer := 0; m record;
begin
  if not private.in_zone_group(p_zone) then raise exception 'এই জোনের জোনাল ম্যানেজারকে লেখার অনুমতি নেই' using errcode = '42501'; end if;
  if v_body is null or length(v_body) < 2 then raise exception 'কী জানাতে চান লিখুন' using errcode = '22023'; end if;
  if length(v_body) > 500 then raise exception '৫০০ অক্ষরের মধ্যে লিখুন' using errcode = '22023'; end if;
  if (select count(*) from public.zone_manager_notes n where n.from_profile = auth.uid() and n.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'আজ অনেকবার লেখা হয়েছে — জরুরি হলে ফোন করুন' using errcode = '22023'; end if;
  v_name := private.my_display_name();
  for m in select distinct x.profile_id from private.zone_manager_people(p_zone) x where x.profile_id is not null and x.profile_id <> auth.uid() loop
    perform private.notify(m.profile_id, 'স্টাফের বার্তা — ' || v_name,
      v_body || coalesce(' · ' || (select h.name from public.employees e join public.hubs h on h.id = e.hub_id where e.profile_id = auth.uid() and e.archived_at is null limit 1), ''),
      '/app/issues?tab=zone&z=' || p_zone::text, 'zone_manager_note');
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'এই জোনে লগইন আছে এমন কোনো জোনাল ম্যানেজার নেই — ফোন করুন' using errcode = '22023'; end if;
  insert into public.zone_manager_notes (zone_id, from_profile, from_name, body, sent_to) values (p_zone, auth.uid(), v_name, v_body, v_n);
  return v_n;
end $$;

-- ---------------------------------------------------------------------
--  Photos: same private bucket, path zone/<zone_id>/<file>
-- ---------------------------------------------------------------------
create or replace function private.zone_object_zone(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^zone/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' then split_part(p_name, '/', 2)::uuid end
$$;
drop policy if exists zone_photos_read on storage.objects;
create policy zone_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'issue-photos' and private.in_zone_group(private.zone_object_zone(name)));
drop policy if exists zone_photos_write on storage.objects;
create policy zone_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-photos' and private.in_zone_group(private.zone_object_zone(name)));

-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.zone_group_list()', 'public.zone_post_create(uuid, text, text)', 'public.zone_post_react(uuid, text)', 'public.zone_posts_seen(uuid[])',
    'public.zone_feed(uuid, timestamptz, integer)', 'public.zone_post_seen_by(uuid)', 'public.zone_post_reacted_by(uuid)',
    'public.zone_contacts(uuid)', 'public.zone_manager_tell(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.in_zone_group(uuid), private.zone_object_zone(text) from public, anon;
grant execute on function private.in_zone_group(uuid), private.zone_object_zone(text) to authenticated;
revoke all on function private.zone_manager_people(uuid) from public, anon, authenticated;
