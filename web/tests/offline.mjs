import { moduleRegistry } from '../src/lib/moduleRelease.ts'
// Offline check-in, in a real browser with the internet switched off: the built site opens from the saved copy, a check-in is kept on the phone with its time,
// and it is sent (with that time) when the internet is back. The database is faked. Needs the built site:  npm run build && npm run test:offline
// CHROME=/path/to/chrome uses a browser already on the machine. (The ordinary smoke test blocks service workers; this one needs them.)
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const PORT = 4180, BASE = `http://localhost:${PORT}`
const KEY = 'sb-ndgnhvbpmtxrpplgsslz-auth-token'
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u9', role: 'authenticated', exp: 4102444800, email: 'rider@example.com' })}.sig`
const user = { id: 'u9', email: 'rider@example.com', user_metadata: { full_name: 'Test Rider' }, app_metadata: {}, aud: 'authenticated', role: 'authenticated' }
const session = (over = {}) => ({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user, ...over })

let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 150)) } return false }

const stops = [['কাজলা', 24.3640, 88.6290], ['বিনোদপুর', 24.3690, 88.6410], ['তালাইমারী', 24.3720, 88.6150]]
  .map(([name, lat, lng], i) => ({ id: `st${i + 1}`, seq: i + 1, name, kind: 'area', lat, lng, radius_m: null, minutes: null, note: null }))
const route = { id: 'rt1', hub_id: 'h1', zone_id: 'z1', code: 'R01', name: 'শহর পূর্ব', note: null, color: '#2563EB', shift: 'day', distance_km: 3.4, road_km: null, road_minutes: null, road_path: null,
  stops_gps: 3, updated_at: '2026-11-19T00:00:00Z', stops, riders: [{ employee_id: 'e01', code: '1001', name: 'Test Rider', mobile: null, from: '2026-11-01' }],
  hub: { name: 'Natore Sadar', lat: 24.3745, lng: 88.6042 }, rules: { max_stops: 40, max_riders: 4, max_routes_per_rider: 2, stop_radius_m: 150, speed_kmh: 18, stop_minutes: 4, start_time: '10:00', gps_required: false, checkin_open: true },
  can_checkin: true, visits: [] }

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const stopServer = () => { try { server.kill() } catch { /* already gone */ } }
process.on('exit', stopServer)
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)) }

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, permissions: ['geolocation'], geolocation: { latitude: 24.3641, longitude: 88.6291, accuracy: 10 }, serviceWorkers: 'allow' })
  // the stored login is written once (the page may rewrite it later, e.g. after a refresh)
  await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, s) }, [KEY, JSON.stringify(session())])
  const calls = []
  let checkinMode = 'ok'
  // with the internet off, the fake database must fail like the real one (Playwright answers routed requests even when the browser is set offline)
  let down = false
  const offline = async v => { down = v; await ctx.setOffline(v) }
  await ctx.route(/fonts\.(googleapis|gstatic)|tile\.openstreetmap\.org|nominatim|router\.project-osrm/, r => r.abort())
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    const j = (d, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/0' }, body: JSON.stringify(d) })
    if (down) return r.abort('internetdisconnected')
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors })
    if (u.includes('/auth/v1/user')) return j(user)
    if (u.includes('/auth/v1/token')) { calls.push({ fn: 'token' }); return j(session({ access_token: jwt })) }
    if (u.includes('rpc/module_release_snapshot')) return j(Object.fromEntries(Object.keys(moduleRegistry).map(id => [id, { allowed: true, order: null }])))
    if (u.includes('rpc/my_permissions')) return j([{ permission_code: 'hr.attendance.self', scope_type: 'global', zone_id: null, hub_id: null, is_super: false }])
    if (u.includes('rpc/my_menu')) return j(null)
    if (u.includes('rpc/my_employee_id')) return j('e01')
    if (u.includes('rpc/my_route_today')) return j({ date: '2026-11-27', routes: [route] })
    if (u.includes('rpc/route_checkin')) {
      calls.push({ fn: 'route_checkin', ...req.postDataJSON() })
      if (checkinMode === 'closed') return j({ code: 'P0001', message: 'Route check-in is switched off for this zone.', details: null, hint: null }, 400)
      return j({ near: true, distance_m: 18, radius_m: 150 })
    }
    if (u.includes('/rest/v1/profiles')) return j([{ must_change_password: false }])
    if (u.includes('/rest/v1/employees')) return j([{ id: 'e01', full_name: 'Test Rider', employee_code: '1001', hub_id: 'h1', status: 'active', mobile: '01711000001' }])
    if (u.includes('/rest/v1/rider_routes')) return j([{ hub_routes: { name: 'শহর পূর্ব', areas: ['কাজলা', 'বিনোদপুর'] } }])
    if (u.includes('/rest/v1/rpc/')) return j(null)   // any other database function: nothing
    if (u.includes('/rest/v1/')) return j([])           // any other table: no rows
    return j({})
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  if (process.env.DEBUG) page.on('console', async m => { if (m.type() === 'error' && /Range/.test(m.text())) console.log('CONSOLE', (await Promise.all(m.args().map(x => x.evaluate(v => (v && v.stack) || String(v)).catch(() => '')))).join(' | ').slice(0, 900)) })
  const card = () => page.locator('.sp-box:has(span.cnt)')
  const text = async () => (await page.locator('main').innerText().catch(() => ''))
  const queued = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('xzm_checkins_u9') || 'null') } catch { return null } })

  // --- online: the app loads and the service worker keeps it
  await page.goto(`${BASE}/app/staff`)
  check(await until(async () => (await card().count()) > 0 && (await card().innerText()).includes('এখানে পৌঁছেছি')), 'online: the staff page shows the route and the "I\'m here" button')
  if (process.env.DEBUG) { console.log('URL', page.url()); console.log((await text()).slice(0, 1500)); console.log(JSON.stringify(calls.slice(-5))); console.log(errors) }
  const expected = JSON.parse(await (await fetch(`${BASE}/precache.json`)).text()).files.length
  const ready = await until(async () => page.evaluate(async n => {
    const reg = await navigator.serviceWorker.getRegistration()
    const c = await caches.open('xzm-assets-v1')
    return !!reg?.active && !!navigator.serviceWorker.controller && (await c.keys()).length >= n
  }, expected), 60000)
  check(ready, `the service worker is active and has kept all ${expected} files of the app`)
  check(await page.evaluate(async () => !!(await (await caches.open('xzm-shell-v1')).match('/index.html'))), 'the page shell is kept')
  check(await page.evaluate(() => !!localStorage.getItem('xzm_myroute_u9') && !!localStorage.getItem('xzm_auth_u9')), 'the route and the permissions are kept on the phone')

  // --- the internet goes: the app still opens, from the saved copy
  await offline(true)
  await page.reload()
  check(await until(async () => (await card().count()) > 0 && (await text()).includes('সর্বশেষ সেভ করা রুট')), 'offline reload: the app opens and shows the last saved route')
  check(!/\/staff\/login/.test(page.url()), 'offline reload: not thrown to the login page')
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/offline-route.png` : '/dev/null' }).catch(() => undefined)

  // --- check in with no internet
  await page.getByRole('button', { name: /এখানে পৌঁছেছি/ }).click()
  check(await until(async () => (await text()).includes('ফোনে সেভ হয়েছে')), 'offline: "I\'m here" says the check-in is saved on the phone')
  const q = await queued()
  check(q?.items?.length === 1 && q.items[0].stop === 'st1' && Math.abs(Date.now() - Date.parse(q.items[0].at)) < 60000, 'offline: the check-in is kept with the time it was taken')
  check((await text()).includes('১টা চেক-ইন ফোনে সেভ আছে') && (await card().innerText()).includes('পাঠানো বাকি'), 'offline: the screen counts it and marks the stop "not sent yet"')
  check((await card().innerText()).includes('বিনোদপুর') && (await page.locator('.sp-box:has-text("পরের স্টপ")').innerText()).includes('বিনোদপুর'), 'offline: the next stop moves on')
  check(calls.filter(c => c.fn === 'route_checkin').length === 0, 'offline: nothing was sent')
  const keptAt = q.items[0].at

  // --- a cold start with an access token that has run out, still with no internet
  await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); s.expires_at = 1000; localStorage.setItem(k, JSON.stringify(s)) }, KEY)
  await page.reload()
  check(await until(async () => (await card().count()) > 0 && (await text()).includes('সর্বশেষ সেভ করা রুট'), 30000), 'offline, login expired: the app still opens with the saved route')
  if (process.env.DEBUG) { console.log('URL2', page.url()); console.log((await text()).slice(0, 600)); console.log(await page.evaluate(k => localStorage.getItem(k), 'sb-ndgnhvbpmtxrpplgsslz-auth-token').then(x => (x || '').slice(0, 120))) }
  check(!/\/staff\/login/.test(page.url()), 'offline, login expired: not thrown to the login page')
  check(((await queued())?.items?.length ?? 0) === 1, 'the check-in is still on the phone after the restart')

  // --- the internet is back: it is sent with the time it was taken
  await offline(false)
  check(await until(async () => calls.some(c => c.fn === 'route_checkin'), 30000), 'online again: the saved check-in is sent by itself')
  const sent = calls.find(c => c.fn === 'route_checkin')
  check(sent?.p_stop === 'st1' && sent?.p_at === keptAt && Math.abs(sent.p_lat - 24.3641) < 0.001, 'it carries the stop, the place and the time the phone took it')
  check(await until(async () => ((await queued())?.items?.length ?? 0) === 0), 'it is removed from the phone once sent')
  check(await until(async () => !(await text()).includes('ফোনে সেভ আছে')), 'the "saved on the phone" notice goes away')

  // --- a check-in the server refuses is reported, not retried for ever
  checkinMode = 'closed'
  await offline(true)
  await page.getByRole('button', { name: /এখানে পৌঁছেছি|পৌঁছেছি/ }).first().click()
  check(await until(async () => ((await queued())?.items?.length ?? 0) === 1), 'a second check-in is kept offline')
  const before = calls.filter(c => c.fn === 'route_checkin').length
  await offline(false)
  check(await until(async () => calls.filter(c => c.fn === 'route_checkin').length > before, 30000), 'online: the second one is sent')
  check(await until(async () => (await text()).includes('এই চেক-ইনগুলো নেওয়া যায়নি')) && (await text()).includes('চেক-ইন বন্ধ'), 'a refused check-in is shown with the reason (check-in switched off)')
  check(((await queued())?.items?.length ?? 0) === 0, 'and is not kept to be sent again')
  await page.getByRole('button', { name: 'ঠিক আছে' }).click()
  check(!(await text()).includes('এই চেক-ইনগুলো নেওয়া যায়নি'), '"OK" clears that notice')

  check(errors.length === 0, `no script errors${errors.length ? ': ' + errors[0] : ''}`)
} finally { await browser.close(); stopServer() }
console.log(failed ? `\n${failed} check(s) failed` : '\nAll offline checks passed')
process.exit(failed ? 1 : 0)
