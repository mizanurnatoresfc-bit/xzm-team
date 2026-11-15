import { useEffect, useMemo, useState } from 'react'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import { EMP_STATUS, hr, hrFriendly, hubLabel, nameMap, org, type EmployeeStatus } from '../../lib/hr'

/** Hubs, zones, departments and positions the user can see, plus id -> name maps. */
export function useOrg() {
  const q = useLoad(async () => {
    const [zones, hubsRaw, departments, positions] = await Promise.all([org.zones(), org.hubs(), org.departments(), org.positions()])
    // Hubs are shown with their number code everywhere ("Natore #80"); search by number works in every list.
    const hubs = hubsRaw.map(h => ({ ...h, name: hubLabel(h) }))
    return { zones, hubs, departments, positions }
  }, [])
  const names = useMemo(() => ({ zone: nameMap(q.data?.zones), hub: nameMap(q.data?.hubs), dept: nameMap(q.data?.departments), pos: nameMap(q.data?.positions) }), [q.data])
  return { ...q, names }
}

export function EmpBadge({ status }: { status: EmployeeStatus }) {
  const [label, tone] = EMP_STATUS[status] ?? [status, 'neutral']
  return <Badge tone={tone}>{label}</Badge>
}

export const BD_MOBILE = /^01[3-9][0-9]{8}$/

/** First step of a new Employee ID application: the basics. */
export function NewApplication({ onClose, onDone, prefill }: { onClose: () => void; onDone: (id: string) => void
  prefill?: { name?: string; mobile?: string; hub?: string; position?: string } }) {
  const o = useOrg()
  const [f, setF] = useState({ name: prefill?.name ?? '', mobile: prefill?.mobile ?? '', hub: prefill?.hub ?? '', department: '', position: '' })
  // A position given by name (from an HR request) is matched to the list once it loads.
  useEffect(() => {
    const want = (prefill?.position ?? '').trim().toLowerCase()
    if (!want || f.position || !o.data) return
    const p = o.data.positions.find(x => x.id === prefill?.position || x.name.toLowerCase() === want || (x.name_bn ?? '').toLowerCase() === want)
    if (p) setF(v => ({ ...v, position: p.id, department: p.department_id }))
  }, [o.data, prefill?.position, f.position])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const positions = (o.data?.positions ?? []).filter(p => !f.department || p.department_id === f.department)
  async function go() {
    setErr('')
    if (!f.name.trim()) return setErr('পূর্ণ নাম দিন')
    if (!BD_MOBILE.test(f.mobile.trim())) return setErr('সঠিক মোবাইল নম্বর দিন (যেমন 01711000000)')
    if (!f.hub) return setErr('হাব বেছে নিন')
    setBusy(true)
    try { onDone(await hr.startApplication({ name: f.name.trim(), mobile: f.mobile.trim(), hub: f.hub, department: f.department || null, position: f.position || null })) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title="নতুন এমপ্লয়ি আইডি আবেদন" onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy} onClick={() => void go()}>আবেদন খুলুন</button></>}>
    <p className="muted small">প্রথম ধাপ: মূল তথ্য। পরের পাতায় NID, জরুরি যোগাযোগ ইত্যাদি দিয়ে সাবমিট করবেন। অনুমোদনের সময় এমপ্লয়ি আইডি দেওয়া হবে।</p>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label="পূর্ণ নাম"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="মোবাইল"><input inputMode="tel" value={f.mobile} onChange={e => setF({ ...f, mobile: e.target.value })} placeholder="01711000000" /></Field>
      <Field label="হাব"><select value={f.hub} onChange={e => setF({ ...f, hub: e.target.value })}><option value="">বেছে নিন…</option>
        {o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="বিভাগ"><select value={f.department} onChange={e => setF({ ...f, department: e.target.value, position: '' })}><option value="">—</option>
        {o.data?.departments.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="পদবি"><select value={f.position} onChange={e => setF({ ...f, position: e.target.value })}><option value="">—</option>
        {positions.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
    </div>
    {o.data && !o.data.hubs.length && <p className="notice">আগে “প্রতিষ্ঠান” পাতায় অন্তত একটি হাব যোগ করুন।</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
