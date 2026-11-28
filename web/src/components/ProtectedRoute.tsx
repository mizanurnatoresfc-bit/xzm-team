import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useRelease } from '../lib/releaseAccess'
import { pageState } from '../lib/menu'

/** Every signed-in page. What a page needs is decided by lib/navAccess.ts (pageState), the same rule the menus and tabs use. */
export function ProtectedRoute() {
  const { session, loading, isSuperAdmin, can, mustChangePassword, viewAs, setViewAs, menu, menuUnavailable, refreshGrants } = useAuth()
  const [retrying, setRetrying] = useState(false)
  const where = useLocation()
  const release = useRelease()
  if (loading) return <main className="center-screen">লোড হচ্ছে…</main>
  if (!session) return <Navigate to="/staff/login" replace />
  // An account still flagged to change its password (or one that came in by the email reset link) opens nothing but the change-password page.
  // New logins and admin resets no longer set the flag (owner, 22 Nov 2026).
  if (mustChangePassword && where.pathname !== '/app/password') return <Navigate to="/app/password" replace />
  // Recovery remains reachable even when the role preview or release configuration fails.
  if (where.pathname.toLowerCase().replace(/\/+$/, '') === '/app/module-control') {
    return isSuperAdmin ? <Outlet /> : <Navigate to="/app" replace />
  }
  const state = pageState(where.pathname + where.search, { can, menu, menuUnavailable, releaseAllowed: release.addressAllowed })
  if (state === 'menu-unavailable') return <main className="center-screen">
    <section className="notice">
      <h1>পাতার অনুমতি লোড করা যায়নি</h1>
      <button disabled={retrying} onClick={() => {
        setRetrying(true)
        void refreshGrants().catch(() => undefined).finally(() => setRetrying(false))
      }}>{retrying ? 'লোড হচ্ছে…' : 'আবার চেষ্টা করুন'}</button>
    </section>
  </main>
  // A role limited to a list of pages opens nothing else, even by typing the address.
  if (state === 'not-listed') return <main className="center-screen">
    <section className="notice"><h1>এই পাতা আপনার জন্য চালু নেই</h1><p>{viewAs ? `“${viewAs.name}” রোলের তালিকায় এই পাতা নেই।` : 'আপনার রোলে এই পাতা এখনো চালু করা হয়নি। দরকার হলে অ্যাডমিনকে বলুন।'}</p>
      <p><a className="btn" href="/app">হোমে যান</a>{viewAs && <> <button className="secondary" onClick={() => setViewAs(null)}>সুপার অ্যাডমিনে ফিরুন</button></>}</p></section>
  </main>
  if (state === 'no-permission') return <main className="center-screen">
    <section className="notice"><h1>অনুমতি নেই</h1><p>{viewAs ? `“${viewAs.name}” রোল এই পেজ খুলতে পারে না।` : 'এই পেজ ব্যবহারের প্রয়োজনীয় অনুমতি আপনার অ্যাকাউন্টে নেই।'}</p>
      {viewAs && <p><button onClick={() => setViewAs(null)}>সুপার অ্যাডমিনে ফিরুন</button></p>}</section>
  </main>
  if (state === 'release-unavailable') {
    if (release.status === 'loading') return <main className="center-screen" role="status">লোড হচ্ছে…</main>
    return <main className="center-screen"><section className="notice">
      <h1>{release.status === 'error' ? 'মডিউলের কনফিগারেশন লোড করা যায়নি' : 'এই মডিউলটি এখন চালু নেই'}</h1>
      <a className="btn" href="/app">হোমে যান</a>{' '}
      {release.status === 'error' && <button onClick={release.refresh}>আবার চেষ্টা করুন</button>}
      {viewAs && <button onClick={() => setViewAs(null)}>সুপার অ্যাডমিনে ফিরুন</button>}
    </section></main>
  }
  return <Outlet />
}
