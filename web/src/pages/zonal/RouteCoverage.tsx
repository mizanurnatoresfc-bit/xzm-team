import { useMemo, useState } from 'react'
import { DataTable } from '../../components/DataTable'
import { OsmMap, gmapLink, type MapPin } from '../../components/OsmMap'
import { Field, Stat } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { direction, fmtDist, hasGps, meters, PLACE_KIND, PLACE_SOURCES, placeName, routeFriendly, upazilaNear, type LatLng, type Place, type PlaceKind, type ZoneOverview } from '../../lib/routes'
import { boundaryLine, usePlaces } from './RoutePlaces'

/** A place counts as covered when a stop of some route is within this many metres of it (the same rule as the suggestions tab). */
const NEAR_M = 250
type Row = { coveredHubs: string[]; p: Place; route: string | null; hub: string | null; hubName: string; hubM: number | null; dir: string }

/** রুট সেটিং → কাভারেজ: every village, para and market of the district — on a route or not — on the map and as a list. */
export function CoverageTab({ o, onPlan }: { o: ZoneOverview; onPlan: (hubId: string) => void }) {
  const { L, n, lang } = usePrefs()
  const fmt = { L, n }
  const pl = usePlaces()
  const [kinds, setKinds] = useState<PlaceKind[]>(['village', 'para', 'market', 'town'])
  const [coverageHub, setCoverageHub] = useState('')
  const [upz, setUpz] = useState<number | null>(null)
  const [show, setShow] = useState<'all' | 'out' | 'in'>('all')
  const [sel, setSel] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const stops = o.routes.flatMap(r => r.stops.filter(hasGps).map(s => ({ lat: s.lat!, lng: s.lng!, route: r.name, hubId: r.hub_id })))
    const hubs = o.hubs.filter(hasGps) as Array<ZoneOverview['hubs'][number] & LatLng>
    return pl.places.filter(p => !p.hidden && kinds.includes(p.kind)).map(p => {
      if (!hasGps(p)) return { coveredHubs: [], p, route: null, hub: null, hubName: '', hubM: null, dir: '' }
      const at = p as LatLng
      const hits = stops.filter(s => meters(s, at) <= NEAR_M)
      const hit = hits.find(s => !coverageHub || s.hubId === coverageHub)
      const coveredHubs = [...new Set(hits.map(s => s.hubId))]
      const near = hubs.map(h => ({ h, d: meters(h, at) })).sort((a, b) => a.d - b.d)[0]
      return { coveredHubs, p, route: hit?.route ?? null, hub: near?.h.id ?? null, hubName: near?.h.name ?? '', hubM: near ? Math.round(near.d) : null, dir: near ? direction(near.h, at) : '' }
    })
  }, [pl.places, o, kinds, coverageHub])

  const selectedHub = o.hubs.find(h => h.id === coverageHub)
  const homeUpazila = useMemo(() => selectedHub && hasGps(selectedHub)
    ? upazilaNear({ lat: selectedHub.lat!, lng: selectedHub.lng! }, pl.places) : null, [selectedHub, pl.places])
  const located = rows.filter(r => hasGps(r.p))
  const byUpz = pl.upazilas.map(u => { const all = located.filter(r => r.p.upazila_code === u.code); const cov = all.filter(r => r.route).length
    return { u, all: all.length, cov, noLoc: rows.filter(r => r.p.upazila_code === u.code && !hasGps(r.p)).length } })
  const scope = located.filter(r => upz === null || r.p.upazila_code === upz)
  const cov = scope.filter(r => r.route).length, out = scope.length - cov
  const shown = scope.filter(r => show === 'all' || (show === 'out' ? !r.route : !!r.route))
  const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0
  const upzName = (code: number) => { const u = pl.upazilas.find(x => x.code === code); return u ? (lang === 'en' ? u.name : u.name_bn) : '' }
  const picked = sel ? rows.find(r => `p:${r.p.id}` === sel) : null

  const pins: MapPin[] = [
    ...shown.map(r => ({ id: `p:${r.p.id}`, lat: r.p.lat!, lng: r.p.lng!, label: placeName(r.p, lang), num: '', small: true, color: r.route ? '#15803D' : '#dc2626' })),
    ...o.hubs.filter(hasGps).map(h => ({ id: `h:${h.id}`, lat: h.lat!, lng: h.lng!, label: h.name, num: 'H', square: true })),
  ]
  const lines = (upz === null ? pl.upazilas : pl.upazilas.filter(u => u.code === upz)).flatMap(u => boundaryLine(u))

  if (pl.error) return <p className="da-error">{routeFriendly(pl.error)}</p>
  return <>
    <section className="panel">
      <div className="da-bar"><h2>{L('স্মার্ট কভারেজ ম্যাপ', 'Smart coverage map')}</h2>
        <Field label={L('কোন হাবের রুট ধরবেন', 'Count routes from')}><select value={coverageHub} onChange={e => { setCoverageHub(e.target.value); setSel(null) }}>
          <option value="">{L('জোনের সব হাব', 'All hubs in the zone')}</option>
          {o.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select></Field>
        <Field label={L('ম্যাপে দেখান', 'Show on the map')}><select value={show} onChange={e => setShow(e.target.value as typeof show)}>
          <option value="all">{L('সব এলাকা', 'Every place')}</option><option value="out">{L('শুধু যেগুলো রুটে নেই', 'Only not on a route')}</option>
          <option value="in">{L('শুধু যেগুলো রুটে আছে', 'Only on a route')}</option></select></Field></div>
      <p className="rt-hint">{L(`তালিকাভুক্ত লোকেশনের ${n(NEAR_M)} মিটারের মধ্যে রুট স্টপ থাকলে সবুজ দেখাবে। লাল এলাকায় নির্বাচিত হাবের রুট স্টপ পাওয়া যায়নি। H = হাব।`, `Green indicates a route stop within ${NEAR_M} m of a listed place. Red indicates no matching stop for the selected scope. H = hub.`)}</p>
      <div className="rt-bar" style={{ marginBottom: 6 }}><span className="small muted">{L('কী কী ধরবে:', 'Include:')}</span>
        {(Object.keys(PLACE_KIND) as PlaceKind[]).map(k => { const on = kinds.includes(k)
          return <button key={k} type="button" className={on ? 'sm' : 'secondary sm'} onClick={() => setKinds(on ? kinds.filter(x => x !== k) : [...kinds, k])}>{L(PLACE_KIND[k].bn, PLACE_KIND[k].en)}</button> })}</div>
      {pl.loading ? <p className="muted">{L('এলাকার নাম আসছে…', 'Loading place names…')}</p> : <>
        <div className="da-stats">
          <Stat icon="map" label={upz === null ? L('মোট এলাকা (লোকেশনসহ)', 'Places (with location)') : upzName(upz)} value={n(scope.length)} />
          <Stat icon="check" tone="ok" label={L('রুটে আছে', 'On a route')} value={`${n(cov)} (${n(pct(cov, scope.length))}%)`} />
          <Stat icon="alert" tone={out ? 'warn' : 'ok'} label={L('কাভারেজ নেই', 'Not covered')} value={scope.length ? `${n(out)} (${n(pct(out, scope.length))}%)` : '—'} />
          <Stat icon="hub" label={L('হাব (লোকেশনসহ)', 'Hubs (with location)')} value={`${n(o.hubs.filter(hasGps).length)}/${n(o.hubs.length)}`} />
        </div>
        {selectedHub && homeUpazila !== null && <p className="small">
          <b>{selectedHub.name}</b> · {L(`হাবের আনুমানিক উপজেলা ${upzName(homeUpazila)}। প্রতিটি উপজেলার কত শতাংশ এই হাব কভার করে নিচে দেখুন।`, `Estimated home upazila: ${upzName(homeUpazila)}. Each card shows the share covered by this hub.`)}
        </p>}
        <div className="rt-layout">
          <div style={{ minWidth: 0 }}>
            <OsmMap pins={pins} lines={lines} height={520} tags="selected" selected={sel} onSelect={setSel} keepView fitKey={`${upz}:${coverageHub}`} />
            {picked && <p className="small" style={{ marginTop: 6 }}><b>{placeName(picked.p, lang)}</b> · {L(PLACE_KIND[picked.p.kind].bn, PLACE_KIND[picked.p.kind].en)} · {upzName(picked.p.upazila_code)} ·{' '}
              {picked.route ? <span style={{ color: '#15803D' }}>{L(`রুটে আছে: ${picked.route}`, `On route: ${picked.route}`)}</span> : <span style={{ color: '#dc2626' }}>{L('কোনো রুটে নেই', 'On no route')}</span>}
              {picked.coveredHubs.length > 0 && <> · {L('কভার করে', 'Covered by')} {o.hubs.filter(h => picked.coveredHubs.includes(h.id)).map(h => h.name).join(', ')}</>}
              {picked.hubM !== null && <> · {L(`কাছের হাব ${picked.hubName}, ${fmtDist(picked.hubM, fmt)} ${picked.dir}ে`, `nearest hub ${picked.hubName}, ${fmtDist(picked.hubM, fmt)}`)}</>}
              {hasGps(picked.p) && <> · <a href={gmapLink(picked.p.lat!, picked.p.lng!)} target="_blank" rel="noreferrer">Google Maps</a></>}</p>}
          </div>
          <div className="rt-list">
            <article className={`rt-card${upz === null ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => setUpz(null)} onKeyDown={e => { if (e.key === 'Enter') setUpz(null) }}>
              <header><b>{L('পুরো জেলা', 'Whole district')}</b><span className="small">{n(located.filter(r => r.route).length)}/{n(located.length)} · {n(pct(located.filter(r => r.route).length, located.length))}%</span></header>
              <div className="rt-prog"><span style={{ width: `${pct(located.filter(r => r.route).length, located.length)}%` }} /></div></article>
            {byUpz.map(x => <article key={x.u.code} className={`rt-card${upz === x.u.code ? ' on' : ''}`} role="button" tabIndex={0}
              onClick={() => setUpz(upz === x.u.code ? null : x.u.code)} onKeyDown={e => { if (e.key === 'Enter') setUpz(upz === x.u.code ? null : x.u.code) }}>
              <header><b>{lang === 'en' ? x.u.name : x.u.name_bn}{selectedHub && homeUpazila !== null && x.u.code !== homeUpazila ? ' · ' + L('অন্য উপজেলা', 'Other upazila') : ''}</b><span className="small">{n(x.cov)}/{n(x.all)} · {n(pct(x.cov, x.all))}%</span></header>
              <div className="rt-prog"><span style={{ width: `${pct(x.cov, x.all)}%` }} /></div>
              <div className="rt-meta"><span style={{ color: x.all - x.cov ? '#dc2626' : undefined }}>{L(`${n(x.all - x.cov)}টা এলাকায় কাভারেজ নেই`, `${x.all - x.cov} not covered`)}</span>
                {x.noLoc > 0 && <span>{L(`${n(x.noLoc)}টার লোকেশন নেই`, `${x.noLoc} without location`)}</span>}</div>
            </article>)}
          </div>
        </div></>}
    </section>
    <section className="panel">
      <div className="da-bar"><h2>{L('যেসব এলাকায় কাভারেজ নেই', 'Places not covered')}{upz !== null ? ` — ${upzName(upz)}` : ''}</h2></div>
      <p className="rt-hint">{L('কাছের হাব অনুযায়ী সাজানো। সারিতে চাপ দিলে ওই হাবের "এলাকা ও সাজেশন" খোলে — সেখান থেকে এই এলাকাগুলো নিয়ে রুট বানানো যায়।',
        'Sorted by nearest hub. Tap a row to open that hub\'s "Areas & suggestions", where these places can be made into routes.')}</p>
      <DataTable<Row> title={L('কাভারেজ নেই এমন এলাকা', 'Places not covered')} file="route-coverage-gaps" prefKey="route-coverage"
        rows={scope.filter(r => !r.route).sort((a, b) => a.hubName.localeCompare(b.hubName) || (a.hubM ?? 0) - (b.hubM ?? 0))} rowKey={r => r.p.id}
        onRowClick={r => { if (r.hub) onPlan(r.hub) }}
        empty={<p className="muted">{pl.loading ? L('লোড হচ্ছে…', 'Loading…') : L('সব এলাকা কোনো না কোনো রুটে আছে।', 'Every place is on a route.')}</p>}
        cols={[
          { key: 'bn', label: L('এলাকা', 'Place'), value: r => placeName(r.p, lang) },
          { key: 'kind', label: L('ধরন', 'Kind'), value: r => L(PLACE_KIND[r.p.kind].bn, PLACE_KIND[r.p.kind].en) },
          { key: 'upz', label: L('উপজেলা', 'Upazila'), value: r => upzName(r.p.upazila_code) },
          { key: 'hub', label: L('কাছের হাব', 'Nearest hub'), value: r => r.hubName },
          { key: 'km', label: L('হাব থেকে (কিমি)', 'From the hub (km)'), value: r => r.hubM === null ? '' : +(r.hubM / 1000).toFixed(1) },
          { key: 'dir', label: L('কোন দিকে', 'Direction'), value: r => r.dir },
          { key: 'loc', label: L('লোকেশন', 'Location'), value: r => `${r.p.lat}, ${r.p.lng}` },
        ]} />
      <p className="muted small">{PLACE_SOURCES}</p>
    </section>
  </>
}
