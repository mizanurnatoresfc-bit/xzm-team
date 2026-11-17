// Custom profile fields (company-wide or one zone) and referrals.
import { supabase } from './supabase'
import { HrError } from './hr'

export type Section = { id: string; code: string; name: string; name_bn: string | null; sort_order: number }
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'dropdown' | 'multi_select' | 'checkbox'
export type Option = { value: string; label: string; label_bn?: string }
export type CField = { id: string; section_id: string; code: string; label: string; label_bn: string | null; field_type: FieldType | string
  is_required: boolean; is_visible: boolean; view_permission: string | null; edit_permission: string | null
  options: Option[]; sort_order: number; zone_id: string | null; archived_at: string | null }
export type FieldValue = { field_id: string; value: unknown }
export type Referral = { id: string; employee_code: string | null; full_name: string; position_name: string | null; hub_name: string | null
  zone_name: string | null; status: string; joining_date: string | null }
export type Prospect = { id: string; referrer_id: string; full_name: string; mobile: string | null; position_id: string | null; area: string | null
  note: string | null; status: 'available' | 'contacted' | 'joined' | 'not_interested'; extra: Record<string, unknown>; created_at: string }
export type PCol = { id: string; zone_id: string | null; code: string; label: string; label_bn: string | null; field_type: string; options: Option[]; sort_order: number; archived_at: string | null }
export type Summary = { referrer_id: string; employee_code: string | null; full_name: string; hub_name: string | null; brought: number; active: number
  by_position: Record<string, number>; in_hand: number }

const fail = (e: { message: string; code?: string } | null) => { if (e) throw new HrError(e.message, e.code) }
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}
async function sel<T>(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await q; fail(error); return (data ?? []) as T
}

export const fields = {
  sections: () => sel<Section[]>(supabase.from('employee_field_sections').select('*').is('archived_at', null).order('sort_order')),
  all: (archived = false) => {
    let q = supabase.from('employee_custom_fields').select('*').order('sort_order')
    if (!archived) q = q.is('archived_at', null)
    return sel<CField[]>(q)
  },
  values: (employee: string) => sel<FieldValue[]>(supabase.from('employee_custom_field_values').select('field_id, value').eq('employee_id', employee)),
  saveValue: async (employee: string, field: string, value: unknown, exists: boolean) => {
    const r = exists
      ? await supabase.from('employee_custom_field_values').update({ value }).eq('employee_id', employee).eq('field_id', field)
      : await supabase.from('employee_custom_field_values').insert({ employee_id: employee, field_id: field, value })
    fail(r.error)
  },
  create: async (f: Partial<CField>) => { const { error } = await supabase.from('employee_custom_fields').insert(f); fail(error) },
  update: async (id: string, f: Partial<CField>) => { const { error } = await supabase.from('employee_custom_fields').update(f).eq('id', id); fail(error) },
  createSection: async (name: string, nameBn: string) => {
    const code = (name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'section') + '_' + Math.random().toString(36).slice(2, 6)
    const { error } = await supabase.from('employee_field_sections').insert({ code, name, name_bn: nameBn || null, sort_order: 80 }); fail(error)
  },
}

export const referrals = {
  lookup: async (code: string) => (await rpc<Array<{ id: string; employee_code: string; full_name: string; position_name: string | null; hub_name: string | null; status: string }>>('hr_lookup_employee', { p_code: code }))?.[0] ?? null,
  setReferrer: (employee: string, code: string) => rpc<void>('hr_set_referrer', { p_employee: employee, p_referrer_code: code || null }),
  referenceOf: (employee: string) => rpc<null | { kind: 'employee' | 'manual'; id?: string; code?: string | null; name: string; hub?: string | null; hub_code?: string | null; position?: string | null; mobile?: string | null }>('hr_reference_of', { p_employee: employee }),
  setReference: (employee: string, referrer: string | null, manual: Record<string, string> | null) =>
    rpc<void>('hr_set_reference', { p_employee: employee, p_referrer: referrer, p_manual: manual }),
  /** Staff / managers: ask HR to set who referred this employee; it waits until approved. */
  requestReference: (employee: string, referrer: string | null, manual: Record<string, string> | null, note?: string) =>
    rpc<string>('hr_reference_request', { p_employee: employee, p_referrer: referrer, p_manual: manual, p_note: note || null }),
  pendingReference: (employee: string) => rpc<RefPending | null>('hr_reference_pending', { p_employee: employee }),
  referenceRequests: () => rpc<RefRequest[]>('hr_reference_requests'),
  decideReference: (ids: string[], ok: boolean, note?: string) => rpc<number>('hr_reference_decide', { p_ids: ids, p_ok: ok, p_note: note || null }),
  referrerOf: async (employee: string) => (await rpc<Array<{ id: string; employee_code: string; full_name: string }>>('hr_referrer_of', { p_employee: employee }))?.[0] ?? null,
  brought: (employee: string | null) => rpc<Referral[]>('hr_referrals', { p_employee: employee }),
  myEmployeeId: () => rpc<string | null>('my_employee_id'),
  summary: (zone: string | null) => rpc<Summary[]>('hr_referral_summary', { p_zone: zone }),
  prospects: (referrer: string) => sel<Prospect[]>(supabase.from('referral_prospects').select('*').eq('referrer_id', referrer).is('archived_at', null).order('created_at', { ascending: false })),
  saveProspect: async (p: Partial<Prospect> & { referrer_id: string }) => {
    const { id, created_at: _c, ...row } = p as Prospect
    void _c
    const r = id ? await supabase.from('referral_prospects').update(row).eq('id', id) : await supabase.from('referral_prospects').insert(row)
    fail(r.error)
  },
  archiveProspect: async (id: string) => { const { error } = await supabase.from('referral_prospects').update({ archived_at: new Date().toISOString() }).eq('id', id); fail(error) },
  columns: () => sel<PCol[]>(supabase.from('referral_prospect_columns').select('*').is('archived_at', null).order('sort_order')),
  createColumn: async (c: Partial<PCol>) => { const { error } = await supabase.from('referral_prospect_columns').insert(c); fail(error) },
  archiveColumn: async (id: string) => { const { error } = await supabase.from('referral_prospect_columns').update({ archived_at: new Date().toISOString() }).eq('id', id); fail(error) },
}

export const TYPE_LABEL: Record<string, [string, string]> = {
  text: ['লেখা (এক লাইন)', 'Text'], textarea: ['লম্বা লেখা', 'Long text'], number: ['সংখ্যা', 'Number'], date: ['তারিখ', 'Date'],
  dropdown: ['তালিকা থেকে একটি', 'Choose one'], multi_select: ['তালিকা থেকে কয়েকটি', 'Choose several'], checkbox: ['হ্যাঁ / না', 'Yes / No'],
}
export const PROSPECT_STATUS: Record<Prospect['status'], [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  available: ['আছে / প্রস্তুত', 'info'], contacted: ['যোগাযোগ হয়েছে', 'warn'], joined: ['যোগ দিয়েছেন', 'ok'], not_interested: ['আগ্রহী নন', 'neutral'],
}

/** "Hub Cashier" / "বাইক নম্বর" -> a safe code. */
export function makeCode(label: string): string {
  const c = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (/^[a-z]/.test(c) ? c : 'f_' + c).slice(0, 30).replace(/_+$/, '') + '_' + Math.random().toString(36).slice(2, 5)
}
/** "O+, A+, B+" -> options */
export const parseOptions = (s: string): Option[] => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean).map((x, i) => ({ value: `o${i + 1}`, label: x }))

export function showValue(f: { field_type: string; options: Option[] }, v: unknown, lang: string): string {
  if (v === null || v === undefined || v === '') return '—'
  const opt = (x: unknown) => { const o = f.options.find(o => o.value === x); return o ? (lang === 'bn' && o.label_bn ? o.label_bn : o.label) : String(x) }
  if (f.field_type === 'checkbox') return v === true ? (lang === 'bn' ? 'হ্যাঁ' : 'Yes') : (lang === 'bn' ? 'না' : 'No')
  if (f.field_type === 'dropdown') return opt(v)
  if (f.field_type === 'multi_select' && Array.isArray(v)) return v.map(opt).join(', ')
  if (f.field_type === 'date' && typeof v === 'string') { const [y, m, d] = v.split('-'); return d ? `${d}/${m}/${y}` : v }
  return String(v)
}

export function extraFriendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/another zone/i.test(m)) return 'এই ঘর অন্য জোনের কর্মীদের জন্য'
  if (/Unknown reference ID/i.test(m)) return 'এই আইডির কোনো কর্মী পাওয়া যায়নি'
  if (/refer themselves/i.test(m)) return 'নিজেই নিজের রেফারেন্স হতে পারেন না'
  if (/Invalid mobile/i.test(m)) return 'সঠিক মোবাইল নম্বর দিন (যেমন 01711000000)'
  if (/must be a number/i.test(m)) return 'এই ঘরে সংখ্যা দিন'
  if (/must be a date/i.test(m)) return 'সঠিক তারিখ দিন'
  if (/configured options|one of/i.test(m)) return 'তালিকা থেকে বেছে নিন'
  if (/Not allowed to edit field/i.test(m)) return 'এই ঘর বদলানোর অনুমতি আপনার নেই'
  if (/row-level security|42501|Not authorised/i.test(m)) return 'এই কাজের অনুমতি আপনার নেই'
  if (/duplicate key|unique/i.test(m)) return 'এই নামে আগেই আছে'
  return m
}

export type RefWho = { kind: 'employee' | 'manual'; id?: string; name: string; code?: string | null; position?: string | null; hub?: string | null; mobile?: string | null }
export type RefPending = { id: string; at: string; by: string | null; note: string | null; person: RefWho; can_decide: boolean }
export type RefRequest = RefPending & { status: 'pending' | 'approved' | 'rejected' | 'cancelled'; mine: boolean; decided_by: string | null; decided_at: string | null; decision_note: string | null
  employee: { id: string; name: string; code: string | null; hub: string | null } }
