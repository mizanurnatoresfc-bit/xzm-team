-- DEMO fixtures only. Covers Equal distribution mode and the attendance evidence order of the target engine.
begin;
set local time zone 'Asia/Dhaka';
create or replace function private.data_entry_shift_now() returns timestamptz
language sql stable set search_path='' as $clock$ select (current_date + time '21:00') at time zone 'Asia/Dhaka' $clock$;
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('eq_a', tests.active_employee('DEMO Ada', '721', tests.id('hub_a1'), '01721000721', '7210101010')),
  ('eq_b', tests.active_employee('DEMO Bina', '722', tests.id('hub_a1'), '01721000722', '7220101010')),
  ('eq_c', tests.active_employee('DEMO Chitra', '723', tests.id('hub_a1'), '01721000723', '7230101010')),
  ('eq_d', tests.active_employee('DEMO Dipa', '724', tests.id('hub_a1'), '01721000724', '7240101010')),
  ('eq_e', tests.active_employee('DEMO Eva', '725', tests.id('hub_a1'), '01721000725', '7250101010')),
  ('eq_f', tests.active_employee('DEMO Fatima', '726', tests.id('hub_a1'), '01721000726', '7260101010'));
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code = 'zonal_manager' and p.code = 'data_entry.team.edit' on conflict do nothing;

select tests.login(tests.id('zonal_a'));
insert into tests.ids
select 'eq_member_' || right(name,1), public.data_entry_team_save(tests.id('zone_a'), id, tests.id('hub_a1'), '{}', true, null)
from tests.ids where name in ('eq_a','eq_b','eq_c','eq_d','eq_e','eq_f');
-- Same starting capacity for everyone, so any difference in a split comes from attendance or the mode.
select public.data_entry_target_save(tests.id('hub_a1'), current_date, id, 'rule',
  '{"working_minutes":90,"break_minutes":30,"initial_parcels_per_hour":150,"initial_points_per_hour":300}')
from tests.ids where name like 'eq_member_%';
select tests.logout();

insert into public.merchants(code, name, hub_id) values ('EQ1', 'DEMO Merchant EQ1', tests.id('hub_a1'));
insert into public.pickup_consolidations (
  pickup_date, hub_id, zone_id, merchant_id, trip_no, parcel_count,
  cod_amount, collection_amount, accepted_submission_id, submission_count, had_conflict, approved_by
)
select private.wf_today() - offset_days, tests.id('hub_a1'), tests.id('zone_a'),
  (select id from public.merchants where code = 'EQ1'), 1, 500, 0, 0, gen_random_uuid(), 1, false, tests.id('zonal_a')
from generate_series(1, 7) offset_days;

-- Attendance evidence. a, b: present in the morning submission. The rest depend on the order under test.
with morning as (
  insert into public.wf_morning_subs(hub_id, zone_id, work_date, status, submit_mode, submitted_at)
  values (tests.id('hub_a1'), tests.id('zone_a'), private.wf_today(), 'submitted', 'manager', now())
  returning id
)
insert into public.wf_morning_lines(sub_id, employee_id, state)
select morning.id, tests.id('eq_' || tag), 'present' from morning cross join unnest(array['a','b']) tag;

select tests.login(tests.id('zonal_a'));
select public.data_entry_target_save(tests.id('hub_a1'), current_date, null, 'hub', '{"enabled":true}');
select tests.logout();

-- c: self-mark the manager rejected. d: self-mark approved as half day. e: self-mark waiting, but the register says absent.
-- f: self-mark waiting, nothing in the register.
insert into public.attendance_self_marks(employee_id, hub_id, work_date, kind, status, decided_as, decide_note)
values (tests.id('eq_c'), tests.id('hub_a1'), private.wf_today(), 'present', 'rejected', null, 'DEMO not at the hub'),
       (tests.id('eq_d'), tests.id('hub_a1'), private.wf_today(), 'present', 'approved', 'half_day', null),
       (tests.id('eq_e'), tests.id('hub_a1'), private.wf_today(), 'present', 'waiting', null, null),
       (tests.id('eq_f'), tests.id('hub_a1'), private.wf_today(), 'present', 'waiting', null, null);
insert into public.attendance_records(employee_id, work_date, status, source)
values (tests.id('eq_e'), private.wf_today(), 'absent', 'manual');

select tests.ok((select private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today())->'workers'->tests.id('eq_member_c')::text->>'attendance') = 'pending',
  'a self-mark the manager rejected does not count as present');
select tests.ok((select private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today())->'workers'->tests.id('eq_member_d')::text->>'attendance') = 'half_day',
  'an approved self-mark counts as the manager decided, not as the first tap');
select tests.ok((select private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today())->'workers'->tests.id('eq_member_e')::text->>'attendance') = 'absent',
  'the attendance register beats a waiting self-mark');
select tests.ok((select private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today())->'workers'->tests.id('eq_member_f')::text->>'attendance') = 'present',
  'a waiting self-mark still counts when the register has no row');

-- Equal mode: the four eligible workers (a, b, d half day, f) share all 500 forecast parcels, 125 each.
select tests.login(tests.id('zonal_a'));
select public.data_entry_distribution_mode_set(tests.id('hub_a1'), 'equal');
select tests.logout();
select tests.ok((select (s->>'distribution_mode') = 'equal' and (s->>'forecast_pickups') = '500'
  and (s#>>'{forecast_summary,assignable}') = '500' and (s#>>'{forecast_summary,unassigned}') = '0'
  from (select private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today()) s) x),
  'equal mode assigns every forecast parcel');
select tests.ok((select count(*) = 4 and bool_and((w.value#>>'{forecast,parcels}')::integer = 125)
  from jsonb_each(private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today())->'workers') w
  where (w.value#>>'{forecast,parcels}')::integer > 0),
  'equal mode gives each of the four eligible workers 125 parcels');
select tests.ok((select bool_and(not (w.value->>'under_assigned')::boolean)
  from jsonb_each(private.data_entry_target_snapshot(tests.id('hub_a1'), private.wf_today())->'workers') w
  where (w.value#>>'{forecast,parcels}')::integer > 0),
  'an equal split flags nobody as under-assigned');
rollback;
