import { useEffect, useMemo, useRef, useState } from 'react'
import { Combo, DupNote, TextInput, useDuplicates } from '../../components/inputs'
import { BD_MOBILE, cleanMobile, duplicates, firstError, rules } from '../../lib/validate'
import { applyMask, masks } from '../../lib/mask'
import { DraftBar, Stepper, focusFirst, focusFirstInvalid, useConfirm, useDraft, useSteps } from '../../components/forms'
import { Badge, Field, Modal, useLoad } from '../accounts/ui'
import { EMP_STATUS, hr, hrFriendly, hubLabel, nameMap, org, type EmployeeStatus, type Position, type WorkFocus } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'

/** Hubs, zones, departments and positions the user can see, plus id -> name maps. */
export function useOrg() {
  const { lang } = usePrefs()
  const q = useLoad(async () => {
    const [zones, hubsRaw, departments, positions] = await Promise.all([org.zones(), org.hubs(), org.departments(), org.positions()])
    // Hubs are shown with their number code everywhere ("Natore #80"); search by number works in every list.
    const hubs = hubsRaw.map(h => ({ ...h, name: hubLabel(h) }))
    return { zones, hubs, departments, positions }
  }, [])
  // Posts are shown in Bangla when the site is in Bangla; `posEn` keeps the English name for the company's own files.
  const names = useMemo(() => { const posEn = nameMap(q.data?.positions)
    const pos = lang === 'bn' ? Object.fromEntries((q.data?.positions ?? []).map(p => [p.id, p.name_bn || p.name])) as Record<string, string> : posEn
    return { zone: nameMap(q.data?.zones), hub: nameMap(q.data?.hubs), dept: nameMap(q.data?.departments), pos, posEn } }, [q.data, lang])
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

/** First step of a new Employee ID application: the basics, in two short steps (person → work), then a check before it is opened.
 *  Typing is saved as a draft on this device, so a closed box or a lost network does not lose it. */
const NEW_APP_STEPS = ['ব্যক্তি', 'কাজ'] as const
export function NewApplication({ onClose, onDone, prefill }: { onClose: () => void; onDone: (id: string) => void
  prefill?: { name?: string; mobile?: string; hub?: string; position?: string } }) {
  const o = useOrg()
  // A form opened from an HR request already has its answers, so it does not keep a draft.
  const draft = useDraft(prefill ? null : 'hr.new-application', { name: prefill?.name ?? '', mobile: cleanMobile(prefill?.mobile ?? ''), hub: prefill?.hub ?? '', department: '', position: '' })
  const f = draft.value, setF = draft.setValue
  // A position given by name (from an HR request) is matched to the list once it loads.
  useEffect(() => {
    const want = (prefill?.position ?? '').trim().toLowerCase()
    if (!want || f.position || !o.data) return
    const p = o.data.positions.find(x => x.id === prefill?.position || x.name.toLowerCase() === want || (x.name_bn ?? '').toLowerCase() === want)
    if (p) setF(v => ({ ...v, position: p.id, department: p.department_id }))
  }, [o.data, prefill?.position, f.position, setF])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const positions = (o.data?.positions ?? []).filter(p => !f.department || p.department_id === f.department)
  const [tried, setTried] = useState<boolean[]>([false, false])
  const dups = useDuplicates(f.mobile, duplicates.employeeByMobile, v => BD_MOBILE.test(cleanMobile(v)))
  const steps = useSteps(NEW_APP_STEPS.length)
  const body = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()
  const opened = useRef(false)
  // Auto focus: the first box of each new step (the dialog itself focuses the first one on open).
  useEffect(() => { if (opened.current) focusFirst(body.current); opened.current = true }, [steps.step])

  const mobileRules = [rules.required('মোবাইল নম্বর'), rules.mobile()]
  const errors = {
    name: f.name.trim() ? null : 'পূর্ণ নাম দিন',
    mobile: firstError(f.mobile, mobileRules) ?? (dups.length ? 'এই নম্বরে আগে থেকেই কর্মী আছেন' : null),
    hub: f.hub ? null : 'হাব বেছে নিন',
    position: f.position || !positions.length ? null : 'পদবি বেছে নিন',
  }
  const stepOk = (i: number) => (i === 0 ? [errors.name, errors.mobile] : [errors.hub, errors.position]).every(x => !x)
  const show = (i: number) => tried[i]
  function check(i: number) {
    setTried(t => t.map((v, k) => k === i ? true : v))
    if (stepOk(i)) return true
    window.setTimeout(() => focusFirstInvalid(body.current), 30)
    return false
  }
  const hubName = (o.data?.hubs ?? []).find(h => h.id === f.hub)?.name ?? ''
  async function submit() {
    setErr('')
    if (!check(0)) { steps.go(0); return }
    if (!check(1)) return
    const yes = await confirm.ask({ title: 'আবেদন খোলার আগে দেখে নিন', message: 'সব ঠিক থাকলে জমা দিন। পরের পাতায় এনআইডি, জরুরি যোগাযোগ ইত্যাদি দেবেন।', ok: 'হ্যাঁ, আবেদন খুলুন',
      rows: [['পূর্ণ নাম', f.name.trim()], ['মোবাইল', applyMask(f.mobile, masks.mobile)], ['হাব', hubName], ['বিভাগ', o.names.dept[f.department] ?? ''], ['পদবি', o.names.pos[f.position] ?? '']] })
    if (!yes) return
    setBusy(true)
    try { const id = await hr.startApplication({ name: f.name.trim(), mobile: cleanMobile(f.mobile), hub: f.hub, department: f.department || null, position: f.position || null }); draft.clear(); onDone(id) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  const actions = <>
    {steps.first ? <button type="button" className="secondary" onClick={onClose}>বাতিল</button> : <button type="button" className="secondary" onClick={steps.back}>← আগের ধাপ</button>}
    {steps.last ? <button type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'খোলা হচ্ছে…' : 'আবেদন খুলুন'}</button>
      : <button type="button" onClick={() => { if (check(steps.step)) steps.next() }}>পরের ধাপ →</button>}</>
  return <Modal title="নতুন এমপ্লয়ি আইডি আবেদন" onClose={onClose} actions={actions}>
    <Stepper titles={[...NEW_APP_STEPS]} step={steps.step} reached={steps.reached} onGo={i => { if (i < steps.step || check(steps.step)) steps.go(i) }} />
    <div ref={body} key={steps.step} className="step-body">
      {steps.step === 0 && <>
        <p className="muted small">যাঁর আইডি হবে তাঁর নাম ও মোবাইল। অনুমোদনের সময় এমপ্লয়ি আইডি দেওয়া হবে।</p>
        <div className="hr-form" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="পূর্ণ নাম" required float error={show(0) ? errors.name : null}><input autoComplete="name" placeholder="যেমন: Md. Rahim Uddin" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="মোবাইল" required float hint="১১ সংখ্যা — নিজে থেকেই 01711-000000 আকারে সাজবে"><TextInput kind="phone" mask={masks.mobile} autoComplete="tel" value={f.mobile} onChange={v => setF({ ...f, mobile: v })} placeholder="01XXX-XXXXXX" rules={mobileRules} showError={show(0)}
            after={dups.length > 0 && <DupNote>এই নম্বরে আগে থেকেই আছেন: {dups.map(d => `${d.full_name}${d.employee_code ? ` (#${d.employee_code})` : ''}${d.hub_id && o.names.hub[d.hub_id] ? ` · ${o.names.hub[d.hub_id]}` : ''}`).join(', ')} — একই নম্বরে নতুন আবেদন হবে না।</DupNote>} /></Field>
        </div></>}
      {steps.step === 1 && <>
        <p className="muted small">কোন হাবে, কোন পদে কাজ করবেন।</p>
        <div className="hr-form" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="হাব" required float error={show(1) ? errors.hub : null}><Combo value={f.hub} onChange={v => setF({ ...f, hub: v })} placeholder="হাবের নাম বা নম্বর লিখে খুঁজুন" options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
          <Field label="বিভাগ" float><select value={f.department} onChange={e => setF({ ...f, department: e.target.value, position: '' })}><option value="">—</option>
            {o.data?.departments.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
          <Field label="পদবি" required float error={show(1) ? errors.position : null}><select value={f.position} onChange={e => setF({ ...f, position: e.target.value })}><option value="">—</option>
            {positions.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        </div>
        {o.data && !o.data.hubs.length && <p className="notice">আগে “প্রতিষ্ঠান” পাতায় অন্তত একটি হাব যোগ করুন।</p>}</>}
    </div>
    {err && <p className="da-error" role="alert">{err}</p>}
    <DraftBar draft={{ ...draft, discard: () => { draft.discard(); setTried([false, false]); steps.go(0) } }} />
    {confirm.node}
  </Modal>
}
