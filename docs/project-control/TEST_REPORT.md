# TEST_REPORT

> Per-task test evidence। প্রতিটি approved task-এর test result এখানে append হবে।

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

## XZM-012 — Hub Switching Development — 2026-11-27

- Base revision `6831f29`. The existing selector was in My Permissions, with a same-tab custom event. The manager staff view had a second, non-user-keyed preference. Hub rider routes had a local override.
- Dashboard, attendance and hub management already resolved the saved hub in their accessible lists. The attendance overview and final register check response IDs. This change adds the waiting marks and manager staff response checks.
- Hub registers link to attendance, accounts and personal register views. Pending-review integration remains in #197 and #210. Staff bulk views and reports retain their cross-hub filters.
- Daily accounts start and new issue/order defaults use an eligible working hub. Account reports, operations collection comparisons and explicit issue/group/record links keep their own scope. Route Planning's hub rider pane uses the working hub. Zone planning keeps the zone and plan-specific controls.
- Data Entry has no route in base main. The module is under development in #207. Sorting center assignment, office and residential property references, and fleet assignment/dispatch have separate record or comparison scopes. Runtime validation across those modules remains pending.
- Source authorization reviewed for the hub roster (`hubs_read`, `private.has_permission`), workforce RPC hub resolution (`private.wf_hubs`) and issue visibility (`private.can_see_issue`, `private.in_hub_group`). The roster depends on authenticated RLS. Module permissions can be narrower. The migration drift in R-003 means source review does not verify live policies. No database or hosting configuration changes.
- TypeScript and build passed. Parser, navigation, routes, plan and check-in suites passed. npm clean install failed against the base lockfile (also the subject of #198). Local installation used `npm install --no-package-lock`. The repository has no lint script. Local PostgreSQL/Docker was unavailable. Android's Capacitor configuration loads the production URL, so a separate test wrapper/build remains necessary for isolated WebView tests.
- Focused Playwright PC/phone checks used a local build with a reserved `.invalid` Supabase hostname and intercepted API responses. Covered Super Admin, scoped Zonal Manager, Hub Manager, Staff and Rider fixtures, refresh, back/forward, two tabs, rejected saved hub, deep links, draft protection, draft RPC hub ID, logout and a different account login. Offline browser suite passed with the same isolation.
- The [isolated PostgreSQL 16 workflow](https://github.com/mizanurnatoresfc-bit/xzm-team/actions/runs/46060131827) passed 2,815 assertions, including the RBAC, workforce, final sheet, morning input, daily accounts, issues, office, route settings and fleet test files. The full SQL suite failed in the existing `route_checkin_offline.sql:48` test with a multiple-row scalar subquery. SQL sources, assertions and the workflow were identical to base `6831f29`.
- Merge simulations for the eleven overlapping open PRs found no new conflicting paths. PRs #136, #153 and #156 already had conflicts against the base. No writes were tested on the hosted preview.

### PR #219 independent review follow-up

- TypeScript, build, parser, navigation, route, plan, check-in and browser offline tests passed. The focused localhost suite passed 58 desktop and phone checks for explicit hub selection, creation-form guards, deep links, account switching, scoped rosters and delayed Morning RPCs. Full regression evidence is recorded in [PR #219](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/219).

- Issue, Store/IT order and daily accounts creation require an explicit eligible hub when the working hub is unavailable. An explicit invalid issue shortcut stays unselected. Open forms defer working-hub switching, including switches from other tabs, and keep their chosen target through submission. Attendance and morning deep links distinguish the record hub. Issue and daily account detail identify their actual hub.
- Morning draft writes are serialized within each mounted editor. An older response cannot clear the latest edit's pending state, and final submission waits for the in-flight draft. Concurrent edits to the same register from multiple devices still follow existing backend behavior.
- Reviewed the checked-in hub roster RLS, active effective grants and their global, zone and hub scopes for Super Admin, Zonal Manager, Hub Manager, Staff and Rider. For accounts, `da_my_hubs` exposes `can_submit` from `da.sheet.create`, independently checked by `da_start_session`. For Issues, `hub_group_hubs` and `issue_create` both use `private.in_hub_group`, which includes linked employees and scoped issue grants. Existing isolated SQL evidence includes cross-hub denials and rider denial for account creation. Production policy parity remains unverified.
- The SQL run reported the offline check-in failure at 19:57 UTC. The test's three-hour-old reading mapped to 22:57 on 27 November in Dhaka, and its one-hour-old reading mapped to 00:57 on 28 November. The RPC legitimately stores both on separate `work_date` keys. Line 48 selects by stop alone in a scalar subquery, so it sees two rows. The SQL fixture and application SQL are outside this PR.
- [PR #207](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/207) remains an open draft. Data Entry integration requires its actual routes and RPC contracts, followed by a separate hub-context regression run.
- Physical Android WebView testing remains pending. The workspace has no Android SDK, emulator or device bridge. Capacitor configuration points to the production URL, so the isolated browser bridge fixture is used for mobile app-mode header checks.

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
