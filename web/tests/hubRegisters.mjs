// Exercises the built UI with DEMO Hub fixtures. SQL tests enforce the real permissions.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:4188'
const day = new Date(Date.now() + 21600000).toISOString().slice(0, 10)
const books = ['attendance', 'pickup', 'pending', 'delivery', 'expense']
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const app = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4188', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let retry = 0; retry < 40; retry++) {
    if (await fetch(base).then(response => response.ok).catch(() => false)) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  for (const android of [false, true]) {
    for (const role of ['Rider', 'Staff', 'Manager', 'Zonal Manager']) {
      const manage = role.includes('Manager')
      const configure = role === 'Zonal Manager'
      const user = { id: 'demo-user', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated',
        app_metadata: {}, user_metadata: { full_name: role }, created_at: '2026-01-01' }
      const session = { user, access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: user.id, exp: 4102444800 })}.sig`,
        refresh_token: 'demo', expires_at: 4102444800 }
      const context = await browser.newContext({ viewport: android ? { width: 390, height: 820 } : { width: 1366, height: 850 }, serviceWorkers: 'block' })
      try {
        await context.addInitScript(({ android, session }) => {
          for (const project of ['placeholder', 'ndgnhvbpmtxrpplgsslz']) {
            localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
          }
          if (android) window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} }
        }, { android, session })
        const calls = []
        let payload = null
        let pending = { pending: 4 }
        let reviewed = false
        let locked = configure
        const hubs = manage ? [{ id: 'demo', name: 'DEMO Hub' }, ...(configure ? [{ id: 'second', name: 'Second Hub' }] : [])] : []
        await context.route(/supabase\.co/, route => {
          const path = new URL(route.request().url()).pathname
          const json = data => route.fulfill({ json: data })
          if (path.endsWith('/user')) return json(session.user)
          if (path.endsWith('/profiles')) return json({ must_change_password: false })
          if (path.endsWith('/my_permissions')) return json([{ permission_code: 'hr.attendance.self', scope_type: 'global', is_super: false }])
          if (path.endsWith('/hub_register_read')) {
            const args = route.request().postDataJSON() ?? {}
            return json({ hub: args.p_hub ?? 'demo', hubs, day, manage, configure, me: manage ? null : 'employee',
              positions: [{ id: 'rider', name: 'Rider' }], people: [{ id: 'employee', name: 'DEMO Rider' }], rules: [],
              month: args.p_month ? [{ day, book: 'attendance', totals: { present: 1 } }] : null,
              books: books.map(id => ({ id, locked: id === 'attendance' && locked, totals: {}, history: [], rows: [{
                employee_id: 'employee', required: id !== 'expense',
                complete: id === 'attendance' ? Boolean(payload) : id === 'pending' && 'return' in pending,
                source_payload: id === 'pending' ? { pending: 4 } : null, name: manage ? 'DEMO Rider' : `DEMO ${role}`, duty: id,
                due: `${day}T16:59:00Z`, payload: id === 'attendance' ? payload : id === 'pending' ? pending : null,
                source: id === 'pending' ? 'existing' : payload && id === 'attendance' ? (manage ? 'proxy' : 'self') : null, reviewed: reviewed && id === 'attendance',
              }] })),
            })
          }
          if (path.endsWith('/hub_register_write')) {
            const body = route.request().postDataJSON()
            calls.push(body)
            if (body.p_action === 'save' && body.p_book === 'attendance') payload = body.p_data
            if (body.p_action === 'save' && body.p_book === 'pending') pending = body.p_data
            if (body.p_action === 'review') reviewed = true
            if (body.p_action === 'submit') locked = true
            if (body.p_action === 'reopen') locked = false
            return json(null)
          }
          return json(null)
        })
        const page = await context.newPage()
        await page.goto(`${base}/app/hub-registers`)
        const workflow = page.locator('.hub-register-workflow')
        await workflow.waitFor()
        assert.equal(await workflow.locator('.hub-register-card').count(), 5)
        const attendance = workflow.locator('.hub-register-card').first()
        if (configure) {
          await attendance.locator(':scope > form input').fill('Correct the demo record')
          await attendance.locator(':scope > form button').click()
          await attendance.locator('summary').filter({ hasText: /দায়িত্ব|Assignments/ }).click()
          await attendance.locator('details form input[maxlength="120"]').fill('Morning register')
          await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/hub_register_write')
              && response.request().postDataJSON()?.p_action === 'rule'),
            attendance.locator('details form button').click(),
          ])
          assert.deepEqual(calls.map(call => call.p_action), ['reopen', 'rule'])
          await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/hub_register_read')
              && response.request().postDataJSON()?.p_hub === 'second'),
            workflow.locator('select').first().selectOption('second'),
          ])
        } else {
          await attendance.locator('summary').first().click()
          await attendance.locator('.hub-pending-rows button').first().click()
          await attendance.locator('form select').selectOption('leave')
          await attendance.locator('form input[type=date]').fill(day)
          if (manage) await attendance.locator('form input[maxlength="500"]').fill('Employee reported by phone')
          await attendance.locator('form button[type=submit]').click()
          await attendance.getByText(/যাচাই বাকি|Review due/, { exact: false }).waitFor()
          assert.deepEqual(calls[0].p_data, { status: 'leave', application_date: day })
          assert.equal(calls[0].p_reason, manage ? 'Employee reported by phone' : null)
          if (manage) {
            await attendance.locator('.hub-pending-rows li > button').first().click()
            await attendance.locator(':scope > button').click()
            await attendance.getByText(/লক করা|Locked/).waitFor()
            assert.deepEqual(calls.map(call => call.p_action), ['save', 'review', 'submit'])
            await workflow.locator('input[type=month]').fill(day.slice(0, 7))
            await workflow.getByRole('heading', { name: /মাসের জমা খাতার রিপোর্ট|Monthly report of submitted registers/ }).waitFor()
          }
        }
        const expense = workflow.locator('.hub-register-card').last()
        await expense.locator('summary').first().click()
        await expense.getByText(/খরচ হলে এন্ট্রি দিন|Enter only if there was an expense/).waitFor()
        if (role === 'Rider') {
          const pendingBook = workflow.locator('.hub-register-card').nth(2)
          await pendingBook.locator('summary').first().click()
          await pendingBook.getByText(/ফেরতের তথ্য বাকি|Return count missing/).waitFor()
          await pendingBook.locator('.hub-pending-rows button').first().click()
          assert.equal(await pendingBook.locator('form input[readonly]').inputValue(), '4')
          await pendingBook.locator('form input:not([readonly])').fill('0')
          await pendingBook.locator('form button[type=submit]').click()
          await pendingBook.getByText(/যাচাই বাকি|Review due/).waitFor()
          assert.deepEqual(calls.at(-1).p_data, { pending: 4, return: 0 })
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
        console.log(`PASS ${android ? 'Android bridge fixture' : 'desktop web'} · DEMO ${role}`)
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser?.close()
  app.kill()
}
