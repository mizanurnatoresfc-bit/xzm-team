# DECISION_LOG

> Architectural & product decisions, chronological। Each entry: date, decision, rationale, impact।

---

## 2026-11-27 (post-merge evening) — D-010: XZM-006 Deep Verification + 8 sub-tasks XZM-006A..H
- **Decision:** XZM-006 central audit rewritten into full 11-section deep-verification document; 8 proposed sub-tasks opened (XZM-006A Android signing export, XZM-006B Supabase recovery coverage, XZM-006C migration drift reconciliation, XZM-006D Cloudflare/Netlify rollback + zone export, XZM-006E missing edge functions source, XZM-006F git tag policy, XZM-006G RPO/RTO Owner questionnaire, XZM-006H 7 security advisors remediation). Risk→Sub-task mapping added to RISK_REGISTER.
- **Rationale:** ChatGPT Independent Review on first XZM-006 summary returned PARTIAL — EVIDENCE REQUIRED. Owner Second Review accepted the direction; Deep Verification now records complete evidence and breaks remediation into addressable sub-tasks.
- **Impact:** docs-only. New Draft PR opened; no code, DB, DNS, production config, restore drill or secret export performed.

## 2026-11-27 (late) — D-009: XZM-004R-Final (Second Review Response) — redaction policy + preview binding verification
- **Decision:** Owner email + Cloudflare numeric account ID redacted from AI_HANDOVER §5; PROJECT_CONNECTIONS §10 reorganized as a redaction policy; TASK_TRACKER allowed-status set expanded to match actual records; merge-to-main impact documented as zero production build/deploy trigger expected (workflow paths miss docs-only PRs; Netlify + Cloudflare deploys live only inside `android-apk.yml`).
- **Rationale:** ChatGPT Second Independent Review accepted major corrections; final cleanup covers avoidable PII/identifier exposure, status taxonomy drift, and PR-description accuracy.
- **Impact:** docs-only। PR #213 stays Draft। Zero production impact expected on merge.

## 2026-11-27 (evening) — D-008: XZM-004R Review-Response, 12-point corrections on PR #213 (Draft)
- **Decision:** ChatGPT Independent Review (REQUEST CHANGES — HOLD) গৃহীত; PR #213-এর একই branch `docs/xzm-004r-consolidated`-এ 12-point corrections। নতুন PR খোলা হয়নি।
- **Key changes:** XZM-001/002 (ChatGPT/Claude workspace setup) relabeled; XZM-006 duplicate consolidated; AI_HANDOVER section numbering repaired; Batch 4 report ported to central `audits/` folder; "Zero Deployment Trigger Risk" claim softened to repo-local CI workflows only (Netlify + Cloudflare Workers preview builds acknowledged separately); R-008 status rolled back to IN_PROGRESS; operational-identifier review added to PROJECT_CONNECTIONS §10.
- **Rationale:** Accuracy, auditability, and alignment with ChatGPT Review feedback; keep PR Draft until Second Independent Review.
- **Impact:** docs-only। No code, DB, or production change. Still awaiting ChatGPT Second Review → Owner approval → merge.

## 2026-11-27 — D-007: Central Project Documentation under `docs/project-control/`
- **Decision:** `docs/project-control/` ফোল্ডারে 14টি standard documentation ফাইল — PROJECT_MASTER, PROJECT_CONNECTIONS, CURRENT_SYSTEM_MAP, COMPANY_RULES, REPORT_FORMATS, REQUIREMENTS, TASK_TRACKER, DECISION_LOG, AUDIT_REPORT, BUG_REGISTER, TEST_REPORT, CHANGELOG, DEPLOYMENT_LOG, AI_HANDOVER।
- **Rationale:** ChatGPT ও Claude উভয়ের জন্য single source of truth; existing `docs/` অপরিবর্তিত থাকবে।
- **Impact:** কোনো code/db change নয়; শুধু documentation branch।

## 2026-11-26 — D-006: Sidebar personal-rows follow role menu (PR #178)
- **Decision:** `/app/staff`, `/app/accounts/mine`, `/app/fleet/mine`, `/app/references`, `/app/notices` সব role-এর জন্য auto-show হবে না — role-এর menu list অনুসরণ করবে।
- **Rationale:** cleaner sidebar; URL access অপরিবর্তিত।
- **Impact:** `/app` dashboard সবসময় visible; typing URL কাজ করে।

## 2026-11 — D-005: Menu system — extend `role_dashboards`, don't add parallel tables
- **Decision:** position-based menu জন্য existing `role_dashboards.menu` jsonb-কে extend করা হবে; `menu_items` + `position_menu_access` + `v_user_sidebar` + `is_menu_admin` প্রথম attempt drop হবে।
- **Rationale:** avoid parallel schema; destructive drop awaiting Supabase confirmation।

## 2026-11 — D-004: Claude ↔ ChatGPT Backend split
- **Decision:** Claude = Frontend/UI-UX/integration; backend changes = ChatGPT Backend Team-এর Contract/Requirement Report দিয়ে।
- **Rationale:** parallel work, clear ownership।

## 2026-11 — D-003: Zonal Command Center = closed-loop research center
- **Decision:** Commission/capacity numbers auto-push হবে না daily accounts, rider hisab, হিসাব কেন্দ্র-এ।
- **Rationale:** avoid double-counting; keep business ledger pristine।

## 2026-11 — D-002: Brand name = "XZM TEAM" only (no ERP suffix)
- **Decision:** Displayed brand XZM TEAM; internal IDs (`com.xzmteam.erp`, `xzm-team-erp`, `xzm-team-erp-dev`) অপরিবর্তিত।
- **Rationale:** rename breaks dependent features।

## 2026-11 — D-001: NODI AI data policy
- **Decision:** XZM TEAM নিজের system/data-এ grounded, no separate training; write actions = draft-then-confirm, never auto-execute।
- **Rationale:** safety + accountability।
