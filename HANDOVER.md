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

হিসাব কেন্দ্র ও শেখার কেন্দ্র (১৭ নভেম্বর ২০২৬, migration `20261117000900_accounts_learning`):
- `/app/accounts/center` — হিসাব কেন্দ্র: দৈনিক রিপোর্ট, হাবের খরচ, মার্চেন্ট ক্যাশ পেমেন্ট, ব্যাংকে জমা, হাবের বকেয়া/ফান্ড, ভাউচার ম্যানেজমেন্ট, ভাউচার জমা হয়নি, স্টাফ খরচ, যাতায়াত বিল, হিসাবের ইতিহাস (আগের → নতুন মান), নতুন ভাউচার (PDF + ছবি), হাবের টপ শিট (প্রিন্ট/শেয়ার)। কে কোন হাব দেখেন তা ডাটাবেস ঠিক করে (`da_center_overview`)।
- `/app/accounts/learn` — বাংলা শেখার কেন্দ্র: ১৪টা বিষয়, প্রতিটায় কীভাবে কাজ করবেন / ধাপে ধাপে / নমুনা / কাগজপত্র / সাধারণ ভুল / অনুশীলন / AI-কে প্রশ্ন। লেখা আছে `web/src/lib/accountsGuide.ts`-এ (সিস্টেমের নিজস্ব নির্দেশনা)। খাতার প্রতিটি অংশে "নির্দেশনা" বোতাম।
- **SteadFast-এর অফিশিয়াল নিয়ম** কোডে লেখা নেই — হেড অফিস শেখার পাতার "SteadFast অফিশিয়াল" বাক্সে লিখে দেবে (setting `da.learn_official`)। AI শিক্ষক এটাকেই অফিশিয়াল ধরে, বাকি সব "নদী AI অভ্যন্তরীণ নির্দেশনা"।
- নদী AI হিসাব শিক্ষক: Edge Function `nodi-ai`-এর `teach` কাজ — টুল নেই, কিছু সেভ করে না; অফিশিয়াল নিয়ম ও সেটিংস নিজে ডাটাবেস থেকে পড়ে।
- ব্যাংক স্লিপ: ছবি দিলে OCR টাকা পড়ে MATCH / NOT MATCH / NEEDS REVIEW, কে কখন স্লিপ দিলেন। OCR দিয়ে কখনো "ব্যাংকে নিশ্চিত" হয় না — "ব্যাংকে নিশ্চিত করুন" বোতাম (মেলেনি হলে মন্তব্য বাধ্যতামূলক)। টেবিলে সরাসরি লিখলেও ডাটাবেস আটকায়।

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
- (17 Nov: the live-only migrations and functions mentioned here were brought into the repo — see the 17 Nov entry and docs/MIGRATIONS_LIVE_MAP.md.)

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
  The three kind-check swaps (vehicles, vehicle_logs, office_properties) were applied afterwards as migration `fleet_office_kinds` (owner approved).
  Live and repo now match for fleet and office operations.

## 2026-11-17 — HR requests: native-style new request and a report builder
- Owner (with a screenshot of the format cards): ID create / transfer / inactive→active / remove, modern Android look, easy and smart, reports in any format and style.
- `pages/hr/Requests.tsx`: new request now starts with "কী করবেন?" — 2×2 action tiles with the number waiting per kind; then hub (remembered on the device) and staff.
  The staff list follows the action (ID ACTIVE shows only closed IDs; transfer / inactive only active ones; "সবাই দেখান" lifts it), a person card shows ID, post, hub and
  status, and it warns when that person already has a request waiting. Transfer cannot pick the same hub. Reference is folded away; a sticky bar shows what will be sent.
- Report tab is a builder: ready reports (this month hub × kind, waiting by hub, kind by month, today, who sent how many), date range, table / bar chart / list,
  rows and columns by kind, format, hub, status, month, day, sender, reference, decided or not; filters by hub, kind, status; list columns include the formats' own fields.
  "সেভ" keeps a named report on that device (localStorage). Table and list export to Excel / PDF / print. `hrReq.between(from, to)` reads up to 5000 rows.
- No database change.

## 2026-11-17 — Phone check of every page
- Owner: "ওয়েব এর সকল কিছু মোবাইল ফ্রেন্ডলি করো". Every route (≈85, including each hub / sorting / office section and the request tabs) was opened at 360 px
  with sample data and measured: sideways overflow, tap targets under 32 px, text under 11.5 px. No page overflowed sideways.
- Fixed (`theme.css`, "phone polish" block): the নদী AI bubble moves to the bottom-left and shrinks on phones (it sat on pages' own "+ new" buttons);
  attendance choices show as a 3 × 2 grid instead of a hidden sideways scroll; small ghost / link / icon buttons get 36–40 px height; 11 px labels become 12 px.
- Not covered by the check: pages with large real data sets (only sample rows), and dialogs opened one by one beyond the office and request ones.

## 2026-11-17 — ঘণ্টা লাইভ and the notifications page
- Migration `20261117000100_live_notifications.sql` (applied live as `live_notifications`): `notifications` joins the `supabase_realtime` publication
  (Realtime applies the table's RLS, so each person hears only their own rows) and a partial index for unread counts.
- `web/src/lib/notices.ts`: one shared store per signed-in person — first 30 rows + exact unread count, a Realtime channel for INSERT/UPDATE of their rows,
  a 90 s poll and a refresh when the app comes back to the screen; stops on sign-out. A short vibration on phones that allow it.
- Bell (AppShell): live count, an icon per kind, "সব নোটিফিকেশন দেখুন →"; a banner drops in from the top for 6 s when something new arrives (tap opens it).
- Page `/app/notifications` (always open, like the profile): all / unread, filter by kind, grouped by day (আজ, গতকাল, …), tap opens and marks read,
  "সব পড়া হয়েছে", "আরও দেখুন" in pages of 40. Kinds known: hr_request, issue, vehicle, office, attendance, manpower, da_reminder, nodi.
- Not tested end-to-end with a real login (the browser check used sample rows; Realtime needs a signed-in session). Phone push (FCM) is the next step.

## 2026-11-17 — Phone push (Firebase Cloud Messaging), ready and waiting for Firebase
- Migration `20261117000200_phone_push.sql` (applied live as `phone_push`): `push_devices` (one row per phone token; a token moves to whoever signed
  in last on that phone; sign-out switches it off), `notifications.pushed_at`, `push_device_save/remove` for the app, `push_claim` / `push_device_dead`
  for the sender (service role only; `push_claim` takes each row once with SKIP LOCKED, rows older than 2 h are never pushed). A trigger on a new
  notification calls the Edge Function `push-send` through pg_net (only when that person has a phone saved); pg_cron job `push-send` runs every 2 minutes
  for anything missed. Tests: `supabase/tests/99zzzzzzz_push.sql` (12).
- Edge Function `push-send` (deployed, verify_jwt off, no secret in the call — it reads the queue itself): signs a Google token from the secret
  `FCM_SERVICE_ACCOUNT` (service-account JSON) and sends FCM HTTP v1 messages (channel `xzm`, high priority, data.link = the page to open);
  dead tokens are switched off. Without the secret it answers `{configured:false}` and claims nothing (checked live through pg_net).
- App: `@capacitor/push-notifications@7.0.6`; `lib/native.ts` `setupPush()` asks permission once after sign-in, saves the token, opens data.link when a push
  is tapped. The APK build writes `android/app/google-services.json` from the GitHub secret `GOOGLE_SERVICES_JSON` and adds POST_NOTIFICATIONS; without
  that secret the plugin is uninstalled for the build (the app would crash calling Firebase uninitialised), so APKs build exactly as before.
- **Owner steps left:** create the Firebase project and Android app `com.xzmteam.erp`; put `google-services.json` in the GitHub secret `GOOGLE_SERVICES_JSON`;
  put the service-account JSON in the Supabase secret `FCM_SERVICE_ACCOUNT`; build a new APK (Actions → Run workflow) and install it.

## 2026-11-17 — Call, SMS and WhatsApp from the app
- `components/Contact.tsx`: a number with three round buttons (কল · SMS · WhatsApp, the last as wa.me/880…). Used in the staff list, hub team, zonal staff,
  vehicle crew (manager and crew pages), office landlord and the HR request person card; the employee profile already had its own.
- `lib/native.ts` `handOutsideLinks()`: inside the Android app, a tap on tel: / sms: / mailto: / whatsapp: or on a link to another site or with target=_blank
  becomes a top-level navigation, which Capacitor hands to the phone (dialer, SMS app, WhatsApp, browser). In the web view such links could do nothing.
  Not checked on a real phone yet.

## 2026-11-17 — Live and repository made the same
- Brought in, word for word from `supabase_migrations.schema_migrations` (cron parts wrapped so a database without pg_cron skips them):
  `20261115001350_nodi_followup_schedule`, `20261115002410_manager_ledgers_rider_submit`, `20261115002420_cash_payments_refs_approvals_requests`,
  `20261115002430/2440_fix_collector_trigger_generic(_2)`, `20261116000650_report_import` — numbered so they run in the same order as on live.
- `20261117000300_sync_live_functions.sql`: the live text of 19 functions changed outside the files (vehicle_assign, vehicle_day_save, vehicle_log_save,
  login_resolve, role_admin_save, hr_validate/commit_import, hub_import_apply, …). Recorded on live as applied (nothing to run there).
- `20261117000400_foreign_key_indexes_2.sql`: 17 indexes the daily-accounts migrations left out (applied live).
- Fingerprint check (functions, columns, policies, constraints, triggers, indexes, permissions, settings): live = repo, except Supabase's own triggers.
  Map of files to live versions: `docs/MIGRATIONS_LIVE_MAP.md`.
- Tests now follow live behaviour: a hub sheet is submitted only after every khata is closed (`da_close_my_part`); a rider cannot open the hub sheet;
  dashboard catalogue 14 panels / 15 role layouts. All SQL tests pass: 1246 assertions, 0 failing files.
- **Open question for the owner:** on live, a khata that was closed and accepted stays closed when its person writes another line (the khata-accept
  design expected it to reopen). The assertion is commented out in `99y_sheet_check_flow.sql` until decided.

## 2026-11-17 — রেফারেন্স তালিকা with HR approval
- Owner: "রেফারেন্স এ লোক এড করা যাবে হাব জোন হাব সিলেক্ট করে, ম্যানুয়ালি ইনপুট, নাম পদবি নাম্বার হাবের নাম! সবাই করতে পারবে এড; ইডিট রিমুভ HR আপ্রুভাল দিলে শো করবে তার আগে ওয়েটিং".
- Migration `20261117000500_reference_people_approval.sql` (applied live): on `da_reference_people` — approval / pending_action (add · edit · remove) /
  pending_data / requester / decision columns and `hub_name`; read rule changed with ALTER POLICY: everyone reads the approved list, own requests, approvers all.
  New permission `hr.reference.approve` (admin, head office, HR manager). Functions `ref_request_add/edit/remove`, `ref_decide(ids, ok, note)`,
  `ref_hub_people(hub)` (name, ID, post, mobile of a hub's active staff, for anyone signed in). HR is notified of each request; the asker of each answer.
  A new person stays `inactive` until approved; a change keeps the old values until approved. Tests: `99zzzzzzzz_references.sql` (21).
- Page `/app/references` (menu "রেফারেন্স তালিকা", open to everyone): তালিকা (search, zone, call/SMS/WhatsApp), আমার অনুরোধ, অনুমোদন (HR; one or many).
  Add by জোন → হাব → লোক or by hand (name, post, number, hub name). The expense forms' "রেফারেন্স" dropdown now reads the approved list (the old
  `da.reference_people` setting stays as a fallback).

## 2026-11-17 — প্রোফাইল থেকে "যিনি এনেছেন" (স্টাফ ও ম্যানেজার দেন, HR অনুমোদন দেয়)
- Migration `20261117000600_employee_reference_requests.sql` (applied live): table `employee_reference_requests` (one waiting per employee; no direct access), RPCs `hr_reference_request`, `hr_reference_pending`, `hr_reference_requests`, `hr_reference_decide`.
- Who may ask: the staff member on their own profile, or anyone with `hr.employee.view` for that employee (hub/zonal managers). Who decides: `hr.reference.approve` or `hr.referral.edit` for that employee. HR still sets directly (old `hr_set_reference`).
- UI: profile রেফারেন্স panel shows "রেফারেন্স দিন" for staff/managers → sends to HR; a dashed "অপেক্ষায়" line shows the waiting name. `/app/references?tab=staff` (যিনি এনেছেন) lists them for HR with approve / "হবে না". `PersonPicker` hub list now reads `ref_hub_people` so staff can pick people too.
- Tests: `supabase/tests/99zzzzzzzzz_employee_reference.sql`. Full suite 1282 pass.

## 2026-11-17 — "যাঁদের এনেছেন": যোগ / বদল / সরানো, একসাথে অনেকজন
- Migration `20261117000700_brought_people_many.sql` (applied live): `employee_reference_requests.action` ('set' | 'remove'), `hr_reference_many(p_employees[], p_action, p_referrer, p_note)` → `{applied, waiting}` (HR applies at once, others wait), `hr_reference_brought_pending(p_referrer)`, `private.ref_apply`. `ref_can_ask` now also lets the current referrer ask about the people they brought.
- Profile: brought list is a compact card list with checkboxes, "সব বাছুন", "সরান (n)", per-row বদলান / সরান, "+ যোগ করুন" (hub → tick many, or paste many Employee IDs). Waiting adds/removals show as dashed "অপেক্ষায়" lines. HR's "যিনি এনেছেন" tab shows removal requests.
- Tests: `99zzzzzzzzzz_brought_many.sql`. Full suite 1293 pass.

## 2026-11-17 — Calm look across the whole app (owner approved the demo)
- Owner looked at the demo (three phone screens) and said "ভালো লাগছে, সব পাতায় এভাবে বানাও"; then asked for the look to go live on its own,
  ahead of the features waiting on branch `claude/route-panel-location-rider-lnznbs`.
- CSS only, no page logic: every `font-size` of 10–12.5px in theme.css / accounts.css raised (10→12, 11→13, 12→13.5, 12.5→14); body 16px;
  and a final "Calm look" block at the END of `web/src/theme.css` (loaded last, wins over the colourful phone layer): one main green `#15803D`
  (orange warning, red problem, blue leave/info, through theme variables so dark mode follows); flat cards with a thin border, no shadows or
  gradients; white number tiles with the number big and no icon blob; plain staff greeting and profile cover; green "+" button; phone tables
  as plain divided rows; label · amount tables keep the amount on the right in bold. Hind Siliguri first in the font stack.
- To change the look later, edit that last block, not the older layers above it.
- Not done yet: dates written as 01/01/2026 and some English words (Rider, HR, Staff); the employee list's phone cards are still tall.

## 2026-11-17 — Bangla dates and words on screen
- Owner: "তারিখ আর ইংরেজি শব্দগুলো বাংলায় করে দাও".
- `web/src/lib/bnText.ts` (started in `main.tsx`): in Bangla mode, every date shown on screen as 2026-11-15 or 15/11/2026 becomes
  "১৫ নভেম্বর ২০২৬", and a post or role name that arrives only in English shows its Bangla name (from `positions.name_bn` /
  `roles.name_bn`, loaded once after sign-in). Only screen text — never inputs, data sent to the server or downloaded Excel; dates inside file
  names or timestamps are left alone; switching to English restores the original. Add class `no-bn` to an element to keep its text as is.
- English words inside Bangla sentences replaced in the code (43 files): HR→এইচআর, NID→এনআইডি, Employee/Payment/Transaction ID→… আইডি,
  Submit→সাবমিট, Accept→গ্রহণ, Accounts Manager→হিসাব ম্যানেজার, Excel→এক্সেল, PDF→পিডিএফ, Super Admin→সুপার অ্যাডমিন; "ID 1001"→"আইডি 1001".
  Kept: "Save as PDF" (Chrome's own button), JPG/PNG, the main site's format names (ID CREATE, New Admin & Rider ID Create).

## 2026-11-17 — Staff complete their own profile; the zonal manager's popup question
- Owner: "সকল Employee তাদের প্রোফাইল কমপ্লিট করবে ইজিলি" — decision: whatever staff fill in about themselves saves at once.
  "জোনাল ড্যাশবোর্ডে পপআপ রিপোর্ট নিবো … হ্যাঁ না হোম স্ক্রিনে" — decision: the zonal manager picks who gets it; "পরে দেব" brings it back
  on the next app open until answered; a push notification goes out.
- Migration `20261117003000_self_profile_and_pulse.sql`: `private.can_fill_profile` and `private.can_upload_employee_object` also accept the
  caller's own employee record; `documents_insert` policy lets staff add their own photo / NID front / NID back / signature (ALTER POLICY).
  `pulse_questions` / `pulse_answers` (function-only), permission `zonal.pulse.manage` (Zonal Manager + Admin). Functions `pulse_create`
  (zone, title, body, kind yes_no | text | yes_no_text, hubs[], posts[], last day; notifies everyone it is for), `pulse_close`, `pulse_list`,
  `pulse_results` (everyone it went to, with answer or none), `pulse_mine`, `pulse_answer`. Tests `99zzzzzzzzzz_self_profile_pulse.sql` (23).
- UI: page `/app/me/complete` (always open: how full, what is missing, the hub profile form for oneself, photo / NID uploads shrunk to 1600 px);
  staff panel card "আমার প্রোফাইল X% পূর্ণ"; My Profile button. `components/PulsePopup.tsx` in AppShell (once per session);
  `pages/zonal/PulsePanel.tsx` on the zonal dashboard (new question with whole zone / hubs / posts, cards with counts, answers table, close).

## 2026-11-17 — আমার লোক ও উপস্থিতি (My Workforce & Attendance)
- Owner's spec: a personal menu under every name card (আমার লোক দেওয়া · আমার হাতে লোক আছে · আমার উপস্থিতি); a monthly attendance book open on days 1–17 where each staff member / rider
  gives each date on their own (উপস্থিত ছিলাম / উপস্থিত ছিলাম না → "ওয়েবসাইটে আবেদন করেছেন?" → হ্যাঁ/না; না = pick the absence dates and send an application); four direct inputs on the staff panel
  (Today's Pickup / Pickup Return / Delivery / Delivery Return) saved by date, user, hub and zone; a manager panel (own hub) and a zonal panel (all hubs); role-based access from one shared database,
  duplicate prevention, pending alerts, correction history, live updates, month archive, manager approval and application tracking.
- **Nothing is stored twice.** A staff member's per-date input is a row of the existing `attendance_self_marks` (4 columns added: `zone_id`, `applied_on_site`, `application_id`, `via`); the manager approves it with the
  existing, untouched `att_self_decide`, which writes the existing `attendance_records`. New tables only for what did not exist: `wf_absence_applications` (AB-00001…), `wf_daily_ops`, and the append-only `wf_att_history`, `wf_ops_history`.
  "আমার লোক দেওয়া" / "আমার হাতে লোক আছে" reuse the existing referral features (`hr_referrals`, `referral_prospects`).
- Migration `20261117010000_workforce_attendance.sql` (+ `supabase/tests/99zzzzzzzzzzzzz_workforce.sql`, 291 assertions; whole suite 1720 with the hub-operations migration, 1648 + 69 together with the live-only `advanced_permissions`). **Applied live on 17 Nov** (three parts, see `docs/MIGRATIONS_LIVE_MAP.md`); the pg_cron job `wf-remind` is active. Details, rules, rollback: `docs/WORKFORCE.md`.
  Contract between database and screens: `web/src/lib/workforce.ts` (18 `wf_*` functions). Settings `workforce.book_from_day` (1), `workforce.book_to_day` (17), `workforce.ops_backdate_days` (1).
  New permissions `ops.staff_daily.view` / `.edit`; everything else reuses `hr.attendance.view / create / edit`. pg_cron job `wf-remind` (16:00 Dhaka daily) sends the pending-attendance reminders (switch off: `select cron.unschedule('wf-remind')`).
- Pages: `/app/workforce/attendance|given|hand` (personal; always open to a signed-in staff member), `/app/workforce/hub` (manager: আজ · হাজিরা বই · অনুমোদন · আবেদন · দৈনিক রিপোর্ট · ইতিহাস),
  `/app/workforce/zone` (zonal, read only). The staff panel carries the four inputs ("আজকের কাজের হিসাব") and the alerts; the dashboard and the side menu carry the personal menu.
- `web/tests/smoke.mjs`: the limited-role menu now counts 8 links (the always-open attendance entry). Known, older, not touched: `web/node_modules` is a symlink committed by mistake in `0fa563d` pointing at itself —
  `npx tsc -b` / `npm run build` cannot run in a fresh clone until it is removed from git (CI still deploys, most likely because `npm ci` replaces it — not checked).
- Known limits: `att_self_decide` (old) notifies once per date, so approving a long application sends one notice per date; zone-without-hub staff are visible only to company-wide roles.

## 2026-11-17 — হাব অপারেশন ড্যাশবোর্ড (Hub Operations Dashboard) in the Zonal Manager panel
- Owner's spec (17 Nov): a hub-wise dashboard of the zonal manager's zone; each hub has its own input panel with staff by designation
  (Manager, Hub CC, Entry Man + configurable groups); total parcels, total pickups, remarks and operational reasons per hub; staff status
  (Active / New Employee / Resigned and Present / Absent / Leave Applied / Leave Not Applied), every change logged with date, reason, hub, remarks;
  hub summaries → one zonal summary; boss reports daily / weekly / monthly with Pending / Submitted / Reviewed; totals only from submitted inputs;
  corrections with history; phone first; zone-scoped access; no duplicate employee or hub records.
- Migration `20261117004000_hub_operations.sql` (additive). Tables (RLS on, no direct grants — only through functions): `hub_ops_reports`
  (one per hub per day; null number = not entered; pending → submitted → reviewed; `version` + `last_correction`), `hub_ops_staff` (one row per person,
  `employee_id` references HR; a person not in HR yet is written by name only — a mobile or same-hub name already in HR is refused),
  `hub_ops_status_log` (append-only), `hub_ops_boss_reports` (snapshot of the summary as sent; no row = pending), `hub_ops_config` (per zone:
  designation groups, reasons, hubs and weekdays without a report). Setting `zonal.hub_ops.defaults` (groups by post name match; week starts Saturday).
  Permissions `zonal.hub_ops.view/create/edit/approve/export/configure`: zonal manager view/create/edit/export/configure (zone scope), head office
  manager view/approve/export (the "boss"), auditor view/export, admin all. Zonal Assistant unchanged (its role test pins eight permissions).
- Functions: `hub_ops_panel(hub, date)` (HR staff of the hub + hints: attendance register, leave application, last status, the hub's own
  `hub_daily_metrics`), `hub_ops_save(hub, date, data, submit, reason)` (a submitted report changes only with a reason, goes back to "submitted"),
  `hub_ops_review(ids, note)`, `hub_ops_summary(zone, from, to)`, `hub_ops_status_log`, `hub_ops_history(kind, id)` (old → new from `audit_logs`),
  `hub_ops_boss_list/get/submit/review` (boss notified with kind `hub_ops`; review also marks the period's waiting hub reports reviewed),
  `hub_ops_settings/configure`, `hub_ops_people_search`. Maker / checker: whoever submitted cannot review.
  Resigned in a hub report does NOT change HR; the panel offers "এইচআর-এও চাকরি ছেড়েছেন করুন", which calls the existing `hr_change_status`.
- Pages: `/app/zonal/hub-ops` (tabs হাবগুলো · জোনাল সারাংশ · বসের রিপোর্ট · স্ট্যাটাস লগ · সেটিং) and `/app/zonal/hub-ops/hub/:hubId?date=` (input panel:
  big number boxes, reason chips, four one-tap attendance buttons per person, "বাকি সবাই উপস্থিত", "হাজিরা খাতা ও ছুটির আবেদন থেকে নিন",
  floating save bar above the phone menu, "পরের হাব →"). Menu: Zonal Manager panel → জোন ও হাব; shortcut on the Zonal dashboard.
- Tests: `supabase/tests/99zzzzzzzzzzzzz_hub_operations.sql` (72). Browser check at 390 px and 1366 px against the real SQL functions on a local DB.
- **17 Nov — live:** migration applied to Supabase as `hub_operations` (25 functions; fingerprint = repo), site released by merging to `main`.

## 2026-11-17 — Advanced Role & Permission Management (website)
- Owner: "Advanced Role & Permission Management — Dynamic Role Creation, Custom Permission Builder, Module-wise Permission, Sub-menu Permission,
  View / Create / Edit / Delete / Approve / Export Access, Hub-wise Data Restriction, Zone-wise Data Restriction, Individual User Override,
  Permission Change History, Super Admin Full Control — শুধু ওয়েব সাইট এ করো এখনো".
- **Website only for now:** menu "অ্যাডভান্সড রোল ও পারমিশন" → `/app/access`. Inside the Android app the older "রোল ও অনুমতি" page stays exactly as it was
  (`advancedAccessHere()` in `web/src/lib/native.ts`; make it return `true` to open the new pages in the app too). On the website `/app/roles…` leads to the new pages.
- Pages (`web/src/pages/access/*`, `lib/access.ts`, `lib/accessCatalog.ts`):
  - `/app/access` সারসংক্ষেপ: numbers, "নজর দিন" (worked out by itself: accounts without a role, only one Super Admin, people who see the whole company,
    unused / switched-off / empty roles, things ending within 7 days) and "কোন কাজ কোথায়" (the ten functions, each with its link).
  - `/app/access/roles` + `/app/access/role/:id` (`new`, `?copy=<role>`): role cards; the builder is **module → sub-menu → পাতা + দেখা / তৈরি / এডিট / ডিলিট /
    অনুমোদন / এক্সপোর্ট**. The six columns hold the database actions (edit = edit + configure, delete = archive + delete, approve = approve + reject,
    export = export + print + share). Whole role or whole module in one tap (সব / শুধু দেখা / কাজ করবে / কিছুই না), "অন্য রোলের মতো করুন", page limit
    ("সব পাতা" or "শুধু টিক দেওয়া পাতা" — an unticked page is neither in the menu nor opens by its address), second view "সব অনুমতি (বিস্তারিত)" for every
    single permission, unsaved boxes marked + / −, a review dialog before saving, switch a company-made role off / on, archive, copy.
    The catalogue (`accessCatalog.ts`) maps each menu page to permission codes; a permission used by several sub-menus sits in each (underlined box) and
    changes together; anything no sub-menu claims is added under its module by itself, so permissions from later migrations show up without code changes.
  - `/app/access/users` + `/app/access/user/:id`: roles with their **data limit** — whole company, zone-wise (whole zones) and hub-wise (single hubs) on one
    dialog; saving adds the new places first, then takes the removed ones back with a reason. "এই ইউজার যা করতে পারেন": the end result as the same grid,
    "কোথায় ও কোথা থেকে" list (place + which role / personal), "এই ইউজার যেভাবে দেখে" preview, and **personal permissions**: tick a box the roles do not give
    = বাড়তি (+) at the roles' places or one zone / hub, with an end date; untick a box the roles give = বন্ধ (−) for this person, everywhere. Reason required.
  - `/app/access/scope`: by hub or by zone — who is limited to it, who gets it through the zone, who sees the whole company.
  - `/app/access/history`: who changed what for whom, when and why (role created / changed / switched off / archived, permissions +/−, roles given /
    removed, page lists, personal permissions) from `audit_logs`; filters, Excel / PDF / print. Needs `system.audit.view`.
  - `/app/access/super`: what full control guarantees, who holds it (add / remove — the database keeps the last one), view as a role,
    roles × permissions matrix as Excel, every personal permission in one list.
- Migration `20261117004500_advanced_permissions.sql` — **applied to live 17 Nov (as `advanced_permissions`, owner said "করে দেও")**. Checked on live:
  every account's permissions are exactly the same as before (102 of 102 rows), the Super Admin still holds everything:
  `user_permission_overrides` (grant at role places / company / zone / hub, or deny everywhere; never deleted, taken back with a reason; audited),
  `private.grants_of(user, live)` = the single place that works out what a person may do, `private.my_grants()` now calls it (so every RLS rule follows
  personal permissions; a Super Admin is never touched). Both are PL/pgSQL now, so the plan is kept between calls: measured on the test database one
  permission check went from about 0.36–0.39 ms to about 0.12 ms, and reading 400 staff through RLS from about 190 ms to about 55 ms. `access_overrides`, `access_overrides_save`
  (whole list of one person in one step, Super Admin only), `access_user_grants`. `can_manage_user` / `user_admin_can_manage`: nobody resets or switches
  off an account that was personally given more than they hold themselves. `roles_status_guard`: switching a role on / off is Super Admin only.
- Tests: `supabase/tests/99zzzzzzzzzzzzz_advanced_permissions.sql` (69); full SQL suite 1426 pass. `web/tests/smoke.mjs` +42 checks (471 pass).
  The pages were also driven in a real browser against the local test database through a small stand-in for the REST API (not in the repository):
  every step was checked in the database itself (role saved, page list, hub → zone limit, personal permissions and what `has_permission` then answers).
- **To go live:** the database part is live; merge this branch to `main` and the site deploys itself (no new APK needed).
- Limits to know: a personal "বন্ধ" is for every place (not one hub); notifications that pick people by role permission do not look at personal permissions
  (what a person may do always does); parts of one page listed separately in the menu (accounts centre) cannot be switched off one by one.

## 2026-11-18 — হাজিরা: আগের তারিখ খোলা (জোনাল সেটিং) ও একসাথে সব দিন
- Owner: "Steadfast ওয়েবসাইটে এই এই তারিখে আবেদন করেছে … সাইট রেডি করতে লেট হচ্ছে, তাই এবার আগের সব তারিখে ডাটা ফিলাপ করে দেয়"; decisions: the zonal manager decides it
  in a zonal setting; staff fill everything on one page; attendance only (the four daily numbers keep their one-day rule).
- Migration `20261118200000_workforce_earlier_dates.sql`: table `wf_book_windows` (zone, dates inside one month's book days, open until; one live per zone and month,
  history kept, audited, never deleted), permission `hr.attendance.configure` (admin, zonal manager, HR manager), `wf_window_save` / `wf_window_end` / `wf_windows`,
  `wf_book_fill` (present + "applied on the Steadfast website" + not-applied absent dates with one application, all or nothing, through the old one-date functions),
  `private.wf_date_open` = the one "may this date be given now" rule. Six functions replaced with the same signature and behaviour plus the windows:
  `wf_check_date`, `wf_grid`, `wf_my_book`, `wf_hub_book`, `wf_pending_counts`, `wf_remind` (their live text was checked equal to the repository first).
- Pages: `/app/workforce/zone?tab=setting` (tab "সেটিং: আগের তারিখ খোলা", shortcut on the zonal dashboard): form + list with progress (who still has dates, how many wait for approval), close early.
  Attendance book: status line and the zonal manager's note, "একসাথে সব দিন" (`pages/workforce/BookFill.tsx`), a banner when another month is open, every date follows the database's
  `can_give`. The website question now says "Steadfast ওয়েবসাইটে". Manager's hub book and the staff alert card mention the open window.
- Tests: new file (80), the workforce file's function count 19 → 23; whole suite 1869 pass. Smoke test passes. Screens checked in a browser at 390 px and 1366 px against
  the real functions on a local database (no sideways scroll, no script errors): open window → fill 13 present + 2 Steadfast + 1 application → 0 left, 17 waiting.
- **18 Nov — live:** migration applied to Supabase as `workforce_earlier_dates` (20261118201608); after applying, all 53 `wf_*` function bodies
  were checked equal to the tested file by hash, anon can run none of them, the private helpers are closed, RLS is on. Site released by merging to `main`.
  No window is open yet: the Super Admin or the zonal manager opens one from জোনাল ওয়ার্কফোর্স রিপোর্ট → সেটিং.
- Live has three migrations of 18 Nov that are not in the repository yet (`hub_manager_more_pages`, `remove_nodi_ai_a_rename`, `staff_app_rls_revoke_anon_definer_execute`);
  none touches the workforce functions. They should be brought into the repository like the 17 Nov sync.
