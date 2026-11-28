-- Priority 01 follow-up batch 3: Release Guard on seven table-returning RPCs.
-- Table returns need the wrapper to use RETURNS TABLE (same column list) plus
-- RETURN QUERY SELECT * FROM private.X(...), which is why these were held out of
-- the scalar-return batches 1 and 2. Each pick was vetted the same way:
--   * `p_hub uuid` first argument so hub is resource-derived, no lookup;
--   * zero real internal callers in the migration tree (grants/revokes don't count);
--   * the private body's own validation, permissions and resource checks stay in force
--     — the wrapper only adds `module_release_require(module, p_hub)` on top.
--
-- Guarded here:
--   att_days_list(uuid, date, date)         → module 'attendance'   (hub mgr attendance days list)
--   hub_login_list(uuid)                    → module 'hub.logins'   (per-hub login inventory)
--   da_hub_employees(uuid)                  → module 'accounts'     (hub employee list for sheet entry)
--   da_hub_access(uuid)                     → module 'accounts'     (per-hub DA capability matrix)
--   da_lookup_employee(uuid, text)          → module 'accounts'     (code → employee lookup inside sheet)
--   da_lookup_merchant(uuid, text)          → module 'accounts'     (merchant search inside sheet)
--   da_match_payment(uuid, text)            → module 'accounts'     (payment reference → merchant match)

alter function public.att_days_list(uuid, date, date) set schema private;
revoke all on function private.att_days_list(uuid, date, date) from public, anon, authenticated;
create function public.att_days_list(p_hub uuid, p_from date, p_to date)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, site_days integer,
               online_days integer, register_days integer, note text, submitted_by_name text, submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return query select * from private.att_days_list(p_hub, p_from, p_to);
end $$;
revoke all on function public.att_days_list(uuid, date, date) from public, anon, authenticated;
grant execute on function public.att_days_list(uuid, date, date) to authenticated;

alter function public.hub_login_list(uuid) set schema private;
revoke all on function private.hub_login_list(uuid) from public, anon, authenticated;
create function public.hub_login_list(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, position_name text, position_name_bn text, mobile text,
               role_id uuid, role_code text, can_make boolean, user_id uuid, login_id text, must_change boolean,
               last_login_at timestamptz, locked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('hub.logins', p_hub);
  return query select * from private.hub_login_list(p_hub);
end $$;
revoke all on function public.hub_login_list(uuid) from public, anon, authenticated;
grant execute on function public.hub_login_list(uuid) to authenticated;

alter function public.da_hub_employees(uuid) set schema private;
revoke all on function private.da_hub_employees(uuid) from public, anon, authenticated;
create function public.da_hub_employees(p_hub uuid)
returns table (employee_id uuid, employee_code text, full_name text, mobile text, is_rider boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return query select * from private.da_hub_employees(p_hub);
end $$;
revoke all on function public.da_hub_employees(uuid) from public, anon, authenticated;
grant execute on function public.da_hub_employees(uuid) to authenticated;

alter function public.da_hub_access(uuid) set schema private;
revoke all on function private.da_hub_access(uuid) from public, anon, authenticated;
create function public.da_hub_access(p_hub uuid)
returns table (user_id uuid, full_name text, role_name text, scope_type text, can_submit boolean, can_verify boolean, can_correct boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return query select * from private.da_hub_access(p_hub);
end $$;
revoke all on function public.da_hub_access(uuid) from public, anon, authenticated;
grant execute on function public.da_hub_access(uuid) to authenticated;

alter function public.da_lookup_employee(uuid, text) set schema private;
revoke all on function private.da_lookup_employee(uuid, text) from public, anon, authenticated;
create function public.da_lookup_employee(p_hub uuid, p_code text)
returns table (employee_id uuid, employee_code text, full_name text, mobile text, hub_id uuid, hub_name text,
               allowed boolean, is_rider boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return query select * from private.da_lookup_employee(p_hub, p_code);
end $$;
revoke all on function public.da_lookup_employee(uuid, text) from public, anon, authenticated;
grant execute on function public.da_lookup_employee(uuid, text) to authenticated;

alter function public.da_lookup_merchant(uuid, text) set schema private;
revoke all on function private.da_lookup_merchant(uuid, text) from public, anon, authenticated;
create function public.da_lookup_merchant(p_hub uuid, p_query text)
returns table (merchant_id uuid, code text, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return query select * from private.da_lookup_merchant(p_hub, p_query);
end $$;
revoke all on function public.da_lookup_merchant(uuid, text) from public, anon, authenticated;
grant execute on function public.da_lookup_merchant(uuid, text) to authenticated;

alter function public.da_match_payment(uuid, text) set schema private;
revoke all on function private.da_match_payment(uuid, text) from public, anon, authenticated;
create function public.da_match_payment(p_hub uuid, p_payment_ref text)
returns table (payment_id uuid, payment_no text, merchant_id uuid, merchant_name text, amount numeric, status text, payment_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', p_hub);
  return query select * from private.da_match_payment(p_hub, p_payment_ref);
end $$;
revoke all on function public.da_match_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.da_match_payment(uuid, text) to authenticated;
