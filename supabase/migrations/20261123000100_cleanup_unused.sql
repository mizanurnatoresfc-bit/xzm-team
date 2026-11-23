-- Cleanup (owner, 23 Nov 2026): objects that nothing uses any more — not the app, not an Edge Function,
-- not a scheduled job, trigger, policy or check, and not any function that is still in use.
-- Checked against the code and the database on 23 Nov 2026. The three tables were empty.
-- Every dropped function's full definition and every dropped table's columns are kept in
-- private.dropped_objects_backup, so anything here can be put back.
--
-- Kept on purpose: the salary sheet (hr_*salary*, compensation), vehicle documents (vehicle_document_*,
-- vehicle_alerts, vehicle_overview), road_path_ok (a check on hub_routes), bootstrap_super_admin, system_timezone_ok.

create table if not exists private.dropped_objects_backup (
  id bigint generated always as identity primary key,
  kind text not null,
  name text not null,
  definition text not null,
  dropped_at timestamptz not null default now()
);
revoke all on private.dropped_objects_backup from public, anon, authenticated;

do $$
declare
  fns text[] := array[
    -- old parcel / cash engine, replaced by the daily accounts sheet
    'public.ops_assign','public.ops_assign_issue','public.ops_cancel_handover','public.ops_cancel_parcel','public.ops_cash_position',
    'public.ops_cod_reconciliation','public.ops_comment_issue','public.ops_confirm_handover','public.ops_daily_report','public.ops_decide_delivery',
    'public.ops_decide_expense','public.ops_decide_merchant_payment','public.ops_decide_reconciliation','public.ops_dispatch_parcels',
    'public.ops_end_assignment','public.ops_hub_staff','public.ops_hub_summary','public.ops_open_issue','public.ops_parcel_lookup',
    'public.ops_pickup_groups','public.ops_record_cash_collection','public.ops_record_delivery','public.ops_record_expense',
    'public.ops_reopen_issue','public.ops_request_merchant_payment','public.ops_resolve_issue','public.ops_rider_ledger',
    'public.ops_submit_hub_handover','public.ops_submit_reconciliation','public.ops_submit_rider_handover','public.ops_void_pickup',
    'private.hub_cash_movements','private.hub_cash_position','private.merchant_payable','private.rider_cash_balance',
    -- old vehicle pages, replaced by /app/fleet
    'public.vehicle_day_list','public.vehicle_history','public.vehicle_log_list','public.vehicle_log_remove','public.vehicle_log_to_sheet',
    'public.vehicle_pending','public.vehicle_report','public.vehicle_request_list','public.vehicle_requisition_list',
    'public.vehicle_requisition_submit','public.vehicle_requisition_update','public.vehicle_set_hubs',
    'private.vehicle_helper','private.vehicle_notify_crew','private.vehicle_req_can_decide',
    -- accounts functions no page calls any more
    'public.da_approval_rule_save','public.da_cash_payment_remove','public.da_cash_payment_save','public.da_expense_approve',
    'public.da_expense_set_extra','public.da_hub_rider_sheet','public.da_my_rider_lines','public.da_payee_save','public.da_pending_approvals',
    'public.da_reconcile','public.da_reference_save','public.da_report_text','public.da_request_expense','public.da_suggest_category',
    -- zonal reports no page calls
    'public.zm_log_export','public.zm_report_employees','public.zm_report_operations','public.zm_report_workforce','public.zm_visit_report',
    -- small helpers nothing calls
    'private.can_see_issue','private.employee_label'];
  tbls text[] := array['public.parcel_issue_events','public.vehicle_requisition_events','public.da_payees'];
  f text; r record; t text; n int := 0;
begin
  foreach f in array fns loop
    for r in select p.oid, p.oid::regprocedure::text sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = split_part(f, '.', 1) and p.proname = split_part(f, '.', 2) loop
      insert into private.dropped_objects_backup(kind, name, definition) values ('function', r.sig, pg_get_functiondef(r.oid));
      execute format('drop function %s', r.sig);
      n := n + 1;
    end loop;
  end loop;
  foreach t in array tbls loop
    if to_regclass(t) is null then continue; end if;
    execute format('select count(*) from %s', t) into n;
    if n > 0 then raise exception 'table % has % rows — not dropping', t, n; end if;
    insert into private.dropped_objects_backup(kind, name, definition)
    select 'table', t, jsonb_pretty(jsonb_build_object(
      'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
                    'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
                  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = t::regclass and a.attnum > 0 and not a.attisdropped),
      'constraints', (select jsonb_agg(conname || ': ' || pg_get_constraintdef(oid)) from pg_constraint where conrelid = t::regclass)));
  end loop;
  -- da_cash_payments keeps its payee_id column (it is empty); only the link to the dropped payee list goes
  alter table public.da_cash_payments drop constraint if exists da_cash_payments_payee_id_fkey;
  foreach t in array tbls loop
    execute format('drop table if exists %s', t);
  end loop;
end $$;

-- Role page lists: two pages that were taken off the menu (they do the same job as another page)
update public.role_dashboards
   set menu = menu - '/app/hub/accounts' - '/app/hub/days'
 where menu ?| array['/app/hub/accounts', '/app/hub/days'];
