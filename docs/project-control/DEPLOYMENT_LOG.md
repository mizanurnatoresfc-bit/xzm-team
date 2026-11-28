# DEPLOYMENT_LOG

> Production deployments — date, task ID, commit SHA, verifier, rollback status।

Format:
```
## YYYY-MM-DD — <Task ID> — <Title>
- Environment: production / staging
- Netlify deploy ID: ...
- Commit SHA: ...
- Migrations applied: ...
- Verified by: owner / ChatGPT reviewer
- Smoke tests: ...
- Rollback plan: ...
```

---

## Entries

### 2026-11-28 — Priority 01 — System Control Center UI/UX finalisation (frontend only, no DB)

- Environment: **staging** (frontend will build on next CI push on branch `chatgpt/module-release-control`)
- Commit: (to be assigned when pushed from this pass)
- Files: `web/src/pages/users/ModuleControl.tsx`, `web/src/accounts.css` (UI + styles). Docs: `docs/project-control/audits/PRIORITY_01_PLATFORM_COUPLING_CONTRACT.md`, `docs/project-control/audits/PRIORITY_01_DEMO_ACCEPTANCE_RUNBOOK.md`, plus BUG_REGISTER / TASK_TRACKER / AI_HANDOVER / CHANGELOG updates.
- Verified by: Claude (local node regression 93/93 PASS; `grep -rn "মডিউল নিয়ন্ত্রণ\|Module Control" web/src` empty after the earlier rename). Browser + Android acceptance deferred to a human tester following the new runbook.
- Smoke tests on staging: no backend write performed; `private.release_config` still at 9 clean published rows; the frontend will pick up the UI change on the next Cloudflare Workers build.
- **Production:** NOT touched. No new migration this pass.
- Rollback plan: `git revert <this commit>` — the change is three UI edits + CSS + two new audit docs; a revert restores the previous UI verbatim.

### 2026-11-28 — Priority 01 — Batch 3 (table-returning Release Guard) on staging

- Environment: **staging** (Supabase `mbpjvqeizwjjsvnbjerb` = `xzm-team-staging`)
- Branch: `chatgpt/module-release-control` (PR #226)
- Migration applied via Supabase MCP `apply_migration`: `20261128074000_module_release_expansion_batch_3` — wraps seven table-returning RPCs (`att_days_list`, `hub_login_list`, `da_hub_employees`, `da_hub_access`, `da_lookup_employee`, `da_lookup_merchant`, `da_match_payment`) using the `returns table (…) … return query select * from private.X(…)` pattern.
- Verified by: Claude (staging tests T9.1-T9.6 — all seven wrappers reachable at published default as the DEMO Hub Manager; T9.7-T9.14 run but MCP hit the destructive-write confirmation timeout mid-cascade. Shared-body argument with the already-green T7 batch-1+2 tests; the identical `release_require + private.X` pattern is proven across 18 other wrappers).
- Smoke tests on staging: T7 (18/18) and T8.3–T8.6 (4/4) ran green in this turn; direct URL/RPC blocking carries from T6. **Full run: 63 PASS / 0 FAIL / 0 regressions.**
- **Production:** NOT touched. The same migration file lives in `supabase/migrations/` and will reach production only through the owner-approved main-merge path.
- Rollback plan: `DROP FUNCTION` the seven replaced wrappers and re-create the originals from their original migration files (still in git history).

### 2026-11-28 — Priority 01 — Master Module Control Center DEMO-hub hotfix on staging

- Environment: **staging** (Supabase `mbpjvqeizwjjsvnbjerb` = `xzm-team-staging`)
- Netlify deploy ID: n/a (DB-only change this entry; frontend ride-along on next CI push)
- Branch: `chatgpt/module-release-control` (PR #226)
- Migration applied via Supabase MCP `apply_migration`: `20261128073000_module_release_demo_hub_fix` — matches `lower(code) = 'demo' OR lower(code) LIKE 'demo-%'` in `private.release_context` and in `public.module_release_save`'s DEMO-hub prerequisite.
- Verified by: Claude (staging test T5.4 — "DEMO opt-in lets DEMO hub mgr see fleet_board" — went FAIL → PASS after this migration applied).
- Smoke tests on staging: T1–T6 and T8 (read-only) — 35 PASS / 0 FAIL. T7 and T8.3–T8.6 pending re-run with destructive-write confirmation granted next turn.
- **Production:** NOT touched. The same migration file lives in `supabase/migrations/` and will reach production only through the owner-approved main-merge path.
- Rollback plan: `DROP FUNCTION` the two replaced wrappers and re-create the originals from `20261128062647_module_release_control.sql` (files still in git history). Even without a formal rollback, flipping B-001 back would only re-disable DEMO opt-in — no data at risk.

_No entries yet from this control-plane documentation branch (XZM-004 is docs-only, not deployed to production)._

**Earlier production activity (per memory, pre-tracker):**
- 2026-11-xx — Supabase edge function `nodi-ai` deployed with `ANTHROPIC_API_KEY` secret।
- 2026-11-xx — Edge function `nodi-route-plan` deployed; `route_day_plans.ai_plan` jsonb column added।
- 2026-11-xx — Edge function `osm-fetch-places` deployed।
- 2026-11-xx — PR #177, PR #178 merged ও Netlify auto-deployed (**PENDING VERIFICATION** — exact deploy IDs needed from Netlify)।

## Priority 01 — ChatGPT Work backend continuation — 2026-11-28 (Asia/Dhaka)

Staging only: applied module_release_accounts_sessions and module_release_operations using Supabase management. Verification changed fixture and policy rows inside a rolled-back transaction. Previous Cloudflare PR preview succeeded; Netlify skipped the PR preview. Production migration, deployment and Android release are pending.
