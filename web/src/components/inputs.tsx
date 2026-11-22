// Shared inputs used by every form: a dropdown you can search (Combo), a pick-several
// dropdown (MultiCombo), a text box that checks itself (TextInput), and the duplicate warning.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cleanMobile, firstError, matches, toLatinDigits, type Rule } from '../lib/validate'
import { scrollBehavior } from '../lib/a11y'
import { applyMask, caretAfter, unmask } from '../lib/mask'

export type Option = { value: string; label: string; /** Small second line, e.g. "#10086 · Rider". */ sub?: string; /** Extra words to search by (mobile, code…). */ keywords?: string }

const textOf = (o: Option) => `${o.label} ${o.sub ?? ''} ${o.keywords ?? ''}`
const MAX_SHOWN = 150
/** On a phone the keyboard covers half the screen: bring the box to the top so the choices under it stay visible. */
function liftOnPhone(el: HTMLElement | null) {
  if (el && typeof matchMedia === 'function' && matchMedia('(max-width:700px)').matches) window.setTimeout(() => el.scrollIntoView({ block: 'start', behavior: scrollBehavior() }), 60)
}

function useList(options: Option[], q: string) {
  return useMemo(() => options.filter(o => matches(textOf(o), q)).slice(0, MAX_SHOWN), [options, q])
}

/** A dropdown you can type in to search. With only a few choices it stays a plain dropdown (kinder on phones).
 *  A dependent dropdown is this with `disabled` + `placeholder` until its parent is chosen. */
export function Combo({ value, onChange, options, placeholder = 'বেছে নিন…', disabled, clearable = true, emptyText = 'কিছু মেলেনি', searchFrom = 8, label }: {
  value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; disabled?: boolean; clearable?: boolean; emptyText?: string
  /** From how many choices the search box appears. */ searchFrom?: number; /** For screen readers when no visible label wraps it. */ label?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const shown = useList(options, q)
  const current = options.find(o => o.value === value)
  useEffect(() => { if (open) (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }) }, [hi, open])

  if (options.length < searchFrom) return <select value={value} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.value)}>
    <option value="">{placeholder}</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}{o.sub ? ` · ${o.sub}` : ''}</option>)}</select>

  const show = () => { if (!disabled && !open) { setOpen(true); setQ(''); setHi(Math.max(0, options.findIndex(o => o.value === value))); liftOnPhone(boxRef.current) } }
  const close = () => { setOpen(false); setQ('') }
  const pick = (o: Option) => { onChange(o.value); close() }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setHi(i => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (shown[hi]) pick(shown[hi]) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close() }
  }
  return <div ref={boxRef} className={`cb${open ? ' open' : ''}${disabled ? ' off' : ''}`}>
    <input role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-label={label} autoComplete="off" disabled={disabled}
      aria-activedescendant={open && shown[hi] ? `${id}-o${hi}` : undefined}
      value={open ? q : current?.label ?? ''} placeholder={open && current ? current.label : placeholder}
      onFocus={e => { if (!e.currentTarget.dataset.noOpen) show() }} onClick={show} onBlur={close} onKeyDown={key} onChange={e => { setQ(e.target.value); setHi(0); if (!open) setOpen(true) }} />
    {clearable && value && !disabled && <button type="button" className="cb-x" aria-label="মুছুন" tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); onChange(''); close() }}>✕</button>}
    {open && <ul id={id} role="listbox" className="cb-list" ref={listRef} onMouseDown={e => e.preventDefault()}>
      {shown.map((o, i) => <li key={o.value} id={`${id}-o${i}`} role="option" aria-selected={o.value === value} className={`${i === hi ? 'hi' : ''}${o.value === value ? ' sel' : ''}`}
        onMouseEnter={() => setHi(i)} onClick={e => { e.preventDefault(); pick(o) }}><span>{o.label}</span>{o.sub && <small>{o.sub}</small>}</li>)}
      {!shown.length && <li className="cb-empty" role="presentation">{emptyText}</li>}
      {shown.length === MAX_SHOWN && <li className="cb-empty" role="presentation">আরও আছে — লিখে খুঁজুন</li>}
    </ul>}
  </div>
}

/** Pick several: chosen ones show as chips, the list stays open while picking. */
export function MultiCombo({ values, onChange, options, placeholder = 'বেছে নিন…', disabled, emptyText = 'কিছু মেলেনি', label }: {
  values: string[]; onChange: (v: string[]) => void; options: Option[]; placeholder?: string; disabled?: boolean; emptyText?: string; label?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const shown = useList(options, q)
  useEffect(() => { if (open) (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }) }, [hi, open])
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  const close = () => { setOpen(false); setQ('') }
  const show = () => { if (!disabled && !open) { setOpen(true); liftOnPhone(boxRef.current) } }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setHi(i => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (shown[hi]) toggle(shown[hi].value) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Backspace' && !q && values.length) onChange(values.slice(0, -1))
  }
  return <div ref={boxRef} className={`cb multi${open ? ' open' : ''}${disabled ? ' off' : ''}`}>
    <div className="cb-box">
      {values.map(v => { const o = options.find(x => x.value === v); return <span key={v} className="cb-chip">{o?.label ?? v}
        {!disabled && <button type="button" aria-label={`${o?.label ?? v} সরান`} tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); toggle(v) }}>✕</button>}</span> })}
      <input role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-label={label} autoComplete="off" disabled={disabled}
        aria-activedescendant={open && shown[hi] ? `${id}-o${hi}` : undefined}
        value={q} placeholder={values.length ? '' : placeholder} onFocus={e => { if (!e.currentTarget.dataset.noOpen) show() }} onClick={show}
        onBlur={close} onKeyDown={key} onChange={e => { setQ(e.target.value); setHi(0); setOpen(true) }} />
    </div>
    {open && <ul id={id} role="listbox" aria-multiselectable="true" className="cb-list" ref={listRef} onMouseDown={e => e.preventDefault()}>
      {shown.map((o, i) => { const on = values.includes(o.value); return <li key={o.value} id={`${id}-o${i}`} role="option" aria-selected={on} className={`${i === hi ? 'hi' : ''}${on ? ' sel' : ''}`}
        onMouseEnter={() => setHi(i)} onClick={e => { e.preventDefault(); toggle(o.value) }}><span><i className="cb-tick" aria-hidden="true">{on ? '✓' : ''}</i>{o.label}</span>{o.sub && <small>{o.sub}</small>}</li> })}
      {!shown.length && <li className="cb-empty">{emptyText}</li>}
    </ul>}
  </div>
}

/** A text box that checks itself as soon as the person leaves it (or at once with `showError`).
 *  `kind="phone"` tidies the number (Bangla digits, +88, spaces); `kind="number"` turns Bangla digits into 0-9.
 *  `mask` shows a fixed format while typing (see lib/mask: `masks.mobile` → 01711-000000) but hands back only the plain characters. */
export function TextInput({ value, onChange, rules = [], kind = 'text', showError, placeholder, disabled, label, after, required, autoComplete, mask, autoFocus }: {
  value: string; onChange: (v: string) => void; rules?: Rule[]; kind?: 'text' | 'phone' | 'number'; /** Show the message even before the box was touched (after a failed save). */ showError?: boolean
  placeholder?: string; disabled?: boolean; label?: string; /** Extra note under the box (e.g. a duplicate warning). */ after?: ReactNode
  /** Tells screen readers the box must be filled. */ required?: boolean; /** Lets the phone offer saved answers, e.g. "tel", "name". */ autoComplete?: string
  /** Fixed format such as masks.mobile. */ mask?: string; /** Put the cursor here when the form opens. */ autoFocus?: boolean
}) {
  const [touched, setTouched] = useState(false)
  const errId = useId()
  const ref = useRef<HTMLInputElement>(null)
  const error = (touched || showError) ? firstError(value, rules) : null
  const shown = mask ? applyMask(unmask(value, mask), mask) : value
  function change(raw: string, caret: number | null) {
    if (!mask) return onChange(kind === 'text' ? raw : toLatinDigits(raw))
    // a pasted "+880 1711-000000" becomes 01711000000 before it is laid into the format
    const plain = unmask(kind === 'phone' ? cleanMobile(raw) : raw, mask)
    const before = caret == null ? plain.length : unmask(raw.slice(0, caret), mask).length
    onChange(plain)
    requestAnimationFrame(() => { const el = ref.current; if (el && document.activeElement === el) { const at = caretAfter(applyMask(plain, mask), Math.min(before, plain.length), mask); el.setSelectionRange(at, at) } })
  }
  return <>
    <input ref={ref} value={shown} disabled={disabled} placeholder={placeholder} aria-label={label} aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
      aria-required={required || undefined} className={error ? 'bad-input' : undefined} autoFocus={autoFocus} data-autofocus={autoFocus || undefined}
      autoComplete={autoComplete} type={kind === 'phone' ? 'tel' : 'text'}
      inputMode={kind === 'phone' ? 'tel' : kind === 'number' ? 'decimal' : mask && !/[A*]/.test(mask) ? 'numeric' : undefined}
      onChange={e => change(e.target.value, e.target.selectionStart)}
      onBlur={() => { setTouched(true); if (kind === 'phone' && value && !mask) { const c = cleanMobile(value); if (c !== value) onChange(c) } }} />
    {error && <small className="field-err" id={errId} role="alert">{error}</small>}
    {after}
  </>
}

/** Looks for existing records while the person types (after a short pause). `ready` says when the text is worth checking. */
export function useDuplicates<T>(value: string, find: (v: string) => Promise<T[]>, ready: (v: string) => boolean, delay = 450): T[] {
  const [rows, setRows] = useState<T[]>([])
  useEffect(() => {
    setRows([])
    if (!ready(value)) return
    let live = true
    const t = window.setTimeout(() => { void find(value).then(r => { if (live) setRows(r) }).catch(() => { /* a look-up that fails only means no warning */ }) }, delay)
    return () => { live = false; window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return rows
}
export function DupNote({ children }: { children: ReactNode }) {
  return <small className="dup-note" role="status">⚠ {children}</small>
}
