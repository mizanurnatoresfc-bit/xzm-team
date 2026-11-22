import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export type RowMenuItem = { label: string; icon?: string; danger?: boolean; disabled?: boolean; hint?: string; onClick: () => void }

/** The three-dot menu of a table row. The list is drawn on the page itself (not inside the table), so a scrolling table never cuts it off. */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // Placed under the button (above it near the bottom of the screen) and kept there while the page scrolls.
  // A button near the left edge: the list is moved right so it never runs off the screen.
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect()
    if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return }
    const h = 48 * items.length + 16
    setAt({ top: window.innerHeight - r.bottom > h ? r.bottom + 4 : Math.max(8, r.top - h), right: Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - 8 - (list.current?.offsetWidth ?? 248))) })
  }, [items.length])
  useLayoutEffect(() => { if (open) place() }, [open, place])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const away = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus() } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key)
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, place])
  const shown = open && !!at
  useEffect(() => { if (shown) list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }) }, [shown])

  return <>
    <button ref={btn} type="button" className="row-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
      onClick={e => { e.stopPropagation(); setOpen(o => !o) }}><span aria-hidden="true">⋮</span></button>
    {open && at && createPortal(<div ref={list} className="row-menu" role="menu" style={{ top: at.top, right: at.right }}>
      {items.map(i => <button key={i.label} type="button" role="menuitem" disabled={i.disabled} className={i.danger ? 'danger' : ''} title={i.hint}
        onClick={e => { e.stopPropagation(); setOpen(false); i.onClick() }}>
        {i.icon && <Icon name={i.icon} size={16} />}<span>{i.label}{i.hint && <small>{i.hint}</small>}</span></button>)}
    </div>, document.body)}
  </>
}
