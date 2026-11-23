import { askConfirm } from '../../components/ask'
import { useState } from 'react'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { PULSE_KIND, pulse, pulseFriendly, type PulseKind, type PulseResult, type PulseRow } from '../../lib/pulse'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'

/**
 * জোনাল ড্যাশবোর্ড → সবার কাছে প্রশ্ন: the zonal manager asks the zone (or some hubs / posts) one question; it pops up on
 * everyone's home screen with a push notification, and the answers come back here — counts, who said what, who has not answered.
 */
export function PulsePanel({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const q = useLoad(() => zone ? pulse.list(zone) : Promise.resolve([] as PulseRow[]), [zone])
  type F = { title: string; body: string; kind: PulseKind; who: 'zone' | 'hubs' | 'posts'; hubs: string[]; posts: string[]; closes: string }
  const [f, setF] = useState<F | null>(null)
  const [open, setOpen] = useState<PulseRow | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const hubs = (o.data?.hubs ?? []).filter(h => !h.archived_at && h.zone_id === zone)
  const posts = (o.data?.positions ?? []).filter(p => !p.archived_at)
  const pos = (id: string) => { const p = posts.find(x => x.id === id); return p ? (lang === 'bn' ? p.name_bn || p.name : p.name) : '' }
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  async function send() {
    if (!f) return
    if (f.title.trim().length < 2) return setErr(L('প্রশ্নটা লিখুন', 'Write the question'))
    if (f.who === 'hubs' && !f.hubs.length) return setErr(L('অন্তত একটা হাব বাছুন', 'Pick at least one hub'))
    if (f.who === 'posts' && !f.posts.length) return setErr(L('অন্তত একটা পদ বাছুন', 'Pick at least one post'))
    setBusy(true); setErr('')
    try {
      await pulse.create({ zone, title: f.title.trim(), body: f.body.trim() || null, kind: f.kind, hubs: f.who === 'hubs' ? f.hubs : [],
        positions: f.who === 'posts' ? f.posts : [], closes: f.closes || null })
      setF(null); await q.reload(); toast(L('প্রশ্ন পাঠানো হয়েছে — সবার ফোনে নোটিফিকেশন গেছে', 'Sent — everyone got a notification'))
    } catch (e) { setErr(pulseFriendly(e)) } finally { setBusy(false) }
  }
  async function close(r: PulseRow) {
    if (!await askConfirm(L('প্রশ্নটা বন্ধ করবেন?', 'Close this question?'), { detail: L('এরপর আর কেউ উত্তর দিতে পারবে না।', 'Nobody can answer after this.'), ok: L('বন্ধ করুন', 'Close it'), danger: true })) return
    try { await pulse.close(r.id); await q.reload() } catch (e) { setErr(pulseFriendly(e)) }
  }
  const rows = q.data ?? []
  const dt = (t: string) => new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const target = (r: PulseRow) => r.hub_ids.length ? `${n(r.hub_ids.length)} ${L('টি হাব', 'hubs')}` : r.position_ids.length ? r.position_ids.map(pos).join(', ') : L('পুরো জোন', 'Whole zone')

  return <section className="panel pulse-panel">{node}
    <div className="da-bar"><h2 style={{ margin: 0 }}><Icon name="bell" size={18} /> {L('সবার কাছে প্রশ্ন (পপআপ)', 'Ask everyone (popup)')}</h2>
      {zone && <button onClick={() => { setErr(''); setF({ title: '', body: '', kind: 'yes_no', who: 'zone', hubs: [], posts: [], closes: '' }) }}><Icon name="plus" size={15} />{L('নতুন প্রশ্ন', 'New question')}</button>}</div>
    {!zone ? <p className="muted">{L('উপরে একটা জোন বাছুন।', 'Pick a zone above.')}</p>
    : <>
      <p className="muted small">{L('প্রশ্নটা সবার ফোনে নোটিফিকেশন হিসেবে যায়, আর অ্যাপ খুললেই পপআপ হয়ে আসে। উত্তর না দেওয়া পর্যন্ত প্রতিবার অ্যাপ খুললে আবার আসবে।',
        'It goes to everyone as a phone notification and pops up when they open the app, until they answer.')}</p>
      {err && !f && <p className="da-error">{err}</p>}
      {q.error ? <p className="da-error">{pulseFriendly(q.error)}</p> : !rows.length ? <p className="muted">{L('এখনো কোনো প্রশ্ন পাঠানো হয়নি।', 'No questions yet.')}</p>
      : <div className="pulse-list">{rows.map(r => { const pct = r.targets ? Math.round(100 * r.answered / r.targets) : 0
          return <article key={r.id} className="pulse-card">
            <header><b>{r.title}</b><Badge tone={r.status === 'open' ? 'ok' : 'neutral'}>{r.status === 'open' ? L('চলছে', 'Open') : L('বন্ধ', 'Closed')}</Badge></header>
            <small className="muted">{[L(PULSE_KIND[r.kind][0], PULSE_KIND[r.kind][1]), target(r), dt(r.created_at)].join(' · ')}</small>
            <div className="pulse-bar" role="img" aria-label={L(`${n(r.targets)} জনের মধ্যে ${n(r.answered)} জন উত্তর দিয়েছেন`, `${r.answered} of ${r.targets} answered`)}><i style={{ width: `${pct}%` }} /></div>
            <div className="pulse-nums">
              <span><b>{n(r.answered)}</b>/{n(r.targets)} {L('উত্তর', 'answered')}</span>
              {r.kind !== 'text' && <><span className="yes"><b>{n(r.yes)}</b> {L('হ্যাঁ', 'yes')}</span><span className="no"><b>{n(r.no)}</b> {L('না', 'no')}</span></>}
              <span className="muted">{n(r.targets - r.answered)} {L('জন বাকি', 'left')}</span>
            </div>
            <div className="row-acts"><button className="sm" onClick={() => setOpen(r)}><Icon name="eye" size={14} />{L('উত্তরগুলো দেখুন', 'See answers')}</button>
              {r.status === 'open' && <button className="secondary sm" onClick={() => void close(r)}>{L('বন্ধ করুন', 'Close')}</button>}</div>
          </article> })}</div>}
    </>}

    {f && <Modal wide title={L('সবার কাছে নতুন প্রশ্ন', 'New question for everyone')} onClose={() => setF(null)}
      actions={<><button className="secondary" onClick={() => setF(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void send()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('পাঠান', 'Send')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('প্রশ্ন', 'Question')} wide required><input value={f.title} autoFocus onChange={e => setF({ ...f, title: e.target.value })} placeholder={L('যেমন: আজ সকালের গাড়ি সময়মতো এসেছে?', 'e.g. Did the morning vehicle come on time?')} /></Field>
        <Field label={L('বিস্তারিত (ইচ্ছা হলে)', 'Details (optional)')} wide><textarea rows={2} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field>
        <Field label={L('উত্তর কীভাবে', 'How to answer')}><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as PulseKind })}>
          {(Object.keys(PULSE_KIND) as PulseKind[]).map(k => <option key={k} value={k}>{L(PULSE_KIND[k][0], PULSE_KIND[k][1])}</option>)}</select></Field>
        <Field label={L('শেষ দিন (ইচ্ছা হলে)', 'Last day (optional)')}><input type="date" value={f.closes} onChange={e => setF({ ...f, closes: e.target.value })} /></Field>
      </div>
      <h3>{L('কার কাছে যাবে', 'Who gets it')}</h3>
      <div className="da-seg">{([['zone', 'পুরো জোন', 'Whole zone'], ['hubs', 'কিছু হাব', 'Some hubs'], ['posts', 'কিছু পদ', 'Some posts']] as const).map(([k, b, e]) =>
        <button key={k} type="button" className={f.who === k ? 'sm' : 'secondary sm'} onClick={() => setF({ ...f, who: k })}>{L(b, e)}</button>)}</div>
      {f.who === 'hubs' && <div className="pulse-chips">{hubs.map(h => <label key={h.id} className={`chip-toggle${f.hubs.includes(h.id) ? ' on' : ''}`}>
        <input type="checkbox" checked={f.hubs.includes(h.id)} onChange={() => setF({ ...f, hubs: toggle(f.hubs, h.id) })} />{h.name}</label>)}</div>}
      {f.who === 'posts' && <div className="pulse-chips">{posts.map(p => <label key={p.id} className={`chip-toggle${f.posts.includes(p.id) ? ' on' : ''}`}>
        <input type="checkbox" checked={f.posts.includes(p.id)} onChange={() => setF({ ...f, posts: toggle(f.posts, p.id) })} />{pos(p.id)}</label>)}</div>}
      {err && <p className="da-error">{err}</p>}
    </Modal>}
    {open && <Results row={open} onClose={() => setOpen(null)} />}
  </section>
}

function Results({ row, onClose }: { row: PulseRow; onClose: () => void }) {
  const { L, lang } = usePrefs()
  const q = useLoad(() => pulse.results(row.id), [row.id])
  const [only, setOnly] = useState<'' | 'yes' | 'no' | 'none'>('')
  const rows = (q.data ?? []).filter(r => !only || (only === 'none' ? !r.answered_at : r.answer === only))
  const dt = (t: string) => new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return <Modal wide title={row.title} onClose={onClose} actions={<button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button>}>
    <span className="da-seg">{([['', 'সবাই', 'Everyone'], ['yes', 'হ্যাঁ', 'Yes'], ['no', 'না', 'No'], ['none', 'উত্তর দেয়নি', 'Not answered']] as const)
      .filter(([k]) => row.kind !== 'text' || (k !== 'yes' && k !== 'no'))
      .map(([k, b, e]) => <button key={k} type="button" className={only === k ? 'sm' : 'secondary sm'} onClick={() => setOnly(k)}>{L(b, e)}</button>)}</span>
    {q.error ? <p className="da-error">{pulseFriendly(q.error)}</p> : <DataTable<PulseResult> title={row.title} file="pulse-answers" rows={q.data ? rows : null} rowKey={r => r.employee_id}
      empty={<p className="muted">{L('কেউ নেই।', 'Nobody.')}</p>}
      cols={[
        { key: 'name', label: L('নাম', 'Name'), value: r => r.full_name, render: r => <><strong>{r.full_name}</strong><span className="sec">{[r.employee_code, r.position].filter(Boolean).join(' · ')}</span></> },
        { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name ?? '' },
        { key: 'ans', label: L('উত্তর', 'Answer'), value: r => r.answer === 'yes' ? L('হ্যাঁ', 'Yes') : r.answer === 'no' ? L('না', 'No') : r.answered_at ? '' : L('দেয়নি', 'Not yet'),
          render: r => r.answer ? <Badge tone={r.answer === 'yes' ? 'ok' : 'bad'}>{r.answer === 'yes' ? L('হ্যাঁ', 'Yes') : L('না', 'No')}</Badge>
            : r.answered_at ? null : <Badge tone="warn">{r.has_login ? L('দেয়নি', 'Not yet') : L('লগইন নেই', 'No login')}</Badge> },
        { key: 'note', label: L('লেখা', 'Written'), value: r => r.note ?? '', render: r => r.note ? <span className="pre-wrap">{r.note}</span> : '' },
        { key: 'at', label: L('কখন', 'When'), value: r => r.answered_at ? dt(r.answered_at) : '' },
        { key: 'mob', label: L('মোবাইল', 'Mobile'), value: r => r.mobile ?? '', render: r => r.mobile ? <a href={`tel:${r.mobile}`}>{r.mobile}</a> : '' },
      ]} />}
  </Modal>
}
