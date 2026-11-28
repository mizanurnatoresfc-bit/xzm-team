// "আমার অটো" — on the staff panel of a person who is responsible for an auto at an auto garage:
// today's answer, yes or no, one tap each. Shown only when the person has an auto. The database lets the person mark today and two days back.
import { useState } from 'react'
import { Icon } from './Icon'
import { Badge, useLoad } from '../pages/accounts/ui'
import { usePrefs } from '../lib/prefs'
import { autos } from '../lib/office'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

export function MyAutosCard() {
  const { L, n } = usePrefs()
  // An older database without the autos part answers an error; the card then simply stays hidden.
  const mine = useLoad(() => autos.mine().catch(() => []), [])
  const [err, setErr] = useState('')
  const rows = mine.data ?? []
  if (!rows.length) return null
  async function mark(id: string, given: boolean) {
    setErr('')
    try { await autos.mark(id, today(), given); await mine.reload() } catch (e) { setErr((e as { message?: string })?.message ?? String(e)) }
  }
  return <section className="panel">
    <h2>{L('আমার অটো', 'My autos')}</h2>
    <p className="muted small">{L('আজ অটো দেওয়া হয়েছে কি না — "হ্যাঁ" বা "না" চাপুন। মাসের ভাড়া "হ্যাঁ" দিন গুনে হয়।', 'Was the auto given today? Tap yes or no. The month’s rent is worked out from the yes days.')}</p>
    {err && <p className="da-error">{err}</p>}
    {rows.map(a => <div key={a.id} className="row-acts" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
      <span><b>{a.name}</b><small className="muted"> · {a.property}{a.hub ? ` · ${a.hub}` : ''} · ৳ {n(Math.round(Number(a.rate)))}/{L('দিন', 'day')}</small>
        <br /><small>{L(`এ মাসে ${n(a.given_days)} দিন · ৳ ${n(Math.round(Number(a.amount)))}`, `this month ${a.given_days} days · ৳ ${Math.round(Number(a.amount))}`)}</small></span>
      <span className="row-acts">
        {a.today == null ? <Badge tone="warn">{L('আজ বাকি', 'Today pending')}</Badge> : <Badge tone={a.today ? 'ok' : 'neutral'}>{a.today ? L('আজ: হ্যাঁ', 'Today: yes') : L('আজ: না', 'Today: no')}</Badge>}
        <button className={a.today === true ? 'sm' : 'secondary sm'} onClick={() => void mark(a.id, true)}><Icon name="check" size={14} />{L('হ্যাঁ', 'Yes')}</button>
        <button className={a.today === false ? 'sm' : 'secondary sm'} onClick={() => void mark(a.id, false)}>{L('না', 'No')}</button>
      </span>
    </div>)}
  </section>
}
