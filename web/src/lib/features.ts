// Auto feature system + AERV permissions (owner, 17 Nov 2026).
//
// Every page in the menu (AppShell: ACCOUNTS and the three panels) is a feature. Nothing here is a second list to
// keep up to date: a page added to the menu shows up on its own in the dropdown menu, the home page's group cards,
// the role pages picker and the AERV grid below, with its Add / Edit / Remove / View permission codes worked out from
// the permissions the page already names. Permission resources that no page names (for example salary, NID) are
// added at the end as "other permissions", read from the database, so a new permission also shows up without code.
import { ACCOUNTS, GROUPS } from '../components/AppShell'
import { MODULE_LABEL, RESOURCE_LABEL } from './roles'
import type { PanelGroup } from './menu'

export type FeatureGroup = 'accounts' | PanelGroup
export type Feature = { to: string; icon: string; bn: string; en: string; group: FeatureGroup; sec_bn: string; sec_en: string; perms: string[] | null }

/** The four letters of AERV and the permission actions each one stands for. */
export type Aerv = 'A' | 'E' | 'R' | 'V'
export const AERV: Array<[Aerv, bn: string, en: string, actions: string[]]> = [
  ['A', 'যোগ', 'Add', ['create', 'post']],
  ['E', 'সম্পাদনা', 'Edit', ['edit', 'approve', 'reject', 'verify', 'configure', 'manage']],
  ['R', 'মুছা', 'Remove', ['archive', 'delete']],
  ['V', 'দেখা', 'View', ['view', 'export', 'print']],
]
export const GROUP_INFO: Record<FeatureGroup, [bn: string, en: string, icon: string, note_bn: string, note_en: string]> = {
  zone: ['সুপার অ্যাডমিন / জোনাল ম্যানেজার', 'Super Admin / Zonal manager', 'map', 'পুরো জোন: হাব, কর্মী, শটিং, অফিস, সেটিং', 'The whole zone: hubs, staff, sorting, office, settings'],
  hub: ['ম্যানেজার', 'Manager', 'hub', 'নিজের হাব: হাজিরা, পিকআপ, টিম, গাড়ি', 'Own hub: attendance, pickups, team, vehicles'],
  self: ['স্টাফ / রাইডার', 'Staff / Rider', 'user', 'নিজের কাজ: প্যানেল, হিসাব, রিকুয়েস্ট, ছুটি', 'Own work: panel, accounts, requests, leave'],
  accounts: ['হিসাব', 'Accounts', 'ledger', 'দৈনিক হিসাব খাতা, ভাউচার, রিপোর্ট', 'Daily sheets, vouchers, reports'],
}
const GROUP_OF: Record<string, PanelGroup> = { self: 'self', hub: 'hub', zone: 'zone' }

/** Every menu page once, in menu order (accounts first, then staff → manager → zonal). */
export function features(): Feature[] {
  const seen = new Set<string>()
  const out: Feature[] = []
  for (const g of [ACCOUNTS, ...GROUPS]) {
    const group: FeatureGroup = g.key === 'accounts' ? 'accounts' : GROUP_OF[g.key] ?? 'zone'
    for (const s of g.secs) for (const i of s.items) {
      if (seen.has(i.to)) continue
      seen.add(i.to)
      out.push({ to: i.to, icon: i.icon, bn: i.bn, en: i.en, group, sec_bn: s.bn || g.bn, sec_en: s.en || g.en, perms: i.perms })
    }
  }
  return out
}

/** "module.resource" of each permission a page names. */
export const resourcesOf = (perms: string[] | null) => [...new Set((perms ?? []).map(p => p.split('.').slice(0, 2).join('.')))]

/** For a set of resources: which existing permission codes each AERV letter means. */
export function aervCodes(resources: string[], all: Set<string>): Record<Aerv, string[]> {
  const out = { A: [], E: [], R: [], V: [] } as Record<Aerv, string[]>
  for (const [k, , , acts] of AERV) for (const r of resources) for (const a of acts) { const c = `${r}.${a}`; if (all.has(c)) out[k].push(c) }
  return out
}

/** One line of the AERV grid: pages that share the same permissions are one line (ticking one would tick the others anyway). */
export type AervRow = { key: string; bn: string; en: string; icon: string; group: FeatureGroup | 'other'; pages: Feature[]; resources: string[]; codes: Record<Aerv, string[]> }

export function aervRows(allCodes: string[]): { rows: AervRow[]; open: Feature[] } {
  const all = new Set(allCodes)
  const rows: AervRow[] = []
  const byKey = new Map<string, AervRow>()
  const open: Feature[] = []
  const used = new Set<string>()
  for (const f of features()) {
    const res = resourcesOf(f.perms).filter(r => allCodes.some(c => c.startsWith(r + '.')))
    if (!res.length) { open.push(f); continue }
    const key = [...res].sort().join('|')
    const hit = byKey.get(key)
    if (hit) { hit.pages.push(f); continue }
    const row: AervRow = { key, bn: f.bn, en: f.en, icon: f.icon, group: f.group, pages: [f], resources: res, codes: aervCodes(res, all) }
    byKey.set(key, row); rows.push(row)
    res.forEach(r => used.add(r))
  }
  // Every permission resource no page names: one line each, grouped by module, straight from the database.
  const rest = [...new Set(allCodes.map(c => c.split('.').slice(0, 2).join('.')))].filter(r => !used.has(r)).sort()
  for (const r of rest) {
    const mod = MODULE_LABEL[r.split('.')[0]]
    const label = RESOURCE_LABEL[r]
    rows.push({ key: r, bn: label ? `${label}${mod ? ` · ${mod[0]}` : ''}` : r, en: mod ? `${mod[1]} · ${r}` : r, icon: 'key', group: 'other', pages: [], resources: [r], codes: aervCodes([r], all) })
  }
  return { rows, open }
}

export { groupAdmin, type RoleGroupRow } from './menu'

/**
 * "Auto" for a group: the View permission of every page the group's menu holds (its own panel and the ones below it,
 * plus accounts for managers and up). Only staged in the grid; nothing is saved until the Super Admin presses Save.
 */
export function groupDefaults(group: PanelGroup, rows: AervRow[]): string[] {
  const take: Array<FeatureGroup | 'other'> = group === 'zone' ? ['self', 'hub', 'zone', 'accounts'] : group === 'hub' ? ['self', 'hub', 'accounts'] : ['self']
  return [...new Set(rows.filter(r => take.includes(r.group)).flatMap(r => r.codes.V))]
}

const BN: Array<[RegExp, string]> = [
  [/Only a Super Admin/i, 'শুধু সুপার অ্যাডমিন এটা করতে পারেন'],
  [/cannot be edited|cannot be changed/i, 'সুপার অ্যাডমিন রোলের অনুমতি বদলানো যায় না'],
  [/Unknown permission/i, 'এই নামের কোনো অনুমতি নেই'],
  [/Unknown group/i, 'এই নামের কোনো গ্রুপ নেই'],
  [/Role not found/i, 'রোলটি পাওয়া যায়নি'],
  [/function .* does not exist|Could not find the function|PGRST202/i, 'ডাটাবেসে নতুন অংশটা এখনো বসানো হয়নি (migration 20261117010000)'],
  [/not authori[sz]ed|permission denied|42501/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export function groupFriendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? `${hit[1]}। (${msg})` : msg
}
