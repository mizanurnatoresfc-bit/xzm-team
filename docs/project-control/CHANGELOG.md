# CHANGELOG

> Human-readable change log, reverse chronological। Follows task IDs।

---

## 2026-11-27 (XZM-004R-Final, after Second Review)

- **XZM-004R-Final — Second ChatGPT Independent Review Response:** PR #213 Draft-এ 5-point corrections applied —
  (1) Owner email removed from AI_HANDOVER §5; Cloudflare numeric account ID removed; PROJECT_CONNECTIONS §10 rewritten as a redaction policy + kept-identifier justification list.
  (2) Netlify Deploy Preview verified **DISABLED** (`netlify.toml` `ignore = "exit 0"`); Cloudflare Workers Git integration verified **NOT USED** (deploy via `android-apk.yml` only); Supabase preview branches = **none** (`list_branches` returned `[]`); binding isolation verified read-only without reading any secret values (items that required dashboard access marked UNVERIFIED).
  (3) TASK_TRACKER Section 1.2 allowed-status set expanded to match actual records (`UNDER_REVIEW`, `EVIDENCE_NOT_ON_FILE` now explicit); Section 3 schema line synced; XZM-007A/B-1/-2 status strings normalized to `EVIDENCE_NOT_ON_FILE`.
  (4) PR description rewritten to match GitHub-reported counts (4 commits / 20 files before Final commit; 5 / 21 after).
  (5) Merge-to-main impact documented in TEST_REPORT: zero production build/deploy trigger expected (workflow paths miss docs-only PRs; Netlify + Cloudflare deploy flow is inside `android-apk.yml`, which does not fire).
- **Status:** PR #213 remains Draft। No application code / database / production config changed। Awaiting Owner approval.

## 2026-11-27 (Review-Response, evening)

- **XZM-004R — ChatGPT Independent Review Response:** PR #213 Draft-এ 12-point corrections applied (no application code, no DB, no production config change) —
  (1) PR description-এ actual 19 changed files + 3 commits উল্লেখ।
  (2) XZM-006 duplicate record consolidated to one master.
  (3) XZM-001 = **ChatGPT Workspace Setup**; XZM-002 = **Claude Workspace Setup** — properly labelled.
  (4) `AI_HANDOVER.md` duplicate section numbers (5–8 twice) merged; new numbering 1–13 continuous.
  (5) Batch 4 report ported to `docs/project-control/audits/XZM-007AB-4_BATCH4_COURIER_OPS_AUDIT.md` with COMPLETE status (not "preliminary").
  (6) TASK_TRACKER-এর সব records 15-field schema-এ aligned; status ভাষা consistent (PROPOSED / UNDER_REVIEW / REVIEW / CLOSED).
  (7) "Zero Deployment Trigger Risk" dubbed down to "Zero trigger for repo-local CI workflows" and Netlify + Cloudflare Workers preview build-এর isolation acknowledged as a separate category.
  (8) Netlify Deploy Preview SUCCESS from PR #213 noted (ChatGPT verified); Cloudflare Workers preview URL also builds on push — docs-only PR expected safe but build run confirmed.
  (9) PROJECT_CONNECTIONS §10 added: operational identifiers (Supabase project ref, Netlify site ID, Cloudflare account ID, owner email) listed with Owner-review recommendation (not secrets, but public-repo exposure flagged).
  (10) `RISK_REGISTER.md` R-008 status changed from RESOLVED → **IN_PROGRESS — pending merge + both-AI read verification**.
  (11) `TEST_REPORT.md`, `DECISION_LOG.md`, `TASK_TRACKER.md`, `AI_HANDOVER.md`, `CHANGELOG.md` cross-synchronized with XZM-004R Review-Response entries.
  (12) XZM-010..017 all verified as PROPOSED.
- **Status:** PR #213 remains Draft. Awaiting Second ChatGPT Independent Review.

## 2026-11-27

- **XZM-004R:** Central Documentation Recovery & Synchronization — consolidated `docs/project-control-init` + `docs/xzm-005-task-tracker` + durable `claude/*` reports। নতুন ফাইল: `RISK_REGISTER.md`, `audits/XZM-006_BACKUP_RECOVERY.md`, `audits/XZM-007AB-3_BATCH3_ZONAL_DUTY_AUDIT.md`, `audits/XZM-007AB-3_BATCH3_CORRECTION.md`। `TASK_TRACKER.md`-এ XZM-006..017 যোগ। `AI_HANDOVER.md` verified-environment snapshot + risks + in-flight tasks। Owner decision: `docs/project-control/` = single source of truth; `claude/` = scratch। Draft PR, docs-only (web/**, supabase/** CI trigger নয়)।
- **XZM-007A/B-3:** Batch 3 Zonal Management & Employee Duty Audit (read-only at HEAD `2836a07`) — 29-item matrix, 5 gap items, 3 new findings, 3 folder-hygiene findings। Correction report after ChatGPT review।
- **XZM-006:** Backup & Recovery Verification (read-only) — 18-asset matrix, 14-migration drift, 7 recovery scenarios, 8 action items। CRITICAL: Android signing key single-point-of-failure flagged।
- **XZM-005:** `TASK_TRACKER.md` 15-field schema + 14 categories + XZM-001…009 records; `AI_HANDOVER.md` section 4.1 (Shared Task Tracker) added। Separate branch + Draft PR।
- **XZM-004:** `docs/project-control/` ফোল্ডার তৈরি — PROJECT_MASTER, PROJECT_CONNECTIONS, CURRENT_SYSTEM_MAP, COMPANY_RULES, REPORT_FORMATS, REQUIREMENTS, TASK_TRACKER, DECISION_LOG, AUDIT_REPORT, BUG_REGISTER, TEST_REPORT, CHANGELOG, DEPLOYMENT_LOG, AI_HANDOVER — 14 ফাইল seed। Existing `docs/` অপরিবর্তিত।
- **XZM-003 (partial):** GitHub + Supabase connection verified; Netlify / Cloudflare / Figma+Subframe pending।
- **Supabase:** New project `xzm-team-staging` (`mbpjvqeizwjjsvnbjerb`, ap-southeast-1) spotted — ownership confirmation PENDING।

## 2026-11-26

- Sidebar personal-rows rule shipped (PR #178)।

## 2026-11 (earlier)

- Route setup OSM load + draw area (PR #177)।
- HR page cleanup — `/app/hr/applications`, `/app/hr/leave`, `/app/hr` deleted; redirects to `/app/staff/list`, `/app/zonal/requests`, `/app/staff`।
- Staff consolidation → `/app/staff/list`।
- Attendance consolidation → `/app/workforce/hub`; old URLs redirect।
- NODI AI chat UI + edge functions `nodi-ai`, `nodi-route-plan`, `osm-fetch-places` deployed।
