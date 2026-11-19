import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { usePrefs, type Lang } from '../../lib/prefs'
import { wf, wfFriendly, type BookDay, type IsoDate, type MyBook } from '../../lib/workforce'
import { Field, Modal } from '../accounts/ui'
import { mb, mbFriendly } from '../../lib/workforceBook'
import '../../workforce-book.css'

// ------------------------------------------------------------------ small date helpers (also used by AttendanceBook)
const WD = {
  bn: ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}
/** dow 0 = Sunday … 6 = Saturday */
export const weekdayShort = (dow: number, lang: Lang) => WD[lang][((dow % 7) + 7) % 7]
const dateText = (iso: string, lang: Lang, o: Intl.DateTimeFormatOptions) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'UTC', ...o })
/** "সোমবার, ১৭ নভেম্বর" */
export const longDate = (iso: string, lang: Lang) => dateText(iso, lang, { weekday: 'long', day: 'numeric', month: 'long' })
/** "১৭ নভেম্বর" */
export const shortDate = (iso: string, lang: Lang) => dateText(iso, lang, { day: 'numeric', month: 'long' })
/** A moment (timestamp) on the Dhaka clock: "১৭ নভেম্বর, সকাল ১০:১৫". */
export const stamp = (ts: string, lang: Lang) =>
  `${new Date(ts).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long' })}, ${clock(ts, lang)}`
/** The time of a timestamp on the Dhaka clock: "সকাল ১০:১৫" / "10:15 am" (no Latin AM / PM inside Bangla text). */
export const clock = (ts: string, lang: Lang) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts))
  const h = Number(p.find(x => x.type === 'hour')?.value) % 24, m = p.find(x => x.type === 'minute')?.value ?? '00'
  if (lang === 'en') return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`
  const part = h >= 4 && h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকেল' : h < 20 ? 'সন্ধ্যা' : 'রাত'
  return `${part} ${`${h % 12 || 12}:${m}`.replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d])}`
}

/** May this date be given now? The database says so per day (this month's open book, or an earlier date the zonal manager opened);
 *  a server without that field falls back to the book being open. */
export const canGive = (book: MyBook, d: BookDay) => d.can_give ?? book.open

/** A date the person can still give (or change) by an application: it may be given now and it waits, was returned, or was changed before. */
export const canApply = (book: MyBook, d: BookDay) =>
  canGive(book, d) && (d.state === 'missing' || d.state === 'returned' || (d.state === 'waiting' && !d.application_id))

/**
 * "উপস্থিত ছিলাম না" and "ওয়েবসাইটে আবেদন করিনি": choose the absence dates (the one just tapped is already chosen), write the reason and send.
 * One application (AB-…) is created, with one waiting input per date; the hub manager decides. Shown as a bottom sheet on a phone.
 */
export function AbsenceApply({ book, date, onBack, onClose, onSent }: {
  book: MyBook
  /** the date the person tapped: chosen from the start */
  date: IsoDate
  /** "আগের ধাপ" — back to the question; leave out when the form is opened on its own */
  onBack?: () => void
  onClose: () => void
  /** called after the application is saved (the id of the new application) */
  onSent: (applicationId: string) => void | Promise<void>
}) {
  const { L, n, lang } = usePrefs()
  const options = useMemo(() => book.days.filter(d => canApply(book, d)), [book])
  const [picked, setPicked] = useState<IsoDate[]>(() => options.some(d => d.date === date) ? [date] : [])
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const toggle = (iso: IsoDate) => setPicked(p => p.includes(iso) ? p.filter(x => x !== iso) : [...p, iso].sort())
  const allOn = options.length > 0 && picked.length === options.length
  const changes = options.some(d => d.state === 'waiting' && picked.includes(d.date))
  const ready = picked.length > 0 && reason.trim().length > 0

  const send = async () => {
    if (!ready) return
    setBusy(true); setErr('')
    try {
      const id = await wf.apply([...picked].sort(), reason.trim())
      if (photo) {
        try { await mb.attachPhoto(book.employee.id, id, photo) }
        catch (e) { setErr(`${L('আবেদন গেছে, কিন্তু ছবি ওঠেনি', 'Sent, but the photo did not upload')}: ${mbFriendly(e)}`) }
      }
      await onSent(id)
    } catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }

  return <Modal title={L('অনুপস্থিতির আবেদন', 'Absence application')} onClose={onClose}
    actions={<>
      <button type="button" className="secondary" onClick={onBack ?? onClose} disabled={busy}>{onBack ? L('আগের ধাপ', 'Back') : L('বাতিল', 'Cancel')}</button>
      <button type="button" disabled={busy || !ready} onClick={() => void send()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('আবেদন পাঠান', 'Send application')}</button>
    </>}>
    <p className="wf-ap-lead">{L('Steadfast ওয়েবসাইটে আবেদন না করে থাকলে এখানে তারিখ বেছে কারণ লিখে আবেদন পাঠান। হাব ম্যানেজার দেখে সিদ্ধান্ত দেবেন।',
      'If you did not apply on the Steadfast website, pick the dates and write the reason. Your hub manager will decide.')}</p>

    {options.length === 0
      ? <div className="notice" role="status">{L('এখন আবেদন করার মতো কোনো তারিখ নেই।', 'There is no date you can apply for right now.')}</div>
      : <div className="wf-ap-pick" role="group" aria-label={L('অনুপস্থিতির তারিখ', 'Absence dates')}>
        <div className="wf-ap-pick-h">
          <b>{L('কোন কোন তারিখে ছিলেন না?', 'Which dates were you absent?')}</b>
          {options.length > 1 && <button type="button" className="link wf-ap-all" onClick={() => setPicked(allOn ? [] : options.map(d => d.date))}>
            {allOn ? L('সব বাদ দিন', 'Clear all') : L('সব বাছুন', 'Select all')}</button>}
        </div>
        <div className="wf-ap-chips">
          {options.map(d => {
            const on = picked.includes(d.date)
            return <button key={d.date} type="button" aria-pressed={on} className={`wf-ap-chip${on ? ' on' : ''}${d.state === 'waiting' ? ' chg' : ''}`}
              aria-label={longDate(d.date, lang)} onClick={() => toggle(d.date)}>
              <b>{n(d.day)}</b><small>{weekdayShort(d.dow, lang)}</small>
              {d.state === 'waiting' && <span className="wf-ap-pen" aria-hidden="true">✎</span>}
              {on && <span className="wf-ap-tick" aria-hidden="true"><Icon name="check" size={12} /></span>}
            </button>
          })}
        </div>
        {changes && <p className="muted small wf-ap-warn">{L('✎ চিহ্নিত তারিখে আগে হাজিরা দেওয়া আছে — বেছে নিলে সেটা বদলে অনুপস্থিত হবে।',
          'A date marked ✎ already has an attendance given — picking it changes it to absent.')}</p>}
      </div>}

    <Field label={L('কেন ছিলেন না?', 'Why were you absent?')} required>
      <textarea rows={3} value={reason} maxLength={400} placeholder={L('যেমন: জ্বর, ডাক্তার দেখাতে গিয়েছিলাম', 'e.g. fever, went to the doctor')}
        onChange={e => setReason(e.target.value)} />
    </Field>

    <Field label={L('ছুটির আবেদনের ছবি', 'Photo of the leave application')} hint={L('কাগজের আবেদন বা ওয়েবসাইটের স্ক্রিনশট — JPG / PNG, ৫ MB পর্যন্ত', 'Paper application or website screenshot — JPG / PNG up to 5 MB')}>
      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
    </Field>

    <p className={`wf-ap-prev${picked.length ? ' on' : ''}`} aria-live="polite">
      {picked.length
        ? <><b>{L(`${n(picked.length)} দিনের আবেদন`, `${picked.length}-day application`)}</b>
          <span>{picked.map(p => shortDate(p, lang)).join(', ')}</span></>
        : <span>{L('অন্তত একটি তারিখ বেছে নিন', 'Pick at least one date')}</span>}
    </p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
