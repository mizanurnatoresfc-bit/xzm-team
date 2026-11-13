// Staff login accounts and role assignment. Reads and changes go through database
// functions that check the caller's rights; creating an account and setting passwords
// go through the admin-users Edge Function (the only place the service key is used).
import { supabase } from './supabase'
import { HrError } from './hr'

export type RoleGrant = { id: string; role_id: string; code: string; name: string; name_bn: string | null; is_super: boolean
  scope_type: 'global' | 'zone' | 'hub'; zone_id: string | null; hub_id: string | null; zone: string | null; hub: string | null
  valid_from: string; valid_to: string | null }
export type UserRow = { id: string; full_name: string; email: string | null; phone: string | null; status: 'active' | 'inactive'
  archived_at: string | null; locked: boolean; locked_until: string | null; failed_login_count: number; last_login_at: string | null
  must_change_password: boolean; created_at: string; employee_id: string | null; employee_code: string | null
  roles: RoleGrant[]; can_manage: boolean }
export type AssignableRole = { id: string; code: string; name: string; name_bn: string | null; is_super: boolean }
export type FreeEmployee = { id: string; employee_code: string; full_name: string; mobile: string | null; email: string | null; zone_id: string | null; hub_id: string | null }
export type LoginEvent = { id: number; occurred_at: string; success: boolean; failure_reason: string | null; ip_address: string | null; portal: string }
export type Scope = 'global' | 'zone' | 'hub'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

/** Calls the admin-users Edge Function and turns its error body into a readable error. */
async function fn(body: Record<string, unknown>): Promise<{ user_id?: string; warning?: string | null }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let b: { error?: string; message?: string; code?: string } = {}
    const ctx = (error as { context?: Response }).context
    try { if (ctx && typeof ctx.json === 'function') b = await ctx.json() } catch { /* not JSON */ }
    throw new HrError(b.message || b.error || error.message, b.code ?? b.error)
  }
  return (data ?? {}) as { user_id?: string; warning?: string | null }
}

export const users = {
  list: () => rpc<UserRow[]>('user_admin_list'),
  assignable: (scope: Scope, zone?: string | null, hub?: string | null) =>
    rpc<AssignableRole[]>('user_admin_assignable_roles', { p_scope: scope, p_zone: zone || null, p_hub: hub || null }),
  freeEmployees: () => rpc<FreeEmployee[]>('user_admin_unlinked_employees'),
  assign: (user: string, role: string, scope: Scope, zone?: string | null, hub?: string | null, validTo?: string | null) =>
    rpc<string>('user_admin_assign_role', { p_user: user, p_role: role, p_scope: scope, p_zone: zone || null, p_hub: hub || null, p_valid_to: validTo || null }),
  revoke: (assignment: string, reason: string) => rpc<void>('user_admin_revoke_role', { p_assignment: assignment, p_reason: reason }),
  setStatus: (user: string, active: boolean, reason: string) => rpc<void>('user_admin_set_status', { p_user: user, p_active: active, p_reason: reason }),
  unlock: (user: string) => rpc<void>('user_admin_unlock', { p_user: user }),
  logins: async (user: string): Promise<LoginEvent[]> => {
    const { data, error } = await supabase.from('login_events').select('id, occurred_at, success, failure_reason, ip_address, portal')
      .eq('user_id', user).order('occurred_at', { ascending: false }).limit(30)
    if (error) throw new HrError(error.message, error.code)
    return (data ?? []) as LoginEvent[]
  },
  create: (f: { email: string; full_name: string; phone: string; password: string; role_id: string; scope_type: Scope
    zone_id: string | null; hub_id: string | null; employee_id: string | null }) => fn({ action: 'create', ...f }),
  resetPassword: (user: string, password: string) => fn({ action: 'reset_password', user_id: user, password }),
  changeMyPassword: (password: string) => fn({ action: 'change_password', password }),
  mustChangePassword: async (user: string): Promise<boolean> => {
    const { data } = await supabase.from('profiles').select('must_change_password').eq('id', user).maybeSingle()
    return Boolean((data as { must_change_password?: boolean } | null)?.must_change_password)
  },
}

/** Readable temporary password: no look-alike characters, always letters and digits. */
export function tempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789'
  const pick = (s: string) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return s[a[0] % s.length] }
  let p = ''
  for (let i = 0; i < 6; i++) p += pick(letters)
  for (let i = 0; i < 4; i++) p += pick(digits)
  return p
}
export const strongEnough = (pw: string) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw)

export const SCOPE_LABEL: Record<Scope, [string, string]> = {
  global: ['পুরো কোম্পানি (হেড অফিস)', 'Whole company (Head Office)'],
  zone: ['একটি জোন', 'One zone'],
  hub: ['একটি হাব', 'One hub'],
}

const BN: Array<[RegExp, string]> = [
  [/already exists/i, 'এই ইমেইলে আগেই একটি অ্যাকাউন্ট আছে'],
  [/already has that role/i, 'এই অ্যাকাউন্টের ওই জায়গায় এই রোল আগেই আছে'],
  [/valid email/i, 'সঠিক ইমেইল দিন'],
  [/weak_password|Password should/i, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে, এতে অক্ষর ও সংখ্যা দুটোই থাকবে'],
  [/whole company/i, 'সুপার অ্যাডমিন শুধু পুরো কোম্পানির জন্য দেওয়া যায়'],
  [/active zone/i, 'জোন বেছে নিন'],
  [/active hub/i, 'হাব বেছে নিন'],
  [/assign this role/i, 'এই রোল এই জায়গায় দেওয়ার অনুমতি আপনার নেই'],
  [/last Super Admin/i, 'শেষ সুপার অ্যাডমিনকে সরানো বা বন্ধ করা যায় না'],
  [/own account status/i, 'নিজের অ্যাকাউন্ট নিজে বন্ধ করা যায় না'],
  [/reason is required/i, 'কারণ লিখুন'],
  [/not active or already has a login/i, 'এই কর্মী সক্রিয় নন অথবা তাঁর আগেই লগইন আছে'],
  [/employee_link_failed/i, 'অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু কর্মীর সাথে যুক্ত করা যায়নি'],
  [/not_signed_in/i, 'আবার লগইন করুন'],
  [/Not authorised|forbidden|42501/i, 'এই কাজের অনুমতি আপনার নেই'],
  [/Failed to send|network|fetch/i, 'সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন'],
]
export function userFriendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err)
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? hit[1] : msg
}
