// One place for the rules every form shares: what a mobile number looks like, what "required"
// means, how Bangla digits are read — and the look-ups that warn about a duplicate before saving.
// These checks are for quick feedback on the screen; the database still enforces its own rules.
import { supabase } from './supabase'

export const toLatinDigits = (s: string) => s.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
export const BD_MOBILE = /^01[3-9][0-9]{8}$/
/** 01XXXXXXXXX from whatever a person types: Bangla digits, +88 / 88 in front, spaces and dashes. */
export function cleanMobile(raw: string): string {
  return toLatinDigits(raw).replace(/[\s-]/g, '').replace(/^\+?88(?=01)/, '')
}

/** A rule looks at the text of one box and returns the message to show, or null when it is fine. */
export type Rule = (value: string) => string | null
export const rules = {
  required: (label: string): Rule => v => v.trim() ? null : `${label} দিন`,
  mobile: (): Rule => v => !v.trim() || BD_MOBILE.test(cleanMobile(v)) ? null : 'সঠিক মোবাইল নম্বর দিন — ১১ সংখ্যা, যেমন 01711000000',
  number: (o: { min?: number; max?: number; whole?: boolean } = {}): Rule => v => {
    if (!v.trim()) return null
    const x = Number(toLatinDigits(v).replace(/,/g, ''))
    if (!Number.isFinite(x)) return 'শুধু সংখ্যা লিখুন'
    if (o.whole && !Number.isInteger(x)) return 'পূর্ণ সংখ্যা লিখুন'
    if (o.min !== undefined && x < o.min) return `কমপক্ষে ${o.min} হতে হবে`
    if (o.max !== undefined && x > o.max) return `সর্বোচ্চ ${o.max} হতে পারে`
    return null
  },
  minLength: (n: number, label: string): Rule => v => !v.trim() || v.trim().length >= n ? null : `${label} কমপক্ষে ${n} অক্ষরের হতে হবে`,
}
export const firstError = (value: string, list: Rule[]): string | null => { for (const r of list) { const m = r(value); if (m) return m } return null }
/** Check a whole form at once: `{ field: message }` for every box that is wrong (empty object = all fine). */
export function validate<T extends Record<string, string>>(values: T, schema: Partial<Record<keyof T, Rule[]>>): Partial<Record<keyof T, string>> {
  const out: Partial<Record<keyof T, string>> = {}
  for (const k of Object.keys(schema) as Array<keyof T>) { const m = firstError(values[k] ?? '', schema[k] ?? []); if (m) out[k] = m }
  return out
}

/** Text search the same way everywhere: any order of words, Bangla or English digits, upper or lower case. */
export const norm = (s: string) => toLatinDigits(s).toLowerCase()
export function matches(text: string, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const t = norm(text)
  return words.every(w => t.includes(w))
}

// ---- duplicate look-ups (each answers with the rows that already exist; row level security limits what is seen) ----
export type DupEmployee = { id: string; employee_code: string | null; full_name: string; status: string; hub_id: string | null }
export type DupIssue = { id: string; issue_no: string; title: string; status: string }
export const duplicates = {
  employeeByMobile: async (mobile: string): Promise<DupEmployee[]> => {
    const { data, error } = await supabase.from('employees').select('id,employee_code,full_name,status,hub_id').eq('mobile', cleanMobile(mobile)).is('archived_at', null).limit(3)
    return error ? [] : (data ?? []) as DupEmployee[]
  },
  openIssuesByParcel: async (ref: string): Promise<DupIssue[]> => {
    const { data, error } = await supabase.from('issues').select('id,issue_no,title,status').eq('parcel_ref', ref.trim()).in('status', ['open', 'in_progress', 'solved']).limit(3)
    return error ? [] : (data ?? []) as DupIssue[]
  },
}
