// Employee import from Excel/CSV: upload rows → map columns → check → (create missing hubs/posts)
// → verify → save. Every step is a database function that checks permissions and keeps history.
import { supabase } from './supabase'
import { HrError } from './hr'

export type Batch = { id: string; file_name: string; status: 'uploaded' | 'validated' | 'verified' | 'committed' | 'cancelled'
  column_mapping: Record<string, string>; total_rows: number; valid_rows: number; error_rows: number
  created_at: string; created_by: string | null; verified_by: string | null; committed_at: string | null }
export type ImportRow = { id: string; row_number: number; raw: Record<string, string>; data: Record<string, unknown> | null
  errors: string[]; status: 'pending' | 'valid' | 'error' | 'imported' | 'skipped'; employee_id: string | null }
export type Missing = { kind: 'hub' | 'position' | 'department'; name: string; row_count: number }
export type CustomField = { code: string; label: string; label_bn: string | null; field_type: string }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export const importer = {
  batches: async (): Promise<Batch[]> => {
    const { data, error } = await supabase.from('employee_import_batches').select('*').order('created_at', { ascending: false }).limit(20)
    if (error) throw new HrError(error.message, error.code)
    return (data ?? []) as Batch[]
  },
  batch: async (id: string): Promise<Batch | null> => {
    const { data, error } = await supabase.from('employee_import_batches').select('*').eq('id', id).maybeSingle()
    if (error) throw new HrError(error.message, error.code)
    return data as Batch | null
  },
  rows: async (id: string): Promise<ImportRow[]> => {
    const { data, error } = await supabase.from('employee_import_rows').select('id, row_number, raw, data, errors, status, employee_id')
      .eq('batch_id', id).order('row_number').limit(5000)
    if (error) throw new HrError(error.message, error.code)
    return (data ?? []) as ImportRow[]
  },
  customFields: async (): Promise<CustomField[]> => {
    const { data } = await supabase.from('employee_custom_fields').select('code, label, label_bn, field_type').is('archived_at', null).order('sort_order')
    return ((data ?? []) as CustomField[]).filter(f => ['text', 'textarea', 'number', 'date', 'checkbox', 'dropdown'].includes(f.field_type))
  },
  /** Creates the batch and uploads the rows (500 at a time). */
  upload: async (fileName: string, rows: Array<Record<string, string>>, onProgress?: (done: number) => void): Promise<string> => {
    const { data, error } = await supabase.from('employee_import_batches').insert({ file_name: fileName }).select('id').single()
    if (error || !data) throw new HrError(error?.message ?? 'upload failed', error?.code)
    const id = (data as { id: string }).id
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((raw, k) => ({ batch_id: id, row_number: i + k + 1, raw }))
      const { error: e2 } = await supabase.from('employee_import_rows').insert(chunk)
      if (e2) throw new HrError(e2.message, e2.code)
      onProgress?.(Math.min(rows.length, i + 500))
    }
    return id
  },
  validate: (id: string, mapping: Record<string, string>) => rpc<{ total: number; valid: number; errors: number }>('hr_validate_import', { p_batch: id, p_mapping: mapping }),
  missing: (id: string) => rpc<Missing[]>('hr_import_missing', { p_batch: id }),
  createMissing: (id: string, zone: string | null, department: string | null) =>
    rpc<{ hubs: number; positions: number; departments: number }>('hr_import_create_missing', { p_batch: id, p_zone: zone, p_department: department }),
  verify: (id: string) => rpc<void>('hr_verify_import', { p_batch: id }),
  commit: (id: string, skipInvalid: boolean) => rpc<{ activated: number; awaiting_employee_id: number; skipped: number }>('hr_commit_import', { p_batch: id, p_skip_invalid: skipInvalid }),
  cancel: (id: string) => rpc<void>('hr_cancel_import', { p_batch: id }),
}

/** Target fields a column can go to. [value, Bangla label, English label, header words that suggest it] */
export const TARGETS: Array<[string, string, string, RegExp]> = [
  ['employee_code', 'এমপ্লয়ি আইডি', 'Employee ID', /^(emp(loyee)?[\s_-]*)?(id|code|no)\.?$|^আইডি$|এমপ্লয়ি|কর্মী আইডি|employee\s*(id|code)/i],
  ['full_name_bn', 'নাম (বাংলা)', 'Name (Bangla)', /name.*(bn|bangla)|বাংলা নাম/i],
  ['full_name', 'নাম', 'Name', /^(full\s*)?name$|^নাম$|employee\s*name|কর্মীর নাম/i],
  ['position_code', 'পদবি (কোড)', 'Position (code)', /(position|post|designation)\s*code|পদবি কোড/i],
  ['position_name', 'পদবি (নাম)', 'Position (name)', /post|position|designation|পদ/i],
  ['hub_code', 'হাব (কোড)', 'Hub (code)', /hub\s*code|হাব কোড/i],
  ['hub_name', 'হাব (নাম)', 'Hub (name)', /hub|branch|হাব|শাখা/i],
  ['department_name', 'বিভাগ (নাম)', 'Department (name)', /department|dept|বিভাগ/i],
  ['basic_salary', 'মূল বেতন', 'Basic', /basic|মূল/i],
  ['transport_allowance', 'যাতায়াত ভাতা', 'Transport', /transport|conveyance|যাতায়াত|গাড়ি/i],
  ['commission', 'কমিশন', 'Commission', /commission|কমিশন/i],
  ['emergency_contact_name', 'জরুরি যোগাযোগ (নাম)', 'Emergency contact name', /emergency.*name|জরুরি.*নাম/i],
  ['emergency_contact_phone', 'জরুরি যোগাযোগ (মোবাইল)', 'Emergency phone', /emergency|জরুরি/i],
  ['mobile', 'মোবাইল', 'Mobile', /mobile|phone|cell|মোবাইল|ফোন/i],
  ['email', 'ইমেইল', 'Email', /e-?mail|ইমেইল/i],
  ['nid_number', 'NID', 'NID', /nid|national|জাতীয়|এনআইডি/i],
  ['date_of_birth', 'জন্মতারিখ', 'Date of birth', /birth|dob|জন্ম/i],
  ['joining_date', 'যোগদানের তারিখ', 'Joining date', /join|যোগদান/i],
  ['father_name', 'বাবার নাম', "Father's name", /father|বাবা|পিতা/i],
  ['mother_name', 'মায়ের নাম', "Mother's name", /mother|মায়ের|মাতা/i],
  ['present_address', 'বর্তমান ঠিকানা', 'Present address', /present|current\s*address|বর্তমান/i],
  ['permanent_address', 'স্থায়ী ঠিকানা', 'Permanent address', /permanent|স্থায়ী/i],
  ['reference_code', 'রেফারেন্স (যিনি এনেছেন তাঁর আইডি)', 'Referred by (Employee ID)', /ref|রেফারেন্স|সুপারিশ/i],
]
export const DATE_TARGETS = ['date_of_birth', 'joining_date']

export function guessTarget(header: string, used: Set<string>): string {
  const h = header.trim()
  for (const [v, , , re] of TARGETS) if (!used.has(v) && re.test(h)) return v
  return ''
}

const BN: Array<[RegExp, string]> = [
  [/Missing full_name/, 'নাম নেই'], [/Missing hub/, 'হাব নেই'], [/Missing basic_salary/, 'ভাতা আছে কিন্তু মূল বেতন নেই'],
  [/^Missing (.+)$/, 'দরকারি ঘর খালি: $1'],
  [/Unknown hub: (.+)/, 'হাব পাওয়া যায়নি: $1'], [/Unknown position: (.+)/, 'পদবি পাওয়া যায়নি: $1'], [/Unknown department: (.+)/, 'বিভাগ পাওয়া যায়নি: $1'],
  [/Unknown reference ID: (.+)/, 'রেফারেন্স আইডি পাওয়া যায়নি: $1'], [/Employee cannot refer themselves/, 'নিজেই নিজের রেফারেন্স হতে পারেন না'],
  [/Invalid mobile/, 'মোবাইল নম্বর ঠিক নেই'], [/Invalid emergency_contact_phone/, 'জরুরি মোবাইল ঠিক নেই'], [/Invalid NID/, 'এনআইডি ঠিক নেই (১০/১৩/১৭ সংখ্যা)'],
  [/Invalid date_of_birth/, 'জন্মতারিখ ঠিক নেই'], [/Invalid joining_date/, 'যোগদানের তারিখ ঠিক নেই'], [/Younger than (\d+)/, 'বয়স $1-এর কম'],
  [/Joining date too far/, 'যোগদানের তারিখ অনেক পরের'], [/Invalid (basic_salary|transport_allowance|commission)/, 'টাকার ঘরে শুধু সংখ্যা দিন'],
  [/Hub outside your scope/, 'এই হাব আপনার এলাকার বাইরে'], [/Invalid employee_code format/, 'এমপ্লয়ি আইডির ধরন ঠিক নেই'],
  [/employee_code already exists/, 'এই এমপ্লয়ি আইডি আগেই আছে'], [/NID already exists/, 'এই এনআইডি আগেই আছে'], [/Mobile already exists/, 'এই মোবাইল আগেই আছে'],
  [/Invalid value for (.+)/, '"$1" ঘরের মান ঠিক নেই'], [/Duplicate of another row/, 'ফাইলের অন্য সারির সাথে মিলে গেছে'],
]
export function rowError(e: string): string {
  for (const [re, bn] of BN) if (re.test(e)) return e.replace(re, bn)
  return e
}
export function importFriendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/Required column "hub"/.test(m)) return 'হাবের কলাম বেছে দিন (হাব নাম বা হাব কোড)'
  if (/Required column "(.+)"/.test(m)) return `দরকারি কলাম বাছাই হয়নি: ${m.match(/"(.+)"/)?.[1]}`
  if (/same field/.test(m)) return 'দুটো কলাম একই ঘরে দেওয়া হয়েছে'
  if (/uploader cannot verify/.test(m)) return 'যিনি আপলোড করেছেন তিনি নিজে যাচাই করতে পারবেন না — অন্য একজন এইচআর যাচাই করবেন'
  if (/row\(s\) have errors/.test(m)) return 'কিছু সারিতে ভুল আছে — ভুল সারি বাদ দিয়ে সেভ করতে টিক দিন'
  if (/Choose the zone/.test(m)) return 'নতুন হাবগুলো কোন জোনে যাবে বেছে নিন'
  if (/Not authorised to create hubs/.test(m)) return 'এই জোনে হাব বানানোর অনুমতি নেই'
  if (/Not authorised/.test(m)) return 'এই কাজের অনুমতি আপনার নেই'
  return m
}
