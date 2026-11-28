-- Guard session-based report IDs and bank deposits while retaining the original workflow.
alter function public.da_report_save(uuid, text, numeric, text, uuid) set schema private;
revoke all on function private.da_report_save(uuid, text, numeric, text, uuid) from public, anon, authenticated, service_role;
create function public.da_report_save(
  p_session uuid, p_report_no text, p_amount numeric, p_remarks text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', private.da_release_session_hub(p_session));
  return private.da_report_save(p_session, p_report_no, p_amount, p_remarks, p_id);
end $$;
revoke all on function public.da_report_save(uuid, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.da_report_save(uuid, text, numeric, text, uuid) to authenticated;

alter function public.da_deposit_save(uuid, numeric, text, text, text, text, date, numeric, numeric, text, text, uuid) set schema private;
revoke all on function private.da_deposit_save(uuid, numeric, text, text, text, text, date, numeric, numeric, text, text, uuid)
  from public, anon, authenticated, service_role;
create function public.da_deposit_save(
  p_session uuid, p_amount numeric, p_method text default 'bank', p_bank text default null, p_ref text default null,
  p_slip text default null, p_date date default null, p_transport numeric default null, p_charge numeric default null,
  p_people text default null, p_remarks text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform public.module_release_require('accounts', private.da_release_session_hub(p_session));
  return private.da_deposit_save(p_session, p_amount, p_method, p_bank, p_ref, p_slip, p_date, p_transport,
    p_charge, p_people, p_remarks, p_id);
end $$;
revoke all on function public.da_deposit_save(uuid, numeric, text, text, text, text, date, numeric, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.da_deposit_save(uuid, numeric, text, text, text, text, date, numeric, numeric, text, text, uuid)
  to authenticated;
