import { askReason, askText } from '../../components/ask'
import { useEffect, useMemo, useState } from 'react'
import { inMenu } from '../../lib/menu'
import { HubLogins } from './HubLogins'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell, refreshShellCounts } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { RouteViz } from '../../components/RouteViz'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { autoCode, hrFriendly, type Employee, type Hub } from '../../lib/hr'
import { da, STATUS_LABEL, taka, type SessionRow } from '../../lib/dailyAccounts'
import { routesApi, type HubRoute } from '../../lib/hub'
import { hubApi, hubToday, PICKUP_STATUS, PRIORITY, TASK_STATUS, type HubMetric, type HubTask, type Pickup } from '../../lib/hub'
import { useOrg } from '../hr/common'

// Team moved to /app/staff/list; attendance, late and the attendance-days page moved into /app/attendance (role-aware).
export type HubSection = 'pickup' | 'tasks' | 'ops' | 'accounts' | 'logins' | 'routes'

/** Menu entries for the Hub Management group (also used by the tab strip on the page). */
export const HUB_SECTIONS: Array<{ key: HubSection; icon: string; bn: string; en: string; perms: string[] }> = [
  { key: 'pickup', icon: 'box', bn: 'আজকের পিকআপ খাতা', en: "Today's pickups", perms: ['ops.pickup.view', 'ops.pickup_as_hub_manager.create', 'ops.pickup_as_pickup_manager.create', 'ops.pickup_as_rider.create'] },
  { key: 'tasks', icon: 'tasks', bn: 'আজকের কাজ', en: "Today's tasks", perms: ['zonal.task.view', 'zonal.task.create'] },
  { key: 'ops', icon: 'truck', bn: 'আজকের হাব অপারেশন', en: "Today's hub operation", perms: ['zonal.hub_metric.view', 'zonal.hub_metric.create'] },
  { key: 'accounts', icon: 'ledger', bn: 'আজকের হিসাব', en: "Today's accounts", perms: ['da.sheet.view', 'da.sheet.create'] },
  { key: 'logins', icon: 'key', bn: 'লগইন সেটআপ', en: 'Logins', perms: ['system.user_hub.create'] },
  { key: 'routes', icon: 'map', bn: 'রাইডার রুট', en: 'Rider routes', perms: ['ops.route.view', 'ops.route.edit'] },
]

const HUB_KEY = 'xzm_hub'
export function storedHub(): string { try { return sessionStorage.getItem(HUB_KEY) || '' } catch { return '' } }
function storeHub(id: string) { try { sessionStorage.setItem(HUB_KEY, id) } catch { /* ignore */ } }

export function HubManagement() {
  const { section } = useParams()
  const { can, menu } = useAuth()
  const { L } = usePrefs()
  const o = useOrg()
  const [hub, setHubS] = useState(storedHub())
  const hubs = useMemo(() => (o.data?.hubs ?? []).filter(h => !h.archived_at), [o.data])
  useEffect(() => {
    if (!hubs.length) return
    if (!hub || !hubs.some(h => h.id === hub)) { setHubS(hubs[0].id); storeHub(hubs[0].id) }
  }, [hubs, hub])
  const setHub = (id: string) => { setHubS(id); storeHub(id); refreshShellCounts() }
  // Old sections moved to new master pages
  if (section === 'team') return <Navigate to="/app/staff/list" replace />
  if (section === 'attendance' || section === 'late' || section === 'days') return <Navigate to="/app/attendance?view=hub" replace />
  const sec = HUB_SECTIONS.find(s => s.key === section)
  if (!sec) return <Navigate to="/app/attendance?view=hub" replace />
  const allowed = sec.perms.some(p => can(p))
  const current = hubs.find(h => h.id === hub) ?? null
  // "আজকের হিসাব" is off the strip (see HIDDEN_PAGES in AppShell); it still opens by address.
  const offStrip = (k: HubSection) => k === 'accounts' && section !== k
  const tabs = HUB_SECTIONS.filter(s => s.perms.some(p => can(p)) && inMenu(menu, `/app/hub/${s.key}`) && !offStrip(s.key))

  return <AppShell title={L(sec.bn, sec.en)} subtitle={current ? `${current.name} · ${L('আজ', 'Today')} ${hubToday()}` : undefined}>
    <section className="da-filters panel no-print hub-top">
      <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => setHub(e.target.value)}>
        {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <nav className="hub-tabs" aria-label={L('হাব ম্যানেজমেন্ট', 'Hub management')}>
        {tabs.map(t => <Link key={t.key} to={`/app/hub/${t.key}`} className={t.key === sec.key ? 'on' : ''}><Icon name={t.icon} size={15} /><span>{L(t.bn, t.en)}</span></Link>)}
      </nav>
    </section>
    {o.error ? <p className="da-error">{hrFriendly(o.error)}</p> : null}
    {!allowed ? <p className="notice">{L('এই পাতা দেখার অনুমতি আপনার রোলে নেই।', 'Your role may not open this page.')}</p>
      : o.data && !hubs.length ? <p className="notice">{L('আপনার দেখার মতো কোনো হাব নেই।', 'There is no hub you can see.')}</p>
      : current ? <Body section={sec.key} hub={current} /> : <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
  </AppShell>
}

function Body({ section, hub }: { section: HubSection; hub: Hub }) {
  switch (section) {
    case 'pickup': return <PickupToday hub={hub} />
    case 'tasks': return <TasksToday hub={hub} />
    case 'ops': return <OpsToday hub={hub} />
    case 'accounts': return <AccountsToday hub={hub} />
    case 'logins': return <HubLogins hub={hub} />
    case 'routes': return <RiderRoutes hub={hub} />
  }
}

// ---------------------------------------------------------------- pickups
const SOURCES: Array<[string, string, string]> = [['hub_manager', 'হাব ম্যানেজার', 'Hub manager'], ['pickup_manager', 'পিকআপ ম্যানেজার', 'Pickup manager'], ['rider', 'রাইডার', 'Rider']]

function PickupToday({ hub }: { hub: Hub }) {
  const { can, session } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const date = hubToday()
  const list = useLoad(() => hubApi.pickups(hub.id, date), [hub.id, date])
  const merchants = useLoad(() => hubApi.merchants(hub.id), [hub.id])
  const mName = useMemo(() => Object.fromEntries((merchants.data ?? []).map(m => [m.id, m.name])) as Record<string, string>, [merchants.data])
  const sources = SOURCES.filter(s => can(`ops.pickup_as_${s[0]}.create`))
  const [f, setF] = useState<{ source: string; merchant: string; parcels: string; cod: string; collection: string; trip: string; note: string } | null>(null)
  const [mf, setMf] = useState<{ code: string; name: string; phone: string } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const rows = list.data ?? []
  const sum = (k: 'parcel_count' | 'cod_amount' | 'collection_amount') => rows.filter(r => r.status !== 'rejected').reduce((a, r) => a + Number(r[k] || 0), 0)
  async function save() {
    if (!f) return
    const parcels = Number(f.parcels)
    if (!f.merchant) return setErr(L('মার্চেন্ট বেছে নিন', 'Choose a merchant'))
    if (!(parcels > 0)) return setErr(L('পার্সেল সংখ্যা দিন', 'Give the parcel count'))
    setBusy(true); setErr('')
    try {
      await hubApi.submitPickup({ source: f.source, date, hub: hub.id, merchant: f.merchant, parcels, cod: Number(f.cod) || 0,
        collection: Number(f.collection) || 0, trip: Number(f.trip) || 1, note: f.note.trim() || null })
      setF(null); await list.reload(); toast(L('পিকআপ যোগ হয়েছে', 'Pickup added'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function saveMerchant() {
    if (!mf) return
    if (!mf.name.trim()) return setErr(L('নাম দিন', 'Give a name'))
    setBusy(true); setErr('')
    try { await hubApi.addMerchant({ code: autoCode(mf.name), name: mf.name.trim(), phone: mf.phone.trim() || null, hub: hub.id, zone: hub.zone_id }); setMf(null); await merchants.reload(); toast(L('মার্চেন্ট যোগ হয়েছে', 'Merchant added')) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function act(r: Pickup, kind: 'verify' | 'approve' | 'reject' | 'withdraw') {
    let reason = ''
    if (kind === 'reject' || kind === 'withdraw') {
      reason = (await askReason(kind === 'reject' ? L('কেন বাতিল করছেন?', 'Why reject it?') : L('কেন তুলে নিচ্ছেন?', 'Why withdraw it?'))) ?? ''
      if (!reason.trim()) return
    }
    setErr('')
    try {
      if (kind === 'verify') await hubApi.verifyPickup(r.id)
      else if (kind === 'approve') await hubApi.approvePickup(r.id, null)
      else if (kind === 'reject') await hubApi.rejectPickup(r.id, reason.trim())
      else await hubApi.withdrawPickup(r.id, reason.trim())
      await list.reload()
    } catch (e) { setErr(hrFriendly(e)) }
  }
  return <>
    {node}
    <div className="da-stats">
      <Stat icon="box" label={L('আজকের পিকআপ', 'Pickups today')} value={n(rows.length)} />
      <Stat icon="box" label={L('মোট পার্সেল', 'Parcels')} value={n(sum('parcel_count'))} />
      <Stat icon="cash" label={L('মোট COD', 'COD')} value={taka(sum('cod_amount'))} />
      <Stat icon="alert" tone={rows.some(r => r.status === 'pending') ? 'warn' : undefined} label={L('অপেক্ষায়', 'Pending')} value={n(rows.filter(r => r.status === 'pending').length)} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('আজকের পিকআপ খাতা', "Today's pickups")}</h2><span className="row-acts">
        {can('ops.merchant.create') && <button className="secondary sm" onClick={() => { setErr(''); setMf({ code: '', name: '', phone: '' }) }}><Icon name="plus" size={14} />{L('মার্চেন্ট', 'Merchant')}</button>}
        {sources.length > 0 && <button onClick={() => { setErr(''); setF({ source: sources[0][0], merchant: '', parcels: '', cod: '', collection: '', trip: '1', note: '' }) }}><Icon name="plus" size={15} />{L('পিকআপ যোগ', 'Add pickup')}</button>}</span></div>
      {err && !f && !mf && <p className="da-error">{err}</p>}
      {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : <DataTable<Pickup> title={L('আজকের পিকআপ খাতা', "Today's pickups")} file={`pickups-${date}`} rows={list.data} rowKey={r => r.id}
        empty={<p className="muted">{L('আজ এখনো কোনো পিকআপ লেখা হয়নি।', 'No pickups written today yet.')}</p>}
        cols={[
          { key: 'no', label: L('নম্বর', 'No.'), value: r => r.submission_no ?? '' },
          { key: 'merchant', label: L('মার্চেন্ট', 'Merchant'), value: r => mName[r.merchant_id] ?? '' },
          { key: 'trip', label: L('ট্রিপ', 'Trip'), value: r => n(r.trip_no) },
          { key: 'parcels', label: L('পার্সেল', 'Parcels'), className: 'r', value: r => n(r.parcel_count) },
          { key: 'cod', label: 'COD', className: 'r', value: r => taka(r.cod_amount) },
          { key: 'status', label: L('অবস্থা', 'Status'), value: r => L(PICKUP_STATUS[r.status][0], PICKUP_STATUS[r.status][1]),
            render: r => <Badge tone={PICKUP_STATUS[r.status][2]}>{L(PICKUP_STATUS[r.status][0], PICKUP_STATUS[r.status][1])}</Badge> },
          { key: 'act', label: '', noExport: true, render: r => <span className="row-acts">
            {r.status === 'pending' && can('ops.pickup_verification.create') && <button className="secondary sm" onClick={() => void act(r, 'verify')}>{L('যাচাই', 'Verify')}</button>}
            {(r.status === 'pending' || r.status === 'verified') && can('ops.pickup.approve') && <button className="secondary sm" onClick={() => void act(r, 'approve')}><Icon name="check" size={14} />{L('অনুমোদন', 'Approve')}</button>}
            {(r.status === 'pending' || r.status === 'verified') && can('ops.pickup.reject') && <button className="secondary sm" onClick={() => void act(r, 'reject')}>{L('বাতিল', 'Reject')}</button>}
            {r.status === 'pending' && r.submitted_by === session?.user.id && <button className="secondary sm" onClick={() => void act(r, 'withdraw')}><Icon name="trash" size={14} />{L('তুলে নিন', 'Withdraw')}</button>}
          </span> },
        ]} />}
    </section>
    {f && <Modal title={L('নতুন পিকআপ', 'New pickup')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {sources.length > 1 && <Field label={L('কে লিখছেন', 'Written as')}><select value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>
          {sources.map(s => <option key={s[0]} value={s[0]}>{L(s[1], s[2])}</option>)}</select></Field>}
        <Field label={L('মার্চেন্ট', 'Merchant')}><select value={f.merchant} onChange={e => setF({ ...f, merchant: e.target.value })}>
          <option value="">{L('বেছে নিন…', 'Choose…')}</option>
          {merchants.data?.filter(m => m.status === 'active').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label={L('পার্সেল সংখ্যা', 'Parcels')}><input inputMode="numeric" value={f.parcels} onChange={e => setF({ ...f, parcels: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label={L('ট্রিপ নম্বর', 'Trip no.')}><input inputMode="numeric" value={f.trip} onChange={e => setF({ ...f, trip: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="COD (৳)"><input inputMode="decimal" value={f.cod} onChange={e => setF({ ...f, cod: e.target.value })} /></Field>
        <Field label={L('আদায় (৳)', 'Collected (৳)')}><input inputMode="decimal" value={f.collection} onChange={e => setF({ ...f, collection: e.target.value })} /></Field>
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {merchants.data && !merchants.data.length && <p className="notice">{L('এই হাবে কোনো মার্চেন্ট নেই। আগে “+ মার্চেন্ট” দিয়ে যোগ করুন।', 'This hub has no merchants yet. Add one with “+ Merchant” first.')}</p>}
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {mf && <Modal title={L('নতুন মার্চেন্ট', 'New merchant')} onClose={() => setMf(null)}
      actions={<><button className="secondary" onClick={() => setMf(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void saveMerchant()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('নাম', 'Name')}><input value={mf.name} onChange={e => setMf({ ...mf, name: e.target.value })} /></Field>
        <Field label={L('মোবাইল', 'Mobile')}><input inputMode="tel" value={mf.phone} onChange={e => setMf({ ...mf, phone: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- tasks
function TasksToday({ hub }: { hub: Hub }) {
  const { can, session } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const date = hubToday()
  const list = useLoad(() => hubApi.tasks(hub.id), [hub.id])
  const people = useLoad(() => hubApi.people(), [])
  const pName = useMemo(() => Object.fromEntries((people.data ?? []).map(p => [p.id, p.full_name || p.email || ''])) as Record<string, string>, [people.data])
  const [show, setShow] = useState<'today' | 'open' | 'all'>('today')
  const [f, setF] = useState<{ id?: string; title: string; assignee: string; due: string; priority: string; description: string } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const all = list.data ?? []
  const open = (t: HubTask) => t.status !== 'completed' && t.status !== 'cancelled'
  const rows = show === 'all' ? all : show === 'open' ? all.filter(open) : all.filter(t => (open(t) && t.due_date <= date) || t.due_date === date)
  const overdue = all.filter(t => open(t) && t.due_date < date).length
  async function save() {
    if (!f) return
    if (f.title.trim().length < 3) return setErr(L('কাজের নাম লিখুন (অন্তত ৩ অক্ষর)', 'Write the task (3+ letters)'))
    if (!f.assignee) return setErr(L('কাকে দেবেন বেছে নিন', 'Choose who does it'))
    setBusy(true); setErr('')
    try {
      if (f.id) await hubApi.taskReassign(f.id, f.assignee, f.due, L('হাব ম্যানেজমেন্ট থেকে বদল', 'Changed from Hub management'))
      else await hubApi.assignTask({ title: f.title.trim(), assignee: f.assignee, due: f.due, hub: hub.id, description: f.description.trim() || null, priority: f.priority })
      setF(null); await list.reload(); toast(L('কাজ সেভ হয়েছে', 'Task saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function act(t: HubTask, kind: 'start' | 'done' | 'cancel') {
    const note = kind === 'cancel' ? await askReason(L('কেন বাতিল করছেন?', 'Why cancel it?'), { ok: L('বাতিল করুন', 'Cancel it'), cancel: L('ফিরে যান', 'Back') })
      : kind === 'done' ? await askText(L('কী করা হলো?', 'What was done?'), { optional: true, ok: L('সম্পন্ন', 'Done') }) : ''
    if (note === null) return
    if (kind === 'cancel' && !note.trim()) return
    setErr('')
    try {
      if (kind === 'start') await hubApi.taskProgress(t.id, 'in_progress', L('কাজ শুরু', 'Started'))
      else if (kind === 'done') await hubApi.taskComplete(t.id, note.trim() || L('শেষ', 'Done'))
      else await hubApi.taskCancel(t.id, note.trim())
      await list.reload()
    } catch (e) { setErr(hrFriendly(e)) }
  }
  const me = session?.user.id
  return <>
    {node}
    <div className="da-stats">
      <Stat icon="tasks" label={L('আজকের কাজ', 'Due today')} value={n(all.filter(t => open(t) && t.due_date === date).length)} />
      <Stat icon="alert" tone={overdue ? 'bad' : undefined} label={L('সময় পেরিয়েছে', 'Overdue')} value={n(overdue)} />
      <Stat icon="clock" label={L('চলছে', 'In progress')} value={n(all.filter(t => t.status === 'in_progress').length)} />
      <Stat icon="check" tone="ok" label={L('আজ শেষ', 'Done today')} value={n(all.filter(t => t.status === 'completed' && t.due_date === date).length)} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('আজকের কাজ', "Today's tasks")}</h2><span className="row-acts">
        <span className="da-seg">{(['today', 'open', 'all'] as const).map(k => <button key={k} className={show === k ? 'sm' : 'secondary sm'} onClick={() => setShow(k)}>
          {k === 'today' ? L('আজ', 'Today') : k === 'open' ? L('খোলা সব', 'All open') : L('সব', 'All')}</button>)}</span>
        {can('zonal.task.create') && <button onClick={() => { setErr(''); setF({ title: '', assignee: '', due: date, priority: 'normal', description: '' }) }}><Icon name="plus" size={15} />{L('নতুন কাজ', 'New task')}</button>}</span></div>
      {err && !f && <p className="da-error">{err}</p>}
      {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : <DataTable<HubTask> title={L('আজকের কাজ', "Today's tasks")} file={`tasks-${date}`} rows={list.data ? rows : null} rowKey={r => r.id}
        empty={<p className="muted">{L('এখানে কোনো কাজ নেই।', 'No tasks here.')}</p>}
        cols={[
          { key: 'title', label: L('কাজ', 'Task'), value: r => r.title, render: r => <><strong>{r.title}</strong>{r.description && <span className="sec">{r.description}</span>}</> },
          { key: 'who', label: L('কে করবেন', 'Assigned to'), value: r => pName[r.assigned_to] ?? '' },
          { key: 'due', label: L('শেষ তারিখ', 'Due'), value: r => r.due_date, render: r => <span className={open(r) && r.due_date < date ? 'bad' : ''}>{n(r.due_date)}</span> },
          { key: 'pri', label: L('গুরুত্ব', 'Priority'), value: r => L(PRIORITY[r.priority][0], PRIORITY[r.priority][1]) },
          { key: 'status', label: L('অবস্থা', 'Status'), value: r => L(TASK_STATUS[r.status][0], TASK_STATUS[r.status][1]),
            render: r => <Badge tone={TASK_STATUS[r.status][2]}>{L(TASK_STATUS[r.status][0], TASK_STATUS[r.status][1])}</Badge> },
          { key: 'act', label: '', noExport: true, render: r => open(r) ? <span className="row-acts">
            {r.status === 'assigned' && r.assigned_to === me && <button className="secondary sm" onClick={() => void act(r, 'start')}><Icon name="play" size={14} />{L('শুরু', 'Start')}</button>}
            {(r.assigned_to === me || can('zonal.task.edit')) && <button className="secondary sm" onClick={() => void act(r, 'done')}><Icon name="check" size={14} />{L('শেষ', 'Done')}</button>}
            {can('zonal.task.edit') && <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, title: r.title, assignee: r.assigned_to, due: r.due_date < date ? date : r.due_date, priority: r.priority, description: r.description ?? '' }) }}><Icon name="edit" size={14} />{L('এডিট', 'Edit')}</button>}
            {can('zonal.task.edit') && <button className="secondary sm" onClick={() => void act(r, 'cancel')}><Icon name="trash" size={14} />{L('বাতিল', 'Cancel')}</button>}
          </span> : null },
        ]} />}
    </section>
    {f && <Modal title={f.id ? L('কাজ এডিট (কে করবেন / তারিখ)', 'Edit task (who / when)') : L('নতুন কাজ', 'New task')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('কাজ', 'Task')} wide><input value={f.title} disabled={!!f.id} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={L('কে করবেন', 'Assigned to')}><select value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })}>
          <option value="">{L('বেছে নিন…', 'Choose…')}</option>
          {people.data?.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></Field>
        <Field label={L('শেষ তারিখ', 'Due')}><input type="date" min={date} value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
        {!f.id && <Field label={L('গুরুত্ব', 'Priority')}><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>
          {(Object.keys(PRIORITY) as HubTask['priority'][]).map(k => <option key={k} value={k}>{L(PRIORITY[k][0], PRIORITY[k][1])}</option>)}</select></Field>}
        {!f.id && <Field label={L('বিস্তারিত', 'Details')} wide><input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>}
      </div>
      <p className="muted small">{L('কাজ দেওয়া যায় শুধু যাঁদের লগইন আছে তাঁদের।', 'Tasks go to people who have a login.')}</p>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- hub operation
type MetricForm = Record<'pickup_count' | 'delivery_count' | 'pending_parcels' | 'merchant_count' | 'rider_count' | 'cash_collected' | 'expenses', string> & { note: string }
const METRIC_FIELDS: Array<[keyof Omit<MetricForm, 'note'>, string, string, string]> = [
  ['pickup_count', 'পিকআপ', 'Pickups', 'box'], ['delivery_count', 'ডেলিভারি', 'Deliveries', 'truck'], ['pending_parcels', 'বাকি পার্সেল', 'Pending parcels', 'alert'],
  ['merchant_count', 'মার্চেন্ট', 'Merchants', 'receipt'], ['rider_count', 'রাইডার', 'Riders', 'users'], ['cash_collected', 'আদায় (৳)', 'Cash collected (৳)', 'cash'], ['expenses', 'খরচ (৳)', 'Expenses (৳)', 'wallet'],
]

function OpsToday({ hub }: { hub: Hub }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const date = hubToday()
  const m = useLoad(() => hubApi.metric(hub.id, date), [hub.id, date])
  const [f, setF] = useState<MetricForm | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const canWrite = can('zonal.hub_metric.create')
  const open = (x: HubMetric | null) => setF({ pickup_count: String(x?.pickup_count ?? ''), delivery_count: String(x?.delivery_count ?? ''), pending_parcels: String(x?.pending_parcels ?? ''),
    merchant_count: String(x?.merchant_count ?? ''), rider_count: String(x?.rider_count ?? ''), cash_collected: String(x?.cash_collected ?? ''), expenses: String(x?.expenses ?? ''), note: x?.note ?? '' })
  async function save() {
    if (!f) return
    setBusy(true); setErr('')
    const num = (s: string) => Math.max(0, Number(s) || 0)
    try {
      await hubApi.saveMetric({ hub_id: hub.id, zone_id: hub.zone_id, metric_date: date, pickup_count: num(f.pickup_count), delivery_count: num(f.delivery_count),
        pending_parcels: num(f.pending_parcels), merchant_count: num(f.merchant_count), rider_count: num(f.rider_count), cash_collected: num(f.cash_collected),
        expenses: num(f.expenses), note: f.note.trim() || null }, m.data?.id)
      setF(null); await m.reload(); toast(L('আজকের অপারেশন সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function verify(reopen: boolean) {
    if (!m.data) return
    setErr('')
    try {
      if (reopen) { const r = (await askReason(L('কেন আবার খুলছেন?', 'Why reopen?'))) ?? ''; if (!r.trim()) return; await hubApi.reopenMetric(m.data.id, r.trim()) }
      else await hubApi.verifyMetric(m.data.id)
      await m.reload()
    } catch (e) { setErr(hrFriendly(e)) }
  }
  const d = m.data
  return <>
    {node}
    {err && !f && <p className="da-error">{err}</p>}
    {m.error ? <p className="da-error">{hrFriendly(m.error)}</p> : <>
      <div className="da-stats">{METRIC_FIELDS.map(([k, bn, en, ic]) => <Stat key={k} icon={ic} label={L(bn, en)}
        value={d ? (k === 'cash_collected' || k === 'expenses' ? taka(d[k]) : n(d[k])) : '—'} />)}</div>
      <section className="panel">
        <div className="da-bar"><h2>{L('আজকের হাব অপারেশন', "Today's hub operation")}
          {d && <Badge tone={d.status === 'verified' ? 'ok' : 'warn'}>{d.status === 'verified' ? L('যাচাই হয়েছে', 'Verified') : L('যাচাইয়ের অপেক্ষায়', 'Waiting for check')}</Badge>}</h2>
          <span className="row-acts">
            {canWrite && (!d || d.status === 'submitted') && <button onClick={() => { setErr(''); open(d) }}><Icon name={d ? 'edit' : 'plus'} size={15} />{d ? L('এডিট', 'Edit') : L('আজকের হিসাব লিখুন', "Write today's numbers")}</button>}
            {d && d.status === 'submitted' && can('zonal.hub_metric.approve') && <button className="secondary" onClick={() => void verify(false)}><Icon name="check" size={15} />{L('যাচাই', 'Verify')}</button>}
            {d && d.status === 'verified' && can('zonal.hub_metric.approve') && <button className="secondary" onClick={() => void verify(true)}>{L('আবার খুলুন', 'Reopen')}</button>}
          </span></div>
        {d ? <p className="muted">{d.note || L('কোনো নোট নেই।', 'No note.')}</p> : <p className="muted">{L('আজকের অপারেশনের সংখ্যা এখনো লেখা হয়নি।', "Today's numbers are not written yet.")}</p>}
      </section></>}
    {f && <Modal title={L('আজকের হাব অপারেশন', "Today's hub operation")} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {METRIC_FIELDS.map(([k, bn, en]) => <Field key={k} label={L(bn, en)}><input inputMode="decimal" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>)}
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

// ---------------------------------------------------------------- accounts
function AccountsToday({ hub }: { hub: Hub }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const nav = useNavigate()
  const date = hubToday()
  const list = useLoad(() => da.list(date, date, hub.id, null, null), [hub.id, date])
  const [err, setErr] = useState('')
  const rows = list.data ?? []
  const s = (k: 'amount' | 'due' | 'expense' | 'merchant_cash') => rows.reduce((a, r) => a + Number(r[k] || 0), 0)
  async function start() { setErr(''); try { nav(`/app/accounts/daily/${await da.start(hub.id)}`) } catch (e) { setErr(hrFriendly(e)) } }
  const links: Array<[string, string, string, string, boolean]> = [
    ['/app/accounts/daily', 'ledger', 'আজকের হিসাব খাতা', 'Daily accounts', true],
    ['/app/accounts/mine', 'wallet', 'আমার হিসাব', 'My accounts', true],
    ['/app/accounts/reports', 'chart', 'হিসাবের রিপোর্ট', 'Accounts reports', can('da.report.view')],
    ['/app/accounts/settings', 'gear', 'হিসাব সেটিংস', 'Accounts settings', can('da.settings.configure')],
  ]
  return <>
    <div className="da-stats">
      <Stat icon="ledger" label={L('আজকের খাতা', 'Sheets today')} value={n(rows.length)} />
      <Stat icon="cash" label={L('মোট হিসাব', 'Amount')} value={taka(s('amount'))} />
      <Stat icon="receipt" label={L('মার্চেন্ট পেমেন্ট', 'Merchant cash')} value={taka(s('merchant_cash'))} />
      <Stat icon="truck" label={L('খরচ', 'Expenses')} value={taka(s('expense'))} />
      <Stat icon="alert" tone={s('due') ? 'warn' : undefined} label={L('বাকি', 'Due')} value={taka(s('due'))} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('আজকের হিসাব', "Today's accounts")}</h2>
        {can('da.sheet.create') && !rows.length && <button onClick={() => void start()}><Icon name="plus" size={15} />{L('আজকের খাতা খুলুন', "Open today's sheet")}</button>}</div>
      {err && <p className="da-error">{err}</p>}
      {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : <DataTable<SessionRow> title={L('আজকের হিসাব', "Today's accounts")} file={`accounts-${date}`} rows={list.data} rowKey={r => r.id}
        onRowClick={r => nav(`/app/accounts/daily/${r.id}`)} empty={<p className="muted">{L('আজকের খাতা এখনো খোলা হয়নি।', "Today's sheet is not open yet.")}</p>}
        cols={[
          { key: 'no', label: L('খাতা', 'Sheet'), value: r => `#${r.no}` },
          { key: 'status', label: L('অবস্থা', 'Status'), value: r => STATUS_LABEL[r.status] },
          { key: 'riders', label: L('রাইডার', 'Riders'), className: 'r', value: r => n(r.riders) },
          { key: 'amount', label: L('হিসাব', 'Amount'), className: 'r', value: r => taka(r.amount) },
          { key: 'due', label: L('বাকি', 'Due'), className: 'r', value: r => taka(r.due) },
          { key: 'by', label: L('খুলেছেন', 'Opened by'), value: r => r.started_by_name ?? '' },
        ]} />}
    </section>
    <section className="panel">
      <h2>{L('হিসাব ম্যানেজমেন্ট', 'Accounts management')}</h2>
      <div className="hub-links">{links.filter(x => x[4]).map(([to, ic, bn, en]) => <Link key={to} to={to} className="hub-link"><Icon name={ic} size={18} /><span>{L(bn, en)}</span><Icon name="chev" size={14} /></Link>)}</div>
    </section>
  </>
}

// ---------------------------------------------------------------- rider routes
function RiderRoutes({ hub }: { hub: Hub }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const routes = useLoad(() => routesApi.list(hub.id), [hub.id])
  const riders = useLoad(() => routesApi.riders(hub.id), [hub.id])
  const team = useLoad(() => hubApi.team(hub.id, 'active'), [hub.id])
  const o = useOrg()
  const emp = useMemo(() => Object.fromEntries((team.data ?? []).map(e => [e.id, e])) as Record<string, Employee>, [team.data])
  const isRider = (e: Employee) => /rider|রাইডার|delivery/i.test((e.position_id && o.names.pos[e.position_id]) || '')
  const [f, setF] = useState<{ id?: string; code: string; name: string; areas: string; note: string } | null>(null)
  const [pick, setPick] = useState<{ route: HubRoute; ids: string[]; all: boolean } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const edit = can('ops.route.edit')
  const ridersOf = (id: string) => (riders.data ?? []).filter(r => r.route_id === id)
  const routesOf = (empId: string) => (riders.data ?? []).filter(r => r.employee_id === empId).length
  async function save() {
    if (!f) return
    const areas = f.areas.split(/[,\n،]+/).map(a => a.trim()).filter(Boolean)
    if (f.name.trim().length < 2) return setErr(L('রুটের নাম দিন', 'Give the route name'))
    if (!areas.length) return setErr(L('অন্তত একটা এলাকার নাম দিন', 'Give at least one area'))
    setBusy(true); setErr('')
    try { await routesApi.save({ hub_id: hub.id, zone_id: hub.zone_id, code: f.code.trim() || autoCode(f.name), name: f.name.trim(), areas, note: f.note.trim() || null }, f.id)
      setF(null); await routes.reload(); toast(L('রুট সেভ হয়েছে', 'Route saved')) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function saveRiders() {
    if (!pick) return
    setBusy(true); setErr('')
    try { await routesApi.setRiders(pick.route, pick.ids, riders.data ?? []); setPick(null); await riders.reload(); toast(L('রাইডার সেভ হয়েছে', 'Riders saved')) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(r: HubRoute) {
    const why = (await askReason(L(`"${r.name}" রুট সরানোর কারণ`, `Why remove "${r.name}"?`), { ok: L('সরান', 'Remove') })) ?? ''
    if (!why.trim()) return
    try { await routesApi.archive(r.id, why.trim()); await routes.reload(); await riders.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  const noRoute = (team.data ?? []).filter(e => isRider(e) && !routesOf(e.id))
  const [view, setView] = useState<'map' | 'list'>('map')
  return <>
    {node}
    <div className="da-stats">
      <Stat icon="map" label={L('রুট', 'Routes')} value={n(routes.data?.length ?? 0)} />
      <Stat icon="truck" label={L('রুট পাওয়া রাইডার', 'Riders with a route')} value={n(new Set((riders.data ?? []).map(r => r.employee_id)).size)} />
      <Stat icon="alert" tone={noRoute.length ? 'warn' : undefined} label={L('রুট ছাড়া রাইডার', 'Riders without a route')} value={n(noRoute.length)}
        sub={noRoute.slice(0, 3).map(e => e.full_name).join(', ')} />
    </div>
    <section className="panel">
      <div className="da-bar"><h2>{L('রাইডার রুট', 'Rider routes')}</h2>
        <span className="row-acts"><span className="da-seg"><button className={view === 'map' ? 'sm' : 'secondary sm'} onClick={() => setView('map')}><Icon name="map" size={14} />{L('ছবি', 'Map')}</button>
          <button className={view === 'list' ? 'sm' : 'secondary sm'} onClick={() => setView('list')}><Icon name="table" size={14} />{L('কার্ড', 'Cards')}</button></span>
        {(can('ops.route_setting.view') || can('ops.route_setting.edit')) && <Link to={`/app/zonal/routes?zone=${hub.zone_id}&hub=${hub.id}`} className="btn-ghost"><Icon name="map" size={15} />{L('আসল ম্যাপে খুলুন', 'Open on the real map')}</Link>}
        {edit && <button onClick={() => { setErr(''); setF({ code: '', name: '', areas: '', note: '' }) }}><Icon name="plus" size={15} />{L('নতুন রুট', 'New route')}</button>}</span></div>
      {err && !f && !pick && <p className="da-error">{err}</p>}
      {routes.error ? <p className="da-error">{hrFriendly(routes.error)}</p> : routes.data && !routes.data.length ? <p className="muted">{L('এখনো কোনো রুট নেই। এলাকার নাম দিয়ে রুট বানিয়ে রাইডারদের দিন।', 'No routes yet. Make one from area names and give it to riders.')}</p> : view === 'map' ?
        <RouteViz start={hub.name} lanes={(routes.data ?? []).map(r => ({ id: r.id, code: r.code, name: r.name,
          sub: ridersOf(r.id).length ? `${L('রাইডার', 'Riders')}: ${ridersOf(r.id).map(x => emp[x.employee_id]?.full_name ?? '—').join(', ')}` : L('রাইডার দেওয়া হয়নি', 'No rider yet'),
          stops: r.areas.map((a, j) => ({ id: `${r.id}-${j}`, label: a, tone: ridersOf(r.id).length ? undefined : 'warn' as const })) }))} /> :
        <div className="route-cards">{routes.data?.map(r => <article key={r.id} className="route-card">
          <header><span className="ti"><Icon name="map" size={18} /></span><div style={{ flex: 1, minWidth: 0 }}><b>{r.name}</b>
            {r.note && <div className="muted small">{r.note}</div>}</div>
            {edit && <span className="row-acts">
              <button className="secondary sm" onClick={() => { setErr(''); setF({ id: r.id, code: r.code, name: r.name, areas: r.areas.join(', '), note: r.note ?? '' }) }}><Icon name="edit" size={14} /></button>
              <button className="secondary sm" onClick={() => void remove(r)}><Icon name="trash" size={14} /></button></span>}</header>
          <div className="chips">{r.areas.map(a => <span key={a} className="chip">{a}</span>)}</div>
          <div className="route-riders"><span className="muted small">{L('রাইডার', 'Riders')}:</span>
            {ridersOf(r.id).length ? ridersOf(r.id).map(x => <span key={x.id} className="chip rider"><Icon name="truck" size={12} />{emp[x.employee_id]?.full_name ?? '—'}</span>)
              : <span className="muted small">{L('কেউ নেই', 'none')}</span>}
            {edit && <button className="secondary sm" onClick={() => { setErr(''); setPick({ route: r, ids: ridersOf(r.id).map(x => x.employee_id), all: false }) }}><Icon name="users" size={14} />{L('রাইডার দিন', 'Set riders')}</button>}</div>
        </article>)}</div>}
    </section>
    {f && <Modal title={f.id ? L('রুট এডিট', 'Edit route') : L('নতুন রাইডার রুট', 'New rider route')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('রুটের নাম', 'Route name')}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={L('যেমন শহর পূর্ব', 'e.g. Town east')} /></Field>
        <Field label={L('এলাকা (কমা বা নতুন লাইনে আলাদা)', 'Areas (comma or new line)')} wide><textarea rows={4} value={f.areas} onChange={e => setF({ ...f, areas: e.target.value })}
          placeholder={L('কানাইখালী, আলাইপুর, স্টেশন বাজার', 'Area 1, Area 2, Area 3')} /></Field>
        <Field label={L('নোট', 'Note')} wide><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {pick && <Modal title={`${L('রাইডার দিন', 'Set riders')} — ${pick.route.name}`} onClose={() => setPick(null)}
      actions={<><button className="secondary" onClick={() => setPick(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void saveRiders()}>{L('সেভ', 'Save')}</button></>}>
      <label className="small" style={{ margin: '0 0 8px' }}><input type="checkbox" style={{ width: 'auto', margin: '0 6px 0 0' }} checked={pick.all} onChange={e => setPick({ ...pick, all: e.target.checked })} />{L('রাইডার ছাড়া অন্য স্টাফও দেখান', 'Show other staff too')}</label>
      <div className="pick-list">{(team.data ?? []).filter(e => pick.all || isRider(e) || pick.ids.includes(e.id)).map(e => { const on = pick.ids.includes(e.id)
        return <div key={e.id} className={`pick-row${on ? ' on' : ''}`}><label><input type="checkbox" checked={on}
          onChange={() => setPick({ ...pick, ids: on ? pick.ids.filter(x => x !== e.id) : [...pick.ids, e.id] })} /> {e.employee_code ? `${e.employee_code} · ` : ''}{e.full_name}
          {routesOf(e.id) > 0 && !on && <span className="muted small"> · {L(`আরও ${n(routesOf(e.id))}টা রুটে আছে`, `on ${routesOf(e.id)} other route(s)`)}</span>}</label></div> })}</div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}
