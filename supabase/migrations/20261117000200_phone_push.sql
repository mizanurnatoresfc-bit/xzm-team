-- =====================================================================
--  ফোনে পুশ (phone push through Firebase Cloud Messaging)
--  * push_devices: each phone's FCM token, saved by the app for the
--    signed-in person (push_device_save / push_device_remove).
--  * notifications.pushed_at: when a notification was sent to the phones.
--  * A new notification calls the Edge Function `push-send` (pg_net). The
--    function itself reads the unsent rows with its own key, sends them and
--    marks them, so the call carries no secret and repeating it is harmless.
--    pg_cron also calls it every two minutes for anything missed.
--  * Nothing is sent until the function has the Firebase key (secret
--    FCM_SERVICE_ACCOUNT); until then rows simply wait unsent.
--  Rollback: drop the trigger notifications_push and function private.push_kick,
--  unschedule the cron job 'push-send', drop the push_device_* functions,
--  drop table push_devices, drop column notifications.pushed_at.
-- =====================================================================
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
end $$;

alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

create table if not exists public.push_devices (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null,
  token       text not null unique check (length(token) between 20 and 4096),
  platform    text not null default 'android' check (platform in ('android', 'ios', 'web')),
  app_version text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  disabled_at timestamptz
);
create index if not exists push_devices_profile_idx on public.push_devices (profile_id) where disabled_at is null;
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
create policy push_devices_own on public.push_devices for select to authenticated using (profile_id = (select auth.uid()));
grant select on public.push_devices to authenticated;

-- The app calls this after sign-in with the phone's token. A token moves to whoever signed in last on that phone.
create or replace function public.push_device_save(p_token text, p_platform text default 'android', p_version text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'লগইন করুন' using errcode = '42501'; end if;
  if p_token is null or length(p_token) < 20 then raise exception 'token' using errcode = '22023'; end if;
  insert into public.push_devices (profile_id, token, platform, app_version)
  values (auth.uid(), p_token, coalesce(nullif(p_platform, ''), 'android'), left(p_version, 40))
  on conflict (token) do update set profile_id = auth.uid(), platform = excluded.platform, app_version = excluded.app_version,
    last_seen = now(), disabled_at = null;
end $$;

-- Sign-out on a phone: that phone stops getting this person's pushes.
create or replace function public.push_device_remove(p_token text)
returns void language sql security definer set search_path = '' as $$
  update public.push_devices set disabled_at = now() where token = p_token and profile_id = auth.uid()
$$;

revoke all on function public.push_device_save(text, text, text), public.push_device_remove(text) from public, anon;
grant execute on function public.push_device_save(text, text, text), public.push_device_remove(text) to authenticated;

-- Wake the sender. Only where pg_net is present (Supabase); a local test database has none.
create or replace function private.push_kick() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net')
     and exists (select 1 from public.push_devices d where d.profile_id = new.profile_id and d.disabled_at is null) then
    execute $q$select net.http_post(url := $1, body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 5000)$q$
      using 'https://ndgnhvbpmtxrpplgsslz.supabase.co/functions/v1/push-send';
  end if;
  return null;
exception when others then
  return null;   -- a notification is never lost because the push could not be started
end $$;
create or replace trigger notifications_push after insert on public.notifications for each row execute function private.push_kick();
revoke all on function private.push_kick() from public, anon, authenticated;

-- The sender takes a batch of unsent rows at once, so two runs never send the same one. Service role only.
create or replace function public.push_claim(p_limit integer default 100)
returns table (id uuid, profile_id uuid, title text, body text, link text, kind text, tokens text[])
language sql security definer set search_path = '' as $$
  with c as (
    select n.id from public.notifications n
    where n.pushed_at is null and n.created_at > now() - interval '2 hours'
    order by n.created_at limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked)
  update public.notifications n set pushed_at = now() from c where n.id = c.id
  returning n.id, n.profile_id, n.title, n.body, n.link, n.kind,
    array(select d.token from public.push_devices d where d.profile_id = n.profile_id and d.disabled_at is null)
$$;
-- A token Firebase says is dead stops being used.
create or replace function public.push_device_dead(p_tokens text[])
returns void language sql security definer set search_path = '' as $$
  update public.push_devices set disabled_at = now() where token = any (p_tokens) and disabled_at is null
$$;
revoke all on function public.push_claim(integer), public.push_device_dead(text[]) from public, anon, authenticated;
grant execute on function public.push_claim(integer), public.push_device_dead(text[]) to service_role;

-- Anything the trigger missed goes out within two minutes.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') and exists (select 1 from pg_namespace where nspname = 'net') then
    perform cron.schedule('push-send', '*/2 * * * *',
      $c$select net.http_post(url := 'https://ndgnhvbpmtxrpplgsslz.supabase.co/functions/v1/push-send', body := '{}'::jsonb,
         headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 5000)
         where exists (select 1 from public.notifications where pushed_at is null and created_at > now() - interval '2 hours')$c$);
  end if;
end $$;
