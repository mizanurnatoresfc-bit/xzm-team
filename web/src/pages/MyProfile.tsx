import { AppShell, useMyPhoto } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLoad, useToast } from './accounts/ui'
import { usePrefs } from '../lib/prefs'
import { dmy, hr } from '../lib/hr'
import { referrals } from '../lib/extra'
import { supabase } from '../lib/supabase'
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
  const photo = useMyPhoto()
  const { session, can } = useAuth()
  const roles = useLoad(async () => {
    const { data } = await supabase.from('user_roles').select('roles(name)').eq('user_id', session?.user.id ?? '').is('revoked_at', null)
    return ((data ?? []) as unknown as Array<{ roles: { name: string } | null }>).map(r => r.roles?.name).filter(Boolean) as string[]
  }, [session?.user.id])
  const duties = useLoad(() => e ? dutiesApi.mine(e.id).catch(() => []) : Promise.resolve([]), [e?.id])
  const myRoutes = useLoad(() => e ? routesApi.mine().catch(() => []) : Promise.resolve([]), [e?.id])
  return <AppShell title={L('আমার প্রোফাইল', 'My profile')} subtitle={e ? <>{e.employee_code ? <>{L('এমপ্লয়ি আইডি', 'Employee ID')} <strong>{e.employee_code}</strong> · </> : null}<EmpBadge status={e.status} /></> : undefined}>
    {node}
    {me.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !e ? <p className="notice">{L('আপনার লগইন এখনো কোনো কর্মীর প্রোফাইলের সাথে যুক্ত নয়। HR-কে বলুন যুক্ত করে দিতে।', 'Your login is not linked to an employee profile yet. Ask HR to link it.')}</p>
      : <>
        <div className="p-hero">
          <div className="p-band" />
          <div className="p-body">
            <div className="p-photo">{photo ? <img src={photo} alt="" /> : (e.full_name || '?').slice(0, 2).toUpperCase()}<span className="p-dot" /></div>
            <h2>{e.full_name} <EmpBadge status={e.status} /></h2>
            <div className="p-meta">
              {e.employee_code && <span><b>#</b> {e.employee_code}</span>}
              {session?.user.email && <span><Icon name="note" size={15} /> {session.user.email}</span>}
              {e.mobile && <span><Icon name="cc" size={15} /> {e.mobile}</span>}
              {e.position_id && <span><Icon name="org" size={15} /> {o.names.pos[e.position_id]}</span>}
              {e.hub_id && <span><Icon name="hub" size={15} /> {o.names.hub[e.hub_id]}</span>}
            </div>
            {!!roles.data?.length && <div className="p-roles">{roles.data.map(r => <span key={r} className="p-role">{r}</span>)}</div>}
            {can('hr.employee.edit') ? <Link to={`/app/hr/employees/${e.id}`} className="p-edit"><Icon name="edit" size={18} />{L('প্রোফাইল এডিট', 'Edit Profile')}</Link>
              : <p className="muted small">{L('কোনো তথ্য ভুল থাকলে HR-কে জানান।', 'Tell HR if anything is wrong.')}</p>}
          </div>
        </div>
        {photo === null && <div className="alert-card bad"><span className="ai"><Icon name="user" size={20} /></span><span>{L('আপনার প্রোফাইলের ছবি নেই — HR-কে ছবি দিন', 'Your profile photo is missing — give one to HR')}</span></div>}
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
