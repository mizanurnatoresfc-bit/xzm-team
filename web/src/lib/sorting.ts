// Sorting Center Management: centers, routes to hubs, staff, fuel / expense requests,
// parcel handovers both ways, driver trip reports, dashboard and reports.
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type Center = { id: string; code: string; name: string; name_bn: string | null; zone_id: string; address: string | null; phone: string | null; status: string; archived_at: string | null; home_hub_id?: string | null }
export type Route = { id: string; center_id: string; zone_id: string; code: string; name: string; vehicle_id: string | null; driver_id: string | null
  depart_time: string | null; note: string | null; status: string; archived_at: string | null }
export type RouteHub = { id: string; route_id: string; hub_id: string; zone_id: string; seq: number; can_charge: boolean }
export type StaffRow = { id: string; center_id: string; zone_id: string; employee_id: string; role: string; shift: string | null; duties: string | null
  effective_from: string; effective_to: string | null }
export type Fuel = { id: string; no: number; center_id: string; route_id: string | null; vehicle_id: string | null; employee_id: string | null; kind: string
  request_date: string; fuel_date: string | null; litres: number | null; rate: number | null; amount: number; odometer_km: number | null
  pump_name: string | null; slip_no: string | null; slip_path: string | null; note: string | null; status: 'submitted' | 'approved' | 'rejected' | 'withdrawn'
  charge_to: 'center' | 'hub'; charge_hub_id: string | null; claim_id: string | null; review_note: string | null; created_by: string | null }
export type ReceiveLocation = {
  network: 'wifi' | 'cellular' | 'ethernet' | 'other' | 'unknown'
  result: 'near_hub' | 'outside_hub' | 'low_accuracy' | 'hub_missing' | 'unavailable'
  distance_m: number | null
  accuracy_m: number | null
  exception_reason: string | null
}
export type Handover = { id: string; no: number; center_id: string; route_id: string | null; hub_id: string; direction: 'hub_to_sorting' | 'sorting_to_hub'
  work_date: string; vehicle_id: string | null; driver_id: string | null; handed_by_name: string | null; parcel_count: number; bag_count: number | null
  wrong_count: number; returned_count: number; damaged_count: number; note: string | null; status: 'sent' | 'received' | 'disputed'
  received_count: number | null; received_by_name: string | null; received_at: string | null; receive_note: string | null; sorting_receive_location?: ReceiveLocation | null }
export type DriverReport = { id: string; center_id: string; route_id: string; work_date: string; driver_id: string | null; vehicle_id: string | null
  depart_at: string | null; return_at: string | null; start_km: number | null; end_km: number | null; hubs_reached: number | null
  parcels_out: number | null; parcels_in: number | null; status: 'done' | 'late' | 'missed' | 'breakdown'; note: string | null }
export type Dash = Record<string, number> & { staff_by_role: Record<string, number> }
export type RouteReport = { route_id: string | null; route_name: string; hub_id: string; hub_name: string; to_sorting: number; to_hub: number
  wrong: number; returned: number; damaged: number; not_received: number; disputed: number; fuel: number; trips: number; km: number }
export type Vehicle = { id: string; code: string; name: string; reg_no: string | null }
export type EmpLite = { id: string; employee_code: string | null; full_name: string; mobile: string | null; position_id: string | null }

export const ROLE: Record<string, [string, string, string]> = {
  supervisor: ['সুপারভাইজার', 'Supervisor', 'shield'], data_entry: ['ডাটা এন্ট্রি', 'Data entry', 'form'], sorter: ['শর্টার', 'Sorter', 'box'],
  loader: ['লোডার', 'Loader', 'box'], driver: ['ড্রাইভার', 'Driver', 'truck'], helper: ['হেলপার', 'Helper', 'users'],
  security: ['সিকিউরিটি', 'Security', 'key'], other: ['অন্যান্য', 'Other', 'user'],
}
export const FUEL_KIND: Record<string, [string, string]> = {
  fuel: ['তেল', 'Fuel'], repair: ['মেরামত', 'Repair'], toll: ['টোল', 'Toll'], parking: ['পার্কিং', 'Parking'], driver_food: ['ড্রাইভারের খাবার', 'Driver food'], other: ['অন্যান্য', 'Other'],
}
export const FUEL_STATUS: Record<Fuel['status'], [string, string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  submitted: ['অনুমোদনের অপেক্ষায়', 'Waiting', 'warn'], approved: ['অনুমোদিত', 'Approved', 'ok'], rejected: ['বাতিল', 'Rejected', 'bad'], withdrawn: ['তুলে নেওয়া', 'Withdrawn', 'neutral'],
}
export const HO_STATUS: Record<Handover['status'], [string, string, 'ok' | 'warn' | 'bad']> = {
  sent: ['বুঝে নেওয়া বাকি', 'Not received', 'warn'], received: ['বুঝে নিয়েছে', 'Received', 'ok'], disputed: ['গরমিল', 'Mismatch', 'bad'],
}
export const TRIP_STATUS: Record<DriverReport['status'], [string, string, 'ok' | 'warn' | 'bad']> = {
  done: ['ঠিকমতো', 'On time', 'ok'], late: ['দেরি', 'Late', 'warn'], missed: ['যায়নি', 'Missed', 'bad'], breakdown: ['গাড়ি নষ্ট', 'Breakdown', 'bad'],
}

export const sorting = {
  centers: async () => {
    const { data, error } = await supabase.from('sorting_centers').select('*').is('archived_at', null).order('name'); fail(error); return (data ?? []) as Center[]
  },
  assignHubs: (center: string, hubs: string[], home: string | null) => rpc<number>('sorting_assign_hubs', { p_center: center, p_hubs: hubs, p_home_hub: home }),
  saveCenter: async (c: Partial<Center>, id?: string) => {
    const row = { code: c.code, name: c.name, name_bn: c.name_bn || null, zone_id: c.zone_id, address: c.address || null, phone: c.phone || null, status: c.status ?? 'active' }
    const { error } = id ? await supabase.from('sorting_centers').update(row).eq('id', id) : await supabase.from('sorting_centers').insert(row); fail(error)
  },
  archiveCenter: async (id: string, reason: string) => {
    const { error } = await supabase.from('sorting_centers').update({ archived_at: new Date().toISOString(), archive_reason: reason }).eq('id', id); fail(error)
  },
  routes: async (center: string) => {
    const { data, error } = await supabase.from('sorting_routes').select('*').eq('center_id', center).is('archived_at', null).order('code'); fail(error); return (data ?? []) as Route[]
  },
  routeHubs: async (routes: string[]) => {
    if (!routes.length) return [] as RouteHub[]
    const { data, error } = await supabase.from('sorting_route_hubs').select('*').in('route_id', routes).order('seq'); fail(error); return (data ?? []) as RouteHub[]
  },
  saveRoute: async (r: { center_id: string; zone_id: string; code: string; name: string; vehicle_id: string | null; driver_id: string | null; depart_time: string | null; note: string | null },
                    hubs: Array<{ hub_id: string; can_charge: boolean }>, id?: string) => {
    let rid = id
    if (id) { const { error } = await supabase.from('sorting_routes').update(r).eq('id', id); fail(error) }
    else { const { data, error } = await supabase.from('sorting_routes').insert(r).select('id').single(); fail(error); rid = (data as { id: string }).id }
    const { data: old, error: e1 } = await supabase.from('sorting_route_hubs').select('id, hub_id').eq('route_id', rid!); fail(e1)
    const keep = new Set(hubs.map(h => h.hub_id))
    const gone = ((old ?? []) as Array<{ id: string; hub_id: string }>).filter(o => !keep.has(o.hub_id)).map(o => o.id)
    if (gone.length) { const { error } = await supabase.from('sorting_route_hubs').delete().in('id', gone); fail(error) }
    if (hubs.length) {
      const { error } = await supabase.from('sorting_route_hubs').upsert(hubs.map((h, i) => ({ route_id: rid, hub_id: h.hub_id, zone_id: r.zone_id, seq: i + 1, can_charge: h.can_charge })),
        { onConflict: 'route_id,hub_id' }); fail(error)
    }
  },
  archiveRoute: async (id: string, reason: string) => {
    const { error } = await supabase.from('sorting_routes').update({ archived_at: new Date().toISOString(), archive_reason: reason, status: 'inactive' }).eq('id', id); fail(error)
  },
  staff: async (center: string, all = false) => {
    let q = supabase.from('sorting_staff').select('*').eq('center_id', center).order('role')
    if (!all) q = q.is('effective_to', null)
    const { data, error } = await q; fail(error); return (data ?? []) as StaffRow[]
  },
  addStaff: async (s: { center_id: string; zone_id: string; employee_id: string; role: string; shift: string | null; duties: string | null }) => {
    const { error } = await supabase.from('sorting_staff').insert(s); fail(error)
  },
  updateStaff: async (id: string, s: { role: string; shift: string | null; duties: string | null }) => {
    const { error } = await supabase.from('sorting_staff').update(s).eq('id', id); fail(error)
  },
  endStaff: async (id: string, reason: string) => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
    const { error } = await supabase.from('sorting_staff').update({ effective_to: today, end_reason: reason }).eq('id', id); fail(error)
  },
  fuel: async (center: string, from: string, to: string) => {
    const { data, error } = await supabase.from('sorting_fuel_requests').select('*').eq('center_id', center).gte('request_date', from).lte('request_date', to)
      .order('no', { ascending: false }); fail(error); return (data ?? []) as Fuel[]
  },
  uploadSlip: async (file: File) => {
    const { data: u } = await supabase.auth.getUser()
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `fuel/${u.user?.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('sorting-slips').upload(path, file, { contentType: file.type, upsert: false }); fail(error)
    return path
  },
  slipUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from('sorting-slips').createSignedUrl(path, 300); fail(error); return data!.signedUrl
  },
  saveFuel: (a: { center: string; amount: number; kind: string; route: string | null; vehicle: string | null; employeeCode: string | null; fuelDate: string | null
                  litres: number | null; rate: number | null; odometer: number | null; pump: string | null; slipNo: string | null; slipPath: string | null
                  note: string | null; chargeHub: string | null; id?: string }) =>
    rpc<string>('sorting_fuel_save', { p_center: a.center, p_amount: a.amount, p_kind: a.kind, p_route: a.route, p_vehicle: a.vehicle, p_employee_code: a.employeeCode,
      p_fuel_date: a.fuelDate, p_litres: a.litres, p_rate: a.rate, p_odometer: a.odometer, p_pump: a.pump, p_slip_no: a.slipNo, p_slip_path: a.slipPath,
      p_note: a.note, p_charge_hub: a.chargeHub, p_id: a.id ?? null }),
  decideFuel: (id: string, approve: boolean, note: string | null) => rpc<void>('sorting_fuel_decide', { p_id: id, p_approve: approve, p_note: note }),
  withdrawFuel: (id: string, reason: string) => rpc<void>('sorting_fuel_withdraw', { p_id: id, p_reason: reason }),
  handovers: async (center: string, from: string, to: string) => {
    const { data, error } = await supabase.from('sorting_handovers').select('*, sorting_receive_location(*)').eq('center_id', center).gte('work_date', from).lte('work_date', to)
      .order('no', { ascending: false }); fail(error); return (data ?? []) as Handover[]
  },
  saveHandover: async (h: Record<string, unknown>, id?: string) => {
    const { error } = id ? await supabase.from('sorting_handovers').update(h).eq('id', id) : await supabase.from('sorting_handovers').insert(h); fail(error)
  },
  receive: (id: string, count: number, wrong: number | null, returned: number | null, damaged: number | null, note: string | null) =>
    rpc<void>('sorting_handover_receive', { p_id: id, p_count: count, p_wrong: wrong, p_returned: returned, p_damaged: damaged, p_note: note }),
  receiveAtHub: (id: string, count: number, wrong: number | null, returned: number | null, damaged: number | null,
    note: string | null, point: { lat: number; lng: number; accuracy: number } | null, network: ReceiveLocation['network'], reason: string) =>
    rpc<void>('sorting_receive_with_location', {
      p_id: id, p_count: count, p_wrong: wrong, p_returned: returned, p_damaged: damaged, p_note: note,
      p_lat: point?.lat ?? null, p_lng: point?.lng ?? null, p_accuracy: point?.accuracy ?? null, p_network: network, p_reason: reason,
    }),
  trips: async (center: string, from: string, to: string) => {
    const { data, error } = await supabase.from('sorting_driver_reports').select('*').eq('center_id', center).gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }); fail(error); return (data ?? []) as DriverReport[]
  },
  saveTrip: async (t: Record<string, unknown>, id?: string) => {
    const { error } = id ? await supabase.from('sorting_driver_reports').update(t).eq('id', id) : await supabase.from('sorting_driver_reports').insert(t); fail(error)
  },
  dashboard: (center: string, from: string, to: string) => rpc<Dash>('sorting_dashboard', { p_center: center, p_from: from, p_to: to }),
  report: (center: string, from: string, to: string) => rpc<RouteReport[]>('sorting_route_report', { p_center: center, p_from: from, p_to: to }),
  vehicles: async () => {
    const { data, error } = await supabase.from('vehicles').select('id, code, name, reg_no').is('archived_at', null).eq('status', 'active').order('name'); fail(error)
    return (data ?? []) as Vehicle[]
  },
  employeesByIds: async (ids: string[]) => {
    const u = [...new Set(ids.filter(Boolean))]
    if (!u.length) return [] as EmpLite[]
    const { data, error } = await supabase.from('employees').select('id, employee_code, full_name, mobile, position_id').in('id', u); fail(error)
    return (data ?? []) as EmpLite[]
  },
  /** Active employees of one hub, by name — for picking sorting staff from a list. */
  employeesByHub: async (hubId: string) => {
    if (!hubId) return [] as EmpLite[]
    const { data, error } = await supabase.from('employees').select('id, employee_code, full_name, mobile, position_id')
      .eq('hub_id', hubId).is('archived_at', null).order('full_name').limit(1000); fail(error)
    return (data ?? []) as EmpLite[]
  },
  findEmployee: async (code: string) => {
    const c = code.trim().replace(/^[a-z]+-/i, '')
    if (!c) return null
    const { data, error } = await supabase.from('employees').select('id, employee_code, full_name, mobile, position_id').eq('employee_code', c).is('archived_at', null).limit(1); fail(error)
    return ((data ?? [])[0] ?? null) as EmpLite | null
  },
}
