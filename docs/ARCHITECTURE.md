# XZM-TEAM — Management + Accounts ERP: Architecture

Status: **Phase 0 draft — awaiting approval.** Decisions marked _(default)_ were taken as sensible professional defaults and can be changed; decisions marked **[NEEDS APPROVAL]** affect security, money or irreversible data and must be confirmed.

---

## 1. Guiding principles

1. **The database is the security boundary.** Every rule that protects data or money (scope, permissions, balance, immutability, no-delete) is enforced in PostgreSQL by constraints, triggers and Row Level Security. The React UI only *reflects* permissions; hiding a button is never the protection.
2. **Nothing important is deleted.** Records are archived (`archived_at`, `archived_by`, `archive_reason`); posted money is corrected by reversal entries; role assignments are revoked, not removed.
3. **Everything important is audited** by a generic database trigger, so no code path (UI, Edge Function, SQL editor) can skip the audit log. The log itself is append-only, even for the database owner.
4. **Machines suggest, people decide.** OCR, AI and import tools only produce *proposals*; a permitted person verifies and approves before anything is posted, paid or activated.
5. **Secrets stay server-side.** The browser only ever holds the Supabase URL and the public *anon* key. Service-role, OCR and AI keys live in Supabase Edge Function secrets.

## 2. System overview

```
 Browser (React SPA, en/bn)                          Supabase
 ┌──────────────────────────┐   HTTPS + user JWT   ┌──────────────────────────────────────┐
 │ Public site  /           │ ───────────────────▶ │ PostgREST (auto REST API)            │
 │ Staff login  /staff/login│                      │   └─ RLS on every table              │
 │ Admin login  /secure-... │                      │ PostgreSQL                           │
 │ App          /app/*      │                      │   ├─ tables, constraints, triggers   │
 │  - TanStack Query cache  │                      │   ├─ RPC functions (workflows,       │
 │  - RHF + Zod forms       │                      │   │   posting, approvals)            │
 │  - permission-aware UI   │                      │   └─ audit_logs (append-only)        │
 └──────────────────────────┘                      │ Auth  (email+password, reset, JWT)   │
                │                                  │ Storage (private buckets + policies) │
                └──── login / OCR / AI / ZIP ────▶ │ Edge Functions (Deno, hold secrets)  │
                                                   └──────────────────────────────────────┘
```

### Technology stack _(default — matches the brief)_

| Layer | Choice |
|---|---|
| UI | React + TypeScript + Vite, Tailwind CSS, shadcn/ui, Lucide icons |
| Data fetching | TanStack Query (cache, retries, loading/error states) |
| Forms | React Hook Form + Zod (same schema validates client side; DB re-validates) |
| Charts | Recharts |
| i18n | i18next / react-i18next with `en.json`, `bn.json`; master data has `name_bn` columns |
| Excel | SheetJS (parse in browser for preview → validated by DB RPC on import) |
| PDF | Server-side for official documents (vouchers, reports) so output is identical everywhere; client-side preview |
| ZIP | Edge Function streams the monthly Head Office package |
| Backend | Supabase: PostgreSQL 15+, Auth, Storage, RLS, Edge Functions |
| Tests | SQL tests for DB/RLS (working now), Vitest + Testing Library (UI), Playwright (end-to-end, per role) |

Exact package versions will be pinned when the frontend is scaffolded with a working package registry (see §11).

## 3. Routing and login

| Route | Who | Notes |
|---|---|---|
| `/` | Public | Branding, company intro, feature cards, **Staff Login** link only. No admin link anywhere. |
| `/staff/login` | Staff | Redirects to the dashboard matching the user's roles. |
| `/secure-control` | Admins | Not linked publicly. Access is decided by the **`system.admin_portal.view`** permission checked in the database, not by knowing the URL. |
| `/app/*` | Signed-in users | Every page declares the permission it needs; the API enforces it again. |

**Login flow (lockout-aware).** The browser calls an Edge Function `auth-login`, which: checks `profiles.locked_until` → calls Supabase Auth → records the attempt with `record_login_attempt()` (only callable with the service role) → returns the session or a generic error. After *N* failures (configurable, default 5) the account is locked for *M* minutes (default 30). Locked or inactive users receive **no data** from any table even with a still-valid token, because `private.my_grants()` ignores them. Password reset uses Supabase Auth's secure email flow (needs SMTP — see CREDENTIALS).

## 4. Organisation and data scope

```
Company (organizations) ── Head Office = company-wide ("global") scope
  └─ Zones
       └─ Hubs
Departments, Positions = company-wide reference lists
Employees (Phase 2) ── position, department, zone, hub(s), reporting manager — all with history tables
```

**Permission model.** A permission is `module.resource.action` (e.g. `org.hub.edit`, `acc.journal.approve`) with the 11 actions from the brief (view, create, edit, archive, delete, approve, reject, export, print, share, configure). Roles bundle permissions. A **role assignment** (`user_roles`) always carries a **scope**:

| scope_type | Meaning |
|---|---|
| `global` | whole company / Head Office |
| `zone` | one zone and every hub in it |
| `hub` | one hub only |

A user can hold many assignments (several roles, several hubs). Assignments have `valid_from`/`valid_to`, are revoked rather than deleted, and overlapping duplicates are rejected by an exclusion constraint.

`private.has_permission(code, zone, hub)` is the single function every RLS policy uses. "Assigned-record access" (e.g. a parcel problem assigned to me) is added per module as an extra policy branch: `… or assigned_to = auth.uid()`.

**Anti-escalation rules (enforced in DB, tested):** only a Super Admin can change what a role contains or grant a super role; anyone else may only grant a role whose every permission they themselves hold at that scope; nobody can change their own account status or lockout counters; system roles cannot be archived.

## 5. Module map and table groups

| Phase | Module | Main tables (indicative) |
|---|---|---|
| 1 | Foundation ✅ DB done | `organizations, zones, hubs, departments, positions, profiles, roles, permissions, role_permissions, user_roles, system_settings, audit_logs, login_events` |
| 2 | HR | `employees, employee_applications, employee_assignments (hub/zone/position history), employee_transfers, employee_documents, employee_custom_fields, employee_custom_field_values, salary_structures, employee_compensation_history, import_batches, import_rows` |
| 3 | Hubs & courier ops | `riders, merchants, parcels, pickup_submissions, pickup_submission_items, delivery_reports, rider_daily_records, cash_collections, cash_handovers, merchant_payments, operational_expenses` |
| 4 | Accounts | `accounting_periods, chart_of_accounts, journal_entries, journal_entry_lines, vouchers, voucher_templates, document_sequences, bank_accounts, bank_slips, bank_reconciliations, expense_claims, payroll_runs, payroll_lines` |
| 5 | Communication & problems | `notices, notice_recipients, notice_reads, notifications, parcel_problems, problem_assignments, problem_comments, problem_call_logs, hub_cc_reports, report_cc_recipients, report_history, escalation_rules` |
| 6 | Reports & documents | `documents, document_versions, document_categories, report_exports, hq_packages` |
| 6 | Tasks | `tasks, task_assignments, task_comments, task_followups` |
| 7 | AI & analytics | `ai_requests` (prompt, sources cited, user) — no new authority |

Every table gets: UUID primary key, foreign keys, indexes on scope columns, `created_at/by`, `updated_at/by`, status check constraint, archive fields where relevant, the audit trigger and the no-delete trigger.

## 6. Accounts design (double-entry)

* **Ledger:** `journal_entries` (header: reference, date, period, status, created/approved/posted by & time, source document) and `journal_entry_lines` (account, debit, credit, hub/zone tags, description). Amounts are `numeric(18,2)`; a line has *either* debit *or* credit, never both, never negative.
* **Lifecycle:** Draft → Pending Approval → Approved → **Posted** → (Reversed). Posting happens only through one database function `post_journal_entry()` which, inside a single transaction, locks the entry, checks the period is open, checks **Σ debit = Σ credit > 0**, assigns the sequential number and stamps posting time. A deferred constraint trigger re-checks balance at commit.
* **Immutability:** posted entries and their lines cannot be updated or deleted (trigger). Correction = `reverse_journal_entry(id, reason)` which creates a mirror entry linked to the original, then a new corrected entry.
* **Segregation of duties** _(default)_: the creator of an entry cannot approve it.
* **Cash management:** every cash holder (rider, hub, manager, Head Office) and bank account is a sub-ledger account under the Chart of Accounts, so all cash ledgers, balances and reconciliations are derived from the same posted journal — no parallel balance columns that can drift.
* **Cash handover:** Collected → Handover submitted → Receiver verified → Accounts approved (posts journal: Dr receiver cash / Cr giver cash) → Reconciled. Shortages post to a shortage receivable account, never silently absorbed.
* **Vouchers** are printable *views* of a journal entry with a unique number from `document_sequences` (row-locked, gap-free per type per fiscal year). A voucher is not proof of payment.
* **Periods:** monthly accounting periods; closing a period blocks posting into it (only reversal into an open period).
* **[NEEDS APPROVAL]** fiscal year (Bangladesh July–June vs calendar year) and base currency (BDT assumed).

## 7. Files and documents

* Private Storage buckets: `employee-docs`, `finance-docs`, `company-docs`, `ops-evidence`, `branding` (only `branding` is public-read).
* Path convention `{module}/{record_id}/{uuid}-{safe_filename}`; every file also has a row in `documents` (owner record, category, version, expiry, uploaded_by, checksum). Storage policies call the same `has_permission()` through that row, so file access = record access.
* Originals are kept untouched; resized/compressed copies are separate objects. Type, size and name are validated in the browser **and** in the storage policy / upload function.
* Download links are short-lived signed URLs.

## 8. OCR and AI (optional, behind configuration)

* **OCR** (salary sheets, bank slips): Edge Function calls a configured provider; the result is stored as *extracted values + confidence* on a draft. Mismatch checks (amount, date, duplicates, Employee ID/name) run in SQL. Approval requires a human and, for deposits, a bank statement/transaction confirmation. **[NEEDS DECISION]** provider (e.g. Google Cloud Vision, Azure Document Intelligence) — costs and Bangla-script accuracy differ.
* **AI assistant:** Edge Function receives the user's own JWT and queries the database **as that user**, so RLS limits what the AI can read. It can only *read* and *draft*; it has no function that posts, approves, pays or deletes. Every answer lists the source record IDs; requests are logged.

## 9. Audit and security checklist (how each brief requirement is met)

| Requirement | Mechanism | Status |
|---|---|---|
| RLS on every table | `enable row level security` + policies; anon revoked by default | ✅ tested |
| Zone/hub scoping | scoped `user_roles` + `has_permission()` | ✅ tested |
| No privilege escalation | DB guards on `user_roles`, `role_permissions`, `profiles` | ✅ tested |
| Append-only audit | trigger on every table, immutable `audit_logs` | ✅ tested |
| No hard deletes | revoked grants + `prevent_delete` trigger | ✅ tested |
| Lockout / login history | `record_login_attempt`, `login_events` | ✅ DB tested; Edge Function in Phase 1 |
| Service key never in browser | only anon key in `VITE_*` env | planned Phase 1 |
| Rate limiting | Supabase Auth limits + Edge Function per-IP limit | Phase 1 |
| Backups | Supabase PITR / daily backups + documented restore drill | Phase 8 |

## 10. Explicitly excluded

No Loan or Savings module (no login, dashboard, menu, transactions or accounts), no GIS map, no route planning, no location assignment — in navigation, database, dashboards, reports or plans.

## 11. Development environment (found in Phase 0)

* Target folder on the user's PC was empty — new project, nothing overwritten.
* Claude's build workspace has Node 22, Python 3.13 and PostgreSQL 16, **but package installation (npm) is blocked by the current network settings**, and there is no command shell on the user's PC. Consequence: database work can be built and tested now; the React app can be written but **not installed, built or tested** until package installs are allowed (see PROGRESS.md → blockers).
