// Shared sticky memory for the zonal manager's last-picked Zone + Hub.
//
// Owner directive (2026-11-28): "বার বার জোন আর হাব সিলেক্ট করা লাগছে —
// জোন হাব এক সাথে রাখো।" — picking zone and hub repeatedly across Data
// Entry pages is painful. Store the last choice and offer it as the default
// on every page that lets the manager pick a zone or a hub, so navigation
// stops resetting them.
//
// Scope: Data Entry V2 pages. Other modules keep their own pickers until
// the owner asks for the same behaviour there.

const ZONE_KEY = 'xzm.zoneHub.zone.v1'
const HUB_KEY = 'xzm.zoneHub.hub.v1'

function readLocal(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}
function writeLocal(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch { /* private mode / disabled storage */ }
}

export function rememberedZone(): string { return readLocal(ZONE_KEY) }
export function rememberedHub(): string { return readLocal(HUB_KEY) }
export function rememberZone(id: string) { writeLocal(ZONE_KEY, id) }
export function rememberHub(id: string) { writeLocal(HUB_KEY, id) }

// Pick the first entry whose id matches the remembered value, else the
// provided fallback (default: the first available). Keeps picker defaults
// consistent across the Data Entry pages without a global React context.
export function pickRemembered<T extends { id: string }>(
  options: T[] | undefined | null,
  remembered: string,
  fallback?: T | null,
): T | null {
  const list = options ?? []
  if (!list.length) return null
  if (remembered) {
    const hit = list.find(item => item.id === remembered)
    if (hit) return hit
  }
  return fallback ?? list[0] ?? null
}
