# Phase 1 — পদবি অনুযায়ী রোল / A role for every post (19 Nov 2026)

**অবস্থা / Status:** ফাইল লেখা ও লোকাল টেস্ট শেষ। **লাইভে বসানো হয়নি।** মালিকের অনুমোদনের অপেক্ষায় (GATE)।
Files written and tested on a throwaway local database. **Not applied to any Supabase project.** Waiting for the owner (GATE).

## কী বদলাবে / What changes

1. **৫টা নতুন রোল** (শুধু নিজের কাজ; কিছু অনুমোদন, আর্কাইভ বা সেটিং করতে পারে না):

   | রোল / Role | পদবি / Posts | অনুমতি / Permissions (plus hub and organisation names) | বাড়তি পাতা / Extra pages |
   |---|---|---|---|
   | `sorting_loader` সর্টিং ও লোডার | Sorting + Loader | sorting centre and parcels: view, create; raise an issue | `/app/sorting`, `/app/issues` |
   | `data_entry` ডাটা এন্ট্রি | Data Entry | parcels: view, create; merchants: view; daily sheet: view, create; raise an issue | `/app/accounts/daily`, `/app/issues` |
   | `hub_cc` হাব সিসি | Hub CC | parcels, deliveries, merchants: view; parcel issues: view, create, edit; issues: view, create; daily sheet: view, create | `/app/accounts/daily`, `/app/issues` |
   | `fleet` গাড়ি | Driver, Auto Driver, Helper | vehicles: view; vehicle log and requisitions: view, create; fuel slip: create; raise an issue | `/app/issues` |
   | `guard` সিকিউরিটি গার্ড | Security Guard | vehicles: view; vehicle log: view, create | — |

   Home page and page list: copied from "staff" (the 5 pages the owner chose) plus the extra pages above.
   None of these roles has HR, approval, zonal or user rights, so their holders open the **staff panel** (`/app/staff`).

2. **পদবির রোল / The role of each post** (checked against live, read-only):

   | Post | Now | After |
   |---|---|---|
   | Sorting + Loader | staff | **sorting_loader** |
   | Data Entry | manager_hisab (switched off!) | **data_entry** |
   | Hub CC | manager_hisab (switched off!) | **hub_cc** |
   | Driver, Auto Driver, Helper | staff | **fleet** |
   | Security Guard | staff | **guard** |
   | Commission Rider | rider | rider |
   | Manager, Assistant Manager | hub_manager | hub_manager |
   | Zonal Manager | zonal_manager | zonal_manager |

   A post's role is replaced only if it still holds the role the 15 Nov launch gave it, so a role the owner chose by hand is kept.
   A post with no role, and every new post, gets **staff**.

3. **নিজে থেকে মিলে যায় / Kept in step by itself.** Every role now records where it came from (`user_roles.granted_via`: `position` or `manual`).
   - A login is linked to a person → the post's role is given.
   - Post, hub or zone changes (transfer, promotion) → the old post role is **ended with a reason** (never deleted), and the new one is given.
   - The person resigns or is archived → the post role is ended.
   - The Super Admin changes a post's role → everyone on that post moves.
   - **A role given by hand is never touched.** Super Admin accounts are never changed. Nobody's own account is changed by their own action.
   - Own-work roles move by themselves. A **hub manager or zonal manager** role is given only if the person making the change may give it.
     Otherwise the person waits on the **"পদবির রোল বাকি"** list (`/app/rollout`) with a **রোল দিন** button for an admin.
4. হাব থেকে লগইন বানালে এখন নতুন ৫টা রোলও দেওয়া যাবে (আগে শুধু rider / staff).
5. লগইন বানানোর পাতায় বন্ধ (inactive) রোল আর দেখাবে না। জোন-পর্যায়ের পদবির লগইন পুরো জোনের জন্য হবে।
6. Phase 0 (নিরাপদ অংশ): "Natore Sadar Hub"-এর status ঠিক করা; 93869-এর আর্কাইভের কারণ লেখা; একই নামের দুটো হাব আর বানানো যাবে না।

### লাইভে চালালে ঠিক যা হবে / Exact effect on live (computed read-only)

- 6 posts change role (table above). The others stay as they are.
- Of the 3 logins: the **Lalpur loader (92034)** moves from `staff` to `sorting_loader` (the staff role is ended, not deleted).
  The **Lalpur manager (10086)** keeps `hub_manager` (now marked as the role of the post). **The owner (520, Super Admin)** is not touched.
- No other staff member has a login yet, so no one else changes.

## ফাইল / Files

| | |
|---|---|
| `supabase/migrations/20261119000100_phase0_cleanup.sql` | Phase 0 safe part |
| `supabase/migrations/20261119000200_position_roles.sql` | Phase 1 |
| `supabase/tests/99zzzzzzzzzzzzzzzzz_position_roles.sql` | 25 new tests |
| `supabase/tests/99f_role_dashboards.sql`, `99v_staff_logins_rollout.sql`, `99zzz_dashboard_order.sql` | 3 old tests updated for the new rules (20 roles, new post = staff, the post gives the rider role) |
| `web/src/lib/rollout.ts`, `web/src/pages/users/Rollout.tsx` | "পদবির রোল বাকি" list |
| `web/src/pages/users/BulkLogins.tsx` | no switched-off roles; zone-level posts by post level |

## পরীক্ষা / Tests

- SQL: **1930 assertions, 0 failing files** (was 1902 before this work).
- `npm run typecheck`, `npm run build`: OK. Smoke test (PC and phone): **471 checks, all passed**.

## কীভাবে দেখবেন (লাইভে বসানোর পর) / How to check after it is applied

1. `/app/access` → the roles list shows the 5 new roles; `/app/users?bulk=1` → each post shows its new role.
2. Sign in as the Lalpur loader → the staff panel opens, and the menu has the sorting and issues pages.
3. Transfer a test person to another hub (`/app/hr/employees` → profile → transfer) → the role moves with them.
4. `/app/rollout` → "পদবির রোল বাকি" appears only when someone is waiting.

## ঝুঁকি / Risks

- **The only Supabase project is live.** Applying these files changes the live database; take a backup first (Decision A in `PHASE0_CLEANUP_PLAN.md`).
- **Data Entry and Hub CC get the daily sheet (view, create).** This follows the owner's 15 Nov choice that they keep the daily accounts. They no longer get approvals (`manager_hisab` had them). If they should not touch the sheet, remove the two rows before applying.
- **Resignation now ends post roles.** If someone is marked resigned by mistake, setting them active again gives back an own-work role by itself; a manager role must be given again from the list.
- **A duplicate hub name is now refused** with a database error; the hub form shows the general error message.
- **Not in Phase 1** (Phase 2 onward): the screens of each role (loading list, parcel entry, call queue and so on). Today these roles see the staff panel with their pages.

## পরের ধাপের আগে যা লাগবে / Needed before Phase 2

- Approval of this phase, and Decision A (where to apply).
- Permission to create **test logins for Naldanga** (6 people) — real accounts on the live project.
- Open question 4: which posts may submit their own expenses.
