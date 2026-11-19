// Shared form helpers, used together or one at a time by any form:
//  - useDraft      auto save while typing + bring back an unfinished form (draft state)
//  - DraftBar      the small "saved 10:23 · start over" line
//  - useSteps / Stepper   a form in several steps with a progress bar
//  - useConfirm    "check before you send" dialog with a summary of what will be sent
//  - focusFirst / focusFirstInvalid   auto focus the first box, or the first wrong box
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { readDraft, removeDraft, writeDraft } from '../lib/draft'
import { usePrefs } from '../lib/prefs'
import { scrollBehavior } from '../lib/a11y'
import { Modal } from '../pages/accounts/ui'

const BOX = 'input:not([type=hidden]):not([disabled]):not([readonly]),select:not([disabled]),textarea:not([disabled]):not([readonly])'

/** Focus without popping open a searchable dropdown's list (it opens on tap, typing or ↓). */
function quietFocus(box: HTMLElement) {
  box.dataset.noOpen = '1'
  box.focus({ preventScroll: true })
  delete box.dataset.noOpen
}
/** Put the cursor in the first box inside `el` (on a new step, or when a form opens). */
export function focusFirst(el: HTMLElement | null) {
  const box = el?.querySelector<HTMLElement>(`[data-autofocus],${BOX}`)
  if (box) quietFocus(box)
  return box ?? null
}
/** After a failed check: go to the first box that has a problem. Returns false when nothing is wrong. */
export function focusFirstInvalid(el: HTMLElement | null): boolean {
  const bad = el?.querySelector<HTMLElement>('[aria-invalid="true"],.has-err input,.has-err select,.has-err textarea')
  if (!bad) return false
  bad.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
  quietFocus(bad)
  return true
}

/** State that saves itself while the person types and comes back if the form is closed unfinished.
 *  `key` names the form (e.g. "hr.new-application"); pass null to switch drafts off (e.g. a prefilled form). */
export function useDraft<T>(key: string | null, initial: T, delay = 700) {
  const { session } = useAuth()
  const full = key && session ? `${session.user.id}:${key}` : null
  const blank = useRef(JSON.stringify(initial))
  const [found] = useState(() => (full ? readDraft<T>(full) : null))
  const [value, setValue] = useState<T>(() => found ? { ...initial, ...found.v } : initial)
  const [savedAt, setSavedAt] = useState<number | null>(found?.at ?? null)
  const [restored, setRestored] = useState(!!found)
  const [saving, setSaving] = useState(false)
  const first = useRef(true)
  // what is still waiting to be saved — written at once if the form closes before the pause ends
  const pending = useRef<T | null>(null)

  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!full) return
    if (JSON.stringify(value) === blank.current) { pending.current = null; removeDraft(full); setSavedAt(null); setSaving(false); return }
    pending.current = value
    setSaving(true)
    const t = window.setTimeout(() => { pending.current = null; setSavedAt(writeDraft(full, value)); setSaving(false) }, delay)
    return () => window.clearTimeout(t)
  }, [value, full, delay])
  useEffect(() => () => { if (full && pending.current !== null) writeDraft(full, pending.current) }, [full])

  /** The form was sent: the draft is no longer needed. */
  const clear = useCallback(() => { pending.current = null; if (full) removeDraft(full); setSavedAt(null); setRestored(false) }, [full])
  /** Throw the draft away and start with an empty form. */
  const discard = useCallback(() => { pending.current = null; if (full) removeDraft(full); first.current = true; setValue(JSON.parse(blank.current) as T); setSavedAt(null); setRestored(false) }, [full])
  return { value, setValue, savedAt, saving, restored, clear, discard, enabled: !!full }
}

/** "✓ Saved as draft 10:23" — and, when an old draft came back, a way to start over. */
export function DraftBar({ draft }: { draft: { savedAt: number | null; saving: boolean; restored: boolean; discard: () => void; enabled: boolean } }) {
  const { L } = usePrefs()
  if (!draft.enabled || (!draft.savedAt && !draft.saving)) return null
  const time = draft.savedAt ? new Date(draft.savedAt).toLocaleTimeString(L('bn-BD', 'en-GB'), { hour: 'numeric', minute: '2-digit' }) : ''
  return <div className={`draft-bar${draft.restored ? ' back' : ''}`} role="status" aria-live="polite">
    <span>{draft.saving ? L('সেভ হচ্ছে…', 'Saving…')
      : draft.restored ? L(`আগের অসম্পূর্ণ ফর্ম ফিরিয়ে আনা হয়েছে · ${time}`, `Your unfinished form is back · ${time}`)
      : L(`✓ খসড়া সেভ হয়েছে · ${time}`, `✓ Draft saved · ${time}`)}</span>
    <button type="button" className="link" onClick={draft.discard}>{L('নতুন করে শুরু', 'Start over')}</button>
  </div>
}

/** Which step the form is on, with moving forward only when the current step is fine. */
export function useSteps(count: number) {
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const go = useCallback((i: number) => { const n = Math.max(0, Math.min(count - 1, i)); setStep(n); setReached(r => Math.max(r, n)) }, [count])
  return { step, reached, go, next: () => go(step + 1), back: () => go(step - 1), first: step === 0, last: step === count - 1 }
}

/** The step bar at the top of a multi-step form: numbers, names and a progress line. Done steps can be tapped to go back. */
export function Stepper({ titles, step, reached, onGo }: { titles: string[]; step: number; reached: number; onGo: (i: number) => void }) {
  const { L, n } = usePrefs()
  return <nav className="stepper" aria-label={L('ফর্মের ধাপ', 'Form steps')}>
    <div className="stepper-line" aria-hidden="true"><i style={{ width: `${titles.length > 1 ? (step / (titles.length - 1)) * 100 : 100}%` }} /></div>
    <ol>{titles.map((t, i) => {
      const state = i < step ? 'done' : i === step ? 'now' : 'next'
      return <li key={t} className={state}>
        <button type="button" disabled={i > reached || i === step} aria-current={i === step ? 'step' : undefined} onClick={() => onGo(i)}>
          <b aria-hidden="true">{state === 'done' ? '✓' : n(i + 1)}</b><span>{t}</span>
          <span className="sr-only">{state === 'done' ? L(' — সম্পন্ন', ' — done') : ''}</span>
        </button></li>
    })}</ol>
    <p className="stepper-count" aria-live="polite">{L(`ধাপ ${n(step + 1)} / ${n(titles.length)}`, `Step ${step + 1} of ${titles.length}`)}</p>
  </nav>
}

export type ConfirmOpts = { title: string; message?: ReactNode; rows?: Array<[string, ReactNode]>; ok?: string; cancel?: string; danger?: boolean }
/** A "please check before sending" dialog. `await ask({...})` answers true (send) or false (go back and change). */
export function useConfirm() {
  const { L } = usePrefs()
  const [open, setOpen] = useState<(ConfirmOpts & { done: (yes: boolean) => void }) | null>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(done => setOpen({ ...o, done })), [])
  const end = (yes: boolean) => { open?.done(yes); setOpen(null) }
  const node = open ? <Modal title={open.title} onClose={() => end(false)} actions={<>
    <button type="button" className="secondary" onClick={() => end(false)}>{open.cancel ?? L('ফিরে গিয়ে বদলান', 'Go back and change')}</button>
    <button type="button" data-autofocus className={open.danger ? 'danger' : undefined} onClick={() => end(true)}>{open.ok ?? L('হ্যাঁ, জমা দিন', 'Yes, submit')}</button></>}>
    {open.message && <div className="muted">{open.message}</div>}
    {open.rows && <dl className="confirm-rows">{open.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === '' || v == null ? '—' : v}</dd></div>)}</dl>}
  </Modal> : null
  return { ask, node }
}
