// Which pages a person may open when their role has a list of pages ("শুধু এই কয়টা পাতা").
// `menu` null = no limit. This only hides and blocks pages; what data may be read or changed is decided by permissions.
import { supabase } from './supabase'

/** Always open: the home page and one's own profile, password and device settings. */
const ALWAYS = ['/app', '/app/profile', '/app/password', '/app/settings', '/app/permissions']
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
