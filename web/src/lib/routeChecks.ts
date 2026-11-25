// The route module's "what needs fixing" rules. Each rule is one small entry in ROUTE_CHECKS: give it an id and a function that looks at the zone
// and returns findings. A new rule = a new entry; the warnings tab, its count and the tab bar badge pick it up by themselves. Pure file (tests run it).
import { estimate, hasGps, meters, type LatLng } from './routeGeo.ts'
import type { ZoneOverview, ZoneRoute } from './routes.ts'

export type Finding = { code: string; tone: 'bad' | 'warn'; text: string; route?: string; hub?: string }
export type Tr = { L: (bn: string, en: string) => string; n: (v: number | string) => string }
export type RouteCheck = { id: string; bn: string; en: string; run: (o: ZoneOverview, t: Tr) => Finding[] }

const hubName = (o: ZoneOverview, r: ZoneRoute) => o.hubs.find(h => h.id === r.hub_id)?.name ?? ''
const perRoute = (fn: (r: ZoneRoute, hn: string, o: ZoneOverview, t: Tr) => Array<Omit<Finding, 'route'>>) =>
  (o: ZoneOverview, t: Tr): Finding[] => o.routes.flatMap(r => fn(r, hubName(o, r), o, t).map(f => ({ ...f, route: r.id })))

export const ROUTE_CHECKS: RouteCheck[] = [
  { id: 'hub_no_gps', bn: 'হাবের লোকেশন নেই', en: 'Hub without location', run: (o, { L }) => o.hubs.filter(h => !hasGps(h)).map(h => ({ code: 'hub_no_gps', tone: 'warn' as const, hub: h.id,
    text: L(`${h.name}: হাবের GPS নেই — রুটের দূরত্ব হাব থেকে মাপা যাচ্ছে না (হাব তালিকা ও ম্যাপ থেকে বসান)`, `${h.name}: the hub has no GPS`) })) },
  { id: 'rider_no_route', bn: 'রুট ছাড়া রাইডার', en: 'Riders without a route', run: (o, { L, n }) => o.hubs.flatMap(h => {
    const none = h.staff.filter(s => s.rider && s.routes === 0)
    return none.length ? [{ code: 'rider_no_route', tone: 'warn' as const, hub: h.id, text: L(`${h.name}: ${n(none.length)} জন রাইডার রুট পাননি — ${none.slice(0, 5).map(s => s.name).join(', ')}`, `${h.name}: ${none.length} riders without a route`) }] : [] }) },
  { id: 'route_no_rider', bn: 'রাইডার ছাড়া রুট', en: 'Route without a rider', run: perRoute((r, hn, _o, { L }) => r.riders.length ? [] :
    [{ code: 'route_no_rider', tone: 'bad', text: L(`${hn} · ${r.name}: কোনো রাইডার দেওয়া হয়নি`, `${hn} · ${r.name}: no rider`) }]) },
  { id: 'stop_no_gps', bn: 'লোকেশন ছাড়া স্টপ', en: 'Stops without a location', run: perRoute((r, hn, _o, { L, n }) => {
    const none = r.stops.filter(s => !hasGps(s))
    return none.length ? [{ code: 'stop_no_gps', tone: 'warn', text: L(`${hn} · ${r.name}: ${n(none.length)}টা স্টপের লোকেশন নেই — ${none.slice(0, 4).map(s => s.name).join(', ')}`, `${hn} · ${r.name}: ${none.length} stops without location`) }] : [] }) },
  { id: 'stop_limit', bn: 'স্টপ সীমার বেশি', en: 'Too many stops', run: perRoute((r, hn, o, { L, n }) => r.stops.length > o.rules.max_stops ?
    [{ code: 'stop_limit', tone: 'bad', text: L(`${hn} · ${r.name}: স্টপ জোনের সীমার বেশি (${n(r.stops.length)}/${n(o.rules.max_stops)})`, `${r.name}: more stops than the zone allows`) }] : []) },
  { id: 'rider_limit', bn: 'রাইডার সীমার বেশি', en: 'Too many riders', run: perRoute((r, hn, o, { L }) => r.riders.length > o.rules.max_riders ?
    [{ code: 'rider_limit', tone: 'bad', text: L(`${hn} · ${r.name}: রাইডার জোনের সীমার বেশি`, `${r.name}: more riders than the zone allows`) }] : []) },
  { id: 'long_route', bn: '৯ ঘণ্টার বেশি লাগবে', en: 'Over nine hours', run: perRoute((r, hn, o, { L, n }) => {
    const km = r.road_km ?? (r.distance_km !== null ? r.distance_km * 1.3 : null)
    if (km === null) return []
    const min = estimate(km, r.stops.length, o.rules, r.road_minutes)
    return min > 9 * 60 ? [{ code: 'long_route', tone: 'warn', text: L(`${hn} · ${r.name}: আনুমানিক সময় ${n(Math.round(min / 60))} ঘণ্টার বেশি — রুট ভাগ করার কথা ভাবুন`, `${r.name}: estimated over ${Math.round(min / 60)} hours`) }] : [] }) },
  { id: 'dup_name', bn: 'একই নাম দুবার', en: 'Same name twice', run: perRoute((r, hn, _o, { L }) => {
    const seen = new Set<string>(), out: Array<Omit<Finding, 'route'>> = []
    for (const s of r.stops) { const k = s.name.trim().toLowerCase(); if (seen.has(k)) out.push({ code: 'dup_name', tone: 'warn', text: L(`${hn} · ${r.name}: "${s.name}" দুবার আছে`, `${r.name}: "${s.name}" twice`) }); seen.add(k) }
    return out }) },
  // new with the module: two stops of one route on the same spot, and a stop far from its hub
  { id: 'same_spot', bn: 'একই জায়গায় দুই স্টপ', en: 'Two stops on one spot', run: perRoute((r, hn, _o, { L }) => {
    const g = r.stops.filter(hasGps), out: Array<Omit<Finding, 'route'>> = []
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (g[i].name.trim().toLowerCase() !== g[j].name.trim().toLowerCase() && meters(g[i] as LatLng, g[j] as LatLng) <= 30)
      out.push({ code: 'same_spot', tone: 'warn', text: L(`${hn} · ${r.name}: "${g[i].name}" আর "${g[j].name}" একই জায়গায় (৩০ মিটারের মধ্যে)`, `${r.name}: "${g[i].name}" and "${g[j].name}" are on the same spot`) })
    return out }) },
  { id: 'far_stop', bn: 'হাব থেকে অনেক দূরের স্টপ', en: 'Stop far from the hub', run: perRoute((r, hn, o, { L, n }) => {
    const hub = o.hubs.find(h => h.id === r.hub_id)
    if (!hub || !hasGps(hub)) return []
    const far = r.stops.filter(hasGps).map(s => ({ s, km: meters(hub as LatLng, s as LatLng) / 1000 })).filter(x => x.km > 50)
    return far.length ? [{ code: 'far_stop', tone: 'warn', text: L(`${hn} · ${r.name}: ${far.slice(0, 3).map(x => `"${x.s.name}" (${n(Math.round(x.km))} কিমি)`).join(', ')} হাব থেকে ৫০ কিমির বেশি দূরে — লোকেশন ঠিক আছে?`, `${r.name}: ${far.length} stop(s) over 50 km from the hub`) }] : [] }) },
  { id: 'shared_place', bn: 'দুই রুটে এক জায়গা', en: 'One place on two routes', run: (o, { L }) => {
    const all: Array<{ r: ZoneRoute; lat: number; lng: number; name: string }> = []
    for (const r of o.routes) for (const s of r.stops) if (hasGps(s)) all.push({ r, lat: s.lat, lng: s.lng, name: s.name })
    const pairs = new Set<string>(), out: Finding[] = []
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j]
      if (a.r.id === b.r.id || a.r.hub_id !== b.r.hub_id) continue
      const key = [a.r.id, b.r.id].sort().join('|')
      if (pairs.has(key) || meters(a, b) > 80) continue
      pairs.add(key)
      out.push({ code: 'shared_place', tone: 'warn', route: a.r.id, text: L(`দুই রুটের স্টপ এক জায়গায়: ${a.r.name} (${a.name}) আর ${b.r.name} (${b.name}) — এলাকা দুজনকে দেওয়া হয়েছে কি?`, `Two routes share a place: ${a.r.name} / ${b.r.name}`) })
    }
    return out } },
]

/** Every finding of every rule (rules named in `skip` are left out), the red ones first. */
export function runChecks(o: ZoneOverview, t: Tr, skip: readonly string[] = []): Finding[] {
  return ROUTE_CHECKS.filter(c => !skip.includes(c.id)).flatMap(c => c.run(o, t)).sort((x, y) => (x.tone === y.tone ? 0 : x.tone === 'bad' ? -1 : 1))
}
