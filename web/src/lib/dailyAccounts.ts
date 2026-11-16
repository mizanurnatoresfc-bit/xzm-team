// Daily Accounts (আজকের হিসাব খাতা) — typed calls to the database functions of migration 0008.
// Every rule (scope, submit once, maker ≠ checker, OCR confirmation) is enforced in the database;
// these helpers only call it and turn errors into readable messages.
import { supabase } from './supabase'

export type SheetStatus = 'open' | 'submitted' | 'correction' | 'approved'

export type DaHub = {
  hub_id: string; code: string; name: string; name_bn: string | null; zone_id: string; zone_name: string
  can_view: boolean; can_submit: boolean; can_verify: boolean
}

export type SessionRow = {
  id: string; no: number; hub_id: string; hub_name: string; zone_id: string; zone_name: string
  account_date: string; status: SheetStatus; started_by_name: string | null; started_at: string
  submitted_by_name: string | null; submitted_at: string | null; verified_by_name: string | null; verified_at: string | null
  riders: number; delivery: number; pickup: number; amount: number; due: number; mobile_banking: number
  merchant_cash: number; expense: number
}

export type Dashboard = {
  today: string; sheets: number; open: number; submitted: number; pending_verification: number; correction: number
  approved: number; riders: number; delivery: number; pickup: number; amount: number; due: number
  mobile_banking: number; merchant_cash: number; expense: number
}

export type RiderLine = {
  id: string; no: number; employee_id: string; employee_code: string; rider_name: string; mobile: string | null
  delivery_qty: number; pickup_qty: number; amount: number; paid_amount: number; due_input: number; due: number
  mobile_banking: number; remarks: string | null
}

export type OcrResult = Record<string, string | number | null> & { confidence?: number; text?: string }

export type MerchantPayment = {
  id: string; no: number; merchant_id: string; merchant_name: string; payment_ref: string | null
  transaction_id: string | null; amount: number; payment_date: string; screenshot_path: string | null
  ocr: OcrResult | null; ocr_verified: boolean; match_status: 'matched' | 'mismatch' | 'unmatched'; remarks: string | null
  /** The name the screenshot showed, when the payee is not one of our merchants. */
  payee_name?: string | null
}

export type Expense = {
  id: string; no: number; kind: 'transport' | 'employee'; employee_id: string | null; employee_code: string | null
  employee_name: string | null; expense_name: string; category: string; amount: number; bill_date: string
  bill_no: string | null; reference_no: string | null; attachment_path: string | null; paid_by_name: string | null
  template_id: string | null; ocr: OcrResult | null; ocr_verified: boolean; remarks: string | null
  /** Set when the company made its own voucher because the payee gave no bill. */
  voucher_no: string | null
  /** The vehicle it was for, and the person it is referred to. */
  vehicle_id: string | null; reference_name: string | null; reference_phone: string | null; reference_position: string | null
  /** When the line came from a claim: the claim and its bill file. */
  claim_id: string | null; claim_file: string | null
}

export type SheetEvent = {
  id: string; no: number; at: string; actor_name: string | null; actor_code: string | null
  action: 'started' | 'submitted' | 'resubmitted' | 'approved' | 'correction_required' | 'note' | 'reopened'
  note: string | null; has_snapshot: boolean
}

export type Visit = { id: string; user_name: string | null; entered_at: string; left_at: string | null; duration_seconds: number }

export type Sheet = {
  session: {
    id: string; no: number; hub_id: string; zone_id: string; account_date: string; status: SheetStatus
    started_by: string; started_by_name: string | null; started_by_code: string | null; started_at: string
    submitted_by_name: string | null; submitted_by_code: string | null; submitted_at: string | null; submit_note: string | null
    submit_count: number; verified_by_name: string | null; verified_at: string | null; verify_note: string | null
    last_saved_at: string
    closed_at: string | null; closed_by: string | null
    closed_totals: ClosedTotals | null
    /** The day's bank work: done once every deposit has its slip. */
    bank_done_at?: string | null; bank_done_by?: string | null; bank_done_note?: string | null
    /** "Accounts checked": how many parts were submitted against how many the hub needs, and the reason when fewer. */
    check_note?: string | null; check_done?: number | null; check_needed?: number | null
    /** The main site's daily report confirmed against the sheet. */
    report_ok_at?: string | null; report_ok_by_name?: string | null; report_total?: number | null; report_diff?: number | null; report_note?: string | null
  }
  hub: { id: string; code: string; name: string; name_bn: string | null }
  zone: { id: string; code: string; name: string }
  riders: RiderLine[]; merchant_payments: MerchantPayment[]; expenses: Expense[]
  /** Everyone writing on this sheet, and who has closed their own part. */
  collectors?: Collector[]
  /** Money handed over to the person keeping the sheet. */
  notes_in: CashNote[]
  totals?: { riders: number; delivery: number; pickup: number; amount: number; paid: number; due: number
             mobile_banking: number; merchant_cash: number; transport_expense: number; employee_expense: number }
  events: SheetEvent[]; visits?: Visit[]
  /** Update report IDs with their amounts, the day's bank deposits, and values of one's own columns. */
  report_ids?: ReportId[]; deposits?: Deposit[]; cells?: Cell[]
  can_edit: boolean; can_verify: boolean; can_reopen: boolean
  /** May change how the parts of the sheet are laid out (Super Admin / settings permission). */
  can_layout?: boolean
}

export type ReportId = { id: string; no: number; report_no: string; amount: number; remarks: string | null; created_by: string; created_at: string }
export type Deposit = { id: string; no: number; method: 'bank' | 'bkash' | 'nagad' | 'rocket' | 'other'; bank_name: string | null
  amount: number; charge: number; charge_auto: boolean; transport: number; people: string | null; ref_no: string | null
  slip_path: string | null; deposited_on: string; remarks: string | null; created_by: string; created_at: string }
export type Cell = { section: string; row_id: string; col: string; value: string | null }

/** How one part of the sheet is laid out: hidden columns, other names, own columns, switched off. */
export type SectionLayout = { hidden?: string[]; labels?: Record<string, string>; extra?: Array<{ key: string; label: string }>; off?: boolean }
export type Layout = Record<string, SectionLayout>
export type BankCharge = { limit: number; low: number; high: number; vat: number; off_days?: Array<number | string>
  holidays?: string[]; transport?: number; effective_from?: string | null }

export type Category = { code: string; en: string; bn: string
  /** What belongs in this category, in the company's own words (the categories handbook). */
  note_bn?: string | null
  /** What to do with it on the main site: its category there, the sub-head, the limit, and whether a receipt is needed. */
  site_name?: string | null; site_sub?: string | null; site_limit?: number | null; site_receipt?: boolean | null
  /** Used when the category does not go to the main site at all. */
  site_note_bn?: string | null }
/** Where a sheet stands: parts submitted against the hub's number, checked, report confirmed. */
export type FlowRow = { session_id: string; hub_id: string; needed: number; people: number; submitted: number
  checked_at: string | null; report_ok_at: string | null; report_diff: number | null }
/** How many people take the accounts at a hub, from the settings. */
export const collectorsNeeded = (st: Pick<DaSettings, 'da.hub_collectors' | 'da.collectors_default'> | null | undefined, hub: string) =>
  Math.max(1, Number(st?.['da.hub_collectors']?.[hub] ?? st?.['da.collectors_default'] ?? 1) || 1)

export type ClosedTotals = { riders: number; rider_amount: number; collected: number; due: number
  mobile_banking: number; payments: number; payment_amount: number; expenses: number; expense_amount: number; notes_in: number }

export type Collector = { user_id: string; name: string | null; code: string | null; closed_at: string | null; created_at: string
  note: string | null; riders: number; payments: number; expenses: number; amount: number
  /** Who submitted the part, when it was someone else. */
  closed_by?: string | null; closed_by_name?: string | null }

export type CashNote = { id: string; no: number; from_employee: string | null; from_name: string | null
  from_code: string | null; amount: number; method: string; note: string | null; created_by: string; created_at: string }

export type Handover = { id: string; account_date: string; hub_name: string; amount: number; method: string
  note: string | null; taken_by: string | null; created_at: string }

export const NOTE_METHOD: Record<string, string> = { cash: 'ক্যাশ', bkash: 'বিকাশ', nagad: 'নগদ', rocket: 'রকেট', bank: 'ব্যাংক', other: 'অন্য' }

export type DaSettings = {
  'da.payment_id_prefix': string; 'da.double_rider_lines': boolean
  'da.claim_date_source': 'sheet' | 'bill'; 'da.close_needs_all': boolean
  /** How many people take the accounts: per hub (hub id -> number) and for hubs without their own number. */
  'da.hub_collectors'?: Record<string, number>; 'da.collectors_default'?: number
  'da.fixed_riders': string[]; 'da.fixed_expenses': FixedExpense[]; 'da.note_methods': string[]
  'da.timezone': string; 'da.start_time': string; 'da.backdate_days': number; 'da.session_tracking': boolean
  'da.rider_fields': string[]; 'da.due_rule': 'manual' | 'amount_minus_paid'
  'da.reference_people': RefPerson[]
  'da.mobile_banking_rule': 'separate' | 'reduces_due' | 'adds_to_due'; 'da.expense_categories': Category[]
  'da.reference_setup': { expense_prefix: string; merchant_prefix: string; reference_required: boolean }
  'da.bill_upload': { max_mb: number; types: string[]; required_over: number | null }
  'da.ocr': { engine: string; languages: string; min_confidence: number; require_verification: boolean }
  'da.require_assignment': boolean
  'da.layout'?: Layout
  'da.bank_charge'?: BankCharge
}

export type FixedExpense = { name: string; category: string; kind?: 'transport' | 'employee'; amount?: number }

export type Template = {
  id: string; no: number; name: string; name_bn: string | null; category: string; reference_prefix: string | null
  keywords: string[]; memo_template: string | null; default_amount: number | null; status: 'active' | 'inactive'
}

export type VoucherData = {
  voucher_no: string | null; expense_no: number; amount: number; bill_date: string
  expense_name: string; category: string; kind: 'transport' | 'employee'; remarks: string | null
  employee_code: string | null; employee_name: string | null; paid_by_name: string | null; reference_no: string | null
  hub: string; hub_code: string; zone: string; account_date: string; sheet_no: number
  made_by: string | null; made_at: string
}

export type Vehicle = { id: string; code: string; name: string; kind: string; reg_no: string | null
  hub_id: string | null; hub_name: string | null; status: 'active' | 'inactive'
  holder_id: string | null; holder_code: string | null; holder_name: string | null; since: string | null }

export type MyVehicle = { vehicle_id: string; code: string; name: string; kind: string; reg_no: string | null
  since: string; spent_30d: number
  lines: Array<{ date: string; name: string; category: string; amount: number; bill_no: string | null
                 voucher_no: string | null; remarks: string | null }> }

/** A bill a member of staff put up themselves, waiting for the manager to take it in. */
export type Claim = {
  id: string; no: number; employee_id?: string; employee_code: string | null; employee_name: string | null
  kind: 'transport' | 'employee'; expense_name: string; category: string; amount: number; bill_date: string
  bill_no: string | null; reference_no: string | null
  reference_name: string | null; reference_phone: string | null; reference_position: string | null
  vehicle_id: string | null; vehicle_name?: string | null; attachment_path: string | null; remarks: string | null
  status?: 'submitted' | 'added' | 'rejected' | 'withdrawn'; review_note?: string | null; created_at: string
}

export type RefPerson = { name: string; phone?: string; position?: string }

export type ReportKind = 'hub_daily' | 'rider' | 'employee_expense' | 'merchant_payment' | 'transport_expense'
  | 'verification' | 'pending' | 'corrections'

// ---- error handling ---------------------------------------------------------------
export class DaError extends Error {
  code?: string
  constructor(message: string, code?: string) { super(message); this.code = code }
}

const BN: Array<[RegExp, string]> = [
  [/already exists/i, 'এই হাব ও তারিখের হিসাব আগে থেকেই আছে।'],
  [/submitted twice|has been submitted/i, 'হিসাবটি Submit হয়ে গেছে। সংশোধনের অনুমতি ছাড়া বদলানো যাবে না।'],
  [/approved and final/i, 'হিসাবটি অনুমোদিত ও চূড়ান্ত — আর বদলানো যাবে না।'],
  [/started or submitted a sheet cannot verify/i, 'যিনি হিসাব শুরু বা Submit করেছেন, তিনি যাচাই করতে পারবেন না।'],
  [/OCR and have not been checked/i, 'OCR থেকে পাওয়া কিছু তথ্য এখনো যাচাই করা হয়নি। আগে যাচাই করুন।'],
  [/Not authorised|permission/i, 'এই কাজের অনুমতি আপনার নেই।'],
  [/outside the allowed period/i, 'এই তারিখে হিসাব শুরু করা যাবে না।'],
  [/already on the sheet/i, 'এই রাইডার আগে থেকেই তালিকায় আছে।'],
  [/is already recorded/i, 'এই Transaction ID আগে এন্ট্রি হয়েছে।'],
  [/no record in this hub/i, 'এই Payment ID-র রেকর্ড এই হাবে নেই — মার্চেন্ট নিজে বেছে নিন।'],
  [/already has a bill/i, 'এই খরচের বিল আছে, তাই ভাউচার লাগবে না।'],
  [/Expense line not found/i, 'খরচের লাইনটি পাওয়া যায়নি।'],
  [/amount must be greater than zero/i, 'টাকার অঙ্ক শূন্যের বেশি হতে হবে।'],
  [/Choose a merchant of this hub/i, 'এই হাবের মার্চেন্ট বেছে নিন।'],
  [/date cannot be in the future/i, 'আজকের পরের তারিখ দেওয়া যাবে না।'],
  [/already used in this hub/i, 'এই রেফারেন্স নম্বর এই হাবে আগে ব্যবহার হয়েছে।'],
  [/was not found/i, 'এই আইডির কোনো কর্মী পাওয়া যায়নি।'],
  [/need a bill or memo attached/i, 'নির্ধারিত টাকার বেশি খরচে বিল বা মেমো সংযুক্ত করতে হবে।'],
  [/sheet is empty/i, 'হিসাব খালি — Submit-এর আগে অন্তত একটি এন্ট্রি দিন।'],
  [/not an active member/i, 'এই কর্মী এই হাবের সক্রিয় সদস্য নন।'],
  [/reason is required|Write what needs/i, 'কারণ / মন্তব্য লিখতে হবে।'],
  [/cannot be in the future/i, 'ভবিষ্যতের তারিখ দেওয়া যাবে না।'],
  [/can be started from/i, 'নির্ধারিত সময়ের আগে আজকের হিসাব শুরু করা যাবে না।'],
  [/Only the Accounts Manager assigned/i, 'শুধু এই হাবে নির্ধারিত Accounts Manager যাচাই করতে পারবেন।'],
]
export function friendly(err: unknown, lang: 'bn' | 'en' = 'bn'): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err
    ? String((err as { message: unknown }).message) : String(err)
  if (lang === 'bn') { const hit = BN.find(([re]) => re.test(msg)); if (hit) return `${hit[1]} (${msg})` }
  return msg
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new DaError(error.message, error.code)
  return data as T
}

// ---- calls ------------------------------------------------------------------------
export const da = {
  myHubs: () => rpc<DaHub[]>('da_my_hubs'),
  settings: () => rpc<DaSettings>('da_settings'),
  configure: (key: keyof DaSettings, value: unknown) => rpc<void>('da_configure', { p_key: key, p_value: value }),
  dashboard: (from: string, to: string, hub?: string | null, zone?: string | null) =>
    rpc<Dashboard>('da_dashboard', { p_from: from, p_to: to, p_hub: hub ?? null, p_zone: zone ?? null }),
  list: (from: string, to: string, hub?: string | null, zone?: string | null, status?: SheetStatus | null) =>
    rpc<SessionRow[]>('da_list_sessions', { p_from: from, p_to: to, p_hub: hub ?? null, p_zone: zone ?? null, p_status: status ?? null }),
  start: (hub: string, date?: string) => rpc<string>('da_start_session', { p_hub: hub, p_date: date ?? null }),
  sheet: (id: string) => rpc<Sheet>('da_sheet', { p_session: id }),
  eventSnapshot: (id: string) => rpc<Sheet | null>('da_event_snapshot', { p_event: id }),
  enter: (id: string) => rpc<string | null>('da_page_enter', { p_session: id }),
  ping: (visit: string, leaving = false) => rpc<void>('da_page_ping', { p_visit: visit, p_leaving: leaving }),
  lookupEmployee: (hub: string, code: string) => rpc<Array<{ employee_id: string; employee_code: string; full_name: string
    mobile: string | null; hub_id: string | null; hub_name: string | null; allowed: boolean; is_rider: boolean }>>(
    'da_lookup_employee', { p_hub: hub, p_code: code }),
  hubEmployees: (hub: string) => rpc<Array<{ employee_id: string; employee_code: string; full_name: string; mobile: string | null; is_rider: boolean }>>(
    'da_hub_employees', { p_hub: hub }),
  lookupMerchant: (hub: string, q: string) => rpc<Array<{ merchant_id: string; code: string; name: string }>>(
    'da_lookup_merchant', { p_hub: hub, p_query: q }),
  matchPayment: (hub: string, ref: string) => rpc<Array<{ payment_id: string; payment_no: string; merchant_id: string
    merchant_name: string; amount: number; status: string; payment_date: string }>>('da_match_payment', { p_hub: hub, p_payment_ref: ref }),
  saveRider: (a: { session: string; code: string; delivery: number; pickup: number; amount: number; paid: number
                   due: number; mb: number; remarks?: string | null; line?: string | null }) =>
    rpc<string>('da_save_rider_line', { p_session: a.session, p_employee_code: a.code, p_delivery: a.delivery,
      p_pickup: a.pickup, p_amount: a.amount, p_paid: a.paid, p_due: a.due, p_mobile_banking: a.mb,
      p_remarks: a.remarks ?? null, p_line: a.line ?? null }),
  /** The merchant may be left out when the hub already has a record for this Payment ID. */
  saveMerchant: (a: { session: string; merchant?: string | null; ref?: string | null; txn?: string | null; amount: number
                      date?: string | null; path?: string | null; ocr?: OcrResult | null; verified?: boolean; remarks?: string | null; line?: string | null }) =>
    rpc<string>('da_save_merchant_payment', { p_session: a.session, p_merchant: a.merchant ?? null, p_payment_ref: a.ref ?? null,
      p_transaction_id: a.txn ?? null, p_amount: a.amount, p_payment_date: a.date ?? null, p_screenshot_path: a.path ?? null,
      p_ocr: a.ocr ?? null, p_ocr_verified: a.verified ?? false, p_remarks: a.remarks ?? null, p_line: a.line ?? null }),
  saveExpense: (a: { session: string; kind: 'transport' | 'employee'; employee?: string | null; name: string; category: string
                     amount: number; date: string; billNo?: string | null; ref?: string | null; path?: string | null
                     paidBy?: string | null; ocr?: OcrResult | null; verified?: boolean; template?: string | null
                     remarks?: string | null; line?: string | null }) =>
    rpc<string>('da_save_expense', { p_session: a.session, p_kind: a.kind, p_employee_code: a.employee ?? null,
      p_expense_name: a.name, p_category: a.category, p_amount: a.amount, p_bill_date: a.date, p_bill_no: a.billNo ?? null,
      p_reference_no: a.ref ?? null, p_attachment_path: a.path ?? null, p_paid_by_code: a.paidBy ?? null,
      p_ocr: a.ocr ?? null, p_ocr_verified: a.verified ?? false, p_template: a.template ?? null,
      p_remarks: a.remarks ?? null, p_line: a.line ?? null }),
  setReference: (a: { line: string; name?: string | null; phone?: string | null; position?: string | null; vehicle?: string | null }) =>
    rpc<void>('da_set_expense_reference', { p_line: a.line, p_name: a.name ?? null, p_phone: a.phone ?? null,
      p_position: a.position ?? null, p_vehicle: a.vehicle ?? null }),
  vehicles: (hub?: string | null) => rpc<Vehicle[]>('vehicle_list', { p_hub: hub ?? null }),
  saveVehicle: (v: { name: string; code: string; kind: string; hub: string; reg?: string | null
                     status?: string; remarks?: string | null; id?: string | null }) =>
    rpc<string>('vehicle_save', { p_name: v.name, p_code: v.code, p_kind: v.kind, p_hub: v.hub,
      p_reg_no: v.reg ?? null, p_status: v.status ?? 'active', p_remarks: v.remarks ?? null, p_id: v.id ?? null }),
  assignVehicle: (vehicle: string, code: string, reason: string) =>
    rpc<string>('vehicle_assign', { p_vehicle: vehicle, p_employee_code: code, p_reason: reason }),
  releaseVehicle: (vehicle: string, reason: string) => rpc<void>('vehicle_release', { p_vehicle: vehicle, p_reason: reason }),
  myVehicles: () => rpc<MyVehicle[]>('da_my_vehicles', {}),
  myClaims: (days = 90) => rpc<Claim[]>('da_my_claims', { p_days: days }),
  sheetClaims: (session: string) => rpc<Claim[]>('da_sheet_claims', { p_session: session }),
  saveClaim: (c: { name: string; category: string; amount: number; date: string; kind?: 'transport' | 'employee'
                   billNo?: string | null; ref?: string | null; refName?: string | null; refPhone?: string | null
                   refPosition?: string | null; vehicle?: string | null; path?: string | null
                   remarks?: string | null; claim?: string | null }) =>
    rpc<string>('da_claim_save', { p_expense_name: c.name, p_category: c.category, p_amount: c.amount,
      p_bill_date: c.date, p_kind: c.kind ?? 'employee', p_bill_no: c.billNo ?? null, p_reference_no: c.ref ?? null,
      p_reference_name: c.refName ?? null, p_reference_phone: c.refPhone ?? null, p_reference_position: c.refPosition ?? null,
      p_vehicle: c.vehicle ?? null, p_attachment_path: c.path ?? null, p_remarks: c.remarks ?? null, p_claim: c.claim ?? null }),
  withdrawClaim: (claim: string, reason: string) => rpc<void>('da_claim_withdraw', { p_claim: claim, p_reason: reason }),
  addClaim: (claim: string, session: string, note?: string) =>
    rpc<string>('da_claim_add', { p_claim: claim, p_session: session, p_note: note ?? null }),
  rejectClaim: (claim: string, note: string) => rpc<void>('da_claim_reject', { p_claim: claim, p_note: note }),
  makeVoucher: (expense: string) => rpc<string>('da_make_voucher', { p_expense: expense }),
  voucher: (expense: string) => rpc<VoucherData>('da_voucher', { p_expense: expense }),
  removeLine: (kind: 'rider' | 'merchant' | 'expense', id: string, reason: string) =>
    rpc<void>('da_remove_line', { p_kind: kind, p_line: id, p_reason: reason }),
  submit: (id: string, note?: string) => rpc<void>('da_submit', { p_session: id, p_note: note ?? null }),
  reopen: (id: string, reason: string) => rpc<void>('da_reopen', { p_session: id, p_reason: reason }),
  verify: (id: string, action: 'approve' | 'correction' | 'note', note?: string) =>
    rpc<void>('da_verify', { p_session: id, p_action: action, p_note: note ?? null }),
  myAccounts: (from: string, to: string) => rpc<MyAccounts>('da_my_accounts', { p_from: from, p_to: to }),
  closeMyPart: (session: string, note?: string | null, done = true) =>
    rpc<void>('da_close_my_part', { p_session: session, p_note: note ?? null, p_done: done }),
  collectors: (session: string) => rpc<Collector[]>('da_collectors', { p_session: session }),
  closeDay: (session: string, note?: string | null) => rpc<ClosedTotals>('da_close_day', { p_session: session, p_note: note ?? null }),
  reopenDay: (session: string, reason: string) => rpc<void>('da_reopen_day', { p_session: session, p_reason: reason }),
  // ---- draft -> submit -> check -> report OK ----
  closePartFor: (session: string, user: string, done = true) => rpc<void>('da_close_part_for', { p_session: session, p_user: user, p_done: done, p_note: null }),
  check: (session: string, note?: string | null) => rpc<ClosedTotals & { needed: number; done: number; open: number }>('da_check', { p_session: session, p_note: note || null }),
  reportOk: (session: string, note?: string | null) => rpc<{ total: number; sheet: number; diff: number }>('da_report_ok', { p_session: session, p_note: note || null }),
  reportOkUndo: (session: string, reason: string) => rpc<void>('da_report_ok_undo', { p_session: session, p_reason: reason }),
  flowList: (from: string, to: string, hub?: string | null) => rpc<FlowRow[]>('da_flow_list', { p_from: from, p_to: to, p_hub: hub || null }),
  setHubCollectors: (hub: string, count: number | null) => rpc<void>('da_hub_collectors_set', { p_hub: hub, p_count: count }),
  applyFixed: (session: string) => rpc<{ riders: number; expenses: number }>('da_apply_fixed', { p_session: session }),
  saveNote: (a: { session: string; amount: number; method?: string; fromCode?: string | null; fromName?: string | null
                  note?: string | null; id?: string | null }) =>
    rpc<string>('da_note_save', { p_session: a.session, p_amount: a.amount, p_method: a.method ?? 'cash',
      p_from_code: a.fromCode ?? null, p_from_name: a.fromName ?? null, p_note: a.note ?? null, p_id: a.id ?? null }),
  removeNote: (id: string, reason: string) => rpc<void>('da_note_remove', { p_id: id, p_reason: reason }),
  saveReport: (a: { session: string; reportNo: string; amount: number; remarks?: string | null; id?: string | null }) =>
    rpc<string>('da_report_save', { p_session: a.session, p_report_no: a.reportNo, p_amount: a.amount, p_remarks: a.remarks ?? null, p_id: a.id ?? null }),
  removeReport: (id: string, reason: string) => rpc<void>('da_report_remove', { p_id: id, p_reason: reason }),
  saveDeposit: (a: { session: string; amount: number; method?: string; bank?: string | null; ref?: string | null; slip?: string | null
                     date?: string | null; transport?: number | null; charge?: number | null; people?: string | null; remarks?: string | null; id?: string | null }) =>
    rpc<string>('da_deposit_save', { p_session: a.session, p_amount: a.amount, p_method: a.method ?? 'bank', p_bank: a.bank ?? null,
      p_ref: a.ref ?? null, p_slip: a.slip ?? null, p_date: a.date ?? null, p_transport: a.transport ?? null, p_charge: a.charge ?? null,
      p_people: a.people ?? null, p_remarks: a.remarks ?? null, p_id: a.id ?? null }),
  removeDeposit: (id: string, reason: string) => rpc<void>('da_deposit_remove', { p_id: id, p_reason: reason }),
  bankCharge: (amount: number, method = 'bank', date?: string | null) =>
    rpc<number>('da_bank_charge', { p_amount: amount, p_method: method, p_date: date ?? null }),
  bankDone: (session: string, note?: string | null) => rpc<void>('da_bank_done', { p_session: session, p_note: note ?? null }),
  setCell: (session: string, section: string, row: string, col: string, value: string | null) =>
    rpc<void>('da_cell_set', { p_session: session, p_section: section, p_row: row, p_col: col, p_value: value }),
  myHandovers: (days = 30) => rpc<Handover[]>('da_my_handovers', { p_days: days }),

  report: (kind: ReportKind, from: string, to: string, hub?: string | null, zone?: string | null) =>
    rpc<Array<Record<string, unknown>>>('da_report', { p_kind: kind, p_from: from, p_to: to, p_hub: hub ?? null, p_zone: zone ?? null }),
  templates: async () => {
    const { data, error } = await supabase.from('da_expense_templates').select('*').order('name')
    if (error) throw new DaError(error.message, error.code)
    return (data ?? []) as Template[]
  },
  saveTemplate: (t: Partial<Template> & { name: string; category: string }) => rpc<string>('da_save_template', {
    p_name: t.name, p_category: t.category, p_reference_prefix: t.reference_prefix ?? null, p_keywords: t.keywords ?? [],
    p_memo_template: t.memo_template ?? null, p_default_amount: t.default_amount ?? null, p_name_bn: t.name_bn ?? null,
    p_status: t.status ?? 'active', p_id: t.id ?? null }),
  accountants: async () => {
    const { data, error } = await supabase.from('da_hub_accountants').select('*').is('revoked_at', null)
    if (error) throw new DaError(error.message, error.code)
    return (data ?? []) as Array<{ id: string; hub_id: string; user_id: string; reason: string; created_at: string }>
  },
  verifierCandidates: () => rpc<Array<{ user_id: string; full_name: string; email: string }>>('da_verifier_candidates'),
  assignAccountant: (hub: string, user: string, reason: string) => rpc<string>('da_assign_accountant', { p_hub: hub, p_user: user, p_reason: reason }),
  revokeAccountant: (id: string, reason: string) => rpc<void>('da_revoke_accountant', { p_id: id, p_reason: reason }),
  hubAccess: (hub: string) => rpc<Array<{ user_id: string; full_name: string; role_name: string; scope_type: string
    can_submit: boolean; can_verify: boolean; can_correct: boolean }>>('da_hub_access', { p_hub: hub }),

  // Files: private bucket, path da/<session>/<uuid>-<name>. Access is checked by storage policies.
  upload: async (session: string, file: File, settings?: DaSettings['da.bill_upload']) => {
    const max = (settings?.max_mb ?? 10) * 1024 * 1024
    const types = settings?.types ?? ['image/jpeg', 'image/png', 'application/pdf']
    if (!types.includes(file.type)) throw new DaError('এই ধরনের ফাইল নেওয়া হয় না (JPG, PNG বা PDF দিন)।')
    if (file.size > max) throw new DaError(`ফাইলটি ${settings?.max_mb ?? 10} MB-এর বেশি।`)
    const safe = file.name.replace(/[^\w.\-ঀ-৿]+/g, '_').slice(-80)
    const path = `da/${session}/${crypto.randomUUID()}-${safe}`
    const { error } = await supabase.storage.from('da-evidence').upload(path, file, { upsert: false, contentType: file.type })
    if (error) throw new DaError(error.message)
    return path
  },
  fileUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from('da-evidence').createSignedUrl(path, 300)
    if (error) throw new DaError(error.message)
    return data.signedUrl
  },
}

export type MyAccounts = {
  employee: { id: string; code: string; name: string; hub_id: string } | null
  my_lines: Array<{ line: RiderLine; account_date: string; status: SheetStatus; hub: string; verify_note: string | null }>
  my_sheets: Array<{ id: string; no: number; account_date: string; hub: string; status: SheetStatus; submitted_at: string | null
    verified_by_name: string | null; verified_at: string | null; verify_note: string | null; started_by_me: boolean; submitted_by_me: boolean }>
  my_expenses: Array<Expense & { account_date: string; status: SheetStatus }>
  my_payments: Array<MerchantPayment & { account_date: string; status: SheetStatus }>
  notes: Array<{ at: string; action: string; note: string | null; by: string | null; account_date: string; hub: string; session_id: string }>
}

// ---- formatting ---------------------------------------------------------------------
const bnDigits = (s: string) => s.replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])
export const num = (n: number | string | null | undefined, lang: 'bn' | 'en' = 'bn') => {
  const v = Number(n ?? 0)
  const s = v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return lang === 'bn' ? bnDigits(s) : s
}
export const taka = (n: number | string | null | undefined, lang: 'bn' | 'en' = 'bn') => `৳ ${num(n, lang)}`
export const dateBn = (iso: string | null | undefined, lang: 'bn' | 'en' = 'bn') => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  const s = `${d}/${m}/${y}`
  return lang === 'bn' ? bnDigits(s) : s
}
export const timeBn = (iso: string | null | undefined, lang: 'bn' | 'en' = 'bn') => {
  if (!iso) return '—'
  const s = new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return lang === 'bn' ? bnDigits(s) : s
}
export const duration = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return bnDigits(h ? `${h} ঘণ্টা ${m} মিনিট` : m ? `${m} মিনিট ${s} সেকেন্ড` : `${s} সেকেন্ড`)
}
export const todayDhaka = () => new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
export const STATUS_LABEL: Record<SheetStatus, string> = {
  open: 'চলমান', submitted: 'যাচাইয়ের অপেক্ষায়', correction: 'সংশোধন প্রয়োজন', approved: 'অনুমোদিত',
}
export const EVENT_LABEL: Record<SheetEvent['action'], string> = {
  started: 'হিসাব শুরু', submitted: 'Submit', resubmitted: 'আবার Submit', approved: 'অনুমোদিত',
  correction_required: 'সংশোধন প্রয়োজন', note: 'মন্তব্য', reopened: 'সংশোধনের জন্য খোলা',
}
