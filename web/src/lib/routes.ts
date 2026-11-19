// রাইডার রুট — আসল লোকেশন দিয়ে (zone route settings, stops with GPS, road line, rider check-in).
// Every rule is checked again by the database (route_save, route_riders_set, route_checkin …).
import { supabase } from './supabase'

export type StopKind = 'area' | 'merchant' | 'landmark' | 'point'
export type RouteStop = { id?: string; seq?: number; name: string; kind: StopKind; lat: number | null; lng: number | null; radius_m: number | null; minutes: number | null; note: string | null }
export type RouteRider = { employee_id: string; code: string | null; name: string; mobile: string | null; from: string }
export type Shift = 'day' | 'morning' | 'evening' | 'night'
export type ZoneRoute = {
  id: string; hub_id: string; zone_id: string; code: string; name: string; note: string | null; color: string | null; shift: Shift
  distance_km: number | null; road_km: number | null; road_minutes: number | null; road_path: Array<[number, number]> | null; stops_gps: number
  updated_at: string; stops: RouteStop[]; riders: RouteRider[]
}
export type RouteRules = { max_stops: number; max_riders: number; max_routes_per_rider: number; stop_radius_m: number; speed_kmh: number
  stop_minutes: number; start_time: string; gps_required: boolean; checkin_open: boolean; saved?: boolean; updated_at?: string | null }
export type HubStaff = { id: string; code: string | null; name: string; rider: boolean; routes: number }
export type RouteHub = { id: string; code: string; name: string; lat: number | null; lng: number | null; staff: HubStaff[] }
export type ZoneOverview = {
  zone: { id: string; code: string; name: string }; rules: RouteRules
  can: { configure: boolean; visits: boolean; edit_hubs: string[]; archive_hubs: string[] }
  hubs: RouteHub[]; routes: ZoneRoute[]; visits_today: Record<string, number>
}
export type DayVisit = { stop_id: string; stop: string; seq: number; employee_id: string; at: string; lat: number; lng: number; distance_m: number; near: boolean; accuracy_m: number | null; note: string | null }
export type DayRoute = { route_id: string; hub_id: string; hub_name: string; code: string; name: string; color: string | null; stops: number; stops_gps: number
  riders: Array<{ employee_id: string; name: string; code: string | null; visited: number; far: number; first_at: string | null; last_at: string | null }>
  visits: DayVisit[] }
export type MyRoute = ZoneRoute & { hub: { name: string; lat: number | null; lng: number | null }; rules: RouteRules; can_checkin: boolean
  visits: Array<{ stop_id: string; at: string; distance_m: number; near: boolean }> }

export class RouteError extends Error { constructor(m: string, public code?: string) { super(m) } }
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new RouteError(error.message, error.code)
  return data as T
}
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v))
const fixRoute = <T extends ZoneRoute>(r: T): T => ({ ...r, distance_km: numOrNull(r.distance_km), road_km: numOrNull(r.road_km),
  stops: (r.stops ?? []).map(s => ({ ...s, lat: numOrNull(s.lat), lng: numOrNull(s.lng) })), riders: r.riders ?? [] })

export const routeApi = {
  zones: () => rpc<Array<{ id: string; code: string; name: string }>>('route_zones'),
  overview: async (zone: string) => {
    const o = await rpc<ZoneOverview>('route_zone_overview', { p_zone: zone })
    return { ...o, hubs: o.hubs.map(h => ({ ...h, lat: numOrNull(h.lat), lng: numOrNull(h.lng) })), routes: o.routes.map(fixRoute) }
  },
  saveRules: (zone: string, rules: Partial<RouteRules>) => rpc<RouteRules>('route_settings_save', { p_zone: zone, p: rules }),
  save: (p: { id?: string; hub_id: string; code?: string; name: string; note?: string | null; color?: string | null; shift: Shift; stops: RouteStop[]
    road?: { km: number; minutes: number; path: Array<[number, number]> } | null }) => rpc<string>('route_save', { p }),
  archive: (route: string, reason: string) => rpc<void>('route_archive', { p_route: route, p_reason: reason }),
  setRiders: (route: string, employees: string[]) => rpc<{ added: number; ended: number }>('route_riders_set', { p_route: route, p_employees: employees }),
  day: (zone: string, date: string) => rpc<{ date: string; routes: DayRoute[] }>('route_day', { p_zone: zone, p_date: date }),
  mine: async () => { const r = await rpc<{ date: string; routes: MyRoute[] }>('my_route_today'); return { ...r, routes: (r.routes ?? []).map(x => ({ ...fixRoute(x), hub: { ...x.hub, lat: numOrNull(x.hub?.lat), lng: numOrNull(x.hub?.lng) } })) } },
  checkin: (stop: string, lat: number, lng: number, accuracy: number | null, note?: string) =>
    rpc<{ distance_m: number; near: boolean; radius_m: number }>('route_checkin', { p_stop: stop, p_lat: lat, p_lng: lng, p_accuracy: accuracy, p_note: note || null }),
}

const BN: Array<[RegExp, string]> = [
  [/outside Bangladesh/i, 'লোকেশন বাংলাদেশের বাইরে পড়ছে — অক্ষাংশ (lat) আর দ্রাঘিমাংশ (lng) উল্টো হয়নি তো?'],
  [/Too many stops/i, 'এই জোনে এক রুটে এর বেশি স্টপ রাখা যায় না (জোনের নিয়ম)'],
  [/Too many riders/i, 'এই জোনে এক রুটে এর বেশি রাইডার দেওয়া যায় না (জোনের নিয়ম)'],
  [/the most this zone allows/i, 'এই রাইডার আগেই সর্বোচ্চ সংখ্যক রুটে আছেন (জোনের নিয়ম)'],
  [/works at another hub/i, 'এই কর্মী অন্য হাবের'],
  [/not an active staff/i, 'এই কর্মী সক্রিয় নন'],
  [/needs a location for every stop/i, 'এই জোনে প্রতিটি স্টপের লোকেশন দিতে হয়'],
  [/give both latitude and longitude/i, 'অক্ষাংশ ও দ্রাঘিমাংশ দুটোই দিন'],
  [/at least one stop/i, 'অন্তত একটা স্টপ দিন'],
  [/Give the route a name/i, 'রুটের নাম দিন (২–৮০ অক্ষর)'],
  [/already has a route with code/i, 'এই হাবে এই কোডের রুট আগেই আছে'],
  [/Write why/i, 'কেন সরাচ্ছেন লিখুন'],
  [/not on your route/i, 'এই স্টপ আপনার রুটে নেই'],
  [/check in on the route yet/i, 'রুটে চেক-ইন করার অনুমতি এখনো দেওয়া হয়নি'],
  [/switched off/i, 'এই জোনে রুট চেক-ইন বন্ধ'],
  [/has no location yet/i, 'এই স্টপের লোকেশন এখনো বসানো হয়নি — ম্যানেজারকে বলুন'],
  [/too rough/i, 'ফোনের লোকেশন অনেক অস্পষ্ট (১ কিমির বেশি) — GPS চালু করে আবার চেষ্টা করুন'],
  [/phone location is missing/i, 'ফোনের লোকেশন পাওয়া যায়নি বা ভুল'],
  [/outside its allowed range/i, 'একটা মান সীমার বাইরে'],
  [/Unknown route rule|wrong kind of value/i, 'নিয়মের মান ঠিক নেই'],
  [/42501|Not authorised|permission denied/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export const routeFriendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  return BN.find(([re]) => re.test(m))?.[1] ?? m
}

// ---------------------------------------------------------------- geometry
export type LatLng = { lat: number; lng: number }
export const hasGps = (s: { lat: number | null; lng: number | null }): s is { lat: number; lng: number } => s.lat !== null && s.lng !== null
export const inBd = (lat: number, lng: number) => lat >= 20.3 && lat <= 26.8 && lng >= 87.9 && lng <= 92.8
export function meters(a: LatLng, b: LatLng) {
  const R = 6371000, r = Math.PI / 180
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
/** Straight-line km: start (hub) → each stop with GPS in order. */
export function lineKm(start: LatLng | null, stops: Array<{ lat: number | null; lng: number | null }>) {
  let m = 0, prev: LatLng | null = start
  for (const s of stops) { if (!hasGps(s)) continue; if (prev) m += meters(prev, s); prev = { lat: s.lat, lng: s.lng } }
  return m / 1000
}
/** Rough day plan: road km if known, else straight km × 1.3; minutes = travel at the zone speed + minutes at each stop. */
export function estimate(km: number, stops: number, rules: Pick<RouteRules, 'speed_kmh' | 'stop_minutes'>, roadMinutes?: number | null) {
  const travel = roadMinutes ?? (km / Math.max(rules.speed_kmh, 1)) * 60
  return Math.round(travel + stops * rules.stop_minutes)
}

/** Shortest order (open path from the hub): nearest neighbour, then 2-opt. Stops without GPS keep their place at the end. */
export function bestOrder<T extends { lat: number | null; lng: number | null }>(start: LatLng | null, stops: T[]): T[] {
  const g = stops.filter(hasGps) as Array<T & LatLng>, rest = stops.filter(s => !hasGps(s))
  if (g.length < 3 && !start) return stops
  const d = (a: LatLng, b: LatLng) => meters(a, b)
  const left = [...g]; const path: Array<T & LatLng> = []
  let cur: LatLng | null = start
  while (left.length) {
    let bi = 0
    if (cur) { let bd = Infinity; left.forEach((s, i) => { const x = d(cur!, s); if (x < bd) { bd = x; bi = i } }) }
    cur = left[bi]; path.push(left.splice(bi, 1)[0])
  }
  const len = (p: LatLng[]) => p.reduce((t, s, i) => t + (i ? d(p[i - 1], s) : start ? d(start, s) : 0), 0)
  let improved = true, best = path, bestLen = len(path), guard = 0
  while (improved && guard++ < 60) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) for (let k = i + 1; k < best.length; k++) {
      const next = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)]
      const l = len(next)
      if (l + 0.5 < bestLen) { best = next; bestLen = l; improved = true }
    }
  }
  return [...best, ...rest]
}

/** "24.37, 88.60", a Google Maps link (…@24.37,88.60… / ?q=24.37,88.60 / !3d24.37!4d88.60) or an OpenStreetMap link. Swapped numbers are put right. */
export function parseLocation(text: string): LatLng | null {
  const t = text.trim()
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/]
  for (const re of pats) {
    const m = t.match(re); if (!m) continue
    let lat = Number(m[1]), lng = Number(m[2])
    if (!inBd(lat, lng) && inBd(lng, lat)) [lat, lng] = [lng, lat]
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: +lat.toFixed(7), lng: +lng.toFixed(7) }
  }
  return null
}

/** The phone's own location (GPS). */
export function myLocation(): Promise<LatLng & { accuracy: number }> {
  return new Promise((ok, bad) => {
    if (!navigator.geolocation) return bad(new Error('এই ফোন/ব্রাউজারে লোকেশন পাওয়া যায় না'))
    navigator.geolocation.getCurrentPosition(p => ok({ lat: +p.coords.latitude.toFixed(7), lng: +p.coords.longitude.toFixed(7), accuracy: Math.round(p.coords.accuracy) }),
      e => bad(new Error(e.code === 1 ? 'লোকেশনের অনুমতি দেওয়া হয়নি — ফোনের সেটিং থেকে চালু করুন' : 'লোকেশন পাওয়া যায়নি — GPS চালু করে আবার চেষ্টা করুন')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 })
  })
}

/** Place search (OpenStreetMap Nominatim), inside Bangladesh. */
export async function searchPlace(q: string): Promise<Array<LatLng & { name: string }>> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=bd&accept-language=bn,en&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error('খোঁজা যায়নি, একটু পরে আবার চেষ্টা করুন')
  const rows = (await r.json()) as Array<{ lat: string; lon: string; display_name: string }>
  return rows.map(x => ({ lat: +Number(x.lat).toFixed(7), lng: +Number(x.lon).toFixed(7), name: x.display_name }))
}

/** Road line through the points in order (public OSRM service). Path thinned to at most 1500 points. */
export async function roadLine(points: LatLng[]): Promise<{ km: number; minutes: number; path: Array<[number, number]> }> {
  if (points.length < 2) throw new Error('রাস্তা আঁকতে অন্তত দুটো লোকেশন লাগে')
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`)
  if (!r.ok) throw new Error('রাস্তার লাইন পাওয়া যায়নি (সার্ভার ব্যস্ত) — একটু পরে আবার চেষ্টা করুন')
  const j = await r.json() as { code: string; routes?: Array<{ distance: number; duration: number; geometry: { coordinates: Array<[number, number]> } }> }
  const rt = j.routes?.[0]
  if (j.code !== 'Ok' || !rt) throw new Error('এই লোকেশনগুলোর মধ্যে রাস্তা পাওয়া যায়নি')
  let pts = rt.geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)] as [number, number])
  if (pts.length > 1500) { const step = pts.length / 1500; pts = Array.from({ length: 1500 }, (_, i) => pts[Math.floor(i * step)]).concat([pts[pts.length - 1]]) }
  return { km: +(rt.distance / 1000).toFixed(2), minutes: Math.round(rt.duration / 60), path: pts }
}

export const STOP_KIND: Record<StopKind, { bn: string; en: string }> = {
  area: { bn: 'এলাকা', en: 'Area' }, merchant: { bn: 'মার্চেন্ট', en: 'Merchant' }, landmark: { bn: 'চিহ্ন (বাজার/মোড়)', en: 'Landmark' }, point: { bn: 'পয়েন্ট', en: 'Point' },
}
export const SHIFT: Record<Shift, { bn: string; en: string }> = {
  day: { bn: 'সারাদিন', en: 'Day' }, morning: { bn: 'সকাল', en: 'Morning' }, evening: { bn: 'বিকেল', en: 'Evening' }, night: { bn: 'রাত', en: 'Night' },
}
export const ROUTE_COLORS = ['#15803D', '#2563EB', '#DC2626', '#9333EA', '#EA580C', '#0891B2', '#CA8A04', '#DB2777', '#4F46E5', '#65A30D']
export const routeColor = (r: { color: string | null }, i: number) => r.color || ROUTE_COLORS[i % ROUTE_COLORS.length]
type Fmt = { n: (x: number) => string; L: (bn: string, en: string) => string }
export const fmtKm = (km: number | null | undefined, { n, L }: Fmt) => km === null || km === undefined ? '—' : `${n(+km.toFixed(1))} ${L('কিমি', 'km')}`
export const fmtMin = (m: number, { n, L }: Fmt) => m >= 60 ? `${n(Math.floor(m / 60))} ${L('ঘণ্টা', 'h')} ${n(m % 60)} ${L('মিনিট', 'min')}` : `${n(m)} ${L('মিনিট', 'min')}`
export const fmtDist = (m: number, { n, L }: Fmt) => m >= 1000 ? `${n(+(m / 1000).toFixed(1))} ${L('কিমি', 'km')}` : `${n(Math.round(m))} ${L('মিটার', 'm')}`

/** The line of a route: the saved road line, else straight from the hub through every stop with GPS. */
export function routeLine(r: Pick<ZoneRoute, 'road_path' | 'stops'>, hub: { lat: number | null; lng: number | null } | undefined): { points: Array<[number, number]>; road: boolean } {
  if (r.road_path && r.road_path.length > 1) return { points: r.road_path, road: true }
  const pts: Array<[number, number]> = []
  if (hub && hasGps(hub)) pts.push([hub.lat, hub.lng])
  for (const s of r.stops) if (hasGps(s)) pts.push([s.lat, s.lng])
  return { points: pts, road: false }
}


// ---------------------------------------------------------------- area names (Natore upazilas, villages, markets, unions)
export type Upazila = { code: number; district: string; district_bn: string; name: string; name_bn: string; boundary: Array<[number, number]> | null }
export type PlaceKind = 'village' | 'para' | 'market' | 'union' | 'town' | 'other'
export type Place = { id: string; upazila_code: number; kind: PlaceKind; name: string | null; name_bn: string | null; bn_checked: boolean
  lat: number | null; lng: number | null; source: 'geonames' | 'osm' | 'bbs' | 'manual'; hidden: boolean; hidden_reason: string | null; note: string | null }
export const PLACE_KIND: Record<PlaceKind, { bn: string; en: string }> = {
  village: { bn: 'গ্রাম', en: 'Village' }, para: { bn: 'পাড়া / মহল্লা', en: 'Para' }, market: { bn: 'বাজার / হাট', en: 'Market' },
  union: { bn: 'ইউনিয়ন', en: 'Union' }, town: { bn: 'শহর', en: 'Town' }, other: { bn: 'অন্যান্য', en: 'Other' },
}
export const placeName = (p: Pick<Place, 'name' | 'name_bn'>, lang: 'bn' | 'en' = 'bn') => (lang === 'en' ? p.name || p.name_bn : p.name_bn || p.name) || ''
export const stopKindOf = (k: PlaceKind): StopKind => k === 'market' ? 'landmark' : 'area'
export const PLACE_SOURCES = 'গ্রাম: GeoNames (CC BY 4.0) · বাজার: © OpenStreetMap contributors (ODbL) · উপজেলার সীমানা: geoBoundaries (CC BY 4.0) · ইউনিয়ন: সরকারি নাম'

let placeCache: Promise<{ upazilas: Upazila[]; places: Place[] }> | null = null
export const placesApi = {
  /** Every upazila and place (hidden ones too; pickers leave them out). Kept in memory for the session. */
  load: (fresh = false) => {
    if (!placeCache || fresh) placeCache = (async () => {
      const [u, p] = await Promise.all([
        supabase.from('geo_upazilas').select('code, district, district_bn, name, name_bn, boundary').order('code'),
        supabase.from('route_places').select('id, upazila_code, kind, name, name_bn, bn_checked, lat, lng, source, hidden, hidden_reason, note').order('name_bn').range(0, 9999),
      ])
      if (u.error) throw new RouteError(u.error.message, u.error.code)
      if (p.error) throw new RouteError(p.error.message, p.error.code)
      return { upazilas: (u.data ?? []) as Upazila[], places: ((p.data ?? []) as Place[]).map(x => ({ ...x, lat: numOrNull(x.lat), lng: numOrNull(x.lng) })) }
    })().catch(e => { placeCache = null; throw e })
    return placeCache
  },
  save: (p: { id?: string; upazila_code: number; name_bn: string; name?: string | null; kind: PlaceKind; lat: number | null; lng: number | null; note?: string | null; bn_checked?: boolean }) =>
    rpc<string>('route_place_save', { p }),
  hide: (id: string, hidden: boolean, reason?: string) => rpc<void>('route_place_hide', { p_id: id, p_hidden: hidden, p_reason: reason || null }),
}

/** The upazila a point is in: most of the 7 nearest places with a location (works for Naldanga too, which has no boundary). */
export function upazilaNear(pt: LatLng, places: Place[]): number | null {
  const near = places.filter(p => !p.hidden && hasGps(p)).map(p => ({ u: p.upazila_code, d: meters(pt, p as LatLng) })).sort((a, b) => a.d - b.d).slice(0, 7)
  if (!near.length) return null
  const c = new Map<number, number>(); near.forEach((x, i) => c.set(x.u, (c.get(x.u) ?? 0) + 7 - i))
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
/** Compass direction from a to b, in Bangla. */
export function direction(a: LatLng, b: LatLng) {
  const deg = (bearing(a, b) + 360 + 22.5) % 360
  return ['উত্তর', 'উত্তর-পূর্ব', 'পূর্ব', 'দক্ষিণ-পূর্ব', 'দক্ষিণ', 'দক্ষিণ-পশ্চিম', 'পশ্চিম', 'উত্তর-পশ্চিম'][Math.floor(deg / 45)]
}
function bearing(a: LatLng, b: LatLng) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r)
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r)
  return (Math.atan2(y, x) / r + 360) % 360
}
/** Is this place already a stop (within `m` metres of one)? */
export const nearAny = (p: LatLng, stops: LatLng[], m = 250) => stops.some(s => meters(p, s) <= m)

/**
 * Route suggestion: the places around the hub are cut into `n` slices by direction (like slices of a cake, starting at the widest
 * empty gap), each slice at most `maxStops` places, nearest first; then each slice is put in the shortest order from the hub.
 */
export function suggestRoutes(hub: LatLng, places: Place[], n: number, maxStops: number): { groups: Place[][]; left: Place[] } {
  const pts = places.filter(hasGps)
  if (!pts.length || n < 1) return { groups: [], left: pts }
  const withB = pts.map(p => ({ p, b: bearing(hub, p as LatLng), d: meters(hub, p as LatLng) })).sort((x, y) => x.b - y.b)
  let gapAt = 0, gap = -1
  withB.forEach((x, i) => { const next = withB[(i + 1) % withB.length].b + (i === withB.length - 1 ? 360 : 0); if (next - x.b > gap) { gap = next - x.b; gapAt = (i + 1) % withB.length } })
  const ring = [...withB.slice(gapAt), ...withB.slice(0, gapAt)]
  const size = Math.ceil(ring.length / n)
  const groups: Place[][] = [], left: Place[] = []
  for (let g = 0; g < n; g++) {
    const slice = ring.slice(g * size, (g + 1) * size).sort((a, b) => a.d - b.d)
    left.push(...slice.slice(maxStops).map(x => x.p))
    const keep = slice.slice(0, maxStops).map(x => x.p)
    if (keep.length) groups.push(bestOrder(hub, keep))
  }
  return { groups, left }
}
