// The "add a location" engine of the route module — everything that turns a person's typing, pasting, tapping or file into a place for a stop.
// Written as small replaceable parts, so a new way of finding a place is ONE new entry in LOCATION_SOURCES (see docs/ROUTE_MODULE.md):
//   coords   — a pasted point: "24.37, 88.60", a Google / OpenStreetMap link, degrees-minutes-seconds, a Plus Code, Bangla digits
//   library  — the district's own place names (villages, paras, markets, unions), searched on the phone at once, no network
//   stops    — stops other routes of the zone already have (the same market is not mapped twice)
//   hubs     — the hubs of the zone
//   online   — OpenStreetMap place search (Nominatim), leaning towards the hub
// Pure file (no React, no database): tests/routeModule.test.mjs runs it. The few functions that call the network say so.
import { bearing, hasGps, inBd, isShortMapLink, meters, parseLocation, type LatLng } from './routeGeo.ts'
import type { Place, RouteHub, RouteStop, StopKind, ZoneRoute } from './routes.ts'

export type Lang = 'bn' | 'en'
export type SourceId = 'coords' | 'library' | 'stops' | 'hubs' | 'online' | 'file' | 'gps' | 'map'
/** One possible place for a stop. `lat`/`lng` null = a name only (the person places it on the map later). */
export type Candidate = { id: string; source: SourceId; name: string; sub?: string; lat: number | null; lng: number | null; kind: StopKind
  distM: number | null; /** a library place this came from (to keep its kind / not to save it again) */ placeId?: string }
/** What a source may look at: the hub the route belongs to, the zone's hubs, routes and the place library. */
export type SourceEnv = { hub: { name: string; lat: number | null; lng: number | null } | null; hubs: RouteHub[]; places: Place[]; routes: ZoneRoute[]; lang: Lang
  /** the route being edited (its stops are not offered back to itself) */ skipRoute?: string | null }
export type LocationSource = {
  id: SourceId; bn: string; en: string; icon: string
  /** remote sources use the network: they run only when the person asks (Enter / the button), never on each key */
  remote: boolean
  search: (q: string, env: SourceEnv) => Candidate[] | Promise<Candidate[]>
}

// ---------------------------------------------------------------- small helpers
/** Names compared the way people type them: no case, no zero-width joiners, one space. */
export const norm = (s: string | null | undefined) => (s ?? '').normalize('NFC').toLowerCase().replace(/[‌‍]/g, '').replace(/[()[\].,;:'"।-]/g, ' ').replace(/\s+/g, ' ').trim()
/** 0 = no match, higher = better: whole name > starts with > every word found > contains. */
export function nameScore(name: string, q: string): number {
  const a = norm(name), b = norm(q)
  if (!a || !b) return 0
  if (a === b) return 100
  if (a.startsWith(b)) return 80
  const words = b.split(' ')
  if (words.length > 1 && words.every(w => a.includes(w))) return 60
  return a.includes(b) ? 50 : 0
}
export const distTo = (from: LatLng | null | undefined, to: { lat: number | null; lng: number | null }) =>
  from && hasGps(to) ? Math.round(meters(from, to)) : null
const hubPoint = (env: SourceEnv): LatLng | null => env.hub && hasGps(env.hub) ? { lat: env.hub.lat, lng: env.hub.lng } : null
const placeNameOf = (p: Pick<Place, 'name' | 'name_bn'>, lang: Lang) => (lang === 'en' ? p.name || p.name_bn : p.name_bn || p.name) || ''
const kindOfPlace = (k: Place['kind']): StopKind => k === 'market' ? 'landmark' : 'area'

// ---------------------------------------------------------------- the sources
const coordsSource: LocationSource = { id: 'coords', bn: 'লিংক / নম্বর', en: 'Link / numbers', icon: 'map', remote: false,
  search: (q, env) => {
    const p = parseLocation(q)
    if (!p) return []
    return [{ id: `c:${p.lat},${p.lng}`, source: 'coords', name: `${p.lat}, ${p.lng}`, lat: p.lat, lng: p.lng, kind: 'point', distM: distTo(hubPoint(env), p),
      sub: inBd(p.lat, p.lng) ? undefined : 'বাংলাদেশের বাইরে' }]
  } }

const librarySource: LocationSource = { id: 'library', bn: 'এলাকার তালিকা', en: 'Place library', icon: 'hub', remote: false,
  search: (q, env) => {
    const hub = hubPoint(env)
    return env.places.filter(p => !p.hidden).map(p => ({ p, s: Math.max(nameScore(p.name_bn ?? '', q), nameScore(p.name ?? '', q)) })).filter(x => x.s > 0)
      .map(({ p, s }) => ({ s, c: { id: `p:${p.id}`, source: 'library' as const, placeId: p.id, name: placeNameOf(p, env.lang), kind: kindOfPlace(p.kind), lat: p.lat, lng: p.lng,
        distM: distTo(hub, p), sub: p.kind } as Candidate }))
      .sort((a, b) => b.s - a.s || (a.c.distM ?? 1e12) - (b.c.distM ?? 1e12)).slice(0, 12).map(x => x.c)
  } }

const stopsSource: LocationSource = { id: 'stops', bn: 'অন্য রুটের স্টপ', en: 'Stops of other routes', icon: 'truck', remote: false,
  search: (q, env) => {
    const hub = hubPoint(env), out: Array<{ s: number; c: Candidate }> = []
    for (const r of env.routes) { if (r.id === env.skipRoute) continue
      for (const s of r.stops) { const sc = nameScore(s.name, q); if (sc > 0) out.push({ s: sc, c: { id: `s:${s.id ?? r.id + s.name}`, source: 'stops', name: s.name, kind: s.kind, lat: s.lat, lng: s.lng,
        distM: distTo(hub, s), sub: r.name } }) } }
    return out.sort((a, b) => b.s - a.s || (a.c.distM ?? 1e12) - (b.c.distM ?? 1e12)).slice(0, 8).map(x => x.c)
  } }

const hubsSource: LocationSource = { id: 'hubs', bn: 'হাব', en: 'Hubs', icon: 'hub', remote: false,
  search: (q, env) => {
    const hub = hubPoint(env)
    return env.hubs.map(h => ({ h, s: nameScore(h.name, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4)
      .map(({ h }) => ({ id: `h:${h.id}`, source: 'hubs' as const, name: h.name, kind: 'point' as const, lat: h.lat, lng: h.lng, distM: distTo(hub, h) }))
  } }

/** OpenStreetMap search; the box around the hub makes a local name win over a same-named place far away. */
export async function searchOnline(q: string, near: LatLng | null): Promise<Candidate[]> {
  const box = near ? `&viewbox=${near.lng - 0.6},${near.lat + 0.6},${near.lng + 0.6},${near.lat - 0.6}` : ''
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=bd&accept-language=bn,en${box}&q=${encodeURIComponent(q)}`
  const r = await throttled(() => fetch(url, { headers: { Accept: 'application/json' } }))
  if (!r.ok) throw new Error('অনলাইনে খোঁজা যায়নি, একটু পরে আবার চেষ্টা করুন')
  const rows = (await r.json()) as Array<{ lat: string; lon: string; display_name: string; osm_id?: number; type?: string }>
  return rows.map((x, i) => { const lat = +Number(x.lat).toFixed(7), lng = +Number(x.lon).toFixed(7), parts = x.display_name.split(',').map(t => t.trim())
    return { id: `o:${x.osm_id ?? i}:${lat},${lng}`, source: 'online' as const, name: parts[0], sub: parts.slice(1, 3).join(', '), lat, lng, kind: 'area' as const, distM: near ? Math.round(meters(near, { lat, lng })) : null } })
}
const onlineSource: LocationSource = { id: 'online', bn: 'অনলাইন (OpenStreetMap)', en: 'Online (OpenStreetMap)', icon: 'search', remote: true,
  search: (q, env) => searchOnline(q, hubPoint(env)) }

/** The order here is the order results are listed. Add a new source here and every place that adds a location can use it. */
export const LOCATION_SOURCES: LocationSource[] = [coordsSource, librarySource, stopsSource, hubsSource, onlineSource]

/** Everything that needs no network, best first. */
export function searchLocal(q: string, env: SourceEnv): Candidate[] {
  const t = q.trim()
  if (t.length < 2) return []
  return LOCATION_SOURCES.filter(s => !s.remote).flatMap(s => s.search(t, env) as Candidate[])
}
/** The local results plus the online ones; an online failure leaves the local results and says why. */
export async function searchAll(q: string, env: SourceEnv): Promise<{ list: Candidate[]; error: string | null }> {
  const list = searchLocal(q, env)
  if (parseLocation(q)) return { list, error: null }
  try {
    const online = await Promise.all(LOCATION_SOURCES.filter(s => s.remote).map(s => s.search(q.trim(), env)))
    const seen = list.filter(c => hasGps(c))
    // a place found online right where the library already has one is the same place
    return { list: [...list, ...online.flat().filter(c => !seen.some(k => meters(k as LatLng, c as LatLng) < 80 && nameScore(k.name, c.name) > 0))], error: null }
  } catch (e) { return { list, error: e instanceof Error ? e.message : String(e) } }
}
/** What to say when a pasted thing is not a place we can read. */
export function pasteProblem(q: string): 'short-link' | null { return isShortMapLink(q) && !parseLocation(q) ? 'short-link' : null }

/** The nearest places of the library to the hub, for the empty search box. */
export function nearHub(env: SourceEnv, count = 6): Candidate[] {
  const hub = hubPoint(env)
  if (!hub) return []
  return env.places.filter(p => !p.hidden && hasGps(p)).map(p => ({ p, d: Math.round(meters(hub, p as LatLng)) })).sort((a, b) => a.d - b.d).slice(0, count)
    .map(({ p, d }) => ({ id: `p:${p.id}`, source: 'library' as const, placeId: p.id, name: placeNameOf(p, env.lang), kind: kindOfPlace(p.kind), lat: p.lat, lng: p.lng, distM: d, sub: p.kind }))
}

// ---------------------------------------------------------------- the network is shared politely (Nominatim allows one request a second)
let lastCall = Promise.resolve()
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = lastCall.then(fn)
  lastCall = run.then(() => new Promise<void>(ok => setTimeout(ok, 1100)), () => new Promise<void>(ok => setTimeout(ok, 1100)))
  return run
}
const nameCache = new Map<string, string | null>()
/** A name for a tapped point: the nearest place of the library when one is close (no network), else OpenStreetMap's name for the spot. */
export function nameFromLibrary(p: LatLng, places: Place[], lang: Lang, within = 350): { name: string; kind: StopKind; distM: number } | null {
  let best: { pl: Place; d: number } | null = null
  for (const pl of places) { if (pl.hidden || !hasGps(pl)) continue; const d = meters(p, pl as LatLng); if (d <= within && (!best || d < best.d)) best = { pl, d } }
  return best ? { name: placeNameOf(best.pl, lang), kind: kindOfPlace(best.pl.kind), distM: Math.round(best.d) } : null
}
export async function reverseName(p: LatLng): Promise<string | null> {
  const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
  if (nameCache.has(key)) return nameCache.get(key) ?? null
  try {
    const r = await throttled(() => fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=bn,en&lat=${p.lat}&lon=${p.lng}`, { headers: { Accept: 'application/json' } }))
    if (!r.ok) return null
    const j = await r.json() as { name?: string; address?: Record<string, string> }
    const a = j.address ?? {}
    const name = j.name || a.hamlet || a.village || a.neighbourhood || a.suburb || a.road || a.town || a.city_district || a.city || null
    nameCache.set(key, name); return name
  } catch { return null }
}

// ---------------------------------------------------------------- is a new stop sensible? (shown after it is added, never blocks)
export type Note = { tone: 'warn' | 'info'; code: 'same-route' | 'other-route' | 'far-hub' | 'outside-bd' | 'rough-gps' | 'no-location'; bn: string; en: string }
/**
 * The things worth telling a person right after they put a stop somewhere: a stop (of this or another route of the hub) is already there,
 * the place is far from the hub, the phone's GPS was rough. `m` is how close counts as "already there".
 */
export function assess(p: { lat: number | null; lng: number | null }, ctx: { hub: LatLng | null; stops: RouteStop[]; others: Array<{ route: string; name: string; lat: number; lng: number }>
  accuracy?: number | null; skipIndex?: number | null; farKm?: number; m?: number }): Note[] {
  if (!hasGps(p)) return [{ tone: 'info', code: 'no-location', bn: 'এই স্টপের লোকেশন নেই — পরে ম্যাপে চাপ দিয়ে বা খুঁজে বসান', en: 'This stop has no location yet — place it later by tapping the map or searching' }]
  const out: Note[] = [], m = ctx.m ?? 60, at = p as LatLng
  if (!inBd(p.lat, p.lng)) return [{ tone: 'warn', code: 'outside-bd', bn: 'লোকেশন বাংলাদেশের বাইরে পড়ছে — অক্ষাংশ আর দ্রাঘিমাংশ উল্টো হয়নি তো?', en: 'The location falls outside Bangladesh — are latitude and longitude swapped?' }]
  const same = ctx.stops.map((s, i) => ({ s, i })).filter(x => x.i !== ctx.skipIndex && hasGps(x.s)).map(x => ({ ...x, d: meters(at, x.s as LatLng) })).filter(x => x.d <= m).sort((a, b) => a.d - b.d)[0]
  if (same) out.push({ tone: 'warn', code: 'same-route', bn: `কাছেই (${Math.round(same.d)} মি.) এই রুটেরই ${same.i + 1} নম্বর স্টপ "${same.s.name}" আছে — একই জায়গা দুবার নয় তো?`,
    en: `Stop ${same.i + 1} "${same.s.name}" of this route is ${Math.round(same.d)} m away — the same place twice?` })
  const other = ctx.others.map(o => ({ o, d: meters(at, o) })).filter(x => x.d <= m).sort((a, b) => a.d - b.d)[0]
  if (other) out.push({ tone: 'warn', code: 'other-route', bn: `কাছেই (${Math.round(other.d)} মি.) অন্য রুট "${other.o.route}"-এর স্টপ "${other.o.name}" আছে — এলাকা দুজনকে দেওয়া হচ্ছে না তো?`,
    en: `Route "${other.o.route}" has a stop "${other.o.name}" ${Math.round(other.d)} m away — is this area given to two routes?` })
  if (ctx.hub) { const km = meters(ctx.hub, at) / 1000, lim = ctx.farKm ?? 50
    if (km > lim) out.push({ tone: 'warn', code: 'far-hub', bn: `এই লোকেশন হাব থেকে সোজা ${Math.round(km)} কিমি দূরে — ঠিক জায়গা তো?`, en: `This is ${Math.round(km)} km in a straight line from the hub — is it the right place?` }) }
  if (ctx.accuracy && ctx.accuracy > 100) out.push({ tone: 'warn', code: 'rough-gps', bn: `ফোনের GPS ঠিকঠাক নয় (±${ctx.accuracy} মি.) — খোলা জায়গায় গিয়ে আবার নিন, বা ম্যাপে ঠিক করে নিন`,
    en: `The phone's GPS is rough (±${ctx.accuracy} m) — try again in the open, or fix it on the map` })
  return out
}

// ---------------------------------------------------------------- many at once: a pasted list or a file → stops with a location found for each name
export type BulkLine = { key: number; raw: string; name: string; lat: number | null; lng: number | null; kind: StopKind
  status: 'given' | 'found' | 'many' | 'missing'; from?: SourceId; options: Candidate[]; use: boolean }
const HEAD = { name: /^(?:name|নাম|স্টপ|stop|এলাকা|area|place|জায়গা)/i, lat: /^(?:lat|latitude|অক্ষাংশ)/i, lng: /^(?:lng|lon|long|longitude|দ্রাঘিমাংশ)/i, loc: /^(?:location|loc|লোকেশন|ম্যাপ|map|link|লিংক|gps|coordinates)/i }
const blank = (key: number, raw: string, name: string): BulkLine => ({ key, raw, name, lat: null, lng: null, kind: 'area', status: 'missing', options: [], use: true })
/** Lines of "name, lat, lng" / "name, link" / "name" (comma, tab or semicolon). */
export function parseBulkText(text: string): BulkLine[] {
  const out: BulkLine[] = []
  for (const raw of text.split('\n').map(x => x.trim()).filter(Boolean)) {
    const parts = raw.split(/[,\t;]/), name = parts[0].trim()
    if (!name) continue
    const ll = parseLocation(parts.slice(1).join(',').trim()) ?? parseLocation(raw.slice(name.length + 1))
    out.push({ ...blank(out.length, raw, name), lat: ll?.lat ?? null, lng: ll?.lng ?? null, status: ll ? 'given' : 'missing' })
  }
  return out
}
/** Rows of a sheet (Excel / CSV). A first row of headings (নাম / lat / lng / লোকেশন) is used when it looks like one; else column 1 = name, the rest = the location. */
export function parseBulkRows(rows: string[][]): BulkLine[] {
  const cells = rows.map(r => r.map(c => (c ?? '').toString().trim())).filter(r => r.some(Boolean))
  if (!cells.length) return []
  const head = cells[0]
  const col = (re: RegExp) => head.findIndex(h => re.test(h))
  let iName = col(HEAD.name), iLat = col(HEAD.lat), iLng = col(HEAD.lng), iLoc = col(HEAD.loc)
  const hasHead = iName >= 0 || iLat >= 0 || iLng >= 0 || iLoc >= 0
  if (!hasHead) { iName = 0; iLat = -1; iLng = -1; iLoc = -1 }
  if (iName < 0) iName = 0
  const out: BulkLine[] = []
  for (const r of cells.slice(hasHead ? 1 : 0)) {
    const name = r[iName]
    if (!name) continue
    let ll = iLat >= 0 && iLng >= 0 ? parseLocation(`${r[iLat]}, ${r[iLng]}`) : null
    if (!ll && iLoc >= 0) ll = parseLocation(r[iLoc] ?? '')
    if (!ll && !hasHead) ll = parseLocation(r.slice(1).join(','))
    out.push({ ...blank(out.length, r.join(' | '), name), lat: ll?.lat ?? null, lng: ll?.lng ?? null, status: ll ? 'given' : 'missing' })
  }
  return out
}
/**
 * Finds a location for every line that has none: first the library by the exact name (instant, no network); a lone close match is taken,
 * several are left for the person to choose; the rest are searched online one by one (one a second). `onStep` reports progress.
 */
export async function resolveBulk(lines: BulkLine[], env: SourceEnv, opts: { online: boolean; onStep?: (done: number, total: number, lines: BulkLine[]) => void; signal?: { stop: boolean } }): Promise<BulkLine[]> {
  const out = lines.map(l => ({ ...l }))
  const todo = out.filter(l => l.status === 'missing')
  const hub = hubPoint(env)
  let done = 0
  for (const l of todo) {
    if (opts.signal?.stop) break
    const local = [...(librarySource.search(l.name, env) as Candidate[]), ...(stopsSource.search(l.name, env) as Candidate[])].filter(c => hasGps(c))
    const exact = local.filter(c => norm(c.name) === norm(l.name))
    const pick = exact.length === 1 ? exact[0] : local.length === 1 ? local[0] : null
    if (pick) { l.lat = pick.lat; l.lng = pick.lng; l.kind = pick.kind; l.status = 'found'; l.from = pick.source; l.options = local }
    else if (local.length > 1) { l.options = local; l.status = 'many' }
    else if (opts.online) {
      try { const online = await searchOnline(l.name, hub); l.options = online
        if (online.length) { l.lat = online[0].lat; l.lng = online[0].lng; l.status = online.length === 1 ? 'found' : 'many'; l.from = 'online'; if (online.length > 1) { l.lat = null; l.lng = null } } }
      catch { /* leave it missing; the rest goes on */ }
    }
    done++; opts.onStep?.(done, todo.length, out)
  }
  return out
}
export const bulkToStops = (lines: BulkLine[]): RouteStop[] => lines.filter(l => l.use).map(l => ({ name: l.name, kind: l.kind, lat: l.lat, lng: l.lng, radius_m: null, minutes: null, note: null }))

// ---------------------------------------------------------------- remembered searches (only this browser; never needed)
const RECENT = 'xzm_route_recent'
export const recents = {
  get(): string[] { try { const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 8) : [] } catch { return [] } },
  push(q: string) { const t = q.trim(); if (t.length < 2) return; try { localStorage.setItem(RECENT, JSON.stringify([t, ...recents.get().filter(x => x !== t)].slice(0, 8))) } catch { /* private window */ } },
}
/** A short direction word ("পূর্ব") from the hub to a point, for the result rows. */
export const bearingWord = (from: LatLng, to: LatLng) => {
  const deg = (bearing(from, to) + 360 + 22.5) % 360
  return ['উত্তর', 'উত্তর-পূর্ব', 'পূর্ব', 'দক্ষিণ-পূর্ব', 'দক্ষিণ', 'দক্ষিণ-পশ্চিম', 'পশ্চিম', 'উত্তর-পশ্চিম'][Math.floor(deg / 45)]
}
