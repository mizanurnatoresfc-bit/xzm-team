import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { usePrefs } from '../lib/prefs'
import { getFix, tracking, type LocNeed } from '../lib/presence'

/**
 * While a staff member has the app open in duty hours (08:00–20:00 Dhaka), send the phone's location at most once an hour,
 * so the zonal manager can see how far they are from their hub. Nothing runs before the staff member has seen the notice,
 * nothing runs when the app is closed, and the server ignores anything outside duty hours or sooner than 50 minutes.
 */
const HOUR = 60 * 60 * 1000
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const dutyNow = () => { const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hour12: false })); return h >= 8 && h < 20 }

let needFor = '', needP: Promise<LocNeed | null> | null = null
let running = '', timer: ReturnType<typeof setInterval> | null = null, busy = false

async function tick(user: string) {
  if (busy || running !== user || document.hidden || !dutyNow()) return
  const key = `xzm_loc_try_${user}`
  if (Date.now() - Number(get(key) || 0) < HOUR) return
  busy = true
  try {
    put(key, String(Date.now()))           // one try an hour, even when the phone gives no location
    const fix = await getFix(15000)
    if (!fix) return
    const r = await tracking.ping(fix)
    if (r.why === 'not_staff') stop()
  } catch { /* try again next hour */ } finally { busy = false }
}
const onShow = () => { if (running) void tick(running) }
function start(user: string) {
  if (running === user) return
  stop(); running = user
  void tick(user)
  timer = setInterval(() => void tick(user), 5 * 60 * 1000)
  document.addEventListener('visibilitychange', onShow)
}
function stop() { running = ''; if (timer) clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', onShow) }

/** The one-time notice (and the sender behind it). Shown inside every app page; renders nothing once accepted. */
export function LocationNotice({ user }: { user: string }) {
  const { L } = usePrefs()
  const [need, setNeed] = useState<LocNeed | null>(null)
  const ackKey = `xzm_loc_ok_${user}`
  const [ack, setAck] = useState(() => get(ackKey) === '1')
  useEffect(() => {
    if (!user) return
    if (needFor !== user || !needP) { needFor = user; needP = tracking.need().catch(() => null) }
    let live = true; void needP.then(v => { if (live) setNeed(v) }); return () => { live = false }
  }, [user])
  useEffect(() => { if (user && need?.track && ack) start(user) }, [user, need?.track, ack])
  if (!user || !need?.track || ack) return null
  return <div className="loc-notice no-print" role="note">
    <Icon name="map" size={20} />
    <span>{L(`কাজের সময় (সকাল ৮টা–রাত ৮টা) অ্যাপ খোলা থাকলে ঘণ্টায় একবার আপনার লোকেশন যায় — জোনাল ম্যানেজার দেখেন আপনি হাব থেকে কত দূরে। অ্যাপ বন্ধ থাকলে বা কাজের সময়ের বাইরে কিছু যায় না।`,
      'During duty hours (8 am–8 pm), while the app is open, your location is sent once an hour — the zonal manager sees how far you are from your hub. Nothing is sent when the app is closed or after hours.')}</span>
    <button type="button" className="sm" onClick={() => { put(ackKey, '1'); setAck(true) }}>{L('ঠিক আছে', 'OK')}</button>
  </div>
}
