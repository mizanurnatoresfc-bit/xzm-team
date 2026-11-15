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
    const created = []
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
      if (u.includes('rpc/issue_create')) { created.push(r.request().postDataJSON()); return j('i1') }
      if (u.includes('/storage/v1/object/')) return j({ Key: 'issue-photos/h1/label.png', Id: '1' })
      if (u.includes('/rpc/')) return j(null)
      if (u.includes('/rest/v1/hubs')) return j(hubRows)
      if (u.includes('/rest/v1/positions')) return j([{ id: 'p1', department_id: 'd1', code: 'rider', name: 'Rider', name_bn: null, status: 'active', archived_at: null }])
      if (u.includes('/rest/v1/employees') && u.includes('mobile=eq.01711000000')) return j([{ id: 'e01', employee_code: '1001', full_name: 'Staff 01', status: 'active', hub_id: 'h2' }])
      if (u.includes('/rest/v1/employees') && u.includes('hub_id=eq.h2') && r.request().method() === 'GET') return j(staffRows)
      if (u.includes('/rest/v1/issues') && u.includes('DUP123456')) return j([{ id: 'i9', issue_no: 'IS-0009', title: 'x', status: 'open' }])
      return j([])
    })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e)))
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
