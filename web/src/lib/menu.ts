// Which pages a person may open when their role has a list of pages ("শুধু এই কয়টা পাতা").
// The rules live in navAccess.ts (shared by the menus, the phone tabs, the quick actions and the routes); this file talks to the database.
import { supabase } from './supabase'
import { withTwins } from './navAccess'

export * from './navAccess'

export type RoleMenu = { role_id: string; code: string; name: string; name_bn: string | null; is_super: boolean; menu: string[] | null; user_count: number }
export const menuApi = {
  mine: async (): Promise<string[] | null> => { const { data, error } = await supabase.rpc('my_menu'); if (error) throw error; return (data as string[] | null) ?? null },
  roles: async (): Promise<RoleMenu[]> => { const { data, error } = await supabase.rpc('role_menu_list'); if (error) throw error; return (data ?? []) as RoleMenu[] },
  save: async (role: string, menu: string[] | null) => { const { error } = await supabase.rpc('role_menu_save', { p_role: role, p_menu: menu ? withTwins(menu) : null }); if (error) throw error },
}

