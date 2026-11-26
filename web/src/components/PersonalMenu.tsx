// The three personal entries under every person's name card: আমার লোক দেওয়া · আমার হাতে লোক আছে · আমার উপস্থিতি.
// "card" is the big tile row of the staff panel and dashboard; "side" is the compact form under the name in the side menu.
// The small alert numbers (WorkforceAlerts, the badge here) come from ONE live copy of wf_pending_counts(): AppShell mounts
// <WfCountsHost /> once, every widget reads it with useWfCounts() — no widget fetches or subscribes on its own.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { referrals } from '../lib/extra'
import { usePrefs } from '../lib/prefs'
import { useLiveLoad, wf, type PendingCounts } from '../lib/workforce'
import { Icon } from './Icon'
import '../workforce.css'

// ------------------------------------------------------------------ one shared, live copy of the counts
type Snap = { user: string; data: PendingCounts | null; failed: boolean }
const NONE: Snap = { user: '', data: null, failed: false }
let snap: Snap = NONE
let snapAt = 0   // when the last answer arrived
const subs = new Set<() => void>()
const listen = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const publish = (next: Snap) => { snap = next; subs.forEach(f => f()) }

/** Mounted once by AppShell. Keeps the shared copy fresh (live changes, every 60 s, and when the app comes back to the screen). */
export function WfCountsHost() {
  const { session } = useAuth()
  const user = session?.user.id ?? ''
  // Every page has its own AppShell, so this host starts again on each page: its first load reuses an answer that is only seconds old.
  const first = useRef(true)
  const load = () => {
    const reuse = first.current && snap.user === user && !!snap.data && Date.now() - snapAt < 20_000
    first.current = false
    return reuse ? Promise.resolve(snap.data!) : wf.counts().then(d => { snapAt = Date.now(); return d })
  }
  // No Realtime subscription here: this host runs for every signed-in person on every page, and each change would be checked against
  // their row security once per listener. It refreshes every 60 s, when the app comes back, and when a screen announces a change.
  const c = useLiveLoad(load, [user])
  const reload = c.reload
  useEffect(() => {
    const f = () => void reload()
    window.addEventListener('wf:changed', f)
    return () => window.removeEventListener('wf:changed', f)
  }, [reload])
  useEffect(() => {
    if (!user) { publish(NONE); return }
    if (c.data) publish({ user, data: c.data, failed: false })
    else if (c.error) publish({ user, data: snap.user === user ? snap.data : null, failed: true })
  }, [user, c.data, c.error])
  return null
}

/** The shared counts for the signed-in person. `data` is null until the first answer; `failed` when the call cannot be answered (e.g. not set up yet). */
export function useWfCounts(): { data: PendingCounts | null; failed: boolean } {
  const { session } = useAuth()
  const user = session?.user.id ?? ''
  const s = useSyncExternalStore(listen, () => snap, () => NONE)
  return s.user === user ? s : NONE
}

// ------------------------------------------------------------------ does the login have an employee id? (only asked when needed)
const empCache = new Map<string, Promise<boolean>>()
/** null = not known yet (or not needed). */
function useHasEmployee(need: boolean): boolean | null {
  const { session } = useAuth()
  const user = session?.user.id ?? ''
  const [has, setHas] = useState<{ user: string; v: boolean } | null>(null)
  useEffect(() => {
    if (!need || !user) return
    let live = true
    let p = empCache.get(user)
    if (!p) { p = referrals.myEmployeeId().then(id => !!id, () => { empCache.delete(user); return false }); empCache.set(user, p) }
    void p.then(v => { if (live) setHas({ user, v }) })
    return () => { live = false }
  }, [need, user])
  return need && has?.user === user ? has.v : null
}

// What was shown last time (per person), so the menu does not blink in and out while the first answer is on its way.
const LAST = 'xzm_wf_menu'
const lastCount = (user: string): number | null => {
  try { const v = JSON.parse(localStorage.getItem(LAST) ?? 'null') as { user?: string; n?: number } | null; return v && v.user === user && typeof v.n === 'number' ? v.n : null } catch { return null }
}
const rememberCount = (user: string, n: number) => { try { localStorage.setItem(LAST, JSON.stringify({ user, n })) } catch { /* private window: no memory, no harm */ } }

// ------------------------------------------------------------------ the menu
const ITEMS = [
  { key: 'given', to: '/app/workforce/given', icon: 'userplus', tone: 'g', bn: 'আমার লোক দেওয়া', en: 'People I brought' },
  { key: 'hand', to: '/app/workforce/hand', icon: 'users', tone: 'b', bn: 'আমার হাতে লোক আছে', en: 'People in my hand' },
  { key: 'attendance', to: '/app/attendance', icon: 'cal', tone: 'o', bn: 'আমার উপস্থিতি', en: 'My attendance' },
] as const

/**
 * Shown to everyone with an active staff profile (all three). A login without a staff profile that still has an employee id
 * gets the two people lists; a login with neither gets nothing. The attendance entry carries a badge: days still to give + days returned.
 */
export function PersonalMenu({ variant = 'card', hideAttendance = false, onNavigate }: { variant?: 'card' | 'side'; hideAttendance?: boolean; onNavigate?: () => void }) {
  const { L, n } = usePrefs()
  const { session } = useAuth()
  const user = session?.user.id ?? ''
  const { data, failed } = useWfCounts()
  const mine = data?.mine ?? null
  const settled = !!data || failed
  const hasEmployee = useHasEmployee(settled && !mine)
  // How many entries: 3 with an active staff profile; 2 (the people lists) with only an employee id; 0 with neither. null = still finding out.
  const count = !settled ? null : mine ? 3 : hasEmployee === null ? null : hasEmployee ? 2 : 0
  useEffect(() => { if (count !== null && user) rememberCount(user, count) }, [count, user])
  const items = ITEMS.slice(0, count ?? (user ? lastCount(user) : null) ?? 0)
    .filter(item => !hideAttendance || item.key !== 'attendance')
  if (!items.length) return null
  const waiting = mine ? mine.missing_days + mine.returned_days : 0
  const badge = (key: string) => (key === 'attendance' && waiting > 0 ? waiting : 0)
  const label = L('আমার লোক ও উপস্থিতি', 'My people & attendance')

  if (variant === 'side') {
    return <nav className="wf-side" aria-label={label}>{items.map(i => <NavLink key={i.key} to={i.to} end title={L(i.bn, i.en)}
      className={({ isActive }) => (isActive ? 'nl active' : 'nl')} onClick={onNavigate}>
      <Icon name={i.icon} size={16} /><span className="t">{L(i.bn, i.en)}</span>
      {badge(i.key) > 0 && <span className="count">{n(badge(i.key))}</span>}</NavLink>)}</nav>
  }
  return <nav className={`wf-pm${items.length === 2 ? ' two' : ''}`} aria-label={label}>{items.map(i => <Link key={i.key} to={i.to} className={`wf-pm-t t-${i.tone}`}>
    <span className="wf-pm-i"><Icon name={i.icon} size={22} /></span><span className="wf-pm-l">{L(i.bn, i.en)}</span>
    {badge(i.key) > 0 && <span className={`wf-badge${mine && mine.returned_days > 0 ? ' bad' : ''}`} aria-label={L(`${n(badge(i.key))}টি বাকি`, `${badge(i.key)} waiting`)}>{n(badge(i.key))}</span>}</Link>)}</nav>
}
