# XZM-013 Duty API Contract

## Templates and assignments

`job_duties` keeps its existing position-or-employee target and CRUD. `zone_id` and the new optional `hub_id` narrow the target. A hub supplies its zone. An explicit employee must belong to the selected scope. Position templates also match the existing optional work focus. Use existing `hr.duty.view` and `hr.duty.edit` grants for the target scope.

Set `deadline_local` to a local time such as `15:30:00` to enable generation. A null deadline leaves a template on the legacy path. Set `frequency` to `daily`, `weekly` or `monthly`. Weekly periods run Monday through Sunday and monthly periods end on the last calendar day. The deadline falls on the last day of the period in Asia/Dhaka.

`verification_mode` is `manual`, `automatic` or `both`. The default is `manual`. `both` and `automatic` require a configured `evidence_source`. `reviewer_role` is `hub_manager` (ERP role code `manager`), `zonal_manager` or `super_admin`. A matching active reviewer other than the assignee is required when creating an occurrence. The selected reviewer role and the deadline are snapshotted on the task.

Read generated duties via the scoped `tasks` list using `job_duty_id`. The new fields are `duty_period_start`, `duty_due_at` (timestamp with timezone), `duty_mode`, `duty_reviewer_role`, `duty_evidence_source`, `duty_evidence_id`, `duty_evidence_at`, `duty_incomplete_reason`, `duty_excused`, `duty_overdue_notified_at` and `duty_escalated_at`. The assignee, scope and deadline are immutable on generated tasks. Flag transferred employees' open tasks to their original scoped reviewer for cancellation. The original occurrence stays in history and is not regenerated in another hub within that period.

## RPCs

| RPC | Parameters | Access and behavior |
|---|---|---|
| `duty_submit` | `p_task uuid, p_note text, p_record uuid = null, p_incomplete boolean = false` | Authenticated active assignee. A reason sets `duty_incomplete_reason` and leaves the task open. Completion submission requires a note and, in combined mode, an eligible record UUID. Automatic tasks accept an incomplete reason and complete through the worker. |
| `duty_review` | `p_task uuid, p_approve boolean, p_note text = null` | Independent reviewer with the configured role and scope. Return requires a note and reopens the task. Approval revalidates linked evidence. |
| `duty_report` | `p_date date, p_period text, p_employee uuid = null` | Authenticated active user. Pass `daily` or `monthly`. Returns employee, hub and zone IDs with `total`, `completed`, `excused`, `overdue` and `incomplete` counts. Rows are bucketed by Dhaka due date. Incomplete and overdue can overlap. Cancelled duties contribute only to total. |
| `duty_run` | `p_hub uuid` | Service role only. Returns counts for inserted, automatically verified, overdue-notified and escalated tasks. The runner creates the current periods, reconciles open duties and sends in-app notifications. |

Authorization failures use SQLSTATE `42501`. Invalid input, evidence or workflow state uses `22023`. Unique conflicts use `23505`. Legacy `task_complete` also enforces the generated duty guard. The duty-specific review RPC supports assignees whose reviewer lacks the legacy task-edit grant.

A period is excused when every day is covered by approved leave, an approved absence application scoped to that hub and zone, or an approved absent attendance mark. Partial-period absence leaves weekly or monthly work open. Approval and submission recheck absence at action time.

## Evidence sources

| Value | Module record | Credited actor and eligible state |
|---|---|---|
| `attendance` | `attendance_self_marks.id` | Employee on an approved present, late or half-day mark |
| `morning_manpower` | `wf_morning_subs.id` | Manager who submitted the current report |
| `route_planning` | `route_day_plans.id` | Sender of an approved, unarchived plan |
| `rider_visit` | `route_stop_visits.id` | Employee and authenticated writer on a location-qualified visit |
| `pickup` | `pickup_submissions.id` | Submitter of an approved pickup |
| `sorting` | `sorting_handovers.id` | Creator of a received handover |
| `hub_operations` | `hub_ops_reports.id` | Submitter of a reviewed hub operations report |
| `data_entry` | `da_sessions.id` | Submitter of an approved, verified session |
| `accounts` | `cash_reconciliations.id` | Preparer of an approved reconciliation |
| `problem_center` | `issues.id` | Actor on the solve event that matches the independently approved issue |

The source row must match employee or profile, hub, zone, local work date and deadline. If the source carries both actor identifiers, both must match. Records can be reused across distinct templates and only once within a template. A hub-wide submission credits its real actor. Automatic verification for dedicated Hub Registers, Vehicle and Driver, and Company Reporting remains pending. The available candidate mappings need confirmed actor attribution, approval, or hub-level identity before activation.

## Worker invocation and rollout

After staging validation on the restored ERP baseline, schedule a trusted caller every five minutes per enabled hub. A database operator can use Supabase Cron with job command `select public.duty_run('<hub UUID>'::uuid)` on the intended database. Use only owner-approved hubs. The worker serializes calls per hub and sends an overdue notification once, then escalates once after 24 hours to active zonal managers. No scheduled job is installed by this migration. Stop its scheduler before rolling back. The rollback refuses to remove the schema once duty configuration or history exists.

The worker generates current-period duties when it runs. A missed full day requires reconciliation before release because the worker does not backfill past periods using current employee assignments.
