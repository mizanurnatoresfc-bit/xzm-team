// Who may use which part of the route module — constants only (no imports), so navAccess.ts, the menu and the module itself all read the same lists.
// Before 24 Nov 2026 the route work sat on four pages in four menus; those addresses still work (they open the module) and a role whose
// saved "শুধু এই কয়টা পাতা" list names one of them keeps exactly the parts that page had (see panesFor in routeModule.ts).

/** The one page of the module. Each part ("pane") is `?tab=<id>`. */
export const ROUTE_PAGE = '/app/routes'

/** The permissions behind the parts. A pane lists the ones it needs ("any of"); the database checks again on every call. */
export const ROUTE_PERMS = {
  /** zone routes: the map, route list, coverage, place library, parcel load, rules, warnings */
  zone: ['ops.route_setting.view', 'ops.route_setting.edit'],
  /** a hub manager's own hub: area-name routes and giving riders their route */
  hub: ['ops.route.view', 'ops.route.edit'],
  /** the day's parcel plan */
  plan: ['ops.route_plan.view'],
  /** who checked in at which stop */
  visits: ['ops.route_visit.view'],
  /** sorting centre → hub routes */
  sorting: ['sorting.center.view'],
} as const satisfies Record<string, readonly string[]>

/** The old pages of the module, and the part each one opens now. */
export const ROUTE_OLD_PAGES: Record<string, string> = {
  '/app/zonal/routes': 'map',
  '/app/hub/routes': 'hub',
  '/app/routes/plan': 'plan',
  '/app/sorting/routes': 'sorting',
}
/** Holding any one of these opens the module page (each part then checks its own). */
export const ROUTE_ANY: readonly string[] = [...new Set(Object.values(ROUTE_PERMS).flat())]
