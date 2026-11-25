// The zone parts of the route module that show routes: the map with its route cards, the route table, the zone rules, the riders of a route and one day's
// check-ins. The page that holds them (tabs, zone and hub pickers, the editor) is pages/routes/RouteModule.tsx.
import { useEffect, useState } from 'react'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { OsmMap, gmapLink, type MapCircle, type MapLine, type MapPin } from '../../components/OsmMap'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import {
  estimate, fmtDist, fmtKm, fmtMin, hasGps, routeApi, routeColor, routeFriendly, routeLine, SHIFT, STOP_KIND,
  type DayRoute, type RouteHub, type RouteRules, type ZoneOverview, type ZoneRoute,
} from '../../lib/routes'

const dhaka = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

// ---------------------------------------------------------------- zone map
export function ZoneMap({ o, routes, hubOf, hub, sel, onSel, onEdit, onRiders, onArchive, canEdit, canArchive }: {
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
export function RouteTable({ routes, hubOf, rules, onOpen }: { routes: ZoneRoute[]; hubOf: Record<string, RouteHub>; rules: RouteRules; onOpen: (r: ZoneRoute) => void }) {
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
export function RulesForm({ zone, rules, canEdit, onSaved }: { zone: string; rules: RouteRules; canEdit: boolean; onSaved: () => void }) {
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
export function RiderPicker({ o, route, onClose, onSaved }: { o: ZoneOverview; route: ZoneRoute; onClose: () => void; onSaved: () => void }) {
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
export function DayView({ zone, o, hub }: { zone: string; o: ZoneOverview; hub: string }) {
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

