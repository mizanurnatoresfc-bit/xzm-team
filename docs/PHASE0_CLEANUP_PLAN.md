# Phase 0 — পরিষ্কারের পরিকল্পনা / Cleanup plan (18 Nov 2026)

**অবস্থা / Status:** মালিক অনুমোদন দিয়েছেন (১৮ নভেম্বর)। migration ফাইল `supabase/migrations/20261119000100_phase0_cleanup.sql` লেখা ও টেস্ট করা আছে; **লাইভে এখনো চালানো হয়নি** (মালিক: "এখন চালিও না")।
Approved by the owner (18 Nov). The migration file is written and tested; **not yet applied** (owner: "not now").

**মালিকের সিদ্ধান্ত / Owner's decisions (18 Nov 2026):**
- The test applicant "Mizanur Rahaman" → turned down and archived. ✅ In the migration.
- The salary record of 93869 → copied to 520 (it has no pay items). ✅ In the migration.
- MD Rabbi `62204` and MD. RABBI `30634` (Singra) → **two different people**. No change.
- Keep `issues`, retire `parcel_issues` → in Phase 7.
- Test logins for Naldanga → yes, **after** the Phase 0 and Phase 1 migrations are applied (otherwise a Data Entry login would get the switched-off role).

Everything below was read from Supabase project **`ndgnhvbpmtxrpplgsslz` (xzm-team-erp-dev)** with read-only queries.

> ⚠️ **এই প্রজেক্টই লাইভ / This project is the live one.** It is the only project in the Supabase account. The Netlify site
> (`xzm-team-erp.netlify.app`) and the Android app use it, and the 132 real staff are in it. There is no separate dev database.
> Every migration in later phases would change live data. See "Decision A" at the end.

---

## 1. হাব / Hubs

8 hubs have active staff (132 in total): Natore Sadar 32, Natore Shorting Centre 32, Boraigram 17, Lalpur(Natore) 14,
Singra(Natore) 14, Gurudaspur 9, Bagatipara 8, Naldanga 6.

Before this check, I counted every row in all 59 tables that point at `hubs`.

| Hub (code) | এখনকার অবস্থা / Now | যা এখনো এটার দিকে দেখায় / Still pointing at it | প্রস্তাব / Proposal |
|---|---|---|---|
| **Lalpur (Natore)** (`779-OLD`) | Archived ("double"), inactive, 0 staff | nothing | **No change.** Already archived; keep for history. The real hub is `Lalpur(Natore)` (`779`). |
| **Singra (Natore)** (`SINGRANATORE`) | Archived ("double"), inactive, 0 staff | 13 closed `employee_assignments` (joining, ended 14 Nov) | **No change.** The history rows are correct (people joined here, then moved to `Singra(Natore)` `782`). |
| **Natore** (`80-OLD`) | Archived ("double"), inactive, 0 staff | nothing | **No change.** |
| **Natore Sadar Hub** (`NATORESADARH`) | Archived ("Duplicate of Natore Sadar — merged…") but **status still `active`** | 1 closed `employee_assignments` | **Fix one field:** `status = 'inactive'`, so lists filtered by status alone never show it. |
| **Natore (Horispur)** (`832`) | Active, 0 staff | 1 `office_properties` row | **Not a duplicate:** a separate office with its own property record. Keep. *Owner: is it a hub that will get staff?* |
| **Bonpara Bypass More (Natore)** (`986`) | Active, 0 staff | 1 `office_properties` row | Not in your list; same as above. Keep. |

The canonical Sadar hub is **`Natore Sadar` (code `80`)**, not "Natore Sadar Hub".

**Prevent new duplicates (proposal):** a unique index on the normalised name (case, spaces and brackets ignored) of hubs that are not archived. Today's active hubs pass it.

## 2. কর্মী / People

| Record | Now | References | Proposal |
|---|---|---|---|
| **Mizanur Rahman — 520** (Zonal Manager, Natore Sadar) | Active, has login (Super Admin) | — | The real record. Keep. |
| **Mizanur Rahman — 93869** (Zonal Manager) | Resigned, archived 15 Nov, reason "Ok" | 2 assignments, 2 status history, **1 salary (compensation) row** | Keep archived. (a) Change the archive reason to "ডুপ্লিকেট রেকর্ড — আসল রেকর্ড 520 / Duplicate; real record is 520". (b) **The salary row sits on this archived record, and 520 has none.** Proposal: copy it as a new compensation row for 520 and leave the old one untouched. *Owner to confirm the amount is right.* |
| **AZHARUL ISLAM** (Lalpur, Manager, no Employee ID) | Rejected, archived ("পরীক্ষার এন্ট্রি") | 1 application, 1 sensitive row | **No change.** The real manager is MD. AZHARUL ISLAM `10086` (active, has login, hub manager role). |
| **Mizanur Rahaman** (Manager, Natore Sadar, no Employee ID) — *not in your list* | **Applicant, not archived**, mobile one digit away from 520's | 1 application | Looks like a test entry. Proposal: set status `rejected` and archive it with the reason "পরীক্ষার এন্ট্রি / Test entry". *Owner to confirm.* |

**Same names, different Employee IDs. Probably different people; owner please confirm:**

- MD Rabbi `62204` and MD. RABBI `30634`: **both at Singra(Natore)**. This pair is the one most worth checking.
- MD:Ashraful Islam `71161` (Sorting Centre) and Md. Ashraful Islam `4255` (Boraigram).
- MD MIZANUR RAHMAN `3660` (Bagatipara) and Mizanur Rahman `520` (Natore Sadar).

No two records that are still live share a mobile number.

## 3. Issues vs parcel_issues

| | `issues` + `issue_events` | `parcel_issues` + `parcel_issue_events` |
|---|---|---|
| Rows | 0 / 0 | 0 / 0 |
| Used by the app | Yes: `/app/issues`, `lib/issues.ts`, the assistant, hub panels | **No screen uses it** |
| Has | assign, due date, solve photo, approve, `reopen_count`, nudges, parcel link | type, priority, resolution |

**Proposal:** keep **`issues`** as the single model. In Phase 7, add the issue-type lookup and the full lifecycle
(open → assigned → in progress → waiting → resolved → verified → closed) to it. Retire `parcel_issues`: revoke writes and leave the empty tables
in place, or replace them with a read-only view over `issues`. Both tables are empty, so no data moves.

## 4. Findings that change later phases

1. **Only 3 of 132 active staff have a login:** the owner (Super Admin), the Lalpur manager (hub_manager) and one Lalpur loader (staff).
   Every role panel needs logins first, so Naldanga (6 people) needs its logins made before Phase 2 testing.
2. **`positions.default_role_id` already exists** and is used when a hub makes logins (migration `20261115002200`). Phase 1 extends it; it does not rebuild it.
   - Data Entry and Hub CC point at `manager_hisab`, which is **inactive**, so a login made for them today would get a switched-off role.
   - Sorting + Loader, Driver, Auto Driver, Helper and Security Guard all point at `staff`.
   - `private.hub_login_role()` lets a hub hand out only `rider` and `staff`. The new roles (sorting_loader, data_entry, hub_cc, fleet, guard) must be added to that list.
3. **The `zonal_manager` role has 0 users.** The only zonal person (520) uses Super Admin, so the zonal panel has never been tested with real zonal rights.
   For Phase 4 testing I propose a separate test login with the zonal_manager role.
4. The staff panel shows "ছুটির আবেদন" only to people holding `hr.leave.*`. Phase 2 removes it from the staff panel.
5. Repo and live are in step: all 99 live migrations have files, and `docs/MIGRATIONS_LIVE_MAP.md` is current.
6. Pushing to `main` deploys the website (GitHub Actions → Netlify). All work stays on branch `claude/blissful-cerf-on2duy` until approved.

## 5. Proposed SQL (NOT a migration yet, NOT run)

This becomes `supabase/migrations/<timestamp>_phase0_cleanup.sql` only after approval. Every statement only updates or inserts; nothing is deleted.

```sql
-- 1. Archived duplicate hub still marked active
update public.hubs set status = 'inactive', updated_at = now()
 where code = 'NATORESADARH' and archived_at is not null and status = 'active';

-- 2. Clearer archive reason on the old zonal record
update public.employees
   set archive_reason = 'ডুপ্লিকেট রেকর্ড — আসল রেকর্ড 520 / Duplicate; real record is 520', updated_at = now()
 where employee_code::text = '93869' and archived_at is not null;

-- 3. Test applicant (only if the owner confirms)
update public.employees
   set status = 'rejected', status_since = current_date,
       archived_at = now(), archive_reason = 'পরীক্ষার এন্ট্রি / Test entry'
 where id = '982663af-4822-446d-89ff-21ffb6257bb9' and status = 'applicant' and archived_at is null;

-- 4. Salary row onto the real record (only if the owner confirms): written after checking employee_compensation's columns

-- 5. No new duplicate hub names
create unique index if not exists hubs_live_name_norm_uq
  on public.hubs (lower(regexp_replace(name, '[\s()]', '', 'g'))) where archived_at is null;
```

Where the app writes to `audit_logs` through triggers, statements 1–3 are recorded there too.

---

## Decisions needed before Phase 1 / যা জানা দরকার

- **A. Which database to use (open question 5).** There is only one Supabase project, and it is live. Options:
  1. Create a second free Supabase project as the real dev copy, apply every migration and test there first, then on live. **Recommended.**
  2. Keep working on this one project, with a backup before every migration and tests on Naldanga only.
- **B.** Approve or change each row in sections 1 and 2 (especially the test applicant, the salary copy and the Rabbi pair).
- **C.** Approve "keep `issues`, retire `parcel_issues`".
- **D.** May I create test logins (Naldanga staff and one zonal test user)? This creates real auth users on the live project.
