import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { useLoad, useToast } from '../accounts/ui'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { bn, dmy, EMP_STATUS, hr, hrFriendly, type Employee, type EmployeeStatus } from '../../lib/hr'
import { ExportByFormat } from '../../components/ExportByFormat'
import { EmpBadge, NewApplication, useOrg } from './common'

const TONES = ['g', 'b', 'o', 'p', 'c', 'r']
const toneOf = (s: string) => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]
const initials = (n: string) => n.replace(/^(md\.?|mohammad|mohammed|mst\.?)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
const qs = () => new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
const STATUS_TABS: Array<[string, string]> = [['active', 'সক্রিয়'], ['applicant', 'আইডির অপেক্ষায়'], ['inactive', 'নিষ্ক্রিয়'], ['', 'সব']]

export function Employees() {
  const { can } = useAuth()
  const nav = useNavigate()
  const o = useOrg()
  const [q, setQ] = useState(() => qs().get('q') ?? '')
  const [hub, setHub] = useState('')
  const [status, setStatus] = useState(() => (qs().get('q') ? '' : 'active'))
  const [mode, setMode] = useState<'cards' | 'table'>(() => { try { return (localStorage.getItem('xzm_emp_view') as 'cards' | 'table') || 'cards' } catch { return 'cards' } })
  // One load for every status: the chips show live counts and switching is instant.
  const list = useLoad(() => hr.employees({ q, hub: hub || undefined, limit: 2000 }), [q, hub])
  const [open, setOpen] = useState(false)
  const { toast, node } = useToast()
  const all = list.data ?? []
  const rows = useMemo(() => all.filter(e => !status || e.status === status || (status === 'inactive' && ['inactive', 'resigned', 'terminated'].includes(e.status))), [all, status])
  const count = (s: string) => all.filter(e => !s || e.status === s || (s === 'inactive' && ['inactive', 'resigned', 'terminated'].includes(e.status))).length
  const setView = (m: 'cards' | 'table') => { setMode(m); try { localStorage.setItem('xzm_emp_view', m) } catch { /* ignore */ } }
  const hubName = (e: Employee) => (e.hub_id ? o.names.hub[e.hub_id] ?? '' : '')
  const posName = (e: Employee) => (e.position_id ? o.names.pos[e.position_id] ?? '' : '')

  return <AppShell title="কর্মী" subtitle="আপনার এলাকার সব কর্মী। এমপ্লয়ি আইডি শুধু আবেদন অনুমোদনের সময় দেওয়া হয়।"
    actions={<><ExportByFormat zone={null} hub={hub || null} status={status || null} q={q || null} title="কর্মী তালিকা" />
      {can('hr.application.create') && <button onClick={() => setOpen(true)}>+ নতুন আইডি আবেদন</button>}</>}>
    {node}
    <section className="emp-filter no-print">
      <label className="emp-search"><Icon name="search" size={18} />
        <input type="search" placeholder="নাম, আইডি বা মোবাইল দিয়ে খুঁজুন…" value={q} onChange={e => setQ(e.target.value)} />
        {q && <button type="button" className="icon-btn" aria-label="মুছুন" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}</label>
      <select className="emp-hub" value={hub} onChange={e => setHub(e.target.value)} aria-label="হাব"><option value="">সব হাব</option>
        {o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      <div className="emp-status">{STATUS_TABS.map(([k, l]) => <button key={k || 'all'} type="button" className={`chip-toggle${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>
        {l} <b>{bn(count(k))}</b></button>)}</div>
      <div className="seg emp-mode"><button type="button" className={mode === 'cards' ? 'on' : ''} onClick={() => setView('cards')} aria-label="কার্ড"><Icon name="grid" size={16} /></button>
        <button type="button" className={mode === 'table' ? 'on' : ''} onClick={() => setView('table')} aria-label="টেবিল"><Icon name="table" size={16} /></button></div>
    </section>
    {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : null}
    {list.loading && !list.data ? <div className="emp-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="emp-card sk" />)}</div> : null}
    {list.data && (mode === 'cards' ? <>
      <div className="emp-count">{bn(rows.length)} জন{status ? ` · ${STATUS_TABS.find(t => t[0] === status)?.[1] ?? ''}` : ''}</div>
      {!rows.length ? <section className="panel"><p className="muted">কোনো কর্মী পাওয়া যায়নি।</p></section> :
        <div className="emp-grid">{rows.map(e => <article key={e.id} className="emp-card" onClick={() => nav(`/app/hr/employees/${e.id}`)} role="link" tabIndex={0}
          onKeyDown={ev => { if (ev.key === 'Enter') nav(`/app/hr/employees/${e.id}`) }}>
          <div className={`ec-av t-${toneOf(e.full_name)}`}>{initials(e.full_name)}</div>
          <div className="ec-main">
            <div className="ec-top"><b className="ec-name">{e.full_name}</b>{e.employee_code ? <span className="ec-id">#{e.employee_code}</span> : <span className="ec-id wait">আইডি বাকি</span>}</div>
            <div className="ec-meta">{posName(e) && <span><Icon name="user" size={13} />{posName(e)}</span>}{hubName(e) && <span><Icon name="hub" size={13} />{hubName(e)}</span>}</div>
            <div className="ec-foot"><EmpBadge status={e.status} />{e.joining_date && <span className="muted small">যোগদান {dmy(e.joining_date)}</span>}</div>
          </div>
          {e.mobile && <a className="ec-call" href={`tel:${e.mobile}`} onClick={ev => ev.stopPropagation()} aria-label={`কল ${e.mobile}`}><Icon name="cc" size={18} /></a>}
        </article>)}</div>}
    </> : <section className="panel">
      <DataTable title="কর্মী তালিকা" file="employees" rows={rows} rowKey={e => e.id} onRowClick={e => nav(`/app/hr/employees/${e.id}`)}
        empty={<p className="muted">কোনো কর্মী পাওয়া যায়নি।</p>} cols={[
          { key: 'employee_code', label: 'আইডি', render: e => <strong>{e.employee_code ?? '—'}</strong> },
          { key: 'full_name', label: 'নাম', render: e => <span className="emp-tname"><span className={`ec-av sm t-${toneOf(e.full_name)}`}>{initials(e.full_name)}</span><span>{e.full_name}{e.full_name_bn && <span className="sec">{e.full_name_bn}</span>}</span></span> },
          { key: 'mobile', label: 'মোবাইল' },
          { key: 'hub', label: 'হাব', value: hubName },
          { key: 'pos', label: 'পদবি', value: posName },
          { key: 'join', label: 'যোগদান', value: e => dmy(e.joining_date) },
          { key: 'status', label: 'অবস্থা', value: e => EMP_STATUS[e.status as EmployeeStatus]?.[0] ?? e.status, render: e => <EmpBadge status={e.status} /> },
        ]} />
    </section>)}
    {open && <NewApplication onClose={() => setOpen(false)} onDone={id => { toast('আবেদন খোলা হয়েছে — বাকি তথ্য দিয়ে সাবমিট করুন'); nav(`/app/hr/employees/${id}`) }} />}
  </AppShell>
}
