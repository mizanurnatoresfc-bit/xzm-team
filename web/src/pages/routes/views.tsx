// One small view per part of the route module: it takes what the page loaded (PaneCtx) and shows the component that does the work.
import { Icon } from '../../components/Icon'
import { HubRoutesPane } from '../hub/HubManagement'
import { SortingRoutesPane } from '../sorting/Sorting'
import { PlacesTab } from '../zonal/RoutePlaces'
import { LoadTab } from '../zonal/RouteLoad'
import { CoverageTab } from '../zonal/RouteCoverage'
import { PlanTab } from '../zonal/RoutePlan'
import { DayView, RouteTable, RulesForm, ZoneMap } from '../zonal/RouteSettings'
import { useAuth } from '../../auth/AuthProvider'
import { MorningPolicy, ZoneMorningTab } from '../workforce/Morning'
import { usePrefs } from '../../lib/prefs'
import { LocationsPane } from './LocationsPane'
import type { PaneCtx } from './panes'
import type { ZoneOverview } from '../../lib/routes'

type P = { c: PaneCtx }
/** A zone part only mounts once the zone is loaded; the page never shows one before that. */
const zoneOf = (c: PaneCtx) => c.o as ZoneOverview

export function MapView({ c }: P) {
  return <ZoneMap o={zoneOf(c)} routes={c.routes} hubOf={c.hubOf} hub={c.hub} sel={c.sel} onSel={c.setSel}
    onEdit={c.edit} onRiders={c.riders} onArchive={c.archive} canEdit={c.canEdit} canArchive={c.canArchive} />
}
export function RoutesView({ c }: P) { return <RouteTable routes={c.routes} hubOf={c.hubOf} rules={zoneOf(c).rules} onOpen={r => c.go('map', { route: r.id })} /> }
export function PlacesView({ c }: P) { return <PlacesTab o={zoneOf(c)} hubOf={c.hubOf} initialHub={c.hub} onBuild={c.edit} /> }
export function CoverView({ c }: P) { return <CoverageTab o={zoneOf(c)} onPlan={h => c.go('places', { hub: h, route: null })} /> }
export function LoadView({ c }: P) {
  const { L } = usePrefs()
  return <LoadTab zone={c.zone} o={zoneOf(c)} hub={c.hub} canEdit={c.canEdit} onSaved={() => c.toast(L('সেভ হয়েছে', 'Saved'))} onOpen={id => c.go('map', { route: id })} />
}
export function PlanView({ c }: P) { return <PlanTab zone={c.zone || undefined} hub={c.hub} onHub={c.setHub} /> }
export function MorningView({ c }: P) {
  const { can } = useAuth()
  return <div className="wm">
    <ZoneMorningTab zone={c.zone} />
    {can('hr.attendance.configure') && <MorningPolicy key={c.zone} zone={c.zone} />}
  </div>
}
export function DayPane({ c }: P) { return <DayView zone={c.zone} o={zoneOf(c)} hub={c.hub} /> }
export function RulesView({ c }: P) {
  const { L } = usePrefs()
  const o = zoneOf(c)
  return <RulesForm zone={c.zone} rules={o.rules} canEdit={o.can.configure} onSaved={() => { c.toast(L('জোনের নিয়ম সেভ হয়েছে', 'Zone rules saved')); void c.reload() }} />
}
export function HubView() { return <HubRoutesPane /> }
export function SortingView() { return <SortingRoutesPane /> }
export function LocationsView({ c }: P) { return <LocationsPane c={c} /> }
export function WarnView({ c }: P) {
  const { L } = usePrefs()
  return <section className="panel"><h2>{L('যা ঠিক করা দরকার', 'What needs fixing')}</h2>
    {c.findings.length ? <ul className="rt-warn">{c.findings.map((w, i) => <li key={i} className={w.tone}>{w.text}
      {w.route && <> · <button className="secondary sm" onClick={() => c.go('map', { route: w.route! })}>{L('ম্যাপে দেখুন', 'Show on map')}</button></>}
      {w.code === 'stop_no_gps' && <> · <button className="secondary sm" onClick={() => c.go('locations', { route: null })}><Icon name="pin" size={13} />{L('লোকেশন দিন', 'Set location')}</button></>}</li>)}</ul>
      : <p className="muted">{L('সব ঠিক আছে — কোনো সতর্কতা নেই।', 'All good — nothing to fix.')}</p>}</section>
}
