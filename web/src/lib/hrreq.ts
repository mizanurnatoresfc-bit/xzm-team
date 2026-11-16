import { supabase } from './supabase'

/** HR & operation requests: formats (ID create / transfer / active / inactive + custom), submissions, status log, notifications. */
export type FieldType = 'text' | 'number' | 'date' | 'phone' | 'textarea' | 'select' | 'hub' | 'position'
export type ReqField = { key: string; label: string; type: FieldType; required?: boolean; prefill?: string; options?: string[] }
export type ReqKind = 'id_create' | 'id_transfer' | 'id_active' | 'id_inactive' | 'custom'
export type ReqFormat = {
  id: string; code: string; kind: ReqKind; name: string; name_bn: string | null; description: string | null; fields: ReqField[]
  needs_employee: boolean; self_service: boolean; sort_order: number; archived_at: string | null
}
export type ReqStatus = 'submitted' | 'processing' | 'done' | 'rejected' | 'cancelled'
export type HrRequest = {
  id: string; request_no: string; format_id: string; kind: ReqKind; employee_id: string | null; zone_id: string; hub_id: string | null
  data: Record<string, string>; note: string | null; status: ReqStatus; submitted_by: string; submitter_employee_id: string | null
  decided_by: string | null; decided_at: string | null; decision_note: string | null; result: string | null
  ref_employee_id: string | null; ref_name: string | null; ref_code: string | null; ref_hub: string | null; ref_position: string | null; created_at: string
}
export type ReqEvent = { id: string; request_id: string; status: string; note: string | null; by_name: string | null; at: string }
export type ReqRecent = { id: string; request_no: string; kind: ReqKind; status: ReqStatus; created_at: string; mine: boolean; asref: boolean; aboutme: boolean
  person: string | null; code: string | null; hub: string | null; format: string }
export type ReqSummary = { mine: Record<string, number>; decided: Record<string, number>; all: Record<string, number>; as_ref: number; about_me: number; open: number; recent: ReqRecent[] }
export type Notice = { id: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }
export type EmpRow = { id: string; employee_code: string | null; full_name: string; mobile: string | null; hub_id: string | null; position_id: string | null
  department_id: string | null; reporting_manager_id: string | null; joining_date: string | null; status: string; profile_id: string | null; zone_id?: string | null }

export const KINDS: Record<ReqKind, { bn: string; icon: string; tone: string }> = {
  id_create: { bn: 'ID CREATE', icon: 'plus', tone: 'g' },
  id_transfer: { bn: 'ID TRANSFER', icon: 'truck', tone: 'b' },
  id_active: { bn: 'ID ACTIVE', icon: 'check', tone: 'p' },
  id_inactive: { bn: 'ID INACTIVE / REMOVE', icon: 'x', tone: 'r' },
  custom: { bn: 'অন্যান্য রিপোর্ট', icon: 'form', tone: 'o' },
}
/** One line under each action, in plain words. */
export const KIND_HINT: Record<ReqKind, string> = {
  id_create: 'নতুন লোকের আইডি খোলা', id_transfer: 'অন্য হাবে বদলি', id_active: 'বন্ধ আইডি আবার চালু', id_inactive: 'আইডি বন্ধ / চাকরি ছাড়া', custom: 'নিজের বানানো ফরম্যাট',
}
export const STATUS: Record<ReqStatus, { bn: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  submitted: { bn: 'জমা হয়েছে', tone: 'info' }, processing: { bn: 'কাজ চলছে', tone: 'warn' }, done: { bn: 'সম্পন্ন', tone: 'ok' },
  rejected: { bn: 'রিজেক্ট', tone: 'bad' }, cancelled: { bn: 'তুলে নেওয়া', tone: 'neutral' },
}
export const PREFILL: Record<string, string> = {
  employee_code: 'আইডি', full_name: 'নাম', mobile: 'মোবাইল', hub: 'হাব', position: 'পদবি', department: 'বিভাগ', joining_date: 'যোগদানের তারিখ', status: 'অবস্থা',
}
export const FIELD_TYPES: Record<FieldType, string> = {
  text: 'লেখা', number: 'সংখ্যা', date: 'তারিখ', phone: 'মোবাইল', textarea: 'বড় লেখা', select: 'বাছাই তালিকা', hub: 'হাব বাছাই', position: 'পদবি বাছাই',
}
const EMP_COLS = 'id,employee_code,full_name,mobile,hub_id,zone_id,position_id,department_id,reporting_manager_id,joining_date,status,profile_id'

function fail(error: { message: string } | null) { if (error) throw error }
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export const hrReq = {
  formats: async (archived = false) => {
    let q = supabase.from('hr_request_formats').select('*').order('sort_order').order('name')
    if (!archived) q = q.is('archived_at', null)
    const { data, error } = await q; fail(error); return (data ?? []) as ReqFormat[]
  },
  saveFormat: async (row: Partial<ReqFormat>, id?: string) => {
    const { error } = id ? await supabase.from('hr_request_formats').update(row).eq('id', id) : await supabase.from('hr_request_formats').insert(row); fail(error)
  },
  archiveFormat: async (id: string, reason: string) => {
    const { error } = await supabase.from('hr_request_formats').update({ archived_at: new Date().toISOString(), archive_reason: reason }).eq('id', id); fail(error)
  },
  list: async () => {
    const { data, error } = await supabase.from('hr_requests').select('*').order('created_at', { ascending: false }).limit(500); fail(error)
    return (data ?? []) as HrRequest[]
  },
  /** Every request the person may see between two dates (Dhaka days), oldest last. */
  between: async (from: string | null, to: string | null) => {
    let q = supabase.from('hr_requests').select('*').order('created_at', { ascending: false }).limit(5000)
    if (from) q = q.gte('created_at', `${from}T00:00:00+06:00`)
    if (to) q = q.lte('created_at', `${to}T23:59:59.999+06:00`)
    const { data, error } = await q; fail(error); return (data ?? []) as HrRequest[]
  },
  one: async (id: string) => {
    const { data, error } = await supabase.from('hr_requests').select('*').eq('id', id).maybeSingle(); fail(error); return data as HrRequest | null
  },
  events: async (id: string) => {
    const { data, error } = await supabase.from('hr_request_events').select('*').eq('request_id', id).order('at'); fail(error); return (data ?? []) as ReqEvent[]
  },
  submit: (a: { format: string; employee: string | null; hub: string | null; data: Record<string, string>; note: string
    ref?: { employee?: string | null; name?: string; code?: string; hub?: string; position?: string } }) =>
    rpc<string>('hr_request_submit', { p_format: a.format, p_employee: a.employee, p_hub: a.hub, p_data: a.data, p_note: a.note || null,
      p_ref_employee: a.ref?.employee ?? null, p_ref_name: a.ref?.name || null, p_ref_code: a.ref?.code || null, p_ref_hub: a.ref?.hub || null, p_ref_position: a.ref?.position || null }),
  update: (id: string, status: 'processing' | 'done' | 'rejected', note: string, result?: string) =>
    rpc<void>('hr_request_update', { p_id: id, p_status: status, p_note: note || null, p_result: result || null }),
  cancel: (id: string, reason: string) => rpc<void>('hr_request_cancel', { p_id: id, p_reason: reason }),
  summary: () => rpc<ReqSummary>('hr_request_summary', {}),
  hubStaff: async (hub: string) => {
    const { data, error } = await supabase.from('employees').select(EMP_COLS).eq('hub_id', hub).is('archived_at', null).order('full_name').limit(1000); fail(error)
    return (data ?? []) as EmpRow[]
  },
  employee: async (id: string) => {
    const { data, error } = await supabase.from('employees').select(EMP_COLS).eq('id', id).maybeSingle(); fail(error); return data as EmpRow | null
  },
  employeesByIds: async (ids: string[]) => {
    if (!ids.length) return [] as EmpRow[]
    const { data, error } = await supabase.from('employees').select(EMP_COLS).in('id', ids); fail(error); return (data ?? []) as EmpRow[]
  },
  findPeople: async (q: string) => {
    const s = q.replace(/[%,()]/g, ' ').trim(); if (s.length < 2) return [] as EmpRow[]
    const { data, error } = await supabase.from('employees').select(EMP_COLS).is('archived_at', null)
      .or(`full_name.ilike.%${s}%,employee_code.ilike.%${s}%,mobile.ilike.%${s}%`).order('full_name').limit(8); fail(error)
    return (data ?? []) as EmpRow[]
  },
  myEmployee: async () => {
    const id = await rpc<string | null>('my_employee_id', {}).catch(() => null)
    return id ? hrReq.employee(id) : null
  },
  notices: async () => {
    const { data, error } = await supabase.from('notifications').select('id,title,body,link,created_at,read_at').order('created_at', { ascending: false }).limit(15)
    if (error) return [] as Notice[]
    return (data ?? []) as Notice[]
  },
  markRead: async (ids: string[]) => {
    if (!ids.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null)
  },
  openCount: async () => {
    const { count, error } = await supabase.from('hr_requests').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'processing'])
    return error ? 0 : count ?? 0
  },
}

export const slugKey = (label: string, used: string[]) => {
  let base = label.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  if (!/^[a-z]/.test(base)) base = 'f_' + base
  if (base === 'f_') base = 'field'
  let k = base, i = 2
  while (used.includes(k)) k = `${base}_${i++}`
  return k
}
