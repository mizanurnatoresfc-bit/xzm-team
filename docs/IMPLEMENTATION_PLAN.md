# XZM TEAM — Implementation Plan

Each phase ends with a report in `docs/PROGRESS.md` (features, files, DB changes, tests **actually executed**, open bugs, missing credentials, next phase). A phase is "done" only when its acceptance tests run green.

Legend: ✅ done & tested · 🟡 in progress · ⬜ not started

---

## Phase 0 — Environment & architecture ✅
- Inspect environment, choose stack, write ARCHITECTURE / PLAN / CREDENTIALS docs.
- Set up DB test harness (local PostgreSQL + Supabase shim) — so every later migration ships with tests.
- **Delivered early:** foundation database (org structure, RBAC with zone/hub scope, audit, lockout) with 66 passing assertions.

## Phase 1 — Foundation
**Needs:** package installs enabled; Supabase project (URL + anon key).
- 🟢 DB: organisation, RBAC, audit, settings, login tracking (done in Phase 0).
- ⬜ Frontend scaffold: Vite + React + TS + Tailwind + shadcn/ui, design tokens (corporate green `#0F7A3D`, dark green `#0A4D27`, white, light grey), layout shell (sidebar, top bar, breadcrumbs, responsive drawer on mobile).
- ⬜ i18n en/bn with persisted choice (profile + local storage); Bangla font (Hind Siliguri / Noto Sans Bengali).
- ⬜ Public homepage (no admin link), `/staff/login`, `/secure-control`, forgot/reset password, logout, idle-session timeout.
- ⬜ Edge Function `auth-login` (lockout + login history), `admin-create-user` (invite with service role).
- ⬜ Admin screens: company & branding settings (logo/favicon upload), zones, hubs, departments, positions (create/edit/activate/archive with reason), users, roles & permission matrix, role assignment with scope, audit log viewer, login history.
- ⬜ `usePermission()` hook + `<Can>` component driven by `my_permissions()`.
- **Acceptance:** SQL tests + Vitest for permission hook + Playwright: anon cannot reach `/app`, staff without admin permission is refused at `/secure-control`, zonal manager sees only own zone, lockout after 5 failures, language persists after reload, layout at 375 / 768 / 1280 px.

## Phase 2 — HR
- Employees with history tables for position/department/zone/hub/manager/salary; Employee ID **entered by authorised HR/Admin only** (unique, format rule configurable) — never auto-generated.
- 3-step Employee ID application (identity → employment → preview/submit) → HR review → approve → ID assignment → activation.
- Lifecycle: transfer, promotion, resignation, termination, inactive, archive (all dated, reasoned, audited).
- Dynamic profile builder (field types incl. photo/document/signature/employee/hub reference; required/visible/editable/validation/order). Archived fields keep historical values.
- Documents (NID front/back, photo, CV, certificates, signature) in private storage with record-level access; NID/phone masked unless permitted.
- Excel bulk import: upload → column mapping → validation (duplicates, missing, bad dates, ID match) → preview → error report → HR verify → import. Nothing imported silently.
- Compensation configuration (salary structure, transport/commission rates, allowances, deductions, effective dates) with approval.
- **Acceptance:** application→activation e2e; HR in zone A cannot see zone B employees; import rejects bad rows with report; NID hidden from users without `hr.employee_sensitive.view`.

## Phase 3 — Hubs & courier operations
- Hub dashboard; riders; merchants; parcels (reference data for problems/reports).
- Pickup submissions from Pickup Manager / Hub Manager / Rider stored separately → duplicate & conflict detection (date + hub + merchant + parcel ref + source) → verification → conflict review → approval → consolidated official report (approved only).
- Delivery reports, rider daily records & rider ledger, COD, cash collection, cash handover workflow, merchant payments, operational expenses.
- **Acceptance:** two overlapping submissions are flagged, not summed; only approved data in consolidated report; rider ledger reconciles to handovers.

## Phase 4 — Accounts
- Accounting periods, Chart of Accounts (seeded template, editable), cash/bank sub-ledgers.
- Journal entries: draft → pending → approved → posted → reversed via DB functions only; maker ≠ checker.
- Voucher builder (types, templates, numbering, signature blocks) → PDF/print/JPG.
- Expense claims (Zonal Manager visits, fuel, meals, transport) → approval → posting. AI category *suggestions* only.
- Payroll: salary sheet → approval → payment posting; correction/reversal. Salary sheet & bank slip OCR → human verification.
- Bank reconciliation; reports: GL, trial balance, P&L, balance sheet, cash flow.
- **Acceptance:** unbalanced entry cannot post; posted entry cannot be edited/deleted; reversal nets to zero; trial balance always balances; fixture ledger produces hand-checked P&L and balance sheet.

## Phase 5 — Notices, notifications, parcel problems, Hub CC reports
- Public (company/zone/hub/department/role) and private notices, read receipts, acknowledgement, replies, attachments; notification center with categories & badge.
- Parcel problem workflow (New → … → Closed, reopen), multi-assignment, reassignment with reason, comments/evidence, duplicate-open detection, deadlines.
- Call action: `tel:` link + separate **call log** form (attempt vs confirmed outcome); phone numbers shown only to permitted users.
- Hub CC reports with unique Report ID, CC targets & permission levels, history, configurable escalation (scheduled function).
- **Acceptance:** private notice invisible to non-recipients; escalation fires on missed deadline; clicking call does not complete the call.

## Phase 6 — Reports, documents, tasks
- Report center (daily/weekly/monthly; hub/zone/employee/rider/merchant/accounts …) → PDF, Excel, CSV, print, authorised share.
- Document management (categories, expiry, versions, permissions, archive).
- Monthly Head Office package (index, reports, vouchers, slips, handovers, expenses, supporting files) as ZIP with explicit **missing-document report**.
- Tasks & reminders with escalation of overdue tasks; dashboards per role (Admin, HR, Accounts, Operations, Zonal, Hub).

## Phase 7 — AI & analytics
- Workforce analytics from real data; AI assistant (read-only, RLS-bound, cites sources, confirms before any action, never posts/approves/deletes).

## Phase 8 — QA & production
- Full RLS matrix test per role, financial validation suite, performance (indexes, query plans on 100k+ rows), accessibility pass, security review, backup/restore drill, deployment guide, admin bootstrap procedure.
- **Go-live gate:** see brief §29/§31 — no public deployment until auth, RLS, financial, data-integrity, admin-permission tests and backup verification all pass.
