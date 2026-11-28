import { useState } from 'react'
import { usePrefs } from '../../lib/prefs'
import { toLatinDigits } from '../../lib/validate'
import { useLiveLoad, wf, wfFriendly } from '../../lib/workforce'
import { Field } from '../accounts/ui'

export function StaffPendingCard() {
  const { L, n } = usePrefs()
  const query = useLiveLoad(() => wf.pendingToday(), [])
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const today = query.data
  const locked = Boolean(today?.approved_at)

  async function submit() {
    if (!today || value === '' || busy || Number(value) > 100000 || locked) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await wf.savePendingToday(Number(value), today.date)
      await query.reload()
      setValue('')
      setSaved(true)
    } catch (error) {
      setError(wfFriendly(error))
      await query.reload()
    } finally {
      setBusy(false)
    }
  }

  if (query.error) return <p className="da-error" role="alert">{wfFriendly(query.error)}</p>
  if (query.loading && !today) return <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
  if (!today) return null

  return <form onSubmit={event => { event.preventDefault(); void submit() }}>
    <p aria-live="polite">
      {today.count === null ? L('এখনো জমা হয়নি', 'Not submitted yet')
        : L(`সর্বশেষ জমা ${n(today.count)}টি পেন্ডিং`, `Last submission: ${today.count} pending`)}
      {locked && <strong className="hub-approved-badge"> · {L('অনুমোদিত ✓', 'Approved ✓')}</strong>}
    </p>
    {today.return_reason && <p role="status" className="hub-returned">
      {L('ফেরতের কারণ', 'Return reason')} · {today.return_reason}
    </p>}
    {locked ? <p className="muted">
      {L('ম্যানেজার অনুমোদন করেছেন। পরিবর্তনের জন্য ম্যানেজারকে বলুন।',
         'Manager has approved. Ask your manager to reopen for a change.')}
    </p> : <>
      <Field label={L('এখন কতটি পার্সেল বাকি?', 'How many parcels are pending now?')}>
        <input inputMode="numeric" disabled={busy} value={value}
          onChange={event => { setSaved(false); setValue(toLatinDigits(event.target.value).replace(/\D/g, '').slice(0, 6)) }} />
      </Field>
      <div className="wf-number-steps">
        {[0, 5, 10].map(count => <button key={count} type="button" className="secondary" disabled={busy}
          onClick={() => { setSaved(false); setValue(String(count)) }}>{n(count)}</button>)}
      </div>
      <button type="submit" disabled={busy || value === '' || Number(value) > 100000}>{L('জমা দিন', 'Submit')}</button>
    </>}
    {error && <p className="da-error" role="alert">{error}</p>}
    {saved && <p role="status">{L('পেন্ডিং সংখ্যা জমা হয়েছে।', 'Pending count submitted.')}</p>}
  </form>
}
