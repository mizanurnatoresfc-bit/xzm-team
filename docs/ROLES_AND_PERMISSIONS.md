# XZM-TEAM ERP — সব রোল ও অনুমতি (Roles & Permissions)

তারিখ: ১৭ নভেম্বর ২০২৬ · উৎস: রিপোর সব migration একটা খালি টেস্ট ডাটাবেসে চালিয়ে সরাসরি `roles`, `permissions`, `role_permissions`, `role_dashboards` টেবিল থেকে তোলা (হাতে লেখা নয়)। লাইভের সাথে মিলিয়ে দেখা হয়েছে।

## ১. অনুমতি কীভাবে কাজ করে

- **রোল → অনুমতি:** প্রতিটা রোলের একটা অনুমতির তালিকা (`role_permissions`)। অনুমতির নাম `module.resource.action`, যেমন `hr.employee.view`।
- **রোল কোথায় খাটবে (scope):** রোল দেওয়ার সময় তিন স্তরের একটা বাছতে হয় (`user_roles.scope_type`): `global` — পুরো কোম্পানি; `zone` — এক এরিয়া/জোন; `hub` — এক হাব। একই মানুষের একাধিক রোল, একাধিক জায়গায় থাকতে পারে; মেয়াদ (`valid_from`/`valid_to`) ও বাতিল (`revoked_at`) রাখা যায়।
- **যাচাই:** `private.has_permission(perm, zone, hub)` — প্রতিটা RLS policy আর প্রতিটা লেখার ফাংশন এটা ডাকে। ব্রাউজারের মেনু শুধু দেখানোর জন্য; আসল বাধা ডাটাবেসে।
- **সুপার অ্যাডমিন** (`is_super = true`): কোনো অনুমতির তালিকা লাগে না — সব পারে। প্রথম সুপার অ্যাডমিন বসে `private.bootstrap_super_admin(email)` দিয়ে (একবারই চলে)।
- **সিস্টেম রোল** (`is_system`): মোছা বা নাম বদলানো যায় না; সুপার অ্যাডমিন নিজের নতুন রোল বানাতে পারেন (রোল বিল্ডার, `/app/roles`)। কোনো রোল মোছা হয় না — `status = inactive` বা archive।
- **ব্যক্তিগত বাড়তি/কম অনুমতি** (advanced permissions): লাইভে migration `advanced_permissions` বসানো আছে, কিন্তু কোডটা এখনো ব্রাঞ্চ `claude/advanced-role-permission-mgmt-t5zk0a`-এ — `main`-এ merge হয়নি। তাই নিচের তালিকায় সেটা ধরা নেই।

## ২. রোলের তালিকা (১৫টা সিস্টেম রোল)

| # | কোড | নাম | বাংলা | কাজ | অনুমতি | হোম ভিউ | ড্যাশবোর্ড প্যানেল |
|---|---|---|---|---|---|---|---|
| 1 | `super_admin` | Super Admin | সুপার অ্যাডমিন | Full system control | সব (super) | zone | my_day, hub_today, network, approvals, my_requests, my_work, hr_overview, hub_staff, ops_today, cash_today, accounts_today, zonal_overview, quick_links |
| 2 | `admin` | Admin | অ্যাডমিন | System administration | 215 | zone | my_day, hub_today, network, approvals, my_requests, my_work, hr_overview, hr_pending, ops_today, accounts_today, quick_links |
| 3 | `head_office_manager` | Head Office Manager | হেড অফিস ম্যানেজার | Company-wide oversight | 113 | zone | my_day, network, approvals, my_requests, hr_overview, ops_today, cash_today, accounts_today, zonal_overview, quick_links |
| 4 | `operations_manager` | Operations Manager | অপারেশনস ম্যানেজার | Courier operations | 108 | hub | my_day, hub_today, approvals, my_requests, my_work, hub_staff, ops_today, cash_today, quick_links |
| 5 | `zonal_manager` | Zonal Manager | জোনাল ম্যানেজার | Manages one zone | 129 | zone | my_day, hub_today, network, approvals, my_requests, my_work, hr_pending, hub_staff, ops_today, accounts_today, zonal_overview, quick_links |
| 6 | `zonal_assistant` | Zonal Assistant | জোনাল অ্যাসিস্ট্যান্ট | Follows up attendance gaps across the area: sees, checks and reminds; approves nothing else | 8 | self | my_day, my_requests, my_work, quick_links |
| 7 | `hub_manager` | Hub Manager | হাব ম্যানেজার | Manages one hub | 99 | hub | my_day, hub_today, approvals, my_requests, my_work, hub_staff, ops_today, cash_today, accounts_today, quick_links |
| 8 | `pickup_manager` | Pickup Manager | পিকআপ ম্যানেজার | Pickup operations | 26 | hub | my_day, my_requests, my_work, ops_today, quick_links |
| 9 | `delivery_manager` | Delivery Manager | ডেলিভারি ম্যানেজার | Delivery operations | 30 | hub | my_day, my_requests, my_work, ops_today, cash_today, quick_links |
| 10 | `hr_manager` | HR Manager | এইচআর ম্যানেজার | Human resources | 70 | zone | my_day, approvals, my_requests, my_work, hr_overview, hr_pending, hub_staff, quick_links |
| 11 | `accounts_manager` | Accounts Manager | অ্যাকাউন্টস ম্যানেজার | Finance and accounts | 59 | hub | my_day, hub_today, approvals, my_requests, my_work, cash_today, accounts_today, quick_links |
| 12 | `accountant` | Accountant | হিসাবরক্ষক | Bookkeeping | 40 | hub | my_day, my_requests, my_work, accounts_today, quick_links |
| 13 | `auditor` | Auditor | অডিটর | Read-only review and audit | 62 | zone | my_day, my_requests, hr_overview, ops_today, accounts_today, quick_links |
| 14 | `rider` | Rider | রাইডার | Pickup / delivery rider | 9 | self | my_day, my_requests, my_work, quick_links |
| 15 | `staff` | Staff | সাধারণ স্টাফ | Own work only: own profile, own accounts, own vehicle, issues and orders given to them | 2 | self | my_day, my_requests, my_work, quick_links |

**লাইভে বাড়তি রোল:** `manager_hisab` (মালিকের বানানো, ৩৩টা অনুমতি, এখন **inactive**, কেউ ধরে নেই)। এটা migration-এ নেই, লাইভ ডাটা।

**লাইভে এখন কার কোন রোল (১৭ নভেম্বর):** লগইন আছে ৩ জনের — super_admin ১, hub_manager ১, staff ১। কর্মী (employees) ১৩৫ জন, হাব ১৪টা, জোন ১টা।

**হোম ভিউ:** `zone` = জোন/কোম্পানির চিত্র, `hub` = হাবের চিত্র, `self` = নিজের দিন (স্টাফ প্যানেল)। প্যানেল ও মেনু সুপার অ্যাডমিন `/app/role-dashboards` থেকে বদলাতে পারেন।

## ৩. মডিউল অনুযায়ী অনুমতির সংখ্যা

| মডিউল | কী | অনুমতি | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `da` | দৈনিক হিসাব খাতা | 9 | 9 | 4 | 4 | 6 | · | 5 | · | · | · | 8 | 6 | 4 | · | · |
| `hr` | HR (কর্মী) | 51 | 51 | 20 | 7 | 24 | 5 | 21 | 4 | 4 | 51 | 5 | 4 | 13 | · | · |
| `issue` | ইস্যু | 4 | 4 | 4 | 4 | 4 | · | 3 | 2 | 2 | · | · | · | 2 | · | · |
| `nodi` | নদী AI | 2 | 2 | 2 | 1 | 1 | · | 1 | 1 | 1 | 1 | 1 | · | · | · | · |
| `office` | অফিস | 12 | 12 | 12 | 11 | 11 | · | 9 | · | · | · | 4 | · | 3 | · | · |
| `ops` | কুরিয়ার অপারেশন | 47 | 47 | 16 | 33 | 30 | · | 34 | 9 | 13 | · | 20 | 14 | 14 | 7 | · |
| `org` | প্রতিষ্ঠান | 23 | 23 | 9 | 6 | 7 | 3 | 6 | 2 | 2 | 9 | 6 | 5 | 6 | 2 | 2 |
| `sorting` | শটিং সেন্টার | 16 | 16 | 16 | 14 | 14 | · | 3 | 3 | 3 | · | 2 | 2 | 2 | · | · |
| `system` | সিস্টেম | 15 | 15 | 5 | · | · | · | 1 | · | · | 1 | · | · | 6 | · | · |
| `vehicle` | গাড়ি | 16 | 16 | 16 | 16 | 15 | · | 12 | 5 | 5 | · | 6 | 6 | 3 | · | · |
| `zonal` | জোনাল | 20 | 20 | 9 | 12 | 17 | · | 4 | · | · | 8 | 7 | 3 | 9 | · | · |
| **মোট** | | **215** | **215** | **113** | **108** | **129** | **8** | **99** | **26** | **30** | **70** | **59** | **40** | **62** | **9** | **2** |

সংক্ষেপ: SA = `super_admin`, AD = `admin`, HO = `head_office_manager`, OP = `operations_manager`, ZM = `zonal_manager`, ZA = `zonal_assistant`, HM = `hub_manager`, PM = `pickup_manager`, DM = `delivery_manager`, HR = `hr_manager`, AM = `accounts_manager`, AC = `accountant`, AU = `auditor`, RD = `rider`, ST = `staff`। সুপার অ্যাডমিন (SA) সব পারে, তাই কলাম নেই।

## ৪. পুরো অনুমতি ম্যাট্রিক্স (✓ = রোলের আছে)

### দৈনিক হিসাব খাতা — `da` (9)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `da.correction.edit` | Reopen a submitted daily account sheet for correction | ✓ |  |  | ✓ |  |  |  |  |  | ✓ |  |  |  |  |
| `da.import.create` | Upload the courier panel's daily Update Report for a hub | ✓ |  |  | ✓ |  | ✓ |  |  |  | ✓ | ✓ |  |  |  |
| `da.report.export` | Export daily account reports (Excel / PDF) | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ | ✓ |  |  |
| `da.report.print` | Print daily account reports | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |
| `da.report.view` | View daily account reports and dashboards | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |
| `da.settings.configure` | Change daily account settings, templates and Accounts Manager assignment | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `da.sheet.approve` | Verify daily account sheets (approve, send back for correction, add note) | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `da.sheet.create` | Start, fill in and submit daily account sheets | ✓ |  |  |  |  | ✓ |  |  |  |  | ✓ |  |  |  |
| `da.sheet.view` | View daily account sheets of a hub | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |

### HR (কর্মী) — `hr` (51)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `hr.application.approve` | Approve applications and assign Employee ID | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.application.create` | Prepare and submit Employee ID applications | ✓ |  |  | ✓ |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.application.reject` | Return or reject applications | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.application.view` | View Employee ID applications | ✓ | ✓ |  | ✓ |  | ✓ |  |  | ✓ |  |  | ✓ |  |  |
| `hr.attendance.create` | Record attendance | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.attendance.edit` | Correct attendance | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.attendance.export` | Export attendance reports | ✓ | ✓ |  | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `hr.attendance.view` | View attendance | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |  |  |
| `hr.attendance_gap.approve` | Check the reasons staff gave for days without attendance, and remind them | ✓ |  |  | ✓ | ✓ |  |  |  | ✓ |  |  |  |  |  |
| `hr.attendance_gap.view` | See days without attendance and the reasons staff gave | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |  |  | ✓ |  |  |
| `hr.compensation.approve` | Approve salary / allowance changes | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.compensation.configure` | Configure allowance and deduction types | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.compensation.create` | Propose salary / allowance changes | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.compensation.reject` | Reject salary / allowance changes | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.compensation.view` | View salary structure of employees in scope | ✓ | ✓ |  | ✓ |  | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| `hr.document.approve` | Verify employee documents | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.document.archive` | Archive employee documents | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.document.create` | Upload employee documents | ✓ |  |  | ✓ |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.document.view` | View employee documents (non-identity) | ✓ | ✓ |  | ✓ |  | ✓ |  |  | ✓ |  |  | ✓ |  |  |
| `hr.duty.edit` | Set duties of posts and people | ✓ | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.duty.view` | See duties of posts and people | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `hr.employee.approve` | Terminate / reinstate employees | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.employee.archive` | Archive former employees | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.employee.create` | Start employee records / applications | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.employee.edit` | Edit employee details, transfer, resign | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.employee.export` | Export employee lists | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `hr.employee.view` | View employees in scope | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `hr.employee_profile.edit` | Fill in contact and identity details of staff (not status, post, hub, ID or pay) | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.employee_sensitive.edit` | Change NID and other sensitive identity data | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.employee_sensitive.view` | Reveal NID, date of birth, family and address (audited) | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.import.approve` | Verify and commit employee imports | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.import.create` | Upload and validate employee imports | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.leave.approve` | Approve leave | ✓ |  |  | ✓ |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.leave.configure` | Configure leave types | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.leave.create` | Request leave for staff | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.leave.reject` | Reject leave | ✓ |  |  | ✓ |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.leave.view` | View leave requests | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  | ✓ |  |  | ✓ |  |  |
| `hr.profile_field.configure` | Configure the dynamic employee profile | ✓ |  |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.reference.approve` | Approve, change or turn down requests to add / change / remove people in the reference list | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.referral.configure` | Add columns to the people-in-hand list (company or own zone) | ✓ |  |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.referral.edit` | Set who referred an employee; update prospects | ✓ |  |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.referral.view` | See referrals and people-in-hand lists of staff in your area | ✓ | ✓ |  | ✓ |  | ✓ |  |  | ✓ |  |  | ✓ |  |  |
| `hr.request.approve` | Process, complete or reject HR requests | ✓ | ✓ |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.request.configure` | Add / edit / remove request formats and their fields | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `hr.request.create` | Submit HR requests for staff in scope (ID create, transfer, active, inactive) | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `hr.request.view` | See HR / operation requests in scope | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ |  |  | ✓ |  |  |
| `hr.salary_sheet.approve` | Approve salary sheets | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |  |  |  |  |
| `hr.salary_sheet.create` | Prepare salary sheets | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |  |  |  |
| `hr.salary_sheet.export` | Export / print salary sheets | ✓ | ✓ |  |  |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| `hr.salary_sheet.view` | View salary sheets | ✓ | ✓ |  | ✓ |  | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| `hr.transfer.edit` | Move staff from one hub to another (same post) within scope | ✓ | ✓ |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  |

### ইস্যু — `issue` (4)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `issue.group.view` | Read a hub group without being posted at that hub | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |  |
| `issue.issue.approve` | Re-assign, approve or cancel any issue in scope | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `issue.issue.create` | Raise an issue and give it to a person in scope | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `issue.issue.view` | See every issue in scope (hub / area) | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  |

### নদী AI — `nodi` (2)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `nodi.assistant.view` | Talk to নদী AI | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |
| `nodi.settings.configure` | Model, daily limit, on/off and usage of নদী AI | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |

### অফিস — `office` (12)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `office.asset.edit` | Add / change / remove office resources and who holds them | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `office.asset.view` | See office resources (monitor, PC, fan …) | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ |  | ✓ |  |  |
| `office.bill.edit` | Write rent, electricity and wifi bills, memos and payment screenshots | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ |  |  |  |  |
| `office.bill.view` | See rent, electricity and wifi bills of an office, and the matching lines of the daily accounts | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ |  | ✓ |  |  |
| `office.notice.approve` | Receive and answer the offices' broken / needed reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `office.notice.create` | Tell the zonal manager what is broken or needed | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `office.property.archive` | Remove offices, rooms and desks | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `office.property.create` | Add offices / residences, rooms and desks | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `office.property.edit` | Change offices, rooms and desks, assign people to desks | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `office.property.view` | See offices, residences, rooms, desks and their resources | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ |  | ✓ |  |  |
| `office.secret.edit` | Write CCTV / router / PC user names and passwords of an office | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `office.secret.view` | See CCTV / router / PC user names and passwords of an office | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |

### কুরিয়ার অপারেশন — `ops` (47)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ops.assignment.create` | Assign Hub Manager, Zonal Manager and riders | ✓ |  | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.assignment.edit` | End assignments | ✓ |  | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.assignment.view` | View Hub Manager, Zonal Manager and rider assignments | ✓ | ✓ | ✓ | ✓ |  | ✓ |  | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `ops.cash.create` | Record hub cash collections and act for riders without a login | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.cash.view` | View cash collections, rider ledger and hub cash position | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |
| `ops.delivery.approve` | Approve delivery records | ✓ |  | ✓ | ✓ |  | ✓ |  | ✓ |  |  |  |  |  |  |
| `ops.delivery.create` | Record delivery outcomes | ✓ |  |  |  |  | ✓ |  | ✓ |  |  |  |  | ✓ |  |
| `ops.delivery.reject` | Reject delivery records | ✓ |  | ✓ | ✓ |  | ✓ |  | ✓ |  |  |  |  |  |  |
| `ops.delivery.view` | View delivery records | ✓ | ✓ | ✓ | ✓ |  | ✓ |  | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `ops.expense.approve` | Approve operational expenses | ✓ |  | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |  |
| `ops.expense.create` | Record operational expenses | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |  |
| `ops.expense.reject` | Reject operational expenses | ✓ |  | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |  |
| `ops.expense.view` | View operational expenses | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |
| `ops.handover.view` | View cash handovers | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |
| `ops.hub_handover.approve` | Confirm cash received from hubs (Main Accounts) | ✓ |  |  |  |  |  |  |  |  | ✓ | ✓ |  |  |  |
| `ops.hub_handover.create` | Hand hub cash over to Main Accounts | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.issue.create` | Report parcel issues | ✓ |  | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |
| `ops.issue.edit` | Assign, resolve and reopen parcel issues | ✓ |  | ✓ | ✓ |  | ✓ |  | ✓ |  |  |  |  |  |  |
| `ops.issue.view` | View parcel issues | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `ops.merchant.archive` | Archive merchants | ✓ |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `ops.merchant.create` | Create merchants | ✓ |  | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.merchant.edit` | Edit merchants | ✓ |  | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.merchant.view` | View merchants | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |  |
| `ops.merchant_payment.approve` | Approve merchant payments | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `ops.merchant_payment.create` | Request merchant payments | ✓ |  |  |  |  | ✓ |  |  |  |  | ✓ |  |  |  |
| `ops.merchant_payment.reject` | Reject merchant payments | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `ops.merchant_payment.view` | View merchant payments | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |
| `ops.parcel.create` | Book parcels into a hub | ✓ |  | ✓ |  |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `ops.parcel.edit` | Edit, dispatch to riders and cancel parcels | ✓ |  | ✓ |  |  | ✓ |  | ✓ |  |  |  |  |  |  |
| `ops.parcel.view` | View parcels and search by parcel ID | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `ops.pickup.approve` | Approve the consolidated pickup record | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `ops.pickup.reject` | Reject pickup submissions | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `ops.pickup.view` | View pickup submissions and approved pickups | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  | ✓ | ✓ | ✓ |  |  |
| `ops.pickup_as_hub_manager.create` | Submit pickups as Hub Manager | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.pickup_as_pickup_manager.create` | Submit pickups as Pickup Manager | ✓ |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| `ops.pickup_as_rider.create` | Submit own pickups as Rider | ✓ |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |
| `ops.pickup_verification.create` | Verify pickup submissions | ✓ |  | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.reconciliation.approve` | Approve or reject daily cash reconciliations | ✓ |  | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |  |
| `ops.reconciliation.create` | Submit the daily cash count | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.reconciliation.view` | View daily cash reconciliations | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  |
| `ops.report.export` | Export courier operation reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |  |
| `ops.report.print` | Print courier operation reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |  |
| `ops.report.view` | View courier operation reports | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `ops.rider_handover.approve` | Confirm cash received from riders | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.rider_handover.create` | Hand rider cash over to the hub | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |  |
| `ops.route.edit` | Make rider routes and give them to riders | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `ops.route.view` | See rider routes | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |

### প্রতিষ্ঠান — `org` (23)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `org.department.archive` | Archive departments | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.department.create` | Create departments | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `org.department.edit` | Edit departments | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `org.department.view` | View departments | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| `org.hub.archive` | Archive hubs | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.hub.create` | Create hubs | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.hub.edit` | Edit hubs | ✓ |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `org.hub.view` | View hubs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org.organization.create` | Create company profile | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.organization.edit` | Edit company profile | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.organization.view` | View company profile | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org.position.archive` | Archive positions | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.position.create` | Create positions | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `org.position.edit` | Edit positions | ✓ |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `org.position.view` | View positions | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| `org.region.archive` | Close (archive) a region | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.region.create` | Add regions | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.region.edit` | Change regions and which areas sit under them | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.region.view` | See regions | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ |  | ✓ |  |  |
| `org.zone.archive` | Archive zones | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.zone.create` | Create zones | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.zone.edit` | Edit zones | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `org.zone.view` | View zones | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  |  |

### শটিং সেন্টার — `sorting` (16)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `sorting.center.archive` | Remove sorting centers and routes | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `sorting.center.create` | Add sorting centers | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `sorting.center.edit` | Change sorting centers and their routes | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.center.view` | See sorting centers, their dashboard and routes | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `sorting.driver.create` | Write driver trip reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.driver.view` | See driver trip reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.fuel.approve` | Approve or reject fuel and expense requests | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.fuel.create` | Write fuel slips and expense requests | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.fuel.view` | See fuel slips and expense requests | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ | ✓ |  |  |
| `sorting.hub_charge.create` | Send an approved sorting vehicle cost to a hub's accounts sheet | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.parcel.create` | Write and receive parcel handovers, wrong / returned / damaged | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `sorting.parcel.view` | See parcel handovers hub <-> sorting | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `sorting.report.export` | Export sorting reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.report.view` | Sorting reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ | ✓ |  |  |
| `sorting.staff.edit` | Add / change / remove sorting center staff and duties | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sorting.staff.view` | See sorting center staff and their duties | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |

### সিস্টেম — `system` (15)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `system.admin_portal.view` | Sign in through the /secure-control admin portal | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.audit.export` | Export audit log | ✓ |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |
| `system.audit.view` | View audit log | ✓ | ✓ |  |  |  |  |  |  |  |  |  | ✓ |  |  |
| `system.role.create` | Create custom roles | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.role.edit` | Edit roles | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.role.view` | View roles | ✓ | ✓ |  |  |  |  |  |  |  |  |  | ✓ |  |  |
| `system.settings.configure` | Change system settings and branding | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.settings.view` | View system settings | ✓ | ✓ |  |  |  |  |  |  |  |  |  | ✓ |  |  |
| `system.user.create` | Invite / create user accounts | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.user.edit` | Activate, deactivate, unlock users | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.user.view` | View user accounts and login history | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `system.user_hub.create` | Make and reset the logins of riders and plain staff of one's own hub | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `system.user_role.create` | Assign roles to users | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.user_role.edit` | Revoke / end-date role assignments | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `system.user_role.view` | View role assignments | ✓ | ✓ |  |  |  |  |  |  |  |  |  | ✓ |  |  |

### গাড়ি — `vehicle` (16)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `vehicle.document.edit` | Keep vehicle papers (registration, fitness, tax token, insurance …) | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `vehicle.holder.edit` | Hand a vehicle to a staff member / take it back (hub follows the person) | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `vehicle.khoraki.post` | Post the drivers' and helpers' daily allowance (খোরাকি) to the daily sheet | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `vehicle.log.approve` | Approve / reject fuel and costs the crew submitted, put them on the daily sheet | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  | ✓ | ✓ |  |  |  |
| `vehicle.log.create` | Write fuel, service, repair and other vehicle costs | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  |  |
| `vehicle.log.edit` | Correct or remove a vehicle log line | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ |  |  |  |
| `vehicle.log.view` | See fuel, service and repair logs | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `vehicle.report.view` | See the hub reports the drivers and helpers give (loading, unloading, no trip) | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `vehicle.requisition.approve` | Accept, assign, reject or close vehicle requisitions | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `vehicle.requisition.create` | Ask for a vehicle (requisition) | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `vehicle.requisition.view` | See vehicle requisitions | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `vehicle.settings.configure` | Vehicle settings: alert days, service interval, cost kinds | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `vehicle.vehicle.archive` | Remove vehicles from the list | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `vehicle.vehicle.create` | Add vehicles | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `vehicle.vehicle.edit` | Change vehicle details | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |  |
| `vehicle.vehicle.view` | See vehicles, who holds them, documents and running costs | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |

### জোনাল — `zonal` (20)

| অনুমতি | কী | AD | HO | OP | ZM | ZA | HM | PM | DM | HR | AM | AC | AU | RD | ST |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `zonal.claim.approve` | Approve travel claims and record the voucher | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `zonal.claim.create` | Submit travel claims | ✓ |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `zonal.claim.reject` | Return or reject travel claims | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `zonal.claim.view` | View travel claims | ✓ | ✓ |  | ✓ |  |  |  |  |  | ✓ | ✓ | ✓ |  |  |
| `zonal.dashboard.view` | Open the Zonal Manager dashboard | ✓ | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `zonal.hub_metric.approve` | Verify or reopen daily hub figures | ✓ |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `zonal.hub_metric.create` | Enter daily hub figures | ✓ |  | ✓ |  |  | ✓ |  |  |  |  |  |  |  |  |
| `zonal.hub_metric.view` | View daily hub figures | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  | ✓ |  |  |
| `zonal.planning.create` | Save workforce planning recommendations | ✓ |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `zonal.planning.edit` | Acknowledge or dismiss recommendations | ✓ |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `zonal.planning.view` | View workforce planning recommendations | ✓ | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `zonal.pulse.manage` | Ask the zone's staff a popup question and see the answers | ✓ |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `zonal.report.export` | Export zonal reports (PDF / Excel) | ✓ | ✓ | ✓ | ✓ |  |  |  |  | ✓ | ✓ |  | ✓ |  |  |
| `zonal.report.print` | Print zonal reports | ✓ | ✓ | ✓ | ✓ |  |  |  |  | ✓ | ✓ |  | ✓ |  |  |
| `zonal.report.view` | View zonal reports | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| `zonal.task.create` | Assign tasks | ✓ |  | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `zonal.task.edit` | Reassign, confirm or cancel tasks | ✓ |  | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `zonal.task.view` | View tasks in scope | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ |  |  | ✓ |  |  |
| `zonal.visit.create` | Record own hub visits and travel expenses | ✓ |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `zonal.visit.view` | View hub visit reports of others | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ | ✓ |  |  |

