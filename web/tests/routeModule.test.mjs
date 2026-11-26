// Tests of the route module's pure parts: reading a pasted location, the list of parts and who sees which, the warning rules and the
// location engine (search, "is this sensible?", many-at-once). Run:  npm run test:routes
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodePlusCode, isShortMapLink, meters, parseLocation } from '../src/lib/routeGeo.ts'
import { ROUTE_OLD_PAGES, ROUTE_PAGE, ROUTE_PERMS } from '../src/lib/routeAccess.ts'
import { PANE_GROUPS, ROUTE_MENU_PANES, ROUTE_PANES, paneLink, panesFor, pickPane, routeRedirect } from '../src/lib/routeModule.ts'
import { ROUTE_CHECKS, runChecks } from '../src/lib/routeChecks.ts'
import { assess, bulkToStops, nameFromLibrary, nameScore, norm, parseBulkRows, parseBulkText, resolveBulk, searchLocal, nearHub, LOCATION_SOURCES } from '../src/lib/routeLocation.ts'
import { hasPageAccess, inMenu, pageAllowed, pageNeeds, pageState } from '../src/lib/navAccess.ts'

import { parsePlanPdf } from '../src/lib/planPdf.ts'

test('mobile delivery lists read both split and combined column headings after a summary page', () => {
  const item = (s, x, y) => ({ s, x, y })
  const page = (split, id) => [
    item('ID', 46, 743),
    item(split ? 'MERCHANT' : 'MERCHANT DETAILS', 122, 743),
    ...(split ? [item('DETAILS', 180, 743)] : []),
    item('INVOICE', 266, 743),
    item(split ? 'CUSTOMER' : 'CUSTOMER DETAILS', 414, 743),
    ...(split ? [item('DETAILS', 471, 743)] : []),
    item('#' + id, 46, 692),
    item('Demo Area', 414, 678),
  ]
  const areas = []
  const result = parsePlanPdf([[item('Delivery List Information Date: Nov 26, 2026 Grand Total: 2', 46, 780)],
    page(true, 123456789), page(false, 123456790)], areas)
  assert.equal(result.counts.parcels, 2)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(areas, [{ id: 123456789, text: 'Demo Area' }, { id: 123456790, text: 'Demo Area' }])
})

const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
const canOf = (...p) => x => p.includes(x)
const near = (a, b, d = 0.0005) => assert.ok(Math.abs(a - b) <= d, `${a} is not near ${b}`)
const ids = list => list.map(p => p.id)

// ------------------------------------------------------------------ reading a pasted location
test('a location is read from numbers, Bangla digits, N/E letters, degrees-minutes-seconds and geo links', () => {
  assert.deepEqual(parseLocation('24.3745, 88.6042'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('24.3745 88.6042'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('২৪.৩৭৪৫, ৮৮.৬০৪২'), { lat: 24.3745, lng: 88.6042 }, 'Bangla digits')
  assert.deepEqual(parseLocation('88.6042, 24.3745'), { lat: 24.3745, lng: 88.6042 }, 'swapped numbers are put right')
  assert.deepEqual(parseLocation('24.3745N 88.6042E'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('geo:24.3745,88.6042'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('(24.3745, 88.6042)'), { lat: 24.3745, lng: 88.6042 })
  const dms = parseLocation('24°22\'28.2"N 88°36\'15.1"E')
  near(dms.lat, 24.3745); near(dms.lng, 88.6042)
})
test('a location is read from Google Maps and OpenStreetMap links', () => {
  assert.deepEqual(parseLocation('https://www.google.com/maps/place/Natore/@24.3745,88.6042,15z/data=!3m1'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('https://maps.google.com/?q=24.3745,88.6042'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('https://www.google.com/maps/place/x/data=!3d24.3745!4d88.6042'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('https://www.openstreetmap.org/#map=17/24.3745/88.6042'), { lat: 24.3745, lng: 88.6042 })
  assert.deepEqual(parseLocation('https://www.openstreetmap.org/?mlat=24.3745&mlon=88.6042#map=16/24.37/88.60'), { lat: 24.3745, lng: 88.6042 })
})
test('a full Plus Code is decoded; short links and rubbish are not read', () => {
  const p = decodePlusCode('849VCWC8+R9')   // Google's own example: the Googleplex
  near(p.lat, 37.4223, 0.001); near(p.lng, -122.0847, 0.001)
  assert.equal(decodePlusCode('X7X9+RC'), null, 'a short code needs a reference place')
  assert.equal(parseLocation('maps.app.goo.gl/AbCdEf'), null)
  assert.equal(isShortMapLink('https://maps.app.goo.gl/AbCdEf'), true)
  assert.equal(isShortMapLink('https://www.google.com/maps/@24.3,88.6,15z'), false)
  for (const t of ['', 'natore', '12', '1,2,3,4', '99999, 99999']) assert.equal(parseLocation(t), null, t)
})

// ------------------------------------------------------------------ the parts of the module and who sees which
const PERMS = {
  zonal: ['ops.route_setting.view', 'ops.route_setting.edit', 'ops.route_visit.view', 'ops.route_plan.view', 'sorting.center.view'],
  hubManager: ['ops.route.view', 'ops.route.edit'],
  planOnly: ['ops.route_plan.view'],
  sorting: ['sorting.center.view'],
  none: ['hr.attendance.view'],
}
const seen = (who, extra = {}) => ids(panesFor({ can: canOf(...PERMS[who]), menu: null, hasZone: who === 'zonal', ...extra }))

test('the parts are unique, grouped and each has a permission; ids stay stable (links and bookmarks use them)', () => {
  assert.equal(new Set(ids(ROUTE_PANES)).size, ROUTE_PANES.length)
  for (const p of ROUTE_PANES) { assert.ok(p.perms.length, p.id); assert.ok(PANE_GROUPS[p.group], p.id); assert.ok(p.legacy.length, `${p.id} names the old page it came from`) }
  assert.deepEqual(ids(ROUTE_PANES).filter(i => ['map', 'cover', 'places', 'routes', 'load', 'plan', 'day', 'warn', 'rules'].includes(i)).length, 9, 'the nine ?tab= values the old page used still exist')
})
test('every part has a view, and the view list names no part that is not in the registry', () => {
  const panes = src('pages/routes/panes.tsx'), views = src('pages/routes/views.tsx')
  const bound = [...panes.matchAll(/^\s+(\w+): view\('(\w+)'\)/gm)].map(m => [m[1], m[2]])
  assert.deepEqual(bound.map(b => b[0]).sort(), ids(ROUTE_PANES).sort())
  for (const [, v] of bound) assert.match(views, new RegExp(`export function ${v}\\b`), `views.tsx has ${v}`)
})
test('a zonal manager sees the zone parts; a hub manager only the hub part; a plan-only person only the plan', () => {
  const z = seen('zonal')
  for (const id of ['map', 'routes', 'locations', 'places', 'cover', 'load', 'plan', 'day', 'warn', 'rules', 'sorting']) assert.ok(z.includes(id), `zonal sees ${id}`)
  assert.ok(!z.includes('hub'), 'the hub part is for someone with no zone parts')
  assert.deepEqual(seen('hubManager'), ['hub'])
  assert.deepEqual(seen('planOnly'), ['plan'])
  assert.deepEqual(seen('sorting'), ['sorting'])
  assert.deepEqual(seen('none'), [])
})
test('no zone for the person → no zone part; the overview saying "no check-ins" hides that tab', () => {
  assert.ok(!seen('zonal', { hasZone: false }).includes('map'))
  assert.ok(!seen('zonal', { visits: false }).includes('day'))
  assert.ok(seen('zonal', { visits: true }).includes('day'))
})
test('a role limited to a page list keeps exactly the parts its old page had', () => {
  const of = (menu, who = 'zonal') => seen(who, { menu })
  assert.deepEqual(of(['/app/routes']).includes('map'), true, 'the module itself in the list = everything the person may do')
  assert.deepEqual(of(['/app/routes/plan']), ['plan'], 'only the parcel plan page listed → only the plan')
  assert.deepEqual(of(['/app/sorting/routes']), ['sorting'])
  assert.deepEqual(of(['/app/hub/routes'], 'hubManager'), ['hub'])
  const zone = of(['/app/zonal/routes'])
  assert.ok(zone.includes('map') && zone.includes('plan') && zone.includes('locations') && !zone.includes('sorting'), 'the old zone page had the zone parts and (for those with the permission) the plan')
  assert.deepEqual(of(['/app/staff/list']), [], 'a list without any route page → nothing')
})
test('the module page opens for a page list that names an old route page, and the old addresses keep working', () => {
  for (const old of Object.keys(ROUTE_OLD_PAGES)) {
    assert.equal(inMenu([old], ROUTE_PAGE), true, `${old} → module row`)
    assert.equal(pageAllowed([old], ROUTE_PAGE), true, `${old} → module page`)
  }
  assert.equal(pageAllowed([ROUTE_PAGE], '/app/zonal/routes'), true, 'a notification link to the old address still passes the list')
  assert.equal(inMenu(['/app/staff/list'], ROUTE_PAGE), false)
  assert.equal(pageAllowed(['/app/staff/list'], ROUTE_PAGE), false)
})
test('the page needs any one route permission; old addresses are redirects with no gate of their own', () => {
  assert.ok(pageNeeds(ROUTE_PAGE).includes('ops.route_setting.view') && pageNeeds(ROUTE_PAGE).includes('ops.route.view') && pageNeeds(ROUTE_PAGE).includes('sorting.center.view'))
  assert.equal(hasPageAccess(ROUTE_PAGE, canOf('ops.route.view')), true)
  assert.equal(hasPageAccess(ROUTE_PAGE, canOf('hr.attendance.view')), false)
  assert.equal(pageState(ROUTE_PAGE, { can: canOf('hr.attendance.view'), menu: null }), 'no-permission')
  for (const old of Object.keys(ROUTE_OLD_PAGES)) assert.equal(pageNeeds(old), null, `${old} decides nothing itself`)
})
test('old addresses redirect to the part the old page was', () => {
  assert.equal(routeRedirect('/app/zonal/routes'), '/app/routes')
  assert.equal(routeRedirect('/app/routes/plan'), '/app/routes?tab=plan')
  assert.equal(routeRedirect('/app/hub/routes'), '/app/routes?tab=hub')
  assert.equal(routeRedirect('/app/sorting/routes'), '/app/routes?tab=sorting')
  assert.equal(routeRedirect('/app/other'), null)
  assert.equal(paneLink('map'), '/app/routes'); assert.equal(paneLink('locations'), '/app/routes?tab=locations')
  const app = src('App.tsx')
  for (const old of Object.keys(ROUTE_OLD_PAGES)) assert.match(app, new RegExp(`<Route path="${old}" element=\\{<RouteRedirect`), `${old} is a redirect in App.tsx`)
  assert.match(app, /<Route path="\/app\/routes" element=\{<RouteModule \/>\}/)
})
test('the menu has ONE route group built from the part list, and none of the old four rows', () => {
  const shell = src('components/AppShell.tsx')
  for (const old of Object.keys(ROUTE_OLD_PAGES)) assert.doesNotMatch(shell, new RegExp(`\\{ to: '${old}'`), `${old} is no menu row any more`)
  assert.match(shell, /export const ROUTES: Group = panel\('routes'/)
  assert.deepEqual(ids(ROUTE_MENU_PANES), ['sorting', 'locations', 'plan'].sort((a, b) => ids(ROUTE_PANES).indexOf(a) - ids(ROUTE_PANES).indexOf(b)))
  for (const f of ['pages/users/MenuEditor.tsx', 'pages/users/RoleDashboards.tsx', 'pages/access/common.tsx']) assert.match(src(f), /\bROUTES\b/, `${f} lists the route group`)
})
test('a pane is picked from the address, else the first allowed one', () => {
  const panes = panesFor({ can: canOf(...PERMS.zonal), menu: null, hasZone: true })
  assert.equal(pickPane(panes, 'locations').id, 'locations')
  assert.equal(pickPane(panes, 'hub').id, panes[0].id, 'a part the person may not use falls back')
  assert.equal(pickPane(panes, null).id, 'map')
  assert.equal(pickPane([], 'map'), undefined)
  assert.ok(Object.keys(ROUTE_PERMS).length >= 5)
})

// ------------------------------------------------------------------ the warning rules
const rules = { max_stops: 5, max_riders: 2, max_routes_per_rider: 2, stop_radius_m: 150, speed_kmh: 18, stop_minutes: 4, start_time: '10:00', gps_required: false, checkin_open: true }
const stop = (name, lat, lng) => ({ id: name, name, kind: 'area', lat, lng, radius_m: null, minutes: null, note: null })
const route = (id, hub, name, stops, riders = [{ employee_id: 'e1', name: 'A' }]) => ({ id, hub_id: hub, zone_id: 'z', code: id, name, note: null, color: null, shift: 'day', distance_km: 3, road_km: null, road_minutes: null, road_path: null,
  stops_gps: stops.filter(s => s.lat !== null).length, updated_at: '', stops, riders })
const overview = routes => ({ zone: { id: 'z', code: 'NT', name: 'Natore' }, rules, can: { configure: true, visits: true, edit_hubs: ['h1'], archive_hubs: ['h1'] },
  hubs: [{ id: 'h1', code: '1', name: 'Natore', lat: 24.41, lng: 88.99, staff: [{ id: 'e2', code: '2', name: 'Free Rider', rider: true, routes: 0 }] }, { id: 'h2', code: '2', name: 'Nogps', lat: null, lng: null, staff: [] }],
  routes, visits_today: {} })
const T = { L: (b, e) => e, n: v => String(v) }
test('the warning rules find what they should, each under its own code', () => {
  const o = overview([
    route('r1', 'h1', 'Town', [stop('A', 24.411, 88.991), stop('B', 24.4111, 88.9911), stop('NoLoc', null, null), stop('Far', 25.6, 89.9)], []),
    route('r2', 'h1', 'East', [stop('C', 24.4112, 88.9912)]),
  ])
  const found = new Set(runChecks(o, T).map(f => f.code))
  for (const code of ['hub_no_gps', 'rider_no_route', 'route_no_rider', 'stop_no_gps', 'same_spot', 'far_stop', 'shared_place']) assert.ok(found.has(code), code)
  assert.equal(runChecks(o, T, ['far_stop', 'same_spot']).some(f => ['far_stop', 'same_spot'].includes(f.code)), false, 'a rule can be switched off')
  assert.equal(runChecks(o, T)[0].tone, 'bad', 'red findings come first')
  assert.equal(new Set(ROUTE_CHECKS.map(c => c.id)).size, ROUTE_CHECKS.length)
})

// ------------------------------------------------------------------ the location engine
const place = (id, bn, en, lat, lng, kind = 'village', over = {}) => ({ id, upazila_code: 1, kind, name: en, name_bn: bn, bn_checked: true, lat, lng, source: 'geonames', hidden: false, hidden_reason: null, note: null, ...over })
const hub = { name: 'Natore Sadar', lat: 24.4135, lng: 88.993 }
const env = (extra = {}) => ({ hub, hubs: [{ id: 'h1', code: '1', name: 'Natore Sadar', lat: 24.4135, lng: 88.993, staff: [] }],
  places: [place('p1', 'আমহাটি', 'Amhati', 24.4315, 89.0003), place('p2', 'কাজলা', 'Kajla', 24.364, 88.629), place('p3', 'কাজলা পাড়া', 'Kajla Para', 24.365, 88.63, 'para'), place('p4', 'লুকানো', 'Hidden', 24.4, 89, 'village', { hidden: true }),
    place('p5', 'বাজার', 'Bazar', 24.41, 88.99, 'market'), place('p6', 'লোকেশনহীন', 'Noloc', null, null)],
  routes: [route('r1', 'h1', 'Town', [stop('স্টেশন বাজার', 24.42, 89.0)])], lang: 'bn', ...extra })

test('names are compared the way people type them', () => {
  assert.equal(norm('  Natore   SADAR (হাব)  '), 'natore sadar হাব')
  assert.equal(nameScore('কাজলা', 'কাজলা'), 100)
  assert.ok(nameScore('কাজলা পাড়া', 'কাজলা') > nameScore('মূল কাজলা', 'কাজলা'), 'starts-with beats contains')
  assert.equal(nameScore('আমহাটি', 'পাবনা'), 0)
})
test('search finds a pasted point, library places, stops of other routes and hubs — without the network', () => {
  const e = env()
  assert.deepEqual(searchLocal('24.4, 89.0', e).map(c => c.source), ['coords'])
  const k = searchLocal('কাজলা', e)
  assert.deepEqual(k.map(c => c.name), ['কাজলা', 'কাজলা পাড়া'], 'exact first, hidden places never')
  assert.ok(k.every(c => c.source === 'library' && c.distM > 0))
  assert.equal(searchLocal('Amhati', e)[0].name, 'আমহাটি', 'English name finds the Bangla place')
  assert.deepEqual(searchLocal('স্টেশন', e).map(c => c.source), ['stops'])
  assert.deepEqual(searchLocal('স্টেশন', env({ routes: e.routes.map(r => ({ ...r, id: 'mine' })), skipRoute: 'mine' })), [], 'a route is not offered its own stops')
  assert.deepEqual(searchLocal('natore', e).map(c => c.source), ['hubs'])
  assert.deepEqual(searchLocal('x', e), [], 'one letter is not a search')
  assert.ok(searchLocal('লোকেশনহীন', e)[0].lat === null, 'a library place without a location is still offered (a name only)')
  assert.ok(LOCATION_SOURCES.filter(s => s.remote).length >= 1 && LOCATION_SOURCES.every(s => s.id && s.search))
})
test('the empty search box offers the places nearest the hub', () => {
  const list = nearHub(env(), 2)
  assert.equal(list.length, 2); assert.equal(list[0].name, 'বাজার'); assert.ok(list[0].distM <= list[1].distM)
})
test('a tapped point is named after the nearest library place', () => {
  const e = env()
  assert.equal(nameFromLibrary({ lat: 24.3641, lng: 88.6291 }, e.places, 'bn').name, 'কাজলা')
  assert.equal(nameFromLibrary({ lat: 24.0, lng: 88.0 }, e.places, 'bn'), null)
  assert.equal(nameFromLibrary({ lat: 24.3641, lng: 88.6291 }, e.places, 'en').name, 'Kajla')
})
test('after a stop is placed the person is told what is worth a look', () => {
  const ctx = { hub: { lat: 24.4135, lng: 88.993 }, stops: [stop('A', 24.42, 89.0)], others: [{ route: 'East', name: 'C', lat: 24.43, lng: 89.01 }] }
  assert.deepEqual(assess({ lat: 24.42, lng: 89.0003 }, ctx).map(n => n.code), ['same-route'])
  assert.deepEqual(assess({ lat: 24.4301, lng: 89.0101 }, ctx).map(n => n.code), ['other-route'])
  assert.deepEqual(assess({ lat: 24.9, lng: 89.5 }, ctx).map(n => n.code), ['far-hub'])
  assert.deepEqual(assess({ lat: 24.5, lng: 89.1 }, { ...ctx, accuracy: 300 }).map(n => n.code), ['rough-gps'])
  assert.deepEqual(assess({ lat: 24.5, lng: 89.1 }, ctx), [], 'a clear spot has nothing to say')
  assert.deepEqual(assess({ lat: 10, lng: 10 }, ctx).map(n => n.code), ['outside-bd'])
  assert.deepEqual(assess({ lat: null, lng: null }, ctx).map(n => n.code), ['no-location'])
  assert.deepEqual(assess({ lat: 24.42, lng: 89.0 }, { ...ctx, skipIndex: 0 }).map(n => n.code), [], 'the stop being moved is not compared with itself')
  for (const n of assess({ lat: 24.42, lng: 89.0003 }, ctx)) assert.ok(n.bn && n.en)
})
test('many at once: a pasted list or a sheet becomes stops; names without a location are matched from the library', async () => {
  const lines = parseBulkText('কাজলা, 24.364, 88.629\nআমহাটি\nবিনোদপুর, https://maps.google.com/?q=24.369,88.641\n\nঅজানা জায়গা')
  assert.deepEqual(lines.map(l => l.status), ['given', 'missing', 'given', 'missing'])
  assert.deepEqual([lines[2].lat, lines[2].lng], [24.369, 88.641])
  const r = await resolveBulk(lines, env(), { online: false })
  assert.equal(r[1].status, 'found'); assert.equal(r[1].from, 'library'); assert.equal(r[1].lat, 24.4315)
  assert.equal(r[3].status, 'missing')
  const stops = bulkToStops(r.map((l, i) => i === 0 ? { ...l, use: false } : l))
  assert.deepEqual(stops.map(s => s.name), ['আমহাটি', 'বিনোদপুর', 'অজানা জায়গা'])
  assert.equal(stops[2].lat, null, 'a stop without a location is still added, to be placed later')
  const many = await resolveBulk(parseBulkText('কাজলা'), env({ places: [...env().places, place('p9', 'কাজলা', 'Kajla2', 24.5, 88.7)] }), { online: false })
  assert.equal(many[0].status, 'many', 'two exact matches are left for the person to choose')
})
test('a sheet with headings is read by its headings; without headings column 1 is the name', () => {
  const head = parseBulkRows([['নাম', 'Lat', 'Lng', 'নোট'], ['কাজলা', '24.364', '88.629', 'x'], ['আমহাটি', '', '', '']])
  assert.deepEqual(head.map(l => [l.name, l.status]), [['কাজলা', 'given'], ['আমহাটি', 'missing']])
  const loc = parseBulkRows([['Stop', 'Location'], ['কাজলা', 'https://maps.google.com/?q=24.364,88.629']])
  assert.equal(loc[0].status, 'given')
  const plain = parseBulkRows([['কাজলা', '24.364, 88.629'], ['আমহাটি']])
  assert.deepEqual(plain.map(l => l.status), ['given', 'missing'])
  assert.deepEqual(parseBulkRows([['', ''], []]), [])
})
test('distance helper agrees with the parser (a point read back lands where it was typed)', () => {
  const p = parseLocation('24.3745, 88.6042')
  assert.ok(meters(p, { lat: 24.3745, lng: 88.6042 }) < 1)
})
