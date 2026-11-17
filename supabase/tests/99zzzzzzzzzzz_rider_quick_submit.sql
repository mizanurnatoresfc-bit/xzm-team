-- Staff send pickup, delivery and amount from the dashboard in one tap; it lands in the manager's
-- khata, and the manager accepts it (one line or all at once) before submitting the khata.
begin;
select tests.fixture();
select tests.hr_fixture();
create temp table t (k text primary key, v text);
grant all on t to authenticated;
insert into tests.ids values
  ('qs1', tests.active_employee('Quick Rider', '801', tests.id('hub_a1'), '01711000801', '8010101010', 15000, tests.id('rider_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

-- no khata open yet: the card says so, and sending is refused
select tests.login(tests.id('rider_login'));
select tests.ok(public.da_rider_open_managers() ->> 'session_id' is null and jsonb_array_length(public.da_rider_open_managers() -> 'mine') = 0,
  'before a manager opens the khata the card shows nothing to send to');
select tests.ok((public.da_rider_open_managers() ->> 'is_rider')::boolean, 'a rider post means the card is shown');
select tests.throws($$select public.da_rider_submit(null, 500, 3, 2)$$, 'nothing can be sent before the khata is open', 'P0002');

-- the manager opens the khata; with one manager open the rider need not choose
select tests.login(tests.id('hub_mgr'));
insert into t values ('s', public.da_start_session(tests.id('hub_a1'))::text);
select public.da_save_rider_line((select v::uuid from t where k = 's'), '801', 1, 0, 100, 100, 0);
select tests.login(tests.id('rider_login'));
select tests.throws($$select public.da_rider_submit(null, 0, 0, 0)$$, 'an empty submission is refused', '22023');
select tests.throws($$select public.da_rider_submit(null, -5, 1, 0)$$, 'a negative amount is refused', '22023');
insert into t values ('l1', public.da_rider_submit(null, 2500, 12, 4)::text);
select tests.ok((select created_by = tests.id('hub_mgr') and collector_user = tests.id('hub_mgr') and source = 'rider' and seq = 1
                   and pickup_qty = 4 and delivery_qty = 12 and amount = 2500 and accepted_at is null
                 from public.da_rider_lines where id = (select v::uuid from t where k = 'l1')),
  'the line goes into the manager''s khata, waiting, and the manager''s own line does not use up a turn');
select tests.ok((select jsonb_array_length(public.da_rider_open_managers() -> 'mine') = 2
                   and (public.da_rider_open_managers() ->> 'my_times')::int = 1),
  'the rider sees both of today''s lines and one turn used');
select tests.throws(format($$select public.da_rider_accept(%L)$$, (select v from t where k = 'l1')), 'a rider cannot accept their own line', '42501');

-- the manager cannot submit the khata while a rider line waits; accept all in one tap
select tests.login(tests.id('hub_mgr'));
select tests.ok(exists (select 1 from public.notifications where profile_id = tests.id('hub_mgr') and title = 'রাইডার হিসাব পাঠিয়েছে' and link = '/app/accounts/khata'),
  'the manager is told, with a link to the khata page');
select tests.throws($$select public.da_rider_submit(null, 10, 1, 0)$$, 'a manager without a staff record cannot send a rider line', '42501');
select tests.throws(format($$select public.da_close_my_part(%L)$$, (select v from t where k = 's')), 'the khata waits for rider lines to be accepted', '22023');
select tests.login(tests.id('rider_login'));
insert into t values ('l2', public.da_rider_submit(tests.id('hub_mgr'), 800, 3, 0)::text);
select tests.login(tests.id('hub_mgr'));
select public.da_rider_accept((select v::uuid from t where k = 'l2'), false, 'টাকা মেলেনি');
select tests.ok((select removed_at is not null and remove_reason = 'টাকা মেলেনি' from public.da_rider_lines where id = (select v::uuid from t where k = 'l2')),
  'a line sent back is taken off with the reason');
select tests.ok(public.da_rider_accept_all((select v::uuid from t where k = 's')) = 1, 'accept all takes the line still waiting');
select tests.ok(public.da_rider_accept_all((select v::uuid from t where k = 's')) = 0, 'nothing is left to accept');
select tests.ok((select riders = 2 and amount = 2600 from public.da_collectors((select v::uuid from t where k = 's')) where user_id = tests.id('hub_mgr')),
  'the accepted line counts in the manager''s khata');
select public.da_close_my_part((select v::uuid from t where k = 's'));
select tests.login(tests.id('rider_login'));
select tests.ok((select bool_and(x ->> 'status' in ('taken','accepted')) from jsonb_array_elements(public.da_rider_open_managers() -> 'mine') x),
  'the rider sees their lines as taken');
select tests.throws($$select public.da_rider_submit(null, 100, 1, 0)$$, 'once every khata is closed nothing more can be sent', '22023');
rollback;
