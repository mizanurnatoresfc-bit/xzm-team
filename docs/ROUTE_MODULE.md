# রুট মডিউল / Route module

*24 Nov 2026 — owner: "রুটের যত কাজ যত মেনুতে আছে সব এক জায়গায় করো; রুটে লোকেশন যোগ করার ফিচার আরও উন্নত করো; ফিউচারে হাইলি আপগ্রেড হবে — মডিউল।"*

All route work is **one page, `/app/routes`**, with one menu group "রুট". It used to be four pages in four menus:

| Before | Now |
|---|---|
| জোনাল প্যানেল → রুট ম্যাপ (জোন) `/app/zonal/routes` | `/app/routes` (parts: ম্যাপ, রুট তালিকা, লোকেশন যোগ, এলাকা ও সাজেশন, কাভারেজ, পার্সেল ও পরামর্শ, চেক-ইন, সতর্কতা, জোনের নিয়ম) |
| ম্যানেজার প্যানেল → রাইডার রুট (হাব) `/app/hub/routes` | `/app/routes?tab=hub` |
| ম্যানেজার প্যানেল → আজকের পার্সেল পরিকল্পনা `/app/routes/plan` | `/app/routes?tab=plan` |
| সোর্টিং সেন্টার → সোর্টিং টু হাব রুট `/app/sorting/routes` | `/app/routes?tab=sorting` |

The four old addresses still work: they redirect (keeping `?zone= ?hub= ?route=`), so bookmarks and notification links are safe.
No database change: the module uses the same tables and functions as before (`route_save`, `route_zone_overview`, `route_place_save` …).

## How the page is built

```
web/src/lib/routeAccess.ts     constants: the page, the permission lists, the old addresses        (pure, no imports)
web/src/lib/routeModule.ts     THE LIST OF PARTS ("panes"), who sees which, old-address redirects    (pure)
web/src/lib/routeChecks.ts     THE LIST OF WARNING RULES ("what needs fixing")                       (pure)
web/src/lib/routeLocation.ts   THE LOCATION ENGINE: sources, search, assess, bulk                     (pure + 2 network calls)
web/src/lib/routeGeo.ts        points, distance, order, reading a pasted location                    (pure)
web/src/lib/routes.ts          the database calls (routeApi, placesApi …) + re-exports routeGeo.ts
web/src/pages/routes/
  RouteModule.tsx              the page: zone / hub pickers, stats, tab bar, route editor, rider picker
  panes.tsx                    PaneCtx (what every part receives) + PANE_VIEWS (part id → view)
  views.tsx                    one small view per part
  RouteEditor.tsx              the route editor + the "many at once" panel
  LocationUI.tsx               LocationAdder, LocationPicker, GpsButton, NoteList (shared by every screen that places something)
  LocationsPane.tsx            the "লোকেশন যোগ" part
web/src/pages/zonal/Route*.tsx the older parts, now plain components the views use (map, table, rules, coverage, places, load, plan)
```

The page address is `/app/routes?tab=<part>&zone=<id>&hub=<id>&route=<id>`. Everything is read from the address, so a refresh or a shared link lands on the same thing.

### Who sees what
Each part lists the permissions it needs (any one). The page opens for anyone holding any of them (`pagePermissions` in `navAccess.ts`).
A role with a saved page list ("শুধু এই কয়টা পাতা") that names an **old** route page keeps exactly the parts that page had (`legacy` in each pane).
Check-ins show only when the zone overview says the person may read them; the hub part (area-name routes for a hub manager) shows only to someone with no zone parts.
The database still decides what can be read or changed; the page only hides what would be refused.

## Adding to the module (the point of this layout)

### A new part (a new tab)
1. **`lib/routeModule.ts` → `ROUTE_PANES`**: add `{ id, icon, bn, en, group, needs, perms, legacy }`. `needs`: `zone` (zone data loaded first), `hub`, `center`, `none`.
   `menu: true` adds a sidebar shortcut (the menu builds its rows from this list). `id` is the `?tab=` value — keep it stable.
2. **`pages/routes/views.tsx`**: `export function MyView({ c }: { c: PaneCtx })`. `c` has the zone overview `c.o`, the picked hub / route, `c.routes` (filtered to the hub),
   `c.canEdit(hub)`, `c.edit(route)`, `c.reload()`, `c.toast()`, `c.go(tab, { hub, route })`.
3. **`pages/routes/panes.tsx`**: `myid: view('MyView')`.
That is all: the tab bar, group heading, permission check, page-list rule, menu shortcut, role-builder row and URL handling already read the list.
`tests/routeModule.test.mjs` fails if a part has no view or a view has no part.

### A new way to find a location
`lib/routeLocation.ts` → `LOCATION_SOURCES`: add `{ id, bn, en, icon, remote, search(q, env) }` returning `Candidate[]`.
`remote: false` runs on every keystroke (keep it instant); `remote: true` runs only when the person presses Enter / "অনলাইনেও খুঁজুন".
Today: `coords` (link / numbers / DMS / Plus Code), `library` (the district's villages, paras, markets), `stops` (stops of other routes), `hubs`, `online` (OpenStreetMap).
Ideas that fit as one entry each: merchant addresses from the database, a company-owned geocoder, a paid places API.
Every screen that puts something on the map — the route editor, the "লোকেশন যোগ" part, a new place in the library — uses the same `LocationAdder` / `LocationPicker`, so a new source reaches all of them.

### A new warning rule
`lib/routeChecks.ts` → `ROUTE_CHECKS`: add `{ id, bn, en, run(overview, { L, n }) → Finding[] }`. The warnings tab, its count and the "লোকেশন দিন" shortcut use it.
`runChecks(o, t, skip)` can leave rules out (a future zone setting can switch rules off).

### A new "is this sensible?" note after a stop is placed
`assess()` in `lib/routeLocation.ts` returns `{ tone, code, bn, en }[]`: today same place twice (this route / another route of the hub, within 60 m),
far from the hub (> 50 km), rough phone GPS (> 100 m), outside Bangladesh, no location. Notes never block saving.

## What the location feature does now (before: tap the map, one name search, "lat, lng" box)

* **One search box over every source.** Type a village → the library answers at once (no network); a pasted Google / OpenStreetMap link, `24.37, 88.60`, Bangla digits,
  `24°22'N 88°36'E`, a geo: link or a full Plus Code → a point; Enter → OpenStreetMap too (leaning towards the hub). A short `maps.app.goo.gl` link is explained, not silently refused.
  Empty box → the places nearest the hub and the last searches.
* **Names come with the tap.** A tap on the map names the stop after the nearest library place (350 m) — else asks OpenStreetMap — instead of "স্টপ ৩" (only while the name is still the editor's own).
* **Checked at once, never blocking.** After a stop is added: duplicate nearby (same route / other route of the hub), far from the hub, rough GPS — with **Undo**.
* **Many at once.** Paste lines or choose an Excel / CSV file (headings নাম / lat / lng / লোকেশন recognised); names without a location are matched from the library, then OpenStreetMap
  (1 per second, can be stopped); every line is shown for checking before anything is added.
* **লোকেশন যোগ part.** Every stop of the zone with no location, route by route: set it on a map picker, or fix many from the library / a file (nothing is saved before the preview is confirmed);
  library places with no location; "নতুন জায়গা".
* **Save to library.** A stop placed by hand can be kept in the place library (`ops.route_setting.edit`) so other routes find it.
* **Phone GPS** shows its accuracy and warns when it is rough.

## Two people editing one route, and the road lines (26 Nov 2026)
* **Save lock.** The editor sends `expected_updated_at` (the route's `updated_at` when it was opened) to `route_save`. If someone saved the route meanwhile the database refuses (SQLSTATE `40001`)
  and the editor shows "changed by someone else — reload". Not sending it keeps the old behaviour. Any write to the route row (even the typed parcel average) changes `updated_at`, so a refusal can be a false alarm: reopen and edit again.
* **Light zone data.** `route_zone_overview` no longer carries `road_path` (only `has_road`). `routeApi.roadPaths(zone)` → `route_road_paths` returns the lines; `RouteModule` fetches them only while the map tab or the editor is open
  and merges them into `o.routes[].road_path`, so every part keeps reading `route.road_path` as before. A new part that draws road lines should be placed in the "needs roads" rule in `RouteModule.tsx` (`needRoads`).
* **Plan arithmetic** lives in `lib/routePlanCore.ts` (pure, tested by `npm run test:plan`); `lib/routePlan.ts` keeps the database calls and re-exports it.

## Tests
```
npm run test:routes   # lib/routeGeo, routeModule, routeChecks, routeLocation + wiring (App.tsx, AppShell, panes ↔ views)   — 22 tests
npm run test:plan     # lib/routePlanCore: capacity, sharing whole parcels, the suggestion, the spread over routes — 16 tests
npm run test:nav      # the one navigation rule (also covers /app/routes and the old addresses)
npm run build && CHROME=<chromium> npm run test:smoke   # the route scenario of the smoke test now runs on /app/routes
```
`test:nav` has two failures that were there before this change (the phone-tab test for `/app/hr/leave` and the "old addresses keep their query" test for a bare `<Navigate to="/app/staff/list">`); they are unrelated.

## Not done / next
* The editor cannot drag a pin; moving a stop is "choose it, then tap the map".
* Place search and the road line use the free public OpenStreetMap / OSRM services from the browser; a busy service is reported and the rest keeps working. A paid or self-hosted geocoder would be one more source.
* Short Google links cannot be opened from a browser app (the redirect is blocked); an Edge Function could resolve them.
* The hub part still saves area names only (no GPS): giving a hub manager the zone-level `ops.route_setting.*` permissions gives them the full map editor for their hub.
* Sorting-centre → hub routes are still drawn as a diagram, not on the real map (their stops are hubs, so they could be drawn from the hubs' GPS).
