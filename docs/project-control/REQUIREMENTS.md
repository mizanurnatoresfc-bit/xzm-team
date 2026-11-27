# REQUIREMENTS

> Open requirements, roadmap items, feature backlog।

---

## 1. Approved & In-Progress

| ID | Requirement | Status |
|---|---|---|
| R-001 | Staff list consolidation (`/app/staff/list`) | DONE (per memory) |
| R-002 | Attendance consolidation (`/app/workforce/hub`) | DONE (per memory) |
| R-003 | Route pages structure (`/app/zonal/routes` 9 tabs) | KEPT AS-IS |
| R-004 | NODI AI chat UI + edge function | DEPLOYED |
| R-005 | NODI route-plan edge function | DEPLOYED |
| R-006 | OSM place fetch edge function | DEPLOYED |
| R-007 | Sidebar personal-row rule (PR #178) | MERGED |
| R-008 | Route setup "OSM load" + "Draw area" (PR #177) | MERGED |
| R-009 | HR page cleanup (hr/applications, hr/leave, hr) | DONE |

## 2. Planned / Backlog

| ID | Requirement | Phase |
|---|---|---|
| R-010 | Permission matrix at `/app/access/matrix` | Phase 1 |
| R-011 | Audit log + DB triggers + `/app/access/audit` | Phase 2 |
| R-012 | Zonal Command Center (research closed loop) | Build |
| R-013 | Hub Problem Center (support-ticket flow) | Build |
| R-014 | Zonal Operation Research Center — 3 menus (Virtual / Route / Central Operation) | Build |
| R-015 | Virtual menu — Staff Profile Card curator | Build |
| R-016 | Central Operation Data layer — Manual mode primary | Build |
| R-017 | Future SteadFast API + authorized Data Collector adapters | Research |
| R-018 | Position-based `role_dashboards` extension | In-flight (pending drop of first attempt) |
| R-019 | দেনা-পাওয়া module — MFS statement upload + ledger | Build |
| R-020 | HR Records auto-file on one-click status change | Build |

## 3. Non-Functional

- Bengali-first UI।
- Role-based visibility filter (Virtual menu-তে curator pattern)।
- Append-only audit on `da_*` + route assignment।
- Hub data isolation enforced by RLS।
- Android parity for core staff flows।

## 4. Backend Contract Items (for ChatGPT Backend Team)

- RLS review for new permission matrix।
- Trigger policy for route assignment history।
- Schema for Central Operation Data `source_type` metadata।
- Query/perf review for consolidated staff/attendance pages।

## 5. Open Questions

- Supabase `xzm-team-staging` project-এর ownership ও intended use (created 2026-11-27, newly spotted)।
- Android build toolchain ও current version string।
- Netlify production branch ও deploy hook configuration।
- Cloudflare DNS/SSL/Proxy configuration।
