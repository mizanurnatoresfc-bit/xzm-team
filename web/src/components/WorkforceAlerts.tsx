// Small alert cards for what is waiting on the person: days of attendance still to give, days the manager returned,
// today's four numbers not given yet, and — for managers — inputs and applications waiting for a decision.
// Nothing waiting = nothing shown. The numbers are the shared live copy of wf_pending_counts() (see PersonalMenu).
import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { usePrefs } from '../lib/prefs'
import { Icon } from './Icon'
import { useWfCounts } from './PersonalMenu'
import '../workforce.css'

type Row = { key: string; to: string; tone: 'warn' | 'bad' | 'info'; icon: string; title: string; sub?: string; scrollTo?: string }

export function WorkforceAlerts() {
  const { L, n } = usePrefs()
  const { data } = useWfCounts()
  const mine = data?.mine ?? null, manage = data?.manage ?? null
  const rows: Row[] = []
  if (mine && mine.missing_days > 0) rows.push({ key: 'missing', to: '/app/workforce/attendance', tone: 'warn', icon: 'clock',
    title: L(`${n(mine.missing_days)} দিনের হাজিরা বাকি`, `${mine.missing_days} day${mine.missing_days === 1 ? '' : 's'} of attendance not given`),
    sub: L('হাজিরা বইয়ে প্রতিটি তারিখ আলাদা করে দিন', 'Give each date in the attendance book') })
  if (mine && mine.returned_days > 0) rows.push({ key: 'returned', to: '/app/workforce/attendance', tone: 'bad', icon: 'alert',
    title: L(`${n(mine.returned_days)} দিনের হাজিরা ফেরত এসেছে`, `${mine.returned_days} day${mine.returned_days === 1 ? '' : 's'} of attendance returned`),
    sub: L('কারণ দেখে আবার দিন', 'See the reason and give it again') })
  if (mine && mine.ops_expected && !mine.ops_submitted_today) rows.push({ key: 'ops', to: '/app/staff#wf-ops', tone: 'warn', icon: 'box', scrollTo: 'wf-ops',
    title: L('আজকের পিকআপ ও ডেলিভারি এখনো দেননি', "Today's pickup and delivery are not given yet"),
    sub: L('চারটি সংখ্যা লিখে জমা দিন', 'Write the four numbers and submit') })
  if (manage && manage.marks_waiting + manage.applications_pending > 0) rows.push({ key: 'manage', to: '/app/workforce/hub', tone: 'info', icon: 'checkall',
    title: L(`${n(manage.marks_waiting)}টি হাজিরা অনুমোদন বাকি · ${n(manage.applications_pending)}টি আবেদন`,
      `${manage.marks_waiting} attendance to approve · ${manage.applications_pending} application${manage.applications_pending === 1 ? '' : 's'}`),
    sub: L('হাজিরা বই খুলে দেখুন', 'Open the attendance book') })
  if (!rows.length) return null

  // On the staff panel the "numbers" card scrolls to the section instead of reloading the page.
  const go = (r: Row) => (e: MouseEvent) => {
    const el = r.scrollTo ? document.getElementById(r.scrollTo) : null
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  }
  return <div className="wf-alerts" aria-live="polite">{rows.map(r => <Link key={r.key} to={r.to} className={`wf-alert t-${r.tone}`} onClick={go(r)}>
    <span className="wf-alert-i"><Icon name={r.icon} size={18} /></span>
    <span className="wf-alert-t"><b>{r.title}</b>{r.sub && <small>{r.sub}</small>}</span>
    <Icon name="chev" size={16} /></Link>)}</div>
}
