// Two small forms a hub uses on its own people: fill in the profile (contact and identity details only),
// and tell the office that someone has left (a request the office approves; nothing changes until then).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { hrFriendly } from '../../lib/hr'
import { BD_MOBILE, cleanMobile } from '../../lib/validate'
import { Field, Modal, useLoad } from '../accounts/ui'

type Got = { full_name: string; employee_code: string | null; full_name_bn: string | null; mobile: string | null; email: string | null
  emergency_contact_name: string | null; emergency_contact_phone: string | null; alt_mobile: string | null; blood_group: string | null
  has: Record<'nid_number' | 'date_of_birth' | 'father_name' | 'mother_name' | 'present_address' | 'permanent_address', boolean> }
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']
const PLAIN = ['mobile', 'alt_mobile', 'full_name_bn', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone'] as const
const SECRET = ['nid_number', 'date_of_birth', 'permanent_address', 'present_address', 'father_name', 'mother_name'] as const
type Key = typeof PLAIN[number] | typeof SECRET[number]

export function ProfileFill({ employee, onClose, onDone }: { employee: string; onClose: () => void; onDone: (m: string) => void }) {
  const got = useLoad(async () => { const { data, error } = await supabase.rpc('hr_hub_profile_get', { p_employee: employee }); if (error) throw error; return data as Got }, [employee])
  const [f, setF] = useState<Record<Key, string>>({ mobile: '', alt_mobile: '', full_name_bn: '', blood_group: '', emergency_contact_name: '', emergency_contact_phone: '',
    nid_number: '', date_of_birth: '', permanent_address: '', present_address: '', father_name: '', mother_name: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const g = got.data
  useEffect(() => { if (g) setF(x => ({ ...x, ...Object.fromEntries(PLAIN.map(k => [k, g[k] ?? ''])) })) }, [g])
  const set = (k: Key) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }))
  const on = (k: typeof SECRET[number]) => (g?.has[k] ? '✓ জমা আছে — বদলাতে চাইলে নতুন করে লিখুন' : 'এখনো দেওয়া হয়নি')

  async function save() {
    if (!g) return
    setErr('')
    const p: Record<string, string> = {}
    for (const k of PLAIN) { const v = f[k].trim(); if (v !== (g[k] ?? '')) p[k] = k === 'mobile' || k === 'alt_mobile' || k === 'emergency_contact_phone' ? cleanMobile(v) : v }
    for (const k of SECRET) { const v = f[k].trim(); if (v) p[k] = v }
    for (const k of ['mobile', 'alt_mobile', 'emergency_contact_phone'] as const) if (p[k] && !BD_MOBILE.test(p[k])) return setErr('মোবাইল নম্বর ১১ সংখ্যার দিন, যেমন 01711000000')
    if (p.nid_number && !/^\d{10}$|^\d{13}$|^\d{17}$/.test(p.nid_number.replace(/\s/g, ''))) return setErr('এনআইডি নম্বর ১০, ১৩ বা ১৭ সংখ্যার হয় — মিলিয়ে দেখুন')
    if (p.nid_number) p.nid_number = p.nid_number.replace(/\s/g, '')
    if (!Object.keys(p).length) return setErr('নতুন কিছু লেখা হয়নি')
    setBusy(true)
    try { const { error } = await supabase.rpc('hr_hub_profile_save', { p_employee: employee, p }); if (error) throw error; onDone('প্রোফাইলের তথ্য সেভ হয়েছে') }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={g ? `প্রোফাইল পূর্ণ করুন — ${g.full_name}` : 'প্রোফাইল পূর্ণ করুন'} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy || !g} onClick={() => void save()}>{busy ? 'সেভ হচ্ছে…' : 'সেভ'}</button></>}>
    {got.loading && !g ? <p className="muted">লোড হচ্ছে…</p> : got.error ? <p className="da-error">{hrFriendly(got.error)}</p> : g && <>
      <p className="muted small">যা জানা আছে শুধু সেটুকু লিখুন; ফাঁকা রাখা ঘর বদলাবে না। পদ, হাব, আইডি বা অবস্থা এখান থেকে বদলানো যায় না।</p>
      <div className="da-form">
        <Field label="মোবাইল নম্বর"><input inputMode="tel" value={f.mobile} onChange={set('mobile')} placeholder="01XXXXXXXXX" /></Field>
        <Field label="বিকল্প মোবাইল"><input inputMode="tel" value={f.alt_mobile} onChange={set('alt_mobile')} placeholder="01XXXXXXXXX" /></Field>
        <Field label="নাম (বাংলায়)"><input value={f.full_name_bn} onChange={set('full_name_bn')} /></Field>
        <Field label="রক্তের গ্রুপ"><select value={f.blood_group} onChange={set('blood_group')}><option value="">—</option>{BLOOD.map(b => <option key={b} value={b}>{b}</option>)}</select></Field>
        <Field label="NID / জন্ম নিবন্ধন নম্বর" hint={on('nid_number')}><input inputMode="numeric" value={f.nid_number} onChange={set('nid_number')} autoComplete="off" /></Field>
        <Field label="জন্মতারিখ" hint={on('date_of_birth')}><input type="date" value={f.date_of_birth} onChange={set('date_of_birth')} /></Field>
        <Field label="স্থায়ী ঠিকানা" wide hint={on('permanent_address')}><input value={f.permanent_address} onChange={set('permanent_address')} /></Field>
        <Field label="বর্তমান ঠিকানা" wide hint={on('present_address')}><input value={f.present_address} onChange={set('present_address')} /></Field>
        <Field label="বাবার নাম" hint={on('father_name')}><input value={f.father_name} onChange={set('father_name')} /></Field>
        <Field label="মায়ের নাম" hint={on('mother_name')}><input value={f.mother_name} onChange={set('mother_name')} /></Field>
        <Field label="জরুরি যোগাযোগ — নাম"><input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></Field>
        <Field label="জরুরি যোগাযোগ — মোবাইল"><input inputMode="tel" value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} placeholder="01XXXXXXXXX" /></Field>
      </div>
      <p className="muted small">ছবি, এনআইডির সামনের ও পেছনের ছবি দিতে প্রোফাইলের “ডকুমেন্ট” অংশে যান।</p>
    </>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

const LEFT_KINDS = ['চাকরি ছেড়ে দিচ্ছি', 'আইডি সাময়িক বন্ধ', 'অফিস থেকে বাদ', 'অন্য কারণ']
/** "This person has left": goes to the office as an "ID inactive" request. The staff list changes only when the office approves. */
export function LeftJob({ person, onClose, onDone }: { person: { id: string; full_name: string; employee_code: string | null; hub_id: string | null; hub: string; position: string }
  onClose: () => void; onDone: (m: string) => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
  const [f, setF] = useState({ last_date: today, reason_type: LEFT_KINDS[0], reason: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function send() {
    if (f.reason.trim().length < 3) return setErr('কারণ লিখুন')
    setBusy(true); setErr('')
    try {
      const fmt = await supabase.from('hr_request_formats').select('id').eq('kind', 'id_inactive').is('archived_at', null).limit(1).maybeSingle()
      if (fmt.error || !fmt.data) throw new Error('“আইডি বন্ধ / চাকরি ছাড়া” ফরম্যাট পাওয়া যায়নি — অ্যাডমিনকে জানান')
      const { error } = await supabase.rpc('hr_request_submit', { p_format: (fmt.data as { id: string }).id, p_employee: person.id, p_hub: person.hub_id,
        p_data: { employee_code: person.employee_code ?? '', full_name: person.full_name, hub: person.hub, position: person.position, last_date: f.last_date, reason_type: f.reason_type, reason: f.reason.trim() }, p_note: null })
      if (error) throw error
      onDone('অফিসে জানানো হয়েছে — অনুমোদন হলে তালিকা থেকে সরবে')
    } catch (e) { setErr(e instanceof Error && !('code' in e) ? e.message : hrFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={`চাকরি ছেড়েছেন / আইডি বন্ধ — ${person.full_name}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>বাতিল</button><button disabled={busy} onClick={() => void send()}>{busy ? 'পাঠানো হচ্ছে…' : 'অফিসে জানান'}</button></>}>
    <p className="muted small">এটা অফিসে একটি রিকুয়েস্ট হিসেবে যাবে। অফিস অনুমোদন দিলে তবেই কর্মী তালিকা থেকে সরবেন; তার আগে কিছু বদলাবে না।</p>
    <div className="da-form">
      <Field label="শেষ কর্মদিবস"><input type="date" value={f.last_date} max={today} onChange={e => setF({ ...f, last_date: e.target.value })} /></Field>
      <Field label="ধরন"><select value={f.reason_type} onChange={e => setF({ ...f, reason_type: e.target.value })}>{LEFT_KINDS.map(k => <option key={k}>{k}</option>)}</select></Field>
      <Field label="বিস্তারিত কারণ" wide required><textarea rows={3} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
    </div>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
