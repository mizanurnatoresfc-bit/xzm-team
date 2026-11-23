// রেফারেন্স তালিকা: anyone asks to add / change / remove a person; HR approves before it shows.
import { supabase } from './supabase'

export type RefRow = { id: string; name: string; position: string | null; phone: string | null; hub_id: string | null; hub_name: string | null; zone_id: string | null
  employee_id: string | null; status: 'active' | 'inactive'; approval: 'pending' | 'approved' | 'rejected'; pending_action: 'add' | 'edit' | 'remove' | null
  pending_data: { name?: string; position?: string; phone?: string; hub_name?: string } | null; pending_note: string | null
  requested_by: string | null; requested_by_name: string | null; requested_at: string | null; decided_by_name: string | null; decided_at: string | null; decision_note: string | null }
/** A hub of the caller's own zone, for picking people anywhere in the zone (ref_zone_hubs). */
export type ZoneHub = { id: string; zone_id: string; code: string | null; name: string }
export type HubPerson = { id: string; employee_code: string | null; full_name: string; post: string | null; mobile: string | null }
export type RefInput = { employee?: string | null; name?: string; position?: string; phone?: string; hub?: string | null; hubName?: string; zone?: string | null; note?: string }

function fail(error: { message: string } | null) { if (error) throw new Error(error.message) }
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> { const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T }
const args = (r: RefInput) => ({ p_employee: r.employee ?? null, p_name: r.name || null, p_position: r.position || null, p_phone: r.phone || null,
  p_hub: r.hub || null, p_hub_name: r.hubName || null, p_zone: r.zone || null, p_note: r.note || null })

export const refs = {
  /** What this person may see: the approved list, their own requests, and (for HR) every request. */
  list: async () => {
    const { data, error } = await supabase.from('da_reference_people').select('*').order('name').limit(2000); fail(error)
    return (data ?? []) as RefRow[]
  },
  /** Only the approved, active people — for the expense forms' dropdown. */
  approved: async () => {
    const { data, error } = await supabase.from('da_reference_people').select('id,name,position,phone,hub_name').eq('status', 'active').eq('approval', 'approved').order('name').limit(2000)
    if (error) return [] as Array<{ id: string; name: string; position: string | null; phone: string | null; hub_name: string | null }>
    return data ?? []
  },
  hubPeople: (hub: string) => rpc<HubPerson[]>('ref_hub_people', { p_hub: hub }),
  zoneHubs: () => rpc<ZoneHub[]>('ref_zone_hubs', {}),
  add: (r: RefInput) => rpc<string>('ref_request_add', args(r)),
  edit: (id: string, r: RefInput) => rpc<void>('ref_request_edit', { p_id: id, ...args(r) }),
  remove: (id: string, reason: string) => rpc<void>('ref_request_remove', { p_id: id, p_reason: reason }),
  decide: (ids: string[], ok: boolean, note: string | null) => rpc<number>('ref_decide', { p_ids: ids, p_ok: ok, p_note: note }),
}
export const ACTION_BN: Record<string, string> = { add: 'যোগ', edit: 'বদল', remove: 'সরানো' }
const BN: Array<[RegExp, string]> = [[/Could not find the function|PGRST202|ref_request|schema cache/i, 'রেফারেন্সের নতুন অংশ ডাটাবেসে এখনো বসানো হয়নি'],
  [/42501|permission denied|row-level/i, 'এই কাজের অনুমতি নেই']]
export const refFriendly = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return BN.find(([re]) => re.test(m))?.[1] ?? m }
