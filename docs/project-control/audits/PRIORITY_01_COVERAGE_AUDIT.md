# Priority 01 — Master Module Control Center — Coverage & Enforcement Audit

**Date:** 2026-11-28 (Asia/Dhaka) · **Environment:** `xzm-team-staging` (`mbpjvqeizwjjsvnbjerb`) · **Author:** Claude · **Branch:** `chatgpt/module-release-control` (PR #226).

## 1. Registry coverage audit (code ↔ DB)

- **Routes defined in `web/src/App.tsx`:** 102. Every one maps to an entry in `routeModules` in `web/src/lib/moduleRelease.ts`.
- **Entries in `routeModules`:** 102. Every value (other than `core`) exists in `moduleRegistry` in the same file.
- **Entries in `moduleRegistry`:** 150. Every one is seeded in the Codex migration `supabase/migrations/20261128062647_module_release_control.sql` and lives in `private.release_module` on staging (confirmed by `select count(*) from private.release_module` = 150).
- **Top-level modules (32):** `access`, `accounts`, `attendance`, `branding`, `dashboard`, `fleet`, `hr`, `hub`, `hub-registers`, `issues`, `manpower`, `me`, `menu`, `menu-roles`, `nodi`, `notices`, `notifications`, `office`, `org`, `preview`, `references`, `role-dashboards`, `roles`, `rollout`, `routes`, `settings`, `sorting`, `staff`, `training`, `users`, `workforce`, `zonal`.
- **Gap:** zero. The existing node tests in `web/tests/moduleRelease.test.mjs` already enforce this three-way consistency on every CI push (one test ⟺ one assertion per path and per module ID).

## 2. Guarded-wrapper inventory (staging live query)

Query against `pg_proc` on staging (`select … from pg_proc where pg_get_functiondef(…) ilike '%module_release_require(%'`) enumerates every `public.X` function whose body calls the guard:

| # | `public.<rpc>` signature | Module ID | Return shape |
|---:|---|---|---|
| 1 | `att_days_list(p_hub uuid, p_from date, p_to date)` | `attendance` | TABLE |
| 2 | `att_days_save(p_hub uuid, p_from date, p_to date, p_rows jsonb)` | `attendance` | integer |
| 3 | `att_month_get(p_hub uuid, p_month date default null)` | `attendance` | jsonb |
| 4 | `att_month_sheet(p_hub uuid, p_month date default null)` | `attendance` | jsonb |
| 5 | `att_month_submit(p_hub uuid, p_month date)` | `attendance` | jsonb |
| 6 | `att_reopen_list(p_hub uuid)` | `attendance` | jsonb |
| 7 | `att_reopen_open(p_hub uuid, p_from date, p_to date, p_minutes integer, p_reason text)` | `attendance` | jsonb |
| 8 | `att_self_list(p_hub uuid, p_date date)` | `attendance` | jsonb |
| 9 | `att_sheet_save(p_hub uuid, p_date date, p_lines jsonb)` | `attendance` | uuid |
| 10 | `att_sheet_submit(p_hub uuid, p_date date, p_lines jsonb default null)` | `attendance` | jsonb |
| 11 | `da_accounts_history(p_hub uuid, p_from date default null, p_to date default null, p_limit integer default 300)` | `accounts` | jsonb |
| 12 | `da_assign_accountant(p_hub uuid, p_user uuid, p_reason text)` | `accounts` | uuid |
| 13 | `da_hub_access(p_hub uuid)` | `accounts` | TABLE |
| 14 | `da_hub_employees(p_hub uuid)` | `accounts` | TABLE |
| 15 | `da_import_save(p_hub uuid, p_date date, p_raw text, p_report jsonb)` | `accounts` | jsonb |
| 16 | `da_lookup_employee(p_hub uuid, p_code text)` | `accounts` | TABLE |
| 17 | `da_lookup_merchant(p_hub uuid, p_query text)` | `accounts` | TABLE |
| 18 | `da_match_payment(p_hub uuid, p_payment_ref text)` | `accounts` | TABLE |
| 19 | `fleet_board(p_hub uuid default null)` | `fleet` | jsonb |
| 20 | `fleet_waiting(p_hub uuid default null)` | `fleet` | jsonb |
| 21 | `hr_staff_join_request(p_hub uuid, p_position uuid, p_data jsonb)` | `hr` | uuid |
| 22 | `hub_feed(p_hub uuid, p_before timestamptz default null, p_limit integer default 30)` | `hub` | jsonb |
| 23 | `hub_login_list(p_hub uuid)` | `hub.logins` | TABLE |
| 24 | `nodi_gate()` | `nodi.action-chat` + `nodi.chat` (two requires) | jsonb |
| 25 | `nodi_gate(p_feature text)` | `nodi.chat` (when `p_feature='chat'`) + `nodi.action-' || p_feature` | jsonb |
| 26 | `route_plan_file_save(p_hub uuid, p_date date, p jsonb)` | `routes.tab-plan` | uuid |
| 27 | `route_plan_files(p_hub uuid, p_date date default null)` | `routes.tab-plan` | jsonb |
| 28 | `route_plan_get(p_hub uuid, p_date date default null)` | `routes.tab-plan` | jsonb |
| 29 | `route_plan_morning(p_hub uuid, p_date date default null)` | `routes.tab-morning` | jsonb |
| 30 | `route_plan_save(p_hub uuid, p_date date, p jsonb, p_send boolean default false)` | `routes.tab-plan` | uuid |
| 31 | `route_plan_setup(p_hub uuid, p jsonb)` | `routes.tab-plan` | void |
| 32 | `wf_pending_hub_today(p_hub uuid)` | `workforce` | jsonb |
| 33 | `wf_pending_month(p_hub uuid, p_month date)` | `workforce` | jsonb |

**Total: 33 wrappers wrapping 34 guarded entry points (nodi_gate(text) has two require calls).** Every static module ID referenced resolves to an existing row in `private.release_module`. The sole `module_release_require('nodi.action-' || p_feature)` concatenation resolves at call-time to `nodi.action-chat`, `nodi.action-office` or `nodi.action-teach`, all of which are seeded.

Plus **one restrictive RLS policy**: `route_day_plans_release ON public.route_day_plans FOR ALL TO authenticated USING (private.release_route_plan_row_allowed(hub_id)) WITH CHECK (…)` composes with the existing permissive policies so direct-URL and direct-SQL reads/writes are blocked whenever the `routes.tab-plan` module is not allowed for the caller's hub.

## 3. Mandatory registration — enforcement layers

| Layer | Who enforces | What it enforces | Evidence |
|---|---|---|---|
| **CI node test** | `web/tests/moduleRelease.test.mjs` (every PR) | Every `<Route path="…">` in `App.tsx` → `routeModules`; every `routeModules` value → `moduleRegistry`; every `moduleRegistry` id → seed migration; every seed parent exists. | 4/4 pass locally in each session; CI auto-runs. |
| **Frontend router gate** | `ReleaseProvider` + `ProtectedRoute` + `moduleForAddress` in `web/src/lib/releaseAccess.tsx` | A route whose module ID is not in `moduleRegistry` yields `addressAllowed → false`; `ProtectedRoute` renders `"এই মডিউলটি এখন চালু নেই"` instead of the page. | T1-T3 snapshot tests show 150 keys for every live user; `moduleForAddress('/mythical')` returns `undefined`. |
| **Backend API gate** | `public.module_release_require(module, hub)` → `private.release_api_allowed(module, hub)` | Walks ancestors; with zero ancestors (unregistered module) `bool_and` over empty set is NULL, `coalesce(…, false)` returns false, require raises 42501. | T11.2 — `module_release_require('mythical.ghost.module', demo_hub)` → 42501. |
| **Config-save gate** | `module_release_save` opens with `SELECT … INTO STRICT v_module FROM private.release_module WHERE id = p_module` | Unknown module → P0002 (no_data_found). Super Admin can't configure what isn't registered. | T11.3 — PASS: P0002. |
| **Publish gate for new modules** | `module_release_save` end: `v_module.legacy_live = false` + `stage in ('ready','published')` requires `private.release_ready(p_module)` (verified evidence row in `private.release_evidence`). | A freshly-registered module (default `legacy_live = false`) cannot be published without a service-role-signed evidence row referencing a real PR, commit SHA, workflow run, test result and deployment state. | T11.4 — PASS: "Verified test and deployment evidence required". |
| **Evidence-signing gate** | `module_release_record_evidence` granted to `service_role` only (write-only to `private.release_evidence`, check constraints on `commit_sha ~ '^[a-f0-9]{40}$'`, `test_result in ('pending','failure','success')`, `deployment in ('pending','failure','preview_verified','production_verified')`). Browser identities (Super Admin included) cannot forge evidence. | T8.3-T8.6 all PASS: Super Admin refused with 42501; service_role insert OK; invalid deployment / invalid sha rejected by check constraints. |
| **Dependency gate (parent → child)** | `private.release_decisions` recursive CTE: `select l.id, e.allowed AND l.allowed, l.rank FROM local_rules l JOIN effective e ON e.id = l.parent`. A disabled parent zeroes out every descendant. | T10.3-T10.9: disable `routes` → `routes.tab-plan/morning/sorting` all become false; disable `zonal` cascades to `zonal.hub-ops.hub.hub.d` (4 levels down); sibling `fleet` unaffected. |

## 4. Platform compatibility (Web vs Android)

- Decision pipeline: `module_release_snapshot(p_platform, …)` → `release_rule(cfg, p_platform, …)` → `(cfg->'platforms' ? p_platform)`.
- **T12.1-T12.4 all PASS on staging:**
  - `fleet` set to `platforms:["web"]` → allowed on web snapshot, blocked on android snapshot (same user, same hub, same role).
  - `fleet` set to `platforms:["android"]` → blocked on web, allowed on android.
  - `fleet` set to `platforms:["web","android"]` → allowed on both.
- For the server-side guard `module_release_require` the `p_platform` arg is null (direct APIs have no verified Android-vs-Web identity), so the rule falls through to `cfg->'platforms' ?& array['web','android']` — a module restricted to one platform refuses the API call too, forcing the UI to be the only entry point until both platforms are enabled again. This is by Codex's design and verified by the T5 fleet_board tests still refusing while platforms list is restricted.

## 5. Rollback

- **T4.9, T12.5-T12.8 all PASS on staging:**
  - `module_release_save(…, p_rollback := <audit_id>)` picks the `before_config` from `private.release_audit` and writes it as a new audit row with `rollback_of = <audit_id>`.
  - After a rollback, the snapshot reflects the restored config (`T12.5`: fleet was development → rolled back → snapshot shows maintenance from the before_config).
  - The rollback entry is itself re-rollbackable; a later save on top of it is a normal next revision. `T12.7` confirms the audit chain reached 18 entries after the full lifecycle churn.
  - Stale revision guard: `module_release_save('fleet', 0, …)` while the live revision is >0 raises `40001 "Configuration changed. Reload and try again."` (T4.10 PASS).

## 6. Full test run summary (this session)

| Suite | Count | PASS | FAIL |
|---|---:|---:|---:|
| T1 Super Admin & role gating on `module_release_admin` | 5 | 5 | 0 |
| T2 Write/history/preview/evidence refused to non-Super | 4 | 4 | 0 |
| T3 Snapshot reachable by Hub Manager / Staff / Rider | 3 | 3 | 0 |
| T4 7-stage lifecycle + publish/unpublish + rollback + stale-rev + unknown-key | 11 | 11 | 0 |
| T5 Guard effect end-to-end with DEMO opt-in | 6 | 6 | 0 |
| T6 Direct URL / restrictive RLS on route_day_plans | 6 | 6 | 0 |
| T7 Coverage across batch-1+2 wrappers (14 wrappers × block/restore) | 18 | 18 | 0 |
| T8 Audit history + service-role evidence + check-constraint rejection | 6 | 6 | 0 |
| T9 Batch-3 table-returning wrappers reachable at published default | 6 | 6 | 0 |
| T10 Module dependency: parent disable cascades, siblings unaffected, 4-level cascade | 9 | 9 | 0 |
| T11 Mandatory registration enforcement (fail-closed on unknown modules, new-module publish refused w/o evidence) | 5 | 5 | 0 |
| T12 Web vs Android platform gating + rollback chain | 8 | 8 | 0 |
| **Total** | **87** | **87** | **0** |

## 7. Conflict avoidance with ChatGPT's independent audit

- All migrations landed by Claude in this session carry new timestamps (`20261128070000`, `20261128070100`, `20261128073000`, `20261128074000`) — none overwrites a pre-existing Codex migration.
- No `public.X` function body was rewritten; every guarded RPC is the original Codex body moved into `private.X` by `ALTER FUNCTION … SET SCHEMA private`, with a thin new `public.X` wrapper that layers `module_release_require(module, p_hub)` on top. ChatGPT re-reading `private.X` in the audit will find the exact Codex body it started with.
- The Codex audit doc `docs/project-control/audits/MODULE_RELEASE_BACKEND_INVENTORY.md` (commit `5531156` by the owner) is left unchanged. This coverage audit is a sibling file, additive, not an edit.
- PR #226 stays **DRAFT**. No main-merge, no production migration apply, no production deploy from this session. The Supabase MCP writes in this session all targeted `mbpjvqeizwjjsvnbjerb` (staging) only; `ndgnhvbpmtxrpplgsslz` (production) was never addressed.

## 8. Open follow-ups for the Backend Team Contract report pattern

Not attempted in Claude sessions (stays with the ChatGPT Backend Team as per the authority split). Each needs per-function hub-derivation, internal-caller impact review, and a separate test file:

- **Session-id-first RPCs** that need a session→hub lookup helper first: `da_sheet(uuid)`, `da_close_day(uuid, text)`, `da_close_my_part(…)`, `da_report_save(…)`, `da_report_ok(…)`, `da_submit(…)`, `da_verify(…)`, `da_bank_done(…)`, `da_cell_set(…)`, `da_deposit_save(…)` and roughly 40 more `da_*` RPCs.
- **`operation_*` Research Center RPCs** (`operation_baseline_save`, `operation_question_send`, `operation_questions_today`, `operation_recipients`): first seed an `operation` module in `release_module` (and child nodes if needed), then wrap.
- **`sorting_dispatch_*`, `issue_*`, `wf_*` (beyond the two pending-queue wrappers already landed), `hr_*` write RPCs** — each with p_hub derivation decision upfront.
- **~510 remaining `public.*` RPCs** per the full inventory in `audits/MODULE_RELEASE_BACKEND_INVENTORY.md`. Current coverage is 33 wrappers / 34 guarded entry points.

## 9. Provenance

- Guard additions: `supabase/migrations/20261128070000_module_release_expansion.sql` (batch 1, 4 scalar RPCs), `20261128070100_module_release_expansion_batch_2.sql` (batch 2, 14 scalar RPCs), `20261128074000_module_release_expansion_batch_3.sql` (batch 3, 7 table-returning RPCs).
- Hotfix: `supabase/migrations/20261128073000_module_release_demo_hub_fix.sql` (B-001).
- Tests: `supabase/tests/99_release_control.sql` (Codex, 34 assertions), `99_release_control_expansion.sql` (batch 1), `99_release_control_expansion_batch_2.sql` (batch 2), `99_release_control_expansion_batch_3.sql` (batch 3). All four will run in the full `supabase` test harness during CI; the T1-T12 assertions in this session ran directly through Supabase MCP because the `tests` pgTAP-style schema is not installed on staging.
- Frontend: shared hub detection in `web/src/lib/releaseAccess.tsx`; standalone test in `web/tests/moduleRelease.test.mjs`.
- Commits on branch `chatgpt/module-release-control`: `ebdc140`, `11387c2`, `ea92fb4`, `a59c922`, `f2dce37`, + this audit commit.
