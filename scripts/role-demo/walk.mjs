// Opens every page each role can reach, in a real browser, against the local demo database.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { rest, sql, end, unsupported } from './gw.mjs'
const WEB = new URL('../../web/', import.meta.url).pathname
const { chromium } = createRequire(WEB)('playwright')

const S = WEB + 'role-demo-out/'
const PORT = Number(process.env.PORT || 4188), BASE = `http://localhost:${PORT}`
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const ROLES = (process.env.ROLES || 'rider_login,hub_mgr,zonal_a').split(',')
const SIZES = (process.env.SIZES || 'pc,phone').split(',')
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null

const server = spawn('npx', ['vite', 'preview', '--outDir', WEB + 'dist-demo', '--port', String(PORT), '--strictPort'], { cwd: WEB, stdio: 'ignore' })
process.on('exit', () => { try { server.kill() } catch {} })
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }

export async function open(browser, who, viewport) {
  const { rows: [u] } = await sql(`select u.id, u.email, u.raw_user_meta_data->>'full_name' as name from auth.users u where u.id = tests.id($1)`, [who])
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, role: 'authenticated', exp: 4102444800, email: u.email })}.sig`
  const user = { id: u.id, email: u.email, user_metadata: { full_name: u.name }, app_metadata: {}, aud: 'authenticated', role: 'authenticated' }
  const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user }
  const ctx = await browser.newContext({ viewport, locale: 'bn-BD', timezoneId: 'Asia/Dhaka' })
  await ctx.addInitScript(s => { localStorage.setItem('sb-xzmdemo-auth-token', s) }, JSON.stringify(session))
  await ctx.route(/fonts\.(googleapis|gstatic)|cdn\.jsdelivr\.net|openstreetmap\.org|project-osrm\.org/, r => r.abort())
  const log = { api: [], calls: 0 }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
  await ctx.route(/xzmdemo\.supabase\.co/, async r => {
    const req = r.request(), url = req.url(), method = req.method()
    if (method === 'OPTIONS') return r.fulfill({ status: 200, headers: cors })
    const j = (status, d, h = {}) => r.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...h }, body: d === null ? '' : JSON.stringify(d) })
    if (url.includes('/auth/v1/user')) return j(200, user)
    if (url.includes('/auth/v1/token')) return j(200, session)
    if (url.includes('/auth/v1/')) return j(200, {})
    if (url.includes('/storage/v1/object/sign')) return j(200, { signedURL: '/object/sign/x?token=t' })
    if (url.includes('/storage/v1/')) return method === 'GET' ? j(404, { error: 'not found' }) : j(200, { Key: 'k', path: 'k' })
    if (url.includes('/functions/v1/')) { log.api.push({ page: log.page, what: `${method} ${new URL(url).pathname}`, status: 'FUNCTION (not in demo)' }); return j(404, { error: 'no edge function in demo' }) }
    if (url.includes('/rest/v1/')) {
      log.calls++
      const out = await rest(method, url, req.headers(), req.postData(), u.id)
      if (out.status >= 400 && out.status !== 406) log.api.push({ page: log.page, what: `${method} ${new URL(url).pathname.replace('/rest/v1/', '')}${method === 'GET' ? new URL(url).search.slice(0, 160) : ' ' + (req.postData() || '').slice(0, 160)}`, status: out.status, code: out.json?.code, msg: out.json?.message })
      return j(out.status, out.json, out.headers)
    }
    return r.abort()
  })
  return { ctx, log, user }
}

if (process.argv[1].endsWith('walk.mjs')) {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  const report = {}
  for (const who of ROLES) for (const size of SIZES) {
    const viewport = size === 'pc' ? { width: 1366, height: 800 } : { width: 390, height: 800 }
    const { ctx, log } = await open(browser, who, viewport)
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', e => errs.push({ page: log.page, kind: 'crash', msg: String(e).slice(0, 300) }))
    page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_FAILED|ERR_NAME|Failed to load resource|net::/.test(m.text())) errs.push({ page: log.page, kind: 'console', msg: m.text().slice(0, 300) }) })
    const dir = `${S}shots/${who}-${size}`; mkdirSync(dir, { recursive: true })
    const seen = new Set(), queue = ['/app'], pages = []
    const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400) }
    while (queue.length && seen.size < 140) {
      const path = queue.shift(); if (seen.has(path)) continue; seen.add(path)
      if (ONLY && path !== '/app' && !ONLY.some(o => path.startsWith(o))) continue
      log.page = path
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }).catch(e => errs.push({ page: path, kind: 'nav', msg: String(e) }))
      await settle()
      const info = await page.evaluate(() => {
        const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
        const txt = sel => [...document.querySelectorAll(sel)].filter(vis).map(e => e.textContent.trim().slice(0, 200)).filter(Boolean)
        return { at: location.pathname + location.search, title: document.querySelector('h1')?.textContent?.trim() ?? null,
          crash: !!document.querySelector('main.crash'), errors: [...new Set([...txt('.da-error'), ...txt('[role=alert]'), ...txt('.alert-card.bad')])],
          links: [...new Set([...document.querySelectorAll('a[href^="/app"]')].map(a => a.getAttribute('href')))],
          chars: (document.querySelector('main')?.innerText ?? document.body.innerText).trim().length,
          wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          english: null }
      })
      pages.push({ path, ...info, links: undefined })
      if (info.at.split('?')[0] === path.split('?')[0]) for (const l of info.links) if (!seen.has(l) && !/\/app\/(hr\/employees|users|access\/(role|user)|accounts\/daily)\/[0-9a-f-]{8,}/.test(l)) queue.push(l)
      await page.screenshot({ path: `${dir}/${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.png`, fullPage: false }).catch(() => {})
    }
    report[`${who}-${size}`] = { pages, api: log.api, errs, calls: log.calls }
    console.log(`\n=== ${who} ${size}: ${pages.length} pages, ${log.calls} db calls, ${log.api.length} failed calls, ${errs.length} browser errors`)
    for (const p of pages) { const flags = [p.crash && 'CRASH', p.at.split('?')[0] !== p.path.split('?')[0] && `-> ${p.at}`, p.errors.length && `ERR: ${p.errors.join(' | ').slice(0, 200)}`, p.wide > 4 && `WIDE+${p.wide}`, p.chars < 40 && `EMPTY(${p.chars})`].filter(Boolean)
      console.log(`${flags.length ? '!!' : 'ok'} ${p.path}  [${p.title ?? ''}] ${flags.join('  ')}`) }
    const dd = new Map(); for (const a of log.api) { const k = a.what.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID') + '::' + a.msg; dd.set(k, { ...a, pages: [...(dd.get(k)?.pages ?? []), a.page] }) }
    for (const a of dd.values()) console.log(`   API ${a.status} ${a.code ?? ''} x${a.pages.length} @${[...new Set(a.pages)].slice(0, 3).join(' , ')}: ${a.what} :: ${a.msg ?? ''}`)
    for (const e of errs) console.log(`   ${e.kind} @${e.page}: ${e.msg}`)
    await ctx.close()
  }
  mkdirSync(S, { recursive: true }); writeFileSync(S + 'walk-report.json', JSON.stringify(report, null, 1))
  if (unsupported.length) console.log('\nSHIM unsupported:\n' + [...new Set(unsupported)].join('\n'))
  await browser.close(); await end(); process.exit(0)
}
