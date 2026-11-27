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
- **CI check:** Repo-local path-scoped workflows (`website.yml`, `android-apk.yml`, `tests.yml`) — zero trigger (paths all under `docs/project-control/`)।
  Netlify Deploy Preview — triggers per PR configuration; prior preview on this PR verified SUCCESS by ChatGPT (docs-only, isolated preview URL)।
  Cloudflare Workers Git integration — auto builds on push; produces isolated `*.mizanurnatore-sfc.workers.dev` preview URL (not production `xzmteam.com`)।
- **Isolation verification:** Netlify preview does not write to production domain; Cloudflare Workers production route for `xzm-team` service is bound to zone DNS only via explicit deploy, not preview URLs. Preview environments considered **functionally isolated for docs-only branches**।
- **Secrets review:** No secret introduced. Operational identifiers (Supabase project ref, Netlify site ID, Cloudflare account ID, owner email) catalogued in PROJECT_CONNECTIONS §10 for Owner review — not treated as secrets but exposure flagged।
- **Outcome:** PASS (documentation-only Review-Response)।

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
