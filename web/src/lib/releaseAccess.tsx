import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { moduleForAddress, type ReleasePlatform } from './moduleRelease'
import { isNativeApp } from './native'
import { classifyError, withTimeout } from './routeOffline'
import { supabase } from './supabase'

export type ReleaseDecisions = Record<string, { allowed: boolean; order: number | null }>

export async function releaseSnapshot(platform: ReleasePlatform, hub: string | null, preview: string | null) {
  const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('module_release_snapshot', {
    p_platform: platform, p_hub: hub, p_preview: preview,
  })), 8000)
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid release snapshot')
  return data as ReleaseDecisions
}

const ReleaseContext = createContext({
  status: 'loading' as 'loading' | 'ready' | 'error',
  allows: (_key: string): boolean => false,
  addressAllowed: (_to: string): boolean => false,
  menuOrder: (_to: string): number | null => null,
  order: (_key: string): number | null => null,
  refresh: () => {},
})

export function ReleaseProvider({ children }: PropsWithChildren) {
  const { session, viewAs } = useAuth()
  const { pathname } = useLocation()
  const hub = pathname.match(/^\/app\/zonal\/hub-ops\/hub\/([0-9a-f-]{36})\/?$/i)?.[1] ?? null
  const user = session?.user.id
  const preview = viewAs?.id ?? null
  const platform = isNativeApp() ? 'android' : 'web'
  const key = JSON.stringify([user, preview, platform, hub])
  const [snapshot, setSnapshot] = useState<{ key: string; data: ReleaseDecisions | null }>()
  const [refreshCount, setRefreshCount] = useState(0)
  const refresh = useCallback(() => setRefreshCount(n => n + 1), [])
  useEffect(() => {
    if (!user) return
    let current = true
    let request = 0
    const load = () => {
      const call = ++request
      const cache = 'xzm_release_' + key
      void releaseSnapshot(platform, hub, preview).then(
        data => {
          if (!current || call !== request) return
          setSnapshot({ key, data })
          if (!preview) try { localStorage.setItem(cache, JSON.stringify(data)) } catch { /* storage unavailable */ }
        },
        error => {
          if (!current || call !== request) return
          let data: ReleaseDecisions | null = null
          if (!preview && (!navigator.onLine || classifyError(error) === 'network')) {
            try { data = JSON.parse(localStorage.getItem(cache) ?? 'null') as ReleaseDecisions | null } catch { /* unreadable cache */ }
          } else {
            try { localStorage.removeItem(cache) } catch { /* storage unavailable */ }
          }
          setSnapshot({ key, data })
        },
      )
    }
    load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    window.addEventListener('online', load)
    return () => { current = false; clearInterval(timer); window.removeEventListener('focus', load); window.removeEventListener('online', load) }
  }, [hub, key, platform, preview, refreshCount, user])

  const data = snapshot?.key === key ? snapshot.data : undefined
  const allows = (id: string) => id === 'core' || data?.[id]?.allowed === true
  const addressAllowed = (address: string) => {
    const id = moduleForAddress(address)
    return id === undefined || allows(id)
  }
  const order = (id: string) => data?.[id]?.order ?? null
  const menuOrder = (address: string) => order(moduleForAddress(address) ?? '')
  return <ReleaseContext.Provider value={{ status: data === undefined ? 'loading' : data === null ? 'error' : 'ready',
    allows, addressAllowed, menuOrder, order, refresh }}>{children}</ReleaseContext.Provider>
}

export const useRelease = () => useContext(ReleaseContext)
