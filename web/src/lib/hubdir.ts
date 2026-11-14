import { supabase } from './supabase'

/** Region → Area (zones table) → Hub directory, with GPS and the hub import list. */
export type Region = { id: string; organization_id: string; code: string; name: string; name_bn: string | null; status: string; archived_at: string | null }
export type ImportRow = {
  id: string; batch: string; sl: number; zone_id: string; code: string; phone: string | null; address: string | null
  latitude: number | string | null; longitude: number | string | null; suggested_hub_id: string | null; suggest_note: string | null
  applied_hub_id: string | null; applied_at: string | null; result_note: string | null
}
export const HUB_TYPES = ['Hub', 'Sorting Center', 'Point', 'Warehouse', 'Office']

function fail(error: { message: string } | null) { if (error) throw error }

export const hubDir = {
  regions: async (archived = false) => {
    let q = supabase.from('regions').select('*').order('name')
    if (!archived) q = q.is('archived_at', null)
    const { data, error } = await q; fail(error); return (data ?? []) as Region[]
  },
  saveRegion: async (row: Partial<Region>, id?: string) => {
    const { error } = id ? await supabase.from('regions').update(row).eq('id', id) : await supabase.from('regions').insert(row); fail(error)
  },
  importRows: async () => {
    const { data, error } = await supabase.from('hub_import_rows').select('*').order('batch').order('sl'); fail(error); return (data ?? []) as ImportRow[]
  },
  apply: async (row: string, hub: string | null, name?: string, nameBn?: string) => {
    const { data, error } = await supabase.rpc('hub_import_apply', { p_row: row, p_hub: hub, p_name: name ?? null, p_name_bn: nameBn ?? null })
    fail(error); return data as { hub_id: string; notes: string[] }
  },
  staffCounts: async () => {
    const { data, error } = await supabase.from('employees').select('hub_id').is('archived_at', null).in('status', ['active', 'applicant']).limit(5000)
    fail(error)
    const m: Record<string, number> = {}
    for (const r of (data ?? []) as Array<{ hub_id: string | null }>) if (r.hub_id) m[r.hub_id] = (m[r.hub_id] ?? 0) + 1
    return m
  },
}
