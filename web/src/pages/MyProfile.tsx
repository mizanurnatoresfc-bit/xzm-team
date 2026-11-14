import { AppShell } from '../components/AppShell'
import { useLoad, useToast } from './accounts/ui'
import { usePrefs } from '../lib/prefs'
import { dmy, hr } from '../lib/hr'
import { referrals } from '../lib/extra'
import { ExtraFields, ReferralPanel } from './hr/ProfileExtras'
import { EmpBadge, useOrg } from './hr/common'
import { dutiesApi, FREQ, routesApi } from '../lib/hub'
import { Badge } from './accounts/ui'

/** The signed-in staff member's own profile: own data, extra fields, whom they brought, people in hand. */
export function MyProfile() {
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const o = useOrg()
  const me = useLoad(async () => {
    const id = await referrals.myEmployeeId()
    return id ? await hr.employee(id) : null
  }, [])
  const e = me.data
  const duties = useLoad(() => e ? dutiesApi.mine(e.id).catch(() => []) : Promise.resolve([]), [e?.id])
  const myRoutes = useLoad(() => e ? routesApi.mine().catch(() => []) : Promise.resolve([]), [e?.id])
  return <AppShell title={L('আমার প্রোফাইল', 'My profile')} subtitle={e ? <>{e.employee_code ? <>{L('এমপ্লয়ি আইডি', 'Employee ID')} <strong>{e.employee_code}</strong> · </> : null}<EmpBadge status={e.status} /></> : undefined}>
    {node}
    {me.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !e ? <p className="notice">{L('আপনার লগইন এখনো কোনো কর্মীর প্রোফাইলের সাথে যুক্ত নয়। HR-কে বলুন যুক্ত করে দিতে।', 'Your login is not linked to an employee profile yet. Ask HR to link it.')}</p>
      : <>
        <section className="panel">
          <h2>{L('আমার তথ্য', 'My details')}</h2>
          <dl className="hr-kv">
            <dt>{L('নাম', 'Name')}</dt><dd>{e.full_name}{e.full_name_bn ? ` (${e.full_name_bn})` : ''}</dd>
            <dt>{L('মোবাইল', 'Mobile')}</dt><dd>{e.mobile ?? '—'}</dd>
            <dt>{L('হাব', 'Hub')}</dt><dd>{e.hub_id ? o.names.hub[e.hub_id] ?? '—' : '—'}</dd>
            <dt>{L('পদবি', 'Position')}</dt><dd>{e.position_id ? o.names.pos[e.position_id] ?? '—' : '—'}</dd>
            <dt>{L('যোগদান', 'Joined')}</dt><dd>{dmy(e.joining_date)}</dd>
          </dl>
          <p className="muted small">{L('কোনো তথ্য ভুল থাকলে HR-কে জানান।', 'Tell HR if anything is wrong.')}</p>
        </section>
        <section className="panel">
          <h2>{L('আমার দায়িত্ব', 'My duties')}</h2>
          {duties.data?.length ? <ul className="duty-list">{duties.data.map(d => <li key={d.id} className="duty"><div style={{ flex: 1 }}><b>{d.title}</b>{' '}
            <Badge tone="info">{L(FREQ[d.frequency]?.[0] ?? d.frequency, FREQ[d.frequency]?.[1] ?? d.frequency)}</Badge>
            {d.details && <div className="muted small pre-wrap">{d.details}</div>}</div></li>)}</ul>
            : <p className="muted">{L('এখনো কোনো দায়িত্ব লেখা হয়নি।', 'No duties written yet.')}</p>}
          {myRoutes.data && myRoutes.data.length > 0 && <><h3>{L('আমার রুট', 'My routes')}</h3>
            {myRoutes.data.map(r => <div key={r.route_id} style={{ marginBottom: 8 }}><b>{r.hub_routes?.code} · {r.hub_routes?.name}</b>
              <div className="chips">{(r.hub_routes?.areas ?? []).map(a => <span key={a} className="chip">{a}</span>)}</div></div>)}</>}
        </section>
        <ExtraFields employee={e.id} zoneId={e.zone_id} self onSaved={m => toast(m)} />
        <ReferralPanel employee={e.id} zoneId={e.zone_id} self onSaved={m => toast(m)} />
      </>}
  </AppShell>
}
