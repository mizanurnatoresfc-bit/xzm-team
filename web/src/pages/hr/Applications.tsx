import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, useLoad } from '../accounts/ui'
import { APP_STATUS, dmy, hr, hrFriendly, type Application } from '../../lib/hr'
import { useOrg } from './common'
import { DataTable } from '../../components/DataTable'

export function Applications() {
  const nav = useNavigate()
  const o = useOrg()
  const [status, setStatus] = useState<string>('submitted')
  const apps = useLoad(() => hr.applications(status || undefined), [status])
  const emps = useLoad(() => hr.employees({ status: undefined, limit: 1000 }), [])
  const byId = useMemo(() => Object.fromEntries((emps.data ?? []).map(e => [e.id, e])), [emps.data])
  // An application whose person was removed from the list (archived) is not shown either.
  const rows = useMemo(() => apps.data && emps.data ? apps.data.filter(a => byId[a.employee_id]) : apps.data, [apps.data, emps.data, byId])
  return <AppShell title="এমপ্লয়ি আইডি আবেদন" subtitle="হাব থেকে আসা আবেদন যাচাই করে আইডি দিন, সংশোধনে ফেরত পাঠান বা বাতিল করুন।">
    <section className="da-filters panel no-print">
      <Field label="অবস্থা"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">সব</option>
        {(Object.keys(APP_STATUS) as Application['status'][]).map(s => <option key={s} value={s}>{APP_STATUS[s][0]}</option>)}</select></Field>
    </section>
    {apps.error ? <p className="da-error">{hrFriendly(apps.error)}</p> : null}
    <section className="panel">
      <DataTable title="এমপ্লয়ি আইডি আবেদন" file="id-applications" rows={rows} rowKey={a => a.id} onRowClick={a => nav(`/app/hr/employees/${a.employee_id}`)}
        empty={<p className="muted">এই অবস্থায় কোনো আবেদন নেই।</p>} cols={[
          { key: 'name', label: 'নাম', value: a => byId[a.employee_id]?.full_name ?? '', render: a => <><strong>{byId[a.employee_id]?.full_name ?? '…'}</strong>{byId[a.employee_id]?.employee_code && <span className="sec">আইডি {byId[a.employee_id]?.employee_code}</span>}</> },
          { key: 'mobile', label: 'মোবাইল', value: a => byId[a.employee_id]?.mobile ?? '' },
          { key: 'hub', label: 'হাব', value: a => { const e = byId[a.employee_id]; return e?.hub_id ? o.names.hub[e.hub_id] ?? '' : '' } },
          { key: 'created', label: 'খোলা হয়েছে', value: a => dmy(a.created_at) },
          { key: 'sent', label: 'পাঠানো হয়েছে', value: a => dmy(a.submitted_at) },
          { key: 'status', label: 'অবস্থা', value: a => APP_STATUS[a.status][0], render: a => <Badge tone={APP_STATUS[a.status][1]}>{APP_STATUS[a.status][0]}</Badge> },
        ]} />
    </section>
  </AppShell>
}
