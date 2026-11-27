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
