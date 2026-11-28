# RPC Contracts — Data Entry V2

> Published for coordination between Claude (backend owner, per owner-approved split 2026-11-28) and ChatGPT (frontend owner, separate branch). Contracts here are the source of truth for request/response shapes; the frontend branch should treat these as the integration spec rather than inferring from PostgREST at runtime.
>
> Update rule: every backend PR that changes a public RPC's signature or return shape **must** update this file in the same PR, and call out the change in `AI_HANDOVER.md` so the frontend branch picks it up on next read.

---

## Scope

This file lists the `public.*` RPCs that the frontend may call via Supabase's `supabase.rpc(...)` client. Private-schema RPCs (`private.data_entry_*`) are internal to the engine and are **not** callable from the client.

All RPCs listed here are `security definer` with `set search_path = ''`, and every one enforces `private.has_permission('data_entry.team.edit', p_zone, null)` unless explicitly stated. Direct table access for `data_entry_*` tables is revoked from `public`, `anon`, and `authenticated` — these RPCs are the only path.

## Team management (Phase 1, PR #207)

### `data_entry_team_zones()`
Returns the zones the caller may manage.
- Args: none
- Returns: `table (id uuid, name text)`

### `data_entry_team_snapshot(p_zone uuid)`
Returns the zone's hubs + members with rank fields (added in R1).
- Args: `p_zone uuid`
- Returns: `jsonb` of shape:
  ```json
  {
    "hubs":    [ { "id": "uuid", "name": "text", "available": bool } ],
    "members": [ {
      "id": "uuid", "employee_id": "uuid", "name": "text",
      "code": "text|null", "is_active": bool,
      "primary_hub_id": "uuid", "additional_hubs": ["uuid"],
      "eligible": bool, "revision": integer,
      "rank_id": "uuid|null", "rank_number": integer|null
    } ]
  }
  ```

### `data_entry_team_candidates(p_zone uuid, p_search text)`
Searches active employees in the zone not already on the team.
- Args: `p_zone uuid`, `p_search text` (2–100 chars)
- Returns: `table (id uuid, name text, code text, hub_id uuid)` (up to 50 rows)

### `data_entry_team_save(p_zone uuid, p_employee uuid, p_primary_hub uuid, p_additional_hubs uuid[], p_is_active boolean, p_version integer)`
Adds, updates, or deactivates a team membership. Revision guarded.
- Returns: `uuid` (member id)

## Senior Rank system (Data Entry V2 · R1 PR #228 + R1.5 PR #230 + R1.1 PR #TBD)

### `data_entry_rank_list(p_zone uuid)`
- Returns: `table (id uuid, rank_number smallint, name_bn text, name text, target_multiplier_pct numeric, is_active boolean, revision integer)`

### `data_entry_rank_seed_defaults(p_zone uuid)`
Idempotent: inserts the 8 default ranks for the zone if missing. Defaults: `সিনিয়র ১..৮` at 110/108/106/104/102/100/98/96 %.
- Returns: `integer` (count of ranks newly inserted)

### `data_entry_rank_save(p_zone uuid, p_rank_id uuid, p_name_bn text, p_name text|null, p_multiplier numeric, p_is_active boolean, p_version integer)`
Revision guarded. Multiplier range 0–300. Name 1–60 chars.
- Returns: `uuid` (rank id)

### `data_entry_rank_assign(p_zone uuid, p_member uuid, p_rank_id uuid)` *(legacy, 3-arg)*
Assigns or clears a rank for a team member. **Keeps working** — the current UI uses this.
- Returns: `uuid` (member id)
- Null-safe zone check (R1.1).

### `data_entry_rank_assign(p_zone uuid, p_member uuid, p_rank_id uuid, p_version integer)` *(recommended, 4-arg)*
Same as above with optimistic concurrency. **Frontend should migrate to this overload** when convenient; pass the member's current `revision` as `p_version`. The RPC will raise SQLSTATE `40001` on stale version so the UI can prompt a refresh.
- Returns: `uuid` (member id)

### Downstream effect — target-split engine (R1.5)
Every ranked member's effective capacity in `private.data_entry_target_snapshot` is multiplied by `rank_multiplier_pct / 100`. Unranked members and inactive ranks fall back to `1.0` — Phase 1 behavior preserved. The snapshot's per-worker output includes `rank_multiplier_pct` and `effective_forecast_capacity` for the UI to display. Snapshot `rule` is `smart_auto_v1_rank`.

## Staff self-view (Phase 1 + R2.A)

### `data_entry_target_mine(p_day date default null)` *(Phase 1)*
Latest snapshot for the signed-in member across every hub they're on. For each hub returns `{hub, hub_id, date, enabled, summary, worker, history[20]}`. `worker` is the per-worker object the snapshot built; `history` is the last 20 run rows for that (hub, date) with `recorded_at`, `reason`, `forecast_target`, `actual_remaining`.

### `data_entry_staff_week(p_days integer default 7)` *(R2.A — new, for ChatGPT charts)*
Day-by-day target vs assigned vs submitted vs verified for the signed-in employee, for the trailing `p_days` days (1–90, default 7).
- Returns: `jsonb` of shape:
  ```json
  {
    "member_id": "uuid|null",
    "days": 7, "from": "date", "to": "date",
    "rows": [ {
      "work_date": "date", "hub_id": "uuid", "hub_name": "text",
      "target":    integer|null,   // snapshot forecast.parcels
      "assigned":  integer|null,   // snapshot actual_remaining.parcels
      "submitted": integer|null,   // shift_reports.attempted at the latest slot
      "verified":  integer|null    // target_observations.correct
    } ]
  }
  ```
- Null `member_id` means the caller is not an active Data Entry team member (empty `rows` returned). Days with no engine run, no submitted report and no observation are **omitted** so the chart can draw a sparse series rather than misleading zeros.

### `data_entry_shift_mine()` *(Phase 1)*
Per-hub shift pop-up status for the signed-in member: which of the three slot checkpoints is due right now, what the last submitted value was, and the schedule configured for the hub.

## Three-slot shift pop-up reports (Phase 1 evening workflow)

The popup schedule lives in `private.data_entry_shift_settings` per hub (`start_time` default 18:00 Dhaka, `open_minutes` default 480, `first_minute` 0, `second_minute` 90, `third_minute` 180). A member submits each slot via `data_entry_shift_action(..., 'report', {slot, attempted, merchants, entry_minutes, note})`. The RPC enforces:
- the slot must be currently due (`data_entry_report_due` returns true for this hub/date/slot);
- the member must be rostered (`attendance in ('present','late','half_day')` on the latest run);
- cumulative monotonicity: attempted and entry_minutes cannot regress from an earlier slot or exceed a later one;
- the final slot (3) must include `entry_minutes` whenever `attempted > 0`.

Zonal Manager or designated Head verifies with `data_entry_shift_action(..., 'review', {member_id, slot, correct})` — SQL enforces cumulative `correct`, and the slot-3 verification writes a `data_entry_target_observations` row so later targets use real rates.

Pop-up schedule itself is editable via `data_entry_shift_action(..., 'schedule', {start_time, open_minutes, first_minute, second_minute, third_minute, pickup_only})` (Zonal Manager only).

## Post-target extra-work assignment (Phase 1, confirmed for R2)

When a member's `actual_remaining.parcels` is 0, the Zonal Manager or designated Head may assign additional work via `data_entry_shift_action(..., 'assign_duty', {member_id, kind, entry_minutes, note, override?})`. Kinds map to the owner-requested categories:

| Owner's category | `kind` value |
|---|---|
| অতিরিক্ত এন্ট্রি (extra entry) | `extra_entry` |
| বিগ পার্সেল (big parcel) | `big_parcel` |
| গাড়ি লোড (vehicle load) | `loading` |
| সহযোগিতার দায়িত্ব (help a colleague) | `assist` |

Plus `training`, `senior`, `other` for shift preparation / senior-support / anything else. `data_entry_shift_action(..., 'assign_duty', {override: true})` is a zone-manager-only explicit exception that assigns duty before the member hits zero remaining; the default path refuses to pile work on someone who still has quota.

The worker closes the duty with `data_entry_shift_action(..., 'complete_duty', {id})` (self). The verifier approves with `data_entry_shift_action(..., 'approve_duty', {id})` so the duty counts toward performance.

## Zonal Manager daily overrides (Phase 1)

| Action | Purpose |
|---|---|
| `shift_action('limit', {member_id, maximum})` | **Per-member daily cap** — manual override for today's parcels for one member. |
| `shift_action('availability', {member_id, state, note})` | Set attendance reason for today (present/late/absent/half_day). |
| `shift_action('seed_pickups', {parcels, merchants})` | Opening-history entry for a previous day (D-7 to D-1). |
| `shift_action('appoint_head' / 'revoke_head', …)` | Named Head per hub with report-review/duty-assign flags. |
| `shift_action('schedule', …)` | Edit shift start, open minutes, three popup offsets. |

**Equal distribution (R2.B — shipped):** `data_entry_distribution_mode_set(p_hub uuid, p_mode text)` flips a hub between `'smart'` (rank-weighted capacity split, the default) and `'equal'` (every eligible member with positive capacity gets an equal slice of the forecast, rank ignored). Mode is stored on `private.data_entry_target_hubs.distribution_mode` and applied by the engine on the next refresh (the RPC also triggers one). The snapshot's root and every worker carry `distribution_mode` so the UI can label the current state. Per-member `shift_action('limit')` still works on top — it caps individuals inside whichever mode is active.

### R2.B protection flags (in `data_entry_target_snapshot` per-worker output)

- `fair_equal_share_parcels` (snapshot root, numeric) — `forecast_pickups / count(eligible active members)`. A member whose `forecast.parcels` falls below this baseline was, by definition, under-assigned by the current mode.
- `under_assigned` (worker, boolean) — true when the member's forecast parcels are strictly below `fair_equal_share_parcels`. Owner's rule: a member who received less work because colleagues absorbed more should not be scored negatively — the UI can render a "Protected · কম বরাদ্দ" badge.
- `protected_from_negative_eval` (worker, boolean) — true when `under_assigned` OR when the member completed every parcel they were actually given today. Performance dashboards should honour this flag and cap the negative half of the score at zero for such a member.

## Database-level invariants (R1.1)

- `data_entry_team_members_rank_zone` trigger (BEFORE INSERT OR UPDATE of `rank_id`, `zone_id` on `data_entry_team_members`): rejects any row where a non-null `rank_id` points to a rank in a different zone, even if the write bypasses the RPC layer.

## Errors the UI should handle

| SQLSTATE | Meaning | Suggested UI behavior |
|---|---|---|
| `42501` | Permission denied (zone not managed by caller) | Show "No permission for this zone" |
| `22023` | Invalid argument (wrong zone, inactive rank, bad range) | Show the raised message |
| `40001` | Revision mismatch (another session changed this row) | Reload the snapshot and prompt the user to retry |

## Pending integration work (frontend side, ChatGPT branch)

- `data_entry_rank_assign` call in `DataEntryTeam.tsx > RankAssign` currently sends 3 args. Non-breaking: the 3-arg overload still exists. Optional upgrade: pass the member's `revision` as a 4th argument to get optimistic concurrency.

## Change log for this file

- 2026-11-28 — initial publication alongside DE-V2-R1.1 (PR #231) to coordinate with the newly-split frontend ownership.
- 2026-11-28 — R2.A (PR #232): add `data_entry_staff_week(p_days)` for ChatGPT's staff-dashboard charts; document the full Phase 1 shift-popup / extra-duty / zonal-override surface so the frontend branch doesn't rebuild existing RPCs.
- 2026-11-28 — R2.B (PR #TBD): equal-distribution mode shipped — `data_entry_distribution_mode_set(p_hub, p_mode)`, new column `private.data_entry_target_hubs.distribution_mode`, `data_entry_target_snapshot` rewritten to honour mode and to expose `fair_equal_share_parcels`, `under_assigned`, `protected_from_negative_eval`. Snapshot rule key is now `smart_or_equal_v1`.
