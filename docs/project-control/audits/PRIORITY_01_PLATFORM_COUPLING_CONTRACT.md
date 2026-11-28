# Backend Contract Report — Platform-Coupling in `module_release_require`

**Reported:** 2026-11-28 (Asia/Dhaka) · **Reporter:** Claude on PR #226 branch `chatgpt/module-release-control` · **Owner of fix:** ChatGPT Backend Team · **Severity:** medium (feature behaves correctly for the UI path; incorrect for direct-API callers once a module is restricted to a single platform) · **Status:** OPEN, documented, UI banner added in commit after `663d64c`.

## 1. The issue in one line

When Super Admin restricts a module to **only `web`** (or only `android`) in the System Control Center, direct API callers (RPCs, PostgREST, service-role integrations) are refused with `42501` on **both** platforms — not just the one that was deselected.

## 2. What Codex intended, verbatim

From `supabase/migrations/20261128062647_module_release_control.sql`, the private rule function:

```sql
create function private.release_rule(p_cfg jsonb, p_platform text, p_hub uuid, p_roles text[], p_demo boolean, p_user uuid)
returns boolean language sql immutable set search_path = '' as $$
  select (p_cfg->>'enabled')::boolean
    and (p_cfg->>'stage' = 'published' or
      ((p_cfg->>'demo')::boolean and p_demo and p_cfg->>'stage' in ('testing', 'ready')))
    and case when p_platform is null then p_cfg->'platforms' ?& array['web','android']
             else p_cfg->'platforms' ? p_platform end
    …
$$;
```

The `case when p_platform is null …` branch is the hinge: a NULL `p_platform` is treated as **"the caller is a direct API, so require the module to be allowed on **both** platforms"**. Codex's own code comment explains the reason:

```sql
-- Call inside feature RPCs or edge functions in addition to their own authorization.
-- Direct APIs have no verified Android/Web identity. Apply the intersection there.
create function public.module_release_require(p_module text, p_hub uuid default null) …
```

The `module_release_require` wrapper never passes `p_platform` through, so every guarded wrapper's call to `release_api_allowed('…', hub)` (which in turn calls `release_rule(…, null, …)`) lands in this intersection branch.

## 3. Why this is a UX problem

The UI reads `module_release_snapshot(platform, …)` with the real platform (`'web'` or `'android'`), so the client-side menus and routes gate correctly. But the same module's **RPCs** gate off the intersection. Consequence:

1. Super Admin flips `fleet` to `platforms:["web"]` to "turn Fleet off on the Android app for a week".
2. Web users see the Fleet menu row and can open the page. So far so good.
3. The Fleet page calls `public.fleet_board(hub_id)` to populate the dashboard. The guard inside the wrapper calls `module_release_require('fleet', hub_id)` which calls `release_api_allowed('fleet', hub_id)` which calls `release_rule(cfg, null, …)`. NULL platform → `cfg->'platforms' ?& array['web','android']` → `["web"] ?& array['web','android']` returns **false**. **42501**.
4. Web users now see "লোড করা যাচ্ছে না" / "Not authorised" even though the UI thinks Fleet is allowed.

Reproduction verified on staging: see test `T5` (fleet_board) and the general shape in `T12.1-T12.4` where `platforms:["web"]` + hub mgr on web = snapshot allows UI, but the guarded `public.fleet_board(hub)` call was refused during the test's follow-up probe — the behaviour matches what Codex coded, and the UI-level allow and API-level deny diverge in that window.

## 4. Why the Codex design chose intersection (and why it can't just flip)

Direct APIs really don't have a verified "this call came from the Web client" vs "this call came from the Android client" signal. The access token is identical across platforms, and the User-Agent header doesn't reach the Postgres function. If Codex trusted a client-supplied `p_platform` argument, a malicious Android user could lie and claim `'web'` to bypass an Android-only block. Intersection-when-unverified is Codex's safe default: the direct API refuses unless both platforms are allowed, so the restriction is never bypassed.

But the practical effect is that the "platforms" control is **only useful for the UI menu visibility**, not for actually disabling a module on one platform while leaving it running on the other — which is what Super Admin expects when they tick the checkbox.

## 5. Options for the Backend Team

### A. Document-only — accept the current semantics (shipped now)

- The System Control Center form grows a warning banner (landed in the commit after `663d64c`): when Super Admin picks only one platform, a yellow banner says "direct APIs refuse on BOTH platforms until this list covers both again".
- This is the smallest change and keeps Codex's security invariant.
- Trade-off: the "web-only" / "android-only" control is reduced to "UI gate only" with a clear label.

### B. Signed platform claim in the JWT

- Add `platform: 'web' | 'android'` to the Supabase auth JWT at sign-in time, signed by Supabase so the function can trust it.
- Change `module_release_require` to pass `(auth.jwt() ->> 'app_metadata' ->> 'platform')::text` as the `p_platform` arg.
- Change `release_rule`'s `case when p_platform is null` branch to still intersect (for callers that genuinely don't set it — service_role batch jobs, cron) — but a trusted claim unlocks per-platform gating for real users.
- Requires: Edge Function or trigger that writes the `platform` claim on login based on which client called `auth/v1/token`. The login screen on the Android Capacitor build and the Web Vite build each know which platform they're on (via `isNativeApp()` — see `web/src/lib/native.ts`), so the client can request its platform when it signs in.
- Risk: a user on web could sign in through the Android app's token (if they held a valid refresh token from a prior Android session) and keep that platform claim for the token's lifetime — acceptable for a soft gate but not for a hard one.

### C. Platform-aware wrapper signatures

- Change every guarded wrapper to accept `p_platform text` (default null) and pass it through to `module_release_require(module, hub, platform)`.
- The frontend and the Android app each call the wrapper with their known platform; direct-API batch jobs call with `null` and keep the intersection semantics.
- No JWT changes. Trade-off: 33 wrappers plus every future one must thread the arg, and the semantics reduce to **client self-declaration** (same trust model as B without a JWT guarantee).

### D. Scope the `platforms` field to UI-only in the data model

- Rename `platforms` → `menu_platforms` in `release_config.jsonb` + `release_default()` + `release_rule()`.
- Drop the `platforms` branch from `release_rule`; keep it only inside `release_decisions` for the snapshot shape so the menu still gates.
- Clearest semantics, but requires a data migration for existing configs and drops the server-side enforcement entirely.

### Recommendation

**Option A for Priority 01 release** (already landed — warning banner + this document). **Option B as a follow-up** (a dedicated JWT claim), because it is the only one that preserves the semantics Super Admin reasonably expects ("turn it off on Android") without trusting the client to self-declare.

## 6. Scope of this report (conflict avoidance)

This report is **by** Claude **for** the ChatGPT Backend Team. Claude will not change `private.release_rule`, `public.module_release_require`, or any `public.*` guarded wrapper to implement Options B / C / D — that is Backend Team scope per the authority split in `AI_HANDOVER.md §2` and the owner's directive on PR #226.

Claude's only change in this area is the **UI warning banner** in `web/src/pages/users/ModuleControl.tsx` (shipped in the same commit as this document) and this report. The banner points the Super Admin reader to this file by path so the next time someone restricts a module to one platform they see the known limitation and can file their preference between A / B / C / D.

## 7. Where to find the evidence

- Staging run of `T5` (fleet_board, published + flipped) — chat transcript 2026-11-28.
- Staging run of `T12.1-T12.4` (fleet platforms=["web"] / ["android"] / ["web","android"]) — chat transcript 2026-11-28, `TEST_REPORT.md` Priority 01 second-pass section.
- Codex implementation: `supabase/migrations/20261128062647_module_release_control.sql` lines `create function private.release_rule(…)` and the wrapper `create function public.module_release_require(…)` just below.
- Codex design comment: the two-line comment block immediately above `module_release_require` naming "Direct APIs have no verified Android/Web identity. Apply the intersection there."
