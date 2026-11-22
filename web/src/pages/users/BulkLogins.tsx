import { useMemo, useRef, useState } from 'react'
import { Combo } from '../../components/inputs'
import { Icon } from '../../components/Icon'
import { hrFriendly, org } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { roles as rolesApi } from '../../lib/roles'
import { loginEmail, rollout, type LoginCandidate } from '../../lib/rollout'
import { strongEnough, tempPassword, userFriendly, users } from '../../lib/users'
import { download, xlsxBlob } from '../../lib/xlsx'
import { Field, Modal, useLoad } from '../accounts/ui'
import { useOrg } from '../hr/common'

type Made = { c: LoginCandidate; role: string; password: string }

/** A login for every active staff member who has none: the Employee ID is the login, the role comes from the post. */
export function BulkLogins({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { n } = usePrefs()
  const o = useOrg()
  const roleList = useLoad(() => rolesApi.list(), [])
  const cands = useLoad(() => rollout.candidates(), [])
  const [picked, setPicked] = useState<Record<string, string>>({})          // post -> role chosen on this screen
  const [hub, setHub] = useState('')
  const [mode, setMode] = useState<'common' | 'each'>('common')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [run, setRun] = useState<{ at: number; total: number; made: Made[]; bad: string[]; done: boolean } | null>(null)
  const stop = useRef(false)

  const usable = (roleList.data ?? []).filter(r => !r.archived_at && !r.is_super)
  const roleName = (id: string) => { const r = usable.find(x => x.id === id); return r ? r.name_bn || r.name : '' }
  const positions = o.data?.positions ?? []
  const roleOf = (pos: string | null) => (pos ? picked[pos] ?? positions.find(p => p.id === pos)?.default_role_id ?? '' : '')
  const all = cands.data ?? []
  const inScope = all.filter(c => !hub || c.hub_id === hub)
  const ready = inScope.filter(c => c.employee_code && c.hub_id && usable.some(r => r.id === roleOf(c.position_id)))
  const noId = inScope.filter(c => !c.employee_code).length
  const noRole = inScope.filter(c => c.employee_code && !usable.some(r => r.id === roleOf(c.position_id))).length
  const byPost = useMemo(() => positions.map(p => ({ p, count: inScope.filter(c => c.position_id === p.id).length })).filter(x => x.count > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, cands.data, hub])

  async function setRole(pos: string, role: string) {
    setErr(''); setPicked(v => ({ ...v, [pos]: role }))
    // Remembered on the post itself, so a login made later for this post gets the same role.
    try { await org.update('positions', pos, { default_role_id: role || null }) } catch (e) { setErr(hrFriendly(e)) }
  }

  async function start() {
    setErr('')
    if (!ready.length) return setErr('লগইন তৈরির মতো কোনো কর্মী নেই')
    if (mode === 'common' && !strongEnough(password)) return setErr('প্রথম পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে')
    if (!window.confirm(`${ready.length} জন কর্মীর লগইন তৈরি হবে। শুরু করবেন?`)) return
    stop.current = false
    const made: Made[] = [], bad: string[] = []
    setRun({ at: 0, total: ready.length, made, bad, done: false })
    for (const [i, c] of ready.entries()) {
      if (stop.current) break
      const role = roleOf(c.position_id)
      const zoneWide = usable.find(r => r.id === role)?.code === 'zonal_manager'
      const pw = mode === 'common' ? password : tempPassword()
      try {
        const r = await users.create({ email: loginEmail(c.employee_code!), full_name: c.full_name, phone: c.mobile ?? '', password: pw, role_id: role,
          scope_type: zoneWide ? 'zone' : 'hub', zone_id: zoneWide ? c.zone_id : null, hub_id: zoneWide ? null : c.hub_id, employee_id: c.id })
        made.push({ c, role, password: pw })
        if (r.warning) bad.push(`${c.employee_code} ${c.full_name}: ${userFriendly(r.warning)}`)
      } catch (e) { bad.push(`${c.employee_code} ${c.full_name}: ${userFriendly(e)}`) }
      setRun({ at: i + 1, total: ready.length, made: [...made], bad: [...bad], done: false })
      // The same mistake on the first three in a row is a set-up problem, not a person's: stop and show it.
      if (i === 2 && !made.length) break
    }
    setRun(v => v && { ...v, done: true })
    onDone(); void cands.reload()
  }

  function sheet(made: Made[]) {
    const posName = (id: string | null) => positions.find(p => p.id === id)?.name ?? ''
    const rows = [...made].sort((a, b) => (o.names.hub[a.c.hub_id ?? ''] ?? '').localeCompare(o.names.hub[b.c.hub_id ?? ''] ?? '') || a.c.full_name.localeCompare(b.c.full_name))
    const heads = ['SL', 'Hub', 'Login ID (Employee ID)', 'Name', 'Designation', 'Role', ...(mode === 'each' ? ['First password'] : []), 'Mobile', 'Signed in (tick)']
    download(xlsxBlob('Staff logins', mode === 'common' ? 'First password: the one announced to everyone — each person must change it at first sign-in' : 'Each person must change the password at first sign-in',
      heads, rows.map((m, i) => [i + 1, o.names.hub[m.c.hub_id ?? ''] ?? '', m.c.employee_code, m.c.full_name, posName(m.c.position_id), roleName(m.role),
        ...(mode === 'each' ? [m.password] : []), m.c.mobile, ''])), `Staff-logins-${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })}.xlsx`)
  }

  if (run) return <Modal wide title="সব কর্মীর লগইন তৈরি" onClose={() => { if (run.done) onClose() }}
    actions={run.done ? <><button type="button" className="secondary" onClick={onClose}>বন্ধ করুন</button>
        {run.made.length > 0 && <button type="button" onClick={() => sheet(run.made)}><Icon name="xls" size={15} /> তালিকা (এক্সেল) নামান</button>}</>
      : <button type="button" className="secondary" onClick={() => { stop.current = true }}>থামান</button>}>
    <p><b>{n(run.at)} / {n(run.total)}</b> — {run.done ? 'শেষ হয়েছে' : 'তৈরি হচ্ছে… এই পাতা বন্ধ করবেন না'}</p>
    <div className="bl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.at}><span style={{ width: `${run.total ? (run.at / run.total) * 100 : 0}%` }} /></div>
    <p className="muted small">তৈরি হয়েছে {n(run.made.length)} জনের{run.bad.length ? `, সমস্যা ${n(run.bad.length)} জনে` : ''}।</p>
    {run.bad.length > 0 && <ul className="bl-bad">{run.bad.slice(0, 12).map((b, i) => <li key={i}>{b}</li>)}{run.bad.length > 12 && <li>… আরও {n(run.bad.length - 12)} জন</li>}</ul>}
    {run.done && run.made.length > 0 && <div className="notice">
      <b>এরপর যা করবেন</b>
      <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
        <li>তালিকা নামিয়ে হাব ম্যানেজারদের দিন — লগইন আইডি হলো এমপ্লয়ি আইডি।</li>
        <li>{mode === 'common' ? 'প্রথম পাসওয়ার্ডটা সবাইকে জানিয়ে দিন। সবাই একই পাসওয়ার্ডে ঢুকবেন, তাই যত তাড়াতাড়ি প্রত্যেকে সেটিং থেকে নিজের পাসওয়ার্ড বদলে নেন, তত নিরাপদ।' : 'প্রত্যেককে তাঁর নিজের প্রথম পাসওয়ার্ড আলাদা করে দিন।'}</li>
        <li>“চালু করার অগ্রগতি” পাতায় দেখুন কোন হাবে কে এখনো ঢোকেননি।</li></ol></div>}
    {run.done && !run.made.length && <p className="da-error">একটাও তৈরি হয়নি — উপরের কারণ দেখুন। কিছুই বদলায়নি; ঠিক করে আবার চালানো যাবে।</p>}
  </Modal>

  return <Modal wide title="সব কর্মীর লগইন তৈরি" onClose={onClose}
    actions={<><button type="button" className="secondary" onClick={onClose}>বাতিল</button>
      <button type="button" disabled={!ready.length} onClick={() => void start()}>{n(ready.length)} জনের লগইন তৈরি করুন</button></>}>
    <p className="muted small">যাঁদের এখনো লগইন নেই শুধু তাঁদের জন্য তৈরি হবে। লগইন আইডি = এমপ্লয়ি আইডি; মোবাইল নম্বর থাকলে সেটা দিয়েও ঢোকা যাবে। প্রত্যেকে এই পাসওয়ার্ড দিয়েই সরাসরি অ্যাপে ঢুকবেন।</p>
    {cands.error ? <p className="da-error">{hrFriendly(cands.error)}</p> : null}
    {roleList.error ? <p className="da-error">{userFriendly(roleList.error)}</p> : null}

    <h3 className="bl-h"><span className="rq-step">১</span>কোন হাব</h3>
    <Field label="হাব" hint="একটা একটা হাব ধরে করলে সামলানো সহজ; খালি রাখলে সব হাব">
      <Combo value={hub} onChange={setHub} placeholder="সব হাব" options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name, sub: `${all.filter(c => c.hub_id === h.id).length} জন লগইন ছাড়া` }))} /></Field>

    <h3 className="bl-h"><span className="rq-step">২</span>পদবি অনুযায়ী রোল</h3>
    {cands.loading || o.loading ? <p className="muted">লোড হচ্ছে…</p> : !byPost.length ? <p className="muted">এখানে লগইন ছাড়া কোনো সক্রিয় কর্মী নেই।</p>
      : <div className="da-table-wrap"><table className="da-table bl-map"><thead><tr><th>পদবি</th><th>কতজন</th><th>রোল</th></tr></thead>
        <tbody>{byPost.map(({ p, count }) => <tr key={p.id}><td data-label="পদবি"><b>{p.name}</b></td><td data-label="কতজন">{n(count)}</td>
          <td data-label="রোল"><select aria-label={`${p.name} — রোল`} value={usable.some(r => r.id === roleOf(p.id)) ? roleOf(p.id) : ''} onChange={e => void setRole(p.id, e.target.value)}>
            <option value="">— রোল বাছুন —</option>{usable.map(r => <option key={r.id} value={r.id}>{r.name_bn || r.name}</option>)}</select></td></tr>)}</tbody></table></div>}
    <p className="muted small">এখানে বদলালে পদবির সাথেই মনে থাকে — পরে নতুন কর্মীর লগইনেও এই রোল বসবে। রোল সব সময় কর্মীর নিজের হাবের জন্য দেওয়া হয়।</p>

    <h3 className="bl-h"><span className="rq-step">৩</span>প্রথম পাসওয়ার্ড</h3>
    <div className="da-seg" role="group" aria-label="প্রথম পাসওয়ার্ড">
      <button type="button" className={mode === 'common' ? '' : 'secondary'} aria-pressed={mode === 'common'} onClick={() => setMode('common')}>সবার জন্য একটাই</button>
      <button type="button" className={mode === 'each' ? '' : 'secondary'} aria-pressed={mode === 'each'} onClick={() => setMode('each')}>প্রত্যেকের আলাদা</button></div>
    {mode === 'common' ? <Field label="সবার প্রথম পাসওয়ার্ড" required hint="কমপক্ষে ৬ অক্ষর। এটা কোথাও জমা থাকে না — আপনি নিজে সবাইকে জানাবেন।">
        <input autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="যেমন: Natore2026" /></Field>
      : <p className="muted small">প্রত্যেকের জন্য আলাদা পাসওয়ার্ড তৈরি হবে; শেষে এক্সেল তালিকায় পাবেন। সেই তালিকা আর দেখানো হবে না।</p>}
    {mode === 'common' && <p className="notice">একই পাসওয়ার্ড সবার জানা থাকে, তাই কেউ অন্যের আইডি দিয়ে আগে ঢুকে পাসওয়ার্ড বদলে ফেলতে পারে। ঝুঁকি কমাতে হাব ধরে ধরে তৈরি করুন, আর সেদিনই সবাইকে একবার লগইন করিয়ে নিন।</p>}

    <p className="bl-sum"><b>{n(ready.length)} জনের</b> লগইন তৈরি হবে{noId ? ` · ${n(noId)} জনের এমপ্লয়ি আইডি নেই (বাদ)` : ''}{noRole ? ` · ${n(noRole)} জনের পদবির রোল ঠিক করা নেই (বাদ)` : ''}।
      {ready.length > 20 && <span className="muted"> আনুমানিক {n(Math.ceil(ready.length / 40))}–{n(Math.ceil(ready.length / 20))} মিনিট লাগবে।</span>}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
