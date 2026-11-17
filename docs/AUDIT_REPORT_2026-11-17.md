# XZM-TEAM ERP — অডিট রিপোর্ট (১৭ নভেম্বর ২০২৬, সন্ধ্যা)

যে কোড দেখা হয়েছে: `main` = commit `61539c8` (PR #51 পর্যন্ত)। লাইভ Supabase (`ndgnhvbpmtxrpplgsslz`) শুধু **পড়ে** দেখা — কিছু বদলানো হয়নি।
আগের অডিট: `docs/PROJECT_AUDIT.md` (সকালের, commit `761c878`)। এই রিপোর্ট সেটার পরের অবস্থা।
সাথের ডকুমেন্ট: `docs/ROLES_AND_PERMISSIONS.md` (সব রোল ও অনুমতি), `docs/DATABASE_STRUCTURE.md` (সব টেবিল ও কলাম), `docs/ROADMAP.md` (সামনের কাজ)।

> এই ফাইলে কোনো গোপন key বা পাসওয়ার্ড নেই।

---

## ১. ফলাফল এক নজরে

| যাচাই | ফল |
|---|---|
| সব migration খালি ডাটাবেসে চালানো (৭৭টা ফাইল) | ✅ কোনো এরর নেই |
| SQL টেস্ট | ✅ **১,৩৫৭টা যাচাই পাস, ০টা ফাইল ফেল** (সকালে `99f` ফেল ছিল — এখন ঠিক) |
| TypeScript typecheck (`tsc -b`) | ✅ ০ এরর |
| Production build (`vite build`) | ✅ ৩.৬ সেকেন্ডে |
| `npm audit` (production) | ✅ ০টা দুর্বলতা |
| রিপোতে গোপন key | ✅ পাওয়া যায়নি (`.env.production`-এ শুধু public URL ও publishable key — এটা ডিজাইন অনুযায়ী) |
| লাইভে RLS বন্ধ টেবিল | ✅ ০টা |
| লাইভ ↔ রিপো migration | 🟠 ১টা অমিল (নিচে ৩.১) |
| লগইন ছাড়া ডাকা যায় এমন ফাংশন | 🟠 ১৬টা হিসাব-ফাংশন (নিচে ৩.২) |
| ব্যাকআপ | 🔴 ব্যবস্থা নেই (Free plan) |

## ২. আকার (রিপো থেকে গোনা)

| | রিপো (`main`) | লাইভ |
|---|---|---|
| Migration ফাইল | ৭৭ | ৮৭টা এন্ট্রি (কিছু ফাইল লাইভে ভাগ করে বসানো — `docs/MIGRATIONS_LIVE_MAP.md`) |
| public টেবিল | ১২৬ | ১২৭ (বাড়তি ১টা = advanced permissions) |
| RLS policy (public + storage) | ২৩৪ | ২৩৫ |
| public ফাংশন | ৩৫৯ (৩২৩ SECURITY DEFINER) | — |
| private ফাংশন | ১৭০ | — |
| অনুমতি | ২১৫টা, ১১ মডিউলে | ২১৫ |
| রোল | ১৫টা সিস্টেম রোল | ১৬ (বাড়তি `manager_hisab`, inactive) |
| Storage bucket | ৬, সব private | ৬ |
| Edge Function | ৪: `auth-login`, `admin-users`, `nodi-ai`, `push-send` | ৪টাই ACTIVE |
| Frontend | ~২২,০০০ লাইন TS/TSX, অ্যাপে ৬৩টা route | — |
| SQL টেস্ট | ৫২টা ফাইল, ১,৩৫৭ যাচাই | — |
| লাইভ ডাটা | — | লগইন ৩ জন, কর্মী ১৩৫, হাব ১৪, জোন ১ |

## ৩. সমস্যা — গুরুত্ব অনুযায়ী

### ৩.১ 🟠 লাইভে আছে, `main`-এ নেই: `advanced_permissions`
লাইভে migration `20261117190822 advanced_permissions` বসানো (নতুন টেবিল + `access_overrides` ইত্যাদি ফাংশন)। এর ফাইল `20261117004000_advanced_permissions.sql` শুধু ব্রাঞ্চ `claude/advanced-role-permission-mgmt-t5zk0a`-এ (main-এর চেয়ে ২ commit এগিয়ে, পিছিয়ে নেই)।
**ঝুঁকি:** রিপো থেকে ডাটাবেস আবার বানালে এটা হারাবে; সকালে ঠিক করা "লাইভ = রিপো" নিয়ম আবার ভেঙেছে।
**করণীয়:** ব্রাঞ্চটা টেস্ট চালিয়ে `main`-এ merge (রোডম্যাপ ধাপ ০)।

### ৩.২ 🟠 লগইন ছাড়া (anon) ১৬টা `da_` ফাংশন ডাকা যায়
Supabase advisor ও লোকাল ডাটাবেস দুটোতেই একই তালিকা: `da_approval_rule_save`, `da_cash_payment_remove`, `da_cash_payment_save`, `da_expense_approve`, `da_expense_set_extra`, `da_hub_rider_sheet`, `da_my_expense_requests`, `da_my_rider_lines`, `da_payee_save`, `da_pending_approvals`, `da_pending_riders`, `da_reconcile`, `da_reference_save`, `da_report_text`, `da_request_expense`, `da_suggest_category`।
এগুলো এসেছে লাইভ থেকে আনা migration (`manager_ledgers_rider_submit`, `cash_payments_refs_approvals_requests`, `report_import`) থেকে, যেখানে `revoke … from public, anon` লেখা হয়নি।
লোকালে anon হিসেবে চালিয়ে দেখা: ফাংশনগুলো ভেতরে অনুমতি দেখে — ফাঁকা তালিকা বা "খাতা পাওয়া যায়নি" ফেরত দেয়, ডাটা ফাঁস হয়নি। তবু দ্বিতীয় দেয়াল নেই।
**করণীয়:** নতুন migration-এ এই ১৬টা থেকে `anon`-এর execute সরানো (`branding()` থাকবে — লগইন পাতার দরকার)। ছোট কাজ।

### ৩.৩ 🟠 policy ছাড়া RLS টেবিল (৩টা)
`employee_reference_requests`, `pulse_answers`, `pulse_questions` — RLS চালু, policy নেই, তাই সরাসরি কেউ পড়তে পারে না; সব কাজ ফাংশন দিয়ে। এটা **ইচ্ছাকৃত** (migration-এ লেখা আছে)। কিছু করতে হবে না — শুধু advisor-এ INFO দেখাবে।

### ৩.৪ 🔴 ব্যাকআপ নেই
Free plan; নিজে `pg_dump` নেওয়ার ব্যবস্থা নেই। কর্মীর NID, বেতন, টাকার হিসাব এখানে। প্রজেক্টের নাম "dev" হলেও এটাই লাইভ।
**করণীয়:** Pro plan, অথবা GitHub Actions-এ সাপ্তাহিক `pg_dump` (DB password GitHub secret-এ), অথবা হাতে সপ্তাহে একবার।

### ৩.৫ 🟠 নিরাপত্তা সেটিং (আগের অডিট থেকে, এখনো খোলা)
| # | বিষয় | করণীয় |
|---|---|---|
| ১ | Leaked password protection বন্ধ (advisor WARN) | Supabase → Auth → Password security থেকে চালু (এক ক্লিক) |
| ২ | `pg_net` extension `public` স্কিমায় (advisor WARN) | `extensions` স্কিমায় সরানো |
| ৩ | `netlify.toml`-এ `Content-Security-Policy` নেই | CSP যোগ (Supabase, OSM tile, jsdelivr-এর অনুমতি সহ) |
| ৪ | OCR (Tesseract) `cdn.jsdelivr.net` থেকে `@5` ভার্সনে, SRI ছাড়া (`web/src/lib/ocr.ts:10`) | নির্দিষ্ট ভার্সন + SRI, বা নিজের সাইটে রাখা |
| ৫ | `office_secrets` সাধারণ লেখা হিসেবে থাকে | pgcrypto/Vault দিয়ে encrypt, অথবা ঝুঁকি মেনে নেওয়া |
| ৬ | নিজস্ব SMTP নেই | পাসওয়ার্ড রিসেট মেইলের জন্য SMTP |
| ৭ | ৪টা Edge Function-ই `verify_jwt = false` (ভেতরে টোকেন যাচাই হয়) | নতুন function-এ একই যাচাই রাখা — নিয়ম হিসেবে লেখা |
| ৮ | ৩১৬টা SECURITY DEFINER ফাংশন লগইন করা ইউজার ডাকতে পারে (advisor WARN) | ডিজাইন অনুযায়ী — প্রতিটা ভেতরে `has_permission` দেখে। SQL টেস্ট এটাই প্রমাণ করে |

### ৩.৬ 🟡 মান ও প্রক্রিয়া
- SQL টেস্ট এখনো CI-তে চলে না — শুধু হাতে (`scripts/test-db.sh`)। Actions-এ শুধু build + smoke test।
- Frontend-এ unit test / lint নেই।
- `supabase/apply-all-dev.sql` পুরোনো।
- `docs/PRODUCTION_ROADMAP.md` পুরোনো (লেখা আছে "React বানানো হয়নি") — নতুন `docs/ROADMAP.md` দেখুন।
- `HANDOVER.md`-এর উপরের অংশ পুরোনো; আসল ইতিহাস নিচের তারিখওয়ালা অংশে।
- অনেক পুরোনো ব্রাঞ্চ পড়ে আছে। যেগুলোতে এখনো merge না হওয়া migration আছে:
  - `claude/advanced-role-permission-mgmt-t5zk0a` — লাইভে বসানো (৩.১)
  - `claude/route-panel-location-rider-lnznbs` — ৪টা migration (`sorting_route_crew`, `hub_presence`, `staff_location_pings`, `absence_cover_reports`), **লাইভে বসানো নয়**, main থেকে ১৫ commit পিছিয়ে
  - `claude/blissful-maxwell-7kkfd6` (`approval_rules`), `claude/daily-report-import-page-pzdt4o`, `claude/staff-panel-design-eor8zg` — main থেকে ৪৪–৭৯ commit পিছিয়ে; কাজগুলো অন্য নামে main-এ এসে গেছে বলে মনে হয়। দেখে বন্ধ করা দরকার।

### ৩.৭ 🟡 পারফরম্যান্স
- মূল JS ৪৫০ KB (gzip ১৩৪ KB) + Supabase ২২৫ KB — সকালের চেয়ে ~৪৫ KB বেড়েছে। ধীর ফোনে প্রথম লোড ভারী।
- বড় পাতা: Office ১৩৬ KB, Learn ৮০ KB, DailySheet ৭৭ KB (lazy, তাই শুধু খুললে লোড হয়)।
- অনেক পাতা ৫০০ সারি পর্যন্ত একবারে আনে — ডাটা বাড়লে pagination লাগবে।

### ৩.৮ 🟡 অসম্পূর্ণ কাজ
- কুরিয়ার অপারেশন: ৪৭টা `ops` অনুমতি ও ১৩টা টেবিল আছে, পাতা কম (পার্সেল স্ক্যান, ডেলিভারি, COD সেটেলমেন্ট)।
- বেতন শিট ও ডকুমেন্ট যাচাইয়ের পাতা নেই।
- রাইডারের লোকেশন/হাব উপস্থিতি — ব্রাঞ্চে আছে, লাইভ নয়।
- ব্যাংক চার্জের সীমা ডেমো মান; বিদ্যুতের ইউনিট রেট অনুমান (৳১১)।
- ভেতরের পাতায় English অনুবাদ আংশিক।

## ৪. যা ভালো আছে
- সব টেবিলে RLS; অনুমতি ডাটাবেসে — ব্রাউজার বদলে কেউ বাড়তি ডাটা পায় না।
- কিছু মোছা যায় না (`prevent_delete`), প্রতিটা বদল `audit_logs`-এ।
- ১,৩৫৭টা SQL যাচাই সব পাস — অনুমতি, স্কোপ (জোন A জোন B দেখে না), টাকার হিসাব, অনুমোদনের ধাপ।
- সকালের সবচেয়ে বড় সমস্যা (লাইভ ≠ রিপো) প্রায় পুরো ঠিক; push notification (`push-send`) ও লাইভ নোটিফিকেশন যোগ হয়েছে।
- নির্ভরতা কম, `npm audit` পরিষ্কার, নিরাপত্তা হেডার (HSTS, X-Frame-Options, nosniff ইত্যাদি) আছে।
- build-এ secret key ধরা পড়লে Actions থেমে যায়।

## ৫. কীভাবে যাচাই করা হলো (আবার চালাতে চাইলে)
```bash
PGHOST=/tmp PGPORT=54322 PGUSER=postgres scripts/test-db.sh
```
```bash
cd web && npm ci && npx tsc -b && npm run build && npm audit --omit=dev
```
লাইভ: Supabase `list_migrations`, `list_edge_functions`, `get_advisors(security)`, আর `roles`/`permissions`/`pg_tables` গোনার SELECT।
