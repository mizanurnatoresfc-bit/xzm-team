import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { hrFriendly } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { rollout, type HubProgress, type PersonProgress, type RoleGap } from '../../lib/rollout'
import { Badge, Stat, useLoad } from '../accounts/ui'

const stage = (p: PersonProgress) => !p.has_login ? 'লগইন নেই' : !p.signed_in_at ? 'এখনো ঢোকেননি' : !p.password_set ? 'পাসওয়ার্ড বদলাননি' : !p.mobile ? 'মোবাইল দেননি' : 'সম্পূর্ণ'
const TONE: Record<string, 'bad' | 'warn' | 'info' | 'ok'> = { 'লগইন নেই': 'bad', 'এখনো ঢোকেননি': 'warn', 'পাসওয়ার্ড বদলাননি': 'warn', 'মোবাইল দেননি': 'info', 'সম্পূর্ণ': 'ok' }

/** Launch tracker: hub by hub, who has a login, has signed in, has set their own password and has given a mobile number. */
export function Rollout() {
  const { can } = useAuth()
  const { n } = usePrefs()
  const prog = useLoad(() => rollout.progress(), [])
  const [hub, setHub] = useState<HubProgress | null>(null)
  const people = useLoad(() => hub ? rollout.people(hub.hub_id) : Promise.resolve([] as PersonProgress[]), [hub?.hub_id])
  const [gapTick, setGapTick] = useState(0)
  const gaps = useLoad(() => can('system.user_role.view') ? rollout.roleGaps() : Promise.resolve([] as RoleGap[]), [gapTick])
  const [busy, setBusy] = useState('')
  const [gapMsg, setGapMsg] = useState('')
  const giveRole = async (g: RoleGap) => {
    setBusy(g.employee_id); setGapMsg('')
    try { await rollout.applyRole(g.employee_id); setGapMsg(`${g.full_name}: ${g.role_name_bn ?? g.role_code} রোল দেওয়া হয়েছে / role given`); setGapTick(t => t + 1) }
    catch (e) { setGapMsg(hrFriendly(e)) }
    finally { setBusy('') }
  }
  const rows = prog.data ?? []
  const sum = (k: 'staff' | 'with_login' | 'signed_in' | 'password_set' | 'with_mobile') => rows.reduce((a, r) => a + r[k], 0)
  const of = (a: number, b: number) => `${n(a)} / ${n(b)}`
  const bar = (a: number, b: number) => <span className="ro-cell"><span className="ro-bar"><span style={{ width: `${b ? Math.round((a / b) * 100) : 0}%` }} /></span>{of(a, b)}</span>
  const when = (v: string | null) => v ? new Date(v).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

  return <AppShell title="চালু করার অগ্রগতি" subtitle="হাব ধরে ধরে: কার লগইন আছে, কে ঢুকেছেন, কে নিজের পাসওয়ার্ড বসিয়েছেন, কে মোবাইল নম্বর দিয়েছেন।"
    actions={can('system.user.create') ? <Link to="/app/users?bulk=1" className="btn-ghost">+ সব কর্মীর লগইন তৈরি</Link> : null}>
    <section className="panel ro-steps">
      <h2>ধাপে ধাপে চালু</h2>
      <ol>
        <li><b>লগইন তৈরি</b> — এক হাবের সব কর্মীর লগইন একসাথে; আইডিই লগইন, পদবি অনুযায়ী রোল।</li>
        <li><b>প্রথম লগইন</b> — প্রত্যেকে একবার ঢুকে নিজের পাসওয়ার্ড বসাবেন।</li>
        <li><b>মোবাইল নম্বর</b> — “আমার প্রোফাইল”-এ নম্বর দিলে নম্বর দিয়েও লগইন হবে।</li>
        <li><b>প্রোফাইলের তথ্য</b> — বাকি তথ্য <Link to="/app/hr/profile-gaps">প্রোফাইল পূর্ণতা</Link> পাতা ধরে পূরণ।</li>
        <li><b>দৈনন্দিন কাজ</b> — হাজিরা, ইস্যু ও অর্ডার, তারপর হিসাব খাতা। একটা হাবে ঠিকমতো চললে পরের হাব।</li>
      </ol>
    </section>
    <div className="da-stats">
      <Stat icon="users" label="সক্রিয় কর্মী" value={n(sum('staff'))} />
      <Stat icon="key" label="লগইন আছে" value={of(sum('with_login'), sum('staff'))} />
      <Stat icon="check" tone={sum('signed_in') < sum('with_login') ? 'warn' : 'ok'} label="ঢুকেছেন" value={of(sum('signed_in'), sum('with_login'))} />
      <Stat icon="shield" tone={sum('password_set') < sum('with_login') ? 'warn' : 'ok'} label="নিজের পাসওয়ার্ড" value={of(sum('password_set'), sum('with_login'))} />
      <Stat icon="phone" label="মোবাইল দিয়েছেন" value={of(sum('with_mobile'), sum('staff'))} />
    </div>
    {prog.error ? <p className="da-error">{hrFriendly(prog.error)}</p> : null}
    {(gaps.data?.length ?? 0) > 0 && <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>পদবির রোল বাকি <span className="muted small">/ Post role missing</span></h2><Badge tone="warn">{n(gaps.data!.length)}</Badge></div>
      <p className="muted small">এঁদের পদবি বদলেছে, কিন্তু নতুন পদবির রোল যিনি বদলেছেন তিনি দিতে পারেন না (যেমন হাব ম্যানেজার)। দেখে “রোল দিন” চাপুন। / Their post changed, but the person who changed it may not give the new post's role.</p>
      {gapMsg && <p className="small">{gapMsg}</p>}
      <DataTable<RoleGap> title="পদবির রোল বাকি" file="post-role-missing" prefKey="post-role-gaps" rows={gaps.data} rowKey={g => g.employee_id} cols={[
        { key: 'code', label: 'আইডি', value: g => g.employee_code ?? '' },
        { key: 'name', label: 'নাম', primary: true, value: g => g.full_name },
        { key: 'hub', label: 'হাব', value: g => g.hub_name ?? '' },
        { key: 'pos', label: 'পদবি', value: g => g.position_name_bn || g.position_name || '' },
        { key: 'role', label: 'যে রোল লাগবে', value: g => g.role_name_bn || g.role_code },
        { key: 'act', label: '', value: () => '', render: g => <button type="button" className="sm" disabled={!!busy} onClick={() => void giveRole(g)}>{busy === g.employee_id ? '…' : 'রোল দিন'}</button> },
      ]} />
    </section>}
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>হাব অনুযায়ী</h2>{prog.loading && <span className="muted small">লোড হচ্ছে…</span>}</div>
      <DataTable<HubProgress> title="চালু করার অগ্রগতি" file="rollout" rows={rows} rowKey={r => r.hub_id} onRowClick={setHub}
        empty={<p className="muted">{prog.loading ? 'লোড হচ্ছে…' : 'দেখার মতো কোনো হাব নেই।'}</p>} cols={[
          { key: 'hub', label: 'হাব', primary: true, value: r => r.hub_name, render: r => <strong>{r.hub_name}</strong> },
          { key: 'staff', label: 'কর্মী', value: r => r.staff },
          { key: 'login', label: 'লগইন আছে', value: r => of(r.with_login, r.staff), render: r => bar(r.with_login, r.staff) },
          { key: 'in', label: 'ঢুকেছেন', value: r => of(r.signed_in, r.with_login), render: r => bar(r.signed_in, r.with_login) },
          { key: 'pw', label: 'নিজের পাসওয়ার্ড', value: r => of(r.password_set, r.with_login), render: r => bar(r.password_set, r.with_login) },
          { key: 'mob', label: 'মোবাইল', value: r => of(r.with_mobile, r.staff), render: r => bar(r.with_mobile, r.staff) },
        ]} />
      <p className="muted small">হাবের নামে চাপলে নিচে ওই হাবের কর্মীদের তালিকা আসবে।</p>
    </section>
    {hub && <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{hub.hub_name} — কর্মী</h2><button type="button" className="secondary sm" onClick={() => setHub(null)}>বন্ধ</button></div>
      {people.error ? <p className="da-error">{hrFriendly(people.error)}</p> : null}
      <DataTable<PersonProgress> title={`${hub.hub_name} — চালু করার অগ্রগতি`} file={`rollout-${hub.hub_name}`} prefKey="rollout-people" rows={people.data} rowKey={p => p.employee_id}
        empty={<p className="muted">{people.loading ? 'লোড হচ্ছে…' : 'এই হাবে কোনো সক্রিয় কর্মী নেই।'}</p>} cols={[
          { key: 'code', label: 'আইডি (লগইন)', value: p => p.employee_code ?? '' },
          { key: 'name', label: 'নাম', primary: true, value: p => p.full_name },
          { key: 'pos', label: 'পদবি', value: p => p.position_name ?? '' },
          { key: 'role', label: 'রোল', value: p => p.role_name ?? '' },
          { key: 'stage', label: 'কোথায় আটকে', value: stage, render: p => <Badge tone={TONE[stage(p)]}>{stage(p)}</Badge> },
          { key: 'mobile', label: 'মোবাইল', value: p => p.mobile ?? '' },
          { key: 'last', label: 'শেষ লগইন', value: p => when(p.signed_in_at) },
        ]} />
    </section>}
  </AppShell>
}
