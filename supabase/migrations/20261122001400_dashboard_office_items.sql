-- =====================================================================
--  হোম ড্যাশবোর্ড: "অফিসের জিনিসপত্র" প্যানেল (ভালো / নষ্ট / লাগবে)
--
--  Additive only — no table, column or permission is changed or removed:
--  * New dashboard panel code office_items. A role may see it when it has office.asset.view
--    (Super Admin always may). Which roles get it is set by the Super Admin in "রোল অনুযায়ী ড্যাশবোর্ড".
--  * The Super Admin role's saved home layout gets the panel (right after "আজ আমার হাব" when that is there).
--    Other roles' layouts are left as they are.
--  * The buttons inside the panel follow the permissions that already exist:
--      আপডেট            -> office.asset.edit
--      নষ্ট / লাগবে জানান -> office.notice.create
--      প্রিন্ট            -> office.report.print      PDF -> office.report.export
--    The numbers and the printed list come from office_assets / office_notices under their own row-level security.
--
--  Rollback: re-run private.dashboard_catalogue() from 20261115000700_dashboard_views.sql and
--            private.dashboard_screen_order() from 20261116000500_dashboard_order.sql, then
--            update public.role_dashboards set panels = panels - 'office_items' where panels ? 'office_items';
-- =====================================================================

create or replace function private.dashboard_catalogue()
returns table (panel text, needs text[])
language sql immutable set search_path = '' as $$
  values
    ('my_work',        array[]::text[]),
    ('hr_overview',    array['hr.employee.view']),
    ('hr_pending',     array['hr.application.view','hr.leave.approve','hr.compensation.approve','hr.document.verify']),
    ('hub_staff',      array['hr.employee.view']),
    ('ops_today',      array['ops.report.view','ops.parcel.view','ops.pickup.view','ops.delivery.view']),
    ('cash_today',     array['ops.cash.view','ops.rider_handover.approve','ops.expense.approve','ops.reconciliation.view']),
    ('accounts_today', array['da.sheet.view','da.report.view']),
    ('zonal_overview', array['zonal.dashboard.view','zonal.report.view']),
    ('quick_links',    array[]::text[]),
    ('my_day',         array[]::text[]),
    ('my_requests',    array[]::text[]),
    ('hub_today',      array['hr.attendance.view','hr.employee.view','da.sheet.view','ops.pickup.view']),
    ('approvals',      array['hr.application.approve','hr.leave.approve','da.sheet.approve','hr.request.approve']),
    ('network',        array['org.hub.view']),
    ('office_items',   array['office.asset.view'])
$$;

create or replace function private.dashboard_screen_order() returns text[]
language sql immutable set search_path = '' as $$
  select array['my_day','hub_today','office_items','network','approvals','my_requests','my_work','hr_overview','hr_pending',
               'hub_staff','ops_today','cash_today','accounts_today','zonal_overview','quick_links']
$$;

-- Super Admin's saved layout gets the panel. An empty layout already follows the permissions, so it is left alone.
update public.role_dashboards rd
   set panels = (select jsonb_agg(z.p order by z.o)
                   from (select x.p, x.o::numeric as o from jsonb_array_elements_text(rd.panels) with ordinality x(p, o)
                         union all
                         select 'office_items',
                                coalesce((select y.o + 0.5 from jsonb_array_elements_text(rd.panels) with ordinality y(p, o) where y.p = 'hub_today'), 1000)) z)
  from public.roles r
 where r.id = rd.role_id and r.code::text = 'super_admin'
   and jsonb_array_length(rd.panels) between 1 and 19
   and not rd.panels ? 'office_items';
