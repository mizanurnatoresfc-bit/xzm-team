// /app/routes — the one page for all route work (before: four pages in four menus). It loads what the parts share (the zones the person may see, one zone's
// routes), shows the parts the person may use as tabs (lib/routeModule.ts decides which), and owns the route editor and the rider picker.
// Address: /app/routes?tab=<part>&zone=<id>&hub=<id>&route=<id>. The old addresses redirect here (see App.tsx).
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { askReason } from '../../components/ask'
import { Icon } from '../../components/Icon'
import { Field, Stat, useLoad, useToast } from '../accounts/ui'
import { RiderPicker } from '../zonal/RouteSettings'
import { RouteEditor, type NewDraft } from './RouteEditor'
import { PANE_VIEWS, type PaneCtx } from './panes'
import { usePrefs } from '../../lib/prefs'
import { runChecks } from '../../lib/routeChecks'
import { PANE_GROUPS, panesFor, pickPane, type PaneGroup } from '../../lib/routeModule'
import { fmtKm, hasGps, routeApi, routeFriendly, type RouteHub, type ZoneRoute } from '../../lib/routes'
import './routes.css'

export function RouteModule() {
  const { L, n } = usePrefs()
  const fmt = { L, n }
  const { can, menu } = useAuth()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const zones = useLoad(() => routeApi.zones(), [])
  const [zone, setZone] = useState(sp.get('zone') ?? '')
  useEffect(() => { if (!zone && zones.data?.length) setZone(zones.data[0].id) }, [zones.data, zone])
  const ov = useLoad(() => zone ? routeApi.overview(zone) : Promise.resolve(null), [zone])
  const o = ov.data
  const [want, setWant] = useState(sp.get('tab'))
  const [hub, setHub] = useState(sp.get('hub') ?? '')
  const [sel, setSel] = useState<string | null>(sp.get('route'))
  const [edit, setEdit] = useState<ZoneRoute | NewDraft | null>(null)
  const [riders, setRiders] = useState<ZoneRoute | null>(null)
  const [err, setErr] = useState('')

  const zonesReady = zones.data !== null || zones.error !== null
  const hasZone = (zones.data?.length ?? 0) > 0
  const panes = useMemo(() => panesFor({ can, menu, hasZone, visits: o ? o.can.visits : undefined }), [can, menu, hasZone, o])
  const cur = zonesReady ? pickPane(panes, want) : undefined
  const zonePane = cur?.needs === 'zone'

  // the address follows the page (zone, part, hub, picked route), so a refresh, a bookmark or a shared link lands on the same thing
  useEffect(() => {
    if (!zonesReady) return
    const q = new URLSearchParams()
    if (zone) q.set('zone', zone)
    if (cur && cur.id !== panes[0]?.id) q.set('tab', cur.id)
    if (hub) q.set('hub', hub)
    if (sel) q.set('route', sel)
    setSp(q, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, cur?.id, hub, sel, zonesReady])

  // on a phone the tab strip scrolls sideways: keep the open part in view
  useEffect(() => { document.querySelector('.rm-tabs [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [cur?.id])

  const hubOf = useMemo(() => Object.fromEntries((o?.hubs ?? []).map(h => [h.id, h])) as Record<string, RouteHub>, [o])
  const routes = useMemo(() => (o?.routes ?? []).filter(r => !hub || r.hub_id === hub), [o, hub])
  const canEdit = (hubId: string) => !!o?.can.edit_hubs.includes(hubId)
  const canArchive = (hubId: string) => !!o?.can.archive_hubs.includes(hubId)
  const findings = useMemo(() => o ? runChecks(o, { L, n }) : [], [o, L, n])

  async function archive(r: ZoneRoute) {
    const why = (await askReason(L(`"${r.name}" রুট সরানোর কারণ`, `Why remove "${r.name}"?`), { ok: L('সরান', 'Remove') })) ?? ''
    if (!why.trim()) return
    try { await routeApi.archive(r.id, why.trim()); toast(L('রুট সরানো হয়েছে', 'Route removed')); if (sel === r.id) setSel(null); await ov.reload() } catch (e) { setErr(routeFriendly(e)) }
  }
  const c: PaneCtx = {
    zone, hub, setHub: h => { setHub(h); setSel(null) }, o, hubOf, routes, sel, setSel, canEdit, canArchive, findings,
    edit: r => { setErr(''); setEdit(r) }, riders: setRiders, archive: r => void archive(r),
    reload: async () => { await ov.reload() }, toast,
    go: (tab, patch) => { setWant(tab); if (patch && 'hub' in patch) setHub(patch.hub ?? ''); if (patch && 'route' in patch) setSel(patch.route ?? null) },
  }

  const stats = useMemo(() => {
    if (!o) return null
    const rs = o.routes.filter(r => !hub || r.hub_id === hub)
    const staff = o.hubs.filter(h => !hub || h.id === hub).flatMap(h => h.staff)
    const stops = rs.reduce((t, r) => t + r.stops.length, 0), gps = rs.reduce((t, r) => t + r.stops.filter(hasGps).length, 0)
    return { routes: rs.length, stops, gps, km: rs.reduce((t, r) => t + (r.road_km ?? r.distance_km ?? 0), 0),
      withRoute: staff.filter(s => s.routes > 0).length, noRoute: staff.filter(s => s.rider && s.routes === 0), noRider: rs.filter(r => !r.riders.length).length,
      today: rs.reduce((t, r) => t + (o.visits_today[r.id] ?? 0), 0) }
  }, [o, hub])

  const groups = (Object.keys(PANE_GROUPS) as PaneGroup[]).map(g => ({ g, list: panes.filter(p => p.group === g) })).filter(x => x.list.length)
  const View = cur ? PANE_VIEWS[cur.id] : null
  const canNew = zonePane && o && (canEdit(hub) || (!hub && o.can.edit_hubs.length > 0))

  return <AppShell title={L('রুট', 'Routes')}
    subtitle={L('রাইডার রুট, এলাকা ও লোকেশন, পার্সেল পরিকল্পনা, চেক-ইন আর সোর্টিং রুট — সব এক জায়গায়।', 'Rider routes, areas & locations, parcel planning, check-ins and sorting routes — all in one place.')}
    actions={canNew ? <button onClick={() => { setErr(''); setEdit({ hub_id: hub || o!.can.edit_hubs[0] }) }}><Icon name="plus" size={16} />{L('নতুন রুট', 'New route')}</button> : undefined}>
    {node}
    <section className="da-filters panel no-print">
      {zonePane && (zones.data?.length ?? 0) > 1 && <Field label={L('জোন', 'Zone')}><select value={zone} onChange={e => { setZone(e.target.value); setHub(''); setSel(null) }}>
        {zones.data?.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
      {zonePane && o && <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => c.setHub(e.target.value)}>
        <option value="">{L('সব হাব', 'All hubs')}</option>{o.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
      <nav className="rm-tabs" aria-label={L('রুটের অংশ', 'Parts of the route module')}>
        {groups.map(({ g, list }) => <div key={g} className="rm-group" role="group" aria-label={L(PANE_GROUPS[g].bn, PANE_GROUPS[g].en)}>
          <span className="t">{L(PANE_GROUPS[g].bn, PANE_GROUPS[g].en)}</span>
          {list.map(p => <button key={p.id} type="button" className={cur?.id === p.id ? '' : 'secondary'} aria-current={cur?.id === p.id ? 'page' : undefined}
            title={p.hint ? L(p.hint.bn, p.hint.en) : undefined} data-pane={p.id} onClick={() => setWant(p.id)}>
            <Icon name={p.icon} size={14} />{L(p.bn, p.en)}{p.id === 'warn' && findings.length ? ` (${n(findings.length)})` : ''}</button>)}
        </div>)}
      </nav>
      {(ov.loading || zones.loading) && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}
    </section>

    {zonesReady && !panes.length && <section className="panel"><p className="muted">{L('রুটের কোনো অংশ দেখার অনুমতি আপনার রোলে নেই।', 'Your role may not open any part of the route module.')}</p></section>}
    {(ov.error || zones.error) ? <p className="da-error">{routeFriendly(ov.error ?? zones.error)}</p> : null}
    {err && <p className="da-error">{err}</p>}

    {zonePane && o && stats && <div className="da-stats">
      <Stat icon="map" label={L('রুট', 'Routes')} value={n(stats.routes)} sub={stats.noRider ? L(`${n(stats.noRider)}টায় রাইডার নেই`, `${stats.noRider} without rider`) : undefined} tone={stats.noRider ? 'warn' : undefined} />
      <Stat icon="pin" label={L('স্টপ (লোকেশনসহ)', 'Stops (with location)')} value={`${n(stats.gps)}/${n(stats.stops)}`} tone={stats.gps < stats.stops ? 'warn' : 'ok'} />
      <Stat icon="truck" label={L('রুট পাওয়া স্টাফ', 'Staff with a route')} value={n(stats.withRoute)} />
      <Stat icon="alert" label={L('রুট ছাড়া রাইডার', 'Riders without a route')} value={n(stats.noRoute.length)} tone={stats.noRoute.length ? 'warn' : undefined} sub={stats.noRoute.slice(0, 3).map(s => s.name).join(', ')} />
      <Stat icon="chart" label={L('মোট রুট দূরত্ব', 'Total route length')} value={fmtKm(stats.km, fmt)} />
      {o.can.visits && <Stat icon="check" label={L('আজকের চেক-ইন', "Today's check-ins")} value={n(stats.today)} />}
    </div>}

    {cur && View && (!zonePane || o) && <Suspense fallback={<p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}><View key={`${cur.id}:${zone}`} c={c} /></Suspense>}

    {o && edit && <RouteEditor o={o} start={edit} hubOf={hubOf}
      onClose={() => setEdit(null)} onSaved={id => { setEdit(null); setSel(id); setWant('map'); toast(L('রুট সেভ হয়েছে', 'Route saved')); void ov.reload() }} />}
    {o && riders && <RiderPicker o={o} route={riders} onClose={() => setRiders(null)}
      onSaved={() => { setRiders(null); toast(L('রাইডার সেভ হয়েছে', 'Riders saved')); void ov.reload() }} />}
  </AppShell>
}

