import { useCallback, useSyncExternalStore } from 'react'

const prefix = 'xzm_work_hub:'
const changed = 'xzm:work-hub-changed'

function subscribe(listener: () => void) {
  window.addEventListener(changed, listener)
  return () => window.removeEventListener(changed, listener)
}

export function readWorkHub(user: string): string {
  try { return user ? localStorage.getItem(prefix + user) ?? '' : '' }
  catch { return '' }
}

export function useWorkHub(user: string): string {
  const snapshot = useCallback(() => readWorkHub(user), [user])
  return useSyncExternalStore(subscribe, snapshot)
}

export function saveWorkHub(user: string, hub: string): boolean {
  if (!user || !hub) return false
  try { localStorage.setItem(prefix + user, hub) }
  catch { return false }
  window.dispatchEvent(new Event(changed))
  return true
}

/** Resolve only against this page's accessible hubs. An existing record link can open its own hub. */
export function resolveWorkHub<T extends { id: string }>(hubs: readonly T[], saved: string, linked?: string | null): T | undefined {
  if (linked) return hubs.find(hub => hub.id === linked)
  if (saved) return hubs.find(hub => hub.id === saved) ?? (hubs.length === 1 ? hubs[0] : undefined)
  return hubs[0]
}
