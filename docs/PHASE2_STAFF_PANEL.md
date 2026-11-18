# Phase 2 — স্টাফ প্যানেল / Staff panel (19 Nov 2026)

**অবস্থা / Status:** ফাইল লেখা ও লোকাল টেস্ট শেষ। **লাইভে বসানো হয়নি** (মালিক: "এখন চালিও না")। GATE.
Files written and tested on a throwaway local database. **Not applied.** Testing with a real test user waits until Phases 0–2 are applied
and the Naldanga logins exist.

## যা আগে থেকেই ছিল (বদলানো হয়নি) / Already there (kept)

| Spec 2.2 / Phase 2 | Where it is |
|---|---|
| "হাবে এসেছি" → waits for the hub manager's approval | `attendance_self_marks` + `att_self_decide` (16 Nov), the staff panel's attendance card |
| Own expense / bill: name, amount, date, voucher photo, optional vehicle | `/app/accounts/mine?bill=1` (`da_claim_save`): **any staff member with a hub can already submit**; the hub manager takes it into the sheet or returns it with a reason |
| Bills list with status | Staff panel → "আমার বিল" |
| Empty states for route and duty | "রুট দেওয়া হয়নি" / "কোনো দায়িত্ব লেখা নেই" |
| Monthly attendance book (days 1–17), absence with the Steadfast website application | `/app/workforce/attendance` (17–18 Nov) |

## কী বদলাল / What changed

1. **দৈনিক গ্যাপ রিপোর্ট / Daily gap report** (`my_att_gap_answer`, same signature):
   - Three reasons: **ছুটিতে ছিলাম** · **কাজে ছিলাম, হাজিরা ওঠেনি** · **অন্য কারণ**.
   - **No separate leave request any more.** "ছুটিতে ছিলাম" used to file a leave request with a leave type; now the answer itself is the report.
     Old answers that already filed one keep it.
   - A written note is needed only for "অন্য কারণ" (at most 500 letters); for the other two it is optional.
   - Status: জমা (submitted) → অনুমোদিত (approved) or ফেরত (returned, with the manager's reason). An approved report cannot be changed; a returned one can be answered again.
   - The person's **hub manager is told** of each report (notification → `/app/hub/attendance`).
2. **The hub manager approves** reports of their own hub (`hr.attendance_gap.approve` added to `hub_manager`, hub scope).
   Another hub's manager cannot see or approve them (tested). The zonal manager already sees and approves the whole zone.
3. **The staff panel card** (`components/NodiGaps.tsx`, also on the dashboard): the missing days of the **last 3 days** are big date buttons, newest first.
   Tapping one opens a sheet with the three reasons. Older open days are folded under "আরও আগের … দিন"; earlier reports are listed with their status.
4. **No leave application on the staff panel.** The "ছুটির আবেদন" row is removed.
5. **Plain staff can report an issue.** `/app/issues` is added to the staff role's page list (the database already let anyone posted at the hub raise one).

## ফাইল / Files

| | |
|---|---|
| `supabase/migrations/20261119000300_staff_panel_gaps.sql` | migration |
| `supabase/tests/99zzzzzzzzzzzzzzzzzz_staff_panel_gaps.sql` | 23 new tests |
| `supabase/tests/99x_attendance_gaps.sql` | updated for the rule "no leave request" and "the hub manager approves" |
| `web/src/components/NodiGaps.tsx`, `web/src/lib/gaps.ts`, `web/src/pages/staff/StaffPanel.tsx`, `web/src/theme.css` | the screens |
| `web/tests/smoke.mjs` | the gap card check follows the new flow (dates relative to today) |

## পরীক্ষা / Tests

- SQL: **1952 assertions, 0 failing files.**
- Typecheck and build: OK. Smoke test (PC and phone, no sideways scroll): **all checks passed**, including
  "three reasons, and no leave type" and "one tap on a date sends that day's report, with no leave request".
- Screens checked at phone width (390 px): the card and the reason sheet.

## কীভাবে দেখবেন (লাইভে বসানোর পর) / How to check after applying

1. Sign in as a Naldanga staff member with a day missing in the last 3 days → the staff panel shows "হাজিরার ফাঁকা দিন" with the date.
2. Tap the date → pick "ছুটিতে ছিলাম" → জমা দিন. The status becomes "জমা — ম্যানেজারের অনুমোদনের অপেক্ষায়".
3. The Naldanga hub manager gets a notification. Until Phase 3 adds the approve button to the hub page, approve from `/app/zonal/assistant` (zonal) or the zonal manager's view.

## ঝুঁকি / Risks and what is left

- **The hub manager's approve screen is Phase 3.** The database lets them approve now, and they are notified, but their hub page has no button for it yet.
- **Approving a report does not write attendance** (as before: "nothing here touches pay"). Should an approved "কাজে ছিলাম" become *present*, and "ছুটিতে ছিলাম" become *leave*, on the register? Owner to decide (it affects salary).
- Open: **deadline for a gap report and escalation** (question 3). The card asks about the last 3 days first; older days can still be answered.
- Open: **which posts may submit their own expenses** (question 4). Today anyone with a hub can submit a bill; limits and the zonal approval come in Phases 3–4 (`da_approval_rules`).
- `hr_leave` pages still exist for HR and managers (only the staff panel row is gone).
