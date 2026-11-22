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

## Expense vouchers (setting `da.voucher`)
An expense with no bill gets the company's own voucher (`da_make_voucher`; automatically when one's part is closed and at submit while `auto_on_submit` is on).
The number follows `da.voucher`: prefix, date part, digits, restart (never / monthly / daily), one count or per hub (then the hub code is in the number).
Default `V-YYMM-00001` from `da_voucher_seq`. Restarting or per-hub counts live in `da_voucher_counters`; a number that already exists is skipped.
Bills at or above `da.bill_upload.required_over` must be uploaded; below it the voucher stands for the bill. The accounts centre's "রিপোর্টের ছবি"
draws the day as one PNG with each expense marked as bill photo / auto voucher / missing (`web/src/lib/reportImage.ts`).
