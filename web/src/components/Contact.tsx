// A phone number with three one-tap buttons: call, SMS, WhatsApp. Taps never open the row behind them.
// In the Android app these links are handed to the phone's own dialer / SMS / WhatsApp (see lib/native.ts).
import { Icon } from './Icon'

/** 01711-000101 / +8801711000101 → 01711000101 */
export const localNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('880') ? d.slice(2) : d.startsWith('88') ? d.slice(2) : d }
export const waLink = (p: string, text?: string) => `https://wa.me/88${localNumber(p)}${text ? `?text=${encodeURIComponent(text)}` : ''}`

export function Contact({ phone, showNumber = true, text }: { phone: string | null | undefined; showNumber?: boolean; text?: string }) {
  if (!phone) return <span className="muted">—</span>
  const n = localNumber(phone)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return <span className="ct" onClick={stop}>
    {showNumber && <a className="ct-num" href={`tel:${n}`}>{phone}</a>}
    <a className="ct-b call" href={`tel:${n}`} aria-label={`কল ${phone}`} title="কল"><Icon name="phone" size={14} /></a>
    <a className="ct-b sms" href={`sms:${n}`} aria-label={`SMS ${phone}`} title="SMS"><Icon name="sms" size={14} /></a>
    <a className="ct-b wa" href={waLink(phone, text)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${phone}`} title="WhatsApp"><Icon name="wa" size={14} /></a>
  </span>
}
