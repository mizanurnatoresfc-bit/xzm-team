-- DEMO fixtures only. A failing Data Entry refresh must not block self-attendance or shift reports.
begin;
set local time zone 'Asia/Dhaka';
select tests.fixture();
select tests.hr_fixture();
insert into tests.ids values
  ('nb_a', tests.active_employee('DEMO Ada', '731', tests.id('hub_a1'), '01731000731', '7310101010')),
  ('nb_b', tests.active_employee('DEMO Bina', '732', tests.id('hub_a1'), '01731000732', '7320101010'));
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code = 'zonal_manager' and p.code = 'data_entry.team.edit' on conflict do nothing;

select tests.login(tests.id('zonal_a'));
insert into tests.ids
select 'nb_member_' || right(name,1), public.data_entry_team_save(tests.id('zone_a'), id, tests.id('hub_a1'), '{}', true, null)
from tests.ids where name in ('nb_a','nb_b');
select public.data_entry_target_save(tests.id('hub_a1'), current_date, null, 'hub', '{"enabled":true}');
select tests.logout();

-- Make every refresh fail (rolled back with this transaction).
create or replace function private.data_entry_target_refresh(p_hub uuid, p_day date, p_trigger text)
returns boolean language plpgsql as $f$ begin raise exception 'DEMO refresh failure' using errcode = 'XX000'; end $f$;

select tests.throws('select private.data_entry_target_refresh(null, current_date, ''x'')', 'the stand-in refresh really fails', 'XX000');

insert into public.attendance_self_marks(employee_id, hub_id, work_date, kind, status)
values (tests.id('nb_a'), tests.id('hub_a1'), private.wf_today(), 'present', 'waiting');
select tests.ok(exists (select 1 from public.attendance_self_marks where employee_id = tests.id('nb_a') and work_date = private.wf_today()),
  'a self-attendance mark is saved even when the Data Entry refresh fails');
update public.attendance_self_marks set status = 'approved', decided_as = 'late'
where employee_id = tests.id('nb_a') and work_date = private.wf_today();
select tests.ok((select status = 'approved' from public.attendance_self_marks where employee_id = tests.id('nb_a') and work_date = private.wf_today()),
  'a manager decision on the mark is saved even when the refresh fails');

insert into private.data_entry_shift_reports(hub_id, work_date, member_id, slot, attempted, merchants, entry_minutes, note)
values (tests.id('hub_a1'), private.wf_today(), tests.id('nb_member_b'), 1, 10, 2, 15, '');
select tests.ok(exists (select 1 from private.data_entry_shift_reports where member_id = tests.id('nb_member_b') and slot = 1),
  'a shift report is saved even when the Data Entry refresh fails');
rollback;
