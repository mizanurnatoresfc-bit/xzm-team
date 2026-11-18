-- Route dispatch (পাঠাচ্ছি): a rider on a route sends parcels and items to another hub or the sorting centre;
-- the receiving manager sees them under "incoming" and confirms or objects.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into tests.ids values
  ('rider', tests.active_employee('Route Rider', '910', tests.id('hub_a1'), '01711000910', '9100000000', 12000, tests.id('rider_login'))),
  ('recv_mgr', tests.make_user('recv.a2@test.local', 'Receiving Mgr'));
select tests.grant_role(tests.id('recv_mgr'), 'hub_manager', 'hub', null, tests.id('hub_a2'));
insert into public.sorting_centers (code, name, zone_id) values ('SCD', 'Dispatch Center', tests.id('zone_a'));
insert into public.hub_routes (hub_id, zone_id, code, name) values (tests.id('hub_a1'), tests.id('zone_a'), 'R1', 'Lalpur'), (tests.id('hub_a1'), tests.id('zone_a'), 'R2', 'Singra');
insert into public.rider_routes (route_id, employee_id, hub_id, zone_id)
  select id, tests.id('rider'), tests.id('hub_a1'), tests.id('zone_a') from public.hub_routes where code = 'R1';
insert into public.office_properties (code, name, kind, zone_id, hub_id) values ('OFA1', 'A1 Office', 'office', tests.id('zone_a'), tests.id('hub_a1'));
insert into public.office_assets (property_id, kind, name, quantity) select id, 'other', 'Label Printer', 2 from public.office_properties where code = 'OFA1';

insert into t select 'r1', id::text from public.hub_routes where code = 'R1';
insert into t select 'r2', id::text from public.hub_routes where code = 'R2';
insert into t select 'sc', id::text from public.sorting_centers where code = 'SCD';
insert into t select 'asset', id::text from public.office_assets where name = 'Label Printer';

-- ---------- what the rider may choose from ----------
select tests.login(tests.id('rider_login'));
select tests.ok((select jsonb_array_length(public.dispatch_context() -> 'routes') = 1 and (public.dispatch_context() -> 'routes' -> 0 ->> 'name') = 'Lalpur'), 'a rider sees only the route they are on');
select tests.ok(jsonb_array_length(public.dispatch_context() -> 'hubs') = 1 and jsonb_array_length(public.dispatch_context() -> 'centers') = 1, 'the other hub of the zone and its sorting centre are the destinations');
select tests.ok(jsonb_array_length(public.dispatch_context() -> 'assets') = 1 and jsonb_array_length(public.dispatch_context() -> 'sorting_items') >= 1, 'the hub''s office items and the sorting-item list are offered');

-- ---------- sending ----------
select tests.throws(format($$select public.dispatch_send(%L, 'hub', %L, 0, null, '[]', null)$$, (select v::uuid from t where k = 'r1'), tests.id('hub_a2')),
  'nothing to send is refused', '22023');
select tests.throws(format($$select public.dispatch_send(%L, 'hub', %L, 5, null, '[]', null)$$, (select v::uuid from t where k = 'r2'), tests.id('hub_a2')),
  'a route the rider is not on is refused', '42501');
select tests.throws(format($$select public.dispatch_send(%L, 'hub', %L, 5, null, '[]', null)$$, (select v::uuid from t where k = 'r1'), tests.id('hub_b1')),
  'a hub of another zone is refused', '22023');
select tests.throws(format($$select public.dispatch_send(%L, 'hub', %L, 5, null, '[{"kind":"sorting_item","name":"পলি ব্যাগ","qty":3}]', null)$$, (select v::uuid from t where k = 'r1'), tests.id('hub_a2')),
  'a sorting-list item cannot go to a hub', '22023');
select tests.throws(format($$select public.dispatch_send(%L, 'sorting', %L, 5, null, '[{"kind":"sorting_item","name":"রকেট","qty":1}]', null)$$, (select v::uuid from t where k = 'r1'), (select v::uuid from t where k = 'sc')),
  'an item that is not in the sorting list is refused', '22023');
insert into t values ('d1', public.dispatch_send((select v::uuid from t where k = 'r1'), 'hub', tests.id('hub_a2'), 20, 2,
  format('[{"kind":"asset","asset_id":"%s","qty":1}]', (select v::uuid from t where k = 'asset'))::jsonb, 'Lalpur থেকে')::text);
insert into t values ('d2', public.dispatch_send((select v::uuid from t where k = 'r1'), 'sorting', (select v::uuid from t where k = 'sc'), 0, null,
  '[{"kind":"sorting_item","name":"পলি ব্যাগ","qty":50}]', null)::text);
select tests.ok(jsonb_array_length(public.dispatch_list('mine')) = 2 and (public.dispatch_list('mine') -> 0 ->> 'status') = 'sent', 'the rider sees both of their sends, waiting');
select tests.throws(format($$select public.dispatch_receive(%L, true, 20, null)$$, (select v from t where k = 'd1')), 'the sender cannot receive their own', '42501');
select tests.ok(jsonb_array_length(public.dispatch_list('incoming')) = 0, 'a rider has nothing incoming');

-- ---------- receiving ----------
select tests.login(tests.id('recv_mgr'));
select tests.ok(jsonb_array_length(public.dispatch_list('incoming')) = 1 and (public.dispatch_list('incoming') -> 0 ->> 'parcels') = '20' and (public.dispatch_list('incoming') -> 0 -> 'items' -> 0 ->> 'name') = 'Label Printer',
  'the receiving hub manager sees what is coming, with the items');
select tests.ok(jsonb_array_length(public.dispatch_list('incoming')) = 1, 'the sorting-centre send is not theirs to see');
select tests.throws(format($$select public.dispatch_receive(%L, true, 18, null)$$, (select v from t where k = 'd1')), 'a different count needs a reason', '22023');
select tests.throws(format($$select public.dispatch_receive(%L, false, 18, null)$$, (select v from t where k = 'd1')), 'an objection needs a reason', '22023');
select public.dispatch_receive((select v::uuid from t where k = 'd1'), true, 20, null);
select tests.ok((public.dispatch_list('incoming') -> 0 ->> 'status') = 'received', 'received');
select tests.throws(format($$select public.dispatch_receive(%L, true, 20, null)$$, (select v from t where k = 'd1')), 'it cannot be received twice', '22023');

-- ---------- who else ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok(jsonb_array_length(public.dispatch_list('mine')) = 2, 'the sending hub''s manager sees what their hub sent');
select tests.throws(format($$select public.dispatch_receive(%L, true, 0, null)$$, (select v from t where k = 'd2')), 'a hub manager cannot receive at the sorting centre', '42501');
select tests.login(tests.id('zonal_a'));
select public.dispatch_receive((select v::uuid from t where k = 'd2'), false, null, 'ব্যাগ কম ছিল');
select tests.ok((select x ->> 'status' = 'disputed' and x ->> 'receive_note' = 'ব্যাগ কম ছিল' from jsonb_array_elements(public.dispatch_list('incoming')) x where (x ->> 'to_kind') = 'sorting' limit 1), 'the zonal manager (sorting side) raises an objection');
select tests.login(tests.id('noroles'));
select tests.throws($$select public.dispatch_context()$$, 'a login with no staff profile cannot send', '42501');
select tests.ok(jsonb_array_length(public.dispatch_list('incoming')) = 0 and jsonb_array_length(public.dispatch_list('mine')) = 0, 'a stranger sees nothing');
select tests.login_anon();
select tests.throws($$select public.dispatch_list('mine')$$, 'the public cannot call it', '42501');
select tests.logout();
select tests.ok(exists (select 1 from pg_trigger where tgname = 'route_dispatches_no_delete') and exists (select 1 from pg_trigger where tgname = 'route_dispatch_items_no_delete'), 'a dispatch is never deleted');
rollback;
