# XZM-TEAM ERP — সম্পূর্ণ প্রজেক্ট রিভিউ ও অডিট

তারিখ: ১৩ নভেম্বর ২০২৬ · যা দেখা হয়েছে: ডাটাবেস (৮টি migration, ৫৯টি টেবিল, ১২০টি public function, ১১৩টি RLS policy, ১৪২টি permission), টেস্ট, React অ্যাপ (`web/`), HTML ডেমো (`demo/`), স্ক্রিপ্ট ও ডকুমেন্ট।

## সংক্ষেপে রায়

| অংশ | অবস্থা | মন্তব্য |
|---|---|---|
| ডাটাবেস নিরাপত্তা (RLS, permission, audit) | ✅ ভালো | কোনো টেবিলে RLS বাদ নেই, anon কোনো function চালাতে পারে না, সব SECURITY DEFINER function-এ `search_path` ঠিক করা |
| ডাটাবেস টেস্ট | ✅ ৫২৬/৫২৬ পাস | তবে আসল Supabase-এ নয়, local PostgreSQL + shim-এ |
| সময় অঞ্চল (Asia/Dhaka) | ✅ ঠিক করা হয়েছে | migration `20261113000900_business_timezone.sql` (আগে: Supabase-এ রাত ১২টা–সকাল ৬টা “আজ” ভুল দিন হতো) |
| লগইন লকআউট | ⚠️ চালু নেই | ব্যর্থ লগইন গোনা হয় না, তাই অ্যাকাউন্ট কখনো লক হয় না |
| React অ্যাপ | ⚠️ অনেক অসম্পূর্ণ | শুধু Login, Dashboard ও Daily Accounts পেজ আছে; HR, জোনাল, কুরিয়ার মডিউলের ডাটাবেস আছে কিন্তু UI নেই |
| HTML ডেমো বনাম আসল সিস্টেম | ⚠️ বড় ফারাক | ডেমোর অনেক ফিচারের (হাব ভাড়া, বেতন সংশোধন, চ্যাট, স্টাফ প্যানেল…) ডাটাবেস বা API নেই |
| ভার্সন কন্ট্রোল / ব্যাকআপ | 🟡 টুল তৈরি | `save-to-git.bat` একবার চালালেই git চালু হবে |
| প্রোডাকশন প্রস্তুত? | ❌ না | নিচের “লাইভে যাওয়ার আগে” তালিকা দেখুন |

---

## ১. ঝুঁকি — অগ্রাধিকার অনুযায়ী

### 🔴 উচ্চ

**H1. সময় অঞ্চলের ভুল (Supabase UTC-তে চলে)** — ✅ ঠিক করা হয়েছে (নিচে “৫” দেখুন)
- পুরোনো মডিউলগুলোতে ৪৫ জায়গায় `current_date` ব্যবহার হয়েছে (HR ১১, কুরিয়ার ১৩, জোনাল ৮, ইমপোর্ট ৬, বেতন/হাজিরা ৪, ফাউন্ডেশন ৩)।
- Supabase ডাটাবেস ডিফল্টে UTC-তে চলে। ঢাকা সময় রাত ১২টা থেকে সকাল ৬টা পর্যন্ত UTC-তে আগের দিন থাকে। তখন “আজকের” হাজিরা, হাব ফিগার বা পার্সেল দিলে **“ভবিষ্যতের তারিখ”** বলে আটকে যাবে, আর রিপোর্ট ভুল দিনে পড়বে।
- টেস্টে এটা ধরা পড়েনি কারণ টেস্ট ডাটাবেস নিজেই Asia/Dhaka-তে চলে।
- Daily Accounts মডিউলে এই সমস্যা নেই (নিজের `da_today()` ঢাকা সময় ব্যবহার করে)।
- **সমাধান (ছোট migration):** `alter database postgres set timezone to 'Asia/Dhaka';` অথবা একটি `private.today()` helper বানিয়ে সব `current_date` বদলানো। সাথে টেস্ট `PGTZ=UTC` দিয়েও চালানো।

**H2. ভার্সন কন্ট্রোল ও ব্যাকআপ নেই** — 🟡 `save-to-git.bat` তৈরি, আপনার PC-তে একবার চালাতে হবে
- `xzm-team-erp` ফোল্ডারে `.git` নেই। একটা ভুল ফাইল ওভাররাইট হলে আগের অবস্থায় ফেরা যাবে না।
- এই অডিটের সময়ই দেখা গেছে: PC-র `demo/index.html` লাইভ ডেমোর চেয়ে পুরোনো ছিল (বেতন সংশোধনের অংশ ছিল না)। এখন ঠিক করে দেওয়া হয়েছে।
- **সমাধান:** git চালু করে প্রাইভেট GitHub রিপোতে রাখা।

### 🟠 মাঝারি

**M1. লগইন লকআউট কাজ করে না**
- ডাটাবেসে `record_login_attempt()` আর `profiles.locked_until` আছে, এবং লক থাকা ইউজার কোনো permission পায় না — এটা ঠিক আছে।
- কিন্তু React-এর লগইন সরাসরি `supabase.auth.signInWithPassword` ডাকে। ব্যর্থ চেষ্টা কোথাও গোনা হয় না, তাই অ্যাকাউন্ট কখনো লক হয় না। পরিকল্পিত `auth-login` Edge Function বানানো হয়নি।
- **সমাধান:** `auth-login` Edge Function, অথবা Supabase Auth Hook দিয়ে চেষ্টা রেকর্ড করা। Super Admin-এর জন্য MFA চালু করা।

**M2. কোনো কিছুই আসল Supabase-এ চালানো হয়নি** — 🟡 অগ্রগতি: dev প্রজেক্ট `xzm-team-erp-dev` (Singapore) চালু, সব ১১টি migration প্রয়োগ, লাইভ যাচাই সম্পন্ন (নিচে ৬ দেখুন)
- Supabase-এ এখনো কোনো প্রজেক্ট নেই (সংযুক্ত অ্যাকাউন্টে প্রজেক্ট তালিকা খালি)।
- Storage bucket policy (`da-evidence`, employee documents) local-এ পরীক্ষা করা যায়নি।
- Supabase-এর নিজস্ব default grant local shim-এর থেকে আলাদা হতে পারে।
- **সমাধান:** একটি dev প্রজেক্ট খুলে `supabase db push`, তারপর পুরো টেস্ট আর Supabase Security Advisor চালানো।

**M3. React অ্যাপ বেশিরভাগই বাকি**
- আছে: Login, Dashboard, Daily Accounts (৫ পেজ)।
- নেই: HR (কর্মী, আবেদন, ডকুমেন্ট, হাজিরা, ছুটি, বেতন, ইমপোর্ট), জোন/হাব, জোনাল ম্যানেজমেন্ট, কুরিয়ার অপারেশন, রোল ও পারমিশন, অডিট লগ, সেটিংস।
- PC-তে `npm install` কখনো চালানো হয়নি (`web/node_modules`-এ প্যাকেজ নেই), তাই আসল build একবারও হয়নি।

**M4. HTML ডেমো আর আসল সিস্টেমের ফারাক**
- ডেমোতে যা দেখা যায়, তার অনেকগুলোর পেছনে কোনো টেবিল/API নেই: হাব ভাড়া ব্যবস্থাপনা, কাস্টম রিপোর্ট, বেতন সংশোধন (OCR), এক্সপোর্ট ও শেয়ার, স্টাফ প্যানেল, হাব চ্যাট, জোন-ভিত্তিক ভাষা সেটিং, প্রোফাইল বিল্ডার ইত্যাদি।
- ডেমো শুধু ব্রাউজারের localStorage-এ ডাটা রাখে; ব্রাউজার বদলালে বা ক্লিয়ার করলে সব মুছে যায়।
- ডেমোর আইডি আর নাম (যেমন employee 1–14) আসল ডাটাবেসের সাথে মেলানো নেই।
- **ঝুঁকি:** কেউ ডেমোকে আসল সিস্টেম ভেবে কাজের ডাটা রাখতে পারে। ডেমোর উপরের “DEMO” ব্যানার রাখা জরুরি।

### 🟡 কম

| # | বিষয় | বিস্তারিত |
|---|---|---|
| L1 ✅ | Foreign key-তে index নেই (ঠিক করা: `20261113001100_foreign_key_indexes.sql`) | ৫৯টি FK কলামে index নেই (যেমন `user_roles.role_id`, `employees.position_id`, `pickup_submissions.merchant_id`)। ডাটা বাড়লে রিপোর্ট ও join ধীর হবে। একটি index migration যথেষ্ট। |
| L2 | কিছু টেবিলে audit/no-delete trigger নেই | Audit trigger নেই: `da_page_visits`, `employee_import_rows`, `employee_sensitive`, `task_reminders` (লগ টেবিলগুলো বাদে)। Delete-বাধা নেই: `employee_assignments`, `employee_compensation_items`, `employee_status_history`, `parcel_issue_events`, `role_permissions` (শেষটায় শুধু Super Admin delete পারে — ইচ্ছাকৃত)। `employee_sensitive`-এ audit না থাকা সম্ভবত ইচ্ছাকৃত (NID লগে না রাখতে), তবে নথিতে লেখা দরকার। |
| L3 ✅ | কিছু trigger function-এ `search_path` নেই (ঠিক করা: `20261113001000_function_search_path.sql`) | `guard_system_role`, `leave_request_guard`, `custom_field_guard` ইত্যাদি ১৫টি (সব invoker, তাই ঝুঁকি কম)। নিয়ম মানতে `set search_path = ''` যোগ করা ভালো। |
| L4 | ডকুমেন্ট পুরোনো | README-তে এখনো “৪২৭ assertions” আর “Accounts পরের রিলিজে” লেখা; এখন ৫১৭ আর Daily Accounts যুক্ত। |
| L5 | ডেমো সার্ভার পুরো ফোল্ডার দেখায় | `start-demo.ps1` শুধু localhost-এ চলে (বাইরে থেকে দেখা যায় না), কিন্তু পুরো প্রজেক্ট ফোল্ডার serve করে। ভবিষ্যতে `web/.env.local` রাখলে সেটাও খোলা যাবে। শুধু `demo/` serve করা ভালো। |
| L6 | পুরোনো ফাইল | `demo/index.backup-before-v2.html` (৩৩৭ KB) আর `demo/staff/` পুরোনো ডেমো — git চালুর পর মুছে ফেলা যায়। |
| L7 | ডেমো ফাইল অনেক বড় | `demo/index.html` একটি ফাইলে ৭২৩ KB। আরো ফিচার যোগ করলে রক্ষণাবেক্ষণ কঠিন হবে; নতুন কাজ React অ্যাপে করাই ভালো। |
| L8 | ডকুমেন্ট অনুমোদনকারী ফাইলের পথ বদলাতে পারে | `employee_documents` update policy অনুমোদন/আর্কাইভ অনুমতিওয়ালাকে `storage_path`, `sha256` বদলাতে দেয়। একটি guard trigger দিয়ে শুধু verify/archive ঘর বদলানো সীমিত করা উচিত। |

---

## ২. যা ভালোভাবে করা আছে

- **RLS সব টেবিলে চালু**, প্রতিটিতে policy আছে; কোথাও `using (true)` নেই।
- **anon (লগইন না করা) ব্যবহারকারী** শুধু ব্র্যান্ডিং ও ভাষার ১০টি public setting দেখতে পারে; কোনো function চালাতে পারে না।
- **সব ১৪৭টি SECURITY DEFINER function-এ `search_path` ঠিক করা।**
- **Permission escalation বন্ধ:** রোলের ভেতরের অনুমতি শুধু Super Admin বদলাতে পারে; নিজের রোল নিজে বাতিল করা যায় না; system role-এ super flag যোগ করা যায় না (টেস্ট করা)।
- **সরাসরি টেবিল লেখায় guard trigger:** কর্মী সবসময় “applicant” হিসেবে শুরু, পার্সেলের status/rider শুধু workflow দিয়ে বদলায়, যাচাই করা হাব ফিগার লক, বেতন শিটে মূল বেতন/হাজিরা হাতে বদলানো যায় না, `net_payable` হিসাব করা কলাম।
- **Audit log append-only** এবং trigger-ভিত্তিক — UI বা SQL কোনো পথ দিয়েই এড়ানো যায় না।
- **Maker ≠ checker** — হাব ফিগার, বেতন, ক্যাশ ও Daily Accounts সব জায়গায়।
- **মুছে ফেলা নেই** — বেশিরভাগ টেবিলে archive/revoke, delete বন্ধ।
- **গোপন key ব্রাউজারে নেই** — `web/`-এ শুধু public URL আর anon key; `.env` git-ignore করা।
- **ডেমো নিরাপদভাবে লেখা** — ইউজারের লেখা `esc()` দিয়ে escape করা হয়, ব্যানারে স্পষ্ট “DEMO” লেখা।

## ৩. টেস্ট ফলাফল (এই অডিটে আবার চালানো)

| ফাইল | assertions | ফল |
|---|---|---|
| 10 org scope RLS | 29 | ✅ |
| 20 RBAC escalation | 16 | ✅ |
| 30 audit & lockout | 21 | ✅ |
| 40 HR lifecycle | 60 | ✅ |
| 50 HR pay & leave | 42 | ✅ |
| 60 HR import | 23 | ✅ |
| 70 zonal management | 96 | ✅ |
| 80 courier operations | 140 | ✅ |
| 90 daily accounts | 90 | ✅ |
| **মোট** | **517** | **০ ব্যর্থ** |

পরিবেশ: PostgreSQL 16 + local Supabase shim, টাইমজোন Asia/Dhaka। **আসল Supabase, Storage, Edge Function, ব্রাউজারে OCR — পরীক্ষা হয়নি।**

## ৪. লাইভে যাওয়ার আগে করণীয় (ক্রম অনুযায়ী)

1. git চালু + প্রাইভেট রিপো (H2)।
2. টাইমজোন migration + UTC-তে টেস্ট (H1)।
3. Supabase dev প্রজেক্ট (Singapore region) → `supabase db push` → টেস্ট + Security/Performance Advisor (M2)।
4. FK index migration, বাকি trigger-এ `search_path`, document guard (L1, L3, L8)।
5. `auth-login` Edge Function / Auth Hook দিয়ে লকআউট, Super Admin-এর MFA (M1)।
6. `npm install && npm run build` — আসল build যাচাই।
7. React UI: প্রথমে HR ও স্টাফ ম্যানেজমেন্ট (Release 1-এর লক্ষ্য), তারপর জোন/হাব, জোনাল, কুরিয়ার (M3)।
8. ডেমোর যেসব ফিচার আসল সিস্টেমে লাগবে, সেগুলোর তালিকা চূড়ান্ত করে ডাটাবেস + UI বানানো (M4)।
9. SMTP, ব্যাকআপ/restore পরীক্ষা, রোলভিত্তিক E2E টেস্ট, হোস্টিং।

## ৫. অডিটের পর যা ঠিক করা হয়েছে
- PC-র `demo/index.html` লাইভ ডেমোর সর্বশেষ সংস্করণে (Daily Accounts সহ) আপডেট করা হয়েছে।
- **H1 ঠিক:** নতুন migration `20261113000900_business_timezone.sql` ডাটাবেসের টাইমজোন Asia/Dhaka করে; `system.timezone` সেটিং ও `system_timezone_ok()` হেলথ-চেক যোগ। টেস্ট রানার এখন ডাটাবেস UTC-তে শুরু করে (Supabase-এর মতো), আর নতুন টেস্ট `95_business_timezone.sql` (৯টি চেক) প্রমাণ করে যে migration-এর পর সব কানেকশন ঢাকা সময়ে চলে। migration সরিয়ে চালালে টেস্টটি ব্যর্থ হয় (যাচাই করা)। মোট ৫২৬টি চেক পাস।
- **H2-এর টুল:** `save-to-git.bat` / `scripts/setup-git.ps1` — প্রথমবার git রিপো তৈরি করে প্রথম snapshot সেভ করে; পরে যতবার চালাবেন নতুন “save point” রাখে। `.env` ফাইল ও secret key থাকলে সেভ করে না; চাইলে প্রাইভেট GitHub-এ কপি রাখে (জিজ্ঞেস করে)। `.gitattributes` ও `.gitignore` হালনাগাদ।

## ৬. Supabase dev প্রজেক্টে লাইভ যাচাই (১৩ নভেম্বর ২০২৬)
প্রজেক্ট: `xzm-team-erp-dev` (ref `ndgnhvbpmtxrpplgsslz`, Singapore, Free plan)।

| যাচাই | ফল |
|---|---|
| টেবিল / RLS ছাড়া টেবিল | ৫৯ / ০ |
| anon চালাতে পারে এমন function | ০ |
| টাইমজোন (নতুন কানেকশন) | Asia/Dhaka ✅ |
| Storage bucket | `employee-docs`, `da-evidence` — দুটোই private, ৪টি policy |
| লগইন ছাড়া (anon): কর্মী টেবিল / RPC | দুটোই আটকানো ✅ — শুধু ১১টি public সেটিং দেখা যায় |
| অনুমতিহীন লগইন ইউজার | ০টি কর্মী দেখে, ০টি অনুমতি, খাতা শুরু করতে পারে না ✅ |
| Security Advisor | `search_path` সতর্কতা (১৫) ঠিক করা হয়েছে। বাকি “signed-in users can execute SECURITY DEFINER” (৯৫) ইচ্ছাকৃত: এগুলোই API, প্রতিটি নিজে অনুমতি যাচাই করে। |
| Performance Advisor | FK index (৫৯) ঠিক করা হয়েছে। বাকি: ২৩টি RLS policy-তে `auth.uid()` → `(select auth.uid())` (বড় ডাটায় গতি বাড়াবে, পরে করা হবে); “unused index” খালি ডাটাবেসে স্বাভাবিক। |

পরের ধাপ: প্রথম Super Admin তৈরি → `npm install` → `npm run dev` দিয়ে React অ্যাপ আসল ডাটাবেসে চালানো।
