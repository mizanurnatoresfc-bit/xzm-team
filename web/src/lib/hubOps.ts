// হাব অপারেশন ড্যাশবোর্ড (Hub Operations Dashboard): the zonal manager's hub-wise reports, staff statuses,
// zonal summary and reports to the boss. Every call goes through a database function (hub_ops_*) that checks the
// person's zone / hub rights itself; the tables are not read directly.
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type Attendance = 'present' | 'absent' | 'leave_applied' | 'leave_not_applied'
export type Employment = 'active' | 'new' | 'resigned'
export type ReportStatus = 'pending' | 'submitted' | 'reviewed'
export type PeriodType = 'daily' | 'weekly' | 'monthly'

export type Group = { key: string; bn: string; en: string; core?: boolean; position_ids?: string[]; pattern?: string | null }
export type Hints = {
  register: string | null
  leave: { status: 'pending' | 'approved'; from: string; to: string; type: string } | null
  last: { date: string; employment: Employment; attendance: Attendance | null; hub_id: string } | null
}
export type Person = {
  id: string | null; employee_id: string | null; employee_code: string | null; person_name: string; mobile: string | null
  position_id: string | null; position: string | null; position_en?: string | null; group_key: string
  attendance: Attendance | null; employment: Employment; reason: string | null; remarks: string | null
  hr_status?: string | null; hr_hub_id?: string | null; joining_date?: string | null; in_hr: boolean; hints?: Hints
  /** set on the screen only */
  removed?: boolean; key?: string
}
export type Report = {
  id: string; hub_id: string; zone_id: string; report_date: string; total_parcels: number | null; total_pickups: number | null
  reasons: string[]; remarks: string | null; status: ReportStatus; version: number; last_correction: string | null
  submitted_by_name: string | null; submitted_at: string | null; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null
  updated_at: string
}
export type Panel = {
  hub: { id: string; code: string; name: string; zone_id: string; skip: boolean }
  date: string; today: string; report: Report | null
  rows: Person[]; roster: Person[]; left_before: Array<Pick<Person, 'employee_id' | 'employee_code' | 'person_name' | 'position' | 'group_key' | 'hints'>>
  groups: Group[]; reasons: string[]
  hub_metric: { pickups: number; deliveries: number; pending: number; status: string } | null
  can: { create: boolean; edit: boolean; approve: boolean; hr_edit: boolean }
}
export type AttCount = { present: number; absent: number; leave_applied: number; leave_not_applied: number; not_marked: number }
export type HubSummary = {
  hub_id: string; code: string; name: string; skip: boolean; expected: number; submitted: number; reviewed: number; pending: number
  missing_dates: string[]; pending_dates: string[]; report_id: string | null; status: ReportStatus | null; version: number | null
  total_parcels: number | null; total_pickups: number | null; parcel_days: number; pickup_days: number
  latest_date: string | null; staff_latest: number; staff_active_latest: number; by_group: Record<string, number>
  att: AttCount; resigned: number; new: number; not_in_hr: number; reasons: Record<string, number>
  remarks: Array<{ date: string; text: string }>; roster: number
}
export type PersonSummary = {
  hub_id: string; hub_name: string; employee_id: string | null; employee_code: string | null; person_name: string; group_key: string; position: string | null
  days: number; present: number; absent: number; leave_applied: number; leave_not_applied: number; not_marked: number
  absent_dates: string[]; leave_applied_dates: string[]; leave_not_applied_dates: string[]
  resigned: boolean; resigned_date: string | null; new: boolean; new_date: string | null; hr_status: string | null; in_hr: boolean
  reasons: Array<{ date: string; status: string; reason: string | null; remarks: string | null }>
}
export type ZoneTotals = {
  hubs: number; hubs_expected: number; days: number; expected: number; submitted: number; reviewed: number; pending: number; missing: number
  hubs_reported: number; total_parcels: number | null; total_pickups: number | null; staff_latest: number; staff_active_latest: number; roster: number
  by_group: Record<string, number>; att: AttCount; resigned: number; new: number; not_in_hr: number; reasons: Record<string, number>
}
export type Summary = {
  zone_id: string; zone_name: string; from: string; to: string; today: string; groups: Group[]
  zone: ZoneTotals; hubs: HubSummary[]; people: PersonSummary[]; made_at: string
  can?: { create: boolean; edit: boolean; approve: boolean; configure: boolean; export: boolean }
}
export type BossRow = {
  id: string; zone_id: string; period_type: PeriodType; period_from: string; period_to: string; status: 'submitted' | 'reviewed'; note: string | null; version: number
  submitted_by: string | null; submitted_by_name: string | null; submitted_at: string; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null
  changed_after: boolean
}
export type BossPeriod = { period_type: PeriodType; period_from: string; period_to: string; status: ReportStatus; report: BossRow | null; expected: number; received: number; missing: number; running: boolean }
export type BossView = { period_type: PeriodType; period_from: string; period_to: string; status: ReportStatus; report: BossRow | null; sent: Summary | null; live: Summary
  can: { create: boolean; edit: boolean; approve: boolean; export: boolean } }
export type LogRow = { id: number; status_date: string; hub_id: string; hub_name: string; employee_id: string | null; employee_code: string | null; person_name: string
  field: 'attendance' | 'employment'; from_value: string | null; to_value: string | null; reason: string | null; remarks: string | null
  changed_by_name: string | null; changed_at: string; report_status: ReportStatus }
export type HistoryRow = { id: number; at: string; action: string; table: string; record_id: string; who: string; reason: string | null; fields: string[]
  person: string | null; old: Record<string, unknown> | null; new: Record<string, unknown> | null }
export type Settings = { groups: Group[]; reasons: string[]; skip_hub_ids: string[]; off_days: number[]; week_start: number; custom: boolean
  positions: Array<{ id: string; code: string; name: string; name_bn: string | null; group_key: string }>
  hubs: Array<{ id: string; code: string; name: string }>; can_configure: boolean }
export type Found = { employee_id: string; employee_code: string | null; person_name: string; mobile: string | null; position_id: string | null; position: string | null; hub_id: string | null; hub_name: string | null; status: string }

export type SavePerson = { id?: string | null; employee_id?: string | null; person_name?: string; mobile?: string | null; position_id?: string | null
  attendance: Attendance | null; employment: Employment; reason: string | null; remarks: string | null; removed?: boolean }
export type SaveData = { total_parcels: number | null; total_pickups: number | null; reasons: string[]; remarks: string | null; staff: SavePerson[] }

export const hubOps = {
  panel: (hub: string, date: string) => rpc<Panel>('hub_ops_panel', { p_hub: hub, p_date: date }),
  save: (hub: string, date: string, data: SaveData, submit: boolean, reason: string | null) =>
    rpc<string>('hub_ops_save', { p_hub: hub, p_date: date, p_data: data, p_submit: submit, p_reason: reason }),
  review: (ids: string[], note: string | null) => rpc<number>('hub_ops_review', { p_ids: ids, p_note: note }),
  search: (zone: string, q: string) => rpc<Found[]>('hub_ops_people_search', { p_zone: zone, p_q: q }),
  summary: (zone: string, from: string, to: string) => rpc<Summary>('hub_ops_summary', { p_zone: zone, p_from: from, p_to: to }),
  log: (zone: string, from: string, to: string, hub: string | null, employee: string | null) =>
    rpc<LogRow[]>('hub_ops_status_log', { p_zone: zone, p_from: from, p_to: to, p_hub: hub, p_employee: employee }),
  history: (kind: 'report' | 'boss', id: string) => rpc<HistoryRow[]>('hub_ops_history', { p_kind: kind, p_id: id }),
  bossList: (zone: string, type: PeriodType, count = 12) => rpc<BossPeriod[]>('hub_ops_boss_list', { p_zone: zone, p_type: type, p_count: count }),
  bossGet: (zone: string, type: PeriodType, date: string) => rpc<BossView>('hub_ops_boss_get', { p_zone: zone, p_type: type, p_date: date }),
  bossSubmit: (zone: string, type: PeriodType, date: string, note: string | null) =>
    rpc<string>('hub_ops_boss_submit', { p_zone: zone, p_type: type, p_date: date, p_note: note }),
  bossReview: (id: string, note: string | null) => rpc<void>('hub_ops_boss_review', { p_id: id, p_note: note }),
  settings: (zone: string) => rpc<Settings>('hub_ops_settings', { p_zone: zone }),
  configure: (zone: string, groups: Group[] | null, reasons: string[] | null, skip: string[], off: number[]) =>
    rpc<void>('hub_ops_configure', { p_zone: zone, p_groups: groups, p_reasons: reasons, p_skip_hubs: skip, p_off_days: off }),
  /** HR's own workflow (keeps HR the source of truth for employment): the same function the staff pages use. */
  hrResign: (employee: string, date: string, reason: string) =>
    rpc<void>('hr_change_status', { p_employee: employee, p_status: 'resigned', p_effective: date, p_reason: reason }),
}

/** Labels: [Bangla, English, tone]. */
export const ATT: Record<Attendance, [string, string, 'ok' | 'bad' | 'info' | 'warn']> = {
  present: ['উপস্থিত', 'Present', 'ok'], absent: ['অনুপস্থিত', 'Absent', 'bad'],
  leave_applied: ['ছুটি — আবেদন করেছে', 'Leave applied', 'info'], leave_not_applied: ['ছুটি — আবেদন করেনি', 'Leave not applied', 'warn'],
}
export const ATT_SHORT: Record<Attendance, [string, string]> = {
  present: ['উপস্থিত', 'Present'], absent: ['অনুপস্থিত', 'Absent'], leave_applied: ['ছুটি (আবেদন)', 'Leave (applied)'], leave_not_applied: ['ছুটি (আবেদন নেই)', 'Leave (not applied)'],
}
export const JOB: Record<Employment, [string, string, 'ok' | 'bad' | 'info' | 'neutral']> = {
  active: ['সক্রিয়', 'Active', 'neutral'], new: ['নতুন কর্মী', 'New employee', 'info'], resigned: ['চাকরি ছেড়েছেন', 'Resigned', 'bad'],
}
export const STATUS: Record<ReportStatus, [string, string, 'warn' | 'info' | 'ok']> = {
  pending: ['বাকি', 'Pending', 'warn'], submitted: ['জমা হয়েছে', 'Submitted', 'info'], reviewed: ['দেখা হয়েছে', 'Reviewed', 'ok'],
}
export const PERIOD: Record<PeriodType, [string, string]> = { daily: ['দৈনিক', 'Daily'], weekly: ['সাপ্তাহিক', 'Weekly'], monthly: ['মাসিক', 'Monthly'] }
export const OTHER_GROUP: Group = { key: 'other', bn: 'অন্যান্য', en: 'Other' }
/** The designation group of a post — the same rule as the database (listed post first, then the match words). */
export function groupFor(positionId: string | null, positions: Array<{ id: string; code: string; name: string; name_bn: string | null }>, groups: Group[]): string {
  if (!positionId) return 'other'
  const byId = groups.find(g => (g.position_ids ?? []).includes(positionId))
  if (byId) return byId.key
  const p = positions.find(x => x.id === positionId)
  if (!p) return 'other'
  const txt = `${p.name} ${p.name_bn ?? ''} ${p.code}`
  for (const g of groups) {
    if (!g.pattern) continue
    try { if (new RegExp(g.pattern, 'i').test(txt)) return g.key } catch { /* a pattern JavaScript cannot read: the server decides */ }
  }
  return 'other'
}
export const REGISTER_TO_ATT: Record<string, Attendance | undefined> = { present: 'present', late: 'present', half_day: 'present', absent: 'absent', leave: 'leave_applied' }

const BN: Array<[RegExp, string]> = [
  [/future date/i, 'আগামী দিনের রিপোর্ট দেওয়া যায় না'],
  [/total parcels and total pickups/i, 'জমা দেওয়ার আগে মোট পার্সেল ও মোট পিকআপ লিখুন (না থাকলে ০ লিখুন)'],
  [/why the submitted report is being corrected/i, 'জমা দেওয়া রিপোর্ট বদলাতে কারণ লিখতে হবে'],
  [/already in HR/i, 'এই মানুষটি এইচআর-এ আগে থেকেই আছেন — নতুন করে না লিখে তালিকা থেকে বেছে নিন'],
  [/not in this zone/i, 'এই মানুষটি এই জোনের নন'],
  [/listed twice/i, 'একই মানুষ দুইবার আছেন'],
  [/whole number/i, 'সংখ্যা ০ বা তার বেশি পূর্ণ সংখ্যা হতে হবে'],
  [/review a report you (submitted|sent)/i, 'নিজের জমা দেওয়া রিপোর্ট নিজে দেখা (রিভিউ) যায় না'],
  [/Only submitted reports can be reviewed|already reviewed/i, 'রিপোর্টটি আগেই দেখা হয়েছে বা এখনো জমা হয়নি'],
  [/has not started/i, 'এই সময় এখনো শুরু হয়নি'],
  [/what changed before sending again/i, 'আবার পাঠানোর আগে কী বদলেছে লিখুন'],
  [/must stay/i, 'ম্যানেজার, হাব সিসি ও এন্ট্রি ম্যান গ্রুপ রাখতেই হবে'],
  [/Not authorised|permission denied/i, 'এই কাজের অনুমতি আপনার নেই (শুধু নিজের জোনের হাব)'],
  [/Mobile number/i, 'মোবাইল নম্বর ঠিক নেই'],
  [/Could not find the function|schema cache/i, 'ডাটাবেস এখনো আপডেট হয়নি — হাব অপারেশনের মাইগ্রেশন চালাতে হবে'],
]
export function hubOpsFriendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? hit[1] : msg
}

export const dhakaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
export const shiftDay = (iso: string, days: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
/** null stays "—": a number nobody entered is never shown as 0. */
export const numOr = (v: number | null | undefined, n: (x: number) => string) => v === null || v === undefined ? '—' : n(v)
