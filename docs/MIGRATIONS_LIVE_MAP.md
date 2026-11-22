# Repository migrations ↔ live database (checked 17 Nov 2026)

Every file below has run on the live Supabase project; after the last one the live schema and a database built from these files are the same
(every function body, column, rule, trigger, index, permission and setting compared by fingerprint; line endings ignored — the live copies of
older functions carry Windows line endings). Live versions are the timestamps Supabase gave when they were applied.

**Rule from now on:** write the migration file in `supabase/migrations/` first (Unix line endings), run `scripts/test-db.sh`, then apply that
same text to live. Never change live with SQL that is not in a file here.

`probe_delete` (live 20261115094801) made a scratch function that no longer exists; it has no file. `probe_alter` is part of `vehicle_ops`.

| Repository file | Live migration(s) |
|---|---|
| `20261111000100_foundation.sql` | 20261111000100 foundation |
| `20261111000200_seed_rbac.sql` | 20261111000200 seed_rbac |
| `20261111000300_hr_core.sql` | 20261111000300 hr_core |
| `20261111000400_hr_pay_attendance.sql` | 20261111000400 hr_pay_attendance |
| `20261111000500_hr_import_dashboard.sql` | 20261111000500 hr_import_dashboard |
| `20261111000600_zonal_management.sql` | 20261111000600 zonal_management |
| `20261111000700_courier_operations.sql` | 20261111000700 courier_operations |
| `20261113000800_daily_accounts.sql` | 20261113000800 daily_accounts |
| `20261113000900_business_timezone.sql` | 20261113000900 business_timezone |
| `20261113001000_function_search_path.sql` | 20261113001000 function_search_path |
| `20261113001100_foreign_key_indexes.sql` | 20261113001100 foreign_key_indexes |
| `20261113001200_login_lockout_hook.sql` | 20261113001200 login_lockout_hook |
| `20261113001300_numeric_employee_ids.sql` | 20261113001300 numeric_employee_ids |
| `20261113001400_first_employee_manager.sql` | 20261113001400 first_employee_manager |
| `20261113001500_user_admin.sql` | 20261113001500 user_admin |
| `20261113001600_role_builder.sql` | 20261113001600 role_builder |
| `20261113001700_flexible_import.sql` | 20261113001700 flexible_import |
| `20261113001800_fields_and_referrals.sql` | 20261113001800 fields_and_referrals |
| `20261113001900_formats_and_zonal.sql` | 20261113001900 formats_and_zonal |
| `20261113002000_role_dashboards.sql` | 20261113002000 role_dashboards |
| `20261113002100_expense_categories_voucher.sql` | 20261113002100 expense_categories_voucher |
| `20261113002200_branding.sql` | 20261113002200 branding |
| `20261113002300_vehicles_and_presets.sql` | 20261113002300 vehicles_and_presets |
| `20261113002400_expense_claims.sql` | 20261113002400 expense_claims |
| `20261113002500_sheet_made_easy.sql` | 20261113002500 sheet_made_easy |
| `20261115000100_login_sorting_routes.sql` | 20261115015547 login_sorting_routes |
| `20261115000200_sorting_revoke_anon.sql` | 20261115030004 sorting_revoke_anon |
| `20261115000300_office_management.sql` | 20261115034218 office_management |
| `20261115000400_regions_hub_gps.sql` | 20261115053312 regions_hub_gps |
| `20261115000500_hr_requests.sql` | 20261115064647 hr_requests |
| `20261115000600_sheet_tools.sql` | 20261115072141 sheet_tools |
| `20261115000700_dashboard_views.sql` | 20261115072512 dashboard_views |
| `20261115000800_reference_manual.sql` | 20261115080424 reference_manual |
| `20261115000900_vehicle_management.sql` | 20261115090136 vehicle_management |
| `20261115001000_vehicle_ops.sql` | vehicle_ops_index, vehicle_ops_a, probe_alter, vehicle_ops_b1a, vehicle_ops_b2, vehicle_ops_c, vehicle_ops_d, vehicle_ops_fix_log_list (applied in pieces) |
| `20261115001100_vehicle_requests.sql` | 20261115101409 vehicle_requests |
| `20261115001200_hub_issues.sql` | hub_issues_a_tables … hub_issues_e_storage (applied in pieces) |
| `20261115001300_nodi_ai.sql` | 20261115101754 nodi_ai |
| `20261115001350_nodi_followup_schedule.sql` | 20261115104516 nodi_followup_schedule |
| `20261115001400_performance_cleanup.sql` | 20261115120814 performance_cleanup |
| `20261115001500_id_ready_profiles.sql` | 20261115123319 id_ready_profiles |
| `20261115001600_work_focus.sql` | work_focus_and_zonal_hub_transfer (together) |
| `20261115001700_zonal_hub_transfer.sql` | work_focus_and_zonal_hub_transfer (together) |
| `20261115001800_manpower_and_change_register.sql` | 20261115134755 manpower_and_change_register |
| `20261115001900_sorting_center_hubs.sql` | 20261115140518 sorting_center_hubs |
| `20261115002000_hub_offices.sql` | 20261115141547 hub_offices |
| `20261115002100_store_it_orders.sql` | 20261115155608 store_it_orders |
| `20261115002200_staff_logins_rollout.sql` | 20261115162134 staff_logins_rollout |
| `20261115002300_employee_corrections.sql` | 20261115170234 employee_corrections |
| `20261115002400_attendance_gaps.sql` | 20261115174735 attendance_gaps |
| `20261115002410_manager_ledgers_rider_submit.sql` | 20261115195659 manager_ledgers_rider_submit |
| `20261115002420_cash_payments_refs_approvals_requests.sql` | 20261115200204 cash_payments_refs_approvals_requests |
| `20261115002430_fix_collector_trigger_generic.sql` | 20261115200607 fix_collector_trigger_generic |
| `20261115002440_fix_collector_trigger_generic_2.sql` | 20261115200709 fix_collector_trigger_generic_2 |
| `20261116000100_sheet_check_flow.sql` | 20261116142942 sheet_check_flow |
| `20261116000200_khata_accept.sql` | 20261116151311 khata_accept |
| `20261116000300_role_menu_and_att_days.sql` | 20261116152521 role_menu_and_att_days |
| `20261116000400_hub_logins_and_profile.sql` | 20261116164606 hub_logins_and_profile |
| `20261116000500_dashboard_order.sql` | 20261116172752 dashboard_order |
| `20261116000600_self_attendance.sql` | 20261116192445 self_attendance |
| `20261116000650_report_import.sql` | 20261116213632 report_import |
| `20261116000700_fleet.sql` | fleet + fleet_office_kinds (the three kind rules) |
| `20261116000800_office_operations.sql` | office_operations + fleet_office_kinds |
| `20261117000100_live_notifications.sql` | 20261117040219 live_notifications |
| `20261117000200_phone_push.sql` | 20261117042720 phone_push |
| `20261117000300_sync_live_functions.sql` | 20261117000300 sync_live_functions |
| `20261117000400_foreign_key_indexes_2.sql` | foreign_key_indexes_2 |
| `20261117004000_hub_operations.sql` | hub_operations (function fingerprints match the repo) |
| `20261117010000_workforce_attendance.sql` | 20261117222925 workforce_attendance_a + 20261117223049 workforce_attendance_b1 + 20261117231526 workforce_attendance_b2 (one file, applied in three parts through the MCP client; all 45 `wf_*` function bodies checked equal to the tested file by hash) |
| `20261117004500_advanced_permissions.sql` | advanced_permissions |
| `20261118161122_hub_manager_more_pages.sql` | 20261118161122 hub_manager_more_pages (word for word from live) |
| `20261118161136_remove_nodi_ai_a_rename.sql` | 20261118161136 remove_nodi_ai_a_rename (word for word from live) |
| `20261118190017_staff_app_rls_revoke_anon_definer_execute.sql` | 20261118190017 staff_app_rls_revoke_anon_definer_execute (word for word from live) |
| `20261118200000_workforce_earlier_dates.sql` | 20261118201608 workforce_earlier_dates (one part; all 53 `wf_*` function bodies checked equal to the tested file by hash after applying) |
| `20261118210000_workforce_site_application.sql` | 20261118230228 workforce_site_application (file text; all 53 `wf_*` function bodies checked equal to the tested file by hash after applying) |
| `20261119000100_nodi_features.sql` | 20261119082756 nodi_features (file text without the header comment; replaced functions checked equal to the repository by hash before applying) |
| `20261119020000_zone_group_and_contact.sql` | zone_group_and_contact — objects live, no `schema_migrations` row (approval came after the call timed out); all 12 function bodies checked equal to the repository by hash |
| `20261119030000_route_settings.sql` | route_settings — objects live, no `schema_migrations` row (applied after the tool's approval timed out); all 17 function bodies checked equal to the tested file by hash |
| `20261119040000_route_places.sql` | route_places — objects live, no `schema_migrations` row (run in five parts in the SQL Editor); 3 function bodies equal by hash, 7 upazilas and 665 places counted |
| `20261121000100_office_bill_water_gas.sql` | 20261122143937 office_bill_water_gas — file text without the header comment; before applying, the live `office_bill_save` was read and differed from the file only by the two new kinds; afterwards the kind rule and the function both hold `water` and `gas` |
| `20261121000200_office_export_permissions.sql` | 20261122143944 office_export_permissions — file text without the header comment; afterwards: 2 permissions, 10 roles hold `office.report.export`, `office_log_export` runs for `authenticated` and not for `anon` |
| `20261121000300_staff_panel_audit_fixes.sql` | 20261121112345 staff_panel_audit_fixes — the 5 replaced functions were checked equal to the repository by hash before, and all 6 after |
| `20261121000400_book_full_month.sql` | 20261121133728 book_full_month (file text without the header comment; the two replaced functions were checked equal to the repository before applying; switch tried on and off, left off) |
| `20261121000500_company_sheets.sql` | 20261121165015 company_sheets (file text without the header comment; after applying: 3 sheets (25 / 11 / 17 columns), the ID TRANSFER form has its 3 new-salary boxes, RLS on with 3 policies, nothing for `anon`; the 3 new function bodies equal to the tested file by hash) |
| `20261121000600_route_map_audit_fixes.sql` | 20261122113013 route_map_audit_fixes — applied whole in one call; constraint, index, trigger and the 5 functions checked present afterwards |
| `20261122000100_route_load.sql` | 20261122122659 route_load — applied whole in one call; column, table (RLS, policy, 3 triggers) and the 2 functions checked present afterwards |
| `20261122000200_zonal_status_and_transfer_fixes.sql` | 20261122122644 zonal_status_and_transfer_fixes — applied whole in one call; the 2 functions equal the tested file by hash, 4 roles hold `hr.status.edit` |
| `20261122000300_role_demo_audit_fixes.sql` | 20261122142603 role_demo_audit_fixes — applied whole in one call (owner said yes first); checked afterwards: trigger `hr_requests_tell_approvers` enabled, `branding()` the only definer function a visitor can run, the nine notice/reminder functions still callable when signed in, missing-attendance days 1,450 → 155 with none before 18 Nov |
| `20261122000400_staff_lifecycle.sql` | 20261122151145 staff_lifecycle — applied whole in one call (owner said yes first; file text without the header comment); checked afterwards: the 13 functions equal the tested file by hash, `hr_record_files` has RLS, 1 policy and 2 triggers, the five public functions are closed to visitors |

**Check of 18 Nov 2026 (after the three files above were added):** a database built only from this repository and the live database have the same
613 functions in `public` and `private`, with the same code (compared by hash with comments, spacing and Windows line breaks ignored — 174 live
functions were pasted from Windows and carry `\r\n`, and three advanced-permission functions were applied without their comments). Only
`branding()` may be run by an anonymous visitor on both. Role ↔ permission rows were not compared: the Super Admin changes those from the app.
