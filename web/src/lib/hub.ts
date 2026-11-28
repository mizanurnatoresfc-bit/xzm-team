// Hub Management: one hub, today. Reads go through RLS; changes go through the same
// database functions the rest of the app uses, so the permission checks stay in the database.
import { supabase } from './supabase'
import type { AttendanceRow, Employee } from './hr'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

export type HubTask = {
  id: string; task_no: string | null; title: string; description: string | null; hub_id: string | null; assigned_to: string
  due_date: string; priority: 'low' | 'normal' | 'high' | 'urgent'; status: 'assigned' | 'in_progress' | 'submitted' | 'completed' | 'cancelled'
  progress_note: string | null; created_at: string
}
export type Pickup = {
  id: string; submission_no: string | null; pickup_date: string; hub_id: string; merchant_id: string; trip_no: number; source: string
  submitted_by: string | null; parcel_count: number; cod_amount: number; collection_amount: number; note: string | null
  status: 'pending' | 'verified' | 'approved' | 'rejected'; created_at: string
}
export type Merchant = { id: string; code: string; name: string; phone: string | null; hub_id: string; status: string }
export type HubMetric = {
  id: string; hub_id: string; zone_id: string; metric_date: string; pickup_count: number; delivery_count: number; pending_parcels: number
  merchant_count: number; rider_count: number; cash_collected: number; expenses: number; note: string | null; status: 'submitted' | 'verified'
}
export type Person = { id: string; full_name: string | null; email: string | null }
export type LateRow = AttendanceRow & { check_in: string | null }

export const TASK_STATUS: Record<HubTask['status'], [string, string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  assigned: ['দেওয়া হয়েছে', 'Assigned', 'info'], in_progress: ['চলছে', 'In progress', 'warn'], submitted: ['জমা হয়েছে', 'Submitted', 'info'],
  completed: ['শেষ', 'Done', 'ok'], cancelled: ['বাতিল', 'Cancelled', 'neutral'],
}
export const PRIORITY: Record<HubTask['priority'], [string, string]> = {
  low: ['কম', 'Low'], normal: ['সাধারণ', 'Normal'], high: ['জরুরি', 'High'], urgent: ['খুব জরুরি', 'Urgent'],
}
export const PICKUP_STATUS: Record<Pickup['status'], [string, string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  pending: ['অপেক্ষায়', 'Pending', 'warn'], verified: ['যাচাই হয়েছে', 'Verified', 'info'], approved: ['অনুমোদিত', 'Approved', 'ok'], rejected: ['বাতিল', 'Rejected', 'bad'],
}

/** Icon and order for a post name, so the team cards read the same in every hub. */
const POST_ICON: Array<[RegExp, string, number]> = [
  [/zonal|জোনাল/i, 'map', 1], [/asst|assistant|সহকারী/i, 'shield', 3], [/manager|ম্যানেজার/i, 'shield', 2], [/hub\s*cc|cc|সিসি/i, 'cc', 4],
  [/data\s*entry|ডাটা|ডেটা/i, 'form', 5], [/account|হিসাব/i, 'cash', 6], [/rider|রাইডার/i, 'truck', 7], [/driver|ড্রাইভার/i, 'truck', 8],
  [/short|sort|load|সর্টিং|লোডার/i, 'box', 9], [/helper|হেল্পার/i, 'users', 10], [/security|guard|সিকিউরিটি|গার্ড/i, 'key', 11],
]
export function postIcon(name: string): { icon: string; order: number } {
  const hit = POST_ICON.find(([re]) => re.test(name))
  return hit ? { icon: hit[1], order: hit[2] } : { icon: 'user', order: 50 }
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
export { today as hubToday }

export const hubApi = {
  team: async (hub: string, status: string | null) => {
    let q = supabase.from('employees').select('*, positions(level)').eq('hub_id', hub).is('archived_at', null).order('employee_code', { ascending: true }).limit(1000)
    if (status) q = q.eq('status', status)
    const { data, error } = await q; fail(error)
    // People on a zone / head-office post (e.g. Zonal Manager) are not the hub's fixed staff.
    return ((data ?? []) as Array<Employee & { positions?: { level?: string } | null }>)
      .filter(e => (e.positions?.level ?? 'hub') === 'hub').map(({ positions: _p, ...e }) => e as Employee)
  },
  attendance: async (date: string, ids: string[]) => {
    if (!ids.length) return [] as LateRow[]
    const { data, error } = await supabase.from('attendance_records').select('*').eq('work_date', date).in('employee_id', ids); fail(error)
    return (data ?? []) as LateRow[]
  },
  /** Mark late with the arrival time (HH:MM, Dhaka). Updates the day's row if there is one. */
  markLate: async (employee: string, date: string, time: string, note: string, existing?: LateRow) => {
    const checkIn = new Date(`${date}T${time}:00+06:00`).toISOString()
    if (existing) {
      const { error } = await supabase.from('attendance_records').update({ status: 'late', check_in: checkIn, note: note || existing.note || 'Late' }).eq('id', existing.id); fail(error)
    } else {
      const { error } = await supabase.from('attendance_records').insert({ employee_id: employee, work_date: date, status: 'late', check_in: checkIn, source: 'manual', note: note || null }); fail(error)
    }
  },
  tasks: async (hub: string) => {
    const { data, error } = await supabase.from('tasks').select('*').eq('hub_id', hub).order('due_date', { ascending: true }).limit(500); fail(error)
    return (data ?? []) as HubTask[]
  },
  people: async () => {
    const { data, error } = await supabase.from('profiles').select('id, full_name, email').eq('status', 'active').is('archived_at', null).order('full_name'); fail(error)
    return (data ?? []) as Person[]
  },
  assignTask: (a: { title: string; assignee: string; due: string; hub: string; description: string | null; priority: string }) =>
    rpc<string>('task_assign', { p_title: a.title, p_assignee: a.assignee, p_due: a.due, p_zone: null, p_hub: a.hub,
      p_description: a.description, p_priority: a.priority, p_requires_submission: false, p_manager: null, p_employee: null }),
  taskProgress: (id: string, status: string, note: string) => rpc<void>('task_update_progress', { p_task: id, p_status: status, p_note: note }),
  taskReassign: (id: string, assignee: string, due: string, reason: string) => rpc<void>('task_reassign', { p_task: id, p_assignee: assignee, p_due: due, p_reason: reason }),
  taskComplete: (id: string, note: string) => rpc<void>('task_complete', { p_task: id, p_note: note }),
  taskCancel: (id: string, reason: string) => rpc<void>('task_cancel', { p_task: id, p_reason: reason }),

  pickups: async (hub: string, date: string) => {
    const { data, error } = await supabase.from('pickup_submissions').select('*').eq('hub_id', hub).eq('pickup_date', date).order('created_at', { ascending: false }); fail(error)
    return (data ?? []) as Pickup[]
  },
  merchants: async (hub: string) => {
    const { data, error } = await supabase.from('merchants').select('id, code, name, phone, hub_id, status').eq('hub_id', hub).is('archived_at', null).order('name'); fail(error)
    return (data ?? []) as Merchant[]
  },
  addMerchant: async (m: { code: string; name: string; phone: string | null; hub: string; zone: string }) => {
    const { error } = await supabase.from('merchants').insert({ code: m.code, name: m.name, phone: m.phone, hub_id: m.hub, zone_id: m.zone, status: 'active' }); fail(error)
  },
  submitPickup: (a: { source: string; date: string; hub: string; merchant: string; parcels: number; cod: number; collection: number; trip: number; note: string | null }) =>
    rpc<string>('ops_submit_pickup', { p_source: a.source, p_date: a.date, p_hub: a.hub, p_merchant: a.merchant, p_parcels: a.parcels,
      p_cod: a.cod, p_collection: a.collection, p_rider: null, p_trip: a.trip, p_note: a.note }),
  verifyPickup: (id: string) => rpc<void>('ops_verify_pickup', { p_id: id }),
  approvePickup: (id: string, note: string | null) => rpc<void>('ops_approve_pickup', { p_id: id, p_note: note }),
  rejectPickup: (id: string, reason: string) => rpc<void>('ops_reject_pickup', { p_id: id, p_reason: reason }),
  withdrawPickup: (id: string, reason: string) => rpc<void>('ops_withdraw_pickup', { p_id: id, p_reason: reason }),

  metric: async (hub: string, date: string) => {
    const { data, error } = await supabase.from('hub_daily_metrics').select('*').eq('hub_id', hub).eq('metric_date', date).maybeSingle(); fail(error)
    return (data ?? null) as HubMetric | null
  },
  saveMetric: async (m: Omit<HubMetric, 'id' | 'status'>, id?: string) => {
    if (id) { const { error } = await supabase.from('hub_daily_metrics').update(m).eq('id', id); fail(error) }
    else { const { error } = await supabase.from('hub_daily_metrics').insert({ ...m, source: 'manual', status: 'submitted' }); fail(error) }
  },
  verifyMetric: (id: string) => rpc<void>('zm_verify_hub_metric', { p_id: id }),
  reopenMetric: (id: string, reason: string) => rpc<void>('zm_reopen_hub_metric', { p_id: id, p_reason: reason }),
}

// ---------------------------------------------------------------- rider routes and duties
export type HubRoute = { id: string; hub_id: string; zone_id: string; code: string; name: string; areas: string[]; note: string | null; status: string }
export type RiderRoute = { id: string; route_id: string; employee_id: string; hub_id: string; effective_from: string; effective_to: string | null }
export type VerifyMode = 'manual' | 'automatic' | 'both'
export type ReviewerRole = 'hub_manager' | 'zonal_manager' | 'super_admin'
/** job_duties row. Phase 2A (XZM-013) added optional deadline_local, verification_mode, evidence_source, reviewer_role;
 *  older rows and older clients may not carry these — the UI treats them as optional, Asia/Dhaka wall clock for deadline. */
export type Duty = {
  id: string; position_id: string | null; employee_id: string | null; zone_id: string | null; title: string; details: string | null
  frequency: string; sort: number; focus?: string | null
  hub_id?: string | null; deadline_local?: string | null; verification_mode?: VerifyMode | null
  evidence_source?: string | null; reviewer_role?: ReviewerRole | null
}
export const FREQ: Record<string, [string, string]> = { daily: ['প্রতিদিন', 'Daily'], weekly: ['সাপ্তাহিক', 'Weekly'], monthly: ['মাসিক', 'Monthly'], as_needed: ['দরকার হলে', 'As needed'] }
export const VERIFY_MODE: Record<VerifyMode, [string, string]> = { manual: ['ম্যানুয়াল যাচাই', 'Manual'], automatic: ['স্বয়ংক্রিয় যাচাই', 'Automatic'], both: ['দুটোই', 'Both'] }
export const REVIEWER: Record<ReviewerRole, [string, string]> = { hub_manager: ['হাব ম্যানেজার', 'Hub manager'], zonal_manager: ['জোনাল ম্যানেজার', 'Zonal manager'], super_admin: ['সুপার অ্যাডমিন', 'Super admin'] }
/** Evidence sources the UI offers for automatic/both verification. Adding more keys is safe — the backend stores the string. */
export const EVIDENCE_SOURCE: Record<string, [string, string]> = {
  attendance_self_marks: ['নিজে হাজিরা দেওয়া', 'Self attendance mark'],
  attendance_records: ['হাজিরা খাতা', 'Attendance register'],
  wf_morning_subs: ['সকালের কাজ জমা', 'Morning submission'],
  pickup_submissions: ['পিকআপ জমা', 'Pickup submission'],
  pickup_consolidations: ['পিকআপ কনসলিডেশন', 'Pickup consolidation'],
  route_day_plans: ['রুট প্ল্যান', 'Route day plan'],
  route_stop_visits: ['রুট স্টপ ভিজিট', 'Route stop visit'],
  wf_daily_ops: ['দৈনিক কাজের খাতা', 'Daily ops sheet'],
  sorting_handovers: ['সর্টিং হ্যান্ডওভার', 'Sorting handover'],
  sorting_dispatches: ['সর্টিং ডিসপ্যাচ', 'Sorting dispatch'],
  sorting_driver_reports: ['সর্টিং ড্রাইভার রিপোর্ট', 'Sorting driver report'],
  issues: ['সমস্যা রিপোর্ট', 'Issue report'],
  hub_ops_reports: ['হাব অপস রিপোর্ট', 'Hub ops report'],
  da_import_reports: ['DA ইমপোর্ট', 'DA import'],
  vehicle_day_logs: ['গাড়ির দৈনিক লগ', 'Vehicle day log'],
  hub_ops_boss_reports: ['বসের রিপোর্ট', 'Boss report'],
}

export const routesApi = {
  list: async (hub: string) => {
    const { data, error } = await supabase.from('hub_routes').select('*').eq('hub_id', hub).is('archived_at', null).order('code'); fail(error)
    return (data ?? []) as HubRoute[]
  },
  riders: async (hub: string) => {
    const { data, error } = await supabase.from('rider_routes').select('*').eq('hub_id', hub).is('effective_to', null); fail(error)
    return (data ?? []) as RiderRoute[]
  },
  save: async (r: { hub_id: string; zone_id: string; code: string; name: string; areas: string[]; note: string | null }, id?: string) => {
    if (id) { const { error } = await supabase.from('hub_routes').update(r).eq('id', id); fail(error); return id }
    const { data, error } = await supabase.from('hub_routes').insert(r).select('id').single(); fail(error); return (data as { id: string }).id
  },
  archive: async (id: string, reason: string) => {
    const { error } = await supabase.from('hub_routes').update({ archived_at: new Date().toISOString(), archive_reason: reason, status: 'inactive' }).eq('id', id); fail(error)
    const { error: e2 } = await supabase.from('rider_routes').update({ effective_to: today() }).eq('route_id', id).is('effective_to', null); fail(e2)
  },
  /** Make the route's riders exactly this list (ends the others today). */
  setRiders: async (route: HubRoute, employees: string[], current: RiderRoute[]) => {
    const now = current.filter(c => c.route_id === route.id)
    const gone = now.filter(c => !employees.includes(c.employee_id)).map(c => c.id)
    const add = employees.filter(e => !now.some(c => c.employee_id === e))
    if (gone.length) { const { error } = await supabase.from('rider_routes').update({ effective_to: today() }).in('id', gone); fail(error) }
    if (add.length) { const { error } = await supabase.from('rider_routes').insert(add.map(e => ({ route_id: route.id, employee_id: e, hub_id: route.hub_id, zone_id: route.zone_id }))); fail(error) }
  },
  mine: async () => {
    const { data, error } = await supabase.from('rider_routes').select('route_id, hub_routes(code, name, areas)').is('effective_to', null); fail(error)
    return ((data ?? []) as unknown as Array<{ route_id: string; hub_routes: { code: string; name: string; areas: string[] } | null }>)
  },
}

export const dutiesApi = {
  ofPosition: async (position: string) => {
    const { data, error } = await supabase.from('job_duties').select('*').eq('position_id', position).is('archived_at', null).order('sort').order('title'); fail(error)
    return (data ?? []) as Duty[]
  },
  ofEmployee: async (employee: string) => {
    const { data, error } = await supabase.from('job_duties').select('*').eq('employee_id', employee).is('archived_at', null).order('sort').order('title'); fail(error)
    return (data ?? []) as Duty[]
  },
  mine: (employee?: string) => rpc<Array<{ id: string; title: string; details: string | null; frequency: string; source: 'person' | 'post' }>>('my_duties', { p_employee: employee ?? null }),
  /** Phase 2A (XZM-013) extends the payload with optional deadline_local, verification_mode, evidence_source, reviewer_role,
   *  hub_id. The payload intentionally omits undefined keys so older servers accept it; when the Phase 2A columns are not
   *  yet live the save falls back and retries without them, so the frontend ships ahead of the backend without crashing. */
  save: async (d: { position_id: string | null; employee_id: string | null; zone_id: string | null; title: string; details: string | null;
    frequency: string; sort: number; focus?: string | null; hub_id?: string | null; deadline_local?: string | null;
    verification_mode?: VerifyMode | null; evidence_source?: string | null; reviewer_role?: ReviewerRole | null }, id?: string) => {
    const payload = Object.fromEntries(Object.entries(d).filter(([_k, v]) => v !== undefined))
    const run = (p: Record<string, unknown>) => id ? supabase.from('job_duties').update(p).eq('id', id) : supabase.from('job_duties').insert(p)
    let { error } = await run(payload)
    if (error && /deadline_local|verification_mode|evidence_source|reviewer_role|hub_id/i.test(error.message)) {
      // Phase 2A columns not yet live on this server — retry without them so the base save still goes through.
      const { deadline_local: _1, verification_mode: _2, evidence_source: _3, reviewer_role: _4, hub_id: _5, ...rest } = payload as Record<string, unknown>
      void _1; void _2; void _3; void _4; void _5
      ;({ error } = await run(rest))
    }
    fail(error)
  },
  remove: async (id: string) => {
    const { error } = await supabase.from('job_duties').update({ archived_at: new Date().toISOString(), archive_reason: 'removed' }).eq('id', id); fail(error)
  },
}
