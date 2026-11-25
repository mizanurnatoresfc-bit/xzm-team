// "লোকেশন যোগ" — one place for every missing location of the zone.
//   1. Stops that have no location, route by route: give each one a place (map, search, link, GPS) or fix many at once from the place library or a list / file.
//   2. The place library: add a new place, and give a location to the places that have none.
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, Stat } from '../accounts/ui'
import { PlaceForm, usePlaces } from '../zonal/RoutePlaces'
import { usePrefs } from '../../lib/prefs'
import { readSheet } from '../../lib/sheetRead'
import { nameScore, norm, parseBulkRows, parseBulkText, type BulkLine, type SourceEnv } from '../../lib/routeLocation'
import { hasGps, placeName, placesApi, PLACE_KIND, routeApi, routeFriendly, type LatLng, type Place, type RouteStop, type ZoneOverview, type ZoneRoute } from '../../lib/routes'
import type { PaneCtx } from './panes'
import { LocationPicker } from './LocationUI'

/** Saves a route with some of its stops changed (every other field as it is; the road line clears itself when a stop moves). */
const saveWith = (r: ZoneRoute, stops: RouteStop[]) => routeApi.save({ id: r.id, hub_id: r.hub_id, code: r.code, name: r.name, note: r.note, color: r.color, shift: r.shift, stops, road: null })

export function LocationsPane({ c }: { c: PaneCtx }) {
  const { L, n, lang } = usePrefs()
  const { can } = useAuth()
  const o = c.o as ZoneOverview
  const pl = usePlaces()
  const [one, setOne] = useState<{ r: ZoneRoute; i: number } | null>(null)
  const [many, setMany] = useState(false)
  const [place, setPlace] = useState<Partial<Place> | null>(null)
  const [err, setErr] = useState('')
  const canPlaces = can('ops.route_setting.edit')

  const todo = useMemo(() => c.routes.flatMap(r => r.stops.map((s, i) => ({ r, s, i })).filter(x => !hasGps(x.s))), [c.routes])
  const mine = todo.filter(x => c.canEdit(x.r.hub_id))
  const noLoc = useMemo(() => pl.places.filter(p => !p.hidden && !hasGps(p)), [pl.places])
  const hubOf = (id: string) => o.hubs.find(h => h.id === id)

  return <>
    <div className="da-stats">
      <Stat icon="hub" label={L('এলাকার তালিকায় জায়গা', 'Places in the library')} value={n(pl.places.filter(p => !p.hidden).length)} />
      <Stat icon="alert" tone={noLoc.length ? 'warn' : 'ok'} label={L('তালিকার জায়গা — লোকেশন নেই', 'Library places without a location')} value={n(noLoc.length)} />
    </div>

    <section className="panel">
      <div className="da-bar"><h2>{L('লোকেশন ছাড়া স্টপ', 'Stops without a location')}</h2>
        {mine.length > 0 && <button onClick={() => { setErr(''); setMany(m => !m) }}><Icon name="note" size={15} />{L('অনেকগুলো একসাথে ঠিক করুন', 'Fix many at once')}</button>}</div>
      <p className="rt-hint">{L('রাইডার রুটের প্রতিটা স্টপের লোকেশন থাকলে দূরত্ব, সময় আর রাইডারের চেক-ইন ঠিকঠাক মাপা যায়। একটা একটা করে ম্যাপে বসান, অথবা এলাকার তালিকা / ফাইল থেকে একসাথে।', 'With a location on every stop, distance, time and rider check-ins are measured properly. Place them one by one, or many at once from the library or a file.')}</p>
      {many && <FixMany c={c} stops={mine} places={pl.places} onDone={() => { setMany(false); void c.reload() }} onClose={() => setMany(false)} />}
      {err && <p className="da-error">{err}</p>}
      {!todo.length ? <p className="muted">{L('সব স্টপের লোকেশন আছে।', 'Every stop has a location.')}</p> :
        <div className="rm-fix">{todo.map(({ r, s, i }) => <div key={`${r.id}:${i}`} className="rt-stop">
          <div style={{ minWidth: 0 }}><b className="small">{s.name}</b>
            <div className="rt-meta"><span><span className="rt-sw" style={{ background: r.color || '#15803D', display: 'inline-block', marginRight: 4 }} />{r.name}</span><span>{hubOf(r.hub_id)?.name}</span><span>{L(`${n(i + 1)} নম্বর স্টপ`, `stop ${i + 1}`)}</span></div></div>
          <span className="acts">{c.canEdit(r.hub_id) ? <button type="button" className="sm" onClick={() => { setErr(''); setOne({ r, i }) }}><Icon name="pin" size={13} />{L('লোকেশন দিন', 'Set location')}</button>
            : <Badge tone="info">{L('অনুমতি নেই', 'no permission')}</Badge>}</span>
        </div>)}</div>}
    </section>

    <section className="panel">
      <div className="da-bar"><h2>{L('এলাকার তালিকা (গ্রাম, পাড়া, বাজার)', 'Place library')}</h2>
        {canPlaces && <button onClick={() => setPlace({ upazila_code: pl.upazilas[0]?.code, kind: 'village', name_bn: '', lat: null, lng: null })}><Icon name="plus" size={15} />{L('নতুন জায়গা', 'New place')}</button>}</div>
      <p className="rt-hint">{L('এই তালিকা থেকে রুটে স্টপ বাছা যায়, আর ম্যাপে চাপ দিলে কাছের জায়গার নামে স্টপের নাম বসে। যে জায়গার লোকেশন নেই সেটা বসিয়ে দিলে সবার কাজে লাগবে।', 'Stops can be picked from this library, and a tap on the map is named after the nearest place. Giving a location to the places that lack one helps everyone.')}</p>
      {pl.error ? <p className="da-error">{routeFriendly(pl.error)}</p> : pl.loading ? <p className="muted small">{L('এলাকার নাম আসছে…', 'Loading place names…')}</p> :
        !noLoc.length ? <p className="muted">{L('তালিকার সব জায়গার লোকেশন আছে।', 'Every library place has a location.')}</p> :
        <div className="rm-fix" style={{ maxHeight: '44vh', overflow: 'auto' }}>{noLoc.slice(0, 60).map(p => <div key={p.id} className="rt-stop">
          <div style={{ minWidth: 0 }}><b className="small">{placeName(p, lang)}</b>
            <div className="rt-meta"><span>{L(PLACE_KIND[p.kind].bn, PLACE_KIND[p.kind].en)}</span><span>{pl.upazilas.find(u => u.code === p.upazila_code)?.[lang === 'en' ? 'name' : 'name_bn']}</span></div></div>
          <span className="acts">{canPlaces && <button type="button" className="secondary sm" onClick={() => setPlace(p)}><Icon name="pin" size={13} />{L('লোকেশন দিন', 'Set location')}</button>}</span>
        </div>)}{noLoc.length > 60 && <p className="muted small">{L(`আরও ${n(noLoc.length - 60)}টা আছে`, `${noLoc.length - 60} more`)}</p>}</div>}
    </section>

    {one && <FixOne c={c} route={one.r} index={one.i} places={pl.places} onClose={() => setOne(null)} onSaved={() => { setOne(null); c.toast(L('লোকেশন সেভ হয়েছে', 'Location saved')); void c.reload() }} />}
    {place && <PlaceForm place={place} upazilas={pl.upazilas} places={pl.places} onClose={() => setPlace(null)} onSaved={async () => { setPlace(null); c.toast(L('জায়গা সেভ হয়েছে', 'Place saved')); pl.setData(await placesApi.load(true)) }} />}
  </>
}

// ---------------------------------------------------------------- one stop: pick its place on the map
function FixOne({ c, route, index, places, onClose, onSaved }: { c: PaneCtx; route: ZoneRoute; index: number; places: Place[]; onClose: () => void; onSaved: () => void }) {
  const { L, n, lang } = usePrefs()
  const o = c.o as ZoneOverview
  const stop = route.stops[index]
  const hub = o.hubs.find(h => h.id === route.hub_id) ?? null
  const [pt, setPt] = useState<LatLng | null>(null)
  const [name, setName] = useState(stop.name)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const env = useMemo<SourceEnv>(() => ({ hub, hubs: o.hubs, places, routes: o.routes, lang, skipRoute: route.id }), [hub, o, places, lang, route.id])
  const others = useMemo(() => o.routes.filter(r => r.hub_id === route.hub_id && r.id !== route.id).flatMap(r => r.stops.filter(hasGps).map(s => ({ route: r.name, name: s.name, lat: s.lat!, lng: s.lng! }))), [o.routes, route])
  const pins = route.stops.map((s, i) => hasGps(s) && i !== index ? { id: `s${i}`, lat: s.lat, lng: s.lng, label: `${n(i + 1)}. ${s.name}`, num: n(i + 1), color: route.color || '#15803D' } : null).filter(Boolean) as Array<{ id: string; lat: number; lng: number; label: string; num: string; color: string }>
  async function save() {
    if (!pt) return setErr(L('আগে লোকেশন বাছুন', 'Choose a location first'))
    setBusy(true); setErr('')
    try { await saveWith(route, route.stops.map((s, i) => i === index ? { ...s, name: name.trim() || s.name, lat: pt.lat, lng: pt.lng } : s)); onSaved() }
    catch (e) { setErr(routeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={`${route.name} — ${L(`${n(index + 1)} নম্বর স্টপের লোকেশন`, `location of stop ${index + 1}`)}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || !pt} onClick={() => void save()}><Icon name="save" size={15} />{L('সেভ', 'Save')}</button></>}>
    <Field label={L('স্টপের নাম', 'Stop name')}><input value={name} onChange={e => setName(e.target.value)} /></Field>
    <LocationPicker env={env} value={pt} height={340} pins={pins} fitKey={route.id}
      ignore={{ stops: route.stops.filter((_, i) => i !== index), others }}
      onChange={(p, hint) => { setPt(p); if (hint && p && /^(স্টপ|Stop)\s*[0-9০-৯]+$/.test(name.trim())) setName(hint) }} />
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ---------------------------------------------------------------- many stops: from the library, or a pasted list / a file
type Match = { r: ZoneRoute; i: number; s: RouteStop; lat: number; lng: number; from: string; use: boolean }
function FixMany({ c, stops, places, onDone, onClose }: { c: PaneCtx; stops: Array<{ r: ZoneRoute; s: RouteStop; i: number }>; places: Place[]; onDone: () => void; onClose: () => void }) {
  const { L, n, lang } = usePrefs()
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const lib = (s: RouteStop) => places.filter(p => !p.hidden && hasGps(p) && (nameScore(p.name_bn ?? '', s.name) >= 100 || nameScore(p.name ?? '', s.name) >= 100))

  /** Every stop whose exact name is in the library once gets that place's location. */
  function fromLibrary() {
    const out: Match[] = []
    for (const { r, s, i } of stops) { const hit = lib(s).filter(p => hasGps(p)); if (hit.length === 1) out.push({ r, i, s, lat: hit[0].lat!, lng: hit[0].lng!, from: placeName(hit[0], lang), use: true }) }
    setMatches(out); setMsg(out.length ? '' : L('তালিকায় এই স্টপগুলোর নামে কোনো জায়গা পাওয়া যায়নি (একটাও হুবহু মেলেনি)', 'No stop name matches a library place exactly'))
  }
  function fromLines(lines: BulkLine[]) {
    const given = lines.filter(l => l.lat !== null && l.lng !== null)
    const out: Match[] = []
    for (const { r, s, i } of stops) { const l = given.find(g => norm(g.name) === norm(s.name)); if (l) out.push({ r, i, s, lat: l.lat!, lng: l.lng!, from: L('আপনার তালিকা', 'your list'), use: true }) }
    setMatches(out)
    setMsg(out.length ? '' : L(`${n(given.length)}টা লাইনের লোকেশন পড়া গেছে, কিন্তু কোনো স্টপের নামের সাথে মেলেনি — নাম হুবহু এক হতে হবে`, 'No line matches a stop name exactly'))
  }
  async function file(f: File | undefined) {
    if (!f) return
    try { fromLines(parseBulkRows(await readSheet(f))) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  async function apply() {
    const use = (matches ?? []).filter(m => m.use)
    if (!use.length) return
    setBusy(true); setMsg('')
    const byRoute = new Map<string, Match[]>()
    for (const m of use) byRoute.set(m.r.id, [...(byRoute.get(m.r.id) ?? []), m])
    let done = 0
    try {
      for (const ms of byRoute.values()) {
        const r = ms[0].r
        await saveWith(r, r.stops.map((s, i) => { const m = ms.find(x => x.i === i); return m ? { ...s, lat: m.lat, lng: m.lng } : s })); done += ms.length
      }
      c.toast(L(`${n(done)}টা স্টপের লোকেশন বসেছে`, `${done} stops placed`)); onDone()
    } catch (e) { setMsg(`${L(`${n(done)}টা বসেছে, তারপর থেমে গেছে: `, `${done} placed, then stopped: `)}${routeFriendly(e)}`); void c.reload() } finally { setBusy(false) }
  }
  return <div className="rt-card lc-bulk" style={{ marginBottom: 8 }}>
    {!matches && <>
      <b className="small">{L(`${n(stops.length)}টা স্টপের লোকেশন নেই। কোথা থেকে নেবেন?`, `${stops.length} stops have no location. Where from?`)}</b>
      <div className="rt-bar"><button type="button" className="sm" onClick={fromLibrary}><Icon name="hub" size={13} />{L('এলাকার তালিকা থেকে নিজে মেলান', 'Match with the place library')}</button>
        <label className="btn-ghost small" style={{ cursor: 'pointer' }}><Icon name="upload" size={13} /> {L('Excel / CSV ফাইল', 'Excel / CSV file')}<input type="file" accept=".xlsx,.csv" hidden onChange={e => { void file(e.target.files?.[0]); e.target.value = '' }} /></label>
        <button type="button" className="secondary sm" onClick={onClose}>{L('বাতিল', 'Cancel')}</button></div>
      <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={'কাজলা, 24.3640, 88.6290\nবিনোদপুর, https://maps.google.com/?q=24.369,88.641'} />
      <div className="rt-bar"><button type="button" className="secondary sm" disabled={!text.trim()} onClick={() => fromLines(parseBulkText(text))}>{L('লেখা তালিকা থেকে মেলান', 'Match with the pasted list')}</button></div>
      <p className="rt-hint">{L('স্টপের নাম আর তালিকার নাম হুবহু এক হলে তবেই মেলে। মিলে গেলে নিচে দেখে নিয়ে "বসান" চাপুন — কিছু সেভ হয় তার আগে নয়।', 'A stop matches only when the name is exactly the same. Check the matches below, then press "Place" — nothing is saved before.')}</p></>}
    {matches && <>
      <b className="small">{L(`${n(matches.length)}টা স্টপ মিলেছে`, `${matches.length} stops matched`)}</b>
      <div className="lc-bulk-rows">{matches.map((m, k) => <div key={`${m.r.id}:${m.i}`} className="lc-bulk-row">
        <input type="checkbox" checked={m.use} onChange={e => setMatches(ms => ms && ms.map((x, j) => j === k ? { ...x, use: e.target.checked } : x))} aria-label={L('এটা বসান', 'Place this one')} />
        <div style={{ minWidth: 0 }}><b className="small">{m.s.name}</b> <span className="muted small">· {m.r.name}</span><div className="small muted">{m.lat}, {m.lng} · {m.from}</div></div></div>)}</div>
      <div className="rt-bar"><button type="button" className="sm" disabled={busy || !matches.some(m => m.use)} onClick={() => void apply()}><Icon name="check" size={13} />{busy ? L('বসানো হচ্ছে…', 'Placing…') : L(`বসান (${n(matches.filter(m => m.use).length)})`, `Place (${matches.filter(m => m.use).length})`)}</button>
        <button type="button" className="secondary sm" disabled={busy} onClick={() => setMatches(null)}>{L('আবার', 'Back')}</button></div></>}
    {msg && <p className="da-error">{msg}</p>}
  </div>
}
