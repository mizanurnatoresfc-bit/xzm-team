// UI/UX measurements for every page a role can reach (same set-up as walk.mjs): pages wider than the screen,
// small tap targets, tiny text, cut-off text, sideways-scrolling strips, English-only text and axe-core (WCAG A/AA) results.
// Needs: npm i --no-save pg axe-core   Run from web/:  OUT=/tmp/ux PORT=4201 ROLES=hub_mgr SIZES=phone node ../scripts/role-demo/ux.mjs
// PATHS=/app,/app/staff checks only those pages. Full-page screenshots and report-<role>-<size>.json land in OUT.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { open } from './walk.mjs'
import { end } from './gw.mjs'
const WEB = new URL('../../web/', import.meta.url).pathname
const req = createRequire(WEB)
const { chromium } = req('playwright')
const AXE = readFileSync(WEB + 'node_modules/axe-core/axe.min.js', 'utf8')
const OUT = process.env.OUT || WEB + 'role-demo-out/ux'
const BASE = `http://localhost:${process.env.PORT}`
const ROLES = process.env.ROLES.split(','), SIZES = (process.env.SIZES || 'pc,phone').split(',')
const MAX = Number(process.env.MAX || 150)
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const report = {}
for (const who of ROLES) for (const size of SIZES) {
  const viewport = size === 'pc' ? { width: 1366, height: 800 } : { width: 390, height: 800 }
  const { ctx, log } = await open(browser, who, viewport)
  const page = await ctx.newPage()
  const dir = `${OUT}/shots/${who}-${size}`; mkdirSync(dir, { recursive: true })
  const seen = new Set(), queue = process.env.PATHS ? process.env.PATHS.split(',') : ['/app'], pages = []
  while (queue.length && seen.size < MAX) {
    const path = queue.shift(); if (seen.has(path)) continue; seen.add(path)
    log.page = path
    const t0 = Date.now()
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {}); await page.waitForTimeout(350)
    const ms = Date.now() - t0
    let info
    try {
      await page.evaluate(AXE)
      info = await page.evaluate(async (phone) => {
        const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.right > 0 && r.left < innerWidth }
        const label = el => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 40)
        const cls = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
        const inter = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],summary')].filter(vis)
        const small = inter.filter(el => { const r = el.getBoundingClientRect(); if (el.matches('input[type=checkbox],input[type=radio]')) { const l = el.closest('label'); if (l) { const lr = l.getBoundingClientRect(); return lr.height < 36 } } if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false; return r.height < 36 || r.width < 36 })
        const tiny = [], eng = []
        const w = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT)
        let n; while ((n = w.nextNode())) { const t = n.textContent.trim(); if (!t || !n.parentElement || !vis(n.parentElement)) continue
          const fs = parseFloat(getComputedStyle(n.parentElement).fontSize); if (fs < 12) tiny.push(`${fs}px ${cls(n.parentElement)}: ${t.slice(0, 30)}`)
          if (/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(t) && !/[ঀ-৿]/.test(t) && !/@|test\.local|Rider|Manager|Zonal|Hub [AB]|Zone [AB]/.test(t)) eng.push(t.slice(0, 50)) }
        const trunc = [...document.querySelectorAll('main *')].filter(el => vis(el) && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(el).overflowX)).map(el => `${cls(el)}: ${el.textContent.trim().slice(0, 30)}`)
        const hscroll = [...document.querySelectorAll('main *')].filter(el => vis(el) && el.scrollWidth > el.clientWidth + 8 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)).map(el => `${cls(el)} ${el.scrollWidth}/${el.clientWidth}`)
        let axe = []
        try { const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })
          axe = r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 3).map(x => x.target.join(' ').slice(0, 90) + (v.id === 'color-contrast' ? ' ' + (x.any[0]?.data ? `${x.any[0].data.fgColor}/${x.any[0].data.bgColor}=${x.any[0].data.contrastRatio}` : '') : '')) })) } catch (e) { axe = [{ id: 'AXE-ERR', n: 0, ex: [String(e).slice(0, 100)] }] }
        return { at: location.pathname + location.search, h1: [...document.querySelectorAll('h1')].filter(vis).map(e => e.textContent.trim().slice(0, 60)), docTitle: document.title,
          crash: !!document.querySelector('main.crash'),
          links: [...new Set([...document.querySelectorAll('a[href^="/app"]')].map(a => a.getAttribute('href')))],
          chars: (document.querySelector('main')?.innerText ?? document.body.innerText).trim().length,
          wide: document.documentElement.scrollWidth - document.documentElement.clientWidth, height: document.documentElement.scrollHeight,
          nInter: inter.length, small: small.length, smallEx: [...new Set(small.map(el => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} ${cls(el)} "${label(el)}"` }))].slice(0, 8),
          tiny: tiny.length, tinyEx: [...new Set(tiny)].slice(0, 6), eng: [...new Set(eng)].slice(0, 8), engN: eng.length,
          trunc: trunc.length, truncEx: [...new Set(trunc)].slice(0, 5), hscroll: [...new Set(hscroll)].slice(0, 5),
          loading: [...document.querySelectorAll('.skeleton,.loading,[aria-busy=true]')].filter(vis).length, axe }
      }, size === 'phone')
    } catch (e) { info = { at: path, err: String(e).slice(0, 200), links: [] } }
    pages.push({ path, ms, ...info, links: undefined })
    if (!process.env.PATHS && info.at.split('?')[0] === path.split('?')[0]) for (const l of info.links) if (!seen.has(l) && !/\/app\/(hr\/employees|users|access\/(role|user)|accounts\/daily)\/[0-9a-f-]{8,}/.test(l)) queue.push(l)
    await page.screenshot({ path: `${dir}/${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.png`, fullPage: true }).catch(() => {})
  }
  report[`${who}-${size}`] = { pages, api: log.api }
  console.log(`${who} ${size}: ${pages.length} pages`)
  await ctx.close()
}
writeFileSync(`${OUT}/report-${ROLES.join("_")}-${SIZES.join("_")}.json`, JSON.stringify(report))
await browser.close(); await end(); process.exit(0)
