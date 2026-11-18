// Advanced role & permission management — reads and writes for the access pages.
// Roles, their permissions, the pages a role sees and the hub / zone a role is held at all use what the
// database already had (lib/roles, lib/menu, lib/users). New here: a person's own permissions on top of or
// taken away from their roles (migration 20261117004500_advanced_permissions), what a person can do in the
// end, and the permission change history (read from the audit log).
import { supabase } from './supabase'
import { HrError } from './hr'
import type { RoleRow } from './roles'
import type { RoleGrant } from './users'

export type Place = 'global' | 'zone' | 'hub'
/** 'role' = wherever the person's roles work. */
export type OverridePlace = 'role' | Place
export type Override = { id: string; user_id: string; user_name: string; permission: string; effect: 'grant' | 'deny'
  scope_type: OverridePlace; zone_id: string | null; hub_id: string | null; zone: string | null; hub: string | null
  valid_from: string; valid_to: string | null; reason: string; created_at: string; created_by_name: string | null
  revoked_at: string | null; revoke_reason: string | null; live: boolean }
export type OverrideItem = { permission: string; effect: 'grant' | 'deny'; scope_type?: OverridePlace
  zone_id?: string | null; hub_id?: string | null; valid_to?: string | null }
export type UserGrant = { permission_code: string | null; scope_type: Place; zone_id: string | null; hub_id: string | null; is_super: boolean }
export type AuditRow = { id: number; occurred_at: string; actor_id: string | null; action: string; table_name: string; record_id: string | null
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; changed_fields: string[] | null; reason: string | null }

/** The database function or table is not there yet (the migration has not been applied). */
const notInstalled = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42883' || e.code === '42P01' || /could not find the (function|table)|schema cache/i.test(e.message ?? ''))

/** How many audit rows one page of the history reads. */
export const HISTORY_PAGE = 600
/** Tables whose audit rows make up the permission change history. */
export const HISTORY_TABLES = ['roles', 'role_permissions', 'user_roles', 'role_dashboards', 'user_permission_overrides']

export const access = {
  /** Personal permissions of one person, or of everyone (`user` empty). `null` = the database part is not installed yet. */
  overrides: async (user?: string | null, all = false): Promise<Override[] | null> => {
    const { data, error } = await supabase.rpc('access_overrides', { p_user: user || null, p_all: all })
    if (notInstalled(error)) return null
    if (error) throw new HrError(error.message, error.code)
    return Array.isArray(data) ? data as Override[] : null
  },
  /** Sets the whole list of one person's personal permissions (what is not in the list is taken back). */
  saveOverrides: async (user: string, items: OverrideItem[], reason: string): Promise<{ added: number; kept: number; removed: number }> => {
    const { data, error } = await supabase.rpc('access_overrides_save', { p_user: user, p_items: items, p_reason: reason })
    if (error) throw new HrError(error.message, error.code)
    return (data ?? { added: 0, kept: 0, removed: 0 }) as { added: number; kept: number; removed: number }
  },
  /** What a person can do right now, worked out by the database itself. `null` = not installed yet. */
  userGrants: async (user: string): Promise<UserGrant[] | null> => {
    const { data, error } = await supabase.rpc('access_user_grants', { p_user: user })
    if (notInstalled(error)) return null
    if (error) throw new HrError(error.message, error.code)
    return Array.isArray(data) ? data as UserGrant[] : null
  },
  /** Newest first. `beforeId` = the page older than that row. `system` also returns what migrations did (nobody signed in). */
  history: async (o: { beforeId?: number | null; from?: string | null; to?: string | null; system?: boolean; limit?: number } = {}): Promise<AuditRow[]> => {
    let q = supabase.from('audit_logs').select('id, occurred_at, actor_id, action, table_name, record_id, old_data, new_data, changed_fields, reason')
      .in('table_name', HISTORY_TABLES).order('id', { ascending: false }).limit(o.limit ?? HISTORY_PAGE)
    if (!o.system) q = q.not('actor_id', 'is', null)
    if (o.beforeId) q = q.lt('id', o.beforeId)
    if (o.from) q = q.gte('occurred_at', `${o.from}T00:00:00+06:00`)
    if (o.to) q = q.lte('occurred_at', `${o.to}T23:59:59+06:00`)
    const { data, error } = await q
    if (error) throw new HrError(error.message, error.code)
    return (data ?? []) as AuditRow[]
  },
  /** id -> name of everyone who has a login (for "who changed it"). Empty when the caller may not list accounts. */
  people: async (): Promise<Record<string, string>> => {
    const { data, error } = await supabase.from('profiles').select('id, full_name, email').limit(5000)
    if (error) return {}
    return Object.fromEntries(((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(p => [p.id, p.full_name || p.email || '']))
  },
}

// ---------------------------------------------------------------- what a person can do, worked out here
// Used when the database function is not installed yet, and to say where each permission comes from.

export type Source = { kind: 'role'; role: string } | { kind: 'personal' }
export type Effective = { code: string; places: Array<{ scope_type: Place; zone_id: string | null; hub_id: string | null; zone?: string | null; hub?: string | null }>; sources: Source[]; denied: boolean }

const placeKey = (p: { scope_type: string; zone_id: string | null; hub_id: string | null }) => `${p.scope_type}|${p.zone_id ?? ''}|${p.hub_id ?? ''}`

/** Roles + personal permissions -> one line per permission: where it works and where it comes from. Mirrors private.grants_of. */
export type OverrideLike = Pick<Override, 'permission' | 'effect' | 'scope_type' | 'zone_id' | 'hub_id' | 'zone' | 'hub' | 'live'>
export function effectiveOf(grants: RoleGrant[], roleById: Record<string, RoleRow>, overrides: OverrideLike[], allCodes: string[]): { list: Effective[]; isSuper: boolean } {
  const live = overrides.filter(o => o.live)
  const isSuper = grants.some(g => g.is_super && g.scope_type === 'global')
  const denied = new Set(isSuper ? [] : live.filter(o => o.effect === 'deny').map(o => o.permission))
  const map = new Map<string, Effective>()
  const add = (code: string, place: Effective['places'][number], src: Source) => {
    const e = map.get(code) ?? { code, places: [], sources: [], denied: false }
    if (!e.places.some(p => placeKey(p) === placeKey(place))) e.places.push(place)
    if (!e.sources.some(s => s.kind === src.kind && (s.kind !== 'role' || s.role === (src as { role: string }).role))) e.sources.push(src)
    map.set(code, e)
  }
  for (const g of grants) {
    const role = roleById[g.role_id]
    if (!role || role.status !== 'active' || role.archived_at) continue
    const place = { scope_type: g.scope_type, zone_id: g.zone_id, hub_id: g.hub_id, zone: g.zone, hub: g.hub }
    for (const code of role.is_super ? allCodes : role.permissions) if (!denied.has(code)) add(code, place, { kind: 'role', role: role.id })
  }
  if (!isSuper) for (const o of live) {
    if (o.effect !== 'grant' || denied.has(o.permission)) continue
    if (o.scope_type === 'role') {
      for (const g of grants) add(o.permission, { scope_type: g.scope_type, zone_id: g.zone_id, hub_id: g.hub_id, zone: g.zone, hub: g.hub }, { kind: 'personal' })
    } else add(o.permission, { scope_type: o.scope_type, zone_id: o.zone_id, hub_id: o.hub_id, zone: o.zone, hub: o.hub }, { kind: 'personal' })
  }
  const list = [...map.values()].sort((a, b) => a.code.localeCompare(b.code))
  for (const code of denied) list.push({ code, places: [], sources: [], denied: true })
  return { list, isSuper }
}

/** The widest place a person works at: 'global' beats 'zone' beats 'hub'; 'none' = no role. */
export function reachOf(grants: Array<{ scope_type: string }>): Place | 'none' {
  if (grants.some(g => g.scope_type === 'global')) return 'global'
  if (grants.some(g => g.scope_type === 'zone')) return 'zone'
  return grants.length ? 'hub' : 'none'
}

// ---------------------------------------------------------------- history: audit rows -> readable events

/** A full page may stop in the middle of one action (its rows share one moment): keep that action for the next page. */
export function wholeActions(rows: AuditRow[], limit = HISTORY_PAGE): { rows: AuditRow[]; more: boolean } {
  if (rows.length < limit) return { rows, more: false }
  const last = rows[rows.length - 1].occurred_at
  const cut = rows.findIndex(r => r.occurred_at === last)
  return { rows: cut > 0 ? rows.slice(0, cut) : rows, more: true }
}

export type EventKind = 'role' | 'perm' | 'assign' | 'pages' | 'override' | 'layout'
export type AccessEvent = {
  key: string; at: string; actor: string | null; kind: EventKind
  /** what happened, as a code the page turns into words */
  what: 'role_new' | 'role_edit' | 'role_on' | 'role_off' | 'role_archive' | 'role_restore' | 'perm_set' | 'assign' | 'unassign' | 'assign_until'
    | 'pages_set' | 'pages_open' | 'layout' | 'override_set' | 'override_off'
  role: string | null; user: string | null
  added: string[]; removed: string[]
  /** extra facts: place of a role, fields changed … */
  info: Record<string, unknown>
  reason: string | null
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? null : String(v))
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/** Groups raw audit rows (one per changed row) into one event per action a person took. Newest first. */
export function buildEvents(rows: AuditRow[], permById: Record<string, string>): AccessEvent[] {
  const out: AccessEvent[] = []
  const groups = new Map<string, AccessEvent>()
  const group = (key: string, make: () => AccessEvent) => { let e = groups.get(key); if (!e) { e = make(); groups.set(key, e); out.push(e) } return e }
  for (const r of rows) {
    const n = r.new_data ?? {}, o = r.old_data ?? {}
    const base = { at: r.occurred_at, actor: r.actor_id, added: [] as string[], removed: [] as string[], info: {} as Record<string, unknown>, reason: r.reason }
    if (r.table_name === 'role_permissions') {
      const role = str(n.role_id ?? o.role_id), perm = str(n.permission_id ?? o.permission_id)
      const e = group(`rp|${r.occurred_at}|${r.actor_id}|${role}`, () => ({ ...base, key: `rp${r.id}`, kind: 'perm', what: 'perm_set', role, user: null }))
      const code = (perm && permById[perm]) || perm || '?'
      if (r.action === 'INSERT') e.added.push(code); else if (r.action === 'DELETE') e.removed.push(code)
    } else if (r.table_name === 'roles') {
      const id = str(n.id ?? o.id), f = r.changed_fields ?? []
      const what = r.action === 'INSERT' ? 'role_new' : r.action === 'ARCHIVE' ? 'role_archive' : r.action === 'RESTORE' ? 'role_restore'
        : f.includes('status') ? (n.status === 'active' ? 'role_on' : 'role_off') : 'role_edit'
      out.push({ ...base, key: `r${r.id}`, kind: 'role', what, role: id, user: null,
        info: { name: n.name ?? o.name, name_bn: n.name_bn ?? o.name_bn, fields: f, old_name: o.name, reason: n.archive_reason } })
    } else if (r.table_name === 'user_roles') {
      const role = str(n.role_id ?? o.role_id), user = str(n.user_id ?? o.user_id)
      const place = { scope_type: n.scope_type ?? o.scope_type, zone_id: n.zone_id ?? o.zone_id, hub_id: n.hub_id ?? o.hub_id, valid_to: n.valid_to }
      const what = r.action === 'INSERT' ? 'assign' : n.revoked_at && !o.revoked_at ? 'unassign' : 'assign_until'
      out.push({ ...base, key: `ur${r.id}`, kind: 'assign', what, role, user, info: place, reason: str(n.revoke_reason) ?? r.reason })
    } else if (r.table_name === 'role_dashboards') {
      const role = str(n.role_id ?? o.role_id), f = r.changed_fields ?? []
      const menuChanged = r.action === 'INSERT' ? n.menu != null : f.includes('menu')
      if (menuChanged) {
        const was = o.menu == null ? null : arr(o.menu), now = n.menu == null ? null : arr(n.menu)
        out.push({ ...base, key: `rd${r.id}`, kind: 'pages', what: now === null ? 'pages_open' : 'pages_set', role, user: null,
          added: now ? now.filter(p => !(was ?? []).includes(p)) : [], removed: was ? was.filter(p => !(now ?? []).includes(p)) : [],
          info: { was_open: was === null, count: now?.length ?? null } })
      }
      if (r.action === 'INSERT' ? arr(n.panels).length > 0 : f.some(x => x === 'panels' || x === 'default_view')) {
        out.push({ ...base, key: `rl${r.id}`, kind: 'layout', what: 'layout', role, user: null, info: { panels: arr(n.panels), view: n.default_view } })
      }
    } else if (r.table_name === 'user_permission_overrides') {
      const user = str(n.user_id ?? o.user_id), perm = str(n.permission_id ?? o.permission_id)
      const code = (perm && permById[perm]) || perm || '?'
      const off = r.action === 'UPDATE' && !!n.revoked_at && !o.revoked_at
      if (r.action !== 'INSERT' && !off) continue   // only an end date moved
      const e = group(`uo|${r.occurred_at}|${r.actor_id}|${user}|${off ? 'off' : 'set'}`, () => ({ ...base, key: `uo${r.id}`, kind: 'override', what: off ? 'override_off' : 'override_set', role: null, user,
        reason: off ? str(n.revoke_reason) ?? r.reason : str(n.reason) ?? r.reason }))
      const label = `${code}${n.effect === 'deny' ? '' : n.scope_type && n.scope_type !== 'role' ? ` @${String(n.scope_type)}` : ''}`
      if (off) (n.effect === 'deny' ? e.added : e.removed).push(label)   // taking a "switched off" back gives the permission back
      else (n.effect === 'deny' ? e.removed : e.added).push(label)
    }
  }
  return out
}

const BN: Array<[RegExp, string]> = [
  [/Only a Super Admin can set personal/i, 'ব্যক্তিগত অনুমতি শুধু সুপার অ্যাডমিন দিতে পারেন'],
  [/Super Admin always holds every permission/i, 'সুপার অ্যাডমিনের সব অনুমতি সবসময় থাকে — তাঁর জন্য আলাদা করে কিছু দেওয়া বা বন্ধ করা যায় না'],
  [/given and switched off/i, 'একই অনুমতি একসাথে বাড়তি দেওয়া আর বন্ধ করা যায় না'],
  [/end date is already past/i, 'শেষ তারিখ আজ বা তার পরের হতে হবে'],
  [/Choose an active zone/i, 'জোন বেছে নিন'],
  [/Choose an active hub/i, 'হাব বেছে নিন'],
  [/Too many personal permissions/i, 'একজনের জন্য এত বেশি ব্যক্তিগত অনুমতি নয় — এর বদলে একটি রোল বানান'],
  [/Unknown permission/i, 'এই নামের কোনো অনুমতি নেই'],
  [/reason is required/i, 'কারণ লিখুন'],
  [/Account not found/i, 'অ্যাকাউন্ট পাওয়া যায়নি'],
  [/System roles cannot be archived, deactivated/i, 'শুরুর (সিস্টেম) রোল বন্ধ বা আর্কাইভ করা যায় না'],
  [/Only a Super Admin can switch a role/i, 'রোল চালু বা বন্ধ শুধু সুপার অ্যাডমিন করতে পারেন'],
  [/Not authorised to change this role/i, 'এই রোল বদলানোর অনুমতি আপনার নেই'],
  [/permission denied for table audit_logs|Not authorised to view/i, 'এটা দেখার অনুমতি আপনার নেই'],
]
/** Access-page errors in Bangla; anything else falls through to the given translator. */
export function accessFriendly(err: unknown, fallback: (e: unknown) => string): string {
  const msg = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err)
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? hit[1] : fallback(err)
}
