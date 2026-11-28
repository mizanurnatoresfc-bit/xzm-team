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

## Hosting architecture (verified 2026-11-28)

- Production host: **Cloudflare Pages** project `xzm-team` (NOT Netlify). Serves `https://xzmteam.com` + `https://www.xzmteam.com`.
- Staging host: Cloudflare Pages `xzm-team-staging-web` → `https://staging.xzmteam.com`.
- Trigger: push to `main` → GitHub integration auto-builds a production deployment on Pages (clone_repo → build → deploy, ≈85 seconds for a typical React/Vite build on this repo). Aliases cut over on success.
- Not in the serving path: Netlify project `xzm-team-erp` (credits ran out 27 Nov 2026, workflow step is `continue-on-error`, PR deploy previews are skipped by `netlify.toml`), Cloudflare Worker `xzm-team` (no routes/custom-domains attached — dormant).
- Supabase prod: project `ndgnhvbpmtxrpplgsslz` (xzm-team-erp-dev, ap-southeast-1). Supabase staging: `mbpjvqeizwjjsvnbjerb` (xzm-team-staging). Migrations applied via MCP `apply_migration` for DE-V2 ownership.

## Entries

## 2026-11-28 — DE-V2-R1 — Senior Rank 1–8 (Data Entry V2 · Release 1)

- **Environment:** production
- **Supabase:** `ndgnhvbpmtxrpplgsslz` (xzm-team-erp-dev). Migration `data_entry_senior_ranks` applied 2026-11-28 ≈12:51 UTC. Post-apply verification SQL: `data_entry_ranks` table present, `data_entry_team_members.rank_id` column present, 4 RPCs (`data_entry_rank_list`, `data_entry_rank_seed_defaults`, `data_entry_rank_save`, `data_entry_rank_assign`) present, `data_entry_team_snapshot` replaced (now returns `rank_id` + `rank_number` per member). Additive migration — no data moved, no RPC signatures broken.
- **GitHub:** PR #228 squash-merged into `main`. Merge commit SHA `45f527a14b4943fc28fdbe03a49df5ec88cbfc90`. CI on head `3b78214`: `database` success, `Workers Builds: xzm-team` success, `Tests` success, `website` success (TypeScript check, Route/Parcel/Offline tests, Build, Browser smoke tests, Offline check-in all green); Netlify checks `neutral` by design — not blockers.
- **Cloudflare Pages:** project `xzm-team`, deployment id `c96265d8-4eff-484b-8661-82f48475379c` (commit `45f527a`, branch `main`, env `production`). Stage timing — queued 12:54:32Z → initialize 12:54:34Z → clone_repo 12:54:35Z → build 12:55:51Z → deploy 12:55:57Z. Aliases `https://xzmteam.com` + `https://www.xzmteam.com` cut over on success.
- **Smoke test:** `GET https://xzmteam.com/` returns `200 OK` with `<title>XZM TEAM</title>` (SPA shell served by Pages' SPA not-found-handling).
- **Migrations applied:** 1 additive DDL (`data_entry_senior_ranks`); zero changes to Phase 1 (PR #207) tables or RPC signatures.
- **Verified by:** Claude (per DE-V2-FULL owner handover 2026-11-28). Owner live-test to confirm UI behaviour in an authenticated Zonal Manager session.
- **Rollback plan:** (1) Revert PR #228 on `main` — Cloudflare Pages auto-redeploys previous commit `008fa7d`. (2) DB — `data_entry_ranks` is RLS-on and revoked from authenticated/anon; leaving the table in place preserves history and does not affect any Phase 1 path (`rank_id` is nullable, downstream code unchanged in R1). To fully roll back the DB: a reverse migration dropping the 4 RPCs, the `rank_id` column, the table, and restoring the prior `data_entry_team_snapshot` body (verified absence of production rows first, since `data_entry_ranks_no_delete` trigger blocks per-row deletes).

**Earlier production activity (per memory, pre-tracker):**
- 2026-11-xx — Supabase edge function `nodi-ai` deployed with `ANTHROPIC_API_KEY` secret।
- 2026-11-xx — Edge function `nodi-route-plan` deployed; `route_day_plans.ai_plan` jsonb column added।
- 2026-11-xx — Edge function `osm-fetch-places` deployed।
- 2026-11-xx — PR #177, PR #178 merged। Hosting chain verified on 2026-11-28 as Cloudflare Pages `xzm-team` (not Netlify); earlier Netlify-attribution lines in older docs are incorrect.
- 2026-11-28 ≈11:50 UTC — PR #207 (Data Entry Phase 1, commit `008fa7d`) auto-deployed to production via Cloudflare Pages.
