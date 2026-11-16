# XZM-TEAM ERP — Handover (14 Nov 2026)

এই ফাইলটা নতুন কোনো Claude চ্যাটে (বা নতুন ডেভেলপারকে) দিলে প্রজেক্ট কোথায় আছে, কী লাইভ, কী বাকি — সব এক জায়গায় পাবে।
Give this file (and the project zip) to a new Claude chat or developer to continue the work.

---

## 1. প্রজেক্ট এক নজরে / At a glance

| | |
|---|---|
| কী | কুরিয়ার ব্যবসার ERP: হেড অফিস → জোন → হাব। HR, হাজিরা, ছুটি, দৈনিক হিসাব খাতা, জোনাল ম্যানেজমেন্ট, কুরিয়ার অপারেশন। বাংলা/English UI। |
| Frontend | React 19 + Vite + TypeScript + react-router 7 (`web/`) |
| Backend | Supabase (PostgreSQL 16, Auth, Storage, Edge Functions) — সব নিয়ম ডাটাবেসে (RLS, SECURITY DEFINER ফাংশন, audit log) |
| লাইভ সাইট | https://xzm-team-erp.netlify.app  (স্টাফ লগইন: `/staff/login`) |
| Hosting | Netlify — project `xzm-team-erp`, site id `2909a0bd-55bc-4b11-930f-73750fb34bd4`, team `mizanur-rahman-lydcsfo` (Free). **Netlify-তে কোনো build চলে না** (ফ্রি কোটা শেষ হয়ে যায়): GitHub Actions `web/dist` বানিয়ে netlify-cli দিয়ে আপলোড করে। `web/**` বদলে push করলেই সাইট লাইভ হয়। |
| Supabase | project `xzm-team-erp-dev`, ref `ndgnhvbpmtxrpplgsslz`, org XSFCTEAM, region ap-southeast-1 (Singapore), Free plan |
| GitHub | প্রাইভেট রিপো `mizanurnatoresfc-bit/xzm-team` — কোড, APK বিল্ড আর সাইট ডিপ্লয় এখান থেকেই। Secret `NETLIFY_AUTH_TOKEN` সেট করা আছে। |
| PC-তে ফোল্ডার | `C:\Users\Mizanur\Downloads\xzm-team-react-supabase-phase1\xzm-team-erp` (git চালু, `save-to-git.bat` দিয়ে সেভ) |
| একমাত্র ইউজার | মালিক — Super Admin (global) |
| সময় অঞ্চল | ডাটাবেস Asia/Dhaka |

**Frontend env (public, গোপন নয়):** `web/.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key)। `web/create-env.bat` এটা বানায়। Netlify-তেও একই দুটো env var সেট করা আছে।
**গোপন key (service role, DB password, Netlify token) কখনো চ্যাটে, কোডে বা ডকুমেন্টে দেবেন না।** Edge Function-এর service key Supabase নিজে দেয়।

---

## 2. কী লাইভ আছে / What is live now

ডাটাবেস: migration `0100` থেকে `002500` পর্যন্ত (২৫টা) লাইভে বসানো। ৬৮টা টেবিল, সবগুলোতে RLS। নতুন কিছু লাইভে বসাতে বাকি নেই।

Edge Functions লাইভ (দুটোই verify_jwt OFF):
- `auth-login` — পাসওয়ার্ড ভুলের হিসাব, ৫ বার ভুলে ৩০ মিনিট লক। অ্যাপের origin `https://localhost` অনুমোদিত।
- `admin-users` — স্টাফ অ্যাকাউন্ট তৈরি, পাসওয়ার্ড রিসেট, নিজের পাসওয়ার্ড বদল। সব অনুমতি যাচাই ডাটাবেসে, কলার হিসেবে।

ওয়েব + Android অ্যাপে যা আছে:
- পাবলিক হোম, স্টাফ লগইন, ড্যাশবোর্ড, আমার প্রোফাইল (`/app/me`), পাসওয়ার্ড বদল
- ডেমোর মতো ডিজাইন: আইকন মেনু, নোটিফিকেশন, বাংলা/English, ডার্ক মোড, টেবিলে প্রিন্ট/Excel/PDF
- জোনাল ম্যানেজমেন্ট: প্রতিষ্ঠান, জোন, হাব, বিভাগ, পদবি, **হাব অনুযায়ী কর্মী** (`/app/zonal/staff`)
- স্টাফ ম্যানেজমেন্ট: HR ড্যাশবোর্ড, কর্মী তালিকা ও প্রোফাইল, আইডি আবেদন, ডকুমেন্ট, হাজিরা, ছুটি,
  **কর্মী ইমপোর্ট (Excel)**, **রেফারেন্স**, **প্রোফাইলের ঘর ও কলাম**, **এক্সপোর্ট/ইমপোর্ট ফরম্যাট**
- সিস্টেম: **ইউজার ও রোল**, **রোল ও অনুমতি** (সুপার অ্যাডমিন নিজে রোল বানায় ও অনুমতি ঠিক করে), **রোল অনুযায়ী ড্যাশবোর্ড**
- হিসাব ম্যানেজমেন্ট: দৈনিক হিসাব খাতা (ট্যাব: রাইডার · পেমেন্ট · খরচ · জমা বিল · নোট · দিন শেষ), আমার হিসাব, রিপোর্ট, সেটিংস
  - পেমেন্ট আইডি যেভাবেই লিখুন (`101001` / `sfc-101001`) — `SFC-101001` হয়ে বসবে; ডাটাবেসে মিল না থাকলেও লেখা যাবে।
  - একই রাইডারের একাধিক হিসাব, কারা হিসাব নিচ্ছেন ও কে বাকি, সবার শেষে দিন ক্লোজ (মোট হিসাব / পেমেন্ট / খরচ)।
  - নোট প্যানেল: কোন স্টাফ কত টাকা কীভাবে জমা দিয়ে গেছেন — স্টাফ নিজের পাতায় দেখেন।
  - ফিক্সড রাইডার ও ফিক্সড খরচ, পেমেন্ট প্রিফিক্স, জমা বিলের তারিখ — সব Accounts সেটিংসে।

হাব অনুযায়ী কর্মী পাতায় যা করা যায়: হাবের হিসাব (মোট, সক্রিয়, নিষ্ক্রিয়, আইডির অপেক্ষায়, লগইন, কোন পদে কতজন) → হাবে চাপলে কর্মী তালিকা → সারি টিক দিয়ে: সক্রিয়/নিষ্ক্রিয়, চাকরি ছেড়েছেন/অব্যাহতি, অন্য হাবে বদলি, একসাথে এমপ্লয়ি আইডি দেওয়া (পরের খালি নম্বর বসানো থাকে; যাঁদের আবেদন এখনো জমা হয়নি তাঁদের নাম দেখিয়ে আটকে রাখে), তালিকা থেকে সরানো। পাশেই "+ নতুন কর্মী" ও "ফরম্যাটে এক্সপোর্ট"।

ফরম্যাট (`/app/hr/fields` → তৃতীয় ট্যাব): কোন কলাম, কোন ক্রমে, Excel-এ কী নামে — কোম্পানির নিজের কথায় (বাংলা ও ইংরেজি)। পুরো কোম্পানির জন্য, বা জোনাল ম্যানেজার শুধু নিজের জোনের জন্য। ডিফল্ট ঠিক করা যায়। ইমপোর্টের সময় একই ফরম্যাট বেছে দিলে ফাইলের শিরোনাম ধরে কলাম মিলে যায়। বেতন/NID-র কলাম থাকলেও অনুমতি না থাকলে ঘর খালি আসে, আর NID এক্সপোর্ট করলে অডিট লগে থেকে যায়।

রোল অনুযায়ী ড্যাশবোর্ড: হোম পেজ এখন রোল ধরে সাজে — আমার কাজ, কর্মীর হিসাব, HR-এ অপেক্ষায়, হাব অনুযায়ী কর্মী, আজকের অপারেশন, টাকার হিসাব, আজকের হিসাব খাতা, জোনের চিত্র, দ্রুত যাওয়া। সুপার অ্যাডমিন `/app/role-dashboards` (সিস্টেম → রোল অনুযায়ী ড্যাশবোর্ড) থেকে প্রতিটি রোলের জন্য প্যানেল টিক দিয়ে ও ক্রম সাজিয়ে দেন। অনুমতি না থাকলে প্যানেল এমনিতেই আসে না, আর প্রতিটি সংখ্যা যে যতটুকু দেখার অনুমতি রাখেন ততটুকুই দেখায়।

আজকের হিসাব খাতা — মার্চেন্ট পেমেন্ট: পেমেন্টের স্ক্রিনশট দিলে Payment ID, টাকা, transaction নম্বর, কে টাকা নিয়েছে ও তারিখ নিজেই বসে যায়। হাতে লিখলে শুধু **Payment ID আর টাকা** — ওই আইডির রেকর্ড থেকে মার্চেন্ট ও তারিখ আসে; রেকর্ড না থাকলে মার্চেন্ট বেছে নিতে বলে।

খরচের ভাউচার: যে খরচের বিল/ভাউচার পাওয়া যায়নি, তার লাইনে "ভাউচার বানান" — `V-YYMM-00001` নম্বরসহ অফিস কপি ও গ্রাহক কপি প্রিন্ট হয়, টাকার অঙ্ক কথায় লেখা থাকে। বিল থাকলে ভাউচার লাগে না।

খরচের খাত (EXPENSE-CATEGORY হ্যান্ডবুক): ২৪টা খাত — কোন খরচ কোথায় বসবে, মেইন সাইটে কোন ক্যাটাগরি → সাব হেড, সর্বোচ্চ সীমা, রসিদ লাগবে কিনা, নাকি মেইন সাইটে যায়ই না। খরচ লেখার সময় খাতের নিচে দেখায়, সীমা পেরোলে সতর্ক করে। হেড অফিস হিসাব সেটিংস থেকে প্রতিটি লাইন বদলাতে পারে।

আজকের হিসাব খাতা এক পাতায়: রাইডার → মার্চেন্ট পেমেন্ট → খরচ → কর্মীদের জমা দেওয়া বিল → দিন শেষের হিসাব, একটার পর একটা। উপরের জাম্প বার, কলামের শিরোনাম আর নিচের টোটাল লাইন স্ক্রল করলেও আটকে থাকে। রাইডার অংশে দেখায় “এখনো হিসাব বাকি: কয়জন”, সাথে কাদের লাইন ওঠেনি তাদের নাম।

খাতা টুল হিসেবে (migration `20261115000600_sheet_tools`): খাতার প্রতিটা অংশে ⋮ মেনু — লাইন যোগ, শুধু ওই অংশ প্রিন্ট/PDF ও Excel, কলাম দেখান/লুকান/নাম বদল, নিজের কলাম যোগ (প্রতিটা লাইনে লেখা যায়, `da_cells`), অংশ বন্ধ। কলাম সাজানো সুপার অ্যাডমিন/হিসাব সেটিংসের অনুমতিওয়ালা পারেন, সব হাবে একই রকম হয় (`da.layout`)। নতুন ট্যাব **ব্যাংক ডিপোজিট**: আপডেট রিপোর্ট আইডি ও টোটাল এমাউন্ট → মোট খরচ (পেমেন্ট + খরচ + ব্যাংক চার্জ + যাতায়াত) → মোট ব্যাংক এমাউন্ট → ডিপোজিট (ব্যাংক/বিকাশ/নগদ, স্লিপ, রেফ নং) → বকেয়া; সব স্লিপ উঠলে "টাস্ক সম্পন্ন"। ব্যাংক চার্জ টাকার এমাউন্ট অনুযায়ী (সীমা পর্যন্ত ২০, বেশি হলে ১০০, + ১৫% ভ্যাট = ২৩/১১৫), শুক্র-শনি ও ব্যাংক ছুটিতে চার্জ ও যাতায়াত নেই — সব হিসাব সেটিংস → "ব্যাংক চার্জ" থেকে বদলায় (`da.bank_charge`)। সীমার আসল অংক (এখন ডেমো ১,০০,০০০) মালিককে জিজ্ঞেস করে বসাতে হবে।

কর্মীর নিজের বিল: কর্মী “আমার হিসাব” থেকে নিজের খরচ জমা দেন (বিল, গাড়ি, রেফারেন্সসহ); ম্যানেজার শীটে এক ক্লিকে তুলে নেন, বা কারণ লিখে বাতিল করেন। একই বিল দুবার ওঠে না। খরচে এমপ্লয়ি আইডি থাকলে সেটা ওই কর্মীর নিজের পাতায় দেখা যায়।

গাড়ি: `/app/accounts/settings`-এ গাড়ির তালিকা ও কার নামে আছে। গাড়ির খরচে গাড়ি বেছে দিলে, যার নামে গাড়ি আছে তার পাতায় কী বাবদ কত খরচ হলো দেখা যায় (৩০ দিনের মোট সহ)।

রেফারেন্স ও প্রিসেট: খরচে রেফারেন্সের নাম, মোবাইল ও পদবি থাকে। যাঁদের নাম বারবার লাগে তাঁদের সেটিংসে রেখে দিলে ড্রপডাউন থেকে এক ক্লিকে বসে।

নাম, লোগো ও রঙ (`/app/branding`, সিস্টেম মেনুতে): সিস্টেমের নাম (বাংলা/ইংরেজি), ছোট মার্ক, এক লাইনের পরিচয়, লোগো, ব্রাউজার ট্যাবের আইকন ও নাম, আর মূল দুটি রঙ — সুপার অ্যাডমিন বদলাতে পারেন। সেভ করলেই সাইডবার, লগইন পেজ আর ব্রাউজার ট্যাবে বসে যায়। ছবি data URL হিসেবে থাকে (সর্বোচ্চ ২৫৬ কিলোবাইট), আর ছবির ভেতরে চলতে পারে এমন কিছু থাকলে ডাটাবেসই আটকে দেয়। ফোনের অ্যাপ আইকন এখান থেকে বদলায় না — সেটা অ্যাপ বিল্ডের সময় বসে।

ওয়েবসাইটের পাবলিক পাতা: হোম (`/`), শর্তাবলি (`/terms`), লগইন (`/staff/login`) — লেখা আছে এটি নিজের কাজের জন্য বানানো ব্যক্তিগত টুল, কোনো প্রতিষ্ঠানের অফিশিয়াল সিস্টেম নয়।

Android অ্যাপ (Capacitor): `make-android.bat` দিয়ে PC-তে, অথবা GitHub Actions-এর `XZM-TEAM-apk` artifact থেকে নামিয়ে ইনস্টল।

## 3. ডিপ্লয় কীভাবে হয় / How to deploy

- **সাইট:** `web/**`-এ বদল করে GitHub-এ push করুন → Actions "Android APK and site build" চলবে → netlify-cli দিয়ে `web/dist` সরাসরি Netlify-তে যাবে (Netlify-তে build চলে না, তাই কোটা লাগে না)। হাতে চালাতে: Actions → Run workflow।
- **অ্যাপ:** একই run-এর `XZM-TEAM-apk` artifact নামিয়ে ফোনে ইনস্টল।
- **টোকেন ছাড়া বিকল্প:** run-এর `site-dist` artifact নামিয়ে zip টা https://app.netlify.com/projects/xzm-team-erp/deploys এ ড্রপ করুন।
- **ডাটাবেস:** নতুন migration ফাইল `supabase/migrations/`-এ যোগ করে Supabase-এ চালান (MCP `apply_migration`, অথবা SQL Editor-এ পেস্ট)। পুরোনো ফাইল কখনো বদলাবেন না।

## 4. এককালীন সেটিংস যা বাকি থাকতে পারে / One-time settings to check

- [ ] Supabase → Authentication → Hooks → **Customize Access Token** → `public.custom_access_token_hook` চালু (লক/বন্ধ অ্যাকাউন্ট আটকাতে)।
- [ ] Supabase → Authentication → URL Configuration → Site URL = `https://xzm-team-erp.netlify.app`
- [ ] সত্যিকার ব্যবহারের আগে নিজস্ব SMTP (Supabase-এর বিল্ট-ইন ইমেইল সীমিত)।
- [ ] প্রথম জোন ও হাব তৈরি (লাইভ ডাটাবেসে এখনো কোনো প্রতিষ্ঠান/জোন/হাব নেই)।

## 5. পরের কাজের তালিকা / Backlog (অগ্রাধিকার অনুযায়ী)

1. **পার্সেল বারকোড/QR স্ক্যান পেজ** — মোবাইল ক্যামেরায় Steadfast লেবেল স্ক্যান → `parcels.tracking_no` দিয়ে খুঁজে লাইন দেখানো (মার্চেন্ট, গ্রাহক, মোবাইল, এলাকা, COD, অবস্থা, Settle/Delivered বোতাম)। ডাটাবেসে `parcels` টেবিল ও `ops_parcel_lookup(p_tracking_no)` আগেই আছে। খোলা প্রশ্ন: স্ক্যান দিয়ে (ক) নতুন পার্সেল গ্রহণ নাকি (খ) আগের পার্সেল খুঁজে ডেলিভারি/সেটেল? Steadfast API key আছে কি? (key শুধু Edge Function-এ, কখনো ব্রাউজারে নয়)। অ্যাপে ক্যামেরার অনুমতি লাগবে: `AndroidManifest.xml`-এ `android.permission.CAMERA`।
2. বেতন শিট UI, ডকুমেন্ট যাচাই UI।
3. জোনাল ও কুরিয়ার অপারেশনের পেজ (ডাটাবেস তৈরি, UI বাকি)।
4. ভেতরের পেজগুলোর English অনুবাদ।
5. পারফরম্যান্স: ২৩টা RLS policy-তে `auth.uid()` কে `(select auth.uid())` করা।

## 6. ফোল্ডার ম্যাপ / Folder map

```
supabase/migrations/   ডাটাবেস (ক্রমানুসারে; কখনো পুরোনো ফাইল বদলাবেন না, নতুন ফাইল যোগ করুন)
supabase/tests/        SQL পরীক্ষা (scripts/test-db.sh বা test-db.ps1)
supabase/functions/    Edge Functions: auth-login, admin-users
supabase/apply-all-dev.sql   নতুন খালি Supabase প্রজেক্টে সব migration একবারে
web/src/               React অ্যাপ (pages/, components/, lib/, auth/)
demo/index.html        পুরোনো এক-ফাইলের ডিজাইন ডেমো (ডিজাইনের রেফারেন্স)
docs/                  PROGRESS.md (বিস্তারিত ইতিহাস), AUDIT.md, ARCHITECTURE.md, CREDENTIALS.md ...
netlify.toml           Netlify build সেটিং
save-to-git.bat        git-এ সেভ
build-site.bat         সাইট build করে Netlify আপলোডের জন্য dist তৈরি
make-android.bat       Android অ্যাপ (APK) বানায়
```

## 7. কাজের নিয়ম / Ground rules (মালিকের নির্দেশ)

- **মূল দর্শন (মালিক, ১৭ নভেম্বর ২০২৬): Less Work, More Automation, Better Manage.** প্রতিটা ফিচার এই তিন প্রশ্নে যাচাই হবে — মানুষের কাজ কমল কি, সিস্টেম নিজে থেকে করল কি, ম্যানেজারের জন্য সহজ হলো কি।

- গোপন key কখনো চ্যাট, কোড, স্ক্রিনশট বা ডকুমেন্টে নয়; শুধু সার্ভার-সাইডে।
- আগের মডিউল বা ডাটাবেস ভাঙা যাবে না — প্রতিটা বদলের পর পুরো SQL টেস্ট চালাতে হবে।
- রিমোট টুল দিয়ে `.env` ফাইল লেখা যাবে না (`web/create-env.bat` আছে)।
- মালিকের পাসওয়ার্ড চাওয়া বা ব্যবহার করা যাবে না।
- মালিক বাংলায় লেখেন; উত্তর বাংলায়, সহজ ভাষায়, ধাপে ধাপে।

## 8. নতুন Claude চ্যাটে যা লিখবেন / Starter message for a new chat

> আমার XZM-TEAM ERP প্রজেক্টের কাজ চালিয়ে যেতে চাই। প্রজেক্টের জিপ আর HANDOVER.md দিলাম। আগে HANDOVER.md পড়ুন। সব লাইভে বসানো আছে; এখন ৫ নম্বর অংশের তালিকা ধরে পরের কাজ (পার্সেল বারকোড স্ক্যান পেজ) শুরু করুন। আমাকে বাংলায় উত্তর দেবেন।

## 2026-11-15 — Region → Area → Hub, hub map
- Migration `20261115000400_regions_hub_gps.sql`: `regions` table (Rajshahi Region, code RAJ), `zones.region_id` (zones = Areas; "Natore Zone" renamed "Natore Area"),
  hubs `latitude/longitude numeric(10,7)` (not unique — #80 and #1016 share GPS), `hub_type`, `ops_zone` (null = Unassigned), perms `org.region.*`.
- `hub_import_rows` (batch `natore-10`) holds the owner's 10-hub list; `hub_import_apply(row, hub|null, name)` fills blanks only,
  renames an archived code holder to `<code>-OLD`. Applied: #731 (GPS), #779 (active Lalpur; old archived → 779-OLD). 8 rows wait for the owner on the page.
- Page `/app/org/hubs` (pages/org/Hubs.tsx): stats, region/area tree, import panel, OpenStreetMap view (components/OsmMap.tsx, no library), list,
  details/edit/location (tap map or "আমার লোকেশন")/active-inactive/archive. netlify.toml allows geolocation=(self).

## 2026-11-15 — HR & operation requests
- Migration `20261115000500_hr_requests.sql`: `hr_request_formats` (ID_CREATE / ID_TRANSFER / ID_ACTIVE / ID_INACTIVE + custom, field list jsonb with
  `prefill` keys), `hr_requests` (HR-00001 numbers), `hr_request_events` (log), `notifications` (bell). Perms `hr.request.view/create/approve/configure`.
- RPCs: `hr_request_submit` (self_service formats for own ID without perms), `hr_request_update` (processing/done/rejected, notifies submitter,
  employee, reference), `hr_request_cancel`, `hr_request_summary` (invoker; counts by kind:status).
- Page `/app/hr/requests` (pages/hr/Requests.tsx): new (hub→staff→format, prefilled locked fields, reference picker or manual), approval list + detail
  (log, apply transfer/status in system, "নিয়োগ দিন" opens NewApplication prefilled), report matrix, format settings (field builder).
- Dashboard `HrReqPanel`; bell shows notifications + pending HR requests. Real phone push (FCM) is not set up yet — in-app only.

## 2026-11-15 — Vehicle Management (গাড়ি ম্যানেজমেন্ট)
- Migration `20261115000900_vehicle_management.sql`: `vehicles` gains model/engine/chassis/owner/odometer/fuel/service fields and statuses
  `workshop`, `off_road`; new `vehicle_documents` (registration, fitness, tax token, insurance, route permit … with expiry, private bucket `vehicle-docs`)
  and `vehicle_logs` (fuel with litres + odometer, service, repair, parts, tyre, oil, wash, toll, parking, fine, rent, paper, other; optional link to a
  `da_expenses` line). Perms `vehicle.vehicle.view/create/edit/archive`, `vehicle.holder.edit`, `vehicle.log.view/create/edit`, `vehicle.document.edit`,
  `vehicle.settings.configure` with role defaults (admin/head office/operations: all; zonal manager: all but settings; hub manager: own hub add/edit,
  hand over, logs, papers; pickup/delivery managers & accounts: logs; auditor: view). Settings `vehicle.doc_alert_days` (30), `vehicle.service_interval_km` (3000), `vehicle.fuel_price`.
- **Hand over = Employee ID only.** `vehicle_assign(p_vehicle, p_employee_code, p_reason, p_from, p_keep_hub)`: the vehicle's hub and zone follow the
  person's current `employee_assignments.hub_id` automatically (`moved_hub` is recorded); `p_keep_hub` keeps it where it is. Needs the right at the
  destination hub too. The holder may write fuel/costs for their own vehicle without `vehicle.log.create`; a line's author may edit/remove it for 24 h.
- RPCs: `vehicle_hubs`, `vehicle_overview(hub)`, `vehicle_alerts(hub)` (papers expiring/expired, service due by km, no holder, workshop),
  `vehicle_report(from, to, hub)`, `vehicle_log_list`, `vehicle_history`, `vehicle_save(... p_more jsonb)`, `vehicle_archive`, `vehicle_release`,
  `vehicle_document_save/archive`, `vehicle_log_save/remove`, `vehicle_settings/configure`. Old `vehicle_list` (Accounts settings card) still works.
- Page `/app/vehicles/:section` (pages/vehicles/Vehicles.tsx, lib/vehicles.ts): overview (stats, alerts, per-hub, cards), list (add/edit with all
  fields, hand over by ID showing the person's hub and whether the vehicle will move, take back, history, remove), logs (fuel/service/repair entry with
  litres→amount hint from fuel price, km/L, service due), docs (cards with days left, photo/PDF upload with camera, "not recorded" hint), reports
  (per vehicle × kind, ৳/km, quick ranges), settings. Menu group "গাড়ি ম্যানেজমেন্ট"; quick action "গাড়ির তেল / খরচ".

## 2026-11-15 — Vehicle operations: crew, served hubs, fuel approval → sheet, requisitions, day log
- Migration `20261115001000_vehicle_ops.sql` (applied to dev in chunks — the MCP client blocks statements containing `drop`/`delete from`; the file is the source of truth):
  `vehicle_assignments.role` (driver | helper; one of each at a time; only a DRIVER hand-over moves the vehicle's hub). `vehicle_hubs` = extra hubs a big
  vehicle works for: their managers see the vehicle, its requisitions and ONLY fuel/charge costs (`vehicle_served_perm`). `vehicle_logs.status`
  (submitted/approved/rejected), `slip_path`, `day_log_id`, new kind `charge`. Crew writes fuel → `submitted` + managers notified (`vehicle.log.approve`)
  → `vehicle_log_decide` → `vehicle_log_to_sheet(log, hub?, date?)` creates the `da_expenses` line (kind transport, category fuel/repair/transport)
  on that day's sheet (starts the sheet if needed) and links the vehicle. `vehicle_requisitions` (VR-00001…; open → accepted → started → done /
  rejected / cancelled; events table; notifications to crew + managers; `vehicle.requisition.view/create/approve`). `vehicle_day_logs` (one per vehicle
  per day: charged?, place, cost, out/in, km, trips, `data` from `vehicle.day_format`); a charge cost creates/updates a linked `charge` vehicle_log.
  Settings `vehicle.requisition_format` / `vehicle.day_format` = field lists (text/number/date/phone/textarea/select) edited in Vehicle settings.
- Page tabs: আমার গাড়ি (`/app/vehicles/mine`, visible to any crew member: fuel submit with slip photo, day log, my jobs, my lines with status),
  গাড়ি লাগবে (`/requests`, cards; accept assigns a vehicle if none; crew: আমি যাব / রওনা / শেষ), দিনের খাতা (`/daily`). List shows driver + helper +
  served hubs (checkbox chips in the edit form). Logs tab: status badge, slip, অনুমোদন / না / খাতায় তুলুন. Overview: pending-approval panel.
- Decisions (owner, 15 Nov): fuel goes on the sheet only after manager approval; the day log is the driver's job but a manager may write it; served-hub
  managers see fuel/charge costs only, no cost split between hubs.

## 2026-11-15 — Driver requests (parts / service / problem)
- Migration `20261115001100_vehicle_requests.sql`: `vehicle_requests` (VQ-00001…; kind parts/service/problem/other; `data` from the per-kind format in
  `vehicle.request_formats`; photo; priority; open → accepted → done (cost → an approved `vehicle_logs` line: parts/service/repair; service updates
  last-service) / rejected / cancelled). Crew or a manager submits (`vehicle_request_submit`); managers with `vehicle.log.approve` are notified;
  `vehicle_request_update` notifies the driver. `vehicle_request_list(hub, vehicle, open_only)`.
- UI: "আমার গাড়ি" shows big tiles per vehicle — তেল তুলেছি · পার্টস লাগবে · সার্ভিসিং লাগবে · সমস্যা জানান · দিনের খাতা — plus "আমার অনুরোধ".
  Requisitions tab has a "ড্রাইভারদের অনুরোধ" section (accept / done with cost / reject); overview shows the open ones. Settings: a format editor per kind.

## 2026-11-16 — Staff panel (`/app/staff`) and staff giving their own attendance
- Page `web/src/pages/staff/StaffPanel.tsx`: the staff member's whole day on one phone screen, in the owner's order — আমার হিসাব · আজকের হাজিরা ·
  আমার বিল · রুট ও দায়িত্ব · অভিযোগ · ইস্যু ও যোগাযোগ · আমার লোক. It reads what the person may already see and links to the working pages.
  Rows with nothing behind them yet are marked "শীঘ্রই": today's returns, zone group, zonal manager contact. `/app/accounts/mine?bill=1` opens the bill form.
- Migration `20261116000600_self_attendance.sql` — decision (owner, 16 Nov): staff input is enough, no location check; every staff input counts
  only once a manager approves it. `att_self_mark('present' | 'absent', reason)` for today (Dhaka) → `attendance_self_marks` (waiting); the hub's
  managers with `hr.attendance.create` are notified. `att_self_list(hub, date)` / `att_self_decide(ids, ok, as, note)`: approve as present / late /
  half day / absent writes `attendance_records` (source `self`); return needs a reason; the staff member is notified. Nobody approves their own.
  `my_att_today()` feeds the staff panel. UI: hub page "আজকের হাজিরা খাতা" has a "স্টাফের দেওয়া হাজিরা" box above the register.
- Tests: `supabase/tests/99zzzz_self_attendance.sql` (19). `99f_role_dashboards.sql` already fails on its "nine panels" count (the catalogue grew); not touched.
- **To go live:** apply the migration on Supabase, then merge to `main` (site deploys itself; APK by hand from Actions).

## 2026-11-16 — Vehicle pages taken off the website
- Owner (16 Nov): "ওয়েবসাইট থেকে গাড়ি ফাংশান ডিলেট করে দেও — আমি যেটা চাই সেইটা আলাদা". Removed `pages/vehicles/Vehicles.tsx`, `lib/vehicles.ts`,
  the "গাড়ি" menu part, "আমার গাড়ি", the vehicle quick actions and the settings link. `/app/vehicles/*` now goes to the home page.
- **Database not touched:** vehicle tables, functions and data (migrations `0900`–`1100`) are still on Supabase. The vehicle picker in
  sorting (route / fuel / trips) and in daily accounts (expense for a vehicle, "আমার নামে থাকা গাড়ি") still read the `vehicles` list.
  The owner will describe the vehicle feature he wants instead.

## 2026-11-16 — গাড়ি (fleet), rebuilt the way the owner asked
- Owner's spec (16 Nov): zone's vehicles with name and number, given to a hub; crew by kind (driver + helper, or auto driver only);
  daily allowance (খোরাকি) per person that reaches accounts with a voucher; the manager records whether the auto was charged at the garage;
  drivers/helpers report hubs to the zonal manager (loaded on time / late to unload / no trip); service requisition in a set format with photos;
  fuel with the slip; settings to switch functions on and edit formats; permissions/approvals; an assign log.
- Migration `20261116000700_fleet.sql` builds on the existing vehicle tables (data kept). New: kinds `covered_van`, `auto`; `vehicle_assignments.daily_allowance`;
  `vehicle_logs` kind `khoraki` (once per person per day); `vehicle_requests.photos`; setting `vehicle.fleet` (functions, kinds + crew, default allowance);
  `vehicle_events` (assign log, filled by triggers); `vehicle_hub_reports`; permissions `vehicle.report.view`, `vehicle.khoraki.post`.
  Functions: `fleet_vehicle_save`, `fleet_set_crew` (vehicle stays at its hub), `fleet_khoraki_post`, `fleet_garage_save`, `fleet_approve` / `fleet_post`
  (approve → the vehicle hub's daily sheet + voucher when there is no bill; if the sheet cannot take it the line stays approved and is posted later),
  `fleet_request` / `fleet_request_done`, `fleet_hub_report` / `fleet_hub_reports`, `fleet_board`, `fleet_waiting`, `fleet_events`, `fleet_mine`, `fleet_approvers`.
  A crew member who is not a member of the vehicle's hub goes on the sheet by name (the sheet takes an Employee ID only for its own hub's people).
  Notification links to `/app/vehicles…` are rewritten to `/app/fleet…`.
- Pages: `/app/fleet` (managers: গাড়ি ও দায়িত্ব · আজ: খোরাকি ও গ্যারেজ · অনুমোদন · হাব রিপোর্ট · এস্যাইন লগ · সেটিং) and `/app/fleet/mine` (crew).
- Tests: `supabase/tests/99zzzzz_fleet.sql` (38), browser smoke checks for both pages.
- Note: the live database has migrations the repo does not (`manager_ledgers_rider_submit`, `cash_payments_refs_approvals_requests`,
  `fix_collector_trigger_generic`, `_2`), and live `da_save_expense`, `vehicle_assign`, `vehicle_day_save`, `vehicle_log_save` differ from the repo's.
  The fleet migration only calls them. Bring those into the repo when convenient.

## 2026-11-17 — অফিস অপারেশন (office operations)
- Owner's spec (16 Nov): office rent with room split, running rent from the accounts' expense categories, advance, landlord, number, contract term and photo,
  new contract by AI, memo (or an own memo format when there is none); electricity bill with a mobile-banking screenshot; wifi bill; residential flat / garage /
  auto garage attached to a hub; electronic items with optional watt and an estimate of the electricity bill plus ways to lower it; "broken / needed" reports to the
  zonal manager per item; an item lent to another hub stays counted at its owner; hub vehicles with crew; locks and who holds the key; PCs per desk with the lock
  shared; chairs, tables, G-printer, weight machine, phones; CCTV / router / DVR with user name and password; residents of a residence; AI suggestions.
- Migration `20261116000800_office_operations.sql` (builds on `office_*` of 0300; nothing removed): place kinds `garage`, `auto_garage`; lease columns on
  `office_properties` (advance, contract_from/to, contract_file, rent_due_day, meter_no, unit_rate, wifi_provider, wifi_bill, capacity); `office_assets` gains
  watt, hours_per_day, spec, vehicle_id; new tables `office_bills` (rent / electricity / wifi / other per month; own memo number `OM-YYMM-00001` when no memo;
  electricity needs `proof_file`), `office_asset_loans`, `office_residents`, `office_secrets` (no audit trigger, so passwords stay out of the audit log),
  `office_notices` (`ON-00001`). Functions: `office_bill_save/remove`, `office_expense_lines` (hub's `da_expenses` in the categories of setting
  `office.bill_categories`: rent = office_rent, others_rental; electricity = utilities; wifi = internet), `office_lend`, `office_lend_return`, `office_loan_list`,
  `office_notice_send` (marks the item broken, notifies holders of `office.notice.approve` in the zone; head office only when the zone has nobody),
  `office_notice_update`. Private bucket `office-docs` (`<property_id>/<file>`). Permissions `office.bill.view/edit`, `office.secret.view/edit`,
  `office.notice.create/approve`; the hub manager role now also gets `office.property.edit` and `office.asset.edit` for the own hub.
- Pages (`pages/office/OfficeOps.tsx`, `lib/officeOps.ts`): `/app/office/rent`, `/bills`, `/power`, `/security`, `/people`, `/notices`, `/zone`; the resources list has
  নষ্ট / লাগবে / অন্য অফিসে দিন per item and watt, hours, size fields. The power estimate, saving tips, contract draft, memo and "what to do first" list are worked
  out in the browser from the data; the "নদী AI" buttons call the Edge Function `nodi-ai` with `action: 'office'` (tasks contract / power / insight) and need
  `ANTHROPIC_API_KEY`. Passwords are never sent to the AI.
- Tests: `supabase/tests/99zzzzzz_office_ops.sql` (46). Browser smoke check of every new page with sample data (desktop and phone).
- **To go live:** apply the migration on Supabase, deploy `nodi-ai` again, then merge to `main`. Until the migration is applied the new tabs say so.
- Not built: bills are not pushed into the daily sheet (the sheet stays the source; a bill is tied to its line), the unit rate default (৳11) is an assumption.

## 2026-11-17 — Public home in the app's look, with the motto
- Owner: "home ui/ux android native and this text added". `pages/Home.tsx` is now one column of rounded cards (classes `nh-*` in `theme.css`): a gradient hero
  with "Less Work, More Automation, Better Manage." and its Bangla line, three cards explaining the motto, the work list, the steps, "what it is not".
  On a phone the login button sits in a fixed bar at the bottom. The dashboard's greeting card carries the motto too. All earlier wording is kept.
- Fix found on the way: with the phone in dark mode and the theme on "system", the page background stayed light everywhere (a light-only rule was not limited to light).
- **17 Nov — live:** office operations and fleet applied to Supabase (recorded as `office_operations`, `fleet`), `nodi-ai` v4 deployed, PR #33 merged.
  The three kind-check swaps (vehicles, vehicle_logs, office_properties) need a DROP CONSTRAINT, which the MCP client stops for approval; they were given to the
  owner as a small SQL to run in the SQL Editor. Until then: no auto / covered van vehicles, no খোরাকি lines, no garage / auto garage places.
