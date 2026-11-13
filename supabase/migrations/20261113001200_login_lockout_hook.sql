-- Login lockout, enforced by Supabase Auth itself.
--
-- 1. The `auth-login` Edge Function counts failed passwords with record_login_attempt()
--    (5 failures -> locked 30 minutes; both numbers are system settings).
-- 2. This Custom Access Token hook makes Supabase Auth refuse to issue or refresh a
--    session for an account that is locked, inactive or archived - even when someone
--    calls the Auth API directly with the public key instead of going through the
--    Edge Function. Turn it on once in the dashboard:
--    Authentication -> Hooks -> Customize Access Token (JWT) Claims -> Postgres function
--    -> public.custom_access_token_hook.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = (event ->> 'user_id')::uuid;
  if p.id is not null then
    if p.locked_until is not null and p.locked_until > now() then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403,
        'message', 'Account locked after too many failed sign-ins. Try again after '
                   || to_char(p.locked_until at time zone 'Asia/Dhaka', 'DD/MM/YYYY HH24:MI') || ' (Dhaka time).'));
    end if;
    if p.status <> 'active' or p.archived_at is not null then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403, 'message', 'This account is not active. Contact your system administrator.'));
    end if;
  end if;
  return jsonb_build_object('claims', event -> 'claims');
end $$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

-- Lockout state for the Edge Function, before it asks Auth to check the password.
-- service_role only (the Edge Function); browsers cannot call it.
create or replace function public.login_lock_state(p_email text)
returns table (locked boolean, locked_until timestamptz, active boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(p.locked_until > now(), false), p.locked_until,
         p.status = 'active' and p.archived_at is null
  from public.profiles p where p.email = p_email::extensions.citext
$$;
revoke all on function public.login_lock_state(text) from public, anon, authenticated;
grant execute on function public.login_lock_state(text) to service_role;
