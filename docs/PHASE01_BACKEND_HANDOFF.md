# Phase 01 — backend / permission notes for ChatGPT

Written by Claude (frontend) while unifying navigation access in `web/src`. **Nothing under `supabase/` was changed.**
Frontend hiding is not authorization: every item below is something the database should confirm or decide.

## What the frontend now assumes (one rule, one table)

`web/src/lib/navAccess.ts` is the single frontend rule. The sidebar, the phone tabs, the quick actions, the dashboard report-upload card
and the page routes (`ProtectedRoute`) all call it. The table `pagePermissions` there lists what each page needs (a person needs **any one** of the listed grants):

| Page | Needs (any of) |
|---|---|
| `/app/staff/list` | `hr.employee.view`, `hr.application.create`, `hr.request.create` |
| `/app/attendance` | nothing (everybody opens their own book); **hub part**: `hr.attendance.view` or `ops.staff_daily.view`; **zone part**: `zonal.dashboard.view` |
| `/app/hub/pickup` | `ops.pickup.view`, `ops.pickup_as_{hub_manager,pickup_manager,rider}.create` |
| `/app/hub/tasks` / `ops` / `accounts` / `logins` / `routes` | `zonal.task.{view,create}` / `zonal.hub_metric.{view,create}` / `da.sheet.{view,create}` / `system.user_hub.create` / `ops.route.{view,edit}` |
| `/app/zonal`, `/app/zonal/hub-ops`, `/app/zonal/requests`, `/app/zonal/hr-records`, `/app/zonal/files`, `/app/zonal/routes` | see the file |
| `/app/training`, `/app/nodi/chat` | zonal level only (`panelLevel === 2`: `zonal.dashboard.view`, `system.user.view` or `hr.request.approve`), plus the Nodi grants for chat |
| accounts, users, roles, access, branding, menu, referrals, import … | see the file |

Previously the route-level grants lived in four places (App.tsx `AnyOf` / `ProtectedRoute permission=`, `HubManagement.HUB_SECTIONS`, AppShell item lists, `menu.ts`). They now come from this table; `tests/navAccess.test.mjs` (`npm run test:nav`) fails if a menu row asks for different grants than its page.

## Questions / decisions for the backend

1. **`my_menu()` failure and empty cases** — `supabase/migrations/20261116000300_role_menu_and_att_days.sql` (`public.my_menu`).
   - The frontend treats an RPC error as "page list unknown": every work page shows a retry card and no link is offered (only `/app/password` opens). It never falls back to "no limit".
   - The function returns `null` (= no limit) when the user has **no active `user_roles` row** (`not exists (select 1 from mine)`), and when *any* role has no list or is super. A user with no valid role therefore gets "no page limit" (they also hold no grants, so the pages say "no permission", but please confirm that `null` for "no role" is intended; `[]` may be safer).
2. **`hr.attendance.create` alone.** The attendance page opens its hub part only for `hr.attendance.view` / `ops.staff_daily.view` (as on `main`). A user with `create` but no `view` lands on their own page, so the quick action "হাজিরা দিন" is now **hidden** for them. Should `create` imply the hub part (then `wf_hub_overview` must return `can.attendance` for it), or stay as is?
3. **Zone data of the attendance page.** The zone part reads every hub's final register through `att_zone_day` (`web/src/lib/attSheet.ts`, used by `ZoneFinal.tsx`) and the pickup/delivery numbers and setting through `wf_ops_report`, `wf_windows`, `wf_window_save`, `wf_window_end`, `wf_book_mode`, `wf_book_full_month_set` (`web/src/lib/workforce.ts`, `ZoneOps.tsx`, `ZoneWindows.tsx`). Please confirm these check `zonal.dashboard.view` / zone-hub scope in the database, not only the zone tab being hidden. The hub part follows `wf_hub_overview` (`20261117010000_workforce_attendance.sql:838`), whose `can.attendance` / `can.ops` per hub decide the hub tabs.
4. **Zonal-only pages.** Training and Nodi AI chat are hidden for staff and managers by the frontend level rule. If they must also be closed server-side, the Nodi/Training endpoints need the same check; nothing was changed here.
5. **Hub sections** (`/app/hub/:section`, `web/src/pages/hub/HubManagement.tsx`): the section grants above should match the RPC/RLS of pickup, tasks, hub metrics, logins and rider routes. The frontend only decides which tabs to show.
6. **Migrations live but not in `main`** (from PR #144's note): `master_audit_fixes`, `att_self_line_and_manager_roles`, `staff_self_employee_scope`, `add_ai_plan_to_route_day_plans`. The frontend was not checked against a database that has them.
7. **Real role accounts.** The frontend checks used the browser smoke test with faked grants (`web/tests/smoke.mjs`) and the pure rule tests. Nobody has signed in as a real Staff / Manager / Zonal Manager account yet.
8. **Backlog (data, not code).** PR #144 reported 31 staff attendance inputs waiting since 1 Nov and no final register; this change does not clear it.

## Not decided here (owner)

- No "approved Master Architecture" document is in the repo (`docs/ARCHITECTURE.md` is a Phase 0 draft); the permission contract above is read from the code on `main`.
