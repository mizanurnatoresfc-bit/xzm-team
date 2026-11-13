import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { DataTable } from '../../components/DataTable'
import { LEAVE_STATUS, bn, dmy, hr, hrFriendly, todayDhaka, type LeaveRequest } from '../../lib/hr'

export function Leave() {
  const { can } = useAuth()
  const { toast, node } = useToast()
  const [status, setStatus] = useState('pending')
  const reqs = useLoad(() => hr.leaveRequests(status || undefined), [status])
  const types = useLoad(() => hr.leaveTypes(), [])
  const emps = useLoad(() => hr.employees({ status: 'active', limit: 1000 }), [])
  const empById = useMemo(() => Object.fromEntries((emps.data ?? []).map(e => [e.id, e])), [emps.data])
  const typeById = useMemo(() => Object.fromEntries((types.data ?? []).map(t => [t.id, t])), [types.data])
  const [newOpen, setNewOpen] = useState(false)
  const [decide, setDecide] = useState<{ r: LeaveRequest; mode: 'approve' | 'reject' | 'cancel' } | null>(null)
  const [f, setF] = useState({ employee: '', type: '', from: todayDhaka(), to: todayDhaka(), reason: '', note: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function create() {
    setErr('')
    if (!f.employee || !f.type) return setErr('কর্মী ও ছুটির ধরন বেছে নিন')
    if (f.to < f.from) return setErr('শেষ তারিখ শুরুর আগে হতে পারে না')
    if (!f.reason.trim()) return setErr('কারণ লিখুন')
    setBusy(true)
    try { await hr.requestLeave({ employee_id: f.employee, leave_type_id: f.type, from_date: f.from, to_date: f.to, reason: f.reason.trim() }); toast('ছুটির অনুরোধ পাঠানো হয়েছে'); setNewOpen(false); await reqs.reload() }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function act() {
    if (!decide) return
    setErr('')
    if (decide.mode !== 'approve' && !f.note.trim()) return setErr('কারণ লিখুন')
    setBusy(true)
    try {
      if (decide.mode === 'cancel') await hr.cancelLeave(decide.r.id, f.note.trim())
      else await hr.decideLeave(decide.r.id, decide.mode === 'approve', f.note.trim() || null)
      toast({ approve: 'ছুটি অনুমোদিত — হাজিরায় ছুটি হিসেবে বসেছে', reject: 'ছুটির অনুরোধ বাতিল', cancel: 'ছুটি প্রত্যাহার করা হয়েছে' }[decide.mode]); setDecide(null); await reqs.reload()
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  return <AppShell title="ছুটি" subtitle="ছুটির অনুরোধ, অনুমোদন ও বাতিল। অনুমোদিত ছুটি নিজে থেকেই হাজিরায় বসে যায়।"
    actions={can('hr.leave.create') ? <button onClick={() => { setErr(''); setF({ ...f, reason: '' }); setNewOpen(true) }}>+ ছুটির অনুরোধ</button> : null}>
    {node}
    <section className="da-filters panel no-print"><Field label="অবস্থা"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">সব</option>
      {(Object.keys(LEAVE_STATUS) as LeaveRequest['status'][]).map(s => <option key={s} value={s}>{LEAVE_STATUS[s][0]}</option>)}</select></Field></section>
    {reqs.error ? <p className="da-error">{hrFriendly(reqs.error)}</p> : null}
    <section className="panel">
      <DataTable title="ছুটির অনুরোধ" file="leave" rows={reqs.data} rowKey={r => r.id} empty={<p className="muted">কোনো অনুরোধ নেই।</p>} cols={[
        { key: 'emp', label: 'কর্মী', value: r => empById[r.employee_id]?.full_name ?? '', render: r => <><strong>{empById[r.employee_id]?.full_name ?? '…'}</strong>{empById[r.employee_id]?.employee_code && <span className="sec">আইডি {empById[r.employee_id]?.employee_code}</span>}</> },
        { key: 'type', label: 'ধরন', value: r => typeById[r.leave_type_id]?.name ?? '' },
        { key: 'dates', label: 'তারিখ', value: r => `${dmy(r.from_date)} – ${dmy(r.to_date)}` },
        { key: 'days', label: 'দিন', className: 'r', value: r => r.days, render: r => bn(r.days) },
        { key: 'reason', label: 'কারণ', value: r => r.reason ?? '', render: r => <>{r.reason ?? ''}{r.decision_note && <span className="sec">নোট: {r.decision_note}</span>}</> },
        { key: 'status', label: 'অবস্থা', value: r => LEAVE_STATUS[r.status][0], render: r => <Badge tone={LEAVE_STATUS[r.status][1]}>{LEAVE_STATUS[r.status][0]}</Badge> },
        { key: 'act', label: '', noExport: true, className: 'r no-print', render: r => <div className="row" style={{ justifyContent: 'flex-end' }}>
          {r.status === 'pending' && can('hr.leave.approve') && <button className="sm" onClick={() => { setErr(''); setF({ ...f, note: '' }); setDecide({ r, mode: 'approve' }) }}>অনুমোদন</button>}
          {r.status === 'pending' && can('hr.leave.reject') && <button className="secondary sm" onClick={() => { setErr(''); setF({ ...f, note: '' }); setDecide({ r, mode: 'reject' }) }}>বাতিল</button>}
          {(r.status === 'pending' || r.status === 'approved') && <button className="secondary sm" onClick={() => { setErr(''); setF({ ...f, note: '' }); setDecide({ r, mode: 'cancel' }) }}>প্রত্যাহার</button>}</div> },
      ]} />
    </section>
    {newOpen && <Modal title="ছুটির অনুরোধ" onClose={() => setNewOpen(false)} actions={<><button className="secondary" onClick={() => setNewOpen(false)}>বাতিল</button><button disabled={busy} onClick={() => void create()}>পাঠান</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="কর্মী" wide><select value={f.employee} onChange={e => setF({ ...f, employee: e.target.value })}><option value="">বেছে নিন…</option>
          {emps.data?.map(e => <option key={e.id} value={e.id}>{e.employee_code} · {e.full_name}</option>)}</select></Field>
        <Field label="ছুটির ধরন"><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="">বেছে নিন…</option>
          {types.data?.map(t => <option key={t.id} value={t.id}>{t.name_bn || t.name} ({bn(t.annual_quota)} দিন/বছর)</option>)}</select></Field>
        <div />
        <Field label="শুরু"><input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="শেষ"><input type="date" value={f.to} min={f.from} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="কারণ" wide><textarea rows={2} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {decide && <Modal title={{ approve: 'ছুটি অনুমোদন', reject: 'ছুটির অনুরোধ বাতিল', cancel: 'ছুটি প্রত্যাহার' }[decide.mode]} onClose={() => setDecide(null)}
      actions={<><button className="secondary" onClick={() => setDecide(null)}>না</button><button className={decide.mode === 'approve' ? '' : 'danger'} disabled={busy} onClick={() => void act()}>হ্যাঁ, নিশ্চিত</button></>}>
      <p><strong>{empById[decide.r.employee_id]?.full_name}</strong> · {dmy(decide.r.from_date)} – {dmy(decide.r.to_date)} ({bn(decide.r.days)} দিন)</p>
      <Field label={decide.mode === 'approve' ? 'নোট (ঐচ্ছিক)' : 'কারণ (আবশ্যক)'}><textarea rows={3} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </AppShell>
}
