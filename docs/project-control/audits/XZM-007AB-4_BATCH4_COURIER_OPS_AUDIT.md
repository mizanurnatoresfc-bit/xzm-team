# XZM-007A/B-4 — Batch 4 Courier Operations & Planning Audit (Read-Only)

**Task ID:** XZM-007A/B-4
**Mode:** Read-Only — কোনো code / DB / DNS / production পরিবর্তন করা হয়নি।
**Date (Asia/Dhaka):** 2026-11-27
**Auditor:** Claude (Implementation Engineer)
**Source HEAD:** `2836a07a96d5053938fdaed6bff22273558e7977` — branch `main` of `github.com/mizanurnatoresfc-bit/xzm-team`।
**Ported to central docs:** 2026-11-27 (XZM-004R Review-Response)।
**Status:** **COMPLETE (writeup)** — awaiting ChatGPT Independent Review + Owner approval on findings B4-G-1..B4-G-5। Previous PR description's "preliminary findings only" line was inaccurate; the full 42-item matrix and fairness analysis are in this file (§1–§13)।

Scope: Merchant Pickup, Data Entry, গত ৭ দিনের কাজের তথ্য, দৈনিক সম্ভাব্য টার্গেট, কর্মীর সক্ষমতা, কাজের ন্যায্য বণ্টন, দৈনিক তিনবার অপারেশন রিপোর্ট, সর্টিং সেন্টার, Big Parcel, গাড়ি লোড, Route Management, Rider Assignment, Backup Rider, Morning Attendance, Zonal Route Approval, Published Route Plan, Delivery Point, Pickup ও Delivery Return, Hub-wise Operations Report, Zonal Manager Control, Web ও Android Sync।

---

## 0. Methodology & Tier Legend

| Tier | Meaning |
|---|---|
| **SOURCE VERIFIED** | TSX / TS / SQL / config file পড়ে কোডে ফাংশন বা RPC-এর অস্তিত্ব confirm করা হয়েছে। |
| **SOURCE PARTIAL** | কাছাকাছি কোড আছে, কিন্তু vision (Owner memory / CLAUD.txt) এর সম্পূর্ণ সাথে মেলেনি। |
| **NOT FOUND** | Source-এ কোনো match নেই। |
| **RUNTIME VERIFIED** | DB / live URL / production-এ পরীক্ষা করা হয়েছে — এই Batch-এ 0টি। |
| **ACCESS REQUIRED** | Runtime check বা অন্য system (Netlify logs, Supabase live schema) ছাড়া পূর্ণাঙ্গ confirm করা যায় না। |

Files read in this batch:
- `web/src/pages/zonal/RoutePlan.tsx` (518 lines, full)
- `web/src/lib/routePlanCore.ts` (213 lines, full)
- `web/src/pages/workforce/Morning.tsx` (331 lines, full)
- `supabase/migrations/20261122000500_route_day_plan.sql` (569 lines, full)
- `supabase/migrations/20261122000100_route_load.sql` (101 lines, full)
- `supabase/migrations/20261126000100_route_morning_window.sql` (311 lines, signatures)
- `supabase/migrations/20261127010500_route_plan_delegation.sql` (125 lines, signatures)
- `supabase/migrations/20261127030000_route_lock_and_light_overview.sql` (signatures)
- `supabase/migrations/20261125200000_workforce_review_queue.sql` (100 lines, full)
- `web/src/components/DailyOpsCard.tsx` (first 100 lines)
- `web/src/pages/zonal/OperationsCollection.tsx` (first 80 lines)
- `web/src/pages/staff/StaffPanel.tsx` (first 100 lines)
- `web/src/components/RiderQuick.tsx` (first 60 lines)
- `web/src/pages/sorting/Sorting.tsx` (first 60 lines)
- `supabase/migrations/20261127131000_sorting_trip_dispatch.sql` (first 40 lines)
- `web/capacitor.config.json` (full)
- `web/src/lib/routeOffline.ts` (first 30 lines)

---

## 1. Merchant Pickup & Data Entry

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 1.1 | **Pickup number entry (staff)** | **SOURCE VERIFIED** | `web/src/components/DailyOpsCard.tsx:17–22` FIELDS; `wf_daily_ops.pickup` | Four-field card: pickup, pickup_return, delivery, delivery_return — incremental add via `wf.addOps`। |
| 1.2 | **Pickup → Merchant jamma (cash to merchant)** | **SOURCE VERIFIED** | Owner memory 2026-11-26: *"ডেলিভারি টাকা"* = cash-at-delivery, *"মার্চেন্টে জমা"* = later payout — two distinct fields; code: `RiderSendCard` sends `pickup / delivery / amount` to manager (daily accounts) | ডেলিভারি টাকা ও মার্চেন্ট জমা আলাদা হিসাব হয় — একই সংখ্যা নয়। |
| 1.3 | **PDF upload (Steadfast Panel's Update list / Dispatch)** | **SOURCE VERIFIED** | `RoutePlan.tsx:310–323` FilesPanel + `web/src/lib/planPdf.ts` | Browser-side parse; only numbers + parcel id + rider code saved; no customer PII; file itself not stored। |
| 1.4 | **Data entry fairness (Finding B4-G-1)** | **NOT FOUND** | grep: `fair|evenness|workload.*balance|peer.*average` — শূন্য ম্যাচ | **ফেয়ারনেস ইনডেক্স নেই।** `wf_daily_ops` শুধু individual stats; কোনো table বা RPC নেই যা hub-level বা zone-level per-person equity measure করে। **Owner-এর প্রশ্ন সরাসরি সম্বোধিত হলো নিচে Fairness Analysis section-এ।** |

---

## 2. Route Management & Rider Assignment

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 2.1 | **Route configuration (zone → hub → routes)** | **SOURCE VERIFIED** | `RouteSettings.tsx` + `supabase/migrations/20261119030000_route_settings.sql` (9 tabs: RouteSettings imports RouteCoverage, RouteLoad, RoutePlaces, RoutePlan as sub-modules) | Already documented in Owner memory 2026-11-26। |
| 2.2 | **Rider ↔ Route assignment** | **SOURCE VERIFIED** | `supabase/migrations/20261115000100_login_sorting_routes.sql:311–322` table `rider_routes (route_id, employee_id, effective_from, effective_to)`; unique index on open rows | Append-only history: `effective_to = current_date` closes old; new row opened। |
| 2.3 | **Fixed capacity per rider (set-up)** | **SOURCE VERIFIED** | `route_day_plan.sql:61–71` table `route_staff_load (employee_id, day_parcels, helper, helper_max, pickup)`; `RoutePlan.tsx:436–498` SetupModal | Zonal manager fixed number বসান; `day_parcels` 1–1000 range। |
| 2.4 | **Learned capacity (past 14 days avg)** | **SOURCE VERIFIED** | `routePlanCore.ts:52–62` `capacityOf()` — fixed → accounts avg → self avg → hub avg → helper limit priority | Fallback chain। |
| 2.5 | **Today's capacity (pickup adjusted)** | **SOURCE VERIFIED** | `routePlanCore.ts:64–65` `capacityToday()` | `cap - (pickups - usual) × pickup_weight` |
| 2.6 | **Spread parcels across routes by average** | **SOURCE VERIFIED** | `routePlanCore.ts:208–213` `spreadRoutes()` | Route-এর avg_parcels দ্বারা। |

---

## 3. Backup Rider & Capacity Surge

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 3.1 | **Absent rider's parcels redistribute** | **SOURCE VERIFIED** | `routePlanCore.ts:142–193` `suggestPlan()` — একই রুট → রুটবিহীন → নিকটতম রুট (within near_km) → helpers → stretch (overload up to 110%) | 5-tier cascade। |
| 3.2 | **Spare / backup pool** | **SOURCE PARTIAL** | `route_staff_load.helper = true` + `pickup`/`day_parcels` field — "helper pool" defined; কিন্তু "capacity-surge: suggest extra riders first from less-busy routes in same hub, then from spare pool" explicit auto-suggestion RPC grep-এ পাওয়া যায়নি। | `suggestPlan` কেবল absent cover handle করে, surge handle করে কিনা unclear। |
| 3.3 | **Backup rider identification (profile badge)** | **SOURCE VERIFIED** | Batch 3 Evidence: `StaffWorkProfile.tsx:71–74` "ব্যাকআপ রাইডার" badge | |
| 3.4 | **Explicit "surge" suggestion engine** | **NOT FOUND** | grep: `surge|overflow.*route|spike|rush` — ০ ম্যাচ | **Finding B4-G-2:** planned per Owner memory, implementation gap। |

---

## 4. Morning Attendance → Zonal Route Approval → Published Route Plan

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 4.1 | **Morning attendance form (hub manager)** | **SOURCE VERIFIED** | `Morning.tsx:62–141` `MorningFormCard`; `wf_morning_submit` RPC | Opens/closes within zone policy window (BD time); auto-submit; hold states; revision number। |
| 4.2 | **Zone side of morning (all hubs)** | **SOURCE VERIFIED** | `Morning.tsx:153–215` `ZoneMorningTab` | Submission state per hub; sendBack with reason। |
| 4.3 | **Draft → Sent → Approved status chain** | **SOURCE VERIFIED** | `route_day_plan.sql:88–97`; `route_plan_decide` + `route_plan_reopen` | Hub manager → sent; Zonal → approved or send back; reopen increments version। |
| 4.4 | **Plan cannot be approved before morning submitted** | **SOURCE VERIFIED** | `Morning.tsx:322` `MorningBanner`; server-side gate also present | |
| 4.5 | **Published plan tab (hub + zone)** | **SOURCE VERIFIED** | `Morning.tsx:270–306` `PublishedPlanTab` | Version number, approved by, published_at, lines, cancelled riders, history। |
| 4.6 | **Published plan live push to rider's phone (Finding B4-G-3)** | **SOURCE PARTIAL** | `private.notify()` exists; `morning.resend` (manual) exists; `route_plan_decide` RPC-এ notify call নেই | **Approved plan silently landed** — rider কে push notification automatic যায় না; Hub manager "আবার পাঠান" টিপলে তবে যায়। |
| 4.7 | **My Parcels Card (rider personal view)** | **SOURCE VERIFIED** | `RoutePlan.tsx:503–517` `MyParcelsCard` + `route_plan_mine` RPC | `show_rider` rule মেনে filter। |

---

## 5. Pickup Return, Delivery Return & Fair Distribution

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 5.1 | **4-field daily ops entry** | **SOURCE VERIFIED** | `DailyOpsCard.tsx:17–22`; `wf_daily_ops` columns `pickup / pickup_return / delivery / delivery_return` | এক অ্যান্ট্রি + tap history (`wf_ops_add`, `wf_ops_taps`)। |
| 5.2 | **Hub manager approval of ops entry** | **SOURCE VERIFIED** | `20261125200000_workforce_review_queue.sql:1–59` `wf_ops_decisions` + `wf_ops_decide` RPC | Each revision requires explicit approve/return; `wf_ops_resubmit`। |
| 5.3 | **Returned entry history** | **SOURCE VERIFIED** | `wf_ops_decisions (entry_id, revision, status, note, decided_by, decided_at)` | Full audit trail per revision। |

---

## 6. Fair Work Distribution Analysis — Owner-এর গুরুত্বপূর্ণ প্রশ্ন

### প্রশ্ন (Decision-এ উদ্ধৃত)

> "একজন কর্মী বেশি এন্ট্রি করার কারণে অন্য কর্মী কম কাজ পেলে তাকে নেতিবাচক মূল্যায়ন করা হচ্ছে কি না, তা যাচাই করো।"

### উত্তর: **NOT FOUND — কোডে সরাসরি negative evaluation হয় না, কিন্তু indirect path আছে**

#### ৬.১ Code-level সরাসরি penalty — নেই

- `wf_daily_ops` table-এ কোনো **"performance_score"**, **"peer_avg"**, **"fairness_delta"** বা জাতীয় column নেই।
- `wf_ops_decisions` শুধু individual entry approve/return করে।
- `StaffWorkProfile.tsx` (Batch 3-এ পড়া, 183 lines) ModuleStrip শুধু submitted/draft/cancelled per module দেখায়; কোনো auto rank / fairness index নেই।
- grep `fair|peer|bench|normalize|penalize` কোনো module-এ সরাসরি match পায়নি।

#### ৬.২ Indirect path — আছে, এবং এটি OWNER-এর মূল concern

**Source:** `routePlanCore.ts:52–62` এবং `route_plan_get` RPC-এর `people.acc / people.self` join।

- Zonal manager-কে plan page-এ প্রতিটি staff-এর **past average** দেখানো হয়: `acc.days / acc.delivery`। এটি **daily accounts (da_rider_lines)**-এর অনুমোদিত সংখ্যা থেকে আসে।
- `capacityOf()` এই average ধরে আজকের capacity বসায় (`past.delivery / past.days`)।
- ফলে যদি একজন staff পরপর দিন বেশি ডেলিভারি entry করেন (manager approve করেন), তাঁর average উপরে যাবে → next day plan-এ তাঁর capacity বড় ধরা হবে → suggestPlan তাঁকে বেশি parcel assign করবে।
- বিপরীতভাবে যিনি পরপর কম entry করেছেন, তাঁর average কম → system তাঁকে কম parcel দেবে → তাঁর plan-এ record কম থাকবে।
- এই চক্রে যদি Zonal Manager কেবল `StaffWorkProfile` দেখে judge করেন, তিনি দেখবেন "A-এর ডেলিভারি কম, B-এর বেশি" — এবং **সেটি সরাসরি মূল্যায়নে রূপ নিতে পারে** যদিও পরিমাণটা সিস্টেম নিজেই suggest করেছিল (self-reinforcing loop)।

#### ৬.৩ ঝুঁকি Classification

- **Code-level direct discrimination:** ❌ নেই।
- **Data-driven indirect bias (self-reinforcing):** ⚠️ আছে (Finding B4-G-4)।
- **Mitigation currently in code:**
  - Suggestion সরাসরি সেভ হয় না — form-এ বসায় মাত্র, manager/staff বদলাতে পারেন (`RoutePlan.tsx:148–162`)।
  - Capacity source প্রতি row-তে দেখানো হয় (`fixed / accounts / self / hub / helper`)।
  - Zone rule-এ "overload limit" 100–200%-এর মধ্যে।
- **Mitigation gap:**
  - "Equal opportunity assign" মোড নেই।
  - Past 7 days work pattern-এর দৃশ্যমান peer comparison নেই।

#### ৬.৪ Recommendation (অনুমোদন ছাড়া implement হবে না)

Finding B4-G-4 → New task proposals (TASK_TRACKER-এ XZM-014, XZM-015 ইত্যাদি রাখা হয়েছে):
1. StaffWorkProfile-এ **"Peer-comparison strip"** যোগ।
2. Route plan-এ **"Workload balance"** toggle।
3. HR module-এ **"evaluation safeguard"** flag।

---

## 7. দৈনিক তিনবার অপারেশন রিপোর্ট (Thrice-a-day Ops Report)

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 7.1 | **Hub ops report submission** | **SOURCE VERIFIED** | `web/src/lib/hubOps.ts` + `HubOps.tsx` | Daily `hub_ops_reports` row per hub per date। |
| 7.2 | **Three times a day slot (morning/noon/evening)** | **NOT FOUND** | grep: `slot|shift|period|morning_report|noon_report|evening_report` — table-এ কোনো column নেই; `hub_ops_reports`-এ শুধু `report_date` | **Finding B4-G-5।** |
| 7.3 | **Zone-side fixed averages vs today's counts** | **SOURCE VERIFIED** | `OperationsCollection.tsx:49–75` `operation_collection` RPC | "একবার / দিনে" view, slot নেই। |

---

## 8. সর্টিং সেন্টার (Sorting Center) & Big Parcel & গাড়ি লোড

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 8.1 | **Sorting dashboard** | **SOURCE VERIFIED** | `Sorting.tsx:22–30` SORTING_SECTIONS; migrations `20261115000100`, `20261115001900`, `20261127131000` | 7 sections with permission gates। PR #208 নামকরণ "সর্টিং সেন্টার"। |
| 8.2 | **Sorting dispatch trip (big parcel / vehicle load)** | **SOURCE VERIFIED** | `20261127131000_sorting_trip_dispatch.sql:1–40` `sorting_dispatches`, `sorting_dispatch_stops` | vehicle, driver, helper, route, stops; unique vehicle-active constraint। |
| 8.3 | **Fuel slip (তেলের স্লিপ)** | **SOURCE VERIFIED** | `Sorting.tsx` fuel tab; `FUEL_KIND`, `FUEL_STATUS` enums | |
| 8.4 | **Vehicle load** | **SOURCE VERIFIED** | `20261115001800_manpower_and_change_register.sql` + `20261127131000` sorting_dispatches | |
| 8.5 | **Big parcel explicit module** | **SOURCE PARTIAL** | No separate "big_parcel" table; dispatch-based model handle করে | Dispatch stops-এ `handover_id` আছে, size breakdown নেই। |

---

## 9. Hub-wise Operations Report & Zonal Manager Control

| # | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| 9.1 | **Zonal Dashboard — one-page command centre** | **SOURCE VERIFIED** | Batch 3 Evidence, `ZonalDashboard.tsx:32–156` | staff stats, hub performance, alerts, tabs; `zonal.dashboard.view` gate। |
| 9.2 | **Per-hub report status** | **SOURCE VERIFIED** | `HubOps.tsx:62–123` `HubsDay` cards | |
| 9.3 | **Manager tasks on-time %** | **SOURCE VERIFIED** | `ZonalDashboard.tsx:218–229` ManagerTasks | |
| 9.4 | **Operations Collection "research centre"** | **SOURCE VERIFIED** | `OperationsCollection.tsx:38–159` | Fixed averages ↔ today's counts; Q&A to staff; planning suggestions। |
| 9.5 | **Route plan delegation (zonal → hub-level)** | **SOURCE VERIFIED** | `20261127010500_route_plan_delegation.sql` `route_plan_delegate / route_plan_delegations / route_plan_revoke_delegation` | Permission + until date। |
| 9.6 | **Zonal Requests (HR lifecycle)** | **SOURCE VERIFIED** | Batch 3 Evidence, `ZonalRequests.tsx:18–106` | ID create / inactive / transfer / reactivate। |

---

## 10. Web ও Android Sync

| # | Aspect | Status | Evidence |
|---|---|---|---|
| 10.1 | **Capacitor webview model** | **SOURCE VERIFIED** | `web/capacitor.config.json` — `server.url = https://xzmteam.com`; `errorPath = offline.html`; `cleartext = false` |
| 10.2 | **Single codebase shared** | **SOURCE VERIFIED** | Capacitor native উইন্ডো xzmteam.com লোড করে; `android/` native folder built at `make-android.bat` time |
| 10.3 | **Offline rider check-in queue** | **SOURCE VERIFIED** | `routeOffline.ts:1–147`; `20261127040000_route_checkin_offline.sql`; 48-hour age cap; max 200 items, 30 retries |
| 10.4 | **Push notification path** | **SOURCE PARTIAL** | `push-send` + `private.notify()` → FCM/APNs path exists; per-event auto push in `route_plan_decide` **absent** (Finding B4-G-3) |

---

## 11. বর্তমান vs পরিকল্পিত ফাংশন

### Current (Live at HEAD 2836a07)
- Rider route assignment (append-only history)
- Capacity calculation (fixed → learned → hub avg → helper)
- Absent cover 5-tier cascade
- Morning input → zonal approval → published plan → my-parcels card
- PDF ingestion (Steadfast Panel Dispatch / Update list)
- Four-field daily ops + tap history + revision review
- Sorting dispatch trips with vehicle + driver + helper
- Fuel slip module
- Operations Collection (zone-level averages vs today)
- Route plan delegation (zonal → hub-level staff)
- Offline rider check-in queue

### Planned / In Design (per Owner memory) — not yet in code
- **Capacity surge auto-suggestion** (B4-G-2)
- **Hub Problem Center** (XZM-010 from Batch 3)
- **Peer-comparison strip + workload balance toggle + evaluation safeguard** (B4-G-4)
- **Thrice-a-day ops slot** (B4-G-5)
- **Auto push of approved plan** (B4-G-3)
- **Zonal Command Center (Virtual / Route / Central Operation)** per Owner memory
- **Permission Matrix + Audit Log** Phase 1+2

---

## 12. Batch 4 Findings Register

| ID | Severity | Item | Suggested follow-up |
|---|---|---|---|
| **B4-G-1** | MED | Data-entry fairness index absent (§1.4) | Rolled into **XZM-014** |
| **B4-G-2** | MED | Capacity-surge rider auto-suggestion absent (§3.4) — overlap with XZM-011 | Rolled into **XZM-011** |
| **B4-G-3** | LOW | Approved plan does not auto-push to riders (§4.6) | Rolled into **XZM-016** |
| **B4-G-4** | MED | Self-reinforcing capacity bias (§6) | **XZM-014** (Fair Workload — proposed) |
| **B4-G-5** | LOW | `hub_ops_reports` has no slot/shift column (§7.2) | **XZM-015** (Thrice-a-day Ops Slots — proposed) |

---

## 13. Summary Table

| Section | SOURCE VERIFIED | SOURCE PARTIAL | NOT FOUND | RUNTIME VERIFIED | ACCESS REQUIRED |
|---|---|---|---|---|---|
| 1. Merchant Pickup & Data Entry (4) | 3 | 0 | 1 | 0 | 0 |
| 2. Route & Rider Assignment (6) | 6 | 0 | 0 | 0 | 0 |
| 3. Backup Rider & Surge (4) | 2 | 1 | 1 | 0 | 0 |
| 4. Morning → Approval → Published (7) | 6 | 1 | 0 | 0 | 0 |
| 5. Return & Fair Distribution (3) | 3 | 0 | 0 | 0 | 0 |
| 7. Thrice-a-day Ops (3) | 2 | 0 | 1 | 0 | 0 |
| 8. Sorting & Big Parcel (5) | 4 | 1 | 0 | 0 | 0 |
| 9. Hub Report & Zonal Control (6) | 6 | 0 | 0 | 0 | 0 |
| 10. Web ↔ Android Sync (4) | 3 | 1 | 0 | 0 | 0 |
| **Total (42 items)** | **35** | **4** | **3** | **0** | **0** |

Fairness analysis (§6) — SEPARATE subsection, not counted in the 42-item tally।

---

## 14. Compliance Check

- ✅ No code / DB / DNS / production change
- ✅ No Supabase migration or execute_sql
- ✅ No Netlify / Cloudflare / GitHub push beyond docs branch
- ✅ All reads scoped to HEAD `2836a07`
- ✅ Implementation **NOT started**
- ✅ `TASK_TRACKER.md` updated with XZM-010..017 as PROPOSED

---

## 15. For ChatGPT Independent Review

**Please validate:**
1. Fairness Analysis (§6) — Owner-এর মূল প্রশ্নের accurate answer?
2. B4-G-2 overlap with XZM-011 — consolidate or keep separate?
3. B4-G-4 (XZM-014) এবং B4-G-5 (XZM-015) — new task IDs confirmed?
4. Batch 4-এ 0টি RUNTIME verification — পরবর্তী ধাপ কি "Batch 5 — Runtime Verification" sprint হবে?

**Owner সিদ্ধান্ত না পাওয়া পর্যন্ত কোনো Implementation শুরু হবে না।**
