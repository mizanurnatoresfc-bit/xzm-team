-- DEMO Hub workflow with a deterministic Dhaka clock. Roll back all fixtures and clock changes.
begin;
set local time zone 'Asia/Dhaka';
select tests.fixture();
select tests.hr_fixture();
create or replace function private.data_entry_shift_now() returns timestamptz
language sql stable set search_path='' as $$
  select (current_date+coalesce(nullif(current_setting('tests.data_entry_clock',true),''),'21:15')::time) at time zone 'Asia/Dhaka'
$$;
select set_config('tests.data_entry_clock','17:30',true);
insert into tests.ids values
  ('evening_a',tests.active_employee('DEMO Evening A','721',tests.id('hub_a1'),'01711000721','7210101010',15000,tests.id('rider_login'))),
  ('evening_b',tests.active_employee('DEMO Evening B','722',tests.id('hub_a1'),'01711000722','7220101010')),
  ('evening_head',tests.active_employee('DEMO Hub Manager','723',tests.id('hub_a1'),'01711000723','7230101010',15000,tests.id('hub_mgr')));
with morning as (
  insert into public.wf_morning_subs(hub_id,zone_id,work_date,status,submit_mode,submitted_at)
  values(tests.id('hub_a1'),tests.id('zone_a'),current_date,'submitted','manager',now()) returning id
)
insert into public.wf_morning_lines(sub_id,employee_id,state)
select morning.id,tests.id(person.key), 'present' from morning cross join unnest(array['evening_a','evening_b']) person(key);
with merchant as (
  insert into public.merchants(code,name,hub_id) values('EV1','Evening Merchant',tests.id('hub_a1')) returning id
)
insert into tests.ids select 'evening_merchant',id from merchant;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code = 'zonal_manager' and p.code = 'data_entry.team.edit'
on conflict do nothing;

select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.data_entry_shift_control(%L,null)', tests.id('hub_a1')),
  'hub manager has no default Data Entry access','42501');
select tests.login(tests.id('zonal_a'));
insert into tests.ids
select 'evening_member_'||right(name,1),public.data_entry_team_save(tests.id('zone_a'),id,tests.id('hub_a1'),'{}',true,null)
from tests.ids where name in ('evening_a','evening_b');
select public.data_entry_target_save(tests.id('hub_a1'),current_date,id,'rule',
  '{"working_minutes":240,"break_minutes":30,"initial_parcels_per_hour":100,"initial_points_per_hour":100}')
from tests.ids where name in ('evening_member_a','evening_member_b');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date-n,'seed_pickups','{"parcels":100,"merchants":2}')
from generate_series(1,7) n;
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'schedule',
  '{"start_time":"18:00","open_minutes":480,"first_minute":0,"second_minute":90,"third_minute":180,"pickup_only":false}');
select public.data_entry_target_save(tests.id('hub_a1'),current_date,null,'hub','{"enabled":true}');
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)->>'running'='false','shift is closed before its evening start');
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)->>'forecast'='100','seven opening days produce forecast');
select tests.throws(format('select public.data_entry_shift_control(%L,null)',tests.id('hub_b1')),
  'zone owner cannot control another zone','42501');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'appoint_head',
  jsonb_build_object('employee_id',tests.id('evening_head'),'verify_reports',true,'assign_duties',false));
select tests.login(tests.id('hub_mgr'));
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)->>'can_review'='true'
   and public.data_entry_shift_control(tests.id('hub_a1'),null)->>'can_assign'='false'
   and not (public.data_entry_shift_control(tests.id('hub_a1'),null) ? 'updates'),
  'Head can verify reports only and cannot read private updates');
select tests.throws(format('select public.data_entry_shift_action(%L,current_date,%L,%L)',tests.id('hub_a1'),'revoke_head','{}'),
  'a Head cannot change delegation','42501');

select tests.logout();
select tests.ok((select day=current_date-1 and elapsed=420 from private.data_entry_shift_window(tests.id('hub_a1'),
 ((current_date+time '01:00') at time zone 'Asia/Dhaka'))),'01:00 belongs to previous evening shift');
select tests.ok(not private.data_entry_report_due(tests.id('hub_a1'),current_date,1,private.data_entry_shift_now()),
  'no popup before evening');
insert into public.pickup_consolidations(pickup_date,hub_id,zone_id,merchant_id,trip_no,parcel_count,
  cod_amount,collection_amount,accepted_submission_id,submission_count,had_conflict,approved_by)
values(current_date,tests.id('hub_a1'),tests.id('zone_a'),tests.id('evening_merchant'),1,120,0,0,gen_random_uuid(),1,false,tests.id('zonal_a'));
select set_config('tests.data_entry_clock','18:05',true);
select tests.ok(private.data_entry_target_tick()=1,'evening schedule publishes the actual count');
select tests.ok(private.data_entry_target_tick()=0,'unchanged scheduler tick is idempotent');
select tests.login(tests.id('rider_login'));
select tests.ok(public.data_entry_shift_mine()#>>'{hubs,0,next_slot}'='1','first popup opens at its scheduled time');
select tests.throws(format('select public.data_entry_shift_action(%L,current_date,%L,%L)',tests.id('hub_a1'),'report','{"slot":2,"attempted":0}'),
  'second popup is not open yet','42501');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'report','{"slot":1,"attempted":0}');
select tests.ok(public.data_entry_shift_mine()#>'{hubs,0,next_slot}'='null'::jsonb,'first submission disarms its popup');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'peer',
  jsonb_build_object('member_id',tests.id('evening_member_b'),'kind','good_work','note','Helped unload the vehicle'));

select set_config('tests.data_entry_clock','21:15',true);
select tests.ok(public.data_entry_shift_mine()#>'{hubs,0,due_slots}'='[2,3]'::jsonb,
  'newer popups are exposed even while an earlier check-in is pending');
select set_config('tests.data_entry_clock','19:40',true);
select tests.ok(public.data_entry_shift_mine()#>>'{hubs,0,next_slot}'='2','progress popup opens after the second checkpoint');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'report','{"slot":2,"attempted":25,"merchants":1,"entry_minutes":25}');
select set_config('tests.data_entry_clock','21:15',true);
select tests.ok(public.data_entry_shift_mine()#>>'{hubs,0,next_slot}'='3','closing popup opens after the third checkpoint');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'report','{"slot":3,"attempted":45,"merchants":1,"entry_minutes":45}');
select tests.throws(format('select public.data_entry_shift_action(%L,current_date,%L,%L)',tests.id('hub_a1'),'report','{"slot":3,"attempted":45,"entry_minutes":45}'),
  'a closing report is submitted only once','23505');

select tests.login(tests.id('hub_mgr'));
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'review',
  jsonb_build_object('member_id',tests.id('evening_member_a'),'slot',3,'correct',44));
select tests.throws(format('select public.data_entry_shift_action(%L,current_date,%L,%L)',tests.id('hub_a1'),'assign_duty','{}'),
  'verify-only Head cannot assign duties','42501');
select tests.login(tests.id('zonal_a'));
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)#>>'{updates,0,note}'='Helped unload the vehicle',
  'colleague update reaches the Zone Manager inbox');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'limit',
  jsonb_build_object('member_id',tests.id('evening_member_a'),'maximum',44));
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)#>>'{team,0,remaining}'='0',
  'manager cap preserves 44 verified entries and gives that worker no new allocation');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'availability',
  jsonb_build_object('member_id',tests.id('evening_member_b'),'state','absent','note','Away for the evening'));
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)#>>'{team,1,attendance}'='absent'
  and public.data_entry_shift_control(tests.id('hub_a1'),null)->>'unassigned'='76',
  'evening absence removes the only remaining available allocation and preserves verified completed work');
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)#>>'{performance,0,correct}'='44',
  'verified closing report feeds the performance profile');
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)#>'{performance,1,accuracy}'='null'::jsonb,
  'worker with less opportunity is unranked without a score deduction');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'assign_duty',
  jsonb_build_object('member_id',tests.id('evening_member_a'),'kind','loading','entry_minutes',20,'note','Truck still at hub'));
select tests.login(tests.id('rider_login'));
select tests.ok(public.data_entry_shift_mine()#>>'{hubs,0,duties,0,kind}'='loading','worker receives the additional duty');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'complete_duty',
  jsonb_build_object('id',public.data_entry_shift_mine()#>>'{hubs,0,duties,0,id}'));
select tests.login(tests.id('zonal_a'));
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'approve_duty',
  jsonb_build_object('id',public.data_entry_shift_control(tests.id('hub_a1'),null)#>>'{duties,0,id}'));
select tests.ok(public.data_entry_shift_control(tests.id('hub_a1'),null)#>>'{performance,0,loading}'='1','verified duty counts once');
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'revoke_head','{}');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.data_entry_shift_control(%L,null)',tests.id('hub_a1')),
  'revocation immediately removes Head access','42501');
rollback;
