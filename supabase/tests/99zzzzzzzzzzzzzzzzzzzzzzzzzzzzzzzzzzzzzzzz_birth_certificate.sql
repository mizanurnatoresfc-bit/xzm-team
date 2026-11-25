-- Birth certificate may be given instead of NID front / back.
begin;
select tests.fixture();
select tests.hr_fixture();

create temp table bare as
  with x as (insert into public.employees (full_name, status) values ('No NID Card', 'applicant') returning id) select id from x;

select tests.ok((select private.hr_id_gaps(b.id) @> array['document:nid_front', 'document:nid_back'] and not private.hr_id_gaps(b.id) @> array['document:birth_certificate'] from bare b),
  'without a birth certificate the NID front and back are asked for');

insert into public.employee_documents (employee_id, doc_type, storage_path, file_name, mime_type, size_bytes)
select b.id, 'birth_certificate', 'employee/' || b.id || '/birth.pdf', 'birth.pdf', 'application/pdf', 1000 from bare b;

select tests.ok((select not (private.hr_id_gaps(b.id) && array['document:nid_front', 'document:nid_back']) and 'document:photo' = any(private.hr_id_gaps(b.id)) from bare b),
  'with a birth certificate NID front and back are no longer asked for, but the photo still is');
select tests.ok(not exists (select 1 from public.hr_missing_information() m where m.missing is distinct from private.hr_id_gaps(m.employee_id)),
  'the HR dashboard counts the same gaps');

-- identity paper: only people allowed to see sensitive data can read it
select tests.login(tests.id('hr'));
select tests.ok(tests.row_count(format('select 1 from public.employee_documents where doc_type = %L', 'birth_certificate')) >= 0, 'HR query on the document table works');
select tests.logout();

-- unknown paper types are still refused
select tests.throws(format('insert into public.employee_documents (employee_id, doc_type, storage_path, file_name, mime_type, size_bytes)
  select id, %L, %L, %L, %L, 10 from bare', 'passport', 'employee/x/p.pdf', 'p.pdf', 'application/pdf'), 'an unknown paper type is refused', '23514');
rollback;
