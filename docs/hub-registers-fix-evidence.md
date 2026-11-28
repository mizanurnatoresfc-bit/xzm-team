# Hub Registers — QA fix pack test evidence

**Date:** 2026-11-28 (Asia/Dhaka)
**Project:** xzm-team-erp-dev (`ndgnhvbpmtxrpplgsslz`)
**Branch:** `chatgpt/hub-registers-release`
**Migration:** `supabase/migrations/20261128120000_hub_registers_fixes.sql`
**Test harness:** `supabase/tests/hub_registers_fixes.sql`

## 1 — Repo vs live migration state

Live DB already carries the four PR #187 register migrations under
timestamped identifiers that differ from the repo filenames. We verified
each object exists before touching it, so the new migration uses only
`create or replace function` and `create table if not exists` (plus one
`drop function if exists` for the 7-arg → 8-arg `wf_pending_manager_save`
signature swap). Nothing from PR #187 is re-created.

```
select to_regclass('public.wf_pending_snapshots'),         -- wf_pending_snapshots ✓
       to_regclass('public.wf_pending_approvals'),         -- wf_pending_approvals ✓
       to_regclass('public.wf_register_duty'),             -- wf_register_duty     ✓ (new)
       to_regclass('public.wf_register_day_lock');         -- wf_register_day_lock ✓ (new)
```

## 2 — Function surface after migration (verified)

```
wf_outside_leave_dates(p_hub uuid, p_month date)
wf_pending_backdate_save(p_hub uuid, p_employee uuid, p_date date, p_count integer, p_reason text)
wf_pending_backup_save(p_for_employee uuid, p_count integer, p_reason text)
wf_pending_hub_today(p_hub uuid)
wf_pending_manager_save(p_hub uuid, p_employee uuid, p_date date, p_snapshot bigint, p_count integer, p_reason text, p_return boolean, p_unlock boolean)
wf_pending_mark_leave(p_hub uuid, p_date date, p_employees uuid[], p_reason text)
wf_pending_month(p_hub uuid, p_month date)
wf_pending_queue_summary(p_hub uuid)
wf_pending_today(p_count integer, p_work_date date)
wf_register_day_lock_release(p_hub uuid, p_date date, p_kind text, p_reason text)
wf_register_day_lock_set(p_hub uuid, p_date date, p_kind text)
wf_register_duty_assign(p_hub uuid, p_kind text, p_employee uuid, p_is_backup boolean, p_note text)
wf_register_duty_list(p_hub uuid)
wf_register_duty_retire(p_id bigint)
```

All 14 RPCs are `security definer` with `revoke … from public, anon` + `grant execute … to authenticated`.

## 3 — Integration test run (transactional, rolled back)

Executed on the DEV DB, Naldanga (Natore) hub, 2 real employees — all inserts rolled back.

| Check | Result |
|---|---|
| SEV-001 approval snapshot blocks resubmit | ✅ `approved snapshot correctly blocks new submit` |
| SEV-002 hub-scoped latest returns source-hub row after transfer | ✅ `1 row returned for hub A` |
| HIGH-005 proxy entry auto-approved in one txn | ✅ `proxy entry created WITH its approval row` |
| MED-009 returned count excluded from `submitted_count` | ✅ `99 moved from submitted_count to returned_count` |
| LOCK day-lock row readable and blocks new submits | ✅ `lock row detected` |
| DUTY primary + backup rows listable | ✅ `2 duty rows (primary + backup) listable` |

Rollback residue check (after): `snap_rows=0, lock_rows=0, duty_rows=0` ✓ — no live data touched.

## 4 — Security advisors

Supabase advisors re-run post-migration. New tables add 4 new
`rls_enabled_no_policy` INFO entries — intentional (the RLS blocks all
direct access; all reads/writes go through `security definer` RPCs,
matching the PR #187 pattern). No new ERROR or WARN findings introduced
by this migration.

## 5 — How to re-run

```sql
-- in the Supabase SQL editor of the target project
\i supabase/tests/hub_registers_fixes.sql
```

Each DO block NOTICEs on pass and RAISE EXCEPTION on fail; the whole
thing rolls back at the end, so live data is never modified.
