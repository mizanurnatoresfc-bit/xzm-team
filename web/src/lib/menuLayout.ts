// The sidebar's names, icons, order, hidden rows and "নতুন" dates as Super Admin set them in the menu editor (/app/menu).
// The code keeps the default menu (AppShell); this only renames, reorders and hides rows on top of it.
// Who may open a page is still decided by the role's permissions and page list, never by this.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type ItemLayout = { bn?: string; en?: string; icon?: string; hide?: boolean; order?: number; new_until?: string | null }
/** `icon` is kept for rows and panels; a heading (secs) has no icon. */
export type NameLayout = { bn?: string; en?: string; icon?: string }
export type MenuLayout = { items: Record<string, ItemLayout>; groups: Record<string, NameLayout>; secs: Record<string, NameLayout> }

export const EMPTY_LAYOUT: MenuLayout = { items: {}, groups: {}, secs: {} }
const EVENT = 'xzm-menu-layout'
let cache: Promise<MenuLayout> | null = null

const obj = (v: unknown): Record<string, never> => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, never>
function shape(raw: unknown): MenuLayout {
  const r = obj(raw)
  return { items: obj(r.items), groups: obj(r.groups), secs: obj(r.secs) }
}

export function loadMenuLayout(fresh = false): Promise<MenuLayout> {
  if (!cache || fresh) {
    cache = (async () => {
      const { data, error } = await supabase.rpc('menu_layout')
      // Before the migration is applied (or offline) the menu simply stays as the code has it.
      return error ? EMPTY_LAYOUT : shape(data)
    })().catch(() => EMPTY_LAYOUT)
  }
  return cache
}

/** Drops empty fields so the saved row holds only what was really changed. */
export function cleanLayout(l: MenuLayout): MenuLayout {
  const name = (v: NameLayout) => {
    const o: NameLayout = {}
    if (v.bn?.trim()) o.bn = v.bn.trim()
    if (v.en?.trim()) o.en = v.en.trim()
    return o
  }
  const iconed = (v: NameLayout) => { const o = name(v); if (v.icon && /^[a-z][a-z0-9_]{0,31}$/.test(v.icon)) o.icon = v.icon; return o }
  const keep = <T extends object>(m: Record<string, T>, f: (v: T) => T) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, f(v)]).filter(([, v]) => Object.keys(v as object).length)) as Record<string, T>
  return {
    items: keep(l.items, v => {
      const o: ItemLayout = iconed(v)
      if (v.hide) o.hide = true
      if (typeof v.order === 'number' && Number.isFinite(v.order)) o.order = v.order
      if (v.new_until !== undefined && (v.new_until === null || /^\d{4}-\d{2}-\d{2}$/.test(v.new_until))) o.new_until = v.new_until
      return o
    }),
    groups: keep(l.groups, iconed),
    secs: keep(l.secs, name),
  }
}

export async function saveMenuLayout(l: MenuLayout) {
  const { error } = await supabase.rpc('menu_layout_save', { p_layout: cleanLayout(l) })
  if (error) throw new Error(error.message)
  cache = Promise.resolve(cleanLayout(l))
  window.dispatchEvent(new Event(EVENT))
}

/** The current layout; the sidebar re-draws by itself after a save. */
export function useMenuLayout(): MenuLayout {
  const [l, setL] = useState<MenuLayout>(EMPTY_LAYOUT)
  useEffect(() => {
    let live = true
    const f = () => { void loadMenuLayout().then(v => { if (live) setL(v) }) }
    f(); window.addEventListener(EVENT, f)
    return () => { live = false; window.removeEventListener(EVENT, f) }
  }, [])
  return l
}

/** Section key: the panel key and the section's place in it (as written in the code). */
export const secKey = (group: string, index: number) => `${group}:${index}`
