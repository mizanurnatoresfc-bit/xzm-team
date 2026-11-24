// Tests of the one navigation access rule (src/lib/navAccess.ts + navTabs.ts): Staff, Manager and Zonal manager.
// The sidebar, the phone tabs, the quick actions and the page routes must agree. Run:  npm run test:nav
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAGE_PERMISSION_PATHS, hasPageAccess, linkAllowed, pageLinkAllowed, pageNeeds, pageState, panelLevel, tabActive } from '../src/lib/navAccess.ts'
import { QUICK, TABS, VIEW_TABS, tabsFor } from '../src/lib/navTabs.ts'

const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
const canOf = (...p) => x => p.includes(x)

// The people we check. Grants are those a real role of that kind holds (a few are enough to tell the three levels apart).
const ROLES = {
  staff: canOf('hr.attendance.self', 'da.sheet.create'),
  rider: canOf('ops.pickup_as_rider.create'),
  pickupEmployeeOnly: canOf('ops.pickup.view', 'hr.employee.view'),
  attendanceCreateOnly: canOf('hr.attendance.create', 'hr.employee.view'),
  hubManager: canOf('hr.employee.view', 'hr.attendance.view', 'hr.attendance.create', 'org.hub.view', 'da.sheet.view', 'da.sheet.create', 'hr.request.create',
    'ops.pickup.view', 'ops.pickup_as_hub_manager.create', 'zonal.task.create', 'hr.application.create'),
  zonalManager: canOf('zonal.dashboard.view', 'hr.attendance.view', 'hr.employee.view', 'org.hub.view', 'nodi.assistant.view', 'hr.request.approve', 'da.sheet.view',
    'da.report.view', 'zonal.hub_ops.view', 'sorting.parcel.view'),
}
const acc = (role, menu = null, extra = {}) => ({ can: ROLES[role], menu, ...extra })
const tabsOf = (role, view, menu = null) => tabsFor(view, panelLevel(ROLES[role])).filter(t => linkAllowed(t.to, acc(role, menu), t.perms))
const quickOf = (role, menu = null) => QUICK.filter(x => linkAllowed(x.to, acc(role, menu), x.perms, x.also))
const hrefs = list => list.map(x => x.to)

test('panel level: staff, manager, zonal manager', () => {
  assert.equal(panelLevel(ROLES.staff), 0)
  assert.equal(panelLevel(ROLES.rider), 0)
  assert.equal(panelLevel(ROLES.hubManager), 1)
  assert.equal(panelLevel(ROLES.zonalManager), 2)
})

test('Hub tab and attendance quick action follow the hub-part grants', () => {
  const hubTab = r => hrefs(tabsOf(r, null)).includes('/app/attendance?view=hub')
  assert.equal(hubTab('staff'), false)
  assert.equal(hubTab('rider'), false)
  assert.equal(hubTab('pickupEmployeeOnly'), false, 'pickup + employee grants alone: no tab that leads nowhere')
  assert.equal(hubTab('attendanceCreateOnly'), false, 'create alone does not open the hub part')
  assert.equal(hubTab('hubManager'), true)
  assert.equal(hubTab('zonalManager'), true)
  const att = r => hrefs(quickOf(r)).includes('/app/attendance?view=hub')
  assert.equal(att('attendanceCreateOnly'), false, 'the quick action would land on the own page, so it is not offered')
  assert.equal(att('hubManager'), true)
  assert.equal(att('staff'), false)
})

test('every link shown opens: tabs and quick actions of every role lead to a page the route lets in', () => {
  for (const role of Object.keys(ROLES)) {
    const a = acc(role)
    for (const view of [null, 'self', 'hub', 'zone']) for (const t of tabsOf(role, view)) {
      assert.equal(pageState(t.to, a), 'open', `${role}/${view}: tab ${t.to}`)
    }
    for (const x of quickOf(role)) assert.equal(pageState(x.to, a), 'open', `${role}: quick ${x.to}`)
  }
})

test('a role with a page list: a link is shown only when the list names it, and then it opens', () => {
  const menu = ['/app/staff/list', '/app/attendance', '/app/accounts/daily']
  for (const role of ['hubManager', 'zonalManager']) {
    const a = acc(role, menu)
    for (const t of tabsOf(role, 'hub', menu)) assert.equal(pageState(t.to, a), 'open', `${role}: tab ${t.to}`)
    for (const x of quickOf(role, menu)) assert.equal(pageState(x.to, a), 'open', `${role}: quick ${x.to}`)
  }
  assert.deepEqual(hrefs(tabsOf('hubManager', 'hub', ['/app/staff/list'])).filter(t => t.startsWith('/app/accounts')), [], 'accounts is not on the list')
  assert.equal(hrefs(tabsOf('hubManager', 'hub', ['/app/staff/list'])).includes('/app/staff/list'), true)
  // a list saved before attendance was one page names the old hub / zone page
  assert.equal(hrefs(tabsOf('hubManager', 'hub', ['/app/workforce/hub'])).includes('/app/attendance?view=hub'), true)
})

test('the page list could not be loaded: nothing is linked and only the password page opens', () => {
  const a = { ...acc('hubManager'), menuUnavailable: true }
  assert.equal(linkAllowed('/app', a), false)
  assert.equal(linkAllowed('/app/staff/list', a), false)
  assert.equal(pageState('/app/staff/list', a), 'menu-unavailable')
  assert.equal(pageState('/app/me', a), 'menu-unavailable')
  assert.equal(pageState('/app/password', a), 'open')
})

test('zonal-only pages: Training and Nodi AI chat', () => {
  for (const role of ['staff', 'hubManager']) assert.equal(pageState('/app/training', acc(role)), 'no-permission', role)
  assert.equal(pageState('/app/training', acc('zonalManager')), 'open')
  assert.equal(pageState('/app/nodi/chat', acc('hubManager')), 'no-permission')
  assert.equal(pageState('/app/nodi/chat', acc('zonalManager')), 'open')
})

test('direct routes follow the same table as the menus (formerly separate route wrappers)', () => {
  const z = acc('zonalManager'), s = acc('staff'), h = acc('hubManager')
  assert.equal(pageState('/app/zonal/requests', z), 'open')
  assert.equal(pageState('/app/zonal/requests', h), 'no-permission')
  assert.equal(pageState('/app/zonal/hr-records', s), 'no-permission')
  assert.equal(pageState('/app/accounts/reports', z), 'open')
  assert.equal(pageState('/app/accounts/reports', s), 'no-permission')
  assert.equal(pageState('/app/users', s), 'no-permission')
  assert.equal(pageState('/app/users/abc', s), 'no-permission', 'sub-pages need what the page needs')
  assert.equal(pageState('/app/access/role/abc', s), 'no-permission')
  assert.equal(pageState('/app/hub/pickup', acc('rider')), 'open')
  assert.equal(pageState('/app/hub/pickup', acc('staff')), 'no-permission')
  assert.equal(pageState('/app/hub/logins', h), 'no-permission')
  assert.equal(pageState('/app/zonal/assistant', s), 'open', 'a page with no entry in the table needs no grant beyond the page list')
})

test('every staff / manager / zonal view stays inside the existing modules: old addresses are redirects, not pages', () => {
  const app = src('App.tsx')
  for (const old of ['/app/workforce/hub', '/app/workforce/zone', '/app/workforce/attendance', '/app/hub/attendance', '/app/hub/late', '/app/hub/days', '/app/hr/attendance'])
    assert.match(app, new RegExp(`path="${old}" element=\\{<(Navigate|LegacyAttendanceRedirect|RedirectKeep)`), old)
  for (const old of ['/app/hub/team', '/app/hr/employees', '/app/zonal/staff', '/app/manager/staff', '/manager/staff'])
    assert.match(app, new RegExp(`path="${old}" element=\\{<RedirectKeep to="/app/staff/list"`), old)
  // no second attendance page and no second staff page
  for (const f of ['pages/workforce/WorkforceHub.tsx', 'pages/workforce/WorkforceZone.tsx', 'pages/hub/AttendanceDays.tsx', 'pages/hub/HubTeam.tsx'])
    assert.throws(() => src(f), /ENOENT/, `${f} must not come back`)
  assert.equal((app.match(/<AttendancePage \/>/g) ?? []).length, 1)
  assert.equal((app.match(/<StaffList \/>/g) ?? []).length, 1)
  // an old address a staff member's notification may hold lands on the one page and is never blocked
  for (const role of ['staff', 'hubManager', 'zonalManager']) for (const p of ['/app/attendance', '/app/workforce/hub', '/app/workforce/zone', '/app/hub/attendance'])
    assert.equal(pageState(p, acc(role)), 'open', `${role} ${p}`)
})

test('every address in the permission table is a real route (no typos)', () => {
  const routes = [...src('App.tsx').matchAll(/<Route path="([^"]+)"/g)].map(m => m[1])
  const toRe = p => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*') + '$')
  for (const p of PAGE_PERMISSION_PATHS) {
    if (p.startsWith('/app/hub/')) { assert.ok(routes.includes('/app/hub/:section'), p); continue }
    assert.ok(routes.some(r => toRe(r).test(p)), `${p} has an entry in the table but no route`)
  }
})

test('menu rows, tabs and quick actions ask for the same grants as the page they open', () => {
  // the sidebar's rows are written in AppShell.tsx: every row whose page has an entry in the table must name the same grants
  const shell = src('components/AppShell.tsx').replace(/hint: \{[^}]*\},?\s*/g, '')
  const rows = [...shell.matchAll(/\{ to: '([^']+)'[^\n]*?perms: (\[[^\]]*\])/g)].map(m => ({ to: m[1], perms: m[2] }))
  assert.ok(rows.length > 20)
  const bad = []
  for (const r of rows) {
    const need = pageNeeds(r.to); if (!need) continue
    const perms = [...r.perms.matchAll(/'([^']+)'/g)].map(m => m[1])
    if (r.perms.includes('...')) continue
    if (perms.length && !perms.every(p => need.includes(p))) bad.push(`${r.to}: row ${perms} / page ${need}`)
  }
  assert.deepEqual(bad, [])
  for (const x of QUICK) { const need = pageNeeds(x.to); if (need && x.perms) assert.ok(x.perms.every(p => need.includes(p)) || x.also, `${x.to} quick action`) }
})

test('phone tabs: the right tab is on for nested pages and deep links; never two', () => {
  const on = (tabs, path, search = '') => tabs.filter(t => tabActive(t, path, search)).map(t => t.bn)
  const hub = tabsFor('hub', 1), zone = tabsFor('zone', 2), self = tabsFor('self', 0), plain = tabsFor(null, 2)
  const cases = [
    [hub, '/app', 'হোম'], [hub, '/app/attendance', 'হাব'], [hub, '/app/attendance', 'হাব', '?view=hub&tab=final&date=2026-11-20'], [hub, '/app/hub/pickup', 'হাব'],
    [hub, '/app/staff/list', 'টিম'], [hub, '/app/hr/employees/e01', 'টিম'], [hub, '/app/hr/applications', 'টিম'],
    [hub, '/app/accounts/daily', 'হিসাব'], [hub, '/app/accounts/daily/s1/main', 'হিসাব'], [hub, '/app/accounts/center', 'হিসাব'], [hub, '/app/accounts/khata', 'হিসাব'],
    [hub, '/app/hr/requests', 'রিকুয়েস্ট'], [hub, '/app/hr/leave', 'রিকুয়েস্ট'], [hub, '/app/manpower', 'রিকুয়েস্ট'],
    [zone, '/app/hr/employees/e01', 'কর্মী'], [zone, '/app/sorting/parcels', 'ট্রিপ'], [zone, '/app/sorting/fuel', 'ট্রিপ'], [zone, '/app/accounts/reports', 'হিসাব'], [zone, '/app/attendance', 'হাব'],
    [plain, '/app/hr/employees/e01', 'কর্মী'],
    [self, '/app', 'হোম'], [self, '/app/staff', 'হোম'], [self, '/app/me', 'প্রোফাইল'], [self, '/app/me/complete', 'প্রোফাইল'], [self, '/app/accounts/mine', 'হিসাব'], [self, '/app/hr/requests', 'রিকুয়েস্ট'],
  ]
  for (const [tabs, path, bn, search] of cases) assert.deepEqual(on(tabs, path, search), [bn], `${path}${search ?? ''}`)
  // pages that no tab owns light none (never a wrong one)
  for (const path of ['/app/notifications', '/app/settings', '/app/training', '/app/zonal']) for (const tabs of [hub, zone, self]) assert.deepEqual(on(tabs, path), [], path)
  // "/app/staffx" is not the panel (segment match, not a prefix of letters)
  assert.deepEqual(on(self, '/app/staffx'), [])
  // a tab can be limited to one view of its page
  assert.equal(tabActive({ match: '/app/attendance', ifQuery: { view: 'hub' } }, '/app/attendance', '?view=hub'), true)
  assert.equal(tabActive({ match: '/app/attendance', ifQuery: { view: 'hub' } }, '/app/attendance', '?view=me'), false)
})

test('every tab leads to a page of its own tab (the link itself lights its tab)', () => {
  for (const [name, tabs] of [['zone', TABS], ...Object.entries(VIEW_TABS), ['staff', tabsFor('self', 0)]]) for (const t of tabs) {
    const [path, q] = t.to.split('?')
    assert.equal(tabActive(t, path, q ? '?' + q : ''), true, `${name}: ${t.to}`)
  }
})

test('hasPageAccess and pageLinkAllowed agree for a page under a listed page (report upload under accounts)', () => {
  const a = acc('zonalManager', ['/app/accounts/daily'])
  assert.equal(pageLinkAllowed('/app/accounts/report-import', a), true)
  assert.equal(pageLinkAllowed('/app/accounts/report-import', acc('staff', ['/app/accounts/daily'])), false, 'needs da.import.create or da.sheet.view')
  assert.equal(hasPageAccess('/app/accounts/report-import', ROLES.zonalManager), true)
})

test('every menu row, tab and quick action opens a real page, not a redirect or a missing route', () => {
  const app = src('App.tsx')
  const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{(.*)\} \/>/g)].map(m => ({ path: m[1], el: m[2] }))
  const re = p => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*') + '$')
  const rank = r => (r.path.match(/:|\*/g) ?? []).length
  const find = to => routes.filter(r => re(r.path).test(to)).sort((a, b) => rank(a) - rank(b))[0]
  const shell = src('components/AppShell.tsx')
  const targets = new Set([...shell.matchAll(/\{ to: '([^']+)'/g)].map(m => m[1]))
  for (const t of [...TABS, ...Object.values(VIEW_TABS).flat()]) targets.add(t.to)
  for (const q of QUICK) targets.add(q.to)
  assert.ok(targets.size > 60)
  const bad = []
  for (const to of targets) {
    const path = to.split('?')[0], r = find(path)
    if (!r) bad.push(`${to}: no route`)
    else if (/<Navigate|Redirect/.test(r.el)) bad.push(`${to}: is only a redirect (${r.el.slice(0, 50)})`)
  }
  assert.deepEqual(bad, [])
})

test('old addresses keep their query and hash when they redirect', () => {
  const app = src('App.tsx')
  assert.match(app, /function RedirectKeep[\s\S]*search[\s\S]*hash/)
  assert.match(app, /function LegacyAttendanceRedirect[\s\S]*useLocation\(\)\.search/)
  // a bare <Navigate to="/app/staff/list"> or "/app/attendance?view=hub" would drop ?tab=pending, ?hub=, ?date= …
  assert.doesNotMatch(app, /<Navigate to="\/app\/staff\/list"/)
  assert.doesNotMatch(app, /<Navigate to="\/app\/attendance\?view=hub"/)
})
