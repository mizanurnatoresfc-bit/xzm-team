# PROJECT_MASTER

**Project Name:** XZM TEAM
**Tagline:** Smart Zonal Courier Operations & Management Tool
**Production Website:** https://xzmteam.com
**Platforms:** Web + Android
**Owner:** Project Owner (final approval authority)
**Document Status:** Initialized — 2026-11-27

---

## 1. Identity

XZM TEAM একটি সহায়ক (supporting) Zonal Courier Operations, Planning, Employee Duty Verification এবং Company Reporting Tool। এটি —

- কুরিয়ার কোম্পানির core software-এর বিকল্প নয়।
- সাধারণ ERP বা স্বতন্ত্র HR সফটওয়্যার নয়।
- কর্মী ব্যবস্থাপনা সর্বদা Zonal Management-এর অধীনে থাকবে।

## 2. Business Objectives

- কুরিয়ার অপারেশন ও দৈনিক রুট প্লানিং।
- কোম্পানির নির্ধারিত ফরম্যাটে দ্রুত রিপোর্ট।
- একাধিক Hub পরিচালনা।
- ম্যানেজার, কর্মী, রাইডার, ড্রাইভার, হেল্পারের দায়িত্ব যাচাই।
- Attendance, Leave ও Backup manpower ব্যবস্থাপনা।
- কম ইনপুটে বেশি রিপোর্ট।
- Centralized Zonal Control।
- সরল ও আধুনিক Web ও Android UI।

## 3. Authority & Roles

| Role | Responsibility |
|---|---|
| Project Owner (User) | চূড়ান্ত সিদ্ধান্ত, approval, deployment authorization |
| ChatGPT | Project Director, Product Architect, Business Analyst, Independent Auditor, QA Reviewer |
| Claude | Implementation Engineer, Technical Analyst, Developer, Bug Fixer, Frontend/UI-UX |
| ChatGPT Backend Team | Backend changes (separate contract flow) |

## 4. Working Split (Current)

- **Claude →** Frontend, UI/UX, existing-module integration design।
- **ChatGPT Backend Team →** Backend changes লিখিত Contract/Requirement Report এর মাধ্যমে।
- Database schema পরিবর্তন backend team-এর, Claude শুধু query/UI layer সামলাবে।

## 5. Core Modules (High-Level)

- Staff Panel ও designation-ভিত্তিক Dashboard
- Hub Management ও Hub Switcher
- Attendance (WorkforceHub master)
- Route Settings (9-tab master at `/app/zonal/routes`)
- হিসাব কেন্দ্র (Accounts Center) — 7-step linear flow
- Daily Accounts, Expense Approval, Rider Hisab
- HR Records (Active / Resigned / Terminated / Transferred / On Leave)
- দেনা-পাওয়া (Debtor-Creditor) module
- NODI AI (Courier Operation & Planning assistant)
- Zonal Command Center (research-only)
- Hub Problem Center
- Central Operation Data layer (Manual-first)

বিস্তারিত: `CURRENT_SYSTEM_MAP.md`।

## 6. Branding

- Only displayed brand: **XZM TEAM** (no "ERP", "XZM ERP", "XZM TEAM ERP")।
- Internal IDs অপরিবর্তিত: Android package `com.xzmteam.erp`, Netlify `xzm-team-erp`, Supabase `xzm-team-erp-dev`।
- Brand colors: Green `#16A34A` / `#15803D`, Ink `#0F172A`, Mint `#DCFCE7`।
- Logo: "Flight Hub" (X mark + hub-and-spoke dots + motion trail)।
- Bengali term for sorting center: **সর্টিং সেন্টার**।

## 7. Timezone & Locale

- Business workflow timezone: **Asia/Dhaka (UTC+06:00)**।
- Primary UI language: বাংলা।
- Reports: কোম্পানি-নির্ধারিত Excel format।

## 8. Related Documents

| File | Purpose |
|---|---|
| `PROJECT_CONNECTIONS.md` | GitHub, Supabase, Netlify, Cloudflare, Figma, Subframe connection status |
| `CURRENT_SYSTEM_MAP.md` | Module list, routes, tables |
| `COMPANY_RULES.md` | Business rules, approval flows, isolation |
| `REPORT_FORMATS.md` | Excel report formats |
| `REQUIREMENTS.md` | Open requirements, roadmap items |
| `TASK_TRACKER.md` | Task IDs, status, owners |
| `DECISION_LOG.md` | Architectural & product decisions |
| `AUDIT_REPORT.md` | Audit findings |
| `BUG_REGISTER.md` | Open bugs |
| `TEST_REPORT.md` | Test results per task |
| `CHANGELOG.md` | Human-readable change log |
| `DEPLOYMENT_LOG.md` | Production deployments |
| `AI_HANDOVER.md` | AI-to-AI handover notes |
