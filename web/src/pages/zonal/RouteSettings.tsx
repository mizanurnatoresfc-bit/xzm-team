import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { OsmMap, gmapLink, type MapCircle, type MapLine, type MapPin } from '../../components/OsmMap'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { PlacePicker, PlacesTab, placeToStop } from './RoutePlaces'
import { usePrefs } from '../../lib/prefs'
import {
  bestOrder, estimate, fmtDist, fmtKm, fmtMin, hasGps, lineKm, meters, myLocation, parseLocation, roadLine, routeApi, routeColor, routeFriendly,
  ROUTE_COLORS, routeLine, searchPlace, SHIFT, STOP_KIND, type DayRoute, type Place, type RouteHub, type RouteRules, type RouteStop, type Shift, type StopKind, type ZoneOverview, type ZoneRoute,
} from '../../lib/routes'

type Tab = 'map' | 'places' | 'routes' | 'day' | 'warn' | 'rules'
type NewDraft = { hub_id: string; name?: string; color?: string; stops?: RouteStop[] }
const dhaka = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

/** জোনাল ম্যানেজার প্যানেল → রুট সেটিং: every hub's rider routes on a real map, with stops, riders, rules and today's check-ins. */
export function RouteSettings() {
  const { L, n } = usePrefs()
  const fmt = { L, n }
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const zones = useLoad(() => routeApi.zones(), [])
  const [zone, setZone] = useState(sp.get('zone') ?? '')
  useEffect(() => { if (!zone && zones.data?.length) setZone(zones.data[0].id) }, [zones.data, zone])
  const ov = useLoad(() => zone ? routeApi.overview(zone) : Promise.resolve(null), [zone])
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || 'map')
  const [hub, setHub] = useState(sp.get('hub') ?? '')
  const [sel, setSel] = useState<string | null>(sp.get('route'))
  const [edit, setEdit] = useState<ZoneRoute | NewDraft | null>(null)
  const [riders, setRiders] = useState<ZoneRoute | null>(null)
  const [err, setErr] = useState('')
  const o = ov.data

  useEffect(() => { const q = new URLSearchParams(); if (zone) q.set('zone', zone); if (tab !== 'map') q.set('tab', tab); if (hub) q.set('hub', hub); if (sel) q.set('route', sel); setSp(q, { replace: true }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zone, tab, hub, sel])

  const hubOf = useMemo(() => Object.fromEntries((o?.hubs ?? []).map(h => [h.id, h])) as Record<string, RouteHub>, [o])
  const routes = useMemo(() => (o?.routes ?? []).filter(r => !hub || r.hub_id === hub), [o, hub])
  const canEdit = (hubId: string) => !!o?.can.edit_hubs.includes(hubId)
  const canArchive = (hubId: string) => !!o?.can.archive_hubs.includes(hubId)
  const warns = useMemo(() => o ? problems(o, L, n) : [], [o, L, n])

  async function archive(r: ZoneRoute) {
    const why = window.prompt(L(`"${r.name}" রুট সরানোর কারণ`, `Why remove "${r.name}"?`)) ?? ''
    if (!why.trim()) return
    try { await routeApi.archive(r.id, why.trim()); toast(L('রুট সরানো হয়েছে', 'Route removed')); if (sel === r.id) setSel(null); await ov.reload() } catch (e) { setErr(routeFriendly(e)) }
  }

  const stats = useMemo(() => {
    if (!o) return null
    const rs = o.routes.filter(r => !hub || r.hub_id === hub)
    const staff = o.hubs.filter(h => !hub || h.id === hub).flatMap(h => h.staff)
    const stops = rs.reduce((t, r) => t + r.stops.length, 0), gps = rs.reduce((t, r) => t + r.stops.filter(hasGps).length, 0)
    return { routes: rs.length, stops, gps, km: rs.reduce((t, r) => t + (r.road_km ?? r.distance_km ?? 0), 0),
      withRoute: staff.filter(s => s.routes > 0).length, noRoute: staff.filter(s => s.rider && s.routes === 0), noRider: rs.filter(r => !r.riders.length).length,
      today: rs.reduce((t, r) => t + (o.visits_today[r.id] ?? 0), 0) }
  }, [o, hub])

  return <AppShell title={L('রুট সেটিং', 'Route settings')}
    subtitle={L('জোনের সব হাবের রাইডার রুট আসল ম্যাপে: স্টপের লোকেশন, রাস্তা ধরে দূরত্ব, রাইডার, জোনের নিয়ম আর আজকের চেক-ইন।',
      "Every hub's rider routes on a real map: stop locations, road distance, riders, zone rules and today's check-ins.")}
    actions={o && (canEdit(hub) || (!hub && o.can.edit_hubs.length > 0)) ? <button onClick={() => { setErr(''); setEdit({ hub_id: hub || o.can.edit_hubs[0] }) }}><Icon name="plus" size={16} />{L('নতুন রুট', 'New route')}</button> : undefined}>
    {node}
    <section className="da-filters panel no-print">
      {(zones.data?.length ?? 0) > 1 && <Field label={L('জোন', 'Zone')}><select value={zone} onChange={e => { setZone(e.target.value); setHub(''); setSel(null) }}>
        {zones.data?.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
      {o && <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => { setHub(e.target.value); setSel(null) }}>
        <option value="">{L('সব হাব', 'All hubs')}</option>{o.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
      <div className="da-seg">{([['map', 'ম্যাপ', 'Map', 'map'], ['places', 'এলাকা ও সাজেশন', 'Areas & suggestions', 'hub'], ['routes', 'রুট তালিকা', 'Routes', 'table'], ...(o?.can.visits ? [['day', 'চেক-ইন', 'Check-ins', 'check']] : []),
        ['warn', `সতর্কতা${warns.length ? ` (${n(warns.length)})` : ''}`, `Warnings${warns.length ? ` (${warns.length})` : ''}`, 'alert'], ['rules', 'জোনের নিয়ম', 'Zone rules', 'gear']] as Array<[Tab, string, string, string]>).map(([k, b, e, ic]) =>
        <button key={k} className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}><Icon name={ic} size={14} />{L(b, e)}</button>)}</div>
      {ov.loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}
    </section>
    {zones.data && !zones.data.length && <section className="panel"><p className="muted">{L('রুট সেটিং দেখার অনুমতি কোনো জোনে নেই।', 'You may not see route settings in any zone.')}</p></section>}
    {(ov.error || zones.error) ? <p className="da-error">{routeFriendly(ov.error ?? zones.error)}</p> : null}
    {err && <p className="da-error">{err}</p>}

    {o && stats && <div className="da-stats">
      <Stat icon="map" label={L('রুট', 'Routes')} value={n(stats.routes)} sub={stats.noRider ? L(`${n(stats.noRider)}টায় রাইডার নেই`, `${stats.noRider} without rider`) : undefined} tone={stats.noRider ? 'warn' : undefined} />
      <Stat icon="hub" label={L('স্টপ (লোকেশনসহ)', 'Stops (with location)')} value={`${n(stats.gps)}/${n(stats.stops)}`} tone={stats.gps < stats.stops ? 'warn' : 'ok'} />
      <Stat icon="truck" label={L('রুট পাওয়া স্টাফ', 'Staff with a route')} value={n(stats.withRoute)} />
      <Stat icon="alert" label={L('রুট ছাড়া রাইডার', 'Riders without a route')} value={n(stats.noRoute.length)} tone={stats.noRoute.length ? 'warn' : undefined}
        sub={stats.noRoute.slice(0, 3).map(s => s.name).join(', ')} />
      <Stat icon="chart" label={L('মোট রুট দূরত্ব', 'Total route length')} value={fmtKm(stats.km, fmt)} />
      {o.can.visits && <Stat icon="check" label={L('আজকের চেক-ইন', "Today's check-ins")} value={n(stats.today)} />}
    </div>}

    {o && tab === 'map' && <ZoneMap o={o} routes={routes} hubOf={hubOf} hub={hub} sel={sel} onSel={setSel}
      onEdit={r => { setErr(''); setEdit(r) }} onRiders={setRiders} onArchive={archive} canEdit={canEdit} canArchive={canArchive} />}
    {o && tab === 'places' && <PlacesTab o={o} hubOf={hubOf} initialHub={hub} onBuild={d => { setErr(''); setEdit(d) }} />}
    {o && tab === 'routes' && <RouteTable routes={routes} hubOf={hubOf} rules={o.rules} onOpen={r => { setSel(r.id); setTab('map') }} />}
    {o && tab === 'day' && o.can.visits && <DayView zone={zone} o={o} hub={hub} />}
    {o && tab === 'warn' && <section className="panel"><h2>{L('যা ঠিক করা দরকার', 'What needs fixing')}</h2>
      {warns.length ? <ul className="rt-warn">{warns.map((w, i) => <li key={i} className={w.tone}>{w.text}
        {w.route && <> · <button className="secondary sm" onClick={() => { setSel(w.route!); setTab('map') }}>{L('ম্যাপে দেখুন', 'Show on map')}</button></>}</li>)}</ul>
        : <p className="muted">{L('সব ঠিক আছে — কোনো সতর্কতা নেই।', 'All good — nothing to fix.')}</p>}</section>}
    {o && tab === 'rules' && <RulesForm zone={zone} rules={o.rules} canEdit={o.can.configure} onSaved={() => { toast(L('জোনের নিয়ম সেভ হয়েছে', 'Zone rules saved')); void ov.reload() }} />}

    {o && edit && <RouteEditor o={o} start={edit} hubOf={hubOf}
      onClose={() => setEdit(null)} onSaved={id => { setEdit(null); setSel(id); setTab('map'); toast(L('রুট সেভ হয়েছে', 'Route saved')); void ov.reload() }} />}
    {o && riders && <RiderPicker o={o} route={riders} onClose={() => setRiders(null)}
      onSaved={() => { setRiders(null); toast(L('রাইডার সেভ হয়েছে', 'Riders saved')); void ov.reload() }} />}
  </AppShell>
}

// ---------------------------------------------------------------- warnings
function problems(o: ZoneOverview, L: (b: string, e: string) => string, n: (v: number | string) => string) {
  const out: Array<{ tone: 'bad' | 'warn'; text: string; route?: string }> = []
  for (const h of o.hubs) {
    if (!hasGps(h)) out.push({ tone: 'warn', text: L(`${h.name}: হাবের GPS নেই — রুটের দূরত্ব হাব থেকে মাপা যাচ্ছে না (হাব তালিকা ও ম্যাপ থেকে বসান)`, `${h.name}: the hub has no GPS`) })
    const none = h.staff.filter(s => s.rider && s.routes === 0)
    if (none.length) out.push({ tone: 'warn', text: L(`${h.name}: ${n(none.length)} জন রাইডার রুট পাননি — ${none.slice(0, 5).map(s => s.name).join(', ')}`, `${h.name}: ${none.length} riders without a route`) })
  }
  const allStops: Array<{ r: ZoneRoute; lat: number; lng: number; name: string }> = []
  for (const r of o.routes) {
    const hn = o.hubs.find(h => h.id === r.hub_id)?.name ?? ''
    if (!r.riders.length) out.push({ tone: 'bad', text: L(`${hn} · ${r.name}: কোনো রাইডার দেওয়া হয়নি`, `${hn} · ${r.name}: no rider`), route: r.id })
    const noGps = r.stops.filter(s => !hasGps(s))
    if (noGps.length) out.push({ tone: 'warn', text: L(`${hn} · ${r.name}: ${n(noGps.length)}টা স্টপের লোকেশন নেই — ${noGps.slice(0, 4).map(s => s.name).join(', ')}`, `${hn} · ${r.name}: ${noGps.length} stops without location`), route: r.id })
    if (r.stops.length > o.rules.max_stops) out.push({ tone: 'bad', text: L(`${hn} · ${r.name}: স্টপ জোনের সীমার বেশি (${n(r.stops.length)}/${n(o.rules.max_stops)})`, `${r.name}: more stops than the zone allows`), route: r.id })
    if (r.riders.length > o.rules.max_riders) out.push({ tone: 'bad', text: L(`${hn} · ${r.name}: রাইডার জোনের সীমার বেশি`, `${r.name}: more riders than the zone allows`), route: r.id })
    const km = r.road_km ?? (r.distance_km !== null ? r.distance_km * 1.3 : null)
    if (km !== null) { const min = estimate(km, r.stops.length, o.rules, r.road_minutes); if (min > 9 * 60) out.push({ tone: 'warn', text: L(`${hn} · ${r.name}: আনুমানিক সময় ${n(Math.round(min / 60))} ঘণ্টার বেশি — রুট ভাগ করার কথা ভাবুন`, `${r.name}: estimated over ${Math.round(min / 60)} hours`), route: r.id }) }
    const seen = new Set<string>()
    for (const s of r.stops) { const k = s.name.trim().toLowerCase(); if (seen.has(k)) out.push({ tone: 'warn', text: L(`${hn} · ${r.name}: "${s.name}" দুবার আছে`, `${r.name}: "${s.name}" twice`), route: r.id }); seen.add(k) }
    for (const s of r.stops) if (hasGps(s)) allStops.push({ r, lat: s.lat, lng: s.lng, name: s.name })
  }
  // stops of two different routes of the same hub within 80 m of each other
  const pairs = new Set<string>()
  for (let i = 0; i < allStops.length; i++) for (let j = i + 1; j < allStops.length; j++) {
    const a = allStops[i], b = allStops[j]
    if (a.r.id === b.r.id || a.r.hub_id !== b.r.hub_id) continue
    const key = [a.r.id, b.r.id].sort().join('|')
    if (pairs.has(key) || meters(a, b) > 80) continue
    pairs.add(key)
    out.push({ tone: 'warn', text: L(`দুই রুটের স্টপ এক জায়গায়: ${a.r.name} (${a.name}) আর ${b.r.name} (${b.name}) — এলাকা দুজনকে দেওয়া হয়েছে কি?`, `Two routes share a place: ${a.r.name} / ${b.r.name}`), route: a.r.id })
  }
  return out.sort((x, y) => (x.tone === y.tone ? 0 : x.tone === 'bad' ? -1 : 1))
}

// ---------------------------------------------------------------- zone map
function ZoneMap({ o, routes, hubOf, hub, sel, onSel, onEdit, onRiders, onArchive, canEdit, canArchive }: {
  o: ZoneOverview; routes: ZoneRoute[]; hubOf: Record<string, RouteHub>; hub: string; sel: string | null; onSel: (id: string | null) => void
  onEdit: (r: ZoneRoute) => void; onRiders: (r: ZoneRoute) => void; onArchive: (r: ZoneRoute) => void; canEdit: (h: string) => boolean; canArchive: (h: string) => boolean
}) {
  const { L, n } = usePrefs()
  const fmt = { L, n }
  const [pin, setPin] = useState<string | null>(null)
  const color = (r: ZoneRoute) => routeColor(r, o.routes.indexOf(r))
  const shown = sel ? routes.filter(r => r.id === sel) : routes
  const hubs = o.hubs.filter(h => hasGps(h) && (!hub || h.id === hub))
  const pins: MapPin[] = [
    ...hubs.map(h => ({ id: `h:${h.id}`, lat: h.lat!, lng: h.lng!, label: h.name, num: 'H', square: true })),
    ...shown.flatMap(r => r.stops.filter(hasGps).map(s => ({ id: `s:${s.id}`, lat: s.lat!, lng: s.lng!, label: `${r.name} · ${s.seq}. ${s.name}`, num: n(s.seq ?? 0), color: color(r) }))),
  ]
  const lines: MapLine[] = shown.map(r => { const l = routeLine(r, hubOf[r.hub_id]); return { id: r.id, color: color(r), points: l.points, dashed: !l.road, width: sel ? 5 : 4 } })
  const cur = sel ? routes.find(r => r.id === sel) : null
  const circles: MapCircle[] = cur ? cur.stops.filter(hasGps).map(s => ({ id: s.id!, lat: s.lat!, lng: s.lng!, m: s.radius_m ?? o.rules.stop_radius_m, color: color(cur) })) : []
  const pinned = pin?.startsWith('s:') ? routes.flatMap(r => r.stops.map(s => ({ r, s }))).find(x => `s:${x.s.id}` === pin) : null
  return <div className="rt-layout">
    <section className="panel" style={{ minWidth: 0 }}>
      <div className="da-bar"><h2>{cur ? cur.name : L('জোনের রুট ম্যাপ', 'Zone route map')}</h2>
        {cur && <button className="secondary sm" onClick={() => onSel(null)}><Icon name="back" size={14} />{L('সব রুট', 'All routes')}</button>}</div>
      <OsmMap pins={pins} lines={lines} circles={circles} height={520} tags={sel ? 'all' : 'selected'} selected={pin} onSelect={id => {
        setPin(id); if (id.startsWith('s:')) { const r = routes.find(x => x.stops.some(s => `s:${s.id}` === id)); if (r && !sel) onSel(r.id) } }} />
      <p className="rt-hint">{L('ঘন লাইন = রাস্তা ধরে আঁকা, ভাঙা লাইন = সোজা দূরত্ব। H = হাব। নম্বর = স্টপের ক্রম। রুটে চাপ দিলে শুধু সেটা দেখায়, বৃত্ত = পৌঁছানোর সীমা।',
        'Solid line = along the road, dashed = straight. H = hub. Numbers = stop order. Circles = reach radius.')}</p>
      {pinned && <p className="small"><b>{pinned.s.seq}. {pinned.s.name}</b> · {STOP_KIND[pinned.s.kind]?.bn ?? ''} · {pinned.r.name}
        {hasGps(pinned.s) && <> · <a href={gmapLink(pinned.s.lat!, pinned.s.lng!)} target="_blank" rel="noreferrer">Google Maps</a></>}</p>}
    </section>
    <div className="rt-side">
      {!routes.length && <section className="panel"><p className="muted">{L('এখনো কোনো রুট নেই। "নতুন রুট" চেপে ম্যাপে স্টপ বসিয়ে রুট বানান।', 'No routes yet. Press "New route" and put stops on the map.')}</p></section>}
      <div className="rt-list">{routes.map(r => {
        const km = r.road_km ?? r.distance_km
        const est = km !== null ? estimate(r.road_km ?? (r.distance_km ?? 0) * 1.3, r.stops.length, o.rules, r.road_minutes) : null
        return <article key={r.id} className={`rt-card${sel === r.id ? ' on' : ''}`}>
          <header><span className="rt-sw" style={{ background: color(r) }} /><b role="button" tabIndex={0} onClick={() => onSel(sel === r.id ? null : r.id)}
            onKeyDown={e => { if (e.key === 'Enter') onSel(sel === r.id ? null : r.id) }}>{r.code} · {r.name}</b>
            {o.visits_today[r.id] ? <Badge tone="ok">{L(`আজ ${n(o.visits_today[r.id])} চেক-ইন`, `${o.visits_today[r.id]} today`)}</Badge> : null}</header>
          <div className="rt-meta"><span>{hubOf[r.hub_id]?.name}</span><span>{L(SHIFT[r.shift].bn, SHIFT[r.shift].en)}</span>
            <span>{L(`${n(r.stops.length)} স্টপ`, `${r.stops.length} stops`)}{r.stops_gps < r.stops.length ? L(` (${n(r.stops.length - r.stops_gps)}টার লোকেশন নেই)`, ` (${r.stops.length - r.stops_gps} no location)`) : ''}</span>
            <span>{fmtKm(km, fmt)}{r.road_km !== null ? L(' রাস্তায়', ' by road') : km !== null ? L(' সোজা', ' straight') : ''}</span>
            {est !== null && <span>≈ {fmtMin(est, fmt)}</span>}</div>
          <div className="rt-meta"><Icon name="truck" size={13} />{r.riders.length ? r.riders.map(x => x.name).join(', ') : <span style={{ color: 'var(--cds-chart-status-warning, #ea580c)' }}>{L('রাইডার দেওয়া হয়নি', 'No rider')}</span>}</div>
          {(canEdit(r.hub_id) || canArchive(r.hub_id)) && <div className="rt-bar">
            {canEdit(r.hub_id) && <><button className="secondary sm" onClick={() => onEdit(r)}><Icon name="edit" size={14} />{L('এডিট / ম্যাপ', 'Edit / map')}</button>
              <button className="secondary sm" onClick={() => onRiders(r)}><Icon name="users" size={14} />{L('রাইডার', 'Riders')}</button></>}
            {canArchive(r.hub_id) && <button className="secondary sm" onClick={() => onArchive(r)}><Icon name="trash" size={14} /></button>}</div>}
        </article>
      })}</div>
    </div>
  </div>
}

// ---------------------------------------------------------------- table (Excel / print)
function RouteTable({ routes, hubOf, rules, onOpen }: { routes: ZoneRoute[]; hubOf: Record<string, RouteHub>; rules: RouteRules; onOpen: (r: ZoneRoute) => void }) {
  const { L } = usePrefs()
  return <DataTable<ZoneRoute> title={L('রাইডার রুট', 'Rider routes')} file="rider-routes" rows={routes} rowKey={r => r.id} onRowClick={onOpen} prefKey="zone-routes"
    empty={<p className="muted">{L('কোনো রুট নেই', 'No routes')}</p>}
    cols={[
      { key: 'hub', label: L('হাব', 'Hub'), value: r => hubOf[r.hub_id]?.name ?? '' },
      { key: 'code', label: L('কোড', 'Code'), value: r => r.code },
      { key: 'name', label: L('রুট', 'Route'), value: r => r.name },
      { key: 'shift', label: L('শিফট', 'Shift'), value: r => L(SHIFT[r.shift].bn, SHIFT[r.shift].en) },
      { key: 'stops', label: L('স্টপ', 'Stops'), value: r => r.stops.length },
      { key: 'gps', label: L('লোকেশনসহ', 'With location'), value: r => r.stops_gps },
      { key: 'km', label: L('দূরত্ব (কিমি)', 'Length (km)'), value: r => r.road_km ?? r.distance_km ?? '' },
      { key: 'kind', label: L('মাপ', 'Measured'), value: r => r.road_km !== null ? L('রাস্তায়', 'road') : r.distance_km !== null ? L('সোজা', 'straight') : '' },
      { key: 'min', label: L('আনুমানিক মিনিট', 'Est. minutes'), value: r => (r.road_km ?? r.distance_km) === null ? '' : estimate(r.road_km ?? (r.distance_km ?? 0) * 1.3, r.stops.length, rules, r.road_minutes) },
      { key: 'riders', label: L('রাইডার', 'Riders'), value: r => r.riders.map(x => `${x.code ? x.code + ' ' : ''}${x.name}`).join(', ') },
      { key: 'areas', label: L('স্টপের ক্রম', 'Stops in order'), value: r => r.stops.map(s => s.name).join(' → ') },
      { key: 'note', label: L('নোট', 'Note'), value: r => r.note ?? '' },
    ]} />
}

// ---------------------------------------------------------------- the zone rules
function RulesForm({ zone, rules, canEdit, onSaved }: { zone: string; rules: RouteRules; canEdit: boolean; onSaved: () => void }) {
  const { L, n } = usePrefs()
  const [f, setF] = useState(rules)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => setF(rules), [rules])
  const num = (k: keyof RouteRules, label: string, min: number, max: number, hint?: string) =>
    <Field label={label} hint={hint}><input type="number" min={min} max={max} disabled={!canEdit} value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: Number(e.target.value) })} /></Field>
  async function save() {
    setBusy(true); setErr('')
    try { await routeApi.saveRules(zone, { max_stops: f.max_stops, max_riders: f.max_riders, max_routes_per_rider: f.max_routes_per_rider, stop_radius_m: f.stop_radius_m,
      speed_kmh: f.speed_kmh, stop_minutes: f.stop_minutes, start_time: f.start_time, gps_required: f.gps_required, checkin_open: f.checkin_open }); onSaved() }
    catch (e) { setErr(routeFriendly(e)) } finally { setBusy(false) }
  }
  return <section className="panel">
    <div className="da-bar"><h2>{L('জোনের রুটের নিয়ম', 'Zone route rules')}</h2>{!canEdit && <Badge tone="info">{L('শুধু দেখা যাবে', 'View only')}</Badge>}</div>
    <p className="rt-hint">{L('এই নিয়ম জোনের সব হাবে চলে। রুট সেভ, রাইডার দেওয়া আর চেক-ইনের সময় ডাটাবেস এগুলো যাচাই করে।', 'These rules apply to every hub of the zone; the database checks them on every save.')}</p>
    <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
      {num('max_stops', L('এক রুটে সর্বোচ্চ স্টপ', 'Most stops per route'), 2, 200)}
      {num('max_riders', L('এক রুটে সর্বোচ্চ রাইডার', 'Most riders per route'), 1, 20)}
      {num('max_routes_per_rider', L('একজন রাইডার সর্বোচ্চ কয়টা রুটে', 'Most routes per rider'), 1, 10)}
      {num('stop_radius_m', L('স্টপে পৌঁছানোর সীমা (মিটার)', 'Reach radius (m)'), 20, 2000, L('এর মধ্যে থাকলে চেক-ইন "কাছে" ধরা হয়', 'Within this a check-in counts as near'))}
      {num('speed_kmh', L('গড় গতি (কিমি/ঘণ্টা)', 'Average speed (km/h)'), 5, 80, L('আনুমানিক সময় বের করতে', 'For time estimates'))}
      {num('stop_minutes', L('প্রতি স্টপে গড় মিনিট', 'Minutes per stop'), 0, 60)}
      <Field label={L('রুট শুরুর সময়', 'Route start time')}><input type="time" disabled={!canEdit} value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} /></Field>
      <Field label={L('প্রতিটি স্টপে লোকেশন বাধ্যতামূলক', 'Location required for every stop')}><label className="small"><input type="checkbox" disabled={!canEdit} style={{ width: 'auto', marginRight: 6 }}
        checked={f.gps_required} onChange={e => setF({ ...f, gps_required: e.target.checked })} />{f.gps_required ? L('হ্যাঁ', 'Yes') : L('না', 'No')}</label></Field>
      <Field label={L('রাইডারের স্টপ চেক-ইন চালু', 'Rider stop check-in on')}><label className="small"><input type="checkbox" disabled={!canEdit} style={{ width: 'auto', marginRight: 6 }}
        checked={f.checkin_open} onChange={e => setF({ ...f, checkin_open: e.target.checked })} />{f.checkin_open ? L('চালু', 'On') : L('বন্ধ', 'Off')}</label></Field>
    </div>
    <p className="rt-hint">{L(`চেক-ইন করতে রাইডারের "রুটে চেক-ইন" অনুমতি লাগে — সুপার অ্যাডমিন রোল ও অনুমতি থেকে দেবেন।${rules.updated_at ? ` শেষ বদল: ${n(new Date(rules.updated_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }))}` : ''}`,
      'Riders also need the "route check-in" permission, given by the Super Admin.')}</p>
    {err && <p className="da-error">{err}</p>}
    {canEdit && <div className="rt-bar"><button disabled={busy} onClick={() => void save()}><Icon name="save" size={15} />{L('নিয়ম সেভ', 'Save rules')}</button></div>}
  </section>
}

// ---------------------------------------------------------------- riders of a route
function RiderPicker({ o, route, onClose, onSaved }: { o: ZoneOverview; route: ZoneRoute; onClose: () => void; onSaved: () => void }) {
  const { L, n } = usePrefs()
  const staff = o.hubs.find(h => h.id === route.hub_id)?.staff ?? []
  const [ids, setIds] = useState(route.riders.map(r => r.employee_id))
  const [all, setAll] = useState(false); const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const was = new Set(route.riders.map(r => r.employee_id))
  const list = staff.filter(s => (all || s.rider || ids.includes(s.id)) && (!q || `${s.code ?? ''} ${s.name}`.toLowerCase().includes(q.toLowerCase())))
  async function save() {
    setBusy(true); setErr('')
    try { await routeApi.setRiders(route.id, ids); onSaved() } catch (e) { setErr(routeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={`${L('রাইডার দিন', 'Set riders')} — ${route.name}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
    <p className="rt-hint">{L(`জোনের নিয়ম: এক রুটে সর্বোচ্চ ${n(o.rules.max_riders)} জন, একজন সর্বোচ্চ ${n(o.rules.max_routes_per_rider)}টা রুটে। বেছে নেওয়া: ${n(ids.length)} জন।`,
      `Zone rule: at most ${o.rules.max_riders} per route, ${o.rules.max_routes_per_rider} routes per rider. Picked: ${ids.length}.`)}</p>
    <div className="rt-bar"><input placeholder={L('নাম বা আইডি খুঁজুন', 'Search name or ID')} value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1 }} />
      <label className="small"><input type="checkbox" style={{ width: 'auto', margin: '0 6px 0 0' }} checked={all} onChange={e => setAll(e.target.checked)} />{L('অন্য স্টাফও', 'Other staff too')}</label></div>
    <div className="pick-list">{list.map(s => { const on = ids.includes(s.id); const other = s.routes - (was.has(s.id) ? 1 : 0)
      return <div key={s.id} className={`pick-row${on ? ' on' : ''}`}><label><input type="checkbox" checked={on}
        onChange={() => setIds(on ? ids.filter(x => x !== s.id) : [...ids, s.id])} /> {s.code ? `${s.code} · ` : ''}{s.name}
        {other > 0 && <span className="muted small"> · {L(`আরও ${n(other)}টা রুটে`, `on ${other} other route(s)`)}</span>}
        {on && !was.has(s.id) && other >= o.rules.max_routes_per_rider && <span className="small" style={{ color: '#dc2626' }}> · {L('সীমা পূর্ণ', 'limit reached')}</span>}</label></div> })}
      {!list.length && <p className="muted small">{L('এই হাবে রাইডার পদের সক্রিয় কর্মী নেই — "অন্য স্টাফও" টিক দিন।', 'No active riders at this hub — tick "Other staff too".')}</p>}</div>
    {ids.length > o.rules.max_riders && <p className="da-error">{L('জোনের সীমার বেশি রাইডার বাছাই করা হয়েছে', 'More riders than the zone allows')}</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ---------------------------------------------------------------- one day's check-ins
function DayView({ zone, o, hub }: { zone: string; o: ZoneOverview; hub: string }) {
  const { L, n } = usePrefs()
  const fmt = { L, n }
  const [date, setDate] = useState(dhaka())
  const d = useLoad(() => routeApi.day(zone, date), [zone, date])
  const [sel, setSel] = useState<string | null>(null)
  const rows = (d.data?.routes ?? []).filter(r => !hub || r.hub_id === hub)
  const cur = rows.find(r => r.route_id === sel) ?? null
  const full = cur ? o.routes.find(r => r.id === cur.route_id) : null
  const time = (iso: string | null) => iso ? n(new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' })) : '—'
  const visitedStops = new Set(cur?.visits.map(v => v.stop_id) ?? [])
  const pins: MapPin[] = cur && full ? [
    ...full.stops.filter(hasGps).map(s => ({ id: `s:${s.id}`, lat: s.lat!, lng: s.lng!, label: `${s.seq}. ${s.name}`, num: n(s.seq ?? 0), tone: visitedStops.has(s.id!) ? undefined : 'off' as const })),
    ...cur.visits.map((v, i) => ({ id: `v:${i}`, lat: Number(v.lat), lng: Number(v.lng), label: `${time(v.at)} · ${v.stop} · ${fmtDist(v.distance_m, fmt)}`, tone: v.near ? 'ok' as const : 'wait' as const })),
  ] : []
  return <section className="panel">
    <div className="da-bar"><h2>{L('রুটে চেক-ইন', 'Route check-ins')}</h2>
      <Field label={L('তারিখ', 'Date')}><input type="date" value={date} max={dhaka()} onChange={e => setDate(e.target.value)} /></Field></div>
    {d.error ? <p className="da-error">{routeFriendly(d.error)}</p> : null}
    {d.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : !rows.length ? <p className="muted">{L('কোনো রুট নেই', 'No routes')}</p> :
      <div className="rt-layout">
        <div className="rt-list">{rows.map((r: DayRoute) => <article key={r.route_id} className={`rt-card${sel === r.route_id ? ' on' : ''}`} role="button" tabIndex={0}
          onClick={() => setSel(sel === r.route_id ? null : r.route_id)} onKeyDown={e => { if (e.key === 'Enter') setSel(sel === r.route_id ? null : r.route_id) }}>
          <header><span className="rt-sw" style={{ background: r.color || '#15803D' }} /><b>{r.hub_name} · {r.code} · {r.name}</b></header>
          {!r.riders.length ? <span className="muted small">{L('এই দিনে কোনো রাইডার ছিল না', 'No rider that day')}</span> : r.riders.map(x =>
            <div key={x.employee_id} className="small"><div className="rt-meta"><b style={{ color: 'var(--text)' }}>{x.name}</b>
              <span>{L(`${n(x.visited)}/${n(r.stops_gps)} স্টপ`, `${x.visited}/${r.stops_gps} stops`)}</span>
              {x.far > 0 && <span style={{ color: '#ea580c' }}>{L(`${n(x.far)}টা দূর থেকে`, `${x.far} from far`)}</span>}
              {x.first_at && <span>{time(x.first_at)} – {time(x.last_at)}</span>}</div>
              <div className="rt-prog"><span style={{ width: `${r.stops_gps ? Math.min(100, (x.visited / r.stops_gps) * 100) : 0}%` }} /></div></div>)}
        </article>)}</div>
        <div>{cur ? <>
          <OsmMap pins={pins} height={420} tags="selected" lines={full ? [{ id: 'l', color: full.color || '#15803D', points: routeLine(full, o.hubs.find(h => h.id === full.hub_id)).points, dashed: true, width: 3, opacity: .5 }] : []} />
          <div className="rt-list" style={{ marginTop: 8 }}>{cur.visits.length ? cur.visits.map((v, i) => <div key={i} className="small">
            <Badge tone={v.near ? 'ok' : 'warn'}>{v.near ? L('কাছে', 'near') : L('দূরে', 'far')}</Badge> {time(v.at)} · {v.seq}. {v.stop} · {fmtDist(v.distance_m, fmt)}
            {' · '}{cur.riders.find(x => x.employee_id === v.employee_id)?.name}{v.note ? ` · ${v.note}` : ''}</div>)
            : <p className="muted small">{L('এই দিনে কেউ চেক-ইন করেনি', 'No check-ins that day')}</p>}</div></>
          : <p className="muted">{L('বাঁ দিকের একটা রুটে চাপ দিলে ম্যাপে চেক-ইন দেখাবে।', 'Pick a route to see its check-ins on the map.')}</p>}</div>
      </div>}
  </section>
}

// ---------------------------------------------------------------- route editor (map + stops)
type Draft = { id?: string; hub_id: string; code: string; name: string; note: string; color: string; shift: Shift; stops: RouteStop[] }
const blank = (name: string): RouteStop => ({ name, kind: 'area', lat: null, lng: null, radius_m: null, minutes: null, note: null })
const sig = (hub: { lat: number | null; lng: number | null } | undefined, stops: RouteStop[]) =>
  [hub && hasGps(hub) ? `${hub.lat},${hub.lng}` : '', ...stops.filter(hasGps).map(s => `${s.lat},${s.lng}`)].join('|')

export function RouteEditor({ o, start, hubOf, onClose, onSaved }: {
  o: ZoneOverview; start: ZoneRoute | NewDraft; hubOf: Record<string, RouteHub>; onClose: () => void; onSaved: (id: string) => void
}) {
  const { L, n, lang } = usePrefs()
  const fmt = { L, n }
  const old = 'id' in start ? start : null
  const [f, setF] = useState<Draft>(() => old
    ? { id: old.id, hub_id: old.hub_id, code: old.code, name: old.name, note: old.note ?? '', color: old.color ?? routeColor(old, o.routes.indexOf(old)), shift: old.shift, stops: old.stops.map(s => ({ ...s })) }
    : { hub_id: start.hub_id, code: '', name: (start as NewDraft).name ?? '', note: '', color: (start as NewDraft).color ?? ROUTE_COLORS[o.routes.filter(r => r.hub_id === start.hub_id).length % ROUTE_COLORS.length],
        shift: 'day', stops: ((start as NewDraft).stops ?? []).map(x => ({ ...x })) })
  const hub = hubOf[f.hub_id]
  const [sel, setSel] = useState<number | null>(null)
  const [mode, setMode] = useState<'add' | 'move'>('add')
  const [open, setOpen] = useState<number | null>(null)
  const [road, setRoad] = useState<{ km: number; minutes: number; path: Array<[number, number]>; sig: string } | null>(null)
  const [q, setQ] = useState(''); const [found, setFound] = useState<Array<{ lat: number; lng: number; name: string }>>([])
  const [bulk, setBulk] = useState<string | null>(null)
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null)
  const [side, setSide] = useState<'stops' | 'places'>('stops')
  const [extra, setExtra] = useState<{ pins: MapPin[]; lines: MapLine[]; add: (id: string) => void }>({ pins: [], lines: [], add: () => {} })
  const addPlace = (p: Place) => { setF(d => ({ ...d, stops: [...d.stops, placeToStop(p, lang)] })); if (hasGps(p)) setFocus(null) }

  const now = sig(hub, f.stops)
  const roadFresh = road && road.sig === now ? road : null
  const savedRoadOk = old && old.road_path && sig(hub, old.stops) === now ? { km: old.road_km ?? 0, minutes: old.road_minutes ?? 0, path: old.road_path } : null
  const shownRoad = roadFresh ?? savedRoadOk
  const straight = lineKm(hub && hasGps(hub) ? hub : null, f.stops)
  const est = estimate(shownRoad?.km ?? straight * 1.3, f.stops.length, o.rules, shownRoad?.minutes)
  const gpsCount = f.stops.filter(hasGps).length

  const setStop = (i: number, p: Partial<RouteStop>) => setF(d => ({ ...d, stops: d.stops.map((s, j) => j === i ? { ...s, ...p } : s) }))
  const move = (i: number, by: number) => setF(d => { const s = [...d.stops]; const j = i + by; if (j < 0 || j >= s.length) return d; [s[i], s[j]] = [s[j], s[i]]; return { ...d, stops: s } })
  const remove = (i: number) => { setF(d => ({ ...d, stops: d.stops.filter((_, j) => j !== i) })); setSel(null); setOpen(null) }
  function addAt(lat: number | null, lng: number | null, name?: string) {
    setF(d => ({ ...d, stops: [...d.stops, { ...blank(name ?? L(`স্টপ ${n(d.stops.length + 1)}`, `Stop ${d.stops.length + 1}`)), lat, lng }] }))
    setSel(f.stops.length)
  }
  function pick(lat: number, lng: number) {
    if (mode === 'move' && sel !== null) { setStop(sel, { lat, lng }); setMode('add'); return }
    addAt(lat, lng)
  }
  async function here(i: number | null) {
    setBusy('gps'); setErr('')
    try { const p = await myLocation(); if (i === null) addAt(p.lat, p.lng); else setStop(i, { lat: p.lat, lng: p.lng }); setFocus({ lat: p.lat, lng: p.lng }) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  async function find() {
    if (q.trim().length < 2) return
    const ll = parseLocation(q)
    if (ll) { setFound([{ ...ll, name: L('লিংক / নম্বর থেকে পাওয়া লোকেশন', 'Location from the link / numbers') }]); return }
    setBusy('find'); setErr('')
    try { const r = await searchPlace(q.trim() + (hub ? '' : '')); setFound(r); if (!r.length) setErr(L('কিছু পাওয়া যায়নি — অন্য নামে বা Google Maps লিংক দিয়ে চেষ্টা করুন', 'Nothing found')) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  function applyFound(x: { lat: number; lng: number; name: string }, asNew: boolean) {
    const short = x.name.split(',')[0].trim()
    if (!asNew && sel !== null) setStop(sel, { lat: x.lat, lng: x.lng }); else addAt(x.lat, x.lng, short)
    setFocus({ lat: x.lat, lng: x.lng }); setFound([]); setQ('')
  }
  async function draw() {
    const pts = [...(hub && hasGps(hub) ? [{ lat: hub.lat, lng: hub.lng }] : []), ...f.stops.filter(hasGps).map(s => ({ lat: s.lat!, lng: s.lng! }))]
    setBusy('road'); setErr('')
    try { const r = await roadLine(pts); setRoad({ ...r, sig: now }) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  function optimize() {
    const s = bestOrder(hub && hasGps(hub) ? { lat: hub.lat, lng: hub.lng } : null, f.stops)
    setF(d => ({ ...d, stops: s })); setSel(null)
  }
  function addBulk() {
    const add: RouteStop[] = []
    for (const line of (bulk ?? '').split('\n').map(x => x.trim()).filter(Boolean)) {
      const parts = line.split(/[,\t;]/)
      const name = parts[0].trim()
      const ll = parseLocation(parts.slice(1).join(',').trim()) ?? parseLocation(line.slice(name.length + 1))
      if (name) add.push({ ...blank(name), lat: ll?.lat ?? null, lng: ll?.lng ?? null })
    }
    setF(d => ({ ...d, stops: [...d.stops, ...add] })); setBulk(null)
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
    ...(hub && hasGps(hub) ? [{ id: 'hub', lat: hub.lat, lng: hub.lng, label: hub.name, num: 'H', square: true }] : []),
    ...f.stops.map((s, i) => hasGps(s) ? { id: `s${i}`, lat: s.lat, lng: s.lng, label: `${n(i + 1)}. ${s.name}`, num: n(i + 1), color: f.color } : null).filter(Boolean) as MapPin[],
    // other routes of the same hub, faded, so areas are not given twice
    ...o.routes.filter(r => r.hub_id === f.hub_id && r.id !== f.id).flatMap(r => r.stops.filter(hasGps).map(s => ({ id: `o:${s.id}`, lat: s.lat!, lng: s.lng!, label: `${r.name}: ${s.name}`, num: '•', tone: 'off' as const }))),
    ...(side === 'places' ? extra.pins : []),
  ]
  const straightPts: Array<[number, number]> = [...(hub && hasGps(hub) ? [[hub.lat, hub.lng] as [number, number]] : []), ...f.stops.filter(hasGps).map(s => [s.lat!, s.lng!] as [number, number])]
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
          <button type="button" className="secondary sm" disabled={busy === 'gps'} onClick={() => void here(null)}><Icon name="map" size={13} />{L('আমার লোকেশনে স্টপ', 'Stop at my location')}</button>
        </div>
        <OsmMap pins={pins} lines={lines} circles={circles} height={430} focus={focus} onPick={pick} tags="all" keepView
          selected={sel !== null ? `s${sel}` : null} onSelect={id => { if (id.startsWith('p:')) { extra.add(id); return } if (id.startsWith('s')) { const i = Number(id.slice(1)); setSel(i); setOpen(i) } }} />
        <div className="rt-search" style={{ marginTop: 8 }}>
          <div className="rt-bar"><input style={{ flex: 1, minWidth: 0 }} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void find() }}
            placeholder={L('জায়গার নাম, Google Maps লিংক বা "24.37, 88.60"', 'Place name, Google Maps link or "24.37, 88.60"')} />
            <button type="button" className="secondary" disabled={busy === 'find'} onClick={() => void find()}><Icon name="search" size={14} />{L('খুঁজুন', 'Find')}</button></div>
          {found.length > 0 && <div className="rt-results">{found.map((x, i) => <div key={i} className="rt-bar">
            <button type="button" className="secondary sm" style={{ flex: 1 }} onClick={() => { setFocus({ lat: x.lat, lng: x.lng }) }}>{x.name}</button>
            <button type="button" className="sm" onClick={() => applyFound(x, true)}>{L('নতুন স্টপ', 'New stop')}</button>
            {sel !== null && <button type="button" className="secondary sm" onClick={() => applyFound(x, false)}>{L(`${n(sel + 1)} নম্বরে বসান`, `Set #${sel + 1}`)}</button>}</div>)}</div>}
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
          others={o.routes.filter(r => r.hub_id === f.hub_id && r.id !== f.id).flatMap(r => r.stops.filter(hasGps).map(s => ({ route: r.name, lat: s.lat!, lng: s.lng! })))}
          onShow={(pins, lines, add) => setExtra({ pins, lines, add })} />}
        {side === 'stops' && <>
        <div className="rt-bar">
          <button type="button" className="secondary sm" disabled={gpsCount < 2} onClick={optimize} title={L('হাব থেকে সবচেয়ে কম দূরত্বের ক্রমে সাজায়', 'Shortest order from the hub')}><Icon name="swap" size={13} />{L('ছোট পথে সাজান', 'Shortest order')}</button>
          <button type="button" className="secondary sm" disabled={f.stops.length < 2} onClick={() => setF({ ...f, stops: [...f.stops].reverse() })}><Icon name="swap" size={13} />{L('উল্টো ক্রম', 'Reverse')}</button>
          <button type="button" className="secondary sm" disabled={busy === 'road' || gpsCount + (hub && hasGps(hub) ? 1 : 0) < 2} onClick={() => void draw()}><Icon name="truck" size={13} />{busy === 'road' ? L('আঁকা হচ্ছে…', 'Drawing…') : L('রাস্তা ধরে আঁকুন', 'Draw by road')}</button>
          <button type="button" className="secondary sm" onClick={() => setBulk('')}><Icon name="note" size={13} />{L('একসাথে অনেক', 'Many at once')}</button>
          <button type="button" className="secondary sm" onClick={() => addAt(null, null)}><Icon name="plus" size={13} />{L('লোকেশন ছাড়া স্টপ', 'Stop without location')}</button>
        </div>
        {bulk !== null && <div className="rt-card"><b className="small">{L('প্রতি লাইনে একটা স্টপ: নাম, তারপর চাইলে লোকেশন বা লিংক', 'One stop per line: name, then a location or link if you have it')}</b>
          <textarea rows={5} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'কাজলা, 24.3640, 88.6290\nবিনোদপুর, https://maps.google.com/?q=24.369,88.641\nতালাইমারী'} />
          <div className="rt-bar"><button type="button" className="sm" onClick={addBulk}>{L('যোগ করুন', 'Add')}</button><button type="button" className="secondary sm" onClick={() => setBulk(null)}>{L('বাতিল', 'Cancel')}</button></div></div>}
        {!f.stops.length && <p className="rt-hint">{L('ম্যাপে চাপ দিয়ে স্টপ বসান, জায়গা খুঁজুন, অথবা "একসাথে অনেক" দিয়ে তালিকা দিন। ক্রম = রাইডার যে ক্রমে যাবেন।', 'Tap the map, search a place or paste a list. The order is the order the rider goes.')}</p>}
        <div className="rt-stops">{f.stops.map((s, i) => <div key={i} className={`rt-stop${sel === i ? ' on' : ''}`} onClick={() => setSel(i)}>
          <span className={`no${hasGps(s) ? '' : ' off'}`} style={hasGps(s) ? { background: f.color } : undefined}>{n(i + 1)}</span>
          <input value={s.name} onChange={e => setStop(i, { name: e.target.value })} aria-label={L('স্টপের নাম', 'Stop name')} />
          <span className="acts">
            <button type="button" className="secondary" disabled={i === 0} onClick={e => { e.stopPropagation(); move(i, -1) }} aria-label="↑">↑</button>
            <button type="button" className="secondary" disabled={i === f.stops.length - 1} onClick={e => { e.stopPropagation(); move(i, 1) }} aria-label="↓">↓</button>
            <button type="button" className="secondary" onClick={e => { e.stopPropagation(); setOpen(open === i ? null : i) }} aria-label={L('আরও', 'More')}><Icon name="gear" size={13} /></button>
            <button type="button" className="secondary" onClick={e => { e.stopPropagation(); remove(i) }} aria-label={L('সরান', 'Remove')}><Icon name="x" size={13} /></button></span>
          {!hasGps(s) && open !== i && <span className="rt-hint" style={{ gridColumn: '2 / 4' }}>{L('লোকেশন নেই — বেছে নিয়ে "চাপ দিলে স্টপ সরবে" চেপে ম্যাপে চাপ দিন', 'No location — pick it, choose "Tap = move" and tap the map')}</span>}
          {open === i && <div className="more" onClick={e => e.stopPropagation()}>
            <Field label={L('ধরন', 'Kind')}><select value={s.kind} onChange={e => setStop(i, { kind: e.target.value as StopKind })}>
              {(Object.keys(STOP_KIND) as StopKind[]).map(k => <option key={k} value={k}>{L(STOP_KIND[k].bn, STOP_KIND[k].en)}</option>)}</select></Field>
            <Field label={L('লোকেশন (lat, lng বা লিংক)', 'Location (lat, lng or link)')}><input defaultValue={hasGps(s) ? `${s.lat}, ${s.lng}` : ''} key={`${s.lat},${s.lng}`}
              onBlur={e => { const v = e.target.value.trim(); if (!v) { setStop(i, { lat: null, lng: null }); return } const ll = parseLocation(v); if (ll) setStop(i, ll); else setErr(L('লোকেশন বোঝা যায়নি', 'Location not understood')) }} /></Field>
            <Field label={L('পৌঁছানোর সীমা (মি.)', 'Radius (m)')}><input type="number" min={20} max={2000} placeholder={n(o.rules.stop_radius_m)} value={s.radius_m ?? ''}
              onChange={e => setStop(i, { radius_m: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label={L('এখানে মিনিট', 'Minutes here')}><input type="number" min={0} max={240} placeholder={n(o.rules.stop_minutes)} value={s.minutes ?? ''}
              onChange={e => setStop(i, { minutes: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label={L('নোট', 'Note')}><input value={s.note ?? ''} onChange={e => setStop(i, { note: e.target.value || null })} /></Field>
            <div className="rt-bar"><button type="button" className="secondary sm" disabled={busy === 'gps'} onClick={() => void here(i)}><Icon name="map" size={13} />{L('আমার লোকেশন', 'My location')}</button>
              {hasGps(s) && <a className="btn-ghost small" href={gmapLink(s.lat, s.lng)} target="_blank" rel="noreferrer">Google Maps</a>}</div>
          </div>}
        </div>)}</div>
        </>}
        {f.stops.length > o.rules.max_stops && <p className="da-error">{L(`জোনের সীমা ${n(o.rules.max_stops)}টা স্টপ`, `Zone limit: ${o.rules.max_stops} stops`)}</p>}
      </div>
    </div>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
