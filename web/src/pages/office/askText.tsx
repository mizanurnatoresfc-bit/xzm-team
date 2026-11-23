// The office pages' "why?" box. It is now the app-wide one (components/ask.tsx); this keeps the office pages' old contract:
// resolves with the typed text, or '' when cancelled.
import { askText as ask } from '../../components/ask'

type Opts = { ok: string; cancel: string; label?: string }

export const askText = async (question: string, o: Opts): Promise<string> => (await ask(question, o)) ?? ''

/** `L` from usePrefs — gives the buttons in the person's language. */
export const askWith = (L: (bn: string, en: string) => string) => (q: string) =>
  askText(q, { ok: L('ঠিক আছে', 'OK'), cancel: L('বাতিল', 'Cancel'), label: L('কারণ (অডিট লগে থাকবে)', 'Reason (kept in the audit log)') })
