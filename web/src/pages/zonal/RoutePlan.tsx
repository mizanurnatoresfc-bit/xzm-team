import { askReason } from '../../components/ask'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { MorningBanner } from '../workforce/Morning'
import {
  capacityOf, capacityToday, doesPickup, isHere, nearbyRouteRoadKm, planApi, planFriendly, spreadRoutes, suggestPlan,
  type CapSource, type MyParcels, type PlanFile, type PlanFiles, type PickupMode, type PlanData, type PlanHub, type PlanPart, type PlanPerson, type PlanRules, type PlanSave, type PlanStatus, type PlanTip, type StaffSetup,
} from '../../lib/routePlan'

const dhaka = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const int = (v: string) => (v.trim() === '' || !isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))))
const txt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
type Row = { kind: 'rider' | 'helper'; present: boolean | null; pickups: string; parcels: string; detail: PlanPart[]; capacity: number | null }
type Form = { arrived: string; carried: string; sent: string; cancelled: string; pickups: string; note: string; routes: Record<string, string>; rows: Record<string, Row>; unassigned: number; src: Record<string, string> }
const NUMS = ['arrived', 'carried', 'sent', 'cancelled', 'pickups'] as const

const STATUS: Record<PlanStatus, { bn: string; en: string; tone: 'ok' | 'warn' | 'info' }> = {
  draft: { bn: 'খসড়া', en: 'Draft', tone: 'info' }, sent: { bn: 'অনুমোদনের অপেক্ষায়', en: 'Waiting for approval', tone: 'warn' }, approved: { bn: 'অনুমোদিত', en: 'Approved', tone: 'ok' },
}

/** The form of a hub and date: what is saved, else empty with the people who normally deliver. */
function startForm(d: PlanData): Form {
  const p = d.plan
  const rows: Record<string, Row> = {}
  for (const x of d.people) {
    const line = p?.lines.find(l => l.employee_id === x.id)
    if (line) rows[x.id] = { kind: line.kind, present: line.present, pickups: line.pickups ? String(line.pickups) : '', parcels: String(line.parcels), detail: line.detail ?? [], capacity: line.capacity }
    else if (x.active && (x.rider || x.helper || x.routes.length)) rows[x.id] = { kind: x.rider || x.routes.length ? 'rider' : 'helper', present: null, pickups: '', parcels: '', detail: [], capacity: null }
  }
  return { arrived: txt(p?.arrived), carried: txt(p?.carried), sent: txt(p?.sent), cancelled: txt(p?.cancelled), pickups: txt(p?.pickups), note: p?.note ?? '',
    routes: Object.fromEntries(d.routes.map(r => [r.id, txt(p?.route_parcels?.[r.id])])), rows, unassigned: p?.unassigned ?? 0, src: { ...(p?.source ?? {}) } }
}

/** রুট → আজকের পার্সেল পরিকল্পনা: the hub's numbers of the day, who is here, and who takes how many parcels on which route. */
export function PlanTab({ zone, hub: hubProp, onHub }: { zone?: string; hub?: string; onHub?: (hub: string) => void }) {
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const [date, setDate] = useState(dhaka())
  const hubs = useLoad(() => planApi.hubs(date), [date])
  const list = useMemo(() => (hubs.data ?? []).filter(h => !zone || h.zone_id === zone), [hubs.data, zone])
  const [own, setOwn] = useState('')
  const hub = (hubProp !== undefined ? hubProp : own) || (list.length === 1 ? list[0].id : '')
  const pick = (id: string) => { if (onHub) onHub(id); else setOwn(id) }

  if (hubs.error) return <p className="da-error">{planFriendly(hubs.error)}</p>
  if (hubs.data && !list.length) return <section className="panel"><p className="muted">{L('পার্সেল পরিকল্পনা দেখার অনুমতি কোনো হাবে নেই।', 'You may not see the parcel plan of any hub.')}</p></section>
  return <>
    {node}
    <section className="da-filters panel no-print">
      <Field label={L('তারিখ', 'Date')}><input type="date" value={date} max={dhaka(new Date(Date.now() + 864e5))} onChange={e => e.target.value && setDate(e.target.value)} /></Field>
      {hubProp === undefined && list.length > 1 && <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => pick(e.target.value)}>
        <option value="">{L('সব হাব', 'All hubs')}</option>{list.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
      {hub && list.length > 1 && <button className="secondary" onClick={() => pick('')}><Icon name="table" size={14} />{L('সব হাবের অবস্থা', 'All hubs')}</button>}
    </section>
    {!hub ? <HubList list={list} date={date} loading={hubs.loading} onOpen={pick} />
      : <HubPlan key={`${hub}:${date}`} hub={hub} date={date} toast={toast} onChanged={() => void hubs.reload()} />}
  </>
}

function HubList({ list, date, loading, onOpen }: { list: PlanHub[]; date: string; loading: boolean; onOpen: (hub: string) => void }) {
  const { L, n } = usePrefs()
  const made = list.filter(h => h.plan), waiting = list.filter(h => h.plan?.status === 'sent').length, ok = list.filter(h => h.plan?.status === 'approved').length
  const todo = (h: PlanHub) => h.plan ? (h.plan.arrived ?? 0) + (h.plan.carried ?? 0) - (h.plan.sent ?? 0) - (h.plan.cancelled ?? 0) : null
  return <>
    <div className="da-stats">
      <Stat icon="hub" label={L('হাব', 'Hubs')} value={n(list.length)} />
      <Stat icon="form" label={L('পরিকল্পনা হয়েছে', 'Plans made')} value={`${n(made.length)}/${n(list.length)}`} tone={made.length < list.length ? 'warn' : 'ok'} />
      <Stat icon="alert" label={L('অনুমোদনের অপেক্ষায়', 'Waiting for approval')} value={n(waiting)} tone={waiting ? 'warn' : undefined} />
      <Stat icon="checkall" label={L('অনুমোদিত', 'Approved')} value={n(ok)} />
      <Stat icon="box" label={L('কেউ নিতে পারেনি', 'Nobody could take')} value={n(made.reduce((t, h) => t + (h.plan?.unassigned ?? 0), 0))} tone={made.some(h => h.plan!.unassigned > 0) ? 'warn' : undefined} />
    </div>
    <section className="panel"><div className="da-bar"><h2>{L('হাব অনুযায়ী পরিকল্পনা', 'Plans by hub')} · {date}</h2>{loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}</div>
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('হাব', 'Hub')}</th><th>{L('অবস্থা', 'Status')}</th><th>{L('ডেলিভারি দিতে হবে', 'To deliver')}</th><th>{L('দেওয়া হয়েছে', 'Given')}</th>
          <th>{L('কতজনকে', 'People')}</th><th>{L('পিকআপ', 'Pickups')}</th><th>{L('বাকি', 'Left')}</th><th /></tr></thead>
        <tbody>{list.map(h => <tr key={h.id}>
          <td data-label={L('হাব', 'Hub')}><button type="button" className="linkish" onClick={() => onOpen(h.id)}>{h.name}</button></td>
          <td data-label={L('অবস্থা', 'Status')}>{h.plan ? <Badge tone={STATUS[h.plan.status].tone}>{L(STATUS[h.plan.status].bn, STATUS[h.plan.status].en)}</Badge> : <Badge>{L('হয়নি', 'Not made')}</Badge>}</td>
          <td data-label={L('ডেলিভারি দিতে হবে', 'To deliver')}>{todo(h) === null ? '—' : n(todo(h)!)}</td>
          <td data-label={L('দেওয়া হয়েছে', 'Given')}>{h.plan ? n(h.plan.given) : '—'}</td>
          <td data-label={L('কতজনকে', 'People')}>{h.plan ? n(h.plan.people) : '—'}</td>
          <td data-label={L('পিকআপ', 'Pickups')}>{h.plan?.pickups === null || !h.plan ? '—' : n(h.plan.pickups)}</td>
          <td data-label={L('বাকি', 'Left')}>{h.plan ? <b style={{ color: h.plan.unassigned ? '#dc2626' : undefined }}>{n(h.plan.unassigned)}</b> : '—'}</td>
          <td><button className="secondary sm" onClick={() => onOpen(h.id)}>{L('খুলুন', 'Open')}</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </>
}

function HubPlan({ hub, date, toast, onChanged }: { hub: string; date: string; toast: (m: string) => void; onChanged: () => void }) {
  const { L, n } = usePrefs()
  const d = useLoad(() => planApi.get(hub, date), [hub, date])
  const files = useLoad(() => planApi.files(hub, date), [hub, date])
  const [f, setF] = useState<Form | null>(null)
  const [tips, setTips] = useState<PlanTip[]>([])
  const [road, setRoad] = useState<{ plan: PlanData; km: Awaited<ReturnType<typeof nearbyRouteRoadKm>> } | null>(null)
  const [roadBusy, setRoadBusy] = useState(false)
  const [roadError, setRoadError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [setup, setSetup] = useState(false); const [add, setAdd] = useState('')
  useEffect(() => { if (d.data) { setF(startForm(d.data)); setTips([]); setDirty(false) } }, [d.data])
  const data = d.data
  if (d.error) return <p className="da-error">{planFriendly(d.error)}</p>
  if (!data || !f) return <section className="panel"><p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p></section>

  const plan = data.plan
  const locked = plan?.status === 'approved'
  const canWrite = !locked && (plan ? data.can.edit : data.can.create)
  const change = (x: Partial<Form>) => { setF({ ...f, ...x }); setDirty(true) }
  /** A hub number typed by hand (or taken from another page): its source is "manual" again. */
  const typed = (k: typeof NUMS[number], v: string) => change({ [k]: v, src: { ...f.src, [k]: 'manual' } })
  const listed = new Map<string, { parcels: number; delivered: number }>()
  for (const x of files.data?.files ?? []) if (x.kind === 'update_list' && x.employee_id) {
    const t = listed.get(x.employee_id) ?? { parcels: 0, delivered: 0 }
    listed.set(x.employee_id, { parcels: t.parcels + (x.counts.parcels ?? 0), delivered: t.delivered + (x.counts.delivered ?? 0) })
  }
  const row = (id: string, x: Partial<Row>) => change({ rows: { ...f.rows, [id]: { ...f.rows[id], ...x } } })
  const todo = int(f.arrived) === null && int(f.carried) === null ? null : (int(f.arrived) ?? 0) + (int(f.carried) ?? 0) - (int(f.sent) ?? 0) - (int(f.cancelled) ?? 0)
  const onRoutes = data.routes.reduce((t, r) => t + (int(f.routes[r.id] ?? '') ?? 0), 0)
  const people = data.people.filter(p => f.rows[p.id])
  const given = people.reduce((t, p) => t + (int(f.rows[p.id].parcels) ?? 0), 0)
  const here = people.filter(p => isHere(p, f.rows[p.id].present))
  const away = people.filter(p => !isHere(p, f.rows[p.id].present) && (p.rider || p.routes.length > 0))
  const left = todo === null ? null : Math.max(0, todo - given)
  const routeName = (id?: string | null) => { const r = data.routes.find(x => x.id === id); return r ? r.code : L('রুট ছাড়া', 'No route') }
  const who = (id?: string | null) => data.people.find(p => p.id === id)?.name ?? ''

  const roadKm = road?.plan === data ? road.km : undefined
  async function loadDistances() {
    if (!data || roadBusy) return
    setRoadBusy(true); setRoadError('')
    try {
      const km = await nearbyRouteRoadKm(data.routes)
      if (Object.keys(km).length < 2) {
        setRoadError(L('সড়ক দূরত্বের জন্য অন্তত দুই রুটে লোকেশন দিন।', 'Add a stop location to at least two routes.'))
        return
      }
      setRoad({ plan: data, km })
    } catch {
      setRoadError(L('সড়ক দূরত্ব আনা যায়নি। আবার চেষ্টা করুন।', 'Could not load road distances. Try again.'))
    } finally { setRoadBusy(false) }
  }

  function suggest() {
    if (todo === null || todo <= 0) return setErr(L('আগে লিখুন আজ হাবে কয়টা পার্সেল এসেছে।', 'First type how many parcels reached the hub today.'))
    setErr('')
    let routes = Object.fromEntries(data!.routes.map(r => [r.id, int(f!.routes[r.id] ?? '') ?? 0]))
    if (!Object.values(routes).some(x => x > 0)) routes = { ...routes, ...spreadRoutes(data!, todo) }
    const pickers = people.filter(p => doesPickup(p, data!.load) && isHere(p, f!.rows[p.id].present))
    const typedPick = people.some(p => (int(f!.rows[p.id].pickups) ?? 0) > 0)
    const each = !typedPick && pickers.length ? (int(f!.pickups) ?? 0) / pickers.length : 0
    const pickups = Object.fromEntries(people.map(p => [p.id, typedPick ? int(f!.rows[p.id].pickups) ?? 0 : pickers.includes(p) ? Math.round(each) : 0]))
    const s = suggestPlan(data!, { toDeliver: todo, routeParcels: routes, present: Object.fromEntries(people.map(p => [p.id, f!.rows[p.id].present])), pickups, extra: people.map(p => p.id), roadKm })
    const rows = { ...f!.rows }
    for (const p of people) { const r = s.rows[p.id]; if (r) rows[p.id] = { ...rows[p.id], kind: r.kind, parcels: String(r.parcels), detail: r.detail, capacity: r.capacity, pickups: pickups[p.id] ? String(pickups[p.id]) : '' } }
    setF({ ...f!, rows, routes: Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, v ? String(v) : ''])), unassigned: s.unassigned })
    setTips(s.tips); setDirty(true)
  }

  const body = (): PlanSave => ({
    arrived: int(f.arrived), carried: int(f.carried), sent: int(f.sent), cancelled: int(f.cancelled), pickups: int(f.pickups), note: f.note.trim() || null,
    source: Object.fromEntries(NUMS.filter(k => int(f[k]) !== null).map(k => [k, f.src[k] ?? 'manual'])),
    route_parcels: Object.fromEntries(data.routes.filter(r => int(f.routes[r.id] ?? '') !== null).map(r => [r.id, int(f.routes[r.id])!])),
    unassigned: left ?? 0,
    people: people.map(p => { const r = f.rows[p.id]; const parcels = int(r.parcels) ?? 0
      return { employee_id: p.id, kind: r.kind, present: r.present, capacity: r.capacity, parcels, pickups: int(r.pickups) ?? 0,
        detail: r.detail.reduce((t, x) => t + x.parcels, 0) === parcels ? r.detail.map(x => ({ route_id: x.route_id ?? null, parcels: x.parcels, for: x.for ?? null })) : [] } }),
  })
  async function run(what: () => Promise<unknown>, done: string) {
    setBusy(true); setErr('')
    try { await what(); toast(done); await d.reload(); onChanged() } catch (e) { setErr(planFriendly(e)) } finally { setBusy(false) }
  }
  const ask = async (q: string) => (await askReason(q)) ?? ''
  const rest = (t: Extract<PlanTip, { kind: 'cover' }>) => t.parcels - t.to.reduce((a, x) => a + x.parcels, 0)
  const tipText = (t: PlanTip) => t.kind === 'cover'
      ? L(`${t.absent} নেই — তাঁর ${n(t.parcels)}টা পার্সেল: ${t.to.length ? t.to.map(x => `${x.name} ${n(x.parcels)}টা (${HOW[x.how].bn})`).join(', ') : 'কেউ নিতে পারছেন না'}${t.to.length && rest(t) > 0 ? `; বাকি ${n(rest(t))}টা কেউ নিতে পারছেন না` : ''}`,
          `${t.absent} is away — ${t.parcels} parcels: ${t.to.length ? t.to.map(x => `${x.name} ${x.parcels} (${HOW[x.how].en})`).join(', ') : 'nobody can take them'}${t.to.length && rest(t) > 0 ? `; ${rest(t)} left with nobody` : ''}`)
    : t.kind === 'unassigned' ? L(`${n(t.parcels)}টা পার্সেল আজ কেউ নিতে পারছেন না${t.riders ? ` — আরও ${n(t.riders)} জন রাইডার লাগত` : ''}। এগুলো কালকের "আগের বাকি"-তে যাবে।`,
          `${t.parcels} parcels cannot be taken today${t.riders ? ` — ${t.riders} more rider(s) were needed` : ''}. They carry over to tomorrow.`)
    : t.kind === 'nocap' ? L(`${t.names.join(', ')} — দিনে কয়টা পারেন জানা নেই। সেটআপে নির্দিষ্ট সংখ্যা দিন, অথবা হাবের রাইডার গড় বসান।`, `${t.names.join(', ')}: no number for a day yet. Give a fixed number in set-up, or the hub's rider average.`)
    : t.kind === 'unknown' ? L(`${t.names.join(', ')} — আজকের হাজিরা এখনো নেই, তাই উপস্থিত ধরা হয়েছে। না এলে "নেই" করে আবার পরামর্শ নিন।`, `${t.names.join(', ')}: no attendance yet, counted as here. Mark "away" and suggest again if not.`)
    : t.kind === 'noroute' ? L(`${n(t.parcels)}টা পার্সেল কোনো রুটে ধরা হয়নি — যাঁদের জায়গা আছে তাঁদের দেওয়া হয়েছে।`, `${t.parcels} parcels are on no route: given to whoever has room.`)
    : L(`"${t.route}" রুটে কোনো রাইডার নেই — পাশের রাইডারদের দেওয়া হয়েছে।`, `Route "${t.route}" has no rider: given to neighbours.`)
  const outside = data.people.filter(p => p.active && !f.rows[p.id])

  return <>
    <MorningBanner hub={hub} date={date} canResend={data.can.approve} planId={plan?.id} onChanged={() => void d.reload()} />
    <section className="panel">
      <div className="da-bar"><h2>{data.hub.name} · {date}</h2>
        {plan ? <Badge tone={STATUS[plan.status].tone}>{L(STATUS[plan.status].bn, STATUS[plan.status].en)}</Badge> : <Badge>{L('এখনো পরিকল্পনা হয়নি', 'No plan yet')}</Badge>}
        {(data.can.configure || data.can.rules) && <button className="secondary sm" onClick={() => setSetup(true)}><Icon name="gear" size={14} />{L('সেটআপ', 'Set-up')}</button>}</div>
      {plan?.decide_note && plan.status !== 'approved' && <p className="da-error">{L('জোনাল ম্যানেজারের নোট', 'Note from the approver')}: {plan.decide_note}{plan.decided_by_name ? ` — ${plan.decided_by_name}` : ''}</p>}
      {plan?.status === 'approved' && <p className="rt-hint">{L(`অনুমোদন করেছেন ${plan.decided_by_name ?? ''}। বদলাতে হলে আগে "আবার খুলুন"।`, `Approved by ${plan.decided_by_name ?? ''}. Reopen it to change.`)}</p>}
      <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <Field label={L('আজ হাবে এসেছে', 'Arrived at the hub today')} hint={data.hints.ops_parcels !== null && f.arrived === '' ? <Hint v={data.hints.ops_parcels} label={L('হাব অপারেশন রিপোর্টে', 'Hub operation report')} on={canWrite ? v => typed('arrived', String(v)) : undefined} /> : undefined}>
          <input type="number" inputMode="numeric" min={0} disabled={!canWrite} value={f.arrived} onChange={e => typed('arrived', e.target.value)} /></Field>
        <Field label={L('আগের বাকি', 'Left from before')} hint={f.carried === '' && (data.hints.unassigned_before ?? data.hints.left_before) !== null ? <Hint v={(data.hints.unassigned_before ?? data.hints.left_before)!} label={L('আগের দিনের বাকি', 'Left the day before')} on={canWrite ? v => typed('carried', String(v)) : undefined} /> : undefined}>
          <input type="number" inputMode="numeric" min={0} disabled={!canWrite} value={f.carried} onChange={e => typed('carried', e.target.value)} /></Field>
        <Field label={L('অন্য হাবে / ফেরত পাঠানো', 'Sent on / back')}><input type="number" inputMode="numeric" min={0} disabled={!canWrite} value={f.sent} onChange={e => typed('sent', e.target.value)} /></Field>
        <Field label={L('ক্যান্সেল', 'Cancelled')}><input type="number" inputMode="numeric" min={0} disabled={!canWrite} value={f.cancelled} onChange={e => typed('cancelled', e.target.value)} /></Field>
        <Field label={L('আজ পিকআপ', 'Pickups today')} hint={data.hints.ops_pickups !== null && f.pickups === '' ? <Hint v={data.hints.ops_pickups} label={L('হাব অপারেশন রিপোর্টে', 'Hub operation report')} on={canWrite ? v => typed('pickups', String(v)) : undefined} /> : undefined}>
          <input type="number" inputMode="numeric" min={0} disabled={!canWrite} value={f.pickups} onChange={e => typed('pickups', e.target.value)} /></Field>
      </div>
      <div className="da-stats" style={{ marginTop: 12 }}>
        <Stat icon="box" label={L('আজ ডেলিভারি দিতে হবে', 'To deliver today')} value={todo === null ? '—' : n(Math.max(0, todo))} sub={L('এসেছে + আগের বাকি − পাঠানো − ক্যান্সেল', 'arrived + left − sent − cancelled')} />
        <Stat icon="users" label={L('উপস্থিত / মোট', 'Here / all')} value={`${n(here.length)}/${n(people.length)}`} tone={away.length ? 'warn' : 'ok'} sub={away.slice(0, 3).map(p => p.name).join(', ') || undefined} />
        <Stat icon="truck" label={L('দেওয়া হয়েছে', 'Given')} value={n(given)} />
        <Stat icon="alert" label={L('কেউ নেয়নি (বাকি)', 'Nobody took (left)')} value={left === null ? '—' : n(left)} tone={left ? 'bad' : left === 0 ? 'ok' : undefined} />
      </div>
    </section>

    <FilesPanel hub={hub} date={date} data={data} files={files.data} error={files.error} canWrite={canWrite} reload={() => void files.reload()} toast={toast}
      onNumbers={x => change({ ...x, src: { ...f.src, ...Object.fromEntries(Object.keys(x).map(k => [k, 'pdf'])) } })}
      onRiders={() => { const rows = { ...f.rows }
        for (const [id, t] of listed) { const p = data.people.find(y => y.id === id); if (!p) continue
          rows[id] = { ...(rows[id] ?? { kind: p.rider || p.routes.length ? 'rider' : 'helper', present: null, pickups: '', capacity: null }), parcels: String(t.parcels), detail: [] } }
        change({ rows }) }} />

    {data.routes.length > 0 && <section className="panel">
      <div className="da-bar"><h2>{L('রুট অনুযায়ী আজকের পার্সেল', "Today's parcels by route")}</h2>
        {canWrite && todo !== null && todo > 0 && <button className="secondary sm" onClick={() => change({ routes: Object.fromEntries(Object.entries(spreadRoutes(data, todo)).map(([k, v]) => [k, String(v)])) })}>
          <Icon name="chart" size={14} />{L('গড় অনুযায়ী ভাগ করুন', 'Spread by the averages')}</button>}</div>
      <p className="rt-hint">{L('প্রতিটা রুটে আজ কয়টা পার্সেল যাবে লিখুন। ফাঁকা রাখলে পরামর্শের সময় রুটের গড় অনুযায়ী ভাগ হয়।', 'Type how many parcels go on each route today. Left empty, the suggestion spreads them by the route averages.')}</p>
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('রুট', 'Route')}</th><th>{L('স্টপ', 'Stops')}</th><th>{L('রাইডার', 'Riders')}</th><th>{L('গড় পার্সেল', 'Average')}</th><th>{L('আজ', 'Today')}</th></tr></thead>
        <tbody>{data.routes.map(r => {
          const planned = int(f.routes[r.id] ?? '')
          const aboveAverage = planned !== null && r.avg_parcels !== null ? Math.max(0, planned - r.avg_parcels) : 0
          return <tr key={r.id}>
          <td data-label={L('রুট', 'Route')}><b>{r.code}</b> · {r.name}</td>
          <td data-label={L('স্টপ', 'Stops')}>{n(r.stops.length)}</td>
          <td data-label={L('রাইডার', 'Riders')}>{r.riders.length ? r.riders.map(x => { const p = data.people.find(y => y.id === x.employee_id); const off = p && f.rows[p.id] && !isHere(p, f.rows[p.id].present)
            return <span key={x.employee_id} style={{ marginRight: 8, color: off ? '#dc2626' : undefined, textDecoration: off ? 'line-through' : undefined }}>{x.name}</span> }) : <span className="muted">{L('নেই', 'None')}</span>}</td>
          <td data-label={L('গড় পার্সেল', 'Average')}>{r.avg_parcels === null ? '—' : n(r.avg_parcels)}</td>
          <td data-label={L('আজ', 'Today')}><input type="number" inputMode="numeric" min={0} style={{ width: 96 }} disabled={!canWrite} aria-label={L(`${r.name}: আজকের পার্সেল`, `${r.name}: parcels today`)}
            value={f.routes[r.id] ?? ''} onChange={e => change({ routes: { ...f.routes, [r.id]: e.target.value } })} />
            {aboveAverage > 0 && <div><Badge tone="warn">{L(`গড়ের চেয়ে ${n(aboveAverage)} বেশি`, `${aboveAverage} above average`)}</Badge></div>}
          </td>
        </tr> })}</tbody>
        <tfoot><tr><td colSpan={4}>{L('রুটে মোট', 'On routes')}</td><td><b style={{ color: todo !== null && onRoutes > todo ? '#dc2626' : undefined }}>{n(onRoutes)}</b>{todo !== null ? ` / ${n(Math.max(0, todo))}` : ''}</td></tr></tfoot>
      </table></div>
    </section>}

    <section className="panel">
      <div className="da-bar"><h2>{L('কে কয়টা নেবেন', 'Who takes how many')}</h2>
        {canWrite && <>
          <button type="button" className="secondary" disabled={roadBusy} onClick={() => { if (roadKm) setRoad(null); else void loadDistances() }}>
            {roadBusy ? L('সড়ক দূরত্ব আনা হচ্ছে…', 'Loading road distances…') : roadKm ? L('সড়ক দূরত্ব বন্ধ', 'Turn off road distances') : L('সড়ক দূরত্ব আনুন', 'Load road distances')}
          </button>
          <button onClick={suggest} disabled={roadBusy}><Icon name="chart" size={15} />{roadKm ? L('সড়ক দূরত্ব ধরে পরামর্শ বসান', 'Fill road-distance suggestion') : L('পরামর্শ বসান', 'Fill the suggestion')}</button>
        </>}</div>
      {roadError && <p className="da-error" role="alert">{roadError}</p>}
      {roadKm && <p className="rt-hint">{L('পাশের রুট বাছাইয়ে প্রতিটি রুটের প্রথম লোকেশনযুক্ত স্টপের মধ্যকার সড়ক দূরত্ব ধরা হবে। যেসব রুটের সড়ক দূরত্ব পাওয়া যায়নি, সেগুলো পাশের রুট হিসেবে ধরা হবে না।', 'Nearby routes are ranked by road distance between their first located stops. Routes without a measured distance are excluded from nearby coverage.')}</p>}
      <p className="rt-hint">{L(`পরামর্শ: প্রতিটা রুটের পার্সেল তার রাইডারদের সামর্থ্য অনুযায়ী ভাগ হয়। কেউ না এলে তাঁর ভাগ যায় — একই রুটের রাইডার → রুট ছাড়া রাইডার → পাশের রুটের রাইডার (${n(data.rules.near_km)} কিমির মধ্যে) → হাবের অন্য স্টাফ → শেষে সামর্থ্যের ${n(data.rules.over_pct)}% পর্যন্ত। সংখ্যা নিজে বদলাতে পারেন; সিস্টেম নিজে কিছু চূড়ান্ত করে না।`,
        `Suggestion: a route's parcels are shared by what its riders can take. An absent rider's part goes to the same route, riders without a route, the nearest routes (within ${data.rules.near_km} km), other hub staff, then up to ${data.rules.over_pct}% of capacity. You may change every number; nothing is final by itself.`)}</p>
      {tips.length > 0 && <ul className="rt-warn" style={{ padding: 0, margin: '10px 0' }}>{tips.map((t, i) => <li key={i} className={t.kind === 'unassigned' ? 'bad' : t.kind === 'cover' && t.to.length ? '' : 'warn'}>{tipText(t)}</li>)}</ul>}
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('নাম', 'Name')}</th><th>{L('রুট', 'Routes')}</th><th>{L('আজ', 'Today')}</th><th>{L('দিনে পারেন', 'Can take a day')}</th><th>{L('পিকআপ', 'Pickups')}</th>
          <th>{L('পার্সেল', 'Parcels')}</th><th>{L('ভাগ', 'Parts')}</th><th>{L('দিন শেষে', 'Done')}</th></tr></thead>
        <tbody>{people.map(p => <PersonRow key={p.id} p={p} r={f.rows[p.id]} data={data} listed={listed.get(p.id)} canWrite={canWrite} routeName={routeName} who={who}
          onRow={x => row(p.id, x)} onDrop={!plan?.lines.some(l => l.employee_id === p.id) && !p.rider && !p.routes.length ? () => { const rows = { ...f.rows }; delete rows[p.id]; change({ rows }) } : undefined} />)}</tbody>
        <tfoot><tr><td colSpan={5}>{L('মোট', 'Total')}</td><td><b>{n(given)}</b>{todo !== null ? ` / ${n(Math.max(0, todo))}` : ''}</td><td colSpan={2} /></tr></tfoot>
      </table></div>
      {canWrite && outside.length > 0 && <div className="rt-bar" style={{ justifyContent: 'flex-start' }}>
        <select value={add} onChange={e => setAdd(e.target.value)} aria-label={L('হাবের অন্য স্টাফ', 'Other hub staff')}><option value="">{L('হাবের অন্য স্টাফ যোগ করুন…', 'Add other hub staff…')}</option>
          {outside.map(p => <option key={p.id} value={p.id}>{p.name}{p.post ? ` — ${p.post}` : ''}</option>)}</select>
        <button className="secondary" disabled={!add} onClick={() => { change({ rows: { ...f.rows, [add]: { kind: 'helper', present: null, pickups: '', parcels: '', detail: [], capacity: null } } }); setAdd('') }}>
          <Icon name="plus" size={14} />{L('আজকের জন্য যোগ', 'Add for today')}</button></div>}
      <Field label={L('নোট', 'Note')} wide><input value={f.note} maxLength={500} disabled={!canWrite} onChange={e => change({ note: e.target.value })} placeholder={L('যেমন: দুইজন অসুস্থ, বৃষ্টি', 'e.g. two riders sick, rain')} /></Field>
      {err && <p className="da-error" role="alert">{err}</p>}
      <div className="rt-bar">
        {canWrite && <button className="secondary" disabled={busy || (!dirty && !!plan)} onClick={() => void run(() => planApi.save(hub, date, body()), L('খসড়া সেভ হয়েছে', 'Draft saved'))}><Icon name="save" size={15} />{L('খসড়া সেভ', 'Save draft')}</button>}
        {canWrite && !data.can.approve && plan?.status !== 'sent' && <button disabled={busy || given <= 0} onClick={() => void run(() => planApi.save(hub, date, body(), true), L('অনুমোদনের জন্য পাঠানো হয়েছে', 'Sent for approval'))}>
          <Icon name="send" size={15} />{L('অনুমোদনের জন্য পাঠান', 'Send for approval')}</button>}
        {data.can.approve && !locked && <button disabled={busy || given <= 0} onClick={() => void run(async () => { const id = canWrite && (dirty || !plan) ? await planApi.save(hub, date, body()) : plan!.id; await planApi.decide(id, true) }, L('পরিকল্পনা অনুমোদিত', 'Plan approved'))}>
          <Icon name="checkall" size={15} />{L('অনুমোদন', 'Approve')}</button>}
        {data.can.approve && plan?.status === 'sent' && <button className="secondary" disabled={busy} onClick={async () => { const why = await ask(L('কেন ফেরত দিচ্ছেন?', 'Why send it back?')); if (why) void run(() => planApi.decide(plan.id, false, why), L('ফেরত দেওয়া হয়েছে', 'Sent back')) }}>{L('ফেরত দিন', 'Send back')}</button>}
        {data.can.approve && locked && <button className="secondary" disabled={busy} onClick={async () => { const why = await ask(L('কেন আবার খুলছেন?', 'Why reopen it?')); if (why) void run(() => planApi.reopen(plan!.id, why), L('আবার খোলা হয়েছে', 'Reopened')) }}>{L('আবার খুলুন', 'Reopen')}</button>}
        {data.can.archive && plan && <button className="secondary" disabled={busy} onClick={async () => { const why = await ask(L('পরিকল্পনা সরানোর কারণ', 'Why remove this plan?')); if (why) void run(() => planApi.remove(plan.id, why), L('পরিকল্পনা সরানো হয়েছে', 'Plan removed')) }}>
          <Icon name="trash" size={15} />{L('সরান', 'Remove')}</button>}
      </div>
    </section>
    {setup && <SetupModal data={data} onClose={() => setSetup(false)} onSaved={() => { setSetup(false); toast(L('সেটআপ সেভ হয়েছে', 'Set-up saved')); void d.reload() }} />}
  </>
}

const WARN: Record<string, { bn: string; en: string }> = {
  rows: { bn: 'লাইনের সংখ্যা পিডিএফের উপরের মোটের সাথে মেলেনি', en: 'rows differ from the total on the PDF' }, total: { bn: 'COD-এর যোগফল লিস্টের মোটের সাথে মেলেনি', en: 'COD sum differs from the list total' },
  cut: { bn: 'Received কলাম কাটা — Landscape-এ প্রিন্ট করলে পুরোটা আসবে', en: 'Received column is cut off: print in landscape' }, rider: { bn: 'রাইডারের আইডি পড়া যায়নি', en: 'rider id not found' },
}

/** পিডিএফ থেকে সংখ্যা: the courier panel's Update list and Dispatch PDFs, read in the browser. Only numbers and parcel ids are kept. */
function FilesPanel({ hub, date, data, files, error, canWrite, reload, toast, onNumbers, onRiders }: {
  hub: string; date: string; data: PlanData; files: PlanFiles | null; error: unknown; canWrite: boolean; reload: () => void; toast: (m: string) => void
  onNumbers: (x: { arrived: string; sent: string; cancelled: string }) => void; onRiders: () => void
}) {
  const { L, n } = usePrefs()
  const [busy, setBusy] = useState(false); const [notes, setNotes] = useState<string[]>([]); const [pick, setPick] = useState<Record<string, string>>({})
  const list = files?.files ?? []
  const disp = list.filter(x => x.kind === 'dispatch'), lists = list.filter(x => x.kind === 'update_list')
  const sum = (xs: PlanFile[], k: string) => xs.reduce((t, x) => t + (x.counts[k] ?? 0), 0)
  const unmatched = [...new Set(lists.filter(x => !x.employee_id && x.rider_code).map(x => x.rider_code!))]
  const canUp = !!files?.can_upload
  const otherHub = (x: PlanFile) => !!x.hub_text && !x.hub_text.toLowerCase().includes(data.hub.name.toLowerCase().split(/[\s(]/)[0])
  const input = useRef<HTMLInputElement>(null)
  async function upload(picked: File[]) {
    if (!picked.length) return
    setBusy(true); const out: string[] = []; let ok = 0
    const { readPlanPdf } = await import('../../lib/planPdf')
    for (const file of picked.slice(0, 40)) {
      try {
        const doc = await readPlanPdf(file)
        if (doc.doc_date && doc.doc_date !== date) out.push(L(`${file.name}: PDF-এর তারিখ ${doc.doc_date}, নির্বাচিত প্ল্যান ${date}। প্রয়োগের আগে মিলিয়ে নিন।`, `${file.name}: PDF date ${doc.doc_date}, selected plan ${date}. Check before using its counts.`))
        await planApi.saveFile(hub, date, { ...doc, file_name: file.name }); ok++
      }
      catch (e) { out.push(`${file.name}: ${planFriendly(e)}`) }
    }
    setNotes(out); setBusy(false); if (ok) toast(L(`${n(ok)}টা পিডিএফ পড়া হয়েছে`, `${ok} PDF(s) read`)); reload()
  }
  async function act(what: () => Promise<unknown>, done: string) {
    setBusy(true); setNotes([])
    try { await what(); toast(done); reload() } catch (e) { setNotes([planFriendly(e)]) } finally { setBusy(false) }
  }
  if (!canUp && !list.length) return null
  return <section className="panel">
    <div className="da-bar"><h2>{L('পিডিএফ থেকে সংখ্যা', 'Numbers from PDFs')}</h2>
      {canUp && <><button disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={15} />{busy ? L('পড়া হচ্ছে…', 'Reading…') : L('পিডিএফ আপলোড', 'Upload PDFs')}</button>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; void upload(picked) }} /></>}</div>
    <p className="rt-hint">{L('Steadfast প্যানেলের "Update list" (রাইডারের লিস্ট) আর "Dispatch" শিটের পিডিএফ দিন — একসাথে অনেকগুলো দেওয়া যায়। ফাইল এই ফোন/কম্পিউটারেই পড়া হয়; শুধু সংখ্যা, পার্সেল আইডি আর রাইডারের আইডি সেভ হয় — গ্রাহকের নাম, মোবাইল বা ঠিকানা নয়, ফাইলটাও নয়। একই পিডিএফ আবার দিলে আগেরটা আপডেট হয়।',
      'Give the panel\'s "Update list" and "Dispatch" PDFs, several at once. The file is read on this device; only numbers, parcel ids and the rider id are saved — no customer name, phone or address, and not the file. The same PDF again updates the earlier one.')}</p>
    {error ? <p className="da-error">{planFriendly(error)}</p> : null}
    {notes.map((x, i) => <p key={i} className="da-error" role="alert">{x}</p>)}
    {list.length > 0 && <>
      <div className="da-stats">
        {disp.length > 0 && <><Stat icon="box" label={L('ডিসপ্যাচে পার্সেল', 'Parcels on dispatch')} value={n(sum(disp, 'parcels'))} sub={L(`${n(disp.length)}টা শিট · প্যাকেট ${n(sum(disp, 'pieces'))}`, `${disp.length} sheet(s) · ${sum(disp, 'pieces')} pieces`)} />
          <Stat icon="truck" label={L('অন্য হাবের', 'For another hub')} value={n(sum(disp, 'other_hub'))} tone={sum(disp, 'other_hub') ? 'warn' : undefined} />
          <Stat icon="alert" label={L('ক্যান্সেল', 'Cancelled')} value={n(sum(disp, 'cancelled'))} />
          <Stat icon="alert" label={L('স্ক্যান হয়নি', 'Not scanned in')} value={n(sum(disp, 'not_scanned'))} tone={sum(disp, 'not_scanned') ? 'warn' : 'ok'}
            sub={sum(disp, 'unscanned_delivered') ? L(`এর ${n(sum(disp, 'unscanned_delivered'))}টা স্ক্যান ছাড়াই ডেলিভারি`, `${sum(disp, 'unscanned_delivered')} delivered without a scan`) : undefined} /></>}
        {lists.length > 0 && <Stat icon="users" label={L('রাইডারের লিস্টে পার্সেল', 'Parcels on rider lists')} value={n(sum(lists, 'parcels'))} sub={L(`${n(lists.length)}টা লিস্ট · ডেলিভারি ${n(sum(lists, 'delivered'))}`, `${lists.length} list(s) · ${sum(lists, 'delivered')} delivered`)} />}
        {disp.length > 0 && lists.length > 0 && <Stat icon="alert" label={L('ডিসপ্যাচে আছে, কোনো লিস্টে নেই', 'On dispatch, on no list')} value={n(files!.unlisted)} tone={files!.unlisted ? 'warn' : 'ok'} />}
      </div>
      {canWrite && <div className="rt-bar" style={{ justifyContent: 'flex-start' }}>
        {disp.length > 0 && <button className="secondary" onClick={() => onNumbers({ arrived: String(sum(disp, 'parcels')), sent: String(sum(disp, 'other_hub')), cancelled: String(sum(disp, 'cancelled')) })}>
          <Icon name="check" size={14} />{L('হাবের সংখ্যা বসান (এসেছে, পাঠানো, ক্যান্সেল)', 'Use the hub numbers (arrived, sent on, cancelled)')}</button>}
        {lists.some(x => x.employee_id) && <button className="secondary" onClick={onRiders}><Icon name="check" size={14} />{L('রাইডারদের পার্সেল বসান', "Use the riders' parcels")}</button>}
      </div>}
      {unmatched.length > 0 && <ul className="rt-warn" style={{ padding: 0, margin: '10px 0' }}>{unmatched.map(code => { const f = lists.find(x => x.rider_code === code)!
        return <li key={code} className="warn">{L(`রাইডার #${code}${f.rider_name ? ` (${f.rider_name})` : ''} — কোন কর্মী?`, `Rider #${code}${f.rider_name ? ` (${f.rider_name})` : ''} — which employee?`)}{' '}
          {canUp && <><select value={pick[code] ?? ''} onChange={e => setPick({ ...pick, [code]: e.target.value })} aria-label={L(`রাইডার #${code}: কর্মী`, `Rider #${code}: employee`)} style={{ width: 'auto', display: 'inline-block' }}>
            <option value="">{L('কর্মী বাছুন…', 'Pick the employee…')}</option>{data.people.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}</select>{' '}
            <button className="secondary sm" disabled={busy || !pick[code]} onClick={() => void act(() => planApi.mapRider(hub, code, pick[code]), L('মিলানো হয়েছে', 'Matched'))}>{L('মিলান', 'Match')}</button></>}</li> })}</ul>}
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('ধরন', 'Kind')}</th><th>{L('নম্বর', 'No.')}</th><th>{L('পিডিএফের তারিখ', 'Date on the PDF')}</th><th>{L('রাইডার / কোথা থেকে', 'Rider / from')}</th><th>{L('পার্সেল', 'Parcels')}</th>
          <th>{L('বিস্তারিত', 'Details')}</th><th>{L('আপলোড', 'Uploaded')}</th><th /></tr></thead>
        <tbody>{list.map(x => <tr key={x.id}>
          <td data-label={L('ধরন', 'Kind')}>{x.kind === 'dispatch' ? <Badge tone="info">Dispatch</Badge> : <Badge tone="ok">Update list</Badge>}</td>
          <td data-label={L('নম্বর', 'No.')}><b>#{x.doc_no}</b>{otherHub(x) && <div className="small" style={{ color: '#dc2626' }}>{L(`পিডিএফে হাব: ${x.hub_text}`, `Hub on the PDF: ${x.hub_text}`)}</div>}</td>
          <td data-label={L('পিডিএফের তারিখ', 'Date on the PDF')}>{x.doc_date ?? '—'}{x.doc_date && x.doc_date !== date && <div className="small" style={{ color: '#ca8a04' }}>{L('এই পাতার তারিখ থেকে আলাদা', 'differs from this page')}</div>}</td>
          <td data-label={L('রাইডার / কোথা থেকে', 'Rider / from')}>{x.kind === 'dispatch' ? x.from_text ?? '—' : <>{data.people.find(p => p.id === x.employee_id)?.name ?? x.rider_name ?? '—'}
            <div className="muted small">#{x.rider_code ?? '?'}{x.employee_id ? '' : ` · ${L('মিলানো হয়নি', 'not matched')}`}</div></>}</td>
          <td data-label={L('পার্সেল', 'Parcels')}><b>{n(x.counts.parcels ?? x.parcels)}</b></td>
          <td className="small" data-label={L('বিস্তারিত', 'Details')}>{x.kind === 'dispatch'
            ? L(`এই হাবের ${n(x.counts.for_hub ?? 0)} · অন্য হাবের ${n(x.counts.other_hub ?? 0)} · ক্যান্সেল ${n(x.counts.cancelled ?? 0)} · পয়েন্ট ${n(x.counts.point ?? 0)} · স্ক্যান হয়নি ${n(x.counts.not_scanned ?? 0)}`,
                `this hub ${x.counts.for_hub ?? 0} · other hub ${x.counts.other_hub ?? 0} · cancelled ${x.counts.cancelled ?? 0} · point ${x.counts.point ?? 0} · not scanned ${x.counts.not_scanned ?? 0}`)
            : <>{L(`ডেলিভারি ${n(x.counts.delivered ?? 0)} · COD ৳${n(x.counts.cod_total ?? 0)}`, `delivered ${x.counts.delivered ?? 0} · COD ৳${x.counts.cod_total ?? 0}`)}
                {' · '}{x.on_report ? L('রিপোর্টে উঠেছে', 'on a report') : L('রিপোর্টে ওঠেনি', 'not on a report')}</>}
            {x.warnings.map(w => <div key={w} style={{ color: '#ca8a04' }}>{WARN[w] ? L(WARN[w].bn, WARN[w].en) : w}</div>)}</td>
          <td className="small" data-label={L('আপলোড', 'Uploaded')}>{x.uploaded_by_name ?? ''}{x.uploads > 1 ? ` · ${n(x.uploads)}${L(' বার', '×')}` : ''}</td>
          <td>{canUp && <button className="secondary sm" disabled={busy} onClick={async () => { const why = (await askReason(L('পিডিএফ সরানোর কারণ', 'Why remove this PDF?'))) ?? ''; if (why) void act(() => planApi.removeFile(x.id, why), L('সরানো হয়েছে', 'Removed')) }}>{L('সরান', 'Remove')}</button>}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>
}

const HOW: Record<'same' | 'free' | 'near' | 'helper' | 'stretch', { bn: string; en: string }> = {
  same: { bn: 'একই রুট', en: 'same route' }, free: { bn: 'রুট ছাড়া রাইডার', en: 'no route' }, near: { bn: 'পাশের রুট', en: 'near route' },
  helper: { bn: 'অন্য স্টাফ', en: 'other staff' }, stretch: { bn: 'বাড়তি চাপ', en: 'extra load' },
}
const CAP: Record<Exclude<CapSource, null>, { bn: string; en: string }> = {
  fixed: { bn: 'নির্দিষ্ট', en: 'fixed' }, accounts: { bn: 'হিসাব খাতার গড়', en: 'accounts average' }, self: { bn: 'নিজের রিপোর্টের গড়', en: 'own reports' },
  hub: { bn: 'হাবের গড়', en: 'hub average' }, helper: { bn: 'সহায়তার সীমা', en: 'helper limit' },
}
const SRC: Record<string, { bn: string; en: string }> = {
  attendance: { bn: 'হাজিরা খাতা', en: 'attendance' }, self: { bn: 'নিজের হাজিরা', en: 'own mark' }, hub_ops: { bn: 'হাব অপারেশন', en: 'hub operation' }, application: { bn: 'ছুটির আবেদন', en: 'leave application' },
}

function Hint({ v, label, on }: { v: number; label: string; on?: (v: number) => void }) {
  const { L, n } = usePrefs()
  return <span>{label}: <b>{n(v)}</b>{on && <> · <button type="button" className="linkish" onClick={() => on(v)}>{L('বসান', 'Use')}</button></>}</span>
}

function PersonRow({ p, r, data, listed, canWrite, routeName, who, onRow, onDrop }: {
  p: PlanPerson; r: Row; data: PlanData; listed?: { parcels: number; delivered: number }; canWrite: boolean; routeName: (id?: string | null) => string; who: (id?: string | null) => string; onRow: (x: Partial<Row>) => void; onDrop?: () => void
}) {
  const { L, n } = usePrefs()
  const c = capacityOf(p, data)
  const cap = capacityToday(c, int(r.pickups) ?? 0, data.load)
  const here = isHere(p, r.present)
  const parcels = int(r.parcels) ?? 0
  const pct = cap ? Math.round((parcels / cap) * 100) : null
  const tone = !here && parcels > 0 ? '#dc2626' : pct === null ? '#64748b' : pct > data.rules.over_pct ? '#dc2626' : pct > 100 ? '#ca8a04' : '#15803D'
  const done = p.done.acc ?? p.done.self
  const state = r.present === null ? '' : r.present ? 'yes' : 'no'
  return <tr style={{ opacity: here ? 1 : 0.75 }}>
    <td data-label={L('নাম', 'Name')}><b>{p.name}</b><div className="muted small">{p.code ? `${L('আইডি', 'ID')} ${p.code} · ` : ''}{r.kind === 'helper' ? L('অন্য স্টাফ', 'Other staff') : L('রাইডার', 'Rider')}{p.post && r.kind === 'helper' ? ` · ${p.post}` : ''}
      {onDrop && canWrite && <> · <button type="button" className="linkish" onClick={onDrop}>{L('বাদ দিন', 'Take off')}</button></>}</div></td>
    <td data-label={L('রুট', 'Routes')}>{p.routes.length ? p.routes.map(id => routeName(id)).join(', ') : <span className="muted">—</span>}</td>
    <td data-label={L('আজ', 'Today')}><select value={state} disabled={!canWrite} aria-label={L(`${p.name}: আজ আছেন?`, `${p.name}: here today?`)} onChange={e => onRow({ present: e.target.value === '' ? null : e.target.value === 'yes' })}>
      <option value="">{p.presence.state === null ? L('হাজিরা নেই', 'Not marked') : p.presence.state === 'present' ? L('আছেন (হাজিরা)', 'Here (attendance)') : L('নেই (হাজিরা)', 'Away (attendance)')}</option>
      <option value="yes">{L('আছেন', 'Here')}</option><option value="no">{L('নেই', 'Away')}</option></select>
      {p.presence.source && r.present === null && <div className="muted small">{L(SRC[p.presence.source].bn, SRC[p.presence.source].en)}</div>}</td>
    <td data-label={L('দিনে পারেন', 'Can take a day')}>{cap === null ? <span style={{ color: '#ca8a04' }}>{L('জানা নেই', 'Unknown')}</span> : <><b>{n(cap)}</b>
      <div className="muted small">{c.source ? L(CAP[c.source].bn, CAP[c.source].en) : ''}{c.rate !== null ? ` · ${L('সফল', 'success')} ${n(Math.round(c.rate * 100))}%` : ''}</div></>}</td>
    <td data-label={L('পিকআপ', 'Pickups')}><input type="number" inputMode="numeric" min={0} style={{ width: 76 }} disabled={!canWrite || !here} aria-label={L(`${p.name}: পিকআপ`, `${p.name}: pickups`)}
      value={r.pickups} onChange={e => onRow({ pickups: e.target.value })} />{doesPickup(p, data.load) ? null : <div className="muted small">{L('পিকআপ করেন না', 'No pickups')}</div>}</td>
    <td data-label={L('পার্সেল', 'Parcels')}><input type="number" inputMode="numeric" min={0} style={{ width: 86 }} disabled={!canWrite} aria-label={L(`${p.name}: পার্সেল`, `${p.name}: parcels`)}
      value={r.parcels} onChange={e => onRow({ parcels: e.target.value, detail: [] })} />
      {pct !== null && parcels > 0 && <div className="rt-prog" title={`${pct}%`}><span style={{ width: `${Math.min(100, pct)}%`, background: tone }} /></div>}
      {!here && parcels > 0 && <div className="small" style={{ color: '#dc2626' }}>{L('নেই, তবু পার্সেল আছে', 'Away but has parcels')}</div>}
      {here && pct !== null && pct > 100 && <div className="small" style={{ color: tone }}>{n(pct)}%</div>}</td>
    <td className="small" data-label={L('ভাগ', 'Parts')}>{r.detail.length ? r.detail.map((x, i) => <div key={i}>{routeName(x.route_id)}: {n(x.parcels)}{x.for ? ` (${who(x.for)}-${L('এর', "'s")})` : ''}</div>) : '—'}</td>
    <td className="small" data-label={L('দিন শেষে', 'Done')}>{listed ? <>{L('লিস্টে ডেলিভারি', 'Delivered on the lists')} <b>{n(listed.delivered)}</b> / {n(listed.parcels)}</> : done ? <>{L('ডেলিভারি', 'Delivered')} <b>{n(done.delivery)}</b>{parcels > 0 ? ` / ${n(parcels)}` : ''}{p.done.self && p.done.self.returned > 0 ? <div>{L('ফেরত', 'Returned')} {n(p.done.self.returned)}</div> : null}</> : '—'}</td>
  </tr>
}

/** Set-up by the zonal manager: who does pickups at this hub, a fixed number per person, who may help, and the zone's plan rules. */
function SetupModal({ data, onClose, onSaved }: { data: PlanData; onClose: () => void; onSaved: () => void }) {
  const { L, n } = usePrefs()
  const [mode, setMode] = useState<PickupMode>(data.load.pickup_mode)
  const [weight, setWeight] = useState(String(data.load.pickup_weight))
  const staff = data.people.filter(p => p.active)
  const start = (p: PlanPerson) => ({ fixed: txt(p.fixed), helper: p.helper, max: txt(p.helper_max), pickup: p.pickup })
  const [rows, setRows] = useState(() => Object.fromEntries(staff.map(p => [p.id, start(p)])))
  const [rules, setRules] = useState<PlanRules>(data.rules)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const set = (id: string, x: Partial<ReturnType<typeof start>>) => setRows({ ...rows, [id]: { ...rows[id], ...x } })
  async function save() {
    setBusy(true); setErr('')
    try {
      if (data.can.configure) {
        const changed: StaffSetup[] = staff.filter(p => JSON.stringify(rows[p.id]) !== JSON.stringify(start(p)))
          .map(p => ({ employee_id: p.id, day_parcels: int(rows[p.id].fixed), helper: rows[p.id].helper, helper_max: int(rows[p.id].max), pickup: rows[p.id].pickup }))
        await planApi.setup(data.hub.id, { pickup_mode: mode, pickup_weight: Number(weight), ...(changed.length ? { staff: changed } : {}) })
      }
      if (data.can.rules && JSON.stringify(rules) !== JSON.stringify(data.rules)) await planApi.saveRules(data.hub.zone_id, rules)
      onSaved()
    } catch (e) { setErr(planFriendly(e)) } finally { setBusy(false) }
  }
  const rule = (k: Exclude<keyof PlanRules, 'show_rider'>, label: string, min: number, max: number, hint?: string, step = 1) =>
    <Field label={label} hint={hint}><input type="number" min={min} max={max} step={step} disabled={!data.can.rules} value={String(rules[k])} onChange={e => setRules({ ...rules, [k]: Number(e.target.value) })} /></Field>
  return <Modal wide title={L(`পরিকল্পনার সেটআপ — ${data.hub.name}`, `Plan set-up — ${data.hub.name}`)} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button><button disabled={busy} onClick={() => void save()}><Icon name="save" size={15} />{L('সেভ', 'Save')}</button></>}>
    <h3>{L('এই হাবে পিকআপ কে করেন', 'Who does the pickups at this hub')}</h3>
    <div className="hr-form">
      <Field label={L('পিকআপ', 'Pickups')}><select value={mode} disabled={!data.can.configure} onChange={e => setMode(e.target.value as PickupMode)}>
        <option value="same">{L('ডেলিভারির রাইডাররাই করেন', 'The delivery riders')}</option><option value="separate">{L('আলাদা লোক করেন', 'Other people')}</option>
        <option value="mixed">{L('কেউ কেউ করেন (নিচে টিক দিন)', 'Some of them (tick below)')}</option></select></Field>
      <Field label={L('একটা পিকআপ = কয়টা ডেলিভারি', 'One pickup = how many deliveries')} hint={L('পিকআপ বেশি হলে ডেলিভারির সামর্থ্য এতটা কমে', 'Extra pickups lower the delivery room by this')}>
        <input type="number" min={0} max={5} step={0.25} disabled={!data.can.configure} value={weight} onChange={e => setWeight(e.target.value)} /></Field>
      <Field label={L('হাবের রাইডার গড় (দিনে)', "Hub's rider average (a day)")} hint={L('বদলাতে: রুট সেটিং → পার্সেল ও পরামর্শ', 'Change it in Route settings → Parcels & suggestions')}>
        <input disabled value={data.load.rider_parcels === null ? L('বসানো হয়নি', 'Not set') : n(data.load.rider_parcels)} /></Field>
    </div>
    <h3>{L('কর্মী অনুযায়ী', 'By person')}</h3>
    <p className="rt-hint">{L('নির্দিষ্ট সংখ্যা ফাঁকা রাখলে আগের দিনগুলোর গড় ধরা হয়। রাইডার নন এমন কাউকে "ডেলিভারিতে সাহায্য" দিলে রাইডার কম পড়লে তাঁকে পরামর্শে আনা হয়।',
      'Leave the fixed number empty to use the person\'s past average. Tick "helps with delivery" for a non-rider to be suggested when riders are short.')}</p>
    <div className="da-table-wrap" style={{ flexShrink: 0 }}><table className="da-table">
      <thead><tr><th>{L('নাম', 'Name')}</th><th>{L('দিনে নির্দিষ্ট পার্সেল', 'Fixed parcels a day')}</th><th>{L('গড় (আগের দিন)', 'Past average')}</th><th>{L('ডেলিভারিতে সাহায্য', 'Helps with delivery')}</th>
        <th>{L('সাহায্যে সর্বোচ্চ', 'Helper limit')}</th><th>{L('পিকআপ করেন', 'Does pickups')}</th></tr></thead>
      <tbody>{staff.map(p => { const c = capacityOf({ ...p, fixed: null }, data); const r = rows[p.id]
        return <tr key={p.id}>
          <td data-label={L('নাম', 'Name')}><b>{p.name}</b><div className="muted small">{p.post ?? ''}{p.rider ? ` · ${L('রাইডার', 'Rider')}` : ''}</div></td>
          <td data-label={L('দিনে নির্দিষ্ট পার্সেল', 'Fixed parcels a day')}><input type="number" min={1} max={1000} style={{ width: 90 }} disabled={!data.can.configure} value={r.fixed} onChange={e => set(p.id, { fixed: e.target.value })} aria-label={L(`${p.name}: নির্দিষ্ট পার্সেল`, `${p.name}: fixed parcels`)} /></td>
          <td data-label={L('গড় (আগের দিন)', 'Past average')}>{p.rider && (c.source === 'accounts' || c.source === 'self') ? `${n(c.base!)} · ${L(CAP[c.source].bn, CAP[c.source].en)}` : '—'}</td>
          <td data-label={L('ডেলিভারিতে সাহায্য', 'Helps with delivery')}>{p.rider ? <span className="muted">{L('রাইডার', 'Rider')}</span> : <input type="checkbox" style={{ width: 'auto' }} disabled={!data.can.configure} checked={r.helper} onChange={e => set(p.id, { helper: e.target.checked })} aria-label={L(`${p.name}: সাহায্য`, `${p.name}: helps`)} />}</td>
          <td data-label={L('সাহায্যে সর্বোচ্চ', 'Helper limit')}>{p.rider ? '—' : <input type="number" min={1} max={500} style={{ width: 80 }} disabled={!data.can.configure || !r.helper} value={r.max} placeholder={String(rules.helper_max)} onChange={e => set(p.id, { max: e.target.value })} aria-label={L(`${p.name}: সর্বোচ্চ`, `${p.name}: limit`)} />}</td>
          <td data-label={L('পিকআপ করেন', 'Does pickups')}><input type="checkbox" style={{ width: 'auto' }} disabled={!data.can.configure || mode !== 'mixed'} checked={mode === 'same' ? p.rider || r.pickup : mode === 'separate' ? false : r.pickup}
            onChange={e => set(p.id, { pickup: e.target.checked })} aria-label={L(`${p.name}: পিকআপ`, `${p.name}: pickups`)} /></td>
        </tr> })}</tbody>
    </table></div>
    <h3>{L('জোনের পরিকল্পনার নিয়ম', 'Zone plan rules')}{!data.can.rules && <> <Badge tone="info">{L('শুধু দেখা যাবে', 'View only')}</Badge></>}</h3>
    <div className="hr-form">
      {rule('avg_days', L('গড় কত দিনের', 'Days of history'), 3, 90)}
      {rule('min_days', L('গড় ধরতে অন্তত কত দিন', 'Days needed to trust it'), 1, 30)}
      {rule('over_pct', L('সর্বোচ্চ চাপ (%)', 'Overload limit (%)'), 100, 200, L('সামর্থ্যের এত শতাংশ পর্যন্ত দেওয়া যায়', 'A rider may be given up to this'))}
      {rule('near_km', L('"পাশের রুট" কত কিমির মধ্যে', '"Near route" within (km)'), 0.5, 50, undefined, 0.5)}
      {rule('helper_max', L('অন্য স্টাফ সর্বোচ্চ কয়টা', 'Most parcels for a helper'), 1, 500)}
      <Field label={L('রাইডার নিজের পার্সেল দেখবেন', 'Riders see their own parcels')}><label className="small"><input type="checkbox" disabled={!data.can.rules} style={{ width: 'auto', marginRight: 6 }}
        checked={rules.show_rider} onChange={e => setRules({ ...rules, show_rider: e.target.checked })} />{rules.show_rider ? L('হ্যাঁ (অনুমোদনের পর)', 'Yes (after approval)') : L('না', 'No')}</label></Field>
    </div>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

// RoutePlanPage moved to RouteSettings.tsx — PlanTab (above) is reused as both the master tab and the standalone page.

/** Staff panel: my parcels of today's approved plan. */
export function MyParcelsCard() {
  const { L, n } = usePrefs()
  const d = useLoad<MyParcels | null>(() => planApi.mine().catch(() => null), [])
  const m = d.data
  if (!m) return null
  // an assignment taken off today (a new version gave the route to somebody else) is told plainly, and nothing else is shown
  if (m.parcels === 0 && m.pickups === 0 && m.cancelled?.length) return <div className="sp-box" style={{ marginTop: 10 }}><h3><Icon name="alert" size={16} />{L('আজকের রুট বরাদ্দ বাতিল', 'Today’s route assignment cancelled')}</h3>
    <p className="muted small">{L('আজকের রুট প্ল্যান বদলেছে — আপনার আগের বরাদ্দ আর কার্যকর নয়। নতুন কিছু বরাদ্দ হলে এখানে আসবে।', 'Today’s route plan changed — your earlier assignment no longer stands. A new one appears here if you get one.')}</p></div>
  return <div className="sp-box" style={{ marginTop: 10 }}><h3><Icon name="box" size={16} />{L('আজ আমার পার্সেল', 'My parcels today')}<span className="cnt">{n(m.parcels)}</span></h3>
    {m.version ? <p className="muted small">{L('রুট প্ল্যান সংস্করণ', 'Route plan version')} {n(m.version)} · {L('কিছু গ্রহণ করতে হবে না — বরাদ্দ সরাসরি কার্যকর।', 'nothing to accept — it is in force.')}</p> : null}
    <ul>{m.detail.map((x, i) => <li key={i}>{x.route ?? L('রুট ছাড়া', 'No route')}: <b>{n(x.parcels)}</b>{x.for ? ` — ${x.for}-${L('এর ভাগ', "'s part")}` : ''}</li>)}
      {m.pickups > 0 && <li>{L('পিকআপ', 'Pickups')}: <b>{n(m.pickups)}</b></li>}</ul>
    {m.note && <p className="muted small">{m.note}</p>}
  </div>
}
