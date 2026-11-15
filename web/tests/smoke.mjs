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

const browser = await chromium.launch()
try {
  for (const [size, viewport] of [['pc', { width: 1366, height: 800 }], ['phone', { width: 390, height: 800 }]]) {
    // --- not signed in: every app page goes to the login screen
    const anon = await browser.newContext({ viewport })
    await anon.route(/supabase\.co|fonts\.(googleapis|gstatic)/, r => r.abort())
    const lp = await anon.newPage()
    await lp.goto(`${BASE}/app/hr/employees`); await lp.waitForURL(/\/staff\/login/, { timeout: 8000 }).catch(() => {})
    check(/\/staff\/login/.test(lp.url()), `${size}: signed-out visitor is sent to the login page`)
    await anon.close()

    // --- signed in as the Super Admin
    const ctx = await browser.newContext({ viewport })
    await ctx.addInitScript(s => { localStorage.setItem('sb-ndgnhvbpmtxrpplgsslz-auth-token', s) }, JSON.stringify(session))
    await ctx.route(/fonts\.(googleapis|gstatic)|cdn\.jsdelivr\.net/, r => r.abort())
    const created = [], accounts = [], mobiles = [], removed = [], recoded = []
    let asEmployee = false
    await ctx.route(/supabase\.co/, r => {
      const u = r.request().url()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      const j = d => r.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/0' }, body: JSON.stringify(d) })
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors })
      if (u.includes('/auth/v1/user')) return j(session.user)
      if (u.includes('rpc/my_permissions')) return j([{ permission_code: '*', scope_type: 'global', zone_id: null, hub_id: null, is_super: true }])
      if (u.includes('rpc/role_admin_list')) return j(roles)
      if (u.includes('rpc/role_dashboard_list')) return j([{ role_id: 'r2', code: 'hub_manager', name: 'Hub Manager', name_bn: null, is_super: false, panels: ['my_work', 'quick_links'], user_count: 4, default_view: 'self' }])
      if (u.includes('rpc/dashboard_home')) return j({ panels: ['my_work', 'quick_links'], today: '2026-11-15', me: null, my_work: { tasks_open: 2, tasks_due: 0, tasks_to_check: 0, leave_pending: 0, marked_today: true } })
      if (u.includes('rpc/hr_change_register')) return j(register)
      if (u.includes('rpc/hub_group_hubs')) return j([{ hub_id: 'h1', hub_name: 'Natore Sadar', hub_code: '80', open_issues: 0, unseen: 0 }])
      if (u.includes('rpc/issue_order_incharge_set')) return j(null)
      if (u.includes('rpc/issue_order_incharge')) return j({ store: { id: 'e05', name: 'Store Keeper', code: '1005', hub: 'Natore Sadar', has_login: true }, it: null })
      if (u.includes('rpc/issue_panels')) return j({ to_check: [], given: [], waiting_for_check_of_mine: [], hub: [], mine: [{ id: 'o1', issue_no: 'IS-00009', title: 'স্টোর অর্ডার: টেপ', kind: 'store',
        priority: 'normal', status: 'open', hub_id: 'h1', hub: 'Natore Sadar', parcel_ref: null, due_at: null, created_at: '2026-11-15T04:00:00Z', solved_at: null, reopen_count: 0,
        assigned_by_name: 'Hub Manager', assigned_by_nodi: false, assignee: 'Owner', assignee_code: '1', is_mine: true, is_giver: false, overdue: false }] })
      if (u.includes('rpc/issue_create')) { created.push(r.request().postDataJSON()); return j('i1') }
      if (u.includes('/storage/v1/object/')) return j({ Key: 'issue-photos/h1/label.png', Id: '1' })
      if (u.includes('/functions/v1/admin-users')) { accounts.push(r.request().postDataJSON()); return j({ ok: true, user_id: `u${accounts.length}` }) }
      if (u.includes('rpc/rollout_progress')) return j([{ hub_id: 'h1', hub_name: 'Natore Sadar', zone_id: 'z1', staff: 33, with_login: 20, signed_in: 12, password_set: 9, with_mobile: 4 },
        { hub_id: 'h2', hub_name: 'Lalpur', zone_id: 'z1', staff: 15, with_login: 0, signed_in: 0, password_set: 0, with_mobile: 0 }])
      if (u.includes('rpc/rollout_people')) return j([
        { employee_id: 'e00', employee_code: '1000', full_name: 'Staff 00', position_name: 'Rider', role_name: 'Rider', has_login: true, signed_in_at: '2026-11-15T03:00:00Z', password_set: true, mobile: '01711000000' },
        { employee_id: 'e01', employee_code: '1001', full_name: 'Staff 01', position_name: 'Rider', role_name: 'Rider', has_login: true, signed_in_at: null, password_set: false, mobile: null },
        { employee_id: 'e02', employee_code: '1002', full_name: 'Staff 02', position_name: 'Rider', role_name: null, has_login: false, signed_in_at: null, password_set: false, mobile: null }])
      if (u.includes('rpc/hr_remove_wrong_entry')) { removed.push(r.request().postDataJSON()); return j(null) }
      if (u.includes('rpc/hr_correct_employee_code')) { recoded.push(r.request().postDataJSON()); return j('5555') }
      if (u.includes('rpc/my_mobile_set')) { mobiles.push(r.request().postDataJSON()); return j('01711000000') }
      if (u.includes('rpc/my_employee_id')) return j(asEmployee ? 'e01' : null)
      if (u.includes('/rpc/')) return j(null)
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
    await page.goto(`${BASE}/app/issues?tab=orders`); await page.waitForSelector('.od-desk')
    check(await page.locator('.od-kind').count() === 2 && await page.locator('.is-card').count() === 1, `${size}: the orders tab shows Store, IT and the open order`)
    check((await page.locator('.is-card').innerText()).includes('প্রস্তুত করছি'), `${size}: an order is worked in order words (prepare, sent, received)`)
    await fits('orders tab')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${size}-orders.png`, fullPage: true })

    // staff list: post chips, leave chip, search, View / Edit on every row, and an action on several marked rows
    await page.goto(`${BASE}/app/hr/employees`); const staffSel = '.emp-board .da-table tbody tr, .emp-board .dv-list > li'   // table on a PC, compact list on a phone
    await page.waitForSelector(staffSel)
    const staffRowsShown = () => page.locator(staffSel).count()
    check(await staffRowsShown() === 12 && (await page.locator('.eb-chips').innerText()).includes('Rider'), `${size}: the staff list shows everyone with a chip per post`)
    check(await page.locator(staffSel).first().locator('.row-acts button').count() === 2, `${size}: every row has Edit and View`)
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
