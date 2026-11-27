# ৭. Phase 0 রিপোর্ট (২৭ নভেম্বর ২০২৬)

আপনার তিনটি উত্তর: (১) Staging কোথায় — আমার সিদ্ধান্ত; (২) GitHub `production` Environment-এ Required reviewer করা যাবে; (৩) Backup — আপনি পরে Pro-তে উন্নীত করবেন।

## ৭.১ সিদ্ধান্ত

| বিষয় | সিদ্ধান্ত |
|---|---|
| Staging | **দ্বিতীয় Supabase Free প্রজেক্ট `xzm-team-staging`** (সংস্থা XSFCTEAM, Singapore, খরচ $0)। সম্পূর্ণ কৃত্রিম ডাটা; লাইভের কোনো ডাটা কপি হবে না। প্রজেক্ট তৈরি আপনার এক শব্দের "হ্যাঁ"-র পর (নতুন ক্লাউড রিসোর্স বলে)। |
| Production অনুমোদন | `android-apk.yml` দুই জবে ভাগ করা হয়েছে: `apk` (বিল্ড + টেস্ট) → `deploy` (`environment: production`)। Environment-এ Required reviewer বসালে আপনার অনুমোদন ছাড়া লাইভ সাইটে কিছু যাবে না। |
| Backup | আপনি পরে Pro-তে উন্নীত করবেন। **ততদিন লাইভে কোনো Migration যাবে না** (Phase 1 লাইভ প্রয়োগ Pro-র দৈনিক ব্যাকআপ চালু হওয়া পর্যন্ত বন্ধ; Staging-এ কাজ চলবে)। System Control Center-এর Backup পাতা "ব্যাকআপ নেই" দেখাবে। |

## ৭.২ যা করা হলো (সব রিপোতে, লাইভে কিছু নয়)

1. **লাইভ ↔ রিপো ড্রিফট সঠিকভাবে মাপা।** নাম-মিল ছাড়া আসল ফারাক মাত্র **চারটি Migration** (বাকিগুলো ভেঙে/অন্য নামে প্রয়োগ করা, বিষয়বস্তু রিপোতে আছে)। চারটির হুবহু SQL লাইভের `schema_migrations` থেকে `supabase/live-drift/`-এ রাখা হয়েছে। লাইভ টেবিল ↔ রিপো টেবিল তুলনায় নতুন ফারাক শুধু `menu_items`, `position_menu_access`, `menu_access_history`, `v_user_sidebar`।
2. **থ্রোঅওয়ে PostgreSQL 16-এ যাচাই:** আগের ১৪০টি + এই ৪টি = ১৪৪টি Migration সব প্রয়োগ হয়; ২,৭৯৯টি assertion পাস।
3. **নতুন গুরুতর তথ্য (`supabase/live-drift/README.md`):** `role_sidebar_menu_system` লাইভে আছে কিন্তু **কাজ করে না** — ভিউ `employees.status = 'Active'` খোঁজে, অথচ আসল মান ছোট হাতের `'active'` (তাই ভিউ খালি); ফ্রন্টএন্ডে কোনো পাতা এগুলো পড়ে না; দুটি ফাংশন anon-এ চালানো যায় ও `search_path` বাঁধা নেই। অর্থাৎ এটি একটি **অসম্পূর্ণ মডিউল** — System Control Center-এ `partial` দেখাবে।
4. **বিদ্যমান CI সমস্যা:** `99n_performance_cleanup` ("প্রতিটি foreign key-র ইনডেক্স") এই কাজের আগেও ফেল করছে। ড্রিফট ফাইল যোগ করলে আরও দুটি টেস্ট ফেল করে (সঠিকভাবে — লাইভের আসল নিরাপত্তা-ফারাক ধরছে)। তাই ফাইলগুলো `migrations/`-এ না রেখে `live-drift/`-এ রাখা; টেস্ট সবুজ রাখার জন্য কোনো টেস্ট বদলানো/বন্ধ করা হয়নি।
5. **"ই-আর-পি" শব্দ** README, `docs/*`, `HANDOVER.md`, `build-site.bat`-এর শিরোনাম/বর্ণনা থেকে সরানো। পুরনো Migration-এর কমেন্টে থাকা শব্দ ইতিহাস হিসেবে অপরিবর্তিত।
6. **Production গেট:** `.github/workflows/android-apk.yml` — Netlify ও Cloudflare প্রকাশের ধাপ নতুন `deploy` জবে (`environment: production`) সরানো; কমান্ড ও শর্ত আগের মতোই। **এটি আমি এখানে চালিয়ে পরীক্ষা করতে পারিনি** (GitHub Actions) — PR মার্জের পর প্রথম রানে নজর রাখতে হবে।

## ৭.৩ আপনাকে যা করতে হবে

1. **GitHub → রিপো `xzm-team` → Settings → Environments → New environment → নাম `production` → Required reviewers → আপনার অ্যাকাউন্ট → Save।** (আমার GitHub টুলে Environment তৈরির ক্ষমতা নেই।) এটি **PR মার্জের আগে** করুন; না হলে প্রথম রানে `production` Environment বিনা-সুরক্ষায় স্বয়ংক্রিয় তৈরি হবে।
2. `xzm-team-staging` প্রজেক্ট তৈরির অনুমতি (হ্যাঁ/না)।

## ৭.৪ পরের ধাপ (Phase 1 — Staging-এ, আপনার অনুমোদনে)

লাইভ-ড্রিফট + সব Migration দিয়ে Staging বানানো → Master Function Registry (`scan.mjs`) → Dependency Map → System Settings → Audit Center → Health → Error Log → Permission Audit → DEMO Test Foundation। লাইভে প্রয়োগ Pro-র ব্যাকআপ চালু হওয়া ও আপনার আলাদা অনুমোদনের পর।

## ৭.৫ Staging তৈরি হয়েছে (২৭ নভেম্বর ২০২৬)

- প্রজেক্ট **`xzm-team-staging`**, ref `mbpjvqeizwjjsvnbjerb`, সংস্থা XSFCTEAM, Singapore, Free plan, Postgres 17 (লাইভের সমান), অবস্থা `ACTIVE_HEALTHY`। খরচ-নিশ্চিতকরণ লাগেনি।
- এখনো **খালি** — কোনো টেবিল নেই। লাইভের ডাটা কপি করা হয়নি, হবেও না।
- **Staging ভরার ব্যবস্থা:** `scripts/system-control/staging-bootstrap.sh` + হাতে-চালানো workflow `.github/workflows/staging-bootstrap.yml`। এটি `supabase/migrations/` ও `supabase/live-drift/` একসাথে সময়ক্রমে প্রয়োগ করে। স্ক্রিপ্ট লাইভ প্রজেক্টের সংযোগ-স্ট্রিং দিলে ও Staging ছাড়া অন্য কিছু দিলে **প্রত্যাখ্যান** করে (দুটোই পরীক্ষিত), আর Staging-এ আগে থেকে টেবিল থাকলেও থেমে যায়।
- চ্যাট-টুল দিয়ে ১৪৪টি ফাইল (কয়েকটি ৮০KB+) পাঠানো বাস্তবসম্মত নয়, তাই workflow ব্যবহার। এর জন্য আপনাকে একবার করতে হবে: Supabase → প্রজেক্ট `xzm-team-staging` → Database password রিসেট/সেট → Connect → **Session pooler** স্ট্রিং কপি → GitHub → Settings → Secrets and variables → Actions → New repository secret `STAGING_DB_URL`। **পাসওয়ার্ড চ্যাটে দেবেন না।**
- সতর্কতা: বিদ্যমান ১৪০টি Migration এতদিন শুধু লোকাল shim-এ পরীক্ষিত, আসল Supabase-এ নয় (README-তে লেখা)। Staging-এ প্রথম প্রয়োগে কিছু ধাপ ভাঙতে পারে — এটাই Staging-এর কাজ; ভাঙলে কারণসহ জানাব, লাইভে কিছু হবে না।
