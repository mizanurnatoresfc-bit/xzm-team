import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type PermissionGrant = {
  permission_code: string
  scope_type: 'global' | 'zone' | 'hub'
  zone_id: string | null
  hub_id: string | null
  is_super: boolean
}

/** A Super Admin looking at the app the way one role sees it. Only menus, buttons and pages change on this
 *  device — the database still answers as the Super Admin, so this is a preview, not a login. */
export type ViewAs = { id: string; name: string; permissions: string[]; is_super: boolean; panels: string[] | null; view: 'self' | 'hub' | 'zone' | null }
const VIEW_AS_KEY = 'xzm_viewas'
function readViewAs(): ViewAs | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_AS_KEY) || 'null') as ViewAs | null
    return v && typeof v.id === 'string' && Array.isArray(v.permissions) ? v : null
  } catch { return null }
}

type AuthContextValue = {
  session: Session | null
  grants: PermissionGrant[]
  loading: boolean
  signIn: (email: string, password: string, portal?: 'staff' | 'admin') => Promise<void>
  signOut: () => Promise<void>
  can: (permission: string) => boolean
  refreshGrants: () => Promise<void>
  /** Set when an admin created the account or reset its password: only the change-password page opens. */
  mustChangePassword: boolean
  /** True for a real Super Admin, also while previewing another role. */
  isSuperAdmin: boolean
  /** The role being previewed, or null. */
  viewAs: ViewAs | null
  setViewAs: (role: ViewAs | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** invalid | locked | blocked | rate_limited | bad_request | network */
export class LoginError extends Error {
  code: string
  lockedUntil?: string
  constructor(code: string, lockedUntil?: string) { super(code); this.code = code; this.lockedUntil = lockedUntil }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [grants, setGrants] = useState<PermissionGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [mustChangePassword, setMustChange] = useState(false)
  const [viewAsPick, setViewAsPick] = useState<ViewAs | null>(readViewAs)
  const setViewAs = useCallback((role: ViewAs | null) => {
    setViewAsPick(role)
    try { if (role) sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(role)); else sessionStorage.removeItem(VIEW_AS_KEY) } catch { /* private mode */ }
  }, [])

  const refreshGrants = useCallback(async () => {
    const { data: { session: current } } = await supabase.auth.getSession()
    if (!current) {
      setGrants([])
      setMustChange(false)
      return
    }
    const [{ data, error }, prof] = await Promise.all([
      supabase.rpc('my_permissions'),
      supabase.from('profiles').select('must_change_password').eq('id', current.user.id).maybeSingle(),
    ])
    if (error) throw error
    setMustChange(Boolean((prof.data as { must_change_password?: boolean } | null)?.must_change_password))
    setGrants((data ?? []) as PermissionGrant[])
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (data.session) {
        try { await refreshGrants() } catch { setGrants([]) }
      }
      if (alive) setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) setGrants([])
      else queueMicrotask(() => { void refreshGrants().catch(() => setGrants([])) })
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [refreshGrants])

  // Sign-in goes through the auth-login Edge Function, which counts failed passwords
  // and locks the account (5 failures -> 30 minutes). See supabase/functions/auth-login.
  const signIn = useCallback(async (email: string, password: string, portal: 'staff' | 'admin' = 'staff') => {
    const { data, error } = await supabase.functions.invoke('auth-login', { body: { email, password, portal } })
    if (error) {
      let body: { error?: string, locked_until?: string } = {}
      const ctx = (error as { context?: Response }).context
      try { if (ctx && typeof ctx.json === 'function') body = await ctx.json() } catch { /* not JSON */ }
      throw new LoginError(body.error ?? 'network', body.locked_until)
    }
    const tokens = data as { access_token?: string, refresh_token?: string }
    if (!tokens?.access_token || !tokens.refresh_token) throw new LoginError('network')
    const { error: setErr } = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token })
    if (setErr) throw new LoginError(/locked|not active/i.test(setErr.message) ? 'blocked' : 'network')
    await refreshGrants()
  }, [refreshGrants])

  const signOut = useCallback(async () => {
    setViewAs(null)
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [setViewAs])

  const isSuperAdmin = useMemo(() => grants.some(g => g.is_super), [grants])
  // The preview only ever narrows what a real Super Admin sees; nobody else can turn it on.
  const viewAs = isSuperAdmin ? viewAsPick : null
  const shown = useMemo<PermissionGrant[]>(() => !viewAs ? grants
    : viewAs.is_super ? [{ permission_code: '*', scope_type: 'global', zone_id: null, hub_id: null, is_super: true }]
    : viewAs.permissions.map(code => ({ permission_code: code, scope_type: 'global' as const, zone_id: null, hub_id: null, is_super: false })), [grants, viewAs])
  const can = useCallback((permission: string) =>
    shown.some(g => g.is_super || g.permission_code === permission), [shown])

  const value = useMemo(() => ({
    session, grants: shown, loading, signIn, signOut, can, refreshGrants, mustChangePassword, isSuperAdmin, viewAs, setViewAs,
  }), [session, shown, loading, signIn, signOut, can, refreshGrants, mustChangePassword, isSuperAdmin, viewAs, setViewAs])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
