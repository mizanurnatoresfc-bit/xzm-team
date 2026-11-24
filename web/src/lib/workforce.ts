// My Workforce & Attendance — typed calls to the database functions of migration 20261117010000_workforce_attendance.
//
// THIS FILE IS THE CONTRACT between the database functions (supabase/migrations/…workforce_attendance.sql) and every
// screen of the module (pages/workforce/*, components/PersonalMenu, components/DailyOpsCard …). Keep the two in step:
// a function listed here must return exactly these keys. Every rule (window, duplicates, scope, approval) is enforced
// in the database; these helpers only call it, read live changes and turn errors into readable Bangla.
//
// Nothing new is stored twice: a staff member's per-date input is a row of the existing `attendance_self_marks`
// (the same row the hub manager already approves on the hub page); the register stays `attendance_records`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { HrError } from './hr'

// ------------------------------------------------------------------ small shared things
/** Dhaka today / date maths come from dailyAccounts (`todayDhaka`, `addDays`). Month = 'YYYY-MM-01'. */
export type IsoDate = string
export type Kind = 'present' | 'absent'
export type Decided = 'present' | 'late' | 'half_day' | 'absent'
export type AppStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type MarkStatus = 'waiting' | 'approved' | 'rejected'

/** What one date of the book looks like to the staff member. */
export type DayState =
  | 'missing'    // the date has come, the book is open, nothing given yet  -> shows as "বাকি"
  | 'waiting'    // given, waits for the manager
  | 'approved'   // on the register (approved, or written by the manager)
  | 'returned'   // the manager turned it down: give it again
  | 'future'     // the date has not come yet
  | 'closed'     // the book is closed for this month and nothing was given

export type Scope = { hub_id: string | null; hub_name: string | null; zone_id: string | null; zone_name: string | null }

export type BookDay = {
  date: IsoDate; day: number; dow: number            // dow 0 = Sunday … 6 = Saturday
  state: DayState
  kind: Kind | null                                  // what the staff member gave (null = nothing / manager wrote it)
  applied_on_site: boolean | null                    // "ওয়েবসাইটে আবেদন করেছেন?" answer, for an absent day
  /** Absent and applied on the website: the day applied there and the website's application number. Migration 20261118210000. */
  site_applied_on: IsoDate | null; site_ref: string | null
  note: string | null                                // the staff member's own note / reason
  mark_id: string | null
  decided_as: Decided | null; decide_note: string | null; decided_by_name: string | null
  record_status: string | null                       // attendance_records.status for the date (present, late, half_day, absent, leave, holiday, weekly_off), whoever wrote it
  application_id: string | null; application_no: string | null; application_status: AppStatus | null
  /** may this date be given (or changed) now: this month's open book, or an earlier date the zonal manager opened. Migration 20261118200000. */
  can_give?: boolean
}

/** আগের তারিখ খোলা — earlier dates of the book a zonal manager opened for one zone (`wf_book_windows`). */
export type WindowState = 'open' | 'expired' | 'ended'
export type BookWindow = {
  id: string; zone_id: string; zone_name: string | null
  month: IsoDate; date_from: IsoDate; date_to: IsoDate; open_until: IsoDate; note: string | null
  state: WindowState; by_name: string | null; created_at: string
  ended_at: string | null; ended_by_name: string | null; end_note: string | null
}
/** A row of the zonal setting page; the progress numbers are filled for an open window only (null otherwise). */
export type WindowRow = BookWindow & { people: number | null; people_left: number | null; days_left: number | null; days_waiting: number | null }
/** `wf_windows(p_zone)` — the zonal setting page. */
export type WindowsPage = {
  today: IsoDate; window: { from_day: number; to_day: number }
  earliest: IsoDate                                  // the first date that may be opened (two months back)
  latest_until: IsoDate                              // the last "open until" day allowed (31 days ahead)
  zones: Array<{ id: string; name: string; can_configure: boolean }>
  rows: WindowRow[]                                  // open ones first, then the latest history (30 rows at most)
}
/** One application made on the (Steadfast) website: the day it was made and the website's application number. */
export type SiteApplication = { applied_on: IsoDate; ref: string }
/** `wf_book_fill(p_site)` — one website application and the absent dates it covers. */
export type SiteGroup = SiteApplication & { dates: IsoDate[] }

/** `wf_book_fill(...)` — how many dates of each kind were saved; the new application when some dates needed one. */
export type FillResult = { present: number; site: number; absent: number; application_id: string | null }

export type BookSummary = { present: number; late: number; half_day: number; absent: number; leave: number; other: number
  waiting: number; returned: number; missing: number; total_days: number }

export type AbsenceApp = {
  id: string; application_no: string                   // AB-00001 …
  employee_id: string; employee_code: string | null; employee_name: string
  hub_id: string | null; hub_name: string | null; zone_id: string | null; zone_name: string | null
  month: IsoDate; dates: IsoDate[]; reason: string
  status: AppStatus; created_at: string
  decided_at: string | null; decided_by_name: string | null; decision_note: string | null
  cancelled_at: string | null
}

/** `wf_my_book(p_month)` — one call loads a staff member's whole book for a month. */
export type MyBook = {
  employee: { id: string; code: string | null; name: string; position: string | null } & Scope
  month: IsoDate; today: IsoDate
  window: { from_day: number; to_day: number }       // default 1 … 17 (settings workforce.book_from_day / book_to_day)
  open: boolean                                      // dates of this month can be given now: today is inside this month's window, or a window opened it
  catch_up?: BookWindow | null                       // the earlier dates the zonal manager opened for this month (null when none)
  open_months?: IsoDate[]                            // every month in which something can be given right now, newest first
  days: BookDay[]                                    // every date of the window, in order (including future ones)
  summary: BookSummary
  applications: AbsenceApp[]                         // my applications that touch this month
  months: IsoDate[]                                  // archive picker: months with anything of mine, newest first; always includes the current month
}

// ------------------------------------------------------------------ daily operations (the four numbers)
export type DailyOps = {
  id: string
  employee_id: string; employee_code: string | null; employee_name: string; position: string | null
  hub_id: string | null; hub_name: string | null; zone_id: string | null; zone_name: string | null
  work_date: IsoDate
  pickup: number; pickup_return: number; delivery: number; delivery_return: number
  note: string | null; revision: number              // 1 on first submit, +1 each time the person (or a manager) changes it
  submitted_at: string; updated_at: string
}
/** `wf_ops_mine(p_days)`. `hint` = what the person already sent to the manager's sheet today (read only, never copied). */
export type MyOps = {
  today: IsoDate; backdate_days: number; entry: DailyOps | null; recent: DailyOps[]
  hint: { pickup: number; delivery: number; lines: number } | null
}
export type OpsInput = { pickup: number; pickup_return: number; delivery: number; delivery_return: number }
/** `wf_ops_taps(p_date)` — one person's own taps for one date (each "সাবমিট" adds to the day's total). Newest tap first. */
export type OpsTaps = { date: IsoDate; count: number; total: OpsInput | null; taps: Array<OpsInput & { at: string; note: string | null }> }

// ------------------------------------------------------------------ manager (one hub) and zonal manager (many hubs)
export type HubRef = { id: string; code: string | null; name: string; zone_id: string | null; zone_name: string | null }
/** The caller's abilities in that hub: the screen shows or hides buttons from these; the database re-checks every call. */
export type Can = { attendance: boolean; decide: boolean; correct: boolean; ops: boolean; ops_edit: boolean }

export type HubPerson = {
  employee_id: string; code: string | null; name: string; position: string | null; mobile: string | null; is_rider: boolean
  record_status: string | null                       // today's register row, if any
  mark_kind: Kind | null; mark_status: MarkStatus | null   // today's own input, if any
  ops_submitted: boolean | null                      // null when the caller may not see ops
}
/** `wf_hub_overview(p_hub, p_date)` */
export type HubOverview = {
  hub: HubRef; date: IsoDate; can: Can; staff_total: number
  attendance: { present: number; late: number; half_day: number; absent: number; leave: number; other: number; not_given: number; waiting_marks: number; returned_marks: number }
  pending: { marks: number; applications: number }   // waiting inputs of the whole open window; applications waiting for a decision
  ops: null | { submitted: number; missing: number; pickup: number; pickup_return: number; delivery: number; delivery_return: number }
  people: HubPerson[]
}

/** `wf_marks(...)` — the approval queue / list of staff inputs (rows of attendance_self_marks). */
export type Mark = {
  id: string; employee_id: string; employee_code: string | null; full_name: string; position: string | null
  hub_id: string | null; hub_name: string | null; zone_id: string | null
  work_date: IsoDate; kind: Kind; applied_on_site: boolean | null; note: string | null
  site_applied_on: IsoDate | null; site_ref: string | null      // the website application's date and number (migration 20261118210000)
  status: MarkStatus; via: 'today' | 'book'; marked_at: string
  decided_as: Decided | null; decide_note: string | null; decided_at: string | null; decided_by_name: string | null
  application_id: string | null; application_no: string | null; record_status: string | null
}

export type HistoryAction = 'submitted' | 'edited' | 'resubmitted' | 'approved' | 'returned' | 'corrected' | 'cancelled'
/** `wf_att_history(...)` — append-only correction history. */
export type History = {
  id: string; mark_id: string | null; employee_id: string; employee_code: string | null; employee_name: string
  hub_id: string | null; hub_name: string | null; work_date: IsoDate
  action: HistoryAction
  from_kind: Kind | null; to_kind: Kind | null; from_status: MarkStatus | null; to_status: MarkStatus | null
  from_as: Decided | null; to_as: Decided | null; note: string | null; by_name: string | null; at: string
}

export type OpsTotals = { pickup: number; pickup_return: number; delivery: number; delivery_return: number }
/** `wf_ops_report(p_zone, p_hub, p_from, p_to)` */
export type OpsReport = {
  from: IsoDate; to: IsoDate; today: IsoDate; can_edit: boolean
  rows: DailyOps[]                                   // newest date first, then name
  totals: OpsTotals & { entries: number; people: number }
  by_person: Array<{ employee_id: string; code: string | null; name: string; position: string | null; hub_id: string | null; hub_name: string | null; days: number } & OpsTotals>
  by_day: Array<{ date: IsoDate; people: number } & OpsTotals>
  missing_today: Array<{ employee_id: string; code: string | null; name: string; position: string | null; hub_id: string | null; hub_name: string | null; mobile: string | null }>
}
export type OpsHistory = {
  id: string; entry_id: string; work_date: IsoDate; employee_name: string; revision: number
  from: OpsTotals | null; to: OpsTotals; note: string | null; by_name: string | null; at: string
}

/** `wf_pending_counts()` — the small alert numbers for the personal menu, staff panel, dashboard and bell. */
export type PendingCounts = {
  today: IsoDate; open: boolean
  mine: null | { missing_days: number; returned_days: number; waiting_days: number; applications_pending: number
    ops_expected: boolean; ops_submitted_today: boolean     // null when the login has no active staff profile
    catch_up_until?: IsoDate | null }                       // the last day of an open window of the person's zone (missing_days includes its dates)
  manage: null | { marks_waiting: number; applications_pending: number; ops_missing_today: number }   // null when the caller manages nobody
}

// ------------------------------------------------------------------ calls
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}
type Range = { zone?: string | null; hub?: string | null }

/** `wf_book_mode()` — the "whole month (1–31)" switch and the normal book days it falls back to. */
export type BookMode = { full_month: boolean; from_day: number; to_day: number; normal_from_day: number; normal_to_day: number
  can_set: boolean; changed_at: string | null; changed_by_name: string | null }

export const wf = {
  // staff — attendance book
  myBook: (month?: IsoDate | null) => rpc<MyBook | null>('wf_my_book', { p_month: month ?? null }),
  /** present, or absent with `appliedOnSite = true` plus the website application (its date and number, both required).
   *  Absent with `false` goes through `apply` (it needs dates and a reason). */
  submit: (date: IsoDate, kind: Kind, appliedOnSite?: boolean | null, note?: string | null, site?: SiteApplication | null) =>
    rpc<string>('wf_att_submit', { p_date: date, p_kind: kind, p_applied_on_site: appliedOnSite ?? null, p_note: note || null,
      p_site_date: site?.applied_on || null, p_site_ref: site?.ref.trim() || null }),
  apply: (dates: IsoDate[], reason: string) => rpc<string>('wf_absence_apply', { p_dates: dates, p_reason: reason }),
  cancelApplication: (id: string) => rpc<void>('wf_absence_cancel', { p_application: id }),
  /** Many dates in one step, all or nothing: present, absent with "applied on the Steadfast website", and absent without applying (one application). */
  fill: (f: { present: IsoDate[]; site: SiteGroup[]; absent: IsoDate[]; reason?: string | null; note?: string | null }) =>
    rpc<FillResult>('wf_book_fill', { p_present: f.present, p_site: f.site, p_absent: f.absent, p_reason: f.reason || null, p_note: f.note || null }),
  // zonal setting — earlier dates of the book for one zone
  windows: (zone?: string | null) => rpc<WindowsPage>('wf_windows', { p_zone: zone ?? null }),
  windowSave: (zone: string, from: IsoDate, to: IsoDate, until: IsoDate, note?: string | null) =>
    rpc<string>('wf_window_save', { p_zone: zone, p_from: from, p_to: to, p_until: until, p_note: note || null }),
  windowEnd: (id: string, note?: string | null) => rpc<void>('wf_window_end', { p_window: id, p_note: note || null }),
  // company-wide switch: the book open on every day of the month (1–31); only the Super Admin flips it
  bookMode: () => rpc<BookMode>('wf_book_mode'),
  bookFullMonth: (on: boolean, note?: string | null) => rpc<BookMode>('wf_book_full_month_set', { p_on: on, p_note: note || null }),
  // staff — the four numbers
  myOps: (days = 14) => rpc<MyOps | null>('wf_ops_mine', { p_days: days }),
  submitOps: (v: OpsInput, note?: string | null, date?: IsoDate | null) =>
    rpc<DailyOps>('wf_ops_submit', { p_pickup: v.pickup, p_pickup_return: v.pickup_return, p_delivery: v.delivery, p_delivery_return: v.delivery_return,
      p_note: note || null, p_date: date ?? null }),
  /** One tap: ADDS the four numbers to the day's total (empty = 0). */
  addOps: (v: OpsInput, note?: string | null, date?: IsoDate | null) =>
    rpc<DailyOps>('wf_ops_add', { p_pickup: v.pickup, p_pickup_return: v.pickup_return, p_delivery: v.delivery, p_delivery_return: v.delivery_return,
      p_note: note || null, p_date: date ?? null }),
  opsTaps: (date?: IsoDate | null) => rpc<OpsTaps | null>('wf_ops_taps', { p_date: date ?? null }),
  counts: () => rpc<PendingCounts>('wf_pending_counts'),
  // manager / zonal manager — everything is limited to the hubs the caller may see
  hubOverview: (hub: string, date?: IsoDate | null) => rpc<HubOverview>('wf_hub_overview', { p_hub: hub, p_date: date ?? null }),
  marks: (r: Range, from: IsoDate, to: IsoDate, status?: MarkStatus | null) =>
    rpc<Mark[]>('wf_marks', { p_zone: r.zone ?? null, p_hub: r.hub ?? null, p_from: from, p_to: to, p_status: status ?? null }),
  applications: (r: Range, status?: AppStatus | null, month?: IsoDate | null) =>
    rpc<AbsenceApp[]>('wf_applications', { p_zone: r.zone ?? null, p_hub: r.hub ?? null, p_status: status ?? null, p_month: month ?? null }),
  decideApplication: (id: string, ok: boolean, note?: string | null) => rpc<number>('wf_absence_decide', { p_application: id, p_ok: ok, p_note: note || null }),
  history: (r: Range & { employee?: string | null }, month?: IsoDate | null, limit = 200) =>
    rpc<History[]>('wf_att_history', { p_zone: r.zone ?? null, p_hub: r.hub ?? null, p_employee: r.employee ?? null, p_month: month ?? null, p_limit: limit }),
  opsReport: (r: Range, from: IsoDate, to: IsoDate) => rpc<OpsReport>('wf_ops_report', { p_zone: r.zone ?? null, p_hub: r.hub ?? null, p_from: from, p_to: to }),
  correctOps: (id: string, v: OpsInput, note: string) =>
    rpc<void>('wf_ops_correct', { p_id: id, p_pickup: v.pickup, p_pickup_return: v.pickup_return, p_delivery: v.delivery, p_delivery_return: v.delivery_return, p_note: note }),
  opsHistory: (entry: string) => rpc<OpsHistory[]>('wf_ops_history', { p_entry: entry }),
}

// ------------------------------------------------------------------ errors in plain Bangla
const BN: Array<[RegExp, string]> = [
  [/morning input is locked/i, 'সকালের ইনপুট জমা হয়ে লক হয়েছে — জোনাল ম্যানেজার ফেরত না দিলে বদলানো যায় না'],
  [/morning input of this hub is not submitted/i, 'এই হাবের সকালের ইনপুট এখনো জমা হয়নি — আগে সেটা জমা হতে হবে'],
  [/morning input is for today/i, 'সকালের ইনপুট শুধু আজ বা আগের দুই দিনের'],
  [/no submitted morning input to send back/i, 'ফেরত পাঠানোর মতো জমা দেওয়া সকালের ইনপুট নেই'],
  [/why the morning input goes back/i, 'সকালের ইনপুট কেন ফেরত যাচ্ছে তার কারণ লিখুন'],
  [/is not available today/i, 'রুট প্ল্যানের একজন রাইডার আজ উপস্থিত নন বা ছুটিতে আছেন — রাইডার বদলে আবার অনুমোদন করুন'],
  [/present, absent or unchecked/i, 'প্রত্যেকের অবস্থা এসেছে, আসেনি বা যাচাই বাকি — এই তিনটির একটি'],
  [/cut-off and its extra minutes/i, 'সকালের কাট-অফ ও অতিরিক্ত মিনিট একই দিনে শেষ হতে হবে'],
  [/already on the register/i, 'এই তারিখের হাজিরা আগেই খাতায় উঠেছে'],
  [/already approved/i, 'এই তারিখের হাজিরা আগেই অনুমোদিত — বদলাতে ম্যানেজারকে বলুন'],
  [/book is closed/i, 'এই তারিখের হাজিরা বই বন্ধ — বই শুধু মাসের নির্দিষ্ট দিনগুলোতে চালু থাকে, আগের তারিখ শুধু জোনাল ম্যানেজার খুলে দিলে দেওয়া যায়'],
  [/whole month/i, 'শুধু সুপার অ্যাডমিন হাজিরা বই পুরো মাস খুলতে বা বন্ধ করতে পারেন'],
  [/chosen twice/i, 'একই তারিখ দুই জায়গায় বাছা হয়েছে'],
  [/future/i, 'আগামী তারিখের হাজিরা এখন দেওয়া যায় না'],
  [/website question|applied on site/i, 'ওয়েবসাইটে আবেদন করেছেন কি না — আগে সেটা বলুন'],
  [/website application number is too long/i, 'ওয়েবসাইটের আবেদন নম্বর সর্বোচ্চ ৬০ অক্ষর'],
  [/application number/i, 'ওয়েবসাইটের আবেদন নম্বর লিখুন'],
  [/date you applied/i, 'ওয়েবসাইটে কোন তারিখে আবেদন করেছেন — সেই তারিখ দিন'],
  [/application date cannot be after today/i, 'আবেদনের তারিখ আজকের পরে হতে পারে না'],
  [/more than 62 days before/i, 'আবেদনের তারিখ অনুপস্থিতির ৬২ দিনের বেশি আগে হতে পারে না'],
  [/needs an application|use wf_absence_apply/i, 'ওয়েবসাইটে আবেদন না করে থাকলে অনুপস্থিতির তারিখ বেছে আবেদন পাঠান'],
  [/already in an application/i, 'এই তারিখ আরেকটি আবেদনে আছে'],
  [/write the reason|reason is required/i, 'কারণ লিখুন'],
  [/No active staff profile/i, 'আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই'],
  [/Your own attendance is corrected/i, 'নিজের হাজিরা অন্য ম্যানেজার সংশোধন করবেন'],
  [/Your own attendance/i, 'নিজের হাজিরা অন্য ম্যানেজার অনুমোদন দেবেন'],
  [/Write why it is turned down/i, 'কেন ফেরত দিচ্ছেন, লিখুন'],
  [/correction note/i, 'সংশোধনের কারণ লিখুন'],
  [/too long/i, 'লেখা খুব বড় — সর্বোচ্চ ৫০০ অক্ষর'],
  [/four numbers/i, 'চারটি সংখ্যাই দিন (০ও চলবে)'],
  [/corrected them|already approved, so it can no longer/i, 'ম্যানেজার এটা সংশোধন করেছেন — বদলাতে ম্যানেজারকে বলুন'],
  [/at most 100000/i, 'সংখ্যা এক লাখের বেশি হতে পারে না'],
  [/numbers must be|non-negative|negative/i, 'সংখ্যা ০ বা তার বেশি হতে হবে'],
  [/schema cache|PGRST20\d|Could not find the function/i, 'এই সুবিধা এখনো চালু হয়নি — একটু পরে চেষ্টা করুন'],
  [/JWT|Failed to fetch|NetworkError|timeout|upstream|Load failed/i, 'যোগাযোগে সমস্যা হয়েছে — আবার চেষ্টা করুন'],
]
/** The database writes its own Bangla after a dash ("English — বাংলা"). When no rule above fits, show that Bangla part. */
const banglaTail = (m: string): string | null => {
  const t = m.split(' — ').slice(1).join(' — ').trim()
  return /[\u0980-\u09FF]/.test(t) ? t : null
}
/** wf_book_fill names the date that failed: "On 2026-11-05: …" -> "৫ নভেম্বর: …". */
const ON_DATE = /^On (\d{4}-\d{2}-\d{2}): /
export const wfFriendly = (e: unknown): string => {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  const on = ON_DATE.exec(m)
  if (on) return `${new Date(`${on[1]}T00:00:00Z`).toLocaleDateString('bn-BD', { timeZone: 'UTC', day: 'numeric', month: 'long' })}: ${wfFriendly(m.slice(on[0].length))}`
  const known = BN.find(([re]) => re.test(m))?.[1]
  if (known) return known
  const bn = banglaTail(m)
  if (bn) return bn
  return /may not|42501|permission denied/i.test(m) ? 'এই কাজের অনুমতি আপনার নেই' : m
}

/** Tell the shared alert numbers (menu badge, alert cards) that something changed, so they refresh now instead of at the next poll. */
export const announceWfChange = () => { try { window.dispatchEvent(new Event('wf:changed')) } catch { /* no window: nothing to refresh */ } }

// ------------------------------------------------------------------ labels (Bangla first, English second)
export const STATE_META: Record<DayState, { bn: string; en: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  missing: { bn: 'বাকি', en: 'Not given', tone: 'warn' }, waiting: { bn: 'অনুমোদনের অপেক্ষায়', en: 'Waiting', tone: 'info' },
  approved: { bn: 'অনুমোদিত', en: 'Approved', tone: 'ok' }, returned: { bn: 'ফেরত', en: 'Returned', tone: 'bad' },
  future: { bn: 'আসেনি', en: 'Not yet', tone: 'neutral' }, closed: { bn: 'বন্ধ', en: 'Closed', tone: 'neutral' },
}
export const RECORD_META: Record<string, { bn: string; en: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  present: { bn: 'উপস্থিত', en: 'Present', tone: 'ok' }, late: { bn: 'দেরিতে', en: 'Late', tone: 'warn' }, half_day: { bn: 'অর্ধদিবস', en: 'Half day', tone: 'warn' },
  absent: { bn: 'অনুপস্থিত', en: 'Absent', tone: 'bad' }, leave: { bn: 'ছুটি', en: 'Leave', tone: 'info' },
  holiday: { bn: 'সরকারি ছুটি', en: 'Holiday', tone: 'neutral' }, weekly_off: { bn: 'সাপ্তাহিক ছুটি', en: 'Weekly off', tone: 'neutral' },
}
export const APP_META: Record<AppStatus, { bn: string; en: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  pending: { bn: 'অপেক্ষায়', en: 'Pending', tone: 'warn' }, approved: { bn: 'অনুমোদিত', en: 'Approved', tone: 'ok' },
  rejected: { bn: 'বাতিল', en: 'Rejected', tone: 'bad' }, cancelled: { bn: 'তুলে নেওয়া', en: 'Withdrawn', tone: 'neutral' },
}
export const ACTION_META: Record<HistoryAction, { bn: string; en: string }> = {
  submitted: { bn: 'জমা দিয়েছেন', en: 'Submitted' }, edited: { bn: 'বদলেছেন', en: 'Edited' }, resubmitted: { bn: 'আবার দিয়েছেন', en: 'Resubmitted' },
  approved: { bn: 'অনুমোদন', en: 'Approved' }, returned: { bn: 'ফেরত', en: 'Returned' }, corrected: { bn: 'সংশোধন', en: 'Corrected' }, cancelled: { bn: 'তুলে নিয়েছেন', en: 'Withdrawn' },
}

/** 'YYYY-MM-01' → "নভেম্বর ২০২৬" / "November 2026". */
export const monthLabel = (ym: string, lang: 'bn' | 'en') =>
  new Date(`${ym.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
export const dayLabel = (iso: string, lang: 'bn' | 'en') =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
export const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`

// ------------------------------------------------------------------ live data
/**
 * Load + live refresh. `tables` are the database tables whose changes matter; Supabase Realtime applies each table's row
 * security, so a person hears only about rows they may read. Reloads quietly (the old data stays on screen), is debounced,
 * and also refreshes every 60 s and when the app comes back to the screen — so it still works where Realtime is not on.
 */
export function useLiveLoad<T>(fn: () => Promise<T>, deps: unknown[], tables: string[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)
  const run = useCallback(async (quiet = false) => {
    const mine = ++seq.current
    if (!quiet) { setLoading(true); setError(null) }
    try { const v = await fnRef.current(); if (mine === seq.current) { setData(v); setError(null) } }
    catch (e) { if (mine === seq.current) setError(e) }
    finally { if (mine === seq.current) setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { void run() }, [run])
  const key = tables.join(',')
  useEffect(() => {
    let timer = 0
    const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void run(true), 500) }
    const ch = key
      ? tables.reduce((c, t) => c.on('postgres_changes', { event: '*', schema: 'public', table: t }, soon),
          supabase.channel(`wf-${key}-${Math.random().toString(36).slice(2, 8)}`)).subscribe(s => setLive(s === 'SUBSCRIBED'))
      : null
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void run(true) }, 60000)
    const onShow = () => { if (document.visibilityState === 'visible') void run(true) }
    document.addEventListener('visibilitychange', onShow)
    return () => { window.clearTimeout(timer); window.clearInterval(poll); document.removeEventListener('visibilitychange', onShow); if (ch) void supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, key])
  return { data, error, loading, live, reload: () => run(true), reloadLoud: () => run(false), setData }
}

/** The tables the module's screens listen to. */
export const LIVE = {
  mine: ['attendance_self_marks', 'wf_absence_applications', 'wf_daily_ops'],
  manage: ['attendance_self_marks', 'wf_absence_applications', 'wf_daily_ops', 'attendance_records'],
}
