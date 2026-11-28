# AUDIT_REPORT

> Rolling log of audit passes। Latest first।

---

## 2026-11-27 (evening) — XZM-006 Backup & Recovery Deep Verification

**Scope:** Full 18-asset backup matrix + 7 disaster-recovery scenarios + Android signing-key off-GitHub backup verification + Supabase/Netlify/Cloudflare rollback + Preview/Production isolation + RPO/RTO gap-analysis.

**Mode:** Read-only — no DB/code/DNS/secret change performed.

**Full report:** `docs/project-control/audits/XZM-006_BACKUP_RECOVERY.md` (replaces prior summary)

**Critical findings:**
- **R-001 CRITICAL** — Android signing key single-point-of-failure. GitHub Actions secrets are **write-only**; only off-GitHub original keystore can serve as backup. Owner verification required → **XZM-006A**.
- **R-004 HIGH** — 2 edge functions (`nodi-route-plan`, `osm-fetch-places`) have no source in repo. Retrievable from live via `supabase functions download` (CLI) or Dashboard Download → **XZM-006E** (re-scoped from "re-author" to "retrieve → review → commit").
- **R-005 HIGH** — No Cloudflare DNS zone export → **XZM-006D**.
- **R-003 HIGH** — Supabase migration drift is **structural in both directions** (29 live-only + 16 repo-only names; 124 + 108 timestamp mismatches; only the first 30 version IDs match). Earlier "14 orphan" arithmetic retired → **XZM-006C** (per-migration decision pass).
- **R-010 HIGH** — Supabase Free plan has **neither PITR nor automatic daily backups** per official docs; no `pg_dump` schedule configured → **XZM-006B** (plan decision + dump schedule).
- **R-011 MED** — Production DB binding to `ndgnhvbpmtxrpplgsslz` is confirmed by inference but not mechanically (Netlify `VITE_SUPABASE_URL` not read this pass) → **XZM-006B.5**.

**Verification result tiering:**
- 5 tiers used throughout: BACKUP AVAILABLE / RESTORE TESTED / UNVERIFIED / MISSING / ACCESS REQUIRED।
- `RESTORE TESTED` = 0 items (no drill performed anywhere); flagged as R-009 → **XZM-006I** Isolated Backup Restore Test (depends on XZM-006B + XZM-006E).

**Isolation (VERIFIED read-only):**
- Netlify Deploy Preview DISABLED (`netlify.toml ignore = exit 0`)।
- Cloudflare Workers Git integration NOT USED (deploy only via `android-apk.yml`)।
- Supabase preview DB branches = 0।
- Production DB write path: Supabase MCP only (trusted operator)।

**Proposed sub-tasks:** **XZM-006A..I** (9 PROPOSED sub-tasks after the 6-point correction pass added XZM-006I; letter-suffix namespace — no conflict with XZM-### numeric IDs).

**Decision:** Owner approval requested on XZM-006A..I as separate PRs post-review.

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

## Priority 01 — ChatGPT Work backend continuation — 2026-11-28 (Asia/Dhaka)

Independent staging catalog baseline: 150 registry rows and 33 public RPC bodies calling the shared release guard. The two follow-on migrations add one registry row, two Accounts wrappers, three Operations writes and three row-scoped Operations reads. This is a partial backend audit. Direct URL/API, cross-scope role/position/user checks, RLS, Storage and Edge Function verification remain open.
