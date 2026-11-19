// Accessibility helpers shared by the whole app: a screen-reader announcer, a dialog focus trap,
// moving focus to the new page after navigation, and "does this person want less motion?".
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,summary,[contenteditable="true"],[tabindex]:not([tabindex="-1"])'

/** Things inside `root` that Tab can reach and that are actually on screen. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[inert],[aria-hidden="true"]') && (el.offsetParent !== null || el === document.activeElement))
}

/** The person asked for less movement (phone/PC setting, or the app's own setting). */
export function reducedMotion(): boolean {
  if (document.documentElement.dataset.motion === 'reduce') return true
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
/** 'smooth' scrolling, unless the person asked for less motion. */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth')

let region: HTMLElement | null = null
/** Say something to a screen reader without showing it (e.g. "Saved", the new page name). */
export function announce(text: string, urgent = false) {
  if (typeof document === 'undefined' || !text) return
  if (!region || !document.body.contains(region)) {
    region = document.createElement('div')
    region.className = 'sr-only'
    region.setAttribute('aria-live', 'polite')
    region.setAttribute('aria-atomic', 'true')
    document.body.appendChild(region)
  }
  region.setAttribute('aria-live', urgent ? 'assertive' : 'polite')
  // Clear first so the same words said twice are still read out.
  region.textContent = ''
  window.setTimeout(() => { if (region) region.textContent = text }, 60)
}

// Open dialogs, newest last: only the top one traps focus and answers Esc.
const stack: HTMLElement[] = []

/** Makes a dialog behave for keyboard and screen-reader users:
 *  focus moves into it, Tab stays inside, Esc closes it, and focus goes back to the button that opened it. */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose?: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stack.push(el)
    if (!el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('[data-autofocus],[autofocus]') ?? focusables(el).find(x => !x.matches('.cb-x,[data-skip-focus]'))
      if (first) first.focus({ preventScroll: true })
      else { if (!el.hasAttribute('tabindex')) el.tabIndex = -1; el.focus({ preventScroll: true }) }
    }
    const key = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== el || e.defaultPrevented) return
      if (e.key === 'Escape' && close.current) { e.preventDefault(); close.current(); return }
      if (e.key !== 'Tab') return
      const f = focusables(el)
      if (!f.length) { e.preventDefault(); return }
      const a = f[0], z = f[f.length - 1], now = document.activeElement
      if (e.shiftKey && (now === a || !el.contains(now))) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && (now === z || !el.contains(now))) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      const i = stack.lastIndexOf(el); if (i >= 0) stack.splice(i, 1)
      if (back && document.contains(back) && (!document.activeElement || document.activeElement === document.body || el.contains(document.activeElement))) back.focus({ preventScroll: true })
    }
  }, [ref])
}

let lastPath: string | null = null
/** After moving to another page, put keyboard/screen-reader focus on the page heading and read its name,
 *  unless the page already focused something itself (e.g. a search box). */
export function usePageFocus(path: string, title: string, headingRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const first = lastPath === null
    const moved = lastPath !== path
    lastPath = path
    if (first || !moved) return
    const t = window.setTimeout(() => {
      const a = document.activeElement
      const main = headingRef.current?.closest('main')
      if (a && a !== document.body && main?.contains(a)) return
      if (a && a.closest('[role="dialog"]')) return
      headingRef.current?.focus({ preventScroll: true })
      announce(title)
    }, 30)
    return () => window.clearTimeout(t)
  }, [path, title, headingRef])
}

/** Arrow keys, Home and End move between the items of a menu (role="menu"). */
export function menuKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  if (!items.length) return
  const i = items.indexOf(document.activeElement as HTMLElement)
  let next = -1
  if (e.key === 'ArrowDown') next = (i + 1) % items.length
  else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = items.length - 1
  if (next < 0) return
  e.preventDefault(); items[next].focus()
}
