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

_No entries yet from this control-plane documentation branch (XZM-004 is docs-only, not deployed to production)._

**Earlier production activity (per memory, pre-tracker):**
- 2026-11-xx — Supabase edge function `nodi-ai` deployed with `ANTHROPIC_API_KEY` secret।
- 2026-11-xx — Edge function `nodi-route-plan` deployed; `route_day_plans.ai_plan` jsonb column added।
- 2026-11-xx — Edge function `osm-fetch-places` deployed।
- 2026-11-xx — PR #177, PR #178 merged ও Netlify auto-deployed (**PENDING VERIFICATION** — exact deploy IDs needed from Netlify)।
