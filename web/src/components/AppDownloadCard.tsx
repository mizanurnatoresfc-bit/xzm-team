// Bottom of every dashboard: "অ্যান্ড্রয়েড অ্যাপ (APK)" — download it, or share the link (WhatsApp / copy / phone share sheet).
// The link always points at the public site, so a shared link works even when copied from inside the app.
import { useEffect, useState } from 'react'
import { apkInfo, type ApkInfo } from '../lib/update'
import { usePrefs } from '../lib/prefs'
import { Icon } from './Icon'

export const SITE = 'https://xzmteam.com'
export const APK_URL = `${SITE}/download/XZM-TEAM.apk`

type CapBrowser = { open: (o: { url: string }) => Promise<void> }
const browser = () => (window as unknown as { Capacitor?: { Plugins?: { Browser?: CapBrowser } } }).Capacitor?.Plugins?.Browser

/** Open outside the app (Android: Chrome, which downloads the APK / opens WhatsApp). */
async function openOut(url: string) {
  const b = browser()
  if (b) { try { await b.open({ url }); return } catch { /* fall through */ } }
  window.open(url, '_blank', 'noopener')
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* older WebView */ }
  try {
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'
    document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok
  } catch { return false }
}

export function AppDownloadCard() {
  const { L } = usePrefs()
  const [apk, setApk] = useState<ApkInfo | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { let on = true; void apkInfo().then(a => { if (on) setApk(a) }); return () => { on = false } }, [])
  useEffect(() => { if (!msg) return; const t = window.setTimeout(() => setMsg(null), 3000); return () => window.clearTimeout(t) }, [msg])

  const text = L(`XZM-TEAM অ্যান্ড্রয়েড অ্যাপ ডাউনলোড করুন: ${APK_URL}\nওয়েবসাইট: ${SITE}`, `Download the XZM-TEAM Android app: ${APK_URL}\nWebsite: ${SITE}`)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function share() {
    if (canShare) { try { await navigator.share({ title: 'XZM-TEAM', text, url: APK_URL }); return } catch (e) { if ((e as Error)?.name === 'AbortError') return } }
    setMsg(await copy(text) ? L('লিংক কপি হয়েছে', 'Link copied') : APK_URL)
  }
  async function copyLink() { setMsg(await copy(APK_URL) ? L('লিংক কপি হয়েছে', 'Link copied') : APK_URL) }

  return <section className="panel app-dl no-print">
    <h2><Icon name="phone" size={18} /> {L('অ্যান্ড্রয়েড অ্যাপ (APK)', 'Android app (APK)')}</h2>
    <p className="muted small">{L('ডাউনলোড করুন নিচে — ফোনে ইনস্টল করুন। প্রথমবার Android "install unknown apps"-এর অনুমতি চাইবে।', 'Download below and install on your phone. The first time, Android asks to allow "install unknown apps".')}
      {apk?.version ? <> {L('ভার্সন', 'Version')} <b>{apk.version}</b></> : null}</p>
    <div className="row app-dl-row">
      <button type="button" onClick={() => void openOut(APK_URL)}><Icon name="upload" size={16} className="ic-down" />{L('ডাউনলোড করুন', 'Download')}</button>
      <button type="button" className="secondary" onClick={() => void openOut(`https://wa.me/?text=${encodeURIComponent(text)}`)}><Icon name="wa" size={16} />WhatsApp</button>
      <button type="button" className="secondary" onClick={() => void share()}><Icon name="swap" size={16} />{L('শেয়ার', 'Share')}</button>
      <button type="button" className="secondary" onClick={() => void copyLink()}><Icon name="doc" size={16} />{L('লিংক কপি', 'Copy link')}</button>
    </div>
    <div className="app-dl-link"><input readOnly value={APK_URL} aria-label={L('শেয়ার লিংক', 'Share link')} onFocus={e => e.currentTarget.select()} /></div>
    {msg && <p className="da-ok small" role="status">{msg}</p>}
  </section>
}
