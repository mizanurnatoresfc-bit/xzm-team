# ১. বিদ্যমান সিস্টেম Audit Report (Read-Only)

পদ্ধতি: রিপো (`main`, commit `128653e`) + লাইভ Supabase প্রজেক্ট `xzm-team-erp-dev` (লাইভ প্রজেক্টের আসল আইডেন্টিফায়ার) (ref `ndgnhvbpmtxrpplgsslz`, Singapore, Postgres 17) — কেবল কাঠামো ও Advisor। সংখ্যাগুলো ২৭ নভেম্বর ২০২৬-এর লাইভ থেকে; রিপোর সংখ্যা আলাদা দেখানো হয়েছে।

## ১.১ এক নজরে

| বিষয় | রিপো | লাইভ |
|---|---|---|
| Migration | ১৪০ ফাইল | লাইভে আলাদা সংস্করণ-সারি অনেক (কয়েকটি ভেঙে প্রয়োগ করা) |
| public টেবিল | ~১৮৬ | **১৮১** (সবগুলোতে RLS চালু, ০টি বন্ধ) |
| RLS policy | ২৮১ | ২৫৫ |
| public ফাংশন | — | ৪৬৫ (৪৩৭টি SECURITY DEFINER) |
| private ফাংশন | — | ২৯৮ |
| অনুমতি (permission) | — | **২৪৭**, ১২ মডিউলে (hr 53, ops 62, zonal 26, org 23, vehicle 18, system 17, sorting 16, office 14, da 9, issue 4, notice 3, nodi 2) |
| রোল | ১৫ (ডকুমেন্টে) | **৯** (super_admin, driver, helper, data_entry, loader, zonal_manager, staff, manager, rider) |
| Storage bucket | ৭ | ৭, সব private |
| Cron job (pg_cron) | ৮+ | ৮ (সব কাজ করছে বলে ধরা হয়েছে; শেষ-চালানো যাচাই Phase 2) |
| Edge Function | ৪ (`auth-login`, `admin-users`, `nodi-ai`, `push-send`) | **৬** — বাড়তি: `nodi-route-plan`, `osm-fetch-places` (**রিপোতে সোর্স নেই**) |
| `audit_logs` | append-only, trigger দিয়ে | ৬৪,৭৭৬ সারি |
| Extension | | btree_gist, citext, pg_cron, pg_net, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, supabase_vault, uuid-ossp |
| Frontend | React 19 + Vite 7 + TS 5.9 + react-router 7, `web/src` (২৭০ ফাইল, ১৩১টি পাতা-ফাইল) | Netlify + Cloudflare Workers assets |
| Android | Capacitor 7 (`com.xzmteam.erp`) — **WebView যা `https://xzmteam.com` লোড করে**; APK বানায় GitHub Actions | |
| Timezone | `Asia/Dhaka` (`alter database … set timezone`; `system.timezone` setting; `system_timezone_ok()`) | ✔ |

## ১.২ আর্কিটেকচার (যা আছে)

- **নিয়ম ডাটাবেসে।** অনুমতি = `module.resource.action` (১১টি action)। যাচাই `private.has_permission(code, zone, hub)`; রোল-বরাদ্দ `global | zone | hub` স্কোপে (`user_roles`), ব্যক্তিগত override `user_permission_overrides`। Frontend শুধু দেখায়।
- **Frontend-এ একটাই নেভিগেশন-নিয়ম** `web/src/lib/navAccess.ts` (মেনু, ফোন ট্যাব, কুইক অ্যাকশন, রুট — সবাই একই টেবিল পড়ে; `tests/navAccess.test.mjs` দিয়ে যাচাই)।
- **মেনু দুই জায়গায়:** (ক) কোডে `AppShell.tsx` (গ্রুপ → আইটেম, `perms` সহ) + `accessCatalog.ts` (মডিউল ↔ পারমিশন ম্যাপ); (খ) লাইভ ডাটাবেসে নতুন `menu_items`, `position_menu_access`, `menu_access_history`, `v_user_sidebar` (পদ-ভিত্তিক সাইডবার)। **(খ) রিপোতে নেই** — নিচে "ড্রিফট" দেখুন।
- **Audit:** `private.audit_row()` generic trigger → `audit_logs` (id, occurred_at, actor_id, action, module, table_name, record_id, old/new_data, changed_fields, reason, ip, ua)। UPDATE/DELETE/TRUNCATE অসম্ভব (trigger)।
- **Settings:** `system_settings` (key/value jsonb, `is_public`); প্রায় ১০৫টি key (branding, da.*, hr.*, nodi.*, security.*, workflow.*, workforce.*, zonal.*, vehicle.*)।
- **লগইন:** Edge Function `auth-login` (লকআউট ৫ বার/৩০ মিনিট, `login_events`), `admin-users` (অ্যাকাউন্ট তৈরি/রিসেট)।
- **Notification:** `notifications` টেবিল + live + Capacitor push (`push_devices`, `push-send` Edge + cron প্রতি ২ মিনিটে)।
- **Workflow engine:** `workflow_nudges`, `private.workflow_run()` (cron `wf-engine` ৩০ মিনিট), `wf_*` টেবিল, `tasks`/`task_reminders`/`user_reminders`।
- **AI:** `nodi-ai` Edge Function (Anthropic API, গোপন key সার্ভারে), `nodi.*` settings, `nodi_usage`, দৈনিক সীমা। AI শুধু পড়ে/খসড়া করে।
- **টেস্ট:** `supabase/tests/*.sql` (৯৭ ফাইল, বাস্তব Postgres 16-এ চলে, GitHub Actions `tests.yml`), Node টেস্ট (`navAccess`, `routeModule`, `routePlan`, `routeOffline`, `reportParser`), `scripts/role-demo` (প্রতিটি রোলে পাতা-হাঁটা)।
- **Deploy:** `main`-এ `web/**` বদলালেই GitHub Actions সাইট লাইভ করে (Netlify/Cloudflare) ও APK তৈরি করে।

## ১.৩ রুট ও পাতা

`App.tsx`-এ ১০১টি `<Route>`, ৬০+ lazy পাতা। প্রধান ক্লাস্টার: হিসাব (`/app/accounts/*`), স্টাফ/এইচআর (`/app/staff/*`, `/app/hr/*`), হাজিরা (`/app/attendance`, `/app/hub-registers`), জোনাল (`/app/zonal/*`), রুট কেন্দ্র (`/app/routes`), হাব (`/app/hub/:section`), শটিং (`/app/sorting/:section`), অফিস (`/app/office/*`), গাড়ি (`/app/fleet*`), ইস্যু, নদী AI (`/app/nodi*`), সিস্টেম (`/app/users`, `/app/access/*`, `/app/roles`, `/app/role-dashboards`, `/app/branding`, `/app/menu`, `/app/rollout`, `/secure-control`)। অনেক পুরনো ঠিকানা `RedirectKeep` দিয়ে নতুনে যায় (বুকমার্ক বাঁচাতে)।

**লক্ষণীয়:** `/secure-control` এখন শুধু `Dashboard` রেন্ডার করে (`system.admin_portal.view`) — **কোনো System Control Center নেই।**

## ১.৪ Android স্ক্রিন ম্যাপিং

Android অ্যাপ আলাদা নেটিভ স্ক্রিন নয়; Capacitor WebView একই ওয়েব পাতাগুলো দেখায় (`isNativeApp()`, `advancedAccessHere()` দিয়ে সামান্য পার্থক্য: অ্যাপে পুরনো `/app/roles`, ওয়েবে `/app/access`)। নেটিভ প্লাগইন: Camera, Push, Haptics, StatusBar, App, Browser। সুতরাং **Web ও Android-এর Shared Business Rules আগে থেকেই একই কোডবেস/ডাটাবেস নিয়ম** — System Control Center একবার বানালেই দুই জায়গায় চলবে; Android-এ শুধু ছোট-স্ক্রিন/অফলাইন যাচাই লাগবে। ফিচার-ফ্ল্যাগ প্ল্যাটফর্ম-ভিত্তিক (`web|android|both`) করা সম্ভব (Phase 2)।

## ১.৫ মডিউল ↔ অনুমতি ↔ মেনু (সারাংশ)

`accessCatalog.ts`-এর ১৪টি মডিউল: accounts, hr, hub, ops, zonal, org, sorting, office, fleet, issues, nodi, system। ২৪৭ পারমিশন; যেগুলো কোনো সাব-মেনু দাবি করে না সেগুলো নিজে থেকে "অন্যান্য"-তে যোগ হয়। পুরো ম্যাপ Phase 1-এর Master Function Registry-তে স্বয়ংক্রিয়ভাবে তৈরি হবে (হাতে লিখে নয়)।

## ১.৬ কী নেই (System Control Center-এর শূন্যস্থান)

লাইভ ডাটাবেসে `error|health|backup|release|integration|feature|registry|function_`-নামের কোনো টেবিল নেই। অর্থাৎ নেই: Function Registry, Dependency Map, Error log (শুধু `ErrorBoundary` → `console.error`), Health snapshot, Backup/Recovery রেকর্ড, Release/Approval রেকর্ড, Feature flag, Integration রেজিস্ট্রি, সিস্টেম-ডকুমেন্টেশন সূচি, DEMO/Staging পরিবেশ।

## ১.৭ আবিষ্কৃত সমস্যা (আগে থেকে থাকা — এই কাজ শুরুর আগে/সাথে ঠিক করার সুপারিশ)

| # | সমস্যা | মাত্রা |
|---|---|---|
| A1 | **লাইভ ↔ রিপো ড্রিফট:** লাইভে প্রয়োগ হয়েছে কিন্তু রিপোতে সোর্স নেই — Migration: `role_based_menus`, `role_sidebar_menu_system`, `staff_self_employee_scope`, `hub_registers_pending_release`, `fleet_office_kinds`, `add_ai_plan_to_route_day_plans`; টেবিল/ভিউ: `menu_items`, `position_menu_access`, `menu_access_history`, `v_user_sidebar`; Edge Function: `nodi-route-plan`, `osm-fetch-places`। (`docs/MIGRATIONS_LIVE_MAP.md`-এর নিজের নিয়ম লঙ্ঘিত।) | **উচ্চ** |
| A2 | **Staging/DEMO পরিবেশ নেই।** একমাত্র Supabase প্রজেক্ট নামে `-dev`, কিন্তু আসলে লাইভ (ডাটা আসল)। `main` পুশ = সরাসরি লাইভ সাইট + APK। | **উচ্চ** |
| A3 | ৫১টি টেবিলে `audit_row` trigger নেই (লাইভ গণনা), যার মধ্যে সংবেদনশীল: `employee_sensitive`, `office_secrets`, `permissions`, `menu_items`, `position_menu_access`, `da_cash_payments`, `da_approval_rules`, `sorting_dispatches/_stops/_reports`, `hub_posts`, `zone_posts`, `wf_ops_decisions`, `wf_pending_approvals`। (ঘন-ঘন-লেখা লগ-জাতীয় টেবিল — `notifications`, `login_events`, `push_devices`, `*_seen`, `nodi_usage` — বাদ রাখা যুক্তিসঙ্গত।) | মাঝারি |
| A4 | Supabase Security Advisor: `v_user_sidebar` **SECURITY DEFINER view (ERROR)**; `pg_net` public স্কিমায়; ২টি ফাংশনে `search_path` বাঁধা নেই (`is_menu_admin`, `log_position_menu_change`) — এ দুটি ও `branding` **anon-এ চালানো যায়**; Leaked-password protection বন্ধ। | মাঝারি |
| A5 | ৩৩টি টেবিলে RLS চালু কিন্তু policy ০ (deny-all; শুধু RPC দিয়ে চলে — উদ্দেশ্যমূলক হতে পারে, তবে নথিভুক্ত নয়)। | নিম্ন (নথিভুক্ত করা দরকার) |
| A6 | কোনো ক্লায়েন্ট/সার্ভার Error লগিং নেই; ErrorBoundary শুধু `console.error`। | মাঝারি |
| A7 | ডকুমেন্টেশন অসঙ্গত: ডকুমেন্টে ১৫ রোল/২১২ অনুমতি, লাইভে ৯ রোল/২৪৭ অনুমতি। `docs/*` ও `README`-তে "ই-আর-পি" শব্দ। | নিম্ন |
| A8 | Backup: Free plan — Supabase নিজস্ব PITR/ডেইলি ব্যাকআপ নেই (GO_LIVE_ROADMAP-এ "ব্যাকআপ বাকি" লেখা)। | **উচ্চ** |
| A9 | `docs/AUDIT.md`-এ উল্লেখ: SQL টেস্ট `99f_role_dashboards` ফেল (পুরনো তথ্য; CI-তে বর্তমান অবস্থা Phase 0-তে যাচাই)। | নিম্ন |
