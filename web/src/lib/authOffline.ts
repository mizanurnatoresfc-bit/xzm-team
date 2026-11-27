// Opening the app with no internet: what the phone keeps so a rider who is already signed in is not thrown to the login page in a place without signal.
// (1) the permissions, page list and password flag from the last time they were loaded; (2) the stored login, read only to know who this is when the
// access token has expired and cannot be renewed yet. The database still decides every real read and write; this only lets the screens open.
// Pure (the storage is passed in) so tests/routeOffline.test.mjs runs it.
import type { Store } from './routeOffline.ts'

export type AuthSnapshot<G> = { saved_at: string; grants: G[]; mustChange: boolean; menu: string[] | null | undefined }
const cacheKey = (user: string) => `xzm_auth_${user}`

export function saveAuthSnapshot<G>(store: Store, user: string, s: Omit<AuthSnapshot<G>, 'saved_at'>, now = Date.now()) {
  try { store.set(cacheKey(user), JSON.stringify({ saved_at: new Date(now).toISOString(), ...s })) } catch { /* storage full: nothing kept */ }
}
export function readAuthSnapshot<G>(store: Store, user: string): AuthSnapshot<G> | null {
  try {
    const c = JSON.parse(store.get(cacheKey(user)) ?? 'null') as AuthSnapshot<G> | null
    return c && Array.isArray(c.grants) && typeof c.mustChange === 'boolean' ? c : null
  } catch { return null }
}
export const clearAuthSnapshot = (store: Store, user: string) => store.remove(cacheKey(user))

/** supabase-js keeps the login under "sb-<first part of the project host>-auth-token". */
export const storedSessionKey = (supabaseUrl: string) => { try { return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` } catch { return '' } }

/** The login kept on the phone (even if its access token has run out), or null. Only its shape is checked: the server judges it once there is internet. */
export function readStoredSession<S extends { user: { id: string } }>(store: Store, supabaseUrl: string): S | null {
  const key = storedSessionKey(supabaseUrl)
  if (!key) return null
  try {
    const s = JSON.parse(store.get(key) ?? 'null') as (S & { refresh_token?: unknown }) | null
    return s && typeof s.user?.id === 'string' && typeof s.refresh_token === 'string' && s.refresh_token ? s : null
  } catch { return null }
}
