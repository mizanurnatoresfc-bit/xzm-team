begin;

-- Stop the service scheduler before running this rollback. Preserve duty history.
lock table public.job_duties, public.tasks in access exclusive mode;
do $$
begin
  if exists (select 1 from public.tasks where job_duty_id is not null)
    or exists (select 1 from public.job_duties where deadline_local is not null or hub_id is not null
      or verification_mode <> 'manual' or evidence_source is not null or reviewer_role <> 'hub_manager') then
    raise exception 'Duty records or settings exist. Disable the worker and retain the schema and history.';
  end if;
end
$$;

drop policy xzm013_task_scope_read on public.tasks;
drop policy xzm013_task_review_read on public.tasks;
drop policy xzm013_duty_hub_update on public.job_duties;
drop policy xzm013_duty_hub_insert on public.job_duties;
drop policy xzm013_duty_hub_view on public.job_duties;
drop policy xzm013_duty_hub_read on public.job_duties;
drop trigger xzm013_task_guard on public.tasks;
drop trigger xzm013_duty_scope on public.job_duties;

drop function public.duty_report(date, text, uuid);
drop function public.duty_run(uuid);
drop function public.duty_review(uuid, boolean, text);
drop function public.duty_submit(uuid, text, uuid, boolean);
drop function private.xzm013_can_review(text, uuid, uuid);
drop function private.xzm013_task_guard();
drop function private.xzm013_duty_scope_guard();
drop function private.xzm013_is_excused(public.tasks);
drop function private.xzm013_find_evidence(public.tasks, uuid);
drop function private.xzm013_reviewers(text, uuid, uuid);
drop view private.xzm013_evidence;

alter table public.tasks
  drop column job_duty_id, drop column duty_period_start, drop column duty_due_at,
  drop column duty_mode, drop column duty_reviewer_role, drop column duty_evidence_source,
  drop column duty_evidence_id, drop column duty_evidence_at, drop column duty_incomplete_reason,
  drop column duty_excused, drop column duty_overdue_notified_at, drop column duty_escalated_at;
alter table public.job_duties
  drop column hub_id, drop column deadline_local, drop column verification_mode,
  drop column evidence_source, drop column reviewer_role;

commit;
