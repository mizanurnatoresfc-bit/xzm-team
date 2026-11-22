-- =====================================================================
--  তালিকার টুল: "ভিউ" (টেবিল / কার্ড / তালিকা) আর "চিহ্নিত" — রোল অনুযায়ী চালু / বন্ধ
--
--  Additive only — no table, column or existing permission is changed or removed:
--  * system.list_view.configure — may switch a list between table, cards and compact list.
--  * system.list_mark.edit      — may mark rows in a list (mark all, and the actions for marked rows).
--  * So that nobody loses what they can do today, both are given to every role. The Super Admin takes them
--    away per role in "রোল ও অনুমতি". (Print, Excel and PDF keep their own permissions.)
--  These only decide which buttons a list shows; what a list holds is still decided by row-level security.
--
--  Apply this BEFORE the website that reads these codes goes live — otherwise everyone but a Super Admin
--  would lose the view and mark buttons until it is applied.
--
--  Rollback: delete from public.role_permissions where permission_id in
--              (select id from public.permissions where code in ('system.list_view.configure', 'system.list_mark.edit'));
--            delete from public.permissions where code in ('system.list_view.configure', 'system.list_mark.edit');
-- =====================================================================

insert into public.permissions (code, module, resource, action, description) values
  ('system.list_view.configure', 'system', 'list_view', 'configure', 'Switch a list between table, card and compact list view'),
  ('system.list_mark.edit',      'system', 'list_mark', 'edit',      'Mark rows in a list (mark all, and actions for marked rows)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
 cross join public.permissions p
 where p.code in ('system.list_view.configure', 'system.list_mark.edit')
on conflict do nothing;
