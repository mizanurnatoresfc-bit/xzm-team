/* XZM TEAM service worker — one job: let the app OPEN with no internet (a rider in a place without signal, see docs/ROUTE_MODULE.md "Offline check-in").
 *
 * What it does
 *   - Page loads (navigation): the network first (so an online person always gets the newest app); if it fails or takes more than 6 seconds, the last saved copy.
 *   - /assets/*: files named by their content (never change): kept after first use, and all of them fetched quietly in the background after an update (/precache.json).
 *   - Nothing else. Database / login / function calls (another site), /version.json, /download/*, /offline.html, /sw.js and every non-GET request are left to the browser untouched.
 *
 * To switch it off for everybody: publish a sw.js containing only   self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(
 *   caches.keys().then(k => Promise.all(k.map(x => caches.delete(x)))).then(() => self.registration.unregister())))
 * Change CACHE_VERSION when the rules below change (old caches are removed on activation).
 */
const CACHE_VERSION = 'v1'
const SHELL = `xzm-shell-${CACHE_VERSION}`
const ASSETS = `xzm-assets-${CACHE_VERSION}`
const NAV_TIMEOUT_MS = 6000
const MAX_ASSETS = 400

const isHtml = res => /text\/html/i.test(res.headers.get('content-type') || '')
const assetUrls = html => [...new Set([...html.matchAll(/["'](\/assets\/[^"'?#]+)["']/g)].map(m => m[1]))]

/** Keep a fetched asset unless it is a page in disguise (a missing file is answered with index.html by the host: never keep that as a script). */
async function keep(cache, url, res) {
  if (!res || !res.ok || isHtml(res)) return false
  await cache.put(url, res)
  return true
}
async function trim(cache) {
  const keys = await cache.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k)
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      // the page shell and the files it needs at once, so the very next start works with no internet
      const shell = await caches.open(SHELL)
      const res = await fetch('/index.html', { cache: 'reload' })
      if (res.ok && isHtml(res)) {
        const text = await res.clone().text()
        await shell.put('/index.html', res)
        const assets = await caches.open(ASSETS)
        await Promise.all(assetUrls(text).map(async u => {
          if (await assets.match(u)) return
          try { await keep(assets, u, await fetch(u)) } catch { /* fetched on first use instead */ }
        }))
      }
    } catch { /* offline while installing: the next visit tries again */ }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== ASSETS) await caches.delete(k)
    await self.clients.claim()
    // the rest of the app's files (the other pages), quietly: only the ones not kept yet
    try {
      const list = await (await fetch('/precache.json', { cache: 'no-cache' })).json()
      const assets = await caches.open(ASSETS)
      const todo = []
      for (const f of Array.isArray(list.files) ? list.files : []) {
        if (typeof f === 'string' && /^\/assets\/[^?#]+$/.test(f) && !(await assets.match(f))) todo.push(f)
      }
      for (let i = 0; i < todo.length; i += 6) {
        await Promise.all(todo.slice(i, i + 6).map(async u => { try { await keep(assets, u, await fetch(u)) } catch { /* later, on first use */ } }))
      }
      await trim(assets)
    } catch { /* no list (an older build) or no internet: files are kept on first use instead */ }
  })())
})

async function page(event) {
  const shell = await caches.open(SHELL)
  let timer
  try {
    // the original request is passed on untouched (its redirect rules matter for a page load); only the waiting is limited
    const res = await Promise.race([fetch(event.request),
      new Promise((_, bad) => { timer = setTimeout(() => bad(new Error('slow')), NAV_TIMEOUT_MS) })])
    clearTimeout(timer)
    // every address of the app is the same page (index.html); keep the newest copy for the next time there is no internet
    if (res.ok && !res.redirected && isHtml(res)) event.waitUntil(shell.put('/index.html', res.clone()).catch(() => undefined))
    return res
  } catch {
    clearTimeout(timer)
    const saved = await shell.match('/index.html')
    if (saved) return saved
    throw new Error('offline and nothing saved')   // the browser / app shows its own offline page
  }
}

async function asset(event) {
  const assets = await caches.open(ASSETS)
  const hit = await assets.match(event.request.url)
  if (hit) return hit
  const res = await fetch(event.request)
  if (res.ok && !isHtml(res)) event.waitUntil(keep(assets, event.request.url, res.clone()).then(() => trim(assets)).catch(() => undefined))
  return res
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const p = url.pathname
  if (p === '/sw.js' || p === '/version.json' || p === '/precache.json' || p === '/offline.html' || p.startsWith('/download/')) return
  if (req.mode === 'navigate') { event.respondWith(page(event)); return }
  if (p.startsWith('/assets/')) event.respondWith(asset(event))
})
