# TASK_TRACKER

> XZM TEAM Shared Task Management System — ChatGPT ও Claude উভয়ের জন্য।
> **Tracker philosophy:** এই markdown ফাইল = AI coordination master (durable context, acceptance criteria, evidence pointers)। **GitHub Issues** = live status + assignment + PR linking + comments।
> প্রতিটি task-এ `GitHub Issue #` field থাকে — ডুপ্লিকেট tracker নেই।
> প্রমাণ ছাড়া কোনো task **VERIFIED / CLOSED** চিহ্নিত হবে না।

---

## 1. Workflow Rules

1. নতুন task → এই ফাইলে নতুন entry (XZM-### ID) → optionally GitHub Issue → optionally branch/PR।
2. Status transitions: `PROPOSED` → `APPROVED` → `IN_PROGRESS` → `REVIEW` → `VERIFIED` → `DEPLOYED` → `CLOSED`।
3. প্রতিটি transition এ **commit evidence** বা **owner approval reference** দরকার।
4. প্রতিটি কাজের শেষে `TASK_TRACKER.md` + `AI_HANDOVER.md` + `CHANGELOG.md` আপডেট হবে — এটি mandatory rule।
5. `main`-এ কোনো task entry সরানো যাবে না; status update হবে in-place।
6. Blocker থাকলে `Blockers` field-এ কারণ + unblock condition দিতে হবে।
7. একটি task-এ শুধু একটি primary Module ও primary Category থাকবে।

## 2. Task Categories

| Code | Category |
|---|---|
| ZM | Zonal Management |
| COP | Courier Operations & Planning |
| EDM | Employee Duty Management |
| CR | Company Reporting |
| HM | Hub Management |
| AC | Accounts |
| TR | Transport |
| WA | Web & Android |
| UX | UI/UX |
| DS | Database & Security |
| AU | Audit |
| BF | Bug Fix |
| DP | Deployment |
| FD | Future Development |

## 3. Task Record Schema (15 fields)

প্রতিটি task-এর জন্য নিচের তথ্য রাখা হয়:

1. **Task ID** — XZM-###
2. **Module** — affected module/page/area
3. **Requirement** — এক-দুই বাক্যে
4. **Business Objective** — কোন business goal সেবা করে
5. **Priority** — P0 (critical) / P1 (high) / P2 (medium) / P3 (low)
6. **Assigned AI** — Claude / ChatGPT / ChatGPT Backend Team / Owner
7. **Dependencies** — অন্য task ID বা blocker
8. **Current Status** — PROPOSED / APPROVED / IN_PROGRESS / REVIEW / VERIFIED / DEPLOYED / CLOSED
9. **Acceptance Criteria** — কী হলে done
10. **Test Evidence** — PR link, TEST_REPORT entry, screenshot path
11. **Owner Approval** — ✅ (date) / ⏳ pending / ❌ rejected
12. **Commit / PR Link** — SHA বা `#PR-number`
13. **Deployment Status** — N/A / STAGING / PROD / ROLLED_BACK
14. **Blockers** — none / description
15. **Next Action** — পরবর্তী concrete step

একটি task-এ `GitHub Issue #` থাকলে সেটি Commit/PR Link row-এর পাশে দেওয়া হয়।

---

## 4. Task Records

### XZM-001 — Project Workspace Initialization (historical)
| Field | Value |
|---|---|
| Module | Workspace / Documentation |
| Category | AU — Audit |
| Requirement | Claude workspace প্রজেক্টে attach করা, project doc পড়া, context seed |
| Business Objective | AI-এর জন্য reliable project context |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | — |
| Current Status | **CLOSED** |
| Acceptance Criteria | Project attached, CLAUD.txt ingested, workspace report delivered |
| Test Evidence | Prior conversation seed; no PR |
| Owner Approval | ✅ (pre-tracker, stated in CLAUD.txt flow) |
| Commit / PR Link | — (no code change) |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | none |
| Next Action | — closed |

### XZM-002 — Claude Workspace Initialization Report
| Field | Value |
|---|---|
| Module | Workspace / Documentation |
| Category | AU — Audit |
| Requirement | 12-point workspace যাচাই ও বাংলা report; কোনো code/DB change নয় |
| Business Objective | Setup verification, ChatGPT independent review |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-001 |
| Current Status | **CLOSED** |
| Acceptance Criteria | 12 items VERIFIED/UNVERIFIED/ACCESS_REQUIRED labeled; final report in Bengali |
| Test Evidence | Conversation turn (pre-PR workflow) |
| Owner Approval | ✅ — owner replied with XZM-003 next |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | none |
| Next Action | — closed |

### XZM-003 — Project Connection Verification
| Field | Value |
|---|---|
| Module | Integrations (GitHub, Supabase, Netlify, Cloudflare, Figma, Subframe) |
| Category | AU — Audit |
| Requirement | ৬টি connector + GitHub central doc প্ল্যান; প্রকৃত tool call দিয়ে verify |
| Business Objective | Integration health baseline, ChatGPT shared view |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-002 |
| Current Status | **IN_PROGRESS** (partial) |
| Acceptance Criteria | GitHub ✅, Supabase ✅, Netlify ✅, Cloudflare ✅, Figma ✅, Subframe ✅ — সব VERIFIED |
| Test Evidence | GitHub (`list_repos`) + Supabase (`list_projects`) results in conversation; Netlify name `xzm-team-erp` partly VERIFIED via bot comment on PR #211 |
| Owner Approval | ✅ for continuation; final CLOSE pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Netlify (site ID/branch), Cloudflare, Figma/Subframe tool calls বাকি |
| Next Action | Run `netlify-project-services-reader`, `cloudflare whoami`, `Figma whoami`, Subframe `list_projects` — back-fill `PROJECT_CONNECTIONS.md` |

### XZM-004 — Central Project Documentation Setup
| Field | Value |
|---|---|
| Module | docs/project-control |
| Category | AU — Audit / Documentation |
| Requirement | 14টি standard doc + README index, Draft PR flow, no secrets |
| Business Objective | Single source of truth for ChatGPT ↔ Claude coordination |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-003 (partial) |
| Current Status | **REVIEW** (Draft PR open, awaiting ChatGPT + owner review) |
| Acceptance Criteria | 14 files + README created; existing `docs/*.md` untouched; no secrets; Draft PR open |
| Test Evidence | PR #211, commit `fae8218`, TEST_REPORT.md entry (PASS, docs-only) |
| Owner Approval | ⏳ pending (awaiting ChatGPT independent review then owner approval) |
| Commit / PR Link | `fae8218927270ad17068b3d20c6636de41da63d1` / [#211](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/211) |
| GitHub Issue # | — (PR #211 itself) |
| Deployment Status | N/A (docs-only) |
| Blockers | ChatGPT review not yet received |
| Next Action | ChatGPT review → address feedback → ready-for-review → merge |

### XZM-005 — Shared Task Tracker Setup (this task)
| Field | Value |
|---|---|
| Module | docs/project-control/TASK_TRACKER.md + AI_HANDOVER.md |
| Category | AU — Audit / Documentation |
| Requirement | 15-field schema, 14 categories, record XZM-001…004, GitHub Issues coordination |
| Business Objective | Zero-duplicate shared task management for both AIs |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-004 (branched from `docs/project-control-init`) |
| Current Status | **REVIEW** (this PR) |
| Acceptance Criteria | New TASK_TRACKER schema in place; XZM-001…004 recorded; AI_HANDOVER updated; Draft PR open |
| Test Evidence | This PR + commit |
| Owner Approval | ⏳ pending |
| Commit / PR Link | (to be filled by commit result) |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | none |
| Next Action | Owner + ChatGPT review → merge after XZM-004 |

### XZM-006 — Backup & Recovery Verification *(planned)*
| Field | Value |
|---|---|
| Module | Supabase (backup, PITR), Netlify (deploy rollback), GitHub (branch protection), Android (build artifact archive) |
| Category | DS — Database & Security |
| Requirement | প্রতিটি tier-এর backup/restore/rollback প্রক্রিয়া verify; RPO/RTO documented |
| Business Objective | Disaster recovery readiness |
| Priority | P1 |
| Assigned AI | Claude (verification) + Owner (dashboard access where needed) |
| Dependencies | XZM-003, XZM-004 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Supabase daily backup state, PITR window, Netlify instant rollback demonstrated, GitHub branch protection rules, Android build archive policy — সব documented |
| Test Evidence | future |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Requires owner dashboard access for some settings |
| Next Action | Approval → plan sub-checks per tier |

### XZM-007 — Full Web, Android & Database Audit *(planned)*
| Field | Value |
|---|---|
| Module | web/, Android source, Supabase schema |
| Category | AU — Audit |
| Requirement | সম্পূর্ণ route inventory, table inventory, RLS summary, Android version & build config |
| Business Objective | Accurate CURRENT_SYSTEM_MAP for future planning |
| Priority | P1 |
| Assigned AI | Claude (web + DB) + separate Android pass |
| Dependencies | XZM-004, XZM-006 (so rollback is safe to rely on) |
| Current Status | **PROPOSED** |
| Acceptance Criteria | CURRENT_SYSTEM_MAP.md fully populated; PENDING markers removed; code-grep-backed route list |
| Test Evidence | future |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | none |
| Next Action | Approval → start with route grep |

### XZM-008 — Business Requirements Mapping *(planned)*
| Field | Value |
|---|---|
| Module | COMPANY_RULES.md + REPORT_FORMATS.md + REQUIREMENTS.md |
| Category | CR — Company Reporting / ZM |
| Requirement | কোম্পানির নির্ধারিত Excel report format-এর চূড়ান্ত column list; প্রতিটি business rule-কে code module-এর সাথে map |
| Business Objective | Report consumer satisfaction, implementation gap visibility |
| Priority | P1 |
| Assigned AI | ChatGPT (business analyst) + Claude (code mapping) |
| Dependencies | XZM-007 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | REPORT_FORMATS.md-এ প্রতিটি report-এর final column list; REQUIREMENTS.md-এ gap analysis |
| Test Evidence | future |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Needs owner-provided Excel samples |
| Next Action | Owner provides sample reports |

### XZM-009 — Master Development Roadmap *(planned)*
| Field | Value |
|---|---|
| Module | docs/project-control/REQUIREMENTS.md + new ROADMAP.md (optional) |
| Category | FD — Future Development |
| Requirement | 3–6 মাসের phased roadmap; XZM-### IDs with target weeks |
| Business Objective | Shared delivery plan, capacity visibility |
| Priority | P2 |
| Assigned AI | ChatGPT (product) + Claude (technical) + Owner (priority) |
| Dependencies | XZM-006, XZM-007, XZM-008 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Phased roadmap approved by owner + ChatGPT; linked to task IDs |
| Test Evidence | future |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Needs XZM-008 output |
| Next Action | Complete XZM-006 → 007 → 008 → start |

### XZM-006 — Backup & Recovery Verification *(active, under review)*
| Field | Value |
|---|---|
| Module | Infrastructure / Documentation |
| Category | AU — Audit |
| Requirement | Read-only audit of backup, disaster recovery and rollback readiness across GitHub, Supabase, Netlify, Cloudflare, Android signing |
| Business Objective | Known-good recovery posture before any production task |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-003 |
| Current Status | **UNDER_REVIEW** |
| Acceptance Criteria | 18-asset matrix + drift findings + 7 recovery scenarios + 8 action items documented |
| Test Evidence | `docs/project-control/audits/XZM-006_BACKUP_RECOVERY.md` |
| Owner Approval | ⏳ pending |
| Commit / PR Link | XZM-004R consolidation (this PR) |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting ChatGPT independent review |
| Next Action | ChatGPT review → Owner decides §5 action items → separate task IDs per item |

### XZM-007A/B-1 — Audit Batch 1 *(evidence gap)*
| Field | Value |
|---|---|
| Module | Audit |
| Category | AU |
| Requirement | First-batch audit of XZM TEAM subsystems (originally planned) |
| Priority | P2 |
| Assigned AI | Claude |
| Current Status | **EVIDENCE NOT ON FILE → RE-AUDIT PENDING** |
| Acceptance Criteria | Re-audit report under new task `XZM-007A/B-1R` upon Owner approval |
| Test Evidence | None — searched 164 remote branches + Project docs + GitHub API on 2026-11-27, no artefact found |
| Owner Approval | ⏳ pending (decide: re-audit vs cancel) |
| Commit / PR Link | — |
| Blockers | Owner decision |
| Next Action | Owner decision |

### XZM-007A/B-2 — Accounts Audit (Batch 2) *(evidence gap)*
| Field | Value |
|---|---|
| Module | Accounts |
| Category | AU |
| Requirement | Accounts module audit (originally planned) |
| Priority | P2 |
| Assigned AI | Claude |
| Current Status | **EVIDENCE NOT ON FILE → RE-AUDIT PENDING** |
| Acceptance Criteria | Re-audit report under new task `XZM-007A/B-2R` upon Owner approval |
| Test Evidence | None — same search as Batch 1 |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| Blockers | Owner decision |
| Next Action | Owner decision |

### XZM-007A/B-3 — Zonal Management & Employee Duty Audit (Batch 3) *(under review)*
| Field | Value |
|---|---|
| Module | Zonal Management + Employee & Duty Management + Planning & Control |
| Category | AU — Audit |
| Requirement | Read-only Batch 3 feature audit at HEAD `2836a07` |
| Business Objective | Feature coverage evidence for ChatGPT independent review |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-006 |
| Current Status | **UNDER_REVIEW** |
| Acceptance Criteria | 29-item matrix (23 SOURCE VERIFIED / 6 PARTIAL / 0 NOT FOUND / 0 RUNTIME VERIFIED / 5 ACCESS REQUIRED); 5 gap items (G-1..G-5) + 3 new findings (G-6..G-8) + 3 folder-hygiene findings (G-A7-1..3) |
| Test Evidence | `docs/project-control/audits/XZM-007AB-3_BATCH3_ZONAL_DUTY_AUDIT.md` + `XZM-007AB-3_BATCH3_CORRECTION.md` |
| Owner Approval | ⏳ pending |
| Commit / PR Link | XZM-004R consolidation (this PR) |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting ChatGPT independent review |
| Next Action | ChatGPT review → open G-1..G-8 as task IDs (XZM-010..016 already proposed below) |

### XZM-007A/B-4 — Courier Operations & Planning Audit (Batch 4) *(under review)*
| Field | Value |
|---|---|
| Module | Courier Operations & Planning |
| Category | AU — Audit |
| Requirement | Read-only Batch 4 audit at HEAD `2836a07` |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-007A/B-3 |
| Current Status | **UNDER_REVIEW** |
| Acceptance Criteria | Report pending full writeup; preliminary findings cross-referenced from Batch 3 |
| Test Evidence | `claude/BATCH4_COURIER_OPS_AUDIT.md` (claude workspace — to be consolidated in a follow-up) |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| Blockers | Report writeup pending |
| Next Action | Complete Batch 4 writeup → consolidate into `docs/project-control/audits/` |

### XZM-010 — Problem Center Enhancement *(proposed, audit pending)*
| Field | Value |
|---|---|
| Module | Issues / Hub Problem Center |
| Category | ZM + UX |
| Requirement | Auto-routing hub problem → zonal → hub-manager/call-center + per-rider tag + hub-wise leaderboard |
| Business Objective | Faster rider problem resolution; accountability |
| Priority | P2 |
| Assigned AI | TBD |
| Dependencies | XZM-007A/B-3 Finding G-1 |
| Current Status | **PROPOSED / AUDIT PENDING** |
| Acceptance Criteria | Clarified scope vs existing `Issues.tsx`; implementation plan; owner approval |
| Owner Approval | ⏳ pending |
| Blockers | Owner clarification whether existing `Issues.tsx` is intended target |
| Next Action | Clarify scope with Owner |

### XZM-011 — Smart Route & Backup Manpower Planning *(proposed, audit pending)*
| Field | Value |
|---|---|
| Module | zonal.plan RPC + RoutePlan.tsx |
| Category | COP + ZM |
| Requirement | Capacity-surge logic (less-busy routes first → spare pool); backup rider suggestion engine; confirmation vs auto-dispatch |
| Priority | P1 |
| Assigned AI | ChatGPT Backend Team (RPC) + Claude (UI) |
| Dependencies | XZM-007A/B-3 Finding G-2, XZM-007A/B-4 |
| Current Status | **PROPOSED / AUDIT PENDING** |
| Acceptance Criteria | Backend audit of `zonal.plan` SQL + UI confirmation flow |
| Owner Approval | ⏳ pending |

### XZM-012 — Hub Switching Verification *(proposed, audit pending)*
| Field | Value |
|---|---|
| Module | AppShell + all pages |
| Category | UX + AU |
| Requirement | grep-verify singleton hub-switcher widget in global header; UI QA confirms no per-page duplicate |
| Priority | P3 |
| Assigned AI | Claude |
| Dependencies | XZM-007A/B-3 Finding G-3 |
| Current Status | **PROPOSED / AUDIT PENDING** |
| Owner Approval | ⏳ pending |

### XZM-013 — Employee Duty Evidence *(proposed, audit pending)*
| Field | Value |
|---|---|
| Module | hubApi.taskComplete + EvidencePicker |
| Category | EDM + UX |
| Requirement | Policy: whether duty completion requires evidence (photo/file) attach via EvidencePicker |
| Priority | P3 |
| Assigned AI | TBD |
| Dependencies | XZM-007A/B-3 Finding G-4 |
| Current Status | **PROPOSED / AUDIT PENDING** |
| Owner Approval | ⏳ pending |

### XZM-014 — Fair Workload & Performance Evaluation *(proposed)*
| Field | Value |
|---|---|
| Module | wf_daily_ops + zonal dashboard |
| Category | EDM + CR |
| Requirement | Fairness index for staff data entries — detect when parcel distribution skews peer ranking |
| Business Objective | Prevent mis-ranking of staff when route planner (not staff) assigned the parcel load |
| Priority | P2 |
| Assigned AI | ChatGPT Backend Team (fairness RPC) + Claude (UI) |
| Dependencies | XZM-007A/B-3 Correction Finding G-6 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Peer-average comparison + fairness badge in StaffWorkProfile |
| Owner Approval | ⏳ pending |
| Conflict check | No XZM-014 elsewhere — SAFE |

### XZM-015 — Daily Three-Slot Operations Reporting *(proposed)*
| Field | Value |
|---|---|
| Module | hub_ops_reports + OperationsCollection |
| Category | CR + COP |
| Requirement | Add `report_slot` / `shift` field to `hub_ops_reports`; enforce morning/mid/night submissions |
| Business Objective | Match business rule of 3-times-daily hub ops reporting |
| Priority | P2 |
| Assigned AI | ChatGPT Backend Team (schema) + Claude (UI) |
| Dependencies | XZM-007A/B-3 Correction Finding G-7 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Migration adds slot column + UI prompts for missed slots |
| Owner Approval | ⏳ pending |
| Conflict check | No XZM-015 elsewhere — SAFE |

### XZM-016 — Route Approval Push Notification *(proposed)*
| Field | Value |
|---|---|
| Module | route_plan_decide + push-send edge function |
| Category | COP + WA |
| Requirement | On route plan approval, automatically push notification to each assigned rider (currently manual "আবার পাঠান") |
| Business Objective | Rider gets today's assignment without hub manager re-sending |
| Priority | P2 |
| Assigned AI | ChatGPT Backend Team (RPC hook) + Claude (test) |
| Dependencies | XZM-007A/B-3 Correction Finding G-8 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Approval triggers `private.notify()` for every rider on the plan |
| Owner Approval | ⏳ pending |
| Conflict check | No XZM-016 elsewhere — SAFE |

### XZM-017 — Operations Report Export *(proposed)*
| Field | Value |
|---|---|
| Module | OperationsCollection + wf_daily_ops |
| Category | CR |
| Requirement | Explicit Excel export pathway for daily ops (pickup / delivery / returns), zonal-configurable column layout |
| Business Objective | Match courier company report format consumption |
| Priority | P2 |
| Assigned AI | Claude |
| Dependencies | XZM-007A/B-3 Correction Q.3.11 (PARTIAL) + XZM-008 column spec |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Downloadable XLSX from Operations Collection respecting Zonal column config |
| Owner Approval | ⏳ pending |
| Conflict check | No XZM-017 elsewhere — SAFE |

### XZM-004R — Central Documentation Recovery & Synchronization *(this task)*
| Field | Value |
|---|---|
| Module | docs/project-control + RISK_REGISTER + audits/ |
| Category | AU — Audit / Documentation |
| Requirement | Consolidate both `docs/project-control-init` and `docs/xzm-005-task-tracker` branches, port durable `claude/*` reports to `docs/project-control/audits/`, record XZM-006..017, seed RISK_REGISTER |
| Business Objective | Single Central Documentation Knowledge Base per Owner decision (2026-11-27) |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-004, XZM-005 |
| Current Status | **REVIEW** (Draft PR) |
| Acceptance Criteria | (a) no file deleted; (b) three updated central docs (TASK_TRACKER, AI_HANDOVER, CHANGELOG); (c) new `audits/XZM-006`, `audits/XZM-007AB-3*` files; (d) new `RISK_REGISTER.md`; (e) no secrets; (f) no CI deploy trigger (verified: `web/**`, `supabase/**` paths only); (g) Draft PR open |
| Test Evidence | This PR (docs-only diff) |
| Owner Approval | ⏳ pending (ChatGPT Independent Review → Owner approval) |
| Commit / PR Link | Branch `docs/xzm-004r-consolidated` (this PR) |
| Deployment Status | N/A (docs-only) |
| Blockers | None |
| Next Action | ChatGPT review → Owner approval → merge → `claude/` becomes scratch-only |

## 5. Historical PRs (pre-tracker, for reference only)

| Ref | Title | Status | Note |
|---|---|---|---|
| PR #177 | Route setup — OSM load + Draw area | MERGED | Owner-tested per memory; no formal XZM-ID |
| PR #178 | Sidebar personal-row follows role menu | MERGED | Shipped 2026-11-26 |
| PR #208 | Rename sorting dashboard to সর্টিং সেন্টার | CLOSED | Branding consistency |

## 6. GitHub Issues Coordination

- **Live board:** https://github.com/mizanurnatoresfc-bit/xzm-team/issues
- 26 open issues as of 2026-11-27।
- Recommended convention: এই tracker-এর কোনো task যদি Owner বা ChatGPT GitHub Issue হিসেবে খুলতে চান, issue title prefix-এ **`[XZM-###]`** দেবেন; সেই issue number এখানে `GitHub Issue #` row-এ যোগ হবে।
- Custom labels suggestion (future task): `xzm-task`, `zm`, `cop`, `edm`, `cr`, `hm`, `ac`, `tr`, `wa`, `ux`, `ds`, `au`, `bf`, `dp`, `fd` — সম্মতি পেলে XZM-### task-এ setup।
- এই markdown tracker ও GitHub Issues-এর মধ্যে conflict হলে **GitHub Issues** = live state, এই markdown = durable context।
