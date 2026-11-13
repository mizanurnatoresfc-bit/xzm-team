-- Business day = Bangladesh day (Asia/Dhaka, UTC+6).
--
-- Supabase databases run in UTC by default. Many rules use current_date / now()::date
-- (attendance, leave, hub figures, parcels, imports, role validity). In UTC, between
-- 00:00 and 05:59 Dhaka time the database still thinks it is the previous day, so
-- "today" would be rejected as a future date and reports would land on the wrong day.
--
-- Setting the database time zone makes every new connection use Dhaka time. Stored
-- timestamps (timestamptz) are absolute and do not change; only how "today" and
-- times are read changes. This is the method Supabase documents for changing the
-- time zone. Pooled connections pick it up as they are recycled (a project restart
-- applies it everywhere at once).

do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Dhaka');
end $$;

-- The rest of this migration session uses it too.
set timezone to 'Asia/Dhaka';

insert into public.system_settings (key, value, description, is_public) values
  ('system.timezone', '"Asia/Dhaka"', 'Business time zone. "Today" for every rule is the Bangladesh date.', true)
on conflict (key) do nothing;

-- Health check an admin (or a monitoring job) can call: returns false if the
-- connection is not running in the business time zone.
create or replace function public.system_timezone_ok()
returns table (ok boolean, session_timezone text, business_timezone text, business_today date, server_today date)
language sql stable security invoker set search_path = '' as $$
  select current_setting('TimeZone') = s.tz,
         current_setting('TimeZone'),
         s.tz,
         (now() at time zone s.tz)::date,
         current_date
  from (select coalesce(private.setting_text('system.timezone'), 'Asia/Dhaka') as tz) s
$$;
revoke all on function public.system_timezone_ok() from public, anon;
grant execute on function public.system_timezone_ok() to authenticated;
