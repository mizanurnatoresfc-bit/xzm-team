// The pieces that every "put a stop / a place somewhere" screen of the route module shares:
//   LocationAdder  — one search box over every location source (see lib/routeLocation.ts): a pasted link or numbers, the place library, stops of
//                    other routes, hubs, and — on Enter — OpenStreetMap. Each result row carries the buttons the caller asks for.
//   GpsButton      — the phone's own location, with its accuracy
//   NoteList       — the "is this sensible?" lines shown right after a location is chosen
//   LocationPicker — a map + LocationAdder that picks ONE point (a new place, a stop that has no location yet)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { OsmMap, type MapLine, type MapPin } from '../../components/OsmMap'
import { usePrefs } from '../../lib/prefs'
import { assess, bearingWord, LOCATION_SOURCES, nearHub, nameFromLibrary, pasteProblem, recents, reverseName, searchAll, searchLocal, type Candidate, type Note, type SourceEnv } from '../../lib/routeLocation'
import { fmtDist, hasGps, myLocation, parseLocation, type LatLng } from '../../lib/routes'
import './routes.css'

export type AddAction = { key: string; label: string; icon?: string; primary?: boolean; run: (c: Candidate) => void }
const srcOf = (id: Candidate['source']) => LOCATION_SOURCES.find(s => s.id === id)

/** The "what is wrong or worth a look" lines for a location, in the person's language. */
export function NoteList({ notes, onDismiss }: { notes: Note[]; onDismiss?: () => void }) {
  const { L } = usePrefs()
  if (!notes.length) return null
  return <div className="lc-notes" role="status">{notes.map(x => <p key={x.code} className={`lc-note ${x.tone}`}><Icon name={x.tone === 'warn' ? 'alert' : 'pin'} size={14} />{L(x.bn, x.en)}</p>)}
    {onDismiss && <button type="button" className="secondary sm" onClick={onDismiss}>{L('ঠিক আছে', 'OK')}</button>}</div>
}

/** The phone's location, then `onGot` with the point and how rough it is (metres). */
export function GpsButton({ onGot, onError, label, className = 'secondary sm' }: { onGot: (p: LatLng, accuracy: number) => void; onError?: (m: string) => void; label?: ReactNode; className?: string }) {
  const { L } = usePrefs()
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try { const p = await myLocation(); onGot({ lat: p.lat, lng: p.lng }, p.accuracy) } catch (e) { onError?.(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return <button type="button" className={className} disabled={busy} onClick={() => void go()}><Icon name="pin" size={13} />{busy ? L('লোকেশন নেওয়া হচ্ছে…', 'Getting location…') : label ?? L('আমার লোকেশন', 'My location')}</button>
}

export function LocationAdder({ env, actions, onFocus, onMessage, placeholder, extra }: {
  env: SourceEnv; actions: AddAction[]
  /** called with a result's point when the row is tapped (the caller centres its map there); null when nothing is picked */
  onFocus?: (p: LatLng | null) => void
  onMessage?: (m: string) => void
  placeholder?: string; extra?: ReactNode
}) {
  const { L, n } = usePrefs()
  const fmt = { L, n }
  const [q, setQ] = useState('')
  const [online, setOnline] = useState<{ q: string; list: Candidate[]; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [rec, setRec] = useState<string[]>(() => recents.get())
  const hub = env.hub && hasGps(env.hub) ? { lat: env.hub.lat, lng: env.hub.lng } : null
  const local = useMemo(() => searchLocal(q, env), [q, env])
  const found = useMemo(() => [...local, ...(online && online.q === q.trim() ? online.list.filter(c => c.source === 'online') : [])], [local, online, q])
  const idle = q.trim().length < 2
  const near = useMemo(() => idle ? nearHub(env) : [], [idle, env])
  const problem = pasteProblem(q)
  const seq = useRef(0)
  useEffect(() => { setOnline(o => o && o.q !== q.trim() ? null : o) }, [q])

  async function go() {
    const t = q.trim()
    if (t.length < 2) return
    recents.push(t); setRec(recents.get())
    if (parseLocation(t)) return
    const mine = ++seq.current
    setBusy(true)
    const r = await searchAll(t, env)
    if (mine !== seq.current) return
    setBusy(false); setOnline({ q: t, list: r.list, error: r.error })
    if (r.error) onMessage?.(r.error)
  }
  const shown = idle ? near : found
  let prev = ''
  return <div className="lc">
    <div className="rt-bar">
      <input className="lc-q" style={{ flex: 1, minWidth: 0 }} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void go() } }}
        placeholder={placeholder ?? L('জায়গার নাম, Google Maps লিংক, "24.37, 88.60" বা Plus Code', 'Place name, Google Maps link, "24.37, 88.60" or Plus Code')} aria-label={L('লোকেশন খুঁজুন', 'Search a location')} />
      <button type="button" className="secondary" disabled={busy || q.trim().length < 2} onClick={() => void go()}><Icon name="search" size={14} />{busy ? L('খোঁজা হচ্ছে…', 'Searching…') : L('অনলাইনেও খুঁজুন', 'Search online too')}</button>
    </div>
    {extra}
    {problem === 'short-link' && <p className="lc-note warn"><Icon name="alert" size={14} />{L('এটা ছোট লিংক (goo.gl / maps.app) — এখান থেকে লোকেশন পড়া যায় না। লিংকটা ব্রাউজারে খুলে ঠিকানার বারের লম্বা লিংকটা দিন, অথবা Google Maps-এ জায়গাটা ধরে রেখে নম্বরটা (24.37, 88.60) কপি করুন।',
      'This is a short link — the location cannot be read from it. Open it in a browser and paste the long address, or long-press the place in Google Maps and copy the numbers.')}</p>}
    {idle && rec.length > 0 && <div className="rt-bar lc-recent"><span className="small muted">{L('আগে খুঁজেছেন:', 'Recent:')}</span>
      {rec.map(r => <button key={r} type="button" className="secondary sm" onClick={() => setQ(r)}>{r}</button>)}</div>}
    {idle && near.length > 0 && <p className="rt-hint">{L('হাবের কাছের জায়গা — চাপ দিয়ে যোগ করুন, অথবা নাম লিখে খুঁজুন।', 'Places near the hub — tap to add, or type a name.')}</p>}
    {!idle && !found.length && !busy && <p className="rt-hint">{online && online.q === q.trim()
      ? L('কিছু পাওয়া যায়নি — অন্য বানানে, ইংরেজি নামে বা Google Maps লিংক দিয়ে চেষ্টা করুন, অথবা ম্যাপে চাপ দিন।', 'Nothing found — try another spelling, the English name or a Google Maps link, or tap the map.')
      : L('তালিকায় নেই। "অনলাইনেও খুঁজুন" চাপুন (বা Enter)।', 'Not in the library. Press "Search online too" (or Enter).')}</p>}
    {shown.length > 0 && <div className="lc-results">{shown.map(c => {
      const head = c.source !== prev ? srcOf(c.source) : null; prev = c.source
      const at = hasGps(c) ? { lat: c.lat, lng: c.lng } : null
      return <div key={c.id}>
        {head && !idle && <div className="lc-head"><Icon name={head.icon} size={12} />{L(head.bn, head.en)}</div>}
        <div className={`lc-row${at ? '' : ' off'}`}>
          <button type="button" className="lc-main" onClick={() => onFocus?.(at)} title={at ? L('ম্যাপে দেখুন', 'Show on the map') : undefined}>
            <b>{c.name}</b>
            <span className="lc-sub">{[c.source === 'stops' ? c.sub : undefined, c.source === 'online' ? c.sub : undefined,
              c.distM !== null ? `${fmtDist(c.distM, fmt)}${hub && at ? ` ${bearingWord(hub, at)}` : ''}` : undefined, at ? undefined : L('লোকেশন নেই', 'no location')].filter(Boolean).join(' · ')}</span>
          </button>
          <span className="lc-acts">{actions.map(a => <button key={a.key} type="button" className={a.primary ? 'sm' : 'secondary sm'} onClick={() => { recents.push(q); a.run(c) }}>
            {a.icon && <Icon name={a.icon} size={13} />}{a.label}</button>)}</span>
        </div></div>
    })}</div>}
  </div>
}

/**
 * Pick ONE point: tap the map, search / paste, or use the phone's location. The point is shown as a pin and written as numbers that can be edited.
 * `onChange(point, nameHint)` — nameHint is the name of the library place / search result, or the name OpenStreetMap gives the tapped spot.
 */
export function LocationPicker({ env, value, onChange, height = 300, pins = [], lines = [], fitKey, ignore }: {
  env: SourceEnv; value: LatLng | null; onChange: (p: LatLng | null, nameHint?: string) => void; height?: number
  pins?: MapPin[]; lines?: MapLine[]; fitKey?: string | number
  /** other stops to measure "already there" against (the stop being fixed is left out by the caller) */
  ignore?: { stops: Parameters<typeof assess>[1]['stops']; others: Parameters<typeof assess>[1]['others'] }
}) {
  const { L } = usePrefs()
  const [focus, setFocus] = useState<LatLng | null>(null)
  const [text, setText] = useState(value ? `${value.lat}, ${value.lng}` : '')
  const [acc, setAcc] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { setText(value ? `${value.lat}, ${value.lng}` : '') }, [value])
  const hubPt = env.hub && hasGps(env.hub) ? { lat: env.hub.lat, lng: env.hub.lng } : null
  const notes = useMemo(() => value ? assess(value, { hub: hubPt, stops: ignore?.stops ?? [], others: ignore?.others ?? [], accuracy: acc }) : [], [value, hubPt, ignore, acc])

  async function tapped(lat: number, lng: number) {
    setAcc(null); setMsg('')
    const p = { lat: +lat.toFixed(7), lng: +lng.toFixed(7) }
    const lib = nameFromLibrary(p, env.places, env.lang)
    onChange(p, lib?.name)
    if (!lib) { const nm = await reverseName(p); if (nm) onChange(p, nm) }
  }
  const mapPins: MapPin[] = [
    ...(env.hub && hasGps(env.hub) ? [{ id: 'hub', lat: env.hub.lat, lng: env.hub.lng, label: env.hub.name, num: 'H', square: true }] : []),
    ...pins,
    ...(value ? [{ id: 'pick', lat: value.lat, lng: value.lng, label: L('বাছাই করা লোকেশন', 'Chosen location'), tone: 'sel' as const }] : []),
  ]
  return <div className="lc-picker">
    <OsmMap pins={mapPins} lines={lines} height={height} focus={focus} onPick={(la, ln) => void tapped(la, ln)} keepView fitKey={fitKey} tags="selected" />
    <p className="rt-hint">{L('ম্যাপে চাপ দিয়ে জায়গা বসান, অথবা নিচে খুঁজুন / লিংক দিন।', 'Tap the map to place it, or search / paste below.')}</p>
    <LocationAdder env={env} onFocus={p => p && setFocus({ ...p })} onMessage={setMsg}
      actions={[{ key: 'use', label: L('এটাই', 'Use this'), icon: 'check', primary: true, run: c => { if (hasGps(c)) { setAcc(null); setFocus({ lat: c.lat, lng: c.lng }); onChange({ lat: c.lat, lng: c.lng }, c.name) } else setMsg(L('এই ফলাফলের লোকেশন নেই', 'This result has no location')) } }]}
      extra={<div className="rt-bar"><GpsButton onError={setMsg} onGot={(p, a) => { setAcc(a); setFocus(p); onChange(p) }} />
        <input className="lc-num" value={text} onChange={e => setText(e.target.value)} placeholder="24.37, 88.60" aria-label={L('লোকেশনের নম্বর', 'Location numbers')}
          onBlur={() => { const t = text.trim(); if (!t) { onChange(null); return } const ll = parseLocation(t); if (ll) { setFocus(ll); onChange(ll) } else setMsg(L('লোকেশন বোঝা যায়নি', 'Location not understood')) }} /></div>} />
    {msg && <p className="da-error">{msg}</p>}
    <NoteList notes={notes} />
  </div>
}
