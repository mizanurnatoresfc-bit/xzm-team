import { useMemo, useState } from 'react'
import { askConfirm } from '../../components/ask'
import { Icon } from '../../components/Icon'
import { att, type ReopenWindow } from '../../lib/attSheet'
import { addDays, todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { announceWfChange, monthOf, useLiveLoad, wfFriendly } from '../../lib/workforce'
import { Badge, Field, useToast } from '../accounts/ui'
import { Empty, Section, fmtDay, fmtStamp, useHubList } from './shared'

/**
 * সংশোধনের জন্য খুলুন — the zonal manager opens one hub for a day, a range of days or a whole month, for some minutes, with a reason.
 * The opening is logged (who, from, to, until, why). Days already submitted become drafts, days never made can be written; a corrected
 * day is submitted as a new version. When the time is over the permission ends and the server submits whatever is still a draft.
 * The database checks everything again (att_reopen_open / att_reopen_close).
 */
export function ReopenPanel({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const hubsQ = useHubList()
  const hubs = useMemo(() => (hubsQ.data?.hubs ?? []).filter(h => !zone || h.zone_id === zone), [hubsQ.data, zone])
  const today = todayDhaka()
  const [hub, setHub] = useState('')
  const hubId = hubs.find(h => h.id === hub)?.id ?? hubs[0]?.id ?? ''
  const [from, setFrom] = useState(addDays(today, -1)); const [to, setTo] = useState(addDays(today, -1))
  const [minutes, setMinutes] = useState('60'); const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const q = useLiveLoad<ReopenWindow[]>(() => hubId ? att.reopenList(hubId) : Promise.resolve([]), [hubId], ['att_day_sheets'])

  const setDay = (d: string) => { setFrom(d); setTo(d) }
  const wholeMonth = () => { const m = monthOf(from); const end = new Date(`${m}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0); const last = end.toISOString().slice(0, 10); setFrom(m); setTo(last > today ? today : last) }
  async function open() {
    setErr('')
    const ok = await askConfirm(L(`${hubs.find(h => h.id === hubId)?.name} — ${fmtDay(from, lang)}${to !== from ? ` থেকে ${fmtDay(to, lang)}` : ''} ${n(Number(minutes))} মিনিটের জন্য খুলবেন?`, `Open ${hubs.find(h => h.id === hubId)?.name} for ${minutes} minutes?`),
      { ok: L('খুলুন', 'Open'), detail: L('জমা হওয়া দিনগুলো খসড়া হবে (আগের সংস্করণ রাখা থাকবে)। সময় পেরোলে সার্ভার সম্পূর্ণ খাতা সাবমিট করবে; অসম্পূর্ণ খাতা খোলা রেখে ম্যানেজারদের জানাবে।', 'Submitted days become drafts (the earlier version is kept). When the time is over the server submits a complete register; an unfinished one stays open and the managers are told.') })
    if (!ok) return
    setBusy(true)
    try { const r = await att.reopen(hubId, from, to, Number(minutes), reason); toast(L(`খোলা হয়েছে — ${n(r.opened)}টি জমা-দেওয়া খাতা খসড়া হয়েছে`, `Opened — ${r.opened} submitted registers are drafts again`)); setReason(''); announceWfChange(); await q.reload() }
    catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }
  async function close(w: ReopenWindow) {
    try { const k = await att.reopenClose(w.id); toast(L(`শেষ হয়েছে — সার্ভার ${n(k)}টি খাতা সাবমিট করেছে`, `Ended — the server submitted ${k} registers`)); announceWfChange(); await q.reload() }
    catch (e) { toast(wfFriendly(e)) }
  }
  const list = q.data ?? []
  return <Section title={L('সংশোধনের জন্য খুলুন', 'Open for correction')}
    hint={L('হাব ম্যানেজার আগের দিনের খাতা শুধু আপনি খুলে দিলে (নির্দিষ্ট সময়ের জন্য) লিখতে পারেন। কখন, কার জন্য, কেন খোলা হলো — সব লগে থাকে।', 'A hub manager can write a past day only while you have it open, for a set time. When, for whom and why are logged.')}>
    {node}
    <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
      <Field label={L('হাব', 'Hub')}><select value={hubId} onChange={e => setHub(e.target.value)}>{hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      <Field label={L('শুরুর তারিখ', 'From')}><input type="date" value={from} max={today} onChange={e => { if (e.target.value) { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) } }} /></Field>
      <Field label={L('শেষ তারিখ', 'To')}><input type="date" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)} /></Field>
      <Field label={L('কত মিনিট খোলা থাকবে', 'Open for (minutes)')}><input type="number" min={1} max={43200} value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>
      <Field label={L('কেন খুলছেন', 'Why')} wide><input type="text" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></Field>
    </div>
    <div className="wm-chips no-print" role="group" aria-label={L('দ্রুত বাছাই', 'Quick pick')}>
      <button type="button" className="wm-chip" onClick={() => setDay(addDays(today, -1))}>{L('গতকাল', 'Yesterday')}</button>
      <button type="button" className="wm-chip" onClick={() => setDay(addDays(today, -2))}>{L('পরশু', 'Two days ago')}</button>
      <button type="button" className="wm-chip" onClick={() => { setFrom(addDays(today, -6)); setTo(today) }}>{L('শেষ ৭ দিন', 'Last 7 days')}</button>
      <button type="button" className="wm-chip" onClick={wholeMonth}>{L('পুরো মাস', 'Whole month')}</button>
    </div>
    {err ? <p className="da-error" role="alert">{err}</p> : null}
    <p><button type="button" disabled={busy || !hubId || reason.trim().length < 3 || !(Number(minutes) >= 1)} onClick={() => void open()}><Icon name="key" size={16} />{L('খুলে দিন', 'Open it')}</button></p>
    <h3 className="wm-sub">{L('এই হাবের খোলার ইতিহাস', 'This hub’s openings')}</h3>
    {!list.length ? <Empty>{L('এখনো কিছু খোলা হয়নি।', 'Nothing opened yet.')}</Empty> :
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('দিন', 'Days')}</th><th>{L('মেয়াদ', 'Until')}</th><th>{L('কারণ', 'Why')}</th><th>{L('অনুমোদন', 'By')}</th><th>{L('অবস্থা', 'State')}</th><th /></tr></thead>
        <tbody>{list.map(w => <tr key={w.id}><td data-label={L('দিন', 'Days')}>{fmtDay(w.from, lang)}{w.to !== w.from ? ` – ${fmtDay(w.to, lang)}` : ''}</td><td data-label={L('মেয়াদ', 'Until')}>{fmtStamp(w.expires_at, lang)}</td>
          <td data-label={L('কারণ', 'Why')} className="wm-wrap">{w.reason}</td><td data-label={L('অনুমোদন', 'By')}>{w.by ?? '—'}</td>
          <td data-label={L('অবস্থা', 'State')}><Badge tone={w.status === 'open' ? 'warn' : 'neutral'}>{w.status === 'open' ? L('খোলা', 'Open') : w.status === 'expired' ? L('মেয়াদ শেষ', 'Expired') : L('শেষ করা হয়েছে', 'Ended')}</Badge></td>
          <td>{w.can_close && <button type="button" className="secondary sm" onClick={() => void close(w)}>{L('এখনই শেষ করুন', 'End now')}</button>}</td></tr>)}</tbody></table></div>}
  </Section>
}
