import { askReason, tell } from '../../components/ask'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { OsmMap, type MapLine, type MapPin } from '../../components/OsmMap'
import { Badge, Field, Modal, Stat, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { LocationPicker } from '../routes/LocationUI'
import type { SourceEnv } from '../../lib/routeLocation'
import {
  direction, estimate, fmtDist, fmtKm, hasGps, lineKm, meters, nearAny, PLACE_KIND, PLACE_SOURCES, placeName, placesApi, ROUTE_COLORS,
  routeFriendly, stopKindOf, suggestRoutes, upazilaNear, type LatLng, type Place, type PlaceKind, type RouteHub, type RouteStop, type Upazila, type ZoneOverview,
} from '../../lib/routes'

export const placeToStop = (p: Place, lang: 'bn' | 'en' = 'bn'): RouteStop =>
  ({ name: placeName(p, lang), kind: stopKindOf(p.kind), lat: p.lat, lng: p.lng, radius_m: null, minutes: null, note: null })

/** Point-in-polygon using ray casting. Polygon points are [lat, lng]. */
export function insidePolygon(pt: [number, number], poly: Array<[number, number]>): boolean {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [lati, lngi] = poly[i], [latj, lngj] = poly[j]
    if (((lati > pt[0]) !== (latj > pt[0])) && (pt[1] < ((lngj - lngi) * (pt[0] - lati)) / (latj - lati) + lngi)) inside = !inside
  }
  return inside
}

/** Order a set of places as a route from the hub: repeatedly pick the nearest unvisited. Good enough for a dozen stops. */
export function nearestNeighbour(from: LatLng, places: Place[]): Place[] {
  const left = places.filter(hasGps) as Place[]
  const out: Place[] = []
  let cur: LatLng = from
  while (left.length) {
    let best = 0, bestD = Infinity
    for (let i = 0; i < left.length; i++) { const d = meters(cur, left[i] as LatLng); if (d < bestD) { bestD = d; best = i } }
    const p = left.splice(best, 1)[0]; out.push(p); cur = p as LatLng
  }
  return out
}

/** Boundary of an upazila as a dashed map line (Naldanga has none). */
export const boundaryLine = (u: Upazila | undefined): MapLine[] => u?.boundary?.length ? [{ id: `b${u.code}`, color: '#64748b', points: u.boundary, dashed: true, width: 2, opacity: 0.7 }] : []

/** Places loaded once for the page, with the hub's own upazila worked out. */
export function usePlaces() {
  const d = useLoad(() => placesApi.load(), [])
  return { ...d, upazilas: d.data?.upazilas ?? [], places: d.data?.places ?? [] }
}

// ---------------------------------------------------------------- editor side panel: pick places one by one
export function PlacePicker({ hub, stops, others, onAdd, onShow }: {
  hub: RouteHub | undefined; stops: RouteStop[]; others: Array<{ route: string; lat: number; lng: number }>
  onAdd: (p: Place) => void; onShow: (pins: MapPin[], lines: MapLine[], add: (id: string) => void) => void
}) {
  const { L, n, lang } = usePrefs()
  const fmt = { L, n }
  const pl = usePlaces()
  const home = useMemo(() => hub && hasGps(hub) ? upazilaNear(hub as LatLng, pl.places) : null, [hub, pl.places])
  const [upz, setUpz] = useState<number | 'all' | null>(null)
  const [q, setQ] = useState(''); const [kind, setKind] = useState<PlaceKind | ''>('')
  const cur = upz ?? home ?? 'all'
  const mine = stops.filter(hasGps) as Array<RouteStop & LatLng>
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return pl.places.filter(p => !p.hidden && (cur === 'all' || p.upazila_code === cur) && (!kind || p.kind === kind)
      && (!t || `${p.name_bn ?? ''} ${p.name ?? ''}`.toLowerCase().includes(t)))
      .map(p => ({ p, d: hub && hasGps(hub) && hasGps(p) ? meters(hub as LatLng, p as LatLng) : Infinity }))
      .sort((a, b) => a.d - b.d)
  }, [pl.places, cur, kind, q, hub])
  const usedHere = (p: Place) => hasGps(p) && nearAny(p as LatLng, mine, 60)
  const usedBy = (p: Place) => hasGps(p) ? others.find(o => meters(o, p as LatLng) <= 250)?.route : undefined

  // the places of this list on the editor's map (tap one to add it)
  const key = list.map(x => x.p.id).join(',') + '|' + stops.length
  useEffect(() => {
    const pins: MapPin[] = list.slice(0, 400).filter(x => hasGps(x.p) && !usedHere(x.p)).map(x => ({ id: `p:${x.p.id}`, lat: x.p.lat!, lng: x.p.lng!, label: placeName(x.p, lang), num: '+', tone: 'wait' as const }))
    const u = typeof cur === 'number' ? pl.upazilas.find(x => x.code === cur) : undefined
    onShow(pins, boundaryLine(u), id => { const p = pl.places.find(x => `p:${x.id}` === id); if (p) onAdd(p) })
    return () => onShow([], [], () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cur])

  if (pl.error) return <p className="da-error">{routeFriendly(pl.error)}</p>
  if (pl.loading) return <p className="muted small">{L('এলাকার নাম আসছে…', 'Loading place names…')}</p>
  return <div className="rt-card">
    <div className="rt-bar">
      <select value={String(cur)} onChange={e => setUpz(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ flex: 1, minWidth: 0 }}>
        <option value="all">{L('সব উপজেলা', 'All upazilas')}</option>
        {pl.upazilas.map(u => <option key={u.code} value={u.code}>{lang === 'en' ? u.name : u.name_bn}{u.code === home ? L(' (হাবের উপজেলা)', ' (hub)') : ''}</option>)}
      </select>
      <select value={kind} onChange={e => setKind(e.target.value as PlaceKind | '')}>
        <option value="">{L('সব ধরন', 'All kinds')}</option>
        {(Object.keys(PLACE_KIND) as PlaceKind[]).map(k => <option key={k} value={k}>{L(PLACE_KIND[k].bn, PLACE_KIND[k].en)}</option>)}
      </select>
    </div>
    <input placeholder={L('নাম দিয়ে খুঁজুন', 'Search by name')} value={q} onChange={e => setQ(e.target.value)} />
    <p className="rt-hint">{L(`${n(list.length)}টা জায়গা, হাব থেকে কাছেরগুলো আগে। "+" চাপুন বা ম্যাপের হলুদ "+" চিহ্নে চাপুন।`, `${list.length} places, nearest first. Press "+" or the yellow "+" on the map.`)}</p>
    <div className="rt-stops" style={{ maxHeight: '40vh' }}>{list.slice(0, 300).map(({ p, d }) => { const here = usedHere(p); const other = usedBy(p)
      return <div key={p.id} className="rt-stop" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
        <div style={{ minWidth: 0 }}><b className="small">{placeName(p, lang)}</b>{!p.bn_checked && lang === 'bn' && p.name && <span className="muted small"> · {p.name}</span>}
          <div className="rt-meta"><span>{L(PLACE_KIND[p.kind].bn, PLACE_KIND[p.kind].en)}</span>{isFinite(d) && <span>{fmtDist(d, fmt)}</span>}
            {!hasGps(p) && <span>{L('লোকেশন নেই', 'no location')}</span>}{other && <span style={{ color: '#ea580c' }}>{L(`অন্য রুটে: ${other}`, `on ${other}`)}</span>}</div></div>
        <span className="acts"><button type="button" className={here ? 'secondary' : ''} disabled={here} onClick={() => onAdd(p)} aria-label={L('যোগ', 'Add')}>{here ? '✓' : '+'}</button></span>
      </div> })}
      {list.length > 300 && <p className="muted small">{L('আরও আছে — নাম দিয়ে খুঁজুন', 'More — search by name')}</p>}</div>
    <p className="muted small">{PLACE_SOURCES}</p>
  </div>
}

// ---------------------------------------------------------------- the tab: route suggestions by upazila, and the place list
export function PlacesTab({ o, hubOf, initialHub, onBuild }: {
  o: ZoneOverview; hubOf: Record<string, RouteHub>; initialHub: string
  onBuild: (draft: { hub_id: string; name: string; color: string; stops: RouteStop[] }) => void
}) {
  const { can } = useAuth()
  const { L, n, lang } = usePrefs()
  const fmt = { L, n }
  const pl = usePlaces()
  const hubs = o.hubs.filter(h => hasGps(h))
  const [hubId, setHubId] = useState(initialHub && hubOf[initialHub] ? initialHub : hubs[0]?.id ?? '')
  const hub = hubOf[hubId]
  const home = useMemo(() => hub && hasGps(hub) ? upazilaNear(hub as LatLng, pl.places) : null, [hub, pl.places])
  const [ups, setUps] = useState<number[] | null>(null)
  const chosen = ups ?? (home ? [home] : [])
  const freeRiders = hub ? hub.staff.filter(s => s.rider && s.routes === 0).length : 0
  const [count, setCount] = useState<number | null>(null)
  const [maxStops, setMaxStops] = useState(Math.min(15, o.rules.max_stops))
  const [kinds, setKinds] = useState<PlaceKind[]>(['village', 'para', 'market', 'town'])
  const [onlyNew, setOnlyNew] = useState(true)
  const [pick, setPick] = useState<number | null>(null)
  const [edit, setEdit] = useState<Partial<Place> | null>(null)
  const [osm, setOsm] = useState<{ upazila_code: number } | null>(null)
  const [poly, setPoly] = useState<Array<[number, number]> | null>(null)  // polygon-draw mode: null=off, array=vertices (lat,lng)
  const hubRoutes = o.routes.filter(r => r.hub_id === hubId)
  const taken = hubRoutes.flatMap(r => r.stops.filter(hasGps)) as LatLng[]
  const pool = pl.places.filter(p => !p.hidden && chosen.includes(p.upazila_code) && kinds.includes(p.kind))
  const candidates = pool.filter(p => hasGps(p) && (!onlyNew || !nearAny(p as LatLng, taken)))
  const covered = pool.filter(p => hasGps(p) && nearAny(p as LatLng, taken)).length
  const n0 = count ?? Math.max(1, Math.min(8, freeRiders || Math.ceil(candidates.length / Math.max(maxStops, 1))))
  const sug = useMemo(() => hub && hasGps(hub) ? suggestRoutes(hub as LatLng, candidates, n0, maxStops) : { groups: [], left: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hubId, candidates.map(c => c.id).join(','), n0, maxStops])
  const color = (i: number) => ROUTE_COLORS[(hubRoutes.length + i) % ROUTE_COLORS.length]
  const upzName = (code: number) => { const u = pl.upazilas.find(x => x.code === code); return u ? (lang === 'en' ? u.name : u.name_bn) : '' }
  const canEdit = o.can.edit_hubs.includes(hubId)
  const canPlaces = can('ops.route_setting.edit')

  const groupName = (g: Place[]) => {
    if (!hub || !hasGps(hub) || !g.length) return ''
    const c = { lat: g.reduce((t, p) => t + p.lat!, 0) / g.length, lng: g.reduce((t, p) => t + p.lng!, 0) / g.length }
    return `${upzName(g[0].upazila_code)} ${direction(hub as LatLng, c)}`
  }
  // polygon-draw mode: places inside the closed polygon become route stops, nearest-neighbour from the hub
  const polyInside = useMemo(() => {
    if (!poly || poly.length < 3) return [] as Place[]
    return candidates.filter(p => insidePolygon([p.lat!, p.lng!], poly))
  }, [poly, candidates])
  const polyOrdered = useMemo(() => hub && hasGps(hub) && polyInside.length > 0 ? nearestNeighbour(hub as LatLng, polyInside) : [], [polyInside, hub])
  const polyColor = color(0)

  const pins: MapPin[] = poly !== null ? [
    ...(hub && hasGps(hub) ? [{ id: 'hub', lat: hub.lat!, lng: hub.lng!, label: hub.name, num: 'H', square: true }] : []),
    // tiny dots for all candidate places, so the user can see what's inside the area as they draw
    ...candidates.filter(hasGps).slice(0, 500).map(p => ({ id: `c:${p.id}`, lat: p.lat!, lng: p.lng!, label: placeName(p, lang), small: true, color: polyInside.includes(p) ? polyColor : '#94a3b8', tone: 'off' as const })),
    // polygon vertex handles
    ...poly.map(([la, ln], i) => ({ id: `v${i}`, lat: la, lng: ln, label: L(`শীর্ষ ${n(i + 1)}`, `Vertex ${i + 1}`), num: n(i + 1), tone: 'sel' as const })),
  ] : [
    ...(hub && hasGps(hub) ? [{ id: 'hub', lat: hub.lat!, lng: hub.lng!, label: hub.name, num: 'H', square: true }] : []),
    ...sug.groups.flatMap((g, i) => (pick === null || pick === i ? g : []).map((p, j) => ({ id: `g${i}:${p.id}`, lat: p.lat!, lng: p.lng!, label: `${n(j + 1)}. ${placeName(p, lang)}`, num: n(j + 1), color: color(i) }))),
    ...taken.map((s, i) => ({ id: `t${i}`, lat: s.lat, lng: s.lng, label: L('আগের রুটের স্টপ', 'Existing stop'), num: '•', tone: 'off' as const })),
  ]
  const lines: MapLine[] = poly !== null ? [
    ...chosen.flatMap(c => boundaryLine(pl.upazilas.find(u => u.code === c))),
    ...(poly.length >= 2 ? [{ id: 'poly', color: polyColor, points: (poly.length >= 3 ? [...poly, poly[0]] : poly) as Array<[number, number]>, dashed: true, width: 3, opacity: 0.9 }] : []),
  ] : [
    ...chosen.flatMap(c => boundaryLine(pl.upazilas.find(u => u.code === c))),
    ...sug.groups.map((g, i) => ({ id: `l${i}`, color: color(i), points: [[hub!.lat!, hub!.lng!] as [number, number], ...g.map(p => [p.lat!, p.lng!] as [number, number])], dashed: true, width: pick === i ? 5 : 3, opacity: pick === null || pick === i ? 0.85 : 0.2 })),
  ]

  if (pl.error) return <p className="da-error">{routeFriendly(pl.error)}</p>
  return <>
    <section className="panel">
      <div className="da-bar"><h2>{L('উপজেলা ধরে রুট সাজেশন', 'Route suggestions by upazila')}</h2></div>
      <p className="rt-hint">{L('হাব বাছুন — হাবের উপজেলার সব গ্রাম, পাড়া আর বাজার নিজে থেকে আসবে। সিস্টেম দিক অনুযায়ী ভাগ করে রুট সাজিয়ে দেবে; পছন্দ হলে "এই রুট বানান" চেপে দেখে-শুনে সেভ করুন।',
        'Pick a hub: every village, para and market of its upazila comes up, split by direction into routes. Press "Build this route" to check and save.')}</p>
      <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <Field label={L('হাব', 'Hub')}><select value={hubId} onChange={e => { setHubId(e.target.value); setUps(null); setCount(null); setPick(null) }}>
          {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        <Field label={L('কয়টা রুট', 'How many routes')} hint={freeRiders ? L(`রুট ছাড়া রাইডার ${n(freeRiders)} জন`, `${freeRiders} riders without route`) : undefined}>
          <input type="number" min={1} max={20} value={n0} onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></Field>
        <Field label={L('এক রুটে সর্বোচ্চ স্টপ', 'Most stops per route')}><input type="number" min={2} max={o.rules.max_stops} value={maxStops}
          onChange={e => setMaxStops(Math.max(2, Math.min(o.rules.max_stops, Number(e.target.value) || 2)))} /></Field>
        <Field label={L('শুধু যেগুলো এখনো কোনো রুটে নেই', 'Only places not on a route yet')}><label className="small"><input type="checkbox" style={{ width: 'auto', marginRight: 6 }}
          checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} />{onlyNew ? L('হ্যাঁ', 'Yes') : L('না, সব', 'No, all')}</label></Field>
      </div>
      <div className="rt-bar" style={{ margin: '6px 0' }}><span className="small muted">{L('উপজেলা:', 'Upazilas:')}</span>
        {pl.upazilas.map(u => { const on = chosen.includes(u.code)
          return <button key={u.code} type="button" className={on ? 'sm' : 'secondary sm'} onClick={() => setUps(on ? chosen.filter(c => c !== u.code) : [...chosen, u.code])}>
            {lang === 'en' ? u.name : u.name_bn}{u.code === home ? ' ★' : ''}</button> })}</div>
      <div className="rt-bar" style={{ marginBottom: 6 }}><span className="small muted">{L('কী কী নেবে:', 'Include:')}</span>
        {(Object.keys(PLACE_KIND) as PlaceKind[]).map(k => { const on = kinds.includes(k)
          return <button key={k} type="button" className={on ? 'sm' : 'secondary sm'} onClick={() => setKinds(on ? kinds.filter(x => x !== k) : [...kinds, k])}>{L(PLACE_KIND[k].bn, PLACE_KIND[k].en)}</button> })}</div>
      <div className="da-stats">
        <Stat icon="map" label={L('বাছাই করা এলাকায় জায়গা', 'Places in the chosen area')} value={n(pool.length)} sub={L(`লোকেশনসহ ${n(pool.filter(hasGps).length)}`, `${pool.filter(hasGps).length} with location`)} />
        <Stat icon="check" tone="ok" label={L('আগেই কোনো রুটে', 'Already on a route')} value={n(covered)} />
        <Stat icon="alert" tone={candidates.length ? 'warn' : undefined} label={L('রুটে নেওয়া বাকি', 'Not on a route yet')} value={n(pool.filter(p => hasGps(p) && !nearAny(p as LatLng, taken)).length)} />
        <Stat icon="truck" label={L('সাজেশন', 'Suggested')} value={L(`${n(sug.groups.length)}টা রুট`, `${sug.groups.length} routes`)}
          sub={sug.left.length ? L(`${n(sug.left.length)}টা জায়গা বাদ (স্টপের সীমা)`, `${sug.left.length} left out (stop limit)`) : undefined} />
      </div>
      {canEdit && <div className="rt-bar" style={{ marginBottom: 6 }}>
        <button type="button" className={poly !== null ? 'sm' : 'secondary sm'} onClick={() => { setPoly(poly === null ? [] : null); setPick(null) }}
          title={L('ম্যাপে এরিয়া এঁকে এক ক্লিকে একটা রুট বানান', 'Draw an area on the map and build one route from everything inside')}>
          <Icon name="edit" size={13} />{poly !== null ? L('এরিয়া আঁকা বন্ধ', 'Stop drawing') : L('এরিয়া এঁকে রুট বানান', 'Draw area → route')}</button>
        {poly !== null && <>
          <button type="button" className="secondary sm" disabled={!poly.length} onClick={() => setPoly(poly.slice(0, -1))}>{L('শেষ বিন্দু বাদ', 'Undo')}</button>
          <button type="button" className="secondary sm" disabled={!poly.length} onClick={() => setPoly([])}>{L('পরিষ্কার', 'Clear')}</button>
          <span className="small muted">{poly.length < 3 ? L(`ম্যাপে চাপুন — আরও ${n(3 - poly.length)}টা বিন্দু লাগবে`, `Tap the map — need ${3 - poly.length} more`) : L(`${n(polyInside.length)}টা জায়গা ভেতরে`, `${polyInside.length} places inside`)}</span>
          {poly.length >= 3 && polyOrdered.length > 0 && <button type="button" className="sm" onClick={() => {
            onBuild({ hub_id: hubId, name: `${upzName(polyOrdered[0].upazila_code)} ${direction(hub as LatLng, { lat: polyOrdered.reduce((t, p) => t + p.lat!, 0) / polyOrdered.length, lng: polyOrdered.reduce((t, p) => t + p.lng!, 0) / polyOrdered.length })}`, color: polyColor, stops: polyOrdered.slice(0, o.rules.max_stops).map(p => placeToStop(p, lang)) })
            setPoly(null)
          }}><Icon name="plus" size={13} />{L(`এই ${n(Math.min(polyOrdered.length, o.rules.max_stops))}টা দিয়ে রুট বানান`, `Build route from ${Math.min(polyOrdered.length, o.rules.max_stops)}`)}</button>}
        </>}
      </div>}
      {!hub || !hasGps(hub) ? <p className="da-error">{L('এই হাবের GPS নেই — আগে হাব তালিকা ও ম্যাপ থেকে হাবের লোকেশন দিন।', 'This hub has no GPS.')}</p> :
      <div className="rt-layout">
        <OsmMap pins={pins} lines={lines} height={500} tags={poly !== null ? 'selected' : (pick === null ? 'selected' : 'all')} keepView={poly !== null}
          onPick={poly !== null ? (lat, lng) => setPoly([...(poly ?? []), [lat, lng]]) : undefined} />
        <div className="rt-list">
          {poly !== null && <article className="rt-card">
            <header><span className="rt-sw" style={{ background: polyColor }} /><b>{L('এরিয়া আঁকা মোড', 'Draw-area mode')}</b></header>
            <p className="small muted">{L('ম্যাপে একের পর এক বিন্দু চেপে এলাকা ঘিরুন (কমপক্ষে ৩টা)। ভেতরের সব জায়গা হাব থেকে কাছাকাছি অনুসারে স্টপ হয়ে একটা রুটে ঢুকবে।',
              'Tap vertices on the map to enclose an area (at least 3). Every place inside becomes a stop, ordered nearest-first from the hub.')}</p>
            {polyOrdered.length > 0 && <div className="small">{polyOrdered.slice(0, o.rules.max_stops).map(p => placeName(p, lang)).join(' → ')}
              {polyOrdered.length > o.rules.max_stops && <span className="muted"> · {L(`${n(polyOrdered.length - o.rules.max_stops)}টা বাদ (স্টপের সীমা)`, `${polyOrdered.length - o.rules.max_stops} dropped (stop limit)`)}</span>}</div>}
          </article>}
          {pl.loading && <p className="muted small">{L('এলাকার নাম আসছে…', 'Loading place names…')}</p>}
          {poly === null && !pl.loading && !sug.groups.length && <p className="muted">{L('এই এলাকায় রুটে নেওয়ার মতো নতুন জায়গা নেই।', 'No new places to put on a route here.')}</p>}
          {poly === null && sug.groups.map((g, i) => { const km = lineKm(hub as LatLng, g)
            return <article key={i} className={`rt-card${pick === i ? ' on' : ''}`}>
              <header><span className="rt-sw" style={{ background: color(i) }} /><b role="button" tabIndex={0} onClick={() => setPick(pick === i ? null : i)}
                onKeyDown={e => { if (e.key === 'Enter') setPick(pick === i ? null : i) }}>{L(`সাজেশন ${n(i + 1)}`, `Suggestion ${i + 1}`)}: {groupName(g)}</b></header>
              <div className="rt-meta"><span>{L(`${n(g.length)}টা স্টপ`, `${g.length} stops`)}</span><span>≈ {fmtKm(km * 1.3, fmt)}</span>
                <span>≈ {n(Math.round(estimate(km * 1.3, g.length, o.rules) / 6) / 10)} {L('ঘণ্টা', 'h')}</span></div>
              <div className="small">{g.map(p => placeName(p, lang)).join(' → ')}</div>
              {canEdit && <div className="rt-bar"><button className="sm" onClick={() => onBuild({ hub_id: hubId, name: groupName(g), color: color(i), stops: g.map(p => placeToStop(p, lang)) })}>
                <Icon name="plus" size={14} />{L('এই রুট বানান', 'Build this route')}</button></div>}
            </article> })}
        </div>
      </div>}
    </section>

    <section className="panel">
      <div className="da-bar"><h2>{L('এলাকার নাম (গ্রাম, পাড়া, বাজার, ইউনিয়ন)', 'Place names')}</h2>
        {canPlaces && <span className="row-acts">
          <button className="secondary" onClick={() => setOsm({ upazila_code: chosen[0] ?? pl.upazilas[0]?.code })} title={L('OpenStreetMap থেকে বাজার, গ্রাম, পাড়া একসাথে আনুন', 'Pull bazaars, villages and paras from OpenStreetMap')}>
            <Icon name="map" size={15} />{L('OSM থেকে লোড', 'Load from OSM')}</button>
          <button onClick={() => setEdit({ upazila_code: chosen[0] ?? pl.upazilas[0]?.code, kind: 'village', name_bn: '', lat: null, lng: null })}><Icon name="plus" size={15} />{L('নতুন জায়গা', 'New place')}</button>
        </span>}
      </div>
      <p className="rt-hint">{L('গ্রামের বাংলা নাম যন্ত্রে বানানো, অনেক বানান ভুল থাকতে পারে — "বানান ঠিক" চাপে ঠিক করুন। ভুল বা একই জায়গা দুবার থাকলে লুকিয়ে দিন। তালিকায় না থাকা পাড়া/মহল্লা "নতুন জায়গা" দিয়ে যোগ করুন।',
        'Bangla village names were machine-made: fix spellings, hide wrong ones, add missing paras.')}</p>
      <DataTable<Place> title={L('এলাকার নাম', 'Place names')} file="route-places" prefKey="route-places" rows={pl.places.filter(p => chosen.includes(p.upazila_code))} rowKey={p => p.id}
        empty={<p className="muted">{pl.loading ? L('লোড হচ্ছে…', 'Loading…') : L('উপরে উপজেলা বাছুন', 'Pick an upazila above')}</p>}
        cols={[
          { key: 'bn', label: L('নাম', 'Name'), value: p => p.name_bn ?? '', render: p => <>{p.name_bn ?? '—'}{!p.bn_checked && p.source === 'geonames' && <> <Badge tone="warn">{L('বানান দেখুন', 'check')}</Badge></>}{p.hidden && <> <Badge>{L('লুকানো', 'hidden')}</Badge></>}</> },
          { key: 'en', label: L('ইংরেজিতে', 'English'), value: p => p.name ?? '' },
          { key: 'kind', label: L('ধরন', 'Kind'), value: p => L(PLACE_KIND[p.kind].bn, PLACE_KIND[p.kind].en) },
          { key: 'upz', label: L('উপজেলা', 'Upazila'), value: p => upzName(p.upazila_code) },
          { key: 'route', label: L('রুটে আছে', 'On a route'), value: p => hasGps(p) && nearAny(p as LatLng, taken) ? L('হ্যাঁ', 'yes') : '' },
          { key: 'loc', label: L('লোকেশন', 'Location'), value: p => hasGps(p) ? `${p.lat}, ${p.lng}` : '' },
          ...(canPlaces ? [{ key: 'act', label: '', noExport: true, value: () => '', render: (p: Place) => <span className="row-acts">
            <button className="secondary sm" onClick={e => { e.stopPropagation(); setEdit(p) }}><Icon name="edit" size={13} />{L('বানান ঠিক', 'Fix')}</button>
            <button className="secondary sm" onClick={async e => { e.stopPropagation()
              const why = p.hidden ? '' : (await askReason(L(`"${placeName(p)}" কেন লুকাবেন?`, 'Why hide it?'))) ?? ''
              if (!p.hidden && !why.trim()) return
              try { await placesApi.hide(p.id, !p.hidden, why); await pl.setData(await placesApi.load(true)) } catch (er) { void tell(routeFriendly(er)) } }}>
              {p.hidden ? L('দেখান', 'Show') : L('লুকান', 'Hide')}</button></span> }] : []),
        ]} />
      <p className="muted small">{PLACE_SOURCES}</p>
    </section>
    {edit && <PlaceForm place={edit} upazilas={pl.upazilas} places={pl.places} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); pl.setData(await placesApi.load(true)) }} />}
    {osm && <OsmFetchModal upazilas={pl.upazilas} initial={osm.upazila_code} onClose={() => setOsm(null)} onDone={async () => { setOsm(null); pl.setData(await placesApi.load(true)) }} />}
  </>
}

// ---------------------------------------------------------------- one-click OSM pull: preview, then write
export function OsmFetchModal({ upazilas, initial, onClose, onDone }:
  { upazilas: Upazila[]; initial: number; onClose: () => void; onDone: () => void }) {
  const { L, n, lang } = usePrefs()
  const [code, setCode] = useState<number>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [prev, setPrev] = useState<Awaited<ReturnType<typeof placesApi.osmFetch>> | null>(null)
  const [done, setDone] = useState<{ inserted: number; updated: number } | null>(null)
  const u = upazilas.find(x => x.code === code)

  async function run(preview: boolean) {
    setBusy(true); setErr('')
    try {
      const r = await placesApi.osmFetch({ upazila_code: code, preview })
      if (preview) setPrev(r)
      else { setDone({ inserted: r.inserted ?? 0, updated: r.updated ?? 0 }); setPrev(null) }
    } catch (e) { setErr(routeFriendly(e)) } finally { setBusy(false) }
  }

  const byKind = (prev?.preview ?? []).reduce<Record<string, number>>((a, r) => { a[r.kind] = (a[r.kind] ?? 0) + 1; return a }, {})

  return <Modal wide title={L('OpenStreetMap থেকে জায়গা আনুন', 'Pull places from OpenStreetMap')} onClose={onClose}
    actions={<>
      <button className="secondary" onClick={onClose}>{done ? L('বন্ধ', 'Close') : L('বাতিল', 'Cancel')}</button>
      {!done && !prev && <button disabled={busy} onClick={() => void run(true)}>{busy ? L('আসছে…', 'Loading…') : L('প্রিভিউ', 'Preview')}</button>}
      {!done && prev && <button disabled={busy} onClick={() => void run(false)}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L(`${n(prev.found ?? 0)}টা সেভ করুন`, `Save ${prev.found ?? 0}`)}</button>}
    </>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr' }}>
      <Field label={L('উপজেলা', 'Upazila')} hint={L('উপজেলার বিদ্যমান জায়গাগুলোর চারপাশ ধরে OSM এ খোঁজা হবে।', 'Searches OSM around existing places of this upazila.')}>
        <select value={code} onChange={e => { setCode(Number(e.target.value)); setPrev(null); setDone(null) }}>
          {upazilas.map(x => <option key={x.code} value={x.code}>{lang === 'en' ? x.name : x.name_bn}</option>)}
        </select>
      </Field>
    </div>
    <p className="rt-hint">{L('OpenStreetMap থেকে বাজার (amenity=marketplace), গ্রাম, হ্যামলেট, পাড়া নামে চিহ্নিত জায়গা আনবে। নতুনগুলো যোগ হবে, আগেরগুলোর নাম/লোকেশন হালনাগাদ হবে। লুকানো বা ম্যানুয়ালি দেওয়া জায়গায় হাত পড়বে না।',
      'Pulls bazaars, villages, hamlets and paras from OSM. Adds new ones; updates name/location of ones already loaded via OSM. Does not touch manually-added or hidden places.')}</p>
    {prev && <div className="da-stats">
      <Stat icon="map" label={L('মোট পাওয়া', 'Total found')} value={n(prev.found ?? 0)} sub={u ? (lang === 'en' ? u.name : u.name_bn) : ''} />
      {Object.entries(byKind).map(([k, c]) => <Stat key={k} icon="check" label={L(PLACE_KIND[k as PlaceKind]?.bn ?? k, PLACE_KIND[k as PlaceKind]?.en ?? k)} value={n(c)} />)}
    </div>}
    {prev?.preview?.length ? <div className="rt-stops" style={{ maxHeight: '35vh' }}>
      {prev.preview.slice(0, 100).map(r => <div key={r.source_ref} className="rt-stop" style={{ gridTemplateColumns: '1fr auto' }}>
        <div style={{ minWidth: 0 }}><b className="small">{r.name_bn || r.name}</b>
          <div className="rt-meta"><span>{L(PLACE_KIND[r.kind]?.bn ?? r.kind, PLACE_KIND[r.kind]?.en ?? r.kind)}</span><span className="muted">{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</span></div></div>
        <span className="muted small">OSM</span>
      </div>)}
      {(prev.found ?? 0) > 100 && <p className="muted small">{L(`আরও ${n((prev.found ?? 0) - 100)}টা সেভের পর দেখা যাবে`, `${(prev.found ?? 0) - 100} more will appear after save`)}</p>}
    </div> : null}
    {done && <p className="da-ok">{L(`✓ ${n(done.inserted)}টা নতুন যোগ, ${n(done.updated)}টা হালনাগাদ`, `✓ ${done.inserted} added, ${done.updated} updated`)}
      <button className="sm" style={{ marginLeft: 10 }} onClick={() => { onDone() }}>{L('তালিকায় ফিরুন', 'Back to list')}</button></p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

/** Add or fix one place of the library. The location is picked with the shared LocationPicker (tap the map, search, paste a link, phone GPS). */
export function PlaceForm({ place, upazilas, places, onClose, onSaved }: { place: Partial<Place>; upazilas: Upazila[]; places: Place[]; onClose: () => void; onSaved: () => void }) {
  const { L, lang } = usePrefs()
  const [f, setF] = useState({ ...place })
  const [pt, setPt] = useState<LatLng | null>(hasGps({ lat: place.lat ?? null, lng: place.lng ?? null }) ? { lat: place.lat!, lng: place.lng! } : null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const u = upazilas.find(x => x.code === f.upazila_code)
  const env = useMemo<SourceEnv>(() => ({ hub: null, hubs: [], places: places.filter(p => p.id !== place.id), routes: [], lang }), [places, place.id, lang])
  async function save() {
    if (!(f.name_bn ?? '').trim()) return setErr(L('বাংলা নাম দিন', 'Give the Bangla name'))
    setBusy(true); setErr('')
    try { await placesApi.save({ id: f.id, upazila_code: f.upazila_code!, name_bn: f.name_bn!.trim(), name: f.name ?? null, kind: f.kind ?? 'village', lat: pt?.lat ?? null, lng: pt?.lng ?? null, note: f.note ?? null, bn_checked: true }); onSaved() }
    catch (e) { setErr(routeFriendly(e)) } finally { setBusy(false) }
  }
  // a place already in the library right here: the person may be adding it twice
  const twin = pt ? places.find(p => p.id !== place.id && !p.hidden && hasGps(p) && meters(pt, p as LatLng) < 80) : undefined
  return <Modal wide title={f.id ? L('জায়গার নাম ঠিক করুন', 'Fix the place') : L('নতুন জায়গা', 'New place')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('বাংলা নাম', 'Bangla name')} required><input value={f.name_bn ?? ''} onChange={e => setF({ ...f, name_bn: e.target.value })} /></Field>
      <Field label={L('ইংরেজি নাম', 'English name')}><input value={f.name ?? ''} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={L('ধরন', 'Kind')}><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as PlaceKind })}>
        {(Object.keys(PLACE_KIND) as PlaceKind[]).map(k => <option key={k} value={k}>{L(PLACE_KIND[k].bn, PLACE_KIND[k].en)}</option>)}</select></Field>
      <Field label={L('উপজেলা', 'Upazila')}><select value={f.upazila_code} onChange={e => setF({ ...f, upazila_code: Number(e.target.value) })}>
        {upazilas.map(x => <option key={x.code} value={x.code}>{lang === 'en' ? x.name : x.name_bn}</option>)}</select></Field>
    </div>
    <LocationPicker env={env} value={pt} height={280} lines={boundaryLine(u)} fitKey={f.upazila_code}
      onChange={(p, hint) => { setPt(p); if (hint && !(f.name_bn ?? '').trim()) setF(x => ({ ...x, name_bn: hint })) }} />
    {twin && <p className="lc-note warn"><Icon name="alert" size={14} />{L(`কাছেই (${Math.round(meters(pt!, twin as LatLng))} মি.) তালিকায় "${placeName(twin, lang)}" আছে — একই জায়গা দুবার নয় তো?`, `"${placeName(twin, lang)}" is already in the library ${Math.round(meters(pt!, twin as LatLng))} m away.`)}</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
