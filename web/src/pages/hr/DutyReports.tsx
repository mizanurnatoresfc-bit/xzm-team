import { useMemo, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { DataTable, type Col } from '../../components/DataTable'
import { usePrefs } from '../../lib/prefs'
import { Field, useLoad } from '../accounts/ui'
import { supabase } from '../../lib/supabase'
import { useOrg } from './common'

/**
 * XZM-013 Phase 2B — দায়িত্ব রিপোর্ট।
 * Six report views sharing a common filter bar (date range · zone · hub · employee · status).
 * Backed by existing tables only: tasks + employees + hubs + zones + job_duties.
 * Print and Excel export are done through DataTable, which already matches the site-wide pattern.
 */
type ReportKind = 'daily' | 'by_staff' | 'by_hub' | 'by_manager' | 'incomplete' | 'monthly_perf'

type Row = {
  id: string; task_no: string | null; title: string; status: string; due_date: string
  hub_id: string | null; hub_name?: string | null; zone_id: string | null; zone_name?: string | null
  assigned_to: string; assignee_name?: string | null; assignee_code?: string | null
  completed_at?: string | null; submitted_at?: string | null; progress_note?: string | null; created_at: string
}

const STATUS_LBL: Record<string, [string, string]> = {
  assigned: ['দেওয়া হয়েছে', 'Assigned'], in_progress: ['চলছে', 'In progress'], submitted: ['জমা', 'Submitted'],
  completed: ['সম্পন্ন', 'Completed'], cancelled: ['বাতিল', 'Cancelled'],
}
const todayDhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const shift = (iso: string, days: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

export function DutyReports() {
  const { L, n } = usePrefs()
  const o = useOrg()
  const [kind, setKind] = useState<ReportKind>('daily')
  const today = todayDhaka()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [zone, setZone] = useState('')
  const [hub, setHub] = useState('')
  const [emp, setEmp] = useState('')
  const [status, setStatus] = useState<'' | keyof typeof STATUS_LBL>('')

  // Default date ranges per report kind
  function setKindSmart(k: ReportKind) {
    setKind(k)
    if (k === 'daily') { setFrom(today); setTo(today) }
    else if (k === 'monthly_perf') { setFrom(today.slice(0, 8) + '01'); setTo(today) }
    else { setFrom(shift(today, -7)); setTo(today) }
  }

  const hubs = (o.data?.hubs ?? []).filter(h => !zone || h.zone_id === zone)

  const rowsQ = useLoad(async () => {
    // Pull tasks in the window; for monthly performance we aggregate client-side so the single query serves every tab.
    // Zone scoping is applied via hub_ids (not a tasks.zone_id column, which may not exist on every env).
    const hubsInZone = (o.data?.hubs ?? []).filter(h => !zone || h.zone_id === zone)
    let q = supabase.from('tasks').select('id, task_no, title, status, due_date, hub_id, assigned_to, progress_note, created_at')
      .gte('due_date', from).lte('due_date', to).limit(5000)
    if (hub) q = q.eq('hub_id', hub)
    else if (zone) q = q.in('hub_id', hubsInZone.map(h => h.id))
    if (emp) q = q.eq('assigned_to', emp)
    if (status) q = q.eq('status', status)
    if (kind === 'incomplete') q = q.in('status', ['assigned', 'in_progress'])
    const { data, error } = await q
    if (error) throw error
    const ids = Array.from(new Set((data ?? []).map((r: { assigned_to: string }) => r.assigned_to)))
    const empMap: Record<string, { name: string; code: string | null }> = {}
    if (ids.length) {
      const { data: ppl } = await supabase.from('employees').select('id, full_name, employee_code').in('id', ids)
      ;(ppl ?? []).forEach((e: { id: string; full_name: string; employee_code: string | null }) => { empMap[e.id] = { name: e.full_name, code: e.employee_code } })
    }
    const hubMap = Object.fromEntries((o.data?.hubs ?? []).map(h => [h.id, { name: h.name, zone_id: h.zone_id }]))
    const zoneMap = Object.fromEntries((o.data?.zones ?? []).map(z => [z.id, z.name]))
    return ((data ?? []) as Array<Omit<Row, 'hub_name' | 'zone_name' | 'assignee_name' | 'assignee_code' | 'zone_id'>>).map(r => {
      const hubInfo = r.hub_id ? hubMap[r.hub_id] : null
      return {
        ...r,
        assignee_name: empMap[r.assigned_to]?.name ?? null,
        assignee_code: empMap[r.assigned_to]?.code ?? null,
        hub_name: hubInfo?.name ?? null,
        zone_id: hubInfo?.zone_id ?? null,
        zone_name: hubInfo?.zone_id ? zoneMap[hubInfo.zone_id] ?? null : null,
      }
    }) as Row[]
  }, [from, to, zone, hub, emp, status, kind, o.data])

  const rows = rowsQ.data ?? []

  // Hub-aggregated and manager-aggregated and monthly-perf views are derived from the same rows
  const hubAgg = useMemo(() => {
    const by: Record<string, { hub: string; total: number; done: number; pending: number; overdue: number }> = {}
    for (const r of rows) {
      const k = r.hub_name ?? '—'
      by[k] = by[k] ?? { hub: k, total: 0, done: 0, pending: 0, overdue: 0 }
      by[k].total++
      if (r.status === 'completed' || r.status === 'submitted') by[k].done++
      else if (r.due_date < today) by[k].overdue++
      else by[k].pending++
    }
    return Object.values(by).sort((a, b) => a.hub.localeCompare(b.hub))
  }, [rows, today])

  const monthlyPerf = useMemo(() => {
    const by: Record<string, { name: string; code: string | null; total: number; done: number; overdue: number; rate: number }> = {}
    for (const r of rows) {
      const k = r.assigned_to
      by[k] = by[k] ?? { name: r.assignee_name ?? '—', code: r.assignee_code ?? null, total: 0, done: 0, overdue: 0, rate: 0 }
      by[k].total++
      if (r.status === 'completed' || r.status === 'submitted') by[k].done++
      else if (r.due_date < today) by[k].overdue++
    }
    return Object.values(by).map(x => ({ ...x, rate: x.total ? Math.round((x.done / x.total) * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate || b.done - a.done)
  }, [rows, today])

  const commonCols: Col<Row>[] = [
    { key: 'due_date', label: L('তারিখ', 'Date'), primary: true },
    { key: 'title', label: L('দায়িত্ব', 'Duty'), render: r => <b>{r.title}</b> },
    { key: 'assignee', label: L('কর্মী', 'Staff'), value: r => r.assignee_name ?? '', render: r => r.assignee_code ? `${r.assignee_name ?? ''} · ${r.assignee_code}` : (r.assignee_name ?? '—') },
    { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name ?? '', render: r => r.hub_name ?? '—' },
    { key: 'status', label: L('অবস্থা', 'Status'), value: r => L(...(STATUS_LBL[r.status] ?? [r.status, r.status])), render: r => L(...(STATUS_LBL[r.status] ?? [r.status, r.status])) },
    { key: 'note', label: L('নোট', 'Note'), value: r => r.progress_note ?? '', hidden: false },
  ]
  const hubCols: Col<typeof hubAgg[number]>[] = [
    { key: 'hub', label: L('হাব', 'Hub'), primary: true },
    { key: 'total', label: L('মোট', 'Total'), render: r => n(r.total) },
    { key: 'done', label: L('সম্পন্ন', 'Done'), render: r => n(r.done) },
    { key: 'pending', label: L('অপেক্ষায়', 'Pending'), render: r => n(r.pending) },
    { key: 'overdue', label: L('সময় শেষ', 'Overdue'), render: r => n(r.overdue) },
  ]
  const perfCols: Col<typeof monthlyPerf[number]>[] = [
    { key: 'name', label: L('কর্মী', 'Staff'), primary: true, render: r => r.code ? `${r.name} · ${r.code}` : r.name },
    { key: 'total', label: L('মোট দায়িত্ব', 'Total'), render: r => n(r.total) },
    { key: 'done', label: L('সম্পন্ন', 'Done'), render: r => n(r.done) },
    { key: 'overdue', label: L('সময় শেষ', 'Overdue'), render: r => n(r.overdue) },
    { key: 'rate', label: L('সফলতা %', 'Rate %'), render: r => n(r.rate) + '%' },
  ]

  const tabs: Array<[ReportKind, string, string]> = [
    ['daily', 'দৈনিক', 'Daily'], ['by_staff', 'কর্মী অনুযায়ী', 'By staff'], ['by_hub', 'হাব অনুযায়ী', 'By hub'],
    ['by_manager', 'ম্যানেজারের দায়িত্ব', "Manager's duty"], ['incomplete', 'অসম্পূর্ণ', 'Incomplete'], ['monthly_perf', 'মাসিক পারফরম্যান্স', 'Monthly performance'],
  ]

  return <AppShell title={L('দায়িত্ব রিপোর্ট', 'Duty reports')}
    subtitle={L('তারিখ, হাব, জোন, কর্মী ও অবস্থা দিয়ে ছেঁকে দেখুন। প্রিন্ট ও Excel বিদ্যমান ডেটা টেবিলের মাধ্যমে।',
      'Filter by date, hub, zone, staff and status. Print and Excel use the existing data table.')}>
    <nav className="emp-tabs no-print" role="tablist">
      {tabs.map(([k, b, e]) =>
        <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKindSmart(k)}><Icon name="chart" size={16} />{L(b, e)}</button>)}
    </nav>

    <section className="da-filters panel no-print">
      <Field label={L('শুরু', 'From')}><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label={L('শেষ', 'To')}><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      <Field label={L('জোন', 'Zone')}><select value={zone} onChange={e => { setZone(e.target.value); setHub('') }}>
        <option value="">{L('সব জোন', 'All zones')}</option>{(o.data?.zones ?? []).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
      <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => setHub(e.target.value)}>
        <option value="">{L('সব হাব', 'All hubs')}</option>{hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label={L('কর্মী আইডি', 'Staff ID')}><input value={emp} onChange={e => setEmp(e.target.value)} placeholder={L('ঐচ্ছিক', 'Optional')} /></Field>
      <Field label={L('অবস্থা', 'Status')}><select value={status} onChange={e => setStatus(e.target.value as '' | keyof typeof STATUS_LBL)}>
        <option value="">{L('সব', 'All')}</option>{Object.entries(STATUS_LBL).map(([k, v]) => <option key={k} value={k}>{L(...v)}</option>)}</select></Field>
    </section>

    {rowsQ.loading && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
    {rowsQ.error && <p className="da-error">{(rowsQ.error as Error).message}</p>}

    {kind === 'by_hub' && <DataTable<typeof hubAgg[number]> title={L('হাব অনুযায়ী দায়িত্ব', 'Duty by hub')} rows={hubAgg} cols={hubCols} rowKey={r => r.hub} file={`duty-by-hub-${from}-${to}`} phoneView="list" />}
    {kind === 'monthly_perf' && <DataTable<typeof monthlyPerf[number]> title={L('মাসিক পারফরম্যান্স', 'Monthly performance')} rows={monthlyPerf} cols={perfCols} rowKey={r => r.name + (r.code ?? '')} file={`duty-perf-${from}-${to}`} phoneView="list" />}
    {kind !== 'by_hub' && kind !== 'monthly_perf' && <DataTable<Row> title={tabs.find(t => t[0] === kind)![1]} rows={rows} cols={commonCols} rowKey={r => r.id} file={`duty-${kind}-${from}-${to}`} phoneView="list" />}
  </AppShell>
}
