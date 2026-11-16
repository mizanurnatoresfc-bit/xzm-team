// In-app update: the app (and the website) checks whether a newer build is live, and offers "আপডেট করুন".
//  * A new build of the pages: tapping reloads, and the new pages are in (the Android app loads the live site).
//  * A new Android app (only when something on the phone side changed): tapping downloads the APK to install.
import { isNativeApp } from './native'

export const BUILD_ID = __BUILD_ID__
export type ApkInfo = { build: number; version: string; url: string; at?: string; notes?: string }
type CapApp = { getInfo?: () => Promise<{ build: string; version: string }> }
type CapBrowser = { open: (o: { url: string }) => Promise<void> }
const plugins = () => (window as unknown as { Capacitor?: { Plugins?: { App?: CapApp; Browser?: CapBrowser } } }).Capacitor?.Plugins

const fresh = async <T,>(path: string): Promise<T | null> => {
  try {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null
    return await r.json() as T
  } catch { return null }
}

/** The build that is live now, when it is not this one. */
export async function newerPages(): Promise<string | null> {
  if (BUILD_ID.startsWith('local-') && !import.meta.env.PROD) return null
  const v = await fresh<{ build: string }>('/version.json')
  return v?.build && v.build !== BUILD_ID ? v.build : null
}

/** The installed Android app's build number (null on the website). */
export async function installedApk(): Promise<{ build: number; version: string } | null> {
  if (!isNativeApp()) return null
  try { const i = await plugins()?.App?.getInfo?.(); return i ? { build: Number(i.build) || 0, version: i.version } : null } catch { return null }
}

/** A newer Android app to download, if there is one. */
export async function newerApk(): Promise<ApkInfo | null> {
  const mine = await installedApk()
  if (!mine) return null
  const apk = await fresh<ApkInfo>('/download/apk.json')
  return apk && apk.build > mine.build ? apk : null
}

export async function apkInfo(): Promise<ApkInfo | null> { return fresh<ApkInfo>('/download/apk.json') }

/** Reload to the new pages. */
export function applyPages(): void { location.reload() }

/** Open the APK download (Android asks to install it). */
export async function downloadApk(apk: ApkInfo): Promise<void> {
  const url = new URL(apk.url, location.origin).toString()
  const b = plugins()?.Browser
  if (b) await b.open({ url }); else location.href = url
}
