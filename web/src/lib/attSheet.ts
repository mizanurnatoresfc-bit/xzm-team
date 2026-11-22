// দৈনিক ফাইনাল হাজিরা খাতা — typed calls to the database functions of migration 20261122000800_att_final_sheet.
// Every rule (who may write, the lock, who unlocks, who is asked to explain) is in the database; this file only calls it.
import { supabase } from './supabase'
import { HrError } from './hr'
import type { IsoDate } from './workforce'

export type FinalStatus = 'present' | 'late' | 'half_day' | 'absent' | 'leave' | 'holiday' | 'weekly_off'
export type ExplainReason = 'not_ok' | 'late' | 'unauthorized'

/** One line of the register as the manager fills it in. */
export type LineValue = {
  manager_ok: boolean | null
  final_status: FinalStatus | null
  late_time: string | null            // 'HH:MM'
  online_marked: boolean | null
  online_reason: string | null
  absence_app_date: IsoDate | null
  absence_app_ref: string | null
  unauthorized: boolean
  note: string | null
}
export type SelfMark = { id: string; kind: 'present' | 'absent'; note: string | null; status: 'waiting' | 'approved' | 'rejected'; marked_at: string
  applied_on_site: boolean | null; site_applied_on: IsoDate | null; site_ref: string | null; application_no: string | null }
export type Explanation = { id: string; reason: ExplainReason; asked_at: string; reply: string | null; replied_at: string | null }
export type SheetPerson = { employee_id: string; code: string | null; name: string; position: string | null; position_code: string | null; has_login: boolean
  mark: SelfMark | null; saved: boolean; value: LineValue; record_status: string | null; explanations: Explanation[] }
export type PositionCount = { position: string; total: number; not_given: number; present: number; late: number; absent: number; unauthorized: number; off: number; blank: number }
export type SheetCheck = { profile_id: string; name: string | null; sent_at: string; ok_at: string | null }
export type DaySheet = {
  hub: { id: string; name: string | null }; date: IsoDate; today: IsoDate
  sheet: null | { id: string; status: 'draft' | 'submitted'; submitted_at: string | null; submitted_by_name: string | null
    unlocked_at: string | null; unlock_note: string | null; sent_at: string | null }
  can: { edit: boolean | null; unlock: boolean | null; send: boolean | null }
  my_check: null | { sent_at: string; ok_at: string | null }
  people: SheetPerson[]; by_position: PositionCount[]; checks: SheetCheck[]
}
export type MyExplanation = { id: string; work_date: IsoDate; reason: ExplainReason; asked_at: string; reply: string | null; replied_at: string | null
  final_status: FinalStatus | null; late_time: string | null; hub: string | null }
export type ZoneDayHub = { hub_id: string; name: string | null; staff: number; given: number; sheet_id: string | null; status: 'draft' | 'submitted' | null
  submitted_at: string | null; sent_at: string | null; present: number; late: number; absent: number; unauthorized: number; checks: number; checks_ok: number; can_manage: boolean }
export type ZoneDay = {
  date: IsoDate; today: IsoDate; hubs: ZoneDayHub[]
  marks: Array<{ employee_id: string; code: string | null; name: string; position: string | null; hub_id: string; hub: string | null; kind: 'present' | 'absent'
    note: string | null; marked_at: string; status: string; site_applied_on: IsoDate | null; site_ref: string | null }>
  missing: Array<{ position: string; count: number; people: Array<{ name: string; code: string | null; hub: string | null }> }>
  explanations: Array<{ id: string; name: string; code: string | null; hub: string | null; reason: ExplainReason; reply: string | null; replied_at: string | null
    final_status: FinalStatus | null; late_time: string | null; absence_app_date: IsoDate | null }>
}
export type MonthCell = '' | 'P' | 'A' | 'O'
export type MonthSheet = { hub: { id: string; name: string | null }; month: IsoDate; today: IsoDate; dates: IsoDate[]
  days: Array<{ date: IsoDate; status: 'draft' | 'submitted' }>
  people: Array<{ employee_id: string; code: string | null; name: string; position: string | null; cells: MonthCell[]; present: number; absent: number; off: number }> }

/** What goes to the database for one line. */
export type LineInput = LineValue & { employee_id: string }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export const att = {
  sheet: (hub: string, date?: IsoDate | null) => rpc<DaySheet>('att_sheet_get', { p_hub: hub, p_date: date ?? null }),
  save: (hub: string, date: IsoDate, lines: LineInput[]) => rpc<string>('att_sheet_save', { p_hub: hub, p_date: date, p_lines: lines }),
  submit: (hub: string, date: IsoDate, lines: LineInput[]) => rpc<{ sheet_id: string; lines: number; asked: number }>('att_sheet_submit', { p_hub: hub, p_date: date, p_lines: lines }),
  unlock: (sheet: string, note: string) => rpc<void>('att_sheet_unlock', { p_sheet: sheet, p_note: note }),
  send: (sheet: string) => rpc<number>('att_sheet_send', { p_sheet: sheet }),
  checkOk: (sheet: string) => rpc<void>('att_sheet_check_ok', { p_sheet: sheet }),
  mine: (days = 62) => rpc<MyExplanation[]>('att_my_explanations', { p_days: days }),
  reply: (id: string, reply: string) => rpc<void>('att_explain_reply', { p_id: id, p_reply: reply }),
  zoneDay: (zone: string | null, date: IsoDate) => rpc<ZoneDay>('att_zone_day', { p_zone: zone, p_date: date }),
  month: (hub: string, month: IsoDate) => rpc<MonthSheet>('att_month_sheet', { p_hub: hub, p_month: month }),
}

export const LIVE_SHEET = ['att_day_sheets', 'att_day_lines', 'att_explanations', 'att_sheet_checks', 'attendance_self_marks']

export const FINAL_OPTIONS: Array<{ key: FinalStatus; bn: string; en: string }> = [
  { key: 'present', bn: 'উপস্থিত', en: 'Present' }, { key: 'late', bn: 'দেরিতে', en: 'Late' }, { key: 'half_day', bn: 'অর্ধদিবস', en: 'Half day' },
  { key: 'absent', bn: 'অনুপস্থিত', en: 'Absent' }, { key: 'leave', bn: 'ছুটি', en: 'Leave' }, { key: 'holiday', bn: 'সরকারি ছুটি', en: 'Holiday' },
  { key: 'weekly_off', bn: 'সাপ্তাহিক ছুটি', en: 'Weekly off' },
]
export const REASON_META: Record<ExplainReason, { bn: string; en: string }> = {
  not_ok: { bn: 'দেওয়া হাজিরা ঠিক নেই', en: 'Given attendance not right' },
  late: { bn: 'দেরিতে আসা', en: 'Came late' },
  unauthorized: { bn: 'না জানিয়ে অনুপস্থিত', en: 'Absent without telling' },
}
export const isPresentLike = (s: FinalStatus | null) => s === 'present' || s === 'late' || s === 'half_day'

/** The same checks the database makes on submit, so the manager sees what is missing before pressing the button. */
export function lineProblem(p: SheetPerson, v: LineValue, lang: 'bn' | 'en'): string | null {
  const t = (bn: string, en: string) => lang === 'bn' ? bn : en
  if (!v.final_status) return t('হাজিরা বাছুন', 'Choose the attendance')
  if (p.mark && v.manager_ok === null) return t('হ্যাঁ / না দিন', 'Answer yes / no')
  if (v.final_status === 'late' && !v.late_time) return t('আসার সময় দিন', 'Give the arrival time')
  if (isPresentLike(v.final_status) && v.online_marked === null) return t('অনলাইনে হাজিরা দিয়েছেন কি না বলুন', 'Say whether marked online')
  if (isPresentLike(v.final_status) && v.online_marked === false && !v.online_reason?.trim()) return t('অনলাইনে না দেওয়ার কারণ লিখুন', 'Write why not marked online')
  if (v.final_status === 'absent' && !v.unauthorized && !v.absence_app_date) return t('আবেদনের তারিখ দিন, বা "না জানিয়ে" দিন', 'Give the application date, or mark "without telling"')
  return null
}
