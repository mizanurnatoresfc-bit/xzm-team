// হাজিরা খাতা (ম্যানেজারের) — typed calls to migration 20261122000900_workforce_manager_book.
//
// THE CONTRACT between the wf_mb_* database functions and the screens (WorkforceHub "হাজিরা বই", WorkforceZone "হাজিরা খাতা",
// the staff's own book). Every rule — who may write which date, day close, zonal correction, submission lock, paid / unpaid —
// is decided in the database; these helpers only call it and give the inputs their Bangla names.
import { supabase } from './supabase'
import { HrError } from './hr'
import type { IsoDate } from './workforce'

/** The seven inputs of one person on one date. */
export type BookCode = 'hub_online' | 'hub_no_online' | 'late' | 'absent_site' | 'absent_no_site' | 'weekly_off' | 'holiday'
export const BOOK_CODES: BookCode[] = ['hub_online', 'hub_no_online', 'late', 'absent_site', 'absent_no_site', 'weekly_off', 'holiday']
export type PaidRule = 'paid' | 'unpaid' | 'quota'

export type BookRules = {
  from_day: number; to_day: number; open: boolean
  paid: Record<BookCode, PaidRule>
  paid_leave_quota: number                 // paid-leave days a month for inputs marked 'quota'
  late_per_deduct: number                  // every N-th late of a month is an unpaid day (0 = off)
  late_after: string                       // 'HH:MI' — shown as a hint when writing a late time
  week_start: number                       // 0 Sunday … 6 Saturday
  format?: FormatCol[]                     // the export columns (company's, or the zone's own)
  own?: boolean                            // the zone has its own values
}
export type FormatCol = { key: string; label: string }

/** One cell. c = input (null = none yet); p = paid; m = missing (should be written); b = a book day;
 *  sg / sr / sn = what the person (or the register) already says — a suggestion only. */
export type MbCell = {
  c: BookCode | null; t: string | null; p: boolean | null; id: string | null; v: number | null
  m: boolean; b: boolean; sg?: BookCode | null; sr?: string | null; sn?: string | null
  sf: IsoDate | null; st: IsoDate | null; ref: string | null; n: string | null
}
export type MbSum = Record<BookCode, number> & { present: number; absent: number; entered: number; paid_days: number; unpaid_days: number; missing: number; book_days: number }
export type MbPerson = { employee_id: string; code: string | null; name: string; position: string | null; mobile: string | null; self?: boolean
  hub_id?: string | null; hub_name?: string | null; cells: MbCell[]; sum: MbSum }
export type MbDay = { date: IsoDate; closed: boolean; closed_at: string | null; closed_how: 'manager' | 'zonal' | null; closed_by_name: string | null
  submitted: boolean; entered: number; missing: number; missing_others: number; future: boolean }
export type MbHub = { id: string; code: string | null; name: string; zone_id: string | null; zone_name: string | null }

/** `wf_mb_book(hub, month)` — the hub manager's book. */
export type MbBook = { hub: MbHub; month: IsoDate; today: IsoDate; rules: BookRules; open: boolean
  can: { view: boolean; write: boolean; close: boolean; zonal: boolean }
  dates: IsoDate[]; days: MbDay[]; people: MbPerson[]; totals: MbSum }

/** `wf_mb_sheet(zone, hub, from, to)` — everyone of the zone, by name and date. */
export type MbSheet = { from: IsoDate; to: IsoDate; today: IsoDate; zone: { id: string; name: string } | null; rules: BookRules
  can: { submit: boolean; correct: boolean }; dates: IsoDate[]
  hubs: Array<{ id: string; name: string; zone_id: string; people: number; missing: number; closed: IsoDate[] }>
  people: MbPerson[]; totals: MbSum
  submissions: Array<{ id: string; zone_id: string; kind: 'week' | 'month'; date_from: IsoDate; date_to: IsoDate; submitted_at: string; by_name: string | null }> }

export type MbSubmission = { id: string; zone_id: string; zone_name: string | null; kind: 'week' | 'month'; date_from: IsoDate; date_to: IsoDate
  note: string | null; totals: MbSum; submitted_at: string; by_name: string | null
  reopened_at: string | null; reopen_note: string | null; reopened_by_name: string | null; snapshot: MbSheet | null }

export type MbRulesPage = {
  zone: { id: string; name: string } | null
  company: { rules: Partial<BookRules>; format: FormatCol[]; updated_at: string } | null
  own: { rules: Partial<BookRules>; format: FormatCol[]; updated_at: string; by_name: string | null } | null
  effective: BookRules; can_configure: boolean; can_company: boolean
  zones: Array<{ id: string; name: string; can_configure: boolean }>
}
export type MbHistory = { id: string; entry_id: string; employee_id: string; employee_name: string; employee_code: string | null; work_date: IsoDate
  revision: number; action: 'created' | 'changed' | 'corrected'; before: MbEntryInput | null; after: MbEntryInput; reason: string | null; by_name: string | null; at: string }
export type MbEntryInput = { code: BookCode; late_at?: string | null; site_from?: IsoDate | null; site_to?: IsoDate | null; site_ref?: string | null; note?: string | null }
export type MbItem = MbEntryInput & { employee_id: string }
export type MbMine = { month: IsoDate; today: IsoDate; rules: BookRules
  days: Array<{ date: IsoDate; c: BookCode | null; t: string | null; p: boolean | null; m: boolean; b: boolean; ref: string | null; sf: IsoDate | null; st: IsoDate | null; n: string | null }>
  sum: MbSum }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export const mb = {
  rules: (zone: string | null) => rpc<MbRulesPage>('wf_mb_rules_get', { p_zone: zone }),
  saveRules: (zone: string | null, rules: Partial<BookRules>, format?: FormatCol[] | null, reset = false) =>
    rpc<BookRules>('wf_mb_rules_save', { p_zone: zone, p_rules: rules, p_format: format ?? null, p_reset: reset }),
  book: (hub: string, month?: IsoDate | null) => rpc<MbBook>('wf_mb_book', { p_hub: hub, p_month: month ?? null }),
  set: (hub: string, date: IsoDate, items: MbItem[], reason?: string | null) =>
    rpc<number>('wf_mb_set', { p_hub: hub, p_date: date, p_items: items, p_reason: reason?.trim() || null }),
  close: (hub: string, date: IsoDate, note?: string | null) => rpc<MbSum>('wf_mb_close', { p_hub: hub, p_date: date, p_note: note?.trim() || null }),
  history: (hub: string, employee?: string | null, month?: IsoDate | null) =>
    rpc<MbHistory[]>('wf_mb_history', { p_hub: hub, p_employee: employee ?? null, p_month: month ?? null, p_limit: 300 }),
  sheet: (zone: string | null, hub: string | null, from: IsoDate, to: IsoDate) =>
    rpc<MbSheet>('wf_mb_sheet', { p_zone: zone, p_hub: hub, p_from: from, p_to: to }),
  submit: (zone: string, kind: 'week' | 'month', from: IsoDate, note?: string | null) =>
    rpc<string>('wf_mb_submit', { p_zone: zone, p_kind: kind, p_from: from, p_note: note?.trim() || null }),
  submissions: (zone: string | null, id?: string | null) => rpc<MbSubmission[]>('wf_mb_submissions', { p_zone: zone, p_id: id ?? null }),
  reopen: (id: string, note: string) => rpc<void>('wf_mb_reopen', { p_id: id, p_note: note }),
  mine: (month?: IsoDate | null) => rpc<MbMine | null>('wf_mb_mine', { p_month: month ?? null }),
  /** The leave application's photo: upload to wf-leave/<employee_id>/…, then put it on the (pending) application. */
  async attachPhoto(employeeId: string, applicationId: string, file: File) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
    const path = `${employeeId}/${applicationId}-${Date.now()}.${ext}`
    const up = await supabase.storage.from('wf-leave').upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (up.error) throw new HrError(up.error.message, '')
    await rpc<void>('wf_absence_photo', { p_application: applicationId, p_path: path })
    return path
  },
  photos: (ids: string[]) => rpc<Record<string, string>>('wf_absence_photos', { p_ids: ids }),
  async photoUrl(path: string) {
    const { data, error } = await supabase.storage.from('wf-leave').createSignedUrl(path, 300)
    if (error) throw new HrError(error.message, '')
    return data.signedUrl
  },
}

/** Names of the inputs: long (sheet, setting) and short (one grid cell). Tone = colour of the cell. */
export const CODE_META: Record<BookCode, { bn: string; en: string; short: string; shortEn: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; group: 'present' | 'absent' | 'off' }> = {
  hub_online: { bn: 'হাবে উপস্থিত + অনলাইন হাজিরা', en: 'At hub + online attendance', short: 'উ', shortEn: 'P', tone: 'ok', group: 'present' },
  hub_no_online: { bn: 'হাবে উপস্থিত, অনলাইন হাজিরা হয়নি', en: 'At hub, no online attendance', short: 'উ*', shortEn: 'P*', tone: 'warn', group: 'present' },
  late: { bn: 'লেট (সময়সহ)', en: 'Late (with time)', short: 'লে', shortEn: 'L', tone: 'warn', group: 'present' },
  absent_site: { bn: 'অনুপস্থিত — ওয়েবসাইটে আবেদন আছে', en: 'Absent — website application given', short: 'ছু', shortEn: 'A✓', tone: 'info', group: 'absent' },
  absent_no_site: { bn: 'অনুপস্থিত — ওয়েবসাইটে আবেদন নেই', en: 'Absent — no website application', short: 'অ', shortEn: 'A', tone: 'bad', group: 'absent' },
  weekly_off: { bn: 'সাপ্তাহিক ছুটি', en: 'Weekly off', short: 'সা', shortEn: 'W', tone: 'neutral', group: 'off' },
  holiday: { bn: 'সরকারি ছুটি', en: 'Holiday', short: 'স', shortEn: 'H', tone: 'neutral', group: 'off' },
}
export const PAID_META: Record<PaidRule, { bn: string; en: string }> = {
  paid: { bn: 'পেইড (বেতনসহ)', en: 'Paid' }, unpaid: { bn: 'নন-পেইড (বেতন কাটা)', en: 'Unpaid' }, quota: { bn: 'পেইড ছুটির কোটা থেকে', en: 'From the paid-leave quota' },
}

/** Every column the company's export format may hold (key → default Bangla / English heading). "days" = one column per date. */
export const FORMAT_CATALOG: Array<{ key: string; bn: string; en: string }> = [
  { key: 'code', bn: 'আইডি', en: 'ID' }, { key: 'name', bn: 'নাম', en: 'Name' }, { key: 'position', bn: 'পদবি', en: 'Designation' },
  { key: 'hub', bn: 'হাব', en: 'Hub' }, { key: 'mobile', bn: 'মোবাইল', en: 'Mobile' }, { key: 'days', bn: 'প্রতিটি তারিখ', en: 'Each date' },
  { key: 'present', bn: 'মোট উপস্থিত', en: 'Present' }, { key: 'hub_online', bn: 'উপস্থিত + অনলাইন', en: 'Present + online' },
  { key: 'hub_no_online', bn: 'অনলাইন হাজিরা হয়নি', en: 'No online attendance' }, { key: 'late', bn: 'লেট', en: 'Late' },
  { key: 'late_times', bn: 'লেটের সময়', en: 'Late times' }, { key: 'absent', bn: 'মোট অনুপস্থিত', en: 'Absent' },
  { key: 'absent_site', bn: 'ছুটি (ওয়েবসাইট আবেদন)', en: 'Leave (website)' }, { key: 'absent_no_site', bn: 'অনুপস্থিত (আবেদন নেই)', en: 'Absent (no application)' },
  { key: 'site_refs', bn: 'ওয়েবসাইট আবেদন নম্বর', en: 'Website application numbers' },
  { key: 'weekly_off', bn: 'সাপ্তাহিক ছুটি', en: 'Weekly off' }, { key: 'holiday', bn: 'সরকারি ছুটি', en: 'Holiday' },
  { key: 'paid_days', bn: 'পেইড দিন', en: 'Paid days' }, { key: 'unpaid_days', bn: 'নন-পেইড দিন', en: 'Unpaid days' },
  { key: 'missing', bn: 'লেখা বাকি', en: 'Not written' }, { key: 'entered', bn: 'লেখা হয়েছে', en: 'Written' },
]

/** One person's row in the company's format: `heads` and `cells` for Excel / print. */
export function formatRows(format: FormatCol[], people: MbPerson[], dates: IsoDate[], lang: 'bn' | 'en') {
  const cols = format.length ? format : FORMAT_CATALOG.filter(c => c.key !== 'mobile').map(c => ({ key: c.key, label: '' }))
  const nameOf = (key: string, label: string) => label || (FORMAT_CATALOG.find(c => c.key === key)?.[lang] ?? key)
  const heads: string[] = []
  for (const c of cols) {
    if (c.key === 'days') heads.push(...dates.map(d => `${Number(d.slice(8))}`))
    else heads.push(nameOf(c.key, c.label))
  }
  const short = (x: MbCell) => !x.c ? (x.m ? '?' : '') : `${lang === 'bn' ? CODE_META[x.c].short : CODE_META[x.c].shortEn}${x.c === 'late' && x.t ? ` ${x.t}` : ''}`
  const rows = people.map(p => {
    const out: Array<string | number | null> = []
    for (const c of cols) {
      switch (c.key) {
        case 'code': out.push(p.code); break
        case 'name': out.push(p.name); break
        case 'position': out.push(p.position); break
        case 'hub': out.push(p.hub_name ?? null); break
        case 'mobile': out.push(p.mobile); break
        case 'days': out.push(...p.cells.map(short)); break
        case 'late_times': out.push(p.cells.map((x, i) => x.c === 'late' ? `${Number(dates[i].slice(8))}: ${x.t ?? ''}` : null).filter(Boolean).join(', ')); break
        case 'site_refs': out.push([...new Set(p.cells.map(x => x.ref).filter(Boolean))].join(', ')); break
        default: out.push((p.sum as Record<string, number>)[c.key] ?? null)
      }
    }
    return out
  })
  return { heads, rows }
}

const BN: Array<[RegExp, string]> = [
  [/not one of the book's days/i, 'এটি খাতার দিন নয় — সেটিং দেখুন'],
  [/already submitted this date/i, 'জোনাল ম্যানেজার এই তারিখ সাবমিট করেছেন — আর বদলানো যায় না'],
  [/This day is closed/i, 'এই দিনের খাতা ক্লোজ হয়েছে — এখন জোনাল ম্যানেজার সংশোধন করবেন'],
  [/already closed/i, 'এই দিনের খাতা আগেই ক্লোজ হয়েছে'],
  [/people still have no input/i, ''],
  [/closed the book/i, 'জোনাল ম্যানেজার খাতা বন্ধ রেখেছেন'],
  [/Only this month's book/i, 'শুধু এই মাসের খাতা লেখা যায় — আগের মাস জোনাল ম্যানেজার সংশোধন করবেন'],
  [/Write why this closed day/i, 'ক্লোজ হওয়া দিনের সংশোধনের কারণ লিখুন'],
  [/Write the time they came/i, 'কখন এসেছেন সেই সময় লিখুন (যেমন 10:15)'],
  [/website application's dates/i, 'ওয়েবসাইটের আবেদনের তারিখ (থেকে – পর্যন্ত) দিন'],
  [/must include this date/i, 'আবেদনের তারিখের মধ্যে এই দিনটি থাকতে হবে'],
  [/Your own attendance is written/i, 'নিজের হাজিরা অন্য কেউ লিখবেন'],
  [/period has not ended/i, 'সময়টি এখনো শেষ হয়নি'],
  [/already submitted —|period is already submitted/i, 'এই সময়ের খাতা আগেই সাবমিট হয়েছে'],
  [/inputs are still missing/i, ''],
]
/** Plain Bangla for a database refusal; an empty rule means "the database's own Bangla after the dash is better" (it carries the count). */
export function mbFriendly(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  const hit = BN.find(([re]) => re.test(m))
  if (hit && hit[1]) return hit[1]
  const tail = m.split(' — ').slice(1).join(' — ').trim()
  if (/[ঀ-৿]/.test(tail)) return hit ? `${tail}${/: (.+?) —/.exec(m)?.[1] ? ` (${/: (.+?) —/.exec(m)![1]})` : ''}` : tail
  if (/may not|42501|permission denied/i.test(m)) return 'এই কাজের অনুমতি আপনার নেই'
  if (/JWT|Failed to fetch|NetworkError|timeout|Load failed/i.test(m)) return 'যোগাযোগে সমস্যা হয়েছে — আবার চেষ্টা করুন'
  return m
}

export const LIVE_BOOK = ['wf_book_entries', 'wf_book_days', 'wf_book_submissions', 'attendance_self_marks']
