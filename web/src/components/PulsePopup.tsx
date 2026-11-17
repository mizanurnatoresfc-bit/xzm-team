import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Field, Modal } from '../pages/accounts/ui'
import { pulse, pulseFriendly, type MyPulse } from '../lib/pulse'

/**
 * The zonal manager's question pops up when the app opens. "পরে দেব" hides it until the app is opened again;
 * once answered it never comes back. Loaded once per session, not on every page change.
 */
const LATER = 'xzm_pulse_later'
const later = (): string[] => { try { return JSON.parse(sessionStorage.getItem(LATER) || '[]') } catch { return [] } }
const putLater = (ids: string[]) => { try { sessionStorage.setItem(LATER, JSON.stringify(ids)) } catch { /* private mode */ } }
let cache: { user: string; list: Promise<MyPulse[]> } | null = null

export function PulsePopup({ user }: { user: string }) {
  const [list, setList] = useState<MyPulse[]>([])
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => {
    if (!user) return
    if (!cache || cache.user !== user) cache = { user, list: pulse.mine().catch(() => []) }
    let live = true
    void cache.list.then(l => { if (live) setList((l ?? []).filter(q => !later().includes(q.id))) })
    return () => { live = false }
  }, [user])
  const q = list[0]
  if (!q) return null
  const next = (id: string) => { setList(l => l.filter(x => x.id !== id)); setAnswer(null); setNote(''); setErr('')
    if (cache) cache = { ...cache, list: cache.list.then(l => l.filter(x => x.id !== id)) } }
  async function send() {
    if (q.kind !== 'text' && !answer) return setErr('হ্যাঁ বা না বাছুন')
    if (q.kind === 'text' && !note.trim()) return setErr('উত্তর লিখুন')
    setBusy(true); setErr('')
    try { await pulse.answer(q.id, q.kind === 'text' ? null : answer, note.trim() || null); next(q.id) }
    catch (e) { setErr(pulseFriendly(e)) } finally { setBusy(false) }
  }
  function postpone() { putLater([...later(), q.id]); next(q.id) }
  return <Modal title="জোনাল ম্যানেজারের প্রশ্ন" onClose={postpone}
    actions={<><button className="secondary" onClick={postpone}>পরে দেব</button>
      <button disabled={busy} onClick={() => void send()}>{busy ? 'পাঠানো হচ্ছে…' : 'পাঠান'}</button></>}>
    <div className="pulse-q">
      <span className="pulse-ic"><Icon name="alert" size={20} /></span>
      <div><b>{q.title}</b>{q.body && <p className="pre-wrap">{q.body}</p>}
        <small className="muted">{[q.from, list.length > 1 ? `আরও ${list.length - 1}টি প্রশ্ন বাকি` : null].filter(Boolean).join(' · ')}</small></div>
    </div>
    {q.kind !== 'text' && <div className="pulse-yn">
      <button type="button" className={answer === 'yes' ? 'on yes' : 'secondary'} aria-pressed={answer === 'yes'} onClick={() => setAnswer('yes')}><Icon name="check" size={20} />হ্যাঁ</button>
      <button type="button" className={answer === 'no' ? 'on no' : 'secondary'} aria-pressed={answer === 'no'} onClick={() => setAnswer('no')}><Icon name="x" size={20} />না</button>
    </div>}
    {q.kind !== 'yes_no' && <Field label={q.kind === 'text' ? 'আপনার উত্তর' : 'মন্তব্য (ইচ্ছা হলে)'}>
      <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} autoFocus={q.kind === 'text'} /></Field>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
