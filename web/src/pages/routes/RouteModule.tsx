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
import { useRelease } from '../../lib/releaseAccess'
import { usePrefs } from '../../lib/prefs'
import { runChecks } from '../../lib/routeChecks'
import { PANE_GROUPS, panesFor, pickPane, type PaneGroup } from '../../lib/routeModule'
import { fmtKm, hasGps, routeApi, routeFriendly, type RouteHub, type ZoneRoute } from '../../lib/routes'
import './routes.css'

export function RouteModule() {
  const { L, n } = usePrefs()
  const fmt = { L, n }
  const { can, menu } = useAuth()
  const release = useRelease()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const zones = useLoad(() => routeApi.zones(), [])
  const zone = zones.data?.find(z => z.id === sp.get('zone'))?.id ?? zones.data?.[0]?.id ?? ''
  const ov = useLoad(async () => zone ? { zone, overview: await routeApi.overview(zone) } : null, [zone])
  const base = ov.data?.zone === zone ? ov.data.overview : null
  const want = sp.get('tab')
  const hub = base?.hubs.find(h => h.id === sp.get('hub'))?.id ?? ''
  const sel = sp.get('route')
  const [edit, setEdit] = useState<ZoneRoute | NewDraft | null>(null)
  const [riders, setRiders] = useState<ZoneRoute | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setEdit(null); setRiders(null); setErr('')
  }, [zone])

  const zonesReady = zones.data !== null || zones.error !== null
  const hasZone = (zones.data?.length ?? 0) > 0
  const panes = panesFor({ can, menu, hasZone, visits: base ? base.can.visits : undefined })
    .filter(pane => release.allows('routes.tab-' + pane.id))
  const cur = zonesReady ? pickPane(panes, want) : undefined
  const zonePane = cur?.needs === 'zone'
  // The road lines (thousands of points a route) are not in the zone data: they are fetched only while something draws or keeps them (the map, the route editor).
  const needRoads = !!base && (cur?.id === 'map' || !!edit)
  const roads = useLoad(async () => needRoads && zone ? { src: ov.data, paths: await routeApi.roadPaths(zone) } : null, [zone, needRoads, ov.data])
  const paths = roads.data && roads.data.src === ov.data ? roads.data.paths : null
  const o = useMemo(() => base && paths ? { ...base, routes: base.routes.map(r => ({ ...r, road_path: paths[r.id] ?? null })) } : base, [base, paths])

  function navigate(patch: Partial<Record<'tab' | 'zone' | 'hub' | 'route', string | null>>, replace = false) {
    const next = new URLSearchParams(sp)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (next.toString() !== sp.toString()) setSp(next, { replace })
  }

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
    try { await routeApi.archive(r.id, why.trim()); toast(L('রুট সরানো হয়েছে', 'Route removed')); if (sel === r.id) navigate({ route: null }, true); await ov.reload() } catch (e) { setErr(routeFriendly(e)) }
  }
  const c: PaneCtx = {
    zone, hub, setHub: h => navigate({ hub: h, route: null }, true), o, hubOf, routes, sel, setSel: id => navigate({ route: id }, true), canEdit, canArchive, findings,
    edit: r => { setErr(''); setEdit(r) }, riders: setRiders, archive: r => void archive(r),
    reload: async () => { await ov.reload() }, toast,
    go: (tab, patch) => navigate({ tab, ...patch }),
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

  function newRoute(fromPdf = false) {
    if (!canNew) return
    setErr('')
    setEdit({ hub_id: hub || o.can.edit_hubs[0], fromPdf })
  }

  return <AppShell title={L('রুট কেন্দ্র', 'Route centre')}
    actions={canNew ? <>
      <button className="secondary" onClick={() => newRoute(true)}><Icon name="upload" size={16} />{L('PDF থেকে রুট', 'Route from PDFs')}</button>
      <button onClick={() => newRoute()}><Icon name="plus" size={16} />{L('নতুন রুট', 'New route')}</button>
    </> : undefined}>
    {node}
    <section className="rm-toolbar panel no-print">
      <nav className="rm-tabs" aria-label={L('রুটের অংশ', 'Parts of the route module')}>
        {groups.map(({ g, list }) => <div key={g} className="rm-group" role="group" aria-label={L(PANE_GROUPS[g].bn, PANE_GROUPS[g].en)}>
          <span className="t">{L(PANE_GROUPS[g].bn, PANE_GROUPS[g].en)}</span>
          {list.map(p => <button key={p.id} type="button" className={cur?.id === p.id ? '' : 'secondary'} aria-current={cur?.id === p.id ? 'page' : undefined}
            title={p.hint ? L(p.hint.bn, p.hint.en) : undefined} data-pane={p.id} onClick={() => navigate({ tab: p.id })}>
            <Icon name={p.icon} size={14} />{L(p.bn, p.en)}{p.id === 'warn' && findings.length ? ` (${n(findings.length)})` : ''}</button>)}
        </div>)}
      </nav>
      {zonePane && (o || (zones.data?.length ?? 0) > 1) && <div className="rm-filters">
        {(zones.data?.length ?? 0) > 1 && <Field label={L('জোন', 'Zone')}><select value={zone} onChange={e => {
          navigate({ zone: e.target.value, hub: null, route: null })
        }}>
          {zones.data?.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
        {o && <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => c.setHub(e.target.value)}>
          <option value="">{L('সব হাব', 'All hubs')}</option>{o.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
      </div>}
      {(zones.loading || (zonePane && ov.loading)) && <p role="status" className="muted small">{L('রুটের তথ্য লোড হচ্ছে…', 'Loading route data…')}</p>}
    </section>

    {zonesReady && !zones.error && !panes.length && <section className="panel"><p className="muted">{L('দেখানোর মতো কোনো রুট বিভাগ পাওয়া যায়নি।', 'No route sections are available.')}</p></section>}
    {(zones.error || (zonePane && ov.error)) ? <section className="panel rm-load-error">
      <p className="da-error" role="alert">{routeFriendly(zones.error ?? ov.error)}</p>
      <button className="secondary" type="button" onClick={() => void (zones.error ? zones.reload() : ov.reload())}>{L('আবার চেষ্টা করুন', 'Try again')}</button>
    </section> : null}
    {err && <p className="da-error">{err}</p>}

    {zonePane && o && stats && <div className="da-stats rm-stats">
      <Stat icon="map" label={L('রুট', 'Routes')} value={n(stats.routes)} sub={stats.noRider ? L(`${n(stats.noRider)}টায় রাইডার নেই`, `${stats.noRider} without rider`) : undefined} tone={stats.noRider ? 'warn' : undefined} />
      <Stat icon="pin" label={L('স্টপ (লোকেশনসহ)', 'Stops (with location)')} value={`${n(stats.gps)}/${n(stats.stops)}`} tone={stats.gps < stats.stops ? 'warn' : 'ok'} />
      <Stat icon="truck" label={L('রুট পাওয়া স্টাফ', 'Staff with a route')} value={n(stats.withRoute)} />
      <Stat icon="alert" label={L('রুট ছাড়া রাইডার', 'Riders without a route')} value={n(stats.noRoute.length)} tone={stats.noRoute.length ? 'warn' : undefined} sub={stats.noRoute.slice(0, 3).map(s => s.name).join(', ')} />
      <Stat icon="chart" label={L('মোট রুট দূরত্ব', 'Total route length')} value={fmtKm(stats.km, fmt)} />
      {o.can.visits && <Stat icon="check" label={L('আজকের চেক-ইন', "Today's check-ins")} value={n(stats.today)} />}
    </div>}

    {cur && View && (!zonePane || o) && <Suspense fallback={<p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}><View key={`${cur.id}:${zone}`} c={c} /></Suspense>}

    {o && edit && <RouteEditor o={o} start={edit} hubOf={hubOf}
      onClose={() => setEdit(null)} onSaved={(id, savedHub) => { setEdit(null); navigate({ tab: 'map', route: id, hub: hub && hub !== savedHub ? savedHub : sp.get('hub') }, true); toast(L('রুট সেভ হয়েছে', 'Route saved')); void ov.reload() }} />}
    {o && riders && <RiderPicker o={o} route={riders} onClose={() => setRiders(null)}
      onSaved={() => { setRiders(null); toast(L('রাইডার সেভ হয়েছে', 'Riders saved')); void ov.reload() }} />}
  </AppShell>
}

