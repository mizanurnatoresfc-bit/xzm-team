import { useState } from 'react'
import { addDays, todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, wf, wfFriendly, type DailyOps } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { fmtDay, monthStart, prevMonth, WmTable, type WCol } from '../workforce/shared'

type Day = { date: string; entry?: DailyOps }

export function MyHubRegisterMonth() {
  const { L, n, lang } = usePrefs()
  const today = todayDhaka()
  const current = monthStart(today)
  const previous = prevMonth(current)
  const [selected, setSelected] = useState(current)
  const month = selected === previous ? previous : current
  const query = useLiveLoad(() => wf.ownOpsMonth(month), [month], ['wf_daily_ops'])
  const entries = new Map(query.data?.map(entry => [entry.work_date, entry]))
  const days: Day[] = []
  for (let date = month; date <= today && monthStart(date) === month; date = addDays(date, 1)) {
    days.push({ date, entry: entries.get(date) })
  }

  const numbers = [
    ['pickup', L('পিকআপ', 'Pickup')],
    ['pickup_return', L('পিকআপ ফেরত', 'Pickup return')],
    ['delivery', L('ডেলিভারি', 'Delivery')],
    ['delivery_return', L('ডেলিভারি রিটার্ন', 'Delivery return')],
  ] as const
  const columns: WCol<Day>[] = [
    { key: 'date', label: L('তারিখ', 'Date'), primary: true, cell: row => fmtDay(row.date, lang) },
    { key: 'state', label: L('জমা', 'Submission'), cell: row => row.entry ? L('জমা হয়েছে', 'Submitted') : L('জমা হয়নি', 'Not submitted') },
    ...numbers.map(([key, label]): WCol<Day> => ({
      key, label, num: true, cell: row => row.entry ? n(row.entry[key]) : '—',
    })),
  ]

  return <section className="panel wm-sec">
    <Field label={L('মাস', 'Month')}>
      <select value={month} onChange={event => setSelected(event.target.value)}>
        <option value={current}>{L('চলতি মাস', 'Current month')}</option>
        <option value={previous}>{L('আগের মাস', 'Previous month')}</option>
      </select>
    </Field>
    {query.error ? <p className="da-error" role="alert">{wfFriendly(query.error)}</p>
      : query.loading ? <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : <WmTable rows={days} cols={columns} rowKey={row => row.date}
          title={L('আমার মাসের কাজের হিসাব', 'My monthly work entries')} file={`my-work-${month.slice(0, 7)}`} />}
  </section>
}
