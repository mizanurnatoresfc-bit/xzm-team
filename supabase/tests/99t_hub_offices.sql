-- Hub offices from hubs; office address flows back to the hub.
begin;
select tests.fixture();
update public.hubs set address = 'Old road 1' where id = tests.id('hub_a1');
select tests.login(tests.id('super'));
select tests.ok(public.office_create_hub_offices(tests.id('zone_a')) = 2, 'one office per hub of the zone');
select tests.ok(public.office_create_hub_offices(tests.id('zone_a')) = 0, 'running again adds nothing');
select tests.ok((select address = 'Old road 1' from public.office_properties where hub_id = tests.id('hub_a1')), 'office takes the hub address');
update public.office_properties set address = 'New road 9' where hub_id = tests.id('hub_a1');
select tests.ok((select address = 'New road 9' from public.hubs where id = tests.id('hub_a1')), 'changing the office address updates the hub');
select tests.logout();
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.office_create_hub_offices(null) = 0, 'a hub manager without create rights adds nothing');
select tests.logout();
rollback;
