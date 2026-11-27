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
