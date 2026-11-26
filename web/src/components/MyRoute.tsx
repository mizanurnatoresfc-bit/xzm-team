import { useState } from 'react'
import { Icon } from './Icon'
import { OsmMap, type MapCircle, type MapPin } from './OsmMap'
import { Badge, useLoad } from '../pages/accounts/ui'
import { usePrefs } from '../lib/prefs'
import { fmtDist, fmtKm, hasGps, myLocation, roadLine, routeApi, routeFriendly, routeLine, type MyRoute } from '../lib/routes'

/** Staff panel → আমার রুট: my route on the real map, the next stop, and "এখানে পৌঁছেছি" when the permission is given. */
export function MyRouteCard() {
  const { L, n } = usePrefs()
  const fmt = { L, n }
  const d = useLoad(() => routeApi.mine(), [])
  const [focusByRoute, setFocusByRoute] = useState<Record<string, string>>({})
  const [loops, setLoops] = useState<Record<string, Awaited<ReturnType<typeof roadLine>>>>({})
  const [loopBusy, setLoopBusy] = useState('')
  const [loopError, setLoopError] = useState<{ key: string; text: string } | null>(null)
  const [me, setMe] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const routes = (d.data?.routes ?? []).filter((r: MyRoute) => r.stops.some(hasGps))
  if (d.error) return <p className="da-error" style={{ marginTop: 10 }}>{L('আপনার রুট আনা যায়নি', 'Your route could not be loaded')}: {routeFriendly(d.error)}{' '}
    <button className="secondary sm" onClick={() => void d.reload()}>{L('আবার চেষ্টা', 'Try again')}</button></p>
  if (!routes.length) return null

  async function checkin(stopId: string) {
    setBusy(stopId); setMsg(null)
    try {
      const p = await myLocation(); setMe(p)
      const res = await routeApi.checkin(stopId, p.lat, p.lng, p.accuracy)
      setMsg(res.near ? { tone: 'ok', text: L(`চেক-ইন হয়েছে — স্টপ থেকে ${fmtDist(res.distance_m, fmt)} দূরে।`, `Checked in — ${res.distance_m} m from the stop.`) }
        : { tone: 'warn', text: L(`চেক-ইন রাখা হলো, তবে আপনি স্টপ থেকে ${fmtDist(res.distance_m, fmt)} দূরে (সীমা ${fmtDist(res.radius_m, fmt)})। কাছে গিয়ে তালিকায় "আবার চেষ্টা" চাপুন।`,
          `Saved, but you are ${res.distance_m} m away (limit ${res.radius_m} m). Go closer and press "Try again" in the list.`) })
      await d.reload()
    } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error && /লোকেশন/.test(e.message) ? e.message : routeFriendly(e) }) } finally { setBusy('') }
  }

  return <>{routes.map(r => {
    const done = new Map(r.visits.map(v => [v.stop_id, v]))
    const gps = r.stops.filter(hasGps)
    const next = gps.find(s => !done.has(s.id!))
    const hub = hasGps(r.hub) ? { lat: r.hub.lat, lng: r.hub.lng } : null
    const waypoints = hub && gps.length === r.stops.length
      ? [hub, ...gps.map(s => ({ lat: s.lat!, lng: s.lng! })), hub] : null
    const loopKey = r.id + ':' + JSON.stringify(waypoints)
    const loop = loops[loopKey]
    const selected = focusByRoute[r.id] ?? next?.id ?? 'hub'
    const focus = selected === 'hub' ? hub : gps.find(s => s.id === selected)
    const outbound = routeLine(r, r.hub)
    const selectPin = (id: string) => setFocusByRoute(previous => ({ ...previous, [r.id]: id }))
    async function showLoop() {
      if (!waypoints || loopBusy) return
      setLoopBusy(loopKey); setLoopError(null)
      try {
        const result = await roadLine(waypoints)
        setLoops(previous => ({ ...previous, [loopKey]: result }))
        setFocusByRoute(previous => {
          const updated = { ...previous }
          delete updated[r.id]
          return updated
        })
      } catch (error) {
        setLoopError({ key: loopKey, text: routeFriendly(error) })
      } finally { setLoopBusy('') }
    }
    const color = r.color || '#15803D'
    const pins: MapPin[] = [
      ...(hasGps(r.hub) ? [{ id: 'hub', lat: r.hub.lat, lng: r.hub.lng, label: r.hub.name, num: 'H', square: true }] : []),
      ...gps.map(s => ({ id: s.id!, lat: s.lat!, lng: s.lng!, label: `${n(s.seq ?? 0)}. ${s.name}`, num: n(s.seq ?? 0), color: done.has(s.id!) ? '#15803D' : color,
        tone: done.has(s.id!) ? undefined : next?.id === s.id ? 'sel' as const : 'off' as const })),
      ...(me ? [{ id: 'me', lat: me.lat, lng: me.lng, label: L('আমি এখানে', 'Me'), tone: 'sel' as const }] : []),
    ]
    const circles: MapCircle[] = [...(next && hasGps(next) ? [{ id: 'n', lat: next.lat!, lng: next.lng!, m: next.radius_m ?? r.rules.stop_radius_m, color }] : []),
      ...(me ? [{ id: 'me', lat: me.lat, lng: me.lng, m: me.accuracy, color: '#2563eb' }] : [])]
    return <div key={r.id} className="sp-box" style={{ marginTop: 10 }}>
      <h3><Icon name="map" size={16} />{r.name}<span className="cnt">{n(done.size)}/{n(gps.length)}</span></h3>
      <p className="muted small">{L(`${n(r.stops.length)}টা স্টপ`, `${r.stops.length} stops`)} · {fmtKm(r.road_km ?? r.distance_km, fmt)}
        {r.riders.length > 1 && ` · ${L('সাথে', 'with')} ${r.riders.map(x => x.name).join(', ')}`}</p>
      <div className="rt-bar">
        <button type="button" className="secondary" disabled={!waypoints || !!loopBusy} onClick={() => void showLoop()}>
          {loopBusy === loopKey ? L('সড়কপথ হিসাব হচ্ছে…', 'Calculating road route…') : L('হাব → স্টপ → হাব', 'Hub → stops → hub')}
        </button>
        {hub && <button type="button" className="secondary" onClick={() => selectPin('hub')}>{L('ম্যাপে হাব', 'Show hub on map')}</button>}
      </div>
      {!waypoints && <p className="muted small">{L('ফেরতসহ সড়কপথের জন্য হাব ও সব স্টপের লোকেশন লাগবে।', 'A hub location and every stop location are needed for the round trip.')}</p>}
      {loop && <p className="small">{L('হাবে ফেরাসহ সড়কপথ', 'Road route including return to hub')} · {fmtKm(loop.km, fmt)} · {n(loop.minutes)} {L('মিনিট', 'min')}</p>}
      {loop && loop.legs.length === gps.length + 1 && <details className="small">
        <summary>{L('স্টপ ধরে সড়ক দূরত্ব দেখুন', 'Show road distance by stop')}</summary>
        <ol>{loop.legs.map((leg, i) => <li key={i}>
          {i === 0 ? r.hub.name : gps[i - 1].name} → {i === gps.length ? r.hub.name : gps[i].name} · {fmtKm(leg.km, fmt)} · {n(leg.minutes)} {L('মিনিট', 'min')}
        </li>)}</ol>
      </details>}
      {loopError?.key === loopKey && <p className="da-error" role="alert">{loopError.text}</p>}
      {!loop && !outbound.road && <p className="muted small">{L('ভাঙা লাইন স্টপের ক্রম দেখায়। সড়কপথ দেখতে ওপরের বাটন চাপুন।', 'The dashed line shows stop order. Use the button above to calculate the road route.')}</p>}
      <OsmMap pins={pins} circles={circles} lines={[{ id: 'l', color, points: loop?.path ?? outbound.points, dashed: !loop && !outbound.road, width: 4 }]}
        height={280} tags="selected" selected={selected} onSelect={selectPin}
        focus={focusByRoute[r.id] && focus && hasGps(focus) ? { lat: focus.lat, lng: focus.lng } : undefined} />
      {next && hasGps(next) && <div className="rt-bar" style={{ marginTop: 8 }}>
        <b className="small" style={{ flex: 1 }}>{L('পরের স্টপ', 'Next stop')}: {n(next.seq ?? 0)}. {next.name}</b>
        <button type="button" className="secondary" onClick={() => selectPin(next.id!)}>{L('ম্যাপে স্টপ দেখুন', 'Show stop on map')}</button>
        {r.can_checkin && <button disabled={!!busy} onClick={() => void checkin(next.id!)}><Icon name="check" size={14} />{busy === next.id ? L('লোকেশন নেওয়া হচ্ছে…', 'Getting location…') : L('এখানে পৌঁছেছি', "I'm here")}</button>}
      </div>}
      {!next && gps.length > 0 && <p className="small" style={{ color: '#15803D', fontWeight: 700 }}>{L('আজ সব স্টপে চেক-ইন হয়ে গেছে।', 'Every stop checked in today.')}</p>}
      {msg && <p className={msg.tone === 'bad' ? 'da-error' : 'small'} style={msg.tone === 'warn' ? { color: '#ea580c' } : undefined}>{msg.text}</p>}
      <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 22 }}>{r.stops.map(s => { const v = s.id ? done.get(s.id) : undefined
        return <li key={s.id} style={{ marginBottom: 4 }}>{s.name}{' '}
          {v ? <><Badge tone={v.near ? 'ok' : 'warn'}>{n(new Date(v.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' }))}{v.near ? '' : ` · ${L('দূরে', 'far')}`}</Badge>{!v.near && r.can_checkin && <>{' '}
            <button className="secondary sm" disabled={!!busy} onClick={() => void checkin(s.id!)}>{busy === s.id ? '…' : L('আবার চেষ্টা', 'Try again')}</button></>}</>
            : !hasGps(s) ? <span className="muted">· {L('লোকেশন নেই', 'no location')}</span>
            : r.can_checkin && s.id !== next?.id ? <button className="secondary sm" disabled={!!busy} onClick={() => void checkin(s.id!)}>{busy === s.id ? '…' : L('পৌঁছেছি', 'Here')}</button> : null}</li> })}</ol>
      {!r.can_checkin && <p className="muted small">{L('স্টপে চেক-ইন এখনো আপনার জন্য চালু হয়নি।', 'Stop check-in is not on for you yet.')}</p>}
    </div>
  })}</>
}
