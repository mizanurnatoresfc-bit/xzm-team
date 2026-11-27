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
