import { useEffect, useMemo, useState } from 'react'
import { Combo, DupNote, TextInput, useDuplicates } from '../../components/inputs'
import { BD_MOBILE, cleanMobile, duplicates, rules } from '../../lib/validate'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import { EMP_STATUS, hr, hrFriendly, hubLabel, nameMap, org, type EmployeeStatus, type Position, type WorkFocus } from '../../lib/hr'

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

/** The person's main work inside a post with focuses (e.g. Sorting in blue, Loader in orange). */
export function focusOf(positions: Position[] | undefined, positionId: string | null, code: string | null | undefined): WorkFocus | null {
  if (!code || !positionId) return null
  return positions?.find(p => p.id === positionId)?.focus_options?.find(f => f.code === code) ?? null
}
export function FocusPill({ f }: { f: WorkFocus | null }) {
  return f ? <span className={`focus-pill fc-${f.color}`}>{f.label_bn || f.label}</span> : null
}

export function EmpBadge({ status }: { status: EmployeeStatus }) {
  const [label, tone] = EMP_STATUS[status] ?? [status, 'neutral']
  return <Badge tone={tone}>{label}</Badge>
}

export { BD_MOBILE } from '../../lib/validate'

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
  const [tried, setTried] = useState(false)
  const dups = useDuplicates(f.mobile, duplicates.employeeByMobile, v => BD_MOBILE.test(cleanMobile(v)))
  async function go() {
    setErr(''); setTried(true)
    if (!f.name.trim()) return setErr('পূর্ণ নাম দিন')
    if (!BD_MOBILE.test(cleanMobile(f.mobile))) return setErr('সঠিক মোবাইল নম্বর দিন (যেমন 01711000000)')
    if (!f.hub) return setErr('হাব বেছে নিন')
    setBusy(true)
    try { onDone(await hr.startApplication({ name: f.name.trim(), mobile: cleanMobile(f.mobile), hub: f.hub, department: f.department || null, position: f.position || null })) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title="নতুন এমপ্লয়ি আইডি আবেদন" onClose={onClose} actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy} onClick={() => void go()}>আবেদন খুলুন</button></>}>
    <p className="muted small">প্রথম ধাপ: মূল তথ্য। পরের পাতায় NID, জরুরি যোগাযোগ ইত্যাদি দিয়ে সাবমিট করবেন। অনুমোদনের সময় এমপ্লয়ি আইডি দেওয়া হবে।</p>
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label="পূর্ণ নাম" required><input placeholder="যেমন: Md. Rahim Uddin" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="মোবাইল" required><TextInput kind="phone" value={f.mobile} onChange={v => setF({ ...f, mobile: v })} placeholder="01XXXXXXXXX" rules={[rules.required('মোবাইল নম্বর'), rules.mobile()]} showError={tried}
        after={dups.length > 0 && <DupNote>এই নম্বরে আগে থেকেই আছেন: {dups.map(d => `${d.full_name}${d.employee_code ? ` (#${d.employee_code})` : ''}${d.hub_id && o.names.hub[d.hub_id] ? ` · ${o.names.hub[d.hub_id]}` : ''}`).join(', ')} — একই নম্বরে নতুন আবেদন হবে না।</DupNote>} /></Field>
      <Field label="হাব" required><Combo value={f.hub} onChange={v => setF({ ...f, hub: v })} options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
      <Field label="বিভাগ"><select value={f.department} onChange={e => setF({ ...f, department: e.target.value, position: '' })}><option value="">—</option>
        {o.data?.departments.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="পদবি" required><select value={f.position} onChange={e => setF({ ...f, position: e.target.value })}><option value="">—</option>
        {positions.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
    </div>
    {o.data && !o.data.hubs.length && <p className="notice">আগে “প্রতিষ্ঠান” পাতায় অন্তত একটি হাব যোগ করুন।</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
