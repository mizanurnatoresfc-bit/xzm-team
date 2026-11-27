# XZM-006 — Backup & Recovery Deep Verification

**Status:** UNDER_REVIEW — Deep verification complete 2026-11-27; awaiting ChatGPT Independent Second Review → Owner approval
**Date:** 2026-11-27 (Asia/Dhaka)
**Mode:** Read-only — no code, DB, DNS, production config or secret change.
**Source HEAD (first pass):** `2836a07a96d5053938fdaed6bff22273558e7977`
**Current HEAD (deep verification pass):** `24b348d37e2e0b38e427dac97916f356af4a0244` (post-XZM-004R merge)

> **Review history:**
> - 2026-11-27 — First summary (XZM-004R consolidation) merged with central-doc copy.
> - 2026-11-27 — ChatGPT Independent Review: **PARTIAL — EVIDENCE REQUIRED.** Full 18-asset matrix + 7 DR procedures demanded in central doc; off-platform signing-key backup claim to be verified without assuming GitHub Actions secret can be exported; RPO/RTO + sub-task breakdown required.
> - 2026-11-27 (this pass) — Full matrix + procedures + verification items + sub-tasks XZM-006A..H recorded; this file replaces the earlier summary verbatim and extends it.

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
| 6 | Supabase database (automatic) | **ACCESS REQUIRED** (Free plan default: 7-day PITR + daily backups per Supabase docs; dashboard confirmation pending) | **UNVERIFIED** | Needs Owner dashboard screenshot of `Database → Backups` retention window. |
| 7 | Supabase schema (source-of-truth) | **BACKUP AVAILABLE** (141 migration files in `supabase/migrations/` + `apply-all-dev.sql`) | **UNVERIFIED** | Clean restore to a new project via migrations not drill-tested. |
| 8 | Supabase Edge Functions | **PARTIAL — 4 of 6 BACKUP AVAILABLE, 2 MISSING** — `auth-login`, `admin-users`, `nodi-ai`, `push-send` source in repo (`supabase/functions/`). **MISSING in repo**: `nodi-route-plan`, `osm-fetch-places` | **UNVERIFIED** | See §3.2. |
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

### 3.1 Migration drift

Supabase live DB has **155 applied migrations**, repo `supabase/migrations/` contains **141 files**. The 14 extras include `sync_live_functions`, `probe_delete`, `probe_alter`, `vehicle_ops_b1a`, `vehicle_ops_b2`, `vehicle_ops_c`, `vehicle_ops_d`, `vehicle_ops_fix_log_list`, and several more.

⚠ A clean restore from repo migrations will produce a schema that differs from live. Each orphan migration must be either committed back to the repo (recovery baseline) or deliberately discarded under an approved task.

### 3.2 Edge-function drift

Live has 6 functions; repo tracks source for only 4 (`auth-login`, `admin-users`, `push-send`, `nodi-ai`). `nodi-route-plan` and `osm-fetch-places` have **no source in repo** → impossible to redeploy from GitHub.

**Recovery feasibility:** Supabase does **not** expose the source of a deployed function via its REST / Management API — only metadata (slug, version, SHA-256 of the executed bundle) can be read. The only ways to recover source for a live function are:

1. Owner locates the author's local copy (laptop, backup drive) and commits it to `supabase/functions/`.
2. Owner re-authors the function from scratch based on observed behaviour + call sites in `web/` and migrations.
3. If neither is possible, the function would need to be rewritten; call sites in `web/` give a partial contract specification (input shape, response fields used).

This is tracked in §6.2 as **ACCESS REQUIRED**.

### 3.3 Android Signing Key — single point of failure (re-verified for Second Review)

**GitHub Actions secrets are write-only after creation.** `settings/secrets/actions` neither the UI nor the REST API expose the plaintext value; the `.github/workflows/android-apk.yml` workflow references them by name only (`${{ secrets.ANDROID_KEYSTORE_BASE64 }}`), and the workflow run logs explicitly mask them.

Therefore the sentence "Supabase service-role / ANTHROPIC_API_KEY / Netlify tokens — in their dashboards" from AI_HANDOVER §10 is correct, but for the Android keystore there is **no upstream service** to re-mint it from: a Play-Store-signed APK cannot be resigned with a new key while keeping the existing installs updatable.

**Possible original backup locations (ACCESS REQUIRED by Owner):**

| Location | How Owner verifies | Result if missing |
|---|---|---|
| Owner's development laptop | Check for `.jks` or `.keystore` file + `keystore.properties` in `C:\Users\Mizanur\Downloads\xzm-team-react-supabase-phase1\xzm-team-erp\web\android\app\` or an off-tree key directory | No off-GitHub copy exists |
| Password manager vault | Check for keystore binary attachment + three passwords (store, key alias, key password) | No off-GitHub copy exists |
| Offline media (external drive, USB) | Owner-controlled; Claude cannot verify | No off-GitHub copy exists |
| Backup drive / cloud storage (OneDrive, Google Drive) | Search filename pattern `*.jks` / `*.keystore` in Owner's backup locations | No off-GitHub copy exists |
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
2. Supabase Dashboard → Database → Backups → pick most recent PITR/daily snapshot before the deletion.
3. Restore into a **new** project (`xzm-team-erp-restore-YYYYMMDD`) — never over production.
4. Extract the affected rows with SQL, review with Owner + ChatGPT, then apply a scoped INSERT back to live under an audited task.
5. Document in `AUDIT_REPORT.md` and `DECISION_LOG.md`.

**Pre-requisite that is ACCESS REQUIRED today:** confirmed PITR window on Supabase Free plan (XZM-006B).

### 4.3 Database migration fails

1. Supabase CLI will stop at the failing migration. Live DB remains at the last successful version.
2. Fix the migration in a **new** file (never edit a shipped file, per CLAUD.txt §4.15).
3. Reapply via `supabase db push` or MCP `apply_migration`.
4. If the failure left partial objects: roll them back with a compensating migration; do not drop manually in Dashboard.

**Pre-requisite that is BACKUP AVAILABLE today:** 141 migration files in repo. **Pre-requisite that is MISSING today:** 14 live-only migrations reconciled to repo (XZM-006C).

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

1. The Owner retains a local clone at `C:\Users\Mizanur\Downloads\xzm-team-react-supabase-phase1\xzm-team-erp`.
2. Push that clone to a new GitHub repo (or GitLab mirror) under an existing owner.
3. Reconfigure Actions secrets (`NETLIFY_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_SERVICES_JSON`, Android signing set).
4. Trigger `android-apk.yml` with `publish_apk=true` to restore site delivery.

**Risk:** if neither GitHub nor the local clone is available, the Android signing key is lost (§3.3 / XZM-006A); and every secret must be re-minted from upstream services.

---

## 5. Preview Environment ↔ Production Database Isolation

Verified read-only via XZM-004R-Final (merged); re-confirmed here.

| Preview path | Could it touch production DB? | Evidence |
|---|---|---|
| Netlify Deploy Preview | **NO — path disabled entirely** | `netlify.toml [context.deploy-preview] ignore = "exit 0"` — Netlify skips preview builds |
| Cloudflare Workers Git-integration preview | **NO — path not used** | `wrangler deploy` runs only from `android-apk.yml` on push main + `web/**`; Cloudflare's own Git auto-build is not configured |
| Supabase preview DB branches | **NO — none exist** | `list_branches` on `ndgnhvbpmtxrpplgsslz` returned `[]` on 2026-11-27 |
| Workflow PR runs reaching live DB | **NO — workflow guards** | `tests.yml` uses a throwaway PostgreSQL 16 per workflow comment: "Nothing here touches the live Supabase project; no secrets are used." |

Production DB is only touched by direct Supabase MCP calls initiated by a trusted operator (Owner, Claude, ChatGPT) with the MCP connector. **No preview or PR path writes to `ndgnhvbpmtxrpplgsslz`.**

---

## 6. New verification items (10 items demanded by Second Review)

### 6.1 Android Signing Key: original backup location

Result per §3.3 — **ACCESS REQUIRED** by Owner. Checks listed; no assumption that GitHub Actions secret is directly exportable.

### 6.2 Supabase Backup Retention, PITR, Database, Auth, Storage recovery coverage

| Sub-item | Status |
|---|---|
| Automated daily backup (Free plan) | **UNVERIFIED** — Supabase docs assert default; dashboard screenshot needed |
| PITR window | **UNVERIFIED** — Free plan default commonly 7 days; dashboard confirmation needed |
| Database schema backup | **BACKUP AVAILABLE** (141 migration files) |
| Database data backup | **ACCESS REQUIRED** (dashboard snapshot read + pg_dump schedule) |
| Auth config (SMTP, hooks, providers) | **MISSING** (not source-controlled) |
| Storage buckets (object listing + export) | **UNVERIFIED** — buckets not enumerated this pass |
| Edge Function secrets | **ACCESS REQUIRED** — write-only once set |
| Realtime config | **UNVERIFIED** |

Tracked as **XZM-006B — Supabase recovery coverage documentation**.

### 6.3 Live vs Repository Migration Drift

Confirmed: 155 live, 141 repo, 14 orphan. Tracked as **XZM-006C**.

### 6.4 Missing Edge Functions — Recovery Feasibility

Per §3.2 — Supabase Management API does not expose deployed source. Owner laptop / backup drive is the only viable source. Tracked as **XZM-006E**.

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
| Supabase DB | Max tolerable data-loss window; max tolerable downtime during restore | RPO ≤ 7 days (PITR) / RTO ~ hours (restore into new project) — both **ACCESS REQUIRED** |
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

## 7. Proposed Sub-tasks — XZM-006A..H

**Conflict check:** No XZM-006A..H letter suffixes exist elsewhere in TASK_TRACKER. Numeric XZM-### IDs reach XZM-017; letter suffixes are a new namespace — **NO CONFLICT, SAFE.**

| ID | Title | Priority | Primary category | Depends on |
|---|---|---|---|---|
| **XZM-006A** | Android Signing Key — off-GitHub export procedure | **CRITICAL** | DS — Database & Security | Owner locates original keystore file |
| **XZM-006B** | Supabase recovery coverage (PITR + Auth + Storage + Realtime) documentation | HIGH | DS | Owner dashboard screenshots |
| **XZM-006C** | Supabase Migration Drift reconciliation (14 orphans) | HIGH | DS | ChatGPT Backend Team review of orphan intent |
| **XZM-006D** | Cloudflare DNS zone export + Workers rollback runbook + Netlify rollback runbook | HIGH | DS + DP | Owner Cloudflare dashboard |
| **XZM-006E** | Missing Edge Functions source recovery (`nodi-route-plan`, `osm-fetch-places`) | HIGH | DS | Owner laptop / backup drive search |
| **XZM-006F** | Git tag policy + tag `24b348d` as `v2026.11.27-live` (or next live SHA) | MEDIUM | DP | — |
| **XZM-006G** | RPO/RTO Owner questionnaire + target definition | MEDIUM | AU | Owner business input |
| **XZM-006H** | 7 Supabase security advisors remediation | MEDIUM | DS | ChatGPT Backend Team review (scope + fix migration) |

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
| 7 | Run one end-to-end restore drill into the `xzm-team-staging` project + a preview Netlify site; document result | MEDIUM | Yes | XZM-006B + XZM-006D |
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
| Owner's local clone path | Owner-stated: `C:\Users\Mizanur\Downloads\xzm-team-react-supabase-phase1\xzm-team-erp` |

---

## 11. Status

- Read-only deep verification **complete**.
- No production restore, DB write, DNS change, code change, or secret exposure occurred.
- Awaiting ChatGPT Independent Second Review → Owner approval for §8 action items under XZM-006A..H.
