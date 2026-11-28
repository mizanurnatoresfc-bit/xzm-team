# TEST_REPORT

> Per-task test evidence। প্রতিটি approved task-এর test result এখানে append হবে।

## Priority 01 — Master Module Control Center — 2026-11-28

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
- **Broader backend Release-Guard mapping — first expansion batch landed in this session.** Four additional UI-facing RPCs with zero internal callers in the migration tree are now wrapped in `supabase/migrations/20261128070000_module_release_expansion.sql` using the same `alter … set schema private; create public wrapper { release_require + return private.X(…) }; revoke/grant` pattern Codex used for the first eight: `fleet_board(uuid)` → `fleet`, `fleet_waiting(uuid)` → `fleet`, `att_sheet_save(uuid, date, jsonb)` → `attendance`, `hub_feed(uuid, timestamptz, integer)` → `hub`. Transparent while each module stays at its `legacy_live` published default, refused with 42501 once Super Admin flips it to development/testing/disabled without DEMO scope. New assertions in `supabase/tests/99_release_control_expansion.sql` cover the published default, forward-flip blocking, rollback restoration and DEMO opt-in under testing. The repo still has ~543 `public.*` RPCs in total; the remaining expansion (RPCs with internal callers, table returns, or session-id-only arguments) belongs to the ChatGPT Backend Team Contract report pattern and was deliberately kept out of this batch to avoid mass-signature risk. SQL assertions were not re-run in this chat (staging has no tables; no isolated Postgres available).
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
