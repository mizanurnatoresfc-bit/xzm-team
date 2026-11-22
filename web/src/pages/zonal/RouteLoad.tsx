import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Badge, Field, Stat, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { LOAD_MIN_DAYS, loadApi, planLoad, routeFriendly, type HubPlan, type RoutePlan, type RouteTip, type ZoneOverview } from '../../lib/routes'

/** রুট সেটিং → পার্সেল ও পরামর্শ: what one rider delivers a day (per hub), each route's average parcels, riders needed and route suggestions. */
export function LoadTab({ zone, o, hub, canEdit, onSaved, onOpen }: {
  zone: string; o: ZoneOverview; hub: string; canEdit: (hub: string) => boolean; onSaved: () => void; onOpen: (routeId: string) => void
}) {
  const { L, n } = usePrefs()
  const [days, setDays] = useState(30)
  const d = useLoad(() => loadApi.overview(zone, days), [zone, days])
  const plans = useMemo(() => d.data ? planLoad(o, d.data).filter(p => !hub || p.hub.id === hub) : [], [o, d.data, hub])
  const hire = plans.reduce((t, p) => t + p.hire, 0)
  const over = plans.reduce((t, p) => t + p.routes.filter(r => r.state === 'over' || r.state === 'norider').length, 0)
  const under = plans.reduce((t, p) => t + p.routes.filter(r => r.state === 'under').length, 0)
  const unset = plans.filter(p => !p.capacity).length

  return <>
    <section className="panel">
      <div className="da-bar"><h2>{L('পার্সেলের চাপ ও পরামর্শ', 'Parcel load & suggestions')}</h2>
        <Field label={L('হিসাবের সময়কাল', 'Accounts period')}><select value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 15, 30, 60, 90].map(x => <option key={x} value={x}>{L(`শেষ ${n(x)} দিন`, `Last ${x} days`)}</option>)}</select></Field></div>
      <p className="rt-hint">{L(`প্রতি হাবে লিখুন একজন রাইডার দিনে গড়ে কয়টা পার্সেল ডেলিভারি করেন, আর প্রতিটা রুটে দিনে গড়ে কয়টা পার্সেল আসে। হাবের প্রতিদিনের হিসাব অন্তত ${n(LOAD_MIN_DAYS)} দিন জমা হলে রুটের সংখ্যা হিসাব থেকেই নেওয়া হয় (রুটের রাইডাররা দিনে যা ডেলিভারি দিয়েছেন); তার আগে আপনার লেখা গড় ধরা হয়। সিস্টেম শুধু পরামর্শ দেয়, নিজে কিছু বদলায় না।`,
        `Per hub, type how many parcels one rider delivers a day; per route, its average parcels a day. Once a hub has ${LOAD_MIN_DAYS} sent daily accounts in the period the route figure comes from the accounts; before that your typed average is used. Suggestions only: nothing is changed by itself.`)}</p>
      {d.error ? <p className="da-error">{routeFriendly(d.error)}</p> : null}
      {d.loading && !d.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : <div className="da-stats">
        <Stat icon="users" label={L('নতুন রাইডার লাগবে', 'New riders needed')} value={n(hire)} tone={hire ? 'warn' : 'ok'} />
        <Stat icon="alert" label={L('চাপ বেশি এমন রুট', 'Overloaded routes')} value={n(over)} tone={over ? 'warn' : 'ok'} />
        <Stat icon="chart" label={L('পার্সেল কম এমন রুট', 'Light routes')} value={n(under)} />
        <Stat icon="gear" label={L('রাইডারের গড় বসানো হয়নি', 'Hubs without rider average')} value={n(unset)} tone={unset ? 'warn' : 'ok'} />
      </div>}
    </section>
    {plans.map(p => <HubLoadCard key={p.hub.id} p={p} canEdit={canEdit(p.hub.id)} onOpen={onOpen} onSaved={() => { void d.reload(); onSaved() }} />)}
    {d.data && !plans.length && <section className="panel"><p className="muted">{L('কোনো হাব নেই', 'No hubs')}</p></section>}
  </>
}

function HubLoadCard({ p, canEdit, onSaved, onOpen }: { p: HubPlan; canEdit: boolean; onSaved: () => void; onOpen: (routeId: string) => void }) {
  const { L, n } = usePrefs()
  const [cap, setCap] = useState(p.capacity === null ? '' : String(p.capacity))
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { setCap(p.capacity === null ? '' : String(p.capacity)); setTyped(Object.fromEntries(p.routes.map(r => [r.route.id, r.typed === null ? '' : String(r.typed)]))) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.capacity, p.routes.map(r => `${r.route.id}:${r.typed}`).join(',')])
  const dirty = cap !== (p.capacity === null ? '' : String(p.capacity)) || p.routes.some(r => (typed[r.route.id] ?? '') !== (r.typed === null ? '' : String(r.typed)))
  const num = (v: string) => v.trim() === '' ? null : Math.round(Number(v))
  async function save() {
    const c = num(cap)
    if (c !== null && (!isFinite(c) || c < 1 || c > 1000)) return setErr(L('রাইডারের গড় ১ থেকে ১০০০-এর মধ্যে দিন', 'Parcels per rider: 1 to 1000'))
    const routes = p.routes.map(r => ({ id: r.route.id, avg_parcels: num(typed[r.route.id] ?? '') }))
    if (routes.some(r => r.avg_parcels !== null && (!isFinite(r.avg_parcels) || r.avg_parcels < 0 || r.avg_parcels > 100000))) return setErr(L('রুটের গড় পার্সেল ঠিক করে লিখুন', 'Check the route averages'))
    setBusy(true); setErr('')
    try { await loadApi.save(p.hub.id, { rider_parcels: c, routes }); onSaved() } catch (e) { setErr(routeFriendly(e)) } finally { setBusy(false) }
  }
  const tip = (t: RouteTip) => t.kind === 'type' ? L('গড় পার্সেল লিখুন', 'Type the average parcels')
    : t.kind === 'norider' ? L(`রাইডার নেই — ${n(t.n)} জন রাইডার দিন`, `No rider: give ${t.n}`)
    : t.kind === 'more' ? L(`আরও ${n(t.n)} জন রাইডার দিন`, `Give ${t.n} more rider(s)`)
    : t.kind === 'move' ? L(`কিছু স্টপ "${t.to}" রুটে সরান (ওখানে পার্সেল কম)`, `Move some stops to "${t.to}" (it is light)`)
    : t.kind === 'split' ? L('রুটটা দুই ভাগ করুন', 'Split the route in two')
    : t.kind === 'merge' ? L(`"${t.withName}" রুটের সাথে এক করা যায় (দুটো মিলেও একজন রাইডারের কাজ)`, `Can be joined with "${t.withName}" (together still one rider's work)`)
    : L('একজন রাইডার অন্য রুটে দেওয়া যায়', 'One rider can go to another route')
  const hubTips: Array<{ tone: 'bad' | 'warn' | 'ok'; text: string }> = []
  if (!p.capacity) hubTips.push({ tone: 'warn', text: L('এই হাবে একজন রাইডার দিনে গড়ে কয়টা পার্সেল ডেলিভারি করেন তা লিখুন — তাহলে পরামর্শ আসবে।', 'Type how many parcels one rider delivers a day at this hub to get suggestions.') })
  else if (p.parcels === null) hubTips.push({ tone: 'warn', text: L('রুটের গড় পার্সেল লিখুন, অথবা হাবের প্রতিদিনের হিসাব জমা হতে দিন।', 'Type the route averages, or wait for the daily accounts.') })
  else {
    if (p.hire > 0) hubTips.push({ tone: 'bad', text: L(`দিনে গড়ে ${n(p.parcels)}টা পার্সেল, একজন রাইডার ${n(p.capacity)}টা — লাগবে ${n(p.need ?? 0)} জন, আছেন ${n(p.riders)} জন। নতুন ${n(p.hire)} জন রাইডার নিয়োগ দিন।`,
      `${p.parcels} parcels a day at ${p.capacity} per rider: ${p.need} riders needed, ${p.riders} here. Hire ${p.hire} more.`) })
    else hubTips.push({ tone: 'ok', text: L(`দিনে গড়ে ${n(p.parcels)}টা পার্সেল, লাগবে ${n(p.need ?? 0)} জন রাইডার, আছেন ${n(p.riders)} জন — নতুন নিয়োগ লাগবে না।`,
      `${p.parcels} parcels a day: ${p.need} riders needed, ${p.riders} here. No hiring needed.`) })
    const short = p.routes.reduce((t, r) => t + (r.need !== null ? Math.max(0, r.need - r.have) : 0), 0)
    if (short > 0 && p.freeRiders > 0) hubTips.push({ tone: 'warn', text: L(`${n(p.freeRiders)} জন রাইডার কোনো রুটে নেই — চাপ বেশি এমন রুটে আগে তাঁদের দিন।`, `${p.freeRiders} rider(s) have no route: give them to the overloaded routes first.`) })
  }
  const max = Math.max(p.capacity ?? 0, ...p.routes.map(r => r.perRider ?? 0), 1) * 1.1
  const tone = (r: RoutePlan) => r.state === 'over' || r.state === 'norider' ? '#dc2626' : r.state === 'under' ? '#ca8a04' : '#15803D'

  return <section className="panel">
    <div className="da-bar"><h2>{p.hub.name}</h2>
      {p.source === 'accounts' ? <Badge tone="ok">{L(`হিসাব থেকে · ${n(p.days)} দিন`, `From accounts · ${p.days} days`)}</Badge>
        : <Badge tone="info">{p.source === 'typed' ? L('আপনার লেখা গড় থেকে', 'From typed averages') : L('ডাটা নেই', 'No data')}{p.days > 0 ? L(` · হিসাব ${n(p.days)} দিন`, ` · ${p.days} account day(s)`) : ''}</Badge>}</div>
    <div style={{ maxWidth: 280 }}>
      <Field label={L('একজন রাইডার দিনে গড়ে ডেলিভারি', 'One rider delivers a day')} hint={L('এই হাবের জন্য', 'For this hub')}>
        <input type="number" inputMode="numeric" min={1} max={1000} disabled={!canEdit} value={cap} onChange={e => setCap(e.target.value)} placeholder={L('যেমন ৬০', 'e.g. 60')} /></Field>
    </div>
    <div className="da-stats" style={{ marginTop: 10 }}>
        <Stat icon="chart" label={L('হাবে দিনে গড় পার্সেল', 'Hub parcels a day')} value={p.parcels === null ? '—' : n(p.parcels)} />
        <Stat icon="users" label={L('রাইডার আছেন / লাগবে', 'Riders here / needed')} value={`${n(p.riders)} / ${p.need === null ? '—' : n(p.need)}`} tone={p.hire ? 'warn' : undefined} />
        <Stat icon="truck" label={L('রুটে রাইডারপ্রতি গড়', 'Average per rider on routes')} value={p.avgPerRider === null ? '—' : n(p.avgPerRider)} />
    </div>
    <ul className="rt-warn" style={{ padding: 0, margin: '10px 0' }}>{hubTips.map((t, i) => <li key={i} className={t.tone === 'ok' ? '' : t.tone}>{t.text}</li>)}</ul>
    {!p.routes.length ? <p className="muted small">{L('এই হাবে এখনো কোনো রুট নেই।', 'No routes at this hub yet.')}</p> :
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('রুট', 'Route')}</th><th>{L('গড় পার্সেল (লেখা)', 'Average parcels (typed)')}</th><th>{L('হিসাব থেকে', 'From accounts')}</th>
          <th>{L('রাইডার আছেন / লাগবে', 'Riders / needed')}</th><th>{L('রাইডারপ্রতি', 'Per rider')}</th><th>{L('পরামর্শ', 'Suggestion')}</th></tr></thead>
        <tbody>{p.routes.map(r => <tr key={r.route.id}>
          <td data-label={L('রুট', 'Route')}><button type="button" className="linkish" onClick={() => onOpen(r.route.id)}>{r.route.code} · {r.route.name}</button></td>
          <td data-label={L('গড় পার্সেল (লেখা)', 'Average parcels (typed)')}><input type="number" inputMode="numeric" min={0} style={{ width: 96 }} disabled={!canEdit} aria-label={L(`${r.route.name}: গড় পার্সেল`, `${r.route.name}: average parcels`)}
            value={typed[r.route.id] ?? ''} onChange={e => setTyped({ ...typed, [r.route.id]: e.target.value })} /></td>
          <td data-label={L('হিসাব থেকে', 'From accounts')}>{r.actual === null ? '—' : n(r.actual)}</td>
          <td data-label={L('রাইডার আছেন / লাগবে', 'Riders / needed')}>{n(r.have)} / {r.need === null ? '—' : n(r.need)}</td>
          <td data-label={L('রাইডারপ্রতি', 'Per rider')}><div style={{ minWidth: 110 }}>{r.perRider === null ? '—' : <><b>{n(r.perRider)}</b>
            <div className="rt-prog"><span style={{ width: `${Math.min(100, (r.perRider / max) * 100)}%`, background: tone(r) }} /></div></>}</div></td>
          <td className="small" data-label={L('পরামর্শ', 'Suggestion')}><div>{r.tips.length ? r.tips.map((t, i) => <div key={i} style={{ color: t.kind === 'type' ? 'var(--muted)' : tone(r) }}>{tip(t)}</div>)
            : r.state === 'ok' ? <span style={{ color: '#15803D' }}>{L('ঠিক আছে', 'Fine')}</span> : '—'}</div></td>
        </tr>)}</tbody>
      </table></div>}
    {err && <p className="da-error">{err}</p>}
    {canEdit && <div className="rt-bar"><button disabled={busy || !dirty} onClick={() => void save()}><Icon name="save" size={15} />{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ', 'Save')}</button></div>}
  </section>
}
