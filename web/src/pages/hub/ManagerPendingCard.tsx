import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { toLatinDigits } from '../../lib/validate'
import { useLiveLoad, wf, wfFriendly, type PendingHubRow } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { PendingMonthReport } from './PendingMonthReport'
import { useHubList } from '../workforce/shared'

export function ManagerPendingCard() {
  const { L } = usePrefs()
  const { can } = useAuth()
  const [monthly, setMonthly] = useState(false)
  const options = useHubList()
  const [selected, setSelected] = useState('')
  const hubs = options.data?.hubs ?? []
  const hub = hubs.find(item => item.id === selected)?.id ?? hubs[0]?.id ?? ''

  return <div>
    {Boolean(options.error) && <p role="alert">{wfFriendly(options.error)}</p>}
    {hubs.length > 0 && <Field label={L('হাব', 'Hub')}>
      <select value={hub} onChange={event => setSelected(event.target.value)}>
        {hubs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </Field>}
    {hub && <>
      <button type="button" className="secondary" onClick={() => setMonthly(value => !value)}>
        {monthly ? L('আজকের যাচাই তালিকা', 'Today’s review queue') : L('মাসিক পেন্ডিং রিপোর্ট', 'Monthly pending report')}
      </button>
      {monthly ? <PendingMonthReport key={hub} hub={hub} archive={can('zonal.dashboard.view')} />
        : <PendingQueue key={hub} hub={hub} />}
    </>}
  </div>
}

function PendingQueue({ hub }: { hub: string }) {
  const { L, n } = usePrefs()
  const query = useLiveLoad(() => wf.pendingHubToday(hub), [hub])
  const [proxy, setProxy] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [returnReason, setReturnReason] = useState('')
  const [count, setCount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const data = query.data

  async function save(row: PendingHubRow, returned = false) {
    if (!data || busy) return
    if (row.snapshot === null && (count === '' || Number(count) > 100000 || !reason.trim())) return
    if (returned && !returnReason.trim()) return
    setBusy(true)
    setError('')
    try {
      await wf.savePendingManager(hub, row.employee_id, data.date, row.snapshot,
        row.snapshot === null ? Number(count) : undefined, returned ? returnReason : reason, returned)
      setProxy(null)
      setReturning(null)
    } catch (failure) {
      setError(wfFriendly(failure))
    } finally {
      await query.reload()
      setBusy(false)
    }
  }

  if (query.error) return <p role="alert">{wfFriendly(query.error)}</p>
  if (!data) return <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>

  return <div>
    {error && <p role="alert">{error}</p>}
    <ul className="hub-pending-rows">
      {data.rows.map(row => <li key={row.employee_id}>
        <strong>{row.name}</strong>
        <p>{row.count === null ? L('জমা হয়নি', 'Not submitted')
          : `${n(row.count)} · ${row.approved ? L('অনুমোদিত', 'Approved') : row.return_reason ? L('ফেরত দেওয়া হয়েছে', 'Returned') : L('যাচাই বাকি', 'Review due')}`}</p>
        {row.proxy_reason && <p>{L('পক্ষে জমা', 'Submitted on behalf')} · {row.proxy_reason}</p>}
        {row.return_reason && <p>{L('ফেরতের কারণ', 'Return reason')} · {row.return_reason}</p>}
        {data.can_edit && !row.approved && !row.return_reason && (row.snapshot
          ? <>
            <button type="button" disabled={busy} onClick={() => void save(row)}>{L('অনুমোদন', 'Approve')}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => {
              setReturning(row.employee_id); setReturnReason('')
            }}>{L('ফেরত দিন', 'Return')}</button>
          </>
          : <button type="button" className="secondary" disabled={busy} onClick={() => {
            setProxy(row.employee_id); setCount(''); setReason('')
          }}>{L('পক্ষে এন্ট্রি দিন', 'Enter on behalf')}</button>)}
        {returning === row.employee_id && row.snapshot && !row.return_reason && !row.approved &&
          <form onSubmit={event => { event.preventDefault(); void save(row, true) }}>
            <Field label={L('ফেরতের কারণ', 'Return reason')}>
              <input maxLength={500} value={returnReason} onChange={event => setReturnReason(event.target.value)} />
            </Field>
            <button type="submit" disabled={busy || !returnReason.trim()}>{L('কারণসহ ফেরত দিন', 'Return with reason')}</button>
          </form>}
        {proxy === row.employee_id && row.snapshot === null && <form onSubmit={event => { event.preventDefault(); void save(row) }}>
          <Field label={L('পেন্ডিং সংখ্যা', 'Pending count')}>
            <input inputMode="numeric" value={count}
              onChange={event => setCount(toLatinDigits(event.target.value).replace(/\D/g, '').slice(0, 6))} />
          </Field>
          <Field label={L('কারণ বা তথ্যের উৎস', 'Reason or source')}>
            <input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
          </Field>
          <button type="submit" disabled={busy || count === '' || Number(count) > 100000 || !reason.trim()}>
            {L('জমা দিন', 'Submit')}
          </button>
        </form>}
      </li>)}
    </ul>
  </div>
}
