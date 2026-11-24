# Phase 01 — checks that need a real account

The browser smoke test and `npm run test:nav` use faked grants. These need real sign-ins (owner supplies the accounts; do it on a test or staging backend, not by changing live data).

## Accounts needed

| # | Role | Why |
|---|---|---|
| A | **Staff** (rider / sorter, no manager grants) | own attendance only; no Hub tab; Training and Nodi chat closed |
| B | **Hub Manager** (`hr.attendance.view` + `hr.attendance.create`) | Hub tab, hub part, quick action "হাজিরা দিন", staff list |
| C | **Zonal Manager** (`zonal.dashboard.view`) | all three attendance parts, Training, Nodi chat, zonal pages |
| D | A role with only `hr.attendance.create` + `hr.employee.view` (no `hr.attendance.view`) | no Hub tab, no attendance quick action, own page opens |
| E | A role with a saved **page list** ("শুধু এই কয়টা পাতা"), ideally one saved before the attendance pages were joined (names `/app/workforce/hub`) | list is followed; old list still shows the attendance entry |
| F | A user with **no active role** | `my_menu()` returns `null` for this case — see `PHASE01_BACKEND_HANDOFF.md` item 1 |

## For each of A–E, on a PC browser and on the Android app / a phone

1. Sidebar: every row opens its page; no row says "অনুমতি নেই" or "চালু নেই".
2. Phone bottom bar: Home, Hub (B, C only), Team/Staff, Accounts tabs lead to the right page; open one nested page from each (a staff profile, a daily sheet, a hub sub-page) and check the right tab stays on.
3. Quick `+` sheet: every tile opens its page; "হাজিরা দিন" appears for B only.
4. Old links (paste each into the address bar / open from an old notification), signed in as each role:
   `/app/workforce/attendance`, `/app/workforce/hub?tab=final&hub=<id>`, `/app/workforce/zone?tab=final`, `/app/hub/attendance`, `/app/hub/days`, `/app/hr/attendance`, `/app/hub/team`, `/app/manager/staff?tab=pending`, `/app/hr/employees`.
   Expect: one attendance page or the staff list, the query kept (hub, tab, date), never a blank page.
5. Android only: the hardware Back button from a nested page, a push notification opening a link while the app is closed and while it is open.
6. Turn the network off, reload: the "পাতার অনুমতি লোড করা যায়নি" retry card shows, nothing opens; online again, retry opens the page.

Record per role: pass/fail, the address, and a screenshot of any failure.
