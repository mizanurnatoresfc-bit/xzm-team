# CHANGELOG

## XZM-010 Problem Center

Added workflow navigation, issue history and on-demand reports to the existing Issues route. Deadline submissions now interpret local inputs in Asia/Dhaka. SQL draft and rollback are filed under the XZM-010 audit.


> Human-readable change log, reverse chronological। Follows task IDs।

---

## 2026-11-27 (XZM-006A + XZM-006B Critical Backup Recovery — docs + read-only verification)

- **XZM-006A — Android Signing Key** audit doc added: `docs/project-control/audits/XZM-006A_ANDROID_SIGNING_KEY.md`. Covers (a) six-location Owner checklist for finding the original keystore; (b) `apksigner verify --print-certs` fingerprint extraction from the public live APK + `keytool -list -v` match verification against any found `.jks`; (c) GPG-AES256 encrypted bundle (keystore + keystore.properties + README) stored in two independent locations (password-manager vault + offline media), with passphrase kept separately. Cites `.github/workflows/android-apk.yml` lines 115–140 and 171–196 for the production signer-match logic. XZM-006A status → UNDER_REVIEW; follow-up XZM-006A-impl opens helper scripts + PROJECT_CONNECTIONS.md §11 fingerprint record.

- **XZM-006B — Supabase Backup Plan** audit doc added: `docs/project-control/audits/XZM-006B_SUPABASE_BACKUP_PLAN.md`. Production project identified as `ndgnhvbpmtxrpplgsslz` via 8 cross-matched read-only MCP signals (181 tables all RLS-enabled, 1 view, 468 RPC functions, 255 policies, 7 private Storage buckets, 40 objects ~5.5 MB, 85 auth users, ~200 MB DB, Edge Function set matches `web/` call sites). Three-layer backup plan: (A) daily GitHub Actions `supabase db dump` → GPG-AES256 → Cloudflare R2 (primary) + GitHub Releases (secondary); (B) parallel Storage object snapshot per bucket; (C) Owner's weekly doc snapshot of Auth/SMTP/providers/hooks/Edge Function secret names/Realtime config under `docs/project-control/supabase-config/`. Plan options compared: Free + Layer A/B/C ($0), Pro ($25/mo), Pro + PITR 7d ($125/mo); recommendation at today's scale is Free + A/B/C, with Pro recommended once DB > 500 MB. Retention: 14 daily / 12 weekly / 12 monthly. XZM-006B status → UNDER_REVIEW; follow-up XZM-006B-impl opens the workflow + supabase-config/ folder + PROJECT_CONNECTIONS.md §10.

- **Scope kept constant:** docs-only inside `docs/project-control/`. Read-only MCP SELECT queries against production for sizing only; no `apply_migration`, no `execute_sql` writes, no Storage object bytes read, no Edge Function deploy, no secret rotation, no GitHub Actions secret read, no production change.

- **Status:** Draft PR `docs/xzm-006ab-critical-backup-recovery`, awaiting ChatGPT Independent Review → Owner approval of §7 action items in each audit doc, then follow-up implementation PRs (XZM-006A-impl, XZM-006B-impl).

---

## 2026-11-27 (XZM-006 Deep Verification + 6-Point Correction Pass, post-merge)

- **XZM-006 — Backup & Recovery Deep Verification (Draft PR):** Per ChatGPT Independent Review (PARTIAL — EVIDENCE REQUIRED), the central audit `docs/project-control/audits/XZM-006_BACKUP_RECOVERY.md` is rewritten from a 5-section summary into a full 11-section deep-verification document carrying: 18-asset matrix with 5-tier status (BACKUP AVAILABLE / RESTORE TESTED / UNVERIFIED / MISSING / ACCESS REQUIRED); 7 disaster-recovery procedures in full; Android signing-key reverification acknowledging GitHub Actions secrets are write-only after creation (not directly exportable); Supabase PITR/Auth/Storage coverage gap-analysis; live-vs-repo migration drift; missing edge functions recovery feasibility (`nodi-route-plan`, `osm-fetch-places`); Cloudflare + Netlify rollback; Preview↔Production isolation (VERIFIED read-only); per-system RPO/RTO gap-analysis. Introduces proposed sub-tasks **XZM-006A..I** (letter-suffix namespace, no conflict with XZM-### numeric IDs). Updates TASK_TRACKER, RISK_REGISTER (R-001 clarification on GitHub secret write-only + Risk→Sub-task mapping table), AUDIT_REPORT, AI_HANDOVER.

- **6-Point Correction Pass (same PR, following Owner review):** The deep-verification document is corrected on six factual / scope points:
  1. **Supabase Free-plan PITR claim withdrawn.** Per <https://supabase.com/pricing> and <https://supabase.com/docs/guides/platform/backups>, the Free plan has **neither PITR nor automatic daily backups**. PITR is a paid add-on on Pro/Team/Enterprise only. §2 row 6, §4.2, §6.2 and §6.7 of the audit are rewritten to reflect this. Mitigation path changed from "confirm 7-day PITR window" to "scheduled `pg_dump` + plan-upgrade decision" (XZM-006B re-scoped).
  2. **Missing Edge Functions — recovery feasibility re-verified.** Per <https://supabase.com/docs/guides/troubleshooting/transfer-edge-function-from-one-project-to-another> and <https://supabase.com/docs/guides/functions/quickstart-dashboard#download-edge-functions>, `supabase functions download` (CLI) and the Dashboard Download button can retrieve deployed source. §3.2 / §6.4 upgraded from "impossible to redeploy from GitHub" to **BACKUP AVAILABLE via CLI**. XZM-006E re-scoped from "re-author from scratch" to "retrieve → review → commit".
  3. **Migration drift re-computed version-by-version** (replaces simple `155 − 141 = 14` arithmetic). Live has 154 unique timestamps / 154 names; repo has 138 unique timestamps / 141 names. 124 live timestamps are absent from repo; 108 repo timestamps are absent from live; only the first 30 share version IDs. By name: 29 live-only + 16 repo-only. XZM-006C re-scoped as a per-migration decision pass owned by ChatGPT Backend Team.
  4. **Preview isolation and actual production DB binding split into §5.1 and §5.2.** Preview isolation remains VERIFIED. Production-binding verification is only PARTIALLY VERIFIED — the audit's mechanical check that `VITE_SUPABASE_URL` in Netlify Site Settings points to `ndgnhvbpmtxrpplgsslz` remains ACCESS REQUIRED; added as XZM-006B sub-items along with an explicit "production despite its name" annotation for `xzm-team-erp-dev`.
  5. **Owner-identifiable local path redacted** from §3.3 keystore table, §4.7 GitHub-unavailable scenario, and §10 evidence index, per the XZM-004R-Final redaction policy. The path now lives only in Owner's private records / `PROJECT_CONNECTIONS.md`.
  6. **New sub-task XZM-006I — Isolated Backup Restore Test** added to §7 and §8. Scope: one end-to-end drill (dump → restore to staging → deploy edge functions → preview Netlify bound exclusively to staging → smoke test → tear down), with the hard constraint that no step shares secrets, domains or env vars with production. Depends on XZM-006B + XZM-006E.

- **Status:** Draft PR, docs-only. No application code, database, DNS, production config or secret changed. No restore drill performed. No live Edge Function source downloaded in this pass. Awaiting ChatGPT Independent Second Review → Owner approval for XZM-006A..I as separate PRs.

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
