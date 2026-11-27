# XZM-006B — Supabase Backup Plan: Production Identification + DB/Schema/Auth/RLS/RPC/Storage + Daily Automation + Retention/Cost/Recovery

**Status:** UNDER_REVIEW — read-only verification + plan complete 2026-11-27
**Parent:** XZM-006 (merged in PR #214, commit `b94e5d1`)
**Mode:** Read-only — MCP SELECT queries against production only; no `apply_migration`, no `execute_sql` writes, no Storage reads of object bytes, no Edge Function deploy, no secret rotation, no production change.
**Priority:** P1 (HIGH) — Risks R-010 (no PITR + no daily backups on Free) and R-011 (production binding unconfirmed)

---

## 1. Production Supabase project — identification

### 1.1 Candidate projects in Owner's Supabase org

From MCP `list_projects` (org `retfmhtmhhyupfbwjcvd`):

| Project ref | Name | Region | Postgres | Status | Created | Role |
|---|---|---|---|---|---|---|
| `ndgnhvbpmtxrpplgsslz` | `xzm-team-erp-dev` | ap-southeast-1 | 17.11 | ACTIVE_HEALTHY | (pre-2026-11-11) | **PRODUCTION** (despite "-dev" suffix) |
| `mbpjvqeizwjjsvnbjerb` | `xzm-team-staging` | ap-southeast-1 | 17.12 | ACTIVE_HEALTHY | 2026-11-27 | **STAGING** (restore-drill target; no production traffic) |

### 1.2 Evidence that `ndgnhvbpmtxrpplgsslz` is production

Measured via read-only MCP calls against the project itself on 2026-11-27 (`get_project_url`, `execute_sql`, `list_edge_functions`):

| Signal | Value | Why it identifies production |
|---|---|---|
| Public API URL | `https://ndgnhvbpmtxrpplgsslz.supabase.co` | This is the host the deployed frontend's `supabase-js` client calls; the URL is embedded in every live site build |
| Edge Functions ACTIVE | `auth-login`, `admin-users`, `push-send`, `nodi-ai`, `nodi-route-plan`, `osm-fetch-places` | All six functions referenced by `web/` call sites run here; no other project in the org hosts these |
| Tables in `public` | **181** | Matches the live schema expected by the current frontend |
| RLS-enabled tables | **181 / 181** | Complete RLS coverage — a production posture |
| RLS policies | **255** | Matches the application's role-based access expectations |
| RPC functions in `public` | **468** | Frontend `rpc(…)` call sites compile against this set |
| Storage buckets | **7** (all private) — `da-evidence`, `employee-docs`, `issue-photos`, `office-docs`, `sorting-slips`, `vehicle-docs`, `wf-leave` | These are the same bucket names the frontend uploads to |
| `auth.users` rows | **85** | Real staff accounts |
| Database size | **~200 MB** (210,417,331 bytes) | Consistent with weeks of production use |
| Applied migrations | **155** (per XZM-006 audit §3.1) | Only project with the full migration history; staging has none applied |

### 1.3 What is NOT mechanically confirmed in this session

The frontend's `VITE_SUPABASE_URL` value is **not stored in the repo** — it is held in Netlify Site Settings → Build & deploy → Environment and in GitHub repo variables (referenced by `android-apk.yml` as `vars.VITE_SUPABASE_URL`). Neither this session's MCP tools nor the Netlify connector in this session expose variable VALUES (they return project metadata, not env contents). Confirmation that the live site is bound to `ndgnhvbpmtxrpplgsslz` is therefore read-after-write only: Owner opens Netlify Site Settings and reads the value, or Claude queries the live site via a build-inspection endpoint which this session's network allowlist does not permit.

**Owner verification step:** Open Netlify Dashboard → `xzm-team-erp` → Site Settings → Build & deploy → Environment → confirm `VITE_SUPABASE_URL` equals `https://ndgnhvbpmtxrpplgsslz.supabase.co`. Record the value (not the anon key) in `docs/project-control/PROJECT_CONNECTIONS.md` under §10 operational identifiers, with an explicit annotation: *"the project named `xzm-team-erp-dev` holds production traffic despite its `-dev` suffix; the suffix is a historical misnomer."*

---

## 2. What exists today on production — scope of a backup

Measured 2026-11-27 via read-only MCP:

| Surface | What a backup must capture | Current magnitude |
|---|---|---|
| `public` schema DDL | 181 tables + 1 view + 468 RPC functions, with triggers, indexes, sequences, types | Known; ~200 MB total DB size |
| RLS | 255 policies attached to 181 tables (full coverage) | Travels with DDL |
| Append-only / prevent-delete triggers (private.*) | `private.prevent_delete`, `private.da_append_only` — applied across every `da_*` table | Travels with DDL |
| Public data rows | 85 users + operational rows (attendance, deliveries, cash, etc.) | ~200 MB total |
| Auth (`auth` schema) | 85 users + sessions + identities + auth hooks | Travels with a full DB dump |
| Auth configuration (NOT in DB) | SMTP settings, redirect URLs, provider configs, custom Access Token Hook attachment | Dashboard-only; see §4.3 |
| Edge Function **source** | 4 of 6 in repo; 2 (`nodi-route-plan`, `osm-fetch-places`) retrievable via `supabase functions download` — see **XZM-006E** | Repo is primary |
| Edge Function **secrets** | `ANTHROPIC_API_KEY` (set, write-only), plus any per-function secrets | Dashboard-only; see §4.4 |
| Storage objects | 40 objects across 7 buckets; total ~5.5 MB (36 in `employee-docs`, 4 in `da-evidence`, 0 in the other 5) | Needs its own path — see §3.3 |
| Storage bucket config | file-size limits, MIME restrictions, RLS | Covered by DB dump + a bucket-config JSON snapshot |
| Realtime config | channel policies | Dashboard-only |
| Migrations file history | 141 files in repo (structural drift documented under XZM-006C) | Repo |

---

## 3. Backup plan — daily automated, three-layer

### 3.1 Design principles

- **Repo is the source of truth for structure.** Schema (`supabase/migrations/`), edge-function source (`supabase/functions/`) and RLS/RPC (embedded in migrations) live in Git. A fresh repo + a fresh empty Supabase project must rebuild the structure without calling any backup.
- **Daily off-platform dump is the source of truth for data.** On Free plan the dashboard offers no automatic backup; a scheduled GitHub Action runs `pg_dump` and uploads the compressed, encrypted artifact to an off-platform store.
- **Storage objects are copied per bucket.** `supabase` CLI has no built-in bulk download; the backup job streams objects via the Management API.
- **Dashboard-only surfaces are documented, not dumped.** SMTP, redirect URLs, provider configs, Edge Function secrets, Realtime config — none are in the DB; they go into a human-maintained inventory under `docs/project-control/supabase-config/` that the Owner updates whenever they change in the dashboard.

### 3.2 Layer A — Daily DB dump (GitHub Actions)

A new workflow `.github/workflows/supabase-daily-backup.yml` (opened in the follow-up **XZM-006B-impl** PR, NOT in this docs PR) runs on `schedule: cron: '0 20 * * *'` (02:00 Asia/Dhaka, off-peak) with a manual `workflow_dispatch`. Steps:

1. Install Supabase CLI.
2. `supabase db dump --db-url "$SUPABASE_DB_URL" --schema public,storage,auth -f dump-public-auth-storage.sql` (schema + data for the three application schemas).
3. `supabase db dump --db-url "$SUPABASE_DB_URL" --role-only -f dump-roles.sql` (roles / grants).
4. `gzip` + `gpg --symmetric --cipher-algo AES256 --batch --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE")` → single file `xzm-db-YYYYMMDD.sql.gz.gpg`.
5. Upload to the target storage (one of §3.5).
6. Record the file's SHA-256 and size in a tiny `BACKUP_LOG.md` committed back to `main` on a `backup-log/` branch via a bot PR (append-only).

**Required GitHub Actions secrets** (to be set by Owner in the follow-up PR, not here):

- `SUPABASE_DB_URL` — full connection string (held off-repo; Owner pastes from Supabase Dashboard → Project Settings → Database → Connection string).
- `BACKUP_PASSPHRASE` — symmetric passphrase for the dump bundle; Owner also stores it in their password manager.
- Target-specific secrets per §3.5.

### 3.3 Layer B — Storage object snapshot (same workflow, parallel job)

The DB dump captures the `storage.objects` **metadata rows** but not the object bytes. Daily, the same workflow:

1. Lists objects per bucket via the Management API.
2. Streams each object's bytes to a `storage/<bucket>/<path>` tree.
3. Tars + gzips + gpg-encrypts the tree as `xzm-storage-YYYYMMDD.tar.gz.gpg`.
4. Uploads alongside the DB dump.

Today the total storage is ~5.5 MB (40 objects), so this is cheap. Growth is expected; §5 covers cost at scale.

### 3.4 Layer C — Documentation snapshot (manual, weekly)

Every Monday 08:00 Asia/Dhaka (Owner's weekly review slot): Owner opens the dashboard and re-reads four pages, updating `docs/project-control/supabase-config/` whenever a value has changed:

| Page | File to update |
|---|---|
| Auth → SMTP + Providers + URL Config | `supabase-config/auth.md` |
| Auth → Hooks | `supabase-config/auth-hooks.md` |
| Edge Functions → Secrets (names only, values never recorded) | `supabase-config/edge-function-secrets.md` |
| Realtime → Policies | `supabase-config/realtime.md` |

### 3.5 Where the encrypted dumps land — three options ranked by fit

| # | Target | Pros | Cons | Monthly cost (projection at 500 MB dump + 100 MB storage, 30-day retention) |
|---|---|---|---|---|
| **1 (recommended)** | **Cloudflare R2** bucket owned by Owner's Cloudflare account | Owner already uses Cloudflare; no cross-vendor contract; egress-free from Workers; S3-compatible API; 10 GB free then $0.015/GB/mo | Needs one new R2 API token scoped write-only to this bucket | **$0** (under 10 GB free tier) |
| 2 | **GitHub Releases** (as workflow artifacts attached to a nightly release) | Same vendor as the workflow; free; retention-configurable | Single-vendor lock-in with the repo itself (losing GitHub loses the backup too); GitHub Release asset size limit 2 GB per file | **$0** but single-vendor risk |
| 3 | **Supabase Storage on the `xzm-team-staging` project**, bucket `backups` | Keeps the backup inside the Owner's existing accounts; staging project's storage is separate from production | Same vendor as production (correlated-failure risk if Supabase org is compromised); Free plan storage ceiling 1 GB | **$0** until 1 GB |

**Recommendation:** go with **R2** as primary, with a weekly copy to **GitHub Releases** as secondary (gives independent-vendor redundancy at zero cost). Staging-project storage is explicitly NOT a backup target — it would violate the XZM-006I "no shared production bindings" constraint for the restore drill.

---

## 4. Retention, cost, and the Free-vs-Pro plan choice

### 4.1 Supabase plan options for the production project

Verified 2026-11-27 against `https://supabase.com/pricing` and `https://supabase.com/docs/guides/platform/backups`:

| Option | Monthly $ | What it gives | What stays missing |
|---|---|---|---|
| **A. Stay on Free + build Layer A/B/C** | $0 | Daily off-platform dumps; weekly doc snapshot | No in-dashboard PITR; restore to a new project needs manual `psql <` of the decrypted dump |
| **B. Upgrade to Pro ($25/mo)** | **$25** | 7 days of daily automatic backups visible in dashboard; one-click restore to a new project; also lifts the 500 MB DB / 1 GB storage limits to 8 GB / 100 GB | No PITR until add-on |
| **C. Pro + PITR add-on (7-day)** | **$25 + ~$100 = $125** | Up to 2-minute RPO; recovery to any second in the last 7 days | Add-on is not covered by the spend cap |
| D. Pro + PITR 14-day | ~$225 | 14-day second-granular window | — |
| E. Pro + PITR 28-day | ~$425 | 28-day second-granular window | — |

(The $100 figure for 7-day PITR is from the current PITR usage documentation at `https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery`; it is a monthly usage charge, not covered by any spend cap.)

### 4.2 Recommended choice at today's scale

Current DB is **~200 MB** (well inside Free's 500 MB) and current storage is **~5.5 MB** (well inside Free's 1 GB). So the Owner has three realistic choices, ranked:

1. **Free + Layer A/B/C** — $0/month. Best for cost right now. RPO = up to 24 h (one dump per day). RTO measured by XZM-006I.
2. **Pro (no PITR)** — $25/month. One-click dashboard restore + 7 days of daily auto-backups + comfortable headroom for DB growth past 500 MB. RPO = up to 24 h. RTO = minutes via dashboard. **Still worth running Layer A/B/C** on top, because dashboard backups cannot be exported off-platform — if the Supabase project itself is lost, Pro's backups go with it.
3. **Pro + PITR 7d** — $125/month. RPO = minutes. Only justified once operational data (staff daily accounts, deliveries, cash) crosses the threshold where a 24-h data-loss window would be unacceptable.

**Decision owned by Owner.** If kept on Free, Layer A/B/C is **mandatory** (today no automatic backup exists). If moved to Pro, Layer A/B/C remains **recommended** for off-platform independence.

### 4.3 Retention policy for the encrypted dumps

Default proposal (adjustable by Owner):

- **Daily dumps**: keep the last 14 days.
- **Weekly dumps** (first dump of each ISO week): keep the last 12 weeks.
- **Monthly dumps** (first dump of each calendar month): keep the last 12 months.

Total steady-state at 500 MB dump size: 14 × 500 MB + 12 × 500 MB + 12 × 500 MB ≈ 19 GB — still inside R2 free allowance when storage is split between daily/weekly/monthly prefixes. At today's actual ~200 MB dump size it is ~7.6 GB.

### 4.4 Auth config, Edge Function secrets, SMTP — outside DB dump

Not captured by `pg_dump`. For each, the recovery path and current state:

| Surface | Lives in | Recovery path | State today |
|---|---|---|---|
| SMTP | Dashboard → Auth → SMTP | Re-enter from `supabase-config/auth.md` (§3.4 doc snapshot) | Not inventoried yet |
| Redirect URLs | Dashboard → Auth → URL Configuration | Re-enter from `supabase-config/auth.md` | Not inventoried yet |
| Providers (Google, email, phone) | Dashboard → Auth → Providers | Re-enter from `supabase-config/auth.md` | Not inventoried yet |
| Access Token Hook | Dashboard → Auth → Hooks | Re-attach `public.custom_access_token_hook` (its code IS in migrations) | Hook function in DB; attachment NOT in DB |
| Edge Function secrets | Dashboard → Edge Functions → Secrets | Re-mint from upstream vendor (Anthropic console for `ANTHROPIC_API_KEY`, etc.); names tracked in `supabase-config/edge-function-secrets.md` | Not inventoried yet |
| Realtime config | Dashboard → Realtime | Re-enter from `supabase-config/realtime.md` | Not inventoried yet |

All six are opened as sub-steps of XZM-006B-impl.

---

## 5. Recovery procedure (summary — full drill owned by XZM-006I)

Given a target empty Supabase project (e.g. `xzm-team-restore-YYYYMMDD` created on the day of the incident):

1. **Decrypt and ungzip** the latest `xzm-db-YYYYMMDD.sql.gz.gpg` on a trusted machine. The GPG passphrase comes from the Owner's password manager.
2. **Apply roles first**: `psql "$RESTORE_DB_URL" < dump-roles.sql`.
3. **Apply schema + data**: `psql "$RESTORE_DB_URL" < dump-public-auth-storage.sql`.
4. **Restore Storage object bytes**: decrypt `xzm-storage-YYYYMMDD.tar.gz.gpg`, replay each file into its bucket via the Management API (`POST /storage/v1/object/{bucket}/{path}`).
5. **Re-enter dashboard-only config** from `docs/project-control/supabase-config/` (SMTP, redirect URLs, providers, Access Token Hook attachment, Realtime policies, Edge Function secrets re-minted from upstream).
6. **Re-deploy Edge Functions** from `supabase/functions/` with `supabase functions deploy` (after XZM-006E commits the missing two sources).
7. **Point the frontend** at the restored project by updating `VITE_SUPABASE_URL` in Netlify Site Settings; redeploy.
8. **Smoke-test**: login, one DB read, one DB write, one Edge Function call.

RPO / RTO targets are collected under **XZM-006G** and measured under **XZM-006I**; today, before Layer A/B/C is live, RPO is effectively unbounded.

---

## 6. Compliance

- ✅ No production write. All MCP queries were SELECT-only.
- ✅ No Storage object bytes read in this session.
- ✅ No Supabase dashboard secret printed or recorded.
- ✅ No Edge Function deployed; no `supabase functions download` run.
- ✅ No GitHub Actions workflow added in this PR; the backup workflow is specified here and will be opened under XZM-006B-impl after plan approval.
- ✅ No live site configuration changed.
- ✅ No secret values moved between stores.

---

## 7. Owner action items (gated on plan decision)

| # | Action | Blocks |
|---|---|---|
| 1 | Open Netlify Site Settings → confirm `VITE_SUPABASE_URL` points to `https://ndgnhvbpmtxrpplgsslz.supabase.co`; record in PROJECT_CONNECTIONS.md §10 with the production-despite-name annotation | R-011 MITIGATED |
| 2 | Decide plan option A / B / C per §4.1–§4.2 | §3 workflow implementation |
| 3 | Decide primary backup target per §3.5 (recommend R2) and provision the bucket + write-scoped token | XZM-006B-impl |
| 4 | Create GitHub Actions secrets `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, and target-specific secrets | XZM-006B-impl |
| 5 | Approve the retention policy in §4.3 (daily 14 / weekly 12 / monthly 12) or propose different numbers | XZM-006B-impl |
| 6 | Weekly: maintain the `supabase-config/*.md` inventory per §3.4 | — (ongoing) |

---

## 8. What the follow-up implementation PR will add

(Opened as **XZM-006B-impl** once §7 items 1–5 are decided.)

- `.github/workflows/supabase-daily-backup.yml` — the scheduled daily workflow (Layers A + B).
- `docs/project-control/supabase-config/` folder with four seed files for the §3.4 weekly inventory.
- `docs/project-control/PROJECT_CONNECTIONS.md` §10 updated with the confirmed `VITE_SUPABASE_URL` and the "production despite its name" annotation.
- `RISK_REGISTER.md` R-010 and R-011 → MITIGATED once the first green workflow run is recorded.
- `BACKUP_LOG.md` seeded; the workflow appends a line per successful run.
