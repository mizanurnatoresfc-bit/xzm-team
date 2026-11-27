# AUDIT_REPORT

> Rolling log of audit passes। Latest first।

---

## 2026-11-27 — Workspace & Connection Audit (XZM-002 + XZM-003)

**Scope:** GitHub repo, Supabase projects, connector install status।

**Findings (VERIFIED):**
- GitHub repo `mizanurnatoresfc-bit/xzm-team` public, default branch `main`, push access OK।
- Supabase org `retfmhtmhhyupfbwjcvd` — two ACTIVE_HEALTHY projects:
  - `xzm-team-erp-dev` (`ndgnhvbpmtxrpplgsslz`, created 2026-11-13)
  - `xzm-team-staging` (`mbpjvqeizwjjsvnbjerb`, created 2026-11-27) — **newly spotted**
- Connectors installed & connected: GitHub, Supabase, Netlify, Cloudflare, Figma, Subframe, Stewdio।
- Google Drive not connected।

**Findings (PENDING VERIFICATION):**
- Netlify site ID, production branch, deploy source।
- Cloudflare DNS, SSL, proxy config।
- Figma / Subframe actual project existence under XZM TEAM naming।
- Android source location + current version string।

**Action:** XZM-005-এ Netlify, Cloudflare, Figma/Subframe verification সম্পন্ন করতে হবে।

## Pre-tracker (historical, per memory)

- Append-only triggers on `da_*` tables confirmed by owner।
- Hub isolation enforced; hub switcher consolidated to global header।
- Route pages audit — `/app/zonal/routes` already clean (no merge needed)।
- HR page cleanup done — no stale routes left live।
