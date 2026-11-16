// Which pages a person may open when their role has a list of pages ("শুধু এই কয়টা পাতা").
// `menu` null = no limit. This only hides and blocks pages; what data may be read or changed is decided by permissions.
import { supabase } from './supabase'

/** Always open: the home page, the staff panel and one's own profile, accounts, vehicle, password and device settings.
 *  These show only the person's own things; a role's page list limits the work pages. */
const ALWAYS = ['/app', '/app/staff', '/app/accounts/mine', '/app/fleet/mine', '/app/me', '/app/me/permissions', '/app/notifications', '/app/password', '/app/settings']
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
export const panelLevel = (can: (p: string) => boolean): 0 | 1 | 2 =>
  can('zonal.dashboard.view') || can('system.user.view') || can('hr.request.approve') ? 2
    : can('hr.employee.view') || can('hr.attendance.create') || can('da.sheet.approve') ? 1 : 0
/** Pages only the zonal manager's level gets in the menu (the owner asked for them to be off the manager's and staff's screens). */
export const ZONE_ONLY = ['/app/training', '/app/nodi/chat']
