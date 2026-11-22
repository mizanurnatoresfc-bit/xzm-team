import { useState } from 'react'
import { REASON_META, att, type MyExplanation } from '../../lib/attSheet'
import { usePrefs } from '../../lib/prefs'
import { announceWfChange, useLiveLoad, wfFriendly } from '../../lib/workforce'
import { Badge, useToast } from '../accounts/ui'
import { fmtLong, fmtStamp } from './shared'
import '../../att-sheet.css'

/**
 * স্টাফ প্যানেল — "ব্যাখ্যা চাওয়া হয়েছে": the manager's final register asked this person to explain a "no",
 * a late arrival or an absence without telling. One reply each; it shows on the register and goes to the zonal manager.
 * Draws nothing when nothing was asked.
 */
export function MyExplanations() {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLiveLoad<MyExplanation[]>(() => att.mine(), [], ['att_explanations'])
  const [text, setText] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<Record<string, string>>({})
  const list = q.data ?? []
  if (!list.length) return null
  const open = list.filter(x => !x.reply).length

  async function send(x: MyExplanation) {
    setBusy(x.id); setErr(e => ({ ...e, [x.id]: '' }))
    try { await att.reply(x.id, (text[x.id] ?? '').trim()); toast(L('জবাব পাঠানো হয়েছে', 'Reply sent')); announceWfChange(); await q.reload() }
    catch (e) { setErr(v => ({ ...v, [x.id]: wfFriendly(e) })) } finally { setBusy('') }
  }

  return <section className="panel" style={{ marginBottom: 14 }} aria-labelledby="as-mine-h">
    {node}
    <h2 id="as-mine-h" style={{ marginTop: 0 }}>{L('হাজিরার ব্যাখ্যা চাওয়া হয়েছে', 'Attendance: you are asked to explain')}
      {open > 0 && <> <Badge tone="warn">{L(`${n(open)}টি জবাব বাকি`, `${open} to answer`)}</Badge></>}</h2>
    <ul className="as-mine">{list.map(x => <li key={x.id} className={x.reply ? '' : 'open'}>
      <span><b>{fmtLong(x.work_date, lang)}</b>{x.hub ? ` · ${x.hub}` : ''}</span>
      <span><Badge tone={x.reply ? 'info' : 'warn'}>{L(REASON_META[x.reason].bn, REASON_META[x.reason].en)}</Badge>
        {x.reason === 'late' && x.late_time ? ` ${L('এসেছেন', 'arrived')} ${x.late_time}` : ''}</span>
      {x.reply ? <p style={{ margin: 0 }}><b>{L('আপনার জবাব:', 'Your reply:')}</b> {x.reply} <small className="muted">({fmtStamp(x.replied_at, lang)})</small></p> : <>
        <textarea rows={2} maxLength={1000} value={text[x.id] ?? ''} placeholder={L('কারণ লিখুন…', 'Write the reason…')} aria-label={L('জবাব', 'Reply')}
          onChange={e => setText(v => ({ ...v, [x.id]: e.target.value }))} />
        <div><button type="button" disabled={busy === x.id || !(text[x.id] ?? '').trim()} onClick={() => void send(x)}>{L('জবাব সাবমিট করুন', 'Submit reply')}</button></div>
        {err[x.id] ? <p className="da-error" role="alert">{err[x.id]}</p> : null}</>}
    </li>)}</ul>
  </section>
}
