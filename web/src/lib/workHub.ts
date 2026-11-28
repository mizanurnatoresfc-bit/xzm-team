import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react'

const prefix = 'xzm_work_hub:'
const changed = 'xzm:work-hub-changed'

const retained = new Map<string, string>()
const blockers = new Map<string, number>()

function notify() {
  window.dispatchEvent(new Event(changed))
}

export function readWorkHub(user: string): string {
  try { return user ? localStorage.getItem(prefix + user) ?? '' : '' }
  catch { return '' }
}

export function useWorkHub(user: string): string {
  const snapshot = useCallback(() => retained.get(user) ?? readWorkHub(user), [user])
  const subscribe = useCallback((listener: () => void) => {
    const storage = (event: StorageEvent) => {
      if (!user || event.storageArea !== localStorage || (event.key !== null && event.key !== prefix + user)) return
      listener()
    }
    window.addEventListener(changed, listener)
    window.addEventListener('storage', storage)
    return () => {
      window.removeEventListener(changed, listener)
      window.removeEventListener('storage', storage)
    }
  }, [user])
  return useSyncExternalStore(subscribe, snapshot)
}

/** Keep the current hub while an editor has unsaved changes or a save in progress. */
export function useWorkHubBlocker(user: string, blocked: boolean) {
  useLayoutEffect(() => {
    if (!user || !blocked) return
    retained.set(user, retained.get(user) ?? readWorkHub(user))
    blockers.set(user, (blockers.get(user) ?? 0) + 1)
    return () => {
      const count = (blockers.get(user) ?? 1) - 1
      if (count) blockers.set(user, count)
      else {
        blockers.delete(user)
        retained.delete(user)
        queueMicrotask(notify)
      }
    }
  }, [user, blocked])
}

export function isWorkHubBlocked(user: string): boolean {
  return blockers.has(user)
}

export function saveWorkHub(user: string, hub: string): boolean {
  if (!user || !hub || isWorkHubBlocked(user)) return false
  try { localStorage.setItem(prefix + user, hub) }
  catch { return false }
  notify()
  return true
}

/** Resolve only against this page's accessible hubs. An existing record link can open its own hub. */
export function resolveWorkHub<T extends { id: string }>(hubs: readonly T[], saved: string, linked?: string | null): T | undefined {
  if (linked) return hubs.find(hub => hub.id === linked)
  if (saved) return hubs.find(hub => hub.id === saved)
  return hubs[0]
}
