// Vehicle Management (গাড়ি ম্যানেজমেন্ট): every vehicle A–Z — who holds it (hub follows the
// person), papers with expiry, fuel / service / repair logs, alerts and cost reports.
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type VehicleHub = { hub_id: string; code: string; name: string; zone_id: string; zone_name: string; can_edit: boolean; can_log: boolean }
export type VehicleRow = {
  id: string; code: string; name: string; kind: string; reg_no: string | null; model: string | null; fuel_type: string | null; owner_type: string; status: string
  hub_id: string | null; hub_name: string | null; hub_code: string | null; zone_id: string; zone_name: string | null
  holder_id: string | null; holder_code: string | null; holder_name: string | null; holder_mobile: string | null; since: string | null
  odometer: number; last_service_km: number | null; last_service_on: string | null; service_interval_km: number; km_since_service: number; service_due: boolean
  spent_30d: number; fuel_30d: number; litres_30d: number; spent_month: number; last_log: string | null
  docs_total: number; docs_expired: number; docs_expiring: number; next_expiry: string | null; next_expiry_kind: string | null
}
/** Full row of public.vehicles (the edit form). */
export type VehicleFull = {
  id: string; code: string; name: string; kind: string; reg_no: string | null; zone_id: string; hub_id: string | null; status: string; remarks: string | null
  model: string | null; model_year: number | null; color: string | null; engine_no: string | null; chassis_no: string | null
  owner_type: 'own' | 'rented' | 'staff_owned'; owner_name: string | null; owner_phone: string | null; monthly_rent: number | null
  purchase_date: string | null; purchase_price: number | null; odometer: number; fuel_type: string | null
  service_interval_km: number | null; last_service_km: number | null; last_service_on: string | null
}
export type VehicleDoc = { id: string; vehicle_id: string; kind: string; title: string | null; doc_no: string | null; issued_on: string | null; expires_on: string | null
  amount: number | null; file_path: string | null; note: string | null }
export type VehicleLog = { id: string; kind: string; log_date: string; odometer: number | null; litres: number | null; amount: number; vendor: string | null; bill_no: string | null
  driver_id: string | null; driver_name: string | null; driver_code: string | null; da_expense_id: string | null; note: string | null; created_by: string | null; created_at: string; mine: boolean }
export type VehicleAlert = { vehicle_id: string; vehicle: string; hub_name: string | null; kind: 'doc' | 'service' | 'no_holder' | 'status'; severity: 'bad' | 'warn' | 'info'; due: string | null; detail: string | null }
export type VehicleReport = { vehicle_id: string; vehicle: string; reg_no: string | null; hub_name: string | null; kind: string; lines: number; amount: number; litres: number | null; km_start: number | null; km_end: number | null }
export type VehicleHistory = { id: string; employee_id: string; employee_code: string; full_name: string; hub_name: string | null; effective_from: string; effective_to: string | null; reason: string; end_reason: string | null; moved_hub: boolean }
export type VehicleSettings = { doc_alert_days?: number; service_interval_km?: number; fuel_price?: Record<string, number> }

export const VEHICLE_KIND: Record<string, [string, string, string]> = {
  bike: ['বাইক', 'Bike', 'truck'], cng: ['সিএনজি', 'CNG', 'truck'], van: ['ভ্যান', 'Van', 'truck'], truck: ['ট্রাক', 'Truck', 'truck'],
  pickup: ['পিকআপ', 'Pickup', 'truck'], other: ['অন্যান্য', 'Other', 'box'],
}
export const VEHICLE_STATUS: Record<string, [string, string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  active: ['চালু', 'Active', 'ok'], workshop: ['গ্যারেজে / মেরামতে', 'In workshop', 'warn'], off_road: ['রাস্তায় নামছে না', 'Off road', 'bad'], inactive: ['বন্ধ', 'Inactive', 'neutral'],
}
export const OWNER_TYPE: Record<string, [string, string]> = { own: ['কোম্পানির নিজের', 'Company owned'], rented: ['ভাড়ায়', 'Rented'], staff_owned: ['স্টাফের নিজের', 'Staff owned'] }
export const FUEL_TYPE: Record<string, [string, string]> = {
  petrol: ['পেট্রোল', 'Petrol'], octane: ['অকটেন', 'Octane'], diesel: ['ডিজেল', 'Diesel'], cng: ['সিএনজি', 'CNG'], lpg: ['এলপিজি', 'LPG'], electric: ['ইলেকট্রিক', 'Electric'],
}
export const DOC_KIND: Record<string, [string, string]> = {
  registration: ['রেজিস্ট্রেশন (ব্লু বুক)', 'Registration'], fitness: ['ফিটনেস', 'Fitness'], tax_token: ['ট্যাক্স টোকেন', 'Tax token'],
  insurance: ['ইন্সুরেন্স', 'Insurance'], route_permit: ['রুট পারমিট', 'Route permit'], ownership: ['মালিকানার কাগজ', 'Ownership'], other: ['অন্যান্য', 'Other'],
}
export const LOG_KIND: Record<string, [string, string, string]> = {
  fuel: ['তেল / গ্যাস', 'Fuel', 'cash'], service: ['সার্ভিসিং', 'Service', 'gear'], repair: ['মেরামত', 'Repair', 'gear'], parts: ['পার্টস', 'Parts', 'box'],
  tyre: ['টায়ার', 'Tyre', 'box'], oil: ['ইঞ্জিন অয়েল', 'Engine oil', 'gear'], wash: ['ওয়াশ', 'Wash', 'sun'], toll: ['টোল', 'Toll', 'receipt'],
  parking: ['পার্কিং', 'Parking', 'receipt'], fine: ['মামলা / জরিমানা', 'Fine', 'alert'], rent: ['ভাড়া', 'Rent', 'wallet'], paper: ['কাগজপত্রের ফি', 'Papers fee', 'doc'], other: ['অন্যান্য', 'Other', 'form'],
}

export const vehicles = {
  settings: () => rpc<VehicleSettings>('vehicle_settings'),
  configure: (key: keyof VehicleSettings, value: unknown) => rpc<void>('vehicle_configure', { p_key: key, p_value: value }),
  hubs: () => rpc<VehicleHub[]>('vehicle_hubs'),
  overview: (hub?: string | null) => rpc<VehicleRow[]>('vehicle_overview', { p_hub: hub ?? null }),
  alerts: (hub?: string | null) => rpc<VehicleAlert[]>('vehicle_alerts', { p_hub: hub ?? null }),
  report: (from: string, to: string, hub?: string | null) => rpc<VehicleReport[]>('vehicle_report', { p_from: from, p_to: to, p_hub: hub ?? null }),
  one: async (id: string) => {
    const { data, error } = await supabase.from('vehicles').select('*').eq('id', id).single(); fail(error); return data as VehicleFull
  },
  save: (v: { name: string; code: string; kind: string; hub: string; reg?: string | null; status?: string; remarks?: string | null; id?: string | null; more?: Record<string, unknown> }) =>
    rpc<string>('vehicle_save', { p_name: v.name, p_code: v.code, p_kind: v.kind, p_hub: v.hub, p_reg_no: v.reg ?? null,
      p_status: v.status ?? 'active', p_remarks: v.remarks ?? null, p_id: v.id ?? null, p_more: v.more ?? {} }),
  archive: (id: string, reason: string) => rpc<void>('vehicle_archive', { p_vehicle: id, p_reason: reason }),
  /** Hand to a staff member by Employee ID. The vehicle's hub follows the person unless keepHub. */
  assign: (id: string, code: string, reason: string, from?: string | null, keepHub = false) =>
    rpc<string>('vehicle_assign', { p_vehicle: id, p_employee_code: code, p_reason: reason, p_from: from ?? null, p_keep_hub: keepHub }),
  release: (id: string, reason: string) => rpc<void>('vehicle_release', { p_vehicle: id, p_reason: reason }),
  history: (id: string) => rpc<VehicleHistory[]>('vehicle_history', { p_vehicle: id }),
  docs: async (id: string) => {
    const { data, error } = await supabase.from('vehicle_documents').select('*').eq('vehicle_id', id).is('archived_at', null).order('expires_on', { nullsFirst: false }); fail(error)
    return (data ?? []) as VehicleDoc[]
  },
  saveDoc: (d: { vehicle: string; kind: string; doc_no?: string | null; issued?: string | null; expires?: string | null; amount?: number | null; title?: string | null; note?: string | null; file?: string | null; id?: string | null }) =>
    rpc<string>('vehicle_document_save', { p_vehicle: d.vehicle, p_kind: d.kind, p_doc_no: d.doc_no ?? null, p_issued: d.issued || null, p_expires: d.expires || null,
      p_amount: d.amount ?? null, p_title: d.title ?? null, p_note: d.note ?? null, p_file: d.file ?? null, p_id: d.id ?? null }),
  archiveDoc: (id: string, reason: string) => rpc<void>('vehicle_document_archive', { p_id: id, p_reason: reason }),
  /** Upload a paper's picture / PDF to the private bucket; returns the stored path. */
  uploadDoc: async (vehicle: string, file: File) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${vehicle}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('vehicle-docs').upload(path, file, { contentType: file.type || undefined, upsert: false }); fail(error as { message: string } | null)
    return path
  },
  docUrl: async (path: string) => {
    const { data, error } = await supabase.storage.from('vehicle-docs').createSignedUrl(path, 300); fail(error as { message: string } | null); return data!.signedUrl
  },
  logs: (id: string, from?: string | null, to?: string | null) => rpc<VehicleLog[]>('vehicle_log_list', { p_vehicle: id, p_from: from ?? null, p_to: to ?? null }),
  saveLog: (x: { vehicle: string; kind: string; amount: number; date?: string | null; odometer?: number | null; litres?: number | null; vendor?: string | null; bill_no?: string | null
    note?: string | null; driver_code?: string | null; da_expense?: string | null; id?: string | null }) =>
    rpc<string>('vehicle_log_save', { p_vehicle: x.vehicle, p_kind: x.kind, p_amount: x.amount, p_date: x.date || null, p_odometer: x.odometer ?? null, p_litres: x.litres ?? null,
      p_vendor: x.vendor ?? null, p_bill_no: x.bill_no ?? null, p_note: x.note ?? null, p_driver_code: x.driver_code ?? null, p_da_expense: x.da_expense ?? null, p_id: x.id ?? null }),
  removeLog: (id: string, reason: string) => rpc<void>('vehicle_log_remove', { p_id: id, p_reason: reason }),
}

/** Days until a date (negative = past). */
export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null
  const t = new Date(d + 'T00:00:00'); const now = new Date(); now.setHours(0, 0, 0, 0)
  return Math.round((t.getTime() - now.getTime()) / 86400000)
}
export const today = () => new Date().toISOString().slice(0, 10)
export const monthStart = () => today().slice(0, 8) + '01'
