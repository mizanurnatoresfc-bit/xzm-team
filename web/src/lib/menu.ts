// Which pages a person may open when their role has a list of pages ("শুধু এই কয়টা পাতা").
// `menu` null = no limit. This only hides and blocks pages; what data may be read or changed is decided by permissions.
import { supabase } from './supabase'

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
const withTwins = (menu: string[]) => [...new Set([...menu, ...menu.map(p => TWIN[p.split('?')[0]]).filter(Boolean)])]
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

export type RoleMenu = { role_id: string; code: string; name: string; name_bn: string | null; is_super: boolean; menu: string[] | null; user_count: number }
export const menuApi = {
  mine: async (): Promise<string[] | null> => { const { data, error } = await supabase.rpc('my_menu'); if (error) throw error; return (data as string[] | null) ?? null },
  roles: async (): Promise<RoleMenu[]> => { const { data, error } = await supabase.rpc('role_menu_list'); if (error) throw error; return (data ?? []) as RoleMenu[] },
  save: async (role: string, menu: string[] | null) => { const { error } = await supabase.rpc('role_menu_save', { p_role: role, p_menu: menu ? withTwins(menu) : null }); if (error) throw error },
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

const sheetPermissions = ['da.sheet.view', 'da.sheet.create']
const pagePermissions: Record<string, readonly string[]> = {
  '/app/accounts/khata': ['da.sheet.create'],
  '/app/accounts/center': sheetPermissions,
  '/app/accounts/daily': sheetPermissions,
  '/app/accounts/learn': sheetPermissions,
  '/app/accounts/report-import': ['da.import.create', 'da.sheet.view'],
  '/app/hr/applications': ['hr.application.view', 'hr.application.create'],
  '/app/hr/duties': ['hr.duty.view', 'hr.duty.edit'],
  '/app/hr/profile-gaps': ['hr.employee.view'],
  '/app/manpower': ['hr.employee.view', 'hr.request.create', 'hr.request.approve'],
  '/app/nodi/chat': ['nodi.assistant.view', 'nodi.settings.configure'],
  '/app/rollout': ['hr.employee.view'],
  '/app/staff/list': ['hr.employee.view', 'hr.application.create', 'hr.request.create'],
  '/app/zonal': ['zonal.dashboard.view'],
  '/app/zonal/files': ['hr.request.create', 'hr.request.approve'],
  '/app/zonal/hub-ops': ['zonal.hub_ops.view', 'zonal.hub_ops.create'],
}

/** Work-page requirements shared by navigation links and direct routes. */
export function hasPageAccess(to: string, can: (permission: string) => boolean): boolean {
  const path = bare(to).toLowerCase()
  if (ZONE_ONLY.includes(path) && panelLevel(can) !== 2) return false
  const parent = ['/app/accounts/daily', '/app/zonal/hub-ops'].find(p => path.startsWith(p + '/'))
  const required = pagePermissions[parent ?? path]
  return !required || required.some(can)
}
