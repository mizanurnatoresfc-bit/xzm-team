import { createPortal } from 'react-dom'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { STATUS_LABEL, friendly, type SheetStatus } from '../../lib/dailyAccounts'

// Accounts pages use the common app frame (grouped menu for every module).
export { AppShell as AccountsShell } from '../../components/AppShell'

const STAT_ICON: Array<[RegExp, string]> = [[/বাকি|due|অপেক্ষ|correction|সংশোধন|অসম্পূর্ণ/i, 'alert'], [/টাকা|amount|জমা|paid|cash|নগদ|বেতন/i, 'cash'],
  [/মোবাইল|mobile/i, 'wallet'], [/মার্চেন্ট|merchant/i, 'receipt'], [/খরচ|expense|transport|যাতায়াত/i, 'truck'], [/অনুমোদ|approved/i, 'checkall'],
  [/কর্মী|staff|employee|যোগদান|joining/i, 'users'], [/ছুটি|leave/i, 'log'], [/খাতা|sheet/i, 'ledger'], [/বদলি|transfer/i, 'hub']]
export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'ok' | 'bad'; icon?: string }) {
  const ic = icon ?? STAT_ICON.find(([re]) => re.test(label))?.[1] ?? 'chart'
  return <div className={`da-stat${tone ? ` ${tone}` : ''}`}><span className="ri"><Icon name={ic} size={18} /></span><span className="lbl">{label}</span><span className="val">{value}</span>{sub && <span className="sub">{sub}</span>}</div>
}

export function StatusBadge({ status }: { status: SheetStatus }) {
  return <span className={`da-badge st-${status}`}>{STATUS_LABEL[status]}</span>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`da-badge b-${tone}`}>{children}</span>
}

export function Modal({ title, children, onClose, actions, wide }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // Rendered at the end of <body> so no card, sticky bar or animation can sit on top of it.
  return createPortal(<div className="da-modal-bg" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className={`da-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2>{children}<div className="da-modal-acts">{actions}</div>
    </div>
  </div>, document.body)
}

/** Form field: label above, input, helper text below. `required` adds a red *, `note` a small grey tag such as "(Restricted)". */
export function Field({ label, children, hint, wide, required, note }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean; required?: boolean; note?: string }) {
  return <label className={`da-field${wide ? ' wide' : ''}`}><span>{label}{required && <b className="req" aria-hidden="true"> *</b>}{note && <em className="fnote"> {note}</em>}</span>{children}{hint && <small className="muted">{hint}</small>}</label>
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
  const run = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await fn()) } catch (e) { setError(e) } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { void run() }, [run])
  return { data, error, loading, reload: run, setData }
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!msg) return; const t = window.setTimeout(() => setMsg(null), 3200); return () => window.clearTimeout(t) }, [msg])
  const node = msg ? <div className="da-toast" role="status">{msg}</div> : null
  return { toast: setMsg, node }
}
