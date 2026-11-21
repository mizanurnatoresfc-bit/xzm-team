-- Office export / print permissions (20261121000200_office_export_permissions): given to every role that already
-- sees office data, refused to others, and every export / print leaves one line in the audit log.
begin;
select tests.fixture();

select tests.ok((select count(*) = 2 from public.permissions where code in ('office.report.export', 'office.report.print')), 'the two office permissions exist');
select tests.ok(not exists (
  select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id and p.code in ('office.property.view', 'office.bill.view')
   where not exists (select 1 from public.role_permissions x join public.permissions q on q.id = x.permission_id
                      where x.role_id = rp.role_id and q.code = 'office.report.export')), 'every role that sees office data keeps export');

select tests.login(tests.id('hub_mgr'));
select public.office_log_export('residential-costs-2026-11', 'excel', 12, '{"month":"2026-11"}');
select public.office_log_export('office-places', 'print', 3);
select tests.throws($$select public.office_log_export('office-places', 'csv', 1)$$, 'only pdf, excel or print', '22023');
select tests.throws($$select public.office_log_export(' ', 'pdf', 1)$$, 'a list name is needed', '22023');
select tests.logout();

select tests.ok((select count(*) = 2 from public.audit_logs where module = 'office' and action in ('EXPORT', 'PRINT') and actor_id = tests.id('hub_mgr')),
  'each export and print is in the audit log, with who did it');
select tests.ok((select (new_data ->> 'rows')::int = 12 and new_data ->> 'format' = 'excel' from public.audit_logs
                  where module = 'office' and action = 'EXPORT' and record_id = 'residential-costs-2026-11'), 'the log says which list, how many rows and the format');

select tests.login(tests.id('hr'));
select tests.throws($$select public.office_log_export('office-places', 'excel', 1)$$, 'a role without office access may not export', '42501');
select tests.logout();

-- Super Admin takes export away from hub managers: printing still works, exporting does not.
delete from public.role_permissions where role_id = (select id from public.roles where code = 'hub_manager')
  and permission_id = (select id from public.permissions where code = 'office.report.export');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.office_log_export('office-places', 'pdf', 1)$$, 'export taken away: Excel / PDF refused', '42501');
select public.office_log_export('office-places', 'print', 1);
select tests.ok(true, 'print still allowed');
select tests.logout();

rollback;
