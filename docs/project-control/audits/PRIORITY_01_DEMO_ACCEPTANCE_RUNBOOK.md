# Priority 01 — DEMO Acceptance Runbook (human + Android device steps)

**Written:** 2026-11-28 (Asia/Dhaka) · **For:** Owner or any human tester with a browser and an Android device · **Scope:** the five steps that require a real browser or a real device, which an in-session agent cannot run.

> Everything in this runbook was already proven **at the SQL layer** against staging (`xzm-team-staging`) using the exact DEMO account UUIDs and hub codes below — see `TEST_REPORT.md` T1-T12 (93/93 PASS). This runbook exists so a human tester can confirm the same decisions render in the actual UI and on an actual Android device before Production Release is signed off.

## 1. Environment (already seeded; do not change)

- **Website:** https://staging.xzmteam.com/ (served via Cloudflare Workers, auto-built from branch `chatgpt/module-release-control`, latest build on commit `663d64c` or newer)
- **Supabase:** project ref `mbpjvqeizwjjsvnbjerb` (= `xzm-team-staging`, NOT the production ref `ndgnhvbpmtxrpplgsslz` — staging has its own anon key published only inside Netlify/Cloudflare Workers env, Production DB is never written by any staging action).
- **DEMO accounts** (passwords held by Owner — do not commit):

  | # | Email | Role | Hub assignment | Expected panel on login |
  |---:|---|---|---|---|
  | 1 | `1@xzm.com` | `super_admin` | — (global) | Dashboard + "সিস্টেম নিয়ন্ত্রণ কেন্দ্র" shortcut |
  | 2 | `2@xzm.com` | `zonal_manager` | — (zone A) | Zonal Dashboard, HubOps, Requests, HR Records |
  | 3 | `3@xzm.com` | `hub_manager` | `DEMO-HUB` | Hub Management, AttendancePage, StaffList |
  | 4 | `4@xzm.com` | `staff` | `DEMO-HUB` | StaffPanel (own attendance, own accounts, My Workforce) |
  | 5 | `5@xzm.com` | `rider` | `DEMO-HUB` | StaffPanel + Rider-shape (delivery money + merchant deposit) |
- **DEMO hubs:** `DEMO-HUB` (zone A, home for 3-5@xzm.com), `DEMO-HUB-2` (zone A, no assignments), `DEMO-HUB-3` (other zone).

## 2. Browser acceptance (10 min, Chrome/Edge)

Perform each of the following as each account in turn (log out between accounts). The URL columns below are the direct test — **first** click the menu row, **then** try the direct URL — both must behave identically.

| # | What to check | 1 Super | 2 Zonal | 3 Hub Mgr | 4 Staff | 5 Rider | Pass if |
|---:|---|:---:|:---:|:---:|:---:|:---:|---|
| 2.1 | Login lands on the Home page (not stuck on the login form) | ✓ | ✓ | ✓ | ✓ | ✓ | the Home / StaffPanel loads within 3 s |
| 2.2 | Side menu shows role-appropriate rows only (no "অনুমতি নেই" page for a visible row) | ✓ | ✓ | ✓ | ✓ | ✓ | no visible row opens "অনুমতি নেই" or "এই পাতা আপনার জন্য চালু নেই" |
| 2.3 | Dashboard shortcut "সিস্টেম নিয়ন্ত্রণ কেন্দ্র" | visible + opens | hidden | hidden | hidden | hidden | only Super sees the link |
| 2.4 | Direct URL `/app/module-control` | opens the page | redirect to `/app` | redirect to `/app` | redirect to `/app` | redirect to `/app` | matches column |
| 2.5 | Direct URL `/app/attendance?hub=cf08222c-1c0f-473b-a6ce-a0bf47935ce9` (DEMO-HUB) | opens | opens | opens | redirects to own view | redirects to own view | Super / Zonal / Hub mgr see the hub list; Staff / Rider see their own day |
| 2.6 | On Super's System Control Center page: search box returns 150 modules; pick `fleet` | ✓ | — | — | — | — | the page loads a form with Status drop-down, Enabled toggle, DEMO Hub toggle, Platforms fieldset, Allowed roles fieldset, Allowed hubs fieldset, and a "জরুরি বন্ধ · Emergency Disable" button |
| 2.7 | On Super's page: pick `fleet` → change Status to "পরীক্ষা · Testing" → click Save | ✓ | — | — | — | — | the Saved status line updates; the audit entry appears in Release history below |
| 2.8 | On another browser logged in as 3@xzm.com: refresh Fleet page while fleet is in Testing | — | — | fleet menu row disappears (unless DEMO opt-in is on) | — | — | menu hides within 60 s (ReleaseProvider refreshes on focus) |
| 2.9 | Back on Super's page: Restore fleet to Published; refresh 3@xzm.com browser | ✓ | — | ✓ | — | — | Fleet comes back on hub mgr's menu |
| 2.10 | On Super's page: pick `fleet` → uncheck one of the Platforms checkboxes | ✓ | — | — | — | — | the yellow warning banner appears pointing to `docs/project-control/audits/PRIORITY_01_PLATFORM_COUPLING_CONTRACT.md` |
| 2.11 | On Super's page: pick any module → click "জরুরি বন্ধ · Emergency Disable" → confirm | ✓ | — | — | — | — | the Saved status flips to "বন্ধ · Disabled"; direct URL for that module now shows "এই মডিউলটি এখন চালু নেই" for every other role |
| 2.12 | On Super's page: Release history → Restore previous configuration | ✓ | — | — | — | — | status rolls back, a new audit entry appears with the rollback_of pointer |

**PASS/FAIL:** fill the table below for each account after the browser test is done.

## 3. Android native acceptance (Capacitor APK, ~20 min)

Use the APK built from the latest branch commit by `.github/workflows/android-apk.yml` (download from the workflow run's Artifacts tab). Install on a real device or on an Android emulator.

| # | What to check | Pass if |
|---:|---|---|
| 3.1 | APK opens and reaches the staff login screen | the splash uses the Brand Green `#16A34A`, the login form is bilingual Bangla + English |
| 3.2 | Log in as `3@xzm.com` (Hub Manager); confirm the home panel loads | hub manager's home panel renders within 5 s on 4G |
| 3.3 | Repeat T2.5 on Android: the hub attendance page accepts the hub query param | matches web behaviour |
| 3.4 | **While Super is signed in on the website,** pick `attendance` → Platforms → uncheck "web" (so the Android-only case) → Save | Super's web Dashboard no longer shows Attendance in its menu within 60 s; the Android device still shows and opens it |
| 3.5 | Reverse: uncheck "android" instead, leaving "web" | Android device's menu hides Attendance within 60 s on `window.focus`; web shows it again |
| 3.6 | Test offline mode: enable airplane mode on the device, re-open the app | the ReleaseProvider's `localStorage` cache keeps the last successful snapshot for ~24 h; menu and routes should continue to work for pages that worked before airplane mode. Go back online → snapshot refreshes within 30 s |

**Known limitation to watch for on steps 3.4 / 3.5:** direct APIs (RPCs) on the still-allowed platform may also refuse with "Not authorised" for guarded modules while only one platform is picked. This is Backend Team scope B-002 — see `docs/project-control/audits/PRIORITY_01_PLATFORM_COUPLING_CONTRACT.md`.

## 4. Safety — Production DB is never written

- Staging site's `VITE_SUPABASE_URL` resolves to `https://mbpjvqeizwjjsvnbjerb.supabase.co` (not production). Confirm in-browser DevTools → Network → any `/rest/v1/` request's URL.
- The staging anon key is scoped to the staging project only.
- Service_role writes (release evidence) are only ever triggered from `scripts/record-module-release.mjs` which requires `RELEASE_SUPABASE_URL` + `RELEASE_SUPABASE_SERVICE_ROLE_KEY` env vars — these are set only on the Owner's local machine and in CI, never in a staging preview.
- A Super Admin test on staging CANNOT reach production because the staging app's Supabase origin is hardcoded at build time to staging — a browser action cannot swap it to production mid-session.

## 5. What to send back when done

Fill in and post into PR #226:

```
DEMO browser acceptance — 2026-11-28 Asia/Dhaka

Tester: <name>
Device: <desktop OS + Chrome version>
Android device/emulator: <make, Android version>

Browser results (section 2):
2.1 [PASS/FAIL], 2.2 [PASS/FAIL], … 2.12 [PASS/FAIL]

Android results (section 3):
3.1 [PASS/FAIL], … 3.6 [PASS/FAIL]

Notes / screenshots: <attach or paste>
```

Owner will mark PR #226 ready-for-review only after both sections report all PASS (or document any FAIL in BUG_REGISTER with a mitigation plan).
