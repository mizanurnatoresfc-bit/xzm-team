-- Priority 01 follow-up: extend the Release Guard pattern (same shape as 20261128062647)
-- to four additional user-facing RPCs that have zero internal callers in the migration tree.
-- Each wrapper keeps the original validation, permissions and resource checks inside the
-- private implementation, and layers `module_release_require(module, hub)` on top so a
-- published module behaves exactly as before and a disabled/testing-scoped one is blocked
-- server-side the same way the eight Codex-guarded RPCs are.
--
-- Guarded here:
--   fleet_board(uuid)                   → module 'fleet'
--   fleet_waiting(uuid)                 → module 'fleet'
--   att_sheet_save(uuid, date, jsonb)   → module 'attendance'
--   hub_feed(uuid, timestamptz, integer)→ module 'hub'
--
-- Candidates deliberately NOT guarded in this pass:
--   * RPCs with internal callers in the migration tree (schema move would route internal
--     traffic through the guard — fine when the module is legacy_live, but a config flip
--     would silently break cross-RPC calls);
--   * RPCs that return TABLE (wrapper needs RETURN QUERY and a careful column list match);
--   * RPCs with no stable hub argument (session-id RPCs — guard needs a hub lookup first).
-- These are the next batch for the ChatGPT Backend Team Contract report pattern.

alter function public.fleet_board(uuid) set schema private;
revoke all on function private.fleet_board(uuid) from public, anon, authenticated;
create function public.fleet_board(p_hub uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('fleet', p_hub);
  return private.fleet_board(p_hub);
end $$;
revoke all on function public.fleet_board(uuid) from public, anon, authenticated;
grant execute on function public.fleet_board(uuid) to authenticated;

alter function public.fleet_waiting(uuid) set schema private;
revoke all on function private.fleet_waiting(uuid) from public, anon, authenticated;
create function public.fleet_waiting(p_hub uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('fleet', p_hub);
  return private.fleet_waiting(p_hub);
end $$;
revoke all on function public.fleet_waiting(uuid) from public, anon, authenticated;
grant execute on function public.fleet_waiting(uuid) to authenticated;

alter function public.att_sheet_save(uuid, date, jsonb) set schema private;
revoke all on function private.att_sheet_save(uuid, date, jsonb) from public, anon, authenticated;
create function public.att_sheet_save(p_hub uuid, p_date date, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('attendance', p_hub);
  return private.att_sheet_save(p_hub, p_date, p_lines);
end $$;
revoke all on function public.att_sheet_save(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.att_sheet_save(uuid, date, jsonb) to authenticated;

alter function public.hub_feed(uuid, timestamptz, integer) set schema private;
revoke all on function private.hub_feed(uuid, timestamptz, integer) from public, anon, authenticated;
create function public.hub_feed(p_hub uuid, p_before timestamptz default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.module_release_require('hub', p_hub);
  return private.hub_feed(p_hub, p_before, p_limit);
end $$;
revoke all on function public.hub_feed(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.hub_feed(uuid, timestamptz, integer) to authenticated;
