import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { hrFriendly } from '../../lib/hr'
import { PLAN_KIND, zonal, type Claim, type HubPerf, type PlanItem, type Recommendation, type TaskAcc, type Visit, type WorkDetail, type WorkStat } from '../../lib/zonal'
import { PulsePanel } from './PulsePanel'
import { useOrg } from '../hr/common'
import { AppDownloadCard } from '../../components/AppDownloadCard'
import { ReportStatus } from '../accounts/ReportStatus'

const dhaka = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const shift = (iso: string, days: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return dhaka(d) }
const monthStart = (iso: string) => iso.slice(0, 8) + '01'
const monthEnd = (iso: string) => { const d = new Date(monthStart(iso) + 'T00:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return dhaka(d) }

type Preset = 'today' | '7d' | 'month' | 'last_month' | 'custom'
function rangeOf(p: Preset, custom: { from: string; to: string }) {
  const t = dhaka()
  if (p === 'today') return { from: t, to: t }
  if (p === '7d') return { from: shift(t, -6), to: t }
  if (p === 'month') return { from: monthStart(t), to: t }
  if (p === 'last_month') { const e = shift(monthStart(t), -1); return { from: monthStart(e), to: e } }
  return custom
}

/** Zonal command centre: one screen for the zone — staff, hub performance, alerts, tasks, planning, visits and claims. */
export function ZonalDashboard() {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const nav = useNavigate()
  const o = useOrg()
  const { toast, node } = useToast()
  const [zone, setZone] = useState('')
  const [preset, setPreset] = useState<Preset>('month')
  const [custom, setCustom] = useState({ from: monthStart(dhaka()), to: dhaka() })
  const { from, to } = rangeOf(preset, custom)
  useEffect(() => { if (!zone && o.data?.zones.length === 1) setZone(o.data.zones[0].id) }, [o.data, zone])
  const z = zone || null
  // A manager of one zone may not ask for "all zones": wait until the zone list has loaded and their zone is picked.
  const ready = !!o.data && (zone !== '' || o.data.zones.length !== 1)
  const dash = useLoad(() => ready ? zonal.dashboard(z, from, to) : Promise.resolve(null), [z, from, to, ready])
  const hubs = useLoad(() => ready ? zonal.hubs(z, from, to).catch(() => [] as HubPerf[]) : Promise.resolve([] as HubPerf[]), [z, from, to, ready])
  const [detail, setDetail] = useState<{ stat: WorkStat; title: string } | null>(null)
  const [tab, setTab] = useState<'hubs' | 'reports' | 'tasks' | 'plan' | 'visits'>('hubs')
  const d = dash.data
  const tk = (x: number) => `৳${n(Math.round(x || 0))}`

  // Things to look at now, worst first. Each one opens the page where it is fixed.
  const alerts = useMemo(() => {
    if (!d) return [] as Array<{ tone: 'bad' | 'warn' | 'info'; text: string; to?: string; act?: () => void }>
    const silent = (hubs.data ?? []).filter(h => h.days_verified + h.days_unverified === 0)
    const a: Array<{ tone: 'bad' | 'warn' | 'info'; text: string; to?: string; act?: () => void }> = []
    if (d.tasks.overdue) a.push({ tone: 'bad', text: L(`${n(d.tasks.overdue)}টি কাজের সময় পেরিয়ে গেছে`, `${d.tasks.overdue} tasks overdue`), to: '/app/hub/tasks' })
    if (silent.length) a.push({ tone: 'bad', text: L(`${n(silent.length)}টি হাব এই সময়ে অপারেশনের হিসাব দেয়নি: ${silent.slice(0, 4).map(h => h.hub_name).join(', ')}${silent.length > 4 ? '…' : ''}`, `${silent.length} hubs sent no operation report`), to: '/app/hub/ops' })
    if (d.workforce.pending_applications) a.push({ tone: 'warn', text: L(`${n(d.workforce.pending_applications)}টি আইডি আবেদন অপেক্ষায়`, `${d.workforce.pending_applications} ID applications waiting`), to: '/app/hr/applications' })
    if (d.hubs.unverified_days) a.push({ tone: 'warn', text: L(`${n(d.hubs.unverified_days)} দিনের হাব হিসাব যাচাই বাকি`, `${d.hubs.unverified_days} hub-days not verified`), to: '/app/hub/ops' })
    if (d.tasks.awaiting_confirmation) a.push({ tone: 'warn', text: L(`${n(d.tasks.awaiting_confirmation)}টি কাজ জমা পড়েছে, নিশ্চিত করা বাকি`, `${d.tasks.awaiting_confirmation} tasks waiting for confirmation`), to: '/app/hub/tasks' })
    if (d.claims_pending) a.push({ tone: 'warn', text: L(`${n(d.claims_pending)}টি যাতায়াত ক্লেইম অনুমোদনের অপেক্ষায়`, `${d.claims_pending} travel claims waiting`), act: () => setTab('visits') })
    if (d.data_completion.incomplete) a.push({ tone: 'info', text: L(`${n(d.data_completion.incomplete)} জনের প্রোফাইল অসম্পূর্ণ (গড় ${n(d.data_completion.average_pct)}%)`, `${d.data_completion.incomplete} profiles incomplete`), to: '/app/hr/profile-gaps' })
    if (d.travel.unclaimed) a.push({ tone: 'info', text: L(`${n(d.travel.unclaimed)}টি ভিজিটের ক্লেইম জমা হয়নি`, `${d.travel.unclaimed} visits not claimed`), act: () => setTab('visits') })
    return a
  }, [d, hubs.data, L, n])

  const ws = (stat: WorkStat, label: string, tone?: 'ok' | 'warn' | 'bad', icon?: string) =>
    <button key={stat} type="button" className="zd-stat" onClick={() => setDetail({ stat, title: label })} title={L('তালিকা দেখুন', 'Show the list')}>
      <Stat label={label} value={n(d?.workforce[stat] ?? 0)} tone={tone} icon={icon} /></button>

  return <AppShell title={L('জোনাল ড্যাশবোর্ড', 'Zonal dashboard')}
    subtitle={L('পুরো জোন এক পাতায়: কর্মী, হাবের পারফরম্যান্স, সতর্কতা, কাজ, পরিকল্পনা, ভিজিট ও ক্লেইম।', 'The whole zone on one page: staff, hub performance, alerts, tasks, planning, visits and claims.')}
    actions={<>
      {(can('zonal.hub_ops.view') || can('zonal.hub_ops.create')) && <Link to="/app/zonal/hub-ops" className="btn-ghost"><Icon name="chart" size={16} />{L('হাব অপারেশন ড্যাশবোর্ড', 'Hub Operations Dashboard')}</Link>}
      {can('hr.attendance.configure') && <Link to="/app/workforce/zone?tab=setting" className="btn-ghost"><Icon name="cal" size={16} />{L('হাজিরা: আগের তারিখ খোলা', 'Attendance: open earlier dates')}</Link>}
      <Link to="/app/accounts/report-import" className="btn-ghost"><Icon name="upload" size={16} />{L('রিপোর্ট আপলোড', 'Report upload')}</Link>
      <Link to="/app/staff/list" className="btn-ghost"><Icon name="users" size={16} />{L('হাব অনুযায়ী কর্মী ও বদলি', 'Staff by hub & transfers')}</Link>
      <button className="secondary no-print" onClick={() => window.print()}><Icon name="print" size={16} />{L('প্রিন্ট', 'Print')}</button></>}>
    {node}
    <section className="da-filters panel no-print">
      {(o.data?.zones.length ?? 0) > 1 && <Field label={L('জোন', 'Zone')}><select value={zone} onChange={e => setZone(e.target.value)}>
        <option value="">{L('সব জোন', 'All zones')}</option>{o.data?.zones.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      <div className="da-seg">{([['today', 'আজ', 'Today'], ['7d', '৭ দিন', '7 days'], ['month', 'এই মাস', 'This month'], ['last_month', 'গত মাস', 'Last month'], ['custom', 'নিজে বাছুন', 'Custom']] as const).map(([k, b, e]) =>
        <button key={k} className={preset === k ? '' : 'secondary'} onClick={() => setPreset(k)}>{L(b, e)}</button>)}</div>
      {preset === 'custom' && <>
        <Field label={L('থেকে', 'From')}><input type="date" value={custom.from} max={custom.to} onChange={e => setCustom({ ...custom, from: e.target.value })} /></Field>
        <Field label={L('পর্যন্ত', 'To')}><input type="date" value={custom.to} min={custom.from} max={dhaka()} onChange={e => setCustom({ ...custom, to: e.target.value })} /></Field></>}
      {dash.loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}
    </section>
    {dash.error ? <p className="da-error">{hrFriendly(dash.error)}</p> : null}
    {can('zonal.pulse.manage') && <PulsePanel zone={zone || (o.data?.zones.length === 1 ? o.data.zones[0].id : '')} />}

    {d && <>
      <section className="panel">
        <div className="da-bar"><h2 style={{ margin: 0 }}><Icon name="alert" size={18} /> {L('এখনই দেখুন', 'Look at now')} <span className="count-pill">{n(alerts.length)}</span></h2></div>
        {!alerts.length ? <p className="da-ok">{L('সব ঠিক আছে — এই সময়ে জরুরি কিছু নেই।', 'All clear for this period.')}</p>
          : <ul className="zd-alerts">{alerts.map((a, i) => <li key={i} className={`zd-al ${a.tone}`}>
              <Badge tone={a.tone}>{a.tone === 'bad' ? L('জরুরি', 'Urgent') : a.tone === 'warn' ? L('বাকি', 'Pending') : L('তথ্য', 'Info')}</Badge>
              <span style={{ flex: 1 }}>{a.text}</span>
              {a.to ? <Link to={a.to} className="btn-ghost">{L('খুলুন', 'Open')} →</Link> : <button className="secondary sm" onClick={a.act}>{L('দেখুন', 'View')}</button>}</li>)}</ul>}
      </section>

      <h3 className="zd-h">{L('কর্মী', 'Staff')} <span className="muted small">{L('— সংখ্যায় চাপলে নামের তালিকা', '— tap a number for the names')}</span></h3>
      <div className="da-stats">
        {ws('total', L('মোট কর্মী', 'Total staff'), undefined, 'users')}
        {ws('active', L('সক্রিয়', 'Active'), 'ok', 'check')}
        {ws('inactive', L('নিষ্ক্রিয়', 'Inactive'), undefined, 'clock')}
        {ws('new_joining', L('নতুন যোগদান', 'New joining'), 'ok', 'plus')}
        {ws('resigned', L('চাকরি ছেড়েছেন', 'Left'), d.workforce.resigned ? 'bad' : undefined, 'out')}
        {ws('transferred', L('বদলি', 'Transferred'), undefined, 'hub')}
        {ws('employee_id_issued', L('নতুন আইডি', 'IDs issued'), undefined, 'key')}
        {ws('pending_applications', L('আইডির অপেক্ষায়', 'Waiting for ID'), d.workforce.pending_applications ? 'warn' : undefined, 'form')}
      </div>

      <h3 className="zd-h">{L('অপারেশন ও টাকা', 'Operations & money')}</h3>
      <div className="da-stats">
        <Stat icon="hub" label={L('হাব', 'Hubs')} value={n(d.hubs.hub_count)} />
        <Stat icon="box" label={L('পিকআপ', 'Pickups')} value={n(d.hubs.pickups)} />
        <Stat icon="truck" label={L('ডেলিভারি', 'Deliveries')} value={n(d.hubs.deliveries)} />
        <Stat icon="alert" tone={d.hubs.pending_parcels ? 'warn' : undefined} label={L('জমে থাকা পার্সেল', 'Pending parcels')} value={n(d.hubs.pending_parcels)} />
        <Stat icon="cash" tone="ok" label={L('ক্যাশ কালেকশন', 'Cash collected')} value={tk(d.hubs.cash_collected)} />
        <Stat icon="receipt" label={L('খরচ', 'Expenses')} value={tk(d.hubs.expenses)}
          sub={d.hubs.pickups + d.hubs.deliveries ? L(`প্রতি পার্সেল ${tk(d.hubs.expenses / (d.hubs.pickups + d.hubs.deliveries))}`, 'per parcel') : undefined} />
        <Stat icon="users" label={L('মার্চেন্ট', 'Merchants')} value={n(d.hubs.merchants)} />
        <Stat icon="form" tone={d.data_completion.incomplete ? 'warn' : 'ok'} label={L('প্রোফাইল পূর্ণতা', 'Profile completeness')} value={`${n(d.data_completion.average_pct)}%`} />
      </div>

      <h3 className="zd-h">{L('কাজ ও ভিজিট', 'Tasks & visits')}</h3>
      <div className="da-stats">
        <Stat icon="tasks" label={L('চলমান কাজ', 'Open tasks')} value={n(d.tasks.open)} />
        <Stat icon="clock" tone={d.tasks.overdue ? 'bad' : undefined} label={L('সময় পেরিয়েছে', 'Overdue')} value={n(d.tasks.overdue)} />
        <Stat icon="check" tone="ok" label={L('শেষ হয়েছে', 'Completed')} value={n(d.tasks.completed)} />
        <Stat icon="map" label={L('হাব ভিজিট', 'Hub visits')} value={n(d.travel.visits)} sub={L(`${n(d.travel.total_km)} কিমি`, `${d.travel.total_km} km`)} />
        <Stat icon="wallet" label={L('যাতায়াত খরচ', 'Travel cost')} value={tk(d.travel.total)} />
        <Stat icon="receipt" tone={d.claims_pending ? 'warn' : undefined} label={L('ক্লেইম অপেক্ষায়', 'Claims waiting')} value={n(d.claims_pending)} />
      </div>
    </>}

    <nav className="emp-tabs no-print" role="tablist" style={{ marginTop: 14 }}>
      {([['hubs', 'হাবের পারফরম্যান্স', 'Hub performance', 'chart'], ['reports', 'আজকের রিপোর্ট', 'Today’s reports', 'upload'], ['tasks', 'ম্যানেজারদের কাজ', 'Managers’ tasks', 'tasks'],
        ['plan', 'জনবল পরিকল্পনা', 'Workforce plan', 'users'], ['visits', 'ভিজিট ও ক্লেইম', 'Visits & claims', 'map']] as const).map(([k, b, e, ic]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={ic} size={16} />{L(b, e)}</button>)}
    </nav>
    {tab === 'hubs' && <HubPerformance rows={hubs.data ?? []} loading={hubs.loading} onOpen={() => nav('/app/staff/list')} />}
    {tab === 'reports' && <ReportStatus zone={z} />}
    {tab === 'tasks' && <ManagerTasks zone={z} from={from} to={to} />}
    {tab === 'plan' && <WorkforcePlan zone={zone} from={from} to={to} onToast={toast} />}
    {tab === 'visits' && <VisitsClaims zone={zone} from={from} to={to} onToast={m => { toast(m); void dash.reload() }} />}

    {detail && <WorkList stat={detail.stat} title={detail.title} zone={z} from={from} to={to} onClose={() => setDetail(null)} onOpen={id => nav(`/app/hr/employees/${id}`)} />}
    {!can('zonal.dashboard.view') && <p className="muted small">{L('এই পাতা দেখার অনুমতি দরকার: zonal.dashboard.view', 'Needs zonal.dashboard.view')}</p>}
    <AppDownloadCard />
  </AppShell>
}

function WorkList({ stat, title, zone, from, to, onClose, onOpen }: { stat: WorkStat; title: string; zone: string | null; from: string; to: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { L } = usePrefs()
  const q = useLoad(() => zonal.details(stat, zone, from, to), [stat, zone, from, to])
  return <Modal wide title={title} onClose={onClose} actions={<button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button>}>
    {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : null}
    <DataTable<WorkDetail> title={title} file={`zonal-${stat}`} rows={q.data} rowKey={r => r.employee_id + (r.event_date ?? '')} onRowClick={r => onOpen(r.employee_id)}
      empty={<p className="muted">{q.loading ? L('লোড হচ্ছে…', 'Loading…') : L('কেউ নেই', 'Nobody')}</p>}
      cols={[
        { key: 'code', label: L('আইডি', 'ID'), value: r => r.employee_code ?? '' },
        { key: 'name', label: L('নাম', 'Name'), value: r => r.full_name },
        { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name ?? '' },
        { key: 'pos', label: L('পদবি', 'Post'), value: r => r.position_name ?? '' },
        { key: 'date', label: L('তারিখ', 'Date'), value: r => r.event_date ?? '' },
        { key: 'detail', label: L('বিস্তারিত', 'Detail'), value: r => r.detail ?? '' },
      ]} />
  </Modal>
}

function HubPerformance({ rows, loading, onOpen }: { rows: HubPerf[]; loading: boolean; onOpen: () => void }) {
  const { L, n } = usePrefs()
  const sorted = [...rows].sort((a, b) => (b.pickups + b.deliveries) - (a.pickups + a.deliveries))
  const max = Math.max(1, ...sorted.map(r => r.pickups + r.deliveries))
  const anyData = sorted.some(r => r.pickups + r.deliveries > 0)
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('হাব অনুযায়ী পার্সেল', 'Parcels by hub')}</h2>
      <Link to="/app/hub/ops" className="btn-ghost">{L('হাবের দৈনিক হিসাব', 'Hub daily report')} →</Link></div>
    {loading && !rows.length ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !anyData ? <p className="muted">{L('এই সময়ে কোনো হাব দৈনিক অপারেশনের হিসাব (পিকআপ / ডেলিভারি) দেয়নি। হাব ম্যানেজাররা “আজকের হাব অপারেশন” পাতায় দিলে এখানে চার্ট আর র‍্যাংক দেখাবে।',
          'No hub sent daily figures in this period. Once hub managers fill “Today’s hub operation”, the chart and ranking show here.')}</p>
      : <div className="zd-bars" role="list" aria-label={L('হাব অনুযায়ী পার্সেল', 'Parcels by hub')}>{sorted.map(r => {
          const tot = r.pickups + r.deliveries
          return <div key={r.hub_id} className="zd-bar" role="listitem" title={`${r.hub_name}: ${L('পিকআপ', 'Pickups')} ${n(r.pickups)} · ${L('ডেলিভারি', 'Deliveries')} ${n(r.deliveries)} · ${L('জমা', 'Pending')} ${n(r.pending_parcels)}`}>
            <span className="zd-bl">{r.hub_name}</span>
            <span className="zd-track"><span className="zd-fill" style={{ width: `${(100 * tot) / max}%` }} /></span>
            <span className="zd-bv">{n(tot)}{r.volume_share_pct != null && <small className="muted"> · {n(r.volume_share_pct)}%</small>}</span></div>
        })}</div>}
    <DataTable<HubPerf> title={L('হাবের পারফরম্যান্স', 'Hub performance')} file="hub-performance" rows={sorted} rowKey={r => r.hub_id} onRowClick={onOpen}
      cols={[
        { key: 'rank', label: L('র‍্যাংক', 'Rank'), value: r => r.volume_rank ?? '' },
        { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name },
        { key: 'pick', label: L('পিকআপ', 'Pickups'), value: r => r.pickups },
        { key: 'del', label: L('ডেলিভারি', 'Deliveries'), value: r => r.deliveries },
        { key: 'pend', label: L('জমে থাকা', 'Pending'), value: r => r.pending_parcels, render: r => r.pending_parcels ? <Badge tone="warn">{n(r.pending_parcels)}</Badge> : <span className="muted">—</span> },
        { key: 'ppr', label: L('রাইডার প্রতি/দিন', 'Per rider/day'), value: r => r.parcels_per_rider_day ?? '' },
        { key: 'cash', label: L('ক্যাশ', 'Cash'), value: r => Math.round(r.cash_collected) },
        { key: 'exp', label: L('খরচ', 'Expenses'), value: r => Math.round(r.expenses) },
        { key: 'epp', label: L('খরচ/পার্সেল', 'Cost/parcel'), value: r => r.expense_per_parcel ?? '' },
        { key: 'days', label: L('রিপোর্টের দিন', 'Days reported'), value: r => r.days_verified + r.days_unverified,
          render: r => <>{n(r.days_verified + r.days_unverified)}{r.days_unverified ? <> <Badge tone="warn">{L(`${n(r.days_unverified)} যাচাই বাকি`, `${r.days_unverified} unverified`)}</Badge></> : null}</> },
      ]} />
  </section>
}

function ManagerTasks({ zone, from, to }: { zone: string | null; from: string; to: string }) {
  const { L, n } = usePrefs()
  const q = useLoad(() => zonal.tasks(zone, from, to), [zone, from, to])
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('কে কতটা কাজ সময়মতো শেষ করছেন', 'Who finishes tasks on time')}</h2>
      <Link to="/app/hub/tasks" className="btn-ghost">{L('নতুন কাজ দিন', 'Give a task')} →</Link></div>
    {q.error ? <p className="da-error">{hrFriendly(q.error)}</p> : null}
    <DataTable<TaskAcc> title={L('ম্যানেজারদের কাজের হিসাব', 'Manager task accountability')} file="manager-tasks" rows={q.data} rowKey={r => r.manager_id}
      empty={<p className="muted">{q.loading ? L('লোড হচ্ছে…', 'Loading…') : L('এই সময়ে কাউকে কোনো কাজ দেওয়া হয়নি।', 'No tasks given in this period.')}</p>}
      cols={[
        { key: 'name', label: L('নাম', 'Name'), value: r => r.manager_name },
        { key: 'as', label: L('দেওয়া হয়েছে', 'Assigned'), value: r => r.assigned },
        { key: 'done', label: L('শেষ', 'Done'), value: r => r.completed },
        { key: 'ot', label: L('সময়মতো', 'On time'), value: r => r.completed_on_time },
        { key: 'od', label: L('দেরি', 'Overdue'), value: r => r.overdue, render: r => r.overdue ? <Badge tone="bad">{n(r.overdue)}</Badge> : <span className="muted">—</span> },
        { key: 'wait', label: L('নিশ্চিত বাকি', 'To confirm'), value: r => r.awaiting_confirmation },
        { key: 'pct', label: L('সময়মতো %', 'On-time %'), value: r => r.on_time_pct ?? '',
          render: r => r.on_time_pct == null ? <span className="muted">—</span> : <Badge tone={r.on_time_pct >= 80 ? 'ok' : r.on_time_pct >= 50 ? 'warn' : 'bad'}>{n(r.on_time_pct)}%</Badge> },
      ]} />
  </section>
}

function WorkforcePlan({ zone, from, to, onToast }: { zone: string; from: string; to: string; onToast: (m: string) => void }) {
  const { can } = useAuth()
  const { L } = usePrefs()
  const o = useOrg()
  const [items, setItems] = useState<PlanItem[] | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const saved = useLoad(() => can('zonal.planning.view') ? zonal.recommendations(zone || null) : Promise.resolve([] as Recommendation[]), [zone])
  const [rev, setRev] = useState<{ r: Recommendation; status: 'acknowledged' | 'dismissed'; note: string } | null>(null)
  async function run(save: boolean) {
    if (!zone) return setErr(L('আগে জোন বেছে নিন', 'Choose a zone first'))
    setBusy(true); setErr('')
    try { const p = await zonal.plan(zone, from, to, save); setItems(p.items ?? []); if (save) { onToast(L('পরামর্শ সেভ হয়েছে', 'Saved')); await saved.reload() } }
    catch (x) { setErr(hrFriendly(x)) } finally { setBusy(false) }
  }
  async function review() {
    if (!rev) return
    try { await zonal.review(rev.r.id, rev.status, rev.note.trim()); setRev(null); onToast(L('সেভ হয়েছে', 'Saved')); await saved.reload() } catch (x) { setErr(hrFriendly(x)) }
  }
  const kind = (k: string) => { const [t, tone] = PLAN_KIND[k] ?? [k, 'neutral' as const]; return <Badge tone={tone}>{t}</Badge> }
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('জনবল পরিকল্পনা — কোন হাবে কতজন রাইডার দরকার', 'Workforce plan — riders each hub needs')}</h2>
      <span className="row-acts">
        {can('zonal.planning.view') && <button className="secondary" disabled={busy} onClick={() => void run(false)}>{L('হিসাব দেখুন', 'Calculate')}</button>}
        {can('zonal.planning.create') && <button disabled={busy} onClick={() => void run(true)}>{L('হিসাব করে সেভ', 'Calculate & save')}</button>}</span></div>
    <p className="muted small">{L('যাচাই করা দৈনিক হাব হিসাব থেকে তৈরি পরামর্শ। সিস্টেম নিজে কাউকে নিয়োগ, বদলি বা বেতন বদল করে না — সিদ্ধান্ত আপনার।',
      'Advice from verified daily hub figures. The system never hires, moves or changes pay — you decide.')}</p>
    {err && <p className="da-error">{err}</p>}
    {items && (!items.length ? <p className="muted">{L('এই সময়ের যথেষ্ট যাচাই করা তথ্য নেই।', 'Not enough verified data for this period.')}</p>
      : <ul className="duty-list">{items.map((it, i) => <li key={i} className="duty"><div style={{ flex: 1 }}><b>{it.hub_name}</b> {kind(it.kind)}<div className="small">{it.summary}</div>
          {'rider_gap' in it.evidence && <div className="muted small">{L('দরকার', 'Needed')}: {String(it.evidence.riders_needed ?? '—')} · {L('আছে (গড়)', 'On duty')}: {String(it.evidence.avg_riders_on_duty ?? '—')} · {L('জমা দিন', 'Backlog days')}: {String(it.evidence.backlog_days ?? '—')}</div>}</div></li>)}</ul>)}
    {can('zonal.planning.view') && <>
      <h3 className="zd-h">{L('সেভ করা পরামর্শ', 'Saved advice')}</h3>
      <DataTable<Recommendation> title={L('জনবল পরামর্শ', 'Workforce advice')} file="workforce-advice" rows={saved.data} rowKey={r => r.id}
        empty={<p className="muted">{L('এখনো কিছু সেভ হয়নি।', 'Nothing saved yet.')}</p>}
        cols={[
          { key: 'date', label: L('সময়', 'Period'), value: r => `${r.period_from} → ${r.period_to}` },
          { key: 'hub', label: L('হাব', 'Hub'), value: r => o.names.hub[r.hub_id] ?? '' },
          { key: 'kind', label: L('ধরন', 'Kind'), value: r => PLAN_KIND[r.kind]?.[0] ?? r.kind, render: r => kind(r.kind) },
          { key: 'sum', label: L('পরামর্শ', 'Advice'), value: r => r.summary },
          { key: 'st', label: L('অবস্থা', 'Status'), value: r => r.status, render: r => r.status === 'proposed'
            ? (can('zonal.planning.edit') ? <span className="row-acts"><button className="sm" onClick={() => setRev({ r, status: 'acknowledged', note: '' })}>{L('মেনে নিলাম', 'Accept')}</button>
                <button className="secondary sm" onClick={() => setRev({ r, status: 'dismissed', note: '' })}>{L('বাদ', 'Dismiss')}</button></span> : <Badge tone="info">{L('নতুন', 'New')}</Badge>)
            : <Badge tone={r.status === 'acknowledged' ? 'ok' : 'neutral'}>{r.status === 'acknowledged' ? L('মেনে নেওয়া', 'Accepted') : L('বাদ', 'Dismissed')}</Badge> },
        ]} />
    </>}
    {rev && <Modal title={rev.status === 'acknowledged' ? L('পরামর্শ মেনে নিন', 'Accept advice') : L('পরামর্শ বাদ দিন', 'Dismiss advice')} onClose={() => setRev(null)}
      actions={<><button className="secondary" onClick={() => setRev(null)}>{L('বাতিল', 'Cancel')}</button><button onClick={() => void review()}>{L('সেভ', 'Save')}</button></>}>
      <p>{rev.r.summary}</p>
      <Field label={L('নোট', 'Note')} wide><input value={rev.note} onChange={e => setRev({ ...rev, note: e.target.value })} placeholder={L('যেমন: আগামী সপ্তাহে ২ জন রাইডার নেওয়া হবে', 'e.g. two riders next week')} /></Field>
    </Modal>}
  </section>
}

const CLAIM_ST: Record<Claim['status'], [string, 'ok' | 'warn' | 'bad' | 'info']> = { submitted: ['অপেক্ষায়', 'warn'], approved: ['অনুমোদিত', 'ok'], rejected: ['বাতিল', 'bad'], returned: ['ফেরত', 'info'] }

function VisitsClaims({ zone, from, to, onToast }: { zone: string; from: string; to: string; onToast: (m: string) => void }) {
  const { can, session } = useAuth()
  const { L, n } = usePrefs()
  const o = useOrg()
  const visits = useLoad(() => zonal.visits(zone || null, from, to), [zone, from, to])
  const claims = useLoad(() => zonal.claims(zone || null), [zone])
  const [add, setAdd] = useState(false)
  const [claim, setClaim] = useState(false)
  const [dec, setDec] = useState<{ c: Claim; decision: 'approved' | 'rejected' | 'returned'; note: string; voucher: string } | null>(null)
  const [err, setErr] = useState('')
  const tk = (x: number) => `৳${n(Math.round(x || 0))}`
  async function decide() {
    if (!dec) return
    setErr('')
    try { await zonal.decideClaim(dec.c.id, dec.decision, dec.note.trim() || null, dec.voucher.trim() || null); setDec(null); onToast(L('সিদ্ধান্ত সেভ হয়েছে', 'Decision saved')); await claims.reload() }
    catch (x) { setErr(hrFriendly(x)) }
  }
  return <>
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('হাব ভিজিট', 'Hub visits')} <span className="count-pill">{n(visits.data?.length ?? 0)}</span></h2>
        <span className="row-acts">
          {can('zonal.visit.create') && <button onClick={() => setAdd(true)}><Icon name="plus" size={15} />{L('ভিজিট লিখুন', 'Log a visit')}</button>}
          {can('zonal.claim.create') && <button className="secondary" onClick={() => setClaim(true)}>{L('ক্লেইম জমা দিন', 'Submit claim')}</button>}</span></div>
      {visits.error ? <p className="da-error">{hrFriendly(visits.error)}</p> : null}
      <DataTable<Visit> title={L('হাব ভিজিট', 'Hub visits')} file="hub-visits" rows={visits.data} rowKey={r => r.id}
        empty={<p className="muted">{L('এই সময়ে কোনো ভিজিট লেখা হয়নি।', 'No visits in this period.')}</p>}
        cols={[
          { key: 'date', label: L('তারিখ', 'Date'), value: r => r.visit_date },
          { key: 'hub', label: L('হাব', 'Hub'), value: r => o.names.hub[r.hub_id] ?? '' },
          { key: 'purpose', label: L('উদ্দেশ্য', 'Purpose'), value: r => r.purpose },
          { key: 'find', label: L('যা পেলেন', 'Findings'), value: r => r.findings ?? '' },
          { key: 'km', label: L('কিমি', 'km'), value: r => r.distance_km },
          { key: 'cost', label: L('খরচ', 'Cost'), value: r => r.total_amount, render: r => tk(r.total_amount) },
          { key: 'claim', label: L('ক্লেইম', 'Claim'), value: r => r.claim_id ? 'yes' : '', render: r => r.claim_id ? <Badge tone="ok">{L('জমা হয়েছে', 'Claimed')}</Badge> : <Badge tone="neutral">{L('বাকি', 'Not yet')}</Badge> },
        ]} />
    </section>
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('যাতায়াত ক্লেইম', 'Travel claims')}</h2></div>
      {err && !dec && <p className="da-error">{err}</p>}
      <DataTable<Claim> title={L('যাতায়াত ক্লেইম', 'Travel claims')} file="travel-claims" rows={claims.data} rowKey={r => r.id}
        empty={<p className="muted">{L('কোনো ক্লেইম নেই।', 'No claims.')}</p>}
        cols={[
          { key: 'no', label: L('নম্বর', 'No.'), value: r => r.claim_no },
          { key: 'per', label: L('সময়', 'Period'), value: r => `${r.period_from} → ${r.period_to}` },
          { key: 'v', label: L('ভিজিট', 'Visits'), value: r => r.visit_count },
          { key: 'km', label: L('কিমি', 'km'), value: r => r.total_km },
          { key: 'amt', label: L('টাকা', 'Amount'), value: r => r.total_amount, render: r => <b>{tk(r.total_amount)}</b> },
          { key: 'st', label: L('অবস্থা', 'Status'), value: r => CLAIM_ST[r.status][0], render: r => <>
            <Badge tone={CLAIM_ST[r.status][1]}>{CLAIM_ST[r.status][0]}</Badge>{r.voucher_no && <span className="muted small"> #{r.voucher_no}</span>}
            {r.status === 'submitted' && r.claimant_id !== session?.user.id && (can('zonal.claim.approve') || can('zonal.claim.reject')) && <span className="row-acts" style={{ marginLeft: 6 }}>
              {can('zonal.claim.approve') && <button className="sm" onClick={() => { setErr(''); setDec({ c: r, decision: 'approved', note: '', voucher: '' }) }}>{L('অনুমোদন', 'Approve')}</button>}
              {can('zonal.claim.reject') && <button className="secondary sm" onClick={() => { setErr(''); setDec({ c: r, decision: 'returned', note: '', voucher: '' }) }}>{L('ফেরত / বাতিল', 'Return / reject')}</button>}</span>}</> },
        ]} />
    </section>
    {add && <AddVisit zone={zone} onClose={() => setAdd(false)} onDone={async () => { setAdd(false); onToast(L('ভিজিট সেভ হয়েছে', 'Visit saved')); await visits.reload() }} />}
    {claim && <SubmitClaim zone={zone} onClose={() => setClaim(false)} onDone={async () => { setClaim(false); onToast(L('ক্লেইম জমা হয়েছে', 'Claim submitted')); await claims.reload(); await visits.reload() }} />}
    {dec && <Modal title={L(`ক্লেইম ${dec.c.claim_no}`, `Claim ${dec.c.claim_no}`)} onClose={() => setDec(null)}
      actions={<><button className="secondary" onClick={() => setDec(null)}>{L('বাতিল', 'Cancel')}</button><button onClick={() => void decide()}>{L('সেভ', 'Save')}</button></>}>
      <p>{L('টাকা', 'Amount')}: <b>{tk(dec.c.total_amount)}</b> · {n(dec.c.visit_count)} {L('ভিজিট', 'visits')}</p>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('সিদ্ধান্ত', 'Decision')}><select value={dec.decision} onChange={e => setDec({ ...dec, decision: e.target.value as typeof dec.decision })}>
          {can('zonal.claim.approve') && <option value="approved">{L('অনুমোদন', 'Approve')}</option>}
          {can('zonal.claim.reject') && <><option value="returned">{L('ঠিক করতে ফেরত', 'Return to fix')}</option><option value="rejected">{L('বাতিল', 'Reject')}</option></>}</select></Field>
        {dec.decision === 'approved' && <Field label={L('ভাউচার নম্বর', 'Voucher no.')}><input value={dec.voucher} onChange={e => setDec({ ...dec, voucher: e.target.value })} /></Field>}
        <Field wide label={dec.decision === 'approved' ? L('নোট (ঐচ্ছিক)', 'Note (optional)') : L('কারণ', 'Reason')}><input value={dec.note} onChange={e => setDec({ ...dec, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

function AddVisit({ zone, onClose, onDone }: { zone: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { L } = usePrefs()
  const o = useOrg()
  const hubs = (o.data?.hubs ?? []).filter(h => !zone || h.zone_id === zone)
  const [f, setF] = useState({ hub: '', date: dhaka(), purpose: '', findings: '', km: '', fuel: '', meal: '', transport: '', other: '', other_note: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const num = (s: string) => Number(s.replace(/[^\d.]/g, '')) || 0
  const total = num(f.fuel) + num(f.meal) + num(f.transport) + num(f.other)
  async function save() {
    const h = hubs.find(x => x.id === f.hub)
    if (!h) return setErr(L('হাব বেছে নিন', 'Choose the hub'))
    if (f.purpose.trim().length < 3) return setErr(L('কেন গিয়েছিলেন লিখুন', 'Write the purpose'))
    if (num(f.other) > 0 && !f.other_note.trim()) return setErr(L('অন্যান্য খরচ কিসের লিখুন', 'Explain the other cost'))
    setBusy(true); setErr('')
    try {
      await zonal.addVisit({ hub_id: h.id, zone_id: h.zone_id, visit_date: f.date, purpose: f.purpose.trim(), findings: f.findings.trim() || null,
        distance_km: num(f.km), fuel_amount: num(f.fuel), meal_amount: num(f.meal), transport_amount: num(f.transport), other_amount: num(f.other), other_note: f.other_note.trim() || null })
      await onDone()
    } catch (x) { setErr(hrFriendly(x)) } finally { setBusy(false) }
  }
  const inp = (k: keyof typeof f, label: string, extra?: ReactNode) => <Field label={label} hint={extra}><input inputMode="decimal" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>
  return <Modal title={L('হাব ভিজিট লিখুন', 'Log a hub visit')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('হাব', 'Hub')}><select value={f.hub} onChange={e => setF({ ...f, hub: e.target.value })}><option value="">{L('বেছে নিন…', 'Choose…')}</option>
        {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label={L('তারিখ', 'Date')}><input type="date" max={dhaka()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
      <Field wide label={L('উদ্দেশ্য', 'Purpose')}><input value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} placeholder={L('যেমন: ক্যাশ মিলানো, হাজিরা চেক', 'e.g. cash check, attendance check')} /></Field>
      <Field wide label={L('যা পেলেন / সিদ্ধান্ত', 'Findings')}><textarea rows={3} value={f.findings} onChange={e => setF({ ...f, findings: e.target.value })} /></Field>
      {inp('km', L('দূরত্ব (কিমি)', 'Distance (km)'))}
      {inp('fuel', L('তেল (৳)', 'Fuel (৳)'))}
      {inp('meal', L('খাবার (৳)', 'Meal (৳)'))}
      {inp('transport', L('গাড়ি ভাড়া (৳)', 'Transport (৳)'))}
      {inp('other', L('অন্যান্য (৳)', 'Other (৳)'))}
      {num(f.other) > 0 && <Field label={L('অন্যান্য কিসের', 'Other for')}><input value={f.other_note} onChange={e => setF({ ...f, other_note: e.target.value })} /></Field>}
    </div>
    <p><b>{L('মোট খরচ', 'Total')}: ৳{total.toLocaleString('en-IN')}</b></p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function SubmitClaim({ zone, onClose, onDone }: { zone: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { L } = usePrefs()
  const o = useOrg()
  const [type, setType] = useState<'monthly' | 'weekly'>('monthly')
  const lastMonth = shift(monthStart(dhaka()), -1)
  const [month, setMonth] = useState(lastMonth.slice(0, 7))
  const [weekFrom, setWeekFrom] = useState(shift(dhaka(), -7))
  const [z, setZ] = useState(zone || (o.data?.zones[0]?.id ?? ''))
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const from = type === 'monthly' ? `${month}-01` : weekFrom
  const to = type === 'monthly' ? monthEnd(`${month}-01`) : shift(weekFrom, 6)
  async function go() {
    if (!z) return setErr(L('জোন বেছে নিন', 'Choose the zone'))
    setBusy(true); setErr('')
    try { await zonal.submitClaim(z, type, from, to); await onDone() } catch (x) { setErr(hrFriendly(x)) } finally { setBusy(false) }
  }
  return <Modal title={L('যাতায়াত ক্লেইম জমা', 'Submit travel claim')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{L('জমা দিন', 'Submit')}</button></>}>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {!zone && <Field label={L('জোন', 'Zone')}><select value={z} onChange={e => setZ(e.target.value)}>{o.data?.zones.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      <Field label={L('ধরন', 'Type')}><select value={type} onChange={e => setType(e.target.value as 'monthly' | 'weekly')}>
        <option value="monthly">{L('মাসিক', 'Monthly')}</option><option value="weekly">{L('সাপ্তাহিক (৭ দিন)', 'Weekly (7 days)')}</option></select></Field>
      {type === 'monthly' ? <Field label={L('মাস', 'Month')}><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></Field>
        : <Field label={L('শুরুর দিন', 'Start day')}><input type="date" value={weekFrom} onChange={e => setWeekFrom(e.target.value)} /></Field>}
    </div>
    <p className="muted small">{L(`${from} থেকে ${to} পর্যন্ত আপনার ক্লেইম না করা সব ভিজিট এক ক্লেইমে যাবে।`, `All your unclaimed visits from ${from} to ${to} go into one claim.`)}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
