-- Assign hubs to a sorting center.
begin;
select tests.fixture();
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
with x as (insert into public.sorting_centers (code, name, zone_id) values ('SCA', 'Center A', tests.id('zone_a')) returning id)
insert into t select 'c', id from x;

select tests.login(tests.id('super'));
select tests.ok(public.sorting_assign_hubs((select v from t where k = 'c'), array[tests.id('hub_a1'), tests.id('hub_a2')], tests.id('hub_a1')) = 2, 'super admin assigns two hubs');
select tests.ok((select home_hub_id = tests.id('hub_a1') from public.sorting_centers where id = (select v from t where k = 'c')), 'center remembers its own hub');
select tests.ok(public.sorting_assign_hubs((select v from t where k = 'c'), array[tests.id('hub_a2')], null) = 1, 'removing a hub from the list unassigns it');
select tests.ok((select sorting_center_id is null from public.hubs where id = tests.id('hub_a1')), 'hub A1 is free again');
select tests.throws(format($$select public.sorting_assign_hubs(%L, array[%L]::uuid[])$$, (select v from t where k = 'c'), tests.id('hub_b1')), 'a hub of another area is refused', '22023');
select tests.logout();

select tests.login(tests.id('hub_mgr'));
select tests.throws(format($$select public.sorting_assign_hubs(%L, array[]::uuid[])$$, (select v from t where k = 'c')), 'a hub manager cannot assign', '42501');
select tests.logout();
rollback;
