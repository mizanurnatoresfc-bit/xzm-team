-- The test runner creates the database with timezone UTC (like Supabase) before
-- migrations, so these checks prove the migration switches new sessions to Dhaka.
begin;

select tests.ok(current_setting('TimeZone') = 'Asia/Dhaka',
  'a new connection runs in Asia/Dhaka even though the server default is UTC');

select tests.ok(current_date = (now() at time zone 'Asia/Dhaka')::date,
  'current_date is the Bangladesh date');

select tests.ok(private.setting_text('system.timezone') = 'Asia/Dhaka',
  'business time zone is recorded in system settings');

select tests.ok((select (r.value #>> '{}') = 'Asia/Dhaka' and r.is_public from public.system_settings r where r.key = 'system.timezone'),
  'business time zone setting is public (needed by the login page clock)');

-- The setting is per database, so an API user inherits it too.
select tests.login(gen_random_uuid());
select tests.ok(current_setting('TimeZone') = 'Asia/Dhaka', 'API users see Dhaka time');
select tests.ok((select ok from public.system_timezone_ok()), 'health check reports ok for an API user');
select tests.ok((select business_today = server_today from public.system_timezone_ok()), 'health check: business day = server day');
select tests.logout();

-- A wrong session time zone is detected by the health check.
set local timezone to 'UTC';
select tests.ok((select not ok from public.system_timezone_ok()), 'health check flags a session that is not in Dhaka time');

-- Anonymous visitors cannot call the health check.
select tests.login_anon();
select tests.throws('select * from public.system_timezone_ok()', 'anon cannot call the time zone health check', '42501');
select tests.logout();

rollback;
