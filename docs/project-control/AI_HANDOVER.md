# AI_HANDOVER

> ChatGPT ↔ Claude শেয়ার্ড context। প্রতিটি সেশন শুরুর আগে পড়তে হবে।

---

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

## Priority 01 — Master Module Control Center, 2026-11-28

- [Draft PR #226](https://github.com/mizanurnatoresfc-bit/xzm-team/pull/226) contains the persistent registry and control center. Enter from the Super Admin dashboard or through `/app/module-control`. Enforce normal auth and password recovery before entering. The database checks the real Super Admin grant.
- Add each future route to `web/src/lib/moduleRelease.ts` and seed each new module and parent using a forward migration. New database registry rows default to Planning. Wire new endpoints into the release guard with the resource's real hub and retain the endpoint's existing authorization.
- The app uses the selected platform and reads current release decisions from Supabase. A user's last successful decision can be used offline. Guarded operations must pass the current server policy when they reconnect.
- Eight guarded RPC signatures cover Nodi gates and selected route planning operations. `route_day_plans` adds a restrictive RLS policy. Direct APIs share credentials across web and Android, so guarded endpoints require both platform switches. Continue the API mapping and test shared or delegated permissions before enabling broad production controls.
- DEMO derives from a verified active hub whose code is `DEMO` and from the caller's actual assignments. Current page-level hub detection covers explicit hub-operations and route planning links, and unambiguous single-hub assignments. Hook other hub selectors and evaluate their resource APIs before broad DEMO rollout.
- The evidence collector verifies GitHub workflow and deployment status for the PR commit with `scripts/record-module-release.mjs`. It writes to the explicitly selected Supabase origin using the service role. GitHub deployments use the environment names `preview` and `production`. Browser administrators can review evidence and cannot record it.
- Keep the PR in draft until outstanding checks in TEST_REPORT pass. Coordinate shared files with PRs #219, #222, #224 and #225. Website rollout depends on the Supabase migration being in place.

### Priority 01 — 2026-11-28 Claude follow-up (Codex limit exhausted)

- **Why Claude is on this PR now** — Owner-directed handover after ChatGPT (Codex) hit its session limit, overriding the usual backend split for this task only. Frontend/UI and integration work is still Claude's; wholesale backend expansion (wrapping each of ~543 `public.*` RPCs in a release-guard) stayed with the ChatGPT Backend Team pattern and was not attempted in a single chat turn.
- **What landed in this follow-up** — Shared Hub Selector coordination in `web/src/lib/releaseAccess.tsx`: hub for a release decision now follows (1) explicit route-plan or hub-ops URL params → (2) any page's `?hub=` query → (3) `useWorkHub(user)` localStorage store (the global header's selector) → (4) null. Super Admin role previews continue to run unscoped. A new standalone contract test `shared hub detection follows URL first, then workHub, and unscopes under Super Admin preview` was added to `web/tests/moduleRelease.test.mjs` (no ts-loader needed).
- **Local verification this session** — Node test suite 88/88 PASS (`moduleRelease 4/4`, `navAccess 16`, `routeModule 22`, `routePlan 16`, `routeOffline 19`, `reportParser 11`). TypeScript build, Vite production bundle, Playwright fixtures, Capacitor Android sync, and the Supabase SQL assertions were **not** re-run: `npm ci` is blocked by the session's outbound proxy allowlist, and `xzm-team-staging` has 0 tables so the SQL suite has nothing to run against yet.
- **PR #226 remains DRAFT**. No merge, no production migration, no production deploy was performed from this session. Original release gates from Codex's draft still apply.
- **Next session** — Push gate closure through CI (which does have package access) plus a staging DB init before DEMO acceptance can be meaningfully run. Backend Release-Guard expansion beyond the current 12 guarded RPCs stays a per-family Contract report job, not a single bulk migration.

### Priority 01 — 2026-11-28 second Claude pass: first backend expansion batch

- **Added migration** `supabase/migrations/20261128070000_module_release_expansion.sql`: wraps `fleet_board(uuid)`, `fleet_waiting(uuid)`, `att_sheet_save(uuid, date, jsonb)`, `hub_feed(uuid, timestamptz, integer)` in the same `alter … set schema private; create public wrapper { module_release_require(module, hub) + return private.X(…) }; revoke/grant` pattern Codex used. Picks four RPCs that have **zero internal callers in the migration tree**, so no cross-RPC call path is routed through the guard. Modules used: `fleet` (x2), `attendance`, `hub` — all already in the Codex seed with `legacy_live = true`, so guarded RPCs stay transparent until Super Admin flips their stage.
- **Added SQL suite** `supabase/tests/99_release_control_expansion.sql`: assertions cover (1) published default stays reachable for a DEMO-assigned manager, (2) forward flip to development/testing/disabled refuses with 42501, (3) rollback via `module_release_save(p_rollback)` restores access, (4) DEMO opt-in under testing lets the DEMO manager through while a non-DEMO hub stays blocked.
- **Guarded count is now 12 `public.*` RPCs + restrictive RLS on `public.route_day_plans`.** ~531 remaining public RPCs belong to the ChatGPT Backend Team Contract report pattern (per-family batches, not a single migration), because many have internal callers, table returns, or session-id-only arguments that each need a per-function decision.
- **Still blocked this session** — SQL suite rerun (no isolated Postgres; staging empty), `npm ci`, Vite build, Playwright, Capacitor Android sync. Awaiting GitHub CI for the full green loop.

### Priority 01 — 2026-11-28 third Claude pass: backend expansion batch 2

- **Added migration** `supabase/migrations/20261128070100_module_release_expansion_batch_2.sql`: 14 more RPCs wrapped — `att_sheet_submit`, `att_days_save`, `att_month_get`, `att_month_sheet`, `att_month_submit`, `att_reopen_list`, `att_reopen_open`, `att_self_list` (module `attendance`); `da_accounts_history`, `da_assign_accountant`, `da_import_save` (module `accounts`); `wf_pending_hub_today`, `wf_pending_month` (module `workforce`); `hr_staff_join_request` (module `hr`). Same vet as batch 1 (p_hub first arg, zero real internal callers, scalar/jsonb returns only).
- **Added SQL suite** `supabase/tests/99_release_control_expansion_batch_2.sql`: assertions for attendance disable blocking every attendance wrapper, rollback restoration, accounts testing + DEMO opt-in letting the DEMO manager through while non-DEMO hubs stay blocked, and workforce/hr flip blocks.
- **Guarded count is now 26 `public.*` RPCs** + restrictive RLS on `public.route_day_plans`. ~517 remaining public RPCs for future Contract-report batches.
- **Deferred to a separate batch (by design, not oversight):** table-returning RPCs (`att_days_list`, `hub_login_list`, `da_hub_employees`, `da_lookup_merchant`, `da_match_payment` …) need a `returns table (…) … return query` wrapper and an exact column-list copy, so they need their own careful pass; session-id-first RPCs (`da_sheet_*`, `da_close_*`, `da_report_*`) need a session→hub lookup helper before the guard check; `operation_*` RPCs need an `operation` module seeded in `release_module` first.
