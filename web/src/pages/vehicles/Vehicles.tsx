import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Badge, ErrorNote, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { autoCode, hrFriendly } from '../../lib/hr'
import { sorting, type EmpLite } from '../../lib/sorting'
import { supabase } from '../../lib/supabase'
import {
  DOC_KIND, DREQ_KIND, DREQ_STATUS, FUEL_TYPE, LOG_KIND, LOG_STATUS, OWNER_TYPE, REQ_STATUS, VEHICLE_KIND, VEHICLE_STATUS, daysUntil, monthStart, today, vehicles,
  type DayLog, type DriverRequest, type FormField, type PendingLog, type Requisition, type VehicleAlert, type VehicleDoc, type VehicleFull, type VehicleHub, type VehicleLog, type VehicleRow, type VehicleSettings,
} from '../../lib/vehicles'

type Sec = 'overview' | 'mine' | 'list' | 'logs' | 'requests' | 'daily' | 'docs' | 'reports' | 'settings'
// crew: true = a driver / helper may open it for their own vehicle even without any permission
const SECTIONS: Array<{ key: Sec; icon: string; bn: string; en: string; perms: string[]; crew?: boolean }> = [
  { key: 'overview', icon: 'dash', bn: 'গাড়ির অবস্থা', en: 'Fleet overview', perms: ['vehicle.vehicle.view', 'da.sheet.view'] },
  { key: 'mine', icon: 'user', bn: 'আমার গাড়ি', en: 'My vehicle', perms: [], crew: true },
  { key: 'list', icon: 'truck', bn: 'গাড়ির তালিকা ও কার নামে', en: 'Vehicles & crew', perms: ['vehicle.vehicle.view', 'vehicle.vehicle.create', 'da.sheet.view'] },
  { key: 'logs', icon: 'cash', bn: 'তেল / সার্ভিস / মেরামত', en: 'Fuel, service & repairs', perms: ['vehicle.log.view', 'vehicle.log.create', 'da.sheet.view'], crew: true },
  { key: 'requests', icon: 'form', bn: 'গাড়ি লাগবে (রিকুইজিশন)', en: 'Requisitions', perms: ['vehicle.requisition.view', 'vehicle.requisition.create', 'vehicle.requisition.approve'], crew: true },
  { key: 'daily', icon: 'cal', bn: 'দিনের খাতা (অটো / চার্জ)', en: 'Day log (autos)', perms: ['vehicle.log.view', 'vehicle.log.create', 'da.sheet.view'], crew: true },
  { key: 'docs', icon: 'doc', bn: 'কাগজপত্র ও মেয়াদ', en: 'Papers & expiry', perms: ['vehicle.vehicle.view', 'vehicle.document.edit', 'da.sheet.view'] },
  { key: 'reports', icon: 'chart', bn: 'খরচের রিপোর্ট', en: 'Cost report', perms: ['vehicle.log.view', 'vehicle.vehicle.view', 'da.sheet.view'] },
  { key: 'settings', icon: 'gear', bn: 'গাড়ি সেটিংস', en: 'Vehicle settings', perms: ['vehicle.settings.configure'] },
]
const HKEY = 'xzm_vehicle_hub', VKEY = 'xzm_vehicle_id'
const ask = (q: string) => (window.prompt(q) ?? '').trim()

type Ctx = { hubs: VehicleHub[]; hub: string; rows: VehicleRow[]; reload: () => Promise<void>; toast: (m: string) => void }

export function Vehicles() {
  const { section } = useParams()
  const { can } = useAuth()
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const hubsQ = useLoad(() => vehicles.hubs(), [])
  const [hub, setHub] = useState(() => { try { return sessionStorage.getItem(HKEY) ?? '' } catch { return '' } })
  useEffect(() => { try { sessionStorage.setItem(HKEY, hub) } catch { /* ignore */ } }, [hub])
  const rowsQ = useLoad(() => vehicles.overview(hub || null), [hub])
  const sec = SECTIONS.find(s => s.key === section)
  if (!sec) return <Navigate to="/app/vehicles/overview" replace />
  const hubs = hubsQ.data ?? []
  const isCrew = (rowsQ.data ?? []).some(r => r.is_crew)
  const allowed = (s: { perms: string[]; crew?: boolean }) => s.perms.some(x => can(x)) || (!!s.crew && isCrew)
  const tabs = SECTIONS.filter(allowed)
  const ctx: Ctx = { hubs, hub, rows: rowsQ.data ?? [], reload: async () => { await rowsQ.reload() }, toast }
  const hubName = hubs.find(h => h.hub_id === hub)

  return <AppShell title={L(sec.bn, sec.en)} subtitle={hubName ? `${hubName.name} #${hubName.code}` : L('সব হাব', 'All hubs')}>
    <section className="da-filters panel no-print hub-top">
      <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => setHub(e.target.value)}>
        <option value="">{L('সব হাব', 'All hubs')}</option>
        {hubs.map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} #{h.code}</option>)}</select></Field>
      <nav className="hub-tabs" aria-label={L('গাড়ি ম্যানেজমেন্ট', 'Vehicle management')}>
        {tabs.map(t => <Link key={t.key} to={`/app/vehicles/${t.key}`} className={t.key === sec.key ? 'on' : ''}><Icon name={t.icon} size={15} /><span>{L(t.bn, t.en)}</span></Link>)}
      </nav>
    </section>
    <ErrorNote error={hubsQ.error ?? rowsQ.error} />
    {rowsQ.loading && !rowsQ.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !allowed(sec) ? <p className="notice">{L('এই পাতা দেখার অনুমতি আপনার রোলে নেই।', 'Your role may not open this page.')}</p>
      : sec.key === 'overview' ? <Overview ctx={ctx} />
      : sec.key === 'mine' ? <Mine ctx={ctx} />
      : sec.key === 'list' ? <List ctx={ctx} />
      : sec.key === 'logs' ? <Logs ctx={ctx} />
      : sec.key === 'requests' ? <Requests ctx={ctx} />
      : sec.key === 'daily' ? <Daily ctx={ctx} />
      : sec.key === 'docs' ? <Docs ctx={ctx} />
      : sec.key === 'reports' ? <Reports ctx={ctx} />
      : <Settings />}
    {node}
  </AppShell>
}

// ---------------------------------------------------------------- shared bits
function useTk() {
  const { n } = usePrefs()
  return (v: number | null | undefined) => '৳' + n(Math.round(Number(v ?? 0)).toLocaleString('en-US'))
}
function StatusB({ s }: { s: string }) {
  const { L } = usePrefs(); const x = VEHICLE_STATUS[s]
  return <Badge tone={x?.[2] ?? 'neutral'}>{x ? L(x[0], x[1]) : s}</Badge>
}
function kindLabel(L: (a: string, b: string) => string, k: string) { const x = VEHICLE_KIND[k]; return x ? L(x[0], x[1]) : k }
function vLabel(v: { name: string; reg_no: string | null }) { return v.reg_no ? `${v.name} (${v.reg_no})` : v.name }

/** Vehicle picker remembered across tabs. */
function useVehiclePick(rows: VehicleRow[]) {
  const [sp] = useSearchParams()
  const [vid, setVid] = useState(() => { try { return sp.get('v') || sessionStorage.getItem(VKEY) || '' } catch { return sp.get('v') ?? '' } })
  useEffect(() => { if (rows.length && !rows.some(r => r.id === vid)) setVid(rows[0].id) }, [rows, vid])
  useEffect(() => { try { if (vid) sessionStorage.setItem(VKEY, vid) } catch { /* ignore */ } }, [vid])
  return { vid, setVid, v: rows.find(r => r.id === vid) ?? null }
}
function VehicleSelect({ rows, vid, setVid }: { rows: VehicleRow[]; vid: string; setVid: (s: string) => void }) {
  const { L } = usePrefs()
  return <Field label={L('গাড়ি', 'Vehicle')}><select value={vid} onChange={e => setVid(e.target.value)}>
    {rows.map(r => <option key={r.id} value={r.id}>{vLabel(r)}{r.holder_name ? ` — ${r.holder_name}` : ''}</option>)}</select></Field>
}

function AlertLine({ a }: { a: VehicleAlert }) {
  const { L, n } = usePrefs()
  const d = daysUntil(a.due)
  const text = a.kind === 'doc' ? `${L(DOC_KIND[a.detail?.split(' ')[0] ?? 'other']?.[0] ?? 'কাগজ', DOC_KIND[a.detail?.split(' ')[0] ?? 'other']?.[1] ?? 'Paper')}${a.detail?.includes(' ') ? ' ' + a.detail.slice(a.detail.indexOf(' ') + 1) : ''} — ${d! < 0 ? L(`${n(-d!)} দিন আগে মেয়াদ শেষ`, `expired ${-d!} days ago`) : d === 0 ? L('আজ মেয়াদ শেষ', 'expires today') : L(`${n(d!)} দিন পর মেয়াদ শেষ`, `expires in ${d} days`)}`
    : a.kind === 'service' ? L(`সার্ভিসিং বাকি — শেষ সার্ভিসের পর ${n(a.detail ?? '')}`, `Service due — ${a.detail} since last service`)
    : a.kind === 'no_holder' ? L('কারও নামে নেই', 'Nobody holds it')
    : L(VEHICLE_STATUS[a.detail ?? '']?.[0] ?? a.detail ?? '', VEHICLE_STATUS[a.detail ?? '']?.[1] ?? a.detail ?? '')
  return <li className="duty"><Badge tone={a.severity}>{a.severity === 'bad' ? '!' : a.severity === 'warn' ? '•' : 'i'}</Badge>
    <span><b>{a.vehicle}</b>{a.hub_name ? <span className="muted"> · {a.hub_name}</span> : null}<br />{text}</span></li>
}

// ---------------------------------------------------------------- overview
function Overview({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const tk = useTk()
  const alerts = useLoad(() => vehicles.alerts(ctx.hub || null), [ctx.hub, ctx.rows])
  const rows = ctx.rows
  const active = rows.filter(r => r.status === 'active')
  const month = rows.reduce((s, r) => s + Number(r.spent_month), 0)
  const d30 = rows.reduce((s, r) => s + Number(r.spent_30d), 0)
  const fuel30 = rows.reduce((s, r) => s + Number(r.fuel_30d), 0)
  const expiring = rows.reduce((s, r) => s + r.docs_expiring + r.docs_expired, 0)
  const byKind = new Map<string, number>(); for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1)
  const byHub = new Map<string, { n: number; spent: number }>(); for (const r of rows) { const k = r.hub_name ?? '—'; const c = byHub.get(k) ?? { n: 0, spent: 0 }; c.n++; c.spent += Number(r.spent_month); byHub.set(k, c) }
  return <>
    <div className="da-stats">
      <Stat icon="truck" label={L('গাড়ি', 'Vehicles')} value={n(rows.length)} sub={[...byKind].map(([k, c]) => `${kindLabel(L, k)} ${n(c)}`).join(' · ')} />
      <Stat icon="user" label={L('কারও নামে নেই', 'No holder')} tone={active.some(r => !r.holder_id) ? 'warn' : 'ok'} value={n(active.filter(r => !r.holder_id).length)} />
      <Stat icon="cash" label={L('এ মাসের খরচ', 'This month')} value={tk(month)} sub={L(`৩০ দিনে ${tk(d30)} · তেল ${tk(fuel30)}`, `30 days ${tk(d30)} · fuel ${tk(fuel30)}`)} />
      <Stat icon="alert" label={L('কাগজের মেয়াদ', 'Papers expiring')} tone={expiring ? 'bad' : 'ok'} value={n(expiring)} sub={L(`সার্ভিস বাকি ${n(rows.filter(r => r.service_due && r.status === 'active').length)}টা`, `${rows.filter(r => r.service_due && r.status === 'active').length} need service`)} />
    </div>
    <PendingPanel ctx={ctx} />
    <DriverRequests ctx={ctx} openOnly />
    <section className="panel">
      <h2>{L('যা এখনই দেখা দরকার', 'Needs attention')} <span className="count-pill">{n(alerts.data?.length ?? 0)}</span></h2>
      <p className="muted small">{L('মেয়াদ শেষ হওয়া কাগজ, সার্ভিসিং বাকি, কারও নামে নেই, গ্যারেজে — ডাটা থেকে নিজে বের করা।', 'Expiring papers, service due, no holder, in workshop — worked out from the data.')}</p>
      <ErrorNote error={alerts.error} />
      {alerts.data && !alerts.data.length ? <p className="muted">{L('সব ঠিক আছে।', 'All good.')}</p>
        : <ul className="duty-list">{(alerts.data ?? []).map((a, i) => <AlertLine key={i} a={a} />)}</ul>}
    </section>
    {!ctx.hub && byHub.size > 1 && <section className="panel"><h2>{L('হাব অনুযায়ী', 'By hub')}</h2>
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('হাব', 'Hub')}</th><th>{L('গাড়ি', 'Vehicles')}</th><th>{L('এ মাসের খরচ', 'This month')}</th></tr></thead>
        <tbody>{[...byHub].sort((a, b) => b[1].spent - a[1].spent).map(([h, c]) => <tr key={h}><td>{h}</td><td>{n(c.n)}</td><td>{tk(c.spent)}</td></tr>)}</tbody></table></div></section>}
    <section className="panel"><h2>{L('প্রতিটি গাড়ি এক নজরে', 'Each vehicle')}</h2>
      <div className="team-cards">{rows.map(r => <Link key={r.id} to="/app/vehicles/logs" onClick={() => { try { sessionStorage.setItem(VKEY, r.id) } catch { /* ignore */ } }} className="team-card" style={{ textDecoration: 'none' }}>
        <b><Icon name={VEHICLE_KIND[r.kind]?.[2] ?? 'truck'} size={14} /> {vLabel(r)}</b>
        <span className="muted small">{r.hub_name ?? '—'} · {kindLabel(L, r.kind)}</span>
        <span>{r.holder_name ? <>{r.holder_name} <span className="muted small">ID {r.holder_code}</span></> : <span className="bad">{L('ড্রাইভার নেই', 'no driver')}</span>}{r.helper_name ? <span className="muted small"> · {L('হেল্পার', 'helper')} {r.helper_name}</span> : null}</span>
        {r.served_hubs && <span className="muted small">{L('কাজ করে', 'serves')}: {r.served_hubs}</span>}
        <span className="small">{L('এ মাসে', 'month')} {tk(r.spent_month)} · {n(r.odometer)} km{r.pending_logs ? <> · <span className="bad">{n(r.pending_logs)} {L('অপেক্ষায়', 'pending')}</span></> : null}</span>
        <span className="chips"><StatusB s={r.status} />{r.docs_expired ? <Badge tone="bad">{L('কাগজ মেয়াদোত্তীর্ণ', 'paper expired')}</Badge> : r.docs_expiring ? <Badge tone="warn">{L('কাগজের মেয়াদ শেষ হচ্ছে', 'paper expiring')}</Badge> : null}{r.service_due && r.status === 'active' ? <Badge tone="warn">{L('সার্ভিস বাকি', 'service due')}</Badge> : null}</span>
      </Link>)}</div>
      {!rows.length && <p className="muted">{L('এখনো কোনো গাড়ি যোগ হয়নি।', 'No vehicle yet.')} <Link to="/app/vehicles/list">{L('যোগ করুন →', 'Add one →')}</Link></p>}
    </section>
  </>
}

// ---------------------------------------------------------------- list: add / edit / hand over
function List({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const { can } = useAuth(); const tk = useTk()
  const [edit, setEdit] = useState<Partial<VehicleFull> | null>(null)
  const [give, setGive] = useState<(VehicleRow & { _role: 'driver' | 'helper' }) | null>(null)
  const [hist, setHist] = useState<VehicleRow | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const canAdd = ctx.hubs.some(h => h.can_edit) || can('vehicle.vehicle.create') || can('da.settings.configure')
  const canHold = can('vehicle.holder.edit') || can('da.settings.configure')
  async function remove(r: VehicleRow) {
    const why = ask(L(`${vLabel(r)} তালিকা থেকে সরাবেন? কারণ লিখুন:`, `Remove ${vLabel(r)}? Write why:`)); if (!why) return
    try { await vehicles.archive(r.id, why); ctx.toast(L('সরানো হলো', 'Removed')); await ctx.reload() } catch (e) { setErr(e) }
  }
  async function release(r: VehicleRow) {
    const role: 'driver' | 'helper' = r.holder_id && r.helper_id ? (window.confirm(L(`ড্রাইভার (${r.holder_name}) এর কাছ থেকে ফেরত নেবেন? "Cancel" দিলে হেল্পার (${r.helper_name}) এর কাছ থেকে।`, `Take back from the driver (${r.holder_name})? Cancel = from the helper (${r.helper_name}).`)) ? 'driver' : 'helper') : r.holder_id ? 'driver' : 'helper'
    const who = role === 'driver' ? r.holder_name : r.helper_name
    const why = ask(L(`${who} এর কাছ থেকে গাড়ি ফেরত নিচ্ছেন — কারণ:`, `Taking the vehicle back from ${who} — why:`)); if (!why) return
    try { await vehicles.release(r.id, why, role); ctx.toast(L('ফেরত নেওয়া হলো', 'Taken back')); await ctx.reload() } catch (e) { setErr(e) }
  }
  return <>
    <ErrorNote error={err} />
    <DataTable<VehicleRow> title={L('গাড়ির তালিকা', 'Vehicles')} rows={ctx.rows} rowKey={r => r.id} file="vehicles"
      empty={L('এই হাবে কোনো গাড়ি নেই।', 'No vehicle in this hub.')}
      cols={[
        { key: 'name', label: L('গাড়ি', 'Vehicle'), value: r => vLabel(r), render: r => <><b>{r.name}</b>{r.reg_no && <span className="sec">{r.reg_no}</span>}{r.model && <span className="sec">{r.model}</span>}</> },
        { key: 'kind', label: L('ধরন', 'Kind'), value: r => kindLabel(L, r.kind) },
        { key: 'hub_name', label: L('হাব', 'Hub'), value: r => r.hub_name ? `${r.hub_name} #${r.hub_code ?? ''}` : '' },
        { key: 'holder', label: L('ড্রাইভার', 'Driver'), value: r => r.holder_name ? `${r.holder_name} (ID ${r.holder_code})` : '',
          render: r => r.holder_name ? <>{r.holder_name}<span className="sec">ID {r.holder_code}{r.since ? ` · ${L('থেকে', 'since')} ${r.since}` : ''}</span></> : <span className="muted">{L('কেউ নেই', 'nobody')}</span> },
        { key: 'helper', label: L('হেল্পার', 'Helper'), value: r => r.helper_name ? `${r.helper_name} (ID ${r.helper_code})` : '',
          render: r => r.helper_name ? <>{r.helper_name}<span className="sec">ID {r.helper_code}</span></> : <span className="muted">—</span> },
        { key: 'served', label: L('যে হাবে কাজ করে', 'Serves'), value: r => r.served_hubs ?? '' },
        { key: 'odometer', label: 'km', value: r => r.odometer, render: r => <>{n(r.odometer)}{r.service_due && r.status === 'active' ? <span className="sec bad">{L('সার্ভিস বাকি', 'service due')}</span> : null}</> },
        { key: 'spent_month', label: L('এ মাসের খরচ', 'This month'), value: r => Number(r.spent_month), render: r => tk(r.spent_month) },
        { key: 'status', label: L('অবস্থা', 'Status'), value: r => L(VEHICLE_STATUS[r.status]?.[0] ?? r.status, VEHICLE_STATUS[r.status]?.[1] ?? r.status), render: r => <StatusB s={r.status} /> },
        { key: 'act', label: '', noExport: true, render: r => <span className="row">
          {(can('vehicle.vehicle.edit') || can('da.settings.configure')) && <button className="secondary sm" onClick={() => void vehicles.one(r.id).then(setEdit).catch(setErr)}>{L('এডিট', 'Edit')}</button>}
          {canHold && <button className="secondary sm" onClick={() => setGive({ ...r, _role: 'driver' })}>{r.holder_id ? L('ড্রাইভার বদল', 'Change driver') : L('ড্রাইভার দিন', 'Set driver')}</button>}
          {canHold && <button className="secondary sm" onClick={() => setGive({ ...r, _role: 'helper' })}>{r.helper_id ? L('হেল্পার বদল', 'Change helper') : L('হেল্পার দিন', 'Set helper')}</button>}
          {canHold && (r.holder_id || r.helper_id) && <button className="secondary sm" onClick={() => void release(r)}>{L('ফেরত', 'Take back')}</button>}
          <button className="secondary sm" onClick={() => setHist(r)}>{L('ইতিহাস', 'History')}</button>
          {can('vehicle.vehicle.archive') && <button className="danger sm" onClick={() => void remove(r)}>×</button>}</span> },
      ]} />
    {canAdd && <button onClick={() => setEdit({ kind: 'bike', status: 'active', owner_type: 'own', hub_id: ctx.hub || ctx.hubs[0]?.hub_id || null, odometer: 0 })}><Icon name="plus" size={14} /> {L('নতুন গাড়ি', 'New vehicle')}</button>}
    {edit && <EditVehicle v={edit} hubs={ctx.hubs} served={ctx.rows.find(r => r.id === edit.id)?.served_hub_ids ?? []} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); ctx.toast(L('সেভ হলো', 'Saved')); await ctx.reload() }} />}
    {give && <HandOver v={give} role={give._role} onClose={() => setGive(null)} onDone={async (moved) => { setGive(null); ctx.toast(moved ? L('দেওয়া হলো — গাড়ি এখন ওই স্টাফের হাবে', 'Handed over — vehicle moved to their hub') : L('দেওয়া হলো', 'Handed over')); await ctx.reload() }} />}
    {hist && <History v={hist} onClose={() => setHist(null)} />}
  </>
}

function EditVehicle({ v, hubs, served, onClose, onDone }: { v: Partial<VehicleFull>; hubs: VehicleHub[]; served: string[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { L } = usePrefs()
  const [d, setD] = useState<Partial<VehicleFull>>(v)
  const [srv, setSrv] = useState<string[]>(served)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const set = (p: Partial<VehicleFull>) => setD({ ...d, ...p })
  const num = (s: string) => s === '' ? null : Number(s)
  async function save() {
    if (!d.name?.trim() || !d.hub_id) return
    setBusy(true); setErr(null)
    try {
      const id = await vehicles.save({ name: d.name, code: autoCode(d.name, d.code), kind: d.kind ?? 'bike', hub: d.hub_id, reg: d.reg_no ?? null, status: d.status ?? 'active', remarks: d.remarks ?? null, id: d.id ?? null,
        more: { model: d.model ?? null, model_year: d.model_year ?? null, color: d.color ?? null, engine_no: d.engine_no ?? null, chassis_no: d.chassis_no ?? null,
          owner_type: d.owner_type ?? 'own', owner_name: d.owner_name ?? null, owner_phone: d.owner_phone ?? null, monthly_rent: d.monthly_rent ?? null,
          purchase_date: d.purchase_date ?? null, purchase_price: d.purchase_price ?? null, odometer: d.odometer ?? 0, fuel_type: d.fuel_type ?? null,
          service_interval_km: d.service_interval_km ?? null, last_service_km: d.last_service_km ?? null, last_service_on: d.last_service_on ?? null } })
      const want = srv.filter(h => h !== d.hub_id)
      if (want.length || served.length) await vehicles.setHubs(id, want)
      await onDone()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={d.id ? L('গাড়ি এডিট', 'Edit vehicle') : L('নতুন গাড়ি', 'New vehicle')} onClose={onClose} wide
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || !d.name?.trim() || !d.hub_id} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
    <div className="da-grid3">
      <Field label={L('নাম *', 'Name *')}><input autoFocus value={d.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder={L('যেমন: অফিসের বাইক ১', 'e.g. Office bike 1')} /></Field>
      <Field label={L('ধরন', 'Kind')}><select value={d.kind ?? 'bike'} onChange={e => set({ kind: e.target.value })}>{Object.entries(VEHICLE_KIND).map(([k, x]) => <option key={k} value={k}>{L(x[0], x[1])}</option>)}</select></Field>
      <Field label={L('হাব *', 'Hub *')} hint={L('কাউকে দিলে গাড়ি তাঁর হাবে চলে যায়', 'Moves to the holder’s hub when handed over')}><select value={d.hub_id ?? ''} onChange={e => set({ hub_id: e.target.value })}>
        <option value="">—</option>{hubs.filter(h => h.can_edit).map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} #{h.code}</option>)}</select></Field>
      <Field label={L('রেজিস্ট্রেশন নম্বর', 'Registration no.')}><input value={d.reg_no ?? ''} onChange={e => set({ reg_no: e.target.value })} placeholder="রাজ মেট্রো-হ ১২-৩৪৫৬" /></Field>
      <Field label={L('মডেল', 'Model')}><input value={d.model ?? ''} onChange={e => set({ model: e.target.value })} placeholder="Hero Splendor+" /></Field>
      <Field label={L('সাল', 'Year')}><input type="number" inputMode="numeric" value={d.model_year ?? ''} onChange={e => set({ model_year: num(e.target.value) })} /></Field>
      <Field label={L('রং', 'Colour')}><input value={d.color ?? ''} onChange={e => set({ color: e.target.value })} /></Field>
      <Field label={L('ইঞ্জিন নম্বর', 'Engine no.')}><input value={d.engine_no ?? ''} onChange={e => set({ engine_no: e.target.value })} /></Field>
      <Field label={L('চ্যাসিস নম্বর', 'Chassis no.')}><input value={d.chassis_no ?? ''} onChange={e => set({ chassis_no: e.target.value })} /></Field>
      <Field label={L('তেলের ধরন', 'Fuel')}><select value={d.fuel_type ?? ''} onChange={e => set({ fuel_type: e.target.value || null })}><option value="">—</option>{Object.entries(FUEL_TYPE).map(([k, x]) => <option key={k} value={k}>{L(x[0], x[1])}</option>)}</select></Field>
      <Field label={L('এখনকার কিলোমিটার', 'Odometer (km)')}><input type="number" inputMode="numeric" min={0} value={d.odometer ?? 0} onChange={e => set({ odometer: Number(e.target.value) || 0 })} /></Field>
      <Field label={L('কত কিমি পর সার্ভিস', 'Service every (km)')} hint={L('খালি রাখলে সেটিংসের ডিফল্ট', 'Blank = default from settings')}><input type="number" inputMode="numeric" value={d.service_interval_km ?? ''} onChange={e => set({ service_interval_km: num(e.target.value) })} /></Field>
      <Field label={L('শেষ সার্ভিস (কিমি)', 'Last service (km)')}><input type="number" inputMode="numeric" value={d.last_service_km ?? ''} onChange={e => set({ last_service_km: num(e.target.value) })} /></Field>
      <Field label={L('শেষ সার্ভিস (তারিখ)', 'Last service (date)')}><input type="date" value={d.last_service_on ?? ''} onChange={e => set({ last_service_on: e.target.value || null })} /></Field>
      <Field label={L('মালিকানা', 'Ownership')}><select value={d.owner_type ?? 'own'} onChange={e => set({ owner_type: e.target.value as VehicleFull['owner_type'] })}>{Object.entries(OWNER_TYPE).map(([k, x]) => <option key={k} value={k}>{L(x[0], x[1])}</option>)}</select></Field>
      {d.owner_type && d.owner_type !== 'own' && <>
        <Field label={L('মালিকের নাম', 'Owner name')}><input value={d.owner_name ?? ''} onChange={e => set({ owner_name: e.target.value })} /></Field>
        <Field label={L('মালিকের মোবাইল', 'Owner mobile')}><input inputMode="numeric" value={d.owner_phone ?? ''} onChange={e => set({ owner_phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        {d.owner_type === 'rented' && <Field label={L('মাসিক ভাড়া (৳)', 'Monthly rent')}><input type="number" inputMode="numeric" value={d.monthly_rent ?? ''} onChange={e => set({ monthly_rent: num(e.target.value) })} /></Field>}</>}
      {(d.owner_type ?? 'own') === 'own' && <>
        <Field label={L('কেনার তারিখ', 'Purchase date')}><input type="date" value={d.purchase_date ?? ''} onChange={e => set({ purchase_date: e.target.value || null })} /></Field>
        <Field label={L('কেনার দাম (৳)', 'Purchase price')}><input type="number" inputMode="numeric" value={d.purchase_price ?? ''} onChange={e => set({ purchase_price: num(e.target.value) })} /></Field></>}
      <Field label={L('অবস্থা', 'Status')}><select value={d.status ?? 'active'} onChange={e => set({ status: e.target.value })}>{Object.entries(VEHICLE_STATUS).map(([k, x]) => <option key={k} value={k}>{L(x[0], x[1])}</option>)}</select></Field>
      <Field label={L('মন্তব্য', 'Remarks')} wide><input value={d.remarks ?? ''} onChange={e => set({ remarks: e.target.value })} /></Field>
      <Field label={L('আরও যে হাবে কাজ করে (বড় গাড়ি)', 'Also works for these hubs (big vehicles)')} wide
        hint={L('এই হাবগুলোর ম্যানেজার গাড়িটা দেখবেন, শুধু তেল / চার্জের খরচ দেখবেন ও লিখতে পারবেন, রিকুইজিশন দিতে পারবেন।', 'Managers of these hubs see the vehicle and only its fuel / charge costs; they can write fuel and ask for it.')}>
        <div className="chips">{hubs.filter(h => h.hub_id !== d.hub_id).map(h => <label key={h.hub_id} className={`chip${srv.includes(h.hub_id) ? ' on' : ''}`} style={{ cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: 4 }} checked={srv.includes(h.hub_id)} onChange={e => setSrv(e.target.checked ? [...srv, h.hub_id] : srv.filter(x => x !== h.hub_id))} />{h.name} #{h.code}</label>)}</div></Field>
    </div>
    <ErrorNote error={err} />
  </Modal>
}

/** Hand over by Employee ID: shows the person and their hub; the vehicle follows them. */
function HandOver({ v, role, onClose, onDone }: { v: VehicleRow; role: 'driver' | 'helper'; onClose: () => void; onDone: (moved: boolean) => Promise<void> }) {
  const { L } = usePrefs()
  const isDriver = role === 'driver'
  const current = isDriver ? v.holder_name : v.helper_name; const currentCode = isDriver ? v.holder_code : v.helper_code
  const [code, setCode] = useState(''); const [why, setWhy] = useState(''); const [from, setFrom] = useState(today()); const [keep, setKeep] = useState(false)
  const [emp, setEmp] = useState<EmpLite | null>(null); const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const hubQ = useLoad(async () => {
    if (!emp) return null
    const { data } = await supabase.from('employee_assignments').select('hub_id, hubs(name, code)').eq('employee_id', emp.id).is('effective_to', null).limit(1)
    const row = (data ?? [])[0] as unknown as { hub_id: string | null; hubs: { name: string; code: string } | null } | undefined
    return row?.hubs ? { id: row.hub_id, label: `${row.hubs.name} #${row.hubs.code}` } : null
  }, [emp?.id])
  async function look() {
    setMsg(''); setEmp(null)
    if (!code.trim()) return
    try { const e = await sorting.findEmployee(code); setEmp(e); if (!e) setMsg(L('এই আইডির কাউকে পাওয়া যায়নি', 'Nobody with this ID')) } catch (e) { setMsg(hrFriendly(e)) }
  }
  const willMove = isDriver && !keep && hubQ.data?.id && hubQ.data.id !== v.hub_id
  async function go() {
    setBusy(true); setErr(null)
    try { await vehicles.assign(v.id, code, why, from, keep, role); await onDone(Boolean(willMove)) } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={isDriver ? L(`${vLabel(v)} — ড্রাইভার কে?`, `${vLabel(v)} — driver?`) : L(`${vLabel(v)} — হেল্পার কে?`, `${vLabel(v)} — helper?`)} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || !emp || !why.trim()} onClick={() => void go()}>{L('দিন', 'Hand over')}</button></>}>
    {current && <p className="muted small">{L(`এখন: ${current} (ID ${currentCode}) — নতুন নাম দিলে তাঁর কাছ থেকে চলে যাবে।`, `Now: ${current} (ID ${currentCode}) — they give it up when you hand it on.`)}</p>}
    {!isDriver && <p className="muted small">{L('হেল্পার দিলে গাড়ির হাব বদলায় না।', 'Setting a helper never moves the vehicle.')}</p>}
    <div className="da-grid2">
      <Field label={L('Employee ID *', 'Employee ID *')} hint={msg ? <span className="bad">{msg}</span> : emp ? <b>{emp.full_name}{emp.mobile ? ` · ${emp.mobile}` : ''}</b> : L('আইডি লিখে বাইরে ক্লিক করুন', 'Type the ID and tab out')}>
        <input autoFocus inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} onBlur={() => void look()} /></Field>
      <Field label={L('কারণ *', 'Reason *')}><input value={why} onChange={e => setWhy(e.target.value)} placeholder={L('যেমন: ডেলিভারির জন্য', 'e.g. for deliveries')} /></Field>
      <Field label={L('কবে থেকে', 'From')}><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      {isDriver && <Field label={L('হাব', 'Hub')} hint={emp && hubQ.data ? (willMove ? <span className="bad">{L(`গাড়ি ${v.hub_name ?? '—'} থেকে ${hubQ.data.label} এ চলে যাবে`, `Vehicle moves from ${v.hub_name ?? '—'} to ${hubQ.data.label}`)}</span> : L('একই হাব', 'Same hub')) : emp && hubQ.data === null && !hubQ.loading ? L('এই স্টাফের হাব লেখা নেই — গাড়ি নিজের হাবেই থাকবে', 'This person has no hub — vehicle stays') : undefined}>
        <label className="row" style={{ alignItems: 'center', gap: 8 }}><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} style={{ width: 'auto' }} /> {L('গাড়ি এই হাবেই রাখুন (স্টাফের হাবে নেবেন না)', 'Keep the vehicle at its hub')}</label></Field>}
    </div>
    {isDriver && <p className="muted small">{L('স্বাভাবিক নিয়ম: যাকে দিচ্ছেন, গাড়ি তাঁর হাবে চলে যায় — হাব আলাদা করে লিখতে হয় না।', 'Default: the vehicle moves to the driver’s current hub — nothing to type.')}</p>}
    <ErrorNote error={err} />
  </Modal>
}

function History({ v, onClose }: { v: VehicleRow; onClose: () => void }) {
  const { L } = usePrefs()
  const q = useLoad(() => vehicles.history(v.id), [v.id])
  return <Modal title={L(`${vLabel(v)} — কার কার কাছে ছিল`, `${vLabel(v)} — holders`)} onClose={onClose} actions={<button onClick={onClose}>{L('বন্ধ', 'Close')}</button>}>
    <ErrorNote error={q.error} />
    <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('কে', 'Who')}</th><th>{L('হাব', 'Hub')}</th><th>{L('থেকে', 'From')}</th><th>{L('পর্যন্ত', 'To')}</th><th>{L('কারণ', 'Reason')}</th></tr></thead>
      <tbody>{(q.data ?? []).map(h => <tr key={h.id}><td>{h.full_name}<span className="sec">ID {h.employee_code} · {h.role === 'helper' ? L('হেল্পার', 'helper') : L('ড্রাইভার', 'driver')}</span></td><td>{h.hub_name ?? '—'}{h.moved_hub ? <span className="sec">{L('গাড়ি এই হাবে এসেছে', 'moved here')}</span> : null}</td>
        <td>{h.effective_from}</td><td>{h.effective_to ?? <Badge tone="ok">{L('এখনো', 'now')}</Badge>}</td><td className="small">{h.reason}{h.end_reason ? <span className="sec">{h.end_reason}</span> : null}</td></tr>)}
        {q.data && !q.data.length && <tr><td colSpan={5} className="muted">{L('কারও নামে কখনো ছিল না।', 'Never held by anyone.')}</td></tr>}</tbody></table></div>
  </Modal>
}

// ---------------------------------------------------------------- logs: fuel / service / repair
function Logs({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const { can } = useAuth(); const tk = useTk()
  const { vid, setVid, v } = useVehiclePick(ctx.rows)
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today())
  const logs = useLoad(() => v ? vehicles.logs(v.id, from, to) : Promise.resolve([] as VehicleLog[]), [v?.id, from, to])
  const [edit, setEdit] = useState<Partial<VehicleLog> | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const list = logs.data ?? []
  const total = list.reduce((s, x) => s + Number(x.amount), 0)
  const litres = list.filter(x => x.kind === 'fuel').reduce((s, x) => s + Number(x.litres ?? 0), 0)
  const kms = list.map(x => x.odometer).filter((k): k is number => k != null && k > 0)
  const km = kms.length > 1 ? Math.max(...kms) - Math.min(...kms) : 0
  const canWrite = v ? (can('vehicle.log.create') || ctx.hubs.find(h => h.hub_id === v.hub_id)?.can_log || v.is_crew) : false
  async function decide(x: VehicleLog, ok: boolean) {
    const note = ok ? '' : ask(L('কেন বাতিল? কারণ লিখুন:', 'Why reject? Write the reason:'))
    if (!ok && !note) return
    try { await vehicles.decideLog(x.id, ok, note || null); ctx.toast(ok ? L('অনুমোদন হলো', 'Approved') : L('বাতিল হলো', 'Rejected')); await Promise.all([logs.reload(), ctx.reload()]) } catch (e) { setErr(e) }
  }
  async function toSheet(x: VehicleLog) {
    if (!v) return
    let hub: string | null = null
    if (v.served_hub_ids?.length) {
      const opts = [v.hub_name ?? '', ...(v.served_hubs ?? '').split(', ')].filter(Boolean)
      const pick = ask(L(`কোন হাবের খাতায় উঠবে? নম্বর লিখুন:\n${opts.map((o, i) => `${i + 1}. ${o}`).join('\n')}`, `Which hub's sheet? Type the number:\n${opts.map((o, i) => `${i + 1}. ${o}`).join('\n')}`))
      const i = Number(pick) - 1; if (!(i >= 0 && i < opts.length)) return
      hub = i === 0 ? v.hub_id : (v.served_hub_ids[i - 1] ?? null)
    }
    try { await vehicles.logToSheet(x.id, hub); ctx.toast(L('আজকের হিসাব খাতায় উঠেছে', 'Put on today’s sheet')); await Promise.all([logs.reload(), ctx.reload()]) } catch (e) { setErr(e) }
  }
  async function openSlip(path: string) { try { window.open(await vehicles.docUrl(path), '_blank') } catch (e) { setErr(e) } }
  const byKind = new Map<string, number>(); for (const x of list) byKind.set(x.kind, (byKind.get(x.kind) ?? 0) + Number(x.amount))
  async function remove(x: VehicleLog) {
    const why = ask(L('এই লাইন সরাবেন? কারণ:', 'Remove this line? Why:')); if (!why) return
    try { await vehicles.removeLog(x.id, why); ctx.toast(L('সরানো হলো', 'Removed')); await Promise.all([logs.reload(), ctx.reload()]) } catch (e) { setErr(e) }
  }
  if (!ctx.rows.length) return <p className="notice">{L('আগে গাড়ি যোগ করুন।', 'Add a vehicle first.')} <Link to="/app/vehicles/list">{L('গাড়ির তালিকা →', 'Vehicles →')}</Link></p>
  return <>
    <section className="da-filters panel no-print"><VehicleSelect rows={ctx.rows} vid={vid} setVid={setVid} />
      <Field label={L('থেকে', 'From')}><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label={L('পর্যন্ত', 'To')}><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      {canWrite && v && <button onClick={() => setEdit({ kind: 'fuel', log_date: today(), odometer: v.odometer || null })}><Icon name="plus" size={14} /> {L('তেল / খরচ লিখুন', 'Add fuel / cost')}</button>}
    </section>
    {v && <div className="da-stats">
      <Stat icon="cash" label={L('মোট খরচ', 'Total')} value={tk(total)} sub={[...byKind].map(([k, a]) => `${L(LOG_KIND[k]?.[0] ?? k, LOG_KIND[k]?.[1] ?? k)} ${tk(a)}`).join(' · ')} />
      <Stat icon="truck" label={L('তেল (লিটার)', 'Fuel (litres)')} value={n(litres.toFixed(1))} sub={litres && km ? L(`${n((km / litres).toFixed(1))} কিমি/লিটার`, `${(km / litres).toFixed(1)} km/L`) : undefined} />
      <Stat icon="map" label={L('চলেছে (কিমি)', 'Distance (km)')} value={n(km)} sub={L(`মিটারে এখন ${n(v.odometer)} km`, `Odometer ${v.odometer} km`)} />
      <Stat icon="gear" label={L('সার্ভিসিং', 'Service')} tone={v.service_due ? 'warn' : 'ok'} value={v.service_due ? L('বাকি', 'Due') : L('ঠিক আছে', 'OK')} sub={L(`শেষ সার্ভিসের পর ${n(v.km_since_service)} / ${n(v.service_interval_km)} km`, `${v.km_since_service} / ${v.service_interval_km} km since service`)} />
    </div>}
    <ErrorNote error={err ?? logs.error} />
    <DataTable<VehicleLog> title={v ? vLabel(v) : ''} rows={list} rowKey={x => x.id} file="vehicle-logs" empty={L('এই সময়ে কোনো খরচ লেখা হয়নি।', 'Nothing in this period.')}
      cols={[
        { key: 'log_date', label: L('তারিখ', 'Date') },
        { key: 'kind', label: L('খাত', 'Kind'), value: x => L(LOG_KIND[x.kind]?.[0] ?? x.kind, LOG_KIND[x.kind]?.[1] ?? x.kind), render: x => <><Icon name={LOG_KIND[x.kind]?.[2] ?? 'form'} size={14} /> {L(LOG_KIND[x.kind]?.[0] ?? x.kind, LOG_KIND[x.kind]?.[1] ?? x.kind)}</> },
        { key: 'status', label: L('অবস্থা', 'Status'), value: x => L(LOG_STATUS[x.status][0], LOG_STATUS[x.status][1]) + (x.da_expense_id ? ' · ' + L('খাতায়', 'on sheet') : ''),
          render: x => <span className="chips"><Badge tone={LOG_STATUS[x.status][2]}>{L(LOG_STATUS[x.status][0], LOG_STATUS[x.status][1])}</Badge>{x.da_expense_id ? <Badge tone="info">{L('খাতায় উঠেছে', 'on sheet')}</Badge> : null}{x.decision_note ? <span className="muted small">{x.decision_note}</span> : null}</span> },
        { key: 'litres', label: L('লিটার', 'Litres'), value: x => x.litres ?? '' },
        { key: 'odometer', label: 'km', value: x => x.odometer ?? '' },
        { key: 'amount', label: L('টাকা', 'Amount'), value: x => Number(x.amount), render: x => <b>{tk(x.amount)}</b> },
        { key: 'vendor', label: L('দোকান / পাম্প', 'Vendor'), value: x => [x.vendor, x.bill_no].filter(Boolean).join(' · ') },
        { key: 'driver', label: L('কে চালাচ্ছিল', 'Driver'), value: x => x.driver_name ? `${x.driver_name} (ID ${x.driver_code})` : '' },
        { key: 'note', label: L('নোট', 'Note'), value: x => x.note ?? '' },
        { key: 'act', label: '', noExport: true, render: x => <span className="row">
          {x.slip_path && <button className="secondary sm" onClick={() => void openSlip(x.slip_path!)}><Icon name="eye" size={13} /> {L('স্লিপ', 'Slip')}</button>}
          {x.status === 'submitted' && x.can_approve && <><button className="sm" onClick={() => void decide(x, true)}>{L('অনুমোদন', 'Approve')}</button><button className="danger sm" onClick={() => void decide(x, false)}>{L('না', 'Reject')}</button></>}
          {x.status === 'approved' && !x.da_expense_id && x.can_approve && Number(x.amount) > 0 && <button className="secondary sm" onClick={() => void toSheet(x)}><Icon name="ledger" size={13} /> {L('খাতায় তুলুন', 'To sheet')}</button>}
          {(can('vehicle.log.edit') || x.mine) && !x.da_expense_id && <><button className="secondary sm" onClick={() => setEdit(x)}>{L('এডিট', 'Edit')}</button><button className="danger sm" onClick={() => void remove(x)}>×</button></>}</span> },
      ]} />
    {edit && v && <EditLog v={v} x={edit} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); ctx.toast(L('লেখা হলো', 'Saved')); await Promise.all([logs.reload(), ctx.reload()]) }} />}
  </>
}

function EditLog({ v, x, onClose, onDone }: { v: VehicleRow; x: Partial<VehicleLog>; onClose: () => void; onDone: () => Promise<void> }) {
  const { L, n } = usePrefs()
  const [d, setD] = useState<Partial<VehicleLog>>(x)
  const [driver, setDriver] = useState(x.driver_code ?? '')
  const [slip, setSlip] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const settings = useLoad(() => vehicles.settings().catch(() => ({} as VehicleSettings)), [])
  const price = v.fuel_type ? settings.data?.fuel_price?.[v.fuel_type] : undefined
  const set = (p: Partial<VehicleLog>) => setD({ ...d, ...p })
  const isFuel = d.kind === 'fuel'
  async function save() {
    setBusy(true); setErr(null)
    try {
      const path = slip ? await vehicles.uploadDoc(v.id, slip) : null
      await vehicles.saveLog({ vehicle: v.id, kind: d.kind ?? 'fuel', amount: Number(d.amount ?? 0), date: d.log_date, odometer: d.odometer ?? null, litres: isFuel ? d.litres ?? null : null,
        vendor: d.vendor ?? null, bill_no: d.bill_no ?? null, note: d.note ?? null, driver_code: driver || null, id: d.id ?? null, slip: path })
      await onDone()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={`${vLabel(v)} — ${d.id ? L('লাইন এডিট', 'Edit line') : L('নতুন খরচ', 'New cost')}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || !d.kind || (Number(d.amount ?? 0) <= 0 && !(isFuel && Number(d.litres ?? 0) > 0))} onClick={() => void save()}>{busy ? L('আপলোড হচ্ছে…', 'Uploading…') : L('সেভ', 'Save')}</button></>}>
    <div className="da-seg" style={{ marginBottom: 10, flexWrap: 'wrap' }}>{Object.entries(LOG_KIND).map(([k, x2]) => <button key={k} className={d.kind === k ? 'sm' : 'secondary sm'} onClick={() => set({ kind: k })}><Icon name={x2[2]} size={13} /> {L(x2[0], x2[1])}</button>)}</div>
    <div className="da-grid2">
      <Field label={L('তারিখ', 'Date')}><input type="date" value={d.log_date ?? today()} onChange={e => set({ log_date: e.target.value })} /></Field>
      <Field label={L('মিটারের কিলোমিটার', 'Odometer (km)')} hint={L(`আগে লেখা ছিল ${n(v.odometer)} km`, `Last known ${v.odometer} km`)}><input type="number" inputMode="numeric" min={0} value={d.odometer ?? ''} onChange={e => set({ odometer: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
      {isFuel && <Field label={L('লিটার', 'Litres')} hint={price ? L(`সাধারণ দর ৳${n(price)}/লিটার`, `Usual ৳${price}/L`) : undefined}><input type="number" inputMode="decimal" step="0.01" min={0} autoFocus value={d.litres ?? ''}
        onChange={e => { const l = e.target.value === '' ? null : Number(e.target.value); set({ litres: l, amount: l && price && !d.amount ? Math.round(l * price) : d.amount }) }} /></Field>}
      <Field label={L('টাকা *', 'Amount *')}><input type="number" inputMode="numeric" min={0} autoFocus={!isFuel} value={d.amount ?? ''} onChange={e => set({ amount: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
      <Field label={isFuel ? L('পাম্পের নাম', 'Pump') : L('দোকান / গ্যারেজ', 'Vendor / garage')}><input value={d.vendor ?? ''} onChange={e => set({ vendor: e.target.value })} /></Field>
      <Field label={L('বিল / স্লিপ নম্বর', 'Bill / slip no.')}><input value={d.bill_no ?? ''} onChange={e => set({ bill_no: e.target.value })} /></Field>
      <Field label={L('কে চালাচ্ছিল (Employee ID)', 'Driver (Employee ID)')} hint={v.holder_name ? L(`খালি রাখলে: ${v.holder_name}`, `Blank = ${v.holder_name}`) : undefined}><input inputMode="numeric" value={driver} onChange={e => setDriver(e.target.value)} /></Field>
      <Field label={L('স্লিপ / বিলের ছবি', 'Slip / bill photo')} hint={d.slip_path && !slip ? L('আগের ছবি আছে; নতুন দিলে বদলে যাবে', 'A photo exists; a new one replaces it') : L('ম্যানেজার দেখে ডাউনলোড করতে পারবেন', 'Managers can view and download it')}>
        <input type="file" accept="image/*,application/pdf" capture="environment" onChange={e => setSlip(e.target.files?.[0] ?? null)} /></Field>
      <Field label={L('নোট', 'Note')} wide><input value={d.note ?? ''} onChange={e => set({ note: e.target.value })} placeholder={d.kind === 'repair' ? L('কী সারানো হলো', 'What was fixed') : ''} /></Field>
    </div>
    {!v.home_manager && v.is_crew && <p className="muted small">{L('আপনি জমা দিলে ম্যানেজারের কাছে অনুমোদনের জন্য যাবে; অনুমোদন হলে খাতায় উঠবে।', 'Your line goes to the manager for approval; once approved it can go on the sheet.')}</p>}
    {(d.kind === 'service' || d.kind === 'oil') && <p className="muted small">{L('সার্ভিসিং লিখলে গাড়ির "শেষ সার্ভিস" নিজে থেকে আপডেট হয়।', 'Writing a service updates the vehicle’s last-service record.')}</p>}
    <ErrorNote error={err} />
  </Modal>
}

// ---------------------------------------------------------------- documents
function Docs({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const { can } = useAuth(); const tk = useTk()
  const { vid, setVid, v } = useVehiclePick(ctx.rows)
  const docs = useLoad(() => v ? vehicles.docs(v.id) : Promise.resolve([] as VehicleDoc[]), [v?.id])
  const [edit, setEdit] = useState<Partial<VehicleDoc> | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const canEdit = can('vehicle.document.edit')
  async function remove(d: VehicleDoc) {
    const why = ask(L('এই কাগজ সরাবেন? কারণ:', 'Remove this paper? Why:')); if (!why) return
    try { await vehicles.archiveDoc(d.id, why); await Promise.all([docs.reload(), ctx.reload()]) } catch (e) { setErr(e) }
  }
  async function open(d: VehicleDoc) { if (!d.file_path) return; try { window.open(await vehicles.docUrl(d.file_path), '_blank') } catch (e) { setErr(e) } }
  if (!ctx.rows.length) return <p className="notice">{L('আগে গাড়ি যোগ করুন।', 'Add a vehicle first.')}</p>
  const missing = Object.keys(DOC_KIND).filter(k => !['other', 'ownership', 'route_permit'].includes(k) && !(docs.data ?? []).some(d => d.kind === k))
  return <>
    <section className="da-filters panel no-print"><VehicleSelect rows={ctx.rows} vid={vid} setVid={setVid} />
      {canEdit && v && <button onClick={() => setEdit({ kind: missing[0] ?? 'other' })}><Icon name="plus" size={14} /> {L('কাগজ যোগ', 'Add paper')}</button>}</section>
    <ErrorNote error={err ?? docs.error} />
    {v && missing.length > 0 && docs.data && <p className="notice">{L('লেখা নেই:', 'Not recorded:')} {missing.map(k => L(DOC_KIND[k][0], DOC_KIND[k][1])).join(', ')}</p>}
    <section className="panel"><div className="team-cards">{(docs.data ?? []).map(d => { const days = daysUntil(d.expires_on)
      const tone = days == null ? 'neutral' : days < 0 ? 'bad' : days <= 30 ? 'warn' : 'ok'
      return <div key={d.id} className="team-card">
        <b><Icon name="doc" size={14} /> {L(DOC_KIND[d.kind]?.[0] ?? d.kind, DOC_KIND[d.kind]?.[1] ?? d.kind)}{d.title ? ` · ${d.title}` : ''}</b>
        {d.doc_no && <span className="muted small">{L('নম্বর', 'No.')} {d.doc_no}</span>}
        <span className="small">{d.issued_on ? `${L('ইস্যু', 'Issued')} ${d.issued_on}` : ''}{d.expires_on ? ` · ${L('মেয়াদ', 'Expires')} ${d.expires_on}` : ''}</span>
        <span><Badge tone={tone}>{days == null ? L('মেয়াদ নেই', 'No expiry') : days < 0 ? L(`${n(-days)} দিন আগে শেষ`, `Expired ${-days}d ago`) : days === 0 ? L('আজ শেষ', 'Expires today') : L(`${n(days)} দিন বাকি`, `${days} days left`)}</Badge>{d.amount ? <span className="muted small"> · {tk(d.amount)}</span> : null}</span>
        {d.note && <span className="muted small">{d.note}</span>}
        <span className="row">{d.file_path && <button className="secondary sm" onClick={() => void open(d)}><Icon name="eye" size={13} /> {L('ছবি / ফাইল', 'File')}</button>}
          {canEdit && <><button className="secondary sm" onClick={() => setEdit(d)}>{L('এডিট / নবায়ন', 'Edit / renew')}</button><button className="danger sm" onClick={() => void remove(d)}>×</button></>}</span>
      </div> })}
      {docs.data && !docs.data.length && <p className="muted">{L('এই গাড়ির কোনো কাগজ লেখা হয়নি।', 'No papers recorded for this vehicle.')}</p>}</div></section>
    {edit && v && <EditDoc v={v} d={edit} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); ctx.toast(L('সেভ হলো', 'Saved')); await Promise.all([docs.reload(), ctx.reload()]) }} />}
  </>
}

function EditDoc({ v, d: init, onClose, onDone }: { v: VehicleRow; d: Partial<VehicleDoc>; onClose: () => void; onDone: () => Promise<void> }) {
  const { L } = usePrefs()
  const [d, setD] = useState<Partial<VehicleDoc>>(init)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const set = (p: Partial<VehicleDoc>) => setD({ ...d, ...p })
  async function save() {
    setBusy(true); setErr(null)
    try {
      const path = file ? await vehicles.uploadDoc(v.id, file) : null
      await vehicles.saveDoc({ vehicle: v.id, kind: d.kind ?? 'other', doc_no: d.doc_no ?? null, issued: d.issued_on ?? null, expires: d.expires_on ?? null, amount: d.amount ?? null, title: d.title ?? null, note: d.note ?? null, file: path, id: d.id ?? null })
      await onDone()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={`${vLabel(v)} — ${d.id ? L('কাগজ এডিট', 'Edit paper') : L('নতুন কাগজ', 'New paper')}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || !d.kind} onClick={() => void save()}>{busy ? L('আপলোড হচ্ছে…', 'Uploading…') : L('সেভ', 'Save')}</button></>}>
    <div className="da-grid2">
      <Field label={L('কাগজ', 'Paper')}><select value={d.kind ?? 'other'} onChange={e => set({ kind: e.target.value })}>{Object.entries(DOC_KIND).map(([k, x]) => <option key={k} value={k}>{L(x[0], x[1])}</option>)}</select></Field>
      <Field label={L('নম্বর', 'Number')}><input value={d.doc_no ?? ''} onChange={e => set({ doc_no: e.target.value })} /></Field>
      <Field label={L('ইস্যুর তারিখ', 'Issued on')}><input type="date" value={d.issued_on ?? ''} onChange={e => set({ issued_on: e.target.value || null })} /></Field>
      <Field label={L('মেয়াদ শেষ', 'Expires on')} hint={L('৩০ দিন আগে থেকে সতর্ক করবে', 'Alerts 30 days ahead')}><input type="date" value={d.expires_on ?? ''} onChange={e => set({ expires_on: e.target.value || null })} /></Field>
      <Field label={L('ফি / খরচ (৳)', 'Fee (৳)')}><input type="number" inputMode="numeric" min={0} value={d.amount ?? ''} onChange={e => set({ amount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
      <Field label={L('শিরোনাম (ঐচ্ছিক)', 'Title (optional)')}><input value={d.title ?? ''} onChange={e => set({ title: e.target.value })} /></Field>
      <Field label={L('ছবি / PDF', 'Photo / PDF')} hint={d.file_path && !file ? L('আগের ফাইল আছে; নতুন দিলে বদলে যাবে', 'A file exists; a new one replaces it') : undefined} wide>
        <input type="file" accept="image/*,application/pdf" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
      <Field label={L('নোট', 'Note')} wide><input value={d.note ?? ''} onChange={e => set({ note: e.target.value })} /></Field>
    </div>
    <ErrorNote error={err} />
  </Modal>
}

// ---------------------------------------------------------------- reports
function Reports({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const tk = useTk()
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today())
  const q = useLoad(() => vehicles.report(from, to, ctx.hub || null), [from, to, ctx.hub])
  const rows = q.data ?? []
  const kinds = [...new Set(rows.map(r => r.kind))].sort()
  const byV = new Map<string, { vehicle: string; reg_no: string | null; hub: string | null; by: Record<string, number>; total: number; litres: number; km: number }>()
  for (const r of rows) {
    const c = byV.get(r.vehicle_id) ?? { vehicle: r.vehicle, reg_no: r.reg_no, hub: r.hub_name, by: {}, total: 0, litres: 0, km: 0 }
    c.by[r.kind] = (c.by[r.kind] ?? 0) + Number(r.amount); c.total += Number(r.amount); c.litres += Number(r.litres ?? 0)
    if (r.km_start != null && r.km_end != null) c.km = Math.max(c.km, r.km_end - r.km_start)
    byV.set(r.vehicle_id, c)
  }
  type Row = { id: string } & NonNullable<ReturnType<typeof byV.get>>
  const list: Row[] = [...byV].map(([id, c]) => ({ id, ...c })).sort((a, b) => b.total - a.total)
  const grand = list.reduce((s, r) => s + r.total, 0)
  const quick = (k: 'month' | 'last' | '30' | 'year') => {
    const t = new Date(); const y = t.getFullYear(); const m = t.getMonth()
    if (k === 'month') { setFrom(monthStart()); setTo(today()) }
    else if (k === 'last') { setFrom(new Date(y, m - 1, 1).toISOString().slice(0, 10)); setTo(new Date(y, m, 0).toISOString().slice(0, 10)) }
    else if (k === '30') { setFrom(new Date(t.getTime() - 30 * 86400000).toISOString().slice(0, 10)); setTo(today()) }
    else { setFrom(`${y}-01-01`); setTo(today()) }
  }
  return <>
    <section className="da-filters panel no-print">
      <Field label={L('থেকে', 'From')}><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label={L('পর্যন্ত', 'To')}><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      <span className="da-seg"><button className="secondary sm" onClick={() => quick('month')}>{L('এ মাস', 'This month')}</button><button className="secondary sm" onClick={() => quick('last')}>{L('গত মাস', 'Last month')}</button>
        <button className="secondary sm" onClick={() => quick('30')}>{L('৩০ দিন', '30 days')}</button><button className="secondary sm" onClick={() => quick('year')}>{L('এ বছর', 'This year')}</button></span>
    </section>
    <ErrorNote error={q.error} />
    <div className="da-stats">
      <Stat icon="cash" label={L('মোট খরচ', 'Total')} value={tk(grand)} sub={L(`${n(list.length)}টা গাড়ি`, `${list.length} vehicles`)} />
      {kinds.slice(0, 3).map(k => <Stat key={k} icon={LOG_KIND[k]?.[2]} label={L(LOG_KIND[k]?.[0] ?? k, LOG_KIND[k]?.[1] ?? k)} value={tk(rows.filter(r => r.kind === k).reduce((s, r) => s + Number(r.amount), 0))} />)}
    </div>
    <DataTable<Row> title={L(`গাড়ির খরচ ${from} – ${to}`, `Vehicle costs ${from} – ${to}`)} rows={list} rowKey={r => r.id} file="vehicle-report" empty={L('এই সময়ে কোনো খরচ নেই।', 'No cost in this period.')}
      cols={[
        { key: 'vehicle', label: L('গাড়ি', 'Vehicle'), value: r => r.reg_no ? `${r.vehicle} (${r.reg_no})` : r.vehicle },
        { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub ?? '' },
        ...kinds.map(k => ({ key: k, label: L(LOG_KIND[k]?.[0] ?? k, LOG_KIND[k]?.[1] ?? k), value: (r: Row) => r.by[k] ?? 0, render: (r: Row) => r.by[k] ? tk(r.by[k]) : <span className="muted">—</span> })),
        { key: 'total', label: L('মোট', 'Total'), value: r => r.total, render: r => <b>{tk(r.total)}</b> },
        { key: 'litres', label: L('লিটার', 'Litres'), value: r => r.litres ? r.litres.toFixed(1) : '' },
        { key: 'km', label: L('কিমি', 'km'), value: r => r.km || '' },
        { key: 'perkm', label: L('৳/কিমি', '৳/km'), value: r => r.km ? (r.total / r.km).toFixed(2) : '' },
      ]} />
  </>
}

// ---------------------------------------------------------------- settings
function Settings() {
  const { L } = usePrefs()
  const q = useLoad(() => vehicles.settings(), [])
  const [days, setDays] = useState(''); const [km, setKm] = useState('')
  const [price, setPrice] = useState<Record<string, number>>({})
  const [err, setErr] = useState<unknown>(null); const [ok, setOk] = useState('')
  useEffect(() => { if (q.data) { setDays(String(q.data.doc_alert_days ?? 30)); setKm(String(q.data.service_interval_km ?? 3000)); setPrice(q.data.fuel_price ?? {}) } }, [q.data])
  async function save() {
    setErr(null); setOk('')
    try {
      await vehicles.configure('doc_alert_days', Number(days) || 30); await vehicles.configure('service_interval_km', Number(km) || 3000); await vehicles.configure('fuel_price', price)
      setOk(L('সেভ হলো', 'Saved')); await q.reload()
    } catch (e) { setErr(e) }
  }
  return <section className="panel"><h2>{L('গাড়ি সেটিংস', 'Vehicle settings')}</h2>
    <ErrorNote error={err ?? q.error} />
    <div className="da-grid3">
      <Field label={L('কাগজের মেয়াদ — কত দিন আগে সতর্ক করবে', 'Warn how many days before a paper expires')}><input type="number" inputMode="numeric" min={1} value={days} onChange={e => setDays(e.target.value)} /></Field>
      <Field label={L('কত কিমি পর সার্ভিসিং (ডিফল্ট)', 'Default service interval (km)')}><input type="number" inputMode="numeric" min={100} value={km} onChange={e => setKm(e.target.value)} /></Field>
    </div>
    <h3 style={{ marginTop: 14 }}>{L('তেলের সাধারণ দর (৳ প্রতি লিটার) — শুধু হিসাবের সুবিধার জন্য', 'Usual fuel price (৳/L) — a hint when writing fuel')}</h3>
    <div className="da-grid3">{Object.entries(FUEL_TYPE).filter(([k]) => k !== 'electric').map(([k, x]) => <Field key={k} label={L(x[0], x[1])}><input type="number" inputMode="decimal" value={price[k] ?? ''} onChange={e => setPrice({ ...price, [k]: Number(e.target.value) })} /></Field>)}</div>
    <div className="row" style={{ marginTop: 12 }}><button onClick={() => void save()}>{L('সেভ', 'Save')}</button>{ok && <span className="muted">{ok}</span>}</div>
    <FormatEditor title={L('রিকুইজিশন ফরম্যাট — বাড়তি ঘর', 'Requisition format — extra fields')} hint={L('তারিখ, সময়, হাব, গাড়ি ও কাজ সব সময় থাকে; এখানে বাড়তি ঘর যোগ করুন (যেমন পার্সেল সংখ্যা, মালের বিবরণ)।', 'Date, time, hub, vehicle and job are always there; add extra fields here.')}
      fields={q.data?.requisition_format ?? []} onSave={async f => { await vehicles.configure('requisition_format', f); await q.reload() }} />
    {(['parts', 'service', 'problem'] as const).map(k => <FormatEditor key={k} title={L(`ড্রাইভারের "${DREQ_KIND[k][0]}" ফরম্যাট`, `Driver "${DREQ_KIND[k][1]}" format`)}
      hint={L('ড্রাইভার এই ঘরগুলো পূরণ করে পাঠাবে; ম্যানেজার নোটিফিকেশন পাবে।', 'The driver fills these and sends; managers are notified.')}
      fields={q.data?.request_formats?.[k] ?? []} onSave={async f => { await vehicles.configure('request_formats', { ...(q.data?.request_formats ?? {}), [k]: f }); await q.reload() }} />)}
    <FormatEditor title={L('দিনের খাতা (অটো) ফরম্যাট — বাড়তি ঘর', 'Day log format — extra fields')} hint={L('চার্জ দিয়েছে কি না, বের হওয়া / ফেরার সময়, কিমি ও ট্রিপ সব সময় থাকে; বাড়তি ঘর এখানে।', 'Charged?, out / in time, km and trips are always there; extra fields here.')}
      fields={q.data?.day_format ?? []} onSave={async f => { await vehicles.configure('day_format', f); await q.reload() }} />
    <p className="muted small" style={{ marginTop: 14 }}>{L('কে কী করতে পারবে — সিস্টেম → রোল ও অনুমতি → "vehicle" মডিউল থেকে ঠিক করুন। হাব ম্যানেজার নিজের হাবের গাড়ি যোগ, কাউকে দেওয়া, তেল/খরচ ও কাগজ লিখতে পারেন; রাইডার নিজের নামে থাকা গাড়ির তেল লিখতে পারেন।',
      'Who may do what: System → Roles & permissions → "vehicle" module. Hub managers add vehicles, hand them over and write costs and papers for their hub; a rider may write fuel for the vehicle they hold.')}</p>
  </section>
}


// ---------------------------------------------------------------- shared: dynamic fields from a format (settings)
const FIELD_TYPES: Array<[FormField['type'], string, string]> = [['text', 'লেখা', 'Text'], ['number', 'সংখ্যা', 'Number'], ['date', 'তারিখ', 'Date'], ['phone', 'মোবাইল', 'Phone'], ['textarea', 'বড় লেখা', 'Long text'], ['select', 'বাছাই তালিকা', 'Choice']]
function DynFields({ fields, data, onChange }: { fields: FormField[]; data: Record<string, string>; onChange: (d: Record<string, string>) => void }) {
  const { L } = usePrefs()
  return <>{fields.map(f => { const v = data[f.key] ?? ''; const set = (x: string) => onChange({ ...data, [f.key]: x }); const label = `${f.label}${f.required ? ' *' : ''}`
    switch (f.type) {
      case 'textarea': return <Field key={f.key} label={label} wide><textarea rows={2} value={v} onChange={e => set(e.target.value)} /></Field>
      case 'date': return <Field key={f.key} label={label}><input type="date" value={v} onChange={e => set(e.target.value)} /></Field>
      case 'number': return <Field key={f.key} label={label}><input inputMode="decimal" value={v} onChange={e => set(e.target.value)} /></Field>
      case 'phone': return <Field key={f.key} label={label}><input inputMode="tel" placeholder="01XXXXXXXXX" value={v} onChange={e => set(e.target.value)} /></Field>
      case 'select': return <Field key={f.key} label={label}><select value={v} onChange={e => set(e.target.value)}><option value="">{L('বেছে নিন…', 'Choose…')}</option>{(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select></Field>
      default: return <Field key={f.key} label={label}><input value={v} onChange={e => set(e.target.value)} /></Field>
    } })}</>
}
function missingRequired(fields: FormField[], data: Record<string, string>) { return fields.filter(f => f.required && !(data[f.key] ?? '').trim()).map(f => f.label) }
function DataLine({ fields, data }: { fields: FormField[]; data: Record<string, string> }) {
  const items = Object.entries(data ?? {}).filter(([, v]) => v).map(([k, v]) => `${fields.find(f => f.key === k)?.label ?? k}: ${v}`)
  return items.length ? <span className="muted small">{items.join(' · ')}</span> : null
}

function FormatEditor({ title, hint, fields, onSave }: { title: string; hint: string; fields: FormField[]; onSave: (f: FormField[]) => Promise<void> }) {
  const { L } = usePrefs()
  const [fs, setFs] = useState<FormField[]>(fields)
  const [err, setErr] = useState<unknown>(null); const [ok, setOk] = useState('')
  useEffect(() => setFs(fields), [fields])
  const set = (i: number, p: Partial<FormField>) => setFs(fs.map((x, j) => j === i ? { ...x, ...p } : x))
  async function save() {
    setErr(null); setOk('')
    const clean = fs.filter(f => f.label.trim()).map((f, i) => ({ ...f, label: f.label.trim(), key: (f.key || f.label).trim().toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, '_') || `f${i + 1}`,
      options: f.type === 'select' ? (f.options ?? []).map(o => o.trim()).filter(Boolean) : undefined }))
    if (clean.some(f => f.type === 'select' && !f.options?.length)) { setErr(new Error(L('বাছাই তালিকার ঘরে অপশন দিন', 'A choice field needs options'))); return }
    try { await onSave(clean); setOk(L('সেভ হলো', 'Saved')) } catch (e) { setErr(e) }
  }
  return <section className="panel" style={{ marginTop: 14 }}><h3>{title}</h3><p className="muted small">{hint}</p>
    <div className="rq-fields">{fs.map((f, i) => <div key={i} className="rq-field da-grid3">
      <Field label={L('ঘরের নাম', 'Label')}><input value={f.label} onChange={e => set(i, { label: e.target.value })} /></Field>
      <Field label={L('ধরন', 'Type')}><select value={f.type} onChange={e => set(i, { type: e.target.value as FormField['type'] })}>{FIELD_TYPES.map(([k, bn, en]) => <option key={k} value={k}>{L(bn, en)}</option>)}</select></Field>
      <Field label={L('বাধ্যতামূলক?', 'Required?')}><span className="row" style={{ alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={!!f.required} onChange={e => set(i, { required: e.target.checked })} />
        <button className="danger sm" onClick={() => setFs(fs.filter((_, j) => j !== i))}>×</button></span></Field>
      {f.type === 'select' && <Field label={L('অপশন (কমা দিয়ে)', 'Options (comma separated)')} wide><input value={(f.options ?? []).join(', ')} onChange={e => set(i, { options: e.target.value.split(',').map(x => x.trim()) })} /></Field>}
    </div>)}</div>
    <div className="row" style={{ marginTop: 8 }}><button className="secondary" onClick={() => setFs([...fs, { key: '', label: '', type: 'text' }])}>＋ {L('ঘর', 'Field')}</button><button onClick={() => void save()}>{L('সেভ', 'Save')}</button>{ok && <span className="muted">{ok}</span>}</div>
    <ErrorNote error={err} />
  </section>
}

// ---------------------------------------------------------------- pending approvals (managers)
function PendingPanel({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const tk = useTk()
  const q = useLoad(() => vehicles.pending(ctx.hub || null).catch(() => [] as PendingLog[]), [ctx.hub, ctx.rows])
  const [err, setErr] = useState<unknown>(null)
  const list = q.data ?? []
  async function decide(x: PendingLog, ok: boolean) {
    const note = ok ? '' : ask(L('কেন বাতিল? কারণ লিখুন:', 'Why reject?')); if (!ok && !note) return
    try { await vehicles.decideLog(x.id, ok, note || null); if (ok && window.confirm(L('আজকের হিসাব খাতায় এখনই তুলবেন?', 'Put it on today’s sheet now?'))) await vehicles.logToSheet(x.id); ctx.toast(ok ? L('অনুমোদন হলো', 'Approved') : L('বাতিল হলো', 'Rejected')); await Promise.all([q.reload(), ctx.reload()]) } catch (e) { setErr(e) }
  }
  async function openSlip(path: string) { try { window.open(await vehicles.docUrl(path), '_blank') } catch (e) { setErr(e) } }
  if (!list.length && !err) return null
  return <section className="panel">
    <h2>{L('অনুমোদনের অপেক্ষায় — ড্রাইভারদের তেল / চার্জ', 'Waiting for approval — crew fuel / charge')} <span className="count-pill">{n(list.length)}</span></h2>
    <ErrorNote error={err} />
    <ul className="duty-list">{list.map(x => <li key={x.id} className="duty" style={{ alignItems: 'flex-start' }}>
      <Badge tone="warn">•</Badge>
      <span style={{ flex: 1 }}><b>{x.vehicle}</b> · {L(LOG_KIND[x.kind]?.[0] ?? x.kind, LOG_KIND[x.kind]?.[1] ?? x.kind)} · <b>{tk(x.amount)}</b>{x.litres ? ` · ${n(x.litres)} L` : ''}<br />
        <span className="muted small">{x.log_date} · {x.driver_name ?? '—'}{x.driver_code ? ` (ID ${x.driver_code})` : ''}{x.vendor ? ` · ${x.vendor}` : ''}{x.hub_name ? ` · ${x.hub_name}` : ''}{x.note ? ` · ${x.note}` : ''}</span>
        <span className="row" style={{ marginTop: 6 }}>{x.slip_path && <button className="secondary sm" onClick={() => void openSlip(x.slip_path!)}><Icon name="eye" size={13} /> {L('স্লিপ', 'Slip')}</button>}
          <button className="sm" onClick={() => void decide(x, true)}>{L('অনুমোদন', 'Approve')}</button><button className="danger sm" onClick={() => void decide(x, false)}>{L('না', 'Reject')}</button></span></span>
    </li>)}</ul>
  </section>
}

// ---------------------------------------------------------------- requisitions
function Requests({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const q = useLoad(() => vehicles.requisitions(ctx.hub || null, from || null, to || null), [ctx.hub, from, to])
  const settings = useLoad(() => vehicles.settings().catch(() => ({} as VehicleSettings)), [])
  const fields = settings.data?.requisition_format ?? []
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const list = q.data ?? []
  const openId = sp.get('id')
  const canCreate = can('vehicle.requisition.create')
  async function act(r: Requisition, status: string) {
    let note: string | null = null; let vehicle: string | null = null
    if (status === 'rejected' || status === 'cancelled') { note = ask(L('কারণ লিখুন:', 'Write why:')); if (!note) return }
    if (status === 'accepted' && !r.vehicle_id) {
      const opts = ctx.rows.filter(x => x.status === 'active')
      const pick = ask(L(`কোন গাড়ি দেবেন? নম্বর লিখুন:\n${opts.map((o, i) => `${i + 1}. ${vLabel(o)}${o.holder_name ? ' — ' + o.holder_name : ''}`).join('\n')}`, `Which vehicle? Type the number:\n${opts.map((o, i) => `${i + 1}. ${vLabel(o)}`).join('\n')}`))
      const i = Number(pick) - 1; if (!(i >= 0 && i < opts.length)) return
      vehicle = opts[i].id
    }
    try { await vehicles.updateRequisition(r.id, status, note, vehicle); ctx.toast(L('আপডেট হলো', 'Updated')); await q.reload() } catch (e) { setErr(e) }
  }
  const openReqs = list.filter(r => ['open', 'accepted', 'started'].includes(r.status)); const closed = list.filter(r => !['open', 'accepted', 'started'].includes(r.status))
  const Card = ({ r }: { r: Requisition }) => { const st = REQ_STATUS[r.status]; const hl = r.id === openId
    return <div className="team-card" style={hl ? { borderColor: 'var(--primary)' } : undefined}>
      <b><Icon name="truck" size={14} /> {r.no} · {r.work_date}{r.work_time ? ` ${r.work_time}` : ''}</b>
      <span>{r.job}</span>
      <span className="muted small">{L('হাব', 'Hub')}: {r.hub_name}{r.from_text || r.to_text ? ` · ${r.from_text ?? ''} → ${r.to_text ?? ''}` : ''}{r.parcels ? ` · ${n(r.parcels)} ${L('পার্সেল', 'parcels')}` : ''}{r.weight ? ` · ${r.weight}` : ''}</span>
      <span className="small">{r.vehicle ? <>{L('গাড়ি', 'Vehicle')}: <b>{r.vehicle}</b>{r.driver_name ? ` · ${r.driver_name}` : ''}</> : <span className="bad">{L('গাড়ি এখনো ঠিক হয়নি', 'No vehicle chosen yet')}</span>}</span>
      <DataLine fields={fields} data={r.data} />
      {r.note && <span className="muted small">{r.note}</span>}
      <span className="chips"><Badge tone={st[2]}>{L(st[0], st[1])}</Badge><span className="muted small">{L('চেয়েছেন', 'by')} {r.requested_by_name ?? '—'}</span>{r.decision_note ? <span className="muted small">{r.decision_note}</span> : null}</span>
      <span className="row">
        {r.status === 'open' && r.can_decide && <button className="sm" onClick={() => void act(r, 'accepted')}>{L('গ্রহণ', 'Accept')}</button>}
        {r.status === 'open' && !r.can_decide && r.is_crew && r.vehicle_id && <button className="sm" onClick={() => void act(r, 'accepted')}>{L('আমি যাব', 'I’ll take it')}</button>}
        {r.status === 'accepted' && (r.is_crew || r.can_decide) && <button className="sm" onClick={() => void act(r, 'started')}>{L('রওনা দিলাম', 'Started')}</button>}
        {r.status === 'started' && (r.is_crew || r.can_decide) && <button className="sm" onClick={() => void act(r, 'done')}>{L('কাজ শেষ', 'Done')}</button>}
        {r.status === 'open' && r.can_decide && <button className="danger sm" onClick={() => void act(r, 'rejected')}>{L('না', 'Reject')}</button>}
        {['open', 'accepted'].includes(r.status) && (r.is_mine || r.can_decide) && <button className="secondary sm" onClick={() => void act(r, 'cancelled')}>{L('বাতিল', 'Cancel')}</button>}
      </span>
    </div> }
  return <>
    <section className="da-filters panel no-print">
      <Field label={L('থেকে', 'From')}><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label={L('পর্যন্ত', 'To')}><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      {canCreate && <button onClick={() => setOpen(true)}><Icon name="plus" size={14} /> {L('গাড়ি লাগবে', 'Need a vehicle')}</button>}
      {openId && <button className="secondary sm" onClick={() => { sp.delete('id'); setSp(sp) }}>{L('হাইলাইট সরান', 'Clear highlight')}</button>}
    </section>
    <ErrorNote error={err ?? q.error} />
    <section className="panel"><h2>{L('চলমান', 'Open')} <span className="count-pill">{n(openReqs.length)}</span></h2>
      {q.data && !openReqs.length ? <p className="muted">{L('কোনো চলমান রিকুইজিশন নেই।', 'Nothing open.')}</p> : <div className="team-cards">{openReqs.map(r => <Card key={r.id} r={r} />)}</div>}</section>
    {closed.length > 0 && <section className="panel"><h2>{L('শেষ হওয়া', 'Closed')} <span className="count-pill">{n(closed.length)}</span></h2><div className="team-cards">{closed.map(r => <Card key={r.id} r={r} />)}</div></section>}
    <DriverRequests ctx={ctx} />
    {open && <NewRequisition ctx={ctx} fields={fields} onClose={() => setOpen(false)} onDone={async () => { setOpen(false); ctx.toast(L('পাঠানো হলো — ড্রাইভার ও ম্যানেজাররা নোটিফিকেশন পাবেন', 'Sent — crew and managers are notified')); await q.reload() }} />}
  </>
}

function NewRequisition({ ctx, fields, onClose, onDone }: { ctx: Ctx; fields: FormField[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { L } = usePrefs()
  const [hub, setHub] = useState(ctx.hub || ctx.hubs[0]?.hub_id || '')
  const [vehicle, setVehicle] = useState(''); const [date, setDate] = useState(today()); const [time, setTime] = useState('')
  const [job, setJob] = useState(''); const [fromT, setFromT] = useState(''); const [toT, setToT] = useState(''); const [note, setNote] = useState('')
  const [data, setData] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const big = ctx.rows.filter(r => r.status === 'active')
  async function save() {
    const miss = missingRequired(fields, data); if (miss.length) { setErr(new Error(L(`পূরণ করুন: ${miss.join(', ')}`, `Fill in: ${miss.join(', ')}`))); return }
    setBusy(true); setErr(null)
    try { await vehicles.submitRequisition({ hub, date, job, vehicle: vehicle || null, time: time || null, from: fromT || null, to: toT || null, parcels: data.parcels ? Number(data.parcels) : null, weight: data.weight || null, data, note: note || null }); await onDone() }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={L('গাড়ি লাগবে — রিকুইজিশন', 'Need a vehicle — requisition')} onClose={onClose} wide
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || !hub || !date || !job.trim()} onClick={() => void save()}>{L('পাঠান', 'Send')}</button></>}>
    <div className="da-grid3">
      <Field label={L('কোন হাবের জন্য *', 'For which hub *')}><select value={hub} onChange={e => setHub(e.target.value)}>{ctx.hubs.map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} #{h.code}</option>)}</select></Field>
      <Field label={L('কোন গাড়ি', 'Which vehicle')} hint={L('খালি রাখলে ম্যানেজার ঠিক করবেন', 'Blank = a manager assigns one')}><select value={vehicle} onChange={e => setVehicle(e.target.value)}><option value="">{L('যেকোনো', 'Any')}</option>{big.map(v => <option key={v.id} value={v.id}>{vLabel(v)}{v.holder_name ? ` — ${v.holder_name}` : ''}</option>)}</select></Field>
      <Field label={L('তারিখ *', 'Date *')}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label={L('সময়', 'Time')}><input type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
      <Field label={L('কোথা থেকে', 'From')}><input value={fromT} onChange={e => setFromT(e.target.value)} /></Field>
      <Field label={L('কোথায়', 'To')}><input value={toT} onChange={e => setToT(e.target.value)} /></Field>
      <Field label={L('কী কাজ *', 'What for *')} wide><input autoFocus value={job} onChange={e => setJob(e.target.value)} placeholder={L('যেমন: সর্টিং থেকে ৩০০ পার্সেল আনতে হবে', 'e.g. bring 300 parcels from sorting')} /></Field>
      <DynFields fields={fields} data={data} onChange={setData} />
      <Field label={L('নোট', 'Note')} wide><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    </div>
    <ErrorNote error={err} />
  </Modal>
}

// ---------------------------------------------------------------- day log (autos / battery)
function Daily({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const tk = useTk()
  const { vid, setVid, v } = useVehiclePick(ctx.rows)
  const [date, setDate] = useState(today())
  const settings = useLoad(() => vehicles.settings().catch(() => ({} as VehicleSettings)), [])
  const fields = settings.data?.day_format ?? []
  const listQ = useLoad(() => v ? vehicles.dayLogs(v.id, null, null, null) : Promise.resolve([] as DayLog[]), [v?.id])
  const existing = (listQ.data ?? []).find(d => d.log_date === date) ?? null
  const [d, setD] = useState<Partial<DayLog>>({})
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  useEffect(() => { setD(existing ? { ...existing } : { start_km: v?.odometer ?? undefined }) }, [existing, date, v?.id, v?.odometer])
  const set = (p: Partial<DayLog>) => setD({ ...d, ...p })
  const num = (s: string) => s === '' ? null : Number(s)
  async function save() {
    if (!v) return
    const miss = missingRequired(fields, d.data ?? {}); if (miss.length) { setErr(new Error(L(`পূরণ করুন: ${miss.join(', ')}`, `Fill in: ${miss.join(', ')}`))); return }
    setBusy(true); setErr(null)
    try {
      await vehicles.saveDay({ vehicle: v.id, date, charged: d.charged ?? null, charge_place: d.charge_place ?? null, charge_cost: d.charge_cost ?? null, out: d.out_at ?? null, in: d.in_at ?? null,
        start_km: d.start_km ?? null, end_km: d.end_km ?? null, trips: d.trips ?? null, data: d.data ?? {}, note: d.note ?? null })
      ctx.toast(L('দিনের খাতা সেভ হলো', 'Day log saved')); await Promise.all([listQ.reload(), ctx.reload()])
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  if (!ctx.rows.length) return <p className="notice">{L('আগে গাড়ি যোগ করুন।', 'Add a vehicle first.')}</p>
  const canWrite = v ? (v.home_manager || v.is_crew || ctx.hubs.some(h => h.can_log && (h.hub_id === v.hub_id || v.served_hub_ids?.includes(h.hub_id)))) : false
  return <>
    <section className="da-filters panel no-print"><VehicleSelect rows={ctx.rows} vid={vid} setVid={setVid} />
      <Field label={L('তারিখ', 'Date')}><input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field></section>
    <ErrorNote error={err ?? listQ.error} />
    {v && <section className="panel"><h2>{vLabel(v)} — {date}{existing ? <Badge tone="ok">{L('লেখা আছে', 'Recorded')}</Badge> : <Badge tone="warn">{L('এখনো লেখা হয়নি', 'Not yet')}</Badge>}</h2>
      <p className="muted small">{L('ড্রাইভার নিজে লিখবেন; না লিখলে ম্যানেজার লিখে দেবেন। চার্জের টাকা লিখলে সেটা গাড়ির খরচেও উঠে যাবে (ম্যানেজার লিখলে অনুমোদিত, ড্রাইভার লিখলে অপেক্ষায়)।', 'The driver writes it; if not, the manager does. A charge cost also becomes a vehicle cost (approved when a manager writes it, pending when the driver does).')}</p>
      <div className="da-grid3">
        <Field label={L('চার্জ দিয়েছে?', 'Charged?')}><span className="da-seg"><button className={d.charged === true ? 'sm' : 'secondary sm'} onClick={() => set({ charged: true })}>{L('হ্যাঁ', 'Yes')}</button><button className={d.charged === false ? 'sm' : 'secondary sm'} onClick={() => set({ charged: false })}>{L('না', 'No')}</button></span></Field>
        <Field label={L('কোথায় চার্জ', 'Charged where')}><input value={d.charge_place ?? ''} onChange={e => set({ charge_place: e.target.value })} placeholder={L('হাব / গ্যারেজ / দোকান', 'Hub / garage / shop')} /></Field>
        <Field label={L('চার্জের খরচ (৳)', 'Charge cost (৳)')}><input type="number" inputMode="numeric" min={0} value={d.charge_cost ?? ''} onChange={e => set({ charge_cost: num(e.target.value) })} /></Field>
        <Field label={L('বের হয়েছে', 'Out at')}><input type="time" value={d.out_at ?? ''} onChange={e => set({ out_at: e.target.value || null })} /></Field>
        <Field label={L('ফিরেছে', 'Back at')}><input type="time" value={d.in_at ?? ''} onChange={e => set({ in_at: e.target.value || null })} /></Field>
        <Field label={L('ট্রিপ', 'Trips')}><input type="number" inputMode="numeric" min={0} value={d.trips ?? ''} onChange={e => set({ trips: num(e.target.value) })} /></Field>
        <Field label={L('শুরুর কিমি', 'Start km')}><input type="number" inputMode="numeric" min={0} value={d.start_km ?? ''} onChange={e => set({ start_km: num(e.target.value) })} /></Field>
        <Field label={L('শেষের কিমি', 'End km')}><input type="number" inputMode="numeric" min={0} value={d.end_km ?? ''} onChange={e => set({ end_km: num(e.target.value) })} /></Field>
        <DynFields fields={fields} data={d.data ?? {}} onChange={x => set({ data: x })} />
        <Field label={L('নোট', 'Note')} wide><input value={d.note ?? ''} onChange={e => set({ note: e.target.value })} /></Field>
      </div>
      {canWrite && <button style={{ marginTop: 10 }} disabled={busy} onClick={() => void save()}><Icon name="save" size={14} /> {L('সেভ', 'Save')}</button>}
    </section>}
    {v && <DataTable<DayLog> title={L(`${vLabel(v)} — দিনের খাতা`, `${vLabel(v)} — day log`)} rows={listQ.data} rowKey={x => x.id} file="vehicle-days" empty={L('এখনো কোনো দিন লেখা হয়নি।', 'No day recorded yet.')}
      onRowClick={x => setDate(x.log_date)}
      cols={[
        { key: 'log_date', label: L('তারিখ', 'Date') },
        { key: 'driver_name', label: L('ড্রাইভার', 'Driver'), value: x => x.driver_name ?? '' },
        { key: 'charged', label: L('চার্জ', 'Charged'), value: x => x.charged == null ? '' : x.charged ? L('হ্যাঁ', 'Yes') : L('না', 'No') },
        { key: 'charge_cost', label: L('চার্জ খরচ', 'Charge ৳'), value: x => x.charge_cost ?? '', render: x => x.charge_cost ? tk(x.charge_cost) : <span className="muted">—</span> },
        { key: 'time', label: L('বের / ফেরা', 'Out / in'), value: x => [x.out_at?.slice(0, 5), x.in_at?.slice(0, 5)].filter(Boolean).join(' → ') },
        { key: 'km', label: 'km', value: x => x.start_km != null && x.end_km != null ? x.end_km - x.start_km : '', render: x => x.start_km != null && x.end_km != null ? <>{n(x.end_km - x.start_km)}<span className="sec">{n(x.start_km)} → {n(x.end_km)}</span></> : <span className="muted">—</span> },
        { key: 'trips', label: L('ট্রিপ', 'Trips'), value: x => x.trips ?? '' },
        { key: 'extra', label: L('আরও', 'More'), value: x => Object.entries(x.data ?? {}).filter(([, v2]) => v2).map(([k, v2]) => `${fields.find(f => f.key === k)?.label ?? k}: ${v2}`).join(' · ') },
        { key: 'note', label: L('নোট', 'Note'), value: x => x.note ?? '' },
      ]} />}
  </>
}

// ---------------------------------------------------------------- my vehicle (driver / helper)
function Mine({ ctx }: { ctx: Ctx }) {
  const { L, n } = usePrefs(); const tk = useTk()
  const mine = ctx.rows.filter(r => r.is_crew)
  const [fuelFor, setFuelFor] = useState<VehicleRow | null>(null)
  const [askFor, setAskFor] = useState<{ v: VehicleRow; kind: DriverRequest['kind'] } | null>(null)
  const dreqs = useLoad(() => vehicles.driverRequests(null, null, false).catch(() => [] as DriverRequest[]), [ctx.rows])
  const myDreqs = (dreqs.data ?? []).filter(r => r.is_mine).slice(0, 10)
  const reqs = useLoad(() => vehicles.requisitions(null, today(), null).catch(() => [] as Requisition[]), [ctx.rows])
  const myReqs = (reqs.data ?? []).filter(r => r.is_crew && ['open', 'accepted', 'started'].includes(r.status))
  const first = mine[0]
  const logs = useLoad(() => first ? vehicles.logs(first.id, null, null) : Promise.resolve([] as VehicleLog[]), [first?.id, ctx.rows])
  const [err, setErr] = useState<unknown>(null)
  async function openSlip(path: string) { try { window.open(await vehicles.docUrl(path), '_blank') } catch (e) { setErr(e) } }
  if (!mine.length) return <p className="notice">{L('আপনার নামে কোনো গাড়ি নেই। ম্যানেজার আপনাকে ড্রাইভার বা হেল্পার করলে এখানে দেখাবে।', 'No vehicle is in your name. It appears here once a manager makes you its driver or helper.')}</p>
  return <>
    <ErrorNote error={err} />
    <div className="team-cards">{mine.map(r => <div key={r.id} className="team-card">
      <b><Icon name={VEHICLE_KIND[r.kind]?.[2] ?? 'truck'} size={14} /> {vLabel(r)}</b>
      <span className="muted small">{r.hub_name ?? '—'}{r.served_hubs ? ` · ${L('কাজ করে', 'serves')} ${r.served_hubs}` : ''}</span>
      <span className="small">{r.holder_id && r.is_crew && r.holder_name ? `${L('ড্রাইভার', 'Driver')}: ${r.holder_name}` : ''}{r.helper_name ? ` · ${L('হেল্পার', 'Helper')}: ${r.helper_name}` : ''}</span>
      <span className="small">{n(r.odometer)} km · {L('এ মাসে খরচ', 'month')} {tk(r.spent_month)}{r.pending_logs ? <> · <span className="bad">{n(r.pending_logs)} {L('অপেক্ষায়', 'pending')}</span></> : null}</span>
      <span className="chips"><StatusB s={r.status} />{r.docs_expired || r.docs_expiring ? <Badge tone={r.docs_expired ? 'bad' : 'warn'}>{L('কাগজের মেয়াদ দেখুন', 'check papers')}</Badge> : null}{r.service_due ? <Badge tone="warn">{L('সার্ভিস বাকি', 'service due')}</Badge> : null}</span>
      <div className="quick-grid" style={{ width: '100%', marginTop: 6 }}>
        <button className="quick-tile t-g" onClick={() => setFuelFor(r)}><Icon name="cash" size={22} /><span>{L('তেল তুলেছি', 'Fuel filled')}</span></button>
        <button className="quick-tile t-b" onClick={() => setAskFor({ v: r, kind: 'parts' })}><Icon name="box" size={22} /><span>{L('পার্টস লাগবে', 'Need parts')}</span></button>
        <button className="quick-tile t-p" onClick={() => setAskFor({ v: r, kind: 'service' })}><Icon name="gear" size={22} /><span>{L('সার্ভিসিং লাগবে', 'Need service')}</span></button>
        <button className="quick-tile t-r" onClick={() => setAskFor({ v: r, kind: 'problem' })}><Icon name="alert" size={22} /><span>{L('সমস্যা জানান', 'Report problem')}</span></button>
        <Link to="/app/vehicles/daily" onClick={() => { try { sessionStorage.setItem(VKEY, r.id) } catch { /* ignore */ } }} className="quick-tile t-o"><Icon name="cal" size={22} /><span>{L('দিনের খাতা', 'Day log')}</span></Link>
      </div>
    </div>)}</div>
    <section className="panel"><h2>{L('আমার অনুরোধ (পার্টস / সার্ভিস / সমস্যা)', 'My requests')} <span className="count-pill">{n(myDreqs.length)}</span></h2>
      {dreqs.data && !myDreqs.length ? <p className="muted">{L('কিছু চাওয়া হয়নি।', 'Nothing asked yet.')}</p> : <ul className="duty-list">{myDreqs.map(r => <li key={r.id} className="duty"><Badge tone={DREQ_STATUS[r.status][2]}>{L(DREQ_STATUS[r.status][0], DREQ_STATUS[r.status][1])}</Badge>
        <span><b>{r.no}</b> · {L(DREQ_KIND[r.kind][0], DREQ_KIND[r.kind][1])} · {r.title}{r.priority === 'urgent' ? ' 🔴' : ''}{r.decision_note ? <span className="muted small"> — {r.decision_note}</span> : null}</span></li>)}</ul>}</section>
    <section className="panel"><h2>{L('আমার কাজ (রিকুইজিশন)', 'My jobs (requisitions)')} <span className="count-pill">{n(myReqs.length)}</span></h2>
      {reqs.data && !myReqs.length ? <p className="muted">{L('এখন কোনো কাজ নেই।', 'No job right now.')}</p> : <ul className="duty-list">{myReqs.map(r => <li key={r.id} className="duty"><Badge tone={REQ_STATUS[r.status][2]}>{L(REQ_STATUS[r.status][0], REQ_STATUS[r.status][1])}</Badge>
        <span><b>{r.work_date}{r.work_time ? ` ${r.work_time}` : ''}</b> · {r.hub_name} · {r.job}{r.from_text || r.to_text ? ` · ${r.from_text ?? ''} → ${r.to_text ?? ''}` : ''} <Link to={`/app/vehicles/requests?id=${r.id}`}>{L('খুলুন →', 'Open →')}</Link></span></li>)}</ul>}</section>
    {first && <section className="panel"><h2>{L('আমার তেল / খরচ', 'My fuel / costs')}</h2>
      <ErrorNote error={logs.error} />
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('তারিখ', 'Date')}</th><th>{L('খাত', 'Kind')}</th><th>{L('টাকা', 'Amount')}</th><th>{L('অবস্থা', 'Status')}</th><th /></tr></thead>
        <tbody>{(logs.data ?? []).slice(0, 20).map(x => <tr key={x.id}><td>{x.log_date}</td><td>{L(LOG_KIND[x.kind]?.[0] ?? x.kind, LOG_KIND[x.kind]?.[1] ?? x.kind)}{x.litres ? <span className="sec">{n(x.litres)} L</span> : null}</td><td><b>{tk(x.amount)}</b></td>
          <td><Badge tone={LOG_STATUS[x.status][2]}>{L(LOG_STATUS[x.status][0], LOG_STATUS[x.status][1])}</Badge>{x.da_expense_id ? <span className="sec">{L('খাতায় উঠেছে', 'on sheet')}</span> : null}{x.decision_note ? <span className="sec">{x.decision_note}</span> : null}</td>
          <td>{x.slip_path && <button className="secondary sm" onClick={() => void openSlip(x.slip_path!)}>{L('স্লিপ', 'Slip')}</button>}</td></tr>)}
          {logs.data && !logs.data.length && <tr><td colSpan={5} className="muted">{L('এখনো কিছু লেখা হয়নি।', 'Nothing yet.')}</td></tr>}</tbody></table></div></section>}
    {askFor && <DriverRequestModal v={askFor.v} kind={askFor.kind} onClose={() => setAskFor(null)} onDone={async () => { setAskFor(null); ctx.toast(L('পাঠানো হলো — ম্যানেজাররা নোটিফিকেশন পাবেন', 'Sent — managers are notified')); await dreqs.reload() }} />}
    {fuelFor && <EditLog v={fuelFor} x={{ kind: 'fuel', log_date: today(), odometer: fuelFor.odometer || null }} onClose={() => setFuelFor(null)} onDone={async () => { setFuelFor(null); ctx.toast(fuelFor.home_manager ? L('লেখা হলো', 'Saved') : L('জমা হলো — ম্যানেজার দেখে অনুমোদন দেবেন', 'Submitted — a manager will approve')); await Promise.all([logs.reload(), ctx.reload()]) }} />}
  </>
}

// ---------------------------------------------------------------- driver requests: parts / service / problem
function DriverRequestModal({ v, kind, onClose, onDone }: { v: VehicleRow; kind: DriverRequest['kind']; onClose: () => void; onDone: () => Promise<void> }) {
  const { L } = usePrefs()
  const settings = useLoad(() => vehicles.settings().catch(() => ({} as VehicleSettings)), [])
  const fields = settings.data?.request_formats?.[kind] ?? []
  const [data, setData] = useState<Record<string, string>>({})
  const [title, setTitle] = useState(''); const [urgent, setUrgent] = useState(kind === 'problem')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const auto = fields.length ? Object.values(data).find(x => x?.trim()) ?? '' : ''
  async function save() {
    const miss = missingRequired(fields, data); if (miss.length) { setErr(new Error(L(`পূরণ করুন: ${miss.join(', ')}`, `Fill in: ${miss.join(', ')}`))); return }
    const t = title.trim() || auto; if (!t) { setErr(new Error(L('কী লাগবে / কী সমস্যা লিখুন', 'Write what you need'))); return }
    setBusy(true); setErr(null)
    try { const path = photo ? await vehicles.uploadDoc(v.id, photo) : null
      await vehicles.submitDriverRequest({ vehicle: v.id, kind, title: t, data, priority: urgent ? 'urgent' : 'normal', photo: path }); await onDone() }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={`${vLabel(v)} — ${L(DREQ_KIND[kind][0], DREQ_KIND[kind][1])}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || settings.loading} onClick={() => void save()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('পাঠান', 'Send')}</button></>}>
    <div className="da-grid2">
      <DynFields fields={fields} data={data} onChange={setData} />
      {!fields.length && <Field label={L('কী লাগবে / কী সমস্যা *', 'What do you need *')} wide><textarea rows={3} autoFocus value={title} onChange={e => setTitle(e.target.value)} /></Field>}
      {fields.length > 0 && <Field label={L('এক লাইনে (ঐচ্ছিক)', 'One line (optional)')} wide hint={L('খালি রাখলে উপরের প্রথম ঘর থেকে নেওয়া হবে', 'Blank = taken from the first field')}><input value={title} onChange={e => setTitle(e.target.value)} /></Field>}
      <Field label={L('ছবি (ঐচ্ছিক)', 'Photo (optional)')}><input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></Field>
      <Field label={L('জরুরি?', 'Urgent?')}><label className="row" style={{ alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={urgent} onChange={e => setUrgent(e.target.checked)} /> {L('হ্যাঁ, এখনই দেখা দরকার', 'Yes, needs attention now')}</label></Field>
    </div>
    <ErrorNote error={err} />
  </Modal>
}

function DriverRequests({ ctx, openOnly }: { ctx: Ctx; openOnly?: boolean }) {
  const { L, n } = usePrefs(); const tk = useTk()
  const [sp] = useSearchParams(); const hl = sp.get('q')
  const q = useLoad(() => vehicles.driverRequests(ctx.hub || null, null, !!openOnly).catch(() => [] as DriverRequest[]), [ctx.hub, ctx.rows, openOnly])
  const settings = useLoad(() => vehicles.settings().catch(() => ({} as VehicleSettings)), [])
  const [err, setErr] = useState<unknown>(null)
  const [askFor, setAskFor] = useState<{ v: VehicleRow; kind: DriverRequest['kind'] } | null>(null)
  const list = q.data ?? []
  async function act(r: DriverRequest, status: string) {
    let note: string | null = null; let cost: number | null = null
    if (status === 'rejected' || status === 'cancelled') { note = ask(L('কারণ লিখুন:', 'Write why:')); if (!note) return }
    if (status === 'done') { const c = ask(L('কত টাকা খরচ হলো? (না হলে ০) — গাড়ির খরচে উঠবে', 'Cost in ৳ (0 if none) — goes to vehicle costs')); if (c === '') return; cost = Number(c) || 0; note = ask(L('কী করা হলো (ঐচ্ছিক):', 'What was done (optional):')) || null }
    if (status === 'accepted') note = ask(L('ড্রাইভারকে কী বলবেন? (ঐচ্ছিক)', 'Message to the driver (optional)')) || null
    try { await vehicles.updateDriverRequest(r.id, status, note, cost); ctx.toast(L('আপডেট হলো', 'Updated')); await Promise.all([q.reload(), ctx.reload()]) } catch (e) { setErr(e) }
  }
  async function openPhoto(path: string) { try { window.open(await vehicles.docUrl(path), '_blank') } catch (e) { setErr(e) } }
  if (openOnly && !list.length && !err) return null
  const canAsk = ctx.rows.some(r => r.home_manager || r.is_crew)
  return <section className="panel">
    <h2>{openOnly ? L('ড্রাইভারদের অনুরোধ — অপেক্ষায়', 'Driver requests — open') : L('ড্রাইভারদের অনুরোধ (পার্টস / সার্ভিস / সমস্যা)', 'Driver requests (parts / service / problems)')} <span className="count-pill">{n(list.length)}</span></h2>
    {!openOnly && canAsk && <div className="da-seg" style={{ marginBottom: 8, flexWrap: 'wrap' }}>{(['parts', 'service', 'problem'] as const).map(k => <button key={k} className="secondary sm" onClick={() => { const v = ctx.rows.find(r => r.is_crew) ?? ctx.rows[0]; if (v) setAskFor({ v, kind: k }) }}><Icon name={DREQ_KIND[k][2]} size={13} /> {L(DREQ_KIND[k][0], DREQ_KIND[k][1])}</button>)}</div>}
    <ErrorNote error={err ?? q.error} />
    {q.data && !list.length ? <p className="muted">{L('কিছু নেই।', 'Nothing here.')}</p> : <ul className="duty-list">{list.map(r => { const fields = settings.data?.request_formats?.[r.kind] ?? []
      return <li key={r.id} className="duty" style={{ alignItems: 'flex-start', ...(r.id === hl ? { outline: '2px solid var(--primary)', borderRadius: 10 } : {}) }}>
        <Badge tone={DREQ_STATUS[r.status][2]}>{r.priority === 'urgent' ? '!' : '•'}</Badge>
        <span style={{ flex: 1 }}><b>{r.no} · {L(DREQ_KIND[r.kind][0], DREQ_KIND[r.kind][1])}</b> — {r.title}{r.priority === 'urgent' ? <Badge tone="bad">{L('জরুরি', 'urgent')}</Badge> : null}<br />
          <span className="muted small">{r.vehicle}{r.hub_name ? ` · ${r.hub_name}` : ''} · {r.by_name ?? '—'}{r.by_code ? ` (ID ${r.by_code})` : ''} · {new Date(r.created_at).toLocaleDateString('en-GB')}</span><br />
          <DataLine fields={fields} data={r.data} />
          <span className="chips" style={{ marginTop: 4 }}><Badge tone={DREQ_STATUS[r.status][2]}>{L(DREQ_STATUS[r.status][0], DREQ_STATUS[r.status][1])}</Badge>{r.cost ? <span className="muted small">{L('খরচ', 'cost')} {tk(r.cost)}</span> : null}{r.decision_note ? <span className="muted small">{r.decision_note}</span> : null}</span>
          <span className="row" style={{ marginTop: 6 }}>
            {r.photo_path && <button className="secondary sm" onClick={() => void openPhoto(r.photo_path!)}><Icon name="eye" size={13} /> {L('ছবি', 'Photo')}</button>}
            {r.status === 'open' && r.can_decide && <button className="sm" onClick={() => void act(r, 'accepted')}>{L('গ্রহণ', 'Accept')}</button>}
            {['open', 'accepted'].includes(r.status) && r.can_decide && <button className="sm" onClick={() => void act(r, 'done')}>{L('কাজ শেষ', 'Done')}</button>}
            {r.status === 'open' && r.can_decide && <button className="danger sm" onClick={() => void act(r, 'rejected')}>{L('না', 'Reject')}</button>}
            {['open', 'accepted'].includes(r.status) && r.is_mine && !r.can_decide && <button className="secondary sm" onClick={() => void act(r, 'cancelled')}>{L('বাতিল', 'Cancel')}</button>}
          </span></span>
      </li> })}</ul>}
    {askFor && <DriverRequestModal v={askFor.v} kind={askFor.kind} onClose={() => setAskFor(null)} onDone={async () => { setAskFor(null); ctx.toast(L('পাঠানো হলো', 'Sent')); await q.reload() }} />}
  </section>
}
