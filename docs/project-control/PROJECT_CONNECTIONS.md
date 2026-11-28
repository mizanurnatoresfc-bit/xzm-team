# PROJECT_CONNECTIONS

> সকল secret/token/password স্পষ্টভাবে বাদ দেওয়া হয়েছে। শুধু public identifier ও status।
> Last updated: 2026-11-27 (XZM-003 verification results)

---

## 1. GitHub — ✅ VERIFIED

| Field | Value |
|---|---|
| Repository | `mizanurnatoresfc-bit/xzm-team` |
| URL | https://github.com/mizanurnatoresfc-bit/xzm-team |
| Visibility | public |
| Default branch | `main` |
| Push access (this session) | granted |
| Last push observed | 2026-11-27 13:31 UTC |

## 2. Supabase — ✅ VERIFIED

| Field | Value |
|---|---|
| Organization slug | `retfmhtmhhyupfbwjcvd` |
| Dev project name | `xzm-team-erp-dev` |
| Dev project ref | `ndgnhvbpmtxrpplgsslz` |
| Dev region | `ap-southeast-1` |
| Dev DB engine | Postgres 17 |
| Dev status | ACTIVE_HEALTHY |
| Dev created | 2026-11-13 |
| Staging project name | `xzm-team-staging` |
| Staging project ref | `mbpjvqeizwjjsvnbjerb` |
| Staging region | `ap-southeast-1` |
| Staging status | ACTIVE_HEALTHY |
| Staging created | 2026-11-27 |

**Deployed edge functions (per memory, not re-verified in this turn):** `push-send`, `admin-users`, `auth-login`, `nodi-ai`, `nodi-route-plan`, `osm-fetch-places`।

**PENDING VERIFICATION:** কোন branch/project-এ কোন function deployed, RLS policy summary, trigger inventory (`private.prevent_delete`, `private.da_append_only`)।

## 3. Netlify — ✅ VERIFIED NOT PRODUCTION (2026-11-28)

| Field | Status (verified via `.github/workflows/android-apk.yml` + GitHub check-runs) |
|---|---|
| Project name | `xzm-team-erp` (still exists as the historical project) |
| Role in production | **NOT the production host.** Netlify credits ran out on 27 Nov 2026; the Netlify upload step in CI runs with `continue-on-error: true`, and the project's PR deploy-preview is skipped (`netlify.toml [context.deploy-preview] ignore = "exit 0"`). |
| Release-blocker status | **Not a blocker.** The three Netlify check-runs that appear on every PR (`Redirect rules`, `Header rules`, `Pages changed`) resolve as `neutral` by design — not failures. A canceled Netlify deploy-preview on a draft PR is routine Netlify behavior and does not block merge. |
| Source | GitHub repo `mizanurnatoresfc-bit/xzm-team`, workflow step `Publish the website to Netlify (soft)` |

## 4. Cloudflare — ✅ VERIFIED PRODUCTION HOST (2026-11-28)

**Production hosting = Cloudflare Pages project `xzm-team`.**

| Field | Verified value |
|---|---|
| Account | Owner's Cloudflare account (account id held off-repo per §10 redaction policy; email: `mizanurnatore.sfc@gmail.com`) |
| Zone | `xzmteam.com` — status `active` (zone id held off-repo per §10) |
| Pages project (production) | `xzm-team` — production branch `main`, GitHub auto-build on push |
| Custom domains on `xzm-team` project | `xzmteam.com`, `www.xzmteam.com`, `xzm-team.pages.dev` |
| DNS records (both proxied) | `xzmteam.com` CNAME → `xzm-team.pages.dev` (orange cloud ON); `www.xzmteam.com` CNAME → `xzm-team.pages.dev` (orange cloud ON) |
| Pages project (staging) | `xzm-team-staging-web` — custom domain `staging.xzmteam.com` + subdomain `xzm-team-staging-web.pages.dev`, production branch `main`, GitHub auto-build |
| Additional Pages project | `xzm-team-staging` (subdomain-only `xzm-team-staging.pages.dev`, no custom domain, no deployments yet) |
| Cloudflare Worker `xzm-team` | Exists and deployed by `.github/workflows/android-apk.yml` via `wrangler deploy` on push-to-main. **Currently serves no traffic** — zero worker routes in the zone and zero custom domains attached to the worker. The Worker is dormant / backup config; `wrangler.jsonc` at repo root defines it. |
| SSL | Cloudflare proxied (SSL mode managed by zone settings; not yet audited here) |

**Chain:** GitHub `main` push → Cloudflare Pages `xzm-team` auto-build (clone_repo → build → deploy, ~85s total for a React/Vite build) → aliases `xzmteam.com` and `www.xzmteam.com` cut over to the new deployment.

**Verification method (2026-11-28):** `/accounts/*/pages/projects`, `/zones/*/dns_records`, `/zones/*/workers/routes`, `/accounts/*/workers/domains`, and a production deployment of commit `45f527a` (PR #228) end-to-end observed through the stage history.

## 5. Figma — ⏳ PENDING VERIFICATION

| Field | Status |
|---|---|
| Connected (org-level) | ✅ (ListConnectors) |
| XZM TEAM design file exists | PENDING |
| Design system / libraries | PENDING |

## 6. Subframe — ⏳ PENDING VERIFICATION

| Field | Status |
|---|---|
| Connected (org-level) | ✅ (ListConnectors) |
| XZM TEAM project exists | PENDING |

## 7. Other Connectors (Installed, org-level)

| Connector | enabledInChat |
|---|---|
| Stewdio | ✅ |
| Google Drive | ❌ (not connected) |

## 8. Live Website Deployment Source — ✅ VERIFIED (2026-11-28)

- **Verified chain:** GitHub `main` → Cloudflare Pages project `xzm-team` auto-build (production branch `main`) → aliases `https://xzmteam.com` + `https://www.xzmteam.com`. DNS (proxied CNAME to `xzm-team.pages.dev`) sits in the same Cloudflare zone.
- **Netlify is NOT in the production chain** (see §3). Cloudflare Worker `xzm-team` is also NOT in the serving path (see §4).
- **Staging chain:** GitHub `main` → Cloudflare Pages `xzm-team-staging-web` → `https://staging.xzmteam.com`.
- **Reference evidence:** DEPLOYMENT_LOG.md 2026-11-28 DE-V2-R1 entry — full stage timing for commit `45f527a`.

## 9. Secrets Policy

- কোনো API key, token, service-role key, password এই Documentation-এ লেখা হবে না।
- Secret management Supabase/Netlify/Cloudflare dashboard-এ নিজ নিজ স্থানে থাকবে।
- `ANTHROPIC_API_KEY` Supabase edge function secret হিসেবে configured (memory-reference only)।

## 10. Operational Identifiers — Redaction Policy *(XZM-004R-Final, 2026-11-27)*

ChatGPT Second Review directed that avoidable operational-security details be scrubbed from public-repo docs. এই section-এ redaction policy এবং current state:

### 10.1 Redacted from public docs (removed in XZM-004R-Final commit)

| Identifier class | Previous location | Replacement |
|---|---|---|
| Owner email | `AI_HANDOVER.md` §5 (Cloudflare row), `PROJECT_CONNECTIONS.md` §10 initial version | Replaced with "Owner's Cloudflare account (email held off-repo)" |
| Cloudflare numeric account ID | `AI_HANDOVER.md` §5 | Removed; wrangler config still shows service name only |

### 10.2 Kept as low-sensitivity operational identifiers

এগুলো public artifacts (deploy URLs, REST hostnames) থেকেই inferable, তাই repo-তে রাখা হয়েছে:

| Identifier | Justification |
|---|---|
| Supabase dev project ref `ndgnhvbpmtxrpplgsslz` | Already exposed via `https://ndgnhvbpmtxrpplgsslz.supabase.co` — Access control is RLS + anon key policy |
| Supabase staging ref `mbpjvqeizwjjsvnbjerb` | Same reasoning |
| Netlify site ID `2909a0bd-55bc-4b11-930f-73750fb34bd4` | UUID identifier only; no access without NETLIFY_AUTH_TOKEN secret |
| Netlify project name `xzm-team-erp` | Public via `xzm-team-erp.netlify.app` subdomain |
| Android `appId com.xzmteam.erp` | Public via Play Store |

### 10.3 Confirmed absent from repo-tracked docs (grep-verified 2026-11-27)

- ❌ No API key (Anthropic, OpenAI, Supabase service-role, Netlify auth token, GitHub PAT, Cloudflare API token, Firebase/APNs key)
- ❌ No DB password, SMTP creds, OAuth client secret
- ✅ `ANTHROPIC_API_KEY` lives in Supabase edge function secrets only
- ✅ `NETLIFY_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANDROID_KEYSTORE_*`, `GOOGLE_SERVICES_JSON` all live in GitHub Actions secrets only (referenced by name in `android-apk.yml`)

### 10.4 Preview environment binding verification (XZM-004R-Final, 2026-11-27, read-only MCP)

| Preview surface | Status | Evidence |
|---|---|---|
| Netlify Deploy Preview | **DISABLED** (owner decision 2026-11-22) | `netlify.toml [context.deploy-preview] ignore = "exit 0"` — Netlify skips builds for PRs; no preview URL produced, no DB binding exposure |
| Cloudflare Workers Git integration | **NOT USED** | `wrangler.jsonc` deployed only from `.github/workflows/android-apk.yml` via `wrangler deploy` on push-to-main with `web/**` paths; no Cloudflare Git auto-build for PRs |
| Supabase preview DB branches | **NONE EXIST** | `list_branches` on `ndgnhvbpmtxrpplgsslz` returned `[]` on 2026-11-27 — no PR-triggered DB branches |
| Netlify preview environment bindings | **N/A** (no previews) | No preview build → no env var inheritance to verify |
| Cloudflare preview bindings | **N/A** (no previews) | Same reason |
| Production environment variables (public vs secret) | **VERIFIED PUBLIC-SAFE** | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are publishable anon values; `.env.production` grep in workflow blocks `sb_secret` and `service_role` patterns before build |

**UNVERIFIED (would require Owner-controlled dashboard access):**
- Netlify auto-build-on-main setting (production branch build trigger) — workflow comment says "Netlify runs no build of its own, so this does not use Netlify build minutes/credits," which implies auto-build is OFF; dashboard confirmation pending।
- Cloudflare dashboard-level "Git integration" explicit disabled state (we confirmed deploy flows through wrangler-in-CI, but dashboard toggle not read)।

**Recommendation:** Owner can VERIFY both UNVERIFIED items directly in Netlify + Cloudflare dashboards and append to this section।
