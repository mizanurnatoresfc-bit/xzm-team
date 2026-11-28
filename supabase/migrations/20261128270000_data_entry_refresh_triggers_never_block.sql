-- DE-V2 fix: a Data Entry refresh must never block the write that triggered it.
--
-- private.data_entry_refresh_on_self_mark (on public.attendance_self_marks) and
-- private.data_entry_refresh_on_shift_report (on private.data_entry_shift_reports) called
-- private.data_entry_target_refresh inside the caller's transaction with no error handling.
-- Any error in the target engine (bad configuration, a data problem, a future bug) therefore
-- made an HR self-attendance mark, or a staff member's shift report, fail.
--
-- The refresh only rebuilds a cached snapshot (data_entry_shift_control is always live and the
-- one-minute scheduler repeats the refresh), so a failed refresh is safe to skip. Each refresh now
-- runs in its own sub-transaction: on error it is rolled back, a warning is logged with the
-- hub and SQLSTATE (same style as private.data_entry_target_tick), and the original write goes through.
-- Cancellations (query_canceled) are not swallowed.
--
-- Only these two trigger functions change. The triggers, tables and grants are untouched.

create or replace function private.data_entry_refresh_on_self_mark() returns trigger
language plpgsql security definer set search_path to '' as $$
declare h uuid;
begin
  for h in
    select distinct cfg.hub_id
    from private.data_entry_target_hubs cfg
    where cfg.enabled and exists (
      select 1 from public.data_entry_team_members m
      where m.employee_id = coalesce(new.employee_id, old.employee_id)
        and m.is_active
        and (m.primary_hub_id = cfg.hub_id or exists (
          select 1 from public.data_entry_hub_assignments a
          where a.team_member_id = m.id and a.hub_id = cfg.hub_id and a.is_active))
    )
  loop
    begin
      perform private.data_entry_target_refresh(h, coalesce(new.work_date, old.work_date), 'attendance_self_mark');
    exception when others then
      raise warning 'Data Entry refresh after self-mark failed for hub % [%]', h, sqlstate;
    end;
  end loop;
  return coalesce(new, old);
end $$;

create or replace function private.data_entry_refresh_on_shift_report() returns trigger
language plpgsql security definer set search_path to '' as $$
declare hub_cfg uuid;
begin
  for hub_cfg in
    select distinct cfg.hub_id
    from private.data_entry_target_hubs cfg
    where cfg.enabled and cfg.hub_id = coalesce(new.hub_id, old.hub_id)
  loop
    begin
      perform private.data_entry_target_refresh(hub_cfg, coalesce(new.work_date, old.work_date), 'shift_report_submit');
    exception when others then
      raise warning 'Data Entry refresh after shift report failed for hub % [%]', hub_cfg, sqlstate;
    end;
  end loop;
  return coalesce(new, old);
end $$;

revoke execute on function private.data_entry_refresh_on_self_mark(), private.data_entry_refresh_on_shift_report()
  from public, anon, authenticated;
