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
