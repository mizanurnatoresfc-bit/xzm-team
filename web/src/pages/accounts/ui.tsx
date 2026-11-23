import { haptic } from '../../lib/nativeFeel'
import { createPortal } from 'react-dom'
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useDialog } from '../../lib/a11y'
import { Icon } from '../../components/Icon'
import { STATUS_LABEL, friendly, type SheetStatus } from '../../lib/dailyAccounts'

// Accounts pages use the common app frame (grouped menu for every module).
export { AppShell as AccountsShell } from '../../components/AppShell'

const STAT_ICON: Array<[RegExp, string]> = [[/বাকি|due|অপেক্ষ|correction|সংশোধন|অসম্পূর্ণ/i, 'alert'], [/টাকা|amount|জমা|paid|cash|নগদ|বেতন/i, 'cash'],
  [/মোবাইল|mobile/i, 'wallet'], [/মার্চেন্ট|merchant/i, 'receipt'], [/খরচ|expense|transport|যাতায়াত/i, 'truck'], [/অনুমোদ|approved/i, 'checkall'],
  [/কর্মী|staff|employee|যোগদান|joining/i, 'users'], [/ছুটি|leave/i, 'log'], [/খাতা|sheet/i, 'ledger'], [/বদলি|transfer/i, 'hub']]
export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'ok' | 'bad'; icon?: string }) {
  const ic = icon ?? STAT_ICON.find(([re]) => re.test(label))?.[1] ?? 'chart'
  // A word answer ("দেওয়া হয়নি") is drawn smaller than a number so it never towers over the other tiles.
  const words = typeof value === 'string' && /[^\d০-৯৳.,%\s+\-−/:]/.test(value)
  return <div className={`da-stat${tone ? ` ${tone}` : ''}${words ? ' txt' : ''}`}><span className="ri"><Icon name={ic} size={18} /></span><span className="lbl">{label}</span><span className="val">{value}</span>{sub && <span className="sub">{sub}</span>}</div>
}

export function StatusBadge({ status }: { status: SheetStatus }) {
  return <span className={`da-badge st-${status}`}>{STATUS_LABEL[status]}</span>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`da-badge b-${tone}`}>{children}</span>
}

export function Modal({ title, children, onClose, actions, wide }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode; wide?: boolean }) {
  // Keyboard & screen reader: focus moves into the box, Tab stays inside, Esc closes, focus returns to the button that opened it.
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialog(box, onClose)
  // Rendered at the end of <body> so no card, sticky bar or animation can sit on top of it.
  return createPortal(<div className="da-modal-bg" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={box} className={`da-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>{children}<div className="da-modal-acts">{actions}</div>
    </div>
  </div>, document.body)
}

/** Form field: label above, input, helper text below. `required` adds a red *, `note` a small grey tag such as "(Restricted)".
 *  `error` shows the problem right under the box (inline error); `float` puts the label inside the box and lifts it when you type (floating label). */
export function Field({ label, children, hint, wide, required, note, error, float }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean; required?: boolean; note?: string
  error?: string | null; float?: boolean }) {
  // Screen readers hear "required", the helper text and the error together with the box itself, not only the red * and grey line.
  const hintId = useId(); const errId = useId()
  const plain = isValidElement(children) && typeof children.type === 'string' && /^(input|select|textarea)$/.test(children.type)
  const props = plain ? (children as ReactElement<Record<string, unknown>>).props : {}
  const described = [props['aria-describedby'], hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ')
  const box = plain ? cloneElement(children as ReactElement<Record<string, unknown>>, {
    ...(required ? { 'aria-required': true } : {}),
    ...(described ? { 'aria-describedby': described } : {}),
    ...(error ? { 'aria-invalid': true } : {}),
    // a floating label needs a placeholder so the box knows when it is empty
    ...(float && children.type !== 'select' && !props.placeholder ? { placeholder: ' ' } : {}),
  }) : children
  return <label className={`da-field${wide ? ' wide' : ''}${float ? ' fl' : ''}${error ? ' has-err' : ''}`}><span>{label}{required && <b className="req" aria-hidden="true"> *</b>}{required && <span className="sr-only"> (আবশ্যক)</span>}{note && <em className="fnote"> {note}</em>}</span>{box}
    {error && <small className="field-err" id={errId} role="alert">{error}</small>}{hint && <small className="muted" id={hintId}>{hint}</small>}</label>
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="da-error" role="alert">{friendly(error)}</p>
}

// Small "load + reload" helper with loading and error state
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const request = useRef(0)
  const run = useCallback(async () => {
    const current = ++request.current
    setLoading(true); setError(null)
    try {
      const result = await fn()
      if (current === request.current) setData(result)
    } catch (error) {
      if (current === request.current) setError(error)
    } finally {
      if (current === request.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { void run() }, [run])
  return { data, error, loading, reload: run, setData }
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!msg) return; haptic('tap'); const t = window.setTimeout(() => setMsg(null), 3200); return () => window.clearTimeout(t) }, [msg])
  const node = msg ? <div className="da-toast" role="status">{msg}</div> : null
  return { toast: setMsg, node }
}
