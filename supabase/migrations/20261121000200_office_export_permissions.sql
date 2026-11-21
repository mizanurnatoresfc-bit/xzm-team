-- =====================================================================
--  অফিস / আবাসিক: Export ও Print আলাদা অনুমতি, আর প্রতিটি Export / Print অডিট লগে (Phase 5).
--
--  Additive only — no table, column or row is changed or removed:
--  * office.report.export (Excel / PDF) and office.report.print — Super Admin can now turn them on or off per role
--    in "রোল ও অনুমতি", like zonal.report.export / zonal.report.print.
--  * So that nobody loses what they can do today, both are given to every role that already sees
--    office places or bills (office.property.view / office.bill.view). Super Admin takes them away where wanted.
--  * office_log_export(): the office pages call it before an export / print; it checks the permission in the
--    database and writes one EXPORT / PRINT line to audit_logs (module office) with the list name and row count.
--    What the list holds is still decided by row-level security on the office tables.
--
--  Rollback: drop function public.office_log_export(text, text, integer, jsonb);
--            delete from role_permissions / permissions where code in ('office.report.export', 'office.report.print')
--            (only if wanted — leaving them does no harm).
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('office.report.export', 'office', 'report', 'export', 'Export office / residential lists and reports to Excel or PDF'),
  ('office.report.print',  'office', 'report', 'print',  'Print office / residential lists and reports')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select distinct rp.role_id, np.id
  from public.role_permissions rp
  join public.permissions op on op.id = rp.permission_id and op.code in ('office.property.view', 'office.bill.view')
  cross join public.permissions np
 where np.code in ('office.report.export', 'office.report.print')
on conflict do nothing;

create or replace function public.office_log_export(p_report text, p_format text, p_rows integer default null, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_perm text;
begin
  if p_format is null or p_format not in ('pdf', 'excel', 'print') then
    raise exception 'Format must be pdf, excel or print.' using errcode = '22023';
  end if;
  if coalesce(trim(p_report), '') = '' then raise exception 'Report name is required.' using errcode = '22023'; end if;
  v_perm := case when p_format = 'print' then 'office.report.print' else 'office.report.export' end;
  if not exists (select 1 from private.my_grants() g where g.permission_code = v_perm or (g.is_super and g.scope_type = 'global')) then
    raise exception 'এই তালিকা % করার অনুমতি আপনার নেই', case when p_format = 'print' then 'প্রিন্ট' else 'এক্সপোর্ট' end using errcode = '42501';
  end if;
  perform private.write_audit(case when p_format = 'print' then 'PRINT' else 'EXPORT' end, 'office', 'report', left(trim(p_report), 200),
                              null, jsonb_build_object('format', p_format, 'rows', p_rows, 'filters', coalesce(p_filters, '{}'::jsonb)), null);
end $$;
revoke all on function public.office_log_export(text, text, integer, jsonb) from public, anon;
grant execute on function public.office_log_export(text, text, integer, jsonb) to authenticated;
