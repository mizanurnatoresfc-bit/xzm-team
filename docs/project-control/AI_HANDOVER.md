# AI_HANDOVER

> ChatGPT ↔ Claude শেয়ার্ড context। প্রতিটি সেশন শুরুর আগে পড়তে হবে।

---

## 1. Project Snapshot

- Project: **XZM TEAM** — supporting Zonal Courier Ops Tool।
- Production: https://xzmteam.com (Web + Android)।
- Repo: https://github.com/mizanurnatoresfc-bit/xzm-team (public)।
- Timezone: Asia/Dhaka।
- Primary UI language: বাংলা।

## 2. Who Does What

| Role | Owner |
|---|---|
| Final approval, deployment authorization | Project Owner |
| Product direction, audit, QA, independent review | ChatGPT |
| Frontend, UI/UX, integration implementation, bug fix | Claude |
| Backend (schema, RLS, migrations) | ChatGPT Backend Team (via Contract report) |

## 3. Documentation Canon

Single source of truth lives in **`docs/project-control/`** on `main`। Order of precedence:

1. `PROJECT_MASTER.md` — identity & objectives
2. `PROJECT_CONNECTIONS.md` — live status of GitHub/Supabase/Netlify/Cloudflare/Figma/Subframe
3. `CURRENT_SYSTEM_MAP.md` — modules, routes, tables, RPCs, edge functions
4. `COMPANY_RULES.md` — business rules & flows
5. `REPORT_FORMATS.md` — Excel report catalogue
6. `REQUIREMENTS.md` — open requirements
7. `TASK_TRACKER.md` — task IDs, status, PR links
8. `DECISION_LOG.md` — architectural & product decisions
9. `AUDIT_REPORT.md` — audit findings
10. `BUG_REGISTER.md` — open bugs
11. `TEST_REPORT.md` — per-task test evidence
12. `CHANGELOG.md` — human-readable change log
13. `DEPLOYMENT_LOG.md` — production deployments
14. `AI_HANDOVER.md` — this file

Existing `docs/*.md` (pre-tracker) **রাখতে হবে**, overwrite নয়।

## 4. Communication Protocol

- Approved task না পাওয়া পর্যন্ত কোনো implementation নয়।
- Each task → একটি PR + corresponding entries in TASK_TRACKER, CHANGELOG, TEST_REPORT, DEPLOYMENT_LOG (deploy হলে)।
- Draft PR default; owner approval-এর পর ready-for-review।
- কোনো unrelated change একই task-এ মেশানো নয়।

### 4.1 Shared Task Tracker (set in XZM-005)

- **Master context:** `docs/project-control/TASK_TRACKER.md` (15-field schema, 14 categories)।
- **Live status / assignment / comments:** GitHub Issues (https://github.com/mizanurnatoresfc-bit/xzm-team/issues)।
- Conflict হলে **GitHub Issues = live state**, markdown = durable context।
- Owner বা ChatGPT কোনো task-কে issue বানালে title-এ `[XZM-###]` prefix রাখবেন; issue number markdown-এর `GitHub Issue #` field-এ update হবে।
- প্রতিটি কাজের শেষে বাধ্যতামূলকভাবে update: `TASK_TRACKER.md`, `AI_HANDOVER.md` (যদি protocol পরিবর্তন হয়), `CHANGELOG.md`, এবং deploy হলে `DEPLOYMENT_LOG.md`।
- প্রমাণ (commit SHA / PR link / TEST_REPORT entry) ছাড়া কোনো task **VERIFIED / CLOSED** চিহ্নিত হবে না।

## 5. Secrets

- কখনো commit নয়।
- Supabase service-role / ANTHROPIC_API_KEY / Netlify tokens — nijh dashboard-এ রক্ষিত।
- Repo-র `.gitignore` + Netlify/Supabase/Cloudflare environment variables ব্যবহার।

## 6. Currently Known Gaps (as of 2026-11-27)

- Netlify, Cloudflare, Figma, Subframe verification incomplete → XZM-005।
- Android source path & build version → PENDING।
- Supabase `xzm-team-staging` ownership confirmation → PENDING।
- Full table + RLS inventory → PENDING।

## 7. Session Hand-off Checklist (both AIs)

Before starting a task:
1. Read latest `TASK_TRACKER.md` + `DECISION_LOG.md` tail।
2. Confirm approved task ID + requirement।
3. Inspect existing code before proposing change (CLAUD.txt rule 1)।
4. No production write without owner approval।
5. Write evidence in `TEST_REPORT.md` before claiming done।
6. Append entry to `CHANGELOG.md` and (if applicable) `DEPLOYMENT_LOG.md`।

## 8. Do-Not List

- No credentials in commits/docs।
- No duplicate modules।
- No silent removal of existing features।
- No branding drift (XZM TEAM only, ERP suffix gone from UI)।
- No business-rule change without approved task।
