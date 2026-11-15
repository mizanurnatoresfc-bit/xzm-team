// Zonal command centre: reads the zonal database functions (zm_*), which check
// permissions themselves, and writes visits / claims / plan reviews through RLS or RPCs.
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type WorkStat = 'total' | 'active' | 'inactive' | 'new_joining' | 'resigned' | 'transferred' | 'employee_id_issued' | 'pending_applications'
export type ZmDashboard = {
  period: { from: string; to: string }
  workforce: Record<WorkStat, number>
  hubs: { hub_count: number; pickups: number; deliveries: number; merchants: number; rider_capacity: number; cash_collected: number; expenses: number; pending_parcels: number; unverified_days: number }
  data_completion: { employees: number; incomplete: number; average_pct: number }
  tasks: { open: number; overdue: number; pending_submissions: number; awaiting_confirmation: number; completed: number }
  travel: { visits: number; total_km: number; fuel: number; meal: number; transport: number; other: number; total: number; unclaimed: number }
  claims_pending: number
}
export type HubPerf = {
  hub_id: string; hub_code: string; hub_name: string; days_verified: number; days_unverified: number; pickups: number; deliveries: number
  merchants: number; avg_rider_capacity: number | null; avg_riders: number | null; cash_collected: number; expenses: number; pending_parcels: number
  parcels_per_rider_day: number | null; expense_per_parcel: number | null; volume_share_pct: number | null; volume_rank: number | null
}
export type WorkDetail = { employee_id: string; employee_code: string | null; full_name: string; hub_id: string | null; hub_name: string | null; position_name: string | null; status: string; event_date: string | null; detail: string | null }
export type TaskAcc = { manager_id: string; manager_name: string; assigned: number; completed: number; completed_on_time: number; overdue: number; pending_submissions: number; awaiting_confirmation: number; on_time_pct: number | null }
export type PlanItem = { hub_id: string; hub_name: string; hub_code: string; kind: string; summary: string; evidence: Record<string, unknown>; assumptions: unknown[] }
export type Recommendation = { id: string; hub_id: string; period_from: string; period_to: string; kind: string; summary: string; status: 'proposed' | 'acknowledged' | 'dismissed'; review_note: string | null; created_at: string }
export type Visit = { id: string; hub_id: string; visit_date: string; purpose: string; findings: string | null; distance_km: number; fuel_amount: number; meal_amount: number; transport_amount: number; other_amount: number; other_note: string | null; total_amount: number; claim_id: string | null }
export type Claim = { id: string; claim_no: string; claimant_id: string; period_type: string; period_from: string; period_to: string; visit_count: number; total_km: number; total_amount: number; status: 'submitted' | 'approved' | 'rejected' | 'returned'; decision_note: string | null; voucher_no: string | null; created_at: string }

export const zonal = {
  dashboard: (zone: string | null, from: string, to: string) => rpc<ZmDashboard>('zm_dashboard', { p_zone: zone, p_from: from, p_to: to }),
  hubs: (zone: string | null, from: string, to: string) => rpc<HubPerf[]>('zm_hub_performance', { p_zone: zone, p_from: from, p_to: to }),
  details: (stat: WorkStat, zone: string | null, from: string, to: string) =>
    rpc<WorkDetail[]>('zm_workforce_details', { p_stat: stat, p_zone: zone, p_from: from, p_to: to }),
  tasks: (zone: string | null, from: string, to: string) => rpc<TaskAcc[]>('zm_task_accountability', { p_from: from, p_to: to, p_zone: zone }),
  plan: (zone: string, from: string, to: string, save: boolean) =>
    rpc<{ items: PlanItem[]; policy: string; assumptions: unknown[] }>('zm_workforce_plan', { p_zone: zone, p_from: from, p_to: to, p_save: save }),
  recommendations: async (zone: string | null) => {
    let q = supabase.from('workforce_recommendations').select('*').order('created_at', { ascending: false }).limit(60)
    if (zone) q = q.eq('zone_id', zone)
    const { data, error } = await q; fail(error); return (data ?? []) as Recommendation[]
  },
  review: (id: string, status: 'acknowledged' | 'dismissed', note: string) => rpc<void>('zm_review_recommendation', { p_id: id, p_status: status, p_note: note }),
  visits: async (zone: string | null, from: string, to: string) => {
    let q = supabase.from('hub_visits').select('*').is('archived_at', null).gte('visit_date', from).lte('visit_date', to).order('visit_date', { ascending: false })
    if (zone) q = q.eq('zone_id', zone)
    const { data, error } = await q; fail(error); return (data ?? []) as Visit[]
  },
  addVisit: async (v: { hub_id: string; zone_id: string; visit_date: string; purpose: string; findings: string | null; distance_km: number; fuel_amount: number; meal_amount: number; transport_amount: number; other_amount: number; other_note: string | null }) => {
    const { error } = await supabase.from('hub_visits').insert(v); fail(error)
  },
  claims: async (zone: string | null) => {
    let q = supabase.from('travel_claims').select('*').order('created_at', { ascending: false }).limit(60)
    if (zone) q = q.eq('zone_id', zone)
    const { data, error } = await q; fail(error); return (data ?? []) as Claim[]
  },
  submitClaim: (zone: string, type: 'weekly' | 'monthly', from: string, to: string) =>
    rpc<string>('zm_submit_claim', { p_zone: zone, p_period_type: type, p_from: from, p_to: to }),
  decideClaim: (id: string, decision: 'approved' | 'rejected' | 'returned', note: string | null, voucher: string | null) =>
    rpc<void>('zm_decide_claim', { p_claim: id, p_decision: decision, p_note: note, p_voucher_no: voucher }),
}

export const PLAN_KIND: Record<string, [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  add_riders: ['রাইডার বাড়ানো দরকার', 'bad'], rebalance_riders: ['রাইডার ভাগ করে দিন', 'warn'], review_backlog: ['জমে থাকা পার্সেল দেখুন', 'warn'],
  review_overtime: ['অতিরিক্ত কাজের সময়', 'warn'], data_gap: ['তথ্য কম', 'info'], no_change: ['ঠিক আছে', 'ok'],
}
