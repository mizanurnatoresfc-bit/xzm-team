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
