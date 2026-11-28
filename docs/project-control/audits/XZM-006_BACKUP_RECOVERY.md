# XZM-006 — Backup & Recovery Deep Verification

**Status:** UNDER_REVIEW — Deep verification + 6-point correction pass complete 2026-11-27; awaiting ChatGPT Independent Second Review → Owner approval
**Date:** 2026-11-27 (Asia/Dhaka)
**Mode:** Read-only — no code, DB, DNS, production config or secret change.
**Source HEAD (first pass):** `2836a07a96d5053938fdaed6bff22273558e7977`
**Current HEAD (deep verification pass):** `24b348d37e2e0b38e427dac97916f356af4a0244` (post-XZM-004R merge)

> **Review history:**
> - 2026-11-27 — First summary (XZM-004R consolidation) merged with central-doc copy.
> - 2026-11-27 — ChatGPT Independent Review: **PARTIAL — EVIDENCE REQUIRED.** Full 18-asset matrix + 7 DR procedures demanded in central doc; off-platform signing-key backup claim to be verified without assuming GitHub Actions secret can be exported; RPO/RTO + sub-task breakdown required.
> - 2026-11-27 (deep verification pass) — Full matrix + procedures + verification items + sub-tasks XZM-006A..H recorded; this file replaced the earlier summary verbatim and extended it.
> - 2026-11-27 (this 6-point correction pass) — Owner-directed corrections applied: (1) Supabase Free-plan PITR claim corrected against official docs — Free plan has **neither PITR nor automatic daily backups**; (2) Missing Edge Function recovery re-verified — CLI `supabase functions download` and Dashboard Download button CAN retrieve deployed source, upgrading §3.2 / §6.4 from "no API retrieval possible" to **BACKUP AVAILABLE via CLI**; (3) Migration drift re-computed version-by-version — simple `155 − 141 = 14` arithmetic replaced with actual set-diff showing structural divergence (see §3.1); (4) Preview isolation vs. actual production DB binding split into two separate sub-sections (see §5); (5) Owner-identifiable local path redacted from §3.3 / §4.7 / §10; (6) new sub-task **XZM-006I — Isolated Backup Restore Test** added to §7 / §8.

---

## Legend — Status marking (5-tier)

| Tag | Meaning |
|---|---|
| **BACKUP AVAILABLE** | A copy / snapshot / export exists in a known location |
| **RESTORE TESTED** | An actual restore drill has been performed and documented |
| **UNVERIFIED** | Claim is plausible from configuration but not independently confirmed |
| **MISSING** | No copy / no procedure / no drill — confirmed absent |
| **ACCESS REQUIRED** | Confirmation needs Owner-controlled dashboard or secret, not available in this read-only session |

---

## 1. Verified environment

| Component | Identity | Status |
|---|---|---|
| GitHub repo | `mizanurnatoresfc-bit/xzm-team` (public) | **BACKUP AVAILABLE** (git proxy read; local clone) |
| Active branch | `main` (HEAD `24b348d` after XZM-004R merge; pre-merge `2836a07`) | VERIFIED |
| Tags / Releases | **none** | **MISSING** (empty `git tag -l`) |
| Web source | `web/` — React 19 + Vite + TypeScript + Capacitor | BACKUP AVAILABLE |
| Android source | Capacitor wrapper of `web/`; `appId: com.xzmteam.erp`; native `android/` generated at build time | BACKUP AVAILABLE (via `make-android.bat` + workflow) |
| Supabase project (dev) | `ndgnhvbpmtxrpplgsslz` = `xzm-team-erp-dev`, Postgres 17.11, ap-southeast-1, `ACTIVE_HEALTHY` | VERIFIED via `get_project` |
| Supabase project (staging) | `mbpjvqeizwjjsvnbjerb` = `xzm-team-staging`, Postgres 17.12, ap-southeast-1, `ACTIVE_HEALTHY` (created 2026-11-27) | VERIFIED via `list_projects` |
| Supabase org | `retfmhtmhhyupfbwjcvd` | VERIFIED |
| Supabase migrations | **155 live** vs **141 files in repo** | VERIFIED — see §3 drift |
| Supabase Edge Functions | `auth-login`, `admin-users`, `push-send`, `nodi-ai`, `nodi-route-plan`, `osm-fetch-places` — all ACTIVE | VERIFIED (6 live via `list_edge_functions`) |
| Edge Function source in repo | 4 of 6 (`auth-login`, `admin-users`, `push-send`, `nodi-ai`) | VERIFIED |
| Netlify site | `2909a0bd-55bc-4b11-930f-73750fb34bd4` = `xzm-team-erp`, team `6af6ede1f8132f436a4e98b6`, plan `nf_team_dev` | VERIFIED |
| Live URL | `https://xzmteam.com` (current deploy `6b071e18955520628c7d0bb0` state `ready`) | VERIFIED |
| Cloudflare | Owner's Cloudflare account; Workers service `xzm-team` via `wrangler.jsonc` | VERIFIED (connection only); zone/DNS backup not verified |
| CI/CD workflows | `.github/workflows/website.yml`, `android-apk.yml`, `tests.yml` | VERIFIED |

---

## 2. Full 18-asset Backup / Restore matrix

| # | Asset | Backup available | Restore tested | Notes |
|---|---|---|---|---|
| 1 | GitHub source + history | **BACKUP AVAILABLE** (GitHub remote + Owner's local clone) | **UNVERIFIED** | No documented clean-clone restore drill. |
| 2 | Release tags | **MISSING** | — | Repo has zero tags. Every rollback must use commit SHA. |
| 3 | Web `dist` artifact | **BACKUP AVAILABLE** (GitHub Actions artifact `site-dist`, 30-day retention) | **UNVERIFIED** | Can be dragged onto Netlify dashboard manually. |
| 4 | Android APK (live) | **BACKUP AVAILABLE** — `https://xzmteam.com/download/XZM-TEAM.apk` + `apk.json`; preserved across builds by `scripts/keep-live-apk.sh`; GitHub artifact `XZM-TEAM-apk` retained 30 days | **UNVERIFIED** | APK history before current live build not retained off-GitHub. |
| 5 | Android signing key | **ACCESS REQUIRED** — exists ONLY in GitHub Actions secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). **GitHub Actions secrets are WRITE-ONLY after creation — they cannot be exported via API or UI.** | **ACCESS REQUIRED** | **CRITICAL — see §3.3.** The original keystore file must live in a location the Owner controls off-GitHub (locally, on offline media, or in a password manager). If no such copy exists, the secrets are the only extant copy and recovery from GitHub loss is impossible. Owner-controlled verification required. |
| 6 | Supabase database (automatic) | **MISSING on Free plan** per Supabase official docs — Free plan has **neither PITR nor automatic daily backups**; users are directed to run `supabase db dump` manually. Automatic daily backups start at Pro (7 d), Team (14 d), Enterprise (up to 30 d); PITR is a separate paid add-on on Pro/Team/Enterprise only. | **N/A** on Free plan | Correction over earlier entry which asserted "7-day PITR + daily backups on Free". Current project `ndgnhvbpmtxrpplgsslz` is on Free plan (per PROJECT_CONNECTIONS). A scheduled `pg_dump` from outside the project is therefore the ONLY automatic DB backup path available today; **none is configured** → see XZM-006B. Sources: <https://supabase.com/docs/guides/platform/backups>, <https://supabase.com/pricing>. |
| 7 | Supabase schema (source-of-truth) | **BACKUP AVAILABLE** (141 migration files in `supabase/migrations/` + `apply-all-dev.sql`) | **UNVERIFIED** | Clean restore to a new project via migrations not drill-tested. |
| 8 | Supabase Edge Functions | **PARTIAL — 4 of 6 in repo, 2 missing from repo but RETRIEVABLE from live** — `auth-login`, `admin-users`, `nodi-ai`, `push-send` source in repo (`supabase/functions/`). `nodi-route-plan`, `osm-fetch-places` are missing from repo but their deployed source can be fetched with `supabase functions download <slug> --project-ref ndgnhvbpmtxrpplgsslz` (CLI) or the per-function **Download** button in the Supabase Dashboard (Edge Functions → function → Download). Earlier claim "Management API does not expose source" is **CORRECTED**: a Download endpoint backs both CLI and Dashboard paths. | **UNVERIFIED** (retrieval not drill-tested this pass) | See §3.2. |
| 9 | Supabase RLS / RPC / policies | **BACKUP AVAILABLE** (embedded in migrations) | **UNVERIFIED** | — |
| 10 | Supabase Auth config (SMTP, hooks, redirect URLs) | **MISSING** — not source-controlled | **ACCESS REQUIRED** | Dashboard has it; must be documented separately. See §6.4. |
| 11 | Supabase Storage objects (uploaded files, slips, docs) | **UNVERIFIED** | **UNVERIFIED** | No periodic export job in repo; dashboard Storage buckets not enumerated in this pass. |
| 12 | Netlify deploy history | **BACKUP AVAILABLE** — Netlify keeps rolling deploys; any previous one can be "Published" | **UNVERIFIED** | Free plan retention limits apply (Owner dashboard confirmation needed). |
| 13 | Cloudflare Workers mirror | **BACKUP AVAILABLE** — `wrangler.jsonc` deploys the same `web/dist` to Workers service `xzm-team`; serves as a second live copy of the site | **UNVERIFIED** | Mirror only; it does not back up Netlify's Forms or redirects beyond those in `netlify.toml`. |
| 14 | Cloudflare DNS zone (xzmteam.com) | **MISSING / UNVERIFIED** | **UNVERIFIED** | No DNS export file in repo. Owner must export zone file from Cloudflare Dashboard → DNS → Advanced → Export. |
| 15 | Cloudflare SSL/TLS config | **UNVERIFIED** | **UNVERIFIED** | Not source-controlled. |
| 16 | Environment variables (frontend, public) | **BACKUP AVAILABLE** — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` are public anon values stored in Netlify Site Settings and GitHub repo variables | — | Non-secret; safe to reseed. |
| 17 | Environment variables (secrets) | **ACCESS REQUIRED** — STORED ONLY in: Supabase Edge Function secrets, GitHub Actions secrets (`NETLIFY_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_SERVICES_JSON`, Android signing set). GitHub & Supabase secret stores are write-only after creation | **ACCESS REQUIRED** | No documented out-of-band encrypted backup. If the host platform is lost, the Owner must re-mint every secret from its upstream service (Netlify, Cloudflare, Firebase, Supabase dashboards) one by one. |
| 18 | Central project documentation | **BACKUP AVAILABLE** — `docs/project-control/` (16 central docs + 4 audits) merged to `main` via XZM-004R PR #213 (merge commit `24b348d`, 2026-11-27 15:46 UTC) | **UNVERIFIED** | R-008 read-verification by both AIs still outstanding. |

---

## 3. Drift findings (read-only, no fix applied)

### 3.1 Migration drift — version-wise comparison (correction over earlier `155 − 141 = 14` arithmetic)

The earlier framing of the drift as "14 orphan migrations" is **incorrect**. A set-level comparison of the live `supabase_migrations.schema_migrations` table (fetched 2026-11-27 via MCP `list_migrations`) against the files in `supabase/migrations/` on branch `docs/xzm-006-deep-verification` shows a **structural divergence in both directions**, not a one-sided surplus.

**Totals**

| Source | Rows / files | Unique version timestamps | Unique migration names |
|---|---|---|---|
| Live DB (`ndgnhvbpmtxrpplgsslz`) | 155 | 154 | 154 |
| Repo (`supabase/migrations/`) | 141 | 138 | 141 |

**Version-timestamp set diff**

| Direction | Count | Interpretation |
|---|---|---|
| Live timestamps absent in repo | **124** | Migrations recorded in live under timestamps that do not exist in the repo at all |
| Repo timestamps absent in live | **108** | Migrations in the repo under timestamps never recorded in live |
| Common timestamps | 30 | Only the first ~30 migrations (foundation → sheet_made_easy on 2026-11-11 and 2026-11-13) share identical `YYYYMMDDHHMMSS` version IDs |

➡ **Timestamp alignment holds only for migrations dated 2026-11-11 and 2026-11-13.** From 2026-11-15 onward the repo uses a **sequential pseudo-timestamp pattern** (`20261115000100`, `…000200`, …) while the live DB retains **real clock timestamps** from the moment each migration was applied (`20261115015547`, `…030004`, …). Mechanically, `supabase db push` reconciles by `version` string, so these are **two disjoint histories** for the DB tooling — a fresh `supabase db push` against an empty project would create a schema that neither matches live nor re-plays live's timeline.

**Name-level set diff** (comparing the human-readable suffix after the version)

| Direction | Count | Examples |
|---|---|---|
| Names present in live but missing in repo | **29** | `probe_delete`, `probe_alter`, `vehicle_ops_index`, `vehicle_ops_a`, `vehicle_ops_b1a`, `vehicle_ops_b2`, `vehicle_ops_c`, `vehicle_ops_d`, `vehicle_ops_fix_log_list`, `hub_issues_a_tables`, `hub_issues_b_helpers_rls`, `hub_issues_c_workflow`, `hub_issues_d_panels_group`, `hub_issues_e_storage`, `workforce_attendance_a`, `workforce_attendance_b1`, `workforce_attendance_b2`, `workforce_manager_book_a`..`_d`, `work_focus_and_zonal_hub_transfer`, `staff_self_employee_scope`, `role_based_menus`, `role_sidebar_menu_system`, `add_ai_plan_to_route_day_plans`, `fleet_office_kinds`, `hub_registers_pending_release`, `manager_hub_registers` |
| Names present in repo but missing in live | **16** | `hub_issues` (live split into `_a`..`_e`), `workforce_attendance` (live split into `_a`/`_b1`/`_b2`), `workforce_manager_book` (live split into `_a`..`_d`), `vehicle_ops` (live split into `_index`/`_a`/`_b1a`/`_b2`/`_c`/`_d`/`_fix_log_list`), `work_focus`, `zonal_hub_transfer`, `att_versions_windows`, `daily_register_own_month`, `list_tools_permission`, `pending_manager_review`, `pending_month_report`, `route_places`, `route_settings`, `staff_pending_snapshots`, `staff_work_profile`, `zone_group_and_contact` |

**Interpretation** — three distinct cases coexist:

1. **Repo-side consolidations that were later split in live** (e.g. repo's single `workforce_manager_book` vs. live's `_a`/`_b`/`_c`/`_d`): the repo captures an older unified migration that was replaced on live by a series; the DB object outcomes may still match, but the two histories do not.
2. **Live-side ad-hoc probes with no repo counterpart** (`probe_delete`, `probe_alter`, `sync_live_functions`): applied directly against live outside the file flow; these are the clearest orphans in the narrow sense.
3. **Repo-side migrations never applied to this project** (the 16 names above missing in live): either applied to a different project, staged locally and not pushed, or superseded without an explicit retraction.

⚠ A clean restore from repo migrations **will not** reproduce the live schema. Full reconciliation is a per-migration decision (adopt live version, retire repo version, or write a bridge migration), not a bulk `git add`. This scope is tracked in **XZM-006C** and requires ChatGPT Backend Team ownership — Claude does not apply any reconciliation in this task.

**Evidence** — raw name lists in both directions: see `docs/project-control/audits/XZM-006_BACKUP_RECOVERY.md` commit history; raw MCP response for live set captured in this PR's working transcript.

### 3.2 Edge-function drift — recovery feasibility (correction over earlier "no API retrieval possible" claim)

Live has 6 functions; repo tracks source for only 4 (`auth-login`, `admin-users`, `push-send`, `nodi-ai`). `nodi-route-plan` and `osm-fetch-places` have **no source in repo**.

**Recovery feasibility — corrected:** Supabase **does** expose the deployed source of an Edge Function, through two documented and currently-supported paths:

1. **Supabase CLI** — `supabase functions download <function-slug> --project-ref <project-ref>` downloads the deployed function's source into `supabase/functions/<function-slug>/` on disk. Documented at <https://supabase.com/docs/guides/troubleshooting/transfer-edge-function-from-one-project-to-another> and in the CLI Edge Functions guide.
2. **Supabase Dashboard** — Edge Functions → function detail page → **Download** button → zip of source. Documented at <https://supabase.com/docs/guides/functions/quickstart-dashboard#download-edge-functions>.

Under the hood these paths use the Management API's function-body endpoint (same endpoint the CLI calls); it is not surfaced as a prominent REST path in the public API reference, but it is reachable through the two supported tools above.

**Implication:** `nodi-route-plan` and `osm-fetch-places` are **BACKUP AVAILABLE from the live project via CLI/Dashboard** — not "impossible to redeploy from GitHub" as the earlier text claimed. The remaining work is operational:

- Run `supabase functions download nodi-route-plan --project-ref ndgnhvbpmtxrpplgsslz`
- Run `supabase functions download osm-fetch-places --project-ref ndgnhvbpmtxrpplgsslz`
- Review the downloaded code against the call sites in `web/` for correctness, add missing imports if any, and commit under an approved task (**XZM-006E**, re-scoped — it now owns the retrieval + commit, not the "re-author from scratch" fallback).
- Owner approval and ChatGPT Backend Team contract required before committing — Claude does not run these commands in this read-only pass.

The earlier "re-author from scratch" fallback is retained only as a last-resort step if the CLI download fails for a specific function (rare; most commonly caused by an inline-only function created through the Dashboard assistant without saved source — not the case for these two, which were deployed via CLI per the commit history).

This is tracked in §6.4 / **XZM-006E**.

### 3.3 Android Signing Key — single point of failure (re-verified for Second Review)

**GitHub Actions secrets are write-only after creation.** `settings/secrets/actions` neither the UI nor the REST API expose the plaintext value; the `.github/workflows/android-apk.yml` workflow references them by name only (`${{ secrets.ANDROID_KEYSTORE_BASE64 }}`), and the workflow run logs explicitly mask them.

Therefore the sentence "Supabase service-role / ANTHROPIC_API_KEY / Netlify tokens — in their dashboards" from AI_HANDOVER §10 is correct, but for the Android keystore there is **no upstream service** to re-mint it from: a Play-Store-signed APK cannot be resigned with a new key while keeping the existing installs updatable.

**Possible original backup locations (ACCESS REQUIRED by Owner):**

| Location | How Owner verifies | Result if missing |
|---|---|---|
| Owner's development machine | Check for `.jks` or `.keystore` file + `keystore.properties` in the local project folder's `web/android/app/` path, or in an off-tree key directory under the Owner's chosen keystore location | No off-GitHub copy exists |
| Password manager vault | Check for keystore binary attachment + three passwords (store, key alias, key password) | No off-GitHub copy exists |
| Offline media (external drive, USB) | Owner-controlled; Claude cannot verify | No off-GitHub copy exists |
| Backup drive / cloud storage | Search filename pattern `*.jks` / `*.keystore` in Owner's backup locations | No off-GitHub copy exists |
| CI build-cache artifact | **NO** — workflow uses `mktemp` then `trap` deletes; keystore never persisted to artifact | — |

**Verification pass result for item 5:** this audit has NOT confirmed any off-GitHub backup exists; nor has it confirmed the absence of one. Status remains **ACCESS REQUIRED**. Owner needs to perform the four checks above and append the result. A follow-up task (**XZM-006A**) covers the export procedure once Owner confirms the original keystore file is available.

### 3.4 Supabase security advisors

7 findings on `ndgnhvbpmtxrpplgsslz` as of 2026-11-27 (re-queried via `get_advisors`):

| Level | Category | Instances |
|---|---|---|
| ERROR | `rls_enabled_no_policy` | 1 (`v_user_sidebar`) |
| WARN | `security_definer_view` | 1 |
| WARN | `function_search_path_mutable` | ~300 RPCs (non-blocking; latent risk) |
| WARN | `extension_in_public` | 1 (`pg_net`) |
| WARN | `anon_security_definer_function_executable` | 3 (`log_position_menu_change`, `is_menu_admin`, …) |
| WARN | `authenticated_security_definer_function_executable` | 3 |
| INFO | `auth_leaked_password_protection` | 1 |

Not blocking recovery, but noted — see **XZM-006H** for the security-hardening sub-task.

### 3.5 No git tags / releases

Rollbacks must reference commit SHAs; a tagged "last known good" version is not available. See **XZM-006F**.

### 3.6 Shallow clone constraint

This audit used `--depth 1`; full history was not inspected. For a deep restore drill, a full clone would be needed.

### 3.7 No automated Supabase Storage export or DB dump committed/scheduled

See **XZM-006B** (Supabase coverage).

---

## 4. Recovery scenarios (full procedures, read-only description)

Each procedure assumes **Owner approval + explicit Task ID** before execution. No command below is run as part of this audit.

### 4.1 AI accidentally breaks the website

1. On GitHub: open Actions → the failing run → copy the previous good commit SHA (or use `git log main`).
2. Locally: `git checkout <good-sha>`, verify `web/dist` builds, PR → merge, let the `android-apk.yml` workflow redeploy.
3. Fast path (no code change): Netlify Dashboard → Deploys → previous `ready` deploy → "Publish deploy".
4. Second line: Cloudflare Workers Dashboard → `xzm-team` → Deployments → promote previous version.
5. Verify: `https://xzmteam.com/version.json`, smoke checks on `/staff/login` and `/app/me`.

**Pre-requisite that is BACKUP AVAILABLE today:** rolling Netlify deploys + Cloudflare Workers mirror deploy. **Pre-requisite that is MISSING today:** named tag for "last known good" (XZM-006F).

### 4.2 Database records accidentally deleted

1. Do **not** run any DML. Freeze writes if the deletion is ongoing (disable Edge Functions that write, or temporarily revoke the relevant RLS grants under Owner approval).
2. **Realistic state today — Free plan has neither PITR nor automatic daily backups.** Supabase Dashboard → Database → Backups will show no snapshots on this project. Recovery depends on whether a manual `supabase db dump` / `pg_dump` has been taken recently and stored off-platform.
   - If such a dump exists: restore it into a **new** project (e.g. `xzm-team-erp-restore-YYYYMMDD`) — never over production — and selectively re-apply affected rows.
   - If no dump exists: only logical reconstruction from application-level logs (audit tables, `da_*` append-only tables, Supabase log drains if configured) is available; this recovers partial state, not a snapshot.
3. If the Owner elects to upgrade the project to **Pro plan + PITR add-on** before a future incident, step 2 becomes: Dashboard → Database → Backups → pick most recent PITR/daily snapshot before the deletion, restore into a new project.
4. Extract the affected rows with SQL, review with Owner + ChatGPT, then apply a scoped INSERT back to live under an audited task.
5. Document in `AUDIT_REPORT.md` and `DECISION_LOG.md`.

**Pre-requisite that is MISSING today:** a scheduled `pg_dump` export stored off-platform (tracked in **XZM-006B**). **Pre-requisite that is ACCESS REQUIRED for the PITR-based path:** plan upgrade decision from Owner.

### 4.3 Database migration fails

1. Supabase CLI will stop at the failing migration. Live DB remains at the last successful version.
2. Fix the migration in a **new** file (never edit a shipped file, per CLAUD.txt §4.15).
3. Reapply via `supabase db push` or MCP `apply_migration`.
4. If the failure left partial objects: roll them back with a compensating migration; do not drop manually in Dashboard.

**Pre-requisite that is BACKUP AVAILABLE today:** 141 migration files in repo. **Pre-requisite that is MISSING today:** structural reconciliation of 29 live-only + 16 repo-only migration names, plus a timestamp-convention decision for the 124 live-only + 108 repo-only timestamps (see §3.1 and XZM-006C).

### 4.4 Login or role permissions stop working

1. Check `auth-login` Edge Function logs in Supabase Dashboard → Edge Functions → Logs.
2. Verify Access Token Hook is still attached: Supabase → Authentication → Hooks → `public.custom_access_token_hook`.
3. Verify `app_metadata.role` in a representative user row (SQL editor).
4. Revert the last RBAC-touching migration by writing a compensating migration (not by `DROP`).
5. If all else fails: restore the role-related tables from PITR into a side project and re-sync by task.

**Pre-requisite that is BACKUP AVAILABLE today:** `auth-login` source in repo, migrations tracked. **Pre-requisite that is MISSING today:** documented Auth config snapshot (XZM-006B.3).

### 4.5 Android application update fails

1. GitHub Actions → re-run the failed `android-apk.yml` workflow; if signing step failed, confirm the four secrets are still set.
2. If the uploaded APK is bad: rerun the previous good workflow run with `publish_apk=true` — `keep-live-apk.sh` + the signer-match check will keep users on a compatible signed APK.
3. If the signing key is lost → **cannot** push a compatible update. Users must uninstall & reinstall the newly signed APK. This is the highest-impact failure mode; see §3.3.
4. If a published APK already corrupted the download, roll back the site to a prior Netlify deploy that still contains the earlier `dist/download/XZM-TEAM.apk`.

**Pre-requisite that is BACKUP AVAILABLE today:** signer-match guardrail in workflow. **Pre-requisite that is ACCESS REQUIRED today:** off-GitHub keystore backup (XZM-006A).

### 4.6 Domain or DNS configuration breaks

1. Cloudflare Dashboard → xzmteam.com → DNS → Audit log / "Restore" (if available on plan).
2. If the zone was deleted or transferred: re-create zone, point registrar nameservers back to Cloudflare, re-enter A/CNAME records for `xzmteam.com` and Netlify's `*.netlify.app` CNAME.
3. Netlify Dashboard → Domain management → re-verify custom domain and provision Let's Encrypt cert.
4. SSL takeover test: `curl -I https://xzmteam.com`.

**Prerequisite that is MISSING today:** an exported zone file in a safe location (XZM-006D).

### 4.7 GitHub repository becomes unavailable

1. The Owner retains a local clone of the repository on their own development machine (exact path kept off public documentation per the XZM-004R-Final redaction policy; see `docs/project-control/PROJECT_CONNECTIONS.md` and Owner's private records).
2. Push that clone to a new GitHub repo (or GitLab mirror) under an existing owner.
3. Reconfigure Actions secrets (`NETLIFY_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_SERVICES_JSON`, Android signing set).
4. Trigger `android-apk.yml` with `publish_apk=true` to restore site delivery.

**Risk:** if neither GitHub nor the local clone is available, the Android signing key is lost (§3.3 / XZM-006A); and every secret must be re-minted from upstream services.

---

## 5. Preview isolation **and** actual production database binding (two separate questions)

Earlier text folded these two concerns into one table. This pass splits them, because they verify to different states.

### 5.1 Preview isolation — VERIFIED

Can any preview / PR / non-production path reach the production database?

| Preview path | Could it touch production DB? | Evidence |
|---|---|---|
| Netlify Deploy Preview | **NO — path disabled entirely** | `netlify.toml [context.deploy-preview] ignore = "exit 0"` — Netlify skips preview builds |
| Cloudflare Workers Git-integration preview | **NO — path not used** | `wrangler deploy` runs only from `android-apk.yml` on push main + `web/**`; Cloudflare's own Git auto-build is not configured |
| Supabase preview DB branches | **NO — none exist** | `list_branches` on `ndgnhvbpmtxrpplgsslz` returned `[]` on 2026-11-27 |
| Workflow PR runs reaching live DB | **NO — workflow guards** | `tests.yml` uses a throwaway PostgreSQL 16 per workflow comment: "Nothing here touches the live Supabase project; no secrets are used." |

**Verdict:** No preview or PR path writes to the production DB.

### 5.2 Actual production database binding — PARTIALLY VERIFIED

The "production database" is **not** the staging project. Which Supabase project is actually bound to the deployed xzmteam.com frontend?

| Question | Status | Evidence |
|---|---|---|
| Which Supabase project does the frontend `createClient()` call hit? | **ACCESS REQUIRED** — depends on `VITE_SUPABASE_URL` set in Netlify Site Settings (and the mirror value on Cloudflare Workers via `wrangler.jsonc` env). `netlify.toml` contains only the comment `# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY under <dashboard>` — the live value is not in the repo. | `grep -r "ndgnhvbpmtxrpplgsslz\|mbpjvqeizwjjsvnbjerb"` across the repo returned **no match in any `.ts/.tsx/.js/.jsx/.toml/.json/.jsonc/.yml`** — i.e. no hard-coded ref. Owner must read Netlify Site Settings → Build & deploy → Environment and record the value in `PROJECT_CONNECTIONS.md`. |
| Which Supabase project does this audit treat as production? | **VERIFIED by inference**, needs Owner confirmation | `ndgnhvbpmtxrpplgsslz` (`xzm-team-erp-dev`). Despite the historical `-dev` suffix in its name, it is the only project with live data, 155 applied migrations, 6 ACTIVE Edge Functions matching the frontend's call sites (`push-send`, `nodi-ai`, `osm-fetch-places`, …), and the Anthropic API key configured. The `xzm-team-staging` project (`mbpjvqeizwjjsvnbjerb`) was created on 2026-11-27 and holds no production traffic. **The project name is a misnomer; it is the production database.** |
| Does any MCP / CLI binding Claude uses here resolve to production? | **YES** — all `mcp__Supabase__*` calls in this session target `project_id=ndgnhvbpmtxrpplgsslz` by argument. This audit made **read-only** calls (`list_projects`, `list_migrations`, `list_edge_functions`, `list_branches`, `get_advisors`); no `execute_sql` or `apply_migration` ran. | This session's transcript. |
| Does the staging project (`mbpjvqeizwjjsvnbjerb`) have any production role today? | **NO** | `list_projects` shows it `ACTIVE_HEALTHY` but empty of migrations as of creation date; no live frontend points to it. |

**Verdict:**

- Preview isolation holds (5.1).
- The production binding is correctly identified in this audit (ndgnhvbpmtxrpplgsslz), but the mechanical confirmation — reading `VITE_SUPABASE_URL` from the Netlify Site Settings dashboard — remains **ACCESS REQUIRED**. Tracked under **XZM-006B** (add a sub-item: "Record the live value of `VITE_SUPABASE_URL` in PROJECT_CONNECTIONS.md § operational identifiers").
- The name `xzm-team-erp-dev` should be renamed or explicitly annotated as "production despite its name" in `PROJECT_CONNECTIONS.md` to avoid a future AI or team member treating it as a non-production target. Tracked under **XZM-006B.5**.

---

## 6. New verification items (10 items demanded by Second Review)

### 6.1 Android Signing Key: original backup location

Result per §3.3 — **ACCESS REQUIRED** by Owner. Checks listed; no assumption that GitHub Actions secret is directly exportable.

### 6.2 Supabase Backup Retention, PITR, Database, Auth, Storage recovery coverage (corrected against official docs)

| Sub-item | Status |
|---|---|
| Automated daily backup (Free plan) | **NOT AVAILABLE** — per <https://supabase.com/pricing> and <https://supabase.com/docs/guides/platform/backups>, Free plan has no scheduled automatic backups. Pro = 7 d, Team = 14 d, Enterprise = up to 30 d. |
| PITR (Free plan) | **NOT AVAILABLE** — PITR is a paid add-on on Pro/Team/Enterprise only; it is not offered on Free plan. Earlier "7-day PITR on Free" claim **withdrawn**. |
| Database schema backup | **BACKUP AVAILABLE** (141 migration files) — see §3.1 for the drift against live |
| Database data backup | **MISSING** — no scheduled `pg_dump` / `supabase db dump` export job exists in the repo or in GitHub Actions; this is the gap the Free plan leaves and nothing fills today |
| Auth config (SMTP, hooks, providers) | **MISSING** (not source-controlled) |
| Storage buckets (object listing + export) | **UNVERIFIED** — buckets not enumerated this pass |
| Edge Function secrets | **ACCESS REQUIRED** — write-only once set |
| Realtime config | **UNVERIFIED** |
| `VITE_SUPABASE_URL` (frontend binding — see §5.2) | **ACCESS REQUIRED** — Owner reads Netlify Site Settings and records value |
| Production-project name clarity (`xzm-team-erp-dev` is production) | **MISSING** — not annotated in PROJECT_CONNECTIONS.md; tracked as **XZM-006B.5** |

Tracked as **XZM-006B — Supabase recovery coverage documentation** (now also owning the plan-upgrade decision, the `pg_dump` schedule design, and the production-binding documentation).

### 6.3 Live vs Repository Migration Drift — corrected

See §3.1 for the full version-wise set-diff. Summary: the drift is **structural in both directions** (124 live timestamps absent in repo; 108 repo timestamps absent in live; only the first 30 share version IDs). The earlier "14 orphan" number was arithmetic on totals and is retired. Reconciliation is tracked as **XZM-006C**, now scoped as a per-migration decision pass owned by ChatGPT Backend Team.

### 6.4 Missing Edge Functions — Recovery Feasibility (corrected)

Per §3.2 — `supabase functions download` (CLI) and the Dashboard Download button **can** retrieve deployed source for `nodi-route-plan` and `osm-fetch-places`. Status upgraded from "impossible to redeploy from GitHub" to **BACKUP AVAILABLE from live via CLI**. Tracked as **XZM-006E**, re-scoped to "retrieve from live → review against call sites → commit".

### 6.5 Cloudflare DNS, Workers and Netlify Rollback Configuration

| Surface | Current rollback mechanism | Status |
|---|---|---|
| Netlify deploys | Dashboard → Deploys → previous → "Publish" | **BACKUP AVAILABLE** (procedure) / **UNVERIFIED** (drill) |
| Cloudflare Workers deployments | Dashboard → `xzm-team` → Deployments → promote | **BACKUP AVAILABLE** / **UNVERIFIED** |
| Cloudflare DNS | Dashboard → DNS → Audit log (plan-dependent) | **UNVERIFIED** — audit log retention unknown |
| Cloudflare DNS zone file | Dashboard → DNS → Advanced → Export | **MISSING** (no committed zone file) |

Tracked as **XZM-006D — Cloudflare / Netlify rollback documentation + zone export**.

### 6.6 Preview ↔ Production Isolation

Per §5 — **VERIFIED** read-only. No sub-task needed; documented in merged XZM-004R Review-Response.

### 6.7 RPO / RTO information gaps

RPO (Recovery Point Objective) and RTO (Recovery Time Objective) require **business inputs from Owner**. Current gaps:

| System | Data needed from Owner | Current inference (not VERIFIED) |
|---|---|---|
| Supabase DB | Max tolerable data-loss window; max tolerable downtime during restore | **RPO = unbounded** on current Free plan (no automatic backups, no PITR) until an off-platform `pg_dump` schedule is set up (XZM-006B); RTO ~ hours once a dump exists and is restored into a new project. A Pro-plan + PITR upgrade would bring RPO down to minutes. |
| Netlify site | Max tolerable site outage | RTO ~ minutes (rollback via dashboard) — **UNVERIFIED** drill |
| Cloudflare DNS | Max tolerable DNS outage | RTO ~ hours (zone recreation) — **MISSING** export increases RTO to days |
| Android signing | Max tolerable channel reset tolerance | RPO = N/A (immutable keystore); RTO = **catastrophic** if lost — **ACCESS REQUIRED** |
| Edge Functions | Max tolerable per-function downtime | 4 of 6: RTO ~ hours (redeploy from repo); 2 of 6: **ACCESS REQUIRED** (XZM-006E) |

Tracked as **XZM-006G — RPO/RTO Owner questionnaire**.

### 6.8 Netlify preview SSO + custom domain rollback

- Netlify deploy previews are DISABLED, so no SSO-protected preview URL exists today. No action needed.
- Custom-domain Let's Encrypt cert is managed by Netlify; rollback involves re-verify + provision — **UNVERIFIED** drill.

### 6.9 Supabase staging project ownership

Project `mbpjvqeizwjjsvnbjerb` = `xzm-team-staging` exists in same org, created 2026-11-27. **UNVERIFIED** whether it is the designated restore-target for disaster drills.

### 6.10 Documentation canon on main

Post-XZM-004R merge: `docs/project-control/` is the single source of truth on `main`. **BACKUP AVAILABLE** via git. R-008 resolution requires both-AI read-verify step still pending.

---

## 7. Proposed Sub-tasks — XZM-006A..I

**Conflict check:** No XZM-006A..I letter suffixes exist elsewhere in TASK_TRACKER. Numeric XZM-### IDs reach XZM-017; letter suffixes are a new namespace — **NO CONFLICT, SAFE.**

| ID | Title | Priority | Primary category | Depends on |
|---|---|---|---|---|
| **XZM-006A** | Android Signing Key — off-GitHub export procedure | **CRITICAL** | DS — Database & Security | Owner locates original keystore file |
| **XZM-006B** | Supabase recovery coverage (plan decision + `pg_dump` schedule + Auth / Storage / Realtime documentation + `VITE_SUPABASE_URL` record + `xzm-team-erp-dev` production annotation) | HIGH | DS | Owner dashboard screenshots; Owner plan-upgrade decision |
| **XZM-006C** | Supabase Migration Drift reconciliation (**per-migration decision pass** across 29 live-only + 16 repo-only names; not a bulk commit) | HIGH | DS | ChatGPT Backend Team review of each migration's intent |
| **XZM-006D** | Cloudflare DNS zone export + Workers rollback runbook + Netlify rollback runbook | HIGH | DS + DP | Owner Cloudflare dashboard |
| **XZM-006E** | Missing Edge Functions source recovery (`nodi-route-plan`, `osm-fetch-places`) **via `supabase functions download` → review → commit** | HIGH | DS | Owner approval; ChatGPT Backend Team contract |
| **XZM-006F** | Git tag policy + tag `24b348d` as `v2026.11.27-live` (or next live SHA) | MEDIUM | DP | — |
| **XZM-006G** | RPO/RTO Owner questionnaire + target definition | MEDIUM | AU | Owner business input |
| **XZM-006H** | 7 Supabase security advisors remediation | MEDIUM | DS | ChatGPT Backend Team review (scope + fix migration) |
| **XZM-006I** | **Isolated Backup Restore Test** — one end-to-end drill: take a `supabase db dump` of `ndgnhvbpmtxrpplgsslz`, restore it into `mbpjvqeizwjjsvnbjerb` (`xzm-team-staging`) in an isolated pass with **no production write-back and no shared bindings**, apply the repo's edge-function source to the staging project, deploy the current `web/dist` to a preview Netlify site also bound to staging, smoke-test the login + one read + one write flow, then tear down. Document RPO/RTO measured during the drill in XZM-006G. Pre-requisite: XZM-006B's `pg_dump` schedule running, or an ad-hoc dump captured with Owner approval. **Hard constraint:** no step of this drill may share secrets, domains or env vars with production. | MEDIUM | DS + AU | XZM-006B (dump available) + XZM-006E (edge sources committed) + Owner approval |

Each sub-task will be opened as a separate record in TASK_TRACKER with full 15-field schema under a follow-up documentation PR after this report is approved.

---

## 8. Updated Owner Action Items (supersedes earlier §3 of first-pass summary)

| # | Action | Priority | Owner approval required | Linked sub-task |
|---|---|---|---|---|
| 1 | Verify original Android keystore file exists off-GitHub; store encrypted in two off-GitHub locations (password manager + offline media) | **CRITICAL** | Yes | XZM-006A |
| 2 | Export Cloudflare zone file for `xzmteam.com` and store encrypted copy; commit a redacted inventory | HIGH | Yes | XZM-006D |
| 3 | Reconcile 14-migration drift: commit back or document discard under task | HIGH | Yes | XZM-006C |
| 4 | Locate or re-author source for `nodi-route-plan` and `osm-fetch-places`; commit to `supabase/functions/` | HIGH | Yes | XZM-006E |
| 5 | Verify Supabase Free-plan PITR window + Auth config + Storage buckets; schedule monthly `pg_dump` export | HIGH | Yes | XZM-006B |
| 6 | Tag the current live commit (`24b348d` post-XZM-004R merge or the next live SHA) as `v2026.11.27-live` | MEDIUM | Yes | XZM-006F |
| 7 | Run one end-to-end **isolated** restore drill into the `xzm-team-staging` project + a preview Netlify site (no shared production bindings); document result | MEDIUM | Yes | **XZM-006I** (depends on XZM-006B + XZM-006E) |
| 8 | Resolve 7 Supabase security advisors (1 ERROR, 5 WARN, 1 INFO) | MEDIUM | Yes — separate task | XZM-006H |
| 9 | Fill RPO / RTO questionnaire for each system tier | MEDIUM | Yes | XZM-006G |

---

## 9. Compliance

- ✅ No code, DB, DNS or production change executed.
- ✅ No Supabase migration / execute_sql run.
- ✅ No Netlify / Cloudflare / GitHub push beyond this docs-only branch.
- ✅ No restore drill performed.
- ✅ No secret value read or exported (GitHub Actions secrets are write-only; this audit did not attempt to extract them).
- ✅ Previous central-doc summary (XZM-006 §1-§5 as merged in XZM-004R) replaced verbatim-and-extended by this file.
- ✅ Awaiting ChatGPT Independent Second Review → Owner approval for §8 action items under XZM-006A..H.

---

## 10. Evidence index

| Evidence | Source |
|---|---|
| Repo content | `git clone --depth 1 https://github.com/mizanurnatoresfc-bit/xzm-team` |
| Supabase project (dev) | MCP `get_project` / `list_projects` → `ndgnhvbpmtxrpplgsslz`, `ACTIVE_HEALTHY` |
| Supabase project (staging) | MCP `list_projects` → `mbpjvqeizwjjsvnbjerb`, `ACTIVE_HEALTHY` |
| Edge Functions live | MCP `list_edge_functions` (2026-11-27) → 6 ACTIVE functions enumerated |
| Supabase security advisors | MCP `get_advisors(type=security)` (2026-11-27) → 7 findings (1 ERROR + 5 WARN + 1 INFO) |
| Supabase preview branches | MCP `list_branches` (2026-11-27) → `[]` |
| Netlify site | MCP `get-project` → site `2909a0bd-…-bd4`, primary URL `https://xzmteam.com`, current deploy `6b071e18955520628c7d0bb0` ready |
| Netlify deploy | MCP `get-deploy-for-site` → `deploy_source: "cli"` (workflow-driven, not auto-build) |
| Cloudflare identity | MCP `whoami` → Owner's Cloudflare account (email held off-repo per redaction policy) |
| CI/CD details | `.github/workflows/android-apk.yml`, `website.yml`, `tests.yml` (path-scoped, verified) |
| Mirror deploy config | `wrangler.jsonc` (assets `./web/dist`), `netlify.toml` (preview context disabled) |
| APK preservation logic | `scripts/keep-live-apk.sh` + signer-match in `android-apk.yml` |
| Owner's local clone path | Held in Owner's private records / `PROJECT_CONNECTIONS.md`; redacted from public documentation per XZM-004R-Final policy |
| Supabase Edge Function download capability | Supabase CLI `functions download` command — <https://supabase.com/docs/guides/troubleshooting/transfer-edge-function-from-one-project-to-another>; Dashboard Download button — <https://supabase.com/docs/guides/functions/quickstart-dashboard#download-edge-functions> |
| Supabase Free-plan backup coverage | Pricing page <https://supabase.com/pricing>; Database Backups guide <https://supabase.com/docs/guides/platform/backups> |
| Live migration set (155 entries) | MCP `list_migrations(project_id="ndgnhvbpmtxrpplgsslz")` executed 2026-11-27 during this pass |

---

## 11. Status

- Read-only deep verification **complete**.
- No production restore, DB write, DNS change, code change, or secret exposure occurred.
- Awaiting ChatGPT Independent Second Review → Owner approval for §8 action items under XZM-006A..H.
