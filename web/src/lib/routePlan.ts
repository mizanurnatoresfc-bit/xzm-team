// রুট: আজকের পার্সেল পরিকল্পনা — the day's numbers of a hub, who is here, who takes how many parcels on which route.
// The database checks every rule again (route_plan_save, route_plan_decide …). The suggestion (routePlanCore.ts) only fills the form.
import { supabase } from './supabase'
import { hasGps, RouteError } from './routes'
import type { ParsedPdf, PdfKind } from './planPdf'
import type { MyParcels, PickupMode, PlanData, PlanHub, PlanPart, PlanRoute, PlanRules, RoadKm } from './routePlanCore.ts'

export * from './routePlanCore.ts'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new RouteError(error.message, error.code)
  return data as T
}
const num = (v: unknown) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v))

export type PlanSave = { arrived?: number | null; carried?: number | null; sent?: number | null; cancelled?: number | null; pickups?: number | null; note?: string | null
  source?: Record<string, string>; route_parcels?: Record<string, number>; unassigned?: number
  people?: Array<{ employee_id: string; kind: 'rider' | 'helper'; present: boolean | null; capacity: number | null; parcels: number; pickups: number; detail: PlanPart[]; note?: string | null }> }
export type StaffSetup = { employee_id: string; day_parcels: number | null; helper: boolean; helper_max: number | null; pickup: boolean }

export type PlanFile = { id: string; kind: PdfKind; doc_no: string; doc_date: string | null; hub_text: string | null; from_text: string | null
  rider_code: string | null; rider_name: string | null; employee_id: string | null; on_report: boolean; counts: Record<string, number>; parcels: number
  warnings: string[]; file_name: string | null; uploads: number; uploaded_by_name: string | null; updated_at: string }
export type PlanFiles = { date: string; can_upload: boolean; files: PlanFile[]; unlisted: number }

export const planApi = {
  files: async (hub: string, date: string) => { const f = await rpc<PlanFiles>('route_plan_files', { p_hub: hub, p_date: date }); return { ...f, files: f.files ?? [], unlisted: Number(f.unlisted) || 0 } },
  saveFile: (hub: string, date: string, p: ParsedPdf & { file_name: string }) => rpc<string>('route_plan_file_save', { p_hub: hub, p_date: date, p }),
  removeFile: (file: string, reason: string) => rpc<void>('route_plan_file_remove', { p_file: file, p_reason: reason }),
  mapRider: (hub: string, code: string, employee: string) => rpc<void>('route_plan_map_rider', { p_hub: hub, p_code: code, p_employee: employee }),
  hubs: (date: string) => rpc<PlanHub[]>('route_plan_hubs', { p_date: date }),
  get: async (hub: string, date: string): Promise<PlanData> => {
    const d = await rpc<PlanData>('route_plan_get', { p_hub: hub, p_date: date })
    return { ...d, hub: { ...d.hub, lat: num(d.hub.lat), lng: num(d.hub.lng) },
      rules: { ...d.rules, near_km: Number(d.rules.near_km) },
      load: { ...d.load, rider_parcels: num(d.load.rider_parcels), pickup_weight: Number(d.load.pickup_weight) },
      routes: (d.routes ?? []).map(r => ({ ...r, avg_parcels: num(r.avg_parcels), riders: r.riders ?? [], stops: (r.stops ?? []).map(s => ({ ...s, lat: num(s.lat), lng: num(s.lng) })) })),
      people: d.people ?? [], plan: d.plan ? { ...d.plan, lines: d.plan.lines ?? [], route_parcels: d.plan.route_parcels ?? {}, source: d.plan.source ?? {} } : null }
  },
  save: (hub: string, date: string, p: PlanSave, send = false) => rpc<string>('route_plan_save', { p_hub: hub, p_date: date, p, p_send: send }),
  decide: (plan: string, ok: boolean, note?: string) => rpc<void>('route_plan_decide', { p_plan: plan, p_ok: ok, p_note: note || null }),
  reopen: (plan: string, reason: string) => rpc<void>('route_plan_reopen', { p_plan: plan, p_reason: reason }),
  remove: (plan: string, reason: string) => rpc<void>('route_plan_remove', { p_plan: plan, p_reason: reason }),
  setup: (hub: string, p: { pickup_mode?: PickupMode; pickup_weight?: number; staff?: StaffSetup[] }) => rpc<void>('route_plan_setup', { p_hub: hub, p }),
  saveRules: (zone: string, rules: Partial<PlanRules>) => rpc<PlanRules>('route_plan_rules_save', { p_zone: zone, p: rules }),
  mine: () => rpc<MyParcels | null>('route_plan_mine'),
}

const BN: Array<[RegExp, string]> = [
  [/approved\. It must be reopened/i, 'পরিকল্পনা অনুমোদিত — বদলাতে হলে আগে আবার খুলতে হবে'],
  [/already approved/i, 'পরিকল্পনা আগেই অনুমোদিত'],
  [/30 days back to tomorrow/i, 'পরিকল্পনা করা যায় ৩০ দিন আগে থেকে আগামীকাল পর্যন্ত'],
  [/does not work at this hub|not an active staff/i, 'এই কর্মী এই হাবের সক্রিয় কর্মী নন'],
  [/do not add up/i, 'একজনের পার্সেলের ভাগগুলোর যোগফল মোটের সাথে মিলছে না'],
  [/route does not belong/i, 'একটা রুট এই হাবের নয়'],
  [/at least one person parcels|Nobody has parcels/i, 'আগে অন্তত একজনকে পার্সেল দিন'],
  [/Only a sent plan/i, 'শুধু পাঠানো পরিকল্পনা ফেরত দেওয়া যায়'],
  [/Only an approved plan/i, 'শুধু অনুমোদিত পরিকল্পনা আবার খোলা যায়'],
  [/Write why/i, 'কারণ লিখুন'],
  [/must be a whole number|must be between/i, 'একটা সংখ্যা ঠিক নেই'],
  [/cannot be zero/i, 'নির্দিষ্ট সংখ্যা শূন্য হয় না — ফাঁকা রাখুন'],
  [/0 to 5 deliveries/i, 'একটা পিকআপ ০ থেকে ৫টা ডেলিভারির সমান ধরা যায়'],
  [/outside its allowed range|wrong kind of value|Unknown plan rule/i, 'নিয়মের মান ঠিক নেই'],
  [/too long/i, 'নোট অনেক বড়'],
  [/on the plan twice/i, 'একজন দুইবার আছেন'],
  [/already uploaded for another hub/i, 'এই পিডিএফ আগেই অন্য হাবের জন্য আপলোড হয়েছে'],
  [/Not an Update list or a Dispatch/i, 'এটা Update list বা Dispatch শিটের পিডিএফ নয়'],
  [/No parcel rows found|number not found|has no parcels/i, 'পিডিএফ থেকে পার্সেলের লাইন পড়া যায়নি — প্যানেল থেকে আবার প্রিন্ট করে দিন'],
  [/too many (pages|parcels)/i, 'পিডিএফটা অনেক বড়'],
  [/No uploaded list of this hub/i, 'এই রাইডার আইডির কোনো লিস্ট এই হাবে আপলোড হয়নি'],
  [/Invalid PDF|password|PDF header/i, 'ফাইলটা পিডিএফ হিসেবে খোলা যায়নি'],
  [/42501|Not authorised|permission denied/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export const planFriendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  return BN.find(([re]) => re.test(m))?.[1] ?? m
}

export async function nearbyRouteRoadKm(routes: PlanRoute[]): Promise<RoadKm> {
  const points = routes.flatMap(route => {
    const stop = route.stops.find(hasGps)
    return stop ? [{ id: route.id, lat: stop.lat!, lng: stop.lng! }] : []
  })
  if (points.length < 2) return {}
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`, {
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('Road distances unavailable')
  const data = await response.json() as { code: string; distances?: Array<Array<number | null>> }
  const distances = data.distances
  if (data.code !== 'Ok' || !distances || distances.length !== points.length
      || distances.some(row => !Array.isArray(row) || row.length !== points.length)) {
    throw new Error('Road distances unavailable')
  }
  return Object.fromEntries(points.map((from, i) => [from.id, Object.fromEntries(points.map((to, j) => {
    const meters = distances[i][j]
    return [to.id, typeof meters === 'number' && Number.isFinite(meters) && meters >= 0 ? meters / 1000 : null]
  }))]))
}
