// Places for sorting routes: a small built-in list of district / upazila towns with approximate GPS
// (good enough to draw a route and estimate the distance; any point can be moved on the map),
// ready-made routes the owner asked for, and the automatic route check ("স্মার্ট বিশ্লেষণ").
// Everything here is computed in the browser — no outside AI or map service is called.

export type Place = { bn: string; en: string; lat: number; lng: number; alias?: string[] }

/** Approximate town centres (district HQ or upazila). */
export const PLACES: Place[] = [
  { bn: 'নাটোর', en: 'Natore', lat: 24.4102, lng: 89.0076 },
  { bn: 'সাভার', en: 'Savar', lat: 23.8583, lng: 90.2667 },
  { bn: 'আশুলিয়া', en: 'Ashulia', lat: 23.893, lng: 90.321 },
  { bn: 'ঢাকা', en: 'Dhaka', lat: 23.8103, lng: 90.4125 },
  { bn: 'গাজীপুর', en: 'Gazipur', lat: 23.9999, lng: 90.4203 },
  { bn: 'মানিকগঞ্জ', en: 'Manikganj', lat: 23.8617, lng: 90.0003 },
  { bn: 'টাঙ্গাইল', en: 'Tangail', lat: 24.2513, lng: 89.9167 },
  { bn: 'এলেঙ্গা', en: 'Elenga', lat: 24.34, lng: 89.92 },
  { bn: 'হাটিকুমরুল', en: 'Hatikumrul', lat: 24.43, lng: 89.56 },
  { bn: 'সিরাজগঞ্জ', en: 'Sirajganj', lat: 24.4534, lng: 89.7007 },
  { bn: 'পাবনা', en: 'Pabna', lat: 24.0064, lng: 89.2372 },
  { bn: 'ঈশ্বরদী', en: 'Ishwardi', lat: 24.129, lng: 89.066 },
  { bn: 'কুষ্টিয়া', en: 'Kushtia', lat: 23.9013, lng: 89.12 },
  { bn: 'রাজশাহী', en: 'Rajshahi', lat: 24.3745, lng: 88.6042 },
  { bn: 'পুঠিয়া', en: 'Puthia', lat: 24.364, lng: 88.848 },
  { bn: 'চারঘাট', en: 'Charghat', lat: 24.286, lng: 88.77 },
  { bn: 'বাঘা', en: 'Bagha', lat: 24.193, lng: 88.837 },
  { bn: 'দুর্গাপুর', en: 'Durgapur', lat: 24.46, lng: 88.77 },
  { bn: 'মোহনপুর', en: 'Mohanpur', lat: 24.56, lng: 88.65 },
  { bn: 'তানোর', en: 'Tanore', lat: 24.617, lng: 88.56 },
  { bn: 'গোদাগাড়ী', en: 'Godagari', lat: 24.466, lng: 88.333 },
  { bn: 'চাঁপাইনবাবগঞ্জ', en: 'Chapainawabganj', lat: 24.5965, lng: 88.2776, alias: ['চাপাই', 'চাঁপাই', 'চাপাইনবাবগঞ্জ', 'Chapai', 'Nawabganj'] },
  { bn: 'শিবগঞ্জ (চাঁপাই)', en: 'Shibganj (Chapai)', lat: 24.68, lng: 88.16 },
  { bn: 'নাচোল', en: 'Nachole', lat: 24.731, lng: 88.417 },
  { bn: 'রহনপুর', en: 'Rohanpur', lat: 24.79, lng: 88.317 },
  { bn: 'নওগাঁ', en: 'Naogaon', lat: 24.7936, lng: 88.9318 },
  { bn: 'জয়পুরহাট', en: 'Joypurhat', lat: 25.0968, lng: 89.0227 },
  { bn: 'বগুড়া', en: 'Bogura', lat: 24.8465, lng: 89.3773, alias: ['বগুরা', 'Bogra'] },
  { bn: 'শেরপুর (বগুড়া)', en: 'Sherpur (Bogura)', lat: 24.665, lng: 89.418 },
  { bn: 'গাইবান্ধা', en: 'Gaibandha', lat: 25.3288, lng: 89.5286 },
  { bn: 'গোবিন্দগঞ্জ', en: 'Gobindaganj', lat: 25.133, lng: 89.383 },
  { bn: 'পলাশবাড়ী', en: 'Palashbari', lat: 25.27, lng: 89.36 },
  { bn: 'পীরগঞ্জ (রংপুর)', en: 'Pirganj (Rangpur)', lat: 25.426, lng: 89.315 },
  { bn: 'মিঠাপুকুর', en: 'Mithapukur', lat: 25.56, lng: 89.28 },
  { bn: 'রংপুর', en: 'Rangpur', lat: 25.7439, lng: 89.2752 },
  { bn: 'সৈয়দপুর', en: 'Saidpur', lat: 25.778, lng: 88.892 },
  { bn: 'দিনাজপুর', en: 'Dinajpur', lat: 25.6217, lng: 88.6355 },
  { bn: 'নীলফামারী', en: 'Nilphamari', lat: 25.931, lng: 88.856 },
  { bn: 'লালমনিরহাট', en: 'Lalmonirhat', lat: 25.9923, lng: 89.2847 },
  { bn: 'কুড়িগ্রাম', en: 'Kurigram', lat: 25.8054, lng: 89.6362 },
  { bn: 'ঠাকুরগাঁও', en: 'Thakurgaon', lat: 26.0336, lng: 88.4616 },
  { bn: 'পঞ্চগড়', en: 'Panchagarh', lat: 26.3411, lng: 88.5542 },
  { bn: 'সিংড়া', en: 'Singra', lat: 24.504, lng: 89.136 },
  { bn: 'গুরুদাসপুর', en: 'Gurudaspur', lat: 24.38, lng: 89.26 },
  { bn: 'বড়াইগ্রাম', en: 'Baraigram', lat: 24.309, lng: 89.17 },
  { bn: 'বনপাড়া', en: 'Bonpara', lat: 24.256, lng: 89.046 },
  { bn: 'লালপুর', en: 'Lalpur', lat: 24.187, lng: 88.975 },
  { bn: 'বাগাতিপাড়া', en: 'Bagatipara', lat: 24.325, lng: 88.925 },
]

const norm = (s: string) => s.toLowerCase().replace(/\s+|[()]/g, '')
/** A place by its name in Bangla or English (or a known spelling). */
export function findPlace(name: string): Place | null {
  const k = norm(name)
  if (k.length < 2) return null
  return PLACES.find(p => [p.bn, p.en, ...(p.alias ?? [])].some(x => norm(x) === k))
    ?? PLACES.find(p => [p.bn, p.en, ...(p.alias ?? [])].some(x => norm(x).startsWith(k) || k.startsWith(norm(x))))
    ?? null
}

/** Straight-line distance in km. */
export function km(a: [number, number], b: [number, number]): number {
  const R = 6371, r = Math.PI / 180
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
/** Roads are longer than a straight line; ~1.3 × is a fair rule for Bangladesh highways. */
export const ROAD = 1.3
export const SPEED = { hub: 30, linehaul: 40 } as const   // average km/h with stops and traffic

/** Ready-made routes (the owner's list). Stops are places; the route starts at the sorting center. */
export const TEMPLATES: Array<{ key: string; bn: string; en: string; kind: 'hub' | 'linehaul'; stops: string[]; depart?: string }> = [
  { key: 'savar', bn: 'নাটোর শটিং → সাভার', en: 'Natore sorting → Savar', kind: 'linehaul', stops: ['সাভার'], depart: '21:00' },
  { key: 'raj', bn: 'নাটোর শটিং → রাজশাহী → চাঁপাই', en: 'Natore sorting → Rajshahi → Chapai', kind: 'linehaul', stops: ['রাজশাহী', 'চাঁপাইনবাবগঞ্জ'], depart: '05:30' },
  { key: 'rang', bn: 'নাটোর শটিং → বগুড়া → রংপুর', en: 'Natore sorting → Bogura → Rangpur', kind: 'linehaul', stops: ['বগুড়া', 'রংপুর'], depart: '05:00' },
]

export type CheckStop = { label: string; lat: number | null; lng: number | null; arrive: string | null; hub: boolean; crew: number }
export type CheckRoute = { name: string; kind: 'hub' | 'linehaul'; depart: string | null; ret: string | null; vehicle: boolean
  crew: Array<{ role: string; phone: string }>; stops: CheckStop[]; instructions: boolean }
export type Finding = { tone: 'ok' | 'warn' | 'bad' | 'info'; bn: string; en: string }
export type Analysis = { km: number | null; minutes: number | null; legs: Array<{ km: number; minutes: number; eta: string | null }>; findings: Finding[] }

const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return Number.isNaN(h) ? null : h * 60 + (m || 0) }
const hhmm = (m: number) => { const d = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}` }

/**
 * Looks at one route the way a careful dispatcher would: distance and time from the GPS points,
 * estimated arrival at each stop from the leaving time, and what is missing (driver, phone numbers,
 * helper on a long route, GPS, times, instructions for the hubs).
 */
export function analyse(r: CheckRoute, start: [number, number] | null): Analysis {
  const f: Finding[] = []
  const speed = SPEED[r.kind] ?? 35
  const legs: Analysis['legs'] = []
  let total = 0, known = true, prev = start
  let clock = toMin(r.depart)
  for (const s of r.stops) {
    const here: [number, number] | null = s.lat !== null && s.lng !== null ? [s.lat, s.lng] : null
    if (!here || !prev) { known = false; legs.push({ km: 0, minutes: 0, eta: null }); if (here) prev = here; continue }
    const d = km(prev, here) * ROAD, m = (d / speed) * 60 + (s.hub ? 15 : 25)   // plus unloading time at the stop
    total += d
    if (clock !== null) clock += m
    legs.push({ km: Math.round(d), minutes: Math.round(m), eta: clock !== null ? hhmm(clock) : null })
    prev = here
  }
  const minutes = legs.reduce((a, l) => a + l.minutes, 0)
  const drivers = r.crew.filter(c => c.role === 'driver')
  if (!drivers.length) f.push({ tone: 'bad', bn: 'ড্রাইভার এসাইন করা নেই', en: 'No driver assigned' })
  else f.push({ tone: 'ok', bn: `ড্রাইভার আছে (${drivers.length} জন)`, en: `Driver assigned (${drivers.length})` })
  if (r.kind === 'linehaul' && !r.crew.some(c => c.role === 'helper')) f.push({ tone: 'warn', bn: 'দূরের রুটে হেল্পার নেই — লোড/আনলোডে দেরি হতে পারে', en: 'No helper on a long route — loading may be slow' })
  if (!r.crew.some(c => c.role === 'manager' || c.role === 'supervisor')) f.push({ tone: 'warn', bn: 'রুটের দায়িত্বে কোনো ম্যানেজার নেই — হাবগুলো কাকে ফোন করবে?', en: 'No manager on the route — whom do hubs call?' })
  if (!r.vehicle) f.push({ tone: 'warn', bn: 'গাড়ি বাছা হয়নি', en: 'No vehicle chosen' })
  if (!r.depart) f.push({ tone: 'warn', bn: 'ছাড়ার সময় দেওয়া নেই — পৌঁছানোর সময় হিসাব করা যাচ্ছে না', en: 'No leaving time — arrival times cannot be estimated' })
  const noGps = r.stops.filter(s => s.lat === null || s.lng === null)
  if (noGps.length) f.push({ tone: 'warn', bn: `${noGps.map(s => s.label).join(', ')} — জিপিএস নেই, ম্যাপে দেখা যাবে না`, en: `${noGps.map(s => s.label).join(', ')} — no GPS, not on the map` })
  const noCrewHubs = r.stops.filter(s => s.hub && s.crew === 0)
  if (noCrewHubs.length && r.stops.length > 1) f.push({ tone: 'info', bn: `${noCrewHubs.map(s => s.label).join(', ')} — এই স্টপে আলাদা যোগাযোগের লোক নেই (রুটের লোকই দেখাবে)`, en: `${noCrewHubs.map(s => s.label).join(', ')} — no stop contact (route crew shown)` })
  if (!r.instructions) f.push({ tone: 'info', bn: 'হাবগুলোর জন্য কোনো নির্দেশনা লেখা নেই', en: 'No instructions for the hubs' })
  if (known && total > 0) {
    const h = minutes / 60
    if (h > 10) f.push({ tone: 'warn', bn: `পুরো রুট প্রায় ${Math.round(h)} ঘণ্টা — দুজন ড্রাইভার বা বিরতি রাখুন`, en: `About ${Math.round(h)} h — plan a second driver or a rest` })
    const back = toMin(r.ret), dep = toMin(r.depart)
    if (back !== null && dep !== null) {
      const away = ((back - dep) + 1440) % 1440
      if (away > 0 && away < minutes) f.push({ tone: 'bad', bn: `ফেরার সময় খুব কম — শুধু যেতে লাগে ~${Math.round(minutes / 60)} ঘণ্টা`, en: `Return time too early — the trip out alone is ~${Math.round(minutes / 60)} h` })
    }
  }
  const bad = r.crew.filter(c => c.phone.replace(/\D/g, '').length < 11)
  if (bad.length) f.push({ tone: 'warn', bn: `${bad.length}টি নাম্বার ১১ ডিজিটের কম — ঠিক আছে কিনা দেখুন`, en: `${bad.length} numbers are shorter than 11 digits` })
  return { km: known && total > 0 ? Math.round(total) : null, minutes: known && total > 0 ? Math.round(minutes) : null, legs, findings: f }
}

/** Distinct colours for route lines (readable on the map tiles, light or dark UI). */
export const ROUTE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777']
