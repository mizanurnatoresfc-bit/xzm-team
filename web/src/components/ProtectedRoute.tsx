import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function ProtectedRoute({ permission }: { permission?: string }) {
  const { session, loading, can, mustChangePassword } = useAuth()
  const where = useLocation()
  if (loading) return <main className="center-screen">লোড হচ্ছে…</main>
  if (!session) return <Navigate to="/staff/login" replace />
  // A temporary password (new account or admin reset) opens nothing but the change-password page.
  if (mustChangePassword && where.pathname !== '/app/password') return <Navigate to="/app/password" replace />
  if (permission && !can(permission)) return <main className="center-screen">
    <section className="notice"><h1>অনুমতি নেই</h1><p>এই পেজ ব্যবহারের প্রয়োজনীয় অনুমতি আপনার অ্যাকাউন্টে নেই।</p></section>
  </main>
  return <Outlet />
}
