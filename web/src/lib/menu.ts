// Which pages a person may open when their role has a list of pages ("শুধু এই কয়টা পাতা").
// `menu` null = no limit. This only hides and blocks pages; what data may be read or changed is decided by permissions.
import { supabase } from './supabase'

/** Always open: the home page, the staff panel and one's own profile, accounts, vehicle, password and device settings.
 *  These show only the person's own things; a role's page list limits the work pages. */
const ALWAYS = ['/app', '/app/staff', '/app/accounts/mine', '/app/fleet/mine', '/app/me', '/app/me/complete', '/app/me/permissions', '/app/notifications', '/app/references', '/app/password', '/app/settings']
/** Pages that belong to a listed page (opened from it, not from the menu). */
const WITH: Record<string, string[]> = {
  '/app/hub/team': ['/app/hr/employees'],
  '/app/hr/employees': ['/app/hr/applications'],
}
const bare = (p: string) => p.split('?')[0].replace(/\/+$/, '') || '/app'

/** A menu entry is shown when it is on the list. */
export const inMenu = (menu: string[] | null, to: string) => !menu || ALWAYS.includes(bare(to)) || menu.includes(to) || menu.map(bare).includes(bare(to))
/** A page may be opened when it is on the list, under a listed page, or belongs to one. */
export function pageAllowed(menu: string[] | null, pathname: string): boolean {
  if (!menu) return true
  const here = bare(pathname)
  if (ALWAYS.includes(here)) return true
  const open = menu.map(bare).flatMap(p => [p, ...(WITH[p] ?? [])])
  return open.some(p => p !== '/app' && (here === p || here.startsWith(p + '/')))
}

export type RoleMenu = { role_id: string; code: string; name: string; name_bn: string | null; is_super: boolean; menu: string[] | null; user_count: number }
export const menuApi = {
  mine: async (): Promise<string[] | null> => { const { data, error } = await supabase.rpc('my_menu'); if (error) return null; return (data as string[] | null) ?? null },
  roles: async (): Promise<RoleMenu[]> => { const { data, error } = await supabase.rpc('role_menu_list'); if (error) throw error; return (data ?? []) as RoleMenu[] },
  save: async (role: string, menu: string[] | null) => { const { error } = await supabase.rpc('role_menu_save', { p_role: role, p_menu: menu }); if (error) throw error },
}

/**
 * Which of the three panels a person belongs to, from what their role may do: 0 = staff, 1 = manager, 2 = zonal manager.
 * The menu shows the panels up to this level; a few things (training centre, the AI helper, the first-steps box) are for level 2 only.
 */
export const panelLevel = (can: (p: string) => boolean, group?: PanelGroup | null): 0 | 1 | 2 =>
  group ? GROUP_LEVEL[group]
    : can('zonal.dashboard.view') || can('system.user.view') || can('hr.request.approve') ? 2
    : can('hr.employee.view') || can('hr.attendance.create') || can('da.sheet.approve') ? 1 : 0
/**
 * The three role groups (owner, 17 Nov 2026). A Super Admin puts each role in one on "রোল গ্রুপ ও AERV";
 * a role with no group set falls back to its permissions (above).
 *   zone = সুপার অ্যাডমিন / জোনাল ম্যানেজার · hub = ম্যানেজার · self = স্টাফ / রাইডার
 */
export type PanelGroup = 'self' | 'hub' | 'zone'
export const GROUP_LEVEL: Record<PanelGroup, 0 | 1 | 2> = { self: 0, hub: 1, zone: 2 }
export const LEVEL_GROUP: PanelGroup[] = ['self', 'hub', 'zone']
export const groupApi = {
  /** The caller's group (highest of their roles); null = none set, work it out from permissions. */
  mine: async (): Promise<PanelGroup | null> => { const { data, error } = await supabase.rpc('my_panel_group'); if (error) return null; const g = data as string | null; return g === 'self' || g === 'hub' || g === 'zone' ? g : null },
}
/** Pages only the zonal manager's level gets in the menu (the owner asked for them to be off the manager's and staff's screens). */
export const ZONE_ONLY = ['/app/training', '/app/nodi/chat']

/** Super Admin: roles with their group and permission codes; set a group; AERV add / take away (role_groups_aerv migration). */
export type RoleGroupRow = { role_id: string; code: string; name: string; name_bn: string | null; is_super: boolean; is_system: boolean
  panel_group: PanelGroup | null; default_view: PanelGroup | null; user_count: number; permissions: string[] }

const fail = (e: { message: string; code?: string } | null) => { if (e) throw Object.assign(new Error(e.message), { code: e.code }) }
export const groupAdmin = {
  list: async (): Promise<RoleGroupRow[]> => { const { data, error } = await supabase.rpc('role_group_list'); fail(error); return (data ?? []) as RoleGroupRow[] },
  set: async (role: string, group: PanelGroup | null) => { const { error } = await supabase.rpc('role_group_set', { p_role: role, p_group: group }); fail(error) },
  saveAerv: async (role: string, grant: string[], revoke: string[]): Promise<number> => {
    const { data, error } = await supabase.rpc('role_aerv_save', { p_role: role, p_grant: grant, p_revoke: revoke }); fail(error); return Number(data ?? 0)
  },
  allCodes: async (): Promise<string[]> => {
    const { data, error } = await supabase.from('permissions').select('code').order('code'); fail(error)
    return ((data ?? []) as Array<{ code: string }>).map(r => r.code)
  },
}

