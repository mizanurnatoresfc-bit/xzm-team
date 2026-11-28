# AI_HANDOVER

> ChatGPT ↔ Claude শেয়ার্ড context। প্রতিটি সেশন শুরুর আগে পড়তে হবে।

---

## Hub Registers handover · 2026-11-28

- XZM-018 is in [Draft PR #225](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/225) on `chatgpt/hub-registers-release`. The existing `/app/hub-registers` route serves the employee forms, manager dashboard and zonal controls. The global working-hub selection is resolved against the authorized list.
- `hub_register_read` and `hub_register_write` use the company employee and permission models. The four private workflow tables hold assignments, supplemental entries, reviews and events. Existing attendance, daily operations, pending snapshots and Accounts records remain the source when present. An Accounts claim and the linked expense line are counted once on the bill date.
- Active hub employees are included by default. An employee rule takes priority over a position rule and a hub default. An applicable employee without activity can report zero. Deadlines use Dhaka local time, and late entry remains possible while the register is open.
- Final submission preserves the reviewed roster and totals. Reopening requires scoped configuration permission and a reason. Admin retains the permissions needed to delegate the existing Hub Manager and Zonal Manager roles. Monthly reporting uses the latest locked version for each day and book. Pending is shown as a daily snapshot.
- Isolated verification uses `scripts/test-db.sh` and `node tests/hubRegisters.mjs` after building `web`. The simulated merge with #219 at `ce4683d` passed 2,843 isolated PostgreSQL assertions. The browser test fakes API data and includes an Android bridge fixture. A live DEMO session, real Android WebView and production compatibility still need verification before release. The draft has no production migration execution or deployment.

## 1. Project Snapshot

- Project: **XZM TEAM** — supporting Zonal Courier Ops Tool।
- Production: https://xzmteam.com (Web + Android)।
- Repo: https://github.com/mizanurnatoresfc-bit/xzm-team (public)।
- Timezone: Asia/Dhaka।
- Primary UI language: বাংলা।

## 2. Who Does What

| Role | Owner |
|---|---|
| Final approval, deployment authorization | Project Owner |
| Product direction, audit, QA, independent review | ChatGPT |
| Frontend, UI/UX, integration implementation, bug fix | Claude |
| Backend (schema, RLS, migrations) | ChatGPT Backend Team (via Contract report) |

## 3. Documentation Canon

Single source of truth lives in **`docs/project-control/`** on `main`। Order of precedence:

1. `PROJECT_MASTER.md` — identity & objectives
2. `PROJECT_CONNECTIONS.md` — live status of GitHub/Supabase/Netlify/Cloudflare/Figma/Subframe
3. `CURRENT_SYSTEM_MAP.md` — modules, routes, tables, RPCs, edge functions
4. `COMPANY_RULES.md` — business rules & flows
5. `REPORT_FORMATS.md` — Excel report catalogue
6. `REQUIREMENTS.md` — open requirements
7. `TASK_TRACKER.md` — task IDs, status, PR links
8. `DECISION_LOG.md` — architectural & product decisions
9. `AUDIT_REPORT.md` — audit findings
10. `BUG_REGISTER.md` — open bugs
11. `TEST_REPORT.md` — per-task test evidence
12. `CHANGELOG.md` — human-readable change log
13. `DEPLOYMENT_LOG.md` — production deployments
14. `AI_HANDOVER.md` — this file
15. `RISK_REGISTER.md` — project-level cross-task risks *(added XZM-004R)*
16. `audits/` — per-task audit evidence files *(added XZM-004R)*
    - `XZM-006_BACKUP_RECOVERY.md`
    - `XZM-007AB-3_BATCH3_ZONAL_DUTY_AUDIT.md`
    - `XZM-007AB-3_BATCH3_CORRECTION.md`
    - `XZM-007AB-4_BATCH4_COURIER_OPS_AUDIT.md` *(ported in XZM-004R Review-Response, 2026-11-27)*

Existing `docs/*.md` (pre-tracker) **রাখতে হবে**, overwrite নয়।

**Owner decision (2026-11-27 — XZM-004R):** `docs/project-control/` হবে **একমাত্র স্থায়ী** Central Knowledge Base। `claude/` folder শুধুমাত্র temporary session workspace; durable report-গুলো XZM-004R-এ এখানে consolidated।

## 4. Communication Protocol

- Approved task না পাওয়া পর্যন্ত কোনো implementation নয়।
- Each task → একটি PR + corresponding entries in TASK_TRACKER, CHANGELOG, TEST_REPORT, DEPLOYMENT_LOG (deploy হলে)।
- Draft PR default; owner approval-এর পর ready-for-review।
- কোনো unrelated change একই task-এ মেশানো নয়।

### 4.1 Shared Task Tracker (set in XZM-005)

- **Master context:** `docs/project-control/TASK_TRACKER.md` (15-field schema, 14 categories)।
- **Live status / assignment / comments:** GitHub Issues (https://github.com/mizanurnatoresfc-bit/xzm-team/issues)।
- Conflict হলে **GitHub Issues = live state**, markdown = durable context।
- Owner বা ChatGPT কোনো task-কে issue বানালে title-এ `[XZM-###]` prefix রাখবেন; issue number markdown-এর `GitHub Issue #` field-এ update হবে।
- প্রতিটি কাজের শেষে বাধ্যতামূলকভাবে update: `TASK_TRACKER.md`, `AI_HANDOVER.md` (যদি protocol পরিবর্তন হয়), `CHANGELOG.md`, এবং deploy হলে `DEPLOYMENT_LOG.md`।
- প্রমাণ (commit SHA / PR link / TEST_REPORT entry) ছাড়া কোনো task **VERIFIED / CLOSED** চিহ্নিত হবে না।

## 5. Verified Environment Snapshot (2026-11-27, from XZM-006)

| Item | Value |
|---|---|
| HEAD commit on main | `2836a07` (PR #208) |
| Web source | `web/` (React 19 + Vite + TS + Capacitor) |
| Android | Capacitor, `appId = com.xzmteam.erp`, native generated at build time |
| Supabase | `ndgnhvbpmtxrpplgsslz` = `xzm-team-erp-dev`, PG 17.11, ap-southeast-1, ACTIVE_HEALTHY |
| Supabase (staging) | `mbpjvqeizwjjsvnbjerb` = `xzm-team-staging` (created 2026-11-27) |
| Live migrations | 155 in DB vs 141 in repo (14 drift — R-003) |
| Edge Functions live | `auth-login`, `admin-users`, `push-send`, `nodi-ai`, `nodi-route-plan`, `osm-fetch-places` |
| Edge Functions in repo | first four only (two missing — R-004) |
| Netlify site | `xzm-team-erp` id `2909a0bd-55bc-4b11-930f-73750fb34bd4`, Free plan |
| Live URL | `https://xzmteam.com` |
| Cloudflare | Workers service `xzm-team` under Owner's Cloudflare account, deployed from `wrangler.jsonc` in repo root (account email + ID held off-repo per XZM-004R-Final redaction policy) |
| CI workflows | `android-apk.yml` (main push + workflow_dispatch), `website.yml` (PR), `tests.yml` (PR + main push) — all path-scoped to code dirs |

## 6. Open Risks (summary — full in `RISK_REGISTER.md`)

- **R-001 CRITICAL** — Android signing key single point of failure.
- **R-002 MED** — Legacy ERP App ID guardrail (`com.xzmteam.erp`).
- **R-003 HIGH** — Supabase migration drift (structural, both directions — see RISK_REGISTER R-003 and XZM-006 §3.1).
- **R-004 HIGH** — 2 edge functions missing source in repo.
- **R-005 HIGH** — No Cloudflare DNS zone export.
- **R-006 MED** — No git tags.
- **R-007 MED** — 7 Supabase security advisors.
- **R-009 MED** — No E2E restore drill.

## 7. In-flight Tasks (see TASK_TRACKER.md for full detail)

- **XZM-003** IN_PROGRESS — connection verification (Figma/Subframe pending).
- **XZM-004** REVIEW — central docs seed PR #211.
- **XZM-004R** REVIEW — this consolidation PR.
- **XZM-005** REVIEW — task tracker schema PR.
- **XZM-006** UNDER_REVIEW — backup & recovery.
- **XZM-007A/B-1, -2** EVIDENCE NOT ON FILE — re-audit pending.
- **XZM-007A/B-3, -4** UNDER_REVIEW — Batch 3 & Batch 4 audits (both reports now in `docs/project-control/audits/`; Batch 4 ported in XZM-004R Review-Response).
- **XZM-010..013** PROPOSED — from Batch 3 G-1..G-4.
- **XZM-014..017** PROPOSED — new from Batch 3 Correction G-6..G-8 + Q.3.11.
- **XZM-006A UNDER_REVIEW** — Android Signing Key audit doc delivered (`docs/project-control/audits/XZM-006A_ANDROID_SIGNING_KEY.md`); procedure covers (a) six-location Owner search checklist, (b) `apksigner verify --print-certs` fingerprint extraction + `keytool -list -v` match verification, (c) GPG-AES256 encrypted bundle in two independent locations. Awaiting Owner execution of §2 location checks; follow-up XZM-006A-impl opens helper scripts + PROJECT_CONNECTIONS.md §11.
- **XZM-006B IN_PROGRESS** — ChatGPT Work owns implementation and verification in [#216](https://github.com/mizanurnatoresfc-bit/xzm-team/issues/216), following Claude's merged audit in #215. Owner approved Supabase Free and private R2 with 14 daily, 12 weekly and 12 monthly copies on 2026-11-27 (Asia/Dhaka). R2 is active and the Standard backup bucket was verified private. Scoped backup credentials and effective Supabase URL verification are pending. Backup workflow and first run remain pending. Full restore drill stays under XZM-006I.
- **XZM-006C..I** PROPOSED — Migration drift reconciliation (C), Cloudflare DNS + rollback runbook (D), Missing edge functions source via `supabase functions download` (E), Git tag policy (F), RPO/RTO Owner questionnaire (G), 7 security advisors remediation (H), Isolated Backup Restore Test (I).
- **XZM-006J, XZM-006K PROPOSED (new 2026-11-27 ~22:57 Asia/Dhaka)** — Flagged in `XZM-006B_SUPABASE_BACKUP_PLAN.md §8a` after `cloudflare-workers-and-pages[bot]` posted a "Deployment successful!" preview comment on docs-only PR #215 commit `73a4fa08`, contradicting the merged XZM-006 §5.1 claim "Cloudflare Workers Git integration NOT USED". Actual state: Cloudflare Workers Git integration is active; every push (including docs-only branches) triggers a preview build served on `*.mizanurnatore-sfc.workers.dev`. Domain-layer isolation holds; data-layer isolation depends on whether `VITE_SUPABASE_URL` is set in the Cloudflare project's build env — if it is production, preview visitors' actions reach production Supabase under their RLS grants. XZM-006J = revise XZM-006 §5.1 on main; XZM-006K = Owner picks between (1) disable Git integration, (2) rebind preview to staging Supabase, or (3) accept + document. Follow-up PRs opened after Owner decision.

## 8. Current Blockers

- ChatGPT Independent Review pending on XZM-006 and XZM-007A/B-3.
- Owner decision pending on: Batch 1/2 re-audit vs cancel; XZM-010..017 approvals; XZM-006 §5 action items.

## 9. Next Action

- ChatGPT: Independent Review of XZM-004R, XZM-006, XZM-007A/B-3, XZM-007A/B-4 on this PR (second review after XZM-004R Review-Response corrections of 2026-11-27).
- Owner: approval decision after ChatGPT review.
- Claude: hold on implementation until approved Task ID lands.

## 10. Secrets Policy

- কখনো commit নয়।
- Supabase service-role / ANTHROPIC_API_KEY / Netlify tokens — নিজ নিজ dashboard-এ রক্ষিত।
- Repo-র `.gitignore` + Netlify/Supabase/Cloudflare environment variables ব্যবহার।
- Operational identifiers (Supabase project ref, Netlify site ID, Cloudflare account ID, owner email) — public identifier, secret নয়; কিন্তু XZM-004R Review-Response-এ operational-security review-এর জন্য flag করা (see PROJECT_CONNECTIONS §10)।

## 11. Currently Known Gaps (as of 2026-11-27)

- Netlify, Cloudflare, Figma, Subframe পূর্ণাঙ্গ verification incomplete → XZM-003।
- Android source path & build version → PENDING।
- Supabase `xzm-team-staging` ownership confirmation → PENDING।
- Full table + RLS inventory → PENDING (XZM-007 scope)।
- End-to-end restore drill → PENDING (R-009)।

## 12. Session Hand-off Checklist (both AIs)

Before starting a task:
1. Read latest `TASK_TRACKER.md` + `DECISION_LOG.md` tail।
2. Confirm approved task ID + requirement।
3. Inspect existing code before proposing change (CLAUD.txt rule 1)।
4. No production write without owner approval।
5. Write evidence in `TEST_REPORT.md` before claiming done।
6. Append entry to `CHANGELOG.md` and (if applicable) `DEPLOYMENT_LOG.md`।

## 13. Do-Not List

- No credentials in commits/docs।
- No duplicate modules।
- No silent removal of existing features।
- No branding drift (XZM TEAM only, ERP suffix gone from UI)।
- No business-rule change without approved task।
- No "RESOLVED" label on a risk until merge + both-AI read verification (R-008 lesson, XZM-004R Review-Response)।
