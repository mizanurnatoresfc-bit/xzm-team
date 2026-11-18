// নদী: days without attendance — a person's own gaps and answers, and the Zonal Assistant's report.
import { supabase } from './supabase'
import { HrError } from './hr'

export type GapKind = 'leave' | 'worked' | 'other'
export type GapStatus = 'waiting' | 'answered' | 'verified' | 'returned'
export type MyGap = { work_date: string; answer_id: string | null; kind: GapKind | null; note: string | null; status: GapStatus; leave_status: string | null; check_note: string | null }
export type GapRow = MyGap & { employee_id: string; employee_code: string | null; full_name: string; position_name: string | null; hub_id: string | null; hub_name: string | null; has_login: boolean }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export const KIND_BN: Record<GapKind, string> = { leave: 'ছুটিতে ছিলাম', worked: 'কাজে ছিলাম, হাজিরা ওঠেনি', other: 'অন্য কারণ' }
export const KIND_EN: Record<GapKind, string> = { leave: 'I was on leave', worked: 'I was at work, it was not marked', other: 'Another reason' }
/** Status of a gap report: submitted (answered) -> approved (verified) or returned. */
export const GAP_STATUS: Record<GapStatus, [string, 'warn' | 'info' | 'ok' | 'bad']> = {
  waiting: ['উত্তর বাকি', 'warn'], answered: ['জমা — ম্যানেজারের অনুমোদনের অপেক্ষায়', 'info'], verified: ['অনুমোদিত', 'ok'], returned: ['ফেরত — আবার দিন', 'bad'],
}
export const GAP_STATUS_EN: Record<GapStatus, string> = {
  waiting: 'Not answered', answered: 'Submitted — waiting for the manager', verified: 'Approved', returned: 'Returned — answer again',
}
export const LEAVE_BN: Record<string, string> = { pending: 'আবেদন অপেক্ষায়', approved: 'ছুটি অনুমোদিত', rejected: 'ছুটি বাতিল', cancelled: 'আবেদন তুলে নেওয়া' }
export const dayBn = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' })

export const gaps = {
  mine: () => rpc<MyGap[]>('my_att_gaps'),
  /** One report for one or more days. No leave request is filed (owner's rule): the answer is the report. A note is needed only for 'other'. */
  answer: (dates: string[], kind: GapKind, note: string) =>
    rpc<number>('my_att_gap_answer', { p_dates: dates, p_kind: kind, p_note: note || null, p_leave_type: null }),
  report: (from: string, to: string, hub?: string | null) => rpc<GapRow[]>('att_gap_report', { p_from: from, p_to: to, p_zone: null, p_hub: hub || null }),
  check: (ids: string[], ok: boolean, note?: string) => rpc<number>('att_gap_check', { p_ids: ids, p_ok: ok, p_note: note || null }),
  remind: (from: string, to: string, hub?: string | null) => rpc<number>('att_gap_remind', { p_from: from, p_to: to, p_hub: hub || null }),
}
