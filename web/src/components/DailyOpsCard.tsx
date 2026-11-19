import { useEffect, useState } from 'react'
import { addDays } from '../lib/dailyAccounts'
import { usePrefs, type Lang } from '../lib/prefs'
import { toLatinDigits } from '../lib/validate'
import { announceWfChange, useLiveLoad, wf, wfFriendly, type DailyOps, type OpsInput } from '../lib/workforce'
import { Badge, Field, useToast } from '../pages/accounts/ui'
import { clock } from '../pages/workforce/AbsenceApply'
import { Icon } from './Icon'
import '../workforce-book.css'

/**
 * আজকের কাজের হিসাব — the four numbers a staff member sends during the day: pickup, pickup return, delivery, delivery return.
 * One tap on "সাবমিট" ADDS what is in the boxes to the day's total (an empty box is 0), then the boxes clear for the next batch.
 * Every tap is counted: the card shows how many times the person submitted today and the day's total, with each tap below.
 * The database keeps one row per person per date (the total) and one history line per tap (`wf_ops_add`, `wf_ops_taps`).
 * Rendered directly on the staff panel; renders nothing for a login that has no staff profile. No page frame inside.
 */
const FIELDS = [
  { key: 'pickup', bn: 'পিকআপ', en: 'Pickup', icon: 'box', tone: 'b' },
  { key: 'pickup_return', bn: 'পিকআপ রিটার্ন', en: 'Pickup return', icon: 'back', tone: 'o' },
  { key: 'delivery', bn: 'ডেলিভারি', en: 'Delivery', icon: 'truck', tone: 'g' },
  { key: 'delivery_return', bn: 'ডেলিভারি রিটার্ন', en: 'Delivery return', icon: 'back', tone: 'p' },
] as const
type Key = (typeof FIELDS)[number]['key']
type Form = Record<Key, string> & { note: string }
const EMPTY: Form = { pickup: '', pickup_return: '', delivery: '', delivery_return: '', note: '' }
const MAX = 100000
const ZERO: OpsInput = { pickup: 0, pickup_return: 0, delivery: 0, delivery_return: 0 }
/** The four numbers (an empty box is 0), or null when a box is over the limit. */
const parse = (f: Form): OpsInput | null => {
  const v = {} as OpsInput
  for (const { key } of FIELDS) {
    const x = f[key] === '' ? 0 : Number(f[key]); if (!Number.isFinite(x) || x > MAX) return null
    v[key] = x
  }
  return v
}
const dateText = (iso: string, lang: Lang, o: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'UTC', ...o })

export function DailyOpsCard() {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLiveLoad(() => wf.myOps(14), [], ['wf_daily_ops'])
  const d = q.data
  const [back, setBack] = useState(0)                 // 0 = today (auto), 1 = yesterday … only while the settings allow
  const [form, setForm] = useState<Form>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tapsOpen, setTapsOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [pop, setPop] = useState(0)                   // bumps after each tap: the counter and totals animate once

  const maxBack = d ? Math.max(0, d.backdate_days) : 0
  const off = Math.min(back, maxBack)
  const date = d ? addDays(d.today, -off) : ''
  const t = useLiveLoad(() => date ? wf.opsTaps(date) : Promise.resolve(null), [date], ['wf_daily_ops'])
  const taps = t.data && t.data.date === date ? t.data : null
  useEffect(() => { if (!pop) return; const id = window.setTimeout(() => setPop(0), 700); return () => window.clearTimeout(id) }, [pop])

  if (!d) {
    if (q.error) return <section className="wf-op"><p className="da-error" role="alert">{wfFriendly(q.error)}</p>
      <button type="button" className="secondary wf-op-btn" onClick={() => void q.reloadLoud()}>{L('আবার চেষ্টা করুন', 'Try again')}</button></section>
    if (q.loading) return <section className="wf-op"><p className="muted" role="status">{L('লোড হচ্ছে…', 'Loading…')}</p></section>
    return null                                       // no active staff profile on this login: nothing to fill
  }

  const entry: DailyOps | null = off === 0 ? d.entry : d.recent.find(r => r.work_date === date) ?? null
  const total: OpsInput = taps?.total ?? (entry ? { pickup: entry.pickup, pickup_return: entry.pickup_return, delivery: entry.delivery, delivery_return: entry.delivery_return } : ZERO)
  const count = taps?.count ?? 0
  const prefix = off === 0 ? L('আজকের', "Today's") : off === 1 ? L('গতকালের', "Yesterday's") : L('সেদিনের', "That day's")
  const set = (k: keyof Form, v: string) => { setErr(''); setForm(f => ({ ...f, [k]: v })) }
  const pick = (i: number) => { setErr(''); setBack(i); setForm(EMPTY) }
  const typed = parse(form)
  const anyTyped = FIELDS.some(({ key }) => form[key] !== '' && form[key] !== '0')
  const list = [d.entry, ...d.recent].filter((x): x is DailyOps => !!x).sort((a, b) => b.work_date.localeCompare(a.work_date))
  const hint = off === 0 && d.hint && d.hint.lines > 0 ? d.hint : null
  const ord = (k: number) => lang === 'bn' ? `${n(k)} নম্বর` : `#${k}`

  const submit = async () => {
    setErr('')
    const v = parse(form)
    if (!v) { setErr(L(`সংখ্যা ${n(MAX)} এর বেশি হতে পারে না`, `A number cannot be above ${MAX}`)); return }
    if (entry && !anyTyped) { setErr(L('অন্তত একটা ঘরে সংখ্যা লিখুন — যা লিখবেন তা মোটের সাথে যোগ হবে', 'Write at least one number — it is added to the total')); return }
    setBusy(true)
    try {
      await wf.addOps(v, form.note.trim() || null, off === 0 ? null : date)
      setForm(EMPTY)
      await Promise.all([q.reload(), t.reload()])
      announceWfChange()
      setPop(p => p + 1)
      toast(L(`${n(count + 1)} বার সাবমিট হয়েছে — মোটের সাথে যোগ হয়েছে`, `Submitted ${count + 1} time(s) — added to the total`))
    } catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }

  return <section className="wf-op" aria-label={L('আজকের কাজের হিসাব', "Today's work count")}>
    <div className="wf-op-head">
      <div>
        <h3 className="wf-op-title">{L('আজকের কাজের হিসাব', "Today's work count")}</h3>
        <span className="wf-op-date"><Icon name="cal" size={15} />{dateText(date, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>
      <Badge tone={entry ? 'ok' : 'warn'}>{entry ? L('জমা আছে', 'Saved') : L('বাকি', 'Not sent')}</Badge>
    </div>

    {maxBack > 0 && <div className="wf-op-days" role="group" aria-label={L('কোন দিনের হিসাব', 'Which day')}>
      {Array.from({ length: maxBack + 1 }, (_, i) => <button key={i} type="button" aria-pressed={off === i} className={`wf-op-day${off === i ? ' on' : ''}`}
        onClick={() => pick(i)}>{i === 0 ? L('আজ', 'Today') : i === 1 ? L('গতকাল', 'Yesterday') : L(`${n(i)} দিন আগে`, `${i} days ago`)}</button>)}
    </div>}

    {/* how many times, and the day's total */}
    <div className={`wf-tap-sum${pop ? ' pop' : ''}`} aria-live="polite">
      <div className="wf-tap-count">
        <span className="ring"><b>{n(count)}</b></span>
        <span className="tx"><b>{L(`${n(count)} বার সাবমিট`, `Submitted ${count} time${count === 1 ? '' : 's'}`)}</b>
          <small>{count ? L(`সর্বশেষ ${clock(taps!.taps[0].at, lang)}`, `Last at ${clock(taps!.taps[0].at, lang)}`) : L('যতবার দেবেন, ততবার যোগ হবে', 'Every submit adds up')}</small></span>
      </div>
      <div className="wf-tap-total" role="list" aria-label={L(`${prefix} মোট`, `${prefix} total`)}>
        {FIELDS.map(f => <div key={f.key} role="listitem" className={`wf-tap-t t-${f.tone}`}>
          <span className="i"><Icon name={f.icon} size={16} /></span>
          <b>{n(total[f.key])}</b><small>{L(`মোট ${f.bn}`, `Total ${f.en.toLowerCase()}`)}</small>
        </div>)}
      </div>
    </div>

    <p className="wf-tap-lead">{count ? L('এবারের সংখ্যা লিখুন — মোটের সাথে যোগ হবে', 'Type this batch — it is added to the total') : L('সংখ্যা লিখে এক ক্লিকে সাবমিট দিন', 'Type the numbers and submit in one tap')}</p>
    <div className="wf-op-grid">
      {FIELDS.map(f => <Field key={f.key} label={L(f.bn, f.en)}>
        <input className="wf-op-in" inputMode="numeric" pattern="[0-9]*" autoComplete="off" enterKeyHint="done" maxLength={6} placeholder="0"
          value={form[f.key]} onKeyDown={e => { if (e.key === 'Enter' && !busy) void submit() }}
          onChange={e => set(f.key, toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 6).replace(/^0+(?=\d)/, ''))} />
        {count > 0 && <span className="wf-tap-after" aria-hidden={!(typed && typed[f.key] > 0) || undefined}>
          {typed && typed[f.key] > 0 ? L(`মোট হবে ${n(total[f.key] + typed[f.key])}`, `Total becomes ${total[f.key] + typed[f.key]}`) : '\u00a0'}</span>}
      </Field>)}
    </div>
    <Field label={L('নোট (ইচ্ছা হলে)', 'Note (optional)')}>
      <input className="wf-op-note" type="text" maxLength={300} autoComplete="off" value={form.note} placeholder={L('কিছু জানানোর থাকলে লিখুন', 'Anything to tell your manager')} onChange={e => set('note', e.target.value)} />
    </Field>

    {hint && <p className="wf-op-hint"><Icon name="note" size={16} /><span>{L(`আপনার পাঠানো হিসাবে আজ পিকআপ ${n(hint.pickup)}, ডেলিভারি ${n(hint.delivery)} — মিলিয়ে নিন`,
      `In what you sent to the sheet today: pickup ${hint.pickup}, delivery ${hint.delivery} — please check`)}</span></p>}
    {err && <p className="da-error" role="alert">{err}</p>}

    <button type="button" className="wf-op-send wf-tap-send" disabled={busy} onClick={() => void submit()}>
      <Icon name={count ? 'plus' : 'check'} size={20} />
      <span>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : count ? L('সাবমিট — মোটের সাথে যোগ', 'Submit — add to total') : L('সাবমিট', 'Submit')}</span>
      {!busy && <em>{L(`${n(count + 1)} নম্বর`, `#${count + 1}`)}</em>}
    </button>

    {count > 0 && <div className="wf-op-recent">
      <button type="button" className="wf-op-fold" aria-expanded={tapsOpen} onClick={() => setTapsOpen(o => !o)}>
        <Icon name="checkall" size={17} /><span>{L(`${prefix} সব সাবমিট`, `${prefix} submits`)}<em>{n(count)}</em></span><Icon name="chev" size={17} />
      </button>
      {tapsOpen && <ol className="wf-tap-list" aria-label={L(`${prefix} সব সাবমিট`, `${prefix} submits`)}>
        {taps!.taps.map((x, i) => <li key={x.at}>
          <span className="no">{ord(count - i)}</span>
          <span className="tm">{clock(x.at, lang)}</span>
          <span className="nums">{FIELDS.map(f => <span key={f.key} className={`t-${f.tone}`} title={L(f.bn, f.en)}>+{n(x[f.key])}</span>)}</span>
        </li>)}
      </ol>}
    </div>}

    <div className="wf-op-recent">
      <button type="button" className="wf-op-fold" aria-expanded={recentOpen} onClick={() => setRecentOpen(o => !o)}>
        <Icon name="log" size={17} /><span>{L('গত ১৪ দিনের হিসাব', 'Last 14 days')}{list.length > 0 && <em>{n(list.length)}</em>}</span><Icon name="chev" size={17} />
      </button>
      {recentOpen && (list.length === 0
        ? <p className="muted wf-op-none">{L('এখনো কোনো হিসাব জমা নেই।', 'Nothing sent yet.')}</p>
        : <ul className="wf-op-list" aria-label={L('গত ১৪ দিনের হিসাব', 'Last 14 days')}>
          {list.map(r => <li key={r.id}>
            <span className="dt">{dateText(r.work_date, lang, { day: 'numeric', month: 'short' })}</span>
            <dl className="nums">{FIELDS.map(f => <div key={f.key}><dt>{L(f.bn, f.en)}</dt><dd>{n(r[f.key])}</dd></div>)}</dl>
            {r.note && <span className="nt">{r.note}</span>}
          </li>)}
        </ul>)}
    </div>
    {node}
  </section>
}
