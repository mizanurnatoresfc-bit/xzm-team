-- =====================================================================
--  হাজিরা বই: পুরো মাস খোলা (১–৩১) — অন/অফ (owner, 21 Nov 2026: "১-৩১ তারিখ ওপেন অন/অফ করে দেন")
--
--  One company-wide switch, setting `workforce.book_full_month` (true / false, default false).
--    on  -> the attendance book is open on every day of the month (1–31): staff give every date in the book,
--           the staff panel sends them there all month, the daily reminder runs all month.
--    off -> the book follows `workforce.book_from_day` / `book_to_day` again (1–17 today), exactly as before.
--  Only the Super Admin flips it (wf_book_full_month_set); everyone signed in may read it (wf_book_mode).
--  Every change is kept in audit_logs (system_settings is audited) with the reason given.
--
--  Every rule that uses the book days goes through private.wf_from_day() / private.wf_to_day(), so only those
--  two change. Earlier-date windows (wf_window_save) keep working: with the switch on, a month's book days are 1–31.
--
--  Rollback: run the two functions from 20261117010000_workforce_attendance.sql again; drop wf_book_mode,
--  wf_book_full_month_set and private.wf_full_month; delete the setting row `workforce.book_full_month`.
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('workforce.book_full_month', 'false', 'Attendance book: open on every day of the month (1-31) instead of book_from_day..book_to_day')
on conflict (key) do nothing;

create or replace function private.wf_full_month() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value #>> '{}' = 'true' from public.system_settings s where s.key = 'workforce.book_full_month'), false)
$$;

create or replace function private.wf_from_day() returns integer language sql stable set search_path = '' as
  $$ select case when private.wf_full_month() then 1 else private.wf_int('workforce.book_from_day', 1, 1, 28) end $$;
create or replace function private.wf_to_day() returns integer language sql stable set search_path = '' as
  $$ select case when private.wf_full_month() then 31
                 else greatest(private.wf_from_day(), private.wf_int('workforce.book_to_day', 17, 1, 31)) end $$;

-- What the switch says now, and the normal days it falls back to.
create or replace function public.wf_book_mode() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'full_month', private.wf_full_month(),
    'from_day', private.wf_from_day(), 'to_day', private.wf_to_day(),
    'normal_from_day', private.wf_int('workforce.book_from_day', 1, 1, 28),
    'normal_to_day', greatest(private.wf_int('workforce.book_from_day', 1, 1, 28), private.wf_int('workforce.book_to_day', 17, 1, 31)),
    'can_set', private.is_super_admin(),
    'changed_at', (select s.updated_at from public.system_settings s where s.key = 'workforce.book_full_month'),
    'changed_by_name', (select p.full_name from public.system_settings s join public.profiles p on p.id = s.updated_by
                         where s.key = 'workforce.book_full_month'))
  where auth.uid() is not null
$$;

create or replace function public.wf_book_full_month_set(p_on boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_note text := private.wf_clean(p_note, 300);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not private.is_super_admin() then
    raise exception 'Only the Super Admin can open the book for the whole month — শুধু সুপার অ্যাডমিন পুরো মাস খুলতে পারেন' using errcode = '42501';
  end if;
  if p_on is null then raise exception 'Say on or off' using errcode = '22023'; end if;
  if private.wf_full_month() is distinct from p_on then
    perform set_config('app.change_reason',
      coalesce(v_note, case when p_on then 'হাজিরা বই পুরো মাস (১–৩১) খোলা' else 'হাজিরা বই আবার নিয়মিত দিনে' end), true);
    insert into public.system_settings (key, value, description, updated_at, updated_by)
    values ('workforce.book_full_month', to_jsonb(p_on), 'Attendance book: open on every day of the month (1-31) instead of book_from_day..book_to_day', now(), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
  return public.wf_book_mode();
end $$;

revoke all on function private.wf_full_month() from public, anon, authenticated;
revoke all on function public.wf_book_mode() from public, anon;
revoke all on function public.wf_book_full_month_set(boolean, text) from public, anon;
grant execute on function public.wf_book_mode() to authenticated, service_role;
grant execute on function public.wf_book_full_month_set(boolean, text) to authenticated, service_role;
