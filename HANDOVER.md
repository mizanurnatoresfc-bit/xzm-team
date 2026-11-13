# XZM-TEAM ERP — Handover (13 Nov 2026)

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
| Hosting | Netlify — project `xzm-team-erp`, site id `2909a0bd-55bc-4b11-930f-73750fb34bd4`, team `mizanur-rahman-lydcsfo`. Git-এ যুক্ত নয়; হাতে আপলোড (drag & drop `web/dist`) বা Netlify CLI দিয়ে deploy। |
| Supabase | project `xzm-team-erp-dev`, ref `ndgnhvbpmtxrpplgsslz`, org XSFCTEAM, region ap-southeast-1 (Singapore), Free plan |
| PC-তে ফোল্ডার | `C:\Users\Mizanur\Downloads\xzm-team-react-supabase-phase1\xzm-team-erp` (git চালু, `save-to-git.bat` দিয়ে সেভ) |
| একমাত্র ইউজার | মালিক — Super Admin (global) |
| সময় অঞ্চল | ডাটাবেস Asia/Dhaka |

**Frontend env (public, গোপন নয়):** `web/.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key)। `web/create-env.bat` এটা বানায়। Netlify-তেও একই দুটো env var সেট করা আছে।
**গোপন key (service role, DB password, Netlify token) কখনো চ্যাটে, কোডে বা ডকুমেন্টে দেবেন না।** Edge Function-এর service key Supabase নিজে দেয়।

---

## 2. কী লাইভ আছে / What is live now

ডাটাবেস: migration `0100` থেকে `001400` পর্যন্ত (14টা) লাইভে বসানো। 59টা টেবিল, সবগুলোতে RLS।

Edge Function লাইভ: `auth-login` (verify_jwt OFF) — পাসওয়ার্ড ভুলের হিসাব, ৫ বার ভুলে ৩০ মিনিট লক।

ওয়েব (Netlify-তে লাইভ):
- পাবলিক হোম `/`, স্টাফ লগইন, ড্যাশবোর্ড
- ডেমোর মতো ডিজাইন: আইকন মেনু (গ্রুপ), নোটিফিকেশন, বাংলা/English, ডার্ক মোড, টেবিলে প্রিন্ট/Excel/PDF
- জোনাল ম্যানেজমেন্ট: প্রতিষ্ঠান, জোন, হাব, বিভাগ, পদবি
- স্টাফ ম্যানেজমেন্ট: HR ড্যাশবোর্ড, কর্মী তালিকা ও প্রোফাইল, আইডি আবেদন (খসড়া → সাবমিট → অনুমোদন/ফেরত/বাতিল), ডকুমেন্ট আপলোড, হাজিরা, ছুটি
- হিসাব ম্যানেজমেন্ট: দৈনিক হিসাব খাতা, আমার হিসাব, রিপোর্ট, সেটিংস

## 3. তৈরি ও পরীক্ষিত, কিন্তু এখনো লাইভে বসানো হয়নি / Built, tested, NOT yet live

**ইউজার ও রোল (স্টাফ লগইন অ্যাকাউন্ট খোলা ও রোল দেওয়া)** — এই জিপে আছে:
- `supabase/migrations/20261113001500_user_admin.sql` (লাইভে বসানোর জন্য পেস্ট-রেডি কপি: `supabase/users-update.sql`)
- `supabase/functions/admin-users/index.ts` (নতুন Edge Function, **verify_jwt OFF** করে deploy করতে হবে)
- ওয়েব: `web/src/lib/users.ts`, `web/src/pages/users/*`, `web/src/pages/ChangePassword.tsx`, এবং `App.tsx`, `AppShell.tsx`, `ProtectedRoute.tsx`, `AuthProvider.tsx`-এ বদল
- পরীক্ষা: `supabase/tests/99_user_admin.sql` (43টা চেক) — মোট 594/594 পাস; ব্রাউজারে পুরো ফ্লো পরীক্ষিত।

বসানোর ধাপ:
1. Supabase → SQL Editor → `supabase/users-update.sql` পুরোটা পেস্ট → Run (দুবার চালালেও সমস্যা নেই)।
2. Supabase → Edge Functions → Deploy a new function → Via Editor → নাম `admin-users` → `supabase/functions/admin-users/index.ts`-এর কোড পেস্ট → Deploy → Details/Settings থেকে Verify JWT **OFF** → Save।
   (CLI থাকলে: `supabase functions deploy admin-users --no-verify-jwt --project-ref ndgnhvbpmtxrpplgsslz`)
3. প্রজেক্ট ফোল্ডারে `build-site.bat` চালান → Netlify Deploys পাতায় `web/dist` ফোল্ডার টেনে ছেড়ে দিন।
4. পরীক্ষা: লগইন → মেনু "সিস্টেম → ইউজার ও রোল" → নতুন অ্যাকাউন্ট → সেই অ্যাকাউন্টে লগইন করলে আগে নতুন পাসওয়ার্ড চাইবে।
5. `save-to-git.bat` চালিয়ে মেসেজ দিন `users and roles`।

### Android অ্যাপ (Capacitor) — তৈরি, এখনো APK বানানো হয়নি
- একই কোড থেকে Android অ্যাপ: `web/capacitor.config.json`, `web/assets/` (আইকন ও স্প্ল্যাশ), `web/src/lib/native.ts` (ব্যাক বোতাম), `make-android.bat` (APK বানায়)। বিস্তারিত: `docs/ANDROID.md`।
- অ্যাপ থেকে লগইনের জন্য `auth-login` ও `admin-users` Edge Function-এ `https://localhost` origin যোগ করা হয়েছে — **`auth-login` আবার deploy করতে হবে** (কোড: `supabase/functions/auth-login/index.ts`, verify_jwt OFF)।
- PC-তে লাগবে: Node.js আর Android Studio (একবার ইনস্টল)। তারপর `make-android.bat` চালালে প্রজেক্ট ফোল্ডারে `XZM-TEAM.apk` তৈরি হবে।

## 4. এককালীন সেটিংস যা বাকি থাকতে পারে / One-time settings to check

- [ ] Supabase → Authentication → Hooks → **Customize Access Token** → `public.custom_access_token_hook` চালু (লক/বন্ধ অ্যাকাউন্ট আটকাতে)।
- [ ] Supabase → Authentication → URL Configuration → Site URL = `https://xzm-team-erp.netlify.app`
- [ ] সত্যিকার ব্যবহারের আগে নিজস্ব SMTP (Supabase-এর বিল্ট-ইন ইমেইল সীমিত)।
- [ ] প্রথম জোন ও হাব তৈরি (লাইভ ডাটাবেসে এখনো কোনো প্রতিষ্ঠান/জোন/হাব নেই)।

## 5. পরের কাজের তালিকা / Backlog (অগ্রাধিকার অনুযায়ী)

1. ইউজার ও রোল লাইভে বসানো (উপরের ৩ নম্বর)।
2. **পার্সেল বারকোড/QR স্ক্যান পেজ** — মোবাইল ক্যামেরায় Steadfast লেবেল স্ক্যান → `parcels.tracking_no` দিয়ে খুঁজে লাইন দেখানো (মার্চেন্ট, গ্রাহক, মোবাইল, এলাকা, COD, অবস্থা, Settle/Delivered বোতাম)। ডাটাবেসে `parcels` টেবিল ও `ops_parcel_lookup(p_tracking_no)` আগেই আছে। খোলা প্রশ্ন: স্ক্যান দিয়ে (ক) নতুন পার্সেল গ্রহণ নাকি (খ) আগের পার্সেল খুঁজে ডেলিভারি/সেটেল? Steadfast API key আছে কি? (key সার্ভারে রাখতে হবে)
3. Android অ্যাপ: `auth-login` redeploy → `make-android.bat` → APK ফোনে পরীক্ষা; পরে Play Store।
4. বেতন শিট UI, ডকুমেন্ট যাচাই UI, বাল্ক ইমপোর্ট UI।
5. জোনাল ও কুরিয়ার অপারেশনের পেজ (ডাটাবেস তৈরি, UI বাকি)।
6. ভেতরের পেজগুলোর English অনুবাদ।
7. পারফরম্যান্স: 23টা RLS policy-তে `auth.uid()` কে `(select auth.uid())` করা।

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

- গোপন key কখনো চ্যাট, কোড, স্ক্রিনশট বা ডকুমেন্টে নয়; শুধু সার্ভার-সাইডে।
- আগের মডিউল বা ডাটাবেস ভাঙা যাবে না — প্রতিটা বদলের পর পুরো SQL টেস্ট চালাতে হবে।
- রিমোট টুল দিয়ে `.env` ফাইল লেখা যাবে না (`web/create-env.bat` আছে)।
- মালিকের পাসওয়ার্ড চাওয়া বা ব্যবহার করা যাবে না।
- মালিক বাংলায় লেখেন; উত্তর বাংলায়, সহজ ভাষায়, ধাপে ধাপে।

## 8. নতুন Claude চ্যাটে যা লিখবেন / Starter message for a new chat

> আমার XZM-TEAM ERP প্রজেক্টের কাজ চালিয়ে যেতে চাই। প্রজেক্টের জিপ আর HANDOVER.md দিলাম। আগে HANDOVER.md পড়ুন, তারপর ৩ নম্বর অংশের "ইউজার ও রোল" লাইভে বসাতে সাহায্য করুন (Supabase ও Netlify connector থাকলে আপনি নিজেই করুন)। এরপর বারকোড স্ক্যান পেজ। আমাকে বাংলায় উত্তর দেবেন।
