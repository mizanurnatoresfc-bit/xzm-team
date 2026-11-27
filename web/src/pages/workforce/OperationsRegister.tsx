import { useState } from 'react'
import { todayDhaka } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { toLatinDigits } from '../../lib/validate'
import { LIVE, useLiveLoad, wf, wfFriendly, type HubRegisterNumbers } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { Loading, Section } from './shared'

const empty: HubRegisterNumbers = { pickup: 0, pickup_return: 0, delivery: 0, delivery_return: 0, pending: 0 }

export function OperationsRegister({ hub, date, refresh }: { hub: string; date: string; refresh: number }) {
  const { L, n } = usePrefs()
  const query = useLiveLoad(() => wf.hubRegisterStatus(hub, date), [hub, date, refresh], LIVE.manage)
  const [draft, setDraft] = useState<HubRegisterNumbers | null>(null)
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<number | null>(null)
  const status = query.data
  const submitted = status?.submitted
  const manual = draft ?? submitted?.manual ?? empty
  const note = draftNote ?? submitted?.note ?? ''
  const canSubmit = status && date <= todayDhaka() && !status.unresolved_count &&
    !Object.values(manual).some(value => value > 100000) &&
    (Object.values(manual).some(Boolean) ? !!note.trim() : status.approved_count > 0 || !!note.trim())
  const sourceChanged = !!submitted && submitted.source_key !== status?.source_key
  const changed = !submitted || sourceChanged ||
    Object.keys(manual).some(key => manual[key as keyof HubRegisterNumbers] !== submitted.manual[key as keyof HubRegisterNumbers]) ||
    (submitted.note ?? '') !== note.trim()
  const fields: Array<[keyof HubRegisterNumbers, string]> = [
    ['pickup', L('পিকআপ', 'Pickup')],
    ['pickup_return', L('মার্চেন্ট ফেরত', 'Merchant returns')],
    ['delivery', L('ডেলিভারি', 'Delivery')],
    ['delivery_return', L('ডেলিভারি রিটার্ন', 'Delivery returns')],
    ['pending', L('পেন্ডিং', 'Pending')],
  ]

  async function submit() {
    if (!status || !canSubmit || !changed || busy || query.loading || query.error) return
    setBusy(true)
    setError('')
    setSaved(null)
    try {
      setSaved(await wf.submitHubRegister(hub, date, status, manual, note.trim()))
      await query.reload()
      setDraft(null)
      setDraftNote(null)
    } catch (failure) {
      setError(wfFriendly(failure))
      await query.reload()
    } finally {
      setBusy(false)
    }
  }

  return <Section title={L('হাবের দৈনিক অপারেশন খাতা', 'Daily hub operations register')}>
    {Boolean(query.error) && <p role="alert" className="da-error">{wfFriendly(query.error)}</p>}
    {error && <p role="alert" className="da-error">{error}</p>}
    {saved !== null && <p role="status">{L(`খাতা জমা হয়েছে। সংস্করণ ${n(saved)}।`, `Register submitted. Version ${saved}.`)}</p>}
    {query.loading && !status && <Loading />}
    {status && <form onSubmit={event => { event.preventDefault(); void submit() }}>
      {submitted && <p>{L(`জমা হয়েছে। সংস্করণ ${n(submitted.version)}।`, `Submitted. Version ${submitted.version}.`)}</p>}
      {sourceChanged && <p>{L('স্টাফ এন্ট্রি বদলেছে। যাচাই শেষ করে নতুন সংস্করণ জমা দিন।', 'Staff entries changed. Review them and submit a new version.')}</p>}
      {status.unresolved_count > 0 && <p>{L(`${n(status.unresolved_count)}টি এন্ট্রির যাচাই বা সংশোধন বাকি।`, `${status.unresolved_count} entries still need review or correction.`)}</p>}
      <p>{L('অনুমোদিত স্টাফ এন্ট্রি নিচে যোগ হয়েছে। শুধু যে কাজ স্টাফের হিসাবে নেই, সেটি অতিরিক্ত হিসেবে লিখুন।',
        'Approved staff entries are included below. Enter only additional work that is missing from the staff figures.')}</p>
      <div className="wm-scroll">
        <table className="wm-tbl">
          <thead><tr><th>{L('কাজ', 'Work')}</th><th>{L('অনুমোদিত স্টাফ এন্ট্রি', 'Approved staff entries')}</th>
            <th>{L('ম্যানেজারের অতিরিক্ত এন্ট্রি', 'Additional manager entries')}</th>
            <th>{L('মোট', 'Total')}</th>{submitted && <th>{L('সর্বশেষ জমা', 'Last submitted')}</th>}</tr></thead>
          <tbody>{fields.map(([key, label]) => <tr key={key}>
            <th scope="row">{label}</th><td>{n(status.staff_totals[key])}</td>
            <td><input aria-label={label} inputMode="numeric" disabled={busy} value={manual[key] || ''}
              onChange={event => setDraft({ ...manual,
                [key]: Number(toLatinDigits(event.target.value).replace(/\D/g, '').slice(0, 6)) })} /></td>
            <td>{n(status.staff_totals[key] + manual[key])}</td>{submitted && <td>{n(submitted.totals[key])}</td>}
          </tr>)}</tbody>
        </table>
      </div>
      <Field label={L('ম্যানেজারের এন্ট্রির কারণ বা সূত্র', 'Reason or source for manager entries')}>
        <input value={note} maxLength={500} disabled={busy} onChange={event => setDraftNote(event.target.value)} />
      </Field>
      {!status.approved_count && <p>{L('স্টাফের অনুমোদিত এন্ট্রি না থাকলে জমা দেওয়ার কারণ লিখুন।',
        'Give a reason if you are submitting without approved staff entries.')}</p>}
      <button type="submit" disabled={!canSubmit || !changed || busy || query.loading || !!query.error}>
        {submitted ? L('নতুন সংস্করণ জমা দিন', 'Submit new version') : L('হাবের খাতা জমা দিন', 'Submit hub register')}
      </button>
    </form>}
  </Section>
}
