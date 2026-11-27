# Recorded live changes (drift sync)

These four files are **copies of changes that were applied to the live Supabase project but never committed** (found by the System Control Center Phase 0 audit, 27 Nov 2026). The text is unchanged from `supabase_migrations.schema_migrations` on live, so the repository can now rebuild the live state, for example for a Staging project.

They are **not** in `supabase/migrations/` on purpose: `scripts/test-db.sh` and the SQL tests were written before these changes, and two tests correctly fail once they are applied (see below). Adding them to `migrations/` must happen together with the fix migration, after Staging tests and Super Admin approval.

Nothing here is applied to live by this folder.

| File | Live version | What it is |
|---|---|---|
| `20261123084616_add_ai_plan_to_route_day_plans.sql` | 20261123084616 | three `ai_*` columns on `route_day_plans` |
| `20261123210803_staff_self_employee_scope.sql` | 20261123210803 | removes `hr.employee.view` from the `staff` role (data change) |
| `20261125214258_role_based_menus.sql` | 20261125214258 | writes a page list into `role_dashboards.menu` for each non-super role (data change) |
| `20261126142444_role_sidebar_menu_system.sql` | 20261126142444 | `menu_items`, `position_menu_access`, `menu_access_history`, `v_user_sidebar`, `is_menu_admin()` |

## What happens to the tests when these four are applied (checked on a throwaway PostgreSQL 16, 27 Nov 2026)

| Test | Result | Cause |
|---|---|---|
| `99z_role_menu_att_days` ("a role without a list is not limited") | fails | `role_based_menus` gives every role a list |
| `99zzzzzzzzzzzzzzzzzzzzzzzzzzzz_role_demo_audit` ("the only definer function a visitor may call is the public branding") | fails | `log_position_menu_change()` and `is_menu_admin()` can be run by `anon` and have no `search_path` |
| `99n_performance_cleanup` ("every foreign key has an index") | fails **with or without** these files | already failing on `main` before this work (also `position_menu_access.menu_key` has no index) |

## Findings in `role_sidebar_menu_system` (live today)

1. `v_user_sidebar` is a SECURITY DEFINER view (Supabase Advisor ERROR).
2. `is_menu_admin()` and `log_position_menu_change()` are SECURITY DEFINER without `set search_path`, and anon can execute them.
3. `employees.status` values are lower case (`'active'`), but the function and the view test `'Active'`, so the view returns no rows and the "Zonal Manager" branch of `is_menu_admin()` never matches. Only the `is_super` branch works.
4. No page in `web/src` reads these tables. The system is **not wired in**: it must show as *partial* in the System Control Center, not as working.

The fix (search_path, revoke anon, index, status case, `security_invoker` view) is a separate, additive migration. It will be written and tested on Staging first, and reaches live only after Super Admin approval.
