// ডেইলি রিপোর্ট ইম্পোর্ট — calls to the database functions of migration 20261116000700_report_import.
// The reading of the pasted text is in reportParser.ts; the database checks the three sums again before it saves.
import { supabase } from './supabase'
import type { ParsedReport } from './reportParser'

export type ImportList = { list_no: number; report_no: number; parcels: number; amount: number }
export type ImportRider = {
  rider_code: string; report_name: string | null; employee_id: string | null; name: string | null; known: boolean
  parcels: number; amount: number; lists: ImportList[]
}
export type ImportReport = {
  id: string; report_no: number; reported_at: string; collected: number; delivery_charge: number; declared_lists: number
  declared_parcels: number; upload_count: number; uploaded_by_name: string | null; uploaded_at: string; counted_lists: number
}
/** One manager's khata for one day. */
export type Khata = {
  hub_id: string; hub_name: string; manager_code: string; manager_name: string | null; manager_known: boolean
  delivery_charge: number; last_at: string; reports: ImportReport[]; riders: ImportRider[]
  point: { parcels: number; amount: number; lists: ImportList[] } | null
  lists: number; parcels: number; lists_amount: number; total: number
}
export type HubStatus = {
  hub_id: string; hub_name: string; zone_id: string; zone_name: string; can_upload: boolean; reports: number; managers: number
  lists: number; parcels: number; amount: number; delivery_charge: number; unknown_riders: number; last_at: string | null
}
export type SaveResult = { report_id: string; report_no: number; created: boolean; lists: number; in_other_reports: number }

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export const reportImport = {
  status: async (date: string, zone: string | null = null): Promise<HubStatus[]> => {
    const { data, error } = await supabase.rpc('da_import_status', { p_date: date, p_zone: zone }); fail(error); return (data ?? []) as HubStatus[]
  },
  day: async (date: string, hub: string | null = null): Promise<Khata[]> => {
    const { data, error } = await supabase.rpc('da_import_day', { p_date: date, p_hub: hub }); fail(error); return (data ?? []) as Khata[]
  },
  save: async (hub: string, date: string, raw: string, report: ParsedReport): Promise<SaveResult> => {
    const { data, error } = await supabase.rpc('da_import_save', { p_hub: hub, p_date: date, p_raw: raw, p_report: report }); fail(error); return data as SaveResult
  },
  mapRider: async (code: string, employee: string) => {
    const { error } = await supabase.rpc('da_import_map_rider', { p_code: code, p_employee: employee }); fail(error)
  },
  /** The pasted text of a report, kept as proof. */
  rawText: async (id: string): Promise<string> => {
    const { data, error } = await supabase.from('da_import_reports').select('raw_text').eq('id', id).maybeSingle(); fail(error)
    return (data as { raw_text: string } | null)?.raw_text ?? ''
  },
  /** People to map an unknown ID to: the hub's own first, or anyone by Employee ID / name. */
  people: async (hub: string, q: string): Promise<Array<{ id: string; employee_code: string | null; full_name: string }>> => {
    let query = supabase.from('employees').select('id,employee_code,full_name').is('archived_at', null).order('full_name').limit(60)
    const s = q.trim().replace(/[%,()]/g, '')
    query = s ? (/^\d+$/.test(s) ? query.ilike('employee_code', `${s}%`) : query.ilike('full_name', `%${s}%`)) : query.eq('hub_id', hub)
    const { data, error } = await query; fail(error)
    return (data ?? []) as Array<{ id: string; employee_code: string | null; full_name: string }>
  },
}

/** "16 Nov 2026, 08:37 PM" style time of a report (already Asia/Dhaka, no zone shift). */
export const reportTime = (iso: string) => {
  const m = /T(\d{2}):(\d{2})/.exec(iso); if (!m) return ''
  const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}
