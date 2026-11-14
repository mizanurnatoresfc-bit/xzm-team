import { AppShell } from '../components/AppShell'
import { useLoad, useToast } from './accounts/ui'
import { usePrefs } from '../lib/prefs'
import { dmy, hr } from '../lib/hr'
import { referrals } from '../lib/extra'
import { ExtraFields, ReferralPanel } from './hr/ProfileExtras'
import { EmpBadge, useOrg } from './hr/common'

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
        <ExtraFields employee={e.id} zoneId={e.zone_id} self onSaved={m => toast(m)} />
        <ReferralPanel employee={e.id} zoneId={e.zone_id} self onSaved={m => toast(m)} />
      </>}
  </AppShell>
}
