// লগইন সেটআপ — the hub makes the logins of its own riders and plain staff (login ID = Employee ID),
// and gives a new password to one who forgot it. Roles come from the person's post; nothing else can be chosen here.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { loginEmail } from '../../lib/rollout'
import { strongEnough, userFriendly, users } from '../../lib/users'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'

type Row = { employee_id: string; employee_code: string | null; full_name: string; position_name: string | null; position_name_bn: string | null; mobile: string | null
  role_id: string | null; role_code: string | null; can_make: boolean; user_id: string | null; login_id: string | null; must_change: boolean; last_login_at: string | null; locked: boolean }
const bn = (v: number | string) => String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])

export function HubLogins({ hub }: { hub: { id: string; name: string } }) {
  const { lang } = usePrefs()
  const { toast, node } = useToast()
  const list = useLoad(async () => {
    const { data, error } = await supabase.rpc('hub_login_list', { p_hub: hub.id })
    if (error) throw error
    return (data ?? []) as Row[]
  }, [hub.id])
  const [make, setMake] = useState<Row[] | null>(null)
  const [reset, setReset] = useState<Row | null>(null)
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [run, setRun] = useState<{ done: number; total: number; bad: string[] } | null>(null)
  const rows = list.data ?? []
  const post = (r: Row) => (lang === 'bn' && r.position_name_bn) || r.position_name || 'পদ নেই'
  const ready = rows.filter(r => r.can_make)
  const have = rows.filter(r => r.user_id)
  const cannot = rows.filter(r => !r.user_id && !r.can_make)
  const open = (who: Row[]) => { setErr(''); setPw(''); setRun(null); setMake(who) }

  async function create() {
    if (!make) return
    if (!strongEnough(pw)) return setErr('প্রথম পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।')
    setBusy(true); setErr('')
    const bad: string[] = []
    let done = 0
    setRun({ done: 0, total: make.length, bad })
    for (const r of make) {
      try {
        const res = await users.create({ email: loginEmail(r.employee_code!), full_name: r.full_name, phone: r.mobile ?? '', password: pw, role_id: r.role_id!,
          scope_type: 'hub', zone_id: null, hub_id: hub.id, employee_id: r.employee_id }) as { warning?: string | null }
        if (res?.warning) bad.push(`${r.employee_code} ${r.full_name}: ${userFriendly(res.warning)}`)
      } catch (e) { bad.push(`${r.employee_code} ${r.full_name}: ${userFriendly(e)}`) }
      done++; setRun({ done, total: make.length, bad: [...bad] })
      if (done === 2 && bad.length === 2) break   // the same refusal twice in a row is a set-up problem: stop and show it
    }
    setBusy(false); await list.reload()
    if (!bad.length) { setMake(null); toast(`${bn(done)} জনের লগইন তৈরি হয়েছে`) }
  }
  async function doReset() {
    if (!reset?.user_id) return
    if (!strongEnough(pw)) return setErr('নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।')
    setBusy(true); setErr('')
    try { await users.resetPassword(reset.user_id, pw); setReset(null); toast('নতুন পাসওয়ার্ড বসানো হয়েছে — তিনি এটা দিয়েই সরাসরি ঢুকবেন'); await list.reload() }
    catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }
  const pwBox = <Field label="পাসওয়ার্ড" hint="কমপক্ষে ৬ অক্ষর। এটা কর্মীকে মুখে বা কাগজে জানান। এটা দিয়েই তিনি সরাসরি ঢুকবেন।">
    <span className="pw" style={{ display: 'block' }}><input type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} style={{ paddingRight: 84 }} />
      <button type="button" className="secondary sm" onClick={() => setShow(s => !s)}>{show ? 'লুকান' : 'দেখুন'}</button></span></Field>

  return <div className="nv hl">
    {node}
    <section className="nv-hero">
      <div className="nv-hero-main"><span className="lbl">লগইন সেটআপ · {hub.name}</span>
        <b className="big">{bn(have.length)} / {bn(rows.length)} জনের লগইন আছে</b>
        <span className="sub">লগইন আইডি হবে কর্মীর এমপ্লয়ি আইডি। রোল তাঁর পদ অনুযায়ী নিজে থেকে বসে (রাইডার বা সাধারণ স্টাফ)।</span>
        {ready.length > 0 && <div><button type="button" onClick={() => open(ready)}><Icon name="key" size={16} /> বাকি {bn(ready.length)} জনের লগইন একসাথে বানান</button></div>}</div>
      <div className="nv-nums"><div><b>{bn(ready.length)}</b><span>বানানো বাকি</span></div><div className={cannot.length ? 'warn' : ''}><b>{bn(cannot.length)}</b><span>এখান থেকে হবে না</span></div></div>
    </section>
    {list.error ? <p className="da-error">{userFriendly(list.error)}</p> : null}
    {list.loading && !list.data ? <p className="muted">লোড হচ্ছে…</p> : <div className="nv-rows">
      {rows.map(r => <div key={r.employee_id} className="nv-row">
        <span className="nv-av">{r.full_name.slice(0, 1)}</span>
        <span className="tx"><b>{r.full_name}</b><span>{r.employee_code ? `আইডি ${r.employee_code}` : 'আইডি নেই'} · {post(r)}</span>
          <span className="who">{r.user_id ? (r.last_login_at ? 'লগইন করেছেন' : r.must_change ? 'লগইন তৈরি — এখনো ঢোকেননি' : 'লগইন আছে') + (r.locked ? ' · এখন লক' : '')
            : r.can_make ? 'লগইন নেই' : !r.employee_code ? 'আগে এমপ্লয়ি আইডি লাগবে' : 'এই পদের লগইন অ্যাডমিন বানাবেন'}</span></span>
        <span className="end">{r.user_id ? <><Badge tone="ok">লগইন আছে</Badge><button type="button" className="link small" onClick={() => { setErr(''); setPw(''); setReset(r) }}>নতুন পাসওয়ার্ড দিন</button></>
          : r.can_make ? <button type="button" className="sm" onClick={() => open([r])}>লগইন বানান</button> : <Badge>অ্যাডমিন</Badge>}</span>
      </div>)}
      {rows.length === 0 && <p className="nv-none">এই হাবে কোনো সক্রিয় কর্মী নেই।</p>}
    </div>}

    {make && <Modal title={make.length === 1 ? `লগইন বানান — ${make[0].full_name}` : `${bn(make.length)} জনের লগইন বানান`} onClose={() => !busy && setMake(null)}
      actions={<><button className="secondary" disabled={busy} onClick={() => setMake(null)}>{run && !busy ? 'বন্ধ' : 'বাতিল'}</button>
        {!(run && !busy) && <button disabled={busy} onClick={() => void create()}>{busy ? `হচ্ছে… ${bn(run?.done ?? 0)}/${bn(run?.total ?? make.length)}` : 'লগইন বানান'}</button>}</>}>
      <p className="muted small">{make.length === 1 ? `লগইন আইডি: ${make[0].employee_code}` : 'প্রত্যেকের লগইন আইডি হবে তাঁর এমপ্লয়ি আইডি; সবার প্রথম পাসওয়ার্ড একই থাকবে।'}</p>
      {!(run && !busy) && pwBox}
      {run && run.bad.length > 0 && <div className="da-error" role="alert"><b>{bn(run.bad.length)} জনের হয়নি:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{run.bad.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
      {err && <p className="da-error" role="alert">{err}</p>}
    </Modal>}
    {reset && <Modal title={`নতুন পাসওয়ার্ড — ${reset.full_name}`} onClose={() => !busy && setReset(null)}
      actions={<><button className="secondary" disabled={busy} onClick={() => setReset(null)}>বাতিল</button><button disabled={busy} onClick={() => void doReset()}>{busy ? 'হচ্ছে…' : 'পাসওয়ার্ড বসান'}</button></>}>
      <p className="muted small">লগইন আইডি: {reset.employee_code}। অ্যাকাউন্ট লক থাকলে সেটাও খুলে যাবে।</p>
      {pwBox}
      {err && <p className="da-error" role="alert">{err}</p>}
    </Modal>}
  </div>
}
