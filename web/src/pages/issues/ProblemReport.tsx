import { useState } from 'react'
import { DataTable, type Col } from '../../components/DataTable'
import { PersonPicker, type RefPerson } from '../../components/PersonPicker'
import { todayDhaka } from '../../lib/hr'
import { ISSUE_REPORT_LIMIT, KIND_BN, PRIORITY_BN, issueHistory, type GroupHub, type IssueHistoryRow } from '../../lib/issues'
import { dhakaInstant, type ProblemView } from '../../lib/problemCenter'
import { Field, useLoad } from '../accounts/ui'

const STATUS = { open: 'নতুন', in_progress: 'কাজ চলছে', solved: 'যাচাই বাকি', approved: 'অনুমোদিত', cancelled: 'বাতিল' }
const QUEUE = { unresolved: 'অমীমাংসিত', late: 'সময় পার হয়েছে', review: 'যাচাই বাকি', returned: 'ফেরত দেওয়া হয়েছে' }
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => <option key={value} value={value}>{label}</option>)
const dhaka = (value: string | null) => value ? new Date(value).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' }) : ''
const nextDay = (day: string) => new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)

export function ProblemReport({ view, hubs, onOpen, revision }: { view: ProblemView; hubs: GroupHub[]; onOpen: (id: string) => void; revision: number }) {
  const [filters, setFilters] = useState({ start: '', end: '', hub: '', kind: '', priority: '', status: '', queue: '' })
  const [person, setPerson] = useState<RefPerson | null>(null)
  const select = (field: keyof typeof filters, value: string) => setFilters(previous => ({ ...previous, [field]: value }))
  const { start, end, hub, kind, priority, status, queue } = filters
  const employee = person?.kind === 'employee' ? person.id : undefined
  const invalidRange = !!start && !!end && start > end
  const report = useLoad(() => invalidRange ? Promise.resolve(null) : issueHistory({
    from: start ? dhakaInstant(start + 'T00:00') : undefined,
    through: end ? dhakaInstant(nextDay(end) + 'T00:00') : undefined,
    hub, employee, kind, priority, status: view === 'resolved' ? 'approved' : view === 'working' ? 'in_progress' : status,
    queue: view === 'unassigned' || view === 'late' ? view : queue,
  }), [start, end, hub, employee, kind, priority, status, queue, view, revision])
  function period(kind: 'day' | 'week' | 'month') {
    const today = todayDhaka()
    const date = new Date(today)
    if (kind === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
    if (kind === 'month') date.setUTCDate(1)
    setFilters(previous => ({ ...previous, start: date.toISOString().slice(0, 10), end: today }))
  }
  const hubName = (r: IssueHistoryRow) => r.hub_info?.name ?? hubs.find(h => h.hub_id === r.hub_id)?.hub_name ?? r.hub_id
  const employeeName = (r: IssueHistoryRow) => r.employee_info?.full_name ?? (r.assignee_id ? 'নাম দেখার অনুমতি নেই' : 'দায়িত্ব দেওয়া হয়নি')
  const rows = report.data?.rows ?? []
  const groupKey = view === 'hub-report' ? 'hub_id' : 'assignee_id'
  const groupCounts = new Map<string | null, { name: string; count: number }>()
  for (const row of rows) {
    const key = row[groupKey]
    const current = groupCounts.get(key)
    groupCounts.set(key, { name: view === 'hub-report' ? hubName(row) : employeeName(row), count: (current?.count ?? 0) + 1 })
  }
  const cols: Col<IssueHistoryRow>[] = [
    { key: 'issue_no', label: 'সমস্যা আইডি', render: r => <button type="button" className="link" onClick={() => onOpen(r.id)}>{r.issue_no}</button> },
    { key: 'title', label: 'সমস্যা' },
    { key: 'hub', label: 'হাব', value: hubName },
    { key: 'employee', label: 'দায়িত্বপ্রাপ্ত', value: employeeName },
    { key: 'kind', label: 'ক্যাটাগরি', value: r => KIND_BN[r.kind] },
    { key: 'priority', label: 'গুরুত্ব', value: r => PRIORITY_BN[r.priority] },
    { key: 'status', label: 'অবস্থা', value: r => STATUS[r.status] },
    { key: 'created', label: 'তৈরি', value: r => dhaka(r.created_at) },
    { key: 'due', label: 'শেষ সময়', value: r => dhaka(r.due_at) },
    { key: 'reopen_count', label: 'ফেরত দেওয়ার সংখ্যা' },
  ]
  return <section aria-label="সমস্যার রিপোর্ট">
    <div className="mg-chips">
      <button type="button" className="mg-chip" onClick={() => period('day')}>আজ</button>
      <button type="button" className="mg-chip" onClick={() => period('week')}>এই সপ্তাহ</button>
      <button type="button" className="mg-chip" onClick={() => period('month')}>এই মাস</button>
    </div>
    <div className="da-form">
      <Field label="শুরুর তারিখ"><input type="date" value={start} onChange={e => select('start', e.target.value)} /></Field>
      <Field label="শেষ তারিখ"><input type="date" value={end} onChange={e => select('end', e.target.value)} /></Field>
      <Field label="হাব"><select value={hub} onChange={e => select('hub', e.target.value)}><option value="">সব দৃশ্যমান হাব</option>{hubs.map(h => <option key={h.hub_id} value={h.hub_id}>{h.hub_name}</option>)}</select></Field>
      <Field label="দায়িত্বপ্রাপ্ত"><PersonPicker value={person} onChange={setPerson} /></Field>
      <Field label="ক্যাটাগরি"><select value={kind} onChange={e => select('kind', e.target.value)}><option value="">সব ক্যাটাগরি</option>{options(KIND_BN)}</select></Field>
      <Field label="গুরুত্ব"><select value={priority} onChange={e => select('priority', e.target.value)}><option value="">সব গুরুত্ব</option>{options(PRIORITY_BN)}</select></Field>
      {['history', 'hub-report', 'employee-report'].includes(view) && <>
        <Field label="অবস্থা"><select value={status} onChange={e => select('status', e.target.value)}><option value="">সব অবস্থা</option>{options(STATUS)}</select></Field>
        <Field label="রিপোর্টের ধরন"><select value={queue} onChange={e => select('queue', e.target.value)}><option value="">সব সমস্যা</option>{options(QUEUE)}</select></Field>
      </>}
    </div>
    {invalidRange ? <p role="alert">শেষ তারিখ শুরুর তারিখের পরে বা একই দিনে দিন।</p>
      : report.loading ? <p role="status">রিপোর্ট লোড হচ্ছে…</p>
      : report.error ? <p role="alert">রিপোর্ট লোড হয়নি। <button type="button" className="link" onClick={() => void report.reload()}>আবার চেষ্টা করুন</button></p>
      : <>
        {report.data?.truncated && <p role="status">সাম্প্রতিক {ISSUE_REPORT_LIMIT}টি ফল দেখানো হচ্ছে। সম্পূর্ণ হিসাবের জন্য ফিল্টার সংকুচিত করুন।</p>}
        {(view === 'hub-report' || view === 'employee-report') && groupCounts.size > 0 && <ul>{[...groupCounts].map(([key, group]) => <li key={key ?? 'unassigned'}>{group.name} · {group.count}</li>)}</ul>}
        <DataTable title="সমস্যার রিপোর্ট" file="problem-center" rows={rows} cols={cols} rowKey={r => r.id} phoneView="list" quickFilters={false} canPrint={!report.data?.truncated} canExport={!report.data?.truncated} />
      </>}
  </section>
}
