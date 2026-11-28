import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { moduleRegistry, releaseDefaults } from '../src/lib/moduleRelease.ts'

const base = 'http://localhost:4186'
const demoHub = '00000000-0000-4000-8000-000000000001'
const encoded = data => Buffer.from(JSON.stringify(data)).toString('base64url')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4186', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 40; i++) {
    if (await fetch(base).then(r => r.ok, () => false)) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  for (const platform of ['web', 'android']) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: platform === 'android' ? { width: 390, height: 820 } : { width: 1280, height: 900 } })
    const user = { id: 'release-user', aud: 'authenticated', role: 'authenticated', email: 'release@example.com', user_metadata: {}, app_metadata: {} }
    const token = encoded({ alg: 'HS256' }) + '.' + encoded({ sub: user.id, exp: 4102444800 }) + '.test'
    await context.addInitScript(({ user, token, platform }) => {
      const s = JSON.stringify({ access_token: token, refresh_token: 'test', token_type: 'bearer', expires_at: 4102444800, user })
      for (const id of ['ndgnhvbpmtxrpplgsslz', 'placeholder']) localStorage.setItem('sb-' + id + '-auth-token', s)
      if (platform === 'android') window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} }
    }, { user, token, platform })
    let superAdmin = true
    let blocked = 'accounts.daily'
    let saved
    let requestPlatform
    const catalog = {
      modules: [{ id: 'accounts.daily', parent: 'accounts', revision: 0, config: releaseDefaults, evidence: null, verified: false }],
      roles: [{ id: 'manager', name: 'Hub Manager' }], hubs: [{ id: demoHub, name: 'DEMO Hub', code: 'DEMO' }],
    }
    await context.route(/fonts\.(googleapis|gstatic)/, route => route.abort())
    await context.route(/supabase\.co/, async route => {
      const url = route.request().url()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      const json = data => route.fulfill({ json: data, headers: cors })
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (url.includes('/auth/v1/user')) return json(user)
      if (url.includes('/rest/v1/profiles')) return json({ must_change_password: false })
      if (url.includes('/rpc/my_permissions')) return json([{ permission_code: superAdmin ? '*' : 'hr.attendance.self', scope_type: 'global', is_super: superAdmin }])
      if (url.includes('/rpc/my_menu')) return json(null)
      if (url.includes('/rpc/module_release_snapshot')) {
        const { p_platform, p_hub, p_preview } = route.request().postDataJSON()
        requestPlatform = p_platform
        return json(Object.fromEntries(Object.keys(moduleRegistry).map(id => [id, {
          allowed: id !== blocked || (p_hub === demoHub && p_preview === 'manager'), order: null,
        }])))
      }
      if (url.includes('/rpc/module_release_admin')) return json(catalog)
      if (url.includes('/rpc/module_release_history')) return json([])
      if (url.includes('/rpc/module_release_save')) {
        saved = route.request().postDataJSON()
        catalog.modules[0] = { ...catalog.modules[0], revision: 1, config: saved.p_config }
        return json(1)
      }
      if (url.includes('/rpc/dashboard_home')) return json({ panels: [], me: null })
      return json([])
    })
    const page = await context.newPage()
    await page.goto(base + '/app/accounts/daily')
    await page.getByRole('heading', { name: 'এই মডিউলটি এখন চালু নেই' }).waitFor()
    assert.equal(requestPlatform, platform)
    await page.goto(base + '/app/module-control')
    await page.getByRole('button', { name: 'Unpublish', exact: true }).waitFor()
    assert.match(await page.title(), /মডিউল নিয়ন্ত্রণ কেন্দ্র/)
    const ready = page.getByRole('option', { name: 'Release Ready' })
    assert.equal(await ready.isDisabled(), true)
    await page.getByLabel('Role', { exact: true }).selectOption('manager')
    await page.getByLabel('Hub', { exact: true }).selectOption(demoHub)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await page.getByText('Release policy allows access.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Unpublish', exact: true }).click()
    await page.getByText('Saved status · Development').waitFor()
    assert.equal(saved.p_config.stage, 'development')
    superAdmin = false
    blocked = ''
    await page.goto(base + '/app/accounts/daily')
    await page.getByRole('heading', { name: 'অনুমতি নেই', exact: true }).waitFor()
    await page.goto(base + '/app/module-control')
    await page.waitForURL(base + '/app')
    await context.close()
    console.log(`${platform}: direct URL, platform, Super Admin, role preview, unpublish and permission checks passed`)
  }
} finally {
  await browser?.close()
  server.kill()
}
