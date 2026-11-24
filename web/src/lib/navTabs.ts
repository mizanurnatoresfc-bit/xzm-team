// The phone's bottom tabs and the quick-add sheet: what they are, where they lead, who sees them and when a tab is "on".
// Pure data (no imports besides types) so tests/navAccess.test.mjs can run it. Whether a person may see one is decided by
// `linkAllowed` in navAccess.ts — the same rule as the sidebar and the page routes.
import type { DashView } from './dashboard'
import { ATTENDANCE_HUB, ATTENDANCE_ZONE, DA_SHEET, type TabLike } from './navAccess.ts'

export type Tab = TabLike & { to: string; icon: string; bn: string; en: string; perms: readonly string[] | null }
export type Quick = { to: string; icon: string; bn: string; en: string; perms: readonly string[] | null; tone: string
  /** A second "any of" list that must hold too: the link leads to a part of the page that needs it. */ also?: readonly string[] }

/** The Hub tab opens the attendance page; its hub part needs ATTENDANCE_HUB, a zonal manager lands on the zone part. */
const HUB_TAB: Tab = { to: '/app/attendance?view=hub', icon: 'hub', bn: 'হাব', en: 'Hub', perms: [...ATTENDANCE_HUB, ...ATTENDANCE_ZONE], match: '/app/(?:hub|attendance)' }
/** The team: the staff list and the pages opened from it (a person's profile, the ID applications, the profile gaps). */
const TEAM_MATCH = '/app/(?:staff|hr/(?:employees|applications|profile-gaps))'
const HOME_TAB: Tab = { to: '/app', icon: 'grid', bn: 'হোম', en: 'Home', perms: null, match: '/app$' }
/** A staff member's home already is the staff panel, so their tab bar has the profile in its place, and the panel's own address is "home". */
const STAFF_HOME_TAB: Tab = { ...HOME_TAB, match: '/app$|/app/staff$' }
const PROFILE_TAB: Tab = { to: '/app/me', icon: 'user', bn: 'প্রোফাইল', en: 'Profile', perms: null, match: '/app/me' }
/** The panel is only its own address: the staff list under /app/staff/ is not the panel. */
const PANEL_TAB: Tab = { to: '/app/staff', icon: 'user', bn: 'প্যানেল', en: 'Panel', perms: null, match: '/app/staff$' }
const ACCOUNTS_MINE_TAB: Tab = { to: '/app/accounts/mine', icon: 'wallet', bn: 'হিসাব', en: 'Accounts', perms: null, match: '/app/accounts' }
const REQUESTS_TAB: Tab = { to: '/app/hr/requests', icon: 'form', bn: 'রিকুয়েস্ট', en: 'Requests', perms: null, match: '/app/(?:hr/(?:requests|leave)|manpower)' }
const ACCOUNTS_TAB: Tab = { to: '/app/accounts/daily', icon: 'ledger', bn: 'হিসাব', en: 'Accounts', perms: DA_SHEET, match: '/app/accounts' }

// Mobile: bottom tabs (first four the role may open) and the quick-add sheet.
/** The full zone app (also what a person gets before a home view is chosen). */
export const TABS: Tab[] = [
  HOME_TAB,
  HUB_TAB,
  { to: '/app/sorting/parcels', icon: 'truck', bn: 'ট্রিপ', en: 'Trips', perms: ['sorting.parcel.view', 'sorting.parcel.create', 'sorting.center.view'], match: '/app/sorting' },
  ACCOUNTS_TAB,
  { to: '/app/staff/list', icon: 'users', bn: 'কর্মী', en: 'Staff', perms: ['hr.employee.view'], match: TEAM_MATCH },
]
// The tab bar follows the home view: a staff member's own app, a hub manager's hub app, or the full zone app.
export const VIEW_TABS: Record<DashView, Tab[]> = {
  self: [HOME_TAB, PANEL_TAB, ACCOUNTS_MINE_TAB, REQUESTS_TAB],
  hub: [HOME_TAB, HUB_TAB,
    { to: '/app/staff/list', icon: 'users', bn: 'টিম', en: 'Team', perms: ['hr.employee.view'], match: TEAM_MATCH },
    ACCOUNTS_TAB, REQUESTS_TAB],
  zone: TABS,
}
/** The tabs a person's bottom bar may show, before the permission filter: a staff member (level 0) gets the profile where the panel would be. */
export const tabsFor = (view: DashView | null, level: 0 | 1 | 2): Tab[] =>
  (view ? VIEW_TABS[view] : TABS).map(t => level === 0 ? (t === PANEL_TAB ? PROFILE_TAB : t === HOME_TAB ? STAFF_HOME_TAB : t) : t)

export const QUICK: Quick[] = [
  { to: '/app/manpower?new=1', icon: 'users', bn: 'লোক চাই', en: 'Need people', perms: ['hr.request.create'], tone: 'g' },
  { to: '/app/issues?new=1', icon: 'scan', bn: 'লেবেল দিয়ে ইস্যু', en: 'Issue from label', perms: null, tone: 'r' },
  { to: '/app/issues?order=store', icon: 'box', bn: 'স্টোর / আইটি অর্ডার', en: 'Store / IT order', perms: null, tone: 'b' },
  // the hub part of the attendance page opens only with a hub attendance grant; create alone would land on the person's own page
  { to: '/app/attendance?view=hub', icon: 'cal', bn: 'হাজিরা দিন', en: 'Attendance', perms: ['hr.attendance.create'], also: ATTENDANCE_HUB, tone: 'g' },
  { to: '/app/accounts/reports', icon: 'chart', bn: 'হিসাবের রিপোর্ট', en: 'Accounts reports', perms: ['da.report.view'], tone: 'b' },
  { to: '/app/hub/pickup', icon: 'box', bn: 'পিকআপ যোগ', en: 'Pickup', perms: ['ops.pickup_as_hub_manager.create', 'ops.pickup_as_pickup_manager.create', 'ops.pickup_as_rider.create'], tone: 'b' },
  { to: '/app/hub/tasks', icon: 'tasks', bn: 'নতুন কাজ', en: 'New task', perms: ['zonal.task.create'], tone: 'p' },
  { to: '/app/accounts/khata', icon: 'ledger', bn: 'আজকের খাতা', en: 'My sheet today', perms: ['da.sheet.create'], tone: 'g' },
  { to: '/app/fleet?tab=approve', icon: 'truck', bn: 'গাড়ির অনুমোদন', en: 'Vehicle approvals', perms: ['vehicle.log.approve'], tone: 'o' },
  { to: '/app/accounts/mine?bill=1', icon: 'receipt', bn: 'আমার বিল', en: 'My bill', perms: null, tone: 'o' },
  { to: '/app/sorting/parcels', icon: 'truck', bn: 'পার্সেল এন্ট্রি', en: 'Parcels', perms: ['sorting.parcel.create'], tone: 'b' },
  { to: '/app/sorting/fuel', icon: 'cash', bn: 'তেলের রিকুয়েস্ট', en: 'Fuel request', perms: ['sorting.fuel.create'], tone: 'r' },
  { to: '/app/staff/list', icon: 'user', bn: 'নতুন কর্মী', en: 'New staff', perms: ['hr.application.create'], tone: 'p' },
  { to: '/app/office/assets', icon: 'grid', bn: 'অফিস রিসোর্স', en: 'Office item', perms: ['office.asset.edit'], tone: 'b' },
]
