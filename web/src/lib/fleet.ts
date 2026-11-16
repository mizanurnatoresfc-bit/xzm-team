// গাড়ি (fleet): a zone's vehicles given to hubs, crew by kind with a daily allowance (খোরাকি), the auto's garage charge,
// hub reports to the zonal manager, service requests with photos, fuel with the slip. Money counts once a manager approves it,
// and approval puts it on the hub's daily sheet with a voucher. Every write goes through a database function.
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type Role = 'driver' | 'helper'
export type Kind = { code: string; bn: string; crew: Role[] }
export type FleetFns = { hub_report?: boolean; fuel?: boolean; service?: boolean; garage?: boolean; khoraki?: boolean }
export type FleetSetting = { functions?: FleetFns; kinds?: Kind[]; khoraki?: Partial<Record<Role, number>> }
export type FormField = { key: string; label: string; type: 'text' | 'number' | 'date' | 'phone' | 'textarea' | 'select'; required?: boolean; options?: string[] }
export type ReqKind = 'service' | 'parts' | 'problem' | 'other'
export type Settings = { fleet?: FleetSetting; request_formats?: Partial<Record<ReqKind, FormField[]>> }
export type Crew = { role: Role; employee_id: string; code: string | null; name: string; mobile: string | null; allowance: number | null; since: string }
export type BoardRow = {
  id: string; code: string; name: string; reg_no: string | null; kind: string; status: string; hub_id: string | null; hub_name: string | null; zone_id: string; zone_name: string | null
  roles: Role[]; crew: Crew[]; khoraki_today: Array<{ employee_id: string; amount: number; posted: boolean; log_id: string }>
  garage_today: { charged: boolean | null; cost: number | null; place: string | null; note: string | null; posted: boolean } | null
  pending: number; unposted: number; requests_open: number
  can_edit: boolean; can_crew: boolean; can_approve: boolean; can_khoraki: boolean; can_garage: boolean
}
export type WaitLog = { id: string; vehicle_id: string; vehicle: string; hub_name: string | null; kind: string; log_date: string; amount: number; litres: number | null
  vendor: string | null; bill_no: string | null; slip_path: string | null; note: string | null; status: 'submitted' | 'approved'; by_name: string | null; by_code: string | null; created_at: string }
export type WaitReq = { id: string; no: string; vehicle_id: string; vehicle: string; hub_name: string | null; kind: ReqKind; title: string; data: Record<string, string>
  photos: string[]; priority: 'low' | 'normal' | 'urgent'; status: 'open' | 'accepted'; by_name: string | null; by_code: string | null; created_at: string }
export type HubReport = { id: string; report_date: string; status: ReportStatus; late_minutes: number | null; note: string | null; photo_path: string | null
  hub_id: string; hub_name: string; vehicle_id: string; vehicle: string; by_name: string | null; by_code: string | null; created_at: string; updated_at: string }
export type ReportStatus = 'on_time' | 'load_late' | 'unload_late' | 'no_trip' | 'other'
export type FleetEvent = { id: string; at: string; action: string; role: Role | null; detail: string | null; vehicle_id: string; vehicle: string
  employee: string | null; employee_code: string | null; by_name: string | null }
export type Posted = { posted: boolean; voucher?: string | null; error?: string }
export type MyCost = { id: string; kind: string; date: string; amount: number; litres: number | null; status: 'submitted' | 'approved' | 'rejected'; note: string | null; posted: boolean; voucher: string | null; mine: boolean }
export type MyVehicle = { id: string; name: string; reg_no: string | null; kind: string; status: string; hub_id: string | null; hub_name: string | null; zone_id: string
  role: Role; allowance: number | null; since: string; crew: Array<{ role: Role; name: string; code: string | null; mobile: string | null }>
  zone_hubs: Array<{ id: string; name: string }>
  garage: Array<{ date: string; charged: boolean | null; cost: number | null; place: string | null; note: string | null }>
  costs: MyCost[]
  requests: Array<{ id: string; no: string; kind: ReqKind; title: string; status: string; priority: string; note: string | null; cost: number | null; photos: string[]; created_at: string }>
  reports: Array<{ id: string; date: string; hub_id: string; hub_name: string; status: ReportStatus; late_minutes: number | null; note: string | null }> }
export type Mine = { functions: FleetFns; formats: Partial<Record<ReqKind, FormField[]>>; vehicles: MyVehicle[] }
export type Approver = { code: string; description: string | null; roles: string[] }

export const ROLE_BN: Record<Role, string> = { driver: 'ড্রাইভার', helper: 'হেল্পার' }
export const KIND_FALLBACK: Kind[] = [
  { code: 'truck', bn: 'ট্রাক', crew: ['driver', 'helper'] }, { code: 'covered_van', bn: 'কাভার্ড ভ্যান', crew: ['driver', 'helper'] },
  { code: 'pickup', bn: 'পিকআপ', crew: ['driver', 'helper'] }, { code: 'auto', bn: 'অটো', crew: ['driver'] },
  { code: 'cng', bn: 'সিএনজি', crew: ['driver'] }, { code: 'bike', bn: 'বাইক', crew: ['driver'] }, { code: 'van', bn: 'ভ্যান', crew: ['driver'] },
  { code: 'other', bn: 'অন্যান্য', crew: ['driver', 'helper'] },
]
export const kindsOf = (s: Settings | null | undefined): Kind[] => (s?.fleet?.kinds?.length ? s.fleet.kinds : KIND_FALLBACK)
export const kindName = (s: Settings | null | undefined, code: string) => kindsOf(s).find(k => k.code === code)?.bn ?? code
export const fnOn = (f: FleetFns | undefined, k: keyof FleetFns) => f?.[k] !== false
export const FUNCTIONS: Array<[keyof FleetFns, string, string]> = [
  ['khoraki', 'খোরাকি', 'ড্রাইভার-হেল্পারের দৈনিক খোরাকি, ম্যানেজার দিলে হিসাব খাতায় ভাউচারসহ ওঠে'],
  ['garage', 'অটোর গ্যারেজ চার্জ', 'ম্যানেজার প্রতিদিন লেখেন চার্জ হয়েছে কি না, বিল কত'],
  ['hub_report', 'হাব রিপোর্ট', 'ড্রাইভার-হেল্পার জানান কোন হাব লোডে/আনলোডে দেরি করছে, কোন হাব ট্রিপ দেয়নি'],
  ['service', 'সার্ভিস / পার্টস রিকুইজিশন', 'ফরম্যাট অনুযায়ী, ছবিসহ'],
  ['fuel', 'তেল ও তেলের স্লিপ', 'ড্রাইভার দেন, ম্যানেজার অনুমোদন দিলে খাতায় ভাউচারসহ ওঠে'],
]
export const REPORT_STATUS: Record<ReportStatus, [string, 'ok' | 'warn' | 'bad' | 'info']> = {
  on_time: ['ঠিক সময়ে লোড করে ছেড়েছে', 'ok'], load_late: ['লোড করে ছাড়তে দেরি', 'warn'], unload_late: ['আনলোডে দেরি', 'warn'],
  no_trip: ['আজ ট্রিপ দেয়নি', 'bad'], other: ['অন্য সমস্যা', 'info'],
}
export const COST_KIND: Record<string, string> = {
  fuel: 'তেল', charge: 'গ্যারেজ চার্জ', service: 'সার্ভিসিং', repair: 'মেরামত', parts: 'পার্টস', tyre: 'টায়ার', oil: 'ইঞ্জিন অয়েল', wash: 'ওয়াশ', toll: 'টোল',
  parking: 'পার্কিং', fine: 'জরিমানা', rent: 'ভাড়া', paper: 'কাগজপত্র', khoraki: 'খোরাকি', other: 'অন্যান্য',
}
export const REQ_KIND: Record<ReqKind, string> = { service: 'সার্ভিসিং লাগবে', parts: 'পার্টস লাগবে', problem: 'গাড়ির সমস্যা', other: 'অন্য রিকুইজিশন' }
export const REQ_STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  open: ['অপেক্ষায়', 'warn'], accepted: ['গ্রহণ — কাজ হবে', 'info'], done: ['কাজ শেষ', 'ok'], rejected: ['না', 'bad'], cancelled: ['বাতিল', 'neutral'],
}
export const COST_STATUS: Record<string, [string, 'ok' | 'warn' | 'bad']> = { submitted: ['অনুমোদন বাকি', 'warn'], approved: ['অনুমোদিত', 'ok'], rejected: ['বাতিল', 'bad'] }
export const EVENT_BN: Record<string, string> = {
  created: 'গাড়ি যোগ', hub: 'হাব বদল', details: 'তথ্য বদল', status: 'অবস্থা বদল', archived: 'তালিকা থেকে সরানো',
  crew_set: 'দায়িত্ব দেওয়া', crew_removed: 'দায়িত্ব থেকে সরানো', allowance: 'খোরাকি বদল',
}
export const VEHICLE_STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  active: ['চালু', 'ok'], workshop: ['গ্যারেজে / মেরামতে', 'warn'], off_road: ['রাস্তায় নামছে না', 'bad'], inactive: ['বন্ধ', 'neutral'],
}

const BN: Array<[RegExp, string]> = [
  [/Could not find the function|PGRST202|function public\.(fleet|vehicle)_\w+.*does not exist/i, 'গাড়ির নতুন অংশ ডাটাবেসে এখনো বসানো হয়নি — বসানো হলে এই পাতা চালু হবে'],
  [/has no (driver|helper)/i, 'এই ধরনের গাড়িতে এই দায়িত্ব নেই'],
  [/No active employee with ID/i, 'এই আইডির কোনো সক্রিয় কর্মী নেই'],
  [/already has this vehicle in the other role/i, 'এই কর্মী এই গাড়ির অন্য দায়িত্বে আছেন'],
  [/switched off/i, 'এই কাজটা গাড়ি সেটিংসে বন্ধ করা আছে'],
  [/Write what happened|Write why|Write what you need/i, 'কী হয়েছে লিখুন'],
  [/hub in this vehicle's zone|outside/i, 'এই গাড়ির জোনের একটা হাব বেছে নিন'],
  [/Only this vehicle's driver or helper/i, 'শুধু এই গাড়ির ড্রাইভার বা হেল্পার রিপোর্ট দেন'],
  [/Up to six photos/i, 'সর্বোচ্চ ৬টা ছবি'],
  [/Choose the hub/i, 'কোন হাবে দেবেন, বেছে নিন'],
  [/Write the vehicle's name/i, 'গাড়ির নাম লিখুন'],
  [/future/i, 'ভবিষ্যতের তারিখ দেওয়া যায় না'],
  [/Not authori[sz]ed|42501|permission denied/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export const fleetFriendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  return BN.find(([re]) => re.test(m))?.[1] ?? m
}

export const fleet = {
  settings: () => rpc<Settings>('vehicle_settings'),
  configure: (key: 'fleet' | 'request_formats', value: unknown) => rpc<void>('vehicle_configure', { p_key: key, p_value: value }),
  approvers: () => rpc<Approver[]>('fleet_approvers'),
  board: (hub?: string | null) => rpc<BoardRow[]>('fleet_board', { p_hub: hub ?? null }),
  waiting: (hub?: string | null) => rpc<{ logs: WaitLog[]; requests: WaitReq[] }>('fleet_waiting', { p_hub: hub ?? null }),
  events: (vehicle?: string | null) => rpc<FleetEvent[]>('fleet_events', { p_vehicle: vehicle ?? null, p_limit: 300 }),
  reports: (from: string, to: string, hub?: string | null) => rpc<HubReport[]>('fleet_hub_reports', { p_from: from, p_to: to, p_hub: hub ?? null }),
  mine: () => rpc<Mine | null>('fleet_mine'),
  save: (v: { name: string; reg: string; kind: string; hub: string; status?: string; id?: string | null }) =>
    rpc<string>('fleet_vehicle_save', { p_name: v.name, p_reg_no: v.reg || null, p_kind: v.kind, p_hub: v.hub, p_status: v.status ?? 'active', p_id: v.id ?? null }),
  archive: (id: string, reason: string) => rpc<void>('vehicle_archive', { p_vehicle: id, p_reason: reason }),
  setCrew: (vehicle: string, role: Role, code: string, allowance: number | null) =>
    rpc<string>('fleet_set_crew', { p_vehicle: vehicle, p_role: role, p_employee_code: code, p_allowance: allowance, p_reason: null }),
  removeCrew: (vehicle: string, role: Role, reason: string) => rpc<void>('vehicle_release', { p_vehicle: vehicle, p_reason: reason, p_role: role }),
  khoraki: (vehicle: string, date?: string | null) =>
    rpc<Array<{ name: string; role: Role; amount?: number; skipped?: boolean } & Partial<Posted>>>('fleet_khoraki_post', { p_vehicle: vehicle, p_date: date || null }),
  garage: (vehicle: string, charged: boolean, cost: number | null, place?: string | null, note?: string | null, date?: string | null) =>
    rpc<Posted & { day: string }>('fleet_garage_save', { p_vehicle: vehicle, p_date: date || null, p_charged: charged, p_cost: cost, p_place: place || null, p_note: note || null }),
  approve: (log: string, note?: string | null) => rpc<Posted>('fleet_approve', { p_log: log, p_note: note || null }),
  reject: (log: string, note: string) => rpc<void>('vehicle_log_decide', { p_id: log, p_approve: false, p_note: note }),
  post: (log: string) => rpc<Posted>('fleet_post', { p_log: log }),
  requestAccept: (id: string, note?: string | null) => rpc<void>('vehicle_request_update', { p_id: id, p_status: 'accepted', p_note: note || null, p_cost: null }),
  requestReject: (id: string, note: string) => rpc<void>('vehicle_request_update', { p_id: id, p_status: 'rejected', p_note: note, p_cost: null }),
  requestDone: (id: string, cost: number | null, note?: string | null) => rpc<Posted>('fleet_request_done', { p_id: id, p_cost: cost, p_note: note || null }),
  request: (r: { vehicle: string; kind: ReqKind; title: string; data: Record<string, string>; urgent: boolean; photos: string[] }) =>
    rpc<string>('fleet_request', { p_vehicle: r.vehicle, p_kind: r.kind, p_title: r.title, p_data: r.data, p_priority: r.urgent ? 'urgent' : 'normal', p_photos: r.photos }),
  report: (r: { vehicle: string; hub: string; status: ReportStatus; minutes?: number | null; note?: string | null; photo?: string | null }) =>
    rpc<string>('fleet_hub_report', { p_vehicle: r.vehicle, p_hub: r.hub, p_status: r.status, p_minutes: r.minutes ?? null, p_note: r.note || null, p_photo: r.photo || null, p_date: null }),
  fuel: (f: { vehicle: string; amount: number; litres: number | null; pump: string | null; slip: string | null; note: string | null }) =>
    rpc<string>('vehicle_log_save', { p_vehicle: f.vehicle, p_kind: 'fuel', p_amount: f.amount, p_date: null, p_odometer: null, p_litres: f.litres, p_vendor: f.pump,
      p_bill_no: null, p_note: f.note, p_driver_code: null, p_da_expense: null, p_id: null, p_slip: f.slip }),
  /** A photo or slip goes to the private bucket, under the vehicle's folder (the database checks the person may). */
  upload: async (vehicle: string, file: File) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${vehicle}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error } = await supabase.storage.from('vehicle-docs').upload(path, file, { contentType: file.type || undefined, upsert: false }); fail(error as { message: string } | null)
    return path
  },
  photoUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from('vehicle-docs').createSignedUrl(path, 300); fail(error as { message: string } | null); return data!.signedUrl
  },
}
