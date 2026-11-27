# DECISION_LOG

> Architectural & product decisions, chronological। Each entry: date, decision, rationale, impact।

---

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
