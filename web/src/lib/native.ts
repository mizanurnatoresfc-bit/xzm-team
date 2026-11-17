// Small helpers for running inside the Android app (Capacitor). On the website these do nothing.
// Native plugins are reached through window.Capacitor, so the website bundle does not depend on them.
type Listener = { remove: () => void }
type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: { StatusBar?: {
    setOverlaysWebView: (o: { overlay: boolean }) => Promise<void>
    setBackgroundColor: (o: { color: string }) => Promise<void>
    setStyle: (o: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }) => Promise<void>
  }, App?: {
    addListener: (event: 'backButton', cb: (e: { canGoBack: boolean }) => void) => Promise<Listener> | Listener
    exitApp: () => Promise<void>
    minimizeApp?: () => Promise<void>
  } }
}
const cap = (): CapacitorGlobal | undefined => (typeof window !== 'undefined' ? (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor : undefined)

/** True inside the Android/iOS app, false on the website. */
export const isNativeApp = (): boolean => Boolean(cap()?.isNativePlatform?.())

/**
 * Android back button: close an open dialog first, then go back a page;
 * on the first page, send the app to the background instead of closing it.
 */
export function setupNativeApp(): void {
  if (!isNativeApp()) return
  document.documentElement.classList.add('native-app')
  handOutsideLinks()
  fitStatusBar()
  const app = cap()?.Plugins?.App
  if (!app) return
  void app.addListener('backButton', () => {
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    if (document.querySelector('.da-modal, .top-pop, .side.open')) {
      window.dispatchEvent(esc); document.dispatchEvent(esc)
      ;(document.querySelector('.side-backdrop.open') as HTMLElement | null)?.click()
      return
    }
    const p = location.pathname
    if (p === '/app' || p === '/staff/login' || p === '/app/password' || window.history.length <= 1) {
      if (app.minimizeApp) void app.minimizeApp(); else void app.exitApp()
      return
    }
    window.history.back()
  })
}

/** Status bar: ask Android not to draw the page under it, colour it like the app bar, and if the
 *  page still runs under it (Android 15 edge-to-edge) without reporting an inset, pad by hand. */
function fitStatusBar(): void {
  const sb = cap()?.Plugins?.StatusBar
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  if (sb) {
    void sb.setOverlaysWebView({ overlay: false }).catch(() => undefined)
    void sb.setBackgroundColor({ color: dark ? '#111a15' : '#ffffff' }).catch(() => undefined)
    void sb.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => undefined)
  }
  const check = () => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden'
    document.body.appendChild(probe)
    const inset = probe.getBoundingClientRect().height
    probe.remove()
    const root = document.documentElement
    // The page covers the whole screen (status bar included) but the WebView reports no inset.
    const fullScreen = Math.abs(window.screen.height - window.innerHeight) < 16
    if (inset < 1 && fullScreen) { root.style.setProperty('--sat', '40px'); root.style.setProperty('--sab', '16px') }
    else { root.style.removeProperty('--sat'); root.style.removeProperty('--sab') }
  }
  if (document.body) check(); else window.addEventListener('DOMContentLoaded', check, { once: true })
  window.addEventListener('orientationchange', () => window.setTimeout(check, 300))
}

// ---------------------------------------------------------------- phone push (Firebase Cloud Messaging)
// Works only in an APK built with the push plugin and the Firebase file; anywhere else this quietly does nothing.
type PushPlugin = {
  checkPermissions: () => Promise<{ receive: string }>
  requestPermissions: () => Promise<{ receive: string }>
  register: () => Promise<void>
  createChannel?: (c: { id: string; name: string; importance: number; sound?: string; vibration?: boolean; visibility?: number }) => Promise<void>
  addListener: (e: string, cb: (x: { value?: string; notification?: { data?: Record<string, string> } }) => void) => Promise<Listener> | Listener
}
const PUSH_KEY = 'xzm_push_token'
let pushStarted = false
export const pushToken = (): string | null => { try { return localStorage.getItem(PUSH_KEY) } catch { return null } }
export const pushAvailable = (): boolean => isNativeApp() && !!(cap()?.Plugins as unknown as { PushNotifications?: PushPlugin } | undefined)?.PushNotifications

/** Ask once for permission, register with Firebase, hand the token to `save`, and open `link` when a push is tapped. */
export async function setupPush(save: (token: string) => Promise<void>, open: (link: string) => void): Promise<'on' | 'denied' | 'unavailable'> {
  const p = (cap()?.Plugins as unknown as { PushNotifications?: PushPlugin } | undefined)?.PushNotifications
  if (!isNativeApp() || !p) return 'unavailable'
  if (!pushStarted) {
    pushStarted = true
    void p.addListener('registration', t => { if (t.value) { try { localStorage.setItem(PUSH_KEY, t.value) } catch { /* ignore */ } void save(t.value).catch(() => undefined) } })
    void p.addListener('pushNotificationActionPerformed', a => { const l = a.notification?.data?.link; if (l && l.startsWith('/')) open(l) })
    void p.createChannel?.({ id: 'xzm', name: 'XZM-TEAM', importance: 5, sound: 'default', vibration: true, visibility: 1 }).catch(() => undefined)
  }
  let st = (await p.checkPermissions().catch(() => ({ receive: 'denied' }))).receive
  if (st === 'prompt' || st === 'prompt-with-rationale') st = (await p.requestPermissions().catch(() => ({ receive: 'denied' }))).receive
  if (st !== 'granted') return 'denied'
  await p.register().catch(() => undefined)
  return 'on'
}

/** Call, SMS, WhatsApp, e-mail and links that open a new window are handed to the phone (dialer, SMS app, WhatsApp, browser)
 *  instead of being tried inside the app's web view, where a new window or tel: link can silently do nothing. */
function handOutsideLinks(): void {
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href') || ''
    const outside = /^(tel|sms|mailto|whatsapp|geo|intent):/i.test(href)
      || (/^https?:/i.test(href) && (a.target === '_blank' || new URL(href, location.href).host !== location.host))
    if (!outside) return
    e.preventDefault()
    // A top-level navigation to another scheme or host is caught by the app and opened outside it.
    window.location.href = href
  }, true)
}
