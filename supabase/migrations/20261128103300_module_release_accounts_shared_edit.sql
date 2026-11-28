-- Apply release policy to every Accounts writer that uses the existing sheet edit authorization.
create or replace function private.da_require_edit(p_session uuid) returns public.da_sessions
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.create', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to change daily accounts of this hub.' using errcode = '42501';
  end if;
  perform public.module_release_require('accounts', s.hub_id);
  if s.status = 'submitted' then
    raise exception 'This sheet has been submitted. Reopen it for correction first (needs correction permission).' using errcode = '42501';
  end if;
  if s.status = 'approved' then
    raise exception 'This sheet is approved and final. It cannot be changed.' using errcode = '42501';
  end if;
  update public.da_sessions set last_saved_at = now() where id = s.id;
  return s;
end $$;
