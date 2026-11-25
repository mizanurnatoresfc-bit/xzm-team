// Staff lifecycle: the hub manager asks (left the job / new staff), the zonal manager decides, and every
// approved joining / exit / transfer leaves a file in the company's Excel layout (hr_record_files).
// All changes go through database functions that check permission and keep history.
import { supabase } from './supabase'
import { HrError, hrFriendly } from './hr'
import { download, laidXlsxBlob, type LaidSheet } from './xlsx'
import { colLabel, type Format } from './staffAdmin'
import type { CField } from './extra'
import type { PermissionGrant } from '../auth/AuthProvider'

export type LifeKind = 'id_create' | 'id_inactive' | 'id_transfer' | 'id_active'
export type Accounts = {
  as_of: string; basic_salary: number; transport_allowance: number; commission: number; last_salary: number
  salary_days: number; month_days: number; unpaid_salary: number; salary_source: 'estimate' | 'salary_sheet'
  khata_lines: number; khata_amount: number; khata_deposit: number; khata_due: number; net_payable: number
}
export type InboxRow = {
  id: string; request_no: string; kind: LifeKind; status: 'submitted' | 'processing' | 'done' | 'rejected' | 'cancelled'; created_at: string
  zone_id: string; hub_id: string | null; hub_name: string | null; hub_code: string | null
  employee_id: string | null; employee_name: string | null; employee_code: string | null; mobile: string | null; position_name: string | null
  employee_status: string | null; joining_date: string | null; reason: string | null; last_date: string | null; effective_date: string | null
  to_hub_id: string | null; to_hub_name: string | null; submitter_name: string; own: boolean
  missing: string[] | null; accounts: Accounts | null; decided_at: string | null; decision_note: string | null; result: string | null
}
export type Inbox = { rows: InboxRow[]; next_code: string }
export type PendingReq = { id: string; request_no: string; kind: LifeKind; status: string; employee_id: string | null; hub_id: string | null
  data: Record<string, string>; created_at: string; submitted_by: string }
export type RecordKind = 'joining' | 'exit' | 'transfer'
export type RecordFile = {
  id: string; record_no: string; request_id: string | null; employee_id: string; kind: RecordKind; employee_status: string
  employee_name: string; employee_code: string | null; zone_id: string; hub_id: string | null; to_hub_id: string | null
  action_date: string; reason: string | null; title: string; file_name: string
  heads: string[]; cells: Array<string | number | null>; accounts: Accounts | null; created_at: string
}
export type Decision = { status: 'done' | 'rejected'; result: string | null; record_id: string | null; employee_id: string | null; request_id?: string }

/** The four tabs of the zonal inbox, in the order the work usually comes. */
export const LIFE: Record<LifeKind, { bn: string; en: string; icon: string; tone: string }> = {
  id_create: { bn: 'নতুন আইডি', en: 'New ID', icon: 'userplus', tone: 'g' },
  id_inactive: { bn: 'বন্ধ / ছাড়া', en: 'Left / closed', icon: 'userx', tone: 'r' },
  id_transfer: { bn: 'বদলি', en: 'Transfer', icon: 'swap', tone: 'b' },
  id_active: { bn: 'চালু', en: 'Reactivate', icon: 'usercheck', tone: 'p' },
}
export const LIFE_KINDS = Object.keys(LIFE) as LifeKind[]
export const RECORD: Record<RecordKind, { bn: string; en: string; tone: 'ok' | 'bad' | 'info' }> = {
  joining: { bn: 'যোগদান', en: 'Joining', tone: 'ok' }, exit: { bn: 'বিদায়', en: 'Exit', tone: 'bad' }, transfer: { bn: 'বদলি', en: 'Transfer', tone: 'info' },
}

const fail = (e: { message: string; code?: string } | null) => { if (e) throw new HrError(e.message, e.code) }
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}
const REC_COLS = 'id,record_no,request_id,employee_id,kind,employee_status,employee_name,employee_code,zone_id,hub_id,to_hub_id,action_date,reason,title,file_name,heads,cells,accounts,created_at'

export const lifecycle = {
  /** "চাকরি ছেড়ে দিয়েছে". With `exitType` a person who decides requests finishes it in the same step. */
  leave: (employee: string, reason: string, lastDate: string | null, exitType?: 'resigned' | 'terminated' | null) =>
    rpc<string>('hr_staff_leave_request', { p_employee: employee, p_reason: reason, p_last_date: lastDate || null, p_exit_type: exitType ?? null }),
  /** "নতুন স্টাফ যোগ": applicant + submitted application + ID CREATE request. */
  join: (hub: string, position: string, data: Record<string, string>) =>
    rpc<string>('hr_staff_join_request', { p_hub: hub, p_position: position, p_data: data }),
  transfer: (employee: string, toHub: string, effective: string, reason: string) =>
    rpc<Decision>('hr_staff_transfer', { p_employee: employee, p_to_hub: toHub, p_effective: effective, p_reason: reason }),
  decide: (id: string, approve: boolean, note: string, opts: Record<string, string> = {}) =>
    rpc<Decision>('hr_request_decide', { p_id: id, p_approve: approve, p_note: note || null, p_opts: opts }),
  inbox: (zone: string | null, status: 'open' | 'done' | 'rejected' = 'open') =>
    rpc<Inbox>('hr_request_inbox', { p_zone: zone, p_status: status }),
  /** What still waits for the zonal manager in one hub (the "অপেক্ষমাণ" badge and tab). */
  pendingForHub: async (hub: string): Promise<PendingReq[]> => {
    const { data, error } = await supabase.from('hr_requests').select('id,request_no,kind,status,employee_id,hub_id,data,created_at,submitted_by')
      .eq('hub_id', hub).in('kind', ['id_create', 'id_inactive']).in('status', ['submitted', 'processing']).order('created_at', { ascending: false }).limit(500)
    fail(error); return (data ?? []) as PendingReq[]
  },
  records: async (o: { zone?: string | null; hub?: string | null; kind?: string | null; status?: string | null; from?: string | null; to?: string | null } = {}): Promise<RecordFile[]> => {
    let q = supabase.from('hr_record_files').select(REC_COLS).order('action_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
    if (o.zone) q = q.eq('zone_id', o.zone)
    if (o.hub) q = q.or(`hub_id.eq.${o.hub},to_hub_id.eq.${o.hub}`)
    if (o.kind) q = q.eq('kind', o.kind)
    if (o.status) q = q.eq('employee_status', o.status)
    if (o.from) q = q.gte('action_date', o.from)
    if (o.to) q = q.lte('action_date', o.to)
    const { data, error } = await q; fail(error); return (data ?? []) as RecordFile[]
  },
  record: async (id: string): Promise<RecordFile | null> => {
    const { data, error } = await supabase.from('hr_record_files').select(REC_COLS).eq('id', id).maybeSingle(); fail(error); return data as RecordFile | null
  },
}

// ---------- Excel ----------
const ACCOUNT_ROWS: Array<[keyof Accounts, string]> = [
  ['basic_salary', 'Basic'], ['transport_allowance', 'Transport allowance'], ['commission', 'Commission'], ['last_salary', 'Last salary (monthly)'],
  ['salary_days', 'Days worked in the last month'], ['unpaid_salary', 'Unpaid salary'], ['khata_amount', 'Khata: total taken'],
  ['khata_deposit', 'Khata: deposited'], ['khata_due', 'Khata: due'], ['net_payable', 'Net payable (unpaid salary − due)'],
]
function recordSheets(recs: RecordFile[]): LaidSheet[] {
  // files with the same layout share a sheet, one row each
  const groups = new Map<string, RecordFile[]>()
  for (const r of recs) { const k = `${r.kind}|${JSON.stringify(r.heads)}`; groups.set(k, [...(groups.get(k) ?? []), r]) }
  const sheets: LaidSheet[] = []
  for (const list of groups.values()) {
    const f = list[0]
    sheets.push({ name: RECORD[f.kind].en, top: [{ text: `XZM TEAM — ${f.title}`, c0: 0, c1: Math.max(0, f.heads.length - 1) }], topRows: 1,
      heads: f.heads, rows: list.map((r, i) => [i + 1, ...r.cells.slice(1)]) })
  }
  if (recs.length === 1 && recs[0].kind === 'exit' && recs[0].accounts) {
    const a = recs[0].accounts
    sheets.push({ name: 'Final Accounts', top: [{ text: `Final Accounts — ${recs[0].employee_name}${recs[0].employee_code ? ` (${recs[0].employee_code})` : ''}`, c0: 0, c1: 2 }], topRows: 1,
      heads: ['SL', 'Item', 'Amount'], rows: ACCOUNT_ROWS.map(([k, label], i) => [i + 1, label, Number(a[k] ?? 0)]), widths: [7, 38, 16] })
  }
  return sheets
}
export function downloadRecord(r: RecordFile) { download(laidXlsxBlob(recordSheets([r])), r.file_name) }
export function downloadRecords(recs: RecordFile[], name = 'HR-Records.xlsx') { if (recs.length) download(laidXlsxBlob(recordSheets(recs)), name) }

// ---------- the new-staff form, from the company's own column list ----------
export type JoinField = { key: string; label: string; type: 'text' | 'phone' | 'date' | 'number' | 'textarea' | 'select' | 'email'
  required?: boolean; options?: Array<{ value: string; label: string }> }
const FIELD_TYPE: Record<string, JoinField['type']> = {
  full_name_bn: 'text', email: 'email', joining_date: 'date', basic_salary: 'number', transport_allowance: 'number', commission: 'number',
  referrer_code: 'text', emergency_contact_name: 'text', emergency_contact_phone: 'phone', nid_number: 'text', date_of_birth: 'date',
  father_name: 'text', mother_name: 'text', present_address: 'textarea', permanent_address: 'textarea',
}
/** The layout that drives the form: the zone's own format first, then the default; import layouts before export-only ones. */
export function pickJoinFormat(formats: Format[], zone: string | null): Format | undefined {
  const rank = (f: Format) => (f.zone_id ? 0 : 4) + (f.purpose === 'export' ? 2 : 0) + (f.is_default ? 0 : 1)
  return formats.filter(f => !f.archived_at && (!f.zone_id || f.zone_id === zone)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))[0]
}
/** Name, mobile and post are always asked; the rest follows the format's columns, in its order and under its headings. */
export function joinFields(format: Format | undefined, custom: CField[], lang: string): JoinField[] {
  const out: JoinField[] = []
  for (const c of format?.columns ?? []) {
    if (out.some(f => f.key === c.field)) continue
    if (c.field.startsWith('cf:')) {
      const f = custom.find(x => x.code === c.field.slice(3) && !x.archived_at)
      if (!f || f.field_type === 'multi_select') continue
      out.push({ key: c.field, label: colLabel(c, lang), required: f.is_required,
        type: f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : f.field_type === 'textarea' ? 'textarea' : f.field_type === 'dropdown' || f.field_type === 'checkbox' ? 'select' : 'text',
        options: f.field_type === 'checkbox' ? [{ value: 'true', label: 'হ্যাঁ' }, { value: 'false', label: 'না' }]
          : f.field_type === 'dropdown' ? (f.options ?? []).map(o => ({ value: o.value, label: lang === 'bn' && o.label_bn ? o.label_bn : o.label })) : undefined })
    } else if (FIELD_TYPE[c.field]) out.push({ key: c.field, label: colLabel(c, lang), type: FIELD_TYPE[c.field] })
  }
  if (!out.some(f => f.key === 'joining_date')) out.unshift({ key: 'joining_date', label: lang === 'bn' ? 'যোগদানের তারিখ' : 'Joining date', type: 'date' })
  return out
}

/** Hubs a person may work on with one permission: their hub-scoped hubs, every hub of their zones, or all with a company-wide role. */
export function scopeHubs<T extends { id: string; zone_id: string }>(grants: PermissionGrant[], hubs: T[] | undefined | null, perm: string): T[] {
  const mine = grants.filter(g => g.is_super || g.permission_code === perm || g.permission_code === '*')
  if (mine.some(g => g.scope_type === 'global')) return hubs ?? []
  const hubIds = new Set(mine.filter(g => g.scope_type === 'hub').map(g => g.hub_id)), zoneIds = new Set(mine.filter(g => g.scope_type === 'zone').map(g => g.zone_id))
  return (hubs ?? []).filter(h => hubIds.has(h.id) || zoneIds.has(h.zone_id))
}

const BN: Array<[RegExp, string]> = [
  [/Effective date must be on or after/i, 'তারিখটি বর্তমান দায়িত্ব শুরুর তারিখের আগে — পরের একটি তারিখ দিন'],
  [/transfer rights in both/i, 'দুই হাবেই বদলির অনুমতি লাগে — অন্য জোনের হাবে বদলি হেড অফিস করবে'],
  [/Not authorised \(requires/i, 'চাকরি ছেড়ে যাওয়া কাউকে আবার চালু করতে হেড অফিসের অনুমতি লাগে'],
  [/NID|nid_number/i, 'এনআইডি নম্বর সঠিক নয় বা আগে থেকেই আছে'],
]
/** Database messages of these functions are already in Bangla; the few English ones from older functions are put into words. */
export function lifeFriendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (/[ঀ-৿]/.test(msg)) return msg
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? hit[1] : hrFriendly(err)
}
export const takaBn = (v: number | null | undefined) => `৳${Math.round(Number(v ?? 0)).toLocaleString('bn-BD')}`
