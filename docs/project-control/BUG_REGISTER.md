# BUG_REGISTER

> Open bugs with reproduction, impact, owner, fix status।

Format:
```
### B-###: <title>
- Reported: YYYY-MM-DD
- Severity: critical / high / medium / low
- Area: web / android / db / integration
- Repro: ...
- Expected: ...
- Actual: ...
- Owner: ...
- Status: OPEN / IN_PROGRESS / FIXED / CLOSED
- Fix PR: ...
```

---

## Open

_No bugs registered in this initialization pass. New bugs to be appended here with ID `B-001`, `B-002`, ...。_

## Closed

### B-001: DEMO hub detection in release_context / module_release_save missed the real staging hub codes

- Reported: 2026-11-28
- Severity: **high** (Release Ready / Testing DEMO opt-in would not work against the real staging DB; feature-blocking for Priority 01)
- Area: db (Supabase private functions)
- Repro: staging `mbpjvqeizwjjsvnbjerb` seeds the DEMO hubs with codes `DEMO-HUB`, `DEMO-HUB-2`, `DEMO-HUB-3`. Codex's first migration (`20261128062647_module_release_control.sql`) matched the DEMO hub with `lower(h.code::text) = 'demo'` only. Calling `module_release_save('fleet', 0, '{"demo": true}')` therefore raised `An active DEMO hub is required (22023)`, and `release_context` returned `demo=false` for the DEMO-HUB-assigned manager, so Testing stage never admitted them.
- Expected: `DEMO-HUB` (and any `DEMO-...` hub) counts as a DEMO hub; non-DEMO hubs still do not.
- Actual: only a bare `DEMO` code matched; every real staging hub was treated as non-DEMO.
- Owner: Claude (identified while running T5 on staging on 2026-11-28)
- Status: FIXED
- Fix PR: #226 commit implementing `supabase/migrations/20261128073000_module_release_demo_hub_fix.sql` — DEMO match widened to `lower(code) = 'demo' OR lower(code) LIKE 'demo-%'` in `private.release_context` and in `public.module_release_save`'s DEMO-hub prerequisite. Applied against staging via Supabase MCP `apply_migration`; verified by test T5.4 ("DEMO opt-in lets DEMO hub mgr see fleet_board") which went from FAIL to PASS once the fix landed. Staging-only; production untouched (same migration will apply on next full database CI run against production).
