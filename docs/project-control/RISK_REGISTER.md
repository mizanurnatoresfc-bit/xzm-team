# RISK_REGISTER

> Project-level risks that cross tasks. Each row: ID, severity, description, impact, mitigation, owner approval needed.
> First seeded by XZM-004R (2026-11-27).

---

## R-001 — Android Signing Key: Single Point of Failure

- **Severity:** CRITICAL
- **Source:** XZM-006 Backup & Recovery §2 row 5 / §5-1.
- **Description:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` live ONLY in GitHub Actions secrets. No off-platform backup is documented.
- **Impact:** If the GitHub org/repo is lost, no further compatible APK can be published. Existing installs will refuse to update because they verify the publisher signature; users must uninstall and reinstall — effectively a channel-wide reset.
- **Mitigation (not yet executed):** Export keystore to two encrypted off-GitHub locations (password manager vault + offline media). Document the export/import procedure. **Owner approval required before export is performed.**
- **Clarification (XZM-006 Deep Verification 2026-11-27):** GitHub Actions secrets are **write-only after creation** — the keystore cannot be exported from the secret store. Mitigation requires Owner to produce the **original** keystore file (Owner's laptop / backup drive / password manager). If no off-GitHub original exists, R-001 is **unmitigable** until a new signing chain is accepted (Play Store treats as different app, existing installs cannot update).
- **Status:** OPEN — tracked under XZM-006 action item #1 → new sub-task **XZM-006A**.

---

## R-002 — Legacy ERP App ID (`com.xzmteam.erp`)

- **Severity:** MEDIUM
- **Source:** CLAUD.txt §4.16 (ERP branding) + memory note (brand: only "XZM TEAM" is user-visible).
- **Description:** Android `appId` is `com.xzmteam.erp` (legacy "ERP" branding) while all user-facing strings are "XZM TEAM". Internal identifiers kept as-is intentionally (Netlify project `xzm-team-erp`, Supabase project `xzm-team-erp-dev`, Android package `com.xzmteam.erp`) because changing them breaks dependent features — Play Store continuity, Netlify deploy pipeline, Supabase connection strings, deep links.
- **Impact:** Any future attempt to rename the package or Netlify/Supabase identifiers is NOT a cosmetic rename — it breaks installed app updates (Play Store treats a new appId as a different app), changes all Supabase REST/Realtime URLs, and requires a new signing chain. A rebrand task MUST be scoped with a migration plan, dual-publish period, and user-communication plan.
- **Mitigation:** Do not rename these identifiers via a cosmetic task. Any rename requires a dedicated Task ID with migration plan + Owner approval + ChatGPT independent review + separate release strategy. CLAUD.txt §4.16 already requires "approved, verified task" for ERP-branding removal.
- **Status:** OPEN — no rename planned. Guardrail documented.

---

## R-003 — Supabase Migration Drift (14 migrations)

- **Severity:** HIGH
- **Source:** XZM-006 Backup & Recovery §3-1.
- **Description:** Live Supabase has 155 migrations applied; repo tracks 141 files. 14 migrations exist only in live DB (including `sync_live_functions`, `probe_delete`, `probe_alter`, `vehicle_ops_b1a`, `vehicle_ops_b2`, `vehicle_ops_c`, `vehicle_ops_d`, `vehicle_ops_fix_log_list`).
- **Impact:** Clean restore from repo migrations produces a schema that differs from live. Any disaster recovery that rebuilds from repo will not reproduce the live schema.
- **Mitigation (not yet executed):** Audit each orphan migration; either commit the migration file to `supabase/migrations/` or document a deliberate discard under an approved task.
- **Status:** OPEN — tracked under XZM-006 action item #3.

---

## R-004 — Two Edge Functions Have No Source in Repo

- **Severity:** HIGH
- **Source:** XZM-006 Backup & Recovery §3-2.
- **Description:** Live edge functions: `auth-login`, `admin-users`, `push-send`, `nodi-ai`, `nodi-route-plan`, `osm-fetch-places`. Repo has source for only the first four. `nodi-route-plan` and `osm-fetch-places` cannot be redeployed from GitHub.
- **Impact:** If the live function is deleted or corrupted, there is no source to redeploy from. Rebuild requires re-authoring.
- **Mitigation (not yet executed):** Export live function source via Supabase CLI and commit under `supabase/functions/`.
- **Status:** OPEN — tracked under XZM-006 action item #4.

---

## R-005 — No Cloudflare DNS Zone File Export

- **Severity:** HIGH
- **Source:** XZM-006 Backup & Recovery §2 row 14 / §5-2.
- **Description:** `xzmteam.com` DNS lives on Cloudflare; no exported zone file in repo or in an owner-controlled backup location.
- **Impact:** If the zone is deleted, mis-edited or transferred, there is no reference to rebuild DNS from. Fastest-path recovery (§4.6) requires an exported zone.
- **Mitigation (not yet executed):** Owner exports zone file from Cloudflare Dashboard → DNS → Advanced → Export → store encrypted copy; commit redacted version to `docs/dns/`.
- **Status:** OPEN — tracked under XZM-006 action item #2.

---

## R-006 — No Git Tags / Releases

- **Severity:** MEDIUM
- **Source:** XZM-006 Backup & Recovery §3-4.
- **Description:** Repo has zero `git tag`s. Every rollback must use commit SHA.
- **Impact:** No semantic "last known good" reference. Rollback mechanics work but are harder to communicate and audit.
- **Mitigation (not yet executed):** Tag current live `2836a07` as `v2026.11.27-live`; adopt per-release tagging policy.
- **Status:** OPEN — tracked under XZM-006 action item #6.

---

## R-007 — 7 Supabase Security Advisors

- **Severity:** MEDIUM (one ERROR, five WARN, one INFO)
- **Source:** XZM-006 Backup & Recovery §3-3; MCP `get_advisors` 2026-11-27.
- **Categories:** `rls_enabled_no_policy`, `security_definer_view`, `function_search_path_mutable`, `extension_in_public`, `anon_security_definer_function_executable`, `authenticated_security_definer_function_executable`, `auth_leaked_password_protection`.
- **Impact:** Not blocking recovery. Some are latent privilege-escalation risks (security_definer + mutable search path).
- **Mitigation (not yet executed):** File a dedicated security Task ID; address ERROR first.
- **Status:** OPEN — tracked under XZM-006 action item #8.

---

## R-008 — Documentation Dual Source of Truth

- **Severity:** HIGH
- **Source:** XZM-007A/B-3 Correction Finding G-A7-1, G-A7-2, G-A7-3.
- **Description:** Durable project knowledge dual-sourced between `claude/` and `docs/project-control/` — ChatGPT ও Claude উভয়ের জন্য source of truth ambiguity।
- **Mitigation (in-progress):** XZM-004R PR #213 consolidates all durable `claude/*` reports into `docs/project-control/` + ports Batch 4 report + reorganizes task tracker + risk register.
- **Resolution condition (all three required):**
  1. PR #213 merged to `main` after Owner approval।
  2. Claude's next session reads `docs/project-control/` from `main` and confirms single-source consistency।
  3. ChatGPT's independent read of the merged state confirms no stale `claude/*` reference remains authoritative।
- **Status:** **IN_PROGRESS — pending merge + both-AI read verification** *(corrected from premature "RESOLVED" during XZM-004R Review-Response, 2026-11-27)*।
- **Historical note:** Previous RISK_REGISTER.md labelled this as "RESOLVED on merge of XZM-004R" before merge happened — flagged by ChatGPT Independent Review as premature closure। Resolution label will only be set once all three conditions above hold।

---

## R-009 — No End-to-End Restore Drill

- **Severity:** MEDIUM
- **Source:** XZM-006 Backup & Recovery §2 (every "Restore tested" row is UNVERIFIED) / §5-7.
- **Description:** No documented restore drill from repo → disposable Supabase → preview Netlify.
- **Impact:** "Backup available" rows are plausible but unproven. Real recovery under pressure will be first-attempt.
- **Mitigation (not yet executed):** Schedule a dry-run restore under an isolated task.
- **Status:** OPEN — tracked under XZM-006 action item #7.

---

## Risk Review Cadence

- Reviewed by Owner + ChatGPT at each audit close.
- Any new CRITICAL or HIGH risk surfaced during a task MUST be added here before the task closes.

---

## Risk → Sub-task Mapping (XZM-006 Deep Verification, 2026-11-27)

| Risk | Current status | Resolution sub-task |
|---|---|---|
| R-001 CRITICAL — Android signing key SPOF | OPEN | **XZM-006A** |
| R-002 MED — Legacy ERP App ID | OPEN (guardrail documented) | — (no action planned) |
| R-003 HIGH — Supabase migration drift | OPEN | **XZM-006C** |
| R-004 HIGH — Missing edge function source | OPEN | **XZM-006E** |
| R-005 HIGH — No Cloudflare DNS export | OPEN | **XZM-006D** |
| R-006 MED — No git tags | OPEN | **XZM-006F** |
| R-007 MED — 7 Supabase security advisors | OPEN | **XZM-006H** |
| R-008 HIGH — Documentation dual source | IN_PROGRESS (merge done; both-AI read verification pending) | — (R-008 resolution step) |
| R-009 MED — No E2E restore drill | OPEN | **XZM-006B** + **XZM-006D** (restore drill combines DB + edge rollback) |

Supplementary Owner-input sub-tasks:
- **XZM-006B** — Supabase recovery coverage (PITR + Auth + Storage)
- **XZM-006G** — RPO/RTO Owner questionnaire + target definition
