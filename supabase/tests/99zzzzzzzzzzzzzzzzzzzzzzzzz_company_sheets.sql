-- Company sheets: the company's own Excel layouts, filled from requests or staff records.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('a1', tests.active_employee('Hub A1 Rider', '801', tests.id('hub_a1'), '01711000801', '8010101010')),
  ('b1', tests.active_employee('Hub B1 Rider', '802', tests.id('hub_b1'), '01711000802', '8020202020'));

-- ---------- what the migration puts in ----------
select tests.ok((select count(*) = 3 from public.company_sheets), 'the three company sheets are there to start with');
select tests.ok((select source = 'staff' and kind is null and jsonb_array_length(columns) = 25 from public.company_sheets where name = 'New Admin & Rider ID Creat Information'),
  'ID create: 25 columns, filled from staff records');
select tests.ok((select source = 'requests' and kind = 'id_transfer' and jsonb_array_length(columns) = 11 from public.company_sheets where name = 'Admin & Rider ID Transfer Information'),
  'ID transfer: 11 columns, filled from transfer requests');
select tests.ok((select jsonb_array_length(columns) = 17 and title_at = '[4,7]'::jsonb
                    and (select count(*) = 6 from jsonb_array_elements(columns) c where c ? 'group')
                   from public.company_sheets where name = 'Transfer - 02 (with salary)'), 'transfer with salary: 17 columns, six under two grouped headings');
select tests.ok((select count(*) = 3 from public.hr_request_formats f, jsonb_array_elements(f.fields) x
                  where f.code = 'ID_TRANSFER' and x ->> 'key' in ('new_basic', 'new_bill', 'new_commission') and x ->> 'required' is null),
  'the transfer form gains three optional new-salary boxes');
select tests.ok((select count(*) = 1 from public.hr_request_formats f, jsonb_array_elements(f.fields) x where f.code = 'ID_TRANSFER' and x ->> 'key' = 'to_hub'),
  'and keeps what it had');

-- ---------- who may change a layout ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select count(*) = 3 from public.company_sheets), 'a hub manager sees the sheets');
select tests.throws($$insert into public.company_sheets (name, source, kind, columns) values ('Mine', 'requests', 'id_active', '[{"head":"SL","src":"sl"}]')$$,
  'but cannot add one', '42501');
update public.company_sheets set title = 'changed' where name = 'Admin & Rider ID Transfer Information';
select tests.ok((select title = 'Admin & Rider ID Transfer Format' from public.company_sheets where name = 'Admin & Rider ID Transfer Information'), 'nor change one');
select tests.logout();

select tests.login(tests.id('hr'));
insert into public.company_sheets (name, source, kind, title, columns) values
  ('ID active sheet', 'requests', 'id_active', 'ID Active Format',
   '[{"head":"SL","src":"sl"},{"head":"Name","src":"emp:full_name|req:full_name"},{"head":"Area","src":"fixed:Natore | North"},{"head":"Blood","src":"emp:cf:blood_group"},{"head":"Since","src":"req:effective_date|req.date"}]');
select tests.ok(exists (select 1 from public.company_sheets where name = 'ID active sheet' and created_by = tests.id('hr')), 'HR adds a new company sheet');
select tests.throws($$insert into public.company_sheets (name, source, kind, columns) values ('ID active sheet', 'requests', 'id_active', '[{"head":"SL","src":"sl"}]')$$,
  'two live sheets cannot share a name', '23505');
select tests.throws($$insert into public.company_sheets (name, source, kind, columns) values ('Bad1', 'requests', 'id_active', '[{"head":"","src":"sl"}]')$$,
  'a column needs a heading', '22023');
select tests.throws($$insert into public.company_sheets (name, source, kind, columns) values ('Bad2', 'requests', 'id_active', '[{"head":"X"}]')$$,
  'a column needs a source', '22023');
select tests.throws($$insert into public.company_sheets (name, source, kind, columns) values ('Bad3', 'requests', 'id_active', '[{"head":"X","src":"emp:full_name|drop table"}]')$$,
  'an unknown source is refused', '22023');
select tests.throws($$insert into public.company_sheets (name, source, columns) values ('Bad4', 'staff', '[{"head":"X","src":"req:reason"}]')$$,
  'a staff sheet cannot read a request', '22023');
select tests.throws($$insert into public.company_sheets (name, source, columns) values ('Bad5', 'requests', '[{"head":"X","src":"sl"}]')$$,
  'a request sheet must say which kind', '23514');
select tests.throws($$insert into public.company_sheets (name, source, kind, columns) values ('Bad6', 'requests', 'id_active', '[]')$$,
  'a sheet needs at least one column', '23514');
select tests.throws(format($$insert into public.company_sheets (name, source, kind, format_id, columns) values ('Bad7', 'requests', 'id_active', %L, '[{"head":"X","src":"sl"}]')$$,
  (select id from public.hr_request_formats where code = 'ID_TRANSFER')), 'the request format must be of the same kind', '22023');
-- the layout changes: same sheet, new columns
update public.company_sheets set columns = columns || '[{"head":"Remarks","src":"blank"}]'::jsonb where name = 'ID active sheet';
select tests.ok((select jsonb_array_length(columns) = 6 from public.company_sheets where name = 'ID active sheet'), 'a changed layout is saved on the same sheet');
do $$ begin delete from public.company_sheets where name = 'ID active sheet'; exception when others then null; end $$;
select tests.ok(exists (select 1 from public.company_sheets where name = 'ID active sheet'), 'a sheet is never hard-deleted');
update public.company_sheets set archived_at = now(), archive_reason = 'old layout' where name = 'ID active sheet';
select tests.ok((select archived_by = tests.id('hr') from public.company_sheets where name = 'ID active sheet'), 'removing keeps who removed it');
insert into public.company_sheets (name, source, kind, columns) values ('ID active sheet', 'requests', 'id_active', '[{"head":"SL","src":"sl"}]');
select tests.ok((select count(*) = 2 from public.company_sheets where name = 'ID active sheet'), 'the name is free again after removing');
select tests.logout();
select tests.ok(exists (select 1 from public.audit_logs where table_name = 'company_sheets' and action = 'UPDATE'), 'layout changes are in the audit log');

-- ---------- staff details for a sheet ----------
select tests.login(tests.id('hr'));
select tests.ok(public.hr_sheet_people('{}'::uuid[], array['full_name']) = '{}'::jsonb, 'no people, empty answer');
select tests.ok((public.hr_sheet_people(array[tests.id('a1'), tests.id('b1')], array['full_name', 'hub_name', 'nid_number', 'basic_salary', 'doc:photo'])
                   -> tests.id('a1')::text) @> '{"full_name":"Hub A1 Rider","hub_name":"Hub A1","nid_number":"8010101010"}'::jsonb,
  'HR gets name, hub and NID for the people asked for');
select tests.ok((select count(*) = 2 from jsonb_object_keys(public.hr_sheet_people(array[tests.id('a1'), tests.id('b1')], array['full_name'])) k), 'one entry per person');
select tests.ok((public.hr_sheet_people(array[tests.id('a1')], array['full_name', 'cf:no_such_box', 'salary_secret']) -> tests.id('a1')::text) = '{"full_name":"Hub A1 Rider"}'::jsonb,
  'a column that no longer exists is skipped, the rest still comes');
select tests.ok((public.hr_sheet_people(array[tests.id('a1')], array['doc:photo', 'full_name']) -> tests.id('a1')::text -> 'doc:photo') is null, 'no photo on file, no flag');
select tests.logout();
select tests.ok(exists (select 1 from public.audit_logs where action = 'export' and table_name = 'employees' and reason = 'Company sheet including private details'),
  'a sheet with private details is written to the audit log');

insert into public.employee_documents (employee_id, doc_type, storage_path, file_name, mime_type, size_bytes) values
  (tests.id('a1'), 'photo', 'employee/' || tests.id('a1') || '/p.jpg', 'p.jpg', 'image/jpeg', 100),
  (tests.id('a1'), 'nid_front', 'employee/' || tests.id('a1') || '/n.jpg', 'n.jpg', 'image/jpeg', 100);
select tests.login(tests.id('hr'));
select tests.ok((public.hr_sheet_people(array[tests.id('a1')], array['doc:photo', 'doc:nid_front', 'doc:nid_back']) -> tests.id('a1')::text) = '{"doc:photo":true,"doc:nid_front":true}'::jsonb,
  'papers on file are flagged, missing ones are not');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.ok((public.hr_sheet_people(array[tests.id('a1'), tests.id('b1')], array['full_name', 'nid_number', 'doc:nid_front']) ? tests.id('b1')::text) is false,
  'a hub manager gets nobody from another hub');
select tests.ok((public.hr_sheet_people(array[tests.id('a1')], array['full_name', 'nid_number', 'doc:nid_front']) -> tests.id('a1')::text) = '{"full_name":"Hub A1 Rider"}'::jsonb,
  'and no NID or NID picture flag for own staff');
select tests.throws($$select public.hr_sheet_people((select array_agg(gen_random_uuid()) from generate_series(1, 5001)), array['full_name'])$$, 'more than 5000 people is refused', '22023');
select tests.logout();

select tests.login_anon();
select tests.throws($$select public.hr_sheet_people(array[gen_random_uuid()], array['full_name'])$$, 'a visitor cannot ask', '42501');
select tests.throws($$select count(*) from public.company_sheets$$, 'nor read the layouts', '42501');
select tests.logout();
rollback;
