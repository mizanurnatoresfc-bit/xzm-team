// The app's own question boxes, in place of window.prompt / confirm / alert. Those look like the browser and not like the
// app, say OK/Cancel in English, show the site's address as their title, give a one-line box on a phone, and look different
// again in the Android app. These use the same Modal as the rest of the app (focus inside, Esc closes, Tab stays in).
// Each returns a promise, so a call site reads almost like the old one:  const why = await askText(...)
import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Field, Modal } from '../pages/accounts/ui'

const L = (bn: string, en: string) => (document.documentElement.lang === 'en' ? en : bn)

/** Renders one box at the end of <body> and resolves with what it hands back once it closes. */
function show<T>(render: (done: (v: T) => void) => ReactElement): Promise<T> {
  return new Promise(resolve => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v: T) => { root.unmount(); host.remove(); resolve(v) }
    root.render(render(done))
  })
}

export type AskOpts = {
  /** Text in the box to start with (e.g. the old name or the reason already on record). */
  initial?: string
  /** The box may be left empty ("ইচ্ছা হলে"). Otherwise OK stays off until something is written. */
  optional?: boolean
  label?: string
  ok?: string
  cancel?: string
  /** One line instead of a three-line box: names, numbers. */
  short?: boolean
  inputMode?: 'text' | 'numeric' | 'decimal'
}

function AskBox({ question, o, done }: { question: string; o: AskOpts; done: (v: string | null) => void }) {
  const [v, setV] = useState(o.initial ?? '')
  const can = o.optional || v.trim().length > 0
  const submit = () => { if (can) done(v.trim()) }
  return <Modal title={question} onClose={() => done(null)}
    actions={<><button type="button" className="secondary" onClick={() => done(null)}>{o.cancel ?? L('বাতিল', 'Cancel')}</button>
      <button type="button" disabled={!can} onClick={submit}>{o.ok ?? L('ঠিক আছে', 'OK')}</button></>}>
    <Field label={o.label ?? (o.optional ? L('লিখুন (ইচ্ছা হলে)', 'Write (optional)') : L('লিখুন', 'Write'))}>
      {o.short
        ? <input autoFocus value={v} inputMode={o.inputMode} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} />
        : <textarea rows={3} autoFocus value={v} onChange={e => setV(e.target.value)} />}
    </Field>
  </Modal>
}

/** Asks for a line of text. Resolves with the trimmed text, or null when the person cancels. */
export const askText = (question: string, o: AskOpts = {}) => show<string | null>(done => <AskBox question={question} o={o} done={done} />)

/** Asks for a reason that must be written (it goes into the record / audit log). Resolves with it, or null when cancelled. */
export const askReason = (question: string, o: AskOpts = {}) => askText(question, { label: L('কারণ', 'Reason'), ...o, optional: false })

export type ConfirmOpts = { ok?: string; cancel?: string; danger?: boolean; detail?: string }

/** Yes / no. Resolves true only when the person presses the OK button. */
export const askConfirm = (question: string, o: ConfirmOpts = {}) => show<boolean>(done =>
  <Modal title={question} onClose={() => done(false)}
    actions={<><button type="button" className="secondary" onClick={() => done(false)}>{o.cancel ?? L('না', 'No')}</button>
      <button type="button" className={o.danger ? 'danger' : undefined} autoFocus onClick={() => done(true)}>{o.ok ?? L('হ্যাঁ', 'Yes')}</button></>}>
    {o.detail ? <p className="muted">{o.detail}</p> : null}
  </Modal>)

/** A message with one button (a failed action, mostly). */
export const tell = (message: string, o: { title?: string; ok?: string } = {}) => show<void>(done =>
  <Modal title={o.title ?? L('হয়নি', 'Could not do it')} onClose={() => done()}
    actions={<button type="button" autoFocus onClick={() => done()}>{o.ok ?? L('ঠিক আছে', 'OK')}</button>}>
    <p className="da-error" role="alert">{message}</p>
  </Modal>)
