// The route editor: name, colour, shift, and the stops on a real map. Locations are added through the shared engine (lib/routeLocation.ts):
// tap the map (the stop is named from the place library or OpenStreetMap), search or paste (LocationAdder), the phone's GPS, a list or a file (BulkPanel).
// Every added stop is checked against the others at once (same route, other routes of the hub, far from the hub) and can be undone.
import { useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { OsmMap, gmapLink, type MapCircle, type MapLine, type MapPin } from '../../components/OsmMap'
import { Field, Modal, Stat } from '../accounts/ui'
import { PlacePicker, placeToStop, usePlaces } from '../zonal/RoutePlaces'
import { useAuth } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { readSheet } from '../../lib/sheetRead'
import { assess, bulkToStops, nameFromLibrary, parseBulkRows, parseBulkText, resolveBulk, reverseName, type BulkLine, type Candidate, type Note, type SourceEnv } from '../../lib/routeLocation'
import {
  bestOrder, estimate, fmtKm, fmtMin, hasGps, lineKm, parseLocation, placesApi, roadLine, routeApi, routeColor, routeFriendly, ROUTE_COLORS, SHIFT, STOP_KIND, upazilaNear,
  type LatLng, type Place, type RouteHub, type RouteStop, type Shift, type StopKind, type ZoneOverview, type ZoneRoute,
} from '../../lib/routes'
import { RoutePdfDraft } from './RoutePdfDraft'
import { GpsButton, LocationAdder, NoteList } from './LocationUI'

export type NewDraft = { hub_id: string; name?: string; color?: string; stops?: RouteStop[] }
type Draft = { id?: string; hub_id: string; code: string; name: string; note: string; color: string; shift: Shift; stops: RouteStop[] }
const blank = (name: string): RouteStop => ({ name, kind: 'area', lat: null, lng: null, radius_m: null, minutes: null, note: null })
const sig = (hub: { lat: number | null; lng: number | null } | undefined, stops: RouteStop[]) =>
  [hub && hasGps(hub) ? `${hub.lat},${hub.lng}` : '', ...stops.filter(hasGps).map(s => `${s.lat},${s.lng}`)].join('|')
/** A stop still carrying the name the editor gave it ("স্টপ 3") — safe to rename when a better name arrives. */
const isDefaultName = (s: string) => /^(স্টপ|Stop)\s*[0-9০-৯]+$/.test(s.trim())

export function RouteEditor({ o, start, hubOf, onClose, onSaved }: {
  o: ZoneOverview; start: ZoneRoute | NewDraft; hubOf: Record<string, RouteHub>; onClose: () => void; onSaved: (id: string) => void
}) {
  const { L, n, lang } = usePrefs()
  const { can } = useAuth()
  const fmt = { L, n }
  const pl = usePlaces()
  const old = 'id' in start ? start : null
  const [f, setF] = useState<Draft>(() => old
    ? { id: old.id, hub_id: old.hub_id, code: old.code, name: old.name, note: old.note ?? '', color: old.color ?? routeColor(old, o.routes.indexOf(old)), shift: old.shift, stops: old.stops.map(s => ({ ...s })) }
    : { hub_id: start.hub_id, code: '', name: (start as NewDraft).name ?? '', note: '', color: (start as NewDraft).color ?? ROUTE_COLORS[o.routes.filter(r => r.hub_id === start.hub_id).length % ROUTE_COLORS.length],
        shift: 'day', stops: ((start as NewDraft).stops ?? []).map(x => ({ ...x })) })
  const hub = hubOf[f.hub_id]
  const hubPt = hub && hasGps(hub) ? { lat: hub.lat, lng: hub.lng } : null
  const [sel, setSel] = useState<number | null>(null)
  const [mode, setMode] = useState<'add' | 'move'>('add')
  const [open, setOpen] = useState<number | null>(null)
  const [road, setRoad] = useState<{ km: number; minutes: number; path: Array<[number, number]>; sig: string } | null>(null)
  const [bulk, setBulk] = useState(false)
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null)
  const [side, setSide] = useState<'stops' | 'places'>('stops')
  const [extra, setExtra] = useState<{ pins: MapPin[]; lines: MapLine[]; add: (id: string) => void }>({ pins: [], lines: [], add: () => {} })
  const [added, setAdded] = useState<{ at: number; name: string; lat: number | null; lng: number | null; notes: Note[] } | null>(null)
  const latest = useRef(f.stops); latest.current = f.stops

  const now = sig(hub, f.stops)
  const roadFresh = road && road.sig === now ? road : null
  const savedRoadOk = old && old.road_path && sig(hub, old.stops) === now ? { km: old.road_km ?? 0, minutes: old.road_minutes ?? 0, path: old.road_path } : null
  const shownRoad = roadFresh ?? savedRoadOk
  const straight = lineKm(hubPt, f.stops)
  const est = estimate(shownRoad?.km ?? straight * 1.3, f.stops.length, o.rules, shownRoad?.minutes)
  const gpsCount = f.stops.filter(hasGps).length
  const others = useMemo(() => o.routes.filter(r => r.hub_id === f.hub_id && r.id !== f.id).flatMap(r => r.stops.filter(hasGps).map(s => ({ route: r.name, name: s.name, lat: s.lat!, lng: s.lng! }))), [o.routes, f.hub_id, f.id])
  const env: SourceEnv = useMemo(() => ({ hub: hub ?? null, hubs: o.hubs, places: pl.places, routes: o.routes, lang, skipRoute: f.id ?? null }), [hub, o.hubs, pl.places, o.routes, lang, f.id])
  const canPlaces = can('ops.route_setting.edit')

  const setStop = (i: number, p: Partial<RouteStop>) => setF(d => ({ ...d, stops: d.stops.map((s, j) => j === i ? { ...s, ...p } : s) }))
  const move = (i: number, by: number) => setF(d => { const s = [...d.stops]; const j = i + by; if (j < 0 || j >= s.length) return d; [s[i], s[j]] = [s[j], s[i]]; return { ...d, stops: s } })
  const remove = (i: number) => { setF(d => ({ ...d, stops: d.stops.filter((_, j) => j !== i) })); setSel(null); setOpen(null); setAdded(null) }

  /** Adds one stop and tells the person what is worth a look about it. Returns its place in the list. */
  function addStop(p: { name?: string; lat: number | null; lng: number | null; kind?: StopKind; accuracy?: number | null }): number {
    const at = latest.current.length
    const name = p.name || L(`স্টপ ${n(at + 1)}`, `Stop ${at + 1}`)
    setF(d => ({ ...d, stops: [...d.stops, { ...blank(name), kind: p.kind ?? 'area', lat: p.lat, lng: p.lng }] }))
    setSel(at); setErr('')
    setAdded({ at, name, lat: p.lat, lng: p.lng, notes: assess(p, { hub: hubPt, stops: latest.current, others, accuracy: p.accuracy }) })
    return at
  }
  /** The stop at `at` is renamed only while it still has the editor's own default name (the person may have typed one meanwhile). */
  const nameLater = (at: number, lat: number, lng: number) => {
    const here = nameFromLibrary({ lat, lng }, pl.places, lang)
    if (here) { setF(d => ({ ...d, stops: d.stops.map((s, j) => j === at && isDefaultName(s.name) ? { ...s, name: here.name, kind: here.kind } : s) })); return }
    void reverseName({ lat, lng }).then(nm => { if (nm) setF(d => ({ ...d, stops: d.stops.map((s, j) => j === at && isDefaultName(s.name) ? { ...s, name: nm } : s) })) })
  }
  function pick(lat: number, lng: number) {
    if (mode === 'move' && sel !== null) {
      setStop(sel, { lat, lng }); setMode('add')
      setAdded({ at: sel, name: f.stops[sel]?.name ?? '', lat, lng, notes: assess({ lat, lng }, { hub: hubPt, stops: f.stops, others, skipIndex: sel }) })
      if (isDefaultName(f.stops[sel]?.name ?? '')) nameLater(sel, lat, lng)
      return
    }
    const at = addStop({ lat, lng })
    nameLater(at, lat, lng)
  }
  function fromCandidate(c: Candidate, asNew: boolean) {
    const ll = hasGps(c) ? { lat: c.lat, lng: c.lng } : null
    if (!asNew && sel !== null) {
      setStop(sel, ll ? { lat: ll.lat, lng: ll.lng } : {})
      setAdded({ at: sel, name: f.stops[sel]?.name ?? c.name, lat: ll?.lat ?? null, lng: ll?.lng ?? null, notes: assess(ll ?? { lat: null, lng: null }, { hub: hubPt, stops: f.stops, others, skipIndex: sel }) })
    } else addStop({ name: c.name, lat: c.lat, lng: c.lng, kind: c.kind })
    if (ll) setFocus(ll)
  }
  const addPlace = (p: Place) => {
    const s = placeToStop(p, lang)
    addStop({ name: s.name, lat: s.lat, lng: s.lng, kind: s.kind })
    if (hasGps(p)) setFocus(null)
  }
  function here(p: LatLng, accuracy: number, i: number | null) {
    if (i === null) addStop({ lat: p.lat, lng: p.lng, accuracy })
    else { setStop(i, { lat: p.lat, lng: p.lng }); setAdded({ at: i, name: f.stops[i]?.name ?? '', lat: p.lat, lng: p.lng, notes: assess(p, { hub: hubPt, stops: f.stops, others, skipIndex: i, accuracy }) }) }
    setFocus(p)
  }
  function undo() {
    if (!added) return
    const s = latest.current[added.at]
    if (s && s.lat === added.lat && s.lng === added.lng && s.name === added.name && added.at === latest.current.length - 1) remove(added.at)
    setAdded(null)
  }
  async function draw() {
    const pts = [...(hubPt ? [hubPt] : []), ...f.stops.filter(hasGps).map(s => ({ lat: s.lat!, lng: s.lng! }))]
    setBusy('road'); setErr('')
    try { const r = await roadLine(pts); setRoad({ ...r, sig: now }) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  function optimize() { setF(d => ({ ...d, stops: bestOrder(hubPt, d.stops) })); setSel(null) }
  async function toLibrary(i: number) {
    const s = f.stops[i]
    if (!hasGps(s) || !pl.data) return
    const upz = upazilaNear({ lat: s.lat, lng: s.lng }, pl.places) ?? pl.upazilas[0]?.code
    setBusy('lib'); setErr('')
    try { await placesApi.save({ upazila_code: upz!, name_bn: s.name.trim(), kind: s.kind === 'landmark' ? 'market' : 'para', lat: s.lat, lng: s.lng, bn_checked: true }); pl.setData(await placesApi.load(true))
      setAdded({ at: i, name: s.name, lat: s.lat, lng: s.lng, notes: [{ tone: 'info', code: 'no-location', bn: `"${s.name}" এলাকার তালিকায় সেভ হয়েছে — অন্য রুটেও পাওয়া যাবে`, en: `"${s.name}" saved to the place library — other routes can use it` }] }) }
    catch (e) { setErr(routeFriendly(e)) } finally { setBusy('') }
  }
  async function save() {
    if (f.name.trim().length < 2) return setErr(L('রুটের নাম দিন', 'Give the route a name'))
    if (!f.stops.length) return setErr(L('অন্তত একটা স্টপ দিন — ম্যাপে চাপ দিন বা খুঁজুন', 'Add at least one stop'))
    if (f.stops.length > o.rules.max_stops) return setErr(L(`এই জোনে এক রুটে সর্বোচ্চ ${n(o.rules.max_stops)}টা স্টপ`, `At most ${o.rules.max_stops} stops`))
    if (o.rules.gps_required && gpsCount < f.stops.length) return setErr(L('এই জোনে প্রতিটি স্টপের লোকেশন দিতে হয়', 'Every stop needs a location in this zone'))
    setBusy('save'); setErr('')
    try {
      const id = await routeApi.save({ id: f.id, hub_id: f.hub_id, code: f.code.trim() || undefined, name: f.name.trim(), note: f.note.trim() || null, color: f.color, shift: f.shift,
        stops: f.stops.map(s => ({ ...s, name: s.name.trim() })), road: roadFresh ? { km: roadFresh.km, minutes: roadFresh.minutes, path: roadFresh.path } : null })
      onSaved(id)
    } catch (e) { setErr(routeFriendly(e)) } finally { setBusy('') }
  }

  const pins: MapPin[] = [
    ...(hubPt ? [{ id: 'hub', ...hubPt, label: hub!.name, num: 'H', square: true }] : []),
    ...f.stops.map((s, i) => hasGps(s) ? { id: `s${i}`, lat: s.lat, lng: s.lng, label: `${n(i + 1)}. ${s.name}`, num: n(i + 1), color: f.color } : null).filter(Boolean) as MapPin[],
    // other routes of the same hub, faded, so areas are not given twice
    ...o.routes.filter(r => r.hub_id === f.hub_id && r.id !== f.id).flatMap(r => r.stops.filter(hasGps).map(s => ({ id: `o:${s.id}`, lat: s.lat!, lng: s.lng!, label: `${r.name}: ${s.name}`, num: '•', tone: 'off' as const }))),
    ...(side === 'places' ? extra.pins : []),
  ]
  const straightPts: Array<[number, number]> = [...(hubPt ? [[hubPt.lat, hubPt.lng] as [number, number]] : []), ...f.stops.filter(hasGps).map(s => [s.lat!, s.lng!] as [number, number])]
  const lines: MapLine[] = [...(side === 'places' ? extra.lines : []), ...(shownRoad ? [{ id: 'road', color: f.color, points: shownRoad.path }] : [{ id: 'line', color: f.color, points: straightPts, dashed: true }])]
  const circles: MapCircle[] = sel !== null && f.stops[sel] && hasGps(f.stops[sel]) ? [{ id: 'c', lat: f.stops[sel].lat!, lng: f.stops[sel].lng!, m: f.stops[sel].radius_m ?? o.rules.stop_radius_m, color: f.color }] : []
  const editableHubs = o.hubs.filter(h => o.can.edit_hubs.includes(h.id))

  return <Modal wide title={f.id ? `${L('রুট এডিট', 'Edit route')} — ${f.name}` : L('নতুন রাইডার রুট', 'New rider route')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={!!busy} onClick={() => void save()}><Icon name="save" size={15} />{busy === 'save' ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ', 'Save')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
      <Field label={L('হাব', 'Hub')}><select value={f.hub_id} disabled={!!f.id} onChange={e => setF({ ...f, hub_id: e.target.value })}>
        {(f.id ? o.hubs : editableHubs).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label={L('রুটের নাম', 'Route name')} required><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={L('যেমন শহর পূর্ব', 'e.g. Town east')} /></Field>
      <Field label={L('কোড', 'Code')} hint={L('খালি রাখলে নিজে বসবে (R01…)', 'Empty = automatic')}><input value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
      <Field label={L('শিফট', 'Shift')}><select value={f.shift} onChange={e => setF({ ...f, shift: e.target.value as Shift })}>
        {(Object.keys(SHIFT) as Shift[]).map(k => <option key={k} value={k}>{L(SHIFT[k].bn, SHIFT[k].en)}</option>)}</select></Field>
      <Field label={L('রঙ', 'Colour')}><div className="rt-bar">{ROUTE_COLORS.map(c => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })}
        style={{ width: 26, height: 26, minHeight: 0, padding: 0, borderRadius: 8, background: c, outline: f.color === c ? '3px solid var(--text)' : 'none', outlineOffset: 1 }} />)}</div></Field>
      <Field label={L('নোট', 'Note')}><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
    </div>
    {hub && !hasGps(hub) && <p className="da-error">{L('এই হাবের GPS বসানো নেই — দূরত্ব হাব থেকে মাপা যাবে না। হাব তালিকা ও ম্যাপ থেকে হাবের লোকেশন দিন।', 'This hub has no GPS yet.')}</p>}
    <div className="rt-layout">
      <div style={{ minWidth: 0 }}>
        <div className="rt-bar" style={{ marginBottom: 6 }}>
          <span className="da-seg"><button type="button" className={mode === 'add' ? 'sm' : 'secondary sm'} onClick={() => setMode('add')}><Icon name="plus" size={13} />{L('চাপ দিলে নতুন স্টপ', 'Tap = new stop')}</button>
            <button type="button" className={mode === 'move' ? 'sm' : 'secondary sm'} disabled={sel === null} onClick={() => setMode('move')}><Icon name="map" size={13} />{L('চাপ দিলে বাছাই করা স্টপ সরবে', 'Tap = move picked stop')}</button></span>
          <GpsButton onError={setErr} onGot={(p, a) => here(p, a, null)} label={L('আমার লোকেশনে স্টপ', 'Stop at my location')} />
        </div>
        <OsmMap pins={pins} lines={lines} circles={circles} height={430} focus={focus} onPick={pick} tags="all" keepView
          selected={sel !== null ? `s${sel}` : null} onSelect={id => { if (id.startsWith('p:')) { extra.add(id); return } if (id.startsWith('s')) { const i = Number(id.slice(1)); setSel(i); setOpen(i) } }} />
        {added && <div className="lc-undo" style={{ marginTop: 8 }}>
          <span><b>{added.name}</b>{hasGps({ lat: added.lat, lng: added.lng }) ? '' : ` — ${L('লোকেশন নেই', 'no location')}`}</span>
          {added.at === f.stops.length - 1 && <button type="button" className="secondary sm" onClick={undo}><Icon name="back" size={13} />{L('পূর্বাবস্থায়', 'Undo')}</button>}
          <button type="button" className="secondary sm" onClick={() => setAdded(null)}>{L('ঠিক আছে', 'OK')}</button></div>}
        {added && added.notes.length > 0 && <NoteList notes={added.notes} />}
        <div style={{ marginTop: 8 }}>
          <LocationAdder env={env} onFocus={p => p && setFocus({ ...p })} onMessage={setErr}
            actions={[{ key: 'new', label: L('নতুন স্টপ', 'New stop'), icon: 'plus', primary: true, run: c => fromCandidate(c, true) },
              ...(sel !== null ? [{ key: 'set', label: L(`${n(sel + 1)} নম্বরে বসান`, `Set #${sel + 1}`), run: (c: Candidate) => fromCandidate(c, false) }] : [])]} />
        </div>
        <div className="da-stats" style={{ marginTop: 8 }}>
          <Stat icon="hub" label={L('স্টপ', 'Stops')} value={`${n(gpsCount)}/${n(f.stops.length)}`} sub={L('লোকেশনসহ / মোট', 'with location / all')} tone={gpsCount < f.stops.length ? 'warn' : 'ok'} />
          <Stat icon="chart" label={L('সোজা দূরত্ব', 'Straight')} value={fmtKm(straight || null, fmt)} />
          <Stat icon="truck" label={L('রাস্তায় দূরত্ব', 'By road')} value={shownRoad ? fmtKm(shownRoad.km, fmt) : '—'} sub={shownRoad ? fmtMin(shownRoad.minutes, fmt) : roadFresh === null && road ? L('স্টপ বদলেছে — আবার আঁকুন', 'Stops changed — draw again') : undefined} />
          <Stat icon="clock" label={L('আনুমানিক পুরো রুট', 'Estimated route')} value={fmtMin(est, fmt)} sub={L(`শুরু ${n(o.rules.start_time)}`, `start ${o.rules.start_time}`)} />
        </div>
      </div>
      <div className="rt-side">
        <span className="da-seg"><button type="button" className={side === 'stops' ? 'sm' : 'secondary sm'} onClick={() => setSide('stops')}><Icon name="map" size={13} />{L(`স্টপ (${n(f.stops.length)})`, `Stops (${f.stops.length})`)}</button>
          <button type="button" className={side === 'places' ? 'sm' : 'secondary sm'} onClick={() => setSide('places')}><Icon name="hub" size={13} />{L('এলাকা থেকে বাছুন', 'Pick from areas')}</button></span>
        {side === 'places' && <PlacePicker hub={hub} stops={f.stops} onAdd={addPlace}
          others={others.map(x => ({ route: x.route, lat: x.lat, lng: x.lng }))}
          onShow={(pins, lines, add) => setExtra({ pins, lines, add })} />}
        {side === 'stops' && <>
        <div className="rt-bar">
          <button type="button" className="secondary sm" disabled={gpsCount < 2} onClick={optimize} title={L('হাব থেকে সবচেয়ে কম দূরত্বের ক্রমে সাজায়', 'Shortest order from the hub')}><Icon name="swap" size={13} />{L('ছোট পথে সাজান', 'Shortest order')}</button>
          <button type="button" className="secondary sm" disabled={f.stops.length < 2} onClick={() => setF({ ...f, stops: [...f.stops].reverse() })}><Icon name="swap" size={13} />{L('উল্টো ক্রম', 'Reverse')}</button>
          <button type="button" className="secondary sm" disabled={busy === 'road' || gpsCount + (hubPt ? 1 : 0) < 2} onClick={() => void draw()}><Icon name="truck" size={13} />{busy === 'road' ? L('আঁকা হচ্ছে…', 'Drawing…') : L('রাস্তা ধরে আঁকুন', 'Draw by road')}</button>
          <button type="button" className="secondary sm" onClick={() => setBulk(b => !b)}><Icon name="note" size={13} />{L('একসাথে অনেক', 'Many at once')}</button>
          <button type="button" className="secondary sm" onClick={() => addStop({ lat: null, lng: null })}><Icon name="plus" size={13} />{L('লোকেশন ছাড়া স্টপ', 'Stop without location')}</button>
        </div>
        <RoutePdfDraft key={f.hub_id} places={pl.places} stops={f.stops} maxStops={o.rules.max_stops}
          onAdd={stops => { setF(d => ({ ...d, stops: [...d.stops, ...stops] })); setAdded(null) }} />
        {bulk && <BulkPanel env={env} onAdd={stops => { setF(d => ({ ...d, stops: [...d.stops, ...stops] })); setBulk(false); setAdded(null) }} onClose={() => setBulk(false)} />}
        {!f.stops.length && <p className="rt-hint">{L('ম্যাপে চাপ দিয়ে স্টপ বসান, জায়গা খুঁজুন, অথবা "একসাথে অনেক" দিয়ে তালিকা বা ফাইল দিন। ক্রম = রাইডার যে ক্রমে যাবেন।', 'Tap the map, search a place, or paste a list / upload a file. The order is the order the rider goes.')}</p>}
        <div className="rt-stops">{f.stops.map((s, i) => <div key={i} className={`rt-stop${sel === i ? ' on' : ''}`} onClick={() => setSel(i)}>
          <span className={`no${hasGps(s) ? '' : ' off'}`} style={hasGps(s) ? { background: f.color } : undefined}>{n(i + 1)}</span>
          <input value={s.name} onChange={e => setStop(i, { name: e.target.value })} aria-label={L('স্টপের নাম', 'Stop name')} />
          <span className="acts">
            <button type="button" className="secondary" disabled={i === 0} onClick={e => { e.stopPropagation(); move(i, -1) }} aria-label="↑">↑</button>
            <button type="button" className="secondary" disabled={i === f.stops.length - 1} onClick={e => { e.stopPropagation(); move(i, 1) }} aria-label="↓">↓</button>
            <button type="button" className="secondary" onClick={e => { e.stopPropagation(); setOpen(open === i ? null : i) }} aria-label={L('আরও', 'More')}><Icon name="gear" size={13} /></button>
            <button type="button" className="secondary" onClick={e => { e.stopPropagation(); remove(i) }} aria-label={L('সরান', 'Remove')}><Icon name="x" size={13} /></button></span>
          {!hasGps(s) && open !== i && <span className="rt-hint" style={{ gridColumn: '2 / 4' }}>{L('লোকেশন নেই — বেছে নিয়ে "চাপ দিলে স্টপ সরবে" চেপে ম্যাপে চাপ দিন, বা খুঁজে "বসান" চাপুন', 'No location — pick it, choose "Tap = move" and tap the map, or search and press "Set"')}</span>}
          {open === i && <div className="more" onClick={e => e.stopPropagation()}>
            <Field label={L('ধরন', 'Kind')}><select value={s.kind} onChange={e => setStop(i, { kind: e.target.value as StopKind })}>
              {(Object.keys(STOP_KIND) as StopKind[]).map(k => <option key={k} value={k}>{L(STOP_KIND[k].bn, STOP_KIND[k].en)}</option>)}</select></Field>
            <Field label={L('লোকেশন (lat, lng বা লিংক)', 'Location (lat, lng or link)')}><input defaultValue={hasGps(s) ? `${s.lat}, ${s.lng}` : ''} key={`${s.lat},${s.lng}`}
              onBlur={e => { const v = e.target.value.trim(); if (!v) { setStop(i, { lat: null, lng: null }); return } const ll = parseLocation(v); if (ll) { setStop(i, ll); setFocus(ll) } else setErr(L('লোকেশন বোঝা যায়নি — Google Maps লিংক, "24.37, 88.60" বা Plus Code দিন', 'Location not understood')) }} /></Field>
            <Field label={L('পৌঁছানোর সীমা (মি.)', 'Radius (m)')}><input type="number" min={20} max={2000} placeholder={n(o.rules.stop_radius_m)} value={s.radius_m ?? ''}
              onChange={e => setStop(i, { radius_m: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label={L('এখানে মিনিট', 'Minutes here')}><input type="number" min={0} max={240} placeholder={n(o.rules.stop_minutes)} value={s.minutes ?? ''}
              onChange={e => setStop(i, { minutes: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label={L('নোট', 'Note')}><input value={s.note ?? ''} onChange={e => setStop(i, { note: e.target.value || null })} /></Field>
            <div className="rt-bar"><GpsButton onError={setErr} onGot={(p, a) => here(p, a, i)} />
              {hasGps(s) && <a className="btn-ghost small" href={gmapLink(s.lat, s.lng)} target="_blank" rel="noreferrer">Google Maps</a>}
              {hasGps(s) && canPlaces && !pl.places.some(p => hasGps(p) && !p.hidden && Math.hypot(p.lat - s.lat, p.lng - s.lng) < 0.001) &&
                <button type="button" className="secondary sm" disabled={busy === 'lib'} onClick={() => void toLibrary(i)} title={L('এই জায়গা এলাকার তালিকায় রাখুন — অন্য রুটেও পাওয়া যাবে', 'Keep this place in the library for other routes')}><Icon name="hub" size={13} />{L('এলাকার তালিকায় রাখুন', 'Save to library')}</button>}</div>
          </div>}
        </div>)}</div>
        </>}
        {f.stops.length > o.rules.max_stops && <p className="da-error">{L(`জোনের সীমা ${n(o.rules.max_stops)}টা স্টপ`, `Zone limit: ${o.rules.max_stops} stops`)}</p>}
      </div>
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ---------------------------------------------------------------- many at once: a list or a file, a location found for every name
/** Paste lines (name, then a location if you have it) or choose an Excel / CSV file. Names without a location are looked up (library first, then OpenStreetMap) and shown for checking before anything is added. */
export function BulkPanel({ env, onAdd, onClose }: { env: SourceEnv; onAdd: (stops: RouteStop[]) => void; onClose: () => void }) {
  const { L, n } = usePrefs()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<BulkLine[] | null>(null)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [online, setOnline] = useState(true)
  const [msg, setMsg] = useState('')
  const stop = useRef({ stop: false })
  const missing = rows?.filter(r => r.status === 'missing' || r.status === 'many').length ?? 0

  function read() { const r = parseBulkText(text); if (!r.length) { setMsg(L('কোনো লাইন নেই', 'No lines')); return } setMsg(''); setRows(r) }
  async function file(f: File | undefined) {
    if (!f) return
    try { const r = parseBulkRows(await readSheet(f)); if (!r.length) { setMsg(L('ফাইলে কোনো স্টপ পাওয়া যায়নি', 'No stops found in the file')); return } setMsg(''); setRows(r) }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  async function find() {
    if (!rows) return
    stop.current = { stop: false }; setProg({ done: 0, total: rows.filter(r => r.status === 'missing').length })
    const r = await resolveBulk(rows, env, { online, signal: stop.current, onStep: (done, total, lines) => { setProg({ done, total }); setRows(lines.map(x => ({ ...x }))) } })
    setRows(r); setProg(null)
  }
  const patch = (key: number, p: Partial<BulkLine>) => setRows(rs => rs && rs.map(r => r.key === key ? { ...r, ...p } : r))
  const tag = (r: BulkLine) => r.status === 'given' ? <span className="lc-tag ok">{L('লোকেশন দেওয়া', 'given')}</span>
    : r.status === 'found' ? <span className="lc-tag ok">{r.from === 'online' ? L('অনলাইনে পেয়েছি', 'found online') : L('তালিকায় পেয়েছি', 'found in library')}</span>
    : r.status === 'many' ? <span className="lc-tag warn">{L(`${n(r.options.length)}টা মিল — বাছুন`, `${r.options.length} matches — choose`)}</span>
    : <span className="lc-tag warn">{L('লোকেশন নেই', 'no location')}</span>
  return <div className="rt-card lc-bulk">
    <b className="small">{L('প্রতি লাইনে একটা স্টপ: নাম, তারপর চাইলে লোকেশন বা লিংক। Excel থেকে কপি করা (ট্যাব দিয়ে আলাদা) লাইনও চলে।', 'One stop per line: name, then a location or link if you have it. Lines copied from Excel work too.')}</b>
    {!rows && <>
      <textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={'কাজলা, 24.3640, 88.6290\nবিনোদপুর, https://maps.google.com/?q=24.369,88.641\nতালাইমারী'} />
      <div className="rt-bar"><button type="button" className="sm" onClick={read} disabled={!text.trim()}><Icon name="check" size={13} />{L('লাইনগুলো দেখুন', 'Read the lines')}</button>
        <label className="btn-ghost small" style={{ cursor: 'pointer' }}><Icon name="upload" size={13} /> {L('Excel / CSV ফাইল', 'Excel / CSV file')}
          <input type="file" accept=".xlsx,.csv" hidden onChange={e => { void file(e.target.files?.[0]); e.target.value = '' }} /></label>
        <button type="button" className="secondary sm" onClick={onClose}>{L('বাতিল', 'Cancel')}</button></div>
      <p className="rt-hint">{L('ফাইলের প্রথম সারিতে নাম / lat / lng / লোকেশন লেখা থাকলে ঘর নিজে চেনা যায়; না থাকলে প্রথম ঘর = নাম, বাকিটা = লোকেশন।', 'If the first row says name / lat / lng / location the columns are recognised; otherwise column 1 = name, the rest = location.')}</p></>}
    {rows && <>
      <div className="rt-bar"><span className="small">{L(`${n(rows.length)}টা লাইন`, `${rows.length} lines`)}{missing ? L(` · ${n(missing)}টার লোকেশন নেই`, ` · ${missing} without a location`) : ''}</span>
        {missing > 0 && !prog && <button type="button" className="sm" onClick={() => void find()}><Icon name="search" size={13} />{L('নাম থেকে লোকেশন খুঁজে দিন', 'Find locations from the names')}</button>}
        {missing > 0 && !prog && <label className="small"><input type="checkbox" style={{ width: 'auto', marginRight: 4 }} checked={online} onChange={e => setOnline(e.target.checked)} />{L('অনলাইনেও (ধীরে — প্রতি নামে ১ সেকেন্ড)', 'online too (slow — 1 s per name)')}</label>}
        {prog && <><span className="small">{L(`খোঁজা হচ্ছে ${n(prog.done)}/${n(prog.total)}…`, `Searching ${prog.done}/${prog.total}…`)}</span>
          <button type="button" className="secondary sm" onClick={() => { stop.current.stop = true }}>{L('থামান', 'Stop')}</button></>}</div>
      <div className="lc-bulk-rows">{rows.map(r => <div key={r.key} className={`lc-bulk-row${r.status === 'missing' || r.status === 'many' ? ' missing' : ''}`}>
        <input type="checkbox" checked={r.use} onChange={e => patch(r.key, { use: e.target.checked })} aria-label={L('এই স্টপ নিন', 'Include this stop')} />
        <div style={{ minWidth: 0 }}><input type="text" value={r.name} style={{ width: '100%' }} onChange={e => patch(r.key, { name: e.target.value })} aria-label={L('স্টপের নাম', 'Stop name')} />
          {r.status === 'many' && <select value="" onChange={e => { const c = r.options.find(o => o.id === e.target.value); if (c && hasGps(c)) patch(r.key, { lat: c.lat, lng: c.lng, kind: c.kind, status: 'found', from: c.source }) }}>
            <option value="">{L('সঠিকটা বাছুন…', 'Choose the right one…')}</option>
            {r.options.filter(hasGps).map(c => <option key={c.id} value={c.id}>{c.name}{c.sub ? ` — ${c.sub}` : ''}</option>)}</select>}
          {r.status !== 'many' && hasGps(r) && <span className="small muted">{r.lat}, {r.lng}</span>}</div>
        {tag(r)}</div>)}</div>
      <div className="rt-bar"><button type="button" className="sm" disabled={!rows.some(r => r.use) || !!prog} onClick={() => onAdd(bulkToStops(rows))}><Icon name="plus" size={13} />{L(`${n(rows.filter(r => r.use).length)}টা স্টপ যোগ করুন`, `Add ${rows.filter(r => r.use).length} stops`)}</button>
        <button type="button" className="secondary sm" onClick={() => setRows(null)}>{L('আবার দিন', 'Start again')}</button>
        <button type="button" className="secondary sm" onClick={onClose}>{L('বাতিল', 'Cancel')}</button></div>
      <p className="rt-hint">{L('লোকেশন ছাড়া স্টপও যোগ করা যায় — পরে ম্যাপে বসানো যাবে। অনলাইনের ফল মিলিয়ে নিন: একই নামের অন্য জায়গাও আসতে পারে।', 'Stops without a location can still be added and placed later. Check online results: another place may share the name.')}</p></>}
    {msg && <p className="da-error">{msg}</p>}
  </div>
}
