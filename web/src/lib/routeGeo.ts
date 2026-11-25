// The pure geometry and location-reading part of the route module (no database, no browser): points, distances, order, and
// turning what a person pastes into a point. Kept separate so tests/routeModule.test.mjs can run it. routes.ts re-exports all of it.
import type { RouteRules } from './routes.ts'

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

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
/** Bangla digits and the odd punctuation people paste ("২৪.৩৭, ৮৮.৬০", "24.37°N") → plain ASCII numbers. */
const asciiNumbers = (t: string) => t.replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d))).replace(/[，、;]/g, ',').replace(/[′’‘]/g, "'").replace(/[″”“]/g, '"').replace(/\u00a0/g, ' ')
const OLC = '23456789CFGHJMPQRVWX'
/** A full Plus Code ("7MQ4X7X9+RC") → its centre. Short codes ("X7X9+RC Natore") need a reference place and are not read. */
export function decodePlusCode(text: string): LatLng | null {
  const m = text.trim().toUpperCase().match(new RegExp(`(?:^|\\s)([${OLC}]{8})\\+([${OLC}]{2})[${OLC}]*(?:\\s|$)`))
  if (!m) return null
  const d = (m[1] + m[2]).split('').map(c => OLC.indexOf(c)), pv = [20, 1, 0.05, 0.0025, 0.000125]
  let lat = -90, lng = -180
  for (let i = 0; i < 5; i++) { lat += d[2 * i] * pv[i]; lng += d[2 * i + 1] * pv[i] }
  return { lat: +(lat + 0.0000625).toFixed(7), lng: +(lng + 0.0000625).toFixed(7) }
}
/** Links that hide the numbers behind a redirect: a browser app can not open them, so the page tells the person what to do instead. */
export const isShortMapLink = (t: string) => /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|bit\.ly|tinyurl\.com|share\.google)/i.test(t)

/**
 * What the person typed or pasted → a point. Understands "24.37, 88.60" (also Bangla digits, N/E letters, swapped numbers), degrees-minutes-seconds
 * (24°22'10"N 88°36'20"E), a full Plus Code, a geo: link, and Google Maps / OpenStreetMap links (…@24.37,88.60… / ?q= / !3d!4d / #map=z/lat/lng / mlat=&mlon=).
 */
export function parseLocation(text: string): LatLng | null {
  const t = asciiNumbers(text.trim())
  if (!t) return null
  const fin = (lat: number, lng: number): LatLng | null => {
    if (!inBd(lat, lng) && inBd(lng, lat)) [lat, lng] = [lng, lat]
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: +lat.toFixed(7), lng: +lng.toFixed(7) } : null
  }
  const dms = t.match(/(\d{1,3})\s*[°:]\s*(\d{1,2})\s*['′:]\s*(\d{1,2}(?:\.\d+)?)?\s*["″]?\s*([NSns])[\s,;]*(\d{1,3})\s*[°:]\s*(\d{1,2})\s*['′:]\s*(\d{1,2}(?:\.\d+)?)?\s*["″]?\s*([EWew])/)
  if (dms) {
    const a = Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3] ?? 0) / 3600, b = Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7] ?? 0) / 3600
    return fin(/s/i.test(dms[4]) ? -a : a, /w/i.test(dms[8]) ? -b : b)
  }
  const hemi = t.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])$/)
  if (hemi) return fin(/s/i.test(hemi[2]) ? -Number(hemi[1]) : Number(hemi[1]), /w/i.test(hemi[4]) ? -Number(hemi[3]) : Number(hemi[3]))
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|center|destination|daddr|saddr)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /[?&]mlat=(-?\d+(?:\.\d+)?)&(?:amp;)?mlon=(-?\d+(?:\.\d+)?)/i, /#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/, /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    /^\(?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*\)?$/]
  for (const re of pats) { const m = t.match(re); if (m) { const r = fin(Number(m[1]), Number(m[2])); if (r) return r } }
  return decodePlusCode(t)
}

/** Compass direction from a to b, in Bangla. */
export function direction(a: LatLng, b: LatLng) {
  const deg = (bearing(a, b) + 360 + 22.5) % 360
  return ['উত্তর', 'উত্তর-পূর্ব', 'পূর্ব', 'দক্ষিণ-পূর্ব', 'দক্ষিণ', 'দক্ষিণ-পশ্চিম', 'পশ্চিম', 'উত্তর-পশ্চিম'][Math.floor(deg / 45)]
}
export function bearing(a: LatLng, b: LatLng) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r)
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r)
  return (Math.atan2(y, x) / r + 360) % 360
}
/** Is this place already a stop (within `m` metres of one)? */
export const nearAny = (p: LatLng, stops: LatLng[], m = 250) => stops.some(s => meters(p, s) <= m)
