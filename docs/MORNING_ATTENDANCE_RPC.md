# Morning headcount RPC contract

This is the first backend slice of the attendance-to-routing workflow. It is a
planning input and has its own revision history. Existing attendance and route
plan RPCs are unchanged in this slice.

| RPC | Input | Caller |
| --- | --- | --- |
| `wf_morning_get` | `p_hub`, optional `p_date` | A scoped creator or reviewer |
| `wf_morning_save` | `p_hub`, `p_date`, `p_revision`, `p_marks`, optional `p_submit` | A scoped creator, for today in Asia/Dhaka |
| `wf_morning_return` | `p_hub`, `p_date`, `p_revision`, `p_reason` | A scoped reviewer, for today in Asia/Dhaka |

The default hub manager receives `hr.morning_attendance.create`. The default
zonal manager receives `hr.morning_attendance.approve` for viewing the
submitted rows and returning today's round. Admin has both capabilities.
Effective permissions and the selected hub determine access.

The response includes `hub_id`, `work_date`, `revision`, `status`,
`submitted_at`, `return_note`, `can_edit`, `can_return`, and `people`.
Use the capability flags for buttons. Use the returned date and revision
for updates. A creator receives `people: null` after submission. A reviewer
receives the submitted employees, or waiting/returned metadata before the
new submission. A principal with both grants sees the submitted rows via
the reviewer grant.

Marks are a patch object keyed by employee UUID with values `present`,
`absent`, or `unknown`. The server resolves `leave` from approved HR leave
or the canonical attendance register. Omitted rows become `unknown` in the
submitted snapshot. To read the roster use the get RPC. To finalize set
`p_submit: true`; after an uncertain result, refresh or repeat with an
empty patch and the same revision. A changed or locked revision must be
reloaded. A reviewer return preserves the submitted snapshot and opens the
next editable revision with a reason.

Next backend slices connect the submitted revision to the existing route
approval and notification path and add configurable cutoff processing for
morning drafts and daily attendance.
