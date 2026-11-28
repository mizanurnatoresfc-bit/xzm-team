-- Vehicle departure time anchors the evening shift clock. Deterministic Dhaka clock; everything rolls back.
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
  ('dep_a',tests.active_employee('DEMO Departure A','731',tests.id('hub_a1'),'01711000731','7310101010',15000,tests.id('rider_login')));
insert into public.user_permission_overrides (user_id,permission_id,effect,scope_type,zone_id,reason)
select tests.id('zonal_a'),p.id,'grant','zone',tests.id('zone_a'),'DEMO zone-scoped Data Entry access'
from public.permissions p where p.code='data_entry.team.edit';

-- Logged-in test users cannot call private functions directly; these definer helpers run them as the table owner.
create function pg_temp.win(at_clock time default null, day_offset integer default 0) returns table(day date, elapsed integer)
language sql security definer as $$
  select w.day, w.elapsed from private.data_entry_shift_window(tests.id('hub_a1'),
    case when at_clock is null then private.data_entry_shift_now() else ((current_date+day_offset+at_clock) at time zone 'Asia/Dhaka') end) w
$$;
create function pg_temp.due(slot integer) returns boolean language sql security definer as $$
  select private.data_entry_report_due(tests.id('hub_a1'),current_date,slot,private.data_entry_shift_now())
$$;
grant execute on function pg_temp.win(time,integer), pg_temp.due(integer) to public;

select tests.login(tests.id('zonal_a'));
insert into tests.ids select 'dep_member',public.data_entry_team_save(tests.id('zone_a'),tests.id('dep_a'),tests.id('hub_a1'),'{}',true,null);
select public.data_entry_shift_action(tests.id('hub_a1'),current_date,'schedule',
  '{"start_time":"18:00","open_minutes":480,"first_minute":0,"second_minute":90,"third_minute":180,"pickup_only":false}');
select public.data_entry_target_save(tests.id('hub_a1'),current_date,null,'hub','{"enabled":true}');

-- Default: the standing start time rules and nothing is overridden.
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))->>'departure' is null
  and public.data_entry_shift_timing(tests.id('hub_a1'))->>'standing_start'='18:00'
  and public.data_entry_shift_timing(tests.id('hub_a1'))->>'running'='false',
  'without a departure time the standing 18:00 start applies');
select tests.ok((select elapsed=-30 from pg_temp.win()),
  'default clock is 30 minutes before the standing start');

-- Set today's departure to 19:30: the shift clock, running flag and check-ins all move with it.
select public.data_entry_shift_departure(tests.id('hub_a1'),current_date,'19:30');
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))->>'departure'='19:30'
  and (select elapsed=-120 and day=current_date from pg_temp.win()),
  'departure time becomes the shift start for that day');
select set_config('tests.data_entry_clock','18:05',true);
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))->>'running'='false'
  and not pg_temp.due(1),
  'the standing 18:00 start no longer opens the shift or the first check-in');
select set_config('tests.data_entry_clock','19:35',true);
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))->>'running'='true'
  and (public.data_entry_shift_timing(tests.id('hub_a1'))->>'elapsed')::int=5
  and pg_temp.due(1)
  and not pg_temp.due(2),
  'hours and the first check-in count from the departure time');
select set_config('tests.data_entry_clock','21:05',true);
select tests.ok(pg_temp.due(2),
  'second check-in falls 90 minutes after departure');
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))#>>'{checkpoints,2,minute}'='180'
  and ((public.data_entry_shift_timing(tests.id('hub_a1'))#>>'{checkpoints,2,at}')::timestamptz at time zone 'Asia/Dhaka')::time='22:30',
  'timing lists each check-in at its real clock time');

-- The staff panel reads the same timing; an outsider cannot.
select tests.login(tests.id('rider_login'));
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))->>'departure'='19:30','team member sees the departure timing');
select tests.throws(format('select public.data_entry_shift_departure(%L,current_date,%L)',tests.id('hub_a1'),'20:00'),
  'staff cannot change the departure time','42501');
select tests.login(tests.id('hub_mgr'));
select tests.throws(format('select public.data_entry_shift_timing(%L)',tests.id('hub_a1')),
  'a hub manager without Data Entry access cannot read the timing','42501');

-- Validation, next-day scheduling and reset.
select tests.login(tests.id('zonal_a'));
select tests.throws(format('select public.data_entry_shift_departure(%L,current_date,%L)',tests.id('hub_a1'),'10:00'),
  'departure outside the evening window is rejected','22023');
select tests.throws(format('select public.data_entry_shift_departure(%L,current_date+2,%L)',tests.id('hub_a1'),'19:00'),
  'only the current or next shift can be set','22023');
select tests.throws(format('select public.data_entry_shift_departure(%L,current_date,%L)',tests.id('hub_b1'),'19:00'),
  'zone owner cannot set another zone departure time','42501');
select public.data_entry_shift_departure(tests.id('hub_a1'),current_date+1,'20:15');
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))->>'next_departure'='20:15'
  and public.data_entry_shift_timing(tests.id('hub_a1'))->>'departure'='19:30','tomorrow can be set ahead without moving today');
select public.data_entry_shift_departure(tests.id('hub_a1'),current_date,null);
select tests.ok(public.data_entry_shift_timing(tests.id('hub_a1'))->>'departure' is null
  and (select elapsed=185 from pg_temp.win()),
  'clearing the override returns to the standing start time');

-- After midnight the previous evening still belongs to its own departure time.
select public.data_entry_shift_departure(tests.id('hub_a1'),current_date,'22:00');
select tests.ok((select day=current_date-1 and elapsed=420 from pg_temp.win('01:00')),'01:00 still uses yesterday’s start, not today’s override');
select tests.ok((select day=current_date and elapsed=60 from pg_temp.win('23:00')),'a 22:00 departure sets today’s shift clock');
select tests.logout();
select tests.ok(exists(select 1 from public.audit_logs where table_name='data_entry_shift_departures' and action='DELETE'),
  'clearing a departure time is audited');
rollback;
