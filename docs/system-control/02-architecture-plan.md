# ২. System Control Center — Architecture Plan

## ২.১ মূল সিদ্ধান্ত (সংক্ষেপে)

1. **নতুন সিস্টেম নয়, বিদ্যমানের উপরে একটি নিয়ন্ত্রণ স্তর।** React + Supabase (RLS + RPC + Edge Function) একই থাকবে। নতুন পাতা `web/src/pages/control/`, নতুন টেবিল `sc_` উপসর্গে (System Control), নতুন অনুমতি বিদ্যমান `system` মডিউলে।
2. **Registry আগে, বাকি সব পরে।** Master Function Registry + Dependency Map-ই পুরো কেন্দ্রের মেরুদণ্ড: Feature Disable-এর আগে Dependency Check, Audit Center-এর "কী বদলেছে", Release Manager-এর "কী প্রভাবিত" — সব এর থেকে আসে।
3. **Read-first।** শুরুর Phase-গুলোতে System Control Center ব্যবসার ডাটা **পড়ে না, বদলায় না** — শুধু কাঠামো (catalog), কনফিগারেশন ও নিজের `sc_` টেবিলে লেখে।
4. **Super Admin-only শুরুতে।** সব নতুন অনুমতি ডিফল্টে শুধু `super_admin` রোলে (বিদ্যমান `is_super` যুক্তি)। পরে Access Center দিয়ে ভাগ করা যাবে — কোনো আলাদা অনুমতি-ব্যবস্থা নয়।

## ২.২ আবশ্যিক নিয়ম → কীভাবে মানা হবে

| নিয়ম | বাস্তবায়ন |
|---|---|
| বিদ্যমান সিস্টেমের সাথে মিল | নতুন কিছু বানানোর আগে Registry-তে খোঁজা (বিদ্যমান টেবিল/ফাংশন/পারমিশন নাম অনুসন্ধান); `03`/`04` ফাইলে প্রতিটি মডিউলের "পুনঃব্যবহার" তালিকা |
| Duplicate নয় | CI চেক `scripts/system-control/check-duplicates.mjs`: নতুন Migration-এ এমন নাম থাকলে ফেল যা Registry/লাইভ catalog-এ আছে; পারমিশন কোড `permissions`-এ `unique` |
| বিদ্যমান UI/UX | `AppShell`, `DataTable`, `forms.tsx`, `theme.css`, `Icon`, `ask.tsx`, বাংলা-প্রথম দ্বিভাষিক `L(bn,en)`; নতুন CSS ফাইল নয় — `control.css` শুধু আবশ্যক হলে ও বিদ্যমান টোকেন দিয়ে |
| Web ও Android একই নিয়ম | সব নিয়ম DB/RPC-তে; পাতা একই কোড; Registry-তে `platform: web|android|both` |
| প্রতিটি ফাংশনের Unique ID | নিচে ২.৩ |
| Dependency Mapping | নিচে ২.৪ |
| Asia/Dhaka | DB: বিদ্যমান `alter database … timezone 'Asia/Dhaka'` + `system.timezone` সেটিং; নতুন কলাম `timestamptz`; "আজ" = বিদ্যমান `private.setting_text('system.timezone')`; UI: `Intl.DateTimeFormat(…, {timeZone:'Asia/Dhaka'})` — একটি শেয়ার্ড `lib/dhaka.ts` (আগে বিদ্যমান ব্যবহার যাচাই করে, নকল নয়); Health-এ `system_timezone_ok()` পুনঃব্যবহার |
| গুরুত্বপূর্ণ পরিবর্তনের Audit | বিদ্যমান `audit_logs` + `private.audit_row()`; **নতুন Audit টেবিল নয়**। সব `sc_` টেবিলে trigger; Feature/Release/Setting পরিবর্তনে `reason` বাধ্যতামূলক RPC-প্যারামিটার |
| Feature Disable-এর আগে Dependency Check | `sc_feature_set(key, enabled, reason)` RPC — Registry edge দেখে: (ক) বন্ধ করলে যেগুলো এর উপর নির্ভরশীল ও চালু, (খ) চালু করলে যে প্রয়োজনীয় জিনিস বন্ধ/অসম্পূর্ণ — থাকলে **প্রত্যাখ্যান** (তালিকাসহ), DB-তেই |
| Permission শুধু Frontend নয় | প্রতিটি `sc_*` RPC প্রথম লাইনে `private.has_permission('system.<res>.<act>')`; `sc_` টেবিল RLS চালু, সরাসরি লেখা বন্ধ (বিদ্যমান "RLS + RPC-only" ধরন)। পাতা `pagePermissions`-এ নথিভুক্ত। Permission Audit (Phase 1) নিজেই এ নিয়ম যাচাই করে |
| Secret Frontend-এ নয় | Integration Center শুধু মেটাডাটা ও "configured/missing" বুলিয়ান দেখায় (সার্ভার-পাশ থেকে); মান Edge secrets/Supabase Vault-এ। CI চেক: `web/` ও `dist/`-এ `service_role`, `sk-`, `eyJ…` (anon বাদে) খোঁজা |
| AI-এর জন্য Extensible | ২.৭ |
| DEMO/Staging ছাড়া Production নয় | ২.৮ (Release gate) |
| লাইভ ডাটা Delete/বদল নয় | এই প্রকল্পের কোনো RPC ব্যবসার টেবিলে `insert/update/delete` করে না; Migration শুধু নতুন `sc_` অবজেক্ট ও (Phase 1B-তে) অডিট trigger/permission যোগ করে — প্রতিটি আলাদা অনুমোদনে। Backup/Restore শুধু Staging-এ |
| অসম্পূর্ণ মডিউল কার্যকর দেখানো নয় | ২.৯ — Registry `status` ও UI ব্যাজ |
| Production Deployment-এ Super Admin Approval | ২.৮ |

## ২.৩ Unique Function ID

ফরম্যাট: `XZM.<module>.<kind>.<slug>` — যেমন `XZM.hr.rpc.employee_list`, `XZM.zonal.page.routes`, `XZM.system.job.wf_engine`, `XZM.da.table.da_sheets`, `XZM.system.perm.system.role.edit`।

- `kind`: `page | rpc | edge | job | trigger | table | perm | setting | bucket | flag | policy`
- ID অপরিবর্তনীয়; নাম বদলালে পুরনো ID `deprecated` + `replaced_by`। ডুপ্লিকেট DB `unique` দিয়ে অসম্ভব।
- **স্বয়ংক্রিয় সংগ্রহ, হাতে নয়:**
  - DB: `pg_proc`, `pg_class`, `pg_trigger`, `pg_policies`, `cron.job`, `storage.buckets`, `permissions`, `system_settings` — `sc_registry_sync()` (SECURITY DEFINER, super-only, শুধু catalog পড়ে)।
  - কোড: রিপোতে `scripts/system-control/scan.mjs` (Node, কোনো নেটওয়ার্ক নয়) → `App.tsx` রুট, `navAccess.ts`/`accessCatalog.ts`, `supabase.rpc('…')` কল, `supabase.from('…')`, Edge `functions.invoke`, `supabase/functions/*` → `registry.manifest.json` (CI-তে পুনরুৎপাদনযোগ্য, commit করা)।
  - দুটো মিলিয়ে `sc_registry_items` ও `sc_registry_edges` ভরা হয়; যা কোডে আছে কিন্তু DB-তে নেই (বা উল্টো) সেটা **drift** হিসেবে চিহ্নিত — এভাবেই অডিটে পাওয়া A1 সমস্যা (লাইভে আছে, রিপোতে নেই) ভবিষ্যতে স্বয়ংক্রিয় ধরা পড়বে।
- প্রতিটি আইটেমে: `status` (`active | partial | planned | deprecated`), `owner_module`, `platform`, `risk` (`low|medium|high` — টাকা/ব্যক্তিগত তথ্য ছুঁলে high), `ai_exposable` (bool, ডিফল্ট false), `description_bn/en`, `source_ref` (ফাইল:লাইন বা migration)।

## ২.৪ Dependency Mapping

`sc_registry_edges(from_id, to_id, kind)` — `kind`: `calls` (page→rpc), `reads/writes` (rpc→table, ফাংশন-বডি বিশ্লেষণ), `requires_perm`, `fk` (টেবিল→টেবিল, `pg_constraint`), `scheduled_by` (job→rpc), `uses_secret` (edge→secret-নাম, মান নয়), `requires_feature`, `owns_menu`।

- সীমা: ফাংশন-বডি বিশ্লেষণ regex-ভিত্তিক (dynamic SQL ধরবে না) — তাই প্রতিটি edge-এ `confidence: parsed|declared`; যেখানে ধরা যায় না সেখানে `declared` (হাতে ঘোষিত) edge অনুমোদিত, কিন্তু অনুমোদনসহ ও audit-সহ।
- প্রশ্ন যা Registry উত্তর দেবে: "এই টেবিল বদলালে কোন কোন পাতা/RPC/job ভাঙবে?", "এই পারমিশন কোথায় ব্যবহৃত?", "এই Edge Function বন্ধ করলে কী থামবে?"

## ২.৫ নতুন পারমিশন (বিদ্যমান `system` মডিউলে; ডুপ্লিকেট নয় — বিদ্যমান ১৭টির সাথে মিলিয়ে)

বিদ্যমান: `system.admin_portal.view`, `system.audit.view/export`, `system.settings.view/configure`, `system.role.*`, `system.user.*`।
নতুন (প্রস্তাব, প্রতিটি `view` + প্রয়োজনে `configure/approve/export`): `system.control_center.view`, `system.registry.*`, `system.error_log.*`, `system.health.view`, `system.feature.configure`, `system.release.*` (`approve` শুধু super), `system.backup.*`, `system.integration.*`, `system.automation.configure`, `system.demo_test.*`, `system.dev_task.*`, `system.sysdoc.*`। `system.audit.*` ও `system.settings.*` **পুনঃব্যবহার** (Audit Center/System Settings-এর জন্য)।

## ২.৬ Frontend কাঠামো

- রুট: `/app/control` (Command Dashboard) ও `/app/control/:section` — একটি lazy পাতা `ControlCenter` যা `section` অনুযায়ী উপ-প্যানেল রেন্ডার করে (বিদ্যমান `/app/office/:section`, `/app/sorting/:section` প্যাটার্ন)।
- মেনু: `AppShell`-এ একটি নতুন গ্রুপ "সিস্টেম কন্ট্রোল সেন্টার" (`System Control Center`), প্রতিটি আইটেমের `perms` দিয়ে। পদ-ভিত্তিক `menu_items` লাইভ সিস্টেমের সাথে মিল (A1 মিটলে) — মেনু একটি জায়গা থেকেই আসবে, দুই জায়গায় হাতে নয়।
- `navAccess.ts`-এর `pagePermissions`-এ নতুন এন্ট্রি + `tests/navAccess.test.mjs`-এ নতুন টেস্ট (বিদ্যমান নিয়ম: "মেনুতে দেখানো পাতা কখনো 'অনুমতি নেই' বলবে না")।
- অসম্পূর্ণ মডিউল: ২.৯।

## ২.৭ ভবিষ্যৎ AI Integration (Extensible)

- বিদ্যমান `nodi-ai` Edge Function ও `nodi.*` সেটিংস ভাঙা হবে না। একটি **AI Gateway ইন্টারফেস** (নথি + টেবিল `sc_integrations` রেকর্ড; কোড পরে) যেখানে প্রদানকারী (provider) বদলযোগ্য।
- নীতি (বিদ্যমান ARCHITECTURE.md-র সাথে এক): *Machines suggest, people decide* — AI শুধু পড়ে (ব্যবহারকারীর নিজের JWT দিয়ে, তাই RLS প্রযোজ্য) ও খসড়া করে; পোস্ট/অনুমোদন/মোছা নয়। প্রতিটি অনুরোধ লগড।
- Registry-র `ai_exposable` ও ভবিষ্যৎ "AI Tool Catalog" (কোন RPC AI পড়তে পারবে) এখনই কলাম হিসেবে রাখা — পরে ভাঙা-পরিবর্তন লাগবে না।

## ২.৮ DEMO/Staging ও Release Gate

বর্তমান বাস্তবতা (A2): **কোনো Staging নেই।** প্রস্তাব:

1. **Staging Supabase প্রজেক্ট** (`xzm-team-staging`, আলাদা, সম্পূর্ণ কৃত্রিম ডাটা)। Free plan-এ Supabase Branching নেই, তাই দ্বিতীয় Free প্রজেক্ট (বিনা খরচে সম্ভব; খরচ/সীমা আপনার সিদ্ধান্ত — `06`-এ প্রশ্ন #১)।
2. **CI পথ:** PR → বিদ্যমান `tests.yml` (থ্রোঅওয়ে Postgres-এ সব Migration + SQL টেস্ট) → Staging-এ Migration প্রয়োগ + role-demo হাঁটা (বিদ্যমান `scripts/role-demo`) → ফলাফল `sc_test_runs`-এ।
3. **Release রেকর্ড** `sc_releases`: `draft → staging_tested → awaiting_approval → approved → deployed → verified | rolled_back`। `approved`-এ যেতে DB-তে শর্ত: (ক) লিঙ্ক করা `sc_test_runs` সবুজ (Staging), (খ) `approved_by` = Super Admin, (গ) `approved_at` Asia/Dhaka-তে ও audit-এ।
4. **প্রকৃত প্রয়োগ (Enforcement):** DB রেকর্ড একা Deploy আটকাতে পারে না। তাই GitHub Actions-এ `production` **Environment** + "Required reviewers = মালিক" যোগ করতে হবে (বর্তমানে `main`-এ `web/**` বদলালেই স্বয়ংক্রিয় লাইভ)। এটি রিপো/GitHub সেটিং পরিবর্তন — **আলাদা অনুমোদন চাই**, আমি নিজে করব না।
5. লাইভ Migration প্রয়োগ আগের মতোই "ফাইল আগে, টেস্ট, তারপর লাইভ" (MIGRATIONS_LIVE_MAP নিয়ম) — Release Manager এই নিয়মকে বাধ্যতামূলক চেকলিস্টে রূপ দেবে।

## ২.৯ অসম্পূর্ণ মডিউল কখনো কার্যকর দেখানো নয়

- মেনু আইটেমের `status` Registry থেকে: `active` ছাড়া কোনো মডিউলে অ্যাকশন-বাটন সক্রিয় থাকবে না; মেনুতে ধূসর "অসম্পূর্ণ / শীঘ্রই" ব্যাজ + ক্লিকে ব্যাখ্যা-পাতা (কী বাকি, কোন Phase)।
- Command Dashboard-এ "চালু মডিউল X/২২" গণনা শুধু `active` ধরবে; `partial` আলাদা সংখ্যা।
- কোনো কার্ডে কাল্পনিক/নমুনা সংখ্যা নয় — ডাটা না থাকলে "তথ্য নেই"। (Phase অনুযায়ী প্রতিটি মডিউলের সত্যিকারের অবস্থা `03`-এ।)

## ২.১০ নিরাপত্তা নকশা-নীতি

- সব নতুন ফাংশন: `security definer set search_path = ''`, `revoke … from public, anon`, নির্দিষ্টভাবে `grant … to authenticated`। (A4 সমস্যা পুনরাবৃত্তি নয়; Permission Audit এটা যাচাই করবে।)
- Error log: PII/টোকেন ছাঁটাই (ইমেইল-ফোন-JWT regex), পেলোড সীমা (৮ KB), হারসীমা (ব্যবহারকারী/মিনিট), fingerprint দিয়ে dedupe। শুধু authenticated; লগইন-পূর্ব ত্রুটি Edge Function দিয়ে (পরের Phase)।
- Retention: error/health/test টেবিলে `pg_cron` দিয়ে পুরনো সারি আর্কাইভ (মোছা নয় যদি audit-সংশ্লিষ্ট; শুধু `sc_` অপারেশনাল লগ ৯০ দিনের পর সংকুচিত — সিদ্ধান্ত #৬)।
