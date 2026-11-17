# XZM-TEAM ERP — পুরো প্রজেক্টের অডিট রিপোর্ট

তারিখ: ১৭ নভেম্বর ২০২৬ · যে কোড দেখা হয়েছে: `main` (commit `761c878`) + ব্রাঞ্চ `claude/office-operations-management-s593gh`

> **এই ফাইলটা কীভাবে ব্যবহার করবেন:** পুরো ফাইলটা ChatGPT বা অন্য যেকোনো AI-কে দিন। এতে প্রজেক্ট কী, কীভাবে বানানো, কোন পাতায় কী হয়, ডাটাবেস কেমন, কী লাইভ আছে, কী সমস্যা আছে আর কী বাকি — সব এক জায়গায় আছে।
> এই ফাইলে কোনো গোপন key বা পাসওয়ার্ড নেই। AI-কে কখনো service-role key, ডাটাবেস পাসওয়ার্ড বা Netlify token দেবেন না।

**সংখ্যাগুলো কোথা থেকে:** ডাটাবেসের সংখ্যা রিপোর সব migration একটা আলাদা পরীক্ষার ডাটাবেসে চালিয়ে গোনা। লাইভের অবস্থা Supabase থেকে শুধু পড়ে দেখা (migration তালিকা, Edge Function তালিকা, security advisor) — লাইভে কিছু বদলানো হয়নি।

---

## ০. মূল দর্শন

**Less Work, More Automation, Better Manage.** (মালিকের কথা, ১৭ নভেম্বর ২০২৬)

- **Less Work:** মানুষ যত কম লিখবে তত ভালো — এক ক্লিক, আগে থেকে বসানো তথ্য, একই তথ্য দুবার নয়।
- **More Automation:** যা সিস্টেম নিজে পারে তা নিজে করবে — স্ক্রিনশট থেকে তথ্য পড়া, নম্বর ও মেমো তৈরি, হিসাব মেলানো, নোটিফিকেশন, সতর্কতা।
- **Better Manage:** ম্যানেজার এক নজরে দেখবেন কী আটকে আছে, কে দায়িত্বে, আগে কী করা দরকার।

নতুন যেকোনো ফিচার বা বদল এই তিন প্রশ্নে যাচাই হবে: কাজ কমল কি? নিজে থেকে হলো কি? ম্যানেজ করা সহজ হলো কি?

---

## ১. এক নজরে

| বিষয় | তথ্য |
|---|---|
| কী | কুরিয়ার ব্যবসার ERP: হেড অফিস → রিজিয়ন → এরিয়া (জোন) → হাব। HR, হাজিরা, দৈনিক হিসাব খাতা, গাড়ি, শটিং সেন্টার, ইস্যু, অফিস, AI সহকারী। |
| কারা ব্যবহার করে | মালিক (সুপার অ্যাডমিন), জোনাল ম্যানেজার, হাব ম্যানেজার, হিসাব, HR, রাইডার/স্টাফ, ড্রাইভার-হেল্পার |
| ভাষা | বাংলা (মূল) + English; ডার্ক মোড আছে |
| Frontend | React 19, Vite, TypeScript, react-router 7 — ফোল্ডার `web/` |
| মোবাইল অ্যাপ | একই সাইট Capacitor 7 দিয়ে Android APK |
| Backend | Supabase: PostgreSQL 16, Auth, Storage, Edge Functions (Deno) |
| নিয়ম কোথায় | সব অনুমতি ও ব্যবসার নিয়ম ডাটাবেসে (RLS + ডাটাবেস ফাংশন)। ব্রাউজারের কোড শুধু দেখায়। |
| লাইভ সাইট | https://xzm-team-erp.netlify.app (স্টাফ লগইন `/staff/login`) |
| Hosting | Netlify (ফ্রি)। build হয় GitHub Actions-এ, `main`-এ `web/**` বদলালে নিজে deploy হয় |
| Supabase | প্রজেক্ট `xzm-team-erp-dev`, Singapore, Free plan — নামে "dev" হলেও এটাই লাইভ |
| কোড | GitHub private repo `mizanurnatoresfc-bit/xzm-team` |
| সময় অঞ্চল | Asia/Dhaka |

### আকার

| | সংখ্যা |
|---|---|
| ডাটাবেস migration | ৫৭টা ফাইল, ~১৮,৭০০ লাইন SQL |
| টেবিল | ১১৫টা — সবগুলোতে RLS চালু, policy ছাড়া একটাও নেই |
| RLS policy | ২১৪টা |
| ডাটাবেস ফাংশন | public ৩০৮টা (২৭১টা SECURITY DEFINER), private ১৫৪টা — সবগুলোতে `search_path` বাঁধা |
| অনুমতি (permission) | ২১২টা, ১১টা মডিউলে |
| রোল | ১৫টা (নিচে তালিকা) |
| Storage bucket | ৬টা, সব private |
| Edge Function | ৩টা: `auth-login`, `admin-users`, `nodi-ai` |
| Frontend কোড | ~১৯,১০০ লাইন, ৬৫টা পাতার ফাইল, মেনুতে ৯০টা লিংক |
| SQL টেস্ট | ৪৪টা ফাইল, ১,২০৩টা যাচাই পাস, ১টা ফাইল ফেল (`99f_role_dashboards`) |

---

## ২. কীভাবে বানানো (architecture)

```
ব্রাউজার / Android অ্যাপ (React)
   │  publishable key + ইউজারের লগইন টোকেন
   ▼
Supabase API ──► PostgreSQL
                  ├─ RLS policy: কে কোন সারি দেখবে/লিখবে
                  ├─ public ফাংশন (RPC): টাকা, অনুমোদন, বদলি — সব লেখা এখান দিয়ে
                  ├─ private ফাংশন: অনুমতি যাচাই, নোটিফিকেশন, অডিট
                  └─ audit_logs: কে কী বদলাল (মোছা যায় না)
Edge Functions (গোপন key শুধু এখানে)
   ├─ auth-login  : লগইন, ৫ বার ভুলে ৩০ মিনিট লক
   ├─ admin-users : স্টাফ অ্যাকাউন্ট তৈরি, পাসওয়ার্ড রিসেট
   └─ nodi-ai     : Anthropic (Claude) API — নদী AI
```

**অনুমতির নিয়ম (RBAC):** রোল → অনুমতির তালিকা। রোল দেওয়া হয় তিন স্তরে: `global` (পুরো কোম্পানি), `zone` (এক এরিয়া), `hub` (এক হাব)। মূল যাচাই `private.has_permission(perm, zone, hub)`। সুপার অ্যাডমিন নিজে রোল বানাতে, অনুমতি টিক দিতে, রোল অনুযায়ী মেনু ও ড্যাশবোর্ড ঠিক করতে পারেন।

**রোল (১৫):** super_admin, admin, head_office_manager, operations_manager, zonal_manager, zonal_assistant, hub_manager, pickup_manager, delivery_manager, hr_manager, accounts_manager, accountant, auditor, rider, staff।

**অনুমতির মডিউল:** hr (৫০), ops (৪৭), org (২৩), zonal (১৯), sorting (১৬), vehicle (১৬), system (১৫), office (১২), da — দৈনিক হিসাব (৮), issue (৪), nodi (২)।

**মূল নীতি:**
- কিছুই মোছা হয় না — কারণ লিখে archive করা হয়; `prevent_delete` trigger সব গুরুত্বপূর্ণ টেবিলে।
- প্রতিটা বদল `audit_logs`-এ যায় (পাসওয়ার্ডের টেবিল বাদে)।
- নম্বর নিজে তৈরি হয়: `HR-00001`, `IS-00001`, `VR-`, `VQ-`, `V-YYMM-00001` (ভাউচার), `ON-00001`, `OM-YYMM-00001`।
- স্টাফের দেওয়া তথ্য (হাজিরা, বিল, তেল) ম্যানেজার অনুমোদন দিলে তবেই গোনা হয়।

---

## ৩. ফোল্ডার

```
web/src/pages/        পাতা (accounts, hr, hub, zonal, org, fleet, sorting, office, issues, nodi, users, staff)
web/src/lib/          প্রতিটা মডিউলের ডাটা আনা-নেওয়া (dailyAccounts.ts, hr.ts, fleet.ts, office.ts …)
web/src/components/   AppShell (মেনু ও টপবার), DataTable, inputs, OsmMap …
web/src/auth/         AuthProvider (সেশন, অনুমতি, "রোল হিসেবে দেখুন")
supabase/migrations/  ডাটাবেস — ক্রমানুসারে; পুরোনো ফাইল বদলানো নিষেধ, নতুন ফাইল যোগ হয়
supabase/tests/       SQL টেস্ট (scripts/test-db.sh)
supabase/functions/   Edge Functions
docs/                 ARCHITECTURE, PROGRESS, AUDIT, CREDENTIALS, ANDROID, এই ফাইল
HANDOVER.md           চলমান ইতিহাস — প্রতিটা কাজের পর নিচে যোগ হয়
demo/                 পুরোনো এক-ফাইলের ডিজাইন ডেমো (লাইভ নয়)
```

---

## ৪. মডিউল ও পাতা

| মডিউল | ঠিকানা | কী হয় |
|---|---|---|
| পাবলিক | `/`, `/terms`, `/staff/login` | হোম, শর্তাবলি, লগইন |
| হোম | `/app` | স্টাফ হলে স্টাফ প্যানেল, বাকিদের রোল অনুযায়ী ড্যাশবোর্ড |
| স্টাফ প্যানেল | `/app/staff` | স্টাফের পুরো দিন এক ফোন স্ক্রিনে: হিসাব, হাজিরা, বিল, রুট, অভিযোগ, ইস্যু |
| দৈনিক হিসাব খাতা | `/app/accounts/daily`, `/daily/:id`, `/daily/:id/main`, `/khata`, `/mine`, `/reports`, `/settings` | হাবের দিনের খাতা: রাইডার → মার্চেন্ট পেমেন্ট → খরচ → কর্মীর বিল → ব্যাংক ডিপোজিট → দিন শেষ। স্ক্রিনশট থেকে তথ্য পড়া (OCR), ভাউচার, ২৪টা খরচের খাত, ড্রাফট → জমা → চেক → অনুমোদন |
| HR | `/app/hr`, `/employees`, `/employees/:id`, `/applications`, `/attendance`, `/leave`, `/requests`, `/duties`, `/profile-gaps`, `/referrals`, `/import`, `/fields` | কর্মী, আইডি আবেদন, হাজিরা, ছুটি, HR রিকুয়েস্ট (ID create/transfer/active/inactive), Excel ইমপোর্ট, প্রোফাইলের ঘর ও এক্সপোর্ট ফরম্যাট |
| হাব | `/app/hub/:section` | হাবের টিম, আজকের হাজিরা খাতা (স্টাফ নিজে দেন, ম্যানেজার অনুমোদন), হাবের লগইন |
| জোন | `/app/zonal`, `/zonal/staff`, `/zonal/files`, `/zonal/assistant`, `/manpower` | জোনের ড্যাশবোর্ড, হাব অনুযায়ী কর্মী (বদলি, আইডি দেওয়া), জনবল |
| প্রতিষ্ঠান | `/app/org`, `/org/hubs` | রিজিয়ন/এরিয়া/হাব/বিভাগ/পদবি, হাবের ম্যাপ (OpenStreetMap, GPS) |
| গাড়ি | `/app/fleet`, `/fleet/mine` | জোনের গাড়ি হাবে দেওয়া, ড্রাইভার-হেল্পার, খোরাকি, গ্যারেজ চার্জ, তেলের স্লিপ, সার্ভিস রিকুইজিশন, হাব রিপোর্ট |
| শটিং সেন্টার | `/app/sorting/:section` | সেন্টার, রুট, পার্সেল এন্ট্রি, তেলের রিকুয়েস্ট, ট্রিপ |
| ইস্যু | `/app/issues` | ইস্যু/কাজ দেওয়া, স্টোর ও আইটি অর্ডার, হাবের গ্রুপ পোস্ট |
| অফিস | `/app/office/:section` | অফিস/আবাসিক/গ্যারেজ, রুম ও দিক, ডেস্ক, রিসোর্স; নতুন: ভাড়া ও চুক্তি, বিল, বিদ্যুৎ হিসাব, তালা/সিসি/পাসওয়ার্ড, কারা থাকেন, নষ্ট/লাগবে রিপোর্ট, জোনের চিত্র |
| নদী AI | `/app/nodi/chat`, `/app/nodi` | চ্যাট ও কণ্ঠ; AI ইউজারের নিজের অনুমতিতেই ইস্যু তৈরি/পোস্ট করে; দৈনিক সীমা ও মডেল সেটিং |
| সিস্টেম | `/app/users`, `/roles`, `/role-dashboards`, `/branding`, `/rollout`, `/training`, `/settings`, `/me`, `/password` | ইউজার ও রোল, রোলের মেনু ও ড্যাশবোর্ড, নাম-লোগো-রঙ, স্টাফ লগইন চালু করা |

**মেনুর ভাগ:** আজকের কাজ · গাড়ি · হাবের হিসাব · হাবের টিম · জোন ও হাব · কর্মী ও HR · হিসাব · শটিং সেন্টার · অফিস · সেটিং ও অনুমতি। মেনু তিন স্তরে আলাদা: স্টাফ, ম্যানেজার, জোনাল ম্যানেজার।

---

## ৫. ডাটাবেসের মূল টেবিল (দলে দলে)

- **ভিত্তি:** organizations, regions, zones, hubs, departments, positions, profiles, roles, permissions, role_permissions, user_roles, system_settings, audit_logs, login_events, notifications
- **HR:** employees, employee_sensitive (NID), employee_assignments, employee_compensation, employee_documents, employee_applications, attendance_records, attendance_self_marks, leave_requests, hr_requests, hr_request_formats
- **দৈনিক হিসাব (`da_`):** da_sessions (দিনের খাতা), da_expenses, da_expense_claims, da_expense_templates, da_cells, da_events …
- **কুরিয়ার:** parcels, merchants ও সংশ্লিষ্ট অপারেশন টেবিল
- **গাড়ি:** vehicles, vehicle_assignments, vehicle_logs, vehicle_documents, vehicle_requests, vehicle_requisitions, vehicle_day_logs, vehicle_hub_reports, vehicle_events
- **শটিং:** sorting_centers ও রুট/ট্রিপ/তেলের টেবিল
- **ইস্যু:** issues, hub posts
- **অফিস:** office_properties, office_rooms, office_desks, office_assets, office_bills, office_asset_loans, office_residents, office_secrets, office_notices
- **AI:** nodi_usage

**Storage bucket (সব private):** employee-docs, da-evidence, sorting-slips, vehicle-docs, issue-photos, office-docs।

---

## ৬. Deploy কীভাবে হয়

1. **সাইট:** `main`-এ `web/**` বদলে push → GitHub Actions build করে → netlify-cli দিয়ে আপলোড। Netlify-তে build চলে না।
2. **Android APK:** Actions থেকে হাতে "Run workflow" → `XZM-TEAM-apk` নামিয়ে ইনস্টল। অ্যাপের ভেতরে "আপডেট করুন" বার আছে।
3. **ডাটাবেস:** নতুন migration ফাইল Supabase-এ হাতে বসাতে হয় (SQL Editor বা MCP)। **এটা নিজে হয় না** — এখানেই সবচেয়ে বড় ঝুঁকি (নিচে ৮.১)।
4. **Edge Function:** আলাদা করে deploy করতে হয়।

---

## ৭. যা ভালো আছে

- সব ১১৫টা টেবিলে RLS, আর অনুমতি যাচাই ডাটাবেসে — ব্রাউজারের কোড বদলে কেউ বাড়তি ডাটা পাবে না।
- লগইন ছাড়া (anon) শুধু দুটো জিনিস পড়া যায়: পাবলিক ব্র্যান্ডিং সেটিং আর `branding()` ফাংশন। আর কিছু না।
- সব SECURITY DEFINER ফাংশনে `search_path` বাঁধা; সব foreign key-তে index আছে।
- গোপন key রিপোতে নেই (স্ক্যান করে দেখা)। build-এ secret key ধরা পড়লে Actions থেমে যায়।
- `npm audit`: ০টা দুর্বলতা। নির্ভরতা কম (React, Supabase, Capacitor, lucide)।
- নিরাপত্তা হেডার আছে: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy।
- ১,২০০+ SQL টেস্ট — অনুমতি, টাকার হিসাব, অনুমোদনের ধাপ।
- পাতা আলাদা আলাদা লোড হয় (lazy), তাই প্রথম স্ক্রিন হালকা।

---

## ৮. যা সমস্যা — গুরুত্ব অনুযায়ী

### ৮.১ ✅ (১৭ নভেম্বর ঠিক করা হয়েছে) লাইভ ডাটাবেস আর রিপো এক নয়

> ঠিক করা হয়েছে: লাইভের সব migration ও ১৯টা ফাংশন রিপোতে আনা হয়েছে, ১৭টা index যোগ, সব টেস্ট পাস। দেখুন `docs/MIGRATIONS_LIVE_MAP.md`।

এটাই সবচেয়ে বড় সমস্যা। তিন রকম অমিল:

**(ক) রিপোতে আছে, লাইভে বসানো নেই:**
- `20261116000700_fleet` — গাড়ির নতুন অংশ। লাইভের migration তালিকায় নেই, আর লাইভের ফাংশন তালিকায় একটাও `fleet_…` ফাংশন পাওয়া যায়নি। অথচ `/app/fleet` পাতা `main`-এ আছে, মানে সাইটে লাইভ। **সম্ভবত লাইভ সাইটে গাড়ির পাতা এখন কাজ করছে না** ("ডাটাবেসে এখনো বসানো হয়নি" দেখাবে)। সাইট খুলে একবার দেখে নিন।
- `20261116000800_office_operations` — অফিস অপারেশন (এখনো ব্রাঞ্চে, merge হয়নি)।

**(খ) লাইভে আছে, রিপোতে নেই:** `manager_ledgers_rider_submit`, `cash_payments_refs_approvals_requests`, `fix_collector_trigger_generic`, `fix_collector_trigger_generic_2`, `nodi_followup_schedule`, `report_import` (সাথে `da_report_*` ফাংশন), আর `probe_delete`, `probe_alter` নামে দুটো পরীক্ষামূলক migration।

**(গ) একই নামের ফাংশন দুই জায়গায় আলাদা:** `da_save_expense`, `vehicle_assign`, `vehicle_day_save`, `vehicle_log_save`।

**কেন বিপদ:** রিপো থেকে ডাটাবেস আবার বানানো যাবে না; টেস্ট পাস করলেও লাইভে আলাদা আচরণ হতে পারে; নতুন ডেভেলপার বা AI ভুল ধারণা নিয়ে কাজ করবে।
**করণীয়:** লাইভ থেকে (খ) ও (গ)-এর SQL তুলে রিপোতে migration ফাইল হিসেবে রাখা; (ক) লাইভে বসানো; এরপর থেকে নিয়ম — migration লাইভে বসানোর আগে রিপোতে commit।

### ৮.২ 🔴 ব্যাকআপ

Supabase Free plan-এ চলছে। এই plan-এ ব্যাকআপ ও পুরোনো অবস্থায় ফেরার সুবিধা খুব সীমিত, আর প্রজেক্ট কিছুদিন ব্যবহার না হলে থেমে যেতে পারে — Supabase ড্যাশবোর্ডে এখনকার নিয়ম দেখে নিন। কর্মীর NID, বেতন, টাকার হিসাব এখানে আছে। নিজে নিয়মিত ডাটাবেস dump রাখার ব্যবস্থা নেই।
**করণীয়:** Pro plan, অথবা সপ্তাহে অন্তত একবার `pg_dump` নিয়ে আলাদা জায়গায় রাখা।

### ৮.৩ 🟠 নিরাপত্তা

| # | বিষয় | করণীয় |
|---|---|---|
| ১ | অফিসের সিসি/রাউটার/পিসির পাসওয়ার্ড (`office_secrets`) ডাটাবেসে সাধারণ লেখা হিসেবে থাকে। RLS দিয়ে সীমিত, অডিট লগে যায় না — তবু ডাটাবেস ফাঁস হলে পড়া যাবে। | মেনে নেওয়া, অথবা encrypt করা (pgcrypto / Vault) |
| ২ | Supabase advisor: "Leaked password protection" বন্ধ | Auth সেটিং থেকে চালু করা |
| ৩ | `Content-Security-Policy` হেডার নেই | `netlify.toml`-এ CSP যোগ |
| ৪ | OCR টুল (Tesseract) বাইরের CDN থেকে লোড হয়, যাচাই (SRI) ছাড়া | নিজের সাইটে রাখা বা SRI দেওয়া |
| ৫ | তিনটা Edge Function-ই `verify_jwt = false`। কোডের ভেতরে টোকেন যাচাই হয় — ঠিক আছে, তবে নতুন function বানালে ভুলে যাওয়ার ঝুঁকি | নতুন function-এ একই যাচাই রাখা |
| ৬ | "Customize Access Token" hook চালু আছে কি না রিপো থেকে বোঝা যায় না (লক/বন্ধ অ্যাকাউন্ট আটকানোর জন্য) | Auth → Hooks-এ দেখে নেওয়া |
| ৭ | নিজস্ব SMTP নেই — পাসওয়ার্ড রিসেট ইমেইল Supabase-এর সীমিত মেইলে | SMTP বসানো |
| ৮ | Supabase advisor: SECURITY DEFINER ফাংশন লগইন করা ইউজার ডাকতে পারে (সতর্কতা) | এটা ডিজাইন অনুযায়ী — প্রতিটা ফাংশন ভেতরে অনুমতি যাচাই করে; নতুন ফাংশনেও তা রাখতে হবে |

### ৮.৪ 🟠 মান ও টেস্ট

- `99f_role_dashboards.sql` ফেল করে ("nine panels" গোনা — প্যানেল বেড়েছে, টেস্ট বদলানো হয়নি)। পুরোনো সমস্যা, কিন্তু ফেল থাকলে আসল ভাঙন চোখ এড়াবে।
- SQL টেস্ট GitHub Actions-এ চলে না — শুধু হাতে চালালে চলে।
- Frontend-এ কোনো unit test বা lint নেই; একটা smoke script আছে (`web/tests/smoke.mjs`), CI-তে চলে না।
- `supabase/apply-all-dev.sql` পুরোনো — নতুন migration এতে নেই।
- `HANDOVER.md`-এর উপরের অংশ পুরোনো (২৫টা migration, ৬৮টা টেবিল, "একমাত্র ইউজার মালিক" লেখা); আসল ছবি নিচের তারিখওয়ালা অংশে।

### ৮.৫ 🟡 পারফরম্যান্স

- মূল JS ফাইল ~৪০৪ KB + Supabase ~২২৪ KB + CSS ~১৬৮ KB (gzip-এর আগে)। ধীর ফোনে প্রথম লোড ভারী।
- ৩৭টা RLS policy-তে `auth.uid()` সরাসরি লেখা; `(select auth.uid())` করলে বড় টেবিলে দ্রুত হয়।
- অনেক পাতা পুরো তালিকা (৫০০ সারি পর্যন্ত) একবারে আনে; ডাটা বাড়লে পাতায় ভাগ (pagination) লাগবে।

### ৮.৬ 🟡 অসম্পূর্ণ কাজ

- পার্সেল বারকোড/QR স্ক্যান পাতা (ডাটাবেস তৈরি, পাতা নেই)।
- বেতন শিটের পাতা, ডকুমেন্ট যাচাইয়ের পাতা।
- কুরিয়ার অপারেশনের বেশিরভাগ পাতা (৪৭টা `ops` অনুমতি আছে, পাতা কম)।
- ফোনে আসল push notification (FCM) নেই — শুধু অ্যাপের ভেতরের ঘণ্টা।
- ভেতরের অনেক পাতায় English অনুবাদ আংশিক।
- স্টাফ প্যানেলে কিছু সারি "শীঘ্রই" লেখা।
- ব্যাংক চার্জের সীমা এখনো ডেমো মান (১,০০,০০০) — আসল অঙ্ক বসাতে হবে।
- অফিসের বিদ্যুৎ হিসাবে ইউনিট রেট না দিলে ৳১১ ধরা হয় — এটা অনুমান।
- নদী AI-র অফিস অংশ (চুক্তি লেখা, পরামর্শ) আসল AI দিয়ে চালিয়ে দেখা হয়নি; function আবার deploy করতে হবে।

---

## ৯. এখন যা করা দরকার (ক্রম অনুযায়ী)

1. লাইভ সাইটে `/app/fleet` খুলে দেখা; না চললে `20261116000700_fleet` লাইভে বসানো।
2. লাইভে থাকা কিন্তু রিপোতে না থাকা migration ও ফাংশনগুলো রিপোতে আনা (৮.১)।
3. ব্যাকআপের ব্যবস্থা (৮.২)।
4. অফিস অপারেশন: migration বসানো → `nodi-ai` deploy → `main`-এ merge।
5. Supabase Auth: leaked password protection চালু, access token hook যাচাই, SMTP।
6. `99f` টেস্ট ঠিক করা; SQL টেস্ট Actions-এ চালানো।
7. CSP হেডার; OCR টুল নিজের সাইটে।
8. তারপর নতুন ফিচার: পার্সেল স্ক্যান, বেতন শিট, push notification।

---

## ১০. কাজের নিয়ম (মালিকের নির্দেশ)

- গোপন key কখনো চ্যাট, কোড, স্ক্রিনশট বা ডকুমেন্টে নয় — শুধু সার্ভারে।
- আগের মডিউল বা ডাটা ভাঙা যাবে না; পুরোনো migration ফাইল বদলানো নিষেধ, নতুন ফাইল যোগ হবে।
- প্রতিটা ডাটাবেস বদলের পর পুরো SQL টেস্ট চালাতে হবে।
- কিছু মোছা নয় — কারণ লিখে archive।
- মালিক বাংলায় লেখেন; উত্তর বাংলায়, সহজ ভাষায়।
- এটা নিজের কাজের জন্য বানানো ব্যক্তিগত টুল; অন্য কোনো কুরিয়ার কোম্পানির নাম, লোগো বা হুবহু ডিজাইন ব্যবহার করা হয় না।

## ১১. আরও বিস্তারিত কোথায়

`HANDOVER.md` (প্রতিটা কাজের ইতিহাস ও সিদ্ধান্ত) · `docs/ARCHITECTURE.md` · `docs/PROGRESS.md` · `docs/DAILY_ACCOUNTS.md` · `docs/ANDROID.md` · `docs/CREDENTIALS.md` · `docs/AUDIT.md` ও `docs/UI_UX_AUDIT.md` (১১ নভেম্বরের পুরোনো অডিট)।
