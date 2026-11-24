# Attendance integration review

This branch is based on frontend PR #152 and its morning/route RPC contract.
It brings the scoped Workforce Hub overview from #150 and the daily
auto-submit logic from #151 into that contract. The three #151 migrations
are alternative implementations and must not be installed alongside this
candidate. The #150 migration is carried here under a unique version so
that its original timestamp does not collide with #152.

| Group | Entry | Scope | Result |
| --- | --- | --- | --- |
| 02 | `wf_hub_overview` | Assigned hub, attendance view or daily ops view | An operations-only account can read daily figures, with contact and attendance fields withheld. |
| 02/05 | `wf_morning_save`, `wf_morning_submit`, `wf_morning_zone`, `wf_morning_return` | Assigned hub or authorised route review | Existing PR #152 request and response contract. The scheduler closes saved original drafts and never creates forms for unopened dates. |
| 05 | `route_plan_decide`, `route_plan_published`, `route_plan_resend`, `route_plan_mine` | Scoped plan approval/view and the recipient's own assignment | Approval serialises with morning return. Keep existing #152 UI and notification link formats. |
| 02 | `wf_att_policy_save`, `att_sheet_get` | Zone attendance configuration, scoped sheet view | Saving day_time or day_extra explicitly activates daily submission for that zone from its current Dhaka work date. Sheet response adds auto_submitted and pending_review. |

Daily scheduler uses Asia/Dhaka. With time 00:00 and extra 0, a saved workday
draft is due when the next calendar day starts. Complete rows use existing
daily register logic. Incomplete rows are visible for review and excluded
from final counts. Unlock restores the original inputs for manual correction
and resubmission. Reopened corrections and drafts from before enablement are
not closed automatically.

Only morning/route, daily automatic submission, and the hub overview are
covered here. Review the leave source policy separately. Monthly versioning,
hosted cron, phone push and real-role end-to-end smoke are separate work.
