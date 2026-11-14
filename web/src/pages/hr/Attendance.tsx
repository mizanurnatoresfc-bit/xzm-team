import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Field, useLoad, useToast } from '../accounts/ui'
import { ATT_STATUS, bn, hr, hrFriendly, todayDhaka, type AttendanceRow, type AttendanceStatus, type AttendanceSummary } from '../../lib/hr'
import { DataTable } from '../../components/DataTable'
import { useOrg } from './common'

const MARKABLE: AttendanceStatus[] = ['present', 'late', 'half_day', 'absent', 'holiday', 'weekly_off']

export function Attendance() {
  const { can } = useAuth()
  const o = useOrg()
  const { toast, node } = useToast()
  const [tab, setTab] = useState<'day' | 'month'>('day')
  const [hub, setHub] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [month, setMonth] = useState(todayDhaka().slice(0, 7))
  useEffect(() => { if (!hub && o.data?.hubs[0]) setHub(o.data.hubs[0].id) }, [o.data, hub])
  const staff = useLoad(() => hub ? hr.employees({ hub, status: 'active', limit: 1000 }) : Promise.resolve([]), [hub])
  const day = useLoad(() => hr.attendanceDay(date, (staff.data ?? []).map(e => e.id)), [date, staff.data])
  const byEmp = useMemo(() => Object.fromEntries((day.data ?? []).map(r => [r.employee_id, r])), [day.data]) as Record<string, AttendanceRow>
  const sum = useLoad(() => tab === 'month' ? hr.attendanceSummary(`${month}-01`, hub || null) : Promise.resolve([]), [tab, month, hub])
  const [busyId, setBusyId] = useState(''); const [err, setErr] = useState('')
  const canMark = can('hr.attendance.create') || can('hr.attendance.edit')
  async function mark(emp: string, s: AttendanceStatus) {
    const ex = byEmp[emp]
    if (ex?.status === s) return
    if (ex?.status === 'leave') { setErr('অনুমোদিত ছুটি এখান থেকে বদলানো যায় না — ছুটির পাতা থেকে প্রত্যাহার করুন'); return }
    setBusyId(emp); setErr('')
    try { await hr.markAttendance(emp, date, s, ex); await day.reload() } catch (e) { setErr(hrFriendly(e)) } finally { setBusyId('') }
  }
  async function allPresent() {
    const todo = (staff.data ?? []).filter(e => !byEmp[e.id])
    for (const e of todo) { try { await hr.markAttendance(e.id, date, 'present') } catch (x) { setErr(hrFriendly(x)); break } }
    await day.reload(); toast(`${bn(todo.length)} জনকে উপস্থিত দেওয়া হয়েছে`)
  }
  const counts = MARKABLE.concat(['leave']).map(s => [s, (day.data ?? []).filter(r => r.status === s).length] as const)
  return <AppShell title="হাজিরা" subtitle="দৈনিক হাজিরা দিন, মাসের সারসংক্ষেপ দেখুন। ভবিষ্যতের তারিখে হাজিরা দেওয়া যায় না।">
    {node}
    <section className="da-filters panel no-print">
      <div className="da-seg">{(['day', 'month'] as const).map(t => <button key={t} className={tab === t ? '' : 'secondary'} onClick={() => setTab(t)}>{t === 'day' ? 'দৈনিক' : 'মাসিক'}</button>)}</div>
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>{tab === 'month' && <option value="">সব হাব</option>}
        {o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      {tab === 'day' ? <Field label="তারিখ"><input type="date" value={date} max={todayDhaka()} onChange={e => setDate(e.target.value)} /></Field>
        : <Field label="মাস"><input type="month" value={month} max={todayDhaka().slice(0, 7)} onChange={e => setMonth(e.target.value)} /></Field>}
    </section>
    {err && <p className="da-error">{err}</p>}
    {tab === 'day' ? <section className="panel">
      <div className="da-bar"><div className="da-mini">{counts.map(([s, n]) => <span key={s}>{ATT_STATUS[s]}: <strong>{bn(n)}</strong></span>)}
        <span>বাকি: <strong>{bn((staff.data?.length ?? 0) - (day.data?.length ?? 0))}</strong></span></div>
        {canMark && staff.data && staff.data.some(e => !byEmp[e.id]) && <button className="secondary sm" onClick={() => void allPresent()}>বাকি সবাই উপস্থিত</button>}</div>
      {staff.data && staff.data.length === 0 ? <p className="muted">এই হাবে কোনো সক্রিয় কর্মী নেই।</p> :
        <div className="da-table-wrap"><table className="da-table att-table"><thead><tr><th>আইডি</th><th>নাম</th><th>হাজিরা</th></tr></thead>
          <tbody>{staff.data?.map(e => { const r = byEmp[e.id]; return <tr key={e.id}><td><strong>{e.employee_code}</strong></td><td>{e.full_name}</td>
            <td>{r?.status === 'leave' ? <span className="da-badge b-info">ছুটি (অনুমোদিত)</span> : canMark ? <div className="att-btns">{MARKABLE.map(s =>
              <button key={s} className={`secondary att-${s}${r?.status === s ? ' on' : ''}`} aria-pressed={r?.status === s} disabled={busyId === e.id} onClick={() => void mark(e.id, s)}>{ATT_STATUS[s]}</button>)}</div>
              : r ? ATT_STATUS[r.status] : <span className="muted">দেওয়া হয়নি</span>}</td></tr> })}</tbody></table></div>}
    </section> : <section className="panel">
      {sum.error ? <p className="da-error">{hrFriendly(sum.error)}</p> : <DataTable title={`মাসিক হাজিরা ${month}`} file={`attendance-${month}`} rows={sum.data} rowKey={r => r.employee_id}
        empty={<p className="muted">কোনো তথ্য নেই।</p>} cols={[
          { key: 'employee_code', label: 'আইডি', render: r => <strong>{r.employee_code}</strong> }, { key: 'full_name', label: 'নাম' },
          ...(['present', 'late', 'half_day', 'absent', 'leave', 'holiday', 'weekly_off', 'not_recorded'] as const).map((k, i) => ({ key: k, className: 'r',
            label: ['উপস্থিত', 'দেরি', 'অর্ধদিবস', 'অনুপস্থিত', 'ছুটি', 'ছুটির দিন', 'সাপ্তাহিক', 'দেওয়া হয়নি'][i], value: (r: AttendanceSummary) => r[k],
            render: (r: AttendanceSummary) => <span className={k === 'not_recorded' && r[k] ? 'bad' : ''}>{bn(r[k])}</span> })),
        ]} />}
    </section>}
  </AppShell>
}
