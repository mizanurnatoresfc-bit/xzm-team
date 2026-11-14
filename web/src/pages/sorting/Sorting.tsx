import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { RouteViz } from '../../components/RouteViz'
import { usePrefs } from '../../lib/prefs'
import { hrFriendly, type Hub } from '../../lib/hr'
import { taka } from '../../lib/dailyAccounts'
import { useOrg } from '../hr/common'
import {
  FUEL_KIND, FUEL_STATUS, HO_STATUS, ROLE, sorting, TRIP_STATUS,
  type Center, type DriverReport, type EmpLite, type Fuel, type Handover, type Route, type RouteHub, type RouteReport, type StaffRow,
} from '../../lib/sorting'

type Sec = 'dashboard' | 'routes' | 'staff' | 'fuel' | 'parcels' | 'drivers' | 'reports' | 'centers'
export const SORTING_SECTIONS: Array<{ key: Sec; icon: string; bn: string; en: string; perms: string[] }> = [
  { key: 'dashboard', icon: 'dash', bn: 'শটিং ড্যাশবোর্ড', en: 'Sorting dashboard', perms: ['sorting.center.view', 'sorting.report.view'] },
  { key: 'routes', icon: 'map', bn: 'শটিং টু হাব রুট', en: 'Sorting to hub routes', perms: ['sorting.center.view'] },
  { key: 'staff', icon: 'users', bn: 'শটিং সেন্টারের স্টাফ', en: 'Sorting staff', perms: ['sorting.staff.view'] },
  { key: 'fuel', icon: 'receipt', bn: 'তেলের স্লিপ ও খরচ রিকুয়েস্ট', en: 'Fuel slips & expenses', perms: ['sorting.fuel.view', 'sorting.fuel.create'] },
  { key: 'parcels', icon: 'box', bn: 'পার্সেল আদান-প্রদান', en: 'Parcel handovers', perms: ['sorting.parcel.view', 'sorting.parcel.create'] },
  { key: 'drivers', icon: 'truck', bn: 'ড্রাইভার রিপোর্ট (রুট অনুযায়ী)', en: 'Driver reports by route', perms: ['sorting.driver.view', 'sorting.driver.create'] },
  { key: 'reports', icon: 'chart', bn: 'রিপোর্ট: হাব ও শটিং', en: 'Reports: hub & sorting', perms: ['sorting.report.view'] },
  { key: 'centers', icon: 'hub', bn: 'শটিং সেন্টার', en: 'Sorting centers', perms: ['sorting.center.view', 'sorting.center.create'] },
]

const CKEY = 'xzm_sorting_center'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const monthStart = () => today().slice(0, 8) + '01'
const num = (s: string) => { const v = Number(s); return s.trim() === '' || Number.isNaN(v) ? null : v }

type Ctx = { center: Center; hubs: Hub[]; hubName: Record<string, string>; from: string; to: string }

export function Sorting() {
  const { section } = useParams()
  const { can } = useAuth()
  const { L } = usePrefs()
  const o = useOrg()
  const centers = useLoad(() => sorting.centers(), [])
  const [cid, setCid] = useState(() => { try { return sessionStorage.getItem(CKEY) || '' } catch { return '' } })
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today())
  const list = centers.data ?? []
  useEffect(() => { if (list.length && !list.some(c => c.id === cid)) setCid(list[0].id) }, [list, cid])
  useEffect(() => { try { if (cid) sessionStorage.setItem(CKEY, cid) } catch { /* ignore */ } }, [cid])
  const sec = SORTING_SECTIONS.find(s => s.key === section)
  if (!sec) return <Navigate to="/app/sorting/dashboard" replace />
  const tabs = SORTING_SECTIONS.filter(s => s.perms.some(p => can(p)))
  const center = list.find(c => c.id === cid) ?? null
  const hubs = (o.data?.hubs ?? []).filter(h => !h.archived_at && (!center || h.zone_id === center.zone_id))
  const hubName = o.names.hub
  const dated = ['dashboard', 'fuel', 'parcels', 'drivers', 'reports'].includes(sec.key)

  return <AppShell title={L(sec.bn, sec.en)} subtitle={center ? `${center.name} (${center.code})` : undefined}>
    <section className="da-filters panel no-print hub-top">
      {sec.key !== 'centers' && <Field label={L('শটিং সেন্টার', 'Sorting center')}><select value={cid} onChange={e => setCid(e.target.value)}>
        {list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      {dated && <><Field label={L('থেকে', 'From')}><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label={L('পর্যন্ত', 'To')}><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></Field>
        <div className="da-seg" style={{ alignSelf: 'flex-end' }}>
          <button className="secondary sm" onClick={() => { setFrom(today()); setTo(today()) }}>{L('আজ', 'Today')}</button>
          <button className="secondary sm" onClick={() => { setFrom(monthStart()); setTo(today()) }}>{L('এই মাস', 'This month')}</button></div></>}
      <nav className="hub-tabs" aria-label={L('শটিং সেন্টার ম্যানেজমেন্ট', 'Sorting center management')}>
        {tabs.map(t => <Link key={t.key} to={`/app/sorting/${t.key}`} className={t.key === sec.key ? 'on' : ''}><Icon name={t.icon} size={15} /><span>{L(t.bn, t.en)}</span></Link>)}
      </nav>
    </section>
    {centers.error ? <p className="da-error">{hrFriendly(centers.error)}</p> : null}
    {!sec.perms.some(p => can(p)) ? <p className="notice">{L('এই পাতা দেখার অনুমতি আপনার রোলে নেই।', 'Your role may not open this page.')}</p>
      : sec.key === 'centers' ? <Centers onChange={() => void centers.reload()} />
      : centers.data && !list.length ? <p className="notice">{L('এখনো কোনো শটিং সেন্টার নেই।', 'No sorting center yet.')} {can('sorting.center.create') && <Link to="/app/sorting/centers">{L('সেন্টার যোগ করুন →', 'Add one →')}</Link>}</p>
      : !center ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : <Body sec={sec.key} ctx={{ center, hubs, hubName, from, to }} />}
  </AppShell>
}

function Body({ sec, ctx }: { sec: Sec; ctx: Ctx }) {
  switch (sec) {
    case 'dashboard': return <Dashboard ctx={ctx} />
    case 'routes': return <Routes ctx={ctx} />
    case 'staff': return <Staff ctx={ctx} />
    case 'fuel': return <FuelPage ctx={ctx} />
    case 'parcels': return <Parcels ctx={ctx} />
    case 'drivers': return <Drivers ctx={ctx} />
    case 'reports': return <Reports ctx={ctx} />
    default: return null
  }
}

/** Routes, hubs on them, vehicles and names of the people a page shows. */
function useRefs(center: string, ids: Array<string | null | undefined>) {
  const routes = useLoad(() => sorting.routes(center), [center])
  const rh = useLoad(() => sorting.routeHubs((routes.data ?? []).map(r => r.id)), [routes.data])
  const vehicles = useLoad(() => sorting.vehicles().catch(() => []), [])
  const key = [...new Set(ids.filter(Boolean))].sort().join(',')
  const emps = useLoad(() => sorting.employeesByIds(key ? key.split(',') : []).catch(() => [] as EmpLite[]), [key])
  const routeName = useMemo(() => Object.fromEntries((routes.data ?? []).map(r => [r.id, r.name])) as Record<string, string>, [routes.data])
  const vehName = useMemo(() => Object.fromEntries((vehicles.data ?? []).map(v => [v.id, `${v.name}${v.reg_no ? ` (${v.reg_no})` : ''}`])) as Record<string, string>, [vehicles.data])
  const emp = useMemo(() => Object.fromEntries((emps.data ?? []).map(e => [e.id, e])) as Record<string, EmpLite>, [emps.data])
  return { routes, rh, vehicles, routeName, vehName, emp }
}
export const empLabel = (e?: EmpLite) => e ? `${e.employee_code ? e.employee_code + ' · ' : ''}${e.full_name}` : ''

/** Employee picked by ID; shows the name once found. */
export function EmpPicker({ label, value, onPick, hint }: { label: string; value: EmpLite | null; onPick: (e: EmpLite | null) => void; hint?: ReactNode }) {
  const { L } = usePrefs()
  const [code, setCode] = useState(value?.employee_code ?? '')
  const [msg, setMsg] = useState('')
  async function look() {
    setMsg('')
    if (!code.trim()) { onPick(null); return }
    try { const e = await sorting.findEmployee(code); onPick(e); if (!e) setMsg(L('এই আইডির কাউকে পাওয়া যায়নি', 'Nobody with this ID')) }
    catch (e) { setMsg(hrFriendly(e)) }
  }
  return <Field label={label} hint={msg ? <span className="bad">{msg}</span> : value ? <b>{value.full_name}</b> : hint}>
    <input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} onBlur={() => void look()} placeholder={L('এমপ্লয়ি আইডি', 'Employee ID')} /></Field>
}

// ---------------------------------------------------------------- dashboard
function Dashboard({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs()
  const d = useLoad(() => sorting.dashboard(ctx.center.id, ctx.from, ctx.to), [ctx.center.id, ctx.from, ctx.to])
  const rep = useLoad(() => sorting.report(ctx.center.id, ctx.from, ctx.to), [ctx.center.id, ctx.from, ctx.to])
  const v = d.data
  const g = (k: string) => Number(v?.[k] ?? 0)
  if (d.error) return <p className="da-error">{hrFriendly(d.error)}</p>
  const byRoute = new Map<string, { name: string; in: number; out: number; bad: number; pending: number }>()
  for (const r of rep.data ?? []) {
    const k = r.route_id ?? '-'; const c = byRoute.get(k) ?? { name: r.route_name, in: 0, out: 0, bad: 0, pending: 0 }
    c.in += r.to_sorting; c.out += r.to_hub; c.bad += r.wrong + r.returned + r.damaged; c.pending += r.not_received + r.disputed; byRoute.set(k, c)
  }
  return <>
    <div className="da-stats">
      <Stat icon="box" label={L('হাব থেকে শটিংয়ে এসেছে', 'Hub → sorting')} value={n(g('in_parcels'))} />
      <Stat icon="truck" label={L('শটিং থেকে হাবে গেছে', 'Sorting → hub')} value={n(g('out_parcels'))} />
      <Stat icon="alert" tone={g('wrong') ? 'warn' : undefined} label={L('ভুল পার্সেল', 'Wrong parcels')} value={n(g('wrong'))} />
      <Stat icon="back" tone={g('returned') ? 'warn' : undefined} label={L('ব্যাক দিয়েছে', 'Returned')} value={n(g('returned'))} />
      <Stat icon="x" tone={g('damaged') ? 'bad' : undefined} label={L('ড্যামেজ', 'Damaged')} value={n(g('damaged'))} />
    </div>
    <div className="da-stats" style={{ marginTop: 12 }}>
      <Stat icon="clock" tone={g('not_received') + g('disputed') ? 'warn' : undefined} label={L('বুঝে নেওয়া বাকি / গরমিল', 'Not received / mismatch')} value={`${n(g('not_received'))} / ${n(g('disputed'))}`} />
      <Stat icon="cash" label={L('অনুমোদিত তেল/খরচ', 'Approved fuel/expense')} value={taka(g('fuel_amount'))} sub={`${n(g('fuel_litres'))} ${L('লিটার', 'L')}`} />
      <Stat icon="receipt" tone={g('fuel_waiting') ? 'warn' : undefined} label={L('অনুমোদনের অপেক্ষায়', 'Waiting approval')} value={n(g('fuel_waiting'))} />
      <Stat icon="truck" label={L('ট্রিপ', 'Trips')} value={n(g('trips'))} sub={`${n(g('km'))} ${L('কিমি', 'km')} · ${L('সমস্যা', 'issues')} ${n(g('trips_late'))}`} />
      <Stat icon="map" label={L('রুট / হাব', 'Routes / hubs')} value={`${n(g('routes'))} / ${n(g('hubs'))}`} />
    </div>
    <div className="da-grid2" style={{ marginTop: 14 }}>
      <section className="panel"><h2>{L('রুট অনুযায়ী', 'By route')}</h2>
        {!byRoute.size ? <p className="muted">{L('এই সময়ে কিছু নেই।', 'Nothing in this period.')}</p> :
          <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('রুট', 'Route')}</th><th className="r">{L('এসেছে', 'In')}</th><th className="r">{L('গেছে', 'Out')}</th>
            <th className="r">{L('ভুল/ব্যাক/ড্যামেজ', 'Wrong/ret/dmg')}</th><th className="r">{L('বাকি', 'Open')}</th></tr></thead>
            <tbody>{[...byRoute.values()].map(r => <tr key={r.name}><td><strong>{r.name}</strong></td><td className="r">{n(r.in)}</td><td className="r">{n(r.out)}</td>
              <td className={`r${r.bad ? ' bad' : ''}`}>{n(r.bad)}</td><td className={`r${r.pending ? ' bad' : ''}`}>{n(r.pending)}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="panel"><h2>{L('স্টাফ', 'Staff')} <span className="count-pill">{n(g('staff'))}</span></h2>
        <div className="team-cards">{Object.entries(v?.staff_by_role ?? {}).map(([k, c]) => <div key={k} className="team-card static">
          <span className="ti"><Icon name={ROLE[k]?.[2] ?? 'user'} size={20} /></span><span className="tn">{L(ROLE[k]?.[0] ?? k, ROLE[k]?.[1] ?? k)}</span><span className="tc">{n(c)}</span></div>)}</div>
        {!g('staff') && <p className="muted">{L('এখনো কোনো স্টাফ যোগ হয়নি।', 'No staff yet.')}</p>}
      </section>
    </div>
  </>
}

// ---------------------------------------------------------------- centers
function Centers({ onChange }: { onChange: () => void }) {
  const { can } = useAuth()
  const { L } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const list = useLoad(() => sorting.centers(), [])
  const [f, setF] = useState<(Partial<Center> & { id?: string }) | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function save() {
    if (!f) return
    if (!f.code?.trim() || !f.name?.trim() || !f.zone_id) return setErr(L('কোড, নাম ও জোন দিন', 'Give code, name and zone'))
    setBusy(true); setErr('')
    try { await sorting.saveCenter({ ...f, code: f.code.trim().toUpperCase(), name: f.name.trim() }, f.id); setF(null); await list.reload(); onChange(); toast(L('সেভ হয়েছে', 'Saved')) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(c: Center) {
    const r = window.prompt(L(`"${c.name}" সরানোর কারণ`, `Why remove "${c.name}"?`)) ?? ''
    if (!r.trim()) return
    try { await sorting.archiveCenter(c.id, r.trim()); await list.reload(); onChange() } catch (e) { setErr(hrFriendly(e)) }
  }
  return <section className="panel">{node}
    <div className="da-bar"><h2>{L('শটিং সেন্টার', 'Sorting centers')}</h2>
      {can('sorting.center.create') && <button onClick={() => { setErr(''); setF({ code: '', name: '', zone_id: o.data?.zones[0]?.id ?? '', status: 'active' }) }}><Icon name="plus" size={15} />{L('নতুন সেন্টার', 'New center')}</button>}</div>
    {err && !f && <p className="da-error">{err}</p>}
    <DataTable<Center> title={L('শটিং সেন্টার', 'Sorting centers')} file="sorting-centers" rows={list.data} rowKey={r => r.id}
      empty={<p className="muted">{L('এখনো কোনো শটিং সেন্টার নেই।', 'No sorting center yet.')}</p>}
      cols={[
        { key: 'code', label: L('কোড', 'Code'), value: r => r.code, render: r => <strong>{r.code}</strong> },
        { key: 'name', label: L('নাম', 'Name'), value: r => r.name },
        { key: 'zone', label: L('জোন', 'Zone'), value: r => o.names.zone[r.zone_id] ?? '' },
        { key: 'phone', label: L('ফোন', 'Phone'), value: r => r.phone ?? '' },
        { key: 'act', label: '', noExport: true, render: r => <span className="row-acts">
          {can('sorting.center.edit') && <button className="secondary sm" onClick={() => { setErr(''); setF({ ...r }) }}><Icon name="edit" size={14} />{L('এডিট', 'Edit')}</button>}
          {can('sorting.center.archive') && <button className="secondary sm" onClick={() => void remove(r)}><Icon name="trash" size={14} />{L('ডিলিট', 'Delete')}</button>}</span> },
      ]} />
    {f && <Modal title={f.id ? L('সেন্টার এডিট', 'Edit center') : L('নতুন শটিং সেন্টার', 'New sorting center')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('কোড', 'Code')}><input value={f.code ?? ''} onChange={e => setF({ ...f, code: e.target.value })} placeholder="NAT-SC" /></Field>
        <Field label={L('নাম', 'Name')}><input value={f.name ?? ''} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={L('জোন', 'Zone')}><select value={f.zone_id ?? ''} onChange={e => setF({ ...f, zone_id: e.target.value })}>
          <option value="">{L('বেছে নিন…', 'Choose…')}</option>{o.data?.zones.filter(z => !z.archived_at).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
        <Field label={L('ফোন', 'Phone')}><input inputMode="tel" value={f.phone ?? ''} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={L('ঠিকানা', 'Address')} wide><input value={f.address ?? ''} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}

// ---------------------------------------------------------------- routes
function Routes({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const routesQ = useLoad(() => sorting.routes(ctx.center.id), [ctx.center.id])
  const rh = useLoad(() => sorting.routeHubs((routesQ.data ?? []).map(r => r.id)), [routesQ.data])
  const vehicles = useLoad(() => sorting.vehicles().catch(() => []), [])
  const drivers = useLoad(() => sorting.employeesByIds((routesQ.data ?? []).map(r => r.driver_id ?? '')).catch(() => [] as EmpLite[]), [routesQ.data])
  const dName = Object.fromEntries((drivers.data ?? []).map(e => [e.id, e])) as Record<string, EmpLite>
  const vName = Object.fromEntries((vehicles.data ?? []).map(v => [v.id, v.name])) as Record<string, string>
  const hubsOf = (id: string) => (rh.data ?? []).filter(x => x.route_id === id)
  type F = { id?: string; code: string; name: string; vehicle_id: string; driver: EmpLite | null; depart_time: string; note: string; hubs: Array<{ hub_id: string; can_charge: boolean }> }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const edit = can('sorting.center.edit')
  async function save() {
    if (!f) return
    if (!f.code.trim() || f.name.trim().length < 2) return setErr(L('রুটের কোড ও নাম দিন', 'Give route code and name'))
    if (!f.hubs.length) return setErr(L('অন্তত একটা হাব বেছে নিন', 'Choose at least one hub'))
    setBusy(true); setErr('')
    try {
      await sorting.saveRoute({ center_id: ctx.center.id, zone_id: ctx.center.zone_id, code: f.code.trim().toUpperCase(), name: f.name.trim(), vehicle_id: f.vehicle_id || null,
        driver_id: f.driver?.id ?? null, depart_time: f.depart_time || null, note: f.note.trim() || null }, f.hubs, f.id)
      setF(null); await routesQ.reload(); toast(L('রুট সেভ হয়েছে', 'Route saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(r: Route) {
    const why = window.prompt(L(`"${r.name}" রুট সরানোর কারণ`, `Why remove "${r.name}"?`)) ?? ''
    if (!why.trim()) return
    try { await sorting.archiveRoute(r.id, why.trim()); await routesQ.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  const [view, setView] = useState<'map' | 'list'>('map')
  const toggleHub = (id: string) => f && setF({ ...f, hubs: f.hubs.some(h => h.hub_id === id) ? f.hubs.filter(h => h.hub_id !== id) : [...f.hubs, { hub_id: id, can_charge: false }] })
  return <>{node}
    <section className="panel">
      <div className="da-bar"><h2>{L('শটিং টু হাব রুট', 'Sorting to hub routes')} <span className="count-pill">{n(routesQ.data?.length ?? 0)}</span></h2>
        <span className="row-acts"><span className="da-seg"><button className={view === 'map' ? 'sm' : 'secondary sm'} onClick={() => setView('map')}><Icon name="map" size={14} />{L('ছবি', 'Map')}</button>
          <button className={view === 'list' ? 'sm' : 'secondary sm'} onClick={() => setView('list')}><Icon name="table" size={14} />{L('তালিকা', 'List')}</button></span>
        {edit && <button onClick={() => { setErr(''); setF({ code: '', name: '', vehicle_id: '', driver: null, depart_time: '', note: '', hubs: [] }) }}><Icon name="plus" size={15} />{L('নতুন রুট', 'New route')}</button>}</span></div>
      {err && !f && <p className="da-error">{err}</p>}
      {routesQ.data && !routesQ.data.length ? <p className="muted">{L('এখনো কোনো রুট নেই।', 'No routes yet.')}</p> : view === 'map' ?
        <RouteViz start={ctx.center.name} lanes={(routesQ.data ?? []).map(r => ({ id: r.id, code: r.code, name: r.name,
          sub: [r.vehicle_id && vName[r.vehicle_id], r.driver_id && empLabel(dName[r.driver_id]), r.depart_time && `${L('ছাড়ে', 'Leaves')} ${r.depart_time.slice(0, 5)}`].filter(Boolean).join(' · '),
          stops: hubsOf(r.id).map(h => ({ id: h.id, label: ctx.hubName[h.hub_id] ?? '—', flag: h.can_charge ? L('৳ খরচ হাব থেকে', '৳ cost from hub') : undefined })) }))} /> :
        <div className="route-cards">{routesQ.data?.map(r => <article key={r.id} className="route-card">
          <header><span className="ti"><Icon name="map" size={18} /></span><div style={{ flex: 1, minWidth: 0 }}><b>{r.code} · {r.name}</b>
            <div className="muted small">{[r.vehicle_id && vName[r.vehicle_id], r.driver_id && empLabel(dName[r.driver_id]), r.depart_time && `${L('ছাড়ে', 'Leaves')} ${r.depart_time.slice(0, 5)}`].filter(Boolean).join(' · ') || '—'}</div></div>
            {edit && <span className="row-acts">
              <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, code: r.code, name: r.name, vehicle_id: r.vehicle_id ?? '', driver: r.driver_id ? dName[r.driver_id] ?? null : null,
                depart_time: r.depart_time?.slice(0, 5) ?? '', note: r.note ?? '', hubs: hubsOf(r.id).map(h => ({ hub_id: h.hub_id, can_charge: h.can_charge })) }) }}><Icon name="edit" size={14} /></button>
              {can('sorting.center.archive') && <button className="secondary sm" onClick={() => void remove(r)}><Icon name="trash" size={14} /></button>}</span>}
          </header>
          <ol className="route-hubs">{hubsOf(r.id).map((h: RouteHub) => <li key={h.id}><span>{ctx.hubName[h.hub_id] ?? '—'}</span>
            {h.can_charge && <Badge tone="info">{L('গাড়ি খরচ হাবের খাতা থেকে', 'Cost from hub sheet')}</Badge>}</li>)}</ol>
        </article>)}</div>}
    </section>
    {f && <Modal wide title={f.id ? L('রুট এডিট', 'Edit route') : L('নতুন রুট', 'New route')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('কোড', 'Code')}><input value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="R1" /></Field>
        <Field label={L('রুটের নাম', 'Route name')}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={L('যেমন নাটোর → সিংড়া', 'e.g. Natore → Singra')} /></Field>
        <Field label={L('ছাড়ার সময়', 'Leaves at')}><input type="time" value={f.depart_time} onChange={e => setF({ ...f, depart_time: e.target.value })} /></Field>
        <Field label={L('গাড়ি', 'Vehicle')}><select value={f.vehicle_id} onChange={e => setF({ ...f, vehicle_id: e.target.value })}><option value="">—</option>
          {vehicles.data?.map(v => <option key={v.id} value={v.id}>{v.name}{v.reg_no ? ` (${v.reg_no})` : ''}</option>)}</select></Field>
        <EmpPicker label={L('ড্রাইভার (আইডি)', 'Driver (ID)')} value={f.driver} onPick={e => setF({ ...f, driver: e })} />
        <Field label={L('নোট', 'Note')}><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <h3>{L('রুটের হাব (ক্রম অনুযায়ী টিক দিন)', 'Hubs on the route (tick in order)')}</h3>
      <div className="pick-list">{ctx.hubs.map(h => { const on = f.hubs.find(x => x.hub_id === h.id); const i = f.hubs.findIndex(x => x.hub_id === h.id)
        return <div key={h.id} className={`pick-row${on ? ' on' : ''}`}>
          <label><input type="checkbox" checked={!!on} onChange={() => toggleHub(h.id)} /> {on ? <b>{n(i + 1)}.</b> : null} {h.name}</label>
          {on && <label className="small"><input type="checkbox" checked={on.can_charge}
            onChange={e => setF({ ...f, hubs: f.hubs.map(x => x.hub_id === h.id ? { ...x, can_charge: e.target.checked } : x) })} /> {L('গাড়ি খরচ এই হাবের খাতা থেকে নেওয়া যাবে', 'Vehicle cost may come from this hub’s sheet')}</label>}
        </div> })}</div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- staff
function Staff({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const q = useLoad(() => sorting.staff(ctx.center.id), [ctx.center.id])
  const emps = useLoad(() => sorting.employeesByIds((q.data ?? []).map(s => s.employee_id)), [q.data])
  const emp = Object.fromEntries((emps.data ?? []).map(e => [e.id, e])) as Record<string, EmpLite>
  const [role, setRole] = useState<string | null>(null)
  const [f, setF] = useState<{ id?: string; emp: EmpLite | null; role: string; shift: string; duties: string } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const rows = (q.data ?? []).filter(s => !role || s.role === role)
  const counts = Object.keys(ROLE).map(k => [k, (q.data ?? []).filter(s => s.role === k).length] as const).filter(x => x[1] > 0)
  async function save() {
    if (!f) return
    if (!f.id && !f.emp) return setErr(L('এমপ্লয়ি আইডি দিন', 'Give the employee ID'))
    setBusy(true); setErr('')
    try {
      if (f.id) await sorting.updateStaff(f.id, { role: f.role, shift: f.shift.trim() || null, duties: f.duties.trim() || null })
      else await sorting.addStaff({ center_id: ctx.center.id, zone_id: ctx.center.zone_id, employee_id: f.emp!.id, role: f.role, shift: f.shift.trim() || null, duties: f.duties.trim() || null })
      setF(null); await q.reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function end(s: StaffRow) {
    const r = window.prompt(L('কেন সরাচ্ছেন?', 'Why remove?')) ?? ''
    if (!r.trim()) return
    try { await sorting.endStaff(s.id, r.trim()); await q.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  const editable = can('sorting.staff.edit')
  return <>{node}
    <section className="panel">
      <div className="da-bar"><h2>{L('শটিং সেন্টারের স্টাফ', 'Sorting staff')} <span className="count-pill">{n(q.data?.length ?? 0)}</span></h2>
        {editable && <button onClick={() => { setErr(''); setF({ emp: null, role: 'sorter', shift: '', duties: '' }) }}><Icon name="plus" size={15} />{L('স্টাফ যোগ', 'Add staff')}</button>}</div>
      <div className="team-cards">
        <button type="button" className={`team-card all${role === null ? ' on' : ''}`} onClick={() => setRole(null)}><span className="ti"><Icon name="users" size={22} /></span>
          <span className="tn">{L('সবাই', 'Everyone')}</span><span className="tc">{n(q.data?.length ?? 0)}</span></button>
        {counts.map(([k, c]) => <button key={k} type="button" className={`team-card${role === k ? ' on' : ''}`} onClick={() => setRole(role === k ? null : k)}>
          <span className="ti"><Icon name={ROLE[k][2]} size={22} /></span><span className="tn">{L(ROLE[k][0], ROLE[k][1])}</span><span className="tc">{n(c)}</span></button>)}
      </div>
    </section>
    <section className="panel">
      {err && !f && <p className="da-error">{err}</p>}
      <DataTable<StaffRow> title={`${L('শটিং স্টাফ', 'Sorting staff')} — ${ctx.center.name}`} file="sorting-staff" rows={q.data ? rows : null} rowKey={r => r.id}
        empty={<p className="muted">{L('এখানে কেউ নেই।', 'Nobody here.')}</p>}
        cols={[
          { key: 'code', label: L('আইডি', 'ID'), value: r => emp[r.employee_id]?.employee_code ?? '' },
          { key: 'name', label: L('নাম', 'Name'), value: r => emp[r.employee_id]?.full_name ?? '' },
          { key: 'role', label: L('কাজ', 'Role'), value: r => L(ROLE[r.role]?.[0] ?? r.role, ROLE[r.role]?.[1] ?? r.role) },
          { key: 'shift', label: L('শিফট', 'Shift'), value: r => r.shift ?? '' },
          { key: 'duties', label: L('কাজের বিবরণ', 'Duties'), value: r => r.duties ?? '', render: r => r.duties ? <span className="pre-wrap">{r.duties}</span> : <span className="muted">—</span> },
          { key: 'mobile', label: L('মোবাইল', 'Mobile'), value: r => emp[r.employee_id]?.mobile ?? '' },
          ...(editable ? [{ key: 'act', label: '', noExport: true, render: (r: StaffRow) => <span className="row-acts">
            <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, emp: emp[r.employee_id] ?? null, role: r.role, shift: r.shift ?? '', duties: r.duties ?? '' }) }}><Icon name="edit" size={14} /></button>
            <button className="secondary sm" onClick={() => void end(r)}><Icon name="trash" size={14} /></button></span> }] : []),
        ]} />
    </section>
    {f && <Modal title={f.id ? L('স্টাফ এডিট', 'Edit staff') : L('স্টাফ যোগ', 'Add staff')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {f.id ? <Field label={L('কর্মী', 'Staff')}><input value={empLabel(f.emp ?? undefined)} disabled /></Field>
          : <EmpPicker label={L('এমপ্লয়ি আইডি', 'Employee ID')} value={f.emp} onPick={e => setF({ ...f, emp: e })} />}
        <Field label={L('কাজ', 'Role')}><select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
          {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('শিফট', 'Shift')}><input value={f.shift} onChange={e => setF({ ...f, shift: e.target.value })} placeholder={L('যেমন রাত ৮টা–ভোর ৪টা', 'e.g. 8pm–4am')} /></Field>
        <Field label={L('কাজের বিবরণ', 'Duties')} wide><textarea rows={4} value={f.duties} onChange={e => setF({ ...f, duties: e.target.value })}
          placeholder={L('যেমন: রাজশাহী থেকে আসা ব্যাগ খোলা, রুট অনুযায়ী পার্সেল সাজানো…', 'e.g. open bags, sort parcels by route…')} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- fuel
function FuelPage({ ctx }: { ctx: Ctx }) {
  const { can, session } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const q = useLoad(() => sorting.fuel(ctx.center.id, ctx.from, ctx.to), [ctx.center.id, ctx.from, ctx.to])
  const refs = useRefs(ctx.center.id, (q.data ?? []).map(r => r.employee_id))
  type F = { id?: string; kind: string; route: string; vehicle: string; emp: EmpLite | null; fuelDate: string; litres: string; rate: string; amount: string
    odometer: string; pump: string; slipNo: string; slipPath: string | null; file: File | null; note: string; chargeHub: string }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const rows = q.data ?? []
  const chargeable = (route: string) => (refs.rh.data ?? []).filter(h => h.can_charge && (!route || h.route_id === route))
  async function save() {
    if (!f) return
    const litres = num(f.litres), rate = num(f.rate)
    const amount = num(f.amount) ?? (litres && rate ? Math.round(litres * rate * 100) / 100 : null)
    if (!amount || amount <= 0) return setErr(L('টাকার অঙ্ক দিন', 'Give the amount'))
    setBusy(true); setErr('')
    try {
      const slip = f.file ? await sorting.uploadSlip(f.file) : f.slipPath
      await sorting.saveFuel({ center: ctx.center.id, amount, kind: f.kind, route: f.route || null, vehicle: f.vehicle || null, employeeCode: f.emp?.employee_code ?? null,
        fuelDate: f.fuelDate || null, litres, rate, odometer: num(f.odometer), pump: f.pump || null, slipNo: f.slipNo || null, slipPath: slip,
        note: f.note || null, chargeHub: f.chargeHub || null, id: f.id })
      setF(null); await q.reload(); toast(L('রিকুয়েস্ট সেভ হয়েছে', 'Request saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function decide(r: Fuel, ok: boolean) {
    const note = window.prompt(ok ? (r.charge_to === 'hub' ? L(`অনুমোদন দিলে টাকাটা ${ctx.hubName[r.charge_hub_id!] ?? ''} হাবের খাতায় "কর্মীর বিল" হিসেবে যাবে। নোট (ইচ্ছা হলে):`, 'On approval it goes to the hub sheet as a staff bill. Note (optional):') : L('নোট (ইচ্ছা হলে)', 'Note (optional)'))
      : L('বাতিলের কারণ', 'Reason for rejecting'))
    if (note === null || (!ok && !note.trim())) return
    setErr('')
    try { await sorting.decideFuel(r.id, ok, note.trim() || null); await q.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  async function withdraw(r: Fuel) {
    const why = window.prompt(L('কেন তুলে নিচ্ছেন?', 'Why withdraw?')) ?? ''
    if (!why.trim()) return
    try { await sorting.withdrawFuel(r.id, why.trim()); await q.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  async function openSlip(path: string) { try { window.open(await sorting.slipUrl(path), '_blank', 'noopener') } catch (e) { setErr(hrFriendly(e)) } }
  const sum = (s: Fuel['status']) => rows.filter(r => r.status === s).reduce((a, r) => a + Number(r.amount), 0)
  const litres = rows.filter(r => r.status === 'approved').reduce((a, r) => a + Number(r.litres ?? 0), 0)
  const blank = (): F => ({ kind: 'fuel', route: '', vehicle: '', emp: null, fuelDate: today(), litres: '', rate: '', amount: '', odometer: '', pump: '', slipNo: '', slipPath: null, file: null, note: '', chargeHub: '' })
  return <>{node}
    <div className="da-stats">
      <Stat icon="receipt" tone={sum('submitted') ? 'warn' : undefined} label={L('অপেক্ষায়', 'Waiting')} value={taka(sum('submitted'))} sub={`${n(rows.filter(r => r.status === 'submitted').length)} ${L('টি', '')}`} />
      <Stat icon="check" tone="ok" label={L('অনুমোদিত', 'Approved')} value={taka(sum('approved'))} />
      <Stat icon="truck" label={L('তেল (লিটার)', 'Fuel (litres)')} value={n(litres)} />
      <Stat icon="hub" label={L('হাবের খাতায় গেছে', 'Sent to hub sheets')} value={taka(rows.filter(r => r.status === 'approved' && r.charge_to === 'hub').reduce((a, r) => a + Number(r.amount), 0))} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('তেলের স্লিপ ও খরচ রিকুয়েস্ট', 'Fuel slips & expense requests')}</h2>
        {can('sorting.fuel.create') && <button onClick={() => { setErr(''); setF(blank()) }}><Icon name="plus" size={15} />{L('নতুন রিকুয়েস্ট', 'New request')}</button>}</div>
      {err && !f && <p className="da-error">{err}</p>}
      {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : <DataTable<Fuel> title={L('তেল ও খরচ', 'Fuel & expenses')} file={`sorting-fuel-${ctx.from}`} rows={q.data} rowKey={r => r.id}
        empty={<p className="muted">{L('এই সময়ে কোনো রিকুয়েস্ট নেই।', 'No requests in this period.')}</p>}
        cols={[
          { key: 'no', label: '#', value: r => r.no },
          { key: 'date', label: L('তেল তোলার তারিখ', 'Fuel date'), value: r => r.fuel_date ?? r.request_date },
          { key: 'kind', label: L('ধরন', 'Kind'), value: r => L(FUEL_KIND[r.kind]?.[0] ?? r.kind, FUEL_KIND[r.kind]?.[1] ?? r.kind) },
          { key: 'route', label: L('রুট / গাড়ি', 'Route / vehicle'), value: r => [r.route_id && refs.routeName[r.route_id], r.vehicle_id && refs.vehName[r.vehicle_id]].filter(Boolean).join(' · ') },
          { key: 'who', label: L('কে তুলেছে', 'By'), value: r => empLabel(refs.emp[r.employee_id ?? '']) },
          { key: 'litres', label: L('লিটার × দর', 'L × rate'), value: r => r.litres ? `${r.litres} × ${r.rate ?? '—'}` : '' },
          { key: 'amount', label: L('টাকা', 'Amount'), className: 'r', value: r => taka(r.amount) },
          { key: 'charge', label: L('খরচ যাবে', 'Charged to'), value: r => r.charge_to === 'hub' ? `${L('হাব', 'Hub')}: ${ctx.hubName[r.charge_hub_id ?? ''] ?? ''}` : L('শটিং', 'Sorting') },
          { key: 'status', label: L('অবস্থা', 'Status'), value: r => L(FUEL_STATUS[r.status][0], FUEL_STATUS[r.status][1]),
            render: r => <><Badge tone={FUEL_STATUS[r.status][2]}>{L(FUEL_STATUS[r.status][0], FUEL_STATUS[r.status][1])}</Badge>{r.review_note && <span className="sec">{r.review_note}</span>}</> },
          { key: 'act', label: '', noExport: true, render: r => <span className="row-acts">
            {r.slip_path && <button className="secondary sm" onClick={() => void openSlip(r.slip_path!)}><Icon name="eye" size={14} />{L('স্লিপ', 'Slip')}</button>}
            {r.status === 'submitted' && can('sorting.fuel.approve') && <><button className="secondary sm" onClick={() => void decide(r, true)}><Icon name="check" size={14} />{L('অনুমোদন', 'Approve')}</button>
              <button className="secondary sm" onClick={() => void decide(r, false)}>{L('বাতিল', 'Reject')}</button></>}
            {r.status === 'submitted' && can('sorting.fuel.create') && <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, kind: r.kind, route: r.route_id ?? '', vehicle: r.vehicle_id ?? '',
              emp: refs.emp[r.employee_id ?? ''] ?? null, fuelDate: r.fuel_date ?? '', litres: r.litres?.toString() ?? '', rate: r.rate?.toString() ?? '', amount: String(r.amount),
              odometer: r.odometer_km?.toString() ?? '', pump: r.pump_name ?? '', slipNo: r.slip_no ?? '', slipPath: r.slip_path, file: null, note: r.note ?? '', chargeHub: r.charge_hub_id ?? '' }) }}><Icon name="edit" size={14} /></button>}
            {r.status === 'submitted' && (r.created_by === session?.user.id || can('sorting.fuel.approve')) && <button className="secondary sm" onClick={() => void withdraw(r)}><Icon name="trash" size={14} /></button>}
          </span> },
        ]} />}
    </section>
    {f && <Modal wide title={f.id ? L('রিকুয়েস্ট এডিট', 'Edit request') : L('তেলের স্লিপ / খরচ রিকুয়েস্ট', 'Fuel slip / expense request')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('খরচের ধরন', 'Kind')}><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
          {Object.entries(FUEL_KIND).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('রুট', 'Route')}><select value={f.route} onChange={e => setF({ ...f, route: e.target.value, chargeHub: '' })}><option value="">—</option>
          {refs.routes.data?.map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></Field>
        <Field label={L('গাড়ি', 'Vehicle')}><select value={f.vehicle} onChange={e => setF({ ...f, vehicle: e.target.value })}><option value="">—</option>
          {refs.vehicles.data?.map(v => <option key={v.id} value={v.id}>{v.name}{v.reg_no ? ` (${v.reg_no})` : ''}</option>)}</select></Field>
        <EmpPicker label={L('কে টাকা দিয়েছে/তুলেছে (আইডি)', 'Paid by (ID)')} value={f.emp} onPick={e => setF({ ...f, emp: e })} hint={L('খালি থাকলে আপনার নামে', 'Blank = you')} />
        <Field label={L('তেল তোলার তারিখ', 'Fuel date')}><input type="date" max={today()} value={f.fuelDate} onChange={e => setF({ ...f, fuelDate: e.target.value })} /></Field>
        {f.kind === 'fuel' && <><Field label={L('লিটার', 'Litres')}><input inputMode="decimal" value={f.litres} onChange={e => setF({ ...f, litres: e.target.value })} /></Field>
          <Field label={L('দর (৳/লিটার)', 'Rate (৳/L)')}><input inputMode="decimal" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} /></Field>
          <Field label={L('মিটার (কিমি)', 'Odometer (km)')}><input inputMode="decimal" value={f.odometer} onChange={e => setF({ ...f, odometer: e.target.value })} /></Field>
          <Field label={L('পাম্পের নাম', 'Pump')}><input value={f.pump} onChange={e => setF({ ...f, pump: e.target.value })} /></Field></>}
        <Field label={L('মোট টাকা', 'Amount (৳)')} hint={!f.amount && num(f.litres) && num(f.rate) ? `= ${taka((num(f.litres) ?? 0) * (num(f.rate) ?? 0))}` : undefined}>
          <input inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={L('স্লিপ নম্বর', 'Slip no.')}><input value={f.slipNo} onChange={e => setF({ ...f, slipNo: e.target.value })} /></Field>
        <Field label={L('স্লিপের ছবি', 'Slip photo')} hint={f.slipPath && !f.file ? L('আগের ছবি আছে', 'A photo is attached') : undefined}>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={e => setF({ ...f, file: e.target.files?.[0] ?? null })} /></Field>
        <Field label={L('খরচ কোথা থেকে যাবে', 'Charge to')} hint={chargeable(f.route).length ? undefined : L('রুটে "গাড়ি খরচ হাবের খাতা থেকে" চালু করা হাব নেই', 'No hub on this route allows it')}>
          <select value={f.chargeHub} onChange={e => setF({ ...f, chargeHub: e.target.value })}><option value="">{L('শটিং সেন্টারের হিসাবে', 'Sorting center')}</option>
            {[...new Map<string, RouteHub>(chargeable(f.route).map(h => [h.hub_id, h] as [string, RouteHub])).values()].map(h => <option key={h.hub_id} value={h.hub_id}>{L('হাবের খাতা', 'Hub sheet')}: {ctx.hubName[h.hub_id]}</option>)}</select></Field>
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- parcels
function Parcels({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const q = useLoad(() => sorting.handovers(ctx.center.id, ctx.from, ctx.to), [ctx.center.id, ctx.from, ctx.to])
  const refs = useRefs(ctx.center.id, (q.data ?? []).map(r => r.driver_id))
  const [dir, setDir] = useState<'' | Handover['direction']>('')
  type F = { id?: string; direction: Handover['direction']; route: string; hub: string; date: string; vehicle: string; driver: EmpLite | null; by: string
    parcels: string; bags: string; wrong: string; returned: string; damaged: string; note: string }
  const [f, setF] = useState<F | null>(null)
  const [rc, setRc] = useState<{ row: Handover; count: string; wrong: string; returned: string; damaged: string; note: string } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const rows = (q.data ?? []).filter(r => !dir || r.direction === dir)
  const hubsOfRoute = (route: string) => route ? (refs.rh.data ?? []).filter(h => h.route_id === route).map(h => h.hub_id) : ctx.hubs.map(h => h.id)
  async function save() {
    if (!f) return
    if (!f.hub) return setErr(L('হাব বেছে নিন', 'Choose the hub'))
    const parcels = num(f.parcels)
    if (parcels === null || parcels < 0) return setErr(L('পার্সেল সংখ্যা দিন', 'Give the parcel count'))
    setBusy(true); setErr('')
    try {
      await sorting.saveHandover({ center_id: ctx.center.id, zone_id: ctx.center.zone_id, route_id: f.route || null, hub_id: f.hub, direction: f.direction, work_date: f.date,
        vehicle_id: f.vehicle || null, driver_id: f.driver?.id ?? null, handed_by_name: f.by.trim() || null, parcel_count: parcels, bag_count: num(f.bags),
        wrong_count: num(f.wrong) ?? 0, returned_count: num(f.returned) ?? 0, damaged_count: num(f.damaged) ?? 0, note: f.note.trim() || null }, f.id)
      setF(null); await q.reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function receive() {
    if (!rc) return
    const c = num(rc.count)
    if (c === null) return setErr(L('কয়টা বুঝে পেলেন লিখুন', 'Give the count received'))
    setBusy(true); setErr('')
    try { await sorting.receive(rc.row.id, c, num(rc.wrong), num(rc.returned), num(rc.damaged), rc.note.trim() || null); setRc(null); await q.reload(); toast(L('বুঝে নেওয়া হয়েছে', 'Received')) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  const t = (k: 'parcel_count' | 'wrong_count' | 'returned_count' | 'damaged_count', d?: Handover['direction']) => (q.data ?? []).filter(r => !d || r.direction === d).reduce((a, r) => a + r[k], 0)
  const creator = can('sorting.parcel.create')
  return <>{node}
    <div className="da-stats">
      <Stat icon="box" label={L('হাব → শটিং', 'Hub → sorting')} value={n(t('parcel_count', 'hub_to_sorting'))} />
      <Stat icon="truck" label={L('শটিং → হাব', 'Sorting → hub')} value={n(t('parcel_count', 'sorting_to_hub'))} />
      <Stat icon="alert" tone={t('wrong_count') ? 'warn' : undefined} label={L('ভুল', 'Wrong')} value={n(t('wrong_count'))} />
      <Stat icon="back" tone={t('returned_count') ? 'warn' : undefined} label={L('ব্যাক', 'Returned')} value={n(t('returned_count'))} />
      <Stat icon="x" tone={t('damaged_count') ? 'bad' : undefined} label={L('ড্যামেজ', 'Damaged')} value={n(t('damaged_count'))} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('পার্সেল আদান-প্রদান', 'Parcel handovers')}</h2><span className="row-acts">
        <span className="da-seg">{([['', 'সব', 'All'], ['hub_to_sorting', 'হাব → শটিং', 'Hub → sorting'], ['sorting_to_hub', 'শটিং → হাব', 'Sorting → hub']] as const).map(([k, b, e]) =>
          <button key={k} className={dir === k ? 'sm' : 'secondary sm'} onClick={() => setDir(k)}>{L(b, e)}</button>)}</span>
        {creator && <button onClick={() => { setErr(''); setF({ direction: dir || 'sorting_to_hub', route: '', hub: '', date: today(), vehicle: '', driver: null, by: '', parcels: '', bags: '', wrong: '', returned: '', damaged: '', note: '' }) }}>
          <Icon name="plus" size={15} />{L('নতুন এন্ট্রি', 'New entry')}</button>}</span></div>
      {err && !f && !rc && <p className="da-error">{err}</p>}
      {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : <DataTable<Handover> title={L('পার্সেল আদান-প্রদান', 'Parcel handovers')} file={`sorting-parcels-${ctx.from}`} rows={q.data ? rows : null} rowKey={r => r.id}
        empty={<p className="muted">{L('এই সময়ে কোনো এন্ট্রি নেই।', 'No entries in this period.')}</p>}
        cols={[
          { key: 'date', label: L('তারিখ', 'Date'), value: r => r.work_date },
          { key: 'dir', label: L('দিক', 'Direction'), value: r => r.direction === 'hub_to_sorting' ? L('হাব → শটিং', 'Hub → sorting') : L('শটিং → হাব', 'Sorting → hub') },
          { key: 'route', label: L('রুট', 'Route'), value: r => r.route_id ? refs.routeName[r.route_id] ?? '' : '' },
          { key: 'hub', label: L('হাব', 'Hub'), value: r => ctx.hubName[r.hub_id] ?? '' },
          { key: 'by', label: L('কে দিয়েছে', 'Handed by'), value: r => [r.handed_by_name, r.driver_id && empLabel(refs.emp[r.driver_id])].filter(Boolean).join(' · ') },
          { key: 'parcels', label: L('পার্সেল', 'Parcels'), className: 'r', value: r => n(r.parcel_count), render: r => <>{n(r.parcel_count)}{r.received_count !== null && r.received_count !== r.parcel_count && <span className="sec bad">{L('পেয়েছে', 'got')} {n(r.received_count)}</span>}</> },
          { key: 'wrong', label: L('ভুল', 'Wrong'), className: 'r', value: r => n(r.wrong_count), render: r => <span className={r.wrong_count ? 'bad' : ''}>{n(r.wrong_count)}</span> },
          { key: 'ret', label: L('ব্যাক', 'Back'), className: 'r', value: r => n(r.returned_count), render: r => <span className={r.returned_count ? 'bad' : ''}>{n(r.returned_count)}</span> },
          { key: 'dmg', label: L('ড্যামেজ', 'Dmg'), className: 'r', value: r => n(r.damaged_count), render: r => <span className={r.damaged_count ? 'bad' : ''}>{n(r.damaged_count)}</span> },
          { key: 'status', label: L('অবস্থা', 'Status'), value: r => L(HO_STATUS[r.status][0], HO_STATUS[r.status][1]),
            render: r => <><Badge tone={HO_STATUS[r.status][2]}>{L(HO_STATUS[r.status][0], HO_STATUS[r.status][1])}</Badge>{r.received_by_name && <span className="sec">{r.received_by_name}</span>}</> },
          ...(creator ? [{ key: 'act', label: '', noExport: true, render: (r: Handover) => r.status === 'sent' ? <span className="row-acts">
            <button className="secondary sm" onClick={() => { setErr(''); setRc({ row: r, count: String(r.parcel_count), wrong: '', returned: '', damaged: '', note: '' }) }}><Icon name="check" size={14} />{L('বুঝে নিন', 'Receive')}</button>
            <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, direction: r.direction, route: r.route_id ?? '', hub: r.hub_id, date: r.work_date, vehicle: r.vehicle_id ?? '',
              driver: r.driver_id ? refs.emp[r.driver_id] ?? null : null, by: r.handed_by_name ?? '', parcels: String(r.parcel_count), bags: r.bag_count?.toString() ?? '',
              wrong: String(r.wrong_count || ''), returned: String(r.returned_count || ''), damaged: String(r.damaged_count || ''), note: r.note ?? '' }) }}><Icon name="edit" size={14} /></button></span> : null }] : []),
        ]} />}
    </section>
    {f && <Modal wide title={f.id ? L('এন্ট্রি এডিট', 'Edit entry') : L('পার্সেল আদান-প্রদান', 'Parcel handover')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('দিক', 'Direction')}><select value={f.direction} onChange={e => setF({ ...f, direction: e.target.value as Handover['direction'] })}>
          <option value="sorting_to_hub">{L('শটিং → হাব', 'Sorting → hub')}</option><option value="hub_to_sorting">{L('হাব → শটিং', 'Hub → sorting')}</option></select></Field>
        <Field label={L('রুট', 'Route')}><select value={f.route} onChange={e => { const r = refs.routes.data?.find(x => x.id === e.target.value)
          setF({ ...f, route: e.target.value, hub: '', vehicle: f.vehicle || r?.vehicle_id || '' }) }}><option value="">—</option>
          {refs.routes.data?.map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></Field>
        <Field label={L('হাব', 'Hub')}><select value={f.hub} onChange={e => setF({ ...f, hub: e.target.value })}><option value="">{L('বেছে নিন…', 'Choose…')}</option>
          {hubsOfRoute(f.route).map(id => <option key={id} value={id}>{ctx.hubName[id]}</option>)}</select></Field>
        <Field label={L('তারিখ', 'Date')}><input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={L('গাড়ি', 'Vehicle')}><select value={f.vehicle} onChange={e => setF({ ...f, vehicle: e.target.value })}><option value="">—</option>
          {refs.vehicles.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <EmpPicker label={L('ড্রাইভার (আইডি)', 'Driver (ID)')} value={f.driver} onPick={e => setF({ ...f, driver: e })} />
        <Field label={L('কে দিয়েছে (নাম)', 'Handed by (name)')}><input value={f.by} onChange={e => setF({ ...f, by: e.target.value })} /></Field>
        <Field label={L('পার্সেল সংখ্যা', 'Parcels')}><input inputMode="numeric" value={f.parcels} onChange={e => setF({ ...f, parcels: e.target.value })} /></Field>
        <Field label={L('ব্যাগ', 'Bags')}><input inputMode="numeric" value={f.bags} onChange={e => setF({ ...f, bags: e.target.value })} /></Field>
        <Field label={L('ভুল পার্সেল', 'Wrong parcels')}><input inputMode="numeric" value={f.wrong} onChange={e => setF({ ...f, wrong: e.target.value })} /></Field>
        <Field label={L('ব্যাক দিয়েছে', 'Returned')}><input inputMode="numeric" value={f.returned} onChange={e => setF({ ...f, returned: e.target.value })} /></Field>
        <Field label={L('ড্যামেজ', 'Damaged')}><input inputMode="numeric" value={f.damaged} onChange={e => setF({ ...f, damaged: e.target.value })} /></Field>
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {rc && <Modal title={L('পার্সেল বুঝে নিন', 'Receive parcels')} onClose={() => setRc(null)}
      actions={<><button className="secondary" onClick={() => setRc(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void receive()}>{L('বুঝে নিলাম', 'Received')}</button></>}>
      <p className="muted small">{ctx.hubName[rc.row.hub_id]} · {L('পাঠানো হয়েছে', 'Sent')} <b>{n(rc.row.parcel_count)}</b>. {L('সংখ্যা না মিললে "গরমিল" হিসেবে থাকবে।', 'A different count is kept as a mismatch.')}</p>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('কয়টা পেলেন', 'Received')}><input inputMode="numeric" value={rc.count} onChange={e => setRc({ ...rc, count: e.target.value })} /></Field>
        <Field label={L('ভুল', 'Wrong')}><input inputMode="numeric" value={rc.wrong} onChange={e => setRc({ ...rc, wrong: e.target.value })} placeholder={String(rc.row.wrong_count)} /></Field>
        <Field label={L('ব্যাক', 'Returned')}><input inputMode="numeric" value={rc.returned} onChange={e => setRc({ ...rc, returned: e.target.value })} placeholder={String(rc.row.returned_count)} /></Field>
        <Field label={L('ড্যামেজ', 'Damaged')}><input inputMode="numeric" value={rc.damaged} onChange={e => setRc({ ...rc, damaged: e.target.value })} placeholder={String(rc.row.damaged_count)} /></Field>
        <Field label={L('নোট', 'Note')} wide><input value={rc.note} onChange={e => setRc({ ...rc, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- driver reports
function Drivers({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const q = useLoad(() => sorting.trips(ctx.center.id, ctx.from, ctx.to), [ctx.center.id, ctx.from, ctx.to])
  const refs = useRefs(ctx.center.id, (q.data ?? []).map(r => r.driver_id))
  type F = { id?: string; route: string; date: string; driver: EmpLite | null; vehicle: string; depart: string; ret: string; startKm: string; endKm: string
    hubs: string; out: string; inn: string; status: DriverReport['status']; note: string }
  const [f, setF] = useState<F | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function save() {
    if (!f) return
    if (!f.route) return setErr(L('রুট বেছে নিন', 'Choose the route'))
    setBusy(true); setErr('')
    try {
      await sorting.saveTrip({ center_id: ctx.center.id, zone_id: ctx.center.zone_id, route_id: f.route, work_date: f.date, driver_id: f.driver?.id ?? null, vehicle_id: f.vehicle || null,
        depart_at: f.depart || null, return_at: f.ret || null, start_km: num(f.startKm), end_km: num(f.endKm), hubs_reached: num(f.hubs), parcels_out: num(f.out), parcels_in: num(f.inn),
        status: f.status, note: f.note.trim() || null }, f.id)
      setF(null); await q.reload(); toast(L('রিপোর্ট সেভ হয়েছে', 'Report saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  const rows = q.data ?? []
  const km = rows.reduce((a, r) => a + (r.end_km !== null && r.start_km !== null ? Number(r.end_km) - Number(r.start_km) : 0), 0)
  // Route-wise roll-up
  const byRoute = new Map<string, { trips: number; km: number; issues: number }>()
  for (const r of rows) { const c = byRoute.get(r.route_id) ?? { trips: 0, km: 0, issues: 0 }; c.trips++; c.km += r.end_km !== null && r.start_km !== null ? Number(r.end_km) - Number(r.start_km) : 0
    if (r.status !== 'done') c.issues++; byRoute.set(r.route_id, c) }
  return <>{node}
    <div className="da-stats">
      <Stat icon="truck" label={L('ট্রিপ', 'Trips')} value={n(rows.length)} />
      <Stat icon="map" label={L('মোট কিমি', 'Total km')} value={n(Math.round(km))} />
      <Stat icon="alert" tone={rows.some(r => r.status !== 'done') ? 'warn' : undefined} label={L('দেরি / যায়নি / নষ্ট', 'Late / missed / breakdown')} value={n(rows.filter(r => r.status !== 'done').length)} />
    </div>
    {byRoute.size > 0 && <section className="panel"><h2>{L('রুট অনুযায়ী', 'By route')}</h2>
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('রুট', 'Route')}</th><th className="r">{L('ট্রিপ', 'Trips')}</th><th className="r">{L('কিমি', 'km')}</th><th className="r">{L('সমস্যা', 'Issues')}</th></tr></thead>
        <tbody>{[...byRoute.entries()].map(([k, v]) => <tr key={k}><td><strong>{refs.routeName[k] ?? '—'}</strong></td><td className="r">{n(v.trips)}</td><td className="r">{n(Math.round(v.km))}</td>
          <td className={`r${v.issues ? ' bad' : ''}`}>{n(v.issues)}</td></tr>)}</tbody></table></div></section>}
    <section className="panel">
      <div className="da-bar"><h2>{L('ড্রাইভার রিপোর্ট', 'Driver reports')}</h2>
        {can('sorting.driver.create') && <button onClick={() => { setErr(''); setF({ route: '', date: today(), driver: null, vehicle: '', depart: '', ret: '', startKm: '', endKm: '', hubs: '', out: '', inn: '', status: 'done', note: '' }) }}>
          <Icon name="plus" size={15} />{L('নতুন রিপোর্ট', 'New report')}</button>}</div>
      {err && !f && <p className="da-error">{err}</p>}
      {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : <DataTable<DriverReport> title={L('ড্রাইভার রিপোর্ট', 'Driver reports')} file={`sorting-drivers-${ctx.from}`} rows={q.data} rowKey={r => r.id}
        empty={<p className="muted">{L('এই সময়ে কোনো রিপোর্ট নেই।', 'No reports in this period.')}</p>}
        cols={[
          { key: 'date', label: L('তারিখ', 'Date'), value: r => r.work_date },
          { key: 'route', label: L('রুট', 'Route'), value: r => refs.routeName[r.route_id] ?? '' },
          { key: 'driver', label: L('ড্রাইভার', 'Driver'), value: r => empLabel(refs.emp[r.driver_id ?? '']) },
          { key: 'veh', label: L('গাড়ি', 'Vehicle'), value: r => r.vehicle_id ? refs.vehName[r.vehicle_id] ?? '' : '' },
          { key: 'time', label: L('ছাড়া → ফেরা', 'Out → back'), value: r => `${r.depart_at?.slice(0, 5) ?? '—'} → ${r.return_at?.slice(0, 5) ?? '—'}` },
          { key: 'km', label: L('কিমি', 'km'), className: 'r', value: r => r.end_km !== null && r.start_km !== null ? n(Number(r.end_km) - Number(r.start_km)) : '' },
          { key: 'parcels', label: L('পার্সেল গেছে/এসেছে', 'Parcels out/in'), value: r => `${r.parcels_out ?? '—'} / ${r.parcels_in ?? '—'}` },
          { key: 'status', label: L('অবস্থা', 'Status'), value: r => L(TRIP_STATUS[r.status][0], TRIP_STATUS[r.status][1]),
            render: r => <><Badge tone={TRIP_STATUS[r.status][2]}>{L(TRIP_STATUS[r.status][0], TRIP_STATUS[r.status][1])}</Badge>{r.note && <span className="sec">{r.note}</span>}</> },
          ...(can('sorting.driver.create') ? [{ key: 'act', label: '', noExport: true, render: (r: DriverReport) => <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, route: r.route_id, date: r.work_date,
            driver: refs.emp[r.driver_id ?? ''] ?? null, vehicle: r.vehicle_id ?? '', depart: r.depart_at?.slice(0, 5) ?? '', ret: r.return_at?.slice(0, 5) ?? '', startKm: r.start_km?.toString() ?? '',
            endKm: r.end_km?.toString() ?? '', hubs: r.hubs_reached?.toString() ?? '', out: r.parcels_out?.toString() ?? '', inn: r.parcels_in?.toString() ?? '', status: r.status, note: r.note ?? '' }) }}><Icon name="edit" size={14} /></button> }] : []),
        ]} />}
    </section>
    {f && <Modal wide title={f.id ? L('রিপোর্ট এডিট', 'Edit report') : L('ড্রাইভার রিপোর্ট', 'Driver report')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form">
        <Field label={L('রুট', 'Route')}><select value={f.route} onChange={e => { const r = refs.routes.data?.find(x => x.id === e.target.value)
          setF({ ...f, route: e.target.value, vehicle: f.vehicle || r?.vehicle_id || '' }) }}><option value="">{L('বেছে নিন…', 'Choose…')}</option>
          {refs.routes.data?.map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></Field>
        <Field label={L('তারিখ', 'Date')}><input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <EmpPicker label={L('ড্রাইভার (আইডি)', 'Driver (ID)')} value={f.driver} onPick={e => setF({ ...f, driver: e })} />
        <Field label={L('গাড়ি', 'Vehicle')}><select value={f.vehicle} onChange={e => setF({ ...f, vehicle: e.target.value })}><option value="">—</option>
          {refs.vehicles.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label={L('ছেড়েছে', 'Left at')}><input type="time" value={f.depart} onChange={e => setF({ ...f, depart: e.target.value })} /></Field>
        <Field label={L('ফিরেছে', 'Back at')}><input type="time" value={f.ret} onChange={e => setF({ ...f, ret: e.target.value })} /></Field>
        <Field label={L('শুরুর মিটার (কিমি)', 'Start km')}><input inputMode="decimal" value={f.startKm} onChange={e => setF({ ...f, startKm: e.target.value })} /></Field>
        <Field label={L('শেষের মিটার (কিমি)', 'End km')}><input inputMode="decimal" value={f.endKm} onChange={e => setF({ ...f, endKm: e.target.value })} /></Field>
        <Field label={L('কয়টা হাবে গেছে', 'Hubs reached')}><input inputMode="numeric" value={f.hubs} onChange={e => setF({ ...f, hubs: e.target.value })} /></Field>
        <Field label={L('পার্সেল নিয়ে গেছে', 'Parcels out')}><input inputMode="numeric" value={f.out} onChange={e => setF({ ...f, out: e.target.value })} /></Field>
        <Field label={L('পার্সেল নিয়ে এসেছে', 'Parcels in')}><input inputMode="numeric" value={f.inn} onChange={e => setF({ ...f, inn: e.target.value })} /></Field>
        <Field label={L('অবস্থা', 'Status')}><select value={f.status} onChange={e => setF({ ...f, status: e.target.value as DriverReport['status'] })}>
          {(Object.keys(TRIP_STATUS) as DriverReport['status'][]).map(k => <option key={k} value={k}>{L(TRIP_STATUS[k][0], TRIP_STATUS[k][1])}</option>)}</select></Field>
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- reports
function Reports({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs()
  const q = useLoad(() => sorting.report(ctx.center.id, ctx.from, ctx.to), [ctx.center.id, ctx.from, ctx.to])
  if (q.error) return <p className="da-error">{hrFriendly(q.error)}</p>
  return <section className="panel">
    <h2>{L('রিপোর্ট: হাব → শটিং ও শটিং → হাব', 'Report: hub → sorting and sorting → hub')}</h2>
    <p className="muted small">{L('রুট ও হাব অনুযায়ী — কোন হাব কত পার্সেল দিয়েছে, কত পেয়েছে, কত ভুল/ব্যাক/ড্যামেজ, তেল খরচ, ট্রিপ।', 'By route and hub: parcels given, received, wrong / returned / damaged, fuel, trips.')}</p>
    <DataTable<RouteReport> title={`${L('শটিং রিপোর্ট', 'Sorting report')} ${ctx.from} – ${ctx.to}`} file={`sorting-report-${ctx.from}-${ctx.to}`} rows={q.data}
      rowKey={r => `${r.route_id}-${r.hub_id}`} empty={<p className="muted">{L('এই সময়ে কিছু নেই।', 'Nothing in this period.')}</p>}
      cols={[
        { key: 'route', label: L('রুট', 'Route'), value: r => r.route_name },
        { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name },
        { key: 'in', label: L('হাব → শটিং', 'Hub → sorting'), className: 'r', value: r => n(r.to_sorting) },
        { key: 'out', label: L('শটিং → হাব', 'Sorting → hub'), className: 'r', value: r => n(r.to_hub) },
        { key: 'wrong', label: L('ভুল', 'Wrong'), className: 'r', value: r => n(r.wrong) },
        { key: 'ret', label: L('ব্যাক', 'Returned'), className: 'r', value: r => n(r.returned) },
        { key: 'dmg', label: L('ড্যামেজ', 'Damaged'), className: 'r', value: r => n(r.damaged) },
        { key: 'open', label: L('বাকি/গরমিল', 'Open/mismatch'), className: 'r', value: r => `${n(r.not_received)} / ${n(r.disputed)}` },
        { key: 'fuel', label: L('তেল/খরচ', 'Fuel'), className: 'r', value: r => taka(r.fuel) },
        { key: 'trips', label: L('ট্রিপ', 'Trips'), className: 'r', value: r => n(r.trips) },
        { key: 'km', label: L('কিমি', 'km'), className: 'r', value: r => n(r.km) },
      ]} />
  </section>
}
