# XZM-007A/B-3 — Batch 3 Zonal Management & Employee Duty Audit (Original)

**Status:** UNDER_REVIEW (awaiting ChatGPT Independent Review)
**Mode:** Read-only — no code, DB, DNS or production change.
**Date:** 2026-11-27 (Asia/Dhaka)
**Source HEAD:** `2836a07a96d5053938fdaed6bff22273558e7977`

> This is the **original** Batch 3 report. ChatGPT Independent Review flagged corrections which are captured in the companion file `XZM-007AB-3_BATCH3_CORRECTION.md`. Both documents MUST be read together.

---

## 0. Prior-Batch Evidence Gap

- `claude/TASK_TRACKER.md` lists only **XZM-002 (DONE)** and **XZM-006 (UNDER_REVIEW)**. **No XZM-007A Batch 1 or Batch 2 record exists** in project docs.
- No `BATCH1_*.md` / `BATCH2_*.md` artefact found under `claude/`.
- Owner directive "KORO" (2026-11-27 20:49) accepted Batch 3 start under option (খ): Batch 1/2 marked `EVIDENCE NOT ON FILE`; Batch 3 proceeds and is logged as a new row.

---

## 1. Zonal Management — 9 items

**VERIFIED (7):** Zonal Dashboard, Multiple Hub Management, Hub Manager Monitoring, Central Operations Control, Daily Planning, Task Assignment, Report Approval.
**PARTIAL (2):** Hub Switching (singleton assertion not grep-verified), Problem Escalation (code has generic chat-shaped `Issues.tsx`, not the auto-routing + per-rider-tag + leaderboard described in stored memory).

## 2. Employee & Duty Management — 15 items

**VERIFIED (13):** Employee Profile, Employee ID, Hub Assignment, Position & Role, Daily Attendance, Digital Register, Leave Apply, Leave Decide, Absentees, Daily Duty Assignment, Pending Duties, Staff Performance, Manager Verification.
**PARTIAL (2):** Substitutes/Backup (capacity-surge auto-suggest not matched), Duty Proof (`EvidencePicker` exists but not mandatory on `hubApi.taskComplete`).

## 3. Planning & Control — 5 primary Qs (3 VERIFIED / 2 PARTIAL) + 6 follow-up Qs in Correction

Q.3.1 Zonal deadline control — **VERIFIED**
Q.3.2 Hub manager daily attendance submit — **VERIFIED**
Q.3.3 Absence-based route & manpower planning — **PARTIAL**
Q.3.4 Backup rider dispatch — **VERIFIED (with caveat)**
Q.3.5 Zonal plan approval — **VERIFIED**

---

## 4. Original Summary Table (counting error, see correction)

| Area | Verified | Partial | Not Found | Access Required |
|---|---|---|---|---|
| Zonal Management | 7 | 2 | 0 | 0 |
| Employee & Duty | 10 | 2 | 0 | 0 |
| Planning & Control | 3 | 2 | 0 | 0 |
| **Total (original wrote 20)** | 20 | 6 | 0 | 0 |

**Note:** total count 20 was wrong; actual is 9+15+5 = 29. See Correction §A.1–A.2 for recounted table.

---

## 5. Gaps & Findings (G-1 through G-5)

| ID | Severity | Item |
|---|---|---|
| G-1 | MED | **Problem Center flow** — `Issues.tsx` chat-shaped, not auto-routing ticket with per-rider tag + leaderboard. Needs separate Task ID. |
| G-2 | MED | **Capacity-surge rider suggestion** — stored vision not confirmed in `web/src/`; `zonal.plan` RPC SQL not read. |
| G-3 | LOW | **Hub-switcher singleton** not grep-verified across all `web/src/pages/`. |
| G-4 | LOW | **Duty proof (evidence attach)** — `EvidencePicker` use beyond `Issues.tsx` not mapped. |
| G-5 | INFO | **Batch 1 & Batch 2 evidence missing** — Owner decides regeneration vs cancellation. |

---

## 6. Files Read (16 files, mostly full)

`ZonalDashboard.tsx`, `HubManagement.tsx`, `AttendancePage.tsx`, `AbsenceApply.tsx`, `OpsDeadlines.tsx`, `HubOps.tsx`, `OperationsCollection.tsx`, `EmployeeProfile.tsx`, `HubReview.tsx`, `StaffWorkProfile.tsx`, `Duties.tsx`, `ZonalRequests.tsx`, `HubTabs.tsx`, `Morning.tsx`, `workHub.ts`, `Issues.tsx` (head only).

---

## 7. Compliance

- ✅ No code, DB, DNS or production change.
- ✅ All reads scoped to HEAD `2836a07`.

---

**Source of truth:** `claude/BATCH3_ZONAL_DUTY_AUDIT.md` in the Claude Project.
