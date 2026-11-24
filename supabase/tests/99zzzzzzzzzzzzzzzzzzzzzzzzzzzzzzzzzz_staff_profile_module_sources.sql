begin;
select tests.fixture();
select tests.hr_fixture();
select (now() at time zone 'Asia/Dhaka')::date as d \gset
insert into tests.ids values
  ('work_source_rider', tests.active_employee('Work Sources Rider', '967', tests.id('hub_a1'), '01711000967', '9670000000', 15000, tests.id('rider_login')));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));

with v as (
  insert into public.vehicles (code, name, kind, hub_id, zone_id)
  values ('WS-V', 'Work Sources Vehicle', 'bike', tests.id('hub_a1'), tests.id('zone_a')) returning id
)
insert into tests.ids select 'work_source_vehicle', id from v;
insert into public.vehicle_logs (vehicle_id, hub_id, zone_id, kind, log_date, driver_id, amount, status)
values (tests.id('work_source_vehicle'), tests.id('hub_a1'), tests.id('zone_a'), 'fuel', :'d'::date, tests.id('work_source_rider'), 250, 'approved');
insert into public.vehicle_day_logs (vehicle_id, hub_id, zone_id, log_date, driver_id, trips)
values (tests.id('work_source_vehicle'), tests.id('hub_a1'), tests.id('zone_a'), :'d'::date, tests.id('work_source_rider'), 3);
insert into public.issues (hub_id, zone_id, title, assignee_id, status)
values (tests.id('hub_a1'), tests.id('zone_a'), 'Parcel follow up', tests.id('work_source_rider'), 'open');
insert into public.da_expense_claims (employee_id, hub_id, zone_id, expense_name, category, amount, bill_date)
values (tests.id('work_source_rider'), tests.id('hub_a1'), tests.id('zone_a'), 'Travel claim', 'transport', 350, :'d'::date);
with s as (
  insert into public.da_sessions (hub_id, zone_id, account_date, started_by)
  values (tests.id('hub_a1'), tests.id('zone_a'), :'d'::date, tests.id('hub_mgr')) returning id
)
insert into public.da_rider_lines (session_id, hub_id, zone_id, employee_id, rider_name, delivery_qty)
select s.id, tests.id('hub_a1'), tests.id('zone_a'), tests.id('work_source_rider'), 'Work Sources Rider', 17 from s;

select tests.login(tests.id('super'));
select tests.ok((select p -> 'connected' @> '["issues","fleet","accounts"]'::jsonb and
    jsonb_array_length(p -> 'events') = 5 and jsonb_array_length(p -> 'modules') = 3
  from public.staff_profile_get(tests.id('work_source_rider'), :'d'::date, :'d'::date) p),
  'profile uses all five records from the three connected sources');
select tests.ok((select e.value ->> 'status' = 'draft' from
  jsonb_array_elements(public.staff_profile_get(tests.id('work_source_rider'), :'d'::date, :'d'::date) -> 'events') e
  where e.value ->> 'activity' = 'accounts_rider_sheet'), 'an open accounts sheet is draft');
select tests.ok(not exists (select 1 from
  jsonb_array_elements(public.staff_profile_get(tests.id('work_source_rider'), :'d'::date, :'d'::date) -> 'events') e
  where (e.value -> 'detail') ?| array['amount', 'mobile', 'remarks', 'attachment_path']),
  'timeline excludes financial amounts and private supporting fields');
select public.access_overrides_save(tests.id('noroles'), format(
  '[{"permission":"hr.employee.view","effect":"grant","scope_type":"hub","hub_id":"%s"}]', tests.id('hub_a1'))::jsonb,
  'Profile-only access test');
select tests.login(tests.id('noroles'));
select tests.ok((select not exists (select 1 from jsonb_array_elements(p -> 'events') e
     where e.value ->> 'module' in ('accounts','fleet','issues')) and p -> 'modules' = '[]'::jsonb
  from public.staff_profile_get(tests.id('work_source_rider'), :'d'::date, :'d'::date) p),
  'profile view does not bypass any source policy');
select tests.login(tests.id('rider_login'));
select tests.ok((select count(*) = 4 from
  jsonb_array_elements(public.staff_profile_get(tests.id('work_source_rider'), :'d'::date, :'d'::date) -> 'events') e
  where e.value ->> 'activity' in ('issue_assignment','fleet_fuel','accounts_expense_claim','accounts_rider_sheet')),
  'rider can see own authorised source records');
select tests.throws(format('select public.staff_profile_get(%L)', tests.id('hub_b1')), 'an unrelated resource is denied', '42501');
select tests.logout();
update public.issues set status = 'cancelled' where assignee_id = tests.id('work_source_rider');
select tests.login(tests.id('super'));
select tests.ok((select count(*) = 1 and bool_and(e.value ->> 'status' = 'cancelled') from
  jsonb_array_elements(public.staff_profile_get(tests.id('work_source_rider'), :'d'::date, :'d'::date) -> 'events') e
  where e.value ->> 'activity' = 'issue_assignment'), 'source state updates without duplicating the profile entry');
select tests.ok((select p -> 'events' = '[]'::jsonb and p -> 'modules' = '[]'::jsonb
  from public.staff_profile_get(tests.id('work_source_rider'), :'d'::date - 1, :'d'::date - 1) p), 'empty range returns arrays');
rollback;
