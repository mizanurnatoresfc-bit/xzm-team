// The zonal manager's popup question: everyone it is for sees it on opening the app and answers yes / no, in words, or both.
import { supabase } from './supabase'
import { HrError } from './hr'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export type PulseKind = 'yes_no' | 'text' | 'yes_no_text'
export type MyPulse = { id: string; title: string; body: string | null; kind: PulseKind; closes_at: string | null; from: string | null; created_at: string }
export type PulseRow = { id: string; title: string; body: string | null; kind: PulseKind; hub_ids: string[]; position_ids: string[]; closes_at: string | null
  status: 'open' | 'closed'; created_at: string; created_by_name: string | null; targets: number; answered: number; yes: number; no: number }
export type PulseResult = { employee_id: string; employee_code: string | null; full_name: string; mobile: string | null; hub_name: string | null; position: string | null
  has_login: boolean; answer: 'yes' | 'no' | null; note: string | null; answered_at: string | null }

export const PULSE_KIND: Record<PulseKind, [string, string]> = {
  yes_no: ['হ্যাঁ / না', 'Yes / no'], text: ['লিখে উত্তর', 'Written answer'], yes_no_text: ['হ্যাঁ / না + মন্তব্য', 'Yes / no + comment'],
}

export const pulse = {
  mine: () => rpc<MyPulse[]>('pulse_mine'),
  answer: (id: string, answer: 'yes' | 'no' | null, note: string | null) => rpc<void>('pulse_answer', { p_id: id, p_answer: answer, p_note: note }),
  list: (zone: string) => rpc<PulseRow[]>('pulse_list', { p_zone: zone }),
  results: (id: string) => rpc<PulseResult[]>('pulse_results', { p_id: id }),
  create: (a: { zone: string; title: string; body: string | null; kind: PulseKind; hubs: string[]; positions: string[]; closes: string | null }) =>
    rpc<string>('pulse_create', { p_zone: a.zone, p_title: a.title, p_body: a.body, p_kind: a.kind, p_hubs: a.hubs, p_positions: a.positions, p_closes: a.closes }),
  close: (id: string) => rpc<void>('pulse_close', { p_id: id }),
}

const BN: Array<[RegExp, string]> = [
  [/Write the question/i, 'প্রশ্নটা লিখুন'], [/Answer yes or no/i, 'হ্যাঁ বা না বাছুন'], [/Write your answer/i, 'উত্তর লিখুন'],
  [/closed/i, 'এই প্রশ্নের সময় শেষ'], [/not in this zone/i, 'একটা হাব এই জোনের নয়'], [/in the past/i, 'শেষ দিন আজ বা পরে দিন'],
  [/Not authorised|42501/i, 'এই কাজের অনুমতি নেই'],
]
export const pulseFriendly = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return BN.find(([re]) => re.test(m))?.[1] ?? m }
