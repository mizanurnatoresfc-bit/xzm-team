import { useEffect, useState, type ReactNode } from 'react'
import { LeftJob, ProfileFill } from './ProfileFill'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import {
  APP_STATUS, CHANGE_TYPE, DOC_TYPE, EMP_STATUS, MISSING, bn, dmy, docs, hr, hrFriendly, pay, todayDhaka,
  type Employee, type EmployeeStatus,
} from '../../lib/hr'
import { BD_MOBILE, EmpBadge, FocusPill, focusOf, useOrg } from './common'
import { dutiesApi, FREQ } from '../../lib/hub'
import { ExtraFields, ReferralPanel } from './ProfileExtras'

const REQUIRED_DOCS = ['nid_front', 'nid_back', 'photo']

export function EmployeeProfile() {
  const { id = '' } = useParams()
  const { can, session } = useAuth()
  const o = useOrg()
  const { toast, node } = useToast()
  const emp = useLoad(() => hr.employee(id), [id])
  const e = emp.data
  const app = useLoad(() => e?.status === 'applicant' ? hr.applicationOf(id) : Promise.resolve(null), [id, e?.status])
  const isDraftOwner = !!e && e.status === 'applicant' && !!app.data && ['draft', 'returned'].includes(app.data.status) && app.data.created_by === session?.user.id
  const [tab, setTab] = useState<'overview' | 'personal' | 'docs' | 'history'>('overview')
  const [askEdit, setAskEdit] = useState(0)
  const [fill, setFill] = useState(false)
  const [left, setLeft] = useState(false)
  // Profile photo: the newest "photo" document, opened with a short-lived link.
  const photo = useLoad(async () => {
    const list = await docs.list(id).catch(() => [])
    const ph = list.find(d => d.doc_type === 'photo')
    return ph ? await docs.url(ph.storage_path).catch(() => null) : null
  }, [id])

  if (emp.error) return <AppShell title="কর্মীর প্রোফাইল"><p className="da-error">{hrFriendly(emp.error)}</p></AppShell>
  if (!e) return <AppShell title="কর্মীর প্রোফাইল"><p className="muted">{emp.loading ? 'লোড হচ্ছে…' : 'কর্মী পাওয়া যায়নি বা দেখার অনুমতি নেই।'}</p></AppShell>
  const reload = async () => { await emp.reload(); await app.reload() }

  const post = e.position_id ? o.names.pos[e.position_id] ?? '' : ''
  const isRider = /rider|রাইডার|driver|ড্রাইভার/i.test(post)
  const focus = focusOf(o.data?.positions, e.position_id, e.work_focus)
  return <AppShell title="কর্মীর প্রোফাইল" subtitle="টিম">
    {node}
    <section className="emp-head">
      <div className="emp-cover"><Link to="/app/hr/employees" className="emp-back"><Icon name="back" size={16} /> সব কর্মী</Link></div>
      <div className="emp-top">
        <div className="emp-photo">{photo.data ? <img src={photo.data} alt="" /> : (e.full_name || '?').slice(0, 2).toUpperCase()}</div>
        <div className="emp-id">
          <h2>{e.full_name}</h2>
          <div className="emp-badges"><EmpBadge status={e.status} />{post && <span className={`role-pill${isRider ? ' rider' : ''}`}><Icon name={isRider ? 'truck' : 'user'} size={14} />{post}</span>}<FocusPill f={focus} /></div>
          <div className="emp-hub"><Icon name="hub" size={16} />{e.hub_id ? o.names.hub[e.hub_id] ?? '—' : 'হাব দেওয়া হয়নি'}
            {e.employee_code ? <b>#{e.employee_code}</b> : <span className="muted">আইডি বাকি</span>}</div>
        </div>
      </div>
      <div className="nv-qas">
        {e.mobile && <a className="nv-qa call" href={`tel:${e.mobile}`}><i><Icon name="phone" size={22} /></i>কল</a>}
        {e.mobile && <a className="nv-qa wa" href={`https://wa.me/88${e.mobile.replace(/\D/g, '').replace(/^88/, '')}`} target="_blank" rel="noreferrer"><i><Icon name="note" size={22} /></i>WhatsApp</a>}
        {e.mobile && <a className="nv-qa" href={`sms:${e.mobile}`}><i><Icon name="form" size={22} /></i>SMS</a>}
        {can('hr.employee.edit') && e.status !== 'applicant' && !e.archived_at && <button type="button" className="nv-qa" onClick={() => { setTab('overview'); setAskEdit(n => n + 1) }}><i><Icon name="edit" size={22} /></i>এডিট</button>}
        {can('hr.employee_profile.edit') && !e.archived_at && <button type="button" className="nv-qa" onClick={() => setFill(true)}><i><Icon name="form" size={22} /></i>প্রোফাইল পূর্ণ</button>}
        {can('hr.request.create') && e.status === 'active' && !e.archived_at && <button type="button" className="nv-qa" onClick={() => setLeft(true)}><i><Icon name="out" size={22} /></i>চাকরি ছেড়েছেন</button>}
        <Link to="/app/hub/attendance" className="nv-qa"><i><Icon name="cal" size={22} /></i>হাজিরা</Link>
        <Link to="/app/accounts/daily" className="nv-qa"><i><Icon name="ledger" size={22} /></i>হিসাব খাতা</Link>
        <button type="button" className="nv-qa" onClick={() => setTab('docs')}><i><Icon name="file" size={22} /></i>ডকুমেন্ট</button>
      </div>
    </section>
    {fill && <ProfileFill employee={e.id} onClose={() => setFill(false)} onDone={async m => { setFill(false); toast(m); await reload() }} />}
    {left && <LeftJob person={{ id: e.id, full_name: e.full_name, employee_code: e.employee_code, hub_id: e.hub_id, hub: e.hub_id ? o.names.hub[e.hub_id] ?? '' : '', position: e.position_id ? o.names.posEn[e.position_id] ?? '' : '' }}
      onClose={() => setLeft(false)} onDone={m => { setLeft(false); toast(m) }} />}
    <nav className="emp-tabs" role="tablist">
      {([['overview', 'সারসংক্ষেপ', 'dash'], ['personal', 'ব্যক্তিগত', 'user'], ['docs', 'ডকুমেন্ট', 'file'], ['history', 'এইচআর ইতিহাস', 'log']] as const).map(([k, t, ic]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={ic} size={16} />{t}</button>)}
    </nav>
    {tab === 'overview' && <>
      {e.status === 'applicant' && app.data && <section className="panel">
        <div className="da-bar"><h2 style={{ margin: 0 }}>আইডি আবেদন</h2><Badge tone={APP_STATUS[app.data.status][1]}>{APP_STATUS[app.data.status][0]}</Badge></div>
        {app.data.review_note && <p className="notice">HR-এর নোট: {app.data.review_note}</p>}
        <MissingList id={id} key={`${e.id}-${emp.data?.updated_at ?? ''}`} />
        {app.data.status === 'submitted' && can('hr.application.approve') && <ReviewActions id={id} onDone={async m => { toast(m); await reload() }} />}
        {app.data.status === 'submitted' && !can('hr.application.approve') && <p className="muted">এইচআর যাচাই করছে।</p>}
      </section>}
      <WorkPanel e={e} canEdit={can('hr.employee.edit') || can('hr.duty.edit')} onChanged={async m => { toast(m); await reload() }} />
      {isDraftOwner ? <DraftForm e={e} onSaved={async m => { toast(m); await reload() }} /> : <Details e={e} askEdit={askEdit} onChanged={async m => { toast(m); await reload() }} />}
    </>}
    {tab === 'personal' && <>
      <ExtraFields employee={e.id} zoneId={e.zone_id} onSaved={m => toast(m)} />
      <ReferralPanel employee={e.id} zoneId={e.zone_id} onSaved={m => toast(m)} />
    </>}
    {tab === 'docs' && <Documents e={e} canUpload={isDraftOwner || can('hr.document.create')} onDone={m => { toast(m); void photo.reload() }} />}
    {tab === 'history' && (e.status !== 'applicant' ? <History id={id} /> : <p className="muted">আইডি পাওয়ার পর ইতিহাস দেখাবে।</p>)}
  </AppShell>
}

/** The person's work: their focus inside the post (e.g. Sorting / Loader) and every duty they hold. */
function WorkPanel({ e, canEdit, onChanged }: { e: Employee; canEdit: boolean; onChanged: (m: string) => Promise<void> }) {
  const o = useOrg()
  const duties = useLoad(() => dutiesApi.mine(e.id).catch(() => []), [e.id, e.position_id, e.work_focus])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const options = o.data?.positions.find(p => p.id === e.position_id)?.focus_options ?? []
  async function pick(code: string | null) {
    setBusy(true); setErr('')
    try { await hr.setWorkFocus(e.id, code); await onChanged('কাজের ফোকাস সেভ হয়েছে') } catch (x) { setErr(hrFriendly(x)) } finally { setBusy(false) }
  }
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>কাজ ও দায়িত্ব</h2>
      {canEdit && <Link to="/app/hr/duties" className="btn-ghost">দায়িত্ব লিখুন</Link>}</div>
    {options.length > 0 && <div className="focus-pick" style={{ margin: '8px 0 12px' }}>
      <span className="muted">মূল কাজ:</span>
      {canEdit ? <>
        {options.map(f => <button key={f.code} type="button" disabled={busy} className={`focus-pill fc-${f.color}${e.work_focus === f.code ? ' on' : ''}`}
          onClick={() => void pick(e.work_focus === f.code ? null : f.code)}>{f.label_bn || f.label}</button>)}
        {!e.work_focus && <span className="bad small">এখনো বাছাই হয়নি</span>}
      </> : (e.work_focus ? <FocusPill f={focusOf(o.data?.positions, e.position_id, e.work_focus)} /> : <span className="muted">বাছাই হয়নি</span>)}
    </div>}
    {err && <p className="da-error">{err}</p>}
    {duties.loading && !duties.data ? <p className="muted">লোড হচ্ছে…</p>
      : !duties.data?.length ? <p className="muted">এই পদ বা কর্মীর জন্য এখনো কোনো দায়িত্ব লেখা হয়নি।</p>
      : <ul className="duty-list">{duties.data.map(d => <li key={d.id} className="duty">
          <span className="duty-ic"><Icon name="tasks" size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}><b>{d.title}</b> <Badge tone="info">{FREQ[d.frequency]?.[0] ?? d.frequency}</Badge>
            {d.source === 'person' && <Badge tone="neutral">শুধু এই কর্মীর</Badge>}
            {d.details && <div className="muted small pre-wrap">{d.details}</div>}</div></li>)}</ul>}
  </section>
}

function MissingList({ id }: { id: string }) {
  const m = useLoad(() => hr.missingFields(id), [id])
  if (m.error) return <p className="da-error">{hrFriendly(m.error)}</p>
  if (!m.data) return null
  if (!m.data.length) return <p className="da-ok">সব প্রয়োজনীয় তথ্য দেওয়া হয়েছে।</p>
  return <p className="notice">যা বাকি: {m.data.map(x => x.startsWith('document:') ? DOC_TYPE[x.slice(9)] ?? x : x === 'basic_salary' ? 'প্রস্তাবিত বেতন'
    : x === 'reporting_manager' ? 'রিপোর্টিং ম্যানেজার' : MISSING[x] ?? x).join(', ')}</p>
}

function ReviewActions({ id, onDone }: { id: string; onDone: (m: string) => Promise<void> }) {
  const [mode, setMode] = useState<'approve' | 'return' | 'reject' | null>(null)
  const [code, setCode] = useState(''); const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (mode === 'approve' && !code) hr.nextCode().then(c => setCode(c ?? '')).catch(() => undefined) }, [mode, code])
  async function go() {
    setBusy(true); setErr('')
    try {
      if (mode === 'approve') { if (!/^[1-9][0-9]{0,5}$/.test(code.trim())) throw new Error('এমপ্লয়ি আইডি ১ থেকে শুরু হওয়া সংখ্যা হবে'); await hr.approveApplication(id, code.trim(), note.trim() || null); await onDone(`অনুমোদিত — এমপ্লয়ি আইডি ${code}`) }
      if (mode === 'return') { if (!note.trim()) throw new Error('কী ঠিক করতে হবে লিখুন'); await hr.returnApplication(id, note.trim()); await onDone('সংশোধনের জন্য ফেরত পাঠানো হয়েছে') }
      if (mode === 'reject') { if (!note.trim()) throw new Error('কারণ লিখুন'); await hr.rejectApplication(id, note.trim()); await onDone('আবেদন বাতিল করা হয়েছে') }
      setMode(null)
    } catch (e) { setErr(e instanceof Error && !(e as { code?: string }).code && /[ঀ-৿]/.test(e.message) ? e.message : hrFriendly(e)) } finally { setBusy(false) }
  }
  return <>
    <div className="row"><button onClick={() => setMode('approve')}>অনুমোদন ও আইডি দিন</button>
      <button className="secondary" onClick={() => setMode('return')}>সংশোধনে ফেরত</button><button className="danger" onClick={() => setMode('reject')}>বাতিল</button></div>
    {mode && <Modal title={{ approve: 'আবেদন অনুমোদন', return: 'সংশোধনের জন্য ফেরত', reject: 'আবেদন বাতিল' }[mode]} onClose={() => setMode(null)}
      actions={<><button className="secondary" onClick={() => setMode(null)}>না</button><button className={mode === 'reject' ? 'danger' : ''} disabled={busy} onClick={() => void go()}>হ্যাঁ, নিশ্চিত</button></>}>
      {mode === 'approve' && <Field label="এমপ্লয়ি আইডি (সংখ্যা)" hint="পরের খালি নম্বরটি বসানো আছে; চাইলে বদলাতে পারেন। একই আইডি দুবার দেওয়া যায় না।">
        <input inputMode="numeric" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></Field>}
      <Field label={mode === 'approve' ? 'নোট (ঐচ্ছিক)' : mode === 'return' ? 'কী ঠিক করতে হবে' : 'বাতিলের কারণ'}><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field>
      {mode === 'approve' && <p className="muted small">অনুমোদনের পর কর্মী সক্রিয় হবে এবং প্রস্তাবিত বেতন আলাদাভাবে অনুমোদনের জন্য থাকবে।</p>}
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

function DraftForm({ e, onSaved }: { e: Employee; onSaved: (m: string) => Promise<void> }) {
  const o = useOrg()
  const sens = useLoad(() => hr.sensitive(e.id), [e.id])
  const comp = useLoad(() => pay.list(e.id), [e.id])
  const mgrs = useLoad(() => hr.employees({ status: 'active' }), [])
  const [f, setF] = useState<Record<string, string>>({})
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => {
    const s = sens.data
    setF({ full_name: e.full_name ?? '', full_name_bn: e.full_name_bn ?? '', mobile: e.mobile ?? '', email: e.email ?? '', joining_date: e.joining_date ?? todayDhaka(),
      hub_id: e.hub_id ?? '', department_id: e.department_id ?? '', position_id: e.position_id ?? '', reporting_manager_id: e.reporting_manager_id ?? '',
      emergency_contact_name: e.emergency_contact_name ?? '', emergency_contact_phone: e.emergency_contact_phone ?? '', emergency_contact_relation: e.emergency_contact_relation ?? '',
      reference_info: e.reference_info ?? '', nid_number: s?.nid_number ?? '', date_of_birth: s?.date_of_birth ?? '', father_name: s?.father_name ?? '',
      mother_name: s?.mother_name ?? '', present_address: s?.present_address ?? '', permanent_address: s?.permanent_address ?? '',
      basic: '', transport: '0', commission: '0' })
  }, [e, sens.data])
  const set = (k: string) => (ev: { target: { value: string } }) => setF(p => ({ ...p, [k]: ev.target.value }))
  const pending = comp.data?.find(c => c.status === 'pending' || c.status === 'approved')
  async function save(submit: boolean) {
    setErr('')
    if (!f.full_name?.trim()) return setErr('পূর্ণ নাম দিন')
    if (!BD_MOBILE.test(f.mobile?.trim() ?? '')) return setErr('সঠিক মোবাইল নম্বর দিন')
    if (f.emergency_contact_phone && !BD_MOBILE.test(f.emergency_contact_phone.trim())) return setErr('জরুরি যোগাযোগের নম্বর সঠিক নয়')
    if (f.nid_number && !/^([0-9]{10}|[0-9]{13}|[0-9]{17})$/.test(f.nid_number.trim())) return setErr('এনআইডি নম্বর ১০, ১৩ বা ১৭ অঙ্কের হবে')
    setBusy(true)
    try {
      const n = (k: string) => f[k]?.trim() || null
      await hr.updateEmployee(e.id, { full_name: f.full_name.trim(), full_name_bn: n('full_name_bn'), mobile: f.mobile.trim(), email: n('email'),
        joining_date: n('joining_date'), hub_id: n('hub_id'), department_id: n('department_id'), position_id: n('position_id'),
        reporting_manager_id: n('reporting_manager_id'), emergency_contact_name: n('emergency_contact_name'), emergency_contact_phone: n('emergency_contact_phone'),
        emergency_contact_relation: n('emergency_contact_relation'), reference_info: n('reference_info') })
      await hr.saveSensitive(e.id, { nid_number: n('nid_number'), date_of_birth: n('date_of_birth'), father_name: n('father_name'), mother_name: n('mother_name'),
        present_address: n('present_address'), permanent_address: n('permanent_address') })
      if (!pending && f.basic) {
        const b = Number(f.basic); if (!(b > 0)) throw new Error('মূল বেতন সঠিক নয়')
        await pay.propose(e.id, f.joining_date || todayDhaka(), b, Number(f.transport) || 0, Number(f.commission) || 0, 'Initial salary')
      }
      await Promise.all([sens.reload(), comp.reload()])
      if (submit) { await hr.submitApplication(e.id); await onSaved('আবেদন এইচআর-এর কাছে পাঠানো হয়েছে') }
      else await onSaved('সেভ হয়েছে')
    } catch (x) { setErr(hrFriendly(x)) } finally { setBusy(false) }
  }
  const positions = (o.data?.positions ?? []).filter(p => !f.department_id || p.department_id === f.department_id)
  if (sens.loading && !sens.data) return <section className="panel"><p className="muted">লোড হচ্ছে…</p></section>
  return <section className="panel">
    <h2>আবেদনের তথ্য</h2>
    <h3>চাকরির তথ্য</h3>
    <div className="hr-form">
      <Field label="পূর্ণ নাম" required><input placeholder="Enter Full Name" value={f.full_name ?? ''} onChange={set('full_name')} /></Field>
      <Field label="নাম (বাংলা)"><input placeholder="বাংলায় পুরো নাম" value={f.full_name_bn ?? ''} onChange={set('full_name_bn')} /></Field>
      <Field label="মোবাইল" required><input inputMode="tel" placeholder="01XXXXXXXXX" value={f.mobile ?? ''} onChange={set('mobile')} /></Field>
      <Field label="ইমেইল" note="(শুধু এডমিনের জন্য)"><input type="email" placeholder="Enter Email" value={f.email ?? ''} onChange={set('email')} /></Field>
      <Field label="হাব" required><select value={f.hub_id ?? ''} onChange={set('hub_id')}><option value="">—</option>{o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="যোগদানের তারিখ"><input type="date" value={f.joining_date ?? ''} onChange={set('joining_date')} /></Field>
      <Field label="বিভাগ"><select value={f.department_id ?? ''} onChange={set('department_id')}><option value="">—</option>{o.data?.departments.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="পদবি" required><select value={f.position_id ?? ''} onChange={set('position_id')}><option value="">—</option>{positions.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label="রিপোর্টিং ম্যানেজার" hint="এরিয়াে প্রথম কর্মী হলে খালি রাখা যায়"><select value={f.reporting_manager_id ?? ''} onChange={set('reporting_manager_id')}><option value="">—</option>
        {mgrs.data?.filter(m => m.id !== e.id).map(m => <option key={m.id} value={m.id}>{m.employee_code} · {m.full_name}</option>)}</select></Field>
    </div>
    <h3>ব্যক্তিগত তথ্য (গোপন — শুধু অনুমতিপ্রাপ্তরা দেখবেন)</h3>
    <div className="hr-form">
      <Field label="NID নম্বর" required note="(সংরক্ষিত)"><input inputMode="numeric" placeholder="Enter NID no" value={f.nid_number ?? ''} onChange={set('nid_number')} /></Field>
      <Field label="জন্মতারিখ" required><input type="date" value={f.date_of_birth ?? ''} onChange={set('date_of_birth')} /></Field>
      <Field label="বাবার নাম"><input value={f.father_name ?? ''} onChange={set('father_name')} /></Field>
      <Field label="মায়ের নাম"><input value={f.mother_name ?? ''} onChange={set('mother_name')} /></Field>
      <Field label="বর্তমান ঠিকানা"><input placeholder="Enter your address" value={f.present_address ?? ''} onChange={set('present_address')} /></Field>
      <Field label="স্থায়ী ঠিকানা" required><input placeholder="গ্রাম, ডাকঘর, উপজেলা, জেলা" value={f.permanent_address ?? ''} onChange={set('permanent_address')} /></Field>
    </div>
    <h3>জরুরি যোগাযোগ ও রেফারেন্স</h3>
    <div className="hr-form">
      <Field label="নাম"><input value={f.emergency_contact_name ?? ''} onChange={set('emergency_contact_name')} /></Field>
      <Field label="মোবাইল"><input inputMode="tel" value={f.emergency_contact_phone ?? ''} onChange={set('emergency_contact_phone')} /></Field>
      <Field label="সম্পর্ক"><input value={f.emergency_contact_relation ?? ''} onChange={set('emergency_contact_relation')} /></Field>
      <Field label="রেফারেন্স (ঐচ্ছিক)" wide><input value={f.reference_info ?? ''} onChange={set('reference_info')} /></Field>
    </div>
    <h3>প্রস্তাবিত বেতন</h3>
    {pending ? <p className="muted">মূল বেতন {bn(pending.basic_salary)} ৳ · যাতায়াত {bn(pending.transport_allowance)} ৳ · কমিশন {bn(pending.commission)} ৳ — অনুমোদনের অপেক্ষায়।</p> :
      <div className="hr-form">
        <Field label="মূল বেতন (৳)" required><input placeholder="0" inputMode="decimal" value={f.basic ?? ''} onChange={set('basic')} /></Field>
        <Field label="যাতায়াত ভাতা (৳)"><input inputMode="decimal" value={f.transport ?? ''} onChange={set('transport')} /></Field>
        <Field label="কমিশন (৳)"><input inputMode="decimal" value={f.commission ?? ''} onChange={set('commission')} /></Field>
      </div>}
    {err && <p className="da-error">{err}</p>}
    <div className="row" style={{ marginTop: 14 }}><button className="secondary" disabled={busy} onClick={() => void save(false)}>সেভ করুন</button>
      <button disabled={busy} onClick={() => void save(true)}>সেভ করে এইচআর-এ পাঠান</button>
      <span className="muted small">পাঠানোর আগে এনআইডি (সামনে, পেছনে) ও ছবি আপলোড করুন।</span></div>
  </section>
}

function Details({ e, askEdit = 0, onChanged }: { e: Employee; askEdit?: number; onChanged: (m: string) => Promise<void> }) {
  const { can } = useAuth()
  const o = useOrg()
  const nid = useLoad(() => hr.maskedNid(e.id), [e.id])
  const [revealed, setRevealed] = useState<Record<string, string | null> | null>(null)
  const nav = useNavigate()
  const [modal, setModal] = useState<'status' | 'transfer' | 'archive' | 'reveal' | 'edit' | 'code' | 'wrong' | null>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: string) => (ev: { target: { value: string } }) => setF(p => ({ ...p, [k]: ev.target.value }))
  const open = (m: typeof modal) => {
    setErr(''); setModal(m)
    setF({ status: e.status === 'active' ? 'inactive' : 'active', effective: todayDhaka(), reason: '', hub: e.hub_id ?? '', department: e.department_id ?? '',
      position: e.position_id ?? '', type: 'transfer', code: '', full_name: e.full_name, full_name_bn: e.full_name_bn ?? '', mobile: e.mobile ?? '', email: e.email ?? '',
      emergency_contact_name: e.emergency_contact_name ?? '', emergency_contact_phone: e.emergency_contact_phone ?? '' })
  }
  // Mirrors hr_change_status: active <-> inactive needs edit or status rights, resignation needs edit, dismissal and taking a leaver back need approve.
  const statusAllowed = (s: EmployeeStatus) => {
    const left = e.status === 'resigned' || e.status === 'terminated'
    if (left) return s === 'active' && can('hr.employee.approve')
    if (s === 'terminated') return can('hr.employee.approve')
    if (s === 'resigned') return can('hr.employee.edit')
    return can('hr.employee.edit') || can('hr.status.edit')
  }
  async function go() {
    setBusy(true); setErr('')
    try {
      if (modal !== 'edit' && !f.reason?.trim()) throw new Error('কারণ লিখুন')
      if (modal === 'status') { await hr.changeStatus(e.id, f.status, f.effective, f.reason.trim()); await onChanged('অবস্থা পরিবর্তন হয়েছে') }
      if (modal === 'transfer') { await hr.transfer(e.id, { hub: f.hub, department: f.department || null, position: f.position || null, manager: e.reporting_manager_id, effective: f.effective, reason: f.reason.trim(), type: f.type }); await onChanged('বদলি/পরিবর্তন সেভ হয়েছে') }
      if (modal === 'archive') { await hr.archive(e.id, f.reason.trim()); await onChanged('আর্কাইভ করা হয়েছে — তথ্য মুছে যায়নি') }
      if (modal === 'code') { const c = await hr.correctCode(e.id, f.code.trim(), f.reason.trim()); await onChanged(`এমপ্লয়ি আইডি এখন ${c}`) }
      if (modal === 'wrong') { await hr.removeWrongEntry(e.id, f.reason.trim()); setModal(null); nav('/app/hr/employees', { replace: true }); return }
      if (modal === 'reveal') { const r = await hr.reveal(e.id, f.reason.trim()); setRevealed(r?.[0] ?? null) }
      if (modal === 'edit') {
        if (!BD_MOBILE.test(f.mobile.trim())) throw new Error('সঠিক মোবাইল নম্বর দিন')
        await hr.updateEmployee(e.id, { full_name: f.full_name.trim(), full_name_bn: f.full_name_bn.trim() || null, mobile: f.mobile.trim(), email: f.email.trim() || null,
          emergency_contact_name: f.emergency_contact_name.trim() || null, emergency_contact_phone: f.emergency_contact_phone.trim() || null })
        await onChanged('তথ্য সেভ হয়েছে')
      }
      setModal(null)
    } catch (x) { setErr(x instanceof Error && !(x as { code?: string }).code && /[ঀ-৿]/.test(x.message) ? x.message : hrFriendly(x)) } finally { setBusy(false) }
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).get('edit') === '1' && can('hr.employee.edit') && !e.archived_at && e.status !== 'applicant') open('edit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id])
  // the round "edit" button in the header asks for the form
  useEffect(() => { if (askEdit > 0) open('edit') // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askEdit])
  const year = Number(todayDhaka().slice(0, 4))
  const bal = useLoad(() => e.status === 'applicant' ? Promise.resolve([]) : hr.leaveBalance(e.id, year), [e.id, year])
  return <>
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>তথ্য</h2>
        {!e.archived_at && <div className="row nv-actrow">
          {e.status !== 'applicant' && <>
            {can('hr.employee.edit') && <button className="secondary sm" onClick={() => open('edit')}>সম্পাদনা</button>}
            {(can('hr.employee.edit') || can('hr.transfer.edit')) && <button className="secondary sm" onClick={() => open('transfer')}>বদলি / পদোন্নতি</button>}
            {(can('hr.employee.edit') || can('hr.employee.approve') || can('hr.status.edit')) && <button className="secondary sm" onClick={() => open('status')}>অবস্থা পরিবর্তন</button>}
            {can('hr.employee.archive') && <button className="danger sm" onClick={() => open('archive')}>আর্কাইভ</button>}</>}
          {e.employee_code && can('hr.employee.edit') && can('hr.application.approve') && <button className="secondary sm" onClick={() => open('code')}>আইডি সংশোধন</button>}
          {can('hr.employee.archive') && <button className="danger sm" onClick={() => open('wrong')}>ভুল এন্ট্রি — মুছুন</button>}</div>}</div>
      <div className="info-grid nv-info">
        <Info icon="key" label="এমপ্লয়ি আইডি"><strong>{e.employee_code ?? '—'}</strong></Info>
        <Info icon="user" label="নাম">{e.full_name}{e.full_name_bn ? <span className="sec">{e.full_name_bn}</span> : null}</Info>
        <Info icon="phone" label="মোবাইল">{e.mobile ? <a href={`tel:${e.mobile}`}>{e.mobile}</a> : '—'}</Info>
        <Info icon="form" label="ইমেইল">{e.email ?? '—'}</Info>
        <Info icon="hub" label="হাব">{e.hub_id ? o.names.hub[e.hub_id] ?? '—' : '—'}</Info>
        <Info icon="map" label="এরিয়া">{e.zone_id ? o.names.zone[e.zone_id] ?? '—' : '—'}</Info>
        <Info icon="org" label="বিভাগ / পদবি">{e.department_id ? o.names.dept[e.department_id] ?? '—' : '—'} / {e.position_id ? o.names.pos[e.position_id] ?? '—' : '—'}</Info>
        <Info icon="cal" label="যোগদান">{dmy(e.joining_date)}</Info>
        <Info icon="check" label="অবস্থা"><EmpBadge status={e.status} /> {e.status_since ? <span className="muted small">· {dmy(e.status_since)} থেকে</span> : null}</Info>
        <Info icon="alert" label="জরুরি যোগাযোগ">{e.emergency_contact_name ?? '—'} {e.emergency_contact_phone ? <a href={`tel:${e.emergency_contact_phone}`}>· {e.emergency_contact_phone}</a> : null}</Info>
        <Info icon="shield" label="NID" wide>{revealed ? <>{revealed.nid_number ?? '—'} · জন্ম {dmy(revealed.date_of_birth)}<span className="sec">{revealed.present_address ?? ''}</span></> : <>{nid.data ?? '—'}
          {can('hr.employee_sensitive.view') && <> <button className="link" onClick={() => open('reveal')}>পুরো দেখুন</button></>}</>}</Info>
      </div>
      {bal.data && bal.data.length > 0 && <><h3>ছুটির হিসাব {bn(year)}</h3><div className="da-mini">{bal.data.map(b =>
        <span key={b.leave_type}>{b.leave_type}: বাকি <strong>{bn(b.remaining)}</strong> / {bn(b.quota)}{b.pending ? ` (অপেক্ষমাণ ${bn(b.pending)})` : ''}</span>)}</div></>}
    </section>
    {modal && <Modal title={{ code: 'এমপ্লয়ি আইডি সংশোধন', wrong: 'ভুল এন্ট্রি — মুছুন', status: 'অবস্থা পরিবর্তন', transfer: 'বদলি / পদোন্নতি', archive: 'কর্মী আর্কাইভ', reveal: 'গোপন তথ্য দেখুন', edit: 'তথ্য সম্পাদনা' }[modal]}
      onClose={() => setModal(null)} actions={<><button className="secondary" onClick={() => setModal(null)}>বাতিল</button><button className={modal === 'archive' || modal === 'wrong' ? 'danger' : ''} disabled={busy} onClick={() => void go()}>নিশ্চিত</button></>}>
      {modal === 'status' && <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="নতুন অবস্থা"><select value={f.status} onChange={set('status')}>{(['active', 'inactive', 'resigned', 'terminated'] as EmployeeStatus[]).filter(s => s !== e.status && statusAllowed(s)).map(s => <option key={s} value={s}>{EMP_STATUS[s][0]}</option>)}</select></Field>
        <Field label="কার্যকর তারিখ"><input type="date" value={f.effective} onChange={set('effective')} /></Field></div>}
      {modal === 'transfer' && <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="ধরন"><select value={f.type} onChange={set('type')}>{['transfer', 'promotion', 'correction'].map(t => <option key={t} value={t}>{CHANGE_TYPE[t]}</option>)}</select></Field>
        <Field label="কার্যকর তারিখ"><input type="date" value={f.effective} onChange={set('effective')} /></Field>
        <Field label="হাব"><select value={f.hub} onChange={set('hub')}>{o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        <Field label="বিভাগ"><select value={f.department} onChange={set('department')}><option value="">—</option>{o.data?.departments.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        <Field label="পদবি"><select value={f.position} onChange={set('position')}><option value="">—</option>{o.data?.positions.filter(p => !f.department || p.department_id === f.department).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field></div>}
      {modal === 'edit' && <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="পূর্ণ নাম"><input value={f.full_name} onChange={set('full_name')} /></Field><Field label="নাম (বাংলা)"><input value={f.full_name_bn} onChange={set('full_name_bn')} /></Field>
        <Field label="মোবাইল"><input inputMode="tel" value={f.mobile} onChange={set('mobile')} /></Field><Field label="ইমেইল"><input value={f.email} onChange={set('email')} /></Field>
        <Field label="জরুরি যোগাযোগ (নাম)"><input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></Field>
        <Field label="জরুরি যোগাযোগ (মোবাইল)"><input inputMode="tel" value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></Field></div>}
      {modal === 'archive' && <p>কর্মীর সব তথ্য ও ইতিহাস থাকবে, শুধু তালিকা থেকে সরে যাবে।</p>}
      {modal === 'code' && <><p className="muted small">ঠিক মানুষ, কিন্তু আইডি ভুল বসেছে — এখানে ঠিক করুন। লগইন থাকলে নতুন আইডি দিয়েই ঢুকতে হবে।</p>
        <Field label={`নতুন এমপ্লয়ি আইডি (এখন ${e.employee_code ?? '—'})`} required><input inputMode="numeric" value={f.code} onChange={set('code')} /></Field></>}
      {modal === 'wrong' && <><p>ভুল করে ওঠা রেকর্ডের জন্য (ভুল লোক, একই লোক দুবার, পরীক্ষার এন্ট্রি)। রেকর্ডটি সব তালিকা থেকে সরে যাবে, আর তার আইডি ও মোবাইল নম্বর আবার ব্যবহার করা যাবে। লগইন থাকলে সেটা বন্ধ হবে।</p>
        <p className="muted small">হাজিরা, হিসাব, বেতন বা ছুটির রেকর্ড থাকলে এভাবে মোছা যাবে না। কিছুই চিরতরে মুছে যায় না; অডিট লগে থাকে।</p></>}
      {modal === 'reveal' && <p className="muted small">কেন দেখছেন তা অডিট লগে থাকবে।</p>}
      {modal !== 'edit' && <Field label="কারণ (আবশ্যক, অডিট লগে থাকবে)"><textarea rows={3} value={f.reason} onChange={set('reason')} /></Field>}
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </>
}

function Documents({ e, canUpload, onDone }: { e: Employee; canUpload: boolean; onDone: (m: string) => void }) {
  const list = useLoad(() => docs.list(e.id), [e.id])
  const [type, setType] = useState('nid_front'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const have = new Set((list.data ?? []).map(d => d.doc_type))
  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true); setErr('')
    try { await docs.upload(e.id, type, file); onDone(`${DOC_TYPE[type]} আপলোড হয়েছে`); await list.reload() } catch (x) { setErr(hrFriendly(x)) } finally { setBusy(false) }
  }
  async function view(path: string) { try { window.open(await docs.url(path), '_blank', 'noopener') } catch (x) { setErr(hrFriendly(x)) } }
  return <section className="panel">
    <h2>ডকুমেন্ট</h2>
    {e.status === 'applicant' && <div className="da-chips" style={{ marginBottom: 10 }}>{REQUIRED_DOCS.map(d =>
      <Badge key={d} tone={have.has(d) ? 'ok' : 'warn'}>{have.has(d) ? '✓' : '•'} {DOC_TYPE[d]}</Badge>)}</div>}
    {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : list.data?.length ? <div className="da-table-wrap"><table className="da-table"><thead><tr><th>ধরন</th><th>ফাইল</th><th>তারিখ</th><th>যাচাই</th><th /></tr></thead>
      <tbody>{list.data.map(d => <tr key={d.id}><td>{DOC_TYPE[d.doc_type] ?? d.doc_type}</td><td>{d.file_name}<span className="sec">{bn(Math.ceil(d.size_bytes / 1024))} KB</span></td>
        <td>{dmy(d.created_at)}</td><td>{d.verified_at ? <Badge tone="ok">যাচাই হয়েছে</Badge> : <Badge tone="neutral">বাকি</Badge>}</td>
        <td className="r"><button className="secondary sm" onClick={() => void view(d.storage_path)}>দেখুন</button></td></tr>)}</tbody></table></div> : <p className="muted">কোনো ডকুমেন্ট নেই।</p>}
    {canUpload && <div className="row" style={{ marginTop: 10 }}>
      <select value={type} onChange={ev => setType(ev.target.value)} style={{ width: 'auto', marginTop: 0 }}>{Object.entries(DOC_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label className="secondary" style={{ margin: 0, fontWeight: 600 }}><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} style={{ width: 'auto' }}
        onChange={ev => { void upload(ev.target.files?.[0]); ev.target.value = '' }} /></label>
      <span className="muted small">JPG / PNG / পিডিএফ, সর্বোচ্চ ১০ MB। আপলোডের পর ফাইল বদলানো বা মোছা যায় না।</span></div>}
    {err && <p className="da-error">{err}</p>}
  </section>
}

function History({ id }: { id: string }) {
  const o = useOrg()
  const a = useLoad(() => hr.assignments(id), [id]); const s = useLoad(() => hr.statusHistory(id), [id])
  const c = useLoad(() => pay.list(id).catch(() => []), [id])
  return <div className="da-grid2">
    <section className="panel"><h2>পদ ও হাবের ইতিহাস</h2>
      {a.data?.length ? <ul className="da-timeline">{a.data.map(x => <li key={x.id}><strong>{CHANGE_TYPE[x.change_type] ?? x.change_type}</strong> · {dmy(x.effective_from)}{x.effective_to ? ` – ${dmy(x.effective_to)}` : ' থেকে'}
        <span className="sec">{x.hub_id ? o.names.hub[x.hub_id] ?? '' : ''}{x.position_id ? ` · ${o.names.pos[x.position_id] ?? ''}` : ''}{x.reason ? ` · ${x.reason}` : ''}</span></li>)}</ul> : <p className="muted">—</p>}</section>
    <section className="panel"><h2>অবস্থার ইতিহাস</h2>
      {s.data?.length ? <ul className="da-timeline">{s.data.map(x => <li key={x.id}>{x.from_status ? `${EMP_STATUS[x.from_status as EmployeeStatus]?.[0] ?? x.from_status} → ` : ''}<strong>{EMP_STATUS[x.to_status as EmployeeStatus]?.[0] ?? x.to_status}</strong> · {dmy(x.effective_date)}
        {x.reason && <span className="sec">{x.reason}</span>}</li>)}</ul> : <p className="muted">—</p>}
      {c.data && c.data.length > 0 && <><h3>বেতন</h3><ul className="da-notes">{c.data.map(x => <li key={x.id}>{dmy(x.effective_from)} থেকে · মূল {bn(x.basic_salary)} ৳ · যাতায়াত {bn(x.transport_allowance)} ৳{Number(x.commission) ? <> · কমিশন {bn(x.commission)} ৳</> : null}
        <Badge tone={x.status === 'approved' ? 'ok' : x.status === 'pending' ? 'warn' : 'neutral'}>{x.status === 'approved' ? 'অনুমোদিত' : x.status === 'pending' ? 'অপেক্ষমাণ' : x.status}</Badge></li>)}</ul></>}
    </section>
  </div>
}

function Info({ icon, label, children, wide }: { icon: string; label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`info-item${wide ? ' wide' : ''}`}><span className="ii-ic"><Icon name={icon} size={16} /></span>
    <div className="ii-body"><small>{label}</small><div className="ii-val">{children}</div></div></div>
}
