import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Field, Stat, useLoad } from '../accounts/ui'
import { bn, hr, hrFriendly, todayDhaka } from '../../lib/hr'
import { useOrg } from './common'

export function HrDashboard() {
  const today = todayDhaka()
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [hub, setHub] = useState('')
  const o = useOrg()
  const d = useLoad(() => hr.dashboard(from, to, null, hub || null), [from, to, hub])
  const n = (k: string) => Number((d.data as Record<string, unknown> | null)?.[k] ?? 0)
  return <AppShell title="HR ড্যাশবোর্ড" subtitle="আপনার এলাকার কর্মীদের সারসংক্ষেপ">
    <section className="da-filters panel no-print">
      <Field label="থেকে"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="পর্যন্ত"><input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Field>
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}><option value="">সব হাব</option>
        {o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
    </section>
    {d.error ? <p className="da-error">{hrFriendly(d.error)}</p> : null}
    <div className="da-stats">
      <Stat label="মোট কর্মী" value={bn(n('total_employees'))} sub={`সক্রিয় ${bn(n('active'))} · নিষ্ক্রিয় ${bn(n('inactive'))}`} />
      <Stat label="নতুন যোগদান" value={bn(n('new_joining'))} sub="এই সময়ে" tone="ok" />
      <Stat label="বদলি" value={bn(n('transferred'))} sub="এই সময়ে" />
      <Stat label="চাকরি ছেড়েছেন / অব্যাহতি" value={`${bn(n('resigned'))} / ${bn(n('terminated'))}`} sub="এই সময়ে" />
      <Stat label="আইডি আবেদন অপেক্ষমাণ" value={bn(n('pending_applications'))} tone={n('pending_applications') ? 'warn' : undefined} sub={<Link to="/app/hr/applications">দেখুন</Link>} />
      <Stat label="ছুটির অনুরোধ অপেক্ষমাণ" value={bn(n('pending_leave'))} tone={n('pending_leave') ? 'warn' : undefined} sub={<Link to="/app/hr/leave">দেখুন</Link>} />
      <Stat label="বেতন পরিবর্তন অপেক্ষমাণ" value={bn(n('pending_salary_changes'))} />
      <Stat label="তথ্য অসম্পূর্ণ" value={bn(n('employees_with_missing_info'))} tone={n('employees_with_missing_info') ? 'bad' : undefined} sub={<Link to="/app/hr/profile-gaps">কার কী বাকি দেখুন</Link>} />
    </div>
  </AppShell>
}
