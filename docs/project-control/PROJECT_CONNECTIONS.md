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

## 10. Operational Identifiers Review *(XZM-004R Review-Response, 2026-11-27)*

ChatGPT Independent Review requested review of operational security details present in public-repo docs. এগুলো **secret নয়**, কিন্তু public exposure-এর কারণে Owner-এর জন্য awareness flag:

| Identifier | Where it appears | Sensitivity | Owner action required? |
|---|---|---|---|
| Supabase dev project ref `ndgnhvbpmtxrpplgsslz` | `PROJECT_CONNECTIONS.md` §2, `AI_HANDOVER.md` §5 | LOW — already public via REST URL pattern `https://ndgnhvbpmtxrpplgsslz.supabase.co` | No — RLS + anon key policy handles access control |
| Supabase staging ref `mbpjvqeizwjjsvnbjerb` | same | LOW — same reasoning | No |
| Netlify site ID `2909a0bd-55bc-4b11-930f-73750fb34bd4` | `AI_HANDOVER.md` §5 | LOW — UUID is identifier only; not usable without token | No |
| Cloudflare account ID `80d49a409ddcfa2db3c7289621ce19ba` | `AI_HANDOVER.md` §5 | LOW — account ID is public in Workers URLs | No |
| Owner email `mizanurnatore.sfc@gmail.com` | `AI_HANDOVER.md` §5 | MED — PII, already visible in git commit author history | Owner choice: redact to `[owner]` in docs or leave as-is (commit history shows it anyway) |
| Android `appId com.xzmteam.erp` | Multiple docs | LOW — public via Play Store | No |

**Actual secrets confirmed absent from this PR / repo-tracked docs:**
- ❌ No API key, service-role key, Netlify auth token, GitHub PAT, Cloudflare API token, Firebase/APNs key, ANTHROPIC_API_KEY, SMTP creds, DB password, OAuth client secret।
- ✅ Audited by file grep against `docs/project-control/` on 2026-11-27 — zero hits for common secret patterns।

**Recommendation to Owner:** Decide whether owner-email should be redacted in future docs। The listed UUIDs/IDs are operational identifiers that do not grant access on their own, so no remediation is urgent। If any of the above were previously treated as confidential, flag the specific item and a separate task will scrub it from the repo history।
