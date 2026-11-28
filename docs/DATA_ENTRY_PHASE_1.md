# XZM TEAM Data Entry · Phase 1

## Read-only project audit

Reviewed GitHub main at `40574ff4a809355c6b1c1dcfcfe5d1491506a285`, key Web/Android and SQL integration files, Supabase metadata, and the Netlify project for xzmteam.com. This is an integration audit for Data Entry. Authenticated browser, Android device, storage object and notification delivery tests are pending.

| Area | Observed integration |
| --- | --- |
| Web and Android | React, Vite and React Router in `web/`. The Android workflow packages the same app using Capacitor. Shared route, menu, API and styling for Phase 1. |
| Employee, hubs and zones | Existing records in `employees`, `hubs`, `zones` and employee assignment history. Employee onboarding remains in the existing staff module. |
| Access | Reuse `AuthProvider`, `ProtectedRoute`, `navAccess.ts`, role menu lists, access catalog and `private.has_permission` with zone scope. Live schema also exposes position-menu and user-level override tables. Position-menu behaviour for new links needs an authenticated DEMO check. |
| Pickup | `pickup_submissions`, `pickup_consolidations`, `merchants` and `parcels` are available. Use the approved, non-voided consolidation as the first candidate source for actual pickup counts. Confirm daily trip and cutoff rules before enabling automation. |
| Operations and attendance | Existing Operations Collection, hub-ops, daily attendance, morning attendance and leave workflows. Establish which submitted attendance record supplies the daily operational decision before implementing exclusions and backups. |
| Notifications | Reuse `notifications`, realtime and existing push delivery. There is no Data Entry event or schedule in Phase 1. |
| Audit | Reuse `private.audit_row` and `audit_logs` for team and assignment history. |
| Deploy | Netlify project for xzmteam.com reports an active ready deployment. `netlify.toml` builds from `web/`. The repository has isolated PostgreSQL migration/tests plus web build and smoke workflows. |
| Staging | Read-only inspection found zero public application tables. It needs a reviewed baseline and synthetic fixtures before a hosted DEMO can run. |

## Phase 1 implementation

**Menu** · ডাটা এন্ট্রি → ডাটা এন্ট্রি টিম · `/app/data-entry/team`. The link is in the existing department sidebar, access catalog, role menu matrix and menu editor.

1. Select a permitted active zone. Search existing active employees by name or employee code.
2. Select one primary hub and any number of distinct additional hubs in that zone.
3. Update or deactivate a membership with a revision check. A single transaction changes the membership and its additional hub rows. Deactivated rows and audit events preserve history.

Two new tables reference the existing employee, zone and hub tables. A unique employee membership prevents duplicate onboarding. Cross-zone transfers of memberships require a separate workflow decision. The draft RPCs check the current user's zone permission, accept active same-zone hubs, lock the affected rows, and reject stale changes. Direct table access is revoked for app roles. Only roster fields needed by this screen are returned. The app suppresses the Team page in the Super Admin role preview.

| Role | Phase 1 Team access |
| --- | --- |
| Data Entry Employee | Pending self-service panel in Phase 2 |
| Hub Manager | Pending own-hub pickup and progress in Phase 2 |
| Zonal Manager | Proposed zone-scoped `data_entry.team.edit`, plus Team route for restricted role menus, subject to approval |
| Super Admin | Existing global permission mechanism covers the Team page after release |

The migration registers the permission code. It adds no grants to the current named roles. This pull request is for review. No application migration, authenticated account change, production data update or deployment has been requested by this change.

## Next menu pages and dependencies

| Phase | Pages and work |
| --- | --- |
| 2 | ডাটা এন্ট্রি ড্যাশবোর্ড, হাব পিকআপ পরিকল্পনা, স্মার্ট কাজ বণ্টন, আমার কাজ, দৈনিক এন্ট্রি রিপোর্ট, ডাটা এন্ট্রি সেটিংস. Approved pickup source, capacity and merchant rules, six distribution modes, original/revised targets, batch reports and private evidence. |
| 3 | লাইভ অগ্রগতি, রিপোর্ট যাচাই, লিডারবোর্ড, অসম্পূর্ণ কাজ, পারফরম্যান্স রিপোর্ট. Atomic queue claims and transfers, zonal approvals, scores and daily reconciliation. |
| 4 | Asia/Dhaka schedules, attendance and leave, backup workforce, notifications, deadlines and System Health signals. |
| 5 | Web and APK regression, scoped access checks, DEMO, backup, rollback rehearsal and signed-off release. |

## Decision log and release checks

- Use existing employee IDs. Primary and additional hubs are Data Entry assignments independent of the HR primary hub. Restrict initial team assignment to the employee's current zone. Set the HR hub as the form default when eligible.
- Record changes on the existing audit trail. Use inactive memberships and assignments to preserve history. Decide how to re-enrol workers following an HR zone transfer before rollout.
- Capture the production database backup and current Netlify deploy ID immediately before any approved rollout. Keep the existing Android release artifact. Rehearse restoring in a separate environment first.
- Establish the synthetic staging baseline. Run the Phase 1 tests and validate the Team menu, role and position restrictions, search, staff lifecycle, two-hub save and Android parity in DEMO Hub.
- Before Phase 5 production release, run the full DEMO scenario with four workers, 45 merchants and 500/800 pickups. Record actual PASS/FAIL for distribution, absence, capacity overflow, transfer, duplicate prevention, approvals, rollback/reopen, leaderboard, reconciliation, cross-hub and cross-zone permission, Web/Android parity, and scheduler retry.
- If reverting the code before migration, close the draft or revert the branch commit. If already deployed, disable approved Team access, restore the prior site and Android releases, preserve the two new tables for history, and use an approved database rollback or fix-forward migration. Do not drop tables with real data.
