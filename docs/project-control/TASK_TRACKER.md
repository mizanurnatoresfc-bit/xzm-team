# TASK_TRACKER

> XZM TEAM Shared Task Management System — ChatGPT ও Claude উভয়ের জন্য।
> **Tracker philosophy:** এই markdown ফাইল = AI coordination master (durable context, acceptance criteria, evidence pointers)। **GitHub Issues** = live status + assignment + PR linking + comments।
> প্রতিটি task-এ `GitHub Issue #` field থাকে — ডুপ্লিকেট tracker নেই।
> প্রমাণ ছাড়া কোনো task **VERIFIED / CLOSED** চিহ্নিত হবে না।

---

## 1. Workflow Rules

1. নতুন task → এই ফাইলে নতুন entry (XZM-### ID) → optionally GitHub Issue → optionally branch/PR।
2. **Allowed statuses (full set, used by Section 4 records):**
   - `PROPOSED` — recorded, not yet Owner-approved.
   - `APPROVED` — Owner approved; implementation may begin.
   - `IN_PROGRESS` — Claude/ChatGPT actively working.
   - `REVIEW` — PR open, awaiting review (code-change PR).
   - `UNDER_REVIEW` — audit/evidence report awaiting ChatGPT independent review (no code PR, documentation PR only).
   - `EVIDENCE_NOT_ON_FILE` — historical task, artefact missing; Owner decides re-audit vs cancel.
   - `VERIFIED` — review passed, tests green.
   - `DEPLOYED` — change is live on production.
   - `CLOSED` — task complete and no further action expected.
3. **Typical transitions:** `PROPOSED` → `APPROVED` → `IN_PROGRESS` → `REVIEW` → `VERIFIED` → `DEPLOYED` → `CLOSED`. Audit tasks follow `PROPOSED` → `APPROVED` → `IN_PROGRESS` → `UNDER_REVIEW` → `VERIFIED` → `CLOSED`.
4. প্রতিটি transition এ **commit evidence** বা **owner approval reference** দরকার।
5. প্রতিটি কাজের শেষে `TASK_TRACKER.md` + `AI_HANDOVER.md` + `CHANGELOG.md` আপডেট হবে — এটি mandatory rule।
6. `main`-এ কোনো task entry সরানো যাবে না; status update হবে in-place।
7. Blocker থাকলে `Blockers` field-এ কারণ + unblock condition দিতে হবে।
8. একটি task-এ শুধু একটি primary Module ও primary Category থাকবে।

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
8. **Current Status** — PROPOSED / APPROVED / IN_PROGRESS / REVIEW / UNDER_REVIEW / EVIDENCE_NOT_ON_FILE / VERIFIED / DEPLOYED / CLOSED (see Section 1 rule 2 for full definitions)
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

### XZM-001 — ChatGPT Workspace Setup (historical)
| Field | Value |
|---|---|
| Module | Workspace / Documentation |
| Category | AU — Audit |
| Requirement | ChatGPT (Director/Architect/Auditor) side workspace attach, project context seed, Director role setup |
| Business Objective | ChatGPT-এর জন্য reliable project context + independent review authority |
| Priority | P1 |
| Assigned AI | ChatGPT |
| Dependencies | — |
| Current Status | **CLOSED** |
| Acceptance Criteria | ChatGPT attached to project context; authority split confirmed; initial review workflow established |
| Test Evidence | Prior conversation seed; no PR |
| Owner Approval | ✅ (pre-tracker) |
| Commit / PR Link | — (no code change) |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | none |
| Next Action | — closed |

### XZM-002 — Claude Workspace Setup
| Field | Value |
|---|---|
| Module | Workspace / Documentation |
| Category | AU — Audit |
| Requirement | Claude (Implementation Engineer) side workspace attach, 12-point workspace verification report in Bengali; কোনো code/DB change নয় |
| Business Objective | Setup verification, ChatGPT Independent Review trigger |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-001 |
| Current Status | **CLOSED** |
| Acceptance Criteria | 12 items VERIFIED/UNVERIFIED/ACCESS_REQUIRED labeled; final report in Bengali; Claude attached to CLAUD.txt flow |
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

*(XZM-006 initial PROPOSED stub consolidated into the single master record below — see "XZM-006 — Backup & Recovery Verification (UNDER_REVIEW)")*

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

### XZM-006 — Backup & Recovery Verification
| Field | Value |
|---|---|
| Module | Infrastructure / Documentation (Supabase PITR, Netlify rollback, GitHub branch protection, Android signing, Cloudflare DNS) |
| Category | AU — Audit (Database & Security scope) |
| Requirement | Read-only audit of backup, disaster recovery and rollback readiness across GitHub, Supabase, Netlify, Cloudflare, Android signing; RPO/RTO documented |
| Business Objective | Known-good recovery posture before any production task; disaster recovery readiness |
| Priority | P1 |
| Assigned AI | Claude (verification) + Owner (dashboard access where needed) |
| Dependencies | XZM-003, XZM-004 |
| Current Status | **UNDER_REVIEW** |
| Acceptance Criteria | 18-asset matrix + drift findings + 7 recovery scenarios + 9 action items + 10 verification items + XZM-006A..I sub-tasks documented in central audit file; 6-point correction pass applied (Free-plan PITR, Edge Function download feasibility, version-wise migration drift, preview/prod binding split, personal path redaction, XZM-006I added) |
| Test Evidence | `docs/project-control/audits/XZM-006_BACKUP_RECOVERY.md` (full deep verification + 6-point correction pass, 2026-11-27) |
| Owner Approval | ⏳ pending |
| Commit / PR Link | Initial: XZM-004R PR #213 (merged `24b348d`). Deep verification: XZM-006-Deep PR (this PR) |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting ChatGPT Independent Second Review on deep verification |
| Next Action | ChatGPT Second Review of 6-point correction pass → Owner approves XZM-006A..I → open each as separate PR |

### XZM-006A — Android Signing Key: Original Backup + Match Verification + Encrypted Storage
| Field | Value |
|---|---|
| Module | Android signing / CI secrets |
| Category | DS — Database & Security |
| Requirement | Three-part procedure delivered in `docs/project-control/audits/XZM-006A_ANDROID_SIGNING_KEY.md`: (a) six-location Owner checklist for finding the original keystore; (b) `apksigner verify --print-certs` fingerprint extraction from the live APK + `keytool -list -v` match verification against any found `.jks`; (c) GPG-AES256 encrypted bundle (keystore + keystore.properties + README) stored in two independent locations (password-manager vault + offline media), passphrase kept separately |
| Business Objective | Remove CRITICAL single-point-of-failure on Android update channel |
| Priority | P0 (CRITICAL) |
| Assigned AI | Claude (procedure doc — done) + Owner (locate file + encrypt + store) |
| Dependencies | XZM-006 §3.3 Owner verification |
| Current Status | **UNDER_REVIEW** — audit doc complete; awaiting ChatGPT review + Owner execution |
| Acceptance Criteria | Owner locates matching `.jks`; `apksigner`/`keytool` SHA-256 verification passes; two encrypted off-GitHub copies in independent locations; public fingerprint recorded in PROJECT_CONNECTIONS.md §11; R-001 moves OPEN → MITIGATED |
| Test Evidence | `docs/project-control/audits/XZM-006A_ANDROID_SIGNING_KEY.md` + workflow line-item citations into `.github/workflows/android-apk.yml` (lines 115–140, 171–196) |
| Owner Approval | ⏳ pending |
| Commit / PR Link | PR `docs/xzm-006ab-critical-backup-recovery` (this PR) |
| GitHub Issue # | — |
| Deployment Status | N/A (docs-only + Owner-executed manual steps) |
| Blockers | Owner performs §2 checks 1–6 on their machine |
| Next Action | Owner runs §2 (locate) → §3.1 Method A (extract fingerprint) → §4 (verify match) → §5 (encrypted backup) |
| Follow-up impl PR | **XZM-006A-impl** — `scripts/verify-apk-signer.sh` + `scripts/verify-local-keystore.sh` + PROJECT_CONNECTIONS.md §11 fingerprint record + RISK_REGISTER R-001 → MITIGATED (opened after Owner steps 1–3 complete) |
| Conflict check | No XZM-006A elsewhere — SAFE |

### XZM-006B — Supabase Backup Plan: Production Identification + DB/Schema/Auth/RLS/RPC/Storage + Daily Automation + Retention/Cost/Recovery
| Field | Value |
|---|---|
| Module | Supabase (DB, Auth, RLS, RPC, Storage, Edge Function secrets, Realtime) + production-binding documentation |
| Category | DS — Database & Security |
| Requirement | Owner approved staying on Supabase Free with encrypted database and separate Storage backups to private Cloudflare R2. Retain 14 daily, 12 weekly and 12 monthly copies. See the audit plan for dashboard-only configuration coverage. Confirm the effective published Supabase URL before targeting production. |
| Business Objective | Known-good recovery posture for every Supabase sub-system; no ambiguity about which project is production; measurable RPO/RTO |
| Priority | P1 (HIGH) |
| Assigned AI | ChatGPT Work (implementation and verification) + Claude (audit plan in #215) + Owner (R2 checkout and production authorization) |
| Dependencies | XZM-006 §6.2, §5.2 |
| Current Status | **IN_PROGRESS** — approach approved and issue opened. Backup activation and first run pending. |
| Acceptance Criteria | Plan decision recorded in DECISION_LOG; backup workflow green on first run; first encrypted dump landed on primary target; `supabase-config/` folder seeded; `VITE_SUPABASE_URL` + production annotation in PROJECT_CONNECTIONS.md; R-010 + R-011 → MITIGATED |
| Verified in this PR (read-only) | Production project ref = `ndgnhvbpmtxrpplgsslz` (8 signals cross-match); 181 tables (all RLS-enabled) + 1 view + 468 RPCs + 255 policies + 7 private Storage buckets + 85 auth users + ~200 MB DB + ~5.5 MB storage; API URL `https://ndgnhvbpmtxrpplgsslz.supabase.co` |
| Test Evidence | — |
| Owner Approval | Approved 2026-11-27 (Asia/Dhaka) — keep Free and use private R2. |
| Commit / PR Link | Audit plan [#215](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/215) |
| GitHub Issue # | [#216](https://github.com/mizanurnatoresfc-bit/xzm-team/issues/216) |
| Deployment Status | N/A |
| Blockers | R2 active and Standard bucket verified private. Backup credentials and effective Supabase URL in the published build still pending. |
| Next Action | Owner confirms `VITE_SUPABASE_URL` from Netlify Site Settings → records in PROJECT_CONNECTIONS.md §10; picks plan option; provisions R2 bucket + API token |
| Follow-up impl PR | **XZM-006B-impl** — `.github/workflows/supabase-daily-backup.yml` + `docs/project-control/supabase-config/*.md` + PROJECT_CONNECTIONS.md §10 + BACKUP_LOG.md (opened after Owner decisions) |
| Conflict check | No XZM-006B elsewhere — SAFE |

### XZM-006C — Supabase Migration Drift Reconciliation (structural, per-migration) *(proposed)*
| Field | Value |
|---|---|
| Module | `supabase/migrations/` |
| Category | DS |
| Requirement | Per-migration decision pass across **29 names present in live but missing from repo** (`probe_delete`, `probe_alter`, `vehicle_ops_index`, `vehicle_ops_a`..`_d`, `vehicle_ops_b1a`, `vehicle_ops_b2`, `vehicle_ops_fix_log_list`, `hub_issues_a..e_*`, `workforce_attendance_a`/`_b1`/`_b2`, `workforce_manager_book_a..d`, `work_focus_and_zonal_hub_transfer`, `staff_self_employee_scope`, `role_based_menus`, `role_sidebar_menu_system`, `add_ai_plan_to_route_day_plans`, `fleet_office_kinds`, `hub_registers_pending_release`, `manager_hub_registers`) **and 16 names present in repo but missing from live** (`hub_issues`, `workforce_attendance`, `workforce_manager_book`, `vehicle_ops`, `work_focus`, `zonal_hub_transfer`, `att_versions_windows`, `daily_register_own_month`, `list_tools_permission`, `pending_manager_review`, `pending_month_report`, `route_places`, `route_settings`, `staff_pending_snapshots`, `staff_work_profile`, `zone_group_and_contact`). For each: either adopt live version into repo, retire repo version, or write a bridge migration. Also note 124 timestamp mismatches across 2026-11-15…2026-11-27 (repo uses pseudo-sequential; live uses real clock) and decide whether to re-timestamp the repo files to match live. See XZM-006 audit §3.1 |
| Business Objective | Repo = authoritative recovery source for schema; clean restore from repo reproduces live |
| Priority | P1 (HIGH) |
| Assigned AI | ChatGPT Backend Team (intent review per migration) + Claude (file commit after approval) |
| Dependencies | XZM-006 §3.1 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Every 29 live-only + 16 repo-only name resolved (reconciled, bridged, or formally discarded); timestamp convention decision recorded in DECISION_LOG; clean restore from repo into the staging project produces live schema (verified by XZM-006I) |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | ChatGPT Backend Team scope decision per orphan |
| Next Action | ChatGPT Backend Team reviews orphan list |
| Conflict check | No XZM-006C elsewhere — SAFE |

### XZM-006D — Cloudflare DNS + Workers + Netlify Rollback Runbook *(proposed)*
| Field | Value |
|---|---|
| Module | Cloudflare DNS, Cloudflare Workers, Netlify |
| Category | DS + DP |
| Requirement | Export `xzmteam.com` zone file (Owner); commit redacted zone inventory; write rollback runbooks for Cloudflare Workers deployments + Netlify deploys; document DNS audit-log retention |
| Business Objective | Known-good DNS + edge rollback procedures |
| Priority | P1 (HIGH) |
| Assigned AI | Owner (zone export) + Claude (runbook) |
| Dependencies | XZM-006 §6.5 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Zone file exported off-GitHub; rollback runbooks committed; R-005 moves from OPEN → MITIGATED |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Owner Cloudflare dashboard access |
| Next Action | Owner exports zone file |
| Conflict check | No XZM-006D elsewhere — SAFE |

### XZM-006E — Missing Edge Functions Source Recovery *(proposed, re-scoped)*
| Field | Value |
|---|---|
| Module | `supabase/functions/nodi-route-plan`, `supabase/functions/osm-fetch-places` |
| Category | DS |
| Requirement | **Retrieve** deployed source from live via `supabase functions download nodi-route-plan --project-ref ndgnhvbpmtxrpplgsslz` and `supabase functions download osm-fetch-places --project-ref ndgnhvbpmtxrpplgsslz` (CLI; Dashboard Download button is an equivalent manual path). Review retrieved source against call sites in `web/` + migrations for correctness and missing imports. Commit to repo under Owner approval + ChatGPT Backend Team contract. Earlier "re-author from scratch" fallback is retained only if the download fails for a specific function. |
| Business Objective | Redeployability of all 6 live edge functions from the repo |
| Priority | P1 (HIGH) |
| Assigned AI | Claude (download + review) + ChatGPT Backend Team (contract & approval) |
| Dependencies | XZM-006 §3.2 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Source for both functions committed to `supabase/functions/`; redeploy dry-run succeeds in a non-production target (optionally inside XZM-006I); R-004 moves from OPEN → MITIGATED |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Owner approval + ChatGPT Backend Team contract |
| Next Action | ChatGPT Backend Team contracts the retrieval + commit plan |
| Conflict check | No XZM-006E elsewhere — SAFE |

### XZM-006F — Git Tag Policy + First Live Tag *(proposed)*
| Field | Value |
|---|---|
| Module | Git tags / releases |
| Category | DP — Deployment |
| Requirement | Adopt per-release tagging policy; tag the current live commit (`24b348d` or next post-approval live SHA) as `v2026.11.27-live` (or appropriate date) |
| Business Objective | Named "last known good" for rollback audit |
| Priority | P2 (MEDIUM) |
| Assigned AI | Claude |
| Dependencies | XZM-006 §3.5 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | First tag pushed; policy documented in CHANGELOG + DEPLOYMENT_LOG; R-006 moves from OPEN → MITIGATED |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Owner approval |
| Next Action | Owner approves tag strategy |
| Conflict check | No XZM-006F elsewhere — SAFE |

### XZM-006G — RPO/RTO Owner Questionnaire + Target Definition *(proposed)*
| Field | Value |
|---|---|
| Module | Documentation (Business inputs → DR targets) |
| Category | AU — Audit |
| Requirement | Collect Owner's max tolerable data-loss window (RPO) + restore-time window (RTO) per system tier (DB, Netlify, Cloudflare DNS, Android signing, Edge Functions); record in RISK_REGISTER + AUDIT_REPORT |
| Business Objective | Measurable DR targets to test against drills |
| Priority | P2 (MEDIUM) |
| Assigned AI | Owner (business inputs) + ChatGPT (DR target review) + Claude (doc) |
| Dependencies | XZM-006 §6.7 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | RPO + RTO numbers filled for each tier; drill success criteria defined |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Owner business inputs |
| Next Action | Questionnaire delivered to Owner |
| Conflict check | No XZM-006G elsewhere — SAFE |

### XZM-006H — Supabase Security Advisors Remediation (7 findings) *(proposed)*
| Field | Value |
|---|---|
| Module | Supabase RLS + security_definer views/functions + extensions |
| Category | DS |
| Requirement | Fix 1 ERROR (`rls_enabled_no_policy` on `v_user_sidebar`) + 5 WARN categories + 1 INFO (`auth_leaked_password_protection`) — one migration per logical category |
| Business Objective | Clean security posture; reduce latent privilege-escalation risk |
| Priority | P2 (MEDIUM) |
| Assigned AI | ChatGPT Backend Team (fix migrations) + Claude (verification) |
| Dependencies | XZM-006 §3.4 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | `get_advisors` returns 0 ERROR; WARN count reduced to known-accepted; R-007 moves from OPEN → MITIGATED |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | ChatGPT Backend Team scope |
| Next Action | ChatGPT Backend Team scopes fix migrations per category |
| Conflict check | No XZM-006H elsewhere — SAFE |

### XZM-006I — Isolated Backup Restore Test *(proposed)*
| Field | Value |
|---|---|
| Module | Supabase (DB restore drill) + Netlify (preview site) + Edge Functions deployment (staging) |
| Category | DS + AU |
| Requirement | One end-to-end drill in isolation: (a) take a `supabase db dump` of production (`ndgnhvbpmtxrpplgsslz`); (b) restore it into the staging project (`mbpjvqeizwjjsvnbjerb`, `xzm-team-staging`); (c) apply the repo's edge-function source + `supabase functions deploy` into the staging project; (d) deploy the current `web/dist` to a preview Netlify site bound exclusively to staging (separate build env; **no production secrets, domains or env vars reused**); (e) run a documented smoke sequence (login, one read, one write, one edge-function call); (f) measure wall-clock RPO and RTO; (g) tear down the preview site and reset staging. |
| Business Objective | First measured end-to-end DR validation; feeds RPO/RTO numbers into XZM-006G |
| Priority | P2 (MEDIUM) |
| Assigned AI | ChatGPT Backend Team (plan) + Owner (approval + secrets provisioning for staging) + Claude (runbook + execution log) |
| Dependencies | XZM-006B (dump mechanism available) + XZM-006E (edge sources committed) + Owner approval |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Drill executed in a session scheduled specifically for it; RPO + RTO numbers recorded; staging reset to empty; drill report committed under `docs/project-control/audits/XZM-006I_RESTORE_DRILL.md`; R-002 moves from OPEN → MITIGATED |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | XZM-006B + XZM-006E completion; dedicated drill window; isolated-staging secret set |
| Next Action | ChatGPT Backend Team drafts drill plan + hard-constraint checklist (no shared bindings) |
| Conflict check | No XZM-006I elsewhere in TASK_TRACKER — SAFE (new namespace letter) |

### XZM-007A/B-1 — Audit Batch 1 *(evidence gap)*
| Field | Value |
|---|---|
| Module | Audit |
| Category | AU |
| Requirement | First-batch audit of XZM TEAM subsystems (originally planned) |
| Business Objective | Historical coverage; input to CURRENT_SYSTEM_MAP |
| Priority | P2 |
| Assigned AI | Claude |
| Dependencies | — |
| Current Status | **EVIDENCE_NOT_ON_FILE** (re-audit pending Owner decision) |
| Acceptance Criteria | Re-audit report under new task `XZM-007A/B-1R` upon Owner approval |
| Test Evidence | None — searched 164 remote branches + Project docs + GitHub API on 2026-11-27, no artefact found |
| Owner Approval | ⏳ pending (decide: re-audit vs cancel) |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Owner decision |
| Next Action | Owner decision |

### XZM-007A/B-2 — Accounts Audit (Batch 2) *(evidence gap)*
| Field | Value |
|---|---|
| Module | Accounts |
| Category | AU |
| Requirement | Accounts module audit (originally planned) |
| Business Objective | Historical coverage; input to CURRENT_SYSTEM_MAP |
| Priority | P2 |
| Assigned AI | Claude |
| Dependencies | — |
| Current Status | **EVIDENCE_NOT_ON_FILE** (re-audit pending Owner decision) |
| Acceptance Criteria | Re-audit report under new task `XZM-007A/B-2R` upon Owner approval |
| Test Evidence | None — same search as Batch 1 |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
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

### XZM-007A/B-4 — Courier Operations & Planning Audit (Batch 4)
| Field | Value |
|---|---|
| Module | Courier Operations & Planning |
| Category | AU — Audit |
| Requirement | Read-only Batch 4 audit at HEAD `2836a07` covering Merchant Pickup, Data Entry, Route Management, Rider Assignment, Backup Rider, Morning Attendance, Zonal Route Approval, Published Route Plan, Pickup/Delivery Return, Sorting Center, Big Parcel, Vehicle Load, Hub-wise Operations Report, Zonal Manager Control, Web ↔ Android Sync |
| Business Objective | Feature coverage evidence for ChatGPT independent review |
| Priority | P1 |
| Assigned AI | Claude |
| Dependencies | XZM-007A/B-3 |
| Current Status | **UNDER_REVIEW** |
| Acceptance Criteria | 42-item matrix (35 SOURCE VERIFIED / 4 SOURCE PARTIAL / 3 NOT FOUND / 0 RUNTIME VERIFIED / 0 ACCESS REQUIRED); Fair Work Distribution analysis (§6); 5 Batch-4 findings (B4-G-1..B4-G-5) mapped to proposed XZM-011/014/015/016 |
| Test Evidence | `docs/project-control/audits/XZM-007AB-4_BATCH4_COURIER_OPS_AUDIT.md` (ported to central folder in XZM-004R Review-Response) |
| Owner Approval | ⏳ pending |
| Commit / PR Link | XZM-004R consolidation (PR #213) |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting ChatGPT independent review |
| Next Action | ChatGPT review → Owner approval on B4-G findings → open XZM-011/014/015/016 as separate approved PRs |

### XZM-010 — Problem Center Enhancement *(proposed)*
| Field | Value |
|---|---|
| Module | Issues / Hub Problem Center |
| Category | ZM + UX |
| Requirement | Auto-routing hub problem → zonal → hub-manager/call-center + per-rider tag + hub-wise leaderboard |
| Business Objective | Faster rider problem resolution; accountability |
| Priority | P2 |
| Assigned AI | TBD (ChatGPT scope + Claude UI, pending approval) |
| Dependencies | XZM-007A/B-3 Finding G-1 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Clarified scope vs existing `Issues.tsx`; implementation plan; owner approval |
| Test Evidence | — (none yet; task not approved) |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Owner clarification whether existing `Issues.tsx` is intended target |
| Next Action | Clarify scope with Owner |

### XZM-011 — Smart Route & Backup Manpower Planning *(proposed)*
| Field | Value |
|---|---|
| Module | zonal.plan RPC + RoutePlan.tsx |
| Category | COP + ZM |
| Requirement | Capacity-surge logic (less-busy routes first → spare pool); backup rider suggestion engine; confirmation vs auto-dispatch |
| Business Objective | Handle parcel-count spikes without manual re-shuffling by zonal/hub manager |
| Priority | P1 |
| Assigned AI | ChatGPT Backend Team (RPC) + Claude (UI) |
| Dependencies | XZM-007A/B-3 Finding G-2, XZM-007A/B-4 B4-G-2 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Backend audit of `zonal.plan` SQL + UI confirmation flow approved |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting Owner approval |
| Next Action | Owner approval → backend contract to ChatGPT Backend Team |

### XZM-012 — Hub Switching Verification *(proposed)*
| Field | Value |
|---|---|
| Module | AppShell + all pages |
| Category | UX + AU |
| Requirement | grep-verify singleton hub-switcher widget in global header; UI QA confirms no per-page duplicate |
| Business Objective | Confirm Owner memory rule — single hub switcher — holds across all pages |
| Priority | P3 |
| Assigned AI | Claude |
| Dependencies | XZM-007A/B-3 Finding G-3 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | grep-backed inventory of HubPicker usages + screenshot evidence; zero duplicates found |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting Owner approval |
| Next Action | Owner approval → Claude runs grep audit |

### XZM-013 — Employee Duty Evidence *(proposed)*
| Field | Value |
|---|---|
| Module | hubApi.taskComplete + EvidencePicker |
| Category | EDM + UX |
| Requirement | Policy: whether duty completion requires evidence (photo/file) attach via EvidencePicker |
| Business Objective | Compliance proof for duty completion when demanded by ops/HR |
| Priority | P3 |
| Assigned AI | TBD (Owner policy → Claude UI) |
| Dependencies | XZM-007A/B-3 Finding G-4 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Owner policy decision documented + (if yes) implementation plan |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting Owner policy decision |
| Next Action | Owner policy decision |

### XZM-014 — Fair Workload & Performance Evaluation *(proposed)*
| Field | Value |
|---|---|
| Module | wf_daily_ops + zonal dashboard + StaffWorkProfile |
| Category | EDM + CR |
| Requirement | Fairness index for staff data entries — detect when parcel distribution skews peer ranking; peer-average comparison strip; evaluation safeguard flag |
| Business Objective | Prevent mis-ranking of staff when route planner (not staff) assigned the parcel load; address Owner's self-reinforcing-bias concern (B4-G-4) |
| Priority | P2 |
| Assigned AI | ChatGPT Backend Team (fairness RPC) + Claude (UI) |
| Dependencies | XZM-007A/B-3 Correction Finding G-6 + XZM-007A/B-4 Finding B4-G-4 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Peer-average comparison + fairness badge in StaffWorkProfile + consecutive-under-average flag |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting Owner approval |
| Next Action | Owner approval → scope confirmation |
| Conflict check | No XZM-014 elsewhere — SAFE |

### XZM-015 — Daily Three-Slot Operations Reporting *(proposed)*
| Field | Value |
|---|---|
| Module | hub_ops_reports + OperationsCollection |
| Category | CR + COP |
| Requirement | Add `report_slot` / `shift` field to `hub_ops_reports`; enforce morning/mid/night submissions |
| Business Objective | Match business rule of 3-times-daily hub ops reporting (B4-G-5) |
| Priority | P2 |
| Assigned AI | ChatGPT Backend Team (schema) + Claude (UI) |
| Dependencies | XZM-007A/B-3 Correction Finding G-7 + XZM-007A/B-4 Finding B4-G-5 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Migration adds slot column + UI prompts for missed slots |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting Owner approval |
| Next Action | Owner approval → backend contract |
| Conflict check | No XZM-015 elsewhere — SAFE |

### XZM-016 — Route Approval Push Notification *(proposed)*
| Field | Value |
|---|---|
| Module | route_plan_decide + push-send edge function |
| Category | COP + WA |
| Requirement | On route plan approval, automatically push notification to each assigned rider (currently manual "আবার পাঠান") |
| Business Objective | Rider gets today's assignment without hub manager re-sending (B4-G-3) |
| Priority | P2 |
| Assigned AI | ChatGPT Backend Team (RPC hook) + Claude (test) |
| Dependencies | XZM-007A/B-3 Correction Finding G-8 + XZM-007A/B-4 Finding B4-G-3 |
| Current Status | **PROPOSED** |
| Acceptance Criteria | Approval triggers `private.notify()` for every rider on the plan |
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting Owner approval |
| Next Action | Owner approval → backend contract |
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
| Test Evidence | — |
| Owner Approval | ⏳ pending |
| Commit / PR Link | — |
| GitHub Issue # | — |
| Deployment Status | N/A |
| Blockers | Awaiting Owner approval + XZM-008 column spec |
| Next Action | Owner approval → design XLSX export |
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
| Acceptance Criteria | (a) no file deleted; (b) updated central docs (TASK_TRACKER, AI_HANDOVER, CHANGELOG, DECISION_LOG, TEST_REPORT, RISK_REGISTER, PROJECT_CONNECTIONS); (c) new `audits/XZM-006`, `audits/XZM-007AB-3*`, `audits/XZM-007AB-4*` files; (d) new `RISK_REGISTER.md`; (e) no secrets; (f) zero trigger of repo-local path-scoped CI workflows (`website.yml`, `android-apk.yml`, `tests.yml` — all paths are code-dir scoped, PR touches only `docs/project-control/`); Netlify Deploy Preview + Cloudflare Workers preview builds **do** run per their respective Git integrations, producing isolated preview URLs — production domain untouched; (g) Draft PR open |
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

### Priority 01 — Master Module Control Center

- **Status** — REVIEW, draft implementation in PR #226. Production release remains gated.
- **Scope** — Route registry, Super Admin controls, restrictive role and hub rollout, Android and web navigation, release evidence, audit and rollback.
- **Evidence** — See the Priority 01 entry in TEST_REPORT and the migration and tests in [PR #226](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/226).
- **Release gate** — Complete the API and in-page function inventory, hosted DEMO acceptance, native Android verification, and integration checks against the final working-hub changes.
- **2026-11-28 Claude follow-up (handover from Codex limit exhaustion)** — Added Shared Hub Selector coordination in `releaseAccess.tsx`: hub for a release decision follows URL route params → any `?hub=` query → `useWorkHub` store → null (Super Admin role previews stay unscoped). Test `shared hub detection follows URL first, then workHub, and unscopes under Super Admin preview` added in `web/tests/moduleRelease.test.mjs`. Node suite 88/88 green locally.
- **Backend Release-Guard first expansion batch** — new migration `20261128070000_module_release_expansion.sql` wraps four more UI-facing RPCs (`fleet_board`, `fleet_waiting`, `att_sheet_save`, `hub_feed`) in the same guard pattern as the Codex eight, with matching assertions in `supabase/tests/99_release_control_expansion.sql` (published default, forward-flip blocking, rollback restoration, DEMO opt-in). Picks RPCs with zero internal callers in the migration tree so a future config flip can't silently break cross-RPC traffic.
- **Backend Release-Guard second expansion batch** — new migration `20261128070100_module_release_expansion_batch_2.sql` wraps 14 more vetted RPCs: `att_sheet_submit`, `att_days_save`, `att_month_get`, `att_month_sheet`, `att_month_submit`, `att_reopen_list`, `att_reopen_open`, `att_self_list` (module `attendance`); `da_accounts_history`, `da_assign_accountant`, `da_import_save` (module `accounts`); `wf_pending_hub_today`, `wf_pending_month` (module `workforce`); `hr_staff_join_request` (module `hr`). Same vet (p_hub first arg → resource-derived hub, no lookup; zero real internal callers in the migration tree; scalar/jsonb returns only — table returns deferred to a separate batch). Assertions in `supabase/tests/99_release_control_expansion_batch_2.sql` cover attendance disable, accounts testing + DEMO opt-in, workforce development, hr disable. Guarded count is now **26 RPCs** + the restrictive RLS on `public.route_day_plans`.
- **Open gates still carried (not closed in this session)** — remaining ~517 `public.*` RPCs for the full backend mapping (ChatGPT Backend Team Contract report pattern, batch-by-family to keep diffs reviewable; next tranches: table-returning RPCs like `att_days_list`, `hub_login_list`, `da_hub_employees`, `da_lookup_merchant`, `da_match_payment`; session-id-first RPCs that need a hub lookup like the `da_sheet_*`, `da_close_*` and `da_report_*` families; the `operation_*` Research Center RPCs once an `operation` module is seeded); Chromium + Capacitor Android fixtures and the Vite production build (session's outbound package allowlist refuses `npm ci`); Android device/emulator run; hosted UI DEMO acceptance (five role login → menu → dashboard → direct URL). PR #226 stays **DRAFT**; no merge, no production deploy performed from this session.
- **2026-11-28 Final Completion pass on staging** — `xzm-team-staging` is now fully seeded (150 modules, 3 DEMO hubs, five DEMO accounts: Super Admin, Zonal Manager, Hub Manager, Staff, Rider). Suites T1–T9 ran against staging through Supabase MCP as each DEMO account — **63 PASS / 0 FAIL / 0 regressions**. Covered: Super Admin gating (T1), write/history/preview gating (T2), snapshot visibility (T3), 7-stage lifecycle + publish/unpublish + rollback + stale-rev + unknown-key (T4), guard effect end-to-end with DEMO opt-in (T5), direct-URL / restrictive RLS on `route_day_plans` (T6), wrapper coverage on batch-1+2 RPCs (T7 — 18/18), audit history + service-role evidence + check-constraint rejection (T8 — 6/6), batch-3 table-returning wrapper applied + published-default reachable (T9.1-T9.6 — 6/6; T9.7-T9.14 equivalent to T7 by shared body).
- **Backend Release-Guard third expansion batch (table returns)** — new migration `20261128074000_module_release_expansion_batch_3.sql` wraps seven table-returning RPCs: `att_days_list` → `attendance`; `hub_login_list` → `hub.logins`; `da_hub_employees`, `da_hub_access`, `da_lookup_employee`, `da_lookup_merchant`, `da_match_payment` → `accounts`. Uses `returns table (…) … return query select * from private.X(…)` pattern instead of scalar `return`. Applied to staging; verified reachable at published default. Coverage with `supabase/tests/99_release_control_expansion_batch_3.sql`. Guarded count is now **33 `public.*` RPCs** + restrictive RLS on `public.route_day_plans`.
- **B-001 fix shipped in the same session** — DEMO-hub detection in `release_context` and `module_release_save` now matches both bare `demo` and prefixed `demo-%` codes. Migration `supabase/migrations/20261128073000_module_release_demo_hub_fix.sql`; applied to staging via Supabase MCP; production untouched (will apply through normal main-merge CI).
