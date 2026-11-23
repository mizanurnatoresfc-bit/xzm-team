# ডুপ্লিকেট কাজ ও ডেটাবেস কানেকশন অডিট — ২৩ নভেম্বর ২০২৬

শুধু পড়ে দেখা হয়েছে — কোড, ডেটাবেস বা লাইভ সাইটে কিছু বদলানো হয়নি।

## কীভাবে দেখা হয়েছে
- ৬৪টা রুট-পেজ, মেনু (সাইডবার, বটম ট্যাব, কুইক টাইল), সব `lib/` API ফাইল।
- ১১২টা migration একটা অস্থায়ী লোকাল Postgres-এ চালিয়ে আসল ফাংশন/টেবিলের তালিকা (৪১০ public ফাংশন, ১৫৯ টেবিল); লাইভে ৪১১ ফাংশন, ১৫৯ টেবিল — প্রায় মিল।
- লাইভ ডেটাবেসে শুধু **টেবিলের সারির সংখ্যা** গোনা হয়েছে (কোনো ব্যক্তিগত তথ্য পড়া হয়নি)।
- চারটা ভাগে (হিসাব / এইচআর-ইউজার / হাব-অপারেশন / মেনু-ড্যাশবোর্ড-অফিস) কোড পড়ে ডুপ্লিকেট খোঁজা হয়েছে। এজেন্টদের লেখা "unverified" জায়গা নিচে আলাদা।

## সংখ্যায়
| বিষয় | সংখ্যা |
|---|---|
| ডুপ্লিকেট গুচ্ছ (একই কাজ একাধিক জায়গায়) | ৩৮টা (হিসাব ৯, এইচআর ৯, হাব ১১, মেনু/ড্যাশবোর্ড/অফিস ৯) |
| ফ্রন্টএন্ডের ভাঙা DB কল (ডেটাবেসে নেই এমন ফাংশন ডাকা) | **০** |
| কোনো মেনু/লিংক নেই অথচ রুট আছে | ২ (`/app/hr`, `/secure-control`) + ২টা লুকানো সেকশন (`/app/hub/accounts`, `/app/hub/days`) |
| পেজ যেখানে DB নেই | Training, Home, Terms (স্ট্যাটিক); NodiChat/ChangePassword শুধু Edge Function |
| ফ্রন্টএন্ডে কেউ ডাকে না এমন TS wrapper | ১১টা |
| কোনো পেজ/Edge/cron/trigger থেকে ডাকা হয় না এমন DB ফাংশন | ১১টা |
| লাইভে খালি (০ সারি) টেবিল | **৮৭টা / ১৫৯টা** |
| লেখার কোনো ফাংশন নেই (কেউ ভরে না) এমন টেবিল | ১৯টা |

## A. সবচেয়ে বড় ডুপ্লিকেট (কত জায়গায়, কোন DB)

| # | কাজ | কোথায় কোথায় | DB | সুপারিশ |
|---|---|---|---|---|
| 1 | হিসাব কেন্দ্র — ১০টা মেনু সারি শুধু `?tab=` লিংক | `AppShell.tsx:202-216` → সবই `/app/accounts/center` | একই পেজ | ১টা সারি রাখুন |
| 2 | হাবের দৈনিক হাজিরা তোলা | `hr/attendance` (day ট্যাব), `hub/attendance`, `hub/late`, workforce/hub Final Sheet, WorkforceHub Approve | A,B,C সরাসরি `attendance_records` লেখে (RPC ছাড়া); D `att_sheet_*`; E `wf_marks*` | Final Sheet (D) রাখুন; A-day, B, C সরান। B-তে একমাত্র "এক ট্যাপে" পথ আছে — আচরণ বদলাবে |
| 3 | স্টাফের নিজের হাজিরা | StaffPanel (`att_self_mark`) বনাম AttendanceBook (`wf_att_submit`) | দুটোই `attendance_self_marks`, আলাদা RPC | StaffPanel-এরটা `wf_att_submit`-এ আনুন |
| 4 | কর্মী তালিকা | `hr/employees`, `zonal/staff`, `hub/team`, `manager/staff` (+sorting staff আংশিক) | সবাই `employees` + `hr_change_status/transfer/archive` | `Employees` রাখুন, বাকিগুলো তার হাব-স্কোপ ভিউ |
| 5 | চাকরি ছাড়া / বদলি | কর্মী বাল্ক, প্রোফাইল, HubTeam সরাসরি RPC; ManagerStaff `hr_staff_*` (request); Requests/ZonalFiles ক্লায়েন্ট-সাইডে | **আলাদা RPC সেট**; Requests ও ZonalFiles পথ `hr_record_files` লেখে না → HR রেকর্ডে ফাঁক | `ZonalRequests` (`hr_request_decide`) একমাত্র পথ হোক |
| 6 | নতুন আইডি অনুমোদন | Applications, ZonalStaff বাল্ক, ZonalRequests, কর্মীর "আইডির অপেক্ষায়" ট্যাব | `hr_approve_application` বনাম `hr_request_decide` (পুরো লজিক আবার লেখা) | `/app/hr/applications` (৩৬ লাইন) সরান |
| 7 | ব্যয়/ভাউচার ঢোকানো — ৮ পথ | DailySheet, AccountsCenter NewVoucher, MyAccounts, ClaimsPanel + MyApprovals (২ কপি), sorting fuel, fleet fuel, office bills | `da_save_expense/da_make_voucher` (শেয়ার্ড) vs `da_claim_*` vs `sorting_fuel_*` vs `vehicle_log_*` | sorting fuel ও fleet fuel একটা পাইপলাইনে; ক্লেইম ইনবক্স ২ কপি → ১ |
| 8 | দিন বন্ধ করা | পুরনো `CloseDay` (`da_close_day`) বনাম `FlowPanel` (`da_check`) | দুটোই `da_sessions.closed_at` | পুরনোটা সরান — আগে পুরনো শিট ডেটা দেখুন |
| 9 | "দৈনিক রিপোর্ট" দুই জায়গায় | `ReportImport` (`da_import_*`) বনাম শিটের বক্স (`da_report_ids`) | **দুটো বিচ্ছিন্ন টেবিল**; ইম্পোর্টের ডেটা শিটে যায় না | একটা বেছে নিন (ঝুঁকি উঁচু) |
| 10 | হিসাবের তালিকা দুই পথে | `AccountsCenter` সরাসরি টেবিল বনাম `AccountsReports` (`da_report`) | সমান্তরাল | `da_report` রাখুন |
| 11 | রুট | `hub/routes` (পুরনো পাতলা কপি), `zonal/routes`, `routes/plan` বনাম RouteSettings-এর `plan` ট্যাব | একই `hub_routes/rider_routes`; `PlanTab` দুই জায়গায় | `hub/routes` সরান; `PlanTab` ১ জায়গায় |
| 12 | হাব/এরিয়া/জোন সেটআপ | `org/Hubs` বনাম `OrgSetup`-এর regions/zones/hubs ট্যাব | একই `org.*` কল | OrgSetup-এ শুধু departments/positions/org রাখুন |
| 13 | গাড়ি | `/app/fleet` (`fleet_*`) বনাম AccountsSettings VehiclesCard (`vehicle_save/list/assign`) বনাম MyAccounts (`da_my_vehicles`) | একই `vehicles`, আলাদা RPC | Fleet রাখুন, বাকিটা সরান |
| 14 | দৈনিক হাব সংখ্যা (পিকআপ/ডেলিভারি) | hub/ops, HubOpsPanel, hub/pickup, routes/plan, DailyOpsCard | ৫টা আলাদা টেবিল (`hub_daily_metrics`, `hub_ops_*`, `pickup_submissions`, `route_day_*`, `wf_daily_ops`) | **এখনই মুছবেন না** — রিপোর্ট সবাইকে পড়ে; আগে সত্যের উৎস ঠিক করুন |
| 15 | ছুটি/অনুপস্থিতি | `hr/leave`, `AbsenceApply`+বই, NodiGaps+ZonalAssistant | ৩ পাইপলাইন (`leave_requests`, `wf_absence_*`, `my_att_gap_answer`) | ব্যবসায়িক সিদ্ধান্ত লাগবে |
| 16 | রোল | `users/Roles` (Android) বনাম `access/RoleBuilder`; `RoleDashboards` ও RoleBuilder দুটোই `role_menu_save` | একই `role_admin_*` | ওয়েবে `/app/roles` আগেই রিডাইরেক্ট; Settings-এর সারি সরান |
| 17 | ইউজার/লগইন | Users, AccessCenter UsersTab (একই `user_admin_list`), লগইন তৈরি ৩ UI (Users, BulkLogins, HubLogins), রোল বসানো ৩ জায়গায় | একই RPC/Edge | একটা তালিকা |
| 18 | অফিস বনাম আবাসিক | `Office` কম্পোনেন্ট দুইবার মাউন্ট (`scope` ছাড়া একই) | একই `office_*` টেবিল | সাইডবারে ৮ জোড়া সারি; rent+bills একই `BillBlock` |
| 19 | ড্যাশবোর্ড | Dashboard, StaffPanel (স্টাফের জন্য `/app` = `/app/staff`), ZonalDashboard, HrDashboard | একই ৪ ব্লক ২ জায়গায়; স্টাফ গণনা ৫ উৎসে; অপেক্ষমাণ গণনা ৬ ভাবে | কুয়েরি একজায়গায় |
| 20 | নোটিশ | `notifications`, `notices`+reminders, `office_notices`, `pulse_*` | ৫ আলাদা স্টোর | মালিকের সিদ্ধান্ত |
| 21 | হিসাবের শেখা | ৪টা সাইডবার সারি (Training + ৩টা `learn?p=`) | `lib/guides.ts` বনাম `accountsGuide.ts` — ২ কনটেন্ট সেট | ৩টা `?p=` সারি সরান |
| 22 | APK ডাউনলোড | `AppDownloadCard` ৬ পেজে + Settings + `UpdateBar` | — | ওয়েবে ড্যাশবোর্ড কার্ড অপ্রয়োজনীয় |

বাকি ছোট গুচ্ছ (প্রোফাইল দুই লেখার পথ, "আমার আনা মানুষ" ৩ UI, কোম্পানি-ফরম্যাট এক্সপোর্টের দুই ফরম্যাট-টেবিল `employee_formats` ও `company_sheets`, সর্টিং ড্যাশবোর্ড/রিপোর্ট একই `sorting_route_report`, Nodi চ্যাট ২ জায়গা, বটম ট্যাব/কুইক বোতাম) এজেন্ট রিপোর্টে আছে।

### নেভিগেশন — একই গন্তব্যে কয়টা প্রবেশপথ
`/app/hub/attendance` ১২, `/app/accounts/mine` ১৩, `/app/me` ~১৫, `/app/hr/requests` ~১৬, `/app/accounts/daily` ১৩। বটম ট্যাব শুধু ≤৯৬০px-এ, কুইক "+" শুধু ডেস্কটপে — ওয়েবসাইটে দুটোই অতিরিক্ত।

## B. ডেটাবেস দিক

**ভাঙা কানেকশন: নেই।** ফ্রন্টএন্ড যত RPC/টেবিল ডাকে সবই ডেটাবেসে আছে।

**মৃত DB ফাংশন (কেউ ডাকে না; cron/trigger/Edge/policy বাদ দিয়ে):** `hr_generate/submit/approve/cancel_salary_sheet`, `hr_approve/reject_compensation` (বেতন-শিট, "রাখা হয়েছে" বলা আছে, সারি ০), `vehicle_document_save/archive`, `vehicle_alerts`, `vehicle_overview`, `task_add_reminder`, `task_return`, `hr_set_referrer`, `hr_referrer_of`, `wf_ops_submit`, `att_self_list`।
*ভুল ধরা এড়াতে:* `da_remind_open`, `issue_nudge_due`, `task_due_reminders`, `reminders_fire`, `wf_remind`, `custom_access_token_hook` cron/Auth-hook থেকে চলে — এগুলো মুছবেন না।

**শুধু TS wrapper মৃত, DB ফাংশন জীবিত:** `da.collectors`, `da.applyFixed`, `da.bankCharge`, `da.releaseVehicle` (ফাংশনগুলো অন্য ফাংশন ডাকে), `selfAtt.decide`, এবং `hrReq.one/findPeople/notices/markRead`, `users.mustChangePassword`।

**কেউ লেখে না এমন টেবিল (পুরনো পার্সেল/ক্যাশ ইঞ্জিনের অবশেষ), লাইভে সারি ০:** `parcels`, `parcel_issues`, `delivery_records`, `cash_handovers`, `cash_reconciliations`, `merchant_payments`, `operational_expenses`, `ops_assignments`, `da_cash_payments`, `da_approval_rules`, `salary_sheets`, `salary_sheet_lines`, `vehicle_requisitions`, `vehicle_documents`, `vehicle_hubs`। এগুলোর রিডার ফাংশন এখনও আছে (যেমন `da_sheet`-এর `expense_requests`/`pending_riders` কী কেউ পড়ে না)।

**লাইভের ৮৭টা খালি টেবিল:** রোলআউট শুরুর পর্যায় বলে অনেকটাই স্বাভাবিক (যেমন route_day_*, hub_ops_*, att_day_*, hr_requests, tasks, issues সব ০)। অর্থাৎ **এখন বাস্তবে কেউ ব্যবহার করছে না এমন ফিচার** যেগুলোর ডুপ্লিকেট সরালে ক্ষতি নেই; আর যেগুলোতে ডেটা আছে (`attendance_records` ৪৫, `da_sessions` ৯, `wf_att_history` ৩০, `attendance_self_marks` ৩১, `employee_compensation` ১৩২) সেগুলো সরানোর আগে সাবধান।

## C. সুপারিশের ক্রম (নিরাপদ → ঝুঁকিপূর্ণ)
> **ধাপ ১ করা হয়েছে (এই PR):** হিসাব কেন্দ্রের ১০ সারি, `learn?p=` ২ সারি, `/app/hr` (HrDashboard), `/secure-control`, `hub/accounts`, `hub/days` (AttendanceDays), মৃত TS wrapper ও ৩টা মৃত export — পুরনো ঠিকানাগুলো এখন রিডাইরেক্ট করে। **বাদ রাখা হয়েছে (যাচাইয়ে ঝুঁকিহীন মনে হয়নি):** `/app/hr/applications` (সাইডবার কাউন্ট, বেল, ড্যাশবোর্ড ও রোল-পেজ তালিকা এর ওপর নির্ভর করে), Settings-এর `/app/roles` সারি (ওয়েবে আগেই `/app/access`-এ যায়, অ্যাপে লাগে), `AppDownloadCard` (স্টাফ ওয়েব থেকেই APK নামায়)। DB ফাংশন (`att_days_*`, `hr_dashboard`, ...) ছোঁয়া হয়নি — ধাপ ৫-এ।

1. **ঝুঁকিহীন:** হিসাব কেন্দ্রের ১০টা `?tab=` সারি, `learn?p=` ৩ সারি, `/app/hr`, `/secure-control`, `hub/accounts`, `hub/days` (+`att_days_*`), `/app/hr/applications`, Settings-এর রোল সারি, ওয়েব থেকে `AppDownloadCard`, মৃত TS wrapper।
2. **কম ঝুঁকি:** `hub/routes`, OrgSetup-এর hubs/zones/regions ট্যাব, AccountsSettings VehiclesCard, ক্লেইম ইনবক্স ২ → ১, ড্যাশবোর্ডে `quick_links`/`approvals` ডেড অপশন।
3. **আচরণ বদলায় (আগে সিদ্ধান্ত):** হাজিরার ৩ পেজ → Final Sheet, কর্মী তালিকা ৪ → ১, exit/transfer এক পথে, দিন বন্ধের পুরনো পথ, sorting/fleet fuel এক।
4. **ডেটা মাইগ্রেশন লাগবে:** দৈনিক রিপোর্ট দুই টেবিল, হাব সংখ্যা ৫ টেবিল, ছুটি ৩ পাইপলাইন, নোটিশ ৫ স্টোর, `employee_formats` বনাম `company_sheets`।
5. **DB ক্লিনআপ (ওয়েব সাফ হওয়ার পর):** মৃত ফাংশন + সারি-০ ও লেখকহীন টেবিল — আগের মতো `private.dropped_objects_backup`-এ ব্যাকআপ রেখে।

## সতর্কতা
- Android অ্যাপ `https://xzmteam.com` লোড করে (Capacitor শেল) — ওয়েব থেকে পেজ সরালে অ্যাপ থেকেও যাবে। `/app/roles` পুরনো পেজ অ্যাপে এখনও লাগে।
- অনেক ডুপ্লিকেটের পার্থক্য পারমিশন-গেট (কে দেখে), তাই সরানোর আগে রোল-ভিত্তিক মেনু (`role_menu_save`, `ALWAYS`/`WITH` তালিকা `lib/menu.ts`) দেখা দরকার।
- যা এজেন্টরা যাচাই করেনি: Android-এ নির্ভরতা, `HubManagement`/`Sorting`/`Fleet`-এর ভেতরের কিছু সেকশন, Training বনাম LearnCenter বিষয়বস্তুর মিল, "website application number" ছুটির সাথে সম্পর্ক।
- আমার নিজের স্ট্যাটিক বিশ্লেষণ (নাম মিলিয়ে) আনুমানিক; কিছু মৃত তালিকা ডায়নামিক কল ধরতে নাও পারে। মুছার আগে প্রতিটা আলাদা যাচাই করুন।
