import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:4189'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '4189', '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore',
  env: { ...process.env, VITE_SUPABASE_URL: 'https://placeholder.supabase.co', VITE_SUPABASE_ANON_KEY: 'placeholder-test-only' },
})
let browser
try {
  for (let tryCount = 0; tryCount < 50; tryCount++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true })
  const width = Number(process.env.HUB_TEST_WIDTH) || 390
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block' })
  const b64 = data => Buffer.from(JSON.stringify(data)).toString('base64url')
  const user = { id: 'u1', email: 'manager@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} }
  const token = { access_token: `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:'u1',exp:4102444800})}.sig`,
    refresh_token: 'r', expires_at: 4102444800, token_type: 'bearer', user }
  await ctx.addInitScript(s => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('xzm_lang', 'en')
  }, token)
  await ctx.route(/fonts\.(googleapis|gstatic)/, route => route.abort())
  const date = '2026-11-25'
  const hub = { id: 'h1', name: 'Demo Hub', zone_id: 'z1', status: 'active', archived_at: null }
  const figures = { pickup: 10, pickup_return: 1, delivery: 7, delivery_return: 2, pending: 0 }
  let approved = false
  let submitted
  await ctx.route(/placeholder\.supabase\.co/, route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON()
    const respond = (data) => route.fulfill({ status: 200, json: data, headers: { 'access-control-allow-origin': '*',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (route.request().method() === 'OPTIONS') return respond(null)
    if (path.endsWith('/my_permissions')) return respond(['org.hub.view','hr.attendance.view','hr.attendance.create','ops.staff_daily.view',
      'ops.staff_daily.edit','da.sheet.view','da.sheet.create'].map(permission_code => ({ permission_code, scope_type:'hub', hub_id:hub.id })))
    if (path.endsWith('/profiles')) return respond({ must_change_password: false })
    if (path.endsWith('/hubs')) return respond([hub])
    if (path.endsWith('/zones')) return respond([])
    if (path.endsWith('/my_menu')) return respond(['/app/attendance','/app/accounts/daily','/app/accounts/center'])
    if (path.endsWith('/wf_hub_overview')) return respond({hub, date, can:{attendance:true, decide:true, ops:true, ops_edit:true},
      pending:{marks:0,applications:0}, people:[]})
    if (path.endsWith('/wf_marks')) return respond([])
    if (path.endsWith('/wf_ops_report')) return respond({ rows: [{ ...figures, id:'entry1', hub_id:'h1', work_date:date,
      review_status: approved ? 'approved' : null, revision:1, employee_name:'Demo staff', employee_code:'103' }] })
    if (path.endsWith('/wf_ops_decide')) { approved = true; return respond(null) }
    if (path.endsWith('/wf_pending_hub_on')) return respond({ rows:[], can_edit:true, date })
    if (path.endsWith('/wf_hub_register_status')) return respond({ source_key:approved ? 'checked' : 'unreviewed',
      staff_totals: approved ? figures : Object.fromEntries(Object.keys(figures).map(key => [key, 0])),
      approved_count:+approved, unresolved_count:+!approved, submitted:submitted ?? null })
    if (path.endsWith('/wf_hub_register_submit')) {
      assert.equal(body.p_hub, 'h1')
      assert.equal(body.p_source_key, 'checked')
      assert.equal(body.p_version, 0)
      assert.equal(body.p_manual.pickup, 2)
      submitted = { version: 1, source_key:'checked', note:body.p_note, manual:body.p_manual, totals:{ ...figures, pickup:12 } }
      return respond(1)
    }
    if (path.endsWith('/att_sheet_get')) return respond(null)
    return respond(null)
  })
  const page = await ctx.newPage()
  await page.goto(`${base}/app/hub-registers`)
  await page.getByRole('link', { name:'Review staff entries and submit hub register' }).click({ timeout: 15000 })
  const submit = page.getByRole('button', { name:'Submit hub register', exact:true })
  await submit.waitFor()
  assert.equal(await submit.isDisabled(), true)
  await page.getByRole('button', { name:'Approve', exact:true }).click()
  await page.getByRole('textbox', { name:'Pickup', exact:true }).fill('2')
  await page.getByRole('textbox', { name:'Reason or source for manager entries' }).fill('Verified extra work')
  await submit.click()
  await page.getByText('Register submitted. Version 1.', { exact:true }).waitFor()
  assert.equal(submitted.totals.pickup, 12)
  console.log(`Manager browser at ${width}px passed: hub register link, approval gate, manual entry and successful submission.`)
} finally {
  await browser?.close()
  server.kill()
}
