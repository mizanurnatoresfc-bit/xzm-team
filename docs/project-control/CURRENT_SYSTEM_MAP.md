# CURRENT_SYSTEM_MAP

> Status: Initial seed from Project memory + CLAUD.txt। Route/table audit PENDING।

---

## 1. Codebase Layout (repo root)

- `web/` — Web frontend source
- `supabase/` — SQL migrations, edge functions, config
- `scripts/` — build/dev scripts
- `demo/` — demo assets
- `docs/` — existing documentation (preserved)
- `docs/project-control/` — this centralised control documentation (NEW)
- `netlify.toml`, `wrangler.jsonc` — deployment configs
- Android build via `make-android.bat` — **source path PENDING VERIFICATION**

## 2. Confirmed Routes (per memory)

| Route | Purpose | Notes |
|---|---|---|
| `/app` | Home dashboard | always visible |
| `/app/staff/list` | Unified staff list | replaces ManagerStaff + ZonalStaff + hr/Employees + hub/team |
| `/app/workforce/hub` | Master attendance | hr/Attendance deleted |
| `/app/hr/attendance`, `/app/hub/attendance`, `/app/hub/late` | redirect → `/app/workforce/hub` |
| `/app/zonal/routes` | Route Settings (9 tabs) | master; sub-tabs: RouteCoverage, RouteLoad, RoutePlaces, RoutePlan |
| `/app/zonal/requests` | Zonal request inbox |  |
| `/app/accounts/mine`, `/app/fleet/mine`, `/app/staff`, `/app/references`, `/app/notices` | Personal rows | follow role menu (PR #178) |
| `/app/nodi/chat` | NODI AI chat UI | user-facing "নদী" |
| `/app/menu` | MenuEditor |  |
| `/app/role-dashboards` | Role list editor |  |
| `/app/access/matrix` | Permission matrix (Phase 1) | PLANNED |
| `/app/access/audit` | Access audit log (Phase 2) | PLANNED |
| `/app/hr/applications`, `/app/hr/leave`, `/app/hr` | DELETED — redirect to new targets |

## 3. Supabase Tables (partial, per memory)

| Table | Notes |
|---|---|
| `da_*` family | Daily accounts — **append-only + prevent_delete triggers** (`private.prevent_delete`, `private.da_append_only`) |
| `route_places` | OSM import target (`source='osm'`) |
| `route_day_plans` | has `ai_plan` jsonb column |
| `role_dashboards` | `menu` jsonb, keyed by role |

**PENDING VERIFICATION:** Full table list via `list_tables` (next turn)।

## 4. RPC Functions (per memory)

- `my_menu`
- `role_menu_list`
- `role_menu_save`
- `menu_layout`
- `menu_layout_save`

## 5. Edge Functions (per memory)

| Function | Purpose |
|---|---|
| `auth-login` | custom auth |
| `admin-users` | admin ops |
| `push-send` | push notifications |
| `nodi-ai` | NODI AI (Claude API via `ANTHROPIC_API_KEY`) |
| `nodi-route-plan` | parcel-based route + manpower suggestion |
| `osm-fetch-places` | Overpass API → `route_places` |

## 6. Menu Structure (AppShell.tsx, per memory)

Sections: **HOME · ACCOUNTS · HR · OFFICE · ROUTES · SORTING · ADMIN**

Access helpers: `navAccess.ts` → `inMenu()`, `pageAllowed()`, `linkAllowed()`।

## 7. Known Policies

- Hub switcher dropdown: **একটিই জায়গায় (global header)** — অন্য pages context থেকে পড়ে।
- Audit history: `da_*` tables কখনো mutate হয় না; wipe করতে SQL editor-এ trigger disable লাগে।
- Sidebar rule (PR #178): personal rows role-menu follow করে, URL access অপরিবর্তিত।

## 8. Open Structural Questions — PENDING VERIFICATION

- Android source path ও build system
- সম্পূর্ণ route list (code-ভিত্তিক scan দরকার)
- সম্পূর্ণ table list (Supabase introspection)
- RLS policies summary
- `menu_items + position_menu_access` — status: first-attempt pending drop (Supabase prompt time-out)
