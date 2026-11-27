import { useState } from 'react'
import { Link } from 'react-router-dom'
import { refreshShellCounts } from '../../components/AppShell'
import { usePrefs } from '../../lib/prefs'
import { announceWfChange, LIVE, useLiveLoad, wf, wfFriendly, type DailyOps, type Mark } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { FinalSheetTab } from './FinalSheet'
import { OperationsRegister } from './OperationsRegister'
import { PendingQueue } from '../hub/ManagerPendingCard'
import { KindBadge, Loading, NoteDialog, Section, Who } from './shared'

type ReturnItem = { kind: 'attendance'; row: Mark } | { kind: 'ops'; row: DailyOps }

export function HubReview({ hubId, date, today, canAttendance, canOps, onDate }: {
  hubId: string; date: string; today: string; canAttendance: boolean; canOps: boolean; onDate: (date: string) => void
}) {
  const { L, n } = usePrefs()
  const attendance = useLiveLoad(() => canAttendance
    ? wf.marks({ hub: hubId }, date, date, 'waiting') : Promise.resolve([]), [hubId, date, canAttendance], LIVE.manage)
  const ops = useLiveLoad(() => canOps
    ? wf.opsReport({ hub: hubId }, date, date) : Promise.resolve(null), [hubId, date, canOps], LIVE.manage)
  const [returning, setReturning] = useState<ReturnItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [registerRefresh, setRegisterRefresh] = useState(0)
  const refreshRegister = () => setRegisterRefresh(value => value + 1)
  const pending = ops.data?.rows.filter(row => row.hub_id === hubId && row.work_date === date && !row.review_status) ?? []
  const marks = (attendance.data ?? []).filter(row => row.hub_id === hubId && row.work_date === date && !row.record_status)

  async function changed() {
    setReturning(null)
    refreshRegister()
    announceWfChange()
    refreshShellCounts()
    await Promise.all([attendance.reload(), ops.reload()])
  }

  async function approve(row: DailyOps) {
    setBusy(true)
    setError('')
    try {
      await wf.decideOps(row, true)
      await changed()
    } catch (err) {
      setError(wfFriendly(err))
      await ops.reload()
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Section title={L('অনুমোদনের তালিকা', 'Approval queue')} tools={<Field label={L('তারিখ', 'Date')}>
      <input type="date" value={date} max={today} onChange={e => { if (e.target.value) onDate(e.target.value) }} />
    </Field>}>
      {error && <p className="da-error" role="alert">{error}</p>}
      {canAttendance && <section aria-label={L('অপেক্ষমাণ হাজিরা', 'Pending attendance')}>
        <h3>{L('অপেক্ষমাণ হাজিরা', 'Pending attendance')} · {n(marks.length)}</h3>
        {attendance.error ? <p className="da-error" role="alert">{wfFriendly(attendance.error)}</p> : attendance.loading ? <Loading /> :
          marks.length === 0 ? <p className="muted">{L('এই তারিখে অপেক্ষমাণ হাজিরা নেই।', 'No attendance is waiting on this date.')}</p> :
          <ul>{marks.map(row => <li key={row.id} className="row">
            <Who name={row.full_name} code={row.employee_code} />
            <KindBadge k={row.kind} />
            {row.note && <small>{row.note}</small>}
            {row.application_id ? <Link to={`/app/attendance?view=hub&hub=${hubId}&tab=apps`}>{L('আবেদন দেখুন', 'Open application')}</Link> :
              <button type="button" className="secondary sm" disabled={busy}
                onClick={() => setReturning({ kind: 'attendance', row })}>{L('ফেরত দিন', 'Return')}</button>}
          </li>)}</ul>}
      </section>}
      {canOps && <section aria-label={L('অপেক্ষমাণ অপারেশন', 'Pending operations')}>
        <h3>{L('অপেক্ষমাণ অপারেশন', 'Pending operations')} · {n(pending.length)}</h3>
        {ops.error ? <p className="da-error" role="alert">{wfFriendly(ops.error)}</p> : ops.loading ? <Loading /> :
          pending.length === 0 ? <p className="muted">{L('এই তারিখে অপেক্ষমাণ অপারেশন এন্ট্রি নেই।', 'No operations entries are waiting on this date.')}</p> :
          <ul>{pending.map(row => <li key={row.id} className="panel">
            <Who name={row.employee_name} code={row.employee_code} />
            <p>{L('পিকআপ', 'Pickup')} {n(row.pickup)} · {L('মার্চেন্টকে ফেরত', 'Merchant returns')} {n(row.pickup_return)} · {L('ডেলিভারি', 'Delivery')} {n(row.delivery)} · {L('ডেলিভারি রিটার্ন', 'Delivery returns')} {n(row.delivery_return)}</p>
            {row.note && <p className="small">{row.note}</p>}
            <div className="row">
              <button type="button" className="sm" disabled={busy} onClick={() => void approve(row)}>{L('অনুমোদন', 'Approve')}</button>
              <button type="button" className="secondary sm" disabled={busy} onClick={() => setReturning({ kind: 'ops', row })}>{L('ফেরত দিন', 'Return')}</button>
            </div>
          </li>)}</ul>}
      </section>}
    </Section>
    {canOps && <>
      <details className="panel">
        <summary>{L('স্টাফ ও রাইডারের পেন্ডিং এন্ট্রি যাচাই', 'Review staff and rider pending entries')}</summary>
        <PendingQueue hub={hubId} date={date} onChange={refreshRegister} />
      </details>
      <OperationsRegister hub={hubId} date={date} refresh={registerRefresh} />
    </>}
    {canAttendance && <details className="panel">
      <summary>{L('হাজিরা অনুমোদন · ফাইনাল খাতা', 'Approve attendance · Final register')}</summary>
      <FinalSheetTab hubId={hubId} />
    </details>}
    {returning && <NoteDialog title={L('সংশোধনের জন্য ফেরত দিন', 'Return for correction')}
      label={L('কেন ফেরত দিচ্ছেন?', 'Why are you returning this?')} confirm={L('ফেরত দিন', 'Return')}
      danger onClose={() => setReturning(null)}
      onConfirm={async note => {
        if (returning.kind === 'attendance') await wf.returnMark(returning.row, note)
        else await wf.decideOps(returning.row, false, note)
        await changed()
      }} />}
  </>
}
