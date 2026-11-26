// রুট: আজকের পার্সেল পরিকল্পনা — the day's numbers of a hub, who is here, who takes how many parcels on which route.
// The database checks every rule again (route_plan_save, route_plan_decide …). The suggestion below only fills the form.
import { supabase } from './supabase'
import { hasGps, meters, RouteError, type LatLng, type ZoneRoute } from './routes'
import type { ParsedPdf, PdfKind } from './planPdf'

export type PlanRules = { avg_days: number; min_days: number; over_pct: number; near_km: number; helper_max: number; show_rider: boolean }
export type PickupMode = 'same' | 'separate' | 'mixed'
export type PlanLoad = { rider_parcels: number | null; pickup_mode: PickupMode; pickup_weight: number }
export type PlanRoute = Omit<ZoneRoute, 'road_path'> & { avg_parcels: number | null }
export type Presence = { state: 'present' | 'absent' | 'off' | null; source: 'attendance' | 'self' | 'hub_ops' | 'application' | null }
export type PlanPerson = {
  id: string; code: string | null; name: string; post: string | null; active: boolean; rider: boolean; routes: string[]
  fixed: number | null; helper: boolean; helper_max: number | null; pickup: boolean
  acc: { days: number; delivery: number; pickup: number }
  self: { days: number; delivery: number; returned: number; pickup: number }
  presence: Presence
  done: { self: { delivery: number; returned: number; pickup: number } | null; acc: { delivery: number; pickup: number } | null }
}
export type PlanPart = { route_id?: string | null; parcels: number; for?: string | null }
export type PlanLine = { employee_id: string; kind: 'rider' | 'helper'; present: boolean | null; capacity: number | null; parcels: number; pickups: number; detail: PlanPart[]; note: string | null }
export type PlanStatus = 'draft' | 'sent' | 'approved'
export type Plan = {
  id: string; hub_id: string; plan_date: string; arrived: number | null; carried: number | null; sent: number | null; cancelled: number | null; pickups: number | null
  source: Record<string, string>; route_parcels: Record<string, number>; unassigned: number; note: string | null; status: PlanStatus; version: number
  sent_by_name: string | null; sent_at: string | null; decided_by_name: string | null; decided_at: string | null; decide_note: string | null; updated_at: string; lines: PlanLine[]
}
export type PlanData = {
  date: string; today: string; hub: { id: string; code: string; name: string; zone_id: string; lat: number | null; lng: number | null }
  rules: PlanRules; load: PlanLoad
  can: { create: boolean; edit: boolean; archive: boolean; approve: boolean; configure: boolean; rules: boolean }
  plan: Plan | null; routes: PlanRoute[]; people: PlanPerson[]
  hints: { ops_parcels: number | null; ops_pickups: number | null; left_before: number | null; unassigned_before: number | null; metric_delivery: number | null; metric_pickup: number | null }
}
export type PlanHub = { id: string; code: string; name: string; zone_id: string; zone_name: string
  plan: { id: string; status: PlanStatus; arrived: number | null; carried: number | null; sent: number | null; cancelled: number | null; pickups: number | null; unassigned: number; given: number; people: number } | null }
export type MyParcels = { date: string; hub: string | null; parcels: number; pickups: number; kind: 'rider' | 'helper'; note: string | null
  version: number | null; published_at: string | null
  detail: Array<{ parcels: number; route: string | null; for: string | null }>
  cancelled: Array<{ version: number; at: string; hub?: string }> }

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

// ---------------------------------------------------------------- what one person can take
export type CapSource = 'fixed' | 'accounts' | 'self' | 'hub' | 'helper' | null
export type Capacity = { base: number | null; source: CapSource; usualPickups: number; rate: number | null }

/** Does this person do pickups at this hub (the zonal manager's set-up decides)? */
export const doesPickup = (p: PlanPerson, load: PlanLoad) => load.pickup_mode === 'same' ? p.rider || p.pickup : load.pickup_mode === 'mixed' ? p.pickup : false

/**
 * What a person delivers on a normal day: the fixed number the manager typed, else the person's own average of the period
 * (sent daily accounts first, then the person's own reports), else the hub's rider average. A helper takes the helper limit.
 */
export function capacityOf(p: PlanPerson, d: Pick<PlanData, 'rules' | 'load'>): Capacity {
  const rate = p.self.delivery + p.self.returned > 0 ? p.self.delivery / (p.self.delivery + p.self.returned) : null
  const acc = p.acc.days >= d.rules.min_days ? p.acc : null
  const self = !acc && p.self.days >= d.rules.min_days ? p.self : null
  const past = acc ?? self
  const usualPickups = past ? past.pickup / past.days : 0
  if (!p.rider) return { base: p.fixed ?? p.helper_max ?? d.rules.helper_max, source: p.fixed !== null ? 'fixed' : 'helper', usualPickups, rate }
  if (p.fixed !== null) return { base: p.fixed, source: 'fixed', usualPickups: 0, rate }
  if (past) return { base: Math.round(past.delivery / past.days), source: acc ? 'accounts' : 'self', usualPickups, rate }
  return { base: d.load.rider_parcels, source: d.load.rider_parcels !== null ? 'hub' : null, usualPickups: 0, rate }
}
/** Today's room for deliveries: the normal day, less the pickups above the person's usual ones (one pickup = `pickup_weight` deliveries). */
export const capacityToday = (c: Capacity, pickups: number, load: PlanLoad) =>
  c.base === null ? null : Math.max(0, Math.round(c.base - (pickups - c.usualPickups) * load.pickup_weight))

/** Here today? What was typed on the plan wins; else the attendance; nothing marked yet counts as here (and is flagged). */
export const isHere = (p: PlanPerson, typed: boolean | null) => typed ?? (p.presence.state === null ? true : p.presence.state === 'present')

// ---------------------------------------------------------------- the suggestion
/** Whole parcels shared by weight, nobody above their room; what does not fit comes back as `left`. */
export function share(total: number, weights: number[], room: number[]): { got: number[]; left: number } {
  const got = weights.map(() => 0)
  let left = Math.max(0, Math.round(total))
  for (let pass = 0; pass < 50 && left > 0; pass++) {
    const open = weights.map((w, i) => (w > 0 && room[i] - got[i] > 0 ? i : -1)).filter(i => i >= 0)
    if (!open.length) break
    const sum = open.reduce((t, i) => t + weights[i], 0)
    const start = left
    const frac: Array<[number, number]> = []
    for (const i of open) {
      const want = (start * weights[i]) / sum
      const take = Math.min(Math.floor(want), room[i] - got[i])
      got[i] += take; left -= take
      frac.push([i, want - Math.floor(want)])
    }
    for (const [i] of frac.sort((a, b) => b[1] - a[1])) { if (left <= 0) break; if (room[i] - got[i] > 0) { got[i]++; left-- } }
    if (left === start) break
  }
  return { got, left }
}

export type PlanInput = { toDeliver: number; routeParcels: Record<string, number>; present: Record<string, boolean | null>; pickups: Record<string, number>; extra: string[]; roadKm?: RoadKm }
export type PlanTip =
  | { kind: 'cover'; absent: string; parcels: number; to: Array<{ name: string; parcels: number; how: 'same' | 'free' | 'near' | 'helper' | 'stretch' }> }
  | { kind: 'unassigned'; parcels: number; riders: number | null }
  | { kind: 'nocap'; names: string[] }
  | { kind: 'unknown'; names: string[] }
  | { kind: 'noroute'; parcels: number }
  | { kind: 'routeless'; route: string }
export type Suggestion = { rows: Record<string, { kind: 'rider' | 'helper'; capacity: number | null; parcels: number; detail: PlanPart[] }>; unassigned: number; tips: PlanTip[] }

type RoadKm = Record<string, Record<string, number | null>>

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

const centre = (r: PlanRoute): LatLng | null => { const g = r.stops.filter(hasGps); return g.length ? { lat: g.reduce((t, s) => t + s.lat!, 0) / g.length, lng: g.reduce((t, s) => t + s.lng!, 0) / g.length } : null }

/**
 * Who takes how many parcels today.
 *  1. Every route's parcels go to its riders by what each can take (a rider on several routes splits the day between them).
 *  2. An absent rider's part goes, in this order, to: riders of the same route with room, riders without a route, riders of the
 *     nearest routes (within the zone's "near" distance), the hub's helpers, and at last to riders up to the overload limit.
 *  3. What still nobody can take is "left for tomorrow" and tells how many riders are short.
 * Nothing is saved: the page puts these numbers in the form and a person decides.
 */
export function suggestPlan(d: PlanData, inp: PlanInput): Suggestion {
  const people = d.people.filter(p => p.active && (p.rider || p.helper || p.routes.length > 0 || inp.extra.includes(p.id)))
  const cap = new Map(people.map(p => [p.id, capacityOf(p, d)]))
  const today = new Map(people.map(p => [p.id, capacityToday(cap.get(p.id)!, inp.pickups[p.id] ?? 0, d.load) ?? 0]))
  const here = new Map(people.map(p => [p.id, isHere(p, inp.present[p.id] ?? null)]))
  const given = new Map(people.map(p => [p.id, 0]))
  const parts = new Map<string, PlanPart[]>(people.map(p => [p.id, []]))
  const name = (id: string) => d.people.find(p => p.id === id)?.name ?? ''
  const room = (id: string, stretch = false) => (here.get(id) ? Math.max(0, Math.floor((today.get(id) ?? 0) * (stretch ? d.rules.over_pct / 100 : 1)) - (given.get(id) ?? 0)) : 0)
  const give = (id: string, n: number, route: string | null, forWho: string | null) => {
    if (n <= 0) return
    given.set(id, (given.get(id) ?? 0) + n)
    const list = parts.get(id)!
    const same = list.find(x => (x.route_id ?? null) === route && (x.for ?? null) === forWho)
    if (same) same.parcels += n; else list.push({ route_id: route, parcels: n, for: forWho })
  }
  const routes = d.routes.filter(r => (inp.routeParcels[r.id] ?? 0) > 0)
  const onRoute = (r: PlanRoute) => people.filter(p => p.routes.includes(r.id))
  /** The part of a rider's day that belongs to this route (a rider on several routes splits by the routes' parcels). */
  const part = (p: PlanPerson, r: PlanRoute) => {
    const all = p.routes.reduce((t, id) => t + (inp.routeParcels[id] ?? 0), 0)
    return all > 0 ? (today.get(p.id) ?? 0) * ((inp.routeParcels[r.id] ?? 0) / all) : 0
  }
  const tips: PlanTip[] = []
  type Pool = { route: PlanRoute | null; forWho: string | null; parcels: number }
  const pools: Pool[] = []

  // 1. every route to its own riders
  for (const r of routes) {
    const q = inp.routeParcels[r.id]
    const riders = onRoute(r)
    if (!riders.length) { tips.push({ kind: 'routeless', route: `${r.code} · ${r.name}` }); pools.push({ route: r, forWho: null, parcels: q }); continue }
    const w = riders.map(p => part(p, r))
    const sum = w.reduce((t, x) => t + x, 0)
    if (sum <= 0) { pools.push({ route: r, forWho: null, parcels: q }); continue }
    // what each rider of the route would take on a normal day, never above the rider's part of the day
    const normal = share(q, w, w.map(x => Math.floor(x)))
    let short = normal.left
    riders.forEach((p, i) => {
      if (!here.get(p.id)) { if (normal.got[i] > 0) pools.push({ route: r, forWho: p.id, parcels: normal.got[i] }); return }
      const take = Math.min(normal.got[i], room(p.id))
      give(p.id, take, r.id, null); short += normal.got[i] - take
    })
    if (short > 0) pools.push({ route: r, forWho: null, parcels: short })
  }
  const onRoutes = routes.reduce((t, r) => t + inp.routeParcels[r.id], 0)
  if (inp.toDeliver > onRoutes) { pools.push({ route: null, forWho: null, parcels: inp.toDeliver - onRoutes }); if (routes.length) tips.push({ kind: 'noroute', parcels: inp.toDeliver - onRoutes }) }

  // 2. the parts nobody holds yet: same route, riders without a route, the nearest routes, helpers, then the overload limit
  let unassigned = 0
  const riders = people.filter(p => p.rider || p.routes.length > 0)
  const helpers = people.filter(p => !p.rider && p.routes.length === 0)
  for (const pool of pools.sort((a, b) => (a.forWho ? 0 : 1) - (b.forWho ? 0 : 1))) {
    let left = pool.parcels
    const to: Array<{ name: string; parcels: number; how: 'same' | 'free' | 'near' | 'helper' | 'stretch' }> = []
    const hand = (ids: string[], how: 'same' | 'free' | 'near' | 'helper' | 'stretch', stretch = false) => {
      if (left <= 0 || !ids.length) return
      const rooms = ids.map(id => room(id, stretch))
      const s = share(left, rooms, rooms)
      ids.forEach((id, i) => { if (s.got[i] > 0) { give(id, s.got[i], pool.route?.id ?? null, pool.forWho); to.push({ name: name(id), parcels: s.got[i], how }) } })
      left = s.left
    }
    const c = pool.route ? centre(pool.route) : null
    const same = pool.route ? onRoute(pool.route).map(p => p.id) : []
    const near = pool.route ? d.routes.filter(r => r.id !== pool.route!.id).map(r => { const x = centre(r); return { r, km: inp.roadKm ? inp.roadKm[r.id]?.[pool.route!.id] ?? null : c && x ? meters(c, x) / 1000 : null } })
      .filter(x => x.km === null ? !inp.roadKm : x.km <= d.rules.near_km).sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)) : d.routes.map(r => ({ r, km: null }))
    hand(same, 'same')
    hand(riders.filter(p => p.routes.length === 0).map(p => p.id), 'free')
    for (const x of near) hand(onRoute(x.r).map(p => p.id).filter(id => !same.includes(id)), 'near')
    hand(helpers.map(p => p.id), 'helper')
    hand(same, 'stretch', true)
    for (const x of near) hand(onRoute(x.r).map(p => p.id).filter(id => !same.includes(id)), 'stretch', true)
    hand(riders.filter(p => p.routes.length === 0).map(p => p.id), 'stretch', true)
    unassigned += left
    if (pool.forWho) {
      const merged: typeof to = []
      for (const t of to) { const m = merged.find(x => x.name === t.name && x.how === t.how); if (m) m.parcels += t.parcels; else merged.push({ ...t }) }
      tips.push({ kind: 'cover', absent: name(pool.forWho), parcels: pool.parcels, to: merged })
    }
  }
  if (unassigned > 0) tips.push({ kind: 'unassigned', parcels: unassigned, riders: d.load.rider_parcels ? Math.ceil(unassigned / d.load.rider_parcels) : null })
  const nocap = people.filter(p => here.get(p.id) && cap.get(p.id)!.base === null).map(p => p.name)
  if (nocap.length) tips.push({ kind: 'nocap', names: nocap })
  const unknown = people.filter(p => (p.rider || p.routes.length > 0) && (inp.present[p.id] ?? null) === null && p.presence.state === null).map(p => p.name)
  if (unknown.length) tips.push({ kind: 'unknown', names: unknown })

  const rows: Suggestion['rows'] = {}
  for (const p of people) rows[p.id] = { kind: p.rider || p.routes.length > 0 ? 'rider' : 'helper', capacity: cap.get(p.id)!.base === null ? null : today.get(p.id)!,
    parcels: given.get(p.id) ?? 0, detail: (parts.get(p.id) ?? []).filter(x => x.parcels > 0) }
  return { rows, unassigned, tips }
}

/** Today's parcels spread over the routes by their usual size (the typed average, else what the route's riders can take). */
export function spreadRoutes(d: PlanData, toDeliver: number): Record<string, number> {
  const w = d.routes.map(r => r.avg_parcels ?? d.people.filter(p => p.routes.includes(r.id)).reduce((t, p) => t + (capacityOf(p, d).base ?? 0) / Math.max(1, p.routes.length), 0))
  if (!w.some(x => x > 0)) return {}
  const s = share(toDeliver, w, w.map(() => toDeliver))
  return Object.fromEntries(d.routes.map((r, i) => [r.id, s.got[i]]))
}
