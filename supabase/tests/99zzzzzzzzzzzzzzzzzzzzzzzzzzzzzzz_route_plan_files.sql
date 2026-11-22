-- রুট: পরিকল্পনার পিডিএফ — the numbers of an Update list and a Dispatch sheet, kept per hub and date.
begin;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('r1', tests.active_employee('Route Rider', '881', tests.id('hub_a1'), '01711000881', '8810000000')),
  ('r2', tests.active_employee('Second Rider', '882', tests.id('hub_a1'), '01711000882', '8820000000')),
  ('other', tests.active_employee('Other Hub Rider', '884', tests.id('hub_a2'), '01711000884', '8840000000'));

-- the hub manager uploads an update list and a dispatch sheet
select tests.login(tests.id('hub_mgr'));
select tests.ok((select f -> 'files' = '[]'::jsonb and (f ->> 'can_upload')::boolean and (f ->> 'unlisted')::int = 0 from public.route_plan_files(tests.id('hub_a1')) f), 'nothing uploaded yet');
insert into tests.ids select 'list', public.route_plan_file_save(tests.id('hub_a1'), current_date, jsonb_build_object(
  'kind', 'update_list', 'doc_no', '11544814', 'doc_date', current_date, 'hub_text', 'Hub A1', 'rider_code', '2019', 'rider_name', 'Mohon',
  'counts', '{"parcels": 3, "delivered": 2, "cod_total": 3100, "status:delivered": 2, "status:cancelled": 1}'::jsonb,
  'parcel_ids', '[320000001, 320000002, 320000003, 320000003]'::jsonb, 'warnings', '[]'::jsonb, 'file_name', 'list.pdf'));
insert into tests.ids select 'disp', public.route_plan_file_save(tests.id('hub_a1'), current_date, jsonb_build_object(
  'kind', 'dispatch', 'doc_no', '19222392', 'doc_date', current_date - 1, 'hub_text', 'Hub A1', 'from_text', 'Sorting', 'rider_code', '55',
  'counts', '{"pieces": 6, "parcels": 5, "for_hub": 4, "other_hub": 1, "cancelled": 1}'::jsonb,
  'parcel_ids', '[320000001, 320000002, 320000003, 320000004, 320000005]'::jsonb, 'warnings', '["cut"]'::jsonb));
select tests.ok((select cardinality(parcel_ids) = 3 and rider_code = '2019' and uploads = 1 and uploaded_by_name = 'Hub A1 Mgr' from public.route_day_files where id = tests.id('list'))
            and (select rider_code is null and warnings = array['cut'] and doc_date = current_date - 1 from public.route_day_files where id = tests.id('disp')),
  'both saved: parcel ids once each, a dispatch has no rider, the warning is kept');
select tests.ok((select jsonb_array_length(f -> 'files') = 2 and (f ->> 'unlisted')::int = 2
                    and (select x -> 'employee_id' = 'null'::jsonb and (x ->> 'parcels')::int = 3 and not (x ->> 'on_report')::boolean and (x -> 'counts' ->> 'delivered')::int = 2
                           from jsonb_array_elements(f -> 'files') x where x ->> 'kind' = 'update_list')
                   from public.route_plan_files(tests.id('hub_a1')) f),
  'the page gets both; the rider id is not matched yet; two dispatch parcels are on no list');

-- the same document again replaces its numbers
select tests.ok(public.route_plan_file_save(tests.id('hub_a1'), current_date, jsonb_build_object('kind', 'update_list', 'doc_no', '11544814', 'rider_code', '2019',
  'counts', '{"parcels": 4, "delivered": 4}'::jsonb, 'parcel_ids', '[320000001, 320000002, 320000003, 320000004]'::jsonb)) = tests.id('list'), 'uploading it again keeps the same row');
select tests.ok((select uploads = 2 and (counts ->> 'parcels')::int = 4 and cardinality(parcel_ids) = 4 from public.route_day_files where id = tests.id('list'))
            and (select (f ->> 'unlisted')::int = 1 from public.route_plan_files(tests.id('hub_a1')) f), 'with the new numbers; one parcel is left on no list');
select tests.ok(tests.row_count('select 1 from public.route_day_files') = 2, 'no second row');

-- what is refused
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "invoice", "doc_no": "12345678", "parcel_ids": [1]}')$$, tests.id('hub_a1')), 'an unknown kind', '22023');
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "dispatch", "doc_no": "12", "parcel_ids": [1]}')$$, tests.id('hub_a1')), 'a wrong document number', '22023');
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "dispatch", "doc_no": "12345678", "parcel_ids": []}')$$, tests.id('hub_a1')), 'a document without parcels', '22023');
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "dispatch", "doc_no": "12345678", "parcel_ids": ["x"]}')$$, tests.id('hub_a1')), 'a parcel id that is no number', '22023');
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "dispatch", "doc_no": "12345678", "parcel_ids": [1], "counts": {"parcels": "many"}}')$$, tests.id('hub_a1')), 'a count that is no number', '22023');
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "dispatch", "doc_no": "12345678", "parcel_ids": [1], "counts": {"Customer Name": 1}}')$$, tests.id('hub_a1')), 'a count with a free-text name', '22023');
select tests.throws(format($$select public.route_plan_file_save(%L, current_date + 2, '{"kind": "dispatch", "doc_no": "12345678", "parcel_ids": [1]}')$$, tests.id('hub_a1')), 'a date after tomorrow', '22023');
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "dispatch", "doc_no": "12345678", "parcel_ids": [1]}')$$, tests.id('hub_a2')), 'another hub', '42501');
select tests.throws($$insert into public.route_day_files (hub_id, zone_id, plan_date, kind, doc_no) select hub_id, zone_id, plan_date, kind, '99999999' from public.route_day_files limit 1$$, 'no direct insert', '42501');

-- matching the rider's panel id (the daily accounts' own table)
select tests.throws(format($$select public.route_plan_map_rider(%L, '2019', %L)$$, tests.id('hub_a1'), tests.id('other')), 'not to a person of another hub', '22023');
select tests.throws(format($$select public.route_plan_map_rider(%L, '7777', %L)$$, tests.id('hub_a1'), tests.id('r1')), 'not an id no uploaded list has', '22023');
select public.route_plan_map_rider(tests.id('hub_a1'), '2019', tests.id('r1'));
select tests.ok((select x ->> 'employee_id' = tests.id('r1')::text from jsonb_array_elements(public.route_plan_files(tests.id('hub_a1')) -> 'files') x where x ->> 'kind' = 'update_list'), 'matched: the list belongs to the rider');
select tests.ok((select employee_id = tests.id('r1') and mapped_by_name = 'Hub A1 Mgr' from public.da_import_rider_map where rider_code = '2019'), 'kept in the rider map of the daily accounts');
select public.route_plan_map_rider(tests.id('hub_a1'), '2019', tests.id('r2'));
select tests.ok((select employee_id = tests.id('r2') from public.da_import_rider_map where rider_code = '2019'), 'a wrong match can be corrected');

-- a list whose rider id equals an Employee ID needs no matching
select public.route_plan_file_save(tests.id('hub_a1'), current_date, jsonb_build_object('kind', 'update_list', 'doc_no', '11544815', 'rider_code', '881',
  'counts', '{"parcels": 1}'::jsonb, 'parcel_ids', '[320000009]'::jsonb));
select tests.ok((select x ->> 'employee_id' = tests.id('r1')::text from jsonb_array_elements(public.route_plan_files(tests.id('hub_a1')) -> 'files') x where x ->> 'doc_no' = '11544815'), 'an id that is the Employee ID matches by itself');

-- the zonal manager: another hub cannot take the same document; a date can change; removing needs a reason
select tests.login(tests.id('zonal_a'));
select tests.throws(format($$select public.route_plan_file_save(%L, current_date, '{"kind": "dispatch", "doc_no": "19222392", "parcel_ids": [1]}')$$, tests.id('hub_a2')), 'a document of one hub cannot be uploaded for another', '23505');
select public.route_plan_file_save(tests.id('hub_a1'), current_date - 1, jsonb_build_object('kind', 'dispatch', 'doc_no', '19222392', 'counts', '{"parcels": 5}'::jsonb, 'parcel_ids', '[320000001]'::jsonb));
select tests.ok((select plan_date = current_date - 1 from public.route_day_files where id = tests.id('disp'))
            and (select jsonb_array_length(f -> 'files') = 2 and (f ->> 'unlisted')::int = 0 from public.route_plan_files(tests.id('hub_a1')) f)
            and (select jsonb_array_length(f -> 'files') = 1 from public.route_plan_files(tests.id('hub_a1'), current_date - 1) f), 'uploaded for another date, the document moves there');
select tests.throws(format($$select public.route_plan_file_remove(%L, '')$$, tests.id('disp')), 'removing needs a reason', '22023');
select public.route_plan_file_remove(tests.id('disp'), 'wrong hub');
select tests.ok((select removed_at is not null from public.route_day_files where id = tests.id('disp'))
            and (select f -> 'files' = '[]'::jsonb from public.route_plan_files(tests.id('hub_a1'), current_date - 1) f), 'removed: kept in the table, gone from the page');
select tests.ok(public.route_plan_file_save(tests.id('hub_a2'), current_date, '{"kind": "dispatch", "doc_no": "19222392", "parcel_ids": [1]}') <> tests.id('disp'), 'once removed, the document can be uploaded where it belongs');
select tests.throws($$delete from public.route_day_files$$, 'no direct delete', '42501');

-- who else
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.route_plan_files(%L)$$, tests.id('hub_a1')), 'a manager of another zone sees nothing', '42501');
select tests.throws(format($$select public.route_plan_file_remove(%L, 'mine now')$$, tests.id('list')), 'and removes nothing', '42501');
select tests.ok(tests.row_count('select 1 from public.route_day_files') = 0, 'and reads no rows');
select tests.login_anon();
select tests.throws(format($$select public.route_plan_files(%L)$$, tests.id('hub_a1')), 'not signed in: nothing', '42501');
select 'done';
rollback;
