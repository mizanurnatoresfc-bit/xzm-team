# Development progress

## Phase 0 — Environment & architecture (2026-11-11)

### 1. Completed
- Environment inspected: target folder empty (new project). Build workspace: Node 22, Python 3.13, PostgreSQL 16, Docker client. **npm registry unreachable** (network setting) → frontend packages cannot be installed yet.
- Architecture, implementation plan and credentials guide written (`docs/`).
- Database test harness: local PostgreSQL + `local_supabase_shim.sql` reproducing Supabase roles, `auth.uid()` and default grants, so RLS behaves as on Supabase.
- Foundation database (pulled forward from Phase 1): organisation structure, profiles, scoped RBAC (global/zone/hub), 13 default roles, 33 permissions, append-only audit log with automatic triggers, archive-instead-of-delete, login history and account lockout, first-admin bootstrap.

### 2. Files
```
README.md, .env.example, .gitignore
docs/ARCHITECTURE.md, docs/IMPLEMENTATION_PLAN.md, docs/CREDENTIALS.md, docs/PROGRESS.md
supabase/migrations/20261111000100_foundation.sql
supabase/migrations/20261111000200_seed_rbac.sql
supabase/tests/local_supabase_shim.sql   (local testing only)
supabase/tests/00_helpers.sql
supabase/tests/10_org_scope_rls.sql
supabase/tests/20_rbac_escalation.sql
supabase/tests/30_audit_and_lockout.sql
scripts/test-db.sh
```

### 3. Database changes
Tables: `system_settings, organizations, zones, hubs, departments, positions, profiles, permissions, roles, role_permissions, user_roles, audit_logs, login_events`. RLS enabled on all. Private schema `private` with `has_permission()`, audit and guard triggers. API functions: `my_permissions()`, `archive_org_unit()`, `record_login_attempt()` (service role only).

### 4. Tests actually executed
`scripts/test-db.sh` on PostgreSQL 16.15 (local, with Supabase shim): **66 assertions, 3 files, 0 failures.** Mutation check: disabling RLS on `hubs` makes 2 test files fail, confirming the tests detect real leaks.
Covered: anon isolation; zone/hub scoping (read + write); inactive, locked, expired, future-dated and revoked access; no-delete even for DB owner; archive needs reason + permission; role-escalation attempts; self status/lockout tampering; audit diff/actor/reason; audit immutability; lockout after 5 failures; bootstrap only once.
**Not yet tested:** against a real Supabase instance (needs `supabase start` or a project); any frontend (not built).

### 5. Known issues / limitations
- Not yet run on real Supabase — small differences (e.g. extension schema) are possible; script supports `--supabase` mode for that.
- `has_permission()` is called per row; fine at current size, will be benchmarked with large data in Phase 8 (indexes already on scope columns).
- Zone/hub manager **assignment** to employees comes in Phase 2 (needs `employees` table).

### 6. Missing credentials / integrations
See `docs/CREDENTIALS.md`. Blocking Phase 1: package installation access, Supabase project (URL + anon key).

### 7. Next phase
Phase 1 — frontend foundation (design system, public site, logins, admin screens for org/RBAC/settings, en/bn), `auth-login` Edge Function. Waiting for plan approval and the decisions listed in the chat.

### Addendum — UI/UX & reference audit (2026-11-11)
- `docs/UI_UX_AUDIT.md`: reference audit (public site inspected live; 12 desktop dashboard screenshots), 13 problems to avoid, original XZM-TEAM design system (colour tokens with measured contrast, typography incl. Bangla, spacing, icons, layout shell, breakpoints, required screen states, accessibility checklist).
- Not possible yet: auditing XZM-TEAM's own UI (not built) and the reference's mobile layout (no mobile screenshots).

### Working assumptions (not yet confirmed by the owner — change any time before Phase 4)
- Fiscal year **July–June**, currency **BDT**.
- **Maker-checker**: the creator of a journal entry cannot approve it.
- Supabase: build and test locally first; cloud project needed before real sign-in testing.
- Package installs: still blocked — frontend cannot be built/tested by Claude until enabled.

---

## HR & Employee Management (requested as "Phase 4"; plan Phase 2) — 2026-11-11

### 1. Completed (database layer — the real system)
- **Employees**: create (as applicant), edit, transfer / promotion with dated history, activate / deactivate, resign, terminate, reinstate, archive. Status, Employee ID, hub, position and manager change **only** through audited workflow functions. Leavers' logins are deactivated automatically. Nothing is deleted.
- **Employee ID application**: page 1 identity → page 2 employment → page 3 preview with a live missing-fields list → submit → HR review (return / reject / approve). Employee ID is **entered by HR**, checked against the configurable company format and uniqueness — never generated. Preparer ≠ approver.
- **Sensitive data** (NID, date of birth, parents, addresses) in a separate table with no general read access. HR with the sensitive permission reveals it through `hr_reveal_sensitive(reason)`, which is audited; the audit log records which fields changed but never the NID value. NID images follow the same rule. Others see `•••• 1234`.
- **Documents**: photo, NID front/back, signature, CV, certificates; type/size/path checks; private storage bucket with record-level policies (applied automatically on Supabase). A signature image is explicitly not proof of consent or payment.
- **Dynamic profile builder**: sections + fields of all 12 types (text, number, date, dropdown, multi-select, checkbox, textarea, photo, document, signature, employee reference, hub reference) with required, visible, edit/view permission, validation, options, order, archive. Values are type-checked; archived fields keep their values and lock them; field type can't change once used. Required fields appear automatically in the application check and the missing-information report.
- **Bulk import**: rows → column mapping → validation (missing fields, invalid mobile/NID/dates incl. 31/02, duplicates inside the file and against existing records, unknown hub/department/position, Employee ID format and uniqueness, hub scope) → verification by a **second** HR person → commit of valid rows only (explicit opt-in to skip invalid rows, which stay as an error report) → bulk Employee ID assignment (all-or-nothing).
- **Compensation**: basic, transport, commission, configurable allowances & deductions; effective-dated; proposer ≠ approver; approved records frozen; history kept.
- **Salary sheets**: generated per hub/month from **approved** salary only; `net_payable = basic + transport + commission + other_allowances − deductions` (generated column); commission/allowance/deduction adjustments need a note; lines with missing salary block submission; preparer ≠ approver; approved sheets and that month's attendance are locked. Payment itself stays with Accounts.
- **Attendance & leave**: daily records with correction notes, future dates blocked, leave days only from approved requests, overlapping requests rejected, yearly quotas, self-approval blocked, balances and monthly summary report.
- **HR dashboard** function: total, active, inactive, new joining, resigned, terminated, transferred, pending applications, pending leave, pending salary changes, employees with missing info — computed within the caller's scope.

### 2. Files
```
supabase/migrations/20261111000300_hr_core.sql
supabase/migrations/20261111000400_hr_pay_attendance.sql
supabase/migrations/20261111000500_hr_import_dashboard.sql
supabase/migrations/20261111000100_foundation.sql   (profile guard now lets HR workflows deactivate leaver logins)
supabase/tests/00_helpers.sql                        (HR fixtures)
supabase/tests/40_hr_lifecycle.sql, 50_hr_pay_leave.sql, 60_hr_import.sql
demo/index.html                                      (HR screens added to the HTML demo)
```

### 3. Database changes
New tables: `employees, employee_sensitive, employee_assignments, employee_status_history, employee_applications, employee_documents, employee_field_sections, employee_custom_fields, employee_custom_field_values, pay_component_types, employee_compensation, employee_compensation_items, attendance_records, leave_types, leave_requests, salary_sheets, salary_sheet_lines, employee_import_batches, employee_import_rows`. 37 new `hr.*` permissions with default role grants. RLS on every table.

### 4. Tests actually executed
`scripts/test-db.sh` on PostgreSQL 16.15: **191 assertions in 6 files, 0 failures** (66 foundation + 125 HR). Bugs found and fixed by these tests: guard triggers could not tell API writes from workflow functions (security-definer context) — rewritten as invoker triggers; text-array appends; employee self-view of own approved payslip.
**Not tested yet:** real Supabase instance (storage bucket policies only apply there), any production frontend.

### 5. Decisions / open points
- **Loan and Savings references were NOT added.** Your master brief (§1) forbids Loan/Savings in database, navigation and plans; the HR request asks for "Loan and Savings references where authorized". These conflict — tell me which rule wins.
- Approved leave in the future is written into attendance when the day arrives (cancelling approved leave needs an HR correction; not automated yet).
- Salary is not prorated by absent days automatically; absence is entered as a deduction. Proration rules can be added once you confirm the company policy.

### 6. Next
Production frontend for HR (needs package installs / GitHub + Vercel setup), then Hubs & Operations.

---

## Zonal Management, Analytics and AI Assistant (requested as "Phase 8") — 2026-11-11

Note on numbering: in `IMPLEMENTATION_PLAN.md` "Phase 8" is QA & production. This request covers plan Phase 6 (tasks, reports, zonal dashboard) and Phase 7 (analytics, AI), built ahead of Phases 3–4.

### 1. Completed (database layer)
- **Daily hub figures** (`hub_daily_metrics`): pickup, delivery, merchants, riders on duty, rider capacity, working hours, cash, expenses, pending parcels. Entered by the hub, verified by a second person, locked after verification, reopened only with a reason. Only verified rows count anywhere.
- **Zonal dashboard** (`zm_dashboard`): total staff, active, inactive, new joining, resigned, transferred, Employee ID issued, pending applications, plus hub totals, tasks, travel and data completion. `zm_workforce_details` returns the rows behind each number, and the dashboard counts those same rows.
- **Hub performance** (`zm_hub_performance`): per-hub totals, parcels per rider-day, expense per parcel, volume share and rank.
- **Hub visits and travel** (`hub_visits`, `travel_claims`): km, fuel, meal, transport, other (with description); weekly and monthly report; weekly/monthly claims; claimant never approves; approval records the voucher number; returned claims release their visits.
- **Employee data completion** (`zm_data_completion`): mobile, joining date, position, hub, photo, NID front/back, signature, CV, documents required by settings and required custom fields, with a completion percentage. Reports whether NID images are on file without exposing them.
- **Tasks** (`tasks`, `task_reminders`): assign, deadline, automatic reminder, progress, submission, manager confirmation, return, reassign, cancel; `zm_task_accountability` per manager.
- **Workforce planning** (`zm_workforce_plan`, `workforce_recommendations`): per-hub recommendation from verified figures, each with evidence and assumptions (assumptions are system settings). Advisory categories only; nothing in the migration changes employees, pay or status.
- **Reports**: `zm_report_operations` (week, month, hub, zone), `zm_report_workforce` (hub, zone, department), `zm_report_employees`, `zm_visit_report`; `zm_log_export` writes every export/print to the audit log.
- 19 new `zonal.*` permissions with default role grants; RLS on all 6 new tables.

### 2. Files
```
supabase/migrations/20261111000600_zonal_management.sql
supabase/tests/70_zonal_management.sql
demo/index.html              (Zonal Management screen: 7 tabs)
.claude/launch.json          (starts the local demo server)
```

### 3. Tests
- **SQL tests: written, NOT executed.** `70_zonal_management.sql` has 96 assertions, but this PC has no PostgreSQL, Docker, WSL or Supabase CLI, so neither the new migration nor its tests have been run. Treat the migration as unverified until `scripts/test-db.sh` passes.
  - **Update, same day (courier phase):** a portable PostgreSQL 16.4 was set up outside the repo and migration 0600 plus `70_zonal_management.sql` were executed: **96 of 96 assertions pass, no change to 0600 was needed.** See the next section.
- **Demo: checked in the browser.** All 7 tabs render for Super Admin, Zonal Manager and Accountant with no console errors; claim submit → approve with voucher, validation messages, statistic drill-down and the planning rules were exercised; the generated .xlsx was checked structurally (zip records, CRCs, XML parse) but not opened in Excel; no horizontal scroll at 375 px.

### 4. Limitations / decisions
- Courier tables (parcels, pickups, cash handovers) do not exist yet, so operational data comes from the manually entered daily hub figures. That module should later write the same table from approved records.
- **No language model is connected.** The planning recommendations are fixed rules over verified figures. The demo "assistant" is keyword rules over the same data. A real assistant needs a server-side function and an AI key (see `CREDENTIALS.md`).
- Approving a claim records a voucher number only; posting to the ledger waits for Accounts.
- Reminders are stored and `task_due_reminders()` hands due ones to a scheduled server job; the job itself (notification delivery) is not built.
- PDF in the demo is the browser's print-to-PDF; Excel is a real .xlsx. Production PDF/Excel rendering belongs to the frontend build.
- "Employee ID issued" counts approved applications; employees imported directly with an ID are not counted.

---

## Hub, Zone and Courier Operations (requested as "Phase 5"; plan Phase 3) — 2026-11-11

### 1. Completed (database layer)
- **Merchants and parcels** (`merchants`, `parcels`): parcel ID (`tracking_no`) is unique and case-insensitive; a parcel starts at the hub and its status, rider and hub change only through the workflow functions.
- **Assignments** (`ops_assignments`, `ops_assign`, `ops_end_assignment`, `ops_hub_staff`): Hub Manager (needs a zone-level right), Zonal Manager (needs a company-level right) and riders (hub-level right) with full history; a new assignment closes the previous one. One current Hub Manager per hub, one Zonal Manager per zone, one hub per rider.
- **Pickup submissions** (`pickup_submissions`): Pickup Manager, Hub Manager and Rider each submit independently (date, hub, merchant, trip, submitter, time, parcels, COD, cash taken). `ops_pickup_groups` compares the submissions of one pickup: **single / duplicate** (same figures) **/ conflict** (figures differ). Pending → Verified → Approved or Rejected. Approval writes **one** row to `pickup_consolidations`; duplicates are closed with it, conflicting submissions are rejected, and a conflict cannot be approved without a note. A person who submitted the pickup can neither verify nor approve it. `ops_void_pickup` reopens a wrong approval.
- **Delivery** (`delivery_records`, `ops_dispatch_parcels`, `ops_record_delivery`, `ops_decide_delivery`): delivered / failed / returned, approved by a second person; a COD mismatch needs a note; approval moves the parcel and records the COD cash against the rider.
- **Cash** (`cash_collections`, `cash_handovers`, `merchant_payments`, `operational_expenses`, `cash_reconciliations`): rider → hub → Main Accounts handovers where the **receiver** enters the amount received; a difference needs a note and is stored as a shortage (or excess) that stays on the rider ledger. A hub cannot hand over more than its cash on record. Merchant payments and expenses are requested by one person and decided by another; a merchant cannot be paid more than the COD collected for them. The daily reconciliation compares counted cash with the expected closing balance and stores the difference; the next day opens with the counted amount.
- **Parcel issues** (`parcel_issues`, `parcel_issue_events`): open from a parcel ID, assign, comment, resolve, reopen; append-only history. `ops_parcel_lookup` returns the parcel, its delivery attempts and its issues.
- **Reports** (approved records only): `ops_daily_report` by date, hub, zone, rider or merchant; `ops_rider_ledger`; `ops_cod_reconciliation`; `ops_cash_position`; `ops_hub_summary`.
- **Zonal dashboards on real data**: every approval refreshes the hub's row in `hub_daily_metrics` (new column `source` = `courier`), so `zm_hub_performance`, `zm_dashboard`, `zm_report_operations` and the workforce plan read approved courier records. Generated rows cannot be reopened for manual editing.
- 45 `ops.*` permissions with default role grants; RLS on all 13 new tables; anon gets nothing; all workflow tables are written only through audited functions (36 `ops_*` functions).

### 2. Files
```
supabase/migrations/20261111000700_courier_operations.sql
supabase/tests/80_courier_operations.sql
scripts/test-db.ps1          (Windows twin of test-db.sh)
demo/index.html              (new "Delivery & COD" screen: deliveries, rider COD, daily cash count)
```

### 3. Tests — what was and was not executed
- **Executed on this PC, 2026-11-11:** PostgreSQL 16.4 (portable EDB binaries, downloaded with the owner's permission to `C:\Users\Mizanur\pg16-portable`, outside the repo). All 7 migrations were applied to a throwaway database through the local Supabase shim, then all 8 test files were run with `scripts/test-db.ps1`:

  | File | Assertions | Result |
  |---|---|---|
  | 10_org_scope_rls | 29 | pass |
  | 20_rbac_escalation | 16 | pass |
  | 30_audit_and_lockout | 21 | pass |
  | 40_hr_lifecycle | 60 | pass |
  | 50_hr_pay_leave | 42 | pass |
  | 60_hr_import | 23 | pass |
  | 70_zonal_management (never run before) | 96 | pass |
  | 80_courier_operations (new) | 140 | pass |
  | **Total** | **427** | **0 failing files** |

  Migration 0600 needed no change. Migration 0700 and its tests passed on the first run; nothing had to be fixed.
- **Run it again:** `powershell -ExecutionPolicy Bypass -File scripts\test-db.ps1 -PgBin C:\Users\Mizanur\pg16-portable\pg\pgsql\bin` (starts the private server on port 54329 if it is not running).
- **Setup detail:** this PC has no Microsoft Visual C++ runtime, which PostgreSQL needs. Three Microsoft-signed DLLs already on the PC (`vcruntime140.dll`, `vcruntime140_1.dll`, `msvcp140.dll` from `C:\Windows\System32\Microsoft-Edge-WebView`) were copied into the portable `bin` folder. Nothing was installed and no system setting was changed.
- **NOT executed:** nothing has run on a real Supabase project (only plain PostgreSQL with the shim that imitates Supabase roles and `auth.uid()`); `scripts/test-db.sh` itself (no bash here; the PowerShell script does the same steps); no load or concurrency test (two approvers at the same moment are covered by row locks and unique indexes, not by a test).
- **Not covered by a test:** handover submitted by hub staff for a rider without a login; rejecting a reconciliation or an expense; a second pickup trip being approved; pickup cash (`collection_amount` > 0) flowing into the rider ledger. The code paths exist; no assertion exercises them.
- **Demo:** the new screen was opened in the browser as Hub Manager: three tabs render with no console errors, a COD mismatch asks for a reason, the cash count refuses a difference without a note, no horizontal scroll. Other roles and the 375 px width were not re-checked for this screen.

### 4. Limitations / decisions
- **No ledger posting.** Financial rows carry `ledger_entry_id` (null = not posted). The Accounts phase should post: cash collections, confirmed handovers (shortage → receivable from the giver), approved merchant payments, approved expenses, approved reconciliations with a difference.
- **Merchant payable is a ceiling, not a statement:** COD collected on approved deliveries less approved payments. Delivery charges and returns fees are not deducted until Accounts exists.
- **Assignments do not grant login rights.** Assigning a Hub Manager records who runs the hub; the role is still given in `user_roles`.
- Pickups are quantity records (parcels, COD, cash). They are not linked parcel-by-parcel to `parcels`.
- A person may submit a given pickup once; a second pickup from the same merchant on the same day uses the next trip number.
- `hub_daily_metrics.pending_parcels` is recalculated when something is approved for that hub-day, not when a parcel is booked. `working_hours` is not known to this module (0 on generated rows), so the planning rule on rider hours stays silent for them. A manually entered row for the same hub-day is replaced by the generated one.
- Entries can be back-dated up to `ops.backdate_days` (default 3).
- Out of scope as agreed: loan / savings, GIS maps, route planning. Not built: merchant login, customer SMS, bulk parcel import, bank deposit slips.
- The demo screens still use sample data; they are not connected to the database (there is no frontend build yet).
---

## Approved production direction — 2026-11-13

Owner selected **React + Supabase** and a **phased release**. The first public release is scoped to HR & Management; Accounts and live Courier workflows are deferred to later releases.

- Added `docs/PRODUCTION_ROADMAP.md` with the approved architecture, Release 1 scope, release gates, blockers and immediate tasks.
- Added `web/` initial React + TypeScript + Vite + Supabase scaffold: Supabase client, Auth session provider, `my_permissions()` loader, protected routes, staff login and a basic dashboard shell.
- Updated `README.md` to distinguish the non-production HTML demo from the React app and clarify the go-live status.
- Frontend dependencies have not been installed in this environment; typecheck/build and real Supabase connection are therefore not yet verified.
- No production deployment is approved. The documented 427 SQL assertions are local PostgreSQL + Supabase-shim tests, not real Supabase verification.

## Daily Accounts (আজকের হিসাব খাতা) — 2026-11-13
- Done: migration `20261113000800_daily_accounts.sql` (8 tables, RPC API, RLS, audit, storage bucket `da-evidence`), React pages under `web/src/pages/accounts/` (dashboard, sheet, my accounts, reports, settings), OCR helper (Tesseract.js), Excel/PDF/print export. Details: `docs/DAILY_ACCOUNTS.md`.
- Tests: `scripts/test-db.sh` → 517 assertions pass (427 existing + 90 new in `supabase/tests/90_daily_accounts.sql`). Browser flow tested end to end against local PostgreSQL (start → riders → merchant payment match → expense + bill → submit → correction → resubmit → approve → reports/Excel).
- Not tested here: real Supabase project, storage policies, Tesseract OCR (CDN unreachable), `npm install`/`npm run build`.
- Limits: no ledger posting yet; "Add Note" keeps the sheet pending; riders view only their own lines.

## Audit fixes — 2026-11-13
- Full review: `docs/AUDIT.md`.
- Time zone: migration `20261113000900_business_timezone.sql` sets the database time zone to Asia/Dhaka (Supabase defaults to UTC, which made "today" the previous day between 00:00 and 05:59 Dhaka time in 45 rules). Adds `system.timezone` setting and `system_timezone_ok()` health check.
- Tests: runners now create the test database in UTC (like Supabase); new `95_business_timezone.sql` (9 assertions). Total 526 assertions, 0 failing. Verified the new test fails when the migration is removed.
- Version control: `save-to-git.bat` + `scripts/setup-git.ps1` (first run creates the repository; refuses `.env`/secret keys; optional private GitHub copy). `.gitattributes` added; demo backups ignored.

## Supabase dev project — 2026-11-13
- Project `xzm-team-erp-dev` (ref ndgnhvbpmtxrpplgsslz, ap-southeast-1, free). All migrations applied (combined `supabase/apply-all-dev.sql` via SQL editor, then 0010/0011 via MCP); `supabase_migrations.schema_migrations` lists every version so `supabase db push` will skip them.
- New migrations: `20261113001000_function_search_path.sql` (Security Advisor lint 0011, 15 functions) and `20261113001100_foreign_key_indexes.sql` (Performance Advisor lint 0001, 59 indexes). Local suite still 526/526.
- Live checks: 59 tables all with RLS; anon cannot read employees or call RPCs; a signed-in user without roles sees nothing and cannot start a sheet; time zone Asia/Dhaka; storage buckets private.
- Remaining advisor items: 23 policies should wrap `auth.uid()` in `(select ...)` for speed.

## Live on Netlify — 2026-11-13
- Site: https://xzm-team-erp.netlify.app (Netlify project `xzm-team-erp`, team XZM-TEAM, free). Built by Netlify from `netlify.toml` (base `web`, publish `dist`, SPA redirect, security headers). Env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set in Netlify.
- Visitor access: production open; deploy previews/branch deploys need Netlify team login.
- Checked live: login page loads with no console errors, Supabase configured, protected routes redirect to login, mobile layout OK. One Super Admin exists in Supabase.
- To redeploy: get a fresh deploy command (Netlify connector) or connect a Git repo for automatic deploys.

## Login lockout + HR & staff pages — 2026-11-13
- Lockout: Edge Function `auth-login` (deployed, verify_jwt off) counts failed passwords via `record_login_attempt` (5 → 30 min lock) and refuses locked/inactive accounts before checking the password. Migration `20261113001200_login_lockout_hook.sql` adds `custom_access_token_hook` (Auth refuses sessions for locked/inactive/archived accounts even via the direct Auth API) and `login_lock_state`. **Enable once:** Supabase → Authentication → Hooks → Customize Access Token → `public.custom_access_token_hook`. Web login now goes through the function with Bangla messages for wrong password / locked / inactive.
- Employee IDs: `20261113001300_numeric_employee_ids.sql` — numbers from 1 (old XZ-1234 still valid); `hr_next_employee_code()` suggests the next free number on approval.
- `20261113001400_first_employee_manager.sql` — reporting manager required only once the zone has an active employee.
- React: common app frame with grouped side menu (`components/AppShell.tsx`); pages: Organisation setup (organization, zones, hubs, departments, positions; archive with reason), HR dashboard, Employees list, Employee profile (draft application form with sensitive data, salary proposal, document upload; HR review: approve with ID / return / reject; details, NID reveal with reason, edit, transfer/promotion, status change, archive, history, leave balance), ID applications list, Attendance (daily marking with correction note, monthly summary), Leave (request, approve/reject, cancel).
- Tests: 551 SQL assertions pass (new 96 lockout hook 14, 97 numeric IDs 9, 98 first-employee manager 2). Browser E2E (harness against local PostgreSQL as real users): org setup → application → documents → submit → HR approves with ID 1 → reveal NID → attendance + correction → monthly summary → leave request; leave approval correctly refused because attendance was already marked.
- Not yet: salary sheets UI, staff login creation/role assignment UI, documents verification UI, bulk import UI, zonal/courier pages.

## Design like the demo — 2026-11-13
- `web/src/theme.css`: the demo's colour system with light/dark mode (follows the device, or the user's choice), cards with icons, badges, tables, buttons.
- `components/Icon.tsx` (demo icon set), `components/AppShell.tsx` (icon side menu with collapsible groups, counts and menu search; top bar with employee search, notifications of waiting work, বাংলা/English switch, dark/light switch, profile menu; "acting as" scope bar), `components/PublicTop.tsx`, `components/DataTable.tsx` (S/L, mark/unmark rows, print, Excel, PDF of all or marked rows), `lib/prefs.tsx` (language + theme, remembered on the device).
- New public home page at `/` (like the demo), redesigned staff login (show/hide password, language/theme).
- Lists using the new table tools: employees, ID applications, leave, monthly attendance, zones/hubs/departments/positions.
- English switch covers the frame, home, login and dashboard; inner page text is still Bangla (to be translated page by page).

## Staff login accounts & roles — 2026-11-13
- Migration `20261113001500_user_admin.sql`: `profiles.must_change_password` (an account with a temporary password holds no permissions until it sets its own); account functions `user_admin_list / assignable_roles / unlinked_employees / precheck / finish_create / note_reset / set_status / unlock / assign_role / revoke_role`. An admin may manage an account only if they could grant every role it holds (nobody but a Super Admin can reset, disable or strip a Super Admin). Super Admin only company-wide; the last active Super Admin cannot be removed or disabled. Account status fields on `profiles` follow the same rule even for direct table writes.
- Edge Function `admin-users` (deploy with verify_jwt off; it checks the caller's token itself): `create` (auth user with temporary password + first role + optional employee link), `reset_password`, `change_password` (own). Every permission check runs in the database as the calling admin; the service key is used only for the Auth admin calls.
- Web: menu "সিস্টেম → ইউজার ও রোল" (`/app/users`): list with search/status filter and print/Excel/PDF; new account form (optional employee, place = whole company / zone / hub, role list limited to what you may grant, generated temporary password shown once with copy); user page (`/app/users/:id`): status, add role (optional end date), remove role with reason, disable/enable with reason, unlock, reset password, sign-in history. `/app/password`: own password change; forced screen while the password is temporary. Profile menu has "পাসওয়ার্ড বদলান".
- Tests: 594 SQL assertions (new `99_user_admin.sql`, 43). Browser E2E: create rider at a hub → add/duplicate/remove role → disable/enable → reset password → new user is held on the change-password screen until a strong password is set → HR manager sees the list read-only.

## Android app (Capacitor) — 2026-11-13
- Capacitor 7 added to `web/` (`capacitor.config.json`, app id `com.xzmteam.erp`), app icon/splash sources in `web/assets/`, `src/lib/native.ts` (back button: dialog → menu → previous page → background), app starts at staff login, safe-area padding for edge-to-edge phones.
- `make-android.bat` builds a debug APK on the PC (needs Node.js + Android Studio). See `docs/ANDROID.md`.
- Edge Functions `auth-login` and `admin-users` now allow the app origin `https://localhost` — auth-login must be redeployed for the app to sign in.
- Checked in a simulated app shell: start → login → dashboard; back button closes dialog/menu, goes back, minimises on the dashboard.
