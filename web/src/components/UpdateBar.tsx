import { useEffect, useState } from 'react'
import { applyPages, downloadApk, newerApk, newerPages, type ApkInfo } from '../lib/update'
import { Icon } from './Icon'

const EVERY = 10 * 60 * 1000
/** "নতুন আপডেট এসেছে — আপডেট করুন": shown when a newer build is live, checked on open, every ten minutes and when the app comes back. */
export function UpdateBar() {
  const [pages, setPages] = useState(false)
  const [apk, setApk] = useState<ApkInfo | null>(null)
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem('xzm_upd_later') === '1' } catch { return false } })
  useEffect(() => {
    let on = true
    const check = () => {
      void newerPages().then(b => { if (on) setPages(!!b) })
      void newerApk().then(a => { if (on) setApk(a) })
    }
    check()
    const t = window.setInterval(check, EVERY)
    const vis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', vis)
    return () => { on = false; window.clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [])
  if (later || (!pages && !apk)) return null
  const dismiss = () => { setLater(true); try { sessionStorage.setItem('xzm_upd_later', '1') } catch { /* ignore */ } }
  return <div className="upd-bar no-print" role="status">
    <span className="upd-i"><Icon name={apk ? 'phone' : 'upload'} size={18} /></span>
    <span className="upd-tx">{apk ? <><b>অ্যাপের নতুন ভার্সন {apk.version}</b><small>ডাউনলোড করে ইনস্টল করুন — আপনার তথ্য যেমন আছে থাকবে</small></>
      : <><b>নতুন আপডেট এসেছে</b><small>এক চাপে আপডেট হবে, কয়েক সেকেন্ড লাগবে</small></>}</span>
    <button type="button" className="sm" onClick={() => { if (apk) void downloadApk(apk); else applyPages() }}>{apk ? 'ডাউনলোড করুন' : 'আপডেট করুন'}</button>
    <button type="button" className="link small upd-later" onClick={dismiss}>পরে</button>
  </div>
}
