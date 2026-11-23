// The Android app's "feels like an app" parts (owner, 23 Nov 2026): a light buzz on taps and results, the bottom bar
// stepping aside while you type, pull down to refresh, and the phone's own camera for every photo box.
// Native plugins are reached through window.Capacitor, as in native.ts. An older APK that lacks a plugin simply does
// without that part: nothing here may throw or block the page.
import { askChoice } from '../components/ask'
import { Icon } from '../components/Icon'

type HapticsPlugin = {
  impact: (o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }) => Promise<void>
  notification: (o: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }) => Promise<void>
  selectionStart?: () => Promise<void>
  selectionChanged: () => Promise<void>
  selectionEnd?: () => Promise<void>
}
type Photo = { dataUrl?: string; format?: string }
type CameraPlugin = {
  getPhoto: (o: { source: 'CAMERA' | 'PHOTOS' | 'PROMPT'; resultType: 'dataUrl' | 'uri' | 'base64'; quality?: number; width?: number;
    correctOrientation?: boolean; saveToGallery?: boolean; promptLabelHeader?: string }) => Promise<Photo>
}
type Cap = { isNativePlatform?: () => boolean; Plugins?: { Haptics?: HapticsPlugin; Camera?: CameraPlugin } }
const cap = (): Cap | undefined => (typeof window !== 'undefined' ? (window as unknown as { Capacitor?: Cap }).Capacitor : undefined)
const native = () => Boolean(cap()?.isNativePlatform?.())
const L = (bn: string, en: string) => (document.documentElement.lang === 'en' ? en : bn)

// ---------------------------------------------------------------- haptics
export type Buzz = 'tap' | 'select' | 'success' | 'warn' | 'error'
let lastBuzz = 0
/** A short buzz in the app (nothing on the website). Taps closer than 40 ms apart buzz once. */
export function haptic(kind: Buzz = 'tap'): void {
  const h = native() ? cap()?.Plugins?.Haptics : undefined
  if (!h) return
  const now = Date.now(); if (now - lastBuzz < 40) return; lastBuzz = now
  const p = kind === 'tap' ? h.impact({ style: 'LIGHT' })
    : kind === 'select' ? h.selectionChanged()
    : h.notification({ type: kind === 'success' ? 'SUCCESS' : kind === 'warn' ? 'WARNING' : 'ERROR' })
  void p?.catch?.(() => undefined)
}

/** Bottom tabs, the + button and menu rows answer with a light tick. */
function buzzOnTabs(): void {
  document.addEventListener('click', e => {
    const t = (e.target as Element | null)?.closest?.('.bottom-nav a, .bottom-nav button, .side a.nl, .quick-tile, .da-tabs button, .hub-tabs a')
    if (t) haptic('select')
  }, true)
}

// ---------------------------------------------------------------- keyboard
/** While the on-screen keyboard is up, <html> gets `kb-open`: the bottom bar and floating buttons step aside (CSS), and the
 *  box being typed in is kept in view. Works on the website on a phone too: the keyboard shrinks the visual viewport. */
export function setupKeyboard(): void {
  const vv = window.visualViewport
  if (!vv) return
  let full = Math.max(window.innerHeight, vv.height)
  const editing = () => { const a = document.activeElement as HTMLElement | null
    return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && !/^(checkbox|radio|button|submit|file|range|color)$/i.test((a as HTMLInputElement).type ?? '') }
  const check = () => {
    if (!editing()) full = Math.max(full, vv.height, window.innerHeight)
    // the keyboard takes at least ~120px; a toolbar or rotation is smaller or changes the width too
    const open = editing() && full - vv.height > 120
    const root = document.documentElement
    if (open === root.classList.contains('kb-open')) return
    root.classList.toggle('kb-open', open)
    if (open) window.setTimeout(() => (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 60)
  }
  vv.addEventListener('resize', check)
  window.addEventListener('resize', check)
  document.addEventListener('focusin', () => window.setTimeout(check, 250))
  document.addEventListener('focusout', () => window.setTimeout(check, 100))
  window.addEventListener('orientationchange', () => { full = 0; window.setTimeout(check, 400) })
}

// ---------------------------------------------------------------- pull to refresh
/** Pull the page down from the very top and let go: the page's data loads again (App.tsx remounts the page on `app:refresh`).
 *  App only — a phone browser has its own. Not from inside a map, a sideways strip, a dialog or while typing. */
function setupPullToRefresh(): void {
  const PULL = 70, MAX = 110
  let y0 = 0, x0 = 0, dy = 0, on = false, armed = false
  let ring: HTMLDivElement | null = null
  const blocked = (t: EventTarget | null) => {
    const el = t as Element | null
    if (!el?.closest) return true
    if (document.querySelector('.da-modal, .side.open, .top-pop')) return true
    if (document.documentElement.classList.contains('kb-open')) return true
    return !!el.closest('input, textarea, select, [contenteditable], .leaflet-container, .osm-map, canvas, [data-no-pull], .da-modal')
  }
  const show = (d: number) => {
    if (!ring) {
      ring = document.createElement('div'); ring.className = 'ptr'; ring.setAttribute('aria-hidden', 'true')
      ring.innerHTML = '<span></span>'; document.body.appendChild(ring)
    }
    const k = Math.min(d, MAX)
    ring.style.setProperty('--ptr-y', `${k}px`); ring.style.setProperty('--ptr-turn', `${(k / PULL) * 300}deg`)
    ring.classList.toggle('ready', k >= PULL)
  }
  const hide = () => { if (!ring) return; const r = ring; ring = null; r.classList.add('gone'); window.setTimeout(() => r.remove(), 250) }
  window.addEventListener('touchstart', e => {
    on = false; armed = false; dy = 0
    if (e.touches.length !== 1 || window.scrollY > 0 || document.scrollingElement!.scrollTop > 0 || blocked(e.target)) return
    on = true; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX
  }, { passive: true })
  window.addEventListener('touchmove', e => {
    if (!on) return
    const t = e.touches[0]; const d = t.clientY - y0
    if (d <= 0 || Math.abs(t.clientX - x0) > d) { if (dy > 0) hide(); on = false; return }
    dy = d * 0.5
    if (e.cancelable) e.preventDefault()   // the page stays put while the ring comes down
    show(dy)
    if (dy >= PULL && !armed) { armed = true; haptic('select') } else if (dy < PULL) armed = false
  }, { passive: false })
  window.addEventListener('touchend', () => {
    if (!on) return; on = false
    if (dy >= PULL && ring) {
      ring.classList.add('spin'); ring.style.setProperty('--ptr-y', `${PULL}px`)
      window.dispatchEvent(new Event('app:refresh'))
      window.setTimeout(hide, 700)
    } else hide()
    dy = 0
  })
  window.addEventListener('touchcancel', () => { on = false; dy = 0; hide() })
}

// ---------------------------------------------------------------- touch ripple
/** Material touch ripple: a soft circle grows from the finger on buttons, menu rows, tabs, tiles and cards, like every Android app.
 *  Pure decoration (pointer-events none, removed after it plays); nothing here changes what a tap does. */
const RIPPLE_ON = 'button:not(:disabled), a.nl, .bn-item, .quick-tile, .wf-pm-tile, .sp-tile, .emp-card, .hub-link, .nv-row, .chip, .chip-toggle, .rq-tab, summary, [role=button], [role=tab], .da-seg button, label.fl-check, label.fl-toggle, .pick-row'
function setupRipple(): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (document.documentElement.getAttribute('data-motion') === 'reduce') return
    const host = (e.target as Element | null)?.closest?.(RIPPLE_ON) as HTMLElement | null
    if (!host || host.closest('.ptr, [data-no-ripple]') || host.hasAttribute('data-no-ripple')) return
    const r = host.getBoundingClientRect()
    if (r.width < 8 || r.height < 8 || r.width * r.height > 520 * 420) return   // not on page-sized blocks
    const size = Math.max(r.width, r.height) * 2.2
    // The ink lives in its own clipping layer laid over the host, so badges or dots hanging off the host are never cut.
    const wrap = document.createElement('span'); wrap.className = 'ripple-wrap'; wrap.setAttribute('aria-hidden', 'true')
    const ink = document.createElement('span'); ink.className = 'ripple-ink'
    ink.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`
    wrap.appendChild(ink)
    const hadPos = getComputedStyle(host).position !== 'static'
    if (!hadPos) host.style.position = 'relative'
    host.appendChild(wrap)
    const done = () => window.setTimeout(() => {
      ink.classList.add('out')
      window.setTimeout(() => { wrap.remove(); if (!hadPos && !host.querySelector(':scope > .ripple-wrap')) host.style.position = '' }, 300)
    }, 120)
    let ended = false; const end = () => { if (ended) return; ended = true; done() }
    host.addEventListener('pointerup', end, { once: true }); host.addEventListener('pointercancel', end, { once: true }); host.addEventListener('pointerleave', end, { once: true })
    window.setTimeout(end, 900)
  }, { capture: true, passive: true })
}

// ---------------------------------------------------------------- top bar shadow
/** The top bar sits flat on the page at the top and gets a soft shadow once the page has scrolled under it (Material "lift on scroll"). */
function setupBarLift(): void {
  let lifted = false
  const set = () => { const y = window.scrollY > 4; if (y !== lifted) { lifted = y; document.documentElement.classList.toggle('scrolled', y) } }
  window.addEventListener('scroll', set, { passive: true }); set()
}

// ---------------------------------------------------------------- swipe a sheet down to close it
/** Bottom sheets (the dialogs on a phone and the choose-one sheets) close by pulling them down, like Android's bottom sheet:
 *  drag from the grab bar / title area, past ~110px or a quick flick, and it closes as if the back button were pressed. */
function setupSheetSwipe(): void {
  const SHEETS = '.da-modal, .sheet'
  let sheet: HTMLElement | null = null, y0 = 0, dy = 0, t0 = 0
  const reset = (animate: boolean) => {
    if (!sheet) return
    const s = sheet; sheet = null
    s.style.transition = animate ? 'transform .2s ease, opacity .2s' : ''
    s.style.transform = ''; s.style.opacity = ''
    window.setTimeout(() => { s.style.transition = '' }, 220)
  }
  const close = (s: HTMLElement) => {
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    s.style.transition = 'transform .18s ease-in, opacity .18s'; s.style.transform = 'translateY(100%)'; s.style.opacity = '0'
    window.setTimeout(() => {
      // The dimmed backdrop closes its sheet on a press of itself; with no backdrop, press Escape (the same thing the back button does).
      const bg = s.closest('.sheet-bg, .da-modal-bg') as HTMLElement | null
      if (bg) bg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      else { window.dispatchEvent(esc); document.dispatchEvent(esc) }
      window.setTimeout(() => { if (s.isConnected) { s.style.transition = ''; s.style.transform = ''; s.style.opacity = '' } }, 250)
    }, 170)
    sheet = null
  }
  document.addEventListener('touchstart', e => {
    sheet = null
    const el = e.target as Element | null
    const s = el?.closest?.(SHEETS) as HTMLElement | null
    if (!s || e.touches.length !== 1) return
    if (s.classList.contains('da-modal') && window.innerWidth > 960) return      // PC dialogs are centred boxes
    if (el!.closest('input, textarea, select, [contenteditable], .leaflet-container, canvas, [data-no-swipe]')) return
    // only from the top strip (grab bar + heading) or when the sheet's own content is at its top
    const r = s.getBoundingClientRect(); const ty = e.touches[0].clientY
    const scroller = el!.closest('.modal-body, .da-modal-body, .sheet-body') as HTMLElement | null
    const atTop = (scroller ? scroller.scrollTop <= 0 : s.scrollTop <= 0)
    if (!(ty - r.top < 64 || atTop)) return
    sheet = s; y0 = ty; dy = 0; t0 = Date.now()
  }, { passive: true })
  document.addEventListener('touchmove', e => {
    if (!sheet) return
    const d = e.touches[0].clientY - y0
    if (d <= 0) { if (dy > 0) { dy = 0; sheet.style.transform = ''; sheet.style.opacity = '' } return }
    // a short pull inside scrolled content is just a scroll: start moving the sheet after a few px
    if (d < 6) return
    dy = d
    sheet.style.transition = 'none'
    sheet.style.transform = `translateY(${d}px)`; sheet.style.opacity = String(Math.max(0.4, 1 - d / 500))
    if (e.cancelable) e.preventDefault()
  }, { passive: false })
  document.addEventListener('touchend', () => {
    if (!sheet) return
    const quick = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6
    if (dy > 110 || quick) { haptic('tap'); close(sheet) } else reset(true)
  })
  document.addEventListener('touchcancel', () => reset(true))
}

// ---------------------------------------------------------------- camera
/** Every photo box in the app (input type=file that takes images) first asks "camera or gallery". Camera opens the phone's own
 *  camera through the Camera plugin and the photo lands in the same box, so each page's own upload code runs unchanged.
 *  "Gallery / file" opens the box's usual chooser (which also offers PDFs where the box takes them). */
function setupCamera(): void {
  let pass: HTMLInputElement | null = null
  document.addEventListener('click', e => {
    const input = (e.target as Element | null)?.closest?.('input[type=file]') as HTMLInputElement | null
    if (!input || input.disabled) return
    if (pass === input) { pass = null; return }          // our own "gallery" click: let the chooser open
    const accept = (input.getAttribute('accept') || '').toLowerCase()
    const images = accept === '' || /image\//.test(accept)
    const cam = cap()?.Plugins?.Camera
    if (!images || !cam) return                          // a spreadsheet / PDF-only box, or an older APK: as before
    e.preventDefault(); e.stopPropagation()
    const onlyPhoto = !/pdf|\.xlsx|\.csv/.test(accept)
    const direct = input.hasAttribute('capture')
    void (async () => {
      const how = direct ? 'camera' : await askChoice<'camera' | 'gallery'>(L('ছবি কীভাবে দেবেন?', 'Add a photo'), [
        { key: 'camera', label: L('ক্যামেরা দিয়ে তুলুন', 'Take a photo'), icon: <Icon name="camera" size={22} />, sub: L('এখনই ছবি তুলে দিন', 'Use the camera now') },
        { key: 'gallery', label: onlyPhoto ? L('গ্যালারি থেকে নিন', 'Choose from gallery') : L('গ্যালারি বা ফাইল থেকে', 'Gallery or file'),
          icon: <Icon name={onlyPhoto ? 'image' : 'file'} size={22} />, sub: onlyPhoto ? L('আগে তোলা ছবি', 'A photo you already have') : L('আগে তোলা ছবি বা পিডিএফ', 'A photo or PDF you already have') },
      ])
      if (!how) return
      if (how === 'gallery') { pass = input; input.click(); return }
      try {
        const ph = await cam.getPhoto({ source: 'CAMERA', resultType: 'dataUrl', quality: 80, width: 1600, correctOrientation: true, saveToGallery: false })
        if (!ph.dataUrl) return
        const blob = await (await fetch(ph.dataUrl)).blob()
        const ext = (ph.format || blob.type.split('/')[1] || 'jpeg').replace('jpg', 'jpeg')
        const file = new File([blob], `photo-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}.${ext === 'jpeg' ? 'jpg' : ext}`, { type: blob.type || `image/${ext}` })
        const dt = new DataTransfer(); dt.items.add(file)
        input.files = dt.files
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      } catch (er) {
        // "User cancelled photos app" is not an error worth showing
        if (!/cancel/i.test(String((er as { message?: string })?.message ?? er))) haptic('error')
      }
    })()
  }, true)
}

/** Called once from setupNativeApp() inside the app. */
export function setupNativeFeel(): void {
  buzzOnTabs()
  setupRipple()
  setupBarLift()
  setupSheetSwipe()
  setupPullToRefresh()
  setupCamera()
  // no pinch-zoom in the app, like other apps (the text size setting in Settings makes text bigger instead)
  document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover')
}
