import { useState } from 'react'
import { usePrefs } from '../../lib/prefs'
import { toLatinDigits } from '../../lib/validate'
import { useLiveLoad, wf, wfFriendly } from '../../lib/workforce'
import { Field } from '../accounts/ui'

export function StaffPendingCard({ onSaved }: { onSaved?: () => void } = {}) {
  const { L, n } = usePrefs()
  const query = useLiveLoad(() => wf.pendingToday(), [])
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const today = query.data

  async function submit() {
    if (!today || value === '' || busy || Number(value) > 100000) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await wf.savePendingToday(Number(value), today.date)
      await query.reload()
      setValue('')
      setSaved(true)
      onSaved?.()
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
      {today.count === null ? L('এখনো জমা হয়নি', 'Not submitted yet')
        : L(`সর্বশেষ জমা ${n(today.count)}টি পেন্ডিং`, `Last submission: ${today.count} pending`)}
      {today.approved && <strong> · {L('ম্যানেজার অনুমোদন করেছেন', 'Approved by your manager')}</strong>}
    </p>
    {today.approved && <p className="muted">{L('অনুমোদিত সংখ্যা বদলাতে হলে ম্যানেজারকে ফেরত দিতে বলুন।', 'To change an approved count, ask your manager to send it back.')}</p>}
    {today.return_reason && <p role="status">{L('ফেরতের কারণ', 'Return reason')} · {today.return_reason}</p>}
    <Field label={L('এখন কতটি পার্সেল বাকি?', 'How many parcels are pending now?')}>
      <input inputMode="numeric" disabled={busy || today.approved} value={value}
        onChange={event => { setSaved(false); setValue(toLatinDigits(event.target.value).replace(/\D/g, '').slice(0, 6)) }} />
    </Field>
    <div className="wf-number-steps">
      {[0, 5, 10].map(count => <button key={count} type="button" className="secondary" disabled={busy || today.approved}
        onClick={() => { setSaved(false); setValue(String(count)) }}>{n(count)}</button>)}
    </div>
    <button type="submit" disabled={busy || today.approved || value === '' || Number(value) > 100000}>{L('জমা দিন', 'Submit')}</button>
    {error && <p className="da-error" role="alert">{error}</p>}
    {saved && <p role="status">{L('পেন্ডিং সংখ্যা জমা হয়েছে।', 'Pending count submitted.')}</p>}
  </form>
}
