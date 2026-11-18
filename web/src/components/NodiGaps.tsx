import { useState } from 'react'
import { Badge, Field, Modal, useLoad } from '../pages/accounts/ui'
import { addDays, todayDhaka } from '../lib/dailyAccounts'
import { GAP_STATUS, GAP_STATUS_EN, KIND_BN, KIND_EN, LEAVE_BN, dayBn, gaps, type GapKind, type MyGap } from '../lib/gaps'
import { usePrefs } from '../lib/prefs'
import { NodiAvatar } from './NodiAvatar'

const KINDS: GapKind[] = ['leave', 'worked', 'other']
const KIND_TONE: Record<GapKind, string> = { leave: 'p', worked: 'g', other: 'o' }
/** How many days back the card asks about first (owner's rule: the last 3 days). */
const RECENT_DAYS = 3

/**
 * হাজিরার ফাঁকা দিনের রিপোর্ট — a person's own working days with no attendance.
 * The last 3 days are big buttons; tapping a date asks for one of three reasons. There is no separate
 * leave request: the answer is the report, and the hub manager approves it or sends it back.
 */
export function NodiGaps() {
  const { L, n } = usePrefs()
  const mine = useLoad(() => gaps.mine().catch(() => [] as MyGap[]), [])
  const [day, setDay] = useState<MyGap | null>(null)
  const [kind, setKind] = useState<GapKind | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const rows = mine.data ?? []
  if (!rows.length) return null

  const from = addDays(todayDhaka(), -RECENT_DAYS)
  // newest first: yesterday is at the top
  const open = rows.filter(r => r.status === 'waiting' || r.status === 'returned').sort((a, b) => b.work_date.localeCompare(a.work_date))
  const recent = open.filter(r => r.work_date >= from)
  const older = open.filter(r => r.work_date < from)
  const waitingCheck = rows.filter(r => r.status === 'answered').length
  const past = rows.filter(r => r.status === 'answered' || r.status === 'verified')
  const status = (r: MyGap) => L(GAP_STATUS[r.status][0], GAP_STATUS_EN[r.status])

  const pick = (r: MyGap) => { setErr(''); setDone(''); setDay(r); setKind(r.status === 'returned' ? r.kind : null); setNote(r.status === 'returned' ? r.note ?? '' : '') }
  async function send() {
    if (!day || !kind) return setErr(L('কারণ বেছে নিন', 'Pick a reason'))
    if (kind === 'other' && !note.trim()) return setErr(L('কারণ লিখুন', 'Write the reason'))
    setBusy(true); setErr('')
    try {
      await gaps.answer([day.work_date], kind, note.trim())
      setDone(L(`${dayBn(day.work_date)}-এর রিপোর্ট জমা হয়েছে — হাব ম্যানেজার অনুমোদন দেবেন`, `Report for ${day.work_date} sent — your hub manager approves it`))
      setDay(null); await mine.reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const dayBtn = (r: MyGap) => <button key={r.work_date} type="button" className={`nv-row gap-day${r.status === 'returned' ? ' back' : ''}`} onClick={() => pick(r)}>
    <span className={`nv-av sd-i ${r.status === 'returned' ? 'r' : 'o'}`}><b>{dayBn(r.work_date)}</b></span>
    <span className="tx"><b>{r.status === 'returned' ? L('ফেরত এসেছে — আবার দিন', 'Returned — answer again') : L('হাজিরা নেই — কারণ জানান', 'No attendance — tell us why')}</b>
      <span>{r.status === 'returned' && r.check_note ? `${L('ম্যানেজার', 'Manager')}: ${r.check_note}` : L('তারিখে চাপুন', 'Tap the date')}</span></span>
    <Badge tone={GAP_STATUS[r.status][1]}>{status(r)}</Badge></button>

  return <section className="panel nodi-gaps" id="att-gaps">
    <div className="ng-head"><NodiAvatar size={40} /><div><b>{L('হাজিরার ফাঁকা দিন', 'Days with no attendance')}</b>
      <div className="muted small">{recent.length
        ? L(`গত ${n(RECENT_DAYS)} দিনে ${n(recent.length)} দিনের হাজিরা নেই — তারিখে চেপে কারণ জানান`, `${recent.length} of the last ${RECENT_DAYS} days have no attendance — tap a date`)
        : L(`গত ${n(RECENT_DAYS)} দিনের সব রিপোর্ট দেওয়া আছে`, `Every report for the last ${RECENT_DAYS} days is in`)}
        {waitingCheck > 0 && ` · ${L(`${n(waitingCheck)} দিনের রিপোর্ট অনুমোদনের অপেক্ষায়`, `${waitingCheck} waiting for approval`)}`}</div></div></div>

    {recent.length > 0 && <div className="nv-rows">{recent.map(dayBtn)}</div>}
    {older.length > 0 && <details className="ng-past"><summary>{L(`আরও আগের ${n(older.length)} দিন`, `${older.length} earlier days`)}</summary>
      <div className="nv-rows">{older.map(dayBtn)}</div></details>}
    {done && <p className="notice" role="status">{done}</p>}

    {past.length > 0 && <details className="ng-past"><summary>{L(`আগের রিপোর্ট (${n(past.length)})`, `Earlier reports (${past.length})`)}</summary>
      <ul>{past.map(r => <li key={r.work_date}>{dayBn(r.work_date)} — {r.kind ? L(KIND_BN[r.kind], KIND_EN[r.kind]) : ''}
        {r.leave_status ? ` (${LEAVE_BN[r.leave_status] ?? r.leave_status})` : ''} <Badge tone={GAP_STATUS[r.status][1]}>{status(r)}</Badge></li>)}</ul></details>}

    {day && <Modal title={L(`${dayBn(day.work_date)} — হাজিরা নেই কেন?`, `${day.work_date} — why no attendance?`)} onClose={() => setDay(null)}
      actions={<><button type="button" className="secondary" onClick={() => setDay(null)}>{L('বাতিল', 'Cancel')}</button>
        <button type="button" disabled={busy || !kind || (kind === 'other' && !note.trim())} onClick={() => void send()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('জমা দিন', 'Submit')}</button></>}>
      <div className="nv-rows" role="radiogroup" aria-label={L('কারণ', 'Reason')}>
        {KINDS.map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className={`nv-row${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
          <span className={`nv-av sd-i ${KIND_TONE[k]}`}>{kind === k ? '✓' : ''}</span>
          <span className="tx"><b>{KIND_BN[k]}</b><span>{KIND_EN[k]}</span></span></button>)}
      </div>
      {kind && <Field label={kind === 'other' ? L('কী হয়েছিল *', 'What happened *') : L('কিছু বলার থাকলে (না দিলেও চলবে)', 'Anything to add (optional)')}>
        <input value={note} maxLength={500} onChange={e => setNote(e.target.value)}
          placeholder={kind === 'leave' ? L('যেমন: জ্বর ছিল, ম্যানেজারকে বলেছিলাম', 'e.g. fever, told the manager') : kind === 'worked' ? L('যেমন: ডেলিভারিতে ছিলাম', 'e.g. I was out on delivery') : L('যেমন: হাব বন্ধ ছিল', 'e.g. the hub was closed')} /></Field>}
      <p className="muted small">{L('হাব ম্যানেজার দেখে অনুমোদন দেবেন, অথবা কারণ লিখে ফেরত পাঠাবেন। আলাদা ছুটির আবেদন লাগবে না।',
        'Your hub manager approves it, or sends it back with a reason. No separate leave request is needed.')}</p>
      {err && <p className="da-error" role="alert">{err}</p>}
    </Modal>}
  </section>
}
