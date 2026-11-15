-- Issues, follow-up and the hub group: give a job, solve it, the giver checks it; reactions and "seen".
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into tests.ids values
  ('r1',  tests.active_employee('Issue Rider One', '801', tests.id('hub_a1'), '01711000801', '8010101010', 15000, tests.id('rider_login'))),
  ('r2',  tests.active_employee('Issue Rider Two', '802', tests.id('hub_a1'), '01711000802', '8020202020')),
  ('mgr', tests.active_employee('Issue Manager', '800', tests.id('hub_a1'), '01711000800', '8000000000', 15000, tests.id('hub_mgr')));

-- a parcel with a rider, for "parcel ID → person"
insert into public.merchants (code, name, hub_id, zone_id) values ('M-ISS', 'Issue Merchant', tests.id('hub_a1'), tests.id('zone_a'));
insert into public.parcels (tracking_no, merchant_id, hub_id, zone_id, customer_name, status, assigned_rider_id)
select 'SF-90001', m.id, tests.id('hub_a1'), tests.id('zone_a'), 'Customer', 'out_for_delivery', tests.id('r2')
from public.merchants m where m.code = 'M-ISS';

-- ---------- who may raise one ----------
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.issue_create(%L, 'Wrong hub')$$, tests.id('hub_a1')),
  'a manager of another hub cannot raise an issue here', '42501');
select tests.login(tests.id('noroles'));
select tests.throws(format($$select public.issue_create(%L, 'Nobody')$$, tests.id('hub_a1')),
  'a person with no role and no post cannot', '42501');

-- ---------- the hub manager gives a job from a parcel ID: the rider is picked from the parcel ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('i1', public.issue_create(tests.id('hub_a1'), null, 'গ্রাহক ফোন ধরছে না', 'parcel', 'SF-90001')::text);
select tests.ok((select assignee_id = tests.id('r2') and assigned_by_nodi and parcel_id is not null from public.issues where id = (select v::uuid from t where k = 'i1')),
  'the parcel''s rider gets the job, marked as chosen by Nodi');
select tests.ok((select title = 'পার্সেল SF-90001' from public.issues where id = (select v::uuid from t where k = 'i1')), 'with only a parcel ID the title is made from it');
select tests.ok((select count(*) = 1 from public.hub_posts where hub_id = tests.id('hub_a1') and kind = 'issue' and author_profile is null), 'Nodi posted the card in the hub group');

-- a named person
insert into t values ('i2', public.issue_create(tests.id('hub_a1'), 'গাড়ির কাগজ জমা দাও', null, 'vehicle', null, null, tests.id('r1'))::text);
select tests.ok((select not assigned_by_nodi and assignee_id = tests.id('r1') from public.issues where id = (select v::uuid from t where k = 'i2')), 'a person named by hand is not marked as Nodi');
select tests.throws(format($$select public.issue_create(%L, 'x', null, 'other', null, null, %L)$$, tests.id('hub_a1'), tests.id('hub_a1')),
  'a person that does not exist is refused', 'P0002');

-- ---------- panels ----------
select tests.ok((select jsonb_array_length(public.issue_panels() -> 'given') = 2 from (select 1) x), 'the giver sees both under "I gave"');
select tests.login(tests.id('rider_login'));
select tests.ok((select jsonb_array_length(public.issue_panels() -> 'mine') = 1 from (select 1) x), 'the rider sees only the one given to them');
select tests.ok((select (public.issue_panels() -> 'mine' -> 0 ->> 'issue_no') is not null), 'the card carries its number');

-- ---------- the assignee works it; only the assignee ----------
select tests.throws(format($$select public.issue_act(%L, 'start')$$, (select v from t where k = 'i1')),
  'someone else''s job cannot be started by this rider', '42501');
select public.issue_act((select v::uuid from t where k = 'i2'), 'start');
select tests.ok((select status = 'in_progress' from public.issues where id = (select v::uuid from t where k = 'i2')), 'started');
select tests.throws(format($$select public.issue_act(%L, 'solve')$$, (select v from t where k = 'i2')),
  'solving needs a note or photo', '22023');
select tests.throws(format($$select public.issue_act(%L, 'approve')$$, (select v from t where k = 'i2')),
  'the assignee cannot approve their own work', '42501');
select public.issue_act((select v::uuid from t where k = 'i2'), 'solve', 'কাগজ অফিসে দিয়েছি');
select tests.ok((select status = 'solved' from public.issues where id = (select v::uuid from t where k = 'i2')), 'solved');
-- still on the rider's side as "waiting for check", not as work to do
select tests.ok((select jsonb_array_length(public.issue_panels() -> 'mine') = 0 and jsonb_array_length(public.issue_panels() -> 'waiting_for_check_of_mine') = 1 from (select 1) x),
  'a solved job moves out of "my work" into "waiting for the check"');

-- ---------- the giver checks: sends back, then approves ----------
select tests.login(tests.id('hub_mgr'));
select tests.ok((select jsonb_array_length(public.issue_panels() -> 'to_check') = 1 from (select 1) x), 'the giver has one to check');
select tests.throws(format($$select public.issue_act(%L, 'reopen')$$, (select v from t where k = 'i2')), 'sending back needs a reason', '22023');
select public.issue_act((select v::uuid from t where k = 'i2'), 'reopen', 'রসিদ দেখান');
select tests.ok((select status = 'in_progress' and reopen_count = 1 from public.issues where id = (select v::uuid from t where k = 'i2')), 'sent back once');
select tests.login(tests.id('rider_login'));
select public.issue_act((select v::uuid from t where k = 'i2'), 'solve', 'রসিদসহ জমা');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.issue_act(%L, 'approve')$$, (select v from t where k = 'i1')), 'an issue not yet solved cannot be approved', 'P0001');
select public.issue_act((select v::uuid from t where k = 'i2'), 'approve', 'ঠিক আছে');
select tests.ok((select status = 'approved' from public.issues where id = (select v::uuid from t where k = 'i2')), 'approved by the giver');
select tests.ok((select jsonb_array_length(public.issue_panels() -> 'to_check') = 0 from (select 1) x), 'it leaves the giver''s panel only after the approval');
select tests.throws(format($$select public.issue_act(%L, 'cancel', 'x')$$, (select v from t where k = 'i2')), 'a finished issue cannot be changed', 'P0001');
select tests.ok((select count(*) >= 5 from public.issue_events where issue_id = (select v::uuid from t where k = 'i2')), 'every step is in the log');

-- ---------- re-assign ----------
select public.issue_assign((select v::uuid from t where k = 'i1'), tests.id('r1'), 'এটা তুমি দেখো');
select tests.ok((select assignee_id = tests.id('r1') and not assigned_by_nodi from public.issues where id = (select v::uuid from t where k = 'i1')), 'handing it to another person');
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.issue_assign(%L, %L)$$, (select v from t where k = 'i1'), tests.id('r2')), 'another hub''s manager cannot re-assign it', '42501');

-- ---------- hub group: reactions and seen ----------
select tests.login(tests.id('hub_mgr'));
insert into t values ('p1', public.hub_post_create(tests.id('hub_a1'), 'আজ সবাই সময়মতো আসবেন')::text);
select tests.login(tests.id('rider_login'));
select tests.ok(public.hub_post_react((select v::uuid from t where k = 'p1'), '👍'), 'a reaction is added');
select tests.ok(not public.hub_post_react((select v::uuid from t where k = 'p1'), '👍'), 'the same reaction again takes it back');
select public.hub_post_react((select v::uuid from t where k = 'p1'), '✅');
select tests.throws(format($$select public.hub_post_react(%L, 'x')$$, (select v from t where k = 'p1')), 'only the listed reactions are allowed', '23514');
select tests.ok(public.hub_posts_seen(array(select id from public.hub_posts where hub_id = tests.id('hub_a1'))) >= 1, 'seen is recorded');
select tests.ok(public.hub_posts_seen(array(select id from public.hub_posts where hub_id = tests.id('hub_a1'))) = 0, 'seeing twice counts once');
select tests.login(tests.id('hub_mgr'));
select tests.ok((select (public.hub_feed(tests.id('hub_a1')) -> 0 ->> 'seen_count')::int = 1 from (select 1) x), 'the feed shows how many have seen the newest post');
select tests.ok((select count(*) = 1 from public.hub_post_seen_by((select v::uuid from t where k = 'p1')) where full_name = 'Issue Rider One'), 'the manager can see who has seen it');
select tests.ok((select count(*) = 1 from public.hub_post_reacted_by((select v::uuid from t where k = 'p1'))), 'and who reacted');
select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format($$select public.hub_feed(%L)$$, tests.id('hub_a1')), 'another hub''s group cannot be read', '42501');
select tests.ok((select count(*) = 0 from public.hub_posts where hub_id = tests.id('hub_a1')), 'nor its posts directly');
select tests.ok((select count(*) = 0 from public.issues where hub_id = tests.id('hub_a1')), 'nor its issues');
select tests.throws(format($$insert into public.issues (hub_id, zone_id, title) values (%L, %L, 'direct')$$, tests.id('hub_b1'), tests.id('zone_b')),
  'writes straight to the table are refused', '42501');

-- ---------- Nodi follow-up ----------
select tests.logout();
update public.issues set last_nudge_at = now() - interval '10 hours' where id = (select v::uuid from t where k = 'i1');
select tests.ok(public.issue_nudge_due(6) = 1, 'one stale issue gets a reminder');
select tests.ok(public.issue_nudge_due(6) = 0, 'and not again straight away');
select tests.ok((select count(*) >= 1 from public.hub_posts where kind = 'nodi' and author_profile is null), 'the reminder is a Nodi post in the group');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.issue_nudge_due(6)$$, 'a browser user cannot run the follow-up', '42501');

select 'done';
rollback;
