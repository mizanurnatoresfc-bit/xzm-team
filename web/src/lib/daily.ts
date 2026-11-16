// Absent list by 11 am (everyone else present), corrections with a note, cover for riders who are out,
// staff day notes, and the zonal manager's day report (sent just after midnight).
import { supabase } from './supabase'
import { HrError } from './hr'
import type { PlaceStatus } from './presence'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export type AttSt = 'present' | 'late' | 'half_day' | 'absent' | 'leave' | 'holiday' | 'weekly_off'
export type SheetRow = { employee_id: string; employee_code: string | null; full_name: string; position: string | null; position_en: string | null
  status: AttSt | null; source: string | null; note: string | null; on_leave: boolean; corrections: number
  self: { kind: 'present' | 'absent'; status: string; note: string | null; place_status: PlaceStatus | null } | null }
export type AbsenceSheet = { work_date: string; today: string; deadline: string; past_deadline: boolean
  submission: { submitted_at: string; by: string | null; late: boolean; absent: number; present: number } | null; staff: SheetRow[] }
export type SheetDay = { delivery: number; pickup: number; amount: number } | null
export type Cover = { id: string; employee_id: string | null; employee_code: string | null; name: string; phone: string | null; note: string | null; by: string | null
  at: string; delivered: number | null; returned: number | null; update_note: string | null; update_at: string | null; sheet: SheetDay }
export type OutRider = { route_id: string; route_name: string; areas: string[]; employee_id: string; employee_code: string | null; full_name: string
  reason: 'leave' | 'absent' | 'half_day'; cover: Cover | null }
export type MyDay = { work_date: string; note: { work: string | null; suggestion: string | null; updated_at: string } | null
  covers: Array<{ id: string; route: string; areas: string[]; for: string; note: string | null; delivered: number | null; sheet: SheetDay }> } | null
export type ZoneReport = { zone_id: string; date: string
  hubs: Array<{ hub_id: string; hub_name: string; staff: number; present: number; late: number; half_day: number; absent: number; leave: number; unmarked: number
    submitted_at: string | null; submitted_by: string | null; late_submit: boolean | null; corrections: number }>
  routes: Array<{ hub_name: string; route_name: string; absent: string; absent_code: string | null; reason: string; cover: string | null; cover_phone: string | null
    assigned_at: string | null; sheet: SheetDay; delivered: number | null; update_note: string | null; problem: 'no_cover' | 'no_update' | null }>
  staff: Array<{ employee_id: string; employee_code: string | null; full_name: string; hub_name: string; position: string | null; attendance: AttSt | null
    sheet: SheetDay; routes: string | null; covered_for: string | null; bills: number; work: string | null; suggestion: string | null }> }

export const ATT_WORD: Record<AttSt, [string, string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  present: ['উপস্থিত', 'Present', 'ok'], late: ['দেরিতে', 'Late', 'warn'], half_day: ['অর্ধদিবস', 'Half day', 'warn'], absent: ['অনুপস্থিত', 'Absent', 'bad'],
  leave: ['ছুটি', 'Leave', 'info'], holiday: ['সরকারি ছুটি', 'Holiday', 'neutral'], weekly_off: ['সাপ্তাহিক ছুটি', 'Weekly off', 'neutral'],
}
export const OUT_WORD: Record<OutRider['reason'], [string, string]> = { leave: ['ছুটিতে', 'On leave'], absent: ['অনুপস্থিত', 'Absent'], half_day: ['অর্ধদিবস', 'Half day'] }

export const daily = {
  sheet: (hub: string, date?: string) => rpc<AbsenceSheet>('hub_absence_sheet', { p_hub: hub, p_date: date ?? null }),
  submit: (hub: string, absent: Array<{ employee_id: string; status: 'absent' | 'late' | 'half_day'; note: string | null }>, note?: string) =>
    rpc<{ absent: number; present: number; late_submit: boolean }>('hub_absence_submit', { p_hub: hub, p_absent: absent, p_note: note || null }),
  correct: (employee: string, date: string, status: 'present' | 'late' | 'half_day' | 'absent', note: string) =>
    rpc<void>('att_correct', { p_employee: employee, p_date: date, p_status: status, p_note: note }),
  covers: (hub: string, date?: string) => rpc<OutRider[]>('route_cover_list', { p_hub: hub, p_date: date ?? null }),
  assign: (route: string, absent: string, code: string, note?: string, date?: string) =>
    rpc<string>('route_cover_assign', { p_route: route, p_absent: absent, p_cover_code: code, p_note: note || null, p_date: date ?? null }),
  coverUpdate: (id: string, delivered: number, returned: number | null, note?: string) =>
    rpc<void>('route_cover_update', { p_id: id, p_delivered: delivered, p_returned: returned, p_note: note || null }),
  myDay: () => rpc<MyDay>('my_day_note'),
  saveMyDay: (work: string, suggestion: string) => rpc<void>('my_day_note_save', { p_work: work, p_suggestion: suggestion }),
  zoneReport: (zone: string, date: string) => rpc<ZoneReport>('zone_daily_report', { p_zone: zone, p_date: date }),
}

const BN: Array<[RegExp, string]> = [
  [/correction note|why it is corrected/i, 'কেন সংশোধন করছেন, নোট লিখুন'], [/own attendance/i, 'নিজের হাজিরা অন্য ম্যানেজার ঠিক করবেন'],
  [/Approved leave/i, 'অনুমোদিত ছুটি এখান থেকে বদলানো যায় না'], [/not working at this hub/i, 'তালিকার কেউ এই হাবের নন'],
  [/No active staff with this ID/i, 'এই আইডির সক্রিয় কাউকে পাওয়া যায়নি'], [/cover must be someone else/i, 'ছুটিতে থাকা রাইডার নিজে রুট নিতে পারেন না'],
  [/not out on this route/i, 'এই রাইডার আজ এই রুটে ছুটিতে / অনুপস্থিত নন'], [/Only today or yesterday/i, 'শুধু আজ বা গতকালের জন্য'],
  [/locked by a submitted/i, 'এই মাসের বেতন শিট জমা হয়ে গেছে — হাজিরা আর বদলানো যায় না'], [/future date/i, 'আগামী দিনের হাজিরা দেওয়া যায় না'],
  [/Write something/i, 'কিছু লিখুন'], [/No active staff profile/i, 'আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই'],
  [/Not authorised|42501|permission denied/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export const dailyFriendly = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return BN.find(([re]) => re.test(m))?.[1] ?? m }
