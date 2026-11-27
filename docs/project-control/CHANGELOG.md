# CHANGELOG

> Human-readable change log, reverse chronological। Follows task IDs।

---

## 2026-11-27

- **XZM-005:** `TASK_TRACKER.md` 15-field schema + 14 categories + XZM-001…009 records; `AI_HANDOVER.md` section 4.1 (Shared Task Tracker) added। Separate branch + Draft PR।
- **XZM-004:** `docs/project-control/` ফোল্ডার তৈরি — PROJECT_MASTER, PROJECT_CONNECTIONS, CURRENT_SYSTEM_MAP, COMPANY_RULES, REPORT_FORMATS, REQUIREMENTS, TASK_TRACKER, DECISION_LOG, AUDIT_REPORT, BUG_REGISTER, TEST_REPORT, CHANGELOG, DEPLOYMENT_LOG, AI_HANDOVER — 14 ফাইল seed। Existing `docs/` অপরিবর্তিত।
- **XZM-003 (partial):** GitHub + Supabase connection verified; Netlify / Cloudflare / Figma+Subframe pending।
- **Supabase:** New project `xzm-team-staging` (`mbpjvqeizwjjsvnbjerb`, ap-southeast-1) spotted — ownership confirmation PENDING।

## 2026-11-26

- Sidebar personal-rows rule shipped (PR #178)।

## 2026-11 (earlier)

- Route setup OSM load + draw area (PR #177)।
- HR page cleanup — `/app/hr/applications`, `/app/hr/leave`, `/app/hr` deleted; redirects to `/app/staff/list`, `/app/zonal/requests`, `/app/staff`।
- Staff consolidation → `/app/staff/list`।
- Attendance consolidation → `/app/workforce/hub`; old URLs redirect।
- NODI AI chat UI + edge functions `nodi-ai`, `nodi-route-plan`, `osm-fetch-places` deployed।
