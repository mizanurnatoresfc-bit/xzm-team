-- Carry the Accounts release policy into read tracking and the approval/correction workflow.
-- Each RPC retains its existing authorization and resolves the hub from the stored sheet.
create or replace function public.da_reopen(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.correction.edit', s.zone_id, s.hub_id) then
    raise exception 'Changing a submitted sheet needs the correction permission.' using errcode = '42501';
  end if;
  perform public.module_release_require('accounts', s.hub_id);
  if s.status <> 'submitted' then raise exception 'Only a submitted sheet that is not yet approved can be reopened.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required.' using errcode = '22023'; end if;
  update public.da_sessions set status = 'correction' where id = s.id;
  perform private.da_event(s.id, 'reopened', p_reason, false);
end $$;

create or replace function public.da_verify(p_session uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions;
begin
  select * into s from public.da_sessions where id = p_session for update;
  if s.id is null then raise exception 'Daily account sheet not found.' using errcode = 'P0002'; end if;
  if not private.has_permission('da.sheet.approve', s.zone_id, s.hub_id) then
    raise exception 'Not authorised to verify daily accounts of this hub.' using errcode = '42501';
  end if;
  perform public.module_release_require('accounts', s.hub_id);
  if coalesce(private.setting_text('da.require_assignment'), 'false') = 'true' and not private.is_super_admin()
     and exists (select 1 from public.da_hub_accountants where hub_id = s.hub_id and revoked_at is null)
     and not exists (select 1 from public.da_hub_accountants where hub_id = s.hub_id and revoked_at is null and user_id = auth.uid()) then
    raise exception 'Only the Accounts Manager assigned to this hub can verify its sheets.' using errcode = '42501';
  end if;
  if auth.uid() in (s.started_by, s.submitted_by) then
    raise exception 'The person who started or submitted a sheet cannot verify it.' using errcode = '42501';
  end if;
  if s.status <> 'submitted' then raise exception 'Only a submitted sheet can be verified.' using errcode = '22023'; end if;
  if p_action not in ('approve','correction','note') then raise exception 'Action must be approve, correction or note.' using errcode = '22023'; end if;
  if p_action in ('correction','note') and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Write what needs to be corrected or noted.' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    update public.da_sessions set status = 'approved', verified_by = auth.uid(), verified_by_name = private.da_my_name(),
           verified_at = now(), verify_note = nullif(trim(p_note), '') where id = s.id;
    perform private.da_event(s.id, 'approved', p_note, true);
  elsif p_action = 'correction' then
    update public.da_sessions set status = 'correction', verify_note = p_note where id = s.id;
    perform private.da_event(s.id, 'correction_required', p_note, false);
  else
    update public.da_sessions set verify_note = p_note where id = s.id;
    perform private.da_event(s.id, 'note', p_note, false);
  end if;
end $$;

create or replace function public.da_page_enter(p_session uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.da_sessions := private.da_session_row(p_session); v uuid;
begin
  if s.id is null or not (private.has_permission('da.sheet.view', s.zone_id, s.hub_id)
                          or private.has_permission('da.sheet.create', s.zone_id, s.hub_id)
                          or auth.uid() in (s.started_by, s.submitted_by)
                          or exists (select 1 from public.da_rider_lines l where l.session_id = s.id and l.removed_at is null
                                     and l.employee_id = private.my_employee_id())) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  perform public.module_release_require('accounts', s.hub_id);
  if coalesce(private.setting_text('da.session_tracking'), 'true') <> 'true' then return null; end if;
  insert into public.da_page_visits (session_id, user_id, user_name) values (p_session, auth.uid(), private.da_my_name())
  returning id into v;
  return v;
end $$;
