// A small "why?" box for the office pages, in place of window.prompt (which is hard to use on a phone and
// looks different in the Android app). Resolves with the typed text, or '' when cancelled — the same contract the old prompt had.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Field, Modal } from '../accounts/ui'

type Opts = { ok: string; cancel: string; label?: string }

function AskBox({ question, o, done }: { question: string; o: Opts; done: (v: string) => void }) {
  const [v, setV] = useState('')
  return <Modal title={question} onClose={() => done('')}
    actions={<><button className="secondary" onClick={() => done('')}>{o.cancel}</button>
      <button disabled={!v.trim()} onClick={() => done(v.trim())}>{o.ok}</button></>}>
    <Field label={o.label ?? ''}><textarea rows={3} autoFocus value={v} onChange={e => setV(e.target.value)} /></Field>
  </Modal>
}

export function askText(question: string, o: Opts): Promise<string> {
  return new Promise(resolve => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v: string) => { root.unmount(); host.remove(); resolve(v) }
    root.render(<AskBox question={question} o={o} done={done} />)
  })
}

/** `L` from usePrefs — gives the buttons in the person's language. */
export const askWith = (L: (bn: string, en: string) => string) => (q: string) =>
  askText(q, { ok: L('ঠিক আছে', 'OK'), cancel: L('বাতিল', 'Cancel'), label: L('কারণ (অডিট লগে থাকবে)', 'Reason (kept in the audit log)') })
