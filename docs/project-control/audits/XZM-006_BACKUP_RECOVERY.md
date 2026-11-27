# XZM-006 — Backup & Recovery Verification

**Status:** UNDER_REVIEW (awaiting ChatGPT Independent Review → Owner approval)
**Date:** 2026-11-27 (Asia/Dhaka)
**Mode:** Read-only audit — no code, DB, DNS or production change.
**Source HEAD:** `2836a07a96d5053938fdaed6bff22273558e7977` (main)

> Source: this report was first delivered via the Claude Project `claude/BACKUP_RECOVERY.md`. XZM-004R consolidates it into the central documentation canon. Content is preserved verbatim from that source.

---

## 1. Verified environment

| Component | Identity | Status |
|---|---|---|
| GitHub repo | `mizanurnatoresfc-bit/xzm-team` (public) | VERIFIED |
| Active branch | `main` (HEAD `2836a07`, PR #208) | VERIFIED |
| Tags / Releases | **none** | VERIFIED (empty `git tag -l`) |
| Web source | `web/` — React 19 + Vite + TypeScript + Capacitor | VERIFIED |
| Android source | Capacitor wrapper of `web/` (`appId: com.xzmteam.erp`) | VERIFIED |
| Supabase project | `ndgnhvbpmtxrpplgsslz` = `xzm-team-erp-dev`, PG 17.11, ap-southeast-1, `ACTIVE_HEALTHY` | VERIFIED |
| Supabase migrations | **155 live** vs **141 files in repo** | VERIFIED — 14 drift |
| Edge Functions live | `auth-login`, `admin-users`, `push-send`, `nodi-ai`, `nodi-route-plan`, `osm-fetch-places` | VERIFIED |
| Edge Functions in repo | `auth-login`, `admin-users`, `push-send`, `nodi-ai` only | VERIFIED — 2 missing |
| Netlify site | `xzm-team-erp` id `2909a0bd-55bc-4b11-930f-73750fb34bd4`, Free plan | VERIFIED |
| Live URL | `https://xzmteam.com` (deploy `6b071e18955520628c7d0bb0` ready) | VERIFIED |
| Cloudflare | `mizanurnatore.sfc@gmail.com`; Workers mirror via `wrangler.jsonc` | VERIFIED (connection only) |
| CI/CD | `android-apk.yml`, `website.yml`, `tests.yml` | VERIFIED |

---

## 2. Backup availability vs Restore tested (summary)

Full matrix of 18 assets delivered in source report. Highlights:

- **CRITICAL:** Android signing key exists ONLY in GitHub Actions secrets. No off-platform backup.
- **HIGH:** No Cloudflare DNS zone export for `xzmteam.com`.
- **HIGH:** 14-migration drift between live Supabase and repo.
- **HIGH:** `nodi-route-plan` and `osm-fetch-places` edge functions have no source in repo.
- **MEDIUM:** No git tags — rollback requires commit SHA.
- **MEDIUM:** 7 Supabase security advisors open (1 ERROR, 5 WARN, 1 INFO).
- **MEDIUM:** No documented end-to-end restore drill.

---

## 3. Owner Action Items (recommended, not executed)

| # | Action | Priority |
|---|---|---|
| 1 | Export Android signing keystore to encrypted off-GitHub storage (password manager + offline media) | **CRITICAL** |
| 2 | Export Cloudflare zone file for `xzmteam.com` | HIGH |
| 3 | Reconcile 14-migration drift live vs repo | HIGH |
| 4 | Commit source for `nodi-route-plan` and `osm-fetch-places` | HIGH |
| 5 | Verify Supabase Free-plan backup retention; monthly `pg_dump` export | HIGH |
| 6 | Tag `2836a07` as `v2026.11.27-live` | MEDIUM |
| 7 | End-to-end restore drill into disposable Supabase + preview Netlify | MEDIUM |
| 8 | Resolve 7 Supabase security advisors | MEDIUM |

---

## 4. Recovery scenarios

Documented in source: (4.1) website break, (4.2) data deletion, (4.3) migration failure, (4.4) login/role break, (4.5) Android update failure, (4.6) DNS break, (4.7) GitHub unavailable. Each procedure requires Owner approval + explicit Task ID before execution.

---

## 5. Compliance

- ✅ No code, DB, DNS or production change executed.
- ✅ No Supabase migration / execute_sql run.
- ✅ No Netlify / Cloudflare / GitHub push.
- ✅ All reads scoped to shallow clone at HEAD `2836a07`.
- ✅ Awaiting ChatGPT Independent Review → Owner approval for §3 action items under separate Task IDs.

---

**Source of truth:** `claude/BACKUP_RECOVERY.md` in the Claude Project; this file is the consolidated central-doc copy preserved for ChatGPT visibility on GitHub.
