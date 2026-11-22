// Advanced role & permission management: the map from what people see — modules and their sub-menus (pages) —
// to what the database checks (permission codes). Six columns: view / create / edit / delete / approve / export.
//
// A sub-menu lists the things it works with: whole resources (`res`, e.g. 'hr.leave' = every hr.leave.* permission)
// or single permissions (`codes`, when the page only uses part of something another page owns). Because several
// pages can work with the same thing, one permission may sit in more than one row; those boxes change together.
// Anything no sub-menu claims is added under its module by itself, so every permission can always be set here —
// also the ones a later database update adds.
import { RESOURCE_LABEL, type Permission } from './roles'
import { ALWAYS_OPEN } from './menu'

export type ActionKey = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export'
export const ACTION_KEYS: ActionKey[] = ['view', 'create', 'edit', 'delete', 'approve', 'export']
/** The six kinds of access, and which database actions each one holds. */
export const ACTION6: Record<ActionKey, { bn: string; en: string; db: string[]; icon: string; note_bn: string; note_en: string }> = {
  view: { bn: 'দেখা', en: 'View', db: ['view'], icon: 'eye', note_bn: 'তথ্য দেখতে পারবে', note_en: 'May see the data' },
  create: { bn: 'তৈরি', en: 'Create', db: ['create'], icon: 'plus', note_bn: 'নতুন যোগ বা জমা দিতে পারবে', note_en: 'May add or submit new entries' },
  edit: { bn: 'এডিট', en: 'Edit', db: ['edit', 'configure'], icon: 'edit', note_bn: 'বদলাতে ও সেটিং ঠিক করতে পারবে', note_en: 'May change entries and settings' },
  delete: { bn: 'ডিলিট', en: 'Delete', db: ['archive', 'delete'], icon: 'trash', note_bn: 'সরাতে / আর্কাইভ করতে পারবে', note_en: 'May remove or archive' },
  approve: { bn: 'অনুমোদন', en: 'Approve', db: ['approve', 'reject'], icon: 'checkall', note_bn: 'অনুমোদন বা বাতিল করতে পারবে', note_en: 'May approve or reject' },
  export: { bn: 'এক্সপোর্ট', en: 'Export', db: ['export', 'print', 'share'], icon: 'xls', note_bn: 'এক্সেল / পিডিএফ / প্রিন্ট নিতে পারবে', note_en: 'May export, print or share' },
}
export const actionKeyOf = (dbAction: string): ActionKey =>
  ACTION_KEYS.find(k => ACTION6[k].db.includes(dbAction)) ?? 'edit'

type SubDef = { to?: string; key?: string; bn?: string; en?: string; res?: string[]; codes?: string[] }
type ModuleDef = { key: string; icon: string; bn: string; en: string; db: string[]; subs: SubDef[] }

/** Modules in the order the menu shows the work, each with its sub-menus. `db` = the database modules that fall here by default. */
export const MODULES: ModuleDef[] = [
  { key: 'accounts', icon: 'ledger', bn: 'হিসাব', en: 'Accounts', db: ['da'], subs: [
    { to: '/app/accounts/khata', codes: ['da.sheet.create'] },
    { to: '/app/accounts/daily', res: ['da.sheet', 'da.correction', 'da.import'] },
    { to: '/app/accounts/center', codes: ['da.sheet.view', 'da.sheet.create'] },
    { to: '/app/accounts/reports', res: ['da.report'] },
    { to: '/app/accounts/settings', res: ['da.settings'] },
    { to: '/app/accounts/learn' },
  ] },
  { key: 'hr', icon: 'users', bn: 'স্টাফ ও এইচআর', en: 'Staff & HR', db: ['hr'], subs: [
    { to: '/app/hr/employees', res: ['hr.employee', 'hr.employee_sensitive', 'hr.employee_profile', 'hr.document', 'hr.transfer', 'hr.status'] },
    { to: '/app/zonal/staff', codes: ['hr.employee.view', 'hr.employee.edit', 'hr.employee.archive', 'hr.transfer.edit', 'hr.status.edit', 'hr.application.create', 'hr.application.approve'] },
    { to: '/app/hr/applications', res: ['hr.application'] },
    { to: '/app/hr/attendance', res: ['hr.attendance'] },
    { to: '/app/zonal/assistant', res: ['hr.attendance_gap'] },
    { to: '/app/hr/leave', res: ['hr.leave'] },
    { to: '/app/hr/requests', res: ['hr.request'] },
    { to: '/app/zonal/files', codes: ['hr.request.create', 'hr.request.approve'] },
    { to: '/app/zonal/requests', codes: ['hr.request.approve'] },
    { to: '/app/zonal/hr-records', codes: ['hr.request.approve'] },
    { to: '/app/manpower', codes: ['hr.employee.view', 'hr.request.create', 'hr.request.approve'] },
    { to: '/app/hr/duties', res: ['hr.duty'] },
    { to: '/app/hr/referrals', res: ['hr.referral'] },
    { to: '/app/references', res: ['hr.reference'] },
    { to: '/app/hr/profile-gaps', codes: ['hr.employee.view', 'hr.employee_profile.edit'] },
    { to: '/app/hr/fields', res: ['hr.profile_field'], codes: ['hr.referral.configure'] },
    { to: '/app/hr/import', res: ['hr.import'] },
    { key: 'hr.pay', bn: 'বেতন, ভাতা ও বেতন শিট', en: 'Salary, allowances & salary sheets', res: ['hr.compensation', 'hr.salary_sheet'] },
  ] },
  { key: 'hub', icon: 'hub', bn: 'হাব (ম্যানেজার প্যানেল)', en: 'Hub (manager panel)', db: [], subs: [
    { to: '/app/hub/attendance', codes: ['hr.attendance.view', 'hr.attendance.create', 'hr.attendance.edit'] },
    { to: '/app/hub/late', codes: ['hr.attendance.view', 'hr.attendance.create'] },
    { to: '/app/hub/days', codes: ['hr.attendance.view', 'hr.attendance.create'] },
    { to: '/app/hub/pickup', res: ['ops.pickup', 'ops.pickup_as_hub_manager', 'ops.pickup_as_pickup_manager', 'ops.pickup_as_rider', 'ops.pickup_verification'], codes: ['ops.merchant.create'] },
    { to: '/app/hub/tasks', res: ['zonal.task'] },
    { to: '/app/hub/ops', res: ['zonal.hub_metric'] },
    { to: '/app/hub/team', codes: ['hr.employee.view', 'hr.employee.edit', 'hr.employee.archive', 'hr.employee_profile.edit', 'hr.application.create'] },
    { to: '/app/manager/staff', codes: ['hr.request.create', 'hr.application.create', 'hr.employee.view'] },
    { to: '/app/hub/logins', res: ['system.user_hub'] },
    { to: '/app/hub/routes', res: ['ops.route'] },
  ] },
  { key: 'ops', icon: 'box', bn: 'কুরিয়ার অপারেশন', en: 'Courier operations', db: ['ops'], subs: [] },
  { key: 'zonal', icon: 'map', bn: 'জোনাল ম্যানেজমেন্ট', en: 'Zonal management', db: ['zonal'], subs: [
    { to: '/app/zonal', res: ['zonal.dashboard', 'zonal.claim', 'zonal.planning', 'zonal.visit', 'zonal.pulse', 'zonal.report'] },
    { to: '/app/zonal/routes', res: ['ops.route_setting', 'ops.route_visit'] },
  ] },
  { key: 'org', icon: 'org', bn: 'এরিয়া, হাব ও পদ', en: 'Areas, hubs & posts', db: ['org'], subs: [
    { to: '/app/org/hubs', res: ['org.hub', 'org.region'] },
    { to: '/app/org', res: ['org.organization', 'org.zone', 'org.department', 'org.position'] },
  ] },
  { key: 'sorting', icon: 'truck', bn: 'শটিং সেন্টার', en: 'Sorting centre', db: ['sorting'], subs: [
    { to: '/app/sorting/dashboard', codes: ['sorting.center.view', 'sorting.report.view'] },
    { to: '/app/sorting/routes', res: ['sorting.center'] },
    { to: '/app/sorting/staff', res: ['sorting.staff'] },
    { to: '/app/sorting/fuel', res: ['sorting.fuel', 'sorting.hub_charge'] },
    { to: '/app/sorting/parcels', res: ['sorting.parcel'] },
    { to: '/app/sorting/drivers', res: ['sorting.driver'] },
    { to: '/app/sorting/reports', res: ['sorting.report'] },
    { to: '/app/sorting/centers', codes: ['sorting.center.view', 'sorting.center.create', 'sorting.center.edit', 'sorting.center.archive'] },
  ] },
  { key: 'office', icon: 'home', bn: 'আমার অফিস', en: 'My office', db: ['office'], subs: [
    { to: '/app/office/overview', codes: ['office.property.view'] },
    { to: '/app/office/zone', codes: ['office.asset.view', 'office.notice.approve'] },
    { to: '/app/office/places', res: ['office.property'] },
    { to: '/app/office/rooms', codes: ['office.property.view', 'office.property.edit'] },
    { to: '/app/office/desks', codes: ['office.property.view', 'office.property.edit'] },
    { to: '/app/office/people', codes: ['office.property.view', 'office.property.edit'] },
    { to: '/app/office/assets', res: ['office.asset'] },
    { to: '/app/office/power', codes: ['office.asset.view'] },
    { to: '/app/office/rent', res: ['office.bill'] },
    { to: '/app/office/bills', codes: ['office.bill.view', 'office.bill.edit'] },
    { to: '/app/office/security', res: ['office.secret'] },
    { to: '/app/office/notices', res: ['office.notice'] },
    // আবাসিক — the residence side of the same pages
    { to: '/app/office/residential/overview', codes: ['office.property.view'] },
    { to: '/app/office/residential/places', res: ['office.property'] },
    { to: '/app/office/residential/rooms', codes: ['office.property.view', 'office.property.edit'] },
    { to: '/app/office/residential/people', codes: ['office.property.view', 'office.property.edit'] },
    { to: '/app/office/residential/rent', res: ['office.bill'] },
    { to: '/app/office/residential/bills', codes: ['office.bill.view', 'office.bill.edit'] },
    { to: '/app/office/residential/assets', res: ['office.asset'] },
    { to: '/app/office/reports', codes: ['office.bill.view'], res: ['office.report'] },
    { to: '/app/office/residential/reports', codes: ['office.bill.view'], res: ['office.report'] },
  ] },
  { key: 'fleet', icon: 'truck', bn: 'গাড়ি', en: 'Vehicles', db: ['vehicle'], subs: [
    { to: '/app/fleet', res: ['vehicle.vehicle', 'vehicle.holder', 'vehicle.log', 'vehicle.khoraki', 'vehicle.report', 'vehicle.requisition', 'vehicle.document', 'vehicle.settings'] },
  ] },
  { key: 'issues', icon: 'tasks', bn: 'ইস্যু ও হাব গ্রুপ', en: 'Issues & hub group', db: ['issue'], subs: [
    { to: '/app/issues', res: ['issue.issue', 'issue.group'] },
  ] },
  { key: 'nodi', icon: 'sms', bn: 'নদী AI', en: 'Nodi AI', db: ['nodi'], subs: [
    { to: '/app/nodi/chat', res: ['nodi.assistant'] },
    { to: '/app/nodi', res: ['nodi.settings'] },
  ] },
  { key: 'system', icon: 'shield', bn: 'সিস্টেম, ইউজার ও অনুমতি', en: 'System, users & permissions', db: ['system'], subs: [
    { to: '/app/users', res: ['system.user', 'system.user_role'] },
    { to: '/app/access', res: ['system.role'] },
    { to: '/app/role-dashboards', codes: ['system.role.edit'] },
    { to: '/app/rollout', codes: ['hr.employee.view', 'system.user.create'] },
    { to: '/app/branding', res: ['system.settings'] },
    { to: '/app/training' },
  ] },
]

export type MenuEntry = { to: string; bn: string; en: string; perms: string[] | null }
export type Sub = {
  key: string
  /** The page in the menu, or null when this row is a thing with no page of its own. */
  to: string | null
  bn: string; en: string
  /** Holding any one of these puts the page in the menu (null = everyone). */
  needs: string[] | null
  /** Parts of the same page that the menu lists separately. */
  tabs: Array<{ bn: string; en: string }>
  cells: Record<ActionKey, string[]>
  codes: string[]
  /** Always open for everybody (own profile, own accounts …): the page cannot be switched off. */
  always: boolean
  /** Added by itself because no sub-menu claimed it. */
  auto: boolean
}
export type Mod = { key: string; icon: string; bn: string; en: string; subs: Sub[]; codes: string[]; pages: string[] }
export type Catalog = {
  mods: Mod[]
  /** permission code -> the rows it sits in */
  usedBy: Record<string, string[]>
  byCode: Record<string, Permission>
  subByKey: Record<string, Sub>
  /** every page that can be switched on or off for a role */
  pages: string[]
}

const bare = (p: string) => p.split('?')[0].replace(/\/+$/, '') || '/app'
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const emptyCells = (): Record<ActionKey, string[]> => ({ view: [], create: [], edit: [], delete: [], approve: [], export: [] })

/** Puts the permissions the database has into the modules and sub-menus above. */
export function buildCatalog(perms: Permission[], menu: MenuEntry[]): Catalog {
  const byCode: Record<string, Permission> = Object.fromEntries(perms.map(p => [p.code, p]))
  const byRes = new Map<string, Permission[]>()
  for (const p of perms) { const k = `${p.module}.${p.resource}`; byRes.set(k, [...(byRes.get(k) ?? []), p]) }
  const claimed = new Set<string>()
  const usedBy: Record<string, string[]> = {}
  const subByKey: Record<string, Sub> = {}
  const fill = (sub: Sub, list: Permission[]) => {
    for (const p of list) {
      if (sub.codes.includes(p.code)) continue
      sub.codes.push(p.code); sub.cells[actionKeyOf(p.action)].push(p.code)
      ;(usedBy[p.code] ??= []).push(sub.key)
    }
  }
  const mods: Mod[] = MODULES.map(m => {
    const subs: Sub[] = []
    for (const d of m.subs) {
      const entry = d.to ? menu.find(x => x.to === d.to) : undefined
      if (d.to && !entry && !d.bn) continue   // a page that is no longer in the menu
      const sub: Sub = { key: d.key ?? d.to!, to: entry ? d.to! : null, bn: entry?.bn ?? d.bn ?? '', en: entry?.en ?? d.en ?? '',
        needs: entry ? entry.perms : null, cells: emptyCells(), codes: [], auto: false, always: !!d.to && ALWAYS_OPEN.includes(d.to),
        tabs: d.to ? menu.filter(x => x.to.includes('?') && bare(x.to) === d.to).map(x => ({ bn: x.bn, en: x.en })) : [] }
      for (const r of d.res ?? []) { claimed.add(r); fill(sub, byRes.get(r) ?? []) }
      fill(sub, (d.codes ?? []).map(c => byCode[c]).filter(Boolean))
      subs.push(sub); subByKey[sub.key] = sub
    }
    return { key: m.key, icon: m.icon, bn: m.bn, en: m.en, subs, codes: [], pages: [] }
  })
  // whatever nobody claimed: one row per thing, under the module its database module belongs to
  const other: Mod = { key: 'other', icon: 'grid', bn: 'অন্যান্য', en: 'Other', subs: [], codes: [], pages: [] }
  for (const [res, list] of [...byRes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (claimed.has(res)) continue
    const dbModule = list[0].module
    const mod = mods[MODULES.findIndex(m => m.db.includes(dbModule))] ?? other
    const sub: Sub = { key: `res:${res}`, to: null, bn: RESOURCE_LABEL[res] ?? pretty(list[0].resource), en: pretty(list[0].resource),
      needs: null, tabs: [], cells: emptyCells(), codes: [], auto: true, always: false }
    fill(sub, list); mod.subs.push(sub); subByKey[sub.key] = sub
  }
  if (other.subs.length) mods.push(other)
  for (const m of mods) {
    m.codes = [...new Set(m.subs.flatMap(s => s.codes))]
    m.pages = m.subs.filter(s => s.to && !s.always).map(s => s.to!)
  }
  const shown = mods.filter(m => m.subs.length)
  return { mods: shown, usedBy, byCode, subByKey, pages: shown.flatMap(m => m.pages) }
}

/** all / some / none of a box's permissions are held */
export type CellState = 'all' | 'some' | 'none' | 'na'
export const cellState = (codes: string[], has: (c: string) => boolean): CellState => {
  if (!codes.length) return 'na'
  const n = codes.filter(has).length
  return n === 0 ? 'none' : n === codes.length ? 'all' : 'some'
}

/** Will the page show in the menu for someone holding `has`, with this page list (null = no limit)? */
export function pageShows(sub: Sub, has: (c: string) => boolean, pages: Set<string> | null): boolean {
  if (!sub.to) return false
  const allowed = !sub.needs || sub.needs.some(has)
  return allowed && (sub.always || !pages || pages.has(sub.to))
}

/** A role's stored page list (may hold "?tab=" entries from the older editor) as a set of pages. */
export const pagesOf = (menu: string[] | null | undefined): Set<string> | null => (menu ? new Set(menu.map(bare)) : null)

/** Ready-made starting points for a module or a whole role. */
export type Preset = 'all' | 'view' | 'work' | 'none'
export const PRESETS: Array<[Preset, bn: string, en: string, note_bn: string, note_en: string]> = [
  ['all', 'সব দিন', 'Everything', 'ছয়টি কাজই', 'All six kinds of access'],
  ['view', 'শুধু দেখা', 'View only', 'দেখা আর এক্সপোর্ট', 'View and export'],
  ['work', 'কাজ করবে (ডিলিট ছাড়া)', 'Work (no delete)', 'দেখা, তৈরি, এডিট, এক্সপোর্ট — ডিলিট ও অনুমোদন ছাড়া', 'View, create, edit, export — no delete, no approve'],
  ['none', 'কিছুই না', 'Nothing', 'সব তুলে দিন', 'Clear everything'],
]
const PRESET_KEYS: Record<Preset, ActionKey[]> = { all: ACTION_KEYS, view: ['view', 'export'], work: ['view', 'create', 'edit', 'export'], none: [] }
/** The permission codes of `subs` that a preset switches on. */
export function presetCodes(subs: Sub[], preset: Preset): string[] {
  const keys = PRESET_KEYS[preset]
  return [...new Set(subs.flatMap(s => keys.flatMap(k => s.cells[k])))]
}
