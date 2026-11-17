import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { ACTION_META, APP_META, LIVE, RECORD_META, STATE_META, announceWfChange, dayLabel, monthLabel, monthOf, useLiveLoad, wf, wfFriendly,
  type AbsenceApp, type BookDay, type IsoDate, type Kind, type MyBook } from '../../lib/workforce'
import { Badge, Field, Modal, useToast } from '../accounts/ui'
import { AbsenceApply, longDate, shortDate, stamp, weekdayShort } from './AbsenceApply'
import '../../workforce-book.css'

/**
 * আমার উপস্থিতি — the monthly attendance book of one staff member.
 * The book is open from day 1 to day 17 (settings); each date is given separately: "উপস্থিত ছিলাম" or "উপস্থিত ছিলাম না".
 * Absent asks "ওয়েবসাইটে আবেদন করেছেন কি?": yes -> one tap; no -> pick the absence dates and send an application.
 * Everything is read through wf.myBook (one call) and written through wf.submit / wf.apply / wf.cancelApplication; the rules live in the database.
 * Past months are an archive (read only). Usable on its own inside any page (no page frame here).
 */
const SITE_NOTE = 'ওয়েবসাইটে আবেদন করা আছে'
type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'
type Tr = (bn: string, en: string) => string
const kindText = (k: Kind, L: Tr) => k === 'present' ? L('উপস্থিত ছিলাম', 'I was present') : L('উপস্থিত ছিলাম না', 'I was not present')
const recordText = (code: string, L: Tr) => { const m = RECORD_META[code]; return m ? L(m.bn, m.en) : code }

export function AttendanceBook() {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const [month, setMonth] = useState<IsoDate | null>(null)            // null = this month, chosen by the server (Dhaka date)
  const q = useLiveLoad(() => wf.myBook(month), [month], LIVE.mine)
  const book = q.data
  const [sheet, setSheet] = useState<IsoDate | null>(null)            // the date whose sheet is open
  const [withdraw, setWithdraw] = useState<AbsenceApp | null>(null)
  const [wdBusy, setWdBusy] = useState(false)
  const [wdErr, setWdErr] = useState('')
  const [histOpen, setHistOpen] = useState(false)
  const rows = useRef<Record<string, HTMLElement | null>>({})
  // The staff panel's "আজ আসব না" arrives as ?give=today: open today's sheet once (it asks the website question).
  const [sp, setSp] = useSearchParams()
  const giveToday = sp.get('give') === 'today'
  useEffect(() => {
    if (!giveToday || !book || book.month !== monthOf(book.today)) return
    const t = book.days.find(d => d.date === book.today)
    if (t && book.open && (t.state === 'missing' || t.state === 'returned' || (t.state === 'waiting' && !t.application_id))) setSheet(t.date)
    const next = new URLSearchParams(sp); next.delete('give'); setSp(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giveToday, book])

  // ---- nothing to show yet
  if (!book) {
    if (q.error) return <div className="wf-bk">
      <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
      <button type="button" className="secondary wf-bk-btn" onClick={() => void q.reloadLoud()}>{L('আবার চেষ্টা করুন', 'Try again')}</button></div>
    if (q.loading) return <div className="wf-bk"><p className="muted" role="status">{L('হাজিরা বই লোড হচ্ছে…', 'Loading the attendance book…')}</p></div>
    return <div className="wf-bk"><div className="notice" role="status"><b>{L('আপনার লগইনের সাথে কর্মী প্রোফাইল যুক্ত নেই।', 'No staff profile is linked to your login.')}</b>
      <p style={{ margin: '4px 0 0' }}>{L('এইচআর বা হাব ম্যানেজারকে বলুন লগইনটি আপনার এমপ্লয়ি আইডির সাথে যুক্ত করে দিতে।', 'Ask HR or your hub manager to link this login to your employee ID.')}</p></div></div>
  }

  const thisMonth = monthOf(book.today)
  const wanted = month ?? thisMonth
  const mismatch = book.month !== wanted                      // the picker moved; the new month is on its way (or could not be loaded)
  const stale = mismatch && (q.loading || !!q.error)
  const archive = book.month !== thisMonth
  const todo = book.open ? book.days.filter(d => d.state === 'missing' || d.state === 'returned') : []
  const first = todo[0] ?? null
  const missingN = todo.filter(d => d.state === 'missing').length
  const returnedN = todo.length - missingN
  const closedN = book.days.filter(d => d.state === 'closed').length
  const dayOf = (iso: IsoDate) => book.days.find(d => d.date === iso) ?? null
  const sheetDay = sheet ? dayOf(sheet) : null

  const after = async (msg: string) => { setSheet(null); await q.reload(); announceWfChange(); toast(msg) }
  const openDay = (d: BookDay) => { rows.current[d.date]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setSheet(d.date) }
  const doWithdraw = async () => {
    if (!withdraw) return
    setWdBusy(true); setWdErr('')
    try { await wf.cancelApplication(withdraw.id); setWithdraw(null); await q.reload(); announceWfChange(); toast(L('আবেদন তুলে নেওয়া হয়েছে', 'Application withdrawn')) }
    catch (e) { setWdErr(wfFriendly(e)); void q.reload() } finally { setWdBusy(false) }
  }

  const s = book.summary
  const chips: Array<[string, number, Tone]> = [
    [L('উপস্থিত', 'Present'), s.present, 'ok'], [L('দেরি', 'Late'), s.late, 'warn'], [L('অর্ধদিবস', 'Half day'), s.half_day, 'warn'],
    [L('অনুপস্থিত', 'Absent'), s.absent, 'bad'], [L('ছুটি', 'Leave'), s.leave, 'info'], [L('অপেক্ষায়', 'Waiting'), s.waiting, 'info'],
    [L('ফেরত', 'Returned'), s.returned, 'bad'], [L('বাকি', 'Missing'), s.missing, 'warn'],
  ]

  const status = book.open
    ? { cls: 'on', t: L(`বই চালু আছে — ${n(book.window.from_day)}–${n(book.window.to_day)} তারিখ`, `Book is open — day ${book.window.from_day}–${book.window.to_day}`) }
    : archive ? { cls: 'arch', t: L('আর্কাইভ — শুধু দেখা যাবে, বদলানো যাবে না', 'Archive — view only') }
    : new Date(`${book.today}T00:00:00Z`).getUTCDate() < book.window.from_day
      ? { cls: 'off', t: L(`এই মাসের বই ${n(book.window.from_day)} তারিখে খুলবে`, `This month's book opens on day ${book.window.from_day}`) }
      : { cls: 'off', t: L('এই মাসের বই বন্ধ', "This month's book is closed") }

  return <div className="wf-bk">
    {/* ---- header: month, archive picker, status, summary */}
    <section className="wf-bk-top" aria-label={L('এই মাসের সারাংশ', 'Summary of the month')}>
      <div className="wf-bk-head">
        <div className="wf-bk-month">
          <h2>{monthLabel(mismatch ? wanted : book.month, lang)}</h2>
          {archive && <Badge tone="neutral">{L('আর্কাইভ', 'Archive')}</Badge>}
        </div>
        <label className="wf-bk-pick">
          <span className="wf-bk-sr">{L('মাস বেছে নিন', 'Choose a month')}</span>
          <select value={wanted} onChange={e => setMonth(e.target.value === thisMonth ? null : e.target.value)}>
            {(book.months.includes(thisMonth) ? book.months : [thisMonth, ...book.months]).map(m =>
              <option key={m} value={m}>{monthLabel(m, lang)}{m !== thisMonth ? ` · ${L('আর্কাইভ', 'Archive')}` : ''}</option>)}
          </select>
        </label>
      </div>
      <p className={`wf-bk-status ${status.cls}`}>
        <i aria-hidden="true" />{status.t}
        {q.live && <span className="wf-bk-live" title={L('বদল সাথে সাথে দেখা যায়', 'Changes show up at once')}>{L('লাইভ', 'Live')}</span>}
      </p>
      <div className="wf-bk-sum" role="list">
        {chips.map(([label, v, tone]) => <div key={label} role="listitem" className={`wf-bk-chip t-${tone}${v === 0 ? ' z' : ''}`}><b>{n(v)}</b><span>{label}</span></div>)}
      </div>
      {s.other > 0 && <p className="muted small wf-bk-off">{L(`সাপ্তাহিক ও সরকারি ছুটির দিন: ${n(s.other)}`, `Weekly and public days off: ${s.other}`)}</p>}
      {!book.open && closedN > 0 && <p className="muted small wf-bk-closed">{L(`${n(closedN)} দিনের হাজিরা দেওয়া হয়নি। বই বন্ধ — ম্যানেজারকে জানান, তিনি খাতায় ঠিক করে দেবেন।`,
        `${closedN} day(s) were not given. The book is closed — tell your manager; they correct it on the register.`)}</p>}
    </section>

    {stale ? q.error && !q.loading
      ? <><p className="da-error" role="alert">{wfFriendly(q.error)}</p><button type="button" className="secondary wf-bk-btn" onClick={() => void q.reloadLoud()}>{L('আবার চেষ্টা করুন', 'Try again')}</button></>
      : <p className="muted" role="status">{L('লোড হচ্ছে…', 'Loading…')}</p> : <>

      {/* ---- the nudge: what is still to give */}
      {first ? <div className="wf-bk-banner" role="status">
        <span className="wf-bk-bi"><Icon name={returnedN && !missingN ? 'back' : 'alert'} size={20} /></span>
        <div className="tx">
          <b>{missingN && returnedN ? L(`${n(missingN)} দিনের হাজিরা বাকি, ${n(returnedN)} দিন ফেরত এসেছে — প্রথমটা দিন`, `${missingN} day(s) missing, ${returnedN} returned — start with the first`)
            : missingN ? L(`${n(missingN)} দিনের হাজিরা বাকি — প্রথমটা দিন`, `${missingN} day(s) not given — start with the first`)
            : L(`${n(returnedN)} দিনের হাজিরা ফেরত এসেছে — আবার দিন`, `${returnedN} day(s) came back — give them again`)}</b>
          <span>{L('প্রথম', 'First')}: {longDate(first.date, lang)}</span>
        </div>
        <button type="button" onClick={() => openDay(first)}>{L('প্রথমটা দিন', 'Give the first')}</button>
      </div> : book.open && book.days.some(d => d.state !== 'future') && <div className="wf-bk-banner ok" role="status">
        <span className="wf-bk-bi"><Icon name="check" size={20} /></span>
        <div className="tx"><b>{L('আজ পর্যন্ত সব হাজিরা দেওয়া আছে', 'Every date up to today is given')}</b>
          <span>{L('নিচে প্রতিটি তারিখের অবস্থা দেখুন।', 'See the state of each date below.')}</span></div>
      </div>}

      {/* ---- one card per date of the window */}
      <ul className="wf-bk-days" aria-label={L('তারিখ অনুযায়ী হাজিরা', 'Attendance by date')}>
        {book.days.map(d => <li key={d.date}>
          <DayRow day={d} book={book} first={first?.date === d.date} onOpen={openDay} refFn={el => { rows.current[d.date] = el }} />
        </li>)}
      </ul>

      {/* ---- my applications */}
      <section className="wf-bk-sec" aria-label={L('আমার আবেদন', 'My applications')}>
        <h3>{L('আমার আবেদন', 'My applications')}{book.applications.length > 0 && <span>{n(book.applications.length)}</span>}</h3>
        {book.applications.length === 0
          ? <p className="muted wf-bk-empty">{L('এই মাসে কোনো আবেদন নেই। ওয়েবসাইটে আবেদন না করে অনুপস্থিত থাকলে তারিখ চেপে আবেদন পাঠান।', 'No applications this month. If you were absent without applying on the website, tap the date and send one.')}</p>
          : book.applications.map(a => <AppCard key={a.id} app={a} book={book} onWithdraw={() => { setWdErr(''); setWithdraw(a) }} />)}
      </section>

      {/* ---- correction history */}
      <section className="wf-bk-sec" aria-label={L('সংশোধনের ইতিহাস', 'Correction history')}>
        <button type="button" className="wf-bk-fold" aria-expanded={histOpen} onClick={() => setHistOpen(o => !o)}>
          <Icon name="log" size={18} /><span>{L('সংশোধনের ইতিহাস', 'Correction history')}</span>
          <Icon name="chev" size={18} />
        </button>
        {histOpen && <HistoryList book={book} />}
      </section>
    </>}

    {/* ---- sheets */}
    {sheetDay && <GiveSheet key={sheetDay.date} book={book} day={sheetDay} onClose={() => setSheet(null)} onDone={after} onFail={() => void q.reload()} />}
    {withdraw && <Modal title={L('আবেদন তুলে নেবেন?', 'Withdraw the application?')} onClose={() => !wdBusy && setWithdraw(null)}
      actions={<>
        <button type="button" className="secondary" disabled={wdBusy} onClick={() => setWithdraw(null)}>{L('না, থাক', 'No, keep it')}</button>
        <button type="button" className="danger" disabled={wdBusy} onClick={() => void doWithdraw()}>{wdBusy ? L('হচ্ছে…', 'Working…') : L('হ্যাঁ, তুলে নিন', 'Yes, withdraw')}</button>
      </>}>
      <p style={{ margin: 0 }}><b>{withdraw.application_no}</b> — {L(`${n(withdraw.dates.length)} দিনের আবেদন`, `${withdraw.dates.length}-day application`)}</p>
      <p className="muted" style={{ margin: 0 }}>{L('তুলে নিলে ওই তারিখগুলো আবার বাকি হয়ে যাবে — হাজিরা আবার দিতে হবে।', 'The dates go back to "not given" — you give them again.')}</p>
      {wdErr && <p className="da-error" role="alert">{wdErr}</p>}
    </Modal>}
    {node}
  </div>
}

// ------------------------------------------------------------------ one date
function DayRow({ day, book, first, onOpen, refFn }: { day: BookDay; book: MyBook; first: boolean; onOpen: (d: BookDay) => void; refFn: (el: HTMLElement | null) => void }) {
  const { L, n, lang } = usePrefs()
  const meta = STATE_META[day.state]
  const locked = day.state === 'waiting' && !!day.application_id           // inside a pending application: change it through the application
  const open = book.open && (day.state === 'missing' || day.state === 'returned' || (day.state === 'waiting' && !locked))
  const rec = day.state === 'approved' ? day.record_status ?? day.decided_as : null
  // a week-off, holiday or approved-leave day says what it is, not just "approved"
  const shown = rec && ['leave', 'holiday', 'weekly_off'].includes(rec) && RECORD_META[rec] ? RECORD_META[rec] : meta
  const lines: Array<{ t: string; c?: string }> = []
  // an approved date that is simply "present" on the register needs no "you gave" line: the register line says it
  if (day.kind && !(rec && day.kind === 'present')) lines.push({ t: `${L('আপনি দিয়েছেন', 'You gave')}: ${kindText(day.kind, L)}${day.kind === 'absent' && day.applied_on_site ? ` · ${L(SITE_NOTE, 'applied on the website')}` : ''}` })
  if (day.application_no) lines.push({ t: `${L('আবেদন', 'Application')} ${day.application_no}${day.application_status ? ` · ${L(APP_META[day.application_status].bn, APP_META[day.application_status].en)}` : ''}` })
  if (day.kind === 'absent' && day.note && day.note !== SITE_NOTE) lines.push({ t: `${L('কারণ', 'Reason')}: ${day.note}` })
  if (rec) lines.push({ t: `${L('খাতায়', 'On the register')}: ${recordText(rec, L)}${day.decided_by_name ? ` · ${day.decided_by_name}` : ''}`, c: 'ok' })
  if (day.state === 'returned') lines.push({ t: day.decide_note ? `${L('ম্যানেজারের মন্তব্য', 'Manager says')}: ${day.decide_note}${day.decided_by_name ? ` — ${day.decided_by_name}` : ''}` : L('ম্যানেজার ফেরত দিয়েছেন — আবার দিন', 'Your manager returned it — give it again'), c: 'neg' })
  else if (day.state === 'approved' && day.decide_note) lines.push({ t: `${L('ম্যানেজার', 'Manager')}: ${day.decide_note}` })
  if (day.state === 'missing') lines.push({ t: open ? L('এখনো দেওয়া হয়নি — চেপে দিন', 'Not given yet — tap to give') : L('দেওয়া হয়নি', 'Not given'), c: 'warn' })
  if (day.state === 'closed') lines.push({ t: L('দেওয়া হয়নি — বই বন্ধ', 'Not given — book closed') })
  if (locked) lines.push({ t: L('আবেদনে আছে — বদলাতে আগে আবেদন তুলে নিন', 'It is in an application — withdraw that first to change it'), c: 'warn' })

  const inner = <>
    <span className="wf-bk-dn"><b>{n(day.day)}</b><small>{weekdayShort(day.dow, lang)}</small></span>
    <span className="wf-bk-tx">
      <span className="wf-bk-l1">
        <Badge tone={shown.tone}>{L(shown.bn, shown.en)}</Badge>
        {day.date === book.today && <em className="wf-bk-today">{L('আজ', 'Today')}</em>}
        {first && <em className="wf-bk-first">{L('এখান থেকে শুরু', 'Start here')}</em>}
      </span>
      {lines.map((l, i) => <span key={i} className={`wf-bk-ln${l.c ? ` ${l.c}` : ''}`}>{l.t}</span>)}
    </span>
    <span className="wf-bk-end">{open ? day.state === 'waiting' ? <span className="wf-bk-chg">{L('বদলান', 'Change')}</span> : <Icon name="chev" size={18} /> : null}</span>
  </>
  const cls = `wf-bk-day s-${day.state}${first ? ' first' : ''}`
  const label = `${longDate(day.date, lang)} — ${L(meta.bn, meta.en)}`
  return open
    ? <button type="button" ref={refFn} className={cls} aria-label={`${label} — ${day.state === 'waiting' ? L('বদলান', 'Change') : L('হাজিরা দিন', 'Give attendance')}`} onClick={() => onOpen(day)}>{inner}</button>
    : <div ref={refFn} className={cls} aria-label={label}>{inner}</div>
}

// ------------------------------------------------------------------ the sheet to give (or change) one date
type Step = 'choose' | 'ask' | 'yes' | 'apply'
function GiveSheet({ book, day, onClose, onDone, onFail }: { book: MyBook; day: BookDay; onClose: () => void; onDone: (msg: string) => Promise<void>; onFail: () => void }) {
  const { L, lang } = usePrefs()
  const changing = day.state === 'waiting'
  const [step, setStep] = useState<Step>('choose')
  const [note, setNote] = useState(day.kind === 'absent' && day.applied_on_site && day.note !== SITE_NOTE ? day.note ?? '' : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (call: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr('')
    try { await call(); await onDone(msg) } catch (e) { setErr(wfFriendly(e)); onFail() } finally { setBusy(false) }
  }
  const give = () => {
    if (changing && day.kind === 'present') { void onDone(L('এই হাজিরাই আগে দেওয়া আছে', 'This is already what you gave')); return }
    void run(() => wf.submit(day.date, 'present'), changing ? L('হাজিরা বদলানো হয়েছে', 'Attendance changed') : L('হাজিরা জমা হয়েছে — ম্যানেজার দেখবেন', 'Attendance sent — your manager will see it'))
  }

  if (step === 'apply') return <AbsenceApply book={book} date={day.date} onBack={() => setStep('ask')} onClose={onClose}
    onSent={() => onDone(L('আবেদন পাঠানো হয়েছে — ম্যানেজার দেখবেন', 'Application sent — your manager will see it'))} />

  const title = changing ? L('হাজিরা বদলান', 'Change attendance') : L('হাজিরা দিন', 'Give attendance')
  const back = <button type="button" className="secondary" disabled={busy} onClick={() => { setErr(''); setStep(step === 'yes' ? 'ask' : 'choose') }}>{L('আগের ধাপ', 'Back')}</button>
  const actions = step === 'choose' ? <button type="button" className="secondary" onClick={onClose} disabled={busy}>{L('বাতিল', 'Cancel')}</button>
    : step === 'ask' ? back
    : <>{back}<button type="button" disabled={busy} onClick={() => void run(() => wf.submit(day.date, 'absent', true, note.trim() || null),
        changing ? L('হাজিরা বদলানো হয়েছে', 'Attendance changed') : L('জমা হয়েছে — ম্যানেজার দেখবেন', 'Sent — your manager will see it'))}>
        {busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('জমা দিন', 'Confirm')}</button></>

  return <Modal title={title} onClose={() => !busy && onClose()} actions={actions}>
    <p className="wf-sh-date"><Icon name="cal" size={18} />{longDate(day.date, lang)}</p>

    {step === 'choose' && <>
      {day.state === 'returned' && <div className="notice" role="status">
        <b>{L('ম্যানেজার ফেরত দিয়েছেন', 'Your manager returned it')}</b>{day.decide_note && <span> — {day.decide_note}</span>}
      </div>}
      {changing && day.kind && <p className="muted small wf-sh-now">{L('এখন দেওয়া আছে', 'Now given')}: <b>{kindText(day.kind, L)}</b>{day.kind === 'absent' && day.applied_on_site ? ` · ${L(SITE_NOTE, 'applied on the website')}` : ''}. {L('বদলাতে চাইলে নিচে বেছে নিন।', 'Pick below to change it.')}</p>}
      <div className="wf-sh-opts">
        <button type="button" className="wf-opt yes" disabled={busy} onClick={give}>
          <span className="wf-opt-i"><Icon name="check" size={24} /></span><b>{L('উপস্থিত ছিলাম', 'I was present')}</b>
          {changing && day.kind === 'present' && <small>{L('এখন এটাই দেওয়া', 'given now')}</small>}</button>
        <button type="button" className="wf-opt no" disabled={busy} onClick={() => { setErr(''); setStep('ask') }}>
          <span className="wf-opt-i"><Icon name="x" size={24} /></span><b>{L('উপস্থিত ছিলাম না', 'I was not present')}</b>
          {changing && day.kind === 'absent' && <small>{L('এখন এটাই দেওয়া', 'given now')}</small>}</button>
      </div>
    </>}

    {step === 'ask' && <>
      <h3 className="wf-sh-q">{L('ওয়েবসাইটে আবেদন করেছেন কি?', 'Did you apply on the website?')}</h3>
      <p className="muted small wf-sh-sub">{L('অনুপস্থিতির আবেদন ওয়েবসাইটে আগেই করা থাকলে "হ্যাঁ" বলুন। না করে থাকলে "না" বলে এখান থেকেই আবেদন পাঠান।', 'If you already applied on the website, say yes. If not, say no and send the application from here.')}</p>
      <div className="wf-sh-opts two">
        <button type="button" className="wf-opt yes" onClick={() => { setErr(''); setStep('yes') }}><span className="wf-opt-i"><Icon name="check" size={24} /></span><b>{L('হ্যাঁ', 'Yes')}</b><small>{L('আবেদন করা আছে', 'I applied')}</small></button>
        <button type="button" className="wf-opt no" onClick={() => { setErr(''); setStep('apply') }}><span className="wf-opt-i"><Icon name="note" size={24} /></span><b>{L('না', 'No')}</b><small>{L('এখন আবেদন পাঠাব', 'I will apply now')}</small></button>
      </div>
    </>}

    {step === 'yes' && <>
      <p className="wf-sh-q2">{L('অনুপস্থিত — ওয়েবসাইটে আবেদন করা আছে', 'Absent — applied on the website')}</p>
      <Field label={L('নোট (ইচ্ছা হলে)', 'Note (optional)')}>
        <textarea rows={2} value={note} maxLength={300} placeholder={L(SITE_NOTE, 'Applied on the website')} onChange={e => setNote(e.target.value)} />
      </Field>
    </>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

// ------------------------------------------------------------------ one application with its tracking
function AppCard({ app, book, onWithdraw }: { app: AbsenceApp; book: MyBook; onWithdraw: () => void }) {
  const { L, lang } = usePrefs()
  const meta = APP_META[app.status]
  const decided = app.status === 'approved' || app.status === 'rejected'
  return <article className={`wf-bk-app ap-${app.status}`}>
    <header><b>{app.application_no}</b><Badge tone={meta.tone}>{L(meta.bn, meta.en)}</Badge></header>
    <div className="wf-bk-dates" aria-label={L('অনুপস্থিতির তারিখ', 'Absence dates')}>
      {app.dates.map(iso => { const d = book.days.find(x => x.date === iso && x.application_id === app.id)
        return <span key={iso} className={`wf-bk-dchip${d ? ` s-${d.state}` : ''}`}>{shortDate(iso, lang)}</span> })}
    </div>
    <p className="wf-bk-reason"><span>{L('কারণ', 'Reason')}:</span> {app.reason}</p>
    <ol className="wf-bk-tl">
      <li className="done"><i aria-hidden="true" /><div><b>{L('আপনি জমা দিয়েছেন', 'You sent it')}</b><small>{stamp(app.created_at, lang)}</small></div></li>
      {app.status === 'pending' && <li className="wait"><i aria-hidden="true" /><div><b>{L('ম্যানেজারের সিদ্ধান্তের অপেক্ষায়', 'Waiting for the manager')}</b></div></li>}
      {decided && <li className={app.status === 'approved' ? 'done' : 'rej'}><i aria-hidden="true" /><div>
        <b>{app.status === 'approved' ? L('অনুমোদন', 'Approved') : L('বাতিল', 'Turned down')}{app.decided_by_name ? ` — ${app.decided_by_name}` : ''}</b>
        {app.decided_at && <small>{stamp(app.decided_at, lang)}</small>}
        {app.decision_note && <span className="wf-bk-note">{L('মন্তব্য', 'Note')}: {app.decision_note}</span>}</div></li>}
      {app.status === 'cancelled' && <li className="off"><i aria-hidden="true" /><div><b>{L('আপনি তুলে নিয়েছেন', 'You withdrew it')}</b>{app.cancelled_at && <small>{stamp(app.cancelled_at, lang)}</small>}</div></li>}
    </ol>
    {app.status === 'pending' && <button type="button" className="secondary wf-bk-btn" onClick={onWithdraw}><Icon name="back" size={16} />{L('আবেদন তুলে নিন', 'Withdraw application')}</button>}
  </article>
}

// ------------------------------------------------------------------ the correction history (loaded only when opened)
function HistoryList({ book }: { book: MyBook }) {
  const { L, lang } = usePrefs()
  const h = useLiveLoad(() => wf.history({ employee: book.employee.id }, book.month), [book.employee.id, book.month], LIVE.mine)
  if (h.error && !h.data) return <p className="da-error" role="alert">{wfFriendly(h.error)}</p>
  if (!h.data) return <p className="muted" role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
  if (h.data.length === 0) return <p className="muted wf-bk-empty">{L('এই মাসে হাজিরার কোনো বদল নেই।', 'No change to your attendance this month.')}</p>
  return <ul className="wf-bk-hist">
    {h.data.map(x => {
      const a = ACTION_META[x.action]
      const what = x.from_kind && x.to_kind && x.from_kind !== x.to_kind ? `${kindText(x.from_kind, L)} → ${kindText(x.to_kind, L)}` : x.to_kind ? kindText(x.to_kind, L) : ''
      const reg = x.to_as ? `${L('খাতায়', 'Register')}: ${x.from_as && x.from_as !== x.to_as ? `${recordText(x.from_as, L)} → ` : ''}${recordText(x.to_as, L)}` : ''
      return <li key={x.id} className={`a-${x.action}`}>
        <i aria-hidden="true" />
        <div>
          <b>{L(a.bn, a.en)} <span>· {dayLabel(x.work_date, lang)}</span></b>
          {(what || reg) && <span className="wf-bk-hl">{[what, reg].filter(Boolean).join(' · ')}</span>}
          {x.note && <span className="wf-bk-hl">{L('নোট', 'Note')}: {x.note}</span>}
          <small>{x.by_name ? `${x.by_name} · ` : ''}{stamp(x.at, lang)}</small>
        </div>
      </li>
    })}
  </ul>
}
