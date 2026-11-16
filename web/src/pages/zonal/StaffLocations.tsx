import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { gmapLink, OsmMap, type MapPin } from '../../components/OsmMap'
import { hrFriendly } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { distText, PLACE, tracking, type StaffLoc } from '../../lib/presence'
import { useOrg } from '../hr/common'
import { Badge, Field, Modal, Stat, useLoad } from '../accounts/ui'

/**
 * স্টাফ কোথায় — for the zonal manager only: every active staff member of the zone, how far their phone was from their hub
 * the last time the app sent a location (once an hour while the app is open, 8 am–8 pm), and the day's hourly trail.
 */
type St = 'at_hub' | 'near' | 'far' | 'hub_no_gps' | 'stale' | 'none'
const STALE = 2 * 60 * 60 * 1000
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const isToday = (t: string) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }) === today()

export function StaffLocations() {
  const { L, n, lang } = usePrefs()
  const o = useOrg()
  const [zone, setZone] = useState('')
  const [hub, setHub] = useState('')
  const [st, setSt] = useState<St | ''>('')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [trail, setTrail] = useState<StaffLoc | null>(null)
  const q = useLoad(() => tracking.zone(zone || null), [zone])
  useEffect(() => { const t = setInterval(() => void q.reload(), 5 * 60 * 1000); return () => clearInterval(t) }, [zone])   // keep it fresh
  const now = Date.now()
  const stOf = (r: StaffLoc): St => !r.last_at ? 'none' : now - new Date(r.last_at).getTime() > STALE ? 'stale' : (r.place_status ?? 'hub_no_gps')
  const rows = useMemo(() => (q.data ?? []).filter(r => (!hub || r.hub_id === hub) && (!st || stOf(r) === st)), [q.data, hub, st])
  const all = q.data ?? []
  const count = (s: St) => all.filter(r => stOf(r) === s).length
  const ago = (t: string) => {
    const m = Math.max(0, Math.round((now - new Date(t).getTime()) / 60000))
    if (m < 60) return L(`${n(m)} মিনিট আগে`, `${m} min ago`)
    if (isToday(t)) return L(`${n(Math.floor(m / 60))} ঘণ্টা আগে`, `${Math.floor(m / 60)} h ago`)
    return new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  }
  const WORD: Record<St, [string, string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
    at_hub: [...PLACE.at_hub], near: [...PLACE.near], far: [...PLACE.far], hub_no_gps: [...PLACE.hub_no_gps],
    stale: ['২ ঘণ্টার বেশি খবর নেই', 'No news for 2 h+', 'neutral'], none: ['কখনো পাঠায়নি', 'Never sent', 'neutral'],
  }
  const chip = (r: StaffLoc) => { const s = stOf(r), w = WORD[s]
    return <span className="place-line"><span className={`place-chip t-${w[2]}`}><Icon name="map" size={13} />{L(w[0], w[1])}
      {r.distance_m != null && s !== 'at_hub' && s !== 'none' ? ` · ${distText(r.distance_m, L, n)}` : ''}</span>
      {r.wifi_match && s !== 'stale' && <span className="place-chip t-ok"><Icon name="globe" size={13} />{L('হাবের ওয়াইফাই', 'Hub Wi-Fi')}</span>}</span> }
  const hubs = [...new Map(all.map(r => [r.hub_id, r.hub_name ?? '—'] as [string, string])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const pins: MapPin[] = rows.filter(r => r.latitude != null && r.longitude != null && stOf(r) !== 'none').map(r => ({ id: r.employee_id,
    lat: Number(r.latitude), lng: Number(r.longitude), label: r.full_name,
    tone: stOf(r) === 'at_hub' ? 'ok' : stOf(r) === 'near' ? 'wait' : stOf(r) === 'far' ? 'bad' : 'off' }))

  return <AppShell title={L('স্টাফ কোথায় আছেন', 'Where staff are')} subtitle={L('অ্যাপ খোলা থাকলে ঘণ্টায় একবার · সকাল ৮টা–রাত ৮টা · শুধু জোনাল ম্যানেজার দেখেন', 'Once an hour while the app is open · 8 am–8 pm · zonal manager only')}>
    <section className="da-filters panel no-print hub-top">
      <Field label={L('জোন / এরিয়া', 'Zone / area')}><select value={zone} onChange={e => { setZone(e.target.value); setHub('') }}>
        <option value="">{L('আমার সব জোন', 'All my zones')}</option>{(o.data?.zones ?? []).filter(z => !z.archived_at).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
      <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => setHub(e.target.value)}><option value="">{L('সব হাব', 'All hubs')}</option>
        {hubs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <div className="da-seg" style={{ alignSelf: 'flex-end' }}>
        <button className={view === 'list' ? 'sm' : 'secondary sm'} onClick={() => setView('list')}><Icon name="table" size={14} />{L('তালিকা', 'List')}</button>
        <button className={view === 'map' ? 'sm' : 'secondary sm'} onClick={() => setView('map')}><Icon name="map" size={14} />{L('ম্যাপ', 'Map')}</button>
        <button className="secondary sm" onClick={() => void q.reload()}>{L('রিফ্রেশ', 'Refresh')}</button></div>
    </section>
    <div className="da-stats loc-stats">
      {(['at_hub', 'near', 'far', 'stale', 'none'] as St[]).map(s => <button key={s} type="button" className={`loc-stat${st === s ? ' on' : ''}`} onClick={() => setSt(st === s ? '' : s)}>
        <Stat icon={s === 'at_hub' ? 'check' : s === 'far' ? 'alert' : s === 'near' ? 'map' : 'clock'} tone={s === 'at_hub' ? 'ok' : s === 'far' ? 'bad' : s === 'near' ? 'warn' : undefined}
          label={L(WORD[s][0], WORD[s][1])} value={n(count(s))} /></button>)}
    </div>
    {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : view === 'map' ? <section className="panel">
      {pins.length ? <OsmMap pins={pins} height={460} onSelect={id => setTrail(rows.find(r => r.employee_id === id) ?? null)} />
        : <p className="muted">{L('ম্যাপে দেখানোর মতো লোকেশন নেই।', 'No locations to show.')}</p>}
      <p className="muted small">{L('সবুজ = হাবে · হলুদ = হাবের কাছে (১ কিমির মধ্যে) · লাল = দূরে · ধূসর = ২ ঘণ্টার বেশি পুরনো। পিনে চাপলে আজকের পথ।', 'Green = at the hub · amber = near (within 1 km) · red = far · grey = older than 2 h. Tap a pin for today’s trail.')}</p>
    </section> : <section className="panel">
      <DataTable<StaffLoc> title={L('স্টাফ কোথায়', 'Where staff are')} file={`staff-locations-${today()}`} rows={q.data ? rows : null} rowKey={r => r.employee_id}
        empty={<p className="muted">{L('এখানে কেউ নেই।', 'Nobody here.')}</p>}
        cols={[
          { key: 'code', label: L('আইডি', 'ID'), value: r => r.employee_code ?? '' },
          { key: 'name', label: L('নাম', 'Name'), value: r => r.full_name, render: r => <><strong>{r.full_name}</strong>{r.position && <span className="sec">{r.position}</span>}</> },
          { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name ?? '' },
          { key: 'where', label: L('কোথায়', 'Where'), value: r => `${L(WORD[stOf(r)][0], WORD[stOf(r)][1])}${r.distance_m != null ? ' ' + distText(r.distance_m, L, n) : ''}`, render: chip },
          { key: 'km', label: L('হাব থেকে (কিমি)', 'From hub (km)'), className: 'r', value: r => r.distance_m != null ? n(Math.round(r.distance_m / 100) / 10) : '' },
          { key: 'last', label: L('শেষ খবর', 'Last seen'), value: r => r.last_at ? ago(r.last_at) : L('—', '—') },
          { key: 'today', label: L('আজ কতবার', 'Today'), className: 'r', value: r => n(r.today_count) },
          { key: 'mobile', label: L('মোবাইল', 'Mobile'), value: r => r.mobile ?? '', render: r => r.mobile ? <a href={`tel:${r.mobile}`}>{r.mobile}</a> : '' },
          { key: 'act', label: '', noExport: true, render: r => r.today_count > 0 || r.last_at ? <button className="secondary sm" onClick={() => setTrail(r)}><Icon name="map" size={14} />{L('আজকের পথ', 'Today')}</button> : null },
        ]} />
    </section>}
    {trail && <Trail who={trail} onClose={() => setTrail(null)} />}
  </AppShell>
}

function Trail({ who, onClose }: { who: StaffLoc; onClose: () => void }) {
  const { L, n, lang } = usePrefs()
  const [date, setDate] = useState(today())
  const q = useLoad(() => tracking.day(who.employee_id, date), [who.employee_id, date])
  const pts = q.data ?? []
  const time = (t: string) => new Date(t).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
  const pins: MapPin[] = [
    ...(who.hub_lat != null && who.hub_lng != null ? [{ id: 'hub', lat: Number(who.hub_lat), lng: Number(who.hub_lng), label: who.hub_name ?? L('হাব', 'Hub'), tone: 'sel' as const }] : []),
    ...pts.map((p, i) => ({ id: `p${i}`, lat: Number(p.latitude), lng: Number(p.longitude), label: time(p.at),
      tone: (p.place_status === 'at_hub' ? 'ok' : p.place_status === 'near' ? 'wait' : p.place_status === 'far' ? 'bad' : 'off') as MapPin['tone'] }))]
  return <Modal wide title={`${who.full_name}${who.employee_code ? ` · ${who.employee_code}` : ''} — ${who.hub_name ?? ''}`} onClose={onClose}
    actions={<button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button>}>
    <Field label={L('তারিখ', 'Date')}><input type="date" max={today()} value={date} onChange={e => setDate(e.target.value)} /></Field>
    {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : !q.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !pts.length ? <p className="muted">{L('এই দিনে কোনো লোকেশন আসেনি (অ্যাপ খোলা ছিল না)।', 'No location that day (the app was not open).')}</p> : <>
        <OsmMap pins={pins} height={300} lines={[{ id: 't', color: '#2563eb', points: pts.map(p => [Number(p.latitude), Number(p.longitude)] as [number, number]) }]} />
        <ol className="loc-trail">{pts.map((p, i) => { const w = p.place_status ? PLACE[p.place_status] : null
          return <li key={i}><b>{time(p.at)}</b>
            {w && <Badge tone={w[2]}>{L(w[0], w[1])}{p.distance_m != null && p.place_status !== 'at_hub' ? ` · ${distText(p.distance_m, L, n)}` : ''}</Badge>}
            {p.wifi_match && <Badge tone="ok">{L('হাবের ওয়াইফাই', 'Hub Wi-Fi')}</Badge>}
            {p.accuracy_m != null && p.accuracy_m > 100 && <span className="muted small">±{n(p.accuracy_m)} {L('মি', 'm')}</span>}
            <a className="small" href={gmapLink(Number(p.latitude), Number(p.longitude))} target="_blank" rel="noreferrer">{L('গুগল ম্যাপে', 'Google Maps')}</a></li> })}</ol>
      </>}
  </Modal>
}
