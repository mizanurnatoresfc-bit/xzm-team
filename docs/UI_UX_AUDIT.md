# UI/UX & Reference Audit — XZM TEAM

Date: 2026-11-11 · Scope: brief §3 "Branding and UI Design" + user request "UI/UX & Reference Audit"

## 0. What was audited (and what could not be)

| Source | Status |
|---|---|
| XZM-TEAM's own UI | **Does not exist yet** — the frontend has not been built (see PROGRESS.md). There is no current design system, page or component to test for broken layouts. This audit therefore (a) reviews the references and (b) defines the XZM-TEAM design system so these problems are prevented from the start. |
| Public reference site `packzy.com` | Inspected live in a browser (desktop): structure, font, headings, language switch, image alt text. Mobile view could not be checked (site approval was single-use). |
| Admin dashboard reference | 12 desktop screenshots supplied by the user (hub overview, permissions, profile, team list, salaries, daily update reports, report detail, hub accounting). **No mobile screenshots and no HTML** were supplied, so mobile behaviour of the reference is not judged here. |

**Note on the reference:** `packzy.com` and the dashboard are Steadfast Courier's product (title, logo and wordmark visible). They are used **only as pattern inspiration**. XZM-TEAM will not use their name, logo, wordmark, illustrations, copy, icon set choices or exact page layouts. Personal data visible in the screenshots (names, phone numbers, NID, salaries) has not been copied into this project.

---

## 1. Reference findings — patterns worth adopting (as ideas, re-designed)

| # | Pattern seen | Why it works | XZM-TEAM version |
|---|---|---|---|
| A1 | **Context banner** "Working as <hub>" with "back to my hub" | A user with many hubs always knows which hub's data they are editing — critical for hub-scoped money entry | Persistent *scope bar* under the top bar: current zone/hub, switcher, colour-coded when acting outside the user's home hub |
| A2 | **Workflow stepper** ("5 of 5 steps done": submitted → deposit → accepted → updated → posted) | Shows exactly where a money flow is stuck and who acts next | Used for cash handover, journal approval, employee application, pickup verification |
| A3 | **KPI tile**: label · big value · one-line explanation ("100% of collected", "Nothing outstanding") | Numbers are self-explaining | Standard `StatCard`; every tile is clickable to its records (brief §14) |
| A4 | **Scope explainer note** above a table ("Showing every report accounts have not accepted yet…") | Prevents "where is my data?" confusion caused by permissions/filters | Standard `ScopeNote` on every filtered/permission-limited list |
| A5 | **Two-line table cells** (name + ID/phone underneath) | Dense but readable | Adopted; secondary line uses accessible grey (see §3) |
| A6 | **Signed money columns** (+ in green, − in red, both with sign) | Not colour-only | Adopted; amounts right-aligned with tabular figures |
| A7 | **Plain-language empty states** ("No vehicle is on its way to your hub right now.") | Tells the user the state, not just "No data" | Every list has an empty state with a next action |
| A8 | **Favourites strip** and menu search | Fast access in a large menu | Adopted (user-pinned shortcuts, max 8) |
| A9 | **Language switch in public header** (EN / বাংলা) | Bangla is first-class | Adopted on public site and in the app top bar |

## 2. Reference findings — problems to avoid

Severity: 🔴 high (data/accessibility risk) · 🟠 medium · 🟡 low

| # | Issue observed | Sev | XZM-TEAM rule |
|---|---|---|---|
| P1 | **Full NID number and personal phone shown in plain text** on the profile page | 🔴 | Sensitive fields masked by default (`•••• •••• 4481`), revealed only with `hr.employee_sensitive.view`, and every reveal is audited |
| P2 | **White text on bright-green status pills** (e.g. "Approved"). White on a typical bright green such as `#22C55E` is only **2.28:1**; WCAG AA needs 4.5:1 for small text | 🔴 | Status badges use dark text on a tinted background (e.g. `#166534` on `#DCFCE7` = **6.49:1**) and always include the word, never colour only |
| P3 | **Light-grey 11–12 px secondary text** (IDs, phones, captions). Grey like `#9CA3AF` on white is **2.54:1** | 🔴 | Minimum secondary text colour `#475569` (7.58:1) at ≥ 12 px; captions never below 12 px |
| P4 | **Three overlapping navigation systems**: sidebar (Team → Riders…), horizontal hub tabs (Team ▾, Parcels ▾…), favourites strip — same destinations reachable three ways with different labels | 🟠 | One primary navigation (sidebar). Page-level tabs only switch views *inside* the current page. Favourites are shortcuts, not a 3rd menu |
| P5 | **Two "primary" colours**: blue "Booking" button vs green primary buttons everywhere else | 🟠 | Exactly one primary colour (XZM-TEAM green). Blue reserved for informational states |
| P6 | **Dropdown covers page actions** (Hub menu hides "Review Assignments / Balance" buttons; button label cut to "lance") | 🟠 | Menus render in a portal, close on outside click/Esc, never truncate action labels; actions collapse into a "More" menu at narrow widths |
| P7 | **"NEW" badge on every item** of a menu | 🟡 | Badges only for counts that need action (pending approvals, unread); "new feature" hints are one-time and dismissible |
| P8 | **Native `mm/dd/yyyy` date input** (US format) in a Bangladesh product | 🟠 | Dates shown and entered as `dd/MM/yyyy` (`১১/১১/২০২৬` in Bangla); calendar picker with typed input; timezone Asia/Dhaka |
| P9 | **Red progress bars for 55–64 % success rate** without stated thresholds | 🟡 | Configurable thresholds with a legend; colour + text + icon |
| P10 | **Large empty white areas** next to dense cards (hub overview left card) | 🟡 | 12-column grid; cards size to content; empty state compact |
| P11 | **Wide 7–9-column tables** — no evidence of a mobile pattern | 🟠 | Below 768 px, tables switch to stacked record cards with the 3 key fields + actions; horizontal scroll only for financial ledgers, with sticky first column |
| P12 | Public site: **9 of 26 images have no `alt` text** | 🟠 | `alt` required by lint rule; decorative images use `alt=""` |
| P13 | Out-of-scope modules visible in the reference menu (loan requests, "Pay & loans", rider map) | 🔴 (scope) | **Not built** in XZM-TEAM — brief explicitly excludes Loan/Savings, GIS map and route planning |

---

## 3. XZM-TEAM design system (original)

### 3.1 Brand
- **Name & wordmark:** "XZM-TEAM" set in the UI typeface, semibold, letter-spacing +2 %. Logo is a configurable upload (Settings → Branding); until uploaded, a simple original monogram (rounded square in primary green with "X") is used.
- Personality: calm, trustworthy, finance-grade. Green = movement and money "in order".

### 3.2 Colour tokens (verified contrast on stated background)

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `primary` | `#0F7A3D` | Primary buttons, active nav, links | white text on it **5.42:1** ✅ |
| `primary-dark` | `#0A4D27` | Sidebar background option, hover, headings | white on it **9.98:1** ✅ |
| `primary-50` | `#E8F5EE` | Selected rows, active nav background | `#0A4D27` on it **8.9:1** ✅ |
| `surface` | `#FFFFFF` | Cards, tables | — |
| `canvas` | `#F8FAFC` | App background (light grey) | `#64748B` on it 4.55:1 (≥ AA, use for ≥ 14 px only) |
| `text` | `#0F172A` | Body text | — |
| `text-muted` | `#475569` | Secondary text, IDs, captions | **7.58:1** on white ✅ |
| `border` | `#E2E8F0` | Dividers, inputs | — |
| `success` | `#166534` on `#DCFCE7` | Approved / Posted / Matched | **6.49:1** ✅ |
| `warning` | `#92400E` on `#FEF3C7` | Pending / Due soon | **6.37:1** ✅ |
| `danger` | `#B91C1C` | Rejected / Mismatch / outflow | **6.47:1** on white ✅ |
| `info` | `#1D4ED8` | Informational notes only | **6.7:1** on white ✅ |

Dark mode is out of initial scope (can be added through the same tokens).

### 3.3 Typography
- Latin: **Inter**; Bangla: **Hind Siliguri** (fallback Noto Sans Bengali). Both self-hosted — no third-party font CDN calls.
- Scale (px / line-height): 12/16 caption · 14/20 body-sm (tables) · 16/24 body · 18/28 h4 · 20/28 h3 · 24/32 h2 · 30/36 h1. Bangla gets +2 px line-height for matras.
- Numbers: `font-variant-numeric: tabular-nums` in tables and KPIs. Currency `৳ 1,45,837.00` — **digit grouping (lakh vs. international) is a setting**, default lakh-style used in BD accounting; Bangla mode can show Bangla numerals (setting).

### 3.4 Spacing, radius, elevation
- 4 px base; spacing steps 4, 8, 12, 16, 24, 32, 48.
- Radius: 8 px inputs/buttons, 12 px cards, full for pills/avatars.
- Elevation: cards use border + subtle shadow `0 1px 2px rgba(15,23,42,.06)`; menus/dialogs one level higher. No heavy shadows.

### 3.5 Icons
- **Lucide** only, 1.75 px stroke, 16 px in tables/buttons, 20 px in nav, 24 px in empty states. Icon-only buttons always have `aria-label` and tooltip.

### 3.6 Layout shell
```
┌ Top bar: ☰ · logo · global search · scope switcher · language · notifications · profile ┐
├ Sidebar (240 px, collapsible to 64 px icons; drawer on < 1024 px)                        │
│   grouped by module, counts only for actionable items, menu search                       │
├ Scope bar (only for multi-hub users): "Acting in: Hub X (Zone Y) · Switch"              │
├ Page header: title · breadcrumb · one primary action · secondary actions in "More"       │
└ Content: 12-col grid, max-width 1440 px, 24 px gutters (16 px on mobile)                ┘
```
Menu items are generated from the permission list (`my_permissions()`), so users never see links they cannot open.

### 3.7 Breakpoints & mobile rules
| Width | Behaviour |
|---|---|
| < 640 (phone) | Sidebar → drawer; bottom bar with 4 role-specific shortcuts (e.g. Hub Manager: Overview, Cash, Problems, Notices); tables → record cards; forms single column; sticky bottom action bar for Save/Submit; camera capture enabled for uploads |
| 640–1023 (tablet) | Drawer sidebar; 2-column forms; tables with column priority (low-priority columns hidden, shown in row details) |
| ≥ 1024 (desktop) | Fixed sidebar; full tables; side panels for record details |

Touch targets ≥ 44 × 44 px; no hover-only actions.

### 3.8 Required states for every data screen (definition of done)
1. **Loading** — skeletons matching final layout (no layout jump).
2. **Empty** — plain-language sentence + the next action if permitted.
3. **Error** — what failed, retry button, support reference ID; never raw SQL/stack traces.
4. **No permission** — explains which permission is missing and who grants it.
5. **Partial / filtered** — `ScopeNote` stating the active scope and filters.
6. **Success feedback** — toast + updated record; for money actions, show the resulting reference number.
7. **Offline / slow network** — banner; forms keep draft values.

### 3.9 Core components (shadcn/ui based, themed)
AppShell, Sidebar, ScopeBar, PageHeader, StatCard, DataTable (sort, filter, column priority, card mode), StatusBadge (fixed vocabulary per workflow), WorkflowStepper, Money (formatting + sign), DateInput (dd/MM/yyyy), MaskedField (NID/phone reveal + audit), FileUpload (camera/gallery/PDF, preview, crop/rotate), ConfirmDialog (requires reason for archive/reverse/reject), EmptyState, ErrorState, PermissionGate, LanguageSwitch.

### 3.10 Accessibility checklist (WCAG 2.2 AA target)
- Text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 18 px/bold) — tokens above already verified.
- Full keyboard use: visible focus ring (2 px `primary` + offset), skip-to-content link, logical tab order, Esc closes menus/dialogs, focus returns to trigger.
- Semantic HTML: one `h1` per page, landmarks (`nav`, `main`), real `<table>` with headers and captions.
- Forms: visible labels (no placeholder-only), errors linked via `aria-describedby`, error summary at top on submit.
- `lang` attribute switches between `en` and `bn`.
- Status never by colour only (text + icon).
- `alt` on all meaningful images; reduced-motion respected.
- Automated checks: axe-core in Playwright for every page per role; manual screen-reader pass (NVDA) before go-live.

### 3.11 Public homepage (no admin link)
Header: logo · Features · About · Contact · EN/বাংলা · **Staff Login**. Hero (one sentence what XZM-TEAM is) → feature cards (HR, Operations, Accounts, Reports, Notices & Problems, Documents) → how it works (3 steps) → contact → footer. `/secure-control` is never linked; it is not in the sitemap and is marked `noindex`.

---

## 4. Next steps
1. Implement tokens + AppShell + the state components first (Phase 1), then build every screen on them.
2. Verify at 375 / 768 / 1280 / 1440 px with Playwright screenshots and axe-core per role.
3. If you want a mobile comparison with the reference, send phone screenshots of the same pages.
