// Small helpers for running inside the Android app (Capacitor). On the website these do nothing.
// Native plugins are reached through window.Capacitor, so the website bundle does not depend on them.
type Listener = { remove: () => void }
type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: { App?: {
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
