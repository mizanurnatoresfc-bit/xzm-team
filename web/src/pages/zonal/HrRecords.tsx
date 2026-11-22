// HR records: every joining / exit / transfer file written on approval, with filters and the Excel download.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { EMP_STATUS, dmy, todayDhaka, type EmployeeStatus } from '../../lib/hr'
import { RECORD, downloadRecord, downloadRecords, lifeFriendly, lifecycle, type RecordFile, type RecordKind } from '../../lib/lifecycle'
import { usePrefs } from '../../lib/prefs'
import { Badge, Field, Stat, useLoad } from '../accounts/ui'
import { useOrg } from '../hr/common'

export function HrRecords() {
  const { L, n } = usePrefs()
  const o = useOrg()
  const [f, setF] = useState({ zone: '', hub: '', kind: '', status: '', from: todayDhaka().slice(0, 8) + '01', to: '' })
  const list = useLoad(() => lifecycle.records(f), [f.zone, f.hub, f.kind, f.status, f.from, f.to])
  const rows = list.data ?? []
  const hubs = useMemo(() => (o.data?.hubs ?? []).filter(h => !f.zone || h.zone_id === f.zone), [o.data, f.zone])
  const hubName = (id: string | null) => (id ? o.names.hub[id] ?? '' : '')
  const where = (r: RecordFile) => (r.kind === 'transfer' ? `${hubName(r.hub_id)} → ${hubName(r.to_hub_id)}` : hubName(r.hub_id))
  const count = (k: RecordKind) => rows.filter(r => r.kind === k).length

  return <AppShell title={L('HR রেকর্ড', 'HR records')}
    subtitle={L('অনুমোদনের সময় তৈরি হওয়া সব ফাইল — যোগদান, বিদায় (চূড়ান্ত হিসাবসহ) ও বদলি — কোম্পানির ফরম্যাটে।', 'Every file written on approval — joining, exit (with final accounts) and transfer — in the company format.')}
    actions={<><Link to="/app/zonal/requests" className="btn-ghost">{L('অনুরোধ ইনবক্স', 'Request inbox')}</Link>
      <button className="secondary" disabled={!rows.length} onClick={() => downloadRecords(rows, `HR-Records-${f.from || 'all'}${f.to ? `-${f.to}` : ''}.xlsx`)}>
        <Icon name="xls" size={16} />{L('সবগুলো এক ফাইলে নামান', 'Download all in one file')}</button></>}>
    <div className="da-stats">
      <Stat icon="file" label={L('মোট ফাইল', 'Files')} value={n(rows.length)} />
      <Stat icon="userplus" tone="ok" label={L('যোগদান', 'Joining')} value={n(count('joining'))} />
      <Stat icon="userx" tone={count('exit') ? 'bad' : undefined} label={L('বিদায়', 'Exit')} value={n(count('exit'))} />
      <Stat icon="swap" label={L('বদলি', 'Transfer')} value={n(count('transfer'))} />
    </div>
    <section className="da-filters panel no-print">
      {(o.data?.zones.length ?? 0) > 1 && <Field label={L('এরিয়া', 'Area')}><select value={f.zone} onChange={e => setF({ ...f, zone: e.target.value, hub: '' })}>
        <option value="">{L('সব এরিয়া', 'All areas')}</option>{o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
      <Field label={L('হাব', 'Hub')}><Combo value={f.hub} onChange={v => setF({ ...f, hub: v })} placeholder={L('সব হাব', 'All hubs')} options={hubs.map(h => ({ value: h.id, label: h.name }))} /></Field>
      <Field label={L('কাজের ধরন', 'Action')}><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
        <option value="">{L('সব', 'All')}</option>{(Object.keys(RECORD) as RecordKind[]).map(k => <option key={k} value={k}>{L(RECORD[k].bn, RECORD[k].en)}</option>)}</select></Field>
      <Field label={L('অবস্থা', 'Status')}><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
        <option value="">{L('সব', 'All')}</option>{(['active', 'resigned', 'terminated'] as EmployeeStatus[]).map(s => <option key={s} value={s}>{EMP_STATUS[s][0]}</option>)}</select></Field>
      <Field label={L('তারিখ থেকে', 'From')}><input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
      <Field label={L('তারিখ পর্যন্ত', 'To')}><input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
    </section>
    {list.error ? <p className="da-error">{lifeFriendly(list.error)}</p> : null}
    <section className="panel">
      <DataTable<RecordFile> title={L('HR রেকর্ড', 'HR records')} file="hr-records" rows={list.data} rowKey={r => r.id}
        empty={<p className="muted">{list.loading ? L('লোড হচ্ছে…', 'Loading…') : L('এই বাছাইয়ে কোনো ফাইল নেই।', 'No files match this selection.')}</p>}
        cols={[
          { key: 'no', label: L('নং', 'No'), value: r => r.record_no },
          { key: 'name', label: L('নাম', 'Name'), primary: true, value: r => r.employee_name },
          { key: 'code', label: L('আইডি', 'ID'), value: r => r.employee_code ?? '', render: r => <strong>{r.employee_code ?? '—'}</strong> },
          { key: 'hub', label: L('হাব', 'Hub'), value: where },
          { key: 'kind', label: L('কাজের ধরন', 'Action'), value: r => L(RECORD[r.kind].bn, RECORD[r.kind].en), render: r => <Badge tone={RECORD[r.kind].tone}>{L(RECORD[r.kind].bn, RECORD[r.kind].en)}</Badge> },
          { key: 'status', label: L('অবস্থা', 'Status'), value: r => EMP_STATUS[r.employee_status as EmployeeStatus]?.[0] ?? r.employee_status },
          { key: 'date', label: L('তারিখ', 'Date'), value: r => dmy(r.action_date) },
          { key: 'reason', label: L('কারণ', 'Reason'), value: r => r.reason ?? '' },
          { key: 'file', label: L('ফাইল', 'File'), noExport: true, render: r => <button className="sm" onClick={e => { e.stopPropagation(); downloadRecord(r) }} title={r.file_name}>
              <Icon name="xls" size={14} />{L('এক্সেল', 'Excel')}</button> },
        ]} />
    </section>
  </AppShell>
}
