import { useMemo, useState } from 'react'
import { Contact } from '../../components/Contact'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ExportByFormat } from '../../components/ExportByFormat'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { dmy, EMP_STATUS, hr, hrFriendly, type Employee, type EmployeeStatus } from '../../lib/hr'
import { formatFriendly, staffAdmin, type HubSummary } from '../../lib/staffAdmin'
import { EmpBadge, NewApplication, useOrg } from '../hr/common'
import { HubPostMatrix } from './HubPostMatrix'
import { download, xlsxBlob } from '../../lib/xlsx'
import { Combo } from '../../components/inputs'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

/** Zonal dashboard: hub by hub, with everything a zonal manager does to staff. */
export function ZonalStaff() {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const nav = useNavigate()
  const o = useOrg()
  const { toast, node } = useToast()
  const [zone, setZone] = useState('')
  const [hub, setHub] = useState<HubSummary | null>(null)
  const [newApp, setNewApp] = useState(false)
  const [move, setMove] = useState(false)
  const hubs = useLoad(() => staffAdmin.hubSummary(zone || null), [zone])
  const rows = hubs.data ?? []
  const sum = (k: keyof HubSummary) => rows.reduce((a, r) => a + (r[k] as number), 0)

  return <AppShell title={L('জোনাল ড্যাশবোর্ড — কর্মী', 'Zonal dashboard — staff')}
    subtitle={L('হাব অনুযায়ী কর্মীর হিসাব। একটা হাবে চাপলে সেই হাবের কর্মীদের তালিকা আর কাজগুলো নিচে আসবে।',
      'Staff hub by hub. Tap a hub to see its staff and the actions below.')}
    actions={<><ExportByFormat zone={zone || null} hub={hub?.hub_id ?? null} title={L('কর্মী তালিকা', 'Staff list')} />
      <Link to="/app/zonal/files" className="btn-ghost">জোনাল ফাইল (বদলি/চালু/বন্ধ Excel)</Link>
      {(can('hr.employee.edit') || can('hr.transfer.edit')) && <button className="secondary" onClick={() => setMove(true)}>⇄ {L('হাব বদলি', 'Hub transfer')}</button>}
      {can('hr.application.create') && <button onClick={() => setNewApp(true)}>+ {L('নতুন কর্মী', 'New employee')}</button>}</>}>
    {node}
    <div className="da-stats">
      <Stat icon="hub" label={L('হাব', 'Hubs')} value={n(rows.length)} />
      <Stat icon="users" label={L('মোট কর্মী', 'Staff')} value={n(sum('total'))} />
      <Stat icon="check" tone="ok" label={L('সক্রিয়', 'Active')} value={n(sum('active'))} />
      <Stat icon="clock" tone={sum('applicant') ? 'warn' : undefined} label={L('আইডির অপেক্ষায়', 'Waiting for an ID')} value={n(sum('applicant'))} />
      <Stat icon="key" label={L('লগইন আছে', 'Have a login')} value={n(sum('with_login'))} />
    </div>

    <section className="da-filters panel no-print">
      <Field label={L('এরিয়া', 'Area')}><select value={zone} onChange={e => { setZone(e.target.value); setHub(null) }}>
        <option value="">{L('সব এরিয়া', 'All areas')}</option>
        {o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
    </section>
    {hubs.error ? <p className="da-error">{formatFriendly(hubs.error)}</p> : null}

    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('হাব অনুযায়ী', 'Hub by hub')}</h2>
        {hubs.loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}</div>
      <DataTable<HubSummary> title={L('হাব অনুযায়ী কর্মী', 'Staff by hub')} file="hub-staff" rows={rows} rowKey={r => r.hub_id}
        onRowClick={r => setHub(r)} empty={<p className="muted">{L('কোনো হাব নেই। আগে “এরিয়া, হাব ও পদ” পাতায় হাব যোগ করুন।', 'No hubs yet. Add one on “Zones, hubs & posts”.')}</p>}
        cols={[
          { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name, render: r => <><strong>{r.hub_name}</strong><span className="sec">{r.zone_name}</span></> },
          { key: 'total', label: L('মোট', 'Total'), value: r => n(r.total) },
          { key: 'active', label: L('সক্রিয়', 'Active'), value: r => n(r.active) },
          { key: 'inactive', label: L('নিষ্ক্রিয়', 'Inactive'), value: r => n(r.inactive) },
          { key: 'applicant', label: L('আইডির অপেক্ষায়', 'Waiting for ID'), value: r => n(r.applicant),
            render: r => r.applicant ? <Badge tone="warn">{n(r.applicant)}</Badge> : <span className="muted">—</span> },
          { key: 'login', label: L('লগইন', 'Logins'), value: r => n(r.with_login) },
          { key: 'pos', label: L('কোন পদে কতজন', 'Positions'), value: r => Object.entries(r.by_position).map(([p, c]) => `${p}: ${c}`).join(', ') },
        ]} />
    </section>

    <HubPostMatrix zone={zone || null} onHub={id => { const r = rows.find(x => x.hub_id === id); if (r) setHub(r) }} />

    {hub && <HubStaff hub={hub} onToast={m => { toast(m); void hubs.reload() }} onClose={() => setHub(null)} onOpen={id => nav(`/app/hr/employees/${id}`)} />}
    {move && <QuickTransfer onClose={() => setMove(false)} onDone={m => { setMove(false); toast(m); void hubs.reload() }} />}
    {newApp && <NewApplication onClose={() => setNewApp(false)} onDone={id => { toast(L('আবেদন খোলা হয়েছে — বাকি তথ্য দিয়ে সাবমিট করুন', 'Application opened — fill in the rest and submit')); nav(`/app/hr/employees/${id}`) }} />}
  </AppShell>
}

type Action = null | 'status' | 'transfer' | 'ids' | 'archive'

function HubStaff({ hub, onToast, onClose, onOpen }: {
  hub: HubSummary; onToast: (m: string) => void; onClose: () => void; onOpen: (id: string) => void
}) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const o = useOrg()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const list = useLoad(() => hr.employees({ hub: hub.hub_id, status: status || undefined, q: q || undefined, limit: 1000 }), [hub.hub_id, status, q])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [act, setAct] = useState<Action>(null)
  const staff = list.data ?? []
  const chosen = useMemo(() => staff.filter(e => picked.has(e.id)), [staff, picked])
  const toggle = (id: string) => setPicked(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })
  const done = (m: string) => { setAct(null); setPicked(new Set()); onToast(m); void list.reload() }
  const canMove = can('hr.employee.edit') || can('hr.transfer.edit')

  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{hub.hub_name} <span className="muted small">{hub.zone_name}</span></h2>
      <button className="secondary sm" onClick={onClose}>{L('বন্ধ করুন', 'Close')}</button></div>

    <div className="da-filters" style={{ padding: 0, marginBottom: 10 }}>
      <Field label={L('খুঁজুন', 'Search')}><input value={q} onChange={e => setQ(e.target.value)} placeholder={L('নাম, আইডি বা মোবাইল', 'Name, ID or mobile')} /></Field>
      <Field label={L('অবস্থা', 'Status')}><select value={status} onChange={e => setStatus(e.target.value)}>
        <option value="">{L('সব', 'All')}</option>
        {(Object.keys(EMP_STATUS) as EmployeeStatus[]).map(s => <option key={s} value={s}>{EMP_STATUS[s][0]}</option>)}</select></Field>
    </div>

    {picked.size > 0 && <div className="notice" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <strong>{n(picked.size)} {L('জন বাছাই করা', 'selected')}</strong>
      {can('hr.employee.edit') && <button className="sm" onClick={() => setAct('status')}>{L('সক্রিয় / নিষ্ক্রিয় করুন', 'Active / inactive')}</button>}
      {canMove && <button className="sm" onClick={() => setAct('transfer')}>{L('অন্য হাবে বদলি', 'Transfer to another hub')}</button>}
      {can('hr.application.approve') && <button className="sm" onClick={() => setAct('ids')}>{L('এমপ্লয়ি আইডি দিন', 'Give Employee IDs')}</button>}
      {can('hr.employee.archive') && <button className="sm danger" onClick={() => setAct('archive')}>{L('তালিকা থেকে সরান', 'Remove from the list')}</button>}
      <button className="secondary sm" onClick={() => setPicked(new Set())}>{L('বাছাই মুছুন', 'Clear')}</button>
    </div>}

    {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : null}
    <DataTable<Employee> title={`${hub.hub_name} — ${L('কর্মী', 'staff')}`} file={`hub-${hub.hub_name}`} prefKey="hub-staff-list" rows={staff} rowKey={e => e.id}
      empty={<p className="muted">{list.loading ? L('লোড হচ্ছে…', 'Loading…') : L('এই হাবে কোনো কর্মী নেই।', 'No staff in this hub.')}</p>}
      cols={[
        { key: 'pick', label: '✓', noExport: true, render: e => <input type="checkbox" style={{ width: 'auto' }} aria-label={e.full_name}
            checked={picked.has(e.id)} onChange={() => toggle(e.id)} onClick={ev => ev.stopPropagation()} /> },
        { key: 'code', label: L('আইডি', 'ID'), value: e => e.employee_code ?? '', render: e => e.employee_code ? <strong>{e.employee_code}</strong> : <Badge tone="warn">{L('আইডি নেই', 'No ID')}</Badge> },
        { key: 'name', label: L('নাম', 'Name'), primary: true, value: e => e.full_name },
        { key: 'mobile', label: L('মোবাইল', 'Mobile'), value: e => e.mobile ?? '', render: e => <Contact phone={e.mobile} /> },
        { key: 'pos', label: L('পদবি', 'Position'), value: e => e.position_id ? o.names.pos[e.position_id] ?? '' : '' },
        { key: 'join', label: L('যোগদান', 'Joined'), value: e => dmy(e.joining_date) },
        { key: 'status', label: L('অবস্থা', 'Status'), value: e => EMP_STATUS[e.status]?.[0] ?? e.status, render: e => <EmpBadge status={e.status} /> },
        { key: 'open', label: '', noExport: true, render: e => <span className="row-acts">
            {canMove && e.status === 'active' && <button className="sm" onClick={ev => { ev.stopPropagation(); setPicked(new Set([e.id])); setAct('transfer') }}>{L('বদলি', 'Transfer')}</button>}
            <button className="secondary sm" onClick={ev => { ev.stopPropagation(); onOpen(e.id) }}>{L('বিস্তারিত', 'Details')}</button></span> },
      ]} />

    {act === 'status' && <StatusAction list={chosen} onClose={() => setAct(null)} onDone={done} />}
    {act === 'transfer' && <TransferAction list={chosen} hubs={(o.data?.hubs ?? []).filter(h => h.id !== hub.hub_id)} onClose={() => setAct(null)} onDone={done} />}
    {act === 'ids' && <GiveIdsAction list={chosen} onClose={() => setAct(null)} onDone={done} />}
    {act === 'archive' && <ArchiveAction list={chosen} onClose={() => setAct(null)} onDone={done} />}
  </section>
}

export function Names({ list }: { list: Employee[] }) {
  const { L, n } = usePrefs()
  return <p className="muted small">{n(list.length)} {L('জন:', 'people:')} {list.slice(0, 8).map(e => `${e.employee_code ?? '—'} ${e.full_name}`).join(', ')}{list.length > 8 ? ` … +${n(list.length - 8)}` : ''}</p>
}

export function StatusAction({ list, onClose, onDone }: { list: Employee[]; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const [to, setTo] = useState<EmployeeStatus>('inactive')
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const targets = list.filter(e => e.status !== to && (e.status === 'active' || e.status === 'inactive'))
  const needsActive = to === 'resigned' || to === 'terminated'
  async function go() {
    setErr('')
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    if (!targets.length) return setErr(L('বাছাই করা কারও অবস্থা বদলানোর নেই', 'None of the selected staff need this change'))
    setBusy(true)
    let ok = 0; const bad: string[] = []
    for (const e of targets) {
      try { await hr.changeStatus(e.id, to, date, reason.trim()); ok++ }
      catch (x) { bad.push(`${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false)
    if (ok) onDone(L(`${n(ok)} জনের অবস্থা বদলানো হয়েছে`, `${ok} updated`) + (bad.length ? L(`, ${n(bad.length)} জনে সমস্যা`, `, ${bad.length} failed`) : ''))
    if (!ok) setErr(bad.join(' · '))
  }
  return <Modal title={L('সক্রিয় / নিষ্ক্রিয় করুন', 'Active / inactive')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{L('বদলান', 'Change')}</button></>}>
    <Names list={list} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('নতুন অবস্থা', 'New status')}><select value={to} onChange={e => setTo(e.target.value as EmployeeStatus)}>
        <option value="inactive">{L('নিষ্ক্রিয় করুন', 'Make inactive')}</option>
        <option value="active">{L('আবার সক্রিয় করুন', 'Make active again')}</option>
        <option value="resigned">{L('চাকরি ছেড়েছেন', 'Resigned')}</option>
        <option value="terminated">{L('অব্যাহতি দেওয়া হয়েছে', 'Terminated')}</option></select></Field>
      <Field label={L('যেদিন থেকে', 'From')}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: ছুটিতে আছেন / কাজে ফিরেছেন', 'e.g. on long leave / back at work')} /></Field>
    </div>
    <p className="muted small">{needsActive
      ? L('“চাকরি ছেড়েছেন” বা “অব্যাহতি” করলে কর্মীর কাজ শেষ ধরা হবে। এর পরেই তাঁকে তালিকা থেকে সরানো যাবে। বকেয়া হিসাব থাকলে আগে মেটাতে হবে।',
          'Resigned or terminated closes their employment. Only then can they be removed from the list; any dues must be settled first.')
      : L('নিষ্ক্রিয় করলে কর্মী তালিকায় থাকবেন, হাজিরা আর বেতনের হিসাবে আসবেন না। আবার সক্রিয় করা যাবে।',
          'An inactive employee stays on the list but is left out of attendance and salary. You can make them active again.')}</p>
    {targets.length !== list.length && <p className="notice">{L(`বাছাই করা ${n(list.length)} জনের মধ্যে ${n(targets.length)} জনের অবস্থা বদলাবে, বাকিরা আগেই ওই অবস্থায় আছেন বা আবেদনকারী।`,
      `${targets.length} of ${list.length} will change; the rest are already in that state or are applicants.`)}</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

/** Hub transfer from the top of the zonal panel: find people by ID, name or mobile, then move them. */
function QuickTransfer({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const { L } = usePrefs()
  const o = useOrg()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Employee[]>([])
  const [next, setNext] = useState(false)
  const found = useLoad(() => q.trim().length >= 2 ? hr.employees({ q: q.trim(), status: 'active', limit: 20 }) : Promise.resolve([] as Employee[]), [q])
  const has = (e: Employee) => picked.some(x => x.id === e.id)
  const fromHubs = new Set(picked.map(e => e.hub_id))
  if (next) return <TransferAction list={picked} hubs={(o.data?.hubs ?? []).filter(h => !(fromHubs.size === 1 && fromHubs.has(h.id)))} onClose={onClose} onDone={onDone} />
  return <Modal title={L('হাব বদলি — কর্মী বাছুন', 'Hub transfer — choose staff')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button disabled={!picked.length} onClick={() => setNext(true)}>{L('পরের ধাপ', 'Next')} ({picked.length})</button></>}>
    <Field label={L('খুঁজুন', 'Search')} hint={L('এমপ্লয়ি আইডি, নাম বা মোবাইল — শুধু সক্রিয় কর্মী', 'Employee ID, name or mobile — active staff only')}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L('যেমন 1234 বা রহিম', 'e.g. 1234 or Rahim')} /></Field>
    {picked.length > 0 && <div className="focus-pick" style={{ margin: '8px 0' }}>{picked.map(e =>
      <button key={e.id} type="button" className="secondary sm" onClick={() => setPicked(p => p.filter(x => x.id !== e.id))}>{e.full_name} ✕</button>)}</div>}
    {found.error ? <p className="da-error">{hrFriendly(found.error)}</p> : null}
    <ul className="duty-list">{(found.data ?? []).map(e => <li key={e.id} className="duty" style={{ cursor: 'pointer' }}
        onClick={() => setPicked(p => has(e) ? p.filter(x => x.id !== e.id) : [...p, e])}>
      <input type="checkbox" style={{ width: 'auto' }} readOnly checked={has(e)} />
      <div style={{ flex: 1, minWidth: 0 }}><b>{e.full_name}</b> {e.employee_code && <span className="muted">#{e.employee_code}</span>}
        <div className="muted small">{e.hub_id ? o.names.hub[e.hub_id] ?? '' : ''}{e.position_id ? ` · ${o.names.pos[e.position_id] ?? ''}` : ''}</div></div></li>)}
      {q.trim().length >= 2 && !found.loading && !found.data?.length && <li className="muted">{L('কাউকে পাওয়া যায়নি', 'Nobody found')}</li>}</ul>
  </Modal>
}

export function TransferAction({ list, hubs, onClose, onDone }: { list: Employee[]; hubs: Array<{ id: string; name: string }>; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const o = useOrg()
  const [hub, setHub] = useState('')
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [moved, setMoved] = useState<{ people: Employee[]; msg: string; bad: string[] } | null>(null)
  const targets = list.filter(e => e.status === 'active')
  const hubName = (id: string | null) => id ? o.names.hub[id] ?? hubs.find(h => h.id === id)?.name ?? '' : ''
  // The company's "Employee Transfer" layout — the same columns as the zonal file centre.
  function excel(people: Employee[], remark: string) {
    download(xlsxBlob('Employee Transfer', `${hubName(hub)} · ${date}`,
      ['SL', 'Employee ID', 'Name', 'Phone Number', 'Designation', 'Present Hub', 'Transfer Hub', 'Effective Date', 'Reason', 'Reference Name & ID', 'Remarks'],
      people.map((e, i) => [i + 1, e.employee_code, e.full_name, e.mobile, e.position_id ? o.names.posEn[e.position_id] ?? '' : '', hubName(e.hub_id), hubName(hub), date, reason.trim(), e.reference_info, remark])),
      `Transfer-${date}.xlsx`)
  }
  function check() {
    if (!hub) return L('কোন হাবে যাবেন বেছে নিন', 'Choose the new hub')
    if (!reason.trim()) return L('কারণ লিখুন', 'Enter a reason')
    if (!targets.length) return L('শুধু সক্রিয় কর্মীদের বদলি করা যায়', 'Only active staff can be transferred')
    return ''
  }
  async function go() {
    const problem = check()
    setErr(problem)
    if (problem) return
    setBusy(true)
    const done: Employee[] = []; const bad: string[] = []
    for (const e of targets) {
      try {
        await hr.transfer(e.id, { hub, department: e.department_id, position: e.position_id, manager: null, effective: date, reason: reason.trim(), type: 'transfer' })
        done.push(e)
      } catch (x) { bad.push(`${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false)
    if (!done.length) return setErr(bad.join(' · '))
    setMoved({ people: done, bad, msg: L(`${n(done.length)} জনকে বদলি করা হয়েছে`, `${done.length} transferred`) + (bad.length ? L(`, ${n(bad.length)} জনে সমস্যা`, `, ${bad.length} failed`) : '') })
  }
  if (moved) return <Modal title={L('বদলি হয়েছে', 'Transfer done')} onClose={() => onDone(moved.msg)}
    actions={<><button className="secondary" onClick={() => onDone(moved.msg)}>{L('বন্ধ করুন', 'Close')}</button>
      <button onClick={() => excel(moved.people, 'সিস্টেমে হয়েছে')}>{L('Excel ফাইল নামান', 'Download Excel file')}</button></>}>
    <p><b>{moved.msg}</b> → {hubName(hub)}</p>
    <Names list={moved.people} />
    {moved.bad.length > 0 && <p className="da-error">{moved.bad.join(' · ')}</p>}
    <p className="muted small">{L('কোম্পানির ফরম্যাটে বদলির Excel ফাইল এখান থেকে নিন। পরে লাগলে “জোনাল ফাইল” পাতায় তারিখ ধরে আবার পাওয়া যাবে।',
      'Take the transfer Excel in the company layout here. Later it is also on the "Zonal files" page by date.')}</p>
  </Modal>
  return <Modal title={L('অন্য হাবে বদলি', 'Transfer to another hub')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button className="secondary" disabled={busy} title={L('বদলি না করে শুধু ফাইল', 'File only, no transfer')}
        onClick={() => { const problem = check(); setErr(problem); if (!problem) excel(targets, 'প্রস্তাবিত') }}>{L('শুধু Excel', 'Excel only')}</button>
      <button disabled={busy} onClick={() => void go()}>{L('বদলি করুন', 'Transfer')}</button></>}>
    <Names list={list} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('নতুন হাব', 'New hub')}><Combo value={hub} onChange={setHub} placeholder={L('বেছে নিন…', 'Choose…')} options={hubs.map(h => ({ value: h.id, label: h.name }))} /></Field>
      <Field label={L('যেদিন থেকে', 'From')}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: নতুন হাবে জনবল দরকার', 'e.g. the new hub needs staff')} /></Field>
    </div>
    <p className="muted small">{L('পদবি আর বিভাগ আগের মতোই থাকবে। বদলির হিসাব প্রোফাইলের ইতিহাসে থেকে যাবে। বদলির পর কোম্পানির ফরম্যাটে Excel ফাইল নামানো যাবে।',
      'Position and department stay the same. The move is kept in the profile history. After the transfer you can download the Excel file in the company layout.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function GiveIdsAction({ list, onClose, onDone }: { list: Employee[]; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const waiting = useMemo(() => list.filter(e => e.status === 'applicant' && !e.employee_code), [list])
  const q = useLoad(async () => {
    if (!waiting.length) return { ready: [] as Employee[], draft: [] as Employee[], codes: [] as string[] }
    const apps = await hr.applications()
    const ok = new Set(apps.filter(a => a.status === 'submitted').map(a => a.employee_id))
    const ready = waiting.filter(e => ok.has(e.id))
    return { ready, draft: waiting.filter(e => !ok.has(e.id)), codes: ready.length ? await staffAdmin.nextCodes(ready.length) : [] }
  }, [waiting.map(e => e.id).join(',')])
  const ready = q.data?.ready ?? []
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const codeOf = (i: number, id: string) => edited[id] ?? q.data?.codes[i] ?? ''
  async function go() {
    setErr('')
    const items = ready.map((e, i) => ({ employee_id: e.id, employee_code: codeOf(i, e.id).trim() }))
    if (!items.length) return setErr(L('কারও আবেদন জমা হয়নি', 'No submitted applications here'))
    if (items.some(x => !x.employee_code)) return setErr(L('প্রত্যেকের জন্য একটা আইডি দিন', 'Give every person an ID'))
    setBusy(true)
    try {
      const made = await staffAdmin.bulkAssignIds(items, note.trim() || 'Bulk ID assignment')
      onDone(L(`${n(made)} জনকে এমপ্লয়ি আইডি দেওয়া হয়েছে`, `${made} staff given an Employee ID`))
    } catch (e) { setErr(formatFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={L('এমপ্লয়ি আইডি দিন', 'Give Employee IDs')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button disabled={busy || !ready.length} onClick={() => void go()}>{L('আইডি দিন', 'Give IDs')}</button></>}>
    {q.error ? <p className="da-error">{formatFriendly(q.error)}</p> : null}
    {!waiting.length ? <p className="muted">{L('বাছাই করা কেউ আইডির অপেক্ষায় নেই। যাঁদের এখনো আইডি নেই তাঁদের বাছাই করুন।', 'None of the selected are waiting for an ID.')}</p> : <>
      {!!q.data?.draft.length && <p className="notice">{L('এঁদের আবেদন এখনো জমা হয়নি, তাই আইডি দেওয়া যাবে না — প্রোফাইলে গিয়ে বাকি তথ্য দিয়ে “আবেদন জমা দিন” চাপুন: ',
        'These applications are not submitted yet, so no ID can be given — open the profile, fill in the rest and submit: ')}{q.data.draft.map(e => e.full_name).join(', ')}</p>}
      {!!ready.length && <>
        <p className="muted small">{L('পরের খালি নম্বরগুলো বসানো আছে — দরকার হলে বদলান। সবগুলো একসাথে হয়, একটাতে সমস্যা হলে কোনোটাই হবে না।',
          'The next free numbers are filled in — change them if you need to. It is all or nothing.')}</p>
        <div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>{L('নাম', 'Name')}</th><th>{L('মোবাইল', 'Mobile')}</th><th>{L('এমপ্লয়ি আইডি', 'Employee ID')}</th></tr></thead>
          <tbody>{ready.map((e, i) => <tr key={e.id}><td>{e.full_name}</td><td>{e.mobile ?? '—'}</td>
            <td><input value={codeOf(i, e.id)} aria-label={e.full_name} onChange={ev => setEdited({ ...edited, [e.id]: ev.target.value })} /></td></tr>)}</tbody></table></div>
        <Field label={L('নোট', 'Note')}><input value={note} onChange={e => setNote(e.target.value)} placeholder={L('যেমন: পুরনো কর্মীদের আইডি', 'e.g. IDs for existing staff')} /></Field>
      </>}
    </>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

function ArchiveAction({ list, onClose, onDone }: { list: Employee[]; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (reason.trim().length < 3) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    setBusy(true)
    let ok = 0; const bad: string[] = []
    for (const e of list) {
      try { await hr.archive(e.id, reason.trim()); ok++ } catch (x) { bad.push(`${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false)
    if (ok) onDone(L(`${n(ok)} জনকে তালিকা থেকে সরানো হয়েছে`, `${ok} removed`) + (bad.length ? L(`, ${n(bad.length)} জনে সমস্যা`, `, ${bad.length} failed`) : ''))
    if (!ok) setErr(bad.join(' · '))
  }
  return <Modal title={L('তালিকা থেকে সরাবেন?', 'Remove from the list?')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('সরান', 'Remove')}</button></>}>
    <Names list={list} />
    <p className="muted small">{L('কর্মী আর্কাইভে চলে যাবেন — তালিকায় আসবেন না, কিন্তু পুরোনো হাজিরা, বেতন আর ইতিহাস মুছবে না। সক্রিয় কর্মী বা খোলা আবেদন সরানো যায় না — আগে “চাকরি ছেড়েছেন” বা “অব্যাহতি” করুন।',
      'The employee is archived — out of the list, but past attendance, salary and history stay. Active staff and open applications cannot be removed: mark them resigned or terminated first.')}</p>
    <Field label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: চাকরি ছেড়েছেন', 'e.g. left the company')} /></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
