begin;
select tests.fixture();
create temp table desk_set_fixture (name text primary key, id uuid);
grant select, insert on desk_set_fixture to authenticated;
insert into tests.ids values ('desk_staff_login', tests.make_user('desk.staff@test.local', 'Desk Staff'));
insert into tests.ids values ('desk_staff', tests.active_employee('Desk Staff', '902', tests.id('hub_a1'), '01711000902', '9020101010', 15000, tests.id('desk_staff_login')));
select tests.grant_role(tests.id('desk_staff_login'), 'rider', 'hub', null, tests.id('hub_a1'));

select tests.login(tests.id('zonal_a'));
with created as (
  insert into public.office_properties (code, name, kind, zone_id, hub_id)
  values ('SET01', 'Desk set office', 'office', tests.id('zone_a'), tests.id('hub_a1')) returning id
) insert into desk_set_fixture select 'property', id from created;
with created as (
  insert into public.office_desks (property_id, code, name)
  values ((select id from desk_set_fixture where name = 'property'), 'D1', 'Desk 1') returning id
) insert into desk_set_fixture select 'desk', id from created;
with created as (
  insert into public.office_assets (property_id, kind, name, quantity)
  values ((select id from desk_set_fixture where name = 'property'), 'chair', 'Set chair', 3) returning id
) insert into desk_set_fixture select 'chair', id from created;
select tests.logout();

select tests.login(tests.id('hub_b_mgr'));
select tests.throws(format('select public.office_save_desk_set(%L, null, %L, null)',
  (select id from desk_set_fixture where name = 'desk'), '{}'), 'another hub cannot change the desk set', '42501');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select public.office_save_desk_set(d.id, tests.id('desk_staff'),
  jsonb_build_object((select id::text from desk_set_fixture where name = 'chair'), 2), d.updated_at)
from public.office_desks d where d.id = (select id from desk_set_fixture where name = 'desk');
select tests.ok((select sum(quantity) = 3 and sum(quantity) filter (where holder_id = tests.id('desk_staff')) = 2
  from public.office_assets where property_id = (select id from desk_set_fixture where name = 'property')),
  'assigning two chairs preserves total stock');
select tests.ok((select desk_set_items -> 0 ->> 'quantity' = '2'
  from public.office_desks where id = (select id from desk_set_fixture where name = 'desk')),
  'desk history can capture the selected items and quantities');
select tests.logout();

select tests.login(tests.id('desk_staff_login'));
select tests.ok((select count(*) = 1 and sum(quantity) = 2 from public.office_assets
  where property_id = (select id from desk_set_fixture where name = 'property')),
  'the staff member sees assigned stock only');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select public.office_save_desk_set(d.id, null, '{}'::jsonb, d.updated_at)
from public.office_desks d where d.id = (select id from desk_set_fixture where name = 'desk');
select tests.ok((select sum(quantity) = 3 and count(holder_id) = 0 and count(desk_id) = 0 from public.office_assets
  where property_id = (select id from desk_set_fixture where name = 'property')), 'the whole set can return to office stock');
select tests.logout();
rollback;
