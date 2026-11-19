// Auto save for unfinished forms. What a person has typed is kept on this phone/computer only
// (browser storage), per signed-in user, so a closed tab, a dropped network or a phone call
// does not lose the work. A draft is removed when the form is sent, when the person starts over,
// when they sign out, and after DRAFT_DAYS days.
const PREFIX = 'xzm_draft:'
export const DRAFT_DAYS = 7

type Stored<T> = { v: T; at: number }

export function readDraft<T>(key: string): Stored<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const d = JSON.parse(raw) as Stored<T>
    if (!d || typeof d.at !== 'number' || Date.now() - d.at > DRAFT_DAYS * 864e5) { localStorage.removeItem(PREFIX + key); return null }
    return d
  } catch { return null }
}
export function writeDraft<T>(key: string, v: T): number | null {
  const at = Date.now()
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ v, at })); return at } catch { return null /* private window or full storage: no draft, no harm */ }
}
export function removeDraft(key: string) { try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ } }

/** Sign-out: forget every unfinished form, so the next person on a shared phone never sees them. */
export function clearAllDrafts() {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) localStorage.removeItem(k) } } catch { /* ignore */ }
}
