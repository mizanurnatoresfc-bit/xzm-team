import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Field, useLoad, useToast } from '../accounts/ui'
import { DataTable } from '../../components/DataTable'
import { bn, dmy, EMP_STATUS, hr, hrFriendly, type EmployeeStatus } from '../../lib/hr'
import { ExportByFormat } from '../../components/ExportByFormat'
import { EmpBadge, NewApplication, useOrg } from './common'

export function Employees() {
  const { can } = useAuth()
  const nav = useNavigate()
  const o = useOrg()
  const [q, setQ] = useState(() => new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('q') ?? '')
  const [hub, setHub] = useState('')
  const [status, setStatus] = useState(() => new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('q') ? '' : 'active')
  const list = useLoad(() => hr.employees({ q, hub: hub || undefined, status: status || undefined }), [q, hub, status])
  const [open, setOpen] = useState(false)
  const { toast, node } = useToast()
  return <AppShell title="কর্মী" subtitle="আপনার এলাকার সব কর্মী। এমপ্লয়ি আইডি শুধু আবেদন অনুমোদনের সময় দেওয়া হয়।"
    actions={<><ExportByFormat zone={null} hub={hub || null} status={status || null} q={q || null} title="কর্মী তালিকা" />
      {can('hr.application.create') && <button onClick={() => setOpen(true)}>+ নতুন আইডি আবেদন</button>}</>}>
    {node}
    <section className="da-filters panel no-print">
      <Field label="খুঁজুন"><input placeholder="নাম, আইডি বা মোবাইল" value={q} onChange={e => setQ(e.target.value)} /></Field>
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}><option value="">সব হাব</option>
        {o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="অবস্থা"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">সব</option>
        {(Object.keys(EMP_STATUS) as EmployeeStatus[]).map(s => <option key={s} value={s}>{EMP_STATUS[s][0]}</option>)}</select></Field>
    </section>
    {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : null}
    <section className="panel">
      <div className="da-bar"><strong>{bn(list.data?.length ?? 0)} জন</strong>{list.loading && <span className="muted small">লোড হচ্ছে…</span>}</div>
      <DataTable title="কর্মী তালিকা" file="employees" rows={list.data} rowKey={e => e.id} onRowClick={e => nav(`/app/hr/employees/${e.id}`)}
        empty={<p className="muted">কোনো কর্মী পাওয়া যায়নি।</p>} cols={[
          { key: 'employee_code', label: 'আইডি', render: e => <strong>{e.employee_code ?? '—'}</strong> },
          { key: 'full_name', label: 'নাম', render: e => <>{e.full_name}{e.full_name_bn && <span className="sec">{e.full_name_bn}</span>}</> },
          { key: 'mobile', label: 'মোবাইল' },
          { key: 'hub', label: 'হাব', value: e => e.hub_id ? o.names.hub[e.hub_id] ?? '' : '' },
          { key: 'pos', label: 'পদবি', value: e => e.position_id ? o.names.pos[e.position_id] ?? '' : '' },
          { key: 'join', label: 'যোগদান', value: e => dmy(e.joining_date) },
          { key: 'status', label: 'অবস্থা', value: e => EMP_STATUS[e.status]?.[0] ?? e.status, render: e => <EmpBadge status={e.status} /> },
        ]} />
    </section>
    {open && <NewApplication onClose={() => setOpen(false)} onDone={id => { toast('আবেদন খোলা হয়েছে — বাকি তথ্য দিয়ে সাবমিট করুন'); nav(`/app/hr/employees/${id}`) }} />}
  </AppShell>
}
