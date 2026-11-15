import { useEffect, useState } from 'react'
import { Badge, Field, useLoad } from '../pages/accounts/ui'
import { hr } from '../lib/hr'
import { GAP_STATUS, KIND_BN, LEAVE_BN, dayBn, gaps, type GapKind } from '../lib/gaps'
import { NodiAvatar } from './NodiAvatar'

/** Home card: Nodi asks a person about their own days without attendance, and takes the answer (leave is filed from here). */
export function NodiGaps() {
  const mine = useLoad(() => gaps.mine().catch(() => []), [])
  const types = useLoad(() => hr.leaveTypes().catch(() => []), [])
  const rows = mine.data ?? []
  const open = rows.filter(r => r.status === 'waiting' || r.status === 'returned')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<GapKind>('leave')
  const [type, setType] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  // every open day is ticked to begin with
  useEffect(() => { setPicked(new Set(open.map(r => r.work_date))) }, [mine.data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null
  const waitingCheck = rows.filter(r => r.status === 'answered').length
  const toggle = (d: string) => setPicked(p => { const s = new Set(p); s.has(d) ? s.delete(d) : s.add(d); return s })
  async function send() {
    setErr(''); setDone('')
    const dates = [...picked].sort()
    if (!dates.length) return setErr('কোন কোন তারিখের জন্য — টিক দিন')
    if (kind === 'leave' && !type) return setErr('ছুটির ধরন বেছে নিন')
    if (!note.trim()) return setErr('কারণ লিখুন')
    setBusy(true)
    try {
      await gaps.answer(dates, kind, note.trim(), kind === 'leave' ? type : null)
      setNote(''); setDone(kind === 'leave' ? 'ছুটির আবেদন জমা হয়েছে — ম্যানেজার অনুমোদন দিলে হাজিরায় বসে যাবে' : 'উত্তর জমা হয়েছে'); await mine.reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return <section className="panel nodi-gaps">
    <div className="ng-head"><NodiAvatar size={40} /><div><b>নদী জিজ্ঞেস করছে</b>
      <div className="muted small">{open.length ? `আপনার ${open.length.toLocaleString('bn-BD')} দিনের হাজিরা নেই — কারণ জানান` : 'আপনার সব ফাঁকা দিনের উত্তর দেওয়া আছে'}
        {waitingCheck > 0 && ` · ${waitingCheck.toLocaleString('bn-BD')} দিনের উত্তর যাচাইয়ের অপেক্ষায়`}</div></div></div>
    {open.length > 0 && <>
      <div className="ng-days" role="group" aria-label="তারিখ">{open.map(r => <button key={r.work_date} type="button" className={`chip-toggle${picked.has(r.work_date) ? ' on' : ''}`} aria-pressed={picked.has(r.work_date)}
        onClick={() => toggle(r.work_date)} title={r.check_note ?? undefined}>{dayBn(r.work_date)}{r.status === 'returned' ? ' ↩' : ''}</button>)}</div>
      {open.some(r => r.status === 'returned') && <p className="da-error" style={{ margin: '6px 0' }}>↩ চিহ্নের উত্তর ফেরত এসেছে: {open.filter(r => r.status === 'returned').map(r => `${dayBn(r.work_date)} — ${r.check_note ?? ''}`).join(' · ')}</p>}
      <div className="da-seg" role="group" aria-label="কারণের ধরন">{(Object.keys(KIND_BN) as GapKind[]).map(k => <button key={k} type="button" className={kind === k ? '' : 'secondary'} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_BN[k]}</button>)}</div>
      <div className="da-form" style={{ marginTop: 10 }}>
        {kind === 'leave' && <Field label="ছুটির ধরন" required><select value={type} onChange={e => setType(e.target.value)}><option value="">বেছে নিন…</option>
          {(types.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name_bn || t.name}</option>)}</select></Field>}
        <Field label={kind === 'leave' ? 'ছুটির কারণ' : 'কী হয়েছিল'} required wide={kind !== 'leave'}><input value={note} onChange={e => setNote(e.target.value)}
          placeholder={kind === 'leave' ? 'যেমন: জ্বর ছিল, ম্যানেজারকে বলে ছুটি নিয়েছি' : kind === 'worked' ? 'যেমন: ডেলিভারিতে ছিলাম, খাতায় ওঠেনি' : 'যেমন: হাব বন্ধ ছিল'} /></Field>
      </div>
      <div className="row-acts" style={{ marginTop: 10 }}><button type="button" disabled={busy} onClick={() => void send()}>{busy ? 'হচ্ছে…' : kind === 'leave' ? 'ছুটির আবেদন দিন' : 'উত্তর দিন'}</button>
        <span className="muted small">{kind === 'leave' ? 'টিক দেওয়া তারিখগুলোর জন্য ছুটির আবেদন যাবে' : 'টিক দেওয়া তারিখগুলোর জন্য'}</span></div>
    </>}
    {err && <p className="da-error" role="alert">{err}</p>}
    {done && <p className="notice" role="status">{done}</p>}
    {rows.some(r => r.status !== 'waiting') && <details className="ng-past"><summary>আগের উত্তর ({rows.filter(r => r.status !== 'waiting').length.toLocaleString('bn-BD')})</summary>
      <ul>{rows.filter(r => r.status !== 'waiting').map(r => <li key={r.work_date}>{dayBn(r.work_date)} — {r.kind ? KIND_BN[r.kind] : ''}{r.leave_status ? ` (${LEAVE_BN[r.leave_status] ?? r.leave_status})` : ''} <Badge tone={GAP_STATUS[r.status][1]}>{GAP_STATUS[r.status][0]}</Badge></li>)}</ul></details>}
  </section>
}
