// Try one thing by hand as one role: node try.mjs <who> <pc|phone> <path> '<json steps>'
// steps: ["click","text"] ["clickSel","css"] ["fill","css","value"] ["select","css","value"] ["wait",ms] ["goto","/app/..."] ["text"] ["shot","name"] ["html","css"]
import { open } from './walk.mjs'
import { sql, end } from './gw.mjs'
import { createRequire } from 'node:module'
const WEB = new URL('../../web/', import.meta.url).pathname
const { chromium } = createRequire(WEB)('playwright')
const [who, size, path, stepsJson] = process.argv.slice(2)
const BASE = `http://localhost:${process.env.PORT || 4188}`
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const { ctx, log } = await open(browser, who, size === 'pc' ? { width: 1366, height: 800 } : { width: 390, height: 800 })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('!! CRASH', String(e).slice(0, 300)))
page.on('dialog', d => { console.log('!! DIALOG', d.message()); d.accept() })
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(350) }
const text = async (sel = 'main') => console.log('--- TEXT\n' + (await page.evaluate(s => (document.querySelector('[role=dialog]') ?? document.querySelector(s) ?? document.body).innerText, sel)).replace(/\n{2,}/g, '\n').slice(0, Number(process.env.MAX || 2500)))
log.page = path; await page.goto(BASE + path); await settle()
for (const st of JSON.parse(stepsJson?.startsWith('@') ? (await import('node:fs')).readFileSync(stepsJson.slice(1), 'utf8') : stepsJson || '[]')) {
  const [op, a, b] = st
  try {
    if (op === 'click') await page.getByText(a, { exact: !!b }).filter({ visible: true }).first().click({ timeout: 5000 })
    else if (op === 'btn') await page.getByRole('button', { name: a, exact: !!b }).filter({ visible: true }).first().click({ timeout: 5000 })
    else if (op === 'clickSel') await page.locator(a).filter({ visible: true }).nth(b || 0).click({ timeout: 5000 })
    else if (op === 'fill') await page.locator(a).filter({ visible: true }).first().fill(b, { timeout: 5000 })
    else if (op === 'label') await page.getByLabel(a).filter({ visible: true }).first().fill(b, { timeout: 5000 })
    else if (op === 'select') await page.locator(a).filter({ visible: true }).first().selectOption(b, { timeout: 5000 })
    else if (op === 'wait') await page.waitForTimeout(a)
    else if (op === 'goto') { log.page = a; await page.goto(BASE + a) }
    else if (op === 'text') { await settle(); await text(a) }
    else if (op === 'shot') { await settle(); await page.screenshot({ path: `${WEB}role-demo-out/${a}.png`, fullPage: !!b }) }
    else if (op === 'elshot') { await page.locator(a).first().scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, 200)); await page.screenshot({ path: `${WEB}role-demo-out/${b}.png` }) }
    else if (op === 'html') console.log('--- HTML\n' + (await page.locator(a).first().evaluate(e => e.outerHTML)).slice(0, 4000))
    else if (op === 'controls') { await settle(); console.log('--- CONTROLS\n' + (await page.evaluate(() => [...(document.querySelector('[role=dialog]') ?? document.querySelector('main')).querySelectorAll('button,input,select,textarea,a.btn')].filter(e => e.getBoundingClientRect().width > 0).map(e => `${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''}${e.disabled ? ' DISABLED' : ''} name=${e.name || ''} ph=${e.placeholder || ''} aria=${e.getAttribute('aria-label') || ''} :: ${(e.innerText || e.value || '').trim().slice(0, 60)}`).join('\n'))).slice(0, 5000)) }
    await settle()
  } catch (e) { console.log(`!! step ${JSON.stringify(st)} failed: ${String(e).split('\n')[0].slice(0, 200)}`) }
}
const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast,[role=status],[role=alert],.da-error')].map(e => e.innerText.trim()).filter(Boolean))
if (toasts.length) console.log('--- TOASTS/ALERTS', JSON.stringify([...new Set(toasts)]))
for (const a of log.api) console.log('!! API', a.status, a.code ?? '', a.what, '::', a.msg ?? '')
console.log('at', page.url().replace(BASE, ''), '| db calls', log.calls)
await browser.close(); await end(); process.exit(0)
