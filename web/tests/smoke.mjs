import { readFileSync } from 'node:fs'
// Smoke test: opens the built site in a real browser at PC and phone size, with the
// database answers faked, and checks the screens that every change must keep working.
// Run:  npm run build && npm run test:smoke      (CI runs it before the site is published)
import { spawn } from 'node:child_process'
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

const fails = []
const check = (ok, what) => { if (!ok) fails.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const stop = () => { try { server.kill() } catch { /* already gone */ } }
process.on('exit', stop)
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)) }

const daSettings = JSON.parse(readFileSync(new URL('./fixtures/da_settings.json', import.meta.url), 'utf8'))
const browser = await chromium.launch()
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
    await lp.getByRole('button', { name: 'পাসওয়ার্ড ভুলে গেছি' }).click()
    await lp.locator('.login-card input').fill('1001'); await lp.getByRole('button', { name: 'লিংক পাঠান' }).click()
    check((await lp.locator('.login-card .da-error').innerText().catch(() => '')).includes('ম্যানেজার') && recover.length === 0, `${size}: forgot password with an Employee ID says whom to ask, and sends nothing`)
    await lp.locator('.login-card input').fill('Owner@Example.com'); await lp.getByRole('button', { name: 'লিংক পাঠান' }).click()
    await lp.waitForSelector('.login-card .notice', { timeout: 8000 }).catch(() => {})
    check(recover.at(-1)?.body?.email === 'owner@example.com' && decodeURIComponent(recover.at(-1)?.url ?? '').includes('/staff/login') && await lp.locator('.login-card .notice').count() === 1, `${size}: forgot password sends a link to the email on the account`)
    if (process.env.SHOTS) await lp.screenshot({ path: `${process.env.SHOTS}/${size}-forgot.png` })
    await anon.close()

    // --- signed in as the Super Admin
    const ctx = await browser.newContext({ viewport })
    await ctx.addInitScript(s => { localStorage.setItem('sb-ndgnhvbpmtxrpplgsslz-auth-token', s) }, JSON.stringify(session))
    await ctx.route(/fonts\.(googleapis|gstatic)|cdn\.jsdelivr\.net/, r => r.abort())
    const created = [], accounts = [], mobiles = [], removed = [], recoded = [], exported = [], acted = [], posted = [], started = [], pwChanged = [], flowCalls = []
    let asEmployee = false, withGaps = false, mineOpen = false, menuNow = null
    const answered = [], checked = []
    await ctx.route(/supabase\.co/, r => {
      const u = r.request().url()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      const j = d => r.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/0' }, body: JSON.stringify(d) })
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors })
      if (u.includes('/auth/v1/user')) return j(session.user)
      if (u.includes('/functions/v1/admin-users')) { const b = r.request().postDataJSON(); if (b?.action === 'change_password') { pwChanged.push(b); return j({ ok: true }) } }
      if (u.includes('rpc/my_permissions')) return j([{ permission_code: '*', scope_type: 'global', zone_id: null, hub_id: null, is_super: true }])
      if (u.includes('rpc/role_admin_list')) return j(roles)
      if (u.includes('rpc/role_dashboard_list')) return j([{ role_id: 'r2', code: 'hub_manager', name: 'Hub Manager', name_bn: null, is_super: false, panels: ['my_work', 'quick_links'], user_count: 4, default_view: 'self' }])
      if (u.includes('rpc/dashboard_home')) return j({ panels: ['my_work', 'quick_links'], today: '2026-11-15', me: null, my_work: { tasks_open: 2, tasks_due: 0, tasks_to_check: 0, leave_pending: 0, marked_today: true } })
      if (u.includes('rpc/hr_change_register')) return j(register)
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
      if (u.includes('rpc/my_menu')) return j(menuNow)
      if (u.includes('rpc/role_menu_list')) return j([{ role_id: 'r2', code: 'hub_manager', name: 'Hub Manager', name_bn: null, is_super: false, menu: null, user_count: 4 }])
      if (u.includes('rpc/role_menu_save')) { flowCalls.push({ fn: 'role_menu_save', ...r.request().postDataJSON() }); return j(null) }
      if (u.includes('rpc/att_days_save')) { flowCalls.push({ fn: 'att_days_save', ...r.request().postDataJSON() }); return j(2) }
      if (u.includes('rpc/att_days_list')) return j([
        { employee_id: 'e02', employee_code: '7982', full_name: 'Alamin Sarker', position_name: 'Commission Rider', site_days: 0, online_days: null, register_days: null, note: null, submitted_by_name: null, submitted_at: null },
        { employee_id: 'e03', employee_code: '6799', full_name: 'Md Mahin', position_name: 'Commission Rider', site_days: 0, online_days: 15, register_days: 15, note: null, submitted_by_name: 'Owner', submitted_at: '2026-11-16T05:00:00Z' }])
      if (u.includes('rpc/da_settings')) return j(daSettings)
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
        merchant_payments: [], notes_in: [], events: [], visits: [], deposits: [], cells: [],
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
      if (u.includes('/rpc/')) return j(null)
      if (u.includes('/rest/v1/leave_types')) return j([{ id: 'lt1', code: 'CL', name: 'Casual leave', name_bn: 'নৈমিত্তিক ছুটি', is_paid: true, annual_quota: 10, status: 'active' }])
      if (u.includes('/rest/v1/leave_requests') && u.includes('status=eq.approved')) return j([{ employee_id: 'e03' }])
      if (u.includes('/rest/v1/employees') && u.includes('limit=2000') && r.request().method() === 'GET' && !u.includes('profile_id=is.null')) return j(staffRows.map(e => ({ ...e, zone_id: 'z1',
        full_name_bn: null, email: null, department_id: 'd1', joining_date: '2026-01-01', status_since: '2026-01-01', archived_at: null, profile_id: null, reporting_manager_id: null,
        emergency_contact_name: null, emergency_contact_phone: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })))
      if (u.includes('/rest/v1/employees') && u.includes('profile_id=is.null')) return j([...staffRows.map(e => ({ ...e, zone_id: 'z1' })),
        { id: 'e99', employee_code: null, full_name: 'No ID Yet', mobile: null, hub_id: 'h2', zone_id: 'z1', position_id: 'p1' }])
      if (u.includes('/rest/v1/employees') && u.includes('id=eq.e01')) return j([{ ...staffRows[1], mobile: null, full_name_bn: null, joining_date: '2026-01-01', department_id: 'd1', zone_id: 'z1' }])
      if (u.includes('/rest/v1/hubs')) return j(hubRows)
      if (u.includes('/rest/v1/positions')) return j([{ id: 'p1', department_id: 'd1', code: 'rider', name: 'Rider', name_bn: null, status: 'active', archived_at: null, default_role_id: 'r3' }])
      if (u.includes('/rest/v1/employees') && u.includes('mobile=eq.01711000000')) return j([{ id: 'e01', employee_code: '1001', full_name: 'Staff 01', status: 'active', hub_id: 'h2' }])
      if (u.includes('/rest/v1/employees') && u.includes('hub_id=eq.h2') && r.request().method() === 'GET') return j(staffRows)
      if (u.includes('/rest/v1/issues') && u.includes('DUP123456')) return j([{ id: 'i9', issue_no: 'IS-0009', title: 'x', status: 'open' }])
      return j([])
    })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e)))
    page.on('dialog', d => { void d.accept() })
    const fits = async where => check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${size}: ${where} does not scroll sideways`)

    await page.goto(`${BASE}/app`); await page.waitForSelector('.da-main h1', { state: 'attached' })
    check((await page.locator('.da-main h1').textContent()).includes('Owner'), `${size}: dashboard opens`); await fits('dashboard')

    await page.goto(`${BASE}/app/settings`); await page.waitForSelector('.font-pick')
    check(await page.locator('.font-pick button').count() === 5, `${size}: settings shows the font choices`); await fits('settings')

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
    await page.locator('.list-tools [aria-pressed]').nth(1).click(); await page.waitForSelector('.dv-card')
    check(await page.locator('.dv-card').count() === 50, `${size}: card view shows the same rows`); await fits('list (card view)')
    await page.locator('.list-tools [aria-pressed]').nth(2).click(); await page.waitForSelector('.dv-list li')
    check(await page.locator('.dv-list li').count() === 50, `${size}: list view shows the same rows`); await fits('list (list view)')
    await page.reload(); await page.locator('.emp-tabs button').nth(1).click(); await page.waitForSelector('.dv-list li, .da-table tbody tr')
    check(await page.locator('.dv-list li').count() === 50, `${size}: the chosen view is remembered after reload`)
    await page.locator('.list-tools [aria-pressed]').nth(0).click()
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
    await fits('accounts sheet')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-sheet.png`, fullPage: true })
    // attendance days to compare: two numbers per person, a difference is pointed out, then submit
    await page.goto(`${BASE}/app/hub/days`); await page.waitForSelector('.ad-rows .nv-row:not(.ad-head)', { timeout: 10000 }).catch(() => {})
    const adRow = page.locator('.ad-rows .nv-row', { hasText: 'Alamin Sarker' })
    await adRow.locator('.ad-in input').nth(0).fill('১৩'); await adRow.locator('.ad-in input').nth(1).fill('15')
    check(await page.locator('.ad-rows .nv-row:not(.ad-head)').count() === 2 && (await adRow.innerText()).includes('পার্থক্য ২ দিন'), `${size}: attendance days take two numbers per person and point out a difference`)
    await page.locator('.ad .da-actionbar button').click(); await page.waitForTimeout(300)
    { const c = flowCalls.at(-1) ?? {}
      check(c.fn === 'att_days_save' && c.p_rows?.length === 2 && c.p_rows[0].online_days === 13 && c.p_rows[0].register_days === 15 && /^\d{4}-\d\d-(01|16)$/.test(c.p_from), `${size}: the hub submits the attendance days for the half month`) }
    await fits('attendance days')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-days.png` })
    // which pages a role sees: the Super Admin ticks them; a limited role gets nothing else
    await page.goto(`${BASE}/app/role-dashboards`); await page.waitForSelector('#role-pages .nv-row', { timeout: 10000 }).catch(() => {})
    await page.locator('#role-pages button', { hasText: 'পাতা বাছুন' }).click(); await page.waitForSelector('.da-modal')
    await page.locator('.da-modal .da-seg button').last().click()
    await page.locator('.pg-pick label', { hasText: 'আমার হাব টিম' }).locator('input').check(); await page.locator('.pg-pick label', { hasText: 'হাজিরার দিন মেলানো' }).locator('input').check()
    await page.locator('.da-modal-acts button').last().click(); await page.waitForTimeout(300)
    check(flowCalls.at(-1)?.fn === 'role_menu_save' && flowCalls.at(-1)?.p_role === 'r2' && flowCalls.at(-1)?.p_menu?.join() === '/app/hub/team,/app/hub/days', `${size}: the Super Admin picks the pages of a role`)
    menuNow = ['/app/hub/team', '/app/hub/days', '/app/accounts/khata']
    await page.goto(`${BASE}/app/hub/team`); await page.waitForSelector('.hub-tabs a', { timeout: 10000 }).catch(() => {})
    const sideLinks = await page.locator('aside.side a[href^="/app/"]').evaluateAll(a => [...new Set(a.map(x => x.getAttribute('href')))])
    check(await page.locator('.hub-tabs a').count() === 2 && sideLinks.length === 3 && sideLinks.includes('/app/accounts/khata'), `${size}: a limited role has only its pages in the menu (${sideLinks.length})`)
    await page.goto(`${BASE}/app/hr/attendance`); await page.waitForSelector('.center-screen .notice', { timeout: 8000 }).catch(() => {})
    check((await page.locator('.center-screen .notice').innerText().catch(() => '')).includes('চালু নেই'), `${size}: a page off the list does not open even by its address`)
    await page.goto(`${BASE}/app/hr/employees/e01`); await page.waitForSelector('.emp-head', { timeout: 8000 }).catch(() => {})
    check(await page.locator('.emp-head').count() === 1, `${size}: a person's profile still opens from the team page`)
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
    check(await page.locator('.mg-row').count() === 4 && await page.locator('.mg-row.grp .mg-n').innerText() === '2', `${size}: issues, orders and the hub group sit in one chat-like list`)
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
    await page.goto(`${BASE}/app/hr/employees`); const staffSel = '.emp-board .da-table tbody tr, .emp-board .dv-list > li'   // table on a PC, compact list on a phone
    await page.waitForSelector(staffSel)
    const staffRowsShown = () => page.locator(staffSel).count()
    check(await staffRowsShown() === 12 && (await page.locator('.eb-chips').innerText()).includes('Rider'), `${size}: the staff list shows everyone with a chip per post`)
    check(await page.locator(staffSel).first().locator('.row-acts button').count() === 2, `${size}: every row has Edit and View`)
    { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.getByRole('button', { name: /ID Create/ }).click()])
      const sent = exported.at(-1)
      check(!!dl && /^New-Admin-Rider-ID-Creat-Information-.*\.xlsx$/.test(dl.suggestedFilename()) && sent?.p_status === 'active' && sent.p_fields.includes('nid_number'), `${size}: the staff page makes the company's ID Create sheet`)
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
    await page.waitForFunction(() => /শেষ হয়েছে/.test(document.querySelector('.da-modal')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {})
    check(accounts.length === 12 && accounts.every(a => a.action === 'create' && /^id-10\d\d@xzmteam\.com$/.test(a.email) && a.role_id === 'r3' && a.scope_type === 'hub'
      && a.hub_id === 'h2' && a.password === 'Natore2026' && /^e\d\d$/.test(a.employee_id)), `${size}: one login per staff member with an ID, role and hub from their record (${accounts.length})`)

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
    asEmployee = false

    // new staff form: the mobile box tidies and checks itself, and warns about a number that is already used
    await page.goto(`${BASE}/app/zonal/staff`)
    await page.getByRole('button', { name: /নতুন কর্মী|New staff/ }).first().click(); await page.waitForSelector('.da-modal input[inputmode=tel]')
    const mobile = page.locator('.da-modal input[inputmode=tel]')
    await mobile.fill('0171'); await mobile.blur()
    check(await page.locator('.da-modal .field-err').count() === 1, `${size}: a wrong mobile number is flagged as soon as the box is left`)
    await mobile.fill('+৮৮ ০১৭১১-০০০০০০'); await mobile.blur()
    check(await mobile.inputValue() === '01711000000', `${size}: Bangla digits, +88 and dashes are tidied into 01XXXXXXXXX`)
    await page.waitForSelector('.da-modal .dup-note', { timeout: 5000 }).catch(() => {})
    check((await page.locator('.da-modal .dup-note').innerText().catch(() => '')).includes('Staff 01'), `${size}: a mobile number that is already used is flagged with the person's name`)
    await fits('new staff form')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-staff.png` })

    check(errors.length === 0, `${size}: no script errors${errors.length ? ' — ' + errors[0] : ''}`)
    await ctx.close()
  }
} finally { await browser.close(); stop() }
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1) }
console.log('\nAll checks passed')
