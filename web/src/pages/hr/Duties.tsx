import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { hrFriendly, type Employee } from '../../lib/hr'
import { dutiesApi, FREQ, type Duty } from '../../lib/hub'
import { supabase } from '../../lib/supabase'
import { useOrg } from './common'

/** Duties for every post (e.g. Data Entry, Manager) and extra duties for one person. */
export function Duties() {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const [tab, setTab] = useState<'post' | 'person'>('post')
  const [pos, setPos] = useState('')
  const [code, setCode] = useState(''); const [person, setPerson] = useState<Employee | null>(null); const [msg, setMsg] = useState('')
  useEffect(() => { if (!pos && o.data?.positions[0]) setPos(o.data.positions[0].id) }, [o.data, pos])
  const list = useLoad(() => tab === 'post' ? (pos ? dutiesApi.ofPosition(pos) : Promise.resolve([])) : (person ? dutiesApi.ofEmployee(person.id) : Promise.resolve([])), [tab, pos, person])
  const postDuties = useLoad(() => tab === 'person' && person?.position_id ? dutiesApi.ofPosition(person.position_id) : Promise.resolve([] as Duty[]), [tab, person])
  const [f, setF] = useState<{ id?: string; title: string; details: string; frequency: string; sort: string; zone: string } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const editable = can('hr.duty.edit')
  async function find() {
    setMsg(''); setPerson(null)
    const c = code.trim().replace(/^[a-z]+-/i, '')
    if (!c) return
    const { data } = await supabase.from('employees').select('*').eq('employee_code', c).is('archived_at', null).limit(1)
    const e = ((data ?? [])[0] ?? null) as Employee | null
    if (!e) setMsg(L('এই আইডির কাউকে পাওয়া যায়নি', 'Nobody with this ID')); setPerson(e)
  }
  async function save() {
    if (!f) return
    if (f.title.trim().length < 2) return setErr(L('দায়িত্বের নাম লিখুন', 'Write the duty'))
    setBusy(true); setErr('')
    try {
      await dutiesApi.save({ position_id: tab === 'post' ? pos : null, employee_id: tab === 'person' ? person!.id : null,
        zone_id: tab === 'person' ? person!.zone_id : (f.zone || null), title: f.title.trim(), details: f.details.trim() || null,
        frequency: f.frequency, sort: Number(f.sort) || 100 }, f.id)
      setF(null); await list.reload(); toast(L('সেভ হয়েছে', 'Saved'))
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(d: Duty) {
    if (!window.confirm(L(`"${d.title}" মুছবেন?`, `Remove "${d.title}"?`))) return
    try { await dutiesApi.remove(d.id); await list.reload() } catch (e) { setErr(hrFriendly(e)) }
  }
  const card = (d: Duty, own: boolean) => <li key={d.id} className="duty">
    <span className="duty-ic"><Icon name="tasks" size={16} /></span>
    <div style={{ flex: 1, minWidth: 0 }}><b>{d.title}</b> <Badge tone="info">{L(FREQ[d.frequency]?.[0] ?? d.frequency, FREQ[d.frequency]?.[1] ?? d.frequency)}</Badge>
      {!own && <Badge tone="neutral">{L('পদের দায়িত্ব', 'From the post')}</Badge>}
      {d.details && <div className="muted small pre-wrap">{d.details}</div>}</div>
    {own && editable && <span className="row-acts">
      <button className="secondary sm" onClick={() => { setErr(''); setF({ id: d.id, title: d.title, details: d.details ?? '', frequency: d.frequency, sort: String(d.sort), zone: d.zone_id ?? '' }) }}><Icon name="edit" size={14} /></button>
      <button className="secondary sm" onClick={() => void remove(d)}><Icon name="trash" size={14} /></button></span>}
  </li>
  const ready = tab === 'post' ? !!pos : !!person
  return <AppShell title={L('কাজের দায়িত্ব', 'Duties')} subtitle={L('প্রতিটি পদের দায়িত্ব, আর কারো বাড়তি দায়িত্ব থাকলে তার নামে। কর্মী নিজের প্রোফাইলে দেখতে পান।',
    'Duties of each post, and extra duties for a person. Staff see theirs on their profile.')}>
    {node}
    <section className="da-filters panel no-print hub-top">
      <div className="da-seg"><button className={tab === 'post' ? '' : 'secondary'} onClick={() => setTab('post')}>{L('পদ অনুযায়ী', 'By post')}</button>
        <button className={tab === 'person' ? '' : 'secondary'} onClick={() => setTab('person')}>{L('কর্মী অনুযায়ী', 'By person')}</button></div>
      {tab === 'post' ? <Field label={L('পদবি', 'Post')}><select value={pos} onChange={e => setPos(e.target.value)}>
        {o.data?.positions.filter(p => !p.archived_at).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        : <Field label={L('এমপ্লয়ি আইডি', 'Employee ID')} hint={msg ? <span className="bad">{msg}</span> : person ? <b>{person.full_name} · {person.position_id ? o.names.pos[person.position_id] : ''}</b> : undefined}>
          <input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} onBlur={() => void find()} onKeyDown={e => { if (e.key === 'Enter') void find() }} /></Field>}
    </section>
    <section className="panel">
      <div className="da-bar"><h2>{tab === 'post' ? `${L('দায়িত্ব', 'Duties')} — ${o.names.pos[pos] ?? ''}` : person ? `${L('দায়িত্ব', 'Duties')} — ${person.full_name}` : L('দায়িত্ব', 'Duties')}
        {' '}<span className="count-pill">{n(list.data?.length ?? 0)}</span></h2>
        {editable && ready && <button onClick={() => { setErr(''); setF({ title: '', details: '', frequency: 'daily', sort: String(((list.data?.length ?? 0) + 1) * 10), zone: '' }) }}><Icon name="plus" size={15} />{L('দায়িত্ব যোগ', 'Add duty')}</button>}</div>
      {err && !f && <p className="da-error">{err}</p>}
      {!ready ? <p className="muted">{tab === 'post' ? L('পদবি বেছে নিন।', 'Choose a post.') : L('কর্মীর এমপ্লয়ি আইডি লিখুন।', 'Type the employee ID.')}</p>
        : list.error ? <p className="da-error">{hrFriendly(list.error)}</p>
        : <ul className="duty-list">{(list.data ?? []).map(d => card(d, true))}{tab === 'person' && (postDuties.data ?? []).map(d => card(d, false))}
          {!list.data?.length && !(tab === 'person' && postDuties.data?.length) && <li className="muted">{L('এখনো কোনো দায়িত্ব লেখা হয়নি।', 'No duties written yet.')}</li>}</ul>}
    </section>
    {f && <Modal title={f.id ? L('দায়িত্ব এডিট', 'Edit duty') : L('নতুন দায়িত্ব', 'New duty')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('দায়িত্ব', 'Duty')} wide><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder={L('যেমন: সকাল ৯টার মধ্যে হাজিরা খাতা আপডেট', 'e.g. Update attendance by 9am')} /></Field>
        <Field label={L('কতদিন পর পর', 'How often')}><select value={f.frequency} onChange={e => setF({ ...f, frequency: e.target.value })}>
          {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></Field>
        <Field label={L('ক্রম', 'Order')}><input inputMode="numeric" value={f.sort} onChange={e => setF({ ...f, sort: e.target.value })} /></Field>
        {tab === 'post' && <Field label={L('কোথায় খাটবে', 'Applies in')} hint={L('জোনাল ম্যানেজার শুধু নিজের জোনের জন্য লিখতে পারেন', 'Zonal managers write for their zone')}>
          <select value={f.zone} onChange={e => setF({ ...f, zone: e.target.value })}><option value="">{L('পুরো কোম্পানি', 'Whole company')}</option>
            {o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
        <Field label={L('বিস্তারিত', 'Details')} wide><textarea rows={4} value={f.details} onChange={e => setF({ ...f, details: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </AppShell>
}
