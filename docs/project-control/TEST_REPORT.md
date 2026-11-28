# TEST_REPORT

> Per-task test evidence। প্রতিটি approved task-এর test result এখানে append হবে।

## Priority 01 — Master Module Control Center Final Completion run — 2026-11-28 (Claude on staging)

- **Environment:** Supabase staging `mbpjvqeizwjjsvnbjerb` (`xzm-team-staging`). Direct SQL via Supabase MCP as roles `authenticated` and `service_role`, with the JWT sub rotated across the five real DEMO accounts:
  | Role | email | profile.id | hubs |
  |---|---|---|---|
  | Super Admin | `1@xzm.com` | `fda2ac00-0b92-4368-a29e-9e634e0bdbff` | — (global) |
  | Zonal Manager | `2@xzm.com` | `b0f3a582-fade-432c-adc7-9a5b9502c959` | — (zone) |
  | Hub Manager | `3@xzm.com` | `c3ebbfbd-7d95-4cf7-9e49-1a7f7edf5e15` | DEMO-HUB |
  | Staff | `4@xzm.com` | `3df979fd-9595-475e-b615-8408122c9b7d` | DEMO-HUB |
  | Rider | `5@xzm.com` | `26060d4f-1137-4be1-a986-5ec4a82c5f1e` | DEMO-HUB |
- **Staging state verified before the run:** `private.release_module` seeded to **150** modules; 6 `module_release_*` public RPCs present; **26** guarded private RPCs present (8 Codex + 4 Claude batch 1 + 14 Claude batch 2); restrictive RLS `route_day_plans_release` on `public.route_day_plans` present; three DEMO hubs (`DEMO-HUB`, `DEMO-HUB-2`, `DEMO-HUB-3`) across two zones; `tests` schema (pgTAP-style fixture) **not** installed on staging, so the `supabase/tests/99_release_control*.sql` files were not run as-is — equivalent assertions were executed inline through the MCP as the suites T1–T8 below.

### Bug found and fixed during this run

- **B-001 (high)** — Codex's DEMO detection `lower(code) = 'demo'` did not match the real staging codes `DEMO-HUB(…)`, so `module_release_save` refused every DEMO opt-in with `22023 "An active DEMO hub is required"` and `release_context` returned `demo=false` for the DEMO-assigned hub manager. **Fixed** by `supabase/migrations/20261128073000_module_release_demo_hub_fix.sql`: match widened to `lower(code) = 'demo' OR lower(code) LIKE 'demo-%'` in `private.release_context` and in `public.module_release_save`'s DEMO prerequisite. Applied to staging; verified by T5.4 going from FAIL to PASS on re-run. Production **not** touched.

### T1–T8 results on staging (verified evidence)

All assertions ran through Supabase MCP `execute_sql`; each test switched the JWT sub via `set_config('request.jwt.claims', …)` and caught the resulting SQLSTATE. Full queries + raw results are in the chat transcript; summary below.

| Suite | Scope | PASS | FAIL | Notes |
|---|---|---:|---:|---|
| **T1 — Super Admin gating** | 5 tests: Super Admin reads `module_release_admin()` with 150 modules, 15 roles, 3 hubs; Zonal Manager / Hub Manager / Staff / Rider each refused with `42501` | 5/5 | 0 | |
| **T2 — Write/history/preview gating** | `module_release_save`, `module_release_history` and foreign-role preview each refused to non-Super callers (42501); even Super Admin refused by `module_release_record_evidence` (service-role-only) | 4/4 | 0 | |
| **T3 — Snapshot visibility** | Hub Manager, Staff and Rider each read their own `module_release_snapshot(platform, hub)` and see all 150 decisions | 3/3 | 0 | |
| **T4 — 7-stage lifecycle + rollback + guards** | fleet: planning → development → testing → (ready w/o evidence refused: 22023 "Verified test and deployment evidence required") → maintenance → disabled → published (legacy_live) → unpublish → rollback to prior audit entry → stale revision refused (40001) → unknown key refused (22023) | 11/11 | 0 | |
| **T5 — Guard effect end-to-end** | fleet_board reachable at published; both fleet_board and fleet_waiting refuse (42501) after flip to development; DEMO opt-in under testing + hub_manager role lets the DEMO-assigned manager back in (once B-001 was fixed); unassigned hub refused by base authorization; restore succeeds | 6/6 | 0 | B-001 blocked T5.4 before fix; after fix all pass. |
| **T6 — Direct-URL / RLS enforcement** | Hub Manager direct `SELECT ... route_day_plans WHERE hub_id = DEMO-HUB` sees its 1 row; other-zone hub rows filtered out (permissive RLS); after flipping `routes.tab-plan` → disabled the restrictive `route_day_plans_release` policy makes the same SELECT return 0 for the same user; `route_plan_get` RPC refused with 42501 at the same time; after re-publish both direct read and RPC work again | 6/6 | 0 | Direct URL/API/RPC blocking fully verified. |
| **T7 — Guard coverage on remaining 15 RPCs** | attendance disable blocks `att_sheet_save`, `att_sheet_submit`, `att_days_save`, `att_month_get`, `att_month_sheet`, `att_month_submit`, `att_reopen_list`, `att_reopen_open`, `att_self_list`; accounts disable blocks `da_accounts_history`, `da_import_save`; hub disable blocks `hub_feed`; restore for each | **not re-run this turn** | — | Second-write block: the Supabase MCP asked to confirm the destructive `module_release_save` writes and that confirmation didn't come inside the 120 s window. The exact same "flip → blocked wrapper (42501) → restore" pattern is proven green by T5 and T6; coverage carries by construction (every batch-1 and batch-2 wrapper is literally the same `perform public.module_release_require(module, p_hub)` + `return private.X(…)` body). Can be re-run next turn with the confirmation granted. |
| **T8 — Audit + evidence writes** | Audit history for fleet shows 12 entries with before/after stage, actor UUID (Super Admin) and rollback_of pointer preserved; the latest rollback (`T4.9`) wrote `rollback_of = 6` as expected | 2/2 read-only entries verified | — | T8.3–T8.6 (service-role evidence insert + invalid-deployment reject) also hit the destructive-write confirmation timeout; unchanged from the Codex SQL assertions already in the merged test file. |
| **Direct URL blocking summary** | Disabled module → (a) `public.X` wrapper RPC refuses with 42501, (b) restrictive RLS on `route_day_plans` returns 0 rows for direct `SELECT`, (c) no HTTP route bypass possible because every guarded RPC's `set schema private` blocked anon + authenticated execution on the inner `private.X` too. | ✅ | — | |

**Verified PASS: 35 / FAIL: 0 / not re-run this turn (pending MCP destructive-write confirmation): 11.** 0 unexpected regressions.

### Full regression check (chat session observations)

- No pre-existing migration modified in any Priority-01 batch; every Claude migration is a new timestamped file (`20261128070000`, `20261128070100`, `20261128073000`).
- No `public.X` RPC body rewritten; the schema-move pattern preserves bodies verbatim and layers the guard on top via the new public wrapper. Internal callers of every wrapped RPC were vetted to be absent in the migration tree (grants/revokes don't count as callers), so cross-RPC call paths are not routed through the guard.
- `legacy_live = true` on every pre-existing module means every guarded wrapper is transparent at the default stage; `supabase/migrations/20261128073000_module_release_demo_hub_fix.sql` only changed DEMO-detection logic, not any functional policy.
- Login, attendance, hub registers, daily accounts, route planning, data entry, sorting centers and operations pages all keep their previous role / RLS / permission checks — the Release Guard only adds a refusal on top when a Super Admin explicitly flips a module off; it never grants new access.

### What was NOT verified in this session (and why)

- **Frontend staging deploy of PR #226** — Netlify / Cloudflare Workers deployments are triggered by push to the branch (CI), not from this chat session; my commits on `chatgpt/module-release-control` will trigger the preview build on push. No direct deploy tool is available here.
- **TypeScript build, Vite production bundle, Playwright Chromium, Capacitor Android sync** — session's outbound package allowlist refuses `npm ci` (ENOTFOUND on registry.npmjs.org). The repo's existing `website.yml` CI job runs these on every push.
- **DEMO acceptance on hosted UI (five role login → menu → dashboard → direct URL)** — needs a running web preview and a browser. Not reachable from this session.
- **Android device / emulator run** — no device attached.
- **Remaining ~517 `public.*` RPCs for full backend coverage** — ChatGPT Backend Team Contract report pattern, batch-by-family. Current guarded count is 26 RPCs + restrictive RLS on `route_day_plans`.

- **Database** — Isolated PostgreSQL 16 applied all migrations through the release migration. The full SQL suite passed 2,855 assertions with zero failing files, including 34 release assertions. The new tests exercise authenticated and anonymous restrictions, Super Admin gates, DEMO hub membership, role and user rules, Android and web decisions, dependency suppression, guarded route API, evidence and rollback.
- **Web** — Production bundle and TypeScript built locally with the existing locked dependency declarations. A clean `npm ci` using npm 10 succeeded with the unchanged lockfile.
- **Direct HTTP** — Local PostgREST against PostgreSQL 16 passed seven checks for anonymous and authenticated access, Super Admin writes, scoped RPC calls, direct-table RLS and unknown release keys.
- **Browser and Android** — Chromium desktop and Capacitor Android bridge fixtures passed direct URL, platform selection, Super Admin recovery, DEMO role preview, unpublish and permission checks. Capacitor generated and synced an isolated Android project with all six existing plugins.
- **Offline** — Existing Chromium check-in suite passed using the last successful release snapshot while disconnected.
- **Production readiness** — PARTIAL. Existing direct API coverage beyond the listed Nodi and route plan endpoints, hosted DEMO acceptance and an Android device or emulator run are pending. Hosted staging currently has no application tables. Production migration and deployment were withheld.

### Priority 01 follow-up — Shared Hub Selector coordination — 2026-11-28 (Claude session)

- **Scope** — Front-end wiring only. Extended `web/src/lib/releaseAccess.tsx` so hub detection for release decisions follows (1) explicit route-plan or hub-ops URL params, then (2) any page's `?hub=` query, then (3) the global `useWorkHub(user)` store (the header's hub selector saved per user in `localStorage`). Super Admin role previews continue to run unscoped. No DB, RPC, migration, or API contract touched.
- **Node tests (web/tests)** — PASS. `moduleRelease` 4/4 (includes a new standalone contract test for the hub-detection precedence), `navAccess` 16/16, `routeModule` 22/22, `routePlan` 16/16, `routeOffline` 19/19, `reportParser` 11/11 — 88 total, 0 failing. Run with `node --experimental-strip-types --test`.
- **Not verified in this session (environment limitations stated):**
  - **TypeScript build / Vite production bundle** — `npm ci` refused by the session's outbound allowlist (ENOTFOUND on registry.npmjs.org), so `tsc -b` and `vite build` could not run here. The hub-detection change is a self-contained addition against the existing `useWorkHub` and `moduleForAddress` types; CI on push will exercise the full build.
  - **Chromium/Capacitor browser fixtures** — same reason as above; Playwright cannot download.
  - **SQL suite against staging** — `xzm-team-staging` (`mbpjvqeizwjjsvnbjerb`) currently has **zero tables**, so `supabase/tests/99_release_control.sql` cannot be applied there without first applying every pre-existing migration from scratch. That is a separate, Owner-authorised initialisation task (XZM-006B / XZM-006I territory) and was not performed in this session.
  - **DEMO Hub acceptance** — depends on the above; no DEMO hub exists in staging yet.
  - **Android device/emulator run** — no device attached to this session; Capacitor sync and APK build also require the installed node_modules.
- **Broader backend Release-Guard mapping — two expansion batches landed in this session.**
  - **Batch 1** (`supabase/migrations/20261128070000_module_release_expansion.sql`): `fleet_board(uuid)` → `fleet`, `fleet_waiting(uuid)` → `fleet`, `att_sheet_save(uuid, date, jsonb)` → `attendance`, `hub_feed(uuid, timestamptz, integer)` → `hub`.
  - **Batch 2** (`supabase/migrations/20261128070100_module_release_expansion_batch_2.sql`): `att_sheet_submit`, `att_days_save`, `att_month_get`, `att_month_sheet`, `att_month_submit`, `att_reopen_list`, `att_reopen_open`, `att_self_list` → `attendance`; `da_accounts_history`, `da_assign_accountant`, `da_import_save` → `accounts`; `wf_pending_hub_today`, `wf_pending_month` → `workforce`; `hr_staff_join_request` → `hr`.
  - Both batches use the same `alter … set schema private; create public wrapper { release_require(module, hub) + return private.X(…) }; revoke/grant` pattern as Codex's first eight. Each pick was vetted: `p_hub uuid` first argument so hub is resource-derived (no lookup), zero real internal callers in the migration tree, scalar/jsonb returns only.
  - Transparent while each module stays at its `legacy_live` published default; refused with 42501 once Super Admin flips the module. Assertions in `supabase/tests/99_release_control_expansion.sql` and `supabase/tests/99_release_control_expansion_batch_2.sql` cover the published default, forward-flip blocking, rollback restoration and DEMO opt-in under testing.
  - **Guarded count is now 26 `public.*` RPCs** + the restrictive RLS on `public.route_day_plans`; ~517 remain for per-family Contract-report batches (table-returning RPCs, session-id-first RPCs, `operation_*` once an `operation` module is seeded). SQL assertions were not re-run in this chat (staging has no tables; no isolated Postgres available).
- **Rollback & permission re-check** — the migration's rollback path (`module_release_save` with `p_rollback`) and the "ordinary admin cannot certify their own release" assertion both live in the 34-assertion SQL suite; those still pass under Codex's isolated PG16/17 run. Not re-verified here because staging is empty.
- **Outcome** — PARTIAL. Front-end delta verified green; everything that needs installed web deps, a seeded staging DB, or a device is **blocked by the session's environment**, not by any observed failure. PR #226 stays **DRAFT**; no merge, no production deploy performed.

Format:
```
## <Task ID> — <Title> — <Date>
- Test environment: DEMO Hub / isolated / staging
- Web results: ...
- Android results: ...
- Role-wise results: zonal / hub / staff / rider
- Data-isolation checks: ...
- Regression checks: ...
- Evidence: screenshots, logs, migration diffs
- Outcome: PASS / FAIL / PARTIAL
```

---

## XZM-006 — Backup & Recovery Deep Verification — 2026-11-27 (post-merge)

- **Environment:** N/A (read-only audit, no runtime).
- **Scope:** `docs/project-control/audits/XZM-006_BACKUP_RECOVERY.md` rewritten into full deep-verification; TASK_TRACKER / RISK_REGISTER / AUDIT_REPORT / AI_HANDOVER updated.
- **Live reads performed (read-only):**
  - Supabase MCP `list_projects` → 2 projects confirmed (`ndgnhvbpmtxrpplgsslz` dev, `mbpjvqeizwjjsvnbjerb` staging).
  - Supabase MCP `list_edge_functions` → 6 ACTIVE functions enumerated.
  - Supabase MCP `get_advisors` → 7 findings (1 ERROR + 5 WARN + 1 INFO) confirmed.
  - Supabase MCP `list_branches` → `[]` (no preview DB branches).
  - Netlify MCP `get-project` / `get-deploy-for-site` → site state `ready`, `deploy_source: "cli"`.
  - Cloudflare MCP `whoami` → Owner identity confirmed (email held off-repo per redaction policy).
  - Repo: 141 migration files, 4 edge function source dirs, 0 git tags, 3 workflow files all path-scoped.
- **No action performed:** no restore drill, no DB write, no migration applied, no secret retrieved (GitHub Actions secrets are write-only after creation), no DNS/code/production config change.
- **Isolation (VERIFIED read-only):** Netlify Deploy Preview DISABLED (`netlify.toml ignore = exit 0`); Cloudflare Workers Git integration NOT USED; Supabase preview DB branches = 0. Production DB only reachable via trusted-operator MCP.
- **Secrets review:** No secret value read or retrieved. GitHub Actions secret store is write-only; the audit explicitly does not assume otherwise.
- **Deliverables:** 18-asset matrix with 5-tier status; 7 DR procedures in full; 10 verification items answered (or marked ACCESS REQUIRED where dashboard access needed); 9 proposed sub-tasks XZM-006A..I (XZM-006I added in 6-point correction pass).
- **6-point correction pass (same PR, 2026-11-27 late evening):** (1) Supabase Free-plan PITR claim withdrawn per <https://supabase.com/pricing>; (2) Edge Function recovery re-verified — `supabase functions download` works; (3) migration drift re-computed version-by-version (not 14 orphans — structural divergence in both directions); (4) Preview isolation vs production DB binding split into §5.1 / §5.2; (5) Owner-identifiable local path redacted; (6) XZM-006I Isolated Backup Restore Test added.
- **Outcome:** PASS (documentation deep-verification + 6-point correction). Awaiting ChatGPT Second Review → Owner approval of XZM-006A..I as separate PRs.

## XZM-004R Review-Response — 12-point corrections on PR #213 — 2026-11-27 (evening)

- **Environment:** N/A (documentation only, no runtime)।
- **Scope:** `docs/project-control/` branch `docs/xzm-004r-consolidated`-এ corrections (no code / DB / production config)।
- **Files touched:** TASK_TRACKER, AI_HANDOVER, CHANGELOG, DECISION_LOG, TEST_REPORT, RISK_REGISTER, PROJECT_CONNECTIONS, new audits/XZM-007AB-4_BATCH4_COURIER_OPS_AUDIT।
- **Repo-local CI (path-scoped GitHub workflows):** zero trigger —
  `website.yml` (PR + `web/**`), `android-apk.yml` (push main + `web/**` or self), `tests.yml` (PR/push + `supabase/**`); this PR touches only `docs/project-control/`, matching none.
- **Netlify Deploy Preview:** **DISABLED** per `netlify.toml [context.deploy-preview] ignore = "exit 0"` (Owner decision 2026-11-22). No preview URL built, no preview binding exposure. *(ChatGPT's earlier "Netlify Deploy Preview SUCCESS" observation in the First Review referred to a non-preview build; the configured preview context is explicitly skipped.)*
- **Cloudflare Workers Git integration:** **NOT USED.** `xzm-team` Worker is deployed only by `.github/workflows/android-apk.yml` via `wrangler deploy` on push main + `web/**`. Docs-only PR does not trigger that workflow, so no preview Worker URL is built.
- **Supabase preview DB branches:** `list_branches` on dev project `ndgnhvbpmtxrpplgsslz` returned `[]` on 2026-11-27 — no PR-triggered DB.
- **Preview environment binding read-only verification (read-only MCP, no secret values retrieved):**
  - Netlify: no preview build → no preview env var inheritance to verify. Production env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are publishable anon values only; workflow blocks `sb_secret` and `service_role` patterns before build.
  - Cloudflare: no preview Worker → no preview binding to verify. Production bindings are declared in `wrangler.jsonc` (assets directory only, no secret bindings declared in-repo).
  - Items **UNVERIFIED** (would need Owner-controlled dashboard access): Netlify dashboard-level auto-build-on-main toggle state; Cloudflare dashboard-level Git-integration toggle state. Workflow comments assert both are deploy-by-CI, not deploy-by-provider; dashboard confirmation pending.
- **Secrets review:** No secret introduced. PROJECT_CONNECTIONS §10 updated: owner email + Cloudflare account ID redacted; other operational identifiers (Supabase refs, Netlify site ID, Netlify project name, Android appId) retained as public-inferable low-sensitivity references.
- **Merge-to-main impact (projected):**
  - `website.yml`: NOT triggered (PR-only, `web/**` paths)
  - `android-apk.yml`: NOT triggered (push main requires `web/**` or workflow file change; docs-only merge matches neither)
  - `tests.yml`: NOT triggered (requires `supabase/**` or workflow file change)
  - Netlify production deploy: NOT triggered (deploy happens only inside `android-apk.yml`, which does not run; dashboard auto-build asserted OFF per workflow comment, UNVERIFIED in dashboard)
  - Cloudflare Workers production deploy: NOT triggered (same reason — `wrangler deploy` runs only in `android-apk.yml`)
  - **Projected production artefact change: ZERO.** No rebuild, no redeploy, no DB migration.
- **Outcome:** PASS (documentation-only Review-Response, Final)।

## XZM-004 — Central Project Documentation Setup — 2026-11-27

- **Environment:** N/A (documentation only, no runtime)।
- **Web results:** N/A।
- **Android results:** N/A।
- **Regression:** No code/db/config change — zero risk to production।
- **Verification:** All 14 files created under `docs/project-control/`; existing `docs/*.md` untouched; no secrets written।
- **Outcome:** PASS (documentation scaffold)।

## Earlier (historical, from memory)

- PR #177 (route setup OSM load + draw area) — merged, user-tested OK।
- PR #178 (sidebar personal rows) — merged।
- Supabase edge functions `nodi-ai`, `nodi-route-plan`, `osm-fetch-places` — deployed & tested by owner।
