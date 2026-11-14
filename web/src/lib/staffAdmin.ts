// Export/import formats, hub-wise staff numbers, and giving Employee IDs in bulk.
import { supabase } from './supabase'
import { EMP_STATUS, HrError, dmy } from './hr'
import { fields, showValue, type CField } from './extra'

export type FormatCol = { field: string; label?: string; label_bn?: string }
export type Format = { id: string; zone_id: string | null; name: string; name_bn: string | null
  purpose: 'export' | 'import' | 'both'; columns: FormatCol[]; is_default: boolean; archived_at: string | null }
export type HubSummary = { hub_id: string; hub_name: string; zone_id: string; zone_name: string
  total: number; active: number; inactive: number; applicant: number; without_id: number; with_login: number
  by_position: Record<string, number> }
export type ExportRow = Record<string, unknown>

const fail = (e: { message: string; code?: string } | null) => { if (e) throw new HrError(e.message, e.code) }
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export const staffAdmin = {
  formats: async (): Promise<Format[]> => {
    const { data, error } = await supabase.from('employee_formats').select('*').is('archived_at', null).order('name')
    fail(error); return (data ?? []) as Format[]
  },
  saveFormat: async (f: Partial<Format> & { name: string; columns: FormatCol[] }) => {
    const row = { zone_id: f.zone_id ?? null, name: f.name, name_bn: f.name_bn ?? null, purpose: f.purpose ?? 'both',
      columns: f.columns, is_default: f.is_default ?? false }
    const r = f.id ? await supabase.from('employee_formats').update(row).eq('id', f.id)
                   : await supabase.from('employee_formats').insert(row)
    fail(r.error)
  },
  archiveFormat: async (id: string) => {
    const { error } = await supabase.from('employee_formats').update({ archived_at: new Date().toISOString(), is_default: false }).eq('id', id)
    fail(error)
  },
  exportRows: (fieldsWanted: string[], o: { zone?: string | null; hub?: string | null; status?: string | null; q?: string | null } = {}) =>
    rpc<ExportRow[]>('hr_export_rows', { p_fields: fieldsWanted, p_zone: o.zone || null, p_hub: o.hub || null, p_status: o.status || null, p_q: o.q || null }),
  hubSummary: (zone?: string | null) => rpc<HubSummary[]>('hr_hub_staff_summary', { p_zone: zone || null }),
  nextCodes: (count: number) => rpc<string[]>('hr_next_employee_codes', { p_count: count }),
  bulkAssignIds: (items: Array<{ employee_id: string; employee_code: string }>, note: string) =>
    rpc<number>('hr_bulk_assign_ids', { p_items: items, p_note: note }),
}

/** Every column a format may use, with its heading in both languages. */
export const EXPORT_FIELDS: Array<[string, string, string]> = [
  ['employee_code', 'এমপ্লয়ি আইডি', 'Employee ID'],
  ['full_name', 'নাম', 'Name'],
  ['full_name_bn', 'নাম (বাংলা)', 'Name (Bangla)'],
  ['mobile', 'মোবাইল', 'Mobile'],
  ['email', 'ইমেইল', 'Email'],
  ['hub_name', 'হাব', 'Hub'],
  ['hub_code', 'হাব কোড', 'Hub code'],
  ['zone_name', 'জোন', 'Zone'],
  ['department_name', 'বিভাগ', 'Department'],
  ['position_name', 'পদবি', 'Position'],
  ['status', 'অবস্থা', 'Status'],
  ['joining_date', 'যোগদানের তারিখ', 'Joining date'],
  ['status_since', 'অবস্থা যেদিন থেকে', 'Status since'],
  ['basic_salary', 'মূল বেতন', 'Basic'],
  ['transport_allowance', 'যাতায়াত ভাতা', 'Transport'],
  ['commission', 'কমিশন', 'Commission'],
  ['referrer_code', 'রেফারেন্স আইডি', 'Referrer ID'],
  ['referrer_name', 'রেফারেন্সের নাম', 'Referrer name'],
  ['emergency_contact_name', 'জরুরি যোগাযোগ (নাম)', 'Emergency contact'],
  ['emergency_contact_phone', 'জরুরি যোগাযোগ (মোবাইল)', 'Emergency phone'],
  ['nid_number', 'NID', 'NID'],
  ['date_of_birth', 'জন্মতারিখ', 'Date of birth'],
  ['father_name', 'বাবার নাম', "Father's name"],
  ['mother_name', 'মায়ের নাম', "Mother's name"],
  ['present_address', 'বর্তমান ঠিকানা', 'Present address'],
  ['permanent_address', 'স্থায়ী ঠিকানা', 'Permanent address'],
]
/** Columns the importer can also fill in (the rest are read-only in exports). */
export const IMPORTABLE = new Set(['employee_code', 'full_name', 'full_name_bn', 'mobile', 'email', 'hub_name', 'hub_code',
  'department_name', 'position_name', 'joining_date', 'basic_salary', 'transport_allowance', 'commission',
  'emergency_contact_name', 'emergency_contact_phone', 'nid_number', 'date_of_birth', 'father_name', 'mother_name',
  'present_address', 'permanent_address', 'referrer_code'])
/** Import target name for a format column ("referrer_code" is called reference_code there). */
export const toImportTarget = (field: string): string | null =>
  field.startsWith('cf:') ? field : field === 'referrer_code' ? 'reference_code' : IMPORTABLE.has(field) ? field : null

/** Columns that only fill in for people with the extra permission. */
export const PRIVATE_FIELDS = new Set(['nid_number', 'date_of_birth', 'father_name', 'mother_name', 'present_address', 'permanent_address',
  'basic_salary', 'transport_allowance', 'commission', 'mobile_allowance', 'other_allowance', 'gross_salary'])

export const colLabel = (c: FormatCol, lang: string) => (lang === 'bn' ? c.label_bn || c.label : c.label || c.label_bn) || c.field
export const fieldLabel = (field: string, lang: string, custom: CField[]) => {
  if (field.startsWith('cf:')) {
    const f = custom.find(x => x.code === field.slice(3))
    return f ? (lang === 'bn' && f.label_bn ? f.label_bn : f.label) : field
  }
  const e = EXPORT_FIELDS.find(x => x[0] === field)
  if (!e) return field
  const mark = PRIVATE_FIELDS.has(field) ? (lang === 'bn' ? ' (গোপন)' : ' (private)') : ''
  return (lang === 'bn' ? e[1] : e[2]) + mark
}

/** Turns a value from hr_export_rows into what the sheet should show. */
export function exportValue(field: string, v: unknown, lang: string, custom: CField[]): string | number {
  if (v === null || v === undefined) return ''
  if (field === 'status') return EMP_STATUS[v as keyof typeof EMP_STATUS]?.[0] ?? String(v)
  if (field === 'joining_date' || field === 'status_since' || field === 'date_of_birth') return dmy(String(v))
  if (field.startsWith('cf:')) {
    const f = custom.find(x => x.code === field.slice(3))
    return f ? showValue(f, v, lang) : String(v)
  }
  if (typeof v === 'number') return v
  return String(v)
}

/** Loads the custom profile fields so exports can show their proper labels and values. */
export const customFields = () => fields.all().catch(() => [] as CField[])

export function formatFriendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/Unknown column/i.test(m)) return 'এই কলামটা আর নেই — ফরম্যাট থেকে সরিয়ে দিন'
  if (/at least one column/i.test(m)) return 'অন্তত একটা কলাম রাখুন'
  if (/Too many columns/i.test(m)) return 'সর্বোচ্চ ৬০টা কলাম দেওয়া যায়'
  if (/listed twice/i.test(m)) return 'একই কলাম দুবার দেওয়া হয়েছে'
  if (/needs a heading/i.test(m)) return 'প্রতিটা কলামের একটা নাম দিন'
  if (/already used/i.test(m)) return 'এই এমপ্লয়ি আইডি আগেই ব্যবহার হয়েছে'
  if (/same Employee ID twice/i.test(m)) return 'তালিকায় একই আইডি দুবার আছে'
  if (/does not match the company format/i.test(m)) return 'এমপ্লয়ি আইডির ধরন কোম্পানির নিয়মের সাথে মিলছে না'
  if (/cannot approve/i.test(m)) return 'যিনি আবেদন জমা দিয়েছেন তিনি নিজে অনুমোদন করতে পারবেন না — অন্য একজন করবেন'
  if (/Only submitted applications/i.test(m)) return 'শুধু জমা দেওয়া আবেদনেই আইডি দেওয়া যায়'
  if (/duplicate key|unique/i.test(m)) return 'এই নামে একটা ফরম্যাট আগেই আছে'
  if (/row-level security|42501|Not authorised/i.test(m)) return 'এই কাজের অনুমতি আপনার নেই'
  return m
}
