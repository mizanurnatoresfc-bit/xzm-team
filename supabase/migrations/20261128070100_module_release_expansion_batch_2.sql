-- Priority 01 follow-up batch 2: same guard pattern as 20261128062647 and 20261128070000.
-- Each RPC here was vetted:
--   * takes `p_hub uuid` (or a hub-equivalent) as the first argument — resource-derived hub, no lookup;
--   * has zero real internal callers in the migration tree (grant/revoke lines are not callers);
--   * returns a scalar / jsonb (table-returning RPCs stay out of this batch — they need a different
--     `return query` wrapper and a column-list copy, which is reviewed separately);
--   * still runs its original validation, permissions and resource checks inside the private
--     implementation — the wrapper only adds `module_release_require(module, hub)` on top.
-- Guarded modules used (all seeded `legacy_live = true` in 20261128062647, so wrappers are transparent
-- at the default stage and only refuse once Super Admin flips the module to development/testing/disabled).
--
-- Attendance family (module 'attendance'):
alter function public.att_sheet_submit(uuid, date, jsonb) set schema private;
revoke all on function private.att_sheet_submit(uuid, date, jsonb) from public, anon, authenticated;
create function public.att_sheet_submit(p_hub uuid, p_date date, p_lines jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_sheet_submit(p_hub, p_date, p_lines);
end $$;
revoke all on function public.att_sheet_submit(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.att_sheet_submit(uuid, date, jsonb) to authenticated;

alter function public.att_days_save(uuid, date, date, jsonb) set schema private;
revoke all on function private.att_days_save(uuid, date, date, jsonb) from public, anon, authenticated;
create function public.att_days_save(p_hub uuid, p_from date, p_to date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_days_save(p_hub, p_from, p_to, p_rows);
end $$;
revoke all on function public.att_days_save(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.att_days_save(uuid, date, date, jsonb) to authenticated;

alter function public.att_month_get(uuid, date) set schema private;
revoke all on function private.att_month_get(uuid, date) from public, anon, authenticated;
create function public.att_month_get(p_hub uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_month_get(p_hub, p_month);
end $$;
revoke all on function public.att_month_get(uuid, date) from public, anon, authenticated;
grant execute on function public.att_month_get(uuid, date) to authenticated;

alter function public.att_month_sheet(uuid, date) set schema private;
revoke all on function private.att_month_sheet(uuid, date) from public, anon, authenticated;
create function public.att_month_sheet(p_hub uuid, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_month_sheet(p_hub, p_month);
end $$;
revoke all on function public.att_month_sheet(uuid, date) from public, anon, authenticated;
grant execute on function public.att_month_sheet(uuid, date) to authenticated;

alter function public.att_month_submit(uuid, date) set schema private;
revoke all on function private.att_month_submit(uuid, date) from public, anon, authenticated;
create function public.att_month_submit(p_hub uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_month_submit(p_hub, p_month);
end $$;
revoke all on function public.att_month_submit(uuid, date) from public, anon, authenticated;
grant execute on function public.att_month_submit(uuid, date) to authenticated;

alter function public.att_reopen_list(uuid) set schema private;
revoke all on function private.att_reopen_list(uuid) from public, anon, authenticated;
create function public.att_reopen_list(p_hub uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_reopen_list(p_hub);
end $$;
revoke all on function public.att_reopen_list(uuid) from public, anon, authenticated;
grant execute on function public.att_reopen_list(uuid) to authenticated;

alter function public.att_reopen_open(uuid, date, date, integer, text) set schema private;
revoke all on function private.att_reopen_open(uuid, date, date, integer, text) from public, anon, authenticated;
create function public.att_reopen_open(p_hub uuid, p_from date, p_to date, p_minutes integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_reopen_open(p_hub, p_from, p_to, p_minutes, p_reason);
end $$;
revoke all on function public.att_reopen_open(uuid, date, date, integer, text) from public, anon, authenticated;
grant execute on function public.att_reopen_open(uuid, date, date, integer, text) to authenticated;

alter function public.att_self_list(uuid, date) set schema private;
revoke all on function private.att_self_list(uuid, date) from public, anon, authenticated;
create function public.att_self_list(p_hub uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_self_list(p_hub, p_date);
end $$;
revoke all on function public.att_self_list(uuid, date) from public, anon, authenticated;
grant execute on function public.att_self_list(uuid, date) to authenticated;

-- Daily-accounts family (module 'accounts'):
alter function public.da_accounts_history(uuid, date, date, integer) set schema private;
revoke all on function private.da_accounts_history(uuid, date, date, integer) from public, anon, authenticated;
create function public.da_accounts_history(p_hub uuid, p_from date default null, p_to date default null, p_limit integer default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return private.da_accounts_history(p_hub, p_from, p_to, p_limit);
end $$;
revoke all on function public.da_accounts_history(uuid, date, date, integer) from public, anon, authenticated;
grant execute on function public.da_accounts_history(uuid, date, date, integer) to authenticated;

alter function public.da_assign_accountant(uuid, uuid, text) set schema private;
revoke all on function private.da_assign_accountant(uuid, uuid, text) from public, anon, authenticated;
create function public.da_assign_accountant(p_hub uuid, p_user uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return private.da_assign_accountant(p_hub, p_user, p_reason);
end $$;
revoke all on function public.da_assign_accountant(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.da_assign_accountant(uuid, uuid, text) to authenticated;

alter function public.da_import_save(uuid, date, text, jsonb) set schema private;
revoke all on function private.da_import_save(uuid, date, text, jsonb) from public, anon, authenticated;
create function public.da_import_save(p_hub uuid, p_date date, p_raw text, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return private.da_import_save(p_hub, p_date, p_raw, p_report);
end $$;
revoke all on function public.da_import_save(uuid, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.da_import_save(uuid, date, text, jsonb) to authenticated;

-- Workforce family (module 'workforce'):
alter function public.wf_pending_hub_today(uuid) set schema private;
revoke all on function private.wf_pending_hub_today(uuid) from public, anon, authenticated;
create function public.wf_pending_hub_today(p_hub uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('workforce', p_hub);
  return private.wf_pending_hub_today(p_hub);
end $$;
revoke all on function public.wf_pending_hub_today(uuid) from public, anon, authenticated;
grant execute on function public.wf_pending_hub_today(uuid) to authenticated;

alter function public.wf_pending_month(uuid, date) set schema private;
revoke all on function private.wf_pending_month(uuid, date) from public, anon, authenticated;
create function public.wf_pending_month(p_hub uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('workforce', p_hub);
  return private.wf_pending_month(p_hub, p_month);
end $$;
revoke all on function public.wf_pending_month(uuid, date) from public, anon, authenticated;
grant execute on function public.wf_pending_month(uuid, date) to authenticated;

-- HR family (module 'hr'):
alter function public.hr_staff_join_request(uuid, uuid, jsonb) set schema private;
revoke all on function private.hr_staff_join_request(uuid, uuid, jsonb) from public, anon, authenticated;
create function public.hr_staff_join_request(p_hub uuid, p_position uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('hr', p_hub);
  return private.hr_staff_join_request(p_hub, p_position, p_data);
end $$;
revoke all on function public.hr_staff_join_request(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.hr_staff_join_request(uuid, uuid, jsonb) to authenticated;
