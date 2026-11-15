// Launch: logins for all staff, a person's own mobile number, and roll-out progress by hub.
import { supabase } from './supabase'
import { HrError } from './hr'

export type HubProgress = { hub_id: string; hub_name: string; zone_id: string; staff: number; with_login: number; signed_in: number; password_set: number; with_mobile: number }
export type PersonProgress = { employee_id: string; employee_code: string | null; full_name: string; position_name: string | null; role_name: string | null
  has_login: boolean; signed_in_at: string | null; password_set: boolean; mobile: string | null }
/** An active employee who has no login yet. */
export type LoginCandidate = { id: string; employee_code: string | null; full_name: string; mobile: string | null; hub_id: string | null; zone_id: string | null; position_id: string | null }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

// Staff sign in with their Employee ID (or mobile). Supabase Auth still needs an e-mail behind
// every account, so one is made from the ID. Nobody types it and no mail is ever sent to it.
const LOGIN_DOMAIN = 'xzmteam.com'
export const loginEmail = (code: string) => `id-${code.toLowerCase().replace(/[^a-z0-9]/g, '')}@${LOGIN_DOMAIN}`

export const rollout = {
  progress: (zone?: string | null) => rpc<HubProgress[]>('rollout_progress', { p_zone: zone ?? null }),
  people: (hub: string) => rpc<PersonProgress[]>('rollout_people', { p_hub: hub }),
  /** Saves the signed-in person's own mobile number; from then on it also works as their login. */
  setMyMobile: (mobile: string) => rpc<string>('my_mobile_set', { p_mobile: mobile }),
  candidates: async (): Promise<LoginCandidate[]> => {
    const { data, error } = await supabase.from('employees').select('id,employee_code,full_name,mobile,hub_id,zone_id,position_id')
      .eq('status', 'active').is('archived_at', null).is('profile_id', null).order('full_name').limit(2000)
    if (error) throw new HrError(error.message, error.code)
    return (data ?? []) as LoginCandidate[]
  },
}
