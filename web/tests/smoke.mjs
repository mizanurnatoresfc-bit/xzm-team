import { readFileSync } from 'node:fs'
// Smoke test: opens the built site in a real browser at PC and phone size, with the
// database answers faked, and checks the screens that every change must keep working.
// Run:  npm run build && npm run test:smoke      (CI runs it before the site is published)
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const PORT = 4179, BASE = `http://localhost:${PORT}`
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp: 4102444800, email: 'owner@example.com' })}.sig`
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
  user: { id: 'u1', email: 'owner@example.com', user_metadata: { full_name: 'Owner' }, app_metadata: {}, aud: 'authenticated', role: 'authenticated' } }
const roles = [
  { id: 'r1', code: 'super_admin', name: 'Super Admin', name_bn: null, is_system: true, is_super: true, status: 'active', archived_at: null, permission_count: 0, user_count: 1, permissions: [] },
  { id: 'r3', code: 'rider', name: 'Rider', name_bn: null, is_system: true, is_super: false, status: 'active', archived_at: null, permission_count: 9, user_count: 0, permissions: ['org.hub.view'] },
  { id: 'r2', code: 'hub_manager', name: 'Hub Manager', name_bn: null, is_system: true, is_super: false, status: 'active', archived_at: null, permission_count: 3, user_count: 4, permissions: ['hr.attendance.view', 'hr.attendance.create', 'hr.employee.view'] },
]
const register = Array.from({ length: 60 }, (_, i) => ({ source: i % 2 ? 'system' : 'request', kind: i % 3 ? 'transfer' : 'status', event_date: '2026-11-10', employee_id: `e${i}`,
  employee_code: String(1000 + i), full_name: `Staff ${String(i).padStart(2, '0')}`, mobile: '01700000000', position_name: i % 2 ? 'Rider' : 'Sorter', from_hub: i % 4 ? 'Natore' : 'Pabna',
  to_hub: 'Bogura', from_status: 'active', to_status: 'inactive', reason: 'test', request_no: i % 2 ? null : `R-${i}`, request_status: 'done', reference: null, done_by: 'Owner', recorded_at: `2026-11-10T00:00:${String(i).padStart(2, '0')}Z` }))

const hubNames = ['Natore Sadar', 'Lalpur', 'Singra', 'Boraigram', 'Gurudaspur', 'Bagatipara', 'Naldanga', 'Pabna', 'Bogura', 'Rajshahi']
const hubRows = hubNames.map((name, i) => ({ id: `h${i + 1}`, name, code: String(80 + i), zone_id: 'z1', archived_at: null }))
const staffRows = Array.from({ length: 12 }, (_, i) => ({ id: `e${String(i).padStart(2, '0')}`, employee_code: String(1000 + i), full_name: `Staff ${String(i).padStart(2, '0')}`,
  hub_id: 'h2', position_id: 'p1', mobile: `017110000${String(i).padStart(2, '0')}`, status: 'active' }))

// Advanced role & permission pages: the permissions the fake roles above use, a few accounts, and a little audit history
const permRows = [['org.hub.view', 'View hubs'], ['hr.attendance.view', 'View attendance'], ['hr.attendance.create', 'Record attendance'], ['hr.attendance.edit', 'Correct attendance'],
  ['hr.employee.view', 'View employees in scope'], ['hr.employee.edit', 'Edit employee details'], ['hr.leave.view', 'View leave requests'], ['hr.leave.approve', 'Approve leave'], ['hr.leave.reject', 'Reject leave'],
  ['da.sheet.view', 'View daily account sheets'], ['da.sheet.create', 'Fill in daily account sheets'], ['da.report.view', 'View reports'], ['da.report.export', 'Export reports'],
  ['system.role.view', 'View roles'], ['system.role.edit', 'Edit roles'], ['system.audit.view', 'View audit log']]
  .map(([code, description], i) => { const [module, resource, action] = code.split('.'); return { id: `p${i + 1}`, code, module, resource, action, description } })
const grant = (id, role, scope, zone, hub) => ({ id, role_id: role.id, code: role.code, name: role.name, name_bn: role.name_bn, is_super: role.is_super, scope_type: scope,
  zone_id: zone, hub_id: hub, zone: zone ? 'Natore Area' : null, hub: hub ? hubNames[Number(hub.slice(1)) - 1] : null, valid_from: '2026-11-01', valid_to: null })
const account = (id, full_name, email, grants) => ({ id, full_name, email, phone: null, status: 'active', archived_at: null, locked: false, locked_until: null, failed_login_count: 0, last_login_at: null,
  must_change_password: false, created_at: '2026-11-01T00:00:00Z', employee_id: null, employee_code: null, roles: grants, can_manage: id !== 'u1' })
const accounts4 = [account('u1', 'Owner', 'owner@example.com', [grant('a1', roles[0], 'global', null, null)]),
  account('u2', 'Sohel Sardar', 'sohel@example.com', [grant('a2', roles[2], 'hub', null, 'h1')]),
  account('u3', 'Zonal Karim', 'karim@example.com', [grant('a3', roles[2], 'zone', 'z1', null)]),
  account('u4', 'New Joiner', 'new@example.com', [])]
const auditRows = [
  { id: 9, occurred_at: '2026-11-16T10:00:00Z', actor_id: 'u1', action: 'INSERT', table_name: 'role_permissions', record_id: null, old_data: null, new_data: { role_id: 'r2', permission_id: 'p8' }, changed_fields: null, reason: 'Role permissions set by Super Admin' },
  { id: 8, occurred_at: '2026-11-16T10:00:00Z', actor_id: 'u1', action: 'DELETE', table_name: 'role_permissions', record_id: null, old_data: { role_id: 'r2', permission_id: 'p4' }, new_data: null, changed_fields: null, reason: 'Role permissions set by Super Admin' },
  { id: 7, occurred_at: '2026-11-15T09:00:00Z', actor_id: 'u1', action: 'INSERT', table_name: 'user_roles', record_id: 'a2', old_data: null, new_data: { id: 'a2', user_id: 'u2', role_id: 'r2', scope_type: 'hub', zone_id: null, hub_id: 'h1' }, changed_fields: null, reason: null }]
const ownRows = [{ id: 'o1', user_id: 'u2', user_name: 'Sohel Sardar', permission: 'da.report.export', effect: 'grant', scope_type: 'hub', zone_id: null, hub_id: 'h2', zone: null, hub: 'Lalpur',
  valid_from: '2026-11-10', valid_to: '2099-12-31', reason: 'রিপোর্ট দেখবেন', created_at: '2026-11-10T05:00:00Z', created_by_name: 'Owner', revoked_at: null, revoke_reason: null, live: true }]

// Office & Residential: kept apart by kind, nothing else
const dhakaToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const inDays = d => new Date(Date.parse(dhakaToday + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10)
const place = (id, name, kind, more) => ({ id, code: id.toUpperCase(), name, kind, zone_id: 'z1', hub_id: 'h1', sorting_center_id: null, address: 'Natore', floor_note: null,
  owner_name: 'Landlord', owner_phone: '01700000000', rent: null, front_direction: null, note: null, status: 'active', advance: null, contract_from: null, contract_to: null,
  contract_file: null, rent_due_day: null, meter_no: null, unit_rate: null, wifi_provider: null, wifi_bill: null, capacity: null, archived_at: null, ...more })
const officePlaces = [place('of1', 'Natore Hub Office', 'office', {}),
  place('rs1', 'Staff Mess A', 'residence', { rent: 8000, rent_due_day: 1, capacity: 2, contract_from: inDays(-345), contract_to: inDays(20) }),
  place('rs2', 'Staff Mess B', 'residence', { rent: 6000, rent_due_day: 1, capacity: 4, contract_from: inDays(-30), contract_to: inDays(335) })]
const officeGone = place('rs9', 'Old Mess C', 'residence', { archived_at: '2026-11-01T00:00:00Z', archive_reason: 'ছেড়ে দেওয়া হয়েছে' })
const officePatches = [], officeLogs = []
const officeResidents =['e01', 'e02', 'e03'].map((e, i) => ({ id: `or${i}`, property_id: 'rs1', room_id: null, employee_id: e, since: '2026-10-01', note: null, archived_at: null }))
const officeBills = [{ id: 'ob1', property_id: 'rs2', kind: 'rent', bill_month: dhakaToday.slice(0, 8) + '01', amount: 6000, paid_on: dhakaToday, method: 'cash', txn_id: null, payee: null, payee_phone: null,
  units: null, has_memo: true, memo_file: null, memo_no: null, proof_file: null, da_expense_id: null, note: null, created_by_name: 'Owner', created_at: dhakaToday + 'T04:00:00Z', archived_at: null }]
officeBills.push({ ...officeBills[0], id: 'ob2', kind: 'water', amount: 350, has_memo: false, memo_no: 'OM-2611-00001' })
const asset = (id, kind, name, quantity, condition) => ({ id, property_id: 'of1', kind, name, room_id: null, desk_id: null, quantity, condition, brand: null, serial_no: null,
  holder_id: null, purchase_date: null, price: null, note: null, watt: null, hours_per_day: null, spec: null, archived_at: null })
const officeAssets = [asset('oa1', 'monitor', 'মনিটর', 2, 'good'), asset('oa2', 'pc', 'পিসি', 2, 'good'), asset('oa3', 'fan', 'ফ্যান', 3, 'broken')]

const fails = []
const check =(ok, what) => { if (!ok) fails.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const stop = () => { try { server.kill() } catch { /* already gone */ } }
process.on('exit', stop)
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)) }

const daSettings = JSON.parse(readFileSync(new URL('./fixtures/da_settings.json', import.meta.url), 'utf8'))
// CHROME=/path/to/chrome uses a browser already on the machine instead of Playwright's own download.
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
try {
  for (const [size, viewport] of [['pc', { width: 1366, height: 800 }], ['phone', { width: 390, height: 800 }]]) {
    // --- not signed in: every app page goes to the login screen
    const anon = await browser.newContext({ viewport })
    await anon.route(/supabase\.co|fonts\.(googleapis|gstatic)/, r => r.abort())
    const lp = await anon.newPage()
    await lp.goto(`${BASE}/app/hr/employees`); await lp.waitForURL(/\/staff\/login/, { timeout: 8000 }).catch(() => {})
    check(/\/staff\/login/.test(lp.url()), `${size}: signed-out visitor is sent to the login page`)
    // forgot password: an Employee ID gets told whom to ask; an email gets a link (the same answer whether or not it exists)
    const recover = []
    await anon.unroute(/supabase\.co|fonts\.(googleapis|gstatic)/)
    await anon.route(/fonts\.(googleapis|gstatic)/, r => r.abort())
    await anon.route(/supabase\.co/, r => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors })
      if (r.request().url().includes('/auth/v1/recover')) { recover.push({ url: r.request().url(), body: r.request().postDataJSON() }); return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' }) }
      return r.abort()
    })
    await lp.getByRole('button', { name: 'পাসওয়ার্ড ভুলে গেছেন?' }).click()
    await lp.locator('.lg-card input').fill('1001'); await lp.getByRole('button', { name: 'লিংক পাঠান' }).click()
    check((await lp.locator('.lg-card .da-error').innerText().catch(() => '')).includes('ম্যানেজার') && recover.length === 0, `${size}: forgot password with an Employee ID says whom to ask, and sends nothing`)
    await lp.locator('.lg-card input').fill('Owner@Example.com'); await lp.getByRole('button', { name: 'লিংক পাঠান' }).click()
    await lp.waitForSelector('.lg-card .notice', { timeout: 8000 }).catch(() => {})
    check(recover.at(-1)?.body?.email === 'owner@example.com' && decodeURIComponent(recover.at(-1)?.url ?? '').includes('/staff/login') && await lp.locator('.lg-card .notice').count() === 1, `${size}: forgot password sends a link to the email on the account`)
    if (process.env.SHOTS) await lp.screenshot({ path: `${process.env.SHOTS}/${size}-forgot.png` })
    await anon.close()

    // --- signed in as the Super Admin
    const ctx = await browser.newContext({ viewport })
    await ctx.addInitScript(s => { localStorage.setItem('sb-ndgnhvbpmtxrpplgsslz-auth-token', s) }, JSON.stringify(session))
    await ctx.route(/fonts\.(googleapis|gstatic)|cdn\.jsdelivr\.net|tile\.openstreetmap\.org|nominatim\.openstreetmap\.org|router\.project-osrm\.org/, r => r.abort())
    const nodiParts = { chat: true, teach: true, office: true, gaps: true, followup: true }
    let morningDone = false
    const created = [], accounts = [], mobiles = [], removed = [], recoded = [], exported = [], acted = [], posted = [], started = [], pwChanged = [], flowCalls = []
    let asEmployee = false, withGaps = false, mineOpen = false, menuNow = null, menuFail = false, plainStaff = false, permsNow = null, homePanels = ['my_work', 'quick_links'], ownInstalled = false, staffSecs = null
    const prospects = []
    const routePlaces = [['আমহাটি', 'Amhati', 24.4315, 89.0003], ['দিঘাপতিয়া', 'Dighapatia', 24.4400, 88.9800], ['ছাতনী', 'Chhatni', 24.4500, 88.9500], ['হালসা', 'Halsa', 24.3800, 89.0400],
      ['বড়হরিশপুর', 'Barahorishpur', 24.4000, 89.0300], ['তেবাড়িয়া', 'Tebaria', 24.4200, 88.9500], ['কাফুরিয়া', 'Kafuria', 24.3900, 88.9600], ['লক্ষীপুর', 'Laxmipur', 24.4600, 89.0200]]
      .map(([name_bn, name, lat, lng], i) => ({ id: `pl${i}`, upazila_code: 143, kind: i === 7 ? 'market' : 'village', name, name_bn, bn_checked: i % 2 === 0, lat, lng, source: 'geonames', hidden: false, hidden_reason: null, note: null }))
    let loadSaved = null
    const routeOverview = { zone: { id: 'z1', code: 'NT', name: 'Natore Area' },
      rules: { max_stops: 40, max_riders: 4, max_routes_per_rider: 2, stop_radius_m: 150, speed_kmh: 18, stop_minutes: 4, start_time: '10:00', gps_required: false, checkin_open: true, saved: false, updated_at: null },
      can: { configure: true, visits: true, edit_hubs: ['h1', 'h2'], archive_hubs: ['h1', 'h2'] },
      hubs: [{ id: 'h1', code: '80', name: 'Natore Sadar', lat: 24.4135, lng: 88.9930, staff: [{ id: 'e01', code: '1001', name: 'Staff 01', rider: true, routes: 1 }, { id: 'e02', code: '1002', name: 'Staff 02', rider: true, routes: 0 }] },
        { id: 'h2', code: '81', name: 'Lalpur', lat: null, lng: null, staff: [] }],
      routes: [{ id: 'rt1', hub_id: 'h1', zone_id: 'z1', code: 'R01', name: 'শহর পূর্ব', note: null, color: '#2563EB', shift: 'day', distance_km: 3.4, road_km: null, road_minutes: null, road_path: null, stops_gps: 2, updated_at: '2026-11-19T00:00:00Z',
        stops: [{ id: 'st1', seq: 1, name: 'কানাইখালী', kind: 'area', lat: 24.4102, lng: 88.9865, radius_m: null, minutes: null, note: null },
          { id: 'st2', seq: 2, name: 'আলাইপুর', kind: 'landmark', lat: 24.4180, lng: 88.9750, radius_m: 200, minutes: null, note: null },
          { id: 'st3', seq: 3, name: 'স্টেশন বাজার', kind: 'area', lat: null, lng: null, radius_m: null, minutes: null, note: null }],
        riders: [{ employee_id: 'e01', code: '1001', name: 'Staff 01', mobile: null, from: '2026-11-01' }] }],
      visits_today: { rt1: 2 } }
    const answered = [], checked = []
    const imported = []
    let sheetsOn = false
    const sc = (head, src, more = {}) => ({ head, src, ...more })
    const sheetRows = [
      { id: 'cs1', name: 'New Admin & Rider ID Creat Information', name_bn: 'নতুন আইডি তৈরির শিট', source: 'staff', kind: null, format_id: null, title: 'New Admin & Rider ID Creat Format', title_at: null, file_name: null, sort_order: 10, archived_at: null,
        columns: [sc('SL', 'sl'), sc('Name', 'emp:full_name'), sc('Phone Number', 'emp:mobile'), sc('Employee Picture', 'doc:photo'), sc('Basic', 'emp:basic_salary'), sc('Remarks', 'blank')] },
      { id: 'cs3', name: 'Transfer - 02 (with salary)', name_bn: 'আইডি বদলির শিট — বেতনসহ', source: 'requests', kind: 'id_transfer', format_id: null, title: 'Admin & Rider ID Create Information', title_at: [4, 7], file_name: 'Transfer - 02.xlsx', sort_order: 30, archived_at: null,
        columns: [sc('SL', 'sl'), sc('Name', 'emp:full_name|req:full_name'), sc('Phone Number', 'emp:mobile'), sc('ID', 'emp:employee_code|req:employee_code'), sc('Designation', 'emp:position_name|req:position'),
          sc('Old Hub', 'req.hub|req:from_hub'), sc('New Hub Name', 'req:to_hub'), sc('Date Of Birth', 'emp:date_of_birth'), sc('NID/ Birth Certificate Number', 'emp:nid_number'), sc('Transfer Raferance Name & ID', 'ref'),
          sc('Basic', 'emp:basic_salary', { group: 'Previous Salary System' }), sc('Fuyel/Phn Bill', 'emp:transport_allowance', { group: 'Previous Salary System' }), sc('Commision', 'emp:commission', { group: 'Previous Salary System' }),
          sc('Basic', 'req:new_basic|emp:basic_salary', { group: 'New Salary System' }), sc('Fuyel/Phn Bill', 'req:new_bill|emp:transport_allowance', { group: 'New Salary System' }), sc('Commision', 'req:new_commission|emp:commission', { group: 'New Salary System' }),
          sc('Transfer Reason/ Remarks', 'req:reason|req.note')] }]
    const rqf = (key, label, type = 'text', more = {}) => ({ key, label, type, ...more })
    const sheetFormats = [
      { id: 'f-transfer', code: 'ID_TRANSFER', kind: 'id_transfer', name: 'ID TRANSFER', name_bn: 'আইডি বদলি', description: null, needs_employee: true, self_service: false, sort_order: 20, archived_at: null,
        fields: [rqf('employee_code', 'আইডি', 'text', { prefill: 'employee_code' }), rqf('full_name', 'নাম', 'text', { prefill: 'full_name' }), rqf('from_hub', 'বর্তমান হাব', 'text', { prefill: 'hub' }), rqf('position', 'পদবি', 'text', { prefill: 'position' }),
          rqf('to_hub', 'নতুন হাব', 'hub', { required: true }), rqf('reason', 'কারণ', 'textarea', { required: true }), rqf('new_basic', 'নতুন বেসিক', 'number'), rqf('new_bill', 'নতুন বিল', 'number'), rqf('new_commission', 'নতুন কমিশন', 'number')] },
      { id: 'f-active', code: 'ID_ACTIVE', kind: 'id_active', name: 'ID ACTIVE', name_bn: 'আইডি চালু', description: null, needs_employee: true, self_service: true, sort_order: 30, archived_at: null,
        fields: [rqf('employee_code', 'আইডি', 'text', { prefill: 'employee_code' }), rqf('full_name', 'নাম', 'text', { prefill: 'full_name' }), rqf('reason', 'কারণ', 'textarea')] }]
    const rq = (id, no, emp, hub, status, data, more = {}) => ({ id, request_no: no, format_id: 'f-transfer', kind: 'id_transfer', employee_id: emp, zone_id: 'z1', hub_id: hub, data, note: null, status, submitted_by: 'u1',
      submitter_employee_id: null, decided_by: null, decided_at: null, decision_note: null, result: null, ref_employee_id: null, ref_name: null, ref_code: null, ref_hub: null, ref_position: null, created_at: `${dhakaToday}T05:0${no.slice(-1)}:00Z`, ...more })
    const sheetRequests = [
      rq('q2', 'HR-00002', 'e02', 'h4', 'processing', { employee_code: '5002', full_name: 'Karim Ali', from_hub: 'Boraigram', to_hub: 'h1', effective_date: '2026-11-22', reason: 'Punishment transfer', new_basic: '14000' }),
      rq('q1', 'HR-00001', 'e01', 'h4', 'submitted', { employee_code: '5001', full_name: 'Rahim Sheikh', from_hub: 'Boraigram', to_hub: 'h2', effective_date: '2026-11-20', reason: 'Lalpur service better' }, { ref_name: 'Zonal Karim', ref_code: '777' }),
      { ...rq('q3', 'HR-00003', 'e03', 'h1', 'submitted', { full_name: 'Someone Else' }), kind: 'id_active', format_id: 'f-active' }]
    await ctx.route(/supabase\.co/, r => {
      const u = r.request().url()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      const j = d => r.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/0' }, body: JSON.stringify(d) })
      // the staff member's own four numbers (a login with a staff profile gets an answer, nobody else gets null)
      if (/rpc\/wf_ops_mine(\?|$)/.test(u)) return j(asEmployee || permsNow?.includes('ops.pickup_as_rider.create') ? { today: '2026-11-25', backdate_days: 1, entry: null, recent: [], hint: null } : null)
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors })
      if (u.includes('/auth/v1/user')) return j(session.user)
      if (u.includes('/functions/v1/admin-users')) { const b = r.request().postDataJSON(); if (b?.action === 'change_password') { pwChanged.push(b); return j({ ok: true }) } }
      if (u.includes('rpc/my_permissions') && permsNow) return j(permsNow.map(c => ({ permission_code: c, scope_type: 'global', zone_id: null, hub_id: null, is_super: false })))
      if (u.includes('rpc/my_permissions')) return j(plainStaff ? [{ permission_code: 'hr.attendance.self', scope_type: 'global', zone_id: null, hub_id: null, is_super: false }]
        : [{ permission_code: '*', scope_type: 'global', zone_id: null, hub_id: null, is_super: true }])
      // কোম্পানি শিট: the company's own Excel layouts, two transfer requests waiting, and what the staff records say about those two people
      if (sheetsOn && u.includes('/rest/v1/company_sheets')) { if (r.request().method() === 'GET') return j(sheetRows)
        flowCalls.push({ fn: 'company_sheets', method: r.request().method(), ...r.request().postDataJSON() }); return j(null) }
      if (sheetsOn && u.includes('/rest/v1/hr_request_formats')) { if (r.request().method() === 'GET') return j(sheetFormats)
        flowCalls.push({ fn: 'hr_request_formats', url: u, ...r.request().postDataJSON() }); return j(null) }
      if (sheetsOn && u.includes('/rest/v1/hr_requests') && r.request().method() === 'GET') return j(sheetRequests)
      if (sheetsOn && u.includes('rpc/hr_request_update')) { flowCalls.push({ fn: 'hr_request_update', ...r.request().postDataJSON() }); return j(null) }
      if (u.includes('rpc/hr_sheet_people')) { flowCalls.push({ fn: 'hr_sheet_people', ...r.request().postDataJSON() })
        return j({ e01: { full_name: 'Rahim Sheikh', employee_code: '5001', mobile: '01711000111', position_name: 'Shorting+Loader', hub_name: 'Lalpur', date_of_birth: '2005-10-10', nid_number: '1234567890',
            basic_salary: 10000, transport_allowance: 250, commission: 0, 'doc:photo': true },
          e02: { full_name: 'Karim Ali', employee_code: '5002', mobile: '01711000222', position_name: 'Shorting+Loader', hub_name: 'Boraigram', nid_number: '12345678901234567', basic_salary: 13000, transport_allowance: 250, commission: 0 } }) }
      if (u.includes('/rest/v1/hr_request_formats') && u.includes('order=sort_order')) return j([
        { id: 'f-active', code: 'ID_ACTIVE', kind: 'id_active', name: 'ID ACTIVE', name_bn: 'আইডি চালু', description: null, needs_employee: true, self_service: true, sort_order: 30, archived_at: null, fields: [
          { key: 'employee_code', label: 'আইডি', type: 'text', prefill: 'employee_code' }, { key: 'full_name', label: 'নাম', type: 'text', prefill: 'full_name' },
          { key: 'effective_date', label: 'কবে থেকে চালু', type: 'date', required: true }, { key: 'reason', label: 'কারণ', type: 'textarea' }] },
        { id: 'f-leave', code: 'ID_INACTIVE', kind: 'id_inactive', name: 'ID INACTIVE / REMOVE', name_bn: 'আইডি বন্ধ / চাকরি ছাড়া', description: null, needs_employee: true, self_service: true, sort_order: 40, archived_at: null, fields: [
          { key: 'employee_code', label: 'আইডি', type: 'text', prefill: 'employee_code' }, { key: 'full_name', label: 'নাম', type: 'text', prefill: 'full_name' },
          { key: 'last_date', label: 'শেষ কর্মদিবস', type: 'date', required: true },
          { key: 'reason_type', label: 'ধরন', type: 'select', required: true, options: ['চাকরি ছেড়ে দিচ্ছি', 'আইডি সাময়িক বন্ধ', 'অফিস থেকে বাদ', 'অন্য কারণ'] },
          { key: 'reason', label: 'বিস্তারিত কারণ', type: 'textarea', required: true }] }])
      if (u.includes('rpc/ref_hub_people')) return j(staffRows.map(e => ({ id: e.id, employee_code: e.employee_code, full_name: e.full_name, post: 'Rider', mobile: e.mobile ?? null })))
      if (u.includes('rpc/hr_referrals')) return j([{ id: 'e07', employee_code: '1007', full_name: 'Karim Mia', position_name: 'Rider', hub_name: 'Lalpur', zone_name: 'Natore', status: 'active', joining_date: '2026-10-01' }])
      if (u.includes('/rest/v1/referral_prospects') && r.request().method() === 'POST') { prospects.push(r.request().postDataJSON()); return j(null) }
      if (u.includes('rpc/role_admin_list')) return j(roles)
      // advanced role & permission pages
      if (u.includes('/rest/v1/permissions')) return j(permRows)
      if (u.includes('rpc/user_admin_list')) return j(accounts4)
      if (u.includes('/rest/v1/audit_logs')) return j(auditRows)
      if (/rpc\/(access_overrides|access_user_grants)(\?|$)/.test(u) && !ownInstalled)   // the database part is not applied yet
        return r.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }) })
      if (/rpc\/access_overrides(\?|$)/.test(u)) { const who = r.request().postDataJSON()?.p_user; return j(ownRows.filter(o => !who || o.user_id === who)) }
      if (u.includes('rpc/access_user_grants')) return j([{ permission_code: 'hr.attendance.view', scope_type: 'hub', zone_id: null, hub_id: 'h1', is_super: false },
        { permission_code: 'hr.attendance.create', scope_type: 'hub', zone_id: null, hub_id: 'h1', is_super: false }, { permission_code: 'hr.employee.view', scope_type: 'hub', zone_id: null, hub_id: 'h1', is_super: false },
        { permission_code: 'da.report.export', scope_type: 'hub', zone_id: null, hub_id: 'h2', is_super: false }])
      if (/rpc\/(role_admin_save|access_overrides_save|user_admin_assign_role|user_admin_revoke_role)(\?|$)/.test(u)) { const fn = u.split('rpc/')[1].split('?')[0]
        flowCalls.push({ fn, ...r.request().postDataJSON() }); return j(fn === 'role_admin_save' ? r.request().postDataJSON()?.p_id ?? 'r9' : fn === 'access_overrides_save' ? { added: 1, kept: 1, removed: 0 } : fn === 'user_admin_assign_role' ? 'a9' : null) }
      if (u.includes('rpc/role_dashboard_list')) return j([{ role_id: 'r2', code: 'hub_manager', name: 'Hub Manager', name_bn: null, is_super: false, panels: ['my_work', 'quick_links'], user_count: 4, default_view: 'self' }])
      if (u.includes('rpc/staff_panel_sections')) return j(staffSecs)
      if (u.includes('rpc/role_staff_sections_save')) { flowCalls.push({ fn: 'role_staff_sections_save', ...r.request().postDataJSON() }); return j(null) }
      if (u.includes('rpc/role_dashboard_save')) { flowCalls.push({ fn: 'role_dashboard_save', ...r.request().postDataJSON() }); return j(null) }
      if (u.includes('rpc/dashboard_home')) return j({ panels: homePanels, today: '2026-11-15', me: null, my_work: { tasks_open: 2, tasks_due: 0, tasks_to_check: 0, leave_pending: 0, marked_today: true },
        accounts_today: { open: 1, submitted: 2, correction: 0, approved: 3, hubs: 4 }, cash_today: { handovers_waiting: 1, expenses_waiting: 0, payments_waiting: 2, recons_waiting: 0, collected_today: 1500 } })
      if (u.includes('rpc/hr_change_register')) return j(register)
      if (u.includes('/rest/v1/geo_upazilas')) return j([{ code: 143, district: 'Natore', district_bn: 'নাটোর', name: 'Natore Sadar', name_bn: 'নাটোর সদর', boundary: [[24.36, 88.93], [24.47, 88.93], [24.47, 89.07], [24.36, 89.07], [24.36, 88.93]] },
        { code: 149, district: 'Natore', district_bn: 'নাটোর', name: 'Naldanga', name_bn: 'নলডাঙ্গা', boundary: null }])
      if (u.includes('/rest/v1/route_places')) return j(routePlaces)
      if (u.includes('rpc/route_place_save') || u.includes('rpc/route_place_hide')) { flowCalls.push({ fn: u.split('rpc/')[1].split('?')[0], ...r.request().postDataJSON() }); return j('pl9') }
      if (u.includes('rpc/route_load_overview')) return j({ days: 30, from: '2026-10-20', hubs: [{ hub_id: 'h1', rider_parcels: loadSaved?.rider_parcels ?? null, days: 5, delivery: 700, pickup: 20,
        riders: [{ employee_id: 'e01', days: 5, delivery: 700, pickup: 20 }], routes: {} }, { hub_id: 'h2', rider_parcels: null, days: 0, delivery: 0, pickup: 0, riders: [], routes: {} }] })
      if (u.includes('rpc/route_load_save')) { loadSaved = r.request().postDataJSON().p; flowCalls.push({ fn: 'route_load_save', ...r.request().postDataJSON() }); return j(null) }
      if (u.includes('rpc/route_zones')) return j([{ id: 'z1', code: 'NT', name: 'Natore Area' }])
      if (u.includes('rpc/route_zone_overview')) return j(routeOverview)
      if (u.includes('rpc/route_day')) return j({ date: '2026-11-19', routes: [{ route_id: 'rt1', hub_id: 'h1', hub_name: 'Natore Sadar', code: 'R01', name: 'শহর পূর্ব', color: '#2563EB', stops: 3, stops_gps: 3,
        riders: [{ employee_id: 'e01', name: 'Staff 01', code: '1001', visited: 2, far: 1, first_at: '2026-11-19T04:10:00Z', last_at: '2026-11-19T05:00:00Z' }],
        visits: [{ stop_id: 'st1', stop: 'কানাইখালী', seq: 1, employee_id: 'e01', at: '2026-11-19T04:10:00Z', lat: 24.4105, lng: 88.9862, distance_m: 40, near: true, accuracy_m: 12, note: null },
          { stop_id: 'st2', stop: 'আলাইপুর', seq: 2, employee_id: 'e01', at: '2026-11-19T05:00:00Z', lat: 24.4210, lng: 88.9790, distance_m: 640, near: false, accuracy_m: 20, note: null }] }] })
      if (/rpc\/(route_save|route_riders_set|route_settings_save|route_archive)(\?|$)/.test(u)) { const fn = u.split('rpc/')[1].split('?')[0]; flowCalls.push({ fn, ...r.request().postDataJSON() })
        return j(fn === 'route_save' ? 'rt9' : fn === 'route_riders_set' ? { added: 1, ended: 0 } : fn === 'route_settings_save' ? routeOverview.rules : null) }
      if (u.includes('rpc/nodi_settings')) return j({ enabled: true, model: 'claude-sonnet-5-5', daily_limit: 50, max_tokens: 1024, features: { ...nodiParts } })
      if (u.includes('rpc/nodi_features_configure')) { const f = r.request().postDataJSON()?.p_features ?? {}; Object.assign(nodiParts, f); flowCalls.push({ fn: 'nodi_features_configure', ...f }); return j(null) }
      if (u.includes('rpc/nodi_features')) return j({ ...nodiParts })
      if (u.includes('rpc/zone_group_list')) return j([{ zone_id: 'z1', zone_name: 'Natore Area', zone_code: 'NAT', hubs: 10, unseen: 3, last_at: '2026-11-15T05:00:00Z', mine: true }])
      if (u.includes('rpc/zone_feed')) return j([{ id: 'zp1', author_name: 'Zonal Karim', is_nodi: false, mine: false, kind: 'text', body: 'আজ সবাই সময়মতো রিপোর্ট দিন', photo_path: null,
        created_at: '2026-11-15T05:00:00Z', issue: null, reactions: {}, seen_count: 4, seen_by_me: false }])
      if (u.includes('rpc/zone_posts_seen')) return j(1)
      if (u.includes('rpc/zone_contacts')) return j({ zone_id: 'z1', zone_name: 'Natore Area', zone_code: 'NAT', sent_today: 0,
        managers: [{ profile_id: 'u3', full_name: 'Zonal Karim', employee_code: '900', position: 'Zonal Manager', phone: '01711999999', has_login: true, is_me: false }] })
      if (u.includes('rpc/zone_manager_tell')) { flowCalls.push({ fn: 'zone_manager_tell', ...r.request().postDataJSON() }); return j(1) }
      if (u.includes('rpc/hub_group_hubs')) return j([{ hub_id: 'h1', hub_name: 'Natore Sadar', hub_code: '80', open_issues: 3, unseen: 2 }])
      if (u.includes('rpc/issue_order_incharge_set')) return j(null)
      if (u.includes('rpc/issue_order_incharge')) return j({ store: { id: 'e05', name: 'Store Keeper', code: '1005', hub: 'Natore Sadar', has_login: true }, it: null })
      if (u.includes('rpc/issue_panels')) return j({ given: [], waiting_for_check_of_mine: [], hub: [],
        to_check: [{ id: 'i3', issue_no: 'IS-00011', title: 'পার্সেল ভেজা এসেছে', kind: 'parcel', priority: 'high', status: 'solved', hub_id: 'h1', hub: 'Natore Sadar', parcel_ref: 'XZ123456', due_at: null,
          created_at: '2026-11-14T09:00:00Z', solved_at: '2026-11-15T03:00:00Z', reopen_count: 0, assigned_by_name: 'Owner', assigned_by_nodi: false, assignee: 'Rahim Uddin', assignee_code: '1002', is_mine: false, is_giver: true, overdue: false }],
        mine: [{ id: 'i2', issue_no: 'IS-00010', title: 'কাস্টমার ফোন ধরছে না', kind: 'parcel', priority: 'normal', status: 'in_progress', hub_id: 'h1', hub: 'Natore Sadar', parcel_ref: null, due_at: null,
          created_at: '2026-11-15T05:00:00Z', solved_at: null, reopen_count: 0, assigned_by_name: 'Hub Manager', assigned_by_nodi: false, assignee: 'Owner', assignee_code: '1', is_mine: true, is_giver: false, overdue: true }, { id: 'o1', issue_no: 'IS-00009', title: 'স্টোর অর্ডার: টেপ', kind: 'store',
        priority: 'normal', status: 'open', hub_id: 'h1', hub: 'Natore Sadar', parcel_ref: null, due_at: null, created_at: '2026-11-15T04:00:00Z', solved_at: null, reopen_count: 0,
        assigned_by_name: 'Hub Manager', assigned_by_nodi: false, assignee: 'Owner', assignee_code: '1', is_mine: true, is_giver: false, overdue: false }] })
      if (u.includes('rpc/hub_login_list')) return j([
        { employee_id: 'e02', employee_code: '7982', full_name: 'Alamin Sarker', position_name: 'Commission Rider', position_name_bn: 'কমিশন রাইডার', mobile: null, role_id: 'r5', role_code: 'rider', can_make: true, user_id: null, login_id: null, must_change: false, last_login_at: null, locked: false },
        { employee_id: 'e03', employee_code: '6799', full_name: 'Md Mahin', position_name: 'Commission Rider', position_name_bn: 'কমিশন রাইডার', mobile: '01711000003', role_id: 'r5', role_code: 'rider', can_make: false, user_id: 'u9', login_id: 'id-6799@xzmteam.com', must_change: true, last_login_at: null, locked: false },
        { employee_id: 'e04', employee_code: '8157', full_name: 'Sohel Sardar', position_name: 'Assistant Manager', position_name_bn: 'সহকারী ম্যানেজার', mobile: null, role_id: 'r2', role_code: 'hub_manager', can_make: false, user_id: null, login_id: null, must_change: false, last_login_at: null, locked: false }])
      if (u.includes('rpc/hr_hub_profile_get')) return j({ full_name: 'Staff 01', employee_code: '1001', full_name_bn: null, mobile: '01711000001', email: null, emergency_contact_name: null, emergency_contact_phone: null, alt_mobile: null, blood_group: null,
        has: { nid_number: true, date_of_birth: false, father_name: false, mother_name: false, present_address: false, permanent_address: false } })
      if (u.includes('rpc/hr_hub_profile_save') || u.includes('rpc/hr_request_submit')) { flowCalls.push({ fn: u.split('rpc/')[1].split('?')[0], ...r.request().postDataJSON() }); return j('q1') }
      if (u.includes('/rest/v1/hr_request_formats') && u.includes('kind=eq.id_inactive')) return j({ id: 'f-inactive' })
      if (u.includes('rpc/my_menu') && menuFail) return r.fulfill({ status: 500, contentType: 'application/json', headers: cors, body: '{"message":"fail"}' })
      if (u.includes('rpc/my_menu')) return j(menuNow)
      if (u.includes('rpc/role_menu_list')) return j([{ role_id: 'r2', code: 'hub_manager', name: 'Hub Manager', name_bn: null, is_super: false, menu: null, user_count: 4 }])
      if (u.includes('rpc/role_menu_save')) { flowCalls.push({ fn: 'role_menu_save', ...r.request().postDataJSON() }); return j(null) }
      if (/rpc\/(fleet_set_crew|fleet_garage_save|fleet_approve|fleet_hub_report|fleet_request|vehicle_log_save|vehicle_configure|fleet_vehicle_save)(\?|$)/.test(u)) {
        flowCalls.push({ fn: u.split('rpc/')[1].split('?')[0], ...r.request().postDataJSON() }); return j({ posted: true, voucher: 'V-2611-00007' }) }
      if (u.includes('rpc/fleet_khoraki_post')) { flowCalls.push({ fn: 'fleet_khoraki_post', ...r.request().postDataJSON() }); return j([{ name: 'Rahim', role: 'driver', amount: 150, posted: true, voucher: 'V-2611-00008' }]) }
      if (u.includes('rpc/vehicle_settings')) return j({ fleet: { functions: {}, khoraki: { driver: 150, helper: 100 }, kinds: [{ code: 'truck', bn: 'ট্রাক', crew: ['driver', 'helper'] }, { code: 'auto', bn: 'অটো', crew: ['driver'] }] },
        request_formats: { service: [{ key: 'what', label: 'কী সার্ভিসিং', type: 'select', required: true, options: ['ব্রেক', 'ইঞ্জিন অয়েল'] }] } })
      if (u.includes('rpc/fleet_board')) return j([
        { id: 'v1', code: 'G-0001', name: 'নাটোর ট্রাক', reg_no: 'ঢাকা মেট্রো ট ১১-২২৩৩', kind: 'truck', status: 'active', hub_id: 'h1', hub_name: 'Natore Sadar', zone_id: 'z1', zone_name: 'Natore', roles: ['driver', 'helper'],
          crew: [{ role: 'driver', employee_id: 'e02', code: '7982', name: 'Alamin Sarker', mobile: '01711000002', allowance: 150, since: '2026-11-01' }], khoraki_today: [], garage_today: null,
          pending: 1, unposted: 0, requests_open: 1, can_edit: true, can_crew: true, can_approve: true, can_khoraki: true, can_garage: true },
        { id: 'v2', code: 'G-0002', name: 'লালপুর অটো', reg_no: null, kind: 'auto', status: 'active', hub_id: 'h1', hub_name: 'Natore Sadar', zone_id: 'z1', zone_name: 'Natore', roles: ['driver'],
          crew: [{ role: 'driver', employee_id: 'e03', code: '6799', name: 'Md Mahin', mobile: null, allowance: 120, since: '2026-11-01' }], khoraki_today: [], garage_today: null,
          pending: 0, unposted: 0, requests_open: 0, can_edit: true, can_crew: true, can_approve: true, can_khoraki: true, can_garage: true }])
      if (u.includes('rpc/fleet_waiting')) return j({ logs: [{ id: 'l1', vehicle_id: 'v1', vehicle: 'নাটোর ট্রাক', hub_name: 'Natore Sadar', kind: 'fuel', log_date: '2026-11-16', amount: 1050, litres: 10, vendor: 'Padma Pump', bill_no: null,
          slip_path: null, note: null, status: 'submitted', by_name: 'Alamin Sarker', by_code: '7982', created_at: '2026-11-16T04:00:00Z' }],
        requests: [{ id: 'q1', no: 'VQ-00001', vehicle_id: 'v2', vehicle: 'লালপুর অটো', hub_name: 'Natore Sadar', kind: 'service', title: 'ব্রেক কাজ করছে না', data: { what: 'ব্রেক' }, photos: [], priority: 'urgent',
          status: 'open', by_name: 'Md Mahin', by_code: '6799', created_at: '2026-11-16T05:00:00Z' }] })
      if (u.includes('rpc/fleet_hub_reports')) return j([{ id: 'hr1', report_date: '2026-11-16', status: 'unload_late', late_minutes: 45, note: 'লোক ছিল না', photo_path: null, hub_id: 'h2', hub_name: 'Lalpur',
        vehicle_id: 'v1', vehicle: 'নাটোর ট্রাক', by_name: 'Alamin Sarker', by_code: '7982', created_at: '2026-11-16T06:00:00Z', updated_at: '2026-11-16T06:00:00Z' }])
      if (u.includes('rpc/fleet_events')) return j([{ id: 'ev1', at: '2026-11-16T03:00:00Z', action: 'crew_set', role: 'driver', detail: 'খোরাকি ৳150', vehicle_id: 'v1', vehicle: 'নাটোর ট্রাক', employee: 'Alamin Sarker', employee_code: '7982', by_name: 'Owner' }])
      if (u.includes('rpc/fleet_approvers')) return j([{ code: 'vehicle.log.approve', description: null, roles: ['হাব ম্যানেজার', 'জোনাল ম্যানেজার'] }])
      if (u.includes('rpc/fleet_mine')) return j({ functions: {}, formats: { service: [{ key: 'what', label: 'কী সার্ভিসিং', type: 'select', required: true, options: ['ব্রেক', 'ইঞ্জিন অয়েল'] }] },
        vehicles: [{ id: 'v2', name: 'লালপুর অটো', reg_no: null, kind: 'auto', status: 'active', hub_id: 'h1', hub_name: 'Natore Sadar', zone_id: 'z1', role: 'driver', allowance: 120, since: '2026-11-01', crew: [],
          zone_hubs: [{ id: 'h1', name: 'Natore Sadar' }, { id: 'h2', name: 'Lalpur' }],
          garage: [{ date: '2026-11-15', charged: true, cost: 80, place: 'রহিম গ্যারেজ', note: null }],
          costs: [{ id: 'c1', kind: 'charge', date: '2026-11-15', amount: 80, litres: null, status: 'approved', note: null, posted: true, voucher: 'V-2611-00003', mine: true },
                  { id: 'c2', kind: 'khoraki', date: '2026-11-15', amount: 120, litres: null, status: 'approved', note: null, posted: true, voucher: 'V-2611-00004', mine: true }],
          requests: [], reports: [] }] })
      if (/rpc\/(att_self_mark|att_self_decide)/.test(u)) { flowCalls.push({ fn: u.split('rpc/')[1].split('?')[0], ...r.request().postDataJSON() }); return j(1) }
      if (u.includes('rpc/my_att_today')) return j({ work_date: '2026-11-16', record: null, mark: null })
      if (u.includes('rpc/att_self_list')) return j([
        { id: 'sm1', employee_id: 'e02', employee_code: '7982', full_name: 'Alamin Sarker', kind: 'present', note: null, marked_at: '2026-11-16T03:05:00Z', status: 'waiting', decided_as: null, decide_note: null, decided_at: null, decided_by_name: null },
        { id: 'sm2', employee_id: 'e03', employee_code: '6799', full_name: 'Md Mahin', kind: 'absent', note: 'জ্বর', marked_at: '2026-11-16T02:00:00Z', status: 'waiting', decided_as: null, decide_note: null, decided_at: null, decided_by_name: null }])
      // the one attendance page: a hub with two days of staff attendance waiting for their final register
      if (u.includes('rpc/wf_hub_overview')) return j({ hub: { id: 'h1', code: '80', name: 'Natore Sadar', zone_id: 'z1', zone_name: 'Natore Area' }, date: '2026-11-24', staff_total: 2,
        can: { attendance: true, decide: true, correct: true, ops: true, ops_edit: true },
        attendance: { present: 0, late: 0, half_day: 0, absent: 0, leave: 0, other: 0, not_given: 2, waiting_marks: 3, returned_marks: 0 }, pending: { marks: 3, applications: 1 }, ops: null, people: [] })
      if (u.includes('rpc/wf_marks')) return j([['m1', '2026-11-03'], ['m2', '2026-11-03'], ['m3', '2026-11-05']].map(([id, d]) => ({ id, employee_id: 'e02', employee_code: '7982', full_name: 'Alamin Sarker', position: 'Rider',
        hub_id: 'h1', hub_name: 'Natore Sadar', zone_id: 'z1', work_date: d, kind: 'present', applied_on_site: null, note: null, site_applied_on: null, site_ref: null, status: 'waiting', via: 'book',
        marked_at: `${d}T04:00:00Z`, decided_as: null, decide_note: null, decided_at: null, decided_by_name: null, application_id: null, application_no: null, record_status: null })))
      if (u.includes('rpc/att_sheet_get')) { const d = r.request().postDataJSON()?.p_date ?? '2026-11-24'
        return j({ hub: { id: 'h1', name: 'Natore Sadar' }, date: d, today: '2026-11-24', sheet: null, can: { edit: true, unlock: false, send: false }, my_check: null, by_position: [], checks: [], due: '2026-11-25T00:00:00+06:00', window: null, versions: [], hold: d === '2026-11-03' ? { held_at: '2026-11-04T00:05:00Z', reason: 'incomplete', gap_count: 1, total: 1, gaps: [{ name: 'Alamin Sarker', why: 'হাজিরা বাছুন' }] } : null,
          people: [{ employee_id: 'e02', code: '7982', name: 'Alamin Sarker', position: 'Rider', position_code: 'rider', has_login: true, saved: false, record_status: null, explanations: [],
            mark: { id: 'm1', kind: 'present', note: null, status: 'waiting', marked_at: `${d}T04:00:00Z`, applied_on_site: null, site_applied_on: null, site_ref: null, application_no: null },
            value: { manager_ok: null, final_status: null, late_time: null, online_marked: null, online_reason: null, absence_app_date: null, absence_app_ref: null, unauthorized: false, note: null } }] }) }
      if (u.includes('rpc/wf_applications')) return j([])
      // the staff work profile: one person with a submitted and a draft register, a cancelled route and a delivery line
      if (u.includes('rpc/staff_profile_people')) return j([{ id: 'e02', code: '7982', name: 'Alamin Sarker', post: 'Rider', status: 'active' }])
      if (u.includes('rpc/staff_profile_get')) { const b = r.request().postDataJSON() ?? {}
        return j({ from: b.p_from, to: b.p_to, today: b.p_to, person: { id: b.p_employee, code: '7982', name: 'Alamin Sarker', name_bn: null, status: 'active', joining_date: '2025-01-05', position_id: 'p1', position: 'Rider', department: 'Operations',
            hub_id: 'h1', hub: 'Natore Sadar', zone_id: 'z1', zone: 'Natore Area', manager: 'Hub Boss', has_login: true, focus: null },
          assignments: [{ type: 'transfer', from: '2026-11-01', to: null, position: 'Rider', hub: 'Natore Sadar', zone: 'Natore Area', reason: 'বদলি' }, { type: 'joining', from: '2025-01-05', to: '2026-10-31', position: 'Rider', hub: 'Lalpur', zone: 'Natore Area', reason: null }],
          duties: [{ id: 'd1', title: 'নগদ ব্যাগ বহন', details: 'প্রতি সন্ধ্যায়', frequency: 'daily', source: 'person' }],
          attendance: { days: [{ date: '2026-11-23', hub_id: 'h1', hub: 'Natore Sadar', status: 'late', sheet_status: 'submitted', version: 2, late_time: '10:15', absence_reason: null, unauthorized: false, leave_ref: null, leave_applied_on: null, online_marked: true, online_at: '2026-11-23T04:00:00Z', mode: 'manager' },
              { date: '2026-11-24', hub_id: 'h1', hub: 'Natore Sadar', status: 'present', sheet_status: 'draft', version: 0, late_time: null, absence_reason: null, unauthorized: false, leave_ref: null, leave_applied_on: null, online_marked: null, online_at: null, mode: null }],
            present: 1, late: 1, absent: 0, unauthorized: 0, leave: 0, off: 0, unchecked: 0, drafts: 1 },
          leave: [{ ref: 'LR-1A2B3C4D', from: '2026-11-10', to: '2026-11-11', days: 2, status: 'approved', applied_on: '2026-11-05' }],
          routes: [{ route_id: 'rt1', code: 'R-1', name: 'Town East', hub: 'Natore Sadar', from: '2026-11-01', to: null }], backup: false,
          modules: [{ module: 'attendance', submitted: 1, draft: 1, cancelled: 0, last_at: '2026-11-23T05:00:00Z' }, { module: 'route', submitted: 0, draft: 0, cancelled: 1, last_at: '2026-11-24T03:00:00Z' }, { module: 'daily_ops', submitted: 1, draft: 0, cancelled: 0, last_at: '2026-11-24T04:00:00Z' }],
          events: [{ id: 'v1', date: '2026-11-24', module: 'route', activity: 'route_cancelled', status: 'cancelled', hub_id: 'h1', hub: 'Natore Sadar', source_id: 'x1', version: 2, detail: {}, server_time: '2026-11-24T03:00:00Z', link: '/app/routes/plan?hub=h1' },
            { id: 'v2', date: '2026-11-24', module: 'daily_ops', activity: 'daily_numbers', status: 'submitted', hub_id: 'h1', hub: 'Natore Sadar', source_id: 'x2', version: 1, detail: { delivery: 52 }, server_time: '2026-11-24T04:00:00Z', link: null },
            { id: 'v3', date: '2026-11-23', module: 'attendance', activity: 'late', status: 'submitted', hub_id: 'h1', hub: 'Natore Sadar', source_id: 'x3', version: 2, detail: {}, server_time: '2026-11-23T05:00:00Z', link: null }],
          connected: ['morning', 'attendance', 'route', 'daily_ops', 'hub_ops', 'sorting'] }) }
      // the monthly register's submission: a day still missing, nothing submitted yet; the reopening list and the opening
      if (u.includes('rpc/att_month_get')) return j({ hub: { id: 'h1', name: 'Natore Sadar' }, month: r.request().postDataJSON().p_month, today: '2026-11-24', from: '2026-11-22', to: '2026-11-23', missing: ['2026-11-22'], days: { '2026-11-23': 1 },
        sub: null, changed: false, changed_days: [], history: [], checks: [], my_check: null, can: { submit: true, send: false } })
      if (u.includes('rpc/att_reopen_list')) return j([{ id: 'w1', from: '2026-11-22', to: '2026-11-22', expires_at: '2026-11-24T05:00:00Z', reason: 'ভুল স্ট্যাটাস', by: 'Zonal', status: 'open', created_at: '2026-11-24T04:00:00Z', closed_at: null, can_close: true }])
      if (u.includes('rpc/att_reopen_open')) { flowCalls.push({ fn: 'att_reopen_open', ...r.request().postDataJSON() }); return j({ window: 'w2', opened: 1, expires_at: '2026-11-24T05:00:00Z' }) }
      // the morning input: a form with two people to mark and one on approved leave; after the submit only a receipt
      if (/rpc\/wf_morning_(get|save|submit|return)\b/.test(u)) {
        const body = r.request().postDataJSON() ?? {}, fn = u.split('rpc/')[1].split('?')[0]
        if (fn !== 'wf_morning_get') flowCalls.push({ fn, ...body })
        if (fn === 'wf_morning_submit') { morningDone = true; return j({ revision: 1, mode: 'manager', submitted_at: '2026-11-24T02:00:00Z', already: false }) }
        if (fn === 'wf_morning_return') return j(2)
        if (fn === 'wf_morning_save') return j(null)
        return j({ hub: { id: 'h1', name: 'Natore Sadar', zone_id: 'z1' }, date: '2026-11-24', today: '2026-11-24', now: '2026-11-24T01:00:00Z', due: '2026-11-24T02:15:00Z',
          status: morningDone ? 'submitted' : 'open', revision: 1, can: { fill: !morningDone, review: false },
          hold: morningDone ? null : { held_at: '2026-11-24T02:15:00Z', reason: 'incomplete', gap_count: 2, total: 2, gaps: [{ name: 'Alamin Sarker', why: 'অবস্থা বসানো হয়নি' }] },
          receipt: morningDone ? { revision: 1, mode: 'manager', submitted_at: '2026-11-24T02:00:00Z', submitted_by_name: 'Owner' } : null, returned: null,
          people: morningDone ? null : [
            { id: 'e02', code: '7982', name: 'Alamin Sarker', post: 'Rider', state: 'unknown', leave: null },
            { id: 'e03', code: '6799', name: 'Md Mahin', post: 'Rider', state: 'unknown', leave: null },
            { id: 'e04', code: '6800', name: 'Karim Uddin', post: 'Hub Staff', state: 'leave', leave: { ref: 'LR-1A2B3C4D', source: 'leave_request', applied_on: '2026-11-20' } }] }) }
      if (u.includes('rpc/wf_morning_zone')) return j({ date: r.request().postDataJSON().p_date, today: r.request().postDataJSON().p_date, now: '2026-11-24T01:00:00Z', hubs: [
        { id: 'h1', name: 'Natore Sadar', zone_id: 'z1', zone_name: 'Natore Area', staff: 3, due: '2026-11-24T02:15:00Z', held: false, hold: null, state: 'submitted', sub_id: 's1', revision: 1, mode: 'auto', submitted_at: '2026-11-24T02:15:00Z', returned: null,
          present: 1, absent: 1, leave: 1, unknown: 0, people: [{ id: 'e02', name: 'Alamin Sarker', code: '7982', state: 'absent', leave_ref: null }],
          cover: [{ id: 'rt1', code: 'R-1', name: 'Town East', regular: ['Alamin Sarker'] }], plan: { id: 'p1', status: 'approved', published_version: 2 } },
        { id: 'h2', name: 'Lalpur', zone_id: 'z1', zone_name: 'Natore Area', staff: 4, due: '2026-11-24T02:15:00Z', state: 'none', sub_id: null, revision: null, mode: null, submitted_at: null, returned: null,
          present: 0, absent: 0, leave: 0, unknown: 0, people: null, cover: null, plan: null, held: true, hold: { reason: 'empty', gap_count: 4, total: 4, gaps: [] } }] })
      if (u.includes('rpc/wf_att_policy_get')) return j({ zone_id: 'z1', morning_cutoff: '08:00', morning_extra: 15, day_time: '00:00', day_extra: 0, own: false, today_due: '2026-11-24T02:15:00Z', can_edit: true })
      if (u.includes('rpc/wf_att_policy_save')) { flowCalls.push({ fn: 'wf_att_policy_save', ...r.request().postDataJSON() }); return j({ zone_id: 'z1', morning_cutoff: '09:00', morning_extra: 15, day_time: '00:00', day_extra: 0, own: true, today_due: '2026-11-24T03:15:00Z', can_edit: true }) }
      if (u.includes('rpc/route_plan_published')) return j({ date: r.request().postDataJSON().p_date, plan_id: 'p1', version: { no: 2, published_at: '2026-11-24T03:00:00Z', by: 'Zonal', morning_revision: 1 }, reopened: false,
        lines: [{ employee_id: 'e03', name: 'Md Mahin', role: 'rider', parcels: 40, pickups: 0, routes: ['R-1 · Town East'], sent_count: 1, last_sent_at: '2026-11-24T03:00:00Z' }],
        cancelled: [{ employee_id: 'e02', name: 'Alamin Sarker', cancelled_at: '2026-11-24T03:00:00Z', in_version: 2 }],
        history: [{ kind: 'published', version: 2, note: null, by: 'Zonal', at: '2026-11-24T03:00:00Z' }, { kind: 'cancelled', version: 2, note: 'Alamin Sarker', by: 'Zonal', at: '2026-11-24T03:00:00Z' }] })
      // one tap: the rider's send card and the manager's accept box
      if (u.includes('rpc/da_rider_open_managers')) return j({ session_id: 's2', status: 'open', date: '2026-11-15', hub: 'Natore Sadar',
        is_rider: (permsNow ?? []).includes('ops.pickup_as_rider.create'), my_times: 1, max_times: 3,
        managers: [{ user_id: 'u7', name: 'Abdul Karim', code: '1007', closed: false }, { user_id: 'u8', name: 'Sohel Sardar', code: '8157', closed: false }],
        mine: !(permsNow ?? []).includes('ops.pickup_as_rider.create') ? [] : [{ id: 'rl1', seq: 1, source: 'rider', delivery: 20, pickup: 3, amount: 4100, office_deposit: false, manager: 'Abdul Karim', at: '2026-11-15T06:00:00Z', status: 'pending' }] })
      if (/rpc\/wf_ops_add(\?|$)/.test(u)) { flowCalls.push({ fn: 'wf_ops_add', ...r.request().postDataJSON() }); return j({}) }
      if (/rpc\/(da_rider_submit|da_rider_accept_all|da_rider_accept)(\?|$)/.test(u)) { flowCalls.push({ fn: u.split('rpc/')[1].split('?')[0], ...r.request().postDataJSON() }); return j(u.includes('accept_all') ? 2 : 'rl9') }
      if (/rpc\/(da_claim_add|da_claim_reject)(\?|$)/.test(u)) { flowCalls.push({ fn: u.split('rpc/')[1].split('?')[0], ...r.request().postDataJSON() }); return j('x9') }
      if (u.includes('/rest/v1/da_expense_claims') && u.includes('status=eq.submitted')) return j([
        { id: 'c1', no: 41, hub_id: 'h1', employee_code: '1003', employee_name: 'Rafiq Islam', kind: 'transport', expense_name: 'ভ্যান ভাড়া', category: 'transport', amount: 120, bill_date: '2026-11-15', attachment_path: null, remarks: null, created_at: '2026-11-15T05:00:00Z' },
        { id: 'c2', no: 42, hub_id: 'h1', employee_code: '1004', employee_name: 'Nasima Akter', kind: 'employee', expense_name: 'অফিসের পানি', category: 'office', amount: 80, bill_date: '2026-11-15', attachment_path: 'claims/e04/x.jpg', remarks: null, created_at: '2026-11-15T05:10:00Z' },
      ].filter(c => !flowCalls.some(f => (f.fn === 'da_claim_add' || f.fn === 'da_claim_reject') && f.p_claim === c.id)))
      if (u.includes('/rest/v1/da_rider_lines') && u.includes('source=eq.rider')) return j(flowCalls.some(c => c.fn === 'da_rider_accept_all') ? [] : [
        { id: 'rl2', session_id: 's2', rider_name: 'Alamin Sarker', employee_code: '7982', pickup_qty: 4, delivery_qty: 18, amount: 3600, seq: 1, office_deposit: false, created_at: '2026-11-15T06:10:00Z' },
        { id: 'rl3', session_id: 's2', rider_name: 'Md Mahin', employee_code: '6799', pickup_qty: 0, delivery_qty: 11, amount: 2250, seq: 2, office_deposit: true, created_at: '2026-11-15T06:20:00Z' }])
      if (u.includes('rpc/da_center_overview')) return j([
        { id: 'h1', name: 'Natore Sadar', code: '80', zone_id: 'z1', zone: 'Natore Area', session_id: 's2', status: 'open', started_at: '2026-11-15T03:00:00Z', started_by_name: 'Owner', submitted_at: null, submitted_by_name: null, verified_at: null, verified_by_name: null, closed_at: null, bank_done_at: null,
          report_total: 100700, reports: 1, merchant: 15000, expense: 1250, staff_expense: 500, transport_expense: 750, missing_vouchers: 2, deposited: 84000, bank_costs: 73, deposits: 1, slips_missing: 0, slips_match: 0, slips_not_match: 1, slips_review: 0, bank_confirmed: 0, bills_waiting: 1, bank_amount: 84377, hub_due: 377 },
        { id: 'h2', name: 'Bagatipara', code: '81', zone_id: 'z1', zone: 'Natore Area', session_id: null, status: null, started_at: null, started_by_name: null, submitted_at: null, submitted_by_name: null, verified_at: null, verified_by_name: null, closed_at: null, bank_done_at: null,
          report_total: 0, reports: 0, merchant: 0, expense: 0, staff_expense: 0, transport_expense: 0, missing_vouchers: 0, deposited: 0, bank_costs: 0, deposits: 0, slips_missing: 0, slips_match: 0, slips_not_match: 0, slips_review: 0, bank_confirmed: 0, bills_waiting: 0, bank_amount: 0, hub_due: 0 }])
      if (u.includes('rpc/da_accounts_history')) return j([{ at: '2026-11-15T13:10:00Z', action: 'UPDATE', table: 'da_deposits', record: 'dp1', by: 'Owner', by_id: 'u1', fields: ['amount', 'updated_at'], old: { amount: 38000 }, new: { amount: 37550 } },
        { at: '2026-11-15T12:00:00Z', action: 'INSERT', table: 'da_report_ids', record: 'rp1', by: 'Owner', by_id: 'u1', fields: [], old: null, new: { report_no: '#743858', amount: 38000 } }])
      if (u.includes('/rest/v1/da_report_ids') && u.includes('da_sessions')) return j([{ id: 'rp1', report_no: '#743858', amount: 100700, remarks: null, file_path: 'da/s2/r.pdf', raw_text: null, hub_id: 'h1', session_id: 's2', da_sessions: { account_date: '2026-11-15' } }])
      if (u.includes('/rest/v1/da_merchant_payments') && u.includes('da_sessions')) return j([{ id: 'mp1', merchant_name: 'AFRIN Fashion', payment_ref: 'SFC-33223762', transaction_id: '52655971', amount: 15000, payment_date: '2026-11-15', screenshot_path: 'da/s2/p.png', ocr: { amount: 15000 }, ocr_verified: true, remarks: null, hub_id: 'h1', session_id: 's2', da_sessions: { account_date: '2026-11-15' } }])
      if (u.includes('/rest/v1/da_deposits') && u.includes('da_sessions')) return j([{ id: 'dp1', method: 'bank', bank_name: 'DBBL', amount: 37550, charge: 23, transport: 50, ref_no: 'R-1', deposited_on: '2026-11-15', slip_path: 'da/s2/slip.jpg', slip_uploaded_at: '2026-11-15T13:05:00Z', slip_uploaded_by_name: 'Owner',
        slip_ocr_amount: 35750, slip_ocr_confidence: 88, slip_match: 'not_match', bank_confirmed_at: null, bank_confirmed_by_name: null, bank_confirm_note: null, hub_id: 'h1', session_id: 's2', da_sessions: { account_date: '2026-11-15' } }])
      if (u.includes('/rest/v1/da_expenses') && u.includes('da_sessions')) return j([
        { id: 'x1', no: 1, kind: 'transport', expense_name: 'ভ্যান ভাড়া', category: 'transport', amount: 120, bill_date: '2026-11-15', voucher_no: 'V-2611-00007', attachment_path: null, claim_file: null, bill_no: null, employee_code: null, employee_name: null, reference_name: 'Owner', hub_id: 'h1', session_id: 's2', da_sessions: { account_date: '2026-11-15' } },
        { id: 'x2', no: 2, kind: 'employee', expense_name: 'চিকিৎসা', category: 'hr_treatment', amount: 500, bill_date: '2026-11-15', voucher_no: null, attachment_path: 'da/s2/m.jpg', claim_file: null, bill_no: 'M-9', employee_code: '6799', employee_name: 'Md Mahin', reference_name: null, hub_id: 'h1', session_id: 's2', da_sessions: { account_date: '2026-11-15' } }])
      if (/rpc\/(da_deposit_slip_read|da_deposit_confirm|da_report_attach|da_save_expense|da_make_voucher|da_set_expense_reference)(\?|$)/.test(u)) {
        const fn = u.split('rpc/')[1].split('?')[0]; flowCalls.push({ fn, ...r.request().postDataJSON() })
        return j(fn === 'da_make_voucher' ? 'V-2611-00009' : fn === 'da_save_expense' ? 'x9' : fn === 'da_deposit_slip_read' ? { match: 'review', amount: 1, ocr_amount: null } : null) }
      if (u.includes('/functions/v1/nodi-ai')) { const b = r.request().postDataJSON(); flowCalls.push({ fn: 'nodi-ai', ...b })
        return j(b?.action === 'teach' ? { text: 'নদী AI অভ্যন্তরীণ নির্দেশনা: স্লিপের টাকা আর লেখা টাকা মেলেনি। আগে স্লিপ নিজে দেখুন, তারপর মন্তব্য লিখে "ব্যাংকে নিশ্চিত করুন" দিন।' } : { configured: true }) }
      if (u.includes('rpc/da_settings')) return j(daSettings)
      if (u.includes('rpc/zm_dashboard')) return j({ period: { from: '2026-11-01', to: '2026-11-16' },
        workforce: { total: 30, active: 28, inactive: 2, new_joining: 1, resigned: 0, transferred: 0, employee_id_issued: 1, pending_applications: 0 },
        hubs: { hub_count: 2, pickups: 0, deliveries: 0, merchants: 0, rider_capacity: 0, cash_collected: 0, expenses: 0, pending_parcels: 0, unverified_days: 0 },
        data_completion: { employees: 30, incomplete: 0, average_pct: 100 }, tasks: { open: 0, overdue: 0, pending_submissions: 0, awaiting_confirmation: 0, completed: 0 },
        travel: { visits: 0, total_km: 0, fuel: 0, meal: 0, transport: 0, other: 0, total: 0, unclaimed: 0 }, claims_pending: 0 })
      if (u.includes('rpc/da_import_status')) return j([
        { hub_id: 'h5', hub_name: 'Gurudaspur (Natore)', zone_id: 'z1', zone_name: 'Natore', can_upload: true, reports: imported.length ? 1 : 0, managers: imported.length ? 1 : 0, lists: imported.length ? 8 : 0, parcels: imported.length ? 190 : 0,
          amount: imported.length ? 332438 : 0, delivery_charge: imported.length ? 230 : 0, unknown_riders: imported.length ? 1 : 0, last_at: imported.length ? '2026-11-16T14:40:00Z' : null },
        { hub_id: 'h2', hub_name: 'Lalpur', zone_id: 'z1', zone_name: 'Natore', can_upload: true, reports: 0, managers: 0, lists: 0, parcels: 0, amount: 0, delivery_charge: 0, unknown_riders: 0, last_at: null }])
      if (u.includes('rpc/da_import_save')) { imported.push(r.request().postDataJSON()); return j({ report_id: 'ir1', report_no: 744847, created: imported.length === 1, lists: 8, in_other_reports: 0 }) }
      if (u.includes('rpc/da_import_map_rider')) { flowCalls.push({ fn: 'da_import_map_rider', ...r.request().postDataJSON() }); return j(null) }
      if (u.includes('rpc/da_import_day')) return j(!imported.length ? [] : [{ hub_id: 'h5', hub_name: 'Gurudaspur (Natore)', manager_code: '6865', manager_name: 'Md. Rashed Miah', manager_known: true, delivery_charge: 230,
        last_at: '2026-11-16T14:40:00Z', lists: 8, parcels: 190, lists_amount: 332438, total: 332668,
        reports: [{ id: 'ir1', report_no: 744847, reported_at: '2026-11-16T20:37:00', collected: 332668, delivery_charge: 230, declared_lists: 8, declared_parcels: 190, upload_count: 1, uploaded_by_name: 'Owner', uploaded_at: '2026-11-16T14:40:00Z', counted_lists: 8 }],
        point: { parcels: 8, amount: 43490, lists: [{ list_no: 11440804, report_no: 744847, parcels: 8, amount: 43490 }] },
        riders: [{ rider_code: '27147', report_name: 'ASHIK UJJAMAN', employee_id: 'e1', name: 'Ashik Ujjaman', known: true, parcels: 31, amount: 77127, lists: [{ list_no: 11451749, report_no: 744847, parcels: 31, amount: 77127 }] },
          { rider_code: '44174', report_name: 'Md Sazib Ali', employee_id: null, name: 'Md Sazib Ali', known: false, parcels: 27, amount: 20789, lists: [{ list_no: 11450821, report_no: 744847, parcels: 27, amount: 20789 }] }] }])
      if (u.includes('rpc/da_flow_list')) return j([{ session_id: 's1', hub_id: 'h1', needed: 2, people: 2, submitted: 2, accepted: 2, checked_at: '2026-11-15T13:00:00Z', report_ok_at: null, report_diff: null, bank_done_at: null },
        { session_id: 's2', hub_id: 'h2', needed: 1, people: 2, submitted: 2, accepted: 1, checked_at: null, report_ok_at: null, report_diff: null, bank_done_at: null }])
      if (/rpc\/(da_close_part_for|da_close_my_part|da_parts_accept|da_check|da_report_ok|da_hub_collectors_set)/.test(u)) { flowCalls.push({ fn: u.split('rpc/')[1].split('?')[0], ...r.request().postDataJSON() }); return j({}) }
      if (u.includes('rpc/da_sheet_claims') || u.includes('rpc/da_my_claims') || u.includes('rpc/da_my_handovers') || u.includes('rpc/da_my_vehicles') || u.includes('rpc/da_collectors')) return j([])
      if (u.includes('rpc/da_sheet')) { const okd = r.request().postDataJSON()?.p_session === 's3'; return j({ can_edit: true, can_verify: true, can_reopen: false, can_layout: true,
        session: { id: 's2', no: 11, hub_id: 'h2', zone_id: 'z1', account_date: '2026-11-15', status: 'open', started_by: session.user.id, started_by_name: 'Owner', started_by_code: '1', started_at: '2026-11-15T03:00:00Z',
          submitted_by_name: null, submitted_by_code: null, submitted_at: null, submit_note: null, submit_count: 0, verified_by_name: null, verified_at: null, verify_note: null, last_saved_at: '2026-11-15T05:00:00Z', closed_at: okd ? '2026-11-15T13:00:00Z' : null, closed_by: null,
          closed_totals: okd ? { khatas: 1, riders: 1, rider_amount: 38500, collected: 38000, due: 500, mobile_banking: 2000, payments: 0, payment_amount: 0, expenses: 1, expense_amount: 450, notes_in: 0 } : null,
          check_note: okd ? 'একজন ছুটিতে' : null, check_done: okd ? 1 : null, check_needed: okd ? 2 : null,
          report_ok_at: okd ? '2026-11-15T14:00:00Z' : null, report_ok_by_name: okd ? 'Owner' : null, report_total: okd ? 38000 : null, report_diff: okd ? -500 : null, check_left: okd ? 'Sohel Rana' : null, report_note: okd ? 'একটি পার্সেল পরের রিপোর্টে' : null },
        hub: { id: 'h2', code: 'BGT', name: 'Bagatipara', name_bn: null }, zone: { id: 'z1', code: 'NAT', name: 'Natore Area' },
        riders: [{ id: 'r1', no: 1, employee_id: 'e02', employee_code: '1002', rider_name: 'Rahim Uddin', mobile: '01711000002', delivery_qty: 42, pickup_qty: 6, amount: 38500, paid_amount: 38000, due_input: 500, due: 500, mobile_banking: 0, remarks: null, created_by: 'u1' },
          { id: 'r2', no: 2, employee_id: 'e03', employee_code: '1003', rider_name: 'Sohel Rana', mobile: null, delivery_qty: 35, pickup_qty: 4, amount: 29800, paid_amount: 29800, due_input: 0, due: 0, mobile_banking: 2000, remarks: 'সব জমা', created_by: 'u7' }],
        merchant_payments: [], notes_in: [], events: [], visits: [], cells: [],
        deposits: okd ? [] : [{ id: 'dp1', no: 1, method: 'bank', bank_name: 'DBBL', amount: 37550, charge: 23, charge_auto: true, transport: 50, people: 'Owner', ref_no: 'R-1', slip_path: 'da/s2/slip.jpg', deposited_on: '2026-11-15', remarks: null, created_by: 'u1', created_at: '2026-11-15T13:00:00Z',
          slip_uploaded_at: '2026-11-15T13:05:00Z', slip_uploaded_by_name: 'Owner', slip_ocr_amount: 35750, slip_ocr_confidence: 88, slip_match: 'not_match', bank_confirmed_at: null, bank_confirmed_by_name: null, bank_confirm_note: null }],
        collectors: [{ user_id: 'u1', name: 'Owner', code: '1', closed_at: mineOpen ? null : '2026-11-15T10:00:00Z', created_at: '2026-11-15T03:00:00Z', note: null, riders: 1, payments: 0, expenses: 1, amount: 38500, expense_amount: 450, payment_amount: 0,
            closed_by: null, closed_by_name: null, accepted_at: mineOpen ? null : '2026-11-15T11:00:00Z', accepted_by: 'u1', accepted_by_name: 'Owner' },
          { user_id: 'u7', name: 'Sohel Rana', code: '1003', closed_at: '2026-11-15T10:30:00Z', created_at: '2026-11-15T04:00:00Z', note: null, riders: 1, payments: 0, expenses: 0, amount: 29800, expense_amount: 0, payment_amount: 0,
            closed_by: null, closed_by_name: null, accepted_at: null, accepted_by: null, accepted_by_name: null }],
        report_ids: [{ id: 'rp1', no: 1, report_no: '#743858', amount: 38000, remarks: null, created_by: 'u1', created_at: '2026-11-15T12:00:00Z' }],
        expenses: [{ id: 'x1', no: 1, kind: 'transport', employee_id: null, employee_code: null, employee_name: null, expense_name: 'অটো ভাড়া', category: 'transport', amount: 450, bill_date: '2026-11-15', bill_no: null, reference_no: 'EXP-1',
          attachment_path: 'h2/bill-1.jpg', paid_by_name: 'Owner', template_id: null, ocr: null, ocr_verified: false, remarks: null, voucher_no: null, vehicle_id: null, reference_name: null, reference_phone: null, reference_position: null, claim_id: null, claim_file: null, created_by: 'u1' }],
        totals: { riders: 2, delivery: 77, pickup: 10, amount: 68300, paid: 67800, due: 500, mobile_banking: 2000, merchant_cash: 0, transport_expense: 450, employee_expense: 0 } }) }
      if (u.includes('rpc/da_page_enter')) return j('v1')
      if (u.includes('rpc/da_my_accounts')) return j({ notes: [], employee: { id: 'e01', code: '1001', name: 'Owner', hub_id: 'h1' }, my_expenses: [], my_payments: [],
        my_lines: [{ account_date: '2026-11-15', hub: 'Bagatipara', status: 'open', verify_note: null, line: { id: 'r1', no: 1, employee_id: 'e01', employee_code: '1001', rider_name: 'Owner', mobile: null, delivery_qty: 42, pickup_qty: 6, amount: 38500, paid_amount: 38000, due_input: 500, due: 500, mobile_banking: 0, remarks: null } }],
        my_sheets: [{ id: 's2', no: 11, hub: 'Bagatipara', status: 'open', verified_at: null, verify_note: null, account_date: '2026-11-15', submitted_at: null, started_by_me: true, submitted_by_me: null, verified_by_name: null }] })
      if (u.includes('rpc/da_my_hubs')) return j([['h1', 'Natore Sadar'], ['h2', 'Bagatipara'], ['h3', 'Singra'], ['h4', 'Lalpur']].map(([hub_id, name]) => ({ hub_id, code: hub_id, name, name_bn: null, zone_id: 'z1', zone_name: 'Natore Area', can_view: true, can_submit: true, can_verify: true })))
      if (u.includes('rpc/da_dashboard')) return j({ today: '2026-11-15', sheets: 3, open: 1, submitted: 1, pending_verification: 1, correction: 0, approved: 1, riders: 9, delivery: 360, pickup: 42, amount: 285300, due: 1200, mobile_banking: 5000, merchant_cash: 0, expense: 1350 })
      if (u.includes('rpc/da_list_sessions')) return j([{ id: 's1', no: 10, hub_id: 'h1', hub_name: 'Natore Sadar', zone_id: 'z1', zone_name: 'Natore Area', account_date: '2026-11-15', status: 'submitted', started_by_name: 'Owner', started_at: '2026-11-15T03:00:00Z', submitted_by_name: 'Abdul Karim', submitted_at: '2026-11-15T12:00:00Z', verified_by_name: null, verified_at: null, riders: 3, delivery: 120, pickup: 14, amount: 100700, due: 1200, mobile_banking: 0, merchant_cash: 0, expense: 450 }, { id: 's2', no: 11, hub_id: 'h2', hub_name: 'Bagatipara', zone_id: 'z1', zone_name: 'Natore Area', account_date: '2026-11-15', status: 'open', started_by_name: 'Owner', started_at: '2026-11-15T03:00:00Z', submitted_by_name: null, submitted_at: null, verified_by_name: null, verified_at: null, riders: 3, delivery: 120, pickup: 14, amount: 68300, due: 0, mobile_banking: 0, merchant_cash: 0, expense: 450 }, { id: 's3', no: 12, hub_id: 'h3', hub_name: 'Singra', zone_id: 'z1', zone_name: 'Natore Area', account_date: '2026-11-15', status: 'approved', started_by_name: 'Owner', started_at: '2026-11-15T03:00:00Z', submitted_by_name: 'Abdul Karim', submitted_at: '2026-11-15T12:00:00Z', verified_by_name: null, verified_at: null, riders: 3, delivery: 120, pickup: 14, amount: 116300, due: 0, mobile_banking: 0, merchant_cash: 0, expense: 450 }])
      if (u.includes('rpc/da_start_session')) { started.push(r.request().postDataJSON()); return j('s9') }
      if (u.includes('rpc/issue_detail')) return j({ parcel: null, issue: { id: 'i2', issue_no: 'IS-00010', title: 'কাস্টমার ফোন ধরছে না', kind: 'parcel', priority: 'normal', status: 'in_progress', status_bn: 'কাজ চলছে',
          hub_id: 'h1', hub: 'Natore Sadar', parcel_ref: null, assignee: 'Owner', assignee_code: '1', assigned_by_name: 'Hub Manager', body: 'তিনবার ফোন দেওয়া হয়েছে', photo_path: null, solve_photo: null, solved_note: null, approve_note: null },
        events: [{ id: 'v1', action: 'created', note: 'তিনবার ফোন দেওয়া হয়েছে', by_name: 'Hub Manager', at: '2026-11-15T05:00:00Z' }, { id: 'v2', action: 'assigned', note: 'Owner (1)', by_name: 'Hub Manager', at: '2026-11-15T05:00:01Z' },
          { id: 'v3', action: 'started', note: null, by_name: 'Owner', at: '2026-11-15T05:30:00Z' }] })
      if (u.includes('rpc/issue_act')) { acted.push(r.request().postDataJSON()); return j(null) }
      if (u.includes('rpc/hub_post_create')) { posted.push(r.request().postDataJSON()); return j('p9') }
      if (u.includes('rpc/hub_feed')) return j([
        { id: 'p2', author_name: 'Owner', is_nodi: false, mine: true, kind: 'text', body: 'আজ সব ডেলিভারি শেষ করুন', photo_path: null, created_at: '2026-11-15T06:00:00Z', issue: null, reactions: { '👍': { n: 2, mine: false } }, seen_count: 5, seen_by_me: true },
        { id: 'p1', author_name: 'Rahim Uddin', is_nodi: false, mine: false, kind: 'text', body: 'ভাই টেপ শেষ', photo_path: null, created_at: '2026-11-15T05:00:00Z', issue: null, reactions: {}, seen_count: 3, seen_by_me: false }])
      if (u.includes('rpc/issue_create')) { created.push(r.request().postDataJSON()); return j('i1') }
      if (u.includes('/storage/v1/object/')) return j({ Key: 'issue-photos/h1/label.png', Id: '1' })
      if (u.includes('/functions/v1/admin-users')) { accounts.push(r.request().postDataJSON()); return j({ ok: true, user_id: `u${accounts.length}` }) }
      if (u.includes('rpc/rollout_progress')) return j([{ hub_id: 'h1', hub_name: 'Natore Sadar', zone_id: 'z1', staff: 33, with_login: 20, signed_in: 12, password_set: 9, with_mobile: 4 },
        { hub_id: 'h2', hub_name: 'Lalpur', zone_id: 'z1', staff: 15, with_login: 0, signed_in: 0, password_set: 0, with_mobile: 0 }])
      if (u.includes('rpc/rollout_people')) return j([
        { employee_id: 'e00', employee_code: '1000', full_name: 'Staff 00', position_name: 'Rider', role_name: 'Rider', has_login: true, signed_in_at: '2026-11-15T03:00:00Z', password_set: true, mobile: '01711000000' },
        { employee_id: 'e01', employee_code: '1001', full_name: 'Staff 01', position_name: 'Rider', role_name: 'Rider', has_login: true, signed_in_at: null, password_set: false, mobile: null },
        { employee_id: 'e02', employee_code: '1002', full_name: 'Staff 02', position_name: 'Rider', role_name: null, has_login: false, signed_in_at: null, password_set: false, mobile: null }])
      if (u.includes('rpc/my_att_gap_answer')) { answered.push(r.request().postDataJSON()); return j(3) }
      if (u.includes('rpc/my_att_gaps')) return j(withGaps ? [
        { work_date: '2026-11-05', answer_id: null, kind: null, note: null, status: 'waiting', leave_status: null, check_note: null },
        { work_date: '2026-11-09', answer_id: null, kind: null, note: null, status: 'waiting', leave_status: null, check_note: null },
        { work_date: '2026-11-12', answer_id: 'a9', kind: 'worked', note: 'x', status: 'returned', leave_status: null, check_note: 'আসেননি' }] : [])
      if (u.includes('rpc/att_gap_check')) { checked.push(r.request().postDataJSON()); return j(1) }
      if (u.includes('rpc/att_gap_remind')) return j(2)
      if (u.includes('rpc/att_gap_report')) return j([
        { employee_id: 'e00', employee_code: '1000', full_name: 'Staff 00', position_name: 'Rider', hub_id: 'h1', hub_name: 'Natore Sadar', has_login: true, work_date: '2026-11-05', answer_id: null, kind: null, note: null, status: 'waiting', leave_status: null, check_note: null },
        { employee_id: 'e00', employee_code: '1000', full_name: 'Staff 00', position_name: 'Rider', hub_id: 'h1', hub_name: 'Natore Sadar', has_login: true, work_date: '2026-11-09', answer_id: 'a1', kind: 'leave', note: 'জ্বর', status: 'answered', leave_status: 'pending', check_note: null },
        { employee_id: 'e01', employee_code: '1001', full_name: 'Staff 01', position_name: 'Rider', hub_id: 'h2', hub_name: 'Lalpur', has_login: false, work_date: '2026-11-09', answer_id: null, kind: null, note: null, status: 'waiting', leave_status: null, check_note: null },
        { employee_id: 'e02', employee_code: '1002', full_name: 'Staff 02', position_name: 'Rider', hub_id: 'h2', hub_name: 'Lalpur', has_login: true, work_date: '2026-11-10', answer_id: 'a2', kind: 'other', note: 'হাব বন্ধ', status: 'verified', leave_status: null, check_note: null }])
      if (u.includes('rpc/hr_export_rows')) { exported.push(r.request().postDataJSON()); return j([
        { _id: 'e02', employee_code: '1002', full_name: 'Rahim Uddin', mobile: '01711000002', hub_name: 'Natore Sadar', position_name: 'Rider', basic_salary: 9000, transport_allowance: 1500, commission: 12, 'cf:blood_group': 'B+', date_of_birth: '1998-03-05' },
        { _id: 'e01', employee_code: '1001', full_name: 'Abdul Karim', mobile: null, hub_name: 'Bagatipara', position_name: 'Manager', basic_salary: 18000 }]) }
      if (u.includes('rpc/hr_remove_wrong_entry')) { removed.push(r.request().postDataJSON()); return j(null) }
      if (u.includes('rpc/hr_correct_employee_code')) { recoded.push(r.request().postDataJSON()); return j('5555') }
      if (u.includes('rpc/my_mobile_set')) { mobiles.push(r.request().postDataJSON()); return j('01711000000') }
      if (u.includes('rpc/my_employee_id')) return j(asEmployee ? 'e01' : null)
      if (u.includes('rpc/office_log_export')) { officeLogs.push(r.request().postDataJSON()); return j(null) }
      if (u.includes('/rpc/')) return j(null)
      if (u.includes('/rest/v1/leave_types')) return j([{ id: 'lt1', code: 'CL', name: 'Casual leave', name_bn: 'নৈমিত্তিক ছুটি', is_paid: true, annual_quota: 10, status: 'active' }])
      if (u.includes('/rest/v1/leave_requests') && u.includes('status=eq.approved')) return j([{ employee_id: 'e03' }])
      // two of them sit in another hub, so the list has a column a remembered filter could narrow
      if (u.includes('/rest/v1/employees') && u.includes('limit=60')) return j(staffRows.slice(0, 3))
      if (u.includes('/rest/v1/employees') && u.includes('limit=2000') && r.request().method() === 'GET' && !u.includes('profile_id=is.null')) return j(staffRows.map((e, i) => ({ ...e, zone_id: 'z1', hub_id: i >= 10 ? 'h1' : e.hub_id,
        full_name_bn: null, email: null, department_id: 'd1', joining_date: '2026-01-01', status_since: '2026-01-01', archived_at: null, profile_id: null, reporting_manager_id: null,
        emergency_contact_name: null, emergency_contact_phone: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })))
      if (u.includes('/rest/v1/employees') && u.includes('profile_id=is.null')) return j([...staffRows.map(e => ({ ...e, zone_id: 'z1' })),
        { id: 'e99', employee_code: null, full_name: 'No ID Yet', mobile: null, hub_id: 'h2', zone_id: 'z1', position_id: 'p1' }])
      if (u.includes('/rest/v1/employees') && u.includes('id=eq.e01')) return j([{ ...staffRows[1], mobile: null, full_name_bn: null, joining_date: '2026-01-01', department_id: 'd1', zone_id: 'z1' }])
      if (u.includes('/rest/v1/zones')) return j([{ id: 'z1', name: 'Natore Area', code: 'NT', archived_at: null }])
      if (u.includes('/rest/v1/hubs')) return j(hubRows)
      if (u.includes('/rest/v1/positions')) return j([{ id: 'p1', department_id: 'd1', code: 'rider', name: 'Rider', name_bn: null, status: 'active', archived_at: null, default_role_id: 'r3' }])
      if (u.includes('/rest/v1/employees') && u.includes('mobile=eq.01711000000')) return j([{ id: 'e01', employee_code: '1001', full_name: 'Staff 01', status: 'active', hub_id: 'h2' }])
      if (u.includes('/rest/v1/employees') && u.includes('hub_id=eq.h2') && r.request().method() === 'GET') return j(staffRows)
      if (u.includes('/rest/v1/issues') && u.includes('DUP123456')) return j([{ id: 'i9', issue_no: 'IS-0009', title: 'x', status: 'open' }])
      // আমার অফিস / আবাসিক: one office and two residences, three people in a flat for two, one rent recorded this month
      if (u.includes('/rest/v1/office_properties') && r.request().method() === 'PATCH') { officePatches.push({ u, body: r.request().postDataJSON() }); return j(null) }
      if (u.includes('/rest/v1/office_properties') && u.includes('archived_at=not.is.null')) return j([officeGone])
      if (u.includes('/rest/v1/office_properties')) return j(officePlaces)
      if (u.includes('/rest/v1/office_residents')) return j(officeResidents)
      if (u.includes('/rest/v1/office_bills')) return j(officeBills)
      if (u.includes('/rest/v1/office_assets') && r.request().method() === 'GET') return j(officeAssets.filter(a => !u.includes('property_id=eq.') || u.includes('property_id=eq.' + a.property_id)))
      return j([])
    })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e)))
    // The app asks with its own boxes (components/ask.tsx); a browser prompt / confirm / alert is a mistake.
    const nativeDialogs = []; page.on('dialog', d => { nativeDialogs.push(`${d.type()}: ${d.message().slice(0, 60)}`); void d.accept() })
    const fits = async where => check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${size}: ${where} does not scroll sideways`)

    await page.goto(`${BASE}/app`); await page.waitForSelector('.da-main h1', { state: 'attached' })
    check((await page.locator('.da-main h1').textContent()).includes('হোম') && (await page.locator('.greet h2').textContent()).includes('Owner'), `${size}: dashboard opens (title হোম, name in the greeting)`); await fits('dashboard')
    // আমার অনুমোদন: riders' pickup, delivery and money, and staff bills, on one card
    await page.waitForSelector('.myapp .ri-list li', { timeout: 8000 }).catch(() => {})
    { const sumTxt = (await page.locator('.myapp .ma-sum').innerText()).replace(/\s+/g, ' ')
      check(await page.locator('.myapp').count() === 1 && await page.locator('.myapp .ri-list li[data-kind=rider]').count() === 2
        && sumTxt.includes('৪') && sumTxt.includes('২৯') && sumTxt.includes('৳৫৮৫০') && sumTxt.includes('৳২০০'),
        `${size}: my approvals shows pickups, deliveries, rider money and staff bills together`) }
    check(await page.locator('.rsend').count() === 0, `${size}: someone who is not a rider gets no send card`)
    await fits('my approvals')
    if (process.env.SHOTS) await page.locator('.myapp').screenshot({ path: `${process.env.SHOTS}/${size}-my-approvals.png` })
    await page.locator('.myapp .ma-all button').click(); await page.waitForSelector('.myapp .rs-done', { timeout: 8000 }).catch(() => {})
    check(flowCalls.some(c => c.fn === 'da_rider_accept_all' && c.p_session === 's2') && await page.locator('.myapp .ri-list li[data-kind=rider]').count() === 0,
      `${size}: accept all takes every rider line in one tap`)
    await page.locator('.myapp .ma-tabs button', { hasText: 'খরচের বিল' }).click(); await page.waitForSelector('.myapp .ri-list li[data-kind=bill]')
    if (process.env.SHOTS) await page.locator('.myapp').screenshot({ path: `${process.env.SHOTS}/${size}-my-approvals-bills.png` })
    await page.locator('.myapp .ri-list li[data-kind=bill]').first().locator('.ri-acts button').first().click()
    await page.waitForFunction(() => document.querySelectorAll('.myapp .ri-list li[data-kind=bill]').length === 1, null, { timeout: 8000 }).catch(() => {})
    check(flowCalls.some(c => c.fn === 'da_claim_add' && c.p_claim === 'c1' && c.p_session === 's9') && started.length > 0,
      `${size}: accepting a bill opens today's khata when needed and takes the bill in`)
    await page.locator('.myapp .ri-list li[data-kind=bill] .ri-acts button.secondary').click()
    await page.locator('.myapp .ri-back input').fill('বিল ঝাপসা')
    await page.locator('.myapp .ri-back button.secondary').click(); await page.waitForSelector('.myapp .ap-clear', { timeout: 8000 }).catch(() => {})
    check(flowCalls.some(c => c.fn === 'da_claim_reject' && c.p_claim === 'c2' && c.p_note === 'বিল ঝাপসা') && await page.locator('.myapp .ap-clear').count() === 1,
      `${size}: a bill is turned down with the reason, and the card says all clear`)

    // ---- হিসাব শেখার কেন্দ্র: lessons, practice (nothing saved), AI teacher ----
    await page.goto(`${BASE}/app/accounts/learn`); await page.waitForSelector('.lr-card')
    check(await page.locator('.lr-card').count() === 14 && await page.locator('.lr-official').count() === 1 && await page.locator('.lr-teacher').count() === 1,
      `${size}: the learning centre lists every lesson, the official-rules box and the AI teacher`)
    await fits('learning centre')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-learn.png`, fullPage: false })
    await page.locator('.lr-card[data-module=bank]').click(); await page.waitForSelector('.lr-lesson[data-lesson=bank]')
    { const parts = await page.locator('.lr-parts button').allInnerTexts()
      check(['কীভাবে কাজ করবেন?', 'ধাপে ধাপে নির্দেশনা', 'নমুনা হিসাব', 'প্রয়োজনীয় কাগজপত্র', 'সাধারণ ভুল', 'অনুশীলন', 'AI-কে প্রশ্ন করুন'].every(p => parts.includes(p)),
        `${size}: a lesson has how, steps, sample, papers, mistakes, practice and ask-the-AI`) }
    await page.locator('.lr-parts button', { hasText: 'ধাপে ধাপে' }).click()
    check(await page.locator('.lr-steps li').count() >= 4 && await page.locator('.lr-field').count() >= 4, `${size}: steps and every field explained with an example`)
    await page.locator('.lr-parts button', { hasText: 'অনুশীলন' }).click(); await page.waitForSelector('.pr-banner')
    { const before = flowCalls.length
      const inputs = page.locator('.pr-task .pr-grid input')
      await inputs.nth(0).fill('97450'); await inputs.nth(1).fill('97450'); await inputs.nth(2).fill('92')
      const m1 = await page.locator('.pr-match b').innerText()
      await inputs.nth(1).fill('94750'); const m2 = await page.locator('.pr-match b').innerText()
      await inputs.nth(1).fill(''); await inputs.nth(2).fill('20'); const m3 = await page.locator('.pr-match').count() ? await page.locator('.pr-match b').innerText() : ''
      await inputs.nth(1).fill('97450'); await inputs.nth(2).fill('30'); const m4 = await page.locator('.pr-match b').innerText()
      await page.locator('.pr-task button', { hasText: 'ব্যাংকে নিশ্চিত করুন' }).click()
      check(m1.startsWith('MATCH') && m2.startsWith('NOT MATCH') && m4.startsWith('NEEDS REVIEW') && flowCalls.length === before,
        `${size}: bank practice shows MATCH / NOT MATCH / NEEDS REVIEW and saves nothing${m3 ? '' : ''}`) }
    if (process.env.SHOTS) await page.locator('.lr-lesson').screenshot({ path: `${process.env.SHOTS}/${size}-learn-practice.png` })
    await page.locator('.lr-parts button', { hasText: 'AI-কে প্রশ্ন' }).click(); await page.locator('.lr-t-sugg button').first().click()
    await page.waitForSelector('.lr-t-msg.assistant:not(.muted)', { timeout: 8000 }).catch(() => {})
    { const c = flowCalls.filter(x => x.fn === 'nodi-ai').at(-1) ?? {}
      check(c.action === 'teach' && c.module === 'bank' && String(c.guide ?? '').includes('ব্যাংকে জমা') && !('official' in c)
        && (await page.locator('.lr-t-msg.assistant').last().innerText()).includes('নদী AI অভ্যন্তরীণ নির্দেশনা'),
        `${size}: the AI teacher gets the lesson as its internal guide (official rules are read by the server) and answers in Bangla`) }
    if (process.env.SHOTS) await page.locator('.lr-lesson').screenshot({ path: `${process.env.SHOTS}/${size}-learn-teacher.png` })
    // expense practice: automatic sorting and the checks
    await page.goto(`${BASE}/app/accounts/learn?m=expense&p=practice`); await page.waitForSelector('.pr-banner')
    { const g = page.locator('.pr-task .pr-grid'); await g.locator('input').nth(0).fill('ভ্যান ভাড়া'); await g.locator('select').selectOption('transport'); await g.locator('input').nth(1).fill('120')
      const sortTxt = await page.locator('.pr-sort').innerText()
      await page.locator('.pr-task button', { hasText: 'মিলিয়ে দেখুন' }).click()
      check(sortTxt.includes('ভাউচার জমা হয়নি') && await page.locator('.pr-result.ok').count() === 1, `${size}: expense practice sorts the expense and checks the answer`) }

    // ---- হিসাব কেন্দ্র ----
    await page.goto(`${BASE}/app/accounts/center`); await page.waitForSelector('.ac-hub')
    check(await page.locator('.ac-tile').count() === 11 && await page.locator('.ac-hub').count() === 2 && (await page.locator('.ac-hub').first().innerText()).includes('NOT MATCH'),
      `${size}: the accounts centre shows the 11 parts and each hub's report, bank and slip status`)
    await fits('accounts centre')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-center.png`, fullPage: false })
    await page.locator('.ac-tabs button', { hasText: 'ভাউচার জমা হয়নি' }).click(); await page.waitForSelector('.da-table tbody tr')
    check((await page.locator('.da-table tbody').innerText()).includes('V-2611-00007') && (await page.locator('.da-table tbody').innerText()).includes('ভাউচার জমা হয়নি'),
      `${size}: missing vouchers are listed and sorted automatically`)
    await page.locator('.ac-tabs button', { hasText: 'হিসাবের ইতিহাস' }).click(); await page.waitForSelector('.ac-hist li')
    check((await page.locator('.ac-hist').innerText()).includes('৩৮০০০') || (await page.locator('.ac-hist').innerText()).includes('38000'), `${size}: the history shows the old and the new value`)
    await page.locator('.ac-tabs button', { hasText: 'নতুন ভাউচার' }).click(); await page.waitForSelector('.ac-new')
    { const f = page.locator('.ac-new .pr-grid')
      await f.locator('input').nth(2).fill('ভ্যান ভাড়া (হাব থেকে ব্যাংক)'); await f.locator('select').nth(1).selectOption('transport'); await f.locator('input').nth(3).fill('120')
      await page.locator('.ac-new button', { hasText: 'ভাউচার বানান' }).click(); await page.waitForSelector('.ac-made', { timeout: 8000 }).catch(() => {})
      const save = flowCalls.filter(x => x.fn === 'da_save_expense').at(-1) ?? {}
      check(flowCalls.some(x => x.fn === 'da_make_voucher' && x.p_expense === 'x9') && save.p_kind === 'transport' && save.p_amount === 120 && save.p_category === 'transport'
        && (await page.locator('.ac-made').innerText()).includes('V-2611-00009'), `${size}: a new voucher makes the expense line and its number`) }
    if (process.env.SHOTS) await page.locator('.ac-new').screenshot({ path: `${process.env.SHOTS}/${size}-new-voucher.png` })
    // the sheet's bank part: OCR status, who gave the slip, and a person confirms (a note when it did not match)
    await page.goto(`${BASE}/app/accounts/daily/s2?tab=bank`); await page.waitForSelector('#sec-deposits .dp-check', { timeout: 10000 }).catch(() => {})
    check((await page.locator('#sec-deposits .dp-check').innerText()).includes('NOT MATCH') && (await page.locator('#sec-deposits .dp-check').innerText()).includes('Owner')
      && await page.locator('.lr-sec .lr-btn').count() === 1, `${size}: the bank part shows the slip check, who gave it, and the instruction button`)
    await page.locator('#sec-deposits .dp-check button', { hasText: 'ব্যাংকে নিশ্চিত করুন' }).click(); await page.waitForSelector('.da-modal textarea')
    { const ok = page.locator('.da-modal-acts button', { hasText: 'নিশ্চিত করছি' })
      const blocked = await ok.isDisabled()
      await page.locator('.da-modal textarea').fill('ব্যাংকের মেসেজে ৩৭,৫৫০ দেখেছি'); await ok.click()
      await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
      const c = flowCalls.filter(x => x.fn === 'da_deposit_confirm').at(-1) ?? {}
      check(blocked && c.p_deposit === 'dp1' && c.p_confirm === true && String(c.p_note).includes('৩৭,৫৫০'), `${size}: a slip that did not match is confirmed only with the person's note`) }
    await page.locator('.lr-sec .lr-btn').click(); await page.waitForSelector('.da-modal .lr-lesson[data-lesson=bank]')
    check(await page.locator('.da-modal .lr-parts button').count() === 7, `${size}: the instruction button opens the lesson of that part`)
    if (process.env.SHOTS) await page.locator('.da-modal').screenshot({ path: `${process.env.SHOTS}/${size}-sheet-lesson.png` })
    // accessibility: the dialog has a name, focus is inside it, Tab cannot leave it, Esc closes it and focus returns to the button
    { const inside = () => page.evaluate(() => !!document.activeElement?.closest('.da-modal'))
      const named = await page.evaluate(() => { const d = document.querySelector('.da-modal[role=dialog]'); const id = d?.getAttribute('aria-labelledby'); return !!(id && document.getElementById(id)?.textContent?.trim()) })
      const first = await inside()
      for (let i = 0; i < 25; i++) await page.keyboard.press('Tab')
      const trapped = await inside()
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 5000 }).catch(() => {})
      const back = await page.evaluate(() => !!document.activeElement?.matches('.lr-btn'))
      check(named && first && trapped && back, `${size}: a dialog is named, takes focus, keeps Tab inside, closes with Esc and gives focus back`) }

    await page.goto(`${BASE}/app/settings`); await page.waitForSelector('.font-pick')
    check(await page.locator('.font-pick button').count() === 5, `${size}: settings shows the font choices`); await fits('settings')
    // accessibility: the first Tab reaches the skip link; text size, contrast and motion choices apply to the whole page and are remembered
    { await page.evaluate(() => document.activeElement?.blur?.())
      await page.keyboard.press('Tab')
      check(await page.evaluate(() => !!document.activeElement?.matches('.skip-link')), `${size}: the first Tab shows "skip to main content"`)
      const px = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
      const base = await px()
      await page.locator('.a11y-sizes button').nth(2).click()
      const big = await px(), mark = await page.evaluate(() => [document.documentElement.dataset.text, localStorage.getItem('xzm_text')].join())
      await fits('settings with larger text')
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-settings-large-text.png`, fullPage: true })
      await page.locator('.a11y-sizes button').nth(0).click()
      check(base === 16 && big === 20 && mark === 'xl,xl' && await px() === 16, `${size}: the text size setting makes all text bigger and back`)
      await page.locator('.a11y-row').nth(0).locator('button').nth(1).click()
      await page.locator('.a11y-row').nth(1).locator('button').nth(1).click()
      const on = await page.evaluate(() => [document.documentElement.dataset.contrast, document.documentElement.dataset.motion].join())
      await page.locator('.a11y-row').nth(0).locator('button').nth(0).click(); await page.locator('.a11y-row').nth(1).locator('button').nth(0).click()
      const off = await page.evaluate(() => [document.documentElement.dataset.contrast ?? '', document.documentElement.dataset.motion ?? ''].join())
      check(on === 'more,reduce' && off === ',', `${size}: stronger contrast and less motion switch on and off`) }

    // view as a role, then back
    const menu = () => page.locator('aside .nl').count()
    const before = await menu()
    await page.locator('.hub-link.as-btn', { hasText: /রোল|role/i }).first().click()
    await page.getByText('Hub Manager').first().click(); await page.waitForSelector('.viewas-bar')
    check(await menu() < before, `${size}: viewing as a role narrows the menu`)
    await page.locator('.viewas-bar button').last().click()
    await page.waitForFunction(n => document.querySelectorAll('aside .nl').length === n, before, { timeout: 5000 }).catch(() => {})
    check(await menu() === before, `${size}: leaving the role view restores the menu`)

    // the shared list: search, sort, filter, pages, views, remembered choice
    await page.goto(`${BASE}/app/zonal/files`)
    await page.locator('.emp-tabs button').nth(1).click(); await page.waitForSelector('.da-table tbody tr')
    const rows = () => page.locator('.da-table tbody tr').count()
    check(await rows() === 50, `${size}: list shows the first page of 50 rows`); await fits('list (table view)')
    await page.locator('.dv-pager button').last().click()
    check(await rows() === 10, `${size}: next page shows the remaining 10 rows`)
    await page.locator('.dv-search').fill('Staff 07')
    check(await rows() === 1, `${size}: search narrows the list to one row`)
    await page.locator('.dv-search').fill('')
    await page.locator('.dv-fbtn').click()
    const f1 = page.locator('.dv-filters .cb').first()
    await f1.locator('input').click(); await f1.locator('[role=option]').first().click()
    const one = await page.locator('.list-tools .cnt b').innerText()
    check(one !== '60' && one !== '৬০', `${size}: a quick filter narrows the list (${one})`)
    await f1.locator('[role=option]').nth(1).click()
    const two = await page.locator('.list-tools .cnt b').innerText()
    check(two !== one, `${size}: a second value in the same filter widens it (${two})`)
    await page.keyboard.press('Escape')
    await page.locator('.dv-filters button.link').click()
    // on a phone the views and the print / file buttons each sit behind one button
    const tool = async (i, sel) => { const b = page.locator('.list-tools .tool-menu-btn').nth(i); if (await b.isVisible()) await b.click(); await sel.click() }
    if (size === 'phone') { check(await page.locator('.list-tools .tool-menu-btn:visible').count() === 2 && await page.locator('.list-tools .tb:visible').count() === 0, `${size}: the list tools fold into two buttons`)
      await page.locator('.list-tools .tool-menu-btn').nth(1).click()
      check(await page.locator('.list-tools .tool-menu.open .tb:visible').count() >= 1, `${size}: "print & file" opens mark, print and the files`); await page.keyboard.press('Escape') }
    await tool(0, page.locator('.list-tools [aria-pressed]').nth(1)); await page.waitForSelector('.dv-card')
    check(await page.locator('.dv-card').count() === 50, `${size}: card view shows the same rows`); await fits('list (card view)')
    await tool(0, page.locator('.list-tools [aria-pressed]').nth(2)); await page.waitForSelector('.dv-list li')
    check(await page.locator('.dv-list li').count() === 50, `${size}: list view shows the same rows`); await fits('list (list view)')
    await page.reload(); await page.locator('.emp-tabs button').nth(1).click(); await page.waitForSelector('.dv-list li, .da-table tbody tr')
    check(await page.locator('.dv-list li').count() === 50, `${size}: the chosen view is remembered after reload`)
    await tool(0, page.locator('.list-tools [aria-pressed]').nth(0))
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-list.png` })

    // new issue from a label picture: choose the picture, the form keeps working when the ID cannot be read, the issue is created with the picture
    await page.goto(`${BASE}/app/issues?new=1`); await page.waitForSelector('.is-drop')
    check(await page.locator('.is-drop').count() === 1, `${size}: the issue shortcut opens the label form`)
    await page.locator('.is-drop .is-file').setInputFiles({ name: 'label.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
    await page.waitForSelector('.is-drop img')
    await page.waitForFunction(() => /পড়া যায়নি|মিলিয়ে নিন/.test(document.querySelector('.is-drop-acts [role=status]')?.textContent ?? ''), null, { timeout: 40000 }).catch(() => {})
    check(/পড়া যায়নি|মিলিয়ে নিন/.test(await page.locator('.is-drop-acts [role=status]').innerText()), `${size}: the form says whether an ID was read from the picture`)
    const parcel = page.locator('.da-modal .da-form input').first()
    await parcel.fill('DUP123456'); await page.waitForSelector('.da-modal .dup-note', { timeout: 5000 }).catch(() => {})
    check(await page.locator('.da-modal .dup-note').count() === 1, `${size}: a parcel that already has an open issue is flagged`)
    await parcel.fill('TEST123456'); await fits('new issue form')
    // searchable, dependent dropdowns: hub first, then the people of that hub
    const pickers = page.locator('.da-modal .pp .cb')
    check(await page.locator('.da-modal .pp .da-field.wide select, .da-modal .pp .da-field.wide input').first().isDisabled(), `${size}: the name list waits until a hub is chosen`)
    await pickers.nth(0).locator('input').click(); await page.keyboard.type('lal')
    check(await pickers.nth(0).locator('[role=option]').count() === 1, `${size}: typing in the hub dropdown searches it`)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => { const i = document.querySelectorAll('.da-modal .pp .cb input')[1]; return !!i && !i.disabled }, null, { timeout: 5000 }).catch(() => {})
    await pickers.nth(1).locator('input').click()
    if (process.env.SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${process.env.SHOTS}/${size}-combo.png` }) }
    await page.keyboard.type('1007'); await page.keyboard.press('Enter')
    check((await page.locator('.da-modal .pp-card').innerText().catch(() => '')).includes('Staff 07'), `${size}: a person is found by ID in the dependent dropdown`)
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-issue.png` })
    await page.locator('.da-modal-acts button').first().click()
    await page.waitForFunction(() => !document.querySelector('.is-drop'), null, { timeout: 8000 }).catch(() => {})
    check(created.length === 1 && created[0].p_parcel_ref === 'TEST123456' && !!created[0].p_photo && created[0].p_hub === 'h1' && created[0].p_assignee === 'e07', `${size}: the issue is created with the picture, the parcel ID and the person`)

    // Store / IT order: the form names who will get it, the order is saved as kind 'store' without picking a person; the list uses order words
    await page.goto(`${BASE}/app/issues?order=store`); await page.waitForSelector('.od-to')
    check((await page.locator('.od-to').innerText()).includes('Store Keeper'), `${size}: the order form shows who will receive a Store order`)
    await page.locator('.da-modal textarea').fill('পলি ব্যাগ ২০০টা\nটেপ ১০টা'); await fits('order form')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-order.png` })
    await page.locator('.da-modal .da-seg button').nth(1).click()
    await page.waitForSelector('.da-modal .pp', { timeout: 5000 }).catch(() => {})
    check(await page.locator('.da-modal .pp').count() === 1, `${size}: with no IT in-charge the form asks who should get it`)
    await page.locator('.da-modal .da-seg button').nth(0).click()
    await page.locator('.da-modal-acts button').first().click()
    await page.waitForFunction(() => !document.querySelector('.od-to'), null, { timeout: 8000 }).catch(() => {})
    const order = created[created.length - 1] ?? {}
    check(order.p_kind === 'store' && order.p_assignee === null && String(order.p_title).startsWith('স্টোর অর্ডার: পলি ব্যাগ') && String(order.p_body).includes('টেপ ১০টা'),
      `${size}: the Store order is saved in the person's own words and left for the in-charge`)
    const phone = viewport.width < 820
    await page.goto(`${BASE}/app/issues?tab=orders`); await page.waitForSelector('.mg-row')
    check(await page.locator('.mg-row').count() === 1 && (await page.locator('.mg-row').innerText()).includes('নতুন অর্ডার'), `${size}: the orders list shows the open order in order words`)
    await page.locator('.mg-desk').click(); await page.waitForSelector('.od-desk')
    check(await page.locator('.od-kind').count() === 2, `${size}: who receives Store and IT orders is one tap away`)
    await page.locator('.da-modal button', { hasText: 'বন্ধ' }).last().click()
    // inside a sheet, and "my accounts"
    await page.goto(`${BASE}/app/accounts/daily/s2`); await page.waitForSelector('.da-tabs', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.da-tabs button').count() >= 4 && (phone ? await page.locator('.nv-rows button.nv-row').count() === 2 : await page.locator('.qg input, .da-table input').count() > 2), `${size}: a sheet opens with its parts and the riders' lines`)
    if (phone) {
      const bar = await page.locator('.da-actionbar').boundingBox(), nav = await page.locator('.bottom-nav').boundingBox()
      check(!!bar && !!nav && bar.y + bar.height <= nav.y + 1, `${size}: the Submit bar sits above the bottom menu, not under it`)
      await page.locator('.nv-rows button.nv-row').first().click(); await page.waitForSelector('.da-modal input')
      check(await page.locator('.da-modal input').first().inputValue() === '1002' && await page.locator('.da-modal-acts button.danger').count() === 1, `${size}: tapping a rider opens their line to change or remove`)
      await page.locator('.da-modal-acts button.secondary').click()
    }
    // the hub's page: khatas handed in, Accept (one, or several marked), then the daily sheet with a reason when one is left out
    check(await page.locator('.fl-steps li').count() === 4 && await page.locator('.fl-people .nv-row').count() === 2 && (await page.locator('.fl-steps li').first().innerText()).includes('Accept ১ / ১'), `${size}: the hub page shows the steps and the khatas handed in`)
    await page.locator('.fl-people button', { hasText: 'চেক করুন' }).last().click()
    check((await page.locator('p.notice', { hasText: 'Sohel Rana' }).count()) === 1 && (phone ? await page.locator('.nv-rows:not(.fl-people) button.nv-row').count() === 1 : true), `${size}: "check" shows only that person's khata`)
    await page.locator('p.notice button', { hasText: 'সবার খাতা দেখুন' }).click()
    await page.locator('.fl-mark:not([disabled])').check()
    await page.locator('.fl-acts button', { hasText: 'Accept করুন' }).click(); await page.waitForTimeout(300)
    check(flowCalls.at(-1)?.fn === 'da_parts_accept' && flowCalls.at(-1)?.p_users?.join() === 'u7' && flowCalls.at(-1)?.p_accept === true, `${size}: marked khatas are accepted together`)
    await page.locator('.fl-acts button', { hasText: 'ডেইলি হিসাবের খাতা খুলুন' }).click(); await page.waitForSelector('.da-modal')
    check(await page.locator('.da-modal-acts button').last().isDisabled() && (await page.locator('.da-modal .notice').innerText()).includes('Sohel Rana'), `${size}: opening the daily sheet with a khata left out asks for a reason and names it`)
    await page.locator('.da-modal input').fill('একজন ছুটিতে'); await page.locator('.da-modal-acts button').last().click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
    check(flowCalls.at(-1)?.fn === 'da_check' && flowCalls.at(-1)?.p_note === 'একজন ছুটিতে', `${size}: the daily sheet is opened with its reason`)
    check(await page.locator('.da-actionbar button').count() === 0 && (await page.locator('.da-actionbar').innerText()).includes('ডেইলি হিসাবের খাতা'), `${size}: the final "send to accounts" button waits until the daily sheet is opened`)
    await fits('accounts sheet')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-sheet.png`, fullPage: true })
    // the vehicle pages are off the website: no menu entries, and an old link goes to the home page
    await page.goto(`${BASE}/app/vehicles/logs`); await page.waitForURL(/\/app\/fleet/, { timeout: 8000 }).catch(() => {})
    check(/\/app\/fleet$/.test(page.url()) && await page.locator('a[href^="/app/vehicles"]').count() === 0, `${size}: the old vehicle pages are gone and an old link opens the new one`)
    // গাড়ি for managers: vehicles with crew, set the missing helper (allowance from the settings), allowance and garage today, approvals, reports, log
    await page.waitForSelector('.fl-card', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.fl-card').count() === 2 && await page.locator('.fl-crew-row.empty').count() === 1, `${size}: the vehicle list shows each vehicle's crew and the empty helper place`)
    await fits('vehicle list')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-fleet.png`, fullPage: true })
    await page.locator('.fl-crew-row.empty').click(); await page.waitForSelector('#fl-c-code')
    check(await page.locator('#fl-c-amt').inputValue() === '100', `${size}: a new helper starts with the helper allowance from the settings`)
    await page.locator('#fl-c-code').fill('802'); await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(300)
    { const c = flowCalls.at(-1) ?? {}; check(c.fn === 'fleet_set_crew' && c.p_role === 'helper' && c.p_employee_code === '802' && c.p_allowance === 100, `${size}: the manager sets the helper with the allowance`) }
    await page.goto(`${BASE}/app/fleet?tab=today`); await page.waitForSelector('.fl-today', { timeout: 10000 }).catch(() => {})
    await page.locator('.fl-today', { hasText: 'নাটোর ট্রাক' }).getByRole('button').click(); await page.waitForTimeout(300)
    check(flowCalls.at(-1)?.fn === 'fleet_khoraki_post' && flowCalls.at(-1)?.p_vehicle === 'v1', `${size}: the manager posts today's allowance`)
    await page.locator('.fl button.nv-row', { hasText: 'লালপুর অটো' }).click(); await page.waitForSelector('.fl-status')
    await page.locator('.fl-st', { hasText: 'হ্যাঁ' }).click(); await page.locator('#fl-g-cost').fill('80'); await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(300)
    { const c = flowCalls.at(-1) ?? {}; check(c.fn === 'fleet_garage_save' && c.p_charged === true && c.p_cost === 80, `${size}: the manager writes the auto's garage charge`) }
    await fits('vehicles today')
    await page.goto(`${BASE}/app/fleet?tab=approve`); await page.waitForSelector('.fl-wait', { timeout: 10000 }).catch(() => {})
    await page.locator('.fl-wait', { hasText: 'Padma Pump' }).getByRole('button', { name: 'অনুমোদন' }).click(); await page.waitForTimeout(300)
    check(flowCalls.at(-1)?.fn === 'fleet_approve' && flowCalls.at(-1)?.p_log === 'l1', `${size}: approving fuel sends it to the sheet`)
    await fits('vehicle approvals')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-fleet-approve.png`, fullPage: true })
    await page.goto(`${BASE}/app/fleet?tab=reports`); await page.waitForSelector('.fl .da-table td', { timeout: 10000 }).catch(() => {})
    check((await page.locator('.fl').innerText()).includes('Lalpur') && (await page.locator('.fl').innerText()).includes('লোক ছিল না'), `${size}: the zonal manager sees the hub reports by hub`)
    await fits('hub reports')
    await page.goto(`${BASE}/app/fleet?tab=settings`); await page.waitForSelector('.fl-toggle', { timeout: 10000 }).catch(() => {})
    await page.locator('.da-actionbar button').click(); await page.waitForTimeout(300)
    check(flowCalls.slice(-2).map(c => c.fn).join() === 'vehicle_configure,vehicle_configure' && flowCalls.at(-2)?.p_key === 'fleet', `${size}: vehicle settings are saved`)
    await fits('vehicle settings')
    // in-app update: when a newer build is live, the app offers "আপডেট করুন"; settings show the version and a check button
    await page.route('**/version.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ build: 'newer-build' }) }))
    await page.goto(`${BASE}/app/settings`); await page.waitForSelector('.upd-bar', { timeout: 8000 }).catch(() => {})
    check((await page.locator('.upd-bar').innerText().catch(() => '')).includes('নতুন আপডেট এসেছে') && await page.locator('.app-upd').count() === 1,
      `${size}: a newer build shows the update bar, and settings show the version`)
    await fits('update bar')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-update.png` })
    await page.locator('.upd-bar .upd-later').click()
    check(await page.locator('.upd-bar').count() === 0, `${size}: "পরে" hides the update bar`)
    await page.unroute('**/version.json*')
    await page.evaluate(() => sessionStorage.removeItem('xzm_upd_later'))
    // attendance, late, the HR attendance view, the attendance-days page and the old workforce pages are one page now: /app/attendance
    for (const old of ['/app/hub/attendance', '/app/hub/late', '/app/hr/attendance', '/app/hub/days', '/app/workforce/hub', '/app/workforce/zone?tab=setting', '/app/workforce/attendance?give=today']) {
      await page.goto(`${BASE}${old}`); await page.waitForURL(/\/app\/attendance/, { timeout: 10000 }).catch(() => {})
      check(/\/app\/attendance/.test(page.url()), `${size}: the old ${old} address opens the one attendance page`)
    }
    check(/view=zone/.test((await (async () => { await page.goto(`${BASE}/app/workforce/zone?tab=setting`); await page.waitForURL(/\/app\/attendance/, { timeout: 10000 }).catch(() => {}); return page.url() })())), `${size}: the old zone address keeps its part of the page (view=zone)`)
    await page.goto(`${BASE}/app/attendance`); await page.waitForSelector('.wm, .wf', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.wm, .wf').count() > 0, `${size}: the attendance page opens`)
    await fits('attendance page')
    // the hub part of the page: the final register is the way attendance reaches the register; the old approval list and the hub book are gone
    await page.goto(`${BASE}/app/attendance?view=hub`); await page.waitForSelector('.wm .wm-tabs', { timeout: 10000 }).catch(() => {})
    { const parts = await page.locator('.wm .wm-tabs').first().innerText().catch(() => '')
      const tabs = await page.locator('.wm .wm-tabs').last().innerText().catch(() => '')
      check(['আমার হাজিরা', 'হাব', 'জোন'].every(x => parts.includes(x)), `${size}: the attendance page offers my attendance, hub and zone to a person who may see them (${parts.replace(/\s+/g, ' ')})`)
      check(['ফাইনাল খাতা', 'মাসিক খাতা', 'আবেদন', 'দৈনিক রিপোর্ট'].every(x => tabs.includes(x)) && !tabs.includes('অনুমোদন') && !tabs.includes('হাজিরা বই') && !tabs.includes('ইতিহাস'),
        `${size}: the hub part has the final register, monthly register, applications and daily report only (${tabs.replace(/\s+/g, ' ')})`)
      await page.waitForSelector('.wm-chip b.plain', { timeout: 10000 }).catch(() => {})
      const chips = await page.locator('section[aria-label="ফাইনাল খাতা বাকি"] .wm-chip').allInnerTexts().catch(() => [])
      check(chips.length === 2 && chips[0].includes('৩ নভেম্বর') && chips[0].includes('২') && chips[1].includes('৫ নভেম্বর'), `${size}: days still waiting for a final register are listed, oldest first, with how many each (${chips.join(' | ').replace(/\s+/g, ' ')})`)
      await page.locator('section[aria-label="ফাইনাল খাতা বাকি"] .wm-chip').first().click(); await page.waitForSelector('.as-state:has-text("৩ নভেম্বর") ~ .as-list .as-line, .as-state:has-text("৩ নভেম্বর")', { timeout: 10000 }).catch(() => {}); await page.waitForSelector('.as-line', { timeout: 10000 }).catch(() => {})
      check(/date=2026-11-03/.test(page.url()) && await page.locator('.as-line', { hasText: 'Alamin Sarker' }).count() === 1, `${size}: a waiting day opens that day's final register (${page.url()})`)
      check(await page.locator('.as-hold').count() === 1 && (await page.locator('.as-hold').innerText()).includes('সার্ভার এই খাতা জমা দেয়নি') && (await page.locator('.as-hold').innerText()).includes('Alamin Sarker'), `${size}: a register the server refused to submit says so, who is unfinished, and that the managers were told`)
      await fits('final register') }
    // the morning input: the first part of the hub's page. Approved leave is in by itself, what is typed is saved, the submit locks it to a receipt
    await page.goto(`${BASE}/app/attendance?view=hub`); await page.waitForSelector('.mo-table', { timeout: 10000 }).catch(() => {})
    { check(await page.locator('.mo-table tbody tr').count() === 3 && await page.locator('.mo-table select').count() === 2 && (await page.locator('.mo-table tbody tr').last().innerText()).includes('LR-1A2B3C4D'),
        `${size}: the hub page opens on the morning input — two people to mark, the person on approved leave is already in`)
      check((await page.locator('.wm-sec', { hasText: 'সার্ভার সকালের ইনপুট জমা দেয়নি' }).count()) === 1 && (await page.locator('.wm-sec', { hasText: 'সার্ভার সকালের ইনপুট জমা দেয়নি' }).innerText()).includes('২ জনের অবস্থা বসানো হয়নি'), `${size}: a morning input the server refused to submit says so and how many are not marked`)
      const before = flowCalls.length
      await page.locator('.mo-table select').nth(0).selectOption('present'); await page.locator('.mo-table select').nth(1).selectOption('absent')
      await page.waitForFunction(n => document.body.innerText.includes('খসড়া সেভ হয়েছে') && n >= 0, before, { timeout: 8000 }).catch(() => {})
      { const c = flowCalls.filter(x => x.fn === 'wf_morning_save').at(-1) ?? {}
        check(JSON.stringify(c.p_lines) === JSON.stringify([{ employee_id: 'e02', state: 'present' }, { employee_id: 'e03', state: 'absent' }]) && !JSON.stringify(c.p_lines).includes('leave'), `${size}: what is typed is saved as a draft, leave is never sent`) }
      await fits('morning input')
      await page.locator('.mo-bar button').first().click(); await page.waitForSelector('.da-modal-acts button', { timeout: 8000 }).catch(() => {}); await page.locator('.da-modal-acts button').last().click()
      await page.waitForSelector('.mo-receipt', { timeout: 8000 }).catch(() => {})
      { const c = flowCalls.filter(x => x.fn === 'wf_morning_submit').at(-1) ?? {}
        check(c.p_hub === 'h1' && c.p_lines?.length === 2 && await page.locator('.mo-receipt').count() === 1 && await page.locator('.mo-table').count() === 0,
          `${size}: the submit sends the lines once and the hub manager is left with a receipt, no lines`) } }
    // the zone's morning: each hub's submission, the route that needs cover, send back with a reason
    await page.goto(`${BASE}/app/attendance?view=zone`); await page.waitForSelector('.mo-hub', { timeout: 10000 }).catch(() => {})
    { const cards = page.locator('.mo-hub')
      check(await cards.count() === 2 && (await cards.first().innerText()).includes('R-1') && (await cards.first().innerText()).includes('অটো জমা') && (await cards.last().innerText()).includes('জমা আটকে — কিছুই লেখা হয়নি'),
        `${size}: the zone page opens on the zone's morning — a hub that auto-submitted shows the route to cover, another is held because nothing was written`)
      await fits('zone morning')
      await cards.first().locator('button', { hasText: 'সংশোধনের জন্য ফেরত' }).click(); await page.waitForSelector('.da-modal textarea', { timeout: 8000 }).catch(() => {})
      await page.locator('.da-modal textarea').fill('আলামিন এসেছে'); await page.locator('.da-modal-acts button').last().click()
      await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
      { const c = flowCalls.filter(x => x.fn === 'wf_morning_return').at(-1) ?? {}
        check(c.p_hub === 'h1' && c.p_reason === 'আলামিন এসেছে', `${size}: sending back needs a written reason and goes with it`) } }
    await page.goto(`${BASE}/app/attendance?view=zone&tab=setting`); await page.waitForSelector('input[type=time]', { timeout: 10000 }).catch(() => {})
    { await page.locator('input[type=time]').first().fill('09:00'); await page.locator('button', { hasText: 'সময় সেভ করুন' }).first().click()
      await page.waitForTimeout(600)
      const c = flowCalls.filter(x => x.fn === 'wf_att_policy_save').at(-1) ?? {}
      check(c.p_zone === 'z1' && c.p?.morning_cutoff === '09:00' && c.p?.morning_extra === 15, `${size}: the zone's morning cut-off and extra minutes are saved from the setting tab`) }
    // the daily register shows when the server will submit it; the month names a missing day and cannot be submitted until it is there
    await page.goto(`${BASE}/app/attendance?view=hub&tab=final`); await page.waitForSelector('.as-due', { timeout: 10000 }).catch(() => {})
    check((await page.locator('.as-due').first().innerText().catch(() => '')).includes('সার্ভার'), `${size}: the daily register says when the server submits it`)
    await page.goto(`${BASE}/app/attendance?view=hub&tab=month`); await page.waitForSelector('text=দৈনিক খাতা বাকি', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.wm-sec', { hasText: 'মাসের খাতা জমা' }).locator('text=২২ নভেম্বর').count() > 0 && await page.locator('.wm-sec', { hasText: 'মাসের খাতা জমা' }).locator('button[disabled]', { hasText: 'মাসের খাতা জমা দিন' }).count() === 1,
      `${size}: the monthly register names the missing day and its submit button is off`)
    await fits('monthly register')
    // the zonal manager opens a hub for correction: a reason is needed, the call carries hub, days, minutes and reason
    await page.goto(`${BASE}/app/attendance?view=zone&tab=final`); await page.waitForSelector('text=সংশোধনের জন্য খুলুন', { timeout: 10000 }).catch(() => {})
    { const panel = page.locator('.wm-sec', { hasText: 'সংশোধনের জন্য খুলুন' }).last()
      await panel.locator('.da-table').waitFor({ timeout: 8000 }).catch(() => {})
      check((await panel.innerText()).includes('ভুল স্ট্যাটাস') && await panel.locator('button', { hasText: 'এখনই শেষ করুন' }).count() === 1, `${size}: the hub's earlier openings are listed with who, until when and why`)
      check(await panel.locator('button', { hasText: 'খুলে দিন' }).isDisabled(), `${size}: it cannot be opened without a reason`)
      await panel.locator('input[type=text]').fill('ভুল স্ট্যাটাস ঠিক করতে'); await panel.locator('button', { hasText: 'খুলে দিন' }).click()
      await page.waitForSelector('.da-modal-acts button', { timeout: 8000 }).catch(() => {}); await page.locator('.da-modal-acts button').last().click()
      await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
      { const c = flowCalls.filter(x => x.fn === 'att_reopen_open').at(-1) ?? {}
        check(c.p_hub === 'h1' && c.p_minutes === 60 && c.p_reason === 'ভুল স্ট্যাটাস ঠিক করতে' && /^\d{4}-\d{2}-\d{2}$/.test(c.p_from) && c.p_from === c.p_to, `${size}: the opening goes with the hub, the day, the minutes and the reason`) }
      await fits('reopen panel') }
    // the staff work profile: zone -> hub -> person, then identity, attendance, field work and other work
    await page.goto(`${BASE}/app/zonal/profile`); await page.waitForSelector('.wm-top select', { timeout: 10000 }).catch(() => {})
    { await page.locator('.wm-top select').nth(await page.locator('.wm-top select').count() - 3).selectOption({ index: 1 }).catch(() => {})
      const selects = page.locator('.wm-top select'); const hubSel = selects.nth(await selects.count() - 3)
      await hubSel.selectOption({ index: 1 }); await page.waitForFunction(() => document.querySelectorAll('.wm-top select')[document.querySelectorAll('.wm-top select').length - 2].options.length > 1, null, { timeout: 8000 }).catch(() => {})
      await selects.nth(await selects.count() - 2).selectOption('e02'); await page.waitForSelector('.swp-head', { timeout: 10000 }).catch(() => {})
      check(/emp=e02/.test(page.url()) && (await page.locator('.swp-head').innerText()).includes('Alamin Sarker') && (await page.locator('.swp-head').innerText()).includes('7982'), `${size}: zone, hub and person lead to the person's work profile (${page.url()})`)
      check(await page.locator('.da-stats .da-stat').count() === 3 && (await page.locator('.da-stats').first().innerText()).includes('বাতিল'), `${size}: each module shows its submitted count and what is draft or cancelled`)
      const idt = await page.locator('.wm').last().innerText()
      check(idt.includes('নগদ ব্যাগ বহন') && idt.includes('Lalpur') && idt.includes('চলছে'), `${size}: identity shows the duty and the assignment history with its old hub`)
      await fits('work profile')
      await page.locator('.wm-tabs button', { hasText: 'হাজিরা ও ছুটি' }).click()
      const att = await page.locator('.wm').last().innerText()
      check(att.includes('LR-1A2B3C4D') && att.includes('খসড়া') && att.includes('জমা') && att.includes('10:15'), `${size}: attendance shows the submitted and the draft register apart, with the late time and the leave`)
      await page.locator('.wm-tabs button', { hasText: 'মাঠের কাজ' }).click()
      const fld = await page.locator('.wm').last().innerText()
      check(fld.includes('রুট বরাদ্দ বাতিল') && fld.includes('R-1') && fld.includes('৫২') === false && fld.includes('দৈনিক সংখ্যা'), `${size}: field work lists the route (and its cancelled line) and the delivery numbers`)
      check(await page.locator('button', { hasText: 'মূল রেকর্ড' }).count() === 1, `${size}: a line with a source record links to it`)
      await page.locator('.wm-tabs button', { hasText: 'অন্যান্য কাজ' }).click()
      check((await page.locator('.wm').last().innerText()).includes('যুক্ত হয়নি'), `${size}: other work says which modules are not connected yet`) }
    // the published plan the hub manager received: its version, who got it, who was taken off
    await page.goto(`${BASE}/app/attendance?view=hub&tab=plan`); await page.waitForSelector('.da-table', { timeout: 10000 }).catch(() => {})
    { const t = await page.locator('.wm').last().innerText().catch(() => '')
      check(t.includes('সংস্করণ ২') && t.includes('Md Mahin') && t.includes('বাদ পড়েছেন') && t.includes('Alamin Sarker'), `${size}: the received route plan shows its version, the riders, who was taken off, and the history`) }
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-self-att.png`, fullPage: true })
    // the hub sets up its own people: logins for riders / plain staff, a new password, profile details, "has left"
    await page.goto(`${BASE}/app/hub/logins`); await page.waitForSelector('.hl .nv-row', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.hl .nv-row').count() === 3 && await page.locator('.hl .nv-row button', { hasText: 'লগইন বানান' }).count() === 1 && (await page.locator('.hl .nv-row').last().innerText()).includes('অ্যাডমিন'),
      `${size}: the hub's login page offers a login only where the hub may make one`)
    const acBefore = accounts.length
    await page.locator('.hl .nv-row button', { hasText: 'লগইন বানান' }).click(); await page.waitForSelector('.da-modal input')
    await page.locator('.da-modal input').fill('short'); await page.locator('.da-modal-acts button').last().click()
    check(accounts.length === acBefore && await page.locator('.da-modal .da-error').count() === 1, `${size}: a weak first password is refused before anything is sent`)
    await page.locator('.da-modal input').fill('Xzm12345'); await page.locator('.da-modal-acts button').last().click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
    { const a = accounts.at(-1) ?? {}
      check(accounts.length === acBefore + 1 && a.action === 'create' && a.email === 'id-7982@xzmteam.com' && a.scope_type === 'hub' && a.role_id === 'r5' && a.employee_id === 'e02', `${size}: the login is made with the Employee ID, the post's role and the hub`) }
    await page.locator('.hl .nv-row button', { hasText: 'নতুন পাসওয়ার্ড দিন' }).click(); await page.waitForSelector('.da-modal input')
    await page.locator('.da-modal input').fill('Xzm67890'); await page.locator('.da-modal-acts button').last().click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
    check(accounts.at(-1)?.action === 'reset_password' && accounts.at(-1)?.user_id === 'u9', `${size}: the hub gives a new password to one of its own`)
    await fits('hub logins')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-logins.png` })
    await page.goto(`${BASE}/app/hr/employees/e01`); await page.waitForSelector('.nv-qa', { timeout: 10000 }).catch(() => {})
    await page.locator('.nv-qa', { hasText: 'প্রোফাইল পূর্ণ' }).click(); await page.waitForSelector('.da-modal .da-form input')
    check((await page.locator('.da-modal').innerText()).includes('জমা আছে') && await page.locator('.da-modal .da-form input').first().inputValue() === '01711000001', `${size}: the profile form shows contact details and only "on file" for identity details`)
    await page.locator('.da-modal .da-form select').selectOption('B+'); await page.locator('.da-modal .da-form input[type=date]').fill('1998-03-05')
    await page.locator('.da-modal-acts button').last().click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
    { const c = flowCalls.at(-1) ?? {}
      check(c.fn === 'hr_hub_profile_save' && c.p_employee === 'e01' && JSON.stringify(c.p) === JSON.stringify({ blood_group: 'B+', date_of_birth: '1998-03-05' }), `${size}: only what was newly written is sent`) }
    await page.locator('.nv-qa', { hasText: 'চাকরি ছেড়েছেন' }).click(); await page.waitForSelector('.da-modal textarea')
    await page.locator('.da-modal textarea').fill('নিজে চাকরি ছেড়েছেন'); await page.locator('.da-modal-acts button').last().click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
    { const c = flowCalls.at(-1) ?? {}
      check(c.fn === 'hr_request_submit' && c.p_format === 'f-inactive' && c.p_employee === 'e01' && c.p_data?.reason === 'নিজে চাকরি ছেড়েছেন' && !!c.p_data?.last_date, `${size}: "has left" goes to the office as a request`) }
    // the menu is three panels: staff, manager, zonal manager — each person gets the panels up to their own level
    { const panels = () => page.locator('.side .ngrp').evaluateAll(els => els.map(e => e.dataset.panel).join())
      const inPanel = (k, t) => page.locator(`.side .ngrp[data-panel=${k}] a.nl`, { hasText: t }).count()
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp')
      const links = await page.locator('.side a.nl').evaluateAll(els => els.map(e => e.getAttribute('href')))
      const adminPanels = (await panels()).split(',')
      check(['accounts', 'hr', 'office', 'self', 'hub', 'zone', 'admin'].every(k => adminPanels.includes(k)) && new Set(adminPanels).size === adminPanels.length
        && await inPanel('self', 'আমার হিসাব') === 1 && await inPanel('hr', 'কর্মী তালিকা') === 1 && await inPanel('admin', 'অ্যাডভান্সড রোল ও পারমিশন') === 1 && await inPanel('zone', 'রোল ও অনুমতি') === 0,
        `${size}: the Super Admin sees the accounts, HR and office groups plus staff, manager and zonal panels`)
      check(await page.locator('.side .ngrp[data-panel=self] a.nl[href="/app/attendance"]').count() === 0, `${size}: personal attendance is not repeated in the staff panel`)
      check(await page.locator('.side .ngrp[data-panel=office] .nsec').count() === 6 && await page.locator('.side .ngrp[data-panel=office] a.nl').count() === 21
        && await inPanel('office', 'কারা থাকেন') === 2 && await inPanel('office', 'আবাসিকের সারসংক্ষেপ') === 1 && await inPanel('zone', 'অফিস ভিজ্যুয়াল') === 0,
        `${size}: আমার অফিস is a menu of its own, in five headed parts plus আবাসিক`)
      // Office and Residential: the same rows, split by kind
      await page.goto(`${BASE}/app/office/places`); await page.waitForSelector('.panel h2')
      { const t = await page.locator('main').innerText()
        check(t.includes('Natore Hub Office') && !t.includes('Staff Mess A') && await page.locator('a[href="/app/office/residential/places"]').count() > 0,
          `${size}: the office list shows offices only, and points to the residential list`) }
      await page.goto(`${BASE}/app/office/residential/places`); await page.waitForSelector('.panel h2')
      { const t = await page.locator('main').innerText()
        check(t.includes('Staff Mess A') && t.includes('Staff Mess B') && !t.includes('Natore Hub Office'), `${size}: the residential list shows residences only`) }
      // remove asks for the reason in a box of its own (no browser prompt), and a removed place comes back with one tap
      officePatches.length = 0
      await page.locator('button[aria-label="Staff Mess B সরান"]').first().click()
      await page.locator('.da-modal textarea').fill('বাসা ছেড়ে দেওয়া হলো'); await page.locator('.da-modal button', { hasText: 'ঠিক আছে' }).click()
      await page.waitForTimeout(300)
      check(officePatches.length === 1 && officePatches[0].u.includes('id=eq.rs2') && officePatches[0].body.archive_reason === 'বাসা ছেড়ে দেওয়া হলো' && !!officePatches[0].body.archived_at,
        `${size}: removing a residence asks the reason in the page's own box and archives it (nothing deleted)`)
      await page.locator('button', { hasText: 'সরানোগুলো' }).click(); await page.locator('.oo-gone .duty').first().waitFor({ timeout: 8000 }).catch(() => {})
      await page.locator('.oo-gone button', { hasText: 'ফেরত আনুন' }).click(); await page.waitForTimeout(300)
      check(await page.locator('.oo-gone').innerText().then(t => t.includes('Old Mess C')).catch(() => false) && officePatches.some(p => p.u.includes('id=eq.rs9') && p.body.archived_at === null),
        `${size}: a removed residence is listed and restored`)
      // export / print: logged in the database first, and shown only to roles that may
      officeLogs.length = 0
      { const b = page.locator('.list-tools .tool-menu-btn').last(); if (await b.isVisible()) await b.click() }
      await page.locator('.list-tools .tb.xls').first().click(); await page.waitForTimeout(400)
      check(officeLogs.length === 1 && officeLogs[0].p_report === 'residential-places' && officeLogs[0].p_format === 'excel' && officeLogs[0].p_rows === 2,
        `${size}: an Excel export of the residential list is written to the audit log first`)
      permsNow = ['office.property.view']
      await page.goto(`${BASE}/app/office/residential/places`); await page.waitForSelector('.list-tools')
      const tools = async () => [await page.locator('.list-tools .tb.xls').count(), await page.locator('.list-tools .tb.pdf').count(), await page.locator('.list-tools .tb[aria-label="প্রিন্ট"]').count()].join(',')
      { const noneShown = await tools(); permsNow = ['office.property.view', 'office.report.print']
        await page.goto(`${BASE}/app/office/residential/places`); await page.waitForSelector('.list-tools')
        const printOnly = await tools()
        check(noneShown === '0,0,0' && printOnly === '0,0,1' && (await page.locator('main').innerText()).includes('Staff Mess A'),
          `${size}: without office export / print the list still shows but has no Excel, PDF or print; print alone gives print only`) }
      permsNow = null
      // monthly report: this month's bills by place, the rent still missing, and contracts ending
      await page.goto(`${BASE}/app/office/residential/reports`); await page.waitForSelector('.da-stats')
      await page.locator('table, .dv-cards, .dv-list').first().waitFor({ timeout: 8000 }).catch(() => {})
      { const t = await page.locator('main').innerText()
        check(t.includes('Staff Mess A') && t.includes('Staff Mess B') && !t.includes('Natore Hub Office') && t.includes('৳ ৬০০০') && t.includes('পানির বিল') && t.includes('৳ ৬৩৫০') && t.includes('চুক্তির মেয়াদ')
          && (Number(dhakaToday.slice(8)) === 1 || t.includes('বাকি')), `${size}: the residential monthly report adds up the bills, marks missing rent and lists ending contracts`) }
      await fits('the residential monthly report')
      await page.goto(`${BASE}/app/office/residential`); await page.waitForURL(/\/app\/office\/residential\/overview$/, { timeout: 8000 }).catch(() => {})
      await page.locator('.duty-list').waitFor({ timeout: 8000 }).catch(() => {})
      { const t = await page.locator('main').innerText()
        check(/\/residential\/overview$/.test(page.url()) && t.includes('Staff Mess A: চুক্তি') && t.includes('Staff Mess A: ধারণক্ষমতা') && !t.includes('Natore Hub Office')
          && (Number(dhakaToday.slice(8)) === 1 || t.includes('Staff Mess A: এ মাসের ভাড়া')) && !t.includes('Staff Mess B: এ মাসের ভাড়া'),
          `${size}: the residential overview lists every flat and what needs attention (contract, crowding, unpaid rent)`) }
      await fits('the residential overview')
      await page.locator('.duty-list .linkish', { hasText: 'Staff Mess A: চুক্তি' }).click()
      await page.waitForURL(/\/residential\/rent$/, { timeout: 8000 }).catch(() => {})
      { const sel = page.locator('.hub-top select').first()
        check(/\/residential\/rent$/.test(page.url()) && await sel.inputValue().catch(() => '') === 'rs1' && await sel.locator('option').count() === 2,
          `${size}: a line of the overview opens that flat's page, and the picker holds residences only`) }
      await fits('a residential flat page')
      // office resources: kinds are tap-to-filter chips, the help is folded away, and each item has one ⋮ menu
      await page.goto(`${BASE}/app/office/assets`); await page.waitForSelector('.oo-kind-row', { timeout: 8000 }).catch(() => {})
      { const chips = await page.locator('.oo-kind').count()
        await page.locator('.oo-kind', { hasText: 'ফ্যান' }).click(); await page.waitForTimeout(150)
        const onlyFan = await page.locator('.oo-name', { hasText: 'মনিটর' }).count() === 0 && await page.locator('.oo-name', { hasText: 'ফ্যান' }).count() === 1
        await page.locator('.oo-kind', { hasText: 'ফ্যান' }).click(); await page.waitForTimeout(150)
        await page.locator('.row-menu-btn').first().click()
        const items = await page.locator('.row-menu button').allInnerTexts()
        const brokenAction = await page.getByRole('button', { name: 'নষ্ট', exact: true }).count()
        await page.keyboard.press('Escape')
        check(chips === 4 && onlyFan && await page.locator('.oo-name').count() === 3 && await page.locator('.oo-help[open]').count() === 0
          && brokenAction > 0 && items.some(t => t.includes('আরও লাগবে')) && items.some(t => t.includes('এডিট')),
          `${size}: office resources — kind chips filter the list, help is folded, each item has one ⋮ menu`) }
      // every office and residential page opens, shows its tabs, has no error box and fits the screen
      { const pages = [...['overview', 'zone', 'places', 'rooms', 'desks', 'people', 'assets', 'power', 'rent', 'bills', 'security', 'notices', 'reports'].map(k => `/app/office/${k}`),
          ...['overview', 'places', 'rooms', 'people', 'rent', 'bills', 'assets', 'reports', 'power', 'security', 'notices', 'desks'].map(k => `/app/office/residential/${k}`)]
        const bad = []
        for (const path of pages) {
          await page.goto(`${BASE}${path}`); await page.waitForSelector('.hub-tabs', { timeout: 8000 }).catch(() => {})
          await page.waitForTimeout(150)
          const ok = await page.locator('.hub-tabs a.on').count() === 1 && await page.locator('main.crash, .da-error').count() === 0
            && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
          if (!ok) bad.push(path)
          if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}${path.replaceAll('/', '-')}.png`, fullPage: true })
        }
        check(!bad.length, `${size}: all ${pages.length} office and residential pages open cleanly and fit the screen${bad.length ? ' — ' + bad.join(', ') : ''}`) }
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp')
      { const want = ['ডেইলি রিপোর্ট ইম্পোর্ট', 'দৈনিক রিপোর্ট', 'হাবের খরচ', 'মার্চেন্ট ক্যাশ পেমেন্ট', 'ব্যাংকে জমা', 'হাবের বকেয়া / ফান্ড', 'ভাউচার ম্যানেজমেন্ট', 'ভাউচার জমা হয়নি', 'স্টাফ খরচ', 'যাতায়াত বিল', 'হিসাবের ইতিহাস', 'বাংলা শেখার কেন্দ্র', 'নদী AI হিসাব শিক্ষক']
        const got = await Promise.all(want.map(t => inPanel('accounts', t)))
        check(await page.locator('.side .ngrp[data-panel=accounts] .nsec').count() === 5 && await page.locator('.side .ngrp[data-panel=accounts] a.nl').count() === 20 && got.every(c => c === 1),
          `${size}: accounts has a menu of its own, every part one tap away${got.every(c => c === 1) ? '' : ' — missing: ' + want.filter((_, i) => got[i] !== 1).join(', ')}`) }
      if (size === 'phone') await page.locator('.bottom-nav button.bn-item').last().click()
      const accountsToggle = page.locator('.side .ngrp[data-panel=accounts] button.ngh')
      if (await accountsToggle.getAttribute('aria-expanded') === 'false') await accountsToggle.click()
      await page.locator('.side .ngrp[data-panel=accounts] a.nl', { hasText: 'ব্যাংকে জমা' }).click()
      await page.waitForSelector('.ac .da-table', { timeout: 10000 }).catch(() => {})
      check(page.url().includes('/app/accounts/center?tab=bank') && (await page.locator('.ac .da-table').innerText().catch(() => '')).includes('NOT MATCH')
        && await page.locator('.side .ngrp[data-panel=accounts] a.nl.active').count() === 1 && (await page.locator('.side .ngrp[data-panel=accounts] a.nl.active').innerText()).includes('ব্যাংকে জমা'),
        `${size}: a menu entry opens its own part, and only that entry is marked`)
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-menu-bank.png` })
      for (const [t, want] of [['দৈনিক রিপোর্ট', '#743858'], ['মার্চেন্ট ক্যাশ পেমেন্ট', 'SFC-33223762'], ['হাবের বকেয়া / ফান্ড', 'বকেয়া']]) {
        await page.goto(`${BASE}/app/accounts/center?tab=${{ 'দৈনিক রিপোর্ট': 'reports', 'মার্চেন্ট ক্যাশ পেমেন্ট': 'merchant', 'হাবের বকেয়া / ফান্ড': 'due' }[t]}`)
        await page.waitForSelector('.ac .da-table tbody tr', { timeout: 10000 }).catch(() => {})
        check((await page.locator('.ac .da-table').innerText().catch(() => '')).includes(want), `${size}: "${t}" shows its own list`)
      }
      await page.goto(`${BASE}/app/accounts/learn?p=practice`); await page.waitForSelector('.lr-card')
      check(await page.locator('.lr-card').count() === 7, `${size}: the practice menu entry lists the lessons that have practice`)
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp')
      check(!links.includes('/app/hub/accounts') && !links.includes('/app/hr') && !links.includes('/app/issues?tab=orders') && links.filter((l, i) => links.indexOf(l) !== i).length === 0,   // attendance has one page, listed once
        `${size}: pages that repeat another page are off the menu, and no page is listed twice`)
      check(await page.locator('.side .ngrp[data-panel=zone] .nsec').count() === 2 && await page.locator('.side .ngrp[data-panel=hr] .nsec').count() === 6 && await page.locator('.side .ngrp[data-panel=self] .nsec').count() === 0, `${size}: the zonal panel and the HR department are split into headed parts`)
      if (process.env.SHOTS && size === 'pc') await page.locator('.side').screenshot({ path: `${process.env.SHOTS}/menu-super.png` })
      const extras = async () => [await page.locator('.side a.nl[href="/app/training"]').count(), await page.locator('.nodi-fab').count(), await page.locator('.side a.nl[href="/app/nodi/chat"]').count()].join()
      asEmployee = true
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp'); await page.waitForSelector('.first-steps', { timeout: 5000 }).catch(() => {})
      check(await extras() === '1,1,1' && await page.locator('.first-steps').count() === 1, `${size}: the zonal level keeps the training centre, the AI helper and the first-steps box`)
      // the floating নদী button: off from the chat screen, back on from Setting (remembered on this device)
      await page.goto(`${BASE}/app/nodi/chat`); await page.waitForSelector('.nodi-top-btns button')
      if (process.env.SHOTS) await page.locator('.nodi-top').screenshot({ path: `${process.env.SHOTS}/${size}-nodi-top.png` })
      await page.locator('.nodi-top-btns button', { hasText: 'স্ক্রিনে বোতাম' }).click()
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp')
      const fabOff = await page.locator('.nodi-fab').count()
      await page.goto(`${BASE}/app/settings`); await page.waitForSelector('.nodi-fab-seg button')
      if (process.env.SHOTS) await page.locator('.nodi-fab-seg').screenshot({ path: `${process.env.SHOTS}/${size}-nodi-fab-setting.png` })
      await page.locator('.nodi-fab-seg button', { hasText: 'চালু' }).click()
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp')
      check(fabOff === 0 && await page.locator('.nodi-fab').count() === 1 && await page.locator('.side a.nl[href="/app/nodi/chat"]').count() === 1,
        `${size}: the floating Nodi button turns off on the chat screen and back on in Setting; the menu entry stays`)
      permsNow = ['hr.employee.view', 'hr.attendance.view', 'hr.attendance.create', 'da.sheet.view', 'da.sheet.create', 'org.hub.view', 'sorting.parcel.view', 'nodi.assistant.view']
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp'); await page.waitForSelector('.da-main .greet h2')
      check(await extras() === '0,0,0' && await page.locator('.first-steps').count() === 0, `${size}: a manager's screen has no training centre, AI helper or first-steps box`)
      const managerPanels = (await panels()).split(',')
      check(['accounts', 'self', 'hub', 'sorting'].every(k => managerPanels.includes(k)) && new Set(managerPanels).size === managerPanels.length
        && await inPanel('hub', 'হাব তালিকা ও ম্যাপ') === 1 && await inPanel('hub', 'পার্সেল আদান-প্রদান') === 0 && await inPanel('sorting', 'পার্সেল আদান-প্রদান') === 1
        && await inPanel('accounts', 'নতুন ভাউচার') === 1 && await inPanel('accounts', 'হিসাব সেটিংস') === 0,
        `${size}: a hub manager gets the staff and manager panels; higher pages they may open sit in their own panel`)
      if (process.env.SHOTS && size === 'pc') await page.locator('.side').screenshot({ path: `${process.env.SHOTS}/menu-manager.png` })
      { const dl = page.locator('.app-dl'); await dl.waitFor({ timeout: 5000 }).catch(() => {})
        check(await dl.count() === 1 && await dl.locator('input').count() === 0 && await dl.locator('button').count() === 4,
          `${size}: the dashboard ends with the Android app card (download, WhatsApp, share, copy link)`)
        if (process.env.SHOTS) await dl.screenshot({ path: `${process.env.SHOTS}/${size}-app-download.png` }) }
      permsNow = ['ops.pickup_as_rider.create', 'ops.route.view', 'org.hub.view', 'nodi.assistant.view']
      await page.goto(`${BASE}/app`); await page.waitForSelector('.side .ngrp')
      await page.waitForSelector('.sp-hero')
      await page.waitForSelector('.rsend .rs-grid input', { timeout: 8000 }).catch(() => {})
      check(await page.locator('.rsend').count() === 1 && await page.locator('.rsend .rs-send').count() === 2 && await page.locator('.rsend .rs-grid input').count() === 5
        && await page.locator('.rsend .rs-list li').count() === 1,
        `${size}: a rider sees the pickup and delivery forms (numbers only) and today's line`)
      await page.locator('.rsend .rs-chip', { hasText: 'Abdul Karim' }).click()
      const inp = i => page.locator('.rsend .rs-grid input').nth(i)
      // pickup khata: pickup, returned to the merchant
      await inp(0).fill('৪'); await inp(1).fill('1')
      await fits('pickup and delivery forms')
      if (process.env.SHOTS) await page.locator('.rsend').screenshot({ path: `${process.env.SHOTS}/${size}-rider-send.png` })
      await page.locator('.rsend .rs-send').nth(0).click(); await page.waitForSelector('.rsend .rs-done', { timeout: 8000 }).catch(() => {})
      { const c = flowCalls.filter(x => x.fn === 'da_rider_submit').at(-1) ?? {}, w = flowCalls.filter(x => x.fn === 'wf_ops_add').at(-1) ?? {}
        check(c.p_manager === 'u7' && c.p_pickup === 4 && c.p_delivery === 0 && c.p_amount === 0 && String(c.p_remarks ?? '').includes('1')
          && w.p_pickup === 4 && w.p_pickup_return === 1 && w.p_delivery === 0 && await page.locator('.rsend .rs-done').count() === 1,
          `${size}: the pickup form sends the pickup to the chosen manager's khata (Bangla digits too) and adds all numbers to the day's count`) }
      // delivery khata: delivery return, delivery, money
      await inp(2).fill('2'); await inp(3).fill('12'); await inp(4).fill('2,500')
      await page.locator('.rsend .rs-send').nth(1).click(); await page.waitForFunction(() => document.querySelectorAll('.rsend .rs-grid input')[3]?.value === '', null, { timeout: 8000 }).catch(() => {})
      { const c = flowCalls.filter(x => x.fn === 'da_rider_submit').at(-1) ?? {}, w = flowCalls.filter(x => x.fn === 'wf_ops_add').at(-1) ?? {}
        check(c.p_manager === 'u7' && c.p_pickup === 0 && c.p_delivery === 12 && c.p_amount === 2500 && c.p_office === false
          && w.p_delivery === 12 && w.p_delivery_return === 2 && w.p_pickup === 0,
          `${size}: the delivery form sends delivery and money to the manager's khata, with the delivery return in the day's count`) }
      // returns alone: nothing for the khata, only the day's count
      { const before = flowCalls.filter(x => x.fn === 'da_rider_submit').length
        await inp(1).fill('3'); await page.locator('.rsend .rs-send').nth(0).click(); await page.waitForTimeout(500)
        const w = flowCalls.filter(x => x.fn === 'wf_ops_add').at(-1) ?? {}
        check(flowCalls.filter(x => x.fn === 'da_rider_submit').length === before && w.p_pickup === 0 && w.p_pickup_return === 3,
          `${size}: returns alone go to the day's count only, nothing is sent to the khata`) }
      check(await extras() === '0,0,0' && await page.locator('.first-steps').count() === 0, `${size}: nor has a staff member's screen (their home is the staff panel)`)
      check(await panels() === 'self' && await inPanel('self', 'আজকের পিকআপ খাতা') === 1 && await inPanel('self', 'রাইডার রুট') === 1 && await inPanel('self', 'রোল ও অনুমতি') === 0,
        `${size}: a rider gets one panel only, with everything they may open inside it`)
      if (process.env.SHOTS && size === 'pc') await page.locator('.side').screenshot({ path: `${process.env.SHOTS}/menu-rider.png` })
      permsNow = null; asEmployee = false }
    // arranging a role's home page: add, remove, put in order — and the home page follows the saved order
    await page.goto(`${BASE}/app/role-dashboards`); await page.waitForSelector('[data-arrange=hub_manager]')
    await page.locator('[data-arrange=hub_manager]').click(); await page.waitForSelector('.da-modal [data-list=on] .nv-row')
    check(await page.locator('.da-modal [data-list=on] .nv-row').count() === 2 && await page.locator('.da-modal [data-list=off] .nv-row').count() === 13, `${size}: arranging shows what is on the home page and what can be added`)
    await page.locator('.da-modal [aria-label="quick_links up"]').click()
    await page.locator('.da-modal [aria-label="hub_today add"]').click()
    await page.locator('.da-modal [aria-label="my_work remove"]').click()
    check((await page.locator('.da-modal [data-list=on] .nv-row').evaluateAll(els => els.map(e => e.dataset.panel))).join() === 'quick_links,hub_today', `${size}: panels can be moved, added and removed`)
    await fits('arrange dialog')
    if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.SHOTS}/${size}-arrange.png` }) }
    await page.locator('.da-modal-acts button').last().click(); await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 5000 }).catch(() => {})
    check(flowCalls.at(-1)?.fn === 'role_dashboard_save' && flowCalls.at(-1)?.p_role === 'r2' && flowCalls.at(-1)?.p_panels?.join() === 'quick_links,hub_today', `${size}: the arranged home page is saved for the role`)
    { const order = async () => (await page.locator('.da-main section.panel > .da-bar h2').allInnerTexts()).filter(t => t === 'আজকের হিসাব খাতা' || t === 'টাকার হিসাব').join(' > ')
      const ready = () => page.waitForFunction(() => { const h = [...document.querySelectorAll('.da-main section.panel > .da-bar h2')].map(e => e.textContent?.trim()); return h.includes('আজকের হিসাব খাতা') && h.includes('টাকার হিসাব') })
      homePanels = ['accounts_today', 'cash_today']; await page.evaluate(() => localStorage.setItem('xzm_view', 'hub'))
      await page.goto(`${BASE}/app`); await page.waitForSelector('.da-main .greet h2'); await ready()
      const first = await order()
      check(await page.locator('.dash-edit').count() === 1, `${size}: the Super Admin's home has a shortcut to arrange dashboards`)
      homePanels = ['cash_today', 'accounts_today']
      await page.goto(`${BASE}/app`); await page.waitForSelector('.da-main .greet h2'); await ready()
      check(first === 'আজকের হিসাব খাতা > টাকার হিসাব' && await order() === 'টাকার হিসাব > আজকের হিসাব খাতা', `${size}: the home page shows panels in the saved order`)
      homePanels = ['my_work', 'quick_links']; await page.evaluate(() => localStorage.removeItem('xzm_view')) }
    // arranging the staff panel for a role: hide a part, change the order, save
    await page.goto(`${BASE}/app/role-dashboards`); await page.waitForSelector('[data-staff-arrange=hub_manager]', { timeout: 10000 }).catch(() => {})
    await page.locator('[data-staff-arrange=hub_manager]').click(); await page.waitForSelector('.da-modal [data-section]')
    check(await page.locator('.da-modal [data-section]').count() === 8, `${size}: arranging the staff panel lists its eight parts`)
    await page.locator('.da-modal [aria-label="work remove"]').click()
    await page.locator('.da-modal [aria-label="bill up"]').click()
    await fits('staff panel arrange dialog')
    if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-arrange.png` }) }
    await page.locator('.da-modal-acts button').last().click(); await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 5000 }).catch(() => {})
    check(flowCalls.at(-1)?.fn === 'role_staff_sections_save' && flowCalls.at(-1)?.p_role === 'r2'
      && flowCalls.at(-1)?.p_sections?.join() === 'accounts,bill,attendance,route,complaint,issues,people', `${size}: the arranged staff panel is saved for the role`)
    // which pages a role sees: the Super Admin ticks them; a limited role gets nothing else
    await page.goto(`${BASE}/app/role-dashboards`); await page.waitForSelector('#role-pages .nv-row', { timeout: 10000 }).catch(() => {})
    await page.locator('#role-pages button', { hasText: 'পাতা বাছুন' }).click(); await page.waitForSelector('.da-modal')
    await page.locator('.da-modal .da-seg button').last().click()
    // "হাজিরার দিন মেলানো" is off the menu (HIDDEN_PAGES), so it is not offered here either
    check(await page.locator('.pg-pick label', { hasText: 'কর্মী তালিকা' }).count() === 1 && await page.locator('.pg-pick label', { hasText: 'হাজিরার দিন মেলানো' }).count() === 0, `${size}: a page taken off the menu is not offered when picking a role's pages`)
    await page.locator('.pg-pick label', { hasText: 'কর্মী তালিকা' }).locator('input').check(); await page.locator('.pg-pick label', { hasText: 'হাজিরা খাতা' }).locator('input').check()
    await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(300)
    check(flowCalls.at(-1)?.fn === 'role_menu_save' && flowCalls.at(-1)?.p_role === 'r2' && [...(flowCalls.at(-1)?.p_menu ?? [])].sort().join() === '/app/attendance,/app/staff/list', `${size}: the Super Admin picks the pages of a role (${flowCalls.at(-1)?.p_menu})`)
    // a list saved before the days page was hidden still names it: it stays off the strip but opens by its address
    menuNow = ['/app/staff/list', '/app/attendance', '/app/hub/days', '/app/accounts/khata']
    await page.goto(`${BASE}/app/staff/list`); await page.waitForSelector('.eb-chips .chip-toggle', { timeout: 10000 }).catch(() => {})
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-team.png` })
    check(await page.locator('.eb-chips .chip-toggle').count() >= 2, `${size}: the staff list opens from a limited menu and shows a chip per post`)
    const sideLinks = await page.locator('aside.side a[href^="/app/"]').evaluateAll(a => [...new Set(a.map(x => x.getAttribute('href')))])
    const hubTabs = await page.locator('.hub-tabs a').count(), ownPages = ['/app/staff', '/app/accounts/mine', '/app/fleet/mine', '/app/references'].filter(x => sideLinks.includes(x))
    const limitedMenuOk = sideLinks.includes('/app/staff/list') && sideLinks.includes('/app/attendance') && !sideLinks.includes('/app/hub/pickup') && sideLinks.length === 8 && sideLinks.includes('/app/accounts/khata') && ownPages.length === 4
    check(limitedMenuOk, `${size}: a limited role has only its pages in the menu, plus the person's own panel, accounts, vehicle and references (${sideLinks.length}: ${sideLinks.join(' ')}; tabs=${hubTabs}; khata=${sideLinks.includes('/app/accounts/khata')}; own=${ownPages.join(',')})`)
    { await page.goto(`${BASE}/app/hub/days`); await page.waitForURL(/\/app\/attendance/, { timeout: 10000 }).catch(() => {})
      check(/\/app\/attendance/.test(page.url()) && await page.locator('.center-screen .notice').count() === 0, `${size}: the old attendance days address opens the one attendance page (${page.url()})`) }
    await page.goto(`${BASE}/app/hr/attendance`); await page.waitForSelector('.center-screen .notice', { timeout: 8000 }).catch(() => {})
    check((await page.locator('.center-screen .notice').innerText().catch(() => '')).includes('চালু নেই'), `${size}: a page off the list does not open even by its address`)
    await page.goto(`${BASE}/app/hr/employees/e01`); await page.waitForSelector('.emp-head', { timeout: 8000 }).catch(() => {})
    check(await page.locator('.emp-head').count() === 1, `${size}: a person's profile still opens from the team page`)
    await page.goto(`${BASE}/app/me/permissions`); await page.waitForTimeout(900)
    const permsOpen = await page.locator('.center-screen .notice').count() === 0
    await page.goto(`${BASE}/app/me`); await page.waitForTimeout(900)
    check(permsOpen && await page.locator('.center-screen .notice').count() === 0, `${size}: a limited role can still open its own profile and "my permissions"`)
    // Staff / Manager / Zonal manager: the same attendance page and the same navigation rules for every role (frontend only; the database re-checks every call)
    { const keepMenu = menuNow, keepPerms = permsNow; menuNow = null
      const settle = async () => { await page.waitForSelector('.center-screen, .app-frame', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(500) }
      const noticeOf = async () => page.locator('.center-screen .notice').count()
      const attLinks = async () => page.locator('aside.side a[href^="/app/attendance"], .bottom-nav a[href^="/app/attendance"]').count()
      // Staff: an old hub / zone address (kept inside saved notifications) lands on the person's own page, never on "no permission"
      permsNow = ['hr.attendance.self']
      for (const old of ['/app/workforce/hub?from=note#today', '/app/workforce/zone?tab=setting', '/app/hub/attendance']) {
        await page.goto(`${BASE}${old}`); await page.waitForURL(/\/app\/attendance/, { timeout: 10000 }).catch(() => {}); await settle()
        check(/\/app\/attendance/.test(page.url()) && await noticeOf() === 0, `${size}: staff opens the old address ${old} and lands on the attendance page (${page.url()})`) }
      await page.goto(`${BASE}/app/attendance`); await page.waitForSelector('.wm, .wf', { timeout: 10000 }).catch(() => {})
      check(await page.locator('.wm .wm-tabs').count() === 0 || !(await page.locator('.wm .wm-tabs').first().innerText().catch(() => '')).match(/হাব|জোন/), `${size}: staff sees only the own attendance part, no hub or zone part`)
      await page.goto(`${BASE}/app/training`); await settle()
      check(await noticeOf() === 1, `${size}: staff cannot open the zonal-only Training page by its address`)
      // Manager: attendance read/create grants — the hub part, the Hub tab on phone, but not the zonal-only pages
      permsNow = ['hr.employee.view', 'hr.attendance.view', 'hr.attendance.create', 'org.hub.view']
      await page.goto(`${BASE}/app/attendance?view=hub`); await page.waitForSelector('.wm .wm-tabs', { timeout: 10000 }).catch(() => {})
      check(/হাব/.test(await page.locator('.wm .wm-tabs').first().innerText().catch(() => '')) && !/জোন/.test(await page.locator('.wm .wm-tabs').first().innerText().catch(() => '')), `${size}: a hub manager sees my attendance and the hub part, not the zone part`)
      check(await attLinks() > 0, `${size}: a hub manager gets an attendance link in the navigation`)
      await page.goto(`${BASE}/app/training`); await settle()
      check(await noticeOf() === 1, `${size}: a hub manager cannot open the zonal-only Training page by its address`)
      // phone tabs: a deep link lights its own tab (a profile opened from the staff list -> the team tab, a hub sub-page -> the hub tab)
      if (phone) {
        const lit = async () => page.locator('.bottom-nav a.bn-item.on').evaluateAll(a => a.map(x => x.getAttribute('href')))
        await page.goto(`${BASE}/app/hr/employees/e01`); await page.waitForSelector('.emp-head, .center-screen', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300)
        check(JSON.stringify(await lit()) === '["/app/staff/list"]', `${size}: a person's profile lights the team tab (${await lit()})`)
        await page.goto(`${BASE}/app/attendance?view=hub&tab=month`); await settle()
        check(JSON.stringify(await lit()) === '["/app/attendance?view=hub"]', `${size}: the hub part of attendance lights the hub tab (${await lit()})`)
      }
      // the quick action "হাজিরা দিন" leads to the hub part, so it is offered only with a hub attendance grant (create alone would land on the own page)
      { const quickLinks = async () => { await page.goto(`${BASE}/app`); await settle()
          await page.locator(phone ? '.bn-plus' : '.quick-btn').click().catch(() => {}); await page.waitForSelector('.quick-grid', { timeout: 5000 }).catch(() => {})
          const n = await page.locator('.quick-grid a[href^="/app/attendance"]').count(); await page.keyboard.press('Escape'); return n }
        check(await quickLinks() === 1, `${size}: a hub manager is offered the attendance quick action`)
        permsNow = ['hr.attendance.create', 'hr.employee.view', 'org.hub.view']
        check(await quickLinks() === 0, `${size}: attendance create alone is not offered a quick action that leads to the own page`)
        permsNow = ['hr.employee.view', 'hr.attendance.view', 'hr.attendance.create', 'org.hub.view'] }
      // pickup / employee grants alone: no Hub tab that leads nowhere, yet the own attendance page still opens
      permsNow = ['ops.pickup.view', 'hr.employee.view']
      await page.goto(`${BASE}/app`); await settle()
      check(await page.locator('.bottom-nav a[href^="/app/attendance"]').count() === 0, `${size}: pickup and employee grants alone do not show a Hub tab to attendance`)
      await page.goto(`${BASE}/app/attendance`); await page.waitForSelector('.wm, .wf', { timeout: 10000 }).catch(() => {})
      check(await noticeOf() === 0, `${size}: a person without hub grants still opens the own attendance page`)
      // Zonal manager: all three parts, and the zonal-only pages
      permsNow = ['zonal.dashboard.view', 'hr.attendance.view', 'hr.employee.view', 'org.hub.view', 'nodi.assistant.view']
      await page.goto(`${BASE}/app/attendance?view=zone`); await page.waitForSelector('.wm .wm-tabs', { timeout: 10000 }).catch(() => {})
      { const t = await page.locator('.wm .wm-tabs').first().innerText().catch(() => ''); check(['আমার হাজিরা', 'হাব', 'জোন'].every(x => t.includes(x)), `${size}: a zonal manager sees my attendance, hub and zone parts`) }
      await page.goto(`${BASE}/app/training`); await settle()
      check(await noticeOf() === 0, `${size}: a zonal manager opens the Training page`)
      // the role's page list failed to load: work pages stay closed behind a retry, they never open without limits
      permsNow = ['hr.employee.view', 'hr.attendance.view', 'org.hub.view']; menuFail = true
      await page.goto(`${BASE}/app/staff/list`); await settle()
      check(await noticeOf() === 1 && (await page.locator('.center-screen .notice').innerText().catch(() => '')).includes('লোড করা যায়নি') && await page.locator('.center-screen .notice button').count() === 1,
        `${size}: when the role's page list cannot be loaded, work pages show a retry instead of opening`)
      menuFail = false; await page.locator('.center-screen .notice button').click().catch(() => {}); await page.waitForSelector('.eb-chips .chip-toggle, .app-frame', { timeout: 10000 }).catch(() => {})
      check(await noticeOf() === 0, `${size}: the retry button opens the page once the list loads`)
      menuNow = keepMenu; permsNow = keepPerms }
    // Old bookmarks and notification links: each lands on the one page that took over, keeps what was asked, and on a phone lights that page's tab.
    { const keepMenu = menuNow, keepPerms = permsNow; menuNow = null
      const settle = async () => { await page.waitForSelector('.center-screen, .app-frame', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(500) }
      const ROLE = { staff: ['hr.attendance.self'], manager: ['hr.employee.view', 'hr.attendance.view', 'hr.attendance.create', 'org.hub.view'],
        zonal: ['zonal.dashboard.view', 'hr.attendance.view', 'hr.employee.view', 'org.hub.view', 'nodi.assistant.view'] }
      const lit = async () => page.locator('.bottom-nav a.bn-item.on').evaluateAll(a => a.map(x => x.getAttribute('href')))
      // [old address, where it lands (path), query parts that must survive, who may open it, the tab that is on for a manager on a phone]
      const OLD = [
        ['/app/workforce/attendance', '/app/attendance', 'view=me', 'all', null],
        ['/app/workforce/hub?tab=final&hub=h2', '/app/attendance', 'view=hub&tab=final&hub=h2', 'all', '/app/attendance?view=hub'],
        ['/app/workforce/zone?tab=final', '/app/attendance', 'view=zone&tab=final', 'all', '/app/attendance?view=hub'],
        ['/app/hub/attendance', '/app/attendance', 'view=hub', 'all', '/app/attendance?view=hub'],
        ['/app/hub/days', '/app/attendance', 'view=hub', 'all', '/app/attendance?view=hub'],
        ['/app/hub/late', '/app/attendance', 'view=hub', 'all', '/app/attendance?view=hub'],
        ['/app/hr/attendance', '/app/attendance', 'view=hub', 'all', '/app/attendance?view=hub'],
        ['/app/hub/team', '/app/staff/list', '', 'work', '/app/staff/list'],
        ['/app/hr/employees', '/app/staff/list', '', 'work', '/app/staff/list'],
        ['/app/manager/staff?tab=pending', '/app/staff/list', 'tab=pending', 'work', '/app/staff/list'],
        ['/app/zonal/staff', '/app/staff/list', '', 'work', '/app/staff/list'],
        ['/manager/staff?tab=pending', '/app/staff/list', 'tab=pending', 'work', '/app/staff/list'],
        ['/app/hr/employees/e01', '/app/hr/employees/e01', '', 'all', '/app/staff/list'],   // the profile page has no page grant on purpose (a referrer or draft owner opens one); the database decides what it returns
      ]
      // the phone's tabs follow the home view a person picked (kept in the browser); a hub manager's own view is "hub"
      const setHomeView = async v => page.evaluate(x => { try { if (x) { localStorage.setItem('xzm_view', x); sessionStorage.setItem('xzm_view', x) } else { localStorage.removeItem('xzm_view'); sessionStorage.removeItem('xzm_view') } } catch { /* ignore */ } }, v)
      for (const [role, grants] of Object.entries(ROLE)) {
        permsNow = grants; await setHomeView(role === 'manager' ? 'hub' : null)
        for (const [from, path, keep, who, tab] of OLD) {
          const open = who === 'all' || role !== 'staff'   // the staff list is a work page: a plain staff member gets "no permission", never a wrong page
          await page.goto(`${BASE}${from}`); await settle()
          const u = new URL(page.url()), notice = await page.locator('.center-screen .notice').count()
          const keeps = keep.split('&').filter(Boolean).every(kv => u.searchParams.get(kv.split('=')[0]) === kv.split('=')[1] || (role === 'staff' && /^(view|tab|hub)$/.test(kv.split('=')[0]) && who === 'all'))
          check(open ? u.pathname === path && keeps && notice === 0 : notice === 1,
            `${size}: ${role} opens the old address ${from} -> ${u.pathname}${u.search}${open ? '' : ' (no permission, as it should)'}`)
          if (phone && open && role === 'manager' && tab) check(JSON.stringify(await lit()) === JSON.stringify([tab]), `${size}: ${role} on ${from}: the tab that is on is ${await lit()}`)
        }
      }
      // notification links that did not move: still the same page, and a staff member's home tab stays on at the panel
      permsNow = ROLE.staff; await setHomeView('self')   // a staff member's home view is their own app
      for (const ok of ['/app/staff', '/app/me', '/app/hr/requests?id=r1', '/app/notices', '/app/fleet/mine']) {
        await page.goto(`${BASE}${ok}`); await settle()
        check(new URL(page.url()).pathname === ok.split('?')[0] && await page.locator('.center-screen .notice').count() === 0, `${size}: staff opens ${ok} (${new URL(page.url()).pathname})`) }
      if (phone) { await page.goto(`${BASE}/app/staff`); await settle(); check(JSON.stringify(await lit()) === '["/app"]', `${size}: a staff member's panel address lights the home tab (${await lit()})`)
        await page.goto(`${BASE}/app/me/permissions`); await settle(); check(JSON.stringify(await lit()) === '["/app/me"]', `${size}: my permissions lights the profile tab (${await lit()})`) }
      await setHomeView(null); menuNow = keepMenu; permsNow = keepPerms }
    // Office / Residential split: a page list saved before the split still opens the residential twin of its office page;
    // once Super Admin names a residential page, the list is followed exactly (Office shown, the rest of Residential hidden).
    { const blocked = async path => { await page.goto(`${BASE}${path}`); await page.waitForSelector('.center-screen .notice, .hub-tabs', { timeout: 8000 }).catch(() => {})
        return await page.locator('.center-screen .notice').count() > 0 }
      menuNow = ['/app/office/people']
      const oldListOpens = !await blocked('/app/office/residential/people')
      menuNow = ['/app/office/people', '/app/office/residential/overview']
      const exactPeopleBlocked = await blocked('/app/office/residential/people'), exactOverviewOpens = !await blocked('/app/office/residential/overview'), officeStillOpens = !await blocked('/app/office/people')
      check(oldListOpens && exactPeopleBlocked && exactOverviewOpens && officeStillOpens,
        `${size}: an old page list keeps the residential twin; a list naming residential pages is followed exactly (${[oldListOpens, exactPeopleBlocked, exactOverviewOpens, officeStillOpens].join()})`) }
    menuNow = null
    // my own khata: three parts only, then Submit
    mineOpen = true
    await page.goto(`${BASE}/app/accounts/khata`); await page.waitForSelector('.kh .da-tabs', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.kh .da-tabs button').count() === 3 && (await page.locator('.kh .nv-hero .big').innerText()).includes('৩৮,৫০০') && (phone ? await page.locator('.kh .nv-rows button.nv-row').count() === 1 : true), `${size}: "my khata" has riders, expenses and cash payments of the person only`)
    await page.locator('.kh .da-actionbar button', { hasText: 'সাবমিট করুন' }).click(); await page.waitForTimeout(300)
    check(flowCalls.at(-1)?.fn === 'da_close_my_part' && flowCalls.at(-1)?.p_done === true, `${size}: the khata is submitted from the bar at the bottom`)
    await fits('my khata')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-khata.png` })
    mineOpen = false
    await page.goto(`${BASE}/app/accounts/daily/s2/main`); await page.waitForSelector('.nv-empty', { timeout: 10000 }).catch(() => {})
    check((await page.locator('.nv-empty').innerText().catch(() => '')).includes('এখনো খোলা হয়নি'), `${size}: the daily sheet waits until khatas are accepted and it is opened`)
    await page.goto(`${BASE}/app/accounts/daily/s3/main`); await page.waitForSelector('.ms', { timeout: 10000 }).catch(() => {})
    const ms = await page.locator('.ms').innerText().catch(() => '')
    check(ms.includes('একাউন্টস টপ শীট') && ms.includes('#743858') && ms.includes('একটি পার্সেল পরের রিপোর্টে') && ms.includes('অটো ভাড়া') && ms.includes('যোগফলে ধরা হয়নি') && ms.includes('ব্যাংকে জমা বাকি') && await page.locator('.ms .nv-row', { hasText: 'খুলুন' }).count() === 1, `${size}: the daily sheet adds up the accepted khatas, with the report, expenses, documents and what is left out`)
    await fits('main sheet')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-main.png`, fullPage: true })
    await page.goto(`${BASE}/app/accounts/settings`); await page.waitForSelector('#da-set-collectors .nv-row', { timeout: 10000 }).catch(() => {})
    await page.locator('#da-set-collectors .nv-row input').first().fill('3'); await page.locator('#da-set-collectors > button').click(); await page.waitForTimeout(400)
    check(await page.locator('#da-set-collectors .nv-row').count() === 4 && flowCalls.some(c => c.fn === 'da_hub_collectors_set' && c.p_hub === 'h1' && c.p_count === 3), `${size}: settings keep how many people take the accounts at each hub`)
    await page.goto(`${BASE}/app/accounts/mine`); await page.waitForSelector('.da-stats, .panel', { timeout: 10000 }).catch(() => {})
    check((await page.locator('.nv-mine').innerText().catch(() => '')).includes('Bagatipara') && await page.locator('.nv-mine .nv-chip').count() >= 3, `${size}: "my accounts" shows the person's own lines and sheets`)
    await fits('my accounts')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-mine.png`, fullPage: true })
    // arriving through the email link: only the new-password screen opens until a password is saved
    await page.goto(`${BASE}/app#type=recovery`); await page.waitForURL(/\/app\/password/, { timeout: 8000 }).catch(() => {})
    check(/\/app\/password/.test(page.url()) && (await page.locator('.login-card h1').innerText().catch(() => '')).includes('নতুন পাসওয়ার্ড দিন'), `${size}: the email link opens the "set a new password" screen`)
    await page.locator('.login-card input[autocomplete=new-password]').nth(0).fill('Nodi12345'); await page.locator('.login-card input[autocomplete=new-password]').nth(1).fill('Nodi12345')
    await page.locator('.login-card button', { hasText: 'পাসওয়ার্ড সেভ করুন' }).click()
    await page.waitForURL(u => !/\/app\/password/.test(u.pathname), { timeout: 8000 }).catch(() => {})
    check(!/\/app\/password/.test(page.url()) && pwChanged.at(-1)?.action === 'change_password', `${size}: after saving the new password the app opens`)
    // accounts: today's sheets in the native-style list
    await page.goto(`${BASE}/app/accounts/daily`); await page.waitForSelector('.nv-row, .da-table tbody tr')
    check((await page.locator('.nv-hero .big').innerText()).includes('২ / ৪') && await page.locator('.nv-row').count() + await page.locator('.da-table tbody tr').count() >= 3, `${size}: the accounts page says how many hubs have given today's sheet`)
    check(await page.locator('.fl-line').count() >= 2 && (await page.locator('.fl-line').first().innerText()).includes('Accept'), `${size}: the list shows where each sheet stands (submitted, checked, report)`)
    await fits('daily accounts')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-accounts.png`, fullPage: true })
    await page.locator('.nv-chip', { hasText: 'শুরু হয়নি' }).click()
    check(await page.locator('.nv-row.none').count() === 1 && (await page.locator('.nv-row.none').innerText()).includes('Lalpur'), `${size}: hubs that have not started are listed with a start button`)
    await page.locator('.nv-row.none button').click(); await page.locator('.da-modal button', { hasText: 'হ্যাঁ, শুরু করুন' }).click()
    await page.waitForURL(/accounts\/daily\/s9/, { timeout: 8000 }).catch(() => {})
    check(started.at(-1)?.p_hub === 'h4' || Object.values(started.at(-1) ?? {}).includes('h4'), `${size}: a sheet is started for the chosen hub`)
    // the chat view: list on the left, the conversation on the right (on a phone: one at a time)
    await page.goto(`${BASE}/app/issues`); await page.waitForSelector('.mg-row')
    check(await page.locator('.mg-row').count() === 5 && await page.locator('.mg-row.grp .mg-n').innerText() === '2' && await page.locator('.mg-row.zgrp .mg-n').innerText() === '3', `${size}: issues, orders, the hub group and the zone group sit in one chat-like list`)
    await fits('issue chat list')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-chat-list.png` })
    await page.locator('.mg-row', { hasText: 'কাস্টমার ফোন ধরছে না' }).click(); await page.waitForSelector('.mg-msg')
    check(await page.locator('.mg-msg').count() === 2 && await page.locator('.mg-sys').count() === 1 && await page.locator('.mg-side').isVisible() === !phone, `${size}: an issue opens as a conversation (${phone ? 'full screen' : 'beside the list'})`)
    await page.locator('.mg-foot textarea').fill('কাস্টমারকে পাওয়া গেছে'); await page.locator('.mg-acts button', { hasText: 'সমাধান হয়েছে' }).click()
    await page.waitForFunction(() => !document.querySelector('.mg-foot textarea')?.value, null, { timeout: 8000 }).catch(() => {})
    check(acted.at(-1)?.p_action === 'solve' && acted.at(-1)?.p_note === 'কাস্টমারকে পাওয়া গেছে' && acted.at(-1)?.p_id === 'i2', `${size}: the job is finished from the box under the conversation`)
    await fits('issue conversation')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-chat-open.png` })
    if (phone) { await page.locator('.mg-head .back').click(); await page.waitForSelector('.mg-side', { state: 'visible' }) }
    await page.locator('.mg-row.grp').click(); await page.waitForSelector('.mg-msg .mg-col')
    check(await page.locator('.mg-msg').count() === 2 && (await page.locator('.mg-msg').last().innerText()).includes('আজ সব ডেলিভারি'), `${size}: the hub group reads like a chat, newest at the bottom`)
    await page.locator('.mg-foot textarea').fill('ঠিক আছে'); await page.locator('.mg-foot textarea').press('Enter')
    await page.waitForFunction(() => !document.querySelector('.mg-foot textarea')?.value, null, { timeout: 8000 }).catch(() => {})
    check(posted.at(-1)?.p_body === 'ঠিক আছে' && posted.at(-1)?.p_hub === 'h1', `${size}: Enter sends a message to the group`)
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-chat-group.png` })
    if (phone) await page.locator('.mg-head .back').click()
    // the board view, and each person's own settings
    await page.locator('.mg-view button', { hasText: 'বোর্ড' }).click(); await page.waitForSelector('.bd-col')
    if (!phone) { check(await page.locator('.mg-drawer .mg-chat').count() === 1, `${size}: an open conversation stays open when the view changes`); await page.locator('.mg-drawer .back').click() }
    check(await page.locator('.bd-col').count() === 3 && await page.locator('.bd-card').count() === 3 && await page.locator('.bd-col.s-solved .bd-card').count() === 1, `${size}: the board puts every issue under its step`)
    await fits('issue board')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-board.png` })
    await page.locator('.bd-card .bd-open').first().click(); await page.waitForSelector('.mg-drawer .mg-msg')
    check(await page.locator('.mg-drawer .mg-chat').count() === 1, `${size}: a board card opens the same conversation in a side sheet`)
    await page.locator('.mg-drawer .back').click()
    await page.reload(); await page.waitForSelector('.bd-col')
    check(await page.locator('.bd-col').count() === 3, `${size}: the chosen view is remembered`)
    await page.locator('.mg-ic[aria-label="আমার সেটিং"]').click(); await page.waitForSelector('.mg-set')
    await page.locator('.mg-set button', { hasText: 'চ্যাট' }).click(); await page.locator('.mg-set button', { hasText: 'ছোট' }).click()
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-settings.png` })
    await page.locator('.da-modal button', { hasText: 'ঠিক আছে' }).click()
    check(await page.locator('.mg.dense').count() === 1, `${size}: "my settings" changes the view and the size of the list`)
    await page.evaluate(() => localStorage.removeItem('xzm_issues_ui'))
    await fits('orders tab')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-orders.png`, fullPage: true })

    // Nodi asks a person about their days without attendance; leave is filed from the same card
    withGaps = true
    await page.goto(`${BASE}/app`); await page.waitForSelector('.nodi-gaps .ng-days')
    check(await page.locator('.nodi-gaps .ng-days .chip-toggle.on').count() === 3, `${size}: Nodi's card lists the person's days without attendance, all ticked`)
    await page.locator('.nodi-gaps select').selectOption('lt1'); await page.locator('.nodi-gaps .da-form input').fill('জ্বর ছিল')
    await fits('dashboard with Nodi card')
    if (process.env.SHOTS) await page.locator('.nodi-gaps').screenshot({ path: `${process.env.SHOTS}/${size}-nodi.png` })
    await page.locator('.nodi-gaps .row-acts button').click()
    await page.waitForFunction(() => !!document.querySelector('.nodi-gaps .notice'), null, { timeout: 5000 }).catch(() => {})
    check(answered.length === 1 && answered[0].p_kind === 'leave' && answered[0].p_leave_type === 'lt1' && answered[0].p_dates.length === 3 && answered[0].p_note === 'জ্বর ছিল',
      `${size}: the answer files leave for the ticked days`)
    withGaps = false

    // the Zonal Assistant's panel: gaps of every hub, check an answer, remind the rest
    await page.goto(`${BASE}/app/zonal/assistant`); await page.waitForSelector('.za-hubs')
    const gapSel = '.da-table tbody tr, .dv-list > li'
    await page.waitForSelector(gapSel)
    check(await page.locator(gapSel).count() === 4 && await page.locator('.za-hub').count() === 2, `${size}: the assistant's panel shows the gaps and a card per hub`)
    await page.locator('input[aria-label^="সারি"]').nth(1).check(); await page.waitForSelector('.dv-bulk')
    await page.locator('.dv-bulk button').first().click()
    await page.waitForFunction(() => !document.querySelector('.dv-bulk'), null, { timeout: 5000 }).catch(() => {})
    check(checked.length === 1 && checked[0].p_ok === true && JSON.stringify(checked[0].p_ids) === '["a1"]', `${size}: a ticked answer is marked checked`)
    await fits('assistant panel')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-assistant.png`, fullPage: true })

    // training centre: lessons for this role, Nodi finds the right one, a lesson can be ticked as learned
    await page.goto(`${BASE}/app/training`); await page.waitForSelector('.tr-card')
    check(await page.locator('.tr-card').count() >= 12, `${size}: the training centre lists the lessons`)
    await page.locator('.tr-ask input').fill('ছুটির আবেদন কীভাবে দেব')
    check((await page.locator('.tr-answer').first().innerText().catch(() => '')).includes('ছুটি'), `${size}: asking Nodi finds the leave lesson`)
    await page.locator('.tr-answer').first().click(); await page.waitForSelector('.tr-card.open .tr-body')
    await page.locator('.tr-card.open .row-acts button').click()
    check(await page.locator('.tr-card.done').count() === 1, `${size}: a lesson can be ticked as learned`); await fits('training centre')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-training.png` })

    // staff list: post chips, leave chip, search, View / Edit on every row, and an action on several marked rows
    // A hub filter this device remembered from the list's own filter bar (before the page had its own filters)
    // must not hide staff: it once left 2 rows on screen while the page's cards said 145.
    await page.evaluate(() => { try { const all = JSON.parse(localStorage.getItem('xzm_dataview') || '{}'); all.employees = { ...all.employees, filters: { hub: ['Natore Sadar #80'] } }; localStorage.setItem('xzm_dataview', JSON.stringify(all)) } catch { /* ignore */ } })
    await page.goto(`${BASE}/app/hr/employees`); const staffSel = '.emp-board .da-table tbody tr, .emp-board .dv-list > li'   // table on a PC, compact list on a phone
    await page.waitForSelector(staffSel)
    const staffRowsShown = () => page.locator(staffSel).count()
    check(await staffRowsShown() === 12 && (await page.locator('.eb-chips').innerText()).includes('Rider'), `${size}: the staff list shows everyone with a chip per post (${await staffRowsShown()})`)
    check(await page.locator('.emp-board .dv-fbtn').count() === 0 && (await page.locator('.eb-count').innerText()).includes('১২ জনের মধ্যে ১২ জন'),
      `${size}: the staff list has one set of filters, and its heading counts what is on screen`)
    check(await page.locator(staffSel).first().locator('.row-acts button').count() === 2, `${size}: every row has Edit and View`)
    { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), (async () => { await page.locator('.hr-more button').click(); await page.getByRole('menuitem', { name: /আইডি তৈরির ফাইল/ }).click() })()])
      const sent = exported.at(-1), asked = flowCalls.findLast(c => c.fn === 'hr_sheet_people')
      check(!!dl && /^New-Admin-Rider-ID-Creat-Information \d{4}-\d\d-\d\d\.xlsx$/.test(dl.suggestedFilename()) && sent?.p_status === 'active' && asked?.p_ids?.join() === 'e02,e01'
        && ['nid_number', 'cf:blood_group', 'doc:nid_front', 'basic_salary'].every(f => asked.p_fields.includes(f)), `${size}: the staff page makes the company's ID Create sheet`)
      if (dl && process.env.KEEP_ID_FILE) await dl.saveAs(process.env.KEEP_ID_FILE) }
    await page.locator('.eb-chips .chip-toggle').last().click()
    check(await staffRowsShown() === 1, `${size}: the leave chip shows who is on leave today`)
    await page.locator('.eb-chips .chip-toggle').first().click()
    await page.locator('.emp-board .emp-search input').fill('১০০৭')
    check(await staffRowsShown() === 1, `${size}: the staff search finds an ID typed in Bangla digits`)
    await page.locator('.emp-board .emp-search input').fill(''); await fits('staff list')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-list.png`, fullPage: true })
    await page.locator('.emp-board input[aria-label^="সারি"]').nth(0).check(); await page.locator('.emp-board input[aria-label^="সারি"]').nth(1).check()
    await page.waitForSelector('.dv-bulk')
    await page.locator('.dv-bulk button.danger').click(); await page.waitForSelector('.da-modal input')
    await page.locator('.da-modal input').fill('একই লোক দুবার'); await page.locator('.da-modal-acts button.danger').click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
    check(removed.length === 2 && removed.every(x => x.p_reason === 'একই লোক দুবার' && /^e\d\d$/.test(x.p_employee)), `${size}: marked rows can be removed together as mistaken entries (${removed.length})`)

    // profile: the list's Edit button opens the edit form; a wrong ID can be corrected
    await page.goto(`${BASE}/app/hr/employees/e01?edit=1`); await page.waitForSelector('.da-modal input', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.da-modal input').first().inputValue().catch(() => '') === 'Staff 01', `${size}: Edit from the list opens the person's edit form`)
    await page.locator('.da-modal-acts button.secondary').click()
    await fits('staff profile')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-profile.png`, fullPage: true })
    await page.locator('.nv-qa', { hasText: 'এডিট' }).click(); await page.waitForSelector('.da-modal input', { timeout: 6000 }).catch(() => {})
    check(await page.locator('.da-modal input').first().inputValue().catch(() => '') === 'Staff 01' && await page.locator('.nv-qa').count() >= 4, `${size}: the round Edit button on the profile opens the edit form`)
    await page.locator('.da-modal-acts button.secondary').click()
    await page.getByRole('button', { name: 'আইডি সংশোধন' }).click(); await page.waitForSelector('.da-modal input[inputmode=numeric]')
    await page.locator('.da-modal input[inputmode=numeric]').fill('5555'); await page.locator('.da-modal textarea').fill('টাইপের ভুল')
    await page.locator('.da-modal-acts button').last().click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
    check(recoded.length === 1 && recoded[0].p_code === '5555' && recoded[0].p_employee === 'e01' && recoded[0].p_reason === 'টাইপের ভুল', `${size}: a wrong Employee ID is corrected from the profile`)
    await fits('staff profile')

    // logins for all staff: the role comes from the post, the Employee ID becomes the login, people without an ID are left out
    await page.goto(`${BASE}/app/users?bulk=1`); await page.waitForSelector('.bl-map tbody tr')
    check(await page.locator('.bl-map tbody tr').count() === 1 && await page.locator('.bl-map select').inputValue() === 'r3', `${size}: the bulk screen lists each post with its remembered role`)
    await fits('bulk logins form')
    await page.locator('.da-modal input[autocomplete=new-password]').fill('Natore2026')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-bulk.png`, fullPage: true })
    await page.locator('.da-modal-acts button').last().click()
    // the app's own "start?" box (it used to be the browser's confirm)
    await page.locator('.da-modal', { hasText: 'শুরু করবেন?' }).locator('.da-modal-acts button', { hasText: 'শুরু করুন' }).click()
    await page.waitForFunction(() => /শেষ হয়েছে/.test(document.querySelector('.da-modal')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {})
    const bulkMade = accounts.filter(a => a.password === 'Natore2026')
    check(bulkMade.length === 12 && bulkMade.every(a => a.action === 'create' && /^id-10\d\d@xzmteam\.com$/.test(a.email) && a.role_id === 'r3' && a.scope_type === 'hub'
      && a.hub_id === 'h2' && a.password === 'Natore2026' && /^e\d\d$/.test(a.employee_id)), `${size}: one login per staff member with an ID, role and hub from their record (${bulkMade.length})`)

    // roll-out progress: hubs, then the people of a hub with where each one is stuck
    await page.goto(`${BASE}/app/rollout`); await page.waitForSelector('.ro-steps')
    await page.waitForSelector('.da-table tbody tr')
    check(await page.locator('.da-table tbody tr').count() === 2, `${size}: roll-out progress lists the hubs`); await fits('roll-out page')
    await page.locator('.da-table tbody tr').first().click(); await page.waitForFunction(() => document.querySelectorAll('.da-table').length === 2, null, { timeout: 5000 }).catch(() => {})
    check((await page.locator('.da-table').nth(1).innerText().catch(() => '')).includes('লগইন নেই'), `${size}: a hub opens to its people and where each is stuck`)
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-rollout.png`, fullPage: true })

    // my own mobile number
    asEmployee = true
    await page.goto(`${BASE}/app/me`); await page.waitForSelector('#mobile input')
    await page.locator('#mobile input').fill('০১৭১১০০০০০০'); await page.locator('#mobile button').first().click()
    await page.waitForFunction(() => true, null, { timeout: 100 }); await page.waitForTimeout(400)
    check(mobiles.length === 1 && mobiles[0].p_mobile === '01711000000', `${size}: a person saves their own mobile number (Bangla digits accepted)`)
    await fits('my profile')
    // staff desk: someone who acts only for themselves gets plain words instead of format names
    plainStaff = true
    // a staff member's home page is the staff panel
    await page.goto(`${BASE}/app`); await page.waitForSelector('.sp .nv-row', { timeout: 10000 }).catch(() => {})
    check(await page.locator('.sp-hero').count() === 1 && await page.locator('.bottom-nav a[href="/app/staff"]').count() === 0, `${size}: a staff member's home is the staff panel`)
    // staff panel: one screen with the person's whole day, in the owner's order
    await page.goto(`${BASE}/app/staff`); await page.waitForSelector('.sp .nv-row')
    await page.waitForFunction(() => document.querySelector('.sp')?.textContent?.includes('১ জন'), null, { timeout: 5000 }).catch(() => {})
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-panel.png`, fullPage: true })
    check(await page.locator('.app-dl').count() === 1, `${size}: the staff panel ends with the Android app card`)
    { const sp = await page.locator('.sp').innerText()
      // Today's attendance is not given yet, so it comes first; the rest keep the owner's order.
      const order = ['আজকের হাজিরা', 'আমার হিসাব', 'পিকআপ ও ডেলিভারি খাতা', 'আমার বিল', 'আমার রুট ও দায়িত্ব', 'আমার অভিযোগ', 'ইস্যু ও যোগাযোগ', 'আমার লোক'].map(x => sp.indexOf(x))
      check(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])) && ['আমাকে দেওয়া ইস্যু', 'হাব গ্রুপ', 'জোন গ্রুপ', 'জোনাল ম্যানেজার', 'আমার হাতে লোক আছে'].every(x => sp.includes(x)),
        `${size}: the staff panel shows attendance (not given yet) first, then accounts, the pickup and delivery forms, bill, route, complaint, issues and my people, in that order`)
      check(await page.locator('.sp-hero a.sp-att.go[href="#sp-att"]', { hasText: 'হাজিরা দিন' }).count() === 1, `${size}: the hero's "give attendance" badge takes you to the attendance buttons`)
      check(await page.locator('.sp-hero .hoodie-av').count() === 1 && await page.locator('.sp-hero .my-av-cam input[type=file][accept="image/*"]').count() === 1,
        `${size}: with no photo the staff panel shows the hoodie avatar, with a button to put up my own photo`)
      check(await page.locator('.sp a.nv-row[href="/app/workforce/hand"]').count() === 1 && await page.locator('.sp a.nv-row[href="/app/workforce/given"]').count() === 1 && await page.locator('.sp .nv-row.none', { hasText: 'হাবে এসেছি' }).count() === 0, `${size}: staff panel people rows open their personal workforce pages`)
      check(await page.locator('.sp a.nv-row[href="/app/issues?tab=zone&z=z1"]', { hasText: 'জোন গ্রুপ — Natore Area' }).count() === 1 && await page.locator('.sp .sp-soon').count() === 0,
        `${size}: the zone group row opens my zone's group, with nothing left marked "soon"`)
      await page.locator('.sp button.nv-row', { hasText: 'জোনাল ম্যানেজার — Zonal Karim' }).click(); await page.waitForSelector('.da-modal .zm-acts')
      check(await page.locator('.da-modal a[href="tel:01711999999"]').count() === 1 && await page.locator('.da-modal a[href="https://wa.me/8801711999999"]').count() === 1, `${size}: the zonal manager sheet calls, texts and WhatsApps the right number`)
      await fits('zonal manager sheet')
      await page.locator('.da-modal textarea').fill('হাবে ফ্যান নষ্ট'); await page.locator('.da-modal-acts button').first().click(); await page.waitForTimeout(400)
      check(flowCalls.at(-1)?.fn === 'zone_manager_tell' && flowCalls.at(-1)?.p_zone === 'z1' && flowCalls.at(-1)?.p_body === 'হাবে ফ্যান নষ্ট', `${size}: a written note goes to the zonal manager`)
      await page.goto(`${BASE}/app/issues?tab=zone&z=z1`); await page.waitForSelector('.mg-chat .mg-msg', { timeout: 8000 }).catch(() => {})
      check((await page.locator('.mg-chat').innerText().catch(() => '')).includes('আজ সবাই সময়মতো রিপোর্ট দিন') && await page.locator('.mg-chip.on', { hasText: 'জোন গ্রুপ' }).count() === 1,
        `${size}: the zone group opens as a chat`)
      await fits('zone group chat') }
    staffSecs = ['bill', 'accounts']
    await page.goto(`${BASE}/app/staff`); await page.waitForSelector('.sp .sd-h')
    check((await page.locator('.sp h2.sd-h').allInnerTexts()).join(' > ') === 'আমার বিল > আমার হিসাব', `${size}: the staff panel shows only the parts set for the role, in that order`)
    staffSecs = null
    await page.goto(`${BASE}/app/staff`); await page.waitForSelector('.sp .nv-row')
    { const before = flowCalls.length
      await page.locator('.sp button.nv-row', { hasText: 'হাবে এসেছি' }).click(); await page.waitForTimeout(400)
      check(flowCalls.length === before + 1 && flowCalls.at(-1)?.fn === 'att_self_mark' && flowCalls.at(-1)?.p_kind === 'present', `${size}: one tap gives today's attendance for the manager to approve`)
      await page.locator('.sp button.nv-row', { hasText: 'আজ আসব না' }).click(); await page.waitForSelector('#sp-absent')
      check(await page.locator('.da-modal-acts button').last().isDisabled(), `${size}: "not coming" needs a reason`)
      await page.locator('#sp-absent').fill('জ্বর'); await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(400)
      check(flowCalls.at(-1)?.fn === 'att_self_mark' && flowCalls.at(-1)?.p_kind === 'absent' && flowCalls.at(-1)?.p_note === 'জ্বর', `${size}: "not coming" is sent with the reason`) }
    await fits('staff panel home')
    // আমার গাড়ি: the auto driver reports a hub, puts up fuel, asks for service in the set format, and sees the garage bill
    await page.goto(`${BASE}/app/fleet/mine`); await page.waitForSelector('.fl-act', { timeout: 10000 }).catch(() => {})
    check((await page.locator('.fl').innerText()).includes('রহিম গ্যারেজ') && (await page.locator('.fl').innerText()).includes('V-2611-00004'), `${size}: the driver sees the garage bill and the allowance voucher`)
    await fits('my vehicle')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-fleet-mine.png`, fullPage: true })
    await page.locator('.fl-act', { hasText: 'হাব রিপোর্ট' }).click(); await page.waitForSelector('#fl-hub')
    await page.locator('#fl-hub').selectOption('h2'); await page.locator('.fl-st', { hasText: 'আনলোডে দেরি' }).click(); await page.locator('.da-modal input[type=number]').fill('30')
    await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(300)
    { const c = flowCalls.at(-1) ?? {}; check(c.fn === 'fleet_hub_report' && c.p_hub === 'h2' && c.p_status === 'unload_late' && c.p_minutes === 30, `${size}: the driver reports late unloading at a hub`) }
    await page.locator('.fl-act', { hasText: 'তেল' }).click(); await page.waitForSelector('#fl-amount')
    await page.locator('#fl-amount').fill('1050'); await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(300)
    { const c = flowCalls.at(-1) ?? {}; check(c.fn === 'vehicle_log_save' && c.p_kind === 'fuel' && c.p_amount === 1050, `${size}: the driver puts up fuel for approval`) }
    { const before = flowCalls.length
      await page.locator('.fl-act', { hasText: 'সার্ভিস' }).click(); await page.waitForSelector('#fl-title')
      await page.locator('.da-modal-acts button').last().click(); await page.waitForSelector('.da-modal .da-error')
      check(flowCalls.length === before, `${size}: a request is not sent without the required box`)
      await page.locator('.da-modal .nv-chip', { hasText: 'ব্রেক' }).click(); await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(300)
      const c = flowCalls.at(-1) ?? {}; check(c.fn === 'fleet_request' && c.p_kind === 'service' && c.p_data?.what === 'ব্রেক', `${size}: the driver asks for service in the set format`) }
    await page.goto(`${BASE}/app/staff`); await page.waitForSelector('.sp .nv-row')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-panel.png`, fullPage: true })
    await page.locator('.sp-cta').click(); await page.waitForSelector('.da-modal', { timeout: 8000 }).catch(() => {})
    check(await page.locator('.da-modal input[type=number]').count() === 1 && !page.url().includes('bill='), `${size}: "put up today's bill" opens the bill form at once`)
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-bill.png` })
    await page.goto(`${BASE}/app/hr/requests`); await page.waitForSelector('.sd .nv-row')
    await page.waitForFunction(() => document.querySelector('.sd')?.textContent?.includes('১ জন'), null, { timeout: 5000 }).catch(() => {})
    { const desk = await page.locator('.sd').innerText()
      check(['আমার প্রোফাইল দেখুন', 'আমার হাতে লোক আছে', 'আমি যাদের নিয়ে এসেছি', 'আমি চাকরি করবো না', 'আমার প্যানেল বন্ধ হয়ে গিয়েছে', 'আইডি 1001'].every(t => desk.includes(t)) && !desk.includes('ID ACTIVE') && !desk.includes('INACTIVE'),
        `${size}: a staff member's panel speaks plain Bangla (profile, my people, leaving, panel closed)`) }
    await fits('staff panel')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-desk.png`, fullPage: true })
    { const before = flowCalls.length
      await page.locator('.sd .nv-row', { hasText: 'আমি চাকরি করবো না' }).click(); await page.waitForSelector('.da-modal textarea')
      check(await page.locator('.da-modal select').count() === 0 && await page.locator('.da-modal input[type=date]').count() === 1, `${size}: leaving asks only the last day and the reason`)
      if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-leave.png` }) }
      await page.locator('.da-modal-acts button').last().click(); await page.waitForSelector('.da-modal .da-error')
      check(flowCalls.length === before, `${size}: leaving is not sent without a reason`)
      await page.locator('.da-modal textarea').fill('বাড়ি চলে যাচ্ছি'); await page.locator('.da-modal-acts button').last().click()
      await page.waitForFunction(() => location.search.includes('tab=list'), null, { timeout: 5000 }).catch(() => {})
      const c = flowCalls.at(-1) ?? {}
      check(flowCalls.length === before + 1 && c.fn === 'hr_request_submit' && c.p_format === 'f-leave' && c.p_employee === 'e01' && c.p_data?.reason_type === 'চাকরি ছেড়ে দিচ্ছি'
        && c.p_data?.reason === 'বাড়ি চলে যাচ্ছি' && c.p_data?.employee_code === '1001' && !!c.p_data?.last_date, `${size}: "I will not work any more" goes to the office as a leaving request`) }
    { const before = flowCalls.length
      await page.goto(`${BASE}/app/hr/requests?tab=new&do=active`); await page.waitForSelector('.da-modal textarea')
      await page.locator('.da-modal textarea').fill('প্যানেলে ঢুকতে পারছি না'); await page.locator('.da-modal-acts button').last().click()
      await page.waitForFunction(() => location.search.includes('tab=list'), null, { timeout: 5000 }).catch(() => {})
      const c = flowCalls.at(-1) ?? {}
      check(flowCalls.length === before + 1 && c.p_format === 'f-active' && c.p_employee === 'e01' && c.p_data?.reason === 'প্যানেলে ঢুকতে পারছি না' && !!c.p_data?.effective_date, `${size}: "my panel is closed" goes to the office as a switch-on request`) }
    await page.goto(`${BASE}/app/hr/requests?tab=new&do=brought`); await page.waitForSelector('.sd .nv-row')
    check((await page.locator('.sd').innerText()).includes('Karim Mia'), `${size}: the people I brought are listed`); await fits('people I brought')
    await page.goto(`${BASE}/app/hr/requests?tab=new&do=hand`); await page.waitForSelector('.sd .nv-empty button')
    await page.locator('.sd .nv-empty button').click(); await page.waitForSelector('.da-modal input')
    await page.locator('.da-modal input').first().fill('Jamal Hossain'); await page.locator('.da-modal-acts button').last().click()
    await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 5000 }).catch(() => {})
    check(prospects.at(-1)?.full_name === 'Jamal Hossain' && prospects.at(-1)?.referrer_id === 'e01', `${size}: a person in hand is saved under my name`)
    await page.locator('.sd-top button').first().click(); await page.waitForSelector('.sd-hero')
    check(await page.locator('.sd-hero').count() === 1, `${size}: "go back" returns to the staff panel`)
    plainStaff = false
    asEmployee = false

    // new staff form: the mobile box tidies and checks itself, and warns about a number that is already used
    await page.goto(`${BASE}/app/zonal/staff`)
    await page.getByRole('button', { name: /নতুন কর্মী|New staff/ }).first().click(); await page.waitForSelector('.da-modal input[inputmode=tel]')
    const mobile = page.locator('.da-modal input[inputmode=tel]')
    await mobile.fill('0171'); await mobile.blur()
    check(await page.locator('.da-modal .field-err').count() === 1, `${size}: a wrong mobile number is flagged as soon as the box is left`)
    await mobile.fill('+৮৮ ০১৭১১-০০০০০০'); await mobile.blur()
    const formattedMobile = await page.waitForFunction(() => document.querySelector('.da-modal input[inputmode=tel]')?.value === '01711-000000', undefined, { timeout: 5000 }).then(() => true, () => false)
    check(formattedMobile, `${size}: Bangla digits, +88 and dashes are tidied and shown as 01711-000000 (input mask)`)
    await page.waitForSelector('.da-modal .dup-note', { timeout: 5000 }).catch(() => {})
    check((await page.locator('.da-modal .dup-note').innerText().catch(() => '')).includes('Staff 01'), `${size}: a mobile number that is already used is flagged with the person's name`)
    await fits('new staff form')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff.png` })

    // the same form: two steps, inline errors, auto focus, auto saved draft, and a check before it is sent
    { const modal = page.locator('.da-modal').first()
      const name = modal.locator('input[autocomplete=name]')
      check(await modal.locator('.stepper li').count() === 2 && await modal.locator('.da-field.fl').count() === 2, `${size}: new staff form has a step bar and floating labels`)
      await name.fill(''); await mobile.fill('01800000000')
      await modal.getByRole('button', { name: /পরের ধাপ/ }).click(); await page.waitForTimeout(120)
      check(await modal.locator('.stepper li.now').innerText().then(t => t.includes('ব্যক্তি')) && (await modal.locator('.field-err').allInnerTexts()).some(t => t.includes('পূর্ণ নাম দিন')),
        `${size}: an empty required name stops the next step and is explained under the box`)
      check(await name.evaluate(el => el === document.activeElement), `${size}: the cursor goes to the box that needs fixing`)
      await name.fill('Test Person')
      await page.waitForFunction(() => document.querySelector('.da-modal .draft-bar')?.textContent?.includes('খসড়া') && !document.querySelector('.da-modal .draft-bar.back'), null, { timeout: 4000 }).catch(() => {})
      check((await modal.locator('.draft-bar').innerText().catch(() => '')).includes('খসড়া'), `${size}: typing is auto saved as a draft`)
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 4000 }).catch(() => {})
      await page.getByRole('button', { name: /নতুন কর্মী|New staff/ }).first().click(); await page.waitForSelector('.da-modal input[autocomplete=name]')
      check(await name.inputValue() === 'Test Person' && await mobile.inputValue() === '01800-000000' && await modal.locator('.draft-bar.back').count() === 1,
        `${size}: an unfinished form comes back after it was closed (draft)`)
      await modal.getByRole('button', { name: /পরের ধাপ/ }).click(); await page.waitForSelector('.da-modal .cb input')
      check(await page.evaluate(() => document.activeElement?.matches('.da-modal .cb input') ?? false), `${size}: the next step puts the cursor in its first box`)
      await modal.getByRole('button', { name: /আবেদন খুলুন/ }).click(); await page.waitForTimeout(120)
      check((await modal.locator('.field-err').allInnerTexts()).some(t => t.includes('হাব বেছে নিন')), `${size}: a missing hub is shown under the hub box`)
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-step2.png` })
      await modal.locator('.cb input').click(); await page.locator('.da-modal .cb-list li[role=option]').first().click()
      await modal.locator('select').last().selectOption('p1')
      await modal.getByRole('button', { name: /আবেদন খুলুন/ }).click(); await page.waitForSelector('.confirm-rows', { timeout: 4000 }).catch(() => {})
      check((await page.locator('.confirm-rows').innerText().catch(() => '')).includes('Test Person'), `${size}: before sending, a summary asks to confirm`)
      if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff-confirm.png` }) }
      await page.getByRole('button', { name: /ফিরে গিয়ে বদলান/ }).click(); await page.waitForTimeout(100)
      check(await page.locator('.confirm-rows').count() === 0 && await page.locator('.da-modal .stepper').count() === 1, `${size}: "go back and change" keeps the form open`)
      await page.locator('.da-modal .draft-bar button').click(); await page.waitForTimeout(100)
      check(await page.locator('.da-modal input[autocomplete=name]').inputValue() === '', `${size}: "start over" throws the draft away`)
      await page.keyboard.press('Escape')
    }

    // ---- Advanced role & permission management (website only for now) ----
    { const box = (sub, i) => page.locator(`.ax-row[data-sub="${sub}"] .ax-c`).nth(i).locator('button')
      const closed = () => page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
      await page.goto(`${BASE}/app/access`); await page.waitForSelector('.ax-guide .ax-g')
      check(await page.locator('.ax-guide .ax-g').count() === 10 && await page.locator('.ax-tabs a').count() === 6, `${size}: the access centre lists the ten functions and its six parts`)
      await fits('access centre')
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-access.png` })
      await page.goto(`${BASE}/app/roles`); await page.waitForSelector('.ax-role')
      check(/\/app\/access\/roles$/.test(page.url()) && await page.locator('.ax-role').count() === 3, `${size}: the old role address opens the new role list`)
      // a role: module -> sub-menu -> view / create / edit / delete / approve / export, and its pages
      await page.locator('.ax-role[data-role=hub_manager]').click(); await page.waitForSelector('.ax-mod button.ax-box')
      const roleHead = (await page.locator('.ax-mod[data-module=hr] .ax-row.ax-head span').allTextContents()).join('|'), roleModuleCount = await page.locator('.ax-mod').count()
      check(roleHead === 'সাব-মেনু|পাতা|দেখা|তৈরি|এডিট|ডিলিট|অনুমোদন|এক্সপোর্ট' && roleModuleCount >= 9,
        `${size}: a role is set by module and sub-menu, with a page column and the six kinds of access (modules=${roleModuleCount}; columns=${roleHead})`)
      await box('/app/hr/leave', 4).click()   // approve: gives hr.leave.approve + hr.leave.reject
      await page.getByRole('button', { name: 'শুধু টিক দেওয়া পাতা' }).click()
      await page.locator('.ax-row[data-sub="/app/attendance"] .ax-pg button').click()
      check((await page.locator('.ax-savebar .tx').innerText()).includes('+২') && await box('/app/hr/leave', 4).evaluate(e => e.classList.contains('m-plus')), `${size}: unsaved changes are counted and marked on the box`)
      await fits('role builder')
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-access-role.png` })
      await page.locator('.ax-savebar button', { hasText: 'দেখে সেভ করুন' }).click(); await page.waitForSelector('.da-modal .ax-review')
      check(await page.locator('.da-modal .ax-review li').count() === 2 && (await page.locator('.da-modal .ax-review-pages').innerText()).includes('হাজিরা'), `${size}: the review lists what is given and which page goes off`)
      await page.locator('.da-modal-acts button').last().click(); await closed()
      { const save = flowCalls.filter(c => c.fn === 'role_admin_save').at(-1) ?? {}, menu = flowCalls.filter(c => c.fn === 'role_menu_save').at(-1) ?? {}
        const permissionsSaved = save.p_id === 'r2' && ['hr.leave.approve', 'hr.leave.reject', 'hr.attendance.view'].every(x => save.p_permissions?.includes(x)) && save.p_permissions?.length === 5
        const pagesSaved = menu.p_role === 'r2' && menu.p_menu?.includes('/app/hr/leave') && !menu.p_menu?.includes('/app/attendance') && menu.p_menu?.includes('/app/accounts/khata') && !menu.p_menu?.includes('/app/access') && !menu.p_menu?.includes('/app/roles')
        check(permissionsSaved && pagesSaved, `${size}: the role's permissions and its page list are saved (permissions=${JSON.stringify(save.p_permissions)}; role=${menu.p_role}; pages=${JSON.stringify(menu.p_menu)})`) }
      // one person: hub / zone limit and personal permissions
      await page.goto(`${BASE}/app/access/users`); await page.waitForSelector('main :text("Sohel Sardar")')
      check((await page.locator('main').innerText()).includes('পুরো কোম্পানি') || (await page.locator('main').innerText()).includes('সব ক্ষমতা'), `${size}: the user list shows how far each person's data reaches`)
      await page.goto(`${BASE}/app/access/user/u2`); await page.waitForSelector('.ax-urole'); await page.waitForSelector('#own .ax-mod, #own .notice')
      check(await page.locator('#own .notice').count() === 1 && await page.locator('[data-own-edit]').count() === 0 && await page.locator('#own .ax-mod').count() >= 1,
        `${size}: before the database update, personal permissions say so and the rest still shows`)
      await page.locator('.ax-urole button', { hasText: 'সীমা বদলান' }).click(); await page.waitForSelector('.da-modal .ax-place .chip-toggle')
      await page.locator('.da-modal .chip-toggle', { hasText: 'Lalpur' }).click()
      await fits('data limit dialog')
      if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/${size}-access-limit.png` }) }
      await page.locator('.da-modal-acts button').last().click(); await closed()
      { const c = flowCalls.filter(x => x.fn === 'user_admin_assign_role').at(-1) ?? {}
        check(c.p_user === 'u2' && c.p_role === 'r2' && c.p_scope === 'hub' && c.p_hub === 'h2' && !flowCalls.some(x => x.fn === 'user_admin_revoke_role'), `${size}: hub-wise limit — a second hub is added to the role, nothing removed`) }
      ownInstalled = true
      await page.goto(`${BASE}/app/access/user/u2`); await page.waitForSelector('[data-own-edit]')
      check(await page.locator('[data-own-list] .ax-ownchip.plus').count() === 1, `${size}: a personal extra shows as a chip with its place and end date`)
      await page.locator('[data-own-edit]').click(); await page.waitForSelector('.ax-ownedit')
      await box('/app/attendance', 1).click()   // the role gives "create": unticking switches it off for this person
      await page.locator('.ax-savebar.inline input').fill('পরীক্ষা'); await page.locator('[data-own-save]').click()
      await page.waitForFunction(() => !document.querySelector('.ax-ownedit'), null, { timeout: 8000 }).catch(() => {})
      { const c = flowCalls.filter(x => x.fn === 'access_overrides_save').at(-1) ?? {}
        check(c.p_user === 'u2' && c.p_reason === 'পরীক্ষা' && c.p_items?.length === 2 && c.p_items.some(i => i.effect === 'deny' && i.permission === 'hr.attendance.create')
          && c.p_items.some(i => i.effect === 'grant' && i.permission === 'da.report.export' && i.scope_type === 'hub' && i.hub_id === 'h2'), `${size}: individual override — one switched off, the extra kept, saved with the reason`) }
      ownInstalled = false
      // by hub, history, super admin
      await page.goto(`${BASE}/app/access/scope?kind=hub&id=h1`); await page.waitForSelector('.ax-via')
      { const t = await page.locator('[data-scope-detail]').innerText()
        check(t.includes('Sohel Sardar') && t.includes('Zonal Karim') && t.includes('শুধু এই হাবে সীমিত') && t.includes('জোনের মাধ্যমে পান'), `${size}: by hub — who is limited to it and who gets it through the zone`) }
      await fits('hub and zone limits')
      await page.goto(`${BASE}/app/access/history`); await page.waitForSelector('main :text("রোলের অনুমতি বদল")')
      { const t = await page.locator('main').innerText()
        check(t.includes('রোলের অনুমতি বদল (+১ −১)') && t.includes('রোল দেওয়া') && t.includes('Owner') && t.includes('Sohel Sardar'), `${size}: the change history says who changed what for whom`) }
      await fits('change history')
      await page.goto(`${BASE}/app/access/super`); await page.waitForSelector('.ax-people.big li')
      check(await page.locator('.ax-people.big li').count() === 1 && await page.locator('.ax-rules li').count() === 5 && (await page.locator('main').innerText()).includes('মাত্র একজন'), `${size}: the Super Admin page lists who holds full control and warns when it is one person`)
      await fits('super admin page')
      // নদী AI settings: one switch per part; switching chat off hides the floating নদী button
      await page.goto(`${BASE}/app/nodi`); await page.waitForSelector('.nodi-parts li')
      check(await page.locator('.nodi-parts li').count() === 5 && await page.locator('.nodi-switch[aria-checked="true"]').count() === 5, `${size}: নদী AI settings show five parts, all on`)
      await page.locator('.nodi-switch[aria-label="চ্যাট অ্যাসিস্ট্যান্ট"]').click()
      await page.waitForSelector('.nodi-switch[aria-label="চ্যাট অ্যাসিস্ট্যান্ট"][aria-checked="false"]')
      check(flowCalls.some(c => c.fn === 'nodi_features_configure' && c.chat === false), `${size}: switching chat off is saved at once`)
      await fits('নদী AI settings')
      await page.goto(`${BASE}/app`); await page.waitForSelector('main')
      check(await page.locator('.nodi-fab').count() === 0, `${size}: chat off — the floating নদী button is gone`)
      await page.goto(`${BASE}/app/nodi/chat`); await page.waitForSelector('main :text("চ্যাট এখন বন্ধ")')
      check(true, `${size}: chat off — the chat page says it is switched off`)
      nodiParts.chat = true
      // রুট সেটিং: the zone's routes on the real map, the editor with stops, riders, warnings, check-ins and the zone rules
      await page.goto(`${BASE}/app/zonal/routes`); await page.waitForSelector('.rt-card')
      { const t = await page.locator('main').innerText()
        check(t.includes('শহর পূর্ব') && t.includes('২/৩') && t.includes('Staff 01') && await page.locator('.osm-pin.num').count() >= 3, `${size}: route settings show the zone map with numbered stops, the route card and stops with location`) }
      await fits('route settings map')
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/routes-map-${size}.png`, fullPage: true })
      await page.locator('.rt-card button:has-text("এডিট / ম্যাপ")').click(); await page.waitForSelector('.rt-stop')
      check(await page.locator('.rt-stop').count() === 3, `${size}: the route editor lists the three stops in order`)
      const mapZoom = () => page.locator('.osm.pick img.osm-tile').first().evaluate(i => Number(new URL(i.src).pathname.split('/')[1]))
      await page.locator('.osm.pick .osm-ctl button').first().click(); await page.locator('.osm.pick .osm-ctl button').first().click()
      const zoomed = await mapZoom()
      await page.locator('.osm.pick').click({ position: { x: 60, y: 60 } })
      check(await page.locator('.rt-stop').count() === 4, `${size}: a tap on the map adds a stop at that place`)
      check(await mapZoom() === zoomed, `${size}: the editor map keeps its zoom after a stop is added (${zoomed})`)
      if (size === 'pc') { const bx = await page.locator('.osm.pick').boundingBox(); await page.mouse.move(bx.x + 200, bx.y + 200); await page.mouse.wheel(0, 200)
        await page.waitForFunction(z => Number(new URL(document.querySelector('.osm.pick img.osm-tile').src).pathname.split('/')[1]) === z - 1, zoomed)
        check(true, `${size}: the mouse wheel zooms the map`) }
      await fits('route editor')
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/routes-editor-${size}.png`, fullPage: false })
      await page.locator('.da-modal-acts button:has-text("সেভ")').last().click()
      await page.waitForFunction(() => !document.querySelector('.rt-stop'))
      { const c = flowCalls.find(x => x.fn === 'route_save')
        check(!!c && c.p.id === 'rt1' && c.p.stops.length === 4 && c.p.stops[3].lat !== null && c.p.stops[2].lat === null, `${size}: saving sends the stops with their locations (one without stays empty)`) }
      await page.locator('.rt-card button:has-text("রাইডার")').first().click(); await page.waitForSelector('.pick-row')
      await page.locator('.pick-row:has-text("Staff 02") input').check()
      await page.locator('.da-modal-acts button:has-text("সেভ")').last().click(); await page.waitForFunction(() => !document.querySelector('.pick-row'))
      check(flowCalls.some(x => x.fn === 'route_riders_set' && x.p_employees.length === 2), `${size}: riders of a route are saved`)
      await page.locator('.da-seg button:has-text("সতর্কতা")').click(); await page.waitForSelector('.rt-warn')
      { const t = await page.locator('.rt-warn').innerText()
        check(t.includes('হাবের GPS নেই') && t.includes('স্টেশন বাজার'), `${size}: warnings name the hub without GPS and the stop without a location`) }
      await page.locator('.da-seg button:has-text("চেক-ইন")').click(); await page.locator('.rt-card:has-text("শহর পূর্ব")').click()
      await page.waitForSelector('main :text("দূরে")')
      check((await page.locator('main').innerText()).includes('৬৪০ মিটার'), `${size}: the day's check-ins show near and far with the distance`)
      await fits('route check-ins')
      // কাভারেজ: every place of the district, on a route or not; the gaps are listed with their nearest hub
      await page.locator('.da-seg button:has-text("কাভারেজ")').click(); await page.waitForSelector('.rt-card:has-text("পুরো জেলা")')
      await page.waitForSelector('.osm-pin.sm')
      { const t = await page.locator('main').innerText()
        check(await page.locator('.osm-pin.sm').count() === 8 && t.includes('পুরো জেলা') && t.includes('০/৮') && t.includes('কাভারেজ নেই'), `${size}: coverage shows every place as a dot and counts none of the eight as covered`)
        check(t.includes('আমহাটি') && t.includes('Natore Sadar'), `${size}: places without coverage are listed with their nearest hub`) }
      await page.locator('.osm-pin.sm').first().click({ force: true }); await page.waitForSelector('main :text("কোনো রুটে নেই")')
      check(true, `${size}: a tapped dot names the place and says it is on no route`)
      await fits('district coverage')
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/routes-cover-${size}.png`, fullPage: true })
      // পার্সেল ও পরামর্শ: type what one rider delivers a day; the accounts say 140 a day on the one route, so riders are asked for
      loadSaved = null
      await page.locator('.da-seg button:has-text("পার্সেল ও পরামর্শ")').click(); await page.waitForSelector('section.panel:has(h2:text-is("Natore Sadar"))')
      { const card = page.locator('section.panel:has(h2:text-is("Natore Sadar"))')
        check((await card.innerText()).includes('গড়ে কয়টা পার্সেল ডেলিভারি করেন তা লিখুন'), `${size}: parcel load asks for the rider average of a hub first`)
        await card.locator('input[type=number]').first().fill('60')
        await card.locator('button:has-text("সেভ")').click()
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('নিয়োগ দিন'))
        const t = await card.innerText()
        check(flowCalls.some(x => x.fn === 'route_load_save' && x.p_hub === 'h1' && x.p.rider_parcels === 60), `${size}: the rider average is saved for the hub`)
        check(t.includes('১৪০') && t.includes('নতুন ১ জন রাইডার নিয়োগ দিন') && t.includes('আরও ২ জন রাইডার দিন'), `${size}: from the accounts (140 a day, 60 per rider) the hub is told to hire and the route to get more riders`) }
      await fits('parcel load and suggestions')
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/routes-load-${size}.png`, fullPage: true })
      await page.locator('.da-seg button:has-text("জোনের নিয়ম")').click(); await page.waitForSelector('button:has-text("নিয়ম সেভ")')
      await page.locator('button:has-text("নিয়ম সেভ")').click(); await page.waitForTimeout(200)
      check(flowCalls.some(x => x.fn === 'route_settings_save' && x.p_zone === 'z1' && x.p.stop_radius_m === 150), `${size}: the zone rules are saved for the zone`)
      await fits('zone route rules')
      // এলাকা ও সাজেশন: the hub's upazila villages come up, split into suggested routes; one is built in the editor; places are picked one by one
      await page.locator('.da-seg button:has-text("এলাকা ও সাজেশন")').click(); await page.waitForSelector('.rt-card:has-text("সাজেশন ১")')
      { const t = await page.locator('main').innerText()
        check(t.includes('নাটোর সদর ★') && t.includes('আমহাটি') && await page.locator('.rt-card:has-text("সাজেশন")').count() >= 1, `${size}: the hub's upazila is chosen by itself and its villages are suggested as routes`) }
      await fits('area suggestions')
      await page.locator('section.panel:has-text("উপজেলা ধরে রুট সাজেশন") input[type=number]').first().fill('2')
      await page.waitForSelector('.rt-card:has-text("সাজেশন ২")')
      check(true, `${size}: asking for two routes splits the villages into two suggestions`)
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/routes-suggest-${size}.png`, fullPage: true })
      await page.locator('.rt-card button:has-text("এই রুট বানান")').first().click(); await page.waitForSelector('.rt-stop')
      { const k = await page.locator('.rt-stop').count(); check(k >= 2, `${size}: "build this route" opens the editor with the suggested stops (${k})`) }
      await page.locator('.rt-side button:has-text("এলাকা থেকে বাছুন")').click(); await page.waitForSelector('.rt-stop:has-text("আমহাটি")')
      const before = flowCalls.filter(x => x.fn === 'route_save').length
      await page.locator('.rt-side button:has-text("স্টপ (")').click()
      const k0 = await page.locator('.rt-stop').count()
      await page.locator('.rt-side button:has-text("এলাকা থেকে বাছুন")').click()
      await page.locator('.rt-stop:not(:has(button[disabled])) .acts button').first().click()
      await page.locator('.rt-side button:has-text("স্টপ (")').click()
      check(await page.locator('.rt-stop').count() === k0 + 1, `${size}: a place picked from the list becomes a stop with its name`)
      await fits('editor area picker')
      await page.locator('.da-modal-acts button:has-text("সেভ")').last().click(); await page.waitForFunction(() => !document.querySelector('.da-modal'))
      { const c = flowCalls.filter(x => x.fn === 'route_save')[before]
        check(!!c && !c.p.id && c.p.stops.length === k0 + 1 && c.p.stops.every(x => x.lat !== null) && c.p.name.includes('নাটোর সদর'), `${size}: the new route is saved with the places' locations and a name`) }
      await page.locator('.da-seg button:has-text("এলাকা ও সাজেশন")').click(); await page.waitForSelector('button:has-text("বানান ঠিক")')
      await page.locator('tr:has-text("দিঘাপতিয়া") button:has-text("বানান ঠিক")').first().click().catch(async () => { await page.locator('button:has-text("বানান ঠিক")').first().click() })
      await page.waitForSelector('.da-modal input')
      await page.locator('.da-modal input').first().fill('দিঘাপতিয়া (রাজবাড়ি)')
      await page.locator('.da-modal-acts button:has-text("সেভ")').click(); await page.waitForFunction(() => !document.querySelector('.da-modal'))
      check(flowCalls.some(x => x.fn === 'route_place_save' && x.p.name_bn === 'দিঘাপতিয়া (রাজবাড়ি)' && x.p.bn_checked), `${size}: a village spelling is fixed and saved`)
      await page.locator('.da-seg button:has-text("ম্যাপ")').first().click()
      // inside the Android app the older page stays for now
      const app = await ctx.newPage()
      await app.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} } })
      await app.goto(`${BASE}/app/access`); await app.waitForURL(/\/app\/roles$/, { timeout: 8000 }).catch(() => {})
      check(/\/app\/roles$/.test(app.url()), `${size}: inside the Android app the advanced pages are not shown yet (the older role page opens)`)
      await app.close() }

    // --- কোম্পানি শিট: the company's layout filled from the system, downloaded as its own Excel, and a changed layout learnt from the file
    { sheetsOn = true; plainStaff = false; permsNow = null; menuNow = null; asEmployee = false
      const cs = await ctx.newPage(); const csErrors = []; cs.on('pageerror', e => csErrors.push(String(e)))
      const csFits = async where => check(await cs.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${size}: ${where} does not scroll sideways`)
      await cs.goto(`${BASE}/app/hr/requests?tab=sheets`); await cs.waitForSelector('.cs-item')
      check(await cs.locator('.cs-item').count() === 2 && await cs.locator('.rq-tab.on').innerText().then(t => t.includes('কোম্পানি শিট')), `${size}: the company sheets tab lists the saved layouts`)
      await cs.waitForSelector('.cs-grid tbody tr')
      check((await cs.locator('.cs-grid').innerText()).includes('Rahim Sheikh') && await cs.locator('.cs-grid thead tr:last-child th').nth(4).innerText() === 'Employee Picture' && (await cs.locator('.cs-grid tbody').innerText()).includes('Yes'),
        `${size}: a staff sheet fills itself from the staff records, in the company's own columns`)
      await cs.locator('.cs-item', { hasText: 'বেতনসহ' }).click(); await cs.waitForSelector('.cs-band')
      await cs.waitForSelector('.cs-grid tbody tr')
      const band = await cs.locator('.cs-band th').evaluateAll(l => l.map(th => [th.textContent, th.colSpan]))
      check(band.some(([t, n]) => t === 'Previous Salary System' && n === 3) && band.some(([t, n]) => t === 'New Salary System' && n === 3) && band.some(([t, n]) => t === 'Admin & Rider ID Create Information' && n === 4),
        `${size}: grouped headings and the title sit over the same columns as in the company's file`)
      const cells = r => cs.locator('.cs-grid tbody tr').nth(r).locator('td').allInnerTexts()
      // transfers made straight in the system (no request) are listed too, until that is switched off
      await cs.waitForFunction(() => document.querySelectorAll('.cs-grid tbody tr').length === 22, null, { timeout: 8000 }).catch(() => {})
      { const d = await cells(0)
        check(await cs.locator('.cs-grid tbody tr').count() === 22 && await cs.locator('.cs-grid tr.cs-direct-row').count() === 20 && d[2] === 'Staff 01' && d[6] === 'Natore' && d[7] === 'Bogura' && d[17] === 'test',
          `${size}: transfers made straight in the system join the sheet, old and new hub filled` ) }
      await cs.locator('.cs-direct input').uncheck(); await cs.waitForFunction(() => document.querySelectorAll('.cs-grid tbody tr').length === 2, null, { timeout: 8000 }).catch(() => {})
      const r1 = await cells(0), r2 = await cells(1)
      check(r1[1] === '1' && r1[2] === 'Rahim Sheikh' && r1[3] === '01711000111' && r1[6] === 'Boraigram' && r1[7] === 'Lalpur' && r1[8] === '10/10/2005' && r1[10].replace(/\s+/g, ' ') === 'Zonal Karim ID: 777' && r1[17] === 'Lalpur service better',
        `${size}: a transfer request becomes one row: person from the profile, old hub from the request, new hub by name, reference with ID`)
      check(r1[14] === '10000' && r2[14] === '14000' && r2[11] === '13000' && r2[7] === 'Natore Sadar', `${size}: new salary comes from the form, and falls back to the present salary when left empty`)
      check(await cs.locator('.cs-grid tbody tr').count() === 2 && r2[8] === '' && await cs.locator('.cs-grid td.cs-empty').count() === 2, `${size}: only requests of this kind are listed, and an empty box is marked`)
      await cs.locator('.cs-grid td.cs-empty').first().click(); await cs.locator('.cs-grid td.cs-edit input').fill('08/08/2008'); await cs.keyboard.press('Enter')
      check((await cells(1))[8] === '08/08/2008' && await cs.locator('.cs-grid td.cs-typed').count() === 1, `${size}: an empty box can be typed by hand before sending`)
      await cs.locator('.cs-mark input').check()
      const [dl] = await Promise.all([cs.waitForEvent('download'), cs.locator('button', { hasText: 'এক্সেল নামান' }).click()])
      const xlsxPath = `${tmpdir()}/xzm-smoke-${size}-${dl.suggestedFilename()}`; await dl.saveAs(xlsxPath)
      const xl = readFileSync(xlsxPath).toString('utf8')
      check(/^Transfer - 02 \d{4}-\d\d-\d\d\.xlsx$/.test(dl.suggestedFilename()) && ['<mergeCell ref="E1:H2"/>', '<mergeCell ref="K1:M2"/>', '<mergeCell ref="N1:P2"/>', 'Previous Salary System', 'Transfer Raferance Name &amp; ID', '08/08/2008', '<v>14000</v>', '01711000111']
        .every(t => xl.includes(t)), `${size}: the Excel carries the company's merged headings, the rows and the hand-typed box`)
      await cs.waitForFunction(() => document.querySelector('.da-toast')?.textContent?.includes('কাজ চলছে'), null, { timeout: 5000 }).catch(() => {})
      { const moved = flowCalls.filter(c => c.fn === 'hr_request_update'); check(moved.length >= 1 && moved.every(c => c.p_id === 'q1' && c.p_status === 'processing'), `${size}: on request, the waiting ones move to "in progress" after the download` ) }
      // the company sends a changed file: the same sheet reads it again
      await cs.locator('.cs-acts button').first().click(); await cs.waitForSelector('.da-modal .cs-map tbody tr')
      await cs.locator('.da-modal input[type=file]').setInputFiles(xlsxPath)
      await cs.waitForFunction(() => document.querySelector('.da-modal .cs-drop b')?.textContent?.includes('Transfer - 02 2'), null, { timeout: 8000 }).catch(() => {})
      check(await cs.locator('.da-modal .cs-map tbody tr').count() === 17 && await cs.locator('.da-modal .cs-map tr.cs-unsure, .da-modal .cs-map tr.cs-new').count() === 0
        && await cs.locator('.da-modal input[placeholder^="যেমন: Admin"]').inputValue() === 'Admin & Rider ID Create Information'
        && await cs.locator('.da-modal .cs-map tbody tr').nth(13).locator('input').first().inputValue() === 'New Salary System',
        `${size}: reading the company's file again finds the same 17 columns, title and groups, and keeps where each one comes from`)
      await csFits('company sheet editor')
      if (process.env.SHOTS) await cs.screenshot({ path: `${process.env.SHOTS}/${size}-company-sheet-editor.png` })
      await cs.locator('.da-modal-acts button', { hasText: 'বাতিল' }).click()
      // a brand new layout for another kind of request: what the form lacks becomes a new box on the form
      await cs.locator('button', { hasText: 'নতুন ফরম্যাট' }).click(); await cs.waitForSelector('.da-modal .cs-drop')
      await cs.locator('.da-modal select').nth(1).selectOption('id_active')
      await cs.locator('.da-modal input[type=file]').setInputFiles(xlsxPath); await cs.waitForSelector('.da-modal .cs-map tbody tr')
      check(await cs.locator('.da-modal .cs-map tbody tr').count() === 17 && await cs.locator('.da-modal .cs-map tr.cs-unsure').count() === 4
        && await cs.locator('.da-modal .cs-map tbody tr').nth(1).locator('select').first().inputValue() === 'emp:full_name', `${size}: a new file is read and its headings matched; the four the system has nowhere to take from are pointed out`)
      await cs.locator('.da-modal .cs-map tbody tr').nth(13).locator('select').first().selectOption('__new:number')
      await cs.locator('.da-modal input[placeholder="ID Transfer Information"]').fill('Active with salary')
      const before = flowCalls.length
      await cs.locator('.da-modal-acts button', { hasText: 'সেভ' }).click(); await cs.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 8000 }).catch(() => {})
      { const calls = flowCalls.slice(before), f = calls.find(c => c.fn === 'hr_request_formats'), n = calls.find(c => c.fn === 'company_sheets')
        const box = f?.fields?.at(-1)
        check(!!f && f.url.includes('id=eq.f-active') && f.fields.length === 4 && box.label === 'New Salary System — Basic' && box.type === 'number', `${size}: the missing column becomes a new number box on that request form`)
        check(!!n && n.method === 'POST' && n.name === 'Active with salary' && n.source === 'requests' && n.kind === 'id_active' && n.columns.length === 17 && n.columns[13].src === `req:${box?.key}` && n.columns[13].group === 'New Salary System'
          && n.columns[0].src === 'sl' && JSON.stringify(n.title_at) === '[4,7]' && n.columns[6].src === 'blank', `${size}: the new sheet is saved with every column pointed at its source`) }
      await cs.locator('.cs-item', { hasText: 'বেতনসহ' }).click(); await cs.waitForSelector('.cs-band')
      await csFits('company sheet')
      if (process.env.SHOTS) await cs.screenshot({ path: `${process.env.SHOTS}/${size}-company-sheet.png`, fullPage: true })
      check(csErrors.length === 0, `${size}: company sheets run with no script errors${csErrors.length ? ' — ' + csErrors[0] : ''}`)
      await cs.close(); sheetsOn = false }

    // daily report import: paste the courier panel's Update Report; three checks or no save; the khata by rider
    const reportText = readFileSync(new URL('./fixtures/update_report.txt', import.meta.url), 'utf8')
    await page.goto(`${BASE}/app/accounts/report-import`); await page.waitForSelector('.ri-text')
    await page.locator('.ri-text').fill(reportText.replace('৳20,789.00', '৳20,788.00')); await page.waitForSelector('.ri-checks li')
    check(await page.locator('.ri-checks li.bad').count() === 1 && await page.locator('.ri-save button').isDisabled(), `${size}: one digit changed -> a check fails and the save button is off`)
    await fits('report import, a check failed')
    await page.locator('.ri-text').fill(reportText.replace(/\n/g, ' ')); await page.waitForSelector('.ri-checks li')
    check(await page.locator('.ri-checks li.ok').count() === 3 && (await page.locator('.ri-head').innerText()).includes('744847'), `${size}: the pasted report (as one line) is read and all three checks pass`)
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-report-import-checks.png`, fullPage: true })
    await page.locator('.ri-save button').click(); await page.waitForSelector('.ri-khata')
    const sent = imported.at(-1)
    check(sent?.p_hub === 'h5' && sent?.p_report?.manager_code === '6865' && sent?.p_report?.lists?.length === 8 && sent?.p_raw?.includes('Update Report #744847'), `${size}: saving sends the report's hub, manager, lists and the pasted text`)
    check((await page.locator('.ri-khata').innerText()).includes('Point delivery') && await page.locator('.ri-khata .b-bad').count() === 1, `${size}: the khata shows riders, Point delivery and an unknown ID`)
    await page.locator('.ri-khata tr.click').first().click()
    check(await page.locator('.ri-khata tr.ri-sub').count() === 1, `${size}: tapping a rider shows the lists`)
    await fits('report import khata')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-report-import-khata.png`, fullPage: true })
    await page.locator('.ri-map').click(); await page.waitForSelector('.ri-people button')
    await page.locator('.ri-people button').first().click(); await page.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 5000 }).catch(() => {})
    check(flowCalls.some(c => c.fn === 'da_import_map_rider' && c.p_code === '44174'), `${size}: an unknown ID is mapped with one tap on a person`)
    // zonal dashboard: every hub's report status for the day; a hub opens its upload page
    await page.goto(`${BASE}/app/zonal`); await page.getByRole('tab', { name: 'আজকের রিপোর্ট' }).click(); await page.waitForSelector('.ri-hub')
    const hubCards = await page.locator('.ri-hub').allInnerTexts()
    check(hubCards.length === 2 && hubCards.some(t => t.includes('Gurudaspur') && t.includes('১টি রিপোর্ট') && t.includes('অচেনা')) && hubCards.some(t => t.includes('Lalpur') && t.includes('রিপোর্ট আসেনি')),
      `${size}: the zonal tab shows each hub's report status, with unknown IDs and hubs that sent none`)
    await fits('zonal report status')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-zonal-reports.png`, fullPage: true })
    await page.locator('.ri-hub', { hasText: 'Lalpur' }).click(); await page.waitForURL(/report-import\?hub=h2/)
    check(/hub=h2/.test(page.url()), `${size}: a hub on the zonal tab opens that hub's upload page`)
    await page.goto(`${BASE}/app`); await page.waitForSelector('.ri-home')
    // the count shows "…" until its answer arrives (later now that other pages load in the background): wait for the number
    await page.waitForFunction(() => document.querySelector('.ri-home-n b')?.textContent?.trim() !== '…', null, { timeout: 8000 }).catch(() => {})
    check((await page.locator('.ri-home').innerText()).includes('রিপোর্ট আপলোড') && (await page.locator('.ri-home-n b').innerText()).trim() === '১', `${size}: the home card shows how many reports came today`)
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-report-home.png` })

    // ---- inside the Android app (a stand-in for the Capacitor bridge): camera sheet, buzz, keyboard
    if (size === 'phone') {
      await ctx.addInitScript(() => {
        const calls = window.__cap = []
        const rec = n => async () => { calls.push(n) }
        window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {
          Haptics: { impact: rec('impact'), notification: rec('notification'), selectionChanged: rec('select') },
          Camera: { getPhoto: async o => { calls.push('getPhoto ' + o.source); return { format: 'png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } } },
          App: { addListener: () => ({ remove() {} }), exitApp: async () => {} },
          StatusBar: { setOverlaysWebView: async () => {}, setBackgroundColor: async () => {}, setStyle: async () => {} } } }
      })
      const ap = await ctx.newPage(); ap.on('pageerror', e => errors.push(String(e))); ap.on('dialog', d => { nativeDialogs.push(d.message()); void d.dismiss() })
      await ap.goto(`${BASE}/app/staff`); await ap.waitForSelector('.sp .nv-row')
      check(await ap.evaluate(() => document.documentElement.classList.contains('native-app')), `${size}: in the app, app mode is on`)
      await ap.evaluate(() => document.addEventListener('change', e => { if (e.target.type === 'file') window.__picked = e.target.files.length }, true))
      await ap.locator('.sp-hero .my-av-cam').click(); await ap.waitForSelector('.da-modal .ask-choices')
      check(await ap.locator('.da-modal .nv-row').count() === 2, `${size}: in the app, a photo box asks camera or gallery`)
      await ap.locator('.da-modal .nv-row', { hasText: 'ক্যামেরা দিয়ে তুলুন' }).click(); await ap.waitForTimeout(600)
      check((await ap.evaluate(() => window.__cap)).includes('getPhoto CAMERA') && await ap.evaluate(() => window.__picked) === 1,
        `${size}: in the app, the camera photo lands in the same photo box`)
      await ap.locator('.bottom-nav a').first().click(); await ap.waitForTimeout(200)
      check((await ap.evaluate(() => window.__cap)).includes('select'), `${size}: in the app, a bottom tab tap gives a tick`)
      // ripple: a press on a bottom tab starts a ripple layer that is removed again, and nothing about the tab changes
      await ap.locator('.bottom-nav .bn-item').first().dispatchEvent('pointerdown', { clientX: 60, clientY: 760, pointerType: 'touch', bubbles: true })
      check(await ap.locator('.bn-item .ripple-ink').count() === 1, `${size}: in the app, a press on a tab starts a ripple`)
      await ap.locator('.bottom-nav .bn-item').first().dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true }); await ap.waitForTimeout(900)
      check(await ap.locator('.ripple-wrap').count() === 0, `${size}: in the app, the ripple goes away by itself`)
      // top bar: flat at the top, lifted once the page has scrolled
      await ap.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 400) }); await ap.waitForTimeout(150)
      check(await ap.evaluate(() => document.documentElement.classList.contains('scrolled')), `${size}: in the app, the top bar lifts when the page is scrolled`)
      await ap.evaluate(() => window.scrollTo(0, 0)); await ap.waitForTimeout(150)
      check(await ap.evaluate(() => !document.documentElement.classList.contains('scrolled')), `${size}: in the app, the top bar is flat at the top again`)
      // a dialog is a bottom sheet: pulling it down closes it, a short pull springs back
      await ap.goto(`${BASE}/app/staff`); await ap.waitForSelector('.sp .nv-row')
      await ap.locator('.sp-hero .my-av-cam').click(); await ap.waitForSelector('.da-modal')
      const pull = async dy => { const h = await ap.locator('.da-modal').boundingBox(); const x = h.x + h.width / 2, y = h.y + 20
        await ap.evaluate(([x, y, dy]) => { const t = document.querySelector('.da-modal'); const mk = (type, yy) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: t, clientX: x, clientY: yy })] })
          t.dispatchEvent(mk('touchstart', y)); t.dispatchEvent(mk('touchmove', y + dy / 2)); t.dispatchEvent(mk('touchmove', y + dy)); t.dispatchEvent(mk('touchend', y + dy)) }, [x, y, dy]) }
      await pull(40); await ap.waitForTimeout(400)
      check(await ap.locator('.da-modal').count() === 1, `${size}: in the app, a short pull on a sheet springs back`)
      await pull(220); await ap.waitForFunction(() => !document.querySelector('.da-modal'), null, { timeout: 3000 }).catch(() => {})
      check(await ap.locator('.da-modal').count() === 0, `${size}: in the app, pulling a sheet down closes it`)
      await ap.goto(`${BASE}/app/hr/employees`); await ap.waitForSelector('.emp-search input')
      const box = ap.locator('.emp-search input').first()
      if (await box.count()) {
        await box.focus(); await ap.setViewportSize({ width: 390, height: 450 }); await ap.waitForTimeout(600)
        check(await ap.evaluate(() => document.documentElement.classList.contains('kb-open') && getComputedStyle(document.querySelector('.bottom-nav')).display === 'none'),
          `${size}: in the app, the bottom bar steps aside while the keyboard is up`)
      } else check(false, `${size}: in the app, the employee search box is there`)
      await ap.close()
    }
    check(errors.length === 0, `${size}: no script errors${errors.length ? ' — ' + errors[0] : ''}`)
    check(nativeDialogs.length === 0, `${size}: no browser prompt, confirm or alert boxes${nativeDialogs.length ? ' — ' + nativeDialogs[0] : ''}`)
    await ctx.close()
  }
} finally { await browser.close(); stop() }
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1) }
console.log('\nAll checks passed')
