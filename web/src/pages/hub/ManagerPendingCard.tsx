import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { toLatinDigits } from '../../lib/validate'
import { useLiveLoad, wf, wfFriendly, type PendingHubRow } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { PendingMonthReport } from './PendingMonthReport'
import { useHubList } from '../workforce/shared'

const ABSENT_STATES = new Set(['absent', 'leave', 'on_leave', 'absent_applied', 'half', 'unknown'])

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
        : <PendingQueue key={hub} hub={hub} canUnlock={can('zonal.dashboard.view')} />}
    </>}
  </div>
}

function PendingQueue({ hub, canUnlock }: { hub: string; canUnlock: boolean }) {
  const { L, n } = usePrefs()
  const query = useLiveLoad(() => wf.pendingHubToday(hub), [hub])
  const summary = useLiveLoad(() => wf.pendingQueueSummary(hub), [hub])
  const [proxy, setProxy] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [count, setCount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lockReason, setLockReason] = useState('')
  const [checkedBulk, setCheckedBulk] = useState<Record<string, boolean>>({})
  const data = query.data
  const sumRow = summary.data

  function resetForm() { setProxy(null); setReturning(null); setUnlocking(null); setReason(''); setCount('') }

  async function save(row: PendingHubRow, mode: 'approve' | 'return' | 'proxy' | 'unlock') {
    if (!data || busy) return
    if (mode === 'proxy' && (count === '' || Number(count) > 100000 || !reason.trim())) return
    if ((mode === 'return' || mode === 'unlock') && !reason.trim()) return
    setBusy(true)
    setError('')
    try {
      await wf.savePendingManager(hub, row.employee_id, data.date, row.snapshot,
        mode === 'proxy' ? Number(count) : undefined,
        mode === 'approve' ? undefined : reason,
        mode === 'return', mode === 'unlock')
      resetForm()
    } catch (failure) {
      setError(wfFriendly(failure))
    } finally {
      await query.reload(); await summary.reload()
      setBusy(false)
    }
  }

  async function bulkOnLeave() {
    if (!data || busy) return
    const ids = Object.entries(checkedBulk).filter(([, v]) => v).map(([k]) => k)
    if (!ids.length) return
    setBusy(true); setError('')
    try {
      await wf.pendingMarkLeave(hub, data.date, ids, L('ছুটি / অনুপস্থিত', 'Leave / absent'))
      setCheckedBulk({})
    } catch (failure) {
      setError(wfFriendly(failure))
    } finally {
      await query.reload(); await summary.reload()
      setBusy(false)
    }
  }

  async function lockDay() {
    if (!data || busy) return
    setBusy(true); setError('')
    try {
      await wf.dayLockSet(hub, data.date, 'pending_return')
    } catch (failure) {
      setError(wfFriendly(failure))
    } finally {
      await summary.reload()
      setBusy(false)
    }
  }

  async function unlockDay() {
    if (!data || busy || !lockReason.trim()) return
    setBusy(true); setError('')
    try {
      await wf.dayLockRelease(hub, data.date, 'pending_return', lockReason)
      setLockReason('')
    } catch (failure) {
      setError(wfFriendly(failure))
    } finally {
      await summary.reload()
      setBusy(false)
    }
  }

  if (query.error) return <p role="alert">{wfFriendly(query.error)}</p>
  if (!data) return <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>

  const anyChecked = Object.values(checkedBulk).some(Boolean)

  return <div>
    {sumRow && <div className="hub-pending-summary" role="status">
      <strong>{L('অগ্রগতি', 'Progress')}</strong> ·
      {' '}{L('মোট', 'Total')} {n(sumRow.total_staff)} ·
      {' '}{L('অনুমোদিত', 'Approved')} <strong>{n(sumRow.approved)}</strong> ·
      {' '}{L('যাচাই বাকি', 'Review due')} <strong>{n(sumRow.review_pending)}</strong> ·
      {' '}{L('জমা হয়নি', 'Not submitted')} <strong>{n(sumRow.not_submitted_count)}</strong> ·
      {' '}{L('ফেরত', 'Returned')} <strong>{n(sumRow.returned)}</strong>
      {sumRow.locked && <> · <strong className="hub-locked-badge">{L('🔒 লক', '🔒 Locked')}</strong></>}
    </div>}

    {sumRow && sumRow.not_submitted_people.length > 0 && <details className="hub-pending-missing">
      <summary>{L(`কার তথ্য বাকি (${n(sumRow.not_submitted_people.length)} জন)`,
                   `Missing (${sumRow.not_submitted_people.length} people)`)}</summary>
      <ul>{sumRow.not_submitted_people.map(p => <li key={p.id}>{p.name}</li>)}</ul>
    </details>}

    {data.can_edit && !sumRow?.locked && <div className="hub-pending-actions">
      <button type="button" disabled={busy || !anyChecked} onClick={() => void bulkOnLeave()}>
        {L('নির্বাচিতদের ছুটি/অনুপস্থিত হিসেবে ০ জমা দিন', 'Submit selected as 0 (on leave/absent)')}
      </button>
      <button type="button" className="secondary" disabled={busy || (sumRow?.not_submitted_count ?? 1) + (sumRow?.review_pending ?? 1) > 0}
        onClick={() => void lockDay()}>{L('খাতা সম্পূর্ণ করে লক করুন', 'Complete and lock day')}</button>
    </div>}
    {sumRow?.locked && canUnlock && <form onSubmit={event => { event.preventDefault(); void unlockDay() }} className="hub-pending-unlock">
      <Field label={L('আনলকের কারণ', 'Unlock reason')}>
        <input maxLength={500} value={lockReason} onChange={e => setLockReason(e.target.value)} />
      </Field>
      <button type="submit" disabled={busy || !lockReason.trim()}>{L('খাতা আনলক করুন', 'Unlock day')}</button>
    </form>}
    {error && <p role="alert">{error}</p>}

    <ul className="hub-pending-rows">
      {data.rows.map(row => {
        const absent = row.leave_applied_on || ABSENT_STATES.has(row.attendance)
        return <li key={row.employee_id} className={absent ? 'hub-pending-row absent' : 'hub-pending-row'}>
          <strong>{row.name}</strong>
          {row.attendance !== 'unknown' && <span className="hub-att-tag">{row.attendance}</span>}
          {row.leave_applied_on && <span className="hub-att-tag">{L('ছুটি আবেদন', 'Leave applied')} · {row.leave_applied_on}</span>}
          <p>{row.count === null ? L('জমা হয়নি', 'Not submitted')
            : `${n(row.count)} · ${row.approved ? L('অনুমোদিত ✓', 'Approved ✓')
                                 : row.return_reason ? L('ফেরত দেওয়া হয়েছে', 'Returned') : L('যাচাই বাকি', 'Review due')}`}</p>
          {row.proxy_reason && <p>{L('পক্ষে/ব্যাকআপ জমা', 'Proxy / backup entry')} · {row.proxy_reason}</p>}
          {row.return_reason && <p>{L('ফেরতের কারণ', 'Return reason')} · {row.return_reason}</p>}
          {data.can_edit && !sumRow?.locked && <div className="hub-pending-row-actions">
            {row.snapshot === null && <>
              <label><input type="checkbox" disabled={busy}
                checked={!!checkedBulk[row.employee_id]}
                onChange={e => setCheckedBulk(s => ({ ...s, [row.employee_id]: e.target.checked }))} />
                {L('নির্বাচন', 'Select')}</label>
              <button type="button" className="secondary" disabled={busy}
                onClick={() => { resetForm(); setProxy(row.employee_id) }}>{L('পক্ষে এন্ট্রি দিন', 'Enter on behalf')}</button>
            </>}
            {row.snapshot && !row.approved && !row.return_reason && <>
              <button type="button" disabled={busy} onClick={() => void save(row, 'approve')}>{L('অনুমোদন', 'Approve')}</button>
              <button type="button" className="secondary" disabled={busy}
                onClick={() => { resetForm(); setReturning(row.employee_id) }}>{L('ফেরত দিন', 'Return')}</button>
            </>}
            {row.snapshot && row.approved && <button type="button" className="secondary" disabled={busy}
              onClick={() => { resetForm(); setUnlocking(row.employee_id); setReason('') }}>{L('আনলক / পুনরায় খুলুন', 'Reopen')}</button>}
          </div>}
          {returning === row.employee_id && row.snapshot && !row.return_reason && !row.approved &&
            <form onSubmit={event => { event.preventDefault(); void save(row, 'return') }}>
              <Field label={L('ফেরতের কারণ', 'Return reason')}>
                <input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              </Field>
              <button type="submit" disabled={busy || !reason.trim()}>{L('কারণসহ ফেরত দিন', 'Return with reason')}</button>
            </form>}
          {unlocking === row.employee_id && row.snapshot && row.approved &&
            <form onSubmit={event => { event.preventDefault(); void save(row, 'unlock') }}>
              <Field label={L('পুনরায় খোলার কারণ', 'Reopen reason')}>
                <input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              </Field>
              <button type="submit" disabled={busy || !reason.trim()}>{L('পুনরায় খুলুন', 'Reopen')}</button>
            </form>}
          {proxy === row.employee_id && row.snapshot === null && <form onSubmit={event => { event.preventDefault(); void save(row, 'proxy') }}>
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
        </li>
      })}
    </ul>
  </div>
}
