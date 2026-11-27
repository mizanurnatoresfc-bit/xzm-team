# XZM-007A/B-3 — Batch 3 Correction (Post ChatGPT Independent Review)

**Status:** UNDER_REVIEW
**Mode:** Read-only — no code, DB, DNS or production change.
**Date:** 2026-11-27 (Asia/Dhaka)
**Source HEAD:** `2836a07a96d5053938fdaed6bff22273558e7977`
**Reason for Correction:** ChatGPT Independent Review Decision (REVIEWED / CORRECTION REQUIRED, 2026-11-27).

> Companion file to `XZM-007AB-3_BATCH3_ZONAL_DUTY_AUDIT.md`. Both MUST be read together.

---

## A.1–A.2. Verification Tier Recount

### Tier definitions

| Tier | Meaning |
|---|---|
| **SOURCE VERIFIED** | Source file (TSX/TS/SQL) পড়ে code-এ feature exists confirm — but no live runtime check. |
| **RUNTIME VERIFIED** | Supabase MCP / live URL / production log / E2E test-এ execute করে যাচাই। |
| **UNVERIFIED** | Source-এও মেলেনি অথবা mapping নেই; runtime check-ও হয়নি। |

**Batch 3 audit mode:** zero RPC executions, zero browser flow tests, zero Netlify/Supabase live hits. All "VERIFIED" entries are actually **SOURCE VERIFIED**. **RUNTIME VERIFIED = 0**.

### Corrected Summary Table

| Area | SOURCE VERIFIED | SOURCE PARTIAL | NOT FOUND | RUNTIME VERIFIED | ACCESS REQUIRED |
|---|---|---|---|---|---|
| 1. Zonal Management (9 items) | 7 | 2 | 0 | 0 | 2 |
| 2. Employee & Duty (15 items) | 13 | 2 | 0 | 0 | 2 |
| 3. Planning & Control (5 items) | 3 | 2 | 0 | 0 | 1 |
| **Total (29 items)** | **23** | **6** | **0** | **0** | **5** |

**Original error:** total "20 items" was a counting mistake. Correct total = 9+15+5 = 29.
**Original error:** "ACCESS REQUIRED 0" was wrong — 5 items need runtime check.

---

## A.3. Additional Planning & Control Questions (Q.3.6–Q.3.11)

| # | Question | Answer |
|---|---|---|
| Q.3.6 | Pickup / Delivery Return হিসাব হয় কি না? | **SOURCE VERIFIED** — `DailyOpsCard.tsx:17–22` FIELDS = pickup/pickup_return/delivery/delivery_return → `wf_daily_ops` table. |
| Q.3.7 | কে বেশি/কম data entry দিলে system pattern বোঝে কি? | **NOT FOUND (Finding G-6)** — no fairness-index code. Policy gap. |
| Q.3.8 | Hub-wise Ops Report দৈনিক ৩ বার জমা হয়? | **SOURCE PARTIAL (Finding G-7)** — `hub_ops_reports` has only `report_date`; no `slot`/`shift` field. |
| Q.3.9 | Route Approval chain multi-stage? | **SOURCE VERIFIED** — draft → sent → approved → reopen chain in migration `20261122000500_route_day_plan.sql`. |
| Q.3.10 | Published plan auto-push to rider app? | **SOURCE PARTIAL (Finding G-8)** — approval does not auto-push; hub manager "আবার পাঠান" button needed. |
| Q.3.11 | Delivery Point Excel import/export? | **SOURCE PARTIAL** — HR leave has Excel export; Steadfast PDF client-side; no explicit daily-ops Excel pathway. |

---

## A.4. Web vs Android Feature Mapping

Platform: Capacitor hybrid loading `https://xzmteam.com` in webview. Web == Android ≈ 98%. Native additions: offline rider check-in (GPS), FCM push via `push-send`, native camera. APK signing via GitHub Actions `android-apk.yml` (keystore risk — see BACKUP_RECOVERY §5-1 CRITICAL).

---

## A.5–A.6. Batch 1 & Batch 2 — EVIDENCE NOT ON FILE

Searches performed on 2026-11-27 across:

1. **Git repo (164 remote branches):** `find -iname "*batch*"` → 0 matches; `git log --all --diff-filter=A` → 0 matches; `git grep` across all branches → `XZM-007A` appears but no Batch 1/Batch 2 split.
2. **Claude Project `claude/` folder:** only `BATCH3_*` files present.
3. **GitHub PR/Issue API:** session access restricted at audit time.

**Decision:** Batch 1 (XZM-007A/B-1) and Batch 2 (XZM-007A/B-2, Accounts Audit) = **EVIDENCE NOT ON FILE → Re-Audit Pending** upon Owner approval.

---

## A.7. docs/project-control/ vs claude/ Discrepancy

### Findings

| ID | Severity | Item |
|---|---|---|
| **G-A7-1** | HIGH | Dual Source of Truth — two `TASK_TRACKER.md` files (`claude/` and `docs/project-control/`) with different schemas and rows. |
| **G-A7-2** | HIGH | `docs/project-control/` not merged to `main` — only exists in `docs/project-control-init` and `docs/xzm-005-task-tracker` branches. Fresh clone, CI check, Netlify deploy do not see the folder. |
| **G-A7-3** | MED | `AI_HANDOVER.md` duplication — exists in both `claude/` and `docs/project-control/`; not sync'd. |

### Owner Decision (XZM-004R)

> `docs/project-control/` হবে ChatGPT ও Claude উভয়ের একমাত্র স্থায়ী Central Project Knowledge Base। `claude/` folder শুধুমাত্র temporary session workspace।

**Migration path (XZM-004R):**

1. All durable `claude/*` reports consolidated under `docs/project-control/audits/` (this subfolder).
2. `TASK_TRACKER.md` updated to cover XZM-001..017 (including Batch 3 / Batch 4 / proposed new tasks).
3. `AI_HANDOVER.md` updated with 2026-11-27 verified snapshot.
4. `CHANGELOG.md` updated.
5. `RISK_REGISTER.md` added for Android signing + Legacy ERP App ID risks.
6. Owner approval merges XZM-004R → `main` → `claude/` reverts to scratch-only.

---

## New findings (G-6, G-7, G-8)

| ID | Severity | Item | Suggested Task |
|---|---|---|---|
| G-6 | MED | No fairness index on data entries | → XZM-014 |
| G-7 | MED | Three-slot ops report missing | → XZM-015 |
| G-8 | LOW | Auto-push on route approval absent | → XZM-016 |

---

## Compliance

- ✅ No code / DB / DNS / production change.
- ✅ Suitable for ChatGPT Independent Review upload.

---

**Source of truth:** `claude/BATCH3_CORRECTION.md` in the Claude Project.
