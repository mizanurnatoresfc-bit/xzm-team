// দৈনিক ফাইনাল হাজিরা খাতা — typed calls to the database functions of migration 20261122000800_att_final_sheet.
// Every rule (who may write, the lock, who unlocks, who is asked to explain) is in the database; this file only calls it.
import { supabase } from './supabase'
import { HrError } from './hr'
import type { IsoDate } from './workforce'

export type FinalStatus = 'present' | 'late' | 'half_day' | 'absent' | 'leave' | 'holiday' | 'weekly_off' | 'pending_leave' | 'unchecked'
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
  online_at?: string | null           // the server time of the person's own mark (never typed)
  absence_reason?: string | null      // a known absence has a reason; an unknown one (unauthorized) has none
  leave_ref?: string | null           // the approved leave that put the line there
  leave_applied_on?: IsoDate | null   // the date that leave was applied for — it goes into the report
  leave_pending?: { state: 'pending'; ref: string; applied_on: IsoDate } | null
}
export type SelfMark = { id: string; kind: 'present' | 'absent'; note: string | null; status: 'waiting' | 'approved' | 'rejected'; marked_at: string
  applied_on_site: boolean | null; site_applied_on: IsoDate | null; site_ref: string | null; application_no: string | null }
export type Explanation = { id: string; reason: ExplainReason; asked_at: string; reply: string | null; replied_at: string | null }
export type SheetPerson = { employee_id: string; code: string | null; name: string; position: string | null; position_code: string | null; has_login: boolean
  mark: SelfMark | null; saved: boolean; value: LineValue; record_status: string | null; explanations: Explanation[] }
export type PositionCount = { position: string; total: number; not_given: number; present: number; late: number; absent: number; unauthorized: number; off: number; blank: number }
export type SheetCheck = { profile_id: string; name: string | null; sent_at: string; ok_at: string | null; returned_at: string | null; return_reason: string | null; version_no: number }
export type DaySheet = {
  hub: { id: string; name: string | null }; date: IsoDate; today: IsoDate
  sheet: null | { id: string; status: 'draft' | 'submitted'; submitted_at: string | null; submitted_by_name: string | null
    unlocked_at: string | null; unlock_note: string | null; sent_at: string | null; version: number; mode: 'manager' | 'auto' | null }
  due: string
  window: null | { id: string; from: IsoDate; to: IsoDate; expires_at: string; reason: string; by: string | null }
  versions: Array<{ no: number; mode: 'manager' | 'auto'; at: string; by: string | null }>
  can: { edit: boolean | null; unlock: boolean | null; send: boolean | null }
  my_check: null | { sent_at: string; ok_at: string | null; returned_at: string | null; return_reason: string | null; version_no: number }
  people: SheetPerson[]; by_position: PositionCount[]; checks: SheetCheck[]
}
export type MyExplanation = { id: string; work_date: IsoDate; reason: ExplainReason; asked_at: string; reply: string | null; replied_at: string | null
  final_status: FinalStatus | null; late_time: string | null; hub: string | null }
export type ZoneDayHub = { hub_id: string; name: string | null; staff: number; given: number; sheet_id: string | null; status: 'draft' | 'submitted' | null
  submitted_at: string | null; sent_at: string | null; present: number; late: number; absent: number; unauthorized: number; checks: number; checks_ok: number; can_manage: boolean
  checks_returned: number; version: number; mode: 'manager' | 'auto' | null; unchecked: number; due: string }
export type ZoneDay = {
  date: IsoDate; today: IsoDate; hubs: ZoneDayHub[]
  marks: Array<{ employee_id: string; code: string | null; name: string; position: string | null; hub_id: string; hub: string | null; kind: 'present' | 'absent'
    note: string | null; marked_at: string; status: string; site_applied_on: IsoDate | null; site_ref: string | null }>
  missing: Array<{ position: string; count: number; people: Array<{ name: string; code: string | null; hub: string | null }> }>
  explanations: Array<{ id: string; name: string; code: string | null; hub: string | null; reason: ExplainReason; reply: string | null; replied_at: string | null
    final_status: FinalStatus | null; late_time: string | null; absence_app_date: IsoDate | null }>
}
export type MonthCell = '' | 'P' | 'A' | 'O' | 'U'
export type MonthSheet = { hub: { id: string; name: string | null }; month: IsoDate; today: IsoDate; dates: IsoDate[]
  days: Array<{ date: IsoDate; status: 'draft' | 'submitted' }>
  people: Array<{ employee_id: string; code: string | null; name: string; position: string | null; cells: MonthCell[]; present: number; absent: number; off: number }> }

export type ReopenWindow = { id: string; from: IsoDate; to: IsoDate; expires_at: string; reason: string; by: string | null; status: 'open' | 'expired' | 'closed'
  created_at: string; closed_at: string | null; can_close: boolean }
export type MonthCheck = { profile_id: string; name: string | null; sent_at: string; ok_at: string | null; returned_at: string | null; return_reason: string | null }
export type MonthRegister = {
  hub: { id: string; name: string | null }; month: IsoDate; today: IsoDate; from: IsoDate; to: IsoDate; missing: IsoDate[]; days: Record<string, number>
  sub: null | { id: string; version_no: number; at: string; by: string | null; days: Record<string, number> }
  changed: boolean; changed_days: IsoDate[]
  history: Array<{ version_no: number; at: string; by: string | null; days: number }>
  checks: MonthCheck[]; my_check: null | Omit<MonthCheck, 'profile_id' | 'name'>
  can: { submit: boolean; send: boolean }
}
export type VersionLines = { no: number; mode: 'manager' | 'auto'; at: string; by: string | null; date: IsoDate
  lines: Array<{ employee_id: string; code: string | null; name: string; final_status: FinalStatus | null; late_time: string | null; unauthorized: boolean | null; absence_reason: string | null
    absence_app_date: string | null; leave_ref: string | null; online_marked: boolean | null; online_at: string | null; note: string | null }> }

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
  checkReturn: (sheet: string, reason: string) => rpc<void>('att_sheet_check_return', { p_sheet: sheet, p_reason: reason }),
  version: (sheet: string, no: number) => rpc<VersionLines>('att_sheet_version_get', { p_sheet: sheet, p_no: no }),
  reopen: (hub: string, from: IsoDate, to: IsoDate, minutes: number, reason: string) => rpc<{ window: string; opened: number; expires_at: string }>('att_reopen_open', { p_hub: hub, p_from: from, p_to: to, p_minutes: minutes, p_reason: reason }),
  reopenClose: (window: string, note?: string) => rpc<number>('att_reopen_close', { p_window: window, p_note: note ?? null }),
  reopenList: (hub: string) => rpc<ReopenWindow[]>('att_reopen_list', { p_hub: hub }),
  monthGet: (hub: string, month: IsoDate) => rpc<MonthRegister>('att_month_get', { p_hub: hub, p_month: month }),
  monthSubmit: (hub: string, month: IsoDate) => rpc<{ id: string; version_no: number; already: boolean }>('att_month_submit', { p_hub: hub, p_month: month }),
  monthSend: (sub: string) => rpc<number>('att_month_send', { p_sub: sub }),
  monthOk: (sub: string) => rpc<void>('att_month_check_ok', { p_sub: sub }),
  monthReturn: (sub: string, reason: string) => rpc<void>('att_month_check_return', { p_sub: sub, p_reason: reason }),
  mine: (days = 62) => rpc<MyExplanation[]>('att_my_explanations', { p_days: days }),
  reply: (id: string, reply: string) => rpc<void>('att_explain_reply', { p_id: id, p_reply: reply }),
  zoneDay: (zone: string | null, date: IsoDate) => rpc<ZoneDay>('att_zone_day', { p_zone: zone, p_date: date }),
  month: (hub: string, month: IsoDate) => rpc<MonthSheet>('att_month_sheet', { p_hub: hub, p_month: month }),
}

export const LIVE_SHEET = ['att_day_sheets', 'att_day_lines', 'att_explanations', 'att_sheet_checks', 'attendance_self_marks']
export const LIVE_MONTH = ['att_day_sheets']

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

/** The same checks the database makes on submit (private.att_line_gap), so the manager sees what is missing before pressing the button. */
export function lineProblem(p: SheetPerson, v: LineValue, lang: 'bn' | 'en'): string | null {
  const t = (bn: string, en: string) => lang === 'bn' ? bn : en
  if (v.final_status === 'leave' && v.leave_ref) return null                                   // approved leave: nothing to answer
  if (!v.final_status || v.final_status === 'unchecked') return t('হাজিরা বাছুন', 'Choose the attendance')
  if (v.final_status === 'pending_leave') return t('ছুটির আবেদন বিচারাধীন — হাজিরা বাছুন', 'A leave request is waiting — choose the attendance')
  if (p.mark && v.manager_ok === null) return t('হ্যাঁ / না দিন', 'Answer yes / no')
  if (v.final_status === 'late' && !v.late_time) return t('আসার সময় দিন', 'Give the arrival time')
  // marked online is the person's own mark; only a person with none must say why
  if (isPresentLike(v.final_status) && p.mark?.kind !== 'present' && !v.online_reason?.trim()) return t('অনলাইনে হাজিরা নেই — কারণ লিখুন', 'No online attendance — write why')
  if (v.final_status === 'absent' && !v.unauthorized && !v.absence_app_date && !v.absence_reason?.trim()) return t('কারণ বা আবেদনের তারিখ দিন, বা "না জানিয়ে" দিন', 'Give a reason or the application date, or mark "without telling"')
  return null
}
