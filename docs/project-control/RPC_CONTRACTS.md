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

- 2026-11-28 — initial publication alongside DE-V2-R1.1 (PR #TBD) to coordinate with the newly-split frontend ownership.
