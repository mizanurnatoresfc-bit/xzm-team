# Accounts Management → Daily Accounts (আজকের হিসাব খাতা)

Migration `supabase/migrations/20261113000800_daily_accounts.sql` · tests `supabase/tests/90_daily_accounts.sql` ·
React pages `web/src/pages/accounts/*` · API wrapper `web/src/lib/dailyAccounts.ts`.

## How it fits the existing system
- Uses the existing `hubs`, `zones`, `employees` (Employee ID = `employee_code`), `merchants` and `merchant_payments`. No employee, hub or merchant is created or copied.
- "API" = PostgreSQL functions exposed by Supabase (PostgREST RPC). There is no separate Node.js server in this project; every permission check runs in the database, so the UI cannot skip it.
- Same patterns as earlier modules: RLS on every table, writes only through `security definer` functions, `stamp_row` + `audit_row('da')` + `prevent_delete` triggers, maker ≠ checker, record numbers (`no`) starting at 1.
- Nothing is posted to a ledger yet (`da_sessions.ledger_entry_id` is the hook for the Accounts ledger).

## Tables
| Table | Purpose |
|---|---|
| `da_sessions` | One sheet per hub per date (unique). Status `open → submitted → correction → submitted … → approved`. Stores who started / submitted / verified (ID, name, time). |
| `da_rider_lines` | Rider-wise delivery, pickup, amount, paid, due, mobile banking, remarks. One line per rider per sheet. Removed lines are kept with a reason. |
| `da_merchant_payments` | Merchant cash payments: Payment ID (matched to `merchant_payments.payment_no`), Transaction ID (unique), amount, date, screenshot, OCR values + confirmation. |
| `da_expenses` | Transport and hub-employee expenses: employee, name, category, amount, bill date/no, reference (unique per hub), bill file, paid by, OCR values + confirmation. |
| `da_events` | Append-only history; submit / resubmit / approve keep a full snapshot (old vs new values). |
| `da_page_visits` | Entry, last activity, exit and time spent on the sheet page. |
| `da_hub_accountants` | Accounts Manager assignment per hub (revoked, never deleted). |
| `da_expense_templates` | Expense name, category, reference prefix, OCR keywords, memo template. |

## Functions (API)
Start & tracking: `da_start_session`, `da_page_enter`, `da_page_ping` · look-ups: `da_my_hubs`, `da_lookup_employee`, `da_hub_employees`, `da_lookup_merchant`, `da_match_payment` · lines: `da_save_rider_line`, `da_save_merchant_payment`, `da_save_expense`, `da_remove_line` · workflow: `da_submit`, `da_reopen`, `da_verify(approve|correction|note)` · reading: `da_sheet`, `da_event_snapshot`, `da_list_sessions`, `da_dashboard`, `da_my_accounts`, `da_report(hub_daily|rider|employee_expense|merchant_payment|transport_expense|verification|pending|corrections)` · settings: `da_settings`, `da_configure`, `da_save_template`, `da_assign_accountant`, `da_revoke_accountant`, `da_hub_access`, `da_verifier_candidates`.

## Rules enforced in the database
- Start: needs `da.sheet.create` for the hub; date not in the future and within `da.backdate_days`; not before `da.start_time` (Asia/Dhaka); one sheet per hub-date.
- Lines: employee must be active and belong to / ride for the hub; no duplicate rider; no negative numbers; duplicate Transaction ID and duplicate expense reference are rejected.
- Due: `da.due_rule` = `manual` or `amount_minus_paid`. Mobile banking (`da.mobile_banking_rule`) is `separate` by default and never changes the due unless the rule is changed.
- Submit: sheet not empty; every OCR-filled row confirmed by a person; expenses ≥ `required_over` need a bill; submitted once (status + row lock). After submit only `da.correction.edit` can reopen. Approved = final.
- Verify: needs `da.sheet.approve`; the starter or submitter cannot verify; with `da.require_assignment` only the assigned Accounts Manager can.
- Scope: a hub manager sees only own hub; a rider sees only own line (and own expenses / payments) and My Accounts.

## Permissions (default)
`da.sheet.view|create|approve`, `da.correction.edit`, `da.report.view|export|print`, `da.settings.configure`.
Hub Manager: view, create, report view/print · Accountant: view, create, reports · Accounts Manager: view, approve, correction, reports, settings · Zonal Manager: view, correction, reports · Head Office / Operations / Auditor: view + reports · Admin: all. Super Admin can change these per role.

## OCR
Tesseract.js in the browser (loaded from cdn.jsdelivr.net on first use). It reads Payment ID / Transaction ID / amount / date from payment screenshots and name / bill no / reference / amount / date / category (via template keywords) from bills. Values only fill the form; the user must tick “checked” and the database refuses to submit unchecked OCR rows. Handwriting and blurry photos read poorly.

## Storage
Private bucket `da-evidence`, path `da/<session_id>/<uuid>-<file>`; read = can see the sheet, upload = can edit the sheet. Created by the migration only on Supabase (storage schema).

## ডেইলি রিপোর্ট ইম্পোর্ট (step 1, 16 Nov 2026)
Page `/app/accounts/report-import` (`web/src/pages/accounts/ReportImport.tsx`) · migration `20261116000800_report_import.sql` · tests `supabase/tests/99zzzzz_report_import.sql` and `web/tests/reportParser.test.mjs` (`npm run test:parser`).

The whole text of the courier panel's "Update Report" page is pasted. `web/src/lib/reportParser.ts` (pure functions) reads the report ID, manager ID and name, date-time, Collected, delivery charge, declared lists / parcels and every list (8-digit list ID, rider ID, name, parcels, money) — with line breaks, tabs or as one line. `da_import_save` then checks again and saves.

- **Three checks or nothing:** lists' money + delivery charge = Collected; lists' parcels = declared; number of lists = declared. The page keeps the save button off and the database refuses too.
- **Same report ID again = update** (`da_import_reports.report_no` unique, `upload_count` goes up). The pasted text is kept in `raw_text`.
- **A list ID in two reports counts once:** the newest report's row (`private.da_import_counted`).
- **Khata = manager ID in the report + the date picked at upload** (the field starts at today; the page offers the report's own date when they differ). Who uploaded does not matter.
- **Riders by ID:** `employees.employee_code` is the courier panel ID; an ID the system does not know shows "অচেনা" and is mapped with one tap (`da_import_rider_map`, `da_import_map_rider`).
- Each rider is one row with the day's sum (tap for the lists); Point delivery and the delivery charge are rows of their own.
- Permission `da.import.create` (admin, accounts manager, accountant, zonal manager, hub manager), scoped by zone / hub like the rest; `da.sheet.view` reads.
- Shown on: the home card "রিপোর্ট আপলোড" (today's count), the menu, and the zonal dashboard tab "আজকের রিপোর্ট" (every hub's status, `da_import_status`).
- Not connected to `da_sessions` / `da_rider_lines` yet (the hub's own sheet is untouched). Not done on purpose: courier-panel login / scraping, parcel data, reading images, red marks, bank suggestion, share page.
