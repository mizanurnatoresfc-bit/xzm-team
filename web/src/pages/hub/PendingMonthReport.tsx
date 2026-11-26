import { useState } from 'react'
import { addDays, todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, wf, wfFriendly, type PendingMonthDay } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { fmtDay, monthStart, prevMonth, WmTable, type WCol } from '../workforce/shared'

type Row = { date: string; pending?: PendingMonthDay }

export function PendingMonthReport({ hub, archive }: { hub: string; archive: boolean }) {
  const { L, n, lang } = usePrefs()
  const today = todayDhaka()
  const current = monthStart(today)
  const previous = prevMonth(current)
  const [month, setMonth] = useState(current)
  const query = useLiveLoad(() => wf.pendingMonth(hub, month), [hub, month])
  const records = new Map(query.data?.map(day => [day.date, day]))
  const rows: Row[] = []
  for (let date = month; date <= today && monthStart(date) === month; date = addDays(date, 1)) {
    rows.push({ date, pending: records.get(date) })
  }

  const numeric: ReadonlyArray<readonly [Exclude<keyof PendingMonthDay, 'date'>, string]> = [
    ['submissions', L('জমা দিয়েছেন', 'Submitted')],
    ['submitted_count', L('জমা পেন্ডিং', 'Submitted pending')],
    ['approvals', L('অনুমোদিত জমা', 'Approved submissions')],
    ['approved_count', L('অনুমোদিত পেন্ডিং', 'Approved pending')],
    ['returned', L('ফেরত', 'Returned')],
  ]
  const cols: WCol<Row>[] = [
    { key: 'date', label: L('তারিখ', 'Date'), primary: true, cell: row => fmtDay(row.date, lang) },
    ...numeric.map(([key, label]): WCol<Row> => ({
      key, label, num: true,
      cell: row => row.pending?.[key] == null ? '—' : n(row.pending[key]),
    })),
  ]
  const title = L('মাসিক পেন্ডিং রিপোর্ট', 'Monthly pending report')

  return <section className="wm-sec">
    <Field label={L('মাস', 'Month')}>
      {archive ? <input type="month" value={month.slice(0, 7)} max={current.slice(0, 7)}
        onChange={event => {
          const value = event.target.value
          if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= current.slice(0, 7)) setMonth(monthStart(value))
        }} /> : <select value={month} onChange={event => setMonth(event.target.value)}>
        <option value={current}>{L('চলতি মাস', 'Current month')}</option>
        <option value={previous}>{L('আগের মাস', 'Previous month')}</option>
      </select>}
    </Field>
    <p className="muted">{L('প্রতিদিন কর্মীর সর্বশেষ জমা ধরা হয়েছে।', 'Each day uses each worker’s latest submission.')}</p>
    {query.error ? <p role="alert">{wfFriendly(query.error)}</p>
      : query.loading ? <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
        : <WmTable rows={rows} cols={cols} rowKey={row => row.date} title={title} file={`pending-${month.slice(0, 7)}`} />}
  </section>
}
