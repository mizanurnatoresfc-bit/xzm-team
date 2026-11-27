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
