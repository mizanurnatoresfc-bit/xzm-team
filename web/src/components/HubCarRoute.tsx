import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { dashboard } from '../lib/dashboard'
import { fleet, ROLE_BN, type Mine } from '../lib/fleet'
import { pageAllowed } from '../lib/menu'
import { hrReq } from '../lib/hrreq'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

type Level = 'staff' | 'manager' | 'zone'
const quiet = <T,>(p: PromiseLike<T>, or: T): Promise<T> => Promise.resolve(p).then(x => x, () => or)
const count = (q: PromiseLike<{ count: number | null }>) => quiet(q.then(r => r.count ?? 0), 0)

/**
 * আমার হাব · আমার গাড়ি · রুট — the same three cards on every panel's home screen, each reading its own level:
 * a staff member sees their own hub, vehicle and route; a hub manager the hub's team, vehicles and riders' routes;
 * a zonal manager every hub, vehicle and route in the zone. It only reads and links to the pages that already do the work.
 */
export function HubCarRoute({ level }: { level: Level }) {
  const { L, n } = usePrefs()
  const { can, menu } = useAuth()
  const ok = (to: string) => pageAllowed(menu, to)
  const d = useLoad(async () => {
    const [home, me] = await Promise.all([quiet(dashboard.home(), null), quiet(hrReq.myEmployee(), null)])
    const hubId = me?.hub_id ?? null
    if (level === 'staff') {
      const [team, car, routes] = await Promise.all([
        hubId ? count(supabase.from('employees').select('id', { count: 'exact', head: true }).eq('hub_id', hubId).eq('status', 'active').is('archived_at', null)) : 0,
        quiet(fleet.mine(), null as Mine | null),
        me ? quiet(supabase.from('rider_routes').select('hub_routes(name, areas)').eq('employee_id', me.id).is('effective_to', null)
          .then(r => ((r.data ?? []) as unknown as Array<{ hub_routes: { name: string; areas: string[] } | null }>).map(x => x.hub_routes).filter(Boolean) as Array<{ name: string; areas: string[] }>), [] as Array<{ name: string; areas: string[] }>) : [],
      ])
      return { kind: 'staff' as const, hubName: home?.me?.hub ?? null, zoneName: home?.me?.zone ?? null, team, car, routes }
    }
    const hubScope = level === 'manager' ? hubId : null
    const [hubs, team, board, routeCount] = await Promise.all([
      level === 'zone' ? count(supabase.from('hubs').select('id', { count: 'exact', head: true }).is('archived_at', null)) : 1,
      count((hubScope ? supabase.from('employees').select('id', { count: 'exact', head: true }).eq('hub_id', hubScope) : supabase.from('employees').select('id', { count: 'exact', head: true }))
        .eq('status', 'active').is('archived_at', null)),
      can('vehicle.vehicle.view') ? quiet(fleet.board(hubScope), []) : [],
      count(hubScope ? supabase.from('hub_routes').select('id', { count: 'exact', head: true }).eq('hub_id', hubScope).is('archived_at', null)
        : supabase.from('hub_routes').select('id', { count: 'exact', head: true }).is('archived_at', null)),
    ])
    return { kind: 'lead' as const, hubName: home?.me?.hub ?? null, zoneName: home?.me?.zone ?? null, hubs, team, vehicles: board.length, routeCount }
  }, [level])
  const v = d.data
  const card = (to: string | null, tone: string, icon: string, head: string, big: string, sub: string) => {
    const body = <><span className="i"><Icon name={icon} size={20} /></span><small>{head}</small><b>{big}</b><span className="hcr-sub">{sub}</span></>
    return to && ok(to) ? <Link to={to} className={`sp-tile hcr t-${tone}`}>{body}</Link> : <div className={`sp-tile hcr t-${tone} off`}>{body}</div>
  }
  if (d.loading && !v) return null
  if (!v) return null

  if (v.kind === 'staff') {
    const car = v.car?.vehicles[0] ?? null
    const rt = v.routes[0] ?? null
    return <section className="hcr-sec" aria-label={L('আমার হাব, গাড়ি ও রুট', 'My hub, vehicle and route')}>
      <h2 className="sd-h">{L('আমার হাব · গাড়ি · রুট', 'My hub · vehicle · route')}</h2>
      <div className="hcr-grid">
        {card('/app/issues?tab=group', 'g', 'hub', L('আমার হাব', 'My hub'), v.hubName ?? L('হাব দেওয়া হয়নি', 'No hub'),
          [v.zoneName, v.team ? L(`${n(v.team)} জন সক্রিয় সহকর্মী`, `${v.team} active colleagues`) : null].filter(Boolean).join(' · ') || L('হাব গ্রুপে যান', 'Open the hub group'))}
        {card('/app/fleet/mine', 'o', 'truck', L('আমার গাড়ি', 'My vehicle'), car ? car.name : L('গাড়ি নেই', 'No vehicle'),
          car ? [car.reg_no, ROLE_BN[car.role]].filter(Boolean).join(' · ') : L('ড্রাইভার/হেল্পার হলে এখানে আসবে', 'Shows here for a driver or helper'))}
        {card('/app/me', 'b', 'map', L('আমার রুট', 'My route'), rt ? rt.name : L('রুট দেওয়া হয়নি', 'No route'),
          rt ? [rt.areas.slice(0, 3).join(', '), v.routes.length > 1 ? L(`আরও ${n(v.routes.length - 1)}টি`, `+${v.routes.length - 1} more`) : ''].filter(Boolean).join(' · ') : L('হাব ম্যানেজার রুট দেন', 'Your hub manager gives a route'))}
      </div>
    </section>
  }

  const zone = level === 'zone'
  return <section className="hcr-sec" aria-label={L('হাব, গাড়ি ও রুট', 'Hub, vehicles and routes')}>
    <h2 className="sd-h">{zone ? L('জোনের হাব · গাড়ি · রুট', 'Zone hubs · vehicles · routes') : L('আমার হাব · গাড়ি · রুট', 'My hub · vehicles · routes')}</h2>
    <div className="hcr-grid">
      {card(zone ? '/app/org/hubs' : '/app/hub/team', 'g', 'hub', zone ? L('হাব', 'Hubs') : L('আমার হাব', 'My hub'),
        zone ? n(v.hubs) : v.hubName ?? '—', L(`${n(v.team)} জন সক্রিয় কর্মী`, `${v.team} active staff`))}
      {card('/app/fleet', 'o', 'truck', L('গাড়ি', 'Vehicles'), n(v.vehicles), zone ? L('জোনের সব হাবের গাড়ি, দায়িত্ব ও অনুমোদন', 'Every hub’s vehicles, crew and approvals') : L('হাবের গাড়ি, খোরাকি ও গ্যারেজ', 'The hub’s vehicles, allowance and garage'))}
      {card('/app/hub/routes', 'b', 'map', L('রাইডার রুট', 'Rider routes'), n(v.routeCount), zone ? L('হাব বেছে রুট দেখুন ও বদলান', 'Pick a hub to see and change routes') : L('রুট ও রাইডার ভাগ করুন', 'Set routes and riders'))}
    </div>
  </section>
}
