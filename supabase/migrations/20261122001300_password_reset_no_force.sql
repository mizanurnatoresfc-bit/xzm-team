-- Password reset without a forced change (owner, 22 Nov 2026): when an admin or hub manager resets someone's password,
-- that person now signs in with it and goes straight into the app. Before, the reset also set must_change_password,
-- which opened nothing but the change-password page until they picked their own.
-- New logins and the email "forgot password" link are not changed. The minimum length (now 6) lives in the
-- admin-users Edge Function. Everything else is as in 20261113001500.

create or replace function public.user_admin_note_reset(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.user_admin_can_manage(p_user) then
    raise exception 'Not authorised to reset this password.' using errcode = '42501';
  end if;
  perform set_config('app.change_reason', 'Password reset by admin', true);
  update public.profiles set must_change_password = false, failed_login_count = 0, locked_until = null where id = p_user;
end $$;
