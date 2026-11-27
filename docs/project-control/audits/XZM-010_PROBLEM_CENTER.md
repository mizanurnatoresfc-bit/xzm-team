# XZM-010 Problem Center

## Baseline and verification

Audited main at `6831f29ddc853290af7442eabd3026930a91d6a3`. GitHub listed XZM-012 PR #219 as open at `5d98792`. XZM-010 leaves its global selector integration to that PR. Existing `/app/issues` links, Android notification deep links, Hub Group, Zone Group and Store/IT order flows keep their existing entry points. The staging project did not contain the audited issue RPCs. Production inspection used catalog SELECTs against the project identified by the production-binding audit.

| Finding | Verified in source and production definition |
|---|---|
| Assignment | `issue_create` and `issue_assign` check active/unarchived status for explicit assignees but lack a destination-scope check. The parcel auto-assignment path checks only archival status. The configured Store/IT recipient is a separate valid cross-hub case. |
| Visibility | Issue RLS permits the creator, giver, assignee or Hub Group members. `issue_panels` and `issue_detail` use caller RLS. `issue_events` uses parent visibility. Hub posts carry issue-linked notes and photos. There is no issue-level privacy classification. The definer hub-list RPC also counts all open issue rows at each visible hub. |
| Storage | `issue-photos` is private. Existing object policies grant Hub Group, eligible assignment and Zone Group access through helpers. Restricting issue RLS alone would leave paths through hub feed and signed URLs. |
| Approval | `issue_act` treats creator/giver and scoped approvers as reviewers. An assignee who is also the giver/creator can pass both checks. Store/IT review flags exclude scoped approvers, while approve/reopen currently allow them. |
| Reassignment | `issue_assign` changes status to open and clears the nudge timestamp, while preserving stale solution fields. |
| Review queue | A null assignee or caller employee ID can produce NULL booleans, causing otherwise visible issues to drop out of `issue_panels`. |
| Deadline | `issue_panels` computes work overdue for open/in-progress issues. `issue_nudge_due` uses one inactivity interval and shared nudge timestamp; there is no dedicated review deadline. |
| Hub context | On audited main the shortcut, toolbar and order form can choose the first hub. PR #219 provides shared working-hub defaults and still falls back to the first available hub. |
| Group membership | `in_hub_group` checks archival status for employee membership. `in_zone_group` also checks active status. Both have a scoped permission path. The zone list separately computes its display preference without checking active status. `hub_group_hubs` and `zone_group_list` derive visible groups from these helpers. |
| Create vs group view | `issue_create` calls `in_hub_group`, which accepts the group-view grant. Creation and group viewing therefore do not have distinct authorization boundaries. `zone_manager_tell` has its own membership/contact path and rate limit. |

The UI uses existing issue data and status values. History and reports apply work queue/date/hub/employee/kind/priority/status filters before reading up to 500 rows through issue RLS. The existing DataTable handles print and export. Truncated reports disable print and export. Related names remain subject to the related table's RLS. Resolved means approved. Returned means returned at least once. Date filters use the issue creation date in Asia/Dhaka.

## SQL draft and rollback

The SQL files beside this report are intentionally outside the migration runner. The draft resets solution state atomically on reassignment and repairs null queue flags. It proposes a destination authorization rule, permits scoped explicit cross-hub assignments and exempts approved Store/IT routing to the configured recipient. It proposes matching Store/IT approve/return to the current review queue and requiring a distinct approver. Owner should confirm how older Store/IT orders with a creator or giver who also solved the order will get an alternate approver. The draft also blocks overwriting a pending solution with another solve action. Existing RPC signatures and grants are preserved. Current definitions and grants should be compared again before applying.

Rehearse on isolated Supabase with synthetic accounts. Snapshot the function definitions and grants. If approved, run the draft and assertions on an isolated database and promote via the regular migration workflow. For rollback, revert the dependent web release if needed, restore the saved function definitions and grants in a transaction and verify create, assign, solve and review with synthetic records. An already committed reassignment cannot have its old solution fields reconstructed by function rollback. Keep workflow history and restore individual records only through an approved data correction.

## Business policy for Owner review

- Preserve legacy kind values and Store/IT routing. Add a separate category key for the 16 categories, backfilled only where the old kind has a clear correspondence. An explicit reference field should accept an authorized group update ID or plain reference. Keep server-issued problem number, hub, zone, creator and timestamps authoritative.
- For ordinary issues, consider a scoped Hub Manager or designated reviewer. For important issues, consider scoped Zonal Manager review, with category and priority configurable per zone under Super Admin permission. Exclude the actual submitter. A configured fallback reviewer is needed when the designated person cannot review. Keep return comments and add the previous and next status to issue event rows; preserve existing event IDs, user IDs and timestamp history.
- Give active employees a reporting entitlement at their own hub and separate delegated creation from group-view permission. Distinguish authorization to create a report from authority to assign it. Confirm inactive employee access with HR before changing the shared Hub Group helper.
- Introduce explicit sensitive visibility for new records. Keep legacy public-to-group entries under their current access rules. Enforce creator, current assignee, designated reviewer and approved scoped managers consistently in issue RLS, details, lists, exports, feed, reminders and reactions/seen APIs. Sensitive evidence needs a separate object namespace in the same private bucket with issue-bound upload and signing checks. Suppress sensitive issue cards and note/photo copies in group feeds. Historical group posts and already-issued URLs require a separate approved handling plan before legacy issues can be reclassified.
- Store a separate review deadline at solution submission using the approved zone setting. Keep work due and review due as independent timestamps and show them in Dhaka. Extend `issue_nudge_due` and `private.notify` for work-not-started, pre-deadline, overdue, pending-review and escalation notices with atomic per-stage deduplication. Reuse existing push and Android deep-link handling. Keep zone settings restricted to authorized zone managers and Super Admin. Hourly nudge cadence and existing delivery behavior need explicit verification before changing the schedule.

Approval configuration, full category/metadata fields, privacy enforcement, review deadlines, extended status events and notification/escalation changes remain pending. Use synthetic accounts for role/RLS/Storage/push coverage, including separate unauthorized-hub, unauthorized-destination, legitimate cross-hub, private evidence and duplicate-report cases.

## Test evidence

- TypeScript and a Vite build with a synthetic Supabase endpoint passed. A Dhaka wall-clock conversion matched the expected UTC instant with the client timezone set to America/Los_Angeles.
- Targeted Chromium checks passed at desktop and phone viewport sizes for report filtering, parcel duplicate warning, issue creation with evidence, Store orders, chat, Hub Group and board. A full browser suite attempt was interrupted by a local preview HTTP failure. Native Android was audited at source level.
- The migration and rollback ran in embedded PostgreSQL against synthetic records. Assertions exercise source hub access, explicit assignment, configured Store cross-hub routing, an authorized cross-hub manager, unmapped actors, reassignment reset, duplicate solution submission, distinct approval, queue membership and calls to the existing notification contract. This fixture does not use the Supabase role/RLS engine or send push notifications.
- Reproduce the draft test from the repository root with an isolated dependency install:
  ```sh
  npm install --prefix /tmp/xzm-010-pg @electric-sql/pglite@0.3.15
  NODE_PATH=/tmp/xzm-010-pg/node_modules node supabase/tests/xzm-010-draft.mjs
  ```
- Independent review caught a fail-open nullable authorization comparison in the original action path, inconsistent self-review flags in the draft, and stale report data after creation. The draft now fails closed and aligns review flags and actions. Create/action success invalidates report data. A Git three-way merge check on the updated branch against #219 passed.
