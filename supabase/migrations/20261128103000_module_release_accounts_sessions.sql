-- Resolve the stored hub before applying the release policy to a session-based RPC.
-- This helper is internal. The wrapped RPC still performs its own business authorization.
create function private.da_release_session_hub(p_session uuid)
returns uuid language plpgsql stable set search_path = '' as $$
declare v_hub uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select s.hub_id into v_hub
  from public.da_sessions s
  where s.id = p_session and private.has_permission('da.sheet.create', s.zone_id, s.hub_id);
  if v_hub is null then
    raise exception 'Daily account sheet unavailable.' using errcode = '42501';
  end if;

  return v_hub;
end $$;
revoke all on function private.da_release_session_hub(uuid) from public, anon, authenticated, service_role;

alter function public.da_bank_done(uuid, text) set schema private;
revoke all on function private.da_bank_done(uuid, text) from public, anon, authenticated, service_role;
create function public.da_bank_done(p_session uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', private.da_release_session_hub(p_session));
  perform private.da_bank_done(p_session, p_note);
end $$;
revoke all on function public.da_bank_done(uuid, text) from public, anon, authenticated;
grant execute on function public.da_bank_done(uuid, text) to authenticated;

alter function public.da_cell_set(uuid, text, uuid, text, text) set schema private;
revoke all on function private.da_cell_set(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
create function public.da_cell_set(p_session uuid, p_section text, p_row uuid, p_col text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', private.da_release_session_hub(p_session));
  perform private.da_cell_set(p_session, p_section, p_row, p_col, p_value);
end $$;
revoke all on function public.da_cell_set(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.da_cell_set(uuid, text, uuid, text, text) to authenticated;
