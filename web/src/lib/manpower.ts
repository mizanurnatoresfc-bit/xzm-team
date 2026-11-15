// "লোক লাগবে" (manpower requests), the staff change register for company files,
// and the hub x post headcount matrix. All permission checks are in the database.
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type MpStatus = 'submitted' | 'approved' | 'rejected' | 'filled' | 'closed' | 'cancelled'
export type Manpower = {
  id: string; request_no: string; zone_id: string; hub_id: string; position_id: string | null; needed: number; reason: string
  daily_pickup: number | null; daily_delivery: number | null; big_parcels: number | null; other_issues: string | null
  status: MpStatus; scope: 'hub' | 'zone'; notify_positions: string[]; filled: number; submitted_by: string; submitter_employee_id: string | null
  decided_at: string | null; decision_note: string | null; notified_count: number; created_at: string
}
export const MP_STATUS: Record<MpStatus, [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  submitted: ['অনুমোদনের অপেক্ষায়', 'warn'], approved: ['লোক খোঁজা চলছে', 'info'], rejected: ['বাতিল', 'bad'],
  filled: ['লোক পাওয়া গেছে', 'ok'], closed: ['বন্ধ', 'neutral'], cancelled: ['তুলে নেওয়া', 'neutral'],
}

export type RegisterRow = {
  source: 'system' | 'request'; kind: string; event_date: string | null; employee_id: string | null; employee_code: string | null; full_name: string | null
  mobile: string | null; position_name: string | null; from_hub: string | null; to_hub: string | null; from_status: string | null; to_status: string | null
  reason: string | null; request_no: string | null; request_status: string | null; reference: string | null; done_by: string | null; recorded_at: string
}
export type MatrixCell = { hub_id: string; hub_name: string; position_id: string | null; position_name: string; sort_order: number; active: number; inactive: number; applicant: number; needed: number }

export const manpower = {
  list: async (zone?: string | null) => {
    let q = supabase.from('manpower_requests').select('*').order('created_at', { ascending: false }).limit(300)
    if (zone) q = q.eq('zone_id', zone)
    const { data, error } = await q; fail(error); return (data ?? []) as Manpower[]
  },
  submit: (a: { hub: string; position: string | null; needed: number; reason: string; pickup: number | null; delivery: number | null; big: number | null; issues: string }) =>
    rpc<string>('mp_submit', { p_hub: a.hub, p_position: a.position, p_needed: a.needed, p_reason: a.reason, p_pickup: a.pickup, p_delivery: a.delivery, p_big: a.big, p_issues: a.issues || null }),
  decide: (id: string, status: 'approved' | 'rejected', note: string, scope: 'hub' | 'zone', positions: string[], needed: number | null) =>
    rpc<number>('mp_decide', { p_id: id, p_status: status, p_note: note || null, p_scope: scope, p_notify_positions: positions, p_needed: needed }),
  close: (id: string, status: 'filled' | 'closed' | 'cancelled', filled: number | null, note: string) =>
    rpc<void>('mp_close', { p_id: id, p_status: status, p_filled: filled, p_note: note || null }),
  register: (zone: string | null, from: string, to: string) => rpc<RegisterRow[]>('hr_change_register', { p_zone: zone, p_from: from, p_to: to }),
  matrix: (zone: string | null) => rpc<MatrixCell[]>('hr_hub_post_matrix', { p_zone: zone }),
}

export const REG_KIND: Record<string, string> = {
  transfer: 'বদলি', promotion: 'পদোন্নতি', correction: 'সংশোধন', status: 'অবস্থা বদল',
  id_transfer: 'বদলি (মার্ক)', id_active: 'আইডি চালু (মার্ক)', id_inactive: 'আইডি বন্ধ (মার্ক)', id_create: 'নতুন আইডি (মার্ক)',
}
export const EMP_ST_BN: Record<string, string> = { active: 'সক্রিয়', inactive: 'নিষ্ক্রিয়', resigned: 'চাকরি ছেড়েছেন', terminated: 'বাদ', applicant: 'আবেদনকারী' }
