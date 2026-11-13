-- Login lockout: the Custom Access Token hook refuses sessions for locked, inactive
-- or archived accounts; the Edge Function helpers are service-only.
begin;
select tests.fixture();

create temp table hook_ev(e jsonb) on commit drop;
create or replace function pg_temp.ev(p uuid) returns jsonb language sql as $$
  select jsonb_build_object('user_id', p, 'claims', jsonb_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1'))
$$;

-- Active account: claims pass through unchanged.
select tests.ok(public.custom_access_token_hook(pg_temp.ev(tests.id('hub_mgr'))) -> 'claims' ->> 'sub' = tests.id('hub_mgr')::text,
  'active account gets its claims back');
select tests.ok(public.custom_access_token_hook(pg_temp.ev(tests.id('hub_mgr'))) -> 'error' is null,
  'active account is not refused');
select tests.ok((select not locked and active from public.login_lock_state('hub.a1@test.local')),
  'lock state: active and not locked');

-- Five wrong passwords lock the account; the hook then refuses a session.
select public.record_login_attempt('hub.a1@test.local', false, 'staff', 'bad password') from generate_series(1, 5);
select tests.ok((select locked from public.login_lock_state('hub.a1@test.local')), 'lock state: locked after 5 failures');
select tests.ok((public.custom_access_token_hook(pg_temp.ev(tests.id('hub_mgr'))) -> 'error' ->> 'http_code')::int = 403,
  'locked account is refused a session (403)');
select tests.ok(public.custom_access_token_hook(pg_temp.ev(tests.id('hub_mgr'))) -> 'error' ->> 'message' like 'Account locked%',
  'refusal explains the lock');

-- After the lock expires the account works again.
update public.profiles set locked_until = now() - interval '1 minute' where id = tests.id('hub_mgr');
select tests.ok(public.custom_access_token_hook(pg_temp.ev(tests.id('hub_mgr'))) -> 'error' is null,
  'expired lock no longer blocks');

-- Inactive and archived accounts are refused.
update public.profiles set status = 'inactive' where id = tests.id('hub_mgr');
select tests.ok(public.custom_access_token_hook(pg_temp.ev(tests.id('hub_mgr'))) -> 'error' ->> 'message' like '%not active%',
  'inactive account is refused');
select tests.ok((select not active from public.login_lock_state('hub.a1@test.local')), 'lock state: inactive');
update public.profiles set status = 'active', archived_at = now() where id = tests.id('hub_mgr');
select tests.ok(public.custom_access_token_hook(pg_temp.ev(tests.id('hub_mgr'))) -> 'error' is not null,
  'archived account is refused');

-- Unknown user id (no profile yet): claims pass, Auth decides.
select tests.ok(public.custom_access_token_hook(pg_temp.ev(gen_random_uuid())) -> 'claims' is not null,
  'user without a profile is not blocked by the hook');

-- Only Supabase Auth and the Edge Function can call these.
select tests.ok(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'Supabase Auth can run the hook');
select tests.ok(not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute')
            and not has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'browsers cannot run the hook');
select tests.ok(has_function_privilege('service_role', 'public.login_lock_state(text)', 'execute')
            and not has_function_privilege('authenticated', 'public.login_lock_state(text)', 'execute')
            and not has_function_privilege('anon', 'public.login_lock_state(text)', 'execute'),
  'lock state is readable by the Edge Function only');

rollback;
