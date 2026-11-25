-- =====================================================================
--  তালিকার টুলবার: ফিল্টার, ভিউ, চিহ্নিত, প্রিন্ট, Excel, PDF — রোল অনুযায়ী একসাথে দেখানো / লুকানো
--
--  Additive only — no table, column or existing permission is changed or removed:
--  * system.list_tools.view — the tool row above every list (filter, view, mark, print, Excel, PDF) is shown.
--    Without it the list keeps its count and search box but no tool buttons. It is a layer on top of
--    system.list_view.configure, system.list_mark.edit and the page's own print / export permissions:
--    those still decide which buttons exist inside the row.
--  * So that nobody loses what they can do today, it is given to every role. The Super Admin takes it
--    away per role in "রোল ও অনুমতি". It only decides which buttons a list shows; what a list holds is
--    still decided by row-level security.
--
--  Apply this BEFORE the website that reads this code goes live — otherwise everyone but a Super Admin
--  would lose the tool row until it is applied.
--
--  Rollback: delete from public.role_permissions where permission_id in
--              (select id from public.permissions where code = 'system.list_tools.view');
--            delete from public.permissions where code = 'system.list_tools.view';
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('system.list_tools.view', 'system', 'list_tools', 'view', 'Show the tool row above lists (filter, view, mark, print, Excel, PDF)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
 cross join public.permissions p
 where p.code = 'system.list_tools.view'
on conflict do nothing;
