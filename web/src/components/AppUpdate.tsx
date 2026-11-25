import { useEffect, useState } from 'react'
import { APK_REINSTALL_MESSAGE, BUILD_ID, applyPages, apkInfo, downloadApk, installedApk, newerPages, requiresApkReinstall, type ApkInfo } from '../lib/update'
import { isNativeApp } from '../lib/native'
import { Icon } from './Icon'

/** Settings: which version is running, and a button to look for an update now. */
export function AppUpdate() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'pages'>('idle')
  const [mine, setMine] = useState<{ build: number; version: string } | null>(null)
  const [apk, setApk] = useState<ApkInfo | null>(null)
  useEffect(() => { void installedApk().then(setMine); void apkInfo().then(setApk) }, [])
  async function check() {
    setState('checking')
    const [p, a] = await Promise.all([newerPages(), apkInfo()])
    setApk(a); setState(p ? 'pages' : 'latest')
  }
  const apkNew = !!(mine && apk && apk.build > mine.build)
  return <section className="panel app-upd">
    <h2><Icon name="upload" size={18} /> অ্যাপ ও আপডেট</h2>
    <div className="app-upd-rows">
      <div><span>পাতার ভার্সন</span><b>{BUILD_ID}</b></div>
      {isNativeApp() && <div><span>ফোনের অ্যাপ</span><b>{mine ? `${mine.version} (${mine.build.toLocaleString('bn-BD')})` : '—'}</b></div>}
      {apk && <div><span>সর্বশেষ অ্যাপ</span><b>{apk.version}</b></div>}
    </div>
    {state === 'latest' && !apkNew && <p className="da-ok small">সব আপডেট আছে — নতুন কিছু নেই।</p>}
    {mine && apk && requiresApkReinstall(apk, mine.build) && <p className="small" role="status">{APK_REINSTALL_MESSAGE}</p>}
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      {state === 'pages' ? <button onClick={applyPages}><Icon name="upload" size={16} />নতুন আপডেট — এখনই আপডেট করুন</button>
        : <button className="secondary" disabled={state === 'checking'} onClick={() => void check()}>{state === 'checking' ? 'খোঁজা হচ্ছে…' : 'আপডেট আছে কিনা দেখুন'}</button>}
      {apkNew && apk && <button onClick={() => void downloadApk(apk)}><Icon name="phone" size={16} />অ্যাপের নতুন ভার্সন ডাউনলোড</button>}
      {!isNativeApp() && apk && <a className="btn secondary" href={apk.url}>Android অ্যাপ ডাউনলোড</a>}
    </div>
    <p className="muted small">নতুন পাতা ও কাজ এলে অ্যাপের উপরে "আপডেট করুন" দেখাবে — রিইনস্টল লাগবে না। শুধু ফোনের দিক বদলালে নতুন অ্যাপ ডাউনলোড করতে বলবে।</p>
  </section>
}
