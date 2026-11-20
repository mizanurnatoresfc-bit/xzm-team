-- Water and gas bills of an office / residence (20261121000100_office_bill_water_gas): saved like the others,
-- one of each a month, no screenshot needed, and no other new kind slips in.
begin;
select tests.fixture();
create temp table t (k text primary key, v text); grant all on t to authenticated;

select tests.login(tests.id('zonal_a'));
insert into public.office_properties (code, name, kind, zone_id, hub_id, rent)
values ('RWG1', 'A1 Mess', 'residence', tests.id('zone_a'), tests.id('hub_a1'), 8000);
insert into t select 'p', id::text from public.office_properties where code = 'RWG1';
select tests.logout();

select tests.login(tests.id('hub_mgr'));
insert into t values ('w', public.office_bill_save((select v::uuid from t where k = 'p'), 'water', current_date, 350, '{"method":"cash"}') ->> 'id');
insert into t values ('g', public.office_bill_save((select v::uuid from t where k = 'p'), 'gas', current_date, 1080, '{"has_memo":true}') ->> 'id');
select tests.ok((select count(*) = 2 from public.office_bills where kind in ('water', 'gas') and bill_month = date_trunc('month', current_date)::date),
  'a water and a gas bill are saved for the month, without a screenshot');
select tests.ok((select memo_no like 'OM-%' from public.office_bills where id = (select v::uuid from t where k = 'w')), 'a water bill without a memo gets the office''s own memo number');
select tests.throws(format($$select public.office_bill_save(%L, 'water', current_date, 10)$$, (select v from t where k = 'p')), 'one water bill a month', '23505');
select tests.throws(format($$select public.office_bill_save(%L, 'sewer', current_date, 10)$$, (select v from t where k = 'p')), 'an unknown bill kind is refused', '22023');
select tests.logout();

select tests.throws(format($$insert into public.office_bills (property_id, kind, bill_month, amount) values (%L, 'sewer', date_trunc('month', current_date)::date, 10)$$, (select v from t where k = 'p')),
  'the table itself refuses an unknown kind', '23514');
select tests.ok((select count(*) = 0 from public.office_bills where kind not in ('rent', 'electricity', 'wifi', 'water', 'gas', 'other')), 'no bill has any other kind');

rollback;
