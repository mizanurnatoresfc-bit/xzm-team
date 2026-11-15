import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { DataTable } from '../../components/DataTable'
import { Combo } from '../../components/inputs'
import { Icon } from '../../components/Icon'
import { bn, EMP_STATUS, hr, hrFriendly, type Employee, type EmployeeStatus } from '../../lib/hr'
import { matches } from '../../lib/validate'
import { ExportByFormat } from '../../components/ExportByFormat'
import { downloadIdCreateFile } from '../../lib/idCreateFile'
import { EmpBadge, NewApplication, useOrg } from './common'
import { Names, StatusAction, TransferAction } from '../zonal/ZonalStaff'

const TONES = ['g', 'b', 'o', 'p', 'c', 'r']
const toneOf = (s: string) => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]
const initials = (n: string) => n.replace(/^(md\.?|mohammad|mohammed|mst\.?)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
const qs = () => new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
const STATUS_TABS: Array<[string, string]> = [['active', 'সক্রিয়'], ['applicant', 'আইডির অপেক্ষায়'], ['inactive', 'নিষ্ক্রিয়'], ['', 'সব']]
const inStatus = (e: Employee, s: string) => !s || e.status === s || (s === 'inactive' && ['inactive', 'resigned', 'terminated'].includes(e.status))

/** Every staff member in one list: by post, area and hub; view, edit, and act on several at once. */
export function Employees() {
  const { can } = useAuth()
  const nav = useNavigate()
  const o = useOrg()
  const { toast, node } = useToast()
  const [q, setQ] = useState(() => qs().get('q') ?? '')
  const [zone, setZone] = useState('')
  const [hub, setHub] = useState('')
  const [status, setStatus] = useState(() => (qs().get('q') ? '' : 'active'))
  const [post, setPost] = useState('')            // a position id, or 'leave'
  // One load: the chips show live counts and every filter is instant.
  const list = useLoad(() => hr.employees({ limit: 2000 }), [])
  const leave = useLoad(() => hr.onLeaveToday().catch(() => [] as string[]), [])
  const [open, setOpen] = useState(false)
  const [act, setAct] = useState<{ kind: 'transfer' | 'status' | 'wrong'; list: Employee[]; clear: () => void } | null>(null)
  const all = list.data ?? []
  const onLeave = useMemo(() => new Set(leave.data ?? []), [leave.data])
  const hubName = (e: Employee) => (e.hub_id ? o.names.hub[e.hub_id] ?? '' : '')
  const posName = (e: Employee) => (e.position_id ? o.names.pos[e.position_id] ?? '' : '')

  // area, hub and search first; the status and post chips count inside that
  const base = useMemo(() => all.filter(e => (!zone || e.zone_id === zone) && (!hub || e.hub_id === hub)
    && matches(`${e.full_name} ${e.full_name_bn ?? ''} ${e.employee_code ?? ''} ${e.mobile ?? ''}`, q)), [all, zone, hub, q])
  const scoped = useMemo(() => base.filter(e => inStatus(e, status)), [base, status])
  const rows = useMemo(() => scoped.filter(e => !post || (post === 'leave' ? onLeave.has(e.id) : e.position_id === post)), [scoped, post, onLeave])
  const posts = (o.data?.positions ?? []).map(p => ({ p, count: scoped.filter(e => e.position_id === p.id).length })).filter(x => x.count > 0)
  const leaveCount = scoped.filter(e => onLeave.has(e.id)).length
  const zones = o.data?.zones ?? []
  const hubs = (o.data?.hubs ?? []).filter(h => !zone || h.zone_id === zone)
  const canMove = can('hr.employee.edit') || can('hr.transfer.edit')
  const done = (m: string) => { act?.clear(); setAct(null); toast(m); void list.reload() }

  return <AppShell title="কর্মী" subtitle={`${bn(all.filter(e => e.status === 'active').length)} জন সক্রিয় কর্মী — পদ, এরিয়া বা হাব ধরে দেখুন; টিক দিয়ে একসাথে অনেকের কাজ করুন।`}
    actions={<><button type="button" className="secondary" title="New Admin & Rider ID Creat Information" onClick={() => { void downloadIdCreateFile({ zone: zone || null, hub: hub || null, status: status || 'active' }).then(n => toast(n ? `ID Create ফাইল নামানো হয়েছে — ${n} জন` : 'কোনো কর্মী পাওয়া যায়নি')).catch((e: unknown) => toast(e instanceof Error ? e.message : 'ফাইল বানানো যায়নি')) }}>⬇ ID Create ফাইল</button>
      <ExportByFormat zone={zone || null} hub={hub || null} status={status || null} q={q || null} title="কর্মী তালিকা" />
      {can('hr.application.create') && <button onClick={() => setOpen(true)}>+ নতুন কর্মী</button>}</>}>
    {node}
    <section className="panel emp-board">
      <div className="eb-top no-print">
        <div className="eb-chips" role="group" aria-label="পদ অনুযায়ী">
          <button type="button" className={`chip-toggle${post === '' ? ' on' : ''}`} aria-pressed={post === ''} onClick={() => setPost('')}>সব <b>{bn(scoped.length)}</b></button>
          {posts.map(({ p, count }) => <button key={p.id} type="button" className={`chip-toggle${post === p.id ? ' on' : ''}`} aria-pressed={post === p.id} onClick={() => setPost(post === p.id ? '' : p.id)}>
            {p.name} <b>{bn(count)}</b></button>)}
          <button type="button" className={`chip-toggle${post === 'leave' ? ' on' : ''}`} aria-pressed={post === 'leave'} onClick={() => setPost(post === 'leave' ? '' : 'leave')}>আজ ছুটিতে <b>{bn(leaveCount)}</b></button>
        </div>
        <label className="emp-search"><Icon name="search" size={18} />
          <input type="search" placeholder="নাম, আইডি বা মোবাইল দিয়ে খুঁজুন…" value={q} onChange={e => setQ(e.target.value)} aria-label="খুঁজুন" />
          {q && <button type="button" className="icon-btn" aria-label="মুছুন" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}</label>
      </div>
      <div className="eb-filters no-print">
        {zones.length > 1 && <Field label="এরিয়া"><Combo value={zone} onChange={v => { setZone(v); setHub('') }} placeholder="সব এরিয়া" options={zones.map(z => ({ value: z.id, label: z.name }))} /></Field>}
        <Field label="হাব"><Combo value={hub} onChange={setHub} placeholder="সব হাব" options={hubs.map(h => ({ value: h.id, label: h.name }))} /></Field>
        <div className="emp-status" role="group" aria-label="অবস্থা">{STATUS_TABS.map(([k, l]) => <button key={k || 'all'} type="button" className={`chip-toggle${status === k ? ' on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>
          {l} <b>{bn(base.filter(e => inStatus(e, k)).length)}</b></button>)}</div>
      </div>
      {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : null}
      <DataTable<Employee> title="কর্মী তালিকা" file="employees" rows={list.data ? rows : null} rowKey={e => e.id} search={false} phoneView="list"
        empty={<p className="muted">{list.loading ? 'লোড হচ্ছে…' : 'কোনো কর্মী পাওয়া যায়নি।'}</p>}
        bulk={(marked, clear) => <>
          {canMove && <button type="button" className="sm" onClick={() => setAct({ kind: 'transfer', list: marked, clear })}>অন্য হাবে বদলি</button>}
          {can('hr.employee.edit') && <button type="button" className="sm" onClick={() => setAct({ kind: 'status', list: marked, clear })}>সক্রিয় / নিষ্ক্রিয়</button>}
          {can('hr.employee.archive') && <button type="button" className="sm danger" onClick={() => setAct({ kind: 'wrong', list: marked, clear })}>ভুল এন্ট্রি — মুছুন</button>}
          <button type="button" className="secondary sm" onClick={clear}>বাছাই তুলুন</button></>}
        cols={[
          { key: 'full_name', label: 'নাম', primary: true, value: e => e.full_name, render: e => <span className="emp-tname"><span className={`ec-av sm t-${toneOf(e.full_name)}`}>{initials(e.full_name)}</span>
            <span><b>{e.full_name}</b><span className="sec">{e.employee_code ? `আইডি ${e.employee_code}` : 'আইডি বাকি'}{e.full_name_bn ? ` · ${e.full_name_bn}` : ''}</span></span></span> },
          { key: 'employee_code', label: 'আইডি', hidden: true, value: e => e.employee_code ?? '' },
          { key: 'mobile', label: 'মোবাইল', value: e => e.mobile ?? '', render: e => e.mobile ? <a href={`tel:${e.mobile}`} onClick={ev => ev.stopPropagation()}>{e.mobile}</a> : <span className="muted">—</span> },
          { key: 'pos', label: 'পদবি', value: posName, render: e => posName(e) ? <Badge tone="ok">{posName(e)}</Badge> : <Badge tone="neutral">পদ দেওয়া নেই</Badge> },
          { key: 'hub', label: 'হাব', value: hubName },
          { key: 'status', label: 'অবস্থা', value: e => EMP_STATUS[e.status as EmployeeStatus]?.[0] ?? e.status, render: e => <EmpBadge status={e.status} /> },
          { key: 'act', label: 'কাজ', noExport: true, className: 'r', render: e => <span className="row-acts" onClick={ev => ev.stopPropagation()}>
            {can('hr.employee.edit') && e.status !== 'applicant' && <button type="button" className="secondary sm" onClick={() => nav(`/app/hr/employees/${e.id}?edit=1`)}>এডিট</button>}
            <button type="button" className="sm" onClick={() => nav(`/app/hr/employees/${e.id}`)}>দেখুন</button></span> },
        ]} />
    </section>
    {act?.kind === 'transfer' && <TransferAction list={act.list} hubs={o.data?.hubs ?? []} onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'status' && <StatusAction list={act.list} onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'wrong' && <RemoveWrong list={act.list} onClose={() => setAct(null)} onDone={done} />}
    {open && <NewApplication onClose={() => setOpen(false)} onDone={id => { toast('আবেদন খোলা হয়েছে — বাকি তথ্য দিয়ে সাবমিট করুন'); nav(`/app/hr/employees/${id}`) }} />}
  </AppShell>
}

/** Records entered by mistake: they leave every list and their ID and mobile become free. Nothing is destroyed. */
function RemoveWrong({ list, onClose, onDone }: { list: Employee[]; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (!reason.trim()) return setErr('কারণ লিখুন')
    setBusy(true)
    let ok = 0; const bad: string[] = []
    for (const e of list) {
      try { await hr.removeWrongEntry(e.id, reason.trim()); ok++ } catch (x) { bad.push(`${e.employee_code ?? ''} ${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false)
    if (ok && !bad.length) return onDone(`${bn(ok)} জনের ভুল এন্ট্রি মোছা হয়েছে`)
    if (ok) onDone(`${bn(ok)} জনের মোছা হয়েছে, ${bn(bad.length)} জনের হয়নি: ${bad.join(' · ')}`)
    else setErr(bad.join(' · '))
  }
  return <Modal title="ভুল এন্ট্রি — মুছুন" onClose={onClose}
    actions={<><button type="button" className="secondary" onClick={onClose}>বাতিল</button><button type="button" className="danger" disabled={busy} onClick={() => void go()}>{busy ? 'হচ্ছে…' : 'মুছুন'}</button></>}>
    <Names list={list} />
    <p>ভুল করে ওঠা রেকর্ডের জন্য (ভুল লোক, একই লোক দুবার, পরীক্ষার এন্ট্রি)। রেকর্ডটি সব তালিকা থেকে সরে যাবে, আর তার আইডি ও মোবাইল নম্বর আবার ব্যবহার করা যাবে। লগইন থাকলে সেটা বন্ধ হবে।</p>
    <p className="muted small">কারো নামে হাজিরা, হিসাব, বেতন বা ছুটির রেকর্ড থাকলে তাঁকে এভাবে মোছা যাবে না — আইডি ভুল হলে প্রোফাইল থেকে “আইডি সংশোধন” করুন। কিছুই চিরতরে মুছে যায় না; অডিট লগে থাকে।</p>
    <Field label="কারণ" required><input value={reason} onChange={e => setReason(e.target.value)} placeholder="যেমন: একই লোক দুবার উঠেছে" /></Field>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
