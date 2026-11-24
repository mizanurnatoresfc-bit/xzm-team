# Morning attendance, route publication and timed submissions

## Route publication

Use the existing route draft and suggestion UI. The zonal reviewer can load
the submitted roster with `wf_morning_get(hub, work_date)` and use `people` to
choose present staff and backup riders already eligible in the route module.

| RPC | Parameters | Behaviour |
| --- | --- | --- |
| `route_plan_publish` | `p_plan`, `p_version`, `p_morning_revision`, optional `p_note` | Check both scoped approval permissions and today's latest submitted revision. Active allocations must be to present staff and cannot include approved leave. Publish and create the in-app notifications in one transaction. |
| `route_plan_published` | `p_hub`, optional `p_date` | Read the latest published snapshot with the existing scoped route view grant. A draft opened for edits leaves the last publication visible. |
| `route_plan_resend` | `p_plan`, `p_version`, `p_request_id` (UUID) | Resend today's latest publication. Generate one request ID per intentional click and reuse it for network retries. |
| `route_plan_mine` | none | Existing staff-panel RPC returns today's approved assignment. There is no acceptance step. |

Legacy plans without a morning round continue through `route_plan_decide`.
When a morning round exists, approve through `route_plan_publish`; a returned
round must be submitted again first. New approval notifies the hub managers
and riders with active logins. An assigned rider removed in the next approved
version receives a cancellation notice. Mobile delivery depends on the existing
push pipeline and device registration; the database verifies the inbox rows.

The publication result contains `plan_id`, `version`, `morning_revision` and
`notifications`, or `already_published: true` for a replay. For errors
`22023` and `P0001`, reload the plan and headcount before retrying and display the
returned validation message. `42501` means the viewer lacks scoped access.

## Automatic submissions

The settings RPCs are `attendance_automation_get(p_hub)` and
`attendance_automation_set(p_hub, p_morning_cutoff, p_daily_delay_minutes)`.
Both require scoped `hr.attendance.configure`. The response includes the hub,
timezone, both settings and their activation work dates. Each option is off
when null. Supply the final morning cutoff as a local clock time (any grace
period is already included in that cutoff). A daily delay of 0 means midnight
following the work date. All timestamps are evaluated in Asia/Dhaka.

The job processes saved drafts on or after the activation date. It leaves forms
that were never opened as waiting, and reopened corrections remain open for
manual resubmission. A missing morning line becomes `unknown`. Daily rows
that pass existing validations enter the official register. Incomplete rows
remain visible as pending review and do not count as a final attendance state.
Their draft values are restored when the zonal manager unlocks the submitted
sheet. `att_sheet_get().sheet` includes `auto_submitted` and `pending_review`.
`wf_morning_get` also exposes `auto_submitted`.

The migration registers the every-minute `attendance-auto-submit` job where
`pg_cron` is installed. Nothing is scheduled per individual hub. Configuration
is opt-in and scoped; SQL fixture tests invoke the same worker using a fixed
clock. Before enabling in a hosted environment, verify pg_cron and an isolated
test hub's job run and inbox end to end.
