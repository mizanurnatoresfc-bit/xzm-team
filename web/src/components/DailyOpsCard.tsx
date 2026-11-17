import { useEffect, useRef, useState } from 'react'
import { addDays } from '../lib/dailyAccounts'
import { usePrefs, type Lang } from '../lib/prefs'
import { toLatinDigits } from '../lib/validate'
import { useLiveLoad, wf, wfFriendly, type DailyOps, type OpsInput } from '../lib/workforce'
import { Badge, Field, useToast } from '../pages/accounts/ui'
import { Icon } from './Icon'
import '../workforce-book.css'

/**
 * আজকের কাজের হিসাব — the four numbers a staff member sends every day: pickup, pickup return, delivery, delivery return.
 * Four direct number boxes (Bangla digits are accepted), all required (0 is a number), one "সাবমিট".
 * The database keeps one row per person per date (with the person's hub and zone), so sending again changes the same row (revision +1).
 * Rendered directly on the staff panel; renders nothing for a login that has no staff profile. No page frame inside.
 */
const FIELDS = [
  { key: 'pickup', bn: 'পিকআপ', en: 'Pickup' },
  { key: 'pickup_return', bn: 'পিকআপ রিটার্ন', en: 'Pickup return' },
  { key: 'delivery', bn: 'ডেলিভারি', en: 'Delivery' },
  { key: 'delivery_return', bn: 'ডেলিভারি রিটার্ন', en: 'Delivery return' },
] as const
type Key = (typeof FIELDS)[number]['key']
type Form = Record<Key, string> & { note: string }
const EMPTY: Form = { pickup: '', pickup_return: '', delivery: '', delivery_return: '', note: '' }
const MAX = 100000
const fromEntry = (e: DailyOps | null): Form => e
  ? { pickup: String(e.pickup), pickup_return: String(e.pickup_return), delivery: String(e.delivery), delivery_return: String(e.delivery_return), note: e.note ?? '' }
  : EMPTY
/** The four numbers, or null when a box is empty or over the limit. */
const parse = (f: Form): OpsInput | null => {
  const v = {} as OpsInput
  for (const { key } of FIELDS) {
    if (!/^\d+$/.test(f[key])) return null
    const x = Number(f[key]); if (x > MAX) return null
    v[key] = x
  }
  return v
}
const sameAs = (e: DailyOps, f: Form) => FIELDS.every(({ key }) => String(e[key]) === f[key]) && (e.note ?? '') === f.note.trim()
const dateText = (iso: string, lang: Lang, o: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'UTC', ...o })
const clock = (ts: string, lang: Lang) => new Date(ts).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })

export function DailyOpsCard() {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLiveLoad(() => wf.myOps(14), [], ['wf_daily_ops'])
  const d = q.data
  const [back, setBack] = useState(0)                 // 0 = today (auto), 1 = yesterday … only while the settings allow
  const [form, setForm] = useState<Form>(EMPTY)
  const [tried, setTried] = useState(false)           // the person pressed "সাবমিট" with a box empty: show which
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [recentOpen, setRecentOpen] = useState(false)
  const edited = useRef(false)                        // the person is typing: a live refresh must not overwrite the boxes

  const maxBack = d ? Math.max(0, d.backdate_days) : 0
  const off = Math.min(back, maxBack)
  const dateAt = (i: number) => d ? addDays(d.today, -i) : ''
  const entryAt = (i: number): DailyOps | null => !d ? null : i === 0 ? d.entry : d.recent.find(r => r.work_date === dateAt(i)) ?? null
  const date = dateAt(off)
  const entry = entryAt(off)
  const sig = entry ? `${entry.id}:${entry.revision}:${entry.updated_at}` : 'none'

  // the saved row changed (this or another device, or a new day began): follow it, unless the person is in the middle of typing
  useEffect(() => { if (!edited.current) setForm(fromEntry(entry)) }, [sig, date]) // eslint-disable-line react-hooks/exhaustive-deps
  // a different day: start at once from what is saved for it
  const pick = (i: number) => { edited.current = false; setTried(false); setErr(''); setBack(i); setForm(fromEntry(entryAt(i))) }

  if (!d) {
    if (q.error) return <section className="wf-op"><p className="da-error" role="alert">{wfFriendly(q.error)}</p>
      <button type="button" className="secondary wf-op-btn" onClick={() => void q.reloadLoud()}>{L('আবার চেষ্টা করুন', 'Try again')}</button></section>
    if (q.loading) return <section className="wf-op"><p className="muted" role="status">{L('লোড হচ্ছে…', 'Loading…')}</p></section>
    return null                                       // no active staff profile on this login: nothing to fill
  }

  const word = off === 0 ? L('আজ', 'Today') : off === 1 ? L('গতকাল', 'Yesterday') : dateText(date, lang, { day: 'numeric', month: 'long' })
  const prefix = off === 0 ? L('আজকের', "Today's") : off === 1 ? L('গতকালের', "Yesterday's") : L('সেদিনের', "That day's")
  const set = (k: keyof Form, v: string) => { edited.current = true; setForm(f => ({ ...f, [k]: v })) }
  const unchanged = !!entry && sameAs(entry, form)
  const bad = (k: Key) => tried && !/^\d+$/.test(form[k])
  const list = [d.entry, ...d.recent].filter((x): x is DailyOps => !!x).sort((a, b) => b.work_date.localeCompare(a.work_date))
  const hint = off === 0 && d.hint && d.hint.lines > 0 ? d.hint : null

  const submit = async () => {
    setTried(true); setErr('')
    const v = parse(form)
    if (!v) {
      const over = FIELDS.some(({ key }) => /^\d+$/.test(form[key]) && Number(form[key]) > MAX)
      setErr(over ? L(`সংখ্যা ${n(MAX)} এর বেশি হতে পারে না`, `A number cannot be above ${MAX}`) : L('চারটি ঘরেই সংখ্যা লিখুন — না থাকলে ০ লিখুন', 'Fill all four boxes — write 0 if there is none'))
      return
    }
    if (entry && sameAs(entry, form)) { toast(L('এই হিসাবই আগে জমা আছে', 'This is already saved')); return }
    setBusy(true)
    try {
      await wf.submitOps(v, form.note.trim() || null, off === 0 ? null : date)
      edited.current = false; setTried(false)
      await q.reload()
      toast(entry ? L('হিসাব বদলানো হয়েছে', 'Your numbers were changed') : L('সাবমিট হয়েছে — ধন্যবাদ', 'Submitted — thank you'))
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

    <div className="wf-op-grid">
      {FIELDS.map(f => <Field key={f.key} label={`${prefix} ${L(f.bn, f.en)}`} required>
        <input className={`wf-op-in${bad(f.key) ? ' err' : ''}`} inputMode="numeric" pattern="[0-9]*" autoComplete="off" enterKeyHint="next" maxLength={6} placeholder="0"
          aria-invalid={bad(f.key) || undefined} value={form[f.key]}
          onChange={e => set(f.key, toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 6).replace(/^0+(?=\d)/, ''))} />
      </Field>)}
    </div>
    <Field label={L('নোট (ইচ্ছা হলে)', 'Note (optional)')}>
      <input className="wf-op-note" type="text" maxLength={300} autoComplete="off" value={form.note} placeholder={L('কিছু জানানোর থাকলে লিখুন', 'Anything to tell your manager')} onChange={e => set('note', e.target.value)} />
    </Field>

    {hint && <p className="wf-op-hint"><Icon name="note" size={16} /><span>{L(`আপনার পাঠানো হিসাবে আজ পিকআপ ${n(hint.pickup)}, ডেলিভারি ${n(hint.delivery)} — মিলিয়ে নিন`,
      `In what you sent to the sheet today: pickup ${hint.pickup}, delivery ${hint.delivery} — please check`)}</span></p>}
    {err && <p className="da-error" role="alert">{err}</p>}

    <button type="button" className={`wf-op-send${unchanged ? ' secondary' : ''}`} disabled={busy} onClick={() => void submit()}>
      <Icon name={entry ? 'save' : 'check'} size={18} />{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : entry ? L('আবার সাবমিট', 'Submit again') : L('সাবমিট', 'Submit')}
    </button>
    {entry && <p className="wf-op-saved"><Icon name="checkall" size={16} /><span>
      {L(`জমা আছে — সর্বশেষ ${clock(entry.updated_at, lang)}`, `Saved — last at ${clock(entry.updated_at, lang)}`)}
      {entry.revision > 1 ? ` · ${L(`${word} ${n(entry.revision - 1)} বার বদলানো হয়েছে`, `changed ${entry.revision - 1} time(s) ${off === 0 ? 'today' : 'that day'}`)}` : ''}</span></p>}

    <div className="wf-op-recent">
      <button type="button" className="wf-op-fold" aria-expanded={recentOpen} onClick={() => setRecentOpen(o => !o)}>
        <Icon name="log" size={17} /><span>{L('গত ১৪ দিনের হিসাব', 'Last 14 days')}{list.length > 0 && <em>{n(list.length)}</em>}</span><Icon name="chev" size={17} />
      </button>
      {recentOpen && (list.length === 0
        ? <p className="muted wf-op-none">{L('এখনো কোনো হিসাব জমা নেই।', 'Nothing sent yet.')}</p>
        : <ul className="wf-op-list" aria-label={L('গত ১৪ দিনের হিসাব', 'Last 14 days')}>
          {list.map(r => <li key={r.id}>
            <span className="dt">{dateText(r.work_date, lang, { day: 'numeric', month: 'short' })}{r.revision > 1 && <i title={L('বদলানো হয়েছে', 'changed')}>✎</i>}</span>
            <dl className="nums">{FIELDS.map(f => <div key={f.key}><dt>{L(f.bn, f.en)}</dt><dd>{n(r[f.key])}</dd></div>)}</dl>
            {r.note && <span className="nt">{r.note}</span>}
          </li>)}
        </ul>)}
    </div>
    {node}
  </section>
}
