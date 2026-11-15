-- Store / IT orders: an order is an issue of kind 'store' or 'it' that goes to the in-charge,
-- who may be posted at another hub; they send it, the person who ordered confirms it arrived.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into tests.ids values
  ('mgr',   tests.active_employee('Order Manager', '810', tests.id('hub_a1'), '01711000810', '8100000000', 15000, tests.id('hub_mgr'))),
  ('store', tests.active_employee('Store Keeper', '811', tests.id('hub_a2'), '01711000811', '8110000000', 15000, tests.id('rider_login'))),
  ('other', tests.active_employee('Other Person', '812', tests.id('hub_a1'), '01711000812', '8120000000'));

-- ---------- before anyone is in charge ----------
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.issue_create(%L, null, null, 'store')$$, tests.id('hub_a1')),
  'an order with nothing written is refused', '22023');
insert into t values ('o1', public.issue_create(tests.id('hub_a1'), null, 'পলি ব্যাগ ২০০, টেপ ১০', 'store')::text);
select tests.ok((select kind = 'store' and assignee_id is null and title = 'স্টোর অর্ডার' and body = 'পলি ব্যাগ ২০০, টেপ ১০'
                 from public.issues where id = (select v::uuid from t where k = 'o1')),
  'with nobody in charge the order is saved, unassigned, with a default title');
select tests.ok((public.issue_order_incharge() -> 'store') = 'null'::jsonb and (public.issue_order_incharge() -> 'it') = 'null'::jsonb,
  'nobody is in charge yet');

-- ---------- who may choose the in-charge ----------
select tests.throws(format($$select public.issue_order_incharge_set('store', %L)$$, tests.id('store')),
  'a hub manager cannot choose the in-charge', '42501');
select tests.login(tests.id('super'));
select tests.throws(format($$select public.issue_order_incharge_set('food', %L)$$, tests.id('store')), 'an unknown kind is refused', '22023');
select tests.throws(format($$select public.issue_order_incharge_set('store', %L)$$, tests.id('hub_a1')), 'a person that does not exist is refused', 'P0002');
select public.issue_order_incharge_set('store', tests.id('store'));
select tests.ok((public.issue_order_incharge() -> 'store' ->> 'name') = 'Store Keeper' and (public.issue_order_incharge() -> 'store' ->> 'has_login')::boolean
                and (public.issue_order_incharge() -> 'it') = 'null'::jsonb,
  'the Super Admin sets the Store in-charge; IT is still empty');

-- ---------- an order goes to the in-charge, who is posted at another hub ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('o2', public.issue_create(tests.id('hub_a1'), 'স্টোর অর্ডার: প্রিন্টার কাগজ', 'প্রিন্টার কাগজ ২ রিম', 'store', null, tests.id('hub_a1')::text || '/1.png')::text);
select tests.ok((select assignee_id = tests.id('store') and not assigned_by_nodi from public.issues where id = (select v::uuid from t where k = 'o2')),
  'the order is given to the Store in-charge');
insert into t values ('o3', public.issue_create(tests.id('hub_a1'), 'আইটি অর্ডার: স্ক্যানার', null, 'it')::text);
select tests.ok((select assignee_id is null from public.issues where id = (select v::uuid from t where k = 'o3')), 'an IT order waits, unassigned, while IT has no in-charge');
insert into t values ('o4', public.issue_create(tests.id('hub_a1'), 'স্টোর অর্ডার: মার্কার', null, 'store', null, null, tests.id('other'))::text);
select tests.ok((select assignee_id = tests.id('other') from public.issues where id = (select v::uuid from t where k = 'o4')), 'a person named by hand wins over the in-charge');

select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 1 from public.notifications where profile_id = tests.id('rider_login') and title like '%স্টোর অর্ডার%'),
  'the in-charge is notified');
select tests.ok((select jsonb_array_length(public.issue_panels() -> 'mine') = 1 and (public.issue_panels() -> 'mine' -> 0 ->> 'kind') = 'store' from (select 1) x),
  'the in-charge sees the order as their job although it is another hub''s');
select tests.ok(private.issue_photo_readable(tests.id('hub_a1')::text || '/1.png'), 'and may see the picture of that order');
select tests.ok(not private.issue_photo_readable(tests.id('hub_a1')::text || '/other.png'), 'but not other pictures of that hub');
select tests.ok(private.issue_photo_writable(tests.id('hub_a1')::text || '/sent.png'), 'and may add a picture while the order is theirs to send');
select tests.ok(not private.issue_photo_writable(tests.id('hub_b1')::text || '/x.png'), 'not in a hub where they have no job');
select public.issue_act((select v::uuid from t where k = 'o2'), 'start');
select public.issue_act((select v::uuid from t where k = 'o2'), 'solve', 'পাঠিয়েছি — গাড়িতে');
select tests.ok(not private.issue_photo_writable(tests.id('hub_a1')::text || '/late.png'), 'once sent, no more pictures from the in-charge');
select tests.throws(format($$select public.issue_act(%L, 'approve')$$, (select v from t where k = 'o2')), 'the in-charge cannot confirm receipt themselves', '42501');

select tests.login(tests.id('hub_mgr'));
select public.issue_act((select v::uuid from t where k = 'o2'), 'approve', 'পেয়েছি');
select tests.ok((select status = 'approved' from public.issues where id = (select v::uuid from t where k = 'o2')), 'the hub confirms it arrived');

-- ---------- the in-charge can be cleared; a person who left no longer receives orders ----------
select tests.login(tests.id('super'));
select public.issue_order_incharge_set('store', null);
select tests.ok((public.issue_order_incharge() -> 'store') = 'null'::jsonb, 'the in-charge can be cleared');

-- ---------- ordinary issues are untouched ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('i1', public.issue_create(tests.id('hub_a1'), 'গ্রাহক ফোন ধরছে না', null, 'parcel', 'SF-1')::text);
select tests.ok((select kind = 'parcel' and assignee_id is null from public.issues where id = (select v::uuid from t where k = 'i1')), 'a parcel issue works as before');
select tests.throws(format($$select public.issue_create(%L, 'x', null, 'food')$$, tests.id('hub_a1')), 'an unknown kind is still refused', '22023');
select tests.throws(format($$select public.issue_create(%L, null)$$, tests.id('hub_a1')), 'an ordinary issue still needs a title, parcel ID or picture', '22023');

rollback;
