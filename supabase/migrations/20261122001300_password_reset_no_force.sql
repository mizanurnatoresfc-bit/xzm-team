-- No forced password change (owner, 22 Nov 2026): neither a new login nor a password reset by an admin or hub manager
-- sends the person to the change-password page any more. They sign in with the password they were given and go
-- straight into the app; they can still change it themselves under সেটিং → পাসওয়ার্ড বদলান.
-- Before, both set must_change_password, which opened nothing but that page (and gave no permissions) until they
-- picked their own. The email "forgot password" link is not changed: it still ends on the set-a-new-password page.
-- The minimum length (now 6) lives in the admin-users Edge Function. Function bodies are otherwise as in
-- 20261113001500 (user_admin_note_reset) and 20261116000400 (user_admin_finish_create).

create or replace function public.user_admin_note_reset(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.user_admin_can_manage(p_user) then
    raise exception 'Not authorised to reset this password.' using errcode = '42501';
  end if;
  perform set_config('app.change_reason', 'Password reset by admin', true);
  update public.profiles set must_change_password = false, failed_login_count = 0, locked_until = null where id = p_user;
end $$;

create or replace function public.user_admin_finish_create(p_user uuid, p_full_name text, p_phone text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ((private.has_permission('system.user.create') and private.can_manage_user(p_user)) or private.hub_login_mine(p_user)) then
    raise exception 'Not authorised to set up this account.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and created_at > now() - interval '10 minutes'
                 and last_login_at is null) then
    raise exception 'Only a newly created account can be set up this way.' using errcode = 'P0001';
  end if;
  perform set_config('app.change_reason', 'Account created', true);
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         phone = nullif(trim(coalesce(p_phone, '')), ''),
         must_change_password = false,
         preferred_language = 'bn'
   where id = p_user;
end $$;

-- Accounts that are waiting on the change-password page today are let in.
do $$ begin
  perform set_config('app.change_reason', 'Forced password change turned off (owner)', true);
  update public.profiles set must_change_password = false where must_change_password;
end $$;
