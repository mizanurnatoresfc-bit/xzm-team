import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, wf, wfFriendly } from '../../lib/workforce'
import { useHubList } from '../workforce/shared'

/** খাতার অগ্রগতি — "X / Y জমা হয়েছে · Z যাচাই বাকি"
 *  Shown on top of HubRegisters so managers see how far each hub is from closing the day
 *  without having to drill into the review queue first. */
export function RegisterProgressStrip() {
  const { L, n } = usePrefs()
  const hubs = useHubList()
  const first = hubs.data?.hubs[0]
  const query = useLiveLoad(() => first ? wf.pendingQueueSummary(first.id) : Promise.resolve(null),
    [first?.id])
  const data = query.data
  if (!first || !data) return null
  const pct = data.total_staff ? Math.round((data.approved / data.total_staff) * 100) : 0
  return <section className="panel hub-register-progress" aria-live="polite">
    <h3>{L('আজকের অগ্রগতি', 'Today’s progress')} · {first.name}</h3>
    <div className="hub-progress-bar"><span style={{ width: `${pct}%` }} /></div>
    <p>
      {L(`${n(data.approved)} / ${n(data.total_staff)} অনুমোদিত`,
         `${data.approved} / ${data.total_staff} approved`)} ·
      {' '}{L('যাচাই বাকি', 'Review due')} {n(data.review_pending)} ·
      {' '}{L('জমা হয়নি', 'Not submitted')} {n(data.not_submitted_count)} ·
      {' '}{L('ফেরত', 'Returned')} {n(data.returned)}
      {data.locked && <strong> · {L('🔒 লক', '🔒 Locked')}</strong>}
    </p>
    {Boolean(query.error) && <p role="alert">{wfFriendly(query.error)}</p>}
  </section>
}
