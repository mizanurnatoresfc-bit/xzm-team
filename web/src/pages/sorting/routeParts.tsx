// Pieces shared by the sorting center's route page and the hub's "শটিং রুট ও রিপোর্ট" page:
// the people on a route (tap to call), the map with every route drawn, and the automatic route check.
import { useMemo } from 'react'
import { Icon } from '../../components/Icon'
import { OsmMap, type MapLine, type MapPin } from '../../components/OsmMap'
import { analyse, findPlace, ROUTE_COLORS, type Analysis } from '../../lib/places'
import { usePrefs } from '../../lib/prefs'
import { CREW_ROLE, telHref, type CenterInfo, type Crew, type FullRoute } from '../../lib/sorting'

/** Where the route starts: the center's own hub GPS, else the town in the center's name, else the first stop. */
export function startPoint(center: CenterInfo | null | undefined, routes: FullRoute[]): [number, number] | null {
  if (center?.latitude != null && center.longitude != null) return [Number(center.latitude), Number(center.longitude)]
  const byName = center ? findPlace(center.name.split(/\s+/)[0]) : null
  if (byName) return [byName.lat, byName.lng]
  const s = routes.flatMap(r => r.stops).find(x => x.latitude != null && x.longitude != null)
  return s ? [Number(s.latitude), Number(s.longitude)] : null
}

export function routeAnalysis(r: FullRoute, start: [number, number] | null): Analysis {
  return analyse({
    name: r.name, kind: r.kind, depart: r.depart_time?.slice(0, 5) ?? null, ret: r.return_time?.slice(0, 5) ?? null, vehicle: !!r.vehicle_id,
    instructions: !!r.instructions?.trim() || r.stops.some(s => !!s.instructions?.trim()),
    crew: r.crew.map(c => ({ role: c.role, phone: c.phone })),
    stops: r.stops.map(s => ({ label: s.label, lat: s.latitude != null ? Number(s.latitude) : null, lng: s.longitude != null ? Number(s.longitude) : null,
      arrive: s.arrive_time, hub: !!s.hub_id, crew: r.crew.filter(c => c.stop_id === s.id).length })),
  }, start)
}

/** People on a route or a stop: role, name, number (a call link). */
export function CrewList({ crew, empty, onEnd }: { crew: Crew[]; empty?: string; onEnd?: (c: Crew) => void }) {
  const { L } = usePrefs()
  if (!crew.length) return <p className="muted small">{empty ?? L('এখনো কাউকে এসাইন করা হয়নি', 'Nobody assigned yet')}</p>
  return <ul className="crew-list">{crew.map(c => <li key={c.id}>
    <span className={`crew-ic r-${c.role}`}><Icon name={CREW_ROLE[c.role][2]} size={15} /></span>
    <span className="crew-tx"><b>{c.name}</b><small>{L(CREW_ROLE[c.role][0], CREW_ROLE[c.role][1])}{c.employee_code ? ` · ${L('আইডি', 'ID')} ${c.employee_code}` : ''}{c.note ? ` · ${c.note}` : ''}</small></span>
    <a className="crew-call" href={telHref(c.phone)}><Icon name="phone" size={14} />{c.phone}</a>
    {onEnd && <button type="button" className="secondary sm" aria-label={L('সরান', 'Remove')} onClick={() => onEnd(c)}><Icon name="x" size={13} /></button>}
  </li>)}</ul>
}

/** Every route drawn on the map, one colour each; the start is the sorting center. Highlights one hub when given. */
export function RoutesMap({ center, routes, highlightHub, height = 380 }: { center: CenterInfo | null; routes: FullRoute[]; highlightHub?: string; height?: number }) {
  const { L } = usePrefs()
  const start = startPoint(center, routes)
  const { pins, lines } = useMemo(() => {
    const pins: MapPin[] = []; const lines: MapLine[] = []
    if (start && center) pins.push({ id: 'center', lat: start[0], lng: start[1], label: center.name, tone: 'sel' })
    routes.forEach((r, i) => {
      const pts: Array<[number, number]> = start ? [start] : []
      for (const s of r.stops) {
        if (s.latitude == null || s.longitude == null) continue
        const p: [number, number] = [Number(s.latitude), Number(s.longitude)]
        pts.push(p)
        pins.push({ id: `${r.id}-${s.id}`, lat: p[0], lng: p[1], label: s.label, tone: highlightHub && s.hub_id === highlightHub ? 'wait' : s.hub_id ? 'ok' : 'off' })
      }
      if (pts.length > 1) lines.push({ id: r.id, color: ROUTE_COLORS[i % ROUTE_COLORS.length], points: pts, dashed: r.kind === 'hub', label: r.name })
    })
    return { pins, lines }
  }, [routes, center, start?.[0], start?.[1], highlightHub])
  if (!pins.length) return <p className="muted">{L('ম্যাপে দেখানোর মতো জিপিএস নেই — লোকেশনে জিপিএস দিন।', 'No GPS to draw yet — give the locations GPS.')}</p>
  return <>
    <OsmMap pins={pins} lines={lines} height={height} />
    <div className="route-legend">{routes.map((r, i) => <span key={r.id}><i style={{ background: ROUTE_COLORS[i % ROUTE_COLORS.length] }} />{r.name}</span>)}</div>
  </>
}

const H = (m: number) => m >= 60 ? `${Math.floor(m / 60)}ঘ ${m % 60}মি` : `${m}মি`

/** The automatic check of one route: distance, time, arrival at each stop, and what is missing. */
export function AnalysisBox({ route, start, compact }: { route: FullRoute; start: [number, number] | null; compact?: boolean }) {
  const { L, n } = usePrefs()
  const a = routeAnalysis(route, start)
  const show = compact ? a.findings.filter(f => f.tone === 'bad' || f.tone === 'warn') : a.findings
  return <div className="route-ai">
    <div className="route-ai-h"><Icon name="chart" size={15} /><b>{L('স্মার্ট বিশ্লেষণ', 'Smart check')}</b>
      {a.km !== null && <span className="route-ai-k">~{n(a.km)} {L('কিমি', 'km')} · ~{L(H(a.minutes ?? 0), `${Math.round((a.minutes ?? 0) / 6) / 10} h`)}</span>}</div>
    {!compact && a.legs.some(l => l.km) && <ol className="route-ai-legs">{route.stops.map((s, i) => a.legs[i]?.km ? <li key={s.id}>
      <span>{s.label}</span><span className="muted">+{n(a.legs[i].km)} {L('কিমি', 'km')}</span>
      {(s.arrive_time || a.legs[i].eta) && <b>{s.arrive_time ? s.arrive_time.slice(0, 5) : `~${a.legs[i].eta}`}</b>}</li> : null)}</ol>}
    {show.length ? <ul className="route-ai-f">{show.map((f, i) => <li key={i} className={`t-${f.tone}`}>{L(f.bn, f.en)}</li>)}</ul>
      : <p className="muted small">{L('সব ঠিক আছে।', 'All good.')}</p>}
    {!compact && <p className="muted small">{L('দূরত্ব জিপিএস থেকে আনুমানিক (রাস্তা ≈ সোজা দূরত্ব × ১.৩); সময় গড় গতি ও প্রতি স্টপে আনলোডের সময় ধরে।',
      'Distance is estimated from GPS (road ≈ straight line × 1.3); time from an average speed plus unloading at each stop.')}</p>}
  </div>
}
