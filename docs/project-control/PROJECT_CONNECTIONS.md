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

## 3. Netlify — ⏳ PENDING VERIFICATION

| Field | Expected (per memory) | Verified? |
|---|---|---|
| Project name | `xzm-team-erp` | PENDING |
| Plan | free dev plan | PENDING |
| Production URL | https://xzmteam.com | PENDING |
| Site ID | — | PENDING |
| Deployment source | GitHub repo `mizanurnatoresfc-bit/xzm-team` | PENDING |
| Production branch | expected `main` | PENDING |

> XZM-003 continuation-এ Netlify step এখনো সম্পন্ন হয়নি।

## 4. Cloudflare — ⏳ PENDING VERIFICATION

| Field | Status |
|---|---|
| Account / Zone | PENDING |
| Domain `xzmteam.com` | PENDING |
| DNS records | PENDING |
| Proxy status (orange cloud) | PENDING |
| SSL mode | PENDING |
| Wrangler project | `wrangler.jsonc` exists in repo root — PENDING review |

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

## 8. Live Website Deployment Source

- **Expected chain:** GitHub `main` → Netlify `xzm-team-erp` → `https://xzmteam.com` (DNS via Cloudflare)।
- **Verified:** GitHub repo ও branch নাম।
- **PENDING VERIFICATION:** Netlify build settings, Cloudflare DNS, actual deploy hook।

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
