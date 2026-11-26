// সকালের জনবল ও রুট প্রকাশ — typed calls to the database functions of migration 20261124000100_morning_input.
// Every rule (who may fill, the lock, who reads the lines, the cut-off, the revisions) is in the database; this file only calls it.
import { supabase } from './supabase'
import { HrError } from './hr'
import type { IsoDate } from './workforce'

export type MorningState = 'present' | 'absent' | 'leave' | 'unknown'
/** What the hub manager may type: leave is never typed, it comes from the approved leave. */
export type TypedState = 'present' | 'absent' | 'unknown'
export type LeaveInfo = { ref: string; source: 'leave_request' | 'absence_application'; applied_on: IsoDate }
export type MorningPerson = { id: string; code: string | null; name: string; post: string | null; state: MorningState; leave: LeaveInfo | null }
export type MorningForm = {
  hub: { id: string; name: string; zone_id: string }; date: IsoDate; today: IsoDate; now: string; opens_at: string; due: string
  status: 'open' | 'submitted'; revision: number
  can: { fill: boolean; review: boolean }
  receipt: null | { revision: number; mode: 'manager' | 'auto' | null; submitted_at: string; submitted_by_name: string | null }
  returned: null | { reason: string | null; at: string }
  hold: null | MorningHold
  people: MorningPerson[] | null           // null: the hub manager after the submit sees a receipt only
}
/** The server did not submit an empty or unfinished morning input; the managers were told. */
export type MorningHold = { held_at?: string; reason: 'empty' | 'incomplete'; gap_count: number; total: number; gaps: Array<{ name: string; why: string | null }> }
export type ZoneMorningHub = {
  held: boolean; window_open: boolean; hold: null | MorningHold
  id: string; name: string; zone_id: string; zone_name: string; staff: number; due: string
  state: 'submitted' | 'open' | 'none'; sub_id: string | null; revision: number | null; mode: 'manager' | 'auto' | null; submitted_at: string | null
  returned: null | { reason: string | null; at: string }
  present: number; absent: number; leave: number; unknown: number
  people: null | Array<{ id: string; name: string; code: string | null; state: MorningState; leave_ref: string | null }>
  cover: null | Array<{ id: string; code: string; name: string; regular: string[] }>
  plan: null | { id: string; status: 'draft' | 'sent' | 'approved'; published_version: number }
}
export type ZoneMorning = { date: IsoDate; today: IsoDate; now: string; hubs: ZoneMorningHub[] }
export type AttPolicy = { zone_id: string; morning_open: string; morning_cutoff: string; morning_extra: number; day_time: string; day_extra: number; own: boolean; today_due: string; can_edit: boolean }
export type PlanMorning = {
  date: IsoDate; required: boolean; waiting: boolean; returned: boolean; plan_stale: boolean; published_stale: boolean
  morning: null | { id: string; revision: number; mode: 'manager' | 'auto' | null; submitted_at: string; present: number; absent: number; leave: number; unknown: number }
}
export type PublishedPlan = {
  date: IsoDate; version: null | { no: number; published_at: string; by: string | null; morning_revision: number | null }
  plan_id?: string; reopened?: boolean
  lines?: Array<{ employee_id: string; name: string; role: 'rider' | 'helper'; parcels: number; pickups: number; routes: string[]; sent_count: number; last_sent_at: string | null }>
  cancelled?: Array<{ employee_id: string; name: string; cancelled_at: string; in_version: number }>
  history?: Array<{ kind: 'published' | 'resent' | 'cancelled' | 'morning_returned' | 'morning_changed'; version: number | null; note: string | null; by: string | null; at: string }>
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export const morning = {
  get: (hub: string, date?: IsoDate | null) => rpc<MorningForm>('wf_morning_get', { p_hub: hub, p_date: date ?? null }),
  save: (hub: string, lines: Array<{ employee_id: string; state: TypedState }>, date?: IsoDate | null) => rpc<void>('wf_morning_save', { p_hub: hub, p_date: date ?? null, p_lines: lines }),
  submit: (hub: string, lines: Array<{ employee_id: string; state: TypedState }>, date?: IsoDate | null) =>
    rpc<{ revision: number; mode: string; submitted_at: string; already: boolean }>('wf_morning_submit', { p_hub: hub, p_date: date ?? null, p_lines: lines }),
  zone: (zone: string | null, date?: IsoDate | null) => rpc<ZoneMorning>('wf_morning_zone', { p_zone: zone, p_date: date ?? null }),
  sendBack: (hub: string, reason: string, date?: IsoDate | null) => rpc<number>('wf_morning_return', { p_hub: hub, p_date: date ?? null, p_reason: reason }),
  policy: (zone: string) => rpc<AttPolicy>('wf_att_policy_get', { p_zone: zone }),
  savePolicy: (zone: string, p: Partial<Pick<AttPolicy, 'morning_open' | 'morning_cutoff' | 'morning_extra' | 'day_time' | 'day_extra'>>) => rpc<AttPolicy>('wf_att_policy_save', { p_zone: zone, p }),
  planMorning: (hub: string, date?: IsoDate | null) => rpc<PlanMorning>('route_plan_morning', { p_hub: hub, p_date: date ?? null }),
  published: (hub: string, date?: IsoDate | null) => rpc<PublishedPlan>('route_plan_published', { p_hub: hub, p_date: date ?? null }),
  resend: (plan: string) => rpc<number>('route_plan_resend', { p_plan: plan }),
}

export const STATE_META: Record<MorningState, { bn: string; en: string; tone: 'ok' | 'bad' | 'info' | 'warn' }> = {
  present: { bn: 'এসেছে', en: 'Came', tone: 'ok' }, absent: { bn: 'আসেনি', en: 'Did not come', tone: 'bad' },
  leave: { bn: 'অনুমোদিত ছুটি', en: 'On approved leave', tone: 'info' }, unknown: { bn: 'যাচাই বাকি', en: 'Not checked yet', tone: 'warn' },
}
