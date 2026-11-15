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

## Roles, flexible import, custom fields, referrals — 2026-11-14
- `20261113001600_role_builder.sql`: `role_admin_list / save / archive`. Only a Super Admin creates roles and sets their full permission list (system roles can be re-tuned; the Super Admin role itself cannot be edited; a role in use cannot be archived). Code is derived from the English name.
- `20261113001700_flexible_import.sql`: import now needs only the columns named in `hr.import_required_fields` (default name + hub). Hub/position/department matched by code **or** name (English or Bangla); money cleaned ("12,000"); columns can target custom profile fields (`cf:<code>`) and the referrer (`reference_code`); `hr_import_missing` + `hr_import_create_missing` create unknown hubs/positions in one step; `hr_cancel_import`; Super Admin may verify their own batch (`hr.import_two_person`). `employees.referred_by_employee_id` added.
- `20261113001800_fields_and_referrals.sql`: `employee_custom_fields.zone_id` — zonal managers keep fields for their own zone (always optional, values only for that zone's employees, guarded by a trigger). Referral permissions (`hr.referral.view/edit/configure`), tables `referral_prospects` + `referral_prospect_columns` (zone-aware), and `hr_lookup_employee / hr_set_referrer / hr_referrals / hr_referrer_of / hr_referral_summary / my_employee_id`. Staff may read active position names.
- Web: `/app/roles` (permission matrix), `/app/hr/import` (Excel/CSV read in the browser with no extra library — `lib/sheetRead.ts`), `/app/hr/fields` (profile fields & prospect columns, company or zone), `/app/hr/referrals`, `/app/me` (My profile), and referral + custom-field panels on the employee profile.
- Tests: 653 SQL assertions (59 new across 99b/99c/99d). Browser E2E: build a role and use it, import 5 legacy rows incl. creating a missing hub, add company + zone fields and fill them, add a prospect, set a referrer by ID.

## Hub-wise staff, formats, zonal dashboard — 2026-11-14
- `20261113001900_formats_and_zonal.sql`:
  - `employee_formats` — a named, ordered list of columns ("format") with the company's own headings in Bangla and English, for export **and** for matching columns on import. Head Office keeps company-wide formats, a zonal manager keeps formats for their own zone (`hr.profile_field.configure`, scope-checked). One default per zone and purpose; the guard refuses an unknown or repeated column and a column with no heading. Two formats are seeded: "সাধারণ কর্মী তালিকা" (default) and "বেতনের কলাম".
  - `hr_export_rows(fields, zone, hub, status, q)` — the rows for an export. Only staff the caller may see; salary columns fill in only with `hr.compensation.view`, NID/date of birth/parents/addresses only with `hr.employee_sensitive.view` (others get blank cells), custom fields follow their own view permission, and an export that asks for private columns is written to the audit log. Up to 5,000 rows.
  - `hr_hub_staff_summary(zone)` — per hub: total, active, inactive, waiting for an ID, without an ID, with a login, and how many in each position. Counts each person once.
  - `hr_next_employee_codes(n)` — the next free numeric IDs, for giving IDs to a whole hub at once (`hr_bulk_assign_ids` was already there: all or nothing).
  - `hr_approve_application` — a Super Admin may now approve an application they submitted themselves (a one-person office could otherwise never give an ID); for everyone else the two-person rule stands. Setting: `hr.application_two_person`.
- Web: "জোনাল ম্যানেজমেন্ট → হাব অনুযায়ী কর্মী" (`/app/zonal/staff`) — hub-by-hub figures, click a hub for its staff with search and status filter, tick rows for: active/inactive, resigned/terminated, transfer to another hub (position and department kept, history written), give Employee IDs in bulk (next free numbers filled in; drafts are named and held back until their application is submitted), remove from the list. "+ নতুন কর্মী" and "ফরম্যাটে এক্সপোর্ট" on the same page, and the export button is on the employees list too.
- Formats editor: third tab on `/app/hr/fields` — create/edit/remove a format, pick and reorder columns (every staff column plus custom profile fields), set both headings, company-wide or own zone, mark default. Permission-gated columns are marked "(গোপন)" in the picker.
- `/app/hr/import` can pick a saved format and match the file's headings to it in one click.
- Tests: 690 SQL assertions (new `99e_formats_zonal.sql`, 37 — including that hub counts do not multiply when a hub uses several positions). Browser E2E (`harness/zonal_flow.py`): build a format with reordered, renamed columns → new employee → ID held back while the application is a draft → submit → bulk ID → inactive → active → transfer to the other hub (hub figures follow) → export by format (checked the .xlsx: headings and order match) → archive refused while active → resigned → archived.

## Role-based dashboard — 2026-11-14
- `20261113002000_role_dashboards.sql`: the home page is built from nine panels — my work, staff figures, waiting in HR, staff by hub, operations today, cash, daily accounts, zone overview, quick links. `role_dashboards` holds the panel list per role; a Super Admin sets it (`role_dashboard_list` / `role_dashboard_save`, the table is read-only to everyone else). All 13 shipped roles start with a fitting layout; a role with no layout falls back to whatever its permissions allow, and a panel a role has no permission for is dropped even if the layout asks for it. `dashboard_home()` returns the panels **and** their numbers in one call and is `security invoker`, so every count is read as that person under RLS — a hub manager's figures stop at their hub.
- Web: `pages/Dashboard.tsx` rewritten around the panels (stat tiles, waiting-work rows that link straight to the page, hub table); `/app/role-dashboards` (সিস্টেম → রোল অনুযায়ী ড্যাশবোর্ড) lets the Super Admin tick and order the panels for each role; `lib/dashboard.ts` holds the API and the panel labels.
- Tests: 723 SQL assertions (new `99f_role_dashboards.sql`, 33). Browser E2E (`harness/dashboard_flow.py`): super admin / HR / hub manager / rider each land on a different dashboard, the Super Admin changes the rider layout and the rider sees it, a panel the rider has no permission for stays hidden, and an HR manager is refused the settings page.

## Payment screenshot, expense voucher, categories handbook — 2026-11-14
- `20261113002100_expense_categories_voucher.sql`:
  - **Categories handbook** — `da.expense_categories` now carries the company's own 24 categories (the EXPENSE-CATEGORY handbook): what belongs in each in Bangla, and what to do with it on the main site — its category there, the sub-head, the limit, whether a receipt is needed, or a line saying it does not go to the main site at all. The codes older sheets already used (`transport`, `fuel`, `meal`, `office`, `repair`, `utilities`, `conveyance`, `other`) were kept, so nothing written before stops resolving. Head Office edits every line of it in Accounts settings.
  - **Expense voucher** — `da_make_voucher(expense)` gives a numbered voucher (`V-YYMM-00001`) to an expense whose shop or payee gave no bill; an expense that already has a bill or a bill number is refused, asking twice returns the same number, and only someone who may edit the sheet can make one. `da_voucher(expense)` returns everything the printed voucher shows, read as the person themselves.
  - **Payment by ID** — `da_save_merchant_payment` now takes the merchant as optional: with a Payment ID the hub already has a record for, the merchant, the payee and the date come from that record, so the only things typed by hand are the Payment ID and the amount. A Payment ID with no record still asks for the merchant. The name read from the screenshot is kept in `da_merchant_payments.payee_name`.
- Web: the payment screenshot reader (`lib/ocr.ts`) now reads the main site's payment page — `Payment SFC-33223762`, `৳40,598.00`, `transaction #52655971`, who took the cash, who paid it, which account it was booked from, and the **paid** date rather than the created date; wallet slips (bKash/Nagad/Rocket) still parse as before. The merchant payment form was rebuilt around it: screenshot first, then Payment ID and টাকা, with everything else behind "আরও তথ্য"; the expense form shows the handbook note and the main-site line under the category, and warns when the amount is over that category's limit; the expense list has a ভাউচার column that makes and prints the voucher (office copy + payee copy, amount in words, signature lines).
- Tests: 744 SQL assertions (new `99g_payment_voucher.sql`, 21). Browser E2E (`harness/payment_flow.py`): a payment written from the Payment ID and amount alone comes out matched with the merchant filled in; an unknown Payment ID is refused in Bangla until a merchant is picked; the category help and the over-limit warning show; a voucher is made, printed and recorded.

## Branding a person can change, and the pages reworded — 2026-11-14
- The public pages now say what this is in the owner's own words: **a personal tool, built for his own work**, not any company's official system and not a service for anyone outside. Home page, terms and login all carry that wording.
- `20261113002200_branding.sql`: name (English and Bangla), short mark, one-line description, logo, tab icon, tab title and the two theme colours live in `system_settings` under `branding.*`, readable by anyone (the login page needs them before sign-in) and writable only with `system.settings.configure`. `branding()` returns them in one read for anon and authenticated; `branding_save(jsonb)` writes the allowed keys only.
  - Pictures are kept as data URLs, capped at 256 KB, and a trigger refuses anything that is not an SVG/PNG/JPEG/WebP data URL or that carries `<script`, `javascript:`, an `on…=` handler or a `<foreignObject>`. The web app always shows them through an `<img>`, never as markup, so a picture cannot run anything either way.
- Web: `lib/branding.ts` (read once per page, shared by every component, applies the tab title, the tab icon and `--primary`), `components/Brand.tsx` (the mark and the name), and the Super Admin page **সিস্টেম → নাম, লোগো ও রঙ** (`/app/branding`) with live previews at 96/32/16 px, upload for the logo and the tab icon, a "draw one from the letters" button, and the two colours. Saving changes the sidebar, the login page and the browser tab at once.
- A default mark ships with it: a rounded green square with a white X, kept as an SVG data URL and as `web/public/logo.svg` for the very first paint.
- Tests: 760 SQL assertions (new `99h_branding.sql`, 16 — readable before sign-in, only the right person may write, and every bad picture refused). Browser flow: renaming in the settings page changes the sidebar, the login page and the tab title straight away.

## One-page sheet, own bills, vehicles and presets — 2026-11-14
Built from the owner's own list for the accounts module.

- **One page, like a spreadsheet.** The sheet no longer hides sections behind tabs: riders → merchant payments → expenses → staff bills → the day's closing, one after the other, with a jump bar that sticks to the top, column headers that stay while the rows scroll, and a totals row that stays at the bottom of each table. The rider section shows **"এখনো হিসাব বাকি: N জন"** and names the active riders of that hub whose line has not been written yet.
- **`20261113002300_vehicles_and_presets.sql`** — `vehicles` and `vehicle_assignments`: a vehicle belongs to a hub and is held by one person at a time (one open assignment per vehicle, enforced by a unique index). An expense can name the vehicle it was for, and `da_my_vehicles()` puts it on the holder's own page: what it was for, which category, how much, and what was spent in the last 30 days. `da_expenses` also carries the reference person — name, mobile and position beside the reference number — and `da.reference_people` keeps the ones used again and again, so the expense form fills them in from a dropdown in one click.
- **`20261113002400_expense_claims.sql`** — `da_expense_claims`: a person adds what they spent from "আমার হিসাব" with the bill, the vehicle and the reference person; it waits as a claim. The hub's sheet lists the claims of that hub, and the manager takes one in with one click (`da_claim_add`) — it becomes an ordinary expense line carrying the claim's file, and the claim is marked taken in, so the same bill cannot go in twice. Turning one down needs a reason. Claim files live under `claims/<employee id>/…`, readable by the owner and by that hub's accounts people.
- A sheet that carries a line **in your name** is now a sheet you may see (`da_sessions_read`), so an expense a manager took in shows on that person's own page — it did not before, and "আমার খরচ" came back empty.
- Tests: 794 SQL assertions (new `99i_vehicles_claims.sql`). Browser flow (`harness/claims_flow.py`): save a reference person → hand a van to a rider → the rider submits a fuel bill against that van with the reference filled in from the preset → the manager takes it into the day's sheet → it shows in the expenses, in the closing box, on the rider's "আমার খরচ" and under his vehicle.

## The day's sheet made easier to keep — 2026-11-14
Built from the owner's own nine-point list.

- **Tabs are back, and each one is short.** রাইডার · পেমেন্ট · খরচ · জমা বিল · নোট · দিন শেষ, each with its count on it, the bar sticking under the page header. The one-page order from yesterday is kept inside each tab, so nothing moved — only the amount on the screen at once.
- **A payment needs the ID and the amount, nothing else.** `101001`, `sfc-101001` and ` 10 1001 ` all become **SFC-101001** (`private.da_payment_ref`, prefix from `da.payment_id_prefix`). Nothing has to match a record: with no merchant and no payee the payment is written under its own ID, and when this hub does happen to have a record for that ID the merchant, the date and the match are filled in by themselves. The screenshot reader still fills the form; the same Payment ID cannot be written twice on one sheet.
- **An expense in four boxes** — খরচের নাম · টাকা · কার খরচ (Employee ID) · খাত, with the reference preset and the reference name beside them; the bill number, the date, the vehicle, who paid and the rest sit behind **আরও তথ্য**.
- **Two accounts for one rider** are allowed (`da.double_rider_lines`); turning the setting off puts the old one-line rule back.
- **Who is keeping this sheet.** Writing any line puts you on the sheet's list (`da_sheet_collectors`). The strip under the tables shows each person, what they have written, how much, and who has not finished — **"বাকি ২ জন"**. Each closes their own part (`da_close_my_part`), with a note if they want, and can take it back.
- **Closing the day** (`da_close_day`) keeps the three totals with the sheet — মোট হিসাব, মোট পেমেন্ট, মোট খরচ, plus what came in on notes, what was collected and what is still due. `da.close_needs_all` can make it wait until everyone has closed their own part; reopening needs a reason.
- **Cash notes** (`da_cash_notes`): this money came from this staff member, by cash or bKash/Nagad/Rocket/bank, with a note. The person it came from sees it on their own page under **"আমি যা জমা দিয়েছি"** (`da_my_handovers`), and so do the hub's accounts people — nobody else.
- **A bill taken in shows the sheet's date** (`da.claim_date_source = 'sheet'`); the bill's own date is kept in the remarks as "বিলের তারিখ DD/MM/YYYY".
- **Fixed riders and fixed expenses** (`da.fixed_riders`, `da.fixed_expenses`) go onto every new sheet as it is started (`da_apply_fixed`, called by `da_start_session`); asking twice adds nothing twice, and both lists are edited in Accounts settings along with the payment prefix, the double-line switch, the claim-date rule and the close rule.
- Tests: **826 SQL assertions** (new `99j_sheet_made_easy.sql`; `90`, `99g` updated where the old rules changed). Browser flow (`harness/easy_flow.py`): the six tabs → a payment typed as `101001` comes out SFC-101001 → an expense in the four front boxes → a second hisab for the same rider → the collectors strip → a cash note → the day closed with its totals.

## 2026-11-15 — ইস্যু / ফলো-আপ ও হাব গ্রুপ (Nodi AI ধাপ ১)
- Migration `20261115001000_hub_issues.sql`: `issues` (IS-00001; open → in_progress → solved → approved / cancelled), `issue_events` (log), `hub_posts`
  (hub group; `author_profile` null = নদী AI), `hub_post_reactions` (👍 ❤️ 😮 😢 ✅ 🙏, one per person per emoji), `hub_post_seen`. Private bucket `issue-photos` (`<hub_id>/<file>`).
  Perms `issue.issue.view/create/approve`, `issue.group.view`. A hub group is readable by people posted at the hub and by anyone whose permission reaches it (`private.in_hub_group`).
- **Rule:** an issue leaves the assignee's panel when solved, but stays on the GIVER's panel ("চেক বাকি") until the giver approves; "ফেরত" (reopen, reason required) sends it back.
  Assignee cannot approve their own work. All writes are RPCs: `issue_create` (parcel ID → the parcel's rider is chosen and marked "নদী AI বেছেছে"), `issue_assign`,
  `issue_act(start|solve|approve|reopen|cancel)`, `hub_post_create/react`, `hub_posts_seen`, `hub_feed`, `hub_post_seen_by/reacted_by`, `issue_panels`, `issue_detail`.
- `issue_nudge_due(hours)` — নদী AI follow-up: posts a reminder in the hub group and notifies the assignee (or the giver, for a solved-but-unchecked issue). Service role only;
  **not scheduled yet** (needs an Edge Function / cron call).
- Page `/app/issues` (pages/issues/Issues.tsx, lib/issues.ts): tabs আমার কাজ · চেক বাকি · আমি দিয়েছি · হাব গ্রুপ · হাবের সব ইস্যু; new issue (parcel ID / photo / person), detail with history.
- Tests: 42 new assertions (`99l_hub_issues.sql`). The local shim now has a minimal `storage` schema (older migrations needed it). `99f_role_dashboards` already fails
  ("nine panels exist") since the dashboard-views migration — not touched here.
- **Not built yet (next):** নদী AI avatar + voice/multi-command (Claude API through an Edge Function), training centre, reading a parcel ID from a photo, scheduling the follow-up.

## 2026-11-15 — নদী AI: API ব্যবস্থাপনা
- Migration `20261115001100_nodi_ai.sql`: perms `nodi.assistant.view` / `nodi.settings.configure`; settings `nodi.enabled/model/daily_limit/max_tokens`; `nodi_usage` log;
  `nodi_gate()` (permission in any scope + on/off + daily limit, as the caller), `nodi_log()` (service role only), `nodi_settings/configure/usage_summary` (admin).
- Edge Function `supabase/functions/nodi-ai` (verify_jwt off, token checked inside): actions `status` and `chat`. The Anthropic key exists ONLY as the function secret `ANTHROPIC_API_KEY`.
- Page `/app/nodi` (pages/users/NodiSettings.tsx): key present or not, on/off, model, daily limit, answer length, test box, usage table.
- Tests: 12 new assertions (`99m_nodi_ai.sql`). **Not applied to the live project and the function is not deployed yet.**
