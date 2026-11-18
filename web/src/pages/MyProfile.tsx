import { AppShell, refreshMyPhoto, useMyPhoto } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLoad, useToast } from './accounts/ui'
import { usePrefs } from '../lib/prefs'
import { dmy, docs, hr, hrFriendly } from '../lib/hr'
import { shrink } from './MyProfileComplete'
import { referrals } from '../lib/extra'
import { supabase } from '../lib/supabase'
import { ExtraFields, ReferralPanel } from './hr/ProfileExtras'
import { EmpBadge, useOrg } from './hr/common'
import { dutiesApi, FREQ, routesApi } from '../lib/hub'
import { Badge } from './accounts/ui'
import { useState } from 'react'
import { TextInput } from '../components/inputs'
import { rollout } from '../lib/rollout'
import { BD_MOBILE, cleanMobile, rules } from '../lib/validate'

/** The signed-in staff member's own profile: own data, extra fields, whom they brought, people in hand. */
export function MyProfile() {
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const o = useOrg()
  const me = useLoad(async () => {
    const id = await referrals.myEmployeeId()
    return id ? await hr.employee(id) : null
  }, [])
  const e = me.data
  const savedPhoto = useMyPhoto()
  const [fresh, setFresh] = useState<string | null>(null)   // the picture just taken, shown before the saved copy reloads
  const [pbusy, setPbusy] = useState(false)
  const [perr, setPerr] = useState('')
  const photo = fresh ?? savedPhoto
  const { session, can } = useAuth()
  const roles = useLoad(async () => {
    const { data } = await supabase.from('user_roles').select('roles(name)').eq('user_id', session?.user.id ?? '').is('revoked_at', null)
    return ((data ?? []) as unknown as Array<{ roles: { name: string } | null }>).map(r => r.roles?.name).filter(Boolean) as string[]
  }, [session?.user.id])
  const duties = useLoad(() => e ? dutiesApi.mine(e.id).catch(() => []) : Promise.resolve([]), [e?.id])
  const myRoutes = useLoad(() => e ? routesApi.mine().catch(() => []) : Promise.resolve([]), [e?.id])
  async function changePhoto(f: File | undefined) {
    if (!f || !e) return
    setPbusy(true); setPerr('')
    try {
      await docs.upload(e.id, 'photo', await shrink(f))
      refreshMyPhoto(); setFresh(URL.createObjectURL(f)); toast(L('ছবি বদলানো হয়েছে', 'Photo updated'))
    } catch (x) { setPerr(hrFriendly(x)) } finally { setPbusy(false) }
  }
  return <AppShell title={L('আমার প্রোফাইল', 'My profile')} subtitle={e ? <>{e.employee_code ? <>{L('এমপ্লয়ি আইডি', 'Employee ID')} <strong>{e.employee_code}</strong> · </> : null}<EmpBadge status={e.status} /></> : undefined}>
    {node}
    {me.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !e ? <p className="notice">{L('আপনার লগইন এখনো কোনো কর্মীর প্রোফাইলের সাথে যুক্ত নয়। এইচআর-কে বলুন যুক্ত করে দিতে।', 'Your login is not linked to an employee profile yet. Ask HR to link it.')}</p>
      : <>
        <Link to="/app/me/complete" className="sp-cta mpc-cta" style={{ marginBottom: 12 }}><Icon name="edit" size={20} />{L('আমার প্রোফাইল পূর্ণ করুন — নিজেই লিখুন', 'Complete my profile — fill it in yourself')}</Link>
        <div className="p-hero">
          <div className="p-band" />
          <div className="p-body">
            <label className={`p-photo p-photo-edit${pbusy ? ' busy' : ''}`} title={L('ছবি বদলান', 'Change photo')}>
              {photo ? <img src={photo} alt="" /> : (e.full_name || '?').slice(0, 2).toUpperCase()}<span className="p-cam"><Icon name="upload" size={16} /></span>
              <input type="file" accept="image/*" disabled={pbusy} aria-label={L('নিজের ছবি দিন বা বদলান', 'Add or change my photo')}
                onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; void changePhoto(f) }} /></label>
            {perr && <p className="da-error" role="alert">{perr}</p>}
            <h2>{e.full_name} <EmpBadge status={e.status} /></h2>
            <div className="p-meta">
              {e.employee_code && <span><b>#</b> {e.employee_code}</span>}
              {session?.user.email && <span><Icon name="note" size={15} /> {session.user.email}</span>}
              {e.mobile && <span><Icon name="cc" size={15} /> {e.mobile}</span>}
              {e.position_id && <span><Icon name="org" size={15} /> {o.names.pos[e.position_id]}</span>}
              {e.hub_id && <span><Icon name="hub" size={15} /> {o.names.hub[e.hub_id]}</span>}
            </div>
            {!!roles.data?.length && <div className="p-roles">{roles.data.map(r => <span key={r} className="p-role">{r}</span>)}</div>}
            {can('hr.employee.edit') ? <Link to={`/app/hr/employees/${e.id}`} className="p-edit"><Icon name="edit" size={18} />{L('প্রোফাইল এডিট', 'Edit Profile')}</Link>
              : <p className="muted small">{L('কোনো তথ্য ভুল থাকলে এইচআর-কে জানান।', 'Tell HR if anything is wrong.')}</p>}
          </div>
        </div>
        {photo === null && <div className="alert-card bad"><span className="ai"><Icon name="user" size={20} /></span><span>{L('আপনার প্রোফাইলের ছবি নেই — উপরের ছবির ঘরে চেপে নিজেই দিন', 'Your photo is missing — tap the picture above and add it yourself')}</span></div>}
        <section className="panel">
          <h2>{L('আমার তথ্য', 'My details')}</h2>
          <dl className="hr-kv">
            <dt>{L('নাম', 'Name')}</dt><dd>{e.full_name}{e.full_name_bn ? ` (${e.full_name_bn})` : ''}</dd>
            <dt>{L('মোবাইল', 'Mobile')}</dt><dd><MyMobile current={e.mobile} onSaved={v => { toast(L(`মোবাইল নম্বর সেভ হয়েছে — এখন ${v} দিয়েও লগইন করা যাবে`, `Mobile saved — you can now sign in with ${v} too`)); void me.reload() }} /></dd>
            <dt>{L('হাব', 'Hub')}</dt><dd>{e.hub_id ? o.names.hub[e.hub_id] ?? '—' : '—'}</dd>
            <dt>{L('পদবি', 'Position')}</dt><dd>{e.position_id ? o.names.pos[e.position_id] ?? '—' : '—'}</dd>
            <dt>{L('যোগদান', 'Joined')}</dt><dd>{dmy(e.joining_date)}</dd>
          </dl>
          <p className="muted small">{L('কোনো তথ্য ভুল থাকলে এইচআর-কে জানান।', 'Tell HR if anything is wrong.')}</p>
        </section>
        <section className="panel">
          <h2>{L('আমার দায়িত্ব', 'My duties')}</h2>
          {duties.data?.length ? <ul className="duty-list">{duties.data.map(d => <li key={d.id} className="duty"><div style={{ flex: 1 }}><b>{d.title}</b>{' '}
            <Badge tone="info">{L(FREQ[d.frequency]?.[0] ?? d.frequency, FREQ[d.frequency]?.[1] ?? d.frequency)}</Badge>
            {d.details && <div className="muted small pre-wrap">{d.details}</div>}</div></li>)}</ul>
            : <p className="muted">{L('এখনো কোনো দায়িত্ব লেখা হয়নি।', 'No duties written yet.')}</p>}
          {myRoutes.data && myRoutes.data.length > 0 && <><h3>{L('আমার রুট', 'My routes')}</h3>
            {myRoutes.data.map(r => <div key={r.route_id} style={{ marginBottom: 8 }}><b>{r.hub_routes?.code} · {r.hub_routes?.name}</b>
              <div className="chips">{(r.hub_routes?.areas ?? []).map(a => <span key={a} className="chip">{a}</span>)}</div></div>)}</>}
        </section>
        <ExtraFields employee={e.id} zoneId={e.zone_id} self onSaved={m => toast(m)} />
        <ReferralPanel employee={e.id} zoneId={e.zone_id} self onSaved={m => toast(m)} />
      </>}
  </AppShell>
}

/** The person's own mobile number: shown, and changed here by themselves. The number also works as their login. */
function MyMobile({ current, onSaved }: { current: string | null; onSaved: (v: string) => void }) {
  const { L } = usePrefs()
  const [edit, setEdit] = useState(!current)
  const [v, setV] = useState(current ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    if (!BD_MOBILE.test(cleanMobile(v))) return setErr(L('সঠিক মোবাইল নম্বর দিন — ১১ সংখ্যা', 'Enter a valid 11-digit mobile number'))
    setBusy(true)
    try { const saved = await rollout.setMyMobile(v); setEdit(false); onSaved(saved) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  if (!edit) return <span id="mobile">{current} <button type="button" className="link small" onClick={() => { setV(current ?? ''); setEdit(true) }}>{L('বদলান', 'Change')}</button></span>
  return <span id="mobile" className="my-mobile">
    <TextInput kind="phone" value={v} onChange={setV} rules={[rules.mobile()]} placeholder="01XXXXXXXXX" label={L('মোবাইল নম্বর', 'Mobile number')} />
    <span className="row-acts"><button type="button" className="sm" disabled={busy || !v.trim()} onClick={() => void save()}>{L('সেভ করুন', 'Save')}</button>
      {current && <button type="button" className="secondary sm" onClick={() => { setEdit(false); setErr('') }}>{L('বাতিল', 'Cancel')}</button>}</span>
    <small className="muted">{L('নম্বর দিলে এমপ্লয়ি আইডির পাশাপাশি এই নম্বর দিয়েও লগইন করা যাবে।', 'Once saved you can sign in with this number as well as your Employee ID.')}</small>
    {err && <small className="field-err" role="alert">{err}</small>}
  </span>
}
