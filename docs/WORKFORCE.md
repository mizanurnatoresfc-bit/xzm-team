# আমার লোক ও উপস্থিতি / My Workforce & Attendance

Migration `supabase/migrations/20261117010000_workforce_attendance.sql` · tests `supabase/tests/99zzzzzzzzzzzzz_workforce.sql` (260 checks) ·
typed calls `web/src/lib/workforce.ts` (the contract: every function below returns exactly the keys of those types).

শুধু যোগ হয়েছে — পুরোনো টেবিল, লগইন, রোল, পেজ আগের মতোই। একই তথ্য দু'বার তৈরি হয় না; তিনটি প্যানেলই একই টেবিল থেকে পড়ে।
Additive only. Nothing is stored twice; the staff, manager and zonal panels all read the same tables through role-scoped functions.

## কী কীভাবে চলে / How it works
| বিষয় | কীভাবে |
|---|---|
| হাজিরা বই | প্রতি মাসের ১–১৭ তারিখ খোলা (সেটিং `workforce.book_from_day` / `book_to_day`)। আজকের তারিখ = ঢাকার তারিখ। স্টাফ প্রতিটি তারিখ আলাদা দেন: `wf_att_submit`। ১৮ তারিখে বই বন্ধ, মাসটি আর্কাইভ (শুধু পড়া): `wf_my_book(মাস)` / `wf_hub_book(হাব, মাস)`। |
| উপস্থিত ছিলাম | `wf_att_submit(তারিখ,'present')` → অনুমোদনের অপেক্ষায়। |
| উপস্থিত ছিলাম না | "ওয়েবসাইটে আবেদন করেছেন?" — হ্যাঁ: `wf_att_submit(তারিখ,'absent',true)`; না: তারিখ বেছে `wf_absence_apply(তারিখ[], কারণ)` → আবেদন নম্বর `AB-00001…`, প্রতি তারিখে একটি অপেক্ষারত ইনপুট। উত্তর না দিলে/`false` দিলে `wf_att_submit` ত্রুটি দেয় (22023)। |
| অনুমোদন | আগের মতোই `att_self_decide` (অপরিবর্তিত) — রেজিস্টারে `attendance_records` লেখে। আবেদন একসাথে: `wf_absence_decide`; ফেরত দিতে কারণ লাগে; নিজের হাজিরা/আবেদন নিজে অনুমোদন করা যায় না। আবেদনের অবস্থা তারিখগুলোর সাথে নিজে থেকে মেলে। |
| ডুপ্লিকেট | `unique(employee_id, work_date)`; একই তারিখ দু'বার = একই ইনপুট; অনুমোদিত বা খাতায় উঠে গেলে স্টাফ আর বদলাতে পারেন না (23505); ম্যানেজার `wf_att_correct` (কারণ বাধ্যতামূলক) দিয়ে ঠিক করেন। |
| চারটি সংখ্যা | `wf_ops_submit` (পিকআপ, পিকআপ রিটার্ন, ডেলিভারি, ডেলিভারি রিটার্ন) → `wf_daily_ops`, প্রতি জন প্রতি দিন একটি; তারিখ, জন, হাব, জোন সহ। আজ বা `workforce.ops_backdate_days` (১) দিন আগে পর্যন্ত নিজে বদলানো যায়; পুরোনো দিন `wf_ops_correct`। প্রতিটি বদল = revision+১ + ইতিহাস (`wf_ops_history`)। |
| ম্যানেজার | `wf_hub_overview`, `wf_hub_book`, `wf_marks`, `wf_applications`, `wf_att_history`, `wf_ops_report` — শুধু নিজের হাব। |
| জোনাল | `wf_zone_overview` (+ উপরের তালিকাগুলো জোন দিয়ে) — সব হাব, শুধু পড়া। হাব নেই এমন স্টাফ শুধু কোম্পানি-ব্যাপী রোল দেখে ("হাব ছাড়া" সারি)। |
| সতর্কতা | `wf_pending_counts()` (মেনু/ঘণ্টা/ড্যাশবোর্ড)। `private.wf_remind()` প্রতিদিন ১০:০০ UTC = ১৬:০০ ঢাকা (pg_cron `wf-remind`): আজকের হাজিরা বাকি, ফেরত তারিখ (বই খোলা থাকলে), আজকের সংখ্যা বাকি (যিনি আগের ১৪ দিনে দিয়েছেন), ম্যানেজারদের জন্য একটি সারাংশ। প্রতি জন প্রতি দিনে একবার। |
| লাইভ | `attendance_self_marks`, `attendance_records`, `wf_absence_applications`, `wf_daily_ops` Realtime-এ যোগ (শুধু Supabase-এ; সাধারণ Postgres-এ বাদ)। প্রতিটি টেবিলের RLS প্রযোজ্য। |

## রোল ও অনুমতি / Permissions
নতুন: `ops.staff_daily.view` (admin, head_office_manager, operations_manager, zonal_manager, hub_manager, pickup_manager, delivery_manager, auditor, hr_manager),
`ops.staff_daily.edit` (admin, hub_manager). বাকি সব পুরোনো কোড: `hr.attendance.view` (বই, ইনপুট, আবেদন, ইতিহাস দেখা), `hr.attendance.create` (অনুমোদন),
`hr.attendance.edit` (`wf_att_correct`). `zonal_assistant`-কে নতুন অনুমতি দেওয়া হয়নি (পুরোনো টেস্ট ওই রোলকে ঠিক ৮টি অনুমতিতে বেঁধে রাখে) — দরকার হলে রোল-বিল্ডার থেকে দিন।
নতুন টেবিলে শুধু SELECT (নিজে বা অনুমতি অনুযায়ী); সব লেখা ফাংশন দিয়ে। কোনো মুছে ফেলা নেই; ইতিহাস টেবিল বদলানো যায় না।

## সীমা / Limits to know
- ইতিহাস (`wf_att_history`) বইয়ের ইনপুটের বদল রাখে; হাব রেজিস্টারে সরাসরি হাতে লেখা বদল `audit_logs`-এ থাকে।
- `wf_ops_report.rows` সর্বোচ্চ ৩০০০ লাইন (`truncated` বলে দেয়); মোট ও দিন/জন অনুযায়ী যোগফল সবসময় পুরো সময়ের।
- ক্রন/রিয়েলটাইম অংশ সাধারণ Postgres-এ নিজে থেকে বাদ পড়ে; মাইগ্রেশন আবার চালানো নিরাপদ (idempotent)।

## ফিরিয়ে নিতে / Rollback
কাজ সরাতে: `select cron.unschedule('wf-remind')`; `alter publication supabase_realtime drop table …` (চারটি টেবিল); `wf_*` ফাংশন (public ও private) মুছুন;
`attendance_self_marks`-এর `att_self_wf_before/after` ট্রিগার ও চারটি কলাম (`zone_id, applied_on_site, application_id, via`) সরান; টেবিল `wf_ops_history, wf_att_history, wf_daily_ops, wf_absence_applications`
ও সিকোয়েন্স `wf_absence_no_seq` মুছুন; `ops.staff_daily.*` অনুমতি এবং `workforce.*` সেটিং মুছুন। পুরোনো ডাটা অক্ষত থাকে।
