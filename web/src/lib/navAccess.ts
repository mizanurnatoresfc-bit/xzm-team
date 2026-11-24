// The one access rule for navigation: which pages a person may open, and which links the menus show.
// The sidebar, the phone tabs, the quick actions and the page routes (ProtectedRoute) all ask the functions here, so a link is
// never shown for a page that would say "no permission", and a page never opens that its link would have hidden.
// Pure file (no imports): it is also run by tests/navAccess.test.mjs. This only hides and blocks pages; what data may be
// read or changed is decided again by the database (RLS / RPC).
// `menu` null = no limit. A role limited to "শুধু এই কয়টা পাতা" has a list.

/** Always open: the home page, the staff panel and one's own profile, accounts, vehicle, password and device settings.
 *  These show only the person's own things; a role's page list limits the work pages. */
const ALWAYS = ['/app', '/app/staff', '/app/accounts/mine', '/app/fleet/mine', '/app/me', '/app/me/complete', '/app/me/permissions', '/app/notifications', '/app/notices', '/app/references', '/app/password', '/app/settings',
  // My Workforce: a person's own people lists and attendance book (the hub and zone report pages follow the role's page list)
  '/app/workforce', '/app/workforce/given', '/app/workforce/hand', '/app/workforce/attendance']
/** The same list, for pages that explain which pages a role can be limited to. */
export const ALWAYS_OPEN: readonly string[] = ALWAYS
/** The one attendance page. It opens for everybody (a person's own book; its hub and zone parts follow the person's permissions),
 *  but its menu entry follows the role's page list: a list saved before the pages were joined names the old hub or zone page. */
const ATTENDANCE = '/app/attendance'
const ATTENDANCE_OLD = ['/app/workforce/hub', '/app/workforce/zone']
/** Pages that belong to a listed page (opened from it, not from the menu). */
const WITH: Record<string, string[]> = {
  '/app/staff/list': ['/app/hr/applications', '/app/hub/team', '/app/hr/employees'],   // a person's profile opens from the staff list
  '/app/roles': ['/app/access'],
  '/app/access': ['/app/roles'],
  // the report upload page comes with the accounts and zonal pages it is opened from
  '/app/accounts/daily': ['/app/accounts/report-import'],
  '/app/accounts/khata': ['/app/accounts/report-import'],
  '/app/zonal': ['/app/accounts/report-import'],
}
/** "রোল ও অনুমতি" (inside the Android app) and "অ্যাডভান্সড রোল ও পারমিশন" (website) are one sub-menu: a list that has either has both. */
const TWIN: Record<string, string> = { '/app/roles': '/app/access', '/app/access': '/app/roles' }
export const withTwins = (menu: string[]) => [...new Set([...menu, ...menu.map(p => TWIN[p.split('?')[0]]).filter(Boolean)])]
const bare = (p: string) => p.split('?')[0].replace(/\/+$/, '') || '/app'
/** The Residential pages (/app/office/residential/x) are the residence side of the office page /app/office/x:
 *  a role whose page list has the office page may open its residential twin, so splitting the menu took nothing away from anyone. */
const RES = '/app/office/residential/'
const officeTwin = (p: string) => p + '/' === RES ? '/app/office/overview' : p.startsWith(RES) ? '/app/office/' + p.slice(RES.length) : null
/** Only a page list saved before the split (it names no residential page) follows the office twin. Once Super Admin picks any
 *  residential page for a role, its list is taken as it is — so Office can be shown and Residential hidden, or the other way round. */
const beforeSplit = (menu: string[]) => !menu.some(p => (bare(p) + '/').startsWith(RES))

/** A menu entry is shown when it is on the list. */
export const inMenu = (menu: string[] | null, to: string): boolean => {
  if (!menu || ALWAYS.includes(bare(to)) || menu.includes(to) || withTwins(menu.map(bare)).includes(bare(to))) return true
  if (bare(to) === ATTENDANCE && menu.some(p => ATTENDANCE_OLD.includes(bare(p)))) return true
  const twin = beforeSplit(menu) ? officeTwin(bare(to)) : null; return !!twin && inMenu(menu, twin)
}
/** A page may be opened when it is on the list, under a listed page, or belongs to one. */
export function pageAllowed(menu: string[] | null, pathname: string): boolean {
  if (!menu) return true
  const here = bare(pathname)
  if (ALWAYS.includes(here) || here === ATTENDANCE) return true
  const twin = beforeSplit(menu) ? officeTwin(here) : null; if (twin && pageAllowed(menu, twin)) return true
  const open = menu.map(bare).flatMap(p => [p, ...(WITH[p] ?? [])])
  return open.some(p => p !== '/app' && (here === p || here.startsWith(p + '/')))
}

/**
 * Which of the three panels a person belongs to, from what their role may do: 0 = staff, 1 = manager, 2 = zonal manager.
 * The menu shows the panels up to this level; a few things (training centre, the AI helper, the first-steps box) are for level 2 only.
 */
export const panelLevel = (can: (p: string) => boolean): 0 | 1 | 2 =>
  can('zonal.dashboard.view') || can('system.user.view') || can('hr.request.approve') ? 2
    : can('hr.employee.view') || can('hr.attendance.create') || can('da.sheet.approve') ? 1 : 0
/** Pages only the zonal manager's level gets in the menu (the owner asked for them to be off the manager's and staff's screens). */
export const ZONE_ONLY = ['/app/training', '/app/nodi/chat']

/** The hub part and the zone part of the attendance page (/app/attendance). The page, the Hub tab and the quick action all use these. */
export const ATTENDANCE_HUB = ['hr.attendance.view', 'ops.staff_daily.view'] as const
export const ATTENDANCE_ZONE = ['zonal.dashboard.view'] as const

/** The sections of /app/hub/:section and what each needs (the page lists its tabs from the same table). */
export const HUB_SECTION_PERMS = {
  pickup: ['ops.pickup.view', 'ops.pickup_as_hub_manager.create', 'ops.pickup_as_pickup_manager.create', 'ops.pickup_as_rider.create'],
  tasks: ['zonal.task.view', 'zonal.task.create'],
  ops: ['zonal.hub_metric.view', 'zonal.hub_metric.create'],
  accounts: ['da.sheet.view', 'da.sheet.create'],
  logins: ['system.user_hub.create'],
  routes: ['ops.route.view', 'ops.route.edit'],
} as const satisfies Record<string, readonly string[]>

/** Daily-accounts pages: the sheet may be seen or made. */
export const DA_SHEET = ['da.sheet.view', 'da.sheet.create'] as const
const sheetPermissions = DA_SHEET
/** What a work page needs: the person must hold at least one of the permissions. A page that is not here needs none beyond its role's page list
 *  (it shows the person's own things). Every menu row, tab and quick action that points to one of these pages is checked against it, and so is the route. */
const pagePermissions: Record<string, readonly string[]> = {
  '/app/accounts/khata': ['da.sheet.create'],
  '/app/accounts/center': sheetPermissions,
  '/app/accounts/daily': sheetPermissions,
  '/app/accounts/learn': sheetPermissions,
  '/app/accounts/report-import': ['da.import.create', 'da.sheet.view'],
  '/app/accounts/reports': ['da.report.view'],
  '/app/accounts/settings': ['da.settings.configure'],
  '/app/hr/applications': ['hr.application.view', 'hr.application.create'],
  '/app/hr/duties': ['hr.duty.view', 'hr.duty.edit'],
  '/app/hr/import': ['hr.import.create'],
  '/app/hr/profile-gaps': ['hr.employee.view'],
  '/app/hr/referrals': ['hr.referral.view'],
  '/app/manpower': ['hr.employee.view', 'hr.request.create', 'hr.request.approve'],
  '/app/nodi': ['nodi.settings.configure'],
  '/app/nodi/chat': ['nodi.assistant.view', 'nodi.settings.configure'],
  '/app/rollout': ['hr.employee.view'],
  '/app/branding': ['system.settings.configure'],
  '/app/menu': ['system.settings.configure'],
  '/app/role-dashboards': ['system.role.edit'],
  '/app/roles': ['system.role.view'],
  '/app/access': ['system.role.view'],
  '/app/users': ['system.user.view'],
  '/app/routes/plan': ['ops.route_plan.view'],
  '/app/staff/list': ['hr.employee.view', 'hr.application.create', 'hr.request.create'],
  '/app/zonal': ['zonal.dashboard.view'],
  '/app/zonal/files': ['hr.request.create', 'hr.request.approve'],
  '/app/zonal/hr-records': ['hr.request.approve'],
  '/app/zonal/hub-ops': ['zonal.hub_ops.view', 'zonal.hub_ops.create'],
  '/app/zonal/requests': ['hr.request.approve'],
  '/app/zonal/routes': ['ops.route_setting.view', 'ops.route_setting.edit'],
  '/secure-control': ['system.admin_portal.view'],
  ...Object.fromEntries(Object.entries(HUB_SECTION_PERMS).map(([k, v]) => [`/app/hub/${k}`, v])),
}
/** Pages whose own sub-pages (…/:id) need the same permission as the page. */
const NESTED = ['/app/accounts/daily', '/app/zonal/hub-ops', '/app/users', '/app/roles', '/app/access']

/** Every address that has an entry in the table above (tests check each is a real route). */
export const PAGE_PERMISSION_PATHS: readonly string[] = Object.keys(pagePermissions)

/** The permissions a page needs (null = none). */
export function pageNeeds(to: string): readonly string[] | null {
  const path = bare(to).toLowerCase()
  const parent = NESTED.find(p => path.startsWith(p + '/'))
  return pagePermissions[parent ?? path] ?? null
}

/** Work-page requirements shared by navigation links and direct routes. */
export function hasPageAccess(to: string, can: (permission: string) => boolean): boolean {
  const path = bare(to).toLowerCase()
  if (ZONE_ONLY.includes(path) && panelLevel(can) !== 2) return false
  const required = pageNeeds(to)
  return !required || required.some(can)
}

/** What a person holds: their permissions, their role's page list, and whether that list could be loaded. */
export type Access = { can: (permission: string) => boolean; menu: string[] | null; menuUnavailable?: boolean }

/** THE rule for a link (sidebar row, phone tab, quick action, alert, shortcut): the role's page list names it, and the person holds what the page needs.
 *  `perms` is the link's own "any of" list; `also` is a second "any of" list that must hold as well (for a link that does something only a part of the page offers). */
export function linkAllowed(to: string, a: Access, perms?: readonly string[] | null, also?: readonly string[] | null): boolean {
  if (a.menuUnavailable) return false
  if (perms && !perms.some(a.can)) return false
  if (also && !also.some(a.can)) return false
  return inMenu(a.menu, to) && hasPageAccess(to, a.can)
}

/** A link that is not a menu row (a card or shortcut on a page that opens a page *under* a listed one, like the report upload under accounts):
 *  the same rule as a page opened by its address. */
export function pageLinkAllowed(to: string, a: Access): boolean {
  return !a.menuUnavailable && pageAllowed(a.menu, to) && hasPageAccess(to, a.can)
}

export type PageState = 'open' | 'menu-unavailable' | 'not-listed' | 'no-permission'
/** THE rule for a page opened by its address. `permission` is a route's own single requirement (ProtectedRoute's prop).
 *  Only the change-password page opens while the role's page list is unavailable. */
export function pageState(pathname: string, a: Access, permission?: string): PageState {
  if (a.menuUnavailable && bare(pathname) !== '/app/password') return 'menu-unavailable'
  if (!pageAllowed(a.menu, pathname)) return 'not-listed'
  if ((permission && !a.can(permission)) || !hasPageAccess(pathname, a.can)) return 'no-permission'
  return 'open'
}

/** A phone tab is "on" for the page itself and every page opened from it (a profile opened from the staff list, a sheet opened from the accounts list…).
 *  `match` is a pattern for the start of the path (up to a "/"); `ifQuery` limits it to addresses with that query part (a tab that is only one view of a page). */
export type TabLike = { match: string; ifQuery?: Record<string, string> }
export function tabActive(t: TabLike, pathname: string, search = ''): boolean {
  if (!new RegExp('^(?:' + t.match + ')(?:/|$)').test(bare(pathname))) return false
  if (!t.ifQuery) return true
  const q = new URLSearchParams(search)
  return Object.entries(t.ifQuery).every(([k, v]) => q.get(k) === v)
}
