# ৫. Implementation Checklist

প্রতিটি Phase শেষে: ✔ SQL টেস্ট সবুজ · ✔ `npm run typecheck && build` · ✔ `test:nav` · ✔ Staging-এ রোল-হাঁটা · ✔ আপনার অনুমোদন → তবেই পরের Phase।
**Production-এ কিছুই যাবে না Staging পরীক্ষা ও Super Admin অনুমোদন ছাড়া।** "অনুমোদন-দরকার" চিহ্ন (🔒) মানে লাইভে হাত পড়ার ধাপ।

## Phase 0 — প্রস্তুতি (কোনো নতুন ফিচার নয়)
- [ ] 🔒 **সিদ্ধান্ত:** Staging পরিবেশ কোথায় (`06` প্রশ্ন #১)
- [ ] A1: লাইভ-থাকা-কিন্তু-রিপো-নেই Migration/ভিউ/Edge Function-এর সোর্স রিপোতে আনা (M0) — শুধু পড়ে ও ফাইল লিখে; লাইভে কিছু চালানো নয়
- [ ] রিপোর `README`/`docs/*` শিরোনাম থেকে "ই-আর-পি" সরানো (শুধু ডকুমেন্ট)
- [ ] CI-তে বর্তমান SQL টেস্ট অবস্থা যাচাই (`99f_role_dashboards`, A9)
- [ ] 🔒 GitHub `production` Environment + Required reviewer (২.৮) — আপনি/আমি আপনার নির্দেশে

## Phase 1 — ভিত্তি (আপনার নির্ধারিত অগ্রাধিকার; Staging-এ আগে, তারপর 🔒 লাইভে)
- [ ] M1 Master Function Registry + `scan.mjs` + `registry.manifest.json` + `sc_registry_sync` → প্রথম পূর্ণ তালিকা ও drift রিপোর্ট
- [ ] Dependency Map (edges) + প্রভাব-বিশ্লেষণ RPC
- [ ] M6 অনুমতি + `/app/control` রুট, মেনু গ্রুপ, `navAccess` + টেস্ট; Command Dashboard কাঠামো (অসম্পূর্ণ = ব্যাজ)
- [ ] #22 System Settings একক দৃশ্য (বিদ্যমান `system_settings`; কারণ-বাধ্যতামূলক সম্পাদনা, মান-যাচাই, audit)
- [ ] #3 Audit Center (অনুসন্ধান + কভারেজ রিপোর্ট; M7 প্রস্তাব আলাদা অনুমোদনে)
- [ ] M4 System Health (প্রথম সংস্করণ: RLS/audit কভারেজ, cron অবস্থা, timezone, Edge ping, Migration drift)
- [ ] M3 Error Logging + ক্লায়েন্ট হুক (ErrorBoundary, onerror, unhandledrejection, RPC ত্রুটি) — PII ছাঁটাই টেস্টসহ
- [ ] M5 Permission Audit রিপোর্ট
- [ ] M8 DEMO Test Foundation: `sc_test_*` কাঠামো, Staging ডাটা-সীড নিয়ম (কৃত্রিম), `role-demo` ফলাফল ঢোকানো
- [ ] নতুন কোডে "ই-আর-পি" শূন্য — গ্রেপ চেক CI-তে

**গ্রহণযোগ্যতা:** Registry-তে সব পাতা/RPC/Edge/job/টেবিল/পারমিশনের ইউনিক ID; ড্রিফট ০ বা নথিভুক্ত; অ-Super কেউ কোনো `sc_*` খুলতে/কল করতে পারে না (UI + RPC + RLS তিন স্তরেই); ব্যবসার টেবিলের সারি সংখ্যা আগে/পরে সমান; কোনো Secret `web/dist`-এ নেই।

## Phase 2 — পর্যবেক্ষণ (শুধু-পড়া)
- [ ] Database Monitor (#11), Security Center (#12), Activity & Change Log (#14), System Documentation (#18), Automation Manager দেখা-অংশ (#20), Health সম্পূর্ণ (cron ব্যর্থতা, ধীর কুয়েরি)
- [ ] Command Dashboard-এ সত্যিকারের ডাটা

## Phase 3 — নিয়ন্ত্রণ (🔒 প্রতিটি ধাপে আলাদা অনুমোদন)
- [ ] Feature on/off + Dependency Check (M2) · Web & App Manager (#9) · Automation বিরতি/চালু (whitelist) · Integration Center (M11) · Backup রেকর্ড + নির্ধারিত ব্যাকআপ (M10; সিদ্ধান্ত #৩) · Release Manager + অনুমোদন-গেট (M9) · Notification Center (#19)

## Phase 4 — বাকি
- [ ] UI/UX Manager (#8) · Workflow Manager (#10) · Development Tasks (#17) · AI Gateway ইন্টারফেস (কোড নয়, নথি + স্লট)

## প্রতিটি মডিউল "কার্যকর" ঘোষণার শর্ত (নইলে মেনুতে `partial`)
1. Registry-তে ID ও edges  2. DB-স্তরে পারমিশন-টেস্ট  3. audit কভারেজ  4. বাংলা+English লেবেল  5. মোবাইল/ডার্ক-মোড দেখা  6. Staging-এ রোল-হাঁটা পাস  7. ডকুমেন্টেশন  8. Super Admin অনুমোদন
