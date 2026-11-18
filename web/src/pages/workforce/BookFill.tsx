import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { wf, wfFriendly, type BookDay, type IsoDate, type MyBook, type SiteGroup } from '../../lib/workforce'
import { Field, Modal } from '../accounts/ui'
import { canGive, shortDate, weekdayShort } from './AbsenceApply'
import '../../workforce-book.css'

/**
 * একসাথে সব দিন — every date still to give, on one page, in three questions:
 *   ১. Steadfast ওয়েবসাইটে কোন কোন তারিখে আবেদন করেছেন?   -> absent, applied on the website; per website application its
 *      number and the day it was made (one application may cover many dates; "আরেকটি আবেদন" adds another)
 *   ২. আবেদন না করে কোন তারিখে ছিলেন না?                   -> absent, one application with the reason
 *   ৩. বাকি দিনগুলো                                           -> present (a tick the person can take off)
 * One call (wf.fill) saves all of it or nothing; every date then waits for the hub manager as usual.
 */
type Tr = (bn: string, en: string) => string
type SiteApp = { key: number; ref: string; on: IsoDate; dates: IsoDate[] }

export function BookFill({ book, onClose, onDone, onFail }: {
  book: MyBook
  onClose: () => void
  onDone: (msg: string) => void | Promise<void>
  onFail: () => void
}) {
  const { L, n, lang } = usePrefs()
  // the dates to give: may be given now, and nothing waits on them yet (missing, or returned by the manager)
  const days = useMemo(() => book.days.filter(d => canGive(book, d) && (d.state === 'missing' || d.state === 'returned')), [book])
  const [apps, setApps] = useState<SiteApp[]>([{ key: 1, ref: '', on: book.today, dates: [] }])
  const site = useMemo(() => apps.flatMap(a => a.dates).sort(), [apps])
  const [absent, setAbsent] = useState<IsoDate[]>([])
  const [restPresent, setRestPresent] = useState(true)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const flip = (list: IsoDate[], iso: IsoDate) => list.includes(iso) ? list.filter(x => x !== iso) : [...list, iso].sort()
  const toggleSite = (key: number, iso: IsoDate) => {
    setApps(list => list.map(a => a.key === key ? { ...a, dates: flip(a.dates, iso) } : { ...a, dates: a.dates.filter(x => x !== iso) }))
    setAbsent(a => a.filter(x => x !== iso))
  }
  const editApp = (key: number, patch: Partial<SiteApp>) => setApps(list => list.map(a => a.key === key ? { ...a, ...patch } : a))
  const addApp = () => setApps(list => [...list, { key: Math.max(...list.map(a => a.key)) + 1, ref: '', on: book.today, dates: [] }])
  const dropApp = (key: number) => setApps(list => list.filter(a => a.key !== key))
  const used = apps.filter(a => a.dates.length > 0)
  const needSite = used.some(a => !a.ref.trim() || !a.on || a.on > book.today)
  const toggleAbsent = (iso: IsoDate) => setAbsent(a => flip(a, iso))
  const rest = days.filter(d => !site.includes(d.date) && !absent.includes(d.date))
  const present = restPresent ? rest.map(d => d.date) : []
  const total = present.length + site.length + absent.length
  const needReason = absent.length > 0 && !reason.trim()
  const ready = total > 0 && !needReason && !needSite

  const send = async () => {
    if (!ready) return
    setBusy(true); setErr('')
    try {
      const groups: SiteGroup[] = used.map(a => ({ ref: a.ref.trim(), applied_on: a.on, dates: a.dates }))
      const r = await wf.fill({ present, site: groups, absent, reason: reason.trim() || null, note: note.trim() || null })
      await onDone(L(`জমা হয়েছে — উপস্থিত ${n(r.present)}, Steadfast-এ আবেদন ${n(r.site)}, নতুন আবেদন ${n(r.absent)} দিন। হাব ম্যানেজার দেখবেন।`,
        `Sent — present ${r.present}, applied on Steadfast ${r.site}, new application ${r.absent} day(s). Your hub manager will see it.`))
    } catch (e) { setErr(wfFriendly(e)); onFail() } finally { setBusy(false) }
  }

  return <Modal title={L('একসাথে সব দিন', 'Give all at once')} onClose={() => !busy && onClose()}
    actions={<>
      <button type="button" className="secondary" onClick={onClose} disabled={busy}>{L('বাতিল', 'Cancel')}</button>
      <button type="button" disabled={busy || !ready} onClick={() => void send()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L(`জমা দিন (${n(total)} দিন)`, `Send (${total} days)`)}</button>
    </>}>
    <p className="wf-ap-lead">{L(`${n(days.length)} দিনের হাজিরা বাকি। তিনটা প্রশ্নের উত্তর দিন — এক চাপে সব জমা হবে, পরে হাব ম্যানেজার অনুমোদন দেবেন।`,
      `${days.length} day(s) to give. Answer three questions — everything goes in one tap; your hub manager approves it.`)}</p>

    {days.length === 0 ? <div className="notice" role="status">{L('এখন দেওয়ার মতো কোনো তারিখ নেই।', 'There is no date to give right now.')}</div> : <>
      {/* ১. applied on the Steadfast website */}
      <section className="wf-fill-q" aria-label={L('Steadfast ওয়েবসাইটে আবেদন', 'Applied on the Steadfast website')}>
        <h3><span className="wf-fill-n">১</span>{L('Steadfast ওয়েবসাইটে কোন কোন তারিখে আবেদন করেছেন?', 'On which dates did you apply on the Steadfast website?')}</h3>
        <p className="muted small">{L('ওয়েবসাইটে আবেদন করে যেদিন ছুটিতে ছিলেন, সেই তারিখগুলো চাপুন। না থাকলে কিছু বাছবেন না।',
          'Tap the dates you were away after applying on the website. None? Leave it empty.')}</p>
        {apps.map((a, i) => <div key={a.key} className="wf-fill-app">
          {apps.length > 1 && <p className="wf-fill-app-h"><b>{L(`আবেদন ${n(i + 1)}`, `Application ${i + 1}`)}</b>
            <button type="button" className="secondary small" disabled={busy} onClick={() => dropApp(a.key)}>{L('সরান', 'Remove')}</button></p>}
          <Chips days={days.filter(d => !apps.some(o => o.key !== a.key && o.dates.includes(d.date)))} on={a.dates} onTap={iso => toggleSite(a.key, iso)} L={L} lang={lang} n={n} />
          {a.dates.length > 0 && <div className="wf-fill-app-f">
            <Field label={L('ওয়েবসাইটের আবেদন নম্বর', 'Website application number')} required>
              <input value={a.ref} maxLength={60} placeholder={L('যেমন: ১২৩৪৫', 'e.g. 12345')} onChange={e => editApp(a.key, { ref: e.target.value })} />
            </Field>
            <Field label={L('কোন তারিখে আবেদন করেছেন', 'Date you applied')} required>
              <input type="date" value={a.on} max={book.today} onChange={e => editApp(a.key, { on: e.target.value })} />
            </Field>
          </div>}
        </div>)}
        {site.length > 0 && site.length < days.length && <button type="button" className="secondary small" disabled={busy} onClick={addApp}>
          {L('+ আরেকটি ওয়েবসাইট আবেদন (অন্য নম্বর)', '+ Another website application (another number)')}</button>}
        {site.length > 0 && <Field label={L('নোট (ইচ্ছা হলে)', 'Note (optional)')}>
          <input value={note} maxLength={300} placeholder={L('ওয়েবসাইটে আবেদন করা আছে', 'Applied on the website')} onChange={e => setNote(e.target.value)} />
        </Field>}
      </section>

      {/* ২. absent without applying */}
      <section className="wf-fill-q" aria-label={L('আবেদন না করে অনুপস্থিত', 'Absent without applying')}>
        <h3><span className="wf-fill-n">২</span>{L('আবেদন না করে কোন তারিখে ছিলেন না?', 'On which dates were you away without applying?')}</h3>
        <p className="muted small">{L('এই তারিখগুলোর জন্য একটা অনুপস্থিতির আবেদন যাবে। না থাকলে কিছু বাছবেন না।',
          'One absence application goes for these dates. None? Leave it empty.')}</p>
        <Chips days={days.filter(d => !site.includes(d.date))} on={absent} onTap={toggleAbsent} L={L} lang={lang} n={n} />
        {absent.length > 0 && <Field label={L('কেন ছিলেন না?', 'Why were you away?')} required>
          <textarea rows={2} value={reason} maxLength={400} placeholder={L('যেমন: জ্বর, বাড়িতে জরুরি কাজ', 'e.g. fever, urgent work at home')} onChange={e => setReason(e.target.value)} />
        </Field>}
      </section>

      {/* ৩. the rest: present */}
      <section className="wf-fill-q" aria-label={L('বাকি দিন', 'The other days')}>
        <h3><span className="wf-fill-n">৩</span>{L(`বাকি ${n(rest.length)} দিন`, `The other ${rest.length} day(s)`)}</h3>
        {rest.length === 0 ? <p className="muted small">{L('আর কোনো দিন বাকি নেই।', 'No other day left.')}</p> : <>
          <label className="wf-fill-tick">
            <input type="checkbox" checked={restPresent} onChange={e => setRestPresent(e.target.checked)} />
            <span>{L('এই দিনগুলোতে আমি উপস্থিত ছিলাম', 'I was present on these days')}</span>
          </label>
          <div className="wf-fill-rest">{rest.map(d => <span key={d.date} className={restPresent ? 'on' : ''}>{shortDate(d.date, lang)}</span>)}</div>
          {!restPresent && <p className="muted small">{L('টিক না দিলে এই দিনগুলো এখন জমা হবে না — পরে একটা একটা করে দিতে পারবেন।', 'Without the tick these days are not sent now — give them one by one later.')}</p>}
        </>}
      </section>

      <p className={`wf-ap-prev${total ? ' on' : ''}`} aria-live="polite">
        {total ? <>
          <b>{L(`মোট ${n(total)} দিন`, `${total} day(s) in all`)}</b>
          <span>{[present.length && L(`উপস্থিত ${n(present.length)}`, `present ${present.length}`),
            site.length && L(`Steadfast-এ আবেদন ${n(site.length)}`, `applied on Steadfast ${site.length}`),
            absent.length && L(`নতুন আবেদন ${n(absent.length)}`, `new application ${absent.length}`)].filter(Boolean).join(' · ')}</span>
        </> : <span>{L('অন্তত একটি তারিখ দিন', 'Give at least one date')}</span>}
      </p>
      {needSite && <p className="muted small wf-ap-warn">{L('১ নম্বরে প্রতিটি আবেদনের নম্বর ও আবেদনের তারিখ দিতে হবে।', 'Under 1, give each website application its number and date.')}</p>}
      {needReason && <p className="muted small wf-ap-warn">{L('২ নম্বরে তারিখ বাছলে কারণ লিখতে হবে।', 'Write the reason for the dates under 2.')}</p>}
    </>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function Chips({ days, on, onTap, L, lang, n }: { days: BookDay[]; on: IsoDate[]; onTap: (iso: IsoDate) => void; L: Tr; lang: 'bn' | 'en'; n: (x: number | string) => string }) {
  if (days.length === 0) return <p className="muted small">{L('এখানে বাছার মতো তারিখ নেই।', 'No date to pick here.')}</p>
  return <div className="wf-ap-chips" role="group">
    {days.map(d => {
      const sel = on.includes(d.date)
      return <button key={d.date} type="button" aria-pressed={sel} className={`wf-ap-chip${sel ? ' on' : ''}${d.state === 'returned' ? ' chg' : ''}`}
        aria-label={shortDate(d.date, lang)} onClick={() => onTap(d.date)}>
        <b>{n(d.day)}</b><small>{weekdayShort(d.dow, lang)}</small>
        {sel && <span className="wf-ap-tick" aria-hidden="true"><Icon name="check" size={12} /></span>}
      </button>
    })}
  </div>
}
